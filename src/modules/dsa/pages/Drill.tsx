import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, RotateCcw, Shuffle, Timer, XCircle } from 'lucide-react';
import { Button, ProgressBar } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { PatternId } from '../engine/types';
import { patternById, patterns } from '../data/patterns';
import { categoryById } from '../data/categories';
import { problems, problemById, variants } from '../problems';
import { useDsa } from '../store';
import { PageHeader, PatternTag, shuffle } from '../components/common';

interface Item {
  key: string;
  statement: string;
  title: string;
  pattern: PatternId;
  signals: string[];
  link: string;
  source: string;
}

/** Patterns that are easy to confuse with each other — used as the hardest distractors. */
const confusable: Partial<Record<PatternId, PatternId[]>> = {
  'two-pointers': ['sliding-window', 'binary-search', 'hashing'],
  'sliding-window': ['two-pointers', 'prefix-sum', 'hashing'],
  hashing: ['two-pointers', 'prefix-sum', 'heap'],
  'prefix-sum': ['sliding-window', 'hashing', 'dp-1d'],
  stack: ['monotonic-stack', 'backtracking', 'tree-dfs'],
  'monotonic-stack': ['stack', 'sliding-window', 'heap'],
  'binary-search': ['two-pointers', 'greedy', 'heap'],
  heap: ['binary-search', 'hashing', 'greedy'],
  backtracking: ['dp-1d', 'graph-traversal', 'tree-dfs'],
  'dp-1d': ['greedy', 'backtracking', 'dp-2d'],
  'dp-2d': ['dp-1d', 'backtracking', 'graph-traversal'],
  greedy: ['dp-1d', 'intervals', 'heap'],
  intervals: ['greedy', 'heap', 'two-pointers'],
  'graph-traversal': ['union-find', 'topo-sort', 'tree-bfs'],
  'topo-sort': ['graph-traversal', 'union-find', 'dp-1d'],
  'union-find': ['graph-traversal', 'topo-sort', 'weighted-graph'],
  'weighted-graph': ['graph-traversal', 'heap', 'dp-2d'],
  'tree-dfs': ['tree-bfs', 'bst', 'backtracking'],
  'tree-bfs': ['tree-dfs', 'graph-traversal', 'stack'],
  bst: ['tree-dfs', 'binary-search', 'tree-bfs'],
  'linked-list': ['fast-slow', 'two-pointers', 'design'],
  'fast-slow': ['linked-list', 'two-pointers', 'hashing'],
};

function optionsFor(p: PatternId, seed: number): PatternId[] {
  const hard = confusable[p] ?? [];
  const rest = shuffle(
    patterns.map((x) => x.id).filter((x) => x !== p && !hard.includes(x) && x !== 'design'),
    seed,
  );
  const picks = [...shuffle(hard, seed).slice(0, 2), ...rest].slice(0, 3);
  return shuffle([p, ...picks], seed + 1);
}

function buildDeck(focus: PatternId | null, n = 10): Item[] {
  const probItems: Item[] = problems.map((p) => ({
    key: `p:${p.id}`,
    statement: p.statement,
    title: `${p.num}. ${p.title}`,
    pattern: p.pattern,
    signals: p.signals,
    link: `/dsa/problem/${p.id}`,
    source: categoryById[p.category]?.name ?? '',
  }));
  const varItems: Item[] = variants.map((v) => ({
    key: `v:${v.id}`,
    statement: v.statement,
    title: v.title,
    pattern: v.pattern,
    signals: v.signals,
    link: `/dsa/transfer?variant=${v.id}`,
    source: `unseen variant · like ${problemById[v.nearest]?.title ?? v.nearest}`,
  }));
  const all = [...probItems, ...varItems];
  if (!focus) {
    // interleave: never two of the same pattern in a row
    const pool = shuffle(all);
    const out: Item[] = [];
    for (const it of pool) {
      if (out.length >= n) break;
      if (out.length && out[out.length - 1].pattern === it.pattern) continue;
      out.push(it);
    }
    return out;
  }
  // focused drill still mixes ~40% other patterns so you must discriminate, not just repeat
  const mine = shuffle(all.filter((x) => x.pattern === focus)).slice(0, Math.ceil(n * 0.6));
  const others = shuffle(all.filter((x) => x.pattern !== focus)).slice(0, n - mine.length);
  return shuffle([...mine, ...others]);
}

