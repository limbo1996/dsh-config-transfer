import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('package name, bundle patch row, and client module id agree', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
  const client = await readFile(join(root, 'client.js'), 'utf8')
  assert.equal(manifest.name, '@limbo1996/dshsync')
  assert.match(patch, /^\s*- id: dshsync$/mu)
  assert.match(patch, /^\s+name: "@limbo1996\/dshsync"$/mu)
  assert.match(client, /id: '@limbo1996\/dshsync'/u)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.notEqual(manifest.private, true)
})

test('publish metadata declares the supported DSH range and public access', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.engines.dsh, manifest.dsh.compatibility.dsh)
  assert.match(manifest.engines.dsh, /^>=0\.2\.1-rc\.1 <0\.3\.0-0$/u)
  assert.equal(manifest.publishConfig.access, 'public')
  assert.ok(manifest.keywords.includes('dsh-plugin'))
  assert.ok(manifest.repository.url.includes('github.com'))
  assert.ok(Array.isArray(manifest.files))
  for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json']) {
    const covered = manifest.files.some((pattern) => pattern === file || (pattern.endsWith('*.json') && file.startsWith(pattern.slice(0, -7))))
    assert.ok(covered, `${file} is not covered by files`)
  }
})
