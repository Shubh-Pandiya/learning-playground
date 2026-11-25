import { useMemo, useState } from 'react';
import { cn } from '@/shared/cn';
import { hash32, LabFrame, pct, rng, Seg, Stat, useTicker } from './kit';

type Skew = 'uniform' | 'hot';
type Join = 'smj' | 'bhj';
type Kind = 'normal' | 'hot' | 'split' | 'coalesced';

const SLOTS = 16; // 4 executors x 4 cores
const FACT_MB = 8 * 1024; // orders after the filter: the side that shuffles in a sort-merge join
const SCAN_TASKS = 128; // 16 GB of Parquet / 128 MB splits
const RATE = 64; // MB/s one core can fetch + sort + merge
const OVERHEAD = 0.25; // s per task: scheduling, launch, shuffle-fetch setup
const HOT_FRAC = 0.3; // one customer_id owns 30% of the rows (a test account, a null key, a marketplace's own store)
const ADVISORY = 64; // MB: spark.sql.adaptive.advisoryPartitionSizeInBytes
const SKEW_MIN = 256; // MB: skewedPartitionThresholdInBytes
const SKEW_FACTOR = 5; // skewedPartitionFactor (x median)
const BCAST_LIMIT = 10; // MB: spark.sql.autoBroadcastJoinThreshold
const MEM_PER_TASK = 512; // MB of execution memory per core before the sort spills
const SPILL = 1.6;
const SIM_PER_TICK = 0.5; // simulated seconds per 100 ms

interface Task {
  mb: number;
  kind: Kind;
  spill: boolean;
  dur: number;
  start: number;
  end: number;
  slot: number;
}

function plan(parts: number, skew: Skew, aqe: boolean, join: Join, dimMb: number) {
  const broadcast = join === 'bhj' && dimMb <= BCAST_LIMIT;
  const r = rng(7 + parts);
  const hotIdx = hash32('customer_id=0') % parts;
  let sizes: { mb: number; kind: Kind }[];
  let shuffleMb: number;
  if (broadcast) {
    // join already happened map-side; partial aggregation collapses each key to one row per map task
    shuffleMb = FACT_MB * 0.04;
    sizes = Array.from({ length: parts }, () => ({ mb: (shuffleMb / parts) * (0.85 + r() * 0.3), kind: 'normal' as Kind }));
  } else {
    const hot = skew === 'hot' ? HOT_FRAC : 0;
    shuffleMb = FACT_MB + dimMb;
    const base = (FACT_MB * (1 - hot) + dimMb) / parts;
    sizes = Array.from({ length: parts }, (_, i) => ({
      mb: base * (0.85 + r() * 0.3) + (i === hotIdx ? FACT_MB * hot : 0),
      kind: (i === hotIdx && hot ? 'hot' : 'normal') as Kind,
    }));
  }
  const median = pct(sizes.map((s) => s.mb), 0.5);
  let splitInto = 0;
  let hotNotSplit = false;
  if (aqe) {
    if (!broadcast)
      sizes = sizes.flatMap((s) => {
        if (s.mb > SKEW_MIN && s.mb > SKEW_FACTOR * median) {
          const n = Math.ceil(s.mb / ADVISORY);
          splitInto += n;
          return Array.from({ length: n }, () => ({ mb: s.mb / n, kind: 'split' as Kind }));
        }
        if (s.kind === 'hot') hotNotSplit = true;
        return [s];
      });
    // coalesce neighbouring small partitions up to the advisory size
    const out: { mb: number; kind: Kind }[] = [];
    let cur: { mb: number; kind: Kind } | null = null;
    for (const s of sizes) {
      if (s.kind === 'split' || s.kind === 'hot') {
        if (cur) out.push(cur);
        cur = null;
        out.push(s);
      } else if (cur && cur.mb + s.mb <= ADVISORY) cur = { mb: cur.mb + s.mb, kind: 'coalesced' };
      else {
        if (cur) out.push(cur);
        cur = { ...s };
      }
    }
    if (cur) out.push(cur);
    sizes = out;
  }
  // list scheduling: each task goes to the first free core, in partition order
  const free = Array<number>(SLOTS).fill(0);
  const tasks: Task[] = sizes.map((s) => {
    const spill = !broadcast && s.mb > MEM_PER_TASK;
    const dur = OVERHEAD + (s.mb / RATE) * (spill ? SPILL : 1);
    let slot = 0;
    for (let i = 1; i < SLOTS; i++) if (free[i] < free[slot]) slot = i;
    const start = free[slot];
    free[slot] = start + dur;
    return { ...s, spill, dur, start, end: start + dur, slot };
  });
  const makespan = Math.max(...tasks.map((t) => t.end));
  return { broadcast, tasks, makespan, shuffleMb, splitInto, hotNotSplit, median, hotIdx };
}

