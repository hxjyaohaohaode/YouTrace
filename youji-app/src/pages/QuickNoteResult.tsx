import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { liveQuery } from 'dexie';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Plus, Trash2, Check, Copy, ChevronRight } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { getMoodScore, type MoodLevel } from '../services/parser';
import { applyCaptureDraft, CaptureChangedError, captureFingerprint, captureSessionKey, loadCaptureDraft, loadCaptureReceipt, saveCaptureDraft, upgradeCaptureReview, type CaptureDraft, type CaptureReceipt, type CaptureEntityRef } from '../services/quickNoteIntegration';
import { MOOD_LEVELS, getMoodMeta, EXPENSE_CATEGORY_KEYS, expenseCategoryIcons, normalizeExpenseCategory } from '../utils/icons';
import { db, generateLocalId } from '../db';
import { useHabitStore } from '../stores/habitStore';
import { useAuthStore } from '../stores/authStore';
import { retainPendingEditor, readPendingEditor, releasePendingEditor } from '../services/pendingEditorMemory';
import { SESSION_REVISION_KEY } from '../services/apiClient';
import { recordDiagnostic } from '../services/diagnostics';

const field = 'min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-1)] focus:outline-2 focus:outline-[var(--primary)]';
function Frame({ children, title, back, footer }: { children: ReactNode; title: string; back: () => void; footer?: ReactNode }) {
  const reduced = useReducedMotion();
  return <motion.section initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.16 }} className="fixed inset-0 flex flex-col bg-[var(--bg)]" style={{ zIndex: 'var(--z-page-overlay)' }} aria-labelledby="review-title" data-component="capture-review">
    <header className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3"><button type="button" aria-label="返回" onClick={back} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)]"><ArrowLeft size={20} aria-hidden /></button><h1 id="review-title" className="text-lg font-bold">{title}</h1></header>
    <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-3xl space-y-4 px-4 pb-8">{children}</div></div>
    {footer && <footer className="border-t border-[var(--border)] bg-[var(--surface)] p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}><div className="mx-auto max-w-3xl">{footer}</div></footer>}
  </motion.section>;
}
export default function QuickNoteResult() {
  const location = useLocation(), navigate = useNavigate();
  const params = new URLSearchParams(location.search), receiptId = params.get('receipt');
  const requestedId = params.get('draft') ?? (location.state as { draftId?: string } | null)?.draftId ?? sessionStorage.getItem(captureSessionKey());
  const [loaded, setLoaded] = useState<{ draft: CaptureDraft | null; receipt: CaptureReceipt | null } | null>(null);
  const [error, setError] = useState(''), [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    const read = async () => {
      const id = receiptId ?? requestedId;
      const receipt = id ? await loadCaptureReceipt(id) : null;
      const draft = !receipt && !receiptId ? await loadCaptureDraft(requestedId) : null;
      if (active) { setLoaded({ draft, receipt }); setError(''); }
    };
    void read().catch(() => { if (active) { setError('暂时读不到本机确认稿。原文不会因此删除，请检查存储后重试。'); recordDiagnostic('runtime-error', 'capture-review'); } });
    return () => { active = false; };
  }, [receiptId, requestedId, attempt]);
  if (error || !loaded) return <Frame title="整理确认稿" back={() => navigate('/quick-note')}>{error ? <div role="alert" className="space-y-4"><p>{error}</p><Button onClick={() => retry(value => value + 1)}>重试读取</Button><Button variant="ghost" onClick={() => navigate('/quick-note')}>返回原文</Button></div> : <p role="status">正在恢复本机确认稿…</p>}</Frame>;
  if (loaded.receipt) return <SavedCapture receipt={loaded.receipt} id={receiptId ?? requestedId!} />;
  if (!loaded.draft) return <Frame title="整理确认稿" back={() => navigate('/')}><p>这份确认稿在当前账号的本机存储中没有找到。可能已在其他设备处理，或本机资料已清理。</p><Button onClick={() => navigate('/quick-note')}>查看未保存原文</Button></Frame>;
  return <CaptureReview key={loaded.draft.id} original={loaded.draft} />;
}
function Section({ title, children, add }: { title: string; children: ReactNode; add?: () => void }) {
  return <section aria-label={title} className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><header className="flex items-center justify-between gap-2"><h2 className="font-bold">{title}</h2>{add && <Button variant="ghost" onClick={add} aria-label={`添加${title}`}><Plus size={16} aria-hidden />添加</Button>}</header>{children}</section>;
}
function Remove({ label, onClick }: { label: string; onClick: () => void }) { return <Button variant="ghost" aria-label={`移除${label}`} onClick={onClick}><Trash2 size={17} aria-hidden /></Button>; }
function CaptureReview({ original }: { original: CaptureDraft }) {
  const navigate = useNavigate(), accountName = useAuthStore(state => state.user?.nickname), knownHabits = useHabitStore(state => state.items);
  const scope = { database: db, owner: db.ownerId, session: original.sessionRevision ?? localStorage.getItem(SESSION_REVISION_KEY), epoch: original.dataEpoch ?? 'initial', key: `capture-review:${original.id}` };
  const [recovered] = useState(() => readPendingEditor<CaptureDraft>(scope));
  const initial = recovered ?? upgradeCaptureReview(original);
  const [draft, setDraft] = useState(initial);
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(initial.expenses.map(row => [row.id, row.amountText ?? String(row.amount / 100)])));
  const [status, setStatus] = useState<'saved' | 'pending' | 'failed'>(recovered ? 'failed' : 'saved'), [error, setError] = useState(recovered ? '已找回离开前尚未落盘的确认稿，请重试保留修改' : ''), [notice, setNotice] = useState(''), [saving, setSaving] = useState(false);
  const current = useRef(initial), persistedId = useRef(original.id), expected = useRef(captureFingerprint(original)), queue = useRef(Promise.resolve()), version = useRef(0), busy = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (status !== 'saved') { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [status]);
  const persist = (next: CaptureDraft) => {
    const revision = ++version.current, token = retainPendingEditor(scope, next); setStatus('pending');
    const work = queue.current.catch(() => undefined).then(async () => {
      const snapshot = { ...next, id: persistedId.current };
      const id = await saveCaptureDraft(snapshot, true, expected.current);
      releasePendingEditor(scope, token);
      expected.current = captureFingerprint(snapshot); persistedId.current = id;
      sessionStorage.setItem(captureSessionKey(), id);
      if (id !== snapshot.id && alive.current) setNotice('另一页已经修改或保存原稿。这份修改已独立保留，请重新核对后确认，不会覆盖另一页。');
      if (alive.current && revision === version.current) { setStatus('saved'); setError(''); }
    });
    queue.current = work;
    void work.catch(() => { if (alive.current && revision === version.current) { setStatus('failed'); setError('修改还没写入本机，仍保留在此页。请重试或先复制，不要直接关闭。'); recordDiagnostic('runtime-error', 'capture-review'); } });
    return work;
  };
  const change = (patch: Partial<CaptureDraft>) => { const next = { ...current.current, ...patch }; current.current = next; setDraft(next); void persist(next).catch(() => undefined); };
  const copy = async () => { const content = JSON.stringify(current.current, null, 2); try { await navigator.clipboard.writeText(content); setNotice('包含原文与修改的确认稿已复制'); } catch { setNotice('自动复制不可用，可在下方展开原文和确认稿后选择复制'); } };
  const back = async () => { if (busy.current) return; try { await persist(current.current); navigate('/quick-note'); } catch { /* visible inline failure */ } };
  const save = async () => {
    if (busy.current) return; busy.current = true; setSaving(true); setError('');
    try {
      await persist(current.current);
      const finalDraft = { ...current.current, id: persistedId.current };
      await applyCaptureDraft(finalDraft);
      navigate(`/quick-note/result?receipt=${encodeURIComponent(finalDraft.id)}`, { replace: true });
    } catch (cause) {
      if (cause instanceof CaptureChangedError) { sessionStorage.setItem(captureSessionKey(), cause.draftId); navigate(`/quick-note/result?draft=${encodeURIComponent(cause.draftId)}`, { replace: true }); }
      setError(cause instanceof Error ? cause.message : '保存未完成，确认稿仍保留，请重试');
    } finally { busy.current = false; if (alive.current) setSaving(false); }
  };
  const expense = (id: string, patch: Partial<CaptureDraft['expenses'][number]>) => change({ expenses: current.current.expenses.map(row => row.id === id ? { ...row, ...patch } : row) });
  const todo = (id: string, patch: Partial<CaptureDraft['todos'][number]>) => change({ todos: current.current.todos.map(row => row.id === id ? { ...row, ...patch } : row) });
  const habit = (id: string, patch: Partial<CaptureDraft['habits'][number]>) => change({ habits: current.current.habits.map(row => row.id === id ? { ...row, ...patch } : row) });
  return <Frame title="选择要留下的记录" back={() => void back()} footer={<div className="space-y-2"><p className="text-xs leading-5 text-[var(--text-2)]" aria-label="本次保存范围">原文 + {draft.expenses.filter(row => row.confirmed).length} 笔收支 · {draft.todos.filter(row => row.confirmed).length} 个待办 · {draft.diary ? '记入日记' : '不写日记'} · {draft.moodConfirmed ? '记录所选心情' : '不记录情绪'}{draft.habits.some(row => row.confirmed) ? ` · ${draft.habits.filter(row => row.confirmed).length} 项打卡` : ''}</p><p className="text-xs text-[var(--text-3)]" role="status">{status === 'saved' ? '确认稿已保留在本机' : status === 'pending' ? '正在保留修改…' : '修改尚未落盘'} · 确认后同步到 {accountName || '当前有迹账号'}</p><Button className="w-full" disabled={saving} onClick={() => void save()}><Check size={18} aria-hidden />{saving ? '正在保存…' : '确认保存所选记录'}</Button></div>}>
    <div className="space-y-2 rounded-2xl bg-[var(--surface)] p-4"><p className="text-sm">规则整理可能有遗漏。你可以补充、修改，或只保留原文。</p><p className="text-xs leading-6 text-[var(--text-2)]">日期基准：{draft.context?.date ?? '旧稿日期未知'} · {draft.context?.timeZone ?? '原时区未知'}。各项实际写入日期如下，可以逐项修改。</p><details><summary className="cursor-pointer py-2 text-sm font-semibold">查看原文与本机确认稿</summary><p className="whitespace-pre-wrap break-words py-3 text-sm">{draft.input}</p><details><summary className="cursor-pointer py-2 text-xs">复制用完整确认稿</summary><textarea readOnly aria-label="完整确认稿备份" value={JSON.stringify(draft, null, 2)} className={field} rows={8} /></details></details></div>
    {notice && <p role="status" className="rounded-xl bg-[var(--surface-2)] p-3 text-sm">{notice}</p>}
    {error && <div role="alert" className="space-y-3 rounded-xl border border-[var(--danger)] p-3 text-sm"><p>{error}</p><div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => void persist(current.current).catch(() => undefined)}>重试保留修改</Button><Button variant="ghost" onClick={() => void copy()}><Copy size={16} aria-hidden />复制确认稿</Button></div></div>}
    <fieldset disabled={saving} className="space-y-4">
      <Section title="收支" add={() => { const id = generateLocalId(); setAmounts(values => ({ ...values, [id]: '' })); change({ expenses: [...draft.expenses, { id, name: '', amount: 0, category: 'other', confirmed: true, date: draft.context?.date ?? null, currency: 'CNY', isIncome: false }] }); }}>
        {!draft.expenses.length && <p className="text-sm text-[var(--text-3)]">没有识别到收支？可以添加一笔，原文不需要重写。</p>}
        {draft.expenses.map((row, index) => <div key={row.id} className="space-y-3 rounded-xl bg-[var(--surface-2)] p-3"><div className="flex items-center justify-between"><Checkbox checked={row.confirmed} onChange={value => expense(row.id, { confirmed: value })} label={`记录第${index + 1}笔收支`} /><Remove label={`第${index + 1}笔收支`} onClick={() => change({ expenses: draft.expenses.filter(item => item.id !== row.id) })} /></div><label className="block text-xs">名称<input aria-label={`第${index + 1}笔收支名称`} value={row.name} maxLength={100} onChange={event => expense(row.id, { name: event.target.value })} className={field} /></label><div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2"><label className="text-xs">人民币 CNY（元）<input aria-label={`第${index + 1}笔金额（人民币元）`} inputMode="decimal" value={amounts[row.id] ?? ''} onChange={event => { const value = event.target.value; setAmounts(values => ({ ...values, [row.id]: value })); const valid = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value); const [whole, cents = ''] = value.split('.'); expense(row.id, { amountText: value, amount: valid ? Number(whole) * 100 + Number(cents.padEnd(2, '0')) : 0 }); }} className={field} /></label><label className="text-xs">记录日期<input type="date" aria-label={`第${index + 1}笔记录日期`} value={row.date ?? ''} onChange={event => expense(row.id, { date: event.target.value || null })} className={field} /></label><label className="text-xs">收支方向<select aria-label={`第${index + 1}笔收支方向`} value={row.isIncome ? 'income' : 'expense'} onChange={event => expense(row.id, { isIncome: event.target.value === 'income' })} className={field}><option value="expense">支出</option><option value="income">收入</option></select></label><label className="text-xs">分类<select aria-label={`第${index + 1}笔分类`} value={normalizeExpenseCategory(row.category)} onChange={event => expense(row.id, { category: event.target.value })} className={field}>{EXPENSE_CATEGORY_KEYS.map(key => <option value={key} key={key}>{expenseCategoryIcons[key].label}</option>)}</select></label></div><p className="text-xs text-[var(--text-3)]">去向：收支记录{!row.confirmed && ' · 此项不会写入'}</p></div>)}
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
}
function targetPath(record: CaptureEntityRef): string {
  const paths = { quickNotes: '/timeline', expenses: '/expense', todos: '/todo', diaries: '/diary', habitCheckins: '/habit' };
  return `${paths[record.entity]}?record=${encodeURIComponent(record.entity === 'habitCheckins' ? record.parentId ?? record.id : record.id)}${record.entity === 'habitCheckins' ? `&date=${encodeURIComponent(record.date ?? '')}` : ''}`;
}
function SavedCapture({ receipt, id }: { receipt: CaptureReceipt; id: string }) {
  const navigate = useNavigate(), [statuses, setStatuses] = useState<Record<string, string>>({}), [syncError, setSyncError] = useState('');
  const records = receipt.result.records;
  useEffect(() => {
    const target = db;
    const subscription = liveQuery(async () => {
      const outbox = await target.outbox.toArray(), values: Record<string, string> = {};
      for (const row of records ?? []) {
        const key = `${row.entity}:${row.id}`;
        const ops = outbox.filter(op => op.entity === row.entity && (op.op === 'delete' ? op.payload === row.id : (op.payload as { id?: string }).id === row.id));
        const conflict = await target.settings.get(`sync-conflict:${key}`), version = await target.settings.get(`sync-version:${key}`);
        values[key] = conflict ? '有版本冲突，需要比较' : ops.some(op => op.status === 'blocked') ? '云端尚未接收，需要处理' : ops.length ? '本机已保存，等待云端确认' : version ? '已收到云端版本确认' : '本机已保存，云端确认未知';
      }
      return values;
    }).subscribe({ next: value => { setStatuses(value); setSyncError(''); }, error: () => setSyncError('暂时读不到同步状态，保存回执仍在。可到设置页查看。') });
    return () => subscription.unsubscribe();
  }, [records]);
  const returnTo = { path: `/quick-note/result?receipt=${encodeURIComponent(id)}`, label: '返回保存结果' };
  return <Frame title="这次记录已保存在本机" back={() => navigate('/')} footer={<div className="flex gap-3"><Button variant="ghost" className="flex-1" onClick={() => navigate('/')}>回到首页</Button><Button className="flex-1" onClick={() => navigate('/quick-note')}>再记一条</Button></div>}>
    <p className="text-sm leading-6">下面是这次实际写入的记录。打开后可以继续核对、改期或纠错。刷新本页不会重复保存。</p>
    {receipt.result.committedAt && <p className="text-xs text-[var(--text-3)]">本机保存时间：{new Date(receipt.result.committedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（Asia/Shanghai）</p>}
    {syncError && <p role="alert" className="text-sm text-[var(--danger)]">{syncError}</p>}
    {!records?.length && <p className="text-sm">这是一份旧版保存回执，没有精确记录引用。请在时间线按原文核对，不会再次执行旧稿。</p>}
    <ul className="space-y-3">{records?.map(row => <li key={`${row.entity}:${row.id}`}><Link to={targetPath(row)} state={{ returnTo }} className="flex min-h-16 items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 focus-visible:outline-2 focus-visible:outline-[var(--primary)]"><div className="min-w-0 flex-1"><p className="break-words font-semibold">{row.label}</p><p className="mt-1 text-xs text-[var(--text-2)]">{row.date ? `${row.date} · ` : ''}{row.effect === 'updated' ? '已追加到原记录' : row.effect === 'already-recorded' ? '此前已打卡，没有重复写入' : '已创建'}</p><p className="mt-1 text-xs text-[var(--text-3)]" role="status">{statuses[`${row.entity}:${row.id}`] ?? '正在读取同步状态…'}</p></div><ChevronRight size={18} aria-hidden /></Link></li>)}</ul>
    <details className="rounded-2xl border border-[var(--border)] p-4"><summary className="cursor-pointer py-1 font-semibold">查看已保存原文</summary><p className="mt-3 whitespace-pre-wrap break-words text-sm">{receipt.input ?? '旧版回执未保留原文副本，请从速记记录核对'}</p></details><Link to="/settings" state={{ returnTo }} className="inline-block py-3 text-sm underline">查看同步与冲突处理</Link>
  </Frame>;
}
