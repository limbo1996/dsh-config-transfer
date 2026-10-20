/**
 * Execute a reviewed import plan.
 *
 * Order matters: install packages first, write structural insert rows next,
 * then apply row enablement and configuration, and finally user skills.
 * Anything that cannot be applied yet is left in the durable pending queue.
 */

import { setTimeout as delay } from 'node:timers/promises'
import { applyInsertRows, commitPatchDocument, loadPatchDocument } from './patch.js'
import { applySkills } from './skills.js'
import { isDeepStrictEqual } from 'node:util'
import { preserveSecretFields, restoreRedacted } from './sanitize.js'
import { clearPending, pendingCounts, readPending, writePending } from './pending.js'

function isTransientError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return /no longer available|changed during reload|no longer active|not active|waiting for|not found|unknown-plugin|no such entry/iu.test(
    message,
  )
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function describeChange(result) {
  if (result === undefined || result === null) return 'applied'
  if (result.application === 'failed') return 'failed'
  if (result.application === 'overridden') return 'overridden'
  if (result.application === 'restart-required') return 'restart-required'
  if (result.application === 'cancelled') return 'cancelled'
  return 'applied'
}

function describeFailure(result) {
  if (result?.error === undefined || result.error === null) return undefined
  return {
    code: result.error.code ?? 'failed',
    diagnostic: result.error.diagnostic ?? null,
  }
}

function mergePending(pending) {
  return {
    inserts: [...pending.inserts],
    configs: [...pending.configs],
    settings: [...pending.settings],
    rows: [...pending.rows],
  }
}

function dedupe(list, keyOf) {
  const map = new Map()
  for (const item of list) {
    const key = keyOf(item)
    if (key === undefined) continue
    map.set(key, item)
  }
  return [...map.values()]
}

function configPendingKey(config) {
  if (typeof config?.id === 'string') return config.id
  if (typeof config?.name === 'string') return `name:${config.name}`
  return undefined
}

function rowPendingKey(row) {
  if (typeof row?.patchId === 'string') return row.patchId
  if (typeof row?.moduleName === 'string') return `module:${row.moduleName}`
  return undefined
}

function compactPending(pending) {
  return {
    inserts: dedupe(pending.inserts, (row) => (typeof row?.id === 'string' ? row.id : undefined)),
    configs: dedupe(pending.configs, configPendingKey),
    settings: dedupe(pending.settings, (setting) => (typeof setting?.ns === 'string' ? setting.ns : undefined)),
    rows: dedupe(pending.rows, rowPendingKey),
  }
}

function indexConfiguration(configEditor) {
  const items = configEditor.configuration().map((item) => ({
    entry: item.entry,
    id: item.entry?.options?.id,
    name: item.entry?.options?.name,
    override: item.override,
  }))
  const byId = new Map(items.filter((item) => typeof item.id === 'string').map((item) => [item.id, item]))
  const byName = new Map()
  for (const item of items) {
    if (typeof item.name !== 'string') continue
    if (byName.has(item.name)) byName.delete(item.name)
    else byName.set(item.name, item)
  }
  return { items, byId, byName }
}

function findEntry(index, id, name) {
  if (typeof id === 'string') {
    const byId = index.byId.get(id)
    if (byId !== undefined) return byId
  }
  if (typeof name === 'string') return index.byName.get(name)
  return undefined
}

async function applyInsertBatch(ctx, profile, rows) {
  if (rows.length === 0) return { changed: 0, conflicts: [], live: false }
  const document = await loadPatchDocument(profile.patchPath)
  const result = await applyInsertRows(document, rows)
  if (result.changed === 0) return { changed: 0, conflicts: result.conflicts, live: false }
  const committed = await commitPatchDocument(ctx, profile.patchPath, document)
  return { changed: result.changed, conflicts: result.conflicts, live: committed.live }
}

async function applyPendingConfig(configEditor, config) {
  const index = indexConfiguration(configEditor)
  const entry = findEntry(index, config.id, config.name)
  if (entry === undefined) return { status: 'pending', reason: 'entry-not-live' }
  const currentOverride = entry.override ?? {}
  const next = preserveSecretFields(
    restoreRedacted(config.config ?? {}, Array.isArray(config.redacted) ? config.redacted : [], currentOverride),
    currentOverride,
  )
  if (isDeepStrictEqual(next, currentOverride)) return { status: 'applied', changed: false }
  try {
    await configEditor.edit(entry.entry, () => structuredClone(next))
    return { status: 'applied', changed: true }
  } catch (error) {
    return {
      status: isTransientError(error) ? 'pending' : 'failed',
      reason: errorText(error),
    }
  }
}

