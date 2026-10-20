/**
 * Turn an exported snapshot into a concrete, reviewable import plan.
 *
 * Planning is read-only. The displayed plan deliberately omits configuration
 * values; apply re-reads the snapshot and performs the same analysis.
 */

import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { FORMAT, FORMAT_VERSION } from './constants.js'
import { isPortablePluginName, loadPatchDocument, patchInsertRows } from './patch.js'
import { isEmptyValue, preserveSecretFields, restoreRedacted, stripDangerousKeys } from './sanitize.js'

const LIMITS = {
  bundles: 500,
  plugins: 2000,
  inserts: 200,
  configs: 1000,
  settings: 500,
  skills: 200,
}

export class InputError extends Error {
  constructor(message, code = 'invalid-import') {
    super(message)
    this.name = 'InputError'
    this.code = code
  }
}

function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function asString(value) {
  return typeof value === 'string' ? value : undefined
}

function dedupeBy(items, keyOf) {
  const map = new Map()
  for (const item of items) {
    const key = keyOf(item)
    if (key === undefined) continue
    map.set(key, item)
  }
  return [...map.values()]
}

function uniqueBy(items, key) {
  const map = new Map()
  const duplicates = new Set()
  for (const item of items) {
    const value = item[key]
    if (typeof value !== 'string') continue
    if (map.has(value)) duplicates.add(value)
    else map.set(value, item)
  }
  for (const duplicate of duplicates) map.delete(duplicate)
  return map
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

/** Validate the envelope and normalize the parts the plan reads. */
export function validateSnapshot(rawPayload) {
  const payload = stripDangerousKeys(rawPayload)
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new InputError('Import file must contain a JSON object')
  }
  if (payload.format !== FORMAT) {
    throw new InputError(`Unsupported file format: ${String(payload.format)}`)
  }
  if (payload.version !== FORMAT_VERSION) {
    throw new InputError(`Unsupported file version: ${String(payload.version)}`)
  }
  const profile = asObject(payload.profile)
  if (profile === undefined) throw new InputError('Import file has no profile section')

  const bundles = asArray(profile.bundles).slice(0, LIMITS.bundles)
  const plugins = asArray(profile.plugins).slice(0, LIMITS.plugins)
  const inserts = asArray(profile.inserts).slice(0, LIMITS.inserts)
  const configs = asArray(profile.configs).slice(0, LIMITS.configs)
  const settings = asArray(profile.settings).slice(0, LIMITS.settings)
  const skills = asArray(asObject(payload.skills)?.skills).slice(0, LIMITS.skills)
  const workspaces = asArray(payload.workspaces)

  return {
    source: { ...asObject(payload.source), exportedAt: asString(payload.exportedAt) ?? undefined },
    profile: {
      name: asString(profile.name),
      bundleOrder: asArray(profile.bundleOrder).filter((name) => typeof name === 'string'),
      dependencies: asObject(profile.dependencies) ?? {},
      bundles,
      plugins,
      inserts,
      disabled: asArray(profile.disabled),
      configs,
      settings,
    },
    skills,
    workspaces,
  }
}

function currentBundleMap(bundles) {
  return new Map(bundles.map((bundle) => [bundle.name, bundle]))
}

function installSpecFor(bundle) {
  const target = asObject(bundle.installTarget)
  const spec = asString(target?.spec)
  if (spec !== undefined && spec.length > 0) {
    if (
      spec.startsWith('link:') ||
      spec.startsWith('file:') ||
      spec.startsWith('.') ||
      spec.startsWith('/') ||
      /^[A-Za-z]:[\\/]/u.test(spec)
    ) {
      return undefined
    }
    if (
      spec.startsWith('git+') ||
      spec.startsWith('git:') ||
      spec.startsWith('github:') ||
      spec.startsWith('gitlab:') ||
      spec.startsWith('bitbucket:') ||
      spec.includes('://') ||
      spec.endsWith('.tgz') ||
      spec.endsWith('.tar.gz')
    ) {
      return spec
    }
    const lastAt = spec.lastIndexOf('@')
    if (lastAt > 0) return spec
    return bundle.version ? `${spec}@${bundle.version}` : spec
  }
  if (bundle.official === true || bundle.availability === 'installation') return undefined
  if (bundle.installed === true) return undefined
  if (bundle.name === undefined) return undefined
  return bundle.version ? `${bundle.name}@${bundle.version}` : bundle.name
}

