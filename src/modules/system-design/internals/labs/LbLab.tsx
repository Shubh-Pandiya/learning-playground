import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { hash32, LabFrame, pct, rng, Seg, Slider, Stat, useTicker } from './kit';

type Algo = 'rr' | 'wrr' | 'random' | 'leastconn' | 'p2c' | 'hash';
type Hc = 0 | 5 | 25;

interface Req {
  id: number;
  client: number;
  left: number;
  age: number;
}
interface Backend {
  name: string;
  speed: number;
  weight: number;
  alive: boolean;
  ejected: boolean;
  deadFor: number;
  draining: boolean;
  restartIn: number;
  inflight: Req[];
  sent: number;
}
interface Packet {
  id: number;
  to: number;
  err: boolean;
}

const ALGOS: { value: Algo; label: string; hint: string }[] = [
  { value: 'rr', label: 'Round-robin', hint: 'Next backend in order' },
  { value: 'wrr', label: 'Weighted RR', hint: 'In order, proportional to static weights' },
  { value: 'random', label: 'Random', hint: 'Uniform random pick' },
  { value: 'leastconn', label: 'Least conns', hint: 'Fewest in-flight requests' },
  { value: 'p2c', label: 'P2C', hint: 'Sample two at random, take the less loaded' },
  { value: 'hash', label: 'Hash(client)', hint: 'Consistent-ish: same client → same backend' },
];

const TIMEOUT = 60; // ticks
const TICK_MS = 20; // simulated ms per tick, for display

const INSIGHT: Record<Algo, string> = {
  rr: 'Round-robin sends backend C the same share as the fast ones although C is 3× slower — watch its queue and the p99 grow while the others idle.',
  wrr: 'Weights fix the static speed difference, but weights are configured, not measured: they cannot react to a GC pause or a slow query.',
  random: 'Random is stateless and fine on average, but short-term clumps hit one host — and it still overloads the slow backend.',
  leastconn: 'Least-connections measures instead of guessing: the slow backend naturally gets fewer requests. Needs a global view of in-flight counts.',
  p2c: 'Power of two choices: two random samples are enough to avoid the worst host. Near least-conns balance without a global scan — and many LB instances do not herd onto the same "least loaded" host.',
  hash: 'Hashing pins each client to one backend (cache/session affinity). Kill a backend: only its clients move. But a heavy client becomes a hot spot you cannot rebalance.',
};

function initial(): Backend[] {
  return [
    { name: 'A', speed: 0.8, weight: 3 },
    { name: 'B', speed: 0.8, weight: 3 },
    { name: 'C', speed: 0.27, weight: 1 },
    { name: 'D', speed: 0.8, weight: 3 },
    { name: 'E', speed: 0.8, weight: 3 },
  ].map((b) => ({ ...b, alive: true, ejected: false, deadFor: 0, draining: false, restartIn: 0, inflight: [], sent: 0 }));
}