async function applyPendingSetting(settings, setting) {
  const descriptors = settings.describe({ redactSecrets: true })
  const descriptor = (Array.isArray(descriptors) ? descriptors : []).find(
    (item) => item?.ns === setting.ns,
  )
  if (descriptor === undefined) return { status: 'pending', reason: 'namespace-not-live' }
  const current = descriptor.user !== null && typeof descriptor.user === 'object' ? descriptor.user : {}
  const next = preserveSecretFields(
    restoreRedacted(setting.user ?? {}, Array.isArray(setting.redacted) ? setting.redacted : [], current),
    current,
  )
  if (isDeepStrictEqual(next, current)) return { status: 'applied', changed: false }
  try {
    await settings.update(setting.ns, structuredClone(next), descriptor.revision)
    return { status: 'applied', changed: true }
  } catch (error) {
    return {
      status: isTransientError(error) ? 'pending' : 'failed',
      reason: errorText(error),
    }
  }
}

async function applyPendingRow(pluginManager, row) {
  if (typeof row.patchId !== 'string') return { status: 'failed', reason: 'row-not-addressable' }
  try {
    const result = await pluginManager.setPluginEnabled(row.patchId, row.enabled === true)
    const outcome = describeChange(result)
    if (outcome === 'failed') {
      return { status: 'failed', reason: describeFailure(result)?.diagnostic ?? 'failed' }
    }
    return { status: 'applied', changed: result?.changed !== false, outcome }
  } catch (error) {
    return {
      status: isTransientError(error) ? 'pending' : 'failed',
      reason: errorText(error),
    }
  }
}

/**
 * Attempt every queued action once. Used at activation and after a reload.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ dshHome: string, agentsHome: string }} homes
 * @param {{ resetAttempts?: boolean }} [options]
 */
export async function retryPending(ctx, homes, options = {}) {
  const existing = await readPending(homes)
  if (existing === undefined) return { pending: undefined, applied: 0, failed: 0 }
  const attempts = options.resetAttempts === true ? 0 : (existing.attempts ?? 0) + 1
  if (attempts > 8) return { pending: existing, applied: 0, failed: 0, suspended: true }

  const remaining = { inserts: [], configs: [], settings: [], rows: [] }
  let applied = 0
  let failed = 0

  const profile = ctx.get('profileContext')
  if (existing.inserts.length > 0 && profile !== undefined) {
    try {
      const result = await applyInsertBatch(ctx, profile, existing.inserts)
      if (result.conflicts.length > 0) {
        failed += result.conflicts.length
        remaining.inserts = existing.inserts.filter((row) => result.conflicts.every((conflict) => conflict.id !== row.id))
      } else {
        applied += result.changed
      }
    } catch (error) {
      remaining.inserts = existing.inserts
    }
  }

  const pluginManager = ctx.get('pluginManager')
  if (existing.rows.length > 0 && pluginManager !== undefined) {
    for (const row of existing.rows) {
      const result = await applyPendingRow(pluginManager, row)
      if (result.status === 'applied') applied += 1
      else if (result.status === 'failed') failed += 1
      else remaining.rows.push(row)
    }
  } else {
    remaining.rows = existing.rows
  }

  const configEditor = ctx.get('configEditor')
  if (existing.configs.length > 0 && configEditor !== undefined) {
    for (const config of existing.configs) {
      const result = await applyPendingConfig(configEditor, config)
      if (result.status === 'applied') applied += 1
      else if (result.status === 'failed') failed += 1
      else remaining.configs.push(config)
    }
  } else {
    remaining.configs = existing.configs
  }

  const settings = ctx.get('settings')
  if (existing.settings.length > 0 && settings !== undefined) {
    for (const setting of existing.settings) {
      const result = await applyPendingSetting(settings, setting)
      if (result.status === 'applied') applied += 1
      else if (result.status === 'failed') failed += 1
      else remaining.settings.push(setting)
    }
  } else {
    remaining.settings = existing.settings
  }

  const compacted = compactPending(remaining)
  const counts = pendingCounts(compacted)
  if (counts.total === 0) {
    await clearPending(homes)
    return { pending: undefined, applied, failed, total: 0 }
  }
  await writePending(homes, { ...compacted, attempts })
  return { pending: { ...compacted, attempts }, applied, failed, total: counts.total }
}

/**
 * Execute a plan.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ dshHome: string, agentsHome: string }} homes
 * @param {Awaited<ReturnType<import('./plan.js').buildPlan>>} built
 * @param {(progress: { step: number, total: number, message: string }) => void} progress
 */
