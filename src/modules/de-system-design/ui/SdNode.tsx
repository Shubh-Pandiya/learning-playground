import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Skull } from 'lucide-react';
import { cn } from '@/shared/cn';
import { COMPONENTS } from '../data/components';
import type { NodeSim } from '../engine/simulate';
import type { ComponentKind, Verdict } from '../types';
import { fmtNum } from './format';
import { IsoGlyph } from './iso';

export interface SdNodeData extends Record<string, unknown> {
  kind: ComponentKind;
  label?: string;
  count: number;
  down: number;
  sim?: NodeSim;
  verdict?: Verdict;
  /** Just added in a guided step / newly dropped. */
  fresh?: boolean;
  /** Dimmed (e.g. not yet revealed). */
  ghost?: boolean;
  /** Replaces the verdict badge text (e.g. "flagged: SPOF" in design reviews). */
  badge?: string;
}

export type SdFlowNode = Node<SdNodeData, 'sd'>;

const STATUS_RING: Record<string, string> = {
  overloaded: 'ring-2 ring-bad shadow-[0_0_0_6px_rgb(var(--c-bad)/0.15)]',
  hot: 'ring-2 ring-warn/70',
  stalled: 'ring-2 ring-bad/70',
  dead: 'ring-2 ring-faint/60',
};

const LOAD_TONE = (u: number) => (u >= 1 ? 'bg-bad' : u >= 0.75 ? 'bg-warn' : 'bg-ok');

const handleCls = '!h-2.5 !w-2.5 !rounded-full !border-2 !border-surface !bg-faint';
const hiddenHandle = '!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0 !pointer-events-none';

function SdNodeView({ data, selected }: NodeProps<SdFlowNode>) {
  const def = COMPONENTS[data.kind];
  const sim = data.sim;
  const alive = data.count - data.down;
  const dead = alive <= 0;
  const status = dead ? 'dead' : sim?.status;
  const util = sim ? Math.min(sim.util, 1.5) : 0;
  const role = def.flow.role;
  const isClient = role === 'source' || role === 'serve';
  const control = role === 'control';
  const wrong = data.verdict === 'wrong';

  return (
    <div
      className={cn(
        'group relative flex w-[132px] flex-col items-center rounded-xl border bg-surface/95 px-2 pb-2 pt-1.5 transition-shadow',
        wrong ? 'border-bad bg-bad/[0.06]' : data.verdict === 'extra' ? 'border-warn/60' : 'border-line',
        status && STATUS_RING[status],
        sim?.skewed && !dead && status !== 'overloaded' && 'ring-2 ring-warn',
        selected && 'outline outline-2 outline-offset-2 outline-accent',
        data.fresh && 'animate-pulse-soft shadow-[0_0_0_6px_rgb(var(--c-accent)/0.18)]',
        data.ghost && 'opacity-40',
        'shadow-paper',
      )}
    >
      <Handle type="target" position={Position.Left} id="t-l" className={handleCls} />
      <Handle type="target" position={Position.Top} id="t-t" className={hiddenHandle} />
      <Handle type="target" position={Position.Bottom} id="t-b" className={hiddenHandle} />
      <Handle type="source" position={Position.Right} id="s-r" className={cn(handleCls, '!bg-accent')} />
      <Handle type="source" position={Position.Bottom} id="s-b" className={hiddenHandle} />
      <Handle type="source" position={Position.Top} id="s-t" className={hiddenHandle} />

      {data.count > 1 && (
        <span
          className={cn(
            'absolute -right-2 -top-2 rounded-full border px-1.5 font-mono text-[10px] font-semibold',
            data.down ? 'border-bad/40 bg-bad text-paper' : 'border-line bg-ink text-paper',
          )}
        >
          {data.down ? `${alive}/${data.count}` : `×${data.count}`}
        </span>
      )}
      {wrong && (
        <span className="absolute -left-2 -top-2 whitespace-nowrap rounded-full bg-bad px-1.5 font-mono text-[10px] font-bold text-paper">{data.badge ?? '✗ wrong'}</span>
      )}
      {data.verdict === 'extra' && (
        <span className="absolute -left-2 -top-2 whitespace-nowrap rounded-full bg-warn px-1.5 font-mono text-[10px] font-bold text-paper">{data.badge ?? 'extra'}</span>
      )}
      {data.verdict === 'good' && data.badge && (
        <span className="absolute -left-2 -top-2 whitespace-nowrap rounded-full bg-ok px-1.5 font-mono text-[10px] font-bold text-paper">{data.badge}</span>
      )}

      <div className="relative">
        <IsoGlyph kind={data.kind} size={60} dim={dead} />
        {dead && (
          <span className="absolute inset-0 grid place-items-center">
            <Skull size={22} className="text-bad drop-shadow" />
          </span>
        )}
      </div>
      <div className="mt-0.5 w-full truncate text-center font-mono text-[11px] font-semibold leading-tight text-ink">
        {data.label ?? def.name}
      </div>
      <div className="w-full truncate text-center font-mono text-[9.5px] leading-tight text-faint">{def.tech}</div>

      {sim && !isClient && !control && (
        <div className="mt-1 w-full">
          <div className="h-1 w-full overflow-hidden rounded-full bg-ink/10">
            <div
              className={cn('h-full rounded-full transition-all duration-500', LOAD_TONE(util))}
              style={{ width: `${Math.min(100, util * 100)}%` }}
            />
          </div>
          <div className="mt-0.5 flex justify-between font-mono text-[9px] text-muted">
            <span>{dead ? 'down' : status === 'idle' ? 'idle' : `${Math.round(util * 100)}%`}</span>
            {sim.lag > 0 ? (
              <span className="text-bad">lag ↑</span>
            ) : sim.skewed ? (
              <span className="text-warn">hot key</span>
            ) : sim.smallFiles === 'many' || sim.smallFiles === 'tiny' ? (
              <span className="text-warn">small files</span>
            ) : sim.queryQps > 0 ? (
              <span>{fmtNum(sim.queryQps)} q/s</span>
            ) : def.flow.mode === 'batch' ? (
              <span>batch</span>
            ) : null}
          </div>
        </div>
      )}
      {control && sim && <div className="mt-1 font-mono text-[9px] text-faint">control plane</div>}
      {sim && role === 'source' && sim.outEps > 0 && <div className="mt-1 font-mono text-[9px] text-muted">{fmtNum(sim.outEps)}/s</div>}
    </div>
  );
}

export const SdNode = memo(SdNodeView);
