import { ArrowRightLeft, CheckCircle2, Info, TriangleAlert, XCircle } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Rich } from './Rich';

export type ChangeTone = 'ok' | 'warn' | 'bad' | 'info';

export interface ChangeLine {
  tone: ChangeTone;
  text: string;
}

export interface Change {
  key: string;
  /** What the user (or the step) did, e.g. "Moved `email` from orders → customers". */
  title: string;
  /** Its consequences for the system, best first. */
  lines: ChangeLine[];
}

const ICON = { ok: CheckCircle2, warn: TriangleAlert, bad: XCircle, info: Info } as const;
const COLOR: Record<ChangeTone, string> = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', info: 'text-info' };

/** "What changed → impact on the system" card. Used by the canvas feed, guided steps and labs. */
export function ChangeCard({ change, compact, className }: { change: Change; compact?: boolean; className?: string }) {
  const lines = compact ? change.lines.slice(0, 2) : change.lines;
  return (
    <div className={cn('rounded-xl border border-line bg-surface p-2.5', className)}>
      <div className="flex items-start gap-1.5">
        <ArrowRightLeft size={13} className="mt-0.5 shrink-0 text-accent" />
        <div className="text-[12.5px] font-semibold leading-snug text-ink">
          <Rich text={change.title} />
        </div>
      </div>
      {lines.length > 0 && (
        <ul className="mt-1.5 space-y-1 pl-0.5">
          {lines.map((l, i) => {
            const I = ICON[l.tone];
            return (
              <li key={i} className="flex gap-1.5 text-[12px] leading-snug text-muted">
                <I size={13} className={cn('mt-px shrink-0', COLOR[l.tone])} />
                <span>
                  <Rich text={l.text} />
                </span>
              </li>
            );
          })}
          {compact && change.lines.length > 2 && <li className="pl-5 text-[11px] text-faint">+{change.lines.length - 2} more</li>}
        </ul>
      )}
      {!lines.length && <p className="mt-1 pl-5 text-[12px] text-faint">No measurable impact on the access patterns.</p>}
    </div>
  );
}
