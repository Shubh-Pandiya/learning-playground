import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/shared/cn';
import { LabFrame, pct, rng, Seg, Slider, Stat, useTicker } from './kit';

type Gran = 'none' | 'minute' | 'hour';
type Index = 'none' | 'inverted' | 'startree';
type Query = 'filter' | 'groupby';

interface Segment {
  id: number;
  start: number;
  end: number; // minutes; for the consuming segment this is "now"
  events: number;
  inEvents: number;
  minKeys: Set<string>;
  hourKeys: Set<string>;
  minIn: number;
  hourIn: number;
}

const COUNTRIES: [string, number][] = [
  ['US', 0.3],
  ['IN', 0.2],
  ['BR', 0.12],
  ['DE', 0.1],
  ['GB', 0.1],
  ['JP', 0.08],
  ['FR', 0.06],
  ['CA', 0.04],
];
const DEVICES: [string, number][] = [
  ['mobile', 0.6],
  ['desktop', 0.3],
  ['tablet', 0.1],
];
const TICK_MS = 200; // 1 tick = 1 simulated minute
const RETENTION = 360; // minutes kept on the timeline (6 h)
const PREWARM = 240;
const IN = 1; // index of the filtered country

const emptySeg = (id: number, start: number): Segment => ({
  id,
  start,
  end: start,
  events: 0,
  inEvents: 0,
  minKeys: new Set(),
  hourKeys: new Set(),
  minIn: 0,
  hourIn: 0,
});

function fresh(rate: number, handoff: number) {
  const st = {
    now: 0,
    segs: [] as Segment[],
    rt: emptySeg(0, 0),
    nextId: 1,
    handoffs: 0,
    lats: [] as number[],
    cfg: '',
    rand: rng(5),
  };
  for (let i = 0; i < PREWARM; i++) step(st, rate, handoff);
  return st;
}
type Sim = ReturnType<typeof fresh>;

/** Ingest one minute of events into the consuming segment; seal it every `handoff` minutes. */
function step(
  st: {
    now: number;
    segs: Segment[];
    rt: Segment;
    nextId: number;
    handoffs: number;
    rand: () => number;
  },
  rate: number,
  handoff: number,
) {
  const rt = st.rt;
  const m = st.now;
  COUNTRIES.forEach(([, wc], ci) =>
    DEVICES.forEach(([, wd], di) => {
      const c = Math.round(rate * wc * wd * (0.5 + st.rand()));
      if (!c) return;
      rt.events += c;
      if (ci === IN) rt.inEvents += c;
      const mk = `${m}|${ci}|${di}`;
      const hk = `${Math.floor(m / 60)}|${ci}|${di}`;
      if (!rt.minKeys.has(mk)) {
        rt.minKeys.add(mk);
        if (ci === IN) rt.minIn++;
      }
      if (!rt.hourKeys.has(hk)) {
        rt.hourKeys.add(hk);
        if (ci === IN) rt.hourIn++;
      }
    }),
  );
  st.now++;
  rt.end = st.now;
  if (st.now - rt.start >= handoff) {
    st.segs.push(rt);
    st.rt = emptySeg(st.nextId++, st.now);
    st.handoffs++;
  }
  st.segs = st.segs.filter((x) => x.end > st.now - RETENTION);
}

/** Rows a segment stores under a rollup spec. With user_id as a dimension almost nothing collapses. */
function rows(sg: Segment, g: Gran, userDim: boolean, inOnly = false) {
  const ev = inOnly ? sg.inEvents : sg.events;
  if (g === 'none') return ev;
  if (userDim) return Math.round(ev * (g === 'minute' ? 0.97 : 0.75));
  return g === 'minute' ? (inOnly ? sg.minIn : sg.minKeys.size) : inOnly ? sg.hourIn : sg.hourKeys.size;
}

