import { useState, useRef, useMemo, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Mic, Keyboard, Square, AlertCircle, Wallet, CheckSquare, BookOpen, Smile, Tag, Sparkles } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { captureSessionKey, saveCaptureDraft, forkCaptureInput } from '../services/quickNoteIntegration';
import { parseQuickNote } from '../services/parser';
import { generateLocalId, setSetting } from '../db';
import { getMoodMeta, expenseCategoryIcons } from '../utils/icons';

const MAX_NOTE_LENGTH = 5000;

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function QuickNote() {
  const [text, setText] = useState('');
  const [draftRestored, setDraftRestored] = useState(false);
  const submitting = useRef(false);
  const [inputKey, setInputKey] = useState<string | null>(null);
  const inputKeyRef = useRef<string | null>(null);
  const touched = useRef(false);
  const [mode, setMode] = useState<'text' | 'voice'>('text');
  const [isRecording, setIsRecording] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const voiceAreaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let active = true;
    void forkCaptureInput().then(({ key, text: draft }) => { if (!active) return; inputKeyRef.current = key; setInputKey(key); if (draft && !touched.current) { setText(draft.slice(0, MAX_NOTE_LENGTH)); setDraftRestored(true); } }).catch(() => setSpeechError('草稿存储暂不可用，请检查设备空间后刷新'));
    return () => { active = false; recognitionRef.current?.stop(); };
  }, []);

  const liveParsed = useMemo(() => {
    const trimmed = text.trim();
    if (trimmed.length < 4) return null;
    return parseQuickNote(trimmed);
  }, [text]);

  const previewChips = useMemo(() => {
    if (!liveParsed) return [];
    const chips: Array<{ icon: typeof Wallet; label: string; key: string }> = [];
    for (const exp of liveParsed.expenses.filter((e) => e.confirmed)) {
      chips.push({
        key: `e-${exp.id}`,
        icon: Wallet,
        label: `¥${(exp.amount / 100).toFixed(exp.amount % 100 === 0 ? 0 : 2)} ${expenseCategoryIcons[exp.category]?.label ?? ''}`.trim(),
      });
    }
    for (const todo of liveParsed.todos.filter((t) => t.confirmed)) {
      chips.push({ key: `t-${todo.id}`, icon: CheckSquare, label: todo.text.slice(0, 14) });
    }
    for (const habit of liveParsed.habits.filter((h) => h.confirmed)) {
      chips.push({ key: `h-${habit.id}`, icon: Tag, label: `${habit.done ? '完成' : '未'}${habit.name.slice(0, 8)}` });
    }
    if (liveParsed.mood) {
      const meta = getMoodMeta(liveParsed.mood);
      if (meta) chips.push({ key: 'm', icon: Smile, label: meta.label });
    }
    if (liveParsed.diary) {
      chips.push({ key: 'd', icon: BookOpen, label: '日记片段' });
    }
    return chips;
  }, [liveParsed]);

  const speechSupported = getSpeechRecognitionConstructor() !== null;

  const updateText = (next: string) => {
    touched.current = true;
    setText(next);
    if (inputKeyRef.current) void setSetting(inputKeyRef.current, next).catch(() => setSpeechError('草稿暂未写入，请勿关闭页面'));
  };

  const autoResize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const handleGoBack = () => {
    if (location.key === 'default') {
      navigate('/');
    } else {
      navigate(-1);
    }
  };

  const ensureRecognition = (): SpeechRecognitionLike | null => {
    if (recognitionRef.current) return recognitionRef.current;

    const RecognitionFactory = getSpeechRecognitionConstructor();
    if (!RecognitionFactory) return null;

    const recognition = new RecognitionFactory();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) {
          finalChunk += event.results[i][0].transcript;
        }
      }
      if (finalChunk) {
        setText((current) => {
          const merged = `${current}${current && !current.endsWith(' ') ? '' : ''}${finalChunk}`.slice(0, MAX_NOTE_LENGTH);
          if (inputKeyRef.current) void setSetting(inputKeyRef.current, merged.trim()).catch(() => setSpeechError('草稿暂未写入，请勿关闭页面'));
          return merged.trim();
        });
      }
    };
    recognition.onerror = (event) => {
      setSpeechError(event.error ? `语音识别失败：${event.error}` : '语音识别失败，请稍后重试');
      setIsRecording(false);
    };
    recognition.onend = () => setIsRecording(false);

    recognitionRef.current = recognition;
    return recognition;
  };

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting.current || !inputKey) return;
    submitting.current = true;
    recognitionRef.current?.stop();
    try {
      const draft = { id: generateLocalId(), input: trimmed, inputKey, ...parseQuickNote(trimmed) };
      await saveCaptureDraft(draft, true);
      sessionStorage.setItem(captureSessionKey(), draft.id);
      navigate('/quick-note/result', { state: { draftId: draft.id } });
    } catch { setSpeechError('确认稿保存失败，输入仍在，请检查设备存储后重试'); }
    finally { submitting.current = false; }
  };

  const toggleRecording = () => {
    const recognition = ensureRecognition();
    if (!recognition) {
      setSpeechError('当前浏览器不支持语音识别，请改用文本输入');
      return;
    }

    setSpeechError('');
    if (isRecording) {
      try {
        recognition.stop();
      } catch {
        // already stopped
      }
      setIsRecording(false);
      return;
    }

    try {
      recognition.start();
      setIsRecording(true);
    } catch {
      setSpeechError('麦克风启动失败，请检查浏览器权限');
      setIsRecording(false);
    }
  };

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 320 }}
      className="fixed inset-0 flex flex-col bg-[var(--bg)]"
      style={{ zIndex: 'var(--z-page-overlay)' }}
      role="dialog"
      aria-label="语音速记"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={handleGoBack}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text-2)] transition-colors hover:bg-[var(--border)]"
          aria-label="返回"
        >
          <ArrowLeft size={18} aria-hidden />
        </button>
        <h1 className="text-[15px] font-bold text-[var(--text-1)]">语音速记</h1>
      </div>

      <div className="mx-4 mb-4 flex rounded-full bg-[var(--surface-2)] p-1" role="tablist" aria-label="输入方式">
        <button
          type="button"
          onClick={() => setMode('text')}
          role="tab"
          aria-selected={mode === 'text'}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-sm font-semibold transition-all duration-200 ${
            mode === 'text'
              ? 'bg-[var(--surface)] text-[var(--text-1)] shadow-[var(--shadow-xs)]'
              : 'text-[var(--text-3)]'
          }`}
        >
          <Keyboard size={16} aria-hidden />
          文本输入
        </button>
        <button
          type="button"
          onClick={() => setMode('voice')}
          role="tab"
          aria-selected={mode === 'voice'}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-sm font-semibold transition-all duration-200 ${
            mode === 'voice'
              ? 'bg-[var(--surface)] text-[var(--text-1)] shadow-[var(--shadow-xs)]'
              : 'text-[var(--text-3)]'
          }`}
        >
          <Mic size={16} aria-hidden />
          语音输入
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4">
        {mode === 'text' ? (
          <div>
            <textarea
              ref={textAreaRef}
              value={text}
            disabled={!inputKey}
              onChange={(e) => {
                updateText(e.target.value.slice(0, MAX_NOTE_LENGTH));
                autoResize(e.target);
              }}
              placeholder="今天发生了什么？先记录，按规则整理后由你确认..."
              maxLength={MAX_NOTE_LENGTH}
              aria-label="速记内容"
              className="w-full resize-none rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-5 text-[15px] font-medium leading-relaxed text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)]"
              rows={6}
              autoFocus
            />
            {previewChips.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-2.5 flex flex-wrap items-center gap-1.5"
                aria-label="实时识别结果"
              >
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[var(--primary)]">
                  <Sparkles size={11} aria-hidden />
                  将记录
                </span>
                {previewChips.map((chip) => {
                  const Icon = chip.icon;
                  return (
                    <span key={chip.key} className="flex max-w-[180px] items-center gap-1 rounded-full bg-[var(--primary-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--primary)]">
                      <Icon size={11} className="shrink-0" aria-hidden />
                      <span className="truncate">{chip.label}</span>
                    </span>
                  );
                })}
              </motion.div>
            )}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-12"
          >
            <motion.button
              type="button"
              onClick={toggleRecording}
              disabled={!speechSupported}
              whileTap={{ scale: 0.95 }}
              aria-pressed={isRecording}
              aria-label={isRecording ? '结束录音' : '开始录音'}
              className={`mb-4 flex h-28 w-28 items-center justify-center rounded-full shadow-[var(--shadow-glow)] transition-all ${
                isRecording
                  ? 'bg-gradient-to-r from-[var(--danger)] to-[#FF6B8A] text-white'
                  : 'bg-gradient-to-br from-[var(--primary)] to-[var(--primary-light)] text-white'
              } ${!speechSupported ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              {isRecording ? <Square size={32} aria-hidden /> : <Mic size={32} aria-hidden />}
            </motion.button>
            <p className="text-sm font-medium text-[var(--text-3)]">
              {speechSupported
                ? isRecording
                  ? '正在录音，点击结束并生成文字'
                  : '点击开始语音输入，识别结果会自动写入下方'
                : '当前浏览器不支持语音识别，请改用文本输入'}
            </p>
            {speechError && (
              <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--danger)]/8 px-3 py-2 text-xs font-medium text-[var(--danger)]" role="alert">
                <AlertCircle size={14} aria-hidden />
                {speechError}
              </div>
            )}
            <textarea
              ref={voiceAreaRef}
              value={text}
            disabled={!inputKey}
              onChange={(e) => updateText(e.target.value.slice(0, MAX_NOTE_LENGTH))}
              placeholder="识别结果会显示在这里，你也可以继续手动修改..."
              maxLength={MAX_NOTE_LENGTH}
              aria-label="识别结果编辑"
              className="mt-6 w-full resize-none rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-5 text-[15px] font-medium leading-relaxed text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)]"
              rows={6}
            />
          </motion.div>
        )}
      </div>

      <div className="border-t border-[var(--border-light)] p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        {draftRestored && <p className="mb-2 text-center text-xs text-[var(--text-3)]">已恢复当前账号的本地草稿</p>}
        <Button
          onClick={handleSubmit}
          disabled={!text.trim() || !inputKey}
          className="h-12 w-full text-[15px]"
        >
          查看确认稿
        </Button>
      </div>
    </motion.div>
  );
}
