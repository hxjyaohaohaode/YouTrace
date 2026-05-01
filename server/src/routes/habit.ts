import { FastifyPluginAsync } from 'fastify';
import prisma from '../utils/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

interface CreateHabitBody {
  title: string;
  description?: string;
  frequency?: string;
  targetDays?: number;
  goalId?: string;
}

interface UpdateHabitBody {
  title?: string;
  description?: string;
  frequency?: string;
  targetDays?: number;
  goalId?: string;
}

interface ToggleBody {
  note?: string;
  date?: string;
}

function dateOnly(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function recalcStreak(habitId: string): Promise<{ streakCurrent: number; streakLongest: number }> {
  const logs = await prisma.habitLog.findMany({
    where: { habitId, isCompleted: true },
    orderBy: { logDate: 'desc' },
  });

  if (logs.length === 0) {
    await prisma.habit.update({ where: { id: habitId }, data: { streakCurrent: 0 } });
    return { streakCurrent: 0, streakLongest: 0 };
  }

  const habit = await prisma.habit.findUnique({ where: { id: habitId } });
  if (!habit) return { streakCurrent: 0, streakLongest: 0 };

  const logDates = [...new Set(logs.map((l) => dateOnly(l.logDate)))].sort().reverse();

  let currentStreak = 0;
  const today = dateOnly(new Date());
  const yesterday = dateOnly(new Date(Date.now() - 86400000));

  if (logDates[0] === today || logDates[0] === yesterday) {
    currentStreak = 1;
    for (let i = 1; i < logDates.length; i++) {
      const prev = new Date(logDates[i - 1]);
      const curr = new Date(logDates[i]);
      const diffDays = Math.round((prev.getTime() - curr.getTime()) / 86400000);
      if (diffDays === 1) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  let longestStreak = 0;
  let tempStreak = 1;
  const sortedAsc = [...logDates].sort();
  for (let i = 1; i < sortedAsc.length; i++) {
    const prev = new Date(sortedAsc[i - 1]);
    const curr = new Date(sortedAsc[i]);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);
    if (diffDays === 1) {
      tempStreak++;
    } else {
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 1;
    }
  }
  longestStreak = Math.max(longestStreak, tempStreak, currentStreak);

  await prisma.habit.update({
    where: { id: habitId },
    data: { streakCurrent: currentStreak, streakLongest: longestStreak },
  });

  return { streakCurrent: currentStreak, streakLongest: longestStreak };
}

const habitRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/habits', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const habits = await prisma.habit.findMany({
      where: { userId: request.userId },
      orderBy: { createdAt: 'desc' },
      include: {
        goal: { select: { id: true, title: true } },
        logs: {
          where: {
            logDate: {
              gte: new Date(Date.now() - 7 * 86400000),
            },
          },
          orderBy: { logDate: 'desc' },
        },
      },
    });

    const today = dateOnly(new Date());
    const result = habits.map((h) => ({
      ...h,
      todayCompleted: h.logs.some((l) => dateOnly(l.logDate) === today && l.isCompleted),
      recentLogs: h.logs.map((l) => ({
        date: dateOnly(l.logDate),
        isCompleted: l.isCompleted,
      })),
    }));

    return reply.send({ success: true, data: result });
  });

  fastify.post<{ Body: CreateHabitBody }>('/api/habits', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { title, description, frequency, targetDays, goalId } = request.body;

    if (!title) {
      return reply.status(400).send({ success: false, message: '请提供习惯标题' });
    }

    const habit = await prisma.habit.create({
      data: {
        userId: request.userId!,
        title,
        description: description || null,
        frequency: frequency || 'DAILY',
        targetDays: targetDays || 30,
        goalId: goalId || null,
      },
      include: { goal: { select: { id: true, title: true } } },
    });

    return reply.status(201).send({
      success: true,
      data: { ...habit, todayCompleted: false, recentLogs: [] },
      message: '习惯创建成功',
    });
  });

  fastify.put<{ Params: { id: string }; Body: UpdateHabitBody }>('/api/habits/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;

    const existing = await prisma.habit.findFirst({ where: { id, userId: request.userId } });
    if (!existing) {
      return reply.status(404).send({ success: false, message: '习惯不存在' });
    }

    const updateData: Record<string, unknown> = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.frequency !== undefined) {
      const validFrequencies = ['DAILY', 'WEEKLY', 'WEEKDAYS', 'CUSTOM'];
      if (!validFrequencies.includes(body.frequency)) {
        return reply.status(400).send({ success: false, message: `频率必须是 ${validFrequencies.join('/')}` });
      }
      updateData.frequency = body.frequency;
    }
    if (body.targetDays !== undefined) updateData.targetDays = body.targetDays;
    if (body.goalId !== undefined) updateData.goalId = body.goalId;

    const habit = await prisma.habit.update({
      where: { id },
      data: updateData,
      include: { goal: { select: { id: true, title: true } } },
    });

    return reply.send({ success: true, data: habit, message: '习惯更新成功' });
  });

  fastify.delete<{ Params: { id: string } }>('/api/habits/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.habit.findFirst({ where: { id, userId: request.userId } });
    if (!existing) {
      return reply.status(404).send({ success: false, message: '习惯不存在' });
    }

    await prisma.habit.delete({ where: { id } });

    return reply.send({ success: true, message: '习惯已删除' });
  });

  fastify.post<{ Params: { id: string }; Body: ToggleBody }>('/api/habits/:id/toggle', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const { note, date } = request.body || {};

    const habit = await prisma.habit.findFirst({ where: { id, userId: request.userId } });
    if (!habit) {
      return reply.status(404).send({ success: false, message: '习惯不存在' });
    }

    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);

    const existingLog = await prisma.habitLog.findFirst({
      where: { habitId: id, logDate: targetDate },
    });

    if (existingLog) {
      await prisma.habitLog.update({
        where: { id: existingLog.id },
        data: { isCompleted: !existingLog.isCompleted, note: note || existingLog.note },
      });
    } else {
      await prisma.habitLog.create({
        data: { habitId: id, logDate: targetDate, isCompleted: true, note: note || null },
      });
    }

    const { streakCurrent, streakLongest } = await recalcStreak(id);

    return reply.send({
      success: true,
      data: { streakCurrent, streakLongest },
      message: existingLog ? '打卡已取消' : '打卡成功',
    });
  });
};

export default habitRoutes;
