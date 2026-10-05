import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { useHabitStore, type HabitView } from '../../stores/habitStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { RingProgress } from '../ui/ProgressBar';
import { Input } from '../ui/Input';
import { toast } from '../../services/toastBus';
import { addDays, getToday } from '../../utils/date';
import { getHabitPeriod } from '../../utils/habitPeriod';
import { generateLocalId } from '../../db';
import { habitErrorMessage } from './habitErrors';
import { HabitFrequencyModal } from './HabitFrequencyModal';
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
  const [creationId] = useState(generateLocalId);
  const [error, setError] = useState('');

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true); setError('');
    try {
      const result = await addHabit({ name: trimmed.slice(0, 100), icon, frequency }, creationId);
      if (!result.viewUpdated) toast.warning('习惯已保存在本机，列表暂未刷新，请刷新核对；无需重复创建');
      onClose();
    } catch (cause) {
      setError(habitErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title="新建习惯"
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={saving} onClick={onClose}>取消</Button>
          <Button size="sm" onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
        <div>
          <p className="mb-2 block text-[13px] font-semibold text-[var(--text-1)]">图标</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="选择图标">
            {habitIcons.map((i) => (
              <button
                key={i}
                type="button"
                disabled={saving}
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
          disabled={saving}
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
                disabled={saving}
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
          <p className="mt-2 text-xs leading-relaxed text-[var(--text-3)]">{frequency === 'weekly' ? '每周一次，以周一至周日为一周。做过的那天记一笔即可，不需要每天打卡；也可补记之前实际做过的日期。' : '每天记录当天是否做过，可以补记或撤销指定日期。未打卡不代表没有做过。'}</p>
        </div>
      </div>
    </Modal>
  );
}

function HabitCard({ habit, today, busy, onToggle, onToggleDate, onDelete, onEditFrequency }: { habit: HabitView; today: string; busy: boolean; onToggle: () => void; onToggleDate: (date: string, done: boolean) => void; onDelete: () => void; onEditFrequency: () => void }) {
  const period = getHabitPeriod(habit, today);
  const days = Array.from({ length: 7 }, (_, index) => addDays(today, index - 6));
  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={`min-w-0 rounded-[var(--radius-lg)] bg-[var(--surface)] p-4 border ${period.attained ? 'border-[var(--success)]/30' : 'border-[var(--border-light)]'}`}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onToggle} disabled={busy} aria-pressed={period.doneToday}
          aria-label={period.doneToday ? `取消完成 ${habit.name}（仅今天 ${today}）` : `完成 ${habit.name}（仅今天 ${today}）`}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--surface-2)] text-2xl disabled:opacity-40">{habit.icon}</button>
        <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold text-[var(--text-1)]">{habit.name}</p>
          <p className="mt-1 text-xs text-[var(--text-3)]">{habitFrequencyLabels[habit.frequency]}{period.weekly ? '一次' : ''} · 今天{period.doneToday ? '已记录' : '未打卡'}</p>
        </div>
        <button type="button" onClick={onDelete} disabled={busy} aria-label={`删除习惯 ${habit.name}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--danger)] disabled:opacity-40"><Trash2 size={16} aria-hidden /></button>
      </div>
      <div className="mt-3 space-y-1 text-xs leading-relaxed">
        {period.weekly ? <><p className="text-[var(--text-2)]">本周 {period.start} 至 {period.end}（周一至周日）</p>
          <p className={period.attained ? 'font-semibold text-[var(--success)]' : 'text-[var(--text-2)]'}>{period.attained ? '本周已完成' : '本周尚未记录'} · 每周一次</p>
          <p className="text-[var(--text-3)]">{period.attained ? `已记录：${period.completedDates.join('、')}。今天不用重复完成；如果今天也做了，仍可记录。` : '按自己的安排做过一次后，记录实际日期即可。'}</p></> : <p className="text-[var(--text-2)]">{today} · {period.doneToday ? '今天已记录' : '今天尚未记录'}</p>}
      </div>
      <p className="mt-3 text-xs text-[var(--text-3)]">近7天实际记录 · 点击日期补记或撤销</p>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map(date => { const done = habit.checkinSources.some(row => row.date === date && row.done); return <button key={date} type="button" disabled={busy} onClick={() => onToggleDate(date, !done)}
          aria-label={`${date} ${done ? '已完成，点击撤销' : '未完成，点击补卡'}`} aria-pressed={done} title={`${done ? '撤销' : '补卡'} ${date}`}
          className={`min-w-0 min-h-11 rounded-lg text-[10px] transition-colors disabled:opacity-40 ${done ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-[var(--surface-2)] text-[var(--text-2)]'} ${date === today ? 'ring-1 ring-inset ring-[var(--primary)]' : ''}`}>
          <span className="block">{date.slice(5).replace('-', '/')}</span><span className="block" aria-hidden>{done ? '✓' : '·'}</span>
        </button>; })}
      </div>
      <Button className="mt-2" size="sm" variant="ghost" disabled={busy} aria-label={`调整频率 ${habit.name}`} onClick={onEditFrequency}>调整当前频率</Button>
    </motion.div>
  );
}

