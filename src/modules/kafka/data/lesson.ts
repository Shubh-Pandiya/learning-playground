import type { Requirement } from '../engine/check';
import type { Chaos, ClusterCfg, KEdge, KGraph, KKind, KNode, NodeCfg } from '../types';

export type Op =
  | { add: KNode }
  | { link: [string, string] }
  | { unlink: [string, string] }
  | { set: [string, Partial<NodeCfg>] }
  | { cluster: Partial<ClusterCfg> }
  | { remove: string };

export interface Predict {
  q: string;
  options: string[];
  answer: number;
  /** Shown after answering: the mechanism, not just the result. */
  explain: string;
}

export interface LearnStep {
  title: string;
  /** Rich text (supports **bold** and `code`). */
  body: string;
  ops?: Op[];
  /** Chaos active while this step is shown (replaces the previous step's chaos). */
  chaos?: Partial<Chaos>;
  focus?: string;
  /** Pause: user must predict before the ops/chaos are applied. */
  predict?: Predict;
  /** Shown under the canvas: how it is built internally. */
  internals?: string;
}

export interface Scenario {
  title: string;
  story: string;
  start: KGraph;
  palette: KKind[];
  reqs: Requirement[];
  hints: [string, string, string];
  reference: KGraph;
  debrief: string;
}

export interface QuizQ {
  q: string;
  options: string[];
  answer: number;
  explain: string;
}

export interface Lesson {
  id: string;
  n: number;
  title: string;
  tagline: string;
  minutes: number;
  concepts: string[];
  /** The production problem this concept solves. */
  problem: string;
  /** Graph the Learn steps start from. */
  stage: KGraph;
  learn: LearnStep[];
  build: Scenario;
  challenge: Scenario;
  quiz: QuizQ[];
  takeaways: string[];
  interview: { q: string; a: string }[];
  /** Related internals deep dive ids. */
  deepDives: string[];
}

/* ---------------- graph builders ---------------- */

export const COL = { a: 40, b: 300, c: 560, d: 820, e: 1080 } as const;
export const ROW = (i: number) => 60 + i * 150;

export const n = (kind: KKind, id: string, x: number, y: number, cfg: Partial<NodeCfg> = {}, label?: string): KNode => ({ id, kind, x, y, cfg, label });

export function graph(nodes: KNode[], links: string[], brokers = 3): KGraph {
  const edges: KEdge[] = links.map((l) => {
    const [from, to] = l.split('>');
    return { id: `${from}->${to}`, from, to };
  });
  return { nodes, edges, cluster: { brokers, kraft: true } };
}

export function applyOps(g: KGraph, ops: Op[] = []): KGraph {
  let out: KGraph = { nodes: g.nodes.map((x) => ({ ...x, cfg: { ...x.cfg } })), edges: [...g.edges], cluster: { ...g.cluster } };
  for (const op of ops) {
    if ('add' in op) out.nodes = [...out.nodes.filter((x) => x.id !== op.add.id), { ...op.add, cfg: { ...op.add.cfg } }];
    else if ('link' in op) {
      const [from, to] = op.link;
      const id = `${from}->${to}`;
      if (!out.edges.some((e) => e.id === id)) out.edges = [...out.edges, { id, from, to }];
    } else if ('unlink' in op) out.edges = out.edges.filter((e) => !(e.from === op.unlink[0] && e.to === op.unlink[1]));
    else if ('set' in op) out.nodes = out.nodes.map((x) => (x.id === op.set[0] ? { ...x, cfg: { ...x.cfg, ...op.set[1] } } : x));
    else if ('cluster' in op) out.cluster = { ...out.cluster, ...op.cluster };
    else if ('remove' in op) {
      out = { ...out, nodes: out.nodes.filter((x) => x.id !== op.remove), edges: out.edges.filter((e) => e.from !== op.remove && e.to !== op.remove) };
    }
  }
  return out;
}

export function describeOp(g: KGraph, op: Op, names: (id: string) => string): string {
  if ('add' in op) return `Added ${op.add.label ?? op.add.kind}`;
  if ('link' in op) return `Connected ${names(op.link[0])} → ${names(op.link[1])}`;
  if ('unlink' in op) return `Removed ${names(op.unlink[0])} → ${names(op.unlink[1])}`;
  if ('set' in op) return `${names(op.set[0])}: ${Object.entries(op.set[1]).map(([k, v]) => `${k}=${v}`).join(', ')}`;
  if ('cluster' in op) return `Cluster: ${Object.entries(op.cluster).map(([k, v]) => `${k}=${v}`).join(', ')}`;
  void g;
  return `Removed ${names(op.remove)}`;
}
