import { ArrowRight, CircleAlert, CircleCheck, History, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/shared/cn';
import type { ChangeEntry, MetricDelta } from '../engine/diff';

const ACTION_LABEL: Record<ChangeEntry['action'], string> = {
  add: 'added',
  remove: 'removed',
  connect: 'wired',
  disconnect: 'unwired',
  scale: 'scaled',
  kill: 'failure',
  restore: 'restored',
  traffic: 'traffic',
  reset: 'reset',
};

export function DeltaChip({ d }: { d: MetricDelta }) {
  const tone = d.better === null ? 'border-line text-muted' : d.better ? 'border-ok/40 bg-ok/[0.07] text-ok' : 'border-bad/40 bg-bad/[0.07] text-bad';
  const Icon = d.better === null ? ArrowRight : d.better ? TrendingUp : TrendingDown;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] leading-tight', tone)}>
      <Icon size={11} className="shrink-0" />
      <span className="text-ink/70">{d.label}</span>
      <span>
        {d.from} → <b>{d.to}</b>
      </span>
    </span>
  );
}

export function ChangeCard({ c, compact }: { c: ChangeEntry; compact?: boolean }) {
  const scoreDelta = c.score.to - c.score.from;
  const nothing = !c.deltas.length && !c.loads.length && !c.gained.length && !c.risks.length;
  return (
    <div className="rounded-lg border border-line bg-surface p-2.5">
      <div className="flex items-baseline gap-2">
        <span className="rounded bg-sunken px-1 font-mono text-[9.5px] uppercase tracking-wider text-faint">{ACTION_LABEL[c.action]}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold">{c.title}</span>
        {scoreDelta !== 0 && (
          <span className={cn('font-mono text-[11px]', scoreDelta > 0 ? 'text-ok' : 'text-bad')}>
            {scoreDelta > 0 ? '+' : ''}
            {scoreDelta}%
          </span>
        )}
      </div>
      {nothing && <p className="mt-1 text-[11.5px] text-faint">No measurable effect yet — it probably isn’t connected to the request path.</p>}
      {(c.deltas.length > 0 || c.loads.length > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {c.deltas.map((d) => (
            <DeltaChip key={d.key} d={d} />
          ))}
          {!compact && c.loads.map((d) => <DeltaChip key={d.key} d={d} />)}
        </div>
      )}
      {!compact && (c.gained.length > 0 || c.risks.length > 0) && (
        <ul className="mt-1.5 space-y-0.5">
          {c.gained.map((g, i) => (
            <li key={`g${i}`} className="flex gap-1.5 text-[11.5px] leading-snug text-ok">
              <CircleCheck size={12} className="mt-0.5 shrink-0" />
              <span>{g}</span>
            </li>
          ))}
          {c.risks.map((r, i) => (
            <li key={`r${i}`} className="flex gap-1.5 text-[11.5px] leading-snug text-warn">
              <CircleAlert size={12} className="mt-0.5 shrink-0" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ChangeLog({ log }: { log: ChangeEntry[] }) {
  if (!log.length)
    return (
      <div className="rounded-lg border border-dashed border-line p-4 text-center text-[12px] text-muted">
        <History size={18} className="mx-auto mb-1 text-faint" />
        Every change you make — adding, wiring, scaling, killing, traffic — lands here with its effect on throughput, latency, errors, availability, cost and the new risks it brings.
      </div>
    );
  return (
    <div className="space-y-2">
      <p className="text-[11.5px] text-faint">Newest first. Green = better, red = worse. Read the risks: every fix buys a new tradeoff.</p>
      {log.map((c) => (
        <ChangeCard key={c.id} c={c} />
      ))}
    </div>
  );
}
