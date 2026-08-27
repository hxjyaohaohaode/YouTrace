import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { z } from 'zod'
import { prisma } from '../utils/db.js'
import { generateId } from '../utils/id.js'
import type { AuthUser } from '../middleware/auth.js'
import { env } from '../utils/env.js'
import { consumeRateLimit, getClientIp } from '../utils/rateLimit.js'
import { addDays, getToday } from '../utils/date.js'
import { readChatCompletionStream } from '../services/openAiStream.js'
import { computeHabitStats } from '../services/habitStats.js'

export const chatRoutes = new Hono()

const chatSchema = z.object({
  sessionId: z.string().min(8).max(64).optional(),
  message: z.string().trim().min(1).max(2000),
})

chatRoutes.get('/sessions', async (c) => {
  const user = c.get('user') as AuthUser
  const sessions = await prisma.chatSession.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, triggerType: true, createdAt: true },
  })
  return c.json({ sessions })
})

chatRoutes.get('/sessions/:id/messages', async (c) => {
  const user = c.get('user') as AuthUser
  const sessionId = c.req.param('id')

  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId: user.id },
  })
  if (!session) return c.json({ error: '会话不存在' }, 404)

  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { id: true, sessionId: true, role: true, content: true, actions: true, createdAt: true },
  })

  return c.json({
    messages: messages.map((m) => ({
      ...m,
      actions: m.actions ? safeParseJson(m.actions, null) : null,
    })),
  })
})

function safeParseJson<T>(value: string, fallback: T): T | unknown {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

chatRoutes.post('/', async (c) => {
  const user = c.get('user') as AuthUser
  const body = await c.req.json()
  const parsed = chatSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  const { sessionId, message } = parsed.data
  const clientIp = getClientIp(c)
  const rateLimit = consumeRateLimit(`chat:${user.id}:${clientIp}`, {
    limit: 20,
    windowMs: 60 * 1000,
  })

  if (!rateLimit.allowed) {
    c.header('Retry-After', String(rateLimit.retryAfterSeconds))
    return c.json({ error: '消息发送过于频繁，请稍后再试' }, 429)
  }

  let session
  if (sessionId) {
    session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId: user.id },
    })
  }
  if (!session) {
    session = await prisma.chatSession.create({
      data: {
        id: generateId(),
        userId: user.id,
        triggerType: 'user_initiated',
      },
    })
  }

  await prisma.chatMessage.create({
    data: {
      id: generateId(),
      sessionId: session.id,
      role: 'user',
      content: message,
    },
  })

  const history = (await prisma.chatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })).reverse()

  const [dbUser, contextData] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id } }),
    buildUserContext(user.id),
  ])

  const systemPrompt = buildCoachSystemPrompt(dbUser?.coachStyle || 'gentle', contextData)

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ]

  c.header('X-Session-Id', session.id)
  c.header('Content-Type', 'text/event-stream')
  c.header('Cache-Control', 'no-cache, no-transform')
  c.header('X-Accel-Buffering', 'no')

  return stream(c, async (s) => {
    let fullContent = ''
    let fallbackActions: Array<Record<string, unknown>> = []

    if (!env.llmApiKey) {
      const fallback = generateFallbackResponse(message, contextData)
      fullContent = fallback.content
      fallbackActions = fallback.actions
      await s.write(`data: ${JSON.stringify({ content: fullContent })}\n\n`)
      if (fallbackActions.length > 0) {
        await s.write(`data: ${JSON.stringify({ actions: fallbackActions })}\n\n`)
      }
    } else {
      try {
        const response = await fetch(`${env.llmBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.llmApiKey}`,
          },
          body: JSON.stringify({
            model: env.llmModel,
            messages,
            stream: true,
            temperature: 0.7,
            max_tokens: 1000,
          }),
          signal: AbortSignal.timeout(env.llmTimeoutMs),
        })

        if (!response.ok) {
          throw new Error(`LLM API error: ${response.status}`)
        }

        if (!response.body) {
          throw new Error('LLM stream unavailable')
        }

        for await (const delta of readChatCompletionStream(response.body)) {
          fullContent += delta
          await s.write(`data: ${JSON.stringify({ content: delta })}\n\n`)
        }
      } catch {
        const recovery = fullContent
          ? '\n\n生成连接已中断，请稍后重试。'
          : '抱歉，我暂时无法连接到服务，请稍后再试。'
        fullContent += recovery
        await s.write(`data: ${JSON.stringify({ content: recovery })}\n\n`)
      }
    }

    const { cleanContent, actions } = fallbackActions.length > 0
      ? { cleanContent: fullContent, actions: fallbackActions }
      : extractCoachActions(fullContent)

    if (cleanContent) {
      await prisma.chatMessage.create({
        data: {
          id: generateId(),
          sessionId: session.id,
          role: 'assistant',
          content: cleanContent,
          actions: actions.length > 0 ? JSON.stringify(actions) : null,
        },
      })
    }

    if (actions.length > 0) {
      await s.write(`data: ${JSON.stringify({ actions })}\n\n`)
    }

    await s.write(`data: [DONE]\n\n`)
  })
})

