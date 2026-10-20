/**
 * Durable queue for import actions that could not be applied yet.
 *
 * A host-half installation often needs a restart before its entry exists, and
 * a disabled entry has no live fiber to edit. Keeping the remaining actions in
 * one owner-only JSON file lets the next activation finish the import without
 * asking the user to import the file again.
 */

import { mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const VERSION = 1

export function pendingPath(homes) {
  return join(homes.dshHome, 'dshsync', 'pending.json')
}

function normalizeList(value) {
  return Array.isArray(value) ? value : []
}

/** Read the queue; a missing or malformed file is treated as empty. */
export async function readPending(homes) {
  try {
    const text = await readFile(pendingPath(homes), 'utf8')
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || parsed.version !== VERSION) return undefined
    return {
      version: VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      attempts: Number.isSafeInteger(parsed.attempts) ? parsed.attempts : 0,
      inserts: normalizeList(parsed.inserts),
      configs: normalizeList(parsed.configs),
      settings: normalizeList(parsed.settings),
      rows: normalizeList(parsed.rows),
    }
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    return undefined
  }
}

export async function writePending(homes, pending) {
  const path = pendingPath(homes)
  await mkdir(dirname(path), { recursive: true })
  const body = JSON.stringify(
    {
      version: VERSION,
      updatedAt: new Date().toISOString(),
      attempts: pending.attempts ?? 0,
      inserts: normalizeList(pending.inserts),
      configs: normalizeList(pending.configs),
      settings: normalizeList(pending.settings),
      rows: normalizeList(pending.rows),
    },
    null,
    2,
  )
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, body, { mode: 0o600, flag: 'wx' })
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await rename(temp, path)
        break
      } catch (error) {
        if (!['EACCES', 'EBUSY', 'EPERM'].includes(error.code) || attempt === 5) throw error
        await delay(25 * (attempt + 1))
      }
    }
  } finally {
    await rm(temp, { force: true })
  }
}

export async function clearPending(homes) {
  await rm(pendingPath(homes), { force: true })
}

export function pendingCounts(pending) {
  if (pending === undefined) return { inserts: 0, configs: 0, settings: 0, rows: 0, total: 0 }
  const counts = {
    inserts: pending.inserts.length,
    configs: pending.configs.length,
    settings: pending.settings.length,
    rows: pending.rows.length,
  }
  return { ...counts, total: counts.inserts + counts.configs + counts.settings + counts.rows }
}
