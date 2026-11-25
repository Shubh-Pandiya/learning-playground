import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'info' | 'violet';

export const toneClasses: Record<Tone, { soft: string; solid: string; text: string; dot: string }> = {
  neutral: { soft: 'bg-ink/[0.06] text-muted border-line', solid: 'bg-ink text-paper border-ink', text: 'text-muted', dot: 'bg-muted' },
  accent: { soft: 'bg-accent/10 text-accent border-accent/30', solid: 'bg-accent text-accent-ink border-accent', text: 'text-accent', dot: 'bg-accent' },
  ok: { soft: 'bg-ok/10 text-ok border-ok/30', solid: 'bg-ok text-paper border-ok', text: 'text-ok', dot: 'bg-ok' },
  warn: { soft: 'bg-warn/10 text-warn border-warn/30', solid: 'bg-warn text-paper border-warn', text: 'text-warn', dot: 'bg-warn' },
  bad: { soft: 'bg-bad/10 text-bad border-bad/30', solid: 'bg-bad text-paper border-bad', text: 'text-bad', dot: 'bg-bad' },
  info: { soft: 'bg-info/10 text-info border-info/30', solid: 'bg-info text-paper border-info', text: 'text-info', dot: 'bg-info' },
  violet: { soft: 'bg-violet/10 text-violet border-violet/30', solid: 'bg-violet text-paper border-violet', text: 'text-violet', dot: 'bg-violet' },
};

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  variant?: 'soft' | 'solid' | 'outline';
  /** Show a small colored dot before the label. */
  dot?: boolean;
  icon?: ReactNode;
  size?: 'sm' | 'md';
}

/** Small mono label: difficulty, pattern name, status, component type… */
export function Tag({ tone = 'neutral', variant = 'soft', dot, icon, size = 'sm', className, children, ...rest }: TagProps) {
  const t = toneClasses[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded border font-mono',
        size === 'sm' ? 'h-5 px-1.5 text-[10.5px]' : 'h-6 px-2 text-xs',
        variant === 'solid' ? t.solid : variant === 'outline' ? cn('bg-transparent border-current', t.text) : t.soft,
        className,
      )}
      {...rest}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', t.dot)} />}
      {icon}
      {children}
    </span>
  );
}

/** Alias — same component. */
export const Badge = Tag;
