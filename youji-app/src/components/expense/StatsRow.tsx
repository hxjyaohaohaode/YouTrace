import { useMemo } from 'react';
import { CalendarDays, Calendar as CalendarWeek, Calendar } from 'lucide-react';
import { useExpenseStore } from '../../stores/expenseStore';
import { getBusinessMonth, getDateDaysAgo, getNaturalWeekDates, getToday } from '../../utils/date';
import { MiniChart } from '../ui/MiniChart';

function formatYuan(fen: number): string {
  return (fen / 100).toFixed(2);
}

function buildDailyTrend(items: Array<{ date: string; amount: number; isIncome?: boolean }>, days: number): number[] {
  const sums = new Map<string, number>();
  for (const item of items) {
    if (item.isIncome) continue;
    sums.set(item.date, (sums.get(item.date) ?? 0) + item.amount);
  }
  return Array.from({ length: days }, (_, i) => {
    const date = getDateDaysAgo(days - 1 - i);
    return Math.round((sums.get(date) ?? 0) / 100);
  });
}

export function StatsRow() {
  const items = useExpenseStore((s) => s.items);

  const today = getToday();
  const naturalWeek = useMemo(() => new Set(getNaturalWeekDates(today)), [today]);
  const month = getBusinessMonth();

  const todayTotal = useMemo(
    () => items.filter((i) => i.date === today && !i.isIncome).reduce((sum, i) => sum + i.amount, 0),
    [items, today]
  );

  const weekTotal = useMemo(
    () => items.filter((i) => naturalWeek.has(i.date) && !i.isIncome).reduce((sum, i) => sum + i.amount, 0),
    [items, naturalWeek]
  );

  const monthTotal = useMemo(
    () => items.filter((i) => i.date.startsWith(month) && !i.isIncome).reduce((sum, i) => sum + i.amount, 0),
    [items, month]
  );

  const trend = useMemo(() => buildDailyTrend(items, 7), [items]);

  const stats = [
    { label: '今日', value: todayTotal, icon: CalendarDays },
    { label: '本周', value: weekTotal, icon: CalendarWeek },
    { label: '本月', value: monthTotal, icon: Calendar },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {stats.map((stat) => {
        const Icon = stat.icon;

        return (
          <div
            key={stat.label}
            className="rounded-[var(--radius-lg)] border border-[var(--primary)]/10 bg-gradient-to-br from-[var(--primary)]/5 to-[var(--primary-light)]/5 p-4"
          >
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-light)]">
                <Icon size={14} className="text-white" aria-hidden />
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)]">{stat.label}</span>
            </div>

            <p className="truncate font-mono text-lg font-extrabold tabular-nums tracking-tight text-[var(--text-1)] sm:text-xl">
              ¥{formatYuan(stat.value)}
            </p>

            <div className="mt-2">
              <MiniChart type="bar" data={trend} width={56} height={20} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
