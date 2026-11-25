import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Flame, Minus, Plus } from 'lucide-react';
import { Button } from '@/shared/ui';
import { hash32, LabFrame, Seg, Slider, Stat, useTicker } from './kit';

type Mode = 'mod' | 'ring';

const COLORS = ['accent', 'info', 'ok', 'violet', 'warn', 'bad', 'muted', 'ink'].map((c) => `rgb(var(--c-${c}))`);
const TWO32 = 4294967296;
/** murmur3 finalizer on top of FNV-1a: FNV alone barely changes the high bits for "user:1" vs "user:2", which would cluster keys on the ring. */
const H = (s: string) => {
  let h = hash32(s);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
};
const KEYS = Array.from({ length: 60 }, (_, i) => H(`user:${i}`));
const SAMPLE = Array.from({ length: 2000 }, (_, i) => H(`sample:${i}`));
const HOT = 7;
const HOT_SHARE = 0.3;

interface Point {
  pos: number;
  node: number;
}
function buildRing(n: number, v: number): Point[] {
  const pts: Point[] = [];
  for (let node = 0; node < n; node++) for (let j = 0; j < v; j++) pts.push({ pos: H(`node-${node}#vn${j}`), node });
  return pts.sort((a, b) => a.pos - b.pos);
}
/** First vnode clockwise from the key's hash (binary search), wrapping to the start. */
function ringOwner(h: number, ring: Point[]): number {
  let lo = 0;
  let hi = ring.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ring[mid].pos < h) lo = mid + 1;
    else hi = mid;
  }
  return ring[lo % ring.length].node;
}
function ownersFor(hs: number[], mode: Mode, n: number, v: number): number[] {
  if (mode === 'mod') return hs.map((h) => h % n);
  const ring = buildRing(n, v);
  return hs.map((h) => ringOwner(h, ring));
}

interface Change {
  from: number;
  to: number;
  moved: number[];
}