const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);
const sec = (s: number) => (s >= 10 ? `${s.toFixed(0)} s` : `${s.toFixed(1)} s`);

type DagNode = { id: string; label: string; x: number; y: number; stage: number };

function dag(broadcast: boolean, scanTasks: number, dimTasks: number, reduceTasks: number) {
  const nodes: DagNode[] = broadcast
    ? [
        { id: 'c', label: 'scan customers', x: 14, y: 96, stage: 0 },
        { id: 'o', label: 'scan orders', x: 14, y: 26, stage: 1 },
        { id: 'f', label: "filter paid", x: 108, y: 26, stage: 1 },
        { id: 'j', label: 'broadcast join', x: 202, y: 26, stage: 1 },
        { id: 'p', label: 'partial agg', x: 296, y: 26, stage: 1 },
        { id: 'a', label: 'final agg', x: 384, y: 61, stage: 2 },
        { id: 'w', label: 'write', x: 472, y: 61, stage: 2 },
      ]
    : [
        { id: 'o', label: 'scan orders', x: 14, y: 26, stage: 0 },
        { id: 'f', label: 'filter paid', x: 108, y: 26, stage: 0 },
        { id: 'c', label: 'scan customers', x: 14, y: 96, stage: 1 },
        { id: 'j', label: 'sort-merge join', x: 290, y: 61, stage: 2 },
        { id: 'a', label: 'agg by key', x: 384, y: 61, stage: 2 },
        { id: 'w', label: 'write', x: 472, y: 61, stage: 2 },
      ];
  const edges: [string, string, 'narrow' | 'shuffle' | 'broadcast'][] = broadcast
    ? [['o', 'f', 'narrow'], ['f', 'j', 'narrow'], ['c', 'j', 'broadcast'], ['j', 'p', 'narrow'], ['p', 'a', 'shuffle'], ['a', 'w', 'narrow']]
    : [['o', 'f', 'narrow'], ['f', 'j', 'shuffle'], ['c', 'j', 'shuffle'], ['j', 'a', 'narrow'], ['a', 'w', 'narrow']];
  const tasksOf = broadcast ? [dimTasks, scanTasks, reduceTasks] : [scanTasks, dimTasks, reduceTasks];
  return { nodes, edges, tasksOf };
}

