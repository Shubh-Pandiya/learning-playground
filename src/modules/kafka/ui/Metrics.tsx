import { cn } from '@/shared/cn';
import { Tooltip } from '@/shared/ui';
import { ORD_LABEL, SEM_LABEL } from '../engine/impact';
import { fmtMs, fmtN, type Model } from '../engine/model';

type Tone = 'ok' | 'warn' | 'bad' | 'neutral';
const TONE: Record<Tone, string> = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', neutral: 'text-ink' };

function Cell({ label, value, sub, tone = 'neutral', tip }: { label: string; value: string; sub?: string; tone?: Tone; tip: string }) {
  return (
    <Tooltip side="bottom" content={<div className="max-w-[260px] text-[12px] leading-snug">{tip}</div>}>
      <div className="min-w-0 cursor-help px-2.5 py-1.5">
        <div className="truncate text-[9.5px] font-semibold uppercase tracking-wider text-faint">{label}</div>
        <div className={cn('truncate font-mono text-[12.5px] font-semibold leading-tight', TONE[tone])}>{value}</div>
        {sub && <div className="truncate font-mono text-[9.5px] text-faint">{sub}</div>}
      </div>
    </Tooltip>
  );
}

const GB = (n: number) => (!Number.isFinite(n) ? '∞' : n >= 1000 ? `${(n / 1000).toFixed(1)} TB` : `${n.toFixed(n < 10 ? 1 : 0)} GB`);

export function MetricStrip({ m, className }: { m: Model; className?: string }) {
  const x = m.metrics;
  if (!x.connected)
    return (
      <div className={cn('rounded-xl border border-line bg-surface/95 px-3 py-2 text-[12px] text-muted shadow-paper backdrop-blur', className)}>
        Not flowing yet: connect a producer → topic → consumer group so events have somewhere to go.
      </div>
    );
  const head = x.maxThroughput > 0 ? x.ingest / x.maxThroughput : 0;
  const sem = x.semantics;
  return (
    <div className={cn('grid grid-cols-4 divide-x divide-line overflow-hidden rounded-xl border border-line bg-surface/95 shadow-paper backdrop-blur lg:grid-cols-8', className)}>
      <Cell
        label="Throughput"
        value={`${fmtN(x.ingest)}/s`}
        sub={`max ${fmtN(x.maxThroughput)}/s`}
        tone={head >= 1 ? 'bad' : head > 0.75 ? 'warn' : 'ok'}
        tip={`Events produced per second at current traffic, and the most this design sustains before something saturates (bottleneck: ${x.bottleneck}). ${x.ingestMB.toFixed(1)} MB/s in.`}
      />
      <Cell label="Produce p99" value={fmtMs(x.produceP99)} tone={x.produceP99 > 200 ? 'bad' : x.produceP99 > 50 ? 'warn' : 'ok'} tip="Time from send() to the broker acknowledging the batch. Driven by linger.ms, acks (waiting for followers), broker load and retries." />
      <Cell label="E2E p99" value={fmtMs(x.e2eP99)} tone={x.lagGrowth > 1 ? 'bad' : x.e2eP99 > 1000 ? 'warn' : 'ok'} tip="Produce → visible to consumers (after the high watermark) → processed. Grows without bound when lag grows." />
      <Cell
        label="Lag"
        value={x.lagGrowth > 1 ? `+${fmtN(x.lagGrowth)}/s` : 'stable'}
        tone={x.lagGrowth > 1 ? 'bad' : 'ok'}
        tip="How fast the gap between log-end offset and committed offset grows. Positive = consumers can’t keep up; it only gets worse until you add capacity (partitions + consumers, or faster processing)."
      />
      <Cell
        label="Delivery"
        value={SEM_LABEL[sem]}
        tone={sem === 'exactly-once' || sem === 'effectively-once' ? 'ok' : sem === 'at-least-once' ? 'neutral' : 'bad'}
        tip="What downstream side effects actually see. At-least-once = duplicates on retry/rebalance; effectively-once = duplicates absorbed by an idempotent sink; exactly-once = Kafka transactions end to end (Kafka → Kafka)."
      />
      <Cell label="Ordering" value={ORD_LABEL[x.ordering]} tone={x.ordering === 'none' ? 'warn' : 'neutral'} tip="Kafka only orders within a partition. Same key → same partition → ordered. Random keys, retries without idempotence, or a parallel consumer break it." />
      <Cell
        label="Durability"
        value={x.durability.lossOn1 ? 'can lose acks' : x.durability.writesOn1 ? 'no loss' : 'no loss, fragile'}
        sub={x.durability.label}
        tone={x.durability.lossOn1 ? 'bad' : x.durability.writesOn1 ? 'ok' : 'warn'}
        tip={`${x.durability.writesOn1 ? 'Writes keep working with one broker down.' : 'Writes stop if one broker dies.'} Can an acknowledged write be lost when one broker dies? Needs acks=all, RF ≥ 3, min.insync.replicas = 2 and no unclean leader election.`}
      />
      <Cell
        label="Consumers"
        value={`${x.activeConsumers} active`}
        sub={x.idleConsumers ? `${x.idleConsumers} idle · ${x.partitions}p` : `${x.partitions} partitions`}
        tone={x.idleConsumers ? 'warn' : 'neutral'}
        tip={`A partition is consumed by at most one member of a group, so parallelism is capped by partitions. Retained on disk: ${GB(x.diskGB)} (incl. replicas).`}
      />
    </div>
  );
}
