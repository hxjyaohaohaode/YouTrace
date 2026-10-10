import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { parseYuanToFen, sameExpenseSnapshot, useExpenseStore, type ExpenseItem } from '../../stores/expenseStore';
import { generateLocalId } from '../../db';
import { expenseCategoryIcons, EXPENSE_CATEGORY_KEYS } from '../../utils/icons';
import { toast } from '../../services/toastBus';
import { getToday } from '../../utils/date';
import { useExpenseEditorDraft } from './useExpenseEditorDraft';
import { expenseWriteFailure } from './expensePresentation';

interface AddExpenseModalProps { open: boolean; onClose: () => void; item?: ExpenseItem; draftId?: string; fallbackFocus?: () => HTMLElement | null }
interface ExpenseForm { id: string; name: string; amount: string; category: string; date: string; isIncome: boolean; base: ExpenseItem | null }

function ExpenseEditor({ onClose, item, draftId, fallbackFocus }: Omit<AddExpenseModalProps, 'open'>) {
  const draft = useExpenseEditorDraft<ExpenseForm>(item?.id ?? draftId ?? 'new', { id: item?.id ?? generateLocalId(), name: item?.name ?? '', amount: item ? (item.amount / 100).toFixed(2) : '', category: item?.category ?? 'food', date: item?.date ?? getToday(), isIncome: Boolean(item?.isIncome), base: item ?? null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(Boolean(draftId));
  const copyId = useRef(generateLocalId());
  const guard = useRef(false);
  const firstInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (draft.ready) firstInput.current?.focus(); }, [draft.ready, deleted]);
  const current = useExpenseStore((state) => state.items.find((row) => row.id === item?.id));
  const form = draft.value;
  const stale = !deleted && Boolean(item && (!current || !form.base || !sameExpenseSnapshot(current, form.base)));
  const amount = parseYuanToFen(form.amount);
  const visibleError = error || (draft.error ? expenseWriteFailure(draft.error, 'draft') : '');
  const update = (patch: Partial<ExpenseForm>) => { if (guard.current) return; draft.update({ ...form, ...patch }); setError(''); setConfirmDelete(false); };
  const close = async () => {
    if (guard.current) return;
    if (!draft.ready) { onClose(); return; }
    try { await draft.prepare(); onClose(); }
    catch { setError('草稿尚未保留，暂未关闭以免丢失输入。请重试保留草稿，或先复制输入'); }
  };
  const save = async () => {
    if (guard.current || !draft.ready || amount === null) return;
    guard.current = true; setSaving(true); setError('');
    try {
      const context = await draft.prepare();
      const values = { name: form.name.trim() || expenseCategoryIcons[form.category]?.label || '其他', amount, category: form.category, date: form.date, isIncome: form.isIncome };
      if (item && form.base && !deleted) await useExpenseStore.getState().updateItem(item.id, values, form.base, context);
      else await useExpenseStore.getState().addItem(values, deleted ? copyId.current : form.id, context);
      toast.success(`已${deleted ? '另存' : '存'}本机：${form.isIncome ? '收入' : '支出'} ¥${(amount / 100).toFixed(2)} · ${values.name.slice(0, 24)}`); onClose();
    } catch (reason) { setError(expenseWriteFailure(reason, 'save')); }
    finally { guard.current = false; setSaving(false); }
  };
  const remove = async () => {
    if (guard.current || !item || !form.base) return;
    guard.current = true; setSaving(true); setError('');
    try {
      draft.update(form);
      const context = await draft.prepare();
      await useExpenseStore.getState().removeItem(item.id, form.base, context);
      setDeleted(true); setConfirmDelete(false); toast.success('记录已删除，编辑稿保留');
    } catch (reason) { setError(expenseWriteFailure(reason, 'delete')); }
    finally { guard.current = false; setSaving(false); }
  };
  return <Modal open onClose={close} fallbackFocus={fallbackFocus} title={deleted ? '已删除记录的编辑稿' : item ? '编辑记账' : '记一笔'} className="max-h-[90dvh] overflow-y-auto" footer={<>
    {item && !deleted && <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={saving || !draft.ready}>删除</Button>}
    <Button variant="ghost" onClick={close} disabled={saving}>取消（保留草稿）</Button>
    <Button onClick={() => void save()} disabled={saving || !draft.ready || stale || amount === null || Boolean(draftId && !draft.restored)}>{saving ? '保存中…' : deleted ? '另存为新记录' : '保存'}</Button>
  </>}>
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-3)]">{draft.loading ? '正在读取草稿…' : draft.pending ? '正在保留草稿…' : draft.restored ? '已恢复未提交编辑稿；保存前不会修改记账' : '取消会保留本机草稿，不修改记账'}</p>
      {deleted && <p role="status" className="text-sm">原记录已不存在，不会恢复已删除的编号。{draftId && !draft.loading && !draft.restored ? '未找到这条记录的本机草稿。' : '可检查编辑稿后另存为一笔新记录。'}</p>}
      {visibleError && <div role="alert" className="text-sm text-[var(--danger)]">{visibleError}{draft.error && <Button variant="ghost" onClick={draft.retry}>重试保留草稿</Button>}</div>}
      {stale && <div role="alert" className="space-y-2 rounded-lg bg-[var(--surface-2)] p-3 text-sm">记录已有更新或被删除，你的编辑稿仍保留{current && <><p className="break-words">最新记录：{current.name} · {current.date} · {current.isIncome ? '收入' : '支出'} ¥{(current.amount / 100).toFixed(2)} · {expenseCategoryIcons[current.category]?.label || current.category}</p><Button variant="soft" onClick={() => update({ base: current })}>已核对，继续使用我的编辑稿</Button></>}</div>}
      <fieldset disabled={saving || !draft.ready || Boolean(draftId && !draft.restored)} className="space-y-4">
        <Input id="expense-amount" ref={firstInput} label="金额（人民币元）*" inputMode="decimal" value={form.amount} onChange={(event) => update({ amount: event.target.value })} placeholder="0.00" error={form.amount && amount === null ? '请输入大于 0 的金额，最多两位小数，不超过一亿元' : undefined} />
        <div className="flex flex-wrap gap-3" role="group" aria-label="收支类型"><Button variant={form.isIncome ? 'soft' : 'primary'} aria-pressed={!form.isIncome} onClick={() => update({ isIncome: false })}>支出</Button><Button variant={form.isIncome ? 'primary' : 'soft'} aria-pressed={form.isIncome} onClick={() => update({ isIncome: true })}>收入</Button></div>
        <label className="block text-sm font-semibold">分类<select aria-label="记账分类" value={form.category} onChange={(event) => update({ category: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3">{EXPENSE_CATEGORY_KEYS.map((key) => <option key={key} value={key}>{expenseCategoryIcons[key].label}</option>)}</select></label>
        <Input id="expense-name" label="名称 / 备注" value={form.name} onChange={(event) => update({ name: event.target.value })} maxLength={100} placeholder="如：午饭、交通、工资" />
        <Input id="expense-date" label="记账日期 *" type="date" value={form.date} onChange={(event) => update({ date: event.target.value })} />
        <p className="text-xs text-[var(--text-3)]">{form.date || '请选择日期'} · {form.isIncome ? '收入' : '支出'} {amount === null ? '金额待确认' : `CNY ¥${(amount / 100).toFixed(2)}`}</p>
      </fieldset>
      {confirmDelete && <section className="space-y-3 rounded-xl border border-[var(--danger)] p-3" aria-label="确认删除记账"><p className="break-words text-sm">删除「{item?.name}」？删除会同步，不能撤销为原记录。当前编辑稿会保留，可另存为新记录。</p><div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={saving}>保留记录</Button><Button variant="danger" onClick={() => void remove()} disabled={saving || stale}>确认删除</Button></div></section>}
    </div>
  </Modal>;
}

export function AddExpenseModal({ open, ...props }: AddExpenseModalProps) { return open ? <ExpenseEditor {...props} /> : null; }
