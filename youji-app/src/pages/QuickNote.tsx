import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Mic, Square, Keyboard, Copy } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { captureSessionKey, createCaptureDraft, forkCaptureInput, saveCaptureDraft, saveCaptureInput, type CaptureInput } from '../services/quickNoteIntegration';
import { newCaptureContext, parseQuickNote, type CaptureContext } from '../services/parser';
import { db } from '../db';
import { recordDiagnostic } from '../services/diagnostics';

const MAX_LENGTH = 5000;
// Only this document's verified account. A failed disk write can still be
// recovered after an in-app Back; a full reload remains warned by beforeunload.
let volatileInput: { owner: string | null; text: string; context: CaptureContext } | null = null;
interface Recognition extends EventTarget {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void;
}
function recognitionType(): (new () => Recognition) | null {
  const source = window as Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return source.SpeechRecognition ?? source.webkitSpeechRecognition ?? null;
}
export default function QuickNote() {
  const navigate = useNavigate(), location = useLocation(), reduced = useReducedMotion();
  const remembered = volatileInput?.owner === db.ownerId ? volatileInput : null;
  const [text, setText] = useState(remembered?.text ?? '');
  const [context, setContext] = useState<CaptureContext>(remembered?.context ?? newCaptureContext);
  const [source, setSource] = useState<CaptureInput | null>(null);
  const [status, setStatus] = useState<'loading' | 'pending' | 'saved' | 'failed'>('loading');
  const [error, setError] = useState(''), [speechError, setSpeechError] = useState(''), [feedback, setFeedback] = useState('');
  const [mode, setMode] = useState<'text' | 'voice'>('text'), [recording, setRecording] = useState(false), [saving, setSaving] = useState(false);
  const initialized = useRef<Promise<CaptureInput> | null>(null), alive = useRef(true), busy = useRef(false), edited = useRef(Boolean(remembered));
  const latest = useRef({ text, context });
  const pending = useRef(Promise.resolve()), version = useRef(0), recognition = useRef<Recognition | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
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
    return () => { alive.current = false; recognition.current?.stop(); };
    // One initialization promise survives Strict Mode's effect replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (latest.current.text && (status === 'pending' || status === 'failed' || status === 'loading')) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [status]);
  const change = (value: string, basis = context) => {
    const next = value.slice(0, MAX_LENGTH); edited.current = true; setText(next); setContext(basis); latest.current = { text: next, context: basis }; volatileInput = { owner: db.ownerId, text: next, context: basis };
    if (source) queueSave(source, next, basis);
  };
  const preview = useMemo(() => text.trim() ? parseQuickNote(text, context) : null, [text, context]);
  const stopVoice = () => { recognition.current?.stop(); setRecording(false); };
  const toggleVoice = () => {
    if (recording) { stopVoice(); return; }
    const Constructor = recognitionType();
    if (!Constructor) { setSpeechError('这个浏览器暂不支持语音识别，文本输入仍可使用'); return; }
    recognition.current ??= new Constructor(); const input = recognition.current;
    input.lang = 'zh-CN'; input.continuous = true; input.interimResults = true;
    input.onresult = event => { let chunk = ''; for (let index = event.resultIndex; index < event.results.length; index++) if (event.results[index].isFinal) chunk += event.results[index][0].transcript; if (chunk) change(latest.current.text + chunk, latest.current.context); };
    input.onerror = () => { setRecording(false); setSpeechError('语音没有继续。请检查麦克风权限，也可以直接改用文本；已有文字不变。'); };
    input.onend = () => setRecording(false);
    try { input.start(); setRecording(true); setSpeechError(''); } catch { setSpeechError('麦克风暂时无法启动。可检查权限或使用文本输入'); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(text); setFeedback('原文已复制'); } catch { area.current?.focus(); area.current?.select(); setFeedback('已选中原文，请使用设备的复制操作'); } };
  const submit = async () => {
    if (!source || !text.trim() || busy.current) return;
    busy.current = true; setSaving(true); stopVoice(); setError('');
    try {
      await pending.current.catch(() => undefined); await saveCaptureInput(source, text, context);
      const draft = await createCaptureDraft(text, source, context); await saveCaptureDraft(draft, true);
      sessionStorage.setItem(captureSessionKey(), draft.id);
      navigate(`/quick-note/result?draft=${encodeURIComponent(draft.id)}`, { state: { draftId: draft.id } });
    } catch { setStatus('failed'); setError('确认稿没有保存成功。原文仍在，请复制备份或检查存储后重试，不需要重新输入。'); }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  };
  const back = async () => {
    stopVoice();
    try { await pending.current; } catch { setError('草稿尚未落盘，已暂停返回。请先复制原文或重试保存。'); return; }
    if (location.key === 'default') navigate('/'); else navigate(-1);
  };
  return <motion.section initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.16 }} className="fixed inset-0 flex flex-col bg-[var(--bg)]" style={{ zIndex: 'var(--z-page-overlay)' }} aria-labelledby="capture-title" data-component="capture-composer">
    <header className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3"><button type="button" aria-label="返回" disabled={saving} onClick={() => void back()} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)]"><ArrowLeft size={20} aria-hidden /></button><div><h1 id="capture-title" className="text-lg font-bold">随手记</h1><p className="text-xs text-[var(--text-3)]">先留下原文，再由你选择记录到哪里</p></div></header>
    <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-3xl space-y-4 px-4 pb-6">
      <div className="flex gap-2" role="group" aria-label="输入方式"><Button variant={mode === 'text' ? 'primary' : 'ghost'} onClick={() => { stopVoice(); setMode('text'); }} aria-pressed={mode === 'text'}><Keyboard size={16} aria-hidden />文本输入</Button><Button variant={mode === 'voice' ? 'primary' : 'ghost'} onClick={() => setMode('voice')} aria-pressed={mode === 'voice'}><Mic size={16} aria-hidden />语音输入</Button></div>
      {mode === 'voice' && <div className="space-y-3 rounded-2xl border border-[var(--border)] p-4"><Button onClick={toggleVoice} aria-pressed={recording} disabled={!recognitionType()}>{recording ? <Square size={16} aria-hidden /> : <Mic size={16} aria-hidden />}{recording ? '停止录音' : '开始语音输入'}</Button><p className="text-sm text-[var(--text-2)]">{recognitionType() ? '识别的文字会留在下方，可以随时修正' : '当前浏览器不支持语音识别，直接输入文字即可'}</p></div>}
      {speechError && <p role="alert" className="text-sm text-[var(--danger)]">{speechError}</p>}
      <label htmlFor="capture-input" className="block text-sm font-semibold">想记下什么？</label><textarea id="capture-input" ref={area} aria-label="速记内容" value={text} onChange={event => change(event.target.value)} maxLength={MAX_LENGTH} rows={7} disabled={saving} placeholder="例如：明天要交报销单；午饭15" className="w-full resize-y rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-base leading-7 text-[var(--text-1)] focus:outline-2 focus:outline-[var(--primary)]" />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-3)]"><span>{text.length}/{MAX_LENGTH}</span><span role="status">{status === 'loading' ? '正在连接本机草稿存储…输入仍可继续' : status === 'pending' ? '正在保留草稿…' : status === 'saved' ? '原文已保留在本机' : '草稿尚未落盘'}</span></div>
      {error && <div role="alert" className="space-y-3 rounded-xl border border-[var(--danger)] p-3 text-sm"><p>{error}</p><div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => source ? queueSave(source, text, context) : initialize()}>重试草稿存储</Button><Button variant="ghost" onClick={() => void copy()} disabled={!text}>复制原文</Button></div></div>}
      <details className="rounded-xl border border-[var(--border-light)] p-3 text-sm"><summary className="cursor-pointer py-1">记录基准：{context.date ?? '旧稿日期未知，请在确认稿逐项核对'}（{context.timeZone ?? '原时区未知'}）</summary><p className="my-3 text-xs leading-6 text-[var(--text-3)]">“明天、后天”按此日期解释，跨午夜或返回页面不会改成新的日期。旧稿缺失的原始时间不会补成现在。</p><label className="block">更改这次记录的基准日期<input type="date" aria-label="记录基准日期" value={context.date ?? ''} onChange={event => change(text, { ...context, date: event.target.value || null })} className="ml-3 min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2" /></label></details>
      {preview && <p className="text-sm text-[var(--text-2)]" aria-label="规则识别预览">规则建议：{preview.expenses.length} 笔收支 · {preview.todos.length} 个待办{preview.habits.length ? ` · ${preview.habits.length} 个习惯候选` : ''}。下一步可以补漏、改日期，或只保留原文。</p>}
      <p className="text-xs leading-6 text-[var(--text-3)]">原文和确认稿目前仅在本机。确认保存后，原文和你选定的记录会同步到当前有迹账号。</p>
      {feedback && <p role="status" className="text-sm">{feedback}</p>}
    </div></div>
    <footer className="border-t border-[var(--border-light)] bg-[var(--surface)] p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}><div className="mx-auto flex max-w-3xl gap-3"><Button variant="ghost" disabled={!text || saving} onClick={() => void copy()} aria-label="复制原文"><Copy size={18} aria-hidden /></Button><Button className="flex-1" disabled={!text.trim() || !source || saving} onClick={() => void submit()}>{saving ? '正在保留确认稿…' : '查看确认稿'}</Button></div></footer>
  </motion.section>;
}
