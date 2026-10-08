import { motion } from 'framer-motion';

export interface ChipProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export function Chip({ label, active = false, onClick, disabled = false, className = '' }: ChipProps) {
  return (
    <motion.button
      whileTap={!disabled ? { scale: 0.95 } : undefined}
      onClick={onClick}
      disabled={disabled}
      className={`
        inline-flex min-h-11 items-center rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200
        ${active
          ? 'bg-[var(--primary-soft)] text-[var(--link)]'
          : 'bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--border)] hover:text-[var(--text-1)]'
        }
        ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}
        ${className}
      `}
    >
      {label}
    </motion.button>
  );
}
