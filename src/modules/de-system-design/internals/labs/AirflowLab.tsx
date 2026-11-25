import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { History } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { hash32, LabFrame, rng, Seg, Slider, Stat, useTicker } from './kit';

type TState = 'none' | 'queued' | 'running' | 'success' | 'failed' | 'up_for_retry' | 'upstream_failed';
type Mode = 'overwrite' | 'append';
type Kind = 'scheduled' | 'catchup' | 'backfill';

interface TI {
  state: TState;
  tries: number;
  left: number;
  retryAt: number;
}
interface Run {
  date: number;
  tis: TI[];
  created: number;
  state: 'running' | 'success' | 'failed';
  kind: Kind;
  slaMissed: boolean;
}
interface Job {
  date: number;
  task: number;
}

const TASKS = [
  { name: 'extract', dur: 3 },
  { name: 'transform', dur: 5 },
  { name: 'load', dur: 3 },
  { name: 'dq_check', dur: 2 },
];
const TICK_MS = 250;
const DAY = 40; // ticks per simulated day (10 s)
const SLA = 30; // a scheduled run must finish within 7.5 s of being created
const RETRY_DELAY = 6;
const START_TODAY = 8; // DAG deployed 8 days after start_date
const COLS = 10;
const MAX_SLOTS = 8;

