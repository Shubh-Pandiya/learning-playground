import { Component, Fragment, useEffect, useRef, type ReactNode } from 'react';
import { Highlight, type PrismTheme } from 'prism-react-renderer';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, CircleDot, Database, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import { Tag, type Tone } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { Cell } from '../engine/core';
import { useDbStatus } from '../engine/db';
import type { Concept, Level, TrackId } from '../types';
import { mastery, MASTERY_LABELS, type ConceptProgress } from '../store';

/* ---------------------------------------------------------------- prose */

/** Renders the tiny markdown subset used in content: `code` and **bold**. */
export function Md({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') ? (
          <code key={i} className="rounded bg-sunken px-1 py-px font-mono text-[0.88em] text-ink">
            {p.slice(1, -1)}
          </code>
        ) : p.startsWith('**') && p.endsWith('**') ? (
          <strong key={i} className="font-semibold text-ink">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </span>
  );
}

export function Paras({ items, className }: { items: string[]; className?: string }) {
  return (
    <div className={cn('space-y-2.5 text-[14px] leading-relaxed text-muted', className)}>
      {items.map((t, i) => (
        <p key={i}>
          <Md text={t} />
        </p>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- tags */

export const trackTone: Record<TrackId, Tone> = {
  mechanics: 'accent',
  windows: 'info',
  ctes: 'violet',
  analytics: 'ok',
  performance: 'warn',
  transactions: 'bad',
};
const levelTone: Record<Level, Tone> = { core: 'ok', intermediate: 'warn', advanced: 'bad' };
export const LevelTag = ({ level }: { level: Level }) => <Tag tone={levelTone[level]}>{level}</Tag>;

export function InterviewHeat({ n }: { n: 1 | 2 | 3 }) {
  const label = n === 3 ? 'asked in most SQL rounds' : n === 2 ? 'commonly asked' : 'sometimes asked';
  return (
    <span className="inline-flex items-center gap-0.5" title={`Interview frequency: ${label}`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={cn('h-2 w-1.5 rounded-sm', i <= n ? 'bg-accent' : 'bg-line')} />
      ))}
    </span>
  );
}

export function MasteryDots({ c, p, className }: { c: Concept; p?: ConceptProgress; className?: string }) {
  const m = mastery(c, p);
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} title={`Mastery: ${MASTERY_LABELS[m]}`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cn('h-1.5 w-3 rounded-full', i <= m ? (m === 4 ? 'bg-ok' : 'bg-accent') : 'bg-line')} />
      ))}
    </span>
  );
}

export function StatusIcon({ c, p, className }: { c: Concept; p?: ConceptProgress; className?: string }) {
  const m = mastery(c, p);
  const cls = cn('h-4 w-4 shrink-0', className);
  if (m >= 4) return <Sparkles className={cn(cls, 'text-ok')} aria-label="mastered" />;
  if (m >= 2) return <CheckCircle2 className={cn(cls, 'text-ok')} aria-label="built" />;
  if (m === 1) return <CircleDot className={cn(cls, 'text-accent')} aria-label="explored" />;
  return <Circle className={cn(cls, 'text-faint')} aria-label="new" />;
}

export function ConceptLink({ c, className }: { c: Concept; className?: string }) {
  return (
    <Link to={`/sql/c/${c.id}`} className={cn('hover:underline', className)}>
      {c.title}
    </Link>
  );
}

/* ---------------------------------------------------------------- layout */

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
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
export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: keyof typeof statTone }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-paper">
      <div className="eyebrow">{label}</div>
      <div className={cn('mt-1 font-mono text-2xl font-semibold', tone ? statTone[tone] : 'text-ink')}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-faint">{hint}</div>}
    </div>
  );
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

/* ---------------------------------------------------------------- DB status */

