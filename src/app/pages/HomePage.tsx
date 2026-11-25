import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Brain,
  CalendarClock,
  Check,
  Compass,
  Eye,
  Flame,
  Gauge,
  Layers,
  Microscope,
  Ruler,
  Scale,
  Shuffle,
  Siren,
  Sparkles,
  Target,
  Wrench,
  Zap,
} from 'lucide-react';
import { cn } from '@/shared/cn';
import { useModuleSummary, useProgressSummaries } from '@/shared/progress';
import { Card, ProgressBar, Tag, type Tone } from '@/shared/ui';
import { allModules, tracks, type ModuleDef } from '../modules';
import { buildTodayPlan, localDay, streak, useActivity, type TodayItem } from '../today';

const fadeUp = (i: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.05 * i, duration: 0.35, ease: 'easeOut' as const },
});

/* ───────────────────────── stats ───────────────────────── */

function Stat({ label, value, icon }: { label: string; value: ReactNode; icon: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
      <span className="text-accent">{icon}</span>
      <div>
        <div className="font-mono text-lg font-semibold tabular-nums leading-none">{value}</div>
        <div className="mt-1 font-mono text-[10.5px] uppercase tracking-wider text-muted">{label}</div>
      </div>
    </div>
  );
}

function Stats() {
  const summaries = useProgressSummaries((s) => s.summaries);
  const days = useActivity((s) => s.days);
  const due = allModules.reduce((n, m) => n + (summaries[m.id]?.dueForReview ?? 0), 0);
  const started = allModules.filter((m) => (summaries[m.id]?.completed ?? 0) > 0).length;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat icon={<Flame size={18} />} label="day streak" value={streak(days)} />
      <Stat icon={<CalendarClock size={18} />} label="reviews due" value={due} />
      <Stat icon={<Compass size={18} />} label="tracks started" value={`${started}/${allModules.length}`} />
      <Stat icon={<Gauge size={18} />} label="active days" value={days.length} />
    </div>
  );
}

/* ───────────────────────── today plan ───────────────────────── */

const kindTone: Record<TodayItem['kind'], Tone> = {
  review: 'warn',
  learn: 'info',
  practice: 'accent',
  challenge: 'violet',
};