function rowConfigFromInsert(row) {
  if (row === null || typeof row !== 'object') return undefined
  const config = asObject(row.config)
  return config
}

function sameInsertRow(existing, imported) {
  for (const field of ['config', 'disabled', 'inject', 'intercept', 'isolate', 'group']) {
    if (!isDeepStrictEqual(existing[field], imported[field])) return false
  }
  return true
}

function matchConfigEntry(config, byId, byName) {
  const id = asString(config.id)
  if (id !== undefined) {
    const entry = byId.get(id)
    if (entry !== undefined) return entry
  }
  const name = asString(config.name)
  if (name !== undefined) return byName.get(name)
  return undefined
}

function containsAbsolutePath(value, depth = 0) {
  if (depth > 12) return false
  if (typeof value === 'string') return /^(?:\/(?:Users|home|opt|var|private|tmp|etc)\/|[A-Za-z]:[\\/])/u.test(value)
  if (Array.isArray(value)) return value.some((entry) => containsAbsolutePath(entry, depth + 1))
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((entry) => containsAbsolutePath(entry, depth + 1))
  }
  return false
}

function describeSource(source) {
  return {
    profile: asString(source.profile) ?? null,
    platform: asString(source.platform) ?? null,
    node: asString(source.node) ?? null,
    exportedAt: asString(source.exportedAt) ?? null,
  }
}

/**
 * Build the plan for an import.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ dshHome: string, agentsHome: string }} homes
 * @param {unknown} payload
 */
