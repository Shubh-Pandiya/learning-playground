import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search, Server } from 'lucide-react';
import { ProgressBar } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { Difficulty, PatternId } from '../engine/types';
import { categories } from '../data/categories';
import { patterns } from '../data/patterns';
import { problems, problemsByCategory } from '../problems';
import { isProblemDue, isSolved, mastery, useDsa } from '../store';
import { DifficultyTag, MasteryDots, PageHeader, PatternTag, StatusIcon } from '../components/common';

type Status = 'all' | 'new' | 'started' | 'solved' | 'due';

export default function ProblemList() {
  const prog = useDsa((s) => s.problems);
  const [q, setQ] = useState('');
  const [diff, setDiff] = useState<Difficulty | 'all'>('all');
  const [status, setStatus] = useState<Status>('all');
  const [pattern, setPattern] = useState<PatternId | 'all'>('all');
  const [hidePatterns, setHidePatterns] = useState(false);
  const { hash } = useLocation();

  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash]);

  const match = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (id: string) => {
      const p = problems.find((x) => x.id === id)!;
      const pr = prog[id];
      if (diff !== 'all' && p.difficulty !== diff) return false;
      if (pattern !== 'all' && p.pattern !== pattern) return false;
      if (status === 'new' && mastery(pr) > 0) return false;
      if (status === 'started' && (mastery(pr) === 0 || isSolved(pr))) return false;
      if (status === 'solved' && !isSolved(pr)) return false;
      if (status === 'due' && !isProblemDue(pr)) return false;
      if (needle && !`${p.num} ${p.title} ${p.backend.title} ${p.signals.join(' ')}`.toLowerCase().includes(needle)) return false;
      return true;
    };
  }, [q, diff, status, pattern, prog]);

  const solved = problems.filter((p) => isSolved(prog[p.id])).length;

  return (
    <div>
      <PageHeader eyebrow="NeetCode 150" title="Problems">
        Grouped in roadmap order. Each one has a step-through visualization, a drag-and-drop builder and a backend use-case. {solved}/{problems.length} built.
      </PageHeader>

      <div className="sticky top-[var(--header-h,3.5rem)] z-10 -mx-2 mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-paper/95 px-3 py-2 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search title, signal, backend use…"
            className="h-8 w-64 rounded-md border border-line bg-surface pl-7 pr-2 text-xs text-ink focus:border-accent focus:outline-none"
          />
        </div>
        <Seg value={diff} onChange={setDiff} options={['all', 'Easy', 'Medium', 'Hard']} />
        <Seg value={status} onChange={setStatus} options={['all', 'new', 'started', 'solved', 'due']} />
        <select
          value={pattern}
          onChange={(e) => setPattern(e.target.value as PatternId | 'all')}
          className="h-8 rounded-md border border-line bg-surface px-2 text-xs text-ink"
        >
          <option value="all">all patterns</option>
          {patterns.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={hidePatterns} onChange={(e) => setHidePatterns(e.target.checked)} />
          hide pattern labels (practise recognition)
        </label>
      </div>

      <div className="space-y-8">
        {categories.map((c) => {
          const list = problemsByCategory(c.id);
          const shown = list.filter((p) => match(p.id));
          if (!shown.length) return null;
          const done = list.filter((p) => isSolved(prog[p.id])).length;
          return (
            <section key={c.id} id={c.id} className="scroll-mt-32">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-ink">
                    <span className="mr-2 font-mono text-sm text-faint">{String(c.order).padStart(2, '0')}</span>
                    {c.name}
                  </h2>
                  <p className="text-xs text-muted">{c.blurb}</p>
                </div>
                <div className="w-48">
                  <ProgressBar value={done} max={list.length} size="xs" showValue="fraction" tone="ok" />
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-paper">
                {shown.map((p) => {
                  const pr = prog[p.id];
                  const due = isProblemDue(pr);
                  return (
                    <Link
                      key={p.id}
                      to={`/dsa/problem/${p.id}`}
                      className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 border-t border-line/60 px-4 py-2.5 first:border-t-0 hover:bg-sunken/40 md:grid-cols-[auto_minmax(0,2fr)_minmax(0,2fr)_auto_auto]"
                    >
                      <StatusIcon p={pr} />
                      <div className="min-w-0">
                        <div className="truncate text-sm text-ink group-hover:text-accent">
                          <span className="mr-1.5 font-mono text-xs text-faint">{p.num}.</span>
                          {p.title}
                          {due && <span className="ml-2 rounded bg-warn/15 px-1.5 text-[10px] font-medium text-warn">review due</span>}
                        </div>
                      </div>
                      <div className="hidden min-w-0 items-center gap-1.5 truncate text-xs text-muted md:flex">
                        <Server className="h-3 w-3 shrink-0 text-info" />
                        <span className="truncate">{p.backend.title}</span>
                      </div>
                      <div className={cn('hidden md:block', hidePatterns && 'invisible')}>
                        <PatternTag id={p.pattern} link={false} />
                      </div>
                      <div className="flex items-center gap-3">
                        <MasteryDots p={pr} className="hidden sm:inline-flex" />
                        <DifficultyTag d={p.difficulty} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: T[] }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn('rounded px-2 py-1 text-[11px] capitalize', value === o ? 'bg-ink text-paper' : 'text-muted hover:text-ink')}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