function TodayPlan() {
  const summaries = useProgressSummaries((s) => s.summaries);
  const doneDay = useActivity((s) => s.doneDay);
  const doneList = useActivity((s) => s.done);
  const toggleDone = useActivity((s) => s.toggleDone);
  const items = useMemo(() => buildTodayPlan(allModules, summaries), [summaries]);
  const done = new Set(doneDay === localDay() ? doneList : []);
  const minutes = items.filter((i) => !done.has(i.key)).reduce((n, i) => n + i.minutes, 0);
  const doneCount = items.filter((i) => done.has(i.key)).length;

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-4">
        <div>
          <p className="eyebrow">today</p>
          <h2 className="mt-1 text-lg font-semibold">Your session plan</h2>
        </div>
        <div className="ml-auto flex items-center gap-2 font-mono text-xs text-muted">
          {items.length > 0 && (
            <>
              <span className="tabular-nums">
                {doneCount}/{items.length} done
              </span>
              <span className="text-faint">·</span>
              <span className="tabular-nums">~{minutes} min left</span>
            </>
          )}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">Pick any track below to start — your plan builds itself as you go.</p>
      ) : (
        <ol className="divide-y divide-line">
          {items.map((it, i) => {
            const isDone = done.has(it.key);
            return (
              <motion.li key={it.key} {...fadeUp(i)} className="flex items-center gap-3 px-5 py-3">
                <button
                  type="button"
                  onClick={() => toggleDone(it.key)}
                  aria-label={isDone ? 'Mark not done' : 'Mark done'}
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                    isDone ? 'border-ok bg-ok text-paper' : 'border-line hover:border-ink/50',
                  )}
                >
                  {isDone && <Check size={13} strokeWidth={3} />}
                </button>
                <Tag tone={kindTone[it.kind]} className="w-[68px] justify-center">
                  {it.kind}
                </Tag>
                <Link to={it.path} className={cn('group min-w-0 flex-1', isDone && 'opacity-50')}>
                  <div className={cn('truncate font-mono text-[13px] text-ink group-hover:text-accent', isDone && 'line-through')}>
                    {it.label}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {it.module.title}
                    {it.detail && <span className="text-faint"> · {it.detail}</span>}
                  </div>
                </Link>
                <span className="hidden shrink-0 font-mono text-[11px] tabular-nums text-faint sm:inline">{it.minutes}m</span>
                <Link to={it.path} aria-label={`Open ${it.label}`} className="shrink-0 text-muted hover:text-accent">
                  <ArrowRight size={15} />
                </Link>
              </motion.li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

/* ───────────────────────── tracks ───────────────────────── */

function ModuleCard({ m, index }: { m: ModuleDef; index: number }) {
  const summary = useModuleSummary(m.id);
  const completed = summary?.completed ?? 0;
  const total = summary?.total ?? 0;
  const href = summary?.resume?.path ?? m.path;

  return (
    <motion.div {...fadeUp(index)} className="h-full">
      <Link to={href} className="group block h-full rounded-lg focus-visible:outline-none">
        <Card interactive className="flex h-full flex-col">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-paper text-accent">
              {m.icon}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-mono text-base font-semibold leading-tight">{m.title}</h3>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {m.highlights.map((h) => (
                  <Tag key={h}>{h}</Tag>
                ))}
              </div>
            </div>
            {summary?.dueForReview ? (
              <Tag tone="warn" dot className="shrink-0">
                {summary.dueForReview} due
              </Tag>
            ) : null}
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-muted">{m.blurb}</p>
          <div className="mt-auto pt-6">
            <ProgressBar
              value={completed}
              max={Math.max(total, 1)}
              label={total ? `${completed} of ${total} ${summary?.unit ?? m.unit}` : 'not started yet'}
              showValue={total ? 'percent' : false}
            />
            {summary?.detail && <p className="mt-1.5 font-mono text-[11px] text-faint">{summary.detail}</p>}
            <div className="mt-4 flex items-center gap-2 font-mono text-[13px] font-medium">
              <span className="truncate text-ink">
                {summary?.resume ? `Continue · ${summary.resume.label}` : completed > 0 ? 'Continue' : 'Start'}
              </span>
              <ArrowRight size={15} className="shrink-0 text-accent transition-transform group-hover:translate-x-1" />
            </div>
          </div>
        </Card>
      </Link>
    </motion.div>
  );
}

