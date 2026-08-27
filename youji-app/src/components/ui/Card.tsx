import { motion } from 'framer-motion';

export type CardVariant = 'default' | 'glass' | 'gradient' | 'elevated';

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  animate?: boolean;
  delay?: number;
  hoverable?: boolean;
  onClick?: () => void;
  variant?: CardVariant;
}

const variantStyles: Record<CardVariant, string> = {
  default: 'bg-[var(--surface)] border border-[var(--border-light)] shadow-[var(--shadow-sm)]',
  glass: 'bg-[var(--glass-bg)] backdrop-blur-xl border border-[var(--glass-border)] shadow-[var(--glass-shadow)]',
  gradient: 'bg-gradient-to-br from-[var(--primary)] to-[var(--primary-light)] text-white shadow-[var(--shadow-glow)]',
  elevated: 'bg-[var(--surface)] shadow-[var(--shadow-lg)] border border-[var(--border-light)]',
};

export function Card({ children, className = '', animate = true, delay = 0, hoverable = false, onClick, variant = 'default' }: CardProps) {
  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-[var(--radius-lg)] transition-all duration-200 ${variantStyles[variant]} ${hoverable ? 'hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] cursor-pointer active:scale-[0.99]' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
}
