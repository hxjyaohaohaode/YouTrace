import Dexie from 'dexie';
import type { LocalActor } from './localActor';
import { isCaptureDate } from './parser';
import { captureFingerprint, type ApplyResult, type CaptureDraft, type CaptureReceipt } from './quickNoteIntegration';
import { isKnownCaptureCommitDraft, type CaptureCommitSnapshot } from './captureDraftCatalog';
import { captureInputConsumptionKey, captureInputConsumptionHeadKey } from './captureInputProvenance';

const FORMAT = 'youtrace-capture-continuation-proof-v1', INDEX = 'youtrace-capture-input-consumption-v1', HEAD = 'youtrace-capture-input-consumption-head-v1';
export const CAPTURE_COMMIT_INDEX_LIMIT = 32;
export const captureContinuationProofKey = (id: string) => `capture-continuation-proof:${id}`;
const fail = () => new Error('保存关联证明不完整或已变化，原文与现有记录仍保留；未再次提交');
type Obj = Record<string, unknown>;
type Snapshot = { present: false } | { present: true; row: { key: string; value: unknown } };
interface Body { ownerId: string; epoch: unknown; id: string; operationId: string; inputKey: string; expected: CaptureDraft; submitted: CaptureDraft; retainedInput: Snapshot; retainedContext: Snapshot; result: ApplyResult }
interface Proof { format: typeof FORMAT; body: Body; digest: string }
interface Entry { id: string; operationId: string; digest: string }
interface Consumption { format: typeof INDEX; ownerId: string; epoch: unknown; inputKey: string; entries: Entry[] }
interface Budget { deadline: number; bytes: number }
export interface CaptureCommitStart { identity: CaptureCommitSnapshot; index: Consumption; retainedInput: Snapshot; retainedContext: Snapshot; replay: ApplyResult | null; budget: Budget }
const validId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
function record(v: unknown, allowed: string[], required = allowed): v is Obj {
  if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return false;
  const d = Object.getOwnPropertyDescriptors(v);
  return Reflect.ownKeys(v).every(k => typeof k === 'string' && allowed.includes(k) && d[k].enumerable && 'value' in d[k]) && required.every(k => Object.hasOwn(d, k));
}
/** Bounded data-only canonicalization. Hashes detect inconsistent local damage,
 * not authenticated resistance to an attacker rewriting every row and hash. */