const NAVIGABLE_PATHS = new Set([
  '/', '/expense', '/todo', '/habit', '/diary', '/schedule', '/coach', '/insights', '/quick-note', '/settings',
])

const coachActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('navigate'),
    path: z.string().refine((p) => NAVIGABLE_PATHS.has(p), '未知路径'),
    label: z.string().trim().min(1).max(30),
  }),
  z.object({
    type: z.literal('add_todo'),
    text: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(30),
  }),
  z.object({
    type: z.literal('log_expense'),
    name: z.string().trim().min(1).max(100),
    amountFen: z.number().int().positive().max(100_000_000_00),
    category: z.enum(['food', 'transport', 'entertainment', 'study', 'daily', 'other']),
    label: z.string().trim().min(1).max(30),
  }),
  z.object({
    type: z.literal('check_habit'),
    name: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(30),
  }),
])

const coachActionsSchema = z.array(coachActionSchema).max(3)

function extractCoachActions(rawContent: string): { cleanContent: string; actions: unknown[] } {
  const marker = '```coach-actions'
  const startIndex = rawContent.lastIndexOf(marker)
  if (startIndex === -1) return { cleanContent: rawContent.trim(), actions: [] }

  const blockStart = rawContent.indexOf('\n', startIndex)
  if (blockStart === -1) return { cleanContent: rawContent.slice(0, startIndex).trim(), actions: [] }
  const endTag = rawContent.indexOf('```', blockStart)
  if (endTag === -1) return { cleanContent: rawContent.slice(0, startIndex).trim(), actions: [] }

  const jsonText = rawContent.slice(blockStart + 1, endTag).trim()
  const before = rawContent.slice(0, startIndex).trim()
  const after = rawContent.slice(endTag + 3).trim()

  try {
    const parsed: unknown = JSON.parse(jsonText)
    const result = coachActionsSchema.safeParse(parsed)
    if (!result.success) return { cleanContent: (before + '\n' + after).trim(), actions: [] }
    return { cleanContent: (before + '\n' + after).trim(), actions: result.data }
  } catch {
    return { cleanContent: (before + '\n' + after).trim(), actions: [] }
  }
}

interface UserContext {
  recentExpenses: { total: number; count: number; categories: Record<string, number> }
  habits: { name: string; done: boolean; streak: number }[]
  recentTodos: { text: string; done: boolean; priority: string }[]
  recentDiary: { mood: string | null; moodScore: number | null; date: string }[]
  schedules: { title: string; startTime: string; date: string }[]
}

