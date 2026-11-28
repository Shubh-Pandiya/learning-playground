import { has, noFlag, noLag, ordAtLeast, poisonSafe, semAtLeast, survivesBrokerLoss, topicsOf } from '../engine/check';
import { cfgOf } from '../engine/defaults';
import { COL, ROW, graph, n, type Lesson } from './lesson';
import { R, topicCfg } from './lessons-a';

/* ================================================================== */
/* 6. Delivery semantics & exactly-once                                */
/* ================================================================== */

const walletStage = graph(
  [
    n('service', 'w', COL.a, ROW(1), { rate: 2000 }, 'wallet-api'),
    n('topic', 'pay', COL.b, ROW(1), { partitions: 6 }, 'charge-requests'),
    n('group', 'chg', COL.c, ROW(1), { consumers: 6, procMs: 0.5, commit: 'auto' }, 'charger'),
    n('sink', 'psp', COL.d, ROW(1), { capacity: 20000, idempotentSink: false }, 'card-processor'),
  ],
  ['w>pay', 'pay>chg', 'chg>psp'],
);

export const L6: Lesson = {
  id: 'semantics',
  n: 6,
  title: 'Delivery semantics & exactly-once',
  tagline: 'Where duplicates and losses actually come from.',
  minutes: 14,
  concepts: ['at-most / at-least / exactly-once', 'auto-commit pitfalls', 'commit before vs after processing', 'idempotent consumers', 'idempotent producer (PID + sequence)', 'transactions & read_committed', 'EOS = Kafka-to-Kafka only'],
  problem: 'Customers are occasionally charged twice after deploys, and once a payment vanished. Both trace back to *when* offsets are committed.',
  stage: walletStage,
  learn: [
    {
      title: 'Three places to lose or duplicate',
      body: '**Producer → broker** (lost acks, retries), **broker** (replication, lesson 2), and **consumer → side effect** (when you commit relative to doing the work). The guarantee you get is the *weakest* link.',
      focus: 'chg',
    },
    {
      title: 'Auto-commit',
      body: '`enable.auto.commit=true` commits the offsets returned by the previous `poll()` every 5 s, from inside the next poll.',
      predict: {
        q: 'The charger crashes 4 s after the last auto-commit. What happens on restart?',
        options: ['Nothing; Kafka knows what was processed', 'Up to ~4 s of charge requests are processed again, so double charges', 'Those 4 s are skipped', 'The group is deleted'],
        answer: 1,
        explain: 'The new owner resumes from the last committed offset, so everything after it is re-delivered. And if you hand records to another thread, auto-commit can commit offsets you haven’t processed: loss *and* duplicates.',
      },
      focus: 'chg',
    },
    {
      title: 'Commit before processing = at-most-once',
      body: 'Commit first, then charge. A crash between the two **skips** those records forever.',
      ops: [{ set: ['chg', { commit: 'before' }] }],
      focus: 'chg',
    },
    {
      title: 'Commit after processing = at-least-once',
      body: 'Charge, then `commitSync()`. A crash between the two re-delivers the batch. **Nothing is lost, but duplicates are possible.** This is the standard choice; the remaining job is to make duplicates harmless.',
      ops: [{ set: ['chg', { commit: 'after' }] }],
      focus: 'chg',
    },
    {
      title: 'Idempotent side effects = effectively-once',
      body: 'Send an **idempotency key** (the event id) with each charge, or upsert / `INSERT … ON CONFLICT DO NOTHING` on event id. Replays become no-ops. This is how real systems get “exactly-once”: at-least-once delivery + idempotent processing.',
      ops: [{ set: ['psp', { idempotentSink: true }] }],
      focus: 'psp',
    },
    {
      title: 'Producer-side duplicates',
      body: 'Turn producer idempotence off, keep retries with 5 in-flight requests.',
      predict: {
        q: 'A batch is written but the ack is lost (network). The producer retries. Without idempotence?',
        options: ['The broker detects it', 'The batch is written twice, and with 5 in-flight it can also land out of order', 'The retry is dropped'],
        answer: 1,
        explain: 'With `enable.idempotence=true` the producer gets a **producer id (PID)** and numbers each batch per partition. The leader keeps the last 5 sequence numbers per PID and rejects duplicates and gaps. That’s exactly-once *into the log* for a single producer session, and it’s on by default since Kafka 3.0.',
      },
      ops: [{ set: ['w', { idempotence: false, acks: 'all', maxInFlight: 5 }] }],
      focus: 'w',
    },
    {
      title: 'Transactions: exactly-once inside Kafka',
      body: 'For **consume → process → produce** pipelines, a transactional producer writes outputs *and* the consumer offsets atomically (`sendOffsetsToTransaction`). Consumers with `isolation.level=read_committed` only see committed transactions. That is Kafka Streams’ `exactly_once_v2`. It **doesn’t** cover external side effects (a card charge, an email): those still need idempotency keys.',
      ops: [{ set: ['w', { idempotence: true }] }],
      internals: 'A transaction coordinator (leader of a `__transaction_state` partition) logs the transaction state. Commit writes **control markers** into every touched partition. Consumers in read_committed read only up to the **last stable offset** (LSO). `transactional.id` + epoch fences zombie producers.',
    },
  ],
  build: {
    title: 'Wallet: never double-charge, never lose',
    story: '`charge-requests` (2,000/s) are consumed by `charger`, which calls the card processor. Deploys and crashes happen daily. Customers must not be charged twice, and no request may be lost.',
    start: graph(
      [
        n('service', 'w', COL.a, ROW(1), { rate: 2000, idempotence: false }, 'wallet-api'),
        n('topic', 'pay', COL.b, ROW(1), { partitions: 6 }, 'charge-requests'),
        n('group', 'chg', COL.c, ROW(1), { consumers: 6, procMs: 0.5, commit: 'auto' }, 'charger'),
        n('sink', 'psp', COL.d, ROW(1), { capacity: 20000, idempotentSink: false }, 'card-processor'),
      ],
      ['w>pay', 'pay>chg', 'chg>psp'],
    ),
    palette: ['service', 'topic', 'group', 'sink'],
    reqs: [
      R('once', 'Each charge takes effect once (effectively-once)', '', (c) => semAtLeast(c.m, 'effectively-once'), 'At-least-once delivery + an idempotent side effect.'),
      R('noloss', 'No request lost', '', (c) => !c.m.flags.some((f) => f.id.startsWith('cb:') || f.id.startsWith('skip:'))),
      R('order', 'Producer retries can’t reorder or duplicate', '', (c) => noFlag(c.m, 'reorder')),
      R('dur', 'Survives a broker failure', '', (c) => survivesBrokerLoss(c)),
    ],
    hints: ['Who can create a duplicate: the producer, the consumer, or both?', 'Commit after processing; idempotency key at the processor; idempotent producer.', 'Producer idempotence on; commit=after; sink idempotent.'],
    reference: graph(
      [
        n('service', 'w', COL.a, ROW(1), { rate: 2000, idempotence: true }, 'wallet-api'),
        n('topic', 'pay', COL.b, ROW(1), { partitions: 6 }, 'charge-requests'),
        n('group', 'chg', COL.c, ROW(1), { consumers: 6, procMs: 0.5, commit: 'after' }, 'charger'),
        n('sink', 'psp', COL.d, ROW(1), { capacity: 20000, idempotentSink: true }, 'card-processor'),
      ],
      ['w>pay', 'pay>chg', 'chg>psp'],
    ),
    debrief: 'Notice that you didn’t need Kafka transactions: the side effect is outside Kafka. Exactly-once against external systems is always idempotency (keys, upserts, dedupe tables) on top of at-least-once delivery.',
  },
  challenge: {
    title: 'Inventory counts with Kafka Streams',
    story: 'A Streams app aggregates `orders` into per-SKU stock levels in `inventory` (a changelog). A double-count oversells. A lost order undersells. All of it stays inside Kafka.',
    start: graph(
      [
        n('service', 'o', COL.a, ROW(1), { rate: 5000, acks: '1', idempotence: false }, 'orders-api'),
        n('topic', 'ord', COL.b, ROW(1), { partitions: 12 }, 'orders'),
        n('streams', 'agg', COL.c, ROW(1), { consumers: 6, procMs: 0.5, eos: false }, 'inventory-agg'),
        n('topic', 'inv', COL.d, ROW(1), { partitions: 12, cleanup: 'compact', role: 'changelog' }, 'inventory'),
      ],
      ['o>ord', 'ord>agg', 'agg>inv'],
    ),
    palette: ['service', 'topic', 'streams', 'group', 'sink'],
    reqs: [
      R('eos', 'Exactly-once end to end', '', (c) => semAtLeast(c.m, 'exactly-once')),
      R('lag', 'Keeps up', '', (c) => noLag(c.m)),
      R('dur', 'No acked order lost on broker failure', '', (c) => c.m.metrics.durability.level === 2),
    ],
    hints: ['Streams EOS can only be as good as its input.', 'processing.guarantee=exactly_once_v2; the producer must be idempotent and durable.', 'Streams EOS on; producer acks=all + idempotence.'],
    reference: graph(
      [
        n('service', 'o', COL.a, ROW(1), { rate: 5000, acks: 'all', idempotence: true }, 'orders-api'),
        n('topic', 'ord', COL.b, ROW(1), { partitions: 12 }, 'orders'),
        n('streams', 'agg', COL.c, ROW(1), { consumers: 6, procMs: 0.5, eos: true }, 'inventory-agg'),
        n('topic', 'inv', COL.d, ROW(1), { partitions: 12, cleanup: 'compact', role: 'changelog' }, 'inventory'),
      ],
      ['o>ord', 'ord>agg', 'agg>inv'],
    ),
    debrief: 'EOS v2 adds ~100 ms of latency (commit interval) and some throughput cost. Use it where double counting costs money; at-least-once with idempotent aggregation is often enough.',
  },
  quiz: [
    { q: 'Commit offsets, then process. Guarantee?', options: ['At-least-once', 'At-most-once', 'Exactly-once'], answer: 1, explain: 'A crash after commit and before processing skips records.' },
    { q: 'What does enable.idempotence prevent?', options: ['Duplicate processing in consumers', 'Duplicate/out-of-order writes from producer retries', 'Data loss on broker failure'], answer: 1, explain: 'PID + per-partition sequence numbers let the leader drop retried duplicates.' },
    { q: 'Kafka EOS with a consumer that writes to Postgres. Exactly-once?', options: ['Yes, transactions cover it', 'No, the DB write is outside the transaction. Store offsets in the same DB transaction or make writes idempotent', 'Only with read_committed'], answer: 1, explain: 'Kafka transactions are atomic across Kafka partitions only.' },
  ],
  takeaways: ['Default to at-least-once + idempotent processing.', 'Never commit before the work is done; beware auto-commit with async processing.', 'Idempotent producer = no duplicates from retries (PID + sequence).', 'Transactions/EOS cover Kafka → Kafka only.'],
  interview: [
    { q: 'How do you achieve exactly-once processing with Kafka?', a: 'Inside Kafka: idempotent + transactional producer, sendOffsetsToTransaction, read_committed consumers (Streams exactly_once_v2). To external systems: at-least-once delivery with idempotent writes (upsert on event id, idempotency keys), or store the offset in the same DB transaction as the result and seek to it on restart.' },
    { q: 'How does the idempotent producer work?', a: 'On init the producer gets a producer id and epoch. Each batch per partition carries a sequence number. The leader stores the last 5 batch sequences per PID and rejects duplicates (returns success) and out-of-order gaps (OutOfOrderSequence). This allows max.in.flight ≤ 5 while preserving order.' },
  ],
  deepDives: ['idempotence', 'transactions', 'offsets'],
};

