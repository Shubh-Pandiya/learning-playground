import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'projector',

  problem: {
    why: 'Events and CDC streams are facts in log order; queries need tables, documents and indexes. A projector is the long-running process that turns one into the other: it reads the log from a checkpoint, maps each event to idempotent writes in a read model, and records how far it got. Because delivery is at-least-once and order is guaranteed only per partition, the projector — not the log — is where correctness of every derived view is won or lost.',
    withoutIt: [
      'Services keep read stores in sync with dual writes that diverge on every crash or timeout.',
      'Replays and redeliveries double-count totals because nothing guards against reapplying an event.',
      'New query shapes require one-off backfill scripts instead of a replay of the log.',
      'Nobody can tell how stale a view is because there is no checkpoint or lag metric.',
    ],
    position: 'Between the source log (event store `$all`, Kafka topic, Debezium CDC stream, DynamoDB Streams) and one or more read models; it is off the request path, but its lag defines the freshness of every query served from those views.',
    diagram: {
      type: 'flow',
      title: 'Projector loop',
      nodes: [
        { label: 'Load checkpoint', sub: 'last applied position' },
        { label: 'Fetch batch', sub: 'events after checkpoint', tone: 'info' },
        { label: 'Route by key', sub: 'order per aggregate', tone: 'violet' },
        { label: 'Apply handlers', sub: 'event → row changes' },
        { label: 'Commit atomically', sub: 'rows + checkpoint', tone: 'ok' },
      ],
      caption: 'Repeat forever; crash anywhere and resume from the last committed checkpoint.',
    },
  },

  architecture: {
    overview: 'A projector is a **subscription loop** plus a **deterministic fold** into an external store. The hard parts are not the handlers but the edges: where the checkpoint lives relative to the data (same transaction vs separate store), how work is partitioned without breaking per-key order, how poison events are handled, and how a full replay is run beside the live projector.',
    diagram: {
      type: 'layers',
      title: 'Projector anatomy',
      layers: [
        { name: 'Source', items: ['Event store $all / category', 'Kafka partitions', 'Debezium CDC', 'DynamoDB Streams shards'], tone: 'info' },
        { name: 'Consumption', items: ['Checkpoint / offsets', 'Batch fetch', 'Key-partitioned workers'], tone: 'violet' },
        { name: 'Processing', items: ['Upcast + deserialize', 'Event handlers', 'Retry / park poison'], tone: 'accent' },
        { name: 'Sink', items: ['Version-guarded upserts', 'Checkpoint in same tx', 'Lag + DLQ metrics'], tone: 'ok' },
      ],
    },
    blocks: [
      { name: 'Checkpoint', what: 'Last fully applied position (global position, Kafka offset per partition, Axon tracking token, stream sequence number). Stored with the data when possible; it is the projector’s entire durable state.' },
      { name: 'Fetcher', what: 'Pulls batches after the checkpoint (`max.poll.records` default 500 in Kafka) and switches from catch-up to live tailing; backpressure comes from processing speed.' },
      { name: 'Key router', what: 'Assigns events to workers by `hash(aggregateId)` so all events of one entity are applied in order while different entities proceed in parallel — the same idea as Kafka partition keys.' },
      { name: 'Handlers', what: 'Pure mapping from event type to row changes. Unknown event types are ignored (forward compatibility); no remote calls, no `now()`, so replays are deterministic.' },
      { name: 'Idempotent sink', what: 'Same-transaction checkpoint, or per-row guards (`last_version`, `last_position`), external versions in Elasticsearch, conditional writes in DynamoDB — anything that turns a redelivery into a no-op.' },
      { name: 'Error policy', what: 'Bounded retries with backoff for transient errors; poison events parked to a DLQ with alerting, or the projection stops (for correctness-critical views).' },
      { name: 'Lag & health', what: 'Event lag, time lag, events/s, handler p99, DLQ depth, rebalance count. Without them the projector fails silently.' },
    ],
    real: [
      { name: 'Kafka consumer groups / Kafka Streams', how: 'Partitions are assigned across group members; offsets committed to `__consumer_offsets`. Kafka Streams adds local RocksDB state stores backed by changelog topics and `processing.guarantee=exactly_once_v2`, which makes read-process-write atomic **within Kafka** (not for external sinks).' },
      { name: 'Debezium + Kafka Connect sinks', how: 'Debezium reads the WAL/binlog, emits change events keyed by primary key; sink connectors (JDBC, Elasticsearch) upsert by key. Connect offers `errors.tolerance=all` with `errors.deadletterqueue.topic.name` for poison records and incremental snapshots (watermark-based, inspired by Netflix’s DBLog) for backfills.' },
      { name: 'Axon tracking / pooled streaming processors', how: 'Each processor stores a tracking token per **segment** in a token table; segments split/merge to change parallelism, and a processor can be reset to replay from the start while handlers detect replay mode.' },
      { name: 'AWS Lambda on DynamoDB Streams / Kinesis', how: 'An event source mapping polls each shard; `ParallelizationFactor` (1–10) runs concurrent batches per shard while keeping per-partition-key order; `BisectBatchOnFunctionError`, `MaximumRetryAttempts` and an on-failure destination isolate poison records.' },
      { name: 'Materialize / ksqlDB / RisingWave', how: 'Incremental view maintenance: you declare `CREATE MATERIALIZED VIEW … AS SELECT …` over streams and the engine computes per-event deltas (Materialize on differential dataflow; ksqlDB as Kafka Streams topologies). The projector is generated from SQL.' },
    ],
  },

  lifecycle: {
    summary: 'One batch from fetch to committed checkpoint, in a Postgres-backed projector consuming a Kafka partition.',
    stages: [
      { stage: 'Poll', what: '`poll()` returns up to 500 records for assigned partitions (or waits up to the poll timeout).', cost: 'Broker fetch RTT', ms: 2, part: 'fetch' },
      { stage: 'Deserialize + upcast', what: 'Avro/JSON decode, schema lookup (cached), upcast old versions.', cost: '~5–20 µs/event', ms: 0.5, part: 'handler' },
      { stage: 'Route by key', what: 'Group by aggregate id into per-key ordered lists for workers.', cost: 'In-memory hash', ms: 0.05, part: 'router' },
      { stage: 'Handle', what: 'Map each event to row upserts; coalesce multiple updates to the same row in the batch.', cost: 'CPU', ms: 0.5, part: 'handler' },
      { stage: 'Write batch', what: 'Multi-row `INSERT … ON CONFLICT DO UPDATE … WHERE version <` guard.', cost: 'Index updates for ~500 rows', ms: 8, part: 'sink' },
      { stage: 'Store checkpoint', what: 'Update `projection_checkpoints` (topic, partition, offset) in the same transaction.', cost: 'One row update', ms: 0.2, part: 'sink' },
      { stage: 'Commit', what: 'Single fsync/WAL flush for the whole batch.', cost: 'Commit latency', ms: 2, part: 'sink' },
      { stage: 'Emit metrics', what: 'Update lag (`head − offset`, time since event), throughput, handler latency.', cost: 'Async', ms: 0.05, part: 'monitor' },
    ],
  },

  deepDives: [
    {
      title: 'Checkpointing: atomic with the view, or idempotent writes',
      hook: 'Where the checkpoint lives decides whether you have exactly-once effects or double counting.',
      body: [
        'If the view and checkpoint are in the same database, write both in one transaction: after a crash, data and checkpoint agree, so you get **effectively-once** application without idempotent handlers. This is why many teams store Kafka offsets in their own table and seek to them on startup, instead of committing to `__consumer_offsets`.',
        'If the sink is elsewhere (Elasticsearch, Redis, another service), the checkpoint must be committed **after** the write, giving at-least-once; every write must then be idempotent. Committing **before** the write (including Kafka’s `enable.auto.commit=true` default with a 5 s interval when processing is async) gives at-most-once — silent loss.',
      ],
      code: {
        lang: 'sql',
        caption: 'Same-transaction checkpoint with a version guard',
        code: `BEGIN;
INSERT INTO order_summary (order_id, status, item_count, last_version)
VALUES ($1, 'SHIPPED', $2, $3)
ON CONFLICT (order_id) DO UPDATE
  SET status = EXCLUDED.status,
      item_count = EXCLUDED.item_count,
      last_version = EXCLUDED.last_version
  WHERE order_summary.last_version < EXCLUDED.last_version;

UPDATE projection_checkpoints
   SET position = $batch_last_offset, updated_at = now()
 WHERE projection = 'order_summary' AND partition = $partition;
COMMIT;`,
      },
      insight: 'Even with an atomic checkpoint, keep the version guard: rebalances, manual offset resets and blue/green replays will deliver old events again, and the guard is what makes those operations safe.',
    },
    {
      title: 'Ordering and parallelism by key',
      hook: 'You almost never need global order — but you always need per-entity order.',
      body: [
        'Correctness requires that events of one aggregate are applied in order (`Placed` before `Shipped`). Across aggregates, order rarely matters. So partition by aggregate id: Kafka partition key, Axon segment, DynamoDB partition key — and run one ordered worker per partition. Parallelism is then bounded by partition count, which is hard to change later in Kafka (adding partitions remaps keys).',
        'Views that **combine** aggregates (customer totals from many orders) need either commutative updates (increments) so order across orders does not matter, or partitioning by the view’s key (customer id) — which may mean re-keying the stream first (a Kafka Streams repartition topic).',
        'Inside a partition you can still parallelize: libraries like Confluent’s parallel consumer process different keys of one partition concurrently while tracking per-offset completion, so the committed offset only advances past contiguous completed records.',
      ],
      diagram: {
        type: 'flow',
        title: 'Parallel by key, ordered per key',
        nodes: [
          { label: 'Topic, 12 partitions', sub: 'key = orderId', tone: 'info' },
          { label: 'Consumer group', sub: '6 instances × 2 partitions' },
          { label: 'Per-partition worker', sub: 'strict order within key', tone: 'violet' },
          { label: 'View rows', sub: 'version-guarded upserts', tone: 'ok' },
        ],
      },
      insight: 'Out-of-order arrival still happens — after a producer retry, a re-keying, or a CDC re-snapshot. The version guard (`WHERE last_version < new`) is the safety net that makes order a performance property rather than a correctness one.',
    },
    {
      title: 'Poison events and error handling',
      hook: 'One undeserializable event can stop a projection forever — or silently corrupt it if skipped.',
      body: [
        'Classify errors. **Transient** (DB timeout, deadlock): retry with backoff, without advancing the checkpoint. **Permanent** (cannot deserialize, violates assumptions): after N attempts either **stop** the projection and page (balances, anything where a missing event is a wrong answer) or **park** the event to a DLQ and continue (search, recommendations), recording which keys are now suspect.',
        'Parking breaks per-key order for that key: later events of the same aggregate may apply on top of a missing one. Better systems park the whole key (skip subsequent events for that aggregate until the parked one is re-driven) or mark the row as "needs rebuild".',
      ],
      bullets: [
        'Kafka Connect: `errors.tolerance=all`, `errors.deadletterqueue.topic.name`, `errors.deadletterqueue.context.headers.enable=true`.',
        'Lambda event source mapping: `BisectBatchOnFunctionError=true` splits a failing batch to find the poison record; on-failure destination to SQS/SNS.',
        'Always alert on DLQ depth > 0 for correctness-critical views; a DLQ nobody watches is data loss with extra steps.',
      ],
      insight: 'The default retry behaviour of most frameworks is "retry forever" or "skip and log". Both are wrong for different views — choose the policy per projection explicitly.',
    },
    {
      title: 'Replay, reprocessing and backfills',
      hook: 'The log lets you rebuild any view — if your projector can run twice side by side.',
      body: [
        'Full replay: start a second projector instance with a new name and checkpoint at position 0, writing into `view_v2`. It catches up at bulk speed (bigger batches, `COPY`, indexes created after load), then tails live; switch the read alias and retire v1. Never reset the live projector in place unless the view can be empty for the duration.',
        'Kafka-specific: replays need the data to still be there — default `retention.ms` is 7 days. For long-lived rebuilds use infinite retention with tiered storage, a compacted "state" topic plus a snapshot, or replay from the source database through a CDC **incremental snapshot**, which interleaves chunked table reads with the live change stream using watermarks so the result is consistent.',
        'Handlers with side effects (emails, webhooks) must not run during a replay: separate "projection" handlers from "reaction" handlers, or detect replay mode and suppress effects.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Side-by-side replay',
        actors: ['Log', 'Projector v1', 'Projector v2', 'View v1', 'View v2', 'Query API'],
        messages: [
          { from: 'Log', to: 'Projector v1', label: 'live events' },
          { from: 'Projector v1', to: 'View v1', label: 'upserts' },
          { from: 'Log', to: 'Projector v2', label: 'replay from 0 (bulk)', tone: 'info' },
          { from: 'Projector v2', to: 'View v2', label: 'batched loads' },
          { from: 'Projector v2', to: 'Query API', label: 'caught up, lag ≈ 0', tone: 'ok' },
          { from: 'Query API', to: 'View v2', label: 'switch alias' },
        ],
      },
      insight: 'A projector that cannot run as two named instances at once (because of hard-coded table names or a global singleton lock) cannot be rebuilt without downtime. Make view name and checkpoint name configuration.',
    },
    {
      title: 'At-least-once dedup strategies',
      hook: 'Idempotency is a property of the write, not of the message broker.',
      body: [
        'Pick by sink. **Version guard per row** when events carry an aggregate version — cheapest and handles reordering. **Processed-event table** `(projection, event_id)` with a unique constraint inserted in the same transaction — handles events without versions, costs a row per event (expire old entries). **Natural idempotency**: setting absolute values (`status = SHIPPED`) is idempotent; increments (`count = count + 1`) are not, so convert deltas to absolutes or guard them.',
        'Non-transactional sinks need native conditional writes: Elasticsearch `version_type=external`, DynamoDB `ConditionExpression` on a version attribute, Redis Lua scripts that compare a stored version before writing.',
      ],
      table: {
        columns: ['Sink', 'Dedup mechanism', 'Handles reorder?'],
        rows: [
          ['Postgres/MySQL', 'Same-tx checkpoint or `WHERE version <` guard', 'With guard: yes'],
          ['Elasticsearch', '`version_type=external` with event version', 'Yes'],
          ['DynamoDB', 'Conditional put on `version < :v`', 'Yes'],
          ['Redis', 'Lua compare-and-set on version field', 'Yes, if scripted'],
          ['Counters anywhere', 'Processed-event id set, or derive from absolutes', 'Only with id set'],
        ],
      },
      insight: 'Increments are the classic double-count bug. If a view needs counts, either guard the increment with a processed-event check in the same transaction or recompute the count from a set.',
    },
    {
      title: 'Generated projectors: Kafka Streams, ksqlDB, Materialize, Debezium',
      hook: 'Sometimes the best projector is the one you declare instead of write.',
      body: [
        '**Debezium** turns a database into an ordered change stream (snapshot, then WAL/binlog streaming), keyed by primary key — the input for projectors when the write side is plain CRUD. **Kafka Streams** gives a library-level projector with local RocksDB state, changelog topics for recovery, repartitioning for re-keying, and exactly-once inside Kafka. **ksqlDB** compiles SQL into Kafka Streams topologies (`CREATE TABLE … AS SELECT`) and can serve pull queries on the resulting state.',
        '**Materialize** and **RisingWave** maintain arbitrary SQL views incrementally — joins and aggregates are updated per change rather than recomputed — and serve them over the Postgres wire protocol. They shine when you have many views and joins; you trade hand-written control (custom idempotency, poison handling, sink choice) for an extra stateful system to run.',
      ],
      code: {
        lang: 'sql',
        caption: 'ksqlDB: a per-customer view maintained from an orders stream',
        code: `CREATE STREAM orders (order_id VARCHAR KEY, customer_id VARCHAR,
                      total_cents BIGINT, status VARCHAR)
  WITH (KAFKA_TOPIC = 'orders', VALUE_FORMAT = 'JSON');

CREATE TABLE customer_stats AS
  SELECT customer_id,
         COUNT(*)         AS order_count,
         SUM(total_cents) AS lifetime_cents
  FROM orders
  GROUP BY customer_id
  EMIT CHANGES;   -- repartitions by customer_id under the hood`,
      },
      insight: 'Streaming SQL engines make the re-keying and state management invisible, which is great until a rebuild: their state is rebuilt from topics, so source retention and changelog size still decide how fast you recover.',
    },
    {
      title: 'Lag: the projector’s SLI',
      hook: 'Lag in events tells you throughput; lag in seconds tells you user impact.',
      body: [
        '`event_lag = head_position − checkpoint` per partition; `time_lag = now − timestamp(oldest unprocessed event)`. Idle partitions have zero lag; a partition stuck on a poison event shows rising time lag with zero throughput — alert on that combination specifically.',
        'Tooling: Kafka `records-lag-max` client metric, `kafka-consumer-groups.sh --describe`, LinkedIn’s Burrow (evaluates lag trends rather than thresholds), Debezium `MilliSecondsBehindSource`, Lambda `IteratorAge` for streams.',
      ],
      insight: 'Alert on time lag against a per-view SLO and on lag slope, not on a static event count — 10k events behind is 50 ms for one projector and an hour for another.',
    },
  ],

  scaling: {
    body: [
      'Projectors are stateless except for their checkpoint, so they scale by partition: N partitions allow up to N active consumers per projection. Rebalances (instance added/removed) pause consumption; use cooperative-sticky assignment (`partition.assignment.strategy=CooperativeStickyAssignor`) or static membership (`group.instance.id`) to avoid stop-the-world rebalances on deploys.',
      'For sources without partitions (a single `$all` stream), either run one active instance with a leader lease and standbys, or split by hashing aggregate ids into segments (Axon) where each segment reads the whole stream but applies only its keys — read amplification for write parallelism.',
      'Throughput is usually bound by the sink, not the log. Batching (100–1,000 events per transaction) and coalescing multiple updates to the same row within a batch give 10–50× over row-at-a-time.',
    ],
    bullets: [
      'Partition count caps parallelism; choose it for peak replay speed, not just live traffic.',
      'Separate consumer groups per projection so one slow view never holds back another.',
      'Run rebuilds as a separate, temporarily wide deployment writing to v2.',
      'Multi-region: run projectors per region from the replicated log; checkpoints are region-local.',
      '`max.poll.interval.ms` (default 5 min): a batch slower than this gets the consumer kicked from the group and causes a rebalance loop.',
    ],
    diagram: {
      type: 'compare',
      title: 'Scaling models',
      columns: [
        { name: 'Partitioned log', tone: 'ok', points: ['1 consumer per partition', 'Order per key', 'Scale = partitions'] },
        { name: 'Single stream + segments', tone: 'info', points: ['Each segment reads all', 'Applies only its keys', 'Read amplification'] },
        { name: 'Single active + standby', tone: 'warn', points: ['Leader lease', 'Global order', 'One-thread ceiling'] },
      ],
    },
  },

  failures: [
    { name: 'Double counting after restart', symptom: 'Counters drift upward after deploys and rebalances.', detect: 'Reconciliation vs source; spike in drift after `rebalance` events.', mitigate: 'Atomic checkpoint or processed-event set; convert increments to absolutes.' },
    { name: 'Rebalance storm', symptom: 'Lag sawtooth; consumers repeatedly join/leave; duplicate processing.', detect: 'Consumer-group rebalance rate; `max.poll.interval.ms` exceeded logs.', mitigate: 'Smaller batches, cooperative-sticky assignment, static membership, move slow work out of the poll loop.' },
    { name: 'Poison event blocks a partition', symptom: 'One partition’s lag climbs while others are fine.', detect: 'Per-partition time lag rising with zero throughput; repeated exception at the same offset.', mitigate: 'Bounded retries, park key + DLQ + alert, tolerant deserialization.' },
    { name: 'Silent loss from auto-commit', symptom: 'Rare missing rows after crashes; no errors.', detect: 'Reconciliation mismatches clustered around restarts.', mitigate: 'Disable auto-commit; commit after the write or in the same transaction.' },
    { name: 'Replay impossible: data expired', symptom: 'Rebuild starts from an offset that no longer exists (`OffsetOutOfRange`), `auto.offset.reset=latest` skips history.', detect: 'Oldest offset vs projection needs; alarm on reset events.', mitigate: 'Infinite retention or tiered storage for source topics; CDC incremental snapshots; event store as archive.' },
    { name: 'Side effects during replay', symptom: 'Customers receive thousands of old emails after a rebuild.', detect: 'Outbound message rate spike correlated with projector reset.', mitigate: 'Split projections from reactions; replay-mode flag; idempotency keys on outbound calls.' },
  ],

  warStories: [
    { title: 'Auto-commit lost events on every deploy', source: 'Composite of common incidents', what: 'A projector handed records to an async thread pool while `enable.auto.commit=true` committed offsets every 5 s. Deploys killed the pool mid-flight; committed offsets had already moved past unprocessed records. A few hundred rows per deploy were missing from a billing view.', lesson: 'Offsets are commits of **processing**, not of receipt. Commit only after the sink write (or atomically with it).' },
    { title: 'Rebuild that emailed every customer', source: 'Composite of common incidents', what: 'A team reset a projector to rebuild a view; the same handler class also sent "order shipped" emails. The replay re-sent years of notifications within minutes.', lesson: 'Separate state projections from side-effecting reactions, and give reactions idempotency keys.' },
    { title: 'Netflix DBLog for backfills', source: 'Netflix Tech Blog, "DBLog: A Generic Change-Data-Capture Framework" (2019)', what: 'Netflix needed to backfill full table state into downstream stores while CDC kept streaming. DBLog interleaves chunked `SELECT`s with log events using low/high watermarks so the output is a consistent history without locking tables. Debezium later adopted the same idea for incremental snapshots.', lesson: 'Backfills and live CDC must be merged by position, not run as separate jobs, or late chunks overwrite newer changes.' },
  ],

  numbers: [
    { label: 'Normal projector lag', value: '10–500 ms', note: 'poll + batch + commit' },
    { label: 'Kafka `max.poll.records` default', value: '500', note: 'records per poll' },
    { label: 'Kafka `max.poll.interval.ms` default', value: '300,000 (5 min)', note: 'exceed ⇒ rebalance' },
    { label: 'Kafka `auto.commit.interval.ms` default', value: '5,000', note: 'with auto-commit enabled by default' },
    { label: 'Batch speed-up', value: '10–50×', note: '100–1,000 events per transaction vs 1' },
    { label: 'Row-at-a-time Postgres upserts', value: '~1–3k/s per connection', note: 'commit fsync bound' },
    { label: 'Batched rebuild throughput', value: '10k–50k events/s per partition', note: 'sink-bound' },
    { label: 'DynamoDB/Kinesis stream retention', value: '24 h (Kinesis up to 365 d)', note: 'not an archive' },
    { label: 'Lambda `ParallelizationFactor`', value: '1–10 per shard', note: 'keeps per-key order' },
  ],

  capacity: {
    question: 'A projector must keep up with 15k events/s peak and rebuild 2B events in under 4 hours. The sink is Postgres. How many partitions and instances?',
    steps: [
      'Live: one partition worker with 500-event batches sustains ~10k events/s if the sink handles ~20 commits/s of 500 rows — so 15k/s needs ≥ 2 workers; with 3× headroom plan ~6.',
      'Rebuild: 2B events / (4 × 3,600 s) ≈ 139k events/s.',
      'At ~10k events/s per worker ⇒ ≥ 14 workers; Postgres must absorb ~140k row upserts/s — use `COPY` into an unindexed v2 table, index afterwards.',
      'Partitions cap parallelism, so provision 24–32 partitions (rebuild needs > live; Kafka partitions are hard to add without remapping keys).',
      'Run live with 6 instances and rebuild with a separate 16-instance deployment into `view_v2`.',
    ],
    answer: '~32 partitions; 6 instances for live traffic and a temporary 16-instance rebuild job with bulk loads. The sink, not Kafka, is the bottleneck — budget its write capacity for the rebuild.',
  },

  comparison: {
    caption: 'Ways to run projections',
    columns: ['Option', 'Checkpoint', 'Exactly-once scope', 'Ops cost', 'Best for'],
    rows: [
      ['Hand-written consumer + DB tx', 'Own table, same tx', 'Into that DB', 'Low', 'Most CQRS views on SQL'],
      ['Kafka Streams', '`__consumer_offsets` + changelogs', 'Within Kafka (EOS v2)', 'Medium', 'Stateful stream views, joins'],
      ['Debezium + Connect sink', 'Connect offsets', 'At-least-once + upserts', 'Medium', 'DB → search/warehouse replication'],
      ['Axon processors', 'Token table per segment', 'Same tx as JPA/JDBC view', 'Low (in Axon apps)', 'Java CQRS/ES'],
      ['Materialize / ksqlDB', 'Engine-managed', 'Engine-internal consistency', 'Medium–high', 'Many SQL-defined incremental views'],
    ],
  },

  whenNot: [
    'When a database index, materialized view or read replica answers the query — no projector needed.',
    'For synchronous invariants (stock must not go negative) — enforce on the write side, not in a projection.',
    'For side effects like emails and payments — use a reaction/saga with idempotency keys, not a replayable projection.',
    'For heavy ad-hoc analytics — load the log into a warehouse instead of hand-maintaining aggregates.',
  ],

  interview: [
    {
      q: 'Your projector crashed mid-batch. Walk through how you guarantee no loss and no double application.',
      a: 'The checkpoint is committed only after the writes, ideally in the same transaction as the view rows, so a crash before commit replays the batch and a crash after commit resumes after it. Writes are still version-guarded upserts so redeliveries from rebalances or offset resets are no-ops. If the sink is not transactional with the checkpoint, I accept at-least-once and make every write idempotent with external versions or conditional writes. Auto-commit is off.',
      followUps: ['What breaks with increments?', 'How do you do this with Elasticsearch?', 'What does Kafka EOS give you here?'],
      seniorSignal: 'Explains that Kafka exactly-once covers Kafka-to-Kafka only and that external sinks need idempotent writes.',
    },
    {
      q: 'How do you scale a projector 10× while keeping order?',
      a: 'Order only matters per aggregate, so partition by aggregate id and run one ordered worker per partition; parallelism equals partitions. For views keyed by something else (customer totals), re-key the stream by the view key or use commutative updates. Batch and coalesce writes because the sink is usually the bottleneck. Use cooperative rebalancing to avoid stop-the-world pauses.',
      followUps: ['What if the source is a single ordered stream?', 'How do you change partition counts later?', 'What about hot keys?'],
      seniorSignal: 'Identifies the sink as the bottleneck and handles views whose key differs from the source key.',
    },
    {
      q: 'An event in the stream cannot be deserialized. What should happen?',
      a: 'Retry a few times in case it is transient, then apply a per-projection policy: for correctness-critical views stop and page, because skipping yields wrong answers; for best-effort views park the event — ideally the whole key — to a DLQ, continue, and alert. Fix the deserializer or upcaster, re-drive the parked events, and add the event to a historical test corpus.',
      followUps: ['Why park the whole key?', 'How do you re-drive in order?', 'How would Lambda handle this?'],
      seniorSignal: 'Recognizes that parking breaks per-key order and chooses policy per view.',
    },
    {
      q: 'Design a zero-downtime rebuild of a projection over 2B events.',
      a: 'Run a second, named projector from position 0 into `view_v2` with bulk-load settings while v1 serves. Partition the replay for parallelism, defer secondary indexes, then switch to live tailing once caught up. Validate (counts, checksums, sampled diffs), switch the alias, keep v1 for rollback, then drop it. Ensure source retention covers the full history and suppress side effects during replay.',
      followUps: ['How long does it take?', 'What if the source topic only has 7 days of data?', 'How do you validate v2?'],
      seniorSignal: 'Checks source retention and side-effect suppression, and does the throughput math.',
    },
    {
      q: 'How do you know a projection is healthy?',
      a: 'Time lag per partition against an SLO, event-lag slope, throughput, handler p99, DLQ depth, and rebalance rate. A partition with rising time lag and zero throughput is a stuck poison event. Lag alone does not catch silent bugs, so a periodic reconciliation compares counts or sums between source and view.',
      followUps: ['What is Burrow’s approach?', 'How do you expose freshness to users?', 'What does zero lag with wrong data indicate?'],
      seniorSignal: 'Pairs freshness metrics with correctness reconciliation.',
    },
  ],

  takeaways: [
    'A projector is a subscription loop + deterministic handlers + a checkpoint; the checkpoint is its only state.',
    'Commit the checkpoint with the view writes, or after idempotent writes — never before.',
    'Per-key order via partitioning; version guards make reordering and redelivery harmless.',
    'Poison-event policy is per view: stop-and-page for correctness, park-and-continue for best-effort.',
    'Rebuild side by side into v2 and swap; never replay side effects.',
    'The sink is usually the bottleneck — batch, coalesce, bulk-load.',
    'Alert on time lag and verify with reconciliation; zero lag does not mean correct.',
  ],
};

export default deep;
