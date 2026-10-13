import { LOCAL_DATA_EPOCH_KEY } from '../db';
import { assertLocalActorNow, captureLocalActor, type LocalActor } from './localActor';
import { isCaptureDate, MOOD_LEVELS } from './parser';
import type { CaptureDraft } from './quickNoteIntegration';
import { hasPendingEditorForRecord, matchesPendingEditor, retainPendingEditorIfAvailable, releasePendingEditor, type EditorMemoryScope } from './pendingEditorMemory';

/** Read-only preview, not an authorization to reopen, save, claim or apply. */
export interface CaptureCatalogEntry { id: string; draft: CaptureDraft }
export interface CaptureCatalogCursor { readonly kind: 'capture-catalog-continuation' }
export interface CaptureCatalogPage {
  entries: CaptureCatalogEntry[];
  scanned: number;
  skipped: number;
  nextCursor: CaptureCatalogCursor | null;
}
const scopes = new WeakMap<object, LocalActor>();
const versions = new WeakMap<CaptureCatalogEntry, CaptureDraft>();
const cursors = new WeakMap<CaptureCatalogCursor, { actor: LocalActor; afterKey: string }>();
const PREFIX = 'capture-review:', END = 'capture-review;';
const MAX_PAGE = 50;
const failure = () => new Error('确认稿目录的账号或资料已变化，请重新读取；原稿未改动');
type RecordValue = Record<string, unknown>;
function record(value: unknown, allowed: string[], required = allowed): value is RecordValue {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key) && descriptors[key].enumerable === true && 'value' in descriptors[key])
    && required.every(key => Object.hasOwn(value, key));
}
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 256;
const date = (value: unknown) => value === null || isCaptureDate(value);
const optional = (row: RecordValue, key: string, check: (value: unknown) => boolean) => row[key] === undefined || check(row[key]);
const boolean = (value: unknown) => typeof value === 'boolean';
function rows(value: unknown, check: (row: unknown) => boolean): boolean {
  if (!Array.isArray(value) || value.length > 100 || Object.keys(value).length !== value.length) return false;
  if (Reflect.ownKeys(value).some(key => {
    if (typeof key !== 'string') return true;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return !('value' in descriptor) || key !== 'length' && (!descriptor.enumerable || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length);
  })) return false;
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index) || !check(value[index]) || ids.has(value[index].id)) return false;
    ids.add(value[index].id);
  }
  return true;
}
function context(value: unknown): boolean {
  return record(value, ['capturedAt', 'timeZone', 'date'])
    && (value.capturedAt === null || Number.isSafeInteger(value.capturedAt) && (value.capturedAt as number) >= 0)
    && (value.timeZone === null || value.timeZone === 'Asia/Shanghai') && date(value.date);
}
function expense(value: unknown): boolean {
  return record(value, ['id', 'name', 'amount', 'amountText', 'category', 'confirmed', 'date', 'currency', 'isIncome'], ['id', 'name', 'amount', 'category', 'confirmed'])
    && id(value.id) && text(value.name, 100) && Number.isSafeInteger(value.amount)
    && text(value.category, 64) && boolean(value.confirmed)
    && optional(value, 'amountText', v => text(v, 512)) && optional(value, 'date', date)
    && optional(value, 'currency', v => v === 'CNY') && optional(value, 'isIncome', boolean);
}
function todo(value: unknown): boolean {
  return record(value, ['id', 'text', 'confirmed', 'dueDate', 'dateUncertain', 'dateConfirmed'], ['id', 'text', 'confirmed'])
    && id(value.id) && text(value.text, 200) && boolean(value.confirmed)
    && optional(value, 'dueDate', date) && optional(value, 'dateUncertain', boolean) && optional(value, 'dateConfirmed', boolean);
}
function habit(value: unknown): boolean {
  return record(value, ['id', 'name', 'done', 'confirmed', 'habitId', 'date'], ['id', 'name', 'done', 'confirmed'])
    && id(value.id) && text(value.name, 100) && boolean(value.done) && boolean(value.confirmed)
    && optional(value, 'habitId', id) && optional(value, 'date', date);
}
function knownDraft(value: unknown, key: string, actor: LocalActor): value is CaptureDraft {
  const keys = ['id', 'input', 'inputKey', 'context', 'ownerId', 'dataEpoch', 'sessionRevision', 'sessionActive', 'expenses', 'habits', 'todos', 'diary', 'diaryExcludedText', 'diaryDate', 'mood', 'moodScore', 'moodConfirmed'];
  return record(value, keys, keys.filter(key => !['diaryExcludedText', 'diaryDate', 'moodConfirmed'].includes(key)))
    && id(value.id) && key === `${PREFIX}${value.id}` && text(value.input, 5000)
    && typeof value.inputKey === 'string' && value.inputKey.startsWith('capture-input:') && value.inputKey.length > 'capture-input:'.length && value.inputKey.length <= 270
    && value.ownerId === actor.owner && value.dataEpoch === (actor.epoch ?? 'initial')
    && (value.sessionRevision === null || text(value.sessionRevision, 256)) && value.sessionActive === true
    && context(value.context) && rows(value.expenses, expense) && rows(value.todos, todo) && rows(value.habits, habit)
    && (value.diary === null || text(value.diary, 10000)) && optional(value, 'diaryExcludedText', v => text(v, 10000))
    && optional(value, 'diaryDate', date) && optional(value, 'moodConfirmed', boolean)
    && (value.mood === null || MOOD_LEVELS.some(mood => mood === value.mood))
    && (value.moodScore === null || typeof value.moodScore === 'number' && Number.isFinite(value.moodScore));
}

