import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { LabFrame, rng, Seg, Slider, Stat, useTicker } from './kit';

type Ack = 'after' | 'receive';
type Dest = 'done' | 'dlq' | 'lost';

interface Msg {
  id: number;
  born: number;
  attempts: number;
  poison: boolean;
  effect: boolean; // side effect already applied by a consumer that crashed before acking
  visibleAt: number;
}
interface Consumer {
  msg: Msg | null;
  left: number;
  downUntil: number;
}

const TICK_MS = 100;
const PROC_TICKS = 5; // each consumer: 2 msg/s
const VIS_TIMEOUT = 20; // 2 s visibility timeout
const SCALE_THRESHOLD = 15;
const HIST = 150;

function fresh() {
  return {
    t: 0,
    id: 0,
    acc: 0,
    queue: [] as Msg[],
    invisible: [] as Msg[],
    cs: Array.from({ length: 10 }, (): Consumer => ({ msg: null, left: 0, downUntil: 0 })),
    active: 2,
    high: 0,
    idle: 0,
    leaving: [] as { msg: Msg; dest: Dest; ttl: number }[],
    done: 0,
    dlq: 0,
    dup: 0,
    lost: 0,
    inLog: [] as number[],
    outLog: [] as number[],
    hist: [] as { backlog: number; age: number; consumers: number }[],
    rand: rng(11),
  };
}

