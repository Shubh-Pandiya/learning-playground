import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/shared/cn';
import { CodeBlock, Tag } from '@/shared/ui';
import type { LabTopic } from '../../types';
import { Rich } from '../../ui/Rich';
import { CASS_STEPS, UNDER_HOOD } from './data';
import { CASS, CCK_OPTS, CPK_OPTS, cassBounded, cassRows, diffCass, evalCass, fmt, fmtBytes, hash32, type CEval, type CState, type Verdict } from './engine';
import { Exercises, FrozenBadge, History, LatestChange, LogSlider, Metric, OptionGroup, RedFlags, Walkthrough, useExercise, useLab } from './common';

const VERDICT_TEXT: Record<Verdict, string> = { good: 'text-ok', meh: 'text-warn', trap: 'text-bad' };
const SIZE_FILL: Record<CEval['size'], string> = { ok: 'rgb(var(--c-accent))', warn: 'rgb(var(--c-warn))', bad: 'rgb(var(--c-bad))' };

/** Sample conversations drawn on the ring. The busy one follows the msgs/day slider. */
const CONVS = [
  { id: 'general', perDay: -1 },
  { id: 'team-db', perDay: 40 },
  { id: 'family', perDay: 5 },
  { id: 'book-club', perDay: 2 },
  { id: 'support-17', perDay: 12 },
];
const SENDERS = [
  { id: 'ada', share: 0.3 },
  { id: 'lin', share: 0.2 },
  { id: 'deploy-bot', share: 1.5 },
  { id: 'sam', share: 0.1 },
];

interface Dot {
  key: string;
  rows: number;
  busy: boolean;
  /** 0 = newest partition of the busy conversation */
  recent: number;
}

function dotsFor(s: CState): Dot[] {
  const out: Dot[] = [];
  const days = Math.max(1, Math.round(s.months * CASS.daysPerMonth));
  const overwrite = s.ck === 'none' && s.pk !== 'msg';
  for (const c of CONVS) {
    const busy = c.perDay < 0;
    const perDay = busy ? s.perDay : c.perDay;
    const rows = overwrite ? 1 : cassRows({ ...s, perDay });
    if (s.pk === 'conv') out.push({ key: c.id, rows, busy, recent: 0 });
    else if (s.pk === 'conv-day') for (let d = 0; d < Math.min(days, busy ? 12 : 2); d++) out.push({ key: `${c.id}:day-${d}`, rows, busy, recent: d });
    else if (s.pk === 'conv-month') for (let m = 0; m < Math.min(s.months, busy ? 8 : 2); m++) out.push({ key: `${c.id}:month-${m}`, rows, busy, recent: m });
    else if (s.pk === 'msg') for (let m = 0; m < (busy ? 14 : 4); m++) out.push({ key: `${c.id}:msg-${m}`, rows: 1, busy, recent: m });
  }
  if (s.pk === 'sender') {
    const total = (s.perDay + 59) * days;
    for (const x of SENDERS) out.push({ key: x.id, rows: Math.round(total * x.share * 0.4), busy: false, recent: 0 });
  }
  return out;
}