/* ================================================================== */
/* 7. Retries, DLQ & poison pills                                      */
/* ================================================================== */

const hookStage = graph(
  [
    n('service', 'in', COL.a, ROW(1), { rate: 1000 }, 'webhook-receiver'),
    n('topic', 'wh', COL.b, ROW(1), { partitions: 6 }, 'webhooks'),
    n('group', 'disp', COL.c, ROW(1), { consumers: 6, procMs: 2, onError: 'crash' }, 'dispatcher'),
    n('sink', 'api', COL.d, ROW(1), { capacity: 5000, idempotentSink: true }, 'partner-api'),
  ],
  ['in>wh', 'wh>disp', 'disp>api'],
);

export const L7: Lesson = {
  id: 'retries',
  n: 7,
  title: 'Retries, DLQ & poison pills',
  tagline: 'One bad record shouldn’t stop a partition.',
  minutes: 12,
  concepts: ['poison pill vs transient failure', 'crash loops', 'head-of-line blocking', 'non-blocking retry topics', 'dead letter queue', 'retry headers & backoff', 'ordering trade-off'],
  problem: 'A malformed webhook from one partner stopped all deliveries on its partition for 3 hours, and nobody noticed until customers complained.',
  stage: hookStage,
  learn: [
    {
      title: 'Two kinds of failure',
      body: '**Poison pills** never succeed: bad JSON, schema mismatch, a bug for one edge case. **Transient** failures succeed later: timeouts, 503s, DB failover. They need different handling, and the default (throw an exception) handles neither.',
      focus: 'disp',
    },
    {
      title: 'A poison pill arrives',
      body: 'The dispatcher throws on a malformed payload (onError = crash).',
      predict: {
        q: 'What happens to that partition?',
        options: ['The record is skipped automatically', 'Crash → restart from the committed offset → same record → crash: the partition is stuck and the group keeps rebalancing', 'Kafka moves it to a DLQ', 'Only that record is delayed'],
        answer: 1,
        explain: 'Kafka has no per-message ack or redelivery count: your offset simply doesn’t move. Every record behind the poison one waits, and each crash triggers a rebalance that briefly pauses others too.',
      },
      chaos: { poison: true },
      focus: 'disp',
    },
    {
      title: 'Skip it?',
      body: '`catch → log → continue`. The partition flows again, but every *transient* failure is now silently dropped too: a 30 s partner outage loses 30 s of webhooks.',
      ops: [{ set: ['disp', { onError: 'skip' }] }],
      chaos: { poison: true },
      focus: 'disp',
    },
    {
      title: 'Retry in place?',
      body: 'Retry with backoff before moving on. Fine for transient blips, but a poison record retries forever and blocks the partition (**head-of-line blocking**).',
      ops: [{ set: ['disp', { onError: 'block-retry' }] }],
      chaos: { poison: true },
      focus: 'disp',
    },
    {
      title: 'Retry topics + DLQ',
      body: 'On failure, publish the record to `webhooks-retry` (with headers: attempt, error, original topic/partition/offset), **commit**, and move on. A retry worker consumes it after a backoff. After N attempts it goes to `webhooks-dlq` for humans and tooling. The main partition never blocks.',
      ops: [
        { add: n('topic', 'retry', COL.d, ROW(0), { partitions: 6, role: 'retry', retentionH: 72 }, 'webhooks-retry') },
        { add: n('topic', 'dlq', COL.d, ROW(2), { partitions: 1, role: 'dlq', retentionH: 720 }, 'webhooks-dlq') },
        { add: n('group', 'rw', COL.e, ROW(0), { consumers: 2, procMs: 2, onError: 'retry-dlq' }, 'retry-worker') },
        { set: ['disp', { onError: 'retry-dlq' }] },
        { link: ['disp', 'retry'] },
        { link: ['disp', 'dlq'] },
        { link: ['retry', 'rw'] },
        { link: ['rw', 'dlq'] },
        { link: ['rw', 'api'] },
      ],
      chaos: { poison: true },
      internals: 'Spring Kafka’s @RetryableTopic and Uber’s “reliable reprocessing” design use a chain like `topic-retry-5s → topic-retry-1m → topic-dlt`. The retry consumer pauses the partition until the record’s due time (from a header) instead of sleeping, so it doesn’t exceed max.poll.interval.',
      focus: 'disp',
    },
    {
      title: 'The price: ordering',
      body: 'Event 1 for customer A goes to the retry topic. Event 2 for A succeeds immediately.',
      predict: {
        q: 'Which reaches the partner first?',
        options: ['Event 1, since Kafka preserves key order', 'Event 2: retries break per-key order', 'Both at once'],
        answer: 1,
        explain: 'Moving a record aside means later records for the same key overtake it. If order matters per key, park the *key*: keep a “blocked keys” set and route that key’s later records to the retry topic too until the first one resolves.',
      },
      focus: 'retry',
    },
    {
      title: 'Operate the DLQ',
      body: 'A DLQ nobody watches is just a slower `skip`. Alert on DLQ depth, keep enough retention (weeks), store the error and stack trace in headers, and build a **redrive** tool that republishes fixed records to the main topic.',
    },
  ],
  build: {
    title: 'Resilient webhook delivery',
    story: 'Inbound partner webhooks (1,000/s) are dispatched to the partner API, which is idempotent. Malformed payloads happen weekly and partner outages monthly. Nothing may be lost, and one bad record must not block others.',
    start: hookStage,
    palette: ['topic', 'group', 'sink'],
    reqs: [
      R('poison', 'A poison record doesn’t stall any partition', '', poisonSafe, 'Move failures aside instead of retrying in place.'),
      R('noloss', 'Failures are never dropped', '', (c) => semAtLeast(c.m, 'at-least-once')),
      R('dlq', 'Exhausted records land in a DLQ', '', (c) => topicsOf(c.g, 'dlq').some((t) => c.g.edges.some((e) => e.to === t.id))),
      R('wired', 'Every retry/DLQ strategy has topics to write to', '', (c) => noFlag(c.m, 'nodlq')),
      R('lag', 'No lag', '', (c) => noLag(c.m)),
    ],
    hints: ['Skip loses data; crash and block-retry stall.', 'onError = retry → DLQ, plus a topic with role “dlq” connected from the dispatcher.', 'Add topics webhooks-retry (role retry) + webhooks-dlq (role dlq); dispatcher → both; dispatcher onError = retry-dlq.'],
    reference: graph(
      [
        n('service', 'in', COL.a, ROW(1), { rate: 1000 }, 'webhook-receiver'),
        n('topic', 'wh', COL.b, ROW(1), { partitions: 6 }, 'webhooks'),
        n('group', 'disp', COL.c, ROW(1), { consumers: 6, procMs: 2, onError: 'retry-dlq' }, 'dispatcher'),
        n('sink', 'api', COL.d, ROW(1), { capacity: 5000, idempotentSink: true }, 'partner-api'),
        n('topic', 'retry', COL.d, ROW(0), { partitions: 6, role: 'retry', retentionH: 72 }, 'webhooks-retry'),
        n('topic', 'dlq', COL.d, ROW(2), { partitions: 1, role: 'dlq', retentionH: 720 }, 'webhooks-dlq'),
        n('group', 'rw', COL.e, ROW(0), { consumers: 2, procMs: 2, onError: 'retry-dlq' }, 'retry-worker'),
      ],
      ['in>wh', 'wh>disp', 'disp>api', 'disp>retry', 'disp>dlq', 'retry>rw', 'rw>dlq', 'rw>api'],
    ),
    debrief: 'Retry topics turn one blocking failure into an asynchronous detour. You give up strict per-key order for those records; decide explicitly whether that’s acceptable for each topic.',
  },
  challenge: {
    title: 'Payment provider callbacks',
    story: 'Payment-status callbacks (800/s) update the ledger. Callbacks get retried by the provider (duplicates!), some are malformed, and the ledger must be exact. Also, brokers get patched weekly.',
    start: graph(
      [
        n('service', 'cb', COL.a, ROW(1), { rate: 800, acks: '1' }, 'callback-api'),
        n('topic', 'cbt', COL.b, ROW(1), { partitions: 6, minIsr: 1 }, 'payment-callbacks'),
        n('group', 'led', COL.c, ROW(1), { consumers: 3, procMs: 2, onError: 'skip' }, 'ledger-updater'),
        n('sink', 'ldb', COL.d, ROW(1), { capacity: 10000, idempotentSink: false }, 'ledger-db'),
      ],
      ['cb>cbt', 'cbt>led', 'led>ldb'],
    ),
    palette: ['service', 'topic', 'group', 'sink'],
    reqs: [
      R('poison', 'Poison-safe', '', poisonSafe),
      R('once', 'Ledger effect exactly once (effectively-once)', '', (c) => semAtLeast(c.m, 'effectively-once')),
      R('dlq', 'DLQ wired', '', (c) => topicsOf(c.g, 'dlq').some((t) => c.g.edges.some((e) => e.to === t.id)) && noFlag(c.m, 'nodlq')),
      R('b1', 'Survives broker patching', '', survivesBrokerLoss),
    ],
    hints: ['Four independent problems: errors, duplicates, durability, routing.', 'Idempotent ledger writes (dedupe on provider event id); acks=all + min.insync 2.', 'onError retry-dlq + DLQ topic; sink idempotent; acks=all; min.insync=2.'],
    reference: graph(
      [
        n('service', 'cb', COL.a, ROW(1), { rate: 800, acks: 'all' }, 'callback-api'),
        n('topic', 'cbt', COL.b, ROW(1), { partitions: 6, minIsr: 2 }, 'payment-callbacks'),
        n('group', 'led', COL.c, ROW(1), { consumers: 3, procMs: 2, onError: 'retry-dlq' }, 'ledger-updater'),
        n('sink', 'ldb', COL.d, ROW(1), { capacity: 10000, idempotentSink: true }, 'ledger-db'),
        n('topic', 'dlq', COL.d, ROW(2), { partitions: 1, role: 'dlq', retentionH: 720 }, 'callbacks-dlq'),
      ],
      ['cb>cbt', 'cbt>led', 'led>ldb', 'led>dlq'],
    ),
    debrief: 'Real systems combine every lesson so far. Upstream duplicates (provider retries) make idempotency mandatory regardless of Kafka settings.',
  },
  quiz: [
    { q: 'Why doesn’t Kafka just redeliver a failed message later like SQS?', options: ['It does', 'Consumers track a single offset per partition; there’s no per-message ack or visibility timeout', 'It’s a bug'], answer: 1, explain: 'That design gives ordering and speed; failure routing is the application’s job (or share groups in 4.0).' },
    { q: 'Main cost of retry topics?', options: ['Disk', 'Per-key ordering for retried records', 'Exactly-once breaks'], answer: 1, explain: 'Later records overtake the retried one.' },
    { q: 'What should a DLQ record carry?', options: ['Just the value', 'Original key/value plus headers: source topic/partition/offset, error, attempts, timestamp', 'Only the error'], answer: 1, explain: 'You need context to debug and redrive.' },
  ],
  takeaways: ['Crash = stuck partition; skip = silent loss; block-retry = head-of-line blocking.', 'Retry topics + DLQ keep partitions flowing.', 'Retries break per-key order unless you park the key.', 'Monitor the DLQ and build redrive.'],
  interview: [
    { q: 'How do you handle poison messages in Kafka?', a: 'Catch deserialization (ErrorHandlingDeserializer) and processing errors; classify transient vs permanent; publish to retry topics with backoff headers and commit; after N attempts send to a DLQ with error metadata; alert on DLQ depth; provide redrive. Consider ordering: park the key if later events depend on earlier ones.' },
    { q: 'Kafka vs SQS for a job queue?', a: 'SQS has per-message visibility timeouts, redrive policies and no partition limit on concurrency, which is great for independent jobs. Kafka gives ordering, replay and high throughput, but failure handling and per-record parallelism are your job (or share groups in Kafka 4.0).' },
  ],
  deepDives: ['offsets', 'rebalance'],
};

