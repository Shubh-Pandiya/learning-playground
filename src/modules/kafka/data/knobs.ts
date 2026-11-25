import type { KKind, NodeCfg } from '../types';

export type KnobKey = keyof NodeCfg;

export interface Knob {
  key: KnobKey;
  /** Real Kafka config name (or concept) shown to the learner. */
  config: string;
  label: string;
  kinds: KKind[];
  type: 'select' | 'number' | 'bool';
  options?: { value: string | number; label: string; note: string }[];
  min?: number;
  max?: number;
  step?: number;
  /** Discrete steps for number knobs (chips instead of free input). */
  stops?: number[];
  unit?: string;
  /** What it does, one or two lines. */
  what: string;
  /** How it works internally. */
  how: string;
  /** The interview angle. */
  interview?: string;
  advanced?: boolean;
}

export const KNOBS: Knob[] = [
  /* ---------------- producer ---------------- */
  {
    key: 'rate',
    config: 'events / s',
    label: 'Event rate',
    kinds: ['service'],
    type: 'number',
    stops: [100, 1000, 5000, 20000, 100000, 500000, 1000000],
    unit: '/s',
    what: 'How many events this service publishes per second at peak.',
    how: 'Rate × message size is the bytes per second each partition leader must append and every follower must replicate.',
  },
  {
    key: 'msgBytes',
    config: 'record size',
    label: 'Message size',
    kinds: ['service'],
    type: 'number',
    stops: [100, 500, 1000, 5000, 100000],
    unit: 'B',
    what: 'Average serialized record size.',
    how: 'Kafka is bandwidth-bound long before it is CPU-bound. Bytes, not message count, decide broker load. The default `max.message.bytes` is ~1 MB, so large payloads belong in object storage with a pointer in Kafka.',
    advanced: true,
  },
  {
    key: 'key',
    config: 'record key',
    label: 'Partition key',
    kinds: ['service', 'cdc'],
    type: 'select',
    options: [
      { value: 'entity', label: 'entity id (userId / orderId)', note: 'All events of one entity land on one partition, in order.' },
      { value: 'random', label: 'random UUID per event', note: 'Spreads load evenly but scatters one entity across partitions, so no per-entity order.' },
      { value: 'null', label: 'null (no key)', note: 'The sticky partitioner fills one batch at a time, then switches. Even load, no ordering.' },
      { value: 'hot', label: 'tenantId (one giant tenant)', note: 'Skewed: the big tenant’s partition gets a large share of all traffic.' },
    ],
    what: 'Decides which partition each record goes to, and therefore what is ordered relative to what.',
    how: 'Default partitioner: `murmur2(keyBytes) % numPartitions`. Same key → same partition → total order for that key. Null keys use the **sticky partitioner** (KIP-480): one partition per batch, then switch, which gives bigger batches than round-robin.',
    interview: '“How do you guarantee ordering for a user’s events?” Key by userId. Ordering is per partition, and the key picks the partition.',
  },
  {
    key: 'acks',
    config: 'acks',
    label: 'acks',
    kinds: ['service', 'cdc'],
    type: 'select',
    options: [
      { value: '0', label: '0: don’t wait', note: 'Producer doesn’t wait for any response. Lowest latency, silent loss.' },
      { value: '1', label: '1: leader only', note: 'Leader appended it to its log. Lost if the leader dies before followers copy it.' },
      { value: 'all', label: 'all: whole ISR', note: 'Leader waits until every in-sync replica has it (and ISR ≥ min.insync.replicas).' },
    ],
    what: 'How many replicas must have a record before the producer considers it sent.',
    how: 'With `acks=all`, the leader parks the request in a **DelayedProduce purgatory** until the high watermark passes the batch’s last offset, i.e. every ISR follower has fetched it. Followers fetch continuously, so this adds about one fetch round-trip (1–5 ms in a rack).',
    interview: 'acks=all alone is not enough: if the ISR shrinks to just the leader, "all" means one copy. Pair it with `min.insync.replicas=2` and RF=3.',
  },
  {
    key: 'idempotence',
    config: 'enable.idempotence',
    label: 'Idempotent producer',
    kinds: ['service', 'cdc', 'streams'],
    type: 'bool',
    what: 'Broker de-duplicates producer retries, so a retried batch is written exactly once and in order.',
    how: 'On init the producer gets a **PID** and epoch. Each batch carries `(PID, partition, sequence)`. The broker keeps the last 5 sequence numbers per PID-partition. A duplicate sequence is acked without writing; a gap returns `OutOfOrderSequence`. Default since Kafka 3.0 (needs acks=all, max.in.flight ≤ 5).',
    interview: 'Idempotence covers one producer session and one partition. It does not dedupe across app restarts with a new PID, or your own business duplicates.',
  },
  {
    key: 'retries',
    config: 'retries',
    label: 'Retries',
    kinds: ['service'],
    type: 'bool',
    what: 'Retry sends that fail with a retriable error (leader change, timeout).',
    how: 'Retries happen inside the client until `delivery.timeout.ms` (2 min). Without idempotence, a request that actually succeeded but whose response was lost is written **twice**. With several in-flight requests, a retried batch can land **after** a later one.',
    advanced: true,
  },
  {
    key: 'maxInFlight',
    config: 'max.in.flight.requests.per.connection',
    label: 'Max in-flight',
    kinds: ['service'],
    type: 'number',
    stops: [1, 2, 5],
    what: 'How many unacknowledged produce requests per broker connection.',
    how: 'More in-flight requests pipeline better over latency. Without idempotence, values > 1 allow reordering on retry. With idempotence, ordering is kept for up to 5.',
    advanced: true,
  },
  {
    key: 'lingerMs',
    config: 'linger.ms',
    label: 'linger.ms',
    kinds: ['service', 'cdc'],
    type: 'number',
    stops: [0, 5, 20, 100, 500],
    unit: 'ms',
    what: 'How long the producer waits for more records before sending a partially full batch.',
    how: 'The Sender thread sends a batch when it reaches `batch.size` **or** is older than `linger.ms`. A few ms of linger turns many tiny requests into few large ones: fewer request headers, better compression, fewer broker syscalls. Default is 5 ms since Kafka 4.0 (0 before).',
    interview: 'Throughput vs latency in one knob. At high rate, batches fill before linger expires, so linger costs nothing.',
  },
  {
    key: 'batchKb',
    config: 'batch.size',
    label: 'batch.size',
    kinds: ['service', 'cdc'],
    type: 'number',
    stops: [16, 64, 256, 1024],
    unit: 'KB',
    what: 'Max bytes per partition batch.',
    how: 'Memory for batches comes from `buffer.memory` (32 MB) shared across partitions. Bigger batches only help if records arrive fast enough to fill them.',
    advanced: true,
  },
  {
    key: 'compression',
    config: 'compression.type',
    label: 'Compression',
    kinds: ['service', 'cdc'],
    type: 'select',
    options: [
      { value: 'none', label: 'none', note: 'No CPU, full bytes on the wire and on disk.' },
      { value: 'lz4', label: 'lz4', note: 'Very fast, good ratio. The usual default.' },
      { value: 'snappy', label: 'snappy', note: 'Fast, slightly worse ratio than lz4.' },
      { value: 'zstd', label: 'zstd', note: 'Best ratio at moderate CPU.' },
      { value: 'gzip', label: 'gzip', note: 'Good ratio, high CPU, slow.' },
    ],
    what: 'Compresses whole batches on the producer.',
    how: 'The producer compresses each **batch**. The broker stores it compressed and sends it compressed to consumers (zero-copy still works). It is decompressed only by consumers, so compression saves network, disk and replication bandwidth 3–5× on JSON. Larger batches compress better.',
  },
  {
    key: 'transactional',
    config: 'transactional.id',
    label: 'Transactions',
    kinds: ['service'],
    type: 'bool',
    what: 'Atomic writes across partitions and topics: all or nothing, visible only to read_committed consumers.',
    how: 'The producer registers a `transactional.id` with a **transaction coordinator**, which bumps the epoch and fences older “zombie” instances. Writes go to partitions as usual. Commit writes **COMMIT markers** into every touched partition via a two-phase protocol logged in `__transaction_state`.',
    interview: 'Transactions give exactly-once for consume-transform-produce within Kafka. They do not make your DB write and Kafka write atomic; for that, use the outbox pattern.',
    advanced: true,
  },
  /* ---------------- topic ---------------- */
  {
    key: 'partitions',
    config: 'num.partitions',
    label: 'Partitions',
    kinds: ['topic'],
    type: 'number',
    stops: [1, 3, 6, 12, 24, 48, 96],
    what: 'Number of independent ordered logs in the topic: the unit of parallelism.',
    how: 'Each partition lives on one leader broker and is consumed by one member per group. Throughput scales with partitions until brokers saturate. Costs: open file handles, more replication fetches, slower controller failover, and end-to-end latency from replication.',
    interview: 'Sizing: partitions ≥ max(target ÷ per-partition producer throughput, target ÷ per-consumer throughput). Over-provision for growth, because adding partitions later remaps keys.',
  },
  {
    key: 'rf',
    config: 'replication.factor',
    label: 'Replication factor',
    kinds: ['topic'],
    type: 'number',
    stops: [1, 2, 3, 5],
    what: 'Copies of each partition on different brokers.',
    how: 'One leader and RF−1 followers. Followers send Fetch requests to the leader just like consumers do. Each broker hosts a mix of leaders and followers, so load spreads. Disk and replication network both scale with RF.',
    interview: 'RF=3 with min.insync.replicas=2 is the classic production setting: survives one broker failure with no data loss and no write outage.',
  },
  {
    key: 'minIsr',
    config: 'min.insync.replicas',
    label: 'min.insync.replicas',
    kinds: ['topic'],
    type: 'number',
    stops: [1, 2, 3],
    what: 'With acks=all, reject writes unless at least this many replicas are in sync.',
    how: 'Checked by the leader on each acks=all produce. If ISR size < min.insync.replicas it returns `NotEnoughReplicas`. Kafka chooses **consistency over availability** here: it stops accepting writes rather than accept writes that only one disk holds.',
    interview: 'min.insync = RF blocks all writes during any broker restart. min.insync = 1 makes acks=all as weak as acks=1 once the ISR shrinks.',
  },
  {
    key: 'unclean',
    config: 'unclean.leader.election.enable',
    label: 'Unclean leader election',
    kinds: ['topic'],
    type: 'bool',
    what: 'If no in-sync replica survives, allow an out-of-sync replica to become leader.',
    how: 'Normally the controller only elects a new leader from the ISR. Unclean election picks any live replica. Records it never received are **gone**, and other replicas truncate to match it. Availability over consistency.',
    interview: 'Off by default since 0.11. Turn it on only for data you can afford to lose (metrics, logs).',
  },
  {
    key: 'cleanup',
    config: 'cleanup.policy',
    label: 'Cleanup policy',
    kinds: ['topic'],
    type: 'select',
    options: [
      { value: 'delete', label: 'delete (time/size retention)', note: 'Old segments are deleted after retention.ms.' },
      { value: 'compact', label: 'compact (latest per key)', note: 'Keep at least the latest record for every key, forever. A null value is a tombstone.' },
    ],
    what: 'What happens to old data: expire by age, or keep the latest value per key.',
    how: 'The **log cleaner** threads pick the dirtiest partitions (`min.cleanable.dirty.ratio`), build an offset map key → latest offset over the dirty head, then copy the segments, dropping superseded records. The active segment is never cleaned. Tombstones are removed after `delete.retention.ms`.',
    interview: 'Compaction turns a topic into a replayable table snapshot: changelogs, CDC, `__consumer_offsets`, config distribution.',
  },
  {
    key: 'retentionH',
    config: 'retention.ms',
    label: 'Retention',
    kinds: ['topic'],
    type: 'number',
    stops: [1, 24, 168, 720, -1],
    unit: 'h',
    what: 'How long records are kept (delete policy). −1 = forever.',
    how: 'Retention is applied per **closed segment**: a segment is deleted when its newest record is older than retention. A consumer whose committed offset falls behind the log start gets `OffsetOutOfRange` and resets to earliest/latest per `auto.offset.reset`, silently skipping data.',
    interview: 'Retention is your replay window and your consumer outage budget. Tiered storage (KIP-405) makes long retention cheap.',
  },
  {
    key: 'role',
    config: 'topic purpose',
    label: 'Role',
    kinds: ['topic'],
    type: 'select',
    options: [
      { value: 'main', label: 'main events', note: 'Primary event stream.' },
      { value: 'retry', label: 'retry topic', note: 'Failed records re-published with a delay, consumed by a retry consumer.' },
      { value: 'dlq', label: 'dead-letter (DLQ)', note: 'Records that exhausted retries, parked for inspection and replay.' },
      { value: 'changelog', label: 'changelog / state', note: 'Latest state per key, usually compacted.' },
    ],
    what: 'What this topic is for. Affects how other components treat it.',
    how: 'Kafka itself has no special DLQ type. Retry and DLQ topics are plain topics plus a convention (headers carry the original topic, partition, offset and error).',
    advanced: true,
  },
  /* ---------------- consumer group ---------------- */
  {
    key: 'consumers',
    config: 'instances in group',
    label: 'Consumers',
    kinds: ['group', 'streams'],
    type: 'number',
    stops: [1, 2, 3, 6, 12, 24, 48],
    what: 'Members of the consumer group (pods × threads).',
    how: 'The assignor gives each partition to exactly one member. With more members than partitions, the extras get nothing. With fewer, some members own several partitions.',
    interview: 'Max parallelism of a group = partition count.',
  },
  {
    key: 'procMs',
    config: 'processing time / record',
    label: 'Processing time',
    kinds: ['group', 'streams'],
    type: 'number',
    stops: [0.1, 1, 5, 20, 50, 200],
    unit: 'ms',
    what: 'Average time your code spends per record (DB write, HTTP call…).',
    how: 'One member processes its partitions sequentially, so its throughput ≈ 1000 / procMs records/s. A batch of `max.poll.records` must finish within `max.poll.interval.ms` (5 min) or the member is evicted and a rebalance starts.',
  },
  {
    key: 'commit',
    config: 'offset commit',
    label: 'Commit strategy',
    kinds: ['group'],
    type: 'select',
    options: [
      { value: 'auto', label: 'auto-commit (every 5s)', note: 'enable.auto.commit=true: offsets of polled records are committed on the next poll after 5 s.' },
      { value: 'before', label: 'commit, then process', note: 'At-most-once: a crash after commit skips the records.' },
      { value: 'after', label: 'process, then commit', note: 'At-least-once: a crash before commit re-delivers the records.' },
      { value: 'txn', label: 'transactional (EOS)', note: 'Offsets committed inside the producer transaction with the outputs: exactly-once for Kafka → Kafka.' },
    ],
    what: 'When the group records “done up to offset N”. Decides your delivery semantics.',
    how: 'A commit is an OffsetCommit request to the group coordinator, appended to `__consumer_offsets`. After a crash or rebalance, the new owner starts at the last committed offset. Anything processed after it is processed again; anything committed before processing is skipped.',
    interview: '“How do you get exactly-once into Postgres?” At-least-once delivery plus an idempotent write (or store offsets in the same DB transaction).',
  },
  {
    key: 'assignor',
    config: 'partition.assignment.strategy',
    label: 'Assignor',
    kinds: ['group', 'streams'],
    type: 'select',
    options: [
      { value: 'range', label: 'Range (eager)', note: 'Contiguous ranges per topic. Eager: all partitions revoked on every rebalance.' },
      { value: 'roundrobin', label: 'RoundRobin (eager)', note: 'Even spread. Eager stop-the-world.' },
      { value: 'sticky', label: 'Sticky (eager)', note: 'Minimises movement, but still revokes everything first.' },
      { value: 'coop', label: 'CooperativeSticky', note: 'Incremental: only moved partitions pause. Others keep consuming.' },
    ],
    what: 'How partitions are divided among members, and whether a rebalance stops everyone.',
    how: 'Eager protocol: every member revokes all partitions, then rejoins (stop-the-world). **Cooperative** (KIP-429): members keep their partitions through a first rebalance round, and only partitions that must move are revoked and reassigned in a second round. KIP-848 (Kafka 4.0) moves assignment to the broker entirely.',
    interview: 'Rolling deploy of 30 pods with eager assignment = 30 stop-the-world pauses. Fix: cooperative-sticky + static membership.',
  },
  {
    key: 'staticMembership',
    config: 'group.instance.id',
    label: 'Static membership',
    kinds: ['group', 'streams'],
    type: 'bool',
    what: 'A restarting member with the same instance id gets its partitions back without a rebalance.',
    how: 'The coordinator keeps the member’s assignment until `session.timeout.ms` expires, so a pod restart within the timeout triggers no rebalance at all.',
    advanced: true,
  },
  {
    key: 'isolation',
    config: 'isolation.level',
    label: 'Isolation level',
    kinds: ['group', 'streams'],
    type: 'select',
    options: [
      { value: 'uncommitted', label: 'read_uncommitted', note: 'Sees records of open and aborted transactions.' },
      { value: 'committed', label: 'read_committed', note: 'Reads only up to the Last Stable Offset; aborted records filtered.' },
    ],
    what: 'Whether the consumer can see records from transactions that are still open or were aborted.',
    how: 'read_committed consumers read up to the **LSO** (last stable offset: below the first open transaction) and use the aborted-transaction index to skip aborted batches.',
    advanced: true,
  },
  {
    key: 'onError',
    config: 'error handling',
    label: 'On processing error',
    kinds: ['group'],
    type: 'select',
    options: [
      { value: 'crash', label: 'throw (crash & retry forever)', note: 'Consumer dies, restarts, re-reads the same poison record. Partition stuck.' },
      { value: 'skip', label: 'log & skip', note: 'Moves on, and the record is silently lost.' },
      { value: 'block-retry', label: 'retry in place (sleep)', note: 'Blocks the partition while retrying, so head-of-line blocking.' },
      { value: 'retry-dlq', label: 'retry topic → DLQ', note: 'Non-blocking: publish to a retry topic, then to a DLQ after N attempts, and commit.' },
    ],
    what: 'What happens when one record cannot be processed (bad payload, downstream 500).',
    how: 'Kafka has no per-message ack or redelivery. The consumer’s position only moves forward when it commits. One undeserializable record (“poison pill”) blocks its partition unless the code moves it aside.',
    interview: 'Non-blocking retries (retry topics + DLQ) trade per-key ordering for availability. Mention that tradeoff.',
  },
  {
    key: 'maxPollRecords',
    config: 'max.poll.records',
    label: 'max.poll.records',
    kinds: ['group'],
    type: 'number',
    stops: [10, 100, 500, 2000],
    what: 'Records returned per poll().',
    how: 'The whole batch must be processed before the next poll() within `max.poll.interval.ms`. Slow processing × big batches = eviction from the group and a rebalance loop.',
    advanced: true,
  },
  {
    key: 'eos',
    config: 'processing.guarantee',
    label: 'Exactly-once (v2)',
    kinds: ['streams'],
    type: 'bool',
    what: 'Commit outputs, state changelog and input offsets in one Kafka transaction.',
    how: 'Each stream thread has one transactional producer. Every `commit.interval.ms` (100 ms with EOS) it commits a transaction containing output records, changelog records and `sendOffsetsToTransaction`. A crash aborts the open transaction, so read_committed consumers never see partial results.',
  },
  /* ---------------- sink ---------------- */
  {
    key: 'idempotentSink',
    config: 'write mode',
    label: 'Idempotent writes',
    kinds: ['sink'],
    type: 'bool',
    what: 'Upsert / dedupe by event id, so replays and duplicates don’t double-apply.',
    how: '`INSERT … ON CONFLICT (event_id) DO NOTHING`, or `UPDATE … WHERE version < :v`. Turns at-least-once delivery into effectively-once results.',
    interview: 'The answer to most “exactly-once” questions: at-least-once plus idempotent consumer.',
  },
  {
    key: 'capacity',
    config: 'write capacity',
    label: 'Sink capacity',
    kinds: ['sink'],
    type: 'number',
    stops: [500, 2000, 10000, 50000, 200000],
    unit: '/s',
    what: 'Writes per second the downstream can absorb.',
    how: 'If the sink is slower than the topic, the consumer blocks on writes and lag grows. Kafka is the buffer that protects the sink from the spike.',
    advanced: true,
  },
];

export const KNOB: Record<KnobKey, Knob> = Object.fromEntries(KNOBS.map((k) => [k.key, k])) as Record<KnobKey, Knob>;

export const knobsFor = (kind: KKind) => KNOBS.filter((k) => k.kinds.includes(kind));

export function fmtKnobValue(k: Knob, v: unknown): string {
  if (k.type === 'bool') return v ? 'on' : 'off';
  if (k.type === 'select') return String(k.options?.find((o) => o.value === v)?.label ?? v);
  if (k.key === 'retentionH' && v === -1) return 'forever';
  if (typeof v === 'number') {
    const n = v >= 1e6 ? `${v / 1e6}M` : v >= 1e3 ? `${v / 1e3}k` : String(v);
    return `${n}${k.unit ?? ''}`;
  }
  return String(v);
}
