import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildPlan } from '../lib/plan.js'

function makePayload() {
  return {
    format: 'dshsync',
    version: 1,
    exportedAt: '2026-10-20T10:00:00.000Z',
    source: { profile: 'desktop', platform: 'darwin' },
    profile: {
      name: 'desktop',
      bundleOrder: [],
      dependencies: {},
      bundles: [
        {
          name: 'dsh-cost-meter',
          version: '1.9.9',
          official: false,
          availability: 'profile',
          enabled: true,
          installed: false,
          installTarget: { spec: 'dsh-cost-meter', version: '1.9.9' },
        },
        {
          name: 'local-plugin',
          version: '0.1.0',
          official: false,
          availability: 'profile',
          enabled: true,
          installed: true,
          installTarget: { spec: 'link:/Users/me/local-plugin', version: '0.1.0' },
        },
      ],
      plugins: [
        {
          patchId: 'ui-theme',
          moduleName: '@deepseek-ai/dsh-client-ui-theme',
          enabled: false,
        },
      ],
      inserts: [
        {
          id: 'mcp-test',
          name: '@deepseek-ai/dsh-mcp-client',
          config: { command: 'zotero-mcp' },
          portable: true,
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
    },
    skills: {
      skills: [
        {
          root: 'dsh',
          name: 'my-skill',
          kind: 'file',
          files: [{ path: 'my-skill.md', encoding: 'utf8', content: '# hi' }],
          bytes: 4,
        },
      ],
    },
    workspaces: [{ title: 'w', path: '/tmp/w' }],
  }
}

function makeCtx(profileDir) {
  return {
    get(name) {
      if (name === 'profileContext') {
        return { dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml') }
      }
      if (name === 'pluginManager') {
        return {
          async listBundles() {
            return []
          },
          async listPlugins() {
            return [
              {
                patchId: 'ui-theme',
                moduleName: '@deepseek-ai/dsh-client-ui-theme',
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
                override: { preference: 'dark' },
                inherited: {},
              },
            ]
          },
        }
      }
      if (name === 'settings') {
        return {
          describe() {
            return [{ ns: 'locale', user: { preference: 'en' }, revision: 1 }]
          },
        }
      }
      return undefined
    },
  }
}

test('buildPlan reports installs, manual steps, inserts, configs, settings, rows, and skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dshsync-plan-'))
  const profileDir = join(root, 'profile')
  const dshHome = join(root, 'dsh')
  const agentsHome = join(root, 'agents')
  await mkdir(profileDir, { recursive: true })
  await mkdir(dshHome, { recursive: true })
  await mkdir(agentsHome, { recursive: true })
  await writeFile(join(profileDir, 'cordis.patch.yml'), '[]\n')
  await writeFile(join(profileDir, 'package.json'), '{"name":"dsh-profile-desktop"}')
  try {
    const built = await buildPlan(makeCtx(profileDir), { dshHome, agentsHome }, makePayload())
    assert.equal(built.display.summary.bundlesToInstall, 1)
    assert.equal(built.display.summary.manual, 1)
    assert.equal(built.display.summary.inserts, 1)
    assert.equal(built.display.summary.configs, 1)
    assert.equal(built.display.summary.settings, 1)
    assert.equal(built.display.summary.rowsToChange, 1)
    assert.equal(built.display.summary.skills, 1)
    assert.equal(built.actions.installs[0].spec, 'dsh-cost-meter@1.9.9')
    assert.equal(built.actions.disableRows[0].patchId, 'ui-theme')
    assert.equal(built.actions.configs[0].config.preference, 'light')
    assert.ok(built.display.warnings.some((warning) => warning.includes('Workspace')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('buildPlan rejects unknown formats and versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dshsync-plan-'))
  try {
    const ctx = makeCtx(root)
    await assert.rejects(() => buildPlan(ctx, { dshHome: root, agentsHome: root }, { format: 'other' }), /Unsupported file format/)
    await assert.rejects(
      () => buildPlan(ctx, { dshHome: root, agentsHome: root }, { format: 'dshsync', version: 99 }),
      /Unsupported file version/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('conditional enablement is not replaced by a boolean toggle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dshsync-plan-'))
  const profileDir = join(root, 'profile')
  await mkdir(profileDir, { recursive: true })
  await writeFile(
    join(profileDir, 'cordis.patch.yml'),
    '- id: ui-theme\n  name: "@deepseek-ai/dsh-client-ui-theme"\n  disabled: !!js true\n',
  )
  const payload = makePayload()
  payload.profile.inserts = []
  payload.profile.configs = []
  payload.profile.settings = []
  payload.profile.bundles = []
  payload.profile.plugins = [
    {
      patchId: 'ui-theme',
      moduleName: '@deepseek-ai/dsh-client-ui-theme',
      enabled: false,
    },
  ]
  payload.profile.disabled = [{ id: 'ui-theme', name: '@deepseek-ai/dsh-client-ui-theme', disabled: { __jsExpr: 'true' } }]
  payload.skills = { skills: [] }
  payload.workspaces = []
  try {
    const built = await buildPlan(makeCtx(profileDir), {
      dshHome: join(root, 'dsh'),
      agentsHome: join(root, 'agents'),
    }, payload)
    assert.equal(built.display.summary.rowsToChange, 0)
    assert.ok(built.display.warnings.some((warning) => warning.includes('conditional enablement')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an installation-provided bundle is toggled, not reinstalled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dshsync-plan-'))
  const profileDir = join(root, 'profile')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'cordis.patch.yml'), '[]\n')
  const base = makeCtx(profileDir)
  const ctx = {
    get(name) {
      if (name !== 'pluginManager') return base.get(name)
      return {
        async listBundles() {
          return [
            {
              name: '@deepseek-ai/dsh-experimental-auto-review',
              version: '0.2.1-rc.2',
              official: true,
              availability: 'installation',
              enabled: false,
              installed: false,
              optional: true,
              removable: false,
              rows: [{ rowId: 'auto-review', moduleName: '@deepseek-ai/dsh-experimental-auto-review' }],
            },
          ]
        },
        async listPlugins() {
          return base.get('pluginManager').listPlugins()
        },
      }
    },
  }
  const payload = makePayload()
  payload.profile.bundles = [
    {
      name: '@deepseek-ai/dsh-experimental-auto-review',
      version: '0.2.1-rc.2',
      official: true,
      availability: 'installation',
      enabled: true,
      installed: false,
    },
  ]
  payload.profile.plugins = []
  payload.profile.inserts = []
  payload.profile.configs = []
  payload.profile.settings = []
  payload.skills = { skills: [] }
  payload.workspaces = []
  try {
    const built = await buildPlan(ctx, { dshHome: join(root, 'dsh'), agentsHome: join(root, 'agents') }, payload)
    assert.equal(built.display.summary.bundlesToInstall, 0)
    assert.equal(built.display.summary.bundlesToEnable, 1)
    assert.equal(built.display.warnings.some((warning) => warning.includes('not present')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
