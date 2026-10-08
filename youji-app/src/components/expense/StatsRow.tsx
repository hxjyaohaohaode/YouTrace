import { useMemo } from 'react';
import { useExpenseStore } from '../../stores/expenseStore';
import { getToday } from '../../utils/date';
import { getExpensePeriodTotals } from '../../utils/expensePeriod';

function formatYuan(fen: number): string {
  return (fen / 100).toFixed(2);
}

export function StatsRow() {
  const items = useExpenseStore((state) => state.items);
  const today = getToday();
  const totals = useMemo(() => getExpensePeriodTotals(items, today), [items, today]);
  const stats = [
    { label: '今日', value: totals.today },
    { label: '本周', value: totals.week },
    { label: '本月', value: totals.month },
  ];
  return <section className="expense-totals" aria-label="支出汇总">
    {stats.map(stat => <div key={stat.label}><span>{stat.label}支出</span><p aria-label={`${stat.label}支出人民币${formatYuan(stat.value)}元`}>¥{formatYuan(stat.value)}</p></div>)}
  </section>;
}
