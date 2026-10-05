import type { GoalRecord } from '../db';

/** Only previewed primitive domain fields and audit time may leave the device.
 * Unknown metadata, including an object hidden under an allowed key, stays local. */
export function goalSyncPayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('目标格式需要核对，原稿保留在本机，尚未传输');
  const goal = value as GoalRecord;
  for (const key of ['id', 'title', 'description', 'level', 'domain', 'priority'] as const) {
    if (typeof goal[key] !== 'string') throw new Error('目标字段格式需要核对，原稿保留在本机，尚未传输');
  }
  if (typeof goal.progress !== 'number' || !Number.isFinite(goal.progress) || goal.targetDate != null && typeof goal.targetDate !== 'string' || goal.createdAt !== undefined && (typeof goal.createdAt !== 'number' || !Number.isSafeInteger(goal.createdAt) || goal.createdAt < 0 || goal.createdAt > 8640000000000000)) {
    throw new Error('目标日期或进度格式需要核对，原稿保留在本机，尚未传输');
  }
  return { id: goal.id, title: goal.title, description: goal.description, level: goal.level, domain: goal.domain, priority: goal.priority, progress: goal.progress, targetDate: goal.targetDate, createdAt: goal.createdAt };
}
