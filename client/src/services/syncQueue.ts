import db, { getSyncQueue, removeSyncQueueItem } from './indexedDB';
import client from '../api/client';
import { extractErrorStatus } from '../utils/error';

const MAX_RETRIES = 5;

const RETRY_DELAYS = [
  1 * 60 * 1000,
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
];

interface SyncResult {
  synced: number;
  failed: number;
  pending: number;
}

export async function pullRemoteData(_userId?: string) {
  try {
    let diaryPage = 1;
    const diaryPageSize = 50;
    let hasMoreDiaries = true;

    while (hasMoreDiaries) {
      const diaryRes = await client.get('/api/diaries', {
        params: { page: diaryPage, pageSize: diaryPageSize },
      });

      if (diaryRes.data?.success && diaryRes.data?.data?.items) {
        const items = diaryRes.data.data.items;
        for (const diary of items) {
          await db.diaries.put({
            id: diary.id,
            userId: diary.userId,
            content: diary.content,
            emotionScore: diary.emotionScore,
            emotionTags: diary.emotionTags,
            aiInsight: diary.aiInsight,
            mediaUrls: diary.mediaUrls,
            weather: diary.weather ? JSON.stringify(diary.weather) : null,
            locationName: diary.locationName || null,
            locationLat: diary.locationLat || null,
            locationLng: diary.locationLng || null,
            createdAt: diary.createdAt,
            updatedAt: diary.updatedAt,
            _version: Date.now(),
            _synced: true,
          });
        }

        const totalPages = diaryRes.data.data.totalPages || 1;
        if (diaryPage >= totalPages || items.length < diaryPageSize) {
          hasMoreDiaries = false;
        } else {
          diaryPage++;
        }
      } else {
        hasMoreDiaries = false;
      }
    }

    const [eventRes, goalRes, habitRes] = await Promise.all([
      client.get('/api/events'),
      client.get('/api/goals'),
      client.get('/api/habits'),
    ]);

    if (eventRes.data?.success && eventRes.data?.data) {
      for (const event of eventRes.data.data) {
        await db.events.put({
          id: event.id,
          userId: event.userId,
          title: event.title,
          description: event.description || null,
          startTime: event.startTime,
          endTime: event.endTime || null,
          isAllDay: event.isAllDay || false,
          color: event.color || null,
          recurrence: event.recurrenceRule || null,
          goalId: event.goalId || null,
          reminderMinutes: event.reminderMinutes || 0,
          isCourse: event.isCourse || false,
          courseWeekStart: event.courseWeekStart || null,
          courseWeekEnd: event.courseWeekEnd || null,
          courseDayOfWeek: event.courseDayOfWeek || null,
          courseStartSec: event.courseStartSec || null,
          courseEndSec: event.courseEndSec || null,
          courseTeacher: event.courseTeacher || null,
          courseLocation: event.courseLocation || null,
          courseAdjust: event.courseAdjust || null,
          courseWeekType: event.courseWeekType || null,
          courseSemesterStart: event.courseSemesterStart || null,
          courseTimeConfig: event.courseTimeConfig || null,
          createdAt: event.createdAt,
          updatedAt: event.updatedAt || event.createdAt,
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
          description: goal.description || null,
          status: goal.status,
          progress: goal.progress,
          deadline: goal.deadline || null,
          aiBreakdown: goal.aiBreakdown ? JSON.stringify(goal.aiBreakdown) : null,
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
          description: habit.description || null,
          frequency: habit.frequency,
          targetDays: habit.targetDays,
          goalId: habit.goalId || null,
          streakCurrent: habit.streakCurrent,
          streakLongest: habit.streakLongest,
          createdAt: habit.createdAt,
          updatedAt: habit.updatedAt || habit.createdAt,
          _version: Date.now(),
          _synced: true,
        });
      }
    }
  } catch (error) {
    console.error('Pull remote data failed:', error);
  }
}

function getNextRetryDelay(retryCount: number): number {
  const idx = Math.min(retryCount, RETRY_DELAYS.length - 1);
  return RETRY_DELAYS[idx];
}

export async function processSyncQueue(): Promise<SyncResult> {
  const items = await getSyncQueue();
  let synced = 0;
  let failed = 0;
  const now = Date.now();
  const pending = items.filter((i) => i.retryCount === 0 && !i.lastError).length;

  for (const item of items) {
    if (item.lastError && item.retryCount >= MAX_RETRIES) continue;

    if (item.nextRetryAt && item.nextRetryAt > now) continue;

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
      const nextRetryAt = Date.now() + getNextRetryDelay(newRetryCount);

      if (newRetryCount >= MAX_RETRIES) {
        await db.syncQueue.update(item.id!, {
          retryCount: newRetryCount,
          lastError: (error as Error).message,
          nextRetryAt: null,
        });
        failed++;
      } else {
        await db.syncQueue.update(item.id!, {
          retryCount: newRetryCount,
          lastError: (error as Error).message,
          nextRetryAt,
        });
      }
    }
  }

  return { synced, failed, pending };
}
