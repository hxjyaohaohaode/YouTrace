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
    weekType?: string;
    adjustments: Array<{ week: number; dayOfWeek: number; startSection: number; endSection: number; location?: string }>;
  }>;
  semesterStart: string;
  color?: string;
  sectionTimes?: Array<{ start: string; end: string }>;
}

const DEFAULT_SECTION_TIMES: Array<{ start: string; end: string }> = [
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

function getSectionTime(section: number, sectionTimes: Array<{ start: string; end: string }>): { startHour: number; startMin: number; endHour: number; endMin: number } {
  const startIdx = Math.max(0, Math.min(section - 1, sectionTimes.length - 1));
  const endIdx = Math.max(0, Math.min(section - 1, sectionTimes.length - 1));
  const [sh, sm] = sectionTimes[startIdx].start.split(':').map(Number);
  const [eh, em] = sectionTimes[endIdx].end.split(':').map(Number);
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

function shouldIncludeWeek(week: number, weekType: string): boolean {
  if (weekType === 'ODD') return week % 2 === 1;
  if (weekType === 'EVEN') return week % 2 === 0;
  return true;
}

interface HolidayInfo {
  name: string;
  date: string;
  type: 'HOLIDAY' | 'WORKDAY';
  description: string;
}

function getChineseHolidays(year: number): HolidayInfo[] {
  const holidays: HolidayInfo[] = [];

  const addHolidayDays = (base: string, count: number, name: string, desc: string) => {
    const baseDate = new Date(base + 'T00:00:00');
    for (let i = 0; i < count; i++) {
      const d = new Date(baseDate.getTime() + i * 86400000);
      holidays.push({ name, date: d.toISOString().slice(0, 10), type: 'HOLIDAY', description: desc });
    }
  };

  const addWorkday = (date: string, name: string, desc: string) => {
    holidays.push({ name, date, type: 'WORKDAY', description: desc });
  };

  if (year === 2025) {
    addHolidayDays('2025-01-01', 1, '元旦', '1月1日放假1天');
    addWorkday('2025-01-26', '春节调休', '春节前周日上班');
    addHolidayDays('2025-01-28', 8, '春节', '1月28日至2月4日放假调休，共8天');
    addWorkday('2025-02-08', '春节调休', '春节后周六上班');
    addHolidayDays('2025-04-04', 3, '清明节', '4月4日至6日放假调休，共3天');
    addWorkday('2025-04-07', '清明节调休', '清明节后周一上班');
    addHolidayDays('2025-05-01', 5, '劳动节', '5月1日至5日放假调休，共5天');
    addWorkday('2025-04-27', '劳动节调休', '劳动节前周日上班');
    addHolidayDays('2025-05-31', 3, '端午节', '5月31日至6月2日放假调休，共3天');
    addWorkday('2025-06-03', '端午节调休', '端午节后周二上班');
    addHolidayDays('2025-10-01', 8, '国庆节/中秋节', '10月1日至8日放假调休，共8天');
    addWorkday('2025-09-28', '国庆节调休', '国庆节前周日上班');
    addWorkday('2025-10-11', '国庆节调休', '国庆节后周六上班');
  } else if (year === 2026) {
    addHolidayDays('2026-01-01', 3, '元旦', '1月1日至3日放假调休，共3天');
    addWorkday('2025-12-27', '元旦调休', '元旦前周六上班');
    addHolidayDays('2026-02-16', 7, '春节', '2月16日至22日放假调休，共7天');
    addWorkday('2026-02-14', '春节调休', '春节前周六上班');
    addWorkday('2026-02-23', '春节调休', '春节后周一上班');
    addHolidayDays('2026-04-04', 3, '清明节', '4月4日至6日放假调休，共3天');
    addWorkday('2026-04-07', '清明节调休', '清明节后周二上班');
    addHolidayDays('2026-05-01', 5, '劳动节', '5月1日至5日放假调休，共5天');
    addWorkday('2026-04-26', '劳动节调休', '劳动节前周日上班');
    addWorkday('2026-05-06', '劳动节调休', '劳动节后周三上班');
    addHolidayDays('2026-06-19', 3, '端午节', '6月19日至21日放假调休，共3天');
    addWorkday('2026-06-22', '端午节调休', '端午节后周一上班');
    addHolidayDays('2026-09-25', 3, '中秋节', '9月25日至27日放假调休，共3天');
    addWorkday('2026-09-28', '中秋节调休', '中秋节后周一上班');
    addHolidayDays('2026-10-01', 7, '国庆节', '10月1日至7日放假调休，共7天');
    addWorkday('2026-09-27', '国庆节调休', '国庆节前周日上班');
    addWorkday('2026-10-10', '国庆节调休', '国庆节后周六上班');
  } else if (year === 2027) {
    addHolidayDays('2027-01-01', 3, '元旦', '1月1日至3日放假调休，共3天');
    addWorkday('2026-12-26', '元旦调休', '元旦前周六上班');
    addHolidayDays('2027-02-06', 7, '春节', '2月6日至12日放假调休，共7天');
    addWorkday('2027-02-04', '春节调休', '春节前周四上班');
    addWorkday('2027-02-13', '春节调休', '春节后周六上班');
    addHolidayDays('2027-04-03', 3, '清明节', '4月3日至5日放假调休，共3天');
    addWorkday('2027-04-06', '清明节调休', '清明节后周二上班');
    addHolidayDays('2027-05-01', 5, '劳动节', '5月1日至5日放假调休，共5天');
    addWorkday('2027-04-25', '劳动节调休', '劳动节前周日上班');
    addWorkday('2027-05-06', '劳动节调休', '劳动节后周四上班');
    addHolidayDays('2027-06-09', 3, '端午节', '6月9日至11日放假调休，共3天');
    addWorkday('2027-06-12', '端午节调休', '端午节后周六上班');
    addHolidayDays('2027-09-15', 3, '中秋节', '9月15日至17日放假调休，共3天');
    addWorkday('2027-09-18', '中秋节调休', '中秋节后周六上班');
    addHolidayDays('2027-10-01', 7, '国庆节', '10月1日至7日放假调休，共7天');
    addWorkday('2027-09-26', '国庆节调休', '国庆节前周日上班');
    addWorkday('2027-10-09', '国庆节调休', '国庆节后周六上班');
  } else {
    addHolidayDays(`${year}-01-01`, 1, '元旦', '1月1日放假1天');

    const springFestivalDates: Record<number, string> = {
      2028: '2028-01-26', 2029: '2029-02-13', 2030: '2030-02-03',
    };
    const sf = springFestivalDates[year];
    if (sf) {
      const sfStart = new Date(sf + 'T00:00:00');
      sfStart.setDate(sfStart.getDate() - 1);
      addHolidayDays(sfStart.toISOString().slice(0, 10), 7, '春节', '春节放假调休，共7天');
    }

    const qingmingDates: Record<number, string> = {
      2028: '2028-04-04', 2029: '2029-04-04', 2030: '2030-04-05',
    };
    const qm = qingmingDates[year];
    if (qm) {
      addHolidayDays(qm, 1, '清明节', '清明节放假1天');
    }

    addHolidayDays(`${year}-05-01`, 1, '劳动节', '5月1日放假1天');

    const duanwuDates: Record<number, string> = {
      2028: '2028-05-28', 2029: '2029-05-16', 2030: '2030-06-05',
    };
    const dw = duanwuDates[year];
    if (dw) {
      addHolidayDays(dw, 1, '端午节', '端午节放假1天');
    }

    const zhongqiuDates: Record<number, string> = {
      2028: '2028-10-03', 2029: '2029-09-22', 2030: '2030-09-12',
    };
    const zq = zhongqiuDates[year];
    if (zq) {
      addHolidayDays(zq, 1, '中秋节', '中秋节放假1天');
    }

    addHolidayDays(`${year}-10-01`, 3, '国庆节', '10月1日至3日放假');
  }

  return holidays;
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
      "weekType": "ALL"或"ODD"或"EVEN",
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
- 如果课表上标注了"单周"，weekType设为"ODD"；标注了"双周"，weekType设为"EVEN"；否则为"ALL"
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
    const { courses, semesterStart, color, sectionTimes } = request.body;

    if (!courses || !Array.isArray(courses) || courses.length === 0) {
      return reply.status(400).send({ success: false, message: '请提供课程列表' });
    }

    if (!semesterStart) {
      return reply.status(400).send({ success: false, message: '请提供学期开始日期' });
    }

    const effectiveSectionTimes = sectionTimes && sectionTimes.length > 0 ? sectionTimes : DEFAULT_SECTION_TIMES;
    const createdEvents = [];

    for (const course of courses) {
      const weekType = course.weekType || 'ALL';

      for (let week = course.weekStart; week <= course.weekEnd; week++) {
        if (!shouldIncludeWeek(week, weekType)) continue;

        const adjustment = course.adjustments?.find((a) => a.week === week);
        const effectiveDay = adjustment?.dayOfWeek || course.dayOfWeek;
        const effectiveStartSec = adjustment?.startSection || course.startSection;
        const effectiveEndSec = adjustment?.endSection || course.endSection;
        const effectiveLocation = adjustment?.location || course.location;

        const startSecTime = getSectionTime(effectiveStartSec, effectiveSectionTimes);
        const endSecTime = getSectionTime(effectiveEndSec, effectiveSectionTimes);

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
            courseWeekType: weekType,
            courseSemesterStart: semesterStart,
            courseTimeConfig: JSON.stringify(effectiveSectionTimes),
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
            title: h.type === 'WORKDAY' ? `⚡${h.name}` : h.name,
            startTime: new Date(h.date),
            endTime: new Date(h.date),
            isAllDay: true,
            color: h.type === 'WORKDAY' ? 'orange' : 'red',
            isHoliday: true,
            holidayName: h.name,
            holidayType: h.type,
            holidayDescription: h.description,
          },
        });
        created.push(event);
      }
    }

    return reply.send({
      success: true,
      data: { added: created.length, total: holidays.length },
      message: `已添加${created.length}个节假日/调休日`,
    });
  });

  fastify.get<{ Querystring: { year: number } }>('/api/schedule/holidays/list', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { year } = request.query;
    if (!year) {
      return reply.status(400).send({ success: false, message: '请提供年份' });
    }

    const holidays = getChineseHolidays(year);
    return reply.send({ success: true, data: holidays });
  });
};

export default scheduleRoutes;
