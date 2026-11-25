import { COMPONENTS } from '../data/components';
import type { ComponentDef, ComponentKind, GEdge, GNode, Graph, Workload } from '../types';

/**
 * Coarse, deterministic traffic simulator.
 * Propagates read/write rates from clients through the graph, saturating
 * nodes at capacity, and derives the capability metrics shown in the UI.
 * It is intentionally napkin-math: good enough to show *why* a design works.
 */

export type EdgeType = 'sync' | 'async' | 'control' | 'replication';
export type NodeStatus = 'idle' | 'ok' | 'hot' | 'overloaded' | 'dead' | 'degraded';

export interface NodeSim {
  id: string;
  /** Sync reads / writes arriving (req/s). */
  r: number;
  w: number;
  /** Async work arriving (msgs/s), incl. replication apply. */
  aw: number;
  util: number;
  syncUtil: number;
  capacity: number;
  alive: number;
  status: NodeStatus;
  absorbed: number;
  errors: number;
  backlog: number;
  throttled: number;
  latencyMs: number;
  /** Some instances are down and callers keep hitting them (timeouts). */
  flaky?: boolean;
  note?: string;
}

export interface EdgeSim {
  id: string;
  type: EdgeType;
  rate: number;
  r: number;
  w: number;
  failing: boolean;
}

export interface Metrics {
  offered: number;
  maxQps: number;
  p99: number;
  availability: number;
  spofs: string[];
  cost: number;
  durability: { level: 0 | 1 | 2 | 3; label: string };
  consistency: string[];
  readOk: number;
  writeOk: number;
  errorRate: number;
  throttled: number;
  backlog: number;
  /** Duplicate writes/s that reach the store (client retries without idempotency). */
  duplicates: number;
  connected: boolean;
}

export interface SimResult {
  nodes: Record<string, NodeSim>;
  edges: Record<string, EdgeSim>;
  metrics: Metrics;
}

export interface SimOptions {
  traffic?: number;
}

const DEFAULT_ABSORB = { cacheHit: 0.9, cdnHit: 0.6, bloomNegative: 0.3, localCacheHit: 0.4 } as const;
/** Route by key: can't move a dead shard's keys elsewhere (a consistent-hash ring can). */
const PARTITIONERS: ComponentKind[] = ['shard-router', 'mod-hash'];
const FEED_TARGETS: ComponentKind[] = ['replica', 'cdc', 'projector', 'stream', 'pubsub', 'queue', 'multi-master'];
const ABSORB_ORDER: ComponentKind[] = ['bloom', 'local-cache', 'cache', 'cdn'];

const d = (k: ComponentKind): ComponentDef => COMPONENTS[k];
const aliveOf = (n: GNode) => Math.max(0, n.count - (n.down ?? 0));

export function edgeType(src: GNode, dst: GNode): EdgeType {
  const sd = d(src.kind).flow;
  const td = d(dst.kind).flow;
  if (sd.control || td.control) return 'control';
  if (sd.durable && d(src.kind).category === 'data' && FEED_TARGETS.includes(dst.kind)) return 'replication';
  if (sd.async || td.async || src.kind === 'cdc') return 'async';
  return 'sync';
}

interface Flow {
  r: number;
  w: number;
  aw: number;
  /** abusive share of (r + w) that a rate limiter would remove */
  ab: number;
}

const zero = (): Flow => ({ r: 0, w: 0, aw: 0, ab: 0 });

interface Ctx {
  g: Graph;
  wl: Workload;
  byId: Map<string, GNode>;
  out: Map<string, GEdge[]>;
  inn: Map<string, GEdge[]>;
  types: Map<string, EdgeType>;
  registryAware: Set<string>;
  autoscaled: Set<string>;
  coordinated: Set<string>;
}

function buildCtx(g: Graph, wl: Workload): Ctx {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const out = new Map<string, GEdge[]>();
  const inn = new Map<string, GEdge[]>();
  const types = new Map<string, EdgeType>();
  for (const n of g.nodes) {
    out.set(n.id, []);
    inn.set(n.id, []);
  }
  const registryAware = new Set<string>();
  const autoscaled = new Set<string>();
  const coordinated = new Set<string>();
  for (const e of g.edges) {
    const s = byId.get(e.from);
    const t = byId.get(e.to);
    if (!s || !t || s.id === t.id) continue;
    const ty = edgeType(s, t);
    types.set(e.id, ty);
    out.get(s.id)!.push(e);
    inn.get(t.id)!.push(e);
    if (ty === 'control') {
      const ctrl = d(s.kind).flow.control ? s : t;
      const other = ctrl === s ? t : s;
      if (ctrl.kind === 'registry' || ctrl.kind === 'coordinator') registryAware.add(other.id);
      if (ctrl.kind === 'autoscaler') autoscaled.add(other.id);
      if (ctrl.kind === 'coordinator') coordinated.add(other.id);
    }
  }
  return { g, wl, byId, out, inn, types, registryAware, autoscaled, coordinated };
}

