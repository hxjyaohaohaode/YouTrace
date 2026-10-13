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
const memory = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key), clear: () => map.clear() }; };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, localStorage: memory(), sessionStorage: memory(), window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { replace() {} } }), document: { documentElement: { setAttribute() {} } } });
const storage = await import('../src/db/index.ts'), api = await import('../src/services/apiClient.ts'), sync = await import('../src/services/syncEngine.ts');
const capture = await import('../src/services/quickNoteIntegration.ts'), catalog = await import('../src/services/captureDraftCatalog.ts'), parser = await import('../src/services/parser.ts');
const localActor = await import('../src/services/localActor.ts');
const presentation = await import('../src/services/capturePresentation.ts'), pending = await import('../src/services/pendingEditorMemory.ts'), receiptView = await import('../src/services/captureReceiptView.ts');
const auth = await import('../src/stores/authStore.ts'), habits = await import('../src/stores/habitStore.ts'), icons = await import('../src/utils/icons.ts');
const require = createRequire(import.meta.url);
const dexie = await import('dexie');
const nativeTransactions: Array<{ name: string; mode: string }> = [];
const nativeTransaction = IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) { nativeTransactions.push({ name: this.name, mode: args[1] ?? 'readonly' }); return nativeTransaction.apply(this, args); };
const owner = 'synthetic-catalog-component';
const user = { id: owner, phone: 'SYNTHETIC', nickname: '合成目录账号', avatar: '', identity: 'adult', city: '', coachStyle: '', quietStart: '', quietEnd: '', pushLimit: 1 };
const basis = { capturedAt: 1791028800000, timeZone: 'Asia/Shanghai', date: '2026-10-03' };
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const button = (tree: ReactTestRenderer, label: string) => { const found = tree.root.findAllByType('button').filter(node => text(node) === label); assert.equal(found.length, 1, `one visible handler: ${label}`); return found[0]; };
const host = (tag: string) => ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => React.createElement(tag, props, children);
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function settle(test: () => boolean, diagnostic: () => string = () => '') { for (let i = 0; i < 200; i++) { if (test()) return; await act(async () => { await tick(); }); } assert.ok(test(), `bounded React/IDB settle: ${diagnostic()}`); }
async function facts() { return storage.db.transaction('r', storage.db.tables, async () => Object.fromEntries(await Promise.all(storage.db.tables.map(async table => [table.name, await table.toArray()])))); }
async function seed(id: string, raw = `  合成${id}原文\n午饭15元；明天交报告  `) {
  const input = await capture.forkCaptureInput(); await capture.saveCaptureInput(input, raw, basis);
  const draft = { ...await capture.createCaptureDraft(raw, input, basis), id }; await capture.saveCaptureDraft(draft, true); return draft;
}
beforeEach(async () => { sync.pauseSync(); api.clearSession(); localStorage.clear(); sessionStorage.clear(); await storage.bindAccountDatabase(owner); api.setSessionActive(owner); auth.useAuthStore.setState({ user, isAuthenticated: true }); await storage.clearAllData({ allowPending: true }); sync.pauseSync(); });
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
    '../services/pendingEditorMemory': pending, '../services/captureReceiptView': receiptView, '../services/apiClient': api,
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
    const bindings = { exports, require: (name: string) => name === '../components/capture/CaptureDraftBrowser' ? compile('components/capture/CaptureDraftBrowser.tsx') : modules[name] ?? require(name), window, document, localStorage, sessionStorage, structuredClone, setTimeout, clearTimeout, queueMicrotask, URLSearchParams, Object, Reflect, Number, JSON };
    runInThisContext(`(function(${Object.keys(bindings).join(',')}) {${code}\n})`)(...Object.values(bindings));
    return exports;
  }
  return { Component: compile(`pages/${page}.tsx`).default, Review: compile(`pages/${page}.tsx`).CaptureReview as React.ComponentType<{ original: capture.CaptureDraft; continuation: { grant: catalog.CaptureContinuation; onClose: () => void } }>, navigations };
}
async function mount(s: ReturnType<typeof setup>) { let tree!: ReactTestRenderer; await act(async () => { tree = create(React.createElement(s.Component)); }); await settle(() => !text(tree.root).includes('正在恢复本机确认稿') && !text(tree.root).includes('正在保留草稿') && !text(tree.root).includes('正在连接本机草稿')); return tree; }
for (const page of ['QuickNote', 'QuickNoteResult'] as const) test(`actual ${page}: read-only catalog entry is discoverable without changing the existing editor`, async () => {
  await seed('O'); await seed('D'); const s = setup(page), tree = await mount(s);
  try { const before = await facts(); assert.equal(button(tree, '查看本机未提交稿').props.disabled, false); assert.deepEqual(await facts(), before); assert.deepEqual(s.navigations, []); }
  finally { await act(async () => tree.unmount()); }
});

