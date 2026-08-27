import { type LucideIcon } from 'lucide-react';

export type ButtonVariant = 'primary' | 'soft' | 'ghost' | 'danger' | 'icon';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  children?: React.ReactNode;
  className?: string;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] text-white shadow-[var(--shadow-glow)] hover:shadow-[var(--shadow-lg)] hover:brightness-110 active:scale-[0.97]',
  soft: 'bg-[var(--primary-soft)] text-[var(--primary)] hover:bg-[var(--primary)]/15 active:scale-[0.97]',
  ghost: 'bg-transparent text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] active:scale-[0.97]',
  danger: 'bg-[var(--danger)] text-white hover:opacity-90 active:scale-[0.97]',
  icon: 'bg-transparent text-[var(--text-3)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] active:scale-[0.97] p-2',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4.5 text-[14px] gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const isIconOnly = variant === 'icon';

  return (
    <button
      type={props.type ?? 'button'}
      className={`inline-flex items-center justify-center font-semibold transition-all duration-200 rounded-full disabled:opacity-40 disabled:cursor-not-allowed ${isIconOnly ? '' : sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {Icon && <Icon size={isIconOnly ? 18 : 16} strokeWidth={2} />}
      {children}
    </button>
  );
}
