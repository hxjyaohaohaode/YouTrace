import { db, LOCAL_DATA_EPOCH_KEY, generateLocalId, type YoujiDatabase } from '../../db';
import { isLoggedIn, SESSION_REVISION_KEY, SIGNED_OUT_KEY } from '../../services/apiClient';

export interface TodoContext {
  database: YoujiDatabase;
  owner: string | null;
  session: string | null;
  sessionActive: boolean;
  epoch: unknown;
  key: string;
  revision: string | null;
}
interface StoredDraft<T> { revision: string; value: T }

export async function openTodoDraft<T>(recordId: string): Promise<{ context: TodoContext; value: T | null }> {
  const database = db;
  const session = localStorage.getItem(SESSION_REVISION_KEY);
  const sessionActive = isLoggedIn();
  const key = `record-draft:todo:${recordId}`;
  return database.transaction('r', database.settings, async () => {
    const epoch = (await database.settings.get(LOCAL_DATA_EPOCH_KEY))?.value ?? 'initial';
    const stored = (await database.settings.get(key))?.value as StoredDraft<T> | undefined;
    const context = { database, owner: database.ownerId, session, sessionActive, epoch, key, revision: stored?.revision ?? null };
    await assertTodoContext(context);
    return { context, value: stored?.value ?? null };
  });
}

export async function assertTodoContext(context: TodoContext): Promise<void> {
  if (context.sessionActive !== isLoggedIn() || context.database !== db || context.owner !== db.ownerId || localStorage.getItem(SESSION_REVISION_KEY) !== context.session || localStorage.getItem(SIGNED_OUT_KEY) === 'true' || (await context.database.settings.get(LOCAL_DATA_EPOCH_KEY))?.value !== (context.epoch === 'initial' ? undefined : context.epoch)) {
    throw new Error('账号或本机数据已变化，未写入旧草稿。请重新打开页面');
  }
}

export async function saveTodoDraft<T>(context: TodoContext, value: T): Promise<TodoContext> {
  return context.database.transaction('rw', context.database.settings, async () => {
    await assertTodoContext(context);
    const current = (await context.database.settings.get(context.key))?.value as StoredDraft<T> | undefined;
    if ((current?.revision ?? null) !== context.revision) throw new Error('另一页已修改这份草稿；当前输入仍在页面，请先核对另一页');
    const revision = generateLocalId();
    await context.database.settings.put({ key: context.key, value: { revision, value } });
    return { ...context, revision };
  });
}

/** Called inside the same business + outbox transaction, never deletes a newer draft. */
export async function consumeTodoDraft(context: TodoContext): Promise<void> {
  await assertTodoContext(context);
  const current = (await context.database.settings.get(context.key))?.value as StoredDraft<unknown> | undefined;
  if ((current?.revision ?? null) !== context.revision) throw new Error('草稿刚刚在另一页变化，未提交。请核对后重试');
  await context.database.settings.delete(context.key);
}
