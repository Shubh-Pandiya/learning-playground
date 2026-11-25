import { COMPONENTS } from '../data/components';
import type { ComponentDef, ComponentKind, GEdge, GNode, Graph, Workload } from '../types';

/**
 * Coarse, deterministic data-pipeline simulator.
 * Propagates records/s from sources through ingest → process → store → consumers,
 * and derives the data-engineering capabilities shown in the UI: freshness,
 * throughput, delivery semantics, late-data handling, backfill, schema safety,
 * query latency, cost, SPOFs and data-loss risk. Napkin math on purpose:
 * good enough to show *why* a design works.
 */

export type EdgeType = 'stream' | 'batch' | 'control' | 'serve';
export type NodeStatus = 'idle' | 'ok' | 'hot' | 'overloaded' | 'dead' | 'stalled';
export type Semantics = 'exactly-once' | 'at-least-once' | 'at-most-once' | 'none';
export type LateHandling = 'event-time' | 'recompute' | 'query-time' | 'misattributed' | 'none';
export type Backfill = 'full' | 'log' | 'none';
export type SchemaSafety = 'enforced' | 'contract' | 'evolves' | 'fragile' | 'none';
export type SmallFiles = 'none' | 'compacted' | 'many' | 'tiny';

export interface NodeSim {
  id: string;
  /** Records/s arriving. */
  inEps: number;
  /** Records/s passed downstream (capped at capacity). */
  outEps: number;
  /** Ingest utilisation (records). */
  util: number;
  /** Total healthy capacity (records/s). */
  capacity: number;
  alive: number;
  status: NodeStatus;
  /** Records/hour of lag piling up when overloaded. */
  lag: number;
  /** Interactive queries/s landing here and their p99 (ms). */
  queryQps: number;
  queryMs: number;
  /** Effective seconds this hop adds to freshness. */
  delaySec: number;
  /** A hot key saturates one instance. */
  skewed?: boolean;
  smallFiles?: SmallFiles;
  note?: string;
}

export interface EdgeSim {
  id: string;
  type: EdgeType;
  rate: number;
  failing: boolean;
}

export interface Metrics {
  offered: number;
  maxEps: number;
  /** Worst end-to-end freshness at the consumers (s). Infinity = stalled. */
  freshness: number;
  /** Worst interactive query p99 (ms); 0 = no interactive consumers. */
  queryP99: number;
  semantics: Semantics;
  late: LateHandling;
  backfill: Backfill;
  schema: SchemaSafety;
  quality: boolean;
  lineage: boolean;
  pii: boolean;
  orchestrated: boolean;
  smallFiles: SmallFiles;
  spofs: string[];
  lossRisks: string[];
  oltpLoad: boolean;
  cost: number;
  /** Records/hour of lag piling up. */
  backlog: number;
  bottleneck?: string;
  connected: boolean;
}

export interface SimResult {
  nodes: Record<string, NodeSim>;
  edges: Record<string, EdgeSim>;
  metrics: Metrics;
}

export interface SimOptions {
  traffic?: number;
  /** Override hot-key share (skew chaos). */
  skew?: number;
}

export const d = (k: ComponentKind): ComponentDef => COMPONENTS[k];
export const aliveOf = (n: GNode) => Math.max(0, n.count - (n.down ?? 0));
export const isControl = (n: GNode) => d(n.kind).flow.role === 'control';
export const isStreamProc = (n: GNode) => d(n.kind).flow.role === 'process' && d(n.kind).flow.mode === 'stream';
export const UPSERT_STORES: ComponentKind[] = ['kv', 'feature-store', 'search'];
const TABLE_STORES: ComponentKind[] = ['lakehouse', 'object-store', 'raw-files'];

export function edgeType(src: GNode, dst: GNode): EdgeType {
  const s = d(src.kind).flow;
  const t = d(dst.kind).flow;
  if (s.role === 'control' || t.role === 'control') return 'control';
  if (t.role === 'serve' || t.role === 'query') return 'serve';
  if (s.mode === 'batch' || t.mode === 'batch') return 'batch';
  return 'stream';
}

/* ------------------------------------------------------------------ */
/* graph analysis shared by the simulator and chaos                    */
/* ------------------------------------------------------------------ */

export interface Ctx {
  g: Graph;
  wl: Workload;
  byId: Map<string, GNode>;
  out: Map<string, GEdge[]>;
  inn: Map<string, GEdge[]>;
  /** control node id → data node ids it is linked to (edge in either direction). */
  controls: Map<string, Set<string>>;
  order: string[];
  sources: GNode[];
  targets: GNode[];
  paths: string[][];
}

