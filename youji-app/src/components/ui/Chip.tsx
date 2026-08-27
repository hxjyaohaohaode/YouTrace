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
        inline-flex items-center rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all duration-200
        ${active
          ? 'bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] text-white shadow-[var(--shadow-xs)]'
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
