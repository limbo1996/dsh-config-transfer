/**
 * Snapshot and restore user-owned skills.
 *
 * DSH reads user skills from <DSH_HOME>/skills and <AGENTS_HOME>/skills. Only
 * those two roots are touched; project skills, bundled skills, and skills a
 * third-party plugin keeps elsewhere are intentionally out of scope.
 */

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import {
  MAX_SKILLS,
  MAX_SKILL_FILES,
  MAX_SKILL_FILE_BYTES,
  MAX_EXPORT_SKILLS_BYTES,
} from './constants.js'
import { scrubText } from './sanitize.js'

const SKIP_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg'])
const SKIP_FILES = new Set(['.DS_Store', '.npmrc', '.netrc'])
const SECRET_FILE_PATTERN = /(?:^|\/)(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|keystore)|id_rsa|id_ed25519|credentials?(?:\..*)?|secrets?(?:\..*)?)$/iu
const SAFE_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

function toPosix(value) {
  return value.split(sep).join('/')
}

function isTextBuffer(buffer) {
  if (buffer.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return true
  } catch {
    return false
  }
}

function encodeFile(buffer) {
  if (isTextBuffer(buffer)) {
    return { encoding: 'utf8', content: buffer.toString('utf8') }
  }
  return { encoding: 'base64', content: buffer.toString('base64') }
}