async function click(tree: ReactTestRenderer, label: string) { await act(async () => { button(tree, label).props.onClick(); await tick(); }); }
async function openDirectory(tree: ReactTestRenderer) { await click(tree, '查看本机未提交稿'); await settle(() => text(tree.root).includes('本次读取的主键顺序') || tree.root.findAllByProps({ role: 'alert' }).length > 0); }
const editorFields = (tree: ReactTestRenderer) => tree.root.findAll(node => ['input', 'textarea', 'select'].includes(String(node.type))).map(node => ({ type: node.type, label: node.props['aria-label'], value: node.props.value, checked: node.props.checked, disabled: node.props.disabled }));
for (const pageName of ['QuickNote', 'QuickNoteResult'] as const) test(`actual ${pageName}: original O details, return and close preserve D editor and every stored field with zero write attempts`, async () => {
  const original = await seed('O', '  原文O\n完整末尾  ');
  const corrected = { ...original, diary: '  已修正日记\n末尾  ', diaryExcludedText: '取消日记仍保留原句', expenses: [{ id: 'e', name: '修改后的收支', amount: 1234, amountText: '12.34', category: 'food', date: basis.date, currency: 'CNY' as const, confirmed: false }], todos: [{ id: 't', text: '已修正待办', confirmed: true, dueDate: '2026-10-04' }] };
  await capture.saveCaptureDraft(corrected, true); await seed('D', '  当前编辑D\n不可覆盖  ');
  const s = setup(pageName), tree = await mount(s);
  try {
    const before = await facts(), fields = editorFields(tree), input = sessionStorage.getItem(`youtrace:input:${owner}`), review = sessionStorage.getItem(capture.captureSessionKey());
    const start = nativeTransactions.length;
    await openDirectory(tree); assert.match(text(tree.root), /原编号：O/); assert.match(text(tree.root), /原编号：D/);
    await act(async () => tree.root.findByProps({ 'aria-label': '查看原稿 O' }).props.onClick());
    await settle(() => tree.root.findAllByProps({ 'aria-label': '只读完整原文' }).length === 1, () => text(tree.root));
    assert.equal(text(tree.root.findByProps({ 'aria-label': '只读完整原文' })), corrected.input);
    assert.match(text(tree.root), /未选 · 修改后的收支/); assert.match(text(tree.root), /已选 · 已修正待办/); assert.match(text(tree.root), /取消日记仍保留原句/);
    const dialog = tree.root.findByProps({ role: 'dialog' }); assert.equal(dialog.findAllByType('input').length, 0); assert.equal(dialog.findAllByType('textarea').length, 0);
    assert.equal(dialog.findAllByType('button').some(node => /保存|继续核对|恢复|认领/.test(text(node))), false);
    assert.deepEqual(editorFields(tree), fields);
    await click(tree, '返回目录'); assert.match(text(tree.root), /原编号：O/); await click(tree, '关闭查看');
    assert.equal(tree.root.findAllByProps({ role: 'dialog' }).length, 0); assert.deepEqual(editorFields(tree), fields);
    const observed = nativeTransactions.slice(start); assert.ok(observed.length > 0); assert.ok(observed.every(tx => tx.mode === 'readonly'), JSON.stringify(observed));
    assert.deepEqual(await facts(), before); assert.equal(sessionStorage.getItem(`youtrace:input:${owner}`), input); assert.equal(sessionStorage.getItem(capture.captureSessionKey()), review); assert.deepEqual(s.navigations, []);
  } finally { await act(async () => tree.unmount()); }
});

test('actual directory: empty, skipped prefix pagination and final unsupported state are distinct', async () => {
  await seed('D'); const s = setup('QuickNote'), tree = await mount(s);
  try {
    const source = (await catalog.listCaptureDraftPage()).entries[0].draft;
    for (let i = 0; i < 21; i++) { const id = `0-${String(i).padStart(2,'0')}`; await storage.db.settings.put({ key: `capture-review:${id}`, value: { ...source, id, ownerId: undefined } }); }
    await openDirectory(tree); assert.match(text(tree.root), /本页没有可显示的稿，仍有后续候选/); assert.doesNotMatch(text(tree.root), /原编号：D/);
    await click(tree, '继续扫描后续稿'); await settle(() => text(tree.root).includes('原编号：D')); assert.match(text(tree.root), /本页 1 项不能/);
    await click(tree, '关闭查看'); await storage.db.settings.delete('capture-review:D');
    await openDirectory(tree); await click(tree, '继续扫描后续稿'); await settle(() => text(tree.root).includes('没有可安全列出的未提交稿'));
    assert.doesNotMatch(text(tree.root), /没有任何旧稿|数据库为空/);
  } finally { await act(async () => tree.unmount()); }
});

test('actual detail: source modification invalidates the selected snapshot, never silently shows a new version', async () => {
  const source = await seed('O'); await seed('D'); const tree = await mount(setup('QuickNote'));
  try {
    await openDirectory(tree); await act(async () => tree.root.findByProps({ 'aria-label': '查看原稿 O' }).props.onClick()); await settle(() => tree.root.findAllByProps({ 'aria-label': '只读完整原文' }).length === 1, () => text(tree.root));
    const changed = { ...source, input: '随后改变的原文，未被选择' };
    await act(async () => { await storage.db.settings.put({ key: 'capture-review:O', value: changed }); });
    await settle(() => tree.root.findAllByProps({ role: 'alert' }).length > 0);
    assert.equal(tree.root.findAllByProps({ 'aria-label': '只读完整原文' }).length, 0); assert.doesNotMatch(text(tree.root), /随后改变的原文，未被选择/);
    assert.deepEqual((await storage.db.settings.get('capture-review:O'))?.value, changed);
  } finally { await act(async () => tree.unmount()); }
});

