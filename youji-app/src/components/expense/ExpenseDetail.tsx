import { useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useExpenseStore, type ExpenseItem } from '../../stores/expenseStore';
import { expenseCategoryIcons } from '../../utils/icons';
import { toast } from '../../services/toastBus';
import { formatDateLabel } from '../../utils/date';

function formatYuan(fen: number): string {
  return (fen / 100).toFixed(2);
}

interface ExpenseItemRowProps {
  item: ExpenseItem;
  onDelete: () => void;
}

function ExpenseItemRow({ item, onDelete }: ExpenseItemRowProps) {
  const [offsetX, setOffsetX] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const lockedAxis = useRef<'none' | 'x' | 'y'>('none');
  const catIcon = expenseCategoryIcons[item.category] ?? expenseCategoryIcons.other;
  const Icon = catIcon.icon;

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    lockedAxis.current = 'none';
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (lockedAxis.current === 'y') return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    if (lockedAxis.current === 'none') {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
        lockedAxis.current = 'y';
        return;
      }
      if (Math.abs(dx) > 8) {
        lockedAxis.current = 'x';
      } else {
        return;
      }
    }
    if (dx < 0) {
      setOffsetX(Math.max(dx, -80));
    }
  };

  const handleTouchEnd = () => {
    setOffsetX(offsetX < -40 ? -80 : 0);
  };

  return (
    <div className="relative overflow-hidden rounded-[var(--radius-md)]">
      <div className="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-[var(--danger)]">
        <button type="button" onClick={onDelete} className="text-white" aria-label={`删除 ${item.name}`}>
          <Trash2 size={16} aria-hidden />
        </button>
      </div>

      <motion.div
        animate={{ x: offsetX }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="relative flex items-center gap-4 border border-[var(--border-light)] bg-[var(--surface)] px-4 py-3.5"
      >
        <div
          className="flex h-11 w-11 items-center justify-center rounded-2xl"
          style={{ background: `linear-gradient(135deg, ${catIcon.color}20, ${catIcon.color}08)` }}
        >
          <Icon size={18} style={{ color: catIcon.color }} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[var(--text-1)]">{item.name}</p>
          <p className="text-[11px] font-medium text-[var(--text-3)]">{catIcon.label}</p>
        </div>
        <div className={`flex shrink-0 items-center gap-1 font-mono text-[13px] font-bold ${item.isIncome ? 'text-[var(--success)]' : 'text-[var(--text-1)]'}`}>
          {item.isIncome ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />}
          <span aria-label={`${item.isIncome ? '收入' : '支出'} ${formatYuan(item.amount)}元`}>
            {item.isIncome ? '+' : '-'}¥{formatYuan(item.amount)}
          </span>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="hidden h-9 w-9 shrink-0 items-center justify-center sm:flex rounded-[var(--radius-sm)] text-[var(--text-3)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] sm:flex"
          aria-label={`删除 ${item.name}`}
        >
          <Trash2 size={15} aria-hidden />
        </button>
      </motion.div>
    </div>
  );
}

export function ExpenseDetail() {
  const items = useExpenseStore((s) => s.items);
  const removeItem = useExpenseStore((s) => s.removeItem);

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

  const handleDelete = async (id: string, name: string) => {
    try {
      await removeItem(id);
      toast.success(`已删除「${name}」`);
    } catch {
      toast.error('删除失败，请重试');
    }
  };

  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm font-medium text-[var(--text-3)]">还没有记录</p>
        <p className="mt-1 text-xs text-[var(--text-3)]">点左上角 + 记下第一笔</p>
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
                    onDelete={() => void handleDelete(item.id, item.name)}
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
