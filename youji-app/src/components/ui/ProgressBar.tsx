import { useId } from 'react';
import { motion } from 'framer-motion';

export type ProgressColor = 'green' | 'amber' | 'red';

export interface ProgressBarProps {
  value: number;
  max?: number;
  color?: ProgressColor;
  className?: string;
  showLabel?: boolean;
}

const colorStyles: Record<ProgressColor, string> = {
  green: 'bg-[var(--success)]',
  amber: 'bg-[var(--warning)]',
  red: 'bg-[var(--danger)]',
};

export function ProgressBar({
  value,
  max = 100,
  color = 'green',
  className = '',
  showLabel = false,
}: ProgressBarProps) {
  const percentage = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="flex-1 h-[6px] rounded-full bg-[var(--surface-2)] overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className={`h-full rounded-full ${colorStyles[color]}`}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-semibold text-[var(--text-2)] tabular-nums min-w-[32px] text-right">
          {Math.round(percentage)}%
        </span>
      )}
    </div>
  );
}

export interface RingProgressProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function RingProgress({
  value,
  max = 100,
  size = 80,
  strokeWidth = 6,
  className = '',
}: RingProgressProps) {
  const percentage = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const center = size / 2;
  const gradientId = useId();

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={`relative inline-flex items-center justify-center ${className}`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="var(--primary-light)" />
          </linearGradient>
        </defs>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <span className="absolute text-sm font-bold text-[var(--text-1)] tabular-nums">
        {Math.round(percentage)}%
      </span>
    </motion.div>
  );
}
