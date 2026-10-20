import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isSecretKey,
  preserveSecretFields,
  sanitizeValue,
  restoreRedacted,
  scrubText,
  scrubUrl,
  stripDangerousKeys,
} from '../lib/sanitize.js'

test('secret key detection avoids token counters', () => {
  for (const key of ['apiKey', 'api_key', 'OPENAI_API_KEY', 'refreshToken', 'password', 'clientSecret', 'Authorization']) {
    assert.equal(isSecretKey(key), true, key)
  }
  for (const key of ['maxTokens', 'inputTokens', 'tokenLimit', 'tokenUsage', 'model', 'provider', 'reasoningEffort']) {
    assert.equal(isSecretKey(key), false, key)
  }
})

test('sanitizeValue drops credential fields and reports their paths', () => {
  const { value, redactions } = sanitizeValue({
    provider: 'deepseek',
    apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
    maxTokens: 4096,
    nested: { refreshToken: 'refresh-value', temperature: 0.2 },
  })
  assert.deepEqual(value, {
    provider: 'deepseek',
    maxTokens: 4096,
    nested: { temperature: 0.2 },
  })
  assert.ok(redactions.some((entry) => entry.path.join('.') === 'apiKey'))
  assert.ok(redactions.some((entry) => entry.path.join('.') === 'nested.refreshToken'))
})

test('environment and header objects are redacted selectively', () => {
  const { value } = sanitizeValue({
    env: {
      PATH: '/usr/bin',
      ZOTERO_LOCAL: 'true',
      OPENAI_API_KEY: 'sk-abcdefghijklmnopqrstuvwxyz',
      GITHUB_TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz',
    },
    headers: {
      accept: 'application/json',
      Authorization: 'Bearer abcdefghijklmnopqrstuvwxyz',
      'x-api-key': 'key-value',
    },
  })
  assert.deepEqual(value, {
    env: { PATH: '/usr/bin', ZOTERO_LOCAL: 'true' },
    headers: { accept: 'application/json' },
  })
})

test('recognizable key formats are removed from free text', () => {
  const text = 'use sk-abcdefghijklmnopqrstuvwxyz and Bearer abcdefghijklmnopqrstuvwxyz'
  const scrubbed = scrubText(text)
  assert.equal(scrubbed.includes('sk-abcdefghijklmnopqrstuvwxyz'), false)
  assert.equal(scrubbed.includes('Bearer abcdefghijklmnopqrstuvwxyz'), false)
})

test('URL userinfo and credential query parameters are removed', () => {
  const scrubbed = scrubUrl('https://user:pass@example.com/path?api_key=secret&x=1')
  assert.equal(scrubbed.includes('user'), false)
  assert.equal(scrubbed.includes('api_key'), false)
  assert.ok(scrubbed.includes('x=1'))
})

test('sanitizeValue tolerates cycles', () => {
  const input = { name: 'x' }
  input.self = input
  assert.doesNotThrow(() => sanitizeValue(input))
})

test('sanitizeValue keeps shared subtrees instead of nulling the second one', () => {
  const shared = { provider: 'deepseek', maxTokens: 1024 }
  const { value } = sanitizeValue({ first: shared, second: shared })
  assert.deepEqual(value.first, { provider: 'deepseek', maxTokens: 1024 })
  assert.deepEqual(value.second, { provider: 'deepseek', maxTokens: 1024 })
})

test('restoreRedacted keeps a credential already present on the target', () => {
  const config = { providers: { deepseek: { model: 'deepseek-flash' } } }
  const redactions = [{ path: ['providers', 'deepseek', 'apiKey'] }]
  const current = { providers: { deepseek: { apiKey: 'existing-key' } } }
  const restored = restoreRedacted(config, redactions, current)
  assert.deepEqual(restored, {
    providers: { deepseek: { model: 'deepseek-flash', apiKey: 'existing-key' } },
  })
})

test('preserveSecretFields keeps target credentials not named by the export', () => {
  const next = {
    providers: { deepseek: { model: 'deepseek-flash' } },
    env: { PATH: '/usr/bin' },
    headers: { accept: 'application/json' },
    removed: 'source-removed-this',
  }
  const current = {
    providers: { deepseek: { apiKey: 'target-key' } },
    env: { OPENAI_API_KEY: 'target-env-key', PATH: '/usr/bin' },
    headers: { Authorization: 'Bearer target-token', accept: 'application/json' },
    removed: 'target-value',
  }
  const merged = preserveSecretFields(next, current)
  assert.equal(merged.providers.deepseek.apiKey, 'target-key')
  assert.equal(merged.providers.deepseek.model, 'deepseek-flash')
  assert.equal(merged.env.OPENAI_API_KEY, 'target-env-key')
  assert.equal(merged.headers.Authorization, 'Bearer target-token')
  assert.equal(Object.prototype.hasOwnProperty.call(merged, 'removed'), true)
  assert.equal(merged.removed, 'source-removed-this')
})

test('preserveSecretFields keeps nested credentials when the source omits a subtree', () => {
  const merged = preserveSecretFields(
    {},
    {
      providers: { deepseek: { apiKey: 'target-key', model: 'deepseek-flash' } },
      env: { PATH: '/usr/bin', OPENAI_API_KEY: 'target-env-key' },
    },
  )
  assert.deepEqual(merged, {
    providers: { deepseek: { apiKey: 'target-key' } },
    env: { OPENAI_API_KEY: 'target-env-key' },
  })
})

test('stripDangerousKeys removes prototype-polluting keys', () => {
  const parsed = JSON.parse('{"__proto__":{"polluted":true},"safe":{"constructor":{"x":1},"ok":2}}')
  const cleaned = stripDangerousKeys(parsed)
  assert.deepEqual(cleaned, { safe: { ok: 2 } })
  assert.equal({}.polluted, undefined)
})
