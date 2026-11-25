import { Link } from 'react-router-dom';
import { ArrowRight, Brain, CalendarClock, Database, FlaskConical, Footprints, Hammer, Layers, Network, Shuffle, Table2, Trophy, Workflow, Boxes } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, ProgressBar, Tag } from '@/shared/ui';
import { getTopic, TOPICS } from '../data/topics';
import { dueQuestions, exercisesDone, isMastered, isStarted, nextMode, progressOf, topicPath, useDm, type TopicProgress } from '../store';
import type { Topic, TopicGroup } from '../types';

const GROUPS: { g: TopicGroup; icon: typeof Database; blurb: string }[] = [
  { g: 'Foundations', icon: Table2, blurb: 'Entities, keys, cardinality and normal forms: the grammar every other model is written in.' },
  { g: 'Relational design', icon: Database, blurb: 'Trade write safety for read speed on purpose, and spot the flawed schema in a review.' },
  { g: 'Analytics (OLAP)', icon: Layers, blurb: 'Kimball: grain first, then facts and dimensions, history with SCDs.' },
  { g: 'Modern data platforms', icon: Workflow, blurb: 'Data Vault, events, medallion layers and the physical layout that decides your bill.' },
  { g: 'NoSQL & access patterns', icon: Network, blurb: 'Start from the queries: partition keys, single-table design, embed vs reference.' },
  { g: 'Operating models', icon: Boxes, blurb: 'Change schemas without downtime and share one database across many tenants safely.' },
];

function Pip({ on, label, title }: { on: boolean; label: string; title: string }) {
  return (
    <span title={title} className={cn('grid h-5 w-5 place-items-center rounded font-mono text-[10px] font-semibold', on ? 'bg-ok text-paper' : 'border border-line text-faint')}>
      {label}
    </span>
  );
}

function TopicCard({ t, prog }: { t: Topic; prog?: TopicProgress }) {
  const mastered = isMastered(t, prog);
  return (
    <Link
      to={topicPath(t, nextMode(t, prog))}
      className={cn('group relative flex flex-col rounded-xl border bg-surface p-3.5 transition hover:-translate-y-0.5 hover:shadow-lift', mastered ? 'border-ok/50' : 'border-line hover:border-accent/50')}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] text-faint">
            #{String(t.num).padStart(2, '0')} · {t.level} · {t.minutes} min
          </div>
          <h3 className="mt-0.5 font-mono text-[14px] font-semibold leading-snug group-hover:text-accent">{t.title}</h3>
        </div>
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', t.kind === 'lab' ? 'bg-violet/10 text-violet' : 'bg-accent/10 text-accent')} title={t.kind === 'lab' ? 'Interactive lab' : 'Schema canvas'}>
          {t.kind === 'lab' ? <FlaskConical size={16} /> : <Table2 size={16} />}
        </span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted">{t.tagline.replace(/\*\*|`/g, '')}</p>
      <div className="mt-auto flex items-center justify-between pt-3">
        {t.kind === 'canvas' ? (
          <div className="flex gap-1">
            <Pip on={!!prog?.guidedDone} label="L" title="Learn: guided walkthrough" />
            <Pip on={!!prog?.buildSolved} label="B" title="Build: solved the scenario yourself" />
            <Pip on={!!prog?.challengeSolved} label="C" title="Challenge: solved the transfer scenario" />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-16">
              <ProgressBar value={exercisesDone(t, prog)} max={t.exercises.length} size="xs" tone="ok" />
            </div>
            <span className="font-mono text-[10px] text-faint">
              {exercisesDone(t, prog)}/{t.exercises.length} exercises
            </span>
          </div>
        )}
        {mastered ? (
          <Tag size="sm" tone="ok">
            mastered
          </Tag>
        ) : t.kind === 'canvas' && prog && !prog.buildSolved && prog.buildBest > 0 ? (
          <span className="font-mono text-[10px] text-faint">best {prog.buildBest}%</span>
        ) : null}
      </div>
    </Link>
  );
}