export default function RingLab() {
  const [mode, setMode] = useState<Mode>('mod');
  const [n, setN] = useState(4);
  const [vnodes, setVnodes] = useState(1);
  const [hot, setHot] = useState(false);
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<Change | null>(null);
  const [cum, setCum] = useState({ moved: 0, events: 0 });

  const v = mode === 'ring' ? vnodes : 1;
  const ring = useMemo(() => buildRing(n, v), [n, v]);
  const owners = useMemo(() => ownersFor(KEYS, mode, n, v), [mode, n, v]);
  const sampleOwners = useMemo(() => ownersFor(SAMPLE, mode, n, v), [mode, n, v]);

  const resize = (to: number) => {
    if (to < 2 || to > 8) return;
    const next = ownersFor(KEYS, mode, to, v);
    const moved = KEYS.map((_, i) => i).filter((i) => next[i] !== owners[i]);
    setLast({ from: n, to, moved });
    setCum((c) => ({ moved: c.moved + moved.length, events: c.events + 1 }));
    setN(to);
  };
  const resetAll = () => {
    setN(4);
    setLast(null);
    setCum({ moved: 0, events: 0 });
    setRunning(false);
  };

  // autoscaling churn: grow to 6 nodes, shrink back to 3, repeat
  const [dir, setDir] = useState(1);
  useTicker(running, 1600, () => {
    const d = n >= 6 ? -1 : n <= 3 ? 1 : dir;
    setDir(d);
    resize(n + d);
  });

  const share = Array.from({ length: n }, (_, i) => sampleOwners.filter((o) => o === i).length / SAMPLE.length);
  const traffic = hot ? share.map((s, i) => s * (1 - HOT_SHARE) + (owners[HOT] === i ? HOT_SHARE : 0)) : share;
  const mean = 1 / n;
  const maxShare = Math.max(...traffic);
  const std = Math.sqrt(traffic.reduce((a, s) => a + (s - mean) ** 2, 0) / n) / mean;
  const movedSet = new Set(last?.moved ?? []);
  const theory = last ? (mode === 'mod' ? 1 - 1 / Math.max(last.from, last.to) : 1 / Math.max(last.from, last.to)) : 0;
  const movedPct = last ? last.moved.length / KEYS.length : 0;

  const W = 560;
  const HGT = 254;
  const cx = 150;
  const cy = 128;
  const R = 96;
  const at = (h: number, r: number) => {
    const a = (h / TWO32) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  // mod-N: dots laid out inside per-node buckets
  const bw = 280 / n;
  const cols = Math.max(2, Math.floor((bw - 8) / 11));
  const slotIdx: number[] = [];
  const perBucket = Array(n).fill(0) as number[];
  owners.forEach((o, i) => (slotIdx[i] = perBucket[o]++));
  const keyPos = (i: number) =>
    mode === 'ring' ? at(KEYS[i], R - 16) : { x: 10 + owners[i] * bw + 9 + (slotIdx[i] % cols) * 11, y: 62 + Math.floor(slotIdx[i] / cols) * 11 };

  const bx = 345;
  const barMax = 150;
  const scale = Math.max(maxShare, 1.6 / n);

  return (
    <LabFrame
      title="Consistent hashing vs hash mod N"
      goal="Add or remove a node and count how many of the 60 keys change owner. Then switch to the ring and raise vnodes to even out the load."
      running={running}
      onToggle={() => setRunning((r) => !r)}
      onReset={resetAll}
      controls={
        <>
          <Seg
            label="Placement"
            value={mode}
            options={[
              { value: 'mod', label: 'hash(key) mod N', hint: 'Bucket = hash % number of nodes' },
              { value: 'ring', label: 'consistent hash ring', hint: 'Owner = first node clockwise from hash(key)' },
            ]}
            onChange={(m) => {
              setMode(m);
              setLast(null);
              setCum({ moved: 0, events: 0 });
            }}
          />
          <div className="flex items-end gap-1.5">
            <Button size="xs" variant="secondary" icon={<Minus size={12} />} disabled={n <= 2} onClick={() => resize(n - 1)}>
              remove node
            </Button>
            <Button size="xs" variant="secondary" icon={<Plus size={12} />} disabled={n >= 8} onClick={() => resize(n + 1)}>
              add node
            </Button>
            <span className="pb-1 font-mono text-[11px] text-muted">N = {n}</span>
          </div>
          {mode === 'ring' ? (
            <Slider
              label="Virtual nodes per node"
              value={vnodes}
              min={1}
              max={64}
              onChange={(x) => {
                setVnodes(x);
                setLast(null);
              }}
              fmt={(x) => `${x} (${x * n} points on ring)`}
            />
          ) : (
            <div className="self-end font-mono text-[11px] text-faint">vnodes only apply to the ring</div>
          )}
          <div className="flex items-end">
            <Button size="xs" variant={hot ? 'danger' : 'ghost'} icon={<Flame size={12} />} onClick={() => setHot((h) => !h)}>
              {hot ? `hot key on: user:${HOT} = 30% of traffic` : 'make user:7 a hot key'}
            </Button>
          </div>
        </>
      }
      stats={
        <>
          <Stat label="Keys moved (last change)" value={last ? `${last.moved.length}/60 (${(movedPct * 100).toFixed(0)}%)` : '—'} tone={!last ? undefined : movedPct > 0.5 ? 'bad' : movedPct > 0.3 ? 'warn' : 'ok'} sub={last ? `N ${last.from}→${last.to} · theory ≈ ${(theory * 100).toFixed(0)}%` : 'add or remove a node'} />
          <Stat label="Max / mean load" value={`${(maxShare / mean).toFixed(2)}×`} tone={maxShare / mean > 1.6 ? 'bad' : maxShare / mean > 1.25 ? 'warn' : 'ok'} sub={`std dev ${(std * 100).toFixed(0)}% of mean`} />
          <Stat label="Cumulative moves" value={cum.moved} sub={`${cum.events} resize events`} />
          <Stat label="Lookup" value={mode === 'mod' ? 'O(1)' : `O(log ${n * v})`} sub={mode === 'mod' ? 'one modulo' : 'binary search on sorted ring'} />
        </>
      }
      insight={
        <>
          {mode === 'mod'
            ? 'mod N spreads keys perfectly evenly and needs no metadata, but N is inside the formula: going 4→5 nodes re-buckets ~80% of keys. For a cache cluster that is a near-total cold start (thundering herd on the DB); for a sharded database it means migrating most of the data.'
            : v <= 2
              ? 'With one point per node the arcs are wildly uneven — some node owns 2–3× its fair share. And when a node leaves, its entire arc falls onto a single neighbour, doubling that node’s load. Raise the vnodes slider.'
              : `With ${v} vnodes each node owns many small arcs: load evens out, and a departing node’s keys spread over all survivors. Adding a node only moves the ~1/N of keys on the arcs it takes over. This is Dynamo/Cassandra tokens and the ketama scheme in Memcached clients.`}{' '}
          {last && (
            <b className={movedPct > 0.5 ? 'text-bad' : 'text-ok'}>
              Last change moved {last.moved.length}/60 keys vs ≈{(theory * 100).toFixed(0)}% expected ({mode === 'mod' ? '1 − 1/N' : '1/N'}).
            </b>
          )}
          {hot && (
            <span className="text-warn">
              {' '}
              Hot key: node n{owners[HOT]} carries {(traffic[owners[HOT]] * 100).toFixed(0)}% of traffic no matter how good the hash is — one key lives on one node. Fix it by splitting the key (user:7#0..#k, scatter-gather), replicating reads, or caching it in front.
            </span>
          )}
        </>
      }
    >
      <svg viewBox={`0 0 ${W} ${HGT}`} className="w-full">
        {mode === 'ring' ? (
          <>
            <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgb(var(--c-line))" strokeWidth={6} />
            {ring.map((p, j) => {
              const prev = ring[(j - 1 + ring.length) % ring.length].pos;
              const a = at(prev, R);
              const b = at(p.pos, R);
              const span = (p.pos - prev + TWO32) % TWO32 || TWO32;
              const large = span > TWO32 / 2 ? 1 : 0;
              return <path key={`a${j}`} d={`M ${a.x} ${a.y} A ${R} ${R} 0 ${large} 1 ${b.x} ${b.y}`} fill="none" stroke={COLORS[p.node]} strokeOpacity={0.55} strokeWidth={6} />;
            })}
            {ring.map((p, j) => {
              const a = at(p.pos, R - 7);
              const b = at(p.pos, R + 7);
              const l = at(p.pos, R + 17);
              return (
                <g key={`t${j}`}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={COLORS[p.node]} strokeWidth={v > 16 ? 1 : 2} />
                  {v <= 2 && (
                    <text x={l.x} y={l.y + 3} textAnchor="middle" className="fill-ink font-mono text-[9px] font-semibold">
                      n{p.node}
                    </text>
                  )}
                </g>
              );
            })}
            <text x={cx} y={cy - 4} textAnchor="middle" className="fill-faint font-mono text-[9px]">
              0 … 2³²
            </text>
            <text x={cx} y={cy + 9} textAnchor="middle" className="fill-faint font-mono text-[9px]">
              clockwise →
            </text>
          </>
        ) : (
          Array.from({ length: n }, (_, i) => (
            <g key={i}>
              <rect x={10 + i * bw + 2} y={28} width={bw - 4} height={212} rx={6} fill="rgb(var(--c-surface))" stroke={COLORS[i]} strokeOpacity={0.6} />
              <text x={10 + i * bw + bw / 2} y={44} textAnchor="middle" className="fill-ink font-mono text-[10px] font-semibold">
                n{i}
              </text>
            </g>
          ))
        )}
        {mode === 'mod' && (
          <text x={10} y={16} className="fill-faint font-mono text-[9px]">
            node = hash(key) % {n}
          </text>
        )}
        {KEYS.map((_, i) => {
          const p = keyPos(i);
          const isHot = hot && i === HOT;
          return (
            <motion.g key={i} initial={false} animate={{ x: p.x, y: p.y }} transition={{ duration: 0.6, ease: 'easeInOut' }}>
              <circle r={isHot ? 5.5 : 3.6} fill={COLORS[owners[i]]} style={{ transition: 'fill 0.5s' }} stroke={isHot ? 'rgb(var(--c-bad))' : 'none'} strokeWidth={1.5} />
              {movedSet.has(i) && <motion.circle key={`${last?.from}-${last?.to}-${cum.events}`} r={6.5} fill="none" stroke="rgb(var(--c-ink))" strokeWidth={1.2} initial={{ scale: 2.4, opacity: 0 }} animate={{ scale: 1, opacity: 0.8 }} transition={{ duration: 0.5 }} />}
            </motion.g>
          );
        })}
        <text x={bx} y={16} className="fill-faint font-mono text-[9px]">
          {hot ? 'traffic share per node' : 'keyspace share per node (2,000 sampled keys)'}
        </text>
        {traffic.map((t, i) => {
          const y = 28 + i * 25;
          const w = (t / scale) * barMax;
          return (
            <g key={i}>
              <text x={bx} y={y + 12} className="fill-ink font-mono text-[10px] font-semibold">
                n{i}
              </text>
              <rect x={bx + 22} y={y + 2} width={barMax} height={13} rx={3} fill="rgb(var(--c-line) / 0.4)" />
              <motion.rect x={bx + 22} y={y + 2} height={13} rx={3} fill={COLORS[i]} initial={false} animate={{ width: w }} transition={{ duration: 0.5 }} />
              <text x={bx + 26 + barMax} y={y + 12} className="fill-muted font-mono text-[9.5px]">
                {(t * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}
        <line x1={bx + 22 + (mean / scale) * barMax} x2={bx + 22 + (mean / scale) * barMax} y1={24} y2={28 + n * 25} stroke="rgb(var(--c-ink))" strokeDasharray="3 3" strokeOpacity={0.6} />
        <text x={bx + 22 + (mean / scale) * barMax} y={36 + n * 25} textAnchor="middle" className="fill-faint font-mono text-[8.5px]">
          fair share {(mean * 100).toFixed(0)}%
        </text>
        {last && (
          <text x={bx} y={HGT - 4} className="fill-muted font-mono text-[9.5px]">
            ◯ = moved on {last.from}→{last.to}: {last.moved.length} keys
          </text>
        )}
      </svg>
    </LabFrame>
  );
}
