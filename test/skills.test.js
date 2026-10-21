import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applySkills, collectSkills } from '../lib/skills.js'

test('skills round-trip into an empty user root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-config-transfer-skills-'))
  const source = join(root, 'source')
  const dshHome = join(source, 'dsh')
  const agentsHome = join(source, 'agents')
  const target = join(root, 'target')
  await mkdir(join(dshHome, 'skills', 'keeper'), { recursive: true })
  await writeFile(join(dshHome, 'skills', 'keeper', 'SKILL.md'), '# keeper\n')
  await mkdir(join(agentsHome, 'skills'), { recursive: true })
  await writeFile(join(agentsHome, 'skills', 'flat.md'), '# flat\n')
  try {
    const collected = await collectSkills({ dshHome, agentsHome })
    assert.equal(collected.skills.length, 2)
    assert.equal(collected.skills.find((skill) => skill.name === 'keeper').kind, 'bundle')

    const targetDsh = join(target, 'dsh')
    const targetAgents = join(target, 'agents')
    const report = await applySkills({ dshHome: targetDsh, agentsHome: targetAgents }, collected.skills)
    assert.equal(report.written.length, 2)
    assert.equal(await readFile(join(targetDsh, 'skills', 'keeper', 'SKILL.md'), 'utf8'), '# keeper\n')
    assert.equal(await readFile(join(targetAgents, 'skills', 'flat.md'), 'utf8'), '# flat\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('skills are never overwritten', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-config-transfer-skills-'))
  const dshHome = join(root, 'dsh')
  await mkdir(join(dshHome, 'skills', 'keeper'), { recursive: true })
  await writeFile(join(dshHome, 'skills', 'keeper', 'SKILL.md'), '# local\n')
  try {
    const report = await applySkills(
      { dshHome, agentsHome: join(root, 'agents') },
      [
        {
          root: 'dsh',
          name: 'keeper',
          kind: 'bundle',
          files: [{ path: 'SKILL.md', encoding: 'utf8', content: '# imported\n' }],
        },
      ],
    )
    assert.equal(report.skipped.length, 1)
    assert.equal(await readFile(join(dshHome, 'skills', 'keeper', 'SKILL.md'), 'utf8'), '# local\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('unsafe skill names and paths are refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-config-transfer-skills-'))
  try {
    const report = await applySkills(
      { dshHome: root, agentsHome: join(root, 'agents') },
      [
        { root: 'dsh', name: '../evil', kind: 'file', files: [{ path: 'x.md', content: 'x' }] },
        { root: 'dsh', name: 'ok', kind: 'bundle', files: [{ path: '../escape', content: 'x' }] },
      ],
    )
    assert.equal(report.written.length, 0)
    assert.equal(report.failed.length, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
