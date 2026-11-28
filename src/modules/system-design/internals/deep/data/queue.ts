import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'queue',

  problem: {
    why: 'A message queue lets a producer hand off work and return immediately, while consumers pull that work at their own pace. It converts a synchronous dependency ("the payment service must be up and fast right now") into an asynchronous one ("the work will be done, eventually, at least once"). The queue is a durable buffer plus a **lease protocol**: each message goes to one consumer at a time and is deleted only on ack.',
    withoutIt: [
      'A traffic spike (flash sale, batch import) hits the slowest dependency directly; it saturates and the failure cascades back to the user-facing API.',
      'Any downstream outage becomes a user-facing outage, because the caller has nowhere to park work while the consumer is down.',
      'Retries live in the caller’s memory: a deploy or crash loses every in-progress retry, and nothing records which jobs were done.',
      'Scaling consumers means re-sharding work by hand; there is no built-in "give this job to whichever worker is free" (competing consumers).',
      'Slow work (PDF render, video transcode, sending 10k emails) sits on request threads and blows the p99 of unrelated endpoints.',
    ],
    position: 'Between a producer (API, service, CDC/outbox relay) and a pool of workers. Producers write over HTTPS/AMQP; workers long-poll or receive pushes, process, and ack. Nothing on the user’s critical path waits for the consumer.',
    diagram: {
      type: 'flow',
      title: 'Load leveling',
      nodes: [
        { label: 'API', sub: 'bursty: 5k req/s', tone: 'neutral' },
        { label: 'Queue', sub: 'absorbs burst durably', tone: 'accent' },
        { label: 'Workers', sub: 'steady: 1k jobs/s', tone: 'ok' },
        { label: 'DB / 3rd party', sub: 'protected from spike', tone: 'info' },
      ],
      caption: 'The queue converts a spike into backlog; the downstream sees a flat, capped rate. Backlog age is the price.',
    },
  },

  architecture: {
    overview: 'Every queue broker has the same skeleton: an ingress that durably stores a message before acking the producer, a ready set of deliverable messages, an **in-flight (unacked) set** with per-message leases, and an ack path that deletes, requeues, or dead-letters. The big design differences are push vs pull delivery, how the ready set is sharded (one process per queue in RabbitMQ vs many hosts per queue in SQS), and how replication is done (Raft majority vs managed multi-AZ storage).',
    diagram: {
      type: 'flow',
      title: 'Inside a queue broker',
      nodes: [
        { label: 'Producer', sub: 'publish + confirm', tone: 'neutral' },
        { label: 'Router / exchange', sub: 'bindings pick queues', tone: 'info' },
        { label: 'Replicated store', sub: 'Raft log / multi-AZ', tone: 'accent' },
        { label: 'Ready set', sub: 'FIFO-ish, per group', tone: 'accent' },
        { label: 'In-flight set', sub: 'lease + deadline', tone: 'warn' },
        { label: 'Consumer', sub: 'prefetch-bounded', tone: 'ok' },
        { label: 'Ack / DLX', sub: 'delete, requeue, DLQ', tone: 'violet' },
      ],
      caption: 'A message lives in exactly one of: ready, in-flight, deleted, dead-lettered. Lease expiry moves in-flight back to ready.',
    },
    blocks: [
      { name: 'Publish path + confirms', what: 'Producer sends; broker replies only after the message is durably stored (SQS 200 OK, AMQP `basic.ack` in confirm mode). Without confirms, a broker crash silently drops "sent" messages.' },
      { name: 'Exchange + bindings (AMQP)', what: 'RabbitMQ never publishes to a queue directly: publishers hit an exchange (direct/topic/fanout/headers) that copies the message to every bound queue whose binding matches the routing key or headers.' },
      { name: 'Queue process / partition', what: 'In RabbitMQ each queue is one Erlang process (quorum queue = one Raft group), so a single queue is bounded by roughly one core. SQS spreads one queue across many storage hosts, which is why it scales "infinitely" but only orders best-effort.' },
      { name: 'In-flight table (leases)', what: 'Per delivered message: receipt handle or delivery tag, consumer, deadline, receive count. Lease expiry (SQS visibility timeout) or channel close (AMQP) returns the message to ready.' },
      { name: 'Flow control', what: 'RabbitMQ uses credit-based flow control between internal processes plus memory/disk alarms that block publishing connections. SQS pushes back with throttling errors and the in-flight cap.' },
      { name: 'Redrive / dead-letter', what: 'Receive counter per message; after `maxReceiveCount` (SQS) or `delivery-limit` (quorum queue), the message moves to a DLQ / dead-letter exchange with failure metadata.' },
      { name: 'Delay + priority', what: 'Delay queues hide new messages for N seconds (SQS `DelaySeconds` up to 900 s). Priority queues keep one sub-queue per priority level (RabbitMQ `x-max-priority`).' },
    ],
    real: [
      { name: 'Amazon SQS', how: 'Managed, pull-only HTTPS API. Messages are stored redundantly across multiple hosts and AZs; short polling samples a subset of hosts (hence empty or partial receives), long polling queries all of them. Standard = at-least-once, best-effort order; FIFO = ordered per `MessageGroupId` with a 5-minute dedup window.' },
      { name: 'RabbitMQ', how: 'Erlang/OTP broker speaking AMQP 0-9-1 (plus MQTT, STOMP, AMQP 1.0). Exchanges route to queues; **quorum queues** replicate via the Ra Raft library; classic mirrored queues were removed in 4.0. Push delivery with per-channel prefetch and manual acks.' },
      { name: 'Redis Streams (as a queue)', how: '`XADD` appends to a radix-tree-backed stream; consumer groups give competing consumers with a **Pending Entries List** (PEL) per consumer; `XACK` removes from the PEL, `XAUTOCLAIM` steals entries idle longer than N ms from dead consumers.' },
      { name: 'Google Cloud Pub/Sub (pull subscription)', how: 'A subscription with many pullers is a competing-consumer queue: each message is leased for the ack deadline (10–600 s), extended by client libraries automatically, redelivered if not acked, with optional exactly-once delivery per region.' },
      { name: 'Kafka share groups', how: 'KIP-932 (early access in Kafka 4.0) adds queue semantics on top of the log: per-record acquisition locks, acks and delivery counts, so consumers can exceed partition count. Before that, Kafka was a poor queue (one slow record blocks its partition).' },
    ],
  },

  lifecycle: {
    summary: 'One `ChargeCard` job from publish to delete on an SQS-like broker. The broker adds a few ms; the dominant number is the time spent waiting in the ready set, which is zero when idle and backlog ÷ drain rate under load.',
    stages: [
      { stage: 'Serialize + commit outbox row', what: 'The producer writes the business row and an outbox row in one DB transaction, then a relay publishes it.', cost: 'One local transaction; relay adds poll/CDC delay.', ms: 2, part: 'producer' },
      { stage: 'Publish over HTTPS/AMQP', what: 'Reused TLS connection; SQS `SendMessage` (or batch of 10) / AMQP `basic.publish`.', cost: '1 RTT in-region.', ms: 1 },
      { stage: 'Route', what: 'AMQP exchange matches bindings; SQS front end picks storage hosts.', cost: 'In-memory lookup.', ms: 0.05 },
      { stage: 'Durable replicate + confirm', what: 'Quorum queue: Raft append + fsync on a majority. SQS: written to multiple AZs before 200.', cost: 'Cross-AZ RTT + fsync.', ms: 8 },
      { stage: 'Wait in ready set', what: 'Zero when consumers are idle; otherwise depth ÷ drain rate. This is what `ApproximateAgeOfOldestMessage` measures.', cost: 'Queueing delay — dominates under load.', ms: 20 },
      { stage: 'Receive (long poll)', what: 'A waiting `ReceiveMessage` (`WaitTimeSeconds=20`) returns as soon as the message is visible; lease starts.', cost: 'Return of an already-open request.', ms: 3 },
      { stage: 'Process', what: 'Idempotency check, call the payment provider with an idempotency key, commit.', cost: 'Your code; usually the biggest fixed cost.', ms: 120 },
      { stage: 'Ack / delete', what: '`DeleteMessage` with the receipt handle (or `basic.ack` with delivery tag); batching amortises it.', cost: '1 RTT; async/batched in good clients.', ms: 3 },
    ],
  },

  deepDives: [
    {
      title: 'Leases, visibility timeout and the at-least-once state machine',
      hook: 'Every duplicate you will ever debug comes from a lease that expired or an ack that was lost.',
      body: [
        'Delivery is a lease, not a transfer. SQS hides a received message for the **visibility timeout** (default 30 s, max 12 h); if `DeleteMessage` is not called before it expires, the message becomes visible again and `ApproximateReceiveCount` increments. RabbitMQ holds an unacked delivery until the consumer acks, nacks, or its channel/connection closes — and since 3.8.15 a `consumer_timeout` (default 30 min) closes channels that sit on an unacked delivery too long.',
        'There are exactly two ways to lose the race: the lease expires while the worker is still working (duplicate runs **concurrently**), or the work commits and the ack is lost (duplicate runs **sequentially**). Neither can be prevented by the broker; both are handled by idempotent consumers. Ack-before-processing flips you to at-most-once instead.',
        '`basic.nack(requeue=true)` puts a message back at (roughly) the head of the queue — a crash-looping handler then hot-loops on it. SQS has no requeue; you either let the lease expire or set visibility to 0 (immediate retry) or N (crude backoff via `ChangeMessageVisibility`).',
      ],
      diagram: {
        type: 'sequence',
        title: 'Lease expiry → concurrent duplicate',
        actors: ['Worker A', 'Queue', 'Worker B', 'Payments'],
        messages: [
          { from: 'Worker A', to: 'Queue', label: 'Receive (vis=30s)' },
          { from: 'Worker A', to: 'Payments', label: 'charge #42 (slow 45s)' },
          { from: 'Queue', to: 'Queue', label: '30s: lease expires', tone: 'warn' },
          { from: 'Worker B', to: 'Queue', label: 'Receive → same msg' },
          { from: 'Worker B', to: 'Payments', label: 'charge #42 again', tone: 'bad' },
          { from: 'Payments', to: 'Worker B', label: 'idempotency key hit', dashed: true, tone: 'ok' },
          { from: 'Worker A', to: 'Queue', label: 'Delete (stale handle)', dashed: true },
        ],
        caption: 'Only the provider-side idempotency key saved the customer here.',
      },
      bullets: [
        'Set visibility ≥ p99.9 processing time; for long or variable jobs, heartbeat with `ChangeMessageVisibility` every ~1/3 of the timeout.',
        'AWS guidance for Lambda consumers: queue visibility timeout ≥ 6× the function timeout, because retries and batching stretch wall time.',
        'Treat `ApproximateReceiveCount > 1` as a signal: log it and graph it; a rising rate means leases are too short or workers are crashing.',
      ],
      insight: 'Idempotency must cover concurrent duplicates, not just sequential ones: a "check processed-ids, then do work" without a unique constraint or lock still double-executes when two leases overlap.',
    },
    {
      title: 'RabbitMQ routing: exchanges, bindings, queues as Erlang processes',
      hook: 'Routing lives in the broker, so topology is part of your API contract.',
      body: [
        'AMQP 0-9-1 publishers send to an **exchange** with a routing key. Bindings connect exchanges to queues (or to other exchanges). The broker evaluates bindings and enqueues a copy into every matching queue; an unroutable message is dropped unless the publisher sets `mandatory` (returned via `basic.return`) or the exchange has an alternate exchange.',
        'Each classic queue is a single Erlang process that owns its message index and store, and each quorum queue is one Raft group with a leader process. That makes one queue roughly a single-core bottleneck (tens of thousands of msg/s for small messages, much less with confirms and persistence). Scale by spreading load across many queues (consistent-hash exchange, sharding plugin, or one queue per tenant), not by adding nodes behind one queue.',
        '**Prefetch** (`basic.qos`) caps unacked deliveries per consumer/channel. Unlimited prefetch lets the broker push the whole backlog into one consumer’s memory; prefetch 1 gives perfectly fair dispatch but costs a round trip per message. 10–300 is the usual band, lower for long jobs.',
      ],
      table: {
        caption: 'Exchange types',
        columns: ['Type', 'Routing rule', 'Typical use'],
        rows: [
          ['direct', 'Binding key == routing key', 'Task queues per job type; default nameless exchange routes by queue name'],
          ['topic', 'Pattern on dot-separated words: `*` = one word, `#` = zero or more', '`orders.*.eu` region/event filtering'],
          ['fanout', 'Ignores routing key, copies to all bound queues', 'Broadcast/fan-out to N services'],
          ['headers', 'Match on message headers (`x-match: all|any`)', 'Multi-attribute routing; rarer, slower'],
        ],
      },
      code: {
        lang: 'python',
        caption: 'Durable topology + confirms + manual ack (pika)',
        code: `ch.exchange_declare('orders', exchange_type='topic', durable=True)
ch.queue_declare('billing', durable=True, arguments={
    'x-queue-type': 'quorum',
    'x-delivery-limit': 5,                 # then dead-letter
    'x-dead-letter-exchange': 'orders.dlx',
})
ch.queue_bind('billing', 'orders', routing_key='order.*.created')
ch.confirm_delivery()                      # publisher confirms
ch.basic_publish('orders', 'order.eu.created', body,
                 properties=pika.BasicProperties(delivery_mode=2),
                 mandatory=True)
ch.basic_qos(prefetch_count=50)
ch.basic_consume('billing', on_msg, auto_ack=False)`,
      },
      insight: 'A "hot queue" in RabbitMQ cannot be fixed by adding nodes — the queue process lives on one node. If one queue needs more than ~one core of throughput, you must partition it into several queues and accept per-partition ordering.',
    },
    {
      title: 'Replication and flow control: quorum vs classic queues, lazy, memory alarms',
      hook: 'RabbitMQ fails by blocking publishers, not by dropping messages — your producers must handle that.',
      body: [
        '**Quorum queues** (3.8+) replicate an append-only log with Raft: a publish is confirmed after a majority fsyncs it; leader failover is automatic and safe. **Classic mirrored queues** used a chained replication scheme that could lose data or require full resyncs that blocked the queue; they were deprecated and removed in RabbitMQ 4.0. Quorum queues are now the default for anything durable.',
        '**Lazy queues** (`x-queue-mode=lazy`) moved messages to disk early to survive deep backlogs; since 3.12 classic queues (v2 storage) behave lazily by default and the argument is ignored. Quorum queues keep only a small tail in memory too, but their Raft log segments are truncated only once all messages in them are acked — a few very old unacked messages can pin a lot of disk.',
        'When memory crosses `vm_memory_high_watermark` (a fraction of RAM: 0.4 in older releases, 0.6 in recent ones) or free disk drops below `disk_free_limit`, the broker raises an alarm and **blocks all publishing connections** cluster-wide (`connection.blocked`). Consumers keep working. Internally, credit-based flow control already throttles fast publishers before alarms fire.',
      ],
      diagram: {
        type: 'compare',
        title: 'Classic mirrored vs quorum queue',
        columns: [
          { name: 'Classic mirrored (removed 4.0)', tone: 'bad', points: ['Leader + mirrors via GM ring', 'Unsynced mirror on restart', 'Full resync blocks queue', 'Split-brain under partitions'] },
          { name: 'Quorum queue (Raft)', tone: 'ok', points: ['Majority-fsync confirms', 'Safe leader election', 'Delivery-limit + DLX built in', 'Higher latency, more disk'] },
        ],
      },
      bullets: [
        'Quorum queues default `delivery-limit` to 20 in 4.0 — poison messages no longer loop forever by default.',
        'Use `max-length` / `max-length-bytes` with `overflow=reject-publish` to bound queues explicitly instead of discovering the limit via a memory alarm.',
        'Alarm on `rabbitmq_alarms_memory_used_watermark` and on publishers seeing blocked connections; an alarm is an outage for every producer on the cluster.',
      ],
      insight: 'Because alarms are cluster-wide, one runaway queue (no consumer, no max-length) blocks producers of every other queue on the cluster — bound every queue and split critical and best-effort traffic onto different clusters (vhosts are not enough).',
    },
    {
      title: 'SQS at design level: standard vs FIFO, message groups, dedup',
      hook: 'FIFO gives ordering per group, not per queue — and the group id is the real throughput knob.',
      body: [
        'A standard queue is sharded across many hosts with no global sequencer, so it offers near-unlimited throughput, at-least-once delivery and best-effort ordering. Receives are capped by the **in-flight limit** (about 120,000 for standard queues; FIFO was historically 20,000) — exceed it and `ReceiveMessage` returns `OverLimit`, which is how runaway prefetch shows up.',
        'FIFO queues order strictly per `MessageGroupId`: while a message in a group is in flight, later messages in that group are not delivered, so one slow or failing message stalls its group (not the queue). Throughput scales with distinct active groups: 300 API calls/s per action, 3,000 msg/s with batches of 10, and far more in high-throughput mode, which partitions by group id.',
        'Dedup: a `MessageDeduplicationId` (or SHA-256 of the body with content-based dedup) seen within **5 minutes** is accepted but not enqueued again. This makes producer retries safe within that window only — consumer-side idempotency is still required.',
        'Payload limits: 256 KiB for most of SQS’s history (raised to 1 MiB in 2025); larger payloads use the Extended Client Library, which stores the body in S3 and sends a pointer (claim-check pattern).',
      ],
      code: {
        lang: 'bash',
        caption: 'FIFO send + long-poll receive',
        code: `aws sqs send-message --queue-url $Q.fifo \\
  --message-body '{"orderId":42,"op":"capture"}' \\
  --message-group-id order-42 \\
  --message-deduplication-id capture-42-v1

aws sqs receive-message --queue-url $Q.fifo \\
  --max-number-of-messages 10 --wait-time-seconds 20 \\
  --visibility-timeout 120 --attribute-names ApproximateReceiveCount`,
      },
      insight: 'Choosing `MessageGroupId = tenantId` silently caps a big tenant at one-at-a-time processing; choose the narrowest entity that needs ordering (order id, account id), never a constant.',
    },
    {
      title: 'Backpressure, depth vs age, and Little’s law sizing',
      hook: 'Depth tells you how much; age tells you how late — alert on age.',
      body: [
        'A queue does not remove overload, it converts it into latency. If arrival rate λ exceeds drain rate μ for T seconds, backlog grows by (λ − μ)·T and drains at (μ − λ) afterwards. **Little’s law** (L = λ·W) links them: backlog L at throughput λ means each message waits W = L/λ.',
        '**Depth** is a capacity signal (autoscale on backlog per worker). **Age of oldest message** is the SLO signal: 10k messages may be fine at 5k/s drain (2 s) and terrible at 10/s (17 min). SQS exposes `ApproximateAgeOfOldestMessage`; RabbitMQ needs a consumer-side "now − enqueue timestamp" histogram.',
        'Backpressure must propagate somewhere: bound the queue (max-length, TTL, or producer-side rate limit), shed low-priority work, or let the producer fail fast. An unbounded queue just moves the outage to "oldest message is 3 days old" or to broker OOM.',
      ],
      diagram: {
        type: 'flow',
        title: 'Backlog dynamics',
        nodes: [
          { label: 'λ = 3k/s burst', sub: 'for 10 min', tone: 'warn' },
          { label: 'μ = 1k/s drain', sub: 'workers capped', tone: 'neutral' },
          { label: 'Backlog 1.2M', sub: '(3k−1k)·600 s', tone: 'bad' },
          { label: 'Wait = 20 min', sub: 'L / μ at peak', tone: 'bad' },
          { label: 'Drain 20 min', sub: 'after burst ends', tone: 'ok' },
        ],
        caption: 'Size workers for the SLO on age, not for average load.',
      },
      insight: 'Autoscaling on depth alone oscillates and lags; scale on backlog-per-worker toward a target derived from the age SLO (target = acceptable wait × per-worker throughput), and cap max workers at what the downstream can take.',
    },
    {
      title: 'Ordering vs parallelism, priority and delay queues',
      hook: 'Global order and parallel consumers are mutually exclusive; pick the scope of order deliberately.',
      body: [
        'With N competing consumers, message 2 can finish before message 1 even on a perfectly FIFO queue. True ordering requires serialising per key: FIFO message groups, a Kafka partition per key, RabbitMQ single-active-consumer, or a consistent-hash exchange to N queues each with one consumer. Throughput then scales with the number of independent keys, and one slow key creates head-of-line blocking.',
        'Often you need less than ordering: **commutative or versioned updates** (apply only if `version > stored_version`) let you process out of order and drop stale events, keeping full parallelism.',
        '**Priority** queues are a trap at high load: if high-priority traffic saturates workers, low priority starves forever. Prefer separate queues with dedicated (or weighted) worker capacity. **Delay** is cheap in SQS (`DelaySeconds` ≤ 15 min, per-message timers on standard queues); RabbitMQ needs the delayed-message-exchange plugin or TTL + dead-letter tricks; long delays (hours/days) belong in a scheduler or DB table, not a queue.',
      ],
      table: {
        columns: ['Need', 'Mechanism', 'Cost'],
        rows: [
          ['No order', 'Standard queue, many consumers', 'Duplicates + reordering'],
          ['Order per entity', 'FIFO group id / partition key', 'HOL blocking per key'],
          ['Latest state only', 'Version check, drop stale', 'Needs version on every event'],
          ['Priority', 'Separate queues + weighted workers', 'More queues to operate'],
          ['Delay ≤ 15 min', 'SQS DelaySeconds / message timers', 'Fixed delays, no cancel'],
        ],
      },
      insight: 'When an interviewer says "must be processed in order", ask "in order relative to what?" — the answer is almost always per entity, and that turns a single-threaded design into a partitioned one.',
    },
    {
      title: 'Transactional outbox: publishing reliably from a DB write',
      hook: 'The dual write (commit DB, then publish) is the most common source of lost or phantom events.',
      body: [
        'Writing the DB and then publishing to a queue are two separate commits: crash between them and the event is lost; publish first and roll back, and you have announced something that never happened. 2PC across a DB and SQS is not available, and with RabbitMQ it is not worth it.',
        'The outbox pattern writes the event as a row in an `outbox` table in the **same local transaction** as the business change. A relay — a poller using `SELECT … FOR UPDATE SKIP LOCKED`, or CDC (Debezium outbox event router) tailing the WAL — publishes rows and marks/deletes them. Delivery is at-least-once (relay can crash after publish, before marking), so the event carries a stable id for consumer dedup.',
      ],
      code: {
        lang: 'sql',
        caption: 'Polling relay (one of N relays)',
        code: `BEGIN;
INSERT INTO orders(id, status) VALUES (42, 'placed');
INSERT INTO outbox(id, aggregate_id, type, payload)
  VALUES (gen_random_uuid(), 42, 'OrderPlaced', '{...}');
COMMIT;

-- relay loop
WITH batch AS (
  SELECT id FROM outbox WHERE published_at IS NULL
  ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED)
UPDATE outbox o SET published_at = now()
FROM batch WHERE o.id = batch.id
RETURNING o.*;   -- publish these, then COMMIT`,
      },
      diagram: {
        type: 'sequence',
        title: 'Outbox relay',
        actors: ['Service', 'DB', 'Relay', 'Queue'],
        messages: [
          { from: 'Service', to: 'DB', label: 'TX: order + outbox row' },
          { from: 'Relay', to: 'DB', label: 'poll / tail WAL' },
          { from: 'Relay', to: 'Queue', label: 'publish (confirm)' },
          { from: 'Queue', to: 'Relay', label: 'ack', dashed: true },
          { from: 'Relay', to: 'DB', label: 'mark published' },
        ],
      },
      insight: 'A polling relay with multiple instances reorders events unless rows are partitioned by aggregate; and the outbox table needs aggressive cleanup or partitioning, or it becomes the hottest, most bloated table in the database.',
    },
    {
      title: 'Poison messages and the "queue you already have": Redis Streams and Postgres',
      hook: 'Classify errors before retrying, and know when a DB table or Redis is a good enough queue.',
      body: [
        'A **poison message** fails deterministically (unparseable, violates an invariant, triggers a bug). Retrying it is pure waste, and in ordered setups it blocks its key. Classify in the handler: parse/validation/unknown-schema errors are permanent → dead-letter now with the error attached; timeouts, 429s and 5xx are transient → retry with backoff; unknown exceptions → retry a bounded number of times, then dead-letter.',
        '**Redis Streams** make a respectable small queue: `XREADGROUP` leases entries into a per-consumer Pending Entries List, `XACK` clears them, and `XAUTOCLAIM` reassigns entries idle longer than a threshold — the lease model again, but you implement the reaper. Delivery counts come from `XPENDING`. It is bounded by RAM and Redis persistence settings (AOF `everysec` can lose ~1 s on crash).',
        '**Postgres as a queue** (`SELECT … FOR UPDATE SKIP LOCKED`, as used by Que, GoodJob, Oban, river) gives transactional enqueue with the business write — no outbox needed — and is fine to a few thousand jobs/s. Beyond that, dead-tuple churn, vacuum pressure and index bloat on the jobs table become the bottleneck.',
      ],
      code: {
        lang: 'bash',
        caption: 'Redis Streams as a work queue',
        code: `XGROUP CREATE jobs workers $ MKSTREAM
XADD jobs MAXLEN ~ 1000000 * type resize id 42
XREADGROUP GROUP workers w1 COUNT 10 BLOCK 5000 STREAMS jobs >
XACK jobs workers 1732800000000-0
# reaper: steal entries idle > 60s from dead consumers
XAUTOCLAIM jobs workers w2 60000 0-0 COUNT 100
XPENDING jobs workers - + 10      # delivery counts`,
      },
      insight: 'The cheapest reliable queue is often the database you already write to: an enqueue in the same transaction as the business change removes the whole dual-write problem — switch to a broker when throughput or isolation demands it, not by default.',
    },
  ],

  scaling: {
    body: [
      'Consumers scale horizontally for free; the broker is the hard part. SQS hides it entirely: a standard queue scales with no provisioning, and the knobs that remain are batching (10 per call), long polling and the in-flight cap. FIFO throughput scales with distinct message groups.',
      'RabbitMQ scales by **number of queues**, not size of one queue: a cluster spreads queue leaders across nodes, but each queue lives on one leader. Partition hot workloads across queues, keep connection/channel counts sane (thousands of channels per node cost memory), and put independent workloads on separate clusters so a memory alarm in one does not block the other.',
      'Multi-region: queues are regional. Active-active designs run a queue per region with producers writing locally; cross-region replication (Shovel/Federation in RabbitMQ, or SNS→SQS cross-region subscriptions) is asynchronous, so a region loss can lose or duplicate in-flight messages and ordering across regions is not preserved.',
    ],
    bullets: [
      'Data plane (send/receive/ack) must keep working when the control plane (create queue, change policy) is degraded — never create queues on the hot path.',
      'Batch everything: `SendMessageBatch` / `DeleteMessageBatch` cut API calls (and SQS cost) up to 10×.',
      'Quorum queues: 3 replicas tolerate 1 node loss, 5 tolerate 2; more replicas cost publish latency.',
      'Shard RabbitMQ hot queues with the consistent-hash exchange; keep per-key ordering by hashing on the entity id.',
      'Autoscale workers on backlog per worker / age (KEDA `aws-sqs-queue` or `rabbitmq` scalers), capped by downstream capacity.',
      'Bound every queue (max-length, retention, TTL) so failure becomes explicit rejection rather than broker OOM.',
    ],
    diagram: {
      type: 'layers',
      title: 'Planes of a queueing system',
      layers: [
        { name: 'Producers', items: ['outbox relay', 'confirms', 'retry + jitter'], tone: 'neutral' },
        { name: 'Data plane', items: ['send', 'receive / lease', 'ack / DLQ', 'replication'], tone: 'accent' },
        { name: 'Control plane', items: ['queue CRUD', 'policies', 'redrive config'], tone: 'info' },
        { name: 'Consumers', items: ['autoscaled pool', 'idempotent handlers'], tone: 'ok' },
      ],
    },
  },

  failures: [
    {
      name: 'Unbounded backlog → broker memory alarm',
      symptom: 'A consumer stops (bad deploy) and its queue grows to millions; RabbitMQ hits the memory watermark and blocks every publisher on the cluster.',
      detect: '`rabbitmq_queue_messages_ready` growth rate, `rabbitmq_alarms_memory_used_watermark` = 1, consumer count 0 on a queue, producers logging `connection.blocked`.',
      mitigate: '`max-length` + `overflow=reject-publish` or TTL per queue, separate clusters for critical vs bulk, alert on consumers = 0, page on age not just depth.',
    },
    {
      name: 'Visibility timeout shorter than processing',
      symptom: 'Duplicate side effects; receive counts climb; CPU of workers doubles with no traffic increase.',
      detect: 'Ratio of receives to deletes (`NumberOfMessagesReceived` / `NumberOfMessagesDeleted`) > 1.1, `ApproximateReceiveCount` histogram, handler p99 vs visibility timeout.',
      mitigate: 'Timeout ≥ p99.9 job time, heartbeat with `ChangeMessageVisibility`, idempotency keys with unique constraints.',
    },
    {
      name: 'Poison message hot loop',
      symptom: 'One malformed message crashes or nacks-with-requeue continuously, burning a worker and blocking its FIFO group.',
      detect: 'Max `ApproximateReceiveCount`, DLQ depth, a single message id dominating error logs, FIFO group age growing while others drain.',
      mitigate: 'maxReceiveCount / delivery-limit + DLQ; classify permanent errors (schema/parse) and dead-letter them on the first attempt.',
    },
    {
      name: 'Lost messages on publish',
      symptom: 'Orders exist in the DB but downstream never processed them; no errors anywhere.',
      detect: 'Reconciliation job comparing DB rows vs consumer records; publisher confirm nacks/timeouts; unroutable message returns.',
      mitigate: 'Outbox pattern, publisher confirms with retry, `mandatory` flag / alternate exchange, durable queues and persistent messages.',
    },
    {
      name: 'Retry amplification on downstream outage',
      symptom: 'A dependency is down; every message fails and is redelivered immediately, multiplying load and dead-lettering good messages.',
      detect: 'Receive rate ≫ send rate, DLQ inflow spike correlated with a dependency’s error rate.',
      mitigate: 'Backoff via visibility extension or delay queues, circuit breaker that pauses consumption, higher maxReceiveCount for transient errors.',
    },
    {
      name: 'Over-prefetching / in-flight cap',
      symptom: 'Some workers idle while one hoards messages; SQS returns `OverLimit`; messages time out in a slow worker’s buffer.',
      detect: '`ApproximateNumberOfMessagesNotVisible` near the in-flight cap; per-consumer unacked counts in RabbitMQ.',
      mitigate: 'Lower prefetch/batch size, bounded local buffers, fetch only when capacity is free.',
    },
  ],

  warStories: [
    {
      title: 'The weekend the consumer was off',
      source: 'Composite of common incidents',
      what: 'A Friday deploy broke the consumer of a non-critical "audit events" queue on a shared RabbitMQ cluster. With no max-length, the classic queue grew to tens of millions of messages over the weekend; memory crossed the watermark and the broker blocked all publishers. Checkout, which published to a different queue on the same cluster, started timing out on publish — an audit consumer took down payments.',
      lesson: 'Bound every queue, alert on consumer count = 0 and on age, and isolate critical traffic on its own cluster: memory alarms have cluster-wide blast radius.',
    },
    {
      title: 'Duplicate storm from a 30-second visibility timeout',
      source: 'Composite of common incidents',
      what: 'A report-generation job usually took 10 s and the SQS queue kept the default 30 s visibility timeout. A slow database day pushed p99 to 50 s; messages reappeared mid-processing, a second worker started the same report, which slowed the DB further, which caused more timeouts. Workers autoscaled on depth, adding more DB load. Customers received the same report 3–4 times.',
      lesson: 'Visibility timeouts must track tail latency under stress, not normal latency; heartbeat long jobs, make side effects idempotent, and cap autoscaling by downstream capacity.',
    },
    {
      title: 'Requeue hot loop on a poison message',
      source: 'Composite of common incidents',
      what: 'A consumer caught all exceptions and called `basic.nack(requeue=true)`. One message with an unexpected null field was redelivered thousands of times per second, pinning a CPU per consumer and flooding logs, while the rest of the queue barely moved. Classic queues had no delivery limit, so it never stopped.',
      lesson: 'Never requeue blindly: distinguish transient from permanent errors, use quorum queues’ delivery-limit or a retry counter header, and dead-letter permanent failures immediately.',
    },
  ],

  numbers: [
    { label: 'SQS visibility timeout', value: '30 s default, 12 h max', note: 'Extend with ChangeMessageVisibility' },
    { label: 'SQS retention', value: '4 days default, 1 min–14 days' },
    { label: 'SQS long poll / batch', value: '≤ 20 s wait, ≤ 10 msgs per call' },
    { label: 'SQS in-flight cap', value: '~120,000 (standard)', note: 'FIFO historically 20,000' },
    { label: 'SQS FIFO throughput', value: '300 calls/s, 3,000 msg/s batched', note: 'More with high-throughput mode' },
    { label: 'SQS FIFO dedup window', value: '5 minutes' },
    { label: 'SQS delay', value: '0–900 s (15 min)' },
    { label: 'SQS message size', value: '256 KiB (1 MiB since 2025)', note: 'Bigger → S3 claim check' },
    { label: 'RabbitMQ per-queue throughput', value: '~10k–50k msg/s', note: 'One Erlang process per queue' },
    { label: 'RabbitMQ consumer_timeout', value: '30 min default' },
    { label: 'Quorum queue delivery-limit', value: '20 default in 4.0' },
    { label: 'Broker latency (publish → deliverable)', value: '~2–20 ms', note: 'Dominated by replication' },
  ],

  capacity: {
    question: 'An e-commerce site gets 2,000 orders/s at peak for 15 minutes (avg 300/s). Each order triggers a fulfilment job taking 250 ms of mostly I/O. The SLO: 99% of jobs start within 2 minutes. How many worker slots and what queue sizing?',
    steps: [
      'Steady state (Little’s law): concurrency = λ × W = 300/s × 0.25 s = 75 busy slots on average.',
      'Peak if you never want backlog: 2,000/s × 0.25 s = 500 slots — expensive to keep warm, and the downstream may not take 2,000 writes/s.',
      'Allow backlog: with μ slots-worth of drain, backlog after 15 min = (2,000 − μ) × 900. Wait at end of burst = backlog / μ must be ≤ 120 s.',
      'Solve (2,000 − μ) × 900 / μ ≤ 120 → μ ≥ 2,000 × 900 / 1,020 ≈ 1,765/s, i.e. ≈ 441 slots. A 2-minute SLO over a 15-minute burst barely benefits from buffering.',
      'If the SLO were 30 minutes: (2,000 − μ) × 900 / μ ≤ 1,800 → μ ≥ 667/s ≈ 167 slots; peak backlog ≈ 1.2M messages × ~2 KB ≈ 2.4 GB — fine for SQS, needs disk-backed quorum queues on RabbitMQ.',
    ],
    answer: 'Buffering only pays when the SLO is long relative to the burst: for a 2-minute SLO provision ~450 slots (e.g. 30 pods × 16 slots) autoscaled on age; for a 30-minute SLO ~170 slots and a ~1.2M-message backlog is acceptable.',
  },

  comparison: {
    caption: 'Queue-like systems',
    columns: ['Product', 'Model', 'Ordering', 'Retention / replay', 'Scale & limits', 'Pick when'],
    rows: [
      ['Amazon SQS', 'Managed pull queue, leases', 'Best-effort; FIFO per group', '≤ 14 days, deleted on ack, no replay', 'Standard ~unlimited; FIFO per-group bound', 'AWS, zero ops, job queues'],
      ['RabbitMQ', 'Broker push, AMQP routing', 'Per queue, single consumer', 'Deleted on ack (streams aside)', '~10k–50k msg/s per queue', 'Rich routing, priorities, on-prem, low latency'],
      ['Kafka', 'Partitioned log + offsets', 'Per partition', 'Time/size, full replay', 'Millions msg/s; parallelism ≤ partitions', 'Event streams, replay, many consumer groups'],
      ['Redis Streams', 'In-memory log + consumer groups', 'Per stream', 'Trim by MAXLEN/MINID', 'Bounded by RAM, one shard per stream', 'Low-latency, small volume, already on Redis'],
      ['Google Pub/Sub', 'Topic + pull/push subscriptions', 'Per ordering key (opt-in)', '≤ 7 days unacked; seek replay', 'Global, autoscaling', 'GCP fan-out + work distribution'],
    ],
  },

  whenNot: [
    'The caller needs the result to continue (request/response): use a synchronous RPC with timeouts; a queue adds latency and a correlation-id dance.',
    'Many independent consumers must each see every event, or you need replay: use a log (Kafka/Kinesis) or pub/sub, not a work queue.',
    'Jobs scheduled hours or days ahead, cancellable or editable: use a scheduler or a DB table with an indexed `run_at` (or Temporal), not delay queues.',
    'Strict global ordering at high throughput: no queue gives you both; redesign around per-key ordering or versioned updates.',
    'Tiny, in-process background work where losing it on crash is fine: an in-memory channel/executor is simpler than a broker.',
  ],

  interview: [
    {
      q: 'Walk me through what happens when a consumer crashes halfway through processing an SQS message.',
      a: 'The message was leased with a visibility timeout when received; no `DeleteMessage` arrives, so when the timeout expires the message becomes visible again with `ApproximateReceiveCount` incremented. Another worker receives it and reprocesses from the start. Any side effects the first worker committed will run twice unless the handler is idempotent, e.g. a unique idempotency key written in the same transaction as the effect and passed to external APIs. After `maxReceiveCount` failures the redrive policy moves it to the DLQ.',
      followUps: ['What if the first worker was not dead, just slow?', 'How do you choose the visibility timeout for jobs between 1 s and 10 min?', 'How does RabbitMQ differ when the connection drops?'],
      seniorSignal: 'Distinguishes concurrent duplicates (lease expiry while still running) from sequential ones (lost ack) and designs idempotency that survives both.',
    },
    {
      q: 'SQS FIFO vs standard: when and how would you use FIFO?',
      a: 'Use FIFO only when a specific entity needs ordered processing or producer-retry dedup, e.g. state transitions of one order. Ordering is per `MessageGroupId`, and only one message per group is in flight, so throughput scales with the number of active groups and a failing message blocks its group until it is dead-lettered. Dedup is only a 5-minute producer-side window. I would pick group id = entity id, keep handlers fast, set a DLQ, and otherwise prefer a standard queue with versioned, idempotent updates.',
      followUps: ['What happens to ordering when a message goes to the DLQ?', 'Why not make the whole queue one group?', 'How does high-throughput FIFO partition?'],
      seniorSignal: 'Frames FIFO as per-key serialization with head-of-line blocking, and often argues for standard + versioning instead.',
    },
    {
      q: 'How do you reliably publish a message when a DB row changes?',
      a: 'Avoid the dual write. Use a transactional outbox: insert the event into an outbox table in the same transaction as the business change, then a relay publishes it — either polling with `FOR UPDATE SKIP LOCKED` or CDC (Debezium outbox event router) tailing the WAL. Publishing uses confirms and the outbox row is marked after the ack, which gives at-least-once delivery with a stable event id for consumer dedup. Ordering per aggregate requires partitioning the relay or the topic by aggregate id.',
      followUps: ['Polling relay vs CDC — trade-offs?', 'How do you keep the outbox table from bloating?', 'What happens if the relay publishes then crashes before marking?'],
      seniorSignal: 'Names the failure windows explicitly (crash between commit and publish, publish and mark) and the ordering/cleanup consequences.',
    },
    {
      q: 'Your queue’s backlog is growing. How do you diagnose and respond?',
      a: 'First decide whether arrival rate rose or drain rate fell: compare send rate vs delete rate and look at handler latency, error rate and receive-count distribution. If handlers got slower, the culprit is usually a downstream dependency — adding workers makes it worse, so shed or pause instead. If arrivals spiked, scale workers up to the downstream’s safe limit and let the queue absorb the rest, watching age of oldest message against the SLO. Poison messages show up as high receive counts and DLQ inflow.',
      followUps: ['Which single metric would you page on?', 'How do you prevent autoscaling from melting the DB?', 'When would you drop messages deliberately?'],
      seniorSignal: 'Pages on age (SLO) not depth, and recognises that scaling consumers against a slow dependency is a positive feedback loop.',
    },
    {
      q: 'RabbitMQ vs SQS vs Kafka for a job-processing system — how do you choose?',
      a: 'SQS if on AWS and the jobs are independent: zero ops, near-infinite scale, leases and DLQs built in, but no routing, priority or replay. RabbitMQ when you need broker-side routing (topic exchanges), priorities, sub-ms latency, or on-prem — accepting that each queue is a single-core bottleneck and that memory alarms block publishers. Kafka is a log: great when multiple consumers need the same events and replay matters, poor for per-message acks, priorities and slow uneven jobs because one slow record blocks its partition (share groups are changing this).',
      followUps: ['How do you get priorities in SQS?', 'How would you scale a hot RabbitMQ queue?', 'When is Kafka as a queue acceptable?'],
      seniorSignal: 'Ties the choice to concrete mechanisms (per-queue process, per-partition HOL blocking, lease model) rather than popularity.',
    },
    {
      q: 'How would you implement retries with exponential backoff on SQS?',
      a: 'SQS has no native per-attempt backoff, so on a transient failure the worker calls `ChangeMessageVisibility` with a delay computed from `ApproximateReceiveCount` (e.g. min(2^n × base, 12 h) plus jitter) instead of letting the default timeout apply. Permanent errors are sent to the DLQ immediately or deleted with logging. A redrive policy with a sane `maxReceiveCount` bounds total attempts. For long delays a separate delay queue or a scheduler is cleaner.',
      followUps: ['Why add jitter?', 'How would you pause consumption entirely during a dependency outage?', 'How does Lambda’s partial batch response interact with this?'],
      seniorSignal: 'Uses visibility as the backoff mechanism and separates transient vs permanent error handling, bounding total attempts.',
    },
    {
      q: 'Design the async path for "user uploads a video, we transcode it". Where does the queue fit and what can go wrong?',
      a: 'The upload goes straight to object storage via a pre-signed URL; the S3 event (or an outbox row) enqueues a transcode job keyed by video id, and the API returns "processing". Workers lease jobs with a visibility timeout plus heartbeats because transcodes take minutes, write output idempotently to a deterministic path, then update the video row conditionally and ack. Status is pushed or polled by the client. Risks: lease expiry causing parallel transcodes, poison inputs (corrupt files) looping, backlog during viral spikes — handled with heartbeats, error classification to a DLQ, and autoscaling on backlog age with a cost cap.',
      followUps: ['How does the client learn the job finished?', 'How do you prioritise paying users?', 'What if a transcode takes 3 hours?'],
      seniorSignal: 'Keeps large payloads out of the queue (claim check), makes outputs deterministic for idempotency, and addresses long-job leases explicitly.',
    },
  ],

  takeaways: [
    'A queue turns overload into latency — alert on age of oldest message, not just depth.',
    'Delivery is a lease: lease expiry and lost acks both cause duplicates, so handlers must be idempotent under concurrency.',
    'Ordering is per key (FIFO group, partition, single consumer) and costs parallelism and head-of-line blocking.',
    'RabbitMQ scales by number of queues; one queue is one Erlang process, and memory alarms block all publishers.',
    'Quorum queues (Raft) replaced mirrored queues; use publisher confirms or you do not know a message was stored.',
    'Use the transactional outbox instead of dual writes to publish on DB changes.',
    'Size workers with Little’s law and the age SLO, capped by what the downstream can absorb.',
  ],
};

export default deep;
