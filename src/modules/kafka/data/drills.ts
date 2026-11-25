/**
 * Judgment drills: the "be a good engineer" layer. Incidents run on the real simulator so the
 * learner sees symptoms, picks a root cause, then watches the fix's impact.
 */
import type { Chaos, KGraph } from '../types';
import { COL, ROW, graph, n, type Op } from './lesson';

export interface Incident {
  id: string;
  title: string;
  /** The page you got woken up by. */
  alert: string;
  graph: KGraph;
  chaos: Partial<Chaos>;
  /** What you'd see on dashboards / in logs. */
  signals: string[];
  question: string;
  options: string[];
  answer: number;
  explain: string;
  fix: { ops: Op[]; chaos?: Partial<Chaos>; label: string; note: string };
  /** What a strong engineer does beyond the hotfix. */
  followUp: string[];
}

export const INCIDENTS: Incident[] = [
  {
    id: 'lag-idle',
    title: 'Lag keeps growing after scaling out',
    alert: 'ALERT order-projector consumer lag > 1M records (growing 9k/s)',
    graph: graph(
      [
        n('service', 'api', COL.a, ROW(1), { rate: 12000 }, 'orders-api'),
        n('topic', 'ord', COL.b, ROW(1), { partitions: 4 }, 'orders'),
        n('group', 'proj', COL.c, ROW(1), { consumers: 12, procMs: 1.5 }, 'order-projector'),
      ],
      ['api>ord', 'ord>proj'],
    ),
    chaos: {},
    signals: ['Yesterday the team scaled order-projector from 4 to 12 pods; lag didn’t improve.', '8 pods report 0 records/s; 4 pods at 100% CPU.', 'Broker CPU 20%, disk fine.'],
    question: 'Root cause?',
    options: ['Brokers are too slow', 'Only 4 partitions: at most 4 consumers in a group can be active, so the extra 8 are idle', 'max.poll.records too high', 'Producer compression'],
    answer: 1,
    explain: 'Consumer parallelism is capped at the partition count. Each active member handles ~667 msg/s at 1.5 ms, and 4 × 667 = 2,667 < 12,000.',
    fix: { ops: [{ set: ['ord', { partitions: 24 }] }, { set: ['proj', { consumers: 24 }] }], label: 'Partitions → 24, consumers → 24', note: 'Adding partitions remaps keys: check ordering needs first. Long-term: faster processing per record (batch DB writes).' },
    followUp: ['Alert on lag in *time* (seconds behind), not records.', 'Capacity-plan partitions for 2–3× peak consumer parallelism up front.', 'Profile the 1.5 ms per record: batching DB writes is often a 10× win.'],
  },
  {
    id: 'hot',
    title: 'One partition always behind',
    alert: 'ALERT payments-consumer lag on partition 0 only',
    graph: graph(
      [
        n('service', 'pay', COL.a, ROW(1), { rate: 6000, key: 'hot' }, 'payments-api'),
        n('topic', 'pt', COL.b, ROW(1), { partitions: 12 }, 'payments'),
        n('group', 'pc', COL.c, ROW(1), { consumers: 12, procMs: 1 }, 'payments-consumer'),
      ],
      ['pay>pt', 'pt>pc'],
    ),
    chaos: {},
    signals: ['p0 receives ~40% of records; others ~5% each.', 'Key = merchant_id. The biggest merchant just ran a flash sale.', 'One consumer pod pinned at 100% CPU, the rest idle-ish.'],
    question: 'Best immediate explanation?',
    options: ['Unbalanced leader placement', 'A hot key: one merchant’s traffic hashes to a single partition, which only one consumer can process', 'Rebalancing storm', 'Network partition'],
    answer: 1,
    explain: 'Hashing spreads keys, not load. Per-key ordering forces a single consumer per key.',
    fix: { ops: [{ set: ['pay', { key: 'entity' }] }], label: 'Key by payment_id (or salt merchant_id)', note: 'Only valid if per-merchant ordering isn’t required. Otherwise salt the key (merchant#0..7) and re-sequence downstream, or route the whale to a dedicated topic.' },
    followUp: ['Ask: what ordering do we actually need, per merchant or per payment?', 'Monitor per-partition byte rates and skew.', 'Consider dedicated topics/partitions for known whales.'],
  },
  {
    id: 'evict',
    title: 'Rebalancing every few minutes',
    alert: 'WARN invoice-renderer: "consumer poll timeout has expired… leaving group"',
    graph: graph(
      [
        n('service', 'bill', COL.a, ROW(1), { rate: 200 }, 'billing'),
        n('topic', 'inv', COL.b, ROW(1), { partitions: 6 }, 'invoices'),
        n('group', 'rend', COL.c, ROW(1), { consumers: 6, procMs: 800, maxPollRecords: 500 }, 'invoice-renderer'),
      ],
      ['bill>inv', 'inv>rend'],
    ),
    chaos: {},
    signals: ['Each invoice PDF takes ~800 ms to render.', 'Logs: “poll timeout has expired… leaving group”, then rebalances.', 'The same invoices are rendered several times.'],
    question: 'What’s happening?',
    options: ['session.timeout.ms too low', 'One poll returns up to 500 records × 0.8 s = 400 s > max.poll.interval.ms (300 s), so the member is evicted, its uncommitted work is redone, and it repeats', 'Broker overloaded', 'Too many partitions'],
    answer: 1,
    explain: 'The heartbeat thread is fine (session timeout not hit); it’s the poll loop that’s too slow. The batch is never committed, so it’s reprocessed forever.',
    fix: { ops: [{ set: ['rend', { maxPollRecords: 50 }] }], label: 'max.poll.records → 50', note: '50 × 0.8 s = 40 s per poll. Also consider more partitions/consumers: 200/s × 0.8 s needs 160 concurrent renderers!' },
    followUp: ['Throughput is still insufficient: 6 consumers × 1.25/s ≠ 200/s. Scale or render async with a worker pool + manual offset tracking.', 'Size max.poll.records × worst-case latency < max.poll.interval.ms.'],
  },
  {
    id: 'loss',
    title: 'Orders missing after a broker reboot',
    alert: 'Finance: 312 orders in the app DB are missing from the warehouse',
    graph: graph(
      [
        n('service', 'api', COL.a, ROW(1), { rate: 3000, acks: '1' }, 'orders-api'),
        n('topic', 'ord', COL.b, ROW(1), { partitions: 6, rf: 3, minIsr: 1 }, 'orders'),
        n('group', 'etl', COL.c, ROW(1), { consumers: 6, procMs: 0.5 }, 'warehouse-etl'),
      ],
      ['api>ord', 'ord>etl'],
    ),
    chaos: { brokersDown: [1] },
    signals: ['A broker was hard-rebooted at 02:14.', 'Producers logged no errors; all sends were acked.', 'Gap in offsets consumed around 02:14 on 2 partitions.'],
    question: 'How were acked records lost?',
    options: ['Consumers skipped them', 'acks=1: the leader acked before followers copied the data, then died; a follower became leader without those records', 'Retention deleted them', 'Compression bug'],
    answer: 1,
    explain: 'With acks=1 the window between the leader’s append and follower replication is acked-but-not-replicated. A clean election truncates it.',
    fix: { ops: [{ set: ['api', { acks: 'all' }] }, { set: ['ord', { minIsr: 2 }] }], label: 'acks=all, min.insync.replicas=2', note: 'Costs a few ms of produce latency, which is almost always worth it for business data.' },
    followUp: ['Audit every producer’s acks (default is all only since 3.0 clients).', 'Set min.insync.replicas=2 as a broker default.', 'Reconcile: replay the 312 orders from the DB via the outbox.'],
  },
  {
    id: 'poison',
    title: 'Partition stuck for hours',
    alert: 'ALERT email-sender lag on partition 3 flat-lining; pod restarts: 142',
    graph: graph(
      [
        n('service', 's', COL.a, ROW(1), { rate: 500 }, 'notifications'),
        n('topic', 't', COL.b, ROW(1), { partitions: 6 }, 'emails'),
        n('group', 'g', COL.c, ROW(1), { consumers: 6, procMs: 2, onError: 'crash' }, 'email-sender'),
      ],
      ['s>t', 't>g'],
    ),
    chaos: { poison: true },
    signals: ['One pod CrashLoopBackOff, always at offset 88412 of partition 3.', 'Stack trace: JsonMappingException.', 'Group rebalances every ~40 s.'],
    question: 'Root cause and right fix?',
    options: ['Increase memory', 'A poison record: the consumer crashes on it, restarts from the same committed offset, forever. Route failures to a retry/DLQ topic and commit past them', 'Delete the topic', 'Increase session.timeout.ms'],
    answer: 1,
    explain: 'Kafka redelivers from the committed offset; nothing moves past a record the app can’t process.',
    fix: { ops: [{ add: n('topic', 'dlq', COL.d, ROW(2), { partitions: 1, role: 'dlq', retentionH: 720 }, 'emails-dlq') }, { link: ['g', 'dlq'] }, { set: ['g', { onError: 'retry-dlq' }] }], label: 'DLQ + retry-dlq handler', note: 'Use an ErrorHandlingDeserializer so deserialisation failures also reach the DLQ.' },
    followUp: ['Alert on DLQ depth.', 'Add schema validation at produce time (schema registry).', 'Build a redrive tool.'],
  },
  {
    id: 'dups',
    title: 'Customers charged twice after deploy',
    alert: 'Support: 37 duplicate charges between 14:02 and 14:05',
    graph: graph(
      [
        n('service', 'w', COL.a, ROW(1), { rate: 2000 }, 'wallet-api'),
        n('topic', 'p', COL.b, ROW(1), { partitions: 6 }, 'charge-requests'),
        n('group', 'c', COL.c, ROW(1), { consumers: 6, procMs: 0.5, commit: 'auto' }, 'charger'),
        n('sink', 'psp', COL.d, ROW(1), { idempotentSink: false }, 'card-processor'),
      ],
      ['w>p', 'p>c', 'c>psp'],
    ),
    chaos: {},
    signals: ['A rolling deploy of charger ran 14:02–14:05.', 'Duplicates are always the last few seconds before a pod restarted.', 'enable.auto.commit=true, processor has no idempotency key.'],
    question: 'Why duplicates?',
    options: ['Producer retries', 'Offsets were committed up to 5 s behind processing; restarted pods re-consumed and re-charged those records', 'Kafka bug', 'Clock skew'],
    answer: 1,
    explain: 'Any at-least-once consumer re-processes after a crash or rebalance. Without an idempotent side effect, that’s a double charge.',
    fix: { ops: [{ set: ['c', { commit: 'after' }] }, { set: ['psp', { idempotentSink: true }] }], label: 'Commit after processing + idempotency key', note: 'Pass event id as the processor’s idempotency key. Graceful shutdown (commit in onPartitionsRevoked) shrinks the window too.' },
    followUp: ['Design every consumer as if it will see duplicates.', 'Graceful shutdown: commitSync in the rebalance listener.'],
  },
];

