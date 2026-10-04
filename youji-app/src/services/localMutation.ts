import type { Table } from 'dexie';
import { db, LOCAL_DATA_EPOCH_KEY, type SyncEntity } from '../db';
import { enqueueSync, flush } from './syncEngine';
import { recordDiagnostic } from './diagnostics';
import { isLoggedIn, SESSION_REVISION_KEY, SIGNED_OUT_KEY } from './apiClient';

/** Source snapshot, visible record and retryable mutation share one commit. */
export async function commitLocalMutation(
  entity: SyncEntity,
  op: 'upsert' | 'delete',
  payload: unknown,
  write: () => Promise<unknown>,
  tables: Table[] = [db.table(entity === 'diaries' ? 'diary' : entity === 'goals' ? 'goalRecords' : entity)],
  expected?: object | null,
): Promise<void> {
  const database = db, session = localStorage.getItem(SESSION_REVISION_KEY), active = isLoggedIn();
  const epoch = (await database.settings.get(LOCAL_DATA_EPOCH_KEY))?.value;
  const assertCurrent = async () => {
    if (database !== db || localStorage.getItem(SESSION_REVISION_KEY) !== session || isLoggedIn() !== active || localStorage.getItem(SIGNED_OUT_KEY) === 'true' || (await database.settings.get(LOCAL_DATA_EPOCH_KEY))?.value !== epoch) throw new Error('账号或本机资料已变化，未写入旧修改。输入仍保留，请重新核对');
  };
  await database.transaction('rw', [...tables, database.outbox, database.settings], async () => {
    await assertCurrent();
    if (expected !== undefined) {
      const row = payload as { id?: string; habitId?: string; date?: string };
      const id = op === 'delete' ? String(payload) : entity === 'habitCheckins' ? `${row.habitId}|${row.date}` : row.id;
      const current = await database.table(entity === 'diaries' ? 'diary' : entity === 'goals' ? 'goalRecords' : entity).get(id!);
      const unchanged = expected === null ? !current : current && [...new Set([...Object.keys(expected), ...Object.keys(current)])].every(key => JSON.stringify((expected as Record<string, unknown>)[key]) === JSON.stringify(current[key]));
      if (!unchanged) {
        window.dispatchEvent(new CustomEvent('youtrace:data-updated'));
        throw new Error('记录刚刚在其他位置更新，已保留输入。请核对最新版本后再保存');
      }
    }
    await write();
    await assertCurrent();
    if (database.ownerId) await enqueueSync(entity, op, payload);
    await assertCurrent();
  });
  void flush().catch(() => recordDiagnostic('runtime-error', 'sync'));
}