function topo(ctx: Ctx): GNode[] {
  const indeg = new Map<string, number>();
  for (const n of ctx.g.nodes) indeg.set(n.id, 0);
  for (const e of ctx.g.edges) {
    const ty = ctx.types.get(e.id);
    if (!ty || ty === 'control') continue;
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const order: GNode[] = [];
  const seen = new Set<string>();
  const q = ctx.g.nodes.filter((n) => indeg.get(n.id) === 0);
  while (order.length < ctx.g.nodes.length) {
    if (q.length === 0) {
      // cycle: break it by picking an unvisited node
      const nxt = ctx.g.nodes.find((n) => !seen.has(n.id));
      if (!nxt) break;
      q.push(nxt);
    }
    const n = q.shift()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    order.push(n);
    for (const e of ctx.out.get(n.id) ?? []) {
      if (ctx.types.get(e.id) === 'control') continue;
      const v = (indeg.get(e.to) ?? 1) - 1;
      indeg.set(e.to, v);
      if (v === 0 && !seen.has(e.to)) q.push(ctx.byId.get(e.to)!);
    }
  }
  return order;
}

function absorbRate(kind: ComponentKind, wl: Workload): number {
  const a = d(kind).flow.absorbs;
  if (!a) return 0;
  return wl[a] ?? DEFAULT_ABSORB[a];
}

/** Effective traffic class a node accepts; pass-through wrappers inherit from what they wrap. */
function accOf(ctx: Ctx, n: GNode): 'rw' | 'r' | 'w' | 'none' {
  const df = d(n.kind).flow;
  if (!df.breaker && !df.retryStorm) return df.accepts;
  const outs = (ctx.out.get(n.id) ?? []).filter((e) => ctx.types.get(e.id) === 'sync');
  if (!outs.length) return df.accepts;
  let r = false;
  let w = false;
  for (const e of outs) {
    const a = accOf(ctx, ctx.byId.get(e.to)!);
    r ||= a === 'r' || a === 'rw';
    w ||= a === 'w' || a === 'rw';
  }
  return r && w ? 'rw' : r ? 'r' : w ? 'w' : 'none';
}

/** A dead primary with a consensus store + live replica gets a replica promoted (leader election). */
function promoted(ctx: Ctx, n: GNode) {
  if (aliveOf(n) > 0 || !ctx.coordinated.has(n.id) || !d(n.kind).flow.durable) return false;
  return (ctx.out.get(n.id) ?? []).some((e) => {
    const t = ctx.byId.get(e.to)!;
    return t.kind === 'replica' && aliveOf(t) > 0;
  });
}

function healthAware(ctx: Ctx, n: GNode) {
  return !!d(n.kind).flow.healthChecks || ctx.registryAware.has(n.id);
}

function nodeCapacity(ctx: Ctx, n: GNode, alive: number, cascade: boolean) {
  const base = d(n.kind).flow.capacity;
  let cap = base * alive;
  if (ctx.autoscaled.has(n.id)) cap *= 4;
  if (cascade) cap *= 0.3;
  return cap;
}

function hopLatency(base: number, util: number) {
  if (util <= 0.7) return base;
  if (util <= 1) return base * (1 + (util - 0.7) * 6);
  return base * 4 + 400;
}

interface PassResult {
  nodes: Record<string, NodeSim>;
  edges: Record<string, EdgeSim>;
  unhealthy: Set<string>;
  slow: Set<string>;
  errR: number;
  errW: number;
  /** errors per node on its *sync* intake, for latency */
  syncIn: Map<string, number>;
}

function runPass(ctx: Ctx, traffic: number, prev: PassResult | null): PassResult {
  const unhealthyPrev = prev?.unhealthy ?? null;
  const { wl } = ctx;
  const inflow = new Map<string, Flow>();
  for (const n of ctx.g.nodes) inflow.set(n.id, zero());
  const nodes: Record<string, NodeSim> = {};
  const edges: Record<string, EdgeSim> = {};
  for (const e of ctx.g.edges) {
    const ty = ctx.types.get(e.id);
    if (ty) edges[e.id] = { id: e.id, type: ty, rate: 0, r: 0, w: 0, failing: false };
  }
  let errR = 0;
  let errW = 0;
  const syncIn = new Map<string, number>();

  // seed clients
  const clients = ctx.g.nodes.filter((n) => n.kind === 'client');
  const abusive = wl.abusive ?? 0;
  const total = wl.qps * traffic * (1 + abusive);
  for (const c of clients) {
    const share = total / clients.length;
    inflow.set(c.id, { r: share * wl.readRatio, w: share * (1 - wl.readRatio), aw: 0, ab: share * (abusive / (1 + abusive)) });
  }

  const send = (e: GEdge, f: Flow) => {
    const tgt = inflow.get(e.to);
    if (!tgt) return;
    tgt.r += f.r;
    tgt.w += f.w;
    tgt.aw += f.aw;
    tgt.ab += f.ab;
    const es = edges[e.id];
    if (es) {
      es.r += f.r;
      es.w += f.w + f.aw;
      es.rate += f.r + f.w + f.aw;
    }
  };

  for (const n of topo(ctx)) {
    const df = d(n.kind).flow;
    const f = inflow.get(n.id)!;
    const isPromoted = promoted(ctx, n);
    const alive = isPromoted ? 1 : aliveOf(n);
    const ns: NodeSim = {
      id: n.id,
      r: f.r,
      w: f.w,
      aw: f.aw,
      util: 0,
      syncUtil: 0,
      capacity: 0,
      alive,
      status: 'idle',
      absorbed: 0,
      errors: 0,
      backlog: 0,
      throttled: 0,
      latencyMs: df.latencyMs,
    };
    nodes[n.id] = ns;
    syncIn.set(n.id, f.r + f.w);
    if (df.control) {
      ns.status = alive === 0 ? 'dead' : 'ok';
      continue;
    }

    let { r, w, aw, ab } = f;
    const isClient = n.kind === 'client';
    if (isPromoted) ns.note = 'Primary died: replica promoted by leader election';

    // dead node: everything sent here fails
    if (alive === 0 && !isClient) {
      ns.status = 'dead';
      ns.errors = r + w;
      errR += r;
      errW += w;
      ns.backlog = aw;
      continue;
    }

    // partial instance loss without health-checking parents → share of requests hit dead boxes
    const down = n.down ?? 0;
    if (down > 0 && !isClient && !isPromoted && !df.absorbs) {
      const parents = (ctx.inn.get(n.id) ?? []).map((e) => ctx.byId.get(e.from)!).filter(Boolean);
      const shielded = parents.length > 0 && parents.every((p) => healthAware(ctx, p) && !PARTITIONERS.includes(p.kind));
      if (!shielded) {
        const frac = down / n.count;
        ns.flaky = true;
        ns.note = `${down} of ${n.count} instances down; callers still send to them`;
        ns.errors += (r + w) * frac;
        errR += r * frac;
        errW += w * frac;
        r *= 1 - frac;
        w *= 1 - frac;
        ab *= 1 - frac;
      }
    }

    // wrong traffic class for this component
    const acc = accOf(ctx, n);
    if (!isClient) {
      if (acc === 'r' && w > 0) {
        ns.errors += w;
        errW += w;
        ns.note = 'Rejects writes (read-only)';
        ab *= r / Math.max(r + w, 1e-9);
        w = 0;
      }
      if (acc === 'w' && r > 0) {
        ns.errors += r;
        errR += r;
        ns.note = 'Cannot answer reads';
        ab *= w / Math.max(r + w, 1e-9);
        r = 0;
      }
    }

    // rate limiter drops abusive share
    if (df.limiter && ab > 0) {
      const tot = r + w;
      const keep = tot > 0 ? (tot - ab) / tot : 1;
      ns.throttled = ab;
      r *= keep;
      w *= keep;
      ab = 0;
    }

    // capacity / saturation
    // slow dependencies (overloaded / timing out) tie up threads; a fully dead host fails fast
    const cascade = !!prev && !df.breaker && hasUnhealthySyncDep(ctx, n, prev.slow);
    const cap = nodeCapacity(ctx, n, alive, cascade);
    ns.capacity = cap;
    const wc = df.writeCost ?? 1;
    const syncLoad = r + w * wc;
    const load = syncLoad + aw * wc;
    ns.util = Number.isFinite(cap) && cap > 0 ? load / cap : 0;
    ns.syncUtil = Number.isFinite(cap) && cap > 0 ? syncLoad / cap : 0;
    if (cascade) ns.note = 'Threads stuck waiting on a failing dependency';
    if (ns.util > 1) {
      // async work queues up first; sync overflow becomes errors
      let excess = load - cap;
      const asyncShed = Math.min(excess, aw * wc);
      ns.backlog += asyncShed / wc;
      aw -= asyncShed / wc;
      excess -= asyncShed;
      if (excess > 0 && syncLoad > 0) {
        const keep = Math.max(0, 1 - excess / syncLoad);
        ns.errors += (r + w) * (1 - keep);
        errR += r * (1 - keep);
        errW += w * (1 - keep);
        r *= keep;
        w *= keep;
        ab *= keep;
      }
    }

    // absorption (cache / CDN / bloom)
    if (df.absorbs) {
      const h = absorbRate(n.kind, wl) * (alive / n.count);
      ns.absorbed = r * h;
      r -= r * h;
      ab *= 1 - h * 0.5;
    }

    // circuit breaker: when downstream is unhealthy, fail fast + fallback
    const outs = (ctx.out.get(n.id) ?? []).filter((e) => ctx.types.get(e.id) !== 'control');
    if (df.breaker && unhealthyPrev && outs.some((e) => unhealthyPrev.has(e.to))) {
      // the guarded call is skipped; callers get a fallback (defaults, cached value, "try later")
      ns.status = 'degraded';
      ns.note =
        n.kind === 'saga' ? 'A step is failing: saga state saved, retrying / compensating later' : 'Open: failing fast, serving fallback';
      ns.absorbed += r + w;
      for (const e of outs) edges[e.id].failing = true;
      continue;
    }

    // retry storm / amplification
    let amp = df.amplify ?? 1;
    if (df.retryStorm && unhealthyPrev && outs.some((e) => unhealthyPrev.has(e.to))) {
      amp *= 3;
      ns.note = 'Retrying ×3 into a struggling dependency';
    }
    r *= amp;
    w *= amp;
    ab *= amp;

    // async buffers: ack writes, drain to consumers
    if (df.async) {
      const dlqs = outs.filter((e) => ctx.byId.get(e.to)!.kind === 'dlq');
      const consumers = outs.filter((e) => !dlqs.includes(e));
      let total = w + aw;
      if (dlqs.length && total > 0) {
        // ~0.5% poison messages are parked instead of retried forever
        dlqs.forEach((e) => send(e, { r: 0, w: 0, aw: (total * 0.005) / dlqs.length, ab: 0 }));
        total *= 0.995;
      }
      if (consumers.length === 0) {
        ns.backlog += total;
      } else if (df.async === 'queue') {
        const weights = consumers.map((e) => aliveOf(ctx.byId.get(e.to)!) || 1);
        const sum = weights.reduce((a, b) => a + b, 0);
        consumers.forEach((e, i) => send(e, { r: 0, w: 0, aw: (total * weights[i]) / sum, ab: 0 }));
      } else {
        // every subscriber gets its own copy of every event
        consumers.forEach((e) => send(e, { r: 0, w: 0, aw: total, ab: 0 }));
      }
      finishStatus(ns);
      continue;
    }

    // replication / change-feed edges carry this node's committed writes
    const feeds = outs.filter((e) => ctx.types.get(e.id) === 'replication');
    for (const e of feeds) send(e, { r: 0, w: 0, aw: w + aw, ab: 0 });
    const dataOuts = outs.filter((e) => ctx.types.get(e.id) === 'sync' || ctx.types.get(e.id) === 'async');

    // replicas only apply replication; async work that arrives at a non-buffer node becomes writes downstream
    const routeW = w;
    const routeAW = n.kind === 'replica' ? 0 : aw;

    if (dataOuts.length === 0) {
      finishStatus(ns);
      continue;
    }
    route(ctx, n, dataOuts, { r, w: routeW, aw: routeAW, ab }, send);
    finishStatus(ns);
  }

  const unhealthy = new Set<string>();
  for (const ns of Object.values(nodes)) {
    if (ns.status === 'dead' || ns.status === 'overloaded' || ns.flaky) unhealthy.add(ns.id);
  }
  // transparent retry wrappers are as unhealthy as what they wrap
  for (const n of ctx.g.nodes) {
    if (d(n.kind).flow.retryStorm && (ctx.out.get(n.id) ?? []).some((e) => unhealthy.has(e.to))) unhealthy.add(n.id);
  }
  for (const es of Object.values(edges)) {
    if (unhealthy.has(ctx.g.edges.find((e) => e.id === es.id)?.to ?? '')) es.failing = true;
  }
  const slow = new Set([...unhealthy].filter((id) => nodes[id]?.status !== 'dead'));
  return { nodes, edges, unhealthy, slow, errR, errW, syncIn };
}

function finishStatus(ns: NodeSim) {
  if (ns.status === 'degraded') return;
  const load = ns.r + ns.w + ns.aw;
  if (load <= 0) ns.status = 'idle';
  else if (ns.util > 1) ns.status = 'overloaded';
  else if (ns.util > 0.75) ns.status = 'hot';
  else ns.status = 'ok';
}

function hasUnhealthySyncDep(ctx: Ctx, n: GNode, unhealthy: Set<string>) {
  if (n.kind === 'client') return false;
  const cat = d(n.kind).category;
  if (cat !== 'compute' && cat !== 'entry') return false;
  if (healthAware(ctx, n)) {
    // routes around dead instances unless *every* target of a group is unhealthy
    const outs = (ctx.out.get(n.id) ?? []).filter((e) => ctx.types.get(e.id) === 'sync');
    const groups = fanoutGroups(ctx, outs);
    return groups.some((g) => g.every((e) => unhealthy.has(e.to)));
  }
  return (ctx.out.get(n.id) ?? []).some(
    (e) => ctx.types.get(e.id) === 'sync' && unhealthy.has(e.to) && !d(ctx.byId.get(e.to)!.kind).flow.absorbs,
  );
}

function familyOf(k: ComponentKind) {
  return d(k).flow.family ?? k;
}

function fanoutGroups(ctx: Ctx, es: GEdge[]): GEdge[][] {
  const m = new Map<string, GEdge[]>();
  for (const e of es) {
    const fam = familyOf(ctx.byId.get(e.to)!.kind);
    if (!m.has(fam)) m.set(fam, []);
    m.get(fam)!.push(e);
  }
  return [...m.values()];
}

/** Split flow across same-family targets, weighted by instances (alive if the sender health-checks). */
function splitWithin(ctx: Ctx, grp: GEdge[], f: Flow, cls: 'r' | 'w', send: (e: GEdge, f: Flow) => void, sender?: GNode) {
  const eligible = grp.filter((e) => {
    const a = accOf(ctx, ctx.byId.get(e.to)!);
    return cls === 'r' ? a === 'rw' || a === 'r' : a === 'rw' || a === 'w';
  });
  const list = eligible.length ? eligible : grp;
  const aware = sender ? healthAware(ctx, sender) && !PARTITIONERS.includes(sender.kind) : false;
  const weights = list.map((e) => {
    const t = ctx.byId.get(e.to)!;
    return aware ? aliveOf(t) : t.count;
  });
  let sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    // everyone dead: send evenly so the errors show up on the dead nodes
    sum = list.length;
    weights.fill(1);
  }
  list.forEach((e, i) => {
    const k = weights[i] / sum;
    if (k > 0) send(e, { r: f.r * k, w: f.w * k, aw: f.aw * k, ab: f.ab * k });
  });
}

