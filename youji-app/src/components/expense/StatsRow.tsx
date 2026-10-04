import { useMemo } from 'react';
import { CalendarDays, Calendar as CalendarWeek, Calendar } from 'lucide-react';
import { useExpenseStore } from '../../stores/expenseStore';
import { getBusinessMonth, getNaturalWeekDates, getToday } from '../../utils/date';

function formatYuan(fen: number): string {
  return (fen / 100).toFixed(2);
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


  const stats = [
    { label: '今日', value: todayTotal, icon: CalendarDays },
    { label: '本周', value: weekTotal, icon: CalendarWeek },
    { label: '本月', value: monthTotal, icon: Calendar },
  ];

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))' }}>
      {stats.map((stat) => {
        const Icon = stat.icon;

        return (
          <div
            key={stat.label}
            className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--primary)]/10 bg-gradient-to-br from-[var(--primary)]/5 to-[var(--primary-light)]/5 p-3"
          >
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-light)]">
                <Icon size={14} className="text-white" aria-hidden />
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)]">{stat.label}</span>
            </div>

            <p aria-label={`${stat.label}支出人民币${formatYuan(stat.value)}元`} className="ml-auto min-w-0 max-w-full break-all text-right font-mono text-lg font-bold tabular-nums text-[var(--text-1)] sm:text-xl">
              ¥{formatYuan(stat.value)}
            </p>

          </div>
        );
      })}
    </div>
  );
}
