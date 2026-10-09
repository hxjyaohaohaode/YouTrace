import { OverviewCard } from '../components/home/OverviewCard';
import { db } from '../db';
import { Link } from 'react-router-dom';
import { useExpenseStore } from '../stores/expenseStore';
import { useTodoStore } from '../stores/todoStore';
import { useHabitStore } from '../stores/habitStore';
import { useDiaryStore } from '../stores/diaryStore';
import { useScheduleStore, expandRecurringForRange } from '../stores/scheduleStore';
import { useQuickNoteStore } from '../stores/quickNoteStore';
import { useGoalStore } from '../stores/goalStore';
import { useAuthStore } from '../stores/authStore';
import { recordDiagnostic } from '../services/diagnostics';
import { useEffect, useState } from 'react';
import { ArrowRight, PenLine, CalendarDays, CheckSquare } from 'lucide-react';
import '../styles/home-coach.css';
import { useCoachStore, type CoachInsightRecord } from '../stores/coachStore';
import { useSettingsStore } from '../stores/settingsStore';
import { isLoggedIn } from '../services/apiClient';
import { flush } from '../services/syncEngine';
import { assertObservationDeliveryCurrent, managedObservationRule, readRecordObservations, whileObservationVisible } from '../services/recordObservations';
import { generateRealInsights } from '../services/lifeIntelligence';
import { generatePushesFromInsights } from '../services/coachEngine';
import { deliverControlledPush, getEveningReviewPush, isQuietHours, shouldShowEveningReview } from '../services/pushControl';
import { formatBusinessDate, getBusinessDayStartTimestamp, getToday } from '../utils/date';
import { timelineEntries } from '../services/timelineEntries';
import { Greeting } from '../components/home/Greeting';
import { BriefCard } from '../components/home/BriefCard';
import { QuickActions } from '../components/home/QuickActions';
import { WeeklyReviewCard } from '../components/home/WeeklyReviewCard';

let eveningReviewShownDate = '';

