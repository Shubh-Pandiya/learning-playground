import { useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { LabFrame, pct, rng, Seg, Slider, Stat, useTicker } from './kit';

type Mode = 'wm' | 'cp';
type Fate = 'on-time' | 'late-ok' | 'side';

const WIN = 5; // tumbling event-time windows of 5 s
const RATE = 4; // events per second
const SPAN = 32; // seconds of event time on screen

interface Ev {
  id: number;
  et: number;
  delay: number;
  fate: Fate;
  lane: number;
}
interface Win {
  count: number;
  firedAt: number | null;
  late: number;
}

function freshWm() {
  return { t: SPAN, acc: 0, id: 0, evs: [] as Ev[], wins: new Map<number, Win>(), maxTs: SPAN, fired: 0, lateOk: 0, side: 0, lat: [] as number[], delays: [] as number[], log: [] as { text: string; tone: string }[], rand: rng(5) };
}

function Watermarks({ mode }: { mode: ReactNode }) {
  const [disorder, setDisorder] = useState(4);
  const [wmDelay, setWmDelay] = useState(2);
  const [lateness, setLateness] = useState(0);
  const [running, setRunning] = useState(true);
  const [, force] = useState(0);
  const s = useRef(freshWm());

  useTicker(running, 100, () => {
    const st = s.current;
    st.t += 0.1;
    st.acc += RATE / 10;
    while (st.acc >= 1) {
      st.acc -= 1;
      // most events are a little late; a few (phones coming back online) are very late
      let delay = disorder * st.rand() ** 2;
      if (disorder > 0 && st.rand() < 0.03) delay += disorder + st.rand() * 6;
      const et = st.t - delay;
      st.maxTs = Math.max(st.maxTs, et);
      const wm = st.maxTs - wmDelay;
      const start = Math.floor(et / WIN) * WIN;
      const w = st.wins.get(start) ?? { count: 0, firedAt: null, late: 0 };
      let fate: Fate = 'on-time';
      if (start + WIN + lateness <= wm) {
        fate = 'side';
        st.side++;
        st.log = [{ text: `side output: event ts=${et.toFixed(1)} for [${start},${start + WIN}) arrived after watermark ${wm.toFixed(1)} passed end + lateness`, tone: 'text-bad' }, ...st.log].slice(0, 5);
      } else {
        st.wins.set(start, w);
        w.count++;
        if (w.firedAt !== null) {
          fate = 'late-ok';
          w.late++;
          st.lateOk++;
          st.log = [{ text: `[${start},${start + WIN}) re-fired: count=${w.count} (late event, within allowed lateness)`, tone: 'text-warn' }, ...st.log].slice(0, 5);
        }
      }
      st.delays = [...st.delays, delay].slice(-300);
      st.evs.push({ id: st.id++, et, delay, fate, lane: fate === 'side' ? st.side % 2 : Math.min(w.count - 1, 21) });
    }
    const wm = st.maxTs - wmDelay;
    for (const [start, w] of st.wins) {
      if (w.firedAt === null && start + WIN <= wm) {
        w.firedAt = st.t;
        st.fired++;
        st.lat = [...st.lat, st.t - (start + WIN)].slice(-20);
        st.log = [{ text: `[${start},${start + WIN}) fired: count=${w.count}, ${(st.t - start - WIN).toFixed(1)} s after the window ended`, tone: 'text-ok' }, ...st.log].slice(0, 5);
      }
      if (start + WIN + lateness <= wm && start < st.t - SPAN - 10) st.wins.delete(start);
    }
    st.evs = st.evs.filter((e) => e.et > st.t - SPAN - 2);
    force((x) => x + 1);
  });

  const st = s.current;
  const wm = st.maxTs - wmDelay;
  const left = st.t - SPAN + 2;
  const x = (et: number) => 20 + ((et - left) / (SPAN + 1)) * 520;
  const starts: number[] = [];
  for (let w = Math.floor(left / WIN) * WIN; w < st.t + 1; w += WIN) starts.push(w);
  const p95 = pct(st.delays, 0.95);
  const avgLat = st.lat.length ? st.lat.reduce((a, b) => a + b, 0) / st.lat.length : 0;

  const lines: string[] = [];
  if (st.side) lines.push(`${st.side} event(s) arrived after the watermark had passed their window's end + allowed lateness, so Flink sent them to the side output (sideOutputLateData) instead of the window. Raise allowed lateness (keeps window state longer and re-fires with updates) or the watermark delay (every result waits longer).`);
  if (st.lateOk) lines.push(`${st.lateOk} late event(s) landed within allowed lateness: their window had already fired, so it fired again with a corrected count. Downstream must treat results as upserts (keyed sink or retractions), not appends.`);
  if (wmDelay > p95 + 1 && disorder > 0) lines.push(`Watermark delay ${wmDelay}s is above the observed p95 disorder (${p95.toFixed(1)}s): almost nothing is late, but every window waits ~${wmDelay}s after it ends. The delay is latency you pay on every result, even when no event is late.`);
  if (disorder === 0) lines.push('In-order stream: the watermark could follow the max timestamp with zero delay and windows would fire the moment they end. Real sources (mobile, multi-partition Kafka, retries) are never this tidy.');
  if (!lines.length) lines.push(`The watermark (blue) trails the max event time seen by ${wmDelay}s and claims "nothing older will arrive". A window fires when the watermark passes its end. Set the delay near the p95 disorder (${p95.toFixed(1)}s now) and handle the tail with allowed lateness + a side output.`);

  return (
    <LabFrame
      title="Flink: event-time windows and watermarks"
      goal="Events arrive out of order. Turn up the disorder, then trade watermark delay against allowed lateness and watch windows fire, re-fire, or push events to the side output."
      running={running}
      onToggle={() => setRunning((r) => !r)}
      onReset={() => ((s.current = freshWm()), force((x) => x + 1))}
      controls={
        <>
          {mode}
          <Slider label="How out-of-order events arrive" value={disorder} min={0} max={10} onChange={setDisorder} fmt={(v) => `up to ${v} s (+ rare stragglers)`} />
          <Slider label="Watermark delay (max out-of-orderness)" value={wmDelay} min={0} max={10} onChange={setWmDelay} fmt={(v) => `${v} s`} />
          <Slider label="Allowed lateness" value={lateness} min={0} max={15} onChange={setLateness} fmt={(v) => `${v} s`} />
        </>
      }
      stats={
        <>
          <Stat label="Windows fired" value={st.fired} tone="ok" sub={`tumbling ${WIN} s`} />
          <Stat label="Late, accepted" value={st.lateOk} tone={st.lateOk ? 'warn' : undefined} sub="window re-fired" />
          <Stat label="Side output" value={st.side} tone={st.side ? 'bad' : 'ok'} sub="too late, not in result" />
          <Stat label="Result latency" value={`${avgLat.toFixed(1)} s`} tone={avgLat > 5 ? 'warn' : 'ok'} sub={`after window end · p95 disorder ${p95.toFixed(1)} s`} />
        </>
      }
      insight={lines.join(' ')}
    >
      <svg viewBox="0 0 560 222" className="w-full">
        {starts.map((w) => {
          const win = st.wins.get(w);
          const purged = w + WIN + lateness <= wm;
          const fired = win?.firedAt != null;
          return (
            <g key={w}>
              <rect x={x(w) + 1} y={24} width={x(w + WIN) - x(w) - 2} height={140} rx={4} fill={purged ? 'rgb(var(--c-line) / 0.25)' : fired ? 'rgb(var(--c-ok) / 0.1)' : 'rgb(var(--c-surface))'} stroke={fired && !purged ? 'rgb(var(--c-ok) / 0.6)' : 'rgb(var(--c-line))'} />
              <text x={(x(w) + x(w + WIN)) / 2} y={36} textAnchor="middle" className={cn('font-mono text-[8.5px]', fired ? 'fill-ok' : 'fill-muted')}>
                [{w},{w + WIN})
              </text>
              <text x={(x(w) + x(w + WIN)) / 2} y={176} textAnchor="middle" className={cn('font-mono text-[8px]', purged ? 'fill-faint' : fired ? 'fill-ok' : 'fill-muted')}>
                {!win ? (purged ? '' : 'open n=0') : purged ? `n=${win.count} · closed` : fired ? `fired n=${win.count}` : `open n=${win.count}`}
                {win?.late ? <tspan className="fill-warn"> +{win.late}</tspan> : null}
              </text>
            </g>
          );
        })}
        {st.evs.map((e) => (
          <motion.circle
            key={e.id}
            cx={x(e.et)}
            r={2.6}
            fill={`rgb(var(${e.fate === 'side' ? '--c-bad' : e.fate === 'late-ok' ? '--c-warn' : '--c-accent'}) / 0.9)`}
            initial={{ cy: 12 }}
            animate={{ cy: e.fate === 'side' ? 191 + e.lane * 6 : 158 - e.lane * 6 }}
            transition={{ duration: 0.4 }}
          />
        ))}
        <line x1={x(st.maxTs)} x2={x(st.maxTs)} y1={14} y2={170} stroke="rgb(var(--c-faint))" strokeDasharray="2 3" />
        <line x1={x(wm)} x2={x(wm)} y1={14} y2={170} stroke="rgb(var(--c-info))" strokeWidth={2} />
        <text x={x(wm) - 3} y={12} textAnchor="end" className="fill-info font-mono text-[8.5px]">
          watermark {wm.toFixed(1)}
        </text>
        <text x={x(st.maxTs) + 3} y={12} className="fill-faint font-mono text-[8.5px]">
          max ts
        </text>
        <rect x={18} y={183} width={524} height={36} rx={5} fill="rgb(var(--c-bad) / 0.05)" stroke="rgb(var(--c-bad) / 0.5)" strokeDasharray="4 3" />
        <text x={536} y={215} textAnchor="end" className="fill-bad font-mono text-[8.5px]">
          side output (late beyond allowed lateness): {st.side}
        </text>
      </svg>
      <div className="space-y-0.5 px-1 pb-1 font-mono text-[10px]">
        {st.log.map((l, i) => (
          <div key={i} className={cn(l.tone, i > 0 && 'opacity-60')}>
            {l.text}
          </div>
        ))}
        <div className="text-faint">
          x-axis = event time · <span className="text-accent">● on time</span> <span className="text-warn">● late, within lateness</span> <span className="text-bad">● side output</span>
        </div>
      </div>
    </LabFrame>
  );
}

// ---------------- checkpoint barriers ----------------

type Sink = '2pc' | 'plain';
const SPEED = 5; // channel position per tick (0 → 50 operator → 100 sink)
const REC_EVERY = 3; // a record every 3 ticks
const DOWN = 20; // restart takes 2 s

interface Item {
  kind: 'rec' | 'bar';
  id: number;
  pos: number;
  readAt: number;
}
interface Snap {
  cp: number;
  offset: number;
  count?: number;
}

function freshCp() {
  return {
    t: 0,
    offset: 0,
    count: 0,
    items: [] as Item[],
    nextCp: 1,
    lastCpT: 0,
    inflight: new Map<number, Snap>(),
    done: [] as Snap[],
    txn: [] as Item[],
    out: [] as { id: number; dup: boolean }[],
    seen: new Set<number>(),
    dups: 0,
    lat: [] as number[],
    downUntil: 0,
    aborted: 0,
    replayed: 0,
    msg: 'waiting for the first checkpoint',
    crashMsg: '',
  };
}

function Checkpoints({ mode }: { mode: ReactNode }) {
  const [interval, setIntervalS] = useState(3);
  const [sink, setSink] = useState<Sink>('2pc');
  const [running, setRunning] = useState(true);
  const [, force] = useState(0);
  const s = useRef(freshCp());

  const emit = (it: Item) => {
    const st = s.current;
    const dup = st.seen.has(it.id);
    st.seen.add(it.id);
    if (dup) st.dups++;
    st.out = [...st.out, { id: it.id, dup }].slice(-64);
    st.lat = [...st.lat, (st.t - it.readAt) / 10].slice(-30);
  };

  useTicker(running, 100, () => {
    const st = s.current;
    st.t++;
    if (st.t < st.downUntil) return force((x) => x + 1);
    if (st.t % REC_EVERY === 0) st.items.push({ kind: 'rec', id: st.offset++, pos: 0, readAt: st.t });
    if (st.t - st.lastCpT >= interval * 10) {
      const cp = st.nextCp++;
      st.inflight.set(cp, { cp, offset: st.offset }); // source snapshots its Kafka offset
      st.items.push({ kind: 'bar', id: cp, pos: 0, readAt: st.t });
      st.lastCpT = st.t;
    }
    for (const it of st.items) {
      const prev = it.pos;
      it.pos += SPEED;
      if (prev < 50 && it.pos >= 50) {
        if (it.kind === 'rec') st.count++;
        else st.inflight.get(it.id)!.count = st.count; // operator snapshots its state
      }
      if (it.pos >= 100) {
        if (it.kind === 'rec') {
          if (sink === 'plain') emit(it);
          else st.txn.push(it); // written into the open Kafka transaction, invisible to read_committed
        } else {
          // sink pre-commits; all tasks acked → checkpoint complete → commit
          const snap = st.inflight.get(it.id)!;
          st.inflight.delete(it.id);
          st.done = [...st.done, snap].slice(-4);
          if (sink === '2pc') {
            st.txn.forEach(emit);
            st.txn = [];
          }
          st.msg = `checkpoint ${snap.cp} complete: source offset ${snap.offset}, operator count ${snap.count}${sink === '2pc' ? ', transaction committed' : ''}`;
        }
      }
    }
    st.items = st.items.filter((it) => it.pos < 100);
    force((x) => x + 1);
  });

  const crash = () => {
    const st = s.current;
    const last = st.done[st.done.length - 1] ?? { cp: 0, offset: 0, count: 0 };
    st.replayed = st.offset - last.offset;
    st.aborted = st.txn.length;
    st.crashMsg = `crash at offset ${st.offset} → restore checkpoint ${last.cp} (offset ${last.offset}, count ${last.count}) → replay ${st.replayed} records${sink === '2pc' ? `, abort open transaction (${st.aborted} uncommitted records)` : `; ${st.out.filter((o) => o.id >= last.offset).length} already written by the plain sink`}`;
    st.items = [];
    st.txn = [];
    st.inflight.clear();
    st.offset = last.offset;
    st.count = last.count ?? 0;
    st.downUntil = st.t + DOWN;
    st.lastCpT = st.t + DOWN;
    force((x) => x + 1);
  };

  const st = s.current;
  const down = st.t < st.downUntil;
  const px = (pos: number) => (pos < 50 ? 92 + (pos / 50) * 140 : 332 + ((pos - 50) / 50) * 136);
  const last = st.done[st.done.length - 1];
  const avgLat = st.lat.length ? st.lat.reduce((a, b) => a + b, 0) / st.lat.length : 0;

  const lines: string[] = [];
  if (st.dups && sink === 'plain') lines.push(`The plain sink wrote records as they arrived. After the crash Flink rewound the source to the checkpoint offset and replayed them, so ${st.dups} record${st.dups === 1 ? " was" : "s were"} written twice. Flink's internal state is exactly-once either way; the output is only at-least-once.`);
  if (sink === '2pc' && st.replayed) lines.push(`After the crash the open transaction was aborted${st.aborted ? `, so its ${st.aborted} uncommitted records never became visible` : ''}, and the ${st.replayed} replayed records were written again inside a new transaction: 0 duplicates. Two-phase commit: pre-commit on the barrier, commit only once the checkpoint is complete.`);
  if (sink === '2pc') lines.push(`The price: output becomes visible only when a checkpoint completes, so read_committed consumers see results ~${interval}s late (latency ${avgLat.toFixed(1)}s). Shorter intervals cut latency but snapshot state more often.`);
  else if (!st.dups) lines.push('Barriers (violet) flow in-line with records. When one passes an operator it snapshots its state; when all sinks ack, the checkpoint is complete and stores (source offset, state) together. Press "crash" to see what a plain sink does on replay.');
  lines.push('With several input channels an operator aligns barriers (waits for the barrier on every input) so the snapshot is consistent; unaligned checkpoints store in-flight records instead.');

  return (
    <LabFrame
      title="Flink: checkpoint barriers and exactly-once sinks"
      goal="Barriers flow from source to sink and turn (offset, state) into a consistent snapshot. Crash the job with each sink type and compare the output."
      running={running}
      onToggle={() => setRunning((r) => !r)}
      onReset={() => ((s.current = freshCp()), force((x) => x + 1))}
      controls={
        <>
          {mode}
          <Slider label="Checkpoint interval" value={interval} min={1} max={8} onChange={setIntervalS} fmt={(v) => `${v} s`} />
          <Seg
            label="Sink"
            value={sink}
            options={[
              { value: '2pc', label: 'transactional (2PC)', hint: 'KafkaSink EXACTLY_ONCE / Iceberg commit on checkpoint' },
              { value: 'plain', label: 'plain append', hint: 'writes immediately, never rolls back' },
            ]}
            onChange={(v) => {
              setSink(v);
              s.current = freshCp();
            }}
          />
          <div className="flex items-end">
            <Button size="xs" variant="danger" icon={<Zap size={12} />} disabled={down} onClick={crash}>
              crash now
            </Button>
          </div>
        </>
      }
      stats={
        <>
          <Stat label="Checkpoints done" value={last?.cp ?? 0} sub={last ? `last: offset ${last.offset}` : 'none yet'} />
          <Stat label="Replayed on restore" value={st.replayed} tone={st.replayed ? 'warn' : undefined} sub="records re-read from Kafka" />
          <Stat label="Duplicates in output" value={st.dups} tone={st.dups ? 'bad' : 'ok'} sub={`${st.out.length ? st.seen.size : 0} distinct records out`} />
          <Stat label="Visibility latency" value={`${avgLat.toFixed(1)} s`} tone={avgLat > 3 ? 'warn' : 'ok'} sub="read → visible downstream" />
        </>
      }
      insight={lines.join(' ')}
    >
      <svg viewBox="0 0 560 120" className="w-full">
        {[
          { x: 10, label: 'Kafka source', sub: `offset ${st.offset}` },
          { x: 232, label: 'window / count', sub: `state count=${st.count}` },
          { x: 468, label: sink === '2pc' ? '2PC sink' : 'plain sink', sub: sink === '2pc' ? `open txn: ${st.txn.length}` : 'writes now' },
        ].map((b) => (
          <g key={b.x}>
            <rect x={b.x} y={34} width={b.x === 232 ? 100 : 82} height={40} rx={7} fill="rgb(var(--c-surface))" stroke={down ? 'rgb(var(--c-bad))' : 'rgb(var(--c-accent))'} strokeWidth={1.4} />
            <text x={b.x + (b.x === 232 ? 50 : 41)} y={51} textAnchor="middle" className="fill-ink font-mono text-[9.5px] font-semibold">
              {b.label}
            </text>
            <text x={b.x + (b.x === 232 ? 50 : 41)} y={65} textAnchor="middle" className="fill-muted font-mono text-[8.5px]">
              {b.sub}
            </text>
          </g>
        ))}
        <line x1={92} x2={232} y1={54} y2={54} stroke="rgb(var(--c-line))" />
        <line x1={332} x2={468} y1={54} y2={54} stroke="rgb(var(--c-line))" />
        {st.items.map((it) =>
          it.kind === 'rec' ? (
            <rect key={`r${it.id}-${it.readAt}`} x={px(it.pos) - 4} y={50} width={8} height={8} rx={2} fill="rgb(var(--c-accent) / 0.85)" />
          ) : (
            <g key={`b${it.id}`}>
              <line x1={px(it.pos)} x2={px(it.pos)} y1={36} y2={72} stroke="rgb(var(--c-violet))" strokeWidth={2.5} />
              <text x={px(it.pos)} y={30} textAnchor="middle" className="fill-violet font-mono text-[8.5px]">
                cp{it.id}
              </text>
            </g>
          ),
        )}
        {down && (
          <motion.text x={280} y={104} textAnchor="middle" className="fill-bad font-mono text-[14px] font-bold" initial={{ opacity: 0 }} animate={{ opacity: 0.9 }}>
            CRASHED · restoring checkpoint {last?.cp ?? 0}
          </motion.text>
        )}
        {!down && (
          <text x={10} y={104} className="fill-faint font-mono text-[9px]">
            checkpoint storage: {st.done.length ? st.done.map((d) => `cp${d.cp}{offset ${d.offset}, count ${d.count}}`).join('  ') : 'empty'}
          </text>
        )}
      </svg>
      <div className="px-1 pb-1">
        <div className="mb-1 font-mono text-[10px] text-muted">{st.msg}</div>
        {st.crashMsg && <div className={cn('mb-1 font-mono text-[10px]', down ? 'text-bad' : 'text-warn')}>{st.crashMsg}</div>}
        <div className="eyebrow mb-1">output visible to downstream (record = source offset)</div>
        <div className="flex flex-wrap gap-0.5">
          {st.out.map((o, i) => (
            <span key={i} className={cn('w-7 rounded-sm border text-center font-mono text-[9px]', o.dup ? 'border-bad bg-bad/15 text-bad' : 'border-ok/40 bg-ok/10 text-ink')}>
              {o.id}
            </span>
          ))}
          {st.txn.map((it) => (
            <span key={`t${it.id}`} className="w-7 rounded-sm border border-dashed border-line text-center font-mono text-[9px] text-faint" title="in the open transaction: not visible yet">
              {it.id}
            </span>
          ))}
        </div>
      </div>
    </LabFrame>
  );
}

export default function FlinkLab() {
  const [mode, setMode] = useState<Mode>('wm');
  const seg = (
    <Seg
      label="Mechanism"
      value={mode}
      options={[
        { value: 'wm', label: 'watermarks & windows' },
        { value: 'cp', label: 'checkpoint barriers' },
      ]}
      onChange={setMode}
    />
  );
  return mode === 'wm' ? <Watermarks mode={seg} /> : <Checkpoints mode={seg} />;
}
