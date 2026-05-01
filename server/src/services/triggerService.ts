import cron, { type ScheduledTask } from 'node-cron';
import prisma from '../utils/prisma.js';
import { createNotification } from './notificationService.js';
import { sendPushToUser } from './pushService.js';
import { locateByIp, searchCity } from './locationService.js';
import { getWeatherNow, getAirQuality, getWeatherAlerts, buildQWeatherLocation } from './weatherService.js';

const activeCronJobs = new Map<string, ScheduledTask>();

interface TriggerContext {
  userId: string;
  triggerId: string;
  type: string;
  config: Record<string, unknown>;
}

async function executeTrigger(trigger: { id: string; userId: string; type: string; config: string }) {
  const parsedConfig = JSON.parse(trigger.config) as Record<string, unknown>;
  const ctx: TriggerContext = {
    userId: trigger.userId,
    triggerId: trigger.id,
    type: trigger.type,
    config: parsedConfig,
  };

  try {
    switch (ctx.type) {
      case 'MORNING_BRIEF':
        await executeMorningBrief(ctx);
        break;
      case 'EVENING_REVIEW':
        await executeEveningReview(ctx);
        break;
      case 'EMOTION_ALERT':
        await executeEmotionAlert(ctx);
        break;
      case 'GOAL_REMINDER':
        await executeGoalReminder(ctx);
        break;
      case 'WEATHER_ALERT':
        await executeWeatherAlert(ctx);
        break;
    }

    await prisma.trigger.update({
      where: { id: trigger.id },
      data: { lastTriggeredAt: new Date() },
    });
  } catch (error) {
    console.error(`Trigger execution failed (${trigger.type}):`, (error as Error).message);
  }
}

async function executeMorningBrief(ctx: TriggerContext) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const [yesterdayDiary, todayEvents, activeGoals] = await Promise.all([
    prisma.diary.findFirst({
      where: { userId: ctx.userId, createdAt: { gte: yesterday } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.event.findMany({
      where: {
        userId: ctx.userId,
        startTime: { gte: new Date(new Date().setHours(0, 0, 0, 0)), lte: todayEnd },
      },
      orderBy: { startTime: 'asc' },
    }),
    prisma.goal.findMany({
      where: { userId: ctx.userId, status: 'ACTIVE' },
      take: 5,
    }),
  ]);

  const diarySummary = yesterdayDiary
    ? `昨日日记：${yesterdayDiary.content.slice(0, 100)}...`
    : '昨日未写日记';
  const eventSummary = todayEvents.length > 0
    ? `今日日程：${todayEvents.map((e) => e.title).join('、')}`
    : '今日无日程安排';
  const goalSummary = activeGoals.length > 0
    ? `进行中目标：${activeGoals.map((g) => `${g.title}(${g.progress}%)`).join('、')}`
    : '暂无进行中目标';

  let content = `${diarySummary}\n${eventSummary}\n${goalSummary}`;

  try {
    let locationInfo;
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      include: { profile: true },
    });

    if (user?.profile?.location) {
      const cities = await searchCity(user.profile.location);
      if (cities.length > 0) {
        locationInfo = cities[0];
      }
    }

    if (!locationInfo) {
      locationInfo = await locateByIp();
    }

    if (locationInfo.city || locationInfo.province) {
      const locationParam = await buildQWeatherLocation(
        locationInfo.longitude,
        locationInfo.latitude,
        locationInfo.city || locationInfo.province,
      );

      if (locationParam) {
        const weatherData = await getWeatherNow(locationParam);
        let airData = null;
        try { airData = await getAirQuality(locationParam); } catch { /* ignore */ }

        const weatherLine = `今日天气：${weatherData.now.text} ${weatherData.now.temp}°C（体感${weatherData.now.feelsLike}°C）${weatherData.now.windDir}${weatherData.now.windScale}级 湿度${weatherData.now.humidity}%`;
        const airLine = airData ? ` 空气质量：${airData.now.category}(AQI ${airData.now.aqi})` : '';

        let alertLine = '';
        try {
          if (locationInfo.longitude && locationInfo.latitude) {
            const alertData = await getWeatherAlerts(locationInfo.latitude!, locationInfo.longitude!);
            if (alertData.alerts && alertData.alerts.length > 0) {
              alertLine = `\n⚠️ 预警：${alertData.alerts.map((a) => a.headline).join('、')}`;
            }
          }
        } catch { /* ignore */ }

        content += `\n${weatherLine}${airLine}${alertLine}`;
      }
    }
  } catch { /* weather unavailable, skip */ }

  await createNotification({
    userId: ctx.userId,
    type: 'MORNING_BRIEF',
    title: '☀️ 晨间简报',
    content,
    actionUrl: '/',
  });

  await sendPushToUser(ctx.userId, {
    title: '晨间简报',
    body: content.slice(0, 100),
    url: '/',
  });
}