function deferred<T>() { let resolve!: (value: T) => void, reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('actual directory read failure is visible, never empty or a new draft, and explicit retry recovers original IDs', async () => {
  await seed('O'); await seed('D'); let failures = 1;
  const s = setup('QuickNote', { '../../services/captureDraftCatalog': { ...catalog, listCaptureDraftPage: (...args: Parameters<typeof catalog.listCaptureDraftPage>) => failures-- > 0 ? Promise.reject(new Error('合成只读故障')) : catalog.listCaptureDraftPage(...args) } }), tree = await mount(s);
  try {
    const before = await facts(), start = nativeTransactions.length; await openDirectory(tree);
    assert.match(text(tree.root), /暂时无法读取本机未提交稿/); assert.doesNotMatch(text(tree.root), /没有可安全列出|原编号：O/);
    await click(tree, '重新读取目录'); await settle(() => text(tree.root).includes('原编号：O'));
    assert.deepEqual(await facts(), before); assert.ok(nativeTransactions.slice(start).every(tx => tx.mode === 'readonly'));
  } finally { await act(async () => tree.unmount()); }
});

test('actual selection rejects a newly committed draft and malformed epoch, without silently reopening or rebinding it', async () => {
  const source = await seed('O'); await seed('D'); const tree = await mount(setup('QuickNote'));
  try {
    await openDirectory(tree); await storage.db.settings.put({ key: 'capture-applied:O', value: undefined });
    const committed = await facts(), start = nativeTransactions.length;
    await act(async () => tree.root.findByProps({ 'aria-label': '查看原稿 O' }).props.onClick());
    await settle(() => tree.root.findAllByProps({ role: 'alert' }).length > 0);
    assert.equal(tree.root.findAllByProps({ 'aria-label': '只读完整原文' }).length, 0); assert.deepEqual(await facts(), committed);
    assert.ok(nativeTransactions.slice(start).every(tx => tx.mode === 'readonly'));
    await click(tree, '重新读取目录'); await settle(() => text(tree.root).includes('原编号：D'));
    assert.doesNotMatch(text(tree.root), /原编号：O/);
    await act(async () => { await storage.db.settings.put({ key: storage.LOCAL_DATA_EPOCH_KEY, value: undefined }); });
    await settle(() => text(tree.root).includes('账号或本机资料已变化'));
    assert.doesNotMatch(text(tree.root), /原编号：D/); assert.deepEqual((await storage.db.settings.get('capture-review:O'))?.value, source);
  } finally { await act(async () => tree.unmount()); }
});

for (const outcome of ['resolve', 'reject'] as const) test(`actual component: late ${outcome} from a closed directory cannot replace a newly opened page`, async () => {
  await seed('O'); await seed('D'); const held = deferred<Awaited<ReturnType<typeof catalog.listCaptureDraftPage>>>(); let first = true;
  const tree = await mount(setup('QuickNote', { '../../services/captureDraftCatalog': { ...catalog, listCaptureDraftPage: (...args: Parameters<typeof catalog.listCaptureDraftPage>) => { if (first) { first = false; return held.promise; } return catalog.listCaptureDraftPage(...args); } } }));
  try {
    const before = await facts(); await click(tree, '查看本机未提交稿'); assert.match(text(tree.root), /正在读取本机未提交稿/);
    await click(tree, '关闭查看'); await openDirectory(tree); assert.match(text(tree.root), /原编号：O/);
    await act(async () => { if (outcome === 'resolve') held.resolve(await catalog.listCaptureDraftPage()); else held.reject(new Error('旧请求私有诊断不可显示')); await tick(); });
    assert.match(text(tree.root), /原编号：O/); assert.doesNotMatch(text(tree.root), /旧请求私有诊断不可显示/); assert.equal(tree.root.findAllByProps({ role: 'alert' }).length, 0); assert.deepEqual(await facts(), before);
  } finally { held.reject(new Error('cleanup')); await act(async () => tree.unmount()); }
});

test('actual auth render hides old issued detail after session replacement; source and all stored fields remain exact', async () => {
  await seed('O', '合成仅旧身份可看的原文'); await seed('D'); const tree = await mount(setup('QuickNote'));
  try {
    await openDirectory(tree); await act(async () => tree.root.findByProps({ 'aria-label': '查看原稿 O' }).props.onClick()); await settle(() => tree.root.findAllByProps({ 'aria-label': '只读完整原文' }).length === 1);
    const before = await facts(); await act(async () => { api.setSessionActive(owner); auth.useAuthStore.setState({ user: { ...user } }); await tick(); });
    await settle(() => text(tree.root).includes('账号或本机资料已变化') && tree.root.findAllByType('button').some(node => text(node) === '重新读取目录'));
    assert.equal(tree.root.findAllByProps({ 'aria-label': '只读完整原文' }).length, 0); assert.doesNotMatch(text(tree.root), /合成仅旧身份可看的原文/); assert.deepEqual(await facts(), before);
  } finally { await act(async () => tree.unmount()); }
});

test('actual component generation rejects deliberately late observable callbacks after back and close (observable scheduling substitute)', async () => {
  await seed('O'); await seed('D');
  type Observer = { next: (value: unknown) => void; error: (cause: unknown) => void };
  const subscriptions: Array<{ read: () => Promise<unknown>; observer: Observer; stopped: boolean }> = [];
  const tree = await mount(setup('QuickNote', { dexie: { liveQuery: (read: () => Promise<unknown>) => ({ subscribe: (observer: Observer) => { const s = { read, observer, stopped: false }; subscriptions.push(s); return { unsubscribe() { s.stopped = true; } }; } }) } }));
  try {
    const before = await facts(); await openDirectory(tree);
    await act(async () => tree.root.findByProps({ 'aria-label': '查看原稿 O' }).props.onClick());
    assert.match(text(tree.root), /正在核验这一份原稿/); assert.equal(tree.root.findAllByProps({ 'aria-label': '只读完整原文' }).length, 0);
    const detail = subscriptions.at(-1)!, value = await detail.read(); await act(async () => detail.observer.next(value));
    assert.equal(tree.root.findAllByProps({ 'aria-label': '只读完整原文' }).length, 1);
    await click(tree, '返回目录'); assert.equal(detail.stopped, true);
    await act(async () => { detail.observer.next(value); detail.observer.error(new Error('迟到已关闭详情')); });
    assert.equal(tree.root.findAllByProps({ 'aria-label': '只读完整原文' }).length, 0); assert.doesNotMatch(text(tree.root), /迟到已关闭详情/);
    await click(tree, '关闭查看'); await act(async () => detail.observer.next(value));
    assert.equal(tree.root.findAllByProps({ role: 'dialog' }).length, 0); assert.deepEqual(await facts(), before);
  } finally { await act(async () => tree.unmount()); }
});

for (const pageName of ['QuickNote', 'QuickNoteResult'] as const) test(`actual ${pageName}: a previously queued autosave finishes exactly once while readonly browsing adds no writes`, async () => {
  await seed('O'); await seed('D'); const held = deferred<void>(); let hold = false;
  const inputCalls: Parameters<typeof capture.saveCaptureInput>[] = [], draftCalls: Parameters<typeof capture.saveCaptureDraft>[] = [];
  const tree = await mount(setup(pageName, { '../services/quickNoteIntegration': { ...capture,
    saveCaptureInput: async (...args: Parameters<typeof capture.saveCaptureInput>) => { inputCalls.push(structuredClone(args)); if (hold) await held.promise; return capture.saveCaptureInput(...args); },
    saveCaptureDraft: async (...args: Parameters<typeof capture.saveCaptureDraft>) => { draftCalls.push(structuredClone(args)); if (hold) await held.promise; return capture.saveCaptureDraft(...args); },
  } }));
  try {
    hold = true; const priorInputs = inputCalls.length, priorDrafts = draftCalls.length, before = await facts();
    const edit = '  已排队但尚未落盘的当前D修改\n原尾空白  ';
    await act(async () => { const field = pageName === 'QuickNote' ? tree.root.findByType('textarea') : tree.root.findByProps({ 'aria-label': '日记内容' }); field.props.onChange({ target: { value: edit } }); await tick(); });
    await settle(() => pageName === 'QuickNote' ? inputCalls.length === priorInputs + 1 : draftCalls.length === priorDrafts + 1);
    const expected = structuredClone(before), fields = editorFields(tree), transactionStart = nativeTransactions.length;
    await openDirectory(tree); await act(async () => tree.root.findByProps({ 'aria-label': '查看原稿 O' }).props.onClick()); await settle(() => tree.root.findAllByProps({ 'aria-label': '只读完整原文' }).length === 1);
    assert.deepEqual(await facts(), before); assert.ok(nativeTransactions.slice(transactionStart).every(tx => tx.mode === 'readonly')); assert.deepEqual(editorFields(tree), fields);
    const replace = (key: string, value: unknown) => { const row = (expected.settings as Array<{ key: string; value: unknown }>).find(row => row.key === key); assert.ok(row, `existing exact key ${key}`); row.value = structuredClone(value); };
    if (pageName === 'QuickNote') { const [input, raw, context] = inputCalls.at(-1)!; assert.equal(raw, edit); replace(input.key, raw); replace(`${input.key}:context`, context); }
    else { const [draft, current, fingerprint] = draftCalls.at(-1)!; assert.equal(draft.diary, edit); assert.equal(current, true); assert.equal(typeof fingerprint, 'string'); replace(`capture-review:${draft.id}`, draft); replace('quicknote_review', draft); }
    const writeStart = nativeTransactions.length; await act(async () => { held.resolve(); await tick(); });
    await settle(() => pageName === 'QuickNote' ? text(tree.root).includes('原文已保留在本机') : text(tree.root).includes('确认稿已保留在本机'));
    await click(tree, '返回目录'); await click(tree, '关闭查看');
    assert.equal(inputCalls.length, priorInputs + (pageName === 'QuickNote' ? 1 : 0)); assert.equal(draftCalls.length, priorDrafts + (pageName === 'QuickNoteResult' ? 1 : 0));
    assert.equal(nativeTransactions.slice(writeStart).filter(tx => tx.mode === 'readwrite').length, 1); assert.deepEqual(await facts(), expected); assert.deepEqual(editorFields(tree), fields);
  } finally { held.resolve(); await act(async () => tree.unmount()); }
});

test('actual readonly details preserve full whitespace, explicit undefined, negative zero and original child ordering', async () => {
  const source = await seed('O'), original = { ...source, diaryExcludedText: undefined, moodScore: -0, todos: [{ id: 'z', text: ' z\n ', confirmed: false }, { id: 'a', text: ' a ', confirmed: true }] };
  await capture.saveCaptureDraft(original, true); await seed('D'); const tree = await mount(setup('QuickNote'));
  try {
    const before = await facts(); await openDirectory(tree); await act(async () => tree.root.findByProps({ 'aria-label': '查看原稿 O' }).props.onClick()); await settle(() => tree.root.findAllByProps({ 'aria-label': '只读完整字段' }).length === 1);
    const fields = text(tree.root.findByProps({ 'aria-label': '只读完整字段' })); assert.match(fields, /"diaryExcludedText": undefined（字段存在）/); assert.match(fields, /"moodScore": -0/);
    assert.ok(fields.indexOf('"id": "z"') < fields.indexOf('"id": "a"')); assert.ok(fields.includes(JSON.stringify(source.input))); assert.ok(fields.includes(JSON.stringify(' z\n ')));
    assert.deepEqual(await facts(), before);
  } finally { await act(async () => tree.unmount()); }
});

test('actual Modal close callback cancels a checking detail and reopening starts the list, preserving the editor', async () => {
  await seed('O'); await seed('D'); const held = deferred<Awaited<ReturnType<typeof catalog.readCaptureCatalogEntry>>>(); let started = false;
  const tree = await mount(setup('QuickNoteResult', { '../../services/captureDraftCatalog': { ...catalog, readCaptureCatalogEntry: () => { started = true; return held.promise; } } }));
  try {
    const before = await facts(), fields = editorFields(tree); await openDirectory(tree);
    await act(async () => tree.root.findByProps({ 'aria-label': '查看原稿 O' }).props.onClick()); assert.match(text(tree.root), /正在核验这一份原稿/);
    await settle(() => started); await click(tree, '宿主Esc关闭'); assert.equal(tree.root.findAllByProps({ role: 'dialog' }).length, 0);
    await act(async () => { held.reject(new Error('被关闭选择的旧异常')); await tick(); });
    await openDirectory(tree); assert.match(text(tree.root), /原编号：O/); assert.doesNotMatch(text(tree.root), /被关闭选择的旧异常/);
    assert.deepEqual(editorFields(tree), fields); assert.deepEqual(await facts(), before);
  } finally { held.reject(new Error('cleanup')); await act(async () => tree.unmount()); }
});

test('actual zero-candidate directory shows a qualified empty state without creating a confirmation draft', async () => {
  const tree = await mount(setup('QuickNote'));
  try {
    const before = await facts(), start = nativeTransactions.length; await openDirectory(tree);
    assert.match(text(tree.root), /本页检查 0 项/); assert.match(text(tree.root), /本次读取没有可安全列出的未提交稿/);
    assert.equal(tree.root.findAllByType('button').some(node => text(node) === '继续扫描后续稿'), false);
    assert.deepEqual(await facts(), before); assert.ok(nativeTransactions.slice(start).every(tx => tx.mode === 'readonly'));
  } finally { await act(async () => tree.unmount()); }
});

test('actual late read error from replaced session publishes only generic context failure, never private old error text', async () => {
  await seed('O'); await seed('D'); const held = deferred<Awaited<ReturnType<typeof catalog.listCaptureDraftPage>>>();
  const tree = await mount(setup('QuickNote', { '../../services/captureDraftCatalog': { ...catalog, listCaptureDraftPage: () => held.promise } }));
  try {
    const before = await facts(); await click(tree, '查看本机未提交稿');
    await act(async () => { api.setSessionActive(owner); auth.useAuthStore.setState({ user: { ...user } }); held.reject(new Error('原账号合成私有错误不可显示')); await tick(); });
    await settle(() => text(tree.root).includes('账号或本机资料已变化'));
    assert.doesNotMatch(text(tree.root), /原账号合成私有错误不可显示|原编号：O/); assert.deepEqual(await facts(), before);
  } finally { held.reject(new Error('cleanup')); await act(async () => tree.unmount()); }
});


test('internal isolated actual review: private original and no-edit close skip upgrade, ordinary pending and every writer', async () => {
  const original = await seed('O'); await seed('D'); const entry = (await catalog.listCaptureDraftPage()).entries.find(x => x.id === original.id)!;
  const grant = await catalog.prepareCaptureContinuation(entry); grant.draft.input = 'SYNTHETIC_PUBLIC_MUTATION';
  let closed = 0, forbidden = 0;
  const s = setup('QuickNoteResult', { '../services/quickNoteIntegration': { ...capture, upgradeCaptureReview() { forbidden++; throw new Error('no upgrade'); }, saveCaptureDraft() { forbidden++; throw new Error('no ordinary writer'); }, applyCaptureDraft() { forbidden++; throw new Error('no business apply'); } }, '../services/pendingEditorMemory': { ...pending, readPendingEditor() { forbidden++; throw new Error('no ordinary pending read'); } } });
  assert.equal(typeof s.Review, 'function', 'internal policy must reuse the actual original review component');
  const before = await facts(), pointers = [sessionStorage.getItem(capture.captureSessionKey()), sessionStorage.getItem(`youtrace:input:${owner}`)]; let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(s.Review, { original: { ...original, input: 'SYNTHETIC_WRONG_PROP' }, continuation: { grant, onClose: () => { closed++; } } })); });
  await settle(() => tree.root.findAllByProps({ 'aria-label': '完整确认稿备份' }).length === 1);
  try {
    assert.ok(text(tree.root).includes(original.input)); assert.doesNotMatch(text(tree.root), /SYNTHETIC_PUBLIC_MUTATION|SYNTHETIC_WRONG_PROP/);
    assert.equal(tree.root.findAllByType('button').some(x => /确认保存所选记录|查看本机未提交稿/.test(text(x))), false);
    await act(async () => tree.root.findAllByType('button').find(x => x.props['aria-label'] === '返回')!.props.onClick());
    assert.equal(closed, 1); assert.equal(forbidden, 0); assert.deepEqual(await facts(), before); assert.deepEqual(s.navigations, []);
    assert.deepEqual([sessionStorage.getItem(capture.captureSessionKey()), sessionStorage.getItem(`youtrace:input:${owner}`)], pointers);
  } finally { await act(async () => tree.unmount()); }
});

