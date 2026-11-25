/**
 * "What changed → what it did to the system". Diffs two model evaluations into human rows,
 * so every config edit, added component or chaos action explains itself.
 */
import type { Flag, Ordering, Semantics } from '../types';
import { fmtMs, fmtN, type Model } from './model';

export type Dir = 'better' | 'worse' | 'neutral';

export interface ImpactRow {
  metric: string;
  from: string;
  to: string;
  dir: Dir;
  /** Why this moved, in one line. */
  why?: string;
}

export interface Impact {
  id: string;
  /** What the user did, e.g. "acks: 1 → all on Order service". */
  change: string;
  /** How the mechanism works (from the knob knowledge base), optional. */
  how?: string;
  rows: ImpactRow[];
  added: Flag[];
  resolved: Flag[];
  /** One-sentence verdict. */
  verdict: Dir;
  at: number;
}

const SEM_RANK: Semantics[] = ['none', 'at-most-once', 'at-least-once', 'effectively-once', 'exactly-once'];
const ORD_RANK: Ordering[] = ['n/a', 'none', 'per-key*', 'per-key', 'total'];

export const SEM_LABEL: Record<Semantics, string> = {
  none: 'none (loss + dups)',
  'at-most-once': 'at-most-once',
  'at-least-once': 'at-least-once',
  'effectively-once': 'effectively-once',
  'exactly-once': 'exactly-once',
};

export const ORD_LABEL: Record<Ordering, string> = {
  total: 'total order',
  'per-key': 'per key',
  'per-key*': 'per key, with exceptions',
  none: 'no ordering',
  'n/a': '—',
};

function num(metric: string, a: number, b: number, fmt: (n: number) => string, higherIsBetter: boolean, tol = 0.03, why?: string): ImpactRow | null {
  if (a === b) return null;
  if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * tol) return null;
  const up = b > a;
  return { metric, from: fmt(a), to: fmt(b), dir: up === higherIsBetter ? 'better' : 'worse', why };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const gb = (n: number) => (!Number.isFinite(n) ? '∞' : n >= 1000 ? `${(n / 1000).toFixed(1)} TB` : `${n.toFixed(n < 10 ? 1 : 0)} GB`);

export function diff(before: Model, after: Model, change: string, how?: string): Impact {
  const a = before.metrics;
  const b = after.metrics;
  const rows: ImpactRow[] = [];
  const push = (r: ImpactRow | null) => r && r.from !== r.to && rows.push(r);

  push(num('Throughput in', a.ingest, b.ingest, (n) => `${fmtN(n)}/s`, true));
  if (a.maxThroughput !== b.maxThroughput || a.bottleneck !== b.bottleneck) {
    const r = num('Headroom (max sustainable)', a.maxThroughput, b.maxThroughput, (n) => `${fmtN(n)}/s`, true, 0.03, b.bottleneck !== a.bottleneck ? `bottleneck now: ${b.bottleneck}` : `bottleneck: ${b.bottleneck}`);
    if (r) push(r);
    else if (a.bottleneck !== b.bottleneck) rows.push({ metric: 'Bottleneck', from: a.bottleneck, to: b.bottleneck, dir: 'neutral' });
  }
  push(num('Produce p99', a.produceP99, b.produceP99, fmtMs, false, 0.08));
  push(num('End-to-end p99', a.e2eP99, b.e2eP99, fmtMs, false, 0.08));
  push(num('Consumer lag', a.lagGrowth, b.lagGrowth, (n) => (n > 0.5 ? `+${fmtN(n)}/s` : 'stable'), false, 0.05));
  if (a.semantics !== b.semantics)
    rows.push({ metric: 'Delivery', from: SEM_LABEL[a.semantics], to: SEM_LABEL[b.semantics], dir: SEM_RANK.indexOf(b.semantics) > SEM_RANK.indexOf(a.semantics) ? 'better' : 'worse' });
  if (a.ordering !== b.ordering)
    rows.push({ metric: 'Ordering', from: ORD_LABEL[a.ordering], to: ORD_LABEL[b.ordering], dir: ORD_RANK.indexOf(b.ordering) > ORD_RANK.indexOf(a.ordering) ? 'better' : 'worse' });
  if (a.durability.label !== b.durability.label)
    rows.push({ metric: 'Durability', from: a.durability.label, to: b.durability.label, dir: b.durability.level > a.durability.level ? 'better' : b.durability.level < a.durability.level ? 'worse' : 'neutral' });
  if (a.durability.writesOn1 !== b.durability.writesOn1)
    rows.push({ metric: 'Writes with 1 broker down', from: a.durability.writesOn1 ? 'keep working' : 'fail', to: b.durability.writesOn1 ? 'keep working' : 'fail', dir: b.durability.writesOn1 ? 'better' : 'worse' });
  push(num('Idle consumers', a.idleConsumers, b.idleConsumers, (n) => `${n}`, false, 0));
  push(num('Active consumers', a.activeConsumers, b.activeConsumers, (n) => `${n}`, true, 0));
  push(num('Partitions', a.partitions, b.partitions, (n) => `${n}`, true, 0));
  push(num('Disk (retained)', a.diskGB, b.diskGB, gb, false, 0.1));
  push(num('Failed writes', a.errorRate, b.errorRate, pct, false, 0.01));
  push(num('Stop-the-world per deploy', a.deployPause, b.deployPause, (n) => `${n.toFixed(n < 10 ? 1 : 0)} s`, false, 0.05));
  push(num('Brokers up', a.brokersUp, b.brokersUp, (n) => `${n}`, true, 0));

  const ids = new Set(before.flags.map((f) => f.id));
  const idsAfter = new Set(after.flags.map((f) => f.id));
  const added = after.flags.filter((f) => !ids.has(f.id) && f.level !== 'info');
  const resolved = before.flags.filter((f) => !idsAfter.has(f.id) && f.level !== 'info');

  const score = rows.reduce((s, r) => s + (r.dir === 'better' ? 1 : r.dir === 'worse' ? -1 : 0), 0) + resolved.length * 2 - added.filter((f) => f.level === 'bad').length * 3 - added.length;
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, change, how, rows, added, resolved, verdict: score > 0 ? 'better' : score < 0 ? 'worse' : 'neutral', at: Date.now() };
}

/** Short summary: "Throughput +2×, delivery → at-least-once, 1 new red flag". */
export function headline(i: Impact): string {
  if (!i.rows.length && !i.added.length && !i.resolved.length) return 'No measurable change at the current load.';
  const parts: string[] = [];
  for (const r of i.rows.slice(0, 3)) parts.push(`${r.metric}: ${r.from} → ${r.to}`);
  if (i.added.length) parts.push(`${i.added.length} new issue${i.added.length > 1 ? 's' : ''}`);
  if (i.resolved.length) parts.push(`${i.resolved.length} fixed`);
  return parts.join(' · ');
}
