import { COMPONENTS } from '../data/components';
import type { Check, ComponentKind, GNode, Graph, OutcomeKey, Requirement, Scenario, Verdict } from '../types';
import { predictKill, runChaos } from './chaos';
import { simulate, type Metrics, type SimResult } from './simulate';

/* ------------------------------------------------------------------ */
/* node / edge feedback                                                */
/* ------------------------------------------------------------------ */

export interface NodeFeedback {
  verdict: Verdict;
  title: string;
  body: string;
  tradeoffs: string[];
  instead?: string;
}

const article = (name: string) => `${/^[AEIOU]/i.test(name) ? 'an' : 'a'} ${name}`;
const refKinds = (s: Scenario) => new Set(s.reference.nodes.map((n) => n.kind));
const flow = (k: ComponentKind) => COMPONENTS[k].flow;

export function nodeFeedback(s: Scenario, kind: ComponentKind): NodeFeedback {
  const def = COMPONENTS[kind];
  const wrong = s.wrong[kind];
  if (wrong) {
    return { verdict: 'wrong', title: `${def.name} is the wrong tool here`, body: wrong.why, tradeoffs: def.trap ? [def.trap] : def.tradeoffs, instead: wrong.instead };
  }
  const alt = s.alt?.[kind];
  if (alt) return { verdict: 'extra', title: `${def.name} would also work`, body: alt, tradeoffs: def.tradeoffs };
  const ref = s.reference.nodes.find((n) => n.kind === kind);
  if (ref) return { verdict: 'good', title: `${def.name}: ${def.solves}`, body: ref.why, tradeoffs: def.tradeoffs };
  if (def.trap) return { verdict: 'wrong', title: `${def.name} is a trap`, body: def.trap, tradeoffs: def.tradeoffs };
  return {
    verdict: 'extra',
    title: `${def.name} isn’t needed for these requirements`,
    body: `${def.solves} But nothing in this scenario needs it, so it only adds cost and moving parts.`,
    tradeoffs: def.tradeoffs,
  };
}

export interface EdgeFeedback {
  verdict: Verdict;
  text: string;
}

const TABLES: ComponentKind[] = ['lakehouse', 'object-store', 'raw-files', 'warehouse'];

export function edgeFeedback(s: Scenario, from: GNode, to: GNode): EdgeFeedback {
  const a = from.kind;
  const b = to.kind;
  const A = COMPONENTS[a];
  const B = COMPONENTS[b];
  const ctl = A.flow.role === 'control' || B.flow.role === 'control';
  const refById = new Map(s.reference.nodes.map((n) => [n.id, n]));
  const match = (x: ComponentKind, y: ComponentKind) =>
    s.reference.edges.find((e) => refById.get(e.from)?.kind === x && refById.get(e.to)?.kind === y);
  const refEdge = match(a, b) ?? (ctl ? match(b, a) : undefined);
  if (refEdge) return { verdict: 'good', text: refEdge.why ?? `${A.name} → ${B.name} matches the reference design.` };

  if (ctl) {
    if (A.flow.role === 'control' && B.flow.role === 'control') return { verdict: 'extra', text: `${A.name} and ${B.name} are both control-plane tools; link each to the data it governs.` };
    const c = A.flow.role === 'control' ? A : B;
    const t = A.flow.role === 'control' ? B : A;
    if (c.kind === 'schema-registry' && t.kind !== 'kafka') return { verdict: 'extra', text: 'A schema registry governs the schemas of topics in the event log. Link it to the log.' };
    if (c.kind === 'compaction' && !TABLES.includes(t.kind)) return { verdict: 'wrong', text: `Compaction rewrites a table’s files; ${t.name} has no files to compact.` };
    if (c.kind === 'airflow' && (t.flow.role === 'source' || t.flow.mode === 'stream')) return { verdict: 'extra', text: `An orchestrator schedules batch tasks; ${t.name} runs continuously and doesn’t need a schedule.` };
    return { verdict: 'extra', text: `${c.name} ↔ ${t.name} isn’t in the reference design.` };
  }
  if (B.flow.role === 'source' && !(a === 'reverse-etl' && b === 'saas')) return { verdict: 'wrong', text: `${B.name} is a source: data flows out of it, not into it.` };
  if (A.flow.role === 'serve' && a !== 'reverse-etl') return { verdict: 'wrong', text: `${A.name} is a consumer: it reads data and doesn’t feed the pipeline. Point the arrow from the data into it.` };
  if (B.flow.role === 'serve' && (a === 'kafka' || A.flow.role === 'source' || A.flow.role === 'process' || A.flow.role === 'ingest'))
    return {
      verdict: 'wrong',
      text:
        A.flow.role === 'source'
          ? `Pointing ${B.name} straight at ${A.name} means analytics queries hit production or a raw stream. Land the data in an analytical store first.`
          : `${B.name} needs something it can query (a warehouse, OLAP store or serving table); ${A.name} doesn’t answer queries.`,
    };
  if (b === 'cdc' && a !== 'app-db') return { verdict: 'wrong', text: 'CDC tails a database’s write-ahead log; only a database can feed it.' };
  if (A.flow.role === 'source' && B.flow.role === 'store' && a === 'events') return { verdict: 'wrong', text: `Devices can’t write into ${B.name} directly: there’s no buffer, no auth boundary and no backpressure. Land events in a durable log first.` };
  const reversed = match(b, a);
  if (reversed) return { verdict: 'extra', text: `Backwards: in this design ${B.name} feeds ${A.name}, not the other way round.` };
  if (s.wrong[a] || s.wrong[b]) return { verdict: 'wrong', text: 'Connected to a component that doesn’t belong in this design.' };
  return { verdict: 'extra', text: `${A.name} → ${B.name} isn’t part of the reference design. It may still work; watch the capabilities.` };
}