const expected = (d: number) => 1000 + (hash32(`day${d}`) % 500);
const fmtDate = (d: number) => {
  const x = new Date(Date.UTC(2026, 5, 1 + d));
  return `${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
};
const newTis = (): TI[] => TASKS.map(() => ({ state: 'none', tries: 0, left: 0, retryAt: 0 }));

function fresh(catchup: boolean) {
  const st = {
    t: 0,
    today: START_TODAY,
    runs: new Map<number, Run>(),
    queue: [] as Job[],
    slots: Array.from({ length: MAX_SLOTS }, () => null as (Job & { left: number }) | null),
    rows: new Map<number, number>(),
    retries: 0,
    slaMiss: 0,
    lastQueued: 0,
    rand: rng(21),
  };
  for (let d = catchup ? 0 : START_TODAY - 1; d < START_TODAY; d++)
    st.runs.set(d, {
      date: d,
      tis: newTis(),
      created: 0,
      state: 'running',
      kind: catchup ? 'catchup' : 'scheduled',
      slaMissed: false,
    });
  return st;
}
type Sim = ReturnType<typeof fresh>;

const STATE_FILL: Record<TState, string> = {
  none: 'rgb(var(--c-surface))',
  queued: 'rgb(var(--c-faint) / 0.45)',
  running: 'rgb(var(--c-info))',
  success: 'rgb(var(--c-ok))',
  failed: 'rgb(var(--c-bad))',
  up_for_retry: 'rgb(var(--c-warn))',
  upstream_failed: 'rgb(var(--c-bad) / 0.3)',
};

export default function AirflowLab() {
  const [slots, setSlots] = useState(2);
  const [retries, setRetries] = useState(2);
  const [failP, setFailP] = useState(15);
  const [mode, setMode] = useState<Mode>('append');
  const [catchup, setCatchup] = useState(true);
  const [running, setRunning] = useState(true);
  const [, force] = useState(0);
  const s = useRef<Sim>(fresh(true));

  const reset = (c = catchup) => {
    s.current = fresh(c);
    force((x) => x + 1);
  };

  const finishTask = (st: Sim, run: Run, i: number) => {
    const ti = run.tis[i];
    const exp = expected(run.date);
    const have = st.rows.get(run.date) ?? 0;
    let fail = st.rand() * 100 < failP;
    if (i === 3 && have !== exp) fail = true; // dq_check: row count must match the source
    if (i === 2) {
      if (!fail) st.rows.set(run.date, mode === 'overwrite' ? exp : have + exp);
      else if (mode === 'append') st.rows.set(run.date, have + Math.round(exp * (0.3 + 0.6 * st.rand()))); // partial INSERT committed before the worker died
      // INSERT OVERWRITE swaps the partition atomically: a failed attempt leaves it untouched
    }
    if (!fail) {
      ti.state = 'success';
      if (i === TASKS.length - 1) run.state = 'success';
    } else if (ti.tries <= retries) {
      ti.state = 'up_for_retry';
      ti.retryAt = st.t + RETRY_DELAY;
      st.retries++;
    } else {
      ti.state = 'failed';
      run.state = 'failed';
      run.tis.slice(i + 1).forEach((x) => (x.state = 'upstream_failed'));
    }
  };

  useTicker(running, TICK_MS, () => {
    const st = s.current;
    st.t++;
    if (st.t % DAY === 0) {
      st.today++;
      const d = st.today - 1; // the interval that just closed
      st.runs.set(d, {
        date: d,
        tis: newTis(),
        created: st.t,
        state: 'running',
        kind: 'scheduled',
        slaMissed: false,
      });
    }
    // scheduler loop: find tasks whose upstream succeeded (or whose retry delay elapsed) and queue them
    let queued = 0;
    [...st.runs.values()]
      .sort((a, b) => a.date - b.date)
      .forEach((run) => {
        if (run.state !== 'running') return;
        run.tis.forEach((ti, i) => {
          const ready = (ti.state === 'none' && (i === 0 || run.tis[i - 1].state === 'success')) || (ti.state === 'up_for_retry' && st.t >= ti.retryAt);
          if (!ready) return;
          ti.state = 'queued';
          st.queue.push({ date: run.date, task: i });
          queued++;
        });
        if (run.kind !== 'backfill' && !run.slaMissed && st.t - run.created > SLA) {
          run.slaMissed = true;
          st.slaMiss++;
        }
      });
    if (queued) st.lastQueued = queued;
    // executor: workers run their task; free slots (within parallelism) pull from the queue
    st.slots.forEach((w, k) => {
      if (w && --w.left <= 0) {
        const run = st.runs.get(w.date)!;
        finishTask(st, run, w.task);
        st.slots[k] = null;
      }
      if (!st.slots[k] && k < slots && st.queue.length) {
        const j = st.queue.shift()!;
        const ti = st.runs.get(j.date)!.tis[j.task];
        ti.state = 'running';
        ti.tries++;
        st.slots[k] = { ...j, left: TASKS[j.task].dur };
      }
    });
    force((x) => x + 1);
  });

  const backfill = () => {
    const st = s.current;
    for (let d = Math.max(0, st.today - 7); d < st.today; d++) {
      const r = st.runs.get(d);
      if (r?.state === 'running') continue;
      st.runs.set(d, {
        date: d,
        tis: newTis(),
        created: st.t,
        state: 'running',
        kind: 'backfill',
        slaMissed: false,
      });
    }
    force((x) => x + 1);
  };

  // derived
  const st = s.current;
  const runs = [...st.runs.values()];
  const ok = runs.filter((r) => r.state === 'success').length;
  const failed = runs.filter((r) => r.state === 'failed').length;
  let dup = 0;
  let wrongParts = 0;
  st.rows.forEach((n, d) => {
    dup += Math.max(0, n - expected(d));
    if (n !== expected(d)) wrongParts++;
  });
  const backlogRuns = runs.filter((r) => r.state === 'running').length;
  const dayFrac = (st.t % DAY) / DAY;
  const first = Math.max(0, st.today - COLS);
  const dates = Array.from({ length: st.today - first }, (_, i) => first + i);
  const busySlots = st.slots.filter(Boolean).length;
  const hasBackfill = runs.some((r) => r.kind === 'backfill');

  const lines: string[] = [];
  if (catchup && runs.some((r) => r.kind === 'catchup' && r.state === 'running'))
    lines.push(
      `catchup=True: on deploy the scheduler created a run for every interval since start_date (${START_TODAY} runs) and they all compete for ${slots} worker slot(s). The newest run waits behind history, so the day the business cares about misses its SLA. Most teams set catchup=False and backfill deliberately.`,
    );
  if (mode === 'append' && dup > 0)
    lines.push(
      `Append is not idempotent: a retried load re-inserted rows a failed attempt had already partly committed${hasBackfill ? ', and the backfill re-appended whole days' : ''}: ${dup.toLocaleString()} duplicate rows across ${wrongParts} partition(s). dq_check caught some runs, but dashboards had already read the bad numbers.`,
    );
  else if (mode === 'overwrite')
    lines.push(
      `INSERT OVERWRITE … PARTITION (ds = '{{ ds }}') is idempotent: running a day once or five times leaves the same partition, so retries and backfills are safe. A failed attempt left nothing behind because the overwrite swaps the partition atomically.${dup ? ` (The ${dup.toLocaleString()} duplicates were written earlier in append mode; backfill those days to repair them.)` : ''}`,
    );
  if (retries === 0 && failed > 0)
    lines.push(
      'With 0 retries a single transient failure (spot node, API timeout) fails the whole run and pages a human. 2-3 retries with a delay absorb most flakiness, but only idempotent tasks can be retried safely.',
    );
  if (backlogRuns > slots * 2 && !catchup) lines.push(`${backlogRuns} runs are active but only ${slots} slot(s): runs queue behind each other. Raise parallelism or cap max_active_runs.`);
  if (!lines.length)
    lines.push(
      `A run's logical date (ds) is the START of the interval it processes: the ${fmtDate(st.today - 1)} run only started at ${fmtDate(st.today)} 00:00, once that day's data was complete. Templating paths and partitions on {{ ds }}, never on now(), is what makes reruns and backfills reproduce the same output.`,
    );

  // layout
  const GX = 64;
  const CW = 40;
  const rowY = (i: number) => 24 + i * 19;
  const slotX = (k: number) => 336 + (k % 4) * 54;
  const slotY = (k: number) => 14 + Math.floor(k / 4) * 26;
  const tok = (j: Job) => `${TASKS[j.task].name[0].toUpperCase()} ${fmtDate(j.date)}`;

  return (
    <LabFrame
      title="Airflow: scheduler, executor & backfill"
      goal="Watch the scheduler queue tasks and workers pick them up. Raise the failure rate and compare append with INSERT OVERWRITE, then backfill the last 7 days in each mode and check the duplicated-rows stat."
      running={running}
      onToggle={() => setRunning((r) => !r)}
      onReset={() => reset()}
      controls={
        <>
          <Slider label="Executor slots (parallelism)" value={slots} min={1} max={MAX_SLOTS} onChange={setSlots} fmt={(v) => `${v} worker slot${v > 1 ? 's' : ''}`} />
          <Slider label="retries" value={retries} min={0} max={3} onChange={setRetries} fmt={(v) => `${v} (delay ${(RETRY_DELAY * TICK_MS) / 1000} s)`} />
          <Slider label="Task failure probability" value={failP} min={0} max={40} onChange={setFailP} fmt={(v) => `${v}% per attempt`} />
          <Seg
            label="load task writes with"
            value={mode}
            options={[
              {
                value: 'overwrite',
                label: 'INSERT OVERWRITE partition',
                hint: 'idempotent: replaces ds partition atomically',
              },
              {
                value: 'append',
                label: 'INSERT INTO (append)',
                hint: 'not idempotent: every rerun adds rows',
              },
            ]}
            onChange={setMode}
          />
          <Seg
            label="catchup (applies on deploy, resets the lab)"
            value={catchup ? 'on' : 'off'}
            options={[
              {
                value: 'on',
                label: `catchup=True (${START_TODAY} missed runs)`,
              },
              { value: 'off', label: 'catchup=False (latest only)' },
            ]}
            onChange={(v) => {
              setCatchup(v === 'on');
              reset(v === 'on');
            }}
          />
          <div className="flex items-end">
            <Button size="xs" variant="secondary" icon={<History size={12} />} onClick={backfill}>
              backfill last 7 days
            </Button>
          </div>
        </>
      }
      stats={
        <>
          <Stat label="Runs succeeded" value={`${ok}/${runs.length}`} tone={failed ? 'warn' : 'ok'} sub={`${failed} failed · ${backlogRuns} active`} />
          <Stat label="Retries" value={st.retries} tone={st.retries ? 'warn' : undefined} sub="task attempts re-queued" />
          <Stat label="Duplicated rows" value={dup.toLocaleString()} tone={dup ? 'bad' : 'ok'} sub={`${wrongParts} partition(s) with wrong count`} />
          <Stat label="SLA misses" value={st.slaMiss} tone={st.slaMiss ? 'bad' : 'ok'} sub={`run must finish ${(SLA * TICK_MS) / 1000} s after scheduling`} />
        </>
      }
      insight={lines.join(' ')}
    >
      <svg viewBox="0 0 560 112" className="w-full">
        <rect x={8} y={14} width={92} height={46} rx={8} fill="rgb(var(--c-surface))" stroke="rgb(var(--c-accent))" strokeWidth={1.5} />
        <text x={54} y={30} textAnchor="middle" className="fill-ink font-mono text-[10.5px] font-semibold">
          scheduler
        </text>
        <text x={54} y={43} textAnchor="middle" className="fill-faint font-mono text-[8.5px]">
          loop every {TICK_MS} ms
        </text>
        <text x={54} y={54} textAnchor="middle" className="fill-faint font-mono text-[8.5px]">
          last queued {st.lastQueued}
        </text>
        <motion.circle key={st.t} cx={94} cy={20} r={3} fill="rgb(var(--c-accent))" initial={{ opacity: 1 }} animate={{ opacity: 0.2 }} transition={{ duration: TICK_MS / 1000 }} />
        <line x1={100} y1={37} x2={116} y2={37} stroke="rgb(var(--c-line))" />
        <rect x={116} y={8} width={206} height={58} rx={8} fill="rgb(var(--c-surface) / 0.6)" stroke="rgb(var(--c-line))" />
        <text x={122} y={20} className="fill-muted font-mono text-[9px]">
          executor queue · {st.queue.length}
        </text>
        {st.queue.slice(0, 12).map((j, i) => (
          <motion.g key={`${j.date}-${j.task}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
            <rect x={122 + (i % 4) * 49} y={25 + Math.floor(i / 4) * 13} width={46} height={11} rx={2} fill="rgb(var(--c-faint) / 0.3)" />
            <text x={145 + (i % 4) * 49} y={33.5 + Math.floor(i / 4) * 13} textAnchor="middle" className="fill-ink font-mono text-[8px]">
              {tok(j)}
            </text>
          </motion.g>
        ))}
        {st.queue.length > 12 && (
          <text x={316} y={20} textAnchor="end" className="fill-bad font-mono text-[8.5px]">
            +{st.queue.length - 12} waiting
          </text>
        )}
        <line x1={322} y1={37} x2={334} y2={37} stroke="rgb(var(--c-line))" />
        {st.slots.map((w, k) => (
          <g key={k} opacity={k < slots || w ? 1 : 0.25}>
            <rect x={slotX(k)} y={slotY(k)} width={50} height={22} rx={4} fill="rgb(var(--c-surface))" stroke={w ? 'rgb(var(--c-info))' : 'rgb(var(--c-line))'} />
            <text x={slotX(k) + 25} y={slotY(k) + 10} textAnchor="middle" className={cn('font-mono text-[8px]', w ? 'fill-ink' : 'fill-faint')}>
              {w ? tok(w) : `worker ${k + 1}`}
            </text>
            {w && <rect x={slotX(k) + 4} y={slotY(k) + 15} width={42 * (1 - w.left / TASKS[w.task].dur)} height={3} fill="rgb(var(--c-info))" />}
          </g>
        ))}
        <text x={8} y={84} className="fill-muted font-mono text-[9px]">
          DAG
        </text>
        {TASKS.map((t, i) => (
          <g key={t.name}>
            <rect x={34 + i * 82} y={74} width={66} height={15} rx={4} fill="rgb(var(--c-surface))" stroke="rgb(var(--c-line))" />
            <text x={67 + i * 82} y={84.5} textAnchor="middle" className="fill-ink font-mono text-[8.5px]">
              {t.name}
            </text>
            {i < TASKS.length - 1 && <line x1={100 + i * 82} y1={81.5} x2={116 + i * 82} y2={81.5} stroke="rgb(var(--c-faint))" />}
          </g>
        ))}
        <text x={366} y={84.5} className="fill-faint font-mono text-[8.5px]">
          busy {busySlots}/{slots} · {backlogRuns} active runs
        </text>
        <text x={8} y={104} className="fill-faint font-mono text-[8.5px]">
          now {fmtDate(st.today)} {String(Math.floor(dayFrac * 24)).padStart(2, '0')}:00 · next run (ds {fmtDate(st.today)}) fires at {fmtDate(st.today + 1)} 00:00
        </text>
        <rect x={380} y={98} width={172} height={5} rx={2} fill="rgb(var(--c-line) / 0.5)" />
        <rect x={380} y={98} width={172 * dayFrac} height={5} rx={2} fill="rgb(var(--c-accent) / 0.7)" />
      </svg>
      <svg viewBox="0 0 560 132" className="w-full">
        <text x={4} y={12} className="fill-muted font-mono text-[8.5px]">
          ds →
        </text>
        {TASKS.map((t, i) => (
          <text key={t.name} x={4} y={rowY(i) + 12} className="fill-muted font-mono text-[8.5px]">
            {t.name}
          </text>
        ))}
        <text x={4} y={rowY(4) + 12} className="fill-muted font-mono text-[8.5px]">
          rows
        </text>
        {dates.map((d, c) => {
          const run = st.runs.get(d);
          const x = GX + c * CW;
          const n = st.rows.get(d);
          return (
            <g key={d}>
              <text x={x + CW / 2 - 2} y={12} textAnchor="middle" className={cn('font-mono text-[8.5px]', run?.state === 'failed' ? 'fill-bad' : run?.state === 'success' ? 'fill-ok' : 'fill-ink')}>
                {fmtDate(d)}
                {run && run.kind !== 'scheduled' && <tspan className={run.kind === 'backfill' ? 'fill-violet' : 'fill-warn'}>{run.kind === 'backfill' ? ' B' : ' C'}</tspan>}
              </text>
              {TASKS.map((_, i) => {
                const ti = run?.tis[i];
                const state = ti?.state ?? 'none';
                return (
                  <g key={i}>
                    <motion.rect
                      x={x}
                      y={rowY(i)}
                      width={CW - 4}
                      height={16}
                      rx={3}
                      fill={STATE_FILL[state]}
                      stroke={run ? 'rgb(var(--c-line))' : 'rgb(var(--c-line) / 0.5)'}
                      strokeDasharray={run ? undefined : '3 2'}
                      animate={{
                        opacity: state === 'running' ? [1, 0.55, 1] : 1,
                      }}
                      transition={state === 'running' ? { duration: 0.8, repeat: Infinity } : { duration: 0.2 }}
                    />
                    {ti && ti.tries > 1 && (
                      <text x={x + (CW - 4) / 2} y={rowY(i) + 11.5} textAnchor="middle" className="fill-ink font-mono text-[8px] font-semibold">
                        ×{ti.tries}
                      </text>
                    )}
                  </g>
                );
              })}
              <text
                x={x + (CW - 4) / 2}
                y={rowY(4) + 12}
                textAnchor="middle"
                className={cn('font-mono text-[8.5px]', n === undefined ? 'fill-faint' : n > expected(d) ? 'fill-bad font-semibold' : n < expected(d) ? 'fill-warn' : 'fill-ok')}
              >
                {n === undefined ? '-' : `${(n / 1000).toFixed(1)}k`}
              </text>
            </g>
          );
        })}
        <text x={GX + dates.length * CW} y={rowY(1) + 12} className="fill-faint font-mono text-[8.5px]">
          ← {fmtDate(st.today)} still
        </text>
        <text x={GX + dates.length * CW} y={rowY(2) + 12} className="fill-faint font-mono text-[8.5px]">
          in progress
        </text>
        <text x={4} y={127} className="fill-faint font-mono text-[8.5px]">
          <tspan className="fill-muted">■ queued</tspan> <tspan className="fill-info">■ running</tspan> <tspan className="fill-ok">■ success</tspan> <tspan className="fill-warn">■ up_for_retry</tspan>{' '}
          <tspan className="fill-bad">■ failed</tspan> · ×n attempt · <tspan className="fill-warn">C</tspan> catchup <tspan className="fill-violet">B</tspan> backfill
        </text>
      </svg>
    </LabFrame>
  );
}
