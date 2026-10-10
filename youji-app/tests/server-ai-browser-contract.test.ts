import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const fixture = fileURLToPath(new URL('../scripts/server-ai-provider-fixture.mjs', import.meta.url))
test('synthetic browser provider preloader refuses production before any network or app starts', () => {
  const result = spawnSync(process.execPath, ['--import', fixture, '-e', "throw Error('APP_MUST_NOT_START')"], { env: { NODE_ENV: 'production', SERVER_AI_API_KEY: 'FIXTURE-BROWSER-SHARED-NOT-A-REAL-KEY' }, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 1); assert.match(result.stderr, /Refusing provider fixture/)
  assert.doesNotMatch(result.stderr, /Error: APP_MUST_NOT_START/)
})

test('provider fixture exercises correct official contract while rejecting all other external destinations', () => {
  const script = `
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', { redirect:'error', body:JSON.stringify({model:'deepseek-synthetic-browser',max_tokens:1024,thinking:{type:'disabled'}}) });
    if (!(await response.text()).includes('Synthetic shared provider response')) process.exit(2);
    try { await fetch('https://example.com'); process.exit(3) } catch(error) { if (!error.message.includes('External network is disabled')) throw error }
  `
  const result = spawnSync(process.execPath, ['--import', fixture, '--input-type=module', '-e', script], { env: { NODE_ENV: 'test', SERVER_AI_API_KEY: 'FIXTURE-BROWSER-SHARED-NOT-A-REAL-KEY' }, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
})

test('existing browser CI invokes new consent flow and collects current desktop/mobile screenshots', () => {
  const e2e = readFileSync(new URL('../scripts/e2e-recovery.mjs', import.meta.url), 'utf8')
  const contract = readFileSync(new URL('../scripts/server-ai-browser-contract.mjs', import.meta.url), 'utf8')
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.match(e2e, /await exerciseServerAI\(page/)
  assert.match(e2e, /server-ai-provider-fixture\.mjs/)
  assert.match(contract, /server-ai-explicit-consent-response/)
  assert.match(contract, /server-ai-explicit-consent-mobile/)
  assert.match(contract, /server-ai-page-reset-rules/)
  assert.match(ci, /npm run test:browser/)
  assert.match(ci, /youji-app\/test-artifacts\//)
})