/* ------------------------------------------------------------------ */
/* requirement checks                                                  */
/* ------------------------------------------------------------------ */

const countKind = (g: Graph, k: ComponentKind) => g.nodes.filter((n) => n.kind === k).reduce((s, n) => s + n.count, 0);

function hasEdgeKinds(g: Graph, a: ComponentKind, b: ComponentKind) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const ctl = flow(a).role === 'control' || flow(b).role === 'control';
  return g.edges.some((e) => {
    const x = byId.get(e.from)?.kind;
    const y = byId.get(e.to)?.kind;
    return (x === a && y === b) || (ctl && x === b && y === a);
  });
}

const SAFE: OutcomeKey[] = ['absorbed', 'delayed'];

export function runCheck(c: Check, g: Graph, s: Scenario, m: Metrics): boolean {
  switch (c.type) {
    case 'has':
      return countKind(g, c.kind) >= (c.min ?? 1);
    case 'hasAny':
      return c.kinds.some((k) => countKind(g, k) > 0);
    case 'edge':
      return hasEdgeKinds(g, c.from, c.to);
    case 'none':
      return !c.kinds.some((k) => countKind(g, k) > 0);
    case 'noEdge':
      return !hasEdgeKinds(g, c.from, c.to);
    case 'freshness':
      return m.connected && m.freshness <= c.lte;
    case 'throughput':
      return m.connected && m.maxEps >= c.gte;
    case 'exactlyOnce':
      return m.connected && m.semantics === 'exactly-once';
    case 'noLoss':
      return m.connected && m.semantics !== 'at-most-once' && m.lossRisks.length === 0;
    case 'lateData':
      return m.connected && (m.late === 'event-time' || m.late === 'recompute');
    case 'backfill':
      return m.connected && (c.level === 'log' ? m.backfill !== 'none' : m.backfill === 'full');
    case 'schemaSafe':
      return m.connected && (m.schema === 'enforced' || m.schema === 'contract');
    case 'quality':
      return m.connected && m.quality;
    case 'lineage':
      return m.connected && m.lineage;
    case 'noSpof':
      return m.connected && m.spofs.length === 0;
    case 'noOltpLoad':
      return m.connected && !m.oltpLoad;
    case 'queryP99':
      return m.connected && m.queryP99 <= c.lte;
    case 'cost':
      return m.connected && m.cost <= c.lte;
    case 'chaos':
      return m.connected && (c.allow ?? SAFE).includes(runChaos(g, s.workload, c.id).outcome);
    case 'survives': {
      const t = g.nodes.filter((n) => n.kind === c.kind);
      return m.connected && t.length > 0 && t.every((n) => SAFE.includes(predictKill(g, s.workload, n.id).outcome));
    }
    case 'all':
      return c.checks.every((x) => runCheck(x, g, s, m));
  }
}

