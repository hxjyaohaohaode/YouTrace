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
  primary: 'bg-[#5B46D8] text-white shadow-[var(--shadow-sm)] hover:bg-[#4935BC] active:bg-[#4935BC]',
  soft: 'bg-[var(--primary-soft)] text-[var(--primary)] hover:bg-[var(--primary)]/15 active:scale-[0.97]',
  ghost: 'bg-transparent text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] active:scale-[0.97]',
  danger: 'bg-[var(--danger)] text-white hover:opacity-90 active:scale-[0.97]',
  icon: 'bg-transparent text-[var(--text-3)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] active:scale-[0.97] p-2',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 text-[13px] gap-1.5',
  md: 'min-h-11 px-4.5 text-[14px] gap-2',
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
      className={`inline-flex items-center justify-center font-semibold transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] rounded-full disabled:opacity-40 disabled:cursor-not-allowed ${isIconOnly ? 'min-h-11 min-w-11' : sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {Icon && <Icon size={isIconOnly ? 18 : 16} strokeWidth={2} />}
      {children}
    </button>
  );
}