/* ================================================================== */
/* 8. Retention vs compaction                                          */
/* ================================================================== */

const profStage = graph(
  [
    n('service', 'ps', COL.a, ROW(1), { rate: 500, msgBytes: 2000 }, 'profile-svc'),
    n('topic', 'prof', COL.b, ROW(1), { partitions: 6, retentionH: 168 }, 'user-profiles'),
    n('group', 'idx', COL.c, ROW(1), { consumers: 3, procMs: 1 }, 'search-indexer'),
  ],
  ['ps>prof', 'prof>idx'],
);

export const L8: Lesson = {
  id: 'retention',
  n: 8,
  title: 'Retention vs compaction',
  tagline: 'A log of events, or a table of latest values?',
  minutes: 11,
  concepts: ['time/size retention', 'segments are deleted whole', 'log compaction', 'tombstones', 'cleaner & dirty ratio', 'lag vs retention (OffsetOutOfRange)', 'tiered storage'],
  problem: 'A new service needs every user’s current profile, but the topic only keeps 7 days. And a reporting job lost data after a long weekend.',
  stage: profStage,
  learn: [
    {
      title: 'Delete retention',
      body: '`cleanup.policy=delete` + `retention.ms` (7 days by default). The broker deletes whole **closed segments** whose newest record is older than retention. Retention is about time (or `retention.bytes`), not about whether anyone consumed the data.',
      internals: 'The active segment is never deleted; a segment rolls at `segment.bytes` (1 GB) or `segment.ms` (7 d). So with low traffic, data can live much longer than retention.ms.',
      focus: 'prof',
    },
    {
      title: 'Bootstrapping a new service',
      body: 'A recommendations service wants to build its local view of every user’s profile from this topic.',
      predict: {
        q: 'It reads `user-profiles` from the earliest offset. What does it get?',
        options: ['Every user’s current profile', 'Only users who changed in the last 7 days', 'Nothing until new events arrive'],
        answer: 1,
        explain: 'Older records were deleted. Users who haven’t changed their profile in a week are simply missing.',
      },
      focus: 'prof',
    },
    {
      title: 'Compaction',
      body: '`cleanup.policy=compact`: the log keeps **at least the latest record per key**. Older values for the same key are removed in the background. The topic becomes a replayable table: read from 0 and you get the current state of every key.',
      ops: [{ set: ['prof', { cleanup: 'compact' }] }],
      internals: 'The log cleaner thread builds an offset map (key → latest offset) over the “dirty” section, then rewrites older segments without superseded records. It runs when the dirty ratio exceeds `min.cleanable.dirty.ratio` (0.5). Offsets are preserved (gaps appear) and order is never changed. A **tombstone** (key, null) deletes the key after `delete.retention.ms`.',
      focus: 'prof',
    },
    {
      title: 'Compaction needs keys',
      body: 'A producer sends profile updates without a key.',
      predict: {
        q: 'What does the broker do with null-key records on a compacted topic?',
        options: ['Keeps them forever', 'Rejects them: compaction needs a key', 'Assigns a random key'],
        answer: 1,
        explain: 'The broker returns an error for keyless records on compacted topics. Every record must be keyed by entity id.',
      },
      ops: [{ set: ['ps', { key: 'null' }] }],
      focus: 'ps',
    },
    {
      title: 'Lag meets retention',
      body: 'Back to keyed records, but now a 24 h delete-retention topic, and the indexer becomes 5× slower over a long weekend.',
      predict: {
        q: 'The consumer falls further behind than the retention window. What happens?',
        options: ['Kafka keeps the data until it’s consumed', 'Its committed offset is deleted → OffsetOutOfRange → auto.offset.reset jumps to earliest or latest, so data is skipped', 'The consumer crashes permanently'],
        answer: 1,
        explain: 'Retention doesn’t care about consumers. With `auto.offset.reset=latest`, the gap is silently skipped. Alert on lag in **time**, and size retention for the longest outage you must survive.',
      },
      ops: [{ set: ['ps', { key: 'entity' }] }, { set: ['prof', { cleanup: 'delete', retentionH: 24 }] }, { set: ['idx', { procMs: 2.5 }] }],
      chaos: { slowGroup: 'idx' },
      focus: 'idx',
    },
    {
      title: 'Tiered storage',
      body: 'KIP-405 (GA in 3.9) offloads closed segments to object storage (S3) while brokers keep the recent ones locally. Long retention becomes cheap and broker disks small. Consumers reading old data fetch transparently from the remote tier (slower).',
    },
  ],
  build: {
    title: 'A profile table any service can bootstrap from',
    story: '`profile-svc` publishes 500 profile updates/s (~2 KB) for 2M users. New services must be able to rebuild every user’s **current** profile from Kafka at any time. Storage budget: 50 GB.',
    start: profStage,
    palette: ['service', 'topic', 'group', 'sink'],
    reqs: [
      R('table', 'Latest profile of every user is always available', '', (c) => c.g.nodes.some((x) => x.kind === 'topic' && cfgOf(x).cleanup === 'compact' && c.g.edges.some((e) => e.to === x.id))),
      R('keys', 'Records are keyed for compaction', '', (c) => noFlag(c.m, 'cmpnull') && noFlag(c.m, 'cmprnd')),
      R('disk', 'Disk under 50 GB', '', (c) => c.m.metrics.diskGB < 50),
      R('order', 'Per-user order', '', (c) => ordAtLeast(c.m, 'per-key')),
    ],
    hints: ['Infinite delete-retention gives unbounded disk.', 'Compaction keeps the latest value per key, so disk ≈ keys × size × RF.', 'cleanup.policy=compact, key = userId.'],
    reference: graph(
      [
        n('service', 'ps', COL.a, ROW(1), { rate: 500, msgBytes: 2000 }, 'profile-svc'),
        n('topic', 'prof', COL.b, ROW(1), { partitions: 6, cleanup: 'compact' }, 'user-profiles'),
        n('group', 'idx', COL.c, ROW(1), { consumers: 3, procMs: 1 }, 'search-indexer'),
      ],
      ['ps>prof', 'prof>idx'],
    ),
    debrief: 'Compacted topics are how Kafka Streams state stores, `__consumer_offsets` and Connect configs work: a durable, replayable key-value table.',
  },
  challenge: {
    title: 'Surviving a long weekend',
    story: '`clicks` (2,000/s, 1 KB) keeps 24 h. `reporting` (3 consumers, 1 ms each) gets 5× slower when the warehouse is under weekend maintenance (~60 h). No data may be skipped. Disk budget: 2 TB.',
    start: graph(
      [
        n('service', 'web', COL.a, ROW(1), { rate: 2000 }, 'web'),
        n('topic', 'clk', COL.b, ROW(1), { partitions: 6, retentionH: 24 }, 'clicks'),
        n('group', 'rep', COL.c, ROW(1), { consumers: 3, procMs: 1 }, 'reporting'),
      ],
      ['web>clk', 'clk>rep'],
    ),
    palette: ['service', 'topic', 'group', 'sink'],
    reqs: [
      R('weekend', 'No data skipped during a 60 h slowdown', '', (c) => {
        const m = c.under({ slowGroup: 'rep' });
        const g = m.groups.rep;
        return !!g && (g.lagGrowth <= 1 || (g.hoursToRetentionLoss ?? Infinity) >= 60);
      }),
      R('disk', 'Disk ≤ 2 TB', '', (c) => c.m.metrics.diskGB <= 2000),
      R('lag', 'No lag normally', '', (c) => noLag(c.m)),
    ],
    hints: ['Either keep data longer than the backlog lasts, or don’t build a backlog.', 'Hours until loss = retention ÷ (lag growth ÷ input rate).', 'retention 72 h (≈1.5 TB), or 6+ partitions and consumers so even 5× slower keeps up.'],
    reference: graph(
      [
        n('service', 'web', COL.a, ROW(1), { rate: 2000 }, 'web'),
        n('topic', 'clk', COL.b, ROW(1), { partitions: 12, retentionH: 24 }, 'clicks'),
        n('group', 'rep', COL.c, ROW(1), { consumers: 12, procMs: 1 }, 'reporting'),
      ],
      ['web>clk', 'clk>rep'],
    ),
    debrief: 'Two valid answers with different costs: more retention costs disk, more consumers cost compute and need partitions. Engineering is choosing the cheaper one for *your* failure mode.',
  },
  quiz: [
    { q: 'Compacted topic, key K written 5 times. After cleaning, what remains?', options: ['All 5', 'At least the latest value of K', 'None'], answer: 1, explain: '“At least”: the active segment isn’t compacted, so recent duplicates may remain.' },
    { q: 'How do you delete a key from a compacted topic?', options: ['Admin API', 'Write a tombstone (key, null value)', 'Lower retention'], answer: 1, explain: 'The tombstone survives delete.retention.ms so consumers see it, then disappears.' },
    { q: 'A consumer’s committed offset was deleted by retention. With auto.offset.reset=latest?', options: ['It reprocesses everything', 'It jumps to the end, so the gap is skipped silently', 'It crashes'], answer: 1, explain: 'That’s why lag-in-time alerts and generous retention matter.' },
  ],
  takeaways: ['delete = event history window; compact = latest value per key (a table).', 'Compaction needs keys; tombstones delete keys.', 'Retention ignores consumers: alert on lag in time.', 'Tiered storage makes long retention cheap.'],
  interview: [
    { q: 'When would you use log compaction?', a: 'When consumers need the latest state per key rather than full history: changelogs for state stores, CDC tables, config/feature flags, user profiles, `__consumer_offsets`. Not for event sourcing (you need every event) or when keys are unique.' },
    { q: 'How does Kafka delete old data?', a: 'Per partition the log is split into segments. A background task deletes closed segments older than retention.ms or beyond retention.bytes (delete policy), or the log cleaner rewrites segments keeping the latest per key (compact). Never per record, and never the active segment.' },
  ],
  deepDives: ['compaction', 'tiered', 'log'],
};

