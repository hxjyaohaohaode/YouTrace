import crypto from 'crypto';
import {
  getWeatherNow,
  getWeatherForecast,
  getAirQuality,
  getWeatherAlerts,
  getWeatherSummaryText,
  buildQWeatherLocation,
  type WeatherNowResponse,
  type ForecastResponse,
  type AirNowResponse,
  type AlertV1Response,
} from './weatherService.js';
import { locateByIp, reverseGeocode, searchCity, type LocationInfo } from './locationService.js';

interface CacheEntry {
  result: unknown;
  timestamp: number;
}

const MAX_CACHE_SIZE = 500;
const CACHE_TTL = 3600000;
const cache = new Map<string, CacheEntry>();

function getCacheKey(prompt: string, model: string): string {
  return crypto.createHash('md5').update(`${model}:${prompt}`).digest('hex');
}

function getFromCache(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

function setCache(key: string, result: unknown): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { result, timestamp: Date.now() });
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  name?: string;
}

interface AIResponse {
  choices: {
    message: {
      content: string | null;
      reasoning_content?: string;
    };
  }[];
}

async function callDeepSeek(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');

  const serialized = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: serialized,
      max_tokens: 4096,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`DeepSeek API error: ${response.status} ${errorBody}`);
  }

  const data = await response.json() as AIResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('DeepSeek returned empty content');
  }
  return content;
}

async function callMiMo(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.MIMO_API_KEY;
  const baseUrl = process.env.MIMO_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1';

  if (!apiKey) throw new Error('MIMO_API_KEY not configured');

  const serialized = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'mimo-v2.5',
      messages: serialized,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`MiMo API error: ${response.status} ${errorBody}`);
  }

  const data = await response.json() as AIResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('MiMo returned empty content');
  }
  return content;
}

type AIProvider = 'deepseek' | 'mimo' | 'local';

export function getProvider(): AIProvider {
  if (process.env.DEEPSEEK_API_KEY) return 'deepseek';
  if (process.env.MIMO_API_KEY) return 'mimo';
  return 'local';
}

export async function callAI(prompt: string, provider?: AIProvider): Promise<string> {
  const p = provider || getProvider();
  const cacheKey = getCacheKey(prompt, p);

  const cached = getFromCache(cacheKey);
  if (cached) return cached as string;

  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];

  try {
    let result: string;
    switch (p) {
      case 'deepseek':
        result = await callDeepSeek(messages);
        break;
      case 'mimo':
        result = await callMiMo(messages);
        break;
      default:
        throw new Error('No AI provider available');
    }
    setCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error(`AI call failed (${p}):`, (error as Error).message);
    throw error;
  }
}

export async function callAIChat(messages: ChatMessage[], provider?: AIProvider): Promise<string> {
  const p = provider || getProvider();

  if (p === 'local') {
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop();
    if (!lastUserMsg) return '';
    return typeof lastUserMsg.content === 'string'
      ? lastUserMsg.content
      : lastUserMsg.content.filter((c) => c.type === 'text').map((c) => c.text || '').join('');
  }

  try {
    switch (p) {
      case 'deepseek':
        return await callDeepSeek(messages);
      case 'mimo':
        return await callMiMo(messages);
      default:
        throw new Error('No AI provider available');
    }
  } catch (error) {
    console.error(`AI chat call failed (${p}):`, (error as Error).message);
    throw error;
  }
}

export async function* callAIChatStream(messages: ChatMessage[], provider?: AIProvider): AsyncGenerator<string> {
  const p = provider || getProvider();

  if (p === 'local') {
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop();
    if (lastUserMsg) {
      const textContent = typeof lastUserMsg.content === 'string'
        ? lastUserMsg.content
        : lastUserMsg.content.filter((c) => c.type === 'text').map((c) => c.text || '').join('');
      yield textContent;
    }
    return;
  }

  const apiKey = p === 'deepseek'
    ? process.env.DEEPSEEK_API_KEY
    : process.env.MIMO_API_KEY;

  const baseUrl = p === 'deepseek'
    ? (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com')
    : (process.env.MIMO_BASE_URL || 'https://api.mimoreal.com');

  const model = p === 'deepseek'
    ? (process.env.DEEPSEEK_MODEL || 'deepseek-chat')
    : (process.env.MIMO_MODEL || 'mimo-chat');

  if (!apiKey) {
    const fullResponse = await callAIChat(messages, p);
    yield fullResponse;
    return;
  }

  const serialized = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    const streamUrl = p === 'deepseek'
      ? `${baseUrl}/v1/chat/completions`
      : `${baseUrl}/chat/completions`;

    const response = await fetch(streamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: serialized,
        stream: true,
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok || !response.body) {
      const fullResponse = await callAIChat(messages, p);
      yield fullResponse;
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // skip malformed chunks
        }
      }
    }
  } catch (error) {
    console.error(`AI stream failed (${p}):`, (error as Error).message);
    const fullResponse = await callAIChat(messages, p);
    yield fullResponse;
  }
}

