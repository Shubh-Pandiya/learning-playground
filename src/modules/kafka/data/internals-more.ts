/**
 * Deep dives added for SDE-3 depth: the producer client, offset commits, retention + tiered storage
 * and Kafka Streams state. Same Frame/Viz contract as internals.ts; deep extras are inline.
 */
import type { Dive } from './internals';

export const MORE_DIVES: Dive[] = [
  /* -------------------------------------------------------------- */
  {
    id: 'producer',
    title: 'Inside the producer',
    tagline: 'RecordAccumulator, the sender thread, linger, acks and delivery.timeout.',
    minutes: 9,
    oneLiner: 'send() only serializes, partitions and appends to a per-partition batch in a bounded buffer; a background sender thread drains ready batches per broker, retries until delivery.timeout.ms, and completes your future with the offset.',
    frames: [
      {
        title: 'send() does not send',
        body: '`producer.send(record)` runs in **your** thread: serialize key/value, pick a partition, then append into the **RecordAccumulator**, a map of partition → deque of batches inside `buffer.memory` (32 MB). It returns a Future immediately. Network I/O happens on a separate **sender thread**.',
        viz: { kind: 'path', title: 'caller thread', stages: [{ label: 'send()' }, { label: 'serialize', sub: 'key + value' }, { label: 'partitioner', sub: 'murmur2 or sticky' }, { label: 'RecordAccumulator', sub: 'deque per partition', hot: true }, { label: 'Future', sub: 'returned now' }] },
        predict: {
          q: 'The brokers are unreachable and buffer.memory is full. What does the next send() call do?',
          options: ['Throws immediately', 'Blocks the caller for up to max.block.ms (60 s), then throws a TimeoutException', 'Drops the oldest batch to make room', 'Writes to a local spill file'],
          answer: 1,
          explain: 'A full accumulator applies **back-pressure on your thread**: send() blocks for up to `max.block.ms` (also used for metadata fetches). A request thread calling send() can hang for 60 s, which is a classic outage amplifier. Size the buffer, set max.block.ms deliberately, and shed load upstream.',
        },
      },
      {
        title: 'When is a batch ready?',
        body: 'The sender wakes and asks the accumulator for batches that are **full** (`batch.size`, 16 KB) or **old enough** (`linger.ms`; 5 ms default since Kafka 4.0, 0 before). It groups ready batches **by destination broker** and sends one ProduceRequest per broker containing batches for many partitions.',
        viz: { kind: 'path', title: 'sender thread', stages: [{ label: 'ready batches', sub: 'full or lingered' }, { label: 'group by leader', sub: 'broker 1, 2, 3', hot: true }, { label: 'ProduceRequest', sub: 'many partitions' }, { label: 'in-flight ≤ 5', sub: 'per connection' }] },
      },
      {
        title: 'acks decide when the Future completes',
        body: '`acks=0`: done once written to the socket (no offset, no error). `acks=1`: the leader appended it. `acks=all`: every **in-sync** replica has it, and the leader rejects the write if ISR < `min.insync.replicas`. Since Kafka 3.0 the default is `acks=all` with `enable.idempotence=true`.',
        viz: { kind: 'replicas', replicas: [{ name: 'b1', leo: 120, leader: true, isr: true }, { name: 'b2', leo: 120, isr: true }, { name: 'b3', leo: 117, isr: true }], hw: 117, note: 'acks=all waits until the high watermark passes your batch.' },
        predict: {
          q: 'acks=all, RF=3, min.insync.replicas=1. Two followers drop out of the ISR. What do writes do?',
          options: ['Fail with NOT_ENOUGH_REPLICAS', 'Succeed, and are acknowledged by the leader alone', 'Block until a follower returns'],
          answer: 1,
          explain: '`acks=all` means "all **current** ISR members". With minISR=1 the ISR can shrink to just the leader, so acks=all silently degrades to acks=1. That is why the durability pair is **acks=all and min.insync.replicas=2**.',
        },
      },
      {
        title: 'Retries, ordering and the delivery timeout',
        body: 'Failed batches go back to the **front** of their deque. Retries are effectively unlimited (`retries=MAX_INT`), bounded instead by `delivery.timeout.ms` (120 s) covering linger + in-flight + retries. Without idempotence and with `max.in.flight.requests.per.connection > 1`, a retried batch 1 can land **after** batch 2 and reorder records. Idempotence fixes this for in-flight ≤ 5 via sequence numbers.',
        viz: { kind: 'seq', pid: 7, epoch: 0, batches: [{ seq: 0, state: 'ok' }, { seq: 1, state: 'gap' }, { seq: 2, state: 'ok' }, { seq: 1, state: 'new' }], note: 'Batch 1 failed and was retried after 2. Sequence numbers let the broker reject 2 until 1 lands, preserving order.' },
        predict: {
          q: 'A send() Future fails with a TimeoutException after delivery.timeout.ms. Was the record written?',
          options: ['No, a timeout means it was never appended', 'Maybe: the broker may have appended it and the response was lost', 'Yes, timeouts only happen after the append'],
          answer: 1,
          explain: 'A timeout is an **unknown outcome**. If you resend from application code you create a duplicate that idempotence cannot catch, because it is a new record with a new sequence. Treat producer timeouts like any distributed call: make consumers idempotent or use transactions.',
        },
      },
      {
        title: 'Compression and the size limits',
        body: 'Compression (`compression.type` = lz4, zstd, snappy or gzip) applies to the **whole batch**, so larger batches compress better. A batch is checked against the broker’s `message.max.bytes` (≈1 MB) **after** compression, while the client’s `max.request.size` (1 MB) is checked against the uncompressed record. Large payloads belong in object storage, with Kafka carrying only a reference (the claim-check pattern).',
        viz: { kind: 'path', title: 'one batch', stages: [{ label: '1,000 × 1 KB JSON' }, { label: 'batch', sub: '1 MB raw' }, { label: 'zstd', sub: '≈ 150 KB', hot: true }, { label: 'broker', sub: 'stored compressed' }, { label: 'consumer', sub: 'decompresses' }] },
      },
    ],
    design: [
      { decision: 'Accumulator plus a single sender thread', because: 'Your thread never waits on the network unless the buffer is full. One I/O thread multiplexes all brokers, which makes batching across partitions natural.' },
      { decision: 'Timeout bounds instead of retry counts', because: '`delivery.timeout.ms` gives a user-facing SLA ("tell me within 2 minutes") independent of backoff tuning (KIP-91).' },
      { decision: 'Idempotence on by default (3.0+)', because: 'Duplicates and reordering from retries were the most common silent bug, and fixing them costs almost nothing.' },
      { decision: 'Sticky partitioning for null keys (KIP-480)', because: 'Filling one partition’s batch before moving on gives bigger batches, which cut latency by up to 50% versus round-robin in the KIP benchmarks.' },
    ],
    interview: [
      { q: 'Walk me through what happens when you call producer.send().', a: 'In the caller thread: interceptors, serialize, partition (murmur2 of the key, or sticky for null keys), append to the per-partition batch in the RecordAccumulator (blocking up to max.block.ms if buffer.memory is full). The sender thread drains batches that are full or past linger.ms, groups them by leader broker and sends ProduceRequests with at most max.in.flight per connection. The broker appends and replicates according to acks. The response completes the Future and callbacks with the offset; retriable errors re-enqueue the batch until delivery.timeout.ms.', probes: ['Where can the caller thread block?', 'What happens to batches for a partition whose leader just moved?', 'Why is the callback run on the sender thread, and why does that matter?'], senior: 'Names the two threads and the blocking points, and warns that slow work in callbacks stalls the sender thread for every partition.' },
      { q: 'How do you tune a producer for throughput vs latency?', a: 'Throughput: raise linger.ms (10–100 ms) and batch.size (64–256 KB), use lz4 or zstd, keep acks=all (replication is pipelined, so the cost is mostly latency), and make sure buffer.memory covers rate × latency. Latency: linger.ms 0–5, smaller batches, no gzip. Always measure record-queue-time-avg, batch-size-avg, compression-rate and request-latency on the producer.', probes: ['Why can a higher linger.ms lower p99 latency under load?', 'What does a tiny batch-size-avg tell you?'], senior: 'Explains that under load, batching reduces request count and broker queueing, so a small linger can improve tail latency. Tunes from producer metrics rather than folklore.' },
      { q: 'Can a Kafka producer reorder messages?', a: 'Yes, without idempotence when max.in.flight > 1 and a batch is retried. With enable.idempotence=true, order holds for up to 5 in-flight requests per partition, because the broker validates sequence numbers. Order is only ever per partition: different partitions, or a partition count change for the same key, give no ordering.', probes: ['Before idempotence, what did people set to keep order?', 'Does adding partitions break per-key order?'], senior: 'Mentions max.in.flight=1 as the old workaround with its throughput cost. Points out that repartitioning moves keys, so ordering needs a migration plan.' },
      { q: 'A producer gets TimeoutException in production. What do you do?', a: 'Classify it. A metadata or max.block.ms timeout means the buffer is full or the cluster is unreachable, so it is back-pressure. A delivery timeout means the batch expired: the broker is slow, ISR is shrinking, or throttling is on. Check broker request latency, under-replicated partitions and the producer’s record-queue-time. Never blindly resend in app code, because the outcome is unknown. Rely on idempotent consumers or transactions.', probes: ['How do you avoid request threads hanging for 60 s?', 'Is it safe to retry from the application?'], senior: 'Separates back-pressure from delivery failure, treats the timeout as an unknown outcome, and puts a lower max.block.ms on latency-sensitive paths with a fallback such as an outbox.' },
      { q: 'How do you send a 20 MB payload through Kafka?', a: 'Usually you don’t. Store the blob in S3 or GCS and send a reference with a checksum (claim check). If you must, raise max.request.size, message.max.bytes or max.message.bytes on the topic, replica.fetch.max.bytes and consumer fetch sizes together. Large records hurt batching and page-cache efficiency, and they make replication bursty.', probes: ['Which settings must change together?', 'What breaks if only the producer is changed?'], senior: 'Defaults to the claim check, and knows the chain of size limits so nothing is half-configured.' },
    ],
    numbers: [
      { k: 'batch.size', v: '16 KB', why: 'Per partition. Raise it to 64–256 KB for throughput.' },
      { k: 'linger.ms', v: '5 ms (4.0+), 0 earlier', why: 'The latency you trade for batching.' },
      { k: 'buffer.memory', v: '32 MB', why: 'Needs to cover rate × worst-case broker latency.' },
      { k: 'max.block.ms', v: '60 s', why: 'How long send() can hang your thread.' },
      { k: 'delivery.timeout.ms', v: '120 s', why: 'Upper bound on reporting success or failure.' },
      { k: 'max.in.flight', v: '5', why: 'Maximum for ordered idempotent delivery.' },
      { k: 'message.max.bytes', v: '≈ 1 MB', why: 'Broker limit on a (compressed) batch.' },
      { k: 'Defaults since 3.0', v: 'acks=all, idempotence=true', why: 'Older clients default to acks=1.' },
    ],
    tradeoffs: [
      {
        title: 'acks settings',
        cols: ['acks', 'Acked when', 'Latency', 'Loss window', 'Use for'],
        rows: [
          ['0', 'written to socket', 'lowest', 'any failure', 'metrics you can afford to drop'],
          ['1', 'leader appended', 'low', 'leader dies before followers fetch', 'logs, clickstream with tolerance'],
          ['all + minISR=1', 'current ISR (may be leader only)', 'medium', 'same as acks=1 when ISR shrinks', 'misconfiguration'],
          ['all + minISR=2, RF=3', '≥ 2 replicas', 'medium (+ follower fetch RTT)', 'only if 2 replicas are lost at once', 'orders, payments, CDC'],
        ],
      },
      {
        title: 'Compression codecs',
        cols: ['Codec', 'Ratio', 'CPU', 'Notes'],
        rows: [
          ['none', '1×', 'none', 'only for already-compressed payloads'],
          ['snappy', '~2×', 'low', 'older default choice'],
          ['lz4', '~2–2.5×', 'very low', 'best general default'],
          ['zstd', '~3–4×', 'low–medium', 'best ratio per CPU; needs 2.1+ clients'],
          ['gzip', '~3–4×', 'high', 'avoid on hot paths'],
        ],
      },
    ],
    incidents: [
      { title: 'API latency spike from a full producer buffer', symptom: 'HTTP p99 jumped from 40 ms to 60 s and request threads were exhausted.', cause: 'A broker slowdown filled buffer.memory, so send() blocked every request thread for max.block.ms.', fix: 'Set a small max.block.ms on request paths with an outbox or local-queue fallback, add a circuit breaker on producer errors, and alert on buffer-available-bytes.', lesson: 'A "fire-and-forget" send is a synchronous dependency once the buffer fills.' },
      { title: 'Duplicate payments after an app-level retry', symptom: 'Some charge events appeared twice downstream.', cause: 'A wrapper caught TimeoutException and called send() again. The first attempt had actually been written.', fix: 'Remove app-level resends, give every event a business id, and make the consumer dedupe or upsert by that id.', lesson: 'Idempotence covers retries inside one producer, not your own resends.' },
    ],
  },

  /* -------------------------------------------------------------- */
  {
    id: 'offsets',
    title: 'Offset commits & delivery semantics',
    tagline: 'Where offsets live, auto vs manual commit, expiry and reset.',
    minutes: 8,
    oneLiner: 'A committed offset is the group’s claim that every record before it is done. It is stored as a record in the compacted __consumer_offsets topic via the group coordinator. When you commit relative to processing, you choose at-most-once or at-least-once.',
    frames: [
      {
        title: 'Position vs committed offset',
        body: 'The consumer’s **position** is the next offset poll() will return (in memory). The **committed offset** is durable: a record keyed by (group, topic, partition) written to `__consumer_offsets` (50 partitions, compacted) through the **group coordinator**, the leader of partition `hash(group.id) % 50`. You commit the **next** offset to read, not the last one processed.',
        viz: { kind: 'path', title: 'poll loop', stages: [{ label: 'poll()', sub: 'offsets 0–499' }, { label: 'process', sub: 'your code' }, { label: 'commit(500)', sub: 'next to read', hot: true }, { label: '__consumer_offsets', sub: 'compacted, RF 3' }] },
      },
      {
        title: 'Auto-commit, precisely',
        body: 'With `enable.auto.commit=true`, the client commits during **poll()** (and close) if `auto.commit.interval.ms` (5 s) has passed. It commits the offsets returned by the **previous** poll. If you process synchronously in the loop that is at-least-once. If you hand records to another thread and poll again, it commits work that hasn’t happened yet.',
        viz: { kind: 'path', title: 'auto-commit', stages: [{ label: 'poll #1', sub: 'returns 0–499' }, { label: 'process 0–499' }, { label: 'poll #2', sub: 'commits 500', hot: true }, { label: 'crash' }, { label: 'restart at 500' }] },
        predict: {
          q: 'Records are pushed to a thread pool right after poll(). The pod is OOM-killed with 30k queued records. On restart?',
          options: ['All 30k are re-processed (at-least-once)', 'Most of the 30k are skipped forever, because their offsets were already committed', 'Kafka redelivers them because they were never acked'],
          answer: 1,
          explain: 'Kafka has no per-message ack. Auto-commit committed the positions handed back by poll(), not your completed work. Async processing needs **manual commits of the contiguous completed prefix** per partition, plus `pause()` for back-pressure.',
        },
      },
      {
        title: 'Rebalances and uncommitted work',
        body: 'When a partition moves, the new owner starts from the **last committed** offset. Anything processed but not committed is processed again. Commit synchronously in `onPartitionsRevoked`. With the cooperative protocol only the partitions actually moving are revoked, so the others keep flowing.',
        viz: { kind: 'group', phase: 'Revoking p2', gen: 8, members: [{ name: 'C1', parts: ['p0', 'p1', 'p2'], state: 'revoking' }, { name: 'C2', parts: ['p3'], state: 'joining' }], note: 'C1 processed p2 up to 999 but last committed 800.' },
        predict: {
          q: 'C1 processed p2 to offset 999 but last committed 800. p2 moves to C2 and C1 has no revoke callback. What does C2 do?',
          options: ['Starts at 1000', 'Starts at 800 and re-processes 800–999', 'Starts at the log end'],
          answer: 1,
          explain: 'The committed offset is the only hand-off. That is why at-least-once consumers must be **idempotent**, and why you commit in the revoke callback to shrink the duplicate window.',
        },
      },
      {
        title: 'Offset expiry and auto.offset.reset',
        body: 'If a group stays **empty** longer than `offsets.retention.minutes` (7 days since 2.0), its offsets are deleted (KIP-211). On the next start no offset exists, so `auto.offset.reset` decides: `latest` (the default) jumps to the end, silently skipping everything in between. `earliest` replays the whole retained log.',
        viz: { kind: 'segments', segments: [{ base: 0, next: 40000, deleted: true }, { base: 40000, next: 92000, mark: true }, { base: 92000, next: 95000, active: true }], note: 'Group offsets expired. latest restarts at 95000 and skips 40000–95000 without an error.' },
        predict: {
          q: 'A reconciliation job runs every 10 days with auto.offset.reset=latest. What does it process on its next run?',
          options: ['Everything since its last run', 'Only records produced after it starts: 10 days of data skipped', 'It fails with OffsetOutOfRange'],
          answer: 1,
          explain: 'The group was empty longer than the 7-day offset retention, so its offsets expired and `latest` applied. There is no error, just missing data. For pipelines use `earliest`, idempotent processing, and an alert when a group has no committed offset.',
        },
      },
      {
        title: 'Liveness vs progress',
        body: 'Two separate clocks. `session.timeout.ms` (45 s) is enforced by **heartbeats** from a background thread and detects dead processes. `max.poll.interval.ms` (5 min) detects a **stuck poll loop**: if processing one batch takes longer, the client leaves the group and its next commit fails with CommitFailedException.',
        viz: { kind: 'group', phase: 'max.poll.interval exceeded', gen: 12, members: [{ name: 'C1', parts: [], state: 'gone' }, { name: 'C2', parts: ['p0', 'p1', 'p2', 'p3'], state: 'leader' }], note: '500 records × 1 s each = 500 s > 300 s, so C1 is ejected while still alive.' },
      },
    ],
    design: [
      { decision: 'Offsets stored in a Kafka topic', because: 'ZooKeeper could not take high-rate writes. A compacted topic gives durability, replication and a fast in-memory cache on the coordinator, which replays it on failover.' },
      { decision: 'The consumer owns its cursor', because: 'Replay, rewind (`kafka-consumer-groups --reset-offsets`) and many independent groups are free. The broker tracks no per-message state.' },
      { decision: 'A separate progress timeout (KIP-62)', because: 'Heartbeats from a background thread stop slow processing being mistaken for death, while a hung loop still gets evicted.' },
    ],
    interview: [
      { q: 'What exactly is a committed offset, and where is it stored?', a: 'It is the next offset to consume for a (group, topic, partition), written as a record to the compacted __consumer_offsets topic through the group coordinator (leader of hash(group.id) % 50). The coordinator caches it in memory and rebuilds the cache from the partition on failover.', probes: ['Why the next offset rather than the last processed?', 'What happens to commits while the coordinator partition fails over?', 'How would you move a group back 2 hours?'], senior: 'Treats the offset as a "contiguous prefix done" claim and designs commits around that. Mentions `--reset-offsets --to-datetime` for incident recovery.' },
      { q: 'Is auto-commit at-most-once or at-least-once?', a: 'At-least-once if processing finishes in the poll loop before the next poll(), because auto-commit commits the previous poll’s offsets. Effectively at-most-once if processing is asynchronous, because offsets are committed before the work completes.', probes: ['What if you catch an exception and keep polling?', 'What does close() commit?'], senior: 'Points out that swallowing an exception silently skips the record. The poison-message policy (retry topic or DLQ) must be explicit.' },
      { q: 'How do you get exactly-once from Kafka into Postgres?', a: 'Kafka transactions stop at Kafka’s boundary. Either write the effects and the consumed offset in the same DB transaction, seeking from the DB in onPartitionsAssigned, or make the write idempotent (upsert keyed by event id, or a processed-ids table with a unique constraint). Side effects such as emails need their own idempotency key.', probes: ['Where do you seek on rebalance?', 'How do you dedupe calls to an external API?'], senior: 'Says "effectively-once": at-least-once delivery plus idempotent effects is the default. Offsets in the sink DB is the exception.' },
      { q: 'Consumer lag is growing. How do you debug it?', a: 'Lag = log-end offset − committed offset, per partition. First look at the distribution. All partitions growing means throughput (records/s per consumer × consumers < rate): scale up to the partition count, batch sink writes, cut per-record latency. One partition growing means a hot key, a stuck poison record or a slow pod. A sawtooth means rebalances. Check max.poll.interval violations, downstream latency and GC.', probes: ['Why is lag in messages misleading?', 'Can adding consumers make it worse?'], senior: 'Alerts on **time lag** against an SLO, checks per-partition skew before scaling, and knows consumers beyond the partition count sit idle while each join triggers a rebalance.' },
      { q: 'A group was offline for two weeks. What happens when it restarts?', a: 'Its offsets expired (offsets.retention.minutes, 7 days after the group became empty), so auto.offset.reset applies. latest skips the gap silently; earliest replays the whole retained log. If retention also deleted data past its old position, the gap is gone either way.', probes: ['Which default would you change, and why?'], senior: 'Calls latest a silent data-loss default for pipelines. Sets earliest with idempotent processing and monitors for missing offsets.' },
      { q: 'Explain session.timeout.ms vs max.poll.interval.ms.', a: 'session.timeout: heartbeat liveness from a background thread (default 45 s); missing it means the process is presumed dead. max.poll.interval: time between poll() calls (default 5 min); exceeding it means the loop is stuck, so the client leaves the group. A slow batch triggers the second, not the first.', probes: ['A record takes 10 minutes to process. How do you design the consumer?'], senior: 'Keeps per-poll work bounded (max.poll.records, pause/resume). For very long jobs, uses Kafka as the trigger with a job or work queue, rather than stretching timeouts.' },
    ],
    numbers: [
      { k: '__consumer_offsets', v: '50 partitions, RF 3, compacted', why: 'The coordinator is hash(group.id) % 50.' },
      { k: 'auto.commit.interval.ms', v: '5 s', why: 'Duplicate window after a crash.' },
      { k: 'offsets.retention.minutes', v: '7 days (since 2.0)', why: 'Counted after the group becomes empty.' },
      { k: 'auto.offset.reset', v: 'latest', why: 'Silent skip when no offset exists.' },
      { k: 'session.timeout.ms', v: '45 s (3.0+)', why: 'Was 10 s, which caused GC-pause rebalances.' },
      { k: 'max.poll.interval.ms', v: '300 s', why: 'Progress deadline per poll loop.' },
      { k: 'max.poll.records', v: '500', why: 'Bound it so records × p99 < max.poll.interval.' },
    ],
    tradeoffs: [
      {
        title: 'Commit strategies',
        cols: ['Strategy', 'Semantics', 'Throughput', 'Use when'],
        rows: [
          ['auto-commit, sync processing', 'at-least-once (≤ 5 s duplicates)', 'high', 'idempotent handlers, simple services'],
          ['commit before processing', 'at-most-once', 'high', 'loss is acceptable (metrics)'],
          ['commitAsync per batch + commitSync on revoke/close', 'at-least-once, small window', 'high', 'the usual production default'],
          ['commitSync per record', 'at-least-once, tiny window', 'low', 'rarely worth it'],
          ['offsets stored in the sink DB transaction', 'exactly-once into that DB', 'medium', 'financial ledgers, single-DB sinks'],
          ['sendOffsetsToTransaction', 'exactly-once Kafka → Kafka', 'medium', 'stream processing (or use Streams EOS)'],
        ],
      },
    ],
    incidents: [
      { title: 'A week of events silently skipped', symptom: 'Reports were missing days of orders. No errors anywhere.', cause: 'A weekly batch group was idle longer than offsets.retention; offsets expired and auto.offset.reset=latest jumped to the end.', fix: 'Set earliest plus an idempotent load, alert on "no committed offset", and keep offset retention above the schedule.', lesson: 'Defaults tuned for services are wrong for pipelines.' },
      { title: 'Rebalance storm from a slow dependency', symptom: 'Group generation climbing every few minutes, lag rising and duplicate side effects.', cause: 'The downstream API slowed to 1 s per call; 500 records per poll exceeded max.poll.interval.ms, so members were ejected and partitions bounced between them.', fix: 'Lower max.poll.records, time-box calls, pause partitions while a bounded worker pool drains, and use cooperative-sticky with static membership.', lesson: 'A consumer’s throughput contract is records per poll × p99 latency.' },
    ],
  },

  /* -------------------------------------------------------------- */
  {
    id: 'tiered',
    title: 'Retention & tiered storage',
    tagline: 'How data leaves, why brokers got fat, and KIP-405.',
    minutes: 8,
    oneLiner: 'Retention deletes whole closed segments once their newest timestamp is older than retention.ms (or the partition is over retention.bytes). Tiered storage moves closed segments to object storage, so retention is priced like S3 and brokers keep only a hot local tail.',
    frames: [
      {
        title: 'Retention deletes segments, not records',
        body: 'Every `log.retention.check.interval.ms` (5 min) the broker deletes **closed** segments whose largest timestamp is older than `retention.ms` (7 days), or the oldest segments while the partition exceeds `retention.bytes` (unlimited by default). The active segment is never deleted. It rolls at `segment.bytes` (1 GB) or `segment.ms` (7 days).',
        viz: { kind: 'segments', segments: [{ base: 0, next: 5200, deleted: true }, { base: 5200, next: 9800, deleted: true }, { base: 9800, next: 14100 }, { base: 14100, next: 15020, active: true }], note: 'Old segments are dropped whole: a file delete, not a rewrite.' },
        predict: {
          q: 'retention.ms = 1 hour. The topic receives 10 MB/hour per partition (segment.bytes = 1 GB, default segment.ms). How old can the oldest data on disk be?',
          options: ['About 1 hour', 'Up to ~7 days: the active segment hasn’t rolled, and only closed segments are deleted', 'Unbounded'],
          answer: 1,
          explain: 'At 10 MB/h the 1 GB segment only rolls when `segment.ms` (7 days) fires, so nothing is eligible before then. Low-volume topics with short retention (or GDPR deadlines) need a smaller `segment.ms` too.',
        },
      },
      {
        title: 'Record timestamps drive time retention',
        body: 'With `message.timestamp.type=CreateTime` (the default), the **producer’s clock** sets record timestamps. A producer clock years in the future pins a segment forever, and one in the past gets data deleted early. Guard with `log.message.timestamp.before/after.max.ms` (3.6+), or use `LogAppendTime`.',
        viz: { kind: 'segments', segments: [{ base: 0, next: 4000 }, { base: 4000, next: 8000, mark: true }, { base: 8000, next: 9000, active: true }], note: 'The marked segment contains one record stamped 2031, so time retention never deletes it.' },
      },
      {
        title: 'Why brokers got fat',
        body: 'With local-only storage, retention × throughput × RF must fit on broker disks. Longer retention means more or bigger brokers, and **reassigning a partition copies all of its history**: moving 5 TB at 100 MB/s throttled takes about 14 hours. Recovering a failed broker means re-replicating everything it had.',
        viz: { kind: 'path', title: 'local-only', stages: [{ label: '50 MB/s ingest' }, { label: '× 30 days', sub: '130 TB' }, { label: '× RF 3', sub: '390 TB on brokers', hot: true }, { label: 'add a broker', sub: 'copy TBs for hours' }] },
      },
      {
        title: 'Tiered storage (KIP-405)',
        body: 'With `remote.storage.enable=true` on a topic, the **leader** uploads each closed segment plus its indexes to object storage through the RemoteStorageManager plugin, with metadata in `__remote_log_metadata`. `local.retention.ms` (for example 6 h) bounds the hot local copy, and `retention.ms` bounds the total. Production-ready since 3.9 (early access in 3.6).',
        viz: { kind: 'segments', segments: [{ base: 0, next: 5200, deleted: true }, { base: 5200, next: 9800, deleted: true }, { base: 9800, next: 14100, mark: true }, { base: 14100, next: 15020, active: true }], note: 'Faded: only in S3. Marked: uploaded and still local. Active: local only.' },
        predict: {
          q: 'With tiered storage on, a consumer seeks to 20 days ago (local retention is 6 h). What happens?',
          options: ['OffsetOutOfRangeException', 'The broker transparently fetches the segment from object storage: same API, higher first-byte latency', 'The client must read S3 directly', 'A follower serves it from its disk'],
          answer: 1,
          explain: 'Remote reads are transparent to clients. The broker’s RemoteLogManager fetches remote segments and indexes, so cold reads cost object-store latency and broker threads, and they don’t evict the hot page cache.',
        },
      },
      {
        title: 'What tiering does not change',
        body: 'Hot writes still replicate across AZs (still paying inter-AZ transfer), and the leader still serves all reads. **Compacted topics cannot be tiered.** Cold reads need tuned remote fetch thread pools. Object-store-native designs (WarpStream, Confluent Freight, KIP-1150 diskless) go further: no local disks, at the price of 100s of ms of end-to-end latency.',
        viz: { kind: 'path', title: 'tiered', stages: [{ label: 'Producer' }, { label: 'Leader + ISR', sub: 'local, cross-AZ', hot: true }, { label: 'Closed segment' }, { label: 'S3 / GCS', sub: 'retention.ms' }] },
      },
    ],
    design: [
      { decision: 'Delete by whole segment', because: 'A file unlink is O(1) and never rewrites data. The price is coarse, segment-sized granularity.' },
      { decision: 'Tier only closed segments', because: 'Immutable files upload once. The hot path (append, replicate, tail reads) stays local and fast.' },
      { decision: 'Pluggable RemoteStorageManager', because: 'Kafka does not hard-code S3, so vendors supply plugins for S3, GCS, Azure and HDFS.' },
    ],
    interview: [
      { q: 'How does retention work, and why can data outlive retention.ms?', a: 'A periodic check deletes closed segments whose max timestamp is older than retention.ms, or the oldest segments while over retention.bytes. Data can outlive it because the active segment never deletes (it rolls on segment.bytes or segment.ms), because of the check interval, and because of future timestamps from producer clocks.', probes: ['How would you guarantee deletion within 24 h for GDPR?', 'Is retention.bytes per topic or per partition?'], senior: 'Knows retention.bytes is per partition. For deletion SLAs, tunes segment.ms and the timestamp guards, or keys the data and uses compaction tombstones or crypto-shredding.' },
      { q: 'How would you size disks for a topic?', a: 'Ingest × retention × RF ÷ brokers, plus headroom. Example: 50 MB/s × 7 days = 30 TB raw, × RF 3 = 91 TB, over 6 brokers ≈ 15 TB each. Keep disks below ~70% for spikes and reassignment, so about 22 TB per broker. Then check that a broker rebuild time (15 TB at a 200 MB/s throttle ≈ 21 h) is acceptable. If it isn’t, use tiered storage or more, smaller brokers.', probes: ['What fills disks faster than your model?', 'Why does rebuild time matter for durability?'], senior: 'Ties disk size to recovery time and the window of reduced redundancy, not just cost.' },
      { q: 'What is tiered storage, and what does it change operationally?', a: 'Closed segments go to object storage and brokers keep a short local tail. Retention becomes cheap, brokers are small, reassignment and recovery move only the local tail, and cold reads stop thrashing the page cache. It does not remove cross-AZ replication cost for hot data, compacted topics are excluded, and cold reads have higher latency and need tuned remote-fetch pools.', probes: ['How much faster is broker replacement?', 'When would you use a lake (Iceberg) instead?'], senior: 'Frames it as decoupling storage from compute, and picks a lake for frequent analytical full-history scans with tiering for occasional seeks.' },
      { q: 'What happens if retention deletes a consumer’s committed offset?', a: 'The fetch returns OFFSET_OUT_OF_RANGE and auto.offset.reset decides: earliest jumps to the oldest remaining record and latest to the end. Either way the deleted data is gone for that consumer.', probes: ['How do you see this coming?'], senior: 'Alerts when time lag approaches retention (for example 50% of retention.ms) and treats it as a page-worthy data-loss risk.' },
      { q: 'A team wants 1-year replay on a 200 MB/s topic. Design it.', a: 'Local-only would be 6.3 PB × RF 3, which is unreasonable. Options: tiered storage with a short local retention (S3 is roughly $0.02/GB-month ≈ $130k/month for 6.3 PB, before request costs), or sink to an Iceberg or Parquet lake and replay from it in parallel (cheapest for bulk reprocessing). Ask how often replay happens, how fast it must be, and whether consumers need the Kafka API.', probes: ['How do you replay a lake back into a Kafka-shaped consumer?'], senior: 'Does the arithmetic out loud and pushes back on the requirement: a year of raw events is usually a lake job.' },
    ],
    numbers: [
      { k: 'retention.ms', v: '7 days', why: 'Per topic. -1 means forever.' },
      { k: 'retention.bytes', v: '-1 (per partition!)', why: 'Multiply by the partition count for the topic size.' },
      { k: 'segment.bytes / segment.ms', v: '1 GB / 7 days', why: 'Granularity of deletion and compaction.' },
      { k: 'retention check', v: 'every 5 min', why: 'log.retention.check.interval.ms' },
      { k: 'Tiered storage', v: 'EA 3.6, GA 3.9', why: 'Topic opt-in: remote.storage.enable' },
      { k: 'Disk headroom', v: 'keep < 70%', why: 'A full log dir takes the broker’s partitions offline.' },
      { k: 'Inter-AZ transfer (AWS)', v: '$0.01/GB each way', why: 'Often the largest Kafka bill line.' },
    ],
    tradeoffs: [
      {
        title: 'Where history lives',
        cols: ['Design', 'Hot latency', 'Cold reads', 'Recovery / scaling', 'Caveat'],
        rows: [
          ['Local disks only', 'ms', 'evict page cache, contend', 'copy all history', 'cost and rebuild time grow with retention'],
          ['Tiered storage (KIP-405)', 'ms', 'object-store latency, isolated', 'copy only the local tail', 'no compacted topics'],
          ['Object-store native (WarpStream, diskless)', '100s of ms', 'same as hot', 'stateless agents', 'latency; newer ecosystem'],
          ['Pulsar + BookKeeper', 'ms', 'tiered offload', 'no data copy on broker moves', 'extra system to run'],
          ['Sink to a lake (Iceberg)', 'n/a', 'massively parallel', 'independent', 'not the Kafka API; replay needs a job'],
        ],
      },
    ],
    incidents: [
      { title: 'Disks full cascade', symptom: 'Brokers went offline one by one and producers failed with NOT_LEADER errors.', cause: 'A topic was created with retention.ms=-1 plus a traffic surge. When a log dir fills, its partitions go offline, leadership moves, and the next broker fills.', fix: 'Cap retention.bytes, alert at 70% disk, set producer quotas, and use tiered storage for long retention.', lesson: 'Retention settings are capacity settings and need review like code.' },
      { title: 'Replay stalled live traffic', symptom: 'Producer p99 and all consumer groups slowed during a backfill.', cause: 'A 30-day replay read cold segments from disk and evicted the tail from the page cache.', fix: 'Set consumer byte-rate quotas for the replay, run it off-peak, or replay from tiered storage or the lake.', lesson: 'In a shared cluster, a cold read is a noisy neighbour.' },
    ],
  },

  /* -------------------------------------------------------------- */
  {
    id: 'streams',
    title: 'Kafka Streams state',
    tagline: 'Tasks, RocksDB state stores, changelogs, standbys and EOS.',
    minutes: 9,
    oneLiner: 'A topology is split into tasks, one per input partition. Each task keeps its state in a local RocksDB store backed by a compacted changelog topic. Failover restores the store from the changelog (or a warm standby), and exactly_once_v2 commits output, changelog and offsets in one transaction.',
    frames: [
      {
        title: 'Topology → tasks',
        body: 'Streams creates one **task per input partition** (task `0_3` = sub-topology 0, partition 3). Tasks are the unit of parallelism and state ownership, and they are spread over instances × `num.stream.threads` by a custom group assignor. More threads than tasks sit idle.',
        viz: { kind: 'group', phase: 'StreamsPartitionAssignor', gen: 4, members: [{ name: 'app-1 / t1', parts: ['0_0', '0_1'], state: 'leader' }, { name: 'app-1 / t2', parts: ['0_2'] }, { name: 'app-2 / t1', parts: ['0_3', '0_4', '0_5'] }] },
      },
      {
        title: 'State = local RocksDB + changelog',
        body: '`count()`, `aggregate()`, joins and windows keep state in a **RocksDB** store on local disk per task. Every update is also sent to a compacted **changelog** topic (`<app>-<store>-changelog`). Local disk is just a cache: the changelog is the source of truth. A record cache (10 MB) dedupes updates before they are flushed.',
        viz: { kind: 'path', title: 'one update', stages: [{ label: 'record' }, { label: 'processor', sub: 'count by user' }, { label: 'RocksDB', sub: 'local disk', hot: true }, { label: 'changelog', sub: 'compacted topic' }] },
      },
      {
        title: 'Re-keying forces a repartition',
        body: 'Aggregations need all records for a key in **one task**. If you `selectKey()` or `groupBy()` on a new key, Streams writes to an internal `-repartition` topic keyed by the new key and reads it back. That is a full extra write, replication and read through the brokers.',
        viz: { kind: 'partitioner', parts: 4, keys: [{ key: 'user-7', hash: 2201, p: 1 }, { key: 'user-7', hash: 2201, p: 1 }, { key: 'user-3', hash: 918, p: 2 }], note: 'After re-keying, every record for user-7 lands on one task.' },
        predict: {
          q: 'Your input is keyed by orderId. You call groupBy(userId).count(). What does Streams do?',
          options: ['Counts per partition and merges results', 'Creates an internal repartition topic keyed by userId and counts downstream of it', 'Throws: input must already be keyed by userId', 'Uses a GlobalKTable'],
          answer: 1,
          explain: 'Changing the key before stateful ops inserts a repartition topic, which doubles broker I/O for that stream. Key correctly at the producer when you can, and watch for accidental re-keying (`map` vs `mapValues`).',
        },
      },
      {
        title: 'Failover means restoring state',
        body: 'When an instance dies its tasks move. With no local state, the new owner **replays the changelog** into RocksDB before processing, so a 50 GB store takes minutes to tens of minutes. **Standby replicas** (`num.standby.replicas`) keep warm copies elsewhere. KIP-441 only moves an active task once a warm-up copy is within `acceptable.recovery.lag`.',
        viz: { kind: 'group', phase: 'Restoring', gen: 9, members: [{ name: 'app-1', parts: [], state: 'gone' }, { name: 'app-2', parts: ['0_0 (restoring)', '0_3'], state: 'joining' }, { name: 'app-3 (standby)', parts: ['0_1', '0_2'] }] },
        predict: {
          q: 'An instance with a 50 GB store dies; num.standby.replicas = 0 and pods have no persistent volume. What happens?',
          options: ['Another instance takes over within seconds', 'Its partitions stop processing until the new owner restores the store from the changelog (minutes or more)', 'Data is lost because RocksDB was local'],
          answer: 1,
          explain: 'No data is lost, because the changelog has it, but **availability** suffers during the restore. Fixes: standby replicas, persistent volumes (StatefulSet) so local state survives restarts, static membership so a bounce doesn’t move tasks, and smaller stores (windowing, TTL).',
        },
      },
      {
        title: 'Exactly-once in Streams',
        body: 'With `processing.guarantee=exactly_once_v2` (KIP-447, 3.0+), each stream thread uses one transactional producer. Output records, changelog writes and input offsets commit **atomically**. `commit.interval.ms` drops from 30 s to 100 ms, and downstream readers use `read_committed`. On a crash the open transaction aborts and the task restores to the last commit.',
        viz: { kind: 'txn', coordinator: 'Ongoing → CompleteCommit', parts: [{ name: 'output', recs: [{ label: 'agg', s: 'commit' }, { label: 'C', s: 'marker' }] }, { name: 'changelog', recs: [{ label: 'u7=12', s: 'commit' }, { label: 'C', s: 'marker' }] }, { name: 'offsets', recs: [{ label: 'in@812', s: 'commit' }, { label: 'C', s: 'marker' }] }] },
      },
    ],
    design: [
      { decision: 'A library, not a cluster', because: 'Streams runs inside your service and is deployed like it. Kafka provides partitioning, membership, fault-tolerant state (changelogs) and transactions.' },
      { decision: 'State co-located with the task', because: 'Local RocksDB lookups take microseconds versus milliseconds to a remote DB, and there is no shared bottleneck.' },
      { decision: 'Changelog as the source of truth', because: 'Any instance can rebuild any task, so compute is disposable.' },
    ],
    interview: [
      { q: 'How does Kafka Streams scale, and what limits parallelism?', a: 'One task per input partition (per sub-topology), assigned across instances and threads. Max parallelism = partition count of the input (and of repartition topics). Scale by adding instances up to that bound; beyond it you need more partitions, which changes key → partition mapping and invalidates state placement.', probes: ['What happens to state when you add partitions?', 'How many threads should an instance run?'], senior: 'Sizes the partition count for future parallelism up front, because repartitioning a stateful app is a migration (reset the app or blue/green).' },
      { q: 'Where does Streams state live, and how is it fault-tolerant?', a: 'Local RocksDB (or in-memory) stores per task, each backed by a compacted changelog topic. On failover the new owner restores from the changelog. Standby replicas keep warm copies. With EOS, state and output commit atomically.', probes: ['Why compacted changelogs?', 'What is the memory footprint of many RocksDB stores?'], senior: 'Knows RocksDB is off-heap (by default ~50 MB block cache and 3 × 16 MB memtables per store, per partition), and bounds it with a shared cache via RocksDBConfigSetter.' },
      { q: 'KTable vs GlobalKTable: when do you use which?', a: 'A KTable is partitioned: each task holds its shard, so joining it with a KStream requires co-partitioning (same key, same partition count and partitioner). A GlobalKTable is fully replicated to every instance, so it needs no co-partitioning and allows joins on non-key fields, but every instance stores and restores all of it. Use it for small, slowly changing dimensions.', probes: ['What breaks if co-partitioning is violated?'], senior: 'Mentions silent join misses when a producer in another language uses a different partitioner. Streams can only check partition counts.' },
      { q: 'How does Streams achieve exactly-once?', a: 'exactly_once_v2: one transactional producer per thread. Input offsets (sendOffsetsToTransaction), changelog updates and output records commit in one Kafka transaction. Zombies are fenced by producer epoch and group generation (KIP-447). Readers must use read_committed. External side effects are not covered.', probes: ['What does EOS cost?', 'What about a REST call inside a processor?'], senior: 'Quantifies the cost (frequent commits, transaction markers, latency ≈ commit.interval) and keeps side effects out of processors, or makes them idempotent.' },
      { q: 'A Streams app takes 40 minutes to recover after a pod restart. What do you do?', a: 'It is restoring state from changelogs. Use persistent volumes so local state survives, static membership (group.instance.id) so a bounce doesn’t reassign tasks, num.standby.replicas=1 for fast failover, and KIP-441 warm-ups. Shrink state with windowing, retention and TTL. Check the restore consumer config and whether the changelog is compacted properly.', probes: ['What does a standby cost?'], senior: 'Treats restore time as an availability SLO, and accepts double the disk and changelog read for standbys only on critical stores.' },
      { q: 'Kafka Streams vs Flink: when do you pick each?', a: 'Streams: a library inside JVM microservices, Kafka in and out, moderate state, no cluster to run. Flink: a separate cluster with a job manager, many sources and sinks, very large state with incremental checkpoints to S3, event-time-heavy analytics and SQL, and batch plus stream in one engine.', probes: ['What about ksqlDB?'], senior: 'Decides on team operating model and source diversity, not just features. Says Streams is ideal when it is "just a service" reading Kafka.' },
    ],
    numbers: [
      { k: 'Max parallelism', v: '= input partitions', why: 'Per sub-topology.' },
      { k: 'commit.interval.ms', v: '30 s (100 ms with EOS)', why: 'Duplicate window vs overhead.' },
      { k: 'statestore.cache.max.bytes', v: '10 MB', why: 'Dedupes updates before the changelog and downstream.' },
      { k: 'RocksDB default per store', v: '~50 MB cache + 3 × 16 MB memtables', why: 'Multiplied by stores × partitions, off-heap.' },
      { k: 'num.standby.replicas', v: '0', why: 'Set 1 for critical stateful apps.' },
      { k: 'acceptable.recovery.lag', v: '10,000 records', why: 'KIP-441 warm-up threshold.' },
    ],
    tradeoffs: [
      {
        title: 'Stream processing options',
        cols: ['Option', 'Runs as', 'State', 'Exactly-once', 'Best for'],
        rows: [
          ['Plain consumer', 'your service', 'external DB', 'DIY (idempotent sink)', 'stateless transforms, sinks'],
          ['Kafka Streams', 'library in your JVM service', 'RocksDB + changelog', 'Kafka → Kafka (v2)', 'microservice-level aggregations and joins'],
          ['ksqlDB', 'server cluster (Streams inside)', 'same as Streams', 'yes', 'SQL-first teams, simple pipelines'],
          ['Apache Flink', 'dedicated cluster', 'RocksDB + checkpoints to S3', 'end-to-end with 2PC sinks', 'huge state, many sources, event-time analytics'],
        ],
      },
    ],
    incidents: [
      { title: 'Rolling deploy triggers hours of restores', symptom: 'Every deploy stalled processing; lag spiked for hours.', cause: 'Pods without persistent volumes or static membership: each bounce reassigned tasks and restored about 200 GB of state from changelogs.', fix: 'StatefulSet with PVs, group.instance.id, num.standby.replicas=1 and KIP-441 warm-ups.', lesson: 'In stateful streaming, deployment strategy is part of the design.' },
      { title: 'OOMKilled with a healthy heap', symptom: 'Containers killed although JVM heap usage was low.', cause: 'Dozens of RocksDB stores × partitions, each with default off-heap caches and memtables.', fix: 'A RocksDBConfigSetter with a shared, bounded block cache and write buffer manager. Size the container for off-heap memory.', lesson: 'Account for native memory, not just -Xmx.' },
    ],
  },
];
