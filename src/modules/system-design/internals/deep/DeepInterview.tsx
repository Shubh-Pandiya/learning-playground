import { useState } from 'react';
import { Award, CornerDownRight } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Rich } from '../../ui/Rich';
import type { Deep } from '../types';

type Rating = 'nailed' | 'partial' | 'missed';
const RATING: { id: Rating; label: string; cls: string }[] = [
  { id: 'nailed', label: 'nailed it', cls: 'border-ok/60 text-ok' },
  { id: 'partial', label: 'partial', cls: 'border-warn/60 text-warn' },
  { id: 'missed', label: 'missed', cls: 'border-bad/60 text-bad' },
];

/** SDE-3 interview drill: answer first, reveal model answer, then face the follow-up probes and compare with the senior signal. */
export function DeepInterview({ d, onAttempted }: { d: Deep; onAttempted?: () => void }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [rated, setRated] = useState<Record<number, Rating>>({});
  const done = Object.keys(rated).length;
  const missed = d.interview.filter((_, i) => rated[i] && rated[i] !== 'nailed');
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] text-muted">Say your answer out loud first. Then reveal it, handle the follow-ups, and rate yourself honestly.</p>
        <span className="shrink-0 font-mono text-[11px] text-faint">
          {done}/{d.interview.length} rated
        </span>
      </div>
      {d.interview.map((q, i) => (
        <div key={i} className={cn('rounded-lg border bg-surface p-3', rated[i] === 'nailed' ? 'border-ok/40' : rated[i] ? 'border-warn/40' : 'border-line')}>
          <p className="font-mono text-[12.5px] font-semibold leading-snug">
            <span className="mr-1 text-faint">Q{i + 1}.</span>
            <Rich text={q.q} />
          </p>
          {!open[i] ? (
            <button className="mt-1.5 font-mono text-[11px] text-accent hover:underline" onClick={() => setOpen((o) => ({ ...o, [i]: true }))}>
              I’ve answered, reveal the model answer
            </button>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-[12.5px] leading-relaxed text-ink/90">
                <Rich text={q.a} />
              </p>
              <div className="rounded-md border border-line bg-sunken/60 p-2">
                <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-info">the interviewer pushes</div>
                <ul className="space-y-1">
                  {q.followUps.map((f, j) => (
                    <li key={j} className="flex gap-1.5 text-[12px] leading-snug text-ink/85">
                      <CornerDownRight size={12} className="mt-0.5 shrink-0 text-info" />
                      <span>
                        <Rich text={f} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex gap-2 rounded-md border border-violet/40 bg-violet/[0.06] px-2.5 py-1.5 text-[12px] leading-relaxed">
                <Award size={14} className="mt-0.5 shrink-0 text-violet" />
                <span>
                  <span className="mr-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-violet">SDE-3 signal</span>
                  <Rich text={q.seniorSignal} />
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10.5px] text-faint">how did you do?</span>
                {RATING.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      setRated((x) => ({ ...x, [i]: r.id }));
                      if (done + (rated[i] ? 0 : 1) >= Math.min(3, d.interview.length)) onAttempted?.();
                    }}
                    className={cn('rounded border px-2 py-0.5 font-mono text-[10.5px]', rated[i] === r.id ? cn(r.cls, 'bg-ink/[0.04] font-semibold') : 'border-line text-muted hover:border-accent/50')}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
      {done === d.interview.length && (
        <div className="rounded-lg border border-accent/40 bg-accent/[0.06] p-2.5 text-[12.5px]">
          {missed.length === 0 ? (
            <>All answered at SDE-3 depth. Come back in a few days and try them cold; spacing is what makes it stick.</>
          ) : (
            <>
              Re-study before your next session: <b>{missed.map((m) => m.q.replace(/[`*]/g, '').slice(0, 48)).join(' · ')}</b>. Re-read the matching deep dive, then answer again without looking.
            </>
          )}
        </div>
      )}
    </div>
  );
}
