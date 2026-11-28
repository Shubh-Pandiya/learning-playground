import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'read-model',

  problem: {
    why: 'The model that enforces business rules (normalized tables or event streams) is shaped for **writes**, not for screens. Serving "my orders with item counts, customer names and shipping status, sorted by date" from it means joins across tables — or across services — on every request. A read model is a **precomputed, denormalized answer** to one query, maintained asynchronously from the write side’s changes, so the read becomes one indexed lookup in a store chosen for that query.',
    withoutIt: [
      'Hot screens run 5-way joins or fan out to 4 services per request; p99 is dominated by the slowest dependency.',
      'Read traffic (often 10–100× writes) contends with writes on the same primary and indexes.',
      'Full-text, geo or faceted queries are bolted onto an OLTP database with `LIKE \'%x%\'` scans.',
      'An event-sourced write side cannot be queried at all except by replaying streams.',
      'Every new screen needs a schema change on the critical transactional database.',
    ],
    position: 'On the **query side** of CQRS: projectors consume events/CDC from the write side and update it; query APIs read from it. Commands never write to it directly.',
    diagram: {
      type: 'flow',
      title: 'CQRS read path',
      nodes: [
        { label: 'Write model', sub: 'invariants, normalized/events', tone: 'info' },
        { label: 'Change feed', sub: 'events or CDC' },
        { label: 'Projector', sub: 'idempotent upserts', tone: 'violet' },
        { label: 'Read model', sub: 'one view per query', tone: 'ok' },
        { label: 'Query API', sub: '1 lookup, no joins', tone: 'accent' },
      ],
    },
  },

  architecture: {
    overview: 'A read model is a set of **views**, each owned by one projector and shaped for one access pattern: the primary key is the query’s key, indexes match its `WHERE`/`ORDER BY`, and every field the screen shows is already copied in. Next to the data sits a **checkpoint** (last applied position) that defines how fresh the view is. Views are disposable: they can be dropped and rebuilt from the log, which is what makes aggressive denormalization safe.',
    diagram: {
      type: 'layers',
      title: 'Read side anatomy',
      layers: [
        { name: 'Query API', items: ['Per-screen endpoints', 'minPosition / version token', 'Staleness header'], tone: 'accent' },
        { name: 'Views', items: ['order_summary (Postgres)', 'search index (Elasticsearch)', 'timeline (Redis ZSET)', 'by_day (Cassandra)'], tone: 'ok' },
        { name: 'Projection state', items: ['Checkpoint per view', 'Schema version per view', 'Lag metrics'], tone: 'violet' },
        { name: 'Source of truth', items: ['Event store / $all', 'or CDC from WAL/binlog'], tone: 'info' },
      ],
    },
    blocks: [
      { name: 'Query-shaped table', what: 'Primary key = lookup key; columns copied from several aggregates (customer name, item count, totals). Write amplification is accepted to make reads O(1) index probes.' },
      { name: 'Version / position guard', what: 'Each row stores `last_event_version` (per aggregate) or `last_position`; upserts include `WHERE row.version < EXCLUDED.version` so replays and reordering are no-ops.' },
      { name: 'Checkpoint row', what: '`projection_checkpoints(view, position, updated_at)` committed in the same transaction as the view rows when they share a database; exposes freshness to the API.' },
      { name: 'Schema-per-view / versioned names', what: 'Each view lives in its own table or schema with a version suffix (`order_summary_v3`), so a rebuild creates v4 side by side and switches an alias.' },
      { name: 'Read-your-writes token', what: 'The command returns the global position or aggregate version of its write; the query passes it back as `minPosition` and the API waits (bounded) until the checkpoint reaches it.' },
      { name: 'Lag monitor', what: 'Publishes `head_position − checkpoint` (events) and `now − timestamp(last applied event)` (seconds) per view, with SLO-based alerts.' },
    ],
    real: [
      { name: 'Postgres projection tables (Marten, Axon, custom)', how: 'Views as tables updated by projectors with `INSERT … ON CONFLICT DO UPDATE`, checkpoint in the same transaction, indexes per query. Marten also supports inline projections updated in the command’s own transaction for strong consistency.' },
      { name: 'Elasticsearch / OpenSearch', how: 'Search views indexed from CDC or events; documents use the aggregate id as `_id` and `version_type=external` so older versions are rejected. Near-real-time: new docs become searchable after a refresh (`refresh_interval` default 1 s). Rebuilds go into a new index, then an **index alias** swap.' },
      { name: 'Redis (timelines, counters, leaderboards)', how: 'Twitter’s home timeline is a read model: fan-out-on-write pushes tweet ids into each follower’s Redis list (capped at roughly 800 entries per the 2012 "Timelines at Scale" talk), so reading a timeline is one list fetch plus hydration.' },
      { name: 'Cassandra / DynamoDB tables per query', how: 'Query-first modelling: one table per access pattern (`orders_by_customer`, `orders_by_day`) written by projectors; DynamoDB GSIs are an auto-maintained, eventually consistent read model with no strongly consistent read option.' },
      { name: 'Materialize / RisingWave / ksqlDB', how: 'Declare the view in SQL over Kafka/CDC streams; the engine maintains it incrementally (Materialize on differential dataflow) and serves it with low-latency reads — the projector is generated for you.' },
    ],
  },

  lifecycle: {
    summary: 'From a committed write to a user seeing it on their "My orders" page, including a read-your-writes wait.',
    stages: [
      { stage: 'Write committed', what: 'Command appends `OrderPlaced` at global position 5001 and returns `{position: 5001}`.', cost: 'Write path (not read-model cost)', ms: 4, part: 'feed' },
      { stage: 'Delivery to projector', what: 'Subscription / CDC delivers the event.', cost: 'Push or poll interval', ms: 20, part: 'feed' },
      { stage: 'Enrich + map', what: 'Projector maps the event to row changes, using its own copy of customer names (no remote calls).', cost: 'CPU', ms: 0.1, part: 'writer' },
      { stage: 'Upsert + checkpoint', what: 'One transaction updates `order_summary`, `customer_stats` and the checkpoint.', cost: 'Indexed upserts + commit fsync', ms: 3, part: 'checkpoint' },
      { stage: 'Query arrives', what: 'Client calls `GET /orders?minPosition=5001`.', cost: 'API hop', ms: 1, part: 'query' },
      { stage: 'Freshness check', what: 'Compare checkpoint with token; already ≥ 5001 so no wait (otherwise poll/notify up to ~500 ms).', cost: 'Cached checkpoint read', ms: 0.2, part: 'query' },
      { stage: 'Indexed read', what: '`WHERE customer_id = 5 ORDER BY placed_at DESC LIMIT 20` on a matching composite index.', cost: 'Index range scan', ms: 1, part: 'table' },
    ],
  },

  deepDives: [
    {
      title: 'Designing views: one query, one shape',
      hook: 'A read model is designed backwards from a screen, not forwards from the domain.',
      body: [
        'Start from the query: key, filters, sort, page size, fields shown. That gives the primary key, the composite index and the columns to copy. If two screens need different sort orders or keys, build two views — storage is cheaper than joins at read time.',
        'Denormalized fields create **update fan-out**: `CustomerRenamed` must update every order row of that customer. Bound it (copy only stable fields, or store ids and hydrate the volatile ones from a small cache) and make sure the projector keeps its own lookup table of reference data rather than calling other services during projection.',
      ],
      code: {
        lang: 'sql',
        caption: 'A view built for "my recent orders"',
        code: `CREATE TABLE order_summary_v3 (
  order_id        uuid PRIMARY KEY,
  customer_id     uuid        NOT NULL,
  customer_name   text        NOT NULL,      -- copied from Customer events
  status          text        NOT NULL,
  item_count      int         NOT NULL,
  total_cents     bigint      NOT NULL,
  placed_at       timestamptz NOT NULL,
  last_version    int         NOT NULL       -- per-aggregate guard
);
CREATE INDEX ON order_summary_v3 (customer_id, placed_at DESC);`,
      },
      insight: 'If a projector calls another service to enrich an event, its output depends on when it ran — replays produce different data and an outage stalls the view. Project reference data into a local lookup table from its own events instead.',
    },
    {
      title: 'Eventual consistency and read-your-writes',
      hook: 'Users forgive stale data about others; they never forgive losing their own change.',
      body: [
        'Lag is normally tens to hundreds of ms but unbounded under incidents. Strategies, from cheapest: **optimistic UI** (client renders the change immediately and reconciles); **version token** (command returns position/version, query waits until the view reaches it, then times out to a "still processing" state); **route to the write model** for that one entity right after a write; **inline/synchronous projection** in the command’s transaction for the few views that truly need strong consistency.',
        'The wait must be bounded and cheap: cache the checkpoint, use LISTEN/NOTIFY or a pub/sub channel to wake waiters instead of tight polling, and return `202`/stale markers rather than hanging requests during a lag incident.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Version-token read-your-writes',
        actors: ['Client', 'Command API', 'Event store', 'Projector', 'Query API'],
        messages: [
          { from: 'Client', to: 'Command API', label: 'PlaceOrder' },
          { from: 'Command API', to: 'Event store', label: 'append' },
          { from: 'Command API', to: 'Client', label: '201 {position: 5001}', dashed: true },
          { from: 'Client', to: 'Query API', label: 'GET /orders?minPosition=5001' },
          { from: 'Event store', to: 'Projector', label: 'event 5001' },
          { from: 'Projector', to: 'Query API', label: 'checkpoint ≥ 5001 (notify)', tone: 'ok' },
          { from: 'Query API', to: 'Client', label: '200 includes new order', dashed: true },
        ],
      },
      insight: 'Read-your-writes across several views needs a token per view family or a global position; a per-aggregate version is not enough when the view aggregates many aggregates (e.g. customer totals).',
    },
    {
      title: 'Choosing the store per view',
      hook: 'The point of CQRS is that each view can live where its query is cheapest.',
      body: [
        'The read store is chosen per access pattern, and a single system typically uses two or three. The cost is operational: every store is another thing to back up, monitor, secure and rebuild, so default to the database you already run and add a specialized store only for a query it cannot serve.',
      ],
      table: {
        columns: ['Store', 'Good for', 'Watch out for'],
        rows: [
          ['Postgres', 'Most views, transactional checkpoint, ad-hoc SQL', 'Write amplification on wide fan-out updates'],
          ['Redis', 'Timelines, counters, leaderboards (ZSET), sub-ms reads', 'Memory-bound; persistence and rebuild time'],
          ['Elasticsearch', 'Full-text, facets, fuzzy, geo', '1 s refresh, no transactions, reindex cost'],
          ['Cassandra / DynamoDB', 'Huge per-key views, predictable latency', 'Query-first modelling, no ad-hoc queries'],
          ['ClickHouse / warehouse', 'Aggregations and analytics views', 'Not for point lookups at high QPS'],
        ],
      },
      insight: 'When the view lives in a different store than its checkpoint, you lose atomic "data + checkpoint" commits, so every write must be idempotent (external versions, version-guarded upserts).',
    },
    {
      title: 'Rebuilds: blue/green views',
      hook: 'Rebuildability is the feature that justifies the complexity — if you actually exercise it.',
      body: [
        'Changing a view (new column, bug fix) means replaying history into a **new version** of it. Run projector v4 from position 0 into `order_summary_v4` while v3 serves traffic; when v4’s lag is near zero, switch the read alias (a view/synonym in SQL, an index alias in Elasticsearch, a config flag in the API), then drop v3 after a soak period.',
        'Rebuild speed decides how often you can afford this. Batch inserts (use `COPY` or multi-row upserts), disable non-essential secondary indexes until catch-up, parallelize by key partition, and size the rebuild projector separately from the live one.',
      ],
      diagram: {
        type: 'flow',
        title: 'Blue/green view rebuild',
        nodes: [
          { label: 'Replay from 0', sub: 'projector v4, batched' },
          { label: 'order_summary_v4', sub: 'building, not served', tone: 'warn' },
          { label: 'Catch up to head', sub: 'lag ≈ 0' },
          { label: 'Validate', sub: 'counts, checksums, samples', tone: 'info' },
          { label: 'Swap alias', sub: 'v4 serves traffic', tone: 'ok' },
          { label: 'Drop v3', sub: 'after soak period' },
        ],
      },
      insight: 'Schedule a full rebuild of every view in staging regularly. Teams that never rebuild discover, during an incident, that an old event no longer deserializes or that replay takes three days.',
    },
    {
      title: 'Lag monitoring and freshness SLOs',
      hook: 'A read model without a lag metric is a cache with no TTL and no alarm.',
      body: [
        'Track two numbers per view: **event lag** (`head_position − checkpoint`) and **time lag** (`now − recorded_at` of the last applied event, or age of the oldest unapplied event). Time lag is what users feel; event lag tells you whether you are falling behind or just idle.',
        'Set SLOs per view (search: p99 < 5 s; order status: p99 < 1 s) and alert on burn rate. Expose freshness to clients (`X-Data-As-Of` header) so UIs can show "updated 30 s ago" during incidents instead of silently wrong data.',
      ],
      bullets: [
        'Kafka-based: consumer-group lag (`records-lag-max`, Burrow, `kafka-consumer-groups.sh --describe`).',
        'CDC-based: Debezium `MilliSecondsBehindSource` plus sink lag.',
        'Reconciliation: periodic count/checksum of view vs source for drift that lag cannot show.',
      ],
      insight: 'Lag of zero with stale data means the projector is skipping or failing silently. Pair lag with a correctness signal (reconciliation counts, dead-letter volume).',
    },
    {
      title: 'Inline vs async projections, and alias swaps',
      hook: 'Not every view has to be eventually consistent — you choose per view.',
      body: [
        '**Inline** projections update the view in the same transaction as the write (Marten inline projections, an Axon subscribing processor, a trigger). Reads are strongly consistent with the write, but write latency grows with every inline view, a view bug fails the command, and the view must live in the write database. **Async** projections decouple everything at the price of lag. A common split: inline for the one or two views the command flow depends on, async for everything else.',
        'Whatever the mode, readers must reach the view through an indirection you can flip: a SQL view or synonym, a search alias, or a config value in the query service. That indirection is what makes blue/green rebuilds and rollbacks a one-line change.',
      ],
      code: {
        lang: 'json',
        caption: 'Elasticsearch: atomic alias swap after a rebuild (POST /_aliases)',
        code: `{
  "actions": [
    { "remove": { "index": "products_v3", "alias": "products" } },
    { "add":    { "index": "products_v4", "alias": "products" } }
  ]
}`,
      },
      insight: 'Inline projections quietly re-couple read and write: a slow inline view becomes command latency and a failing one becomes command errors. Keep them few, cheap and in the same database.',
    },
    {
      title: 'When CQRS is overkill',
      hook: 'Martin Fowler’s warning: for most systems CQRS adds risky complexity.',
      body: [
        'If the same team owns the data, the read shapes are close to the write shapes and a few indexes or a read replica serve the queries, you do not need separate read models. Each view adds a projector, a checkpoint, lag, rebuild procedures and eventual-consistency UX work.',
        'A graded approach works: SQL views or materialized views (`REFRESH MATERIALIZED VIEW CONCURRENTLY`) first, read replicas for load, then a projected read model only for the screens where joins, cross-service data or search make the write model untenable.',
      ],
      insight: 'CQRS is a per-bounded-context (often per-screen) decision, not a system-wide architecture. Most successful uses have a handful of projected views next to plain CRUD.',
    },
  ],

  scaling: {
    body: [
      'Read models scale like caches: they are derived, so you can replicate them freely, shard them by the query key, and run independent copies per region near users, each fed by the replicated event log. Losing a view is an availability incident, not data loss.',
      'The write path to the views is the bottleneck: a single projector per view caps throughput, and fan-out denormalization multiplies writes. Partition projection by key, batch writes, and keep high-fan-out fields out of wide views.',
      'Multi-region: write region publishes the log; every region runs its own projectors and views. Cross-region lag adds 50–200 ms plus projector lag — tokens for read-your-writes must be region-aware, or reads right after a write go to the write region.',
    ],
    bullets: [
      'Rebuild capacity is a scaling dimension: size it so any view can be rebuilt within your RTO.',
      'Hot keys in views (celebrity timelines) need special handling, e.g. fan-out-on-read for very large followings as Twitter did.',
      'Keep views independent: one slow projector must not hold back others (separate consumer groups/checkpoints).',
      'Cache in front of views only if the view store cannot serve the QPS; otherwise you add another staleness layer.',
      'Per-view storage budgets: denormalized views can be 3–10× the size of the normalized data.',
    ],
    diagram: {
      type: 'flow',
      title: 'Multi-region read models',
      nodes: [
        { label: 'Write region log', sub: 'single source of truth', tone: 'info' },
        { label: 'Log replication', sub: '50–200 ms cross-region' },
        { label: 'Regional projectors', sub: 'independent checkpoints', tone: 'violet' },
        { label: 'Regional views', sub: 'served near users', tone: 'ok' },
      ],
    },
  },

  failures: [
    { name: 'User does not see own write', symptom: 'Support tickets: "I saved but it disappeared"; duplicate submissions.', detect: 'Rate of read-your-writes token timeouts; projector time-lag p99 vs SLO.', mitigate: 'Version tokens with bounded wait, optimistic UI, read-from-write-model for the edited entity.' },
    { name: 'View drift from source', symptom: 'Totals in dashboards disagree with the ledger.', detect: 'Nightly reconciliation job (counts/sums per key) with an alert on mismatch rate.', mitigate: 'Idempotent version-guarded upserts; fix bug and rebuild blue/green.' },
    { name: 'Command side writes the view', symptom: 'Two code paths update the same row; races and divergence after replays.', detect: 'Code ownership checks; DB grants showing non-projector writers.', mitigate: 'Only projectors have write grants on view tables.' },
    { name: 'Lag spiral during spikes', symptom: 'Lag grows from ms to minutes; search results and statuses stale.', detect: '`now − last_applied_event_time` > SLO; event lag slope positive for N minutes.', mitigate: 'Batching, more partitions, shed non-critical views, show freshness in UI.' },
    { name: 'Rebuild takes days', symptom: 'A bug fix cannot ship because replay is too slow.', detect: 'Measured replay throughput in staging × event count > RTO.', mitigate: 'Partitioned rebuilds, `COPY`-style bulk loads, seed from a verified snapshot.' },
    { name: 'Fan-out storm', symptom: 'One `CustomerRenamed` updates 2M order rows; projector stalls.', detect: 'Rows written per event histogram; per-event processing time p99.', mitigate: 'Do not denormalize volatile fields into high-cardinality views; hydrate at read time.' },
  ],

  warStories: [
    { title: 'Search index silently drifted for weeks', source: 'Composite of common incidents', what: 'An Elasticsearch view was maintained by dual writes from the API (DB first, then ES). Timeouts on ES were logged and ignored; over weeks ~0.5% of products were missing or stale in search. Nobody noticed until a merchant complained.', lesson: 'Feed search from CDC/events with idempotent external-version writes, and run a reconciliation job; dual writes always drift.' },
    { title: 'Twitter’s timelines as read models', source: 'Twitter, "Timelines at Scale" (Raffi Krikorian, QCon 2012)', what: 'Home timelines were precomputed by fan-out-on-write into Redis lists per user, making timeline reads cheap at enormous QPS. Accounts with huge follower counts made fan-out too expensive, so their tweets were merged at read time instead.', lesson: 'A read model is a trade of write amplification for read cost; for outlier keys the trade flips, so hybrid strategies are normal.' },
    { title: 'The "eventually" that took an hour', source: 'Composite of common incidents', what: 'A projector hit a malformed event and retried forever; lag grew for an hour while the order-status page kept serving stale data with no indication. Customers re-ordered, creating duplicates.', lesson: 'Alert on time lag, expose freshness to the UI, and park poison events with alerts instead of blocking silently.' },
  ],

  numbers: [
    { label: 'Typical projection lag', value: '10 ms – 1 s', note: 'unbounded during incidents' },
    { label: 'Indexed point/range read', value: '~1 ms', note: 'vs 10–100+ ms for multi-join or fan-out' },
    { label: 'Elasticsearch refresh interval', value: '1 s (default)', note: 'near-real-time visibility' },
    { label: 'Read-your-writes wait budget', value: '200–500 ms', note: 'then return stale marker' },
    { label: 'Read:write ratio that justifies views', value: '≥ 10:1', note: 'or cross-service joins' },
    { label: 'Denormalized storage overhead', value: '3–10×', note: 'vs normalized source' },
    { label: 'Rebuild throughput (batched)', value: '5k–50k events/s per partition', note: 'single-row upserts: ~1k/s' },
    { label: 'Cross-region log replication', value: '50–200 ms', note: 'adds to projector lag' },
  ],

  capacity: {
    question: 'An order-history view serves 20k reads/s and receives 2k events/s. History is 3B events. How do you size it and how long does a rebuild take?',
    steps: [
      'Reads: 20k/s of 1 ms indexed queries ≈ 20 CPU-cores of query work — 3–4 Postgres replicas with headroom, or a 4-shard setup.',
      'Writes: 2k events/s, each ~2 row upserts ⇒ 4k row writes/s — fine for one primary with batching (100 events/transaction ⇒ 20 commits/s).',
      'Storage: 500M orders × ~300 B/row + indexes ≈ 250 GB.',
      'Rebuild single projector at 10k events/s: 3B / 10k = 300k s ≈ 3.5 days — too slow.',
      'Partitioned into 32 key ranges at ~8k events/s each ≈ 256k events/s ⇒ ~3.3 h, limited by primary write capacity (use `COPY` and build indexes after load).',
    ],
    answer: 'A primary + 3–4 replicas (~250 GB) serves it; rebuilds must be partitioned (~32-way) to fit in a few hours, so the projector must not depend on global order across orders.',
  },

  comparison: {
    caption: 'Ways to serve read-optimized queries',
    columns: ['Approach', 'Freshness', 'Query flexibility', 'Ops cost', 'Use when'],
    rows: [
      ['Indexes / read replica', 'Replica lag (ms–s)', 'Full SQL', 'Low', 'Shapes similar to writes'],
      ['DB materialized view', 'On refresh', 'SQL', 'Low', 'Periodic aggregates, single DB'],
      ['Projected read model (CQRS)', 'Projector lag', 'Per-view only', 'Medium–high', 'Cross-aggregate/service views, event sourcing'],
      ['Streaming DB (Materialize, ksqlDB)', 'Incremental, sub-second', 'Declared SQL views', 'Medium (new infra)', 'Many views over Kafka/CDC'],
      ['Cache-aside (Redis)', 'TTL / invalidation', 'Key lookups', 'Low–medium', 'Hot keys over an existing query'],
    ],
  },

  whenNot: [
    'CRUD apps where read and write shapes match — indexes and a read replica are enough.',
    'Screens that require strict consistency with the write (account balance at transfer time) — read the write model or use an inline projection.',
    'Small teams without capacity to run projectors, lag monitoring and rebuild procedures.',
    'One-off analytics — query the warehouse/lake instead of maintaining a live view.',
  ],

  interview: [
    {
      q: 'Explain CQRS and when you would introduce a read model.',
      a: 'CQRS separates the model that enforces invariants on writes from models that answer queries. A read model is a denormalized, per-query view maintained asynchronously from the write side’s events or CDC. I introduce one when read shapes differ strongly from write shapes, reads span aggregates or services, or a specialized store (search, timelines) is needed — and only for those screens. The price is eventual consistency, extra infrastructure and rebuild procedures.',
      followUps: ['How do you keep the view correct under replays?', 'Would you put views in the same DB as the write model?', 'What is the smallest step before CQRS?'],
      seniorSignal: 'Treats CQRS as a per-screen decision and names the graded alternatives (indexes, replicas, materialized views) first.',
    },
    {
      q: 'A user saves a profile and the next page shows old data. Fix it.',
      a: 'Return a version token (position or aggregate version) from the command and have the query API wait, bounded, until the view’s checkpoint passes it, waking via notify rather than polling. For the edited entity, the UI can also apply the change optimistically or read from the write model for a short window. Expose freshness and fall back to a "still updating" state rather than hanging if lag is large.',
      followUps: ['What if the view is in Elasticsearch?', 'How does this work across regions?', 'Which token do you use for an aggregate view?'],
      seniorSignal: 'Bounds the wait, handles multi-region and aggregate views, and distinguishes own-writes from others’ writes.',
    },
    {
      q: 'How do you change a view’s schema in production with zero downtime?',
      a: 'Blue/green: create v2 next to v1, run a new projector from position 0 into v2 while v1 keeps serving, validate counts/checksums when v2 catches up, switch the alias, soak, drop v1. Speed it up with batched/bulk writes, deferred secondary indexes and key-partitioned replay. Additive changes can sometimes be backfilled in place, but blue/green is the safe default.',
      followUps: ['How long will the replay take for 3B events?', 'What if the projector needs global order?', 'How do you roll back?'],
      seniorSignal: 'Does replay-time arithmetic and includes validation and rollback, not just the swap.',
    },
    {
      q: 'Which store would you use for a product search view and how do you keep it consistent?',
      a: 'Elasticsearch/OpenSearch, fed from CDC or domain events — never dual writes from the API. Documents keyed by product id with `version_type=external` using the event/row version, so retries and reorders cannot overwrite newer data. Rebuilds go to a new index and an alias swap. Monitor CDC lag plus indexing lag, and reconcile counts periodically.',
      followUps: ['What happens during an ES cluster outage?', 'How do you handle deletes?', 'Why is the 1 s refresh relevant to UX?'],
      seniorSignal: 'Uses external versioning for idempotency and explains why dual writes drift.',
    },
    {
      q: 'Your view must show customer names on orders. Customers can rename. What are the trade-offs?',
      a: 'Copying the name into every order row makes reads trivial but each rename fans out to all that customer’s orders — fine if renames are rare and order counts per customer are bounded. Alternatively store only `customer_id` and hydrate names at read time from a small, cached customer view. The projector should maintain customer names from Customer events locally, not by calling the customer service.',
      followUps: ['What if a customer has 2M orders?', 'What about historical correctness — name at order time?', 'How do replays affect enrichment?'],
      seniorSignal: 'Reasons about fan-out cardinality and whether the business wants name-at-order-time vs current name.',
    },
  ],

  takeaways: [
    'A read model is a precomputed answer to one query, maintained from the write side’s change feed.',
    'Only projectors write views; commands never do.',
    'Every view is rebuildable — so practise blue/green rebuilds and size replay throughput.',
    'Read-your-writes: version token + bounded wait, optimistic UI, or read the write model for that entity.',
    'Pick the store per view (Postgres, Redis, Elasticsearch, Cassandra), but default to what you already run.',
    'Monitor time lag and correctness (reconciliation), not just event lag.',
    'CQRS is a per-screen decision; most systems need only a few projected views.',
  ],
};

export default deep;
