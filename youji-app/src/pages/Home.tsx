import { Link } from 'react-router-dom';
import { useExpenseStore } from '../stores/expenseStore';
import { useTodoStore } from '../stores/todoStore';
import { useHabitStore } from '../stores/habitStore';
import { useDiaryStore } from '../stores/diaryStore';
import { useScheduleStore } from '../stores/scheduleStore';
import { useQuickNoteStore } from '../stores/quickNoteStore';
import { useGoalStore } from '../stores/goalStore';
import { useAuthStore } from '../stores/authStore';
import { recordDiagnostic } from '../services/diagnostics';
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
  const nickname = useAuthStore(state => state.user?.nickname);
  const expenses = useExpenseStore(state => state.items.length), todos = useTodoStore(state => state.items.length), habits = useHabitStore(state => state.items.length), diaries = useDiaryStore(state => state.items.length), schedules = useScheduleStore(state => state.items.length), notes = useQuickNoteStore(state => state.records.length), goals = useGoalStore(state => state.items.length);
  const isEmpty = expenses + todos + habits + diaries + schedules + notes + goals === 0;
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

    void init().catch(() => recordDiagnostic('runtime-error', 'home'));

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
        <Greeting greeting={brief.greeting} date={brief.date} name={nickname} unreadCount={unreadPushCount} />
      </motion.div>

      <section className="space-y-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8" aria-label={isEmpty ? '第一次记录' : '继续记录'}>
        <h2 className="text-xl font-bold">{isEmpty ? '先记一件刚发生的事' : '有件事想留下来？'}</h2>
        <p className="max-w-xl text-sm leading-7 text-[var(--text-2)]">{isEmpty ? '不用先填完资料，也不用决定分到哪一类。写一句话，再由你核对日期、收支和待办；也可以只留原文。' : '写完再整理。每一项由你确认，保存后可以直接找到具体记录继续修改。'}</p>
        <Link to="/quick-note" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#5B46D8] px-6 py-3 font-semibold text-white hover:bg-[#4935BC] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">{isEmpty ? '写下第一条速记' : '写一条速记'}</Link>
        {isEmpty && <p className="text-xs text-[var(--text-3)]">例如：明天要交报销单；午饭15。无需向模型发送这段文字。</p>}
        {!isEmpty && <Link to="/timeline" className="ml-4 inline-flex min-h-12 items-center py-3 text-sm underline">找回之前的记录</Link>}
      </section>
      {isEmpty ? <details className="rounded-2xl border border-[var(--border-light)] p-4"><summary className="cursor-pointer py-2 font-semibold">也可以直接安排任务、记账或查看其他功能</summary><div className="pt-4"><QuickActions /></div></details> : <>
        <motion.section variants={item}><h2 className="mb-4 text-sm font-bold">常用功能</h2><QuickActions /></motion.section>
        <motion.section variants={item}><h2 className="mb-4 text-sm font-bold">已有记录概览</h2><OverviewCard /></motion.section>
        <motion.section variants={item}><WeeklyReviewCard /></motion.section>
        <details className="rounded-2xl border border-[var(--border-light)] p-4"><summary className="cursor-pointer py-2 font-semibold">查看今日回顾与建议</summary><div className="pt-4"><BriefCard data={brief} /></div></details>
      </>}

    </motion.div>
  );
}
