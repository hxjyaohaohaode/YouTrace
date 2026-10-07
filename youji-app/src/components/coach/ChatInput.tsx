import { useState, useRef, useEffect, useImperativeHandle, useCallback } from 'react';
import type { Ref } from 'react';
import { motion } from 'framer-motion';
import { Send } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

export interface ChatInputHandle {
  editMessage: (messageId: string) => void;
}

interface ChatInputProps {
  ref?: Ref<ChatInputHandle>;
  onSend: (text: string) => void;
  getFailedMessageText: (messageId: string) => string | undefined;
  disabled?: boolean;
  initialText?: string;
}

const MAX_TEXT_LENGTH = 2000;

export function ChatInput({ ref, onSend, getFailedMessageText, disabled = false, initialText = '' }: ChatInputProps) {
  const [text, setText] = useState(initialText);
  const [replacement, setReplacement] = useState<{ messageId: string; text: string } | null>(null);
  const replacementRef = useRef<typeof replacement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const restoreText = useCallback((content: string) => {
    setText(content);
    textareaRef.current?.focus();
  }, []);

  useImperativeHandle(ref, () => ({
    editMessage(messageId) {
      const content = getFailedMessageText(messageId);
      if (disabled || content === undefined) return;
      const nextReplacement = text.length > 0 ? { messageId, text: content } : null;
      replacementRef.current = nextReplacement;
      setReplacement(nextReplacement);
      if (!nextReplacement) restoreText(content);
    },
  }), [disabled, getFailedMessageText, restoreText, text]);

  const replacementIsCurrent = replacement !== null && getFailedMessageText(replacement.messageId) === replacement.text;
  const dismissReplacement = () => {
    if (replacementRef.current !== replacement) return;
    replacementRef.current = null;
    setReplacement(null);
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value.slice(0, MAX_TEXT_LENGTH));
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [text]);

  return (
    <>
      <div className="shrink-0 border-t border-[var(--border-light)] bg-[var(--glass-bg)]/80 backdrop-blur-xl">
        <div className="flex items-end gap-2 px-4 py-3">
          <div className="relative flex flex-1 items-end">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={disabled}
              rows={1}
              aria-label="输入消息"
              maxLength={MAX_TEXT_LENGTH}
              placeholder="和 AI 教练聊聊..."
              className="w-full resize-none rounded-full border border-[var(--border-light)] bg-[var(--surface)] px-4 py-2.5 pr-10 text-[13px] font-medium leading-6 text-[var(--text-1)] outline-none transition-all duration-200 placeholder:text-[var(--text-3)] focus:border-[var(--primary)] focus:ring-[4px] focus:ring-[var(--primary)]/12 disabled:opacity-40"
              style={{ minHeight: '40px', maxHeight: '120px' }}
            />
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="button"
              onClick={handleSend}
              disabled={disabled || !text.trim()}
              aria-label="发送消息"
              className="absolute bottom-[5px] right-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] text-white shadow-[var(--shadow-glow)] transition-all disabled:opacity-30"
            >
              <Send size={14} aria-hidden />
            </motion.button>
          </div>
        </div>
      </div>
      <Modal
        open={replacementIsCurrent && !disabled}
        onClose={dismissReplacement}
        title="输入框里已有内容"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={dismissReplacement}>保留当前输入</Button>
            <Button size="sm" onClick={() => {
              if (!replacement || replacementRef.current !== replacement) return;
              dismissReplacement();
              if (!disabled && getFailedMessageText(replacement.messageId) === replacement.text) {
                restoreText(replacement.text);
              }
            }}>替换为这条消息</Button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-1)]">替换会覆盖当前输入，恢复这条回复未完成的原消息。恢复后可以继续编辑，点击发送才会再次提交。</p>
      </Modal>
    </>
  );
}
