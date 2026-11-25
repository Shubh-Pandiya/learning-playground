import { useId, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Circle, KeyRound, Link2 } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Tag } from '@/shared/ui';
import { ChangeCard, type Change } from '../../ui/ChangeCard';
import type { LabTopic } from '../../types';
import { useDm } from '../../store';
import { analyzeNF, laneKind, lanesFor, NF_LABEL, showVal, type FD, type NF, type Row, type Tbl } from './engine';

/* ───────────────────────── layout shell ───────────────────────── */

export function Shell({ header, footer, left, center }: { header: ReactNode; footer: ReactNode; left: ReactNode; center: ReactNode }) {
  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[390px] shrink-0 flex-col border-r border-line bg-paper">
        {header}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{left}</div>
        {footer}
      </aside>
      <main className="bg-grid relative min-w-0 flex-1 overflow-auto bg-sunken/60">{center}</main>
    </div>
  );
}

export function Checklist({ topic }: { topic: LabTopic }) {
  const done = useDm((s) => s.topics[topic.id]?.exercises) ?? {};
  const n = topic.exercises.filter((e) => done[e.id]).length;
  return (
    <div className="border-t border-line px-4 py-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="eyebrow">Exercises</span>
        <span className="font-mono text-[11px] tabular-nums text-muted">
          {n}/{topic.exercises.length}
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {topic.exercises.map((e) => (
          <li key={e.id} className={cn('flex items-center gap-1.5 text-[11.5px]', done[e.id] ? 'text-ink' : 'text-muted')}>
            {done[e.id] ? <CheckCircle2 size={13} className="shrink-0 text-ok" /> : <Circle size={13} className="shrink-0 text-faint" />}
            <span className="truncate">{e.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Latest change on top, two older ones compact. */
export function ChangeFeed({ changes, label = 'What changed' }: { changes: Change[]; label?: string }) {
  if (!changes.length) return null;
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div className="space-y-1.5">
        <AnimatePresence initial={false} mode="popLayout">
          {changes.slice(0, 3).map((c, i) => (
            <motion.div key={c.key} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: i === 0 ? 1 : 0.6, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              <ChangeCard change={c} compact={i > 0} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function NFBadge({ nf }: { nf: NF }) {
  const tone = nf === 4 ? 'ok' : nf === 3 ? 'info' : nf === 0 ? 'bad' : 'warn';
  return (
    <Tag size="sm" tone={tone} variant="soft">
      {NF_LABEL[nf]}
    </Tag>
  );
}

export const TONE_TEXT = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', info: 'text-info' } as const;

export function Metric({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'info' }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
      <div className="eyebrow !text-[9.5px]">{label}</div>
      <div className={cn('font-mono text-[15px] font-semibold tabular-nums leading-tight', tone ? TONE_TEXT[tone] : 'text-ink')}>{value}</div>
      {sub && <div className="text-[10.5px] leading-snug text-muted">{sub}</div>}
    </div>
  );
}

/* ───────────────────────── FD lanes ───────────────────────── */

const KIND_STYLE: Record<string, { color: string; label: string }> = {
  key: { color: 'ok', label: 'key' },
  partial: { color: 'bad', label: 'partial · breaks 2NF' },
  transitive: { color: 'warn', label: 'transitive · breaks 3NF' },
  bcnf: { color: 'violet', label: 'non-key → key part · breaks BCNF' },
  repeating: { color: 'faint', label: 'inside a list' },
  derived: { color: 'info', label: 'implied · intermediate gone' },
  neutral: { color: 'muted', label: '' },
};

const LANE_GAP = 14;

export function FDLanes({
  cols,
  fds,
  multi,
  colW,
  focus,
  neutral,
}: {
  cols: string[];
  fds: FD[];
  multi?: string[];
  colW: number;
  focus?: string[][] | null;
  /** Draw every lane in one colour with no label (drills: don't give the answer away). */
  neutral?: boolean;
}) {
  const uid = useId().replace(/:/g, '');
  const lanes = lanesFor(cols, fds);
  if (!lanes.length) return null;
  const H = 8 + lanes.length * LANE_GAP + 6;
  const W = cols.length * colW;
  const fx = (c: string, i: number) => cols.indexOf(c) * colW + colW / 2 + (i - (lanes.length - 1) / 2) * 5;
  return (
    <svg width={W} height={H} className="block overflow-visible">
      <defs>
        {Object.values(KIND_STYLE).map((k) => (
          <marker key={k.color} id={`${uid}-${k.color}`} viewBox="0 0 8 8" refX="4" refY="7" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,0 L4,8 z" fill={`rgb(var(--c-${k.color}))`} />
          </marker>
        ))}
      </defs>
      {lanes.map((l, i) => {
        const kind = neutral ? 'neutral' : l.derived ? 'derived' : laneKind(l, cols, fds, multi);
        const st = KIND_STYLE[kind];
        const isFocus = !!focus && focus.some((f) => f.join() === l.lhs.join()) && !l.derived;
        const dim = !!focus && !isFocus && kind !== 'derived';
        const y = 8 + i * LANE_GAP;
        const xs = [...l.lhs, ...l.rhs].map((c) => fx(c, i));
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const stroke = `rgb(var(--c-${st.color}))`;
        const sw = isFocus ? 2.2 : 1.3;
        const labelW = st.label.length * 5.8;
        const labelRight = maxX + 8 + labelW <= W || minX - 8 - labelW < 0;
        return (
          <motion.g key={`${l.lhs.join()}>${l.rhs.join()}`} initial={{ opacity: 0 }} animate={{ opacity: dim ? 0.35 : 1 }} transition={{ duration: 0.4, delay: i * 0.05 }}>
            <line x1={minX} y1={y} x2={maxX} y2={y} stroke={stroke} strokeWidth={sw} strokeDasharray={l.derived ? '4 3' : undefined} className={isFocus ? 'animate-pulse-soft' : undefined} />
            {l.lhs.map((c) => (
              <g key={`l${c}`}>
                <line x1={fx(c, i)} y1={y} x2={fx(c, i)} y2={H} stroke={stroke} strokeWidth={sw} />
                <circle cx={fx(c, i)} cy={y} r={isFocus ? 3.2 : 2.4} fill={stroke} />
              </g>
            ))}
            {l.rhs.map((c) => (
              <line key={`r${c}`} x1={fx(c, i)} y1={y} x2={fx(c, i)} y2={H - 2} stroke={stroke} strokeWidth={sw} markerEnd={`url(#${uid}-${st.color})`} />
            ))}
            <text
              x={labelRight ? maxX + 7 : minX - 7}
              y={y + 3.5}
              textAnchor={labelRight ? 'start' : 'end'}
              className="font-mono"
              fontSize={9.5}
              fill={stroke}
              fontWeight={isFocus ? 700 : 500}
            >
              {st.label}
            </text>
          </motion.g>
        );
      })}
    </svg>
  );
}

/* ───────────────────────── table card ───────────────────────── */

export interface TableCardProps {
  t: Tbl;
  fds: FD[];
  colW?: number;
  lanes?: boolean;
  focus?: string[][] | null;
  focusMulti?: boolean;
  /** Redundant cells to tint (`row:col` / `row:col:i`). */
  dup?: Set<string>;
  rowKey?: (r: Row, i: number) => string;
  rowTone?: (r: Row, i: number) => 'hit' | 'bad' | 'warn' | 'ok' | 'gone' | undefined;
  cellTone?: (r: Row, i: number, c: string) => 'bad' | 'ok' | 'warn' | 'flash' | undefined;
  extra?: ReactNode;
  footer?: ReactNode;
  showNF?: boolean;
  className?: string;
  selected?: boolean;
  onClick?: () => void;
}

const ROW_TONE: Record<string, string> = {
  hit: 'bg-accent/[0.12]',
  bad: 'bg-bad/[0.12]',
  warn: 'bg-warn/[0.12]',
  ok: 'bg-ok/[0.10]',
  gone: 'bg-bad/[0.15] line-through opacity-60',
};
const CELL_TONE: Record<string, string> = {
  bad: 'bg-bad/20 text-bad font-semibold',
  ok: 'bg-ok/15 text-ok font-semibold',
  warn: 'bg-warn/15 text-warn',
  flash: 'bg-accent/20 text-accent font-semibold',
};

export function TableCard({
  t,
  fds,
  colW = 92,
  lanes = true,
  focus,
  focusMulti,
  dup,
  rowKey,
  rowTone,
  cellTone,
  extra,
  footer,
  showNF = true,
  className,
  selected,
  onClick,
}: TableCardProps) {
  const rep = analyzeNF(t.cols, fds, t.multi);
  const fkCols = new Set((t.fks ?? []).flatMap((f) => f.cols));
  const width = t.cols.length * colW;
  return (
    <motion.div
      layout
      layoutId={`tbl-${t.id}`}
      initial={{ opacity: 0, scale: 0.92, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 220, damping: 26 }}
      onClick={onClick}
      className={cn(
        'rounded-xl border bg-surface p-2.5 shadow-paper',
        selected ? 'border-accent ring-2 ring-accent/30' : 'border-line',
        onClick && 'cursor-pointer hover:border-accent/60',
        className,
      )}
    >
      <motion.div layout="position" className="mb-1 flex items-center gap-2">
        <span className="font-mono text-[13px] font-semibold text-ink">{t.name}</span>
        {t.badge && (
          <Tag size="sm" tone="warn">
            {t.badge}
          </Tag>
        )}
        <span className="font-mono text-[10.5px] text-faint">
          {t.rows.length} rows · PK ({t.pk.join(', ')})
        </span>
        {showNF && (
          <span className="ml-auto">
            <NFBadge nf={rep.nf} />
          </span>
        )}
      </motion.div>
      <div className="overflow-x-auto">
        <div style={{ width }}>
          {lanes && <FDLanes cols={t.cols} fds={fds} multi={t.multi} colW={colW} focus={focus} />}
          <div className="flex border-b border-line">
            {t.cols.map((c) => {
              const isMulti = t.multi?.includes(c);
              return (
                <motion.div
                  layout="position"
                  key={c}
                  style={{ width: colW }}
                  className={cn(
                    'flex shrink-0 items-center gap-1 truncate px-1.5 py-1 font-mono text-[10.5px] font-semibold',
                    t.pk.includes(c) ? 'text-accent' : 'text-muted',
                    isMulti && focusMulti && 'bg-bad/15 text-bad',
                  )}
                  title={c}
                >
                  {t.pk.includes(c) && <KeyRound size={10} className="shrink-0" />}
                  {fkCols.has(c) && !t.pk.includes(c) && <Link2 size={10} className="shrink-0 text-info" />}
                  <span className={cn('truncate', t.pk.includes(c) && 'underline underline-offset-2')}>
                    {c}
                    {isMulti && '[]'}
                  </span>
                </motion.div>
              );
            })}
          </div>
          <AnimatePresence initial={false}>
            {t.rows.map((r, i) => {
              const tone = rowTone?.(r, i);
              return (
                <motion.div
                  layout
                  key={rowKey ? rowKey(r, i) : `${t.id}:${t.pk.map((k) => showVal(r[k])).join('|')}:${i}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 40, backgroundColor: 'rgb(var(--c-bad) / 0.25)' }}
                  transition={{ duration: 0.35 }}
                  className={cn('flex border-b border-line/60 transition-colors duration-300 last:border-b-0', tone && ROW_TONE[tone])}
                >
                  {t.cols.map((c) => {
                    const v = r[c];
                    const ct = cellTone?.(r, i, c);
                    return (
                      <div
                        key={c}
                        style={{ width: colW }}
                        className={cn(
                          'shrink-0 truncate px-1.5 py-[3px] font-mono text-[11px] tabular-nums text-ink transition-colors duration-500',
                          !ct && dup?.has(`${i}:${c}`) && 'bg-warn/15 text-warn',
                          ct && CELL_TONE[ct],
                          v === 'NULL' && 'italic text-faint',
                        )}
                        title={showVal(v)}
                      >
                        {Array.isArray(v) ? (
                          <span className="flex gap-0.5">
                            {v.map((x, k) => (
                              <span
                                key={k}
                                className={cn(
                                  'rounded px-0.5',
                                  dup?.has(`${i}:${c}:${k}`) ? 'bg-warn/20 text-warn' : focusMulti ? 'bg-bad/10 text-bad' : 'bg-ink/[0.06]',
                                )}
                              >
                                {x}
                              </span>
                            ))}
                          </span>
                        ) : (
                          v
                        )}
                      </div>
                    );
                  })}
                </motion.div>
              );
            })}
          </AnimatePresence>
          {extra}
        </div>
      </div>
      {footer}
    </motion.div>
  );
}

/** Small schema-only card (no rows) for drills. */
export function SchemaCard({
  name,
  cols,
  fds,
  multi,
  colW = 96,
  focus,
  right,
  footer,
  selected,
  onClick,
  layoutKey,
  neutral,
}: {
  name: string;
  cols: string[];
  fds: FD[];
  multi?: string[];
  colW?: number;
  focus?: string[][] | null;
  right?: ReactNode;
  footer?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  layoutKey?: string;
  neutral?: boolean;
}) {
  const rep = analyzeNF(cols, fds, multi);
  const key = rep.keys[0] ?? [];
  return (
    <motion.div
      layout
      key={layoutKey}
      initial={{ opacity: 0, scale: 0.9, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ type: 'spring', stiffness: 220, damping: 24 }}
      onClick={onClick}
      className={cn(
        'rounded-xl border bg-surface p-2.5 shadow-paper',
        selected ? 'border-accent ring-2 ring-accent/30' : 'border-line',
        onClick && 'cursor-pointer hover:border-accent/60',
      )}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono text-[13px] font-semibold">{name}</span>
        <span className="ml-auto flex items-center gap-1.5">{right}</span>
      </div>
      <div className="overflow-x-auto">
        <div style={{ width: cols.length * colW }}>
          <FDLanes cols={cols} fds={fds} multi={multi} colW={colW} focus={focus} neutral={neutral} />
          <div className="flex rounded border border-line bg-sunken/50">
            {cols.map((c) => (
              <div
                key={c}
                style={{ width: colW }}
                className={cn('flex shrink-0 items-center gap-1 truncate px-1.5 py-1 font-mono text-[10.5px] font-semibold', key.includes(c) ? 'text-accent' : 'text-muted')}
                title={c}
              >
                {key.includes(c) && <KeyRound size={10} className="shrink-0" />}
                <span className={cn('truncate', key.includes(c) && 'underline underline-offset-2')}>
                  {c}
                  {multi?.includes(c) && '[]'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {footer}
    </motion.div>
  );
}