async function buildUserContext(userId: string): Promise<UserContext> {
  const today = getToday()
  const weekAgo = addDays(today, -7)

  const [expenses, habits, todos, diaries, schedules] = await Promise.all([
    prisma.expense.findMany({
      where: { userId, date: { gte: weekAgo } },
      select: { amount: true, category: true },
    }),
    prisma.habit.findMany({
      where: { userId },
      select: { id: true, name: true },
    }),
    prisma.todo.findMany({
      where: { userId, done: false },
      select: { text: true, done: true, priority: true },
      take: 10,
    }),
    prisma.diary.findMany({
      where: { userId, date: { gte: weekAgo } },
      select: { mood: true, moodScore: true, date: true },
      orderBy: { date: 'desc' },
      take: 5,
    }),
    prisma.schedule.findMany({
      where: { userId, date: { gte: today } },
      select: { title: true, startTime: true, date: true },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      take: 10,
    }),
  ])

  const categories: Record<string, number> = {}
  for (const e of expenses) {
    categories[e.category] = (categories[e.category] || 0) + e.amount
  }

  const habitStats = await computeHabitStats(userId, habits.map((h) => h.id))

  return {
    recentExpenses: {
      total: expenses.reduce((s, e) => s + e.amount, 0),
      count: expenses.length,
      categories,
    },
    habits: habits.map((h) => {
      const stat = habitStats.get(h.id)
      return {
        name: h.name,
        done: stat?.done ?? false,
        streak: stat?.streak ?? 0,
      }
    }),
    recentTodos: todos.map((t) => ({
      text: t.text,
      done: t.done,
      priority: t.priority,
    })),
    recentDiary: diaries.map((d) => ({
      mood: d.mood,
      moodScore: d.moodScore,
      date: d.date,
    })),
    schedules: schedules.map((s) => ({
      title: s.title,
      startTime: s.startTime,
      date: s.date,
    })),
  }
}

function buildCoachSystemPrompt(style: string, ctx: UserContext): string {
  const styleMap: Record<string, string> = {
    gentle: '你是一个温和的生活教练，善于倾听和引导。用鼓励的语气，避免说教。',
    strict: '你是一个严格的问责教练。强调承诺和执行，直接指出问题。',
    data: '你是一个数据驱动的教练。用数据说话，给出具体的数字和分析。',
  }

  return `${styleMap[style] || styleMap.gentle}

你是"有迹"AI生活教练，帮助用户管理生活、养成好习惯、合理消费。

用户数据摘要：
- 最近7天消费：¥${(ctx.recentExpenses.total / 100).toFixed(0)}（${ctx.recentExpenses.count}笔）
- 消费分类：${Object.entries(ctx.recentExpenses.categories).map(([k, v]) => `${k} ¥${(v / 100).toFixed(0)}`).join('、') || '暂无'}
- 习惯：${ctx.habits.map((h) => `${h.name}${h.done ? `✅(连续${h.streak}天)` : '❌'}`).join('、') || '暂未设置'}
- 待办：${ctx.recentTodos.map((t) => `${t.text}(${t.priority})`).join('、') || '暂无'}
- 近期日程：${ctx.schedules.map((s) => `${s.date} ${s.startTime} ${s.title}`).join('；') || '暂无'}
- 近期日记情绪：${ctx.recentDiary.map((d) => `${d.date} ${d.mood || '未标注'}`).join('、') || '暂无'}

原则：
1. 基于用户真实数据给出个性化建议，绝不编造数据
2. 每次对话导向具体可执行的行动
3. 不评判，不说教，只分析和建议
4. 语气像朋友，不像系统
5. 回复简洁，不超过200字
6. 如果用户情绪低落，减少建议，增加陪伴
7. 检测到危机关键词时，提供心理援助热线400-161-9995

动作能力（可选）：
当你的建议需要用户去执行一个具体操作时，可以在回复的最末尾追加一个动作块，格式：
\`\`\`coach-actions
[{"type":"add_todo","text":"买洗衣液","label":"记入待办"}]
\`\`\`
可用动作（最多3个，只在真正有帮助时使用，不要每条消息都加）：
- {"type":"add_todo","text":"待办内容(≤200字)","label":"按钮文案(≤30字)"}
- {"type":"log_expense","name":"名称","amountFen":整数分,"category":"food|transport|entertainment|study|daily|other","label":"按钮文案"}
- {"type":"check_habit","name":"习惯名","label":"按钮文案"}
- {"type":"navigate","path":"/expense|/todo|/habit|/diary|/schedule|/insights|/quick-note","label":"按钮文案"}
规则：金额单位是分（30元=3000）；动作块必须是回复的最后内容；用户确认后才会执行。`
}

