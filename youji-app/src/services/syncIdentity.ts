import type { OutboxRecord } from '../db';
/** Same identity for the outbox, conflict handling and visible receipt status. */
export function recordKey(record: OutboxRecord): string {
  if (record.op === 'delete') return `${record.entity}:${String(record.payload)}`;
  const row = record.payload as { id?: string; habitId?: string; date?: string };
  return `${record.entity}:${record.entity === 'habitCheckins' ? `${row.habitId}|${row.date}` : row.id}`;
}
export const isSequence = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n;
