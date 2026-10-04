import { db, generateLocalId, type DiaryRecord } from '../db';
import { enqueueSync, flush } from './syncEngine';
import type { ParsedExpense, ParsedHabit, ParsedTodo, MoodLevel } from './parser';
import { addDays, getToday } from '../utils/date';
import { normalizeExpenseCategory } from '../utils/icons';

export interface CaptureDraft {
  id: string;
  input: string;
  inputKey?: string;
  expenses: ParsedExpense[];
  habits: ParsedHabit[];
  todos: ParsedTodo[];
  diary: string | null;
  mood: MoodLevel | null;
  moodScore: number;
}
export async function forkCaptureInput(): Promise<{ key: string; text: string }> {
  const sessionKey = `youtrace:input:${db.ownerId ?? 'guest'}`;
  const previousKey = sessionStorage.getItem(sessionKey);
  const previous = previousKey ? await db.settings.get(previousKey) : await db.settings.get('quicknote_draft');
  const text = typeof previous?.value === 'string' ? previous.value : '';
  const key = `capture-input:${generateLocalId()}`;
  if (text) await db.settings.put({ key, value: text });
  // Fork on each mounted composer: a duplicated tab must not keep the same
  // recovery slot. The source is retained rather than silently claimed/deleted.
  sessionStorage.setItem(sessionKey, key);
  return { key, text };
}

export const captureSessionKey = () => `youtrace:active-review:${db.ownerId ?? 'guest'}`;

function captureFingerprint(draft: CaptureDraft): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)])) : value;
  return JSON.stringify(canonical({ input: draft.input, expenses: draft.expenses, habits: draft.habits, todos: draft.todos, diary: draft.diary, mood: draft.mood, moodScore: draft.moodScore }));
}
interface CaptureReceipt { fingerprint: string; result: ApplyResult }
export class CaptureChangedError extends Error {
  readonly draftId: string;
  constructor(draftId: string) { super('原确认稿已在另一页保存。你的新修改已另存为草稿，请核对后再次确认'); this.draftId = draftId; }
}
export async function saveCaptureDraft(draft: CaptureDraft, makeCurrent = false): Promise<string> {
  return db.transaction('rw', db.settings, async () => {
    const receipt = (await db.settings.get(`capture-applied:${draft.id}`))?.value as CaptureReceipt | undefined;
    if (receipt?.fingerprint === captureFingerprint(draft)) return draft.id;
    if (receipt) draft = { ...draft, id: generateLocalId() };
    await db.settings.put({ key: `capture-review:${draft.id}`, value: draft });
    const current = await db.settings.get('quicknote_review');
    if (makeCurrent || (current?.value as CaptureDraft | undefined)?.id === draft.id) {
      await db.settings.put({ key: 'quicknote_review', value: draft });
    }
    return draft.id;
  });
}

export async function loadCaptureDraft(id?: string | null): Promise<CaptureDraft | null> {
  if (id) {
    const own = await db.settings.get(`capture-review:${id}`);
    if (own) return own.value as CaptureDraft;
  }
  const current = (await db.settings.get('quicknote_review'))?.value as CaptureDraft | undefined;
  return current && (!id || current.id === id) ? current : null;
}

export interface ApplyResult { expenseCount: number; habitCount: number; diaryCreated: boolean; diaryUpdated: boolean; todoCount: number }

function dueDate(text: string) {
  if (text.startsWith('明天')) return { text: text.slice(2).trim() || text, dueDate: addDays(getToday(), 1) };
  if (text.startsWith('后天')) return { text: text.slice(2).trim() || text, dueDate: addDays(getToday(), 2) };
  return { text, dueDate: getToday() };
}

