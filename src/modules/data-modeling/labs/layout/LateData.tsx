import { useMemo, useState } from 'react';
import { LayoutGroup, motion } from 'framer-motion';
import { cn } from '@/shared/cn';
import type { Change } from '../../ui/ChangeCard';
import { dayLabel } from './engine';

type Key = 'event' | 'ingest';

interface Ev {
  id: number;
  eventDay: number;
  delayH: number;
  arrivalDay: number;
}

/** Deterministic sample: 90 events over 7 days, ~80% on time, ~12% hours late, ~8% days late (offline phones). */
const EVENTS: Ev[] = (() => {
  let s = 42;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const out: Ev[] = [];
  for (let id = 0; out.length < 90; id++) {
    const eventDay = Math.floor(rnd() * 7);
    const hour = Math.floor(rnd() * 24);
    const r = rnd();
    const delayH = r < 0.8 ? rnd() * 0.5 : r < 0.92 ? 1 + rnd() * 20 : 24 + rnd() * 72;
    const arrivalDay = eventDay - Math.floor((hour + delayH) / 24);
    if (arrivalDay < 0) continue;
    out.push({ id, eventDay, delayH, arrivalDay });
  }
  return out;
})();

const LATENESS = [0, 24, 72] as const;
type Lateness = (typeof LATENESS)[number];

function stats(key: Key, lateness: Lateness) {
  const today = EVENTS.filter((e) => e.arrivalDay === 0);
  const late = EVENTS.filter((e) => e.arrivalDay < e.eventDay);
  const dropped = EVENTS.filter((e) => e.delayH > lateness && e.arrivalDay < e.eventDay);
  const partitionsToday = key === 'event' ? new Set(today.map((e) => e.eventDay)).size : 1;
  const foldersForDay = key === 'event' ? 1 : lateness === 0 ? 4 : 1 + Math.ceil(lateness / 24);
  return { late: late.length, dropped: dropped.length, partitionsToday, foldersForDay, total: EVENTS.length };
}