export function HabitList() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [frequencyTarget, setFrequencyTarget] = useState<HabitView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HabitView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ message: string; retry?: HabitView } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const [today, setToday] = useState(getToday);
  const items = useHabitStore(s => s.items), refreshError = useHabitStore(s => s.refreshError);
  const setHabitDone = useHabitStore(s => s.setHabitDone), removeHabit = useHabitStore(s => s.removeHabit), reload = useHabitStore(s => s.loadFromDB);
  useEffect(() => { const update = () => setToday(getToday()); const timer = setInterval(update, 60_000); document.addEventListener('visibilitychange', update); return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); }; }, []);
  useEffect(() => { if (!failure) return; const timer = setTimeout(() => { errorRef.current?.focus(); errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 350); return () => clearTimeout(timer); }, [failure]);
  const doneCount = items.filter(row => getHabitPeriod(row, today).attained).length;
  const daily = items.filter(row => row.frequency === 'daily'), weekly = items.filter(row => row.frequency === 'weekly');
  const count = (rows: HabitView[]) => rows.filter(row => getHabitPeriod(row, today).attained).length;

  const handleDelete = async (target: HabitView) => {
    if (busyId) return;
    setBusyId(target.id); setFailure(null);
    try { const result = await removeHabit(target.id, target.source); if (!result.viewUpdated) toast.warning('删除已保存在本机，列表暂未刷新，请刷新核对；无需重复删除'); }
    catch (cause) { setFailure({ message: habitErrorMessage(cause), retry: target }); }
    finally { setBusyId(null); setDeleteTarget(null); }
  };
  const handleDate = async (habit: HabitView, date: string, done: boolean) => {
    if (busyId) return;
    setBusyId(habit.id); setFailure(null);
    try {
      const result = await setHabitDone(habit, date, done);
      if (!result.viewUpdated) toast.warning('修改已保存在本机，列表暂未刷新，请刷新核对；无需重复提交');
      else toast.success(`${habit.name} · ${date} ${done ? '已记录' : '已撤销'}`);
    } catch (cause) { setFailure({ message: habitErrorMessage(cause) }); }
    finally { setBusyId(null); }
  };
  const refresh = async () => { try { await reload(); setFailure(null); } catch { setFailure({ message: '暂时读不到记录，请稍后重试；已保存内容不会重复提交' }); } };
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {items.length > 0 && <RingProgress value={doneCount} max={items.length} size={64} strokeWidth={5} />}
        <div><h2 className="text-lg font-bold text-[var(--text-1)]">习惯记录</h2>
          <p className="mt-1 text-xs text-[var(--text-3)]">{items.length ? [daily.length ? `今日 ${count(daily)}/${daily.length}` : '', weekly.length ? `本周 ${count(weekly)}/${weekly.length}` : ''].filter(Boolean).join(' · ') : '还没有习惯'}</p></div>
      </div>
      <motion.button whileTap={{ scale: 0.95 }} onClick={() => setShowAddModal(true)} aria-label="新建习惯" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-white"><Plus size={20} aria-hidden /></motion.button>
    </div>
    {(failure || refreshError) && <div ref={errorRef} tabIndex={-1} role="alert" className="space-y-2 rounded-xl border border-[var(--danger)]/30 bg-[var(--surface)] p-3 text-sm text-[var(--text-1)]">
      <p>{failure?.message ?? refreshError}</p><div className="flex flex-wrap gap-2">
        {failure?.retry && <Button size="sm" variant="soft" disabled={busyId !== null} onClick={() => void handleDelete(failure.retry!)}>重试删除</Button>}
        <Button size="sm" variant="ghost" disabled={busyId !== null} onClick={() => void refresh()}>刷新核对</Button>
      </div>
    </div>}
    <div className="space-y-3"><AnimatePresence mode="popLayout">{items.map(habit => <HabitCard key={habit.id} habit={habit} today={today} busy={busyId !== null}
      onToggle={() => void handleDate(habit, today, !getHabitPeriod(habit, today).doneToday)} onToggleDate={(date, done) => void handleDate(habit, date, done)} onDelete={() => setDeleteTarget(habit)} onEditFrequency={() => setFrequencyTarget(habit)} />)}</AnimatePresence></div>
    {items.length === 0 && <div className="py-12 text-center"><Sparkles size={28} className="mx-auto mb-3 text-[var(--primary)]" aria-hidden /><p className="text-sm text-[var(--text-3)]">按自己的节奏，从一件小事开始</p><Button className="mt-4" onClick={() => setShowAddModal(true)}>创建第一个习惯</Button></div>}
    {frequencyTarget && <HabitFrequencyModal key={frequencyTarget.id} habit={frequencyTarget} onClose={() => setFrequencyTarget(null)} />}
    {showAddModal && <AddHabitModal open onClose={() => setShowAddModal(false)} />}
    <Modal open={deleteTarget !== null} onClose={() => { if (!busyId) setDeleteTarget(null); }} title="确认删除" footer={<><Button variant="ghost" size="sm" disabled={busyId !== null} onClick={() => setDeleteTarget(null)}>取消</Button><Button variant="danger" size="sm" disabled={busyId !== null} onClick={() => { if (deleteTarget) void handleDelete(deleteTarget); }}>{busyId ? '正在删除…' : '删除'}</Button></>}>
      <p className="text-sm text-[var(--text-1)]">确定要删除「{deleteTarget?.icon} {deleteTarget?.name}」吗？这条习惯的所有打卡记录将一并删除，此操作不可撤销。</p>
      <p className="mt-3 text-xs text-[var(--text-3)]">有未同步修改时会保留原记录，需同步完成后再删除。同名的其他习惯不受影响。</p>
    </Modal>
  </div>;
}
