import Dexie from 'dexie';
import { generateLocalId, type GoalRecord } from '../db';
import { captureLegacySnapshot, type LegacySnapshot } from '../db/legacySnapshot';
import { verifiedLegacyGraph } from '../db/legacySnapshotCodec';
import { readLocalActor, assertLocalActor, type LocalActor } from './localActor';
import { sameGoalSource } from './goalSource';

// Exact version(3) schema in 9abd4d3808b6d42067839333c78c482df14c9f71.
// This is not the current account schema and does not assign a historical owner.
const SOURCE_SCHEMA: Record<string, string> = {
  schedules: 'id,date,type', expenses: 'id,date,category', todos: 'id,done,dueDate,priority',
  habits: 'id', habitCheckins: 'id,habitId,date,[habitId+date]', quickNotes: 'id,createdAt',
  diary: 'id,date', settings: 'key', coachInsights: 'id,type,dismissed,createdAt',
  coachPushes: 'id,type,read,createdAt', goals: 'id,level,domain,priority', outbox: '++seq,entity,queuedAt',
};
const FIELDS = ['id', 'title', 'description', 'level', 'domain', 'priority', 'progress', 'targetDate', 'createdAt', 'updatedAt'].sort();
const PREFIX = 'shared-goal-recovery:v1:';
const SCHEMA_ID = 'youtrace-native30-9abd4d3';
const UNPROVEN = 'unavailable-unfenced-writers' as const;
export interface SharedGoalItem { key: string; original?: GoalRecord; blockedReason?: string }
export interface SharedGoalPreview { ownerId: string; snapshotDigest: string; schemaId: string; items: SharedGoalItem[] }
export interface SharedGoalReceipt {
  format: 'youtrace-shared-goal-copy'; version: 1; ownerId: string; epoch: unknown;
  schemaId: string; snapshotDigest: string; rowDigest: string; sourceKey: string;
  intentId: string; copyId: string; original: GoalRecord; copy: GoalRecord;
  confirmedAt: number; automaticUndoProof: typeof UNPROVEN; receiptDigest: string;
}
export interface SharedGoalReview {
  receipt: SharedGoalReceipt; current: GoalRecord | null; currentEqualsCopy: boolean;
  automaticUndoAvailable: false; reason: string;
}
interface Authority { actor: LocalActor; snapshotDigest: string; items: SharedGoalItem[]; rowDigests: Map<string, string> }
const previews = new WeakMap<SharedGoalPreview, Authority>();
async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(await verifiedLegacyGraph(value)));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
// Field insertion order is not a distinct Goal revision. Only hashing uses this
// explicit order; the stored original remains an untouched structured clone.
function canonicalGoal(row: GoalRecord) {
  return FIELDS.map(field => [field, row[field as keyof GoalRecord]]);
}
function rowDigestFor(row: GoalRecord, key: string) { return digest({ key, value: canonicalGoal(row) }); }
function intentFor(actor: LocalActor, sourceKey: string, rowDigest: string) {
  return digest({ schemaId: SCHEMA_ID, ownerId: actor.owner, epoch: actor.epoch, sourceKey, rowDigest });
}
function receiptBinding(row: Omit<SharedGoalReceipt, 'receiptDigest'>) {
  return [row.format, row.version, row.ownerId, row.epoch, row.schemaId, row.snapshotDigest,
    row.rowDigest, row.sourceKey, row.intentId, row.copyId, canonicalGoal(row.original),
    canonicalGoal(row.copy), row.copy.syncScope, row.confirmedAt, row.automaticUndoProof];
}

