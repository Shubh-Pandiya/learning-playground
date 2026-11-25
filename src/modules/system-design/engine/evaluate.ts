import { COMPONENTS } from '../data/components';
import type { Check, ComponentKind, GNode, Graph, Requirement, Scenario, Verdict } from '../types';
import { killOne, simulate, type Metrics, type SimResult } from './simulate';

/* ------------------------------------------------------------------ */
/* node / edge feedback                                                */
/* ------------------------------------------------------------------ */

export interface NodeFeedback {
  verdict: Verdict;
  title: string;
  /** Main explanation (what it solves here, or why it's wrong). */
  body: string;
  tradeoffs: string[];
  instead?: string;
}

const refKinds = (s: Scenario) => new Set(s.reference.nodes.map((n) => n.kind));

export function nodeFeedback(s: Scenario, kind: ComponentKind): NodeFeedback {
  const def = COMPONENTS[kind];
  const wrong = s.wrong[kind];
  if (wrong) {
    return {
      verdict: 'wrong',
      title: `${def.name} is the wrong tool here`,
      body: wrong.why,
      tradeoffs: def.trap ? [def.trap] : def.tradeoffs,
      instead: wrong.instead,
    };
  }
  const alt = s.alt?.[kind];
  if (alt) {
    return { verdict: 'extra', title: `${def.name} would also work`, body: alt, tradeoffs: def.tradeoffs };
  }
  const ref = s.reference.nodes.find((n) => n.kind === kind);
  if (ref) {
    return {
      verdict: 'good',
      title: `${def.name}: ${def.solves}`,
      body: ref.why,
      tradeoffs: def.tradeoffs,
    };
  }
  if (def.trap) {
    return {
      verdict: 'wrong',
      title: `${def.name} is a trap`,
      body: def.trap,
      tradeoffs: def.tradeoffs,
    };
  }
  return {
    verdict: 'extra',
    title: `${def.name} isn't needed for these requirements`,
    body: `${def.solves} But nothing in this scenario needs it, so it only adds cost, latency and moving parts.`,
    tradeoffs: def.tradeoffs,
  };
}

export interface EdgeFeedback {
  verdict: Verdict;
  text: string;
}

const STORES: ComponentKind[] = ['db', 'replica', 'shard', 'nosql', 'cache', 'event-store', 'read-model', 'search', 'multi-master', 'blob-column', 'nfs'];

export function edgeFeedback(s: Scenario, from: GNode, to: GNode): EdgeFeedback {
  const a = from.kind;
  const b = to.kind;
  const nameA = COMPONENTS[a].name;
  const nameB = COMPONENTS[b].name;
  const refById = new Map(s.reference.nodes.map((n) => [n.id, n]));
  const refEdge = s.reference.edges.find((e) => refById.get(e.from)?.kind === a && refById.get(e.to)?.kind === b);
  if (refEdge) return { verdict: 'good', text: refEdge.why ?? `${nameA} → ${nameB} matches the reference design.` };

  if (a === 'client' && (STORES.includes(b) || b === 'worker' || b === 'shard-router' || b === 'hash-ring')) {
    return {
      verdict: 'wrong',
      text: `Clients should never talk to the ${nameB} directly: no auth, no validation, no way to evolve the schema, and every client becomes a connection to your data tier. Put an LB/gateway and app tier in between.`,
    };
  }
  if ((a === 'lb' || a === 'api-gateway') && STORES.includes(b)) {
    return { verdict: 'wrong', text: `A ${nameA} forwards HTTP to compute; it can't speak to a ${nameB}. Route through an app/service.` };
  }
  if (COMPONENTS[a].flow.async && b === 'client') {
    return { verdict: 'wrong', text: `${nameA} can't push to browsers directly; consumers (workers / a push gateway) deliver results.` };
  }
  if (COMPONENTS[b].flow.accepts === 'none' && !COMPONENTS[b].flow.control) {
    return { verdict: 'wrong', text: `${nameB} doesn't receive traffic.` };
  }
  const reversed = s.reference.edges.find((e) => refById.get(e.from)?.kind === b && refById.get(e.to)?.kind === a);
  if (reversed) return { verdict: 'extra', text: `Backwards: in this design ${nameB} calls ${nameA}, not the other way round.` };
  if (s.wrong[a] || s.wrong[b]) return { verdict: 'wrong', text: `Connected to a component that doesn't belong in this design.` };
  return { verdict: 'extra', text: `${nameA} → ${nameB} isn't part of the reference design. It may still work — watch the metrics.` };
}

/* ------------------------------------------------------------------ */
/* requirement checks                                                  */
/* ------------------------------------------------------------------ */

const countKind = (g: Graph, k: ComponentKind) => g.nodes.filter((n) => n.kind === k).reduce((s, n) => s + n.count, 0);

function hasEdgeKinds(g: Graph, a: ComponentKind, b: ComponentKind) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  return g.edges.some((e) => byId.get(e.from)?.kind === a && byId.get(e.to)?.kind === b);
}

function survivesKill(g: Graph, s: Scenario, kind: ComponentKind, writesOnly: boolean) {
  const targets = g.nodes.filter((n) => n.kind === kind);
  if (targets.length === 0) return false;
  return targets.every((n) => {
    const m = simulate(killOne(g, n.id), s.workload).metrics;
    return writesOnly ? m.writeOk >= 0.99 : m.readOk >= 0.99 && m.writeOk >= 0.99;
  });
}

