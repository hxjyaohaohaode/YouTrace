import { FastifyPluginAsync } from 'fastify';
import fs from 'fs';
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
  type ContentPart,
} from '../services/aiService.js';
import { getLocation } from '../services/locationService.js';
import { getWeatherNow, getAirQuality, getWeatherAlerts, getWeatherSummaryText, buildQWeatherLocation } from '../services/weatherService.js';
import { prismaDateToLocal } from '../utils/date.js';

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

【反幻觉和数据真实性规则】***极其重要，必须严格遵守***
- 你绝对不能编造、臆测或假设用户的任何数据（日程、目标、习惯、日记、情绪、天气等）
- 当你需要引用用户的任何数据时，必须先调用相应的工具获取真实数据
- 用户已有日程→先调用analyze_schedule获取数据后，再基于真实数据回复
- 用户已有目标→先调用analyze_goal_progress获取数据后，再基于真实数据回复
- 不要在没有数据支持的情况下说"你的日程显示..."、"根据你的数据..."
- 如果你不确定某个数据是否存在，先调用工具查询，而不是猜测
- 如果你调用了工具但没有得到结果（如今天没有日程），要如实告知用户，而不是编造内容
- 不要说"我看到你的日程表上有XXX"除非你真的调用了工具并获取了该数据
- 需要最新资讯、事实核查或超出你知识范围的信息→先调用web_search联网搜索权威来源，再基于搜索结果回复
- 搜索时使用简洁准确的关键词，获得结果后归纳总结告知用户，并附上来源链接
- 搜索得到URL后如果摘要信息不够详细→调用fetch_webpage获取页面完整内容，确保信息准确充分后再回复

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

