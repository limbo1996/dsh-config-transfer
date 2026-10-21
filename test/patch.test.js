import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  applyInsertRows,
  commitPatchDocument,
  loadPatchDocument,
  patchInsertRows,
} from '../lib/patch.js'

async function withTempFile(content) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-config-transfer-patch-'))
  const path = join(dir, 'cordis.patch.yml')
  await writeFile(path, content, 'utf8')
  return { dir, path }
}

const mockCtx = { get: () => undefined }

test('patch inserts round-trip with comments and Loader expressions', async () => {
  const { dir, path } = await withTempFile(
    '# keep this comment\n- insert:\n    - id: mcp-test\n      name: "@scope/mcp"\n      config:\n        command: echo\n',
  )
  try {
    const document = await loadPatchDocument(path)
    const before = await patchInsertRows(document)
    assert.equal(before.length, 1)
    assert.equal(before[0].id, 'mcp-test')

    const result = await applyInsertRows(document, [
      {
        id: 'mcp-test',
        name: '@scope/mcp',
        config: {
          command: 'node',
          env: { ZOTERO_LOCAL: 'true' },
          expression: { __jsExpr: 'ctx.foo' },
        },
      },
      {
        id: 'mcp-new',
        name: '@scope/new',
        config: { command: 'new' },
      },
    ])
    assert.equal(result.conflicts.length, 0)
    assert.equal(result.changed, 2)
    await commitPatchDocument(mockCtx, path, document)

    const text = await readFile(path, 'utf8')
    assert.ok(text.includes('# keep this comment'))
    assert.ok(text.includes('!!js ctx.foo'))
    assert.ok(text.includes('mcp-new'))

    const reloaded = await patchInsertRows(await loadPatchDocument(path))
    assert.equal(reloaded.length, 2)
    const updated = reloaded.find((row) => row.id === 'mcp-test')
    assert.deepEqual(updated.config, {
      command: 'node',
      env: { ZOTERO_LOCAL: 'true' },
      expression: { __jsExpr: 'ctx.foo' },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('patch insert refuses a local plugin path and a name conflict', async () => {
  const { dir, path } = await withTempFile(
    '- insert:\n    - id: local\n      name: ./local.mjs\n    - id: conflict\n      name: "@scope/one"\n',
  )
  try {
    const document = await loadPatchDocument(path)
    const result = await applyInsertRows(document, [
      { id: 'local', name: './local.mjs' },
      { id: 'conflict', name: '@scope/two' },
      { id: 'added', name: '@scope/three' },
    ])
    assert.equal(result.changed, 1)
    assert.equal(result.conflicts.length, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('missing patch file is treated as an empty list', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-config-transfer-patch-'))
  try {
    const document = await loadPatchDocument(join(dir, 'missing.yml'))
    const result = await applyInsertRows(document, [{ id: 'x', name: '@scope/x' }])
    assert.equal(result.changed, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
