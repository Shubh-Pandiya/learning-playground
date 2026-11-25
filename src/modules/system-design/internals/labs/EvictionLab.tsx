import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ScanLine } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { LabFrame, rng, Seg, Slider, Stat, useTicker } from './kit';

type Policy = 'lru' | 'lfu' | 'fifo' | 'random' | 'approx';

interface Entry {
  key: string;
  inserted: number;
  last: number;
  freq: number;
}
interface Req {
  id: number;
  key: string;
  hit: boolean;
}
interface Flash {
  id: number;
  hit: boolean;
}
interface Gone {
  id: number;
  key: string;
  slot: number;
}

const KEYS = 40;
const REQ_PER_TICK = 3;
const OFFERED = 1000; // req/s the simulated stream stands for
const SCAN_LEN = 30;

const POLICIES: { value: Policy; label: string; hint: string }[] = [
  { value: 'lru', label: 'LRU', hint: 'Evict the least recently used key' },
  { value: 'lfu', label: 'LFU', hint: 'Evict the least frequently used key (ties → LRU)' },
  { value: 'fifo', label: 'FIFO', hint: 'Evict the oldest inserted key' },
  { value: 'random', label: 'Random', hint: 'Evict a uniformly random key' },
  { value: 'approx', label: 'Redis approx-LRU', hint: 'Sample 5 random keys, evict the idlest' },
];

const INSIGHT: Record<Policy, string> = {
  lru: 'LRU evicts the key idle the longest — great when "recently used" predicts "used soon". Fire a scan burst: 30 one-off keys each become most-recent and flush the hot set, so the hit ratio craters until it refills. That is cache pollution.',
  lfu: 'LFU keeps the keys with the most hits, so a one-off scan cannot displace the hot set — each scan key has ×1 and is the next victim. The catch: yesterday’s popularity sticks forever, which is why Redis allkeys-lfu uses a logarithmic counter that decays (lfu-decay-time).',
  fifo: 'FIFO ignores access entirely: k0, the hottest key, is evicted on schedule and immediately fetched again from the DB. Cheap (just a queue, what many CDN edges do) but wasteful on skewed traffic.',
  random: 'Random keeps zero metadata yet lands close to LRU on skewed traffic: an unlucky hot key is re-fetched on its next request. Redis offers it as allkeys-random.',
  approx: 'Redis does not keep an exact LRU list (two pointers per key is too much memory). It samples maxmemory-samples=5 keys and evicts the idlest of them — almost LRU’s hit ratio for a 24-bit clock per key. Note it is also scan-polluted, like LRU.',
};

