import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { LabFrame, rng, Seg, Slider, Stat, useTicker } from './kit';

type Algo = 'token' | 'leaky' | 'fixed' | 'log' | 'swc';
type Pattern = 'steady' | 'bursty' | 'boundary';
type Deploy = 'single' | 'local' | 'redis';

interface Req {
  id: number;
  t: number;
  node: number;
  status: 'ok' | 'queued' | 'rej';
  fwd?: number;
}
interface Lim {
  tokens: number;
  last: number;
  queue: Req[];
  nextDrain: number;
  win: number;
  count: number;
  prev: number;
  log: number[];
}

const DT = 50; // ms of simulated time per tick (= real time)
const SPAN = 3000; // visible timeline
const PERIOD = 2000; // bursty / boundary pattern period

const ALGOS: { value: Algo; label: string; hint: string }[] = [
  { value: 'token', label: 'Token bucket', hint: 'Tokens refill at the rate; each request spends one' },
  { value: 'leaky', label: 'Leaky bucket', hint: 'Queue drained at a constant rate' },
  { value: 'fixed', label: 'Fixed window', hint: 'One counter per calendar second' },
  { value: 'log', label: 'Sliding log', hint: 'Timestamp of every allowed request in the last second' },
  { value: 'swc', label: 'Sliding counter', hint: 'prev × overlap + current' },
];

const newLim = (burst: number): Lim => ({ tokens: burst, last: 0, queue: [], nextDrain: 0, win: 0, count: 0, prev: 0, log: [] });
const init = (burst: number) => ({ now: 0, since: 0, id: 0, rr: 0, reqs: [] as Req[], lims: [newLim(burst), newLim(burst), newLim(burst)], nextAt: 0, nextPeriod: 0, sched: [] as number[], rand: rng(5) });

