import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Boxes,
  Brain,
  CalendarClock,
  Eye,
  Layers,
  ListTree,
  Shuffle,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import { useModuleSummary, type ModuleId } from '@/shared/progress';
import { Card, ProgressBar, Tag } from '@/shared/ui';

interface Entry {
  id: ModuleId;
  to: string;
  eyebrow: string;
  title: string;
  blurb: string;
  icon: ReactNode;
  unit: string;
  bullets: string[];
}

const entries: Entry[] = [
  {
    id: 'dsa',
    to: '/dsa',
    eyebrow: '01 · algorithms',
    title: 'DSA Patterns Playground',
    blurb:
      'The NeetCode sheet as drag-and-drop pattern puzzles. Watch loops and pointers move step by step, predict before you reveal, and see where each pattern runs in real backend systems.',
    icon: <ListTree size={22} />,
    unit: 'problems',
    bullets: ['step-through loop traces', 'pattern recognition drills', 'backend use-cases'],
  },
  {
    id: 'system-design',
    to: '/system-design',
    eyebrow: '02 · architecture',
    title: 'System Design Playground',
    blurb:
      'Build the top 20 system designs by dragging components onto a canvas. Every piece explains what it solves and its tradeoffs; wrong pieces get flagged — and the live diagram shows traffic flowing.',
    icon: <Boxes size={22} />,
    unit: 'designs',
    bullets: ['animated request flow', 'live capability score', 'tradeoff feedback'],
  },
];

function EntryCard({ e, index }: { e: Entry; index: number }) {
  const summary = useModuleSummary(e.id);
  const completed = summary?.completed ?? 0;
  const total = summary?.total ?? 0;
  const started = completed > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * index, duration: 0.4, ease: 'easeOut' }}
    >
      <Link to={summary?.resume?.path ?? e.to} className="group block h-full rounded-lg focus-visible:outline-none">
        <Card interactive className="flex h-full flex-col !p-7">
          <div className="flex items-start justify-between">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-paper text-accent">
              {e.icon}
            </span>
            {summary?.dueForReview ? (
              <Tag tone="warn" dot>
                {summary.dueForReview} due for review
              </Tag>
            ) : null}
          </div>
          <p className="eyebrow mt-6">{e.eyebrow}</p>
          <h2 className="mt-2 text-xl font-semibold">{e.title}</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">{e.blurb}</p>
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {e.bullets.map((b) => (
              <Tag key={b}>{b}</Tag>
            ))}
          </ul>

          <div className="mt-auto pt-8">
            <ProgressBar
              value={completed}
              max={Math.max(total, 1)}
              label={total ? `${completed} of ${total} ${summary?.unit ?? e.unit}` : 'not started yet'}
              showValue={total ? 'percent' : false}
              size="md"
            />
            {summary?.detail && <p className="mt-2 font-mono text-[11px] text-faint">{summary.detail}</p>}
            <div className="mt-5 flex items-center gap-2 font-mono text-sm font-medium">
              <span className="text-ink">
                {summary?.resume ? `Continue · ${summary.resume.label}` : started ? 'Continue' : 'Start'}
              </span>
              <ArrowRight size={16} className="text-accent transition-transform group-hover:translate-x-1" />
            </div>
          </div>
        </Card>
      </Link>
    </motion.div>
  );
}

const principles: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Brain size={16} />,
    title: 'Retrieval practice',
    body: 'You assemble the solution or architecture yourself instead of re-reading it. Pulling knowledge out is what makes it stick.',
  },
  {
    icon: <CalendarClock size={16} />,
    title: 'Spaced repetition',
    body: 'Solved items come back for review just before you would forget them — short sessions over days beat one long cram.',
  },
  {
    icon: <Eye size={16} />,
    title: 'Predict before reveal',
    body: 'Guess the next pointer move or the bottleneck before the animation shows it. Generating an answer — even a wrong one — primes memory.',
  },
  {
    icon: <Layers size={16} />,
    title: 'Worked example → faded guidance',
    body: 'First watch a full walkthrough, then fill in the missing pieces, then build from a blank canvas. Support fades as skill grows.',
  },
  {
    icon: <Shuffle size={16} />,
    title: 'Interleaving',
    body: 'Mixed drills make you identify which pattern fits — the exact skill an interview tests on a problem you have never seen.',
  },
  {
    icon: <Sparkles size={16} />,
    title: 'Dual coding',
    body: 'Every idea is shown twice: as code or text and as a moving picture. Two memory traces are stronger than one.',
  },
  {
    icon: <Zap size={16} />,
    title: 'Immediate feedback',
    body: 'Each drop is judged instantly — what it solves, its tradeoff, or why it is wrong — so mistakes are corrected before they set.',
  },
  {
    icon: <Target size={16} />,
    title: 'Low cognitive load',
    body: 'Calm, minimal screens; one concept per step; real backend analogies anchor new ideas to what you already know.',
  },
];

export function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-16">
      <motion.header initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="max-w-3xl">
        <p className="eyebrow">learning playground</p>
        <h1 className="mt-3 text-4xl font-semibold leading-[1.15] sm:text-5xl">
          Learn patterns by <span className="text-accent">moving</span> them.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted">
          Two drag-and-drop playgrounds for building intuition — not memorising answers. Step through loops one
          iteration at a time, assemble systems piece by piece, and see why each choice works in real backend
          engineering. Everything is saved locally in your browser.
        </p>
      </motion.header>

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        {entries.map((e, i) => (
          <EntryCard key={e.id} e={e} index={i} />
        ))}
      </div>

      <section className="mt-24">
        <p className="eyebrow">how this playground helps you learn</p>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold leading-snug">
          Built on the learning science that actually transfers to new problems.
        </h2>
        <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {principles.map((p) => (
            <div key={p.title} className="bg-surface p-5">
              <div className="flex items-center gap-2 text-accent">
                {p.icon}
                <h3 className="font-mono text-[13px] font-semibold text-ink">{p.title}</h3>
              </div>
              <p className="mt-2.5 text-[13px] leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
