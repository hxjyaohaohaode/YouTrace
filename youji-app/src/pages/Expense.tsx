import { useLocation, useNavigate } from 'react-router-dom';
import { useState, useMemo } from 'react';
import { Plus, Sparkles, TrendingUp, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { BudgetCard, StatsRow, AddExpenseModal, ExpenseDetail } from '../components/expense';
import { Button } from '../components/ui/Button';
import { useExpenseStore, type ExpenseItem } from '../stores/expenseStore';
import { useCoachStore } from '../stores/coachStore';
import { expenseCategoryIcons } from '../utils/icons';
import { getDateDaysAgo, getToday } from '../utils/date';

function CoachInsightBanner() {
  const insights = useCoachStore((s) => s.insights);
  const expenseInsights = insights.filter(
    (i) => !i.dismissed && i.dataSources.includes('expense')
  );

  if (expenseInsights.length === 0) return null;

  const topInsight = expenseInsights[0];

  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--primary)]/15 bg-gradient-to-r from-[var(--primary-muted)] to-[var(--primary-soft)] p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--primary)]/8">
          <Sparkles size={18} className="text-[var(--link)]" aria-hidden />
        </div>
        <div className="flex-1">
          <p className="mb-2 text-xs leading-5 text-[var(--text-2)]">历史提示 · {new Date(topInsight.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（Asia/Shanghai）<br />生成时的快照，不会随新记录更新；当前金额以记录列表和预算卡为准。</p><p className="text-[13px] font-bold text-[var(--link)]">{topInsight.title}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-2)]">{topInsight.description}</p>
          {topInsight.actionSuggested && (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--link)]">
              <ChevronRight size={12} aria-hidden />
              {topInsight.actionSuggested}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

interface PatternRow {
  label: string;
  name: string;
  amount: number;
  percent: number;
}

