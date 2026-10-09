import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import * as router from 'react-router-dom';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import ts from 'typescript';
// Real React, router, editor, draft hook, store and Dexie; the host is not a browser.
import 'framer-motion';
import type { DiaryRecord } from '../src/db';

const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
};
Object.assign(globalThis, {
  localStorage: memory(), sessionStorage: memory(), React, IS_REACT_ACT_ENVIRONMENT: true,
  document: Object.assign(new EventTarget(), { body: { style: { overflow: '' }, scrollLeft: 0, scrollTop: 0 }, documentElement: { scrollLeft: 0, scrollTop: 0 }, activeElement: null, getElementById: () => null }),
  window: Object.assign(new EventTarget(), { setTimeout, clearTimeout, history: { state: { idx: 0 } }, location: { pathname: '/diary', replace() {} }, matchMedia: () => Object.assign(new EventTarget(), { matches: false }) }),
});
const storage = await import('../src/db');
const { prepareAccountGeneration } = await import('../src/db/accountGeneration');
const api = await import('../src/services/apiClient');
const sync = await import('../src/services/syncEngine');
const auth = await import('../src/stores/authStore');
const { useDiaryStore } = await import('../src/stores/diaryStore');
const { DiaryContent } = await import('../src/components/diary/DiaryContent');
const { DiaryEditor } = await import('../src/components/diary/DiaryEditor');
const { openDiaryDraft } = await import('../src/components/diary/diaryDraft');
const owner = 'synthetic-diary-editor-lifecycle';
const original: DiaryRecord = { id: 'synthetic-linked', date: '2026-10-01', content: 'SYNTHETIC original', mood: null, moodScore: null, source: 'manual', quickNoteIds: [], createdAt: 1, updatedAt: 1 };
const content = 'SYNTHETIC retained linked draft';
let navigate: NavigateFunction;
function Route() {
  const nextNavigate = useNavigate();
  React.useEffect(() => { navigate = nextNavigate; }, [nextNavigate]);
  return React.createElement(DiaryContent);
}
async function settle(predicate: () => boolean, label: string) {
  const until = Date.now() + 3000;
  while (!predicate() && Date.now() < until) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  assert.ok(predicate(), label);
}
async function mount(path = `/diary?record=${original.id}`) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(React.StrictMode, {}, React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(Route)))); });
  return tree;
}
async function edit(tree: ReactTestRenderer) {
  await settle(() => tree.root.findAllByType('fieldset').some(node => !node.props.disabled), 'draft ready');
  await act(async () => tree.root.findByProps({ id: 'diary-content' }).props.onChange({ target: { value: content } }));
  await settle(() => !JSON.stringify(tree.toJSON()).includes('正在保留草稿'), 'draft durable');
}
async function failedRefresh() {
  const fail = () => { throw new Error('SYNTHETIC transient diary read failure'); };
  storage.db.diary.hook('reading', fail);
  try { await act(async () => { await assert.rejects(useDiaryStore.getState().loadFromDB(), /transient diary read failure/); }); }
  finally { storage.db.diary.hook('reading').unsubscribe(fail); }
  assert.equal(useDiaryStore.getState().loaded, false);
}
before(async () => { await storage.bindAccountDatabase(owner); sync.pauseSync(); });
beforeEach(async () => {
  localStorage.removeItem(api.SIGNED_OUT_KEY); localStorage.removeItem(api.SESSION_REVISION_KEY); api.clearSession(); api.setSessionActive(owner);
  await storage.db.diary.clear(); await storage.db.settings.clear(); await storage.db.outbox.clear();
  await storage.db.diary.add(original);
  useDiaryStore.setState({ items: [], loaded: false, loadError: '' });
  await useDiaryStore.getState().loadFromDB();
});
after(() => { sync.pauseSync(); storage.db.close(); });

test('A linked Diary editor stays mounted through a real failed refresh and recovery without losing exact input', async () => {
  const tree = await mount();
  try {
    await edit(tree);
    const editor = tree.root.findByType(DiaryEditor);
    await failedRefresh();
    assert.equal(tree.root.findAllByType(DiaryEditor).length, 1, 'read failure must not dismiss an already opened linked editor');
    assert.equal(tree.root.findByType(DiaryEditor), editor, 'the same editor remains mounted');
    assert.equal(tree.root.findByProps({ id: 'diary-content' }).props.value, content);
    assert.match(JSON.stringify(tree.toJSON()), /transient diary read failure/);
    await act(async () => useDiaryStore.getState().loadFromDB());
    assert.equal(tree.root.findByType(DiaryEditor), editor);
    assert.equal(tree.root.findByProps({ id: 'diary-content' }).props.value, content);
    assert.equal((await openDiaryDraft(original.id)).value?.content, content);
    assert.deepEqual(await storage.db.diary.get(original.id), original);
    assert.equal(await storage.db.outbox.count(), 0);
  } finally { await act(async () => tree.unmount()); }
});

