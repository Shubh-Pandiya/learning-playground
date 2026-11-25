import type { AdrCase } from '../types';

export const ADRS: AdrCase[] = [
  /* ------------------------------------------------------------------ */
  {
    id: 'adr-kafka-vs-sqs',
    title: 'Order events: Kafka or a simple queue?',
    context:
      'Checkout publishes ~400 `OrderPlaced` events/s (peaks of 2,000). Today one consumer needs them: the fulfillment worker, which must process each order exactly once in effect. Product has floated "analytics, fraud scoring and a recommendations feed might want order events later". The team is 6 backend engineers on AWS with no Kafka experience; nobody is on a dedicated platform team.',
    patterns: ['message-queues', 'pub-sub', 'idempotency'],
    options: [
      { name: 'Amazon SQS (+ SNS fan-out later)', summary: 'Managed queue: per-message ack, visibility timeout, DLQ, near-zero ops. Add SNS topics → per-consumer SQS queues if more consumers appear.' },
      { name: 'Kafka (self-managed or MSK)', summary: 'Partitioned, replayable log: many independent consumer groups, ordering per key, retention for days/weeks. Real operational and conceptual overhead.' },
      { name: 'RabbitMQ', summary: 'Flexible routing (exchanges), per-message acks, mature; you operate the cluster (or pay for a hosted one).' },
    ],
    recommended: 0,
    considerations: [
      { label: 'Number and kind of consumers (competing vs independent)', keywords: ['fan-out', 'fanout', 'subscriber', 'consumer group', 'competing', 'one consumer', 'multiple consumers', 'independent consumers'], why: 'A queue is for distributing work among competing workers; a log shines when many independent consumers each need the full stream. Today there is one.' },
      { label: 'Replay / retention needs', keywords: ['replay', 'retention', 'reprocess', 'rewind', 'backfill', 'history'], why: 'Kafka\'s killer feature is re-reading history (new consumer backfills, bug fixes). If nobody needs replay, you are paying for it anyway.' },
      { label: 'Operational burden and team skills', keywords: ['ops', 'operational', 'managed', 'expertise', 'experience', 'maintain', 'on-call', 'team'], why: 'Partitions, rebalances, retention tuning and broker upgrades are real work for a 6-person team without a platform group.' },
      { label: 'Ordering guarantees', keywords: ['ordering', 'in order', 'out of order', 'fifo', 'partition key', 'sequence'], why: 'Kafka orders per partition key; standard SQS does not order (FIFO queues do, at lower throughput). Decide whether per-order ordering actually matters.' },
      { label: 'Delivery semantics and idempotent consumers', keywords: ['idempot', 'at-least-once', 'duplicate', 'exactly-once', 'dedup'], why: 'Both are at-least-once in practice. "Exactly once" comes from idempotent consumers, not from the broker choice.' },
      { label: 'Reversibility / migration path', keywords: ['migrat', 'switch later', 'revisit', 'evolve', 'outbox', 'abstract', 'reversib', 'interface'], why: 'Publishing through an outbox and a thin interface keeps switching to Kafka cheap when a second and third consumer arrive.' },
    ],
    expert: {
      decision: 'Use SQS with a DLQ for the fulfillment worker, published via a transactional outbox. Add SNS → SQS fan-out if a second consumer appears; move to Kafka/MSK when replay or 3+ independent consumers become real requirements.',
      rationale: [
        'The actual requirement is one competing-consumer workload at modest throughput — the job queues were designed for.',
        'SQS is fully managed: no partitions, brokers or rebalances to operate, which matters more than features for a small team.',
        '"Might need it later" is not a requirement; the outbox + publisher interface keeps the Kafka option cheap to exercise.',
        'Effectively-once processing is achieved with an idempotent fulfillment consumer (dedupe on order id) regardless of broker.',
      ],
      consequences: [
        'No replay: a new consumer cannot backfill historic orders from the queue (it must backfill from the DB).',
        'No strict ordering on a standard queue; consumers must tolerate reordering (or use FIFO with lower throughput).',
        'Very low operational cost and fast delivery of the feature.',
      ],
      revisitWhen: 'Three or more independent consumers need the same events, a consumer needs to replay history, or sustained throughput reaches tens of thousands of events/s.',
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'adr-sql-vs-nosql-orders',
    title: 'Marketplace orders: relational or NoSQL?',
    context:
      'A new marketplace is building its orders domain: orders, line items, payments, refunds, sellers and buyers. Finance needs reports joining these, and support staff search orders by many fields. Launch volume is ~300 writes/s, growing maybe 5× in two years. An engineer proposes DynamoDB "because it scales infinitely"; another proposes Postgres.',
    patterns: ['sharding', 'read-replicas', 'search-indexing'],
    options: [
      { name: 'PostgreSQL (managed, e.g. RDS/Aurora)', summary: 'Relational schema, multi-row ACID transactions, joins and ad-hoc queries; scale reads with replicas, writes vertically, then partition if ever needed.' },
      { name: 'DynamoDB', summary: 'Key-value/document store with predictable latency at any scale; queries must be designed up front around partition and sort keys; limited transactions.' },
      { name: 'MongoDB', summary: 'Document store with flexible schema and secondary indexes; transactions supported but cross-document modelling is still a design choice.' },
    ],
    recommended: 0,
    considerations: [
      { label: 'Access patterns known vs ad-hoc', keywords: ['access pattern', 'query', 'queries', 'ad-hoc', 'adhoc', 'report', 'join'], why: 'NoSQL rewards fully known access patterns; finance reports and support search are ad-hoc and join-heavy.' },
      { label: 'Transactions and invariants', keywords: ['transaction', 'acid', 'atomic', 'invariant', 'constraint', 'foreign key', 'integrity'], why: 'An order, its items and its payment state must change together; relational transactions and constraints make that cheap and correct.' },
      { label: 'Realistic scale vs capacity', keywords: ['scale', 'throughput', 'writes/s', 'qps', 'growth', 'capacity', 'vertical'], why: '300 → 1,500 writes/s is comfortably within one well-sized Postgres primary; "infinite scale" solves a problem you do not have.' },
      { label: 'Schema evolution and data modelling', keywords: ['schema', 'migration', 'model', 'normaliz', 'denormaliz', 'flexib'], why: 'Relational schemas are explicit and migratable; single-table NoSQL designs are hard to change once access patterns shift.' },
      { label: 'Team familiarity and tooling', keywords: ['team', 'familiar', 'experience', 'tooling', 'skills', 'hire'], why: 'Most engineers, BI tools and ORMs speak SQL; a NoSQL data model needs specialist design skill to get right.' },
      { label: 'Future scaling path', keywords: ['shard', 'partition', 'replica', 'citus', 'escape hatch', 'later'], why: 'Read replicas, caching and eventually partitioning by seller/tenant are a known path if growth exceeds expectations.' },
    ],
    expert: {
      decision: 'Use managed PostgreSQL for the orders domain, with read replicas for reporting and a search index (fed by CDC) for support search. Design keys so that partitioning by seller later is possible.',
      rationale: [
        'The domain is relational and invariant-heavy (orders, items, payments, refunds must agree) — exactly what ACID transactions and constraints are for.',
        'Access patterns are not fully known; finance and support need ad-hoc queries and joins that NoSQL forces you to precompute.',
        'Projected write volume is well within a single primary; scale is not a differentiator here.',
        'SQL is the team\'s and the BI tooling\'s common language, reducing delivery risk.',
      ],
      consequences: [
        'Write scaling beyond one primary will eventually require partitioning (by seller/tenant) — plan keys now.',
        'Heavy reporting must be kept off the primary (replicas or a warehouse).',
        'Schema migrations need discipline (backwards-compatible, online).',
      ],
      revisitWhen: 'Sustained writes approach the limits of the largest primary instance, or a new feature has a narrow, known, very high-volume access pattern (e.g. event tracking) that fits a key-value store better.',
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'adr-cache-aside-vs-write-through',
    title: 'Product pricing cache: cache-aside or write-through?',
    context:
      'Product pages read prices ~15,000 times/s; prices change ~20 times/s (repricing jobs, promotions). A wrong price shown for more than a few seconds causes support tickets; a wrong price at checkout is a legal problem. The catalog DB is struggling with reads. The team is choosing a Redis caching strategy for price reads on product pages.',
    patterns: ['caching', 'read-replicas', 'cdn'],
    options: [
      { name: 'Cache-aside with delete-on-write + short TTL', summary: 'Readers check Redis, fill on miss; writers update the DB then delete the key. TTL bounds staleness if a delete is lost.' },
      { name: 'Write-through', summary: 'Every write goes through a layer that updates the cache and the DB together, so the cache is always populated with the latest value.' },
      { name: 'Write-behind (write-back)', summary: 'Writes go to the cache and are flushed to the DB asynchronously. Fast writes, but the cache becomes the temporary source of truth.' },
    ],
    recommended: 0,
    considerations: [
      { label: 'Staleness window and invalidation races', keywords: ['stale', 'staleness', 'race', 'invalidat', 'ttl', 'delete'], why: 'Delete-on-write plus a short TTL bounds staleness; the classic race (a slow reader re-filling an old value) is why TTLs are a safety net.' },
      { label: 'Read/write ratio and what gets cached', keywords: ['read-heavy', 'ratio', 'hot', 'hit rate', 'hit ratio', 'working set', 'cold'], why: 'Write-through caches every written key, even ones nobody reads; cache-aside caches what is actually read.' },
      { label: 'Failure behaviour (cache down)', keywords: ['cache down', 'outage', 'failure', 'fallback', 'stampede', 'thundering', 'coalesc'], why: 'With cache-aside the DB is the source of truth and the system degrades to DB reads (protect against stampedes); with write-behind a cache loss loses writes.' },
      { label: 'Durability / data loss', keywords: ['durab', 'data loss', 'lose writes', 'source of truth', 'write-behind', 'write behind'], why: 'Write-behind acknowledges writes that are not yet durable — unacceptable for prices that have legal weight.' },
      { label: 'Checkout must use authoritative price', keywords: ['checkout', 'authoritative', 'strong', 'from the db', 'from db', 'verify', 'consisten'], why: 'Whatever the page cache shows, the price charged must be read from (or validated against) the source of truth at checkout.' },
      { label: 'Complexity and coupling of the write path', keywords: ['complex', 'coupling', 'dual write', 'two writes', 'atomic', 'simple'], why: 'Write-through is a dual write unless one component owns both; partial failures leave cache and DB disagreeing.' },
    ],
    expert: {
      decision: 'Cache-aside for product-page price reads: update the DB, then delete the Redis key (with a retry, or via CDC-driven invalidation), 30–60s TTL as a backstop, and request coalescing on misses. Checkout always re-reads the price from the DB.',
      rationale: [
        'Read:write is ~750:1 and only a fraction of products are hot; cache-aside keeps the cache full of what is actually read.',
        'The DB remains the single source of truth; losing Redis costs latency, not data.',
        'Staleness is bounded by invalidation plus TTL, which meets "a few seconds" for display; checkout reads the authoritative price so display staleness never becomes a charge.',
        'Write-through would add a dual-write path with its own partial-failure modes for little gain at this write rate; write-behind risks losing price changes.',
      ],
      consequences: [
        'A short window of stale prices on product pages remains possible; monitor invalidation lag.',
        'A cold or failed cache shifts load to the DB — needs coalescing and a replicated Redis.',
        'Checkout incurs one DB read per item, which is acceptable at checkout volumes.',
      ],
      revisitWhen: 'Price changes become frequent enough that invalidation churn erodes the hit rate, or the business requires prices to be identical across page and checkout at all times (then consider versioned prices).',
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'adr-sync-rest-vs-async-events',
    title: 'Orders → Shipping, Loyalty, Email: REST calls or events?',
    context:
      'After an order is paid, four things must happen: create a shipment (Shipping svc), award points (Loyalty svc), send a receipt (Email svc), and update analytics. Today Orders calls each over REST in sequence inside the checkout request; checkout p99 is 1.8s and every Loyalty outage breaks checkout. The user needs to know only that the order is placed.',
    patterns: ['message-queues', 'pub-sub', 'saga', 'circuit-breaker'],
    options: [
      { name: 'Keep synchronous REST, add timeouts and circuit breakers', summary: 'Same call graph, hardened: tight timeouts, breakers, fallbacks.' },
      { name: 'Publish an `OrderPaid` event; downstreams consume asynchronously', summary: 'Orders commits and publishes via an outbox; Shipping, Loyalty, Email and analytics each subscribe with their own queue.' },
      { name: 'Hybrid: sync for what the user must see, async for the rest', summary: 'Synchronous only where the response depends on the result; everything else via events.' },
    ],
    recommended: 2,
    considerations: [
      { label: 'Does the user need the result in the response?', keywords: ['response', 'user needs', 'user-facing', 'wait', 'immediate', 'synchronous'], why: 'Only work whose result changes the response belongs on the request path. A receipt or loyalty points do not.' },
      { label: 'Availability coupling / blast radius', keywords: ['coupling', 'outage', 'availability', 'cascade', 'blast radius', 'independent', 'decoupl'], why: 'Synchronous chains multiply availability: four 99.9% services in series are ~99.6%. Events isolate downstream failures.' },
      { label: 'Latency', keywords: ['latency', 'p99', 'slow', 'fast', 'response time'], why: 'Sequential calls add up; async handoff costs one durable write.' },
      { label: 'Eventual consistency and user-visible lag', keywords: ['eventual', 'lag', 'delay', 'stale', 'consisten'], why: 'Points may appear seconds later; the UI must tolerate ("points pending") and teams must accept it.' },
      { label: 'Reliable publishing (outbox) and idempotent consumers', keywords: ['outbox', 'cdc', 'idempot', 'at-least-once', 'duplicate', 'dual write'], why: 'Commit-then-publish needs an outbox to avoid losing events; consumers must dedupe because delivery is at-least-once.' },
      { label: 'Observability and failure handling', keywords: ['dlq', 'dead letter', 'tracing', 'monitor', 'retry', 'backlog', 'observab'], why: 'Async failures are silent unless you have DLQs, backlog alerts and correlation IDs across consumers.' },
    ],
    expert: {
      decision: 'Hybrid: Orders commits the order and payment synchronously, then publishes `OrderPaid` via a transactional outbox. Shipping, Loyalty, Email and analytics consume asynchronously from their own queues with idempotent handlers and DLQs.',
      rationale: [
        'The user needs one fact in the response — "order placed" — which depends only on Orders and Payments.',
        'Moving the four downstreams off the request path removes their latency and their outages from checkout.',
        'Each consumer gets its own queue, so a slow Loyalty service builds a backlog instead of breaking checkout or other consumers.',
        'The outbox guarantees an event exists for every committed order; idempotent consumers make redelivery safe.',
      ],
      consequences: [
        'Points, shipment status and receipts appear seconds later; UI shows pending states.',
        'New operational surface: broker, outbox relay, DLQs, backlog alerting and distributed tracing.',
        'Cross-service failures (e.g. shipment cannot be created) now need compensations (a saga) rather than a failed HTTP response.',
      ],
      revisitWhen: 'A downstream result becomes part of the checkout response (e.g. guaranteed delivery date must be shown before confirming), or event-flow debugging cost outweighs the coupling it removes.',
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'adr-consistency-inventory',
    title: 'Ticket inventory: strong or eventual consistency?',
    context:
      'A ticketing site sells assigned seats for concerts. The event page shows "seats left" and a seat map (≈50k views/s at on-sale); checkout reserves specific seats (≈2k reservations/s at peak). Overselling a seat is unacceptable; a seat map that is a few seconds behind is tolerable. The team debates whether the whole inventory service needs strong consistency.',
    patterns: ['cqrs', 'caching', 'sharding', 'idempotency'],
    options: [
      { name: 'Strong consistency everywhere', summary: 'Every read (seat map, counts) and write goes to the primary inventory store with serialisable transactions.' },
      { name: 'Eventual consistency everywhere', summary: 'Seat state replicated to caches/regions; reservations accepted locally and reconciled later.' },
      { name: 'Split: strong for reservations, eventual for display', summary: 'Seat reservation is a conditional write on the authoritative row; seat maps and counts are served from a cached / projected read model.' },
    ],
    recommended: 2,
    considerations: [
      { label: 'Which invariant must never break', keywords: ['oversell', 'double-book', 'double book', 'invariant', 'unique', 'same seat', 'two buyers'], why: 'The invariant is "one seat, one buyer". Only the reservation write path has to enforce it.' },
      { label: 'Atomic conditional write / locking mechanism', keywords: ['conditional', 'compare-and-set', 'cas', 'optimistic', 'version', 'lock', 'select for update', 'transaction'], why: '`UPDATE seats SET holder=? WHERE id=? AND holder IS NULL` (or a CAS) enforces the invariant per seat without global locks.' },
      { label: 'Read volume vs write volume', keywords: ['read-heavy', 'read heavy', 'read volume', '50k', 'views', 'ratio', 'read load'], why: '25× more reads than reservations; forcing every read through the primary is what would melt it during on-sale.' },
      { label: 'Tolerable staleness for display', keywords: ['stale', 'staleness', 'eventual', 'lag', 'seconds', 'ttl', 'cache'], why: 'A seat shown as free that was just taken yields a "sorry, taken" at reserve time — annoying but correct.' },
      { label: 'Hold expiry and retries', keywords: ['expir', 'hold', 'timeout', 'release', 'idempot', 'retry'], why: 'Reservations are holds with expiry; retries of the reserve call must be idempotent so a user does not hold two seats.' },
      { label: 'Contention hot spots', keywords: ['contention', 'hot', 'shard', 'partition', 'queue', 'waiting room'], why: 'Popular events concentrate writes; partition seats by event/section and consider a waiting room to cap concurrency.' },
    ],
    expert: {
      decision: 'Split by operation: reservations are strongly consistent conditional writes on the authoritative seat row (partitioned by event/section), with idempotent hold requests and expiry. Seat maps and counts are eventually consistent, served from a cached projection refreshed within ~1–2s.',
      rationale: [
        'Consistency is a per-operation requirement, not a per-service one; only reservation enforces the invariant.',
        'Conditional writes on individual seats give correctness without global locks and scale with partitions.',
        'Serving 50k views/s from a cache/projection keeps the primary free for the writes that matter.',
        'Stale display is self-correcting: the reservation write is the final arbiter.',
      ],
      consequences: [
        'Users occasionally pick a seat that was just taken and must choose again — needs good UX copy.',
        'Two read paths (authoritative vs projection) to reason about and monitor for lag.',
        'Hot events still concentrate writes; a waiting room may be required for top on-sales.',
      ],
      revisitWhen: 'Conflict rates at reserve time become high enough to hurt conversion (then shorten projection lag or push seat updates), or multi-region active writes are required.',
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'adr-leader-election-scheduler',
    title: 'Who runs the billing scheduler? Choosing a leader-election mechanism',
    context:
      'A billing scheduler must run on exactly one instance at a time (it creates invoices and triggers charges). It is deployed as 3 replicas on Kubernetes for availability. The team already runs Postgres and Redis; etcd exists only inside the Kubernetes control plane. A previous incident double-billed customers when two instances ran the job concurrently.',
    patterns: ['leader-election', 'idempotency'],
    options: [
      { name: 'Redis `SET NX PX` lock', summary: 'Acquire a key with a TTL; whoever holds it runs the job. Simple and fast.' },
      { name: 'Kubernetes Lease API (backed by etcd consensus)', summary: 'Use the built-in leader-election client: lease with renewals, backed by the cluster\'s Raft-based store.' },
      { name: 'Postgres advisory lock / leases table', summary: 'Hold a session-level advisory lock or update a lease row with a version; the DB both elects and fences.' },
    ],
    recommended: 1,
    considerations: [
      { label: 'Safety under partitions and pauses', keywords: ['partition', 'pause', 'gc', 'split brain', 'split-brain', 'two leaders', 'clock'], why: 'A leader can be paused (GC, VM stall) past its lease and keep acting; any scheme must assume this happens.' },
      { label: 'Fencing tokens checked by the resource', keywords: ['fencing', 'fence', 'token', 'epoch', 'generation', 'term', 'version'], why: 'The only real protection against a zombie leader is a monotonically increasing token that the database rejects when stale.' },
      { label: 'Consensus-backed vs single-node lock', keywords: ['consensus', 'raft', 'quorum', 'etcd', 'zookeeper', 'majority'], why: 'A lock in a single Redis primary is lost on failover; consensus stores give linearisable leases.' },
      { label: 'Idempotent side effects', keywords: ['idempot', 'unique', 'dedup', 'exactly once', 'invoice key'], why: 'Even with perfect election, retries happen. A unique invoice key (customer + period) makes double-running harmless.' },
      { label: 'Operational simplicity / reuse existing infra', keywords: ['existing', 'already', 'operational', 'simple', 'library', 'built-in', 'managed'], why: 'Kubernetes already runs a consensus store and ships a leader-election client; no new system to operate.' },
      { label: 'Failover time', keywords: ['failover', 'lease duration', 'renew', 'ttl', 'recovery', 'downtime'], why: 'Lease duration trades failover speed against false failovers; billing tolerates tens of seconds.' },
    ],
    expert: {
      decision: 'Use the Kubernetes Lease API for leader election, pass the lease generation as a fencing token that billing writes must carry (rejected if stale), and make invoice creation idempotent with a unique (customer, period) key.',
      rationale: [
        'It is consensus-backed (etcd/Raft) and already operated by the platform; the client library handles renewals.',
        'Election alone is not enough: fencing at the database turns a zombie leader\'s writes into harmless rejections.',
        'Idempotent invoices are a second, independent guard against the exact failure that happened before.',
        'Redis SETNX lacks fencing and loses locks on failover; Postgres advisory locks are viable but tie job safety to connection lifetimes and pooling behaviour.',
      ],
      consequences: [
        'Failover takes roughly one lease duration (~15–30s); billing runs are delayed, not duplicated.',
        'Billing writes must carry and check the fencing token — a schema and code change.',
        'Couples the scheduler to Kubernetes APIs.',
      ],
      revisitWhen: 'The scheduler must run outside Kubernetes, or must be sharded across multiple leaders (e.g. per-tenant partitions) for throughput.',
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'adr-rate-limiter-placement',
    title: 'Public API rate limiting: where and with what state?',
    context:
      'A public API serves 20,000 req/s across 30 gateway pods in two regions. Plans are sold by quota (e.g. 100 req/s per API key, with short bursts allowed). Some customers spread requests across both regions. Abuse spikes come from scrapers rotating IPs. The current limiter is an in-memory counter in each app pod.',
    patterns: ['rate-limiting', 'api-gateway'],
    options: [
      { name: 'Keep per-pod in-memory limits', summary: 'Each pod enforces quota / N locally. Zero latency, no shared state.' },
      { name: 'Gateway token bucket with a shared Redis counter per region', summary: 'Gateway checks a per-key token bucket in a regional Redis (Lua script); global quota split between regions.' },
      { name: 'Centralised global rate-limit service', summary: 'Every request calls a single global service that holds exact counters for all keys.' },
    ],
    recommended: 1,
    considerations: [
      { label: 'Enforce at the edge, before expensive work', keywords: ['edge', 'gateway', 'early', 'before', 'cheap', 'reject'], why: 'Limits exist to protect capacity; checking them after auth/business logic defeats the purpose.' },
      { label: 'Accuracy across many instances', keywords: ['accura', 'shared', 'counter', 'per-pod', 'per pod', 'distributed', 'global'], why: 'Per-pod limits are only accurate if traffic is perfectly even; with 30 pods a key can exceed or be unfairly throttled below quota.' },
      { label: 'Algorithm and bursts', keywords: ['token bucket', 'leaky', 'sliding window', 'fixed window', 'burst', 'refill'], why: 'Token buckets allow sanctioned bursts while bounding average rate; fixed windows allow 2× at window edges.' },
      { label: 'Latency and availability of the limiter', keywords: ['latency', 'fail open', 'fail-open', 'fail closed', 'fail-closed', 'redis down', 'availability', 'timeout'], why: 'A shared store adds ~1ms and a dependency; decide whether to fail open (availability) or closed (protection) when it is down.' },
      { label: 'Multi-region quota split', keywords: ['region', 'cross-region', 'multi-region', 'split', 'approximate', 'sync'], why: 'Exact global counters across regions add a WAN round trip; splitting quota per region with periodic rebalancing is usually good enough.' },
      { label: 'Client contract', keywords: ['429', 'retry-after', 'header', 'x-ratelimit', 'backoff', 'contract'], why: 'Clear `429` + `Retry-After` and remaining-quota headers turn limits into a predictable contract instead of mysterious failures.' },
    ],
    expert: {
      decision: 'Enforce at the gateway with a per-API-key token bucket stored in a regional Redis cluster (atomic Lua), plus a coarse per-IP limit for anonymous traffic. Split each key\'s quota between regions and rebalance periodically. Fail open with local fallback limits if Redis is unavailable. Return `429` with `Retry-After` and quota headers.',
      rationale: [
        'The gateway is the cheapest point to reject and already authenticates the API key.',
        'Shared regional counters make quotas accurate regardless of how traffic spreads across 30 pods.',
        'Token buckets match the product promise (sustained rate with bursts).',
        'A single global service would add cross-region latency and a global SPOF for every request; approximate per-region accuracy is acceptable for quotas.',
      ],
      consequences: [
        'Adds ~1ms per request and a Redis dependency per region that must be highly available.',
        'Global quota is approximate (a key could briefly exceed quota by spreading across regions).',
        'Fail-open means a Redis outage temporarily weakens protection — backed by local coarse limits.',
      ],
      revisitWhen: 'Contracts require exact global enforcement (e.g. hard billing caps), or Redis latency/cost per request becomes significant at much higher volumes (consider local token caching with periodic sync).',
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'adr-event-sourcing-wallet',
    title: 'Wallet balances: event sourcing or CRUD with an audit log?',
    context:
      'A fintech is building a stored-value wallet. Regulators require a complete, immutable history of every balance change and the ability to reconstruct any balance at any past date. The team (8 engineers) has built CRUD services before but never an event-sourced system. Expected load: 1,500 balance changes/s, 10,000 balance reads/s.',
    patterns: ['event-sourcing', 'cqrs', 'idempotency'],
    options: [
      { name: 'CRUD balances table + append-only audit log in the same transaction', summary: 'Update `balance` and insert an immutable ledger row atomically; history lives in the ledger table.' },
      { name: 'Event sourcing (events are the source of truth) + CQRS projections', summary: 'Append `Deposited`/`Withdrawn` events per account; current balances are projections; rebuild by replay.' },
      { name: 'CRUD with CDC to an audit store', summary: 'Mutate balances normally; capture changes via CDC into an append-only store.' },
    ],
    recommended: 1,
    considerations: [
      { label: 'History is the domain (audit, temporal queries)', keywords: ['audit', 'history', 'temporal', 'point in time', 'reconstruct', 'regulat', 'immutable'], why: 'When "what was the balance on March 3?" is a regulatory requirement, the event log is not a side table — it is the product.' },
      { label: 'Single source of truth (no drift)', keywords: ['source of truth', 'drift', 'diverge', 'reconcil', 'mismatch', 'dual'], why: 'With CRUD + audit, two representations can disagree after a bug; with event sourcing, balances are derived and can always be recomputed.' },
      { label: 'Concurrency control on the write side', keywords: ['optimistic', 'expected version', 'concurren', 'overdraft', 'invariant', 'aggregate'], why: 'Appends must use expected-version checks per account so two withdrawals cannot both succeed.' },
      { label: 'Read side: projections and lag', keywords: ['projection', 'read model', 'cqrs', 'lag', 'eventual', 'snapshot'], why: 'Balance reads come from projections that lag slightly; snapshots keep rehydration fast for long-lived accounts.' },
      { label: 'Event schema evolution', keywords: ['schema', 'versioning', 'upcast', 'evolution', 'immutable events', 'compatib'], why: 'Events are forever; you need a versioning/upcasting strategy from day one.' },
      { label: 'Team learning curve and complexity', keywords: ['team', 'complex', 'learning', 'experience', 'unfamiliar', 'training'], why: 'The team has not done this before; scope it to the ledger only and invest in conventions and tooling.' },
    ],
    expert: {
      decision: 'Event-source the ledger (accounts as aggregates with optimistic concurrency on append), serve balances from CQRS projections with snapshots, and keep everything else in the wallet product (profiles, settings) as plain CRUD.',
      rationale: [
        'Regulatory temporal reconstruction is native to event sourcing: replay to any timestamp.',
        'One source of truth removes the "balance and audit log disagree" class of bugs that CRUD + audit invites.',
        'The ledger is naturally append-only; deposits and withdrawals are facts, not updates.',
        'Limiting event sourcing to the ledger contains the learning curve and complexity where it pays off.',
      ],
      consequences: [
        'Read-your-write for balances needs care (read from the aggregate or wait for projection) and invariants must be checked on the write side.',
        'Event schema versioning and projection rebuild tooling become ongoing responsibilities.',
        'The team needs training and conventions; early mistakes in event design are costly to undo.',
      ],
      revisitWhen: 'Regulatory history requirements are relaxed, or the projection/replay machinery becomes a dominant source of incidents relative to its benefit — CRUD + transactional ledger table is the fallback.',
    },
  },
];