function typed(v: unknown, state = { nodes: 0 }, depth = 0): unknown {
  if (++state.nodes > 20000 || depth > 12) throw fail();
  if (v === undefined) return ['undefined']; if (v === null) return ['null'];
  if (typeof v === 'string') { if (v.length > 200000) throw fail(); return ['string', v]; }
  if (typeof v === 'boolean') return ['boolean', v];
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw fail(); return ['number', Object.is(v, -0) ? '-0' : String(v)]; }
  if (!v || typeof v !== 'object') throw fail();
  const d = Object.getOwnPropertyDescriptors(v);
  if (Array.isArray(v)) {
    if (v.length > 1000 || Reflect.ownKeys(v).length !== v.length + 1) throw fail();
    for (let i = 0; i < v.length; i++) if (!d[i]?.enumerable || !('value' in d[i])) throw fail();
    return ['array', Array.from({ length: v.length }, (_, i) => typed(d[i].value, state, depth + 1))];
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Reflect.ownKeys(v).some(k => typeof k !== 'string' || !d[k].enumerable || !('value' in d[k]))) throw fail();
  return ['object', Object.keys(d).sort().map(k => [k, typed(d[k].value, state, depth + 1)])];
}
function wire(v: unknown): string { const text = JSON.stringify(typed(v)); if (text.length > 524288) throw fail(); return text; }
const exact = (a: unknown, b: unknown) => wire(a) === wire(b);
async function digest(v: unknown, budget: Budget): Promise<string> {
  const bytes = new TextEncoder().encode(wire(v)); budget.bytes += bytes.byteLength;
  const remaining = budget.deadline - performance.now();
  if (remaining <= 0 || budget.bytes > 4 * 1024 * 1024) throw fail();
  const hash = await Dexie.waitFor(crypto.subtle.digest('SHA-256', bytes), Math.max(1, Math.floor(remaining)));
  if (performance.now() > budget.deadline) throw fail();
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
const context = (v: unknown) => record(v, ['capturedAt', 'timeZone', 'date']) && (v.capturedAt === null || Number.isSafeInteger(v.capturedAt) && (v.capturedAt as number) >= 0) && (v.timeZone === null || v.timeZone === 'Asia/Shanghai') && (v.date === null || isCaptureDate(v.date));
function validSnapshot(v: unknown, key: string, isContext: boolean): v is Snapshot {
  return record(v, ['present']) && v.present === false || record(v, ['present', 'row']) && v.present === true && record(v.row, ['key', 'value']) && v.row.key === key && (isContext ? context(v.row.value) : typeof v.row.value === 'string' && v.row.value.length <= 5000);
}
function result(v: unknown): v is ApplyResult {
  if (!record(v, ['expenseCount', 'habitCount', 'diaryCreated', 'diaryUpdated', 'todoCount', 'records', 'committedAt', 'captureContext']) || !context(v.captureContext) || !Number.isSafeInteger(v.committedAt) || (v.committedAt as number) < 0 || typeof v.diaryCreated !== 'boolean' || typeof v.diaryUpdated !== 'boolean') return false;
  if (![v.expenseCount, v.habitCount, v.todoCount].every(n => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= 100) || !Array.isArray(v.records) || v.records.length > 302) return false;
  return v.records.every(r => record(r, ['entity', 'id', 'label', 'date', 'parentId', 'effect'], ['entity', 'id', 'label', 'effect']) && ['quickNotes', 'expenses', 'todos', 'habitCheckins', 'diaries'].includes(r.entity as string) && validId(r.id) && typeof r.label === 'string' && r.label.length <= 512 && ['created', 'updated', 'already-recorded'].includes(r.effect as string) && (r.date === undefined || isCaptureDate(r.date)) && (r.parentId === undefined || validId(r.parentId)));
}
function proof(v: unknown, id: string, actor: LocalActor): v is Proof {
  wire(v); // Reject live getters, sparse/extended arrays and excessive depth before schema traversal.
  if (!record(v, ['format', 'body', 'digest']) || v.format !== FORMAT || typeof v.digest !== 'string' || !/^[0-9a-f]{64}$/.test(v.digest)) return false;
  const b = v.body;
  if (!record(b, ['ownerId', 'epoch', 'id', 'operationId', 'inputKey', 'expected', 'submitted', 'retainedInput', 'retainedContext', 'result']) || b.ownerId !== actor.owner || !actor.owner || b.epoch !== actor.epoch || b.id !== id || !validId(b.id) || !validId(b.operationId) || typeof b.inputKey !== 'string' || !b.inputKey.startsWith('capture-input:') || b.inputKey.length > 270) return false;
  if (!isKnownCaptureCommitDraft(b.expected, actor) || !isKnownCaptureCommitDraft(b.submitted, actor) || b.expected.id !== id || b.submitted.id !== id || b.expected.inputKey !== b.inputKey || b.submitted.inputKey !== b.inputKey || !exact({ ...b.expected, sessionRevision: b.submitted.sessionRevision, sessionActive: b.submitted.sessionActive }, b.submitted)) return false;
  return validSnapshot(b.retainedInput, b.inputKey, false) && validSnapshot(b.retainedContext, `${b.inputKey}:context`, true) && result(b.result);
}
function receipt(p: Proof): CaptureReceipt { const b = p.body; return { fingerprint: captureFingerprint(b.submitted), result: b.result, input: b.submitted.input, ownerId: b.ownerId, continuationProtocol: 'youtrace-capture-continuation-receipt-v1', continuationOperationId: b.operationId, continuationProofDigest: p.digest }; }
async function readProof(actor: LocalActor, id: string, budget: Budget): Promise<Proof> {
  const database = actor.database, key = captureContinuationProofKey(id), row = await database.settings.get(key);
  if (!record(row, ['key', 'value']) || row.key !== key || !proof(row.value, id, actor)) throw fail();
  const p = row.value;
  if (await digest(p.body, budget) !== p.digest) throw fail();
  const [source, applied] = await Promise.all([database.settings.get(`capture-source:${id}`), database.settings.get(`capture-applied:${id}`)]);
  if (!exact(source, { key: `capture-source:${id}`, value: p.body.submitted }) || !exact(applied, { key: `capture-applied:${id}`, value: receipt(p) })) throw fail();
  return p;
}
async function readIndex(actor: LocalActor, key: string, budget: Budget): Promise<{ value: Consumption; proofs: Map<string, Proof> }> {
  const [row, headRow] = await Promise.all([actor.database.settings.get(captureInputConsumptionKey(key)), actor.database.settings.get(captureInputConsumptionHeadKey(key))]);
  if (row === undefined && headRow === undefined) return { value: { format: INDEX, ownerId: actor.owner!, epoch: actor.epoch, inputKey: key, entries: [] }, proofs: new Map() };
  if (!record(row, ['key', 'value']) || row.key !== captureInputConsumptionKey(key)) throw fail();
  const v = row.value;
  if (!record(v, ['format', 'ownerId', 'epoch', 'inputKey', 'entries']) || v.format !== INDEX || v.ownerId !== actor.owner || v.epoch !== actor.epoch || v.inputKey !== key || !Array.isArray(v.entries) || v.entries.length === 0 || v.entries.length > CAPTURE_COMMIT_INDEX_LIMIT) throw fail();
  if (!record(headRow, ['key', 'value']) || headRow.key !== captureInputConsumptionHeadKey(key)) throw fail();
  const head = headRow.value;
  if (!record(head, ['format', 'ownerId', 'epoch', 'inputKey', 'count', 'indexDigest']) || head.format !== HEAD || head.ownerId !== actor.owner || head.epoch !== actor.epoch || head.inputKey !== key || head.count !== v.entries.length || typeof head.indexDigest !== 'string' || !/^[0-9a-f]{64}$/.test(head.indexDigest) || await digest(v, budget) !== head.indexDigest) throw fail();
  wire(v); const ids = new Set<string>(), operations = new Set<string>(), proofs = new Map<string, Proof>();
  for (const e of v.entries) {
    if (!record(e, ['id', 'operationId', 'digest']) || !validId(e.id) || !validId(e.operationId) || typeof e.digest !== 'string' || !/^[0-9a-f]{64}$/.test(e.digest) || ids.has(e.id) || operations.has(e.operationId)) throw fail();
    ids.add(e.id); operations.add(e.operationId);
    const p = await readProof(actor, e.id, budget);
    if (p.digest !== e.digest || p.body.operationId !== e.operationId || p.body.inputKey !== key) throw fail();
    proofs.set(e.id, p);
  }
  return { value: structuredClone(v) as unknown as Consumption, proofs };
}
/** Called inside the SAME full RW transaction as entity/outbox/source writes. */
export async function checkCaptureCommitStart(identity: CaptureCommitSnapshot): Promise<CaptureCommitStart> {
  const { actor, expected, submitted } = identity, database = actor.database, key = submitted.inputKey!;
  const budget = { deadline: performance.now() + 5000, bytes: 0 };
  const indexed = await readIndex(actor, key, budget);
  const [savedProof, source, applied, note, review, input, contextRow] = await Promise.all([database.settings.get(captureContinuationProofKey(submitted.id)), database.settings.get(`capture-source:${submitted.id}`), database.settings.get(`capture-applied:${submitted.id}`), database.quickNotes.get(submitted.id), database.settings.get(`capture-review:${submitted.id}`), database.settings.get(key), database.settings.get(`${key}:context`)]);
  if (savedProof !== undefined || source !== undefined || applied !== undefined) {
    const p = indexed.proofs.get(submitted.id);
    if (!p || p.body.operationId !== identity.operationId || !exact(p.body.expected, expected) || !exact(p.body.submitted, submitted) || review !== undefined) throw fail();
    return { identity, index: indexed.value, retainedInput: p.body.retainedInput, retainedContext: p.body.retainedContext, replay: structuredClone(p.body.result), budget };
  }
  if (identity.committed || note !== undefined || indexed.proofs.has(submitted.id) || indexed.value.entries.length >= CAPTURE_COMMIT_INDEX_LIMIT || !exact(review, { key: `capture-review:${submitted.id}`, value: expected })) throw fail();
  const retainedInput: Snapshot = input === undefined ? { present: false } : { present: true, row: structuredClone(input) };
  const retainedContext: Snapshot = contextRow === undefined ? { present: false } : { present: true, row: structuredClone(contextRow) };
  if (!validSnapshot(retainedInput, key, false) || !validSnapshot(retainedContext, `${key}:context`, true)) throw fail();
  return { identity, index: indexed.value, retainedInput, retainedContext, replay: null, budget };
}
export async function writeCaptureCommitProof(start: CaptureCommitStart, applied: ApplyResult): Promise<void> {
  const { identity, budget } = start, { actor, expected, submitted, operationId } = identity;
  const body: Body = { ownerId: actor.owner!, epoch: actor.epoch, id: submitted.id, operationId, inputKey: submitted.inputKey!, expected, submitted, retainedInput: start.retainedInput, retainedContext: start.retainedContext, result: structuredClone(applied) };
  const value: Proof = { format: FORMAT, body, digest: '0'.repeat(64) };
  if (!proof(value, submitted.id, actor)) throw fail();
  value.digest = await digest(body, budget);
  await actor.database.settings.add({ key: captureContinuationProofKey(submitted.id), value });
  await actor.database.settings.add({ key: `capture-applied:${submitted.id}`, value: receipt(value) });
  const index: Consumption = { ...start.index, entries: [...start.index.entries, { id: submitted.id, operationId, digest: value.digest }] };
  const head = { format: HEAD, ownerId: actor.owner!, epoch: actor.epoch, inputKey: submitted.inputKey!, count: index.entries.length, indexDigest: await digest(index, budget) };
  await actor.database.settings.put({ key: captureInputConsumptionKey(submitted.inputKey!), value: index });
  await actor.database.settings.put({ key: captureInputConsumptionHeadKey(submitted.inputKey!), value: head });
}

/** Presence, not truthiness: malformed/undefined protocol markers must never
 * fall back to an ordinary receipt. The caller also checks proof ROW presence. */
export function hasCaptureContinuationMarker(value: unknown): boolean {
  return value !== null && typeof value === 'object' && ['continuationProtocol', 'continuationOperationId', 'continuationProofDigest'].some(key => Object.hasOwn(value, key));
}
/** Internal reader: caller owns a consistent settings RO/RW transaction and
 * fences the captured actor/strict epoch before and after this bounded read. */
export async function readCaptureContinuationReceipt(actor: LocalActor, id: string): Promise<CaptureReceipt> {
  if (!validId(id)) throw fail();
  const budget = { deadline: performance.now() + 5000, bytes: 0 };
  const own = await readProof(actor, id, budget);
  const indexed = await readIndex(actor, own.body.inputKey, budget), linked = indexed.proofs.get(id);
  if (!linked || !exact(own, linked)) throw fail();
  return structuredClone(receipt(own));
}
