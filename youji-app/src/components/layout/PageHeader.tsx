import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  icon: LucideIcon;
  gradient: string;
  title: string;
  subtitle?: string;
  wrapSubtitle?: boolean;
  actions?: ReactNode;
}

export function PageHeader({ icon: Icon, title, subtitle, wrapSubtitle = false, actions }: PageHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] pb-6"
    >
      <div className="flex min-w-0 items-center gap-3 sm:gap-3.5">
        <div className="page-heading-icon"><Icon size={22} aria-hidden /></div>
        <div className="min-w-0">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-[var(--text-1)]">{title}</h1>
          {subtitle && (
            <p className={`mt-0.5 ${wrapSubtitle ? 'whitespace-normal break-words' : 'truncate'} text-sm font-medium text-[var(--text-3)]`}>{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </motion.div>
  );
}
