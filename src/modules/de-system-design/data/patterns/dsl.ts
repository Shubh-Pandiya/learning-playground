import type { ChaosId, Check, ComponentKind, OutcomeKey, RefEdge, RefNode, Requirement } from '../../types';

/** Reference node. Columns are ~190px apart, rows ~110px. */
export const N = (id: string, kind: ComponentKind, x: number, y: number, why: string, o: { count?: number; label?: string } = {}): RefNode => ({
  id,
  kind,
  x,
  y,
  why,
  ...o,
});

export const E = (from: string, to: string, why?: string, hideWhen?: string | string[]): RefEdge => ({ from, to, why, hideWhen });

export const R = (id: string, text: string, check: Check, hint: string): Requirement => ({ id, text, check, hint });

export const X = [0, 190, 380, 570, 760, 950, 1140] as const;

const dur = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${+(s / 3600).toFixed(1)} h` : `${+(s / 86400).toFixed(1)} days`);

/** Frequently reused requirement shapes. */
export const req = {
  fresh: (sec: number, hint = 'Find the slowest hop on the path: a batch interval, a poll or a nightly job.') =>
    R('fresh', `Data visible to consumers within ${dur(sec)}`, { type: 'freshness', lte: sec }, hint),
  throughput: (eps: number, unit = 'records', hint = 'Find the bottleneck: the node that turns red first when you raise volume.') =>
    R('tput', `Sustain ${eps.toLocaleString()} ${unit}/s without falling behind`, { type: 'throughput', gte: eps }, hint),
  exactlyOnce: (hint = 'Retries and replays will happen. Something must deduplicate by key, or write transactionally/idempotently.') =>
    R('eo', 'Every record counted exactly once (retries, replays and restarts included)', { type: 'exactlyOnce' }, hint),
  noLoss: (hint = 'Anything holding data only in memory, or dropping it under load, loses records. Put something durable first.') =>
    R('noloss', 'No acknowledged record is ever lost', { type: 'noLoss' }, hint),
  lateData: (hint = 'Window and partition by event time (watermarks), or re-compute a lookback window in batch.') =>
    R('late', 'Late, out-of-order events land in the right time window', { type: 'lateData' }, hint),
  backfill: (level: 'log' | 'full' = 'full', hint = 'Keep the raw history somewhere you can re-read (object storage / table format), not just in the stream.') =>
    R('backfill', level === 'full' ? 'Can re-process any past period (backfill) from stored history' : 'Can replay recent data (days) after a bug', { type: 'backfill', level }, hint),
  schemaSafe: (hint = 'Catch breaking schema changes before they hit consumers: a schema registry on the log, or a data contract check.') =>
    R('schema', 'A breaking upstream schema change can’t silently corrupt outputs', { type: 'schemaSafe' }, hint),
  quality: (hint = 'Add data quality checks (freshness, volume, nulls, uniqueness) and link them to the tables they guard.') =>
    R('dq', 'Bad data is caught before consumers see it', { type: 'quality' }, hint),
  lineage: (hint = 'A catalog with lineage answers “where does this column come from, and who breaks if I change it?”.') =>
    R('lineage', 'Every dataset is discoverable with lineage', { type: 'lineage' }, hint),
  noSpof: (hint = 'Kill each node in turn. Anything self-hosted with too few replicas loses or stalls data.') =>
    R('nospof', 'No single point of failure on the data path', { type: 'noSpof' }, hint),
  noOltp: (hint = 'Read the database’s change log (CDC) or a replica, never full scans on the primary.') =>
    R('nooltp', 'No analytical load on the production database', { type: 'noOltpLoad' }, hint),
  queryP99: (ms: number, hint = 'Interactive queries need a store built for them: pre-aggregated, indexed, columnar, with compact files.') =>
    R('p99', `Dashboard/API query p99 ≤ ${ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`}`, { type: 'queryP99', lte: ms }, hint),
  cost: (usd: number, hint = 'Usage-based tools at high volume, or always-on clusters you don’t need, blow the budget.') =>
    R('cost', `Run cost ≤ $${usd.toLocaleString()}/month`, { type: 'cost', lte: usd }, hint),
  chaos: (id: ChaosId, text: string, hint: string, allow?: OutcomeKey[]) => R(`chaos-${id}`, text, { type: 'chaos', id, allow }, hint),
  survives: (kind: ComponentKind, text: string, hint: string) => R(`survive-${kind}`, text, { type: 'survives', kind }, hint),
  has: (kind: ComponentKind, text: string, hint: string, min?: number) => R(`has-${kind}`, text, { type: 'has', kind, min }, hint),
  edge: (from: ComponentKind, to: ComponentKind, text: string, hint: string) => R(`edge-${from}-${to}`, text, { type: 'edge', from, to }, hint),
  none: (kinds: ComponentKind[], text: string, hint: string) => R(`none-${kinds.join('-')}`, text, { type: 'none', kinds }, hint),
};

/** Stock explanations for the trap components. */
export const W = {
  cronScript: {
    why: 'A cron-scheduled script has no retries, no dependency awareness, no backfill and no alerting. When it fails at 2 a.m. the partition is just missing, and re-running it appends duplicates.',
    instead: 'An orchestrated (Airflow) task that is idempotent per date partition: overwrite the partition / MERGE, with retries and SLAs.',
  },
  dualWrite: {
    why: 'Writing to the DB and then publishing an event from app code is two non-atomic writes. A crash or timeout between them leaves the DB and the stream permanently disagreeing.',
    instead: 'Change data capture from the DB’s write-ahead log (Debezium), or a transactional outbox table read by CDC.',
  },
  fullDump: {
    why: 'A nightly `SELECT *` of every table scans the production primary (hurting customers), takes hours as tables grow, misses deletes and intermediate updates, and gives you day-old data.',
    instead: 'CDC (log-based, incremental, low impact) or an incremental connector with a cursor.',
  },
  prodAnalytics: {
    why: 'Pointing dashboards at the production OLTP database runs big scans on a row store tuned for small transactions: slow dashboards and slower checkout.',
    instead: 'Replicate into an analytical store (warehouse / lakehouse / OLAP) and query there.',
  },
  appendSink: {
    why: 'A consumer that does a plain INSERT per message is at-least-once: every retry, rebalance or replay inserts the same rows again, and the dashboard doubles.',
    instead: 'A processor with checkpoints writing to a transactional or idempotent sink (MERGE/upsert on an event id).',
  },
  procTime: {
    why: 'Windows by arrival (processing) time: an event from 23:59 that arrives at 00:03 is counted on the wrong day, and every replay or backlog recomputes different numbers.',
    instead: 'Event-time windows with watermarks and allowed lateness (Flink / Spark Structured Streaming).',
  },
  rawFiles: {
    why: 'Plain Parquet/JSON files in a bucket have no atomic commits: readers see half-written jobs, a retried job appends the same files again, schema drifts per file, and there is no time travel.',
    instead: 'A table format (Iceberg / Delta / Hudi) on the same object storage: snapshots, ACID commits, schema evolution.',
  },
  tinyWriter: {
    why: 'Writing one object per event creates millions of tiny files: S3 PUT and listing costs explode and query engines spend minutes just planning the scan.',
    instead: 'Buffer in a log and let the stream processor commit batched files every minute or so, plus compaction.',
  },
  memBuffer: {
    why: 'Buffering events in application memory before shipping them means every deploy, crash or OOM silently drops up to a minute of data, and nothing can be replayed.',
    instead: 'Produce straight to a durable, replicated log (Kafka / Kinesis) with acks=all.',
  },
} as const;