test('internal isolated actual review: correcting original O keeps mounted parent D, all other rows and both pointers exact', async () => {
  const original = await seed('policy-O'), parent = await seed('policy-D');
  const grant = await catalog.prepareCaptureContinuation((await catalog.listCaptureDraftPage()).entries.find(x => x.id === original.id)!);
  const s = setup('QuickNoteResult'); let tree!: ReactTestRenderer;
  function Pair() { const [open, setOpen] = React.useState(true); return React.createElement(React.Fragment, null, React.createElement(s.Component), open && React.createElement(s.Review, { original, continuation: { grant, onClose: () => setOpen(false) } })); }
  await act(async () => { tree = create(React.createElement(Pair)); }); await settle(() => tree.root.findAllByType(s.Review).length === 2 && tree.root.findAllByProps({ 'aria-label': '完整确认稿备份' }).length === 2);
  try {
    const parentView = tree.root.findAllByType(s.Review).find(x => !x.props.continuation)!;
    const parentFields = editorFields({ root: parentView } as ReactTestRenderer), before = await facts();
    const pointers = [sessionStorage.getItem(capture.captureSessionKey()), sessionStorage.getItem(`youtrace:input:${owner}`)];
    const isolated = tree.root.findAllByType(s.Review).find(x => x.props.continuation)!;
    const edit = '  合成选中O的新日记\n仍保留末尾  ';
    await act(async () => { isolated.findByProps({ 'aria-label': '日记内容' }).props.onChange({ target: { value: edit } }); await tick(); });
    await settle(() => !catalog.readCaptureContinuationState(grant).pending);
    const expected = structuredClone(before), row = (expected.settings as Array<{ key: string; value: unknown }>).find(x => x.key === `capture-review:${original.id}`)!;
    row.value = { ...grant.draft, diary: edit };
    assert.deepEqual(await facts(), expected); assert.deepEqual(editorFields({ root: parentView } as ReactTestRenderer), parentFields);
    assert.equal(tree.root.findAllByType(s.Review).find(x => !x.props.continuation), parentView);
    assert.deepEqual((await storage.db.settings.get('quicknote_review'))?.value, parent);
    await act(async () => isolated.findAllByType('button').find(x => x.props['aria-label'] === '返回')!.props.onClick());
    assert.equal(tree.root.findAllByType(s.Review).length, 1); assert.equal(tree.root.findByType(s.Review), parentView);
    assert.deepEqual(editorFields({ root: parentView } as ReactTestRenderer), parentFields); assert.deepEqual(s.navigations, []);
    assert.deepEqual([sessionStorage.getItem(capture.captureSessionKey()), sessionStorage.getItem(`youtrace:input:${owner}`)], pointers);
  } finally { await act(async () => tree.unmount()); }
});

