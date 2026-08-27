import { forwardRef, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  className?: string;
  icon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', icon, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;

    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        {label && (
          <label htmlFor={inputId} className="text-[13px] font-semibold text-[var(--text-1)]">
            {label}
          </label>
        )}
        <div className="group relative">
          {icon && (
            <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-3)] transition-colors duration-200 group-focus-within:text-[var(--primary)]">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
            className={`
              h-12 w-full rounded-[var(--radius-md)] border bg-[var(--surface)] text-sm
              text-[var(--text-1)] outline-none transition-all duration-200
              placeholder:text-[var(--text-3)]
              focus:border-[var(--primary)] focus:ring-[4px] focus:ring-[var(--primary)]/12
              ${icon ? 'pl-11 pr-4' : 'px-4'}
              ${error ? 'border-[var(--danger)] shadow-[0_0_8px_rgba(217,64,82,0.15)] focus:border-[var(--danger)] focus:ring-[var(--danger)]/12' : 'border-[var(--border)]'}
              hover:border-[var(--primary)]/40
            `}
            {...props}
          />
        </div>
        <AnimatePresence>
          {error && (
            <motion.span
              id={`${inputId}-error`}
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="text-xs font-medium text-[var(--danger)]"
            >
              {error}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    );
  }
);

Input.displayName = 'Input';
