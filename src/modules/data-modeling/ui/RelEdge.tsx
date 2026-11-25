import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';

export interface RelEdgeData extends Record<string, unknown> {
  card: '1:1' | '1:N';
  /** FK column names. */
  label: string;
  identifying: boolean;
  onPath?: boolean;
  wrong?: boolean;
  fresh?: boolean;
}

export type DmFlowEdge = Edge<RelEdgeData, 'rel'>;

const C = { base: 'rgb(var(--c-muted))', path: 'rgb(var(--c-accent))', bad: 'rgb(var(--c-bad))' };

/**
 * Crow's-foot notation. Source = child (the "many" end, holds the FK), target = parent (the "one" end).
 */
function RelEdgeView(props: EdgeProps<DmFlowEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } = props;
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.3 });
  const d = data ?? { card: '1:N', label: '', identifying: false };
  const tone = d.wrong ? 'bad' : d.onPath ? 'path' : 'base';
  const color = C[tone];
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={18}
        style={{ stroke: color, strokeWidth: selected || d.onPath ? 2.4 : 1.5, strokeOpacity: d.onPath || selected || d.wrong ? 0.95 : 0.6, strokeDasharray: d.identifying ? undefined : '6 4' }}
        markerStart={`url(#dm-${d.card === '1:1' ? 'one' : 'many'}-${tone})`}
        markerEnd={`url(#dm-one-${tone})`}
      />
      {d.onPath && (
        <circle r={3.4} style={{ fill: color, stroke: 'rgb(var(--c-surface))', strokeWidth: 1 }}>
          <animateMotion dur="1.4s" repeatCount="indefinite" path={path} />
        </circle>
      )}
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-none absolute rounded border px-1 font-mono text-[9.5px] leading-4 shadow-paper"
          style={{
            transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`,
            background: 'rgb(var(--c-surface))',
            borderColor: d.onPath ? 'rgb(var(--c-accent) / 0.5)' : 'rgb(var(--c-line))',
            color: d.onPath ? 'rgb(var(--c-accent))' : 'rgb(var(--c-muted))',
          }}
        >
          {d.card === '1:1' ? '1 : 1' : 'N : 1'} · {d.label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const RelEdge = memo(RelEdgeView);

/** Crow's-foot markers; render once inside the canvas. Drawn as if at the path end (x+ points into the table). */
export function RelMarkers() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
      <defs>
        {(Object.entries(C) as [string, string][]).map(([k, c]) => (
          <g key={k}>
            <marker id={`dm-one-${k}`} viewBox="0 0 16 16" refX="15" refY="8" markerWidth="16" markerHeight="16" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M 6 2 L 6 14 M 10 2 L 10 14 M 0 8 L 16 8" style={{ stroke: c, strokeWidth: 1.6, fill: 'none' }} />
            </marker>
            <marker id={`dm-many-${k}`} viewBox="0 0 16 16" refX="15" refY="8" markerWidth="16" markerHeight="16" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M 4 2 L 4 14 M 0 8 L 16 8 M 7 8 L 16 1.5 M 7 8 L 16 14.5" style={{ stroke: c, strokeWidth: 1.6, fill: 'none' }} />
            </marker>
          </g>
        ))}
      </defs>
    </svg>
  );
}
