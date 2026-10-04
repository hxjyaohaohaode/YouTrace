import type { Table } from 'dexie';
import { db, type SyncEntity } from '../db';
import { enqueueSync, flush } from './syncEngine';

/** Source snapshot, visible record and retryable mutation share one commit. */
export async function commitLocalMutation(
  entity: SyncEntity,
  op: 'upsert' | 'delete',
  payload: unknown,
  write: () => Promise<unknown>,
  tables: Table[] = [db.table(entity === 'diaries' ? 'diary' : entity)],
  expected?: object | null,
): Promise<void> {
  const database = db;
  await database.transaction('rw', [...tables, database.outbox, database.settings], async () => {
    if (expected !== undefined) {
      const row = payload as { id?: string; habitId?: string; date?: string };
      const id = op === 'delete' ? String(payload) : entity === 'habitCheckins' ? `${row.habitId}|${row.date}` : row.id;
      const current = await database.table(entity === 'diaries' ? 'diary' : entity).get(id!);
      const unchanged = expected === null ? !current : current && Object.entries(expected).every(([key, value]) => JSON.stringify(value) === JSON.stringify(current[key]));
      if (!unchanged) {
        window.dispatchEvent(new CustomEvent('youtrace:data-updated'));
        throw new Error('记录刚刚在其他位置更新，已保留输入。请核对最新版本后再保存');
      }
    }
    await write();
    if (database.ownerId) await enqueueSync(entity, op, payload);
  });
  void flush();
}
