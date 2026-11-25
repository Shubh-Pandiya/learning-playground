import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, Compass, Server, Shuffle, XCircle } from 'lucide-react';
import { Button, Callout } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { PatternId, Variant } from '../engine/types';
import { patternById, patterns } from '../data/patterns';
import { problemById, variants } from '../problems';
import { useDsa } from '../store';
import { PageHeader, PatternTag, shuffle } from '../components/common';

export default function Transfer() {
  const [params, setParams] = useSearchParams();
  const done = useDsa((s) => s.transfer);
  const vid = params.get('variant');
  const focus = params.get('pattern') as PatternId | null;
  const current = vid ? variants.find((v) => v.id === vid) : undefined;

  const pickRandom = () => {
    const pool = variants.filter((v) => (!focus || v.pattern === focus) && !done[v.id]);
    const src = pool.length ? pool : variants.filter((v) => !focus || v.pattern === focus);
    const v = shuffle(src.length ? src : variants)[0];
    if (v) setParams({ variant: v.id, ...(focus ? { pattern: focus } : {}) });
  };

  const list = focus ? variants.filter((v) => v.pattern === focus) : variants;
  const solved = Object.values(done).filter((x) => x.correct).length;

  return (
    <div>
      <PageHeader
        eyebrow="Far transfer"
        title="New-problem mode"
        actions={
          <Button variant="primary" icon={<Shuffle className="h-4 w-4" />} onClick={pickRandom}>
            Random unseen problem
          </Button>
        }
      >
        Interviews ask problems you have not seen. These variants are not on the NeetCode list — they re-dress a known pattern in a new story (often a backend
        one). Identify the pattern, write a plan, then compare. {solved}/{variants.length} identified correctly.
      </PageHeader>

      {current ? (
        <VariantCard key={current.id} v={current} onNext={pickRandom} />
      ) : (
        <Callout tone="tip" title="How this works">
          Pick any card below (or a random one). You will: 1) name the pattern, 2) sketch the approach in your own words, 3) compare with a reference approach and
          the closest NeetCode problem.
        </Callout>
      )}

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">{focus ? `Variants · ${patternById[focus]?.name}` : 'All variants'}</h2>
        {focus && (
          <button className="text-xs text-muted underline" onClick={() => setParams(vid ? { variant: vid } : {})}>
            show all
          </button>
        )}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((v) => {
          const r = done[v.id];
          return (
            <button
              key={v.id}
              onClick={() => setParams({ variant: v.id, ...(focus ? { pattern: focus } : {}) })}
              className={cn(
                'flex items-start gap-2 rounded-lg border bg-surface px-3 py-2 text-left text-sm transition hover:border-accent',
                v.id === vid ? 'border-accent' : 'border-line',
              )}
            >
              {r ? r.correct ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" /> : <Compass className="mt-0.5 h-4 w-4 shrink-0 text-faint" />}
              <span className="text-ink">{v.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VariantCard({ v, onNext }: { v: Variant; onNext: () => void }) {
  const record = useDsa((s) => s.recordTransfer);
  const opts = useMemo(() => {
    const others = shuffle(
      patterns.filter((p) => p.id !== v.pattern && p.id !== 'design').map((p) => p.id),
      v.id.length * 17,
    ).slice(0, 5);
    return shuffle([v.pattern, ...others], v.id.length);
  }, [v]);
  const [pick, setPick] = useState<PatternId | null>(null);
  const [plan, setPlan] = useState('');
  const [revealed, setRevealed] = useState(false);
  const near = problemById[v.nearest];
  const ok = pick === v.pattern;

  const reveal = () => {
    setRevealed(true);
    record(v.id, v.pattern, ok, plan);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-5 shadow-paper">
        <div className="eyebrow mb-1">unseen problem</div>
        <h2 className="mb-2 text-lg font-semibold text-ink">{v.title}</h2>
        <p className="text-[15px] leading-relaxed text-ink">{v.statement}</p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="mb-2 text-sm font-semibold text-ink">1 · Which pattern?</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {opts.map((o) => (
            <button
              key={o}
              disabled={revealed}
              onClick={() => setPick(o)}
              className={cn(
                'rounded-lg border px-3 py-2 text-left text-sm transition',
                pick === o ? 'border-accent bg-accent/10' : 'border-line hover:border-ink/30',
                revealed && o === v.pattern && 'border-ok bg-ok/10',
                revealed && pick === o && o !== v.pattern && 'border-bad bg-bad/10',
              )}
            >
              {patternById[o].name}
            </button>
          ))}
        </div>
        <div className="mb-2 mt-4 text-sm font-semibold text-ink">2 · Sketch your approach (data structure, loop, what you track)</div>
        <textarea
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          disabled={revealed}
          rows={4}
          placeholder="e.g. keep a hashmap of … ; slide right pointer …; when … shrink left …"
          className="w-full rounded-md border border-line bg-paper p-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
        />
        {!revealed && (
          <Button className="mt-2" variant="primary" disabled={!pick} onClick={reveal}>
            {plan.trim() ? 'Compare with reference' : 'Reveal (try writing a plan first!)'}
          </Button>
        )}
      </div>

      {revealed && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
            <div className={cn('flex items-center gap-2 font-medium', ok ? 'text-ok' : 'text-bad')}>
              {ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {ok ? 'Right pattern.' : 'Different pattern:'} <PatternTag id={v.pattern} />
            </div>
            <div>
              <div className="eyebrow mb-1">signals</div>
              <ul className="ml-5 list-disc text-sm text-ink">
                {v.signals.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="eyebrow mb-1">reference approach</div>
              <p className="text-sm leading-relaxed text-ink">{v.approach}</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border-2 border-info/30 bg-info/5 p-4">
              <div className="mb-1 flex items-center gap-2">
                <Server className="h-4 w-4 text-info" />
                <span className="eyebrow !text-info">backend angle</span>
              </div>
              <p className="text-sm leading-relaxed text-ink">{v.backend}</p>
            </div>
            {near && (
              <div className="rounded-xl border border-line bg-surface p-4 text-sm">
                <div className="eyebrow mb-1">closest NeetCode problem</div>
                <Link to={`/dsa/problem/${near.id}?tab=visualize`} className="font-medium text-accent underline">
                  {near.num}. {near.title}
                </Link>
                <p className="mt-1 text-muted">Watch it run and ask: what exactly changes in the variant — the state, the loop condition, or the answer update?</p>
              </div>
            )}
            <Button variant="secondary" icon={<Shuffle className="h-4 w-4" />} onClick={onNext}>
              Another unseen problem
            </Button>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
