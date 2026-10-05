import { useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { preferenceSaveError } from '../../lib/preferenceErrors';

/** Native time segments edit synchronously; persistence never rewinds a keystroke. */
export function TimeSettingInput({ id, label, value, onSave }: { id: string; label: string; value: string; onSave: (value: string, expected: string) => Promise<void> }) {
  const [draft, setDraft] = useState<{ value: string; baseline: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const guard = useRef(false);
  const visible = draft?.value ?? value;
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(visible);
  const changedElsewhere = Boolean(draft && draft.baseline !== value);
  const save = async () => {
    if (!draft || !valid || guard.current) return;
    guard.current = true; setSaving(true); setError(''); setFeedback('');
    try { await onSave(draft.value, draft.baseline); setDraft(null); setFeedback('时间已保存在本机，账号同步状态见上方'); }
    catch (cause) { setError(preferenceSaveError(cause)); }
    finally { guard.current = false; setSaving(false); }
  };
  return <div className="min-w-0 flex-1" data-component="time-preference">
    <label htmlFor={id} className="mb-1 block text-xs font-medium text-[var(--text-2)]">{label}</label>
    <input id={id} type="time" value={visible} disabled={saving} onChange={(event) => { const next = event.target.value; setDraft((current) => ({ value: next, baseline: current?.baseline ?? value })); setError(''); setFeedback(''); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }} aria-invalid={!valid} aria-describedby={`${id}-feedback`} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-1)]" />
    {draft && <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="ghost" disabled={!valid || saving} onClick={() => void save()}>{saving ? '保存中…' : `保存${label}`}</Button><Button size="sm" variant="ghost" disabled={saving} onClick={() => { setDraft(null); setError(''); }}>{changedElsewhere ? '采用最新时间' : '取消修改'}</Button></div>}
    <p id={`${id}-feedback`} role={error ? 'alert' : 'status'} className={`mt-1 text-xs leading-5 ${error ? 'text-[var(--danger)]' : 'text-[var(--text-3)]'}`}>{error || (changedElsewhere ? `其他位置已更新为 ${value}，你的输入仍保留，请核对` : draft ? valid ? '修改尚未保存' : '请补全有效时间' : feedback)}</p>
  </div>;
}
