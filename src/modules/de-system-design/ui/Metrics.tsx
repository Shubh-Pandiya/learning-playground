import type { ReactNode } from 'react';
import { CheckCircle2, Circle, XCircle } from 'lucide-react';
import { cn } from '@/shared/cn';
import { ProgressBar } from '@/shared/ui';
import type { Closeness, ReqResult } from '../engine/evaluate';
import type { Metrics } from '../engine/simulate';
import type { Check, Workload } from '../types';
import { BACKFILL_LABEL, LATE_LABEL, SCHEMA_LABEL, SEMANTICS_LABEL, SMALLFILES_LABEL, fmtCost, fmtDur, fmtEps, fmtMs, fmtNum, fmtQps } from './format';

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
  /** Freshness target (s) from the scenario's requirements, if any. */
  fresh?: number;
}

/** Freshness requirement of a scenario (seconds), used to colour the freshness metric. */
export function freshTarget(reqs: { check: Check }[]): number | undefined {
  const walk = (c: Check): number | undefined => (c.type === 'freshness' ? c.lte : c.type === 'all' ? c.checks.map(walk).find((x) => x !== undefined) : undefined);
  return reqs.map((r) => walk(r.check)).find((x) => x !== undefined);
}

const freshTone = (m: Metrics, fresh?: number): T =>
  !m.connected || !Number.isFinite(m.freshness) ? 'bad' : fresh === undefined ? 'neutral' : m.freshness <= fresh ? 'ok' : m.freshness <= fresh * 4 ? 'warn' : 'bad';
const SHORT_SEM: Record<Metrics['semantics'], string> = { 'exactly-once': 'exactly-1', 'at-least-once': '≥1 (dupes)', 'at-most-once': '≤1 (loss)', none: '—' };
const SEM_TONE: Record<Metrics['semantics'], T> = { 'exactly-once': 'ok', 'at-least-once': 'warn', 'at-most-once': 'bad', none: 'bad' };
const LATE_TONE: Record<Metrics['late'], T> = { 'event-time': 'ok', recompute: 'ok', 'query-time': 'warn', misattributed: 'bad', none: 'neutral' };
const BACKFILL_TONE: Record<Metrics['backfill'], T> = { full: 'ok', log: 'warn', none: 'bad' };
const SCHEMA_TONE: Record<Metrics['schema'], T> = { enforced: 'ok', contract: 'ok', evolves: 'warn', fragile: 'bad', none: 'neutral' };
const FILES_TONE: Record<Metrics['smallFiles'], T> = { none: 'ok', compacted: 'ok', many: 'warn', tiny: 'bad' };

const SEM_SUB: Record<Metrics['semantics'], string> = {
  'exactly-once': 'each record affects the result once, even after crashes and replays',
  'at-least-once': 'retries and replays double-count unless the sink is idempotent',
  'at-most-once': 'a crash or overload silently drops records',
  none: 'no source reaches a consumer yet',
};
const LATE_SUB: Record<Metrics['late'], string> = {
  'event-time': 'late events land in the window they happened in',
  recompute: 'late events are picked up when the batch re-runs the partition',
  'query-time': 'raw events stored; every query must handle lateness itself',
  misattributed: 'late events are counted in the wrong window',
  none: '',
};
const BACKFILL_SUB: Record<Metrics['backfill'], string> = {
  full: 'raw history kept: reprocess any date range after a bug fix',
  log: 'replay only as far back as the log retains (days)',
  none: 'a logic bug can’t be fixed retroactively',
};
const SCHEMA_SUB: Record<Metrics['schema'], string> = {
  enforced: 'incompatible producer changes are rejected at write time',
  contract: 'checks catch a bad change before consumers see it',
  evolves: 'the table evolves, but nobody checks the change is safe',
  fragile: 'an upstream rename silently breaks or corrupts downstream',
  none: '',
};

