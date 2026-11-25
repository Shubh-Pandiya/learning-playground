import { Component, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, CircleDot, Sparkles } from 'lucide-react';
import { Tag, type Tone as TagTone } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { Difficulty, PatternId } from '../engine/types';
import { patternById } from '../data/patterns';
import { mastery, MASTERY_LABELS, type ProblemProgress } from '../store';

export const diffTone: Record<Difficulty, TagTone> = { Easy: 'ok', Medium: 'warn', Hard: 'bad' };

export function DifficultyTag({ d }: { d: Difficulty }) {
  return <Tag tone={diffTone[d]}>{d}</Tag>;
}

/** Each pattern family gets a stable colour so the brain can bind colour ↔ pattern (dual coding). */
const familyTone: Record<PatternId, TagTone> = {
  hashing: 'accent',
  'prefix-sum': 'accent',
  'two-pointers': 'info',
  'sliding-window': 'info',
  stack: 'violet',
  'monotonic-stack': 'violet',
  'binary-search': 'ok',
  'linked-list': 'warn',
  'fast-slow': 'warn',
  'tree-dfs': 'ok',
  'tree-bfs': 'ok',
  bst: 'ok',
  trie: 'violet',
  heap: 'bad',
  backtracking: 'bad',
  'graph-traversal': 'info',
  'topo-sort': 'info',
  'union-find': 'info',
  'weighted-graph': 'info',
  'dp-1d': 'accent',
  'dp-2d': 'accent',
  greedy: 'warn',
  intervals: 'warn',
  matrix: 'neutral',
  math: 'neutral',
  bits: 'neutral',
  design: 'violet',
};
export const patternTone = (id: PatternId) => familyTone[id] ?? 'neutral';

export function PatternTag({ id, link = true, className }: { id: PatternId; link?: boolean; className?: string }) {
  const p = patternById[id];
  const tag = (
    <Tag tone={patternTone(id)} variant="outline" className={className}>
      {p?.name ?? id}
    </Tag>
  );
  return link ? (
    <Link to={`/dsa/patterns/${id}`} className="hover:opacity-80" onClick={(e) => e.stopPropagation()}>
      {tag}
    </Link>
  ) : (
    tag
  );
}

export function MasteryDots({ p, className }: { p?: ProblemProgress; className?: string }) {
  const m = mastery(p);
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} title={`Mastery: ${MASTERY_LABELS[m]}`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cn('h-1.5 w-3 rounded-full', i <= m ? (m === 4 ? 'bg-ok' : 'bg-accent') : 'bg-line')} />
      ))}
    </span>
  );
}

export function StatusIcon({ p, className }: { p?: ProblemProgress; className?: string }) {
  const m = mastery(p);
  const cls = cn('h-4 w-4 shrink-0', className);
  if (m >= 4) return <Sparkles className={cn(cls, 'text-ok')} aria-label="mastered" />;
  if (m >= 2) return <CheckCircle2 className={cn(cls, 'text-ok')} aria-label="built" />;
  if (m === 1) return <CircleDot className={cn(cls, 'text-accent')} aria-label="explored" />;
  return <Circle className={cn(cls, 'text-faint')} aria-label="new" />;
}

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {children && <div className="mt-2 text-sm leading-relaxed text-muted">{children}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

const statTone = { accent: 'text-accent', ok: 'text-ok', warn: 'text-warn', info: 'text-info' };

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: 'accent' | 'ok' | 'warn' | 'info' }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-paper">
      <div className="eyebrow">{label}</div>
      <div className={cn('mt-1 font-mono text-2xl font-semibold', tone ? statTone[tone] : 'text-ink')}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-faint">{hint}</div>}
    </div>
  );
}

export function shuffle<T>(arr: T[], seed?: number): T[] {
  const a = [...arr];
  let s = seed ?? Math.floor(Math.random() * 2 ** 31);
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-xl border border-bad/40 bg-bad/5 p-5 text-sm">
        <div className="font-semibold text-bad">Something broke while rendering this view.</div>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-muted">{this.state.error.message}</pre>
        <button className="mt-3 text-xs underline" onClick={() => this.setState({ error: null })}>
          try again
        </button>
      </div>
    );
  }
}