export function DbBadge() {
  const { phase, bootMs, error } = useDbStatus();
  if (phase === 'error')
    return (
      <Tag tone="bad" icon={<TriangleAlert className="h-3 w-3" />} title={error}>
        database error
      </Tag>
    );
  if (phase === 'ready' || phase === 'idle')
    return (
      <Tag tone={phase === 'ready' ? 'ok' : 'neutral'} icon={<Database className="h-3 w-3" />} title="Postgres 17 compiled to WebAssembly, running in a Web Worker in your browser">
        {phase === 'ready' ? `Postgres ready${bootMs ? ` · ${(bootMs / 1000).toFixed(1)}s boot` : ''}` : 'Postgres idle'}
      </Tag>
    );
  const label = phase === 'loading-perf' ? 'loading 220k-row perf tables…' : phase === 'restarting' ? 're-seeding…' : 'booting Postgres…';
  return (
    <Tag tone="info" icon={<Loader2 className="h-3 w-3 animate-spin" />}>
      {label}
    </Tag>
  );
}

/* ---------------------------------------------------------------- SQL editor */

const sqlTheme: PrismTheme = {
  plain: { color: 'rgb(var(--c-ink))', backgroundColor: 'transparent' },
  styles: [
    { types: ['comment'], style: { color: 'rgb(var(--c-faint))', fontStyle: 'italic' } },
    { types: ['keyword', 'operator', 'important'], style: { color: 'rgb(var(--c-accent))' } },
    { types: ['string', 'char'], style: { color: 'rgb(var(--c-ok))' } },
    { types: ['number', 'boolean', 'constant'], style: { color: 'rgb(var(--c-violet))' } },
    { types: ['function', 'builtin'], style: { color: 'rgb(var(--c-info))' } },
    { types: ['punctuation'], style: { color: 'rgb(var(--c-muted))' } },
  ],
};

/** Lightweight SQL editor: a transparent textarea over a Prism-highlighted <pre>. ⌘/Ctrl+Enter runs. */
export function SqlEditor({
  value,
  onChange,
  onRun,
  minRows = 6,
  className,
  readOnly,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onRun?: () => void;
  minRows?: number;
  className?: string;
  readOnly?: boolean;
  placeholder?: string;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const lines = Math.max(minRows, value.split('\n').length + 1);
  useEffect(() => {
    if (pre.current && ta.current) pre.current.scrollLeft = ta.current.scrollLeft;
  });
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onRun?.();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: a, selectionEnd: b } = el;
      const next = value.slice(0, a) + '  ' + value.slice(b);
      onChange(next);
      requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
    }
  };
  const common = 'm-0 whitespace-pre p-3 font-mono text-[12.5px] leading-[1.65]';
  return (
    <div className={cn('relative overflow-hidden rounded-md border border-line bg-sunken focus-within:border-accent/60', className)} style={{ minHeight: `${lines * 1.65 * 12.5 + 24}px` }}>
      <Highlight code={value || ' '} language="sql" theme={sqlTheme}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <pre ref={pre} aria-hidden className={cn(common, 'pointer-events-none absolute inset-0 overflow-hidden')}>
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                {line.map((t, k) => (
                  <span key={k} {...getTokenProps({ token: t })} />
                ))}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
      <textarea
        ref={ta}
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        onScroll={(e) => pre.current && (pre.current.scrollLeft = e.currentTarget.scrollLeft)}
        className={cn(common, 'absolute inset-0 h-full w-full resize-none overflow-x-auto bg-transparent text-transparent caret-ink outline-none placeholder:text-faint')}
        aria-label="SQL editor"
      />
    </div>
  );
}

/* ---------------------------------------------------------------- result table */

export function CellView({ v }: { v: Cell }) {
  if (v === null) return <span className="italic text-faint">NULL</span>;
  if (typeof v === 'boolean') return <span className={v ? 'text-ok' : 'text-bad'}>{String(v)}</span>;
  return <>{String(v)}</>;
}

export type RowMark = 'added' | 'removed' | 'dropped' | 'nullext' | 'fanout' | 'ghost' | 'rightonly' | undefined;