/* ------------------------------------------------------------------ */
/* Partition sizing                                                    */
/* ------------------------------------------------------------------ */

export interface Sizing {
  id: string;
  story: string;
  /** MB/s or msg/s inputs. */
  given: { label: string; value: string }[];
  answer: number;
  /** Accept answers within ±tolerance (absolute). */
  tolerance: number;
  unit: string;
  explain: string;
}

export const SIZING: Sizing[] = [
  {
    id: 's1',
    story: 'How many partitions for `clicks`?',
    given: [{ label: 'Peak ingest', value: '300 MB/s' }, { label: 'Producer throughput per partition', value: '25 MB/s' }, { label: 'Consumer throughput per partition', value: '15 MB/s' }],
    answer: 20,
    tolerance: 0,
    unit: 'partitions',
    explain: 'max(300/25, 300/15) = max(12, 20) = 20. Then add headroom (often ×1.5–2 → 30–40) because adding later remaps keys.',
  },
  {
    id: 's2',
    story: 'Minimum consumers for `orders` to keep up?',
    given: [{ label: 'Peak', value: '9,000 msg/s' }, { label: 'Processing per record', value: '4 ms (single-threaded)' }],
    answer: 36,
    tolerance: 0,
    unit: 'consumers',
    explain: 'One consumer: 1000/4 = 250 msg/s. 9000/250 = 36, so you need ≥ 36 partitions too.',
  },
  {
    id: 's3',
    story: 'Disk needed per broker?',
    given: [{ label: 'Ingest', value: '50 MB/s' }, { label: 'Retention', value: '3 days' }, { label: 'Replication factor', value: '3' }, { label: 'Brokers', value: '6' }],
    answer: 6480,
    tolerance: 400,
    unit: 'GB',
    explain: '50 MB/s × 259,200 s = 12.96 TB × 3 replicas = 38.9 TB ÷ 6 brokers ≈ 6.5 TB each (≈ 6,480 GB), before headroom (keep disks < 70% full).',
  },
  {
    id: 's4',
    story: 'How long until `reporting` starts losing data?',
    given: [{ label: 'Input', value: '2,000 msg/s' }, { label: 'Consumer capacity during incident', value: '1,200 msg/s' }, { label: 'Retention', value: '24 h' }, { label: 'Current lag', value: '0' }],
    answer: 60,
    tolerance: 2,
    unit: 'hours',
    explain: 'The backlog grows 800/s while the oldest unread record ages at real time. Loss starts when the oldest unread record is older than retention: lag-in-time grows at 1 − 1200/2000 = 0.4 s per second, so 24 h / 0.4 = 60 h.',
  },
  {
    id: 's5',
    story: 'Minimum brokers for network throughput?',
    given: [{ label: 'Ingest', value: '400 MB/s' }, { label: 'Replication factor', value: '3' }, { label: 'Consumer groups reading everything', value: '2' }, { label: 'NIC per broker', value: '600 MB/s in and 600 MB/s out' }],
    answer: 3,
    tolerance: 0,
    unit: 'brokers',
    explain: 'Inbound: 400 produce + 800 replication (2 extra copies) = 1,200 MB/s → 2 brokers. Outbound: 800 replication + 2 × 400 consumers = 1,600 MB/s → 2.7 → 3 brokers. Outbound wins: 3, then add headroom for broker loss (with 3, losing one overloads the rest, so run 4–5).',
  },
];

