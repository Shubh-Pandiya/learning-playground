import type { ReviewCase } from '../types';

export const REVIEWS: ReviewCase[] = [
  /* ------------------------------------------------------------------ */
  {
    id: 'rev-photo-sharing-mvp',
    title: 'Photo sharing app, two weeks before launch',
    context:
      'A team is launching a photo-sharing app: users upload photos (avg 3 MB) and browse friends\' feeds. Expected peak: 3,000 req/s, 90% reads, mostly image views. Albums can be marked private. The design below is what they plan to ship. Find what will hurt them.',
    workload: { qps: 3000, readRatio: 0.9, localCacheHit: 0.4 },
    level: 'Intermediate',
    patterns: ['blob-storage', 'cdn', 'caching', 'read-replicas'],
    graph: {
      nodes: [
        { id: 'client', kind: 'client', label: 'Mobile + web', x: 0, y: 120 },
        { id: 'lb', kind: 'lb', count: 2, x: 190, y: 120 },
        { id: 'app', kind: 'app', label: 'API (stateless)', count: 4, x: 380, y: 120 },
        { id: 'local-cache', kind: 'local-cache', label: 'Per-pod cache (ACLs + metadata)', x: 570, y: 0 },
        { id: 'db', kind: 'db', label: 'Postgres (metadata)', x: 570, y: 160 },
        { id: 'blob', kind: 'blob-column', label: 'photos.bytes (BYTEA)', x: 570, y: 300 },
      ],
      edges: [
        { from: 'client', to: 'lb' },
        { from: 'lb', to: 'app' },
        { from: 'app', to: 'local-cache' },
        { from: 'app', to: 'db' },
        { from: 'app', to: 'blob' },
      ],
    },
    flaws: [
      {
        target: 'blob',
        kind: 'wrong-tool',
        title: 'Image bytes stored in the database',
        why: 'Multi-MB blobs bloat the DB, crush the buffer cache, make backups and replication enormous, and every view costs a DB read. A relational DB is built for small rows and indexes, not a media library.',
        fix: 'Store bytes in object storage (S3/GCS) keyed by photo id; keep only metadata (owner, key, size, ACL) in Postgres.',
      },
      {
        target: 'lb->app',
        kind: 'bottleneck',
        title: 'Every upload and download is proxied through the API pods',
        why: 'Streaming 3 MB bodies through app servers ties up threads and bandwidth for seconds per request; the API tier ends up sized for bytes, not logic.',
        fix: 'Hand clients short-lived presigned URLs so uploads go directly to object storage; serve downloads from object storage via a CDN.',
      },
      {
        target: 'client->lb',
        kind: 'latency',
        title: 'No CDN: global users fetch images from one origin region',
        why: 'Image views are 90% of traffic and are immutable — the perfect CDN workload. Without one, users far from the region see hundreds of ms per image and origin pays for all egress.',
        fix: 'Put a CDN in front of the object store with long TTLs and content-hashed URLs (immutable), so a new version is a new URL rather than an invalidation.',
      },
      {
        target: 'local-cache',
        kind: 'security',
        title: 'Per-pod caches of ACLs can leak private photos',
        why: 'When a user makes an album private, only the pod that handled the request invalidates its local copy. The other 3 pods keep serving the old "public" ACL until TTL — a privacy bug, not just staleness.',
        fix: 'Never serve authorisation decisions from an un-invalidatable local cache. Read ACLs from the DB or a shared cache with explicit invalidation; keep local caches for truly immutable data only.',
      },
      {
        target: 'db',
        kind: 'spof',
        title: 'Single Postgres primary with no replica',
        why: 'Every request needs metadata. One host failure means a full outage, and a disk loss means losing every user\'s account and photo index.',
        fix: 'Add a synchronous or semi-sync standby with automated failover (or use a managed HA database), plus point-in-time backups.',
      },
    ],
    fine: {
      lb: 'Two load balancer instances in front of a stateless API tier is the textbook setup; it health-checks pods and is not a bottleneck at 3k req/s.',
      app: 'Four stateless API pods behind a load balancer is correct horizontal scaling — the problem is what they are asked to carry (bytes), not the tier itself.',
    },
    takeaway:
      'Match storage to data shape: rows and indexes in a database, large immutable bytes in object storage served through a CDN, and never let a cache you cannot invalidate decide who can see what.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'rev-checkout-sync-chain',
    title: 'Checkout: a synchronous chain with distributed transactions',
    context:
      'An e-commerce checkout creates the order, reserves inventory, charges the card and emails a receipt. The team wants "exactly-once and always consistent", so they used a two-phase commit across the Orders and Inventory databases and a shared HTTP client that retries 3× on any error. Peak: 1,500 req/s, 50% reads. Mobile clients retry about 5% of submits on flaky networks.',
    workload: { qps: 1500, readRatio: 0.5, retryRate: 0.05 },
    level: 'Advanced',
    patterns: ['saga', 'idempotency', 'circuit-breaker', 'message-queues', 'api-gateway'],
    graph: {
      nodes: [
        { id: 'client', kind: 'client', label: 'Shoppers', x: 0, y: 120 },
        { id: 'gw', kind: 'api-gateway', count: 2, x: 190, y: 120 },
        { id: 'orders', kind: 'service', label: 'Orders svc', count: 4, x: 380, y: 120 },
        { id: 'retry', kind: 'naive-retry', label: 'HTTP client (retry ×3)', x: 570, y: 0 },
        { id: 'pay', kind: 'service', label: 'Payments svc', count: 2, x: 760, y: 0 },
        { id: 'tpc', kind: 'two-pc', label: '2PC coordinator', x: 570, y: 160 },
        { id: 'orders-db', kind: 'db', label: 'Orders DB', x: 760, y: 120 },
        { id: 'inv-db', kind: 'db', label: 'Inventory DB', x: 760, y: 220 },
        { id: 'email', kind: 'worker', label: 'Email sender (sync call)', x: 570, y: 320 },
      ],
      edges: [
        { from: 'client', to: 'gw' },
        { from: 'gw', to: 'orders' },
        { from: 'orders', to: 'retry' },
        { from: 'retry', to: 'pay' },
        { from: 'orders', to: 'tpc' },
        { from: 'tpc', to: 'orders-db' },
        { from: 'tpc', to: 'inv-db' },
        { from: 'orders', to: 'email' },
      ],
    },
    flaws: [
      {
        target: 'tpc',
        kind: 'wrong-tool',
        title: '2PC across two services\' databases',
        why: 'Two-phase commit holds locks in both databases until the coordinator decides. If the coordinator stalls, both DBs sit with locked rows; availability becomes the product of every participant\'s. It also couples Orders and Inventory schemas and deployments.',
        fix: 'Use a saga: local transaction per service, an orchestrator (or events) to drive the steps, and compensations (release reservation, refund) on failure. Accept short-lived intermediate states like `PENDING`.',
      },
      {
        target: 'retry',
        kind: 'coupling',
        title: 'Immediate 3× retries with no breaker',
        why: 'When Payments slows down, every timeout becomes 3 more calls — a retry storm that turns a brownout into an outage and holds Orders threads hostage.',
        fix: 'Exponential backoff with jitter, a retry budget, tight timeouts, and a circuit breaker with a fallback ("payment pending, we will email you").',
      },
      {
        target: 'retry->pay',
        kind: 'consistency',
        title: 'Retried charges have no idempotency key',
        why: 'A timeout does not mean the charge failed. Retrying (from the HTTP client or the mobile app) can charge the card twice, because Payments cannot tell a retry from a new request.',
        fix: 'Clients generate an idempotency key per checkout; Payments stores key → result and returns the stored result on repeats. Pass the key through to the PSP too.',
      },
      {
        target: 'orders->email',
        kind: 'latency',
        title: 'Receipt email sent synchronously inside checkout',
        why: 'The user waits on an SMTP/provider call that has nothing to do with whether the order succeeded; if the email provider is down, checkout fails or hangs.',
        fix: 'Publish an `OrderPlaced` event (via an outbox) to a queue; an email worker consumes it with retries and a DLQ.',
      },
    ],
    fine: {
      gw: 'An API gateway at the edge for TLS, auth and routing is appropriate here; it is managed, health-checks the services and adds only a few ms.',
      pay: 'Isolating payments in its own service is good practice (smaller PCI scope, independent scaling and deploys). The problems are in how it is called, not that it exists.',
    },
    takeaway:
      'Across service boundaries, trade atomic transactions for sagas + idempotency: every step is local, retries are safe because they are deduplicated, and anything the user does not need to wait for goes async.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'rev-social-profile-feed',
    title: 'Social app: profiles, follows and a second region',
    context:
      'A social app serves profiles and timelines at 8,000 req/s (90% reads, 80% cache hit). To serve Europe they added a second writable primary there. New-follower notifications are generated by a job that scans the `follows` table. Users frequently edit their bio and immediately reload their profile.',
    workload: { qps: 8000, readRatio: 0.9, cacheHit: 0.8 },
    level: 'Intermediate',
    patterns: ['read-replicas', 'load-balancing', 'caching', 'pub-sub'],
    graph: {
      nodes: [
        { id: 'client', kind: 'client', label: 'Users', x: 0, y: 120 },
        { id: 'sticky', kind: 'sticky-lb', label: 'LB (session affinity)', x: 190, y: 120 },
        { id: 'app', kind: 'app', label: 'API (sessions in memory)', count: 6, x: 380, y: 120 },
        { id: 'cache', kind: 'cache', label: 'Redis (timelines)', count: 2, x: 570, y: 0 },
        { id: 'db', kind: 'db', label: 'US primary', x: 570, y: 160 },
        { id: 'replica', kind: 'replica', label: 'Read replicas', count: 2, x: 760, y: 160 },
        { id: 'mm', kind: 'multi-master', label: 'EU primary (multi-master)', x: 760, y: 300 },
        { id: 'poller', kind: 'cron-poller', label: 'Follow-notify job (scan every 60s)', x: 950, y: 300 },
      ],
      edges: [
        { from: 'client', to: 'sticky' },
        { from: 'sticky', to: 'app' },
        { from: 'app', to: 'cache' },
        { from: 'app', to: 'db' },
        { from: 'app', to: 'replica' },
        { from: 'db', to: 'replica' },
        { from: 'db', to: 'mm' },
        { from: 'mm', to: 'poller' },
      ],
    },
    flaws: [
      {
        target: 'sticky',
        kind: 'spof',
        title: 'Sticky sessions with in-memory session state',
        why: 'Sessions live inside app pods, so the LB must pin users. A pod crash logs out everyone pinned to it, load skews to pods with heavy users, and scaling in or deploying drops sessions. This LB also has no redundancy or health checks.',
        fix: 'Make the app stateless: store sessions in Redis or use signed tokens; use a redundant, health-checking, non-sticky LB.',
      },
      {
        target: 'app->replica',
        kind: 'consistency',
        title: 'Read-after-write served from async replicas',
        why: 'A user edits their bio (write to primary) and reloads (read from replica that is 200 ms behind) — they see the old bio and assume the save failed. Classic read-your-writes violation.',
        fix: 'Route a user\'s reads to the primary for a short window after they write (or track the write\'s LSN and wait for a replica that has it). Other users\' reads can stay on replicas.',
      },
      {
        target: 'mm',
        kind: 'consistency',
        title: 'Second writable primary with last-writer-wins',
        why: 'Concurrent writes in US and EU (follow/unfollow, counters, username changes) conflict; LWW silently discards one. Uniqueness constraints cannot be enforced across two primaries.',
        fix: 'Keep a single writer per piece of data: home each user to one region (geo-partitioning) and route their writes there; serve EU reads from local replicas.',
      },
      {
        target: 'poller',
        kind: 'latency',
        title: 'Notifications discovered by polling a table',
        why: 'Up to 60 s delay, a full scan load on the DB every minute that grows with the table, and unfollows/deletes between scans are missed.',
        fix: 'Publish a `UserFollowed` event at write time (outbox or CDC) and fan it out via pub/sub to the notification service.',
      },
    ],
    fine: {
      replica: 'Read replicas are the right tool for timeline and other users\' profile reads at a 9:1 read ratio — just not for a user reading their own fresh write.',
      cache: 'A replicated Redis tier for timelines is appropriate; timelines tolerate a few seconds of staleness.',
    },
    takeaway:
      'Replicas and caches are fine wherever staleness is acceptable — the judgment is spotting the specific reads (your own writes, uniqueness, money) where it is not, and keeping exactly one writer for each piece of data.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'rev-sharded-marketplace',
    title: 'Marketplace user store: sharded, searchable, unique usernames',
    context:
      'A marketplace outgrew one database and sharded users and listings by `user_id % 4`. Peak is 6,000 req/s, 90% reads; the busiest reads are listing searches by keyword. Usernames must be globally unique. They plan to go to 6 shards next quarter.',
    workload: { qps: 6000, readRatio: 0.9 },
    level: 'Advanced',
    patterns: ['sharding', 'consistent-hashing', 'search-indexing', 'leader-election'],
    graph: {
      nodes: [
        { id: 'client', kind: 'client', label: 'Buyers + sellers', x: 0, y: 120 },
        { id: 'lb', kind: 'lb', count: 2, x: 190, y: 120 },
        { id: 'app', kind: 'app', label: 'Marketplace API', count: 6, x: 380, y: 120 },
        { id: 'lock', kind: 'redis-lock', label: 'Global "username" lock', x: 380, y: 300 },
        { id: 'modhash', kind: 'mod-hash', label: 'user_id % 4', x: 570, y: 120 },
        { id: 'shard', kind: 'shard', label: 'Shards (no replicas)', count: 4, x: 760, y: 120 },
        { id: 'like', kind: 'sql-like', label: "Scatter-gather LIKE '%term%'", x: 570, y: 300 },
      ],
      edges: [
        { from: 'client', to: 'lb' },
        { from: 'lb', to: 'app' },
        { from: 'app', to: 'lock' },
        { from: 'app', to: 'modhash' },
        { from: 'modhash', to: 'shard' },
        { from: 'app', to: 'like' },
        { from: 'like', to: 'shard' },
      ],
    },
    flaws: [
      {
        target: 'modhash',
        kind: 'wrong-tool',
        title: 'Modulo hashing makes re-sharding a full migration',
        why: 'Going from `% 4` to `% 6` changes the owner of roughly 2/3 of all keys — a massive, risky data move for the planned expansion.',
        fix: 'Hash into many fixed virtual partitions (e.g. 1,024) mapped to shards via consistent hashing or a lookup table; adding a shard moves only a few partitions.',
      },
      {
        target: 'shard',
        kind: 'data-loss',
        title: 'Each shard is a single copy',
        why: 'Sharding made each user\'s data live on exactly one host. Lose a disk and that quarter of users loses data since the last backup; lose a host and they are offline.',
        fix: 'Each shard is a replicated group (primary + standby with automated failover), and backups are per shard with point-in-time recovery.',
      },
      {
        target: 'like',
        kind: 'bottleneck',
        title: 'Keyword search by scatter-gather LIKE across all shards',
        why: '`LIKE \'%term%\'` cannot use a B-tree index, so every search full-scans every shard; latency is the slowest shard and load multiplies with shard count. Relevance ranking is also poor.',
        fix: 'Feed listings into a search index (Elasticsearch/OpenSearch) via CDC from the shards; serve keyword queries from the index.',
      },
      {
        target: 'lock',
        kind: 'bottleneck',
        title: 'A global distributed lock to enforce unique usernames',
        why: 'Every signup serialises on one Redis lock; without fencing, a lock that expires during a GC pause lets two signups both claim the name. It is a throughput cap and still not correct.',
        fix: 'Use a uniqueness table partitioned by username (not user id) with a conditional insert / unique constraint — the database enforces uniqueness for that key on its owning shard.',
      },
    ],
    fine: {
      'app->modhash': 'Routing in the application layer (a library that maps keys to shards) is a legitimate choice versus a proxy tier; the problem is the modulo function, not where routing happens.',
      lb: 'Two health-checking LBs in front of 6 stateless pods is fine.',
    },
    takeaway:
      'Sharding is a commitment: choose a partitioning scheme that can grow (virtual partitions), give every shard its own HA story, and move cross-shard access patterns (search, global uniqueness) to structures partitioned for them.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'rev-notification-pipeline',
    title: 'Notification pipeline: badges, emails and analytics',
    context:
      'When something happens (comment, like, mention) the app writes it to the DB, then publishes to Redis Pub/Sub. An email sender and an analytics counter subscribe. Clients refresh the unread badge by polling every 2 seconds. Base traffic is 500 req/s (90% reads) before polling. Email notifications are part of the product promise ("never miss a mention").',
    workload: { qps: 500, readRatio: 0.9 },
    level: 'Intermediate',
    patterns: ['pub-sub', 'message-queues', 'idempotency'],
    graph: {
      nodes: [
        { id: 'client', kind: 'client', label: 'Users', x: 0, y: 120 },
        { id: 'poll', kind: 'client-polling', label: 'Badge poll every 2s', x: 190, y: 120 },
        { id: 'lb', kind: 'lb', count: 2, x: 380, y: 120 },
        { id: 'app', kind: 'app', label: 'API', count: 4, x: 570, y: 120 },
        { id: 'db', kind: 'db', x: 760, y: 220 },
        { id: 'replica', kind: 'replica', count: 2, x: 950, y: 300 },
        { id: 'pubsub', kind: 'pubsub', label: 'Redis Pub/Sub', x: 760, y: 40 },
        { id: 'email', kind: 'worker', label: 'Email sender ×1', x: 950, y: 0 },
        { id: 'analytics', kind: 'worker', label: 'Analytics counter', x: 950, y: 120 },
      ],
      edges: [
        { from: 'client', to: 'poll' },
        { from: 'poll', to: 'lb' },
        { from: 'lb', to: 'app' },
        { from: 'app', to: 'db' },
        { from: 'app', to: 'replica' },
        { from: 'db', to: 'replica' },
        { from: 'app', to: 'pubsub' },
        { from: 'pubsub', to: 'email' },
        { from: 'pubsub', to: 'analytics' },
      ],
    },
    flaws: [
      {
        target: 'poll',
        kind: 'bottleneck',
        title: 'Polling for the unread badge',
        why: 'Every open tab asks "anything new?" every 2s — mostly to hear "no". Badge checks become ~10× the real traffic and the dominant load on API and DB, and still lag by up to 2s.',
        fix: 'Push: a WebSocket/SSE gateway subscribed to the user\'s notification channel, or long-polling with a server-side wait. Keep a cached unread counter.',
      },
      {
        target: 'pubsub',
        kind: 'data-loss',
        title: 'Fire-and-forget pub/sub for must-deliver emails',
        why: 'Redis Pub/Sub has no persistence: if the email sender is restarting or slow, messages published meanwhile are simply gone. That breaks "never miss a mention".',
        fix: 'Use a durable queue (SQS/RabbitMQ) or a log (Kafka/Redis Streams) with consumer acknowledgements for the email path.',
      },
      {
        target: 'app->pubsub',
        kind: 'consistency',
        title: 'Dual write: DB commit and publish are not atomic',
        why: 'If the process crashes after the DB commit but before publish, the notification is lost; if publish succeeds but the transaction rolls back, users get notified about something that does not exist.',
        fix: 'Transactional outbox: write the event row in the same transaction, then relay it to the broker (or use CDC). Make consumers idempotent since relays are at-least-once.',
      },
      {
        target: 'email',
        kind: 'spof',
        title: 'Single email consumer, no retries or dead-letter queue',
        why: 'One instance means any crash or deploy pauses all email; one malformed message (bad address, template bug) can crash-loop it forever and block everything behind it.',
        fix: 'Run several consumers in a group, retry with backoff, and park poison messages in a DLQ with an alert.',
      },
    ],
    fine: {
      analytics: 'Fire-and-forget pub/sub is acceptable for the analytics counter: losing a handful of events during a restart only nudges an approximate metric.',
      replica: 'Serving badge and feed reads from a replica is reasonable: a second of replication lag on an unread count is invisible to users.',
    },
    takeaway:
      'Pick delivery guarantees per consumer: approximate analytics can ride fire-and-forget pub/sub, but promised notifications need a durable, acknowledged queue fed by an outbox — and badges should be pushed, not polled.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'rev-public-api-platform',
    title: 'Public developer API with usage-based billing',
    context:
      'A SaaS company exposes a public REST API to third-party developers: 5,000 req/s at peak (80% reads), billed per call. About 30% of traffic comes from misbehaving integrations and scrapers. Each API server checks API keys itself. Internal calls to Billing use an IP list in a config file.',
    workload: { qps: 5000, readRatio: 0.8, abusive: 0.3 },
    level: 'Intermediate',
    patterns: ['rate-limiting', 'api-gateway', 'service-discovery', 'message-queues'],
    graph: {
      nodes: [
        { id: 'client', kind: 'client', label: 'Third-party apps', x: 0, y: 120 },
        { id: 'lb', kind: 'lb', count: 2, x: 190, y: 120 },
        { id: 'app', kind: 'app', label: 'API servers (auth in each)', count: 3, x: 380, y: 120 },
        { id: 'rl', kind: 'rate-limiter', label: 'Rate limiter (before DB)', x: 570, y: 120 },
        { id: 'db', kind: 'db', label: 'Main DB (+ usage rows)', x: 760, y: 120 },
        { id: 'replica', kind: 'replica', x: 950, y: 120 },
        { id: 'billing', kind: 'service', label: 'Billing (hard-coded IPs)', count: 2, x: 570, y: 300 },
      ],
      edges: [
        { from: 'client', to: 'lb' },
        { from: 'lb', to: 'app' },
        { from: 'app', to: 'rl' },
        { from: 'rl', to: 'db' },
        { from: 'db', to: 'replica' },
        { from: 'app', to: 'billing' },
      ],
    },
    flaws: [
      {
        target: 'app->rl',
        kind: 'security',
        title: 'Rate limiting after the expensive work',
        why: 'Abusive requests are parsed, authenticated and processed by API servers before anything says no. The limiter protects the DB but the app tier still drowns (30% extra load), and abusive callers degrade everyone.',
        fix: 'Enforce limits at the edge (gateway/limiter before the LB), per API key and per IP, with a shared counter store (token bucket in Redis) and `429` + `Retry-After`.',
      },
      {
        target: 'client->lb',
        kind: 'coupling',
        title: 'No gateway: auth, quotas and versioning re-implemented per service',
        why: 'Each service validates keys its own way; a revoked key or a quota change must be rolled out to every service, and inconsistencies become security holes.',
        fix: 'An API gateway terminating TLS, validating keys, enforcing quotas and routing versions; services receive an authenticated principal.',
      },
      {
        target: 'app->billing',
        kind: 'coupling',
        title: 'Hard-coded instance IPs for Billing',
        why: 'When a Billing instance is replaced or rescheduled, callers keep dialing the old IP; scaling Billing needs a config deploy of every caller.',
        fix: 'Service discovery (registry or internal LB / Kubernetes Service) with health checks; callers resolve healthy endpoints dynamically.',
      },
      {
        target: 'db',
        kind: 'bottleneck',
        title: 'A usage row inserted synchronously per API call',
        why: 'Metering doubles write volume on the primary and puts billing bookkeeping on the latency path of every request.',
        fix: 'Emit usage events to a queue/stream and aggregate them asynchronously (per key per minute) into the billing store.',
      },
    ],
    fine: {
      lb: 'Health-checking LBs in front of stateless API servers are fine; the issue is what happens (or does not) before them.',
      replica: 'A replica for analytics and failover is a sensible addition and does not introduce a correctness problem here.',
    },
    takeaway:
      'Reject cheaply and early: admission control belongs at the edge, centralised in a gateway, and bookkeeping that the caller does not need to wait for (metering) belongs off the request path.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'rev-wallet-ledger-cqrs',
    title: 'Digital wallet: event-sourced ledger with CQRS',
    context:
      'A wallet app keeps every balance change as an immutable event and serves balances and statements from projections. Peak: 6,000 req/s, 80% reads. Withdrawals must never overdraw an account. The team also event-sourced the notification-settings screen "for consistency".',
    workload: { qps: 6000, readRatio: 0.8 },
    level: 'Advanced',
    patterns: ['event-sourcing', 'cqrs', 'idempotency'],
    graph: {
      nodes: [
        { id: 'client', kind: 'client', label: 'Wallet users', x: 0, y: 120 },
        { id: 'lb', kind: 'lb', count: 2, x: 190, y: 120 },
        { id: 'app', kind: 'app', label: 'Wallet API', count: 4, x: 380, y: 60 },
        { id: 'es', kind: 'event-store', label: 'Ledger events (1 node)', x: 570, y: 0 },
        { id: 'proj', kind: 'projector', label: 'Balance projector', x: 760, y: 0 },
        { id: 'rm', kind: 'read-model', label: 'Balances + statements', count: 2, x: 950, y: 60 },
        { id: 'settings', kind: 'app', label: 'Settings API', count: 2, x: 380, y: 260 },
        { id: 'settings-es', kind: 'event-store', label: 'Settings event store', count: 2, x: 570, y: 260 },
        { id: 'settings-proj', kind: 'projector', label: 'Settings projector', x: 760, y: 260 },
        { id: 'settings-rm', kind: 'read-model', label: 'Settings view', count: 2, x: 950, y: 260 },
      ],
      edges: [
        { from: 'client', to: 'lb' },
        { from: 'lb', to: 'app' },
        { from: 'lb', to: 'settings' },
        { from: 'app', to: 'es' },
        { from: 'app', to: 'rm' },
        { from: 'es', to: 'proj' },
        { from: 'proj', to: 'rm' },
        { from: 'settings', to: 'settings-es' },
        { from: 'settings', to: 'settings-rm' },
        { from: 'settings-es', to: 'settings-proj' },
        { from: 'settings-proj', to: 'settings-rm' },
      ],
    },
    flaws: [
      {
        target: 'app->rm',
        kind: 'consistency',
        title: 'Withdrawals authorised against the lagging projection',
        why: 'The read model is eventually consistent. Two quick withdrawals both read the same pre-withdrawal balance from the projection and both pass — an overdraft the event log will faithfully record.',
        fix: 'Validate commands against the aggregate\'s own state (rehydrated from its event stream) and append with optimistic concurrency (expected version); the projection is for display only.',
      },
      {
        target: 'app->es',
        kind: 'latency',
        title: 'Rehydrating long-lived accounts from event one, every command',
        why: 'An account with years of events replays thousands of events per withdrawal; command latency grows forever with account age.',
        fix: 'Periodic snapshots per aggregate (state + version), then replay only events after the snapshot.',
      },
      {
        target: 'es',
        kind: 'data-loss',
        title: 'The source of truth is a single node',
        why: 'In event sourcing the log is the only thing you cannot rebuild — projections can be regenerated, the events cannot. A single node with no replication means a disk failure loses money history.',
        fix: 'Replicated, durable event store (quorum writes across AZs) plus backups/archival to object storage.',
      },
      {
        target: 'settings-es',
        kind: 'cost',
        title: 'Event sourcing a simple CRUD settings screen',
        why: 'Notification preferences have no audit or temporal-query requirement. Event store + projector + read model triples the moving parts and adds lag to a screen where users expect their toggle to stick immediately.',
        fix: 'A plain table with an `updated_at` column (and a simple audit log if needed). Use event sourcing where history is the domain, like the ledger.',
      },
    ],
    fine: {
      rm: 'Serving balances and statement history from a projection is exactly what CQRS is for; a second of lag on a statement page is fine.',
      proj: 'A single projector is acceptable: if it dies, displayed balances lag but nothing is lost — it resumes from its checkpoint (as long as applying events is idempotent).',
    },
    takeaway:
      'In CQRS, decide which side each decision reads from: invariants (no overdraft) must be checked on the write side, projections are for display, and event sourcing earns its complexity only where history is the product.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'rev-autoscaled-saas-jobs',
    title: 'Autoscaled SaaS web tier with nightly billing jobs',
    context:
      'A B2B SaaS app autoscales its web tier between 4 and 16 pods (3,000 req/s at peak, 80% reads). User uploads and sessions live on a shared NFS mount. The nightly invoicing cron is baked into the web image; to avoid duplicates, it takes a Redis `SETNX` lock with a 60s TTL before running.',
    workload: { qps: 3000, readRatio: 0.8 },
    level: 'Advanced',
    patterns: ['autoscaling', 'leader-election', 'blob-storage', 'idempotency'],
    graph: {
      nodes: [
        { id: 'client', kind: 'client', label: 'Customers', x: 0, y: 120 },
        { id: 'lb', kind: 'lb', count: 2, x: 190, y: 120 },
        { id: 'app', kind: 'app', label: 'Web + cron (same image)', count: 4, x: 380, y: 120 },
        { id: 'auto', kind: 'autoscaler', label: 'Autoscaler 4–16', x: 380, y: 300 },
        { id: 'nfs', kind: 'nfs', label: 'NFS: uploads + sessions', x: 570, y: 0 },
        { id: 'db', kind: 'db', label: 'Postgres (max 200 conns)', x: 570, y: 200 },
        { id: 'replica', kind: 'replica', x: 760, y: 200 },
        { id: 'lock', kind: 'redis-lock', label: 'SETNX lock, TTL 60s', x: 760, y: 340 },
      ],
      edges: [
        { from: 'client', to: 'lb' },
        { from: 'lb', to: 'app' },
        { from: 'auto', to: 'app' },
        { from: 'app', to: 'nfs' },
        { from: 'app', to: 'db' },
        { from: 'db', to: 'replica' },
        { from: 'app', to: 'lock' },
      ],
    },
    flaws: [
      {
        target: 'nfs',
        kind: 'spof',
        title: 'Shared NFS for uploads and sessions',
        why: 'Every request touches one NFS server: it is a single point of failure, its throughput does not scale with pods, and a hung mount freezes every pod at once.',
        fix: 'Uploads in object storage (presigned URLs); sessions in Redis or signed tokens. The web tier becomes truly stateless.',
      },
      {
        target: 'lock',
        kind: 'wrong-tool',
        title: 'Redis SETNX lock as leader election',
        why: 'Invoicing takes minutes; the 60s TTL can expire mid-run (or during a GC pause) and a second pod starts invoicing. Without fencing tokens, both write — customers get billed twice.',
        fix: 'Leader election via a consensus store lease (etcd/ZooKeeper/Kubernetes Lease) with fencing tokens checked by the DB, and make invoice creation idempotent (unique key per customer per period).',
      },
      {
        target: 'app',
        kind: 'coupling',
        title: 'Batch cron inside the autoscaled web image',
        why: 'Every scale-out adds another contender for the job; a heavy invoice run steals CPU from user requests and can trigger more scale-out; deploys kill in-flight runs.',
        fix: 'Run scheduled jobs as a separate worker/CronJob deployment (one replica + leader election), enqueueing per-customer tasks to a queue with idempotent workers.',
      },
      {
        target: 'db',
        kind: 'bottleneck',
        title: 'Autoscaling the app without scaling DB connections',
        why: 'Each pod opens a 25-connection pool: 16 pods × 25 = 400 connections against a 200 max. Scale-out under load causes connection errors exactly when you need capacity.',
        fix: 'A connection pooler (PgBouncer/RDS Proxy), per-pod pool sizes derived from max pods, and read traffic on replicas. Load-test at max scale.',
      },
    ],
    fine: {
      auto: 'Autoscaling a stateless web tier is right — once sessions, files and cron are out of it.',
      replica: 'A read replica is a reasonable way to offload reporting reads and give failover headroom.',
    },
    takeaway:
      'Autoscaling assumes interchangeable, stateless pods; anything stateful (files, sessions, singleton jobs) must move out first, and every shared resource behind the tier (DB connections) must be checked at maximum scale, not current scale.',
  },
  /* ------------------------------------------------------------------ */
  {
    id: 'rev-api-gateway-edge',
    title: 'One gateway to rule them all: a mobile edge in review',
    context:
      'A consumer app (mobile + web) sends 30,000 req/s at peak (85% reads) through a self-hosted API gateway to ~40 services. The platform team proudly put everything in the gateway: OAuth2 token introspection on every call, a global per-user rate limit in one Redis, a "home screen" plugin that calls five services and merges the JSON, and automatic retries ×3 for any 5xx. It runs as a single large instance because "it is just a proxy". About 10% of traffic is scrapers and buggy clients.',
    workload: { qps: 30000, readRatio: 0.85, abusive: 0.1 },
    level: 'Advanced',
    patterns: ['api-gateway', 'rate-limiting', 'circuit-breaker', 'service-discovery'],
    graph: {
      nodes: [
        { id: 'client', kind: 'client', label: 'Mobile + web', x: 0, y: 140 },
        { id: 'nlb', kind: 'lb', label: 'NLB (L4)', count: 2, x: 190, y: 140 },
        { id: 'gw', kind: 'api-gateway', label: 'Gateway (1 big instance)', x: 380, y: 140 },
        { id: 'auth', kind: 'service', label: 'Auth server (introspect)', count: 2, x: 570, y: 0 },
        { id: 'rl', kind: 'rate-limiter', label: 'Global limit: Redis ×1, sync', x: 570, y: 100 },
        { id: 'agg', kind: 'app', label: 'Home-screen merge plugin', x: 570, y: 210 },
        { id: 'retry', kind: 'naive-retry', label: 'Retry ×3 on any 5xx', x: 570, y: 320 },
        { id: 'catalog', kind: 'service', label: 'Catalog / feed / profile…', count: 6, x: 760, y: 210 },
        { id: 'orders', kind: 'service', label: 'Orders (POST /orders)', count: 4, x: 760, y: 320 },
      ],
      edges: [
        { from: 'client', to: 'nlb' },
        { from: 'nlb', to: 'gw' },
        { from: 'gw', to: 'auth' },
        { from: 'gw', to: 'rl' },
        { from: 'gw', to: 'agg' },
        { from: 'agg', to: 'catalog' },
        { from: 'gw', to: 'retry' },
        { from: 'retry', to: 'orders' },
      ],
    },
    flaws: [
      {
        target: 'gw',
        kind: 'spof',
        title: 'A single gateway instance in front of 40 services',
        why: 'Every request crosses it, so one OOM, bad plugin deploy, kernel upgrade or AZ loss is a full outage. A single big box also cannot be canaried: every config change hits 100% of traffic at once.',
        fix: 'Run ≥2 small, stateless instances per AZ behind the NLB (N+1 per AZ), autoscale on CPU/connections, roll config and binaries per instance with canaries, and keep last-known-good config if the control plane is down.',
      },
      {
        target: 'gw->auth',
        kind: 'latency',
        title: 'OAuth2 introspection on every request',
        why: '30k rps of introspection turns the auth server into a tier-0 hot-path dependency: +2–10 ms per call, and an auth slowdown becomes a site-wide outage. You also pay the network hop for requests that will be rate-limited anyway.',
        fix: 'Issue short-lived signed JWTs and verify them locally (cached JWKS, refresh on unknown `kid`, check `exp`/`aud`/`iss`). Keep introspection only for opaque or high-risk tokens, with a short positive cache.',
      },
      {
        target: 'rl',
        kind: 'spof',
        title: 'Global quota on one Redis, checked synchronously',
        why: 'Every request waits for a Redis round trip (~0.5–1 ms, worse at p99), one node caps throughput, and when it fails the gateway either fails closed (outage) or silently stops limiting. Abusive traffic also costs a Redis op before being dropped.',
        fix: 'Cheap per-IP limits locally first, then per-user quotas with local token buckets synced to a sharded Redis/Envoy RLS asynchronously (hybrid). Decide the failure policy per route explicitly (usually fail-open with a local fallback limit).',
      },
      {
        target: 'agg',
        kind: 'coupling',
        title: 'Business logic (home-screen aggregation) inside the gateway',
        why: 'The platform team now owns product logic and every mobile release needs a gateway change. One slow downstream holds gateway workers for every route, and fan-out of 5 multiplies the gateway’s outbound load.',
        fix: 'Move aggregation into a BFF service owned by the mobile team (or a GraphQL layer), with its own deadlines, partial-response handling and scaling. Keep the gateway thin: auth, limits, routing, observability.',
      },
      {
        target: 'retry->orders',
        kind: 'consistency',
        title: 'Blind retries ×3 on POST /orders',
        why: 'A timeout after the order was written gets retried, which creates duplicate orders and double charges. During an Orders brownout the retries quadruple its load (retry storm), turning a slowdown into an outage.',
        fix: 'Retry only idempotent methods, or POSTs that carry an `Idempotency-Key` the service deduplicates. Use a retry budget (≤10% extra), exponential backoff with jitter, deadline propagation, and per-upstream circuit breakers / outlier ejection.',
      },
    ],
    fine: {
      nlb: 'An L4 NLB in front of the gateway is the standard shape: it is cheap, connection-level and highly available, and it lets you scale the gateway fleet behind it.',
      catalog: 'Many small services behind a gateway are fine; the problem is what the gateway does on their behalf.',
      orders: 'Orders itself is fine. Its risk comes from how the gateway calls it.',
    },
    takeaway:
      'A gateway should be a thin, horizontally scaled, boring piece of infrastructure: verify identity locally, reject cheaply, route, observe. Every remote call or line of business logic you add to it becomes a dependency of every request.',
  },
];
