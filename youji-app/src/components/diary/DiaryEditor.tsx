import { useEffect, useRef, useState } from 'react';
import { type DiaryRecord, generateLocalId } from '../../db';
import { useDiaryStore, DiaryDateConflict, sameDiarySnapshot } from '../../stores/diaryStore';
import { getToday } from '../../utils/date';
import { MOOD_LEVELS, getMoodMeta } from '../../utils/icons';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { toast } from '../../services/toastBus';
import { useDiaryEditorDraft } from './useDiaryEditorDraft';
import type { DiaryForm } from './diaryDraft';
import { diaryWriteFailure } from './diaryPresentation';

interface Props {
  item?: DiaryRecord;
  recoveryId?: string;
  onClose: (saved?: DiaryRecord) => void;
  onOpenRecord: (id: string) => void;
}
const fieldsOf = (record: DiaryRecord): DiaryForm => ({ id: record.id, date: record.date, content: record.content, mood: record.mood ?? null, moodScore: record.mood ? record.moodScore ?? null : null, base: record });
const moodLabel = (mood: string | null, score: number | null) => `${getMoodMeta(mood)?.label ?? mood ?? '未记录心情'}${score === null ? '' : ` · ${score}/10`}`;

function CompareRecord({ title, record }: { title: string; record: DiaryRecord }) {
  return <section className="space-y-1 rounded-lg border border-[var(--border)] p-3"><h4 className="text-xs font-bold">{title} · {record.date}</h4><p className="text-xs text-[var(--text-3)]">{moodLabel(record.mood, record.moodScore)}</p><p className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words text-sm">{record.content}</p></section>;
}