const NODE_ANG = Array.from({ length: CASS.nodes }, (_, i) => i * (360 / CASS.nodes) + 20);
const angleOf = (key: string) => (hash32(key) / 2 ** 32) * 360;
const ownerOf = (a: number) => {
  const i = NODE_ANG.findIndex((n) => n >= a);
  return i === -1 ? 0 : i;
};
const pt = (r: number, a: number, c = 160) => ({ x: c + r * Math.sin((a * Math.PI) / 180), y: c - r * Math.cos((a * Math.PI) / 180) });
function arc(r: number, a0: number, a1: number) {
  const p0 = pt(r, a0);
  const p1 = pt(r, a1);
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p1.x} ${p1.y}`;
}
const sizeOf = (rows: number) => {
  const f = Math.max(rows / CASS.maxRows, (rows * CASS.rowBytes) / CASS.maxBytes);
  return f > 1 ? 'bad' : f > 0.5 ? 'warn' : 'ok';
};

export default function CassandraTab({ topic, active }: { topic: LabTopic; active: boolean }) {
  const lab = useLab<CState, CEval>({ topic, tab: 'cassandra', steps: CASS_STEPS, evaluate: evalCass, diff: diffCass });
  const { state: s, ev, revealed } = lab;
  const [run, setRun] = useState(0);
  useEffect(() => setRun((r) => r + 1), [s.pk, s.ck, lab.step]);

  const solved = cassBounded(s);
  useExercise(topic, 'cassandra-bounded', solved, lab.source === 'user');
  const stress = useMemo(() => evalCass({ ...s, months: CASS.stress.months, perDay: Math.max(s.perDay, CASS.stress.perDay) }), [s]);

  const pk = CPK_OPTS.find((o) => o.id === s.pk)!;
  const ck = CCK_OPTS.find((o) => o.id === s.ck)!;
  const ckLocked = s.pk === 'msg';
  const flags = [pk, ck].filter((o) => o.verdict === 'trap' && !(o === ck && ckLocked)).map((o) => ({ title: `\`${o.label}\``, why: o.why, fix: o.fix }));
  if (s.pk === 'conv' && ev.size === 'bad') flags.push({ title: 'Unbounded partition', why: `The busy conversation's partition holds **${fmt(ev.rows)} rows / ${fmtBytes(ev.bytes)}** and keeps growing: Cassandra never splits it.`, fix: pk.fix });
  const locked = !revealed;
  const busyRows = cassRows(s);

  return (
    <div className="flex h-full min-h-0">
      <Walkthrough steps={CASS_STEPS} stepper={lab.stepper} answers={lab.answers} onAnswer={lab.answer} stepChange={lab.stepChange} active={active} notes={UNDER_HOOD.cassandra} />

      <main className="relative min-w-0 flex-1 overflow-y-auto bg-sunken/60 bg-grid">
        <FrozenBadge show={!revealed} />
        <div className="space-y-4 p-4">
          <section className="rounded-xl border border-line bg-surface p-3">
            <div className="eyebrow mb-1">Access pattern</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-ink">
                Open a chat: <b>latest 50 messages</b> of a conversation, newest first. Busy conversation <code className="font-mono text-accent">#general</code>.
              </span>
              <Tag size="sm" tone={ev.latest.ok ? 'ok' : ev.latest.filtering ? 'bad' : 'warn'} variant="solid" className="ml-auto">
                {ev.latest.filtering ? 'ALLOW FILTERING · every node' : ev.latest.ok ? 'single-partition sorted slice' : !ev.latest.sorted ? 'unsorted: read all, sort in app' : `${ev.latest.partitions} partitions walked`}
              </Tag>
            </div>
            <div className="mt-3 flex gap-4">
              <LogSlider label="messages / day in #general" value={s.perDay} min={1} max={20_000} format={(v) => fmt(v)} disabled={locked} onChange={(v) => lab.change({ ...s, perDay: v }, 'Traffic: messages per day', true)} />
              <label className="block min-w-0 flex-1">
                <div className="mb-1 flex items-baseline justify-between font-mono text-[11px] text-muted">
                  <span>history (months)</span>
                  <span className="tabular-nums text-ink">{s.months}</span>
                </div>
                <input type="range" min={1} max={60} value={s.months} disabled={locked} onChange={(e) => lab.change({ ...s, months: Number(e.target.value) }, 'Time: months of history', true)} className="h-1 w-full cursor-pointer accent-[rgb(var(--c-accent))] disabled:cursor-not-allowed" />
              </label>
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
            <section className="rounded-xl border border-line bg-surface p-3">
              <div className="eyebrow mb-1">Token ring · Murmur3(partition key) → token · RF=3</div>
              <Ring s={s} ev={ev} run={run} />
            </section>
            <div className="space-y-4">
              <section className="rounded-xl border border-line bg-surface p-3">
                <div className="flex items-baseline justify-between">
                  <div className="eyebrow mb-1">Biggest partition over time (#general)</div>
                  <span className={cn('font-mono text-[11px] font-semibold', ev.size === 'bad' ? 'text-bad' : ev.size === 'warn' ? 'text-warn' : 'text-ok')}>
                    {fmt(busyRows)} rows · {fmtBytes(busyRows * CASS.rowBytes)}
                  </span>
                </div>
                <Growth s={s} />
              </section>
              <section className="rounded-xl border border-line bg-surface p-3">
                <div className="eyebrow mb-1">Inside the partition: rows in clustering order (on disk)</div>
                <DiskOrder s={s} ev={ev} run={run} />
              </section>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section>
              <div className="eyebrow mb-1">Schema</div>
              <CodeBlock code={ev.ddl} language="sql" />
            </section>
            <section>
              <div className="eyebrow mb-1">Read: latest 50</div>
              <CodeBlock code={ev.latest.cql} language="sql" />
              <AnimatePresence mode="wait">
                {ev.latest.error && (
                  <motion.pre key="err" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1.5 whitespace-pre-wrap rounded-lg border border-bad/40 bg-bad/[0.07] p-2 font-mono text-[10.5px] leading-snug text-bad">
                    {`-- without ALLOW FILTERING:\n${ev.latest.error}`}
                  </motion.pre>
                )}
              </AnimatePresence>
              <p className="mt-1.5 text-[12px] leading-snug text-muted">
                <Rich text={ev.latest.note} />
              </p>
            </section>
          </div>
        </div>
      </main>

      <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-paper">
        <LatestChange changes={lab.changes} />
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          <section className="space-y-3">
            <div className="eyebrow">Primary key design</div>
            <div>
              <OptionGroup title="Partition key: where" value={s.pk} locked={locked} onPick={(id) => lab.change({ ...s, pk: id as CState['pk'] }, `Partition key → ${CPK_OPTS.find((o) => o.id === id)!.label}`)} options={CPK_OPTS.map((o) => ({ id: o.id, label: o.label }))} />
              <p className={cn('mt-1 text-[11px] leading-snug', VERDICT_TEXT[pk.verdict])}>
                <Rich text={pk.why} />
              </p>
            </div>
            <div>
              <OptionGroup title="Clustering key: order inside" value={s.ck} locked={locked || ckLocked} onPick={(id) => lab.change({ ...s, ck: id as CState['ck'] }, `Clustering → ${CCK_OPTS.find((o) => o.id === id)!.label}`)} options={CCK_OPTS.map((o) => ({ id: o.id, label: o.label }))} />
              <p className={cn('mt-1 text-[11px] leading-snug', ckLocked ? 'text-faint' : VERDICT_TEXT[ck.verdict])}>
                <Rich text={ckLocked ? 'One message per partition: there is nothing to cluster.' : ck.why} />
              </p>
            </div>
          </section>

          <RedFlags flags={flags} />

          <section>
            <div className="eyebrow mb-1.5">Metrics · #general</div>
            <div className="grid grid-cols-2 gap-1.5">
              <Metric label="Biggest partition" value={`${fmt(ev.rows)} rows`} tone={ev.size === 'bad' ? 'bad' : ev.size === 'warn' ? 'warn' : 'ok'} sub={`${fmtBytes(ev.bytes)} · limit ~100k rows / 100 MB`} />
              <Metric label="Growth" value={ev.bounded ? 'bounded' : 'unbounded'} tone={ev.bounded ? 'ok' : 'bad'} sub={ev.partitionsPerConv ? `${fmt(ev.partitionsPerConv)} partition${ev.partitionsPerConv > 1 ? 's' : ''} for this chat` : 'spread by sender'} />
              <Metric label="Latest 50 reads" value={ev.latest.filtering ? 'all partitions' : `${fmt(ev.latest.partitions)} partition${ev.latest.partitions > 1 ? 's' : ''}`} tone={ev.latest.ok ? 'ok' : ev.latest.filtering ? 'bad' : 'warn'} sub={`${fmt(ev.latest.rows)} rows · ${ev.latest.nodes} of ${CASS.nodes} nodes`} />
              <Metric label="Sorted slice?" value={ev.latest.sorted ? 'yes' : 'no'} tone={ev.latest.sorted ? 'ok' : 'bad'} sub={ev.overwrite ? 'only 1 row survives' : ev.latest.sorted ? 'clustering order = read order' : 'sort in the app'} />
            </div>
          </section>

          <Exercises
            topic={topic}
            items={[
              {
                id: 'cassandra-bounded',
                hint: 'Checked at 2,000 msgs/day for 60 months: partitions under 100k rows / 100 MB, and latest 50 from **one** partition in clustering order.',
                status: `stress test: ${fmt(stress.rows)} rows/partition · latest 50 from ${stress.latest.filtering ? 'all' : fmt(stress.latest.partitions)} partition(s)${stress.latest.sorted ? '' : ', unsorted'}`,
              },
            ]}
          />
          <History changes={lab.changes} />
        </div>
      </aside>
    </div>
  );
}

