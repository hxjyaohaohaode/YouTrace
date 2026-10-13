import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() }; };
Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory(), window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { replace() {} } }), document: { documentElement: { setAttribute() {} } } });
const storage = await import('../src/db/index.ts');
const api = await import('../src/services/apiClient.ts');
const sync = await import('../src/services/syncEngine.ts');
const capture = await import('../src/services/quickNoteIntegration.ts');
type Draft = Awaited<ReturnType<typeof capture.createCaptureDraft>>;
type Page = { entries: { id: string; draft: Draft }[]; scanned: number; skipped: number; nextCursor: object | null };
const page = (options?: { cursor?: object; limit?: number }): Promise<Page> => {
  const candidate = (capture as unknown as Record<string, unknown>).listCaptureDraftPage;
  assert.equal(typeof candidate, 'function', 'current module must provide a bounded read-only draft catalog');
  return (candidate as (options?: { cursor?: object; limit?: number }) => Promise<Page>)(options);
};
const basis = { capturedAt: 1791028800000, timeZone: 'Asia/Shanghai', date: '2026-10-03' };
beforeEach(async () => {
  sync.pauseSync(); api.clearSession(); localStorage.clear(); sessionStorage.clear();
  await storage.bindAccountDatabase('synthetic-catalog-A'); api.setSessionActive('synthetic-catalog-A');
  await storage.clearAllData({ allowPending: true }); sync.pauseSync();
});
after(() => { sync.pauseSync(); storage.db.close(); });
async function draft(id: string, text = `  合成原文 ${id}\n午饭15元；明天交报告  `): Promise<Draft> {
  const source = await capture.forkCaptureInput(); await capture.saveCaptureInput(source, text, basis);
  const value = { ...await capture.createCaptureDraft(text, source, basis), id };
  await capture.saveCaptureDraft(value, true); return value;
}
async function facts() { return storage.db.transaction('r', storage.db.tables, async () => Object.fromEntries(await Promise.all(storage.db.tables.map(async table => [table.name, await table.toArray()])))); }
test('fake IDB: catalog reaches old O/R as well as current D without changing any original row or pointer', async () => {
  const expected = [await draft('O'), await draft('R'), await draft('D')].sort((a,b) => a.id.localeCompare(b.id));
  const before = await facts(), inputPointer = sessionStorage.getItem(`youtrace:input:${storage.db.ownerId}`);
  const result = await page();
  assert.deepEqual(result.entries.map(x => x.draft), expected);
  assert.equal(result.scanned, 3); assert.equal(result.skipped, 0); assert.equal(result.nextCursor, null);
  assert.deepEqual(await facts(), before); assert.equal(sessionStorage.getItem(`youtrace:input:${storage.db.ownerId}`), inputPointer);
});

test('fake IDB: unknown bindings, shapes and any committed marker remain untouched and unlisted', async () => {
  const good = await draft('valid');
  const put = async (id: string, value: unknown) => storage.db.settings.put({ key: `capture-review:${id}`, value });
  const variants: Array<[string, Record<string, unknown>]> = [
    ['unbound', { ...good, ownerId: undefined }], ['old-epoch', { ...good, dataEpoch: 'old' }], ['other-owner', { ...good, ownerId: 'synthetic-B' }],
    ['unknown-field', { ...good, privateMemo: 'SYNTHETIC_UNSUPPORTED' }], ['bad-array', { ...good, todos: null }], ['bad-context', { ...good, context: { ...basis, date: '2026-02-30' } }],
    ['not-authenticated', { ...good, sessionActive: false }], ['leaf-extra', { ...good, todos: [{ id: 't', text: '原文', confirmed: true, secret: 'SYNTHETIC' }] }],
  ];
  for (const [id, value] of variants) await put(id, { ...value, id });
  await put('wrong-key', { ...good, id: 'different' });
  for (const [id, marker] of [['receipt', 'capture-applied:'], ['source', 'capture-source:']] as const) {
    await put(id, { ...good, id }); await storage.db.settings.put({ key: `${marker}${id}`, value: undefined });
  }
  await put('already-note', { ...good, id: 'already-note' });
  await storage.db.quickNotes.put({ id: 'already-note', rawInput: good.input, createdAt: 1, expenses: [], habits: [], todos: [], diary: null, mood: null, moodScore: null, confirmed: true });
  const before = await facts(), result = await page({ limit: 50 });
  assert.deepEqual(result.entries.map(x => x.id), ['valid']); assert.equal(result.skipped, 12);
  assert.deepEqual(await facts(), before);
});

