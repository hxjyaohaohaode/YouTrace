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
  default: 'bg-[var(--surface)] border border-[var(--border-light)] ',
  glass: 'bg-[var(--glass-bg)]  border border-[var(--glass-border)] ',
  gradient: 'bg-[var(--primary-soft)] text-[var(--text-1)] border border-[var(--border)]',
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
