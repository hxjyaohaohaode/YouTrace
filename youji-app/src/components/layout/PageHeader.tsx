import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  icon: LucideIcon;
  gradient: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ icon: Icon, gradient, title, subtitle, actions }: PageHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="mb-6 flex items-center justify-between gap-3"
    >
      <div className="flex min-w-0 items-center gap-3 sm:gap-3.5">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br shadow-[var(--shadow-glow)] sm:h-12 sm:w-12 ${gradient}`}>
          <Icon size={20} className="text-white sm:hidden" aria-hidden />
          <Icon size={22} className="hidden text-white sm:block" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-extrabold tracking-tight text-[var(--text-1)] sm:text-2xl">{title}</h1>
          {subtitle && (
            <p className="mt-0.5 truncate text-[13px] font-medium text-[var(--text-3)]">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </motion.div>
  );
}