export default function QueueLab() {
  const [rate, setRate] = useState(5);
  const [consumers, setConsumers] = useState(2);
  const [poison, setPoison] = useState(5);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [ack, setAck] = useState<Ack>('after');
  const [autoscale, setAutoscale] = useState(false);
  const [running, setRunning] = useState(true);
  const [, force] = useState(0);
  const s = useRef(fresh());

  const reset = () => {
    s.current = fresh();
    s.current.active = consumers;
    force((x) => x + 1);
  };

  const finish = (msg: Msg, dest: Dest) => s.current.leaving.push({ msg, dest, ttl: 6 });

  useTicker(running, TICK_MS, () => {
    const st = s.current;
    st.t++;
    let produced = 0;
    let out = 0;
    st.acc += rate / (1000 / TICK_MS);
    while (st.acc >= 1) {
      st.acc -= 1;
      produced++;
      st.queue.push({ id: st.id++, born: st.t, attempts: 0, poison: st.rand() * 100 < poison, effect: false, visibleAt: 0 });
    }
    // visibility timeout expired → message reappears for redelivery
    st.queue.push(...st.invisible.filter((m) => m.visibleAt <= st.t));
    st.invisible = st.invisible.filter((m) => m.visibleAt > st.t);

    st.cs.forEach((c, i) => {
      if (c.downUntil > st.t) return;
      if (c.msg) {
        if (--c.left > 0) return;
        const m = c.msg;
        c.msg = null;
        if (m.poison) {
          if (ack === 'receive') {
            st.lost++; // already deleted on receive: the failure is silently dropped
            finish(m, 'lost');
          } else if (m.attempts >= maxAttempts) {
            st.dlq++;
            finish(m, 'dlq');
          } else {
            m.visibleAt = st.t + VIS_TIMEOUT; // no ack → invisible until the timeout, then retried
            st.invisible.push(m);
          }
        } else {
          if (m.effect) st.dup++;
          st.done++;
          out++;
          finish(m, 'done');
        }
      }
      if (!c.msg && i < st.active && st.queue.length) {
        const m = st.queue.shift()!;
        m.attempts++;
        c.msg = m;
        c.left = PROC_TICKS;
      }
    });

    // autoscaler: scale out when backlog stays high, scale in when it stays empty (both with a lag)
    const backlog = st.queue.length + st.invisible.length;
    if (!autoscale) st.active = consumers;
    else {
      st.active = Math.max(st.active, consumers);
      st.high = backlog > SCALE_THRESHOLD ? st.high + 1 : 0;
      st.idle = backlog === 0 ? st.idle + 1 : 0;
      if (st.high >= 15 && st.active < 10) {
        st.active++;
        st.high = 0;
      }
      if (st.idle >= 30 && st.active > consumers) {
        st.active--;
        st.idle = 0;
      }
    }

    const all = [...st.queue, ...st.invisible];
    const oldest = all.length ? Math.min(...all.map((m) => m.born)) : st.t;
    st.hist = [...st.hist, { backlog, age: ((st.t - oldest) * TICK_MS) / 1000, consumers: st.active }].slice(-HIST);
    st.inLog = [...st.inLog, produced].slice(-50);
    st.outLog = [...st.outLog, out].slice(-50);
    st.leaving = st.leaving.map((l) => ({ ...l, ttl: l.ttl - 1 })).filter((l) => l.ttl > 0);
    force((x) => x + 1);
  });

  const crash = () => {
    const st = s.current;
    const busy = st.cs.map((_, i) => i).filter((i) => st.cs[i].msg && st.cs[i].downUntil <= st.t);
    const pool = busy.length ? busy : st.cs.map((_, i) => i).filter((i) => i < st.active);
    const i = pool[Math.floor(st.rand() * pool.length)];
    const c = st.cs[i];
    c.downUntil = st.t + 15;
    if (c.msg) {
      const m = c.msg;
      c.msg = null;
      if (ack === 'receive') {
        st.lost++;
        finish(m, 'lost');
      } else {
        if (c.left <= PROC_TICKS / 2) m.effect = true; // DB write done, ack never sent
        m.visibleAt = st.t + VIS_TIMEOUT;
        st.invisible.push(m);
      }
    }
    force((x) => x + 1);
  };

  const st = s.current;
  const backlog = st.queue.length + st.invisible.length;
  const last = st.hist[st.hist.length - 1];
  const age = last?.age ?? 0;
  const secs = Math.max(1, Math.min(50, st.inLog.length)) / 10;
  const inRate = st.inLog.reduce((a, b) => a + b, 0) / secs;
  const outRate = st.outLog.reduce((a, b) => a + b, 0) / secs;
  const capacity = st.active * (1000 / TICK_MS / PROC_TICKS);

  // layout
  const qx = 102;
  const qy = 34;
  const cell = 19;
  const cxL = 360;
  const cy = (i: number) => 12 + i * 21;
  const DEST: Record<Dest, [number, number]> = { done: [516, 40], dlq: [516, 108], lost: [516, 176] };
  const visible = st.queue.slice(0, 50);
  const placed: { m: Msg; x: number; y: number; tone: string; fade?: boolean }[] = [];
  const tone = (m: Msg) => (m.poison ? '--c-bad' : m.attempts > 0 || m.effect ? '--c-warn' : '--c-accent');
  visible.forEach((m, i) => placed.push({ m, x: qx + (i % 10) * cell, y: qy + Math.floor(i / 10) * cell, tone: tone(m) }));
  st.invisible.slice(0, 10).forEach((m, i) => placed.push({ m, x: qx + i * cell, y: 172, tone: tone(m) }));
  st.cs.forEach((c, i) => c.msg && placed.push({ m: c.msg, x: cxL + 34, y: cy(i) + 2, tone: tone(c.msg) }));
  st.leaving.forEach((l) => placed.push({ m: l.msg, x: DEST[l.dest][0] - 7, y: DEST[l.dest][1] - 7, tone: l.dest === 'done' ? '--c-ok' : tone(l.msg), fade: l.ttl < 3 }));

  const hist = st.hist;
  const maxB = Math.max(20, ...hist.map((h) => h.backlog));
  const maxA = Math.max(5, ...hist.map((h) => h.age));
  const line = (f: (h: (typeof hist)[number]) => number, max: number) => hist.map((h, i) => `${20 + (i / (HIST - 1)) * 520},${92 - (f(h) / max) * 80}`).join(' ');

  const lines: string[] = [];
  if (ack === 'receive' && st.lost) lines.push(`Ack-on-receive (at-most-once) deleted the message before the work was done: ${st.lost} message(s) vanished — crashes and poison failures leave no trace, no retry, no DLQ. Fine for metrics/telemetry, never for payments.`);
  else if (ack === 'after' && st.dup) lines.push(`At-least-once: the crashed consumer had already written to the DB but never acked, so the message reappeared after the visibility timeout and was processed again — ${st.dup} duplicate(s). Consumers must be idempotent (dedupe on a message/idempotency key, upserts, conditional writes).`);
  if (inRate > capacity + 0.3) lines.push(`Producers send ${inRate.toFixed(1)}/s but ${st.active} consumer(s) can do ${capacity.toFixed(0)}/s: the backlog grows by the difference every second, forever. Little's law L = λ·W — queue lag (oldest age ${age.toFixed(1)} s) keeps rising until you add consumers or shed load. A queue absorbs bursts; it does not add capacity.`);
  else if (backlog > SCALE_THRESHOLD) lines.push('Capacity now exceeds the arrival rate, so the backlog drains — but only at (out − in) per second. Draining a big backlog takes a while even after scaling.');
  if (autoscale) lines.push('The autoscaler scales on backlog with a lag (it needs a sustained signal to avoid flapping) and only scales in after the queue stays empty. Scale on backlog-per-consumer or oldest-message age, not on CPU.');
  if (poison > 0 && ack === 'after') lines.push(`Poison messages (red) fail on every attempt; after ${maxAttempts} receives they are parked in the DLQ (${st.dlq} so far) instead of looping forever and stealing consumer time. Alert on DLQ depth and redrive after fixing the bug.`);
  if (!lines.length) lines.push('In < out: the queue stays near empty and each message waits only its processing time. Push the producer rate above consumer capacity to see a backlog build.');

  return (
    <LabFrame
      title="Message queue: producers, consumers, backlog & DLQ"
      goal="Raise the producer rate above consumer capacity and watch the backlog and queue lag climb. Add poison messages, crash a consumer under both ack modes, and turn on autoscaling."
      running={running}
      onToggle={() => setRunning((r) => !r)}
      onReset={reset}
      controls={
        <>
          <Slider label="Producer rate" value={rate} min={1} max={20} onChange={setRate} fmt={(v) => `${v} msg/s`} />
          <Slider label={autoscale ? 'Min consumers' : 'Consumers'} value={consumers} min={1} max={10} onChange={setConsumers} fmt={(v) => `${v} × 2 msg/s = ${v * 2} msg/s`} />
          <Slider label="Poison messages" value={poison} min={0} max={30} onChange={setPoison} fmt={(v) => `${v}%`} />
          <Slider label="Max receive attempts → DLQ" value={maxAttempts} min={1} max={5} onChange={setMaxAttempts} fmt={(v) => `${v} (visibility timeout ${VIS_TIMEOUT / 10} s)`} />
          <Seg
            label="Ack mode"
            value={ack}
            options={[
              { value: 'after', label: 'ack after processing', hint: 'at-least-once' },
              { value: 'receive', label: 'ack on receive', hint: 'at-most-once' },
            ]}
            onChange={setAck}
          />
          <Seg
            label="Autoscale consumers on backlog"
            value={autoscale ? 'on' : 'off'}
            options={[
              { value: 'off', label: 'off' },
              { value: 'on', label: `on (> ${SCALE_THRESHOLD} msgs)` },
            ]}
            onChange={(v) => setAutoscale(v === 'on')}
          />
        </>
      }
      stats={
        <>
          <Stat label="Throughput in → out" value={`${inRate.toFixed(1)} → ${outRate.toFixed(1)}/s`} tone={inRate > capacity + 0.3 ? 'bad' : 'ok'} sub={`capacity ${capacity.toFixed(0)}/s (${st.active} consumers)`} />
          <Stat label="Backlog · oldest age" value={`${backlog} · ${age.toFixed(1)} s`} tone={age > 5 ? 'bad' : age > 2 ? 'warn' : 'ok'} sub="queue lag" />
          <Stat label="Done · DLQ" value={`${st.done} · ${st.dlq}`} tone={st.dlq ? 'warn' : undefined} />
          <Stat label={ack === 'after' ? 'Duplicates' : 'Lost'} value={ack === 'after' ? st.dup : st.lost} tone={(ack === 'after' ? st.dup : st.lost) ? 'bad' : 'ok'} sub={`dup ${st.dup} · lost ${st.lost} (all time)`} />
        </>
      }
      insight={lines.join(' ')}
    >
      <svg viewBox="0 0 560 220" className="w-full">
        <rect x={8} y={72} width={70} height={46} rx={8} fill="rgb(var(--c-surface))" stroke="rgb(var(--c-accent))" strokeWidth={1.5} />
        <text x={43} y={92} textAnchor="middle" className="fill-ink font-mono text-[11px] font-semibold">
          producers
        </text>
        <text x={43} y={107} textAnchor="middle" className="fill-faint font-mono text-[9px]">
          {rate} msg/s
        </text>
        <rect x={qx - 6} y={qy - 22} width={10 * cell + 10} height={5 * cell + 28} rx={8} fill="rgb(var(--c-surface) / 0.6)" stroke="rgb(var(--c-line))" />
        <text x={qx} y={qy - 9} className="fill-muted font-mono text-[9.5px]">
          queue · {st.queue.length} visible
          {st.queue.length > 50 && <tspan className="fill-bad"> (+{st.queue.length - 50} not drawn)</tspan>}
        </text>
        <rect x={qx - 6} y={158} width={10 * cell + 10} height={36} rx={8} fill="none" stroke="rgb(var(--c-warn) / 0.6)" strokeDasharray="4 3" />
        <text x={qx} y={168} className="fill-warn font-mono text-[9px]">
          invisible · waiting for retry ({st.invisible.length})
        </text>
        <text x={qx} y={210} className="fill-faint font-mono text-[9px]">
          ■ new <tspan className="fill-warn">■ redelivery</tspan> <tspan className="fill-bad">■ poison</tspan>
        </text>
        {st.cs.map((c, i) => {
          const down = c.downUntil > st.t;
          const on = i < st.active || c.msg;
          return (
            <g key={i} opacity={on ? 1 : 0.25}>
              <rect x={cxL - 30} y={cy(i)} width={100} height={18} rx={4} fill="rgb(var(--c-surface))" stroke={down ? 'rgb(var(--c-bad))' : 'rgb(var(--c-line))'} />
              <text x={cxL - 25} y={cy(i) + 12.5} className={cn('font-mono text-[9px]', down ? 'fill-bad' : 'fill-muted')}>
                C{i + 1}
              </text>
              {down && (
                <text x={cxL + 12} y={cy(i) + 12.5} className="fill-bad font-mono text-[9px]">
                  crashed
                </text>
              )}
              {c.msg && <rect x={cxL + 52} y={cy(i) + 13} width={14 * (1 - c.left / PROC_TICKS)} height={3} fill="rgb(var(--c-ok))" />}
            </g>
          );
        })}
        {(['done', 'dlq', 'lost'] as Dest[]).map((d) => (
          <g key={d}>
            <rect x={DEST[d][0] - 34} y={DEST[d][1] - 18} width={68} height={36} rx={8} fill="rgb(var(--c-surface))" stroke={d === 'done' ? 'rgb(var(--c-ok))' : 'rgb(var(--c-bad))'} strokeDasharray={d === 'done' ? undefined : '4 3'} />
            <text x={DEST[d][0]} y={DEST[d][1] + 30} textAnchor="middle" className={cn('font-mono text-[9.5px]', d === 'done' ? 'fill-ok' : 'fill-bad')}>
              {d === 'done' ? `acked ${st.done}` : d === 'dlq' ? `DLQ ${st.dlq}` : `lost ${st.lost}`}
            </text>
          </g>
        ))}
        {placed.map(({ m, x, y, tone: t, fade }) => (
          <motion.rect
            key={m.id}
            width={15}
            height={15}
            rx={3}
            fill={`rgb(var(${t}))`}
            initial={{ x: 70, y: 88, opacity: 0 }}
            animate={{ x, y, opacity: fade ? 0 : 0.9 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          />
        ))}
      </svg>
      <svg viewBox="0 0 560 104" className="w-full">
        <line x1={20} y1={92} x2={540} y2={92} stroke="rgb(var(--c-line))" />
        <polyline points={line((h) => h.backlog, maxB)} fill="none" stroke="rgb(var(--c-accent))" strokeWidth={1.8} />
        <polyline points={line((h) => h.age, maxA)} fill="none" stroke="rgb(var(--c-warn))" strokeWidth={1.4} strokeDasharray="4 2" />
        <polyline points={line((h) => h.consumers, 10)} fill="none" stroke="rgb(var(--c-info))" strokeWidth={1.4} />
        <text x={22} y={10} className="fill-accent font-mono text-[9px]">
          backlog (max {maxB})
        </text>
        <text x={160} y={10} className="fill-warn font-mono text-[9px]">
          oldest-message age (max {maxA.toFixed(1)} s)
        </text>
        <text x={370} y={10} className="fill-info font-mono text-[9px]">
          consumers (0–10)
        </text>
        <text x={538} y={102} textAnchor="end" className="fill-faint font-mono text-[8.5px]">
          last {HIST / 10} s
        </text>
      </svg>
      <div className="flex flex-wrap items-center gap-2 px-1 pb-1">
        <Button size="xs" variant="secondary" icon={<Zap size={11} />} onClick={crash}>
          crash a consumer
        </Button>
        <span className="text-[11px] text-muted">
          {ack === 'after' ? 'at-least-once: an un-acked message is redelivered after the visibility timeout → possible duplicates' : 'at-most-once: deleted on receive → a crash loses the in-flight message'}
        </span>
        <span className="ml-auto text-[11px] text-faint">
          Partitions, consumer groups and offsets →{' '}
          <Link to="/kafka" className="text-accent underline">
            Kafka module
          </Link>
        </span>
      </div>
    </LabFrame>
  );
}
