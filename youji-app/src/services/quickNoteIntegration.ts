import { db, generateLocalId, LOCAL_DATA_EPOCH_KEY, type DiaryRecord, type YoujiDatabase } from '../db';
import { enqueueSync, flush } from './syncEngine';
import { isCaptureDate, newCaptureContext, parseQuickNote, type CaptureContext, type ParsedExpense, type ParsedHabit, type ParsedTodo, type MoodLevel } from './parser';
import { normalizeExpenseCategory } from '../utils/icons';
import { SESSION_REVISION_KEY, SIGNED_OUT_KEY, isLoggedIn } from './apiClient';
import { recordDiagnostic } from './diagnostics';
import { getToday } from '../utils/date';

interface CaptureActor { ownerId: string | null; dataEpoch: string; sessionRevision: string | null; sessionActive: boolean }
export interface CaptureDraft {
  id: string; input: string; inputKey?: string;
  context?: CaptureContext; ownerId?: string | null; dataEpoch?: string; sessionRevision?: string | null; sessionActive?: boolean;
  expenses: ParsedExpense[]; habits: ParsedHabit[]; todos: ParsedTodo[];
  diary: string | null; diaryExcludedText?: string; diaryDate?: string | null; mood: MoodLevel | null; moodScore: number | null; moodConfirmed?: boolean;
}
export interface CaptureInput extends CaptureActor { key: string; text: string; context: CaptureContext }
export interface CaptureEntityRef { entity: 'quickNotes' | 'expenses' | 'todos' | 'habitCheckins' | 'diaries'; id: string; label: string; date?: string; parentId?: string; effect: 'created' | 'updated' | 'already-recorded' }
export interface ApplyResult { expenseCount: number; habitCount: number; diaryCreated: boolean; diaryUpdated: boolean; todoCount: number; records?: CaptureEntityRef[]; committedAt?: number; captureContext?: CaptureContext }
export interface CaptureReceipt { fingerprint: string; result: ApplyResult; input?: string; ownerId?: string | null }
export const captureSessionKey = () => `youtrace:active-review:${db.ownerId ?? 'guest'}`;
const unknownContext = (): CaptureContext => ({ capturedAt: null, timeZone: null, date: null });
function revision(): string | null { return typeof localStorage === 'undefined' ? null : localStorage.getItem(SESSION_REVISION_KEY); }
async function actor(target: YoujiDatabase): Promise<CaptureActor> {
  const dataEpoch = (await target.settings.get(LOCAL_DATA_EPOCH_KEY))?.value ?? 'initial';
  if (typeof dataEpoch !== 'string') throw new Error('本机资料状态需要检查，请先保留输入');
  return { ownerId: target.ownerId, dataEpoch, sessionRevision: revision(), sessionActive: isLoggedIn() };
}
async function assertActor(target: YoujiDatabase, expected: CaptureActor): Promise<void> {
  if (target !== db || target.ownerId !== expected.ownerId || revision() !== expected.sessionRevision || isLoggedIn() !== expected.sessionActive || localStorage.getItem(SIGNED_OUT_KEY) === 'true' || ((await target.settings.get(LOCAL_DATA_EPOCH_KEY))?.value ?? 'initial') !== expected.dataEpoch) throw new Error('账号或本机资料已变化，已停止写入。输入仍保留，请重新核对');
}
export async function forkCaptureInput(): Promise<CaptureInput> {
  const target = db, session = await actor(target), sessionKey = `youtrace:input:${target.ownerId ?? 'guest'}`;
  const previousKey = sessionStorage.getItem(sessionKey);
  const previous = previousKey ? await target.settings.get(previousKey) : await target.settings.get('quicknote_draft');
  const text = typeof previous?.value === 'string' ? previous.value : '';
  const savedContext = previousKey ? (await target.settings.get(`${previousKey}:context`))?.value as CaptureContext | undefined : undefined;
  const context = text ? savedContext ?? unknownContext() : newCaptureContext();
  const key = `capture-input:${generateLocalId()}`;
  await target.transaction('rw', target.settings, async () => { await assertActor(target, session); await target.settings.put({ key, value: text }); await target.settings.put({ key: `${key}:context`, value: context }); await assertActor(target, session); });
  sessionStorage.setItem(sessionKey, key);
  return { key, text, context, ...session };
}
export async function saveCaptureInput(input: CaptureInput, text: string, context = input.context): Promise<void> {
  const target = db;
  await target.transaction('rw', target.settings, async () => { await assertActor(target, input); await target.settings.put({ key: input.key, value: text }); await target.settings.put({ key: `${input.key}:context`, value: context }); await assertActor(target, input); });
}
export async function createCaptureDraft(input: string, source: CaptureInput, context = source.context): Promise<CaptureDraft> {
  const target = db; await assertActor(target, source);
  return { id: generateLocalId(), input, inputKey: source.key, context, ownerId: source.ownerId, dataEpoch: source.dataEpoch, sessionRevision: source.sessionRevision, sessionActive: source.sessionActive, ...parseQuickNote(input, context), diaryDate: context.date, moodConfirmed: false };
}
export function captureFingerprint(draft: CaptureDraft): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)])) : value;
  return JSON.stringify(canonical({ input: draft.input, context: draft.context, expenses: draft.expenses, habits: draft.habits, todos: draft.todos, diary: draft.diary, diaryExcludedText: draft.diaryExcludedText, diaryDate: draft.diaryDate, mood: draft.mood, moodScore: draft.moodScore, moodConfirmed: draft.moodConfirmed }));
}
export class CaptureChangedError extends Error {
  readonly draftId: string;
  constructor(draftId: string) { super('原确认稿已在另一页保存或修改。你的输入已另存为草稿，请核对后再次确认'); this.draftId = draftId; }
}
/** expectedFingerprint is supplied by the new editor's serial autosave queue. */
export async function saveCaptureDraft(draft: CaptureDraft, makeCurrent = false, expectedFingerprint?: string): Promise<string> {
  const target = db, session = await actor(target);
  if (draft.ownerId !== undefined && draft.ownerId !== session.ownerId) throw new Error('确认稿不属于当前账号');
  if (draft.dataEpoch !== undefined && draft.dataEpoch !== session.dataEpoch || draft.sessionRevision !== undefined && draft.sessionRevision !== session.sessionRevision || draft.sessionActive !== undefined && draft.sessionActive !== session.sessionActive) throw new Error('确认稿会话已变化，请重新核对，原文未删除');
  return target.transaction('rw', target.settings, async () => {
    await assertActor(target, session);
    const receipt = (await target.settings.get(`capture-applied:${draft.id}`))?.value as CaptureReceipt | undefined;
    if (receipt?.fingerprint === captureFingerprint(draft)) return draft.id;
    const old = (await target.settings.get(`capture-review:${draft.id}`))?.value as CaptureDraft | undefined;
    if (receipt || expectedFingerprint !== undefined && old && captureFingerprint(old) !== expectedFingerprint && captureFingerprint(old) !== captureFingerprint(draft)) draft = { ...draft, id: generateLocalId() };
    await target.settings.put({ key: `capture-review:${draft.id}`, value: draft });
    const current = (await target.settings.get('quicknote_review'))?.value as CaptureDraft | undefined;
    if (makeCurrent || current?.id === draft.id) await target.settings.put({ key: 'quicknote_review', value: draft });
    await assertActor(target, session);
    return draft.id;
  });
}
export async function loadCaptureDraft(id?: string | null): Promise<CaptureDraft | null> {
  const target = db, session = await actor(target);
  return target.transaction('rw', target.settings, async () => {
    await assertActor(target, session);
    const own = id ? (await target.settings.get(`capture-review:${id}`))?.value as CaptureDraft | undefined : undefined;
    const current = (await target.settings.get('quicknote_review'))?.value as CaptureDraft | undefined;
    const source = own ?? (current && (!id || current.id === id) ? current : undefined);
    if (!source) return null;
    if (typeof source.id !== 'string' || id && source.id !== id || source.ownerId !== undefined && source.ownerId !== session.ownerId || source.dataEpoch !== undefined && source.dataEpoch !== session.dataEpoch) throw new Error('确认稿归属或资料版本需要核对，原稿仍保留');
    if (source.ownerId === undefined || source.dataEpoch === undefined) {
      const key = `capture-unbound-source:${source.id}`;
      if (!await target.settings.get(key)) await target.settings.put({ key, value: structuredClone(source) });
    }
    // Explicitly reopening a persisted same-account draft creates a new actor
    // snapshot. Already-open callers retain their old scope and cannot revive it.
    const value: CaptureDraft = { ...source, ...session };
    await target.settings.put({ key: `capture-review:${source.id}`, value });
    if (current?.id === source.id) await target.settings.put({ key: 'quicknote_review', value });
    await assertActor(target, session);
    return value;
  });
}
export async function loadCaptureReceipt(id: string): Promise<CaptureReceipt | null> { return ((await db.settings.get(`capture-applied:${id}`))?.value as CaptureReceipt | undefined) ?? null; }
export function upgradeCaptureReview(draft: CaptureDraft): CaptureDraft {
  if (draft.context) return draft;
  // An old draft has no trustworthy capture day. Do not reinterpret its relative
  // words using today's clock. The review makes every affected date explicit.
  return { ...draft, context: unknownContext(), diaryDate: draft.diaryDate ?? null, moodConfirmed: false, expenses: draft.expenses.map(row => ({ ...row, date: row.date ?? null, currency: 'CNY' })), todos: draft.todos.map(row => ({ ...row, dueDate: row.dueDate ?? null, dateUncertain: true, dateConfirmed: false })), habits: draft.habits.map(row => ({ ...row, date: row.date ?? null, confirmed: false })) };
}