function Ring({ s, ev, run }: { s: CState; ev: CEval; run: number }) {
  const dots = useMemo(() => dotsFor(s), [s]);
  const lit = (d: Dot) => ev.latest.filtering || (d.busy && d.recent < ev.latest.partitions);
  const litDots = dots.filter(lit);
  const replicas = new Set<number>();
  const quorum = new Set<number>();
  if (ev.latest.filtering) for (let i = 0; i < CASS.nodes; i++) replicas.add(i);
  else
    for (const d of litDots) {
      const o = ownerOf(angleOf(d.key));
      for (let k = 0; k < CASS.rf; k++) replicas.add((o + k) % CASS.nodes);
      quorum.add(o);
      quorum.add((o + 1) % CASS.nodes);
    }
  const R = 118;
  return (
    <div>
      <svg viewBox="0 0 320 320" className="mx-auto w-full max-w-[320px]">
        {NODE_ANG.map((a, i) => {
          const prev = NODE_ANG[(i + CASS.nodes - 1) % CASS.nodes];
          const a0 = i === 0 ? prev - 360 : prev;
          const on = replicas.has(i);
          return (
            <path
              key={i}
              d={arc(R, a0 + 1, a - 1)}
              fill="none"
              strokeWidth={on ? 7 : 5}
              strokeLinecap="round"
              stroke={ev.latest.filtering ? 'rgb(var(--c-bad) / 0.55)' : on ? (quorum.has(i) ? 'rgb(var(--c-accent) / 0.6)' : 'rgb(var(--c-accent) / 0.25)') : i % 2 ? 'rgb(var(--c-line))' : 'rgb(var(--c-faint) / 0.35)'}
              style={{ transition: 'stroke 0.4s' }}
            />
          );
        })}
        {NODE_ANG.map((a, i) => {
          const p = pt(R + 26, a);
          const on = replicas.has(i);
          return (
            <g key={i}>
              <rect x={p.x - 15} y={p.y - 9} width={30} height={18} rx={5} fill={on ? (ev.latest.filtering ? 'rgb(var(--c-bad) / 0.15)' : 'rgb(var(--c-accent) / 0.15)') : 'rgb(var(--c-surface))'} stroke={on ? (ev.latest.filtering ? 'rgb(var(--c-bad))' : 'rgb(var(--c-accent))') : 'rgb(var(--c-line))'} />
              <text x={p.x} y={p.y + 3.5} textAnchor="middle" className="fill-ink font-mono" fontSize={10}>
                N{i + 1}
              </text>
            </g>
          );
        })}
        {ev.latest.filtering && (
          <g className="animate-spin" style={{ transformOrigin: '160px 160px', transformBox: 'view-box', animationDuration: '2.4s' }}>
            <path d={`M 160 160 L ${pt(R + 6, 0).x} ${pt(R + 6, 0).y} A ${R + 6} ${R + 6} 0 0 1 ${pt(R + 6, 40).x} ${pt(R + 6, 40).y} Z`} fill="rgb(var(--c-bad) / 0.12)" />
          </g>
        )}
        {dots.map((d) => {
          const a = angleOf(d.key);
          const p = pt(R, a);
          const sz = sizeOf(d.rows);
          const r = 2.5 + 9.5 * Math.sqrt(Math.min(d.rows, 2 * CASS.maxRows) / (2 * CASS.maxRows));
          const on = lit(d);
          return (
            <motion.circle
              key={d.key}
              initial={{ cx: 160, cy: 160, r: 0, opacity: 0 }}
              animate={{ cx: p.x, cy: p.y, r, opacity: d.busy || ev.latest.filtering ? 1 : 0.55 }}
              transition={{ type: 'spring', stiffness: 160, damping: 20 }}
              fill={sz === 'ok' ? (d.busy ? 'rgb(var(--c-accent))' : 'rgb(var(--c-muted))') : SIZE_FILL[sz]}
              stroke={on ? 'rgb(var(--c-ink))' : 'rgb(var(--c-surface))'}
              strokeWidth={on ? 2 : 1}
            >
              <title>{`${d.key}: ${fmt(d.rows)} rows · token ${(a / 360).toFixed(3)} · N${ownerOf(a) + 1}`}</title>
            </motion.circle>
          );
        })}
        {!ev.latest.filtering &&
          litDots.slice(0, 12).map((d, i) => {
            const p = pt(R, angleOf(d.key));
            return (
              <motion.circle
                key={`${run}-${d.key}`}
                r={4}
                fill="rgb(var(--c-ok))"
                initial={{ cx: 160, cy: 160, opacity: 0 }}
                animate={{ cx: [160, p.x], cy: [160, p.y], opacity: [0, 1, 0] }}
                transition={{ delay: 0.3 + i * 0.45, duration: 0.8, times: [0, 0.8, 1] }}
              />
            );
          })}
        <circle cx={160} cy={160} r={22} fill="rgb(var(--c-surface))" stroke="rgb(var(--c-line))" />
        <text x={160} y={157} textAnchor="middle" className="fill-muted font-mono" fontSize={8.5}>
          coordinator
        </text>
        <text x={160} y={168} textAnchor="middle" className="fill-faint font-mono" fontSize={8}>
          {ev.latest.filtering ? 'scatter all' : `${litDots.length} partition${litDots.length === 1 ? '' : 's'}`}
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-muted">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-accent" />
          #general partitions
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-muted" />
          other chats
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-bad" />
          over 100k rows / 100 MB
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-accent/60" />
          QUORUM replicas read
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-faint">Dot size = rows in the partition. Each token range is owned by the next node clockwise, replicated to the 2 after it.</p>
    </div>
  );
}