function Tracks() {
  let i = 0;
  return (
    <div className="space-y-12">
      {tracks.map((t) => (
        <section key={t.id}>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="eyebrow">
              {t.index} · {t.title}
            </p>
            <p className="text-sm text-muted">{t.tagline}</p>
          </div>
          <div className={cn('mt-4 grid gap-5', t.modules.length > 1 && 'md:grid-cols-2')}>
            {t.modules.map((m) => (
              <ModuleCard key={m.id} m={m} index={i++} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ───────────────────────── principles ───────────────────────── */

type Principle = { icon: ReactNode; title: string; body: string };

const learning: Principle[] = [
  {
    icon: <Brain size={16} />,
    title: 'Retrieval practice',
    body: 'You assemble the solution, schema or architecture yourself instead of re-reading it. Pulling knowledge out is what makes it stick.',
  },
  {
    icon: <CalendarClock size={16} />,
    title: 'Spaced repetition',
    body: 'Items come back just before you would forget them, and Today’s plan puts them first. Short daily sessions beat one long cram.',
  },
  {
    icon: <Eye size={16} />,
    title: 'Predict before reveal',
    body: 'Guess the next pointer move, the query result or the consumer lag before the animation shows it. Committing to a guess primes memory.',
  },
  {
    icon: <Layers size={16} />,
    title: 'Worked example → faded guidance',
    body: 'Watch a full walkthrough, then fill in missing pieces, then build from a blank canvas. Support fades as skill grows.',
  },
  {
    icon: <Shuffle size={16} />,
    title: 'Interleaving',
    body: 'Today mixes reviews across tracks, so you practise choosing the right pattern or tool, which is exactly what an unfamiliar interview problem tests.',
  },
  {
    icon: <Sparkles size={16} />,
    title: 'Dual coding',
    body: 'Every idea appears twice: as code, SQL or text, and as a moving picture. Two memory traces are stronger than one.',
  },
  {
    icon: <Zap size={16} />,
    title: 'Immediate feedback',
    body: 'Every drop and every change shows what changed and its impact, so mistakes are corrected before they set.',
  },
  {
    icon: <Target size={16} />,
    title: 'Low cognitive load',
    body: 'Calm screens, one concept per step, and real backend analogies that anchor new ideas to what you already know.',
  },
];

const judgment: Principle[] = [
  {
    icon: <Scale size={16} />,
    title: 'Tradeoffs, not answers',
    body: 'Every component, index or schema choice states what it buys and what it costs. Good engineers argue in tradeoffs, not in right answers.',
  },
  {
    icon: <Microscope size={16} />,
    title: 'Look inside the box',
    body: 'Open a load balancer, a Kafka partition or a B-tree index to see how it is actually built. Understanding the internals is what lets you debug.',
  },
  {
    icon: <Siren size={16} />,
    title: 'Think in failure modes',
    body: 'Kill a broker, skew a partition, drop an index, then watch what breaks and why. Design for the bad day, not the demo.',
  },
  {
    icon: <Ruler size={16} />,
    title: 'Estimate before you build',
    body: 'Rough numbers for QPS, storage, lag and row counts turn opinions into decisions you can defend.',
  },
  {
    icon: <Compass size={16} />,
    title: 'Solution-oriented framing',
    body: 'Requirements → constraints → options → decision → consequences. The same loop works for a LeetCode problem, a schema or a whole system.',
  },
  {
    icon: <Wrench size={16} />,
    title: 'Production mapping',
    body: 'Each pattern links to where it runs in real backends: rate limiters, top-K IPs, CDC pipelines, event sourcing. That turns knowledge into instinct.',
  },
];

function PrincipleGrid({ items, cols }: { items: Principle[]; cols: string }) {
  return (
    <div className={cn('mt-8 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2', cols)}>
      {items.map((p) => (
        <div key={p.title} className="bg-surface p-5">
          <div className="flex items-center gap-2 text-accent">
            {p.icon}
            <h3 className="font-mono text-[13px] font-semibold text-ink">{p.title}</h3>
          </div>
          <p className="mt-2.5 text-[13px] leading-relaxed text-muted">{p.body}</p>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── page ───────────────────────── */

export function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-14">
      <motion.header initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="max-w-3xl">
        <p className="eyebrow">learning playground · mastery hub</p>
        <h1 className="mt-3 text-4xl font-semibold leading-[1.15] sm:text-5xl">
          Learn patterns by <span className="text-accent">moving</span> them.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted">
          One place to build real engineering judgment across algorithms, systems and data. Step through loops, assemble
          architectures, run real SQL, and break things on purpose. Every change tells you what it did and why it
          matters. Progress is saved locally.
        </p>
      </motion.header>

      <div className="mt-10">
        <Stats />
      </div>

      <div className="mt-6">
        <TodayPlan />
      </div>

      <div className="mt-16">
        <Tracks />
      </div>

      <section className="mt-24">
        <p className="eyebrow">how this playground helps you learn</p>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold leading-snug">
          Built on the learning science that actually transfers to new problems.
        </h2>
        <PrincipleGrid items={learning} cols="lg:grid-cols-4" />
      </section>

      <section className="mt-20">
        <p className="eyebrow">beyond learning · engineering judgment</p>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold leading-snug">
          The habits that separate someone who knows the answer from a good engineer.
        </h2>
        <PrincipleGrid items={judgment} cols="lg:grid-cols-3" />
      </section>
    </div>
  );
}
