import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Flame, Skull, TriangleAlert } from 'lucide-react';
import { cn } from '@/shared/cn';
import { KINDS } from '../data/components';
import type { GroupStats, NodeView } from '../engine/model';
import { fmtN } from '../engine/model';
import { KEY_COLORS, type PartitionView } from '../engine/tick';
import type { KKind, NodeCfg } from '../types';
import { Glyph } from './Glyph';

export interface KNodeData extends Record<string, unknown> {
  kind: KKind;
  label: string;
  cfg: NodeCfg;
  view?: NodeView;
  parts?: PartitionView[];
  group?: GroupStats;
  issues: number;
  bad: boolean;
  fresh?: boolean;
  dim?: boolean;
}

export type KFlowNode = Node<KNodeData, 'k'>;

const RING: Record<string, string> = {
  overloaded: 'ring-2 ring-bad shadow-[0_0_0_6px_rgb(var(--c-bad)/0.14)]',
  blocked: 'ring-2 ring-bad',
  hot: 'ring-2 ring-warn/70',
  degraded: 'ring-2 ring-warn',
  wrong: 'ring-2 ring-bad/70',
  idle: '',
  ok: '',
};
const LOAD = (u: number) => (u >= 0.99 ? 'bg-bad' : u >= 0.75 ? 'bg-warn' : 'bg-ok');
const hcls = '!h-2.5 !w-2.5 !rounded-full !border-2 !border-surface !bg-faint';

function TopicLogs({ parts }: { parts: PartitionView[] }) {
  const shown = parts.slice(0, 6);
  return (
    <div className="mt-1.5 w-full space-y-[3px]">
      {shown.map((p) => {
        const committed = Object.values(p.committed)[0];
        return (
          <div key={p.p} className="flex items-center gap-1">
            <span className={cn('w-5 shrink-0 text-right font-mono text-[8.5px]', p.offline ? 'text-bad' : 'text-faint')}>p{p.p}</span>
            <div className={cn('relative flex h-[11px] flex-1 items-stretch gap-px overflow-hidden rounded-sm bg-ink/[0.05] px-px py-px', p.offline && 'bg-bad/15')}>
              {p.cells.slice(-12).map((c) => {
                const aboveHw = c.offset >= p.hw;
                return (
                  <span
                    key={c.offset}
                    title={`offset ${c.offset}`}
                    className={cn('h-full w-[9px] shrink-0 rounded-[1.5px] transition-all', aboveHw && 'opacity-35', c.poison && 'ring-1 ring-bad')}
                    style={{ background: c.poison ? 'rgb(var(--c-bad))' : c.key < 0 ? 'rgb(var(--c-faint))' : KEY_COLORS[c.key] }}
                  />
                );
              })}
              {committed !== undefined && p.cells.length > 0 && (
                <span
                  className="absolute bottom-0 top-0 w-[2px] bg-ink"
                  style={{ left: `${Math.max(0, Math.min(12, 12 - (p.leo - committed))) * 10 + 1}px` }}
                  title={`committed offset ${committed}`}
                />
              )}
            </div>
            {p.offline ? <TriangleAlert size={10} className="text-bad" /> : p.stuck ? <Skull size={10} className="text-bad" /> : p.hot ? <Flame size={10} className="text-warn" /> : <span className="w-[10px]" />}
          </div>
        );
      })}
      {parts.length > shown.length && <div className="text-center font-mono text-[8.5px] text-faint">+{parts.length - shown.length} more partitions</div>}
    </div>
  );
}

function Members({ g, n }: { g?: GroupStats; n: number }) {
  const count = Math.min(n, 24);
  return (
    <div className="mt-1.5 flex w-full flex-wrap justify-center gap-[3px]">
      {Array.from({ length: count }, (_, i) => {
        const parts = g?.assignment[i] ?? 0;
        const idle = parts === 0;
        const u = g ? Math.min(1.2, g.util) : 0;
        return (
          <span
            key={i}
            title={idle ? `member ${i + 1}: idle (no partition)` : `member ${i + 1}: ${parts} partition${parts > 1 ? 's' : ''}`}
            className={cn('grid h-[15px] min-w-[15px] place-items-center rounded-[3px] px-[2px] font-mono text-[8px] leading-none', idle ? 'border border-dashed border-faint/60 text-faint' : cn(LOAD(i === 0 ? Math.max(u, g?.hottestMemberUtil ?? 0) : u), 'text-paper'))}
          >
            {idle ? '·' : parts}
          </span>
        );
      })}
      {n > count && <span className="font-mono text-[8.5px] text-faint">+{n - count}</span>}
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <div className="mt-1 flex flex-wrap justify-center gap-0.5">
      {items.map((t) => (
        <span key={t} className="rounded bg-ink/[0.06] px-1 font-mono text-[8.5px] leading-[14px] text-muted">
          {t}
        </span>
      ))}
    </div>
  );
}

