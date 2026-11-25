import { motion } from 'framer-motion';
import { ArrowRight, Crown } from 'lucide-react';
import { cn } from '@/shared/cn';
import type { Viz } from '../data/internals';

const PART_COLORS = ['#e4572e', '#f3a712', '#29bf12', '#3a86ff', '#8338ec', '#ff006e', '#00b4d8', '#6a994e'];

function Note({ text }: { text?: string }) {
  return text ? <p className="mt-3 rounded-lg bg-sunken px-3 py-1.5 text-center text-[12px] text-muted">{text}</p> : null;
}

const pop = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } };

export function DiveViz({ viz }: { viz: Viz }) {
  switch (viz.kind) {
    case 'path':
      return (
        <div>
          {viz.title && (
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[12px] font-semibold text-muted">{viz.title}</span>
              {viz.copies !== undefined && <span className={cn('rounded-full px-2 py-0.5 font-mono text-[11px]', viz.copies > 2 ? 'bg-bad/10 text-bad' : 'bg-ok/10 text-ok')}>{viz.copies} copies</span>}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {viz.stages.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5">
                {i > 0 && <ArrowRight size={14} className={cn(s.skip ? 'text-faint/40' : 'text-faint')} />}
                <motion.div
                  {...pop}
                  transition={{ delay: i * 0.08 }}
                  className={cn(
                    'min-w-[88px] rounded-lg border px-2.5 py-2 text-center',
                    s.hot ? 'border-accent bg-accent/10' : 'border-line bg-surface',
                    s.skip && 'border-dashed opacity-40 line-through',
                  )}
                >
                  <div className="text-[12.5px] font-medium">{s.label}</div>
                  {s.sub && <div className="font-mono text-[10px] text-faint">{s.sub}</div>}
                </motion.div>
              </div>
            ))}
          </div>
          <Note text={viz.note} />
        </div>
      );

    case 'segments':
      return (
        <div>
          <div className="flex items-end gap-1.5">
            {viz.segments.map((s, i) => (
              <motion.div
                key={s.base}
                {...pop}
                transition={{ delay: i * 0.06 }}
                className={cn('flex-1 rounded-lg border p-2', s.deleted ? 'border-dashed border-bad/50 bg-bad/5 opacity-60' : s.active ? 'border-accent bg-accent/5' : 'border-line bg-surface', s.mark && 'ring-2 ring-violet/40')}
                style={{ flexGrow: Math.max(1, (s.next - s.base) / 2048) }}
              >
                <div className={cn('truncate font-mono text-[10.5px]', s.deleted && 'line-through')}>{String(s.base).padStart(20, '0')}.log</div>
                <div className="mt-1 flex h-3 overflow-hidden rounded-sm bg-ink/5">
                  {Array.from({ length: Math.min(24, Math.ceil((s.next - s.base) / 256)) }).map((_, k) => (
                    <div key={k} className={cn('flex-1 border-r border-surface', s.active ? 'bg-accent/50' : 'bg-ink/25')} />
                  ))}
                </div>
                <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
                  <span>{s.base}</span>
                  <span>{s.active ? 'active ✎' : s.deleted ? 'deleted' : 'closed'}</span>
                  <span>{s.next - 1}</span>
                </div>
              </motion.div>
            ))}
          </div>
          {viz.index && (
            <div className="mt-3 rounded-lg border border-violet/30 bg-violet/5 p-2">
              <div className="mb-1 font-mono text-[10.5px] text-violet">.index (sparse, mmap’d){viz.lookup !== undefined && ` · lookup offset ${viz.lookup}`}</div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-1">
                {viz.index.map((e) => (
                  <div key={e.off} className={cn('rounded border px-2 py-0.5 font-mono text-[11px]', e.hit ? 'border-violet bg-violet/20 font-semibold' : 'border-line bg-surface')}>
                    {e.off} → @{e.pos}
                  </div>
                ))}
              </div>
            </div>
          )}
          <Note text={viz.note} />
        </div>
      );

    case 'partitioner':
      return (
        <div>
          <div className="mb-2 font-mono text-[11px] text-muted">{viz.sticky ? 'sticky partitioner (null keys)' : `partition = murmur2(key) % ${viz.parts}`}</div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${viz.parts}, minmax(0,1fr))` }}>
            {Array.from({ length: viz.parts }).map((_, p) => {
              const ks = viz.keys.filter((k) => k.p === p);
              return (
                <div key={p} className="min-h-[96px] rounded-lg border border-line bg-surface p-1.5" style={{ borderTopColor: PART_COLORS[p % 8], borderTopWidth: 3 }}>
                  <div className="font-mono text-[10.5px] text-faint">p{p}</div>
                  <div className="mt-1 space-y-1">
                    {ks.map((k, i) => (
                      <motion.div key={i} {...pop} transition={{ delay: viz.keys.indexOf(k) * 0.12 }} className="truncate rounded px-1 py-0.5 text-center font-mono text-[10.5px] text-white" style={{ background: PART_COLORS[p % 8] }}>
                        {k.key}
                      </motion.div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <Note text={viz.note} />
        </div>
      );

    case 'replicas': {
      const max = Math.max(...viz.replicas.map((r) => r.leo), viz.hw) + 1;
      return (
        <div>
          <div className="space-y-2">
            {viz.replicas.map((r) => (
              <div key={r.name} className={cn('flex items-center gap-2', r.down && 'opacity-50')}>
                <div className="flex w-24 items-center gap-1 font-mono text-[12px]">
                  {r.leader && <Crown size={12} className="text-warn" />}
                  {r.name}
                  {r.down && <span className="text-bad">✕</span>}
                </div>
                <div className="relative flex flex-1 gap-0.5">
                  {Array.from({ length: max }).map((_, o) => (
                    <motion.div
                      key={o}
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: o < r.leo ? 1 : 0.25 }}
                      className={cn('h-6 flex-1 rounded-sm', o < r.leo ? (o < viz.hw ? 'bg-ok/70' : 'bg-warn/60') : 'bg-ink/5')}
                    />
                  ))}
                </div>
                <div className="w-28 text-right font-mono text-[10.5px] text-muted">
                  LEO {r.leo} · <span className={r.isr ? 'text-ok' : 'text-bad'}>{r.isr ? 'ISR' : 'out'}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-3 font-mono text-[11px] text-muted">
            <span>
              <b className="text-ink">HW = {viz.hw}</b> (consumers read below this)
            </span>
            <span className="flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-sm bg-ok/70" /> committed
            </span>
            <span className="flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-sm bg-warn/60" /> not yet replicated
            </span>
            {viz.clean !== undefined && <span className={viz.clean ? 'text-ok' : 'text-bad'}>{viz.clean ? 'clean election' : 'UNCLEAN election'}</span>}
          </div>
          <Note text={viz.note} />
        </div>
      );
    }

    case 'seq':
      return (
        <div>
          <div className="mb-2 font-mono text-[12px] text-muted">
            Broker state for <b className="text-ink">PID {viz.pid}</b>, epoch {viz.epoch}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {viz.batches.map((b, i) => (
              <motion.div
                key={i}
                {...pop}
                transition={{ delay: i * 0.12 }}
                className={cn(
                  'w-[88px] rounded-lg border px-2 py-1.5 text-center',
                  b.state === 'ok' && 'border-ok/50 bg-ok/10',
                  b.state === 'new' && 'border-accent bg-accent/10',
                  b.state === 'dup' && 'border-warn/60 bg-warn/10',
                  (b.state === 'gap' || b.state === 'fenced') && 'border-bad/60 bg-bad/10',
                )}
              >
                <div className="font-mono text-[12px] font-semibold">seq {b.seq}</div>
                <div className="font-mono text-[10px] text-muted">{{ ok: 'appended', new: 'new epoch', dup: 'duplicate → dropped', gap: 'OutOfOrder → retry', fenced: 'FENCED' }[b.state]}</div>
              </motion.div>
            ))}
          </div>
          <Note text={viz.note} />
        </div>
      );

    case 'txn':
      return (
        <div>
          <div className="mb-2 font-mono text-[12px] text-muted">
            Transaction coordinator: <b className="text-ink">{viz.coordinator}</b>
          </div>
          <div className="space-y-1.5">
            {viz.parts.map((p) => (
              <div key={p.name} className="flex items-center gap-2">
                <div className="w-36 truncate font-mono text-[11.5px]">{p.name}</div>
                <div className="flex flex-1 gap-1">
                  {p.recs.map((r, i) => (
                    <motion.div
                      key={i}
                      {...pop}
                      transition={{ delay: i * 0.08 }}
                      className={cn(
                        'rounded px-2 py-1 font-mono text-[11px]',
                        r.s === 'plain' && 'bg-ink/10',
                        r.s === 'open' && 'border border-dashed border-warn bg-warn/10',
                        r.s === 'commit' && 'bg-ok/20 text-ok',
                        r.s === 'abort' && 'bg-bad/15 text-bad line-through',
                        r.s === 'marker' && 'bg-violet text-white',
                      )}
                    >
                      {r.label}
                    </motion.div>
                  ))}
                  {!p.recs.length && <span className="text-[11px] text-faint">-</span>}
                </div>
                {p.lso !== undefined && <span className="font-mono text-[10.5px] text-faint">LSO {p.lso}</span>}
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-3 font-mono text-[10.5px] text-muted">
            <span>dashed = uncommitted (hidden from read_committed)</span>
            <span className="text-violet">C/A = control marker</span>
          </div>
          <Note text={viz.note} />
        </div>
      );

    case 'group':
      return (
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-[12px]">
            <span className={cn('rounded-full px-2 py-0.5', viz.phase.startsWith('Stable') ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn')}>{viz.phase}</span>
            <span className="text-muted">generation {viz.gen}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {viz.members.map((m) => (
              <motion.div
                key={m.name}
                layout
                className={cn(
                  'rounded-lg border p-2',
                  m.state === 'gone' ? 'border-dashed border-bad/50 opacity-50' : m.state === 'revoking' ? 'border-warn/60 bg-warn/5' : m.state === 'joining' ? 'border-accent bg-accent/5' : 'border-line bg-surface',
                )}
              >
                <div className="flex items-center gap-1 font-mono text-[12px] font-semibold">
                  {m.state === 'leader' && <Crown size={11} className="text-warn" />}
                  {m.name}
                  {m.state && m.state !== 'ok' && m.state !== 'leader' && <span className="ml-auto text-[10px] font-normal text-muted">{m.state}</span>}
                </div>
                <div className="mt-1.5 flex min-h-[22px] flex-wrap gap-1">
                  {m.parts.map((p) => (
                    <motion.span key={p} layoutId={`gp-${p}`} className="rounded px-1.5 py-0.5 font-mono text-[10.5px] text-white" style={{ background: PART_COLORS[Number(p.slice(1)) % 8] }}>
                      {p}
                    </motion.span>
                  ))}
                  {!m.parts.length && <span className="text-[10.5px] text-faint">no partitions</span>}
                </div>
              </motion.div>
            ))}
          </div>
          <Note text={viz.note} />
        </div>
      );

    case 'quorum':
      return (
        <div>
          <div className="mb-2 font-mono text-[12px] text-muted">{viz.mode === 'kraft' ? 'KRaft: controllers replicate the __cluster_metadata log via Raft' : 'ZooKeeper mode: one broker is the controller, metadata lives in ZK'}</div>
          <div className="flex flex-wrap gap-2">
            {viz.nodes.map((n) => {
              const ctrl = n.role === 'leader' || n.role === 'voter' || n.role === 'zk' || n.role === 'controller';
              return (
                <motion.div
                  key={n.name}
                  layout
                  className={cn(
                    'w-[92px] rounded-lg border p-2 text-center',
                    n.role === 'down' && 'border-dashed border-bad/50 opacity-50',
                    n.role === 'leader' && 'border-warn bg-warn/10',
                    n.role === 'controller' && 'border-warn bg-warn/10',
                    n.role === 'voter' && 'border-violet/50 bg-violet/5',
                    n.role === 'zk' && 'border-ok/50 bg-ok/5',
                    n.role === 'observer' && 'border-line bg-surface',
                  )}
                >
                  <div className="flex items-center justify-center gap-1 font-mono text-[12px] font-semibold">
                    {(n.role === 'leader' || n.role === 'controller') && <Crown size={11} className="text-warn" />}
                    {n.name}
                  </div>
                  <div className="text-[10px] text-muted">{n.role === 'observer' ? (viz.mode === 'kraft' ? 'broker (observer)' : 'broker') : n.role}</div>
                  {viz.mode === 'kraft' && <div className={cn('font-mono text-[10px]', ctrl ? 'text-violet' : 'text-faint')}>offset {n.off}</div>}
                </motion.div>
              );
            })}
          </div>
          <Note text={viz.note} />
        </div>
      );

    case 'compaction': {
      const Row = ({ recs, label }: { recs: { o: number; k: string; v: string | null }[]; label: string }) => (
        <div>
          <div className="mb-1 font-mono text-[10.5px] text-faint">{label}</div>
          <div className="flex flex-wrap gap-1">
            {recs.map((r) => (
              <motion.div key={r.o} layout {...pop} className={cn('w-[64px] rounded-lg border p-1 text-center', r.v === null ? 'border-bad/50 bg-bad/5' : 'border-line bg-surface')}>
                <div className="font-mono text-[9.5px] text-faint">@{r.o}</div>
                <div className="font-mono text-[12px] font-semibold" style={{ color: PART_COLORS['ABCDEFG'.indexOf(r.k) % 8] }}>
                  {r.k}
                </div>
                <div className="font-mono text-[10.5px] text-muted">{r.v === null ? 'tombstone' : `v${r.v}`}</div>
              </motion.div>
            ))}
          </div>
        </div>
      );
      return (
        <div className="space-y-3">
          <Row recs={viz.before} label={viz.after ? 'dirty segment (before)' : 'log'} />
          {viz.after && <Row recs={viz.after} label="after the cleaner runs: latest value per key, offsets preserved" />}
          <Note text={viz.note} />
        </div>
      );
    }
  }
}
