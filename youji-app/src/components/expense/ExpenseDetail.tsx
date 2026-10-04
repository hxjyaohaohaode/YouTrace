import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useExpenseStore, type ExpenseItem } from '../../stores/expenseStore';
import { expenseCategoryIcons } from '../../utils/icons';
import { formatDateLabel } from '../../utils/date';

function formatYuan(fen: number): string {
  return (fen / 100).toFixed(2);
}

function ExpenseItemRow({ item, onEdit }: { item: ExpenseItem; onEdit: () => void }) {
  const meta = expenseCategoryIcons[item.category] ?? expenseCategoryIcons.other;
  const Icon = meta.icon;
  return <button type="button" onClick={onEdit} id={`expense-record-${item.id}`} className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-[var(--border-light)] bg-[var(--surface)] px-3 py-3.5 text-left focus-visible:outline-2 focus-visible:outline-[var(--primary)]" aria-label={`编辑记账 ${item.name} ${item.date} ${formatYuan(item.amount)}元`}>
    <Icon size={20} className="shrink-0" style={{ color: meta.color }} aria-hidden />
    <div className="min-w-0 flex-1"><p className="break-words text-[13px] font-semibold text-[var(--text-1)]">{item.name}</p><p className="text-[11px] text-[var(--text-3)]">{meta.label} · {item.date} · 编辑</p></div>
    <div className={`flex shrink-0 items-center gap-1 font-mono text-[13px] font-bold ${item.isIncome ? 'text-[var(--success)]' : 'text-[var(--text-1)]'}`}>
      {item.isIncome ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />}<span>{item.isIncome ? '+' : '-'}¥{formatYuan(item.amount)}</span>
    </div>
  </button>;
}

export function ExpenseDetail({ onEdit }: { onEdit: (item: ExpenseItem) => void }) {
  const items = useExpenseStore((s) => s.items);

  const groups = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date));
    const result: Array<[string, ExpenseItem[]]> = [];
    let currentDate = '';
    for (const item of sorted) {
      if (item.date !== currentDate) {
        currentDate = item.date;
        result.push([item.date, []]);
      }
      result[result.length - 1][1].push(item);
    }
    return result;
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm font-medium text-[var(--text-3)]">还没有记录</p>
        <p className="mt-1 text-xs text-[var(--text-3)]">点右上角 + 记下第一笔</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map(([date, groupItems]) => {
        const dayTotal = groupItems.reduce(
          (sum, i) => sum + (i.isIncome ? -i.amount : i.amount),
          0
        );
        return (
        <div key={date}>
          <div className="mb-3 flex items-center justify-between border-l-2 border-[var(--primary)]/30 pl-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--text-3)]">
              {formatDateLabel(date)}
            </p>
            <p className={`font-mono text-[11px] font-bold tabular-nums ${dayTotal >= 0 ? 'text-[var(--text-4)]' : 'text-[var(--success)]'}`}>
              {dayTotal >= 0 ? '' : '+'}¥{formatYuan(Math.abs(dayTotal)).replace('-', '')}
              {dayTotal < 0 ? ' 收' : ''}
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
    </div>
  );
}