export function buildCtx(g: Graph, wl: Workload): Ctx {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const out = new Map<string, GEdge[]>();
  const inn = new Map<string, GEdge[]>();
  const controls = new Map<string, Set<string>>();
  for (const n of g.nodes) {
    out.set(n.id, []);
    inn.set(n.id, []);
    if (isControl(n)) controls.set(n.id, new Set());
  }
  for (const e of g.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b || a.id === b.id) continue;
    if (isControl(a) || isControl(b)) {
      if (isControl(a) && !isControl(b)) controls.get(a.id)!.add(b.id);
      if (isControl(b) && !isControl(a)) controls.get(b.id)!.add(a.id);
      continue;
    }
    if (d(b.kind).flow.role === 'source') continue;
    out.get(a.id)!.push(e);
    inn.get(b.id)!.push(e);
  }
  // Kahn topological order; nodes stuck in cycles are appended at the end.
  const deg = new Map(g.nodes.map((n) => [n.id, inn.get(n.id)!.length]));
  const q = g.nodes.filter((n) => deg.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (q.length) {
    const id = q.shift()!;
    order.push(id);
    for (const e of out.get(id)!) {
      deg.set(e.to, deg.get(e.to)! - 1);
      if (deg.get(e.to) === 0) q.push(e.to);
    }
  }
  const seen = new Set(order);
  for (const n of g.nodes) if (!seen.has(n.id)) order.push(n.id);

  const sources = g.nodes.filter((n) => d(n.kind).flow.role === 'source');
  const reach = new Set<string>();
  const stack = sources.map((s) => s.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (reach.has(id)) continue;
    reach.add(id);
    for (const e of out.get(id)!) stack.push(e.to);
  }
  const serve = g.nodes.filter((n) => d(n.kind).flow.role === 'serve' && reach.has(n.id));
  const terminals = g.nodes.filter(
    (n) => reach.has(n.id) && !isControl(n) && d(n.kind).flow.role !== 'source' && out.get(n.id)!.length === 0,
  );
  const targets = serve.length ? serve : terminals;
  const targetIds = new Set(targets.map((t) => t.id));

  const paths: string[][] = [];
  const walk = (id: string, path: string[]) => {
    if (paths.length > 400) return;
    const next = [...path, id];
    if (targetIds.has(id)) paths.push(next);
    for (const e of out.get(id)!) if (!path.includes(e.to) && e.to !== id) walk(e.to, next);
  };
  for (const s of sources) walk(s.id, []);

  return { g, wl, byId, out, inn, controls, order, sources, targets, paths };
}

/** Data nodes linked to a live control node of this kind. */
export function controlled(ctx: Ctx, kind: ComponentKind): Set<string> {
  const s = new Set<string>();
  for (const n of ctx.g.nodes) if (n.kind === kind && aliveOf(n) > 0) for (const t of ctx.controls.get(n.id) ?? []) s.add(t);
  return s;
}

export const hasKind = (ctx: Ctx, kind: ComponentKind) => ctx.g.nodes.some((n) => n.kind === kind && aliveOf(n) > 0);

/** Upstream of `id` (inclusive) along data edges. */
export function ancestors(ctx: Ctx, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const x = stack.pop()!;
    if (seen.has(x)) continue;
    seen.add(x);
    for (const e of ctx.inn.get(x) ?? []) stack.push(e.from);
  }
  return seen;
}

/** Is something durable (or an at-rest source) holding the data strictly before index i on the path? */
export function bufferedBefore(ctx: Ctx, path: string[], i: number): boolean {
  for (let k = i - 1; k >= 0; k--) {
    const n = ctx.byId.get(path[k])!;
    const fl = d(n.kind).flow;
    if (fl.volatile || fl.inconsistent) return false;
    if (fl.durable && aliveOf(n) > 0) return true;
  }
  return false;
}

export function smallFilesOf(ctx: Ctx, n: GNode): SmallFiles {
  if (!TABLE_STORES.includes(n.kind)) return 'none';
  const writers = (ctx.inn.get(n.id) ?? []).map((e) => ctx.byId.get(e.from)!);
  if (writers.some((w) => d(w.kind).flow.smallFiles === 'tiny')) return 'tiny';
  if (!writers.some(isStreamProc)) return 'none';
  return controlled(ctx, 'compaction').has(n.id) ? 'compacted' : 'many';
}

/* ------------------------------------------------------------------ */
/* simulation                                                          */
/* ------------------------------------------------------------------ */

