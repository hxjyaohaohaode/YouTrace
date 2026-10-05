import { useEffect, useRef, useState } from 'react';
import { useHabitStore, type HabitView } from '../../stores/habitStore';
import { getHabitPeriod } from '../../utils/habitPeriod';
import { getToday } from '../../utils/date';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { toast } from '../../services/toastBus';
import { habitErrorMessage } from './habitErrors';

/** The shown parent, dated facts and date remain frozen until save or cancel. */
export function HabitFrequencyModal({ habit, onClose }: { habit: HabitView; onClose: () => void }) {
  const [frequency, setFrequency] = useState(habit.frequency);
  const [previewDate] = useState(getToday);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const setFrequencyIntent = useHabitStore(state => state.setHabitFrequency);
  const before = getHabitPeriod(habit, previewDate), after = getHabitPeriod({ ...habit, frequency }, previewDate);
  const describe = (period: typeof before) => `${period.weekly ? '本周' : '今天'}${period.attained ? '已完成' : '尚未记录'}（${period.start}${period.weekly ? ` 至 ${period.end}` : ''}）`;
  const updated = new Date(habit.source.updatedAt ?? habit.source.createdAt);
  const updatedText = Number.isFinite(updated.getTime()) ? updated.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '时间待核对';
  useEffect(() => { if (!error) return; const frame = requestAnimationFrame(() => { errorRef.current?.focus(); errorRef.current?.scrollIntoView({ block: 'nearest' }); }); return () => cancelAnimationFrame(frame); }, [error]);
  const save = async () => {
    if (saving || frequency === habit.frequency) return;
    setSaving(true); setError('');
    try {
      const result = await setFrequencyIntent(habit, frequency, previewDate);
      if (!result.viewUpdated) toast.warning('频率已保存在本机，列表暂未刷新，请刷新核对；无需重复保存');
      else toast.success('当前频率已更新，原有打卡日期保持不变');
      onClose();
    } catch (cause) { setError(habitErrorMessage(cause)); }
    finally { setSaving(false); }
  };
  return <Modal open onClose={() => { if (!saving) onClose(); }} title="调整当前频率" footer={<>
    <Button variant="ghost" size="sm" disabled={saving} onClick={onClose}>取消</Button>
    <Button size="sm" disabled={saving || frequency === habit.frequency} onClick={() => void save()}>{saving ? '保存中…' : error ? '重试保存' : '保存'}</Button>
  </>}>
    <div className="space-y-4 text-sm leading-relaxed">
      <p className="break-words font-semibold">{habit.icon} {habit.name}</p>
      <p className="text-xs text-[var(--text-3)]" aria-label="上次修改时间">本机记录最近更新：{updatedText}（北京时间）</p>
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-xl border border-[var(--danger)]/30 p-3 text-[var(--danger)]">{error}。当前所选频率仍保留。</p>}
      <div><p className="mb-2 font-semibold">当前频率</p><div role="group" aria-label="选择频率" className="flex gap-2">
        {(['daily', 'weekly'] as const).map(value => <button key={value} type="button" disabled={saving} aria-pressed={frequency === value} onClick={() => setFrequency(value)} className={`min-h-11 rounded-full px-5 text-sm font-semibold disabled:opacity-40 ${frequency === value ? 'bg-[var(--primary)] text-white' : 'bg-[var(--surface-2)] text-[var(--text-2)]'}`}>{value === 'weekly' ? '每周一次' : '每天'}</button>)}
      </div></div>
      <section aria-label="频率调整预览" className="space-y-2 rounded-xl bg-[var(--surface-2)] p-3">
        <p className="font-semibold">保存后立即按新频率显示当前进度</p>
        <p>保存前：{describe(before)}</p><p>保存后：{describe(after)}</p>
        <p className="text-xs text-[var(--text-3)]">今天 {previewDate}{after.doneToday ? '已经记录' : '未打卡'}；改变频率不会替你补记或撤销任何日期。</p>
      </section>
      <section aria-label="频率调整范围说明" className="space-y-2">
      <p>历史打卡日期保持原样，历史页只展示实际记录，不用新频率回算过去的达成率。</p>
      <p className="text-xs text-[var(--text-3)]">暂不支持指定未来生效日期，也不提供历次频率规则回溯。若原记录或打卡在其他位置变化，需要重新打开并核对预览。</p>
      </section>
    </div>
  </Modal>;
}