/** Unlike the generic actor helper, distinguish an absent epoch ROW from a
 * present malformed row. The same validation guards snapshot and publication. */
async function readCatalogEpoch(actor: Omit<LocalActor, 'epoch'>): Promise<string | undefined> {
  assertLocalActorNow(actor);
  const row = await actor.database.settings.get(LOCAL_DATA_EPOCH_KEY);
  assertLocalActorNow(actor);
  if (row === undefined) return undefined;
  if (!record(row, ['key', 'value']) || row.key !== LOCAL_DATA_EPOCH_KEY || typeof row.value !== 'string' || row.value.length === 0 || row.value.length > 256) throw failure();
  return row.value;
}
async function assertCatalogActor(actor: LocalActor): Promise<void> {
  if (await readCatalogEpoch(actor) !== actor.epoch) throw failure();
}

/**
 * At most limit candidate keys (+ one lookahead) per call. Ineligible rows also
 * advance the cursor. Each page is one consistent RO snapshot, not a frozen
 * whole-directory snapshot. New/changed rows require a fresh scan before use.
 */
export async function listCaptureDraftPage(options: { cursor?: CaptureCatalogCursor; limit?: number } = {}): Promise<CaptureCatalogPage> {
  const captured = captureLocalActor();
  if (!captured.owner) throw failure();
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw new Error('确认稿目录每页扫描数量必须为1至50');
  const prior = options.cursor && cursors.get(options.cursor);
  if (options.cursor && !prior) throw failure();
  const database = captured.database;
  let pageActor!: LocalActor;
  const result = await database.transaction('r', [database.settings, database.quickNotes], async () => {
    assertLocalActorNow(captured);
    const epoch = await readCatalogEpoch(captured);
    const actor: LocalActor = { ...captured, epoch }; pageActor = actor;
    assertLocalActorNow(actor);
    if (prior && (prior.actor.database !== database || prior.actor.owner !== actor.owner || prior.actor.session !== actor.session || prior.actor.sessionGeneration !== actor.sessionGeneration || prior.actor.epoch !== epoch)) throw failure();
    const candidates = await database.settings.where('key').between(prior?.afterKey ?? PREFIX, END, !prior, false).limit(limit + 1).toArray();
    const scanned = candidates.slice(0, limit), entries: CaptureCatalogEntry[] = [];
    for (const row of scanned) {
      if (!record(row, ['key', 'value']) || typeof row.key !== 'string' || !knownDraft(row.value, row.key, actor)) continue;
      const draft = row.value;
      // Any durable commit marker, including malformed values, blocks listing.
      const [receipt, source, note] = await Promise.all([
        database.settings.get(`capture-applied:${draft.id}`), database.settings.get(`capture-source:${draft.id}`), database.quickNotes.get(draft.id),
      ]);
      if (receipt !== undefined || source !== undefined || note !== undefined) continue;
      entries.push({ id: draft.id, draft: structuredClone(draft) });
    }
    await assertCatalogActor(actor);
    return { entries, scanned: scanned.length, skipped: scanned.length - entries.length, afterKey: candidates.length > limit ? scanned.at(-1)!.key : null };
  });
  // Do not publish a completed old-actor/old-epoch read after transaction delivery.
  await assertCatalogActor(pageActor);
  let nextCursor: CaptureCatalogCursor | null = null;
  if (result.afterKey !== null) {
    nextCursor = Object.freeze({ kind: 'capture-catalog-continuation' as const });
    cursors.set(nextCursor, { actor: pageActor, afterKey: result.afterKey });
  }
  const page = { entries: result.entries, scanned: result.scanned, skipped: result.skipped, nextCursor };
  scopes.set(page, pageActor);
  for (const entry of page.entries) { scopes.set(entry, pageActor); versions.set(entry, structuredClone(entry.draft)); }
  return page;
}