test('internal isolated actual review: quota keeps failed typed input, back cannot discard it, exact retry keeps original ID', async () => {
  const original = await seed('policy-quota'); await seed('policy-parent'); const grant = await catalog.prepareCaptureContinuation((await catalog.listCaptureDraftPage()).entries.find(x => x.id === original.id)!);
  const s = setup('QuickNoteResult'); let tree!: ReactTestRenderer, closed = 0;
  await act(async () => { tree = create(React.createElement(s.Review, { original, continuation: { grant, onClose: () => closed++ } })); });
  await settle(() => tree.root.findAllByProps({ 'aria-label': '日记内容' }).length === 1);
  const before = await facts(), put = storage.db.settings.put; let fail = true;
  storage.db.settings.put = function (...args: Parameters<typeof put>) { if (fail && args[0].key === `capture-review:${original.id}`) return Promise.reject(new DOMException('SYNTHETIC_QUOTA', 'QuotaExceededError')) as ReturnType<typeof put>; return put.apply(this, args); } as typeof put;
  try {
    const edit = '  合成失败编辑\n完整保留  ';
    await act(async () => { tree.root.findByProps({ 'aria-label': '日记内容' }).props.onChange({ target: { value: edit } }); await tick(); });
    await settle(() => text(tree.root).includes('修改尚未落盘'));
    assert.deepEqual(await facts(), before); assert.equal(tree.root.findByProps({ 'aria-label': '日记内容' }).props.value, edit);
    assert.equal(catalog.readCaptureContinuationState(grant).draft.diary, edit);
    await act(async () => tree.root.findAllByType('button').find(x => x.props['aria-label'] === '返回')!.props.onClick());
    assert.equal(closed, 0); assert.equal(catalog.readCaptureContinuationState(grant).pending, true);
    fail = false; await click(tree, '重试保留修改'); await settle(() => !catalog.readCaptureContinuationState(grant).pending);
    assert.equal((await storage.db.settings.get(`capture-review:${original.id}`))?.value.diary, edit); assert.deepEqual(s.navigations, []);
    await act(async () => tree.root.findAllByType('button').find(x => x.props['aria-label'] === '返回')!.props.onClick()); assert.equal(closed, 1);
  } finally { storage.db.settings.put = put; await act(async () => tree.unmount()); }
});

