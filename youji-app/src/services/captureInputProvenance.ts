import { LOCAL_DATA_EPOCH_KEY, type YoujiDatabase } from '../db';
import { assertLocalActorNow, captureLocalActor, type LocalActor } from './localActor';
import { isCaptureDate } from './parser';

/** Local provenance is evidence of a copy, never authority to select a receipt. */
export const captureInputOriginKey = (key: string) => `capture-input-origin:${key}`;
export const captureInputConsumptionKey = (key: string) => `capture-input-consumption:${key}`;
export const CAPTURE_INPUT_ORIGIN_LIMIT = 32;
export type CaptureInputActor = Omit<LocalActor, 'epoch'> & { epoch: string | undefined };
type Row = { key: string; value: unknown };
type Snapshot = { present: false } | { present: true; row: Row };
interface Origin {
  format: 'youtrace-capture-input-origin-v1'; key: string; ownerId: string | null; epoch: string | undefined;
  sourceKey: string; parent: 'root' | 'input' | 'unknown'; sourceMetadataPresent: boolean; sourceConsumptionPresent: boolean; input: Snapshot; context: Snapshot;
}
const fail = () => new Error('这份原文的来源或保存关联尚不能确认，原文仍保留；请先核对已有确认稿，不会自动新建');
function record(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(descriptors, key) && descriptors[key].enumerable && 'value' in descriptors[key]);
}
const inputKey = (key: unknown): key is string => typeof key === 'string' && key.startsWith('capture-input:') && key.length > 14 && key.length <= 270;
const snapshot = (row: Row | undefined): Snapshot => row === undefined ? { present: false } : { present: true, row: structuredClone(row) };
function validSnapshot(value: unknown, key: string, context: boolean): value is Snapshot {
  if (record(value, ['present']) && value.present === false) return true;
  if (!record(value, ['present', 'row']) || value.present !== true || !record(value.row, ['key', 'value']) || value.row.key !== key) return false;
  const payload = value.row.value;
  if (!context) return typeof payload === 'string';
  return record(payload, ['capturedAt', 'timeZone', 'date']) && (payload.capturedAt === null || Number.isSafeInteger(payload.capturedAt) && (payload.capturedAt as number) >= 0)
    && (payload.timeZone === null || payload.timeZone === 'Asia/Shanghai') && (payload.date === null || isCaptureDate(payload.date));
}
function validOrigin(value: unknown, key: string, actor: CaptureInputActor): value is Origin {
  if (!record(value, ['format', 'key', 'ownerId', 'epoch', 'sourceKey', 'parent', 'sourceMetadataPresent', 'sourceConsumptionPresent', 'input', 'context']) || value.format !== 'youtrace-capture-input-origin-v1' || value.key !== key || !inputKey(key) || value.ownerId !== actor.owner || value.epoch !== actor.epoch) return false;
  if (typeof value.sourceMetadataPresent !== 'boolean' || typeof value.sourceConsumptionPresent !== 'boolean' || typeof value.sourceKey !== 'string' || !validSnapshot(value.input, value.sourceKey, false) || !validSnapshot(value.context, `${value.sourceKey}:context`, true)) return false;
  if (value.parent === 'root') return (value.sourceKey === 'quicknote_draft' || inputKey(value.sourceKey)) && !value.input.present && !value.context.present && !value.sourceMetadataPresent && !value.sourceConsumptionPresent;
  return (value.parent === 'input' && value.sourceMetadataPresent || value.parent === 'unknown') && (value.sourceKey === 'quicknote_draft' || inputKey(value.sourceKey));
}
async function strictEpoch(target: YoujiDatabase): Promise<string | undefined> {
  const row = await target.settings.get(LOCAL_DATA_EPOCH_KEY);
  if (row === undefined) return undefined;
  if (!record(row, ['key', 'value']) || row.key !== LOCAL_DATA_EPOCH_KEY || typeof row.value !== 'string' || !row.value || row.value.length > 256) throw fail();
  return row.value;
}
export async function readCaptureInputActor(): Promise<CaptureInputActor> {
  const actor = captureLocalActor(), epoch = await strictEpoch(actor.database);
  assertLocalActorNow(actor); return { ...actor, epoch };
}
export async function assertCaptureInputActor(actor: CaptureInputActor): Promise<void> {
  assertLocalActorNow(actor); const epoch = await strictEpoch(actor.database); assertLocalActorNow(actor);
  if (epoch !== actor.epoch) throw fail();
}
/** Caller holds the SAME settings transaction as source reads and child writes.
 * Unknown rows remain exact evidence; they are not silently promoted to root. */
export async function recordCaptureInputOrigin(target: YoujiDatabase, key: string, actor: CaptureInputActor, sourceKey: string, input: Row | undefined, context: Row | undefined, prior: Row | undefined, consumed: Row | undefined): Promise<void> {
  if (target !== actor.database || !inputKey(key)) throw fail();
  const parent = input === undefined && context === undefined && prior === undefined && consumed === undefined ? 'root'
    : inputKey(sourceKey) && record(prior, ['key', 'value']) && prior.key === captureInputOriginKey(sourceKey) && validOrigin(prior.value, sourceKey, actor) ? 'input' : 'unknown';
  const value: Origin = { format: 'youtrace-capture-input-origin-v1', key, ownerId: actor.owner, epoch: actor.epoch, sourceKey, parent, sourceMetadataPresent: prior !== undefined, sourceConsumptionPresent: consumed !== undefined, input: snapshot(input), context: snapshot(context) };
  // add, never overwrite an existing origin identity, even on an ID collision.
  await target.settings.add({ key: captureInputOriginKey(key), value });
}
/** Must run in the transaction that FIRST persists the new confirmation ID.
 * An index of any shape blocks; this first stage does not authorize or return a
 * receipt from it. Full business proof validation remains a separate boundary. */
export async function assertNewCaptureInput(actor: CaptureInputActor, key: string): Promise<void> {
  if (!inputKey(key)) throw fail();
  await assertCaptureInputActor(actor);
  const visited = new Set<string>(); let current = key;
  for (let depth = 0; depth < CAPTURE_INPUT_ORIGIN_LIMIT; depth++) {
    if (visited.has(current)) throw fail(); visited.add(current);
    const [row, consumed] = await Promise.all([actor.database.settings.get(captureInputOriginKey(current)), actor.database.settings.get(captureInputConsumptionKey(current))]);
    assertLocalActorNow(actor);
    if (consumed !== undefined || !record(row, ['key', 'value']) || row.key !== captureInputOriginKey(current) || !validOrigin(row.value, current, actor)) throw fail();
    // A copy that already observed a consumption marker never forgets it merely
    // because the mutable source marker is later missing. This is refusal evidence.
    if (row.value.sourceConsumptionPresent) throw fail();
    if (row.value.parent === 'root') { await assertCaptureInputActor(actor); return; }
    if (row.value.parent !== 'input' || !inputKey(row.value.sourceKey)) throw fail();
    current = row.value.sourceKey;
  }
  throw fail();
}
