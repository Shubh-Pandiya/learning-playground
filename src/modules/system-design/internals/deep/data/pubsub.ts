import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'pubsub',

  problem: {
    why: 'Pub/sub lets a publisher announce "this happened" once while any number of subscribers each receive their own copy. It removes the publisher’s knowledge of who consumes, so adding the fifth consumer of `UserSignedUp` is a config change in the subscriber, not a code change in the user service. Each subscription is effectively its own queue with its own acks, backlog and retries.',
    withoutIt: [
      'The publisher calls every consumer synchronously; one slow or down consumer slows or fails the publisher’s request.',
      'Every new consumer requires a change and a deploy of the producer — the producer team becomes a bottleneck.',
      'Retry logic for N consumers lives inside the producer, mixing its business logic with delivery bookkeeping.',
      'Broadcasting ephemeral signals (cache invalidation hints, presence) across a fleet of servers needs ad-hoc gossip.',
    ],
    position: 'Downstream of a service (or outbox/CDC relay) that publishes domain events, upstream of several independent subscribers — each typically buffered by its own subscription or queue before its workers.',
    diagram: {
      type: 'flow',
      title: 'Publish once, deliver N times',
      nodes: [
        { label: 'User service', sub: 'publishes UserSignedUp', tone: 'neutral' },
        { label: 'Topic', sub: 'durable, multi-zone', tone: 'accent' },
        { label: 'Email sub', sub: 'push, own retries', tone: 'ok' },
        { label: 'Analytics sub', sub: 'pull, 2M backlog', tone: 'warn' },
        { label: 'CRM sub', sub: 'filtered: plan=pro', tone: 'info' },
      ],
      caption: 'A slow subscription accumulates its own backlog; others are unaffected.',
    },
  },

  architecture: {
    overview: 'A pub/sub service is a topic store plus a fan-out engine that materialises one logical backlog per subscription. Each message is persisted once, then tracked per subscription with its own ack state, delivery attempts and deadline. Filters are evaluated broker-side before delivery. Delivery is push (broker calls your endpoint) or pull (you lease messages). Durable services (SNS, Google Pub/Sub, EventBridge) persist before acking the publisher; Redis pub/sub keeps nothing.',
    diagram: {
      type: 'flow',
      title: 'Inside a durable pub/sub service',
      nodes: [
        { label: 'Publish API', sub: 'batch, attrs, id', tone: 'neutral' },
        { label: 'Topic storage', sub: 'replicated before ack', tone: 'accent' },
        { label: 'Filter engine', sub: 'attribute/body match', tone: 'info' },
        { label: 'Per-sub backlog', sub: 'ack state per sub', tone: 'accent' },
        { label: 'Dispatcher', sub: 'push POST / pull lease', tone: 'ok' },
        { label: 'Retry + DLQ', sub: 'backoff, dead-letter', tone: 'warn' },
      ],
    },
    blocks: [
      { name: 'Topic', what: 'Named channel; messages carry an id, payload and attributes (key/value metadata used for routing and filtering).' },
      { name: 'Subscription', what: 'A durable cursor/backlog bound to one topic: own ack deadline, retention, filter, retry and dead-letter policy. Competing consumers can share one subscription.' },
      { name: 'Filter policy', what: 'Broker-side predicate (SNS filter policy on attributes or body; Google filter expression on attributes; EventBridge rule patterns). Non-matching messages are never delivered to that subscription.' },
      { name: 'Push dispatcher', what: 'Broker POSTs to HTTPS/Lambda/Cloud Run; 2xx = ack, otherwise retry with backoff. The broker controls rate, so it needs flow control against the endpoint.' },
      { name: 'Pull / streaming pull', what: 'Subscriber leases batches; client libraries extend ack deadlines automatically and enforce flow control (max outstanding messages/bytes).' },
      { name: 'Ordering keys', what: 'Opt-in per-key ordering (Google ordering keys, SNS FIFO message group ids): messages with the same key are delivered in publish order, one outstanding at a time.' },
      { name: 'Schema registry', what: 'Versioned contracts for payloads (Confluent Schema Registry, Google Pub/Sub schemas, AWS Glue/EventBridge registries) with compatibility checks at publish or CI time.' },
    ],
    real: [
      { name: 'Amazon SNS (+ SQS)', how: 'Topics fan out to SQS, Lambda, HTTPS, email/SMS; filter policies on attributes or message body. Canonical pattern: SNS → one SQS queue per consumer service, giving each its own buffer, retries and DLQ. SNS FIFO topics pair with SQS FIFO queues for ordered fan-out.' },
      { name: 'Google Cloud Pub/Sub', how: 'Global service; publishes are persisted to multiple zones before the id is returned. Subscriptions are pull, streaming pull, push, or direct BigQuery/Cloud Storage writes; ack deadlines 10–600 s, ordering keys, filters, dead-letter topics, seek to timestamp, and optional exactly-once delivery for pull subscriptions.' },
      { name: 'Redis pub/sub', how: 'An in-memory map channel → subscribed client sockets. `PUBLISH` writes into each subscriber’s output buffer and returns the receiver count; no persistence, no acks, no replay. Redis 7 sharded pub/sub (`SPUBLISH`) avoids broadcasting every message across the whole cluster bus.' },
      { name: 'Amazon EventBridge', how: 'Event bus with content-based rules routing to 20+ target types, schema discovery, archive and replay; retries a failed target for up to 24 hours (185 attempts by default) before dead-lettering.' },
      { name: 'Kafka as pub/sub', how: 'Each consumer group is a subscription over the same retained log; ordering per partition and long replay, but no per-message ack, filtering or push without extra components.' },
    ],
  },

  lifecycle: {
    summary: 'One `UserSignedUp` event through a managed pub/sub service to a push subscriber and a pull subscriber. Broker latency is tens of ms; the variance is in subscriber processing and retries.',
    stages: [
      { stage: 'Client batching', what: 'Publisher library batches messages by count/bytes/latency threshold.', cost: 'Deliberate few-ms delay.', ms: 5 },
      { stage: 'Publish RPC', what: 'gRPC/HTTPS publish to the nearest front end.', cost: '1 RTT.', ms: 2 },
      { stage: 'Persist multi-zone', what: 'Stored in several zones; message id returned to publisher.', cost: 'Cross-zone replication.', ms: 15 },
      { stage: 'Fan-out + filter', what: 'Message recorded in each matching subscription’s backlog; filters evaluated.', cost: 'Per-subscription bookkeeping.', ms: 5 },
      { stage: 'Deliver (push or pull)', what: 'Push: HTTPS POST to endpoint. Pull: returned to an outstanding streaming pull; ack deadline starts.', cost: '1 RTT + endpoint queueing.', ms: 20 },
      { stage: 'Subscriber processing', what: 'Handler dedups by message/event id and applies the effect.', cost: 'Your code.', ms: 40 },
      { stage: 'Ack', what: 'Push: 2xx response. Pull: ack RPC (batched by client library).', cost: 'Batched, async.', ms: 2 },
    ],
  },

  deepDives: [
    {
      title: 'Fan-out models: push vs pull, SNS→SQS, Redis fire-and-forget',
      hook: 'Who controls the delivery rate decides who falls over during a spike.',
      body: [
        '**Push** (SNS to HTTPS/Lambda, Google push subscriptions, EventBridge targets) gives the lowest latency and no polling, but the broker sets the pace: a burst of publishes becomes a burst of POSTs. Brokers back off on errors (Google push uses slow-start style flow control on failures), yet your endpoint still sees the spike first.',
        '**Pull** puts the subscriber in charge: it leases what it can handle, flow control caps outstanding messages, and backlog accumulates in the broker instead of in your service. That is why SNS → SQS per consumer is the AWS default: SNS does fan-out, each SQS queue does buffering, retries and DLQ for exactly one consumer.',
        '**Redis pub/sub** is fire-and-forget: if a subscriber is disconnected for one second, it misses that second forever. A subscriber that reads slowly fills its output buffer until `client-output-buffer-limit pubsub` (default 32mb hard, 8mb for 60 s) disconnects it. Use Redis Streams with consumer groups when delivery matters.',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Push', tone: 'warn', points: ['Broker sets the rate', 'Endpoint must absorb bursts', 'Great for serverless', 'Retry via broker backoff'] },
          { name: 'Pull', tone: 'ok', points: ['Subscriber sets the rate', 'Backlog stays in broker', 'Flow control + batching', 'Needs long-running workers'] },
          { name: 'Fire-and-forget', tone: 'bad', points: ['No storage, no ack', 'Offline = missed forever', 'Sub-ms fan-out', 'Hints and presence only'] },
        ],
      },
      insight: 'Push is fine when the subscriber is elastic (Lambda, Cloud Run) and has its own concurrency cap; for anything backed by a fixed-size DB, insert a queue or use pull so the backlog lives in the broker, not in your connection pool.',
    },
    {
      title: 'Filtering and ordering keys',
      hook: 'Broker-side filtering saves money; ordering keys cost throughput and add head-of-line blocking.',
      body: [
        'Without filtering, every subscriber receives every message and discards most of them — paying delivery, compute and egress for nothing. SNS filter policies (on attributes, or on the JSON body with `FilterPolicyScope=MessageBody`) and Google subscription filters (on attributes, immutable once created) drop non-matching messages before delivery. Filters need routing data in attributes, so put event type, tenant tier and region in attributes, not only in the body.',
        'Ordering is opt-in and per key. In Google Pub/Sub, messages with the same `ordering_key` published in the same region are delivered in order to subscriptions with message ordering enabled; if a publish for a key fails, the client pauses that key until you call `resumePublish`, otherwise later messages could overtake. SNS FIFO topics use message group ids into SQS FIFO queues. Both serialize per key: one outstanding message per key per subscription.',
      ],
      code: {
        lang: 'json',
        caption: 'SNS filter policy (attribute scope)',
        code: `{
  "eventType": ["OrderPlaced", "OrderRefunded"],
  "region": [{ "prefix": "eu-" }],
  "amount": [{ "numeric": [">=", 1000] }],
  "tier": [{ "anything-but": ["free"] }]
}`,
      },
      insight: 'Ordering keys interact badly with redelivery: a message that keeps failing for key K blocks all later messages for K until it is acked or dead-lettered — pair ordering with a dead-letter topic and fast failure classification.',
    },
    {
      title: 'Delivery semantics: ack deadlines, duplicates and dedup',
      hook: 'Every durable pub/sub is at-least-once by default; design subscribers accordingly.',
      body: [
        'In Google Pub/Sub, a pulled message is leased for the subscription’s ack deadline (10 s default, up to 600 s). Client libraries extend leases automatically while your callback runs (up to a max extension), so the real risk is a process that freezes or exceeds that extension. Unacked messages are redelivered, possibly to another subscriber instance, and can be redelivered even after an ack in rare cases.',
        'Google offers **exactly-once delivery** for pull subscriptions within a region: acks return success or failure, and a successfully acked message is not redelivered. It does not make your side effect exactly-once — a crash after the effect but before the ack still redelivers. SNS FIFO / SQS FIFO dedup within a 5-minute window. Everything else: dedup in the subscriber on a stable event id (a unique constraint, or a Redis `SET NX` with TTL longer than the redelivery horizon).',
      ],
      diagram: {
        type: 'sequence',
        title: 'Redelivery after a missed ack deadline',
        actors: ['Topic', 'Sub A1', 'Sub A2', 'DB'],
        messages: [
          { from: 'Topic', to: 'Sub A1', label: 'msg 77 (deadline 10s)' },
          { from: 'Sub A1', to: 'DB', label: 'insert effect (event 77)' },
          { from: 'Sub A1', to: 'Sub A1', label: 'GC pause 30s', tone: 'warn' },
          { from: 'Topic', to: 'Sub A2', label: 'redeliver msg 77' },
          { from: 'Sub A2', to: 'DB', label: 'insert → unique violation', tone: 'ok' },
          { from: 'Sub A2', to: 'Topic', label: 'ack (dup handled)', dashed: true },
        ],
      },
      insight: 'The dedup key must be the publisher’s event id, not the broker’s message id: a publisher retry after a timeout creates a new broker message id for the same logical event.',
    },
    {
      title: 'Slow subscriber isolation and fan-out amplification',
      hook: 'Isolation is per subscription — but storage, cost and the publisher’s write path are shared.',
      body: [
        'A durable pub/sub isolates subscribers: analytics being 2M messages behind does not slow email. The backlog is bounded by subscription retention (Google: up to 7 days of unacked messages; SQS: up to 14 days) — beyond that, messages expire silently. Alert on oldest unacked message age per subscription, not on the topic.',
        'Cost and load scale with deliveries = publish rate × matching subscriptions. 20k events/s fanned out to 25 subscriptions is 500k deliveries/s, plus retries. Filtering, consolidating tiny subscribers, or moving very high fan-out to a shared log (each consumer group reads the same bytes once) changes the economics.',
        'In Redis, isolation does not exist: `PUBLISH` writes to every subscriber’s buffer synchronously in the event loop, so many subscribers × large messages raise latency for every other Redis command, and one slow reader is disconnected and loses data.',
      ],
      diagram: {
        type: 'flow',
        title: 'Amplification',
        nodes: [
          { label: '20k pub/s', sub: '2 KB events', tone: 'neutral' },
          { label: '× 25 subs', sub: 'no filters', tone: 'warn' },
          { label: '500k deliv/s', sub: '~1 GB/s egress', tone: 'bad' },
          { label: 'Filters → 6 subs', sub: '120k deliv/s', tone: 'ok' },
        ],
      },
      insight: 'High-fan-out pub/sub to dozens of internal consumers is usually cheaper and simpler as a log (Kafka) where consumers read shared storage, keeping managed pub/sub for low-volume, push-to-endpoint integrations.',
    },
    {
      title: 'Schema evolution and event contracts',
      hook: 'An event is a public API with unknown callers — break it and you break teams you have never met.',
      body: [
        'Subscribers are invisible to publishers, so a renamed field can break a consumer nobody remembers. Treat events like APIs: version them, register schemas (Avro/Protobuf/JSON Schema), and enforce compatibility in CI and at publish. Confluent Schema Registry’s default is BACKWARD (new consumers can read old data); FULL_TRANSITIVE is the safest for long-retained topics.',
        'Practical rules: only add optional fields with defaults; never reuse or repurpose field names/tags; deprecate before removing; for breaking changes, publish a new event type or topic (v2) in parallel and migrate consumers. Use a standard envelope (CloudEvents: id, source, type, time, subject) so dedup, tracing and routing are uniform.',
      ],
      table: {
        caption: 'Compatibility modes (Confluent Schema Registry)',
        columns: ['Mode', 'Guarantee', 'Allowed change', 'Upgrade order'],
        rows: [
          ['BACKWARD', 'New schema reads previous data', 'Delete fields, add optional fields', 'Consumers first'],
          ['FORWARD', 'Previous schema reads new data', 'Add fields, delete optional fields', 'Producers first'],
          ['FULL', 'Both directions', 'Add/delete optional fields only', 'Any order'],
          ['*_TRANSITIVE', 'Against all versions, not just last', 'Same, stricter', 'Needed for long retention / replay'],
        ],
      },
      insight: 'Event-carried state transfer (fat events with full entity state) reduces callbacks to the publisher but turns every field into a contract; thin notification events keep contracts small but create synchronous read-back load — choose per event deliberately.',
    },
    {
      title: 'Event-driven pitfalls: storms, cycles, hidden coupling',
      hook: 'Loose coupling at compile time can be tight coupling at run time.',
      body: [
        '**Cycles**: service A consumes `ProfileUpdated` and normalises the profile, emitting another `ProfileUpdated`; B does the same; they ping-pong forever. **Storms**: a bulk backfill publishes 50M events and every subscriber autoscales against shared databases. **Hidden coupling**: a subscriber depends on event order or on a field’s semantics that the publisher never promised.',
        'Defences: emit events only on actual state change (compare before/after); carry `causation_id` and `correlation_id` and drop events caused by yourself; cap hop counts; mark bulk/backfill traffic with an attribute and route it to separate, rate-limited subscriptions; maintain an event catalog (AsyncAPI, schema registry metadata) listing owners and consumers; trace across async hops with OpenTelemetry context in attributes.',
      ],
      diagram: {
        type: 'sequence',
        title: 'A cyclic event loop',
        actors: ['Profile svc', 'Topic', 'Enricher'],
        messages: [
          { from: 'Profile svc', to: 'Topic', label: 'ProfileUpdated v1' },
          { from: 'Topic', to: 'Enricher', label: 'deliver' },
          { from: 'Enricher', to: 'Profile svc', label: 'PATCH normalized email' },
          { from: 'Profile svc', to: 'Topic', label: 'ProfileUpdated v2', tone: 'warn' },
          { from: 'Topic', to: 'Enricher', label: 'deliver again', tone: 'bad' },
          { from: 'Enricher', to: 'Enricher', label: 'no-op: unchanged → stop', tone: 'ok' },
        ],
      },
      insight: 'Idempotent, change-detecting handlers break most cycles for free; the ones that remain are usually two services each "correcting" the same field differently — a sign of unclear data ownership, not a messaging bug.',
    },
    {
      title: 'Choreography vs orchestration',
      hook: 'Pub/sub choreography scales teams; orchestration makes multi-step business flows debuggable.',
      body: [
        'In **choreography**, each service reacts to events and emits new ones (OrderPlaced → PaymentCaptured → InventoryReserved → OrderShipped). No central coordinator, easy to add listeners, but the end-to-end flow exists only implicitly across N codebases; answering "why is order 42 stuck?" requires distributed tracing and event archaeology, and compensation logic is scattered.',
        'In **orchestration**, a workflow engine (Temporal, AWS Step Functions, Camunda) owns the saga: it calls steps, persists state, retries with timeouts and runs compensations. The flow is explicit and observable, at the cost of a central component and coupling to it. A common split: orchestrate within a bounded context (checkout saga), choreograph between contexts via published domain events.',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Choreography', tone: 'info', points: ['Services react to events', 'No single owner of flow', 'Easy to add consumers', 'Hard to see stuck flows'] },
          { name: 'Orchestration', tone: 'violet', points: ['Engine drives the steps', 'Explicit state + timeouts', 'Compensations in one place', 'Central dependency'] },
        ],
      },
      insight: 'If a flow has more than ~3 steps with compensations or deadlines ("cancel if not paid in 30 min"), choreography tends to reinvent a workflow engine badly; reach for orchestration and publish events at the boundaries.',
    },
  ],

  scaling: {
    body: [
      'Managed pub/sub services scale publish and fan-out horizontally with no partitions to plan; limits show up as per-topic/per-subscription quotas, message size (SNS 256 KiB, Google 10 MB), and cost per delivery. The scaling problem moves to subscribers: each subscription needs enough consumer capacity, and push endpoints need concurrency caps.',
      'The data plane (publish, deliver, ack) is regional or global and keeps working when the control plane (create subscription, change filters) is impaired — never create subscriptions dynamically on the request path. Google Pub/Sub is a global service with regional storage controls; SNS/SQS are regional, so multi-region designs publish locally and use cross-region subscriptions or replication.',
      'Redis pub/sub scales poorly in Redis Cluster: classic `PUBLISH` is broadcast to every node over the cluster bus. Redis 7 sharded pub/sub routes a channel to its slot’s shard, but you still have no durability, so use it only for ephemeral fan-out like WebSocket server broadcast.',
    ],
    bullets: [
      'Deliveries = publish rate × subscriptions: budget broker cost and subscriber capacity on that product.',
      'Give every critical subscriber its own queue/subscription, DLQ and age alarm.',
      'Cap push concurrency (Lambda reserved concurrency, Cloud Run max instances) so fan-out cannot exhaust a DB.',
      'Multi-region: publish to the local region; replicate via cross-region subscriptions; dedup by event id because failover duplicates.',
      'Put routing data (type, tenant, region) in attributes so filtering stays broker-side.',
      'Separate bulk/backfill topics or attributes from live traffic to prevent event storms.',
    ],
  },

  failures: [
    {
      name: 'Silent loss on ephemeral pub/sub',
      symptom: 'After a deploy or network blip, some servers keep serving stale cache entries; no errors anywhere.',
      detect: 'Compare `PUBLISH` return value (receiver count) to expected subscribers; Redis `client_recent_max_output_buffer`, disconnects from output buffer limits; stale-read sampling.',
      mitigate: 'Use durable delivery for anything that matters (Streams, SNS+SQS); keep TTLs as a safety net for invalidation hints; resync on reconnect.',
    },
    {
      name: 'Push endpoint meltdown',
      symptom: 'A publish spike hits a webhook; it returns 5xx; broker retries add more load; the subscriber stays down.',
      detect: 'Push error rate and latency per subscription, broker retry/backlog metrics (`subscription/push_request_count` by response class), endpoint saturation.',
      mitigate: 'Insert a queue (SNS→SQS) or switch to pull; cap concurrency; return 429/503 quickly so the broker backs off.',
    },
    {
      name: 'Backlog expiry',
      symptom: 'A subscriber was broken for 8 days; when fixed, the oldest messages have already been deleted.',
      detect: '`subscription/oldest_unacked_message_age` (Google) / `ApproximateAgeOfOldestMessage` (SQS) vs retention; alert at 50% of retention.',
      mitigate: 'Longer retention for critical subscriptions, topic retention + seek for replay, dead-letter topics, and an owner on call for each subscription.',
    },
    {
      name: 'Breaking schema change',
      symptom: 'A publisher renames a field; one subscriber starts failing deserialization and dead-letters everything.',
      detect: 'Deserialization error rate per subscriber, DLQ inflow by error type, schema registry compatibility check failures in CI.',
      mitigate: 'Schema registry with enforced compatibility, additive changes only, v2 topics for breaking changes, consumer-driven contract tests.',
    },
    {
      name: 'Event storm / cycle',
      symptom: 'Publish rate on a topic jumps 100× with no user traffic change; downstream DBs saturate.',
      detect: 'Publish rate anomaly alerts per topic, high ratio of events with the same correlation id, hop-count histogram.',
      mitigate: 'Emit on real change only, causation ids, hop limits, rate-limited backfill paths, kill switch per subscription.',
    },
  ],

  warStories: [
    {
      title: 'Invalidation hints lost during a Redis failover',
      source: 'Composite of common incidents',
      what: 'A fleet of API servers kept an in-process cache invalidated via Redis pub/sub messages. During a Redis primary failover the subscribers reconnected a few seconds later; invalidations published in that gap were simply gone. Prices changed in the DB but some servers served old prices for hours because cache TTLs were set to 24 h.',
      lesson: 'Fire-and-forget pub/sub must be backed by a correctness mechanism: short TTLs, version checks, or a full cache flush/resync on reconnect.',
    },
    {
      title: 'The profile ping-pong',
      source: 'Composite of common incidents',
      what: 'Two services each consumed `UserUpdated` and "normalised" the phone number format differently, writing back and emitting another `UserUpdated`. Each event triggered the other service. Within an hour the topic carried millions of events for a few thousand users, and downstream search indexing fell days behind.',
      lesson: 'Single ownership of each field, change detection before emitting, and causation ids that let a service ignore events it caused.',
    },
    {
      title: 'Webhook fan-out takes down the subscriber’s database',
      source: 'Composite of common incidents',
      what: 'A marketing import published 3M `ContactCreated` events in minutes to a push subscription backed by an autoscaling container service. It scaled to hundreds of instances, each opening DB connections, until the database hit max connections and every service using it went down.',
      lesson: 'Push + autoscaling needs a concurrency cap tied to the downstream; bulk traffic should go through a queue or a rate-limited path.',
    },
  ],

  numbers: [
    { label: 'Deliveries', value: 'publish rate × matching subs', note: 'The real cost driver' },
    { label: 'SNS message size', value: '256 KiB', note: 'Larger via S3 claim check' },
    { label: 'SNS subscriptions per topic', value: 'up to 12.5M (standard)' },
    { label: 'Google Pub/Sub message size', value: '10 MB' },
    { label: 'Google ack deadline', value: '10 s default, 10–600 s' },
    { label: 'Google unacked retention', value: 'up to 7 days', note: 'Topic retention up to 31 days' },
    { label: 'Google dead-letter attempts', value: '5–100 (default 5)' },
    { label: 'EventBridge target retries', value: 'up to 24 h, 185 attempts' },
    { label: 'Redis pubsub buffer limit', value: '32mb hard / 8mb for 60 s', note: 'Then subscriber disconnected' },
    { label: 'Managed pub/sub latency', value: '~tens to ~100 ms', note: 'Redis pub/sub sub-ms' },
  ],

  capacity: {
    question: 'A marketplace publishes 8k events/s at peak (avg 2 KB) to a topic with 12 subscriptions; 4 subscribers filter to ~10% of traffic, the rest take everything. One analytics subscriber may be down for up to 3 days. What are delivery rate, egress and backlog?',
    steps: [
      'Unfiltered subscriptions: 8 × 8k = 64k deliveries/s. Filtered: 4 × 0.8k = 3.2k/s. Total ≈ 67k deliveries/s (plus retries).',
      'Egress: 67k × 2 KB ≈ 134 MB/s ≈ 11.6 TB/day of delivered bytes.',
      'Analytics backlog for 3 days at average 3k/s: 3k × 259,200 ≈ 780M messages ≈ 1.5 TB.',
      'Retention check: 3 days < 7-day Google subscription retention (or SQS 14 days), so no loss — with an alert at 50% of retention.',
      'Catch-up: to drain 780M while live traffic continues at 3k/s within 12 h, analytics needs ≈ 3k + 780M / 43,200 ≈ 21k msg/s of consumer capacity.',
    ],
    answer: '≈ 67k deliveries/s and ~134 MB/s egress at peak; a 3-day outage leaves ~780M messages (~1.5 TB) and needs ~7× normal consumer capacity to catch up in 12 h — consider a log (Kafka) for analytics instead.',
  },

  comparison: {
    caption: 'Fan-out systems',
    columns: ['Product', 'Delivery', 'Durability / replay', 'Ordering', 'Filtering', 'Best for'],
    rows: [
      ['SNS (+ SQS)', 'Push to SQS/Lambda/HTTP', 'Durable; replay via SQS only (FIFO archive aside)', 'FIFO topics per group', 'Attribute or body policies', 'AWS service fan-out'],
      ['Google Pub/Sub', 'Push, pull, streaming pull', 'Durable; seek to time/snapshot', 'Ordering keys (opt-in)', 'Attribute filters', 'GCP fan-out + work queues'],
      ['EventBridge', 'Rules → targets', 'Durable; archive + replay', 'None', 'Rich content patterns', 'SaaS/AWS event routing, low volume'],
      ['Kafka', 'Pull per consumer group', 'Retained log, full replay', 'Per partition', 'Client-side', 'High-volume fan-out, many consumers'],
      ['Redis pub/sub', 'Push to connected sockets', 'None', 'Per connection', 'Channel / pattern only', 'Ephemeral broadcast, presence'],
    ],
  },

  whenNot: [
    'The publisher needs a response or must know the work succeeded: use RPC or an orchestrated workflow.',
    'Exactly one worker should do each task: use a queue (or a single subscription with competing consumers), not N subscriptions.',
    'Very high volume with many internal consumers and replay needs: use a log (Kafka/Kinesis).',
    'Messages that must not be lost: never Redis pub/sub — use a durable broker or Redis Streams.',
    'Multi-step business processes with deadlines and compensation: orchestrate (Temporal, Step Functions) and publish events at the edges.',
  ],

  interview: [
    {
      q: 'How do you fan out an "order placed" event reliably to five services?',
      a: 'Publish once to a durable topic via a transactional outbox so the DB write and the event cannot diverge. Each service gets its own subscription or SNS→SQS queue with its own retries, dead-letter queue and age alarm, so one slow consumer cannot affect the others. Handlers dedup on the publisher’s event id because delivery is at-least-once. Payloads are schema-registered with backward compatibility, and correlation ids flow through for tracing.',
      followUps: ['Why a queue per service instead of push to each?', 'What if one service needs events from last month?', 'How do you add a sixth consumer that needs history?'],
      seniorSignal: 'Covers the producer-side atomicity (outbox), per-consumer isolation and contracts, not just "use SNS".',
    },
    {
      q: 'Push or pull subscriptions — how do you decide?',
      a: 'Push when the subscriber is elastic and latency matters — Lambda, Cloud Run — with an explicit concurrency cap, and when running pollers is overhead. Pull when the subscriber has fixed capacity or a fragile downstream, because it controls its rate and the backlog stays in the broker. For high throughput, streaming pull with flow control gives the best batching. I default to pull or an intermediate queue for anything touching a database.',
      followUps: ['What happens to push during a subscriber outage?', 'How do you authenticate push requests?', 'How does flow control work in streaming pull?'],
      seniorSignal: 'Frames the choice as "who controls the rate and where does backlog live".',
    },
    {
      q: 'How do you guarantee ordering in pub/sub?',
      a: 'Only per key: Google ordering keys or SNS FIFO message groups deliver same-key messages in publish order, one outstanding at a time per subscription. That costs throughput per key and introduces head-of-line blocking — a failing message blocks its key until dead-lettered. The publisher must also publish in order (pause the key on publish failure). Often better: version each event and have consumers apply only newer versions, so order does not matter.',
      followUps: ['What breaks ordering on the publisher side?', 'How does a DLQ interact with ordering?', 'How would you order across regions?'],
      seniorSignal: 'Prefers version-based idempotent updates over relying on broker ordering where possible.',
    },
    {
      q: 'Choreography or orchestration for an order-fulfilment saga?',
      a: 'For a flow with payment, inventory, shipping and compensations plus timeouts, I would orchestrate inside the fulfilment context with Temporal or Step Functions: the state, retries and compensations are explicit and you can answer "where is order 42". Between bounded contexts I would still publish domain events (OrderPlaced, OrderShipped) for choreographed consumers like email and analytics. Pure choreography is fine for simple, non-compensating reactions.',
      followUps: ['How do you debug a stuck choreographed flow?', 'What are the failure modes of the orchestrator itself?', 'How do you version long-running workflows?'],
      seniorSignal: 'Uses both at the right boundaries and names observability and compensation as the deciding factors.',
    },
    {
      q: 'How do you evolve event schemas without breaking subscribers you do not know about?',
      a: 'Register schemas and enforce a compatibility mode in CI and at publish — BACKWARD or FULL, transitive if data is retained and replayed. Make only additive, optional changes; never repurpose a field. For breaking changes publish a v2 event type in parallel, track consumers via the registry or an event catalog, migrate them, then retire v1. A standard envelope (CloudEvents) keeps ids, types and tracing uniform.',
      followUps: ['Which mode for a topic replayed from 90 days ago?', 'Fat events or thin notifications?', 'How do you find all consumers of an event?'],
      seniorSignal: 'Treats events as public APIs with discoverability and migration plans, not just a serializer choice.',
    },
  ],

  takeaways: [
    'Pub/sub = one publish, one backlog per subscription; competing consumers can share a subscription.',
    'Pull (or SNS→SQS) keeps backlog in the broker; push makes your endpoint absorb the spike.',
    'Delivery is at-least-once: dedup on the publisher’s event id, not the broker’s message id.',
    'Ordering keys serialize per key and add head-of-line blocking — prefer versioned, idempotent updates.',
    'Redis pub/sub is fire-and-forget: only for hints backed by TTLs or resync.',
    'Events are public APIs: schema registry, compatibility rules, v2 topics for breaking changes.',
    'Guard against storms and cycles with change detection, causation ids and separate backfill paths.',
  ],
};

export default deep;