async function executeEveningReview(ctx: TriggerContext) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [todayDiary, habitStats] = await Promise.all([
    prisma.diary.findFirst({
      where: { userId: ctx.userId, createdAt: { gte: today } },
    }),
    prisma.habit.findMany({
      where: { userId: ctx.userId },
      include: {
        logs: {
          where: { logDate: { gte: today } },
        },
      },
    }),
  ]);

  const completedHabits = habitStats.filter((h) =>
    h.logs.some((l) => l.isCompleted)
  ).length;
  const totalHabits = habitStats.length;

  let content = '';
  if (!todayDiary) {
    content = '今天还没有写日记哦，趁睡前记录一下今天的心情吧！\n';
  } else {
    content = '今天已经记录了日记，很棒！\n';
  }

  if (totalHabits > 0) {
    content += `今日习惯打卡：${completedHabits}/${totalHabits} 完成`;
    if (completedHabits < totalHabits) {
      content += '\n还有习惯未完成，加油！';
    }
  }

  await createNotification({
    userId: ctx.userId,
    type: 'EVENING_REVIEW',
    title: '🌙 晚间复盘',
    content,
    actionUrl: todayDiary ? `/diary/${todayDiary.id}` : '/diary/new',
  });

  await sendPushToUser(ctx.userId, {
    title: '晚间复盘',
    body: content.slice(0, 100),
    url: todayDiary ? `/diary/${todayDiary.id}` : '/diary/new',
  });
}

