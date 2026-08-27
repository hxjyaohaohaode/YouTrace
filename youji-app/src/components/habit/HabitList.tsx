import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Flame, Sparkles, Trash2 } from 'lucide-react';
import { useHabitStore, type HabitView } from '../../stores/habitStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { RingProgress } from '../ui/ProgressBar';
import { Input } from '../ui/Input';
import { toast } from '../../services/toastBus';
import { getToday } from '../../utils/date';
import { habitFrequencyLabels } from '../../utils/icons';

const habitIcons = ['🏃', '📚', '😴', '🧘', '💪', '🥗', '💧', '✍️', '🎵', '💊'];
const frequencyOptions: Array<{ value: 'daily' | 'weekly'; label: string }> = [
  { value: 'daily', label: habitFrequencyLabels.daily },
  { value: 'weekly', label: habitFrequencyLabels.weekly },
];

interface AddHabitModalProps {
  open: boolean;
  onClose: () => void;
}

function AddHabitModal({ open, onClose }: AddHabitModalProps) {
  const addHabit = useHabitStore((s) => s.addHabit);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🏃');
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await addHabit({ name: trimmed.slice(0, 100), icon, frequency });
      onClose();
    } catch {
      toast.error('习惯创建失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建习惯"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-2 block text-[13px] font-semibold text-[var(--text-1)]">图标</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="选择图标">
            {habitIcons.map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIcon(i)}
                aria-pressed={icon === i}
                aria-label={`图标 ${i}`}
                className={`flex h-11 w-11 items-center justify-center rounded-2xl text-xl transition-all duration-200 ${
                  icon === i ? 'scale-105 bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] ring-2 ring-[var(--primary)]/30 shadow-[var(--shadow-xs)]' : 'bg-[var(--surface-2)] hover:bg-[var(--border)]'
                }`}
              >
                {i}
              </button>
            ))}
          </div>
        </div>

        <Input
          label="习惯名称"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 100))}
          placeholder="例如：跑步 5 公里"
          maxLength={100}
          autoFocus
        />

        <div>
          <p className="mb-2 block text-[13px] font-semibold text-[var(--text-1)]">频率</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="选择频率">
            {frequencyOptions.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFrequency(f.value)}
                aria-pressed={frequency === f.value}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ${
                  frequency === f.value
                    ? 'bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] text-white shadow-sm'
                    : 'bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--border)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function HabitCard({ habit, onToggle, onToggleDate, onDelete }: { habit: HabitView; onToggle: () => void; onToggleDate: (date: string) => void; onDelete: () => void }) {
  const today = getToday();
  const weekData = habit.recentCheckins.map((entry, i) => ({
    day: i,
    value: entry.done ? 1 : 0,
    date: entry.date,
  }));

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-[var(--radius-lg)] bg-[var(--surface)] p-5 border transition-all duration-200 ${
        habit.done
          ? 'border-[var(--success)]/20 bg-gradient-to-r from-[var(--success)]/5 to-transparent'
          : 'border-[var(--border-light)]'
      }`}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl transition-all duration-200 ${
            habit.done
              ? 'scale-95 bg-gradient-to-r from-[var(--success)] to-[#3FBF7E] shadow-sm'
              : 'bg-[var(--surface-2)] hover:scale-105 hover:bg-[var(--border)]'
          }`}
          aria-pressed={habit.done}
          aria-label={habit.done ? `取消完成 ${habit.name}` : `完成 ${habit.name}`}
        >
          {habit.done ? '✅' : habit.icon}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={`text-[13px] font-semibold transition-colors duration-200 ${habit.done ? 'text-[var(--text-3)] line-through' : 'text-[var(--text-1)]'}`}>
              {habit.name}
            </p>
            {habit.streak > 0 && (
              <span className="flex items-center gap-0.5 text-xs font-bold text-[var(--accent)]">
                <Flame size={12} aria-hidden />
                {habit.streak}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            {weekData.map((entry, i) => {
              const isFuture = entry.date > today;
              const isDone = entry.value === 1;
              return (
                <button
                  key={entry.day}
                  type="button"
                  disabled={isFuture}
                  onClick={() => onToggleDate(entry.date)}
                  aria-label={`${entry.date} ${isDone ? '已完成，点击撤销' : isFuture ? '未来日期' : '未完成，点击补卡'}`}
                  aria-pressed={isDone}
                  title={isFuture ? entry.date : `${isDone ? '撤销' : '补卡'} ${entry.date}`}
                  className={`relative flex h-6 w-6 items-center justify-center rounded-full transition-all ${i === 0 ? 'ml-auto' : ''} ${
                    entry.date === today ? 'ring-2 ring-[var(--success)]/40 ring-offset-1 ring-offset-[var(--surface)]' : ''
                  } ${isFuture ? 'cursor-default opacity-25' : 'hover:scale-110'}`}
                >
                  <span
                    className="block rounded-full"
                    style={{
                      width: 8,
                      height: 8,
                      backgroundColor: isDone ? 'var(--success)' : 'var(--surface-2)',
                      border: isDone ? 'none' : '1px solid var(--border)',
                    }}
                  />
                </button>
              );
            })}
            <span className="text-[10px] font-medium text-[var(--text-3)]">{habitFrequencyLabels[habit.frequency]}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onDelete}
          className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--danger)]"
          aria-label={`删除习惯 ${habit.name}`}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>

      {!habit.done && habit.streak >= 5 && (
        <div className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)]">
          <Flame size={12} aria-hidden />
          <span>连续 {habit.streak} 天！今天别忘了打卡</span>
        </div>
      )}
    </motion.div>
  );
}

