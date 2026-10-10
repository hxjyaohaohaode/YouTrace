import { readAIConfiguration, type AIConnection, type ServerAIConfiguration } from '../services/userAI';
import { useAuthStore } from '../stores/authStore';
import { getSessionGeneration, getVerifiedSessionOwner } from '../services/apiClient';
import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { useReducedMotion } from 'framer-motion';
import { ArrowLeft, Trash2, Target, Phone } from 'lucide-react';
import { useCoachStore } from '../stores/coachStore';
import { MessageList } from '../components/coach/MessageList';
import { ChatInput } from '../components/coach/ChatInput';
import type { ChatInputHandle } from '../components/coach/ChatInput';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { assessEmotionState, detectCrisisKeywords, getCrisisResponse } from '../services/emotionEngine';
import { mainlandPsychologicalSupport } from '../../server/src/services/safetyResources';
import { getRecordCoverageWelcome, subscribeRecordCoverage } from '../services/coldStartStrategy';

import { Brand } from '../components/ui/Brand';
import '../styles/home-coach.css';

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

  const owner = useAuthStore(state => state.user?.id ?? '');
  const sessionGeneration = getSessionGeneration();
  const [modelState, setModelState] = useState<{ owner: string; generation: number; connection: AIConnection | null; serverAI: ServerAIConfiguration | null; ready: boolean; failed: boolean } | null>(null);
  const [modelChoice, setModelChoice] = useState<{ owner: string; generation: number; connectionId: string; enabled: boolean } | null>(null);
  const [serverChoice, setServerChoice] = useState<{ owner: string; generation: number; configurationId: string; enabled: boolean } | null>(null);
  const currentServerAI = modelState?.owner === owner && modelState.generation === getSessionGeneration() ? modelState.serverAI : null;
  const currentModel = modelState?.owner === owner && modelState.generation === getSessionGeneration() && modelState.ready ? modelState.connection : null;
  const useModel = modelChoice?.owner === owner && modelChoice.generation === getSessionGeneration() && modelChoice.connectionId === currentModel?.connectionId && modelChoice.enabled;
  const useServerAI = !useModel && serverChoice?.owner === owner && serverChoice.generation === getSessionGeneration() && serverChoice.configurationId === currentServerAI?.configurationId && serverChoice.enabled;
  useEffect(() => {
    let live = true;
    const generation = getSessionGeneration();
    if (owner) void readAIConfiguration().then(config => {
      if (live && getVerifiedSessionOwner() === owner && getSessionGeneration() === generation) setModelState({ owner, generation, connection: config.connection, serverAI: config.serverAI ?? null, ready: config.credentialStorageReady, failed: false });
    }).catch(() => { if (live) setModelState({ owner, generation, connection: null, serverAI: null, ready: false, failed: true }); });
    return () => { live = false; };
  }, [owner]);

  const location = useLocation();
  const prefill = (location.state as { prefill?: unknown } | null)?.prefill;
  const prefillText = typeof prefill === 'string' ? prefill : '';
  const prefillKey = prefillText.length;
  const [confirmClear, setConfirmClear] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<ChatInputHandle>(null);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const reducedMotion = useReducedMotion();

  const emotionState = assessEmotionState();
  const getFailedMessageText = useCallback((messageId: string) => {
    const message = useCoachStore.getState().messages.find((item) => item.id === messageId);
    return message?.role === 'user' && message.replyFailed ? message.content : undefined;
  }, []);

  useEffect(() => {
    if (followingRef.current && (messages.length > 0 || isTyping)) containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'auto' });
  }, [messages, isTyping]);

  const handleSend = useCallback(
    async (text: string) => {
      // A callback from the previous account must not submit under new cookies.
      if (owner !== getVerifiedSessionOwner() || sessionGeneration !== getSessionGeneration()) return;
      if (isTyping || !text.trim()) return;
      followingRef.current = true; setFollowing(true);

      if (detectCrisisKeywords(text)) {
        addMessage({ role: 'user', content: text });
        addMessage({ role: 'assistant', content: getCrisisResponse() });
        return;
      }

      await sendMessage(text, useModel && currentModel?.chatConsent ? { connectionId: currentModel.connectionId, version: currentModel.version } : undefined, useServerAI && currentServerAI ? { configurationId: currentServerAI.configurationId, consent: true } : undefined);
    },
    [owner, sessionGeneration, isTyping, addMessage, sendMessage, useModel, currentModel, useServerAI, currentServerAI]
  );

  const recordWelcome = useSyncExternalStore(subscribeRecordCoverage, getRecordCoverageWelcome, getRecordCoverageWelcome);
  const hasMessages = messages.length > 0;

  return (
    <div
      className="coach-page flex h-full min-h-0 flex-col bg-[var(--bg)]"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--bg)] px-4 py-4">
        <div className="flex items-center gap-3">
          {isMobile && (
            <button
              type="button"
              onClick={() => navigate('/')}
              className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)]"
              aria-label="返回首页"
            >
              <ArrowLeft size={18} aria-hidden />
            </button>
          )}
          <div className="flex items-center gap-2.5">
            <Brand variant="mark" className="coach-header-brand" />
            <div>
              <h1 className="text-lg font-bold text-[var(--text-1)]">生活教练</h1>
              <p className="text-xs font-medium text-[var(--text-3)]">
                {isTyping ? '正在思考...' : emotionState.shouldShowHotline ? '如需即时支持，可拨打热线' : '从你的问题和记录出发'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {emotionState.shouldShowHotline && (
            <a
              href={mainlandPsychologicalSupport.tel}
              className="flex h-9 items-center gap-1 rounded-full bg-[var(--danger)]/8 px-3.5 text-xs font-semibold text-[var(--danger)]"
              aria-label={`拨打${mainlandPsychologicalSupport.region}心理援助热线 ${mainlandPsychologicalSupport.phone}`}
              title={`${mainlandPsychologicalSupport.availability}；来源：国家卫生健康委，核验于 ${mainlandPsychologicalSupport.verifiedAt}`}
            >
              <Phone size={12} aria-hidden />
              {mainlandPsychologicalSupport.phone}
            </a>
          )}
          <button
            type="button"
            onClick={() => navigate('/insights')}
            className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--primary)]"
            aria-label="教练洞察"
          >
            <Target size={16} aria-hidden />
          </button>
          {hasMessages && (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--danger)]"
              aria-label="清空对话"
            >
              <Trash2 size={16} aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="shrink-0 border-b border-[var(--border)] px-4 py-2 text-xs leading-5">
        {currentModel?.chatConsent ? <label className="flex items-start gap-2"><input type="checkbox" aria-label="本次页面使用我的模型" checked={useModel} disabled={isTyping} onChange={event => { setServerChoice(null); setModelChoice({ owner, generation: getSessionGeneration(), connectionId: currentModel.connectionId, enabled: event.target.checked }); }} /><span>使用我的 {currentModel.providerName} · {currentModel.model}。发送本次文字与当前会话中已披露范围的有限历史，不附加应用记录。可能产生 API 费用。</span></label> : <p>{modelState?.failed ? '暂未读到模型设置。当前仅使用本地规则回复。' : useServerAI ? '本页已选择部署者提供的基础模型。' : '当前使用本地规则回复，未调用外部模型。'}</p>}
        {currentServerAI && <label className="flex items-start gap-2"><input type="checkbox" aria-label="本次页面使用部署者的基础模型" checked={Boolean(useServerAI)} disabled={isTyping} onChange={event => { setModelChoice(null); setServerChoice({ owner, generation: getSessionGeneration(), configurationId: currentServerAI.configurationId, enabled: event.target.checked }); }} /><span className="min-w-0 break-words">同意使用部署者提供的基础模型 {currentServerAI.model}，将本次文字与当前会话的有限文字历史发送至 {currentServerAI.endpoint}，不附加应用记录。API 用量由部署者承担；仅文字建议，不执行操作。本页默认关闭。</span></label>}
        <button type="button" className="underline" onClick={() => navigate('/settings')}>管理我的 AI 连接与外发许可</button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto" onScroll={() => {
        const el = containerRef.current;
        if (!el) return;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
        followingRef.current = nearBottom; setFollowing(nearBottom);
      }}>
        {!hasMessages ? (
          <div className="coach-welcome">
            <p className="editorial-eyebrow">有迹 · AI 教练</p>
            <h2>从一件具体的事聊起。</h2>
            <p>{recordWelcome}</p>
            <div className="coach-starters" aria-label="开始一段对话">
              {quickQuestions.map(q => <button key={q} type="button" aria-label={q} onClick={() => void handleSend(q)}>{q} <span aria-hidden>↗</span></button>)}
            </div>
            <p className="coach-boundary">默认使用本地规则回复。只有你明确选择并同意模型来源后，才会发送本次文字与当前会话中已披露范围的有限历史，不附加应用记录。模型不会自动变更记录；操作建议须先核对，再由你主动点击执行。调用可能产生 API 费用。</p>
            <button type="button" onClick={() => navigate('/insights')} className="mt-4 min-h-11 text-sm text-[var(--link)] underline">先查看可核对的记录依据</button>
          </div>
        ) : (
          <MessageList messages={messages} onExecuteActions={executeActions} onExecuteSmartAction={executeSmartAction} onEditMessage={(messageId) => inputRef.current?.editMessage(messageId)} isTyping={isTyping} />
        )}
      </div>

      {!following && <button type="button" className="self-center rounded-full bg-[var(--primary-soft)] px-4 py-2 text-xs text-[var(--text-1)]" onClick={() => {
        followingRef.current = true; setFollowing(true);
        containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' });
      }}>回到最新消息</button>}
      <ChatInput
        key={prefillKey}
        ref={inputRef}
        initialText={prefillText}
        getFailedMessageText={getFailedMessageText}
        onSend={(text) => void handleSend(text)}
        disabled={isTyping}
      />

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="清空本页对话"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>取消</Button>
            <Button variant="danger" size="sm" onClick={() => { clearHistory(); setConfirmClear(false); }}>
              清空
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-1)]">清空本页消息并开始新对话，会停止接收当前回复；不会删除服务端已经保存的对话记录。</p>
      </Modal>
    </div>
  );
}