function route(ctx: Ctx, n: GNode, outs: GEdge[], f: Flow, send: (e: GEdge, f: Flow) => void) {
  const tgt = (e: GEdge) => ctx.byId.get(e.to)!;
  const acc = (e: GEdge) => accOf(ctx, tgt(e));
  const fl = (e: GEdge) => d(tgt(e).kind).flow;
  const broadcast = !!d(n.kind).flow.broadcast;
  const groups = (es: GEdge[]) => (broadcast ? es.map((e) => [e]) : fanoutGroups(ctx, es));
  const readOuts = outs.filter((e) => acc(e) === 'rw' || acc(e) === 'r');
  const writeOuts = outs.filter((e) => acc(e) === 'rw' || acc(e) === 'w');
  const abFracR = f.r + f.w > 0 ? f.ab / (f.r + f.w) : 0;

  // ---- reads: look-aside absorbers first (bloom → local cache → cache), then stores
  let residual = f.r;
  // dead look-aside caches are skipped: every read falls through to the store (stampede)
  const absorbers = readOuts
    .filter((e) => fl(e).absorbs && aliveOf(tgt(e)) > 0)
    .sort((a, b) => ABSORB_ORDER.indexOf(tgt(a).kind) - ABSORB_ORDER.indexOf(tgt(b).kind));
  for (const grp of fanoutGroups(ctx, absorbers)) {
    if (residual <= 0) break;
    splitWithin(ctx, grp, { r: residual, w: 0, aw: 0, ab: residual * abFracR }, 'r', send, n);
    const t = tgt(grp[0]);
    const readThrough = (ctx.out.get(t.id) ?? []).some((e) => {
      const a = accOf(ctx, ctx.byId.get(e.to)!);
      return ctx.types.get(e.id) === 'sync' && (a === 'rw' || a === 'r');
    });
    const alive = grp.reduce((s, e) => s + aliveOf(tgt(e)), 0) / Math.max(1, grp.reduce((s, e) => s + tgt(e).count, 0));
    residual = readThrough ? 0 : residual * (1 - absorbRate(t.kind, ctx.wl) * alive);
  }
  let storeReads = readOuts.filter((e) => !fl(e).absorbs);
  if (storeReads.some((e) => fl(e).readPreferred)) storeReads = storeReads.filter((e) => fl(e).readPreferred);
  if (residual > 0) {
    for (const grp of groups(storeReads)) {
      splitWithin(ctx, grp, { r: residual, w: 0, aw: 0, ab: residual * abFracR }, 'r', send, n);
    }
  }

  // ---- sync writes: handed to an async buffer if there is one (plus dedup store), else to stores
  if (f.w > 0) {
    let targets = writeOuts;
    if (writeOuts.some((e) => fl(e).async)) targets = writeOuts.filter((e) => fl(e).async || tgt(e).kind === 'idem-store');
    const abW = f.w * abFracR;
    for (const grp of groups(targets)) splitWithin(ctx, grp, { r: 0, w: f.w, aw: 0, ab: abW }, 'w', send, n);
  }

  // ---- async work (from a queue / change feed): applied to whatever this node writes to
  if (f.aw > 0) {
    let targets = outs.filter((e) => acc(e) !== 'none' && !fl(e).absorbs);
    if (targets.some((e) => fl(e).async)) targets = targets.filter((e) => fl(e).async);
    for (const grp of groups(targets)) splitWithin(ctx, grp, { r: 0, w: 0, aw: f.aw, ab: 0 }, 'w', send, n);
  }
}

