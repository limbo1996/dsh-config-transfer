import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../index.js'

function makeServices(profileDir) {
  return {
    profileContext: { dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml') },
    pluginManager: {
      async listBundles() {
        return []
      },
      async listPlugins() {
        return []
      },
    },
    configEditor: {
      configuration() {
        return [
          {
            entry: {
              options: { id: 'ui-theme', name: '@deepseek-ai/dsh-client-ui-theme' },
            },
            override: { preference: 'dark', apiKey: 'sk-abcdefghijklmnopqrstuvwxyz' },
            inherited: {},
          },
        ]
      },
    },
    settings: {
      describe() {
        return []
      },
    },
    workspaceRegistry: {
      list() {
        return []
      },
    },
  }
}

function makeCtx(services, routes) {
  const ctx = {
    get(name) {
      return services[name]
    },
    inject(_deps, callback) {
      callback({
        connection: {
          fetch: {
            register(route) {
              routes.set(route.path, route)
              return () => routes.delete(route.path)
            },
          },
        },
        effect(callback) {
          const dispose = callback()
          return typeof dispose === 'function' ? dispose : () => undefined
        },
        get: ctx.get,
      })
      return () => undefined
    },
    effect(callback) {
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => undefined
    },
    on() {
      return () => undefined
    },
    logger: { warn() {} },
  }
  return ctx
}

test('host registers all routes and exports a redacted snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dshsync-index-'))
  const profileDir = join(root, 'profile')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'cordis.patch.yml'), '[]\n')
  await writeFile(join(profileDir, 'package.json'), '{"name":"dsh-profile-desktop"}')
  const previousHome = process.env.DSH_HOME
  const previousAgents = process.env.DSH_AGENTS_HOME
  process.env.DSH_HOME = join(root, 'dsh')
  process.env.DSH_AGENTS_HOME = join(root, 'agents')
  const routes = new Map()
  try {
    const services = makeServices(profileDir)
    apply(makeCtx(services, routes))
    assert.deepEqual(
      [...routes.keys()].sort(),
      ['/api/dshsync/apply', '/api/dshsync/export', '/api/dshsync/plan', '/api/dshsync/state'],
    )
    const response = await routes
      .get('/api/dshsync/export')
      .fetch(new Request('http://127.0.0.1/api/dshsync/export'))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.ok, true)
    assert.equal(body.snapshot.format, 'dshsync')
    assert.equal(body.snapshot.profile.configs[0].config.apiKey, undefined)
    assert.ok(body.snapshot.profile.configs[0].redacted.length > 0)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (previousAgents === undefined) delete process.env.DSH_AGENTS_HOME
    else process.env.DSH_AGENTS_HOME = previousAgents
    await rm(root, { recursive: true, force: true })
  }
})

test('plan route validates malformed input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dshsync-index-'))
  const profileDir = join(root, 'profile')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'cordis.patch.yml'), '[]\n')
  await writeFile(join(profileDir, 'package.json'), '{"name":"dsh-profile-desktop"}')
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(root, 'dsh')
  const routes = new Map()
  try {
    apply(makeCtx(makeServices(profileDir), routes))
    const response = await routes.get('/api/dshsync/plan').fetch(
      new Request('http://127.0.0.1/api/dshsync/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'other' }),
      }),
    )
    assert.equal(response.status, 400)
    const body = await response.json()
    assert.equal(body.ok, false)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
})