/** Synchronous identity guard for render/publication, NOT a synchronous epoch read. */
export function isCaptureCatalogContextCurrent(value: object): boolean {
  const actor = scopes.get(value);
  if (!actor) return false;
  try { assertLocalActorNow(actor); return true; } catch { return false; }
}
export async function assertCaptureCatalogContext(value: object): Promise<void> {
  const actor = scopes.get(value);
  if (!actor) throw failure();
  await assertCatalogActor(actor);
}
// All inputs below were checked as bounded plain records/arrays/primitives.
// Keep explicit undefined and -0 distinct; object insertion order is immaterial.
function versionValue(value: unknown): unknown {
  if (value === undefined) return ['undefined'];
  if (value === null) return ['null'];
  if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
  if (typeof value !== 'object') return [typeof value, value];
  if (Array.isArray(value)) return ['array', value.map(versionValue)];
  return ['object', Object.keys(value).sort().map(key => [key, versionValue((value as RecordValue)[key])])];
}

/** Explicit selection reads the issued version again; never calls the RW loader. */
export async function readCaptureCatalogEntry(entry: CaptureCatalogEntry): Promise<CaptureDraft> {
  const actor = scopes.get(entry), expected = versions.get(entry);
  if (!actor || !expected) throw failure();
  assertLocalActorNow(actor);
  const database = actor.database, key = `${PREFIX}${expected.id}`;
  const changed = () => new Error('这份确认稿已变化或已提交，请重新读取目录。原稿未改动');
  const draft = await database.transaction('r', [database.settings, database.quickNotes], async () => {
    await assertCatalogActor(actor);
    const row = await database.settings.get(key);
    if (!record(row, ['key', 'value']) || row.key !== key || !knownDraft(row.value, key, actor)) throw changed();
    const [receipt, source, note] = await Promise.all([
      database.settings.get(`capture-applied:${expected.id}`), database.settings.get(`capture-source:${expected.id}`), database.quickNotes.get(expected.id),
    ]);
    if (receipt !== undefined || source !== undefined || note !== undefined || JSON.stringify(versionValue(row.value)) !== JSON.stringify(versionValue(expected))) throw changed();
    await assertCatalogActor(actor);
    return structuredClone(row.value);
  });
  await assertCatalogActor(actor);
  return draft;
}

