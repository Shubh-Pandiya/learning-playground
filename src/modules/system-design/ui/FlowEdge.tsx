import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import type { EdgeType } from '../engine/simulate';
import type { Verdict } from '../types';
import { fmtNum } from './format';

export interface FlowEdgeData extends Record<string, unknown> {
  type: EdgeType;
  rate: number;
  failing: boolean;
  verdict?: Verdict;
  animate: boolean;
  /** Show the req/s label. */
  showRate?: boolean;
}

export type SdFlowEdge = Edge<FlowEdgeData, 'flow'>;

const COLOR: Record<EdgeType, string> = {
  sync: 'rgb(var(--c-accent))',
  async: 'rgb(var(--c-violet))',
  replication: 'rgb(var(--c-info))',
  control: 'rgb(var(--c-faint))',
};

function FlowEdgeView(props: EdgeProps<SdFlowEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } = props;
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 });
  const d = data ?? { type: 'sync', rate: 0, failing: false, animate: false };
  const wrong = d.verdict === 'wrong';
  const bad = wrong || d.failing;
  const color = bad ? 'rgb(var(--c-bad))' : COLOR[d.type];
  const dashed = d.type === 'replication' || d.type === 'control' || d.type === 'async';
  const live = d.animate && d.rate > 0.5 && d.type !== 'control';
  const dots = live ? Math.max(1, Math.min(5, Math.round(Math.log10(d.rate + 1) * 1.4))) : 0;
  const dur = d.type === 'replication' ? 2.6 : d.type === 'async' ? 2.2 : 1.5;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={18}
        style={{
          stroke: color,
          strokeWidth: selected ? 2.6 : d.rate > 0 || d.type === 'control' ? 1.8 : 1.2,
          strokeOpacity: d.rate > 0 || d.type === 'control' || bad ? 0.9 : 0.35,
          strokeDasharray: dashed ? (d.type === 'control' ? '2 4' : '6 5') : undefined,
        }}
        className={dashed && live ? 'animate-flow-dash' : undefined}
        markerEnd={`url(#sd-arrow-${bad ? 'bad' : d.type})`}
      />
      {Array.from({ length: dots }, (_, i) =>
        d.type === 'async' ? (
          <rect key={i} width={7} height={5} x={-3.5} y={-2.5} rx={1} style={{ fill: color }}>
            <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={path} begin={`${(i * dur) / dots}s`} rotate="auto" />
          </rect>
        ) : (
          <circle key={i} r={d.failing ? 3 : 3.2} style={{ fill: color, stroke: 'rgb(var(--c-surface))', strokeWidth: 1 }}>
            <animateMotion
              dur={`${dur}s`}
              repeatCount="indefinite"
              path={path}
              begin={`${(i * dur) / dots}s`}
              keyPoints={d.failing ? '0;0.55' : undefined}
              keyTimes={d.failing ? '0;1' : undefined}
              calcMode={d.failing ? 'linear' : undefined}
            />
          </circle>
        ),
      )}
      {(wrong || (d.showRate && d.rate > 0.5) || d.failing) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded border px-1 font-mono text-[9.5px] leading-4 shadow-paper"
            style={{
              transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`,
              background: 'rgb(var(--c-surface))',
              borderColor: bad ? 'rgb(var(--c-bad) / 0.5)' : 'rgb(var(--c-line))',
              color: bad ? 'rgb(var(--c-bad))' : 'rgb(var(--c-muted))',
            }}
          >
            {wrong ? '✗ wrong link' : d.failing ? '✗ failing' : `${fmtNum(d.rate)}/s`}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const FlowEdge = memo(FlowEdgeView);

/** Arrow markers referenced by FlowEdge; render once inside the canvas. */
export function EdgeMarkers() {
  const entries: [string, string][] = [...(Object.entries(COLOR) as [string, string][]), ['bad', 'rgb(var(--c-bad))']];
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
      <defs>
        {entries.map(([k, c]) => (
          <marker key={k} id={`sd-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: c }} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