export function DiaryEditor({ item, recoveryId, onClose, onOpenRecord }: Props) {
  const draft = useDiaryEditorDraft(item?.id ?? recoveryId ?? 'new', item ? fieldsOf(item) : { id: generateLocalId(), date: getToday(), content: '', mood: null, moodScore: null, base: null });
  const form = draft.value;
  const items = useDiaryStore((state) => state.items);
  const current = items.find((row) => row.id === item?.id);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showCopy, setShowCopy] = useState(false);
  const [conflicting, setConflicting] = useState<DiaryRecord[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(Boolean(recoveryId));
  const guard = useRef(false);
  const [copyId] = useState(generateLocalId);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (draft.ready) input.current?.focus(); }, [draft.ready]);
  const stale = !deleted && Boolean(item && (!current || !form.base || !sameDiarySnapshot(current, form.base)));
  const duplicates = items.filter((row) => row.date === form.date && row.id !== (deleted ? copyId : item?.id ?? form.id));
  const dateConflicts = [...new Map([...duplicates, ...conflicting.filter((row) => row.date === form.date)].map((row) => [row.id, row])).values()];
  const usable = draft.ready && !(recoveryId && !draft.restored);
  const fullCopy = `${form.date}\n${moodLabel(form.mood, form.moodScore)}\n\n${form.content}`;
  const update = (patch: Partial<DiaryForm>) => {
    if (guard.current) return;
    draft.update({ ...form, ...patch }); setError(''); setCopied(false); setConfirmDelete(false); setConflicting([]);
  };
  const close = async (next?: () => void) => {
    if (guard.current) return;
    if (!draft.ready) { if (next) next(); else onClose(); return; }
    guard.current = true; setClosing(true);
    try { await draft.prepare(); if (next) next(); else onClose(); }
    catch { setError('草稿尚未保留，暂未关闭以免丢失输入。请重试保留草稿，或复制后再关闭'); }
    finally { guard.current = false; setClosing(false); }
  };
  const save = async () => {
    if (guard.current || !usable || stale) return;
    guard.current = true; setBusy(true); setError('');
    try {
      const context = await draft.prepare();
      const values = { date: form.date, content: form.content, mood: form.mood, moodScore: form.moodScore };
      const saved = item && form.base && !deleted
        ? await useDiaryStore.getState().updateItem(item.id, values, form.base, context)
        : await useDiaryStore.getState().addItem({ ...values, id: deleted ? copyId : form.id, source: 'manual', quickNoteIds: [] }, context);
      toast.success(`已保存 ${saved.date} 的日记到本机`); onClose(saved);
    } catch (reason) {
      if (reason instanceof DiaryDateConflict) setConflicting(reason.records);
      setError(diaryWriteFailure(reason, 'save'));
      void useDiaryStore.getState().loadFromDB().catch(() => undefined);
    } finally { guard.current = false; setBusy(false); }
  };
  const remove = async () => {
    if (guard.current || !item || !form.base || stale) return;
    guard.current = true; setBusy(true); setError('');
    try {
      draft.update(form);
      const context = await draft.prepare();
      await useDiaryStore.getState().removeItem(item.id, form.base, context);
      setDeleted(true); setConfirmDelete(false); toast.success('日记已删除，本机编辑稿保留');
    } catch (reason) { setError(diaryWriteFailure(reason, 'delete')); }
    finally { guard.current = false; setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(fullCopy); setCopied(true); setError('完整输入已复制，可在需要时粘贴备份'); }
    catch { setShowCopy(true); setError('请在下方全选、复制备份，再关闭页面'); }
  };

  return <Modal open onClose={() => void close()} title={deleted ? '已删除日记的编辑稿' : item ? `编辑 ${item.date} 的日记` : '写日记'} className="max-h-[90dvh] overflow-y-auto" footer={<>
    {item && !deleted && <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={busy || closing || !usable}>删除</Button>}
    <Button variant="ghost" onClick={() => void close()} disabled={busy || closing}>{closing ? '正在保留草稿…' : '取消（保留草稿）'}</Button>
    <Button onClick={() => void save()} disabled={busy || closing || !usable || stale || !form.content.trim() || dateConflicts.length > 0}>{busy ? '保存中…' : deleted ? '另存为新日记' : '保存'}</Button>
  </>}>
    <div className="space-y-4">
      <p aria-live="polite" className="text-xs text-[var(--text-3)]">{draft.loading ? '正在读取本机草稿…' : draft.pending ? '正在保留草稿…' : draft.error ? '本机草稿尚未保留，请先处理下方提示' : draft.restored ? '已恢复未提交的编辑稿；保存前不会修改日记' : '取消会保留本机草稿，不修改日记'}</p>
      {(draft.error || error) && <div role="alert" className="space-y-2 rounded-xl border border-[var(--danger)] p-3 text-sm"><p className="break-words text-[var(--danger)]">{error || draft.error}</p><div className="flex flex-wrap gap-2">{draft.error && <Button variant="soft" onClick={draft.retry} disabled={busy || closing}>{draft.ready ? '重试保留草稿' : '重试读取草稿'}</Button>}{usable && <Button variant="ghost" onClick={() => void copy()}>复制完整输入</Button>}{copied && <Button variant="ghost" onClick={() => onClose()}>已复制，关闭</Button>}</div></div>}
      {showCopy && <div className="space-y-2"><label htmlFor="diary-copy" className="text-sm">完整输入备份</label><textarea id="diary-copy" readOnly value={fullCopy} rows={5} onFocus={(event) => event.currentTarget.select()} className="w-full rounded-lg border border-[var(--border)] p-3" /><Button variant="ghost" onClick={() => onClose()}>已自行备份，关闭</Button></div>}
      {deleted && <p role="status" className="text-sm">原日记已不存在，不会恢复已删除的编号。{recoveryId && !draft.loading && !draft.restored ? '未找到这篇日记的本机草稿。' : '可核对原日期和内容后另存为新日记。'}</p>}
      {stale && <section role="alert" className="space-y-3 rounded-xl bg-[var(--surface-2)] p-3 text-sm"><p>原日记已有更新或已删除。你的编辑稿仍保留，请先核对。</p>{form.base && <CompareRecord title="开始编辑时" record={form.base} />}{current ? <><CompareRecord title="最新记录" record={current} /><div className="flex flex-wrap gap-2"><Button variant="soft" disabled={busy || closing} onClick={() => update({ base: current })}>已核对，保留我的编辑内容</Button><Button variant="ghost" disabled={busy || closing} onClick={() => update(fieldsOf(current))}>改用最新记录重新编辑</Button></div></> : <Button variant="soft" disabled={busy || closing} onClick={() => setDeleted(true)}>保留原稿，准备另存新日记</Button>}</section>}
      <fieldset disabled={busy || closing || !usable} className="min-w-0 space-y-4">
        <label className="block text-sm font-semibold">日记日期<input type="date" aria-label="日记日期" value={form.date} onChange={(event) => update({ date: event.target.value })} className="mt-2 h-11 w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3" /></label>
        <p className="text-xs text-[var(--text-3)]">记录的是 {form.date || '尚未选择日期'} 的经历；不会自动改成今天</p>
        <div><p id="diary-mood-label" className="mb-2 text-sm font-semibold">{form.date || '这一天'} 的心情（可不记录）</p><div className="flex flex-wrap gap-2" role="group" aria-labelledby="diary-mood-label"><button type="button" aria-pressed={form.mood === null} onClick={() => update({ mood: null, moodScore: null })} className={`min-h-11 rounded-full border px-3 py-2 text-xs ${form.mood === null ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]' : 'border-[var(--border)]'}`}>未记录心情</button>{MOOD_LEVELS.map((level) => { const meta = getMoodMeta(level)!; return <button key={level} type="button" aria-label={meta.label} aria-pressed={form.mood === level} onClick={() => update({ mood: level, moodScore: meta.score })} className={`min-h-11 rounded-full border px-3 py-2 text-xs ${form.mood === level ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]' : 'border-[var(--border)]'}`}><span aria-hidden>{meta.emoji} </span>{meta.label}</button>; })}</div>{form.mood && <p className="mt-2 text-xs text-[var(--text-3)]">已选：{moodLabel(form.mood, form.moodScore)}</p>}</div>
        <label className="block text-sm font-semibold" htmlFor="diary-content">日记内容</label><textarea ref={input} id="diary-content" value={form.content} onChange={(event) => update({ content: event.target.value })} maxLength={10000} rows={7} placeholder="写下这一天发生的事，或想留住的一句话…" className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm leading-relaxed text-[var(--text-1)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20" /><p className="text-right text-xs text-[var(--text-3)]">{form.content.length}/10000</p>
      </fieldset>
      {dateConflicts.length > 0 && <section aria-label="同日日记对照" className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3"><p className="text-sm font-semibold">{form.date} 已有{dateConflicts.length > 1 ? ` ${dateConflicts.length} 篇` : ''}日记，本次不会覆盖</p><p className="text-xs text-[var(--text-3)]">先查看已有原文，再手动核对或补充。当前输入会保留为本机草稿；不要为绕过冲突填写不真实的日期。</p>{dateConflicts.map((row) => <div key={row.id} className="space-y-2"><CompareRecord title="已有日记" record={row} /><Button variant="soft" disabled={busy || closing} onClick={() => void close(() => onOpenRecord(row.id))}>保留当前稿，打开这篇日记</Button></div>)}</section>}
      {confirmDelete && <section className="space-y-3 rounded-xl border border-[var(--danger)] p-3" aria-label="确认删除日记"><p className="text-sm">删除 {item?.date} 的这篇日记？删除会同步，不能撤销为原记录。当前编辑稿会保留。</p><div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>保留日记</Button><Button variant="danger" onClick={() => void remove()} disabled={busy || stale}>确认删除</Button></div></section>}
    </div>
  </Modal>;
}
