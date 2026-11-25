import { CheckCircle2, Circle, XCircle } from 'lucide-react';
import { cn } from '@/shared/cn';
import { ProgressBar } from '@/shared/ui';
import { fmtBytes, type Impact } from '../engine/analyze';
import type { Closeness, ReqStatus } from '../engine/evaluate';
import { Rich } from './Rich';

type T = 'ok' | 'warn' | 'bad' | 'neutral';
const TONE: Record<T, string> = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', neutral: 'text-ink' };

/** Compact always-visible strip over the canvas. */
export function MetricStrip({ impact, score }: { impact: Impact; score?: number }) {
  const reads = Object.values(impact.reads);
  const okReads = reads.filter((r) => r.level === 'ok').length;
  const maxWrite = Math.max(0, ...Object.values(impact.writes).map((w) => w.rows));
  const items: { k: string; v: string; t: T; title: string }[] = [
    { k: 'tables', v: String(impact.order.length), t: 'neutral', title: 'Tables in the model' },
    { k: 'queries ok', v: `${okReads}/${reads.length}`, t: okReads === reads.length ? 'ok' : okReads >= reads.length / 2 ? 'warn' : 'bad', title: 'Read access patterns served within their join budget, without scans or wrong answers' },
    { k: 'anomalies', v: String(impact.counts.anomalies), t: impact.counts.anomalies ? 'bad' : 'ok', title: 'Update / insert / delete anomalies in normalised (non-analytic) tables' },
    { k: 'max write', v: `${maxWrite >= 1000 ? `${Math.round(maxWrite / 1000)}k` : maxWrite} row${maxWrite === 1 ? '' : 's'}`, t: maxWrite <= 1 ? 'ok' : maxWrite <= 100 ? 'warn' : 'bad', title: 'Worst rows touched by one logical change' },
    { k: 'red flags', v: `${impact.counts.bad}✗ ${impact.counts.warn}⚠`, t: impact.counts.bad ? 'bad' : impact.counts.warn ? 'warn' : 'ok', title: 'Blocking problems and warnings' },
    { k: 'storage', v: fmtBytes(impact.storage), t: 'neutral', title: `Estimated heap size; ${fmtBytes(impact.dupBytes)} of it duplicated values` },
  ];
  return (
    <div className="pointer-events-auto flex flex-wrap items-stretch overflow-hidden rounded-xl border border-line bg-surface/95 shadow-paper backdrop-blur">
      {items.map((it) => (
        <div key={it.k} className="border-r border-line px-3 py-1.5 last:border-r-0" title={it.title}>
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

const IS_PROBLEM = /^(Remove|Fix|Move)/;

/** `concealGaps` (challenge) shows only problems with what's built, not what's still missing. */
export function ClosenessView({ close, reqs, solved, concealGaps = false }: { close: Closeness; reqs: ReqStatus[]; solved: boolean; concealGaps?: boolean }) {
  const met = reqs.filter((r) => r.met).length;
  const shown = concealGaps ? close.missing.filter((m) => IS_PROBLEM.test(m)).map((m) => m.replace(/ \(should be .*\)$/, '')) : close.missing;
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
        <div className="mt-1.5 grid grid-cols-4 gap-1">
          {close.parts.map((p) => (
            <div key={p.label} className="rounded border border-line bg-surface px-1 py-0.5 text-center">
              <div className={cn('font-mono text-[11px] font-semibold', p.got >= p.of ? 'text-ok' : 'text-ink')}>
                {p.got}/{p.of}
              </div>
              <div className="truncate font-mono text-[8.5px] uppercase tracking-wide text-faint">{p.label}</div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="eyebrow mb-1.5">
          Requirements {met}/{reqs.length}
        </div>
        <ul className="space-y-1.5">
          {reqs.map((r) => (
            <li key={r.id} className="flex gap-2 text-[12.5px] leading-snug">
              {r.met ? <CheckCircle2 size={15} className="mt-px shrink-0 text-ok" /> : <Circle size={15} className="mt-px shrink-0 text-faint" />}
              <span className={r.met ? 'text-muted line-through decoration-ok/40' : 'text-ink'}>
                <Rich text={r.text} />
              </span>
            </li>
          ))}
        </ul>
      </div>
      {close.missing.length > 0 && (
        <div>
          <div className="eyebrow mb-1.5">{concealGaps ? 'Problems' : 'Still to do'}</div>
          <ul className="space-y-1">
            {concealGaps && hidden > 0 && (
              <li className="flex gap-2 text-[12.5px] leading-snug text-muted">
                <Circle size={14} className="mt-px shrink-0 text-warn" />
                <span>
                  {hidden} gap{hidden > 1 ? 's' : ''} vs. the reference, hidden in Challenge. Reason from the requirements and the impact panel, or use a hint.
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
