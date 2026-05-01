import db, { getSyncQueue, removeSyncQueueItem } from './indexedDB';
import client from '../api/client';
import { extractErrorStatus } from '../utils/error';

const MAX_RETRIES = 5;

interface SyncResult {
  synced: number;
  failed: number;
  pending: number;
}

export async function pullRemoteData(_userId?: string) {
  try {
    const [diaryRes, eventRes, goalRes, habitRes] = await Promise.all([
      client.get('/api/diaries?pageSize=50'),
      client.get('/api/events'),
      client.get('/api/goals'),
      client.get('/api/habits'),
    ]);

    if (diaryRes.data?.success && diaryRes.data?.data?.items) {
      for (const diary of diaryRes.data.data.items) {
        await db.diaries.put({
          id: diary.id,
          userId: diary.userId,
          content: diary.content,
          emotionScore: diary.emotionScore,
          emotionTags: diary.emotionTags,
          aiInsight: diary.aiInsight,
          mediaUrls: diary.mediaUrls,
          createdAt: diary.createdAt,
          updatedAt: diary.updatedAt,
          _version: Date.now(),
          _synced: true,
        });
      }
    }

    if (eventRes.data?.success && eventRes.data?.data) {
      for (const event of eventRes.data.data) {
        await db.events.put({
          id: event.id,
          userId: event.userId,
          title: event.title,
          description: event.description,
          startTime: event.startTime,
          endTime: event.endTime,
          color: event.color || null,
          recurrence: event.recurrenceRule || null,
          createdAt: event.createdAt,
          _version: Date.now(),
          _synced: true,
        });
      }
    }

    if (goalRes.data?.success && goalRes.data?.data) {
      for (const goal of goalRes.data.data) {
        await db.goals.put({
          id: goal.id,
          userId: goal.userId,
          title: goal.title,
          description: goal.description,
          status: goal.status,
          progress: goal.progress,
          deadline: goal.deadline,
          milestones: goal.aiBreakdown ? JSON.stringify(goal.aiBreakdown) : null,
          createdAt: goal.createdAt,
          updatedAt: goal.updatedAt,
          _version: Date.now(),
          _synced: true,
        });
      }
    }

    if (habitRes.data?.success && habitRes.data?.data) {
      for (const habit of habitRes.data.data) {
        await db.habits.put({
          id: habit.id,
          userId: habit.userId,
          title: habit.title,
          description: habit.description,
          frequency: habit.frequency,
          targetDays: habit.targetDays,
          goalId: habit.goalId,
          streakCurrent: habit.streakCurrent,
          streakLongest: habit.streakLongest,
          createdAt: habit.createdAt,
          _version: Date.now(),
          _synced: true,
        });
      }
    }
  } catch (error) {
    console.error('Pull remote data failed:', error);
  }
}

export async function processSyncQueue(): Promise<SyncResult> {
  const items = await getSyncQueue();
  let synced = 0;
  let failed = 0;
  const pending = items.filter((i) => i.retryCount === 0 && !i.lastError).length;

  for (const item of items) {
    if (item.lastError && item.retryCount >= MAX_RETRIES) continue;

    try {
      const data = JSON.parse(item.data);
      const entityRouteMap: Record<string, string> = {
        diary: 'diaries',
        event: 'events',
        goal: 'goals',
        habit: 'habits',
        habitlog: 'habits',
        notification: 'notifications',
      };
      const entityPath = entityRouteMap[item.entityType.toLowerCase()] || `${item.entityType.toLowerCase()}s`;

      switch (item.operation) {
        case 'CREATE':
          await client.post(`/api/${entityPath}`, data);
          break;
        case 'UPDATE':
          try {
            await client.put(`/api/${entityPath}/${item.entityId}`, data);
          } catch (updateError: unknown) {
            if (extractErrorStatus(updateError) === 409) {
              const remoteRes = await client.get(`/api/${entityPath}/${item.entityId}`);
              if (remoteRes.data?.success && remoteRes.data?.data) {
                const remote = remoteRes.data.data;
                const localUpdatedAt = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
                const remoteUpdatedAt = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
                if (localUpdatedAt > remoteUpdatedAt) {
                  await client.put(`/api/${entityPath}/${item.entityId}`, data);
                }
              }
            } else {
              throw updateError;
            }
          }
          break;
        case 'DELETE':
          await client.delete(`/api/${entityPath}/${item.entityId}`);
          break;
      }

      await removeSyncQueueItem(item.id!);
      synced++;
    } catch (error) {
      const newRetryCount = item.retryCount + 1;
      if (newRetryCount >= MAX_RETRIES) {
        await db.syncQueue.update(item.id!, {
          retryCount: newRetryCount,
          lastError: (error as Error).message,
        });
        failed++;
      } else {
        await db.syncQueue.update(item.id!, {
          retryCount: newRetryCount,
          lastError: (error as Error).message,
        });
      }
    }
  }

  return { synced, failed, pending };
}
