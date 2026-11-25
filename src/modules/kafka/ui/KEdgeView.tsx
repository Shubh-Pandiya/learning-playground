import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { fmtN, type EdgeView } from '../engine/model';

export interface KEdgeData extends Record<string, unknown> {
  kind: EdgeView['kind'];
  rate: number;
  failing: boolean;
  animate: boolean;
  showRate: boolean;
  note?: string;
}

export type KFlowEdge = Edge<KEdgeData, 'k'>;

export const EDGE_COLOR: Record<EdgeView['kind'], string> = {
  produce: 'rgb(var(--c-accent))',
  consume: 'rgb(var(--c-violet))',
  write: 'rgb(var(--c-info))',
  cdc: 'rgb(var(--c-ok))',
  invalid: 'rgb(var(--c-bad))',
};

function KEdgeImpl({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<KFlowEdge>) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 });
  const d = data ?? { kind: 'produce', rate: 0, failing: false, animate: false, showRate: false };
  const bad = d.kind === 'invalid' || d.failing;
  const color = bad ? EDGE_COLOR.invalid : EDGE_COLOR[d.kind];
  const live = d.animate && d.rate > 0.5 && d.kind !== 'invalid';
  const dots = live ? Math.max(1, Math.min(5, Math.round(Math.log10(d.rate + 1) * 1.2))) : 0;
  const dur = d.kind === 'consume' ? 1.9 : 1.5;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={18}
        style={{ stroke: color, strokeWidth: selected ? 2.6 : d.rate > 0 ? 1.9 : 1.3, strokeOpacity: d.rate > 0 || bad ? 0.9 : 0.4, strokeDasharray: d.kind === 'consume' || d.kind === 'cdc' ? '6 5' : d.kind === 'invalid' ? '3 4' : undefined }}
        className={live && (d.kind === 'consume' || d.kind === 'cdc') ? 'animate-flow-dash' : undefined}
        markerEnd={`url(#k-arrow-${bad ? 'invalid' : d.kind})`}
      />
      {Array.from({ length: dots }, (_, i) => (
        <circle key={i} r={3} style={{ fill: color, stroke: 'rgb(var(--c-surface))', strokeWidth: 1 }}>
          <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={path} begin={`${(i * dur) / dots}s`} keyPoints={d.failing ? '0;0.5' : undefined} keyTimes={d.failing ? '0;1' : undefined} calcMode={d.failing ? 'linear' : undefined} />
        </circle>
      ))}
      {(bad || (d.showRate && d.rate > 0.5)) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute max-w-[160px] rounded border px-1 font-mono text-[9.5px] leading-4 shadow-paper"
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, background: 'rgb(var(--c-surface))', borderColor: bad ? 'rgb(var(--c-bad) / 0.5)' : 'rgb(var(--c-line))', color: bad ? 'rgb(var(--c-bad))' : 'rgb(var(--c-muted))' }}
          >
            {d.kind === 'invalid' ? '✗ invalid link' : d.failing ? '✗ failing' : `${fmtN(d.rate)}/s`}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const KEdgeView = memo(KEdgeImpl);

export function EdgeMarkers() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
      <defs>
        {Object.entries(EDGE_COLOR).map(([k, c]) => (
          <marker key={k} id={`k-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: c }} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
