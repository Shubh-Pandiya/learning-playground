import type { Internals } from '../types';

export const MESSAGING_INTERNALS: Internals[] = [
  // ───────────────────────────── queue ─────────────────────────────
  {
    kind: 'queue',
    summary:
      'A message queue is a durable buffer with **competing consumers**: each message is delivered to exactly one consumer at a time and deleted only when that consumer acks it. Unacked messages become visible again after a timeout, which gives **at-least-once** delivery — so handlers must be idempotent. Unlike a log, consumed messages are gone; there is no replay.',
    parts: [
      { id: 'producer-api', name: 'Send API', role: 'Accepts and validates enqueued messages', detail: 'SQS `SendMessage` (HTTPS) or AMQP `basic.publish` to an exchange. RabbitMQ routes via exchange bindings (direct/topic/fanout) to queues; SQS writes straight to one queue. Max message ~256 KB on SQS — larger payloads go to S3 with a pointer.' },
      { id: 'durable-store', name: 'Durable storage', role: 'Persists messages before acking the producer', detail: 'SQS replicates each message across multiple AZs before returning 200. RabbitMQ **quorum queues** append to a Raft log replicated to a majority of nodes; with **publisher confirms** the producer learns when it is safe.' },
      { id: 'ready-list', name: 'Ready list', role: 'Holds messages available for delivery', detail: 'Standard queues are distributed and only roughly FIFO (SQS shards a queue across many servers, so order and even exactly-once are not guaranteed). FIFO queues order strictly **per message group id**.' },
      { id: 'delivery', name: 'Delivery / lease', role: 'Hands a message to one consumer', detail: 'SQS: `ReceiveMessage` with long polling (`WaitTimeSeconds=20`) returns up to 10 messages and hides them for the **visibility timeout**. RabbitMQ pushes to subscribed consumers, bounded by **prefetch** (`basic.qos`) unacked messages per consumer.' },
      { id: 'inflight', name: 'In-flight tracker', role: 'Tracks leased, not-yet-acked messages', detail: 'Each delivered message carries a receipt handle / delivery tag and a deadline. If it is not deleted before the deadline (or the AMQP channel dies), it returns to the ready list and its **receive count** increments.' },
      { id: 'ack', name: 'Ack / nack', role: 'Deletes, requeues or dead-letters a message', detail: '`DeleteMessage` / `basic.ack` removes it for good. `basic.nack(requeue=true)` or a zero visibility timeout puts it back. Once receive count exceeds **maxReceiveCount** the redrive policy moves it to the DLQ.' },
    ],
    flow: [
      { part: 'producer-api', title: 'Message sent', text: 'The order service sends `{orderId: 42, action: "charge"}` with a dedup id. The API validates size and attributes.' },
      { part: 'durable-store', title: 'Durably stored', text: 'The broker replicates the message (multi-AZ in SQS, Raft majority in a quorum queue) and only then acks the producer. A crash after this point loses nothing.' },
      { part: 'ready-list', title: 'Waiting in line', text: 'The message sits in the ready list. Queue depth is now 1,204 — the number the autoscaler watches.' },
      { part: 'delivery', title: 'Leased to worker A', text: 'Worker A long-polls and receives a batch of 10. Each message becomes invisible to other consumers for the **30 s visibility timeout**.' },
      { part: 'inflight', title: 'Worker A crashes', text: 'Worker A is OOM-killed mid-charge. No ack arrives, so after 30 s the message reappears with receive count 2 and **worker B** gets it — the duplicate that makes idempotency mandatory.' },
      { part: 'ack', title: 'Acked and deleted', text: 'Worker B finishes, checks its idempotency key, and calls `DeleteMessage`. Had it failed 5 times (`maxReceiveCount=5`), the message would have moved to the DLQ instead.' },
    ],
    knobs: [
      {
        name: 'Ordering',
        options: [
          { label: 'Standard', effect: 'Near-unlimited throughput, best-effort order, occasional duplicates.', when: 'Independent jobs: emails, thumbnails, webhooks.' },
          { label: 'FIFO + message groups', effect: 'Strict order and dedup (5 min window) per group id; lower throughput (SQS ~300 msg/s, ~3k batched, more with high-throughput mode). A stuck message blocks its group.', when: 'Per-entity ordering: all events of one account/order in sequence.' },
        ],
      },
      {
        name: 'Visibility timeout',
        options: [
          { label: 'Too short', effect: 'Message reappears while still being processed → concurrent duplicates.', when: 'Never shorter than p99 processing time.' },
          { label: '~6× p99 + heartbeat', effect: 'Safe; long jobs extend with `ChangeMessageVisibility` while working.', when: 'Default choice for variable-length jobs.' },
          { label: 'Very long', effect: 'A crashed worker’s messages stay hidden for ages → high latency on failure.', when: 'Only with heartbeat extension instead.' },
        ],
      },
      {
        name: 'Prefetch / batch size',
        options: [
          { label: '1', effect: 'Fair dispatch, slow consumers do not hoard; more round trips.', when: 'Long, uneven jobs.' },
          { label: '10–100', effect: 'High throughput, but a slow consumer sits on many leased messages.', when: 'Short, uniform jobs.' },
        ],
      },
    ],
    implementations: [
      { name: 'Amazon SQS', how: 'Fully managed, sharded across many hosts; pull-only with long polling; visibility timeout leases; redrive policy to a DLQ; FIFO queues with `MessageGroupId` and `MessageDeduplicationId`.' },
      { name: 'RabbitMQ', how: 'Erlang broker speaking AMQP 0-9-1: exchanges route to queues by bindings, push delivery bounded by prefetch, acks per delivery tag. **Quorum queues** (Raft) replaced mirrored queues for HA; dead-letter exchanges handle rejects/TTL.' },
      { name: 'Kafka-as-queue', how: 'A consumer group gives competing consumers per partition, but parallelism is capped by partition count and one slow message blocks its partition. Kafka 4.0 **share groups** (KIP-932) add true per-message acks.' },
    ],
    ha: 'The broker replicates every message before acking the producer: SQS across 3 AZs transparently; RabbitMQ quorum queues across 3 or 5 nodes with Raft (tolerates ⌊(n−1)/2⌋ failures). Consumers are stateless and scale horizontally; the queue absorbs bursts so downstream can run at its own pace.',
    failureModes: [
      { name: 'Duplicate processing', symptom: 'Customer charged twice after a worker timed out mid-job.', fix: 'Idempotent handlers: idempotency key + unique constraint, or a processed-ids table checked in the same transaction.' },
      { name: 'Unbounded backlog', symptom: 'Queue depth and age of oldest message climb for hours; users wait.', fix: 'Alert on `ApproximateAgeOfOldestMessage`, autoscale workers on backlog per worker, shed or TTL non-critical work.' },
      { name: 'Poison message loop', symptom: 'One malformed message is received, crashes a worker, reappears, forever.', fix: 'maxReceiveCount + DLQ; catch parse errors and dead-letter immediately.' },
      { name: 'Head-of-line blocking (FIFO)', symptom: 'One failing message stalls its whole message group.', fix: 'Fine-grained group ids (per entity, not global); DLQ failing messages fast.' },
    ],
    numbers: ['SQS standard: practically unlimited msg/s; FIFO ~300 msg/s per API action (3k with batching)', 'SQS max message 256 KB, retention 4 days default (max 14)', 'RabbitMQ: ~20–50k msg/s per queue (one queue = one Erlang process)', 'Long poll up to 20 s ⇒ near-zero empty receives'],
    interview: [
      { q: 'How do you get exactly-once processing with SQS or RabbitMQ?', a: 'You do not get exactly-once delivery; you get at-least-once and make the effect idempotent. Store a message/idempotency id with a unique constraint in the same DB transaction as the side effect, so a redelivery becomes a no-op. FIFO dedup only covers a 5-minute producer-side window.' },
      { q: 'Queue vs log (SQS vs Kafka) — how do you choose?', a: 'Queue: per-message acks, work distribution, no replay, scales consumers freely — great for jobs. Log: retained, ordered per partition, many independent consumer groups can replay — great for event streams and fan-out to multiple systems. Ordering per key + replay ⇒ log; independent tasks with retries ⇒ queue.' },
      { q: 'How do you size the visibility timeout?', a: 'Longer than the worst realistic processing time (AWS suggests ~6× p99), otherwise a second worker gets the same message while the first is still working. For variable jobs, keep it moderate and have the worker heartbeat with `ChangeMessageVisibility`.' },
    ],
    lab: 'queue',
    kafka: true,
  },

  // ───────────────────────────── stream ─────────────────────────────
  {
    kind: 'stream',
    summary:
      'An event stream is a **partitioned, replicated, append-only log**. Producers append records to the end of a partition; consumers read sequentially and track their own **offset**, so many independent consumer groups can read (and replay) the same data. Order is guaranteed only within a partition, and data is kept by time/size retention, not deleted on consume.',
    parts: [
      { id: 'producer', name: 'Producer client', role: 'Partitions, batches and compresses records', detail: 'Hashes the key (`murmur2(key) % partitions`) to pick a partition, accumulates records per partition for `linger.ms` up to `batch.size`, compresses the batch (lz4/zstd) and sends it to the partition leader.' },
      { id: 'leader', name: 'Partition leader', role: 'Appends batches to the partition log', detail: 'Each partition has one leader broker. It assigns monotonically increasing **offsets** and appends the batch to the active segment — sequential disk I/O only. Idempotent producers carry (producerId, sequence) so retries do not duplicate.' },
      { id: 'segments', name: 'Log segments', role: 'Files on disk with offset index', detail: 'A partition is a directory of ~1 GB `.log` segment files plus sparse `.index` (offset→byte position) and `.timeindex` files. Writes go to the OS **page cache**; Kafka relies on replication, not `fsync`, for durability.' },
      { id: 'isr', name: 'ISR followers', role: 'Replicate the log for durability', detail: 'Followers fetch from the leader like consumers. Those caught up within `replica.lag.time.max.ms` form the **in-sync replica set**. The **high watermark** is the highest offset replicated to all ISR; only data below it is visible to consumers.' },
      { id: 'group', name: 'Consumer group', role: 'Splits partitions among consumers', detail: 'A group coordinator assigns each partition to exactly one consumer in the group (range/sticky/cooperative assignors). Parallelism is capped at the partition count; extra consumers sit idle.' },
      { id: 'offsets', name: 'Offset store', role: 'Remembers each group’s read position', detail: 'Consumers commit offsets to the internal compacted topic `__consumer_offsets`. Commit after processing ⇒ at-least-once; commit before ⇒ at-most-once; transactions tie output writes and offset commits together for exactly-once within Kafka.' },
      { id: 'retention', name: 'Retention / compaction', role: 'Deletes old segments or old key versions', detail: 'Delete policy drops whole closed segments past `retention.ms`/`retention.bytes`. **Compaction** keeps only the latest value per key (tombstone = null deletes), turning the topic into a changelog/table.' },
    ],
    flow: [
      { part: 'producer', title: 'Batch built', text: 'The checkout service emits `OrderPlaced` keyed by `orderId=42`. The hash picks partition 7; the record waits ~5 ms in the batch with 300 others, then the lz4-compressed batch goes to partition 7’s leader.' },
      { part: 'leader', title: 'Appended at offset 9,812,004', text: 'Broker 2 (leader of p7) validates the producer sequence number, assigns offsets and appends to the active segment in the page cache.' },
      { part: 'segments', title: 'Sequential write', text: 'The write is a pure append to the tail of `00000000000009500000.log`; the sparse index gets an entry every ~4 KB. No random I/O, no B-tree.' },
      { part: 'isr', title: 'Replicated, then acked', text: 'With `acks=all`, broker 2 waits until both followers in the ISR have fetched the batch, advances the high watermark, then acks. With `min.insync.replicas=2`, losing one broker loses no acked data.' },
      { part: 'group', title: 'Consumer reads p7', text: 'In group `billing`, consumer C3 owns p7. It fetches from its offset; the broker uses **zero-copy `sendfile`** from page cache to socket, so hot reads never touch the JVM heap.' },
      { part: 'offsets', title: 'Offset committed', text: 'After billing the order, C3 commits offset 9,812,005 for p7. If C3 dies, the rebalance gives p7 to C1, which resumes from the last committed offset — possibly reprocessing a few records.' },
      { part: 'retention', title: 'Aged out later', text: 'Seven days later the whole segment is past `retention.ms` and is deleted as one file. Meanwhile the `analytics` group could replay p7 from any retained offset.' },
    ],
    knobs: [
      {
        name: 'Producer acks',
        options: [
          { label: 'acks=0 / 1', effect: 'Lowest latency; leader crash before replication loses acked data.', when: 'Metrics, logs, lossy telemetry.' },
          { label: 'acks=all + min.insync.replicas=2 (RF=3)', effect: 'Acked writes survive any single broker loss; a few ms more latency; writes rejected if ISR shrinks below 2.', when: 'Business events, payments, CDC.' },
        ],
      },
      {
        name: 'Partition count',
        options: [
          { label: 'Few (≤ 12)', effect: 'Cheap metadata, fast rebalances; caps consumer parallelism.', when: 'Low-throughput topics.' },
          { label: 'Many (100s)', effect: 'High parallelism; more open files, longer leader elections, and changing the count reshuffles key→partition mapping.', when: 'High-throughput topics; size for peak consumer parallelism up front.' },
        ],
      },
      {
        name: 'Cleanup policy',
        options: [
          { label: 'delete (time/size)', effect: 'Keeps a sliding window of history for replay.', when: 'Event streams, logs.' },
          { label: 'compact', effect: 'Keeps latest value per key forever; consumers can rebuild state.', when: 'Changelogs, CDC tables, config, Kafka Streams state.' },
        ],
      },
    ],
    implementations: [
      { name: 'Apache Kafka', how: 'Brokers own partition replicas on local disk; metadata and controller election via **KRaft** (Raft quorum of controllers, ZooKeeper removed in 4.0). Tiered storage can offload old segments to S3.' },
      { name: 'Amazon Kinesis Data Streams', how: 'Managed shards (≈partitions) with fixed per-shard limits (1 MB/s or 1k records/s in, 2 MB/s out), 24 h–365 d retention, consumers track sequence numbers (KCL stores leases in DynamoDB).' },
      { name: 'Apache Pulsar / Redpanda', how: 'Pulsar separates stateless brokers from storage in BookKeeper ledgers, making rebalancing cheap. Redpanda is a Kafka-API-compatible C++ thread-per-core implementation with Raft per partition and no page-cache reliance.' },
    ],
    ha: 'Every partition has a replication factor (typically 3) spread across racks/AZs. If the leader dies, the controller elects a new leader from the ISR in seconds; producers and consumers refresh metadata and continue. `unclean.leader.election.enable=false` prevents an out-of-sync replica from becoming leader and silently dropping data. Scale out by adding partitions and brokers and reassigning replicas.',
    failureModes: [
      { name: 'Consumer lag', symptom: 'Lag on a group grows steadily; downstream data is minutes or hours stale.', fix: 'Monitor lag per partition; add consumers up to partition count; speed up handlers; increase partitions for future headroom.' },
      { name: 'Hot partition', symptom: 'One partition (a celebrity key) gets 50% of traffic; its consumer is pegged while others idle.', fix: 'Better key choice, key salting with downstream re-aggregation, or split the hot entity.' },
      { name: 'Rebalance storms', symptom: 'Consumers repeatedly drop out (long processing > `max.poll.interval.ms`), the group stops-the-world rebalances, lag spikes.', fix: 'Cooperative-sticky assignor, static membership, smaller poll batches, tune `max.poll.interval.ms`.' },
      { name: 'Data loss on leader failover', symptom: 'Records acked with `acks=1` disappear after a broker crash.', fix: '`acks=all`, `min.insync.replicas=2`, RF=3, unclean leader election off.' },
    ],
    numbers: ['A single broker: ~100s MB/s writes; a partition: ~10 MB/s is a comfortable planning number', 'End-to-end latency: ~5–20 ms with linger + acks=all', 'Segment default 1 GB; retention default 7 days', 'Consumer parallelism ≤ partitions per group'],
    interview: [
      { q: 'How does Kafka guarantee ordering, and what breaks it?', a: 'Only within a partition: same key ⇒ same partition ⇒ appended in order. It breaks if you change the partition count (keys remap), use keyless round-robin, or allow producer retries to reorder — fixed by the idempotent producer (`enable.idempotence=true`, ≤5 in-flight). Consumers must also process a partition sequentially.' },
      { q: 'Why is Kafka so fast on spinning disks?', a: 'Pure sequential appends, batching and compression on the producer, reliance on the OS page cache instead of a heap cache, and zero-copy `sendfile` from page cache to the network socket for consumers. Reads of recent data are served from memory.' },
      { q: 'How does Kafka achieve exactly-once?', a: 'Idempotent producers dedupe retries per partition via sequence numbers; transactions atomically write output records and consumer offsets across partitions, and consumers use `isolation.level=read_committed`. This is exactly-once within Kafka; external side effects still need idempotency.' },
    ],
    kafka: true,
  },

  // ───────────────────────────── pubsub ─────────────────────────────
  {
    kind: 'pubsub',
    summary:
      'Pub/sub decouples one publisher from many subscribers: a message published to a **topic** is copied into **every subscription**, and each subscription is effectively its own queue with its own acks and backlog. Subscribers do not know about each other, so adding a new consumer never touches the publisher.',
    parts: [
      { id: 'publish', name: 'Publish API', role: 'Accepts a message for a topic', detail: 'SNS `Publish`, Google `topics.publish`, Redis `PUBLISH`. Message gets an id and attributes (used later for filtering). Google batches and persists before returning the id.' },
      { id: 'topic-store', name: 'Topic storage', role: 'Persists message before fan-out', detail: 'Google Pub/Sub synchronously writes to multiple zones before acking. SNS stores across AZs. **Redis pub/sub stores nothing**: it pushes to currently connected sockets and forgets (Redis Streams is the durable option).' },
      { id: 'filter', name: 'Subscription filter', role: 'Drops messages a subscriber does not want', detail: 'SNS filter policies / Pub/Sub filters on message attributes (e.g. `eventType = "refund"`) run broker-side, so uninterested subscribers never pay for delivery.' },
      { id: 'sub-queue', name: 'Per-sub backlog', role: 'Independent queue per subscription', detail: 'Each subscription tracks its own unacked set and ack deadline, so a slow email service does not slow down search indexing. SNS commonly fans out into one **SQS queue per subscriber** for exactly this buffering.' },
      { id: 'dispatch', name: 'Push/pull dispatch', role: 'Delivers to subscriber endpoints', detail: 'Push: broker POSTs to an HTTPS endpoint/Lambda and retries with backoff on non-2xx. Pull: subscriber calls `pull` / streaming pull and controls its own flow. Delivery is at-least-once.' },
      { id: 'sub-ack', name: 'Subscriber ack', role: 'Confirms delivery per subscription', detail: 'Ack removes the message from that subscription only. Missed ack deadline ⇒ redelivery; after max attempts ⇒ that subscription’s dead-letter topic.' },
    ],
    flow: [
      { part: 'publish', title: 'Event published once', text: 'The user service publishes `UserSignedUp {id: 7, plan: "pro"}` to the `user-events` topic with attribute `type=signup`.' },
      { part: 'topic-store', title: 'Persisted', text: 'The message is stored durably across zones and the publisher gets a message id. The publisher is done — it never learns who consumes it.' },
      { part: 'filter', title: 'Filtered per subscription', text: 'Four subscriptions exist. The `refunds` subscription filters on `type=refund`, so it is skipped. Three subscriptions match.' },
      { part: 'sub-queue', title: 'Copied into 3 backlogs', text: 'Email, analytics and CRM subscriptions each get their own copy. Analytics is behind by 2M messages; that affects nobody else.' },
      { part: 'dispatch', title: 'Delivered push and pull', text: 'Email is a push subscription: the broker POSTs to its webhook. Analytics pulls in batches of 1,000 at its own pace.' },
      { part: 'sub-ack', title: 'Acked independently', text: 'Email returns 200 → acked. CRM’s endpoint returned 503 → retried with exponential backoff; after 5 attempts its copy goes to CRM’s dead-letter topic.' },
    ],
    knobs: [
      {
        name: 'Delivery mode',
        options: [
          { label: 'Push', effect: 'Lowest latency, no polling; broker controls rate, subscriber must be publicly reachable and handle bursts.', when: 'Webhooks, serverless (Lambda, Cloud Run).' },
          { label: 'Pull', effect: 'Subscriber controls flow and batching; better throughput and backpressure.', when: 'High-volume workers, batch consumers.' },
        ],
      },
      {
        name: 'Durability',
        options: [
          { label: 'Fire-and-forget (Redis pub/sub)', effect: 'Microsecond fan-out, but offline subscribers miss messages forever.', when: 'Ephemeral signals: cache invalidation hints, live presence, chat typing indicators.' },
          { label: 'Durable (SNS+SQS, Google Pub/Sub, Kafka)', effect: 'Every subscription gets every message even if offline; costs storage and latency.', when: 'Business events that must not be lost.' },
        ],
      },
      {
        name: 'Broker: pub/sub service vs Kafka',
        options: [
          { label: 'Managed pub/sub', effect: 'Per-message acks, push, filtering, no partitions to plan; no long replay or strict ordering by default.', when: 'Notification-style fan-out to a handful of services.' },
          { label: 'Kafka topic + consumer groups', effect: 'Each consumer group is a subscription; ordering per key and days of replay; partition planning required.', when: 'High volume, ordered event streams, new consumers backfilling history.' },
        ],
      },
    ],
    implementations: [
      { name: 'Amazon SNS (+ SQS)', how: 'Topic fan-out to SQS, Lambda, HTTP, email, SMS with attribute filter policies. The canonical pattern is SNS → one SQS queue per consumer for buffering, retries and DLQs. SNS FIFO topics preserve order into SQS FIFO queues.' },
      { name: 'Google Cloud Pub/Sub', how: 'Global service; publishers hit forwarders that persist to multiple zones; subscribers use streaming pull or push, with ack deadlines, ordering keys, filters, seek-to-timestamp replay and dead-letter topics.' },
      { name: 'Redis pub/sub', how: 'In-memory channel → set of subscribed client sockets; `PUBLISH` loops over subscribers and writes to their output buffers. No persistence or acks; a slow subscriber’s buffer overflow gets it disconnected.' },
    ],
    ha: 'Managed services replicate messages across zones before acking and scale fan-out horizontally behind the API. Per-subscription backlogs isolate failures: one broken subscriber accumulates its own backlog (bounded by retention, e.g. 7 days) without blocking others. Redis pub/sub has no durability, so a failover simply drops in-flight messages.',
    failureModes: [
      { name: 'Silent loss with ephemeral pub/sub', symptom: 'A subscriber reconnects after a deploy and never sees the events published during the gap.', fix: 'Use a durable broker or Redis Streams with consumer groups for anything that must arrive.' },
      { name: 'Push endpoint overload', symptom: 'A spike of publishes hammers a subscriber webhook, which 5xxs, triggering retries and more load.', fix: 'Fan out into a queue per subscriber (SNS→SQS) or use pull with flow control.' },
      { name: 'Fan-out amplification', symptom: 'Cost and broker load explode: 10k msg/s × 50 subscriptions = 500k deliveries/s.', fix: 'Filter broker-side, consolidate subscribers, batch, or move to a shared log consumers read independently.' },
    ],
    numbers: ['Deliveries = publish rate × matching subscriptions', 'SNS: up to 12.5M subscriptions per topic; message ≤ 256 KB', 'Google Pub/Sub: retention up to 31 days; ack deadline 10–600 s', 'Redis pub/sub: ~sub-ms fan-out, zero durability'],
    interview: [
      { q: 'Pub/sub vs queue — what is the actual difference?', a: 'A queue delivers each message to one of N competing consumers (work distribution). Pub/sub delivers each message to every subscription (fan-out), and within one subscription you can again have competing consumers. That is why SNS→SQS-per-service is so common: fan-out first, then a queue per service.' },
      { q: 'How would you fan out a "post created" event to 5 downstream services reliably?', a: 'Publish once to a durable topic (SNS or Kafka) — ideally via the transactional outbox so the DB write and the event cannot diverge. Give each service its own subscription/queue with retries and a DLQ, and make each handler idempotent since delivery is at-least-once.' },
      { q: 'When is Redis pub/sub acceptable?', a: 'When losing messages is harmless and latency matters: live UI updates, cache-invalidation hints backed by TTLs, typing indicators across WebSocket servers. Never for orders, payments or anything that needs replay.' },
    ],
    kafka: true,
  },

  // ───────────────────────────── cdc ─────────────────────────────
  {
    kind: 'cdc',
    summary:
      'Change data capture turns a database’s own replication log (Postgres WAL, MySQL binlog) into a stream of row-level change events. The connector behaves like a replica: it takes an initial **snapshot**, then tails the log from a recorded position and publishes inserts/updates/deletes, in commit order per key, to Kafka. No polling, no dual writes, and deletes are captured.',
    parts: [
      { id: 'db-txn', name: 'Source DB commit', role: 'Writes the change to its log', detail: 'Every committed transaction is already written to the WAL/binlog for crash recovery and replication. Postgres needs `wal_level=logical`; MySQL needs `binlog_format=ROW` with full row images.' },
      { id: 'slot', name: 'Replication slot', role: 'Pins the log position for the reader', detail: 'Postgres **logical replication slot** with the `pgoutput` plugin decodes WAL into row changes and retains WAL until the consumer confirms its LSN. MySQL: the connector registers as a replica and reads binlog by GTID/file+position.' },
      { id: 'connector', name: 'CDC connector', role: 'Snapshots, then streams decoded changes', detail: 'Debezium (a Kafka Connect source) first does a consistent snapshot (or incremental chunked snapshot), then streams. Each event has `before`, `after`, `op` (c/u/d/r) and source metadata (LSN, txId, ts).' },
      { id: 'schema', name: 'Schema registry', role: 'Versions the event schema', detail: 'Events are serialized as Avro/Protobuf/JSON Schema with the schema id in each message. Compatibility rules (BACKWARD, etc.) stop a column drop from breaking consumers.' },
      { id: 'topic', name: 'Change topic', role: 'Per-table, key-partitioned Kafka topic', detail: 'One topic per table (e.g. `pg.public.orders`), keyed by primary key so all changes to a row land in one partition in order. Often compacted so it doubles as the current table state.' },
      { id: 'offset', name: 'Offset commit', role: 'Records progress, advances the slot', detail: 'Kafka Connect stores the last processed LSN/GTID in its offsets topic and periodically flushes it back to Postgres, which then lets the server recycle WAL older than that LSN.' },
    ],
    flow: [
      { part: 'db-txn', title: 'Row updated', text: '`UPDATE orders SET status = \'paid\' WHERE id = 42` commits. Postgres writes it to the WAL as it would anyway.' },
      { part: 'slot', title: 'Decoded from WAL', text: 'The `debezium` slot’s logical decoding plugin turns the WAL record into a row change with old and new tuples, in commit order.' },
      { part: 'connector', title: 'Change event built', text: 'Debezium emits `{op: "u", before: {status: "pending"}, after: {status: "paid"}, source: {lsn: 0/1A2B3C}}`.' },
      { part: 'schema', title: 'Serialized with schema id', text: 'The Avro converter looks up (or registers) schema v7 for `orders` and prefixes the bytes with its id.' },
      { part: 'topic', title: 'Published keyed by id', text: 'The event goes to `pg.public.orders` keyed by `id=42`, so search, cache invalidation and analytics consumers see this row’s changes in order.' },
      { part: 'offset', title: 'Progress confirmed', text: 'The connector commits LSN 0/1A2B3C; Postgres can now discard older WAL. If the connector restarts, it resumes from here — at-least-once, so consumers dedupe by LSN or key+version.' },
    ],
    knobs: [
      {
        name: 'What to capture',
        options: [
          { label: 'Raw table CDC', effect: 'Zero app changes; but consumers couple to your internal schema and see every intermediate row state.', when: 'Replication to search/warehouse/cache, migrations.' },
          { label: 'Outbox table + CDC', effect: 'App writes a domain event row to `outbox` in the same transaction as the business change; CDC publishes only that. Clean, versioned public contract with atomicity.', when: 'Publishing domain events to other services (Debezium outbox event router).' },
        ],
      },
      {
        name: 'Initial load',
        options: [
          { label: 'Blocking snapshot', effect: 'Consistent full read before streaming; long on big tables and holds the slot/WAL meanwhile.', when: 'Small tables, new pipelines.' },
          { label: 'Incremental snapshot (watermarks)', effect: 'Chunks the table by PK interleaved with streaming; resumable, can be re-triggered per table.', when: 'Large tables, adding a table to a running pipeline.' },
        ],
      },
    ],
    implementations: [
      { name: 'Debezium', how: 'Kafka Connect source connectors for Postgres (logical slot + `pgoutput`), MySQL (binlog client acting as replica), MongoDB (change streams), SQL Server/Oracle. Also runs embedded or as Debezium Server to Kinesis/Pub/Sub.' },
      { name: 'AWS DMS / Datastream / Fivetran', how: 'Managed CDC services reading the same logs, typically landing in warehouses (Redshift, BigQuery, Snowflake) rather than Kafka.' },
      { name: 'DynamoDB Streams / Mongo change streams', how: 'Built-in CDC: the database itself exposes an ordered per-key change feed (24 h retention in DynamoDB) consumable by Lambda/KCL.' },
    ],
    ha: 'Run the connector in a Kafka Connect cluster: tasks rebalance to surviving workers and resume from stored offsets. The fragile part is the source: a Postgres slot is tied to the primary (until PG17 failover slots / `pg_failover_slots`), so a DB failover can lose the slot and force a re-snapshot. Kafka provides durability downstream.',
    failureModes: [
      { name: 'Replication slot bloat', symptom: 'Connector down for a weekend; Postgres keeps all WAL for the slot, disk fills, primary goes read-only.', fix: 'Alert on slot lag (`pg_replication_slots` confirmed_flush_lsn), set `max_slot_wal_keep_size`, heartbeat events for idle tables.' },
      { name: 'Schema change breaks consumers', symptom: 'A column rename ships; downstream deserialization fails.', fix: 'Schema registry with compatibility checks; publish via outbox with a stable contract; expand-contract migrations.' },
      { name: 'Duplicates after restart', symptom: 'Consumers see the same change twice after a connector crash.', fix: 'Idempotent consumers keyed by PK + LSN/version; upserts instead of inserts.' },
    ],
    numbers: ['End-to-end lag: typically 100 ms–1 s', 'An idle slot on a 10k writes/s DB can retain tens of GB of WAL per hour', 'Debezium single task: ~10k–50k events/s'],
    interview: [
      { q: 'How do you update a DB and publish an event atomically?', a: 'Transactional outbox: in the same local transaction, write the business row and an `outbox` event row. CDC (Debezium) tails the WAL and publishes outbox rows to Kafka. Either both commit or neither; no dual write, no 2PC. Consumers dedupe since delivery is at-least-once.' },
      { q: 'Why is CDC better than polling `updated_at`?', a: 'Polling misses deletes, misses intermediate updates between polls, has clock/transaction-visibility edge cases (a long transaction commits with an older timestamp), and loads the DB with scans. CDC reads the commit log: every change, in commit order, with sub-second lag and near-zero query load.' },
      { q: 'What operational risk does a Postgres CDC pipeline add?', a: 'The replication slot. If the consumer stops, the primary retains WAL indefinitely and can run out of disk. You must monitor slot lag, cap retained WAL, and plan slot recreation across failovers.' },
    ],
    kafka: true,
  },

  // ───────────────────────────── dlq ─────────────────────────────
  {
    kind: 'dlq',
    summary:
      'A dead-letter queue is a side queue where messages go after they fail too many times, so one **poison message** cannot block or burn a consumer forever. It is not a fix — it is a parking lot that must be alerted on, inspected, and either redriven after a fix or discarded.',
    parts: [
      { id: 'source-queue', name: 'Source queue', role: 'Normal queue with a redrive policy', detail: 'SQS: `RedrivePolicy {deadLetterTargetArn, maxReceiveCount: 5}`. RabbitMQ: `x-dead-letter-exchange` argument. Kafka has no built-in DLQ; consumers or Kafka Connect (`errors.deadletterqueue.topic.name`) publish to one.' },
      { id: 'consumer-fail', name: 'Failing consumer', role: 'Rejects or times out on message', detail: 'Failure = exception → nack, or no ack before visibility timeout. Permanent errors (bad JSON, unknown schema) should be dead-lettered immediately; transient ones (timeouts) retried with backoff.' },
      { id: 'counter', name: 'Receive counter', role: 'Counts delivery attempts per message', detail: 'SQS increments `ApproximateReceiveCount` per receive; RabbitMQ quorum queues track `x-delivery-count`. Exceeding the threshold triggers the move.' },
      { id: 'dlq-store', name: 'DLQ', role: 'Parks the message with failure metadata', detail: 'Same message body plus attributes: original queue, error/stack trace, attempt count, first-failure time. Use longer retention (14 days) than the source so nothing expires before triage.' },
      { id: 'alert', name: 'Alert & inspect', role: 'Pages someone when DLQ is non-empty', detail: 'Alarm on DLQ depth > 0 (or a rate), with a dashboard/tool to peek messages and group by error type to find the bug.' },
      { id: 'redrive', name: 'Redrive', role: 'Replays fixed messages to the source', detail: 'After deploying a fix, move messages back (SQS `StartMessageMoveTask`, a shovel in RabbitMQ, or a replay job for Kafka DLQ topics), rate-limited so the backlog does not flood consumers.' },
    ],
    flow: [
      { part: 'source-queue', title: 'Message arrives', text: 'An `InvoiceCreated` event with `currency: "XBT"` lands in `invoices`, which has `maxReceiveCount=5`.' },
      { part: 'consumer-fail', title: 'Handler throws', text: 'The worker’s currency lookup throws `UnknownCurrency`. It does not ack; the visibility timeout expires.' },
      { part: 'counter', title: 'Attempts pile up', text: 'Receive count goes 1, 2, … 5. Each attempt wastes a worker slot — without a DLQ it would loop forever and, in FIFO, block its group.' },
      { part: 'dlq-store', title: 'Moved to DLQ', text: 'On the 6th receive the broker moves it to `invoices-dlq` with the error recorded. The main queue keeps flowing.' },
      { part: 'alert', title: 'On-call paged', text: 'DLQ depth > 0 fires an alert. The engineer groups the 312 DLQ messages by error: all `UnknownCurrency: XBT` — a missing config entry.' },
      { part: 'redrive', title: 'Redriven after fix', text: 'Config is fixed and deployed; the 312 messages are redriven at 50 msg/s and processed successfully. Idempotent handlers make the replay safe.' },
    ],
    knobs: [
      {
        name: 'maxReceiveCount',
        options: [
          { label: 'Low (1–3)', effect: 'Poison messages leave fast; transient blips also dead-letter good messages.', when: 'Errors are mostly deterministic; cheap redrive.' },
          { label: 'Higher (5–10) + backoff', effect: 'Survives transient outages; poison messages consume more retries first.', when: 'Flaky downstreams; combine with exponential backoff / delay queues.' },
        ],
      },
      {
        name: 'Retry topology',
        options: [
          { label: 'Single DLQ', effect: 'Simple; all retries happen inline on the main queue.', when: 'Most SQS/RabbitMQ setups.' },
          { label: 'Retry tiers (retry-1m, retry-10m, DLQ)', effect: 'Delayed retries without blocking the main topic; more topics to operate.', when: 'Kafka consumers, where a failing record would otherwise block its partition.' },
        ],
      },
    ],
    implementations: [
      { name: 'Amazon SQS', how: 'Redrive policy on the source queue; DLQ is just another queue (FIFO DLQ for FIFO source). Console/API redrive moves messages back to the source.' },
      { name: 'RabbitMQ', how: 'Messages rejected with `requeue=false`, expired by TTL, or over the quorum-queue `delivery-limit` are republished to the dead-letter exchange with `x-death` headers.' },
      { name: 'Kafka', how: 'No broker DLQ: the consumer catches the error, produces the record plus error headers to `<topic>.DLT` (Spring Kafka `DeadLetterPublishingRecoverer`), then commits the offset so the partition keeps moving.' },
    ],
    ha: 'A DLQ inherits the broker’s replication and durability. The real availability concern is the main pipeline: the DLQ keeps poison messages from stalling consumers or FIFO groups, so the rest of the traffic stays healthy while bad messages wait for humans.',
    failureModes: [
      { name: 'DLQ black hole', symptom: 'Nobody watches it; messages expire after 4 days and orders silently vanish.', fix: 'Alarm on depth > 0, retention ≥ source retention, an owner per DLQ.' },
      { name: 'Good messages dead-lettered', symptom: 'A 10-minute downstream outage pushes thousands of valid messages to the DLQ.', fix: 'Backoff + higher maxReceiveCount for transient errors; circuit breaker that pauses consumption instead of burning attempts.' },
      { name: 'Redrive stampede', symptom: 'Redriving 1M messages at once overloads consumers and the DB.', fix: 'Rate-limited redrive; idempotent handlers so partial replays are safe.' },
    ],
    numbers: ['Typical maxReceiveCount: 3–5', 'SQS DLQ retention up to 14 days — set it longer than the source queue', 'Alert threshold: depth > 0 for critical flows'],
    interview: [
      { q: 'What is a poison message and how do you handle it?', a: 'A message that fails deterministically every time (bad data, schema mismatch, a bug). Without a limit it is redelivered forever, wasting capacity and blocking FIFO groups or Kafka partitions. Cap attempts, move it to a DLQ with error metadata, alert, fix, then redrive.' },
      { q: 'How do you do retries with backoff in Kafka without blocking a partition?', a: 'On failure, publish the record to a retry topic with a delay (retry-1m, retry-10m) and commit the original offset. A consumer on the retry topic waits until the due time before processing; after the last tier it goes to the DLT. Ordering for that key is sacrificed, so only do this where order does not matter.' },
    ],
    lab: 'queue',
    kafka: true,
  },

  // ───────────────────────────── worker ─────────────────────────────
  {
    kind: 'worker',
    summary:
      'A worker pool is a fleet of stateless processes running a **consumer loop**: fetch a batch, process each message (with bounded concurrency), ack on success. Because delivery is at-least-once, handlers must be **idempotent**; because work arrives in bursts, the pool scales on backlog and must shut down gracefully without dropping in-flight jobs.',
    parts: [
      { id: 'poller', name: 'Poll loop', role: 'Fetches batches of messages', detail: 'Long-polls SQS (`WaitTimeSeconds=20`, 10 msgs) or calls `consumer.poll()` on Kafka; only fetches when the local buffer has room, which is the backpressure mechanism.' },
      { id: 'buffer', name: 'Local buffer', role: 'Bounded in-memory queue of jobs', detail: 'A bounded channel/queue between the poller and executors. When full, polling pauses rather than over-leasing messages that would time out.' },
      { id: 'executor', name: 'Executor pool', role: 'Runs N handlers concurrently', detail: 'Thread pool, goroutines with a semaphore, or async tasks — sized for the bottleneck: ~cores for CPU-bound work, much higher for I/O-bound work but capped by downstream limits (DB connection pool).' },
      { id: 'handler', name: 'Idempotent handler', role: 'Does the side effect exactly once', detail: 'Checks/records an idempotency key (unique constraint, `INSERT … ON CONFLICT DO NOTHING`) in the same transaction as the effect; calls external APIs with idempotency keys; applies timeouts.' },
      { id: 'acker', name: 'Acker', role: 'Acks success, nacks or retries failures', detail: 'Deletes/acks only after the effect is committed. Transient errors: nack with backoff (or let visibility expire). Permanent errors: send to DLQ. Long jobs heartbeat to extend their lease.' },
      { id: 'lifecycle', name: 'Lifecycle manager', role: 'Graceful shutdown and health', detail: 'On `SIGTERM`: stop polling, finish in-flight jobs within the grace period (k8s `terminationGracePeriodSeconds`), ack, exit. Unfinished jobs simply reappear after their visibility timeout.' },
    ],
    flow: [
      { part: 'poller', title: 'Batch fetched', text: 'The poller sees 7 free slots in the buffer and long-polls for up to 10 messages; it receives 7 `ResizeImage` jobs.' },
      { part: 'buffer', title: 'Buffered', text: 'Jobs enter the bounded buffer (capacity 20). If executors fall behind, the buffer fills and polling stops — backpressure instead of leasing jobs it cannot finish.' },
      { part: 'executor', title: 'Run concurrently', text: '16 executor slots (I/O-heavy S3 downloads) pick up jobs. One job per slot; slots are the unit autoscaling reasons about.' },
      { part: 'handler', title: 'Side effect once', text: 'The handler checks `processed(job_id)`; not present → resizes, uploads, and inserts `job_id` in the same transaction that marks the image ready.' },
      { part: 'acker', title: 'Acked', text: 'Only after commit does it `DeleteMessage`. A crash between commit and ack causes a redelivery, which the idempotency check turns into a no-op.' },
      { part: 'lifecycle', title: 'Deploy: drain then exit', text: 'A rollout sends `SIGTERM`. The worker stops polling, lets its 9 in-flight jobs finish (≤ 60 s), acks them, and exits cleanly.' },
    ],
    knobs: [
      {
        name: 'Concurrency per worker',
        options: [
          { label: '≈ CPU cores', effect: 'Maximises throughput for CPU-bound jobs without context-switch overhead.', when: 'Encoding, compression, ML inference.' },
          { label: 'Tens–hundreds', effect: 'Hides I/O latency; risks exhausting DB pools or rate limits downstream.', when: 'HTTP calls, S3, DB-bound jobs; cap with a semaphore per dependency.' },
        ],
      },
      {
        name: 'Ack timing',
        options: [
          { label: 'Ack after processing', effect: 'At-least-once; duplicates on crash; needs idempotency.', when: 'Default for anything that matters.' },
          { label: 'Ack on receive', effect: 'At-most-once; a crash loses the job.', when: 'Only for disposable work (best-effort metrics).' },
        ],
      },
      {
        name: 'Scaling signal',
        options: [
          { label: 'CPU', effect: 'Misleading for I/O-bound workers that wait on network at 10% CPU while the backlog grows.', when: 'CPU-bound workers only.' },
          { label: 'Backlog per worker / age of oldest', effect: 'Scales on actual demand and latency.', when: 'Queue consumers (KEDA, SQS target tracking).' },
        ],
      },
    ],
    implementations: [
      { name: 'Celery / Sidekiq / BullMQ', how: 'Language-native job frameworks: a broker (Redis/RabbitMQ), worker processes with configurable concurrency, retries with backoff, scheduled jobs, and ack-late options for at-least-once.' },
      { name: 'Kafka consumers / Kafka Streams', how: 'One consumer per partition in a group; process records in order, commit offsets after processing; parallelism ≤ partitions unless you use a parallel consumer with per-key ordering.' },
      { name: 'AWS Lambda event source mapping', how: 'AWS runs the poll loop for you: it polls SQS/Kinesis, invokes functions with batches, deletes on success, scales concurrency with backlog, and supports partial batch failure responses.' },
    ],
    ha: 'Workers are stateless and interchangeable; the queue holds the state. Any worker can die at any time — its leased messages time out and get redelivered. Spread workers across AZs, autoscale on backlog, and keep ≥2 replicas so a single node failure only slows throughput.',
    failureModes: [
      { name: 'Non-idempotent side effects', symptom: 'Duplicate emails or double charges after deploys and crashes.', fix: 'Idempotency keys with unique constraints; external APIs called with idempotency keys.' },
      { name: 'Downstream overload', symptom: 'Autoscaler adds 200 workers to clear backlog; the DB connection pool saturates and everything slows.', fix: 'Cap max replicas and per-worker concurrency to downstream capacity; rate limit; bulkheads.' },
      { name: 'Ungraceful shutdown', symptom: 'Every deploy produces a burst of half-done jobs and duplicates.', fix: 'Handle SIGTERM, stop polling, drain within the grace period; keep visibility timeout > grace period.' },
      { name: 'Over-leasing', symptom: 'A worker prefetches 500 messages, processes slowly, many time out and are processed twice.', fix: 'Small prefetch/batch, bounded buffer, heartbeat lease extension.' },
    ],
    numbers: ['Workers needed ≈ arrival rate × avg processing time (Little’s law): 500 jobs/s × 0.2 s = 100 concurrent slots', 'Kafka consumer parallelism ≤ partitions', 'k8s default grace period 30 s'],
    interview: [
      { q: 'How many workers do you need?', a: 'Little’s law: concurrency = throughput × latency. 500 jobs/s at 200 ms each needs ~100 concurrent slots; at 16 slots per pod that is ~7 pods, plus headroom (×1.5) and a cap set by downstream capacity. Scale on backlog per worker rather than CPU.' },
      { q: 'How do you make a worker safe against duplicates?', a: 'Assume every message can arrive twice or concurrently. Record a unique idempotency key in the same transaction as the effect (or use conditional writes / versioning), and pass idempotency keys to external payment/email APIs. Ack only after commit.' },
    ],
    lab: 'queue',
  },

  // ───────────────────────────── registry ─────────────────────────────
  {
    kind: 'registry',
    summary:
      'A service registry is a small, strongly-replicated database of **which instances of each service are alive and where** (ip:port). Instances register and heartbeat (or the orchestrator registers them), health checks remove dead ones, and callers resolve a service name to healthy addresses — either themselves (client-side) or through a proxy/DNS (server-side).',
    parts: [
      { id: 'register', name: 'Registration', role: 'Instance announces its address', detail: 'Self-registration (instance calls Consul/Eureka on boot) or third-party registration (Kubernetes adds the pod IP to an `EndpointSlice` when it becomes Ready).' },
      { id: 'heartbeat', name: 'Heartbeat / TTL', role: 'Proves the instance is still alive', detail: 'Instances renew a TTL lease (Eureka every 30 s, expiry after 90 s; etcd lease keepalive) or the registry/agent actively health-checks them. No renewal ⇒ entry expires.' },
      { id: 'health', name: 'Health checks', role: 'Marks unhealthy instances as unavailable', detail: 'Consul agents run HTTP/TCP/script checks locally; Kubernetes kubelet runs readiness probes and flips endpoint readiness. Failing instances stay registered but are filtered out.' },
      { id: 'catalog', name: 'Catalog store', role: 'Replicated name → endpoints map', detail: 'Consul servers replicate the catalog with Raft; Kubernetes stores Endpoints in etcd; Eureka is AP — peers replicate asynchronously and favour availability over consistency.' },
      { id: 'resolver', name: 'Resolver', role: 'Answers lookups and pushes changes', detail: 'DNS (`orders.service.consul`, CoreDNS `orders.default.svc.cluster.local`), HTTP API with blocking queries/watches, or xDS push to Envoy sidecars.' },
      { id: 'client-cache', name: 'Client cache/proxy', role: 'Caches endpoints and load-balances calls', detail: 'Client-side: library (Ribbon, gRPC xDS) caches the list and picks an instance. Server-side: kube-proxy programs iptables/IPVS so the ClusterIP VIP NATs to a pod; or a sidecar proxy does it.' },
    ],
    flow: [
      { part: 'register', title: 'Pod becomes ready', text: 'A new `orders` pod starts on 10.1.4.17:8080. Once its readiness probe passes, the EndpointSlice controller adds it.' },
      { part: 'heartbeat', title: 'Liveness maintained', text: 'In a Consul/Eureka setup the instance renews its TTL every 10–30 s; in Kubernetes the kubelet keeps reporting node and pod status.' },
      { part: 'health', title: 'Bad instance filtered', text: 'Pod 10.1.4.9 fails readiness 3 times (DB pool exhausted). It is marked not-ready and removed from the serving endpoints without being killed.' },
      { part: 'catalog', title: 'Catalog updated', text: 'The change is written to etcd (Raft) — the source of truth now lists 5 healthy `orders` endpoints.' },
      { part: 'resolver', title: 'Change propagated', text: 'Watchers are notified: kube-proxy on every node and any xDS control plane receive the new endpoint set within ~1 s.' },
      { part: 'client-cache', title: 'Call routed', text: 'The cart service calls `http://orders:8080`. CoreDNS returns the ClusterIP; kube-proxy’s iptables rules DNAT it to one of the 5 ready pods.' },
    ],
    knobs: [
      {
        name: 'Discovery style',
        options: [
          { label: 'Client-side', effect: 'Client gets the instance list and balances itself: no extra hop, smart algorithms; every language needs a library.', when: 'gRPC, Netflix OSS, proxyless service mesh.' },
          { label: 'Server-side (VIP/proxy/DNS)', effect: 'Clients just call a name; LB/kube-proxy/sidecar picks the instance. Language-agnostic, one more hop.', when: 'Kubernetes Services, service meshes, polyglot fleets.' },
        ],
      },
      {
        name: 'Consistency model',
        options: [
          { label: 'CP (etcd, Consul, ZooKeeper)', effect: 'Single source of truth; registry becomes unavailable for writes without quorum.', when: 'Most setups; pair with client caching.' },
          { label: 'AP (Eureka)', effect: 'Keeps serving possibly stale lists during partitions; self-preservation mode stops mass evictions.', when: 'You prefer stale-but-available discovery.' },
        ],
      },
    ],
    implementations: [
      { name: 'Kubernetes', how: 'Pods → EndpointSlices in etcd via the API server; CoreDNS serves Service names; kube-proxy (iptables/IPVS) or eBPF (Cilium) implements the ClusterIP VIP. Headless services return pod IPs directly.' },
      { name: 'HashiCorp Consul', how: 'Agent on every node runs health checks and gossips membership (Serf/SWIM); 3–5 servers hold the catalog in Raft; DNS and HTTP interfaces; Consul Connect adds mTLS sidecars.' },
      { name: 'Netflix Eureka / ZooKeeper', how: 'Eureka: REST registry, 30 s heartbeats, clients cache the full registry and refresh every 30 s. ZooKeeper: instances create **ephemeral znodes** that vanish when their session dies; clients set watches.' },
    ],
    ha: 'Run 3 or 5 registry servers across AZs (Raft tolerates 1 or 2 failures). Clients and proxies cache the last known endpoint list, so a registry outage freezes discovery (no new instances) instead of breaking traffic. Use DNS TTLs short enough for churn but not zero.',
    failureModes: [
      { name: 'Stale endpoints', symptom: 'Calls go to terminated instances for 30–90 s after scale-in or a crash.', fix: 'Shorter TTL/health intervals, deregister on shutdown, pre-stop drain, client retries on connection refused.' },
      { name: 'Registry outage', symptom: 'New deploys cannot register; clients without caches fail lookups.', fix: 'Client-side caching of last-known-good, multi-AZ quorum, avoid lookups on the hot path.' },
      { name: 'DNS caching gone wrong', symptom: 'JVM caches DNS forever; traffic keeps going to old IPs.', fix: 'Set `networkaddress.cache.ttl`, prefer VIPs or xDS push over raw DNS for fast-changing sets.' },
    ],
    numbers: ['Eureka: 30 s heartbeat, 90 s expiry ⇒ up to ~2 min stale', 'Kubernetes endpoint propagation: ~1 s', '3 servers tolerate 1 failure, 5 tolerate 2'],
    interview: [
      { q: 'Client-side vs server-side discovery?', a: 'Client-side: the caller fetches healthy instances and load-balances (fewer hops, smarter algorithms, but needs a library per language). Server-side: callers hit a stable name/VIP and a proxy or kube-proxy picks the instance (simple, polyglot, one extra hop). Service meshes push the list into a sidecar, combining both.' },
      { q: 'What happens to traffic if the registry goes down?', a: 'With caching, nothing immediately: clients and proxies keep the last known endpoints. You lose the ability to register new instances or remove dead ones, so staleness grows. That is why the registry runs as a 3/5-node quorum and why clients must retry on connection errors.' },
    ],
  },

  // ───────────────────────────── coordinator ─────────────────────────────
  {
    kind: 'coordinator',
    summary:
      'A consensus store (etcd, ZooKeeper) is a small key-value store replicated with Raft/ZAB so that a **majority** of nodes agree on every write in the same order. It is the ground truth for things that must never diverge: leader election, locks with fencing tokens, membership and cluster config. It trades throughput and latency for linearizability.',
    parts: [
      { id: 'client-req', name: 'Client request', role: 'Write or lease request to leader', detail: 'Clients connect to any member; followers forward writes to the leader (etcd) or the leader handles them (ZooKeeper followers forward to the leader too). Reads can be linearizable (go through the leader/quorum) or serializable (local, possibly stale).' },
      { id: 'leader-elect', name: 'Leader election', role: 'Picks one leader per term', detail: 'Followers that hear no heartbeat within a **randomized election timeout** (e.g. 150–300 ms, etcd default 1 s) become candidates, increment the **term** and request votes; a candidate with a majority and an up-to-date log becomes leader. Randomization avoids split votes.' },
      { id: 'log', name: 'Replicated log', role: 'Orders every write as log entry', detail: 'The leader appends the command to its log with (term, index) and sends `AppendEntries` to followers, which check the previous entry matches before appending — this keeps all logs identical prefixes.' },
      { id: 'quorum', name: 'Majority quorum', role: 'Commits once majority has persisted', detail: 'When a majority (3 of 5) has fsynced the entry, the leader advances the **commit index**. Any two majorities overlap, so a new leader always has every committed entry.' },
      { id: 'state-machine', name: 'State machine', role: 'Applies committed entries to KV', detail: 'Each node applies committed entries in order to its KV store (etcd: bbolt B+tree with MVCC revisions; ZooKeeper: in-memory znode tree + snapshots). The global **revision/zxid** is a natural fencing token.' },
      { id: 'lease-watch', name: 'Leases & watches', role: 'Expire sessions, notify waiting clients', detail: 'etcd leases / ZooKeeper sessions expire without keepalives, deleting attached keys / **ephemeral znodes**. Watches stream changes so waiting clients learn instantly when a lock or leader key is released.' },
    ],
    flow: [
      { part: 'client-req', title: 'Campaign for leadership', text: 'Scheduler instance S2 wants to be leader: it does an etcd transaction `if key /sched/leader absent → put S2 with lease 10 s`.' },
      { part: 'leader-elect', title: 'Request reaches Raft leader', text: 'Node B is the etcd leader for term 7 (it won after node A’s heartbeats stopped and B’s randomized timeout fired first). The request is forwarded to B.' },
      { part: 'log', title: 'Appended to log', text: 'B appends entry (term 7, index 18,402) and sends `AppendEntries` to A, C, D, E in parallel.' },
      { part: 'quorum', title: 'Committed by majority', text: 'C and D fsync and reply; with B that is 3 of 5. Commit index advances to 18,402 — the write is now durable even if B dies.' },
      { part: 'state-machine', title: 'Applied: S2 is leader', text: 'Each node applies the transaction: `/sched/leader = S2` at revision 9,001. S2 uses **9,001 as its fencing token** on every write to storage.' },
      { part: 'lease-watch', title: 'Lease expiry hands over', text: 'S2 freezes in a GC pause and misses keepalives; after 10 s the lease expires and the key is deleted. S3’s watch fires, it wins with revision 9,050, and storage rejects S2’s later writes carrying token 9,001.' },
    ],
    knobs: [
      {
        name: 'Cluster size',
        options: [
          { label: '3 nodes', effect: 'Tolerates 1 failure; lowest write latency.', when: 'Most clusters, single region.' },
          { label: '5 nodes', effect: 'Tolerates 2 failures (e.g. one planned + one unplanned); each write waits for 3.', when: 'Critical control planes. Never even sizes: 4 tolerates no more than 3.' },
        ],
      },
      {
        name: 'Read consistency',
        options: [
          { label: 'Linearizable', effect: 'Always the latest committed value (ReadIndex / quorum round-trip); slower.', when: 'Lock/leader checks, config that must be current.' },
          { label: 'Serializable / local', effect: 'Served by any member from local state; may be stale.', when: 'Bulk reads, caches, dashboards.' },
        ],
      },
    ],
    implementations: [
      { name: 'etcd', how: 'Go, Raft, bbolt storage with MVCC; gRPC API with transactions (compare-and-swap), leases, watches. Backs Kubernetes; recommended DB size ≤ 8 GB.' },
      { name: 'Apache ZooKeeper', how: 'ZAB protocol (Raft-like atomic broadcast); hierarchical znodes, ephemeral and sequential znodes for locks/election recipes (Curator), watches; `zxid` orders all changes. Historically backed Kafka, HBase, Hadoop.' },
      { name: 'Consul / Chubby / KRaft', how: 'Consul uses Raft for its catalog and KV with sessions for locks. Google Chubby (Paxos) inspired them all and introduced lock **sequencers** (fencing tokens). Kafka KRaft embeds a Raft quorum for metadata.' },
    ],
    ha: 'Deploy 3 or 5 voters across AZs; the cluster serves writes while a majority is up and becomes read-only/unavailable without one (CP in CAP). Keep it small and dedicated: low-latency disks for fsync, no heavy data — it coordinates, it does not store your business data. Cross-region quorums cost one WAN round trip per write.',
    failureModes: [
      { name: 'Loss of quorum', symptom: '2 of 3 nodes down: all writes, leader elections and lock acquisitions stall.', fix: 'Odd-sized clusters spread across AZs; alert on member health; disaster-recovery snapshots.' },
      { name: 'Slow disk / fsync latency', symptom: 'Heartbeats miss, leaders flap, Kubernetes API becomes sluggish.', fix: 'Dedicated SSDs, monitor `wal_fsync_duration`, tune election timeout to network RTT.' },
      { name: 'Zombie leader without fencing', symptom: 'A paused old leader wakes up and writes after a new leader was elected.', fix: 'Pass the revision/zxid as a fencing token; resources reject tokens lower than the highest seen.' },
      { name: 'Used as a database', symptom: 'Big values and high write rates bloat the store; compaction and snapshots stall the cluster.', fix: 'Store only small coordination data; put payloads elsewhere.' },
    ],
    numbers: ['etcd write latency: ~2–10 ms in one region (1 RTT + fsync)', 'Throughput: ~10k–30k writes/s', '3 nodes tolerate 1 failure, 5 tolerate 2', 'Election timeout ≈ 10× heartbeat interval'],
    interview: [
      { q: 'Walk me through Raft leader election and why it is safe.', a: 'Each node has a randomized election timeout; when a follower hears no heartbeat it becomes candidate, bumps the term and asks for votes. Nodes vote at most once per term and only for candidates whose log is at least as up-to-date. A majority wins, and since majorities overlap, the new leader holds all committed entries. Higher terms immediately depose stale leaders.' },
      { q: 'Why do you need fencing tokens even with a correct consensus store?', a: 'The store can correctly expire a lease, but the old holder may not know (GC pause, network partition) and keep acting. A monotonically increasing token (etcd revision, ZooKeeper zxid) sent with every write lets the protected resource reject stale holders. Consensus decides who the leader is; fencing enforces it at the resource.' },
      { q: 'Why 3 or 5 nodes, not 4 or 6?', a: 'Quorum is ⌊n/2⌋+1. 4 nodes need 3 for quorum and tolerate 1 failure — same as 3 nodes but with more write latency and cost. Odd sizes maximise fault tolerance per node.' },
    ],
  },

  // ───────────────────────────── redis-lock ─────────────────────────────
  {
    kind: 'redis-lock',
    summary:
      'A Redis lock is a key set with `SET lock:job <token> NX PX 30000`: whoever creates the key holds the lock until they delete it or the TTL expires. It is fast and simple, but it is an **efficiency** lock, not a **correctness** lock — a paused client, an expired TTL or a failover can leave two holders at once, and Redis issues no fencing token to stop the stale one.',
    parts: [
      { id: 'acquire', name: 'SET NX PX', role: 'Atomically create key if absent', detail: '`SET lock:invoice-42 9f3c… NX PX 30000` succeeds only if the key does not exist, and sets a TTL so a crashed holder cannot block forever. The value is a random token identifying the owner.' },
      { id: 'redis-node', name: 'Redis primary', role: 'Single-threaded store holding the key', detail: 'Commands execute one at a time, so `SET NX` is atomic on one node. Expiry is checked lazily on access plus an active sampling cycle.' },
      { id: 'replica', name: 'Async replica', role: 'Takes over on primary failure', detail: 'Replication is asynchronous: a lock acknowledged by the primary may not be on the replica when Sentinel/Cluster promotes it — the lock simply disappears.' },
      { id: 'holder-work', name: 'Critical section', role: 'Holder does protected work', detail: 'The client now believes it is exclusive. Nothing stops it from running longer than the TTL, or pausing (GC, VM steal, page fault) while the TTL silently expires.' },
      { id: 'ttl', name: 'TTL expiry', role: 'Auto-releases lock after timeout', detail: 'When PX elapses, Redis deletes the key — regardless of whether the holder is done. Watchdog renewal (Redisson extends every TTL/3) narrows but does not close the gap.' },
      { id: 'release', name: 'Compare-and-delete', role: 'Releases only if token matches', detail: 'A Lua script `if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) end` prevents deleting someone else’s lock. A plain `DEL` would.' },
    ],
    flow: [
      { part: 'acquire', title: 'Client A acquires', text: 'Worker A runs `SET lock:invoice-42 tokA NX PX 10000` → `OK`. It now believes it is the only one generating invoice 42.' },
      { part: 'redis-node', title: 'Key stored on primary', text: 'The primary stores the key with a 10 s TTL and replies instantly (~0.3 ms). Replication to the replica happens later, asynchronously.' },
      { part: 'holder-work', title: 'A pauses', text: 'A starts writing the PDF to storage, then hits a 15 s stop-the-world GC pause. From A’s point of view no time passes.' },
      { part: 'ttl', title: 'Lock expires underneath A', text: 'At 10 s Redis deletes the key. Worker B runs the same `SET NX` → `OK`. Two workers now "hold" the lock.' },
      { part: 'replica', title: 'Or: failover loses it', text: 'Alternatively, the primary crashes before replicating A’s key; the promoted replica has no lock and B acquires immediately. Same result: two holders.' },
      { part: 'release', title: 'Stale holder writes', text: 'A wakes up, finishes writing the PDF over B’s output, and its compare-and-delete fails harmlessly — but the damage is done. Only a **fencing token** checked by the storage would have rejected A’s write.' },
    ],
    knobs: [
      {
        name: 'Lock purpose',
        options: [
          { label: 'Efficiency', effect: 'A rare double execution just wastes work (sends a duplicate cache refresh, runs a cron twice).', when: 'Redis lock is fine — cheap, fast, good enough.' },
          { label: 'Correctness', effect: 'Double execution corrupts data or double-charges money.', when: 'Use etcd/ZooKeeper with fencing tokens, DB row locks / conditional writes, or make the operation idempotent.' },
        ],
      },
      {
        name: 'Topology',
        options: [
          { label: 'Single node / primary+replica', effect: 'Fast; failover can drop locks.', when: 'Efficiency locks only.' },
          { label: 'Redlock (majority of 5 independent nodes)', effect: 'Survives single-node loss, but still assumes bounded clock drift and pauses and still provides no fencing token.', when: 'Rarely worth it: either the lock is for efficiency (single node suffices) or correctness (Redlock is insufficient).' },
        ],
      },
    ],
    implementations: [
      { name: 'Plain SET NX PX + Lua release', how: 'The canonical single-instance pattern from the Redis docs; random token per acquisition, compare-and-delete on release.' },
      { name: 'Redisson (Java)', how: 'RLock with a watchdog thread that extends the TTL every 10 s while the JVM is alive, reentrancy via hash counters, and pub/sub to wake waiters. Still vulnerable to long pauses and failover.' },
      { name: 'Redlock', how: 'Acquire the same key on N=5 independent masters with a short timeout each; succeed if a majority (3) grant it within the validity time minus elapsed time and drift. Criticised by Martin Kleppmann (2016) for depending on timing assumptions; antirez disputed it — the practical consensus: use real consensus + fencing for safety.' },
    ],
    ha: 'Making a Redis lock "highly available" via replicas makes it less safe, because async replication can lose the lock on failover. Redlock spreads it over independent nodes but still relies on timing. If you need both availability and safety, that is precisely what a Raft-based store (etcd, ZooKeeper, Consul) with fencing tokens is for.',
    failureModes: [
      { name: 'Process pause outlives TTL', symptom: 'GC pause or VM freeze longer than the TTL: two holders write concurrently; data corrupted.', fix: 'Fencing tokens checked at the resource, or idempotent / conditional writes (`UPDATE … WHERE version = ?`).' },
      { name: 'Failover drops the lock', symptom: 'Primary dies before replicating; new primary has no key; second client acquires.', fix: 'Do not rely on Redis for correctness; use consensus (etcd lease + revision token).' },
      { name: 'Unsafe release', symptom: 'Client A’s plain `DEL` after its TTL expired deletes client B’s lock; C acquires; three-way race.', fix: 'Compare-and-delete with the owner token via Lua.' },
      { name: 'Clock jumps', symptom: 'NTP step or manual clock change makes TTLs expire early on a node (critical for Redlock).', fix: 'Monotonic clocks, slewing NTP; avoid timing-based safety.' },
    ],
    numbers: ['Acquire/release: ~0.2–1 ms', 'JVM full GC pauses: 100 ms to tens of seconds', 'Typical TTL: 10–30 s — shorter is more fragile, longer blocks recovery'],
    interview: [
      { q: 'Is a Redis SETNX lock safe for leader election?', a: 'No. TTL-based locks without fencing allow two holders: a holder paused past the TTL, or a primary failover before async replication, lets a second client acquire while the first still acts. Use etcd/ZooKeeper leases with the revision/zxid as a fencing token that storage verifies — or design the work to be idempotent so a duplicate is harmless.' },
      { q: 'What is a fencing token and why can’t Redlock provide one?', a: 'A number that strictly increases with each lock grant; the protected resource remembers the highest seen and rejects lower ones, so a stale holder cannot write. Redlock grants come from independent nodes with no shared counter, so there is no monotonic token; a consensus log’s index gives one for free.' },
      { q: 'When is a Redis lock the right tool?', a: 'For efficiency: preventing two cron instances from doing the same expensive but idempotent job, or deduplicating cache rebuilds (stampede protection). If an occasional double execution is merely wasteful, the speed and simplicity win.' },
    ],
  },

  // ───────────────────────────── autoscaler ─────────────────────────────
  {
    kind: 'autoscaler',
    summary:
      'An autoscaler is a **feedback control loop**: every N seconds it reads a metric, compares it to a target, computes a desired replica count, and tells the orchestrator to converge on it. Most of the engineering is in damping — stabilization windows, cooldowns, warm-up and min/max bounds — so it reacts fast to spikes without oscillating.',
    parts: [
      { id: 'metrics', name: 'Metrics source', role: 'Exposes current load signals', detail: 'Kubernetes `metrics-server` (CPU/memory from kubelets), Prometheus Adapter / KEDA for custom metrics (queue depth, RPS, lag), CloudWatch for ASGs.' },
      { id: 'loop', name: 'Control loop', role: 'Wakes every interval and reads metrics', detail: 'HPA syncs every 15 s by default; AWS target tracking evaluates CloudWatch alarms each minute. It averages the metric across ready pods.' },
      { id: 'policy', name: 'Scaling policy', role: 'Computes desired replica count', detail: 'HPA: `desired = ceil(current × currentMetric / target)`, skipped within a 10% tolerance. For queues: `desired = ceil(backlog / targetBacklogPerWorker)`. Takes the max across multiple metrics.' },
      { id: 'damper', name: 'Stabilizer', role: 'Prevents flapping and overreaction', detail: 'Scale-down stabilization window (HPA default 300 s: use the highest recommendation of the last 5 min), rate limits (e.g. at most +100% or +4 pods per 15 s), cooldowns, min/max replicas.' },
      { id: 'actuator', name: 'Actuator', role: 'Changes replica count on orchestrator', detail: 'Patches the Deployment `scale` subresource or the ASG desired capacity. Cluster Autoscaler/Karpenter adds nodes when pods are Pending for lack of capacity.' },
      { id: 'warmup', name: 'Warm-up & readiness', role: 'New capacity becomes useful', detail: 'New pods pull images, start JVMs, warm caches and pass readiness before taking traffic; ASG instance warm-up excludes them from metrics meanwhile. Scale-in protection keeps busy instances alive.' },
    ],
    flow: [
      { part: 'metrics', title: 'Load rises', text: 'A flash sale starts. Average CPU across 10 API pods reaches 90%; metrics-server reports it.' },
      { part: 'loop', title: 'Loop tick', text: 'The HPA’s 15 s sync fires and reads current utilization 90% against a target of 60%.' },
      { part: 'policy', title: 'Desired computed', text: '`ceil(10 × 90 / 60) = 15` replicas. A queue-based worker HPA would instead do `ceil(12,000 backlog / 100 per worker) = 120`.' },
      { part: 'damper', title: 'Rate-limited', text: 'Scale-up policy allows +100% per 15 s, so 15 is permitted now. Had load dipped, the 5-minute scale-down window would have held replicas steady to avoid flapping.' },
      { part: 'actuator', title: 'Deployment scaled', text: 'The HPA patches `replicas: 15`. Two pods are Pending (no room), so Karpenter launches a new node (~60 s).' },
      { part: 'warmup', title: 'Capacity arrives', text: 'After ~30 s of startup and readiness, the new pods join the Service; CPU falls to ~60%. The lag between spike and relief is why you keep headroom or use predictive scaling.' },
    ],
    knobs: [
      {
        name: 'Scaling metric',
        options: [
          { label: 'CPU utilization (target ~50–70%)', effect: 'Simple, built in; lags for I/O-bound services and says nothing about queue backlog.', when: 'Stateless CPU-bound web/API tiers.' },
          { label: 'Requests per target / concurrency', effect: 'Tracks demand directly (ALB RequestCountPerTarget, Knative concurrency).', when: 'Request-driven services with known per-pod capacity.' },
          { label: 'Queue backlog per worker / lag', effect: 'Scales consumers on actual pending work and latency SLO; can scale to zero.', when: 'Workers and stream consumers (KEDA).' },
        ],
      },
      {
        name: 'Reactive vs predictive',
        options: [
          { label: 'Reactive', effect: 'Responds after load arrives; minutes of lag including node provisioning.', when: 'Unpredictable traffic, with headroom.' },
          { label: 'Predictive / scheduled', effect: 'Forecasts from history and scales ahead of daily peaks.', when: 'Strong daily/weekly patterns, known events.' },
        ],
      },
      {
        name: 'Scale-in behaviour',
        options: [
          { label: 'Aggressive', effect: 'Saves money; risks flapping and killing busy instances.', when: 'Short stateless requests, cheap startup.' },
          { label: 'Conservative (long window, small steps)', effect: 'Stable, costs more at the tail.', when: 'Slow-starting services, long-running jobs (plus scale-in protection).' },
        ],
      },
    ],
    implementations: [
      { name: 'Kubernetes HPA', how: 'Controller in kube-controller-manager; ratio formula with 10% tolerance, multiple metrics (max wins), `behavior` field for policies and stabilization windows. VPA adjusts requests; Cluster Autoscaler/Karpenter add nodes.' },
      { name: 'KEDA', how: 'Event-driven autoscaler: scalers for SQS, Kafka lag, Redis, Prometheus etc. feed an HPA via external metrics, and KEDA itself handles 0↔1 scaling.' },
      { name: 'AWS Auto Scaling Groups', how: 'Target tracking (e.g. CPU 50%), step scaling on alarms, scheduled actions and predictive scaling (ML forecast); instance warm-up, cooldown and scale-in protection; lifecycle hooks for draining.' },
    ],
    ha: 'The autoscaler is control plane, not data plane: if it dies, the fleet stays at its current size and keeps serving. Protect against that and against bad metrics with sane `minReplicas` (enough for an AZ loss), `maxReplicas` sized to downstream limits, and alerts when replicas sit at max.',
    failureModes: [
      { name: 'Flapping', symptom: 'Replicas oscillate 10→20→10 every few minutes; constant cold starts.', fix: 'Scale-down stabilization windows, tolerance band, cooldowns, step limits.' },
      { name: 'Too slow for spikes', symptom: 'Errors for the first 3–5 minutes of every spike while nodes and pods boot.', fix: 'Headroom (lower target), over-provisioned buffer pods, predictive/scheduled scaling, faster startup images.' },
      { name: 'Wrong metric', symptom: 'Workers idle at 10% CPU while the queue backlog grows for an hour.', fix: 'Scale on backlog per worker or age of oldest message.' },
      { name: 'Scaling into a bottleneck', symptom: 'More pods exhaust DB connections; latency worsens and the autoscaler adds even more.', fix: 'Max replicas tied to downstream capacity, connection pooling (PgBouncer), circuit breakers.' },
    ],
    numbers: ['HPA: 15 s sync, 10% tolerance, 300 s scale-down window', 'New node: ~1–3 min; new pod on existing node: ~5–60 s', 'Typical CPU target 50–70% leaves room for the scaling delay'],
    interview: [
      { q: 'How does the Kubernetes HPA decide how many replicas to run?', a: '`desired = ceil(current × currentMetric / targetMetric)`, ignoring changes within ±10%. With multiple metrics it takes the max. Scale-down uses the highest recommendation over the last 5 minutes to avoid flapping, and policies cap how fast it can change.' },
      { q: 'How would you autoscale queue consumers?', a: 'On backlog, not CPU: target backlog per worker = acceptable latency ÷ processing time per message (e.g. 10 s ÷ 0.1 s = 100). `desired = ceil(visibleMessages / 100)`, bounded by a max that the downstream DB can handle. KEDA or SQS target tracking with a custom metric implement this.' },
    ],
    lab: 'queue',
  },

  // ───────────────────────────── monitor ─────────────────────────────
  {
    kind: 'monitor',
    summary:
      'Observability is three signal pipelines — **metrics** (cheap aggregated numbers in a time-series DB), **logs** (detailed events) and **traces** (one request across services) — plus an alerting layer. Good monitoring defines SLIs and SLOs on what users feel, alerts on **symptoms** via error-budget burn rate, and uses causes (CPU, queue depth) for diagnosis.',
    parts: [
      { id: 'instrument', name: 'Instrumentation', role: 'Emits metrics, logs and spans', detail: 'Client libraries / OpenTelemetry SDKs increment counters, record histograms (latency buckets), write structured logs and create spans with trace context propagated via the `traceparent` header.' },
      { id: 'collect', name: 'Collector / scraper', role: 'Gathers signals from all hosts', detail: 'Prometheus **pulls** `/metrics` from discovered targets every 15–30 s; the OTel Collector or Datadog agent receives pushed spans/logs, batches, samples and exports them.' },
      { id: 'tsdb', name: 'Time-series DB', role: 'Stores compressed samples per series', detail: 'Prometheus TSDB: in-memory head block + WAL, 2-hour blocks compacted on disk, Gorilla-style delta-of-delta + XOR compression (~1–2 bytes/sample). Each unique label set is a series — **cardinality** is the cost driver.' },
      { id: 'query', name: 'Query & dashboards', role: 'Aggregates series into SLIs', detail: 'PromQL like `sum(rate(http_requests_total{code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))`; `histogram_quantile(0.99, …)` for p99. Grafana renders dashboards; traces in Jaeger/Tempo; logs in Loki/Elasticsearch.' },
      { id: 'rules', name: 'Alert rules', role: 'Evaluates SLO burn and thresholds', detail: 'Rules evaluated every interval with a `for:` duration. Best practice: **multi-window burn-rate** alerts (e.g. 14.4× burn over 1 h and 5 min ⇒ page) instead of static CPU thresholds.' },
      { id: 'notify', name: 'Alert routing', role: 'Dedupes, groups and pages humans', detail: 'Alertmanager/PagerDuty group related alerts, inhibit downstream noise, route by severity (page vs ticket) and link to runbooks and dashboards.' },
    ],
    flow: [
      { part: 'instrument', title: 'Request measured', text: 'Checkout handles a request in 840 ms with a 500. The SDK increments `http_requests_total{code="500"}`, observes the latency histogram, logs with the trace id, and ends the span.' },
      { part: 'collect', title: 'Scraped', text: 'Prometheus scrapes the pod’s `/metrics` 15 s later; the OTel Collector forwards the span (tail sampling keeps it because it errored).' },
      { part: 'tsdb', title: 'Stored', text: 'The samples append to the head block. The `code="500"` series already exists, so this costs ~2 bytes, not a new series.' },
      { part: 'query', title: 'SLI computed', text: 'The availability SLI over 5 min is 97.9% against a 99.9% SLO: the error budget is burning ~21× faster than sustainable.' },
      { part: 'rules', title: 'Burn-rate alert fires', text: 'Both the 1 h and 5 min windows exceed 14.4× burn — at this rate 2% of the monthly budget is gone in an hour. Severity: page.' },
      { part: 'notify', title: 'On-call paged', text: 'Alertmanager groups 40 pod-level alerts into one page with a runbook link. The engineer jumps from the dashboard spike to an exemplar trace showing the slow payment dependency.' },
    ],
    knobs: [
      {
        name: 'Collection model',
        options: [
          { label: 'Pull (Prometheus)', effect: 'Server controls rate; a failed scrape signals target down; needs service discovery and reachable targets.', when: 'Long-lived services in Kubernetes.' },
          { label: 'Push (OTLP, StatsD, Datadog)', effect: 'Works for short-lived jobs and behind NAT; senders can overwhelm the backend.', when: 'Batch jobs, serverless, SaaS backends.' },
        ],
      },
      {
        name: 'What to alert on',
        options: [
          { label: 'Symptoms (SLO burn, RED)', effect: 'Pages only when users are hurt; few, actionable alerts.', when: 'Paging alerts.' },
          { label: 'Causes (CPU, disk, USE)', effect: 'Noisy; many fire without user impact.', when: 'Tickets, dashboards, capacity planning — except imminent-failure causes like disk 95% full.' },
        ],
      },
      {
        name: 'Trace sampling',
        options: [
          { label: 'Head sampling (e.g. 1%)', effect: 'Cheap; misses most rare errors.', when: 'Very high volume, healthy baseline.' },
          { label: 'Tail sampling', effect: 'Decide after the trace completes: keep errors and slow ones; collector must buffer whole traces.', when: 'Debugging latency and errors.' },
        ],
      },
    ],
    implementations: [
      { name: 'Prometheus + Thanos/Mimir', how: 'Pull-based scraping with service discovery, local TSDB with ~15 d retention; Thanos/Mimir/Cortex add HA dedup, global query and long-term storage in object storage.' },
      { name: 'OpenTelemetry', how: 'Vendor-neutral APIs/SDKs and the Collector (receivers → processors → exporters) for traces, metrics and logs over OTLP; backends like Jaeger, Tempo, Honeycomb, Datadog.' },
      { name: 'Datadog / New Relic / CloudWatch', how: 'SaaS: host agents push metrics, logs and traces; managed storage, dashboards, anomaly detection and SLO tooling; priced per host, per custom metric and per GB — cardinality and log volume drive cost.' },
    ],
    ha: 'Run two identical Prometheus replicas scraping the same targets and dedupe at query time (Thanos/Mimir); run Alertmanager as a gossiping cluster. Monitoring must fail independently of what it monitors — host it separately, and add a **dead-man’s-switch** alert that fires continuously so silence itself pages.',
    failureModes: [
      { name: 'Cardinality explosion', symptom: 'Someone adds `user_id` as a label; series count goes from 100k to 50M, Prometheus OOMs.', fix: 'Never label with unbounded values; enforce limits; put IDs in logs/traces, not metrics.' },
      { name: 'Alert fatigue', symptom: '200 alerts a day, on-call ignores them, the real outage is missed.', fix: 'Page only on SLO burn-rate symptoms; delete non-actionable alerts; runbooks for each.' },
      { name: 'Averages hide pain', symptom: 'Mean latency 80 ms looks fine while p99 is 4 s for 1% of users.', fix: 'Histograms and percentiles; SLOs on p99 or on % of requests under a threshold.' },
      { name: 'Monitoring down with the system', symptom: 'Region outage takes the monitoring stack with it; nobody is paged.', fix: 'Out-of-band monitoring, synthetic external probes, dead-man’s switch.' },
    ],
    numbers: ['99.9% SLO = 43 min error budget per 30 days; 99.99% = 4.3 min', 'Prometheus: ~1–2 bytes/sample; ~1–10M active series per server', 'Burn-rate page: 14.4× over 1 h (2% of budget); ticket: 1× over 3 d'],
    interview: [
      { q: 'What would you alert on for a new API service?', a: 'User-facing symptoms via SLOs: availability (non-5xx ratio) and latency (% of requests under 300 ms), with multi-window burn-rate alerts that page on fast burn and ticket on slow burn. Dashboards carry RED (rate, errors, duration) per endpoint and USE (utilization, saturation, errors) for resources to diagnose causes.' },
      { q: 'Metrics vs logs vs traces — when do you use each?', a: 'Metrics: cheap, aggregated, for alerting and trends — but low cardinality. Logs: high-detail events for a specific failure. Traces: where time went across services for one request. Link them: exemplars on metrics point to trace ids, and logs carry the trace id.' },
      { q: 'What is an error budget and how is it used?', a: '1 − SLO over a window: 99.9% gives ~43 min/month of allowed failure. While budget remains, teams ship fast; when it is exhausted, they prioritise reliability work and slow risky releases. It turns reliability into an explicit, shared trade-off.' },
    ],
  },

  // ───────────────────────────── cron-poller ─────────────────────────────
  {
    kind: 'cron-poller',
    summary:
      'A cron DB poller wakes up on a timer, runs `SELECT … WHERE status = \'pending\'`, processes the rows and updates their status. It works for prototypes, but it couples latency to the poll interval, puts constant scan load on the primary database, races when run on more than one instance, and misses deletes. A queue, or an outbox table + CDC, is usually the right replacement.',
    parts: [
      { id: 'timer', name: 'Cron timer', role: 'Triggers a run every interval', detail: 'crontab, Kubernetes CronJob, Quartz or a `setInterval` loop. Minimum practical latency is the interval; average added delay is half of it.' },
      { id: 'scan', name: 'Pending scan', role: 'Selects rows awaiting processing', detail: '`SELECT * FROM jobs WHERE status = \'pending\' ORDER BY created_at LIMIT 100`. Needs a (partial) index on status, else it is a full table scan; it runs even when there is nothing to do.' },
      { id: 'claim', name: 'Row claim', role: 'Marks rows as taken by this run', detail: 'Naively: `UPDATE … SET status = \'processing\'` after the select — a race. Correct: `SELECT … FOR UPDATE SKIP LOCKED` (Postgres/MySQL 8) or an atomic `UPDATE … RETURNING`, so concurrent pollers take disjoint rows.' },
      { id: 'process', name: 'Processing', role: 'Does the work per row', detail: 'Runs the side effect (send email, call API). If the poller crashes here, rows stay `processing` forever unless a reaper resets stale claims by timestamp.' },
      { id: 'mark-done', name: 'Status update', role: 'Writes done or failed back', detail: '`UPDATE jobs SET status = \'done\'`. Every job costs at least two writes plus a scan on the OLTP primary, creating churn, dead tuples and vacuum pressure.' },
    ],
    flow: [
      { part: 'timer', title: 'Tick', text: 'Every 60 s the cron fires. A job inserted 1 s after the last tick waits 59 s — average latency is 30 s regardless of load.' },
      { part: 'scan', title: 'Scan the table', text: 'The query scans for pending rows. 99% of ticks find nothing, yet each still hits the primary; with a missing index on 50M rows it takes seconds.' },
      { part: 'claim', title: 'Two pollers, same rows', text: 'You scaled to 2 instances for HA. Both run the same `SELECT` before either updates — both get rows 1–100. Without `FOR UPDATE SKIP LOCKED`, every job runs twice.' },
      { part: 'process', title: 'Crash mid-batch', text: 'Instance A dies after 40 rows. Rows 41–100 stay `processing` until a reaper notices; there is no visibility timeout like a queue has.' },
      { part: 'mark-done', title: 'Write-back', text: 'Each row is updated to `done`, adding write load and bloat to the hot table. Deleted rows were never seen at all — polling cannot observe deletes.' },
    ],
    knobs: [
      {
        name: 'Poll interval',
        options: [
          { label: 'Short (1 s)', effect: 'Lower latency, but 86,400 scans/day per poller on the primary, mostly empty.', when: 'Small tables with an index, low scale.' },
          { label: 'Long (1–5 min)', effect: 'Light load, but minutes of latency and big bursty batches.', when: 'Truly batch work: nightly reports, cleanup.' },
        ],
      },
      {
        name: 'Replacement',
        options: [
          { label: 'Message queue', effect: 'Push-like latency (ms), leases, retries, DLQ, competing consumers; no DB scans.', when: 'Background jobs triggered by app actions.' },
          { label: 'Outbox + CDC', effect: 'Atomic with the DB write, ordered, captures deletes, near-zero query load.', when: 'Publishing data changes/events reliably.' },
          { label: 'Polling with SKIP LOCKED', effect: 'Safe concurrent claiming in the DB you already have; still interval latency and DB load.', when: 'Modest volumes where adding a broker is not worth it (e.g. good-job, river, pg-boss).' },
        ],
      },
    ],
    implementations: [
      { name: 'Naive crontab + SELECT', how: 'One script on one box. Simple, but a SPOF; adding a second box causes double processing unless guarded by a lock.' },
      { name: 'Postgres job queues (pg-boss, River, Que, Solid Queue)', how: 'Use `FOR UPDATE SKIP LOCKED` for disjoint claiming, plus `LISTEN/NOTIFY` to wake workers immediately instead of waiting for the next tick — the respectable version of polling.' },
      { name: 'Outbox polling relay', how: 'A relay polls the `outbox` table by increasing id and publishes to a broker; acceptable at low volume, but Debezium tailing the WAL is lower-latency and lighter on the DB.' },
    ],
    ha: 'Running one poller is a SPOF; running two without coordination double-processes. Making it HA requires row-level claiming (`SKIP LOCKED`), stale-claim reapers and idempotent processing — at which point you have rebuilt a queue inside your OLTP database. A real queue or CDC gives HA, leases and retries out of the box.',
    failureModes: [
      { name: 'Double processing', symptom: 'Two instances select the same pending rows; customers get two emails.', fix: '`SELECT … FOR UPDATE SKIP LOCKED` or atomic `UPDATE … RETURNING` claim; idempotent handlers; better, a queue.' },
      { name: 'DB load from scans', symptom: 'Primary CPU high from constant polling queries; slow queries for real users.', fix: 'Partial index on pending rows, longer interval, LISTEN/NOTIFY — or move to a queue/CDC.' },
      { name: 'Latency floor', symptom: 'Product wants sub-second notifications; the cron runs every minute.', fix: 'Enqueue at write time (via outbox) so consumers react in milliseconds.' },
      { name: 'Missed changes', symptom: 'Polling on `updated_at` misses deletes and rows from long transactions committed with older timestamps.', fix: 'CDC from the WAL/binlog captures every committed change in order.' },
    ],
    numbers: ['Average added latency = interval / 2 (60 s cron ⇒ 30 s)', '1 s interval = 86,400 queries/day per poller, mostly empty', 'Queue delivery latency: ~10–100 ms; CDC lag: ~100 ms–1 s'],
    interview: [
      { q: 'Why not just poll the database for new orders every minute?', a: 'Latency floor of the interval, constant scan load on the primary, races when you run more than one poller (duplicates without `SKIP LOCKED`), no leases/retries/DLQ for crashed runs, and no visibility of deletes. Write an outbox row in the same transaction and publish via CDC, or enqueue to a broker so workers react in milliseconds.' },
      { q: 'If you must poll, how do you make it safe with multiple workers?', a: 'Claim atomically: `SELECT id FROM jobs WHERE status = \'pending\' ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`, update to processing with a `claimed_at` in the same transaction, reap stale claims, keep handlers idempotent, index the pending rows, and use LISTEN/NOTIFY to avoid waiting for the next tick.' },
    ],
  },
];
