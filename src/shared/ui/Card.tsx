import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds hover lift + pointer for clickable cards. */
  interactive?: boolean;
  /** Visual tone of the left accent border. */
  tone?: 'none' | 'accent' | 'ok' | 'warn' | 'bad' | 'info';
  padded?: boolean;
}

const toneBorder = {
  none: '',
  accent: 'border-l-4 border-l-accent',
  ok: 'border-l-4 border-l-ok',
  warn: 'border-l-4 border-l-warn',
  bad: 'border-l-4 border-l-bad',
  info: 'border-l-4 border-l-info',
};

/** Paper card: surface background, hairline border, soft shadow. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive, tone = 'none', padded = true, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border border-line bg-surface shadow-paper',
        padded && 'p-5',
        toneBorder[tone],
        interactive && 'cursor-pointer transition-all hover:-translate-y-0.5 hover:border-ink/30 hover:shadow-lift',
        className,
      )}
      {...rest}
    />
  );
});

export interface CardHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function CardHeader({ eyebrow, title, description, actions, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start gap-4', className)}>
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h3 className="font-mono text-base font-semibold leading-snug">{title}</h3>
        {description && <p className="mt-1.5 text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}