function KNodeImpl({ data, selected }: NodeProps<KFlowNode>) {
  const def = KINDS[data.kind];
  const v = data.view;
  const c = data.cfg;
  const isTopic = data.kind === 'topic';
  const isGroup = data.kind === 'group' || data.kind === 'streams';
  const producer = data.kind === 'service' || data.kind === 'cdc';
  const chips: string[] = [];
  if (producer) chips.push(`${fmtN(c.rate)}/s`, `key:${c.key}`, `acks=${c.acks}`, ...(c.idempotence ? ['idem'] : []), ...(c.lingerMs ? [`linger ${c.lingerMs}ms`] : []), ...(c.compression !== 'none' ? [c.compression] : []));
  if (isTopic) chips.push(`RF ${c.rf}`, `minISR ${c.minIsr}`, c.cleanup === 'compact' ? 'compact' : c.retentionH < 0 ? 'keep ∞' : `${c.retentionH}h`, ...(c.role !== 'main' ? [c.role] : []));
  if (isGroup) chips.push(`${c.procMs}ms/rec`, data.kind === 'streams' ? (c.eos ? 'EOS' : 'ALOS') : `commit:${c.commit}`, `${c.assignor}`, ...(c.onError !== 'crash' && data.kind === 'group' ? [c.onError] : []));
  if (data.kind === 'sink') chips.push(c.idempotentSink ? 'idempotent' : 'plain insert', `${fmtN(c.capacity)} w/s`);
  return (
    <div
      className={cn(
        'relative flex flex-col items-center rounded-xl border bg-surface/95 px-2 pb-2 pt-1.5 shadow-paper transition-shadow',
        isTopic ? 'w-[200px]' : 'w-[150px]',
        data.bad || def.category === 'trap' ? 'border-bad/60' : 'border-line',
        v && RING[v.status],
        selected && 'outline outline-2 outline-offset-2 outline-accent',
        data.fresh && 'animate-pulse-soft shadow-[0_0_0_6px_rgb(var(--c-accent)/0.18)]',
        data.dim && 'opacity-50',
      )}
    >
      <Handle type="target" position={Position.Left} id="t" className={hcls} />
      <Handle type="source" position={Position.Right} id="s" className={cn(hcls, '!bg-accent')} />
      {data.issues > 0 && (
        <span className={cn('absolute -right-2 -top-2 rounded-full px-1.5 font-mono text-[10px] font-bold text-paper', data.bad ? 'bg-bad' : 'bg-warn')}>
          {data.issues}!
        </span>
      )}
      {isGroup && c.consumers > 1 && <span className="absolute -left-2 -top-2 rounded-full bg-ink px-1.5 font-mono text-[10px] font-semibold text-paper">×{c.consumers}</span>}
      {isTopic && <span className="absolute -left-2 -top-2 rounded-full bg-violet px-1.5 font-mono text-[10px] font-semibold text-paper">{c.partitions}p</span>}
      <div className="flex w-full items-center gap-1.5">
        <Glyph kind={data.kind} size={26} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11px] font-semibold leading-tight text-ink">{data.label}</div>
          <div className="truncate font-mono text-[9px] leading-tight text-faint">{def.tech}</div>
        </div>
      </div>
      {chips.length > 0 && <Chips items={chips} />}
      {isTopic && data.parts && <TopicLogs parts={data.parts} />}
      {isGroup && <Members g={data.group} n={c.consumers} />}
      {v && v.line && (
        <div className="mt-1 w-full">
          {(isGroup || data.kind === 'sink' || producer) && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-ink/10">
              <div className={cn('h-full rounded-full transition-all duration-500', LOAD(v.util))} style={{ width: `${Math.min(100, v.util * 100)}%` }} />
            </div>
          )}
          <div className={cn('mt-0.5 truncate text-center font-mono text-[9.5px]', v.status === 'overloaded' || v.status === 'blocked' || v.status === 'wrong' ? 'text-bad' : v.status === 'hot' || v.status === 'degraded' ? 'text-warn' : 'text-muted')}>{v.line}</div>
          {v.sub && <div className="truncate text-center font-mono text-[9px] text-faint">{v.sub}</div>}
        </div>
      )}
    </div>
  );
}

export const KNodeView = memo(KNodeImpl);
