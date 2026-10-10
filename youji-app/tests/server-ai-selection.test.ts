import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterEach, test } from 'node:test'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import { act } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import ts from 'typescript'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const require = createRequire(import.meta.url)
let owner = 'synthetic-ui-owner'; let generation = 1
let configuration: Record<string, unknown>
const calls: unknown[][] = []
const owned = { connectionId: 'owned-id', version: 1, providerName: 'Synthetic BYOK', model: 'synthetic', chatConsent: true }
const shared = { configurationId: 'a'.repeat(64), endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-synthetic' }
const state = { messages: [], isTyping: false, sendMessage: async (...args: unknown[]) => { calls.push(args) }, addMessage() {}, executeActions() {}, executeSmartAction() {}, clearHistory() {} }
const nullComponent = () => null
function Input(props: { onSend: (text: string) => void }) { return React.createElement('button', { 'aria-label': 'synthetic-send', onClick: () => props.onSend('Synthetic user text') }) }
const mocks: Record<string, unknown> = {
  '../services/userAI': { readAIConfiguration: async () => configuration },
  '../stores/authStore': { useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { id: owner } }) },
  '../services/apiClient': { getSessionGeneration: () => generation, getVerifiedSessionOwner: () => owner },
  'react-router-dom': { useNavigate: () => () => undefined, useLocation: () => ({}) },
  'framer-motion': { useReducedMotion: () => true },
  'lucide-react': { ArrowLeft: nullComponent, Trash2: nullComponent, Target: nullComponent, Phone: nullComponent },
  '../stores/coachStore': { useCoachStore: Object.assign((selector: (state: unknown) => unknown) => selector(state), { getState: () => state }) },
  '../components/coach/MessageList': { MessageList: nullComponent },
  '../components/coach/ChatInput': { ChatInput: Input },
  '../hooks/useMediaQuery': { useMediaQuery: () => false },
  '../components/ui/Modal': { Modal: nullComponent },
  '../components/ui/Button': { Button: nullComponent },
  '../services/emotionEngine': { assessEmotionState: () => ({}), detectCrisisKeywords: () => false },
  '../../server/src/services/safetyResources': { mainlandPsychologicalSupport: {} },
  '../services/coldStartStrategy': { getRecordCoverageWelcome: () => 'Synthetic empty state', subscribeRecordCoverage: () => () => undefined },
  '../components/ui/Brand': { Brand: nullComponent },
}
const code = ts.transpileModule(readFileSync(new URL('../src/pages/Coach.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText
const exports: Record<string, React.ComponentType> = {}
runInNewContext(code, { exports, require: (id: string) => id.endsWith('.css') ? {} : mocks[id] ?? require(id), console })
const Coach = exports.default
let tree: ReactTestRenderer | undefined
async function mount(config = { connection: owned, credentialStorageReady: true, serverAI: shared }) {
  configuration = config; calls.length = 0; owner = 'synthetic-ui-owner'; generation = 1
  await act(async () => { tree = create(React.createElement(Coach)) })
  return tree!
}
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined })

test('real Coach render defaults to no AI even with both providers ready', async () => {
  const t = await mount()
  assert.equal(Boolean(t.root.findByProps({ 'aria-label': '本次页面使用我的模型' }).props.checked), false)
  assert.equal(t.root.findByProps({ 'aria-label': '本次页面使用部署者的基础模型' }).props.checked, false)
  await act(async () => t.root.findByProps({ 'aria-label': 'synthetic-send' }).props.onClick())
  assert.deepEqual(calls, [['Synthetic user text', undefined, undefined]])
})

test('explicit shared consent discloses recipient, routes only to shared, then BYOK selection replaces it', async () => {
  const t = await mount()
  assert.ok(JSON.stringify(t.toJSON()).includes(shared.endpoint))
  await act(async () => t.root.findByProps({ 'aria-label': '本次页面使用部署者的基础模型' }).props.onChange({ target: { checked: true } }))
  await act(async () => t.root.findByProps({ 'aria-label': 'synthetic-send' }).props.onClick())
  assert.equal(calls[0][1], undefined)
  assert.equal(JSON.stringify(calls[0][2]), JSON.stringify({ configurationId: shared.configurationId, consent: true }))
  await act(async () => t.root.findByProps({ 'aria-label': '本次页面使用我的模型' }).props.onChange({ target: { checked: true } }))
  assert.equal(t.root.findByProps({ 'aria-label': '本次页面使用部署者的基础模型' }).props.checked, false)
  await act(async () => t.root.findByProps({ 'aria-label': 'synthetic-send' }).props.onClick())
  assert.equal(JSON.stringify(calls[1][1]), JSON.stringify({ connectionId: owned.connectionId, version: 1 }))
  assert.equal(calls[1][2], undefined)
})

test('account/session changes do not carry shared permission into the next account', async () => {
  const t = await mount()
  await act(async () => t.root.findByProps({ 'aria-label': '本次页面使用部署者的基础模型' }).props.onChange({ target: { checked: true } }))
  owner = 'second-owner'; generation++
  await act(async () => t.update(React.createElement(Coach)))
  assert.equal(t.root.findByProps({ 'aria-label': '本次页面使用部署者的基础模型' }).props.checked, false)
  await act(async () => t.root.findByProps({ 'aria-label': 'synthetic-send' }).props.onClick())
  assert.deepEqual(calls, [['Synthetic user text', undefined, undefined]])
})

test('shared AI is hidden when not configured, independently of account credential storage', async () => {
  configuration = { connection: null, credentialStorageReady: false, serverAI: null }
  await act(async () => { tree = create(React.createElement(Coach)) })
  assert.equal(tree!.root.findAllByProps({ 'aria-label': '本次页面使用部署者的基础模型' }).length, 0)
  assert.ok(JSON.stringify(tree!.toJSON()).includes('未调用外部模型'))
})


test('stale send callback cannot disclose previous account text under a new session before rerender', async () => {
  const t = await mount()
  await act(async () => t.root.findByProps({ 'aria-label': '本次页面使用部署者的基础模型' }).props.onChange({ target: { checked: true } }))
  const staleSend = t.root.findByProps({ 'aria-label': 'synthetic-send' }).props.onClick
  owner = 'next-owner'; generation++
  await act(async () => staleSend())
  assert.deepEqual(calls, [])
})