/* ------------------------------------------------------------------ */
/* Spot the bad config                                                 */
/* ------------------------------------------------------------------ */

export interface SpotConfig {
  id: string;
  title: string;
  context: string;
  lines: string[];
  /** Indexes of problematic lines. */
  bad: number[];
  explain: Record<number, string>;
}

export const SPOT: SpotConfig[] = [
  {
    id: 'c1',
    title: 'Payments producer',
    context: 'Producer for `payments` (RF=3). Losing an acknowledged payment is a P1.',
    lines: ['acks=1', 'enable.idempotence=false', 'retries=2147483647', 'max.in.flight.requests.per.connection=5', 'linger.ms=5', 'compression.type=lz4'],
    bad: [0, 1],
    explain: { 0: 'acks=1 acks before replication, so a leader crash loses data. Use all.', 1: 'With retries and 5 in flight, no idempotence means duplicates and reordering.' },
  },
  {
    id: 'c2',
    title: 'Order-events topic',
    context: 'Critical topic on a 3-broker cluster; must survive one broker down and keep accepting writes.',
    lines: ['replication.factor=3', 'min.insync.replicas=3', 'unclean.leader.election.enable=false', 'cleanup.policy=delete', 'retention.ms=604800000'],
    bad: [1],
    explain: { 1: 'min.insync=3 with RF=3: any broker down → NotEnoughReplicas for acks=all producers. Use 2.' },
  },
  {
    id: 'c3',
    title: 'Ledger consumer',
    context: 'Consumes payments and writes to the ledger DB in another thread pool.',
    lines: ['enable.auto.commit=true', 'auto.offset.reset=latest', 'max.poll.records=500', 'isolation.level=read_committed', 'partition.assignment.strategy=CooperativeStickyAssignor'],
    bad: [0, 1],
    explain: { 0: 'Auto-commit with async processing commits offsets for records still in the thread pool, so a crash loses them.', 1: 'latest: a new group or expired offset silently skips existing data. For a ledger use earliest.' },
  },
  {
    id: 'c4',
    title: 'User-profiles table topic',
    context: 'Services bootstrap all current profiles from this topic.',
    lines: ['cleanup.policy=delete', 'retention.ms=604800000', 'partitions=12', 'key=null (producers use round-robin)'],
    bad: [0, 3],
    explain: { 0: 'Bootstrapping needs the latest value per key forever: cleanup.policy=compact.', 3: 'No key, no compaction and no per-user order: key by userId.' },
  },
  {
    id: 'c5',
    title: 'Streams aggregation app',
    context: 'Counts money per merchant; double counting is unacceptable. Restores take 20 minutes.',
    lines: ['processing.guarantee=at_least_once', 'num.standby.replicas=0', 'commit.interval.ms=100', 'replication.factor=3'],
    bad: [0, 1],
    explain: { 0: 'Money aggregation needs exactly_once_v2.', 1: 'With 20-minute restores, keep a standby replica (1) for fast failover.' },
  },
];

