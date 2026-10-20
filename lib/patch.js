/**
 * Minimal, comment-preserving edits to the profile's cordis.patch.yml.
 *
 * Only insert rows are written here. Configuration of an entry that already
 * exists goes through configEditor, which owns validation and reconciliation.
 * The YAML library is loaded lazily so a missing optional dependency degrades
 * only insert-row support instead of failing the whole plugin.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const JS_TAG = 'tag:yaml.org,2002:js'
const CUSTOM_TAGS = [
  {
    tag: JS_TAG,
    resolve: (value) => value,
  },
]
const ROW_FIELDS = ['id', 'name', 'config', 'disabled', 'inject', 'intercept', 'isolate', 'group']

let yamlModule

/**
 * Resolve `yaml` the way a profile-installed linked plugin has to: from the
 * profile's own node_modules, then from this package, then by normal import.
 */
async function loadYaml() {
  if (yamlModule !== undefined) return yamlModule
  const bases = [
    process.env.DSH_PROFILE_DIR,
    process.env.DSH_HOME && process.env.DSH_PROFILE
      ? join(process.env.DSH_HOME, 'profiles', process.env.DSH_PROFILE)
      : undefined,
    dirname(dirname(fileURLToPath(import.meta.url))),
  ].filter((base) => typeof base === 'string' && base.length > 0)
  for (const base of bases) {
    try {
      const require = createRequire(join(base, 'package.json'))
      yamlModule = require('yaml')
      return yamlModule
    } catch {
      // Try the next base or the native import below.
    }
  }
  yamlModule = await import('yaml')
  return yamlModule
}

function ensureNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`
}

async function writeAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, text, { mode: 0o600, flag: 'wx' })
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await rename(temp, path)
        return
      } catch (error) {
        if (!['EACCES', 'EBUSY', 'EPERM'].includes(error.code) || attempt === 5) throw error
        await delay(25 * (attempt + 1))
      }
    }
  } finally {
    await rm(temp, { force: true })
  }
}

/** Parse a patch document, treating a missing file as an empty list. */
export async function loadPatchDocument(path) {
  const { isSeq, parseDocument } = await loadYaml()
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    text = '[]\n'
  }
  const document = parseDocument(text, { customTags: CUSTOM_TAGS })
  if (document.errors.length > 0) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error('profile patch must be a YAML sequence')
  return document
}

/** Convert the document to plain values, preserving Loader expressions. */
async function documentValue(document) {
  const { parseDocument, visit } = await loadYaml()
  const clone = parseDocument(String(document), { customTags: CUSTOM_TAGS })
  visit(clone, {
    Scalar(_key, node) {
      if (node.tag !== JS_TAG) return undefined
      return clone.createNode({ __jsExpr: node.value })
    },
  })
  return clone.toJS({ maxAliasCount: 100 })
}

/** Turn `{ __jsExpr }` markers back into Loader `!!js` scalars. */
async function convertMarkers(document, node) {
  const { Scalar, visit } = await loadYaml()
  visit(node, {
    Map(_key, map) {
      if (map.items.length !== 1 || typeof map.get('__jsExpr') !== 'string') return undefined
      const scalar = new Scalar(map.get('__jsExpr'))
      scalar.tag = JS_TAG
      return scalar
    },
  })
  return node
}

/** Whether an inserted plugin name can travel to another computer. */
export function isPortablePluginName(name) {
  if (typeof name !== 'string' || name.length === 0) return false
  if (name.startsWith('.') || name.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(name)) return false
  if (name.startsWith('file:')) return false
  return true
}

function pickRow(row) {
  const out = {}
  for (const field of ROW_FIELDS) {
    if (row[field] !== undefined) out[field] = row[field]
  }
  return out
}

/**
 * Read every row introduced by an `insert` list, including nested groups.
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function patchInsertRows(document) {
  const values = await documentValue(document)
  const rows = []
  const walk = (list, depth) => {
    if (!Array.isArray(list) || depth > 8) return
    for (const row of list) {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) continue
      if (typeof row.id !== 'string' || row.id.length === 0) continue
      // A group row carries its nested entry list in `config`; do not also
      // emit those nested rows as independent top-level inserts.
      rows.push(pickRow(row))
    }
  }
  for (const patch of Array.isArray(values) ? values : []) {
    if (patch === null || typeof patch !== 'object') continue
    if (Array.isArray(patch.insert)) walk(patch.insert, 0)
  }
  return rows
}

/**
 * Read explicit `disabled` values from top-level (non-insert) patch rows.
 * Loader expressions are preserved as `{ __jsExpr }`.
 */
export async function patchDisabledRows(document) {
  const values = await documentValue(document)
  const rows = []
  for (const row of Array.isArray(values) ? values : []) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue
    if (Array.isArray(row.insert)) continue
    if (typeof row.id !== 'string' || row.id.length === 0) continue
    if (row.disabled === undefined) continue
    rows.push({
      id: row.id,
      name: typeof row.name === 'string' ? row.name : undefined,
      disabled: row.disabled,
    })
  }
  return rows
}

async function findInsertMap(document, id, depth = 0) {
  const { isMap, isSeq } = await loadYaml()
  if (depth > 8 || !isSeq(document.contents)) return undefined
  const walk = (sequence) => {
    for (const item of sequence.items) {
      if (!isMap(item)) continue
      if (item.get('id') === id) return item
      if (item.get('group') === true) {
        const nested = item.get('config')
        if (isSeq(nested)) {
          const found = walk(nested)
          if (found !== undefined) return found
        }
      }
    }
    return undefined
  }
  for (const item of document.contents.items) {
    if (!isMap(item)) continue
    const inserted = item.get('insert')
    if (isSeq(inserted)) {
      const found = walk(inserted)
      if (found !== undefined) return found
    }
  }
  return undefined
}

async function findOrCreateInsertSequence(document) {
  const { isMap, isSeq } = await loadYaml()
  if (!isSeq(document.contents)) document.contents = document.createNode([])
  for (let index = document.contents.items.length - 1; index >= 0; index -= 1) {
    const item = document.contents.items[index]
    if (!isMap(item)) continue
    const inserted = item.get('insert')
    if (isSeq(inserted)) return inserted
  }
  const patch = document.createNode({ insert: [] })
  document.contents.items.push(patch)
  return patch.get('insert')
}

/**
 * Write imported insert rows into the patch: update an existing row with the
 * same id, otherwise append it to the last insert list.
 * @returns {Promise<{ changed: number, conflicts: {id: string, reason: string}[] }>}
 */
export async function applyInsertRows(document, rows) {
  const conflicts = []
  let changed = 0
  if (!Array.isArray(rows)) return { changed, conflicts }
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    if (typeof row.id !== 'string' || row.id.length === 0) continue
    if (typeof row.name !== 'string' || row.name.length === 0) continue
    if (!isPortablePluginName(row.name)) {
      conflicts.push({ id: row.id, reason: 'plugin name is a local path' })
      continue
    }
    const existing = await findInsertMap(document, row.id)
    if (existing !== undefined) {
      const existingName = existing.get('name')
      if (typeof existingName === 'string' && existingName !== row.name) {
        conflicts.push({ id: row.id, reason: `existing insert uses ${existingName}` })
        continue
      }
      if (Object.prototype.hasOwnProperty.call(row, 'config')) {
        const node = await convertMarkers(document, document.createNode(row.config))
        existing.set('config', node)
      } else {
        existing.delete('config')
      }
      if (Object.prototype.hasOwnProperty.call(row, 'disabled')) {
        existing.set('disabled', document.createNode(row.disabled))
      } else {
        existing.delete('disabled')
      }
      for (const field of ['inject', 'intercept', 'isolate']) {
        if (Object.prototype.hasOwnProperty.call(row, field)) {
          existing.set(field, document.createNode(row[field]))
        }
      }
      changed += 1
      continue
    }
    const sequence = await findOrCreateInsertSequence(document)
    const node = await convertMarkers(document, document.createNode(pickRow(row)))
    sequence.items.push(node)
    changed += 1
  }
  return { changed, conflicts }
}

/**
 * Validate and commit a patch document, serialized with HMR when available.
 * @returns {Promise<{ changed: boolean, live: boolean, text: string }>}
 */
export async function commitPatchDocument(ctx, path, document) {
  const { parseDocument } = await loadYaml()
  const text = ensureNewline(String(document))
  const check = parseDocument(text, { customTags: CUSTOM_TAGS })
  if (check.errors.length > 0) throw check.errors[0]
  const write = () => writeAtomic(path, text)
  const hmr = ctx.get('hmr')
  if (hmr !== undefined && typeof hmr.runExclusive === 'function') {
    await hmr.runExclusive(write)
    return { changed: true, live: true, text }
  }
  await write()
  return { changed: true, live: false, text }
}