test('An explicitly dismissed linked Diary stays closed across read failure and recovery, and reopens its exact draft', async () => {
  const tree = await mount();
  try {
    await edit(tree);
    await act(async () => document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })));
    await settle(() => tree.root.findAllByType(DiaryEditor).length === 0, 'explicit Escape closes');
    await failedRefresh();
    await act(async () => useDiaryStore.getState().loadFromDB());
    assert.equal(tree.root.findAllByType(DiaryEditor).length, 0);
    await act(async () => tree.root.findAllByType('button').find(node => node.children.some(child => typeof child === 'string' && child.startsWith('重新打开')))!.props.onClick());
    await settle(() => tree.root.findByProps({ id: 'diary-content' }).props.value === content, 'explicit reopen restores draft');
    assert.deepEqual(await storage.db.diary.get(original.id), original);
  } finally { await act(async () => tree.unmount()); }
});

test('A changed record request cannot reuse the previous linked Diary snapshot while reads are unavailable', async () => {
  const tree = await mount();
  try {
    await edit(tree);
    await failedRefresh();
    await act(async () => navigate('/diary?record=synthetic-missing'));
    assert.equal(tree.root.findAllByType(DiaryEditor).length, 0);
    await act(async () => useDiaryStore.getState().loadFromDB());
    assert.equal(tree.root.findAllByType(DiaryEditor).length, 0);
    assert.equal((await openDiaryDraft(original.id)).value?.content, content);
  } finally { await act(async () => tree.unmount()); }
});

test('Initial unavailable reads do not open a linked Diary until its exact record is loaded', async () => {
  useDiaryStore.setState({ items: [], loaded: false, loadError: 'SYNTHETIC initial failure' });
  const tree = await mount();
  try {
    assert.equal(tree.root.findAllByType(DiaryEditor).length, 0);
    await act(async () => useDiaryStore.getState().loadFromDB());
    await settle(() => tree.root.findAllByType(DiaryEditor).length === 1, 'matching record load opens editor');
    await settle(() => tree.root.findByProps({ id: 'diary-content' }).props.value === original.content, 'original source remains exact');
  } finally { await act(async () => tree.unmount()); }
});

for (const change of ['updated', 'deleted'] as const) test(`A linked Diary kept open after read failure still refuses a ${change} record at Save`, async () => {
  const tree = await mount();
  try {
    await edit(tree);
    await failedRefresh();
    const newer = { ...original, content: 'SYNTHETIC concurrent replacement', updatedAt: 2 };
    if (change === 'deleted') await storage.db.diary.delete(original.id);
    else await storage.db.diary.put(newer);
    await act(async () => tree.root.findAllByType('button').find(node => node.children.includes('保存'))!.props.onClick());
    await settle(() => JSON.stringify(tree.toJSON()).includes('原日记已有更新或已删除'), 'stale source becomes explicit');
    assert.equal(tree.root.findAllByType(DiaryEditor).length, 1);
    assert.equal(tree.root.findByProps({ id: 'diary-content' }).props.value, content);
    assert.equal(tree.root.findAllByType('button').find(node => node.children.includes('保存'))!.props.disabled, true);
    assert.deepEqual(await storage.db.diary.get(original.id), change === 'deleted' ? undefined : newer);
    assert.equal(await storage.db.outbox.count(), 0);
    assert.equal((await openDiaryDraft(original.id)).value?.content, content);
  } finally { await act(async () => tree.unmount()); }
});

test('Revocation after a failed read cannot save the retained linked draft under a changed session', async () => {
  const tree = await mount();
  try {
    await edit(tree);
    await failedRefresh();
    const stored = await storage.db.settings.get(`record-draft:diary:${original.id}`);
    api.clearSession(); localStorage.setItem(api.SIGNED_OUT_KEY, 'true');
    await act(async () => tree.root.findAllByType('button').find(node => node.children.includes('保存'))!.props.onClick());
    await settle(() => JSON.stringify(tree.toJSON()).includes('账号或本机资料已变化'), 'old-session commit is refused');
    assert.deepEqual(await storage.db.diary.get(original.id), original);
    assert.equal(await storage.db.outbox.count(), 0);
    assert.deepEqual(await storage.db.settings.get(`record-draft:diary:${original.id}`), stored);
  } finally { await act(async () => tree.unmount()); }
});