export async function runImport(ctx, homes, built, progress) {
  const { actions, input } = built
  const report = {
    installed: [],
    failedInstalls: [],
    bundleChanges: [],
    rowChanges: [],
    insertsWritten: [],
    configsApplied: [],
    configsFailed: [],
    settingsApplied: [],
    settingsFailed: [],
    skills: { written: [], skipped: [], failed: [] },
    pending: { inserts: 0, configs: 0, settings: 0, rows: 0, total: 0 },
    manual: [...(built.display?.manual ?? [])],
    conflicts: [...(built.display?.conflicts ?? [])],
    warnings: [...(built.display?.warnings ?? [])],
    restartRequired: false,
    source: built.display?.source ?? {},
  }

  const total =
    actions.installs.length +
    actions.enableBundles.length +
    actions.disableBundles.length +
    (actions.inserts.length > 0 ? 1 : 0) +
    actions.enableRows.length +
    actions.disableRows.length +
    actions.configs.length +
    actions.settings.length +
    actions.skills.length +
    1
  let step = 0
  const tick = (message) => {
    step += 1
    progress({ step, total, message })
  }

  const pluginManager = ctx.get('pluginManager')
  const configEditor = ctx.get('configEditor')
  const settings = ctx.get('settings')
  const profile = ctx.get('profileContext')
  if (profile === undefined) throw new Error('profileContext is unavailable in this composition')

  const pending = mergePending(actions.pending)

  // 1. Installs -------------------------------------------------------------
  if (actions.installs.length > 0 && pluginManager === undefined) {
    report.failedInstalls.push({
      name: '*',
      error: 'pluginManager-unavailable',
      diagnostic: 'This composition cannot install plugins.',
    })
  }
  for (const install of actions.installs) {
    if (pluginManager === undefined) break
    tick(`Installing ${install.name}@${install.version ?? 'latest'}`)
    try {
      const result = await pluginManager.installBundle(install.spec, {
        enabled: install.enabled !== false,
        saveExact: true,
      })
      const outcome = describeChange(result)
      report.installed.push({
        name: install.name,
        spec: install.spec,
        version: result?.version ?? install.version ?? null,
        application: outcome,
        warnings: Array.isArray(result?.warnings) ? result.warnings : [],
      })
      if (outcome === 'failed') {
        report.failedInstalls.push({
          name: install.name,
          error: describeFailure(result)?.code ?? 'failed',
          diagnostic: describeFailure(result)?.diagnostic ?? null,
        })
      }
      if (outcome === 'restart-required') report.restartRequired = true
      if (Array.isArray(result?.pendingBuilds) && result.pendingBuilds.length > 0) {
        report.manual.push({
          kind: 'build-approval',
          name: install.name,
          detail: `Build scripts need approval: ${result.pendingBuilds.join(', ')}`,
        })
      }
    } catch (error) {
      report.failedInstalls.push({ name: install.name, error: errorText(error), diagnostic: null })
    }
  }
  if (actions.installs.length > 0) await delay(600)

  // 2. Bundle enablement ----------------------------------------------------
  if (pluginManager !== undefined) {
    for (const name of actions.enableBundles) {
      tick(`Enabling bundle ${name}`)
      try {
        const result = await pluginManager.setBundleEnabled(name, true)
        const outcome = describeChange(result)
        report.bundleChanges.push({ name, enabled: true, outcome })
        if (result?.application === 'restart-required') report.restartRequired = true
        if (outcome === 'failed') {
          report.warnings.push(`Bundle ${name} could not be enabled`)
        } else if (outcome === 'overridden') {
          report.warnings.push(`Bundle ${name} is overridden by a higher layer`)
        }
      } catch (error) {
        report.warnings.push(`Cannot enable bundle ${name}: ${errorText(error)}`)
      }
    }
    for (const name of actions.disableBundles) {
      tick(`Disabling bundle ${name}`)
      try {
        const result = await pluginManager.setBundleEnabled(name, false)
        const outcome = describeChange(result)
        report.bundleChanges.push({ name, enabled: false, outcome })
        if (result?.application === 'restart-required') report.restartRequired = true
        if (outcome === 'failed') {
          report.warnings.push(`Bundle ${name} could not be disabled`)
        } else if (outcome === 'overridden') {
          report.warnings.push(`Bundle ${name} is overridden by a higher layer`)
        }
      } catch (error) {
        report.warnings.push(`Cannot disable bundle ${name}: ${errorText(error)}`)
      }
    }
  }

  // 3. Structural insert rows ----------------------------------------------
  if (actions.inserts.length > 0) {
    tick(`Writing ${actions.inserts.length} inserted plugin entr${actions.inserts.length === 1 ? 'y' : 'ies'}`)
    try {
      const result = await applyInsertBatch(ctx, profile, actions.inserts)
      report.insertsWritten = actions.inserts
        .filter((row) => result.conflicts.every((conflict) => conflict.id !== row.id))
        .map((row) => ({ id: row.id, name: row.name }))
      report.conflicts.push(...result.conflicts.map((conflict) => ({ kind: 'insert', ...conflict })))
      if (!result.live && result.changed > 0) report.restartRequired = true
      if (result.changed > 0) await delay(800)
    } catch (error) {
      pending.inserts = actions.inserts
      report.warnings.push(`Cannot write inserted plugin entries: ${errorText(error)}`)
    }
  }

  // 4. Row enablement -------------------------------------------------------
  if (pluginManager !== undefined) {
    for (const row of [...actions.enableRows, ...actions.disableRows]) {
      tick(`${row.enabled ? 'Enabling' : 'Disabling'} plugin ${row.moduleName}`)
      try {
        const result = await pluginManager.setPluginEnabled(row.patchId, row.enabled)
        const outcome = describeChange(result)
        report.rowChanges.push({ ...row, outcome })
        if (result?.application === 'restart-required') report.restartRequired = true
        if (outcome === 'failed') {
          report.warnings.push(`Plugin ${row.moduleName} could not be toggled`)
        } else if (outcome === 'overridden') {
          report.warnings.push(`Plugin ${row.moduleName} is overridden by a higher layer`)
        }
      } catch (error) {
        pending.rows.push(row)
        report.warnings.push(`Cannot change ${row.moduleName}: ${errorText(error)}`)
      }
    }
  } else {
    pending.rows.push(...actions.enableRows, ...actions.disableRows)
  }

  // 5. Configuration --------------------------------------------------------
  if (actions.configs.length > 0 && configEditor !== undefined) {
    let index = indexConfiguration(configEditor)
    for (const config of actions.configs) {
      tick(`Applying settings for ${config.name ?? config.id}`)
      const entry = findEntry(index, config.id, config.name)
      if (entry === undefined) {
        pending.configs.push(config)
        continue
      }
      const currentOverride = entry.override ?? {}
      const next = preserveSecretFields(
        restoreRedacted(
          config.config ?? {},
          Array.isArray(config.redacted) ? config.redacted : [],
          currentOverride,
        ),
        currentOverride,
      )
      if (isDeepStrictEqual(next, currentOverride)) {
        report.configsApplied.push({ id: config.id, name: config.name, changed: false })
        continue
      }
      try {
        await configEditor.edit(entry.entry, () => structuredClone(next))
        report.configsApplied.push({ id: config.id, name: config.name, changed: true })
      } catch (error) {
        if (isTransientError(error)) {
          pending.configs.push(config)
          index = indexConfiguration(configEditor)
        } else {
          report.configsFailed.push({ id: config.id, name: config.name, error: errorText(error) })
        }
      }
    }
  } else if (actions.configs.length > 0) {
    pending.configs.push(...actions.configs)
    report.warnings.push('configEditor is unavailable; configuration was queued for later')
  }

  // 6. Settings namespaces --------------------------------------------------
  if (actions.settings.length > 0 && settings !== undefined) {
    for (const setting of actions.settings) {
      tick(`Applying settings namespace ${setting.ns}`)
      try {
        const result = await applyPendingSetting(settings, setting)
        if (result.status === 'applied') {
          report.settingsApplied.push({ ns: setting.ns, changed: result.changed === true })
        } else if (result.status === 'pending') {
          pending.settings.push(setting)
        } else {
          report.settingsFailed.push({ ns: setting.ns, error: result.reason ?? 'failed' })
        }
      } catch (error) {
        if (isTransientError(error)) pending.settings.push(setting)
        else report.settingsFailed.push({ ns: setting.ns, error: errorText(error) })
      }
    }
  } else if (actions.settings.length > 0) {
    pending.settings.push(...actions.settings)
    report.warnings.push('settings service is unavailable; settings namespaces were queued for later')
  }

  // 7. Skills ---------------------------------------------------------------
  if (actions.skills.length > 0) {
    tick(`Importing ${actions.skills.length} user skill${actions.skills.length === 1 ? '' : 's'}`)
    try {
      report.skills = await applySkills(homes, actions.skills)
    } catch (error) {
      report.skills.failed.push({ name: '*', reason: errorText(error) })
    }
  }

  // 8. Persist anything still queued ---------------------------------------
  const compacted = compactPending(pending)
  const counts = pendingCounts(compacted)
  tick('Finishing')
  if (counts.total > 0) {
    await writePending(homes, { ...compacted, attempts: 0 })
    // Give HMR one chance to publish entries the import just created, then
    // apply whatever is now reachable. Anything left stays queued for restart.
    const retried = await retryPending(ctx, homes, { resetAttempts: true }).catch(() => undefined)
    if (retried === undefined) {
      report.pending = counts
    } else if (retried.pending === undefined) {
      report.pending = { inserts: 0, configs: 0, settings: 0, rows: 0, total: 0 }
    } else {
      report.pending = pendingCounts(retried.pending)
    }
    report.restartRequired = report.pending.total > 0 || report.restartRequired
  } else {
    await clearPending(homes)
    report.pending = counts
  }

  report.exportedAt = input.source?.exportedAt ?? null
  return report
}
