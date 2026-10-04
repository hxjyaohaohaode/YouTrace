import { useLocation } from 'react-router-dom';
import { useEffect, useLayoutEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { CheckCircle, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { dismissToast, dismissTransientToasts, getToastSnapshot, subscribeToToasts } from '../../services/toastBus';

export type ToastType = 'success' | 'warning' | 'error' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

const iconMap: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
  info: Info,
};

const colorMap: Record<ToastType, { gradientFrom: string; border: string }> = {
  success: { gradientFrom: 'from-[var(--success)] to-[var(--success)]/70', border: 'border-[var(--success)]/20' },
  warning: { gradientFrom: 'from-[var(--warning)] to-[var(--warning)]/70', border: 'border-[var(--warning)]/20' },
  error: { gradientFrom: 'from-[var(--danger)] to-[var(--danger)]/70', border: 'border-[var(--danger)]/20' },
  info: { gradientFrom: 'from-[var(--primary)] to-[var(--primary-light)]', border: 'border-[var(--primary)]/20' },
};

const AUTO_DISMISS_MS = 3800;

function ToastCard({ item }: { item: ToastItem }) {
  const reduced = useReducedMotion();
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [item.id]);

  const Icon = iconMap[item.type];
  const colors = colorMap[item.type];

  return (
    <motion.div
      layout={!reduced}
      initial={reduced ? { opacity: 1 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduced ? 0 : 6 }}
      transition={{ duration: reduced ? 0 : 0.16 }}
      className={`pointer-events-none flex w-80 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-[var(--radius-lg)] border ${colors.border} bg-[var(--surface)] p-4 shadow-[var(--shadow-lg)] backdrop-blur-sm`}
    >
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${colors.gradientFrom}`}>
        <Icon size={16} className="text-white" aria-hidden />
      </div>
      <span className="flex-1 pt-1 text-sm text-[var(--text-1)]">{item.message}</span>
      <button
        type="button"
        onClick={() => dismissToast(item.id)}
        aria-label="关闭提示"
        className="pointer-events-auto -mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-[var(--text-3)] hover:text-[var(--text-1)] focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
      >
        <X size={16} aria-hidden />
      </button>
    </motion.div>
  );
}

export function ToastHost() {
  const location = useLocation();
  const [toasts, setToasts] = useState<ToastItem[]>(getToastSnapshot());

  useLayoutEffect(() => subscribeToToasts(setToasts), []);
  useLayoutEffect(() => { dismissTransientToasts(); }, [location.key]);

  return (
    <div
      className="pointer-events-none fixed bottom-24 right-4 flex flex-col gap-2 sm:bottom-6"
      style={{ zIndex: 'var(--z-toast)' }}
      role="region"
      aria-label="通知"
    >
      <div aria-live="polite" aria-atomic="false" className="contents">
        <AnimatePresence mode="popLayout">
          {toasts.map((item) => (
            <ToastCard key={item.id} item={item} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
