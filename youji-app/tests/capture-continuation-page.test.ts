import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import { after, beforeEach, test } from 'node:test';
import * as React from 'react';
import { act } from 'react';
import { create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import ts from 'typescript';
const memory = () => { const map = new Map<string, string>(); return { entries: () => [...map], getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key), clear: () => map.clear() }; };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, localStorage: memory(), sessionStorage: memory(), window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { replace() {} } }), document: { documentElement: { setAttribute() {} } } });
const storage = await import('../src/db/index.ts'), api = await import('../src/services/apiClient.ts'), sync = await import('../src/services/syncEngine.ts');
const capture = await import('../src/services/quickNoteIntegration.ts'), catalog = await import('../src/services/captureDraftCatalog.ts'), parser = await import('../src/services/parser.ts');
const localActor = await import('../src/services/localActor.ts');
const provenance = await import('../src/services/captureInputProvenance.ts');
const inputMemory = await import('../src/services/captureInputMemory.ts');
const handoff = await import('../src/components/capture/useCaptureContinuationHandoff.ts');
const presentation = await import('../src/services/capturePresentation.ts'), pending = await import('../src/services/pendingEditorMemory.ts'), receiptView = await import('../src/services/captureReceiptView.ts');
const auth = await import('../src/stores/authStore.ts'), habits = await import('../src/stores/habitStore.ts'), icons = await import('../src/utils/icons.ts');
const require = createRequire(import.meta.url);
const dexie = await import('dexie');
const nativeTransactions: Array<{ name: string; mode: string }> = [];
const nativeTransaction = IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) { nativeTransactions.push({ name: this.name, mode: args[1] ?? 'readonly' }); return nativeTransaction.apply(this, args); };
const owner = 'synthetic-continuation-page';
const user = { id: owner, phone: 'SYNTHETIC', nickname: '合成目录账号', avatar: '', identity: 'adult', city: '', coachStyle: '', quietStart: '', quietEnd: '', pushLimit: 1 };
const basis = { capturedAt: 1791028800000, timeZone: 'Asia/Shanghai', date: '2026-10-03' };
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const button = (tree: ReactTestRenderer, label: string) => { const found = tree.root.findAllByType('button').filter(node => text(node) === label); assert.equal(found.length, 1, `one visible handler: ${label}`); return found[0]; };
const host = (tag: string) => ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => React.createElement(tag, props, children);
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function settle(test: () => boolean, diagnostic: () => string = () => 'no page diagnostic supplied') { const deadline = performance.now() + 5000; while (performance.now() < deadline) { if (test()) return; await act(async () => { await tick(); }); } assert.ok(test(), `5s host React/IDB readiness deadline: ${diagnostic()}`); }
async function facts() { return storage.db.transaction('r', storage.db.tables, async () => Object.fromEntries(await Promise.all(storage.db.tables.map(async table => [table.name, { keys: await table.toCollection().primaryKeys(), rows: await table.toArray() }])))); }
async function seed(id: string, raw = `  合成${id}原文\n午饭15元；明天交报告  `) {
  const input = await capture.forkCaptureInput(); await capture.saveCaptureInput(input, raw, basis);
  const draft = { ...await capture.createCaptureDraft(raw, input, basis), id }; await capture.saveCaptureDraft(draft, true); return draft;
}
beforeEach(async () => { inputMemory.releaseCaptureInputMemory(inputMemory.retainCaptureInputMemory(owner, '', basis)); sync.pauseSync(); api.clearSession(); localStorage.clear(); sessionStorage.clear(); await storage.bindAccountDatabase(owner); api.setSessionActive(owner); auth.useAuthStore.setState({ user, isAuthenticated: true }); await storage.clearAllData({ allowPending: true }); sync.pauseSync(); globalThis.fetch = async () => { throw new Error('SYNTHETIC_OFFLINE'); }; });
after(() => { sync.pauseSync(); storage.db.close(); IDBDatabase.prototype.transaction = nativeTransaction; });
// Production React components and services; router, animation and Modal host are
// declared substitutes. No browser layout, native focus, clipboard or paint claim.
function setup(page: 'QuickNote' | 'QuickNoteResult', overrides: Record<string, unknown> = {}) {
  const navigations: unknown[][] = [], cache = new Map<string, Record<string, React.ComponentType>>();
  const modules: Record<string, unknown> = {
    'dexie': dexie,
    'react-router-dom': { useLocation: () => ({ key: 'synthetic', search: '', state: null }), useNavigate: () => (...args: unknown[]) => navigations.push(args), Link: host('a') },
    'framer-motion': { motion: new Proxy({}, { get: (_target, key) => String(key) }), useReducedMotion: () => true },
    'lucide-react': new Proxy({}, { get: () => host('svg') }),
    '../components/ui/Button': { Button: host('button') }, '../ui/Button': { Button: host('button') },
    '../components/ui/Checkbox': { Checkbox: ({ label, ...props }: { label?: string }) => React.createElement('input', { type: 'checkbox', 'aria-label': label, ...props }) },
    '../ui/Modal': { Modal: ({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer: React.ReactNode }) => open ? React.createElement('section', { role: 'dialog', 'aria-label': title }, React.createElement('button', { onClick: onClose }, '宿主Esc关闭'), children, footer) : null },
    '../services/captureDraftCatalog': catalog, '../services/quickNoteIntegration': capture, '../services/parser': parser, '../services/capturePresentation': presentation,
    '../components/capture/useCaptureContinuationHandoff': handoff, '../services/captureInputMemory': inputMemory, '../services/localActor': localActor, '../services/captureInputProvenance': provenance, '../services/pendingEditorMemory': pending, '../services/captureReceiptView': receiptView, '../services/apiClient': api,
    '../services/diagnostics': { recordDiagnostic() {} }, '../db': storage, '../utils/icons': icons,
    '../stores/useHabitStore': habits, '../stores/habitStore': habits, '../stores/authStore': auth,
    '../../services/captureDraftCatalog': catalog, '../../services/localActor': localActor, '../../stores/authStore': auth, '../../services/apiClient': api,
    ...overrides,
  };
  function compile(path: string): Record<string, React.ComponentType> {
    if (cache.has(path)) return cache.get(path)!;
    const exports: Record<string, React.ComponentType> = {}; cache.set(path, exports);
    const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2023 } }).outputText;
    // Same JS realm as the actual services: cross-realm VM object literals
    // deliberately fail the service's plain-record check and do not model the app.
    const bindings = { exports, require: (name: string) => name === './QuickNoteResult' ? compile('pages/QuickNoteResult.tsx') : name === '../components/capture/CaptureDraftBrowser' ? compile('components/capture/CaptureDraftBrowser.tsx') : modules[name] ?? require(name), window, document, localStorage, sessionStorage, structuredClone, setTimeout, clearTimeout, queueMicrotask, URLSearchParams, Object, Reflect, Number, JSON };
    runInThisContext(`(function(${Object.keys(bindings).join(',')}) {${code}\n})`)(...Object.values(bindings));
    return exports;
  }
  return { Component: compile(`pages/${page}.tsx`).default, Review: compile(`pages/${page}.tsx`).CaptureReview as React.ComponentType<{ original: capture.CaptureDraft; continuation: { grant: catalog.CaptureContinuation; onClose: () => void } }>, navigations };
}
async function mount(s: ReturnType<typeof setup>) { let tree!: ReactTestRenderer; await act(async () => { tree = create(React.createElement(s.Component)); }); await settle(() => !text(tree.root).includes('正在恢复本机确认稿') && !text(tree.root).includes('正在保留草稿') && !text(tree.root).includes('正在连接本机草稿'), () => text(tree.root)); return tree; }

