import { COMPONENTS } from '../data/components';
import type { Graph } from '../types';
import { BACKFILL_LABEL, LATE_LABEL, SCHEMA_LABEL, SEMANTICS_LABEL, SMALLFILES_LABEL, fmtCost, fmtDur, fmtEps, fmtMs, fmtNum, fmtPct } from '../ui/format';
import type { Evaluation } from './evaluate';
import type { Backfill, LateHandling, Metrics, Semantics, SchemaSafety, SmallFiles } from './simulate';

export type ChangeAction = 'add' | 'remove' | 'connect' | 'disconnect' | 'scale' | 'kill' | 'restore' | 'traffic' | 'chaos' | 'reset';

export interface MetricDelta {
  key: string;
  label: string;
  from: string;
  to: string;
  /** true = improvement, false = regression, null = neutral */
  better: boolean | null;
}

export interface ChangeEntry {
  id: string;
  action: ChangeAction;
  title: string;
  subject?: string;
  at: number;
  deltas: MetricDelta[];
  /** Per-node load shifts, e.g. "Flink load 140% → 70%". */
  loads: MetricDelta[];
  gained: string[];
  risks: string[];
  score: { from: number; to: number };
  before: { ev: Evaluation; graph: Graph };
}

const name = (g: Graph, id: string) => {
  const n = g.nodes.find((x) => x.id === id);
  return n ? (n.label ?? COMPONENTS[n.kind].name) : id;
};

function cmp(key: string, label: string, a: number, b: number, fmt: (n: number) => string, higherIsBetter: boolean, minRel = 0.03): MetricDelta | null {
  if (!Number.isFinite(a) && !Number.isFinite(b)) return null;
  const fa = fmt(a);
  const fb = fmt(b);
  if (fa === fb) return null;
  if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(b - a) <= Math.max(Math.abs(a), Math.abs(b)) * minRel) return null;
  return { key, label, from: fa, to: fb, better: b > a === higherIsBetter };
}

/** Ordinal metrics: index in the array = quality (higher is better). */
const SEM_ORDER: Semantics[] = ['none', 'at-most-once', 'at-least-once', 'exactly-once'];
const LATE_ORDER: LateHandling[] = ['none', 'misattributed', 'query-time', 'recompute', 'event-time'];
const BF_ORDER: Backfill[] = ['none', 'log', 'full'];
const SCHEMA_ORDER: SchemaSafety[] = ['none', 'fragile', 'evolves', 'contract', 'enforced'];
const SF_ORDER: SmallFiles[] = ['tiny', 'many', 'compacted', 'none'];

function ord<T extends string>(key: string, label: string, a: T, b: T, order: T[], labels: Record<T, string>): MetricDelta | null {
  if (a === b) return null;
  return { key, label, from: labels[a], to: labels[b], better: order.indexOf(b) > order.indexOf(a) };
}

const SEM_RISK: Partial<Record<Semantics, string>> = {
  'at-least-once': 'Duplicates are now possible: retries or replays will double-count unless something deduplicates by key.',
  'at-most-once': 'Records can now be lost: something on the path holds data only in memory, or drops it under load.',
};

export function capabilityDeltas(a: Metrics, b: Metrics): MetricDelta[] {
  const deltas = [
    cmp('fresh', 'Freshness', a.freshness, b.freshness, fmtDur, false),
    cmp('maxEps', 'Max throughput', a.maxEps, b.maxEps, fmtEps, true),
    ord('sem', 'Delivery', a.semantics, b.semantics, SEM_ORDER, SEMANTICS_LABEL),
    ord('late', 'Late data', a.late, b.late, LATE_ORDER, LATE_LABEL),
    ord('backfill', 'Backfill', a.backfill, b.backfill, BF_ORDER, BACKFILL_LABEL),
    ord('schema', 'Schema change', a.schema, b.schema, SCHEMA_ORDER, SCHEMA_LABEL),
    ord('files', 'Files', a.smallFiles, b.smallFiles, SF_ORDER, SMALLFILES_LABEL),
    cmp('p99', 'Query p99', a.queryP99, b.queryP99, fmtMs, false),
    cmp('spofs', 'SPOFs', a.spofs.length, b.spofs.length, (x) => `${x}`, false, 0),
    cmp('loss', 'Loss risks', a.lossRisks.length, b.lossRisks.length, (x) => `${x}`, false, 0),
    cmp('backlog', 'Lag growth', a.backlog, b.backlog, (x) => `${fmtNum(x)}/h`, false),
    cmp('cost', 'Cost', a.cost, b.cost, fmtCost, false, 0.01),
  ].filter((x): x is MetricDelta => !!x);
  if (a.quality !== b.quality) deltas.push({ key: 'dq', label: 'Quality checks', from: a.quality ? 'on' : 'off', to: b.quality ? 'on' : 'off', better: b.quality });
  if (a.lineage !== b.lineage) deltas.push({ key: 'lineage', label: 'Lineage', from: a.lineage ? 'tracked' : 'none', to: b.lineage ? 'tracked' : 'none', better: b.lineage });
  if (a.oltpLoad !== b.oltpLoad) deltas.push({ key: 'oltp', label: 'Load on prod DB', from: a.oltpLoad ? 'yes' : 'no', to: b.oltpLoad ? 'yes' : 'no', better: !b.oltpLoad });
  for (const d of deltas) if (d.key === 'cost' && d.better === false) d.better = null;
  return deltas;
}