export default function OlapLab() {
  const [gran, setGran] = useState<Gran>('none');
  const [index, setIndex] = useState<Index>('none');
  const [query, setQuery] = useState<Query>('filter');
  const [range, setRange] = useState(60);
  const [handoff, setHandoff] = useState(30);
  const [rate, setRate] = useState(1000);
  const [userDim, setUserDim] = useState(false);
  const [running, setRunning] = useState(true);
  const [, force] = useState(0);
  const s = useRef<Sim>(fresh(rate, handoff));

  // query plan over the current segments
  const plan = (st: Sim) => {
    const all = [...st.segs, st.rt];
    const from = st.now - range;
    let scanned = 0;
    let inRange = 0;
    let queried = 0;
    const per = new Map<number, number>();
    all.forEach((sg) => {
      if (sg.end <= from) return; // pruned by the segment's time metadata
      queried++;
      const total = rows(sg, gran, userDim);
      inRange += total;
      const idx = index === 'startree' && sg === st.rt ? 'inverted' : index; // star-tree is built when a segment is sealed
      const n = idx === 'startree' ? Math.min(total, query === 'filter' ? DEVICES.length : COUNTRIES.length) : idx === 'inverted' && query === 'filter' ? rows(sg, gran, userDim, true) : total;
      per.set(sg.id, n);
      scanned += n;
    });
    const latency = 3 + 0.6 * queried + scanned / 1500; // ~1.5M rows/s of column scan + per-segment fan-out cost
    return {
      all,
      from,
      scanned,
      inRange,
      queried,
      pruned: all.length - queried,
      per,
      latency,
    };
  };

  useTicker(running, TICK_MS, () => {
    const st = s.current;
    step(st, rate, handoff);
    const cfg = `${gran}${index}${query}${range}${userDim}`;
    if (cfg !== st.cfg) {
      st.lats = [];
      st.cfg = cfg;
    }
    const base = plan(st).latency;
    for (let i = 0; i < 4; i++) {
      const r = st.rand();
      st.lats.push(base * (0.8 + 0.4 * st.rand()) + (r < 0.03 ? base * 1.5 : 0)); // occasional GC / slow-replica tail
    }
    st.lats = st.lats.slice(-200);
    force((x) => x + 1);
  });

  const st = s.current;
  const p = plan(st);
  const raw = p.all.reduce((a, x) => a + x.events, 0);
  const stored = p.all.reduce((a, x) => a + rows(x, gran, userDim), 0);
  const ratio = stored ? raw / stored : 1;
  const p99 = st.lats.length ? pct(st.lats, 0.99) : p.latency;
  const rtRows = rows(st.rt, gran, userDim);

  const lines: string[] = [];
  if (gran === 'none')
    lines.push(
      `No rollup: every event is a row, so ${raw.toLocaleString()} events are stored and scanned as-is. You keep full detail (per-user, exact timestamp, any future question) and pay for it in storage and scan time.`,
    );
  else if (userDim)
    lines.push(
      `user_id is a dimension, so almost every (bucket, country, device, user) is unique and rollup only gets ${ratio.toFixed(1)}×. Rollup works only on low-cardinality dimensions; keep high-cardinality ids out of the rollup spec, or use a sketch (HLL/theta) metric for distinct users.`,
    );
  else
    lines.push(
      `Rollup by ${gran}: all events that share (${gran}, country, device) collapse into one row holding SUM(clicks) and COUNT(*): ${raw.toLocaleString()} events → ${stored.toLocaleString()} rows (${ratio.toFixed(0)}×). The price: per-event detail is gone forever. No user_id, no exact timestamps, no COUNT(DISTINCT) except via sketches, and the spec is fixed at ingestion (changing it means re-indexing from the raw source).`,
    );
  if (index === 'none') lines.push(`No index: each queried segment scans its whole country and device columns, ${p.scanned.toLocaleString()} rows.`);
  else if (index === 'inverted')
    lines.push(
      query === 'filter'
        ? `Inverted (bitmap) index: country='IN' looks up a bitmap and reads only the matching ~20% of rows. Bitmaps do nothing for an unfiltered GROUP BY: switch the query and watch rows scanned jump back up.`
        : 'Inverted index, but this query has no filter: the bitmap is useless and every row in range is scanned. Indexes help selective predicates, not full aggregations.',
    );
  else
    lines.push(
      `Star-tree (Pinot): at segment seal time it pre-aggregates every (country, device) combination, so a query reads a handful of records per segment however many raw rows it holds, giving rollup-like speed while keeping raw rows. It costs extra storage and build time and only answers queries on the dimensions and metrics in the tree. The consuming segment has no star-tree yet and falls back to the bitmap.`,
    );
  lines.push(
    `The broker pruned ${p.pruned} of ${p.all.length} segments by their time range without touching them; a narrower WHERE time > … is the cheapest optimization there is. ${handoff <= 15 ? 'Short handoff = many small segments: per-segment fan-out overhead adds up.' : handoff >= 60 ? 'Long handoff = a big in-memory consuming segment: more heap, and more Kafka to replay if the server dies before handoff.' : ''}`,
  );

  // layout
  const X0 = 20;
  const X1 = 540;
  const k = (X1 - X0) / RETENTION;
  const tx = (m: number) => X0 + (m - (st.now - RETENTION)) * k;
  const maxRef = Math.max(10, ...p.all.map((x) => x.events));
  const bh = (n: number) => (n <= 0 ? 0 : 4 + 70 * (Math.log10(1 + n) / Math.log10(1 + maxRef)));
  const BASE = 112;
  const idxLabel = index === 'none' ? 'no index' : index === 'inverted' ? 'bitmap index' : 'star-tree';

  return (
    <LabFrame
      title="OLAP: segments, rollup & indexes"
      goal="Switch rollup from none to minute to hour and watch stored rows collapse; then try each index and query shape, and narrow the time range to see segments get pruned and p99 fall."
      running={running}
      onToggle={() => setRunning((r) => !r)}
      onReset={() => {
        s.current = fresh(rate, handoff);
        force((x) => x + 1);
      }}
      controls={
        <>
          <Seg
            label="Rollup granularity (ingestion spec)"
            value={gran}
            options={[
              { value: 'none', label: 'none (raw)' },
              { value: 'minute', label: 'minute' },
              { value: 'hour', label: 'hour' },
            ]}
            onChange={setGran}
          />
          <Seg
            label="Index"
            value={index}
            options={[
              { value: 'none', label: 'none' },
              { value: 'inverted', label: 'inverted (bitmap)' },
              { value: 'startree', label: 'star-tree' },
            ]}
            onChange={setIndex}
          />
          <Seg
            label="Query"
            value={query}
            options={[
              { value: 'filter', label: "WHERE country='IN' GROUP BY device" },
              { value: 'groupby', label: 'GROUP BY country (no filter)' },
            ]}
            onChange={setQuery}
          />
          <Seg
            label="Time range"
            value={range}
            options={[
              { value: 15, label: 'last 15 min' },
              { value: 60, label: 'last 1 h' },
              { value: 360, label: 'last 6 h' },
            ]}
            onChange={setRange}
          />
          <Slider label="Segment handoff every" value={handoff} min={10} max={90} step={5} onChange={setHandoff} fmt={(v) => `${v} min`} />
          <Slider label="Ingest rate" value={rate} min={200} max={3000} step={100} onChange={setRate} fmt={(v) => `${v.toLocaleString()} events/min`} />
          <Seg
            label="Dimensions"
            value={userDim ? 'user' : 'low'}
            options={[
              { value: 'low', label: 'country, device' },
              { value: 'user', label: '+ user_id (high cardinality)' },
            ]}
            onChange={(v) => setUserDim(v === 'user')}
          />
        </>
      }
      stats={
        <>
          <Stat
            label="Raw events → stored rows"
            value={`${(raw / 1000).toFixed(0)}k → ${stored >= 10000 ? `${(stored / 1000).toFixed(0)}k` : stored.toLocaleString()}`}
            tone={ratio > 20 ? 'ok' : ratio > 3 ? 'info' : undefined}
            sub={`rollup ratio ${ratio.toFixed(ratio < 10 ? 1 : 0)}×`}
          />
          <Stat label="Segments" value={`${st.segs.length} + 1`} sub={`historical + consuming · ${p.pruned} pruned`} />
          <Stat
            label="Rows scanned"
            value={p.scanned.toLocaleString()}
            tone={p.scanned > 100000 ? 'bad' : p.scanned > 10000 ? 'warn' : 'ok'}
            sub={`of ${p.inRange.toLocaleString()} rows in ${p.queried} segments`}
          />
          <Stat label="Query p99" value={`${p99.toFixed(0)} ms`} tone={p99 > 200 ? 'bad' : p99 > 50 ? 'warn' : 'ok'} sub={`${idxLabel} · last 200 queries`} />
        </>
      }
      insight={lines.join(' ')}
    >
      <svg viewBox="0 0 560 74" className="w-full">
        {[
          {
            x: 8,
            w: 84,
            t: 'Kafka',
            sub: `${rate.toLocaleString()} ev/min`,
            c: '--c-line',
          },
          {
            x: 112,
            w: 150,
            t: 'real-time server',
            sub: `consuming seg · ${rtRows.toLocaleString()} rows`,
            c: '--c-accent',
          },
          {
            x: 282,
            w: 110,
            t: 'deep storage (S3)',
            sub: `${st.handoffs} segments pushed`,
            c: '--c-line',
          },
          {
            x: 412,
            w: 140,
            t: 'historical servers',
            sub: `${st.segs.length} immutable · ${idxLabel}`,
            c: '--c-info',
          },
        ].map((b, i) => (
          <g key={b.t}>
            <rect x={b.x} y={8} width={b.w} height={40} rx={8} fill="rgb(var(--c-surface))" stroke={`rgb(var(${b.c}))`} strokeWidth={1.4} />
            <text x={b.x + b.w / 2} y={24} textAnchor="middle" className="fill-ink font-mono text-[9.5px] font-semibold">
              {b.t}
            </text>
            <text x={b.x + b.w / 2} y={38} textAnchor="middle" className="fill-faint font-mono text-[8.5px]">
              {b.sub}
            </text>
            {i < 3 && <line x1={b.x + b.w} y1={28} x2={b.x + b.w + 20} y2={28} stroke="rgb(var(--c-faint))" />}
          </g>
        ))}
        <rect x={116} y={42} width={142} height={3} rx={1.5} fill="rgb(var(--c-line) / 0.5)" />
        <rect x={116} y={42} width={142 * Math.min(1, (st.now - st.rt.start) / handoff)} height={3} rx={1.5} fill="rgb(var(--c-accent))" />
        <motion.rect
          key={st.handoffs}
          y={22}
          width={12}
          height={12}
          rx={2}
          fill="rgb(var(--c-accent))"
          initial={{ x: 250, opacity: 1 }}
          animate={{ x: 470, opacity: 0 }}
          transition={{ duration: 1.4, ease: 'easeOut' }}
        />
        <text x={8} y={66} className="fill-faint font-mono text-[8.5px]">
          mutable in-RAM segment, queryable at once → every {handoff} min sealed, columnar, indexed → S3 → historicals
        </text>
      </svg>
      <svg viewBox="0 0 560 140" className="w-full">
        <rect x={tx(p.from)} y={14} width={X1 - tx(p.from)} height={BASE - 12} fill="rgb(var(--c-accent) / 0.06)" stroke="rgb(var(--c-accent) / 0.6)" strokeDasharray="4 3" />
        <text x={X1 - 2} y={10} textAnchor="end" className="fill-accent font-mono text-[8.5px]">
          WHERE time &gt; now() - {range >= 60 ? `${range / 60} h` : `${range} min`}
        </text>
        <text x={X0} y={10} className="fill-muted font-mono text-[9px]">
          segments over the last 6 h · height = rows stored (log)
        </text>
        {p.all.map((sg) => {
          const n = rows(sg, gran, userDim);
          const h = bh(n);
          const scanned = p.per.get(sg.id);
          const live = sg === st.rt;
          const x = Math.max(X0, tx(sg.start));
          const w = Math.max(2, tx(sg.end) - x - 1.5);
          const sh = scanned === undefined || !n ? 0 : Math.max(1.5, h * (scanned / n));
          return (
            <g key={sg.id}>
              <rect x={x} y={BASE - bh(sg.events)} width={w} height={bh(sg.events)} rx={2} fill="none" stroke="rgb(var(--c-faint) / 0.5)" strokeDasharray="2 2" />
              <motion.rect
                x={x}
                width={w}
                rx={2}
                animate={{ y: BASE - h, height: h }}
                transition={{ duration: 0.35 }}
                fill={scanned === undefined ? 'rgb(var(--c-faint) / 0.18)' : live ? 'rgb(var(--c-accent) / 0.25)' : 'rgb(var(--c-info) / 0.25)'}
                stroke={live ? 'rgb(var(--c-accent))' : scanned === undefined ? 'rgb(var(--c-faint) / 0.4)' : 'rgb(var(--c-info))'}
                strokeDasharray={live ? '3 2' : undefined}
              />
              {sh > 0 && <motion.rect x={x + 1} width={Math.max(1, w - 2)} rx={1} fill="rgb(var(--c-ok))" animate={{ y: BASE - sh, height: sh }} transition={{ duration: 0.35 }} />}
              {w > 26 && (
                <text x={x + w / 2} y={BASE - h - 3} textAnchor="middle" className={cn('font-mono text-[7.5px]', scanned === undefined ? 'fill-faint' : 'fill-ink')}>
                  {n >= 1000 ? `${(n / 1000).toFixed(0)}k` : n}
                </text>
              )}
            </g>
          );
        })}
        <line x1={X0} y1={BASE} x2={X1} y2={BASE} stroke="rgb(var(--c-line))" />
        {[360, 180, 60, 0].map((m) => (
          <text key={m} x={tx(st.now - m)} y={BASE + 11} textAnchor={m === 0 ? 'end' : 'middle'} className="fill-faint font-mono text-[8.5px]">
            {m === 0 ? 'now' : `-${m / 60}h`}
          </text>
        ))}
        <text x={X0} y={136} className="fill-faint font-mono text-[8.5px]">
          ▢ dashed outline = raw event count · <tspan className="fill-info">■ queried</tspan> · <tspan className="fill-accent">▢ consuming</tspan> · grey = pruned ·{' '}
          <tspan className="fill-ok">■ rows actually scanned</tspan>
        </text>
      </svg>
      <div className="mx-1 mb-1 rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-muted">
        <span className="text-ink">broker:</span> prune <span className="text-ok">{p.pruned}</span> of {p.all.length} segments by time → scatter to {p.queried} segments →{' '}
        {index === 'startree' ? 'walk star-tree (consuming seg: bitmap)' : index === 'inverted' && query === 'filter' ? "bitmap lookup country='IN'" : 'full column scan'} → scan{' '}
        <span className={p.scanned > 100000 ? 'text-bad' : 'text-ink'}>{p.scanned.toLocaleString()}</span> rows → merge partial {query === 'filter' ? 'GROUP BY device' : 'GROUP BY country'} → ~
        {p.latency.toFixed(0)} ms
      </div>
    </LabFrame>
  );
}
