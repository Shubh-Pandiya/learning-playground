import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/shared/cn';
import { LabFrame, pct, rng, Seg, Slider, Stat, useTicker } from './kit';

type Cond = 'healthy' | 'slow' | 'down';
type Prot = 'none' | 'naive' | 'backoff' | 'breaker';
type BState = 'CLOSED' | 'OPEN' | 'HALF';

interface Call {
  start: number;
  attempt: number;
  phase: 'dep' | 'backoff';
  until: number;
  fail: boolean;
  trial: boolean;
}
interface Tick {
  first: number;
  retry: number;
  threads: number;
  state: BState;
  fallback: number;
}
interface Packet {
  id: number;
  kind: 'first' | 'retry' | 'fallback';
}

const TICK_MS = 100;
const RATE = 4; // user requests per tick = 40 rps
const POOL = 40; // caller worker threads
const CAP = 6; // dependency capacity, attempts per tick
const WINDOW = 20;
const TRIALS = 3;
const HIST = 60;

const COND: Record<Cond, { fail: number; okLat: number; failLat: 'timeout' | number; label: string }> = {
  healthy: { fail: 0.01, okLat: 1, failLat: 1, label: '1% errors, 100 ms' },
  slow: { fail: 0.6, okLat: 4, failLat: 'timeout', label: '60% hang → timeouts' },
  down: { fail: 1, okLat: 1, failLat: 1, label: '100% fast 503s' },
};

const INSIGHT: Record<Prot, string> = {
  none: 'No protection: every failure reaches the user, and in "slow" mode each request holds a caller thread for the full timeout — a slow dependency is worse than a dead one because it ties up your threads.',
  naive: 'Naive retries: 3 immediate retries turn every failing call into 4 calls. A struggling dependency gets up to 4× its normal load exactly when it can least afford it — a retry storm — and the extra overload makes even healthy requests fail. Threads stay blocked through every attempt.',
  backoff: 'Exponential backoff + full jitter (sleep = random(0, base·2ⁿ)) spreads retries out so thousands of clients do not retry in lock-step. Total attempts are still up to 4×, though — backoff smooths a storm, it does not stop one. And a synchronous sleep still holds a thread.',
  breaker: 'Circuit breaker: once ≥50% of the last 20 calls fail it OPENS and fails fast — no thread blocked, no load sent, a fallback (cached/default response) is served instead. After the open timeout it lets a few HALF-OPEN trial calls through; success closes it, failure re-opens it. The dependency gets quiet time to recover.',
};

function fresh() {
  return {
    t: 0,
    pid: 0,
    calls: [] as Call[],
    state: 'CLOSED' as BState,
    openUntil: 0,
    trials: 0,
    trialOk: 0,
    window: [] as boolean[],
    lastLoad: 0,
    hist: [] as Tick[],
    lat: [] as number[],
    outcomes: [] as ('ok' | 'fail' | 'fallback')[],
    sent: [] as number[],
    arrived: [] as number[],
    packets: [] as Packet[],
    rand: rng(5),
  };
}