/** CRC16-XMODEM (poly 0x1021, init 0) — what Redis Cluster uses for key → hash slot. */
function crc16(s: string): number {
  let crc = 0;
  for (const b of new TextEncoder().encode(s)) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
/** Redis hash tags: only the part inside the first non-empty {…} is hashed. */
function hashTag(key: string): string {
  const a = key.indexOf('{');
  if (a >= 0) {
    const b = key.indexOf('}', a + 1);
    if (b > a + 1) return key.slice(a + 1, b);
  }
  return key;
}
const MASTERS = [
  { name: 'master A', lo: 0, hi: 5460 },
  { name: 'master B', lo: 5461, hi: 10922 },
  { name: 'master C', lo: 10923, hi: 16383 },
];

function init(cap: number) {
  return {
    slots: Array<Entry | null>(cap).fill(null),
    clock: 0,
    id: 0,
    scanSeq: 0,
    scan: [] as string[],
    window: [] as boolean[],
    evictions: 0,
    recent: [] as Req[],
    flash: {} as Record<number, Flash>,
    gone: [] as Gone[],
    fetched: [] as { id: number; slot: number }[],
    rand: rng(11),
  };
}

export default function EvictionLab() {
  const [policy, setPolicy] = useState<Policy>('lru');
  const [cap, setCap] = useState(8);
  const [skew, setSkew] = useState(1.1);
  const [running, setRunning] = useState(true);
  const [slotKey, setSlotKey] = useState('{user:42}:cart');
  const [, force] = useState(0);
  const s = useRef(init(cap));

  const cdf = useMemo(() => {
    const w = Array.from({ length: KEYS }, (_, i) => 1 / Math.pow(i + 1, skew));
    const total = w.reduce((a, b) => a + b, 0);
    let acc = 0;
    return w.map((x) => (acc += x / total));
  }, [skew]);
  const topShare = cdf[Math.min(cap, KEYS) - 1];

  const reset = (c = cap) => {
    s.current = init(c);
    force((x) => x + 1);
  };
  const resetStats = () => {
    const st = s.current;
    st.window = [];
    st.evictions = 0;
  };

  const victim = (slots: Entry[], rand: () => number): number => {
    const argmin = (idx: number[], score: (e: Entry) => number) => idx.reduce((a, b) => (score(slots[b]) < score(slots[a]) ? b : a));
    const all = slots.map((_, i) => i);
    switch (policy) {
      case 'lru':
        return argmin(all, (e) => e.last);
      case 'lfu':
        return argmin(all, (e) => e.freq * 1e6 + e.last);
      case 'fifo':
        return argmin(all, (e) => e.inserted);
      case 'random':
        return Math.floor(rand() * slots.length);
      case 'approx': {
        const sample = Array.from({ length: 5 }, () => Math.floor(rand() * slots.length));
        return argmin(sample, (e) => e.last);
      }
    }
  };

  useTicker(running, 280, () => {
    const st = s.current;
    st.gone = st.gone.slice(-6);
    st.fetched = [];
    for (let r = 0; r < REQ_PER_TICK; r++) {
      let key: string;
      // the scan (think: a nightly batch job / full table read) interleaves 2:1 with live user traffic
      if (st.scan.length && r < 2) key = st.scan.shift()!;
      else {
        const u = st.rand();
        key = `k${cdf.findIndex((c) => u <= c)}`;
      }
      const clock = ++st.clock;
      const id = st.id++;
      const idx = st.slots.findIndex((e) => e?.key === key);
      if (idx >= 0) {
        const e = st.slots[idx]!;
        e.last = clock;
        e.freq++;
        st.flash[idx] = { id, hit: true };
      } else {
        let slot = st.slots.findIndex((e) => !e);
        if (slot < 0) {
          slot = victim(st.slots as Entry[], st.rand);
          st.gone.push({ id, key: st.slots[slot]!.key, slot });
          st.evictions++;
        }
        st.slots[slot] = { key, inserted: clock, last: clock, freq: 1 };
        st.flash[slot] = { id, hit: false };
        st.fetched.push({ id, slot });
      }
      st.window.push(idx >= 0);
      st.recent.push({ id, key, hit: idx >= 0 });
    }
    st.window = st.window.slice(-200);
    st.recent = st.recent.slice(-18);
    force((x) => x + 1);
  });

  const st = s.current;
  const hits = st.window.filter(Boolean).length;
  const hitRatio = st.window.length ? hits / st.window.length : 0;
  const last30 = st.window.slice(-30);
  const hitRatio30 = last30.length ? last30.filter(Boolean).length / last30.length : 0;
  const hotCached = st.slots.filter((e) => e && e.key.startsWith('k') && Number(e.key.slice(1)) < cap).length;
  const used = st.slots.filter(Boolean).length;
  const full = used === cap;
  const deterministic = policy === 'lru' || policy === 'lfu' || policy === 'fifo';
  const next = full && deterministic ? victim(st.slots as Entry[], () => 0) : -1;
  const maxFreq = Math.max(1, ...st.slots.map((e) => e?.freq ?? 0));

  const W = 560;
  const H = 225;
  const gap = 4;
  const sw = Math.min(60, (520 - (cap - 1) * gap) / cap);
  const x0 = (W - (cap * sw + (cap - 1) * gap)) / 2;
  const sx = (i: number) => x0 + i * (sw + gap);
  const sy = 78;
  const sh = 60;
  const db = { x: W / 2 - 50, y: 182, w: 100, h: 32 };

  const tagged = hashTag(slotKey);
  const slot = crc16(tagged) % 16384;
  const owner = MASTERS.findIndex((m) => slot >= m.lo && slot <= m.hi);

  return (
    <LabFrame
      title="Cache eviction: LRU vs LFU vs FIFO vs Random"
      goal="Requests follow a Zipf curve (k0 hottest). Pick a policy, shrink the cache, then fire a scan burst and watch which policy keeps its hot set."
      running={running}
      onToggle={() => setRunning((r) => !r)}
      onReset={() => reset()}
      controls={
        <>
          <div className="sm:col-span-2">
            <Seg
              label="Eviction policy (maxmemory-policy)"
              value={policy}
              options={POLICIES}
              onChange={(v) => {
                setPolicy(v);
                resetStats();
              }}
            />
          </div>
          <Slider
            label="Capacity"
            value={cap}
            min={4}
            max={16}
            onChange={(v) => {
              setCap(v);
              reset(v);
            }}
            fmt={(v) => `${v} slots`}
          />
          <Slider label="Popularity skew (Zipf s)" value={skew} min={0.4} max={1.8} step={0.1} onChange={setSkew} fmt={(v) => `${v.toFixed(1)} ${v < 0.8 ? '(flat)' : v > 1.3 ? '(very hot head)' : ''}`} />
          <div className="flex items-end sm:col-span-2">
            <Button
              size="xs"
              variant={st.scan.length ? 'danger' : 'secondary'}
              icon={<ScanLine size={12} />}
              disabled={st.scan.length > 0}
              onClick={() => {
                st.scan = Array.from({ length: SCAN_LEN }, () => `s${st.scanSeq++}`);
                if (!running) setRunning(true);
                force((x) => x + 1);
              }}
            >
              {st.scan.length ? `scanning… ${SCAN_LEN - st.scan.length}/${SCAN_LEN}` : `Scan burst: ${SCAN_LEN} one-off keys`}
            </Button>
          </div>
        </>
      }
      stats={
        <>
          <Stat label="Hit ratio (last 200)" value={`${(hitRatio * 100).toFixed(0)}%`} tone={hitRatio > 0.7 ? 'ok' : hitRatio > 0.45 ? 'warn' : 'bad'} sub={`last 30 req: ${(hitRatio30 * 100).toFixed(0)}%`} />
          <Stat label="DB load (misses)" value={`${Math.round((1 - hitRatio) * OFFERED)} req/s`} tone={hitRatio > 0.7 ? 'ok' : 'warn'} sub={`of ${OFFERED} req/s offered`} />
          <Stat label="Evictions" value={st.evictions} />
          <Stat label="Memory used" value={`${used}/${cap} KB`} tone={full ? 'warn' : undefined} sub={`hot set cached: ${hotCached}/${cap} (k0–k${cap - 1})`} />
        </>
      }
      insight={
        <>
          {INSIGHT[policy]} With skew {skew.toFixed(1)} the top {cap} keys draw {(topShare * 100).toFixed(0)}% of requests — roughly the best a cache this size can do (pinning exactly the hottest keys, which LFU approximates). {st.scan.length > 0 && <b className={policy === 'lfu' ? 'text-ok' : 'text-bad'}>{policy === 'lfu' ? 'Scan in progress: scan keys keep evicting each other; the hot set survives.' : 'Scan in progress: one-off keys are pushing hot keys out.'}</b>}
        </>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <text x={20} y={12} className="fill-faint font-mono text-[9px]">
          request stream → newest on the right (green = hit, red = miss)
        </text>
        {st.recent.map((r, i) => (
          <motion.g key={r.id} initial={{ opacity: 0, x: 20 + (i + 1) * 29.5 }} animate={{ opacity: 1, x: 20 + i * 29.5 }} transition={{ duration: 0.25 }}>
            <rect y={18} width={27} height={18} rx={4} fill={r.hit ? 'rgb(var(--c-ok) / 0.18)' : 'rgb(var(--c-bad) / 0.16)'} stroke={r.hit ? 'rgb(var(--c-ok))' : 'rgb(var(--c-bad))'} strokeWidth={1} />
            <text x={13.5} y={30.5} textAnchor="middle" className="fill-ink font-mono text-[9px]">
              {r.key}
            </text>
          </motion.g>
        ))}
        <text x={x0} y={sy - 8} className="fill-muted font-mono text-[10px]">
          cache · {cap} slots · {POLICIES.find((p) => p.value === policy)!.label}
        </text>
        {st.slots.map((e, i) => {
          const f = st.flash[i];
          const age = e ? st.clock - e.last : 0;
          const heat = !e ? 0 : policy === 'lfu' ? e.freq / maxFreq : policy === 'fifo' ? 1 - Math.min(1, (st.clock - e.inserted) / 60) : policy === 'random' ? 0 : 1 - Math.min(1, age / 40);
          return (
            <g key={i}>
              <rect x={sx(i)} y={sy} width={sw} height={sh} rx={6} fill="rgb(var(--c-surface))" stroke={i === next ? 'rgb(var(--c-bad))' : 'rgb(var(--c-line))'} strokeWidth={1.5} strokeDasharray={i === next ? '4 3' : undefined} />
              {f && <motion.rect key={f.id} x={sx(i)} y={sy} width={sw} height={sh} rx={6} fill={f.hit ? 'rgb(var(--c-ok))' : 'rgb(var(--c-bad))'} initial={{ opacity: 0.55 }} animate={{ opacity: 0 }} transition={{ duration: 0.6 }} />}
              {e && (
                <>
                  <text x={sx(i) + sw / 2} y={sy + 20} textAnchor="middle" className={cn('font-mono text-[10.5px] font-semibold', e.key.startsWith('s') ? 'fill-warn' : 'fill-ink')}>
                    {e.key}
                  </text>
                  <text x={sx(i) + sw / 2} y={sy + 33} textAnchor="middle" className={cn('font-mono text-[8.5px]', policy === 'lfu' ? 'fill-ink' : 'fill-faint')}>
                    ×{e.freq}
                  </text>
                  <text x={sx(i) + sw / 2} y={sy + 44} textAnchor="middle" className={cn('font-mono text-[8.5px]', policy === 'lru' || policy === 'approx' ? 'fill-ink' : 'fill-faint')}>
                    {age}↺
                  </text>
                  <rect x={sx(i) + 3} y={sy + sh - 8} width={(sw - 6) * heat} height={4} rx={2} fill="rgb(var(--c-accent))" opacity={0.8} />
                </>
              )}
              {i === next && (
                <text x={sx(i) + sw / 2} y={sy + sh + 11} textAnchor="middle" className="fill-bad font-mono text-[8.5px]">
                  next out
                </text>
              )}
            </g>
          );
        })}
        {st.fetched.map((p) => (
          <motion.circle key={p.id} r={4} fill="rgb(var(--c-bad))" initial={{ cx: W / 2, cy: db.y, opacity: 1 }} animate={{ cx: sx(p.slot) + sw / 2, cy: sy + sh, opacity: 0 }} transition={{ duration: 0.4, ease: 'easeOut' }} />
        ))}
        {st.gone.map((g) => (
          <motion.text key={g.id} textAnchor="middle" className="fill-bad font-mono text-[10px] font-semibold" initial={{ x: sx(g.slot) + sw / 2, y: sy + 20, opacity: 1 }} animate={{ x: W - 30, y: 170, opacity: 0 }} transition={{ duration: 1.1, ease: 'easeIn' }}>
            {g.key}
          </motion.text>
        ))}
        <rect x={db.x} y={db.y} width={db.w} height={db.h} rx={8} fill="rgb(var(--c-surface))" stroke="rgb(var(--c-info))" strokeWidth={1.5} />
        <text x={W / 2} y={db.y + 14} textAnchor="middle" className="fill-ink font-mono text-[11px] font-semibold">
          DB
        </text>
        <text x={W / 2} y={db.y + 26} textAnchor="middle" className="fill-faint font-mono text-[8.5px]">
          {Math.round((1 - hitRatio) * OFFERED)} req/s on miss
        </text>
        <text x={W - 20} y={db.y + 20} textAnchor="end" className="fill-faint font-mono text-[9px]">
          evicted ↗
        </text>
        <text x={20} y={db.y + 14} className="fill-faint font-mono text-[8.5px]">
          ×n = accesses (LFU)
        </text>
        <text x={20} y={db.y + 26} className="fill-faint font-mono text-[8.5px]">
          n↺ = idle reqs (LRU)
        </text>
      </svg>
      <div className="mx-1 mb-1 mt-2 rounded-lg border border-line bg-surface p-2.5">
        <div className="eyebrow mb-1">Redis Cluster: which shard owns a key?</div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={slotKey} onChange={(e) => setSlotKey(e.target.value)} className="w-44 rounded-md border border-line bg-paper px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-accent" spellCheck={false} />
          {['foo', 'user:42', '{user:42}:cart', '{user:42}:profile'].map((k) => (
            <Button key={k} size="xs" variant="ghost" onClick={() => setSlotKey(k)}>
              {k}
            </Button>
          ))}
        </div>
        <div className="mt-1.5 font-mono text-[11.5px] text-ink">
          CRC16({JSON.stringify(tagged)}) = 0x{crc16(tagged).toString(16).padStart(4, '0')} mod 16384 = <b className="text-accent">slot {slot}</b> → {MASTERS[owner].name}
        </div>
        <div className="mt-1.5 flex gap-1">
          {MASTERS.map((m, i) => (
            <div key={m.name} className={cn('flex-1 rounded-md border px-2 py-1 font-mono text-[10.5px]', i === owner ? 'border-accent bg-accent/10 text-ink' : 'border-line text-faint')} style={{ flexGrow: m.hi - m.lo + 1 }}>
              {m.name} <span className="text-faint">{m.lo}–{m.hi}</span>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[11.5px] text-muted">
          {tagged !== slotKey ? (
            <>Hash tag in use: only <code className="font-mono">{tagged}</code> is hashed, so every <code className="font-mono">{`{${tagged}}…`}</code> key lands in the same slot — multi-key commands (MGET, transactions, Lua) work across them.</>
          ) : (
            <>No hash tag: related keys scatter across masters and multi-key ops fail with CROSSSLOT. Wrap the shared part in braces, e.g. <code className="font-mono">{'{user:42}:cart'}</code>.</>
          )}
        </p>
      </div>
    </LabFrame>
  );
}
