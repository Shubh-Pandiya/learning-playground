import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'event-store',

  problem: {
    why: 'A CRUD table stores only the latest state, so every `UPDATE` destroys the fact that caused it. An event store keeps the **facts** (`MoneyWithdrawn`, `AddressChanged`) as an append-only, ordered log per entity; current state is a left fold over those facts. That gives you a built-in audit trail, temporal queries ("what did we believe on March 3rd?"), and the ability to build any number of new read models later by replaying history.',
    withoutIt: [
      'Audit requirements (finance, healthcare) force a second, hand-maintained history table that drifts from the real state.',
      'A bug that wrote wrong balances for a week cannot be repaired — the inputs that produced them were overwritten.',
      'Every new query shape needs a migration and a backfill from data that may no longer contain the needed detail.',
      'Publishing domain events reliably needs dual writes (DB + broker) that diverge under crashes.',
      'Concurrency control is either pessimistic row locks or lost updates; there is no natural "expected version" to check against.',
    ],
    position: 'It is the **write-side source of truth** in an event-sourced/CQRS system: command handlers load and append to streams; projectors, sagas and integrations subscribe to it and build everything else.',
    diagram: {
      type: 'flow',
      title: 'Where it sits',
      nodes: [
        { label: 'Command API', sub: 'Withdraw(acc-42, 50)' },
        { label: 'Command handler', sub: 'load, decide, append', tone: 'info' },
        { label: 'Event store', sub: 'append-only streams', tone: 'accent' },
        { label: 'Subscriptions', sub: 'catch-up from checkpoint', tone: 'violet' },
        { label: 'Read models', sub: 'projections, sagas, integrations', tone: 'ok' },
      ],
      caption: 'Writes go to streams; everything downstream is derived and rebuildable.',
    },
  },

  architecture: {
    overview: 'Underneath every event store is the same shape: an **append-only log** with two orderings. Each event has a **stream version** (0..N within its aggregate, used for optimistic concurrency) and a **global position** (its place in the `$all` log, used by subscribers to checkpoint). An index maps stream id → positions so loading one aggregate is a range read, not a log scan. Snapshots are a disposable cache on top; subscriptions are a tailing reader on the global log.',
    diagram: {
      type: 'layers',
      title: 'Event store anatomy',
      layers: [
        { name: 'API', items: ['Append(stream, expectedVersion, events)', 'Read(stream, fromVersion)', 'Subscribe($all, fromPosition)'], tone: 'accent' },
        { name: 'Concurrency', items: ['Expected-version check', 'Idempotent append (event ids)', 'Atomic multi-event batch'], tone: 'info' },
        { name: 'Indexes', items: ['stream id → positions', 'category / event-type index', 'Snapshot store'], tone: 'violet' },
        { name: 'Log', items: ['Append-only segments/chunks', 'Global position', 'fsync + quorum replication'], tone: 'ok' },
      ],
      caption: 'Streams are a logical view; the physical structure is one (or a few) ordered logs.',
    },
    blocks: [
      { name: 'Event envelope', what: '`{eventId (UUID), streamId, version, globalPosition, type, schemaVersion, data, metadata{correlationId, causationId, userId}, recordedAt}`. The event id doubles as an idempotency key for retried appends.' },
      { name: 'Stream (aggregate) index', what: 'Maps a stream id to its events’ positions. In SQL it is the `(stream_id, version)` primary key; in EventStoreDB it is a hash-of-stream-name LSM index (memtable + sorted PTables) over the transaction log.' },
      { name: 'Expected-version check', what: 'The append succeeds only if the stream is at the version the caller read (`NoStream`, `Any`, `StreamExists`, or an exact revision). Implemented as a unique constraint, a conditional put, or an in-memory check in the single leader.' },
      { name: 'Global position / `$all`', what: 'A monotonically increasing position across all streams. It is what projectors checkpoint, and the hardest property to get right on a general-purpose database under concurrent commits.' },
      { name: 'Snapshot store', what: '`(streamId, version, stateBlob, snapshotSchemaVersion)` written every N events. Never authoritative — delete them all and the system is only slower.' },
      { name: 'Subscription engine', what: 'Catch-up subscriptions (client keeps the checkpoint, reads history then goes live) and persistent/competing subscriptions (server keeps the checkpoint, load-balances to a consumer group, with retries and parking).' },
      { name: 'Upcaster chain', what: 'Functions that transform `OrderPlaced v1 → v2 → v3` on read so handlers only know the latest shape; history on disk is never rewritten.' },
    ],
    real: [
      { name: 'EventStoreDB (now KurrentDB)', how: 'Purpose-built: a transaction log split into **256 MB chunk files**, an LSM-style index of 64-bit stream-name hashes → positions, `$all` with commit/prepare positions, system projections like `$by_category` and `$by_event_type`, and a 3-node (or 5-node) cluster with a single leader and quorum-acked writes. gRPC clients expose expected-revision appends and both subscription types.' },
      { name: 'Marten (PostgreSQL, .NET)', how: '`mt_events` table keyed by stream + version, a `bigint` sequence for global position, `mt_streams` holding the current version for concurrency checks. Its async daemon tracks a **high-water mark** to avoid skipping sequence gaps from in-flight transactions.' },
      { name: 'Axon Server / Axon Framework', how: 'Java CQRS/ES stack; Axon Server stores events in segment files with per-aggregate sequence numbers and a global token, and uses the `(aggregateIdentifier, sequenceNumber)` uniqueness to reject concurrent appends. JDBC/JPA storage engines map the same model onto SQL.' },
      { name: 'DynamoDB as an event store', how: 'Partition key = stream id, sort key = version; append is `PutItem` with `ConditionExpression attribute_not_exists(sk)`, or `TransactWriteItems` (up to 100 items) for multi-event batches. DynamoDB Streams provides ordered-per-key change feeds for 24 hours; there is no global order.' },
      { name: 'Kafka (as a log, not a store)', how: 'Excellent for distributing events and replaying, but a topic partition holds many aggregates, there is no per-key conditional append, and retention must be set to infinite (`retention.ms=-1`). Most teams keep aggregates in a store and publish to Kafka via outbox/CDC.' },
    ],
  },

  lifecycle: {
    summary: 'One command on a long-lived aggregate: load snapshot + tail, decide, append with an expected version, replicate, acknowledge, and fan out to subscribers.',
    stages: [
      { stage: 'Read snapshot', what: 'Fetch the latest snapshot for `account-42` (version 1000).', cost: 'One key lookup', ms: 0.8, part: 'snapshot' },
      { stage: 'Read stream tail', what: 'Range-read versions 1001..1037 from the stream index.', cost: 'Index seek + ~37 small reads (often cached)', ms: 1.5, part: 'stream' },
      { stage: 'Fold + decide', what: 'Apply events to rebuild state, upcast old versions, check invariants, produce new events.', cost: 'CPU only, µs per event', ms: 0.1, part: 'handler' },
      { stage: 'Expected-version check', what: 'Leader verifies stream is still at 1037 (or the unique constraint does).', cost: 'In-memory / index probe', ms: 0.05, part: 'occ' },
      { stage: 'Append + fsync', what: 'Write the batch to the active log segment and fsync (group-committed with other writers).', cost: 'fsync on SSD ~0.1–2 ms', ms: 1, part: 'log' },
      { stage: 'Quorum replication', what: 'Followers append and ack; leader acknowledges after a majority.', cost: '1 RTT inside a region', ms: 1, part: 'log' },
      { stage: 'Acknowledge', what: 'Return new stream version and global position (the read-your-writes token).', cost: 'Response serialization', ms: 0.1, part: 'log' },
      { stage: 'Push to subscribers', what: 'Live subscriptions receive the event; projectors update read models.', cost: 'Async, off the command path', ms: 5, part: 'subs' },
    ],
  },

  deepDives: [
    {
      title: 'Optimistic concurrency: expected version per stream',
      hook: 'The stream version is the only lock you need — and it is why aggregates must be small.',
      body: [
        'The handler reads the stream at version N, decides, and appends with `expectedVersion = N`. Exactly one concurrent writer wins; the loser gets `WrongExpectedVersion`, reloads, re-runs the decision on the new state and either succeeds or rejects the command. No lock is held during the decision, so slow business logic never blocks other writers.',
        'Retries must re-execute the **decision**, not just re-send the same events — the whole point is that the state changed. Bound retries (3–5) and surface a conflict if contention persists.',
        'The aggregate is the consistency boundary. If two invariants must hold atomically they belong in one stream; anything else is coordinated asynchronously (sagas, process managers). A "hot" aggregate (a global counter, a popular concert’s seat map) turns optimistic concurrency into a retry storm.',
      ],
      code: {
        lang: 'sql',
        caption: 'Postgres: uniqueness is the concurrency check',
        code: `CREATE TABLE events (
  global_position bigserial PRIMARY KEY,
  stream_id       text        NOT NULL,
  version         int         NOT NULL,
  event_id        uuid        NOT NULL UNIQUE,  -- idempotent retries
  type            text        NOT NULL,
  schema_version  smallint    NOT NULL DEFAULT 1,
  data            jsonb       NOT NULL,
  metadata        jsonb       NOT NULL,
  tx_id           xid8        NOT NULL DEFAULT pg_current_xact_id(),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stream_id, version)
);
-- expectedVersion = 1037: insert 1038, 1039 ... in one transaction.
-- A concurrent writer violates UNIQUE(stream_id, version) -> 23505 -> reload & retry.`,
      },
      insight: 'Optimistic concurrency only protects invariants **inside one stream**. "Username must be globally unique" cannot be enforced by any single aggregate — you need a separate reservation stream/table with its own uniqueness constraint.',
    },
    {
      title: 'Global ordering and the sequence-gap problem on SQL',
      hook: 'A `bigserial` position is assigned at insert, not at commit — subscribers can skip events forever.',
      body: [
        'Transaction A takes position 101 and is slow; transaction B takes 102 and commits first. A projector reading `WHERE position > 100` sees 102, checkpoints 102, and when A finally commits, 101 is behind the checkpoint and is **never processed**. Rolled-back transactions also leave permanent gaps, so "wait for the gap to fill" alone does not work.',
        'Fixes, in increasing sophistication: serialize all appends (a global advisory lock — simple, caps throughput at one writer); a **high-water mark** that only exposes positions below the oldest in-flight transaction, with a timeout to treat stale gaps as rollbacks (Marten’s approach); or record the writing transaction id and only read events whose transaction is older than every running transaction.',
        'Purpose-built stores avoid the problem by assigning the global position in the single leader at write time in log order, so position order equals durable order.',
      ],
      diagram: {
        type: 'sequence',
        title: 'How a gap loses an event',
        actors: ['Tx A', 'Tx B', 'events', 'Projector', 'Checkpoint'],
        messages: [
          { from: 'Tx A', to: 'events', label: 'INSERT → pos 101 (uncommitted)' },
          { from: 'Tx B', to: 'events', label: 'INSERT → pos 102, COMMIT' },
          { from: 'Projector', to: 'events', label: 'SELECT pos > 100' },
          { from: 'events', to: 'Projector', label: 'returns only 102', dashed: true },
          { from: 'Projector', to: 'Checkpoint', label: 'save 102', tone: 'warn' },
          { from: 'Tx A', to: 'events', label: 'COMMIT pos 101' },
          { from: 'Projector', to: 'events', label: 'SELECT pos > 102 — 101 lost', tone: 'bad' },
        ],
      },
      code: {
        lang: 'sql',
        caption: 'Read only events from transactions that can no longer be in flight (Postgres 13+)',
        code: `SELECT global_position, stream_id, type, data
FROM events
WHERE (tx_id, global_position) > ($last_tx_id, $last_position)
  AND tx_id < pg_snapshot_xmin(pg_current_snapshot())
ORDER BY tx_id, global_position
LIMIT 500;
-- checkpoint = (tx_id, global_position) of the last row processed`,
      },
      insight: 'The gap problem is invisible in tests (single writer) and appears only under production concurrency, as a handful of silently missing rows in a read model. If you build on SQL, prove your subscription logic with a concurrent-writer test, or buy a store that solved it.',
    },
    {
      title: 'Snapshots and stream length',
      hook: 'Snapshots fix load time, but a stream that needs them is often a modelling smell.',
      body: [
        'Load cost is linear in events since the last snapshot. Snapshot every N events (100–1,000 is typical) or when load time exceeds a budget. The snapshot carries its own schema version; when aggregate code changes incompatibly, you delete snapshots and let them regenerate lazily.',
        'Prefer shorter-lived streams first: "close the books" by period (`account-42-2026-11`), start a new stream with an opening-balance event, and archive the old one. This keeps loads fast without a cache that can go stale or carry a bug forward.',
      ],
      bullets: [
        'Snapshot asynchronously after the append so it never adds command latency.',
        'Never project from snapshots — read models are built from events, otherwise a buggy snapshot poisons them.',
        'Measure: events loaded per command (p99) and aggregate load time; alert when a stream passes ~10k events.',
      ],
      insight: 'A snapshot is a cache keyed by `(streamId, version, codeVersion)`. Treat invalidation like any cache: if you forget the code-version dimension you will silently load state computed by old logic.',
    },
    {
      title: 'Event schema evolution',
      hook: 'Events are a public API to your future self; they can never be migrated in place.',
      body: [
        'Greg Young’s "Versioning in an Event Sourced System" lays out the options. **Weak schema** (tolerant reader): JSON events, consumers ignore unknown fields and default missing ones — handles most additive changes for free. **Upcasting**: a chain of pure functions turns `v1 → v2 → v3` on read, so handlers know only the latest version. **New event type**: when the meaning changes (`PriceChanged` vs `PriceCorrected`), do not hide it in a version bump.',
        'For a fundamental model change, **copy-and-transform**: stream events through a transformer into a new store, then cut over. It is an operational project (verification, dual reads, rollback plan), so it is a last resort.',
        'Put `type` and `schemaVersion` in the envelope from day one and register schemas (Avro/Protobuf with a schema registry, or JSON Schema) so producers cannot ship breaking changes by accident.',
      ],
      table: {
        caption: 'Change → technique',
        columns: ['Change', 'Technique', 'Cost'],
        rows: [
          ['Add optional field', 'Weak schema / default', 'None'],
          ['Rename or split field', 'Upcaster v1 → v2', 'Small, runs on every read'],
          ['Meaning changed', 'New event type', 'Handlers support both forever'],
          ['Wrong aggregate boundaries', 'Copy-and-transform store', 'Migration project'],
          ['Bad data in an event', 'Compensating event', 'Append a correction, never edit'],
        ],
      },
      insight: 'Upcasters run on every load and every replay, forever. Keep them pure, fast and tested against a corpus of real historical events — a throwing upcaster blocks every projection rebuild.',
    },
    {
      title: 'EventStoreDB internals and subscriptions',
      hook: 'Catch-up vs persistent subscriptions is a choice about who owns the checkpoint and ordering.',
      body: [
        'Writes go to the leader, which appends to the current **chunk** (256 MB file) of the transaction log; once full a chunk becomes immutable, and **scavenging** later rewrites chunks to drop deleted or truncated streams (`$maxAge`, `$maxCount`, `$tb` metadata). The index is LSM-like: a memtable of `(streamHash, version) → position` flushed to sorted **PTables** and merged in the background.',
        '**Catch-up subscriptions**: the client reads from its stored checkpoint, receives history then live events, in order, and owns the checkpoint (ideally stored with its read model). **Persistent subscriptions**: the server stores the checkpoint for a named group, load-balances events across consumers (`RoundRobin`, `DispatchToSingle`, `Pinned`), requires acks, retries and parks failures — at the cost of per-stream ordering under round-robin.',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Catch-up', tone: 'ok', points: ['Client stores checkpoint', 'Strict order', 'One consumer per projection', 'Ideal for read models'] },
          { name: 'Persistent', tone: 'info', points: ['Server stores checkpoint', 'Competing consumers', 'Ack/nack, retry, park', 'Order not guaranteed'] },
        ],
      },
      insight: 'Use catch-up subscriptions for projections (order matters, checkpoint lives with the data); persistent subscriptions are for work-queue style side effects like sending emails, where parallelism beats ordering.',
    },
    {
      title: 'Kafka as an event store: why it is awkward',
      hook: 'Kafka is a superb log, but an event store needs conditional appends and per-entity reads.',
      body: [
        'Three gaps. **No optimistic concurrency per key**: Kafka cannot reject an append because `order-77` moved past version 12 (a conditional-publish proposal, KIP-27, was never shipped); idempotent producers only dedupe retries of the same producer session. **No efficient per-aggregate read**: a partition mixes thousands of aggregates, so loading one means scanning or keeping a separate state store. **Retention and compaction**: defaults delete data after 7 days, and log compaction keeps only the latest record per key — exactly wrong for event sourcing.',
        'Workable patterns: single-writer per partition (all commands for a key routed to one consumer that holds state in a Kafka Streams store, so concurrency is serialized rather than checked), or store aggregates in a database and publish to Kafka through an outbox for distribution.',
      ],
      insight: 'The common good architecture is "store per service for truth, Kafka for distribution": aggregates and concurrency in Postgres/EventStoreDB/DynamoDB, integration events relayed to Kafka with CDC, with Kafka retention sized for consumer recovery rather than as the archive.',
    },
    {
      title: 'GDPR, crypto-shredding and immutable history',
      hook: '"Never delete" collides with "right to erasure" — design for it before the first event is written.',
      body: [
        'Options: keep PII out of events (store a reference to a PII service you can delete from); or **crypto-shredding** — encrypt PII fields with a per-subject key held in a KMS/key table and delete the key on an erasure request, making every copy (including backups and Kafka topics) unreadable. Some stores also support stream truncation/deletion plus scavenging for whole-stream erasure.',
        'Crypto-shredding has costs: key lookups on every read and replay (cache them), projections must tolerate "forgotten" payloads, and anything that copied plaintext downstream (search indexes, data lakes) needs its own erasure path.',
      ],
      insight: 'Crypto-shredding only works if no plaintext ever escapes. Audit every projector and sink: a single Elasticsearch index or warehouse table built from decrypted events quietly defeats it.',
    },
    {
      title: 'Audit, temporal queries and the cost of replay',
      hook: 'History is the superpower — but every replay pays for all of it again.',
      body: [
        'Because state is a fold, "what was the balance at 2026-03-03T10:00?" is just a fold that stops at that timestamp (or global position). Audit is the stream itself, with `metadata.userId`, `correlationId` and `causationId` answering who did it and as a consequence of what. Bitemporal needs (when it happened vs when we learned it) are modelled with an explicit `effectiveAt` in the payload, since `recordedAt` is fixed at append.',
        'Replay is linear in history. A projector at 20k events/s needs ~14 h for 1B events, and costs grow every day the system lives. Mitigations: partitioned replays, batched sink writes (100–1,000 events per transaction), starting from a verified view snapshot, and archiving cold streams that no projection needs.',
      ],
      code: {
        lang: 'python',
        caption: 'Temporal query = fold with a cut-off',
        code: `def balance_as_of(stream_id, as_of):
    state = Account.empty()
    for e in store.read_stream(stream_id):          # ordered by version
        if e.recorded_at > as_of:
            break
        state = state.apply(upcast(e))              # pure, deterministic
    return state.balance`,
      },
      insight: 'Fold functions must be deterministic and side-effect free — no "now()", no remote lookups. Otherwise a temporal query or rebuild returns a different answer than the one users saw at the time, which is exactly what an auditor will check.',
    },
  ],

  scaling: {
    body: [
      'Writes scale by **partitioning streams**: each stream belongs to exactly one leader/partition, so per-stream ordering and the expected-version check stay local. A single EventStoreDB cluster has one leader for all writes; past that you shard by stream id across clusters (or use DynamoDB/Cassandra-style partitioned stores and give up global order).',
      'Reads scale trivially because events are immutable: followers, read replicas and caches can serve stream reads and subscriptions. The real scaling pain is **replay**: rebuilding a projection over billions of events is bounded by read throughput and projector write speed, so plan for parallel rebuilds by partition and keep history in cheap tiered storage.',
      'Multi-region: per-stream single-writer is the rule. Active-active on the same stream breaks expected-version semantics, so pin each stream’s home region (by tenant/user) and replicate asynchronously for reads and DR.',
    ],
    bullets: [
      'Global order is a scaling limit: you can have it only within one log; across shards you get per-shard order plus timestamps.',
      'Leader failover (Raft-like election in a 3-node cluster) takes seconds; clients must retry appends idempotently with the same event ids.',
      'Hot streams cap throughput per aggregate at roughly 1/(append latency) for serialized writers — redesign the aggregate instead of scaling hardware.',
      'Archive old chunks/partitions to object storage; keep recent history hot for fast replays.',
      'Separate subscription load (many projectors) from command load with followers or read-only replicas.',
    ],
    diagram: {
      type: 'flow',
      title: 'Partitioned event store',
      nodes: [
        { label: 'Router', sub: 'hash(streamId) → shard' },
        { label: 'Shard leaders', sub: 'per-stream order + OCC', tone: 'accent' },
        { label: 'Quorum followers', sub: 'replicate, serve reads', tone: 'ok' },
        { label: 'Per-shard $all', sub: 'subscribers checkpoint per shard', tone: 'violet' },
        { label: 'Archive tier', sub: 'object storage for replay' },
      ],
    },
  },

  failures: [
    { name: 'Skipped events from sequence gaps', symptom: 'A few orders never appear in a read model; no errors anywhere.', detect: 'Periodic reconciliation: count events per type in the store vs rows in the view; gaps in `global_position` older than N seconds.', mitigate: 'Transaction-id/high-water-mark reads, or serialize appends; rebuild affected projections.' },
    { name: 'Hot-stream contention', symptom: 'Command latency and `WrongExpectedVersion` rates spike on one aggregate.', detect: 'Concurrency-conflict rate per stream category; p99 command latency; top-N streams by append rate.', mitigate: 'Split the aggregate, queue commands per stream (single writer), or move the counter to commutative read-model math.' },
    { name: 'Unbounded stream load time', symptom: 'Commands on old customers take seconds.', detect: 'Histogram of events loaded per command; stream length p99.', mitigate: 'Snapshots, period-closing streams, or archiving.' },
    { name: 'Upcaster/deserialization failure blocks replay', symptom: 'Projection rebuild stops at a 2019 event nobody remembers.', detect: 'Projector stalled with lag rising and a repeated exception at one position.', mitigate: 'Contract tests against a corpus of historical events; schema registry; tolerant readers.' },
    { name: 'Leader failover duplicate appends', symptom: 'Same event appears twice after a timeout + retry.', detect: 'Duplicate `eventId` detection in projectors; idempotency-violation counter.', mitigate: 'Client-generated event ids with store-side dedupe; retries reuse them.' },
    { name: 'Disk growth without retention', symptom: 'Store grows TBs/year; backups and replays get slower.', detect: 'Bytes per day, chunk count, replay throughput trend.', mitigate: 'Tiered archive, `$maxAge`/truncation for transient streams, compact payloads (no blobs in events).' },
  ],

  warStories: [
    { title: 'The missing 0.1% of orders', source: 'Composite of common incidents', what: 'A team built an event store on Postgres with a `bigserial` position and a projector polling `position > checkpoint`. Under Black-Friday concurrency, long transactions committed after later positions and the projector skipped them. Customers saw orders "disappear" from their history; the store itself was correct.', lesson: 'Global position must reflect commit order or the reader must wait for in-flight transactions. Add an automated store-vs-view reconciliation job.' },
    { title: 'Kafka with log compaction as the event store', source: 'Composite of common incidents', what: 'A topic keyed by aggregate id was switched to `cleanup.policy=compact` to save disk. Compaction kept only the latest event per aggregate; months later a projection rebuild produced nonsense because the intermediate history was gone.', lesson: 'Compaction is for state (snapshots/changelogs), never for event history. Use `retention.ms=-1` or a real store plus an archive.' },
    { title: 'GDPR request vs immutable log', source: 'Composite of common incidents', what: 'A fintech received erasure requests and discovered names and emails embedded in five years of events, replicated into Kafka, a data lake and backups. The fix took a copy-and-transform migration of the entire store.', lesson: 'Decide PII handling (references or crypto-shredding) before the first event; retrofitting costs a migration.' },
  ],

  numbers: [
    { label: 'Append latency (single region, quorum)', value: '1–5 ms', note: 'fsync + one replication round trip' },
    { label: 'EventStoreDB chunk file size', value: '256 MB', note: 'immutable once full; scavenged later' },
    { label: 'Snapshot interval', value: '100–1,000 events', note: 'or by load-time budget' },
    { label: 'Fold cost', value: '~1 µs per event', note: 'deserialization dominates' },
    { label: 'DynamoDB item / transaction limits', value: '400 KB / 100 items', note: 'TransactWriteItems max' },
    { label: 'DynamoDB Streams retention', value: '24 hours', note: 'not an archive' },
    { label: 'Kafka default retention', value: '7 days', note: '`retention.ms=604800000`' },
    { label: 'Typical event size', value: '0.5–2 KB', note: 'JSON with metadata' },
    { label: 'Hot stream ceiling (serialized)', value: '~200–1,000 appends/s', note: '≈ 1 / append latency' },
  ],

  capacity: {
    question: 'A payments platform appends 3,000 events/s at peak (avg 1,000/s) at ~1 KB each, keeps history forever, and must be able to rebuild a projection within 6 hours. Size storage and replay throughput.',
    steps: [
      'Daily volume: 1,000 events/s × 86,400 s ≈ 86M events/day ≈ 86 GB/day raw.',
      'Yearly: ≈ 31B events ≈ 31 TB/year; with 3× replication ≈ 95 TB/year of hot storage unless older data is tiered.',
      'Index: ~20–40 bytes per entry ⇒ ~1 TB/year of index — keep recent index hot, archive the rest.',
      'Rebuild after 2 years: 62B events in 6 h ⇒ ~2.9M events/s — impossible for one projector.',
      'So: partition replay (e.g. 256 partitions × ~11k events/s each), batch writes, or rebuild from a snapshot of the current view + recent tail.',
    ],
    answer: '~31 TB/year raw (≈ 95 TB replicated) → tier history to object storage after ~90 days. Full rebuilds of multi-year history are infeasible single-threaded; design projections to be partitionable by key and keep "rebuild from last-known-good snapshot" as the default recovery path.',
  },

  comparison: {
    caption: 'Where to keep event-sourced aggregates',
    columns: ['Product', 'Per-stream OCC', 'Global order', 'Subscriptions', 'Best fit'],
    rows: [
      ['EventStoreDB / KurrentDB', 'Native expected revision', 'Yes ($all)', 'Catch-up + persistent', 'ES as core architecture'],
      ['Postgres (Marten, custom)', 'UNIQUE(stream, version)', 'Needs gap handling', 'Polling / LISTEN / CDC', 'Teams already on Postgres, moderate volume'],
      ['Axon Server', 'Aggregate sequence number', 'Global token', 'Tracking processors', 'Java/Spring CQRS shops'],
      ['DynamoDB', 'Conditional put on sort key', 'No (per partition)', 'Streams 24 h', 'Serverless, massive scale, no global order'],
      ['Kafka', 'None per key', 'Per partition only', 'Consumer groups', 'Distribution log, not aggregate store'],
    ],
  },

  whenNot: [
    'Simple CRUD with no audit or temporal requirements — a table plus an `updated_at` and maybe a history trigger is far cheaper.',
    'Teams without experience in eventual consistency and schema evolution; a CRUD core with an outbox for domain events gives 80% of the benefit.',
    'Data dominated by large blobs or rapidly overwritten values (sensor last-value, cursor positions) — use a key-value store or time-series DB.',
    'When you mainly need integration events between services — use the transactional outbox, not full event sourcing.',
    'Global uniqueness or cross-entity invariants dominate the domain — a relational model with constraints fits better.',
  ],

  interview: [
    {
      q: 'How does an event store prevent lost updates without locks?',
      a: 'Each append carries the version the handler read. The store accepts the append only if the stream is still at that version, atomically — a unique `(stream_id, version)` constraint, a conditional put, or a check in the single leader. The losing writer reloads the new events, re-runs the decision and retries or rejects. No lock is held across business logic, so contention only costs retries on the same aggregate.',
      followUps: ['What if two invariants span two aggregates?', 'How many retries, and what do you return to the user?', 'How does this work in DynamoDB?'],
      seniorSignal: 'Explains that the aggregate is the consistency boundary and that retries must re-run the decision, and proposes a reservation pattern for cross-aggregate uniqueness.',
    },
    {
      q: 'You are implementing an event store on Postgres. What goes wrong with a `bigserial` global position?',
      a: 'Sequence values are allocated at insert time, but transactions commit in a different order, so a reader can see position 102 before 101 commits and checkpoint past it — the event is skipped forever. Rolled-back transactions also leave permanent gaps. Fixes are serializing appends, a high-water mark with a stale-gap timeout, or storing the transaction id and only reading events from transactions older than `pg_snapshot_xmin`. Prove it with a concurrent-writer test.',
      followUps: ['What does a single global lock cost in throughput?', 'How would you detect skipped events in production?', 'Does logical replication/CDC have the same issue?'],
      seniorSignal: 'Identifies insert-order vs commit-order and notes that CDC from the WAL is in commit order, which is another valid fix.',
    },
    {
      q: 'How do you evolve event schemas over five years?',
      a: 'Envelope with `type` and `schemaVersion` from day one; weak schema for additive changes; upcasters that transform old versions on read so handlers know only the latest; new event types when meaning changes; copy-and-transform only for fundamental model changes. Snapshots are discarded on incompatible changes, and read models are rebuilt from upcasted streams. Test upcasters against a corpus of real historical events.',
      followUps: ['Where do upcasters run — store, client, or projector?', 'How do you deal with an event that was wrong?', 'How does a schema registry help here?'],
      seniorSignal: 'Distinguishes structural change (upcast) from semantic change (new type), and corrections via compensating events instead of edits.',
    },
    {
      q: 'Why not use Kafka as the event store?',
      a: 'Kafka has no per-key conditional append, so it cannot enforce expected-version concurrency; a partition mixes aggregates, so loading one entity needs a scan or a separate state store; and default retention or compaction destroys history. It works only with a single writer per key (e.g. Kafka Streams with a state store). The usual design keeps aggregates in a database or event store and publishes to Kafka with an outbox/CDC.',
      followUps: ['What does Kafka Streams’ exactly-once give you here and what not?', 'How would you size retention for consumers?', 'What about infinite retention with tiered storage?'],
      seniorSignal: 'Separates "source of truth" from "distribution log" and names the single-writer workaround with its trade-offs.',
    },
    {
      q: 'A user invokes GDPR erasure. Your events are immutable. What do you do?',
      a: 'Ideally PII was never in events — events hold a reference to a PII store that you can delete from. Otherwise crypto-shredding: PII fields are encrypted with a per-subject key; deleting the key renders all copies unreadable, including backups and Kafka. Projections must handle forgotten payloads and every downstream copy of plaintext needs its own erasure path.',
      followUps: ['Where do you keep the keys and how do you cache them for replay?', 'What about derived data in a warehouse?', 'Can you truncate a stream instead?'],
      seniorSignal: 'Mentions the plaintext-leak problem in downstream sinks and backups, not just the store.',
    },
    {
      q: 'How do you rebuild a read model over 10 billion events without downtime?',
      a: 'Build v2 alongside v1 (blue/green): replay into a new table/index from position 0, parallelized by key partition with batched writes, while v1 keeps serving. When v2 catches up to the live head, switch the query alias and delete v1. If full replay is too slow, seed v2 from a verified snapshot of current state and replay only the tail.',
      followUps: ['How do you estimate the replay duration?', 'What if the projector needs global order?', 'How do you validate v2 before the switch?'],
      seniorSignal: 'Does the arithmetic (events/s per partition) and has a validation step (row counts, checksums) before cutover.',
    },
  ],

  takeaways: [
    'An event store is an append-only log with two orderings: stream version for concurrency, global position for subscribers.',
    'Optimistic concurrency via expected version protects one stream; the aggregate is the consistency boundary.',
    'On SQL, insert order ≠ commit order — handle sequence gaps or you will silently skip events.',
    'Snapshots are a cache; short-lived streams beat clever snapshotting.',
    'Plan schema evolution (weak schema, upcasters, new types) and GDPR (crypto-shredding) before the first event.',
    'Kafka is a distribution log, not an aggregate store: no per-key OCC, mixed partitions, retention traps.',
    'Replay cost grows forever — make projections partitionable and keep a snapshot-based recovery path.',
  ],
};

export default deep;