export default function SparkLab() {
  const [parts, setParts] = useState(64);
  const [skew, setSkew] = useState<Skew>('hot');
  const [aqe, setAqe] = useState(false);
  const [join, setJoin] = useState<Join>('smj');
  const [dimMb, setDimMb] = useState(8);
  const [running, setRunning] = useState(true);
  const [t, setT] = useState(0);
  const restart = <T,>(f: (v: T) => void) => (v: T) => {
    f(v);
    setT(0);
  };

  const p = useMemo(() => plan(parts, skew, aqe, join, dimMb), [parts, skew, aqe, join, dimMb]);
  const noAqe = useMemo(() => plan(parts, skew, false, join, dimMb), [parts, skew, join, dimMb]);
  useTicker(running, 100, () => setT((x) => (x > p.makespan + 2.5 ? 0 : x + SIM_PER_TICK)));

  const durs = p.tasks.map((k) => k.dur);
  const med = pct(durs, 0.5);
  const slowest = Math.max(...durs);
  const busy = p.tasks.filter((k) => k.start <= t && t < k.end).length;
  const done = p.tasks.filter((k) => k.end <= t).length;
  const waves = Math.ceil(p.tasks.length / SLOTS);
  const dimTasks = Math.max(1, Math.ceil(dimMb / 128));
  const g = dag(p.broadcast, SCAN_TASKS, dimTasks, p.tasks.length);
  const hot = p.tasks.find((k) => k.kind === 'hot');

  const lines: string[] = [];
  if (join === 'bhj' && !p.broadcast)
    lines.push(`customers is ${gb(dimMb)}, over spark.sql.autoBroadcastJoinThreshold (${BCAST_LIMIT} MB), so the planner keeps a sort-merge join. A /*+ BROADCAST(c) */ hint forces it, but the table is collected to the driver and copied to every executor: fine at 100 MB, an OOM at several GB.`);
  if (p.broadcast)
    lines.push(`Broadcast hash join: the ${gb(dimMb)} customers table is shipped once to every executor and the join runs inside the map stage, so the ${gb(FACT_MB)} orders side never shuffles. Only partial aggregates (${gb(p.shuffleMb)}) cross the network, and ${skew === 'hot' ? 'the hot key collapses to one row per map task, so skew disappears' : 'there is one stage boundary fewer'}.`);
  else if (skew === 'hot' && hot)
    lines.push(`One customer_id holds ${HOT_FRAC * 100}% of the rows and hash partitioning sends all of them to partition #${p.hotIdx}. That one task reads ${gb(hot.mb)} and runs ${sec(hot.dur)} while the median task takes ${sec(med)}: the stage waits on the straggler while ${SLOTS - 1} cores sit idle. More partitions don't help, because the hot key still lands in a single partition.${p.hotNotSplit ? ` AQE didn't split it: with only ${parts} partitions the median is already ${gb(p.median)}, so the hot one is under ${SKEW_FACTOR}x median. Huge uniform partitions aren't "skewed", they're just too big.` : ''}`);
  else if (p.splitInto)
    lines.push(`AQE read the real shuffle map-output sizes at runtime, found partition #${p.hotIdx} over ${SKEW_FACTOR}x the median and over ${SKEW_MIN} MB, and split it into ${p.splitInto} tasks (violet), each joined against a copy of the matching customers partition. Stage time drops from ${sec(noAqe.makespan)} to ${sec(p.makespan)}. Salting the key by hand does the same thing without AQE.`);
  if (!p.broadcast && p.tasks.some((k) => k.spill))
    lines.push(`Partitions over ~${MEM_PER_TASK} MB don't fit in a core's execution memory, so the sort spills runs to local disk (about ${SPILL}x slower)${parts < SLOTS ? ` and only ${parts} of ${SLOTS} cores get a task` : ''}. Rule of thumb: aim for 100–200 MB per shuffle partition.`);
  if (!aqe && parts >= 200 && !(skew === 'hot' && !p.broadcast))
    lines.push(`${parts} tasks in ${waves} waves: per-task overhead (${OVERHEAD}s of scheduling and fetch setup) is ${Math.round((OVERHEAD / med) * 100)}% of a median task. Turn on AQE to coalesce small partitions toward ${ADVISORY} MB.`);
  if (aqe && p.tasks.length < parts && !p.splitInto) lines.push(`AQE coalesced ${parts} shuffle partitions into ${p.tasks.length} tasks of up to ${ADVISORY} MB, cutting scheduling overhead without you tuning spark.sql.shuffle.partitions per job.`);
  if (!lines.length) lines.push(`Uniform keys, ${parts} partitions of ~${gb(p.median)}: tasks finish together and stage time is roughly total work / ${SLOTS} cores. Switch skew to "one hot key" to see a straggler.`);

  // layout of the task chart
  const BW = 520 / p.tasks.length;
  const maxD = Math.max(...durs, 1);
  const BH = 96;
  const tx = (s: number) => 20 + (s / Math.max(p.makespan, 0.001)) * 520;

  return (
    <LabFrame
      title="Spark: DAG, stages, shuffle and skew"
      goal="A job reads orders, filters, joins customers and aggregates per customer. Make one key hot and watch one task own the stage; then try AQE, partition counts and a broadcast join."
      running={running}
      onToggle={() => setRunning((r) => !r)}
      onReset={() => setT(0)}
      controls={
        <>
          <Seg label="spark.sql.shuffle.partitions" value={parts} options={[8, 16, 64, 200].map((v) => ({ value: v, label: String(v), hint: v === 200 ? 'Spark default' : undefined }))} onChange={restart(setParts)} />
          <Seg
            label="Key distribution (customer_id)"
            value={skew}
            options={[
              { value: 'uniform', label: 'uniform' },
              { value: 'hot', label: `one hot key (${HOT_FRAC * 100}% of rows)` },
            ]}
            onChange={restart(setSkew)}
          />
          <Seg
            label="Adaptive Query Execution"
            value={aqe ? 'on' : 'off'}
            options={[
              { value: 'off', label: 'off' },
              { value: 'on', label: 'on (skew split + coalesce)' },
            ]}
            onChange={restart((v: string) => setAqe(v === 'on'))}
          />
          <div className="flex flex-wrap gap-3">
            <Seg
              label="Join strategy"
              value={join}
              options={[
                { value: 'smj', label: 'sort-merge' },
                { value: 'bhj', label: 'broadcast' },
              ]}
              onChange={restart(setJoin)}
            />
            <Seg label="customers size" value={dimMb} options={[8, 100, 2048].map((v) => ({ value: v, label: gb(v) }))} onChange={restart(setDimMb)} />
          </div>
        </>
      }
      stats={
        <>
          <Stat label="Shuffle stage time" value={sec(p.makespan)} tone={p.makespan > 25 ? 'bad' : p.makespan > 14 ? 'warn' : 'ok'} sub={aqe && noAqe.makespan !== p.makespan ? `${sec(noAqe.makespan)} without AQE` : `${SLOTS} cores`} />
          <Stat label="Slowest vs median task" value={`${sec(slowest)} / ${sec(med)}`} tone={slowest > 4 * med ? 'bad' : slowest > 2 * med ? 'warn' : 'ok'} sub={`${(slowest / med).toFixed(1)}x`} />
          <Stat label="Shuffle bytes" value={gb(p.shuffleMb)} tone={p.broadcast ? 'ok' : undefined} sub={p.broadcast ? `+ ${gb(dimMb)} broadcast to 4 executors` : 'orders + customers re-hashed'} />
          <Stat label="Tasks in stage" value={p.tasks.length} sub={`${waves} wave${waves > 1 ? 's' : ''} · ${done}/${p.tasks.length} done`} />
        </>
      }
      insight={lines.join(' ')}
    >
      <svg viewBox="0 0 560 138" className="w-full">
        {[0, 1, 2].map((s) => {
          const ns = g.nodes.filter((n) => n.stage === s);
          const x0 = Math.min(...ns.map((n) => n.x)) - 6;
          const y0 = Math.min(...ns.map((n) => n.y)) - 16;
          const x1 = Math.max(...ns.map((n) => n.x)) + 86;
          const y1 = Math.max(...ns.map((n) => n.y)) + 30;
          return (
            <g key={s}>
              <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={8} fill={s === 2 ? 'rgb(var(--c-accent) / 0.06)' : 'rgb(var(--c-surface) / 0.6)'} stroke={s === 2 ? 'rgb(var(--c-accent) / 0.6)' : 'rgb(var(--c-line))'} strokeDasharray="4 3" />
              <text x={x0 + 5} y={y0 + 10} className={cn('font-mono text-[8.5px]', s === 2 ? 'fill-accent' : 'fill-muted')}>
                stage {s} · {g.tasksOf[s]} task{g.tasksOf[s] === 1 ? '' : 's'}{p.broadcast && s === 0 ? ' (collect → driver)' : ''}
              </text>
            </g>
          );
        })}
        {g.edges.map(([a, b, kind]) => {
          const na = g.nodes.find((n) => n.id === a)!;
          const nb = g.nodes.find((n) => n.id === b)!;
          const stroke = kind === 'shuffle' ? 'rgb(var(--c-warn))' : kind === 'broadcast' ? 'rgb(var(--c-violet))' : 'rgb(var(--c-line))';
          return (
            <g key={a + b}>
              <line x1={na.x + 80} y1={na.y + 9} x2={nb.x} y2={nb.y + 9} stroke={stroke} strokeWidth={kind === 'narrow' ? 1 : 1.6} strokeDasharray={kind === 'narrow' ? undefined : '5 5'} className={kind === 'narrow' ? undefined : 'animate-flow-dash'} />
              {kind !== 'narrow' && (
                <text x={(na.x + 80 + nb.x) / 2} y={(na.y + nb.y) / 2 + 6} textAnchor="middle" className={cn('font-mono text-[8px]', kind === 'shuffle' ? 'fill-warn' : 'fill-violet')}>
                  {kind === 'shuffle' ? 'shuffle' : 'broadcast'}
                </text>
              )}
            </g>
          );
        })}
        {g.nodes.map((n) => (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={80} height={18} rx={4} fill="rgb(var(--c-surface))" stroke={n.id === 'j' ? 'rgb(var(--c-accent))' : 'rgb(var(--c-line))'} />
            <text x={n.x + 40} y={n.y + 12} textAnchor="middle" className="fill-ink font-mono text-[8.5px]">
              {n.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="px-1 font-mono text-[10px] text-muted">
        stage 2 tasks (bar height = duration) · t = {sec(Math.min(t, p.makespan))} / {sec(p.makespan)} · {busy}/{SLOTS} cores busy
      </div>
      <svg viewBox="0 0 560 196" className="w-full">
        <line x1={20} y1={BH + 8} x2={540} y2={BH + 8} stroke="rgb(var(--c-line))" />
        <line x1={20} x2={540} y1={BH + 8 - (med / maxD) * BH} y2={BH + 8 - (med / maxD) * BH} stroke="rgb(var(--c-info))" strokeDasharray="3 3" />
        <text x={540} y={BH + 4 - (med / maxD) * BH} textAnchor="end" className="fill-info font-mono text-[8px]">
          median {sec(med)}
        </text>
        {p.tasks.map((k, i) => {
          const h = (k.dur / maxD) * BH;
          const prog = Math.max(0, Math.min(1, (t - k.start) / k.dur));
          const c = k.kind === 'hot' ? '--c-bad' : k.kind === 'split' ? '--c-violet' : k.kind === 'coalesced' ? '--c-info' : prog >= 1 ? '--c-ok' : '--c-accent';
          return (
            <g key={i}>
              <rect x={20 + i * BW + BW * 0.1} y={BH + 8 - h} width={Math.max(0.8, BW * 0.8)} height={h} fill={`rgb(var(${c}) / 0.12)`} stroke={k.spill ? 'rgb(var(--c-warn))' : 'none'} strokeWidth={0.8} />
              <rect x={20 + i * BW + BW * 0.1} y={BH + 8 - h * prog} width={Math.max(0.8, BW * 0.8)} height={h * prog} fill={`rgb(var(${c}) / ${prog >= 1 ? 0.55 : 0.9})`} />
            </g>
          );
        })}
        {hot && (
          <text x={Math.min(500, 20 + p.tasks.indexOf(hot) * BW + BW + 4)} y={16} className="fill-bad font-mono text-[9px]">
            ← straggler: {gb(hot.mb)}
          </text>
        )}
        <text x={20} y={BH + 22} className="fill-faint font-mono text-[8.5px]">
          cores over time (each row is one core; idle = empty)
        </text>
        {p.tasks.map((k, i) =>
          k.start < t ? (
            <rect key={i} x={tx(k.start)} y={BH + 28 + k.slot * 4} width={Math.max(0.5, tx(Math.min(t, k.end)) - tx(k.start) - 0.4)} height={3.2} fill={`rgb(var(${k.kind === 'hot' ? '--c-bad' : k.kind === 'split' ? '--c-violet' : '--c-accent'}) / 0.75)`} />
          ) : null,
        )}
        <line x1={tx(Math.min(t, p.makespan))} x2={tx(Math.min(t, p.makespan))} y1={BH + 26} y2={BH + 28 + SLOTS * 4} stroke="rgb(var(--c-ink) / 0.5)" />
      </svg>
      <div className="flex flex-wrap gap-3 px-1 pb-1 font-mono text-[9.5px] text-faint">
        <span className="text-accent">■ running</span>
        <span className="text-ok">■ done</span>
        <span className="text-bad">■ hot-key partition</span>
        <span className="text-violet">■ AQE skew split</span>
        <span className="text-info">■ AQE coalesced</span>
        <span className="text-warn">▢ spilled to disk</span>
      </div>
    </LabFrame>
  );
}
