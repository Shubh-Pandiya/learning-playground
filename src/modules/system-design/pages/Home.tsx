import { InsideTeaser } from './Inside';
import { PracticeTeaser } from './Practice';
import { Link } from 'react-router-dom';
import { ArrowRight, Brain, CalendarClock, Footprints, Hammer, Shuffle, Skull, Trophy } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, ProgressBar, Tag } from '@/shared/ui';
import { PATTERNS, getPattern } from '../data/patterns';
import { dueQuestions, isMastered, useSd, type PatternProgress } from '../store';
import type { ComponentKind, Pattern } from '../types';
import { IsoGlyph } from '../ui/iso';

const GROUPS: Pattern['group'][] = ['Scaling', 'Data', 'Messaging', 'Reliability', 'Architecture'];

function Pip({ on, label, title }: { on: boolean; label: string; title: string }) {
  return (
    <span title={title} className={cn('grid h-5 w-5 place-items-center rounded font-mono text-[10px] font-semibold', on ? 'bg-ok text-paper' : 'border border-line text-faint')}>
      {label}
    </span>
  );
}

// The rarest component across all reference designs is the one that "signs" a pattern.
const KIND_FREQ = new Map<string, number>();
for (const p of PATTERNS) for (const k of new Set(p.scenario.reference.nodes.map((n) => n.kind))) KIND_FREQ.set(k, (KIND_FREQ.get(k) ?? 0) + 1);
const heroKindOf = (p: Pattern) =>
  p.scenario.reference.nodes
    .filter((n) => n.kind !== 'client')
    .reduce<ComponentKind>((best, n) => ((KIND_FREQ.get(n.kind) ?? 0) < (KIND_FREQ.get(best) ?? 99) ? n.kind : best), 'app');

