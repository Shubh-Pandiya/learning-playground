import { COMPONENTS } from '../data/components';
import type { Graph } from '../types';
import { fmtAvail, fmtCost, fmtMs, fmtNum, fmtPct, fmtQps } from '../ui/format';
import type { Evaluation } from './evaluate';

export type ChangeAction = 'add' | 'remove' | 'connect' | 'disconnect' | 'scale' | 'kill' | 'restore' | 'traffic' | 'reset';

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
  /** e.g. "Added Cache (Redis · Memcached)" */
  title: string;
  /** Node id the change is about (used to merge repeated scale clicks). */
  subject?: string;
  at: number;
  deltas: MetricDelta[];
  /** Per-node load shifts, e.g. "SQL Database load 300% → 59%". */
  loads: MetricDelta[];
  gained: string[];
  risks: string[];
  score: { from: number; to: number };
  /** Kept so consecutive edits to the same node can be merged into one entry. */
  before: { ev: Evaluation; graph: Graph };
}

const CONSISTENCY_RISK: Record<string, string> = {
  'Replica lag': 'Reads from replicas can be stale (replication lag): read-your-writes needs routing to the primary.',
  'Cache TTL staleness': 'Cached reads can be stale until TTL/invalidation; a cold cache or stampede hits the DB hard.',
  'Async processing': 'Work completes later than the request: the API must return "accepted", and consumers must be idempotent.',
  'Projection/index lag': 'Read models/search lag the source of truth: a just-written item may not be visible yet.',
  'Write conflicts (LWW)': 'Concurrent writes to different masters conflict; last-write-wins silently drops updates.',
};

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

/** Diff two evaluations of the same scenario: what got better, what got worse, what new risks appeared. */
export function diffEval(
  action: ChangeAction,
  title: string,
  before: { ev: Evaluation; graph: Graph },
  after: { ev: Evaluation; graph: Graph },
  subject?: string,
): ChangeEntry {
  const a = before.ev.sim.metrics;
  const b = after.ev.sim.metrics;
  const deltas = [
    cmp('maxQps', 'Max throughput', a.maxQps, b.maxQps, fmtQps, true),
    cmp('errors', 'Errors', a.errorRate, b.errorRate, (x) => fmtPct(x, x > 0 && x < 0.01 ? 1 : 0), false, 0),
    cmp('p99', 'p99', a.p99, b.p99, fmtMs, false),
    cmp('avail', 'Availability', a.availability, b.availability, fmtAvail, true, 0),
    cmp('spofs', 'SPOFs', a.spofs.length, b.spofs.length, (x) => `${x}`, false, 0),
    cmp('backlog', 'Queue backlog', a.backlog, b.backlog, (x) => `${fmtNum(x)} msgs`, false),
    cmp('dups', 'Duplicate writes', a.duplicates, b.duplicates, fmtQps, false, 0),
    cmp('throttled', 'Throttled (429)', a.throttled, b.throttled, fmtQps, true),
    cmp('cost', 'Cost', a.cost, b.cost, fmtCost, false, 0.01),
  ].filter((x): x is MetricDelta => !!x);
  if (a.durability.level !== b.durability.level)
    deltas.push({ key: 'durability', label: 'Durability', from: a.durability.label, to: b.durability.label, better: b.durability.level > a.durability.level });
  // cost going up is the price of a fix, not a regression in itself
  for (const d of deltas) if (d.key === 'cost' && d.better === false) d.better = null;

  const loads: MetricDelta[] = [];
  for (const n of after.graph.nodes) {
    if (n.kind === 'client' || COMPONENTS[n.kind].flow.control) continue;
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
  for (const c of b.consistency) if (!a.consistency.includes(c) && CONSISTENCY_RISK[c]) risks.push(CONSISTENCY_RISK[c]);
  for (const c of a.consistency) if (!b.consistency.includes(c) && CONSISTENCY_RISK[c]) gained.push(`No more ${c.toLowerCase()}.`);
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
  if (!b.connected && a.connected) risks.unshift('Requests no longer reach a component that can answer them.');

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

/** One-line headline, e.g. "p99 482 ms → 29 ms · Errors 83% → 0%". */
export function headline(c: ChangeEntry, max = 3): string {
  const parts = [...c.deltas.filter((d) => d.better !== null), ...c.loads.filter((l) => l.from !== 'new')].slice(0, max);
  if (!parts.length) return 'No measurable change to capabilities yet.';
  return parts.map((d) => `${d.label} ${d.from} → ${d.to}`).join(' · ');
}
