import { useId } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function Checkbox({ checked, onChange, label, disabled = false, className = '', ariaLabel }: CheckboxProps) {
  const inputId = useId();

  return (
    <label
      htmlFor={inputId}
      className={`
        relative inline-flex min-h-11 min-w-11 select-none items-center justify-center gap-2.5
        ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}
        ${className}
      `}
    >
      <input
        id={inputId}
        type="checkbox"
        role="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel ?? label}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
      />
      <span
        aria-hidden
        className={`
          pointer-events-none flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border-[1.5px] transition-all duration-200
          peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--primary)]/40 peer-focus-visible:ring-offset-1
          ${checked
            ? 'border-transparent bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)]'
            : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--primary)]/40'
          }
        `}
      >
        <motion.span
          initial={false}
          animate={checked ? { scale: 1, opacity: 1 } : { scale: 0.5, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        >
          <Check size={11} className="text-white" strokeWidth={3} />
        </motion.span>
      </span>
      {label && (
        <span className="cursor-pointer text-sm text-[var(--text-1)]">
          {label}
        </span>
      )}
    </label>
  );
}
