import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { analyzeEmotion } from '../services/aiService.js';

const PAGE_SIZE = 10;

interface CreateDiaryBody {
  content: string;
  mediaUrls?: string[];
  attachmentIds?: string[];
  weather?: Record<string, unknown>;
  locationName?: string;
  locationLat?: number;
  locationLng?: number;
}

interface UpdateDiaryBody {
  content?: string;
  mediaUrls?: string[];
  attachmentIds?: string[];
  weather?: Record<string, unknown>;
  locationName?: string;
  locationLat?: number;
  locationLng?: number;
  emotionTags?: string[];
}

interface PaginationQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  emotionTag?: string;
}

async function getAttachmentAnnotations(attachmentIds: string[], userId: string): Promise<string> {
  if (!attachmentIds || attachmentIds.length === 0) return '';

  const attachments = await prisma.attachment.findMany({
    where: {
      id: { in: attachmentIds },
      userId,
      annotationStatus: 'completed',
    },
    select: {
      originalName: true,
      fileType: true,
      aiAnnotation: true,
      mimeType: true,
    },
  });

  if (attachments.length === 0) return '';

  return '\n\n附件内容:\n' + attachments.map((a, i) => {
    const typeLabel = a.fileType === 'image' ? '图片' : a.fileType === 'video' ? '视频' : a.fileType === 'audio' ? '音频' : '文档';
    return `附件${i + 1} [${typeLabel}] ${a.originalName}:\n${a.aiAnnotation}`;
  }).join('\n\n');
}

const diaryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: PaginationQuery }>('/api/diaries', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const page = Number(request.query.page) || 1;
    const pageSize = Number(request.query.pageSize) || PAGE_SIZE;
    const search = request.query.search;
    const emotionTag = request.query.emotionTag;
    const skip = (page - 1) * pageSize;

    const where: Prisma.DiaryWhereInput = { userId: request.userId, isDeleted: false };

    if (search) {
      where.content = { contains: search };
    }

    if (emotionTag) {
      where.emotionTags = { contains: `"${emotionTag}"` };
    }

    const [diaries, total] = await Promise.all([
      prisma.diary.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: { attachments: { select: { id: true, originalName: true, fileType: true, mimeType: true, thumbnailPath: true, aiAnnotation: true, filePath: true } } },
      }),
      prisma.diary.count({ where }),
    ]);

    const parsedDiaries = diaries.map((d) => ({
      ...d,
      emotionTags: JSON.parse(d.emotionTags),
      mediaUrls: JSON.parse(d.mediaUrls),
    }));

    return reply.send({
      success: true,
      data: { items: parsedDiaries, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    });
  });

  fastify.get<{ Params: { id: string } }>('/api/diaries/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const diary = await prisma.diary.findFirst({
      where: { id, userId: request.userId, isDeleted: false },
      include: { attachments: { select: { id: true, originalName: true, fileType: true, mimeType: true, thumbnailPath: true, aiAnnotation: true, filePath: true } } },
    });
    if (!diary) {
      return reply.status(404).send({ success: false, message: '日记不存在' });
    }
    return reply.send({
      success: true,
      data: { ...diary, emotionTags: JSON.parse(diary.emotionTags), mediaUrls: JSON.parse(diary.mediaUrls) },
    });
  });

  fastify.post<{ Body: CreateDiaryBody }>('/api/diaries', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { content, mediaUrls, attachmentIds, weather, locationName, locationLat, locationLng } = request.body;
    if (!content || content.trim().length === 0) {
      return reply.status(400).send({ success: false, message: '日记内容不能为空' });
    }

    const attachmentContext = await getAttachmentAnnotations(attachmentIds || [], request.userId!);
    const fullContent = content + attachmentContext;

    let emotion = { score: 50, tags: ['平静'], insight: '' };
    try {
      emotion = await analyzeEmotion(fullContent);
    } catch {
      // emotion analysis failed, use defaults
    }

    const diary = await prisma.diary.create({
      data: {
        userId: request.userId!,
        content,
        emotionScore: emotion.score,
        emotionTags: JSON.stringify(emotion.tags),
        aiInsight: emotion.insight || null,
        mediaUrls: JSON.stringify(mediaUrls || []),
        weather: JSON.stringify(weather || {}),
        locationName: locationName || '',
        locationLat: locationLat || null,
        locationLng: locationLng || null,
      },
    });

    if (attachmentIds && attachmentIds.length > 0) {
      await prisma.attachment.updateMany({
        where: {
          id: { in: attachmentIds },
          userId: request.userId!,
        },
        data: { diaryId: diary.id },
      });
    }

    const diaryWithAttachments = await prisma.diary.findUnique({
      where: { id: diary.id },
      include: { attachments: { select: { id: true, originalName: true, fileType: true, mimeType: true, thumbnailPath: true, filePath: true, aiAnnotation: true } } },
    });

    return reply.status(201).send({
      success: true,
      data: { ...diaryWithAttachments, emotionTags: JSON.parse(diaryWithAttachments!.emotionTags), mediaUrls: JSON.parse(diaryWithAttachments!.mediaUrls) },
      message: '日记创建成功',
    });
  });

  fastify.put<{ Params: { id: string }; Body: UpdateDiaryBody }>('/api/diaries/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const { content, mediaUrls, attachmentIds, weather, locationName, locationLat, locationLng, emotionTags } = request.body;

    const existing = await prisma.diary.findFirst({ where: { id, userId: request.userId, isDeleted: false } });
    if (!existing) {
      return reply.status(404).send({ success: false, message: '日记不存在' });
    }

    const updateData: Prisma.DiaryUpdateInput = {};
    if (content !== undefined) {
      const attachmentContext = await getAttachmentAnnotations(attachmentIds || [], request.userId!);
      const fullContent = content + attachmentContext;
      let result = { score: existing.emotionScore, tags: JSON.parse(existing.emotionTags) as string[], insight: existing.aiInsight };
      try {
        result = await analyzeEmotion(fullContent);
      } catch {
        // emotion analysis failed, keep existing
      }
      updateData.content = content;
      updateData.emotionScore = result.score;
      updateData.emotionTags = JSON.stringify(result.tags);
      updateData.aiInsight = result.insight || existing.aiInsight;
    }
    if (mediaUrls !== undefined) updateData.mediaUrls = JSON.stringify(mediaUrls);
    if (weather !== undefined) updateData.weather = JSON.stringify(weather);
    if (locationName !== undefined) updateData.locationName = locationName;
    if (locationLat !== undefined) updateData.locationLat = locationLat;
    if (locationLng !== undefined) updateData.locationLng = locationLng;
    if (emotionTags !== undefined) updateData.emotionTags = JSON.stringify(emotionTags);

    await prisma.diary.update({ where: { id }, data: updateData });

    if (attachmentIds !== undefined) {
      await prisma.attachment.updateMany({
        where: { diaryId: id, userId: request.userId! },
        data: { diaryId: null },
      });

      if (attachmentIds.length > 0) {
        await prisma.attachment.updateMany({
          where: {
            id: { in: attachmentIds },
            userId: request.userId!,
          },
          data: { diaryId: id },
        });
      }
    }

    const diaryWithAttachments = await prisma.diary.findUnique({
      where: { id },
      include: { attachments: { select: { id: true, originalName: true, fileType: true, mimeType: true, thumbnailPath: true, filePath: true, aiAnnotation: true } } },
    });

    return reply.send({
      success: true,
      data: { ...diaryWithAttachments, emotionTags: JSON.parse(diaryWithAttachments!.emotionTags), mediaUrls: JSON.parse(diaryWithAttachments!.mediaUrls) },
      message: '日记更新成功',
    });
  });

  fastify.delete<{ Params: { id: string } }>('/api/diaries/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const existing = await prisma.diary.findFirst({ where: { id, userId: request.userId, isDeleted: false } });
    if (!existing) {
      return reply.status(404).send({ success: false, message: '日记不存在' });
    }
    await prisma.diary.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    return reply.send({ success: true, message: '日记已删除' });
  });

  fastify.post<{ Params: { id: string } }>('/api/diaries/:id/analyze', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const diary = await prisma.diary.findFirst({
      where: { id, userId: request.userId, isDeleted: false },
      include: { attachments: { select: { originalName: true, fileType: true, aiAnnotation: true } } },
    });
    if (!diary) {
      return reply.status(404).send({ success: false, message: '日记不存在' });
    }

    const attachmentContext = diary.attachments.length > 0
      ? '\n\n附件内容:\n' + diary.attachments.map((a, i) => {
        const typeLabel = a.fileType === 'image' ? '图片' : a.fileType === 'video' ? '视频' : a.fileType === 'audio' ? '音频' : '文档';
        return `附件${i + 1} [${typeLabel}] ${a.originalName}:\n${a.aiAnnotation}`;
      }).join('\n\n')
      : '';

    const fullContent = diary.content + attachmentContext;
    const result = await analyzeEmotion(fullContent);
    const aiInsight = result.insight;

    const updated = await prisma.diary.update({
      where: { id },
      data: { aiInsight, emotionScore: result.score, emotionTags: JSON.stringify(result.tags) },
    });

    return reply.send({
      success: true,
      data: { ...updated, emotionTags: JSON.parse(updated.emotionTags), mediaUrls: JSON.parse(updated.mediaUrls) },
      message: 'AI分析完成',
    });
  });

  fastify.get('/api/diaries/export', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const diaries = await prisma.diary.findMany({
      where: { userId: request.userId, isDeleted: false },
      orderBy: { createdAt: 'asc' },
      include: { attachments: { select: { originalName: true, fileType: true, aiAnnotation: true } } },
    });

    const exportData = diaries.map((d) => ({
      content: d.content,
      emotionScore: d.emotionScore,
      emotionTags: JSON.parse(d.emotionTags),
      aiInsight: d.aiInsight,
      mediaUrls: JSON.parse(d.mediaUrls),
      attachments: d.attachments.map((a) => ({
        name: a.originalName,
        type: a.fileType,
        annotation: a.aiAnnotation,
      })),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));

    return reply.send({ success: true, data: exportData });
  });

  fastify.get<{ Querystring: { period?: string } }>('/api/diaries/stats', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const period = parseInt(request.query.period || '30');
    const now = new Date();
    const cutoff = new Date(now.getTime() - period * 86400000);

    const diaries = await prisma.diary.findMany({
      where: {
        userId: request.userId,
        isDeleted: false,
        createdAt: { gte: cutoff },
      },
      orderBy: { createdAt: 'asc' },
    });

    const totalDiaries = diaries.length;
    const averageScore = totalDiaries > 0
      ? Math.round(diaries.reduce((s, d) => s + d.emotionScore, 0) / totalDiaries)
      : 0;

    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthCount = diaries.filter((d) => d.createdAt >= thisMonthStart).length;

    const emotionTrendMap = new Map<string, { total: number; count: number }>();
    diaries.forEach((d) => {
      const dateKey = d.createdAt.toISOString().slice(0, 10);
      const entry = emotionTrendMap.get(dateKey) || { total: 0, count: 0 };
      entry.total += d.emotionScore;
      entry.count += 1;
      emotionTrendMap.set(dateKey, entry);
    });
    const emotionTrend = Array.from(emotionTrendMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { total, count }]) => ({ date, score: Math.round(total / count) }));

    const tagCounts: Record<string, number> = {};
    diaries.forEach((d) => {
      const tags = JSON.parse(d.emotionTags) as string[];
      tags.forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
    });
    const topEmotions = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, count }));

    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const checkDate = new Date(today.getTime() - i * 86400000);
      const dateStr = checkDate.toISOString().slice(0, 10);
      const hasDiary = diaries.some((d) => d.createdAt.toISOString().slice(0, 10) === dateStr);
      if (hasDiary) {
        streak++;
      } else if (i > 0) {
        break;
      }
    }

    const STOP_WORDS = new Set([
      '今天', '昨天', '明天', '现在', '然后', '所以', '因为', '但是', '虽然',
      '如果', '就是', '可以', '已经', '还是', '这个', '那个', '什么', '怎么',
      '没有', '不是', '一个', '一些', '这些', '那些', '自己', '他们', '我们',
      '你们', '她们', '它们', '这样', '那样', '怎样', '这么', '那么', '非常',
      '真的', '其实', '时候', '地方', '东西', '感觉', '知道', '觉得', '认为',
      '应该', '可能', '需要', '开始', '出来', '起来', '下来', '上去', '过来',
      '回去', '回来', '出去', '进去', '过去', '以后', '之前', '的话', '一样',
      '一直', '不断', '不过', '而且', '或者', '以及', '也是', '又是', '还要',
      '只有', '只要', '还有', '只是', '然而', '并且', '比较', '更加', '特别',
      '相当', '十分', '极其', '尤其', '格外', '确实', '的确', '实在', '真正',
      '当然', '显然', '毕竟', '反正', '总之', '大概', '也许', '必须', '一定',
      '肯定', '绝对', '相对',
    ]);
    const wordMap: Record<string, number> = {};
    diaries.forEach((d) => {
      const words = d.content.match(/[\u4e00-\u9fff]{2,4}/g) || [];
      words.forEach((w) => {
        if (!STOP_WORDS.has(w)) {
          wordMap[w] = (wordMap[w] || 0) + 1;
        }
      });
    });
    const wordCloud = Object.entries(wordMap)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([word, count]) => ({ word, count }));

    return reply.send({
      success: true,
      data: {
        totalDiaries,
        averageScore,
        streak,
        thisMonthCount,
        emotionTrend,
        topEmotions,
        wordCloud,
      },
    });
  });
};

export default diaryRoutes;
