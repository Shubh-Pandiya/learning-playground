import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'stream',

  problem: {
    why: 'An event stream is a durable, partitioned, append-only **log** that many consumers read independently, each at its own position. It exists because "what happened" is valuable to many systems at different times: billing, search, fraud and the warehouse all want the same `OrderPlaced` events, some in real time and some by replaying last week. A queue deletes on consume; a log keeps history and lets the reader own its cursor.',
    withoutIt: [
      'Every new consumer needs the producer to add another publish call or queue (N point-to-point integrations, producer coupled to all of them).',
      'A consumer bug that corrupted data cannot be fixed by replaying — the events are gone once acked.',
      'Per-entity ordering across many consumers is impossible to guarantee with independent queues.',
      'Rebuilding a cache, search index or new microservice’s state requires a bespoke bulk export from the source DB.',
      'High-volume telemetry (clicks, logs, metrics at 1M events/s) overwhelms per-message-ack brokers.',
    ],
    position: 'A shared backbone between producers (services, CDC connectors, edge collectors) and many consumer groups (stream processors, sinks to warehouses/search, microservices). Producers append; consumers pull from their own offsets.',
    diagram: {
      type: 'flow',
      title: 'One log, many readers',
      nodes: [
        { label: 'Producers', sub: 'append by key', tone: 'neutral' },
        { label: 'Partitioned log', sub: 'retained 7 days', tone: 'accent' },
        { label: 'Billing group', sub: 'offset 9.81M, live', tone: 'ok' },
        { label: 'Search group', sub: 'lag 40k', tone: 'warn' },
        { label: 'Warehouse sink', sub: 'hourly batch', tone: 'info' },
      ],
      caption: 'Consumers do not affect each other; each owns an offset per partition.',
    },
  },

  architecture: {
    overview: 'At design level every streaming system has the same shape: a topic split into **partitions** (shards), each an ordered, replicated log with monotonically increasing offsets; producers route records by key hash; consumers in a **group** divide partitions so each partition has exactly one reader per group; retention deletes old segments by time/size or compacts to the latest value per key. Kafka internals (ISR, high watermark, rebalancing protocols, transactions) are covered in depth in the Kafka module — here we focus on the design-level contract and choosing between systems.',
    diagram: {
      type: 'layers',
      title: 'Stream system layers',
      layers: [
        { name: 'Clients', items: ['producer: key → partition', 'batching + compression', 'consumer group'], tone: 'neutral' },
        { name: 'Serving', items: ['partition leaders', 'fetch / append', 'offset commits'], tone: 'accent' },
        { name: 'Storage', items: ['segment files', 'replicas across AZs', 'tiered to S3'], tone: 'info' },
        { name: 'Control plane', items: ['metadata (KRaft)', 'leader election', 'group coordinator'], tone: 'violet' },
      ],
      caption: 'Pulsar and WarpStream move the storage layer out of the brokers; Kafka and Redpanda keep it local (plus optional tiering).',
    },
    blocks: [
      { name: 'Topic + partitions', what: 'Unit of parallelism and ordering. Order is guaranteed only within a partition; key hash (`murmur2(key) % N` in Kafka) keeps one entity on one partition.' },
      { name: 'Offsets', what: 'Position of a record in its partition. Consumers commit offsets (Kafka: `__consumer_offsets`; Kinesis KCL: a DynamoDB lease table) — the cursor belongs to the reader, which is what makes replay trivial.' },
      { name: 'Segments + retention', what: 'Each partition is a series of segment files (Kafka default 1 GB); whole old segments are deleted by `retention.ms` (default 7 days) or `retention.bytes`.' },
      { name: 'Compaction', what: '`cleanup.policy=compact` keeps the latest record per key and tombstones (null values) for `delete.retention.ms`, turning a topic into a replayable table snapshot.' },
      { name: 'Consumer groups', what: 'Partitions are assigned to group members; parallelism per group ≤ partition count. A rebalance reassigns partitions when members join or leave.' },
      { name: 'Replication', what: 'Each partition is replicated (RF=3 typical) across racks/AZs; acknowledged writes survive broker loss when `acks=all` with `min.insync.replicas=2`.' },
      { name: 'Tiered storage', what: 'Old segments offloaded to object storage (Kafka KIP-405, Pulsar, Redpanda) so retention is priced like S3 and brokers stay small.' },
    ],
    real: [
      { name: 'Apache Kafka', how: 'Brokers own partition replicas on local disk and serve reads from the page cache with zero-copy; KRaft controllers (Raft) hold metadata since ZooKeeper’s removal in 4.0. See the Kafka module for ISR, offsets, rebalancing and exactly-once in depth.' },
      { name: 'Amazon Kinesis Data Streams', how: 'Managed shards with hard per-shard limits (1 MB/s or 1,000 records/s in, 2 MB/s out shared, or 2 MB/s per consumer with enhanced fan-out push). Resharding splits/merges shards; KCL tracks leases and checkpoints in DynamoDB and processes parent shards before children to keep order.' },
      { name: 'Apache Pulsar', how: 'Stateless brokers serve topics; data lives in Apache BookKeeper as ledgers striped across bookies, so moving a topic to another broker copies no data. Built-in subscription types (exclusive, failover, shared, key_shared) with per-message acks, geo-replication and tiered storage.' },
      { name: 'Redpanda', how: 'Kafka-API-compatible C++ (Seastar) thread-per-core engine; Raft per partition, no JVM or ZooKeeper, fsyncs by default and manages its own memory instead of the page cache. Same client contract, different operational profile.' },
      { name: 'WarpStream / object-store Kafka', how: 'Kafka protocol served by stateless agents that write batches directly to S3 and keep metadata in a separate service. No local disks or cross-AZ replication traffic; end-to-end latency is hundreds of ms instead of single-digit ms.' },
    ],
  },

  lifecycle: {
    summary: 'One `OrderPlaced` record from producer to a consumer’s committed offset, with `acks=all` and replicas across AZs. Latency is mostly batching and replication; consumer lag dwarfs it when consumers fall behind.',
    stages: [
      { stage: 'Partition + batch', what: 'Key `orderId=42` hashes to partition 7; record waits for `linger.ms` with others, batch compressed (lz4/zstd).', cost: 'Deliberate batching delay.', ms: 5 },
      { stage: 'Send to leader', what: 'Produce request to partition 7’s leader over a persistent connection.', cost: '1 RTT in-AZ or cross-AZ.', ms: 0.8 },
      { stage: 'Append', what: 'Leader assigns offsets and appends to the active segment (page cache).', cost: 'Sequential write, µs.', ms: 0.05 },
      { stage: 'Replicate (acks=all)', what: 'Followers in other AZs fetch the batch; leader acks once the in-sync set has it.', cost: 'Follower fetch cycle + cross-AZ RTT.', ms: 3 },
      { stage: 'Consumer fetch', what: 'Long-poll fetch returns when data or `fetch.max.wait.ms` elapses; served from page cache via zero-copy.', cost: 'Near zero if consumer is caught up.', ms: 2 },
      { stage: 'Process', what: 'Consumer handler / stream-processor operator updates state or writes a sink.', cost: 'Your code.', ms: 10 },
      { stage: 'Commit offset', what: 'Async commit of the next offset after processing (at-least-once).', cost: 'Batched, off the hot path.', ms: 1 },
    ],
  },

  deepDives: [
    {
      title: 'The log contract at design level (Kafka in one page)',
      hook: 'Five rules explain 90% of stream behaviour — the Kafka module covers the machinery behind them.',
      body: [
        'Rule 1: a topic is N partitions; each partition is an ordered log with offsets. Rule 2: records with the same key go to the same partition (until N changes). Rule 3: in a consumer group each partition has exactly one owner, so parallelism ≤ N and order is per partition. Rule 4: the consumer owns its offset; committing after processing is at-least-once. Rule 5: data leaves by retention or compaction, never by consumption.',
        'Everything else — ISR and the high watermark, cooperative rebalancing, idempotent producers, transactions — exists to make these rules hold under failure. For a design review you mostly need the consequences: choose the key for ordering and balance, choose N for peak parallelism, choose retention for your replay window, and design consumers to be idempotent.',
      ],
      diagram: {
        type: 'flow',
        title: 'Key → partition → owner',
        nodes: [
          { label: 'key=order-42', sub: 'hash mod 12', tone: 'neutral' },
          { label: 'Partition 7', sub: 'offsets 0…9.8M', tone: 'accent' },
          { label: 'Group billing', sub: 'C3 owns p7', tone: 'ok' },
          { label: 'Group search', sub: 'C1 owns p7', tone: 'ok' },
        ],
        caption: 'Same partition, two independent owners in two groups.',
      },
      insight: 'Adding partitions to a keyed topic silently re-routes existing keys (hash mod N changes), so events for one entity can be read out of order across the old and new partition — over-provision partitions up front or migrate to a new topic.',
    },
    {
      title: 'Stream or queue? The judgment call',
      hook: 'Most "we picked Kafka and regret it" stories are work queues forced into a log, and vice versa.',
      body: [
        'Choose a **log** when the same events have several consumers, you need replay or backfill, ordering per key matters, or volume is very high (telemetry, CDC, event sourcing). Choose a **queue** when each message is a task for exactly one worker, tasks vary in duration, you need per-message retry/delay/priority, or consumers should scale far beyond any partition count.',
        'The failure modes are opposite. A log blocks on a slow or poison record (head-of-line per partition) and caps parallelism at the partition count; a queue loses history and ordering. Hybrids exist — Pulsar shared subscriptions, Kafka share groups (KIP-932), Uber’s consumer proxy, Confluent’s parallel consumer — but they trade back the ordering guarantees that made the log attractive.',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Log (Kafka, Kinesis)', tone: 'accent', points: ['Many groups, each sees all', 'Replay from any offset', 'Order per partition', 'Parallelism ≤ partitions', 'Slow record blocks partition'] },
          { name: 'Queue (SQS, RabbitMQ)', tone: 'ok', points: ['One consumer per message', 'Deleted on ack, no replay', 'Order only per FIFO group', 'Consumers scale freely', 'Per-message retry, delay, DLQ'] },
        ],
      },
      insight: 'A common, sound design uses both: the log as the system of record for events, and per-service queues (or share groups) for task execution derived from it.',
    },
    {
      title: 'Partition count sizing and hot partitions',
      hook: 'Partition count is the one decision you cannot cheaply change later on a keyed topic.',
      body: [
        'Size partitions for **peak consumer parallelism** and throughput: N ≥ max(target MB/s ÷ per-partition produce MB/s, target ÷ per-partition consume MB/s, max consumers you will ever want in a group). A planning number of ~5–10 MB/s per Kafka partition is conservative; per Kinesis shard it is a hard 1 MB/s in. Then add headroom (2–3×) because re-partitioning keyed data is a migration.',
        'Too many partitions has costs too: more open files and replicas per broker, longer failover and rebalance times, more producer batches (smaller, less efficient), and per-partition memory on consumers. KRaft raised cluster-wide limits a lot, but per-broker replica counts in the low thousands remain a sensible ceiling.',
        'A **hot partition** comes from skewed keys (one celebrity, one big tenant, a null key bug). Options: a better key (order id instead of merchant id), key salting (`merchant-7#k` for k in 0..7) with a downstream merge, or splitting the hot entity’s traffic to its own topic. Kinesis can split only the hot shard; Kafka cannot split a partition.',
      ],
      table: {
        caption: 'Example: 300 MB/s peak, consumer handles 4 MB/s per instance',
        columns: ['Constraint', 'Math', 'Partitions'],
        rows: [
          ['Produce throughput', '300 ÷ 10 MB/s per partition', '30'],
          ['Consumer throughput', '300 ÷ 4 MB/s per consumer', '75'],
          ['Headroom 2×', '75 × 2', '150'],
          ['Round for even spread', 'divisible by broker count (6)', '150'],
        ],
      },
      insight: 'Consumer processing speed, not broker throughput, usually decides partition count — measure how fast one consumer instance really processes before picking N.',
    },
    {
      title: 'Consumer lag, replay, retention and compaction',
      hook: 'Lag is the stream’s queue depth; retention is the deadline by which lag becomes data loss.',
      body: [
        '**Consumer lag** = log end offset − committed offset, per partition. Record counts are hard to reason about; convert to **time lag** (age of the record at the committed offset) for SLOs. Tools: `kafka-consumer-groups --describe`, Burrow (LinkedIn), the `records-lag-max` client metric, Kinesis `GetRecords.IteratorAgeMilliseconds`.',
        'Retention is a contract: if a consumer is down longer than `retention.ms`, its committed offset falls off the log. The consumer then applies `auto.offset.reset` — `latest` (the default) **silently skips** everything to the end, `earliest` reprocesses the whole retained log. Pick it deliberately and alert on offset-out-of-range resets.',
        '**Replay** is a feature: reset a group to a timestamp after fixing a bug, or start a new group from `earliest` to backfill a new service. Replays need idempotent sinks and enough downstream capacity. **Compaction** keeps the latest value per key indefinitely, so a compacted topic can bootstrap full state (changelogs, CDC tables) without infinite retention.',
      ],
      code: {
        lang: 'bash',
        caption: 'Inspect lag and replay a group from a timestamp',
        code: `kafka-consumer-groups --bootstrap-server $B --describe --group search-indexer
# TOPIC   PARTITION CURRENT-OFFSET LOG-END-OFFSET LAG
# orders  7         9812004        9852210        40206

kafka-consumer-groups --bootstrap-server $B --group search-indexer \\
  --topic orders --reset-offsets --to-datetime 2026-11-27T00:00:00.000 \\
  --execute          # group must be stopped

kafka-configs --bootstrap-server $B --alter --entity-type topics \\
  --entity-name customers --add-config cleanup.policy=compact`,
      },
      insight: 'Lag alerts based on record counts fire constantly on busy topics and never on quiet ones; alert on time lag versus a per-consumer SLO, plus "lag approaching retention", which is the data-loss alarm.',
    },
    {
      title: 'Exactly-once: where the boundary really is',
      hook: 'Exactly-once is a property of a pipeline segment, not of a broker.',
      body: [
        'Inside Kafka, an idempotent producer plus transactions that atomically write output records and the consumer’s offsets give exactly-once **read-process-write** between Kafka topics (Kafka Streams `processing.guarantee=exactly_once_v2`). Flink achieves the same with checkpoint barriers plus a two-phase-commit Kafka sink that commits transactions when a checkpoint completes.',
        'The guarantee stops at the edge. Sending an email, charging a card or writing to Postgres from a consumer is at-least-once unless that side effect is idempotent or transactional with the offset (store offset in the same DB transaction as the write, and seek to it on restart). Kinesis and most other streams offer at-least-once only.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Transactional read-process-write',
        actors: ['Input topic', 'Processor', 'Output topic', 'Offsets'],
        messages: [
          { from: 'Input topic', to: 'Processor', label: 'fetch records' },
          { from: 'Processor', to: 'Output topic', label: 'write results (txn)' },
          { from: 'Processor', to: 'Offsets', label: 'send offsets (txn)' },
          { from: 'Processor', to: 'Output topic', label: 'commit txn', tone: 'ok' },
          { from: 'Output topic', to: 'Processor', label: 'read_committed readers see it', dashed: true },
        ],
        caption: 'Atomic within Kafka; external effects still need idempotency.',
      },
      insight: 'When someone claims end-to-end exactly-once, ask where the external side effect happens — the honest answer is "effectively once" via idempotent sinks keyed by event id or offset.',
    },
    {
      title: 'Stream processing: windows, watermarks, state',
      hook: 'Event time vs processing time is the root of every wrong real-time dashboard.',
      body: [
        'Aggregations over streams are computed in **windows**: tumbling (fixed, non-overlapping, e.g. per minute), hopping/sliding (overlapping), and session (gap-based per key). Events arrive late and out of order (mobile clients, retries, partition skew), so windows should be keyed on **event time**, not arrival time.',
        'A **watermark** is the processor’s assertion "no events older than T are still expected"; when it passes a window’s end, the window fires. Late events beyond `allowedLateness` are dropped or sent to a side output. A partition with no traffic holds back the watermark for the whole job — configure idleness detection.',
        'Windowed and join state lives in **state stores**: Kafka Streams uses local RocksDB backed by compacted changelog topics (restore by replay, standby replicas for fast failover); Flink uses RocksDB or heap state with periodic (incremental) checkpoints to S3. State size and restore time drive recovery time objectives.',
      ],
      diagram: {
        type: 'flow',
        title: 'Event-time aggregation',
        nodes: [
          { label: 'Source partitions', sub: 'out-of-order events', tone: 'neutral' },
          { label: 'Watermarks', sub: 'max ts − 10 s', tone: 'info' },
          { label: 'Keyed windows', sub: '1-min tumbling', tone: 'accent' },
          { label: 'State store', sub: 'RocksDB + checkpoint', tone: 'violet' },
          { label: 'Sink', sub: 'idempotent upsert', tone: 'ok' },
        ],
      },
      insight: 'The bounded-out-of-orderness you choose is a latency vs completeness trade: a 10 s watermark delay means every result is at least 10 s late, and anything later than that is a correction you must handle downstream.',
    },
  ],

  scaling: {
    body: [
      'The data plane scales by partitions: add brokers and move partition replicas (Kafka reassignment copies data; Pulsar just reassigns topic ownership because storage is separate). Producers and consumers scale up to partition count. Throughput per broker is bound by disk and network; replication multiplies network by the replication factor, and cross-AZ replication is often the biggest line on the cloud bill.',
      'The control plane (metadata, leader election, group coordination) must keep working during broker loss: KRaft elects new partition leaders in seconds, and clients refresh metadata. A slow control plane shows up as long unavailability of partitions after a broker failure or as rebalance storms.',
      'Multi-region is asynchronous mirroring: MirrorMaker 2 or Confluent Cluster Linking replicate topics, with offset translation for consumer failover; Pulsar has built-in geo-replication. Expect duplicates and a small loss window on region failover, and keep ordering only within the region of origin (active-active usually means region-prefixed topics).',
    ],
    bullets: [
      'Partitions per broker: keep replica count per broker in the low thousands; plan cluster size from partitions × RF.',
      'Tiered storage decouples retention from broker disk: weeks of history at S3 prices, hot tail on local disk.',
      'Use rack/AZ-aware replica placement and follower fetching (consumers read from the closest replica) to cut cross-AZ traffic.',
      'Kinesis: split hot shards, or use on-demand mode; respect 5 GetRecords/s per shard or use enhanced fan-out.',
      'Quotas per client id protect the cluster from a runaway producer or a replaying consumer.',
      'For multi-region, decide per topic: aggregate (all regions → central) vs active-passive DR vs active-active with region-prefixed topics.',
    ],
    diagram: {
      type: 'flow',
      title: 'Active-active with mirroring',
      nodes: [
        { label: 'us-east producers', sub: 'topic us.orders', tone: 'neutral' },
        { label: 'us-east cluster', sub: 'local + mirrored eu.*', tone: 'accent' },
        { label: 'MirrorMaker 2', sub: 'async, offset sync', tone: 'warn' },
        { label: 'eu-west cluster', sub: 'local + mirrored us.*', tone: 'accent' },
        { label: 'eu consumers', sub: 'read both prefixes', tone: 'ok' },
      ],
    },
  },

  failures: [
    {
      name: 'Consumer lag runaway',
      symptom: 'Search results or dashboards minutes to hours stale; lag grows linearly.',
      detect: 'Time lag per group/partition (Burrow status, `records-lag-max`, Kinesis `IteratorAgeMilliseconds`) vs SLO; lag concentrated on one partition = hot key.',
      mitigate: 'Scale consumers up to partition count, speed up or batch the sink, fix key skew, add partitions for the future (new topic if keyed).',
    },
    {
      name: 'Retention overrun → silent skip',
      symptom: 'A consumer down over a long weekend restarts with no errors but missing three days of data.',
      detect: 'Offset-out-of-range / reset log lines, committed offset < log start offset, alert when time lag > 50% of retention.',
      mitigate: 'Retention ≥ worst-case outage + recovery time, `auto.offset.reset=earliest` for critical consumers (with idempotency), tiered storage for long retention.',
    },
    {
      name: 'Rebalance storms',
      symptom: 'Throughput collapses periodically; partitions bounce between consumers; duplicates rise.',
      detect: 'Group rebalance rate, consumers exceeding `max.poll.interval.ms`, `join-rate` / `sync-rate` metrics.',
      mitigate: 'Cooperative-sticky assignor or the KIP-848 consumer protocol, static membership, smaller `max.poll.records`, move slow work off the poll thread.',
    },
    {
      name: 'Poison record blocks a partition',
      symptom: 'One partition’s lag grows forever while others are fine; same offset in error logs.',
      detect: 'Committed offset not advancing on one partition while log end grows; repeated deserialization or handler errors at the same offset.',
      mitigate: 'Catch, publish to a retry/dead-letter topic, commit and move on (where per-key order allows); schema registry to stop bad producers upstream.',
    },
    {
      name: 'Under-replicated partitions / acked data loss',
      symptom: 'After a broker failure, some acknowledged records are gone or partitions are offline.',
      detect: '`UnderReplicatedPartitions` > 0, `OfflinePartitionsCount` > 0, ISR shrink rate.',
      mitigate: 'RF=3, `acks=all`, `min.insync.replicas=2`, unclean leader election disabled, replicas spread across AZs.',
    },
  ],

  warStories: [
    {
      title: 'Kinesis us-east-1 outage',
      source: 'AWS post-event summary, Nov 25 2020',
      what: 'Adding capacity to the Kinesis front-end fleet pushed every front-end server over the OS thread limit, because each server kept a thread per other server in the fleet to learn the shard map. Front ends could not build shard maps and Kinesis requests failed; recovery took most of a day because servers had to be restarted slowly. Cognito, CloudWatch, EventBridge and other services built on Kinesis were degraded.',
      lesson: 'A stream is often a hidden dependency of many systems; per-server resource usage that grows with fleet size (O(N) threads or connections) is a scaling cliff, and cell-based partitioning limits blast radius.',
    },
    {
      title: 'Escaping partition-bound parallelism',
      source: 'Uber Engineering blog, Consumer Proxy (2021)',
      what: 'Uber’s many Kafka consumer services hit head-of-line blocking from slow or poison messages and could not scale consumers beyond partition counts. They built a consumer proxy that consumes from Kafka and pushes messages to service instances via gRPC, tracking per-message acks with out-of-order commit, retries and a DLQ.',
      lesson: 'If your workload is task processing, you will end up re-implementing queue semantics on top of the log; decide early whether you want a queue, a log, or a proxy layer.',
    },
    {
      title: 'The partition increase that reordered payments',
      source: 'Composite of common incidents',
      what: 'To fix lag, a team raised a keyed topic from 12 to 48 partitions on a live cluster. Keys re-hashed to new partitions while older records for the same keys were still unconsumed in the old ones; a state-machine consumer applied `PaymentCaptured` before `PaymentAuthorized` for thousands of payments and rejected them as invalid transitions.',
      lesson: 'Treat partition count of keyed topics as immutable; size with headroom or migrate via a new topic with a drain-then-switch cutover, and make consumers tolerant of reordering where possible (versions).',
    },
  ],

  numbers: [
    { label: 'Kafka partition (planning)', value: '~5–10 MB/s', note: 'Consumer speed usually binds first' },
    { label: 'Kafka default retention', value: '7 days', note: 'Segments 1 GB' },
    { label: 'End-to-end latency (acks=all)', value: '~5–30 ms', note: 'Batching + replication' },
    { label: 'Kinesis shard write', value: '1 MB/s or 1,000 rec/s' },
    { label: 'Kinesis shard read', value: '2 MB/s shared, 5 GetRecords/s', note: 'Or 2 MB/s per EFO consumer' },
    { label: 'Kinesis retention', value: '24 h default, up to 365 days' },
    { label: 'Compaction tombstone retention', value: '`delete.retention.ms` 24 h default' },
    { label: 'Replication cost', value: 'RF × ingest', note: 'Cross-AZ traffic dominates cloud bills' },
    { label: 'Object-store Kafka latency', value: 'hundreds of ms p99', note: 'WarpStream-style designs' },
    { label: 'Consumer parallelism', value: '≤ partitions per group' },
  ],

  capacity: {
    question: 'Clickstream: 500k events/s at peak, 1 KB each, retained 7 days, RF=3, consumed by 3 groups. Size the Kafka topic and storage.',
    steps: [
      'Ingest: 500k × 1 KB = 500 MB/s ≈ 1.8 TB/hour raw; with zstd at ~4× ≈ 125 MB/s on the wire and disk.',
      'Storage: 125 MB/s × 86,400 × 7 ≈ 75 TB per replica; × RF 3 ≈ 227 TB of broker disk — or ~1 day local + 6 days tiered to S3 (≈ 75 TB in S3, single copy).',
      'Network: in 125 MB/s + replication out 250 MB/s + 3 groups reading 375 MB/s ≈ 750 MB/s cluster-wide; at ~150 MB/s comfortable per broker → ≥ 5 brokers, use 9 across 3 AZs.',
      'Partitions: one instance of the slowest group processes ~8 MB/s (≈ 8k events/s) → 500 MB/s ÷ 8 ≈ 63 consumers; with 2× headroom → 128 partitions.',
      'Check per-broker replicas: 128 × 3 ÷ 9 ≈ 43 — tiny; partitions are not the constraint here, consumer speed is.',
    ],
    answer: '128 partitions, RF=3, ~9 brokers across 3 AZs; ~227 TB disk for full local retention, or ~32 TB local (1 day × RF 3) + ~75 TB in S3 with tiered storage.',
  },

  comparison: {
    caption: 'Streaming platforms',
    columns: ['Product', 'Architecture', 'Ordering / parallelism', 'Retention & replay', 'Ops & latency', 'Pick when'],
    rows: [
      ['Apache Kafka', 'Brokers with local log + KRaft', 'Per partition; ≤ partitions', 'Time/size/compaction; tiered', 'You run it (or MSK/Confluent); ms latency', 'Default event backbone, rich ecosystem'],
      ['Amazon Kinesis', 'Managed shards, KCL leases', 'Per shard; split/merge', '24 h–365 d', 'Zero ops; per-shard hard limits', 'AWS-native, moderate volume, Lambda consumers'],
      ['Apache Pulsar', 'Stateless brokers + BookKeeper', 'Per partition, or shared/key_shared subs', 'Long, tiered; per-message acks', 'More moving parts; fast rebalancing', 'Multi-tenant, geo-replication, queue + stream'],
      ['Redpanda', 'C++ thread-per-core, Raft per partition', 'Kafka semantics', 'Kafka semantics + tiering', 'Single binary; low tail latency', 'Kafka API with simpler ops / lower latency'],
      ['WarpStream-style', 'Stateless agents on S3', 'Kafka semantics', 'S3-priced retention', 'No disks; 100s of ms latency', 'High-volume logs where latency is not critical'],
    ],
  },

  whenNot: [
    'Task distribution with variable job times, per-message retry/delay/priority: use a queue (SQS, RabbitMQ) or share groups.',
    'Low volume, a handful of consumers, no replay needed: SNS→SQS or Google Pub/Sub is far less to operate.',
    'Request/response or anything needing a synchronous answer: use RPC.',
    'Global total ordering across all events at high throughput: a single partition caps you at one consumer; redesign around per-key order.',
    'Long-term system of record for queries: stream to a database/warehouse; a log is not a query engine.',
  ],

  interview: [
    {
      q: 'When would you choose Kafka/Kinesis over SQS for an event-driven design?',
      a: 'When the same events feed multiple independent consumers, when consumers must be able to replay or backfill, when per-key ordering matters, or when volume is high enough that per-message broker bookkeeping is expensive. SQS wins for task distribution: per-message leases, retries, delays and DLQs, and consumers that scale beyond any partition count. I often use both: the log as the source of events and per-service queues for task execution. The decision hinges on whether messages are facts to be shared or tasks to be done once.',
      followUps: ['How do you get a DLQ with Kafka?', 'What does a slow consumer do to each system?', 'How would you replay three days of events into a new service?'],
      seniorSignal: 'Frames it as facts vs tasks and names the concrete failure modes (HOL blocking, no replay) instead of throughput folklore.',
    },
    {
      q: 'How do you choose the partition count and key for a topic?',
      a: 'The key is the entity whose events must stay ordered (order id, account id) and must have enough cardinality to spread load; avoid low-cardinality keys like country or tenant if one value dominates. Partition count comes from peak throughput divided by per-consumer processing rate, with 2–3× headroom, because changing it remaps keys and breaks ordering for in-flight data. I would also check per-broker replica counts and consider the largest consumer group size.',
      followUps: ['One tenant generates 40% of traffic — what now?', 'How would you migrate to more partitions safely?', 'What does too many partitions cost?'],
      seniorSignal: 'Sizes from consumer processing rate and treats keyed partition count as effectively immutable.',
    },
    {
      q: 'A consumer group’s lag keeps growing. Walk me through it.',
      a: 'First check whether lag is uniform or concentrated: one partition means a hot key or a poison record stuck at one offset; all partitions means the consumers are too slow or arrivals rose. Then check rebalance rate — consumers exceeding the poll interval cause storms that look like slowness. Fixes: scale consumers up to partition count, batch writes to the sink, move slow work off the poll loop, skip poison records to a DLQ. Meanwhile I watch time lag against retention, because exceeding retention turns lag into data loss.',
      followUps: ['What if you are already at one consumer per partition?', 'How do you skip a poison record safely?', 'What happens if lag exceeds retention?'],
      seniorSignal: 'Diagnoses by lag distribution and links lag to retention as a data-loss deadline.',
    },
    {
      q: 'Can you get exactly-once processing with a stream?',
      a: 'Within Kafka, yes for read-process-write: idempotent producers and transactions commit output records and consumer offsets atomically, and read_committed consumers only see committed data; Flink does the same with checkpoint-aligned two-phase commit. Once the consumer writes to an external system, it is at-least-once unless the sink is idempotent (upsert by event id) or the offset is stored transactionally with the write. Kinesis and most others are at-least-once only.',
      followUps: ['How would you store offsets in Postgres alongside writes?', 'What does a Flink checkpoint interval do to latency for an EOS sink?', 'Why do zombie producers matter?'],
      seniorSignal: 'Places the exactly-once boundary precisely and defaults to idempotent sinks for external effects.',
    },
    {
      q: 'Kafka vs Kinesis vs Pulsar vs Redpanda — how would you pick?',
      a: 'Kinesis if on AWS with moderate volume and you want zero ops, accepting hard per-shard limits and shorter default retention. Kafka (self-managed, MSK or Confluent) as the default ecosystem choice with the richest connectors and stream processing. Pulsar if you need multi-tenancy, built-in geo-replication, or both queue and stream semantics, at the cost of running BookKeeper. Redpanda when you want the Kafka API with a single binary and lower tail latency. Object-store designs like WarpStream when throughput is huge and latency of hundreds of ms is fine.',
      followUps: ['What does separating storage from brokers buy Pulsar?', 'Where does cross-AZ cost come from in Kafka?', 'What is lost moving from Kafka to Kinesis?'],
      seniorSignal: 'Compares on architecture consequences (rebalancing cost, latency floor, cost structure) rather than benchmarks.',
    },
    {
      q: 'How would you compute "orders per merchant per minute" in real time correctly?',
      a: 'Key the stream by merchant id, use event-time one-minute tumbling windows, and generate watermarks with bounded out-of-orderness (say 10 s) plus idleness handling so quiet partitions do not stall. Late events beyond allowed lateness go to a side output for correction. State lives in RocksDB with checkpoints to S3; the sink upserts by (merchant, window) so replays and restarts are idempotent. Hot merchants may need pre-aggregation with salted keys.',
      followUps: ['Why not processing time?', 'How do you handle an event 2 hours late?', 'What happens to state on rescaling?'],
      seniorSignal: 'Talks about event time, watermarks and idempotent upserting sinks, not just a GROUP BY.',
    },
  ],

  takeaways: [
    'A log keeps history and lets each consumer own its cursor; a queue deletes on ack — facts vs tasks.',
    'Order is per partition; keyed partition count is effectively permanent, so size it for peak consumer parallelism.',
    'Alert on time lag and on lag approaching retention — the latter is a data-loss alarm.',
    '`auto.offset.reset=latest` silently skips data after a retention overrun; choose it deliberately.',
    'Exactly-once stops at the edge of the stream; external sinks must be idempotent.',
    'Pulsar and object-store designs move storage out of brokers, trading complexity or latency for elasticity and cost.',
    'Kafka internals (ISR, rebalancing, transactions) are covered in depth in the Kafka module.',
  ],
};

export default deep;
