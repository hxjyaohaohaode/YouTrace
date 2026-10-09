import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import * as React from 'react';
import { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import 'framer-motion';
import type { DiaryRecord } from '../src/db';

// Real mounted content/editor/router/store/Dexie. Only the DOM host and the
// closing timer are controlled; this is not native browser/paint verification.
const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
};
const listeners = new Map<string, Set<EventListener>>();
const host = Object.assign(new EventTarget(), {
  body: { style: { overflow: '' }, scrollLeft: 0, scrollTop: 0 }, documentElement: { scrollLeft: 0, scrollTop: 0 },
  activeElement: null as unknown, getElementById: (id: string) => rows.get(id) ?? null,
});
const nativeAdd = host.addEventListener.bind(host), nativeRemove = host.removeEventListener.bind(host);
host.addEventListener = (type, listener, options) => {
  if (typeof listener === 'function') { const group = listeners.get(type) ?? new Set(); group.add(listener); listeners.set(type, group); }
  nativeAdd(type, listener, options);
};
host.removeEventListener = (type, listener, options) => {
  if (typeof listener === 'function') listeners.get(type)?.delete(listener);
  // Node EventTarget does not normalize the boolean capture shorthand like DOM.
  nativeRemove(type, listener, typeof options === 'boolean' ? { capture: options } : options);
};
const emitIntent = (type: string) => { for (const listener of [...listeners.get(type) ?? []]) listener({ isTrusted: true } as Event); };
const timers = new Map<number, () => void>();
let timerId = 0;
Object.assign(globalThis, {
  localStorage: memory(), sessionStorage: memory(), React, IS_REACT_ACT_ENVIRONMENT: true, document: host,
  window: Object.assign(new EventTarget(), {
    setTimeout(callback: () => void, delay: number) { assert.equal(delay, 250, 'only the existing close-return delay is controlled'); const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id: number) { timers.delete(id); }, history: { state: { idx: 0 } }, location: { pathname: '/diary', replace() {} },
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
  }),
});
function row() {
  const element = {
    isConnected: true, hidden: false, style: {}, calls: [] as unknown[], matches() { return element.hidden; }, getClientRects() { return element.hidden ? [] : [{}]; },
    scrollIntoView(options: unknown) { element.calls.push(['scroll', options]); },
    focus(options: unknown) { element.calls.push(['focus', options]); host.activeElement = element; },
  };
  return element;
}
const rows = new Map<string, ReturnType<typeof row>>();
const storage = await import('../src/db');
const api = await import('../src/services/apiClient');
const sync = await import('../src/services/syncEngine');
const { useDiaryStore } = await import('../src/stores/diaryStore');
const { DiaryContent } = await import('../src/components/diary/DiaryContent');
const { DiaryEditor } = await import('../src/components/diary/DiaryEditor');
const { openDiaryDraft } = await import('../src/components/diary/diaryDraft');
const owner = 'synthetic-diary-focus-return';
const original: DiaryRecord = { id: 'synthetic-original', date: '2026-10-01', content: 'SYNTHETIC original', mood: null, moodScore: null, source: 'manual', quickNoteIds: [], createdAt: 1, updatedAt: 1 };
const edited = 'SYNTHETIC exact retained draft';
let navigate: NavigateFunction;
function Route() { const next = useNavigate(); React.useEffect(() => { navigate = next; }, [next]); return React.createElement(DiaryContent); }
async function settle(predicate: () => boolean, label: string) {
  const until = Date.now() + 3000;
  while (!predicate() && Date.now() < until) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  assert.ok(predicate(), label);
}
async function mount(options?: Parameters<typeof create>[1]) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(React.StrictMode, {}, React.createElement(MemoryRouter, { initialEntries: [`/diary?record=${original.id}`] }, React.createElement(Route))), options); });
  await settle(() => tree.root.findAllByType('fieldset').some(node => !node.props.disabled), 'real draft ready');
  return tree;
}
async function close(tree: ReactTestRenderer) {
  await act(async () => tree.root.findByProps({ id: 'diary-content' }).props.onChange({ target: { value: edited } }));
  await act(async () => tree.root.findAllByType('button').find(node => node.children.includes('取消（保留草稿）'))!.props.onClick());
  await settle(() => tree.root.findAllByType(DiaryEditor).length === 0, 'real editor closes after preserving draft');
}
async function fireReturns() { await act(async () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } }); }
const listenerCount = () => [...listeners.values()].reduce((sum, values) => sum + values.size, 0);
before(async () => { await storage.bindAccountDatabase(owner); sync.pauseSync(); });
beforeEach(async () => {
  timers.clear(); rows.clear(); rows.set(`diary-record-${original.id}`, row()); host.activeElement = host.body;
  localStorage.removeItem(api.SIGNED_OUT_KEY); localStorage.removeItem(api.SESSION_REVISION_KEY); api.clearSession(); api.setSessionActive(owner);
  await storage.db.diary.clear(); await storage.db.settings.clear(); await storage.db.outbox.clear(); await storage.db.diary.add(original);
  await useDiaryStore.getState().loadFromDB();
});
after(() => { sync.pauseSync(); storage.db.close(); });