function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function sourceGoal(value: unknown, key: unknown): GoalRecord {
  if (!plain(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(FIELDS)) throw new Error('字段缺失、额外字段或归属线索需要人工核对，未复制');
  const row = value;
  if (typeof row.id !== 'string' || !row.id || row.id.length > 256 || key !== row.id) throw new Error('原始主键与目标编号不匹配或不受支持，未复制');
  if (typeof row.title !== 'string' || !row.title.trim() || row.title.length > 100 || typeof row.description !== 'string' || row.description.length > 2000 || typeof row.domain !== 'string' || !row.domain.trim() || row.domain.length > 50) throw new Error('目标文字字段需要人工核对，未复制或裁剪');
  if (typeof row.level !== 'string' || !['short', 'medium', 'long'].includes(row.level) || typeof row.priority !== 'string' || !['low', 'medium', 'high'].includes(row.priority)) throw new Error('目标类型或优先级需要人工核对，未复制');
  if (typeof row.progress !== 'number' || !Number.isFinite(row.progress) || row.progress < 0 || row.progress > 100) throw new Error('原始进度需要人工核对，未复制或取整');
  for (const field of ['createdAt', 'updatedAt']) if (typeof row[field] !== 'number' || !Number.isSafeInteger(row[field]) || (row[field] as number) < 0) throw new Error('原始时间缺失或不受支持，未补造时间');
  if (row.targetDate !== null && row.targetDate !== '') {
    if (typeof row.targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.targetDate)) throw new Error('原始日期需要人工核对，未复制');
    const date = new Date(`${row.targetDate}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== row.targetDate) throw new Error('原始日期需要人工核对，未复制');
  }
  return structuredClone(value) as unknown as GoalRecord;
}
function path(value: string): string | string[] { return value.startsWith('[') ? value.slice(1, -1).split('+') : value; }
function checkSchema(snapshot: LegacySnapshot) {
  if (snapshot.name !== 'youtrace' || snapshot.idbVersion !== 30 || snapshot.tables.length !== Object.keys(SOURCE_SCHEMA).length) throw new Error('此版本或表结构尚未支持逐项目标恢复；请保留原库并导出备份');
  for (const [name, definition] of Object.entries(SOURCE_SCHEMA)) {
    const table = snapshot.tables.find(t => t.name === name);
    const [primary, ...indexes] = definition.split(',');
    if (!table || JSON.stringify(table.keyPath) !== JSON.stringify(path(primary.replace(/^\+\+/, ''))) || table.autoIncrement !== primary.startsWith('++') || table.indexes.length !== indexes.length || indexes.some(name => !table.indexes.some(i => i.name === name && JSON.stringify(i.keyPath) === JSON.stringify(path(name)) && !i.unique && !i.multiEntry))) throw new Error('此版本或索引结构尚未支持逐项目标恢复；原库与全部原文仍保留');
  }
}
async function ownerActor(): Promise<LocalActor> {
  const actor = await readLocalActor();
  if (!actor.owner || actor.owner !== actor.database.ownerId) throw new Error('请先登录并确认当前账号，再预览旧版目标');
  return actor;
}
/** All stores are captured at one readonly instant. Confirmation copies this
 * frozen version, not an unprovable cross-database "latest" value. */
export async function previewSharedGoals(): Promise<SharedGoalPreview> {
  const actor = await ownerActor();
  const snapshot = await captureLegacySnapshot();
  checkSchema(snapshot);
  const snapshotDigest = await digest(snapshot);
  const rowDigests = new Map<string, string>();
  const items: SharedGoalItem[] = [];
  for (const row of snapshot.tables.find(t => t.name === 'goals')!.rows) {
    try {
      const original = sourceGoal(row.value, row.key);
      rowDigests.set(original.id, await rowDigestFor(original, original.id));
      items.push({ key: original.id, original });
    } catch (error) { items.push({ key: typeof row.key === 'string' ? row.key : `不受支持的 ${typeof row.key} 主键`, blockedReason: error instanceof Error ? error.message : '原始字段需要人工核对，未复制' }); }
  }
  await assertLocalActor(actor);
  const result = { ownerId: actor.owner!, snapshotDigest, schemaId: SCHEMA_ID, items: structuredClone(items) };
  previews.set(result, { actor, snapshotDigest, items, rowDigests });
  return result;
}
function validatedReceipt(value: unknown, actor: LocalActor): SharedGoalReceipt {
  if (!plain(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['format', 'version', 'ownerId', 'epoch', 'schemaId', 'snapshotDigest', 'rowDigest', 'sourceKey', 'intentId', 'copyId', 'original', 'copy', 'confirmedAt', 'automaticUndoProof', 'receiptDigest'].sort()) || typeof value.receiptDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.receiptDigest) || value.format !== 'youtrace-shared-goal-copy' || value.version !== 1 || value.ownerId !== actor.owner || value.schemaId !== SCHEMA_ID || value.automaticUndoProof !== UNPROVEN || typeof value.copyId !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(value.copyId) || typeof value.sourceKey !== 'string' || typeof value.intentId !== 'string' || !/^[a-f0-9]{64}$/.test(value.intentId) || typeof value.snapshotDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.snapshotDigest) || typeof value.rowDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.rowDigest) || !Number.isSafeInteger(value.confirmedAt) || !plain(value.copy) || value.copy.id !== value.copyId || value.copy.syncScope !== 'local') throw new Error('恢复收据无法完整核验，原文和当前副本均保留，请导出后核对');
  sourceGoal(value.original, value.sourceKey);
  return value as unknown as SharedGoalReceipt;
}
async function checkReceipt(value: unknown, actor: LocalActor, key: string): Promise<SharedGoalReceipt> {
  const receipt = validatedReceipt(value, actor);
  if (key !== `${PREFIX}${receipt.intentId}` || !await sameGoalSource(receipt.epoch, actor.epoch) || !await sameGoalSource(receipt.copy, { ...receipt.original, id: receipt.copyId, syncScope: 'local' })) throw new Error('恢复收据与当前资料版本不一致，保留现有记录');
  const expected = await Dexie.waitFor((async () => {
    const rowDigest = await rowDigestFor(receipt.original, receipt.sourceKey);
    return { rowDigest, intentId: await intentFor(actor, receipt.sourceKey, rowDigest), receiptDigest: await digest(receiptBinding(receipt)) };
  })());
  if (expected.rowDigest !== receipt.rowDigest || expected.intentId !== receipt.intentId || expected.receiptDigest !== receipt.receiptDigest) throw new Error('恢复收据摘要链不一致，未继续复制或确认原文可信；请保留收据并导出核对');
  return receipt;
}
/** No timestamp/hash-based undo. The published dynamic opener cannot be fenced
 * by a schema bump. A receipt is provenance, not a complete write history. */
export async function confirmSharedGoal(preview: SharedGoalPreview, sourceKey: string, confirmation: { ownerId: string; belongsToMe: boolean }): Promise<SharedGoalReceipt> {
  const authority = previews.get(preview);
  if (!authority || confirmation.belongsToMe !== true || confirmation.ownerId !== authority.actor.owner) throw new Error('请重新预览并逐项明确确认归属');
  const { actor } = authority;
  await assertLocalActor(actor);
  const item = authority.items.find(i => i.key === sourceKey && i.original);
  if (!item?.original) throw new Error('这份目标尚不支持安全复制，原文仍保留');
  const original = structuredClone(item.original), rowDigest = authority.rowDigests.get(sourceKey)!;
  // Bind the complete snapshot, but unrelated source edits must not create a
  // second import intent for an already confirmed identical row revision.
  const intentId = await intentFor(actor, sourceKey, rowDigest);
  await assertLocalActor(actor);
  const key = `${PREFIX}${intentId}`, copyId = generateLocalId();
  const copy: GoalRecord = { ...original, id: copyId, syncScope: 'local' };
  const body: Omit<SharedGoalReceipt, 'receiptDigest'> = { format: 'youtrace-shared-goal-copy', version: 1, ownerId: actor.owner!, epoch: actor.epoch, schemaId: SCHEMA_ID, snapshotDigest: authority.snapshotDigest, rowDigest, sourceKey, intentId, copyId, original, copy, confirmedAt: Date.now(), automaticUndoProof: UNPROVEN };
  const receipt: SharedGoalReceipt = { ...body, receiptDigest: await digest(receiptBinding(body)) };
  const database = actor.database;
  let result = receipt;
  await database.transaction('rw', [database.goalRecords, database.settings], async () => {
    await assertLocalActor(actor);
    const prior = await database.settings.get(key);
    if (prior) {
      result = await checkReceipt(prior.value, actor, key);
      if (result.rowDigest !== rowDigest || !await sameGoalSource(result.original, original)) throw new Error('恢复收据与原文不一致，未覆盖现有资料');
      // Retry returns the original receipt even after editing/deletion; never
      // recreate or overwrite this ID, or silently pick a competing row.
    } else {
      await database.goalRecords.add(copy);
      await database.settings.add({ key, value: receipt });
    }
    await assertLocalActor(actor);
  });
  await assertLocalActor(actor);
  return structuredClone(result);
}
export async function listSharedGoalReviews(): Promise<SharedGoalReview[]> {
  const actor = await ownerActor(), database = actor.database;
  return database.transaction('r', [database.settings, database.goalRecords], async () => {
    await assertLocalActor(actor);
    const rows = await database.settings.where('key').startsWith(PREFIX).toArray();
    const result: SharedGoalReview[] = [];
    for (const row of rows) {
      const receipt = await checkReceipt(row.value, actor, row.key);
      const current = await database.goalRecords.get(receipt.copyId) ?? null;
      result.push({ receipt: structuredClone(receipt), current: structuredClone(current), currentEqualsCopy: current !== null && await sameGoalSource(current, receipt.copy), automaticUndoAvailable: false, reason: current ? '已有后续变化或无法确认，保留记录。内容相同也不能证明从未被修改；本次不提供自动撤销删除。' : '此次副本已不存在，收据仍保留；重试不会重新创建。' });
    }
    await assertLocalActor(actor);
    return result;
  });
}
// No recovery delete function exists. Ordinary user deletion is a separate act.
export const SHARED_GOAL_AUTOMATIC_UNDO = false;