export function Home() {
  const topics = useDm((s) => s.topics);
  const cards = useDm((s) => s.cards);
  const last = useDm((s) => s.last);
  const N = TOPICS.length;
  const prog = (t: Topic) => progressOf(topics, t.id);
  const started = TOPICS.filter((t) => isStarted(t, prog(t))).length;
  const mastered = TOPICS.filter((t) => isMastered(t, prog(t))).length;
  const preds = Object.values(topics).flatMap((p) => Object.values(p.predictions ?? {}));
  const due = dueQuestions(cards).length;
  const lastT = getTopic(last?.id);
  const next = TOPICS.find((t) => !isMastered(t, prog(t)));

  const stats = [
    { k: 'started', v: started, of: true, icon: Footprints },
    { k: 'mastered', v: mastered, of: true, icon: Trophy },
    { k: 'predictions right', v: preds.length ? `${preds.filter(Boolean).length}/${preds.length}` : '—', of: false, icon: Brain },
    { k: 'review cards', v: Object.keys(cards).length, of: false, icon: CalendarClock },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="eyebrow">Data Modelling Playground · {N} topics</p>
            <h1 className="mt-2 font-mono text-3xl font-semibold leading-tight">Model it. Stress it. Defend it.</h1>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
              Drag tables and columns onto a live schema canvas and watch every change land: which anomalies appear, which queries gain a join, how many rows a
              write touches, how much data repeats. Then take the same technique into an unfamiliar domain, where interviews actually test you.
            </p>
          </div>
          <div className="flex gap-2">
            {lastT && last && (
              <Link to={topicPath(lastT, last.mode)}>
                <Button variant="secondary" icon={<ArrowRight size={15} />}>
                  Resume {lastT.title}
                </Button>
              </Link>
            )}
            {next && (!lastT || next.id !== lastT.id) && (
              <Link to={topicPath(next, nextMode(next, prog(next)))}>
                <Button variant="primary" icon={<ArrowRight size={15} />}>
                  {lastT ? 'Next topic' : 'Start with'} {next.title}
                </Button>
              </Link>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map(({ k, v, of, icon: Icon }) => (
              <div key={k} className="rounded-xl border border-line bg-surface px-3.5 py-3">
                <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
                  <Icon size={12} /> {k}
                </div>
                <div className="mt-1 font-mono text-2xl font-semibold">
                  {v}
                  {of && <span className="text-sm text-faint"> / {N}</span>}
                </div>
              </div>
            ))}
          </div>
          <Link
            to="/data-modeling/review"
            className={cn('flex min-w-[210px] flex-col justify-between rounded-xl border px-3.5 py-3 transition hover:shadow-lift', due ? 'border-accent/60 bg-accent/[0.07]' : 'border-line bg-surface')}
          >
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
              <CalendarClock size={12} /> spaced review
            </div>
            <div className="mt-1 flex items-end justify-between gap-3">
              <span className="font-mono text-2xl font-semibold">{due}</span>
              <span className="flex items-center gap-1 text-[12px] text-accent">
                {due ? 'due now' : 'mixed practice'} <Shuffle size={12} />
              </span>
            </div>
          </Link>
        </div>
        <div className="mt-3">
          <ProgressBar value={mastered} max={Math.max(1, N)} size="xs" tone="ok" />
        </div>

        <div className="mt-6 grid gap-2 rounded-xl border border-line bg-sunken/60 p-3 text-[12.5px] sm:grid-cols-4">
          {[
            ['1 · Learn', 'Watch the reference model assemble step by step. Predict each anomaly before it plays.', Footprints],
            ['2 · Build', 'Drag tables and columns from a palette full of plausible traps. Impact on every drop.', Hammer],
            ['3 · Challenge', 'Same technique, new domain, fewer hints. Labs cover what a canvas cannot.', Trophy],
            ['4 · Review', 'Interleaved recall and "which technique?" drills, scheduled just before you forget.', Brain],
          ].map(([t, d, Icon]) => {
            const I = Icon as typeof Brain;
            return (
              <div key={t as string} className="flex gap-2">
                <I size={16} className="mt-0.5 shrink-0 text-accent" />
                <div>
                  <div className="font-mono font-semibold">{t as string}</div>
                  <div className="text-muted">{d as string}</div>
                </div>
              </div>
            );
          })}
        </div>

        {GROUPS.map(({ g, icon: Icon, blurb }) => {
          const ts = TOPICS.filter((t) => t.group === g);
          if (!ts.length) return null;
          return (
            <section key={g} className="mt-8">
              <div className="mb-1 flex items-baseline gap-3">
                <h2 className="flex items-center gap-1.5 font-mono text-[13px] font-semibold uppercase tracking-wider">
                  <Icon size={14} className="self-center text-accent" /> {g}
                </h2>
                <span className="font-mono text-[11px] text-faint">
                  {ts.filter((t) => isMastered(t, prog(t))).length}/{ts.length} mastered
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <p className="mb-2.5 text-[12px] text-faint">{blurb}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {ts.map((t) => (
                  <TopicCard key={t.id} t={t} prog={prog(t)} />
                ))}
              </div>
            </section>
          );
        })}
        <p className="mt-10 text-center text-[11.5px] text-faint">
          Row counts, sizes and join costs come from a simple cardinality model: good for reasoning about trade-offs, not benchmarks. ·{' '}
          <Link to="/data-modeling/method" className="underline hover:text-muted">
            How this playground teaches
          </Link>
        </p>
      </div>
    </div>
  );
}
