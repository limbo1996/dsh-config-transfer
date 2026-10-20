/**
 * dsh-config-sync — Host half.
 *
 * Serves the authenticated /api/dshsync routes used by the Settings page:
 * export a portable snapshot, plan an import without changing anything, apply
 * a planned import, and report progress. Import installs bundles through
 * pluginManager, edits configuration through configEditor, and writes only
 * profile insert rows itself.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { MAX_IMPORT_BYTES } from './lib/constants.js'
import { collectSnapshot } from './lib/snapshot.js'
import { buildPlan, InputError } from './lib/plan.js'
import { runImport, retryPending } from './lib/import.js'
import { pendingCounts, readPending } from './lib/pending.js'

const ROUTES = {
  export: '/api/dshsync/export',
  plan: '/api/dshsync/plan',
  apply: '/api/dshsync/apply',
  state: '/api/dshsync/state',
}

function resolveHomes() {
  return {
    dshHome: resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh')),
    agentsHome: resolve(process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')),
  }
}

function jsonResponse(data, status = 200) {
  let body
  try {
    body = JSON.stringify(data)
  } catch (error) {
    body = JSON.stringify({ ok: false, code: 'serialization-failed', message: String(error) })
    status = 500
  }
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function failure(error, status = 400) {
  if (error instanceof InputError) {
    return jsonResponse({ ok: false, code: error.code, message: error.message }, status)
  }
  return jsonResponse(
    {
      ok: false,
      code: 'dshsync-error',
      message: error instanceof Error ? error.message : String(error),
    },
    status,
  )
}

async function readJson(request) {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_IMPORT_BYTES) {
    throw new InputError(`Import file exceeds ${Math.floor(MAX_IMPORT_BYTES / (1024 * 1024))} MiB`, 'too-large')
  }
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) {
    throw new InputError(`Import file exceeds ${Math.floor(MAX_IMPORT_BYTES / (1024 * 1024))} MiB`, 'too-large')
  }
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new InputError('Import file is not valid JSON', 'invalid-json')
  }
  return payload
}

function emptyCounts() {
  return { inserts: 0, configs: 0, settings: 0, rows: 0, total: 0 }
}

/** Host plugin entry. */
export function apply(ctx) {
  const homes = resolveHomes()
  let running = false
  let retrying = false
  let retryTimer

  let state = {
    phase: 'idle',
    startedAt: null,
    finishedAt: null,
    step: 0,
    total: 0,
    message: '',
    report: null,
    error: null,
    pending: emptyCounts(),
  }

  const update = (patch) => {
    state = { ...state, ...patch }
  }

  const refreshPending = async () => {
    const pending = await readPending(homes)
    update({ pending: pendingCounts(pending) })
    return state.pending
  }

  const scheduleRetry = (delayMs, resetAttempts = false) => {
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      if (running || retrying) {
        scheduleRetry(2000, resetAttempts)
        return
      }
      retrying = true
      void (async () => {
        try {
          const result = await retryPending(ctx, homes, { resetAttempts })
          update({ pending: result.pending === undefined ? emptyCounts() : pendingCounts(result.pending) })
        } catch (error) {
          ctx.logger?.warn?.(`dsh-config-sync: pending retry failed: ${error?.message ?? error}`)
        } finally {
          retrying = false
        }
      })()
    }, delayMs)
    retryTimer.unref?.()
  }

  void refreshPending()
  scheduleRetry(2500, true)

  ctx.effect(
    () => {
      const offChanged = ctx.on('plugin-manager/changed', () => scheduleRetry(2000))
      const offReload = ctx.on('app-boot/config-reload', () => scheduleRetry(1200))
      return () => {
        offChanged()
        offReload()
        if (retryTimer !== undefined) {
          clearTimeout(retryTimer)
          retryTimer = undefined
        }
      }
    },
    'dsh-config-sync: pending retry listeners',
  )

  const handleExport = async () => {
    if (running || retrying) {
      return jsonResponse(
        { ok: false, code: 'busy', message: 'A sync operation is already running in this Harness process.' },
        409,
      )
    }
    try {
      const { snapshot, stats, warnings } = await collectSnapshot(ctx, homes)
      return jsonResponse({
        ok: true,
        snapshot,
        stats,
        warnings,
        redactionCount: stats.redactions,
      })
    } catch (error) {
      ctx.logger?.warn?.(`dsh-config-sync: export failed: ${error?.message ?? error}`)
      return failure(error, 500)
    }
  }

  const handlePlan = async (request) => {
    try {
      const payload = await readJson(request)
      const built = await buildPlan(ctx, homes, payload)
      return jsonResponse({ ok: true, plan: built.display })
    } catch (error) {
      return failure(error)
    }
  }

  const handleApply = async (request) => {
    if (running || retrying) {
      return jsonResponse(
        { ok: false, code: 'busy', message: 'A sync operation is already running in this Harness process.' },
        409,
      )
    }
    running = true
    try {
      const payload = await readJson(request)
      const built = await buildPlan(ctx, homes, payload)
      update({
        phase: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        step: 0,
        total: 0,
        message: 'Preparing import',
        report: null,
        error: null,
      })
      void (async () => {
        try {
          const report = await runImport(ctx, homes, built, (progress) => {
            update({
              step: progress.step,
              total: progress.total,
              message: progress.message,
            })
          })
          update({
            phase: 'done',
            finishedAt: new Date().toISOString(),
            report,
            message: 'Import finished',
          })
        } catch (error) {
          ctx.logger?.warn?.(`dsh-config-sync: import failed: ${error?.message ?? error}`)
          update({
            phase: 'error',
            finishedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
            message: 'Import failed',
          })
        } finally {
          running = false
          await refreshPending().catch(() => undefined)
        }
      })()
      return jsonResponse({ ok: true, started: true, plan: built.display })
    } catch (error) {
      running = false
      return failure(error)
    }
  }

  const handleState = async () => {
    await refreshPending().catch(() => undefined)
    return jsonResponse({ ok: true, state })
  }

  ctx.inject(['connection'], (connected) => {
    const disposers = [
      connected.connection.fetch.register({
        path: ROUTES.export,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: () => handleExport(),
      }),
      connected.connection.fetch.register({
        path: ROUTES.plan,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => handlePlan(request),
      }),
      connected.connection.fetch.register({
        path: ROUTES.apply,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => handleApply(request),
      }),
      connected.connection.fetch.register({
        path: ROUTES.state,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: () => handleState(),
      }),
    ]
    connected.effect(
      () => () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            // Already disposed with the owning context.
          }
        }
      },
      'dsh-config-sync: route disposal',
    )
  })
}
