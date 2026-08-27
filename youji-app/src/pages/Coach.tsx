import { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Trash2, Sparkles, Target, Phone } from 'lucide-react';
import { useCoachStore } from '../stores/coachStore';
import { MessageList } from '../components/coach/MessageList';
import { ChatInput } from '../components/coach/ChatInput';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { assessEmotionState, detectCrisisKeywords, getCrisisResponse, getCompanionResponse } from '../services/emotionEngine';
import { getColdStartStateSync, getWelcomeForPhase } from '../services/coldStartStrategy';

const quickQuestions = [
  '帮我看看这周的花销',
  '今天习惯完成得怎么样？',
  '我最近的状态如何？',
  '帮我安排明天的重点',
];

export default function Coach() {
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const messages = useCoachStore((s) => s.messages);
  const isTyping = useCoachStore((s) => s.isTyping);
  const addMessage = useCoachStore((s) => s.addMessage);
  const sendMessage = useCoachStore((s) => s.sendMessage);
  const executeActions = useCoachStore((s) => s.executeActions);
  const executeSmartAction = useCoachStore((s) => s.executeSmartAction);
  const clearHistory = useCoachStore((s) => s.clearHistory);

  const location = useLocation();
  const prefill = (location.state as { prefill?: unknown } | null)?.prefill;
  const prefillText = typeof prefill === 'string' ? prefill : '';
  const prefillKey = prefillText.length;
  const [confirmClear, setConfirmClear] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const emotionState = assessEmotionState();

  useEffect(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = useCallback(
    async (text: string) => {
      if (isTyping || !text.trim()) return;

      if (detectCrisisKeywords(text)) {
        addMessage({ role: 'user', content: text });
        addMessage({ role: 'assistant', content: getCrisisResponse() });
        return;
      }

      const emotion = assessEmotionState();
      if (emotion.shouldOnlyCompanion && emotion.state === 'crisis') {
        addMessage({ role: 'user', content: text });
        addMessage({ role: 'assistant', content: getCompanionResponse() });
        return;
      }

      await sendMessage(text);
    },
    [isTyping, addMessage, sendMessage]
  );

  const hasMessages = messages.length > 0;

  return (
    <div
      className="flex h-[calc(100dvh-4rem)] flex-col bg-[var(--bg)] sm:h-[calc(100vh-1px)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-center justify-between border-b border-[var(--glass-border)] bg-[var(--glass-bg)]/80 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          {isMobile && (
            <button
              type="button"
              onClick={() => navigate('/')}
              className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)]"
              aria-label="返回首页"
            >
              <ArrowLeft size={18} aria-hidden />
            </button>
          )}
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-light)] shadow-[var(--shadow-glow)]">
              <Sparkles size={18} className="text-white" aria-hidden />
            </div>
            <div>
              <h1 className="text-[15px] font-bold text-[var(--text-1)]">AI 教练</h1>
              <p className="text-[11px] font-medium text-[var(--text-3)]">
                {isTyping ? '正在思考...' : emotionState.shouldShowHotline ? '在线 · 如需帮助请拨打热线' : '在线'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {emotionState.shouldShowHotline && (
            <a
              href="tel:4001619995"
              className="flex h-9 items-center gap-1 rounded-full bg-[var(--danger)]/8 px-3.5 text-xs font-semibold text-[var(--danger)]"
              aria-label="拨打心理援助热线"
            >
              <Phone size={12} aria-hidden />
              热线
            </a>
          )}
          <button
            type="button"
            onClick={() => navigate('/insights')}
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--primary)]"
            aria-label="教练洞察"
          >
            <Target size={16} aria-hidden />
          </button>
          {hasMessages && (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--danger)]"
              aria-label="清空对话"
            >
              <Trash2 size={16} aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-y-auto">
        {!hasMessages ? (
          <div className="flex flex-col items-center justify-center px-6 py-20">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-light)] shadow-[var(--shadow-glow)]"
            >
              <Sparkles size={36} className="text-white" aria-hidden />
            </motion.div>
            <motion.h2
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="mb-2 text-lg font-bold text-[var(--text-1)]"
            >
              AI 教练
            </motion.h2>
            <motion.p
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="mb-6 max-w-xs text-center text-sm leading-relaxed text-[var(--text-2)]"
            >
              {getWelcomeForPhase(getColdStartStateSync().phase)}
            </motion.p>

            <motion.div
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex w-full max-w-sm flex-col gap-2"
            >
              {quickQuestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void handleSend(q)}
                  className="rounded-[var(--radius-lg)] border border-[var(--primary)]/15 bg-gradient-to-r from-[var(--primary-soft)] to-[var(--primary-muted)] px-4 py-3 text-left text-sm font-medium text-[var(--text-1)] transition-all hover:border-[var(--primary)]/30 hover:shadow-[var(--shadow-xs)]"
                >
                  {q}
                </button>
              ))}
            </motion.div>
          </div>
        ) : (
          <MessageList messages={messages} onExecuteActions={executeActions} onExecuteSmartAction={executeSmartAction} isTyping={isTyping} />
        )}
      </div>

      <ChatInput
        key={prefillKey}
        initialText={prefillText}
        onSend={(text) => void handleSend(text)}
        disabled={isTyping}
      />

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="清空对话"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>取消</Button>
            <Button variant="danger" size="sm" onClick={() => { clearHistory(); setConfirmClear(false); }}>
              清空
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-1)]">确定要清空当前对话吗？清空后无法恢复。</p>
      </Modal>
    </div>
  );
}