function Growth({ s }: { s: CState }) {
  const W = 420;
  const H = 130;
  const pad = 28;
  const bw = (W - pad) / 60;
  const y = (rows: number) => H - 14 - (Math.log10(Math.max(1, rows)) / 8) * (H - 20);
  const lim = y(CASS.maxRows);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[1, 100, 10_000, 1_000_000, 100_000_000].map((v) => (
        <g key={v}>
          <line x1={pad} x2={W} y1={y(v)} y2={y(v)} stroke="rgb(var(--c-line))" strokeDasharray="2 3" />
          <text x={pad - 3} y={y(v) + 3} textAnchor="end" className="fill-faint font-mono" fontSize={8}>
            {fmt(v)}
          </text>
        </g>
      ))}
      {Array.from({ length: 60 }, (_, i) => {
        const m = i + 1;
        const rows = cassRows({ ...s, months: m });
        const sz = sizeOf(rows);
        const cur = m === s.months;
        return (
          <motion.rect
            key={m}
            x={pad + i * bw + 0.5}
            width={Math.max(1, bw - 1.2)}
            initial={false}
            animate={{ y: y(rows), height: Math.max(1, H - 14 - y(rows)) }}
            transition={{ duration: 0.35 }}
            fill={SIZE_FILL[sz]}
            opacity={m > s.months ? 0.15 : cur ? 1 : 0.55}
          />
        );
      })}
      <line x1={pad} x2={W} y1={lim} y2={lim} stroke="rgb(var(--c-bad))" strokeWidth={1.2} />
      <text x={W - 2} y={lim - 3} textAnchor="end" className="fill-bad font-mono" fontSize={8.5}>
        100k rows ≈ guidance limit
      </text>
      {[12, 24, 36, 48, 60].map((m) => (
        <text key={m} x={pad + (m - 0.5) * bw} y={H - 3} textAnchor="middle" className="fill-faint font-mono" fontSize={8}>
          {m / 12}y
        </text>
      ))}
    </svg>
  );
}

