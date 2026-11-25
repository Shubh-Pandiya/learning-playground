import type { ReactNode } from 'react';
import { CheckCircle2, Circle, XCircle } from 'lucide-react';
import { cn } from '@/shared/cn';
import { ProgressBar } from '@/shared/ui';
import type { Closeness, ReqResult } from '../engine/evaluate';
import type { Metrics } from '../engine/simulate';
import type { Workload } from '../types';
import { downtime, fmtAvail, fmtCost, fmtMs, fmtPct, fmtQps } from './format';

type T = 'ok' | 'warn' | 'bad' | 'neutral';
const TONE: Record<T, string> = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', neutral: 'text-ink' };

function Metric({ label, value, sub, tone = 'neutral', wide }: { label: string; value: ReactNode; sub?: ReactNode; tone?: T; wide?: boolean }) {
  return (
    <div className={cn('rounded-lg border border-line bg-surface px-2.5 py-2', wide && 'col-span-2')}>
      <div className="eyebrow !text-[9.5px]">{label}</div>
      <div className={cn('mt-0.5 font-mono text-[15px] font-semibold leading-tight transition-colors', TONE[tone])}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-muted">{sub}</div>}
    </div>
  );
}

export interface CapabilityProps {
  m: Metrics;
  wl: Workload;
  traffic: number;
  nameOf: (id: string) => string;
}

/** "What the system is capable of right now." */
export function Capabilities({ m, wl, traffic, nameOf }: CapabilityProps) {
  const target = wl.qps;
  const errTone: T = m.errorRate < 0.01 ? 'ok' : m.errorRate < 0.2 ? 'warn' : 'bad';
  return (
    <div className="grid grid-cols-2 gap-2">
      <Metric
        label="Max throughput"
        value={m.connected ? fmtQps(m.maxQps) : '—'}
        tone={!m.connected ? 'bad' : m.maxQps >= target ? 'ok' : m.maxQps >= target * 0.6 ? 'warn' : 'bad'}
        sub={`peak target ${fmtQps(target)}`}
      />
      <Metric
        label={`Errors @ ${traffic === 1 ? 'peak' : `${traffic}× peak`}`}
        value={m.connected ? fmtPct(m.errorRate, m.errorRate < 0.1 && m.errorRate > 0 ? 1 : 0) : '100%'}
        tone={m.connected ? errTone : 'bad'}
        sub={m.connected ? `reads ${fmtPct(m.readOk)} ok · writes ${fmtPct(m.writeOk)} ok` : 'clients reach nothing that answers'}
      />
      <Metric label="Latency (≈p99)" value={m.connected ? fmtMs(m.p99) : '—'} tone={m.p99 <= 150 ? 'ok' : m.p99 <= 400 ? 'warn' : 'bad'} sub="napkin sum of hops" />
      <Metric
        label="Availability"
        value={fmtAvail(m.availability)}
        tone={m.availability >= 0.999 ? 'ok' : m.availability >= 0.99 ? 'warn' : 'bad'}
        sub={downtime(m.availability)}
      />
      <Metric
        wide
        label="Single points of failure"
        value={m.spofs.length ? `${m.spofs.length} on the request path` : 'None'}
        tone={m.spofs.length ? 'bad' : 'ok'}
        sub={m.spofs.length ? m.spofs.map(nameOf).join(' · ') : 'Any one node can die without taking the request path down.'}
      />
      <Metric label="Durability" value={['None', 'Single copy', 'Replicated', 'Managed'][m.durability.level]} tone={m.durability.level >= 2 ? 'ok' : m.durability.level === 1 ? 'warn' : 'bad'} sub={m.durability.label} />
      <Metric label="Cost" value={fmtCost(m.cost)} sub="relative, rough" />
      <Metric wide label="Consistency model" value={<span className="text-[13px]">{m.consistency.join(' · ')}</span>} />
      {(m.backlog > 0 || m.throttled > 0 || m.duplicates > 0) && (
        <div className="col-span-2 grid grid-cols-3 gap-2">
          <Metric label="Backlog" value={m.backlog > 0 ? `+${fmtQps(m.backlog)}` : '0'} tone={m.backlog > 0 ? 'warn' : 'ok'} />
          <Metric label="Throttled" value={m.throttled > 0 ? fmtQps(m.throttled) : '0'} tone={m.throttled > 0 ? 'warn' : 'neutral'} />
          <Metric label="Dup writes" value={m.duplicates > 0 ? fmtQps(m.duplicates) : '0'} tone={m.duplicates > 0 ? 'bad' : 'ok'} />
        </div>
      )}
    </div>
  );
}

const IS_PROBLEM = /^(Remove|Fix|Writes must|Nothing consumes)/;