/** "What the pipeline is capable of right now." */
export function Capabilities({ m, wl, traffic, nameOf, fresh }: CapabilityProps) {
  const target = wl.eps * traffic;
  return (
    <div className="grid grid-cols-2 gap-2">
      <Metric
        label="Freshness"
        value={m.connected ? fmtDur(m.freshness) : '—'}
        tone={freshTone(m, fresh)}
        sub={fresh !== undefined ? `target ≤ ${fmtDur(fresh)} · event → consumer` : 'event happens → consumer sees it'}
      />
      <Metric
        label="Max throughput"
        value={m.connected ? fmtEps(m.maxEps) : '—'}
        tone={!m.connected ? 'bad' : m.maxEps >= target ? 'ok' : m.maxEps >= target * 0.6 ? 'warn' : 'bad'}
        sub={`${traffic === 1 ? 'peak' : `${traffic}× peak`} ${fmtEps(target)}${m.bottleneck ? ` · bottleneck ${nameOf(m.bottleneck)}` : ''}`}
      />
      <Metric wide label="Delivery guarantee" value={SEMANTICS_LABEL[m.semantics]} tone={SEM_TONE[m.semantics]} sub={SEM_SUB[m.semantics]} />
      <Metric label="Late data" value={<span className="text-[13px]">{LATE_LABEL[m.late]}</span>} tone={LATE_TONE[m.late]} sub={LATE_SUB[m.late]} />
      <Metric label="Backfill / replay" value={<span className="text-[13px]">{BACKFILL_LABEL[m.backfill]}</span>} tone={m.connected ? BACKFILL_TONE[m.backfill] : 'neutral'} sub={m.connected ? BACKFILL_SUB[m.backfill] : ''} />
      <Metric label="Schema change" value={<span className="text-[13px]">{SCHEMA_LABEL[m.schema]}</span>} tone={SCHEMA_TONE[m.schema]} sub={SCHEMA_SUB[m.schema]} />
      <Metric
        label="Query p99"
        value={m.queryP99 > 0 ? fmtMs(m.queryP99) : '—'}
        tone={m.queryP99 === 0 ? 'neutral' : m.queryP99 <= 500 ? 'ok' : m.queryP99 <= 5000 ? 'warn' : 'bad'}
        sub={m.queryP99 > 0 ? `at ${fmtQps((wl.queryQps ?? 0) * traffic)} queries` : 'no interactive readers'}
      />
      <Metric
        wide
        label="Data-loss risk & single points of failure"
        value={m.lossRisks.length + m.spofs.length ? `${m.lossRisks.length + m.spofs.length} risk${m.lossRisks.length + m.spofs.length > 1 ? 's' : ''}` : 'None'}
        tone={m.lossRisks.length ? 'bad' : m.spofs.length ? 'warn' : 'ok'}
        sub={
          m.lossRisks.length + m.spofs.length ? (
            <ul className="mt-0.5 space-y-0.5">
              {m.lossRisks.map((r, i) => (
                <li key={`l${i}`}>· {r}</li>
              ))}
              {m.spofs.map((id) => (
                <li key={id}>· {nameOf(id)} is a single point of failure (add instances).</li>
              ))}
            </ul>
          ) : (
            'Any one instance can die without losing data or stopping the pipeline.'
          )
        }
      />
      <Metric label="Files" value={<span className="text-[13px]">{SMALLFILES_LABEL[m.smallFiles]}</span>} tone={FILES_TONE[m.smallFiles]} />
      <Metric label="Cost" value={fmtCost(m.cost)} sub="relative, rough" />
      <Metric
        wide
        label="Trust & operations"
        value={
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
            <Flag on={m.quality} label="quality checks" />
            <Flag on={m.lineage} label="catalog & lineage" />
            <Flag on={m.pii} label="PII controls" />
            <Flag on={m.orchestrated} label="orchestrated" />
            <Flag on={!m.oltpLoad} label="no load on prod DB" />
          </span>
        }
      />
      {m.backlog > 0 && <Metric wide label="Backlog" value={`+${fmtNum(m.backlog)} records/h`} tone="bad" sub="input outpaces processing; freshness grows every minute" />}
    </div>
  );
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', on ? 'text-ok' : 'text-faint')}>
      {on ? <CheckCircle2 size={12} /> : <Circle size={12} />}
      {label}
    </span>
  );
}

const IS_PROBLEM = /^(Remove|Fix|Connect a source)|receives no data|isn’t linked/;

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
export function MetricStrip({ m, wl, traffic, score, fresh }: { m: Metrics; wl: Workload; traffic: number; score?: number; fresh?: number }) {
  const items: { k: string; v: string; t: T }[] = [
    { k: 'volume', v: `${fmtEps(m.offered)}${traffic !== 1 ? ` (${traffic}×)` : ''}`, t: 'neutral' },
    { k: 'capacity', v: m.connected ? fmtEps(m.maxEps) : '—', t: !m.connected ? 'bad' : m.maxEps >= wl.eps * traffic ? 'ok' : 'bad' },
    { k: 'freshness', v: m.connected ? fmtDur(m.freshness) : '—', t: freshTone(m, fresh) },
    { k: 'delivery', v: m.connected ? SHORT_SEM[m.semantics] : '—', t: SEM_TONE[m.semantics] },
    { k: 'backfill', v: m.connected ? m.backfill : '—', t: m.connected ? BACKFILL_TONE[m.backfill] : 'neutral' },
    { k: 'risks', v: String(m.spofs.length + m.lossRisks.length), t: m.lossRisks.length ? 'bad' : m.spofs.length ? 'warn' : 'ok' },
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