/** Only selected structured fields are copied, exactly once, with durable refs. */
export async function applyCaptureDraft(draft: CaptureDraft): Promise<ApplyResult> {
  const target = db, session = await actor(target);
  if (typeof draft.id !== 'string' || !draft.id || typeof draft.input !== 'string' || !draft.input.trim() || draft.input.length > 5000) throw new Error('速记内容无效，原稿未更改');
  if (draft.ownerId !== undefined && draft.ownerId !== session.ownerId || draft.dataEpoch !== undefined && draft.dataEpoch !== session.dataEpoch || draft.sessionRevision !== undefined && draft.sessionRevision !== session.sessionRevision || draft.sessionActive !== undefined && draft.sessionActive !== session.sessionActive) throw new Error('账号或资料版本已变化，请重新核对确认稿');
  if ([draft.expenses, draft.todos, draft.habits].some(rows => rows.length > 100)) throw new Error('一次最多核对每类100条记录，原文和草稿仍保留');
  const expenses = draft.expenses.filter(row => row.confirmed === true), todos = draft.todos.filter(row => row.confirmed === true), selectedHabits = draft.habits.filter(row => row.confirmed === true);
  const safeId = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 128;
  for (const row of [...expenses, ...todos, ...selectedHabits]) if (!safeId(row.id)) throw new Error('候选记录编号格式需要核对，原稿未传输');
  for (const row of expenses) if (typeof row.name !== 'string' || typeof row.category !== 'string' || row.isIncome !== undefined && typeof row.isIncome !== 'boolean') throw new Error('收支候选格式需要核对，原稿未传输');
  for (const row of todos) if (typeof row.text !== 'string') throw new Error('待办候选格式需要核对，原稿未传输');
  for (const row of selectedHabits) if (typeof row.name !== 'string' || row.habitId !== undefined && !safeId(row.habitId)) throw new Error('习惯候选格式需要核对，原稿未传输');
  for (const row of expenses) if (!row.name.trim() || row.name.length > 100 || !Number.isSafeInteger(row.amount) || row.amount <= 0 || row.amount > 10_000_000_000 || !isCaptureDate(row.date) || row.currency && row.currency !== 'CNY') throw new Error('请检查所选花销的名称、人民币金额与记录日期');
  for (const row of todos) if (!row.text.trim() || row.text.length > 200 || row.dueDate != null && !isCaptureDate(row.dueDate) || row.dateUncertain && !row.dateConfirmed) throw new Error('请核对所选待办内容和绝对截止日期，也可明确选择无日期');
  for (const row of selectedHabits) if (!row.done || !isCaptureDate(row.date) || row.date > getToday()) throw new Error('请核对已完成习惯的打卡日期；未完成候选不会自动撤销已有打卡');
  if (draft.moodConfirmed && !['happy', 'good', 'normal', 'low', 'sad', 'angry', 'anxious'].includes(draft.mood ?? '')) throw new Error('请选择这次心情，或取消记录情绪');
  const mood = draft.moodConfirmed === true ? draft.mood : null;
  const moodScore = mood && typeof draft.moodScore === 'number' && Number.isInteger(draft.moodScore) && draft.moodScore >= 1 && draft.moodScore <= 10 ? draft.moodScore : null;
  if (mood && moodScore === null) throw new Error('请核对心情，或选择不记录情绪');
  const diaryText = draft.diary?.trim() ?? '', diaryDate = draft.diaryDate ?? draft.context?.date;
  if (diaryText.length > 10000 || diaryText && !isCaptureDate(diaryDate)) throw new Error('请核对所选日记的日期与内容（最多10000字）');
  const now = Date.now();
  const selectedExpenses = expenses.map(row => ({ id: row.id, name: row.name, amount: row.amount, category: normalizeExpenseCategory(row.category), confirmed: true, date: row.date!, currency: 'CNY' as const, isIncome: row.isIncome === true }));
  const selectedTodos = todos.map(row => ({ id: row.id, text: row.text, confirmed: true, dueDate: row.dueDate ?? null }));
  const confirmedHabits = selectedHabits.map(row => ({ id: row.id, name: row.name, done: true, confirmed: true, ...(row.habitId ? { habitId: row.habitId } : {}), date: row.date! }));
  const context: CaptureContext = { capturedAt: typeof draft.context?.capturedAt === 'number' && Number.isFinite(draft.context.capturedAt) ? draft.context.capturedAt : null, timeZone: draft.context?.timeZone === 'Asia/Shanghai' ? 'Asia/Shanghai' : null, date: isCaptureDate(draft.context?.date) ? draft.context.date : null };
  const result = await target.transaction('rw', target.tables, async () => {
    await assertActor(target, session);
    const completed = (await target.settings.get(`capture-applied:${draft.id}`))?.value as CaptureReceipt | undefined;
    if (completed) { if (completed.fingerprint === captureFingerprint(draft)) return completed.result; return { forkedDraftId: await saveCaptureDraft(draft) }; }
    const saved = (await target.settings.get(`capture-review:${draft.id}`))?.value as CaptureDraft | undefined;
    if (saved && captureFingerprint(saved) !== captureFingerprint(draft)) {
      const copy = { ...draft, id: generateLocalId() }; await target.settings.put({ key: `capture-review:${copy.id}`, value: copy }); await assertActor(target, session); return { forkedDraftId: copy.id };
    }
    const records: CaptureEntityRef[] = [];
    const result: ApplyResult = { expenseCount: 0, habitCount: 0, diaryCreated: false, diaryUpdated: false, todoCount: 0, records, committedAt: now, captureContext: context };
    const queue = async (entity: Parameters<typeof enqueueSync>[0], payload: unknown) => { if (target.ownerId) await enqueueSync(entity, 'upsert', payload); };
    const note = { id: draft.id, rawInput: draft.input, createdAt: now, expenses: selectedExpenses, diary: diaryText || null, mood, moodScore, habits: confirmedHabits, todos: selectedTodos, confirmed: true, captureContext: context };
    await target.quickNotes.put(note);
    await queue('quickNotes', { id: note.id, content: note.rawInput, timestamp: now, parsed: { expenses: note.expenses, diary: note.diary, mood, moodScore, habits: note.habits, todos: note.todos, captureContext: context }, confirmed: true });
    records.push({ entity: 'quickNotes', id: note.id, label: '原始速记', effect: 'created' });
    for (const expense of expenses) {
      const row = { id: generateLocalId(), name: expense.name.trim(), amount: expense.amount, category: normalizeExpenseCategory(expense.category), date: expense.date!, isIncome: expense.isIncome === true, source: 'quicknote' };
      await target.expenses.put(row); await queue('expenses', row); result.expenseCount++; records.push({ entity: 'expenses', id: row.id, label: row.name, date: row.date, effect: 'created' });
    }
    for (const todo of todos) {
      const row = { id: generateLocalId(), text: todo.text.trim(), dueDate: todo.dueDate ?? undefined, priority: 'medium' as const, done: false, createdAt: now, updatedAt: now };
      await target.todos.put(row); await queue('todos', { ...row, dueDate: row.dueDate ?? null }); result.todoCount++; records.push({ entity: 'todos', id: row.id, label: row.text, date: row.dueDate, effect: 'created' });
    }
    const habits = await target.habits.toArray();
    for (const item of selectedHabits) {
      const matches = habits.filter(row => item.habitId ? row.id === item.habitId : row.name === item.name.trim());
      if (matches.length !== 1) throw new Error(`习惯「${item.name.slice(0, 30)}」无法唯一匹配，请先选择已有习惯，或取消这项`);
      const habitId = matches[0].id, date = item.date!, id = `${habitId}|${date}`;
      const priorCheckin = await target.habitCheckins.get(id);
      if (priorCheckin?.done) { records.push({ entity: 'habitCheckins', id, parentId: habitId, label: matches[0].name, date, effect: 'already-recorded' }); continue; }
      const row = { id, habitId, date, done: true, source: 'manual' as const, confirmed: true, updatedAt: now };
      await target.habitCheckins.put(row); await queue('habitCheckins', row); result.habitCount++; records.push({ entity: 'habitCheckins', id, parentId: habitId, label: matches[0].name, date, effect: priorCheckin ? 'updated' : 'created' });
    }
    if (diaryText && diaryDate) {
      const existing = await target.diary.where('date').equals(diaryDate).toArray();
      if (existing.length > 1) throw new Error('该日期有多份日记，请先取消日记去向并到日记页比较；原稿已保留');
      const old = existing[0], content = old?.content ? `${old.content}\n\n${diaryText}` : diaryText;
      if (content.length > 10000) throw new Error('追加后日记超过10000字，请先整理，原稿未删除');
      const row: DiaryRecord = { id: old?.id ?? generateLocalId(), date: diaryDate, content, mood: mood ?? old?.mood ?? null, moodScore: mood ? moodScore : old?.moodScore ?? null, source: old?.source ?? 'quicknote_aggregated', quickNoteIds: [...(old?.quickNoteIds ?? []), draft.id], createdAt: old?.createdAt ?? now, updatedAt: now };
      await target.diary.put(row); await queue('diaries', { id: row.id, date: row.date, content: row.content, mood: row.mood, moodScore: row.moodScore, source: row.source }); result.diaryCreated = !old; result.diaryUpdated = !!old; records.push({ entity: 'diaries', id: row.id, label: `${row.date} 日记`, date: row.date, effect: old ? 'updated' : 'created' });
    }
    await assertActor(target, session);
    // Preserve legacy/unrecognized draft fields locally, never in wire payloads.
    await target.settings.put({ key: `capture-source:${draft.id}`, value: structuredClone(draft) });
    await target.settings.put({ key: `capture-applied:${draft.id}`, value: { fingerprint: captureFingerprint(draft), result, input: draft.input, ownerId: target.ownerId } satisfies CaptureReceipt });
    await target.settings.delete(`capture-review:${draft.id}`);
    if (draft.inputKey?.startsWith('capture-input:')) {
      const raw = (await target.settings.get(draft.inputKey))?.value;
      if (typeof raw === 'string' && raw === draft.input) { await target.settings.delete(draft.inputKey); await target.settings.delete(`${draft.inputKey}:context`); }
    }
    const current = (await target.settings.get('quicknote_review'))?.value as CaptureDraft | undefined;
    if (current?.id === draft.id) { await target.settings.delete('quicknote_review'); if ((await target.settings.get('quicknote_draft'))?.value === draft.input) await target.settings.delete('quicknote_draft'); }
    await assertActor(target, session);
    return result;
  });
  if ('forkedDraftId' in result) throw new CaptureChangedError(result.forkedDraftId);
  // The receipt is already durable. A refresh/network failure cannot change it
  // into a claimed failed save or cause the user to apply the capture twice.
  const { loadAllStores } = await import('../hooks/useAppInit');
  try { await assertActor(target, session); await loadAllStores(); } catch { recordDiagnostic('runtime-error', 'capture-review'); }
  void flush().catch(() => recordDiagnostic('runtime-error', 'sync'));
  return result;
}
