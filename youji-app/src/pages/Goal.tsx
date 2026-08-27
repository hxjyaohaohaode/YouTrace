import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Target, Plus, Trash2 } from 'lucide-react';
import { useGoalStore, goalLevelLabels, goalPriorityColors, type GoalLevel, type GoalPriority, type GoalView } from '../stores/goalStore';
import { PageHeader } from '../components/layout/PageHeader';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { toast } from '../services/toastBus';

const levelFilters: Array<{ key: GoalLevel | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'short', label: '短期' },
  { key: 'medium', label: '中期' },
  { key: 'long', label: '长期' },
];

const domains = ['健康', '财务', '学习', '职业', '生活', '社交'];

function GoalCard({ goal, onProgress, onDelete }: {
  goal: GoalView;
  onProgress: (id: string, val: number) => void;
  onDelete: () => void;
}) {
  const isDone = goal.progress >= 100;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className={`rounded-[var(--radius-lg)] border bg-[var(--surface)] p-4 transition-all ${isDone ? 'border-[var(--success)]/20 opacity-70' : 'border-[var(--border-light)]'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${goalPriorityColors[goal.priority]}`}>
              {goal.priority === 'high' ? '高' : goal.priority === 'medium' ? '中' : '低'}
            </span>
            <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-3)]">
              {goal.domain}
            </span>
          </div>
          <p className={`text-[13px] font-bold ${isDone ? 'text-[var(--text-3)] line-through' : 'text-[var(--text-1)]'}`}>
            {goal.title}
          </p>
          {goal.description && (
            <p className="mt-0.5 truncate text-xs text-[var(--text-3)]">{goal.description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onDelete}
          aria-label={'删除目标 ' + goal.title}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-4)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-4)]">
            {goalLevelLabels[goal.level]}
          </span>
          <span className="font-mono text-[11px] font-bold tabular-nums text-[var(--primary)]">{goal.progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: goal.progress + '%' }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className={'h-full rounded-full ' + (isDone ? 'bg-[var(--success)]' : 'bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)]')}
          />
        </div>
        <div className="mt-1.5 flex gap-1">
          {[25, 50, 75, 100].map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => onProgress(goal.id, val)}
              disabled={isDone}
              className="flex-1 rounded-full py-1 text-[10px] font-semibold text-[var(--text-4)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--primary)] disabled:opacity-30"
            >
              {val}%
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

export default function Goal() {
  const items = useGoalStore((s) => s.items);
  const loaded = useGoalStore((s) => s.loaded);
  const addGoal = useGoalStore((s) => s.addGoal);
  const updateProgress = useGoalStore((s) => s.updateProgress);
  const removeGoal = useGoalStore((s) => s.removeGoal);

  const [filter, setFilter] = useState<GoalLevel | 'all'>('all');
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState<GoalLevel>('short');
  const [domain, setDomain] = useState(domains[0]);
  const [priority, setPriority] = useState<GoalPriority>('medium');
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(
    () => items.filter((g) => filter === 'all' || g.level === filter),
    [items, filter]
  );

  const doneCount = items.filter((g) => g.progress >= 100).length;
  const avgProgress = items.length > 0
    ? Math.round(items.reduce((sum, g) => sum + g.progress, 0) / items.length)
    : 0;

  const handleAdd = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await addGoal({
        title: title.trim().slice(0, 100),
        description: description.trim().slice(0, 300),
        level,
        domain,
        priority,
        targetDate: null,
      });
      setTitle('');
      setDescription('');
      setShowModal(false);
      toast.success('目标已创建');
    } catch {
      toast.error('创建失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full">
      <PageHeader
        icon={Target}
        gradient="from-[#7C6FFF] to-[#B06AFF]"
        title="目标"
        subtitle={doneCount + '/' + items.length + ' 完成 · 平均进度 ' + avgProgress + '%'}
        actions={
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowModal(true)}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[#7C6FFF] to-[#B06AFF] text-white shadow-[var(--shadow-glow)]"
            aria-label="新建目标"
          >
            <Plus size={20} aria-hidden />
          </motion.button>
        }
      />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1 scrollbar-hide" role="tablist" aria-label="目标类型筛选">
        {levelFilters.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setFilter(opt.key)}
            role="tab"
            aria-selected={filter === opt.key}
            className={
              'shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition-all duration-200 ' +
              (filter === opt.key
                ? 'bg-[var(--primary-soft)] text-[var(--primary)] shadow-[var(--shadow-xs)]'
                : 'bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--border)]')
            }
          >
            {opt.label}
          </button>
        ))}
      </div>

      {!loaded ? null : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--surface-2)]">
            <Target size={28} className="text-[var(--text-3)]" aria-hidden />
          </div>
          <p className="text-sm font-medium text-[var(--text-3)]">还没有目标</p>
          <p className="mt-1 text-xs text-[var(--text-3)]">给自己定一个小目标，追踪进度直到完成</p>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)] px-5 py-2.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Plus size={14} aria-hidden />
            创建第一个目标
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                onProgress={(id, val) => void updateProgress(id, val)}
                onDelete={() => void removeGoal(goal.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="新建目标" footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => setShowModal(false)}>取消</Button>
          <Button size="sm" onClick={() => void handleAdd()} disabled={!title.trim() || saving}>
            {saving ? '创建中…' : '创建'}
          </Button>
        </>
      }>
        <div className="space-y-4">
          <Input label="标题 *" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 100))} placeholder="想完成什么？" maxLength={100} autoFocus />
          <Input label="描述（可选）" value={description} onChange={(e) => setDescription(e.target.value.slice(0, 300))} placeholder="补充说明..." maxLength={300} />

          <div>
            <p className="mb-1.5 block text-[13px] font-semibold text-[var(--text-1)]">类型</p>
            <div className="flex gap-2" role="radiogroup" aria-label="目标类型">
              {levelFilters.filter((f) => f.key !== 'all').map((f) => (
                <button key={f.key} type="button" onClick={() => setLevel(f.key as GoalLevel)} aria-checked={level === f.key} role="radio"
                  className={'rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ' + (level === f.key ? 'bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] text-white shadow-sm' : 'bg-[var(--surface-2)] text-[var(--text-3)]')}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 block text-[13px] font-semibold text-[var(--text-1)]">领域</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="领域">
              {domains.map((d) => (
                <button key={d} type="button" onClick={() => setDomain(d)} aria-checked={domain === d} role="radio"
                  className={'rounded-full px-3 py-1 text-xs font-medium transition-all ' + (domain === d ? 'bg-[var(--primary-soft)] text-[var(--primary)] border border-[var(--primary)]/20' : 'bg-[var(--surface-2)] text-[var(--text-3)] border border-transparent')}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 block text-[13px] font-semibold text-[var(--text-1)]">优先级</p>
            <div className="flex gap-2" role="radiogroup" aria-label="优先级">
              {(['low', 'medium', 'high'] as GoalPriority[]).map((p) => (
                <button key={p} type="button" onClick={() => setPriority(p)} aria-checked={priority === p} role="radio"
                  className={'rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ' + (priority === p ? goalPriorityColors[p] + ' ring-1 ring-current' : 'bg-[var(--surface-2)] text-[var(--text-3)]')}>
                  {p === 'high' ? '高' : p === 'medium' ? '中' : '低'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