interface CoachActionPayload {
  type: 'navigate' | 'add_todo' | 'log_expense' | 'check_habit'
  label: string
  [key: string]: unknown
}

function generateFallbackResponse(message: string, ctx: UserContext): { content: string; actions: CoachActionPayload[] } {
  const lowerMsg = message.toLowerCase()

  if (lowerMsg.includes('花') || lowerMsg.includes('钱') || lowerMsg.includes('消费')) {
    const topCategory = Object.entries(ctx.recentExpenses.categories).sort((a, b) => b[1] - a[1])[0]
    return {
      content: `最近7天你一共消费了¥${(ctx.recentExpenses.total / 100).toFixed(0)}，共${ctx.recentExpenses.count}笔。\n\n消费大头：${Object.entries(ctx.recentExpenses.categories).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ¥${(v / 100).toFixed(0)}`).join('、') || '暂无数据'}。\n\n要不要我帮你分析一下消费习惯？`,
      actions: [
        { type: 'navigate', path: '/expense', label: '查看花销明细' },
        ...(topCategory && topCategory[0] in CATEGORY_ZH
          ? [{ type: 'navigate' as const, path: '/insights', label: `看看${CATEGORY_ZH[topCategory[0]]}相关洞察` }]
          : []),
      ],
    }
  }

  if (lowerMsg.includes('习惯') || lowerMsg.includes('打卡')) {
    const pendingHabit = ctx.habits.find((h) => !h.done)
    return {
      content: `今天的习惯完成情况：${ctx.habits.filter((h) => h.done).length}/${ctx.habits.length}\n\n${ctx.habits.map((h) => `${h.done ? '✅' : '⬜'} ${h.name}`).join('\n')}\n\n${ctx.habits.every((h) => h.done) && ctx.habits.length > 0 ? '全部完成，太棒了！🔥' : '还有习惯没完成，加油！'}`,
      actions: pendingHabit
        ? [{ type: 'check_habit', name: pendingHabit.name, label: `打卡「${pendingHabit.name.slice(0, 12)}」` }]
        : [{ type: 'navigate', path: '/habit', label: '管理我的习惯' }],
    }
  }

  if (lowerMsg.includes('待办') || lowerMsg.includes('todo')) {
    return {
      content: `你还有${ctx.recentTodos.length}个待办：\n\n${ctx.recentTodos.slice(0, 5).map((t) => `• ${t.text}`).join('\n')}\n\n需要我帮你安排优先级吗？`,
      actions: [{ type: 'navigate', path: '/todo', label: '打开待办清单' }],
    }
  }

  if (lowerMsg.includes('日程') || lowerMsg.includes('安排') || lowerMsg.includes('明天')) {
    if (ctx.schedules.length === 0) {
      return {
        content: '最近没有安排日程，要不要规划一下？',
        actions: [{ type: 'navigate', path: '/schedule', label: '去安排日程' }],
      }
    }
    return {
      content: `近期日程：\n\n${ctx.schedules.slice(0, 5).map((s) => `📅 ${s.date} ${s.startTime} ${s.title}`).join('\n')}\n\n有什么需要调整的吗？`,
      actions: [{ type: 'navigate', path: '/schedule', label: '查看完整日程' }],
    }
  }

  return {
    content: '你好！我是你的生活教练，可以帮你：\n\n• 查看消费情况和预算\n• 检查习惯完成状态\n• 安排待办和日程\n• 分析你的生活规律\n\n有什么想聊的？',
    actions: [],
  }
}

const CATEGORY_ZH: Record<string, string> = {
  food: '餐饮',
  transport: '交通',
  entertainment: '娱乐',
  study: '学习',
  daily: '日用',
  other: '其他',
}