test('internal isolated actual review: queued failure survives unmount, then same granted instance retries without pending recovery or upgrade', async () => {
  const original = await seed('policy-unmount'), grant = await catalog.prepareCaptureContinuation((await catalog.listCaptureDraftPage()).entries.find(x => x.id === original.id)!);
  const held = deferred<void>(); let started = false;
  const s = setup('QuickNoteResult', { '../services/captureDraftCatalog': { ...catalog, saveCaptureContinuation: async (...args: Parameters<typeof catalog.saveCaptureContinuation>) => { started = true; await held.promise; return catalog.saveCaptureContinuation(...args); } } });
  let tree!: ReactTestRenderer; const props = { original, continuation: { grant, onClose() {} } };
  await act(async () => { tree = create(React.createElement(s.Review, props)); });
  await settle(() => tree.root.findAllByProps({ 'aria-label': '日记内容' }).length === 1);
  const before = await facts(), edit = '  合成卸载后待保存\n  ';
  await act(async () => tree.root.findByProps({ 'aria-label': '日记内容' }).props.onChange({ target: { value: edit } })); await settle(() => started);
  await act(async () => tree.unmount()); held.reject(new Error('SYNTHETIC_LATE_FAILURE')); await act(async () => tick());
  assert.deepEqual(await facts(), before); assert.equal(catalog.readCaptureContinuationState(grant).draft.diary, edit);
  const freshHost = setup('QuickNoteResult'); await act(async () => { tree = create(React.createElement(freshHost.Review, props)); });
  await settle(() => tree.root.findAllByProps({ 'aria-label': '日记内容' }).length === 1);
  try { assert.equal(tree.root.findByProps({ 'aria-label': '日记内容' }).props.value, edit); assert.match(text(tree.root), /尚未落盘/); await click(tree, '重试保留修改'); await settle(() => !catalog.readCaptureContinuationState(grant).pending); assert.equal((await storage.db.settings.get(`capture-review:${original.id}`))?.value.diary, edit); }
  finally { await act(async () => tree.unmount()); }
});

