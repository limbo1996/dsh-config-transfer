/**
 * Secret-aware sanitization for exported configuration.
 *
 * Two layers are combined:
 *  - structural: object keys that name credentials/API keys are dropped;
 *  - textual: recognizable key formats are replaced wherever they appear.
 *
 * The sanitizer never keeps a secret value "for reference". Dropped or
 * replaced values are reported by path so import can preserve a value that
 * already exists on the target machine instead of clearing it.
 */

import { MAX_REDACTIONS } from './constants.js'

const SECRET_KEY_EXACT = new Set([
  'apikey',
  'apikeys',
  'secret',
  'secrets',
  'password',
  'passwd',
  'passphrase',
  'pin',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authtoken',
  'bearertoken',
  'apitoken',
  'sessiontoken',
  'csrftoken',
  'oauthtoken',
  'authorization',
  'auth',
  'cookie',
  'cookies',
  'setcookie',
  'credential',
  'credentials',
  'privatekey',
  'accesskey',
  'secretkey',
  'sessionkey',
  'signingkey',
  'encryptionkey',
  'masterkey',
  'keytab',
  'dsn',
])

const NON_SECRET_KEY_SUFFIXES = [
  'maxtokens',
  'inputtokens',
  'outputtokens',
  'totaltokens',
  'cachedtokens',
  'reasoningtokens',
  'tokencount',
  'tokenlimit',
  'tokenbudget',
  'tokenmeter',
  'tokenusage',
  'tokens',
  'tokenizer',
  'tokenize',
  'tokenestimate',
]

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isDangerousKey(key) {
  return typeof key === 'string' && DANGEROUS_KEYS.has(key)
}

const SECRET_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
])

/** Normalize a key so separators and case do not hide a credential name. */
export function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Whether an object key names a credential rather than ordinary data. */
export function isSecretKey(key) {
  if (typeof key !== 'string' || key.length === 0) return false
  const normalized = normalizeKey(key)
  if (normalized.length === 0) return false
  for (const suffix of NON_SECRET_KEY_SUFFIXES) {
    if (normalized === suffix || normalized.endsWith(suffix)) return false
  }
  if (SECRET_KEY_EXACT.has(normalized)) return true
  return /(?:apikey|secret|password|passwd|privatekey|accesskey|secretkey|credential|credentials|token)$/u.test(normalized)
}

/** Whether an environment variable name names a credential. */
export function isSecretEnvKey(name) {
  const normalized = normalizeKey(name)
  if (normalized.length === 0) return false
  if (isSecretKey(name)) return true
  return (
    /(?:key|token|secret|password|passwd|credential|cookie|auth)$/u.test(normalized) ||
    /(?:apikey|secretkey|privatekey|accesskey|accesstoken|authtoken)/u.test(normalized)
  )
}

/** Whether an HTTP header carries a credential. */
export function isSecretHeader(name) {
  if (typeof name !== 'string') return false
  return SECRET_HEADERS.has(name.toLowerCase()) || isSecretKey(name)
}

