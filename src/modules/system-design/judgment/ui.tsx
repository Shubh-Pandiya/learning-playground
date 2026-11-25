import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { getPattern } from '../data/patterns';
import { edgeId } from '../engine/graph';
import type { Graph } from '../types';
import type { DrillGraph } from './types';

export function drillGraph(g: DrillGraph): Graph {
  return {
    nodes: g.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label, count: n.count ?? 1, x: n.x, y: n.y, down: 0 })),
    edges: g.edges.map((e) => ({ id: edgeId(e.from, e.to), from: e.from, to: e.to })),
  };
}

export function BackToPractice() {
  return (
    <Link to="/system-design/practice" className="inline-flex items-center gap-1 font-mono text-[12px] text-faint hover:text-ink">
      <ArrowLeft size={13} /> Judgment drills
    </Link>
  );
}

export function PatternLinks({ ids, label = 'Related patterns' }: { ids: string[]; label?: ReactNode }) {
  const ps = ids.map((id) => getPattern(id)).filter((p): p is NonNullable<typeof p> => !!p);
  if (!ps.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="eyebrow mr-1">{label}</span>
      {ps.map((p) => (
        <Link key={p.id} to={`/system-design/p/${p.id}/learn`} className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-muted hover:border-accent hover:text-ink">
          {p.num}. {p.title}
        </Link>
      ))}
    </div>
  );
}