test('fake IDB: bounded pages advance through ineligible prefixes and preserve all 123 keys', async () => {
  const good = await draft('z-valid');
  for (let i = 0; i < 123; i++) {
    const id = String(i).padStart(4, '0');
    await storage.db.settings.put({ key: `capture-review:${id}`, value: { ...good, id, ...(i < 55 ? { ownerId: undefined } : {}) } });
  }
  const before = await facts(), modes: string[] = [], original = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) { modes.push(args[1] ?? 'readonly'); return original.apply(this, args); };
  // Dexie binds the native transaction function on open. Reopen only this synthetic DB
  // under the observer so every actual catalog transaction is measured.
  storage.db.close(); await storage.db.open(); modes.length = 0;
  const found: string[] = []; let cursor: object | undefined, calls = 0;
  try {
    do { const result = await page({ cursor, limit: 50 }); calls++; assert.ok(result.scanned <= 50); if (calls === 1) { assert.equal(result.entries.length, 0); assert.ok(result.nextCursor); } found.push(...result.entries.map(x => x.id)); cursor = result.nextCursor ?? undefined; } while (cursor);
  } finally { storage.db.close(); IDBDatabase.prototype.transaction = original; await storage.db.open(); }
  assert.equal(calls, 3); assert.equal(found.length, 69); assert.equal(new Set(found).size, 69);
  assert.ok(modes.length > 0); assert.ok(modes.every(mode => mode === 'readonly'));
  assert.deepEqual(await facts(), before);
});

test('fake IDB: incomplete but known editable values and original whitespace are preserved, never made valid for apply', async () => {
  const good = await draft('incomplete');
  const value = { ...good, diary: '', diaryExcludedText: '  未选择\n原句  ', moodScore: 0, expenses: [{ id: 'expense', name: '', amount: 0, amountText: 'not-yet-a-number', category: 'other', confirmed: true, date: null, currency: 'CNY' as const }], todos: [{ id: 'todo', text: '', confirmed: true, dueDate: null, dateUncertain: true, dateConfirmed: false }] };
  await storage.db.settings.put({ key: `capture-review:${value.id}`, value });
  assert.deepEqual((await page()).entries[0].draft, value);
  await assert.rejects(capture.applyCaptureDraft(value));
});

test('fake IDB: older session draft may be previewed unchanged only by current verified same-owner actor', async () => {
  const value = await draft('old-session'); localStorage.setItem(api.SESSION_REVISION_KEY, 'current-new-revision'); api.setSessionActive('synthetic-catalog-A');
  const before = await facts(); assert.deepEqual((await page()).entries[0].draft, value); assert.deepEqual(await facts(), before);
  api.clearSession(); await assert.rejects(page());
});

test('fake IDB: forged/serialized cursors and out-of-bound budgets reject; continuation binds session generation and epoch', async () => {
  await draft('A'); await draft('B'); const first = await page({ limit: 1 }); assert.ok(first.nextCursor);
  const before = await facts();
  for (const limit of [0, -1, 51, 1.5, NaN, Infinity]) await assert.rejects(page({ limit }));
  await assert.rejects(page({ cursor: {} })); await assert.rejects(page({ cursor: structuredClone(first.nextCursor!) }));
  assert.deepEqual(await facts(), before);
  api.setSessionActive('synthetic-catalog-A'); await assert.rejects(page({ cursor: first.nextCursor! }));
  const fresh = await page({ limit: 1 }); await storage.db.settings.put({ key: storage.LOCAL_DATA_EPOCH_KEY, value: 'rotated' });
  await assert.rejects(page({ cursor: fresh.nextCursor! })); assert.equal((await page()).entries.length, 0);
});

test('fake IDB: owner mismatch fails closed in the bound document and leaves inactive B unchanged', async () => {
  await draft('A-one'); await draft('A-two'); const first = await page({ limit: 1 }), aFacts = await facts();
  const { prepareAccountGeneration } = await import('../src/db/accountGeneration.ts');
  await prepareAccountGeneration('synthetic-catalog-B'); const other = new storage.YoujiDatabase('synthetic-catalog-B', true); await other.open();
  try {
    await other.settings.put({ key: 'capture-review:B-private', value: { privateOriginal: 'SYNTHETIC_B_ONLY' } });
    const bBefore = await other.transaction('r', other.tables, async () => Object.fromEntries(await Promise.all(other.tables.map(async table => [table.name, await table.toArray()]))));
    api.clearSession(); api.setSessionActive('synthetic-catalog-B');
    await assert.rejects(storage.bindAccountDatabase('synthetic-catalog-B'), /重新加载/);
    await assert.rejects(page()); await assert.rejects(page({ cursor: first.nextCursor! }));
    api.clearSession(); api.setSessionActive('synthetic-catalog-A');
    await assert.rejects(page({ cursor: first.nextCursor! })); assert.equal((await page()).entries.length, 2); assert.deepEqual(await facts(), aFacts);
    assert.deepEqual(await other.transaction('r', other.tables, async () => Object.fromEntries(await Promise.all(other.tables.map(async table => [table.name, await table.toArray()])))), bBefore);
  } finally { other.close(); }
});