export async function buildPlan(ctx, homes, payload) {
  const input = validateSnapshot(payload)
  const warnings = []
  const manual = []
  const conflicts = []
  const sourcePlatform = asString(input.source.platform)
  if (sourcePlatform !== undefined && sourcePlatform !== process.platform) {
    warnings.push(
      `The file was exported on ${sourcePlatform}; this machine is ${process.platform}. Absolute paths in plugin settings may need adjustment.`,
    )
  }
  if (
    containsAbsolutePath(input.profile.configs) ||
    containsAbsolutePath(input.profile.inserts) ||
    containsAbsolutePath(input.profile.settings)
  ) {
    warnings.push('The file contains absolute paths; verify commands, working directories, and file paths on this machine')
  }
  const pluginManager = ctx.get('pluginManager')
  const configEditor = ctx.get('configEditor')
  const settingsService = ctx.get('settings')
  const profile = ctx.get('profileContext')
  if (profile === undefined) throw new Error('profileContext is unavailable in this composition')

  let currentBundles = []
  if (pluginManager !== undefined) {
    try {
      currentBundles = await pluginManager.listBundles()
    } catch (error) {
      warnings.push(`Cannot read installed bundles: ${error.message}`)
    }
  } else {
    warnings.push('pluginManager is unavailable; plugins cannot be installed')
  }
  let currentPlugins = []
  if (pluginManager !== undefined) {
    try {
      currentPlugins = await pluginManager.listPlugins()
    } catch (error) {
      warnings.push(`Cannot read current plugins: ${error.message}`)
    }
  }

  let configuration = []
  if (configEditor !== undefined) {
    try {
      configuration = configEditor.configuration().map((item) => ({
        entry: item.entry,
        id: item.entry?.options?.id,
        name: item.entry?.options?.name,
        override: item.override,
      }))
    } catch (error) {
      warnings.push(`Cannot read current configuration: ${error.message}`)
    }
  } else {
    warnings.push('configEditor is unavailable; plugin configuration cannot be applied')
  }
  const entriesById = new Map(
    configuration.filter((item) => typeof item.id === 'string').map((item) => [item.id, item]),
  )
  const entriesByName = uniqueBy(
    configuration.filter((item) => typeof item.name === 'string'),
    'name',
  )

  let currentSettings = []
  if (settingsService !== undefined) {
    try {
      currentSettings = settingsService.describe({ redactSecrets: true })
    } catch (error) {
      warnings.push(`Cannot read settings namespaces: ${error.message}`)
    }
  }
  const settingsByNs = new Map(
    (Array.isArray(currentSettings) ? currentSettings : [])
      .filter((descriptor) => typeof descriptor?.ns === 'string')
      .map((descriptor) => [descriptor.ns, descriptor]),
  )

  let patchInserts = []
  try {
    const document = await loadPatchDocument(profile.patchPath)
    patchInserts = await patchInsertRows(document)
  } catch (error) {
    warnings.push(`Cannot read profile patch: ${error.message}`)
  }
  const patchInsertById = new Map(patchInserts.map((row) => [row.id, row]))

  const bundleByName = currentBundleMap(currentBundles)
  const pluginByPatchId = new Map(
    currentPlugins.filter((plugin) => typeof plugin.patchId === 'string').map((plugin) => [plugin.patchId, plugin]),
  )
  const pluginByModule = uniqueBy(
    currentPlugins.filter((plugin) => typeof plugin.moduleName === 'string'),
    'moduleName',
  )
  const conditionalDisabled = new Map()
  for (const row of input.profile.disabled) {
    if (row === null || typeof row !== 'object') continue
    if (typeof row.id !== 'string') continue
    if (row.disabled === null || typeof row.disabled === 'boolean') continue
    conditionalDisabled.set(row.id, row.disabled)
  }

  const actions = {
    installs: [],
    enableBundles: [],
    disableBundles: [],
    enableRows: [],
    disableRows: [],
    inserts: [],
    configs: [],
    settings: [],
    skills: [],
    pending: { configs: [], settings: [], rows: [], inserts: [] },
  }

  // Bundles -----------------------------------------------------------------
  for (const bundle of input.profile.bundles) {
    const name = asString(bundle.name)
    if (name === undefined || name.length === 0) continue
    const current = bundleByName.get(name)
    const wantedEnabled = typeof bundle.enabled === 'boolean' ? bundle.enabled : undefined
    const missing =
      current === undefined ||
      current.availability === 'missing' ||
      (current.installed === false && current.availability === 'profile')
    if (missing) {
      if (current === undefined && (bundle.official === true || bundle.availability === 'installation')) {
        warnings.push(`Built-in bundle ${name} is not present on this machine`)
        continue
      }
      const spec = installSpecFor(bundle)
      if (spec === undefined) {
        manual.push({
          kind: 'install',
          name,
          detail: `Local or linked package${bundle.installTarget?.spec ? ` (${bundle.installTarget.spec})` : ''}; install it manually on this machine.`,
        })
        continue
      }
      actions.installs.push({
        name,
        spec,
        version: bundle.version ?? null,
        enabled: wantedEnabled !== false,
      })
      continue
    }
    if (wantedEnabled !== undefined && current.enabled !== wantedEnabled) {
      if (wantedEnabled) actions.enableBundles.push(name)
      else actions.disableBundles.push(name)
    }
    if (
      typeof bundle.version === 'string' &&
      typeof current.version === 'string' &&
      bundle.version.length > 0 &&
      current.version.length > 0 &&
      bundle.version !== current.version
    ) {
      warnings.push(`Bundle ${name} is ${current.version} here but ${bundle.version} on the source machine`)
    }
  }

  // Insert rows -------------------------------------------------------------
  const insertIds = new Set()
  for (const row of input.profile.inserts) {
    const id = asString(row.id)
    const name = asString(row.name)
    if (id === undefined || name === undefined) continue
    insertIds.add(id)
    const portable = row.portable !== false && isPortablePluginName(name)
    if (!portable) {
      manual.push({
        kind: 'insert',
        name: id,
        detail: `Plugin ${name} is a local path; recreate this entry manually.`,
      })
      continue
    }
    const existingPatchRow = patchInsertById.get(id)
    if (existingPatchRow !== undefined) {
      if (existingPatchRow.name !== name) {
        conflicts.push({ kind: 'insert', id, detail: `Existing entry uses ${existingPatchRow.name}` })
        continue
      }
      if ((existingPatchRow.group === true) !== (row.group === true)) {
        conflicts.push({ kind: 'insert', id, detail: 'The existing entry and the imported entry use different group structure' })
        continue
      }
      const existingConfig = asObject(existingPatchRow.config) ?? {}
      const restored = {
        ...row,
        config: preserveSecretFields(
          restoreRedacted(asObject(row.config) ?? {}, asArray(row.redacted), existingConfig),
          existingConfig,
        ),
      }
      if (!sameInsertRow(existingPatchRow, restored)) actions.inserts.push(restored)
      continue
    }
    const currentEntry = entriesById.get(id)
    if (currentEntry !== undefined) {
      if (currentEntry.name !== name) {
        conflicts.push({ kind: 'insert', id, detail: `Entry id is used by ${currentEntry.name}` })
        continue
      }
      const config = rowConfigFromInsert(row)
      if (config !== undefined && !isEmptyValue(config)) {
        const currentOverride = currentEntry.override ?? {}
        if (!isDeepStrictEqual(restoreRedacted(config, row.redacted, currentOverride), currentOverride)) {
          actions.configs.push({
            id,
            name,
            config,
            redacted: asArray(row.redacted),
          })
        }
      }
      continue
    }
    actions.inserts.push(row)
  }

  // Configs -----------------------------------------------------------------
  for (const config of input.profile.configs) {
    const id = asString(config.id)
    const name = asString(config.name)
    if (id === undefined && name === undefined) continue
    if (id !== undefined && insertIds.has(id)) continue
    if (id !== undefined && patchInsertById.has(id)) continue
    const value = asObject(config.config)
    if (value === undefined) continue
    const entry = matchConfigEntry(config, entriesById, entriesByName)
    if (entry === undefined) {
      actions.pending.configs.push({
        id: id ?? null,
        name: name ?? null,
        config: value,
        redacted: asArray(config.redacted),
      })
      continue
    }
    const currentOverride = entry.override ?? {}
    const next = restoreRedacted(value, asArray(config.redacted), currentOverride)
    if (isDeepStrictEqual(next, currentOverride)) continue
    actions.configs.push({
      id: entry.id,
      name: entry.name,
      config: value,
      redacted: asArray(config.redacted),
    })
  }

  // Settings namespaces -----------------------------------------------------
  const configIds = new Set(actions.configs.map((config) => config.id))
  for (const namespace of input.profile.settings) {
    const ns = asString(namespace.ns)
    if (ns === undefined || ns.length === 0) continue
    if (configIds.has(ns) || insertIds.has(ns) || patchInsertById.has(ns)) continue
    const user = asObject(namespace.user)
    if (user === undefined || isEmptyValue(user)) continue
    const descriptor = settingsByNs.get(ns)
    if (descriptor === undefined) {
      actions.pending.settings.push({ ns, user, redacted: asArray(namespace.redacted) })
      continue
    }
    const currentUser = asObject(descriptor.user) ?? {}
    const next = restoreRedacted(user, asArray(namespace.redacted), currentUser)
    if (isDeepStrictEqual(next, currentUser)) continue
    actions.settings.push({ ns, user, redacted: asArray(namespace.redacted) })
  }

  // Plugin row enablement ---------------------------------------------------
  for (const plugin of input.profile.plugins) {
    if (plugin === null || typeof plugin !== 'object') continue
    if (typeof plugin.enabled !== 'boolean') continue
    const patchId = asString(plugin.patchId)
    const moduleName = asString(plugin.moduleName)
    let current = patchId !== undefined ? pluginByPatchId.get(patchId) : undefined
    if (current === undefined && moduleName !== undefined) current = pluginByModule.get(moduleName)
    if (current === undefined) {
      if (patchId !== undefined && conditionalDisabled.has(patchId)) {
        warnings.push(
          `Plugin ${moduleName} uses conditional enablement on the source machine and was not queued for toggling`,
        )
        continue
      }
      actions.pending.rows.push({ patchId: patchId ?? null, moduleName: moduleName ?? null, enabled: plugin.enabled })
      continue
    }
    if (current.enabled !== plugin.enabled) {
      if (typeof current.patchId !== 'string') {
        warnings.push(`Plugin ${current.moduleName} cannot be toggled from the profile patch`)
        continue
      }
      if (conditionalDisabled.has(current.patchId)) {
        warnings.push(
          `Plugin ${current.moduleName} uses conditional enablement on the source machine and was not toggled automatically`,
        )
        continue
      }
      const action = {
        patchId: current.patchId,
        moduleName: current.moduleName,
        enabled: plugin.enabled,
      }
      if (plugin.enabled) actions.enableRows.push(action)
      else actions.disableRows.push(action)
    }
  }

  // Skills ------------------------------------------------------------------
  for (const skill of input.skills) {
    if (skill === null || typeof skill !== 'object') continue
    const root = skill.root === 'agents' ? 'agents' : skill.root === 'dsh' ? 'dsh' : undefined
    const name = asString(skill.name)
    if (root === undefined || name === undefined || name.length === 0) continue
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name) || name.startsWith('.')) {
      warnings.push(`Skipped skill with unsafe name ${JSON.stringify(name)}`)
      continue
    }
    const kind = skill.kind === 'file' ? 'file' : skill.kind === 'bundle' ? 'bundle' : undefined
    if (kind === undefined || !Array.isArray(skill.files) || skill.files.length === 0) continue
    const rootDir = root === 'agents' ? join(homes.agentsHome, 'skills') : join(homes.dshHome, 'skills')
    const target = join(rootDir, kind === 'bundle' ? name : `${name}.md`)
    if (await pathExists(target)) {
      conflicts.push({ kind: 'skill', id: `${root}:${name}`, detail: 'A skill with this name already exists' })
      continue
    }
    actions.skills.push({
      root,
      name,
      kind,
      files: skill.files,
      bytes: Number(skill.bytes) || 0,
    })
  }

  if (input.workspaces.some((workspace) => asString(workspace?.path) !== undefined)) {
    warnings.push('Workspace entries are reference-only and are not created automatically')
  }

  for (const [name, spec] of Object.entries(input.profile.dependencies)) {
    if (typeof spec !== 'string') continue
    if (/^(?:link|file):/u.test(spec) || spec.startsWith('.') || spec.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(spec)) {
      manual.push({
        kind: 'dependency',
        name,
        detail: `Profile dependency ${spec} is local; install or link it manually.`,
      })
    }
  }

  const manualActions = dedupeBy(manual, (item) => `${item.kind ?? ''}:${item.name ?? ''}`)

  const summary = {
    bundlesToInstall: actions.installs.length,
    bundlesToEnable: actions.enableBundles.length,
    bundlesToDisable: actions.disableBundles.length,
    rowsToChange: actions.enableRows.length + actions.disableRows.length,
    inserts: actions.inserts.length,
    configs: actions.configs.length,
    settings: actions.settings.length,
    pendingConfigs: actions.pending.configs.length,
    pendingSettings: actions.pending.settings.length,
    pendingRows: actions.pending.rows.length,
    skills: actions.skills.length,
    manual: manualActions.length,
    conflicts: conflicts.length,
    warnings: warnings.length,
  }

  const display = {
    source: describeSource(input.source),
    installs: actions.installs.map(({ name, spec, version }) => ({ name, spec, version })),
    enableBundles: actions.enableBundles,
    disableBundles: actions.disableBundles,
    enableRows: actions.enableRows.map(({ patchId, moduleName }) => ({ patchId, moduleName })),
    disableRows: actions.disableRows.map(({ patchId, moduleName }) => ({ patchId, moduleName })),
    inserts: actions.inserts.map((row) => ({ id: row.id, name: row.name })),
    configs: actions.configs.map(({ id, name }) => ({ id, name })),
    settings: actions.settings.map(({ ns }) => ({ ns })),
    skills: actions.skills.map(({ root, name, kind, files }) => ({
      root,
      name,
      kind,
      fileCount: files.length,
    })),
    pending: {
      configs: actions.pending.configs.map(({ id, name }) => ({ id, name })),
      settings: actions.pending.settings.map(({ ns }) => ({ ns })),
      inserts: actions.pending.inserts.map(({ id, name }) => ({ id, name })),
      rows: actions.pending.rows.map(({ patchId, moduleName, enabled }) => ({
        patchId,
        moduleName,
        enabled,
      })),
      summary: {
        configs: actions.pending.configs.length,
        settings: actions.pending.settings.length,
        inserts: actions.pending.inserts.length,
        rows: actions.pending.rows.length,
      },
    },
    manual: manualActions,
    conflicts,
    warnings,
    summary,
  }

  return { input, actions, display }
}