const TEXT_RULES = [
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/gu, replacement: '***REDACTED***' },
  { pattern: /\bpk-[A-Za-z0-9_-]{20,}\b/gu, replacement: '***REDACTED***' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu, replacement: '***REDACTED***' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu, replacement: '***REDACTED***' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gu, replacement: '***REDACTED***' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/gu, replacement: '***REDACTED***' },
  { pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/gu, replacement: '***REDACTED***' },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
    replacement: '***REDACTED***',
  },
  {
    pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/giu,
    replacement: '$1***REDACTED***',
  },
  {
    pattern: /\b(api[_-]?key\s*[:=]\s*['"]?)[A-Za-z0-9_-]{16,}/giu,
    replacement: '$1***REDACTED***',
  },
  {
    pattern: /\b(access[_-]?token\s*[:=]\s*['"]?)[A-Za-z0-9_.-]{20,}/giu,
    replacement: '$1***REDACTED***',
  },
]

/** Replace recognizable credential formats inside free text. */
export function scrubText(text) {
  if (typeof text !== 'string' || text.length === 0) return text
  let next = text
  for (const rule of TEXT_RULES) {
    next = next.replace(rule.pattern, rule.replacement)
  }
  return next
}

/** Query-string names that are credentials even when the bare key is generic. */
function isSecretQueryKey(key) {
  const normalized = normalizeKey(key)
  return isSecretKey(key) || ['key', 'sig', 'signature', 'hmac', 'auth', 'code'].includes(normalized)
}

/** Strip URL userinfo and credential-named query parameters. */
export function scrubUrl(text) {
  if (typeof text !== 'string' || !/^[a-z][a-z0-9+.-]*:\/\//iu.test(text)) return text
  let url
  try {
    url = new URL(text)
  } catch {
    return text
  }
  let changed = false
  if (url.username !== '' || url.password !== '') {
    url.username = ''
    url.password = ''
    changed = true
  }
  for (const key of [...url.searchParams.keys()]) {
    if (isSecretQueryKey(key)) {
      url.searchParams.delete(key)
      changed = true
    }
  }
  return changed ? url.toString() : text
}

function pushRedaction(list, path, reason) {
  if (list.length >= MAX_REDACTIONS) return
  list.push({ path, reason })
}

function walkEnvironment(value, path, report, seen, cache) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return sanitizeInner(value, path, report, seen, cache)
  }
  const out = {}
  for (const [name, entry] of Object.entries(value)) {
    if (isDangerousKey(name)) {
      pushRedaction(report, [...path, name], 'unsafe key')
      continue
    }
    if (isSecretEnvKey(name)) {
      pushRedaction(report, [...path, name], 'environment credential')
      continue
    }
    out[name] = sanitizeInner(entry, [...path, name], report, seen, cache)
  }
  return out
}

function walkHeaders(value, path, report, seen, cache) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return sanitizeInner(value, path, report, seen, cache)
  }
  const out = {}
  for (const [name, entry] of Object.entries(value)) {
    if (isDangerousKey(name)) {
      pushRedaction(report, [...path, name], 'unsafe key')
      continue
    }
    if (isSecretHeader(name)) {
      pushRedaction(report, [...path, name], 'header credential')
      continue
    }
    out[name] = sanitizeInner(entry, [...path, name], report, seen, cache)
  }
  return out
}

function sanitizeString(value, path, report) {
  let next = scrubUrl(value)
  const scrubbed = scrubText(next)
  if (scrubbed !== next) {
    pushRedaction(report, path, 'credential text')
    next = scrubbed
  } else if (next !== value) {
    pushRedaction(report, path, 'url credential')
  }
  return next
}

function sanitizeInner(value, path, report, seen, cache) {
  if (typeof value === 'string') return sanitizeString(value, path, report)
  if (Array.isArray(value)) {
    if (seen.has(value)) return null
    const cached = cache.get(value)
    if (cached !== undefined) return cached
    const out = []
    cache.set(value, out)
    seen.add(value)
    for (let index = 0; index < value.length; index += 1) {
      out.push(sanitizeInner(value[index], [...path, index], report, seen, cache))
    }
    seen.delete(value)
    return out
  }
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return null
    const cached = cache.get(value)
    if (cached !== undefined) return cached
    const out = {}
    cache.set(value, out)
    seen.add(value)
    for (const [key, entry] of Object.entries(value)) {
      if (isDangerousKey(key)) {
        pushRedaction(report, [...path, key], 'unsafe key')
        continue
      }
      if (isSecretKey(key)) {
        pushRedaction(report, [...path, key], 'credential field')
        continue
      }
      const normalized = normalizeKey(key)
      if (normalized === 'env' || normalized.endsWith('env') || normalized === 'environment') {
        out[key] = walkEnvironment(entry, [...path, key], report, seen, cache)
        continue
      }
      if (normalized === 'headers' || normalized === 'header') {
        out[key] = walkHeaders(entry, [...path, key], report, seen, cache)
        continue
      }
      out[key] = sanitizeInner(entry, [...path, key], report, seen, cache)
    }
    seen.delete(value)
    return out
  }
  return value
}

/**
 * Sanitize a JSON-compatible value.
 * @returns {{ value: unknown, redactions: { path: (string|number)[], reason: string }[] }}
 */
export function sanitizeValue(value) {
  const report = []
  const sanitized = sanitizeInner(value, [], report, new WeakSet(), new WeakMap())
  return { value: sanitized, redactions: report }
}

/** Read a value at an object path, returning undefined for absent segments. */
export function getAtPath(root, path) {
  let current = root
  for (const segment of path) {
    if (isDangerousKey(segment)) return undefined
    if (current === null || typeof current !== 'object') return undefined
    if (Array.isArray(current)) {
      if (typeof segment !== 'number' || segment < 0 || segment >= current.length) return undefined
    }
    current = current[segment]
  }
  return current
}

/** Set a value at an object path, creating object containers as needed. */
function setAtPath(root, path, value) {
  if (path.some((segment) => isDangerousKey(segment))) return
  let current = root
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]
    const nextSegment = path[index + 1]
    let next = current[segment]
    if (next === null || typeof next !== 'object') {
      next = typeof nextSegment === 'number' ? [] : {}
      current[segment] = next
    }
    current = next
  }
  current[path[path.length - 1]] = value
}

