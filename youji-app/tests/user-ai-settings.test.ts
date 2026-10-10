import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import * as React from 'react'
import { act } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import type { AuthUser } from '../src/stores/authStore'

const values = new Map<string, string>()
const memory = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true, localStorage: memory, sessionStorage: memory,
  window: Object.assign(new EventTarget(), { location: { replace() {} }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }),
  document: { documentElement: { setAttribute() {} } },
})
const { AIConnectionPanel } = await import('../src/components/settings/AIConnectionPanel')
const { useAuthStore } = await import('../src/stores/authStore')
const { setSessionActive, clearSession } = await import('../src/services/apiClient')
const storage = await import('../src/db')
const { exportAllData, bindAccountDatabase } = storage
const { pauseSync } = await import('../src/services/syncEngine')
const originalFetch = globalThis.fetch
let tree: ReactTestRenderer | undefined
let databaseBound = false
const key = 'FIXTURE-UI-MEMORY-ONLY-SECRET'
const user = (id: string): AuthUser => ({ id, phone: 'synthetic', nickname: id, avatar: '', identity: 'other', city: '', coachStyle: 'gentle', quietStart: '23:00', quietEnd: '07:00', pushLimit: 2 })
const templates = [{ id: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com/chat/completions' }, { id: 'glm', name: '智谱 GLM', endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions' }]
const empty = { connection: null, credentialStorageReady: true, templates }
const saved = { connectionId: '00000000-0000-4000-8000-000000000001', version: 1, providerId: 'deepseek', providerName: 'DeepSeek', model: 'fixture-model', chatConsent: true, endpoint: templates[0].endpoint, configured: true, connectivity: 'not_tested', updatedAt: '2026-10-10T00:00:00.000Z' }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
async function mount(owner: string) {
  // Component-state race test, not the app's full document-reload account switch.
  if (!databaseBound) { await bindAccountDatabase('ui-settings-export-fixture'); databaseBound = true }
  pauseSync(); setSessionActive(owner); useAuthStore.setState({ user: user(owner), isAuthenticated: true })
  await act(async () => { tree = create(React.createElement(AIConnectionPanel)) })
  return tree!
}
async function flush() { await act(async () => { await new Promise(resolve => setImmediate(resolve)) }) }
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = undefined; clearSession(); globalThis.fetch = originalFetch })
after(() => { pauseSync(); storage.db.close() })

test('empty account has no selected provider/model; key draft stays out of account export and browser storage', async () => {
  globalThis.fetch = async () => Response.json(empty)
  const rendered = await mount('ui-owner-empty')
  assert.equal(rendered.root.findByType('select').props.value, '')
  const model = rendered.root.findAllByType('input').find(node => node.props.placeholder)
  assert.equal(model?.props.value, '')
  const password = rendered.root.findByProps({ type: 'password' })
  await act(async () => password.props.onChange({ target: { value: key } }))
  assert.equal(rendered.root.findByProps({ type: 'password' }).props.value, key)
  assert.ok(!JSON.stringify([...values]).includes(key))
  assert.ok(!JSON.stringify(await exportAllData()).includes(key))
  assert.equal(await storage.db.outbox.count(), 0)
})

test('same-frame repeated save sends once, clears key only after success and never probes automatically', async () => {
  const pending = deferred<Response>(); let saves = 0; let probes = 0
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/probe')) probes++
    if (init?.method === 'PUT') { saves++; assert.equal(JSON.parse(String(init.body)).apiKey, key); return pending.promise }
    return Response.json(empty)
  }
  const rendered = await mount('ui-owner-save')
  await act(async () => {
    rendered.root.findByType('select').props.onChange({ target: { value: 'deepseek' } })
    rendered.root.findAllByType('input').find(node => node.props.placeholder)!.props.onChange({ target: { value: 'fixture-model' } })
    rendered.root.findByProps({ type: 'password' }).props.onChange({ target: { value: key } })
  })
  await act(async () => {
    const form = rendered.root.findByType('form'); form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} })
  })
  assert.equal(saves, 1); assert.equal(probes, 0)
  assert.equal(rendered.root.findByProps({ type: 'password' }).props.value, key)
  await act(async () => pending.resolve(Response.json({ connection: saved })))
  assert.equal(rendered.root.findByProps({ type: 'password' }).props.value, '')
  assert.ok(JSON.stringify(rendered.toJSON()).includes('连接已保存'))
  assert.equal(probes, 0)
})

test('account switch discards key draft and late configuration response cannot populate another owner', async () => {
  const late = deferred<Response>(); let count = 0
  globalThis.fetch = async () => { count++; return count === 1 ? Response.json(empty) : count === 2 ? late.promise : Response.json(empty) }
  const rendered = await mount('ui-owner-a')
  await act(async () => rendered.root.findByProps({ type: 'password' }).props.onChange({ target: { value: key } }))
  const refresh = rendered.root.findAllByType('button').find(node => node.children.includes('刷新已保存配置'))!
  await act(async () => refresh.props.onClick())
  await act(async () => { clearSession(); setSessionActive('ui-owner-b'); useAuthStore.setState({ user: user('ui-owner-b') }) })
  await flush()
  assert.equal(rendered.root.findByProps({ type: 'password' }).props.value, '')
  await act(async () => late.resolve(Response.json({ ...empty, connection: { ...saved, model: 'FORBIDDEN-OLD-ACCOUNT-MODEL' } })))
  assert.ok(!JSON.stringify(rendered.toJSON()).includes('FORBIDDEN-OLD-ACCOUNT-MODEL'))
  assert.equal(rendered.root.findByType('select').props.value, '')
})

test('changing recipient clears credential draft and chat permission; probe and delete require separate choices', async () => {
  globalThis.fetch = async () => Response.json({ ...empty, connection: saved })
  const rendered = await mount('ui-owner-change')
  await act(async () => rendered.root.findByProps({ type: 'password' }).props.onChange({ target: { value: key } }))
  const checkboxes = rendered.root.findAllByProps({ type: 'checkbox' })
  assert.equal(checkboxes[0].props.checked, true)
  assert.equal(checkboxes[1].props.checked, false); assert.equal(checkboxes[2].props.checked, false)
  await act(async () => rendered.root.findByType('select').props.onChange({ target: { value: 'glm' } }))
  assert.equal(rendered.root.findByProps({ type: 'password' }).props.value, '')
  assert.equal(rendered.root.findAllByProps({ type: 'checkbox' })[0].props.checked, false)
  assert.equal(rendered.root.findByProps({ type: 'password' }).props.required, true)
})