async function executeEmotionAlert(ctx: TriggerContext) {
  const days = (ctx.config.days as number) || 3;
  const threshold = (ctx.config.threshold as number) || 30;

  const recentDiaries = await prisma.diary.findMany({
    where: { userId: ctx.userId },
    orderBy: { createdAt: 'desc' },
    take: days,
  });

  if (recentDiaries.length < days) return;

  const allLow = recentDiaries.every((d) => d.emotionScore <= threshold);
  if (!allLow) return;

  const lastAlert = await prisma.notification.findFirst({
    where: {
      userId: ctx.userId,
      type: 'EMOTION_ALERT',
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  if (lastAlert) return;

  const content = `检测到你最近${days}天的情绪持续低落，建议你：\n1. 和信任的人聊聊\n2. 做一些让自己开心的事\n3. 如果需要，可以寻求专业帮助\n\n你的感受很重要，不必独自承受。`;

  await createNotification({
    userId: ctx.userId,
    type: 'EMOTION_ALERT',
    title: '💚 情绪关怀',
    content,
    actionUrl: '/diary/new',
  });

  await sendPushToUser(ctx.userId, {
    title: '情绪关怀提醒',
    body: '检测到情绪持续低落，请关注自己的心理健康',
    url: '/diary/new',
  });
}

async function executeGoalReminder(ctx: TriggerContext) {
  const daysBefore = (ctx.config.daysBefore as number) || 3;
  const reminderDate = new Date();
  reminderDate.setDate(reminderDate.getDate() + daysBefore);
  reminderDate.setHours(23, 59, 59, 999);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + daysBefore);
  startDate.setHours(0, 0, 0, 0);

  const goalsNearDeadline = await prisma.goal.findMany({
    where: {
      userId: ctx.userId,
      status: 'ACTIVE',
      deadline: { gte: startDate, lte: reminderDate },
    },
  });

  for (const goal of goalsNearDeadline) {
    const existingReminder = await prisma.notification.findFirst({
      where: {
        userId: ctx.userId,
        type: 'GOAL_REMINDER',
        actionUrl: `/goals`,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    if (existingReminder) continue;

    const deadlineStr = goal.deadline ? new Date(goal.deadline).toLocaleDateString('zh-CN') : '';
    const content = `你的目标「${goal.title}」将在${daysBefore}天后（${deadlineStr}）到期，当前进度${goal.progress}%。${goal.progress < 80 ? '\n建议加快进度或调整计划。' : '\n即将完成，加油！'
      }`;

    await createNotification({
      userId: ctx.userId,
      type: 'GOAL_REMINDER',
      title: '🎯 目标提醒',
      content,
      actionUrl: '/goals',
    });

    await sendPushToUser(ctx.userId, {
      title: '目标即将到期',
      body: `「${goal.title}」还剩${daysBefore}天`,
      url: '/goals',
    });
  }
}

async function executeWeatherAlert(_ctx: TriggerContext) {
  if (!process.env.QWEATHER_API_KEY || !process.env.AMAP_KEY) return;

  const users = await prisma.user.findMany({
    include: { profile: true },
  });

  for (const user of users) {
    try {
      let locationInfo;

      if (user.profile?.location) {
        const cities = await searchCity(user.profile.location);
        if (cities.length > 0) {
          locationInfo = cities[0];
        }
      }

      if (!locationInfo || !locationInfo.longitude || !locationInfo.latitude) {
        continue;
      }

      const alertData = await getWeatherAlerts(locationInfo.latitude!, locationInfo.longitude!);
      if (!alertData.alerts || alertData.alerts.length === 0) continue;

      const severeAlerts = alertData.alerts.filter(
        (a) => a.severity === 'severe' || a.severity === 'extreme',
      );
      if (severeAlerts.length === 0) continue;

      for (const alert of severeAlerts) {
        const existing = await prisma.notification.findFirst({
          where: {
            userId: user.id,
            type: 'WEATHER_ALERT',
            title: alert.headline,
            createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
          },
        });
        if (existing) continue;

        await createNotification({
          userId: user.id,
          type: 'WEATHER_ALERT',
          title: `⚠️ ${alert.headline}`,
          content: alert.description?.slice(0, 200) || alert.headline,
          actionUrl: '/weather',
        });

        await sendPushToUser(user.id, {
          title: alert.headline,
          body: alert.description?.slice(0, 80) || '',
          url: '/weather',
        });
      }
    } catch {
      // skip user on error
    }
  }
}

function buildCronExpression(type: string, config: Record<string, unknown>): string {
  const hour = typeof config.hour === 'number' ? config.hour : undefined;
  const minute = typeof config.minute === 'number' ? config.minute : 0;

  switch (type) {
    case 'MORNING_BRIEF':
      return `${minute} ${hour ?? 7} * * *`;
    case 'EVENING_REVIEW':
      return `${minute} ${hour ?? 21} * * *`;
    case 'EMOTION_ALERT':
      return `${minute} ${hour ?? 10} * * *`;
    case 'GOAL_REMINDER':
      return `${minute} ${hour ?? 9} * * *`;
    case 'WEATHER_ALERT':
      return `${minute} ${hour ?? 8} */3 * *`;
    default:
      return `${minute} ${hour ?? 8} * * *`;
  }
}

export function startCronTriggers() {
  const defaultConfigs: Record<string, Record<string, unknown>> = {
    MORNING_BRIEF: { hour: 7, minute: 0 },
    EVENING_REVIEW: { hour: 21, minute: 0 },
    EMOTION_ALERT: { hour: 10, minute: 0 },
    GOAL_REMINDER: { hour: 9, minute: 0 },
    WEATHER_ALERT: { hour: 8, minute: 0 },
  };

  for (const [type, defaultConfig] of Object.entries(defaultConfigs)) {
    const cronExpr = buildCronExpression(type, defaultConfig);

    const job = cron.schedule(cronExpr, async () => {
      console.log(`[Trigger] ${type} cron triggered`);
      const triggers = await prisma.trigger.findMany({
        where: { type, isActive: true },
      });
      for (const trigger of triggers) {
        await executeTrigger(trigger);
      }
    });
    activeCronJobs.set(type, job);
  }

  const cleanupJob = cron.schedule('0 3 * * *', async () => {
    console.log('[Cleanup] Purging soft-deleted records older than 30 days');
    const cutoff = new Date(Date.now() - 30 * 86400000);
    try {
      const result = await prisma.diary.deleteMany({
        where: { isDeleted: true, deletedAt: { lt: cutoff } },
      });
      console.log(`[Cleanup] Purged ${result.count} soft-deleted diaries`);
    } catch (error) {
      console.error('[Cleanup] Failed to purge soft-deleted records:', (error as Error).message);
    }
  });
  activeCronJobs.set('CLEANUP_SOFT_DELETE', cleanupJob);

  console.log('[Trigger] Cron jobs started with default schedules');
}

async function refreshCronForUser(userId: string) {
  const userTriggers = await prisma.trigger.findMany({
    where: { userId, isActive: true },
  });

  const typeConfigs = new Map<string, Record<string, unknown>>();
  for (const t of userTriggers) {
    const config = JSON.parse(t.config) as Record<string, unknown>;
    const existing = typeConfigs.get(t.type);
    if (!existing || (typeof config.hour === 'number')) {
      typeConfigs.set(t.type, config);
    }
  }

  for (const [type, config] of typeConfigs) {
    const existingJob = activeCronJobs.get(type);
    if (existingJob) {
      existingJob.stop();
    }

    const cronExpr = buildCronExpression(type, config);
    const job = cron.schedule(cronExpr, async () => {
      console.log(`[Trigger] ${type} cron triggered`);
      const triggers = await prisma.trigger.findMany({
        where: { type, isActive: true },
      });
      for (const trigger of triggers) {
        await executeTrigger(trigger);
      }
    });
    activeCronJobs.set(type, job);
  }
}

export function stopCronTriggers() {
  for (const [name, job] of activeCronJobs) {
    job.stop();
    console.log(`[Trigger] Stopped cron job: ${name}`);
  }
  activeCronJobs.clear();
}

export async function ensureDefaultTriggers(userId: string) {
  const existing = await prisma.trigger.findMany({ where: { userId } });
  const existingTypes = new Set(existing.map((t) => t.type));

  const defaults: { type: string; config: Record<string, unknown> }[] = [
    { type: 'MORNING_BRIEF', config: { hour: 7, minute: 0 } },
    { type: 'EVENING_REVIEW', config: { hour: 21, minute: 0 } },
    { type: 'EMOTION_ALERT', config: { days: 3, threshold: 30, hour: 10, minute: 0 } },
    { type: 'GOAL_REMINDER', config: { daysBefore: 3, hour: 9, minute: 0 } },
    { type: 'WEATHER_ALERT', config: { hour: 8, minute: 0 } },
  ];

  for (const def of defaults) {
    if (!existingTypes.has(def.type)) {
      await prisma.trigger.create({
        data: {
          userId,
          type: def.type,
          config: JSON.stringify(def.config),
          isActive: true,
        },
      });
    }
  }
}

export async function getTriggers(userId: string) {
  return prisma.trigger.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function updateTrigger(userId: string, triggerId: string, data: { isActive?: boolean; config?: Record<string, unknown> }) {
  const trigger = await prisma.trigger.findFirst({ where: { id: triggerId, userId } });
  if (!trigger) return null;

  const updateData: Record<string, unknown> = {};
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.config !== undefined) updateData.config = JSON.stringify(data.config);

  const result = await prisma.trigger.update({
    where: { id: triggerId },
    data: updateData,
  });

  await refreshCronForUser(userId);

  return result;
}