// ============ 工具调用系统 ============

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean; enum?: string[] }>;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  name: string;
  success: boolean;
  data: unknown;
  message: string;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'add_event',
    description: '在用户日程表上添加一个日程事件。当你识别到用户有日程安排的需求时使用此工具。',
    parameters: {
      title: { type: 'string', description: '日程标题', required: true },
      description: { type: 'string', description: '日程描述' },
      startTime: { type: 'string', description: '开始时间，ISO格式，如2024-01-15T14:00:00', required: true },
      endTime: { type: 'string', description: '结束时间，ISO格式，如2024-01-15T15:00:00', required: true },
      isAllDay: { type: 'boolean', description: '是否全天事件' },
      color: { type: 'string', description: '颜色标记', enum: ['blue', 'green', 'purple', 'orange', 'red', 'teal', 'pink', 'yellow'] },
      reminderMinutes: { type: 'number', description: '提前提醒分钟数，默认15' },
    },
  },
  {
    name: 'add_diary',
    description: '为用户创建一条日记记录。当用户描述了今天的经历、心情、感受，或表达了想记录生活的意图时使用。',
    parameters: {
      content: { type: 'string', description: '日记内容，用第一人称整理用户描述的经历和感受', required: true },
    },
  },
  {
    name: 'add_goal',
    description: '为用户创建一个目标。当用户表达了想要达成某个目标、养成某个习惯、完成某项计划时使用。',
    parameters: {
      title: { type: 'string', description: '目标标题', required: true },
      description: { type: 'string', description: '目标描述' },
      deadline: { type: 'string', description: '截止日期，ISO格式' },
    },
  },
  {
    name: 'search_weather',
    description: '搜索指定城市或位置的实时天气信息，包括温度、湿度、风力、空气质量、天气预报和预警。当你需要天气数据来给出建议时使用。',
    parameters: {
      location: { type: 'string', description: '城市名或位置，如"北京"、"上海"', required: true },
    },
  },
  {
    name: 'get_location',
    description: '获取用户当前的位置信息。当你需要知道用户所在城市来提供本地化建议时使用。',
    parameters: {},
  },
  {
    name: 'save_memory',
    description: '将用户提到的个人信息保存到记忆库。当你识别到用户的个人信息（姓名、职业、爱好、健康状况、偏好等）时主动保存。',
    parameters: {
      category: { type: 'string', description: '信息分类', enum: ['basic', 'health', 'lifestyle', 'preference', 'work', 'social'], required: true },
      key: { type: 'string', description: '信息键名，如"职业"、"爱好"', required: true },
      value: { type: 'string', description: '信息值，如"软件工程师"、"阅读"', required: true },
    },
  },
  {
    name: 'update_profile',
    description: '更新用户画像信息。当你获取到更准确的用户个人信息时，直接更新到用户画像中。',
    parameters: {
      field: { type: 'string', description: '画像字段名', enum: ['nickname', 'gender', 'birthday', 'occupation', 'location', 'education', 'relationship', 'healthCondition', 'dietPreference', 'sleepSchedule', 'workSchedule', 'hobbies', 'favoriteFoods', 'dislikedFoods', 'favoriteMusic', 'favoriteSports', 'lifeGoals', 'personality', 'height', 'weight', 'bio'], required: true },
      value: { type: 'string', description: '字段值', required: true },
    },
  },
  {
    name: 'analyze_emotion_trend',
    description: '分析用户近期的情绪变化趋势。当你需要了解用户情绪是否在改善或恶化时使用此工具，可以识别情绪周期和触发因素。',
    parameters: {
      days: { type: 'number', description: '分析最近多少天的情绪数据，默认7天' },
    },
  },
  {
    name: 'analyze_schedule',
    description: '分析用户的日程安排，检测冲突、空闲时段、日程密度等。当你需要帮用户优化时间安排或发现日程问题时使用。',
    parameters: {
      days: { type: 'number', description: '分析未来多少天的日程，默认7天' },
    },
  },
  {
    name: 'analyze_goal_progress',
    description: '分析用户的目标进度和习惯打卡情况，发现停滞或退步的目标。当你需要给出目标相关建议时使用。',
    parameters: {},
  },
  {
    name: 'add_habit',
    description: '为用户创建一个习惯。当用户表达了想要养成某个习惯、坚持某项活动时使用。',
    parameters: {
      title: { type: 'string', description: '习惯标题', required: true },
      description: { type: 'string', description: '习惯描述' },
      frequency: { type: 'string', description: '频率', enum: ['DAILY', 'WEEKLY', 'WEEKDAYS', 'CUSTOM'] },
      targetDays: { type: 'number', description: '目标天数，默认30' },
    },
  },
  {
    name: 'recognize_schedule',
    description: '识别用户上传的课表图片，提取课程信息。当用户上传了课表图片并要求识别时使用。识别后需要用户确认才会创建日程。',
    parameters: {
      attachmentId: { type: 'string', description: '附件ID', required: true },
      semesterStart: { type: 'string', description: '学期开始日期，ISO格式', required: true },
      weekCount: { type: 'number', description: '学期总周数，默认16', required: true },
    },
  },
  {
    name: 'add_holidays',
    description: '为用户添加中国法定节假日到日程表。当用户要求显示节假日时使用。',
    parameters: {
      year: { type: 'number', description: '年份', required: true },
    },
  },
  {
    name: 'web_search',
    description: '联网搜索最新的真实信息。当你需要获取实时资讯、最新新闻、事实核查、专业知识等超出你知识截止日期范围的信息时使用此工具。搜索结果会包含标题、摘要和来源链接。',
    parameters: {
      query: { type: 'string', description: '搜索关键词，用简洁的语言描述你想搜索的内容', required: true },
      count: { type: 'number', description: '返回结果数量，默认5，最大10' },
    },
  },
];

export function getToolDescriptionsText(): string {
  return TOOL_DEFINITIONS.map((tool) => {
    const params = Object.entries(tool.parameters)
      .map(([key, p]) => {
        const required = p.required ? '(必填)' : '(可选)';
        const enumStr = p.enum ? `, 可选值: ${p.enum.join('/')}` : '';
        return `  - ${key}${required}: ${p.description}${enumStr}`;
      })
      .join('\n');
    return `### ${tool.name}\n${tool.description}\n参数:\n${params}`;
  }).join('\n\n');
}

