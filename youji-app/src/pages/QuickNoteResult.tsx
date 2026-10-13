import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { liveQuery } from 'dexie';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Plus, Trash2, Check, Copy, ChevronRight } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useCaptureContinuationHandoff } from '../components/capture/useCaptureContinuationHandoff';
import { CaptureDraftBrowser } from '../components/capture/CaptureDraftBrowser';
import { Checkbox } from '../components/ui/Checkbox';
import { getMoodScore, type MoodLevel } from '../services/parser';
import { applyCaptureContinuation, createEmptyCaptureInput, applyCaptureDraft, CaptureChangedError, captureFingerprint, captureSessionKey, loadCaptureDraft, loadCaptureReceipt, saveCaptureDraft, upgradeCaptureReview, type CaptureDraft, type CaptureReceipt, type CaptureEntityRef } from '../services/quickNoteIntegration';
import { MOOD_LEVELS, getMoodMeta, EXPENSE_CATEGORY_KEYS, expenseCategoryIcons, normalizeExpenseCategory } from '../utils/icons';
import { db, generateLocalId } from '../db';
import { useHabitStore } from '../stores/habitStore';
import { useAuthStore } from '../stores/authStore';
import { retainPendingEditor, readPendingEditor, releasePendingEditor } from '../services/pendingEditorMemory';
import { SESSION_REVISION_KEY, getSessionGeneration } from '../services/apiClient';
import { assertLocalActorNow } from '../services/localActor';
import { readCaptureInputMemory, captureInputMemoryRevision } from '../services/captureInputMemory';
import { readCaptureInputActor, assertCaptureInputActor, type CaptureInputActor } from '../services/captureInputProvenance';
import { currentCaptureRecord, currentReceiptSyncStatus, failedReceiptRead, type ReceiptViewState, type CurrentCaptureRecord } from '../services/captureReceiptView';
import { recordDiagnostic } from '../services/diagnostics';
import { captureSaveFailure } from '../services/capturePresentation';
import { readCaptureContinuationOperation, readCaptureContinuationState, assertCaptureContinuationContext, isCaptureContinuationCurrent, captureContinuationText, stageCaptureContinuationEdit, saveCaptureContinuation, cancelCaptureContinuation, type CaptureContinuation, type CaptureContinuationEdit } from '../services/captureDraftCatalog';


