import { useEffect, useRef, type ReactNode } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';

/** Calls `fn` every `ms` while `running`. `fn` may change between renders. */
export function useTicker(running: boolean, ms: number, fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [running, ms]);
}

/** Small deterministic PRNG so labs are reproducible after Reset. */
export function rng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit — the same kind of cheap hash real systems use for routing. */
export function hash32(s: string, seed = 0): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function Seg<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      {label && <div className="eyebrow mb-1">{label}</div>}
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={String(o.value)}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-md border px-2 py-1 font-mono text-[11px] transition',
              value === o.value ? 'border-accent bg-accent/10 text-ink' : 'border-line bg-surface text-muted hover:border-accent/50 hover:text-ink',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  fmt = (v) => `${v}`,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">{label}</span>
        <span className="font-mono text-[11px] text-ink">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-[rgb(var(--c-accent))]" />
    </label>
  );
}

export type StatTone = 'ok' | 'warn' | 'bad' | 'info' | undefined;
const TONE: Record<string, string> = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', info: 'text-info' };

export function Stat({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: StatTone; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
      <div className="font-mono text-[9.5px] uppercase tracking-wider text-faint">{label}</div>
      <div className={cn('font-mono text-[15px] font-semibold leading-tight', tone ? TONE[tone] : 'text-ink')}>{value}</div>
      {sub && <div className="text-[10.5px] text-faint">{sub}</div>}
    </div>
  );
}

/** Standard lab layout: controls on top, visual stage, stats, and an "what to notice" insight. */
export function LabFrame({
  title,
  goal,
  controls,
  stats,
  insight,
  running,
  onToggle,
  onReset,
  children,
}: {
  title: string;
  /** One line: what to try. */
  goal: ReactNode;
  controls: ReactNode;
  stats?: ReactNode;
  /** Changes with the current config: what the user should be noticing right now. */
  insight?: ReactNode;
  running?: boolean;
  onToggle?: () => void;
  onReset?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Lab</div>
          <h3 className="font-mono text-[14px] font-semibold">{title}</h3>
          <p className="mt-0.5 text-[12.5px] text-muted">{goal}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          {onToggle && (
            <Button size="xs" variant={running ? 'secondary' : 'primary'} icon={running ? <Pause size={12} /> : <Play size={12} />} onClick={onToggle}>
              {running ? 'Pause' : 'Run'}
            </Button>
          )}
          {onReset && <Button size="xs" variant="ghost" iconOnly aria-label="Reset" icon={<RotateCcw size={12} />} onClick={onReset} />}
        </div>
      </div>
      <div className="grid gap-3 rounded-xl border border-line bg-paper p-3 sm:grid-cols-2">{controls}</div>
      <div className="overflow-hidden rounded-xl border border-line bg-sunken/50 p-2">{children}</div>
      {stats && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{stats}</div>}
      {insight && (
        <div className="rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2 text-[12.5px] leading-relaxed text-ink/90">
          <span className="mr-1 font-mono text-[10.5px] uppercase tracking-wider text-info">Notice</span>
          {insight}
        </div>
      )}
    </div>
  );
}

/** Percentile of a numeric sample (p in 0..1). */
export function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