test('internal isolated actual review: session replacement hides previous text and blocks delayed queued writes', async () => {
  const original = await seed('policy-session'), grant = await catalog.prepareCaptureContinuation((await catalog.listCaptureDraftPage()).entries.find(x => x.id === original.id)!);
  const held = deferred<void>(); let started = false;
  const s = setup('QuickNoteResult', { '../services/captureDraftCatalog': { ...catalog, saveCaptureContinuation: async (...args: Parameters<typeof catalog.saveCaptureContinuation>) => { started = true; await held.promise; return catalog.saveCaptureContinuation(...args); } } });
  let tree!: ReactTestRenderer; await act(async () => { tree = create(React.createElement(s.Review, { original, continuation: { grant, onClose() {} } })); });
  await settle(() => tree.root.findAllByProps({ 'aria-label': '日记内容' }).length === 1);
  const before = await facts(), edit = 'SYNTHETIC_PRIVATE_OLD_SESSION';
  try {
    await act(async () => tree.root.findByProps({ 'aria-label': '日记内容' }).props.onChange({ target: { value: edit } })); await settle(() => started);
    await act(async () => { api.setSessionActive(owner); auth.useAuthStore.setState({ user: { ...user } }); held.resolve(); await tick(); });
    await settle(() => text(tree.root).includes('账号状态已变化'));
    assert.doesNotMatch(text(tree.root), /SYNTHETIC_PRIVATE_OLD_SESSION/); assert.deepEqual(await facts(), before); assert.deepEqual(s.navigations, []);
    assert.throws(() => catalog.readCaptureContinuationState(grant), /账号/);
  } finally { held.resolve(); await act(async () => tree.unmount()); }
});

