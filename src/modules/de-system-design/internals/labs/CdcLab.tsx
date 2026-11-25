import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Pencil, Plus, RotateCw, Trash2 } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { hash32, LabFrame, rng, Seg, Slider, Stat, useTicker } from './kit';

type Mode = 'cdc' | 'poll';
type Op = 'c' | 'u' | 'd';

interface Row {
  id: number;
  status: string;
  amount: number;
  updatedAt: number; // seconds
  lsn: number;
}
interface Wal {
  lsn: number;
  op: Op;
  id: number;
  before: Row | null;
  after: Row | null;
}
interface Evt {
  seq: number;
  op: Op | 'r';
  id: number;
  lsn: number;
  after: Row | null;
  part: number;
  redelivered: boolean;
}

const PARTS = 3;
const STATUSES = ['new', 'paid', 'shipped', 'delivered'];
const OFFSET_FLUSH = 10; // ticks between connector offset commits (Debezium offset.flush.interval.ms = 1 s here)
const RESTART = 25; // ticks the connector is down
const lsnStr = (l: number) => `0/${l.toString(16).toUpperCase()}`;
const part = (id: number) => hash32(`order-${id}`) % PARTS;

function fresh() {
  const rows = new Map<number, Row>();
  for (let id = 1; id <= 4; id++) rows.set(id, { id, status: STATUSES[id % 3], amount: 20 + id * 7, updatedAt: 0, lsn: 0x1a0 });
  const copy = () => new Map([...rows].map(([k, v]) => [k, { ...v }]));
  return {
    t: 0,
    rows,
    nextId: 5,
    lsn: 0x1a0,
    wal: [] as Wal[],
    made: 0,
    deletes: 0,
    flash: 0,
    seq: 0,
    // log-based connector
    cdc: { readIdx: 0, maxIdx: 0, storedIdx: 0, downUntil: 0, topic: [] as Evt[], lake: copy(), redelivered: 0, restarts: 0 },
    // query-based poller
    poll: { lastTs: 0, nextPoll: 30, polls: 0, rowsRead: 0, accIdx: 0, topic: [] as Evt[], lake: copy(), captured: 0, missedDel: 0, missedUpd: 0 },
    rand: rng(9),
  };
}
type Sim = ReturnType<typeof fresh>;

function change(st: Sim, op: Op, pickId?: number) {
  const ids = [...st.rows.keys()];
  const now = st.t / 10;
  st.lsn += 0x18 + Math.floor(st.rand() * 0x30);
  if (op === 'c' || !ids.length) {
    const id = st.nextId++;
    const after = { id, status: 'new', amount: 10 + Math.floor(st.rand() * 90), updatedAt: now, lsn: st.lsn };
    st.rows.set(id, after);
    st.wal.push({ lsn: st.lsn, op: 'c', id, before: null, after });
  } else {
    const id = pickId ?? ids[Math.floor(st.rand() * ids.length)];
    const before = st.rows.get(id)!;
    if (op === 'd') {
      st.rows.delete(id);
      st.deletes++;
      st.wal.push({ lsn: st.lsn, op: 'd', id, before, after: null });
    } else {
      // walk the order through its lifecycle; once delivered, further updates adjust the amount (refund, fee)
      const i = STATUSES.indexOf(before.status);
      const after = i < STATUSES.length - 1 ? { ...before, status: STATUSES[i + 1], updatedAt: now, lsn: st.lsn } : { ...before, amount: before.amount - 1 - Math.floor(st.rand() * 5), updatedAt: now, lsn: st.lsn };
      st.rows.set(id, after);
      st.wal.push({ lsn: st.lsn, op: 'u', id, before, after });
    }
  }
  st.made++;
  st.flash = st.wal[st.wal.length - 1].id;
}

/** MERGE INTO lake USING change ON id: newer LSN wins, delete removes the row. Idempotent on replays. */
function merge(lake: Map<number, Row>, e: Evt) {
  const cur = lake.get(e.id);
  if (cur && cur.lsn >= e.lsn && e.op !== 'r') return;
  if (e.op === 'd') lake.delete(e.id);
  else if (e.after) lake.set(e.id, { ...e.after });
}

