import { useMemo, useState } from 'react';
import { RingProgress } from '../ui/ProgressBar';
import { useExpenseStore } from '../../stores/expenseStore';
import { getBusinessMonth } from '../../utils/date';

function formatYuan(fen: number): string {
  return (fen / 100).toFixed(2);
}

export function BudgetCard() {
  const monthBudget = useExpenseStore((s) => s.monthBudget);
  const monthTotal = useExpenseStore((s) => s.monthTotal());
  const monthIncome = useExpenseStore((s) => s.monthIncome());
  const items = useExpenseStore((s) => s.items);
  const setMonthBudget = useExpenseStore((s) => s.setMonthBudget);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const lastMonthTotal = useMemo(() => {
    const now = new Date();
    const cur = getBusinessMonth(now);
    const [y, m] = cur.split('-').map(Number);
    const prev = new Date(Date.UTC(y, m - 2, 15));
    const prevMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
    return items
      .filter((i) => i.date.startsWith(prevMonth) && !i.isIncome)
      .reduce((sum, i) => sum + i.amount, 0);
  }, [items]);

  const monthOverMonth = useMemo(() => {
    if (lastMonthTotal <= 0) return null;
    const diff = Math.round(((monthTotal - lastMonthTotal) / lastMonthTotal) * 100);
    return diff;
  }, [monthTotal, lastMonthTotal]);

  const remaining = monthBudget - monthTotal;

  const startEditing = () => {
    setDraft((monthBudget / 100).toString());
    setEditing(true);
  };

  const commitBudget = async () => {
    const yuan = parseFloat(draft);
    if (Number.isFinite(yuan) && yuan >= 0 && yuan <= 10_000_000) {
      await setMonthBudget(Math.round(yuan * 100));
    }
    setEditing(false);
  };

  return (
    <div className="rounded-[var(--radius-xl)] bg-[var(--surface)] p-4 sm:p-6 border border-[var(--border-light)] shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-3 sm:gap-6">
        <div className="shrink-0">
          <RingProgress value={monthTotal} max={monthBudget} size={100} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-medium text-[var(--text-3)] uppercase tracking-wide">本月已花</p>
            {monthOverMonth !== null && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                  monthOverMonth > 0
                    ? 'bg-[var(--danger)]/10 text-[var(--danger)]'
                    : 'bg-[var(--success)]/10 text-[var(--success)]'
                }`}
                title={`上月 ¥${formatYuan(lastMonthTotal)}`}
              >
                {monthOverMonth > 0 ? '↑' : '↓'}
                {Math.abs(monthOverMonth)}%
              </span>
            )}
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold tracking-tight font-mono tabular-nums text-[var(--text-1)]">
            ¥{formatYuan(monthTotal)}
          </p>
          {editing ? (
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-[var(--text-3)]">预算 ¥</span>
              <input
                autoFocus
                type="number"
                min="0"
                step="10"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitBudget();
                  if (e.key === 'Escape') setEditing(false);
                }}
                onBlur={() => void commitBudget()}
                className="w-20 rounded-[var(--radius-sm)] border border-[var(--primary)] bg-[var(--surface-2)] px-1.5 py-0.5 text-xs tabular-nums text-[var(--text-1)] outline-none"
                aria-label="编辑月预算"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={startEditing}
              className="mt-1 rounded px-0.5 text-[11px] font-medium text-[var(--text-3)] transition-colors hover:text-[var(--primary)]"
              aria-label="编辑月预算"
              title="点击修改预算"
            >
              预算 ¥{formatYuan(monthBudget)} ✎
            </button>
          )}
          <p className={`text-base font-bold mt-2 ${remaining >= 0 ? 'bg-gradient-to-r from-[var(--success)] to-[var(--success)]/70 bg-clip-text text-transparent' : 'bg-gradient-to-r from-[var(--danger)] to-[var(--danger)]/70 bg-clip-text text-transparent'}`}>
            {remaining >= 0 ? `剩余 ¥${formatYuan(remaining)}` : `超支 ¥${formatYuan(-remaining)}`}
          </p>
        </div>
      </div>

      {monthIncome > 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-md)] bg-gradient-to-r from-[var(--success)]/8 to-[var(--success)]/4 px-4 py-2.5">
          <span className="text-[12px] font-semibold text-[var(--success)]">本月收入 ¥{formatYuan(monthIncome)}</span>
        </div>
      )}
    </div>
  );
}