export interface ReqResult {
  req: Requirement;
  met: boolean;
}

/* ------------------------------------------------------------------ */
/* closeness to reference                                              */
/* ------------------------------------------------------------------ */

export interface Closeness {
  score: number;
  missing: string[];
  wrongNodes: string[];
  extraNodes: string[];
  badEdges: string[];
  nodeVerdicts: Record<string, Verdict>;
  edgeVerdicts: Record<string, Verdict>;
  edgeNotes: Record<string, string>;
}

const pairKey = (a: ComponentKind, b: ComponentKind) => {
  const ctl = flow(a).role === 'control' || flow(b).role === 'control';
  return ctl ? [a, b].sort().join('~') : `${a}>${b}`;
};

export function closeness(g: Graph, s: Scenario, reqs: ReqResult[]): Closeness {
  const refK = refKinds(s);
  const needed = new Map<ComponentKind, number>();
  for (const n of s.reference.nodes) needed.set(n.kind, (needed.get(n.kind) ?? 0) + (n.count ?? 1));
  const have = new Map<ComponentKind, number>();
  for (const n of g.nodes) have.set(n.kind, (have.get(n.kind) ?? 0) + n.count);

  let got = 0;
  let max = 0;
  const missing: string[] = [];
  for (const [k, need] of needed) {
    max += 2;
    const h = have.get(k) ?? 0;
    got += 2 * Math.min(1, h / need);
    if (h === 0) missing.push(`Add ${article(COMPONENTS[k].name)}`);
    else if (h < need) missing.push(`Scale ${COMPONENTS[k].name} to ${need} instances (have ${h})`);
  }

  const refById = new Map(s.reference.nodes.map((n) => [n.id, n]));
  const refPairs = new Set<string>();
  for (const e of s.reference.edges) refPairs.add(pairKey(refById.get(e.from)!.kind, refById.get(e.to)!.kind));
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const userPairs = new Set(
    g.edges.filter((e) => byId.get(e.from) && byId.get(e.to)).map((e) => pairKey(byId.get(e.from)!.kind, byId.get(e.to)!.kind)),
  );
  for (const pair of refPairs) {
    max += 1;
    if (userPairs.has(pair)) got += 1;
    else {
      const [a, b] = pair.split(/[>~]/) as ComponentKind[];
      if ((have.get(a) ?? 0) > 0 && (have.get(b) ?? 0) > 0)
        missing.push(pair.includes('~') ? `Link ${COMPONENTS[a].name} ↔ ${COMPONENTS[b].name}` : `Connect ${COMPONENTS[a].name} → ${COMPONENTS[b].name}`);
    }
  }

  for (const r of reqs) {
    max += 2;
    if (r.met) got += 2;
  }

  const nodeVerdicts: Record<string, Verdict> = {};
  const wrongNodes: string[] = [];
  const extraNodes: string[] = [];
  for (const n of g.nodes) {
    const v = nodeFeedback(s, n.kind).verdict;
    nodeVerdicts[n.id] = v;
    if (v === 'wrong') wrongNodes.push(n.id);
    else if (v === 'extra' && !refK.has(n.kind) && !s.alt?.[n.kind]) extraNodes.push(n.id);
  }
  const edgeVerdicts: Record<string, Verdict> = {};
  const edgeNotes: Record<string, string> = {};
  const badEdges: string[] = [];
  for (const e of g.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const fb = edgeFeedback(s, a, b);
    edgeVerdicts[e.id] = fb.verdict;
    edgeNotes[e.id] = fb.text;
    if (fb.verdict === 'wrong') badEdges.push(e.id);
  }

  const penalty = wrongNodes.length * 8 + extraNodes.length * 2 + badEdges.length * 4;
  const score = Math.max(0, Math.min(100, Math.round((got / Math.max(max, 1)) * 100 - penalty)));
  if (wrongNodes.length) missing.unshift(`Remove ${wrongNodes.length} component${wrongNodes.length > 1 ? 's' : ''} marked red`);
  if (badEdges.length) missing.unshift(`Fix ${badEdges.length} invalid connection${badEdges.length > 1 ? 's' : ''}`);
  return { score, missing, wrongNodes, extraNodes, badEdges, nodeVerdicts, edgeVerdicts, edgeNotes };
}