/* ------------------------------------------------------------------ */
/* metrics                                                             */
/* ------------------------------------------------------------------ */

function latencyFrom(ctx: Ctx, pass: PassResult, id: string, memo: Map<string, number>, stack: Set<string>): number {
  if (memo.has(id)) return memo.get(id)!;
  if (stack.has(id)) return 0;
  stack.add(id);
  const n = ctx.byId.get(id)!;
  const ns = pass.nodes[id];
  const df = d(n.kind).flow;
  let lat = ns.status === 'dead' ? 0 : hopLatency(df.latencyMs, ns.syncUtil);
  if (n.kind === 'client') lat = 0;
  const inSync = ns.r + ns.w;
  const isClient = n.kind === 'client';
  let fracSum = 0;
  if (inSync > 0 && ns.status !== 'dead' && ns.status !== 'degraded' && !df.async) {
    for (const e of ctx.out.get(id) ?? []) {
      if (ctx.types.get(e.id) !== 'sync') {
        // the hand-off to an async buffer is itself on the request path
        if (ctx.types.get(e.id) === 'async' && d(ctx.byId.get(e.to)!.kind).flow.async) {
          const es = pass.edges[e.id];
          lat += (Math.min(es.w, inSync) / inSync) * d(ctx.byId.get(e.to)!.kind).flow.latencyMs;
        }
        continue;
      }
      const es = pass.edges[e.id];
      const frac = Math.min(1, (es.r + es.w) / inSync);
      if (frac <= 0) continue;
      fracSum += frac;
      const t = pass.nodes[e.to];
      if (t.status === 'dead') {
        lat += frac * (healthAware(ctx, n) ? 2 : 1000); // timeout
      } else {
        lat += frac * latencyFrom(ctx, pass, e.to, memo, stack);
        // calls that land on a dead instance wait for a timeout
        if (t.flaky) {
          const tn = ctx.byId.get(e.to)!;
          lat += frac * ((tn.down ?? 0) / tn.count) * 1000;
        }
      }
    }
  }
  // a client using several paths (API, CDN, direct upload) sends different requests down each: average them
  if (isClient && fracSum > 1) lat /= fracSum;
  stack.delete(id);
  memo.set(id, lat);
  return lat;
}

