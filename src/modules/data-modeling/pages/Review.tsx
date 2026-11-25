import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Brain, CalendarClock, RefreshCw, Shuffle } from 'lucide-react';
import { Button, Callout, Tag } from '@/shared/ui';
import type { RecallGrade } from '@/shared/progress';
import { TOPICS } from '../data/topics';
import { dueQuestions, useDm } from '../store';
import type { QuizItem } from '../types';
import { QuizCard } from '../ui/Quiz';

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** "Which technique?" drill: maps an interview cue to the topic it should trigger. */
function signalItems(n: number): QuizItem[] {
  const out: QuizItem[] = [];
  for (const t of shuffle(TOPICS).slice(0, n)) {
    const sig = shuffle(t.signals)[0];
    if (!sig) continue;
    const others = shuffle(TOPICS.filter((o) => o.id !== t.id && !o.signals.includes(sig))).slice(0, 3);
    const opts = shuffle([t, ...others]);
    out.push({
      id: `signal:${t.id}:${sig}`,
      q: `The interviewer says: “${sig}”. Which technique should you reach for first?`,
      options: opts.map((o) => o.title),
      answer: opts.indexOf(t),
      why: t.tagline,
      source: 'Name the technique',
    });
  }
  return out;
}

const QUIZ_BY_ID = new Map(TOPICS.flatMap((t) => t.quiz.map((q) => [q.id, { q, t }] as const)));

function buildDeck(): { items: QuizItem[]; due: number } {
  const { cards, topics } = useDm.getState();
  const due = dueQuestions(cards).filter((d) => QUIZ_BY_ID.has(d.qid));
  const dueItems: QuizItem[] = due.map(({ qid }) => {
    const { q, t } = QUIZ_BY_ID.get(qid)!;
    return { ...q, source: `#${t.num} ${t.title}` };
  });
  // Due cards first, shuffled across topics, topped up with unseen questions from topics you've touched.
  const touched = new Set(Object.keys(topics));
  const fresh = shuffle(TOPICS.filter((t) => touched.has(t.id) || touched.size === 0).flatMap((t) => t.quiz.filter((q) => !cards[q.id]).map((q) => ({ ...q, source: `#${t.num} ${t.title}` }))));
  const core = shuffle(dueItems).slice(0, 12);
  const topUp = fresh.slice(0, Math.max(0, 8 - core.length));
  const signals = signalItems(core.length + topUp.length >= 8 ? 3 : 5);
  const deck = [...core, ...topUp];
  signals.forEach((s, i) => deck.splice(Math.min(deck.length, (i + 1) * 3), 0, s));
  return { items: deck, due: due.length };
}

export function Review() {
  const grade = useDm((s) => s.grade);
  const [seed, setSeed] = useState(0);
  // Snapshot once per set so grading doesn't reshuffle the deck under you.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const deck = useMemo(() => buildDeck(), [seed]);
  const [done, setDone] = useState<Record<string, RecallGrade>>({});
  const answered = Object.keys(done).length;
  const right = Object.values(done).filter((g) => g > 0).length;
  const again = () => {
    setDone({});
    setSeed((s) => s + 1);
  };

  const onGraded = (it: QuizItem, g: RecallGrade) => {
    setDone((d) => ({ ...d, [it.id]: g }));
    if (!it.id.startsWith('signal:')) grade(it.id, g);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <Link to="/data-modeling" className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-faint hover:text-ink">
          <ArrowLeft size={13} /> Topics
        </Link>
        <h1 className="mt-3 flex items-center gap-2 font-mono text-2xl font-semibold">
          <Brain size={22} className="text-accent" /> Interleaved review
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
          Questions from different topics, shuffled together, so you practise <em>choosing</em> the technique (normalize? SCD2? bridge table? partition key?), not just recalling it.
          Rate your confidence honestly: a lucky guess comes back sooner.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Tag tone={deck.due ? 'accent' : 'neutral'} dot>
            <CalendarClock size={12} className="mr-1 inline" />
            {deck.due} due
          </Tag>
          <Tag>{deck.items.length} in this set</Tag>
          {answered > 0 && (
            <Tag tone="ok">
              {right}/{answered} right
            </Tag>
          )}
          <Button size="xs" variant="ghost" className="ml-auto" icon={<Shuffle size={12} />} onClick={again}>
            New set
          </Button>
        </div>
        {!deck.due && (
          <Callout tone="info" className="mt-4">
            <span className="text-[12.5px]">Nothing is due yet, so this is a mixed practice set. Questions you grade here join the spaced schedule.</span>
          </Callout>
        )}
        <div className="mt-4 space-y-3">
          {deck.items.map((it) => (
            <QuizCard key={`${seed}:${it.id}`} item={it} revealSource={false} onGraded={(g) => onGraded(it, g)} />
          ))}
        </div>
        {answered === deck.items.length && deck.items.length > 0 && (
          <div className="mt-6 flex items-center justify-between rounded-xl border border-ok/40 bg-ok/[0.07] p-4">
            <div>
              <p className="font-mono text-sm font-semibold text-ok">
                Set complete · {right}/{answered}
              </p>
              <p className="text-[12.5px] text-muted">Missed ones are scheduled for tomorrow; confident ones are pushed out further.</p>
            </div>
            <Button size="sm" icon={<RefreshCw size={13} />} onClick={again}>
              Another set
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
