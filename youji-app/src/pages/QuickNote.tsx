import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Mic, Square, Keyboard, Copy } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { captureSessionKey, createCaptureDraft, forkCaptureInput, loadCaptureDraft, loadCaptureReceipt, saveCaptureDraft, saveCaptureInput, type CaptureInput } from '../services/quickNoteIntegration';
import { sameCaptureInput } from '../services/capturePresentation';
import { newCaptureContext, parseQuickNote, type CaptureContext } from '../services/parser';
import { db } from '../db';
import { recordDiagnostic } from '../services/diagnostics';


const MAX_LENGTH = 5000;
const SPEECH_FINISH_TIMEOUT = 2000;
// Only this document's verified account. A failed disk write can still be
// recovered after an in-app Back; a full reload remains warned by beforeunload.
let volatileInput: { owner: string | null; text: string; context: CaptureContext } | null = null;
interface Recognition extends EventTarget {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void;
}
type SpeechCompletion = 'complete' | 'failed' | 'cancelled';
interface SpeechSession {
  input: Recognition;
  done: Promise<SpeechCompletion>;
  resolve: (completion: SpeechCompletion) => void;
  stopping: boolean;
  settled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}
function recognitionType(): (new () => Recognition) | null {
  const source = window as Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return source.SpeechRecognition ?? source.webkitSpeechRecognition ?? null;
}
export default function QuickNote() {
  const navigate = useNavigate(), location = useLocation(), reduced = useReducedMotion();
  const returnState = location.state as { reviewId?: string; inputKey?: string } | null;
  const reviewId = typeof returnState?.reviewId === 'string' && returnState.reviewId ? returnState.reviewId : null;
  const remembered = volatileInput?.owner === db.ownerId ? volatileInput : null;
  const [text, setText] = useState(remembered?.text ?? '');
  const [context, setContext] = useState<CaptureContext>(remembered?.context ?? newCaptureContext);
  const [source, setSource] = useState<CaptureInput | null>(null);
  const [status, setStatus] = useState<'loading' | 'pending' | 'saved' | 'failed'>('loading');
  const [error, setError] = useState(''), [speechError, setSpeechError] = useState(''), [feedback, setFeedback] = useState('');
  const [mode, setMode] = useState<'text' | 'voice'>('text'), [recording, setRecording] = useState(false), [finishingSpeech, setFinishingSpeech] = useState(false), [saving, setSaving] = useState(false);
  const initialized = useRef<Promise<CaptureInput> | null>(null), alive = useRef(true), busy = useRef(false), edited = useRef(Boolean(remembered));
  const latest = useRef({ text, context });
  const pending = useRef(Promise.resolve()), version = useRef(0), recognition = useRef<SpeechSession | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const finishSpeech = (session: SpeechSession, completion: SpeechCompletion) => {
    if (session.settled) return;
    session.settled = true;
    if (session.timer !== null) clearTimeout(session.timer);
    session.input.onresult = null; session.input.onerror = null; session.input.onend = null;
    if (recognition.current === session) {
      recognition.current = null;
      if (alive.current) { setRecording(false); setFinishingSpeech(false); }
    }
    session.resolve(completion);
  };
  const cancelVoice = () => {
    const session = recognition.current;
    if (!session) return;
    finishSpeech(session, 'cancelled');
    if (!session.stopping) { try { session.input.stop(); } catch { /* Callbacks are already invalidated. */ } }
  };
  const queueSave = (input: CaptureInput, value: string, basis: CaptureContext) => {
    const revision = ++version.current;
    setStatus('pending'); setError('');
    const work = pending.current.catch(() => undefined).then(() => saveCaptureInput(input, value, basis)); pending.current = work;
    void work.then(() => { if (alive.current && revision === version.current) { setStatus('saved'); setError(''); volatileInput = null; } }).catch(() => { if (alive.current && revision === version.current) { setStatus('failed'); setError('草稿还没写入本机。输入仍在此页，请先复制，或恢复存储后重试。'); recordDiagnostic('runtime-error', 'capture'); } });
  };
  const initialize = () => {
    initialized.current ??= forkCaptureInput();
    void initialized.current.then(input => {
      if (!alive.current) return;
      setSource(input);
      const draft = edited.current ? latest.current : { text: input.text, context: input.context };
      setText(draft.text); setContext(draft.context); latest.current = draft;
      volatileInput = { owner: db.ownerId, ...draft };
      queueSave(input, draft.text, draft.context);
      if (input.text && !edited.current) setFeedback('已恢复本账号的未保存原文');
    }).catch(() => { if (alive.current) { initialized.current = null; setStatus('failed'); setError('草稿存储暂时打不开。你仍可输入和复制原文；检查设备空间或浏览器存储设置后重试。'); recordDiagnostic('runtime-error', 'capture'); } });
  };
  useEffect(() => {
    alive.current = true; initialize();
    return () => { alive.current = false; cancelVoice(); };
    // One initialization promise survives Strict Mode's effect replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (latest.current.text && (status === 'pending' || status === 'failed' || status === 'loading')) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [status]);
  const preserveInput = (value: string, basis: CaptureContext) => {
    const next = value.slice(0, MAX_LENGTH); edited.current = true; setText(next); setContext(basis); latest.current = { text: next, context: basis }; volatileInput = { owner: db.ownerId, text: next, context: basis };
    if (source) queueSave(source, next, basis);
  };
  const change = (value: string, basis = context) => {
    if (busy.current || !alive.current) return;
    if (recognition.current) {
      cancelVoice();
      setSpeechError('已改为手动编辑，未返回的语音不会继续加入。请核对已有文字。');
    }
    preserveInput(value, basis);
  };
  const preview = useMemo(() => text.trim() ? parseQuickNote(text, context) : null, [text, context]);
  const failSpeech = (session: SpeechSession, message: string) => {
    if (!alive.current || recognition.current !== session || session.settled) return;
    setSpeechError(message); finishSpeech(session, 'failed');
    if (!session.stopping) { try { session.input.stop(); } catch { /* Preserve the visible failure and text. */ } }
  };
  const stopVoice = (): Promise<SpeechCompletion> => {
    const session = recognition.current;
    if (!session) return Promise.resolve('complete');
    if (!session.stopping) {
      session.stopping = true; setRecording(false); setFinishingSpeech(true);
      session.timer = setTimeout(() => failSpeech(session, '语音收尾等待超时，已有文字仍保留。请核对、补全后再点“查看确认稿”，也可以重试语音。'), SPEECH_FINISH_TIMEOUT);
      try { session.input.stop(); } catch { failSpeech(session, '语音未能正常收尾，已有文字仍保留。请核对、补全后再点“查看确认稿”。'); }
    }
    return session.done;
  };
  const toggleVoice = () => {
    if (busy.current || !alive.current) return;
    if (recognition.current) { void stopVoice(); return; }
    const Constructor = recognitionType();
    if (!Constructor) { setSpeechError('这个浏览器暂不支持语音识别，文本输入仍可使用'); return; }
    const input = new Constructor();
    let resolve!: SpeechSession['resolve'];
    const session: SpeechSession = { input, done: new Promise<SpeechCompletion>(done => { resolve = done; }), resolve: completion => resolve(completion), stopping: false, settled: false, timer: null };
    recognition.current = session;
    input.lang = 'zh-CN'; input.continuous = true; input.interimResults = true;
    input.onresult = event => {
      if (!alive.current || recognition.current !== session || session.settled) return;
      let chunk = ''; for (let index = event.resultIndex; index < event.results.length; index++) if (event.results[index].isFinal) chunk += event.results[index][0].transcript;
      if (chunk) preserveInput(latest.current.text + chunk, latest.current.context);
    };
    input.onerror = () => failSpeech(session, '语音没有正常结束，已有文字仍保留。请检查麦克风权限，核对、补全后再点“查看确认稿”，也可以重试语音。');
    input.onend = () => { if (alive.current && recognition.current === session) finishSpeech(session, 'complete'); };
    try { input.start(); setRecording(true); setSpeechError(''); } catch { finishSpeech(session, 'failed'); setSpeechError('麦克风暂时无法启动。可检查权限或使用文本输入'); }
  };
  const chooseTextInput = () => {
    if (busy.current || !alive.current) return;
    if (recognition.current) {
      cancelVoice();
      setSpeechError('已停止语音输入，未返回的尾句不会继续加入。请核对已有文字，也可以继续输入。');
    }
    setMode('text');
  };
  const copy = async () => { try { await navigator.clipboard.writeText(text); setFeedback('原文已复制'); } catch { area.current?.focus(); area.current?.select(); setFeedback('已选中原文，请使用设备的复制操作'); } };
  const submit = async () => {
    if (!source || !text.trim() || busy.current) return;
    busy.current = true; setSaving(true); setError('');
    try {
      const completion = await stopVoice();
      if (!alive.current || completion !== 'complete') return;
      const { text, context } = latest.current;
      await pending.current.catch(() => undefined);
      if (!alive.current) return;
      await saveCaptureInput(source, text, context);
      if (!alive.current) return;
      if (reviewId) {
        const previous = await loadCaptureDraft(reviewId);
        if (!alive.current) return;
        if (previous && sameCaptureInput(previous, text, context) && previous.inputKey?.startsWith('capture-input:')) {
          // Re-select the original input for this ordinary return. Its existing
          // commit consumes that input; the temporary composer fork stays local
          // and cannot reappear as a new unsaved note after confirmation.
          sessionStorage.setItem(`youtrace:input:${db.ownerId ?? 'guest'}`, previous.inputKey);
          sessionStorage.setItem(captureSessionKey(), previous.id);
          navigate(`/quick-note/result?draft=${encodeURIComponent(previous.id)}`, { state: { draftId: previous.id } });
          return;
        }
        if (!previous) {
          const receipt = await loadCaptureReceipt(reviewId);
          if (!alive.current) return;
          if (!receipt) throw new Error('原确认稿暂时没有找到。原文仍保留，请返回核对，不会自动重新生成。');
          if (sameCaptureInput({ input: receipt.input, context: receipt.result.captureContext }, text, context)) {
            if (returnState?.inputKey?.startsWith('capture-input:')) sessionStorage.setItem(`youtrace:input:${db.ownerId ?? 'guest'}`, returnState.inputKey);
            navigate(`/quick-note/result?receipt=${encodeURIComponent(reviewId)}`);
            return;
          }
        }
      }
      const draft = await createCaptureDraft(text, source, context);
      if (!alive.current) return;
      await saveCaptureDraft(draft, true);
      if (!alive.current) return;
      sessionStorage.setItem(captureSessionKey(), draft.id);
      navigate(`/quick-note/result?draft=${encodeURIComponent(draft.id)}`, { state: { draftId: draft.id } });
    } catch { setStatus('failed'); setError('暂时未能打开或保留确认稿。原文仍在，原确认稿不会自动替换；请复制备份或检查存储后重试，不需要重新输入。'); }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  };
  const back = async () => {
    if (busy.current) return;
    cancelVoice();
    try { await pending.current; } catch { setError('草稿尚未落盘，已暂停返回。请先复制原文或重试保存。'); return; }
    if (!alive.current) return;
    if (location.key === 'default') navigate('/'); else navigate(-1);
  };
  return <motion.section initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.16 }} className="capture-workspace fixed inset-0 flex flex-col bg-[var(--bg)]" style={{ zIndex: 'var(--z-page-overlay)' }} aria-labelledby="capture-title" data-component="capture-composer">
    <header className="capture-header mx-auto flex w-full items-center gap-4"><button type="button" aria-label="返回" disabled={saving} onClick={() => void back()} className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-[var(--border)]"><ArrowLeft size={20} aria-hidden /></button><div><p className="record-eyebrow">CAPTURE / 01 原文</p><h1 id="capture-title">随手记</h1></div><span className="capture-step-hint">原文 → 确认稿 → 保存结果</span></header>
    <div className="min-h-0 flex-1 overflow-y-auto"><div className="capture-body mx-auto"><div className="capture-writing space-y-4"><p className="record-deck">先留下原文，再由你选择记录到哪里。</p>
      <div className="flex gap-2" role="group" aria-label="输入方式"><Button variant={mode === 'text' ? 'primary' : 'ghost'} onClick={chooseTextInput} disabled={saving} aria-pressed={mode === 'text'}><Keyboard size={16} aria-hidden />文本输入</Button><Button variant={mode === 'voice' ? 'primary' : 'ghost'} onClick={() => { if (!busy.current && alive.current) setMode('voice'); }} disabled={saving} aria-pressed={mode === 'voice'}><Mic size={16} aria-hidden />语音输入</Button></div>
      {mode === 'voice' && <div className="space-y-3 rounded-2xl border border-[var(--border)] p-4"><Button onClick={toggleVoice} aria-pressed={recording} disabled={!recognitionType() || saving || finishingSpeech}>{recording ? <Square size={16} aria-hidden /> : <Mic size={16} aria-hidden />}{finishingSpeech ? '正在接收语音尾句…' : recording ? '停止录音' : '开始语音输入'}</Button><p className="text-sm text-[var(--text-2)]" role={finishingSpeech ? 'status' : undefined}>{finishingSpeech ? saving ? '正在等待这次录音的最后结果，结束后再保留确认稿。' : '正在等待这次录音的最后结果。切换文本输入或修改文字会取消收尾，保留已显示文字。' : recognitionType() ? '识别的文字会留在下方，可以随时修正' : '当前浏览器不支持语音识别，直接输入文字即可'}</p></div>}
      {speechError && <p role="alert" className="text-sm text-[var(--danger)]">{speechError}</p>}
      <label htmlFor="capture-input" className="block text-sm font-semibold">想记下什么？</label><textarea id="capture-input" ref={area} aria-label="速记内容" value={text} onChange={event => change(event.target.value)} maxLength={MAX_LENGTH} rows={10} disabled={saving} placeholder="例如：明天要交报销单；午饭15" className="capture-paper w-full resize-y text-base leading-8 text-[var(--text-1)] focus:outline-2 focus:outline-[var(--primary)]" />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-3)]"><span>{text.length}/{MAX_LENGTH}</span><span role="status">{status === 'loading' ? '正在连接本机草稿存储…输入仍可继续' : status === 'pending' ? '正在保留草稿…' : status === 'saved' ? '原文已保留在本机' : '草稿尚未落盘'}</span></div>
      {error && <div role="alert" className="space-y-3 rounded-xl border border-[var(--danger)] p-3 text-sm"><p>{error}</p><div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => source ? queueSave(source, text, context) : initialize()}>重试草稿存储</Button><Button variant="ghost" onClick={() => void copy()} disabled={!text}>复制原文</Button></div></div>}
      </div><aside className="capture-context space-y-4" aria-label="记录方式与保存说明"><h2>这次记录</h2><details open className="record-disclosure text-sm"><summary className="cursor-pointer py-1">记录基准：{context.date ?? '旧稿日期未知，请在确认稿逐项核对'}（{context.timeZone ?? '原时区未知'}）</summary><p className="my-3 text-xs leading-6 text-[var(--text-3)]">“明天、后天”按此日期解释，跨午夜或返回页面不会改成新的日期。旧稿缺失的原始时间不会补成现在。</p><label className="block">更改这次记录的基准日期<input type="date" aria-label="记录基准日期" value={context.date ?? ''} disabled={saving} onChange={event => change(text, { ...context, date: event.target.value || null })} className="ml-3 min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2" /></label></details>
      {reviewId && <p className="text-sm leading-6 text-[var(--text-2)]">原文和记录基准未改时，继续刚才的确认稿及修正；改动后会重新整理为新稿，原确认稿仍保留。</p>}
      {preview && <p className="text-sm text-[var(--text-2)]" aria-label="规则识别预览">规则建议：{preview.expenses.length} 笔收支 · {preview.todos.length} 个待办{preview.habits.length ? ` · ${preview.habits.length} 个习惯候选` : ''}。下一步可以补漏、改日期，或只保留原文。</p>}
      <p className="text-xs leading-6 text-[var(--text-3)]">原文和确认稿目前仅在本机。确认保存后，原文和你选定的记录会同步到当前有迹账号。</p>
      {feedback && <p role="status" className="text-sm">{feedback}</p>}
    </aside></div></div>
    <footer className="border-t border-[var(--border-light)] bg-[var(--surface)] p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}><div className="capture-footer mx-auto flex gap-3"><Button variant="ghost" disabled={!text || saving} onClick={() => void copy()} aria-label="复制原文"><Copy size={18} aria-hidden /></Button><Button className="flex-1" disabled={!text.trim() || !source || saving} onClick={() => void submit()}>{saving ? finishingSpeech ? '正在接收语音尾句…' : '正在保留确认稿…' : '查看确认稿'}</Button></div></footer>
  </motion.section>;
}
