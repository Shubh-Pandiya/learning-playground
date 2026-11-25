import { useState } from 'react';
import { Eye, HelpCircle } from 'lucide-react';
import { cn } from '@/shared/cn';
import type { Predict } from '../types';
import { Rich } from './Rich';

/**
 * Predict-before-reveal card. Controlled (`answered`) or uncontrolled.
 * Call sites reveal the visual outcome only once `answered !== undefined`.
 */
export function PredictCard({
  predict,
  answered: controlled,
  onAnswer,
  className,
}: {
  predict: Predict;
  answered?: number;
  onAnswer?: (index: number, right: boolean) => void;
  className?: string;
}) {
  const [local, setLocal] = useState<number | undefined>(undefined);
  const answered = controlled ?? local;
  const answer = (i: number) => {
    if (answered !== undefined) return;
    setLocal(i);
    onAnswer?.(i, i === predict.answer);
  };
  return (
    <div className={cn('rounded-xl border p-3', answered === undefined ? 'border-accent/50 bg-accent/[0.06]' : 'border-line bg-surface', className)}>
      <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-accent">
        <HelpCircle size={13} /> Predict before you see it
      </div>
      <p className="mt-1 text-[13.5px] font-medium text-ink">
        <Rich text={predict.question} />
      </p>
      <div className="mt-2 grid gap-1.5">
        {predict.options.map((o, i) => {
          const isAns = i === predict.answer;
          const picked = answered === i;
          return (
            <button
              key={i}
              disabled={answered !== undefined}
              onClick={() => answer(i)}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] transition',
                answered === undefined && 'border-line bg-surface hover:border-accent hover:bg-accent/5',
                answered !== undefined && isAns && 'border-ok/60 bg-ok/10 text-ink',
                answered !== undefined && picked && !isAns && 'border-bad/60 bg-bad/10 text-ink',
                answered !== undefined && !picked && !isAns && 'border-line opacity-60',
              )}
            >
              <Rich text={o} />
            </button>
          );
        })}
      </div>
      {answered !== undefined ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
          <span className={cn('font-semibold', answered === predict.answer ? 'text-ok' : 'text-bad')}>{answered === predict.answer ? 'Right. ' : 'Not quite. '}</span>
          <Rich text={predict.explain} />
        </p>
      ) : (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-faint">
          <Eye size={11} /> The visual shows the answer once you commit to a guess.
        </p>
      )}
    </div>
  );
}
