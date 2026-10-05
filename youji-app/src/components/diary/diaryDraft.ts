import { generateLocalId, type DiaryRecord } from '../../db';
import { readLocalActor, assertLocalActor, type LocalActor } from '../../services/localActor';

export interface DiaryContext extends LocalActor { key: string; revision: string | null }
export interface DiaryForm {
  id: string;
  date: string;
  content: string;
  mood: string | null;
  moodScore: number | null;
  base: DiaryRecord | null;
}
interface StoredDraft { revision: string; value: DiaryForm }

export const sameDiarySnapshot = (left: DiaryRecord | undefined, right: DiaryRecord): boolean => Boolean(left) && [...new Set([...Object.keys(left!), ...Object.keys(right)])].every((key) => JSON.stringify(left![key as keyof DiaryRecord]) === JSON.stringify(right[key as keyof DiaryRecord]));

export async function openDiaryDraft(recordId: string): Promise<{ context: DiaryContext; value: DiaryForm | null }> {
  const actor = await readLocalActor(), database = actor.database;
  const key = `record-draft:diary:${recordId}`;
  return database.transaction('r', database.settings, async () => {
    const stored = (await database.settings.get(key))?.value as StoredDraft | undefined;
    const context = { ...actor, key, revision: stored?.revision ?? null };
    await assertDiaryContext(context);
    if (stored && (typeof stored.revision !== 'string' || !isDiaryForm(stored.value) || (recordId !== 'new' && stored.value.id !== recordId))) throw new Error('这份日记草稿格式异常，已保留原稿，未自动覆盖。可在设置中导出本机数据');
    return { context, value: stored?.value ?? null };
  });
}

function isDiaryForm(value: unknown): value is DiaryForm {
  if (!value || typeof value !== 'object') return false;
  const form = value as Partial<DiaryForm>;
  return typeof form.id === 'string' && typeof form.content === 'string' && typeof form.date === 'string' && (form.mood === null || typeof form.mood === 'string') && (form.moodScore === null || typeof form.moodScore === 'number') && (form.base === null || (typeof form.base === 'object' && form.base.id === form.id));
}

export async function assertDiaryContext(context: DiaryContext): Promise<void> { await assertLocalActor(context); }

export async function saveDiaryDraft(context: DiaryContext, value: DiaryForm): Promise<DiaryContext> {
  return context.database.transaction('rw', context.database.settings, async () => {
    await assertDiaryContext(context);
    const current = (await context.database.settings.get(context.key))?.value as StoredDraft | undefined;
    if ((current?.revision ?? null) !== context.revision) throw new Error('另一页已修改这份草稿；当前输入仍在页面，请先核对另一页');
    const revision = generateLocalId();
    await context.database.settings.put({ key: context.key, value: { revision, value } });
    await assertDiaryContext(context);
    return { ...context, revision };
  });
}

/** Only inside the business + outbox transaction; never consume a newer revision. */
export async function consumeDiaryDraft(context: DiaryContext): Promise<void> {
  await assertDiaryContext(context);
  const current = (await context.database.settings.get(context.key))?.value as StoredDraft | undefined;
  if ((current?.revision ?? null) !== context.revision) throw new Error('草稿刚刚在另一页变化，未提交。请核对后重试');
  await context.database.settings.delete(context.key);
  await assertDiaryContext(context);
}
