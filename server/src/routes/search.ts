import { FastifyPluginAsync } from 'fastify';
import prisma from '../utils/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

interface SearchQuery {
  q: string;
  categories?: string;
  date?: string;
  limit?: string;
}

interface SearchResultItem {
  id: string;
  type: string;
  title: string;
  content: string;
  highlight: string;
  date: string;
  extra?: Record<string, unknown>;
}

interface SearchCategoryResult {
  category: string;
  label: string;
  icon: string;
  items: SearchResultItem[];
  total: number;
}

function highlightText(text: string, keyword: string, maxLen: number = 120): string {
  if (!keyword || !text) return text.slice(0, maxLen);
  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const idx = lowerText.indexOf(lowerKeyword);
  if (idx === -1) return text.slice(0, maxLen) + (text.length > maxLen ? '...' : '');
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + keyword.length + 80);
  let snippet = '';
  if (start > 0) snippet += '...';
  snippet += text.slice(start, end);
  if (end < text.length) snippet += '...';
  return snippet;
}

const searchRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: SearchQuery }>('/api/search', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { q, categories, date, limit } = request.query;
    const keyword = (q || '').trim();
    const maxItems = Math.min(50, Math.max(1, parseInt(limit || '10')));
    const categoryList = categories ? categories.split(',').map(c => c.trim()).filter(Boolean) : [];
    const searchDate = date ? new Date(date) : null;

    if (!keyword && !searchDate) {
      return reply.send({ success: true, data: { results: [], total: 0 } });
    }

    const results: SearchCategoryResult[] = [];
    const userId = request.userId!;

    const shouldSearch = (cat: string) => categoryList.length === 0 || categoryList.includes(cat);

    if (searchDate && shouldSearch('day')) {
      const dayStart = new Date(searchDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(searchDate);
      dayEnd.setHours(23, 59, 59, 999);

      const [diaries, events, habitLogs, chatMessages] = await Promise.all([
        prisma.diary.findMany({
          where: { userId, isDeleted: false, createdAt: { gte: dayStart, lte: dayEnd } },
          orderBy: { createdAt: 'desc' },
          include: { attachments: { select: { id: true, originalName: true, fileType: true, aiAnnotation: true } } },
        }),
        prisma.event.findMany({
          where: { userId, startTime: { lte: dayEnd }, endTime: { gte: dayStart } },
          orderBy: { startTime: 'asc' },
          include: { goal: { select: { id: true, title: true } } },
        }),
        prisma.habitLog.findMany({
          where: { habit: { userId }, logDate: { gte: dayStart, lte: dayEnd } },
          include: { habit: { select: { title: true } } },
        }),
        prisma.chatMessage.findMany({
          where: { userId, createdAt: { gte: dayStart, lte: dayEnd } },
          orderBy: { createdAt: 'asc' },
          take: 20,
        }),
      ]);

      const dayItems: SearchResultItem[] = [];

      if (diaries.length > 0) {
        diaries.forEach(d => {
          dayItems.push({
            id: d.id,
            type: 'diary',
            title: `日记 - ${d.createdAt.toLocaleDateString('zh-CN')}`,
            content: d.content,
            highlight: keyword ? highlightText(d.content, keyword) : d.content.slice(0, 120),
            date: d.createdAt.toISOString(),
            extra: { emotionScore: d.emotionScore, emotionTags: JSON.parse(d.emotionTags), attachmentCount: d.attachments.length },
          });
        });
      }

      if (events.length > 0) {
        events.forEach(e => {
          const timeStr = e.isAllDay ? '全天' : `${new Date(e.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} - ${new Date(e.endTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
          dayItems.push({
            id: e.id,
            type: 'event',
            title: e.title,
            content: e.description || timeStr,
            highlight: `${timeStr}${e.description ? ' | ' + (keyword ? highlightText(e.description, keyword) : e.description.slice(0, 80)) : ''}`,
            date: e.startTime.toISOString(),
            extra: { time: timeStr, isCourse: e.isCourse, courseLocation: e.courseLocation, courseTeacher: e.courseTeacher },
          });
        });
      }

      if (habitLogs.length > 0) {
        habitLogs.forEach(l => {
          dayItems.push({
            id: l.habitId,
            type: 'habit',
            title: l.habit.title,
            content: l.note || (l.isCompleted ? '已完成' : '未完成'),
            highlight: l.isCompleted ? '✅ 已完成' : '❌ 未完成',
            date: l.logDate.toISOString(),
            extra: { isCompleted: l.isCompleted, note: l.note },
          });
        });
      }

      if (chatMessages.length > 0) {
        chatMessages.forEach(m => {
          dayItems.push({
            id: m.id,
            type: 'chat',
            title: m.role === 'user' ? '我的消息' : 'AI回复',
            content: m.content,
            highlight: keyword ? highlightText(m.content, keyword) : m.content.slice(0, 120),
            date: m.createdAt.toISOString(),
            extra: { role: m.role, conversationId: m.conversationId },
          });
        });
      }

      results.push({
        category: 'day',
        label: `${searchDate.toLocaleDateString('zh-CN')} 这一天`,
        icon: 'calendar',
        items: dayItems,
        total: dayItems.length,
      });
    }

    if (keyword && shouldSearch('diary')) {
      const diaries = await prisma.diary.findMany({
        where: {
          userId,
          isDeleted: false,
          OR: [
            { content: { contains: keyword, mode: 'insensitive' } },
            { aiInsight: { contains: keyword, mode: 'insensitive' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: maxItems,
        include: { attachments: { select: { id: true, originalName: true, fileType: true, aiAnnotation: true } } },
      });

      const items: SearchResultItem[] = diaries.map(d => ({
        id: d.id,
        type: 'diary',
        title: `日记 - ${d.createdAt.toLocaleDateString('zh-CN')}`,
        content: d.content,
        highlight: highlightText(d.content, keyword),
        date: d.createdAt.toISOString(),
        extra: { emotionScore: d.emotionScore, emotionTags: JSON.parse(d.emotionTags), aiInsight: d.aiInsight },
      }));

      results.push({
        category: 'diary',
        label: '日记',
        icon: 'diary',
        items,
        total: diaries.length,
      });
    }

    if (keyword && shouldSearch('attachment')) {
      const attachments = await prisma.attachment.findMany({
        where: {
          userId,
          OR: [
            { originalName: { contains: keyword, mode: 'insensitive' } },
            { aiAnnotation: { contains: keyword, mode: 'insensitive' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: maxItems,
      });

      const items: SearchResultItem[] = attachments.map(a => {
        const typeLabel = a.fileType === 'image' ? '图片' : a.fileType === 'video' ? '视频' : a.fileType === 'audio' ? '音频' : '文档';
        return {
          id: a.id,
          type: 'attachment',
          title: `${typeLabel} - ${a.originalName}`,
          content: a.aiAnnotation || a.originalName,
          highlight: highlightText(a.aiAnnotation || a.originalName, keyword),
          date: a.createdAt.toISOString(),
          extra: { fileType: a.fileType, originalName: a.originalName, diaryId: a.diaryId, chatMessageId: a.chatMessageId },
        };
      });

      results.push({
        category: 'attachment',
        label: '附件',
        icon: 'attachment',
        items,
        total: attachments.length,
      });
    }

    if (keyword && shouldSearch('event')) {
      const events = await prisma.event.findMany({
        where: {
          userId,
          OR: [
            { title: { contains: keyword, mode: 'insensitive' } },
            { description: { contains: keyword, mode: 'insensitive' } },
            { aiSuggestion: { contains: keyword, mode: 'insensitive' } },
            { courseTeacher: { contains: keyword, mode: 'insensitive' } },
            { courseLocation: { contains: keyword, mode: 'insensitive' } },
            { holidayName: { contains: keyword, mode: 'insensitive' } },
          ],
        },
        orderBy: { startTime: 'desc' },
        take: maxItems,
        include: { goal: { select: { id: true, title: true } } },
      });

      const items: SearchResultItem[] = events.map(e => {
        const timeStr = e.isAllDay ? '全天' : `${new Date(e.startTime).toLocaleDateString('zh-CN')} ${new Date(e.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
        const contentParts = [e.title];
        if (e.description) contentParts.push(e.description);
        if (e.courseTeacher) contentParts.push(`教师: ${e.courseTeacher}`);
        if (e.courseLocation) contentParts.push(`地点: ${e.courseLocation}`);
        return {
          id: e.id,
          type: 'event',
          title: e.title,
          content: contentParts.join(' | '),
          highlight: highlightText(contentParts.join(' '), keyword),
          date: e.startTime.toISOString(),
          extra: { time: timeStr, isCourse: e.isCourse, courseLocation: e.courseLocation, courseTeacher: e.courseTeacher, isHoliday: e.isHoliday, holidayName: e.holidayName, goalId: e.goalId },
        };
      });

      results.push({
        category: 'event',
        label: '日程',
        icon: 'event',
        items,
        total: events.length,
      });
    }

    if (keyword && shouldSearch('chat')) {
      const chatMessages = await prisma.chatMessage.findMany({
        where: {
          userId,
          content: { contains: keyword, mode: 'insensitive' },
        },
        orderBy: { createdAt: 'desc' },
        take: maxItems,
        include: {
          attachments: { select: { id: true, originalName: true, fileType: true, aiAnnotation: true } },
        },
      });

      const items: SearchResultItem[] = chatMessages.map(m => {
        let attachmentInfo = '';
        if (m.attachments.length > 0) {
          attachmentInfo = ` [附件: ${m.attachments.map(a => a.originalName).join(', ')}]`;
        }
        return {
          id: m.id,
          type: 'chat',
          title: m.role === 'user' ? '我的消息' : 'AI回复',
          content: m.content + attachmentInfo,
          highlight: highlightText(m.content, keyword),
          date: m.createdAt.toISOString(),
          extra: { role: m.role, conversationId: m.conversationId, agentType: m.agentType, attachmentCount: m.attachments.length },
        };
      });

      results.push({
        category: 'chat',
        label: 'AI对话',
        icon: 'chat',
        items,
        total: chatMessages.length,
      });
    }

    if (keyword && shouldSearch('goal')) {
      const goals = await prisma.goal.findMany({
        where: {
          userId,
          OR: [
            { title: { contains: keyword, mode: 'insensitive' } },
            { description: { contains: keyword, mode: 'insensitive' } },
            { aiBreakdown: { contains: keyword, mode: 'insensitive' } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: maxItems,
      });

      const items: SearchResultItem[] = goals.map(g => {
        const contentParts = [g.title];
        if (g.description) contentParts.push(g.description);
        let breakdownSummary = '';
        try {
          const bd = JSON.parse(g.aiBreakdown);
          if (bd.summary) breakdownSummary = bd.summary;
          if (bd.tips && bd.tips.length > 0) breakdownSummary += ' | ' + bd.tips.join('; ');
        } catch { /* ignore */ }
        if (breakdownSummary) contentParts.push(breakdownSummary);
        return {
          id: g.id,
          type: 'goal',
          title: g.title,
          content: contentParts.join(' | '),
          highlight: highlightText(contentParts.join(' '), keyword),
          date: g.createdAt.toISOString(),
          extra: { status: g.status, progress: g.progress, deadline: g.deadline?.toISOString() },
        };
      });

      results.push({
        category: 'goal',
        label: '目标',
        icon: 'goal',
        items,
        total: goals.length,
      });
    }

    if (keyword && shouldSearch('habit')) {
      const habits = await prisma.habit.findMany({
        where: {
          userId,
          OR: [
            { title: { contains: keyword, mode: 'insensitive' } },
            { description: { contains: keyword, mode: 'insensitive' } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: maxItems,
        include: { goal: { select: { id: true, title: true } } },
      });

      const habitIds = habits.map(h => h.id);
      const recentLogs = habitIds.length > 0 ? await prisma.habitLog.findMany({
        where: { habitId: { in: habitIds }, logDate: { gte: new Date(Date.now() - 7 * 86400000) } },
        orderBy: { logDate: 'desc' },
      }) : [];

      const items: SearchResultItem[] = habits.map(h => {
        const logs = recentLogs.filter(l => l.habitId === h.id);
        const completedCount = logs.filter(l => l.isCompleted).length;
        const noteLogs = logs.filter(l => l.note && l.note.includes(keyword));
        const noteHighlight = noteLogs.length > 0 ? highlightText(noteLogs[0].note!, keyword) : '';
        const contentParts = [h.title];
        if (h.description) contentParts.push(h.description);
        return {
          id: h.id,
          type: 'habit',
          title: h.title,
          content: contentParts.join(' | '),
          highlight: noteHighlight || highlightText(contentParts.join(' '), keyword),
          date: h.createdAt.toISOString(),
          extra: { frequency: h.frequency, streakCurrent: h.streakCurrent, streakLongest: h.streakLongest, recentCompletionRate: logs.length > 0 ? Math.round(completedCount / logs.length * 100) : 0, goalId: h.goalId },
        };
      });

      results.push({
        category: 'habit',
        label: '习惯',
        icon: 'habit',
        items,
        total: habits.length,
      });
    }

    const totalResults = results.reduce((sum, r) => sum + r.items.length, 0);
    const nonEmptyResults = results.filter(r => r.items.length > 0);

    return reply.send({
      success: true,
      data: {
        results: nonEmptyResults,
        total: totalResults,
        query: keyword,
      },
    });
  });
};

export default searchRoutes;
