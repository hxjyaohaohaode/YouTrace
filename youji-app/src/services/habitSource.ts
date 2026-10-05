import Dexie from 'dexie';
import { encodeRecovery } from '../db/accountGeneration';
import type { HabitCheckinRecord } from '../db';
import type { HabitItem } from '../stores/habitStore';
import { parseBusinessDate } from '../utils/date';

/** Compare the full structured-clone source, never the derived card or wire projection. */
export async function sameHabitSource(left: unknown, right: unknown): Promise<boolean> {
  const [a, b] = await Dexie.waitFor(Promise.all([encodeRecovery(left), encodeRecovery(right)]));
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Recovery and unknown local fields stay local even when the canonical row grows. */
export function habitPayload(habit: HabitItem) {
  const { id, name, icon, frequency, sortOrder } = habit;
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(id) || typeof name !== 'string' || !name.trim() || name.length > 100 || typeof icon !== 'string' || !icon || icon.length > 16 || !['daily', 'weekly'].includes(frequency) || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) throw new Error('习惯字段格式需要核对，未传输或修改原记录');
  return { id, name, icon, frequency, sortOrder };
}

export function habitCheckinPayload(checkin: HabitCheckinRecord) {
  const { id, habitId, date, done, source, confirmed, aiReason } = checkin;
  try { parseBusinessDate(date); } catch { throw new Error('打卡日期需要核对，未传输或修改原记录'); }
  if (typeof habitId !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(habitId) || id !== `${habitId}|${date}` || typeof done !== 'boolean' || !['manual', 'ai', 'schedule'].includes(source) || typeof confirmed !== 'boolean' || aiReason !== undefined && (typeof aiReason !== 'string' || aiReason.length > 500)) throw new Error('打卡来源字段需要核对，未传输或修改原记录');
  return { id, habitId, date, done, source, confirmed, ...(aiReason === undefined ? {} : { aiReason }) };
}