test('fake IDB: failed reads reject rather than becoming an empty directory; original data remains exact', async () => {
  await draft('stored'); const before = await facts(), original = storage.db.settings.get;
  storage.db.settings.get = (() => Promise.reject(new Error('SYNTHETIC_READ_FAILURE'))) as typeof original;
  try { await assert.rejects(page(), /SYNTHETIC_READ_FAILURE/); } finally { storage.db.settings.get = original; }
  assert.deepEqual(await facts(), before);
});

test('fake IDB: delayed successful transaction delivery is rejected after epoch changes', async () => {
  await draft('stored'); const database = storage.db, original = database.transaction;
  let signal!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { signal = resolve; }), held = new Promise<void>(resolve => { release = resolve; }); let once = false;
  database.transaction = function (...args: unknown[]) {
    const result = Reflect.apply(original, this, args);
    if (!once && args[0] === 'r' && Array.isArray(args[1]) && args[1].length === 2) { once = true; return result.then(async (value: unknown) => { signal(); await held; return value; }); }
    return result;
  } as typeof original;
  try { const pending = page(); const rejected = assert.rejects(pending, /资料已变化/); await reached; await database.settings.put({ key: storage.LOCAL_DATA_EPOCH_KEY, value: 'new-epoch' }); release(); await rejected; }
  finally { release(); database.transaction = original; }
  assert.equal(await database.settings.where('key').startsWith('capture-review:').count(), 1);
});

test('fake IDB: delayed old-session page cannot publish after a newer login, even if owner and revision match', async () => {
  await draft('stored'); const database = storage.db, original = database.transaction;
  let signal!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { signal = resolve; }), held = new Promise<void>(resolve => { release = resolve; }); let once = false;
  database.transaction = function (...args: unknown[]) { const result = Reflect.apply(original, this, args); if (!once && args[0] === 'r' && Array.isArray(args[1]) && args[1].length === 2) { once = true; return result.then(async (value: unknown) => { signal(); await held; return value; }); } return result; } as typeof original;
  try { const pending = page(); const rejected = assert.rejects(pending, /账号或本机资料已变化/); await reached; api.setSessionActive('synthetic-catalog-A'); assert.equal((await page()).entries.length, 1); release(); await rejected; }
  finally { release(); database.transaction = original; }
});

test('fake IDB: pages are fresh snapshots; commit between pages is omitted without stale marker reads', async () => {
  const one = await draft('A'), two = await draft('B'); const first = await page({ limit: 1 }); assert.equal(first.entries[0].id, one.id);
  await storage.db.settings.put({ key: `capture-applied:${two.id}`, value: { incompleteReceipt: true } });
  const second = await page({ cursor: first.nextCursor!, limit: 1 }); assert.equal(second.entries.length, 0); assert.equal(second.scanned, 1);
});

test('fake IDB: exact supported shape rejects malformed keys, sparse/oversized/duplicate lists without rewriting them', async () => {
  const good = await draft('plain');
  const sparse = Array(1), duplicate = [{ id: 'same', text: '一', confirmed: true }, { id: 'same', text: '二', confirmed: false }];
  const variants = [
    { context: { ...basis, extra: 'unsupported' } }, { inputKey: 'capture-input:' }, { input: 'x'.repeat(5001) },
    { todos: sparse }, { todos: duplicate }, { todos: Array.from({ length: 101 }, (_, i) => ({ id: String(i), text: '一', confirmed: false })) },
    { expenses: [{ id: 'e', name: '原文', amount: NaN, confirmed: false, category: 'other' }] },
    { habits: [{ id: 'h', name: '原文', done: 'true', confirmed: false }] },
    { mood: 'unknown' }, { moodScore: Infinity }, { context: { ...basis, capturedAt: -1 } },
    { sessionRevision: 1 }, { dataEpoch: null }, { context: { ...basis, timeZone: 'unverified-zone' } },
  ];
  for (let i = 0; i < variants.length; i++) { const id = `bad-${i}`; await storage.db.settings.put({ key: `capture-review:${id}`, value: { ...good, ...variants[i], id } }); }
  const wrapper = { key: 'capture-review:wrapper', value: { ...good, id: 'wrapper' }, extra: 'SYNTHETIC_UNSUPPORTED' };
  await storage.db.settings.put(wrapper);
  const before = await facts(); const result = await page({ limit: 50 });
  assert.deepEqual(result.entries.map(x => x.id), ['plain']); assert.equal(result.skipped, variants.length + 1); assert.deepEqual(await facts(), before);
});

