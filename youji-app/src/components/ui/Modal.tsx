import { useEffect, useId, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useMediaQuery } from '../../hooks/useMediaQuery';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openModalCount = 0;
let prevBodyOverflow = '';
const modalStack: symbol[] = [];

export function Modal({ open, onClose, title, children, footer, className = '' }: ModalProps) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const stackSymbol = useRef(Symbol('modal'));

  useEffect(() => {
    if (!open) return;

    const self = stackSymbol.current;
    openModalCount += 1;
    modalStack.push(self);
    if (openModalCount === 1) {
      prevBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusTarget = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusTarget ?? panel)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== self) return;

      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      openModalCount -= 1;
      const stackIndex = modalStack.indexOf(self);
      if (stackIndex !== -1) modalStack.splice(stackIndex, 1);
      if (openModalCount === 0) {
        document.body.style.overflow = prevBodyOverflow;
        prevBodyOverflow = '';
      }
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 flex items-end justify-center sm:items-center"
          style={{ zIndex: 'var(--z-modal)' }}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50 backdrop-blur-md"
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
            initial={isMobile ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 8 }}
            animate={isMobile ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={isMobile ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className={`relative z-10 w-full bg-[var(--surface)] shadow-[var(--shadow-xl)] outline-none ${isMobile ? 'max-h-[85vh] overflow-y-auto rounded-t-[var(--radius-xl)] pb-[env(safe-area-inset-bottom)]' : 'mx-4 max-w-lg rounded-[var(--radius-xl)]'} ${className}`}
          >
            {isMobile && (
              <div className="flex justify-center pb-1 pt-3">
                <div className="h-1.5 w-12 rounded-full bg-[var(--border)]" aria-hidden />
              </div>
            )}
            {title && (
              <div className="flex items-center justify-between border-b border-[var(--border-light)] px-5 py-4 sm:px-7 sm:py-6">
                <h3 id={titleId} className="text-base font-bold text-[var(--text-1)]">{title}</h3>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="关闭"
                  className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)]"
                >
                  <X size={18} aria-hidden />
                </button>
              </div>
            )}
            <div className="px-5 py-4 sm:px-7 sm:py-6">{children}</div>
            {footer && (
              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--border-light)] px-5 py-4 sm:px-7 sm:py-6">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