export function HabitList() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HabitView | null>(null);
  const items = useHabitStore((s) => s.items);
  const toggleHabit = useHabitStore((s) => s.toggleHabit);
  const removeHabit = useHabitStore((s) => s.removeHabit);

  const doneCount = items.filter((h) => h.done).length;
  const totalCount = items.length;

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await removeHabit(deleteTarget.id);
    } catch {
      toast.error('删除失败，请重试');
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleToggle = async (id: string) => {
    try {
      const before = useHabitStore.getState().items.find((h) => h.id === id);
      await toggleHabit(id);
      const after = useHabitStore.getState().items.find((h) => h.id === id);
      if (after && !before?.done && after.done) {
        toast.success(after.streak > 1 ? `${after.name} · 连续 ${after.streak} 天 🔥` : `${after.name} 已打卡`);
      }
    } catch {
      toast.error('打卡失败，请重试');
    }
  };

  const handleToggleDate = async (id: string, date: string) => {
    try {
      await toggleHabit(id, date);
    } catch {
      toast.error('操作失败，请重试');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {totalCount > 0 && (
            <RingProgress value={doneCount} max={totalCount} size={80} strokeWidth={6} />
          )}
          <div>
            <h2 className="text-lg font-bold tracking-tight text-[var(--text-1)]">今日习惯</h2>
            <p className="mt-0.5 text-xs font-medium text-[var(--text-3)]">
              {totalCount > 0 ? `已完成 ${doneCount}/${totalCount}` : '还没有习惯'}
            </p>
          </div>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowAddModal(true)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] text-white shadow-[var(--shadow-glow)]"
          aria-label="新建习惯"
        >
          <Plus size={20} aria-hidden />
        </motion.button>
      </div>

      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {items.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              onToggle={() => void handleToggle(habit.id)}
              onToggleDate={(date) => void handleToggleDate(habit.id, date)}
              onDelete={() => setDeleteTarget(habit)}
            />
          ))}
        </AnimatePresence>
      </div>

      {totalCount === 0 && (
        <div className="py-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-r from-[var(--primary)]/10 to-[var(--primary-light)]/10">
            <Sparkles size={28} className="text-[var(--primary)]" aria-hidden />
          </div>
          <p className="text-sm font-medium text-[var(--text-3)]">还没有习惯</p>
          <p className="mt-1 text-xs text-[var(--text-3)]">从小事开始，比如每天喝一杯水</p>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)] px-5 py-2.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Plus size={14} aria-hidden />
            创建第一个习惯
          </button>
        </div>
      )}

      <AddHabitModal open={showAddModal} onClose={() => setShowAddModal(false)} />

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="确认删除"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="danger" size="sm" onClick={handleDelete}>删除</Button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-1)]">
          确定要删除「{deleteTarget?.name}」吗？所有打卡记录将一并删除，此操作不可撤销。
        </p>
      </Modal>
    </div>
  );
}