export function simulate(g: Graph, wl: Workload, opts: SimOptions = {}): SimResult {
  const traffic = opts.traffic ?? 1;
  const skew = opts.skew ?? wl.skew ?? 0;
  const ctx = buildCtx(g, wl);
  const nodes: Record<string, NodeSim> = {};
  const offered = wl.eps * traffic;
  const perSource = ctx.sources.length ? offered / ctx.sources.length : 0;
  const broken = new Set<string>();

  for (const id of ctx.order) {
    const n = ctx.byId.get(id)!;
    const fl = d(n.kind).flow;
    const alive = aliveOf(n);
    const ins = ctx.inn.get(id)!;
    const isSource = fl.role === 'source';
    const inEps = isSource ? perSource : ins.reduce((s, e) => s + (nodes[e.from]?.outEps ?? 0), 0);
    const upstreamBroken = ins.length > 0 && ins.every((e) => broken.has(e.from));
    let share = 0;
    if (fl.keyed && skew > 0) {
      const spread = [...ancestors(ctx, id)].some((a) => d(ctx.byId.get(a)!.kind).flow.spreadsKeys);
      share = spread ? 0 : skew;
    }
    const capPer = fl.capacity;
    const capacity = capPer * alive;
    let util = 0;
    let skewed = false;
    if (Number.isFinite(capPer) && alive > 0 && inEps > 0) {
      const even = inEps / alive;
      const hot = alive > 1 && share > 1 / alive ? inEps * share : 0;
      util = Math.max(even, hot) / capPer;
      skewed = hot > even && hot / capPer > 0.75;
    }
    let delaySec = fl.delaySec;
    let note: string | undefined;
    if (fl.keyed && share >= 0.2 && fl.mode === 'batch' && !isSource) {
      delaySec += fl.delaySec * share * 3;
      skewed = true;
      note = `Hot key holds ${Math.round(share * 100)}% of records: one straggler task runs long after the rest finish.`;
    }
    let status: NodeStatus = 'ok';
    if (fl.role === 'control') status = alive > 0 ? 'ok' : 'dead';
    else if (alive === 0) status = 'dead';
    else if (upstreamBroken) status = 'stalled';
    else if (inEps <= 0 && !isSource && fl.role !== 'serve' && fl.role !== 'query') status = 'idle';
    else if (util > 1) status = 'overloaded';
    else if (util > 0.75) status = 'hot';
    if (status === 'dead' || status === 'stalled') broken.add(id);
    const outEps = status === 'dead' || status === 'stalled' ? 0 : util > 1 ? inEps / util : inEps;
    const lag = util > 1 ? (inEps - outEps) * 3600 : 0;
    if (status === 'overloaded') {
      note = skewed
        ? `One hot key sends ${Math.round(share * 100)}% of records to a single instance. Adding instances won’t help. Lag grows by ${fmtCount(lag)}/h.`
        : `Can’t keep up: needs ${Math.ceil(inEps / capPer)} instance(s), has ${alive}. Lag grows by ${fmtCount(lag)}/h.`;
    } else if (status === 'dead') note = 'All instances down.';
    else if (status === 'stalled') note = 'Nothing arrives: everything upstream is down.';
    nodes[id] = { id, inEps, outEps, util, capacity, alive, status, lag, queryQps: 0, queryMs: 0, delaySec, skewed, note };
  }

  for (const n of g.nodes) {
    const sf = smallFilesOf(ctx, n);
    if (sf === 'none') continue;
    nodes[n.id].smallFiles = sf;
    if (sf === 'many' && !nodes[n.id].note) nodes[n.id].note = 'Streaming commits create thousands of small files per hour, and nothing compacts them.';
    if (sf === 'tiny') nodes[n.id].note = 'One object per record: millions of tiny files, and PUT and listing costs explode.';
  }

  // interactive queries flow from query-issuing consumers to the store/engine they read
  const qq = (wl.queryQps ?? 0) * traffic;
  for (const s of ctx.targets) {
    if (!d(s.kind).flow.queries) continue;
    const ups = ctx.inn.get(s.id)!.map((e) => ctx.byId.get(e.from)!);
    for (const u of ups) nodes[u.id].queryQps += qq / ups.length;
    if (!ups.length) continue;
  }
  for (const n of g.nodes) {
    const ns = nodes[n.id];
    const isReader = ctx.targets.some((t) => d(t.kind).flow.queries && ctx.inn.get(t.id)!.some((e) => e.from === n.id));
    if (!isReader) continue;
    const q = d(n.kind).flow.query ?? { qps: 2, ms: 20000 };
    let layout = 1;
    for (const e of ctx.inn.get(n.id)!) {
      const up = ctx.byId.get(e.from)!;
      const sf = nodes[up.id].smallFiles;
      if (sf === 'many') layout = Math.max(layout, 4);
      if (sf === 'tiny') layout = Math.max(layout, 20);
      if (up.kind === 'raw-files') layout = Math.max(layout, 4);
      if (up.kind === 'object-store') layout = Math.max(layout, 3);
    }
    if (ns.smallFiles === 'many') layout = Math.max(layout, 4);
    if (ns.smallFiles === 'tiny') layout = Math.max(layout, 20);
    const cap = q.qps * ns.alive;
    const u = cap > 0 ? ns.queryQps / cap : ns.queryQps > 0 ? Infinity : 0;
    const load = u <= 0.7 ? 1 : u <= 1 ? 1 + (u - 0.7) * 6 : 3 * u * u;
    ns.queryMs = ns.alive === 0 || ns.status === 'stalled' ? Infinity : q.ms * layout * load;
    if (u > 1 && ns.status !== 'dead') {
      ns.status = 'overloaded';
      ns.note = `${fmtCount(ns.queryQps)} queries/s vs ~${fmtCount(cap)} it can serve: queries queue up (p99 ${fmtMs(ns.queryMs)}).`;
    } else if (u > 0.75 && ns.status === 'ok') {
      ns.status = 'hot';
      ns.note = `${fmtCount(ns.queryQps)} queries/s is ${Math.round(u * 100)}% of what it can serve, so p99 is rising (${fmtMs(ns.queryMs)}).`;
    } else if (layout > 1 && !ns.note) {
      ns.note = `Queries read ${layout}× more files/bytes than needed (layout), so p99 ≈ ${fmtMs(ns.queryMs)}.`;
    }
  }

  const edges: Record<string, EdgeSim> = {};
  for (const e of g.edges) {
    const a = ctx.byId.get(e.from);
    const b = ctx.byId.get(e.to);
    if (!a || !b) continue;
    const type = edgeType(a, b);
    const rate = type === 'control' ? 0 : type === 'serve' && d(b.kind).flow.queries ? nodes[a.id].queryQps : nodes[a.id].outEps;
    edges[e.id] = {
      id: e.id,
      type,
      rate,
      failing: type !== 'control' && (broken.has(a.id) || nodes[b.id].status === 'dead' || nodes[a.id].util > 1 || nodes[b.id].util > 1),
    };
  }

  return { nodes, edges, metrics: computeMetrics(ctx, nodes, offered) };
}

