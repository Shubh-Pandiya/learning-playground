import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Brain, CalendarClock, RefreshCw, Shuffle } from 'lucide-react';
import { Button, Callout, Tag } from '@/shared/ui';
import type { RecallGrade } from '@/shared/progress';
import { PATTERNS } from '../data/patterns';
import { dueQuestions, useSd } from '../store';
import { QuizCard, type QuizItem } from '../ui/Quiz';

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** "Which pattern?" drill: maps an interview cue to the pattern it should trigger. */
function signalItems(n: number): QuizItem[] {
  const out: QuizItem[] = [];
  for (const p of shuffle(PATTERNS).slice(0, n)) {
    const sig = shuffle(p.signals)[0];
    const others = shuffle(PATTERNS.filter((o) => o.id !== p.id && !o.signals.includes(sig))).slice(0, 3);
    const opts = shuffle([p, ...others]);
    out.push({
      id: `signal:${p.id}:${sig}`,
      q: `The interviewer says: ${sig}. Which pattern should you reach for first?`,
      options: opts.map((o) => o.title),
      answer: opts.indexOf(p),
      why: p.tagline,
      source: 'Name the pattern',
    });
  }
  return out;
}

const QUIZ_BY_ID = new Map(PATTERNS.flatMap((p) => p.quiz.map((q) => [q.id, { q, p }] as const)));

function buildDeck(cards: ReturnType<typeof useSd.getState>['cards']): { items: QuizItem[]; due: number } {
  const due = dueQuestions(cards);
  const dueItems: QuizItem[] = due.map(({ qid }) => {
    const { q, p } = QUIZ_BY_ID.get(qid)!;
    return { ...q, source: `#${p.num} ${p.title}` };
  });
  // Interleave: due cards first (shuffled across patterns), topped up with unseen questions from patterns you have touched.
  const touched = new Set(Object.keys(useSd.getState().patterns));
  const fresh = shuffle(PATTERNS.filter((p) => touched.has(p.id) || touched.size === 0).flatMap((p) => p.quiz.filter((q) => !cards[q.id]).map((q) => ({ ...q, source: `#${p.num} ${p.title}` }))));
  const core = shuffle(dueItems).slice(0, 12);
  const topUp = fresh.slice(0, Math.max(0, 8 - core.length));
  const signals = signalItems(core.length + topUp.length >= 8 ? 3 : 5);
  // Spread signal drills through the deck rather than bunching them.
  const deck = [...core, ...topUp];
  signals.forEach((s, i) => deck.splice(Math.min(deck.length, (i + 1) * 3), 0, s));
  return { items: deck, due: due.length };
}

export function Review() {
  const grade = useSd((s) => s.grade);
  const [seed, setSeed] = useState(0);
  // Snapshot the deck once per session so grading doesn't reshuffle it under you.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const deck = useMemo(() => buildDeck(useSd.getState().cards), [seed]);
  const [done, setDone] = useState<Record<string, RecallGrade>>({});
  const answered = Object.keys(done).length;
  const right = Object.values(done).filter((g) => g > 0).length;

  const onGraded = (it: QuizItem, g: RecallGrade) => {
    setDone((d) => ({ ...d, [it.id]: g }));
    if (!it.id.startsWith('signal:')) grade(it.id, g);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <Link to="/system-design" className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-faint hover:text-ink">
          <ArrowLeft size={13} /> Patterns
        </Link>
        <h1 className="mt-3 flex items-center gap-2 font-mono text-2xl font-semibold">
          <Brain size={22} className="text-accent" /> Interleaved review
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
          Questions from different patterns, shuffled together, so you practise <em>choosing</em> the pattern, not just recalling it. Rate your confidence
          honestly: a lucky guess comes back sooner.
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
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            icon={<Shuffle size={12} />}
            onClick={() => {
              setDone({});
              setSeed((s) => s + 1);
            }}
          >
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
              <p className="font-mono text-sm font-semibold text-ok">Set complete · {right}/{answered}</p>
              <p className="text-[12.5px] text-muted">Missed ones are scheduled for tomorrow; confident ones are pushed out further.</p>
            </div>
            <Button
              size="sm"
              icon={<RefreshCw size={13} />}
              onClick={() => {
                setDone({});
                setSeed((s) => s + 1);
              }}
            >
              Another set
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