async function committed(id = 'O', raw = '  已保存独立原文O\n午饭15元  ') {
  const draft = { ...await seed(id, raw), diary: null }; await capture.saveCaptureDraft(draft, true);
  const grant = await catalog.prepareCaptureContinuation((await catalog.listCaptureDraftPage()).entries.find(entry => entry.id === id)!);
  await capture.applyCaptureContinuation(grant); return draft;
}
const pointers = () => (sessionStorage as unknown as ReturnType<typeof memory>).entries();
function counted(extra: Record<string, unknown> = {}) {
  const counts = { loadCaptureReceipt: 0, loadCaptureDraft: 0, createCaptureDraft: 0, saveCaptureDraft: 0, applyCaptureDraft: 0, applyCaptureContinuation: 0, parseQuickNote: 0 };
  const wrapped = Object.fromEntries(Object.keys(counts).filter(key => key !== 'parseQuickNote').map(key => [key, (...args: unknown[]) => { counts[key as keyof typeof counts]++; return Reflect.apply((capture as unknown as Record<string, (...args: unknown[]) => unknown>)[key], capture, args); }]));
  return { counts, modules: { '../services/quickNoteIntegration': { ...capture, ...wrapped, ...extra }, '../services/parser': { ...parser, parseQuickNote: (...args: Parameters<typeof parser.parseQuickNote>) => { counts.parseQuickNote++; return parser.parseQuickNote(...args); } } } };
}
for (const entry of ['draft', 'receipt', 'pointer'] as const) test(`actual result ${entry}: strict same-ID history, no draft loader/parse/create/write`, async () => {
  const old = await committed(); sessionStorage.setItem(capture.captureSessionKey(), old.id);
  const before = await facts(), p = pointers(), start = nativeTransactions.length, c = counted();
  const router = { useLocation: () => ({ key: 'synthetic', search: entry === 'pointer' ? '' : `?${entry}=${old.id}`, state: null }), useNavigate: () => () => assert.fail('history must not navigate'), Link: host('a') };
  const tree = await mount(setup('QuickNoteResult', { ...c.modules, 'react-router-dom': router }));
  try { await settle(() => text(tree.root).includes('这次记录已保存在本机')); assert.match(text(tree.root), /已保存独立原文O/); assert.deepEqual(c.counts, { loadCaptureReceipt: 1, loadCaptureDraft: 0, createCaptureDraft: 0, saveCaptureDraft: 0, applyCaptureDraft: 0, applyCaptureContinuation: 0, parseQuickNote: 0 }); assert.deepEqual(await facts(), before); assert.deepEqual(pointers(), p); assert.ok(nativeTransactions.slice(start).every(tx => tx.mode === 'readonly')); }
  finally { await act(async () => tree.unmount()); }
});
for (const damage of ['proof', 'source', 'index', 'head'] as const) test(`actual result damaged ${damage} visibly refuses history and never opens editable or empty draft`, async () => {
  const old = await committed(); const key = damage === 'proof' ? `capture-continuation-proof:${old.id}` : damage === 'source' ? `capture-source:${old.id}` : damage === 'index' ? `capture-input-consumption:${old.inputKey}` : `capture-input-consumption-head:${old.inputKey}`;
  await storage.db.settings.delete(key); const before = await facts(), p = pointers(), c = counted();
  const tree = await mount(setup('QuickNoteResult', { ...c.modules, 'react-router-dom': { useLocation: () => ({ key: 'synthetic', search: '?draft=O', state: null }), useNavigate: () => () => assert.fail('no fallback navigation'), Link: host('a') } }));
  try { await settle(() => text(tree.root).includes('暂时读不到本机确认稿')); assert.doesNotMatch(text(tree.root), /这次记录已保存在本机|选择要留下的记录|当前账号的本机存储中没有找到/); assert.equal(c.counts.loadCaptureDraft, 0); assert.equal(c.counts.parseQuickNote + c.counts.createCaptureDraft + c.counts.saveCaptureDraft + c.counts.applyCaptureDraft, 0); assert.deepEqual(await facts(), before); assert.deepEqual(pointers(), p); }
  finally { await act(async () => tree.unmount()); }
});
test('actual route change never shows previous receipt under the next requested ID while its read is pending', async () => {
  const old = { ...await seed('O', '  已保存独立原文O\n午饭15元  '), diary: null }; await capture.saveCaptureDraft(old, true); const other = { ...await seed('D', '  第二份精确原文D  '), diary: null }; await capture.saveCaptureDraft(other, true); await capture.applyCaptureContinuation(await catalog.prepareCaptureContinuation((await catalog.listCaptureDraftPage()).entries.find(e => e.id === old.id)!)); const g = await catalog.prepareCaptureContinuation((await catalog.listCaptureDraftPage()).entries.find(e => e.id === other.id)!); await capture.applyCaptureContinuation(g);
  let search = '?receipt=O', release!: () => void; const gate = new Promise<void>(r => release = r); const c = counted({ loadCaptureReceipt: async (id: string) => { c.counts.loadCaptureReceipt++; if (id === 'D') await gate; return capture.loadCaptureReceipt(id); } });
  const s = setup('QuickNoteResult', { ...c.modules, 'react-router-dom': { useLocation: () => ({ key: 'synthetic', search, state: null }), useNavigate: () => () => {}, Link: host('a') } });
  const tree = await mount(s); const before = await facts(), p = pointers();
  try { assert.match(text(tree.root), /已保存独立原文O/); search = '?receipt=D'; await act(async () => tree.update(React.createElement(s.Component))); assert.doesNotMatch(text(tree.root), /已保存独立原文O/, 'old loaded receipt must not be relabeled as new ID'); release(); await settle(() => text(tree.root).includes('第二份精确原文D')); assert.doesNotMatch(text(tree.root), /已保存独立原文O/); assert.equal(c.counts.loadCaptureDraft, 0); assert.deepEqual(await facts(), before); assert.deepEqual(pointers(), p); assert.equal(old.id, 'O'); }
  finally { release(); await act(async () => tree.unmount()); }
});
test('actual saved-result new-note action must start empty without reusing consumed original', async () => {
  const old = await committed(); const before = await facts(); const s = setup('QuickNoteResult', { 'react-router-dom': { useLocation: () => ({ key: 'synthetic', search: '?receipt=O', state: null }), useNavigate: () => (...args: unknown[]) => navigations.push(args), Link: host('a') } }); const navigations: unknown[][] = [];
  const tree = await mount(s); let composer: ReactTestRenderer | undefined;
  try { await act(async () => { button(tree, '再记一条').props.onClick(); await tick(); }); await settle(() => navigations.length === 1); composer = await mount(setup('QuickNote')); assert.equal(composer.root.findByProps({ 'aria-label': '速记内容' }).props.value, '', 'explicit new input must not inherit O consumed raw'); const after = await facts(); for (const [name, snapshot] of Object.entries(before)) if (name !== 'settings') assert.deepEqual(after[name], snapshot); for (const row of before.settings.rows) assert.deepEqual(await storage.db.settings.get(row.key), row); assert.equal((await capture.loadCaptureReceipt(old.id))?.input, old.input); }
  finally { if (composer) await act(async () => composer!.unmount()); await act(async () => tree.unmount()); }
});