function syncReach(ctx: Ctx, from: string[], skip?: string): Set<string> {
  const seen = new Set<string>();
  const st = [...from];
  while (st.length) {
    const id = st.pop()!;
    if (seen.has(id) || id === skip) continue;
    seen.add(id);
    for (const e of ctx.out.get(id) ?? []) {
      const ty = ctx.types.get(e.id);
      if (ty === 'sync' || (ty === 'async' && d(ctx.byId.get(e.to)!.kind).flow.async && d(ctx.byId.get(id)!.kind).flow.async === undefined)) {
        st.push(e.to);
      }
    }
  }
  return seen;
}

/** Copies of the data (durability) or automatically-failing-over instances (availability). */
function redundancy(ctx: Ctx, n: GNode, forAvailability: boolean): number {
  const parents = ctx.inn.get(n.id) ?? [];
  const partitioned = parents.length > 0 && parents.every((e) => PARTITIONERS.includes(ctx.byId.get(e.from)!.kind));
  // key-routed partitions each own unique data: N shards are N single copies, not N copies
  let k = partitioned && !forAvailability ? Math.min(1, aliveOf(n)) : aliveOf(n);
  const hasReplica = (ctx.out.get(n.id) ?? []).some((e) => ctx.byId.get(e.to)!.kind === 'replica');
  // a replica is another copy; it only counts for uptime if something promotes it automatically
  if (hasReplica && (!forAvailability || ctx.coordinated.has(n.id))) k += 1;
  return k;
}