test('fake IDB: actual read-only transaction abort is a visible rejection and retains all records', async () => {
  await draft('untouched'); const before = await facts(), database = storage.db, original = database.settings.get;
  const Dexie = (await import('dexie')).default; let fired = false;
  database.settings.get = function (...args: Parameters<typeof original>) {
    const result = original.apply(this, args);
    if (!fired && args[0] === storage.LOCAL_DATA_EPOCH_KEY && Dexie.currentTransaction?.mode === 'readonly') { fired = true; Dexie.currentTransaction.abort(); }
    return result;
  } as typeof original;
  try { await assert.rejects(page()); assert.equal(fired, true); } finally { database.settings.get = original; }
  assert.deepEqual(await facts(), before); assert.equal((await page()).entries.length, 1);
});

test('fake IDB: returned previews are detached; no network or implicit current-pointer update occurs', async () => {
  const expected = await draft('detached'); const before = await facts(), oldFetch = globalThis.fetch; let network = 0;
  globalThis.fetch = (async () => { network++; throw new Error('Network forbidden'); }) as typeof fetch;
  try { const result = await page(); result.entries[0].draft.input = 'caller edit'; result.entries[0].draft.todos[0].text = 'caller child edit'; assert.deepEqual((await page()).entries[0].draft, expected); }
  finally { globalThis.fetch = oldFetch; }
  assert.equal(network, 0); assert.deepEqual(await facts(), before);
});

test('fake IDB: legacy implicit initial epoch is accepted only with an explicit matching draft binding', async () => {
  const good = await draft('initial'); await storage.db.settings.delete(storage.LOCAL_DATA_EPOCH_KEY);
  const bound = { ...good, dataEpoch: 'initial' }; await storage.db.settings.put({ key: `capture-review:${good.id}`, value: bound });
  const before = await facts(); assert.deepEqual((await page()).entries[0].draft, bound); assert.deepEqual(await facts(), before);
  const missing = { ...bound, dataEpoch: undefined }; await storage.db.settings.put({ key: `capture-review:${good.id}`, value: missing });
  const unbound = await facts(); assert.equal((await page()).entries.length, 0); assert.deepEqual(await facts(), unbound);
});

test('fake IDB: refresh discovers insertions before an issued cursor; continuation never claims a whole-directory snapshot', async () => {
  const b = await draft('B'); await draft('C'); const first = await page({ limit: 1 }); assert.equal(first.entries[0].id, 'B');
  await storage.db.settings.put({ key: 'capture-review:A', value: { ...b, id: 'A', input: '新插入原文' } });
  const second = await page({ cursor: first.nextCursor!, limit: 50 }); assert.deepEqual(second.entries.map(x => x.id), ['C']);
  assert.deepEqual((await page({ limit: 50 })).entries.map(x => x.id), ['A', 'B', 'C']);
});

test('fake IDB: an existing malformed epoch row is never the absent initial epoch, with zero repair writes', async () => {
  const good = await draft('initial-binding');
  await storage.db.settings.put({ key: `capture-review:${good.id}`, value: { ...good, dataEpoch: 'initial' } });
  for (const row of [{ key: storage.LOCAL_DATA_EPOCH_KEY }, ...[undefined, null, 1, {}, '', 'x'.repeat(257)].map(value => ({ key: storage.LOCAL_DATA_EPOCH_KEY, value }))]) {
    await storage.db.settings.put(row as { key: string; value: unknown }); const before = await facts();
    await assert.rejects(page(), /资料已变化/); assert.deepEqual(await facts(), before);
  }
});

test('fake IDB: absent epoch becoming a malformed existing row before delivery rejects every late preview', async () => {
  const good = await draft('late-initial'); await storage.db.settings.put({ key: `capture-review:${good.id}`, value: { ...good, dataEpoch: 'initial' } });
  const database = storage.db, original = database.transaction;
  for (const row of [{ key: storage.LOCAL_DATA_EPOCH_KEY }, ...[undefined, null, 1, {}].map(value => ({ key: storage.LOCAL_DATA_EPOCH_KEY, value }))]) {
    await database.settings.delete(storage.LOCAL_DATA_EPOCH_KEY);
    let signal!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { signal = resolve; }), held = new Promise<void>(resolve => { release = resolve; }); let once = false;
    database.transaction = function (...args: unknown[]) { const result = Reflect.apply(original, this, args); if (!once && args[0] === 'r' && Array.isArray(args[1]) && args[1].length === 2) { once = true; return result.then(async (value: unknown) => { signal(); await held; return value; }); } return result; } as typeof original;
    try {
      const pending = page(); const rejected = assert.rejects(pending, /资料已变化/); await reached;
      await database.settings.put(row as { key: string; value: unknown }); const expected = await facts();
      release(); await rejected; assert.deepEqual(await facts(), expected);
    } finally { release(); database.transaction = original; }
  }
});
