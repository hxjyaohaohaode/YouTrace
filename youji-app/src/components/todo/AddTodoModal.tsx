import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useTodoStore, sameTodoSnapshot, type TodoItem, type Priority } from '../../stores/todoStore';
import { generateLocalId } from '../../db';
import { toast } from '../../services/toastBus';
import { addDays, getToday } from '../../utils/date';
import { useTodoEditorDraft } from './useTodoEditorDraft';

interface AddTodoModalProps { open: boolean; onClose: () => void; item?: TodoItem; draftId?: string }
interface TodoForm { id: string; text: string; priority: Priority; dueDate: string; done: boolean; base: TodoItem | null }

function TodoEditor({ onClose, item, draftId }: Omit<AddTodoModalProps, 'open'>) {
  const draft = useTodoEditorDraft<TodoForm>(item?.id ?? draftId ?? 'new', { id: item?.id ?? generateLocalId(), text: item?.text ?? '', priority: item?.priority ?? 'medium', dueDate: item ? item.dueDate ?? '' : getToday(), done: item?.done ?? false, base: item ?? null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(Boolean(draftId));
  const copyId = useRef(generateLocalId());
  const guard = useRef(false);
  const firstInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (draft.ready) firstInput.current?.focus(); }, [draft.ready, deleted]);
  const current = useTodoStore((state) => state.items.find((row) => row.id === item?.id));
  const form = draft.value;
  const stale = !deleted && Boolean(item && (!current || !form.base || !sameTodoSnapshot(current, form.base)));
  const update = (patch: Partial<TodoForm>) => { if (guard.current) return; draft.update({ ...form, ...patch }); setError(''); setConfirmDelete(false); };
  const close = async () => {
    if (guard.current) return;
    if (!draft.ready) { onClose(); return; }
    try { await draft.prepare(); onClose(); }
    catch { setError('草稿尚未保留，暂未关闭以免丢失输入。请重试保留草稿，或先复制输入'); }
  };
  const save = async () => {
    if (guard.current || !draft.ready) return;
    guard.current = true; setSaving(true); setError('');
    try {
      const context = await draft.prepare();
      const values = { text: form.text, priority: form.priority, dueDate: form.dueDate || undefined, done: form.done };
      if (item && form.base && !deleted) await useTodoStore.getState().updateItem(item.id, values, form.base, context);
      else await useTodoStore.getState().addItem(values, deleted ? copyId.current : form.id, context);
      toast.success('待办已保存到本机');
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '未保存，输入已保留，请重试'); }
    finally { guard.current = false; setSaving(false); }
  };
  const remove = async () => {
    if (guard.current || !item || !form.base) return;
    guard.current = true; setSaving(true); setError('');
    try {
      // Preserve this visible editable draft before the irreversible tombstone operation.
      draft.update(form);
      const context = await draft.prepare();
      await useTodoStore.getState().removeItem(item.id, form.base, context);
      setDeleted(true); setConfirmDelete(false); toast.success('待办已删除，编辑稿保留');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '删除未完成，输入已保留'); }
    finally { guard.current = false; setSaving(false); }
  };
  return <Modal open onClose={close} title={deleted ? '已删除待办的编辑稿' : item ? '编辑待办' : '新建待办'} className="max-h-[90dvh] overflow-y-auto" footer={<>
    {item && !deleted && <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={saving || !draft.ready}>删除</Button>}
    <Button variant="ghost" onClick={close} disabled={saving}>取消（保留草稿）</Button>
    <Button onClick={() => void save()} disabled={saving || !draft.ready || stale || !form.text.trim() || Boolean(draftId && !draft.restored)}>{saving ? '保存中…' : deleted ? '另存为新待办' : '保存'}</Button>
  </>}>
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-3)]">{draft.loading ? '正在读取草稿…' : draft.pending ? '正在保留草稿…' : draft.restored ? '已恢复未提交的编辑稿；保存前不会修改待办' : '取消会保留本机草稿，不修改待办'}</p>
      {deleted && <p role="status" className="text-sm">原待办已不存在，不会恢复已删除的编号。{draftId && !draft.loading && !draft.restored ? '未找到这条记录的本机草稿。' : '可检查编辑稿后另存为新待办。'}</p>}
      {(draft.error || error) && <div role="alert" className="text-sm text-[var(--danger)]">{error || draft.error}{draft.error && <Button variant="ghost" onClick={draft.retry}>重试保留草稿</Button>}</div>}
      {stale && <div role="alert" className="space-y-2 rounded-lg bg-[var(--surface-2)] p-3 text-sm">记录已有更新或被删除，你的编辑稿仍保留{current && <><p className="break-words">最新内容：{current.text} · {current.dueDate || '无日期'} · {current.priority === 'high' ? '高' : current.priority === 'low' ? '低' : '中'} · {current.done ? '已完成' : '未完成'}</p><Button variant="soft" onClick={() => update({ base: current })}>已核对，继续使用我的编辑稿</Button></>}</div>}
      <fieldset disabled={saving || !draft.ready || Boolean(draftId && !draft.restored)} className="space-y-4">
        <Input id="todo-text" ref={firstInput} label="内容 *" value={form.text} onChange={(event) => update({ text: event.target.value })} maxLength={200} placeholder="要做什么？" />
        <label className="block text-sm font-semibold">优先级<select value={form.priority} onChange={(event) => update({ priority: event.target.value as Priority })} className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>
        <Input id="todo-date" label="截止日期（可留空）" type="date" value={form.dueDate} onChange={(event) => update({ dueDate: event.target.value })} />
        <div className="flex flex-wrap gap-2">{[['今天', getToday()], ['明天', addDays(getToday(), 1)], ['无日期', '']].map(([label, date]) => <Button key={label} variant="soft" size="sm" onClick={() => update({ dueDate: date })}>{label}</Button>)}</div>
        <p className="text-xs text-[var(--text-3)]">实际截止日期：{form.dueDate || '无截止日期'}</p>
        {item && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={form.done} onChange={(event) => update({ done: event.target.checked })} />已完成</label>}
      </fieldset>
      {confirmDelete && <section className="space-y-3 rounded-xl border border-[var(--danger)] p-3" aria-label="确认删除待办"><p className="break-words text-sm">删除「{item?.text}」？删除会同步，不能撤销为原记录。当前编辑稿会保留。</p><div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={saving}>保留待办</Button><Button variant="danger" onClick={() => void remove()} disabled={saving || stale}>确认删除</Button></div></section>}
    </div>
  </Modal>;
}

export function AddTodoModal({ open, ...props }: AddTodoModalProps) {
  return open ? <TodoEditor {...props} /> : null;
}