function SpendingPatternCard() {
  const items = useExpenseStore((s) => s.items);
  const today = getToday();

  const patterns = useMemo(() => {
    const windowStart = getDateDaysAgo(29);
    const recent = items.filter((i) => !i.isIncome && i.date >= windowStart && i.date <= today);
    if (recent.length < 5) return null;

    const rows: PatternRow[] = [];

    const byWeekdayTotal = new Map<number, number>();
    for (const item of recent) {
      const weekday = new Date(`${item.date}T12:00:00Z`).getUTCDay();
      byWeekdayTotal.set(weekday, (byWeekdayTotal.get(weekday) ?? 0) + item.amount);
    }
    const topWeekday = [...byWeekdayTotal.entries()].sort((a, b) => b[1] - a[1])[0];
    const grandTotal = recent.reduce((sum, i) => sum + i.amount, 0);
    if (topWeekday && topWeekday[1] > 0) {
      rows.push({
        label: '按星期汇总的最高支出',
        name: WEEKDAY_NAMES[topWeekday[0]],
        amount: topWeekday[1],
        percent: Math.round((topWeekday[1] / grandTotal) * 100),
      });
    }

    const byCategory = new Map<string, number>();
    for (const item of recent) {
      byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + item.amount);
    }
    const topCategory = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topCategory && topCategory[1] > 0) {
      const meta = expenseCategoryIcons[topCategory[0]];
      rows.push({
        label: '最大支出类别',
        name: meta?.label ?? '其他',
        amount: topCategory[1],
        percent: Math.round((topCategory[1] / grandTotal) * 100),
      });
    }

    return { rows, from: windowStart, through: today, count: recent.length, total: grandTotal };
  }, [items, today]);

  if (!patterns || patterns.rows.length === 0) return null;

  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--primary-muted)]">
          <TrendingUp size={18} className="text-[var(--link)]" aria-hidden />
        </div>
        <div>
          <h3 className="text-[13px] font-bold text-[var(--text-1)]">消费模式</h3>
          <p className="text-[11px] leading-5 text-[var(--text-3)]">近30天 {patterns.from} 至 {patterns.through}（含首尾） · {patterns.count}笔支出 · 支出合计 ¥{(patterns.total / 100).toFixed(2)}</p>
        </div>
      </div>

      <div className="space-y-4">
        {patterns.rows.map((p) => (
          <div key={p.label}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-medium text-[var(--text-2)]">{p.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-[var(--text-2)]">{p.name}</span>
                <span className="font-mono text-[13px] font-bold text-[var(--text-1)]">¥{(p.amount / 100).toFixed(2)}</span>
              </div>
            </div>
            <p className="mb-2 text-[11px] text-[var(--text-3)]">占本期支出 {p.percent}%</p>
            <div className="h-[5px] overflow-hidden rounded-full bg-[var(--surface-2)]">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${p.percent}%` }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="h-full rounded-full"
                style={{ background: 'var(--gradient-primary)' }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Expense() {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ExpenseItem | undefined>();
  const [recoveryId, setRecoveryId] = useState<string | undefined>();
  const [dismissed, setDismissed] = useState('');
  const [routeSnapshot, setRouteSnapshot] = useState<{ key: string; item: ExpenseItem } | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const items = useExpenseStore((state) => state.items);
  const loaded = useExpenseStore((state) => state.loaded);
  const [loadError, setLoadError] = useState('');
  const recordId = new URLSearchParams(location.search).get('record');
  const target = recordId ? items.find((item) => item.id === recordId) : undefined;
  const requestKey = `${location.key}:${recordId ?? ''}`;
  if (loaded && target && routeSnapshot?.key !== requestKey) setRouteSnapshot({ key: requestKey, item: target });
  const requestedItem = loaded && dismissed !== requestKey && routeSnapshot?.key === requestKey ? routeSnapshot.item : undefined;
  const source = (location.state as { returnTo?: { path?: string; label?: string } } | null)?.returnTo;
  const closeEditor = () => {
    setEditing(undefined); setShowModal(false); setRecoveryId(undefined); setDismissed(requestKey);
    const id = editing?.id ?? target?.id;
    if (id) window.setTimeout(() => { const row = document.getElementById(`expense-record-${id}`); row?.scrollIntoView({ block: 'center' }); row?.focus(); }, 250);
  };

  return (
    <div className="record-page expense-page">
      {source?.path && <Button variant="ghost" onClick={() => navigate(-1)}>← {source.label || '返回来源'}</Button>}
      {recordId && !loaded && <p role="status">正在查找这条记录…</p>}
      {recordId && loaded && !target && <section role="status" className="mb-4 space-y-2 rounded-xl border border-[var(--border)] p-4"><p>当前账号未找到这条记录。它可能已删除，或尚未同步到本机。</p><Button variant="soft" onClick={() => { setRecoveryId(recordId); setDismissed(requestKey); }}>查看此记录的本机编辑稿</Button></section>}
      {target && dismissed === requestKey && <Button variant="soft" onClick={() => setEditing(target)}>重新打开选中的记录</Button>}
      <header className="record-page-heading">
        <div><p className="record-eyebrow">记录与回看 / MONEY</p><h1>花销</h1><p className="record-deck">每一笔收支，都清楚有据。</p></div>
        <Button onClick={() => { setDismissed(requestKey); setShowModal(true); }} aria-label="添加花销"><Plus size={18} aria-hidden />记一笔</Button>
      </header>
      {!loaded && <section role="status" className="space-y-3 py-6"><p>{loadError ? `收支暂未读出：${loadError}` : '正在读取本机收支…'}</p><Button variant="soft" onClick={() => { setLoadError(''); void useExpenseStore.getState().loadFromDB().catch(() => setLoadError('读取失败，请检查设备存储后重试')); }}>重试读取</Button></section>}
      {loaded && <><StatsRow />
      <div className="expense-workspace">
        <div className="expense-ledger"><ExpenseDetail onEdit={(item) => { setDismissed(requestKey); setEditing(item); }} /></div>
        <aside className="expense-budget-rail" aria-label="预算与收支参考"><BudgetCard /><details className="record-disclosure"><summary>消费模式与历史提示</summary><div className="mt-4 space-y-4"><CoachInsightBanner /><SpendingPatternCard /><p className="text-xs leading-6 text-[var(--text-3)]">仅在已有历史提示或足够的支出记录时显示分析。</p></div></details></aside>
      </div></>}

      <AddExpenseModal key={editing?.id ?? requestedItem?.id ?? recoveryId ?? 'new'} open={showModal || Boolean(editing || requestedItem || recoveryId)} item={editing ?? requestedItem} draftId={recoveryId} onClose={closeEditor} />
    </div>
  );
}