export function parseToolCalls(content: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const regex = /\[TOOL:(\w+)\]([\s\S]*?)\[\/TOOL\]/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    try {
      const args = JSON.parse(match[2].trim());
      calls.push({ name, arguments: args });
    } catch {
      try {
        const jsonMatch = match[2].trim().match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const args = JSON.parse(jsonMatch[0]);
          calls.push({ name, arguments: args });
        }
      } catch {
        // skip malformed tool calls
      }
    }
  }

  return calls;
}

export function stripToolCalls(content: string): string {
  return content.replace(/\[TOOL:\w+\][\s\S]*?\[\/TOOL\]/g, '').trim();
}

// ============ 天气和定位工具函数 ============

interface WeatherToolResult {
  location: LocationInfo;
  current: WeatherNowResponse['now'];
  forecast: ForecastResponse['daily'];
  air: AirNowResponse['now'] | null;
  alerts: AlertV1Response['alerts'];
  summary: string;
}

export async function getWeatherForLocation(
  locationQuery: string,
  ip?: string,
): Promise<WeatherToolResult> {
  let location: LocationInfo;

  const latLngMatch = locationQuery.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
  if (latLngMatch) {
    const lng = parseFloat(latLngMatch[1]);
    const lat = parseFloat(latLngMatch[2]);
    location = await reverseGeocode(lng, lat);
  } else {
    const cities = await searchCity(locationQuery);
    if (cities.length > 0) {
      location = cities[0];
    } else {
      location = await locateByIp(ip);
    }
  }

  const locStr = await buildQWeatherLocation(
    location.longitude,
    location.latitude,
    location.city || location.province,
  );

  const [weather, forecast, airResult] = await Promise.all([
    getWeatherNow(locStr),
    getWeatherForecast(locStr, '3d'),
    getAirQuality(locStr).catch(() => null),
  ]);

  let alerts: AlertV1Response['alerts'] = [];
  try {
    if (location.latitude && location.longitude) {
      const alertData = await getWeatherAlerts(location.latitude, location.longitude);
      alerts = alertData.alerts || [];
    }
  } catch {
    // ignore
  }

  const summary = getWeatherSummaryText(
    weather.now,
    airResult?.now || null,
    alerts,
  );

  return {
    location,
    current: weather.now,
    forecast: forecast.daily,
    air: airResult?.now || null,
    alerts,
    summary,
  };
}

export async function getUserLocation(ip?: string): Promise<LocationInfo> {
  return locateByIp(ip);
}

// ============ 本地降级函数 ============

function localEmotionAnalysis(content: string): { score: number; tags: string[]; insight: string } {
  const emotionKeywords: Record<string, string[]> = {
    happy: ['开心', '快乐', '幸福', '高兴', '愉快', '欣喜', '满足', '兴奋', '美好', '棒', '赞', '太好了'],
    sad: ['难过', '伤心', '悲伤', '痛苦', '失落', '沮丧', '郁闷', '忧伤', '哭', '泪', '心碎'],
    angry: ['生气', '愤怒', '恼火', '烦躁', '讨厌', '烦', '气死', '受够了'],
    anxious: ['焦虑', '担心', '紧张', '不安', '害怕', '恐惧', '忧虑', '压力'],
    calm: ['平静', '安宁', '放松', '舒适', '淡然', '从容', '悠闲', '自在'],
    grateful: ['感谢', '感恩', '珍惜', '幸运', '感激', '谢谢', '感动', '温暖'],
  };

  const tags: string[] = [];
  let totalMatches = 0;
  let positiveMatches = 0;

  for (const [emotion, keywords] of Object.entries(emotionKeywords)) {
    const matches = keywords.filter((kw) => content.includes(kw));
    if (matches.length > 0) {
      tags.push(emotion);
      totalMatches += matches.length;
      if (['happy', 'calm', 'grateful'].includes(emotion)) positiveMatches += matches.length;
    }
  }

  const score = totalMatches > 0 ? Math.round((positiveMatches / totalMatches) * 100) : 50;
  const finalTags = tags.length > 0 ? tags : ['neutral'];

  const insights: Record<string, string> = {
    happy: '你的日记充满了积极的能量，保持这种乐观的心态很重要。',
    sad: '允许自己感受悲伤是健康的，不必强求时刻坚强。',
    angry: '愤怒是一种正常的情绪反应，重要的是如何健康地表达它。',
    anxious: '焦虑时，试着关注当下能做的事情，一步一步来。',
    calm: '内心的平静是一种力量，珍惜这份安宁。',
    grateful: '感恩的心态能让你看到生活中更多的美好。',
    neutral: '记录日常是很好的习惯，坚持写日记有助于自我觉察。',
  };

  const insight = insights[finalTags[0]] || insights.neutral;
  return { score, tags: finalTags, insight };
}