async function readSkillTree(root, relativeDir, budget, warnings) {
  const files = []
  let bytes = 0
  const queue = [{ dir: join(root, relativeDir), prefix: '' }]
  while (queue.length > 0) {
    const current = queue.shift()
    let entries
    try {
      entries = await readdir(current.dir, { withFileTypes: true })
    } catch (error) {
      warnings.push(`Cannot read skill directory ${current.prefix}: ${error.message}`)
      continue
    }
    for (const entry of entries) {
      const relativePath = current.prefix === '' ? entry.name : `${current.prefix}/${entry.name}`
      if (entry.isSymbolicLink()) {
        warnings.push(`Skipped symlink in skill ${relativePath}`)
        continue
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        queue.push({ dir: join(current.dir, entry.name), prefix: relativePath })
        continue
      }
      if (!entry.isFile()) continue
      if (SKIP_FILES.has(entry.name)) continue
      if (SECRET_FILE_PATTERN.test(relativePath)) {
        warnings.push(`Skipped secret-like skill file ${relativePath}`)
        continue
      }
      if (files.length >= MAX_SKILL_FILES) {
        warnings.push(`Skill ${relativeDir} exceeds ${MAX_SKILL_FILES} files; remaining files skipped`)
        return { files, bytes }
      }
      const fullPath = join(current.dir, entry.name)
      let info
      try {
        info = await stat(fullPath)
      } catch (error) {
        warnings.push(`Cannot stat skill file ${relativePath}: ${error.message}`)
        continue
      }
      if (info.size > MAX_SKILL_FILE_BYTES) {
        warnings.push(`Skipped large skill file ${relativePath} (${info.size} bytes)`)
        continue
      }
      if (budget.remaining < info.size) {
        warnings.push(`Skill export budget reached before ${relativePath}`)
        return { files, bytes }
      }
      let buffer
      try {
        buffer = await readFile(fullPath)
      } catch (error) {
        warnings.push(`Cannot read skill file ${relativePath}: ${error.message}`)
        continue
      }
      budget.remaining -= buffer.byteLength
      bytes += buffer.byteLength
      const encoded = encodeFile(buffer)
      if (encoded.encoding === 'utf8') {
        const scrubbed = scrubText(encoded.content)
        if (scrubbed !== encoded.content) {
          warnings.push(`Redacted a credential-looking value in ${relativePath}`)
          encoded.content = scrubbed
        }
      }
      files.push({ path: relativePath, ...encoded })
    }
  }
  return { files, bytes }
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

/**
 * Collect user-owned skills from the two user roots.
 * @param {{ dshHome: string, agentsHome: string }} homes
 */
export async function collectSkills(homes) {
  const roots = [
    { root: 'dsh', path: join(homes.dshHome, 'skills') },
    { root: 'agents', path: join(homes.agentsHome, 'skills') },
  ]
  const budget = { remaining: MAX_EXPORT_SKILLS_BYTES }
  const warnings = []
  const skills = []
  for (const root of roots) {
    if (!(await pathExists(root.path))) continue
    let entries
    try {
      entries = await readdir(root.path, { withFileTypes: true })
    } catch (error) {
      warnings.push(`Cannot read ${root.path}: ${error.message}`)
      continue
    }
    for (const entry of entries) {
      if (skills.length >= MAX_SKILLS) {
        warnings.push(`Skill export stopped at ${MAX_SKILLS} skills`)
        break
      }
      if (entry.name.startsWith('.')) continue
      if (root.root === 'dsh' && entry.name === '.system') continue
      if (entry.isSymbolicLink()) {
        warnings.push(`Skipped symlinked skill ${entry.name} in ${root.path}`)
        continue
      }
      if (entry.isDirectory()) {
        const skillFile = join(root.path, entry.name, 'SKILL.md')
        if (!(await pathExists(skillFile))) continue
        const tree = await readSkillTree(root.path, entry.name, budget, warnings)
        skills.push({ root: root.root, name: entry.name, kind: 'bundle', files: tree.files, bytes: tree.bytes })
        continue
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
      if (entry.name === 'SKILL.md') continue
      const fullPath = join(root.path, entry.name)
      let info
      try {
        info = await stat(fullPath)
      } catch (error) {
        warnings.push(`Cannot stat skill ${entry.name}: ${error.message}`)
        continue
      }
      if (info.size > MAX_SKILL_FILE_BYTES) {
        warnings.push(`Skipped large skill file ${entry.name}`)
        continue
      }
      if (budget.remaining < info.size) {
        warnings.push(`Skill export budget reached before ${entry.name}`)
        break
      }
      let buffer
      try {
        buffer = await readFile(fullPath)
      } catch (error) {
        warnings.push(`Cannot read skill ${entry.name}: ${error.message}`)
        continue
      }
      budget.remaining -= buffer.byteLength
      const encoded = encodeFile(buffer)
      if (encoded.encoding === 'utf8') {
        const scrubbed = scrubText(encoded.content)
        if (scrubbed !== encoded.content) {
          warnings.push(`Redacted a credential-looking value in ${entry.name}`)
          encoded.content = scrubbed
        }
      }
      const name = basename(entry.name, '.md')
      skills.push({
        root: root.root,
        name,
        kind: 'file',
        files: [{ path: entry.name, ...encoded }],
        bytes: buffer.byteLength,
      })
    }
  }
  return { skills, warnings }
}

function safeRelativePath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0')) return undefined
  const posix = toPosix(path)
  if (isAbsolute(posix) || /^[A-Za-z]:/u.test(posix)) return undefined
  const normalized = normalize(posix)
  if (normalized === '.' || normalized.startsWith(`..${sep}`) || normalized === '..') return undefined
  return normalized.split(sep).join('/')
}

async function writeSkillAtomically(targetRoot, skill) {
  const target = join(targetRoot, skill.kind === 'bundle' ? skill.name : `${skill.name}.md`)
  if (await pathExists(target)) {
    return { status: 'skipped', reason: 'already-exists' }
  }
  await mkdir(targetRoot, { recursive: true })
  const tempRoot = join(targetRoot, `.dsh-config-transfer-${randomUUID()}`)
  const tempTarget = join(tempRoot, skill.kind === 'bundle' ? skill.name : `${skill.name}.md`)
  try {
    if (skill.kind === 'bundle') {
      await mkdir(tempTarget, { recursive: true })
      for (const file of skill.files) {
        const rel = safeRelativePath(file.path)
        if (rel === undefined) return { status: 'failed', reason: `unsafe path ${file.path}` }
        const destination = resolve(tempTarget, rel)
        if (destination !== resolve(tempTarget) && !destination.startsWith(`${resolve(tempTarget)}${sep}`)) {
          return { status: 'failed', reason: `unsafe path ${file.path}` }
        }
        await mkdir(dirname(destination), { recursive: true })
        const content = file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content
        await writeFile(destination, content, { mode: 0o644 })
      }
    } else {
      await mkdir(tempRoot, { recursive: true })
      const file = skill.files[0]
      if (file === undefined) return { status: 'failed', reason: 'missing file' }
      const content = file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content
      await writeFile(tempTarget, content, { mode: 0o644 })
    }
    await rename(tempTarget, target)
    return { status: 'written' }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

/**
 * Restore exported skills without overwriting any existing skill.
 * @param {{ dshHome: string, agentsHome: string }} homes
 * @param {unknown} skills
 */
export async function applySkills(homes, skills) {
  const report = { written: [], skipped: [], failed: [] }
  if (!Array.isArray(skills)) return report
  for (const skill of skills.slice(0, MAX_SKILLS)) {
    if (skill === null || typeof skill !== 'object') continue
    const root = skill.root === 'agents' ? 'agents' : skill.root === 'dsh' ? 'dsh' : undefined
    if (root === undefined) {
      report.failed.push({ name: String(skill.name ?? '?'), reason: 'unknown root' })
      continue
    }
    const name = typeof skill.name === 'string' ? skill.name : ''
    if (!SAFE_SKILL_NAME.test(name) || name.startsWith('.')) {
      report.failed.push({ name, reason: 'invalid skill name' })
      continue
    }
    const kind = skill.kind === 'file' ? 'file' : skill.kind === 'bundle' ? 'bundle' : undefined
    if (kind === undefined || !Array.isArray(skill.files) || skill.files.length === 0) {
      report.failed.push({ name, reason: 'invalid skill payload' })
      continue
    }
    const targetRoot = root === 'agents' ? join(homes.agentsHome, 'skills') : join(homes.dshHome, 'skills')
    try {
      const result = await writeSkillAtomically(targetRoot, { name, kind, files: skill.files })
      if (result.status === 'written') report.written.push({ root, name })
      else if (result.status === 'skipped') report.skipped.push({ root, name, reason: result.reason })
      else report.failed.push({ name, reason: result.reason })
    } catch (error) {
      report.failed.push({ name, reason: error.message })
    }
  }
  return report
}