export default function LbLab() {
  const [algo, setAlgo] = useState<Algo>('rr');
  const [rate, setRate] = useState(2.4);
  const [hc, setHc] = useState<Hc>(5);
  const [drain, setDrain] = useState(true);
  const [running, setRunning] = useState(true);
  const [, force] = useState(0);

  const s = useRef({ bs: initial(), acc: 0, rr: 0, wrr: 0, id: 0, lat: [] as number[], ok: 0, err: 0, packets: [] as Packet[], rand: rng(7) });

  const reset = () => {
    s.current = { bs: initial(), acc: 0, rr: 0, wrr: 0, id: 0, lat: [], ok: 0, err: 0, packets: [], rand: rng(7) };
    force((x) => x + 1);
  };

  const pick = (eligible: number[], client: number): number => {
    const st = s.current;
    const bs = st.bs;
    switch (algo) {
      case 'rr':
        return eligible[st.rr++ % eligible.length];
      case 'wrr': {
        const ring = eligible.flatMap((i) => Array(bs[i].weight).fill(i) as number[]);
        return ring[st.wrr++ % ring.length];
      }
      case 'random':
        return eligible[Math.floor(st.rand() * eligible.length)];
      case 'leastconn':
        return eligible.reduce((a, b) => (bs[b].inflight.length < bs[a].inflight.length ? b : a));
      case 'p2c': {
        const a = eligible[Math.floor(st.rand() * eligible.length)];
        const b = eligible[Math.floor(st.rand() * eligible.length)];
        return bs[b].inflight.length < bs[a].inflight.length ? b : a;
      }
      case 'hash': {
        // rendezvous hashing: highest hash(client, backend) wins → minimal movement on membership change
        return eligible.reduce((a, b) => (hash32(`${client}:${bs[b].name}`) > hash32(`${client}:${bs[a].name}`) ? b : a));
      }
    }
  };

  useTicker(running, 100, () => {
    const st = s.current;
    const bs = st.bs;
    // health checks: a dead backend is ejected after `hc` ticks (0 = no health checks → never ejected)
    for (const b of bs) {
      if (!b.alive && !b.ejected) {
        b.deadFor++;
        if (hc > 0 && b.deadFor >= hc) b.ejected = true;
      }
      if (b.restartIn > 0 && --b.restartIn === 0) {
        b.alive = true;
        b.ejected = false;
        b.draining = false;
        b.deadFor = 0;
      }
    }
    // arrivals
    st.acc += rate;
    const newPackets: Packet[] = [];
    while (st.acc >= 1) {
      st.acc -= 1;
      const eligible = bs.map((_, i) => i).filter((i) => !bs[i].ejected && !bs[i].draining && bs[i].restartIn === 0);
      const client = Math.floor(st.rand() * 40);
      if (!eligible.length) {
        st.err++;
        continue;
      }
      const i = pick(eligible, client);
      const b = bs[i];
      b.sent++;
      const id = st.id++;
      if (!b.alive) {
        st.err++; // connection refused until the health checker notices
        newPackets.push({ id, to: i, err: true });
      } else {
        b.inflight.push({ id, client, left: 1, age: 0 });
        newPackets.push({ id, to: i, err: false });
      }
    }
    // processor sharing: each backend splits its speed across in-flight requests
    for (const b of bs) {
      if (!b.alive) continue;
      const share = b.inflight.length ? b.speed / b.inflight.length : 0;
      const keep: Req[] = [];
      for (const r of b.inflight) {
        r.left -= share;
        r.age++;
        if (r.left <= 0) {
          st.ok++;
          st.lat.push(r.age);
        } else if (r.age >= TIMEOUT) st.err++;
        else keep.push(r);
      }
      b.inflight = keep;
      if (b.draining && !b.inflight.length && b.restartIn === 0) {
        b.alive = false;
        b.restartIn = 15;
      }
    }
    if (st.lat.length > 400) st.lat = st.lat.slice(-400);
    st.packets = [...st.packets, ...newPackets].slice(-24);
    force((x) => x + 1);
  });

  const st = s.current;
  const bs = st.bs;
  const total = st.ok + st.err;
  const p50 = pct(st.lat, 0.5) * TICK_MS;
  const p99 = pct(st.lat, 0.99) * TICK_MS;
  const errRate = total ? st.err / total : 0;
  const cap = bs.reduce((a, b) => a + (b.alive && !b.draining ? b.speed : 0), 0);
  const sentTotal = bs.reduce((a, b) => a + b.sent, 0) || 1;

  const kill = (i: number) => {
    const b = bs[i];
    if (!b.alive) return;
    st.err += b.inflight.length;
    b.inflight = [];
    b.alive = false;
    b.deadFor = 0;
    b.restartIn = 0;
    force((x) => x + 1);
  };
  const deploy = (i: number) => {
    const b = bs[i];
    if (!b.alive || b.draining) return;
    if (drain) b.draining = true;
    else {
      st.err += b.inflight.length;
      b.inflight = [];
      b.alive = false;
      b.ejected = true;
      b.restartIn = 15;
    }
    force((x) => x + 1);
  };
  const revive = (i: number) => {
    const b = bs[i];
    Object.assign(b, { alive: true, ejected: false, deadFor: 0, draining: false, restartIn: 0 });
    force((x) => x + 1);
  };

  const W = 560;
  const H = 250;
  const lbX = 90;
  const lbY = H / 2;
  const by = (i: number) => 25 + i * 50;
  const bx = 330;

  return (
    <LabFrame
      title="Balancing algorithms, health checks & draining"
      goal="Backend C is 3× slower. Switch algorithms and watch who gets overloaded. Then kill a backend with and without health checks, and deploy with and without draining."
      running={running}
      onToggle={() => setRunning((r) => !r)}
      onReset={reset}
      controls={
        <>
          <div className="sm:col-span-2">
            <Seg label="Algorithm" value={algo} options={ALGOS} onChange={setAlgo} />
          </div>
          <Slider label="Offered load" value={rate} min={0.5} max={4} step={0.1} onChange={setRate} fmt={(v) => `${(v * 10).toFixed(0)} req/s (cap ${(cap * 10).toFixed(0)})`} />
          <div className="space-y-2">
            <Seg
              label="Health check: eject after"
              value={hc}
              options={[
                { value: 0, label: 'off' },
                { value: 5, label: '0.5 s' },
                { value: 25, label: '2.5 s' },
              ]}
              onChange={(v) => setHc(v)}
            />
            <Seg
              label="On deploy"
              value={drain ? 'drain' : 'hard'}
              options={[
                { value: 'drain', label: 'drain connections' },
                { value: 'hard', label: 'hard restart' },
              ]}
              onChange={(v) => setDrain(v === 'drain')}
            />
          </div>
        </>
      }
      stats={
        <>
          <Stat label="p50 latency" value={`${Math.round(p50)} ms`} />
          <Stat label="p99 latency" value={`${Math.round(p99)} ms`} tone={p99 > 600 ? 'bad' : p99 > 250 ? 'warn' : 'ok'} />
          <Stat label="Errors" value={`${(errRate * 100).toFixed(1)}%`} tone={errRate > 0.02 ? 'bad' : errRate > 0 ? 'warn' : 'ok'} sub={`${st.err} failed / ${total}`} />
          <Stat label="Served" value={st.ok} />
        </>
      }
      insight={
        <>
          {INSIGHT[algo]}
          {bs.some((b) => !b.alive && !b.ejected && b.restartIn === 0) && (
            <b className="text-bad"> {hc === 0 ? 'No health checks: the dead backend keeps receiving its share — every one of those requests fails.' : 'Dead backend still in the pool until the health check ejects it — requests sent there fail meanwhile.'}</b>
          )}
        </>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* edges */}
        {bs.map((b, i) => (
          <line key={b.name} x1={lbX + 40} y1={lbY} x2={bx} y2={by(i) + 18} stroke="rgb(var(--c-line))" strokeWidth={1.5} strokeDasharray={b.ejected || b.draining ? '4 4' : undefined} />
        ))}
        {/* packets */}
        {st.packets.map((p) => (
          <motion.circle
            key={p.id}
            r={4}
            fill={p.err ? 'rgb(var(--c-bad))' : 'rgb(var(--c-accent))'}
            initial={{ cx: lbX + 40, cy: lbY, opacity: 1 }}
            animate={{ cx: bx - 6, cy: by(p.to) + 18, opacity: p.err ? 0.2 : 0.9 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
          />
        ))}
        {/* LB */}
        <rect x={lbX - 40} y={lbY - 30} width={80} height={60} rx={10} fill="rgb(var(--c-surface))" stroke="rgb(var(--c-accent))" strokeWidth={1.5} />
        <text x={lbX} y={lbY - 4} textAnchor="middle" className="fill-ink font-mono text-[12px] font-semibold">
          LB
        </text>
        <text x={lbX} y={lbY + 12} textAnchor="middle" className="fill-faint font-mono text-[9px]">
          {ALGOS.find((a) => a.value === algo)!.label}
        </text>
        <text x={14} y={lbY + 4} className="fill-faint font-mono text-[9px]">
          clients →
        </text>
        {/* backends */}
        {bs.map((b, i) => {
          const load = Math.min(1, b.inflight.length / 30);
          const state = b.restartIn > 0 ? 'restarting' : b.draining ? 'draining' : !b.alive ? (b.ejected ? 'ejected' : 'dead · in pool') : 'up';
          const stroke = !b.alive && !b.ejected ? 'rgb(var(--c-bad))' : b.draining || b.restartIn ? 'rgb(var(--c-warn))' : b.ejected ? 'rgb(var(--c-faint))' : 'rgb(var(--c-line))';
          return (
            <g key={b.name}>
              <rect x={bx} y={by(i)} width={140} height={36} rx={7} fill="rgb(var(--c-surface))" stroke={stroke} strokeWidth={1.5} opacity={b.alive || !b.ejected ? 1 : 0.5} />
              <rect x={bx + 2} y={by(i) + 28} width={136 * load} height={6} rx={2} fill={load > 0.6 ? 'rgb(var(--c-bad))' : load > 0.3 ? 'rgb(var(--c-warn))' : 'rgb(var(--c-ok))'} />
              <text x={bx + 8} y={by(i) + 15} className="fill-ink font-mono text-[11px] font-semibold">
                {b.name}
                <tspan className="fill-faint text-[9px] font-normal"> {b.speed < 0.5 ? 'slow (3×)' : 'fast'}</tspan>
              </text>
              <text x={bx + 132} y={by(i) + 15} textAnchor="end" className="fill-muted font-mono text-[9.5px]">
                {b.inflight.length} in-flight
              </text>
              <text x={bx + 150} y={by(i) + 15} className={cn('font-mono text-[9.5px]', state === 'up' ? 'fill-ok' : state.startsWith('dead') ? 'fill-bad' : 'fill-warn')}>
                {state}
              </text>
              <text x={bx + 150} y={by(i) + 28} className="fill-faint font-mono text-[9px]">
                share {((b.sent / sentTotal) * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1 pb-1">
        {bs.map((b, i) => (
          <div key={b.name} className="flex items-center gap-0.5 rounded-md border border-line bg-surface px-1 py-0.5">
            <span className="px-1 font-mono text-[11px] font-semibold">{b.name}</span>
            <Button size="xs" variant="ghost" onClick={() => kill(i)} disabled={!b.alive}>
              kill
            </Button>
            <Button size="xs" variant="ghost" onClick={() => deploy(i)} disabled={!b.alive || b.draining}>
              deploy
            </Button>
            <Button size="xs" variant="ghost" onClick={() => revive(i)} disabled={b.alive && !b.draining}>
              up
            </Button>
          </div>
        ))}
      </div>
    </LabFrame>
  );
}
