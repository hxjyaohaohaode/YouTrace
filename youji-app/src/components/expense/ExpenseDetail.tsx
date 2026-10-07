import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useExpenseStore, type ExpenseItem } from '../../stores/expenseStore';
import { expenseCategoryIcons } from '../../utils/icons';
import { formatDateLabel } from '../../utils/date';
import { expenseDayNetLabel } from './expensePresentation';
import { expenseListMonth, filterExpenseList, UNKNOWN_EXPENSE_MONTH, type ExpenseListFilters } from './expenseListFilter';
import { Button } from '../ui/Button';

function formatYuan(fen: number): string {
  return (fen / 100).toFixed(2);
}

function categoryLabel(category: string): string {
  return Object.hasOwn(expenseCategoryIcons, category)
    ? expenseCategoryIcons[category].label
    : `未知类别：${JSON.stringify(category)}`;
}

function monthLabel(month: string | null): string {
  return month === null ? '所有月份' : month === UNKNOWN_EXPENSE_MONTH ? '日期待核对' : month;
}

function ExpenseItemRow({ item, onEdit }: { item: ExpenseItem; onEdit: () => void }) {
  const meta = Object.hasOwn(expenseCategoryIcons, item.category) ? expenseCategoryIcons[item.category] : expenseCategoryIcons.other;
  const Icon = meta.icon;
  return <button type="button" onClick={onEdit} id={`expense-record-${item.id}`} className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-[var(--border-light)] bg-[var(--surface)] px-3 py-3.5 text-left focus-visible:outline-2 focus-visible:outline-[var(--primary)]" aria-label={`编辑记账 ${item.name} ${item.date} ${item.isIncome ? '收入' : '支出'} ${formatYuan(item.amount)}元`}>
    <Icon size={20} className="shrink-0" style={{ color: meta.color }} aria-hidden />
    <div className="min-w-0 flex-1"><p className="break-words text-[13px] font-semibold text-[var(--text-1)]">{item.name}</p><p className="break-words text-[11px] text-[var(--text-3)]">{categoryLabel(item.category)} · {item.date || '日期缺失'} · 编辑</p></div>
    <div className={`flex shrink-0 items-center gap-1 font-mono text-[13px] font-bold ${item.isIncome ? 'text-[var(--success)]' : 'text-[var(--text-1)]'}`}>
      {item.isIncome ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />}<span aria-label={`${item.isIncome ? '收入' : '支出'} ${formatYuan(item.amount)}元`}>{item.isIncome ? '+' : '-'}¥{formatYuan(item.amount)}</span>
    </div>
  </button>;
}

export function ExpenseDetail({ onEdit }: { onEdit: (item: ExpenseItem) => void }) {
  const items = useExpenseStore((s) => s.items);
  const [filters, setFilters] = useState<ExpenseListFilters>({ month: null, category: null });
  const view = useMemo(() => filterExpenseList(items, filters), [items, filters]);
  const filtering = filters.month !== null || filters.category !== null;

  const groups = useMemo(() => {
    const sorted = [...view.items].sort((a, b) => b.date.localeCompare(a.date));
    const result = new Map<string, ExpenseItem[]>();
    for (const item of sorted) {
      const group = result.get(item.date) ?? [];
      group.push(item);
      result.set(item.date, group);
    }
    return [...result];
  }, [view.items]);

  return (
    <section aria-labelledby="expense-detail-title" aria-describedby="expense-detail-scope" className="space-y-5">
      <div className="space-y-3">
        <h4 id="expense-detail-title" className="text-sm font-semibold text-[var(--text-1)]">花销明细</h4>
        <p id="expense-detail-scope" className="text-xs leading-5 text-[var(--text-3)]">仅筛选本机当前已加载的记录，包含收入和未来日期，不代表远端全部历史。每日净额仅计入当前筛选结果；预算与今日、本周、本月统计不随明细筛选变化。</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label htmlFor="expense-filter-month" className="min-w-0 space-y-1 text-xs font-medium text-[var(--text-2)]">
            <span>月份</span>
            <select id="expense-filter-month" value={filters.month ?? ''} onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value || null }))} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm focus-visible:outline-2 focus-visible:outline-[var(--primary)]">
              <option value="">所有月份</option>
              {view.months.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}
            </select>
          </label>
          <label htmlFor="expense-filter-category" className="min-w-0 space-y-1 text-xs font-medium text-[var(--text-2)]">
            <span>类别</span>
            <select id="expense-filter-category" value={filters.category === null ? '' : `category:${filters.category}`} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value === '' ? null : event.target.value.slice('category:'.length) }))} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm focus-visible:outline-2 focus-visible:outline-[var(--primary)]">
              <option value="">所有类别</option>
              {view.categories.map((category) => <option key={category} value={`category:${category}`}>{categoryLabel(category)}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="min-w-0 break-words text-xs leading-5 text-[var(--text-2)]">当前明细：{monthLabel(filters.month)} · {filters.category === null ? '所有类别' : categoryLabel(filters.category)}，显示 {view.items.length} / {items.length} 笔</p>
          <Button variant="ghost" size="sm" disabled={!filtering} onClick={() => setFilters({ month: null, category: null })}>清除筛选</Button>
        </div>
        <p className="text-xs leading-5 text-[var(--text-3)]">筛选在本页编辑期间保留，离开或刷新页面后重置。</p>
      </div>
      {view.items.length === 0 && (
        <div className="py-10 text-center">
          <p className="text-sm font-medium text-[var(--text-3)]">{filtering ? '没有符合当前筛选的记录' : '本机当前没有已加载的记录'}</p>
          <p className="mt-1 text-xs text-[var(--text-3)]">{filtering ? '可调整月份或类别，或清除筛选查看全部已加载记录。' : '点右上角 + 记下第一笔'}</p>
        </div>
      )}
      {groups.map(([date, groupItems]) => {
        const dayTotal = groupItems.reduce(
          (sum, i) => sum + (i.isIncome ? -i.amount : i.amount),
          0
        );
        return (
        <div key={date}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-l-2 border-[var(--primary)]/30 pl-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--text-3)]">
              {expenseListMonth(date) === UNKNOWN_EXPENSE_MONTH ? `${date || '日期缺失'}（日期待核对）` : `${date} · ${formatDateLabel(date)}`}
            </p>
            <p className={`font-mono text-[11px] font-bold tabular-nums ${dayTotal >= 0 ? 'text-[var(--text-4)]' : 'text-[var(--success)]'}`}>
              当前明细{expenseDayNetLabel(dayTotal)}
            </p>
          </div>
          <div className="space-y-2">
            <AnimatePresence>
              {groupItems.map((item) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  transition={{ duration: 0.2 }}
                >
                  <ExpenseItemRow
                    item={item}
                    onEdit={() => onEdit(item)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
        );
      })}
    </section>
  );
}