export default function BreakerLab() {
  const [cond, setCond] = useState<Cond>('slow');
  const [prot, setProt] = useState<Prot>('naive');
  const [openSec, setOpenSec] = useState(3);
  const [timeoutSec, setTimeoutSec] = useState(1);
  const [running, setRunning] = useState(true);
  const [, force] = useState(0);
  const s = useRef(fresh());

  const reset = () => {
    s.current = fresh();
    force((x) => x + 1);
  };

  useTicker(running, TICK_MS, () => {
    const st = s.current;
    const c = COND[cond];
    st.t++;
    const breaker = prot === 'breaker';
    if (!breaker) st.state = 'CLOSED';
    if (breaker && st.state === 'OPEN' && st.t >= st.openUntil) Object.assign(st, { state: 'HALF', trials: 0, trialOk: 0 });

    // overloaded dependency: requests beyond capacity also time out
    const pFail = 1 - (1 - c.fail) * Math.min(1, CAP / Math.max(1, st.lastLoad));
    let first = 0;
    let retry = 0;
    let fallback = 0;
    const packets: Packet[] = [];
    const done = (call: Call, o: 'ok' | 'fail' | 'fallback') => {
      st.lat.push(st.t - call.start);
      st.outcomes.push(o);
      call.until = -1; // mark finished
    };
    const attempt = (call: Call) => {
      call.trial = false;
      if (breaker && (st.state === 'OPEN' || (st.state === 'HALF' && st.trials >= TRIALS))) {
        fallback++;
        packets.push({ id: st.pid++, kind: 'fallback' });
        return done(call, 'fallback');
      }
      if (breaker && st.state === 'HALF') {
        st.trials++;
        call.trial = true;
      }
      if (call.attempt === 0) first++;
      else retry++;
      packets.push({ id: st.pid++, kind: call.attempt ? 'retry' : 'first' });
      call.fail = st.rand() < pFail;
      const overloadTimeout = call.fail && st.rand() > c.fail / Math.max(pFail, 1e-9);
      const lat = !call.fail ? c.okLat : c.failLat === 'timeout' || overloadTimeout ? Math.round(timeoutSec * 10) : c.failLat;
      call.phase = 'dep';
      call.until = st.t + lat;
    };
    const record = (call: Call) => {
      if (!breaker) return;
      if (call.trial) {
        if (call.fail) Object.assign(st, { state: 'OPEN', openUntil: st.t + openSec * 10 });
        else if (++st.trialOk >= TRIALS) Object.assign(st, { state: 'CLOSED', window: [] });
        return;
      }
      if (st.state !== 'CLOSED') return;
      st.window = [...st.window, call.fail].slice(-WINDOW);
      const fails = st.window.filter(Boolean).length;
      if (st.window.length >= 10 && fails / st.window.length >= 0.5) Object.assign(st, { state: 'OPEN', openUntil: st.t + openSec * 10 });
    };

    for (const call of [...st.calls]) {
      if (call.until > st.t) continue;
      if (call.phase === 'backoff') {
        attempt(call);
        continue;
      }
      record(call);
      if (!call.fail) {
        done(call, 'ok');
        continue;
      }
      if (prot === 'none' || call.attempt >= 3) {
        done(call, 'fail');
        continue;
      }
      call.attempt++;
      if (prot === 'naive') attempt(call);
      else {
        call.phase = 'backoff'; // full jitter: sleep random(0, 200ms · 2^(n-1))
        call.until = st.t + 1 + Math.floor(st.rand() * 2 * 2 ** (call.attempt - 1));
      }
    }
    st.calls = st.calls.filter((x) => x.until !== -1);
    for (let i = 0; i < RATE; i++) {
      if (st.calls.length >= POOL) {
        st.lat.push(0);
        st.outcomes.push('fail'); // rejected: thread pool exhausted
        continue;
      }
      const call: Call = { start: st.t, attempt: 0, phase: 'dep', until: 0, fail: false, trial: false };
      attempt(call);
      if (call.until !== -1) st.calls.push(call);
    }

    st.lastLoad = first + retry;
    st.hist = [...st.hist, { first, retry, threads: st.calls.length, state: st.state, fallback }].slice(-HIST);
    st.sent = [...st.sent, first + retry].slice(-50);
    st.arrived = [...st.arrived, RATE].slice(-50);
    st.lat = st.lat.slice(-400);
    st.outcomes = st.outcomes.slice(-400);
    st.packets = [...st.packets, ...packets].slice(-28);
    force((x) => x + 1);
  });

  const st = s.current;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const mult = sum(st.sent) / Math.max(1, sum(st.arrived));
  const total = st.outcomes.length || 1;
  const okPct = st.outcomes.filter((o) => o === 'ok').length / total;
  const fbPct = st.outcomes.filter((o) => o === 'fallback').length / total;
  const p99 = pct(st.lat, 0.99) * TICK_MS;
  const threads = st.calls.length;
  const load = st.lastLoad;
  const breaker = prot === 'breaker';

  const NODES: Record<BState, { x: number; y: number; tone: string; label: string }> = {
    CLOSED: { x: 228, y: 36, tone: '--c-ok', label: 'CLOSED' },
    OPEN: { x: 348, y: 36, tone: '--c-bad', label: 'OPEN' },
    HALF: { x: 288, y: 98, tone: '--c-warn', label: 'HALF-OPEN' },
  };
  const arrow = (a: BState, b: BState, label: string, dy: number, lx: number, ly: number) => {
    const A = NODES[a];
    const B = NODES[b];
    const mx = (A.x + B.x) / 2;
    const my = (A.y + B.y) / 2 + dy;
    // clip the curve at the pill borders so the arrowhead stays visible
    const edge = (P: { x: number; y: number }, Q: { x: number; y: number }) => {
      const ux = Q.x - P.x;
      const uy = Q.y - P.y;
      const len = Math.hypot(ux, uy) || 1;
      const r = Math.min(36 / Math.max(Math.abs(ux / len), 1e-6), 13 / Math.max(Math.abs(uy / len), 1e-6));
      return { x: P.x + (ux / len) * r, y: P.y + (uy / len) * r };
    };
    const ctl = { x: mx + dy * 0.6, y: my };
    const s0 = edge(A, ctl);
    const s1 = edge(B, ctl);
    return (
      <g key={a + b}>
        <path d={`M${s0.x},${s0.y} Q${ctl.x},${ctl.y} ${s1.x},${s1.y}`} fill="none" stroke="rgb(var(--c-faint))" strokeWidth={1} markerEnd="url(#brk-arrow)" />
        <text x={lx} y={ly} textAnchor="middle" className="fill-faint font-mono text-[7.5px]">
          {label}
        </text>
      </g>
    );
  };
  const left = Math.max(0, (st.openUntil - st.t) / 10);

  let extra = '';
  if (cond === 'healthy') extra = ' The dependency is healthy, so all strategies look identical — protection only matters during an incident. Switch to slow or down.';
  else if (breaker && st.state === 'OPEN') extra = ` Breaker OPEN: ${left.toFixed(1)} s until a trial call. Fallbacks are served instantly (${Math.round(fbPct * 100)}% of responses) — degraded, but no threads blocked.`;
  else if (prot === 'naive' && mult > 2) extra = ` Right now the dependency receives ${mult.toFixed(1)}× the user traffic (capacity ${CAP * 10}/s) — the retries are the outage.`;
  if (threads >= POOL) extra += ' The caller\'s thread pool is exhausted: new requests are rejected even for endpoints that do not need this dependency — the failure has cascaded upstream.';
  extra += ' Only retry idempotent operations (GETs, or writes with an idempotency key), and cap retries with a budget.';

  return (
    <LabFrame
      title="Circuit breaker, retries & backoff"
      goal="Make the dependency slow or down, then compare protections: watch dependency load (bars), blocked caller threads (line) and the breaker state machine."
      running={running}
      onToggle={() => setRunning((r) => !r)}
      onReset={reset}
      controls={
        <>
          <Seg label="Dependency" value={cond} options={(['healthy', 'slow', 'down'] as Cond[]).map((v) => ({ value: v, label: v, hint: COND[v].label }))} onChange={setCond} />
          <Seg
            label="Caller protection"
            value={prot}
            options={[
              { value: 'none', label: 'none' },
              { value: 'naive', label: 'naive retry ×3' },
              { value: 'backoff', label: 'backoff + jitter' },
              { value: 'breaker', label: 'breaker + backoff' },
            ]}
            onChange={setProt}
          />
          <Slider label="Call timeout" value={timeoutSec} min={0.2} max={3} step={0.1} onChange={setTimeoutSec} fmt={(v) => `${v.toFixed(1)} s`} />
          <Slider label="Breaker open timeout" value={openSec} min={1} max={10} onChange={setOpenSec} fmt={(v) => `${v} s before HALF-OPEN`} />
        </>
      }
      stats={
        <>
          <Stat label="Dependency load" value={`${mult.toFixed(2)}×`} tone={mult > 2 ? 'bad' : mult > 1.2 ? 'warn' : 'ok'} sub={`${load * 10}/s vs capacity ${CAP * 10}/s`} />
          <Stat label="Caller success" value={`${Math.round(okPct * 100)}%`} tone={okPct > 0.95 ? 'ok' : okPct > 0.6 ? 'warn' : 'bad'} sub={fbPct ? `+${Math.round(fbPct * 100)}% fallback` : 'no fallbacks'} />
          <Stat label="p99 caller latency" value={`${Math.round(p99)} ms`} tone={p99 > 1500 ? 'bad' : p99 > 500 ? 'warn' : 'ok'} />
          <Stat label="Threads busy" value={`${threads}/${POOL}`} tone={threads >= POOL ? 'bad' : threads > POOL * 0.6 ? 'warn' : 'ok'} sub={threads >= POOL ? 'pool exhausted → rejecting' : 'blocked on dependency'} />
        </>
      }
      insight={INSIGHT[prot] + extra}
    >
      <svg viewBox="0 0 560 196" className="w-full">
        <defs>
          <marker id="brk-arrow" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={6} markerHeight={6} orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="rgb(var(--c-faint))" />
          </marker>
        </defs>
        {/* caller + thread pool */}
        <rect x={8} y={12} width={140} height={176} rx={10} fill="rgb(var(--c-surface))" stroke="rgb(var(--c-accent))" strokeWidth={1.5} />
        <text x={78} y={30} textAnchor="middle" className="fill-ink font-mono text-[11px] font-semibold">
          caller service
        </text>
        <text x={78} y={44} textAnchor="middle" className="fill-faint font-mono text-[8.5px]">
          {RATE * 10} req/s · {POOL} threads
        </text>
        {Array.from({ length: POOL }, (_, i) => {
          const c = st.calls[i];
          return (
            <rect
              key={i}
              x={20 + (i % 8) * 15}
              y={54 + Math.floor(i / 8) * 15}
              width={12}
              height={12}
              rx={2}
              fill={!c ? 'rgb(var(--c-sunken))' : c.phase === 'backoff' ? 'rgb(var(--c-violet) / 0.7)' : st.t - c.start > 4 ? 'rgb(var(--c-bad) / 0.75)' : 'rgb(var(--c-accent) / 0.75)'}
              stroke="rgb(var(--c-line))"
            />
          );
        })}
        <text x={20} y={145} className="fill-faint font-mono text-[8px]">
          <tspan className="fill-accent">■</tspan> waiting <tspan className="fill-bad">■</tspan> &gt;0.4 s <tspan className="fill-violet">■</tspan> backoff
        </text>
        <text x={20} y={170} className={cn('font-mono text-[10px]', threads >= POOL ? 'fill-bad' : 'fill-muted')}>
          {threads >= POOL ? 'POOL EXHAUSTED' : `${threads} threads blocked`}
        </text>
        {/* breaker state machine */}
        <g opacity={breaker ? 1 : 0.3}>
          {arrow('CLOSED', 'OPEN', '≥50% of last 20 fail', -14, 288, 17)}
          {arrow('OPEN', 'HALF', `after ${openSec}s`, 10, 370, 80)}
          {arrow('HALF', 'CLOSED', `${TRIALS} trials ok`, 10, 212, 82)}
          {arrow('HALF', 'OPEN', 'trial fails', -8, 300, 62)}
          {(Object.keys(NODES) as BState[]).map((k) => {
            const n = NODES[k];
            const on = breaker && st.state === k;
            return (
              <motion.g key={k} animate={{ scale: on ? 1.08 : 1 }}>
                <rect x={n.x - 34} y={n.y - 11} width={68} height={22} rx={11} fill={on ? `rgb(var(${n.tone}) / 0.2)` : 'rgb(var(--c-surface))'} stroke={`rgb(var(${n.tone}))`} strokeWidth={on ? 2 : 1} />
                <text x={n.x} y={n.y + 3.5} textAnchor="middle" className="fill-ink font-mono text-[9px] font-semibold">
                  {n.label}
                </text>
              </motion.g>
            );
          })}
          {st.window.map((f, i) => (
            <circle key={i} cx={210 + i * 8} cy={132} r={3} fill={f ? 'rgb(var(--c-bad))' : 'rgb(var(--c-ok))'} />
          ))}
          <text x={208} y={124} className="fill-faint font-mono text-[8px]">
            {breaker ? (st.state === 'OPEN' ? `open · trial in ${left.toFixed(1)} s` : st.state === 'HALF' ? `half-open · trials ${st.trials}/${TRIALS}, ok ${st.trialOk}` : `window: ${st.window.filter(Boolean).length}/${st.window.length} failed`) : 'breaker disabled'}
          </text>
        </g>
        {/* packets */}
        <line x1={150} y1={170} x2={408} y2={170} stroke="rgb(var(--c-line))" strokeDasharray="3 3" />
        {st.packets.map((p) =>
          p.kind === 'fallback' ? (
            <motion.circle key={p.id} r={3.5} cy={170} fill="rgb(var(--c-violet))" initial={{ cx: 200, opacity: 1 }} animate={{ cx: 152, opacity: 0 }} transition={{ duration: 0.35 }} />
          ) : (
            <motion.circle
              key={p.id}
              r={3.5}
              fill={p.kind === 'retry' ? 'rgb(var(--c-bad))' : 'rgb(var(--c-accent))'}
              initial={{ cx: 150, cy: 170 + (p.id % 5) * 3 - 6, opacity: 1 }}
              animate={{ cx: 406, opacity: 0.5 }}
              transition={{ duration: 0.5, ease: 'linear' }}
            />
          ),
        )}
        <text x={280} y={190} textAnchor="middle" className="fill-faint font-mono text-[8px]">
          <tspan className="fill-accent">●</tspan> first try <tspan className="fill-bad">●</tspan> retry <tspan className="fill-violet">●</tspan> fast-fail fallback
        </text>
        {/* dependency */}
        <rect x={412} y={12} width={140} height={176} rx={10} fill="rgb(var(--c-surface))" stroke={cond === 'healthy' ? 'rgb(var(--c-ok))' : 'rgb(var(--c-bad))'} strokeWidth={1.5} />
        <text x={482} y={30} textAnchor="middle" className="fill-ink font-mono text-[11px] font-semibold">
          dependency
        </text>
        <text x={482} y={44} textAnchor="middle" className={cn('font-mono text-[8.5px]', cond === 'healthy' ? 'fill-ok' : 'fill-bad')}>
          {COND[cond].label}
        </text>
        <rect x={430} y={60} width={104} height={14} rx={3} fill="rgb(var(--c-sunken))" />
        <motion.rect x={430} y={60} height={14} rx={3} animate={{ width: Math.min(104, (load / (CAP * 2.5)) * 104) }} fill={load > CAP ? 'rgb(var(--c-bad))' : 'rgb(var(--c-ok))'} />
        <line x1={430 + 104 / 2.5} y1={56} x2={430 + 104 / 2.5} y2={78} stroke="rgb(var(--c-ink))" strokeDasharray="2 2" />
        <text x={430} y={90} className="fill-faint font-mono text-[8.5px]">
          load {load * 10}/s · cap {CAP * 10}/s
        </text>
        <text x={430} y={110} className={cn('font-mono text-[9.5px]', load > CAP ? 'fill-bad' : 'fill-muted')}>
          {load > CAP ? 'OVERLOADED: excess times out' : 'within capacity'}
        </text>
      </svg>
      <svg viewBox="0 0 560 100" className="w-full">
        {st.hist.map((h, i) => {
          const x = 20 + i * (520 / HIST);
          const w = 520 / HIST - 1.5;
          const sc = 80 / (CAP * 3);
          return (
            <g key={i}>
              {h.state !== 'CLOSED' && <rect x={x - 0.75} y={8} width={w + 1.5} height={80} fill={h.state === 'OPEN' ? 'rgb(var(--c-bad) / 0.1)' : 'rgb(var(--c-warn) / 0.15)'} />}
              <rect x={x} y={88 - h.first * sc} width={w} height={h.first * sc} fill="rgb(var(--c-accent) / 0.8)" />
              <rect x={x} y={88 - (h.first + h.retry) * sc} width={w} height={Math.min(80, h.retry * sc)} fill="rgb(var(--c-bad) / 0.8)" />
              {h.fallback > 0 && <rect x={x} y={4} width={w} height={3} fill="rgb(var(--c-violet))" />}
            </g>
          );
        })}
        <line x1={20} y1={88 - 80 / 3} x2={540} y2={88 - 80 / 3} stroke="rgb(var(--c-ink) / 0.5)" strokeDasharray="4 3" />
        <polyline points={st.hist.map((h, i) => `${20 + i * (520 / HIST) + 4},${88 - (h.threads / POOL) * 80}`).join(' ')} fill="none" stroke="rgb(var(--c-info))" strokeWidth={1.6} />
        <line x1={20} y1={88} x2={540} y2={88} stroke="rgb(var(--c-line))" />
        <text x={22} y={98} className="fill-faint font-mono text-[8px]">
          <tspan className="fill-accent">█</tspan> first tries/tick <tspan className="fill-bad">█</tspan> retries <tspan className="fill-ink">- -</tspan> dep capacity <tspan className="fill-info">—</tspan> threads busy <tspan className="fill-violet">▬</tspan> fallback · shading = breaker open / half-open
        </text>
      </svg>
    </LabFrame>
  );
}
