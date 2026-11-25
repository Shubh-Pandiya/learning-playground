import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Brain, Layers, Server, ShieldCheck, Target } from 'lucide-react';
import { Button, Callout, CodeBlock, ProgressBar, Tag } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { PatternId } from '../engine/types';
import { patternById, patterns } from '../data/patterns';
import { problemsByPattern, variants } from '../problems';
import { isSolved, useDsa } from '../store';
import { DifficultyTag, PageHeader, PatternTag, StatusIcon, patternTone } from '../components/common';
import { toneClasses } from '@/shared/ui';

export function PatternList() {
  const prog = useDsa((s) => s.problems);
  const stats = useDsa((s) => s.patterns);
  return (
    <div>
      <PageHeader eyebrow="Pattern library" title="Learn the patterns, not the problems">
        150 problems collapse into ~25 reusable ideas. Master the idea, its recognition signals and its invariant, and new problems become variations of
        something you already know.
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {patterns.map((p) => {
          const list = problemsByPattern(p.id);
          const done = list.filter((x) => isSolved(prog[x.id])).length;
          const s = stats[p.id];
          const acc = s?.drillTotal ? Math.round(((s.drillRight ?? 0) / s.drillTotal) * 100) : null;
          return (
            <Link
              key={p.id}
              to={`/dsa/patterns/${p.id}`}
              className={cn(
                'group flex flex-col rounded-xl border border-line bg-surface p-4 shadow-paper transition hover:-translate-y-0.5 hover:shadow-lift',
                'border-l-4',
              )}
              style={{ borderLeftColor: `rgb(var(--c-${patternTone(p.id) === 'neutral' ? 'muted' : patternTone(p.id)}))` }}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-ink group-hover:text-accent">{p.name}</h3>
                <span className="font-mono text-[11px] text-faint">{list.length} problems</span>
              </div>
              <p className="mt-1 flex-1 text-sm text-muted">{p.tagline}</p>
              <div className="mt-3 flex items-center gap-3">
                <ProgressBar value={done} max={Math.max(1, list.length)} size="xs" tone="ok" className="flex-1" />
                <span className="font-mono text-[11px] text-muted">
                  {done}/{list.length}
                </span>
                {acc !== null && (
                  <span className="font-mono text-[11px] text-violet" title="pattern recognition accuracy">
                    👁 {acc}%
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      <section className="mt-10">
        <h2 className="mb-1 text-lg font-semibold text-ink">Recognition cheat-sheet</h2>
        <p className="mb-3 text-sm text-muted">When you read this in a problem statement… reach for this pattern. Cover the right column and quiz yourself.</p>
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-paper">
          {patterns.map((p) => (
            <div key={p.id} className="grid grid-cols-1 gap-2 border-t border-line/60 px-4 py-2.5 first:border-t-0 md:grid-cols-[2fr_1fr]">
              <div className="text-sm text-ink">{p.signals.slice(0, 3).join(' · ')}</div>
              <div className="md:text-right">
                <PatternTag id={p.id} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function PatternDetail() {
  const { id = '' } = useParams();
  const p = patternById[id as PatternId];
  const prog = useDsa((s) => s.problems);
  const note = useDsa((s) => s.patterns[id as PatternId]?.note ?? '');
  const setNote = useDsa((s) => s.setPatternNote);
  if (!p) {
    return (
      <Callout tone="warn" title="Unknown pattern">
        <Link to="/dsa/patterns" className="underline">
          Back to patterns
        </Link>
      </Callout>
    );
  }
  const list = problemsByPattern(p.id);
  const vs = variants.filter((v) => v.pattern === p.id);
  const tone = toneClasses[patternTone(p.id)];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pattern"
        title={p.name}
        actions={
          <>
            <Link to={`/dsa/drill?pattern=${p.id}`}>
              <Button variant="secondary" size="sm" icon={<Target className="h-4 w-4" />}>
                Recognition drill
              </Button>
            </Link>
            {list[0] && (
              <Link to={`/dsa/problem/${list[0].id}`}>
                <Button variant="primary" size="sm">
                  Start with {list[0].title} <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            )}
          </>
        }
      >
        <span className={cn('font-medium', tone.text)}>{p.tagline}</span>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <section className="rounded-xl border border-line bg-surface p-5 shadow-paper">
            <div className="eyebrow mb-2">mental model</div>
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">{p.intuition}</p>
          </section>
          <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-paper">
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <span className="eyebrow">template</span>
              <span className="font-mono text-[11px] text-faint">{p.complexity}</span>
            </div>
            <CodeBlock code={p.template.replace(/^\s*\n/, '').trimEnd()} className="text-[12.5px]" />
          </section>
          <div className="grid gap-4 md:grid-cols-2">
            <ListCard icon={<ShieldCheck className="h-4 w-4 text-ok" />} title="invariants — what stays true every iteration" items={p.invariants} />
            <ListCard icon={<AlertTriangle className="h-4 w-4 text-warn" />} title="common mistakes" items={p.mistakes} />
          </div>
        </div>

        <div className="space-y-4">
          <ListCard icon={<Brain className="h-4 w-4 text-violet" />} title="recognition signals" items={p.signals} />
          <section className="rounded-xl border-2 border-info/30 bg-info/5 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Server className="h-4 w-4 text-info" />
              <span className="eyebrow !text-info">in backend systems</span>
            </div>
            <div className="space-y-3">
              {p.backend.map((b) => (
                <div key={b.title}>
                  <div className="text-sm font-semibold text-ink">{b.title}</div>
                  <p className="text-sm leading-relaxed text-muted">{b.detail}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-xl border border-line bg-surface p-4 shadow-paper">
            <div className="eyebrow mb-2">explain it to yourself</div>
            <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-ink">
              {p.selfExplain.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <textarea
              value={note}
              onChange={(e) => setNote(p.id, e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              rows={4}
              placeholder="Your own words (saved locally)…"
              className="w-full rounded-md border border-line bg-paper p-2 text-sm text-ink focus:border-accent focus:outline-none"
            />
          </section>
        </div>
      </div>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-ink">
          <Layers className="h-5 w-5 text-muted" /> Problems using this pattern
        </h2>
        {!list.length ? (
          <p className="text-sm text-muted">This pattern appears as a building block inside other problems.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-paper">
            {list.map((x) => (
              <Link
                key={x.id}
                to={`/dsa/problem/${x.id}`}
                className="flex items-center gap-3 border-t border-line/60 px-4 py-2.5 first:border-t-0 hover:bg-sunken/40"
              >
                <StatusIcon p={prog[x.id]} />
                <span className="flex-1 text-sm text-ink">
                  <span className="mr-1.5 font-mono text-xs text-faint">{x.num}.</span>
                  {x.title}
                </span>
                <span className="hidden truncate text-xs text-muted md:block">{x.backend.title}</span>
                <DifficultyTag d={x.difficulty} />
              </Link>
            ))}
          </div>
        )}
      </section>

      {vs.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-semibold text-ink">Unseen variants (transfer practice)</h2>
          <div className="flex flex-wrap gap-2">
            {vs.map((v) => (
              <Link key={v.id} to={`/dsa/transfer?variant=${v.id}`}>
                <Tag tone="violet" variant="outline" className="hover:opacity-80">
                  {v.title}
                </Tag>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ListCard({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-paper">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <span className="eyebrow">{title}</span>
      </div>
      <ul className="space-y-1.5 text-sm text-ink">
        {items.map((s) => (
          <li key={s} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted" />
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