export function LateData({ onChange }: { onChange: (c: Change) => void }) {
  const [key, setKey] = useState<Key>('event');
  const [lateness, setLateness] = useState<Lateness>(24);
  const s = useMemo(() => stats(key, lateness), [key, lateness]);

  const apply = (k: Key, l: Lateness) => {
    const a = stats(key, lateness);
    const b = stats(k, l);
    const lines: Change['lines'] = [];
    if (k !== key)
      lines.push(
        k === 'ingest'
          ? { tone: 'warn', text: `Late events now land in **today’s** folder. Writes are append-only (partitions written today: ${a.partitionsToday} → 1), but a query for event day D must scan D…D+${b.foldersForDay - 1} and filter on \`event_ts\`.` }
          : { tone: 'ok', text: `Late events go back to their **event day** partition. A query for day D reads 1 folder, but today’s load rewrites ${b.partitionsToday} partitions and their aggregates must be recomputed.` },
      );
    if (l !== lateness)
      lines.push(
        b.dropped < a.dropped
          ? { tone: 'ok', text: `Allowed lateness ${lateness}h → ${l}h: events missing from finalised daily numbers ${a.dropped} → ${b.dropped}. Cost: day D is final only at D+1 + ${l}h, and streaming state grows.` }
          : { tone: 'warn', text: `Allowed lateness ${lateness}h → ${l}h: numbers finalise sooner, but ${b.dropped} of ${b.total} events (${Math.round((b.dropped / b.total) * 100)}%) now miss their day’s aggregate and need a correction job.` },
      );
    onChange({ key: `late-${k}-${l}-${Date.now()}`, title: `Late data: partition by \`${k === 'event' ? 'event_date' : 'ingest_date'}\`, allowed lateness ${l}h`, lines });
    setKey(k);
    setLateness(l);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <div className="eyebrow mb-1">Store rows in the partition of</div>
          <div className="flex gap-1">
            {(['event', 'ingest'] as const).map((k) => (
              <button
                key={k}
                onClick={() => k !== key && apply(k, lateness)}
                className={cn('rounded-md border px-2 py-1 font-mono text-[11px]', key === k ? 'border-accent bg-accent/10 text-ink' : 'border-line bg-surface text-muted hover:border-accent/50')}
              >
                {k === 'event' ? 'event_date (event_ts)' : 'ingest_date (arrival)'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="eyebrow mb-1">Watermark: allowed lateness</div>
          <div className="flex gap-1">
            {LATENESS.map((l) => (
              <button
                key={l}
                onClick={() => l !== lateness && apply(key, l)}
                className={cn('rounded-md border px-2 py-1 font-mono text-[11px]', lateness === l ? 'border-accent bg-accent/10 text-ink' : 'border-line bg-surface text-muted hover:border-accent/50')}
              >
                {l}h
              </button>
            ))}
          </div>
        </div>
      </div>

      <LayoutGroup>
        <div className="grid grid-cols-7 gap-1.5">
          {[6, 5, 4, 3, 2, 1, 0].map((d) => {
            const here = EVENTS.filter((e) => (key === 'event' ? e.eventDay : e.arrivalDay) === d);
            const written = d === 0 || (key === 'event' && EVENTS.some((e) => e.arrivalDay === 0 && e.eventDay === d));
            return (
              <div key={d} className={cn('rounded-lg border bg-surface p-1.5', written ? 'border-accent/60' : 'border-line')}>
                <div className="font-mono text-[9.5px] leading-tight text-ink">{key === 'event' ? 'event_date' : 'ingest_date'}=</div>
                <div className="font-mono text-[10px] text-ink">{dayLabel(d).slice(5)}</div>
                <div className={cn('font-mono text-[9px]', written ? 'text-accent' : 'text-faint')}>{written ? 'written today' : d === 0 ? '' : 'closed'}</div>
                <div className="mt-1 flex min-h-[90px] flex-wrap content-start gap-[3px]">
                  {here.map((e) => {
                    const isLate = e.arrivalDay < e.eventDay;
                    const tone = !isLate ? 'bg-ink/35' : e.delayH > lateness ? 'bg-bad' : key === 'event' ? 'bg-warn' : 'bg-info';
                    return (
                      <motion.span
                        key={e.id}
                        layoutId={`ev-${e.id}`}
                        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                        className={cn('block h-2.5 w-2.5 rounded-full', tone, e.arrivalDay === 0 && 'ring-1 ring-accent ring-offset-1 ring-offset-surface')}
                        title={`event day ${dayLabel(e.eventDay)}, arrived ${Math.round(e.delayH)}h late`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </LayoutGroup>

      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-muted">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-ink/35" /> on time
        </span>
        {key === 'event' ? (
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-warn" /> late, within lateness: reopens an old partition
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-info" /> late, within lateness: sits in a later folder
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-bad" /> beyond the watermark: misses the finalised aggregate
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full ring-1 ring-accent" /> arrived in today’s batch
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[
          ['late events', `${s.late} / ${s.total}`, 'text-ink'],
          ['partitions today’s load writes', String(s.partitionsToday), s.partitionsToday > 1 ? 'text-warn' : 'text-ok'],
          ['folders to read for one event day', String(s.foldersForDay), s.foldersForDay > 1 ? 'text-warn' : 'text-ok'],
          ['miss the daily aggregate', String(s.dropped), s.dropped ? 'text-bad' : 'text-ok'],
        ].map(([k, v, c]) => (
          <div key={k} className="rounded-lg border border-line bg-surface px-2.5 py-2">
            <div className="eyebrow !text-[9px]">{k}</div>
            <div className={cn('font-mono text-[15px] font-semibold', c)}>{v}</div>
          </div>
        ))}
      </div>
      <p className="text-[12px] leading-relaxed text-muted">
        {key === 'event'
          ? 'Partitioning by event time keeps reads exact (one folder per day) at the cost of rewriting old partitions when stragglers arrive: use idempotent MERGE / INSERT OVERWRITE of the touched days and recompute their aggregates.'
          : 'Partitioning by arrival keeps writes append-only and replays simple, but every event-time query must widen its scan by the lateness bound and filter on event_ts. Most teams store by event day and drive incremental jobs from ingest_ts.'}
      </p>
    </div>
  );
}
