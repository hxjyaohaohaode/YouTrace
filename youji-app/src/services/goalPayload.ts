import type { GoalRecord } from '../db';

/** Only previewed domain fields and source metadata may leave this device. */
export function goalSyncPayload(value: unknown) {
  const goal = value as GoalRecord;
  return { id: goal.id, title: goal.title, description: goal.description, level: goal.level, domain: goal.domain, priority: goal.priority, progress: goal.progress, targetDate: goal.targetDate, createdAt: goal.createdAt };
}