export default function RateLimitLab() {
  const [algo, setAlgo] = useState<Algo>('fixed');
  const [pattern, setPattern] = useState<Pattern>('boundary');
  const [deploy, setDeploy] = useState<Deploy>('single');
  const [limit, setLimit] = useState(10);
  const [burst, setBurst] = useState(10);
  const [load, setLoad] = useState(2);
  const [running, setRunning] = useState(true);
  const [, force] = useState(0);
  const s = useRef(init(burst));

  const reset = () => {
    s.current = init(burst);
    force((x) => x + 1);
  };
  const resetLimiters = () => {
    const st = s.current;
    st.lims = [newLim(burst), newLim(burst), newLim(burst)];
    st.reqs = [];
    st.since = st.now;
    st.sched = [];
    st.nextAt = st.now;
    st.nextPeriod = Math.ceil(st.now / PERIOD) * PERIOD;
  };

  const drain = (l: Lim, t: number) => {
    while (l.queue.length && l.nextDrain <= t) {
      const r = l.queue.shift()!;
      r.status = 'ok';
      r.fwd = l.nextDrain;
      l.nextDrain += 1000 / limit;
    }
  };

  const decide = (l: Lim, r: Req) => {
    const t = r.t;
    switch (algo) {
      case 'token': {
        l.tokens = Math.min(burst, l.tokens + ((t - l.last) * limit) / 1000);
        l.last = t;
        if (l.tokens >= 1) {
          l.tokens -= 1;
          return true;
        }
        return false;
      }
      case 'leaky': {
        if (l.queue.length >= burst) return false;
        if (!l.queue.length) l.nextDrain = Math.max(l.nextDrain, t);
        r.status = 'queued';
        l.queue.push(r);
        drain(l, t);
        return null;
      }
      case 'fixed': {
        const w = Math.floor(t / 1000);
        if (w !== l.win) [l.win, l.count] = [w, 0];
        if (l.count < limit) return !!++l.count;
        return false;
      }
      case 'log': {
        while (l.log.length && l.log[0] <= t - 1000) l.log.shift();
        if (l.log.length < limit) return !!l.log.push(t);
        return false;
      }
      case 'swc': {
        const w = Math.floor(t / 1000);
        if (w !== l.win) [l.prev, l.count, l.win] = [w === l.win + 1 ? l.count : 0, 0, w];
        const est = l.prev * (1 - (t - w * 1000) / 1000) + l.count;
        if (est < limit) return !!++l.count;
        return false;
      }
    }
  };

  useTicker(running, DT, () => {
    const st = s.current;
    const to = st.now + DT;
    const times: number[] = [];
    if (pattern === 'steady') {
      const lambda = (load * limit) / 1000;
      while (st.nextAt < to) {
        times.push(st.nextAt);
        st.nextAt += -Math.log(1 - st.rand()) / lambda;
      }
    } else {
      while (st.nextPeriod < to) {
        const P = st.nextPeriod;
        if (pattern === 'bursty') {
          const n = Math.round(load * limit * (PERIOD / 1000));
          for (let i = 0; i < n; i++) st.sched.push(P + st.rand() * 300);
        } else for (let i = 0; i < 2 * limit; i++) st.sched.push(P + 900 + ((i + 0.5) * 200) / (2 * limit));
        st.nextPeriod += PERIOD;
      }
      st.sched.sort((a, b) => a - b);
      while (st.sched.length && st.sched[0] < to) times.push(st.sched.shift()!);
    }
    for (const t of times) {
      const node = deploy === 'single' ? 0 : st.rr++ % 3;
      const lim = st.lims[deploy === 'local' ? node : 0];
      drain(lim, t);
      const r: Req = { id: st.id++, t, node, status: 'rej' };
      const ok = decide(lim, r);
      if (ok) [r.status, r.fwd] = ['ok', t];
      st.reqs.push(r);
    }
    st.lims.forEach((l) => drain(l, to));
    st.now = to;
    st.reqs = st.reqs.filter((r) => r.t > to - 6000 || r.status === 'queued');
    force((x) => x + 1);
  });

  const st = s.current;
  const now = st.now;
  const recent = st.reqs.filter((r) => r.t > now - SPAN);
  const fwd = st.reqs.filter((r) => r.fwd !== undefined).map((r) => r.fwd!).sort((a, b) => a - b);
  const allowedPerS = fwd.filter((t) => t > now - SPAN).length / (Math.min(now - st.since, SPAN) / 1000 || 1);
  const rejPct = recent.length ? recent.filter((r) => r.status === 'rej').length / recent.length : 0;
  let maxIn1s = 0;
  let maxAt = 0;
  for (let i = 0, j = 0; i < fwd.length; i++) {
    while (fwd[i] - fwd[j] >= 1000) j++;
    if (i - j + 1 > maxIn1s) [maxIn1s, maxAt] = [i - j + 1, fwd[j]];
  }
  const over = maxIn1s > limit * 1.05;
  const l0 = st.lims[0];
  const mem: Record<Algo, [string, string]> = {
    token: ['16 B', 'tokens + last refill ts · O(1)'],
    leaky: [`${l0.queue.length * 8 + 8} B`, `queue of ≤ ${burst} · O(burst)`],
    fixed: ['12 B', 'counter + window id · O(1)'],
    log: [`${l0.log.length * 8} B`, `${l0.log.length} timestamps · O(limit)`],
    swc: ['16 B', '2 counters + window id · O(1)'],
  };

  const W = 560;
  const H = 260;
  const X0 = 30;
  const X1 = 530;
  const tx = (t: number) => X1 - ((now - t) / SPAN) * (X1 - X0);
  const color = (r: Req) => (r.status === 'ok' ? 'rgb(var(--c-ok))' : r.status === 'queued' ? 'rgb(var(--c-warn))' : 'rgb(var(--c-bad))');
  const wins = [0, 1, 2, 3].map((k) => Math.floor(now / 1000) - k).filter((w) => w >= 0 && (w + 1) * 1000 > now - SPAN);

  const swcW = 1 - (now - Math.floor(now / 1000) * 1000) / 1000;
  const swcPrev = Math.floor(now / 1000) === l0.win ? l0.prev : Math.floor(now / 1000) === l0.win + 1 ? l0.count : 0;
  const swcCur = Math.floor(now / 1000) === l0.win ? l0.count : 0;
  const nodeCounts = [0, 1, 2].map((n) => st.reqs.filter((r) => r.node === n && r.fwd !== undefined && r.fwd > now - 1000).length);

  const INSIGHT: Record<Algo, string> = {
    token: `Token bucket refills ${limit} tokens/s up to ${burst}; each request spends one. Bursts up to the bucket size pass instantly, then the sustained rate applies — so the worst 1 s can reach burst + rate. O(1) state; what AWS API Gateway, Stripe and Envoy use.`,
    leaky: `Leaky bucket queues requests and releases them at a constant ${limit}/s — look at the "to backend" strip: perfectly evenly spaced, whatever the input. That is traffic shaping (NGINX limit_req), paid for with queueing latency; a full queue (${burst}) means 429.`,
    fixed: 'Fixed window: one counter per client per second (INCR rl:{client}:{epoch_sec} + EXPIRE). Cheapest possible, but the window edge is a loophole: a client can spend a full quota just before the edge and another right after it.',
    log: 'Sliding log stores a timestamp per allowed request (Redis ZSET: ZREMRANGEBYSCORE → ZCARD → ZADD). Exact at every instant — no 1 s span ever exceeds the limit — but memory is O(limit) per client: at 1,000 req/s × 1M clients that is gigabytes.',
    swc: `Sliding window counter: estimate = prev × overlap + current = ${swcPrev} × ${swcW.toFixed(2)} + ${swcCur}. Two counters per client yet it closes the boundary loophole to within a few % (Cloudflare reported 0.003% wrong decisions). The usual production choice.`,
  };

  return (
    <LabFrame
      title="Rate limiting algorithms"
      goal="Pick an algorithm and a traffic pattern. Try the boundary attack against fixed window, then deploy on 3 gateways with local counters."
      running={running}
      onToggle={() => setRunning((r) => !r)}
      onReset={reset}
      controls={
        <>
          <div className="sm:col-span-2">
            <Seg label="Algorithm" value={algo} options={ALGOS} onChange={(a) => (setAlgo(a), resetLimiters())} />
          </div>
          <Seg
            label="Traffic"
            value={pattern}
            options={[
              { value: 'steady', label: 'steady', hint: 'Poisson arrivals at the offered load' },
              { value: 'bursty', label: 'bursty', hint: 'All of a 2 s budget in 300 ms' },
              { value: 'boundary', label: 'boundary attack', hint: '2× limit in 200 ms straddling a window edge' },
            ]}
            onChange={(p) => (setPattern(p), resetLimiters())}
          />
          <Seg
            label="Deployment"
            value={deploy}
            options={[
              { value: 'single', label: '1 gateway' },
              { value: 'local', label: '3 gateways · local counters' },
              { value: 'redis', label: '3 gateways · shared Redis' },
            ]}
            onChange={(d) => (setDeploy(d), resetLimiters())}
          />
          <Slider label="Limit" value={limit} min={5} max={20} onChange={setLimit} fmt={(v) => `${v} req/s`} />
          <Slider label="Offered load" value={load} min={0.5} max={4} step={0.25} onChange={setLoad} fmt={(v) => (pattern === 'boundary' ? 'set by the attack (2× limit / 2 s)' : `${v}× limit`)} />
          {(algo === 'token' || algo === 'leaky') && (
            <Slider label={algo === 'token' ? 'Bucket size (burst)' : 'Queue size'} value={burst} min={1} max={20} onChange={setBurst} fmt={(v) => `${v}`} />
          )}
        </>
      }
      stats={
        <>
          <Stat label="Allowed / s" value={allowedPerS.toFixed(1)} tone={allowedPerS > limit * 1.1 ? 'bad' : 'ok'} sub={`limit ${limit}/s${deploy === 'local' ? ' (per node!)' : ''}`} />
          <Stat label="Rejected (429)" value={`${(rejPct * 100).toFixed(0)}%`} tone={rejPct > 0.3 ? 'warn' : undefined} sub="last 3 s" />
          <Stat label="Max allowed in any 1 s" value={maxIn1s} tone={over ? 'bad' : 'ok'} sub={over ? `${(maxIn1s / limit).toFixed(1)}× the limit` : 'within limit'} />
          <Stat label="State per client" value={mem[algo][0]} sub={`${mem[algo][1]}${deploy === 'redis' ? ' · +1 ms Redis RTT' : ''}`} />
        </>
      }
      insight={
        <>
          {INSIGHT[algo]}{' '}
          {algo === 'fixed' && pattern === 'boundary' && over && <b className="text-bad">Boundary attack: {maxIn1s} requests passed within ~200 ms around the edge — {(maxIn1s / limit).toFixed(1)}× the limit, though each window individually counted ≤ {limit}. </b>}
          {deploy === 'local' && <b className="text-bad">3 gateways with local counters: each enforces the full limit on its third of the traffic, so up to 3× the limit gets through. Splitting the limit per node breaks as soon as the LB is uneven. </b>}
          {deploy === 'redis' && <span className="text-info">Shared Redis counter: one global truth, exact limit — at the cost of ~1 ms per request and a new dependency (fail open or closed?). Use a Lua script so read-check-increment is atomic.</span>}
        </>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <text x={X0} y={12} className="fill-faint font-mono text-[9px]">
          arrivals, last 3 s (green allowed · amber queued · red 429)
        </text>
        <text x={X1} y={12} textAnchor="end" className="fill-faint font-mono text-[9px]">
          now
        </text>
        <rect x={X0} y={18} width={X1 - X0} height={88} rx={6} fill="rgb(var(--c-surface))" stroke="rgb(var(--c-line))" />
        {maxIn1s > 0 && maxAt > now - SPAN && (
          <rect x={tx(maxAt)} y={18} width={Math.min(X1, tx(maxAt + 1000)) - tx(maxAt)} height={88} fill={over ? 'rgb(var(--c-bad) / 0.08)' : 'rgb(var(--c-ok) / 0.06)'} stroke={over ? 'rgb(var(--c-bad) / 0.5)' : 'none'} strokeDasharray="3 3" />
        )}
        {(algo === 'fixed' || algo === 'swc') &&
          wins.map((w) => {
            const n = fwd.filter((t) => t >= w * 1000 && t < (w + 1) * 1000).length;
            return (
              <g key={w}>
                {w * 1000 > now - SPAN && <line x1={tx(w * 1000)} x2={tx(w * 1000)} y1={18} y2={130} stroke="rgb(var(--c-ink) / 0.5)" strokeDasharray="4 3" />}
                <text x={Math.max(X0 + 2, tx(w * 1000) + 4)} y={30} className={n > limit ? 'fill-bad font-mono text-[9px]' : 'fill-muted font-mono text-[9px]'}>
                  window {n}/{limit}
                </text>
              </g>
            );
          })}
        {(algo === 'log' || algo === 'swc') && <rect x={tx(now - 1000)} y={110} width={tx(now) - tx(now - 1000)} height={4} rx={2} fill="rgb(var(--c-info))" />}
        {recent.map((r) => (
          <motion.circle key={r.id} cx={tx(r.t)} cy={40 + ((r.id * 37) % 60)} r={3.4} fill={color(r)} initial={{ scale: 2.2 }} animate={{ scale: 1 }} transition={{ duration: 0.25 }} />
        ))}
        <text x={X0} y={124} className="fill-faint font-mono text-[9px]">
          to backend:
        </text>
        {fwd.filter((t) => t > now - SPAN).map((t, i) => (
          <line key={`${t}-${i}`} x1={tx(t)} x2={tx(t)} y1={128} y2={138} stroke="rgb(var(--c-ok))" strokeWidth={1.5} />
        ))}
        <line x1={X0} x2={X1} y1={138} y2={138} stroke="rgb(var(--c-line))" />

        {/* algorithm state */}
        <g transform="translate(30 150)">
          <text y={8} className="fill-muted font-mono text-[10px]">
            {ALGOS.find((a) => a.value === algo)!.label} state{deploy === 'local' ? ' (gateway A)' : ''}
          </text>
          {algo === 'token' && (
            <>
              <path d="M 0 20 L 6 100 L 120 100 L 126 20" fill="none" stroke="rgb(var(--c-ink) / 0.6)" strokeWidth={1.5} />
              {Array.from({ length: burst }, (_, i) => (
                <circle key={i} cx={16 + (i % 5) * 23} cy={90 - Math.floor(i / 5) * 18} r={7} fill={i < Math.floor(l0.tokens) ? 'rgb(var(--c-accent))' : 'rgb(var(--c-line) / 0.5)'} />
              ))}
              <text x={140} y={40} className="fill-ink font-mono text-[11px]">
                {l0.tokens.toFixed(1)} / {burst} tokens
              </text>
              <text x={140} y={56} className="fill-faint font-mono text-[9.5px]">
                +{limit} tokens/s refill
              </text>
              <text x={140} y={70} className="fill-faint font-mono text-[9.5px]">
                request costs 1 token
              </text>
            </>
          )}
          {algo === 'leaky' && (
            <>
              {Array.from({ length: burst }, (_, i) => (
                <rect key={i} x={i * 12} y={30} width={10} height={24} rx={2} fill={i < l0.queue.length ? 'rgb(var(--c-warn))' : 'rgb(var(--c-line) / 0.5)'} />
              ))}
              <text x={0} y={72} className="fill-ink font-mono text-[11px]">
                queue {l0.queue.length}/{burst} → drains 1 every {Math.round(1000 / limit)} ms
              </text>
              <text x={0} y={88} className="fill-faint font-mono text-[9.5px]">
                wait for the last in queue ≈ {Math.round((l0.queue.length * 1000) / limit)} ms
              </text>
            </>
          )}
          {(algo === 'fixed' || algo === 'swc') && (
            <>
              {(algo === 'fixed' ? [['current', swcCur, 1]] : [['previous', swcPrev, swcW], ['current', swcCur, 1]]).map(([lbl, v, wgt], i) => (
                <g key={String(lbl)} transform={`translate(0 ${22 + i * 26})`}>
                  <text y={11} className="fill-muted font-mono text-[9.5px]">
                    {lbl}
                  </text>
                  <rect x={60} width={170} height={14} rx={3} fill="rgb(var(--c-line) / 0.4)" />
                  <rect x={60} width={Math.min(170, (170 * Number(v)) / limit)} height={14} rx={3} fill="rgb(var(--c-accent))" opacity={Number(wgt) < 1 ? 0.35 + 0.6 * Number(wgt) : 1} />
                  <text x={236} y={11} className="fill-ink font-mono text-[10px]">
                    {String(v)}/{limit}
                    {Number(wgt) < 1 ? ` ×${Number(wgt).toFixed(2)}` : ''}
                  </text>
                </g>
              ))}
              <text y={algo === 'fixed' ? 66 : 90} className="fill-faint font-mono text-[9.5px]">
                {algo === 'fixed' ? `resets in ${Math.round(1000 - (now % 1000))} ms` : `estimate ${(swcPrev * swcW + swcCur).toFixed(1)} < ${limit} → allow`}
              </text>
            </>
          )}
          {algo === 'log' && (
            <>
              <rect y={30} width={250} height={26} rx={4} fill="rgb(var(--c-surface))" stroke="rgb(var(--c-line))" />
              {l0.log.filter((t) => t > now - 1000).map((t, i) => (
                <line key={`${t}-${i}`} x1={250 - ((now - t) / 1000) * 250} x2={250 - ((now - t) / 1000) * 250} y1={33} y2={53} stroke="rgb(var(--c-info))" strokeWidth={2} />
              ))}
              <text y={72} className="fill-ink font-mono text-[11px]">
                {l0.log.filter((t) => t > now - 1000).length}/{limit} timestamps in the last 1 s
              </text>
              <text y={88} className="fill-faint font-mono text-[9.5px]">
                one sorted-set entry per allowed request
              </text>
            </>
          )}
        </g>

        {/* deployment */}
        <g transform="translate(350 150)">
          <text y={8} className="fill-muted font-mono text-[10px]">
            {deploy === 'single' ? 'one gateway' : 'LB → 3 gateways (allowed, last 1 s)'}
          </text>
          {(deploy === 'single' ? [0] : [0, 1, 2]).map((n) => (
            <g key={n} transform={`translate(${n * 62} 20)`}>
              <rect width={56} height={34} rx={6} fill="rgb(var(--c-surface))" stroke={deploy === 'local' && nodeCounts[n] > 0 ? 'rgb(var(--c-warn))' : 'rgb(var(--c-line))'} strokeWidth={1.5} />
              <text x={28} y={14} textAnchor="middle" className="fill-ink font-mono text-[10px] font-semibold">
                gw {'ABC'[n]}
              </text>
              <text x={28} y={27} textAnchor="middle" className="fill-muted font-mono text-[9px]">
                {nodeCounts[n]} ok
              </text>
              {deploy === 'redis' && <line x1={28} y1={34} x2={93 - n * 62} y2={62} stroke="rgb(var(--c-bad) / 0.6)" strokeDasharray="3 2" />}
            </g>
          ))}
          {deploy === 'redis' && (
            <>
              <rect x={50} y={82} width={86} height={22} rx={5} fill="rgb(var(--c-surface))" stroke="rgb(var(--c-bad))" />
              <text x={93} y={96} textAnchor="middle" className="fill-ink font-mono text-[9.5px]">
                Redis · Lua INCR
              </text>
            </>
          )}
          {deploy !== 'redis' && (
            <text y={74} className={deploy === 'local' ? 'fill-bad font-mono text-[9.5px]' : 'fill-faint font-mono text-[9.5px]'}>
              {deploy === 'local' ? `Σ ${nodeCounts.reduce((a, b) => a + b, 0)} passed vs limit ${limit}` : 'counter in process memory'}
            </text>
          )}
        </g>
      </svg>
    </LabFrame>
  );
}