export default function CdcLab() {
  const [mode, setMode] = useState<Mode>('cdc');
  const [interval, setIntervalS] = useState(3);
  const [auto, setAuto] = useState(true);
  const [running, setRunning] = useState(true);
  const [, force] = useState(0);
  const s = useRef(fresh());
  const act = (fn: () => void) => () => (fn(), force((x) => x + 1));

  useTicker(running, 100, () => {
    const st = s.current;
    st.t++;
    // log-based: tail the WAL from the stored position, 2 entries per tick
    const c = st.cdc;
    if (st.t >= c.downUntil) {
      for (let n = 0; n < 2 && c.readIdx < st.wal.length; n++, c.readIdx++) {
        const w = st.wal[c.readIdx];
        const redelivered = c.readIdx < c.maxIdx;
        if (redelivered) c.redelivered++;
        const e: Evt = { seq: st.seq++, op: w.op, id: w.id, lsn: w.lsn, after: w.after, part: part(w.id), redelivered };
        c.topic = [...c.topic, e].slice(-40);
        merge(c.lake, e);
      }
      c.maxIdx = Math.max(c.maxIdx, c.readIdx);
      if (st.t % OFFSET_FLUSH === 0) c.storedIdx = c.readIdx;
    }
    // query-based: SELECT * FROM orders WHERE updated_at > :last every interval
    const p = st.poll;
    if (st.t >= p.nextPoll) {
      p.polls++;
      p.nextPoll = st.t + interval * 10;
      const hits = [...st.rows.values()].filter((r) => r.updatedAt > p.lastTs);
      p.rowsRead += hits.length + 1;
      for (const r of hits) {
        const e: Evt = { seq: st.seq++, op: 'r', id: r.id, lsn: r.lsn, after: { ...r }, part: part(r.id), redelivered: false };
        p.topic = [...p.topic, e].slice(-40);
        merge(p.lake, e);
        p.lastTs = Math.max(p.lastTs, r.updatedAt);
      }
      // account for every change made since the previous poll
      const seen = new Set(hits.map((r) => r.lsn));
      for (; p.accIdx < st.wal.length; p.accIdx++) {
        const w = st.wal[p.accIdx];
        if (seen.has(w.lsn)) p.captured++;
        else if (w.op === 'd') p.missedDel++;
        else p.missedUpd++;
      }
    }
    // background OLTP traffic (after the poll, so a change never shares the timestamp the poll just used)
    if (auto && st.rand() < 0.07) {
      const r = st.rand();
      change(st, st.rows.size < 3 || r < 0.25 ? 'c' : r < 0.85 || st.rows.size < 4 ? 'u' : 'd');
    }
    force((x) => x + 1);
  });

  const restart = act(() => {
    const c = s.current.cdc;
    c.downUntil = s.current.t + RESTART;
    c.readIdx = c.storedIdx; // resume from the last committed LSN, not from "now"
    c.restarts++;
  });

  const st = s.current;
  const pipe = mode === 'cdc' ? st.cdc : st.poll;
  const down = st.t < st.cdc.downUntil;
  const captured = mode === 'cdc' ? st.cdc.maxIdx : st.poll.captured;
  const accounted = mode === 'cdc' ? st.wal.length : st.poll.accIdx;
  const lakeRows = [...new Set([...st.rows.keys(), ...pipe.lake.keys()])].sort((a, b) => a - b);
  const drift = lakeRows.filter((id) => {
    const a = st.rows.get(id);
    const b = pipe.lake.get(id);
    return !a || !b || a.status !== b.status || a.amount !== b.amount;
  }).length;
  const retained = st.wal.length - st.cdc.storedIdx;
  const opTone: Record<string, string> = { c: 'border-ok/50 bg-ok/10 text-ok', u: 'border-info/50 bg-info/10 text-info', d: 'border-bad/50 bg-bad/10 text-bad', r: 'border-violet/50 bg-violet/10 text-violet' };

  const lines: string[] = [];
  if (mode === 'poll') {
    lines.push(`Polling sees only the current state of rows whose updated_at moved: ${st.poll.missedDel} hard delete(s) left no row to find (they stay as ghosts in the lake) and ${st.poll.missedUpd} intermediate change(s) were overwritten before the next poll, so the history (new → paid → shipped) is lost.`);
    lines.push(`It also costs the primary ${Math.round(60 / interval)} queries/min, needs an index on updated_at, and breaks if a writer forgets to bump updated_at or a long transaction commits an older timestamp after the poll.`);
  } else {
    lines.push(`Log-based CDC reads the WAL the database already writes for durability and replication, so every insert, update and delete arrives with its before/after image, in commit order, and with no queries on the tables. Partitioning by primary key keeps each order's changes in order on one partition.`);
    if (st.cdc.restarts) lines.push(`After a restart the connector resumed from its last stored LSN, not from "now": no gaps. ${st.cdc.redelivered} event(s) between that offset and the crash were sent again (dashed); the MERGE ignores any change whose LSN is not newer, so replays are harmless.`);
    if (down) lines.push(`While the connector is down the replication slot makes Postgres keep WAL (${retained} entries now). Leave a slot unconsumed for days and the primary's disk fills up: monitor slot lag.`);
  }

  return (
    <LabFrame
      title="CDC: reading the write-ahead log"
      goal="Make inserts, updates and deletes on the OLTP table, then switch between log-based CDC and query-based polling and compare what reaches the lakehouse. Restart the connector mid-stream."
      running={running}
      onToggle={() => setRunning((r) => !r)}
      onReset={() => ((s.current = fresh()), force((x) => x + 1))}
      controls={
        <>
          <Seg
            label="Capture method"
            value={mode}
            options={[
              { value: 'cdc', label: 'log-based CDC (Debezium)' },
              { value: 'poll', label: 'polling: updated_at > last' },
            ]}
            onChange={setMode}
          />
          {mode === 'poll' ? (
            <Slider label="Polling interval" value={interval} min={1} max={10} onChange={setIntervalS} fmt={(v) => `${v} s (${Math.round(60 / v)} queries/min)`} />
          ) : (
            <div className="flex items-end gap-2">
              <Button size="xs" variant="secondary" icon={<RotateCw size={12} />} disabled={down} onClick={restart}>
                connector restart
              </Button>
              <span className="font-mono text-[10.5px] text-muted">stored offset: LSN {st.wal[st.cdc.storedIdx - 1] ? lsnStr(st.wal[st.cdc.storedIdx - 1].lsn) : 'start'}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5 sm:col-span-2">
            <Button size="xs" variant="secondary" icon={<Plus size={12} />} onClick={act(() => change(st, 'c'))}>
              INSERT
            </Button>
            <Button size="xs" variant="secondary" icon={<Pencil size={12} />} onClick={act(() => change(st, 'u'))}>
              UPDATE
            </Button>
            <Button size="xs" variant="secondary" onClick={act(() => [0, 1, 2].forEach(() => change(st, 'u', [...st.rows.keys()][0])))}>
              UPDATE same row ×3
            </Button>
            <Button size="xs" variant="danger" icon={<Trash2 size={12} />} disabled={!st.rows.size} onClick={act(() => change(st, 'd'))}>
              DELETE
            </Button>
            <span className="ml-auto">
              <Seg
                value={auto ? 'on' : 'off'}
                options={[
                  { value: 'on', label: 'background traffic on' },
                  { value: 'off', label: 'off' },
                ]}
                onChange={(v) => setAuto(v === 'on')}
              />
            </span>
          </div>
        </>
      }
      stats={
        <>
          <Stat label="Changes captured" value={`${captured} / ${st.made}`} tone={mode === 'cdc' ? (captured < st.made ? 'warn' : 'ok') : captured < accounted ? 'bad' : 'ok'} sub={mode === 'cdc' ? `${st.made - st.cdc.maxIdx} still in flight` : `${st.made - accounted} since last poll`} />
          <Stat label="Missed deletes" value={mode === 'cdc' ? 0 : st.poll.missedDel} tone={mode === 'poll' && st.poll.missedDel ? 'bad' : 'ok'} sub={mode === 'poll' ? `${st.poll.missedUpd} intermediate updates missed` : 'tombstone + d event'} />
          <Stat label="DB load" value={mode === 'cdc' ? '0 queries' : `${Math.round(60 / interval)} q/min`} tone={mode === 'poll' && interval <= 2 ? 'warn' : undefined} sub={mode === 'cdc' ? `reads WAL · slot holds ${retained}` : `${st.poll.polls} polls · ${st.poll.rowsRead} rows read`} />
          <Stat label="Lake rows out of sync" value={drift} tone={drift ? (mode === 'poll' ? 'bad' : 'warn') : 'ok'} sub="vs source table now" />
        </>
      }
      insight={lines.join(' ')}
    >
      <div className="grid gap-2 font-mono text-[10px] md:grid-cols-3">
        <div className="space-y-2">
          <div>
            <div className="eyebrow mb-1">Postgres · orders</div>
            <table className="w-full">
              <thead className="text-faint">
                <tr>
                  <th className="text-left font-normal">id</th>
                  <th className="text-left font-normal">status</th>
                  <th className="text-right font-normal">amt</th>
                  <th className="text-right font-normal">updated_at</th>
                </tr>
              </thead>
              <tbody>
                {[...st.rows.values()].map((r) => (
                  <tr key={r.id} className={cn(r.id === st.flash && 'bg-accent/10')}>
                    <td>{r.id}</td>
                    <td>{r.status}</td>
                    <td className="text-right">{r.amount}</td>
                    <td className="text-right text-muted">{r.updatedAt.toFixed(1)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="eyebrow mb-1">WAL (logical decoding)</div>
            <div className="space-y-0.5 rounded-md border border-line bg-surface p-1">
              {st.wal.slice(-6).map((w) => (
                <div key={w.lsn} className={cn('truncate', mode === 'cdc' && st.wal.indexOf(w) >= st.cdc.readIdx ? 'text-faint' : 'text-ink')}>
                  <span className="text-muted">{lsnStr(w.lsn)}</span> <span className={opTone[w.op].split(' ').pop()}>{w.op}</span> id={w.id} {w.op === 'u' ? (w.before!.status === w.after!.status ? `amt ${w.before!.amount}→${w.after!.amount}` : `${w.before!.status}→${w.after!.status}`) : w.op === 'c' ? `+${w.after!.status}` : `-${w.before!.status}`}
                </div>
              ))}
              {!st.wal.length && <div className="text-faint">no changes yet</div>}
            </div>
          </div>
        </div>
        <div>
          <div className="eyebrow mb-1 flex justify-between">
            <span>Kafka · orders.cdc ({PARTS} partitions, key = id)</span>
          </div>
          <div className={cn('mb-1 text-[9.5px]', down ? 'text-bad' : 'text-muted')}>
            {mode === 'cdc' ? (down ? `connector RESTARTING · will resume at stored LSN` : `streaming · read up to ${st.wal[st.cdc.readIdx - 1] ? lsnStr(st.wal[st.cdc.readIdx - 1].lsn) : '-'}`) : `next poll in ${Math.max(0, (st.poll.nextPoll - st.t) / 10).toFixed(1)}s · WHERE updated_at > ${st.poll.lastTs.toFixed(1)}`}
          </div>
          <div className="space-y-1">
            {Array.from({ length: PARTS }, (_, pi) => (
              <div key={pi} className="flex items-center gap-1 rounded-md border border-line bg-surface p-1">
                <span className="w-5 text-faint">p{pi}</span>
                <div className="flex flex-1 gap-0.5 overflow-hidden">
                  <AnimatePresence initial={false}>
                    {pipe.topic
                      .filter((e) => e.part === pi)
                      .slice(-6)
                      .map((e) => (
                        <motion.span key={e.seq} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className={cn('shrink-0 rounded border px-1', opTone[e.op], e.redelivered && 'border-dashed opacity-70')} title={e.after ? JSON.stringify({ op: e.op, after: e.after }) : `op d, before id=${e.id}`}>
                          {e.op}:{e.id}
                        </motion.span>
                      ))}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 text-[9px] text-faint">
            <span className="text-ok">c</span> create · <span className="text-info">u</span> update (before+after) · <span className="text-bad">d</span> delete · <span className="text-violet">r</span> polled row snapshot (no before, no op)
          </div>
        </div>
        <div>
          <div className="eyebrow mb-1">Lakehouse · MERGE INTO orders</div>
          <table className="w-full">
            <thead className="text-faint">
              <tr>
                <th className="text-left font-normal">id</th>
                <th className="text-left font-normal">status</th>
                <th className="text-right font-normal">amt</th>
                <th className="text-right font-normal">vs source</th>
              </tr>
            </thead>
            <tbody>
              {lakeRows.map((id) => {
                const src = st.rows.get(id);
                const l = pipe.lake.get(id);
                const state = !l ? 'pending' : !src ? 'ghost' : src.status !== l.status || src.amount !== l.amount ? 'stale' : 'ok';
                return (
                  <tr key={id} className={cn(state === 'ghost' && 'text-bad line-through', state === 'stale' && 'text-warn', state === 'pending' && 'text-faint')}>
                    <td>{id}</td>
                    <td>{l?.status ?? '-'}</td>
                    <td className="text-right">{l?.amount ?? '-'}</td>
                    <td className="text-right">{state === 'ok' ? '✓' : state === 'ghost' ? 'deleted in source' : state === 'stale' ? `src: ${src!.status === l!.status ? src!.amount : src!.status}` : 'not yet'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </LabFrame>
  );
}
