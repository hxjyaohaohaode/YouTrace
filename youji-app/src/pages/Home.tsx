import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useCoachStore } from '../stores/coachStore';
import { useSettingsStore } from '../stores/settingsStore';
import { isLoggedIn } from '../services/apiClient';
import { flush } from '../services/syncEngine';
import { generateRealInsights } from '../services/lifeIntelligence';
import { generatePushesFromInsights } from '../services/coachEngine';
import { deliverControlledPush, getEveningReviewPush, isQuietHours, shouldShowEveningReview } from '../services/pushControl';
import { getBusinessDayStartTimestamp, getToday } from '../utils/date';
import { Greeting } from '../components/home/Greeting';
import { BriefCard } from '../components/home/BriefCard';
import { QuickActions } from '../components/home/QuickActions';
import { OverviewCard } from '../components/home/OverviewCard';
import { WeeklyReviewCard } from '../components/home/WeeklyReviewCard';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0 },
};

let eveningReviewShownDate = '';

export default function Home() {
  const dailyBrief = useCoachStore((s) => s.dailyBrief);
  const unreadPushCount = useCoachStore((s) => s.getUnreadPushCount());
  const generateDailyBrief = useCoachStore((s) => s.generateDailyBrief);
  const addInsight = useCoachStore((s) => s.addInsight);
  const addPush = useCoachStore((s) => s.addPush);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (isLoggedIn()) await flush();
      if (cancelled) return;

      const realInsights = await generateRealInsights();
      if (cancelled) return;
      const existingTitles = new Set(
        useCoachStore.getState().insights.filter((i) => !i.dismissed).map((i) => i.title)
      );
      const freshInsights = realInsights.filter((i) => !existingTitles.has(i.title));

      for (const insight of freshInsights) {
        if (cancelled) return;
        await addInsight({
          type: insight.type,
          title: insight.title,
          description: insight.description,
          dataSources: insight.dataSources,
          actionSuggested: insight.actionSuggested,
          dismissed: false,
          significance: 0.7,
        });
      }

      if (cancelled) return;
      await generateDailyBrief({ isCurrent: () => !cancelled });
      if (cancelled) return;

      const settings = useSettingsStore.getState();
      if (!settings.coachPushEnabled || isQuietHours(settings.quietHours)) return;

      const pushes = await generatePushesFromInsights(
        freshInsights.map((fi, i) => ({
          id: `real-${Date.now()}-${i}`,
          type: fi.type,
          title: fi.title,
          description: fi.description,
          dataSources: fi.dataSources,
          actionSuggested: fi.actionSuggested,
          dismissed: false,
          significance: 0.7,
          createdAt: Date.now() + i,
        }))
      );

      for (const push of pushes) {
        if (cancelled) return;
        await deliverControlledPush(push.type, push.title, async () => {
          if (cancelled) return false;
          const duplicate = useCoachStore.getState().pushes.some((existing) =>
            existing.type === push.type && existing.title === push.title && existing.createdAt >= getBusinessDayStartTimestamp()
          );
          if (duplicate) return false;
          await addPush(push);
        });
      }

      if (
        !cancelled &&
        settings.eveningReviewEnabled &&
        shouldShowEveningReview(settings.eveningReviewTime) &&
        eveningReviewShownDate !== getToday()
      ) {
        const review = getEveningReviewPush();
        const delivered = await deliverControlledPush('evening_review', review.title, async () => {
          if (cancelled) return false;
          const duplicate = useCoachStore.getState().pushes.some((existing) =>
            existing.type === 'evening_review' && existing.createdAt >= getBusinessDayStartTimestamp()
          );
          if (duplicate) return false;
          await addPush({ ...review, read: false, acted: false });
        });
        if (delivered) eveningReviewShownDate = getToday();
      }
    }

    init().catch(() => undefined);

    return () => { cancelled = true; };
  }, [generateDailyBrief, addInsight, addPush]);

  const brief = dailyBrief ?? {
    greeting: '你好',
    date: '',
    yesterdayReview: { spent: 0, spentDiff: null, habits: { done: 0, total: 0 }, moodScore: null },
    weeklyInsights: [],
    todayActions: [],
    todaySchedule: [],
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="w-full space-y-6 sm:space-y-10">
      <motion.div variants={item}>
        <Greeting greeting={brief.greeting} date={brief.date} name={brief.nickname} unreadCount={unreadPushCount} />
      </motion.div>

      <motion.section variants={item}>
        <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.1em] text-[var(--text-3)]">快捷入口</h2>
        <QuickActions />
      </motion.section>

      <motion.section variants={item}>
        <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.1em] text-[var(--text-3)]">数据概览</h2>
        <OverviewCard />
      </motion.section>

      <motion.section variants={item}>
        <WeeklyReviewCard />
      </motion.section>

      <motion.section variants={item}>
        <BriefCard data={brief} />
      </motion.section>
    </motion.div>
  );
}
