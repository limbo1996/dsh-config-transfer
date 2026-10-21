/**
 * Collect the portable part of a DSH Desktop configuration.
 *
 * The snapshot intentionally excludes credentials, session logs, attachments,
 * caches, plugin runtime storage, and any file-level data that cannot be
 * reproduced through DSH's own configuration and plugin services.
 */

import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { FORMAT, FORMAT_VERSION, LEGACY_SELF_NAMES } from './constants.js'
import { collectSkills } from './skills.js'
import { patchDisabledRows, patchInsertRows, isPortablePluginName } from './patch.js'
import { isEmptyValue, sanitizeValue } from './sanitize.js'

/** Config entries whose values are runtime snapshots rather than preferences. */
const TRANSIENT_CONFIG_IDS = new Set(['plugin-marketplace'])

function compactBundle(bundle) {
  const error = bundle.error
  return {
    name: String(bundle.name),
    version: typeof bundle.version === 'string' ? bundle.version : null,
    official: bundle.official === true,
    builtIn: bundle.availability === 'installation',
    availability: bundle.availability ?? null,
    enabled: bundle.enabled === true,
    installed: bundle.installed === true,
    optional: bundle.optional === true,
    removable: bundle.removable === true,
    source: typeof bundle.source === 'string' ? bundle.source : null,
    installTarget:
      bundle.installTarget === undefined || bundle.installTarget === null
        ? null
        : {
            spec: String(bundle.installTarget.spec),
            version:
              typeof bundle.installTarget.version === 'string' ? bundle.installTarget.version : null,
          },
    rows: Array.isArray(bundle.rows)
      ? bundle.rows.map((row) => ({
          rowId: row.rowId ?? null,
          moduleName: row.moduleName ?? null,
          entryId: row.entryId ?? null,
        }))
      : [],
    error:
      error === undefined || error === null
        ? null
        : { code: error.code ?? null, diagnostic: error.diagnostic ?? null },
  }
}

function compactPlugin(plugin) {
  return {
    patchId: typeof plugin.patchId === 'string' ? plugin.patchId : null,
    moduleName: String(plugin.moduleName),
    enabled: plugin.enabled === true,
    fiberPhase: plugin.fiberPhase ?? null,
  }
}

function compactWorkspace(workspace) {
  return {
    title: typeof workspace.title === 'string' ? workspace.title : null,
    path: typeof workspace.path === 'string' ? workspace.path : null,
  }
}

async function readProfileManifest(profileDir) {
  try {
    const text = await readFile(join(profileDir, 'package.json'), 'utf8')
    const manifest = JSON.parse(text)
    return {
      profileName:
        typeof manifest.name === 'string' && manifest.name.startsWith('dsh-profile-')
          ? manifest.name.slice('dsh-profile-'.length)
          : (manifest.name ?? null),
      dependencies:
        manifest.dependencies !== null && typeof manifest.dependencies === 'object'
          ? manifest.dependencies
          : {},
      bundleOrder: Array.isArray(manifest.dsh?.profile?.bundles)
        ? manifest.dsh.profile.bundles.filter((name) => typeof name === 'string')
        : [],
    }
  } catch {
    return { profileName: null, dependencies: {}, bundleOrder: [] }
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ dshHome: string, agentsHome: string }} homes
 */