/* ------------------------------------------------------------------ */
/* everything the UI needs in one call                                 */
/* ------------------------------------------------------------------ */

export interface Evaluation {
  sim: SimResult;
  baseline: Metrics;
  reqs: ReqResult[];
  close: Closeness;
  solved: boolean;
}

/** Nodes that do nothing: data nodes nothing flows into/out of, control nodes linked to nothing. */
export function orphansOf(g: Graph): GNode[] {
  const touched = new Set<string>();
  const inbound = new Set<string>();
  for (const e of g.edges) {
    touched.add(e.from);
    touched.add(e.to);
    inbound.add(e.to);
  }
  return g.nodes.filter((n) => {
    const r = flow(n.kind).role;
    if (r === 'control' || r === 'source') return !touched.has(n.id);
    return !inbound.has(n.id);
  });
}

export function evaluate(g: Graph, s: Scenario, traffic = 1): Evaluation {
  const healthy: Graph = { ...g, nodes: g.nodes.map((n) => ({ ...n, down: 0 })) };
  const base = simulate(healthy, s.workload);
  const sim = traffic === 1 && g.nodes.every((n) => !n.down) ? base : simulate(g, s.workload, { traffic });
  const reqs = s.requirements.map((req) => ({ req, met: runCheck(req.check, healthy, s, base.metrics) }));
  const close = closeness(g, s, reqs);
  if (!base.metrics.connected && g.nodes.length > 0) close.missing.unshift('Connect a source all the way to a consumer');
  const orphans = orphansOf(g);
  for (const n of orphans) {
    const nm = n.label ?? COMPONENTS[n.kind].name;
    close.missing.push(flow(n.kind).role === 'control' ? `${nm} isn’t linked to anything; link it to what it governs` : `${nm} receives no data; connect it`);
  }
  const solved = reqs.every((r) => r.met) && close.wrongNodes.length === 0 && close.badEdges.length === 0 && orphans.length === 0 && base.metrics.connected;
  return { sim, baseline: base.metrics, reqs, close, solved };
}

/* ------------------------------------------------------------------ */
/* faded hints                                                         */
/* ------------------------------------------------------------------ */

const CAT_HINT: Record<string, string> = {
  source: 'where the data comes from',
  ingest: 'how data gets in durably (a log, CDC or a managed connector)',
  process: 'how data is transformed, deduplicated, windowed or scheduled',
  store: 'where data lands so it can be queried or replayed',
  govern: 'how you trust the data (quality, catalog, privacy)',
  serve: 'who consumes the result',
  anti: 'a different component',
};

/** level 1: the unmet requirement's hint, 2: the category, 3: the exact next step. */
export function hint(g: Graph, s: Scenario, ev: Evaluation, level: 1 | 2 | 3): string {
  if (ev.close.badEdges.length || ev.close.wrongNodes.length) {
    return level === 1 ? 'Something on the canvas is actively hurting this design. Look for red.' : ev.close.missing[0];
  }
  const unmet = ev.reqs.find((r) => !r.met);
  const kinds = new Set(g.nodes.map((n) => n.kind));
  const nextRef = s.reference.nodes.find((n) => !kinds.has(n.kind));
  if (level === 1) return unmet ? `"${unmet.req.text}": ${unmet.req.hint}` : (ev.close.missing[0] ?? 'Everything is in place. Now try to break it with the chaos tools.');
  if (level === 2 && nextRef) return `Think about ${CAT_HINT[COMPONENTS[nextRef.kind].category]}.`;
  if (nextRef) return `Add ${article(COMPONENTS[nextRef.kind].name)}: ${nextRef.why}`;
  return ev.close.missing[0] ?? 'Nothing missing.';
}
