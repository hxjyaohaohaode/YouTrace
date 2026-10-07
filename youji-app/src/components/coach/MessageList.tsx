import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Square, Zap } from 'lucide-react';
import type { CoachMessage, CoachAction } from '../../stores/coachStore';

interface MessageListProps {
  messages: CoachMessage[];
  onExecuteActions: (messageId: string, actionIds: string[]) => void;
  onExecuteSmartAction: (messageId: string, actionId: string) => Promise<void>;
  onEditMessage: (messageId: string) => void;
  isTyping?: boolean;
}

function ActionItem({
  action,
  messageId,
  onExecute,
}: {
  action: CoachAction;
  messageId: string;
  onExecute: (messageId: string, actionIds: string[]) => void;
}) {
  const handleToggle = () => {
    if (!action.executed) {
      onExecute(messageId, [action.id]);
    }
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={action.executed}
      aria-pressed={action.executed}
      className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-left transition-colors hover:bg-[var(--surface-2)] disabled:cursor-default disabled:hover:bg-transparent"
    >
      {action.executed ? (
        <Check size={16} className="shrink-0 text-[var(--success)]" aria-hidden />
      ) : (
        <Square size={16} className="shrink-0 text-[var(--text-3)]" aria-hidden />
      )}
      <span className={`text-[13px] font-medium ${action.executed ? 'text-[var(--text-3)] line-through' : 'text-[var(--text-1)]'}`}>
        {action.title}
      </span>
      {action.level === 3 && !action.executed && (
        <span className="ml-auto shrink-0 rounded-full bg-[var(--danger)]/8 px-2 py-0.5 text-[10px] font-bold text-[var(--danger)]">
          重要
        </span>
      )}
    </button>
  );
}

function SmartActionItem({
  action,
  messageId,
  onExecute,
}: {
  action: CoachAction;
  messageId: string;
  onExecute: (messageId: string, actionId: string) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const execute = async () => {
    if (pending || action.executed) return;
    setPending(true);
    try { await onExecute(messageId, action.id); }
    finally { setPending(false); }
  };
  return (
    <button
      type="button"
      onClick={() => void execute()}
      disabled={action.executed || pending}
      aria-busy={pending}
      aria-label={`执行：${action.title}`}
      className={`flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] border px-3 py-2.5 text-left transition-all ${
        action.executed
          ? 'border-transparent bg-[var(--surface-2)] opacity-60'
          : 'border-[var(--primary)]/25 bg-gradient-to-r from-[var(--primary-soft)] to-transparent hover:border-[var(--primary)]/45 hover:shadow-[var(--shadow-xs)] active:scale-[0.99]'
      }`}
    >
      {action.executed ? (
        <Check size={15} className="shrink-0 text-[var(--success)]" aria-hidden />
      ) : (
        <Zap size={15} className="shrink-0 text-[var(--primary)]" aria-hidden />
      )}
      <span className={`min-w-0 flex-1 truncate text-[13px] font-semibold ${action.executed ? 'text-[var(--text-3)]' : 'text-[var(--primary)]'}`}>
        {action.title}
      </span>
      {!action.executed && (
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-[var(--text-4)]">
          {pending ? '处理中…' : '点击执行'}
        </span>
      )}
    </button>
  );
}

function AssistantMessage({
  message,
  onExecuteActions,
  onExecuteSmartAction,
  streaming,
}: {
  message: CoachMessage;
  onExecuteActions: (messageId: string, actionIds: string[]) => void;
  onExecuteSmartAction: (messageId: string, actionId: string) => Promise<void>;
  streaming: boolean;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 px-4 py-3"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-light)] shadow-[var(--shadow-glow)]">
        <span className="text-xs text-white">AI</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl rounded-tl-sm bg-gradient-to-br from-[var(--primary-soft)] to-[var(--primary-muted)] px-4 py-3">
          <div className="whitespace-pre-wrap break-words text-[13px] font-medium leading-relaxed text-[var(--text-1)]">
            {message.content}
            {streaming && (
              <motion.span
                animate={{ opacity: reducedMotion ? 1 : [1, 0] }}
                transition={reducedMotion ? { duration: 0 } : { duration: 0.6, repeat: Infinity }}
                className="ml-0.5 inline-block h-4 w-0.5 bg-[var(--primary)] align-text-bottom"
                aria-hidden
              />
            )}
          </div>
        </div>

        {message.actions && message.actions.length > 0 && !streaming && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-2 space-y-1.5"
          >
            {message.actions.some((a) => a.type === 'smart') && (
              <p className="px-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">快捷操作：</p>
            )}
            <div className="space-y-1.5">
              {message.actions.map((action) =>
                action.type === 'smart' ? (
                  <SmartActionItem
                    key={action.id}
                    action={action}
                    messageId={message.id}
                    onExecute={onExecuteSmartAction}
                  />
                ) : (
                  <ActionItem
                    key={action.id}
                    action={action}
                    messageId={message.id}
                    onExecute={onExecuteActions}
                  />
                )
              )}
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function UserMessage({ message, onEditMessage, disabled }: {
  message: CoachMessage;
  onEditMessage: (messageId: string) => void;
  disabled: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex justify-end px-4 py-3"
    >
      <div className="max-w-[80%]">
        <div className="rounded-2xl rounded-tr-sm bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] px-4 py-3 text-white shadow-[var(--shadow-glow)]">
          <p className="whitespace-pre-wrap break-words text-[13px] font-medium leading-relaxed">{message.content}</p>
        </div>
        {message.replyFailed && (
          <div className="mt-2 flex flex-col items-end gap-1">
            <span role="status" className="text-xs font-medium text-[var(--danger)]">回复未完成</span>
            <button
              type="button"
              onClick={() => onEditMessage(message.id)}
              disabled={disabled}
              className="min-h-11 rounded-full border border-[var(--primary)]/25 bg-[var(--primary-soft)] px-3 py-2 text-[13px] font-semibold text-[var(--primary)] transition-colors hover:bg-[var(--primary-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-40"
            >
              重新编辑这条消息
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function TypingIndicator() {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 px-4 py-3"
      aria-label="教练正在输入"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-light)] shadow-[var(--shadow-glow)]">
        <span className="text-xs text-white">AI</span>
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-gradient-to-br from-[var(--primary-soft)] to-[var(--primary-muted)] px-4 py-3">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{ y: reducedMotion ? 0 : [0, -4, 0], opacity: reducedMotion ? 1 : [0.5, 1, 0.5] }}
              transition={reducedMotion ? { duration: 0 } : { duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
              className="h-[6px] w-[6px] rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)]"
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

export function MessageList({ messages, onExecuteActions, onExecuteSmartAction, onEditMessage, isTyping }: MessageListProps) {
  return (
    <div className="py-4">
      {messages.map((message, index) => {
        if (message.role === 'system') return null;

        const isLatest = index === messages.length - 1;

        return message.role === 'assistant' ? (
          <AssistantMessage
            key={message.id}
            message={message}
            onExecuteActions={onExecuteActions}
            onExecuteSmartAction={onExecuteSmartAction}
            streaming={isLatest && isTyping === true}
          />
        ) : (
          <UserMessage key={message.id} message={message} onEditMessage={onEditMessage} disabled={isTyping === true} />
        );
      })}
      {isTyping && messages.at(-1)?.role !== 'assistant' && <TypingIndicator />}
    </div>
  );
}