const markCls: Record<Exclude<RowMark, undefined>, string> = {
  added: 'bg-ok/10',
  removed: 'bg-bad/10 text-faint line-through',
  dropped: 'bg-bad/5 text-faint line-through decoration-bad/60',
  ghost: 'bg-bad/5 text-faint line-through decoration-bad/60',
  nullext: 'bg-info/10',
  fanout: 'bg-warn/10',
  rightonly: 'bg-violet/10',
};

export const GROUP_COLORS = ['bg-accent', 'bg-info', 'bg-ok', 'bg-violet', 'bg-warn', 'bg-bad'];

export function ResultTable({
  columns,
  rows,
  marks,
  groupIds,
  newCols,
  extraCols,
  maxHeight = 360,
  onRowHover,
  rowClass,
  dense,
  caption,
}: {
  columns: string[];
  rows: Cell[][];
  marks?: RowMark[];
  groupIds?: number[];
  newCols?: number[];
  /** Extra rendered columns appended to the right (e.g. WHERE truth values). */
  extraCols?: { title: string; render: (rowIndex: number) => ReactNode }[];
  maxHeight?: number;
  onRowHover?: (i: number | null) => void;
  rowClass?: (i: number) => string | undefined;
  dense?: boolean;
  caption?: ReactNode;
}) {
  return (
    <div className="overflow-auto rounded-md border border-line bg-surface" style={{ maxHeight }} onMouseLeave={() => onRowHover?.(null)}>
      {caption && <div className="border-b border-line px-3 py-1.5 text-xs text-muted">{caption}</div>}
      <table className="w-full border-collapse font-mono text-[12px]">
        <thead className="sticky top-0 z-[1] bg-sunken">
          <tr>
            {groupIds && <th className="w-1.5 p-0" />}
            {columns.map((c, i) => (
              <th key={i} className={cn('whitespace-nowrap border-b border-line px-2.5 text-left font-medium text-muted', dense ? 'py-1' : 'py-1.5', newCols?.includes(i) && 'bg-accent/15 text-accent')}>
                {c}
              </th>
            ))}
            {extraCols?.map((c) => (
              <th key={c.title} className={cn('whitespace-nowrap border-b border-l border-line px-2.5 text-left font-medium text-info', dense ? 'py-1' : 'py-1.5')}>
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const m = marks?.[i];
            return (
              <tr key={i} className={cn('border-b border-line/60 last:border-0', m && markCls[m], rowClass?.(i))} onMouseEnter={() => onRowHover?.(i)}>
                {groupIds && (
                  <td className="w-1.5 p-0">
                    <div className={cn('h-full min-h-[22px] w-1.5', groupIds[i] >= 0 ? GROUP_COLORS[groupIds[i] % GROUP_COLORS.length] : '')} />
                  </td>
                )}
                {r.map((v, j) => (
                  <td key={j} className={cn('whitespace-nowrap px-2.5', dense ? 'py-0.5' : 'py-1', typeof v === 'number' && 'text-right tabular-nums', newCols?.includes(j) && 'bg-accent/5 font-semibold text-ink')}>
                    <CellView v={v} />
                  </td>
                ))}
                {extraCols?.map((c) => (
                  <td key={c.title} className={cn('whitespace-nowrap border-l border-line px-2.5', dense ? 'py-0.5' : 'py-1')}>
                    {c.render(i)}
                  </td>
                ))}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + (extraCols?.length ?? 0) + (groupIds ? 1 : 0)} className="px-3 py-4 text-center text-xs italic text-faint">
                0 rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Truth({ v }: { v: boolean | null }) {
  if (v === null) return <span className="rounded bg-warn/15 px-1 text-warn">NULL</span>;
  return v ? <span className="text-ok">TRUE</span> : <span className="text-bad">FALSE</span>;
}

export function SqlErrorBox({ message, hint, className }: { message: string; hint?: string; className?: string }) {
  return (
    <div className={cn('rounded-md border border-bad/40 bg-bad/5 px-3 py-2 font-mono text-xs text-bad', className)}>
      {message}
      {hint && <div className="mt-1 font-sans text-muted">Hint: {hint}</div>}
    </div>
  );
}