/** Confirm the edited draft once, with all records + outbox in one transaction. */
export async function applyCaptureDraft(draft: CaptureDraft): Promise<ApplyResult> {
  if (!draft.id || !draft.input.trim() || draft.input.length > 5000) throw new Error('速记内容无效，原稿未更改');
  const expenses = draft.expenses.filter((row) => row.confirmed);
  for (const row of expenses) {
    if (!row.name.trim() || row.name.length > 100 || !Number.isSafeInteger(row.amount) || row.amount <= 0 || row.amount > 100_000_000_00) throw new Error('请检查花销名称与金额');
  }
  const todos = draft.todos.filter((row) => row.confirmed && row.text.trim());
  if (todos.some((row) => row.text.length > 200)) throw new Error('待办内容不能超过 200 字');
  const today = getToday(), now = Date.now();
  const diaryText = draft.diary?.trim() ?? '';
  if (diaryText.length > 10000) throw new Error('日记内容不能超过 10000 字');
  const result = await db.transaction('rw', db.tables, async () => {
    const completed = await db.settings.get(`capture-applied:${draft.id}`);
    if (completed) {
      const receipt = completed.value as CaptureReceipt;
      if (receipt.fingerprint === captureFingerprint(draft)) return receipt.result;
      const forkedDraftId = await saveCaptureDraft(draft);
      return { forkedDraftId };
    }
    const result: ApplyResult = { expenseCount: 0, habitCount: 0, diaryCreated: false, diaryUpdated: false, todoCount: 0 };
    const queue = async (entity: Parameters<typeof enqueueSync>[0], payload: unknown) => { if (db.ownerId) await enqueueSync(entity, 'upsert', payload); };
    const note = { id: draft.id, rawInput: draft.input, createdAt: now, expenses: draft.expenses, diary: draft.diary, mood: draft.mood, moodScore: draft.moodScore, habits: draft.habits, todos: draft.todos };
    await db.quickNotes.put(note);
    await queue('quickNotes', { id: note.id, content: note.rawInput, timestamp: now, parsed: { expenses: note.expenses, diary: note.diary, mood: note.mood, moodScore: note.moodScore, habits: note.habits, todos: note.todos }, confirmed: true });
    for (const expense of expenses) {
      const row = { id: generateLocalId(), name: expense.name.trim(), amount: expense.amount, category: normalizeExpenseCategory(expense.category), date: today, isIncome: false, source: 'quicknote' };
      await db.expenses.put(row); await queue('expenses', row); result.expenseCount += 1;
    }
    for (const todo of todos) {
      const row = { id: generateLocalId(), ...dueDate(todo.text.trim()), priority: 'medium' as const, done: false, createdAt: now, updatedAt: now };
      await db.todos.put(row); await queue('todos', row); result.todoCount += 1;
    }
    const habits = await db.habits.toArray();
    for (const item of draft.habits.filter((row) => row.confirmed && row.done)) {
      const matches = habits.filter((row) => row.name === item.name.trim());
      if (matches.length !== 1) throw new Error(`习惯「${item.name.slice(0, 30)}」无法唯一匹配，请取消勾选后手动打卡`);
      const habitId = matches[0].id, id = `${habitId}|${today}`;
      if ((await db.habitCheckins.get(id))?.done) continue;
      const row = { id, habitId, date: today, done: true, source: 'manual' as const, confirmed: true, updatedAt: now };
      await db.habitCheckins.put(row); await queue('habitCheckins', row); result.habitCount += 1;
    }
    if (diaryText) {
      const existing = await db.diary.where('date').equals(today).toArray();
      if (existing.length > 1) throw new Error('今天有多份日记，请取消日记内容并到日记页整理；原稿已保留');
      const old = existing[0];
      const content = old?.content ? `${old.content}\n\n${diaryText}` : diaryText;
      if (content.length > 10000) throw new Error('追加后日记超过 10000 字，请先整理原文');
      const row: DiaryRecord = { id: old?.id ?? generateLocalId(), date: today, content, mood: draft.mood ?? old?.mood ?? null, moodScore: draft.mood ? draft.moodScore : old?.moodScore ?? 5, source: old?.source ?? 'quicknote_aggregated', quickNoteIds: [...(old?.quickNoteIds ?? []), draft.id], createdAt: old?.createdAt ?? now, updatedAt: now };
      await db.diary.put(row);
      await queue('diaries', { id: row.id, date: row.date, content: row.content, ...(row.mood ? { mood: row.mood } : {}), moodScore: row.moodScore, source: row.source });
      result.diaryCreated = !old; result.diaryUpdated = Boolean(old);
    }
    await db.settings.put({ key: `capture-applied:${draft.id}`, value: { fingerprint: captureFingerprint(draft), result } satisfies CaptureReceipt });
    await db.settings.delete(`capture-review:${draft.id}`);
    if (draft.inputKey?.startsWith('capture-input:')) {
      const raw = (await db.settings.get(draft.inputKey))?.value;
      if (typeof raw === 'string' && raw.trim() === draft.input) await db.settings.delete(draft.inputKey);
    }
    const currentReview = (await db.settings.get('quicknote_review'))?.value as CaptureDraft | undefined;
    if (currentReview?.id === draft.id) {
      await db.settings.delete('quicknote_review');
      if ((await db.settings.get('quicknote_draft'))?.value === draft.input) await db.settings.delete('quicknote_draft');
    }
    return result;
  });
  if ('forkedDraftId' in result) throw new CaptureChangedError(result.forkedDraftId);
  // Hydration happens only after the whole commit, never during a rollback.
  const { loadAllStores } = await import('../hooks/useAppInit');
  await loadAllStores();
  void flush();
  return result;
}