export async function collectSnapshot(ctx, homes) {
  const warnings = []
  const profile = ctx.get('profileContext')
  if (profile === undefined) throw new Error('profileContext is unavailable in this composition')

  const pluginManager = ctx.get('pluginManager')
  const configEditor = ctx.get('configEditor')
  const settings = ctx.get('settings')
  const workspaceRegistry = ctx.get('workspaceRegistry')
  const manifest = await readProfileManifest(profile.dir)

  let bundles = []
  if (pluginManager !== undefined) {
    try {
      const selected = new Set(manifest.bundleOrder)
      bundles = (await pluginManager.listBundles())
        .filter(
          (bundle) =>
            selected.has(bundle.name) || bundle.enabled === true || bundle.installed === true,
        )
        .map(compactBundle)
    } catch (error) {
      warnings.push(`Cannot read bundle list: ${error.message}`)
    }
  } else {
    warnings.push('pluginManager is unavailable; installed plugins are not exported')
  }

  let plugins = []
  if (pluginManager !== undefined) {
    try {
      plugins = (await pluginManager.listPlugins()).map(compactPlugin)
    } catch (error) {
      warnings.push(`Cannot read plugin list: ${error.message}`)
    }
  }

  let insertRows = []
  let disabledRows = []
  try {
    const { loadPatchDocument } = await import('./patch.js')
    const document = await loadPatchDocument(profile.patchPath)
    insertRows = await patchInsertRows(document)
    disabledRows = await patchDisabledRows(document)
  } catch (error) {
    warnings.push(`Cannot read profile patch: ${error.message}`)
  }

  const inserts = []
  const insertIds = new Set()
  for (const row of insertRows) {
    insertIds.add(row.id)
    const sanitized = sanitizeValue(row.config ?? {})
    inserts.push({
      id: row.id,
      name: row.name,
      config: sanitized.value,
      redacted: sanitized.redactions,
      ...(row.disabled === undefined ? {} : { disabled: sanitizeValue(row.disabled).value }),
      ...(row.group === true ? { group: true } : {}),
      ...(row.inject === undefined ? {} : { inject: sanitizeValue(row.inject).value }),
      ...(row.intercept === undefined ? {} : { intercept: sanitizeValue(row.intercept).value }),
      ...(row.isolate === undefined ? {} : { isolate: sanitizeValue(row.isolate).value }),
      portable: isPortablePluginName(row.name),
    })
  }

  const configs = []
  if (configEditor !== undefined) {
    try {
      for (const item of configEditor.configuration()) {
        const id = item.entry?.options?.id
        const name = item.entry?.options?.name
        if (typeof id !== 'string' || id.length === 0) continue
        if (insertIds.has(id) || TRANSIENT_CONFIG_IDS.has(id)) continue
        if (isEmptyValue(item.override)) continue
        const sanitized = sanitizeValue(item.override)
        configs.push({
          id,
          name: typeof name === 'string' ? name : null,
          config: sanitized.value,
          redacted: sanitized.redactions,
        })
      }
    } catch (error) {
      warnings.push(`Cannot read plugin configuration: ${error.message}`)
    }
  } else {
    warnings.push('configEditor is unavailable; plugin configuration is not exported')
  }

  const settingsNamespaces = []
  if (settings !== undefined) {
    try {
      const describe = settings.describe({ redactSecrets: true })
      for (const descriptor of Array.isArray(describe) ? describe : []) {
        if (typeof descriptor?.ns !== 'string' || descriptor.ns === 'dsh-config-transfer' || LEGACY_SELF_NAMES.has(descriptor.ns)) continue
        if (insertIds.has(descriptor.ns) || TRANSIENT_CONFIG_IDS.has(descriptor.ns)) continue
        if (isEmptyValue(descriptor.user)) continue
        const sanitized = sanitizeValue(descriptor.user)
        settingsNamespaces.push({
          ns: descriptor.ns,
          user: sanitized.value,
          redacted: sanitized.redactions,
        })
      }
    } catch (error) {
      warnings.push(`Cannot read settings namespaces: ${error.message}`)
    }
  }

  let workspaces = []
  if (workspaceRegistry !== undefined) {
    try {
      workspaces = workspaceRegistry.list().map(compactWorkspace)
    } catch (error) {
      warnings.push(`Cannot read workspace list: ${error.message}`)
    }
  }

  let skillSnapshot = { skills: [], warnings: [] }
  try {
    skillSnapshot = await collectSkills(homes)
    warnings.push(...skillSnapshot.warnings)
  } catch (error) {
    warnings.push(`Cannot read user skills: ${error.message}`)
  }

  let redactionCount = 0
  for (const value of [...inserts, ...configs, ...settingsNamespaces]) {
    redactionCount += Array.isArray(value.redacted) ? value.redacted.length : 0
  }

  const snapshot = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      profile: manifest.profileName ?? process.env.DSH_PROFILE ?? basename(profile.dir),
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
    },
    profile: {
      name: manifest.profileName ?? process.env.DSH_PROFILE ?? basename(profile.dir),
      bundleOrder: manifest.bundleOrder,
      dependencies: manifest.dependencies,
      bundles,
      plugins,
      inserts,
      disabled: disabledRows.map((row) => {
        const sanitized = sanitizeValue(row.disabled)
        return {
          id: row.id,
          name: row.name ?? null,
          disabled: sanitized.value,
          redacted: sanitized.redactions,
        }
      }),
      configs,
      settings: settingsNamespaces,
    },
    skills: { skills: skillSnapshot.skills },
    workspaces,
    excluded: [
      'credentials and API keys',
      'sessions, turns, goals, and schedule records',
      'attachments, caches, logs, and plugin runtime storage',
      'plugin source code and local link targets',
      'home-level cordis.patch.yml and machine-local .env',
    ],
    warnings,
  }

  const builtinBundles = bundles.filter((bundle) => bundle.builtIn === true).length
  const stats = {
    bundles: bundles.length,
    builtinBundles,
    thirdPartyBundles: bundles.length - builtinBundles,
    plugins: plugins.length,
    inserts: inserts.length,
    disabled: disabledRows.length,
    configs: configs.length,
    settings: settingsNamespaces.length,
    skills: skillSnapshot.skills.length,
    workspaces: workspaces.length,
    redactions: redactionCount,
  }
  return { snapshot, stats, warnings }
}
