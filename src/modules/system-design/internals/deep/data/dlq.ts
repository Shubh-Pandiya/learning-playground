import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'dlq',

  problem: {
    why: 'At-least-once delivery means a failed message comes back — forever, unless something stops it. A dead-letter queue (DLQ) is where a message goes after a bounded number of failed attempts, so one **poison message** cannot burn worker capacity, block a FIFO group or Kafka partition, or hide in an infinite retry loop. It is a quarantine plus an operational workflow: alert, triage, fix, redrive or discard.',
    withoutIt: [
      'A single malformed message is redelivered indefinitely, consuming a worker slot each time and flooding logs.',
      'In ordered systems (SQS FIFO group, Kafka partition) one failing message blocks every later message for that key or partition.',
      'Teams "fix" loops by catching and dropping errors, silently losing orders, payments or emails.',
      'There is no record of what failed and why, so after a bug fix nothing can be replayed.',
    ],
    position: 'A side channel attached to a source queue/subscription/topic. The broker (SQS, RabbitMQ, Pub/Sub) or the consumer (Kafka) moves exhausted messages there; operators and redrive tooling consume it.',
    diagram: {
      type: 'flow',
      title: 'Where the DLQ sits',
      nodes: [
        { label: 'Source queue', sub: 'maxReceiveCount=5', tone: 'neutral' },
        { label: 'Worker', sub: 'fails on msg', tone: 'warn' },
        { label: 'DLQ', sub: 'parked + metadata', tone: 'bad' },
        { label: 'Alert + triage', sub: 'group by error', tone: 'info' },
        { label: 'Redrive', sub: 'rate-limited replay', tone: 'ok' },
      ],
      caption: 'The DLQ is not the end of the pipeline; redrive back to the source is.',
    },
  },

  architecture: {
    overview: 'A DLQ setup has four parts: an **attempt counter** per message (broker-maintained receive count or a header the consumer increments), a **policy** that decides when to give up, the **DLQ itself** (just another queue/topic with longer retention and restricted access), and **tooling** to inspect, group, redrive or purge. Brokers differ in who moves the message: SQS, RabbitMQ, Google Pub/Sub and Azure Service Bus do it broker-side; Kafka has no DLQ, so the consumer publishes to a dead-letter topic and commits the original offset.',
    diagram: {
      type: 'flow',
      title: 'Retry pipeline with tiers',
      nodes: [
        { label: 'Main topic', sub: 'live traffic', tone: 'neutral' },
        { label: 'Classifier', sub: 'transient vs permanent', tone: 'info' },
        { label: 'retry-1m', sub: 'delay 1 min', tone: 'warn' },
        { label: 'retry-10m', sub: 'delay 10 min', tone: 'warn' },
        { label: 'DLQ', sub: 'humans decide', tone: 'bad' },
        { label: 'Redrive job', sub: 'back to main', tone: 'ok' },
      ],
      caption: 'Permanent errors skip the retry tiers and go straight to the DLQ.',
    },
    blocks: [
      { name: 'Attempt counter', what: 'SQS `ApproximateReceiveCount`, quorum-queue `x-delivery-count`, Pub/Sub `delivery_attempt`, or a retry header the consumer increments when republishing (Kafka).' },
      { name: 'Redrive policy', what: 'SQS `RedrivePolicy {deadLetterTargetArn, maxReceiveCount}` (1–1000); RabbitMQ `x-dead-letter-exchange` + `delivery-limit`; Pub/Sub `deadLetterPolicy.maxDeliveryAttempts` (5–100); Service Bus `MaxDeliveryCount` (default 10).' },
      { name: 'Error classifier', what: 'Code in the consumer that maps exceptions to transient (retry with backoff), permanent (dead-letter now) or unknown (bounded retries). The broker cannot tell these apart.' },
      { name: 'Failure metadata', what: 'Original queue/topic, partition+offset, error class and message, stack hash, attempt count, first/last failure time, consumer version. RabbitMQ adds `x-death`; Kafka Connect adds `__connect.errors.*` headers.' },
      { name: 'Retry tiers', what: 'Delayed retry queues/topics (retry-1m, retry-10m, retry-1h) so retries do not block live traffic — essential on Kafka, optional on SQS (visibility backoff).' },
      { name: 'Redrive tooling', what: 'Peek, group by error fingerprint, edit/drop, and move back to the source at a controlled rate (SQS `StartMessageMoveTask`, RabbitMQ shovel, a Kafka replay consumer).' },
    ],
    real: [
      { name: 'Amazon SQS', how: 'Redrive policy on the source; DLQ type must match (standard→standard, FIFO→FIFO). `RedriveAllowPolicy` controls which sources may use a DLQ. `StartMessageMoveTask` redrives to the original source or another queue with an optional max messages/s velocity.' },
      { name: 'RabbitMQ', how: 'Messages rejected with `requeue=false`, expired by TTL, dropped by max-length, or over the quorum `delivery-limit` are republished to the dead-letter exchange with an `x-death` header (reason, count, queue, time). Quorum queues support at-least-once dead-lettering (`dead-letter-strategy`), classic queues only at-most-once.' },
      { name: 'Google Cloud Pub/Sub', how: 'Per-subscription dead-letter topic with max delivery attempts 5–100; the Pub/Sub service account needs publish rights on the dead-letter topic and subscribe rights on the source, otherwise dead-lettering silently does not happen.' },
      { name: 'Kafka (consumer-side)', how: 'Spring Kafka `DeadLetterPublishingRecoverer` and `@RetryableTopic` (retry topics + DLT), Kafka Connect `errors.tolerance=all` with `errors.deadletterqueue.topic.name` for sink connectors, or Uber-style custom retry topics.' },
      { name: 'AWS Lambda stream sources', how: 'For Kinesis/DynamoDB Streams: `MaximumRetryAttempts`, `MaximumRecordAgeInSeconds`, `BisectBatchOnFunctionError` and an on-failure destination (SQS/SNS) that receives metadata about the failed batch, not the records themselves.' },
    ],
  },

  lifecycle: {
    summary: 'A poison `InvoiceCreated` message on SQS with `maxReceiveCount=5` and exponential visibility backoff. Most of the time is deliberate backoff; then alarm evaluation latency decides how fast humans know.',
    stages: [
      { stage: 'Receive attempt 1', what: 'Worker long-polls and gets the message; receive count = 1.', cost: '1 RTT.', ms: 5 },
      { stage: 'Handler fails', what: 'Throws `UnknownCurrency`; classifier says "unknown → retry".', cost: 'Wasted work.', ms: 60 },
      { stage: 'Backoff via visibility', what: '`ChangeMessageVisibility` to 2^n s + jitter instead of waiting the full default timeout.', cost: 'Deliberate delay (sum over attempts).', ms: 30000 },
      { stage: 'Attempts 2–5 fail', what: 'Same error each time; receive count reaches 5.', cost: '4 × handler time.', ms: 240 },
      { stage: 'Broker moves to DLQ', what: 'On the next receive beyond 5, SQS moves the message to the DLQ instead of delivering it.', cost: 'Broker-side, invisible to workers.', ms: 10 },
      { stage: 'Alarm evaluates', what: 'CloudWatch alarm on DLQ `ApproximateNumberOfMessagesVisible > 0` over a 1-minute period.', cost: 'Metric period + evaluation.', ms: 60000 },
      { stage: 'Page / ticket', what: 'Routed by DLQ owner and severity; triage starts.', cost: 'Human time (not shown).', ms: 1000 },
    ],
  },

  deepDives: [
    {
      title: 'Redrive policies and attempt counting across brokers',
      hook: 'The same "max attempts" knob behaves differently on every broker — and some count wrong.',
      body: [
        'SQS counts **receives**, not failures: a worker that receives a batch of 10, crashes on the first, and never touches the other 9 still increments all 10 counters. Over-fetching plus crashes can dead-letter perfectly good messages. RabbitMQ quorum queues count redeliveries after a nack or a consumer/channel loss; classic queues have no counter at all, so loops never end unless you add a header-based counter.',
        'Retention on SQS is measured from the **original enqueue time** for standard queues: a message that spent 3 days retrying in a 4-day source queue arrives in the DLQ with about 1 day left unless the DLQ retention is longer. AWS’s guidance is to set DLQ retention longer than the source — use the 14-day maximum.',
      ],
      table: {
        caption: 'Dead-lettering by broker',
        columns: ['Broker', 'Counter', 'Policy', 'Who moves it', 'Gotcha'],
        rows: [
          ['SQS', 'ApproximateReceiveCount', 'maxReceiveCount 1–1000', 'Broker', 'Counts receives, not failures'],
          ['RabbitMQ quorum', 'x-delivery-count', 'delivery-limit (20 default in 4.0)', 'Broker → DLX', 'Classic queues have no limit'],
          ['Google Pub/Sub', 'delivery_attempt', '5–100 attempts', 'Broker', 'Needs IAM on DLT or it silently skips'],
          ['Azure Service Bus', 'DeliveryCount', 'MaxDeliveryCount (10)', 'Broker → $DeadLetterQueue', 'Also dead-letters on TTL if enabled'],
          ['Kafka', 'Your header', 'Your code', 'Consumer publishes', 'Must commit after DLT publish succeeds'],
        ],
      },
      insight: 'On Kafka the dead-letter publish and the offset commit are two steps: commit first and crash, and the message is lost; publish first and crash, and it is duplicated in the DLT — choose duplication and make DLT consumers idempotent.',
    },
    {
      title: 'Poison vs transient: classify before you retry',
      hook: 'Retrying a deterministic failure is waste; dead-lettering a transient one is an outage you created.',
      body: [
        '**Permanent** errors fail identically every time: deserialization errors, unknown schema version, validation failures, a 400/422 from a dependency, a missing referenced entity that will never exist. Retrying is pointless — dead-letter on the first attempt with the error attached. **Transient** errors depend on time: timeouts, 429, 503, connection resets, lock conflicts. Retry with exponential backoff and jitter.',
        'The dangerous case is a **dependency outage** classified as transient with a low max-attempts: within minutes every message exhausts its attempts and lands in the DLQ — thousands of good messages now need redrive. Pair retries with a circuit breaker that **pauses consumption** (stop polling, stop the Lambda event source mapping) when the dependency is down, so attempts are not burned at all.',
      ],
      code: {
        lang: 'python',
        caption: 'Consumer-side classification (SQS)',
        code: `def handle(msg):
    try:
        process(parse(msg.body))
        msg.delete()
    except (ValidationError, SchemaError, UnknownEntity) as e:
        send_to_dlq(msg, reason='permanent', error=e)   # no retries
        msg.delete()
    except (Timeout, Throttled, ServiceUnavailable) as e:
        if breaker.open():          # dependency down: stop consuming
            pause_polling()
        n = int(msg.attributes['ApproximateReceiveCount'])
        delay = min(2 ** n * 5, 900) + random.randint(0, 5)
        msg.change_visibility(delay)                     # backoff
    # unknown exceptions propagate: redrive policy bounds attempts`,
      },
      insight: 'Track DLQ inflow per error class: a spike of "transient" errors in the DLQ means your retry budget is shorter than real dependency outages; a steady trickle of "permanent" ones means an upstream producer bug that needs an owner, not a redrive.',
    },
    {
      title: 'Retry topics with backoff (Uber’s pattern)',
      hook: 'On a log, a failing record blocks its partition — unless you move it aside.',
      body: [
        'Kafka cannot hide a single record and redeliver it later; the consumer either blocks retrying in place (stalling the partition) or skips it. Uber’s 2018 design (Building Reliable Reprocessing and Dead Letter Queues with Kafka) publishes a failed record to a **retry topic** with a delay tier, commits the original offset, and moves on. Each retry topic has its own consumer that waits until `failed_at + delay` before reprocessing; after the last tier the record goes to the DLQ topic.',
        'Delay is implemented by pausing the partition (`consumer.pause()`) until the head record is due — records in a retry topic are in time order, so the head is always the earliest due. Spring Kafka’s `@RetryableTopic` implements the same pattern (`-retry-N` topics and a `-dlt`).',
      ],
      diagram: {
        type: 'sequence',
        title: 'Non-blocking retries on Kafka',
        actors: ['orders', 'Consumer', 'orders-retry-1m', 'Retry consumer', 'orders-dlt'],
        messages: [
          { from: 'orders', to: 'Consumer', label: 'record @offset 812' },
          { from: 'Consumer', to: 'orders-retry-1m', label: 'publish + attempt=1', tone: 'warn' },
          { from: 'Consumer', to: 'orders', label: 'commit 813, continue', dashed: true, tone: 'ok' },
          { from: 'orders-retry-1m', to: 'Retry consumer', label: 'fetch, pause until due' },
          { from: 'Retry consumer', to: 'Retry consumer', label: 'retry fails again' },
          { from: 'Retry consumer', to: 'orders-dlt', label: 'publish to DLT', tone: 'bad' },
        ],
      },
      insight: 'Retry topics sacrifice per-key ordering: later records for the same key are processed before the retried one — fine for independent events, wrong for state machines unless you also park every later record of that key.',
    },
    {
      title: 'Ordering consequences: what a DLQ does to FIFO',
      hook: 'Dead-lettering unblocks the group — and that is exactly what breaks ordering.',
      body: [
        'In SQS FIFO, a failing message blocks its message group until it is deleted or moved. Once it goes to the DLQ, the next messages in the group flow — so `OrderShipped` may be applied while `OrderPaid` sits in the DLQ. For state machines this is corruption, not delay.',
        'Options: (1) **park the key** — when a key has anything in the DLQ, route all its later messages to the DLQ (or a per-key hold table) until the head is resolved; (2) make handlers **version-aware** so out-of-order events are rejected or buffered; (3) accept and **reconcile** — a periodic job compares state against the source of truth. Pick per domain; payments usually need (1) or (2).',
      ],
      diagram: {
        type: 'flow',
        title: 'Park-the-key',
        nodes: [
          { label: 'msg v3 key=42', sub: 'arrives', tone: 'neutral' },
          { label: 'Hold check', sub: 'key 42 parked?', tone: 'info' },
          { label: 'Hold table', sub: 'v3 waits behind v2', tone: 'warn' },
          { label: 'v2 fixed + redriven', sub: 'release key 42', tone: 'ok' },
          { label: 'Apply v2, v3', sub: 'in order', tone: 'ok' },
        ],
      },
      insight: 'A DLQ on an ordered stream needs a design for "what happens to the rest of this key", otherwise the DLQ quietly converts an ordering guarantee into a best-effort one.',
    },
    {
      title: 'Redrive: replaying safely',
      hook: 'Redrive is a production deploy of old traffic — treat it like one.',
      body: [
        'Before redriving: deploy the fix, sample a few messages through it (redrive 10, watch), and confirm handlers are idempotent because some messages may have partially succeeded. Redrive at a controlled rate so a 1M-message backlog does not stampede the database, and redrive in the original order where ordering matters.',
        'SQS `StartMessageMoveTask` moves DLQ messages back to their source (or a chosen queue) with an optional velocity cap, and can be cancelled. For Kafka DLTs, run a replay consumer that republishes to the main topic (or calls the handler directly) with rate limiting and its own committed offsets. Messages that are invalid forever should be explicitly archived and purged, with a record of why.',
      ],
      code: {
        lang: 'bash',
        caption: 'Rate-limited SQS redrive',
        code: `aws sqs start-message-move-task \\
  --source-arn arn:aws:sqs:eu-west-1:123:invoices-dlq \\
  --max-number-of-messages-per-second 50
# destination defaults to the original source queue

aws sqs list-message-move-tasks \\
  --source-arn arn:aws:sqs:eu-west-1:123:invoices-dlq
aws sqs cancel-message-move-task --task-handle "$HANDLE"`,
      },
      insight: 'Redrive resets nothing about the business context: a "send welcome email" from 10 days ago may now be harmful — some messages need an expiry check (`if now - event_time > X: drop`) before replay.',
    },
    {
      title: 'Monitoring, ownership, retention and PII',
      hook: 'An unwatched DLQ is a black hole with a 14-day timer.',
      body: [
        'Alert on **age and inflow**, not just "depth > 0": the DLQ’s oldest-message age measured against its retention is the data-loss deadline, and inflow rate catches new bugs quickly. On SQS, a DLQ’s `ApproximateAgeOfOldestMessage` reflects time since the move, not original send. Every DLQ needs an owning team in its tags and routing rules.',
        '**Alert fatigue** kills DLQs: if 40 DLQs page on any message, people mute them. Page only for critical flows (payments, orders) on inflow rate or age; create tickets for the rest; group by error fingerprint so 10,000 identical failures are one item. Review DLQ contents in the weekly ops review.',
        'DLQs hold full payloads for up to 14 days — customer names, emails, sometimes card tokens. Encrypt with KMS, restrict read access more tightly than the source, avoid copying bodies into error trackers and logs, and include DLQs in GDPR deletion and retention policies.',
      ],
      diagram: {
        type: 'layers',
        title: 'DLQ operating model',
        layers: [
          { name: 'Signals', items: ['inflow rate', 'oldest age vs retention', 'error fingerprint'], tone: 'warn' },
          { name: 'Routing', items: ['owner tag', 'page vs ticket', 'dedup by fingerprint'], tone: 'info' },
          { name: 'Action', items: ['fix + sample', 'rate-limited redrive', 'archive + purge'], tone: 'ok' },
          { name: 'Governance', items: ['KMS encryption', 'restricted access', 'retention + erasure'], tone: 'violet' },
        ],
      },
      insight: 'A DLQ with a permanent non-zero baseline is worse than none: it trains everyone to ignore it, so the critical message that lands there tomorrow is invisible.',
    },
  ],

  scaling: {
    body: [
      'DLQs are low-volume by design; the scaling concern is the burst when a dependency fails and thousands of messages dead-letter at once, followed by a redrive that replays them all. Both need rate limits: retry budgets and circuit breakers on the way in, velocity caps on the way out.',
      'Use one DLQ per source queue/subscription (not one shared DLQ for everything): ownership, retention, access control and redrive targets stay unambiguous. Shared DLQs mix payload types and make "redrive to source" impossible without extra metadata.',
      'Multi-region: DLQs are regional like their sources. After a regional failover, the old region’s DLQ still holds failures that need triage — include DLQs in failover runbooks.',
    ],
    bullets: [
      'One DLQ per source; retention = maximum (14 days on SQS) and longer than the source.',
      'Circuit breaker pauses consumption during dependency outages instead of burning attempts.',
      'Redrive with velocity caps; watch the target queue’s age while it runs.',
      'Kafka: retry topics per delay tier, partitioned like the source to keep per-key locality.',
      'Tag owners and severity on every DLQ; generate alarms from infrastructure-as-code so none is missed.',
    ],
  },

  failures: [
    {
      name: 'DLQ black hole',
      symptom: 'Customers report missing orders weeks later; the DLQ expired them silently.',
      detect: 'Alarm on DLQ `ApproximateAgeOfOldestMessage` > 50% of retention and on `NumberOfMessagesSent` (inflow) > 0 for critical flows; audit for DLQs without alarms.',
      mitigate: 'Owner per DLQ, alarms from IaC, retention longer than source, weekly review of DLQ contents.',
    },
    {
      name: 'Mass dead-lettering during an outage',
      symptom: 'A 15-minute dependency outage moves 200k valid messages to the DLQ.',
      detect: 'DLQ inflow spike correlated with a dependency’s error rate; error class = transient.',
      mitigate: 'Circuit breaker pausing consumers, exponential backoff, higher max attempts for transient errors, scripted redrive.',
    },
    {
      name: 'Redrive stampede',
      symptom: 'Redriving 1M messages saturates workers and the database; live traffic latency spikes.',
      detect: 'Source queue age and DB latency during the move task; worker saturation.',
      mitigate: 'Velocity cap on redrive, off-peak scheduling, separate replay consumers with their own concurrency limit.',
    },
    {
      name: 'Silent dead-letter misconfiguration',
      symptom: 'Messages exceed max attempts but never appear in the DLQ (or loop forever).',
      detect: 'Max receive count on source keeps growing; Pub/Sub dead-letter metrics flat; IaC policy checks for missing redrive policies or IAM bindings.',
      mitigate: 'Validate DLQ wiring in CI (policy present, types match, IAM granted); synthetic poison message test in staging.',
    },
    {
      name: 'Out-of-order state after dead-lettering',
      symptom: 'Entities end in impossible states (shipped but unpaid) after an earlier event was dead-lettered.',
      detect: 'Invariant checks / reconciliation job; state-transition rejection metrics.',
      mitigate: 'Park-the-key, version-aware handlers, or reconciliation against the source of truth.',
    },
  ],

  warStories: [
    {
      title: 'Reliable reprocessing with retry topics',
      source: 'Uber Engineering blog (2018)',
      what: 'Uber’s driver-payments pipeline on Kafka could neither block partitions on failures nor drop failed events. They introduced retry topics with increasing delays, each consumed by a dedicated consumer that waits until the delay has elapsed, followed by a dead-letter topic for manual inspection and replay. Failures stopped blocking real-time processing.',
      lesson: 'On a log, retries must leave the main partition; delay tiers plus a DLQ give backoff without head-of-line blocking — at the cost of per-key ordering.',
    },
    {
      title: 'The 4-day queue and the 4-day DLQ',
      source: 'Composite of common incidents',
      what: 'A team created a DLQ with the same 4-day default retention as its SQS source. Messages that had already spent most of their life retrying arrived in the DLQ close to expiry. A Friday-night bug dead-lettered refunds; by Monday triage, most were gone because retention counts from the original enqueue time.',
      lesson: 'Set DLQ retention to the maximum (14 days), alert on age against retention, and never rely on the DLQ as an archive — copy to S3 if you need longer.',
    },
    {
      title: 'Forty muted DLQ alarms',
      source: 'Composite of common incidents',
      what: 'Every DLQ in a platform paged on depth > 0. Most held a steady trickle of known junk (test messages, deprecated event versions), so on-call muted the alarms. A schema change then broke the billing consumer; its DLQ filled for two days before finance noticed revenue was not being recorded.',
      lesson: 'Keep DLQs at zero baseline by purging known junk at the source, page only on critical flows by inflow/age, and group by error fingerprint.',
    },
  ],

  numbers: [
    { label: 'Typical max attempts', value: '3–10', note: 'Higher with backoff for flaky deps' },
    { label: 'SQS maxReceiveCount', value: '1–1000' },
    { label: 'SQS max retention', value: '14 days', note: 'Counted from original enqueue (standard)' },
    { label: 'RabbitMQ quorum delivery-limit', value: '20 default (4.0)' },
    { label: 'Google Pub/Sub max delivery attempts', value: '5–100 (default 5)' },
    { label: 'Azure Service Bus MaxDeliveryCount', value: '10 default' },
    { label: 'CloudWatch alarm latency', value: '~1–3 min', note: '1-min period + evaluation' },
    { label: 'Critical DLQ alert', value: 'inflow > 0 or age > 50% retention' },
  ],

  capacity: {
    question: 'A queue processes 2,000 msg/s. A downstream outage lasts 20 minutes; handlers retry with backoff and maxReceiveCount=5 exhausts within ~5 minutes. How many messages dead-letter, and how long does redrive take at a safe rate?',
    steps: [
      'Messages arriving during the outage: 2,000 × 1,200 s = 2.4M.',
      'Those arriving in the last ~5 minutes are still retrying when the dependency recovers: 2,000 × 300 = 0.6M succeed on retry.',
      'Dead-lettered ≈ 2.4M − 0.6M = 1.8M messages.',
      'Safe redrive rate = spare capacity: workers handle 3,000/s, live load is 2,000/s → ~1,000/s spare, minus 20% margin = 800/s.',
      'Redrive time ≈ 1.8M ÷ 800 ≈ 37.5 min. SQS move tasks cap velocity at a few hundred msg/s, so hitting 800/s may need a custom parallel replayer.',
    ],
    answer: '~1.8M messages dead-letter and need ~40 minutes of rate-limited redrive — a circuit breaker that paused consumption at the start of the outage would have dead-lettered ~0.',
  },

  comparison: {
    caption: 'Dead-letter support',
    columns: ['Product', 'Mechanism', 'Redrive tooling', 'Ordering impact', 'Notes'],
    rows: [
      ['Amazon SQS', 'Redrive policy, broker moves', 'StartMessageMoveTask, console', 'FIFO group unblocks', 'Retention from original enqueue'],
      ['RabbitMQ', 'DLX + x-death, delivery-limit', 'Shovel / custom', 'Queue order lost for that msg', 'At-least-once DLX only on quorum queues'],
      ['Google Pub/Sub', 'Dead-letter topic per sub', 'Re-publish / seek', 'Ordering key unblocks', 'IAM must allow forwarding'],
      ['Kafka + retry topics', 'Consumer publishes to retry/DLT', 'Replay consumer', 'Per-key order sacrificed', 'Commit only after DLT publish'],
      ['Azure Service Bus', 'Built-in $DeadLetterQueue', 'Receive from subqueue + resubmit', 'Sessions unblock', 'Reason + description properties'],
    ],
  },

  whenNot: [
    'Errors you can handle in code (validation with a user-facing response): reject synchronously at the API instead of accepting and dead-lettering.',
    'Strictly ordered state machines where skipping is corruption: block the key or stop the consumer and page, rather than dead-letter and continue.',
    'As an archive or audit log: DLQs expire; write to S3/a database if you need long-term records.',
    'As a substitute for backoff during dependency outages: pause consumption with a circuit breaker instead of dead-lettering good messages.',
  ],

  interview: [
    {
      q: 'What is a poison message and how should a consumer handle it?',
      a: 'A message that fails deterministically — bad format, unknown schema, a value the code cannot handle — so every redelivery fails the same way. The consumer should classify errors: permanent ones are dead-lettered immediately with error metadata, transient ones retried with exponential backoff and jitter, unknown ones bounded by the redrive policy. The DLQ is alerted on, triaged by error fingerprint, and redriven after a fix with idempotent handlers.',
      followUps: ['How does the broker know how many times it failed?', 'What changes for a FIFO queue?', 'Where do you store the error details?'],
      seniorSignal: 'Separates poison from transient errors explicitly and designs the triage and redrive loop, not just the policy.',
    },
    {
      q: 'How do you implement retries and a DLQ on Kafka?',
      a: 'Kafka has no broker DLQ, so the consumer catches the failure, publishes the record with error headers to a retry topic for its delay tier (or directly to a DLT for permanent errors), and only then commits the original offset. Retry consumers pause partitions until the head record is due, then reprocess; after the last tier records go to the DLT. This keeps partitions flowing but loses per-key ordering, so for ordered domains I would park the key or use version checks.',
      followUps: ['What if publishing to the retry topic fails?', 'How do you implement the delay?', 'How do you replay the DLT?'],
      seniorSignal: 'Gets the publish-then-commit ordering right and calls out the ordering trade-off.',
    },
    {
      q: 'Your payments dependency is down for 30 minutes. What happens to your queue and DLQ?',
      a: 'With naive retries every message exhausts its attempts and dead-letters, so the DLQ fills with valid payments and you face a big redrive. Better: a circuit breaker detects the outage and pauses consumption, so messages wait in the source queue with their attempt counts intact; backlog age grows but nothing is mis-classified. When the dependency recovers, consumption resumes with a ramp. Retention of the source must exceed the longest outage you plan for.',
      followUps: ['How do you pause an SQS Lambda trigger?', 'How do you ramp back up safely?', 'Which metric pages first?'],
      seniorSignal: 'Prevents mass dead-lettering via pausing rather than relying on a later redrive.',
    },
    {
      q: 'How do you monitor DLQs without drowning in alerts?',
      a: 'Page only for critical flows, on DLQ inflow rate and on oldest-message age against retention; everything else creates a ticket. Group messages by error fingerprint so one bug is one item. Keep baselines at zero by fixing or purging known junk at the source. Every DLQ has an owner tag and its alarms are generated by infrastructure-as-code so new queues cannot ship without them.',
      followUps: ['Why age against retention?', 'How do you detect a DLQ that is misconfigured?', 'Who owns a DLQ shared by two teams?'],
      seniorSignal: 'Treats alert fatigue and ownership as the real failure modes, not missing metrics.',
    },
    {
      q: 'How do you redrive 500k dead-lettered messages safely?',
      a: 'Deploy the fix, then redrive a small sample and verify outcomes. Confirm handlers are idempotent since some messages may have partially succeeded, and filter out messages that are now stale or harmful to replay (e.g. time-sensitive notifications). Redrive at a capped rate derived from spare capacity, monitoring the source queue age and downstream latency, and cancel if errors reappear. Archive and purge what is invalid forever, with a record of the decision.',
      followUps: ['How do you preserve ordering in redrive?', 'What about PII in the DLQ?', 'How long can you wait before redriving?'],
      seniorSignal: 'Treats redrive as a controlled production change with sampling, rate limits and staleness checks.',
    },
  ],

  takeaways: [
    'A DLQ is a workflow (alert → triage → fix → redrive), not a trash can.',
    'Classify errors: permanent → DLQ now, transient → backoff, outage → pause consumption.',
    'Set DLQ retention to the maximum; on SQS it counts from the original enqueue time.',
    'Dead-lettering unblocks FIFO groups and partitions — which breaks per-key ordering.',
    'On Kafka, retries leave the partition via retry topics; publish to the DLT before committing.',
    'Page on inflow and age for critical flows; zero baseline prevents alert fatigue.',
    'DLQs hold full payloads: encrypt, restrict access and include them in data-retention policies.',
  ],
};

export default deep;