for (const change of ['generation', 'epoch'] as const) test(`actual historical page ${change} change hides the old authorized content`, async () => {
  await committed(); let release!: () => void; const gate = new Promise<void>(r => release = r); let reads = 0;
  const c = counted({ loadCaptureReceipt: async (id: string) => { c.counts.loadCaptureReceipt++; if (++reads > 1) await gate; return capture.loadCaptureReceipt(id); } });
  const s = setup('QuickNoteResult', { ...c.modules, 'react-router-dom': { useLocation: () => ({ key: 'synthetic', search: '?receipt=O', state: null }), useNavigate: () => () => {}, Link: host('a') } }); const tree = await mount(s); const before = await facts();
  try {
    assert.match(text(tree.root), /已保存独立原文O/);
    await act(async () => { if (change === 'generation') { api.setSessionActive(owner); auth.useAuthStore.setState({ user: { ...user } }); } else await storage.db.settings.put({ key: storage.LOCAL_DATA_EPOCH_KEY, value: 'synthetic-new-epoch' }); });
    await settle(() => !text(tree.root).includes('已保存独立原文O'));
    if (change === 'generation') { release(); await settle(() => text(tree.root).includes('已保存独立原文O')); }
    else assert.match(text(tree.root), /需要重新核对账号/);
    const after = await facts(); if (change === 'epoch') before.settings.rows = before.settings.rows.map(row => row.key === storage.LOCAL_DATA_EPOCH_KEY ? { ...row, value: 'synthetic-new-epoch' } : row); assert.deepEqual(after, before); assert.equal(c.counts.loadCaptureDraft, 0);
  } finally { release(); await act(async () => tree.unmount()); }
});
for (const late of ['resolve', 'reject'] as const) test(`actual old receipt read late ${late} cannot overwrite current requested result`, async () => {
  const o = { ...await seed('O', '旧请求独立原文O'), diary: null }, d = { ...await seed('D', '当前请求独立原文D'), diary: null }; await capture.saveCaptureDraft(o); await capture.saveCaptureDraft(d);
  for (const original of [o,d]) await capture.applyCaptureContinuation(await catalog.prepareCaptureContinuation((await catalog.listCaptureDraftPage()).entries.find(e => e.id === original.id)!));
  let release!: () => void; const gate = new Promise<void>(r => release = r); let search = '?receipt=O', entered = false;
  const c = counted({ loadCaptureReceipt: async (id: string) => { c.counts.loadCaptureReceipt++; const result = await capture.loadCaptureReceipt(id); if (id === 'O') { entered = true; await gate; if (late === 'reject') throw new Error('SYNTHETIC_OLD_ERROR'); } return result; } });
  const s = setup('QuickNoteResult', { ...c.modules, 'react-router-dom': { useLocation: () => ({ key: 'synthetic', search, state: null }), useNavigate: () => () => {}, Link: host('a') } }); let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(s.Component)); });
  try { await settle(() => entered); search = '?receipt=D'; await act(async () => tree.update(React.createElement(s.Component))); await settle(() => text(tree.root).includes('当前请求独立原文D')); const before = await facts(); release(); await act(async () => { await tick(); await tick(); }); assert.match(text(tree.root), /当前请求独立原文D/); assert.doesNotMatch(text(tree.root), /旧请求独立原文O|暂时读不到本机确认稿/); assert.deepEqual(await facts(), before); }
  finally { release(); await act(async () => tree.unmount()); }
});