function computeMetrics(ctx: Ctx, pass: PassResult, traffic: number): Metrics {
  const { wl } = ctx;
  const clients = ctx.g.nodes.filter((n) => n.kind === 'client').map((n) => n.id);
  const reach = syncReach(ctx, clients);
  const terminals = [...reach].filter((id) => {
    const n = ctx.byId.get(id)!;
    if (n.kind === 'client') return false;
    return !(ctx.out.get(id) ?? []).some((e) => reach.has(e.to) && ctx.types.get(e.id) === 'sync');
  });
  // look-aside caches are optional for correctness; everything else on the path is required
  const hard = terminals.filter((id) => !d(ctx.byId.get(id)!.kind).flow.absorbs);
  const connected = terminals.some((id) => {
    const k = ctx.byId.get(id)!.kind;
    const df = d(k).flow;
    return df.durable || df.async || k === 'search' || k === 'cache' || k === 'service' || k === 'app' || k === 'big-server';
  });

  // SPOF / availability: node v is critical if removing it disconnects any terminal
  const spofs: string[] = [];
  let availability = 1;
  for (const id of reach) {
    const n = ctx.byId.get(id)!;
    if (n.kind === 'client') continue;
    const after = syncReach(ctx, clients, id);
    const critical = hard.some((t) => t === id || !after.has(t));
    if (!critical) continue;
    const df = d(n.kind).flow;
    const k = redundancy(ctx, n, true);
    availability *= df.managed ? df.availability : 1 - Math.pow(1 - df.availability, Math.max(k, 0));
    if (!df.managed && k <= 1) spofs.push(id);
  }
  if (!connected) availability = 0;

  // max sustainable QPS
  let maxUtil = 0;
  for (const ns of Object.values(pass.nodes)) {
    if (ns.status === 'dead') continue;
    if (reach.has(ns.id)) maxUtil = Math.max(maxUtil, ns.syncUtil);
  }
  const offered = wl.qps * traffic;
  const maxQps = !connected ? 0 : maxUtil > 0 ? offered / maxUtil : Number.POSITIVE_INFINITY;

  const memo = new Map<string, number>();
  let p99 = 0;
  for (const c of clients) p99 = Math.max(p99, latencyFrom(ctx, pass, c, memo, new Set()));
  for (const [id, v] of memo) pass.nodes[id].latencyMs = v;

  const cost = ctx.g.nodes.reduce((s, n) => s + d(n.kind).flow.cost * n.count * (ctx.autoscaled.has(n.id) ? 1.6 : 1), 0);

  // durability: worst primary store
  const stores = ctx.g.nodes.filter((n) => d(n.kind).flow.durable && n.kind !== 'replica' && !d(n.kind).flow.async);
  let durability: Metrics['durability'];
  if (stores.length === 0) durability = { level: 0, label: 'None — nothing persists' };
  else {
    let worst = 3;
    for (const s of stores) {
      const df = d(s.kind).flow;
      const lvl = df.managed ? 3 : redundancy(ctx, s, false) >= 2 ? 2 : 1;
      worst = Math.min(worst, lvl);
    }
    durability = {
      level: worst as 1 | 2 | 3,
      label: worst === 3 ? '11 nines (managed)' : worst === 2 ? 'Replicated copies' : 'Single copy — disk loss = data loss',
    };
  }

  const kinds = new Set(ctx.g.nodes.map((n) => n.kind));
  const consistency: string[] = [];
  if (kinds.has('multi-master')) consistency.push('Write conflicts (LWW)');
  if (kinds.has('replica') && ctx.g.nodes.some((n) => n.kind === 'replica' && pass.nodes[n.id]?.r > 0)) consistency.push('Replica lag');
  if (kinds.has('cache') || kinds.has('local-cache') || kinds.has('cdn')) consistency.push('Cache TTL staleness');
  if (kinds.has('queue') || kinds.has('stream') || kinds.has('pubsub')) consistency.push('Async processing');
  if (kinds.has('read-model') || kinds.has('search')) consistency.push('Projection/index lag');
  if (consistency.length === 0) consistency.push('Strong (single source of truth)');

  const offeredR = wl.qps * traffic * (1 + (wl.abusive ?? 0)) * wl.readRatio;
  const offeredW = wl.qps * traffic * (1 + (wl.abusive ?? 0)) * (1 - wl.readRatio);
  const readOk = !connected ? 0 : offeredR > 0 ? Math.max(0, 1 - pass.errR / offeredR) : 1;
  const writeOk = !connected ? 0 : offeredW > 0 ? Math.max(0, 1 - pass.errW / offeredW) : 1;
  const errorRate = 1 - (readOk * offeredR + writeOk * offeredW) / Math.max(offeredR + offeredW, 1e-9);
  const throttled = Object.values(pass.nodes).reduce((s, n) => s + n.throttled, 0);
  const backlog = Object.values(pass.nodes).reduce((s, n) => s + n.backlog, 0);
  const deduped = ctx.g.nodes.some((n) => n.kind === 'idem-store' && (pass.nodes[n.id]?.w ?? 0) > 0);
  const duplicates = deduped || !connected ? 0 : (wl.retryRate ?? 0) * offeredW * writeOk;

  return { offered, maxQps, p99, availability, spofs, cost, durability, consistency, readOk, writeOk, errorRate, throttled, backlog, duplicates, connected };
}