/** Internal first-stage capability. No UI entry or business apply is enabled by
 * this API. Looking at a catalog entry never creates one of these grants. */
export interface CaptureContinuation {
  readonly kind: 'capture-continuation';
  readonly draft: CaptureDraft;
}
interface ContinuationState {
  actor: LocalActor; expected: CaptureDraft; initial: CaptureDraft; busy: boolean; closed: boolean;
  uncertain?: { expected: CaptureDraft; desired: CaptureDraft };
  sequence: number; acknowledged: number;
  pending?: { token: number; sequence: number; value: CaptureDraft; owned: boolean };
}
const continuations = new WeakMap<CaptureContinuation, ContinuationState>();
// Failed edits survive a component unmount. This is document memory, NOT disk
// durability or cross-session recovery. Never delete it merely to reopen a grant.
const retainedContinuations = new Map<CaptureContinuation, ContinuationState>();
export interface CaptureContinuationEdit { readonly kind: 'capture-continuation-edit' }
const continuationEdits = new WeakMap<CaptureContinuationEdit, { grant: CaptureContinuation; sequence: number; value: CaptureDraft }>();
const pendingScope = (state: ContinuationState): EditorMemoryScope => ({ database: state.actor.database, owner: state.actor.owner, session: state.actor.session, epoch: state.actor.epoch, key: `${PREFIX}${state.initial.id}` });
function assertContinuationPending(state: ContinuationState): void {
  if ([...retainedContinuations.values()].some(other => other !== state && other.actor.database === state.actor.database && other.actor.owner === state.actor.owner && other.initial.id === state.initial.id && other.pending)) throw new Error('另一份本机编辑仍有未落盘内容，未写入或替换');
  if (state.pending) {
    if (!state.pending.owned || !matchesPendingEditor(pendingScope(state), state.pending.token)) throw new Error('未落盘编辑的归属已变化，仍保留本次原文，未继续写入');
  } else assertNoPending(state.actor, state.initial.id);
}
// Memory retention is deliberately weaker than disk eligibility: an unfinished
// numeric/date edit must survive for correction. Reject executable/unsupported
// JS shapes without invoking accessors; no such value reaches the disk validator.
function plainEdit(value: unknown, depth = 0, path = new Set<object>()): boolean {
  if (value === null || ['undefined', 'string', 'boolean', 'number'].includes(typeof value)) return true;
  if (!value || typeof value !== 'object' || depth > 8 || path.has(value)) return false;
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  path.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const safe = Reflect.ownKeys(value).every(key => {
    if (typeof key !== 'string') return false;
    const descriptor = descriptors[key];
    return 'value' in descriptor && (descriptor.enumerable || Array.isArray(value) && key === 'length') && plainEdit(descriptor.value, depth + 1, path);
  });
  path.delete(value); return safe;
}
function validateContinuationValue(state: ContinuationState, value: CaptureDraft, forWrite = true): void {
  const { actor, initial } = state;
  if (forWrite ? !knownDraft(value, `${PREFIX}${initial.id}`, actor) : !plainEdit(value)) throw failure();
  for (const field of ['id', 'input', 'inputKey', 'context', 'ownerId', 'dataEpoch', 'sessionRevision', 'sessionActive'] as const) {
    if (Object.hasOwn(value, field) !== Object.hasOwn(initial, field) || !exact(value[field], initial[field])) throw failure();
  }
}
/** Private original/pending clone, not ordinary pending recovery or upgrade. */
export function readCaptureContinuationState(grant: CaptureContinuation): { draft: CaptureDraft; pending: boolean } {
  const state = continuations.get(grant);
  if (!state) throw failure();
  assertLocalActorNow(state.actor);
  return { draft: structuredClone(state.pending?.value ?? continuationView(state.expected, state.actor)), pending: Boolean(state.pending) };
}
/** A typed comparison text, explicitly not an import/restore format. */
export function captureContinuationText(grant: CaptureContinuation): string {
  return JSON.stringify({ format: 'youtrace-capture-review-typed-comparison-v1', value: versionValue(readCaptureContinuationState(grant).draft) }, null, 2);
}
export async function assertCaptureContinuationContext(grant: CaptureContinuation): Promise<void> {
  const state = continuations.get(grant);
  if (!state || state.closed) throw failure();
  await assertCatalogActor(state.actor);
  if (state.closed) throw failure();
}
export function isCaptureContinuationCurrent(grant: CaptureContinuation): boolean {
  const state = continuations.get(grant);
  if (!state || state.closed) return false;
  try { assertLocalActorNow(state.actor); return true; } catch { return false; }
}
/** Registers an exact immutable queued edit. Shared Map ownership is only a
 * conflict detector; the private retained copy remains when legacy code removes
 * or replaces the Map slot. A lost slot is never automatically reacquired. */