/* ================================================================== */
/* 9. CDC & the outbox pattern                                         */
/* ================================================================== */

const cdcStage = graph(
  [
    n('service', 'api', COL.a, ROW(1), { rate: 1000 }, 'orders-api'),
    n('postgres', 'db', COL.b, ROW(2), {}, 'orders-db'),
    n('topic', 'oe', COL.c, ROW(1), { partitions: 6 }, 'order-events'),
    n('group', 'ship', COL.d, ROW(1), { consumers: 3, procMs: 1 }, 'shipping'),
    n('sink', 'sdb', COL.e, ROW(1), { idempotentSink: false }, 'shipping-db'),
  ],
  ['api>db', 'api>oe', 'oe>ship', 'ship>sdb'],
);

export const L9: Lesson = {
  id: 'cdc',
  n: 9,
  title: 'CDC & the transactional outbox',
  tagline: 'Never write to the DB and Kafka separately.',
  minutes: 13,
  concepts: ['dual-write problem', 'polling publisher', 'Debezium & the WAL', 'replication slots', 'transactional outbox', 'outbox event router', 'snapshot + streaming'],
  problem: 'Shipping occasionally ships orders that were rolled back, and sometimes never hears about orders that exist. Classic dual write.',
  stage: cdcStage,
  learn: [
    {
      title: 'The dual write',
      body: '`orders-api` commits the order to Postgres **and** calls `producer.send()`. Two systems, no shared transaction.',
      predict: {
        q: 'The DB commit succeeds, then the pod is OOM-killed before the send. What does shipping see?',
        options: ['The order, a bit later', 'Nothing, ever: the DB says the order exists, Kafka never heard of it', 'A duplicate'],
        answer: 1,
        explain: 'Nothing retries a send that never happened. Reversing the order (send, then commit) just flips the bug: events for orders that rolled back. There is no ordering of two writes that is atomic.',
      },
      focus: 'api',
    },
    {
      title: 'Polling publisher?',
      body: 'Replace the send with a job that runs `SELECT … WHERE updated_at > :last` every few seconds and publishes the rows.',
      ops: [{ unlink: ['api', 'oe'] }, { add: n('poller', 'poll', COL.b, ROW(0), {}, 'poller-job') }, { link: ['db', 'poll'] }, { link: ['poll', 'oe'] }],
      internals: 'It misses intermediate states (two updates between polls → one event), can’t see DELETEs, misses rows whose transactions commit late with an older `updated_at`, adds seconds of latency and loads the primary.',
      focus: 'poll',
    },
    {
      title: 'Change data capture',
      body: '**Debezium** (a Kafka Connect source) reads Postgres’ **write-ahead log** via a logical replication slot. Every committed insert/update/delete becomes an event, in commit order, keyed by primary key. No missed changes, no dual write, no polling.',
      ops: [{ remove: 'poll' }, { add: n('cdc', 'dbz', COL.b, ROW(0), { key: 'entity' }, 'debezium') }, { link: ['db', 'dbz'] }, { link: ['dbz', 'oe'] }],
      internals: 'Debezium first takes a consistent **snapshot**, then streams from the slot’s LSN. It stores its source position in Connect’s offsets topic. After a crash it resumes from the last *stored* LSN, so some events repeat: CDC is **at-least-once**.',
      focus: 'dbz',
    },
    {
      title: 'The outbox pattern',
      body: 'Raw table CDC leaks your schema to consumers. Instead, in the **same DB transaction** as the business write, insert a row into an `outbox` table (aggregate id, type, payload). Debezium’s **outbox event router** turns those rows into clean domain events keyed by aggregate id. Atomic, ordered per aggregate, and decoupled from internal tables.',
      internals: '`BEGIN; INSERT INTO orders …; INSERT INTO outbox(id, aggregate_type, aggregate_id, type, payload) …; COMMIT;` Then delete outbox rows right away (the WAL still has them) or clean them up periodically.',
      focus: 'db',
    },
    {
      title: 'Consumers still see duplicates',
      body: 'CDC replays after restarts, and consumers commit after processing. Make `shipping-db` writes idempotent by deduping on the outbox **event id**.',
      ops: [{ set: ['sdb', { idempotentSink: true }] }],
      focus: 'sdb',
    },
    {
      title: 'Operational trap: the replication slot',
      body: 'A replication slot makes Postgres **retain WAL** until the slot confirms it.',
      predict: {
        q: 'Debezium is down for a day on a busy database. What happens to Postgres?',
        options: ['Nothing', 'WAL piles up on disk and can fill it, taking the primary down', 'The slot is dropped automatically'],
        answer: 1,
        explain: 'Monitor slot lag (`pg_replication_slots`), set `max_slot_wal_keep_size`, and alert when the connector stops. The same applies to MySQL binlog retention.',
      },
    },
  ],
  build: {
    title: 'Fix the dual write',
    story: '`orders-api` (1,000 orders/s) writes Postgres and publishes to Kafka separately. Shipping must see every committed order, never one that rolled back, and must not create duplicate shipments.',
    start: cdcStage,
    palette: ['service', 'postgres', 'cdc', 'poller', 'memqueue', 'topic', 'group', 'sink'],
    reqs: [
      R('dual', 'No dual write', '', (c) => noFlag(c.m, 'dual')),
      R('cdc', 'Events derived from committed DB changes', '', (c) => has(c.g, 'cdc') && !has(c.g, 'poller') && !has(c.g, 'memqueue')),
      R('flow', 'Shipping receives every order', '', (c) => c.m.metrics.connected && noLag(c.m)),
      R('once', 'No duplicate shipments', '', (c) => semAtLeast(c.m, 'effectively-once')),
    ],
    hints: ['Let the database be the only thing the service writes to.', 'Postgres → Debezium (CDC) → topic, with an outbox table for clean events.', 'Remove orders-api → order-events; add CDC: orders-db → debezium → order-events; shipping-db idempotent.'],
    reference: graph(
      [
        n('service', 'api', COL.a, ROW(1), { rate: 1000 }, 'orders-api'),
        n('postgres', 'db', COL.b, ROW(2), {}, 'orders-db'),
        n('cdc', 'dbz', COL.b, ROW(0), { key: 'entity' }, 'debezium'),
        n('topic', 'oe', COL.c, ROW(1), { partitions: 6 }, 'order-events'),
        n('group', 'ship', COL.d, ROW(1), { consumers: 3, procMs: 1 }, 'shipping'),
        n('sink', 'sdb', COL.e, ROW(1), { idempotentSink: true }, 'shipping-db'),
      ],
      ['api>db', 'db>dbz', 'dbz>oe', 'oe>ship', 'ship>sdb'],
    ),
    debrief: 'The outbox + CDC pattern is the standard answer to “how do I update my DB and publish an event reliably?” in microservices interviews. Mention atomicity, ordering per aggregate, at-least-once and idempotent consumers.',
  },
  challenge: {
    title: 'Keep the search index in sync',
    story: '`catalog-api` (500 updates/s) writes products to Postgres and also pushes them into an in-memory queue that drains to Kafka; an indexer loads Elasticsearch. Products go missing after every deploy. The index must be rebuildable from Kafka at any time, ordered per product.',
    start: graph(
      [
        n('service', 'cat', COL.a, ROW(1), { rate: 500 }, 'catalog-api'),
        n('postgres', 'pdb', COL.b, ROW(2), {}, 'products-db'),
        n('memqueue', 'buf', COL.b, ROW(0), {}, 'in-memory buffer'),
        n('topic', 'pt', COL.c, ROW(1), { partitions: 6 }, 'products'),
        n('group', 'ix', COL.d, ROW(1), { consumers: 3, procMs: 1 }, 'indexer'),
        n('sink', 'es', COL.e, ROW(1), { idempotentSink: false }, 'elasticsearch'),
      ],
      ['cat>pdb', 'cat>buf', 'buf>pt', 'pt>ix', 'ix>es'],
    ),
    palette: ['service', 'postgres', 'cdc', 'poller', 'memqueue', 'topic', 'group', 'sink'],
    reqs: [
      R('cdc', 'Every committed change reaches Kafka (CDC, no buffer)', '', (c) => has(c.g, 'cdc') && !has(c.g, 'memqueue') && !has(c.g, 'poller') && noFlag(c.m, 'dual')),
      R('rebuild', 'Index rebuildable from Kafka (latest per product kept)', '', (c) => topicCfg(c).some((t) => t.cleanup === 'compact')),
      R('once', 'Index writes are idempotent', '', (c) => semAtLeast(c.m, 'effectively-once')),
      R('order', 'Per-product order', '', (c) => ordAtLeast(c.m, 'per-key')),
    ],
    hints: ['In-memory buffers lose everything on restart.', 'CDC + a compacted products topic = a replayable table; ES upserts by id are idempotent.', 'Delete the buffer; products-db → debezium → products (compact); elasticsearch idempotent.'],
    reference: graph(
      [
        n('service', 'cat', COL.a, ROW(1), { rate: 500 }, 'catalog-api'),
        n('postgres', 'pdb', COL.b, ROW(2), {}, 'products-db'),
        n('cdc', 'dbz', COL.b, ROW(0), { key: 'entity' }, 'debezium'),
        n('topic', 'pt', COL.c, ROW(1), { partitions: 6, cleanup: 'compact' }, 'products'),
        n('group', 'ix', COL.d, ROW(1), { consumers: 3, procMs: 1 }, 'indexer'),
        n('sink', 'es', COL.e, ROW(1), { idempotentSink: true }, 'elasticsearch'),
      ],
      ['cat>pdb', 'pdb>dbz', 'dbz>pt', 'pt>ix', 'ix>es'],
    ),
    debrief: 'CDC into a compacted topic is a reusable pattern: any number of derived stores (search, cache, analytics) can be rebuilt by replaying from offset 0.',
  },
  quiz: [
    { q: 'Why is “commit DB, then send to Kafka” unsafe?', options: ['Kafka is slow', 'A crash between the two loses the event; there’s no atomicity across systems', 'Ordering'], answer: 1, explain: 'Dual writes can’t be made atomic without a shared transaction log.' },
    { q: 'How does Debezium read Postgres changes?', options: ['Polling tables', 'Logical decoding of the WAL via a replication slot', 'Triggers'], answer: 1, explain: 'The pgoutput plugin streams committed changes in commit order.' },
    { q: 'Delivery guarantee of Debezium CDC?', options: ['Exactly-once', 'At-least-once: replays after restart', 'At-most-once'], answer: 1, explain: 'Connect stores the source offset periodically. (Kafka 3.3+ supports exactly-once source connectors with transactions for supporting connectors.)' },
  ],
  takeaways: ['Dual writes are never atomic: write only to the DB.', 'Outbox table in the same transaction + CDC = reliable events.', 'CDC is at-least-once: consumers dedupe on event id.', 'Monitor replication slot lag.'],
  interview: [
    { q: 'How do you reliably publish an event when you update your database?', a: 'Transactional outbox: write the business row and an outbox row in one DB transaction; Debezium reads the WAL and publishes outbox rows to Kafka keyed by aggregate id. Atomic, ordered per aggregate, no 2PC. Consumers must be idempotent because CDC is at-least-once.' },
    { q: 'CDC vs application events?', a: 'CDC captures every committed change with no app code and can’t miss writes, but exposes table schemas (fix with outbox). App events carry intent but risk dual writes unless you use an outbox. Most teams use outbox + CDC.' },
  ],
  deepDives: ['transactions'],
};

