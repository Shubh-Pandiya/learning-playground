import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import type { RecallGrade } from '@/shared/progress';
import { Rich } from './Rich';

export interface QuizItem {
  id: string;
  q: string;
  options: string[];
  answer: number;
  why: string;
  source?: string;
}

/**
 * Retrieval practice: answer first, then the mechanism, then a self-graded confidence that feeds
 * spaced repetition (a lucky guess should be graded "Guessed").
 */
export function QuizCard({ item, onGraded, revealSource = true, onAnswered }: { item: QuizItem; onGraded?: (g: RecallGrade) => void; revealSource?: boolean; onAnswered?: (right: boolean) => void }) {
  const [pick, setPick] = useState<number | null>(null);
  const [graded, setGraded] = useState(false);
  const right = pick === item.answer;
  const grade = (g: RecallGrade) => {
    if (graded) return;
    setGraded(true);
    onGraded?.(g);
  };
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      {item.source && (revealSource || pick !== null) && <div className="eyebrow mb-1">{item.source}</div>}
      <p className="text-[13.5px] font-medium leading-snug text-ink">
        <Rich text={item.q} />
      </p>
      <div className="mt-2.5 grid gap-1.5">
        {item.options.map((o, i) => {
          const isAns = i === item.answer;
          const chosen = pick === i;
          return (
            <button
              key={i}
              disabled={pick !== null}
              onClick={() => {
                setPick(i);
                onAnswered?.(i === item.answer);
                if (i !== item.answer) grade(0);
              }}
              className={cn(
                'flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] leading-snug transition',
                pick === null && 'border-line hover:border-accent hover:bg-accent/5',
                pick !== null && isAns && 'border-ok/50 bg-ok/10 text-ink',
                pick !== null && chosen && !isAns && 'border-bad/50 bg-bad/10',
                pick !== null && !chosen && !isAns && 'border-line opacity-60',
              )}
            >
              <span className="mt-px font-mono text-[11px] text-faint">{String.fromCharCode(65 + i)}</span>
              <span className="flex-1">
                <Rich text={o} />
              </span>
              {pick !== null && isAns && <CheckCircle2 size={15} className="shrink-0 text-ok" />}
              {chosen && !isAns && <XCircle size={15} className="shrink-0 text-bad" />}
            </button>
          );
        })}
      </div>
      {pick !== null && (
        <div className="mt-2.5 space-y-2">
          <p className={cn('text-[12.5px] leading-relaxed', right ? 'text-ok' : 'text-bad')}>
            <span className="font-semibold">{right ? 'Correct. ' : 'Not quite. '}</span>
            <span className="text-muted">
              <Rich text={item.why} />
            </span>
          </p>
          {right && onGraded && !graded && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-faint">How sure were you?</span>
              <Button size="xs" variant="secondary" onClick={() => grade(1)}>
                Guessed
              </Button>
              <Button size="xs" variant="secondary" onClick={() => grade(2)}>
                Knew it
              </Button>
              <Button size="xs" variant="secondary" onClick={() => grade(3)}>
                Easy
              </Button>
            </div>
          )}
          {graded && onGraded && <p className="text-[11px] text-faint">Scheduled for spaced review.</p>}
        </div>
      )}
    </div>
  );
}