for (const value of ['', '  尚未落盘的原文\n尾部  ']) test(`actual new-input action refuses retained memory (${value.length} chars) without any writes or pointer change`, async () => {
  await committed(); const token = inputMemory.retainCaptureInputMemory(owner, value, basis); const s = setup('QuickNoteResult', { 'react-router-dom': { useLocation: () => ({ key: 'synthetic', search: '?receipt=O', state: null }), useNavigate: () => (...args: unknown[]) => navigations.push(args), Link: host('a') } }); const navigations: unknown[][] = []; const tree = await mount(s); const before = await facts(), p = pointers();
  try { await act(async () => button(tree, '再记一条').props.onClick()); assert.match(text(tree.root), /还有尚未确认落盘的原文/); assert.deepEqual(await facts(), before); assert.deepEqual(pointers(), p); assert.deepEqual(navigations, []); assert.deepEqual(inputMemory.readCaptureInputMemory(owner), { owner, text: value, context: basis }); }
  finally { inputMemory.releaseCaptureInputMemory(token); await act(async () => tree.unmount()); }
});
for (const change of ['memory', 'generation', 'unmount'] as const) test(`actual late empty-input ${change} change cannot select a pointer or navigate`, async () => {
  await committed(); let release!: () => void, entered = false; const gate = new Promise<void>(r => release = r); const navigations: unknown[][] = [];
  const s = setup('QuickNoteResult', { '../services/quickNoteIntegration': { ...capture, createEmptyCaptureInput: async () => { const value = await capture.createEmptyCaptureInput(); entered = true; await gate; return value; } }, 'react-router-dom': { useLocation: () => ({ key: 'synthetic', search: '?receipt=O', state: null }), useNavigate: () => (...args: unknown[]) => navigations.push(args), Link: host('a') } }); const tree = await mount(s); const before = await facts(), p = pointers(); let token: inputMemory.CaptureInputMemoryToken | undefined;
  try {
    await act(async () => { button(tree, '再记一条').props.onClick(); }); await settle(() => entered);
    if (change === 'memory') token = inputMemory.retainCaptureInputMemory(owner, '  之后新编辑，必须保留  ', basis);
    if (change === 'generation') await act(async () => { api.setSessionActive(owner); auth.useAuthStore.setState({ user: { ...user } }); });
    if (change === 'unmount') await act(async () => tree.unmount());
    release(); await act(async () => { await tick(); await tick(); });
    assert.deepEqual(navigations, []); assert.deepEqual(pointers(), p);
    const after = await facts(); for (const [name, snapshot] of Object.entries(before)) if (name !== 'settings') assert.deepEqual(after[name], snapshot); for (const row of before.settings.rows) assert.deepEqual(await storage.db.settings.get(row.key), row);
    assert.equal(after.settings.rows.length, before.settings.rows.length + 3, 'only detached empty input/context/origin from completed preparation may remain');
    if (token) assert.equal(inputMemory.readCaptureInputMemory(owner)?.text, '  之后新编辑，必须保留  ');
  } finally { release(); if (token) inputMemory.releaseCaptureInputMemory(token); if (change !== 'unmount') await act(async () => tree.unmount()); }
});
test('actual older composer autosave completion cannot release a newer retained input token', async () => {
  let release!: () => void, entered = false; const gate = new Promise<void>(r => release = r);
  const s = setup('QuickNote', { '../services/quickNoteIntegration': { ...capture, saveCaptureInput: async (...args: Parameters<typeof capture.saveCaptureInput>) => { entered = true; await gate; return capture.saveCaptureInput(...args); } } }); let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(s.Component)); });
  try { await settle(() => entered); const token = inputMemory.retainCaptureInputMemory(owner, '更晚保留的另一个实例原文', basis); release(); await settle(() => text(tree.root).includes('原文已保留在本机')); assert.equal(inputMemory.readCaptureInputMemory(owner)?.text, '更晚保留的另一个实例原文'); inputMemory.releaseCaptureInputMemory(token); }
  finally { release(); await act(async () => tree.unmount()); }
});
test('explicit empty-root service writes only its own three new rows, then a new draft can be saved without consuming historical input', async () => {
  const old = await committed(); const before = await facts(), p = pointers(); const fresh = await capture.createEmptyCaptureInput(); assert.equal(fresh.text, ''); assert.notEqual(fresh.key, old.inputKey); assert.deepEqual(pointers(), p);
  const origin = (await storage.db.settings.get(`capture-input-origin:${fresh.key}`))?.value; assert.equal(origin.parent, 'root'); assert.equal(origin.sourceKey, fresh.key); assert.equal(origin.input.present, false); assert.equal(origin.context.present, false);
  const after = await facts(); assert.equal(after.settings.rows.length, before.settings.rows.length + 3); for (const row of before.settings.rows) assert.deepEqual(await storage.db.settings.get(row.key), row);
  const raw = '新的独立原文'; await capture.saveCaptureInput(fresh, raw); const draft = await capture.createCaptureDraft(raw, fresh); await capture.saveCaptureDraft(draft); assert.notEqual(draft.id, old.id); assert.equal((await storage.db.settings.get(`capture-review:${draft.id}`))?.value.input, raw); for (const row of before.settings.rows) assert.deepEqual(await storage.db.settings.get(row.key), row); assert.deepEqual((await facts()).outbox, before.outbox);
});
for (const fault of ['quota', 'epoch', 'collision'] as const) test(`empty-root ${fault} refusal rolls back all rows and leaves both session pointers`, async () => {
  await committed(); const before = await facts(), p = pointers(), add = storage.db.settings.add, get = storage.db.settings.get; let fired = false;
  storage.db.settings.add = function(...args: Parameters<typeof add>) { if (fault === 'quota' && args[0].key.startsWith('capture-input-origin:')) { fired = true; return Promise.reject(new DOMException('synthetic quota', 'QuotaExceededError')) as ReturnType<typeof add>; } return add.apply(this, args); };
  storage.db.settings.get = function(...args: Parameters<typeof get>) { return get.apply(this, args).then(row => { if (fault === 'collision' && args[0].startsWith('capture-input:') && row === undefined) { fired = true; return { key: args[0], value: undefined }; } return row; }); };
  if (fault === 'epoch') { let count = 0; storage.db.settings.get = function(...args: Parameters<typeof get>) { return get.apply(this,args).then(row => { if (args[0] === storage.LOCAL_DATA_EPOCH_KEY && ++count === 3) { fired = true; return { key: storage.LOCAL_DATA_EPOCH_KEY, value: 'synthetic-wrong-epoch' }; } return row; }); }; }
  try { await assert.rejects(capture.createEmptyCaptureInput()); } finally { storage.db.settings.add = add; storage.db.settings.get = get; }
  assert.equal(fired,true); assert.deepEqual(await facts(),before); assert.deepEqual(pointers(),p);
});
