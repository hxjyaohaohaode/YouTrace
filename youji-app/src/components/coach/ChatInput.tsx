import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Send } from 'lucide-react';

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  initialText?: string;
}

const MAX_TEXT_LENGTH = 2000;

export function ChatInput({ onSend, disabled = false, initialText = '' }: ChatInputProps) {
  const [text, setText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, []);

  return (
    <div className="border-t border-[var(--border-light)] bg-[var(--glass-bg)]/80 backdrop-blur-xl">
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
  );
}
