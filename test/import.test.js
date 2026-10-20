import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runImport, retryPending } from '../lib/import.js'
import { readPending } from '../lib/pending.js'

function makeBuilt() {
  return {
    actions: {
      installs: [{ name: 'dsh-cost-meter', spec: 'dsh-cost-meter@1.9.9', version: '1.9.9', enabled: true }],
      enableBundles: [],
      disableBundles: [],
      inserts: [
        {
          id: 'mcp-test',
          name: '@scope/mcp',
          config: { command: 'mcp' },
          portable: true,
        },
      ],
      enableRows: [],
      disableRows: [
        {
          patchId: 'ui-theme',
          moduleName: '@deepseek-ai/dsh-client-ui-theme',
          enabled: false,
        },
      ],
      configs: [
        {
          id: 'ui-theme',
          name: '@deepseek-ai/dsh-client-ui-theme',
          config: { preference: 'light' },
          redacted: [],
        },
      ],
      settings: [{ ns: 'locale', user: { preference: 'zh' }, redacted: [] }],
      skills: [],
      pending: { inserts: [], configs: [], settings: [], rows: [] },
    },
    display: { manual: [], conflicts: [], warnings: [], source: { profile: 'desktop' } },
    input: { source: { exportedAt: '2026-10-20T10:00:00.000Z' } },
  }
}

function makeCtx(profileDir, calls) {
  const configuration = [
    {
      entry: {
        options: { id: 'ui-theme', name: '@deepseek-ai/dsh-client-ui-theme' },
      },
      override: { preference: 'dark' },
      inherited: {},
    },
  ]
  return {
    get(name) {
      if (name === 'profileContext') {
        return { dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml') }
      }
      if (name === 'pluginManager') {
        return {
          async installBundle(spec, options) {
            calls.push({ type: 'install', spec, options })
            return { application: 'applied', changed: true, version: '1.9.9' }
          },
          async setPluginEnabled(patchId, enabled) {
            calls.push({ type: 'row', patchId, enabled })
            return { application: 'applied', changed: true }
          },
          async setBundleEnabled(name, enabled) {
            calls.push({ type: 'bundle', name, enabled })
            return { application: 'applied', changed: true }
          },
        }
      }
      if (name === 'configEditor') {
        return {
          configuration() {
            return configuration
          },
          async edit(entry, change) {
            const next = change(entry.options.config ?? {}, {})
            calls.push({ type: 'config', id: entry.options.id, next })
            configuration[0].override = next
          },
        }
      }
      if (name === 'settings') {
        return {
          describe() {
            return [{ ns: 'locale', user: { preference: 'en' }, revision: 1 }]
          },
          async update(ns, section, revision) {
            calls.push({ type: 'settings', ns, section, revision })
          },
        }
      }
      return undefined
    },
  }
}

test('runImport installs, writes inserts, toggles, and applies config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dshsync-import-'))
  const profileDir = join(root, 'profile')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'cordis.patch.yml'), '[]\n')
  const homes = { dshHome: join(root, 'dsh'), agentsHome: join(root, 'agents') }
  const calls = []
  try {
    const report = await runImport(makeCtx(profileDir, calls), homes, makeBuilt(), () => undefined)
    assert.equal(report.installed.length, 1)
    assert.equal(report.insertsWritten.length, 1)
    assert.equal(report.rowChanges.length, 1)
    assert.equal(report.configsApplied.length, 1)
    assert.equal(report.settingsApplied.length, 1)
    assert.equal(report.pending.total, 0)
    assert.equal(await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8').then((text) => text.includes('mcp-test')), true)
    const install = calls.find((call) => call.type === 'install')
    assert.equal(install.spec, 'dsh-cost-meter@1.9.9')
    const config = calls.find((call) => call.type === 'config')
    assert.deepEqual(config.next, { preference: 'light' })
    const settings = calls.find((call) => call.type === 'settings')
    assert.deepEqual(settings.section, { preference: 'zh' })
    assert.equal(await readPending(homes), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runImport queues a config whose entry is not live and retry applies it later', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dshsync-import-'))
  const profileDir = join(root, 'profile')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'cordis.patch.yml'), '[]\n')
  const homes = { dshHome: join(root, 'dsh'), agentsHome: join(root, 'agents') }
  const calls = []
  try {
    const built = makeBuilt()
    built.actions.configs = [
      {
        id: 'later-plugin',
        name: 'later-plugin',
        config: { enabled: true },
        redacted: [],
      },
    ]
    const report = await runImport(makeCtx(profileDir, calls), homes, built, () => undefined)
    assert.equal(report.configsApplied.length, 0)
    assert.equal(report.pending.configs, 1)
    const pending = await readPending(homes)
    assert.equal(pending.configs.length, 1)

    // The entry becomes live: retry should apply and clear the queue.
    const retryCtx = makeCtx(profileDir, calls)
    const original = retryCtx.get('configEditor')
    retryCtx.get = ((get) => (name) => {
      if (name !== 'configEditor') return get(name)
      return {
        configuration() {
          return [
            ...original.configuration(),
            {
              entry: { options: { id: 'later-plugin', name: 'later-plugin' } },
              override: {},
              inherited: {},
            },
          ]
        },
        edit: original.edit,
      }
    })(retryCtx.get)
    const result = await retryPending(retryCtx, homes, { resetAttempts: true })
    assert.equal(result.total, 0)
    assert.equal(await readPending(homes), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