test('An uninterrupted cancel returns once to its exact row and preserves the full draft without a business mutation', async () => {
  const tree = await mount(), target = rows.get(`diary-record-${original.id}`)!;
  try {
    await close(tree); await fireReturns();
    assert.equal(host.activeElement, target); assert.equal(target.calls.length, 2); assert.deepEqual(target.calls[0], ['scroll', { block: 'center' }]);
    await fireReturns(); assert.equal(target.calls.length, 2);
    assert.equal((await openDiaryDraft(original.id)).value?.content, edited); assert.deepEqual(await storage.db.diary.get(original.id), original); assert.equal(await storage.db.outbox.count(), 0);
    assert.equal(listenerCount(), 0, 'finished return releases its listeners');
  } finally { await act(async () => tree.unmount()); }
});

for (const type of ['wheel', 'pointerdown', 'keydown', 'touchstart']) test(`A newer ${type} permanently cancels the old close return`, async () => {
  const tree = await mount(), target = rows.get(`diary-record-${original.id}`)!;
  try {
    await close(tree); const stale = [...timers.values()][0]; emitIntent(type); host.activeElement = host.body;
    await act(async () => stale()); await fireReturns();
    assert.deepEqual(target.calls, [], 'new intent wins even if focus is still the page body'); assert.equal(host.activeElement, host.body);
    assert.equal(listenerCount(), 0); assert.equal((await openDiaryDraft(original.id)).value?.content, edited);
  } finally { await act(async () => tree.unmount()); }
});

test('A newer focus movement is not taken back even after focus returns to the body', async () => {
  const tree = await mount(), target = rows.get(`diary-record-${original.id}`)!;
  try { await close(tree); host.activeElement = row(); emitIntent('focusin'); host.activeElement = host.body; await fireReturns(); assert.deepEqual(target.calls, []); }
  finally { await act(async () => tree.unmount()); }
});

for (const action of ['create', 'edit', 'linked']) test(`Reopening ${action} without an input event cancels the previous row return`, async () => {
  const tree = await mount(), target = rows.get(`diary-record-${original.id}`)!;
  try {
    await close(tree);
    await act(async () => {
      if (action === 'create') tree.root.findAllByType('button').find(node => node.props['aria-label'] === '写日记')!.props.onClick();
      else if (action === 'edit') tree.root.findAllByType('button').find(node => String(node.props['aria-label'] ?? '').startsWith('编辑'))!.props.onClick();
      else navigate(`/diary?record=${original.id}`, { state: { returnTo: { path: '/timeline' } } });
    });
    assert.equal(tree.root.findAllByType(DiaryEditor).length, 1); await fireReturns(); assert.deepEqual(target.calls, []);
  } finally { await act(async () => tree.unmount()); }
});

test('Changing route and returning before the deadline does not revive a spent return', async () => {
  const tree = await mount(), target = rows.get(`diary-record-${original.id}`)!;
  try { await close(tree); await act(async () => navigate('/diary?record=missing')); await act(async () => navigate(-1)); await fireReturns(); assert.deepEqual(target.calls, []); }
  finally { await act(async () => tree.unmount()); }
});

test('Unmount releases the timer and listeners instead of focusing a same-ID row in the next page', async () => {
  const tree = await mount(); await close(tree); await act(async () => tree.unmount());
  const replacement = row(); rows.set(`diary-record-${original.id}`, replacement); await fireReturns();
  assert.deepEqual(replacement.calls, []); assert.equal(timers.size, 0); assert.equal(listenerCount(), 0);
});

for (const change of ['revoke', 'same-owner-new-session', 'other-owner', 'revision', 'signed-out']) test(`A ${change} authority change makes the pending return inert`, async () => {
  const tree = await mount(), target = rows.get(`diary-record-${original.id}`)!;
  try {
    await close(tree);
    if (change === 'revoke') api.clearSession();
    else if (change === 'same-owner-new-session') { api.clearSession(); api.setSessionActive(owner); }
    else if (change === 'other-owner') api.setSessionActive('synthetic-other');
    else if (change === 'revision') api.announceSessionChange();
    else localStorage.setItem(api.SIGNED_OUT_KEY, 'true');
    await fireReturns(); assert.deepEqual(target.calls, []); assert.equal(listenerCount(), 0);
  } finally { await act(async () => tree.unmount()); }
});