export function simulate(g: Graph, wl: Workload, opts: SimOptions = {}): SimResult {
  const traffic = opts.traffic ?? 1;
  const ctx = buildCtx(g, wl);
  const first = runPass(ctx, traffic, null);
  const second = first.unhealthy.size ? runPass(ctx, traffic, first) : first;
  const metrics = computeMetrics(ctx, second, traffic);
  return { nodes: second.nodes, edges: second.edges, metrics };
}

/* ------------------------------------------------------------------ */
/* failure prediction                                                  */
/* ------------------------------------------------------------------ */

export const OUTCOMES = [
  'No user impact',
  'Slower, but working',
  'Some requests fail',
  'Reads work, writes fail',
  'Full outage',
] as const;

export type Outcome = (typeof OUTCOMES)[number];

export function killOne(g: Graph, nodeId: string): Graph {
  return {
    ...g,
    nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, down: Math.min(n.count, (n.down ?? 0) + 1) } : n)),
  };
}

export function classifyOutcome(before: Metrics, after: Metrics): Outcome {
  const { readOk, writeOk } = after;
  if (readOk < 0.1 && writeOk < 0.1) return 'Full outage';
  if (readOk >= 0.9 && writeOk < 0.5) return 'Reads work, writes fail';
  if (readOk < 0.98 || writeOk < 0.98) return 'Some requests fail';
  if (after.p99 > before.p99 * 1.5 + 5) return 'Slower, but working';
  return 'No user impact';
}

export function predictKill(g: Graph, wl: Workload, nodeId: string) {
  const before = simulate(g, wl).metrics;
  const after = simulate(killOne(g, nodeId), wl).metrics;
  return { outcome: classifyOutcome(before, after), before, after };
}
