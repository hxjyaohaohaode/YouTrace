import { FastifyPluginAsync } from 'fastify';
import prisma from '../utils/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  callAI,
  callAIChat,
  callAIChatStream,
  getProvider,
  extractMemoryFromMessage,
  getAgentById,
  AGENTS,
  generateGuideQuestions,
  getAIStatus,
  getToolDescriptionsText,
  parseToolCalls,
  stripToolCalls,
  getWeatherForLocation,
  getUserLocation,
  analyzeEmotion,
  type ToolCall,
  type ToolResult,
  type ChatMessage,
} from '../services/aiService.js';
import { getLocation } from '../services/locationService.js';
import { getWeatherNow, getAirQuality, getWeatherAlerts, getWeatherSummaryText, buildQWeatherLocation } from '../services/weatherService.js';

interface ChatMessageBody {
  content: string;
  agentType?: string;
  conversationId?: string;
  attachmentIds?: string[];
  longitude?: number;
  latitude?: number;
}

interface UpdateProfileBody {
  nickname?: string;
  personality?: string;
  height?: string;
  weight?: string;
  hobbies?: string;
  occupation?: string;
  bio?: string;
  birthday?: string;
  gender?: string;
  location?: string;
  education?: string;
  relationship?: string;
  healthCondition?: string;
  dietPreference?: string;
  sleepSchedule?: string;
  workSchedule?: string;
  favoriteFoods?: string;
  dislikedFoods?: string;
  favoriteMusic?: string;
  favoriteSports?: string;
  lifeGoals?: string;
}

interface CreateMemoryBody {
  category: string;
  key: string;
  value: string;
}

const SYSTEM_PROMPT = `你是"有记"App的AI助手——一个极其智能、主动、贴心的个人生活管家。

【核心身份】
你是一个深度了解用户的私人助理，你不仅回答问题，更会主动思考用户需要什么。当前时间：{CURRENT_TIME}

【六大核心能力】
1. **主动智能**：不等用户提问，主动发现需求并提供建议。比如看到用户连续加班，主动建议休息。
2. **深度记忆**：你会记住用户告诉你的所有信息（职业、爱好、习惯、健康状况等），并在后续对话中自然地体现这种了解。
3. **日程管理**：帮助用户创建、修改、删除日程。当识别到日程相关内容时，主动提议帮助管理。你可以直接帮用户创建日程。
4. **课表识别**：用户上传课表图片后，你能自动识别课程信息（课程名、时间、地点、教师、周次），展示识别结果让用户确认后再添加到日程。支持选择周次范围和调课设置。
5. **情绪关怀**：关注用户情绪变化，低落时温暖鼓励，开心时一起分享。结合日记情绪趋势给出专业心理建议。
6. **目标追踪**：了解用户的目标和习惯打卡情况，给出针对性的坚持建议和进度分析。

【计划制定与审批】
当用户需要你制定计划时（如学习计划、健身计划、备考计划等），你必须：
1. 先制定详细的计划方案，包含具体的时间安排和目标
2. 将计划方案展示给用户，等待用户确认
3. 用户确认后，再将计划中的各项内容添加到日程表、目标、习惯中
4. 绝对不要在用户未确认的情况下直接创建日程

【专家智能体】
你可以根据用户的需求自动切换到专业模式：
- 📅 日程管家：专注日程管理和时间规划
- 💚 心理顾问：情绪分析和心理健康支持
- 🏃 健康教练：健康管理和生活习惯指导
- 🎯 效率专家：目标管理和效率提升
- 🌤️ 天气顾问：天气感知和生活建议
- 📚 学习顾问：学习规划和知识管理

当用户的需求更适合某个专业智能体时，在回复中建议用户切换。例如："这个问题让心理顾问来帮你更专业，要切换吗？"

【安全护栏】
你必须严格遵守以下安全规则：
- 不得提供医疗诊断或处方建议，只能提供一般性健康建议
- 不得替代专业心理咨询，发现严重心理问题必须建议就医
- 不得提供法律或金融投资建议
- 不得代替用户完成考试或作业
- 发现自伤/自杀倾向时，必须立即提供心理援助热线（全国24小时：400-161-9995）
- 不得执行任何可能对用户造成伤害的操作
- 涉及用户隐私的信息不得在回复中完整展示

【工具调用与ReAct循环】
你使用"思考→行动→观察→反思"的ReAct循环来解决问题：

1. **思考(Thought)**：分析用户需求，决定需要做什么
2. **行动(Action)**：调用工具执行操作
3. **观察(Observation)**：查看工具返回的结果
4. **反思(Reflection)**：基于结果决定下一步，或给出最终回复

当你需要调用工具时，在回复中使用以下格式：
[TOOL:工具名]JSON参数[/TOOL]

例如，为用户添加一个日程：
[TOOL:add_event]{"title":"团队会议","startTime":"2024-01-15T14:00:00","endTime":"2024-01-15T15:00:00"}[/TOOL]

你可以同时调用多个工具，也可以在自然语言回复中穿插工具调用。工具调用后系统会自动执行并返回结果，你根据结果继续思考或给出最终回复。

**重要**：在回复前先思考——你是否需要先获取数据（天气、情绪趋势、日程分析等）才能给出专业建议？如果是，先调用分析工具，再基于数据给出建议。

{TOOL_DESCRIPTIONS}

【交互规则】
- 始终用中文回复，语气温暖自然，像朋友一样交流
- 回复简洁有温度，避免冗长说教
- 主动询问需求，不要被动等待
- 识别到个人信息时，主动使用save_memory或update_profile工具保存
- 识别到日程需求时，主动使用add_event工具创建
- 识别到目标意图时，主动使用add_goal工具创建
- 识别到日记意图时，主动使用add_diary工具创建
- 识别到习惯意图时，主动使用add_habit工具创建
- 用户上传课表图片时，主动使用recognize_schedule工具识别，展示识别结果让用户确认后再创建日程
- 用户要求显示节假日时，主动使用add_holidays工具添加
- 需要天气数据时，主动使用search_weather工具获取
- 需要了解情绪趋势时，主动使用analyze_emotion_trend工具
- 需要分析日程时，主动使用analyze_schedule工具
- 需要了解目标进度时，主动使用analyze_goal_progress工具
- 有天气预警时，务必提醒安全并给出防护建议
- 结合天气给出贴心建议（下雨→带伞，高温→防暑，雾霾→戴口罩，寒冷→保暖）
- 不要重复用户已知的信息，而是基于这些信息给出新的洞察和建议
- 从容易被忽视的角度思考问题，给出用户意想不到但极其有价值的建议

【主动智能行为模式】
你应当主动识别以下行为模式并采取行动：
- 用户连续多天情绪低落→主动关怀，建议切换心理顾问模式
- 用户日程过于密集→主动建议优化，指出空闲时段
- 用户目标进度停滞→主动分析原因，给出可执行建议
- 用户习惯打卡中断→主动鼓励，分析中断原因
- 天气即将变化→主动提醒准备（降温→加衣，下雨→带伞）
- 用户提到身体不适→结合天气和健康数据给出建议
- 用户长时间未写日记→主动引导记录
- 用户信息有更新→主动保存到记忆库和画像`;

const aiRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/ai/status', {
    preHandler: authMiddleware,
  }, async (_request, reply) => {
    const status = getAIStatus();
    return reply.send({ success: true, data: status });
  });

  fastify.get('/api/ai/conversations', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const query = request.query as { search?: string; page?: string; limit?: string };
    const search = query.search || '';
    const page = Math.max(1, parseInt(query.page || '1'));
    const limit = Math.min(50, Math.max(1, parseInt(query.limit || '20')));
    const skip = (page - 1) * limit;

    const where: { userId: string; title?: { contains: string } } = { userId: request.userId! };
    if (search) {
      where.title = { contains: search };
    }

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { content: true, role: true, createdAt: true },
          },
          _count: { select: { messages: true } },
        },
      }),
      prisma.conversation.count({ where }),
    ]);

    return reply.send({
      success: true,
      data: {
        items: conversations.map((c) => ({
          id: c.id,
          title: c.title,
          agentType: c.agentType,
          messageCount: c._count.messages,
          lastMessage: c.messages[0] || null,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        })),
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  fastify.post<{ Body: { title?: string; agentType?: string } }>('/api/ai/conversations', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { title, agentType } = request.body || {};
    const conversation = await prisma.conversation.create({
      data: {
        userId: request.userId!,
        title: title || '新对话',
        agentType: agentType || 'default',
      },
    });
    return reply.send({ success: true, data: conversation });
  });

  fastify.get<{ Params: { id: string } }>('/api/ai/conversations/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const conversation = await prisma.conversation.findFirst({
      where: { id, userId: request.userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!conversation) {
      return reply.status(404).send({ success: false, message: '对话不存在' });
    }
    return reply.send({
      success: true,
      data: {
        ...conversation,
        messages: conversation.messages.map((m) => ({
          ...m,
          metadata: (() => { try { return JSON.parse(m.metadata); } catch { return {}; } })(),
        })),
      },
    });
  });

  fastify.delete<{ Params: { id: string } }>('/api/ai/conversations/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const conversation = await prisma.conversation.findFirst({
      where: { id, userId: request.userId },
    });
    if (!conversation) {
      return reply.status(404).send({ success: false, message: '对话不存在' });
    }
    await prisma.conversation.delete({ where: { id } });
    return reply.send({ success: true, message: '对话已删除' });
  });

  fastify.get('/api/ai/guide-questions', {
    preHandler: authMiddleware,
  }, async (_request, reply) => {
    const questions = await generateGuideQuestions();
    return reply.send({ success: true, data: questions });
  });

  fastify.get('/api/ai/agents', {
    preHandler: authMiddleware,
  }, async (_request, reply) => {
    return reply.send({
      success: true,
      data: AGENTS.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        icon: a.icon,
        availableTools: a.availableTools,
        collaborationHints: a.collaborationHints,
      })),
    });
  });

  fastify.get('/api/ai/chat/history', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const query = request.query as { conversationId?: string; limit?: string };
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '50')));
    const where: { userId: string; conversationId?: string } = { userId: request.userId! };
    if (query.conversationId) {
      where.conversationId = query.conversationId;
    }

    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return reply.send({
      success: true,
      data: messages.reverse().map((m) => ({
        ...m,
        metadata: (() => { try { return JSON.parse(m.metadata); } catch { return {}; } })(),
      })),
    });
  });

  fastify.post<{ Body: ChatMessageBody }>('/api/ai/chat', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { content, agentType, conversationId, attachmentIds, longitude, latitude } = request.body;
    if (!content || content.trim().length === 0) {
      return reply.status(400).send({ success: false, message: '消息不能为空' });
    }

    const selectedAgent = getAgentById(agentType || 'default');

    let attachments: Array<{ id: string; originalName: string; fileType: string; aiAnnotation: string; mimeType: string }> = [];
    if (attachmentIds && attachmentIds.length > 0) {
      attachments = await prisma.attachment.findMany({
        where: {
          id: { in: attachmentIds },
          userId: request.userId,
          annotationStatus: 'completed',
        },
        select: {
          id: true,
          originalName: true,
          fileType: true,
          aiAnnotation: true,
          mimeType: true,
        },
      });
    }

    let activeConversationId = conversationId;
    if (!activeConversationId) {
      const newConversation = await prisma.conversation.create({
        data: {
          userId: request.userId!,
          title: content.trim().slice(0, 30) + (content.trim().length > 30 ? '...' : ''),
          agentType: selectedAgent.id,
        },
      });
      activeConversationId = newConversation.id;
    }

    const userMessage = await prisma.chatMessage.create({
      data: {
        userId: request.userId!,
        conversationId: activeConversationId,
        role: 'user',
        content: content.trim(),
        agentType: selectedAgent.id,
        metadata: JSON.stringify({
          attachmentIds: attachments.map((a) => a.id),
          attachmentNames: attachments.map((a) => a.originalName),
        }),
      },
    });

    if (attachments.length > 0) {
      await prisma.attachment.updateMany({
        where: {
          id: { in: attachments.map((a) => a.id) },
          userId: request.userId,
        },
        data: { chatMessageId: userMessage.id },
      });
    }

    const recentMessages = await prisma.chatMessage.findMany({
      where: { conversationId: activeConversationId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const user = await prisma.user.findUnique({
      where: { id: request.userId },
      include: { profile: true },
    });

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

    const [todayEvents, upcomingEvents, recentDiaries, activeGoals, recentHabits, habitLogs, memoryItems] = await Promise.all([
      prisma.event.findMany({
        where: {
          userId: request.userId,
          startTime: { lte: endOfDay },
          endTime: { gte: startOfDay },
        },
        orderBy: { startTime: 'asc' },
      }),
      prisma.event.findMany({
        where: {
          userId: request.userId,
          startTime: { gte: now.toISOString() },
        },
        orderBy: { startTime: 'asc' },
        take: 5,
      }),
      prisma.diary.findMany({
        where: { userId: request.userId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          attachments: {
            select: { originalName: true, fileType: true, aiAnnotation: true },
          },
        },
      }),
      prisma.goal.findMany({
        where: { userId: request.userId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.habit.findMany({
        where: { userId: request.userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.habitLog.findMany({
        where: {
          habit: { userId: request.userId },
          logDate: { gte: new Date(now.getTime() - 7 * 86400000) },
        },
        orderBy: { logDate: 'desc' },
        take: 30,
      }),
      prisma.memoryItem.findMany({
        where: { userId: request.userId },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
    ]);

    let contextInfo = '';

    contextInfo += `\n\n当前时间: ${now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long' })}`;

    if (user?.profile) {
      const p = user.profile;
      const userInfo: string[] = [];
      if (p.nickname) userInfo.push(`昵称: ${p.nickname}`);
      if (p.gender) userInfo.push(`性别: ${p.gender}`);
      if (p.birthday) userInfo.push(`生日: ${p.birthday}`);
      if (p.occupation) userInfo.push(`职业: ${p.occupation}`);
      if (p.hobbies) userInfo.push(`爱好: ${p.hobbies}`);
      if (p.personality) userInfo.push(`性格: ${p.personality}`);
      if (p.height) userInfo.push(`身高: ${p.height}`);
      if (p.weight) userInfo.push(`体重: ${p.weight}`);
      if (p.location) userInfo.push(`所在地: ${p.location}`);
      if (p.education) userInfo.push(`学历: ${p.education}`);
      if (p.relationship) userInfo.push(`感情状况: ${p.relationship}`);
      if (p.healthCondition) userInfo.push(`健康状况: ${p.healthCondition}`);
      if (p.dietPreference) userInfo.push(`饮食偏好: ${p.dietPreference}`);
      if (p.sleepSchedule) userInfo.push(`作息: ${p.sleepSchedule}`);
      if (p.workSchedule) userInfo.push(`工作时间: ${p.workSchedule}`);
      if (p.favoriteFoods) userInfo.push(`喜欢的食物: ${p.favoriteFoods}`);
      if (p.dislikedFoods) userInfo.push(`不喜欢的食物: ${p.dislikedFoods}`);
      if (p.favoriteMusic) userInfo.push(`喜欢的音乐: ${p.favoriteMusic}`);
      if (p.favoriteSports) userInfo.push(`喜欢的运动: ${p.favoriteSports}`);
      if (p.lifeGoals) userInfo.push(`人生目标: ${p.lifeGoals}`);
      if (p.bio) userInfo.push(`自我介绍: ${p.bio}`);
      if (p.aiMemorySummary) userInfo.push(`AI记忆摘要: ${p.aiMemorySummary}`);
      if (userInfo.length > 0) {
        contextInfo += `\n\n用户画像:\n${userInfo.join('\n')}`;
      }
    }

    if (memoryItems.length > 0) {
      const memoryByCategory: Record<string, string[]> = {};
      for (const item of memoryItems) {
        if (!memoryByCategory[item.category]) memoryByCategory[item.category] = [];
        memoryByCategory[item.category].push(`${item.key}: ${item.value}`);
      }
      contextInfo += '\n\nAI记忆库:\n' + Object.entries(memoryByCategory)
        .map(([cat, items]) => `[${cat}]\n${items.join('\n')}`)
        .join('\n\n');
    }

    if (todayEvents.length > 0) {
      contextInfo += '\n\n今日日程:\n' + todayEvents.map((e) =>
        `- ${e.title} (${e.isAllDay ? '全天' : `${new Date(e.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} - ${new Date(e.endTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`})`
      ).join('\n');
    }

    if (upcomingEvents.length > 0) {
      contextInfo += '\n\n即将到来的日程:\n' + upcomingEvents.map((e) =>
        `- ${e.title} (${new Date(e.startTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })})`
      ).join('\n');
    }

    if (recentDiaries.length > 0) {
      contextInfo += '\n\n最近日记:\n' + recentDiaries.map((d) => {
        const tags = JSON.parse(d.emotionTags);
        const diaryAttachments = (d as { attachments?: Array<{ originalName: string; fileType: string; aiAnnotation: string }> }).attachments || [];
        const attachmentInfo = diaryAttachments.length > 0
          ? '\n  附件: ' + diaryAttachments.map((a) => {
            const typeLabel = a.fileType === 'image' ? '图片' : a.fileType === 'video' ? '视频' : a.fileType === 'audio' ? '音频' : '文档';
            return `[${typeLabel}]${a.originalName}: ${a.aiAnnotation.slice(0, 80)}${a.aiAnnotation.length > 80 ? '...' : ''}`;
          }).join('; ')
          : '';
        return `- [${d.createdAt.toLocaleDateString('zh-CN')}] 情绪:${tags.join(',')} "${d.content.slice(0, 150)}${d.content.length > 150 ? '...' : ''}"${attachmentInfo}`;
      }).join('\n');
    }

    if (activeGoals.length > 0) {
      contextInfo += '\n\n进行中的目标:\n' + activeGoals.map((g) =>
        `- ${g.title} (进度${g.progress}%${g.deadline ? `，截止${new Date(g.deadline).toLocaleDateString('zh-CN')}` : ''})`
      ).join('\n');
    }

    if (recentHabits.length > 0) {
      contextInfo += '\n\n正在坚持的习惯:\n' + recentHabits.map((h) =>
        `- ${h.title} (连续${h.streakCurrent}天，频率: ${h.frequency})`
      ).join('\n');
    }

    if (habitLogs.length > 0) {
      const recentDates = [...new Set(habitLogs.map((l) => l.logDate.toLocaleDateString('zh-CN')))].slice(0, 7);
      const habitLogSummary = recentDates.map((date) => {
        const dayLogs = habitLogs.filter((l) => l.logDate.toLocaleDateString('zh-CN') === date);
        const completed = dayLogs.filter((l) => l.isCompleted).length;
        const total = dayLogs.length;
        return `${date}: ${completed}/${total}完成`;
      }).join('\n');
      contextInfo += '\n\n最近7天习惯打卡:\n' + habitLogSummary;
    }

    try {
      let locationInfo;
      if (longitude != null && latitude != null && !isNaN(longitude) && !isNaN(latitude)) {
        locationInfo = await getLocation(undefined, longitude, latitude);
      } else {
        const forwarded = request.headers['x-forwarded-for'];
        const ip = request.ip || (typeof forwarded === 'string' ? forwarded : Array.isArray(forwarded) ? forwarded[0] : undefined);
        locationInfo = await getLocation(ip);
      }
      if (locationInfo.city || locationInfo.province) {
        contextInfo += `\n\n用户位置: ${locationInfo.province}${locationInfo.city}${locationInfo.district}`;

        const locationParam = await buildQWeatherLocation(
          locationInfo.longitude,
          locationInfo.latitude,
          locationInfo.city || locationInfo.province,
        );

        if (locationParam) {
          try {
            const weatherData = await getWeatherNow(locationParam);
            let airData = null;
            try { airData = await getAirQuality(locationParam); } catch { /* ignore */ }
            let alertData: Awaited<ReturnType<typeof getWeatherAlerts>> | null = null;
            try {
              if (locationInfo.latitude != null && locationInfo.longitude != null) {
                alertData = await getWeatherAlerts(locationInfo.latitude, locationInfo.longitude);
              }
            } catch { /* ignore */ }

            const weatherSummary = getWeatherSummaryText(
              weatherData.now,
              airData?.now || null,
              alertData?.alerts || [],
            );
            contextInfo += `\n\n当前天气信息: ${weatherSummary}`;
          } catch { /* weather unavailable, skip */ }
        }
      }
    } catch { /* location unavailable, skip */ }

    if (attachments.length > 0) {
      contextInfo += '\n\n用户上传的附件:\n' + attachments.map((a, i) => {
        const typeLabel = a.fileType === 'image' ? '图片' : a.fileType === 'video' ? '视频' : a.fileType === 'audio' ? '音频' : '文档';
        return `附件${i + 1} [${typeLabel}] ${a.originalName}:\n${a.aiAnnotation}`;
      }).join('\n\n');
    }

    const chatHistory = recentMessages.reverse().map((m) => {
      let msgContent = m.content;
      try {
        const meta = JSON.parse(m.metadata);
        if (meta.attachmentNames && meta.attachmentNames.length > 0 && m.role === 'user') {
          msgContent += `\n\n[用户在此消息中上传了附件: ${meta.attachmentNames.join(', ')}]`;
        }
      } catch { /* ignore */ }
      return {
        role: m.role as 'user' | 'assistant',
        content: msgContent,
      };
    });

    const toolDescriptions = getToolDescriptionsText();

    let systemContent = SYSTEM_PROMPT
      .replace('{CURRENT_TIME}', now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long' }))
      .replace('{TOOL_DESCRIPTIONS}', toolDescriptions);

    if (selectedAgent.systemPromptAddition) {
      systemContent += `\n\n${selectedAgent.systemPromptAddition}`;
    }

    systemContent += `\n\n--- 用户上下文 ---\n${contextInfo}`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemContent },
    ];

    if (chatHistory.length > 0) {
      for (const msg of chatHistory.slice(-10)) {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    let userContentWithAttachments = content;
    if (attachments.length > 0) {
      userContentWithAttachments += '\n\n我上传了以下附件:\n' + attachments.map((a, i) => {
        const typeLabel = a.fileType === 'image' ? '图片' : a.fileType === 'video' ? '视频' : a.fileType === 'audio' ? '音频' : '文档';
        return `附件${i + 1} [${typeLabel}] ${a.originalName}:\n${a.aiAnnotation}`;
      }).join('\n\n');
    }

    messages.push({ role: 'user', content: userContentWithAttachments });

    let aiContent: string;
    const toolResults: ToolResult[] = [];

    try {
      const provider = getProvider();
      if (provider === 'local') {
        aiContent = generateLocalResponse(content, todayEvents, recentDiaries, user?.profile ?? null);
      } else {
        aiContent = await callAIChat(messages, provider);

        if (aiContent.startsWith('```')) {
          aiContent = aiContent.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
        }

        const toolCalls = parseToolCalls(aiContent);

        if (toolCalls.length > 0) {
          for (const toolCall of toolCalls) {
            if (!selectedAgent.availableTools.includes(toolCall.name)) {
              toolResults.push({
                name: toolCall.name,
                success: false,
                data: null,
                message: `工具 ${toolCall.name} 在当前智能体模式下不可用`,
              });
              continue;
            }

            const result = await executeToolCall(toolCall, request.userId!, request.ip);
            toolResults.push(result);
          }

          const toolFeedbackParts = toolResults.map((r) => {
            if (r.success) {
              return `${r.name}: ✅ ${r.message}`;
            }
            return `${r.name}: ❌ ${r.message}`;
          });

          const toolFeedback = toolFeedbackParts.join('\n');

          messages.push({ role: 'assistant', content: aiContent });
          messages.push({
            role: 'user',
            content: `工具执行结果：\n${toolFeedback}\n\n请根据工具执行结果，给用户一个简洁的确认回复。如果工具执行成功，告诉用户你完成了什么；如果失败，说明原因并建议替代方案。`,
          });

          const followUpResponse = await callAIChat(messages, provider);
          aiContent = followUpResponse.trim();
        }

        const memoryResult = await extractMemoryFromMessage(content);
        if (memoryResult.items.length > 0) {
          for (const item of memoryResult.items) {
            if (item.confidence >= 60) {
              await prisma.memoryItem.upsert({
                where: {
                  userId_category_key: {
                    userId: request.userId!,
                    category: item.category,
                    key: item.key,
                  },
                },
                create: {
                  userId: request.userId!,
                  category: item.category,
                  key: item.key,
                  value: item.value,
                  source: 'ai_extracted',
                  confidence: item.confidence,
                  isVerified: item.confidence >= 80,
                },
                update: {
                  value: item.value,
                  confidence: item.confidence,
                  source: 'ai_extracted',
                },
              });

              await updateProfileFromMemory(request.userId!, item.category, item.key, item.value);
            }
          }

          await generateMemorySummary(request.userId!);
        }
      }
    } catch {
      aiContent = generateLocalResponse(content, todayEvents, recentDiaries, user?.profile ?? null);
    }

    const cleanContent = stripToolCalls(aiContent);

    const assistantMessage = await prisma.chatMessage.create({
      data: {
        userId: request.userId!,
        conversationId: activeConversationId,
        role: 'assistant',
        content: cleanContent,
        agentType: selectedAgent.id,
        metadata: JSON.stringify({
          toolResults: toolResults.map((r) => ({ name: r.name, success: r.success, message: r.message })),
        }),
      },
    });

    await prisma.conversation.update({
      where: { id: activeConversationId },
      data: { updatedAt: new Date() },
    });

    return reply.send({
      success: true,
      data: {
        conversationId: activeConversationId,
        userMessage: { ...userMessage, metadata: JSON.parse(userMessage.metadata) },
        assistantMessage: { ...assistantMessage, metadata: JSON.parse(assistantMessage.metadata) },
        toolResults,
      },
    });
  });

  fastify.post<{ Body: ChatMessageBody }>('/api/ai/chat/stream', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { content, agentType, conversationId, attachmentIds, longitude: _longitude, latitude: _latitude } = request.body as ChatMessageBody;
    if (!content || content.trim().length === 0) {
      return reply.status(400).send({ success: false, message: '消息不能为空' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendSSE = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const selectedAgent = getAgentById(agentType || 'default');

      let activeConversationId = conversationId;
      if (!activeConversationId) {
        const newConversation = await prisma.conversation.create({
          data: {
            userId: request.userId!,
            title: content.trim().slice(0, 30) + (content.trim().length > 30 ? '...' : ''),
            agentType: selectedAgent.id,
          },
        });
        activeConversationId = newConversation.id;
      }

      const userMessage = await prisma.chatMessage.create({
        data: {
          userId: request.userId!,
          conversationId: activeConversationId,
          role: 'user',
          content: content.trim(),
          agentType: selectedAgent.id,
          metadata: JSON.stringify({ attachmentIds: attachmentIds || [] }),
        },
      });

      sendSSE('conversation', { conversationId: activeConversationId, userMessage });

      const recentMessages = await prisma.chatMessage.findMany({
        where: { conversationId: activeConversationId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      const toolDescriptions = getToolDescriptionsText();
      const now = new Date();
      let systemContent = SYSTEM_PROMPT
        .replace('{CURRENT_TIME}', now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long' }))
        .replace('{TOOL_DESCRIPTIONS}', toolDescriptions);

      if (selectedAgent.systemPromptAddition) {
        systemContent += `\n\n${selectedAgent.systemPromptAddition}`;
      }

      const chatHistory = recentMessages.reverse().map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const messages: ChatMessage[] = [
        { role: 'system', content: systemContent },
        ...chatHistory.slice(-10),
        { role: 'user', content },
      ];

      let fullContent = '';
      const provider = getProvider();

      for await (const chunk of callAIChatStream(messages, provider)) {
        fullContent += chunk;
        sendSSE('chunk', { content: chunk });
      }

      const toolCalls = parseToolCalls(fullContent);
      const toolResults: ToolResult[] = [];

      if (toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          if (!selectedAgent.availableTools.includes(toolCall.name)) {
            toolResults.push({
              name: toolCall.name,
              success: false,
              data: null,
              message: `工具 ${toolCall.name} 在当前智能体模式下不可用`,
            });
            continue;
          }

          const result = await executeToolCall(toolCall, request.userId!, request.ip);
          toolResults.push(result);
        }

        sendSSE('tool_results', { results: toolResults });

        const toolFeedbackParts = toolResults.map((r) => {
          if (r.success) {
            return `${r.name}: ✅ ${r.message}`;
          }
          return `${r.name}: ❌ ${r.message}`;
        });

        const toolFeedback = toolFeedbackParts.join('\n');

        messages.push({ role: 'assistant', content: fullContent });
        messages.push({
          role: 'user',
          content: `工具执行结果：\n${toolFeedback}\n\n请根据工具执行结果，给用户一个简洁的确认回复。`,
        });

        let followUpContent = '';
        for await (const chunk of callAIChatStream(messages, provider)) {
          followUpContent += chunk;
          sendSSE('chunk', { content: chunk });
        }

        fullContent = followUpContent;
      }

      const cleanContent = stripToolCalls(fullContent);

      const assistantMessage = await prisma.chatMessage.create({
        data: {
          userId: request.userId!,
          conversationId: activeConversationId,
          role: 'assistant',
          content: cleanContent,
          agentType: selectedAgent.id,
          metadata: JSON.stringify({}),
        },
      });

      await prisma.conversation.update({
        where: { id: activeConversationId },
        data: { updatedAt: new Date() },
      });

      sendSSE('done', { conversationId: activeConversationId, userMessage, assistantMessage });
    } catch (error) {
      sendSSE('error', { message: (error as Error).message || 'AI回复失败' });
    }

    reply.raw.end();
  });

  fastify.get('/api/ai/profile', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const profile = await prisma.profile.findUnique({
      where: { userId: request.userId },
    });

    if (!profile) {
      const newProfile = await prisma.profile.create({
        data: { userId: request.userId! },
      });
      return reply.send({ success: true, data: newProfile });
    }

    return reply.send({ success: true, data: profile });
  });

  fastify.put<{ Body: UpdateProfileBody }>('/api/ai/profile', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const body = request.body;

    const updateData: Record<string, string> = {};
    const fields = ['nickname', 'personality', 'height', 'weight', 'hobbies', 'occupation', 'bio',
      'birthday', 'gender', 'location', 'education', 'relationship', 'healthCondition',
      'dietPreference', 'sleepSchedule', 'workSchedule', 'favoriteFoods', 'dislikedFoods',
      'favoriteMusic', 'favoriteSports', 'lifeGoals'];

    for (const field of fields) {
      if ((body as Record<string, string | undefined>)[field] !== undefined) {
        updateData[field] = (body as Record<string, string | undefined>)[field] as string;
      }
    }

    const profile = await prisma.profile.upsert({
      where: { userId: request.userId! },
      update: updateData,
      create: {
        userId: request.userId!,
        ...updateData,
      },
    });

    return reply.send({
      success: true,
      data: profile,
      message: '个人信息更新成功',
    });
  });

  fastify.get('/api/ai/memory', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const items = await prisma.memoryItem.findMany({
      where: { userId: request.userId },
      orderBy: { updatedAt: 'desc' },
    });

    const grouped: Record<string, typeof items> = {};
    for (const item of items) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }

    return reply.send({ success: true, data: { items, grouped } });
  });

  fastify.post<{ Body: CreateMemoryBody }>('/api/ai/memory', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { category, key, value } = request.body;
    if (!category || !key || !value) {
      return reply.status(400).send({ success: false, message: '请提供分类、键名和值' });
    }

    const item = await prisma.memoryItem.upsert({
      where: {
        userId_category_key: {
          userId: request.userId!,
          category,
          key,
        },
      },
      create: {
        userId: request.userId!,
        category,
        key,
        value,
        source: 'manual',
        confidence: 100,
        isVerified: true,
      },
      update: {
        value,
        source: 'manual',
        confidence: 100,
        isVerified: true,
      },
    });

    return reply.send({ success: true, data: item, message: '记忆项保存成功' });
  });

  fastify.delete<{ Params: { id: string } }>('/api/ai/memory/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const item = await prisma.memoryItem.findFirst({ where: { id, userId: request.userId } });
    if (!item) {
      return reply.status(404).send({ success: false, message: '记忆项不存在' });
    }
    await prisma.memoryItem.delete({ where: { id } });
    return reply.send({ success: true, message: '记忆项已删除' });
  });

  fastify.get('/api/ai/comprehensive-analysis', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

      const [diaries, goals, habits, habitLogs, events, profile] = await Promise.all([
        prisma.diary.findMany({
          where: { userId: request.userId!, isDeleted: false, createdAt: { gte: thirtyDaysAgo } },
          orderBy: { createdAt: 'desc' },
          take: 30,
        }),
        prisma.goal.findMany({ where: { userId: request.userId!, status: 'ACTIVE' } }),
        prisma.habit.findMany({ where: { userId: request.userId! } }),
        prisma.habitLog.findMany({
          where: { habit: { userId: request.userId! }, logDate: { gte: thirtyDaysAgo } },
          orderBy: { logDate: 'desc' },
          take: 100,
        }),
        prisma.event.findMany({
          where: { userId: request.userId!, startTime: { gte: thirtyDaysAgo } },
          orderBy: { startTime: 'desc' },
          take: 30,
        }),
        prisma.profile.findUnique({ where: { userId: request.userId } }),
      ]);

      const totalDiaries = await prisma.diary.count({ where: { userId: request.userId!, isDeleted: false } });
      const avgScore = diaries.length > 0 ? Math.round(diaries.reduce((s, d) => s + d.emotionScore, 0) / diaries.length) : 0;

      const emotionBuckets: Record<string, number> = {};
      diaries.forEach((d) => {
        JSON.parse(d.emotionTags).forEach((t: string) => {
          emotionBuckets[t] = (emotionBuckets[t] || 0) + 1;
        });
      });
      const topEmotions = Object.entries(emotionBuckets).sort((a, b) => b[1] - a[1]).slice(0, 5);

      const habitCompletionRate = habitLogs.length > 0
        ? Math.round((habitLogs.filter((l) => l.isCompleted).length / habitLogs.length) * 100)
        : 0;

      const goalProgressAvg = goals.length > 0
        ? Math.round(goals.reduce((s, g) => s + g.progress, 0) / goals.length)
        : 0;

      const contextData = {
        user: { nickname: profile?.nickname, occupation: profile?.occupation, personality: profile?.personality },
        period: '近30天',
        totalDiaries,
        recentDiaries: diaries.length,
        averageEmotionScore: avgScore,
        topEmotions,
        activeGoals: goals.map((g) => ({ title: g.title, progress: g.progress, deadline: g.deadline })),
        habits: habits.map((h) => ({ title: h.title, streak: h.streakCurrent, frequency: h.frequency })),
        habitCompletionRate,
        goalProgressAvg,
        eventCount: events.length,
        diaryContentSamples: diaries.slice(0, 5).map((d) => ({
          date: d.createdAt.toLocaleDateString('zh-CN'),
          score: d.emotionScore,
          content: d.content.slice(0, 100),
        })),
      };

      const prompt = `你是一位专业的心理咨询师、生活教练和数据分析师。请基于以下用户近30天的数据，进行全面的深度分析。

用户数据:
${JSON.stringify(contextData, null, 2)}

请从以下6个维度进行深度分析，每个维度给出具体、有洞察力的内容：

1. **情绪健康分析**：分析情绪变化趋势、主要情绪模式、潜在的情绪风险
2. **生活节奏评估**：评估日记记录频率、作息规律性、生活充实度
3. **目标进展分析**：分析目标完成度、进度是否合理、需要调整的地方
4. **习惯坚持评估**：评估习惯完成率、连续打卡情况、坚持建议
5. **综合生活建议**：基于以上分析给出3-5条具体的、可执行的生活改善建议
6. **AI特别关注**：发现用户可能忽视的问题或潜在风险

请用温暖专业的语气，中文回复，简洁有力。每个维度控制在2-3句话内。`;

      let analysis: string;
      try {
        const provider = getProvider();
        analysis = await callAI(prompt, provider);
      } catch {
        analysis = `**情绪健康分析**：近30天平均情绪指数${avgScore}分，${avgScore >= 60 ? '整体情绪状态良好' : avgScore >= 40 ? '情绪波动较大，建议关注心理健康' : '情绪偏低，建议寻求专业支持'}。主要情绪为${topEmotions.map(([t]) => t).join('、')}。

**生活节奏评估**：近30天记录了${diaries.length}篇日记，${diaries.length >= 15 ? '记录频率良好' : '建议增加记录频率'}。共有${events.length}个日程安排。

**目标进展分析**：当前有${goals.length}个活跃目标，平均进度${goalProgressAvg}%。${goalProgressAvg >= 50 ? '进度良好，继续保持' : '建议重新评估目标可行性，拆分为更小的里程碑'}。

**习惯坚持评估**：习惯完成率${habitCompletionRate}%，${habitCompletionRate >= 70 ? '坚持得不错' : '需要加强习惯养成'}。最长连续打卡${habits.length > 0 ? Math.max(...habits.map((h) => h.streakCurrent)) : 0}天。

**综合生活建议**：
1. 保持每日日记记录习惯，关注情绪变化
2. 为目标设定每周小里程碑，及时庆祝小成就
3. 习惯打卡设定提醒，避免中断
4. 保持社交联系，分享心情

**AI特别关注**：${avgScore < 40 ? '你的情绪指数持续偏低，如果感到困扰，建议与专业心理咨询师交流。全国24小时心理援助热线：400-161-9995' : '暂无特别需要关注的风险，继续保持良好的生活节奏！'}`;
      }

      return reply.send({
        success: true,
        data: {
          analysis,
          summary: {
            totalDiaries,
            recentDiaryCount: diaries.length,
            averageScore: avgScore,
            topEmotions,
            activeGoalCount: goals.length,
            goalProgressAvg,
            habitCount: habits.length,
            habitCompletionRate,
            eventCount: events.length,
          },
        },
      });
    } catch (error) {
      return reply.status(500).send({ success: false, message: '综合分析失败' });
    }
  });

  fastify.post<{ Body: { diaryId: string } }>('/api/ai/deep-analyze', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { diaryId } = request.body;
    if (!diaryId) {
      return reply.status(400).send({ success: false, message: '缺少日记ID' });
    }

    const diary = await prisma.diary.findFirst({
      where: { id: diaryId, userId: request.userId, isDeleted: false },
      include: {
        attachments: {
          select: { originalName: true, fileType: true, aiAnnotation: true },
        },
      },
    });

    if (!diary) {
      return reply.status(404).send({ success: false, message: '日记不存在' });
    }

    const [user, events, recentDiaries] = await Promise.all([
      prisma.user.findUnique({
        where: { id: request.userId },
        include: { profile: true },
      }),
      prisma.event.findMany({
        where: {
          userId: request.userId,
          startTime: {
            gte: new Date(diary.createdAt.getTime() - 3 * 86400000).toISOString(),
            lte: new Date(diary.createdAt.getTime() + 3 * 86400000).toISOString(),
          },
        },
        orderBy: { startTime: 'asc' },
      }),
      prisma.diary.findMany({
        where: {
          userId: request.userId,
          isDeleted: false,
          createdAt: { lte: diary.createdAt },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          attachments: {
            select: { originalName: true, fileType: true, aiAnnotation: true },
          },
        },
      }),
    ]);

    let contextInfo = `日记内容: ${diary.content}\n情绪分数: ${diary.emotionScore}\n情绪标签: ${diary.emotionTags}`;

    const diaryAttachments = diary.attachments || [];
    if (diaryAttachments.length > 0) {
      contextInfo += '\n\n日记附件:\n' + diaryAttachments.map((a, i) => {
        const typeLabel = a.fileType === 'image' ? '图片' : a.fileType === 'video' ? '视频' : a.fileType === 'audio' ? '音频' : '文档';
        return `附件${i + 1} [${typeLabel}] ${a.originalName}:\n${a.aiAnnotation}`;
      }).join('\n\n');
    }

    if (user?.profile) {
      const p = user.profile;
      const info: string[] = [];
      if (p.nickname) info.push(`昵称: ${p.nickname}`);
      if (p.occupation) info.push(`职业: ${p.occupation}`);
      if (p.hobbies) info.push(`爱好: ${p.hobbies}`);
      if (p.personality) info.push(`性格: ${p.personality}`);
      if (p.healthCondition) info.push(`健康状况: ${p.healthCondition}`);
      if (info.length > 0) contextInfo += `\n\n用户信息: ${info.join(', ')}`;
    }

    if (events.length > 0) {
      contextInfo += '\n\n相关日程: ' + events.map((e) => e.title).join(', ');
    }

    if (recentDiaries.length > 1) {
      contextInfo += '\n\n近期日记趋势:\n' + recentDiaries.map((d) => {
        const dAttachments = (d as { attachments?: Array<{ originalName: string; fileType: string; aiAnnotation: string }> }).attachments || [];
        const attInfo = dAttachments.length > 0
          ? ' [附件: ' + dAttachments.map((a) => `${a.originalName}: ${a.aiAnnotation.slice(0, 50)}`).join('; ') + ']'
          : '';
        return `- [${d.createdAt.toLocaleDateString('zh-CN')}] 情绪${d.emotionScore}分 "${d.content.slice(0, 100)}${d.content.length > 100 ? '...' : ''}"${attInfo}`;
      }).join('\n');
    }

    const prompt = `你是一个专业的心理咨询师和生活顾问。请对以下日记进行深度分析，结合用户的个人信息、日程安排和情绪趋势，提供专业的建议。

${contextInfo}

请从以下维度分析：
1. 情绪解读：深入分析用户的情绪状态
2. 潜在需求：用户可能未直接表达的需求
3. 生活建议：结合日程和个人信息的具体建议
4. 情绪趋势：结合近期日记分析情绪变化
5. 行动方案：具体的、可执行的行动建议

请用温暖专业的语气回复，中文，简洁有力。`;

    let analysis: string;
    try {
      const provider = getProvider();
      if (provider === 'local') {
        analysis = generateLocalDeepAnalysis(diary.content, diary.emotionScore, JSON.parse(diary.emotionTags));
      } else {
        analysis = await callAI(prompt, provider);
      }
    } catch {
      analysis = generateLocalDeepAnalysis(diary.content, diary.emotionScore, JSON.parse(diary.emotionTags));
    }

    const updated = await prisma.diary.update({
      where: { id: diaryId },
      data: { aiInsight: analysis },
    });

    return reply.send({
      success: true,
      data: { ...updated, emotionTags: JSON.parse(updated.emotionTags), mediaUrls: JSON.parse(updated.mediaUrls), analysis },
      message: 'AI深度分析完成',
    });
  });

  async function executeToolCall(toolCall: ToolCall, userId: string, ip?: string): Promise<ToolResult> {
    const args = toolCall.arguments;

    switch (toolCall.name) {
      case 'add_event': {
        try {
          const title = args.title as string;
          const startTime = args.startTime as string;
          const endTime = args.endTime as string;
          if (!title || !startTime || !endTime) {
            return { name: toolCall.name, success: false, data: null, message: '缺少必要参数：title, startTime, endTime' };
          }
          await prisma.event.create({
            data: {
              userId,
              title,
              description: (args.description as string) || null,
              startTime: new Date(startTime),
              endTime: new Date(endTime),
              isAllDay: (args.isAllDay as boolean) || false,
              color: (args.color as string) || 'blue',
              reminderMinutes: (args.reminderMinutes as number) || 15,
              isAiCreated: true,
              aiSuggestion: 'AI通过工具调用创建',
            },
          });
          return { name: toolCall.name, success: true, data: { title, startTime, endTime }, message: `日程「${title}」已创建` };
        } catch (e) {
          return { name: toolCall.name, success: false, data: null, message: `创建日程失败: ${(e as Error).message}` };
        }
      }

      case 'add_diary': {
        try {
          const diaryContent = args.content as string;
          if (!diaryContent) {
            return { name: toolCall.name, success: false, data: null, message: '缺少必要参数：content' };
          }
          let emotion = { score: 50, tags: ['平静'], insight: '' };
          try {
            emotion = await analyzeEmotion(diaryContent);
          } catch {
            // emotion analysis failed, use defaults
          }
          await prisma.diary.create({
            data: {
              userId,
              content: diaryContent,
              emotionScore: emotion.score,
              emotionTags: JSON.stringify(emotion.tags),
              aiInsight: emotion.insight || null,
              mediaUrls: '[]',
            },
          });
          return { name: toolCall.name, success: true, data: { emotionScore: emotion.score }, message: '日记已创建' };
        } catch (e) {
          return { name: toolCall.name, success: false, data: null, message: `创建日记失败: ${(e as Error).message}` };
        }
      }

      case 'add_goal': {
        try {
          const title = args.title as string;
          if (!title) {
            return { name: toolCall.name, success: false, data: null, message: '缺少必要参数：title' };
          }
          await prisma.goal.create({
            data: {
              userId,
              title,
              description: (args.description as string) || null,
              deadline: args.deadline ? new Date(args.deadline as string) : null,
            },
          });
          return { name: toolCall.name, success: true, data: { title }, message: `目标「${title}」已创建` };
        } catch (e) {
          return { name: toolCall.name, success: false, data: null, message: `创建目标失败: ${(e as Error).message}` };
        }
      }

      case 'search_weather': {
        try {
          const location = args.location as string;
          if (!location) {
            return { name: toolCall.name, success: false, data: null, message: '缺少必要参数：location' };
          }
          const weatherData = await getWeatherForLocation(location, ip);
          return {
            name: toolCall.name,
            success: true,
            data: {
              location: `${weatherData.location.province}${weatherData.location.city}`,
              current: weatherData.current,
              forecast: weatherData.forecast,
              air: weatherData.air,
              alerts: weatherData.alerts,
              summary: weatherData.summary,
            },
            message: `已获取${weatherData.location.province}${weatherData.location.city}的天气信息`,
          };
        } catch (e) {
          return { name: toolCall.name, success: false, data: null, message: `获取天气失败: ${(e as Error).message}` };
        }
      }

      case 'get_location': {
        try {
          const location = await getUserLocation(ip);
          return {
            name: toolCall.name,
            success: true,
            data: {
              province: location.province,
              city: location.city,
              district: location.district,
            },
            message: `用户当前位置: ${location.province}${location.city}${location.district}`,
          };
        } catch (e) {
          return { name: toolCall.name, success: false, data: null, message: `获取位置失败: ${(e as Error).message}` };
        }
      }

      case 'save_memory': {
        try {
          const category = args.category as string;
          const key = args.key as string;
          const value = args.value as string;
          if (!category || !key || !value) {
            return { name: toolCall.name, success: false, data: null, message: '缺少必要参数：category, key, value' };
          }
          await prisma.memoryItem.upsert({
            where: {
              userId_category_key: { userId, category, key },
            },
            create: {
              userId,
              category,
              key,
              value,
              source: 'ai_tool',
              confidence: 85,
              isVerified: false,
            },
            update: {
              value,
              source: 'ai_tool',
              confidence: 85,
            },
          });
          await updateProfileFromMemory(userId, category, key, value);
          return { name: toolCall.name, success: true, data: { category, key, value }, message: `已记忆: ${key} = ${value}` };
        } catch (e) {
          return { name: toolCall.name, success: false, data: null, message: `保存记忆失败: ${(e as Error).message}` };
        }
      }

      case 'update_profile': {
        try {
          const field = args.field as string;
          const value = args.value as string;
          if (!field || !value) {
            return { name: toolCall.name, success: false, data: null, message: '缺少必要参数：field, value' };
          }
          const allowedFields = ['nickname', 'personality', 'height', 'weight', 'hobbies', 'occupation', 'bio',
            'birthday', 'gender', 'location', 'education', 'relationship', 'healthCondition',
            'dietPreference', 'sleepSchedule', 'workSchedule', 'favoriteFoods', 'dislikedFoods',
            'favoriteMusic', 'favoriteSports', 'lifeGoals'];
          if (!allowedFields.includes(field)) {
            return { name: toolCall.name, success: false, data: null, message: `不允许更新的字段: ${field}` };
          }
          await prisma.profile.upsert({
            where: { userId },
            update: { [field]: value },
            create: { userId, [field]: value },
          });
          return { name: toolCall.name, success: true, data: { field, value }, message: `已更新用户画像: ${field}` };
        } catch (e) {
          return { name: toolCall.name, success: false, data: null, message: `更新画像失败: ${(e as Error).message}` };
        }
      }

      case 'analyze_emotion_trend': {
        try {
          const days = (args.days as number) || 7;
          const startDate = new Date(Date.now() - days * 86400000);
          const diaries = await prisma.diary.findMany({
            where: {
              userId,
              isDeleted: false,
              createdAt: { gte: startDate },
            },
            orderBy: { createdAt: 'asc' },
            include: {
              attachments: {
                select: { originalName: true, fileType: true, aiAnnotation: true },
              },
            },
          });

          if (diaries.length === 0) {
            return { name: toolCall.name, success: true, data: { trend: 'no_data', message: '近期没有日记记录' }, message: '近期没有日记数据，无法分析情绪趋势' };
          }

          const scores = diaries.map((d) => d.emotionScore);
          const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
          const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
          const secondHalf = scores.slice(Math.floor(scores.length / 2));
          const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length : avgScore;
          const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length : avgScore;
          const trendDirection = secondAvg > firstAvg + 5 ? 'improving' : secondAvg < firstAvg - 5 ? 'declining' : 'stable';
          const allTags = diaries.flatMap((d) => JSON.parse(d.emotionTags));
          const tagCounts: Record<string, number> = {};
          allTags.forEach((t: string) => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
          const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);

          return {
            name: toolCall.name,
            success: true,
            data: {
              diaryCount: diaries.length,
              averageScore: avgScore,
              trendDirection,
              firstHalfAvg: Math.round(firstAvg),
              secondHalfAvg: Math.round(secondAvg),
              topEmotionTags: topTags,
              dailyScores: diaries.map((d) => ({
                date: d.createdAt.toLocaleDateString('zh-CN'),
                score: d.emotionScore,
                contentPreview: d.content.slice(0, 80),
                attachmentCount: d.attachments.length,
                attachmentSummary: d.attachments.slice(0, 2).map((a) => `${a.originalName}: ${a.aiAnnotation.slice(0, 50)}`).join('; '),
              })),
            },
            message: `情绪趋势分析: ${trendDirection === 'improving' ? '上升' : trendDirection === 'declining' ? '下降' : '稳定'}，平均${avgScore}分，主要情绪: ${topTags.join('、')}`,
          };
        } catch (e) {
          return { name: toolCall.name, success: false, data: null, message: `情绪趋势分析失败: ${(e as Error).message}` };
        }
      }

      case 'analyze_schedule': {
        try {
          const days = (args.days as number) || 7;
          const startDate = new Date();
          const endDate = new Date(Date.now() + days * 86400000);
          const events = await prisma.event.findMany({
            where: {
              userId,
              startTime: { gte: startDate, lte: endDate },
            },
            orderBy: { startTime: 'asc' },
          });

          const dayMap: Record<string, { count: number; totalMinutes: number; titles: string[] }> = {};
          const conflicts: { date: string; event1: string; event2: string }[] = [];

          for (let i = 0; i < events.length; i++) {
            const e = events[i];
            const dateKey = e.startTime.toLocaleDateString('zh-CN');
            if (!dayMap[dateKey]) dayMap[dateKey] = { count: 0, totalMinutes: 0, titles: [] };
            dayMap[dateKey].count++;
            dayMap[dateKey].titles.push(e.title);
            dayMap[dateKey].totalMinutes += (e.endTime.getTime() - e.startTime.getTime()) / 60000;

            for (let j = i + 1; j < events.length; j++) {
              const e2 = events[j];
              if (e2.startTime < e.endTime && e2.endTime > e.startTime) {
                conflicts.push({
                  date: dateKey,
                  event1: e.title,
                  event2: e2.title,
                });
              }
            }
          }

          const busyDays = Object.entries(dayMap)
            .filter(([, v]) => v.totalMinutes > 480)
            .map(([k]) => k);
          const freeDays: string[] = [];
          for (let i = 0; i < days; i++) {
            const d = new Date(Date.now() + i * 86400000).toLocaleDateString('zh-CN');
            if (!dayMap[d]) freeDays.push(d);
          }

          return {
            name: toolCall.name,
            success: true,
            data: {
              totalEvents: events.length,
              conflicts,
              busyDays,
              freeDays,
              dailySummary: Object.entries(dayMap).map(([date, v]) => ({
                date,
                eventCount: v.count,
                totalHours: Math.round(v.totalMinutes / 60 * 10) / 10,
              })),
            },
            message: `日程分析: ${events.length}个日程, ${conflicts.length}个冲突, ${busyDays.length}天过忙, ${freeDays.length}天空闲`,
          };
        } catch (e) {
          return { name: toolCall.name, success: false, data: null, message: `日程分析失败: ${(e as Error).message}` };
        }
      }

      case 'analyze_goal_progress': {
        try {
          const goals = await prisma.goal.findMany({
            where: { userId, status: 'ACTIVE' },
            include: { habits: true, events: true },
          });

          if (goals.length === 0) {
            return { name: toolCall.name, success: true, data: { goalCount: 0 }, message: '当前没有进行中的目标' };
          }

          const goalAnalysis = goals.map((g) => {
            const daysSinceCreation = Math.max(1, Math.ceil((Date.now() - g.createdAt.getTime()) / 86400000));
            const daysRemaining = g.deadline ? Math.max(0, Math.ceil((g.deadline.getTime() - Date.now()) / 86400000)) : null;
            const expectedProgress = Math.min(100, Math.round((daysSinceCreation / (daysSinceCreation + (daysRemaining || daysSinceCreation))) * 100));
            const isBehind = g.progress < expectedProgress - 15;
            const habitStreaks = g.habits.map((h) => h.streakCurrent);
            const maxStreak = habitStreaks.length > 0 ? Math.max(...habitStreaks) : 0;

            return {
              title: g.title,
              progress: g.progress,
              expectedProgress,
              isBehind,
              daysRemaining,
              habitCount: g.habits.length,
              maxHabitStreak: maxStreak,
              relatedEventCount: g.events.length,
            };
          });

          const behindGoals = goalAnalysis.filter((g) => g.isBehind);

          return {
            name: toolCall.name,
            success: true,
            data: {
              goalCount: goals.length,
              behindCount: behindGoals.length,
              goals: goalAnalysis,
            },
            message: `目标分析: ${goals.length}个目标, ${behindGoals.length}个落后于预期进度`,
          };
        } catch (e) {
          return { name: toolCall.name, success: false, data: null, message: `目标分析失败: ${(e as Error).message}` };
        }
      }

      case 'add_habit': {
        try {
          const title = args.title as string;
          if (!title) {
            return { name: toolCall.name, success: false, data: null, message: '缺少必要参数：title' };
          }
          await prisma.habit.create({
            data: {
              userId,
              title,
              description: (args.description as string) || null,
              frequency: (args.frequency as string) || 'DAILY',
              targetDays: (args.targetDays as number) || 30,
            },
          });
          return { name: toolCall.name, success: true, data: { title }, message: `习惯「${title}」已创建` };
        } catch (e) {
          return { name: toolCall.name, success: false, data: null, message: `创建习惯失败: ${(e as Error).message}` };
        }
      }

      case 'recognize_schedule': {
        try {
          const attachmentId = args.attachmentId as string;
          const semesterStart = args.semesterStart as string;
          const weekCount = (args.weekCount as number) || 16;
          if (!attachmentId || !semesterStart) {
            return { name: toolCall.name, success: false, data: null, message: '缺少必要参数：attachmentId, semesterStart' };
          }
          const attachment = await prisma.attachment.findFirst({
            where: { id: attachmentId, userId },
          });
          if (!attachment) {
            return { name: toolCall.name, success: false, data: null, message: '附件不存在' };
          }
          if (attachment.fileType !== 'image') {
            return { name: toolCall.name, success: false, data: null, message: '仅支持图片类型的课表识别' };
          }
          return {
            name: toolCall.name,
            success: true,
            data: {
              attachmentId,
              semesterStart,
              weekCount,
              annotation: attachment.aiAnnotation,
              hint: '请使用课表识别结果为用户创建课表日程，先展示识别结果让用户确认，确认后再批量创建',
            },
            message: `已获取课表图片信息，请分析图片内容并提取课程信息，展示给用户确认后再创建日程`,
          };
        } catch (e) {
          return { name: toolCall.name, success: false, data: null, message: `课表识别失败: ${(e as Error).message}` };
        }
      }

      case 'add_holidays': {
        try {
          const year = (args.year as number) || new Date().getFullYear();
          const holidays = getChineseHolidays(year);
          let added = 0;
          for (const h of holidays) {
            const existing = await prisma.event.findFirst({
              where: {
                userId,
                isHoliday: true,
                holidayName: h.name,
                startTime: new Date(h.date),
              },
            });
            if (!existing) {
              await prisma.event.create({
                data: {
                  userId,
                  title: h.name,
                  startTime: new Date(h.date),
                  endTime: new Date(h.date),
                  isAllDay: true,
                  color: 'red',
                  isHoliday: true,
                  holidayName: h.name,
                },
              });
              added++;
            }
          }
          return {
            name: toolCall.name,
            success: true,
            data: { year, added, total: holidays.length },
            message: `已添加${year}年${added}个法定节假日到日程表`,
          };
        } catch (e) {
          return { name: toolCall.name, success: false, data: null, message: `添加节假日失败: ${(e as Error).message}` };
        }
      }

      default:
        return { name: toolCall.name, success: false, data: null, message: `未知工具: ${toolCall.name}` };
    }
  }

  async function updateProfileFromMemory(userId: string, category: string, key: string, value: string) {
    const fieldMapping: Record<string, Record<string, string>> = {
      basic: { '姓名': 'nickname', '昵称': 'nickname', '年龄': 'nickname', '性别': 'gender', '生日': 'birthday', '所在地': 'location', '学历': 'education' },
      health: { '身高': 'height', '体重': 'weight', '健康状况': 'healthCondition', '饮食偏好': 'dietPreference' },
      lifestyle: { '作息': 'sleepSchedule', '爱好': 'hobbies', '音乐品味': 'favoriteMusic', '运动': 'favoriteSports' },
      preference: { '喜欢的食物': 'favoriteFoods', '不喜欢的食物': 'dislikedFoods' },
      work: { '职业': 'occupation', '工作时间': 'workSchedule', '工作目标': 'lifeGoals' },
      social: { '感情状况': 'relationship' },
    };

    const categoryMap = fieldMapping[category];
    if (!categoryMap) return;

    const profileField = categoryMap[key];
    if (!profileField) return;

    try {
      await prisma.profile.upsert({
        where: { userId },
        update: { [profileField]: value },
        create: { userId, [profileField]: value },
      });
    } catch {
      // ignore
    }
  }

  async function generateMemorySummary(userId: string) {
    try {
      const items = await prisma.memoryItem.findMany({
        where: { userId, confidence: { gte: 60 } },
        orderBy: { updatedAt: 'desc' },
        take: 30,
      });

      if (items.length === 0) return;

      const grouped: Record<string, string[]> = {};
      for (const item of items) {
        if (!grouped[item.category]) grouped[item.category] = [];
        grouped[item.category].push(`${item.key}: ${item.value}`);
      }

      const summaryText = Object.entries(grouped)
        .map(([cat, vals]) => `[${cat}] ${vals.join('; ')}`)
        .join(' | ');

      if (summaryText.length > 500) {
        const truncated = summaryText.slice(0, 500) + '...';
        await prisma.profile.upsert({
          where: { userId },
          update: { aiMemorySummary: truncated },
          create: { userId, aiMemorySummary: truncated },
        });
      } else {
        await prisma.profile.upsert({
          where: { userId },
          update: { aiMemorySummary: summaryText },
          create: { userId, aiMemorySummary: summaryText },
        });
      }
    } catch {
      // ignore summary generation errors
    }
  }

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

  function generateLocalResponse(
    userContent: string,
    todayEvents: { title: string; startTime: Date; isAllDay: boolean }[],
    recentDiaries: { content: string; emotionScore: number; emotionTags: string }[],
    profile: { nickname: string; occupation: string; hobbies: string } | null
  ): string {
    const name = profile?.nickname || '朋友';
    const lowerContent = userContent.toLowerCase();

    if (lowerContent.includes('日程') || lowerContent.includes('安排') || lowerContent.includes('计划')) {
      if (todayEvents.length > 0) {
        return `你好${name}！你今天有${todayEvents.length}个日程：${todayEvents.map((e) => e.title).join('、')}。需要我帮你调整安排吗？`;
      }
      return `你好${name}！今天暂时没有日程安排。要不要我帮你规划一下今天的安排？`;
    }

    if (lowerContent.includes('心情') || lowerContent.includes('情绪') || lowerContent.includes('感觉')) {
      if (recentDiaries.length > 0) {
        const latest = recentDiaries[0];
        const score = latest.emotionScore;
        if (score >= 60) {
          return `${name}，从你最近的日记来看，你的心情还不错呢！继续保持积极的心态，有什么开心的事情也可以和我分享哦。`;
        }
        return `${name}，我注意到你最近的心情似乎不太好。如果有什么烦恼，可以和我说说，我会尽力帮你的。`;
      }
      return `${name}，你现在的感觉怎么样？如果有什么想说的，我随时都在。`;
    }

    if (lowerContent.includes('建议') || lowerContent.includes('帮忙') || lowerContent.includes('怎么办')) {
      return `${name}，我很乐意帮你！能具体说说你需要什么方面的建议吗？我可以从日程安排、情绪管理、生活习惯等方面给你专业的建议。`;
    }

    if (profile?.occupation && lowerContent.includes('工作')) {
      return `作为${profile.occupation}，工作压力一定不小吧${name}。记得合理安排休息时间，保持工作与生活的平衡。需要我帮你规划一下日程吗？`;
    }

    if (profile?.hobbies && (lowerContent.includes('兴趣') || lowerContent.includes('爱好'))) {
      return `我记得你喜欢${profile.hobbies}，这些爱好对调节心情很有帮助！最近有在坚持吗？`;
    }

    return `${name}，谢谢你的分享！我会记住这些信息的。有什么我可以帮你的，随时告诉我。无论是日程管理、情绪分析还是生活建议，我都在这里。`;
  }

  function generateLocalDeepAnalysis(
    _content: string,
    score: number,
    tags: string[]
  ): string {
    const emotionLevel = score >= 70 ? '积极' : score >= 50 ? '中性偏积极' : score >= 30 ? '中性偏消极' : '消极';
    const tagStr = tags.length > 0 ? tags.join('、') : '平静';

    return `**情绪解读**：你的日记情绪指数为${score}分，整体情绪${emotionLevel}。主要情绪标签为${tagStr}。

**潜在需求**：从日记内容来看，你可能需要更多的自我关注和情绪表达空间。

**生活建议**：建议保持规律的作息，适当运动，与朋友保持社交联系。

**行动方案**：
1. 每天留出15分钟独处时间，进行冥想或深呼吸
2. 坚持记录日记，关注情绪变化
3. 如有困扰，及时与信任的人沟通`;
  }
};

export default aiRoutes;
