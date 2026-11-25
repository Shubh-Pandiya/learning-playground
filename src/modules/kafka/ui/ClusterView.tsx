import { useMemo } from 'react';
import { Crown, Flame, Skull, TriangleAlert } from 'lucide-react';
import { cn } from '@/shared/cn';
import { cfgOf } from '../engine/defaults';
import { label, type Model } from '../engine/model';
import { KEY_COLORS, partitionViews } from '../engine/tick';
import type { KGraph } from '../types';

const W = 16;

/** Partition × broker grid: where every replica lives, who leads, who is in sync, and how HW/LEO/committed offsets relate. */
export function ClusterView({ g, m, t, topicId, onTopic }: { g: KGraph; m: Model; t: number; topicId?: string; onTopic?: (id: string) => void }) {
  const topics = g.nodes.filter((n) => n.kind === 'topic');
  const tid = topicId && m.topics[topicId] ? topicId : topics[0]?.id;
  const node = topics.find((n) => n.id === tid);
  const parts = useMemo(() => (tid ? partitionViews(g, m, tid, t, W) : []), [g, m, tid, t]);
  if (!node) return <p className="p-3 text-[12px] text-muted">Add a topic to see its partitions, replicas and offsets.</p>;
  const c = cfgOf(node);
  const groups = Object.keys(parts[0]?.committed ?? {});
  const gName = (id: string) => { const n = g.nodes.find((x) => x.id === id); return n ? label(n) : id; };
  return (
    <div className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="eyebrow">Inside the cluster</div>
        <div className="flex gap-1">
          {topics.map((n) => (
            <button key={n.id} onClick={() => onTopic?.(n.id)} className={cn('rounded-md border px-1.5 py-0.5 font-mono text-[11px]', n.id === tid ? 'border-violet bg-violet/10 text-violet' : 'border-line text-muted hover:border-violet')}>
              {label(n)}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-[10.5px] text-faint">
          {c.partitions} partitions · RF {c.rf} · min.insync {c.minIsr} · {g.cluster.kraft ? 'KRaft' : 'ZooKeeper'}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-x-1 border-spacing-y-[3px] text-[11px]">
          <thead>
            <tr className="text-faint">
              <th className="text-left font-normal" />
              <th className="text-left font-normal">
                log (old → new){groups.length > 0 && <> · <span className="text-ink">┃</span> committed by {gName(groups[0])}</>} · faded = above high watermark (not yet readable)
              </th>
              {m.brokers.map((b) => (
                <th key={b.id} className={cn('px-1 text-center font-mono font-semibold', b.alive ? 'text-ink' : 'text-bad line-through')}>
                  b{b.id}
                  {b.controller && <Crown size={9} className="ml-0.5 inline text-violet" />}
                </th>
              ))}
              <th className="text-left font-normal">offsets</th>
            </tr>
          </thead>
          <tbody>
            {parts.slice(0, 12).map((p) => {
              const committed = groups.length ? p.committed[groups[0]] : undefined;
              return (
                <tr key={p.p}>
                  <td className={cn('pr-1 font-mono font-semibold', p.offline ? 'text-bad' : 'text-muted')}>
                    p{p.p}
                    {p.hot && <Flame size={10} className="ml-0.5 inline text-warn" />}
                    {p.stuck && <Skull size={10} className="ml-0.5 inline text-bad" />}
                    {p.offline && <TriangleAlert size={10} className="ml-0.5 inline text-bad" />}
                  </td>
                  <td>
                    <div className={cn('relative flex h-4 gap-px rounded bg-ink/[0.05] p-px', p.offline && 'bg-bad/15')}>
                      {p.cells.map((cell) => (
                        <span
                          key={cell.offset}
                          title={`offset ${cell.offset}${cell.offset >= p.hw ? ' (above HW)' : ''}`}
                          className={cn('h-full w-3 shrink-0 rounded-[2px] transition-all', cell.offset >= p.hw && 'opacity-30', cell.poison && 'ring-1 ring-bad')}
                          style={{ background: cell.poison ? 'rgb(var(--c-bad))' : cell.key < 0 ? 'rgb(var(--c-faint))' : KEY_COLORS[cell.key] }}
                        />
                      ))}
                      {committed !== undefined && p.cells.length > 0 && committed >= p.cells[0].offset && (
                        <span className="absolute -bottom-0.5 -top-0.5 w-[2px] rounded bg-ink" style={{ left: `${(committed - p.cells[0].offset) * 13 + 1}px` }} />
                      )}
                    </div>
                  </td>
                  {m.brokers.map((b) => {
                    const r = p.replicas.find((x) => x.broker === b.id);
                    if (!r) return <td key={b.id} className="text-center text-faint/40">·</td>;
                    return (
                      <td key={b.id} className="text-center">
                        <span
                          title={!r.alive ? 'replica on a dead broker' : r.leader ? 'leader: serves all reads and writes' : r.inIsr ? 'in-sync follower' : 'follower OUT of the ISR (lagging)'}
                          className={cn(
                            'inline-grid h-4 min-w-[22px] place-items-center rounded px-0.5 font-mono text-[9.5px] font-bold',
                            !r.alive ? 'bg-bad/15 text-bad line-through' : r.leader ? 'bg-accent text-paper' : r.inIsr ? 'bg-ok/20 text-ok' : 'border border-dashed border-warn text-warn',
                          )}
                        >
                          {r.leader ? 'L' : 'F'}
                        </span>
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap font-mono text-[10px] text-faint">
                    LEO {p.leo} · HW {p.hw}
                    {committed !== undefined && <span className={cn(p.hw - committed > 3 && 'text-bad')}> · lag {Math.max(0, p.hw - committed)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {parts.length > 12 && <p className="font-mono text-[10px] text-faint">+{parts.length - 12} more partitions</p>}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] leading-snug text-muted">
        <span>
          <b className="text-ink">L</b> leader (all reads/writes) · <b className="text-ok">F</b> in-sync follower · <b className="text-warn">F</b> dashed: out of ISR
        </span>
        <span>
          <b className="text-ink">LEO</b> log-end offset (next write) · <b className="text-ink">HW</b> high watermark = min LEO across the ISR. Consumers only read below HW.
        </span>
        <span>Colour = key. Same key → same partition → ordered.</span>
      </div>
    </div>
  );
}
