import { db, LOCAL_DATA_EPOCH_KEY, type YoujiDatabase } from '../db';
import { SESSION_REVISION_KEY, SIGNED_OUT_KEY, getVerifiedSessionOwner } from './apiClient';
import { currentReceiptSyncStatus } from './captureReceiptView';
import { isSequence } from './syncIdentity';
import { addDays, formatBusinessDate, getToday, parseBusinessDate } from '../utils/date';
import type { ExpenseItem } from '../stores/expenseStore';
import type { CoachInsightRecord } from '../stores/coachStore';

export type ObservationRule = 'spending-comparison' | 'record-rhythm';
export interface ObservationPeriod { start: string; end: string; previousStart: string; previousEnd: string }
export interface ObservationExpense { id: string; name: string; amount: number; category: string; date: string; income: boolean; version: string | null; syncStatus: string }
export interface ObservationChoice { revision: number; hidden: boolean }
interface ObservationActor { ownerId: string; epoch: string; sessionRevision: string | null }
export interface RecordObservations extends ObservationActor {
  checkedAt: number; period: ObservationPeriod; rows: ObservationExpense[];
  current: ObservationExpense[]; previous: ObservationExpense[]; income: ObservationExpense[];
  currentFen: number; previousFen: number; percent: number | null; activeDates: string[];
  choices: Record<ObservationRule, ObservationChoice>; signature: string;
}
export function observationPeriod(today = getToday()): ObservationPeriod {
  parseBusinessDate(today);
  return { start: addDays(today, -6), end: today, previousStart: addDays(today, -13), previousEnd: addDays(today, -7) };
}
export function observationChoiceKey(rule: ObservationRule, period: ObservationPeriod): string {
  return `observation-choice:v1:${rule}:${period.start}:${period.end}`;
}
export function managedObservationRule(title: string): ObservationRule | null {
  return title === '按适合你的节奏记录' ? 'record-rhythm' : /^近7天消费比前7天(?:上升|下降)/.test(title) ? 'spending-comparison' : null;
}
function validDate(value: unknown): value is string { try { if (typeof value !== 'string') return false; parseBusinessDate(value); return true; } catch { return false; } }
function timestampDate(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value); return Number.isFinite(date.getTime()) ? formatBusinessDate(date) : null;
}
export function expenseObservationRows(expenses: ExpenseItem[], period: ObservationPeriod): Array<Omit<ObservationExpense, 'syncStatus' | 'version'>> {
  const rows = [];
  for (const expense of expenses) {
    if (!validDate(expense.date)) throw new Error('有收支记录的日期需要核对，当前观察暂不计算。请先在花销页检查或导出记录。');
    if (expense.date < period.previousStart || expense.date > period.end) continue;
    if (typeof expense.id !== 'string' || typeof expense.name !== 'string' || typeof expense.category !== 'string' || !Number.isSafeInteger(expense.amount) || expense.amount <= 0 || expense.amount > 100_000_000_00 || expense.isIncome !== undefined && typeof expense.isIncome !== 'boolean') throw new Error('这两个期间有收支记录的字段需要核对，当前观察暂不计算。请先在花销页检查或导出记录。');
    rows.push({ id: expense.id, name: expense.name, date: expense.date, amount: expense.amount, category: expense.category, income: expense.isIncome === true || expense.category === 'income' });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
function sum(rows: Array<{ amount: number }>): number {
  let total = 0;
  for (const row of rows) { total += row.amount; if (!Number.isSafeInteger(total)) throw new Error('记录金额合计超出安全计算范围，暂不显示观察。'); }
  return total;
}
function inheritedHidden(history: CoachInsightRecord[], rule: ObservationRule, period: ObservationPeriod): boolean {
  // Exact known legacy rule names, within the same generation day/window only.
  // No inference from arbitrary prose, account names, or a source's updatedAt.
  return history.some(row => row.origin === 'local' && row.dismissed && timestampDate(row.createdAt) === period.end && (rule === 'record-rhythm' ? row.title === '按适合你的节奏记录' : /^近7天消费比前7天(?:上升|下降)/.test(row.title)));
}
function choice(value: unknown, inherited: boolean): ObservationChoice {
  if (value === undefined) return { revision: 0, hidden: inherited };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('本机观察显示偏好需要核对，原设置仍保留。');
  const row = value as Record<string, unknown>;
  if (row.version !== 1 || !Number.isSafeInteger(row.revision) || (row.revision as number) < 1 || typeof row.hidden !== 'boolean' || Object.keys(row).some(key => !['version', 'revision', 'hidden'].includes(key))) throw new Error('本机观察显示偏好需要核对，原设置仍保留。');
  return { revision: row.revision as number, hidden: row.hidden };
}
function sessionRevision() { return typeof localStorage === 'undefined' ? null : localStorage.getItem(SESSION_REVISION_KEY); }
export function observationActorCurrent(target: YoujiDatabase, actor: ObservationActor): boolean {
  return target === db && target.ownerId === actor.ownerId && getVerifiedSessionOwner() === actor.ownerId && sessionRevision() === actor.sessionRevision && (typeof localStorage === 'undefined' || localStorage.getItem(SIGNED_OUT_KEY) !== 'true');
}
async function actor(target: YoujiDatabase): Promise<ObservationActor> {
  const epoch = (await target.settings.get(LOCAL_DATA_EPOCH_KEY))?.value ?? 'initial';
  if (!target.ownerId || typeof epoch !== 'string') throw new Error('请先核对当前账号，再读取观察。');
  const value = { ownerId: target.ownerId, epoch, sessionRevision: sessionRevision() };
  if (!observationActorCurrent(target, value)) throw new Error('账号状态已变化，请重新核对登录。');
  return value;
}
async function assertActor(target: YoujiDatabase, expected: ObservationActor) {
  const epoch = (await target.settings.get(LOCAL_DATA_EPOCH_KEY))?.value ?? 'initial';
  if (!observationActorCurrent(target, expected) || epoch !== expected.epoch) throw new Error('账号或本机资料已变化，本次操作没有保存，请重新读取。');
}
export async function readRecordObservations(target: YoujiDatabase = db, today = getToday()): Promise<RecordObservations> {
  const period = observationPeriod(today);
  return target.transaction('r', [target.expenses, target.habitCheckins, target.diary, target.quickNotes, target.settings, target.outbox, target.coachInsights], async () => {
    const owner = await actor(target);
    const [expenses, checkins, diaries, notes, settings, outbox, history] = await Promise.all([
      target.expenses.toArray(), target.habitCheckins.where('date').between(period.start, period.end, true, true).toArray(),
      target.diary.where('date').between(period.start, period.end, true, true).toArray(), target.quickNotes.toArray(),
      target.settings.toArray(), target.outbox.toArray(), target.coachInsights.toArray(),
    ]);
    const values = new Map(settings.map(row => [row.key, row.value]));
    const rows = expenseObservationRows(expenses, period).map(row => {
      const key = `expenses:${row.id}`, raw = values.get(`sync-version:${key}`), version = isSequence(raw) && raw !== '0' ? raw : null;
      return { ...row, version, syncStatus: currentReceiptSyncStatus({ entity: 'expenses', id: row.id, label: row.name, effect: 'updated' }, true, outbox, values.has(`sync-conflict:${key}`), raw) };
    });
    const current = rows.filter(row => !row.income && row.date >= period.start), previous = rows.filter(row => !row.income && row.date <= period.previousEnd), income = rows.filter(row => row.income);
    const currentFen = sum(current), previousFen = sum(previous), dates = new Set<string>();
    for (const row of rows) if (row.date >= period.start) dates.add(row.date);
    for (const row of [...checkins, ...diaries]) if (validDate(row.date)) dates.add(row.date);
    for (const row of notes) { const date = timestampDate(row.createdAt); if (date && date >= period.start && date <= period.end) dates.add(date); }
    const choices = Object.fromEntries((['spending-comparison', 'record-rhythm'] as const).map(rule => [rule, choice(values.get(observationChoiceKey(rule, period)), inheritedHidden(history, rule, period))])) as Record<ObservationRule, ObservationChoice>;
    await assertActor(target, owner);
    return { ...owner, checkedAt: Date.now(), period, rows, current, previous, income, currentFen, previousFen, percent: previousFen ? ((currentFen - previousFen) / previousFen) * 100 : null, activeDates: [...dates].sort(), choices, signature: JSON.stringify({ period, rows, choices, epoch: owner.epoch, activeDates: [...dates].sort() }) };
  });
}
/** This is explicitly a device-local display choice, not an account-wide policy. */
export async function setObservationHidden(snapshot: RecordObservations, rule: ObservationRule, hidden: boolean): Promise<void> {
  if (!['spending-comparison', 'record-rhythm'].includes(rule) || typeof hidden !== 'boolean') throw new Error('观察显示选择无效。');
  if (typeof snapshot.period.end !== 'string') throw new Error('观察期间需要核对。');
  const canonicalPeriod = observationPeriod(snapshot.period.end);
  if ((Object.keys(canonicalPeriod) as Array<keyof ObservationPeriod>).some(key => canonicalPeriod[key] !== snapshot.period[key])) throw new Error('观察期间已变化，请重新读取。');
  const target = db, key = observationChoiceKey(rule, snapshot.period), expected = snapshot.choices[rule];
  await target.transaction('rw', target.settings, target.coachInsights, async () => {
    await assertActor(target, snapshot);
    const current = choice((await target.settings.get(key))?.value, inheritedHidden(await target.coachInsights.toArray(), rule, snapshot.period));
    if (current.revision !== expected.revision || current.hidden !== expected.hidden) throw new Error('这条显示偏好刚有更新，请重新读取后选择。');
    if (!Number.isSafeInteger(current.revision + 1)) throw new Error('显示偏好版本需要核对，暂未修改。');
    await target.settings.put({ key, value: { version: 1, revision: current.revision + 1, hidden } });
    await assertActor(target, snapshot);
  });
}

/** Local-only callback: eligibility and insight/reminder write share one commit.
 * This may nest inside the reminder-budget transaction with these same tables.
 * Do not perform network calls or business-record mutations in the callback. */
export async function whileObservationVisible<T>(snapshot: RecordObservations, rule: ObservationRule, write: () => Promise<T>): Promise<T | null> {
  const target = db;
  if (!['spending-comparison', 'record-rhythm'].includes(rule) || typeof snapshot.period.end !== 'string') throw new Error('观察范围需要核对。');
  const canonical = observationPeriod(snapshot.period.end);
  if ((Object.keys(canonical) as Array<keyof ObservationPeriod>).some(key => canonical[key] !== snapshot.period[key])) throw new Error('观察期间已变化，请重新读取。');
  if (snapshot.period.end !== getToday()) return null; // A delayed Home must not create yesterday's prompt today.
  return target.transaction('rw', target.settings, target.coachInsights, target.coachPushes, async () => {
    await assertActor(target, snapshot);
    const current = choice((await target.settings.get(observationChoiceKey(rule, snapshot.period)))?.value, inheritedHidden(await target.coachInsights.toArray(), rule, snapshot.period));
    if (current.hidden) return null;
    const result = await write();
    await assertActor(target, snapshot);
    return result;
  });
}

/** Final managed-delivery guard, called after every write in the outer budget transaction. */
export async function assertObservationDeliveryCurrent(snapshot: RecordObservations): Promise<void> {
  await assertActor(db, snapshot);
  if (getToday() !== snapshot.period.end) throw new Error('观察期间已变化，本次提醒没有投递。');
}
