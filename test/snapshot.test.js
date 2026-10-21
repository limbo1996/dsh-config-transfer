import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { collectSnapshot } from '../lib/snapshot.js'

function makeCtx(profileDir) {
  return {
    get(name) {
      if (name === 'profileContext') {
        return { dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml') }
      }
      if (name === 'pluginManager') {
        return {
          async listBundles() {
            return [
              {
                name: 'dsh-cost-meter',
                version: '1.9.9',
                official: false,
                availability: 'profile',
                enabled: true,
                installed: true,
                optional: false,
                removable: true,
                source: 'dsh-cost-meter@1.9.9',
                installTarget: { spec: 'dsh-cost-meter', version: '1.9.9' },
                rows: [{ rowId: 'cost-meter', moduleName: 'dsh-cost-meter' }],
                error: null,
              },
              {
                name: '@deepseek-ai/dsh-experimental-voice-input-bundle',
                version: '0.2.1-rc.2',
                official: true,
                availability: 'installation',
                enabled: false,
                installed: false,
                optional: true,
                removable: false,
                rows: [],
                error: null,
              },
              {
                name: '@deepseek-ai/dsh-web-app',
                version: '0.2.1-rc.2',
                official: false,
                availability: 'installation',
                enabled: true,
                installed: false,
                optional: false,
                removable: false,
                rows: [],
                error: null,
              },
              {
                name: 'dsh-disabled-installed',
                version: '1.0.0',
                official: false,
                availability: 'profile',
                enabled: false,
                installed: true,
                optional: false,
                removable: true,
                source: 'dsh-disabled-installed@1.0.0',
                installTarget: { spec: 'dsh-disabled-installed', version: '1.0.0' },
                rows: [],
                error: null,
              },
            ]
          },
          async listPlugins() {
            return [
              {
                patchId: 'cost-meter',
                moduleName: 'dsh-cost-meter',
                enabled: true,
                fiberPhase: 'active',
              },
            ]
          },
        }
      }
      if (name === 'configEditor') {
        return {
          configuration() {
            return [
              {
                entry: {
                  options: {
                    id: 'ui-theme',
                    name: '@deepseek-ai/dsh-client-ui-theme',
                  },
                },
                override: { preference: 'dark', apiKey: 'sk-abcdefghijklmnopqrstuvwxyz' },
                inherited: {},
              },
              {
                entry: {
                  options: {
                    id: 'plugin-marketplace',
                    name: 'dsh-plugin-marketplace',
                  },
                },
                override: { inventory: { packages: [] } },
                inherited: {},
              },
              {
                entry: {
                  options: {
                    id: 'mcp-zotero',
                    name: '@deepseek-ai/dsh-mcp-client',
                  },
                },
                override: {},
                inherited: { command: 'zotero-mcp' },
              },
            ]
          },
        }
      }
      if (name === 'settings') {
        return {
          describe() {
            return [{ ns: 'locale', user: { preference: 'zh' }, revision: 1 }]
          },
        }
      }
      if (name === 'workspaceRegistry') {
        return {
          list() {
            return [{ title: 'project', path: '/tmp/project' }]
          },
        }
      }
      return undefined
    },
  }
}

test('collectSnapshot exports config, insert rows, settings, bundles, and skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dshsync-snapshot-'))
  const profileDir = join(root, 'profile')
  const dshHome = join(root, 'dsh')
  const agentsHome = join(root, 'agents')
  await mkdir(profileDir, { recursive: true })
  await mkdir(join(dshHome, 'skills', 'my-skill'), { recursive: true })
  await mkdir(join(agentsHome, 'skills'), { recursive: true })
  await writeFile(join(dshHome, 'skills', 'my-skill', 'SKILL.md'), '# my skill\n')
  await writeFile(
    join(profileDir, 'cordis.patch.yml'),
    '- insert:\n    - id: mcp-zotero\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        command: zotero-mcp\n',
  )
  await writeFile(
    join(profileDir, 'package.json'),
    JSON.stringify({
      name: 'dsh-profile-desktop',
      dependencies: { 'dsh-cost-meter': '1.9.9' },
      dsh: { profile: { bundles: ['dsh-cost-meter'] } },
    }),
  )
  try {
    const result = await collectSnapshot(makeCtx(profileDir), { dshHome, agentsHome })
    assert.equal(result.snapshot.format, 'dshsync')
    assert.equal(result.snapshot.profile.configs.length, 1)
    assert.equal(result.snapshot.profile.configs[0].id, 'ui-theme')
    assert.equal(result.snapshot.profile.configs[0].config.apiKey, undefined)
    assert.ok(result.snapshot.profile.configs[0].redacted.some((entry) => entry.path.join('.') === 'apiKey'))
    assert.equal(result.snapshot.profile.inserts.length, 1)
    assert.equal(result.snapshot.profile.inserts[0].id, 'mcp-zotero')
    assert.equal(result.snapshot.profile.inserts[0].config.command, 'zotero-mcp')
    assert.equal(result.snapshot.profile.settings.length, 1)
    assert.equal(result.snapshot.profile.bundles.length, 3)
    assert.deepEqual(
      result.snapshot.profile.bundles.map((bundle) => bundle.name).sort(),
      ['@deepseek-ai/dsh-web-app', 'dsh-cost-meter', 'dsh-disabled-installed'],
    )
    assert.equal(result.stats.builtinBundles, 1)
    assert.equal(result.stats.thirdPartyBundles, 2)
    assert.equal(
      result.snapshot.profile.bundles.find((bundle) => bundle.name === '@deepseek-ai/dsh-web-app').builtIn,
      true,
    )
    assert.equal(result.snapshot.skills.skills.length, 1)
    assert.equal(result.snapshot.workspaces[0].title, 'project')
    assert.equal(result.stats.redactions, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
