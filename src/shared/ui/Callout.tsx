import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Lightbulb, XCircle } from 'lucide-react';
import { cn } from '../cn';

export type CalloutTone = 'info' | 'ok' | 'warn' | 'bad' | 'tip';

const styles: Record<CalloutTone, { box: string; icon: ReactNode }> = {
  info: { box: 'border-info/30 bg-info/[0.07]', icon: <Info size={16} className="text-info" /> },
  ok: { box: 'border-ok/30 bg-ok/[0.07]', icon: <CheckCircle2 size={16} className="text-ok" /> },
  warn: { box: 'border-warn/35 bg-warn/[0.08]', icon: <AlertTriangle size={16} className="text-warn" /> },
  bad: { box: 'border-bad/30 bg-bad/[0.07]', icon: <XCircle size={16} className="text-bad" /> },
  tip: { box: 'border-accent/30 bg-accent/[0.07]', icon: <Lightbulb size={16} className="text-accent" /> },
};

export interface CalloutProps {
  tone?: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** Inline feedback box: correct ✓ / tradeoff ⚠ / wrong ✗ / tip 💡 / info. */
export function Callout({ tone = 'info', title, children, icon, className }: CalloutProps) {
  const s = styles[tone];
  return (
    <div className={cn('flex gap-3 rounded-md border px-3.5 py-3 text-sm', s.box, className)}>
      <span className="mt-0.5 shrink-0">{icon ?? s.icon}</span>
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <div className="font-mono text-[13px] font-semibold text-ink">{title}</div>}
        {children && <div className={cn('text-muted', title && 'mt-1')}>{children}</div>}
      </div>
    </div>
  );
}