export default function Home() {
  const nickname = useAuthStore(state => state.user?.nickname);
  const expenses = useExpenseStore(state => state.items.length), todos = useTodoStore(state => state.items.length), habits = useHabitStore(state => state.items.length), diaries = useDiaryStore(state => state.items.length), schedules = useScheduleStore(state => state.items.length), notes = useQuickNoteStore(state => state.records.length), goals = useGoalStore(state => state.items.length);
  const todoItems = useTodoStore(state => state.items);
  const scheduleItems = useScheduleStore(state => state.items);
  const noteItems = useQuickNoteStore(state => state.records);
  const diaryItems = useDiaryStore(state => state.items);
  const expenseItems = useExpenseStore(state => state.items);
  const [today, setToday] = useState(getToday);
  useEffect(() => {
    const refresh = () => setToday(getToday());
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const pendingTodos = todoItems.filter(row => !row.done);
  const todaySchedule = expandRecurringForRange(scheduleItems, today, today);
  const recentRecords = timelineEntries({ expenses: expenseItems, diaries: diaryItems, notes: noteItems, todos: [], habits: [], checkins: [], schedules: [] }).slice(0, 4);
  const recentLabels = { capture: '速记', diary: '日记', expense: '收支', todo_done: '完成待办', habit: '习惯', schedule: '日程' };
  const isEmpty = expenses + todos + habits + diaries + schedules + notes + goals === 0;
  const [briefError, setBriefError] = useState(false);
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

      const observation = await readRecordObservations().catch(() => null);
      const isManaged = (title: string) => managedObservationRule(title) !== null;
      const realInsights = (await generateRealInsights()).filter(row => !isManaged(row.title) || observation && !observation.choices[row.title === '按适合你的节奏记录' ? 'record-rhythm' : 'spending-comparison'].hidden);
      if (cancelled) return;
      const existingTitles = new Set(
        useCoachStore.getState().insights.filter(i => isManaged(i.title) ? Number.isFinite(i.createdAt) && formatBusinessDate(new Date(i.createdAt)) === getToday() : !i.dismissed).map(i => i.title)
      );
      const freshInsights = realInsights.filter((i) => !existingTitles.has(i.title));

      const freshCreated: CoachInsightRecord[] = [];
      for (const insight of freshInsights) {
        if (cancelled) return;
        const rule = managedObservationRule(insight.title);
        const write = async () => {
          // Under the managed-visibility transaction, two tabs cannot both
          // create the same period's rule from stale in-memory title lists.
          if (rule && (await db.coachInsights.toArray()).some(row => row.title === insight.title && Number.isFinite(row.createdAt) && formatBusinessDate(new Date(row.createdAt)) === observation?.period.end)) return null;
          return addInsight({
          type: insight.type,
          title: insight.title,
          description: insight.description,
          dataSources: insight.dataSources,
          actionSuggested: insight.actionSuggested,
          dismissed: false,
          significance: 0.7,
          });
        };
        const created = rule ? observation && await whileObservationVisible(observation, rule, write) : await write();
        if (created) freshCreated.push(created);
      }

      if (cancelled) return;
      await generateDailyBrief({ isCurrent: () => !cancelled });
      if (cancelled) return;

      const settings = useSettingsStore.getState();
      if (!settings.coachPushEnabled || isQuietHours(settings.quietHours)) return;

      const pushes = await generatePushesFromInsights(freshCreated);

      for (const push of pushes) {
        if (cancelled) return;
        await deliverControlledPush(push.type, push.title, async () => {
          if (cancelled) return false;
          const duplicate = useCoachStore.getState().pushes.some((existing) =>
            existing.type === push.type && existing.title === push.title && existing.createdAt >= getBusinessDayStartTimestamp()
          );
          if (duplicate) return false;
          const rule = managedObservationRule(push.title);
          if (rule) {
            if (!observation) return false;
            return await whileObservationVisible(observation, rule, () => addPush(push)) !== null;
          }
          await addPush(push);
        }, observation && managedObservationRule(push.title) ? () => assertObservationDeliveryCurrent(observation) : undefined);
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

    void init().catch(() => { recordDiagnostic('runtime-error', 'home'); if (!cancelled) setBriefError(true); });

    return () => { cancelled = true; };
  }, [generateDailyBrief, addInsight, addPush]);

  return (
    <div className="home-editorial">
      <Greeting greeting={dailyBrief?.greeting ?? '你好'} date={today} name={nickname} unreadCount={unreadPushCount} />
      <section className="home-capture" aria-labelledby="home-capture-title">
        <div>
          <p className="editorial-eyebrow">随手记录</p>
          <h2 id="home-capture-title">记一句</h2>
          <p>一件刚发生的事，一个还没理清的想法。先记下来，再由你决定怎么整理。</p>
        </div>
        <Link to="/quick-note" className="capture-link"><PenLine size={20} aria-hidden /><span>{isEmpty ? '写下第一条速记' : '记一句'}</span><ArrowRight size={20} aria-hidden /></Link>
        <p className="capture-footnote">确认后才保存整理结果，也可以只留原文。</p>
      </section>
      <div className="home-columns">
        <section aria-labelledby="continue-heading" className="editorial-section">
          <div className="editorial-section-heading"><h2 id="continue-heading">继续处理</h2><Link to="/schedule">看日程 <ArrowRight size={16} aria-hidden /></Link></div>
          <p className="section-intro">{todaySchedule.length ? `今天有 ${todaySchedule.length} 项日程` : '今天暂时没有安排'} · {pendingTodos.length ? `${pendingTodos.length} 项待办未完成` : '没有未完成待办'}</p>
          <div className="editorial-list">
            {todaySchedule.slice(0, 2).map(row => <Link className="editorial-row" to={`/schedule?record=${encodeURIComponent(row.source.id)}&occurrence=${encodeURIComponent(row.occurrenceDate)}`} state={{ returnTo: { path: '/', label: '返回首页' } }} key={row.virtualId}><CalendarDays size={18} aria-hidden /><span><strong>{row.title}</strong><small>{row.startTime}–{row.endTime}{row.location ? ` · ${row.location}` : ''}</small></span><ArrowRight size={16} aria-hidden /></Link>)}
            {pendingTodos.slice(0, 3).map(row => <Link className="editorial-row" to={`/todo?record=${encodeURIComponent(row.id)}`} state={{ returnTo: { path: '/', label: '返回首页' } }} key={row.id}><CheckSquare size={18} aria-hidden /><span><strong>{row.text}</strong><small>{row.dueDate ? `截止 ${row.dueDate}` : '未设置截止日期'}</small></span><ArrowRight size={16} aria-hidden /></Link>)}
            {!todaySchedule.length && !pendingTodos.length && <div className="editorial-empty"><p>暂时没有需要继续处理的事项。</p><Link to="/todo">添加一件待办 <ArrowRight size={16} aria-hidden /></Link></div>}
          </div>
          <QuickActions />
        </section>
        <section aria-labelledby="recent-heading" className="editorial-section">
          <div className="editorial-section-heading"><h2 id="recent-heading">最近记录</h2><Link to="/timeline">看时间线 <ArrowRight size={16} aria-hidden /></Link></div>
          <p className="section-intro">按记录日期排列，随时回看、核对和修改。</p>
          <div className="editorial-list">{recentRecords.length ? recentRecords.map(row => <Link className="editorial-row recent-record" to={row.route} state={{ returnTo: { path: '/', label: '返回首页' } }} key={row.id}><span><small>{row.date ?? '日期未知'} · {recentLabels[row.type]}</small><strong>{row.title}</strong></span><ArrowRight size={16} aria-hidden /></Link>) : <div className="editorial-empty"><p>还没有速记、日记或收支记录。</p><p>第一条记录会从这里开始。</p></div>}</div>
        </section>
      </div>
      <section className="home-review" aria-labelledby="home-overview-heading"><h2 id="home-overview-heading" className="mb-4 text-[22px] font-semibold">记录概览</h2><OverviewCard /></section>
      {!isEmpty && <div className="home-review"><WeeklyReviewCard /><details className="editorial-details"><summary>查看今日回顾与建议</summary><div className="pt-4">{dailyBrief ? <BriefCard data={dailyBrief} /> : <p role="status" className="text-sm text-[var(--text-2)]">{briefError ? '今日回顾暂时无法读取，仍可在时间线查看原始记录。' : '正在读取今日回顾…'}</p>}</div></details></div>}
    </div>
  );
}