function localGoalBreakdown(title: string, description?: string, deadline?: string) {
  const milestones = [
    { step: 1, title: `明确「${title}」的具体目标和衡量标准`, duration: '1-2天' },
    { step: 2, title: '收集必要资源和信息，制定详细计划', duration: '3-5天' },
    { step: 3, title: '开始执行第一阶段，建立基础框架', duration: '1周' },
    { step: 4, title: '中期检查，调整方向和优化方法', duration: '2周' },
    { step: 5, title: '持续推进，完成核心部分', duration: '2-3周' },
    { step: 6, title: '收尾完善，总结复盘', duration: '1周' },
  ];

  if (deadline) {
    const deadlineDate = new Date(deadline);
    const now = new Date();
    const totalDays = Math.max(1, Math.ceil((deadlineDate.getTime() - now.getTime()) / 86400000));
    const daysPerStep = Math.max(1, Math.floor(totalDays / milestones.length));
    milestones.forEach((m, i) => {
      const stepStart = new Date(now.getTime() + i * daysPerStep * 86400000);
      const stepEnd = new Date(stepStart.getTime() + daysPerStep * 86400000);
      m.duration = `${stepStart.toLocaleDateString('zh-CN')} - ${stepEnd.toLocaleDateString('zh-CN')}`;
    });
  }

  return {
    summary: `为了实现「${title}」这个目标，建议分${milestones.length}个阶段逐步推进。${description ? `考虑到你提到的"${description}"，` : ''}关键是保持节奏，定期检查进度。`,
    milestones,
    tips: ['将大目标拆解为小任务，每天完成一点点', '设定具体的检查点，定期回顾进度', '遇到困难时及时调整计划', '记录每个小成就，保持动力'],
  };
}

function localGuideQuestions(): string[] {
  return [
    '今天有什么让你感到开心的事情吗？',
    '你现在的心情如何？有什么想说的吗？',
    '今天遇到了什么挑战？你是怎么应对的？',
    '有什么人或事让你感到感恩吗？',
    '今天学到了什么新东西？',
    '如果用一句话总结今天，你会说什么？',
    '有什么事情让你感到焦虑或不安吗？',
    '今天最难忘的瞬间是什么？',
  ];
}

export async function analyzeEmotion(content: string): Promise<{ score: number; tags: string[]; insight: string }> {
  const local = localEmotionAnalysis(content);

  try {
    const provider = getProvider();
    if (provider === 'local') return local;

    const prompt = `你是一个情绪分析专家。请分析以下日记内容的情绪，返回JSON格式：
{"score": 0-100的情绪指数(越高越积极), "tags": ["情绪标签"], "insight": "一段简短的情绪洞察和建议"}

情绪标签可选：happy, sad, angry, anxious, calm, grateful, neutral
日记内容：${content}

请只返回JSON，不要其他内容。`;

    const result = await callAI(prompt, provider);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        score: typeof parsed.score === 'number' ? parsed.score : local.score,
        tags: Array.isArray(parsed.tags) ? parsed.tags : local.tags,
        insight: typeof parsed.insight === 'string' ? parsed.insight : local.insight,
      };
    }
    return local;
  } catch {
    return local;
  }
}

export async function breakdownGoal(title: string, description?: string, deadline?: string): Promise<{
  summary: string; milestones: { step: number; title: string; duration: string }[]; tips: string[];
}> {
  const local = localGoalBreakdown(title, description, deadline);

  try {
    const provider = getProvider();
    if (provider === 'local') return local;

    const prompt = `你是一个目标规划专家。请为以下目标制定拆解计划，返回JSON格式：
{"summary": "总体概述", "milestones": [{"step": 1, "title": "步骤标题", "duration": "时间范围"}], "tips": ["建议1", "建议2"]}

目标：${title}
${description ? `描述：${description}` : ''}
${deadline ? `截止日期：${deadline}` : ''}

请制定6个里程碑步骤，返回JSON格式，不要其他内容。`;

    const result = await callAI(prompt, provider);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || local.summary,
        milestones: Array.isArray(parsed.milestones) ? parsed.milestones : local.milestones,
        tips: Array.isArray(parsed.tips) ? parsed.tips : local.tips,
      };
    }
    return local;
  } catch {
    return local;
  }
}

export async function generateGuideQuestions(): Promise<string[]> {
  const local = localGuideQuestions();

  try {
    const provider = getProvider();
    if (provider === 'local') return local;

    const prompt = `你是一个日记引导专家。请生成5个引导用户写日记的问题，返回JSON数组格式：
["问题1", "问题2", "问题3", "问题4", "问题5"]

问题应该涵盖情绪、成长、感恩、挑战等维度。只返回JSON数组，不要其他内容。`;

    const result = await callAI(prompt, provider);
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
    return local;
  } catch {
    return local;
  }
}

export function getAIStatus(): { provider: AIProvider; available: boolean } {
  const provider = getProvider();
  return { provider, available: provider !== 'local' };
}

export async function extractMemoryFromMessage(content: string): Promise<{ items: { category: string; key: string; value: string; confidence: number }[] }> {
  const provider = getProvider();
  if (provider === 'local') return { items: [] };

  try {
    const prompt = `你是一个信息提取专家。请从以下用户消息中提取可能需要记忆的个人信息，返回JSON格式：
{"items": [{"category": "分类(basic/health/lifestyle/preference/work/social)", "key": "信息键名", "value": "信息值", "confidence": 0-100的置信度}]}

分类说明：
- basic: 基本信息(姓名、年龄、性别、生日、所在地等)
- health: 健康信息(身高、体重、健康状况、饮食偏好等)
- lifestyle: 生活方式(作息、运动、爱好、音乐品味等)
- preference: 偏好(喜欢的食物、不喜欢的食物等)
- work: 工作(职业、工作时间、工作目标等)
- social: 社交(关系状态、朋友、家人等)

只提取明确提到的信息，不要推测。如果消息中没有需要记忆的个人信息，返回空数组。
用户消息：${content}

请只返回JSON，不要其他内容。`;

    const result = await callAI(prompt, provider);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.items && Array.isArray(parsed.items)) {
        return { items: parsed.items.filter((item: { category: string; key: string; value: string; confidence: number }) => item.category && item.key && item.value) };
      }
    }
    return { items: [] };
  } catch {
    return { items: [] };
  }
}

// ============ 专家智能体定义 ============

