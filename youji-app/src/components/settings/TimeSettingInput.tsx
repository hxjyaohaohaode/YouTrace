import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { preferenceSaveError } from '../../lib/preferenceErrors';
import { needsTimePreferenceVerification, reconcileTimePreferenceRead, type TimePreferenceDraft } from '../../lib/timePreferenceOutcome';

/** Native time segments edit synchronously; persistence never rewinds a keystroke. */
export function TimeSettingInput({ id, label, value, onSave, onVerify }: { id: string; label: string; value: string; onSave: (value: string, expected: string) => Promise<void>; onVerify: () => Promise<string> }) {
  const [draft, setDraft] = useState<TimePreferenceDraft | null>(null);
  const [saving, setSaving] = useState(false), [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(''), [feedback, setFeedback] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [verified, setVerified] = useState<string | null>(null), [lastValue, setLastValue] = useState(value);
  // A later store publication supersedes only the read snapshot, never the draft.
  if (lastValue !== value) { setLastValue(value); setVerified(null); setFeedback(''); }
  const guard = useRef(false), alive = useRef(true), revision = useRef(0);
  const draftRef = useRef<TimePreferenceDraft | null>(null);
  const publication = useRef({ value, revision: 0 });
  useLayoutEffect(() => { if (publication.current.value !== value) publication.current = { value, revision: publication.current.revision + 1 }; }, [value]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const currentValue = verified ?? value, visible = draft?.value ?? currentValue;
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(visible);
  const changedElsewhere = Boolean(draft && draft.baseline !== currentValue);
  const save = async () => {
    if (!draft || !valid || guard.current || needsVerification) return;
    guard.current = true; setSaving(true); setError(''); setFeedback('');
    try {
      await onSave(draft.value, draft.baseline);
      if (!alive.current) return;
      draftRef.current = null; setDraft(null); setVerified(null); setFeedback('时间已保存在本机，账号同步状态见上方');
    } catch (cause) {
      if (!alive.current) return;
      const unknown = needsTimePreferenceVerification(cause);
      setNeedsVerification(unknown);
      setError(unknown ? '保存结果暂时无法核对，输入仍保留。请先重新读取当前时间，不要重复保存。' : preferenceSaveError(cause));
    } finally { guard.current = false; if (alive.current) setSaving(false); }
  };
  const verify = async () => {
    if (guard.current) return;
    const started = draftRef.current, startedPublication = publication.current.revision;
    guard.current = true; setVerifying(true);
    try {
      const stored = await onVerify();
      if (!alive.current) return;
      if (publication.current.revision !== startedPublication) {
        setNeedsVerification(true); setError('核对期间当前时间又有更新，输入仍保留。请重新读取，不要重复保存。'); return;
      }
      const result = reconcileTimePreferenceRead(started, draftRef.current, stored);
      draftRef.current = result.draft; setDraft(result.draft); setVerified(stored);
      setNeedsVerification(result.needsVerification); setError('');
      setFeedback(`已核对本机当前时间：${stored}。${result.needsVerification ? '核对期间你又编辑了输入，请再次核对后保存。' : result.draft ? '你的不同输入仍保留，尚未保存。' : '这只说明当前本机值；请用上方“重新核对账号偏好”继续确认同步。'}`);
    } catch { if (alive.current) { setNeedsVerification(true); setError('仍无法读取当前本机时间，输入已保留。请稍后重新核对，不要重复保存。'); } }
    finally { guard.current = false; if (alive.current) setVerifying(false); }
  };
  return <div className="min-w-0 flex-1" data-component="time-preference">
    <label htmlFor={id} className="mb-1 block text-xs font-medium text-[var(--text-2)]">{label}</label>
    <input id={id} type="time" value={visible} disabled={saving} onChange={(event) => { const next = { value: event.target.value, baseline: draftRef.current?.baseline ?? currentValue, revision: ++revision.current }; draftRef.current = next; setDraft(next); setError(''); setFeedback(''); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }} aria-invalid={!valid} aria-describedby={`${id}-feedback`} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-1)]" />
    {(draft || needsVerification) && <div className="mt-2 flex flex-wrap gap-2">{draft && <Button size="sm" variant="ghost" disabled={!valid || saving || verifying || needsVerification} onClick={() => void save()}>{saving ? '保存中…' : `保存${label}`}</Button>}{needsVerification && <Button size="sm" variant="ghost" disabled={saving || verifying} onClick={() => void verify()}>{verifying ? '读取中…' : '重新读取当前时间'}</Button>}{draft && <Button size="sm" variant="ghost" disabled={saving || verifying || needsVerification} onClick={() => { draftRef.current = null; setDraft(null); setError(''); setFeedback(''); }}>{changedElsewhere ? '采用最新时间' : '取消修改'}</Button>}</div>}
    <p id={`${id}-feedback`} role={error ? 'alert' : 'status'} className={`mt-1 text-xs leading-5 ${error ? 'text-[var(--danger)]' : 'text-[var(--text-3)]'}`}>{error || feedback || (needsVerification ? '保存结果待核对，请重新读取当前时间。' : changedElsewhere ? `其他位置已更新为 ${currentValue}，你的输入仍保留，请核对` : draft ? valid ? '修改尚未保存' : '请补全有效时间' : '')}</p>
  </div>;
}
