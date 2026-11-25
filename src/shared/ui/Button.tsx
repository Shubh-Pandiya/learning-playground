import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon rendered before children (e.g. a lucide icon). */
  icon?: ReactNode;
  /** Square icon-only button; pass `aria-label`. */
  iconOnly?: boolean;
  active?: boolean;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-paper hover:bg-ink/85 border border-ink',
  secondary: 'bg-surface text-ink border border-line hover:border-ink/40 hover:bg-surface/70',
  ghost: 'text-muted hover:text-ink hover:bg-ink/5 border border-transparent',
  danger: 'bg-bad/10 text-bad border border-bad/30 hover:bg-bad/15',
  success: 'bg-ok/10 text-ok border border-ok/30 hover:bg-ok/15',
};

const sizes: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1',
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
};

const iconSizes: Record<ButtonSize, string> = {
  xs: 'h-6 w-6',
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-11 w-11',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconOnly, active, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex select-none items-center justify-center rounded font-mono font-medium transition-colors disabled:pointer-events-none disabled:opacity-45',
        variants[variant],
        iconOnly ? iconSizes[size] : sizes[size],
        active && 'ring-2 ring-accent/50',
        className,
      )}
      {...rest}
    >
      {icon}
      {!iconOnly && children}
    </button>
  );
});
