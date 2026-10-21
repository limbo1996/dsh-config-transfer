import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('market index matches the package and format 1 rules', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const index = JSON.parse(await readFile(join(root, 'market/index.json'), 'utf8'))
  assert.equal(index.format, 1)
  assert.equal(typeof index.title.en, 'string')
  assert.equal(index.plugins.length, 1)
  const plugin = index.plugins[0]
  assert.equal(plugin.name, manifest.name)
  assert.equal(typeof plugin.title.en, 'string')
  assert.ok(plugin.icon.startsWith('https://'))
  assert.equal(plugin.distTags, undefined)
  assert.equal(plugin['dist-tags'].latest, plugin.versions[0].version)
  for (const version of plugin.versions) {
    assert.equal(version.version, manifest.version)
    assert.equal(version.source.type, 'npm')
    assert.equal(version.engines.dsh, manifest.engines.dsh)
    assert.equal(Number.isInteger(version.publishTimestamp), true)
    assert.ok(version.publishTimestamp > 0 && version.publishTimestamp < 1e11)
  }
})
