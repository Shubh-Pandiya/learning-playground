import type { ChaosId, GEdge, GNode, Graph, Pattern, RefEdge, RefNode, Scenario } from '../types';
import { killOne } from './simulate';

export const edgeId = (from: string, to: string) => `${from}->${to}`;

export function toGNode(n: RefNode): GNode {
  return { id: n.id, kind: n.kind, label: n.label, count: n.count ?? 1, x: n.x, y: n.y };
}

/** Build a graph from reference nodes/edges, optionally limited to visible node ids. */
export function toGraph(nodes: RefNode[], edges: RefEdge[], visible?: Set<string>): Graph {
  const shown = nodes.filter((n) => !visible || visible.has(n.id));
  const ids = new Set(shown.map((n) => n.id));
  const out: GEdge[] = [];
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    const hide = typeof e.hideWhen === 'string' ? [e.hideWhen] : e.hideWhen ?? [];
    if (hide.some((h) => ids.has(h))) continue;
    const id = edgeId(e.from, e.to);
    if (!out.some((x) => x.id === id)) out.push({ id, from: e.from, to: e.to });
  }
  return { nodes: shown.map(toGNode), edges: out };
}

export const referenceGraph = (s: Scenario): Graph => toGraph(s.reference.nodes, s.reference.edges);

export interface GuidedFrame {
  graph: Graph;
  visible: Set<string>;
  traffic: number;
  /** Chaos event revealed at this step. */
  chaos?: ChaosId;
  /** Node ids that appeared in this step (for highlighting). */
  added: string[];
  removed: string[];
}

/** Graph state at a guided step: cumulative adds/removes, this step's kills and traffic.
 * With `reveal = false` the step's kills/traffic are not applied yet (predict-before-reveal). */
export function guidedFrame(p: Pattern, step: number, reveal = true): GuidedFrame {
  const visible = new Set<string>();
  let added: string[] = [];
  let removed: string[] = [];
  for (let i = 0; i <= step && i < p.guided.length; i++) {
    const st = p.guided[i];
    added = (st.add ?? []).filter((id) => !visible.has(id));
    removed = (st.remove ?? []).filter((id) => visible.has(id));
    for (const id of st.add ?? []) visible.add(id);
    for (const id of st.remove ?? []) visible.delete(id);
  }
  const allNodes = [...p.scenario.reference.nodes, ...(p.extras?.nodes ?? [])];
  const allEdges = [...p.scenario.reference.edges, ...(p.extras?.edges ?? [])];
  let graph = toGraph(allNodes, allEdges, visible);
  const st = p.guided[Math.min(step, p.guided.length - 1)];
  if (reveal) for (const id of st?.kill ?? []) if (visible.has(id)) graph = killOne(graph, id);
  return { graph, visible, traffic: reveal ? st?.traffic ?? 1 : 1, chaos: reveal ? st?.chaos : undefined, added, removed };
}