export function stageCaptureContinuationEdit(grant: CaptureContinuation, value: CaptureDraft): CaptureContinuationEdit {
  const state = continuations.get(grant);
  if (!state || state.closed) throw failure();
  validateContinuationValue(state, value, false);
  const next = structuredClone(value), sequence = ++state.sequence, prior = state.pending;
  retainedContinuations.set(grant, state);
  try {
    assertLocalActorNow(state.actor); assertContinuationPending(state);
    const token = retainPendingEditorIfAvailable(pendingScope(state), next, prior?.token);
    state.pending = { token, sequence, value: next, owned: true };
  } catch (error) {
    state.pending = { token: prior?.token ?? 0, sequence, value: next, owned: false };
    throw error;
  }
  const ticket: CaptureContinuationEdit = Object.freeze({ kind: 'capture-continuation-edit' });
  continuationEdits.set(ticket, { grant, sequence, value: structuredClone(next) });
  return ticket;
}
const exact = (left: unknown, right: unknown) => JSON.stringify(versionValue(left)) === JSON.stringify(versionValue(right));
function continuationView(source: CaptureDraft, actor: LocalActor): CaptureDraft {
  return { ...source, ownerId: actor.owner, dataEpoch: actor.epoch ?? 'initial', sessionRevision: actor.session, sessionActive: true } as CaptureDraft;
}
function assertNoPending(actor: LocalActor, id: string): void {
  if (hasPendingEditorForRecord(actor.database, actor.owner, `${PREFIX}${id}`)) throw new Error('这份原稿还有未处理的本机编辑，请先返回原编辑核对；没有覆盖或丢弃修改');
}
async function uncommitted(actor: LocalActor, id: string): Promise<void> {
  const database = actor.database;
  const [receipt, source, note] = await Promise.all([
    database.settings.get(`capture-applied:${id}`), database.settings.get(`capture-source:${id}`), database.quickNotes.get(id),
  ]);
  if (receipt !== undefined || source !== undefined || note !== undefined) throw new Error('这份原稿已有保存标记，请核对原记录；没有继续写入');
}

/** Called only by an eventual separate explicit continuation action. The whole
 * handoff is RO: no actor rebinding, current row, input or session pointer write. */