async function buildUserContext(userId: string, ip: string | undefined, attachmentIds?: string[], longitude?: number, latitude?: number): Promise<string> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });

  const [todayEvents, upcomingEvents, recentDiaries, activeGoals, recentHabits, habitLogs, memoryItems] = await Promise.all([
    prisma.event.findMany({
      where: { userId, startTime: { lte: endOfDay }, endTime: { gte: startOfDay } },
      orderBy: { startTime: 'asc' },
    }),
    prisma.event.findMany({
      where: { userId, startTime: { gte: now.toISOString() } },
      orderBy: { startTime: 'asc' },
      take: 5,
    }),
    prisma.diary.findMany({
      where: { userId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { attachments: { select: { originalName: true, fileType: true, aiAnnotation: true } } },
    }),
    prisma.goal.findMany({ where: { userId, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.habit.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.habitLog.findMany({
      where: { habit: { userId }, logDate: { gte: new Date(now.getTime() - 7 * 86400000) } },
      orderBy: { logDate: 'desc' },
      take: 30,
    }),
    prisma.memoryItem.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 20 }),
  ]);

  let contextInfo = '';
  const timeStr = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${['日', '一', '二', '三', '四', '五', '六'][now.getDay()]}`;
  contextInfo += `\n\n【重要】当前精确时间: ${timeStr}（服务器本地时间，Asia/Shanghai时区）。你必须使用这个时间，不要臆测时间！`;

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
    contextInfo += '\n\n今日日程:\n' + todayEvents.map((e) => {
      const start = prismaDateToLocal(new Date(e.startTime));
      const end = prismaDateToLocal(new Date(e.endTime));
      const sh = String(start.getHours()).padStart(2, '0');
      const sm = String(start.getMinutes()).padStart(2, '0');
      const eh = String(end.getHours()).padStart(2, '0');
      const em = String(end.getMinutes()).padStart(2, '0');
      return `- ${e.title} (${e.isAllDay ? '全天' : `${sh}:${sm} - ${eh}:${em}`})${e.isCourse && e.courseTeacher ? ' | 教师: ' + e.courseTeacher : ''}${e.isCourse && e.courseLocation ? ' | 教室: ' + e.courseLocation : ''}`;
    }).join('\n');
  }

  if (upcomingEvents.length > 0) {
    contextInfo += '\n\n即将到来的日程:\n' + upcomingEvents.map((e) => {
      const start = prismaDateToLocal(new Date(e.startTime));
      const m = String(start.getMonth() + 1).padStart(2, '0');
      const d = String(start.getDate()).padStart(2, '0');
      const h = String(start.getHours()).padStart(2, '0');
      const min = String(start.getMinutes()).padStart(2, '0');
      return `- ${e.title} (${m}月${d}日 ${h}:${min})`;
    }).join('\n');
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
      locationInfo = await getLocation(ip);
    }
    if (locationInfo.city || locationInfo.province) {
      contextInfo += `\n\n用户位置: ${locationInfo.province}${locationInfo.city}${locationInfo.district}`;
      const locationParam = await buildQWeatherLocation(locationInfo.longitude, locationInfo.latitude, locationInfo.city || locationInfo.province);
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
          const weatherSummary = getWeatherSummaryText(weatherData.now, airData?.now || null, alertData?.alerts || []);
          contextInfo += `\n\n当前天气信息: ${weatherSummary}`;
        } catch { /* weather unavailable */ }
      }
    }
  } catch { /* location unavailable */ }

  if (attachmentIds && attachmentIds.length > 0) {
    const attachments = await prisma.attachment.findMany({
      where: { id: { in: attachmentIds }, userId },
      select: { id: true, originalName: true, fileType: true, aiAnnotation: true, mimeType: true, annotationStatus: true },
    });
    if (attachments.length > 0) {
      contextInfo += '\n\n用户上传的附件:\n' + attachments.map((a, i) => {
        const typeLabel = a.fileType === 'image' ? '图片' : a.fileType === 'video' ? '视频' : a.fileType === 'audio' ? '音频' : '文档';
        const annotation = a.annotationStatus === 'completed' && a.aiAnnotation
          ? a.aiAnnotation
          : a.annotationStatus === 'processing'
            ? '[附件正在分析中]'
            : '[附件分析未完成，请根据文件名和类型推断内容]';
        return `附件${i + 1} [${typeLabel}] ${a.originalName} (MIME: ${a.mimeType}):\n${annotation}`;
      }).join('\n\n');
    }
  }

  return contextInfo;
}

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

    let conversations: Awaited<ReturnType<typeof prisma.conversation.findMany<{
      include: {
        messages: { orderBy: { createdAt: 'desc' }; take: number; select: { content: true; role: true; createdAt: true } };
        _count: { select: { messages: true } };
      };
    }>>> = [];
    let total = 0;

    if (search) {
      const matchingMessageConvIds = await prisma.chatMessage.findMany({
        where: {
          userId: request.userId!,
          content: { contains: search, mode: 'insensitive' as const },
        },
        select: { conversationId: true },
        distinct: ['conversationId'],
      });
      const matchingAttachmentConvIds = await prisma.attachment.findMany({
        where: {
          userId: request.userId!,
          OR: [
            { originalName: { contains: search, mode: 'insensitive' as const } },
            { aiAnnotation: { contains: search, mode: 'insensitive' as const } },
          ],
          chatMessageId: { not: null },
        },
        select: { chatMessage: { select: { conversationId: true } } },
      });
      const attachmentConvIds = matchingAttachmentConvIds
        .map((a) => a.chatMessage?.conversationId)
        .filter((id): id is string => id != null);

      const convIdsFromMessages = matchingMessageConvIds
        .map((m) => m.conversationId)
        .filter((id): id is string => id != null);

      const allMatchingIds = [...new Set([...convIdsFromMessages, ...attachmentConvIds])];

      const includeConfig = {
        messages: {
          orderBy: { createdAt: 'desc' as const },
          take: 1,
          select: { content: true, role: true, createdAt: true },
        },
        _count: { select: { messages: true } },
      };

      if (allMatchingIds.length > 0) {
        const where = {
          userId: request.userId!,
          OR: [
            { title: { contains: search, mode: 'insensitive' as const } },
            { id: { in: allMatchingIds } },
          ],
        };
        [conversations, total] = await Promise.all([
          prisma.conversation.findMany({ where, orderBy: { updatedAt: 'desc' }, skip, take: limit, include: includeConfig }),
          prisma.conversation.count({ where }),
        ]);
      } else {
        const where = {
          userId: request.userId!,
          title: { contains: search, mode: 'insensitive' as const },
        };
        [conversations, total] = await Promise.all([
          prisma.conversation.findMany({ where, orderBy: { updatedAt: 'desc' }, skip, take: limit, include: includeConfig }),
          prisma.conversation.count({ where }),
        ]);
      }
    } else {
      const where = { userId: request.userId! };
      const includeConfig = {
        messages: {
          orderBy: { createdAt: 'desc' as const },
          take: 1,
          select: { content: true, role: true, createdAt: true },
        },
        _count: { select: { messages: true } },
      };
      [conversations, total] = await Promise.all([
        prisma.conversation.findMany({ where, orderBy: { updatedAt: 'desc' }, skip, take: limit, include: includeConfig }),
        prisma.conversation.count({ where }),
      ]);
    }

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
        messages: conversation.messages.map((m) => {
          let metadata: Record<string, unknown> = {};
          try { metadata = JSON.parse(m.metadata); } catch { /* ignore */ }
          return {
            ...m,
            metadata,
            attachmentIds: (metadata.attachmentIds as string[]) || undefined,
            attachmentNames: (metadata.attachmentNames as string[]) || undefined,
            attachmentMeta: (metadata.attachmentMeta as Array<{ id: string; originalName: string; fileType: string; thumbnailPath: string | null; filePath: string | null }>) || undefined,
          };
        }),
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
      data: messages.reverse().map((m) => {
        let metadata: Record<string, unknown> = {};
        try { metadata = JSON.parse(m.metadata); } catch { /* ignore */ }
        return {
          ...m,
          metadata,
          attachmentIds: (metadata.attachmentIds as string[]) || undefined,
          attachmentNames: (metadata.attachmentNames as string[]) || undefined,
          attachmentMeta: (metadata.attachmentMeta as Array<{ id: string; originalName: string; fileType: string; thumbnailPath: string | null; filePath: string | null }>) || undefined,
        };
      }),
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

    let attachments: Array<{ id: string; originalName: string; fileType: string; aiAnnotation: string; mimeType: string; thumbnailPath: string | null; filePath: string }> = [];
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
          thumbnailPath: true,
          filePath: true,
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
          attachmentMeta: attachments.map((a) => ({ id: a.id, originalName: a.originalName, fileType: a.fileType, thumbnailPath: a.thumbnailPath, filePath: a.filePath })),
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

    const contextInfo = await buildUserContext(request.userId!, request.ip, attachmentIds, longitude, latitude);

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

    const now = new Date();
    const currentTimeStr = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${['日', '一', '二', '三', '四', '五', '六'][now.getDay()]}`;
    let systemContent = SYSTEM_PROMPT
      .replace('{CURRENT_TIME}', currentTimeStr)
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

    let userContentWithAttachments: string | ContentPart[] = content;
    if (attachments.length > 0) {
      const provider = getProvider();
      const imageAttachments = attachments.filter((a) => a.fileType === 'image');
      const nonImageAttachments = attachments.filter((a) => a.fileType !== 'image');

      if (provider === 'mimo' && imageAttachments.length > 0) {
        const contentParts: ContentPart[] = [];

        let textPrefix = content;
        if (nonImageAttachments.length > 0) {
          textPrefix += '\n\n我还上传了以下非图片附件:\n' + nonImageAttachments.map((a, i) => {
            const typeLabel = a.fileType === 'video' ? '视频' : a.fileType === 'audio' ? '音频' : '文档';
            return `附件${i + 1} [${typeLabel}] ${a.originalName}:\n${a.aiAnnotation}`;
          }).join('\n\n');
        }
        contentParts.push({ type: 'text', text: textPrefix });

        for (const imgAtt of imageAttachments) {
          const fullAtt = await prisma.attachment.findFirst({
            where: { id: imgAtt.id, userId: request.userId! },
            select: { filePath: true, mimeType: true },
          });
          try {
            if (fullAtt?.filePath && fs.existsSync(fullAtt.filePath)) {
              const fileBuffer = fs.readFileSync(fullAtt.filePath);
              const base64Data = fileBuffer.toString('base64');
              contentParts.push({
                type: 'image_url',
                image_url: { url: `data:${fullAtt.mimeType};base64,${base64Data}` },
              });
              if (imgAtt.aiAnnotation) {
                contentParts.push({ type: 'text', text: `\n[图片 ${imgAtt.originalName} 的AI描述: ${imgAtt.aiAnnotation}]` });
              }
            } else {
              contentParts.push({ type: 'text', text: `\n[图片 ${imgAtt.originalName}]: ${imgAtt.aiAnnotation || '[图片文件无法读取]'}` });
            }
          } catch {
            contentParts.push({ type: 'text', text: `\n[图片 ${imgAtt.originalName}]: ${imgAtt.aiAnnotation || '[图片读取失败]'}` });
          }
        }

        userContentWithAttachments = contentParts;
      } else {
        userContentWithAttachments = content + '\n\n我上传了以下附件:\n' + attachments.map((a, i) => {
          const typeLabel = a.fileType === 'image' ? '图片' : a.fileType === 'video' ? '视频' : a.fileType === 'audio' ? '音频' : '文档';
          return `附件${i + 1} [${typeLabel}] ${a.originalName}:\n${a.aiAnnotation}`;
        }).join('\n\n');
      }
    }

    messages.push({ role: 'user', content: userContentWithAttachments });

    let aiContent: string;
    const toolResults: ToolResult[] = [];

    try {
      const provider = getProvider();
      if (provider === 'local') {
        aiContent = generateLocalResponse(content);
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
      aiContent = generateLocalResponse(content);
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

    let fullContent = '';
    let activeConversationId: string | undefined = conversationId;

    try {
      const selectedAgent = getAgentById(agentType || 'default');

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

      let attachmentNames: string[] = [];
      let attachmentMeta: Array<{ id: string; originalName: string; fileType: string; thumbnailPath: string | null; filePath: string | null }> = [];
      if (attachmentIds && attachmentIds.length > 0) {
        const attMeta = await prisma.attachment.findMany({
          where: { id: { in: attachmentIds }, userId: request.userId },
          select: { id: true, originalName: true, fileType: true, thumbnailPath: true, filePath: true },
        });
        attachmentNames = attMeta.map((a) => a.originalName);
        attachmentMeta = attMeta;
      }

      const userMessage = await prisma.chatMessage.create({
        data: {
          userId: request.userId!,
          conversationId: activeConversationId,
          role: 'user',
          content: content.trim(),
          agentType: selectedAgent.id,
          metadata: JSON.stringify({
            attachmentIds: attachmentIds || [],
            attachmentNames,
            attachmentMeta,
          }),
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
      const currentTimeStr = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${['日', '一', '二', '三', '四', '五', '六'][now.getDay()]}`;
      let systemContent = SYSTEM_PROMPT
        .replace('{CURRENT_TIME}', currentTimeStr)
        .replace('{TOOL_DESCRIPTIONS}', toolDescriptions);

      if (selectedAgent.systemPromptAddition) {
        systemContent += `\n\n${selectedAgent.systemPromptAddition}`;
      }

      const contextInfo = await buildUserContext(request.userId!, request.ip, attachmentIds, _longitude, _latitude);
      systemContent += `\n\n--- 用户上下文 ---\n${contextInfo}`;

      const chatHistory = recentMessages.reverse().map((m) => {
        let msgContent = m.content;
        try {
          const meta = JSON.parse(m.metadata);
          if (meta.attachmentNames && meta.attachmentNames.length > 0 && m.role === 'user') {
            msgContent += `\n\n[用户在此消息中上传了附件: ${meta.attachmentNames.join(', ')}]`;
          }
          if (meta.attachmentIds && meta.attachmentIds.length > 0 && m.role === 'user' && !meta.attachmentNames) {
            msgContent += `\n\n[用户在此消息中上传了${meta.attachmentIds.length}个附件]`;
          }
        } catch { /* ignore */ }
        return {
          role: m.role as 'user' | 'assistant',
          content: msgContent,
        };
      });

      let userContentWithAttachments: string | ContentPart[] = content;
      if (attachmentIds && attachmentIds.length > 0) {
        const attachments = await prisma.attachment.findMany({
          where: { id: { in: attachmentIds }, userId: request.userId },
          select: { id: true, originalName: true, fileType: true, aiAnnotation: true, annotationStatus: true, mimeType: true, filePath: true },
        });

        if (attachments.length > 0) {
          const provider = getProvider();
          const hasImages = attachments.some((a) => a.fileType === 'image');
          const imageAttachments = attachments.filter((a) => a.fileType === 'image');
          const nonImageAttachments = attachments.filter((a) => a.fileType !== 'image');

          if (provider === 'mimo' && hasImages) {
            const contentParts: ContentPart[] = [];

            let textPrefix = content;
            if (nonImageAttachments.length > 0) {
              textPrefix += '\n\n我还上传了以下非图片附件:\n' + nonImageAttachments.map((a, i) => {
                const typeLabel = a.fileType === 'video' ? '视频' : a.fileType === 'audio' ? '音频' : '文档';
                const annotation = a.annotationStatus === 'completed' && a.aiAnnotation
                  ? a.aiAnnotation
                  : `[${typeLabel}文件 ${a.originalName}]`;
                return `附件${i + 1} [${typeLabel}] ${a.originalName}:\n${annotation}`;
              }).join('\n\n');
            }
            contentParts.push({ type: 'text', text: textPrefix });

            for (const imgAtt of imageAttachments) {
              try {
                if (fs.existsSync(imgAtt.filePath)) {
                  const fileBuffer = fs.readFileSync(imgAtt.filePath);
                  const base64Data = fileBuffer.toString('base64');
                  contentParts.push({
                    type: 'image_url',
                    image_url: { url: `data:${imgAtt.mimeType};base64,${base64Data}` },
                  });
                  const imgAnnotation = imgAtt.annotationStatus === 'completed' && imgAtt.aiAnnotation
                    ? `\n[图片 ${imgAtt.originalName} 的AI描述: ${imgAtt.aiAnnotation}]`
                    : '';
                  if (imgAnnotation) {
                    contentParts.push({ type: 'text', text: imgAnnotation });
                  }
                } else {
                  const fallback = imgAtt.annotationStatus === 'completed' && imgAtt.aiAnnotation
                    ? imgAtt.aiAnnotation
                    : '[图片文件无法读取]';
                  contentParts.push({ type: 'text', text: `\n[图片 ${imgAtt.originalName}]: ${fallback}` });
                }
              } catch {
                const fallback = imgAtt.aiAnnotation || '[图片读取失败]';
                contentParts.push({ type: 'text', text: `\n[图片 ${imgAtt.originalName}]: ${fallback}` });
              }
            }

            userContentWithAttachments = contentParts;
          } else {
            userContentWithAttachments = content + '\n\n我上传了以下附件:\n' + attachments.map((a, i) => {
              const typeLabel = a.fileType === 'image' ? '图片' : a.fileType === 'video' ? '视频' : a.fileType === 'audio' ? '音频' : '文档';
              const annotation = a.annotationStatus === 'completed' && a.aiAnnotation
                ? a.aiAnnotation
                : a.annotationStatus === 'processing'
                  ? '[附件正在分析中，请基于文件名和类型给出初步回应]'
                  : '[附件分析未完成，请基于文件名和类型给出初步回应]';
              return `附件${i + 1} [${typeLabel}] ${a.originalName}:\n${annotation}`;
            }).join('\n\n');
          }
        }
      }

      const messages: ChatMessage[] = [
        { role: 'system', content: systemContent },
        ...chatHistory.slice(-10),
        { role: 'user', content: userContentWithAttachments },
      ];

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

      try {
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
      } catch { /* memory extraction failed, ignore */ }

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
      if (fullContent && activeConversationId) {
        try {
          const partialContent = stripToolCalls(fullContent);
          if (partialContent.trim()) {
            await prisma.chatMessage.create({
              data: {
                userId: request.userId!,
                conversationId: activeConversationId,
                role: 'assistant',
                content: partialContent + '\n\n[回复被中断，部分内容可能不完整]',
                agentType: (agentType as string) || 'default',
                metadata: JSON.stringify({ interrupted: true }),
              },
            });
          }
        } catch { /* save failed, ignore */ }
      }
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

    const prompt = `你是一个专业的心理咨询师和生活顾问。请对以下日记进行深度分析，结合用户的个人信息、日程安排和情绪趋势，提供精准的建议。

${contextInfo}

请用2-3句话简洁分析，要求：
1. 精准指出核心情绪或问题
2. 结合用户日程/习惯给出1条可执行建议
3. 如果发现情绪趋势变化，简要指出

中文回复，简洁有力，不超过100字。`;

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
          const existing = await prisma.memoryItem.findUnique({
            where: { userId_category_key: { userId, category, key } },
          });
          const confidence = existing ? Math.min(existing.confidence + 10, 100) : 80;
          await prisma.memoryItem.upsert({
            where: { userId_category_key: { userId, category, key } },
            create: {
              userId, category, key, value,
              source: 'ai_auto',
              confidence,
              isVerified: false,
            },
            update: {
              value,
              source: 'ai_auto',
              confidence,
            },
          });
          await updateProfileFromMemory(userId, category, key, value);
          return {
            name: toolCall.name,
            success: true,
            data: { category, key, value, confidence },
            message: existing
              ? `更新记忆: ${category}/${key} = ${value} (置信度${confidence}%)`
              : `新增记忆: ${category}/${key} = ${value}`,
          };
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

          const dayMap: Record<string, { count: number; totalMinutes: number; titles: string[]; eventsDetail: string[] }> = {};
          const conflicts: { date: string; event1: string; event2: string }[] = [];

          for (let i = 0; i < events.length; i++) {
            const e = events[i];
            const localStart = prismaDateToLocal(new Date(e.startTime));
            const localEnd = prismaDateToLocal(new Date(e.endTime));
            const dateKey = localStart.toLocaleDateString('zh-CN');
            if (!dayMap[dateKey]) dayMap[dateKey] = { count: 0, totalMinutes: 0, titles: [], eventsDetail: [] };
            dayMap[dateKey].count++;
            dayMap[dateKey].titles.push(e.title);
            const durationMin = Math.round((localEnd.getTime() - localStart.getTime()) / 60000);
            dayMap[dateKey].totalMinutes += durationMin;
            const pad = (n: number) => String(n).padStart(2, '0');
            const timeStr = `${pad(localStart.getHours())}:${pad(localStart.getMinutes())}-${pad(localEnd.getHours())}:${pad(localEnd.getMinutes())}`;
            dayMap[dateKey].eventsDetail.push(`  ${e.title} | ${timeStr}${e.courseLocation ? ' | ' + e.courseLocation : ''}${e.isCourse ? ' [课程]' : ''}`);

            for (let j = i + 1; j < events.length; j++) {
              const e2 = events[j];
              if (e2.startTime < e.endTime && e2.endTime > e.startTime) {
                const ls1 = prismaDateToLocal(new Date(e.startTime));
                const le1 = prismaDateToLocal(new Date(e.endTime));
                const ls2 = prismaDateToLocal(new Date(e2.startTime));
                const le2 = prismaDateToLocal(new Date(e2.endTime));
                conflicts.push({
                  date: dateKey,
                  event1: `${e.title}(${ls1.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}-${le1.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })})`,
                  event2: `${e2.title}(${ls2.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}-${le2.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })})`,
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
              daysAnalyzed: days,
              conflicts,
              busyDays,
              freeDays,
              dailySummary: Object.entries(dayMap).map(([date, v]) => ({
                date,
                eventCount: v.count,
                totalHours: Math.round(v.totalMinutes / 60 * 10) / 10,
                events: v.eventsDetail.join('\n'),
              })),
            },
            message: `日程分析完成: 共${events.length}个日程, ${conflicts.length}个冲突${conflicts.length > 0 ? '【需关注】' : ''}, ${busyDays.length}天过忙, ${freeDays.length}天空闲`,
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

      case 'web_search': {
        try {
          const query = (args.query as string) || '';
          const count = Math.min(args.count as number || 5, 10);
          if (!query.trim()) {
            return { name: toolCall.name, success: false, data: null, message: '请提供搜索关键词' };
          }

          const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const response = await fetch(searchUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
          });

          if (!response.ok) {
            throw new Error(`搜索请求失败: ${response.status}`);
          }

          const html = await response.text();
          const results: Array<{ title: string; snippet: string; url: string }> = [];

          const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
          const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

          let linkMatch: RegExpExecArray | null;
          const links: Array<{ title: string; url: string }> = [];
          while ((linkMatch = linkRegex.exec(html)) !== null && links.length < count) {
            const url = linkMatch[1].replace(/&amp;/g, '&');
            const title = linkMatch[2].replace(/<[^>]*>/g, '').trim();
            if (title && url && !url.startsWith('//duckduckgo.com')) {
              links.push({ title, url });
            }
          }

          let snippetMatch: RegExpExecArray | null;
          const snippets: string[] = [];
          while ((snippetMatch = snippetRegex.exec(html)) !== null && snippets.length < count) {
            snippets.push(snippetMatch[1].replace(/<[^>]*>/g, '').trim());
          }

          for (let i = 0; i < Math.min(links.length, count); i++) {
            results.push({
              title: links[i].title,
              url: links[i].url.startsWith('//') ? `https:${links[i].url}` : links[i].url,
              snippet: snippets[i] || '',
            });
          }

          if (results.length === 0) {
            return { name: toolCall.name, success: true, data: { query, results: [], count: 0 }, message: `未找到关于"${query}"的搜索结果` };
          }

          return {
            name: toolCall.name,
            success: true,
            data: { query, count: results.length, results },
            message: `找到${results.length}条关于"${query}"的搜索结果`,
          };
        } catch (e) {
          return { name: toolCall.name, success: false, data: null, message: `搜索失败: ${(e as Error).message}` };
        }
      }

      case 'fetch_webpage': {
        try {
          const url = (args.url as string) || '';
          if (!url.trim() || !url.startsWith('http')) {
            return { name: toolCall.name, success: false, data: null, message: '请提供有效的网页URL' };
          }

          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
            signal: AbortSignal.timeout(15000),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const contentType = response.headers.get('content-type') || '';
          if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
            throw new Error(`不支持的内容类型: ${contentType}`);
          }

          const html = await response.text();

          const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
            .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<\/h[1-6]>/gi, '\n\n')
            .replace(/<\/li>/gi, '\n')
            .replace(/<\/div>/gi, '\n')
            .replace(/<[^>]*>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ')
            .replace(/&[a-z]+;/gi, ' ')
            .replace(/&#\d+;/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/^\s+|\s+$/gm, '')
            .replace(/\n\s*\n\s*\n/g, '\n\n');

          const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 10);
          const uniqueLines = [...new Set(lines)];
          const maxLen = 5000;
          let result = '';
          for (const line of uniqueLines) {
            if (result.length + line.length + 2 > maxLen) {
              result += '\n\n...(内容过长，已截断)';
              break;
            }
            result += (result ? '\n' : '') + line;
          }

          if (!result.trim()) {
            return { name: toolCall.name, success: true, data: { url }, message: '未能从该页面提取到有效文字内容，可能是动态加载页面或需要登录。' };
          }

          return {
            name: toolCall.name,
            success: true,
            data: { url, content: result, length: result.length },
            message: `已获取 ${url} 的页面内容 (${result.length} 字符)`,
          };
        } catch (e) {
          return { name: toolCall.name, success: false, data: null, message: `获取网页失败: ${(e as Error).message}` };
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

  function generateLocalResponse(userContent: string): string {
    const lowerContent = userContent.toLowerCase();

    if (lowerContent.includes('日程') || lowerContent.includes('安排') || lowerContent.includes('计划')) {
      return '你好！需要我帮你规划一下安排吗？';
    }

    if (lowerContent.includes('心情') || lowerContent.includes('情绪') || lowerContent.includes('感觉')) {
      return '你现在的感觉怎么样？如果有什么想说的，我随时都在。';
    }

    if (lowerContent.includes('建议') || lowerContent.includes('帮忙') || lowerContent.includes('怎么办')) {
      return '我很乐意帮你！能具体说说你需要什么方面的建议吗？我可以从日程安排、情绪管理、生活习惯等方面给你专业的建议。';
    }

    return '谢谢你的分享！有什么我可以帮你的，随时告诉我。无论是日程管理、情绪分析还是生活建议，我都在这里。';
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

  fastify.post<{ Body: { weatherSummary: string; forecastDays: Array<{ date: string; tempMax: string; tempMin: string; textDay: string; humidity: string; windScale: string }> } }>('/api/ai/weather-suggestions', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { weatherSummary, forecastDays } = request.body;

    const now = new Date();
    const threeDaysLater = new Date(now.getTime() + 3 * 86400000);
    const events = await prisma.event.findMany({
      where: {
        userId: request.userId!,
        startTime: { gte: now, lte: threeDaysLater },
      },
      orderBy: { startTime: 'asc' },
      select: { title: true, startTime: true, endTime: true, isAllDay: true, isCourse: true, courseLocation: true },
    });

    const habits = await prisma.habit.findMany({
      where: { userId: request.userId! },
      select: { title: true, frequency: true },
    });

    const scheduleSummary = events.length > 0
      ? events.map(e => {
        const localDate = prismaDateToLocal(new Date(e.startTime));
        const day = localDate.toLocaleDateString('zh-CN', { weekday: 'short', month: 'short', day: 'numeric' });
        if (e.isAllDay) return `${day} 全天 ${e.title}`;
        const start = localDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        return `${day} ${start} ${e.title}${e.isCourse && e.courseLocation ? `(${e.courseLocation})` : ''}`;
      }).join('\n')
      : '近3天暂无日程安排';

    const habitSummary = habits.length > 0
      ? habits.map(h => `${h.title}(${h.frequency})`).join(', ')
      : '暂无进行中的习惯';

    const forecastSummary = forecastDays.map(d =>
      `${d.date} ${d.textDay} ${d.tempMin}~${d.tempMax}°C 湿度${d.humidity}% 风力${d.windScale}级`
    ).join('\n');

    const provider = getProvider();
    if (provider === 'local') {
      const suggestions: Array<{ date: string; suggestion: string }> = [];
      forecastDays.forEach(d => {
        const temp = parseInt(d.tempMax) || 20;
        const parts: string[] = [];
        if (temp < 5) parts.push('注意保暖，穿厚外套');
        else if (temp < 15) parts.push('适当添加衣物');
        else if (temp > 35) parts.push('注意防暑');
        if (d.textDay.includes('雨')) parts.push('带伞出行');
        if (d.textDay.includes('雪')) parts.push('路滑注意安全');
        if (parseInt(d.humidity) > 80) parts.push('湿度大注意除湿');
        suggestions.push({ date: d.date, suggestion: parts.join('；') || '天气适宜' });
      });
      return reply.send({ success: true, data: { suggestions } });
    }

    try {
      const prompt = `你是一个贴心的生活助手。根据天气预报和用户的日程安排，为每一天提供简洁的个性化建议。

当前天气：${weatherSummary}

未来几天预报：
${forecastSummary}

用户近3天日程：
${scheduleSummary}

用户进行中的习惯：
${habitSummary}

请为每一天提供1-2条简洁建议，要求：
1. 结合天气给出穿衣/出行建议
2. 结合用户日程给出时间安排提醒（如：有早课建议提前出发、有户外活动注意天气等）
3. 如有相关习惯，给出简短提醒
4. 每条建议不超过20字

返回JSON格式：
{
  "suggestions": [
    {"date": "日期", "suggestion": "建议内容"}
  ]
}
只返回JSON。`;

      const result = await callAI(prompt, provider);
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return reply.send({ success: true, data: { suggestions: parsed.suggestions || [] } });
      }
      return reply.send({ success: true, data: { suggestions: [] } });
    } catch {
      return reply.send({ success: true, data: { suggestions: [] } });
    }
  });
};

export default aiRoutes;