const field = 'min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-1)] focus:outline-2 focus:outline-[var(--primary)]';
function Frame({ children, title, back, footer, isolated = false }: { children: ReactNode; title: string; back: () => void; footer?: ReactNode; isolated?: boolean }) {
  const reduced = useReducedMotion(), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (isolated) heading.current?.focus({ preventScroll: true }); }, [isolated, title]);
  const titleId = isolated ? 'continuation-review-title' : 'review-title';
  return <motion.section initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.16 }} className="capture-workspace capture-review fixed inset-0 flex flex-col bg-[var(--bg)]" style={{ zIndex: 'var(--z-page-overlay)' }} aria-labelledby={titleId} data-component="capture-review">
    <header className="capture-header mx-auto flex w-full items-center gap-4"><button type="button" aria-label="返回" onClick={back} className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-[var(--border)]"><ArrowLeft size={20} aria-hidden /></button><div className={isolated ? 'min-w-0 flex-1' : undefined}><p className="record-eyebrow">CAPTURE / 核对与保存</p><h1 id={titleId} ref={heading} tabIndex={isolated ? -1 : undefined} className={isolated ? '[overflow-wrap:anywhere]' : undefined}>{title}</h1></div></header>
    <div className="min-h-0 flex-1 overflow-y-auto"><div className="review-body mx-auto space-y-5">{children}</div></div>
    {footer && <footer className="border-t border-[var(--border)] bg-[var(--surface)] p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}><div className="capture-footer mx-auto">{footer}</div></footer>}
  </motion.section>;
}
export default function QuickNoteResult() {
  const location = useLocation(), navigate = useNavigate();
  const params = new URLSearchParams(location.search), receiptId = params.get('receipt');
  const requestedId = params.get('draft') ?? (location.state as { draftId?: string } | null)?.draftId ?? sessionStorage.getItem(captureSessionKey());
  const currentUser = useAuthStore(state => state.user);
  const target = db, generation = getSessionGeneration(), revision = localStorage.getItem(SESSION_REVISION_KEY);
  // Bind at render, before effects run: old data must never inherit a new ID or actor.
  const requestKey = JSON.stringify([receiptId, requestedId, currentUser?.id, target.ownerId, generation, revision]);
  const [loaded, setLoaded] = useState<{ key: string; attempt: number; context: CaptureInputActor; draft: CaptureDraft | null; receipt: CaptureReceipt | null } | null>(null);
  const lastPublished = useRef<typeof loaded>(null);
  const [failure, setFailure] = useState<{ key: string; target: typeof db; message: string; identity?: boolean } | null>(null), [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    const read = async () => {
      const previous = lastPublished.current;
      if (previous?.draft && previous.attempt === attempt) {
        try { assertLocalActorNow(previous.context); }
        catch { if (active) setFailure({ key: requestKey, target, identity: true, message: '账号或本机资料已变化，原编辑保留但不再展示。请明确重试读取后重新核对。' }); return; }
      }
      const context = await readCaptureInputActor();
      const id = receiptId ?? requestedId;
      const receipt = id ? await loadCaptureReceipt(id) : null;
      const draft = !receipt && !receiptId ? await loadCaptureDraft(requestedId) : null;
      await assertCaptureInputActor(context);
      if (active) { const value = { key: requestKey, attempt, context, draft, receipt }; lastPublished.current = value; setLoaded(value); setFailure(null); }
    };
    void read().catch(() => { if (active) { setFailure({ key: requestKey, target, message: '暂时读不到本机确认稿。原文不会因此删除，请检查存储后重试。' }); recordDiagnostic('runtime-error', 'capture-review'); } });
    return () => { active = false; };
  }, [receiptId, requestedId, requestKey, target, attempt]);
  const error = failure?.key === requestKey && failure.target === target ? failure.message : '';
  let current = loaded?.key === requestKey && loaded.context.database === target;
  if (current) { try { assertLocalActorNow(loaded!.context); } catch { current = false; } }
  if (error || !current) return <Frame title={error && failure?.identity ? '需要重新核对账号' : '整理确认稿'} back={() => navigate('/quick-note')}>{error ? <div role="alert" className="space-y-4"><p>{error}</p><Button onClick={() => retry(value => value + 1)}>重试读取</Button><Button variant="ghost" onClick={() => navigate('/quick-note')}>返回原文</Button></div> : <p role="status">正在恢复本机确认稿…</p>}</Frame>;
  if (loaded!.receipt) return <SavedCapture receipt={loaded!.receipt} id={receiptId ?? requestedId!} context={loaded!.context} />;
  if (!loaded!.draft) return <Frame title="整理确认稿" back={() => navigate('/')}><p>这份确认稿在当前账号的本机存储中没有找到。可能已在其他设备处理，或本机资料已清理。</p><Button onClick={() => navigate('/quick-note')}>查看未保存原文</Button></Frame>;
  return <CaptureReview key={loaded!.draft.id} original={loaded!.draft} />;
}
function Section({ title, children, add }: { title: string; children: ReactNode; add?: () => void }) {
  return <section aria-label={title} className="review-section space-y-4"><header className="flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">{title}</h2>{add && <Button variant="ghost" onClick={add} aria-label={`添加${title}`}><Plus size={16} aria-hidden />添加</Button>}</header>{children}</section>;
}
function Remove({ label, onClick }: { label: string; onClick: () => void }) { return <Button variant="ghost" aria-label={`移除${label}`} onClick={onClick}><Trash2 size={17} aria-hidden /></Button>; }
/** Internal isolated policy only; the production browser does not expose a
 * continuation entry until the separate business-commit contract is complete. */
