import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear(), entries: () => [...values] }; };
Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory(), window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { replace() {} } }), document: { documentElement: { setAttribute() {} } } });
const storage = await import('../src/db/index.ts');
const api = await import('../src/services/apiClient.ts');
const sync = await import('../src/services/syncEngine.ts');
const capture = await import('../src/services/quickNoteIntegration.ts');
const catalog = await import('../src/services/captureDraftCatalog.ts');
type Draft = Awaited<ReturnType<typeof capture.createCaptureDraft>>;
type Entry = Awaited<ReturnType<typeof catalog.listCaptureDraftPage>>['entries'][number];
type Grant = { readonly kind: 'capture-continuation'; readonly draft: Draft };
const prepare = (entry: Entry): Promise<Grant> => {
  const fn = (catalog as unknown as Record<string, unknown>).prepareCaptureContinuation;
  assert.equal(typeof fn, 'function', 'explicit continuation needs a separate read-only capability');
  return (fn as (entry: Entry) => Promise<Grant>)(entry);
};
const save = (grant: Grant, next: Draft): Promise<Draft> => {
  const fn = (catalog as unknown as Record<string, unknown>).saveCaptureContinuation;
  assert.equal(typeof fn, 'function', 'local correction needs typed exact CAS, not the ordinary RW loader');
  return (fn as (grant: Grant, next: Draft) => Promise<Draft>)(grant, next);
};
const basis = { capturedAt: 1791028800000, timeZone: 'Asia/Shanghai', date: '2026-10-03' };
beforeEach(async () => { sync.pauseSync(); api.clearSession(); localStorage.clear(); sessionStorage.clear(); await storage.bindAccountDatabase('synthetic-continuation-A'); api.setSessionActive('synthetic-continuation-A'); await storage.clearAllData({ allowPending: true }); sync.pauseSync(); });
after(() => { sync.pauseSync(); storage.db.close(); });
async function draft(id: string) { const source = await capture.forkCaptureInput(), text = `  合成原文 ${id}\n午饭15元；明天交报告  `; await capture.saveCaptureInput(source, text, basis); const value = { ...await capture.createCaptureDraft(text, source, basis), id }; await capture.saveCaptureDraft(value, true); return value; }
async function facts() { return storage.db.transaction('r', storage.db.tables, async () => Object.fromEntries(await Promise.all(storage.db.tables.map(async table => [table.name, { keys: await table.toCollection().primaryKeys(), rows: await table.toArray() }])))); }
async function selected() { const old = await draft('old-O'); const current = await draft('current-D'); sessionStorage.setItem(capture.captureSessionKey(), current.id); const entry = (await catalog.listCaptureDraftPage()).entries.find(row => row.id === old.id)!; return { old, current, entry }; }
test('actual modules: explicit continuation issues a detached RO capability without rebinding source or pointers', async () => {
  const { old } = await selected(); localStorage.setItem(api.SESSION_REVISION_KEY, 'synthetic-new-login'); api.setSessionActive('synthetic-continuation-A');
  const entry = (await catalog.listCaptureDraftPage()).entries.find(row => row.id === old.id)!;
  const before = await facts(), pointers = (sessionStorage as unknown as ReturnType<typeof memory>).entries();
  const grant = await prepare(entry);
  assert.equal(grant.draft.id, old.id); assert.equal(grant.draft.sessionRevision, 'synthetic-new-login');
  assert.deepEqual({ ...grant.draft, sessionRevision: old.sessionRevision }, old);
  assert.deepEqual(await facts(), before); assert.deepEqual((sessionStorage as unknown as ReturnType<typeof memory>).entries(), pointers);
});
test('actual modules: first local correction writes only the selected original ID, with exact parent preservation', async () => {
  const { old, current, entry } = await selected(); const grant = await prepare(entry); const before = await facts(), pointers = (sessionStorage as unknown as ReturnType<typeof memory>).entries();
  const next = structuredClone(grant.draft); next.expenses[0].amount = 1675; next.expenses[0].amountText = '16.75';
  const saved = await save(grant, next); assert.deepEqual(saved, next);
  const after = await facts(); before.settings.rows = before.settings.rows.map(row => row.key === `capture-review:${old.id}` ? { key: row.key, value: next } : row);
  assert.deepEqual(after, before); assert.deepEqual((await storage.db.settings.get('quicknote_review'))?.value, current); assert.deepEqual((sessionStorage as unknown as ReturnType<typeof memory>).entries(), pointers);
});
test('actual modules: forged or copied grants and altered immutable source fields cannot authorize writes', async () => {
  const { entry } = await selected(); const grant = await prepare(entry), before = await facts();
  for (const invalid of [{} as Grant, structuredClone(grant)]) await assert.rejects(save(invalid, grant.draft));
  for (const field of ['id', 'input', 'inputKey', 'ownerId', 'dataEpoch', 'sessionRevision'] as const) {
    const next = { ...grant.draft, [field]: 'SYNTHETIC_CHANGED' }; await assert.rejects(save(grant, next));
  }
  await assert.rejects(save(grant, { ...grant.draft, context: { ...basis, date: '2026-10-05' } }));
  assert.deepEqual(await facts(), before);
});
test('actual modules: capability keeps private version independent of mutated public snapshots', async () => {
  const { entry } = await selected(); const grant = await prepare(entry), before = await facts();
  grant.draft.input = 'SYNTHETIC_FORGED_ORIGINAL'; await assert.rejects(save(grant, grant.draft));
  assert.deepEqual(await facts(), before);
});
test('actual modules: changed or missing persisted row rejects without touching current editor', async () => {
  for (const change of ['modified', 'missing'] as const) {
    const { entry, old } = await selected(); const grant = await prepare(entry);
    if (change === 'modified') await storage.db.settings.put({ key: `capture-review:${old.id}`, value: { ...old, diary: '合成较新原文' } });
    else await storage.db.settings.delete(`capture-review:${old.id}`);
    const before = await facts(); await assert.rejects(save(grant, { ...grant.draft, diary: '合成本次修改' })); assert.deepEqual(await facts(), before);
  }
});
for (const marker of ['capture-applied:', 'capture-source:', 'quickNotes']) test(`actual modules: any ${marker} added after continuation blocks correction atomically`, async () => {
  const { entry, old } = await selected(); const grant = await prepare(entry);
  if (marker === 'quickNotes') await storage.db.quickNotes.put({ id: old.id, rawInput: old.input, createdAt: 1, expenses: [], habits: [], todos: [], diary: null, mood: null, moodScore: null, confirmed: true });
  else await storage.db.settings.put({ key: marker + old.id, value: undefined });
  const before = await facts(); await assert.rejects(save(grant, { ...grant.draft, diary: '合成修改' })); assert.deepEqual(await facts(), before);
});
test('actual modules: current generation or strict epoch corruption cannot reuse a continuation', async () => {
  const { entry } = await selected(); const grant = await prepare(entry); api.setSessionActive('synthetic-continuation-A');
  let before = await facts(); await assert.rejects(save(grant, grant.draft)); assert.deepEqual(await facts(), before);
  const fresh = await prepare((await catalog.listCaptureDraftPage()).entries[0]);
  await storage.db.settings.put({ key: storage.LOCAL_DATA_EPOCH_KEY, value: undefined }); before = await facts();
  await assert.rejects(save(fresh, fresh.draft)); assert.deepEqual(await facts(), before);
});
test('actual modules: pending lookup never discards a different-session failed editor', async () => {
  const { entry, old } = await selected(); const pending = await import('../src/services/pendingEditorMemory.ts');
  const scope = { database: storage.db, owner: storage.db.ownerId, session: 'SYNTHETIC_PRIOR_SCOPE', epoch: old.dataEpoch, key: `capture-review:${old.id}` };
  const failed = { ...old, diary: '  合成尚未落盘\n必须保留  ' }; const token = pending.retainPendingEditor(scope, failed);
  try { const before = await facts(); await assert.rejects(prepare(entry), /未处理/); assert.deepEqual(await facts(), before); assert.deepEqual(pending.readPendingEditor(scope), failed); }
  finally { pending.releasePendingEditor(scope, token); }
});
test('actual modules: cancelling a prepared grant writes nothing and revokes future edits', async () => {
  const { entry } = await selected(); const grant = await prepare(entry), before = await facts();
  catalog.cancelCaptureContinuation(grant); catalog.cancelCaptureContinuation(grant);
  await assert.rejects(save(grant, grant.draft)); assert.deepEqual(await facts(), before);
});
test('actual modules: typed CAS distinguishes explicit undefined and minus zero but ignores field insertion order', async () => {
  const { entry, old } = await selected(); const grant = await prepare(entry);
  const reordered = Object.fromEntries(Object.entries(old).reverse()); await storage.db.settings.put({ key: `capture-review:${old.id}`, value: reordered });
  const next = { ...grant.draft, moodScore: -0 }; await save(grant, next);
  const changed = { ...next, moodScore: 0 }; await storage.db.settings.put({ key: `capture-review:${old.id}`, value: changed });
  const before = await facts(); await assert.rejects(save(grant, { ...next, diary: '合成候选' })); assert.deepEqual(await facts(), before);
  const fresh = await prepare((await catalog.listCaptureDraftPage()).entries.find(x => x.id === old.id)!);
  await storage.db.settings.put({ key: `capture-review:${old.id}`, value: { ...changed, diaryExcludedText: undefined } });
  const beforeUndefined = await facts(); await assert.rejects(save(fresh, { ...fresh.draft, diary: '合成候选2' })); assert.deepEqual(await facts(), beforeUndefined);
});
test('actual modules: quota before commit leaves complete original rows and pointers unchanged', async () => {
  const { entry } = await selected(); const grant = await prepare(entry), before = await facts(), put = storage.db.settings.put;
  storage.db.settings.put = (async () => { throw new DOMException('SYNTHETIC_QUOTA', 'QuotaExceededError'); }) as typeof put;
  try { await assert.rejects(save(grant, { ...grant.draft, diary: '合成修改' }), /SYNTHETIC_QUOTA/); }
  finally { storage.db.settings.put = put; }
  assert.deepEqual(await facts(), before);
  assert.equal((await save(grant, { ...grant.draft, diary: '合成修改' })).diary, '合成修改');
});
test('actual modules: lost result after committed local CAS can retry exact value without a second write', async () => {
  const { entry } = await selected(); const grant = await prepare(entry), original = storage.db.transaction; let once = true;
  storage.db.transaction = function (...args: unknown[]) { const result = Reflect.apply(original, this, args); return once && args[0] === 'rw' ? (once = false, result.then(() => { throw new Error('SYNTHETIC_RESULT_LOST_AFTER_COMMIT'); })) : result; } as typeof original;
  const next = { ...grant.draft, diary: '合成已提交原文' };
  try { await assert.rejects(save(grant, next), /RESULT_LOST/); } finally { storage.db.transaction = original; }
  const before = await facts(), put = storage.db.settings.put; let writes = 0;
  storage.db.settings.put = function (...args: Parameters<typeof put>) { writes++; return put.apply(this, args); } as typeof put;
  try { assert.deepEqual(await save(grant, next), next); } finally { storage.db.settings.put = put; }
  assert.equal(writes, 0); assert.deepEqual(await facts(), before);
});
test('actual modules: live getters in proposed arrays reject without executing getter or writes', async () => {
  const { entry } = await selected(); const grant = await prepare(entry), before = await facts(); let called = false;
  const expenses = [...grant.draft.expenses]; Object.defineProperty(expenses, '0', { enumerable: true, get() { called = true; return grant.draft.expenses[0]; } });
  await assert.rejects(save(grant, { ...grant.draft, expenses })); assert.equal(called, false); assert.deepEqual(await facts(), before);
});
test('actual modules: unchanged projected draft never creates a session-only rebind write', async () => {
  const { old } = await selected(); localStorage.setItem(api.SESSION_REVISION_KEY, 'synthetic-new-session'); api.setSessionActive('synthetic-continuation-A');
  const grant = await prepare((await catalog.listCaptureDraftPage()).entries.find(x => x.id === old.id)!); const before = await facts(), put = storage.db.settings.put; let writes = 0;
  storage.db.settings.put = function (...args: Parameters<typeof put>) { writes++; return put.apply(this, args); } as typeof put;
  try { assert.deepEqual(await save(grant, grant.draft), grant.draft); } finally { storage.db.settings.put = put; }
  assert.equal(writes, 0); assert.deepEqual(await facts(), before);
  const next = { ...grant.draft, diary: '合成明确改动' }; assert.deepEqual(await save(grant, next), next);
});
for (const invalidate of ['cancel', 'same-owner-new-generation'] as const) test(`actual modules: ${invalidate} during final awaited epoch check aborts local correction`, async () => {
  const { entry } = await selected(); const grant = await prepare(entry), before = await facts(); const get = storage.db.settings.get; let epochReads = 0;
  storage.db.settings.get = function (...args: Parameters<typeof get>) { const result = get.apply(this, args); return result.then(value => { if (args[0] === storage.LOCAL_DATA_EPOCH_KEY && ++epochReads === 2) { if (invalidate === 'cancel') catalog.cancelCaptureContinuation(grant); else api.setSessionActive('synthetic-continuation-A'); } return value; }); } as typeof get;
  try { await assert.rejects(save(grant, { ...grant.draft, diary: '合成不可发布旧写' })); } finally { storage.db.settings.get = get; }
  assert.equal(epochReads, 2); assert.deepEqual(await facts(), before);
});
test('actual modules: same typed-value delete and recreate is explicitly not a lifetime revision proof', async () => {
  const { entry, old } = await selected(); const grant = await prepare(entry);
  await storage.db.settings.delete(`capture-review:${old.id}`); await storage.db.settings.put({ key: `capture-review:${old.id}`, value: old });
  const next = { ...grant.draft, diary: '合成当前值可核，历史ABA未知' }; assert.deepEqual(await save(grant, next), next);
});
test('actual modules: nonenumerable fields and array extensions are rejected instead of silently cloned away', async () => {
  const { entry } = await selected(); const grant = await prepare(entry), before = await facts();
  const next = structuredClone(grant.draft); Object.defineProperty(next, 'diaryExcludedText', { enumerable: false, value: 'SYNTHETIC_MUST_NOT_DISAPPEAR' });
  await assert.rejects(save(grant, next));
  const expenses = [...grant.draft.expenses]; Object.defineProperty(expenses, 'extra', { enumerable: false, value: 'SYNTHETIC_MUST_NOT_DISAPPEAR' });
  await assert.rejects(save(grant, { ...grant.draft, expenses })); assert.deepEqual(await facts(), before);
});
test('actual modules: matching a newer row on a first attempt or retrying known conflict cannot mint replay authority', async () => {
  const { entry, old } = await selected(); const grant = await prepare(entry), desired = { ...grant.draft, diary: '合成另一页面已经写入' };
  await storage.db.settings.put({ key: `capture-review:${old.id}`, value: desired }); const before = await facts();
  await assert.rejects(save(grant, desired), /已变化/); await assert.rejects(save(grant, desired), /已变化/); assert.deepEqual(await facts(), before);
});
