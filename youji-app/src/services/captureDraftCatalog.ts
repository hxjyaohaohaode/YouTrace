import { LOCAL_DATA_EPOCH_KEY } from '../db';
import { assertLocalActorNow, captureLocalActor, type LocalActor } from './localActor';
import { isCaptureDate, MOOD_LEVELS } from './parser';
import type { CaptureDraft } from './quickNoteIntegration';

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
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key) && 'value' in descriptors[key])
    && required.every(key => Object.hasOwn(value, key));
}
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 256;
const date = (value: unknown) => value === null || isCaptureDate(value);
const optional = (row: RecordValue, key: string, check: (value: unknown) => boolean) => row[key] === undefined || check(row[key]);
const boolean = (value: unknown) => typeof value === 'boolean';
function rows(value: unknown, check: (row: unknown) => boolean): boolean {
  if (!Array.isArray(value) || value.length > 100 || Object.keys(value).length !== value.length) return false;
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
