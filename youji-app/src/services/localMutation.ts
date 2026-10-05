import type { Table } from 'dexie';
import { db, type SyncEntity } from '../db';
import { enqueueSync, flush } from './syncEngine';
import { recordDiagnostic } from './diagnostics';
import { readLocalActor, assertLocalActor } from './localActor';

/** Source snapshot, visible record and retryable mutation share one commit. */
export async function commitLocalMutation(
  entity: SyncEntity,
  op: 'upsert' | 'delete',
  payload: unknown,
  write: () => Promise<unknown>,
  tables: Table[] = [db.table(entity === 'diaries' ? 'diary' : entity === 'goals' ? 'goalRecords' : entity)],
  expected?: object | null,
): Promise<void> {
  const actor = await readLocalActor(), database = actor.database;
  const assertCurrent = () => assertLocalActor(actor);
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