function PatternCard({ p, prog }: { p: Pattern; prog?: PatternProgress }) {
  const mode = !prog?.guidedDone ? 'learn' : !prog.buildSolved ? 'build' : 'challenge';
  const heroKind = heroKindOf(p);
  return (
    <Link
      to={`/system-design/p/${p.id}/${mode}`}
      className={cn(
        'group relative flex flex-col rounded-xl border bg-surface p-3.5 transition hover:-translate-y-0.5 hover:shadow-lift',
        isMastered(prog) ? 'border-ok/50' : 'border-line hover:border-accent/50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] text-faint">#{String(p.num).padStart(2, '0')} · {p.level} · {p.minutes} min</div>
          <h3 className="mt-0.5 font-mono text-[14px] font-semibold leading-snug group-hover:text-accent">{p.title}</h3>
        </div>
        <div className="-mr-1 -mt-1 shrink-0 opacity-90 transition group-hover:scale-105">
          <IsoGlyph kind={heroKind} size={44} />
        </div>
      </div>
      <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted">{p.tagline}</p>
      <div className="mt-auto flex items-center justify-between pt-3">
        <div className="flex gap-1">
          <Pip on={!!prog?.guidedDone} label="L" title="Learn: guided walkthrough" />
          <Pip on={!!prog?.buildSolved} label="B" title="Build: solved the scenario yourself" />
          <Pip on={!!prog?.challengeSolved} label="C" title="Challenge: solved the transfer scenario" />
        </div>
        {prog && !prog.buildSolved && prog.buildBest > 0 ? (
          <span className="font-mono text-[10px] text-faint">best {prog.buildBest}%</span>
        ) : isMastered(prog) ? (
          <Tag size="sm" tone="ok">
            mastered
          </Tag>
        ) : null}
      </div>
    </Link>
  );
}

export function Home() {
  const patterns = useSd((s) => s.patterns);
  const cards = useSd((s) => s.cards);
  const chaos = useSd((s) => s.chaos);
  const last = useSd((s) => s.last);
  const walked = PATTERNS.filter((p) => patterns[p.id]?.guidedDone).length;
  const built = PATTERNS.filter((p) => patterns[p.id]?.buildSolved).length;
  const mastered = PATTERNS.filter((p) => isMastered(patterns[p.id])).length;
  const due = dueQuestions(cards).length;
  const lastP = getPattern(last?.id);
  const next = PATTERNS.find((p) => !isMastered(patterns[p.id]));

  const stats = [
    { k: 'walked through', v: walked, icon: Footprints },
    { k: 'built yourself', v: built, icon: Hammer },
    { k: 'mastered', v: mastered, icon: Trophy },
    { k: 'chaos predictions', v: chaos.total ? `${chaos.right}/${chaos.total}` : '—', icon: Skull },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="eyebrow">System Design Playground · 20 patterns</p>
            <h1 className="mt-2 font-mono text-3xl font-semibold leading-tight">Build it. Break it. Explain it.</h1>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
              Each pattern is a live, simulated system. Watch the reference design assemble step by step, then rebuild it from a palette full of tempting
              wrong answers, then solve the same pattern in an unfamiliar domain. Every component tells you what it fixes and what it costs.
            </p>
          </div>
          <div className="flex gap-2">
            {lastP && last && (
              <Link to={`/system-design/p/${lastP.id}/${last.mode}`}>
                <Button variant="secondary" icon={<ArrowRight size={15} />}>
                  Resume {lastP.title}
                </Button>
              </Link>
            )}
            {next && (!lastP || next.id !== lastP.id) && (
              <Link to={`/system-design/p/${next.id}/${patterns[next.id]?.guidedDone ? 'build' : 'learn'}`}>
                <Button variant="primary" icon={<ArrowRight size={15} />}>
                  {lastP ? 'Next pattern' : 'Start with'} {next.title}
                </Button>
              </Link>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map(({ k, v, icon: Icon }) => (
              <div key={k} className="rounded-xl border border-line bg-surface px-3.5 py-3">
                <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
                  <Icon size={12} /> {k}
                </div>
                <div className="mt-1 font-mono text-2xl font-semibold">
                  {v}
                  {typeof v === 'number' && <span className="text-sm text-faint"> / 20</span>}
                </div>
              </div>
            ))}
          </div>
          <Link
            to="/system-design/review"
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
          <ProgressBar value={mastered} max={20} size="xs" tone="ok" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <InsideTeaser />
          <PracticeTeaser />
        </div>

        <div className="mt-6 grid gap-2 rounded-xl border border-line bg-sunken/60 p-3 text-[12.5px] sm:grid-cols-4">
          {[
            ['1 · Learn', 'Narrated build of the reference design. Predict each failure before it plays.', Footprints],
            ['2 · Build', 'Blank canvas, real requirements, traps in the palette. Feedback on every drop.', Hammer],
            ['3 · Challenge', 'Same pattern, new domain, fewer hints. This is what interviews test.', Trophy],
            ['4 · Review', 'Interleaved recall across patterns, scheduled just before you forget.', Brain],
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

        {GROUPS.map((g) => {
          const ps = PATTERNS.filter((p) => p.group === g);
          if (!ps.length) return null;
          return (
            <section key={g} className="mt-8">
              <div className="mb-2.5 flex items-baseline gap-3">
                <h2 className="font-mono text-[13px] font-semibold uppercase tracking-wider">{g}</h2>
                <span className="font-mono text-[11px] text-faint">
                  {ps.filter((p) => isMastered(patterns[p.id])).length}/{ps.length} mastered
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {ps.map((p) => (
                  <PatternCard key={p.id} p={p} prog={patterns[p.id]} />
                ))}
              </div>
            </section>
          );
        })}
        <p className="mt-10 text-center text-[11.5px] text-faint">
          Numbers are napkin-math estimates from a simple capacity model, useful for reasoning, not benchmarks. ·{' '}
          <Link to="/system-design/method" className="underline hover:text-muted">
            How this playground teaches
          </Link>
        </p>
      </div>
    </div>
  );
}
