import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/shared/cn';
import type { ArrayViz, BitsViz, ChipsViz, GridViz, IntervalsViz, MapViz, SetViz, StackViz, TextViz } from '../engine/types';
import { cellDefault, cellTone, pointerText, pointerTone, pointerVar, rgb, toneVar } from './tones';

const spring = { type: 'spring', stiffness: 420, damping: 34 } as const;

function cellWidth(values: string[]) {
  const max = values.reduce((m, v) => Math.max(m, v.length), 1);
  return Math.min(110, Math.max(38, 14 + max * 8.5));
}

// ---------------------------------------------------------------------------

export function ArrayView({ v }: { v: ArrayViz }) {
  const w = cellWidth(v.values);
  const gap = 4;
  const n = v.values.length;
  const slot = (i: number) => Math.max(-1, Math.min(n, i)) * (w + gap);
  // stack pointers that share a cell
  const byIdx = new Map<number, string[]>();
  for (const [name, idx] of Object.entries(v.pointers)) {
    const k = Math.max(-1, Math.min(n, idx));
    byIdx.set(k, [...(byIdx.get(k) ?? []), name]);
  }
  const depth = Math.max(0, ...[...byIdx.values()].map((l) => l.length));
  const hasLeftOutside = [...byIdx.keys()].some((k) => k < 0);
  const padL = hasLeftOutside ? w + gap : 0;

  return (
    <div className="overflow-x-auto pb-1">
      <div className="relative" style={{ width: padL + (n + 1) * (w + gap), paddingLeft: padL }}>
        {v.showIndex && (
          <div className="flex" style={{ gap }}>
            {v.values.map((_, i) => (
              <div key={i} className="text-center text-[10px] text-faint" style={{ width: w }}>
                {i}
              </div>
            ))}
          </div>
        )}
        <div className="relative flex" style={{ gap }}>
          {v.window && v.window[1] >= v.window[0] && (
            <motion.div
              className="absolute -inset-y-1 rounded-md border-2 border-dashed border-accent/70 bg-accent/5"
              initial={false}
              animate={{ x: slot(v.window[0]) - 3, width: (v.window[1] - v.window[0] + 1) * (w + gap) - gap + 6 }}
              transition={spring}
            />
          )}
          {v.values.map((val, i) => {
            const tone = v.tones[i];
            return (
              <motion.div
                key={i}
                layout
                className={cn(
                  'relative flex h-10 items-center justify-center rounded-md border text-sm font-mono transition-colors duration-300',
                  tone ? cellTone[tone] : cellDefault,
                )}
                style={{ width: w }}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={val}
                    initial={{ y: -8, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 8, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="truncate px-1"
                  >
                    {val}
                  </motion.span>
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
        <div className="relative" style={{ height: depth * 18 + (depth ? 10 : 0) }}>
          {[...byIdx.entries()].flatMap(([idx, names]) =>
            names.map((name, row) => {
              const t = pointerTone(name);
              const raw = v.pointers[name];
              const outside = raw < 0 || raw >= n;
              return (
                <motion.div
                  key={name}
                  className={cn('absolute top-0 flex flex-col items-center text-xs font-semibold', pointerText[t])}
                  initial={false}
                  animate={{ x: slot(idx), y: row * 18 }}
                  transition={spring}
                  style={{ width: w, left: 0 }}
                >
                  {row === 0 && <span className="leading-[10px]">▲</span>}
                  <span className={cn('leading-4', outside && 'opacity-60')}>
                    {name}
                    {outside ? `=${raw}` : ''}
                  </span>
                </motion.div>
              );
            }),
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function MapView({ v }: { v: MapViz }) {
  if (!v.entries.length) return <Empty>{'{ }'} empty</Empty>;
  return (
    <div className="flex flex-wrap gap-1.5">
      <AnimatePresence initial={false}>
        {v.entries.map(([k, val]) => {
          const tone = v.tones[k];
          return (
            <motion.div
              key={k}
              layout
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={spring}
              className={cn(
                'flex items-stretch overflow-hidden rounded-md border font-mono text-xs transition-colors duration-300',
                tone ? cellTone[tone] : cellDefault,
              )}
            >
              <span className="bg-sunken/70 px-2 py-1 text-muted">{k}</span>
              <span className="px-2 py-1">{val}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function SetView({ v }: { v: SetViz }) {
  if (!v.items.length) return <Empty>{'{ }'} empty</Empty>;
  return (
    <div className="flex flex-wrap gap-1.5">
      <AnimatePresence initial={false}>
        {v.items.map((k) => {
          const tone = v.tones[k];
          return (
            <motion.span
              key={k}
              layout
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={spring}
              className={cn('rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors', tone ? cellTone[tone] : cellDefault)}
            >
              {k}
            </motion.span>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function ChipsView({ v }: { v: ChipsViz }) {
  if (!v.items.length) return <Empty>[ ] empty</Empty>;
  return (
    <div className="flex flex-wrap gap-1.5">
      <AnimatePresence initial={false}>
        {v.items.map((k, i) => {
          const tone = v.tones[i];
          return (
            <motion.span
              key={`${i}:${k}`}
              layout
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={spring}
              className={cn('rounded-md border px-2 py-0.5 font-mono text-xs transition-colors', tone ? cellTone[tone] : cellDefault)}
            >
              {k}
            </motion.span>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function StackView({ v }: { v: StackViz }) {
  if (v.mode === 'queue') {
    return (
      <div className="flex items-center gap-2 overflow-x-auto">
        <span className="text-[10px] uppercase tracking-wider text-faint">front</span>
        <div className="flex min-h-10 items-center gap-1 rounded-md border border-dashed border-line px-1.5 py-1">
          {!v.items.length && <span className="px-2 text-xs text-faint">empty</span>}
          <AnimatePresence initial={false} mode="popLayout">
            {v.items.map((it, i) => (
              <motion.span
                key={`${it}#${countBefore(v.items, i)}`}
                layout
                initial={{ x: 24, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -24, opacity: 0 }}
                transition={spring}
                className={cn('rounded border px-2 py-1 font-mono text-xs', v.tones[i] ? cellTone[v.tones[i]] : cellDefault)}
              >
                {it}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-faint">back</span>
      </div>
    );
  }
  const items = v.items.map((it, i) => ({ it, i, key: `${it}#${countBefore(v.items, i)}` })).reverse();
  return (
    <div className="inline-flex min-w-[7rem] flex-col items-stretch">
      <span className="mb-1 text-center text-[10px] uppercase tracking-wider text-faint">top</span>
      <div className="flex min-h-12 flex-col gap-1 rounded-b-md border-x-2 border-b-2 border-line px-1.5 pb-1.5 pt-1">
        {!v.items.length && <span className="py-2 text-center text-xs text-faint">empty</span>}
        <AnimatePresence initial={false} mode="popLayout">
          {items.map(({ it, i, key }) => (
            <motion.div
              key={key}
              layout
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0, transition: { duration: 0.15 } }}
              transition={spring}
              className={cn('rounded border px-2 py-1 text-center font-mono text-xs', v.tones[i] ? cellTone[v.tones[i]] : cellDefault)}
            >
              {it}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Stable identity for duplicate items: "3#0", "3#1"… counted from the bottom. */
function countBefore(items: string[], i: number) {
  let c = 0;
  for (let k = 0; k < i; k++) if (items[k] === items[i]) c++;
  return c;
}

// ---------------------------------------------------------------------------

export function GridView({ v }: { v: GridViz }) {
  const cols = v.cells[0]?.length ?? 0;
  const maxLen = v.cells.reduce((m, r) => r.reduce((mm, c) => Math.max(mm, c.length), m), 1);
  const size = Math.min(64, Math.max(30, 12 + maxLen * 8));
  const ptrAt = new Map<string, string[]>();
  for (const [name, [r, c]] of Object.entries(v.pointers)) ptrAt.set(`${r},${c}`, [...(ptrAt.get(`${r},${c}`) ?? []), name]);
  return (
    <div className="overflow-x-auto pb-1">
      <table className="border-separate font-mono text-xs" style={{ borderSpacing: 3 }}>
        {v.colLabels && (
          <thead>
            <tr>
              {v.rowLabels && <th />}
              {v.colLabels.slice(0, cols).map((l, c) => (
                <th key={c} className="px-1 text-center text-[10px] font-normal text-faint">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {v.cells.map((row, r) => (
            <tr key={r}>
              {v.rowLabels && <th className="pr-1 text-right text-[10px] font-normal text-faint">{v.rowLabels[r]}</th>}
              {row.map((cell, c) => {
                const tone = v.tones[`${r},${c}`];
                const ptrs = ptrAt.get(`${r},${c}`);
                return (
                  <td key={c} className="p-0">
                    <div
                      className={cn(
                        'relative flex items-center justify-center rounded border transition-colors duration-300',
                        tone ? cellTone[tone] : cellDefault,
                        ptrs && 'ring-2 ring-offset-1 ring-offset-paper',
                      )}
                      style={{
                        width: size,
                        height: Math.max(28, size * 0.8),
                        ...(ptrs ? ({ ['--tw-ring-color' as string]: rgb(pointerVar[pointerTone(ptrs[0])]) } as React.CSSProperties) : {}),
                      }}
                      title={ptrs?.join(', ')}
                    >
                      {cell}
                      {ptrs && (
                        <span
                          className={cn('absolute -top-2 right-0.5 rounded bg-paper px-0.5 text-[9px] font-bold leading-3', pointerText[pointerTone(ptrs[0])])}
                        >
                          {ptrs.join(',')}
                        </span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function BitsView({ v }: { v: BitsViz }) {
  const w = Math.max(1, Math.min(32, v.width));
  return (
    <div className="space-y-1 overflow-x-auto font-mono text-xs">
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0" />
        <div className="flex gap-0.5">
          {Array.from({ length: w }, (_, k) => (
            <span key={k} className="w-6 text-center text-[9px] text-faint">
              {w - 1 - k}
            </span>
          ))}
        </div>
      </div>
      {v.rows.map((row, ri) => (
        <div key={ri} className="flex items-center gap-2">
          <span className="w-20 shrink-0 truncate text-right text-muted">{row.label}</span>
          <div className="flex gap-0.5">
            {Array.from({ length: w }, (_, k) => {
              const pos = w - 1 - k;
              const u = row.value < 0 ? row.value >>> 0 : row.value;
              const bit = Math.floor(u / 2 ** pos) % 2 === 1;
              const tone = row.tones[pos];
              return (
                <span
                  key={k}
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded border transition-colors duration-300',
                    tone ? cellTone[tone] : bit ? 'border-ink/40 bg-ink/10 text-ink' : 'border-line text-faint',
                  )}
                >
                  {bit ? 1 : 0}
                </span>
              );
            })}
          </div>
          <span className="text-faint">= {row.value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function IntervalsView({ v }: { v: IntervalsViz }) {
  if (!v.items.length) return <Empty>no intervals</Empty>;
  const lo = Math.min(...v.items.map((i) => i.start), v.marker ?? Infinity);
  const hi = Math.max(...v.items.map((i) => i.end), v.marker ?? -Infinity);
  const span = Math.max(1, hi - lo);
  const W = 560;
  const pad = 24;
  const x = (n: number) => pad + ((n - lo) / span) * (W - 2 * pad);
  const rowH = 22;
  const H = v.items.length * rowH + 30;
  const ticks = niceTicks(lo, hi);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="max-w-full font-mono" style={{ height: 'auto' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={4} y2={H - 18} stroke={rgb('var(--c-line)')} strokeDasharray="2 3" />
            <text x={x(t)} y={H - 4} fontSize={10} textAnchor="middle" fill={rgb('var(--c-faint)')}>
              {t}
            </text>
          </g>
        ))}
        {v.items.map((it, i) => {
          const c = it.tone ? toneVar[it.tone] : 'var(--c-muted)';
          const y = 8 + i * rowH;
          return (
            <g key={i} style={{ transition: 'opacity 300ms' }} opacity={it.tone === 'muted' ? 0.4 : 1}>
              <rect
                x={x(it.start)}
                y={y}
                width={Math.max(4, x(it.end) - x(it.start))}
                height={rowH - 8}
                rx={4}
                fill={rgb(c, 0.18)}
                stroke={rgb(c)}
                strokeWidth={1.5}
                style={{ transition: 'all 300ms' }}
              />
              <text x={x(it.start) + 4} y={y + rowH - 12} fontSize={10} fill={rgb('var(--c-ink)')}>
                {it.label ?? `[${it.start},${it.end}]`}
              </text>
            </g>
          );
        })}
        {v.marker !== null && (
          <line
            x1={x(v.marker)}
            x2={x(v.marker)}
            y1={0}
            y2={H - 16}
            stroke={rgb('var(--c-accent)')}
            strokeWidth={2}
            style={{ transition: 'all 300ms' }}
          />
        )}
      </svg>
    </div>
  );
}

function niceTicks(lo: number, hi: number) {
  const span = hi - lo;
  if (!isFinite(span) || span <= 0) return [lo];
  const raw = span / 8;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(+t.toFixed(6));
  return out;
}

// ---------------------------------------------------------------------------

export function TextView({ v }: { v: TextViz }) {
  return (
    <div className="flex flex-wrap gap-px font-mono text-sm">
      {[...v.text].map((ch, i) => {
        const tone = v.tones[i];
        return (
          <span
            key={i}
            className={cn(
              'flex h-7 min-w-[1.25rem] items-center justify-center rounded-sm border px-0.5 transition-colors duration-300',
              tone ? cellTone[tone] : 'border-transparent',
            )}
          >
            {ch === ' ' ? '·' : ch}
          </span>
        );
      })}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-xs text-faint">{children}</div>;
}