test('internal isolated actual review: a changed epoch before mount never renders selected private contents', async () => {
  const original = await seed('policy-epoch', 'SYNTHETIC_PRIVATE_PREVIOUS_EPOCH'), grant = await catalog.prepareCaptureContinuation((await catalog.listCaptureDraftPage()).entries.find(x => x.id === original.id)!);
  await storage.db.settings.put({ key: storage.LOCAL_DATA_EPOCH_KEY, value: 'SYNTHETIC_REPLACED_EPOCH' });
  const before = await facts(), s = setup('QuickNoteResult'); let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(s.Review, { original, continuation: { grant, onClose() {} } })); });
  try { assert.doesNotMatch(text(tree.root), /SYNTHETIC_PRIVATE_PREVIOUS_EPOCH/); await settle(() => text(tree.root).includes('账号状态已变化')); assert.deepEqual(await facts(), before); }
  finally { await act(async () => tree.unmount()); }
});

test('internal isolated actual review: original amount control retains an invalid long edit across failed write and exact correction', async () => {
  const original = await seed('policy-amount'), grant = await catalog.prepareCaptureContinuation((await catalog.listCaptureDraftPage()).entries.find(x => x.id === original.id)!);
  const s = setup('QuickNoteResult'); let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(s.Review, { original, continuation: { grant, onClose() {} } })); });
  await settle(() => tree.root.findAllByProps({ 'aria-label': '第1笔金额（人民币元）' }).length === 1);
  try {
    const before = await facts(), raw = '9'.repeat(400);
    await act(async () => { tree.root.findByProps({ 'aria-label': '第1笔金额（人民币元）' }).props.onChange({ target: { value: raw } }); await tick(); });
    await settle(() => text(tree.root).includes('修改尚未落盘'));
    assert.equal(tree.root.findByProps({ 'aria-label': '第1笔金额（人民币元）' }).props.value, raw);
    assert.equal(catalog.readCaptureContinuationState(grant).draft.expenses[0].amountText, raw); assert.deepEqual(await facts(), before);
    await act(async () => { tree.root.findByProps({ 'aria-label': '第1笔金额（人民币元）' }).props.onChange({ target: { value: '12.50' } }); await tick(); });
    await settle(() => !catalog.readCaptureContinuationState(grant).pending);
    const result = (await storage.db.settings.get(`capture-review:${original.id}`))?.value;
    assert.equal(result.expenses[0].amount, 1250); assert.equal(result.expenses[0].amountText, '12.50'); assert.equal(result.id, original.id);
  } finally { await act(async () => tree.unmount()); }
});

test('internal isolated actual review: newer queued failure is visible after old success and remains in memory', async () => {
  const original = await seed('policy-queue'), grant = await catalog.prepareCaptureContinuation((await catalog.listCaptureDraftPage()).entries.find(x => x.id === original.id)!);
  const held = deferred<void>(); let calls = 0, started = false;
  const s = setup('QuickNoteResult', { '../services/captureDraftCatalog': { ...catalog, saveCaptureContinuation: async (...args: Parameters<typeof catalog.saveCaptureContinuation>) => { if (++calls === 1) { started = true; await held.promise; return catalog.saveCaptureContinuation(...args); } throw new Error('SYNTHETIC_SECOND_FAILED'); } } });
  let tree!: ReactTestRenderer; await act(async () => { tree = create(React.createElement(s.Review, { original, continuation: { grant, onClose() {} } })); });
  await settle(() => tree.root.findAllByProps({ 'aria-label': '日记内容' }).length === 1);
  try {
    await act(async () => tree.root.findByProps({ 'aria-label': '日记内容' }).props.onChange({ target: { value: '合成第一笔' } })); await settle(() => started);
    await act(async () => { tree.root.findByProps({ 'aria-label': '日记内容' }).props.onChange({ target: { value: '  合成较新失败\n  ' } }); held.resolve(); await tick(); });
    await settle(() => text(tree.root).includes('修改尚未落盘'));
    assert.equal(calls, 2); assert.equal((await storage.db.settings.get(`capture-review:${original.id}`))?.value.diary, '合成第一笔');
    assert.equal(tree.root.findByProps({ 'aria-label': '日记内容' }).props.value, '  合成较新失败\n  ');
    assert.equal(catalog.readCaptureContinuationState(grant).draft.diary, '  合成较新失败\n  ');
  } finally { held.resolve(); await act(async () => tree.unmount()); }
});