export function CaptureReview({ original, continuation }: { original: CaptureDraft; continuation?: { grant: CaptureContinuation; onClose: () => void } }) {
  const navigate = useNavigate(), currentUser = useAuthStore(state => state.user), accountName = currentUser?.nickname, knownHabits = useHabitStore(state => state.items);
  const scope = { database: db, owner: db.ownerId, session: original.sessionRevision ?? localStorage.getItem(SESSION_REVISION_KEY), epoch: original.dataEpoch ?? 'initial', key: `capture-review:${original.id}` };
  const [entry] = useState(() => {
    if (!continuation) return null;
    try { return { ...readCaptureContinuationState(continuation.grant), invalid: false }; }
    catch { return { draft: original, pending: false, invalid: true }; }
  });
  const [initialGrant] = useState(continuation?.grant);
  const [context, setContext] = useState<'checking' | 'ready' | 'locked'>(continuation ? 'checking' : 'ready');
  useEffect(() => {
    if (!continuation) return;
    let active = true;
    const subscription = liveQuery(() => assertCaptureContinuationContext(continuation.grant)).subscribe({
      next: () => { if (active) setContext(isCaptureContinuationCurrent(continuation.grant) ? 'ready' : 'locked'); },
      error: () => { if (active) setContext('locked'); },
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [continuation, currentUser]);
  const [recovered] = useState(() => continuation ? null : readPendingEditor<CaptureDraft>(scope));
  const initial = entry?.draft ?? recovered ?? upgradeCaptureReview(original);
  const [draft, setDraft] = useState(initial);
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(initial.expenses.map(row => [row.id, row.amountText ?? String(row.amount / 100)])));
  const [status, setStatus] = useState<'saved' | 'pending' | 'failed'>(recovered || entry?.pending ? 'failed' : 'saved'), [error, setError] = useState(recovered || entry?.pending ? '已找回离开前尚未落盘的确认稿，请重试保留修改' : ''), [notice, setNotice] = useState(''), [saving, setSaving] = useState(false);
  const current = useRef(initial), persistedId = useRef(original.id), expected = useRef(captureFingerprint(original)), queue = useRef(Promise.resolve()), version = useRef(0), busy = useRef(false), alive = useRef(true);
  const preservation = useRef(status), actionSequence = useRef(0), grant = continuation?.grant;
  const [savedResult, setSavedResult] = useState<{ receipt: CaptureReceipt; context: CaptureInputActor } | null>(null);
  const { child: continuationChild, background: parentBackgroundRef, locked: parentLocked, begin: beginContinuation, close: closeContinuation, isSuspended: isParentSuspended } = useCaptureContinuationHandoff(!continuation);
  const setPreservation = (value: typeof status) => { preservation.current = value; setStatus(value); };
  useEffect(() => { alive.current = true; const actions = actionSequence; return () => { alive.current = false; actions.current++; /* the private pending copy may be retried by the same grant after remount */ }; }, [grant]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (status !== 'saved') { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [status]);
  const persist = (next: CaptureDraft) => {
    const revision = ++version.current;
    let token: number | undefined, ticket: CaptureContinuationEdit | undefined;
    try {
      if (continuation) ticket = stageCaptureContinuationEdit(continuation.grant, next);
      else token = retainPendingEditor(scope, next);
    } catch (cause) {
      setPreservation('failed'); setError('修改仍在本次打开的应用中，尚未写入原稿。请保留核对文本，不要关闭应用。');
      return Promise.reject(cause);
    }
    setPreservation('pending');
    const work = queue.current.catch(() => undefined).then(async () => {
      if (continuation) {
        await saveCaptureContinuation(continuation.grant, next, ticket);
        if (alive.current && revision === version.current) { setPreservation('saved'); setError(''); }
        return;
      }
      const snapshot = { ...next, id: persistedId.current };
      const id = await saveCaptureDraft(snapshot, true, expected.current);
      releasePendingEditor(scope, token!);
      expected.current = captureFingerprint(snapshot); persistedId.current = id;
      sessionStorage.setItem(captureSessionKey(), id);
      if (id !== snapshot.id && alive.current) setNotice('另一页已经修改或保存原稿。这份修改已独立保留，请重新核对后确认，不会覆盖另一页。');
      if (alive.current && revision === version.current) { setPreservation('saved'); setError(''); }
    });
    queue.current = work;
    void work.catch(() => { if (alive.current && revision === version.current) { setPreservation('failed'); setError('修改还没写入本机，仍保留在此页。请重试或先复制，不要直接关闭。'); recordDiagnostic('runtime-error', 'capture-review'); } });
    return work;
  };
  const canEdit = () => continuation ? !busy.current && alive.current && isCaptureContinuationCurrent(continuation.grant) && !readCaptureContinuationOperation(continuation.grant).operationAttempted : !isParentSuspended();
  const change = (patch: Partial<CaptureDraft>) => { if (!canEdit()) return; const next = { ...current.current, ...patch }; current.current = next; setDraft(next); void persist(next).catch(() => undefined); };
  const copy = async () => { const content = continuation ? captureContinuationText(continuation.grant) : JSON.stringify(current.current, null, 2); try { await navigator.clipboard.writeText(content); setNotice(continuation ? '已复制带类型的核对文本（不是导入格式）' : '包含原文与修改的确认稿已复制'); } catch { setNotice('自动复制不可用，可在下方展开原文和确认稿后选择复制'); } };
  const back = async () => {
    if (busy.current) return;
    if (continuation) {
      let pending: boolean; try { pending = readCaptureContinuationState(continuation.grant).pending; } catch { busy.current = true; actionSequence.current++; cancelCaptureContinuation(continuation.grant); continuation.onClose(); return; }
      if (preservation.current !== 'saved' || pending) { setError('修改尚未落盘，仍保留在此页；请重试或先复制核对文本。'); return; }
      busy.current = true; actionSequence.current++; cancelCaptureContinuation(continuation.grant); continuation.onClose(); return;
    }
    try { await persist(current.current); navigate('/quick-note', { state: { reviewId: persistedId.current, inputKey: current.current.inputKey } }); } catch { /* visible inline failure */ } };
  const save = async () => {
    if (busy.current) return;
    if (continuation) {
      if (!isCaptureContinuationCurrent(continuation.grant)) return;
      const state = readCaptureContinuationState(continuation.grant);
      if (preservation.current !== 'saved' || state.pending) { setError('修改尚未落盘，请先重试保留修改；没有执行业务保存'); return; }
      const action = ++actionSequence.current; busy.current = true; setSaving(true); setError('');
      try {
        if (!readCaptureContinuationOperation(continuation.grant).committed) await applyCaptureContinuation(continuation.grant);
        await assertCaptureContinuationContext(continuation.grant);
        const context = await readCaptureInputActor(), receipt = await loadCaptureReceipt(original.id);
        await assertCaptureContinuationContext(continuation.grant); await assertCaptureInputActor(context);
        if (!receipt) throw new Error('保存结果尚未完整读回，请重试读取；不会另建记录');
        if (alive.current && action === actionSequence.current) setSavedResult({ receipt, context });
      } catch (cause) { if (alive.current && action === actionSequence.current) setError(captureSaveFailure(cause)); }
      finally { if (alive.current && action === actionSequence.current) { busy.current = false; setSaving(false); } }
      return;
    }
    busy.current = true; setSaving(true); setError('');
    try {
      await persist(current.current);
      const finalDraft = { ...current.current, id: persistedId.current };
      await applyCaptureDraft(finalDraft);
      navigate(`/quick-note/result?receipt=${encodeURIComponent(finalDraft.id)}`, { replace: true });
    } catch (cause) {
      if (cause instanceof CaptureChangedError) { sessionStorage.setItem(captureSessionKey(), cause.draftId); navigate(`/quick-note/result?draft=${encodeURIComponent(cause.draftId)}`, { replace: true }); }
      setError(captureSaveFailure(cause));
    } finally { busy.current = false; if (alive.current) setSaving(false); }
  };
  const expense = (id: string, patch: Partial<CaptureDraft['expenses'][number]>) => change({ expenses: current.current.expenses.map(row => row.id === id ? { ...row, ...patch } : row) });
  const todo = (id: string, patch: Partial<CaptureDraft['todos'][number]>) => change({ todos: current.current.todos.map(row => row.id === id ? { ...row, ...patch } : row) });
  const habit = (id: string, patch: Partial<CaptureDraft['habits'][number]>) => change({ habits: current.current.habits.map(row => row.id === id ? { ...row, ...patch } : row) });
  if (continuation && (initialGrant !== continuation.grant || entry?.invalid || context === 'locked' || !isCaptureContinuationCurrent(continuation.grant))) return <Frame title="需要重新核对账号" isolated back={() => void back()}><p role="alert">账号状态已变化，当前不展示这份原稿；未落盘内容仍仅保留在本次打开的应用内存中。</p></Frame>;
  if (continuation && context !== 'ready') return <Frame isolated title="正在核验原稿归属" back={() => void back()}><p role="status">正在核验本机资料，尚未打开原稿内容…</p></Frame>;
  if (savedResult && continuation) return <SavedCapture receipt={savedResult.receipt} id={original.id} context={savedResult.context} returnToEditor={() => void back()} />;
  const commitState = continuation ? readCaptureContinuationOperation(continuation.grant) : null;
  const frame = <Frame isolated={Boolean(continuation)} title={continuation ? `继续核对原稿 ${original.id}` : '选择要留下的记录'} back={() => void back()} footer={<div className="space-y-2"><p className="text-xs leading-5 text-[var(--text-2)]" aria-label="本次保存范围">原文 + {draft.expenses.filter(row => row.confirmed).length} 笔收支 · {draft.todos.filter(row => row.confirmed).length} 个待办 · {draft.diary ? '记入日记' : '不写日记'} · {draft.moodConfirmed ? '记录所选心情' : '不记录情绪'}{draft.habits.some(row => row.confirmed) ? ` · ${draft.habits.filter(row => row.confirmed).length} 项打卡` : ''}</p><p className="text-xs text-[var(--text-3)]" role="status">{status === 'saved' ? '确认稿已保留在本机' : status === 'pending' ? '正在保留修改…' : '修改尚未落盘'} · 确认后同步到 {accountName || '当前有迹账号'}</p>{continuation && <p className="text-xs">只处理这份原编号，当前原编辑仍保留。关闭不会撤销已保留的修正或已保存的记录。</p>}<Button className="w-full" disabled={saving} onClick={() => void save()}><Check size={18} aria-hidden />{saving ? '正在保存…' : commitState?.committed ? '重新读取本次保存结果' : commitState?.operationAttempted ? '重试同一次确认保存' : '确认保存所选记录'}</Button>{continuation && <Button variant="ghost" className="w-full" disabled={saving} onClick={() => void back()}>返回原编辑</Button>}</div>}>
    <div className="space-y-2 rounded-2xl bg-[var(--surface)] p-4"><p className="text-sm">规则整理可能有遗漏。你可以补充、修改，或只保留原文。</p><p className="text-xs leading-6 text-[var(--text-2)]">日期基准：{draft.context?.date ?? '旧稿日期未知'} · {draft.context?.timeZone ?? '原时区未知'}。各项实际写入日期如下，可以逐项修改。</p><details><summary className="cursor-pointer py-2 text-sm font-semibold">查看原文与本机确认稿</summary><p className="whitespace-pre-wrap break-words py-3 text-sm">{draft.input}</p><details><summary className="cursor-pointer py-2 text-xs">复制用完整确认稿</summary><textarea readOnly aria-label="完整确认稿备份" value={continuation ? captureContinuationText(continuation.grant) : JSON.stringify(draft, null, 2)} className={field} rows={8} /></details></details></div>
    {!continuation && <CaptureDraftBrowser disabled={saving} onContinue={(entry, stillSelected) => beginContinuation(entry, stillSelected, { ready: () => preservation.current === 'saved' && !busy.current, revision: () => version.current, epoch: () => current.current.dataEpoch, currentId: () => persistedId.current })} />}
    {notice && <p role="status" className="rounded-xl bg-[var(--surface-2)] p-3 text-sm">{notice}</p>}
    {error && <div role="alert" className="space-y-3 rounded-xl border border-[var(--danger)] p-3 text-sm"><p>{error}</p><div className="flex flex-wrap gap-2">{!commitState?.operationAttempted && <Button variant="ghost" onClick={() => void persist(current.current).catch(() => undefined)}>重试保留修改</Button>}<Button variant="ghost" onClick={() => void copy()}><Copy size={16} aria-hidden />复制确认稿</Button></div></div>}
    <fieldset disabled={saving || Boolean(commitState?.operationAttempted)} className="space-y-4">
      <Section title="收支" add={() => { if (!canEdit()) return; const id = generateLocalId(); setAmounts(values => ({ ...values, [id]: '' })); change({ expenses: [...draft.expenses, { id, name: '', amount: 0, category: 'other', confirmed: true, date: draft.context?.date ?? null, currency: 'CNY', isIncome: false }] }); }}>
        {!draft.expenses.length && <p className="text-sm text-[var(--text-3)]">没有识别到收支？可以添加一笔，原文不需要重写。</p>}
        {draft.expenses.map((row, index) => <div key={row.id} className="space-y-3 rounded-xl bg-[var(--surface-2)] p-3"><div className="flex items-center justify-between"><Checkbox checked={row.confirmed} onChange={value => expense(row.id, { confirmed: value })} label={`记录第${index + 1}笔收支`} /><Remove label={`第${index + 1}笔收支`} onClick={() => change({ expenses: draft.expenses.filter(item => item.id !== row.id) })} /></div><label className="block text-xs">名称<input aria-label={`第${index + 1}笔收支名称`} value={row.name} maxLength={100} onChange={event => expense(row.id, { name: event.target.value })} className={field} /></label><div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2"><label className="text-xs">人民币 CNY（元）<input aria-label={`第${index + 1}笔金额（人民币元）`} inputMode="decimal" value={amounts[row.id] ?? ''} onChange={event => { if (!canEdit()) return; const value = event.target.value; setAmounts(values => ({ ...values, [row.id]: value })); const valid = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value); const [whole, cents = ''] = value.split('.'); expense(row.id, { amountText: value, amount: valid ? Number(whole) * 100 + Number(cents.padEnd(2, '0')) : 0 }); }} className={field} /></label><label className="text-xs">记录日期<input type="date" aria-label={`第${index + 1}笔记录日期`} value={row.date ?? ''} onChange={event => expense(row.id, { date: event.target.value || null })} className={field} /></label><label className="text-xs">收支方向<select aria-label={`第${index + 1}笔收支方向`} value={row.isIncome ? 'income' : 'expense'} onChange={event => expense(row.id, { isIncome: event.target.value === 'income' })} className={field}><option value="expense">支出</option><option value="income">收入</option></select></label><label className="text-xs">分类<select aria-label={`第${index + 1}笔分类`} value={normalizeExpenseCategory(row.category)} onChange={event => expense(row.id, { category: event.target.value })} className={field}>{EXPENSE_CATEGORY_KEYS.map(key => <option value={key} key={key}>{expenseCategoryIcons[key].label}</option>)}</select></label></div><p className="text-xs text-[var(--text-3)]">去向：收支记录{!row.confirmed && ' · 此项不会写入'}</p></div>)}
      </Section>
      <Section title="待办" add={() => change({ todos: [...draft.todos, { id: generateLocalId(), text: '', confirmed: true, dueDate: null, dateConfirmed: true }] })}>
        <p className="text-xs leading-6 text-[var(--text-3)]">目前截止日期精确到天，不设置具体时刻提醒。原文中的时间会保留在待办文字中，请核对后保留或修改。</p>
        {!draft.todos.length && <p className="text-sm text-[var(--text-3)]">还可以添加遗漏的待办，不设截止日期也可以。</p>}
        {draft.todos.map((row, index) => <div key={row.id} className="space-y-3 rounded-xl bg-[var(--surface-2)] p-3"><div className="flex items-center justify-between"><Checkbox checked={row.confirmed} onChange={value => todo(row.id, { confirmed: value })} label={`记录第${index + 1}个待办`} /><Remove label={`第${index + 1}个待办`} onClick={() => change({ todos: draft.todos.filter(item => item.id !== row.id) })} /></div><label className="block text-xs">要做的事<input aria-label={`第${index + 1}个待办内容`} value={row.text} maxLength={200} onChange={event => todo(row.id, { text: event.target.value })} className={field} /></label><label className="block text-xs">绝对截止日期<input type="date" aria-label={`第${index + 1}个待办截止日期`} value={row.dueDate ?? ''} onChange={event => todo(row.id, { dueDate: event.target.value || null, dateConfirmed: true })} className={field} /></label><Button variant="ghost" onClick={() => todo(row.id, { dueDate: null, dateConfirmed: true })} aria-pressed={!row.dueDate && (!row.dateUncertain || row.dateConfirmed)}>不设截止日期</Button>{row.dateUncertain && !row.dateConfirmed && <p className="text-sm text-[var(--danger)]">原文日期不明确，请选择日期或明确不设日期。</p>}<p className="text-xs text-[var(--text-3)]">去向：待办 · {row.dueDate || '无截止日期'}{!row.confirmed && ' · 此项不会写入'}</p></div>)}
      </Section>
      <Section title="日记"><Checkbox checked={draft.diary !== null} onChange={value => change({ diary: value ? draft.diaryExcludedText ?? draft.input : null, diaryExcludedText: value ? undefined : draft.diary ?? draft.diaryExcludedText })} label="将这段文字记入日记" />{draft.diary !== null ? <><label className="block text-xs">日记日期<input type="date" aria-label="日记日期" value={draft.diaryDate ?? ''} onChange={event => change({ diaryDate: event.target.value || null })} className={field} /></label><textarea aria-label="日记内容" value={draft.diary} maxLength={10000} rows={4} onChange={event => { change({ diary: event.target.value }); }} className={field} /><p className="text-xs text-[var(--text-3)]">若该日已有一篇日记，会追加这段文字，不替换原文。</p></> : <p className="text-sm text-[var(--text-3)]">不写入日记。取消选择前的文字仍留在本页。</p>}</Section>
      <Section title="情绪"><Checkbox checked={draft.moodConfirmed === true} onChange={value => change({ moodConfirmed: value })} label="我愿意记录这次心情" /><p className="text-xs text-[var(--text-3)]">文字中的情绪只是候选，可能是引用或别人的经历。默认不记录，也不会按中性分数替你判断。</p>{draft.mood && !draft.moodConfirmed && <p className="text-sm">规则候选：{getMoodMeta(draft.mood)?.label} · 未选择，不写入</p>}{draft.moodConfirmed && <label className="block text-xs">这次心情<select aria-label="这次心情" value={draft.mood ?? ''} onChange={event => { const mood = (event.target.value || null) as MoodLevel | null; change({ mood, moodScore: mood ? getMoodScore(mood) : null }); }} className={field}><option value="">请选择，不替你默认</option>{MOOD_LEVELS.map(mood => <option value={mood} key={mood}>{getMoodMeta(mood)?.label}</option>)}</select></label>}</Section>
      <Section title="习惯打卡" add={() => change({ habits: [...draft.habits, { id: generateLocalId(), name: '', done: true, confirmed: false, date: draft.context?.date ?? null }] })}>
        {!draft.habits.length && <p className="text-sm text-[var(--text-3)]">仅为你明确确认已完成的已有习惯打卡。</p>}
        {draft.habits.map((row, index) => <div key={row.id} className="space-y-3 rounded-xl bg-[var(--surface-2)] p-3"><div className="flex items-center justify-between"><Checkbox checked={row.confirmed} onChange={value => habit(row.id, { confirmed: value, done: value ? true : row.done })} label={`确认第${index + 1}个习惯已完成`} /><Remove label={`第${index + 1}个习惯候选`} onClick={() => change({ habits: draft.habits.filter(item => item.id !== row.id) })} /></div><p className="text-xs">原文候选：{row.name || '手动补充'}{!row.done && '（未判断为已完成）'}</p><select aria-label={`第${index + 1}个已有习惯`} value={row.habitId ?? ''} onChange={event => habit(row.id, { habitId: event.target.value || undefined, name: knownHabits.find(item => item.id === event.target.value)?.name ?? row.name })} className={field}><option value="">选择已有习惯，避免同名误记</option>{knownHabits.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input type="date" aria-label={`第${index + 1}个习惯打卡日期`} value={row.date ?? ''} onChange={event => habit(row.id, { date: event.target.value || null })} className={field} />{!knownHabits.length && <p className="text-sm">还没有已有习惯。请先取消此项，保存后可到习惯页创建；不会凭文字自动新建。</p>}</div>)}
      </Section>
    </fieldset>
    <p className="text-xs leading-6 text-[var(--text-2)]">将保存原始速记，以及上面勾选的收支、待办、日记、心情和打卡。未选的结构化候选不会写入。原文仍包含你输入的完整内容，并随速记同步到当前账号；如需删去敏感原文，请先返回修改。此页不会调用模型服务。</p>
  </Frame>;
  return <><div ref={parentBackgroundRef} hidden={Boolean(continuationChild) || parentLocked}>{frame}</div>{parentLocked && !continuationChild && <Frame title="需要重新核对账号" back={() => navigate('/')}><p role="alert">账号或本机资料已变化，原编辑保留但不再展示。请返回后重新核对。</p></Frame>}{continuationChild && <CaptureReview original={continuationChild.draft} continuation={{ grant: continuationChild, onClose: () => { void closeContinuation(continuationChild!); } }} />}</>;
}
function targetPath(record: CaptureEntityRef): string {
  const paths = { quickNotes: '/timeline', expenses: '/expense', todos: '/todo', diaries: '/diary', habitCheckins: '/habit' };
  return `${paths[record.entity]}?record=${encodeURIComponent(record.entity === 'habitCheckins' ? record.parentId ?? record.id : record.id)}${record.entity === 'habitCheckins' ? `&date=${encodeURIComponent(record.date ?? '')}` : ''}`;
}
function SavedCapture({ receipt, id, context, returnToEditor }: { receipt: CaptureReceipt; id: string; context: CaptureInputActor; returnToEditor?: () => void }) {
  const currentOwner = useAuthStore(auth => auth.user?.id);
  const navigate = useNavigate(), [state, setState] = useState<ReceiptViewState>({ statuses: {}, current: {}, error: '', locked: false }), [attempt, retry] = useState(0);
  const records = receipt.result.records;
  const [newInputError, setNewInputError] = useState(''), [startingInput, setStartingInput] = useState(false);
  const inputRequest = useRef(0), inputBusy = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; const requests = inputRequest; return () => { alive.current = false; requests.current++; }; }, [context]);
  const newInput = async () => {
    if (inputBusy.current || !alive.current) return;
    if (!receipt.continuationProtocol) { navigate('/quick-note'); return; }
    if (readCaptureInputMemory(context.owner)) { setNewInputError('还有尚未确认落盘的原文保留在本次应用内存中。请先返回原文核对，不会清空或混入新输入。'); return; }
    const request = ++inputRequest.current, memoryRevision = captureInputMemoryRevision();
    inputBusy.current = true; setStartingInput(true); setNewInputError('');
    try {
      await assertCaptureInputActor(context);
      const input = await createEmptyCaptureInput();
      await assertCaptureInputActor(context);
      if (!alive.current || request !== inputRequest.current) return;
      if (captureInputMemoryRevision() !== memoryRevision || readCaptureInputMemory(context.owner)) throw new Error('已有新的原文编辑，未切换输入');
      sessionStorage.setItem(`youtrace:input:${context.owner ?? 'guest'}`, input.key);
      navigate('/quick-note');
    } catch { if (alive.current && request === inputRequest.current) setNewInputError('暂时未能打开新的空白原文。已有原文和回执仍保留；请核对账号、当前编辑及本机存储后重试。'); }
    finally { inputBusy.current = false; if (alive.current && request === inputRequest.current) setStartingInput(false); }
  };
  useEffect(() => {
    const target = context.database; let active = true, delivery = 0;
    const isActorCurrent = () => { try { assertLocalActorNow(context); return useAuthStore.getState().user?.id === target.ownerId; } catch { return false; } };
    const subscription = liveQuery(async () => { const value = await target.transaction('r', target.tables, async () => {
      await assertCaptureInputActor(context);
      const outbox = await target.outbox.toArray(), values: Record<string, string> = {}, current: Record<string, CurrentCaptureRecord> = {};
      for (const row of records ?? []) {
        const key = `${row.entity}:${row.id}`;
        const value = await target.table(row.entity === 'diaries' ? 'diary' : row.entity).get(row.id);
        current[key] = currentCaptureRecord(row, value);
        if (row.entity === 'habitCheckins' && row.parentId) { const habit = await target.habits.get(row.parentId); if (habit) current[key].label = habit.name; }
        const conflict = await target.settings.get(`sync-conflict:${key}`), version = await target.settings.get(`sync-version:${key}`);
        values[key] = currentReceiptSyncStatus(row, current[key].available, outbox, Boolean(conflict), version?.value);
      }
      await assertCaptureInputActor(context); return { statuses: values, current };
    }); await assertCaptureInputActor(context); return value; }).subscribe({ next: value => { if (active) { delivery++; setState(isActorCurrent() ? { ...value, error: '', locked: false } : failedReceiptRead(false)); } }, error: () => { const currentDelivery = ++delivery; void assertCaptureInputActor(context).then(() => { if (active && currentDelivery === delivery) setState(failedReceiptRead(isActorCurrent())); }, () => { if (active && currentDelivery === delivery) setState(failedReceiptRead(false)); }); } });
    return () => { active = false; subscription.unsubscribe(); };
  }, [records, context, attempt]);
  let actorCurrent = true; try { assertLocalActorNow(context); } catch { actorCurrent = false; }
  if (!actorCurrent || state.locked || currentOwner !== db.ownerId || receipt.ownerId !== undefined && receipt.ownerId !== currentOwner) return <Frame isolated={Boolean(returnToEditor)} title="需要重新核对账号" back={returnToEditor ?? (() => navigate('/'))}><p role="alert">账号状态已变化，当前不展示上一账号的保存结果。请先确认登录身份。</p></Frame>;
  const returnTo = { path: `/quick-note/result?receipt=${encodeURIComponent(id)}`, label: '返回保存结果' };
  return <Frame isolated={Boolean(returnToEditor)} title="这次记录已保存在本机" back={returnToEditor ?? (() => navigate('/'))} footer={returnToEditor ? <Button className="w-full" onClick={returnToEditor}>返回原编辑</Button> : <div className="flex gap-3"><Button variant="ghost" className="flex-1" onClick={() => navigate('/')}>回到首页</Button><Button className="flex-1" disabled={startingInput} onClick={() => void newInput()}>{startingInput ? '正在准备空白原文…' : '再记一条'}</Button></div>}>
    {newInputError && <p role="alert" className="text-sm text-[var(--danger)]">{newInputError}</p>}
    <p className="text-sm leading-6">下面展示这些记录的当前内容，会跟随之后的修改。创建时写入的只读回执仍原样保留，可在下方展开。刷新不会重复保存。</p>
    {receipt.result.committedAt && <p className="text-xs text-[var(--text-3)]">本机保存时间：{new Date(receipt.result.committedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（Asia/Shanghai）</p>}
    {state.error && <div role="alert" className="space-y-3 text-sm text-[var(--danger)]"><p>{state.error}</p><Button variant="ghost" onClick={() => { setState({ current: {}, statuses: {}, error: '', locked: false }); retry(value => value + 1); }}>重新读取当前记录</Button></div>}
    {!records?.length && <p className="text-sm">这是一份旧版保存回执，没有精确记录引用。请在时间线按原文核对，不会再次执行旧稿。</p>}
    <h2 className="text-sm font-bold">当前记录</h2>
    <ul className="space-y-3">{records?.map(row => {
      const content = <><div className="min-w-0 flex-1"><p className="break-words font-semibold">{state.current[`${row.entity}:${row.id}`]?.label ?? (state.error ? '当前记录暂不可读' : '正在读取当前记录…')}</p><p className="mt-1 break-words text-xs leading-5 text-[var(--text-2)]">{state.current[`${row.entity}:${row.id}`]?.detail}</p><p className="mt-1 text-xs text-[var(--text-3)]" role="status">{state.statuses[`${row.entity}:${row.id}`] ?? (state.error ? '同步确认未知' : '正在读取同步状态…')}</p></div>{!returnToEditor && <ChevronRight size={18} aria-hidden />}</>;
      const card = 'flex min-h-16 items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4';
      return <li key={`${row.entity}:${row.id}`}>{returnToEditor ? <div className={card}>{content}</div> : <Link to={targetPath(row)} state={{ returnTo }} className={`${card} focus-visible:outline-2 focus-visible:outline-[var(--primary)]`}>{content}</Link>}</li>;
    })}</ul>
    <details className="rounded-2xl border border-[var(--border)] p-4"><summary className="cursor-pointer py-1 font-semibold">当时写入（只读回执）</summary><p className="mt-3 text-xs leading-6 text-[var(--text-3)]">这是确认那一刻的证据，不代表记录现在的内容。后续纠错不会改写它。</p><ul className="mt-3 space-y-2 text-sm">{records?.map(row => <li key={`${row.entity}:${row.id}`}>{row.label}{row.date ? ` · ${row.date}` : ''} · {row.effect === 'updated' ? row.entity === 'diaries' ? '追加到原日记' : '更新原记录' : row.effect === 'already-recorded' ? '此前已有，没有重复写入' : '当时创建'}</li>)}</ul></details>
    <details className="rounded-2xl border border-[var(--border)] p-4"><summary className="cursor-pointer py-1 font-semibold">当时确认的原文</summary><p className="mt-3 whitespace-pre-wrap break-words text-sm">{receipt.input ?? '旧版回执未保留原文副本，请从速记记录核对'}</p></details>{!returnToEditor && <Link to="/settings" state={{ returnTo }} className="inline-block py-3 text-sm underline">查看同步与冲突处理</Link>}
  </Frame>;
}