/**
 * Re-insert values the export had to redact when the target machine already
 * has them, so importing never clears an existing credential.
 */
export function restoreRedacted(config, redactions, current) {
  if (!Array.isArray(redactions) || redactions.length === 0) return config
  const next = structuredClone(config)
  for (const entry of redactions) {
    const path = Array.isArray(entry) ? entry : entry?.path
    if (!Array.isArray(path) || path.length === 0) continue
    const currentValue = getAtPath(current, path)
    if (currentValue === undefined) continue
    setAtPath(next, path, structuredClone(currentValue))
  }
  return next
}

/** Whether an object or array carries no data. */
export function isEmptyValue(value) {
  if (value === null || value === undefined) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value).length === 0
  return false
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function secretInventorySubset(value) {
  if (!isPlainObject(value)) return undefined
  const out = {}
  for (const [key, child] of Object.entries(value)) {
    if (isDangerousKey(key)) continue
    if (isSecretKey(key)) {
      out[key] = structuredClone(child)
      continue
    }
    const normalized = normalizeKey(key)
    if (normalized === 'env' || normalized.endsWith('env') || normalized === 'environment') {
      const env = {}
      if (isPlainObject(child)) {
        for (const [envKey, envValue] of Object.entries(child)) {
          if (isSecretEnvKey(envKey)) env[envKey] = structuredClone(envValue)
        }
      }
      if (Object.keys(env).length > 0) out[key] = env
      continue
    }
    if (normalized === 'headers' || normalized === 'header') {
      const headers = {}
      if (isPlainObject(child)) {
        for (const [headerName, headerValue] of Object.entries(child)) {
          if (isSecretHeader(headerName)) headers[headerName] = structuredClone(headerValue)
        }
      }
      if (Object.keys(headers).length > 0) out[key] = headers
      continue
    }
    const subset = secretInventorySubset(child)
    if (subset !== undefined) out[key] = subset
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Keep credential-shaped fields the target already has when the imported
 * object does not mention them. This is a safety net for secrets the export
 * could not name: importing must not clear a key just because the source used
 * a different key name.
 */
export function preserveSecretFields(next, current) {
  if (!isPlainObject(next) || !isPlainObject(current)) return next
  for (const [key, value] of Object.entries(current)) {
    if (isDangerousKey(key)) continue
    if (isSecretKey(key)) {
      if (!Object.prototype.hasOwnProperty.call(next, key)) next[key] = structuredClone(value)
      continue
    }
    const normalized = normalizeKey(key)
    if (normalized === 'env' || normalized.endsWith('env') || normalized === 'environment') {
      if (!isPlainObject(next[key]) && isPlainObject(value)) {
        const subset = secretInventorySubset(value)
        if (subset !== undefined) next[key] = subset
        continue
      }
      if (isPlainObject(next[key]) && isPlainObject(value)) {
        for (const [envKey, envValue] of Object.entries(value)) {
          if (isSecretEnvKey(envKey) && !Object.prototype.hasOwnProperty.call(next[key], envKey)) {
            next[key][envKey] = structuredClone(envValue)
          }
        }
      }
      continue
    }
    if (normalized === 'headers' || normalized === 'header') {
      if (!isPlainObject(next[key]) && isPlainObject(value)) {
        const subset = secretInventorySubset(value)
        if (subset !== undefined) next[key] = subset
        continue
      }
      if (isPlainObject(next[key]) && isPlainObject(value)) {
        for (const [headerName, headerValue] of Object.entries(value)) {
          if (isSecretHeader(headerName) && !Object.prototype.hasOwnProperty.call(next[key], headerName)) {
            next[key][headerName] = structuredClone(headerValue)
          }
        }
      }
      continue
    }
    if (isPlainObject(next[key]) && isPlainObject(value)) {
      preserveSecretFields(next[key], value)
    } else if (!Object.prototype.hasOwnProperty.call(next, key) && isPlainObject(value)) {
      const subset = secretInventorySubset(value)
      if (subset !== undefined) next[key] = subset
    }
  }
  return next
}

/** Remove prototype-polluting keys from imported JSON before using it. */
export function stripDangerousKeys(value) {
  if (Array.isArray(value)) return value.map(stripDangerousKeys)
  if (value === null || typeof value !== 'object') return value
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    if (isDangerousKey(key)) continue
    out[key] = stripDangerousKeys(entry)
  }
  return out
}