test('Actual auth gates remove the retained editor; same-document account switching is refused and account databases stay isolated', async () => {
  // Evaluate the production gate bodies without rendering unrelated lazy pages.
  const loadGate = (path: string, name: string, modules: Record<string, unknown>) => {
    const code = ts.transpileModule(`${readFileSync(new URL(path, import.meta.url), 'utf8')}\nexport { ${name} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports: Record<string, React.ComponentType<Record<string, unknown>>> = {};
    runInNewContext(code, { exports, sessionStorage, window, require: (id: string) => {
      if (id === 'react') return React;
      if (id === 'react/jsx-runtime') return jsx;
      if (id === 'react-router-dom') return router;
      assert.ok(id in modules, `Declared test module: ${id}`); return modules[id];
    } });
    return exports[name];
  };
  const RequireAuth = loadGate('../src/routes/index.tsx', 'RequireAuth', {
    '../stores/authStore': auth, '../components/layout/StaticPageEntry': {}, '../components/layout/AppLayout': {},
  });
  const AppRoutes = () => React.createElement(router.Routes, {},
    React.createElement(router.Route, { path: '/diary', element: React.createElement(RequireAuth, {}, React.createElement(Route)) }),
    React.createElement(router.Route, { path: '/login', element: React.createElement('p', { 'data-login': true }, 'Signed out') }));
  const ReadyRoutes = loadGate('../src/App.tsx', 'ReadyRoutes', {
    './stores/authStore': auth, './db': storage, './routes': { AppRoutes }, 'framer-motion': {},
    './hooks/useAppInit': {}, './components/ui/SplashScreen': {}, './components/ui/Toast': {}, './components/ui/ErrorBoundary': {}, './components/layout/RuntimeObserver': {},
  });
  const user = { id: owner, phone: '13900009907', nickname: 'Synthetic lifecycle A', avatar: '', identity: 'other', city: '', coachStyle: 'gentle', quietStart: '23:00', quietEnd: '07:00', pushLimit: 2 };
  auth.useAuthStore.setState({ user, isAuthenticated: true, authChecked: true, identityUnavailable: false });
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(React.StrictMode, {}, React.createElement(MemoryRouter, { initialEntries: [`/diary?record=${original.id}`] }, React.createElement(ReadyRoutes, { ready: true, failed: false })))); });
  try {
    await edit(tree); await failedRefresh();
    assert.equal(tree.root.findAllByType(DiaryEditor).length, 1);
    await act(async () => auth.lockLocalSession());
    assert.equal(tree.root.findAllByType(DiaryEditor).length, 0);
    assert.equal(tree.root.findAllByType(DiaryContent).length, 0);
    assert.doesNotMatch(JSON.stringify(tree.toJSON()), /SYNTHETIC retained linked draft/);
    const otherOwner = `${owner}-B`;
    await act(async () => { await assert.rejects(storage.bindAccountDatabase(otherOwner), /切换账号需要重新加载页面/); });
    assert.equal(storage.db.ownerId, owner, 'failed B bind cannot replace the A database');
    assert.equal(tree.root.findAllByType(DiaryEditor).length, 0);
    await act(async () => { await prepareAccountGeneration(otherOwner); });
    const otherDatabase = new storage.YoujiDatabase(otherOwner, true);
    await act(async () => { await otherDatabase.open(); });
    try {
      assert.equal(await otherDatabase.settings.get(`record-draft:diary:${original.id}`), undefined);
      assert.equal(await otherDatabase.diary.count(), 0);
    } finally { otherDatabase.close(); }
    await act(async () => { auth.lockLocalSession(); auth.useAuthStore.setState({ authChecked: true }); });
    assert.equal(tree.root.findAllByProps({ 'data-login': true }).length, 1);
    assert.equal(tree.root.findAllByType(DiaryContent).length, 0);
  } finally {
    await act(async () => tree.unmount());
    localStorage.removeItem(api.SIGNED_OUT_KEY); api.setSessionActive(owner);
  }
  assert.equal((await openDiaryDraft(original.id)).value?.content, content);
  assert.deepEqual(await storage.db.diary.get(original.id), original);
});
