import { useLocation, useNavigate } from 'react-router-dom';
import { useState, useMemo } from 'react';
import { Plus, Sparkles, TrendingUp, ChevronRight, Receipt } from 'lucide-react';
import { motion } from 'framer-motion';
import { BudgetCard, StatsRow, AddExpenseModal, ExpenseDetail } from '../components/expense';
import { PageHeader } from '../components/layout/PageHeader';
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
          <Sparkles size={18} className="text-[var(--primary)]" aria-hidden />
        </div>
        <div className="flex-1">
          <p className="mb-2 text-xs leading-5 text-[var(--text-2)]">历史提示 · {new Date(topInsight.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（Asia/Shanghai）<br />生成时的快照，不会随新记录更新；当前金额以记录列表和预算卡为准。</p><p className="text-[13px] font-bold text-[var(--primary)]">{topInsight.title}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-2)]">{topInsight.description}</p>
          {topInsight.actionSuggested && (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--primary)]">
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
  value: string;
  sub: string;
  percent: number;
}

function SpendingPatternCard() {
  const items = useExpenseStore((s) => s.items);
  const today = getToday();

  const patterns = useMemo<PatternRow[]>(() => {
    const windowStart = getDateDaysAgo(29);
    const recent = items.filter((i) => !i.isIncome && i.date >= windowStart && i.date <= today);
    if (recent.length < 5) return [];

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
        label: '最高消费日',
        value: WEEKDAY_NAMES[topWeekday[0]],
        sub: `¥${(topWeekday[1] / 100).toFixed(0)}`,
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
        value: `${Math.round((topCategory[1] / grandTotal) * 100)}%`,
        sub: meta?.label ?? '其他',
        percent: Math.round((topCategory[1] / grandTotal) * 100),
      });
    }

    return rows;
  }, [items, today]);

  if (patterns.length === 0) return null;

  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--primary-muted)]">
          <TrendingUp size={18} className="text-[var(--primary)]" aria-hidden />
        </div>
        <div>
          <h3 className="text-[13px] font-bold text-[var(--text-1)]">消费模式</h3>
          <p className="text-[11px] text-[var(--text-3)]">基于近30天真实记录</p>
        </div>
      </div>

      <div className="space-y-4">
        {patterns.map((p) => (
          <div key={p.label}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-medium text-[var(--text-2)]">{p.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--text-3)]">{p.sub}</span>
                <span className="font-mono text-[13px] font-bold text-[var(--text-1)]">{p.value}</span>
              </div>
            </div>
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
    <div className="w-full">
      {source?.path && <Button variant="ghost" onClick={() => navigate(-1)}>← {source.label || '返回来源'}</Button>}
      {recordId && !loaded && <p role="status">正在查找这条记录…</p>}
      {recordId && loaded && !target && <section role="status" className="mb-4 space-y-2 rounded-xl border border-[var(--border)] p-4"><p>当前账号未找到这条记录。它可能已删除，或尚未同步到本机。</p><Button variant="soft" onClick={() => { setRecoveryId(recordId); setDismissed(requestKey); }}>查看此记录的本机编辑稿</Button></section>}
      {target && dismissed === requestKey && <Button variant="soft" onClick={() => setEditing(target)}>重新打开选中的记录</Button>}
      <PageHeader
        icon={Receipt}
        gradient="from-[#FF9A56] to-[#FF6B8A]"
        title="花销"
        subtitle="记清每笔收支，随时核对和修改"
        actions={
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => { setDismissed(requestKey); setShowModal(true); }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] text-white shadow-[var(--shadow-glow)] transition-opacity hover:opacity-90"
            aria-label="添加花销"
          >
            <Plus size={18} aria-hidden />
          </motion.button>
        }
      />

      <div className="grid w-full grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-12">
        <div className="w-full space-y-4 lg:col-span-5">
          <BudgetCard />
<details className="rounded-2xl border border-[var(--border)] p-4"><summary className="cursor-pointer py-2 text-sm font-semibold">查看收支统计与历史提示</summary><div className="mt-4 space-y-4"><StatsRow /><CoachInsightBanner /><SpendingPatternCard /></div></details>
        </div>

        <div className="w-full lg:col-span-7">
          <div className="w-full rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--primary-muted)]">
                  <Receipt size={16} className="text-[var(--primary)]" aria-hidden />
                </div>
                <h3 className="text-[13px] font-bold text-[var(--text-1)]">全部记录</h3>
              </div>
            </div>
            <ExpenseDetail onEdit={(item) => { setDismissed(requestKey); setEditing(item); }} />
          </div>
        </div>
      </div>

      <AddExpenseModal key={editing?.id ?? requestedItem?.id ?? recoveryId ?? 'new'} open={showModal || Boolean(editing || requestedItem || recoveryId)} item={editing ?? requestedItem} draftId={recoveryId} onClose={closeEditor} />
    </div>
  );
}
