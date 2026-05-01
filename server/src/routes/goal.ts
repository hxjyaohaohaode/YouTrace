import { FastifyPluginAsync } from 'fastify';
import prisma from '../utils/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { breakdownGoal as aiBreakdownGoal, callAI, getProvider } from '../services/aiService.js';

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

interface AskQuestionsBody {
  goalId: string;
}

interface GeneratePlanBody {
  goalId: string;
  answers: Array<{ question: string; answer: string }>;
}

interface ConfirmPlanBody {
  goalId: string;
  plan: {
    summary: string;
    milestones: Array<{
      step: number;
      title: string;
      duration: string;
      startDate?: string;
      endDate?: string;
      tasks?: string[];
    }>;
    tips: string[];
  };
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

  fastify.post<{ Body: AskQuestionsBody }>('/api/goals/ask-questions', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { goalId } = request.body;

    const goal = await prisma.goal.findFirst({ where: { id: goalId, userId: request.userId } });
    if (!goal) {
      return reply.status(404).send({ success: false, message: '目标不存在' });
    }

    const provider = getProvider();
    if (provider === 'local') {
      return reply.send({
        success: true,
        data: {
          questions: [
            { question: `你目前为「${goal.title}」做了哪些准备？`, context: '了解当前基础' },
            { question: '你每天/每周能投入多少时间来实现这个目标？', context: '了解可用时间' },
            { question: '实现这个目标最大的障碍是什么？', context: '识别关键阻碍' },
            { question: '你希望优先从哪个方面开始？', context: '确定优先级' },
          ],
        },
      });
    }

    try {
      const now = new Date();
      const weekLater = new Date(now.getTime() + 7 * 86400000);
      const events = await prisma.event.findMany({
        where: {
          userId: request.userId!,
          startTime: { gte: now, lte: weekLater },
        },
        orderBy: { startTime: 'asc' },
        select: { title: true, startTime: true, endTime: true, isCourse: true },
      });

      const scheduleSummary = events.length > 0
        ? events.map(e => {
          const day = e.startTime.toLocaleDateString('zh-CN', { weekday: 'short', month: 'short', day: 'numeric' });
          const time = e.startTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
          return `${day} ${time} ${e.title}${e.isCourse ? '(课程)' : ''}`;
        }).join('\n')
        : '本周暂无日程安排';

      const habits = await prisma.habit.findMany({
        where: { userId: request.userId! },
        select: { title: true, frequency: true, streakCurrent: true },
      });

      const habitSummary = habits.length > 0
        ? habits.map(h => `${h.title}(${h.frequency}, 连续${h.streakCurrent}天)`).join(', ')
        : '暂无进行中的习惯';

      const prompt = `你是一个目标规划专家。用户设定了一个新目标，你需要基于用户的目标信息和日程安排，提出3-5个高度相关的问题，以便后续制定科学的执行计划。

目标信息：
- 标题：${goal.title}
- 描述：${goal.description || '无'}
- 截止日期：${goal.deadline ? new Date(goal.deadline).toLocaleDateString('zh-CN') : '未设定'}
- 当前进度：${goal.progress}%

用户本周日程：
${scheduleSummary}

用户进行中的习惯：
${habitSummary}

请提出3-5个问题，要求：
1. 问题必须与目标内容高度相关
2. 结合用户的日程和习惯情况来提问
3. 问题要能帮助制定更精准的执行计划
4. 每个问题附上提问的上下文说明

返回JSON格式：
{
  "questions": [
    {"question": "问题内容", "context": "为什么问这个问题"}
  ]
}

只返回JSON，不要其他内容。`;

      const result = await callAI(prompt, provider);
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return reply.send({ success: true, data: { questions: parsed.questions || [] } });
      }

      return reply.send({
        success: true,
        data: {
          questions: [
            { question: `你目前为「${goal.title}」做了哪些准备？`, context: '了解当前基础' },
            { question: '你每天/每周能投入多少时间？', context: '了解可用时间' },
            { question: '最大的障碍是什么？', context: '识别关键阻碍' },
          ],
        },
      });
    } catch (e) {
      return reply.status(500).send({ success: false, message: `AI提问失败: ${(e as Error).message}` });
    }
  });

  fastify.post<{ Body: GeneratePlanBody }>('/api/goals/generate-plan', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { goalId, answers } = request.body;

    const goal = await prisma.goal.findFirst({ where: { id: goalId, userId: request.userId } });
    if (!goal) {
      return reply.status(404).send({ success: false, message: '目标不存在' });
    }

    const provider = getProvider();
    if (provider === 'local') {
      const localPlan = await aiBreakdownGoal(goal.title, goal.description || undefined, goal.deadline?.toISOString());
      return reply.send({ success: true, data: { plan: localPlan } });
    }

    try {
      const now = new Date();
      const twoWeeksLater = new Date(now.getTime() + 14 * 86400000);
      const events = await prisma.event.findMany({
        where: {
          userId: request.userId!,
          startTime: { gte: now, lte: twoWeeksLater },
        },
        orderBy: { startTime: 'asc' },
        select: { title: true, startTime: true, endTime: true, isCourse: true, isAllDay: true },
      });

      const scheduleSummary = events.length > 0
        ? events.map(e => {
          const day = e.startTime.toLocaleDateString('zh-CN', { weekday: 'short', month: 'short', day: 'numeric' });
          if (e.isAllDay) return `${day} 全天 ${e.title}`;
          const start = e.startTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
          const end = e.endTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
          return `${day} ${start}-${end} ${e.title}`;
        }).join('\n')
        : '近期暂无日程安排';

      const habits = await prisma.habit.findMany({
        where: { userId: request.userId! },
        select: { title: true, frequency: true, streakCurrent: true },
      });
      const habitSummary = habits.length > 0
        ? habits.map(h => `${h.title}(${h.frequency}, 连续${h.streakCurrent}天)`).join(', ')
        : '暂无进行中的习惯';

      const answersText = answers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n');

      const deadlineStr = goal.deadline ? new Date(goal.deadline).toLocaleDateString('zh-CN') : '未设定';
      const todayStr = new Date().toLocaleDateString('zh-CN');

      const prompt = `你是一个目标规划专家，精通SMART原则、OKR方法论和PDCA循环。请根据以下信息，为用户制定一个科学、可执行的目标实现计划。

目标信息：
- 标题：${goal.title}
- 描述：${goal.description || '无'}
- 截止日期：${deadlineStr}
- 当前进度：${goal.progress}%

用户对问题的回答：
${answersText}

用户近期日程（用于安排计划时避开冲突）：
${scheduleSummary}

用户进行中的习惯：
${habitSummary}

今天日期：${todayStr}

请制定详细的执行计划，要求：
1. 将目标拆解为4-8个里程碑阶段
2. 每个里程碑要有具体的起止日期（基于今天和截止日期计算）
3. 每个里程碑包含2-4个具体任务
4. 考虑用户的日程空闲时段来安排任务
5. 与用户已有习惯进行关联（如果相关）
6. 给出3-5条实用建议

返回JSON格式：
{
  "summary": "计划概述（2-3句话）",
  "milestones": [
    {
      "step": 1,
      "title": "里程碑标题",
      "duration": "时间范围描述",
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "tasks": ["具体任务1", "具体任务2"]
    }
  ],
  "tips": ["建议1", "建议2"]
}

只返回JSON，不要其他内容。`;

      const result = await callAI(prompt, provider);
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const plan = JSON.parse(jsonMatch[0]);
        return reply.send({ success: true, data: { plan } });
      }

      const localPlan = await aiBreakdownGoal(goal.title, goal.description || undefined, goal.deadline?.toISOString());
      return reply.send({ success: true, data: { plan: localPlan } });
    } catch (e) {
      return reply.status(500).send({ success: false, message: `AI计划生成失败: ${(e as Error).message}` });
    }
  });

  fastify.post<{ Body: ConfirmPlanBody }>('/api/goals/confirm-plan', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { goalId, plan } = request.body;

    const goal = await prisma.goal.findFirst({ where: { id: goalId, userId: request.userId } });
    if (!goal) {
      return reply.status(404).send({ success: false, message: '目标不存在' });
    }

    await prisma.goal.update({
      where: { id: goalId },
      data: { aiBreakdown: JSON.stringify(plan) },
    });

    const createdEvents = [];
    for (const milestone of plan.milestones) {
      if (!milestone.startDate || !milestone.endDate) continue;

      const event = await prisma.event.create({
        data: {
          userId: request.userId!,
          title: `🎯 ${milestone.title}`,
          description: milestone.tasks ? milestone.tasks.join('\n') : undefined,
          startTime: new Date(milestone.startDate + 'T09:00:00'),
          endTime: new Date(milestone.endDate + 'T18:00:00'),
          isAllDay: true,
          color: 'blue',
          goalId,
          isAiCreated: true,
        },
      });
      createdEvents.push(event);
    }

    return reply.send({
      success: true,
      data: { createdEvents: createdEvents.length, events: createdEvents },
      message: `计划已确认，已创建${createdEvents.length}个日程`,
    });
  });
};

export default goalRoutes;
