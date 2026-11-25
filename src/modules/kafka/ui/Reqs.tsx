import { CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/shared/cn';
import { ProgressBar } from '@/shared/ui';
import type { CheckResult, Requirement } from '../engine/check';
import { Rich } from './Rich';

export function Reqs({ reqs, res, showWhy }: { reqs: Requirement[]; res: CheckResult; showWhy?: boolean }) {
  const pct = Math.round(res.closeness * 100);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="eyebrow">Requirements</span>
        <span className={cn('font-mono text-[12px] font-semibold', res.done ? 'text-ok' : 'text-ink')}>{pct}% there</span>
      </div>
      <ProgressBar value={res.closeness} tone={res.done ? 'ok' : 'accent'} />
      <ul className="space-y-1.5">
        {reqs.map((r) => {
          const ok = res.passed.includes(r.id);
          return (
            <li key={r.id} className="flex gap-1.5 text-[12px] leading-snug">
              {ok ? <CheckCircle2 size={14} className="mt-px shrink-0 text-ok" /> : <Circle size={14} className="mt-px shrink-0 text-faint" />}
              <span className={ok ? 'text-muted' : 'text-ink'}>
                <Rich text={r.label} />
                {showWhy && !ok && (
                  <span className="block text-[11px] text-faint">
                    <Rich text={r.why} />
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
