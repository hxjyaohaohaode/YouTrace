import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { generateLocalId, type ScheduleRecord } from '../../db';
import { sameScheduleSnapshot, useScheduleStore, type ScheduleOccurrence, type ScheduleScope } from '../../stores/scheduleStore';
import { useScheduleEditorDraft } from './useScheduleEditorDraft';
import { toast } from '../../services/toastBus';
import { scheduleFailureMessage } from './scheduleErrors';

interface ScheduleForm { id: string; title: string; date: string; startTime: string; endTime: string; location: string; type: ScheduleRecord['type']; repeat: ScheduleRecord['repeat']; remind: number; scope: ScheduleScope; occurrenceDate: string; base: ScheduleRecord | null }
export function ScheduleEditor({ item, selectedDate, onClose }: { item?: ScheduleOccurrence; selectedDate: string; onClose: () => void }) {
  const draft = useScheduleEditorDraft<ScheduleForm>(item ? `${item.id}@${item.occurrenceDate}` : `new:${selectedDate}`, {
    id: item?.id ?? generateLocalId(), title: item?.title ?? '', date: item?.date ?? selectedDate, startTime: item?.startTime ?? '09:00', endTime: item?.endTime ?? '10:30', location: item?.location ?? '', type: item?.type ?? 'other', repeat: item?.repeat ?? 'none', remind: item?.remind ?? 0, scope: item?.repeat === 'weekly' ? 'occurrence' : 'series', occurrenceDate: item?.occurrenceDate ?? selectedDate, base: item ? structuredClone(item.source) : null,
  });
  const form = draft.value, current = useScheduleStore(state => state.items.find(row => row.id === item?.id));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmDelete, setConfirmDelete] = useState(false);
  const guard = useRef(false), first = useRef<HTMLInputElement>(null), errorRegion = useRef<HTMLDivElement>(null);
  useEffect(() => { if (draft.ready) first.current?.focus(); }, [draft.ready]);
  const visibleError = error || (draft.error ? scheduleFailureMessage(new Error(draft.error)) : '');
  useEffect(() => {
    if (!visibleError) return;
    const frame = requestAnimationFrame(() => { errorRegion.current?.focus(); errorRegion.current?.scrollIntoView({ block: 'center' }); });
    return () => cancelAnimationFrame(frame);
  }, [visibleError]);
  const stale = Boolean(item && (!form.base || !sameScheduleSnapshot(current, form.base)));
  const recurring = form.base?.repeat === 'weekly';
  const timeValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(form.startTime) && /^([01]\d|2[0-3]):[0-5]\d$/.test(form.endTime) && form.startTime < form.endTime;
  const update = (patch: Partial<ScheduleForm>) => { if (guard.current) return; draft.update({ ...form, ...patch }); setError(''); };
  const close = async () => {
    if (guard.current) return;
    try { if (draft.ready) await draft.prepare(); onClose(); }
    catch { setError('草稿尚未保留，暂未关闭以免丢失输入。请重试保留草稿，或先复制输入'); }
  };
  const save = async (remove = false) => {
    if (guard.current || !draft.ready || stale) return;
    guard.current = true; setBusy(true); setError('');
    try {
      const context = await draft.prepare();
      const values = { title: form.title, date: form.date, startTime: form.startTime, endTime: form.endTime, location: form.location, type: form.type, remind: form.remind };
      if (recurring && form.base && form.scope === 'occurrence') await useScheduleStore.getState().updateOccurrence(form.base, form.occurrenceDate, { ...values, ...(remove ? { cancelled: true } : {}) }, context);
      else if (remove && form.base) await useScheduleStore.getState().removeItem(form.id, form.base, context);
      else if (form.base) await useScheduleStore.getState().updateItem(form.id, { ...values, repeat: form.repeat }, form.base, context);
      else await useScheduleStore.getState().addItem({ ...values, repeat: form.repeat }, form.id, context);
      toast.success(remove ? '日程已在本机删除' : '日程已保存到本机');
      useScheduleStore.getState().setSelectedDate(form.date);
      onClose();
    } catch (reason) { setError(scheduleFailureMessage(reason, remove)); setConfirmDelete(false); }
    finally { guard.current = false; setBusy(false); }
  };
  const setScope = (scope: ScheduleScope) => {
    if (scope === form.scope) return;
    // Switching to series uses the original date, never the clicked future occurrence.
    // Keep other visible user edits so the scope change cannot silently discard them.
    update({ scope, date: scope === 'series' ? form.base!.date : item!.date, repeat: form.base!.repeat });
  };
  return <>
    <Modal open onClose={close} title={item ? '编辑日程' : '新建日程'} className="max-h-[90dvh] overflow-y-auto" footer={<>
      {item && <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} disabled={busy || !draft.ready}>删除</Button>}
      <Button variant="ghost" size="sm" onClick={close} disabled={busy}>取消（保留草稿）</Button>
      <Button size="sm" onClick={() => void save()} disabled={busy || !draft.ready || stale || !form.title.trim() || !timeValid}>{busy ? '保存中…' : '保存'}</Button>
    </>}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-3)]">{draft.loading ? '正在读取草稿…' : draft.pending ? '正在保留草稿…' : draft.restored ? '已恢复本机编辑稿；保存前不会修改日程' : '取消会保留本机草稿，不修改日程'}</p>
        {visibleError && <div ref={errorRegion} tabIndex={-1} role="alert" className="text-sm text-[var(--danger)]">{visibleError}{draft.error && <Button variant="ghost" onClick={draft.retry}>重试保留草稿</Button>}</div>}
        {stale && <div role="alert" className="space-y-2 rounded-xl bg-[var(--surface-2)] p-3 text-sm"><p>原日程已在其他位置更新或删除。你的输入仍保留，未覆盖最新记录。</p>{current && <><p className="break-words">最新：{current.title} · {current.date} {current.startTime}–{current.endTime} · {current.location || '无地点'}</p><Button variant="soft" onClick={() => update({ base: structuredClone(current) })}>已核对，使用我的编辑稿覆盖</Button></>}</div>}
        <fieldset disabled={busy || !draft.ready} className="space-y-4">
          {recurring && <section className="space-y-2 rounded-xl bg-[var(--surface-2)] p-3"><p className="text-sm">{form.scope === 'series' ? `正在编辑从 ${form.base!.date} 开始的整个系列` : form.date === form.occurrenceDate ? `${form.occurrenceDate} 这一次安排` : `这次原定 ${form.occurrenceDate}，现安排在 ${form.date}`}</p><div role="group" aria-label="修改范围" className="flex flex-wrap gap-2"><Button variant={form.scope === 'occurrence' ? 'primary' : 'ghost'} onClick={() => setScope('occurrence')} aria-pressed={form.scope === 'occurrence'}>仅这一次</Button><Button variant={form.scope === 'series' ? 'primary' : 'ghost'} onClick={() => setScope('series')} aria-pressed={form.scope === 'series'}>整个系列</Button></div><p className="text-sm">{form.scope === 'occurrence' ? '其他日期的重复安排保持原样' : `将影响从 ${form.base!.date} 开始的系列；已经单独调整的日期保留各自内容`}</p></section>}
          <Input ref={first} id="schedule-title" label="标题 *" value={form.title} maxLength={100} onChange={event => update({ title: event.target.value })} />
          <Input id="schedule-date" label="日期" type="date" value={form.date} disabled={Boolean(recurring && form.scope === 'series' && form.base?.exceptions?.length)} onChange={event => update({ date: event.target.value })} />
          <div className="flex gap-3"><div className="min-w-0 flex-1"><Input id="schedule-start" label="开始" type="time" value={form.startTime} onChange={event => update({ startTime: event.target.value })} /></div><div className="min-w-0 flex-1"><Input id="schedule-end" label="结束" type="time" value={form.endTime} onChange={event => update({ endTime: event.target.value })} /></div></div>
          {!timeValid && <p role="alert" className="text-sm text-[var(--danger)]">结束时间必须晚于开始时间；跨午夜请分成两条日程</p>}
          <Input id="schedule-location" label="地点" value={form.location} maxLength={100} placeholder="会议室或线上链接（可选）" onChange={event => update({ location: event.target.value })} />
          <div><p className="mb-2 text-sm">类型</p><div role="group" aria-label="日程类型" className="flex flex-wrap gap-2">{([['class', '课程'], ['study', '学习'], ['work', '工作'], ['social', '社交'], ['other', '其他']] as const).map(([type, label]) => <Button key={type} size="sm" variant={form.type === type ? 'primary' : 'ghost'} aria-pressed={form.type === type} onClick={() => update({ type })}>{label}</Button>)}</div></div>
          {(!recurring || form.scope === 'series') && <div><p className="mb-2 text-sm">重复</p><div role="group" aria-label="重复规则" className="flex flex-wrap gap-2">{(['none', 'weekly'] as const).map(repeat => <Button key={repeat} size="sm" disabled={Boolean(form.base?.exceptions?.length)} variant={form.repeat === repeat ? 'primary' : 'ghost'} aria-pressed={form.repeat === repeat} onClick={() => update({ repeat })}>{repeat === 'none' ? '不重复' : '每周重复'}</Button>)}</div></div>}
          <p className="text-sm text-[var(--text-3)]">时间按中国标准时间（UTC+8）记录。当前未提供关闭应用后的提醒送达。</p>
        </fieldset>
      </div>
    </Modal>
    <Modal open={confirmDelete} onClose={() => { if (!busy) setConfirmDelete(false); }} title="确认删除" footer={<><Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>取消</Button><Button variant="danger" onClick={() => void save(true)} disabled={busy || stale}>删除</Button></>}><p className="break-words text-sm">{recurring && form.scope === 'occurrence' ? `仅删除 ${form.occurrenceDate} 这一次「${form.title}」，其他日期不变。` : `删除${recurring ? '整个系列' : '这条日程'}「${form.title}」？删除会同步，不能撤销为原记录。`}当前编辑稿会保留。</p></Modal>
  </>;
}