export async function prepareCaptureContinuation(entry: CaptureCatalogEntry): Promise<CaptureContinuation> {
  const actor = scopes.get(entry), expected = versions.get(entry);
  if (!actor || !expected) throw failure();
  assertLocalActorNow(actor); assertNoPending(actor, expected.id);
  if ([...retainedContinuations.values()].some(state => state.actor.database === actor.database && state.actor.owner === actor.owner && state.initial.id === expected.id && state.pending)) throw new Error('这份原稿仍有未落盘修改保留在本次打开的应用中，请先核对原编辑');
  const source = await readCaptureCatalogEntry(entry);
  assertLocalActorNow(actor); assertNoPending(actor, expected.id);
  if ([...retainedContinuations.values()].some(state => state.actor.database === actor.database && state.actor.owner === actor.owner && state.initial.id === expected.id && state.pending)) throw new Error('这份原稿仍有未落盘修改，请先核对原编辑');
  const projected = continuationView(source, actor);
  const grant: CaptureContinuation = Object.freeze({ kind: 'capture-continuation', draft: structuredClone(projected) });
  continuations.set(grant, { actor, expected: structuredClone(source), initial: structuredClone(projected), busy: false, closed: false, sequence: 0, acknowledged: 0 });
  return grant;
}

/** Cancels only this document's capability; never rolls back a committed edit. */
export function cancelCaptureContinuation(grant: CaptureContinuation): void {
  const state = continuations.get(grant);
  if (state) state.closed = true;
}

/** Explicit local correction only. Typed full-row CAS, never an apply/commit or
 * a lifetime-revision claim: indistinguishable same-value ABA remains unknown. */
export async function saveCaptureContinuation(grant: CaptureContinuation, value: CaptureDraft, ticket?: CaptureContinuationEdit): Promise<CaptureDraft> {
  const state = continuations.get(grant);
  if (!state || state.busy || state.closed) throw failure();
  const { actor, initial } = state, database = actor.database, key = `${PREFIX}${initial.id}`;
  assertLocalActorNow(actor); assertContinuationPending(state);
  validateContinuationValue(state, value);
  const edit = ticket && continuationEdits.get(ticket);
  if (state.pending || ticket) {
    if (!edit || edit.grant !== grant || edit.sequence <= state.acknowledged || !exact(edit.value, value)) throw failure();
  }
  const next = structuredClone(value), expected = structuredClone(state.expected);
  const retry = state.uncertain;
  let bodyFinished = false;
  state.busy = true;
  const active = () => { assertLocalActorNow(actor); if (state.closed) throw failure(); };
  try {
    const persisted = await database.transaction('rw', [database.settings, database.quickNotes], async () => {
      await assertCatalogActor(actor); active(); assertContinuationPending(state);
      const row = await database.settings.get(key);
      if (!record(row, ['key', 'value']) || row.key !== key || !knownDraft(row.value, key, actor)) throw failure();
      await uncommitted(actor, initial.id);
      // An identical intended value can be observed after a lost local result;
      // no write is repeated and this does not claim who wrote that value.
      const sameUncertainIntent = retry && exact(retry.expected, expected) && exact(retry.desired, next) && exact(row.value, next);
      if (!exact(row.value, expected) && !sameUncertainIntent) throw new Error('原稿内容已变化，未覆盖较新版本；本次修改仍需保留并重新核对');
      // No actual correction means no session-only rebinding write, even if an
      // eventual caller mistakenly invokes save with the initial visible value.
      const unchanged = exact(continuationView(row.value, actor), next);
      if (!unchanged && !exact(row.value, next)) await database.settings.put({ key, value: next });
      await assertCatalogActor(actor); active(); assertContinuationPending(state);
      bodyFinished = true;
      return structuredClone(unchanged ? row.value : next);
    });
    state.expected = persisted;
    state.uncertain = undefined;
    await assertCatalogActor(actor); active(); assertContinuationPending(state);
    if (edit) {
      state.acknowledged = edit.sequence;
      if (state.pending?.sequence === edit.sequence) {
        releasePendingEditor(pendingScope(state), state.pending.token);
        state.pending = undefined; retainedContinuations.delete(grant);
      }
    }
    return structuredClone(next);
  } catch (error) {
    // A failed precondition must not mint replay authority. Only an operation
    // whose complete transaction body ran can have an uncertain result.
    state.uncertain = bodyFinished ? { expected, desired: next } : undefined;
    throw error;
  } finally { state.busy = false; }
}