/* ------------------------------------------------------------------ */
/* Trade-off decisions                                                 */
/* ------------------------------------------------------------------ */

export interface Decision {
  id: string;
  scenario: string;
  options: { label: string; verdict: 'best' | 'ok' | 'bad'; why: string }[];
}

export const DECISIONS: Decision[] = [
  {
    id: 'd1',
    scenario: 'You need per-user ordering for 50M users at 200k events/s. Choose the key.',
    options: [
      { label: 'user_id', verdict: 'best', why: 'Order per user, spreads evenly across many keys.' },
      { label: 'null (round-robin)', verdict: 'bad', why: 'No ordering at all.' },
      { label: 'country', verdict: 'bad', why: '~200 keys, extremely skewed (hot partitions).' },
      { label: 'event_id', verdict: 'ok', why: 'Even spread, but a user’s events land anywhere, so no per-user order.' },
    ],
  },
  {
    id: 'd2',
    scenario: 'Background job queue: independent image resizes, variable 0.1–30 s each, must auto-scale to 500 workers.',
    options: [
      { label: 'Kafka topic with 500 partitions', verdict: 'ok', why: 'Works, but slow jobs block their partition (head-of-line) and scaling is capped by partitions.' },
      { label: 'SQS / RabbitMQ', verdict: 'best', why: 'Per-message acks and visibility timeouts are built for independent, variable-length jobs.' },
      { label: 'Kafka share groups (4.0+)', verdict: 'ok', why: 'Queue semantics on Kafka, newer and still maturing. Good if you already run Kafka.' },
    ],
  },
  {
    id: 'd3',
    scenario: 'A consumer writes each event to Postgres. You want “exactly once” effect.',
    options: [
      { label: 'Enable Kafka transactions', verdict: 'bad', why: 'Kafka transactions don’t cover the Postgres write.' },
      { label: 'Upsert on event id (or a processed_events table) and commit after', verdict: 'best', why: 'At-least-once + idempotent write = effectively-once.' },
      { label: 'Store offsets in Postgres in the same transaction', verdict: 'best', why: 'Also correct: on startup seek to the stored offsets.' },
      { label: 'enable.auto.commit=true', verdict: 'bad', why: 'Commits can run ahead of or behind processing.' },
    ],
  },
  {
    id: 'd4',
    scenario: 'Cross-region DR for a payments cluster with RPO ≈ 0.',
    options: [
      { label: 'MirrorMaker 2 async replication', verdict: 'ok', why: 'Simple, but async means seconds of data loss on regional failure (RPO > 0), and offsets must be translated.' },
      { label: 'Stretched cluster across 3 regions with acks=all, min.insync=2, rack-aware placement', verdict: 'best', why: 'Synchronous; RPO=0. Cost: cross-region produce latency.' },
      { label: 'Nightly topic backup', verdict: 'bad', why: 'RPO = a day.' },
    ],
  },
  {
    id: 'd5',
    scenario: 'You must add partitions to a keyed topic with per-key ordering in production.',
    options: [
      { label: 'Just add them', verdict: 'bad', why: 'Keys remap; in-flight old events may be processed after new ones.' },
      { label: 'Create a new topic with more partitions, dual-consume or drain-then-switch', verdict: 'best', why: 'Preserves order with a controlled cut-over.' },
      { label: 'Pause producers, drain consumers to lag 0, add partitions, resume', verdict: 'ok', why: 'Works if you can afford a short write pause.' },
    ],
  },
];
