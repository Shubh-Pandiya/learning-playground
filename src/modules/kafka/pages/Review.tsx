import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, Shuffle } from 'lucide-react';
import { Button } from '@/shared/ui';
import { dueCards, useKafka } from '../store';
import { PageBar } from '../ui/PageBar';
import { QuizCard } from '../ui/Quiz';

/** Interleave by source so consecutive cards come from different lessons/dives. */
function interleave<T extends { source: string }>(xs: T[]): T[] {
  const by = new Map<string, T[]>();
  xs.forEach((x) => by.set(x.source, [...(by.get(x.source) ?? []), x]));
  const out: T[] = [];
  const lists = [...by.values()];
  while (lists.some((l) => l.length)) lists.forEach((l) => l.length && out.push(l.shift()!));
  return out;
}

export function ReviewPage() {
  const st = useKafka();
  // Snapshot the queue on mount so grading a card doesn’t reshuffle it under the user.
  const [queue] = useState(() => interleave(dueCards(st)).slice(0, 20));
  const [i, setI] = useState(0);
  const [graded, setGraded] = useState(false);
  const total = useMemo(() => Object.keys(st.cards).length, [st.cards]);
  const c = queue[i];
  return (
    <div className="flex h-full flex-col">
      <PageBar eyebrow="Spaced repetition · SM-2" title="Review" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-4 px-6 py-6">
          {!queue.length ? (
            <div className="rounded-xl border border-line bg-surface p-6 text-center">
              <CalendarCheck className="mx-auto text-ok" />
              <p className="mt-2 font-mono text-[14px] font-semibold">Nothing due</p>
              <p className="mt-1 text-[12.5px] text-muted">
                {total ? `${total} cards scheduled. They come back just before you’d forget them.` : 'Finish a lesson’s Learn mode or a deep dive. Their predictions and quiz questions become review cards.'}
              </p>
              <Link to="/kafka" className="mt-3 inline-block">
                <Button size="sm" variant="secondary">
                  Back to Kafka
                </Button>
              </Link>
            </div>
          ) : i >= queue.length ? (
            <div className="rounded-xl border border-ok/40 bg-ok/5 p-6 text-center">
              <p className="font-mono text-[14px] font-semibold text-ok">Session done · {queue.length} cards</p>
              <p className="mt-1 text-[12.5px] text-muted">Short, mixed sessions beat long blocked ones. Come back tomorrow.</p>
              <Link to="/kafka/drills" className="mt-3 inline-block">
                <Button size="sm">Try an interleaved drill</Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <Shuffle size={13} /> Interleaved across lessons and internals
                <span className="ml-auto font-mono">
                  {i + 1} / {queue.length}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-ink/10">
                <div className="h-full bg-accent transition-all" style={{ width: `${(i / queue.length) * 100}%` }} />
              </div>
              <QuizCard
                key={c.id}
                item={{ id: c.id, q: c.q, options: c.options, answer: c.answer, why: c.why, source: c.source }}
                revealSource
                onGraded={(g) => {
                  st.grade(c.id, g);
                  setGraded(true);
                }}
              />
              <div className="flex items-center gap-2">
                <Link to={c.path} className="text-[12px] text-muted underline-offset-2 hover:underline">
                  Revisit the source
                </Link>
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={!graded}
                  onClick={() => {
                    setGraded(false);
                    setI(i + 1);
                  }}
                >
                  Next card
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