function computeMetrics(ctx: Ctx, nodes: Record<string, NodeSim>, offered: number): Metrics {
  const { g, paths } = ctx;
  const connected = paths.length > 0;
  const onPath = new Set(paths.flat());
  const N = (id: string) => ctx.byId.get(id)!;
  const F = (id: string) => d(N(id).kind).flow;

  let freshness = connected ? 0 : Infinity;
  for (const p of paths) {
    let t = 0;
    for (const id of p) {
      const ns = nodes[id];
      if (ns.status === 'dead' || ns.status === 'stalled') t = Infinity;
      else t += ns.delaySec + (ns.util > 1 ? 3600 : 0);
    }
    freshness = Math.max(freshness, t);
  }

  let maxUtil = 0;
  let bottleneck: string | undefined;
  for (const n of g.nodes) {
    const ns = nodes[n.id];
    if (ns.util > maxUtil) {
      maxUtil = ns.util;
      bottleneck = n.id;
    }
  }
  const maxEps = !connected ? 0 : maxUtil > 0 ? offered / maxUtil : Infinity;

  const lossRisks: string[] = [];
  const addRisk = (s: string) => {
    if (!lossRisks.includes(s)) lossRisks.push(s);
  };
  const rank: Semantics[] = ['none', 'exactly-once', 'at-least-once', 'at-most-once'];
  let sem: Semantics = connected ? 'exactly-once' : 'none';
  for (const p of paths) {
    let ps = 'exactly-once' as Semantics;
    p.forEach((id, i) => {
      const fl = F(id);
      const name = N(id).label ?? d(N(id).kind).name;
      if (fl.volatile) {
        ps = 'at-most-once';
        addRisk(`${name}: records held only in memory vanish on every crash or deploy.`);
      }
      if (fl.inconsistent) {
        ps = 'at-most-once';
        addRisk(`${name}: the DB commit and the event send aren’t atomic, so a crash in between loses events.`);
      }
      const ns = nodes[id];
      if ((ns.util > 1 || ns.status === 'dead') && fl.role !== 'serve' && fl.role !== 'source' && !bufferedBefore(ctx, p, i)) {
        ps = 'at-most-once';
        addRisk(`${name} is ${ns.status === 'dead' ? 'down' : 'overloaded'} and nothing durable buffers before it, so records are dropped.`);
      }
    });
    if (ps !== 'at-most-once') {
      const rerun = p.some((id) => F(id).rerunDups);
      const dedup = p.some((id) => F(id).dedup);
      const stores = p.filter((id) => F(id).role === 'store');
      const last = stores.length ? N(stores[stores.length - 1]) : undefined;
      const upsertLast = !!last && UPSERT_STORES.includes(last.kind);
      const appendAfterStream = stores.some((id) => F(id).sink === 'append' && p.slice(0, p.indexOf(id)).some((x) => isStreamProc(N(x))));
      if (rerun || appendAfterStream || !(dedup || upsertLast)) ps = 'at-least-once';
    }
    if (rank.indexOf(ps) > rank.indexOf(sem)) sem = ps;
  }
  for (const n of g.nodes) {
    if (n.kind === 'kafka' && onPath.has(n.id) && aliveOf(n) < 3)
      addRisk(`${n.label ?? 'Event log'} has fewer than 3 brokers: replication factor < 3, so one broker or disk loss loses acknowledged data.`);
  }

  const lateRank: LateHandling[] = ['none', 'event-time', 'recompute', 'query-time', 'misattributed'];
  let late: LateHandling = 'none';
  for (const p of paths) {
    let pl: LateHandling = 'query-time';
    if (p.some((id) => F(id).procTime)) pl = 'misattributed';
    else if (p.some((id) => isStreamProc(N(id)) && F(id).eventTime)) pl = 'event-time';
    else if (p.some((id) => F(id).role === 'process' && F(id).mode === 'batch' && F(id).dedup)) pl = 'recompute';
    else if (p.some((id) => F(id).eventTime)) pl = 'event-time';
    if (lateRank.indexOf(pl) > lateRank.indexOf(late)) late = pl;
  }

  let backfill: Backfill = 'none';
  for (const id of onPath) {
    const r = F(id).replay;
    if (r === 'full') backfill = 'full';
    else if (r === 'log' && backfill === 'none') backfill = 'log';
  }

  const reg = controlled(ctx, 'schema-registry');
  const dq = controlled(ctx, 'dq');
  let schema: SchemaSafety = 'none';
  if (connected) {
    if ([...reg].some((id) => onPath.has(id) && N(id).kind === 'kafka')) schema = 'enforced';
    else if ([...dq].some((id) => onPath.has(id))) schema = 'contract';
    else if ([...onPath].some((id) => F(id).schema === 'evolve')) schema = 'evolves';
    else schema = 'fragile';
  }

  const spofs = g.nodes
    .filter((n) => {
      const fl = d(n.kind).flow;
      return fl.minHa !== undefined && onPath.has(n.id) && aliveOf(n) < fl.minHa;
    })
    .map((n) => n.id);

  const sfRank: SmallFiles[] = ['none', 'compacted', 'many', 'tiny'];
  let smallFiles: SmallFiles = 'none';
  for (const n of g.nodes) {
    const s = nodes[n.id].smallFiles ?? 'none';
    if (sfRank.indexOf(s) > sfRank.indexOf(smallFiles)) smallFiles = s;
  }

  let queryP99 = 0;
  for (const t of ctx.targets) {
    if (!d(t.kind).flow.queries) continue;
    for (const e of ctx.inn.get(t.id)!) queryP99 = Math.max(queryP99, nodes[e.from].queryMs);
  }

  const cost = Math.round(
    g.nodes.reduce((s, n) => {
      const fl = d(n.kind).flow;
      return s + fl.cost * n.count + ((fl.costPerKeps ?? 0) * nodes[n.id].inEps) / 1000;
    }, 0),
  );
  const backlog = Object.values(nodes).reduce((s, n) => s + n.lag, 0);
  const oltpLoad = g.nodes.some((n) => d(n.kind).flow.oltpLoad && onPath.has(n.id));

  return {
    offered,
    maxEps,
    freshness,
    queryP99,
    semantics: sem,
    late,
    backfill,
    schema,
    quality: dq.size > 0,
    lineage: hasKind(ctx, 'catalog'),
    pii: hasKind(ctx, 'pii'),
    orchestrated: hasKind(ctx, 'airflow'),
    smallFiles,
    spofs,
    lossRisks,
    oltpLoad,
    cost,
    backlog,
    bottleneck: maxUtil > 0.75 ? bottleneck : undefined,
    connected,
  };
}

export function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return `${Math.round(n)}`;
}

export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return '∞';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

export function killOne(g: Graph, nodeId: string): Graph {
  return { ...g, nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, down: Math.min(n.count, (n.down ?? 0) + 1) } : n)) };
}