/* ================================================================== */
/* 10. Event sourcing, Streams & schemas                               */
/* ================================================================== */

const esStage = graph(
  [
    n('service', 'cmd', COL.a, ROW(1), { rate: 2000 }, 'account-commands'),
    n('topic', 'ev', COL.b, ROW(1), { partitions: 12, retentionH: 168 }, 'account-events'),
    n('streams', 'proj', COL.c, ROW(1), { consumers: 6, procMs: 0.5, eos: false }, 'balance-projector'),
    n('topic', 'bal', COL.d, ROW(1), { partitions: 12, cleanup: 'compact', role: 'changelog' }, 'balances'),
    n('group', 'bapi', COL.e, ROW(1), { consumers: 3, procMs: 0.5 }, 'balance-api'),
  ],
  ['cmd>ev', 'ev>proj', 'proj>bal', 'bal>bapi'],
);

export const L10: Lesson = {
  id: 'streams',
  n: 10,
  title: 'Event sourcing, Streams & schemas',
  tagline: 'The log as the source of truth.',
  minutes: 14,
  concepts: ['event sourcing', 'projections / read models', 'Kafka Streams tasks & state stores', 'changelog topics & RocksDB', 'co-partitioning for joins', 'replay & reprocessing', 'schema registry & compatibility'],
  problem: 'Account balances must be auditable and rebuildable after a bug, and several teams consume the same events without breaking each other.',
  stage: esStage,
  learn: [
    {
      title: 'Events are the source of truth',
      body: 'Instead of updating a balance row, append facts: `Deposited`, `Withdrawn`. The current balance is a **projection** computed by folding events per account. The `account-events` topic must keep **every** event: retention forever (-1), cleanup = delete. Compaction would erase history.',
      ops: [{ set: ['ev', { retentionH: -1 }] }],
      focus: 'ev',
    },
    {
      title: 'How Kafka Streams scales',
      body: 'A Streams app splits into **tasks**, one per input partition. Each task has a local **state store** (RocksDB) backed by a compacted **changelog topic**. Run more instances, and tasks (and their state) move between them.',
      internals: 'On failover, the new owner restores the store by replaying its changelog. That can take minutes for big stores, so use `num.standby.replicas=1` to keep a warm copy on another instance.',
      focus: 'proj',
    },
    {
      title: 'A bug in the projection',
      body: 'A rounding bug wrote wrong balances for a week.',
      predict: {
        q: 'How do you fix historical balances?',
        options: ['Write a SQL migration', 'Fix the code, reset the app (new application.id or reset tool) and replay from offset 0 into a new output', 'Impossible'],
        answer: 1,
        explain: 'Because events are retained, the projection is disposable: rebuild it into `balances-v2`, then switch readers. That is the superpower of event sourcing, and it only works with infinite retention on the event topic.',
      },
      focus: 'proj',
    },
    {
      title: 'Exactly-once for the projection',
      body: 'A crash without EOS re-applies events since the last commit, and deposits are counted twice. Enable `processing.guarantee=exactly_once_v2`.',
      ops: [{ set: ['proj', { eos: true }] }],
      focus: 'proj',
    },
    {
      title: 'Schema evolution',
      body: 'Three teams consume `account-events`.',
      predict: {
        q: 'The producer renames `amount` → `value` and deploys. No schema registry. What happens?',
        options: ['Consumers adapt', 'Every consumer that reads `amount` breaks at once', 'Kafka rejects the record'],
        answer: 1,
        explain: 'Kafka stores bytes and doesn’t validate. A **schema registry** stores versioned Avro/Protobuf/JSON schemas, and the serializer embeds a schema id. The registry rejects incompatible changes at **produce time**. Use BACKWARD compatibility: add optional fields, never rename or remove required ones.',
      },
      ops: [{ add: n('registry', 'sr', COL.c, ROW(0), {}, 'schema-registry') }, { link: ['cmd', 'sr'] }, { link: ['bapi', 'sr'] }],
      focus: 'sr',
    },
    {
      title: 'Joins need co-partitioning',
      body: 'To join two topics (say `orders` and `payments` by orderId), Kafka Streams reads partition *i* of both in the same task. So both must have the **same partition count** and the **same key**, or Streams repartitions one side through an internal topic.',
    },
  ],
  build: {
    title: 'An event-sourced ledger',
    story: 'Account commands produce 2,000 events/s. Balances are projected by a Streams app and served by `balance-api`. Requirements: full history replayable, balances exactly right, three teams consume the events safely.',
    start: esStage,
    palette: ['service', 'topic', 'streams', 'group', 'sink', 'registry'],
    reqs: [
      R('history', 'Full event history kept (replayable)', '', (c) => c.g.nodes.some((x) => x.id === 'ev' && cfgOf(x).retentionH < 0 && cfgOf(x).cleanup === 'delete'), 'retention.ms=-1, cleanup=delete.'),
      R('eos', 'Projection exactly-once', '', (c) => c.g.nodes.filter((x) => x.kind === 'streams').every((x) => cfgOf(x).eos)),
      R('schema', 'Schema registry guards the event contract', '', (c) => has(c.g, 'registry')),
      R('order', 'Per-account order', '', (c) => ordAtLeast(c.m, 'per-key')),
      R('lag', 'No lag', '', (c) => noLag(c.m)),
    ],
    hints: ['History, correctness and contracts: three separate settings.', 'Infinite retention on the event topic; EOS on the projector; add a registry.', 'account-events retention forever; projector EOS on; add schema-registry.'],
    reference: graph(
      [
        n('service', 'cmd', COL.a, ROW(1), { rate: 2000 }, 'account-commands'),
        n('topic', 'ev', COL.b, ROW(1), { partitions: 12, retentionH: -1 }, 'account-events'),
        n('streams', 'proj', COL.c, ROW(1), { consumers: 6, procMs: 0.5, eos: true }, 'balance-projector'),
        n('topic', 'bal', COL.d, ROW(1), { partitions: 12, cleanup: 'compact', role: 'changelog' }, 'balances'),
        n('group', 'bapi', COL.e, ROW(1), { consumers: 3, procMs: 0.5 }, 'balance-api'),
        n('registry', 'sr', COL.c, ROW(0), {}, 'schema-registry'),
      ],
      ['cmd>ev', 'ev>proj', 'proj>bal', 'bal>bapi', 'cmd>sr', 'bapi>sr'],
    ),
    debrief: 'Event sourcing trades simple CRUD for auditability and replay. Costs: eventual consistency of read models, schema evolution discipline, and growing storage (tiered storage, snapshots).',
  },
  challenge: {
    title: 'Join orders with payments',
    story: 'A Streams app joins `orders` (12 partitions) with `payments` (6 partitions, keyed randomly) by orderId to emit `paid-orders`. Matches go missing. Make the join correct and exactly-once.',
    start: graph(
      [
        n('service', 'o', COL.a, ROW(0), { rate: 3000 }, 'orders-api'),
        n('service', 'p', COL.a, ROW(2), { rate: 3000, key: 'random' }, 'payments-api'),
        n('topic', 'ot', COL.b, ROW(0), { partitions: 12 }, 'orders'),
        n('topic', 'pt', COL.b, ROW(2), { partitions: 6 }, 'payments'),
        n('streams', 'j', COL.c, ROW(1), { consumers: 6, procMs: 0.2, eos: false }, 'order-payment-join'),
        n('topic', 'po', COL.d, ROW(1), { partitions: 12 }, 'paid-orders'),
      ],
      ['o>ot', 'p>pt', 'ot>j', 'pt>j', 'j>po'],
    ),
    palette: ['service', 'topic', 'streams', 'group', 'registry'],
    reqs: [
      R('copart', 'Inputs co-partitioned (same count)', '', (c) => noFlag(c.m, 'copart:')),
      R('key', 'Both inputs keyed by orderId', '', (c) => noFlag(c.m, 'copartkey')),
      R('eos', 'Exactly-once', '', (c) => semAtLeast(c.m, 'exactly-once')),
      R('lag', 'No lag', '', (c) => noLag(c.m)),
    ],
    hints: ['A join task reads partition i of each input.', 'Same partition count and the same key on both inputs.', 'payments → 12 partitions, key = entity (orderId); join EOS on.'],
    reference: graph(
      [
        n('service', 'o', COL.a, ROW(0), { rate: 3000 }, 'orders-api'),
        n('service', 'p', COL.a, ROW(2), { rate: 3000, key: 'entity' }, 'payments-api'),
        n('topic', 'ot', COL.b, ROW(0), { partitions: 12 }, 'orders'),
        n('topic', 'pt', COL.b, ROW(2), { partitions: 12 }, 'payments'),
        n('streams', 'j', COL.c, ROW(1), { consumers: 6, procMs: 0.2, eos: true }, 'order-payment-join'),
        n('topic', 'po', COL.d, ROW(1), { partitions: 12 }, 'paid-orders'),
      ],
      ['o>ot', 'p>pt', 'ot>j', 'pt>j', 'j>po'],
    ),
    debrief: 'Co-partitioning is the hidden contract behind every stream join. In Kafka Streams, `selectKey` + `repartition()` fixes it at the cost of an extra internal topic hop.',
  },
  quiz: [
    { q: 'Event-sourced topic: which cleanup policy?', options: ['compact', 'delete with infinite retention', 'delete with 7 days'], answer: 1, explain: 'Compaction erases history; 7 days can’t replay.' },
    { q: 'Where does a Kafka Streams state store live?', options: ['Only in memory', 'Local RocksDB, backed up to a compacted changelog topic', 'In the broker'], answer: 1, explain: 'Local for speed, changelog for recovery.' },
    { q: 'What does BACKWARD compatibility allow?', options: ['New consumers can read data written with the previous schema', 'Old consumers read new data', 'Any change'], answer: 0, explain: 'Upgrade consumers first. FORWARD is the reverse; FULL is both.' },
  ],
  takeaways: ['Event topic: infinite retention, delete policy; projections are disposable.', 'Streams = tasks per partition + RocksDB + changelog topics.', 'Joins require co-partitioning.', 'Schema registry enforces contracts at produce time.'],
  interview: [
    { q: 'How does Kafka Streams achieve fault-tolerant state?', a: 'Each task’s state store (RocksDB) logs every update to a compacted changelog topic. On failover, the new owner replays the changelog (or uses a standby replica). With exactly_once_v2, store updates, outputs and offsets commit atomically.' },
    { q: 'How do you evolve event schemas safely?', a: 'Schema registry with Avro/Protobuf, compatibility mode BACKWARD (or FULL), only add optional fields with defaults, never reuse or rename fields, upgrade consumers before producers, and for breaking changes publish to a new topic version with a migration period.' },
  ],
  deepDives: ['streams', 'transactions', 'kraft'],
};


export const LESSONS_B = [L6, L7, L8, L9, L10];