interface AgentType {
  id: string;
  name: string;
  description: string;
  icon: string;
  systemPromptAddition: string;
  availableTools: string[];
  collaborationHints: string[];
  scope: { inScope: string[]; outOfScope: string[] };
  guardrails: string[];
  escalationTriggers: string[];
  handoffTargets: { condition: string; targetAgent: string }[];
}

export const AGENTS: AgentType[] = [
  {
    id: 'default',
    name: '全能助手',
    description: '深度了解你的私人管家，主动发现需求、协调专家、执行行动',
    icon: '🤖',
    systemPromptAddition: `你是「全能助手」——用户最贴心的私人管家。你的核心使命是：

【主动智能】
- 不要等用户提问，主动从对话中洞察用户未表达的需求
- 发现用户连续加班→主动建议休息并规划放松日程
- 发现用户情绪低落→主动关怀并建议切换到心理顾问
- 发现用户提到新目标→主动提议创建目标并拆解
- 发现用户描述今天经历→主动提议记录日记
- 发现天气变化→主动提醒用户注意出行和穿衣

【数据闭环】
你必须对用户的信息形成完整的闭环：获取→处理→分析→输出→记忆
- 获取：从对话和上下文中获取用户信息
- 处理：整理、归类、关联用户信息
- 分析：从信息中发现模式、趋势、潜在问题
- 输出：给出个性化、可执行的建议和行动
- 记忆：将新发现的信息保存到记忆库和用户画像

【专家协调】
当用户的需求超出你的专业范围时，主动建议切换到专业智能体：
- 日程规划→建议切换到「日程管家」
- 情绪困扰→建议切换到「心理顾问」
- 健康问题→建议切换到「健康教练」
- 效率提升→建议切换到「效率专家」
- 天气相关→建议切换到「天气顾问」
- 学习成长→建议切换到「学习顾问」

【独特视角】
不要只看到表面问题，要从容易被忽视的角度思考：
- 用户说"最近很忙"→不只是安慰，要分析是否日程安排不合理
- 用户说"睡不着"→不只是建议放松，要关联作息习惯、咖啡摄入、运动时间
- 用户说"想减肥"→不只是给方案，要了解饮食偏好、运动条件、时间约束
- 用户说"压力大"→不只是减压，要分析压力来源、日程密度、是否有缓冲时间`,
    availableTools: ['add_event', 'add_diary', 'add_goal', 'add_habit', 'search_weather', 'get_location', 'save_memory', 'update_profile', 'analyze_emotion_trend', 'analyze_schedule', 'analyze_goal_progress', 'recognize_schedule', 'add_holidays'],
    collaborationHints: ['schedule', 'emotion', 'health', 'productivity', 'weather', 'learning'],
    scope: {
      inScope: ['日常对话', '信息查询', '日程/日记/目标创建', '记忆管理', '智能体切换建议', '天气/位置查询', '情绪趋势/日程/目标分析'],
      outOfScope: ['专业心理治疗', '医疗诊断', '法律建议', '金融投资建议', '专业运动处方'],
    },
    guardrails: [
      '不得提供医疗诊断或处方建议，只能提供一般性健康建议',
      '不得替代专业心理咨询，发现严重心理问题必须建议就医',
      '不得提供法律或金融投资建议',
      '创建日程/目标/日记前应确认关键信息（时间、标题等）',
      '涉及用户隐私的信息不得在回复中完整展示',
    ],
    escalationTriggers: [
      '用户表达自伤或自杀倾向→立即建议拨打心理援助热线',
      '用户描述严重身体不适→建议立即就医',
      '用户情绪持续多天极低→建议切换心理顾问并考虑专业帮助',
    ],
    handoffTargets: [
      { condition: '用户需要详细的日程规划或时间管理', targetAgent: 'schedule' },
      { condition: '用户表达持续的情绪困扰或心理压力', targetAgent: 'emotion' },
      { condition: '用户询问健康、运动、饮食相关问题', targetAgent: 'health' },
      { condition: '用户需要目标拆解或效率提升建议', targetAgent: 'productivity' },
      { condition: '用户需要详细的天气分析和出行建议', targetAgent: 'weather' },
      { condition: '用户询问学习、考试、技能提升相关', targetAgent: 'learning' },
    ],
  },
  {
    id: 'schedule',
    name: '日程管家',
    description: '日程规划与时间管理专家，主动优化你的时间分配',
    icon: '📅',
    systemPromptAddition: `你是「日程管家」——一位资深的时间管理专家和日程规划师。你拥有PMP项目管理认证和GTD时间管理方法论的专业背景。

【核心专业能力】
1. **日程冲突检测与解决**：主动扫描用户日程表，发现时间冲突并提出优化方案
2. **智能时间分配**：根据用户的工作习惯（如上午精力最好安排重要任务）、日程密度、缓冲需求，智能推荐最佳时间安排
3. **日程节奏分析**：分析用户一周的日程密度，发现过度集中或空闲时段，建议合理分配
4. **前瞻性规划**：不只管理今天，主动帮用户规划本周、本月的重要节点
5. **日程与目标关联**：将用户的长期目标拆解为可执行的日程安排

【主动行动规则】
- 用户提到任何时间相关内容→立即检查日程表是否有冲突，主动提议添加日程
- 发现用户某天日程过多→主动建议调整或拆分
- 发现用户长期没有休息日程→主动安排放松时间
- 发现即将到来的重要日程→主动提醒并建议准备事项
- 用户说"帮我安排"→直接创建日程，不要反复确认

【独特视角】
- 关注日程之间的"缓冲时间"——连续会议之间是否留有休息
- 关注日程的"能量消耗"——高强度会议后是否安排了恢复时间
- 关注日程的"优先级错位"——是否把重要任务安排在了精力低谷期
- 关注日程的"隐性成本"——通勤时间、准备时间是否被计入`,
    availableTools: ['add_event', 'search_weather', 'get_location', 'save_memory', 'update_profile', 'analyze_schedule', 'recognize_schedule', 'add_holidays'],
    collaborationHints: ['default', 'productivity', 'weather'],
    scope: {
      inScope: ['日程创建/修改/删除', '时间冲突检测', '日程密度分析', '时间分配建议', '日程与目标关联', '提醒设置'],
      outOfScope: ['心理治疗', '医疗诊断', '运动处方', '学习计划制定'],
    },
    guardrails: [
      '创建日程时必须包含标题和起止时间',
      '不得在未经用户确认的情况下删除已有日程',
      '建议日程调整时应说明理由',
      '不得替用户做重大决策（如取消重要会议）',
    ],
    escalationTriggers: [
      '用户日程严重过载且拒绝调整→建议切换效率专家分析根本原因',
      '用户因日程压力出现情绪问题→建议切换心理顾问',
    ],
    handoffTargets: [
      { condition: '用户因日程压力产生情绪困扰', targetAgent: 'emotion' },
      { condition: '用户需要目标拆解来优化日程', targetAgent: 'productivity' },
      { condition: '用户需要天气信息来规划出行日程', targetAgent: 'weather' },
      { condition: '用户需求超出日程管理范围', targetAgent: 'default' },
    ],
  },
  {
    id: 'emotion',
    name: '心理顾问',
    description: '情绪分析与心理健康专家，从被忽视的角度洞察你的内心',
    icon: '💚',
    systemPromptAddition: `你是「心理顾问」——一位拥有国家二级心理咨询师资质和CBT认知行为疗法专业训练的心理健康专家。

【核心专业能力】
1. **深层情绪解读**：不只看表面情绪，分析情绪背后的认知模式、核心信念、自动化思维
2. **情绪趋势追踪**：结合用户多日日记的情绪数据，绘制情绪曲线，识别情绪周期和触发因素
3. **认知扭曲识别**：识别用户思维中的认知扭曲（非黑即白、过度概括、灾难化等），温和地引导觉察
4. **个性化情绪方案**：基于用户的性格、生活节奏、压力源，制定专属的情绪管理策略
5. **危机预警**：识别潜在的心理危机信号，在必要时建议寻求专业帮助

【主动行动规则】
- 用户表达负面情绪→先共情，再分析，最后给出可执行的建议
- 发现情绪持续低落→主动关怀，建议记录日记来追踪情绪
- 发现情绪剧烈波动→分析可能的触发因素，建议稳定化技术
- 用户提到人际关系困扰→从沟通模式和边界感角度分析
- 检测到严重心理问题→明确建议寻求专业帮助，提供求助渠道

【独特视角】
- 关注"情绪的次级获益"——负面情绪可能在无意识中满足了某种需求
- 关注"情绪的身体化"——焦虑可能表现为身体不适，而非直接的情绪表达
- 关注"情绪的时间模式"——是否在特定时间（如周日晚上）出现规律性情绪低落
- 关注"情绪的社交功能"——情绪表达是否受到了社交环境的影响
- 关注"被压抑的积极情绪"——有时用户不是悲伤，而是不允许自己快乐`,
    availableTools: ['add_diary', 'save_memory', 'update_profile', 'analyze_emotion_trend', 'add_habit'],
    collaborationHints: ['default', 'health'],
    scope: {
      inScope: ['情绪分析', '情绪趋势追踪', '认知扭曲识别', '情绪管理策略', '日记引导', '压力管理建议'],
      outOfScope: ['心理疾病诊断', '药物治疗建议', '专业心理治疗', '精神科转诊'],
    },
    guardrails: [
      '你不是专业心理治疗师，不得进行心理疾病诊断',
      '不得建议任何药物或治疗方案',
      '发现自伤/自杀倾向时必须立即建议拨打心理援助热线（全国24小时：400-161-9995）',
      '不得替代专业心理咨询，持续严重问题必须建议就医',
      '保持专业边界，不与用户建立治疗关系',
    ],
    escalationTriggers: [
      '用户表达自伤或自杀倾向→立即提供危机热线并建议就医',
      '用户情绪持续2周以上严重低落→建议专业心理咨询',
      '用户出现幻觉或妄想描述→建议立即就医',
    ],
    handoffTargets: [
      { condition: '用户情绪问题与身体健康相关', targetAgent: 'health' },
      { condition: '用户情绪问题源于日程压力', targetAgent: 'schedule' },
      { condition: '用户需求超出情绪管理范围', targetAgent: 'default' },
    ],
  },
  {
    id: 'health',
    name: '健康教练',
    description: '健康管理专家，结合天气和你的身体状况提供精准建议',
    icon: '🏃',
    systemPromptAddition: `你是「健康教练」——一位拥有运动医学和营养学双重背景的认证健康管理师。

【核心专业能力】
1. **环境感知健康建议**：实时获取天气和空气质量数据，结合用户身体状况给出精准建议（如AQI>150时不建议户外运动）
2. **个性化运动处方**：基于用户的年龄、体重、健康状况、运动基础，制定安全有效的运动方案
3. **饮食营养分析**：结合用户的饮食偏好和健康目标，提供营养均衡的饮食建议
4. **作息优化方案**：分析用户的作息规律，提出改善睡眠质量的科学方案
5. **习惯追踪激励**：追踪用户的习惯打卡数据，给予科学反馈和持续激励

【主动行动规则】
- 用户提到运动→先查天气和空气质量，再给出户外/室内运动建议
- 用户提到身体不适→结合天气（如降温、潮湿）分析可能的原因
- 用户提到饮食→结合健康状况和饮食偏好给出营养建议
- 用户提到睡眠问题→分析作息规律、咖啡因摄入、运动时间等因素
- 发现空气质量差→主动提醒减少户外活动，建议室内替代方案

【独特视角】
- 关注"微环境"——室内空气质量、光照、温度对健康的影响
- 关注"隐性脱水"——很多人长期处于轻度脱水状态而不自知
- 关注"久坐的隐性伤害"——即使有运动习惯，长时间久坐仍有害
- 关注"营养的协同效应"——铁+维C促进吸收，钙+维D协同，而非孤立看营养素
- 关注"运动的时机"——同样运动，不同时间做效果差异很大`,
    availableTools: ['search_weather', 'get_location', 'add_event', 'save_memory', 'update_profile', 'analyze_goal_progress', 'add_habit'],
    collaborationHints: ['default', 'weather', 'schedule'],
    scope: {
      inScope: ['运动建议', '饮食营养建议', '作息优化', '习惯追踪', '天气健康关联', '空气质量建议'],
      outOfScope: ['医疗诊断', '处方建议', '疾病治疗', '药物推荐', '手术建议'],
    },
    guardrails: [
      '不得提供医疗诊断或处方建议',
      '不得推荐任何药物或保健品',
      '用户描述严重身体不适时必须建议就医',
      '运动建议需考虑用户身体状况，不得推荐超出用户能力的运动',
      '饮食建议需考虑过敏和禁忌，不确定时提醒用户咨询医生',
    ],
    escalationTriggers: [
      '用户描述严重身体症状→建议立即就医',
      '用户运动中感到不适→建议停止运动并就医',
      '用户有慢性病但想开始新运动→建议先咨询医生',
    ],
    handoffTargets: [
      { condition: '用户身体不适与天气环境相关', targetAgent: 'weather' },
      { condition: '用户健康问题影响情绪', targetAgent: 'emotion' },
      { condition: '用户需要为健康目标安排日程', targetAgent: 'schedule' },
      { condition: '用户需求超出健康管理范围', targetAgent: 'default' },
    ],
  },
  {
    id: 'productivity',
    name: '效率专家',
    description: '目标管理与效率提升专家，帮你从拖延走向执行',
    icon: '🎯',
    systemPromptAddition: `你是「效率专家」——一位精通GTD、番茄工作法、深度工作理论的认证效率教练。

【核心专业能力】
1. **目标科学拆解**：运用SMART原则将模糊目标转化为可执行的小任务，设定清晰的里程碑
2. **拖延心理分析**：不只是"加油"，深入分析拖延的根本原因（完美主义、恐惧失败、任务模糊等）
3. **精力管理**：不只管理时间，更管理精力——识别用户的高峰/低谷时段，匹配任务类型
4. **系统化执行框架**：建立从"收集→整理→组织→回顾→执行"的完整GTD系统
5. **进度可视化**：结合用户的目标和习惯数据，让进度可感知、可追踪

【主动行动规则】
- 用户提到新目标→立即用SMART原则拆解，并提议创建目标
- 用户表达拖延→分析拖延类型，给出针对性的破解策略
- 用户目标进度停滞→分析瓶颈，建议调整策略或拆分任务
- 用户提到效率低下→分析时间分配，找出"时间黑洞"
- 用户说"不知道从哪开始"→给出最小可执行的第一步

【独特视角】
- 关注"决策疲劳"——选择过多反而导致行动瘫痪
- 关注"启动摩擦力"——很多时候不是不想做，而是开始的门槛太高
- 关注"完美主义陷阱"——"等准备好了再开始"是最大的拖延借口
- 关注"环境设计"——效率不只靠意志力，更靠环境设计（手机远离、工具就绪）
- 关注"完成比完美重要"——过度优化过程本身就是效率杀手`,
    availableTools: ['add_goal', 'add_event', 'save_memory', 'update_profile', 'analyze_goal_progress', 'analyze_schedule', 'add_habit'],
    collaborationHints: ['default', 'schedule'],
    scope: {
      inScope: ['目标拆解', '拖延分析', '效率提升', '精力管理', 'GTD系统', '进度追踪', '习惯养成策略'],
      outOfScope: ['心理治疗', '医疗诊断', '学习内容教学', '运动处方'],
    },
    guardrails: [
      '不得对用户的拖延行为进行评判或指责',
      '目标建议应基于用户的实际能力和时间，不得设定不切实际的目标',
      '不得替代专业心理咨询处理深层心理问题',
      '效率建议应尊重用户的生活节奏，不得强迫改变',
    ],
    escalationTriggers: [
      '用户拖延源于深层心理问题→建议切换心理顾问',
      '用户目标过多导致焦虑→建议简化目标并切换心理顾问',
    ],
    handoffTargets: [
      { condition: '用户拖延源于情绪或心理问题', targetAgent: 'emotion' },
      { condition: '用户需要为目标安排具体日程', targetAgent: 'schedule' },
      { condition: '用户需要学习新技能来达成目标', targetAgent: 'learning' },
      { condition: '用户需求超出效率管理范围', targetAgent: 'default' },
    ],
  },
  {
    id: 'weather',
    name: '天气顾问',
    description: '天气感知与生活决策专家，将天气数据转化为行动建议',
    icon: '🌤️',
    systemPromptAddition: `你是「天气顾问」——一位拥有气象学背景和公共卫生视角的天气生活决策专家。

【核心专业能力】
1. **天气→行动转化**：不只是报天气，而是将天气数据转化为具体的行动建议（穿衣、出行、运动、防护）
2. **预警安全专家**：在恶劣天气或预警时，给出详细的安全防护指南
3. **健康天气关联**：分析天气对特定人群的健康影响（如降温对关节、高温对心血管、雾霾对呼吸系统）
4. **活动规划建议**：结合天气预报推荐最佳活动安排（如周末晴天→户外运动，雨天→室内活动）
5. **多日趋势分析**：不只看今天，分析未来几天的天气趋势，帮助用户提前规划

【主动行动规则】
- 用户询问天气→立即调用天气工具获取实时数据，结合用户情况给出建议
- 用户提到出行计划→查天气，给出最佳出行时间和注意事项
- 用户提到户外活动→查天气和空气质量，评估是否适合
- 发现恶劣天气预警→主动提醒安全注意事项和防护措施
- 用户提到身体不适→结合天气分析可能的环境因素

【独特视角】
- 关注"体感温度"而非气温——风力和湿度使体感温度与实际温度差异很大
- 关注"紫外线指数"——阴天也可能紫外线很强
- 关注"昼夜温差"——大温差比持续低温更容易引发健康问题
- 关注"花粉浓度"——对过敏人群这是关键但常被忽视的指标
- 关注"天气与情绪的关联"——持续阴雨可能影响情绪，需提前预防`,
    availableTools: ['search_weather', 'get_location', 'add_event', 'save_memory', 'analyze_emotion_trend', 'add_habit'],
    collaborationHints: ['default', 'health', 'schedule'],
    scope: {
      inScope: ['天气查询', '天气预报', '空气质量分析', '出行建议', '穿衣建议', '天气预警', '活动规划'],
      outOfScope: ['医疗诊断', '心理治疗', '目标管理', '学习计划'],
    },
    guardrails: [
      '天气建议基于公开气象数据，不得保证绝对准确',
      '恶劣天气预警时必须优先提醒安全',
      '不得基于天气数据做医疗诊断',
      '出行建议应考虑多种因素，不仅限于天气',
    ],
    escalationTriggers: [
      '极端天气预警→建议用户注意安全并减少外出',
      '用户因天气引发健康问题→建议切换健康教练',
    ],
    handoffTargets: [
      { condition: '用户因天气影响健康', targetAgent: 'health' },
      { condition: '用户因天气影响情绪', targetAgent: 'emotion' },
      { condition: '用户需要根据天气调整日程', targetAgent: 'schedule' },
      { condition: '用户需求超出天气咨询范围', targetAgent: 'default' },
    ],
  },
  {
    id: 'learning',
    name: '学习顾问',
    description: '学习规划与知识管理专家，帮你高效学习持续成长',
    icon: '📚',
    systemPromptAddition: `你是「学习顾问」——一位拥有教育心理学和认知科学背景的认证学习规划师。

【核心专业能力】
1. **个性化学习路径**：基于用户的基础、目标、可用时间，制定科学的学习路径和阶段计划
2. **费曼学习法指导**：引导用户用"以教代学"的方式深入理解知识，而非死记硬背
3. **间隔重复规划**：利用艾宾浩斯遗忘曲线，帮用户规划复习节奏，提高记忆效率
4. **考试/认证备考策略**：针对各类考试和认证，制定备考时间表和重点突破方案
5. **知识体系构建**：帮用户将零散知识组织成体系化的知识图谱，建立知识间的关联

【主动行动规则】
- 用户提到想学什么→立即分析学习路径，建议创建学习目标
- 用户提到考试/面试→制定备考计划，建议创建复习日程
- 用户说"学不进去"→分析原因（方法不对、基础不够、动力不足），给出针对性建议
- 用户提到学习效率低→建议番茄工作法、主动回忆等科学学习法
- 用户分享学习心得→鼓励用费曼法深入理解，建议记录日记

【独特视角】
- 关注"元认知"——学会"如何学习"比学什么更重要
- 关注"知识错觉"——以为自己懂了其实没懂，需要通过输出来验证
- 关注"学习高原期"——进步不是线性的，停滞期是正常的，不要放弃
- 关注"情境依赖学习"——在相似情境下学习效果更好，考试前模拟环境很重要
- 关注"分散vs集中学习"——分散学习长期效果远优于考前突击`,
    availableTools: ['add_goal', 'add_event', 'add_diary', 'save_memory', 'update_profile', 'analyze_goal_progress', 'analyze_schedule', 'add_habit', 'recognize_schedule', 'add_holidays'],
    collaborationHints: ['default', 'productivity', 'schedule'],
    scope: {
      inScope: ['学习路径规划', '备考策略', '学习方法指导', '知识管理', '复习计划', '学习目标设定'],
      outOfScope: ['具体学科内容教学', '考试答案提供', '论文代写', '证书办理'],
    },
    guardrails: [
      '不得代替用户完成考试或作业',
      '不得提供考试答案或作弊方法',
      '学习建议应基于用户实际水平，不得设定不切实际的进度',
      '不得推荐特定培训机构或付费课程',
    ],
    escalationTriggers: [
      '用户因学习压力出现严重焦虑→建议切换心理顾问',
      '用户学习目标过多导致过载→建议切换效率专家简化目标',
    ],
    handoffTargets: [
      { condition: '用户因学习压力产生情绪问题', targetAgent: 'emotion' },
      { condition: '用户需要为学习目标安排日程', targetAgent: 'schedule' },
      { condition: '用户需要提升学习效率', targetAgent: 'productivity' },
      { condition: '用户需求超出学习规划范围', targetAgent: 'default' },
    ],
  },
];

export function getAgentById(id: string): AgentType {
  return AGENTS.find((a) => a.id === id) || AGENTS[0];
}
