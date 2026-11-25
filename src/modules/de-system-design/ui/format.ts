import type { Backfill, LateHandling, Semantics, SchemaSafety, SmallFiles } from '../engine/simulate';

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  if (a >= 10 || a === 0) return `${Math.round(n)}`;
  return n.toFixed(1);
}

export const fmtEps = (n: number) => `${fmtNum(n)}/s`;
export const fmtQps = fmtEps;
export const fmtMs = (n: number) => (!Number.isFinite(n) ? '∞' : n >= 60000 ? `${(n / 60000).toFixed(1)} min` : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);
export const fmtPct = (f: number, digits = 0) => `${(f * 100).toFixed(digits)}%`;
export const fmtCost = (n: number) => `$${fmtNum(n)}/mo`;

/** Seconds → human duration ("4 s", "15 min", "1.5 h", "1 day"). */
export function fmtDur(sec: number): string {
  if (!Number.isFinite(sec)) return 'stalled';
  if (sec < 1) return `${Math.round(sec * 1000)} ms`;
  if (sec < 90) return `${Math.round(sec)} s`;
  if (sec < 5400) return `${Math.round(sec / 60)} min`;
  if (sec < 129600) return `${+(sec / 3600).toFixed(1)} h`;
  return `${+(sec / 86400).toFixed(1)} days`;
}

export const SEMANTICS_LABEL: Record<Semantics, string> = {
  'exactly-once': 'Exactly-once',
  'at-least-once': 'At-least-once (dupes)',
  'at-most-once': 'At-most-once (loss)',
  none: '—',
};

export const LATE_LABEL: Record<LateHandling, string> = {
  'event-time': 'Event-time windows',
  recompute: 'Re-computed by batch',
  'query-time': 'Raw, fixed at query time',
  misattributed: 'Wrong window (proc-time)',
  none: '—',
};

export const BACKFILL_LABEL: Record<Backfill, string> = {
  full: 'Full history',
  log: 'Log retention only',
  none: 'Impossible',
};

export const SCHEMA_LABEL: Record<SchemaSafety, string> = {
  enforced: 'Enforced at write',
  contract: 'Contract-checked',
  evolves: 'Evolves, unchecked',
  fragile: 'Fragile',
  none: '—',
};

export const SMALLFILES_LABEL: Record<SmallFiles, string> = {
  none: 'Healthy file sizes',
  compacted: 'Compacted',
  many: 'Small files piling up',
  tiny: 'Millions of tiny files',
};