export function diffEval(
  action: ChangeAction,
  title: string,
  before: { ev: Evaluation; graph: Graph },
  after: { ev: Evaluation; graph: Graph },
  subject?: string,
): ChangeEntry {
  const a = before.ev.sim.metrics;
  const b = after.ev.sim.metrics;
  const deltas = capabilityDeltas(a, b);

  const loads: MetricDelta[] = [];
  for (const n of after.graph.nodes) {
    const fl = COMPONENTS[n.kind].flow;
    if (fl.role === 'control' || fl.role === 'source' || !Number.isFinite(fl.capacity)) continue;
    const ua = before.ev.sim.nodes[n.id]?.util;
    const ub = after.ev.sim.nodes[n.id]?.util ?? 0;
    if (ua === undefined) {
      if (ub > 0) loads.push({ key: n.id, label: `${name(after.graph, n.id)} load`, from: 'new', to: fmtPct(Math.min(ub, 9.99)), better: ub <= 0.85 ? null : false });
      continue;
    }
    if (Math.abs(ub - ua) < 0.15) continue;
    loads.push({ key: n.id, label: `${name(after.graph, n.id)} load`, from: fmtPct(Math.min(ua, 9.99)), to: fmtPct(Math.min(ub, 9.99)), better: ub < ua });
  }
  loads.sort((x, y) => (x.from === 'new' ? 1 : 0) - (y.from === 'new' ? 1 : 0));

  const gained: string[] = [];
  const risks: string[] = [];
  const spofA = new Set(a.spofs);
  const spofB = new Set(b.spofs);
  for (const id of spofB) if (!spofA.has(id)) risks.push(`New single point of failure: ${name(after.graph, id)}.`);
  for (const id of spofA) if (!spofB.has(id) && after.graph.nodes.some((n) => n.id === id)) gained.push(`${name(after.graph, id)} is no longer a single point of failure.`);
  if (a.semantics !== b.semantics) {
    if (SEM_ORDER.indexOf(b.semantics) < SEM_ORDER.indexOf(a.semantics) && SEM_RISK[b.semantics]) risks.push(SEM_RISK[b.semantics]!);
    if (b.semantics === 'exactly-once' && a.semantics !== 'none') gained.push('Every record now counts exactly once, even across retries, replays and restarts.');
  }
  for (const r of b.lossRisks) if (!a.lossRisks.includes(r)) risks.push(r);
  if (b.late === 'misattributed' && a.late !== 'misattributed') risks.push('Late events now land in the wrong window: totals per hour/day will be silently off.');
  if (b.backfill === 'full' && a.backfill !== 'full') gained.push('You can now re-process any past period from stored history (backfills, bug fixes, new metrics).');
  if (b.oltpLoad && !a.oltpLoad) risks.push('Analytical reads now hit the production database: big scans compete with customer traffic.');
  if (b.smallFiles === 'many' && a.smallFiles !== 'many') risks.push('Streaming commits produce small files with nothing compacting them: queries will slow down day by day.');
  const metA = new Map(before.ev.reqs.map((r) => [r.req.id, r.met]));
  for (const r of after.ev.reqs) {
    if (r.met && !metA.get(r.req.id)) gained.push(`Requirement met: ${r.req.text}`);
    if (!r.met && metA.get(r.req.id)) risks.push(`Requirement broken: ${r.req.text}`);
  }
  if (action === 'add' && subject) {
    const n = after.graph.nodes.find((x) => x.id === subject);
    if (n) {
      const def = COMPONENTS[n.kind];
      if (after.ev.close.nodeVerdicts[n.id] === 'wrong') risks.unshift(`${def.name} is the wrong tool here (see feedback).`);
      else if (def.tradeoffs[0]) risks.push(`Tradeoff you just took on: ${def.tradeoffs[0]}`);
    }
  }
  if (!b.connected && a.connected) risks.unshift('Data no longer reaches a consumer.');

  return {
    id: `${action}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    action,
    title,
    subject,
    at: Date.now(),
    deltas,
    loads: loads.slice(0, 4),
    gained,
    risks,
    score: { from: before.ev.close.score, to: after.ev.close.score },
    before,
  };
}

/** One-line headline, e.g. "Freshness 1 day → 4 s · Delivery At-least-once → Exactly-once". */
export function headline(c: ChangeEntry, max = 3): string {
  const parts = [...c.deltas.filter((d) => d.better !== null), ...c.loads.filter((l) => l.from !== 'new')].slice(0, max);
  if (!parts.length) return 'No measurable change to capabilities yet.';
  return parts.map((d) => `${d.label} ${d.from} → ${d.to}`).join(' · ');
}