for (const unavailable of ['missing', 'disconnected', 'hidden']) test(`A ${unavailable} target is not focused or replaced by a neighbor`, async () => {
  const tree = await mount(), target = rows.get(`diary-record-${original.id}`)!, neighbor = row(); rows.set('diary-record-neighbor', neighbor);
  try {
    await close(tree);
    if (unavailable === 'missing') rows.delete(`diary-record-${original.id}`);
    else if (unavailable === 'disconnected') target.isConnected = false;
    else target.hidden = true;
    await fireReturns(); assert.deepEqual(target.calls, []); assert.deepEqual(neighbor.calls, []);
  } finally { await act(async () => tree.unmount()); }
});


test('The actual Modal cleanup may restore its opener before the deferred exact-row return is armed', async () => {
  const opener = Object.assign(row(), { ownerDocument: host });
  const field = Object.assign(row(), { ownerDocument: host });
  const panel = Object.assign(row(), { ownerDocument: host, querySelector: () => field, contains: (other: unknown) => other === field });
  opener.focus = (options: unknown) => { opener.calls.push(['focus', options]); host.activeElement = opener; emitIntent('focusin'); };
  field.focus = (options: unknown) => { field.calls.push(['focus', options]); host.activeElement = field; emitIntent('focusin'); };
  host.activeElement = opener;
  const tree = await mount({ createNodeMock: (element) => element.props.role === 'dialog' ? panel : element.type === 'textarea' ? field : null });
  const target = rows.get(`diary-record-${original.id}`)!;
  try {
    assert.equal(host.activeElement, field, 'real Modal/editor effects focus the host field');
    const beforeClose = opener.calls.length;
    await close(tree);
    assert.equal(host.activeElement, opener, 'real Modal cleanup first restores the opener');
    assert.equal(opener.calls.length, beforeClose + 1);
    assert.deepEqual(target.calls, [], 'row return remains deferred');
    await fireReturns(); assert.equal(host.activeElement, target); assert.equal(target.calls.length, 2);
  } finally { await act(async () => tree.unmount()); }
});

test('An uninterrupted real Save returns to the exact newly saved row and consumes only its draft', async () => {
  const tree = await mount();
  try {
    await close(tree);
    await act(async () => tree.root.findAllByType('button').find(node => node.props['aria-label'] === '写日记')!.props.onClick());
    await settle(() => tree.root.findAllByType('fieldset').some(node => !node.props.disabled), 'new draft ready');
    await act(async () => tree.root.findByProps({ id: 'diary-content' }).props.onChange({ target: { value: 'SYNTHETIC newly saved diary' } }));
    await act(async () => tree.root.findAllByType('button').find(node => node.children.includes('保存'))!.props.onClick());
    await settle(() => tree.root.findAllByType(DiaryEditor).length === 0, 'real save closes editor');
    const saved = useDiaryStore.getState().items.find(item => item.id !== original.id)!;
    assert.equal(saved.content, 'SYNTHETIC newly saved diary');
    const target = row(); rows.set(`diary-record-${saved.id}`, target);
    await fireReturns(); assert.equal(host.activeElement, target); assert.equal(target.calls.length, 2);
    assert.deepEqual(rows.get(`diary-record-${original.id}`)!.calls, []);
    assert.equal((await openDiaryDraft(original.id)).value?.content, edited);
    assert.equal((await openDiaryDraft('new')).value, null);
    assert.deepEqual(await storage.db.diary.get(original.id), original);
  } finally { await act(async () => tree.unmount()); }
});


test('The real account binding rejects B; revocation also cancels the existing A return', async () => {
  const tree = await mount(), target = rows.get(`diary-record-${original.id}`)!, database = storage.db;
  try {
    await close(tree);
    await assert.rejects(storage.bindAccountDatabase('synthetic-different-account'), /切换账号需要重新加载页面/);
    assert.equal(storage.db, database); assert.equal(storage.db.ownerId, owner);
    api.clearSession(); await fireReturns(); assert.deepEqual(target.calls, []);
  } finally { await act(async () => tree.unmount()); }
});

test('A repeated close receives a new single return without reviving the cancelled callback', async () => {
  const tree = await mount(), target = rows.get(`diary-record-${original.id}`)!;
  try {
    await close(tree); const stale = [...timers.values()][0];
    await act(async () => tree.root.findAllByType('button').find(node => String(node.props['aria-label'] ?? '').startsWith('编辑'))!.props.onClick());
    await settle(() => tree.root.findAllByType('fieldset').some(node => !node.props.disabled), 'reopened draft ready');
    await act(async () => stale()); assert.deepEqual(target.calls, []);
    await close(tree); await fireReturns(); assert.equal(target.calls.length, 2); assert.equal(host.activeElement, target);
  } finally { await act(async () => tree.unmount()); }
});
