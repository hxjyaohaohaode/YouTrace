import { FastifyPluginAsync } from 'fastify';
import prisma from '../utils/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

interface CreateEventBody {
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  isAllDay?: boolean;
  recurrenceRule?: string;
  goalId?: string;
  reminderMinutes?: number;
  color?: string;
  isCourse?: boolean;
  courseWeekStart?: number;
  courseWeekEnd?: number;
  courseDayOfWeek?: number;
  courseStartSec?: number;
  courseEndSec?: number;
  courseTeacher?: string;
  courseLocation?: string;
  courseAdjust?: string;
  courseWeekType?: string;
  courseSemesterStart?: string;
  courseTimeConfig?: string;
}

interface UpdateEventBody {
  title?: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  isAllDay?: boolean;
  recurrenceRule?: string;
  goalId?: string;
  reminderMinutes?: number;
  color?: string;
  isCourse?: boolean;
  courseWeekStart?: number;
  courseWeekEnd?: number;
  courseDayOfWeek?: number;
  courseStartSec?: number;
  courseEndSec?: number;
  courseTeacher?: string;
  courseLocation?: string;
  courseAdjust?: string;
  courseWeekType?: string;
  courseSemesterStart?: string;
  courseTimeConfig?: string;
}

interface EventQuery {
  start?: string;
  end?: string;
}

function checkConflict(
  newStart: Date,
  newEnd: Date,
  existingEvents: { id: string; startTime: Date; endTime: Date; isAllDay: boolean; title: string }[],
  excludeId?: string
): { hasConflict: boolean; conflicts: { id: string; title: string; startTime: Date; endTime: Date }[] } {
  const conflicts = existingEvents
    .filter((e) => e.id !== excludeId && !e.isAllDay)
    .filter((e) => newStart < e.endTime && newEnd > e.startTime);

  return { hasConflict: conflicts.length > 0, conflicts };
}

const eventRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: EventQuery }>('/api/events', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { start, end } = request.query;
    const where: Record<string, unknown> = { userId: request.userId };

    if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      where.OR = [
        { startTime: { gte: startDate, lte: endDate } },
        { endTime: { gte: startDate, lte: endDate } },
        { startTime: { lte: startDate }, endTime: { gte: endDate } },
      ];
    } else if (start) {
      where.startTime = { gte: new Date(start) };
    }

    const events = await prisma.event.findMany({
      where,
      orderBy: { startTime: 'asc' },
      include: { goal: { select: { id: true, title: true } } },
    });

    return reply.send({ success: true, data: events });
  });

  fastify.post<{ Body: CreateEventBody }>('/api/events', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { title, description, startTime, endTime, isAllDay, recurrenceRule, goalId, reminderMinutes, color,
      isCourse, courseWeekStart, courseWeekEnd, courseDayOfWeek, courseStartSec, courseEndSec, courseTeacher, courseLocation, courseAdjust,
      courseWeekType, courseSemesterStart, courseTimeConfig } = request.body;

    if (!title || !startTime || !endTime) {
      return reply.status(400).send({ success: false, message: '请提供标题、开始和结束时间' });
    }

    const newStart = new Date(startTime);
    const newEnd = new Date(endTime);

    const existingEvents = await prisma.event.findMany({
      where: {
        userId: request.userId,
        OR: [
          { startTime: { gte: newStart, lte: newEnd } },
          { endTime: { gte: newStart, lte: newEnd } },
          { startTime: { lte: newStart }, endTime: { gte: newEnd } },
        ],
      },
      select: { id: true, startTime: true, endTime: true, isAllDay: true, title: true },
    });

    const { hasConflict, conflicts } = checkConflict(newStart, newEnd, existingEvents);

    const event = await prisma.event.create({
      data: {
        userId: request.userId!,
        title,
        description: description || null,
        startTime: newStart,
        endTime: newEnd,
        isAllDay: isAllDay || false,
        recurrenceRule: recurrenceRule || null,
        goalId: goalId || null,
        reminderMinutes: reminderMinutes || 0,
        color: color || null,
        isCourse: isCourse || false,
        courseWeekStart: courseWeekStart || null,
        courseWeekEnd: courseWeekEnd || null,
        courseDayOfWeek: courseDayOfWeek || null,
        courseStartSec: courseStartSec || null,
        courseEndSec: courseEndSec || null,
        courseTeacher: courseTeacher || null,
        courseLocation: courseLocation || null,
        courseAdjust: courseAdjust || '{}',
        courseWeekType: courseWeekType || 'ALL',
        courseSemesterStart: courseSemesterStart || null,
        courseTimeConfig: courseTimeConfig || '{}',
      },
      include: { goal: { select: { id: true, title: true } } },
    });

    return reply.status(201).send({
      success: true,
      data: { ...event, hasConflict, conflicts },
      message: hasConflict ? '日程创建成功，但存在时间冲突' : '日程创建成功',
    });
  });

  fastify.put<{ Params: { id: string }; Body: UpdateEventBody }>('/api/events/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;

    const existing = await prisma.event.findFirst({ where: { id, userId: request.userId } });
    if (!existing) {
      return reply.status(404).send({ success: false, message: '日程不存在' });
    }

    const updateData: Record<string, unknown> = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.startTime !== undefined) updateData.startTime = new Date(body.startTime);
    if (body.endTime !== undefined) updateData.endTime = new Date(body.endTime);
    if (body.isAllDay !== undefined) updateData.isAllDay = body.isAllDay;
    if (body.recurrenceRule !== undefined) updateData.recurrenceRule = body.recurrenceRule;
    if (body.goalId !== undefined) updateData.goalId = body.goalId;
    if (body.reminderMinutes !== undefined) updateData.reminderMinutes = body.reminderMinutes;
    if (body.color !== undefined) updateData.color = body.color;
    if (body.isCourse !== undefined) updateData.isCourse = body.isCourse;
    if (body.courseWeekStart !== undefined) updateData.courseWeekStart = body.courseWeekStart;
    if (body.courseWeekEnd !== undefined) updateData.courseWeekEnd = body.courseWeekEnd;
    if (body.courseDayOfWeek !== undefined) updateData.courseDayOfWeek = body.courseDayOfWeek;
    if (body.courseStartSec !== undefined) updateData.courseStartSec = body.courseStartSec;
    if (body.courseEndSec !== undefined) updateData.courseEndSec = body.courseEndSec;
    if (body.courseTeacher !== undefined) updateData.courseTeacher = body.courseTeacher;
    if (body.courseLocation !== undefined) updateData.courseLocation = body.courseLocation;
    if (body.courseAdjust !== undefined) updateData.courseAdjust = body.courseAdjust;
    if (body.courseWeekType !== undefined) updateData.courseWeekType = body.courseWeekType;
    if (body.courseSemesterStart !== undefined) updateData.courseSemesterStart = body.courseSemesterStart;
    if (body.courseTimeConfig !== undefined) updateData.courseTimeConfig = body.courseTimeConfig;

    const finalStart = updateData.startTime ? new Date(body.startTime as string) : existing.startTime;
    const finalEnd = updateData.endTime ? new Date(body.endTime as string) : existing.endTime;

    const allEvents = await prisma.event.findMany({
      where: {
        userId: request.userId,
        id: { not: id },
        OR: [
          { startTime: { gte: finalStart, lte: finalEnd } },
          { endTime: { gte: finalStart, lte: finalEnd } },
          { startTime: { lte: finalStart }, endTime: { gte: finalEnd } },
        ],
      },
      select: { id: true, startTime: true, endTime: true, isAllDay: true, title: true },
    });

    const { hasConflict, conflicts } = checkConflict(finalStart, finalEnd, allEvents, id);

    const event = await prisma.event.update({
      where: { id },
      data: updateData,
      include: { goal: { select: { id: true, title: true } } },
    });

    return reply.send({
      success: true,
      data: { ...event, hasConflict, conflicts },
      message: '日程更新成功',
    });
  });

  fastify.delete<{ Params: { id: string } }>('/api/events/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.event.findFirst({ where: { id, userId: request.userId } });
    if (!existing) {
      return reply.status(404).send({ success: false, message: '日程不存在' });
    }

    await prisma.event.delete({ where: { id } });

    return reply.send({ success: true, message: '日程已删除' });
  });
};

export default eventRoutes;