export default function Drill() {
  const [params, setParams] = useSearchParams();
  const focus = (params.get('pattern') as PatternId | null) ?? null;
  const [round, setRound] = useState(0);
  const deck = useMemo(() => buildDeck(focus), [focus, round]); // eslint-disable-line react-hooks/exhaustive-deps
  const [i, setI] = useState(0);
  const [pick, setPick] = useState<PatternId | null>(null);
  const [score, setScore] = useState<boolean[]>([]);
  const [started, setStarted] = useState(() => Date.now());
  const [times, setTimes] = useState<number[]>([]);
  const recordDrill = useDsa((s) => s.recordDrill);

  const item = deck[i];
  const opts = useMemo(() => (item ? optionsFor(item.pattern, i * 31 + round * 7 + item.statement.length) : []), [item, i, round]);

  const restart = () => {
    setRound((r) => r + 1);
    setI(0);
    setPick(null);
    setScore([]);
    setTimes([]);
    setStarted(Date.now());
  };

  const choose = (p: PatternId) => {
    if (pick) return;
    setPick(p);
    const ok = p === item.pattern;
    setScore((s) => [...s, ok]);
    setTimes((t) => [...t, (Date.now() - started) / 1000]);
    recordDrill(item.pattern, ok);
  };
  const next = () => {
    setPick(null);
    setI((x) => x + 1);
    setStarted(Date.now());
  };

  const done = i >= deck.length;
  const right = score.filter(Boolean).length;
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Interleaved practice"
        title="Pattern recognition drill"
        actions={
          <select
            value={focus ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              setParams(v ? { pattern: v } : {});
              restart();
            }}
            className="h-8 rounded-md border border-line bg-surface px-2 text-xs text-ink"
          >
            <option value="">mixed — all patterns</option>
            {patterns.map((p) => (
              <option key={p.id} value={p.id}>
                focus: {p.name}
              </option>
            ))}
          </select>
        }
      >
        Read the problem, pick the pattern. In an interview the hardest part is not coding — it is knowing <i>which</i> tool to pick. Problems are shuffled across
        categories (interleaving) so you learn to tell patterns apart, and some are brand-new variants you have never seen.
      </PageHeader>

      <div className="mb-4 flex items-center gap-3">
        <ProgressBar value={Math.min(i, deck.length)} max={deck.length} size="sm" className="flex-1" />
        <span className="font-mono text-xs text-muted">
          {right}/{score.length} right
        </span>
      </div>

      {done ? (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="rounded-xl border border-line bg-surface p-6 text-center shadow-paper">
          <div className="text-4xl font-semibold text-ink">
            {right}/{deck.length}
          </div>
          <p className="mt-1 text-sm text-muted">average {avg.toFixed(1)}s per decision</p>
          <p className="mx-auto mt-3 max-w-md text-sm text-ink">
            {right === deck.length
              ? 'Perfect round. Push yourself: aim to decide in under 15 seconds.'
              : 'Every miss is a signal you have not bound to a pattern yet. Open the misses below and re-read their signals.'}
          </p>
          <div className="mt-4 space-y-1 text-left">
            {deck.map((d, k) => (
              <Link key={d.key} to={d.link} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-sunken/50">
                {score[k] ? <CheckCircle2 className="h-4 w-4 text-ok" /> : <XCircle className="h-4 w-4 text-bad" />}
                <span className="flex-1 text-ink">{d.title}</span>
                <PatternTag id={d.pattern} link={false} />
              </Link>
            ))}
          </div>
          <Button className="mt-5" variant="primary" icon={<Shuffle className="h-4 w-4" />} onClick={restart}>
            New round
          </Button>
        </motion.div>
      ) : (
        <motion.div key={item.key} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
          <div className="rounded-xl border border-line bg-surface p-5 shadow-paper">
            <div className="mb-2 flex items-center justify-between text-[11px] text-faint">
              <span>
                {i + 1} / {deck.length}
              </span>
              <span className="inline-flex items-center gap-1">
                <Timer className="h-3 w-3" /> decide fast — first instinct, then check
              </span>
            </div>
            <p className="text-[15px] leading-relaxed text-ink">{item.statement}</p>
            {pick && (
              <div className="mt-3 text-xs text-muted">
                {item.title} · {item.source}
              </div>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {opts.map((o) => {
              const p = patternById[o];
              const isAns = o === item.pattern;
              return (
                <button
                  key={o}
                  onClick={() => choose(o)}
                  disabled={!!pick}
                  className={cn(
                    'rounded-lg border px-4 py-3 text-left transition',
                    !pick && 'border-line bg-surface hover:-translate-y-0.5 hover:border-accent hover:shadow-paper',
                    pick && isAns && 'border-ok bg-ok/10',
                    pick === o && !isAns && 'border-bad bg-bad/10',
                    pick && !isAns && pick !== o && 'opacity-40',
                  )}
                >
                  <div className="font-medium text-ink">{p.name}</div>
                  <div className="text-xs text-muted">{p.tagline}</div>
                </button>
              );
            })}
          </div>
          {pick && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-line bg-sunken/40 p-4">
              <div className={cn('mb-2 flex items-center gap-2 font-medium', pick === item.pattern ? 'text-ok' : 'text-bad')}>
                {pick === item.pattern ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {pick === item.pattern ? 'Correct.' : `It's ${patternById[item.pattern].name}.`} Signals to notice:
              </div>
              <ul className="ml-6 list-disc space-y-0.5 text-sm text-ink">
                {item.signals.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-between">
                <Link to={item.link} className="text-xs text-muted underline hover:text-ink">
                  open this problem
                </Link>
                <Button variant="primary" size="sm" onClick={next} autoFocus>
                  Next →
                </Button>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}

      {!done && score.length > 0 && (
        <button onClick={restart} className="mt-6 inline-flex items-center gap-1 text-xs text-faint hover:text-muted">
          <RotateCcw className="h-3 w-3" /> restart round
        </button>
      )}
    </div>
  );
}
