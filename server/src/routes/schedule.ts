import { FastifyPluginAsync } from 'fastify';
import prisma from '../utils/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { callAI, getProvider } from '../services/aiService.js';

interface RecognizeScheduleBody {
  attachmentId: string;
  semesterStart: string;
  weekCount: number;
}

interface BatchCreateBody {
  courses: Array<{
    title: string;
    teacher: string;
    location: string;
    dayOfWeek: number;
    startSection: number;
    endSection: number;
    weekStart: number;
    weekEnd: number;
    adjustments: Array<{ week: number; dayOfWeek: number; startSection: number; endSection: number; location?: string }>;
  }>;
  semesterStart: string;
  color?: string;
}

const SECTION_TIMES: Array<{ start: string; end: string }> = [
  { start: '08:00', end: '08:45' },
  { start: '08:55', end: '09:40' },
  { start: '10:00', end: '10:45' },
  { start: '10:55', end: '11:40' },
  { start: '14:00', end: '14:45' },
  { start: '14:55', end: '15:40' },
  { start: '16:00', end: '16:45' },
  { start: '16:55', end: '17:40' },
  { start: '19:00', end: '19:45' },
  { start: '19:55', end: '20:40' },
  { start: '20:50', end: '21:35' },
  { start: '21:45', end: '22:30' },
];

function getSectionTime(section: number): { startHour: number; startMin: number; endHour: number; endMin: number } {
  const startIdx = Math.max(0, Math.min(section - 1, SECTION_TIMES.length - 1));
  const endIdx = Math.max(0, Math.min(section - 1, SECTION_TIMES.length - 1));
  const [sh, sm] = SECTION_TIMES[startIdx].start.split(':').map(Number);
  const [eh, em] = SECTION_TIMES[endIdx].end.split(':').map(Number);
  return { startHour: sh, startMin: sm, endHour: eh, endMin: em };
}

function getDateForWeekDay(semesterStart: string, week: number, dayOfWeek: number): Date {
  const start = new Date(semesterStart + 'T00:00:00');
  const startDay = start.getDay();
  const startDayMon = startDay === 0 ? 7 : startDay;
  const offsetToMonday = 1 - startDayMon;
  const mondayOfWeek1 = new Date(start.getTime() + offsetToMonday * 86400000);
  const targetOffset = (week - 1) * 7 + (dayOfWeek - 1);
  return new Date(mondayOfWeek1.getTime() + targetOffset * 86400000);
}

const scheduleRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: RecognizeScheduleBody }>('/api/schedule/recognize', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { attachmentId, semesterStart, weekCount } = request.body;

    if (!attachmentId || !semesterStart || !weekCount) {
      return reply.status(400).send({ success: false, message: '请提供附件ID、学期开始日期和周数' });
    }

    const attachment = await prisma.attachment.findFirst({
      where: { id: attachmentId, userId: request.userId },
    });

    if (!attachment) {
      return reply.status(404).send({ success: false, message: '附件不存在' });
    }

    if (attachment.fileType !== 'image') {
      return reply.status(400).send({ success: false, message: '仅支持图片类型的课表识别' });
    }

    const provider = getProvider();
    if (provider === 'local') {
      return reply.status(400).send({ success: false, message: '需要配置AI服务才能识别课表' });
    }

    try {
      const prompt = `你是一个课表识别专家。请根据以下图片描述，识别出课表中的所有课程信息。

图片内容描述：
${attachment.aiAnnotation}

请将识别结果以JSON格式返回，格式如下：
{
  "courses": [
    {
      "title": "课程名称",
      "teacher": "教师姓名",
      "location": "上课地点",
      "dayOfWeek": 1-7（1=周一，7=周日）,
      "startSection": 开始节次（从1开始）,
      "endSection": 结束节次,
      "weekStart": 起始周次,
      "weekEnd": 结束周次,
      "adjustments": [
        {"week": 调课周次, "dayOfWeek": 调课后的星期, "startSection": 调课后开始节次, "endSection": 调课后结束节次, "location": "调课后地点(可选)"}
      ]
    }
  ]
}

注意事项：
- 节次从1开始，第1节=08:00-08:45，第2节=08:55-09:40，第3节=10:00-10:45，第4节=10:55-11:40
- 第5节=14:00-14:45，第6节=14:55-15:40，第7节=16:00-16:45，第8节=16:55-17:40
- 第9节=19:00-19:45，第10节=19:55-20:40，第11节=20:50-21:35，第12节=21:45-22:30
- 如果课表上标注了"单周"或"双周"，请正确设置weekStart和weekEnd
- 如果有调课信息，请添加到adjustments数组中
- 如果无法识别某字段，设为null
- 只返回JSON，不要其他内容`;

      const result = await callAI(prompt, provider);
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return reply.status(422).send({ success: false, message: 'AI无法识别课表内容' });
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return reply.send({
        success: true,
        data: {
          courses: parsed.courses || [],
          semesterStart,
          weekCount,
        },
      });
    } catch (e) {
      return reply.status(500).send({ success: false, message: `课表识别失败: ${(e as Error).message}` });
    }
  });

  fastify.post<{ Body: BatchCreateBody }>('/api/schedule/batch-create', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { courses, semesterStart, color } = request.body;

    if (!courses || !Array.isArray(courses) || courses.length === 0) {
      return reply.status(400).send({ success: false, message: '请提供课程列表' });
    }

    if (!semesterStart) {
      return reply.status(400).send({ success: false, message: '请提供学期开始日期' });
    }

    const createdEvents = [];

    for (const course of courses) {
      for (let week = course.weekStart; week <= course.weekEnd; week++) {
        const adjustment = course.adjustments?.find((a) => a.week === week);
        const effectiveDay = adjustment?.dayOfWeek || course.dayOfWeek;
        const effectiveStartSec = adjustment?.startSection || course.startSection;
        const effectiveEndSec = adjustment?.endSection || course.endSection;
        const effectiveLocation = adjustment?.location || course.location;

        const startSecTime = getSectionTime(effectiveStartSec);
        const endSecTime = getSectionTime(effectiveEndSec);

        const baseDate = getDateForWeekDay(semesterStart, week, effectiveDay);
        const startTime = new Date(
          baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(),
          startSecTime.startHour, startSecTime.startMin
        );
        const endTime = new Date(
          baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(),
          endSecTime.endHour, endSecTime.endMin
        );

        const event = await prisma.event.create({
          data: {
            userId: request.userId!,
            title: course.title,
            description: `${course.teacher ? '教师: ' + course.teacher : ''}${effectiveLocation ? ' | 地点: ' + effectiveLocation : ''}`.trim(),
            startTime,
            endTime,
            isAllDay: false,
            color: color || 'purple',
            isAiCreated: true,
            isCourse: true,
            courseWeekStart: course.weekStart,
            courseWeekEnd: course.weekEnd,
            courseDayOfWeek: effectiveDay,
            courseStartSec: effectiveStartSec,
            courseEndSec: effectiveEndSec,
            courseTeacher: course.teacher,
            courseLocation: effectiveLocation,
            courseAdjust: JSON.stringify(course.adjustments || []),
          },
        });

        createdEvents.push(event);
      }
    }

    return reply.send({
      success: true,
      data: { createdCount: createdEvents.length, events: createdEvents },
      message: `成功创建${createdEvents.length}个课表日程`,
    });
  });

  fastify.post<{ Body: { year: number } }>('/api/schedule/holidays', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { year } = request.body;
    if (!year) {
      return reply.status(400).send({ success: false, message: '请提供年份' });
    }

    const holidays = getChineseHolidays(year);

    const created = [];
    for (const h of holidays) {
      const existing = await prisma.event.findFirst({
        where: {
          userId: request.userId!,
          isHoliday: true,
          holidayName: h.name,
          startTime: new Date(h.date),
        },
      });

      if (!existing) {
        const event = await prisma.event.create({
          data: {
            userId: request.userId!,
            title: h.name,
            startTime: new Date(h.date),
            endTime: new Date(h.date),
            isAllDay: true,
            color: 'red',
            isHoliday: true,
            holidayName: h.name,
          },
        });
        created.push(event);
      }
    }

    return reply.send({
      success: true,
      data: { added: created.length, total: holidays.length },
      message: `已添加${created.length}个法定节假日`,
    });
  });
};

function getChineseHolidays(year: number): Array<{ name: string; date: string }> {
  const holidays: Array<{ name: string; date: string }> = [];

  const addDays = (base: string, count: number, name: string) => {
    const baseDate = new Date(base + 'T00:00:00');
    for (let i = 0; i < count; i++) {
      const d = new Date(baseDate.getTime() + i * 86400000);
      holidays.push({ name, date: d.toISOString().slice(0, 10) });
    }
  };

  addDays(`${year}-01-01`, 1, '元旦');

  const springFestivalDates: Record<number, string> = {
    2025: '2025-01-29', 2026: '2026-02-17', 2027: '2027-02-06',
    2028: '2028-01-26', 2029: '2029-02-13', 2030: '2030-02-03',
  };
  const sf = springFestivalDates[year];
  if (sf) {
    const sfStart = new Date(sf + 'T00:00:00');
    sfStart.setDate(sfStart.getDate() - 1);
    addDays(sfStart.toISOString().slice(0, 10), 7, '春节');
  }

  const qingmingDates: Record<number, string> = {
    2025: '2025-04-04', 2026: '2026-04-05', 2027: '2027-04-05',
    2028: '2028-04-04', 2029: '2029-04-04', 2030: '2030-04-05',
  };
  const qm = qingmingDates[year];
  if (qm) {
    addDays(qm, 1, '清明节');
  }

  addDays(`${year}-05-01`, 1, '劳动节');

  const duanwuDates: Record<number, string> = {
    2025: '2025-05-31', 2026: '2026-06-19', 2027: '2027-06-09',
    2028: '2028-05-28', 2029: '2029-05-16', 2030: '2030-06-05',
  };
  const dw = duanwuDates[year];
  if (dw) {
    addDays(dw, 1, '端午节');
  }

  const zhongqiuDates: Record<number, string> = {
    2025: '2025-10-06', 2026: '2026-09-25', 2027: '2027-09-15',
    2028: '2028-10-03', 2029: '2029-09-22', 2030: '2030-09-12',
  };
  const zq = zhongqiuDates[year];
  if (zq) {
    addDays(zq, 1, '中秋节');
  }

  addDays(`${year}-10-01`, 3, '国庆节');

  return holidays;
}

export default scheduleRoutes;