export function runCheck(c: Check, g: Graph, s: Scenario, m: Metrics): boolean {
  switch (c.type) {
    case 'has':
      return countKind(g, c.kind) >= (c.min ?? 1);
    case 'hasAny':
      return c.kinds.some((k) => countKind(g, k) > 0);
    case 'edge':
      return hasEdgeKinds(g, c.from, c.to);
    case 'maxQps':
      return m.connected && m.maxQps >= c.gte && m.errorRate < 0.01;
    case 'p99':
      return m.connected && m.p99 <= c.lte;
    case 'noSpof':
      return m.connected && m.spofs.length === 0;
    case 'availability':
      return m.connected && m.availability >= c.gte;
    case 'none':
      return !c.kinds.some((k) => countKind(g, k) > 0);
    case 'survives':
      return m.connected && survivesKill(g, s, c.kind, false);
    case 'writesSurvive':
      return m.connected && survivesKill(g, s, c.kind, true);
    case 'noEdge':
      return !hasEdgeKinds(g, c.from, c.to);
    case 'durability':
      return m.connected && m.durability.level >= c.gte;
    case 'spike': {
      const sm = simulate(g, s.workload, { traffic: c.factor }).metrics;
      return sm.connected && sm.errorRate < 0.01;
    }
    case 'noDuplicates':
      return m.connected && m.duplicates === 0;
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
    if (h === 0) missing.push(`Add a ${COMPONENTS[k].name}`);
    else if (h < need) missing.push(`Scale ${COMPONENTS[k].name} to ${need} instances (have ${h})`);
  }

  const refById = new Map(s.reference.nodes.map((n) => [n.id, n]));
  const refPairs = new Map<string, string | undefined>();
  for (const e of s.reference.edges) {
    const a = refById.get(e.from)!.kind;
    const b = refById.get(e.to)!.kind;
    refPairs.set(`${a}>${b}`, e.why);
  }
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const userPairs = new Set(g.edges.map((e) => `${byId.get(e.from)?.kind}>${byId.get(e.to)?.kind}`));
  for (const pair of refPairs.keys()) {
    max += 1;
    if (userPairs.has(pair)) got += 1;
    else {
      const [a, b] = pair.split('>') as ComponentKind[];
      if ((have.get(a) ?? 0) > 0 && (have.get(b) ?? 0) > 0) missing.push(`Connect ${COMPONENTS[a].name} → ${COMPONENTS[b].name}`);
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

export function evaluate(g: Graph, s: Scenario, traffic = 1): Evaluation {
  const healthy: Graph = { ...g, nodes: g.nodes.map((n) => ({ ...n, down: 0 })) };
  const base = simulate(healthy, s.workload);
  const sim = traffic === 1 && g.nodes.every((n) => !n.down) ? base : simulate(g, s.workload, { traffic });
  const reqs = s.requirements.map((req) => ({ req, met: runCheck(req.check, healthy, s, base.metrics) }));
  const close = closeness(g, s, reqs);
  // a design whose writes land nowhere durable isn't a solution, however fast it is
  const isStore = (k: ComponentKind) => !!COMPONENTS[k].flow.durable && !COMPONENTS[k].flow.async;
  const refStores = s.reference.nodes.some((n) => isStore(n.kind));
  const storesWrites = g.nodes.some((n) => isStore(n.kind) && (base.nodes[n.id]?.w ?? 0) + (base.nodes[n.id]?.aw ?? 0) > 0);
  if (refStores && !storesWrites) close.missing.unshift('Writes must end up in a durable store');
  const out = new Set(g.edges.map((e) => e.from));
  const stalled = g.nodes.filter((n) => {
    const f = COMPONENTS[n.kind].flow;
    const ns = base.nodes[n.id];
    return f.async && n.kind !== 'dlq' && !out.has(n.id) && (ns?.w ?? 0) + (ns?.aw ?? 0) > 0;
  });
  for (const n of stalled) close.missing.unshift(`Nothing consumes ${n.label ?? COMPONENTS[n.kind].name}: messages pile up forever`);
  const orphans = g.nodes.filter((n) => {
    const f = COMPONENTS[n.kind].flow;
    const ns = base.nodes[n.id];
    return n.kind !== 'client' && !f.control && (ns?.r ?? 0) + (ns?.w ?? 0) + (ns?.aw ?? 0) <= 0;
  });
  for (const n of orphans) close.missing.push(`${n.label ?? COMPONENTS[n.kind].name} receives no traffic — connect it`);
  const solved =
    reqs.every((r) => r.met) &&
    close.wrongNodes.length === 0 &&
    close.badEdges.length === 0 &&
    (!refStores || storesWrites) &&
    stalled.length === 0 &&
    orphans.length === 0;
  return { sim, baseline: base.metrics, reqs, close, solved };
}

/* ------------------------------------------------------------------ */
/* faded hints                                                         */
/* ------------------------------------------------------------------ */

const CAT_HINT: Record<string, string> = {
  entry: 'something at the edge / entry of the system',
  compute: 'more or different compute',
  data: 'something in the data tier',
  messaging: 'a messaging component (decouple with async)',
  control: 'a control-plane component',
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
  if (level === 1) return unmet ? `"${unmet.req.text}" — ${unmet.req.hint}` : (ev.close.missing[0] ?? 'Everything is in place — try breaking it with the chaos tools.');
  if (level === 2 && nextRef) return `Think about ${CAT_HINT[COMPONENTS[nextRef.kind].category]}.`;
  if (nextRef) return `Add a ${COMPONENTS[nextRef.kind].name} — ${nextRef.why}`;
  return ev.close.missing[0] ?? 'Nothing missing.';
}