/** 32 cells = the busy partition's rows in on-disk (clustering) order; darker = newer. */
function DiskOrder({ s, ev, run }: { s: CState; ev: CEval; run: number }) {
  if (s.pk === 'msg' || s.pk === 'sender')
    return <p className="text-[12px] leading-snug text-bad">There is no "#general partition": its messages are scattered over {s.pk === 'msg' ? 'millions of one-row partitions' : 'every sender\'s partition'} on all nodes, mixed with other chats.</p>;
  if (ev.overwrite)
    return (
      <div className="flex items-center gap-2">
        <motion.div key={run} initial={{ scale: 1.4 }} animate={{ scale: 1 }} className="h-6 w-6 rounded bg-bad" />
        <span className="text-[12px] text-bad">1 row. Each INSERT replaced it: same primary key, last write wins.</span>
      </div>
    );
  const N = 32;
  const recency = Array.from({ length: N }, (_, i) => i); // 0 = newest
  let order: number[];
  if (s.ck === 'sent-desc') order = recency;
  else if (s.ck === 'sent-asc') order = [...recency].reverse();
  else order = [...recency].sort((a, b) => hash32(`r${a}`) - hash32(`r${b}`));
  const want = 8; // "latest 50" scaled to 32 cells
  const sliceIdx = new Set(order.map((r, pos) => ({ r, pos })).filter((x) => x.r < want).map((x) => x.pos));
  const readAll = s.ck === 'msgid';
  return (
    <div>
      <div className="flex items-center gap-1 font-mono text-[9.5px] text-faint">
        <span>first on disk</span>
        <span className="flex-1 border-t border-dashed border-line" />
        <span>last</span>
      </div>
      <div key={run} className="mt-1 flex gap-[2px]">
        {order.map((r, pos) => {
          const hit = readAll || sliceIdx.has(pos);
          const delay = 0.2 + (s.ck === 'sent-asc' ? N - 1 - pos : pos) * 0.035;
          return (
            <motion.div
              key={pos}
              title={`${r === 0 ? 'newest' : `${r} older`}`}
              className={cn('relative h-7 flex-1 rounded-sm', sliceIdx.has(pos) ? 'ring-1 ring-ok' : '')}
              style={{ background: `rgb(var(--c-accent) / ${0.12 + 0.8 * (1 - r / N)})` }}
              initial={{ y: 0 }}
              animate={hit ? { y: [0, -4, 0] } : { y: 0 }}
              transition={{ delay, duration: 0.3 }}
            />
          );
        })}
      </div>
      <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
        {s.ck === 'sent-desc' && <>The newest rows are <b className="text-ok">first on disk</b>: LIMIT 50 stops after a contiguous slice.</>}
        {s.ck === 'sent-asc' && <>Newest rows are <b className="text-warn">last on disk</b>: Cassandra reads the slice backwards (works, slightly more work per read).</>}
        {s.ck === 'msgid' && <>Rows are ordered by a random UUID: the newest 50 are <b className="text-bad">scattered</b>, so the whole partition must be read and sorted.</>}
      </p>
    </div>
  );
}
