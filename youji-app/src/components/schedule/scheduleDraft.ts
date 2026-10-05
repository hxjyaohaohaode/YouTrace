import { generateLocalId } from '../../db';
import { readLocalActor, assertLocalActor, type LocalActor } from '../../services/localActor';

export interface ScheduleContext extends LocalActor { key: string; revision: string | null }
interface StoredDraft<T> { revision: string; value: T }

export async function openScheduleDraft<T>(recordId: string): Promise<{ context: ScheduleContext; value: T | null }> {
  const actor = await readLocalActor(), database = actor.database;
  const key = `record-draft:schedule:${recordId}`;
  return database.transaction('r', database.settings, async () => {
    const stored = (await database.settings.get(key))?.value as StoredDraft<T> | undefined;
    const context = { ...actor, key, revision: stored?.revision ?? null };
    await assertScheduleContext(context);
    return { context, value: stored?.value ?? null };
  });
}

export async function assertScheduleContext(context: ScheduleContext): Promise<void> { await assertLocalActor(context); }

export async function saveScheduleDraft<T>(context: ScheduleContext, value: T): Promise<ScheduleContext> {
  return context.database.transaction('rw', context.database.settings, async () => {
    await assertScheduleContext(context);
    const current = (await context.database.settings.get(context.key))?.value as StoredDraft<T> | undefined;
    if ((current?.revision ?? null) !== context.revision) throw new Error('另一页已修改这份草稿；当前输入仍在页面，请先核对另一页');
    const revision = generateLocalId();
    await context.database.settings.put({ key: context.key, value: { revision, value } });
    await assertScheduleContext(context);
    return { ...context, revision };
  });
}

/** Called inside the same business + outbox transaction, never deletes a newer draft. */
export async function consumeScheduleDraft(context: ScheduleContext): Promise<void> {
  await assertScheduleContext(context);
  const current = (await context.database.settings.get(context.key))?.value as StoredDraft<unknown> | undefined;
  if ((current?.revision ?? null) !== context.revision) throw new Error('草稿刚刚在另一页变化，未提交。请核对后重试');
  await context.database.settings.delete(context.key);
  await assertScheduleContext(context);
}
