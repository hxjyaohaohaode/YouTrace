import { FastifyPluginAsync } from 'fastify';
import prisma from '../utils/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { eventToLocalISO } from '../utils/date.js';

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

interface RawEvent {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  recurrenceRule: string | null;
  goalId: string | null;
  reminderMinutes: number;
  color: string | null;
  isCourse: boolean;
  courseWeekStart: number | null;
  courseWeekEnd: number | null;
  courseDayOfWeek: number | null;
  courseStartSec: number | null;
  courseEndSec: number | null;
  courseTeacher: string | null;
  courseLocation: string | null;
  courseAdjust: string | null;
  courseWeekType: string | null;
  courseSemesterStart: string | null;
  courseTimeConfig: string | null;
  isHoliday: boolean;
  holidayType: string | null;
  holidayDescription: string | null;
  isAiCreated: boolean;
  createdAt: Date;
  updatedAt: Date;
  goal: { id: string; title: string } | null;
}

function expandCourseEvents(events: RawEvent[], rangeStart: Date, rangeEnd: Date): RawEvent[] {
  const result: RawEvent[] = [];

  for (const event of events) {
    if (!event.isCourse || !event.courseSemesterStart || !event.courseDayOfWeek) {
      result.push(event);
      continue;
    }

    const semesterStart = new Date(event.courseSemesterStart + 'T00:00:00');
    const startDay = semesterStart.getDay();
    const startDayMon = startDay === 0 ? 7 : startDay;
    const offsetToMonday = 1 - startDayMon;
    const mondayOfWeek1 = new Date(semesterStart.getTime() + offsetToMonday * 86400000);

    const weekStart = event.courseWeekStart || 1;
    const weekEnd = event.courseWeekEnd || 16;
    const dayOfWeek = event.courseDayOfWeek;
    const weekType = event.courseWeekType || 'ALL';

    const origStart = event.startTime;
    const origEnd = event.endTime;
    const startHour = origStart.getHours();
    const startMin = origStart.getMinutes();
    const endHour = origEnd.getHours();
    const endMin = origEnd.getMinutes();

    for (let week = weekStart; week <= weekEnd; week++) {
      if (weekType === 'ODD' && week % 2 === 0) continue;
      if (weekType === 'EVEN' && week % 2 === 1) continue;

      const targetOffset = (week - 1) * 7 + (dayOfWeek - 1);
      const targetDate = new Date(mondayOfWeek1.getTime() + targetOffset * 86400000);

      const instanceStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), startHour, startMin);
      const instanceEnd = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), endHour, endMin);

      if (instanceStart > rangeEnd || instanceEnd < rangeStart) continue;

      result.push({
        ...event,
        id: `${event.id}_w${week}`,
        startTime: instanceStart,
        endTime: instanceEnd,
      });
    }
  }

  return result;
}

const eventRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: EventQuery }>('/api/events', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { start, end } = request.query;
    const where: Record<string, unknown> = { userId: request.userId };

    let rangeStart = start ? new Date(start) : new Date(Date.now() - 90 * 86400000);
    let rangeEnd = end ? new Date(end) : new Date(Date.now() + 90 * 86400000);

    if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      const courseBufferStart = new Date(startDate.getTime() - 180 * 86400000);
      const courseBufferEnd = new Date(endDate.getTime() + 180 * 86400000);

      where.OR = [
        { startTime: { gte: courseBufferStart, lte: courseBufferEnd } },
        { endTime: { gte: courseBufferStart, lte: courseBufferEnd } },
        { startTime: { lte: courseBufferStart }, endTime: { gte: courseBufferEnd } },
      ];
    } else if (start) {
      where.startTime = { gte: new Date(start) };
    }

    const events = await prisma.event.findMany({
      where,
      orderBy: { startTime: 'asc' },
      include: { goal: { select: { id: true, title: true } } },
    });

    const expandedEvents = expandCourseEvents(events as unknown as RawEvent[], rangeStart, rangeEnd);

    return reply.send({ success: true, data: expandedEvents.map((e) => eventToLocalISO(e as unknown as Record<string, unknown>)) });
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
      data: { ...eventToLocalISO(event as unknown as Record<string, unknown>), hasConflict, conflicts },
      message: hasConflict ? '日程创建成功，但存在时间冲突' : '日程创建成功',
    });
  });

  fastify.put<{ Params: { id: string }; Body: UpdateEventBody }>('/api/events/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    let { id } = request.params;
    const body = request.body;

    if (id.includes('_w')) {
      id = id.split('_w')[0];
    }

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
      data: { ...eventToLocalISO(event as unknown as Record<string, unknown>), hasConflict, conflicts },
      message: '日程更新成功',
    });
  });

  fastify.delete<{ Params: { id: string } }>('/api/events/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    let { id } = request.params;

    if (id.includes('_w')) {
      id = id.split('_w')[0];
    }

    const existing = await prisma.event.findFirst({ where: { id, userId: request.userId } });
    if (!existing) {
      return reply.status(404).send({ success: false, message: '日程不存在' });
    }

    await prisma.event.delete({ where: { id } });

    return reply.send({ success: true, message: '日程已删除' });
  });
};

export default eventRoutes;
