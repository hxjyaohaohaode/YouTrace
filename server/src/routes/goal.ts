import { FastifyPluginAsync } from 'fastify';
import prisma from '../utils/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { breakdownGoal as aiBreakdownGoal } from '../services/aiService.js';

function safeParseBreakdown(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.milestones)) return parsed;
  } catch { /* ignore */ }
  return { summary: '', milestones: [], tips: [] };
}

interface CreateGoalBody {
  title: string;
  description?: string;
  deadline?: string;
}

interface UpdateGoalBody {
  title?: string;
  description?: string;
  deadline?: string;
  progress?: number;
  status?: string;
}

const goalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/goals', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const goals = await prisma.goal.findMany({
      where: { userId: request.userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { events: true } },
        events: {
          where: { endTime: { lt: new Date() } },
          select: { id: true },
        },
      },
    });

    const goalsWithProgress = goals.map((goal) => {
      const totalEvents = goal._count.events;
      const completedEvents = goal.events.length;
      const autoProgress = totalEvents > 0 ? Math.round((completedEvents / totalEvents) * 100) : goal.progress;

      const { events: _events, _count: _count, ...rest } = goal;
      return {
        ...rest,
        aiBreakdown: safeParseBreakdown(rest.aiBreakdown),
        eventCount: totalEvents,
        completedEventCount: completedEvents,
        autoProgress,
      };
    });

    return reply.send({ success: true, data: goalsWithProgress });
  });

  fastify.post<{ Body: CreateGoalBody }>('/api/goals', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { title, description, deadline } = request.body;

    if (!title) {
      return reply.status(400).send({ success: false, message: '请提供目标标题' });
    }

    const goal = await prisma.goal.create({
      data: {
        userId: request.userId!,
        title,
        description: description || null,
        deadline: deadline ? new Date(deadline) : null,
      },
    });

    return reply.status(201).send({
      success: true,
      data: { ...goal, aiBreakdown: safeParseBreakdown(goal.aiBreakdown), eventCount: 0, completedEventCount: 0, autoProgress: 0 },
      message: '目标创建成功',
    });
  });

  fastify.put<{ Params: { id: string }; Body: UpdateGoalBody }>('/api/goals/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;

    const existing = await prisma.goal.findFirst({ where: { id, userId: request.userId } });
    if (!existing) {
      return reply.status(404).send({ success: false, message: '目标不存在' });
    }

    const updateData: Record<string, unknown> = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.deadline !== undefined) updateData.deadline = body.deadline ? new Date(body.deadline) : null;
    if (body.progress !== undefined) updateData.progress = Math.min(100, Math.max(0, body.progress));
    if (body.status !== undefined) {
      const validStatuses = ['ACTIVE', 'COMPLETED', 'ARCHIVED'];
      if (!validStatuses.includes(body.status)) {
        return reply.status(400).send({ success: false, message: `状态必须是 ${validStatuses.join('/')}` });
      }
      updateData.status = body.status;
    }

    const goal = await prisma.goal.update({
      where: { id },
      data: updateData,
    });

    return reply.send({
      success: true,
      data: { ...goal, aiBreakdown: safeParseBreakdown(goal.aiBreakdown) },
      message: '目标更新成功',
    });
  });

  fastify.delete<{ Params: { id: string } }>('/api/goals/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.goal.findFirst({ where: { id, userId: request.userId } });
    if (!existing) {
      return reply.status(404).send({ success: false, message: '目标不存在' });
    }

    await prisma.goal.delete({ where: { id } });

    return reply.send({ success: true, message: '目标已删除' });
  });

  fastify.post<{ Params: { id: string } }>('/api/goals/:id/breakdown', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;

    const goal = await prisma.goal.findFirst({ where: { id, userId: request.userId } });
    if (!goal) {
      return reply.status(404).send({ success: false, message: '目标不存在' });
    }

    const breakdown = await aiBreakdownGoal(goal.title, goal.description || undefined, goal.deadline?.toISOString());

    const updated = await prisma.goal.update({
      where: { id },
      data: { aiBreakdown: JSON.stringify(breakdown) },
    });

    return reply.send({
      success: true,
      data: { ...updated, aiBreakdown: breakdown },
      message: 'AI拆解完成',
    });
  });
};

export default goalRoutes;
