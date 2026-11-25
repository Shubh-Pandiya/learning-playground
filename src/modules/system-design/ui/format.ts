export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  if (a >= 10 || a === 0) return `${Math.round(n)}`;
  return n.toFixed(1);
}

export const fmtQps = (n: number) => `${fmtNum(n)}/s`;
export const fmtMs = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);
export const fmtPct = (f: number, digits = 0) => `${(f * 100).toFixed(digits)}%`;
export const fmtCost = (n: number) => `$${fmtNum(n)}/mo`;

export function fmtAvail(a: number): string {
  if (a >= 0.99999) return '99.999%';
  const pct = a * 100;
  return `${pct >= 99.9 ? pct.toFixed(2) : pct >= 99 ? pct.toFixed(1) : pct.toFixed(0)}%`;
}

/** Downtime per month implied by an availability. */
export function downtime(a: number): string {
  const min = (1 - a) * 30 * 24 * 60;
  if (min < 1) return `${Math.round(min * 60)} s/mo down`;
  if (min < 120) return `${Math.round(min)} min/mo down`;
  return `${(min / 60).toFixed(0)} h/mo down`;
}
