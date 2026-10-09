import { useEffect, useMemo, useState } from 'react';
import { Wallet, CheckCircle, BookOpen, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useExpenseStore } from '../../stores/expenseStore';
import { useHabitStore } from '../../stores/habitStore';
import { useDiaryStore } from '../../stores/diaryStore';
import { useScheduleStore } from '../../stores/scheduleStore';
import { formatBusinessDate, getNaturalWeekDates } from '../../utils/date';
import { getExpenseOverview, getHabitOverview, getOverviewRefreshDelay, getScheduleOverview } from '../../lib/homeOverview';

interface OverviewItem {
  icon: typeof Wallet;
  label: string;
  value: string;
  sub: string;
  path: string;
}

export function OverviewCard() {
  const navigate = useNavigate();
  const expenses = useExpenseStore((s) => s.items);
  const budgetStatus = useExpenseStore((s) => s.budgetStatus);
  const monthBudget = useExpenseStore((s) => s.monthBudget);
  const habits = useHabitStore((s) => s.items);
  const diaries = useDiaryStore((s) => s.items);
  const schedules = useScheduleStore((s) => s.items);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      timer = setTimeout(refresh, getOverviewRefreshDelay(current));
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    timer = setTimeout(refresh, getOverviewRefreshDelay(Date.now()));
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, []);

  const overview = useMemo(() => {
    const current = new Date(now);
    const weekDates = new Set(getNaturalWeekDates(formatBusinessDate(current)));
    const weekDiaryCount = diaries.filter((d) => weekDates.has(d.date)).length;

    return {
      expense: getExpenseOverview(expenses, monthBudget, current),
      habit: getHabitOverview(habits, current),
      diary: {
        value: `${weekDiaryCount} 篇`,
        sub: '本周已写',
      },
      schedule: getScheduleOverview(schedules, current),
    };
  }, [expenses, monthBudget, habits, diaries, schedules, now]);

  const items: OverviewItem[] = [
    {
      icon: Wallet,
      label: '本月花销',
      ...overview.expense,
      sub: budgetStatus === 'unset' ? '预算未设置，可按需设置' : budgetStatus === 'unknown' ? `原预算 ¥${(monthBudget / 100).toLocaleString('zh-CN')}，待核对` : overview.expense.sub,
      path: '/expense',
    },
    {
      icon: CheckCircle,
      ...overview.habit,
      path: '/habit',
    },
    {
      icon: BookOpen,
      label: '日记',
      ...overview.diary,
      path: '/diary',
    },
    {
      icon: Clock,
      label: '今日日程',
      ...overview.schedule,
      path: '/schedule',
    },
  ];

  return <div data-component="home-overview" className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
    {items.map(ov => { const Icon = ov.icon; return <button key={ov.label} type="button" onClick={() => navigate(ov.path)} className="flex w-full items-center gap-4 py-4 text-left">
      <Icon size={20} className="shrink-0 text-[var(--text-2)]" aria-hidden /><span className="min-w-0 flex-1"><span data-overview-label className="block text-base font-medium">{ov.label}</span><span data-overview-detail className="block text-sm text-[var(--text-2)]">{ov.sub}</span></span><span data-overview-value className="text-lg font-semibold tabular-nums">{ov.value}</span>
    </button>; })}
  </div>;
}