/** `concealGaps` (challenge mode) lists only problems with what's built and hides what's still to add, so the score can't give the answer away. */
export function ClosenessView({ close, reqs, solved, concealGaps = false }: { close: Closeness; reqs: ReqResult[]; solved: boolean; concealGaps?: boolean }) {
  const met = reqs.filter((r) => r.met).length;
  const shown = concealGaps ? close.missing.filter((m) => IS_PROBLEM.test(m)) : close.missing;
  const hidden = close.missing.length - shown.length;
  const tone = solved ? 'ok' : close.score >= 70 ? 'accent' : close.score >= 40 ? 'warn' : 'bad';
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="eyebrow">Closeness to reference</span>
          <span className={cn('font-mono text-lg font-semibold', solved ? 'text-ok' : 'text-ink')}>{close.score}%</span>
        </div>
        <ProgressBar value={close.score} max={100} tone={tone} size="sm" />
      </div>
      <div>
        <div className="eyebrow mb-1.5">
          Requirements {met}/{reqs.length}
        </div>
        <ul className="space-y-1.5">
          {reqs.map(({ req, met }) => (
            <li key={req.id} className="flex gap-2 text-[12.5px] leading-snug">
              {met ? <CheckCircle2 size={15} className="mt-px shrink-0 text-ok" /> : <Circle size={15} className="mt-px shrink-0 text-faint" />}
              <span className={met ? 'text-muted line-through decoration-ok/40' : 'text-ink'}>{req.text}</span>
            </li>
          ))}
        </ul>
      </div>
      {close.missing.length > 0 && (
        <div>
          <div className="eyebrow mb-1.5">{concealGaps ? 'Problems' : 'Still missing'}</div>
          <ul className="space-y-1">
            {concealGaps && hidden > 0 && (
              <li className="flex gap-2 text-[12.5px] leading-snug text-muted">
                <Circle size={14} className="mt-px shrink-0 text-warn" />
                <span>
                  {hidden} gap{hidden > 1 ? 's' : ''} vs. the reference, hidden in Challenge. Reason from the requirements, or use a hint.
                </span>
              </li>
            )}
            {shown.slice(0, 6).map((m, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-muted">
                <XCircle size={14} className={cn('mt-px shrink-0', IS_PROBLEM.test(m) ? 'text-bad' : 'text-warn')} />
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Compact always-visible strip over the canvas. */
export function MetricStrip({ m, wl, traffic, score }: { m: Metrics; wl: Workload; traffic: number; score?: number }) {
  const items: { k: string; v: string; t: T }[] = [
    { k: 'load', v: `${fmtQps(m.offered)}${traffic !== 1 ? ` (${traffic}×)` : ''}`, t: 'neutral' },
    { k: 'capacity', v: m.connected ? fmtQps(m.maxQps) : '—', t: !m.connected ? 'bad' : m.maxQps >= wl.qps * traffic ? 'ok' : 'bad' },
    { k: 'errors', v: m.connected ? fmtPct(m.errorRate, m.errorRate > 0 && m.errorRate < 0.1 ? 1 : 0) : '100%', t: !m.connected || m.errorRate >= 0.2 ? 'bad' : m.errorRate >= 0.01 ? 'warn' : 'ok' },
    { k: 'p99', v: m.connected ? fmtMs(m.p99) : '—', t: m.p99 <= 150 ? 'ok' : m.p99 <= 400 ? 'warn' : 'bad' },
    { k: 'uptime', v: fmtAvail(m.availability), t: m.availability >= 0.999 ? 'ok' : m.availability >= 0.99 ? 'warn' : 'bad' },
    { k: 'spofs', v: String(m.spofs.length), t: m.spofs.length ? 'bad' : 'ok' },
  ];
  return (
    <div className="pointer-events-auto flex flex-wrap items-stretch overflow-hidden rounded-xl border border-line bg-surface/95 shadow-paper backdrop-blur">
      {items.map((it) => (
        <div key={it.k} className="border-r border-line px-3 py-1.5 last:border-r-0">
          <div className="font-mono text-[9px] uppercase tracking-wider text-faint">{it.k}</div>
          <div className={cn('font-mono text-[13px] font-semibold leading-tight transition-colors', TONE[it.t])}>{it.v}</div>
        </div>
      ))}
      {score !== undefined && (
        <div className="flex min-w-[120px] flex-col justify-center gap-1 px-3 py-1.5">
          <div className="flex justify-between font-mono text-[9px] uppercase tracking-wider text-faint">
            <span>closeness</span>
            <span className="text-ink">{score}%</span>
          </div>
          <ProgressBar value={score} max={100} size="xs" tone={score >= 100 ? 'ok' : score >= 60 ? 'accent' : 'warn'} />
        </div>
      )}
    </div>
  );
}
