import { useMemo, useRef, useState } from 'react';
import { RingProgress } from '../ui/ProgressBar';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { getBusinessMonth } from '../../utils/date';
import { parseYuanToFen, useExpenseStore } from '../../stores/expenseStore';
import { expenseWriteFailure } from './expensePresentation';

const yuan = (fen: number) => (fen / 100).toFixed(2);

export function BudgetCard() {
  const monthBudget = useExpenseStore((state) => state.monthBudget);
  const budgetStatus = useExpenseStore((state) => state.budgetStatus);
  const total = useExpenseStore((state) => state.monthTotal());
  const income = useExpenseStore((state) => state.monthIncome());
  const items = useExpenseStore((state) => state.items);
  const previousMonthTotal = useMemo(() => {
    const [year, month] = getBusinessMonth().split('-').map(Number);
    const previous = new Date(Date.UTC(year, month - 2, 15));
    const key = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
    return items.filter((item) => item.date.startsWith(key) && !item.isIncome).reduce((sum, item) => sum + item.amount, 0);
  }, [items]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [baseline, setBaseline] = useState({ monthBudget, budgetStatus });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const guard = useRef(false);
  const start = () => { if (draft === null) setDraft(budgetStatus === 'unset' ? '' : yuan(monthBudget)); setBaseline({ monthBudget, budgetStatus }); setEditing(true); setError(''); };
  const save = async () => {
    if (guard.current) return;
    const fen = parseYuanToFen(draft ?? '', true);
    if (fen === null) { setError('请输入有效预算，最多两位小数且不超过一亿元'); return; }
    guard.current = true; setPending(true); setError('');
    try { await useExpenseStore.getState().setMonthBudget(fen, baseline); setDraft(null); setEditing(false); }
    catch (reason) { setError(expenseWriteFailure(reason, 'budget')); }
    finally { guard.current = false; setPending(false); }
  };
  const confirmed = budgetStatus === 'configured';
  const remaining = monthBudget - total;
  return <section className="rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-6" aria-label="月预算">
    <div className="flex flex-wrap items-center gap-4">
      {confirmed && monthBudget > 0 && <RingProgress value={total} max={monthBudget} size={100} />}
      <div className="min-w-0 flex-1"><p className="text-xs text-[var(--text-3)]">本月已花</p><p className="break-words font-mono text-2xl font-bold">¥{yuan(total)}</p>
        <p className="mt-2 text-sm">{budgetStatus === 'unset' ? '尚未设置月预算' : budgetStatus === 'unknown' ? `本设备已有预算 ¥${yuan(monthBudget)}（来源未确认）` : `月预算 ¥${yuan(monthBudget)}`}</p>
        {confirmed && <p className={`mt-2 text-sm ${remaining < 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]'}`}>{monthBudget === 0 ? `已明确设置为 0 元${total > 0 ? `，支出 ¥${yuan(total)}` : ''}` : remaining < 0 ? `超出预算 ¥${yuan(-remaining)}` : `剩余 ¥${yuan(remaining)}`}</p>}
        {!editing && <Button variant="soft" className="mt-3" onClick={start}>{draft !== null ? '继续编辑预算' : budgetStatus === 'unset' ? '设置预算' : '编辑月预算'}</Button>}
      </div>
    </div>
    {editing && <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <Input label="月预算（人民币元）" inputMode="decimal" value={draft ?? ''} disabled={pending} onChange={(event) => setDraft(event.target.value)} placeholder="可明确设为 0" />
      <p className="text-xs text-[var(--text-3)]">预算仅保存在本设备。保存后才采用新金额；取消会保留本页输入。</p>
      {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>{pending ? '保存中…' : '保存预算'}</Button><Button variant="ghost" onClick={() => setEditing(false)} disabled={pending}>取消</Button>{error && <Button variant="ghost" disabled={pending} onClick={() => void useExpenseStore.getState().loadFromDB().then(() => { const latest = useExpenseStore.getState(); setBaseline({ monthBudget: latest.monthBudget, budgetStatus: latest.budgetStatus }); setError('已读取最新预算，请核对卡片金额；你的输入仍保留'); }).catch(() => setError('读取预算失败，请重试'))}>核对最新预算</Button>}</div>
    </form>}
    {previousMonthTotal > 0 && <p className="mt-4 text-xs text-[var(--text-3)]">参考：上月整月支出 ¥{yuan(previousMonthTotal)}（本月尚未结束）</p>}
    {income > 0 && <p className="mt-4 text-sm text-[var(--success)]">本月收入 ¥{yuan(income)}</p>}
  </section>;
}
