import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'local-cache',
  problem: {
    why:
      'Even a fast remote cache costs a network round trip (~0.3 ms), serialization, a connection from a pool and a share of one shard’s single core. An in-process cache answers in ~50–200 ns with a live object reference. For a small set of very hot or immutable data that is a 1000× latency win and the only real defence against a single hot key melting one Redis shard. The catch: every server holds its own copy, so freshness and fleet-wide consistency become your problem.',
    withoutIt: [
      'Every request that reads config, feature flags or reference data pays a network hop and deserialization, often several times per request.',
      'A viral key concentrates 100k+ reads/s on one remote cache shard, whose single core saturates regardless of cluster size.',
      'Remote-cache or network blips immediately become request failures, with no last-known-good value to fall back on.',
      'Hot loops (per-row permission checks, currency conversion, routing tables) multiply small remote latencies into large request latencies.',
    ],
    position:
      'Inside the application process, in front of the remote cache (L2) and the database: the request thread calls `cache.get(key, loader)`; on a miss the loader reads Redis or the DB. Nothing else in the system knows it exists — which is both its strength and its consistency problem.',
    diagram: {
      type: 'flow',
      title: 'Two-level cache read',
      nodes: [
        { label: 'Request thread', sub: 'get(key)', tone: 'neutral' },
        { label: 'L1 in-process', sub: '~100 ns, per pod', tone: 'ok' },
        { label: 'L2 Redis', sub: '~0.3 ms, shared', tone: 'info' },
        { label: 'Database', sub: '2–10 ms', tone: 'accent' },
      ],
      caption: 'L1 holds a tiny hot set with short TTLs; L2 holds the shared working set; the DB holds the truth.',
    },
  },
  architecture: {
    overview:
      'A production local cache is a concurrent hash map plus a bounding policy, an expiry mechanism and a loader. Modern libraries (Caffeine, Ristretto) decouple the hot read path from policy bookkeeping: reads are lock-free map lookups that record the access into lossy buffers, and a single maintenance task later replays those events into the eviction policy, expiry wheel and frequency sketch. Admission (should this new key evict an old one?) is as important as eviction for hit ratio.',
    diagram: {
      type: 'layers',
      title: 'Inside Caffeine',
      layers: [
        { name: 'API', items: ['get / getIfPresent', 'LoadingCache', 'AsyncLoadingCache', 'stats'], tone: 'info' },
        { name: 'Hot path', items: ['ConcurrentHashMap', 'striped read buffers', 'write buffer'], tone: 'accent' },
        { name: 'Policy (W-TinyLFU)', items: ['window LRU ~1%', 'probation SLRU', 'protected SLRU', 'count-min sketch'], tone: 'ok' },
        { name: 'Time', items: ['expireAfterWrite/Access', 'timer wheel', 'refreshAfterWrite'], tone: 'violet' },
        { name: 'Maintenance', items: ['drain buffers', 'evict + admit', 'hill-climb window'], tone: 'neutral' },
      ],
      caption: 'Reads never take the policy lock; maintenance is amortized and batched.',
    },
    blocks: [
      { name: 'Concurrent map', what: 'A `ConcurrentHashMap` (Java) or sharded map (Go) with lock-free reads and per-bin locking on writes. `compute`/`computeIfAbsent` give atomic per-key loading.' },
      { name: 'Read & write buffers', what: 'Caffeine records reads into striped, lossy ring buffers (dropping events under contention is fine for a heuristic) and writes into a bounded buffer; a maintenance task drains them under a `tryLock`, so threads never queue on policy state.' },
      { name: 'Window + segmented LRU', what: 'New entries land in a small **window LRU** (~1% of capacity by default); its victims compete for the **main** space, a segmented LRU split into probation (~20%) and protected (~80%) segments.' },
      { name: 'TinyLFU frequency sketch', what: 'A count-min sketch of 4-bit counters estimates how often each key was requested, even keys not in the cache. Every time the sample count reaches ~10× the maximum size, all counters are halved (**aging**), so old popularity decays.' },
      { name: 'Expiry', what: 'Fixed `expireAfterWrite` / `expireAfterAccess` use ordered queues; per-entry variable expiry (`expireAfter`) uses a **hierarchical timer wheel** for O(1) scheduling. Expired entries are also treated as absent on read.' },
      { name: 'Loader & refresh', what: 'The loader runs once per key while concurrent callers wait on the same future (request coalescing). `refreshAfterWrite` reloads asynchronously on first access after the interval while still returning the old value.' },
      { name: 'Weigher & stats', what: '`maximumWeight` + `weigher` bound memory by approximate bytes; `recordStats()` exposes hit rate, load time, eviction count and load failures for metrics.' },
    ],
    real: [
      { name: 'Caffeine (Java)', how: 'W-TinyLFU (window LRU + SLRU + count-min admission), adaptive window sizing via hill climbing, lossy read buffers, timer wheel, async loading/refresh. The de-facto JVM cache; Spring’s default `CacheManager` option and the successor to Guava Cache.' },
      { name: 'Guava Cache (Java)', how: 'Segments like Java 7’s `ConcurrentHashMap` (`concurrencyLevel`, default 4), each with its own lock and LRU access queue; eviction is per segment so LRU is approximate across the cache. `refreshAfterWrite` reloads on the reading thread unless the loader is wrapped with `asyncReloading`. Now in maintenance mode, recommending Caffeine.' },
      { name: 'Ristretto (Go)', how: 'Dgraph’s cache: sharded map, TinyLFU admission + sampled-LFU eviction, cost-based bounding, `Set` buffered asynchronously and allowed to drop under contention. bigcache/freecache instead store values in large byte slices with pointer-free indexes so the Go GC never scans entries.' },
      { name: 'Ehcache 3 / OHC', how: 'Ehcache tiers heap → off-heap → disk; off-heap stores serialized bytes outside the GC’s reach. OHC is an off-heap cache used by Cassandra for its row cache. Both trade serialization cost for GC-friendliness and larger capacity.' },
      { name: 'Near caches (Redis 6+, Hazelcast)', how: 'Redis client-side caching: `CLIENT TRACKING ON` makes the server remember which keys a client read and push `invalidate` messages when they change. Hazelcast and Coherence near caches do the same against their cluster maps. Invalidation is eventual, not transactional.' },
    ],
  },
  lifecycle: {
    summary:
      'A `LoadingCache<ProductId, Product>` lookup in a JVM service with Redis as L2. A hit is a few hundred nanoseconds of CPU; a miss is coalesced so one thread per key per pod goes to Redis or the DB.',
    stages: [
      { stage: 'Hash and probe', what: '`cache.get(id)` hashes the key and probes the concurrent map without locking.', cost: '~50–100 ns', ms: 0.0001, part: 'map' },
      { stage: 'Freshness check', what: 'Compare write/access timestamps with `expireAfterWrite`; if past `refreshAfterWrite`, schedule an async reload but return the current value.', cost: 'A few ns', ms: 0.00002, part: 'expiry' },
      { stage: 'Record access', what: 'Append to a striped read buffer; if the buffer is full the event is dropped (policy is a heuristic).', cost: 'One CAS, ~10–20 ns', ms: 0.00002, part: 'map' },
      { stage: 'Return reference', what: 'Return the live object — no deserialization. The caller must treat it as immutable.', cost: 'Free', ms: 0.00001 },
      { stage: 'Miss: coalesced load', what: 'First thread installs a future for the key; the other 199 callers on this pod wait on it.', cost: 'Waiters pay the loader time', ms: 0.001, part: 'loader' },
      { stage: 'Miss: L2 read', what: 'Loader reads Redis (and deserializes); on L2 miss it queries the DB and refills Redis.', cost: '~0.3–0.5 ms L2, +2–10 ms DB', ms: 0.4 },
      { stage: 'Admission + insert', what: 'New entry enters the window; maintenance compares its sketch frequency with the probation victim and evicts the loser.', cost: 'Amortized, off the read path', ms: 0.001, part: 'admission' },
      { stage: 'Garbage', what: 'Evicted or replaced values become garbage; large or high-churn caches increase old-gen GC work.', cost: 'Paid later in GC', ms: 0.0005 },
    ],
  },
  deepDives: [
    {
      title: 'W-TinyLFU: why admission beats a better LRU',
      hook: 'LRU admits everything; one scan of cold keys can flush a perfectly good hot set.',
      body: [
        'LRU assumes recency predicts reuse, which fails on scans (batch jobs, crawlers) and on Zipf-like workloads where frequency matters more. Pure LFU fails the other way: yesterday’s hot keys never leave. **TinyLFU** separates the questions: eviction picks a victim (LRU-ish), and **admission** asks whether the candidate is historically more popular than that victim, using a compact frequency sketch that also remembers keys not in the cache.',
        'Caffeine’s **W-TinyLFU** puts a small window LRU (~1%) in front so brand-new bursty keys get a chance to build frequency. When the window overflows, its LRU victim (candidate) is compared against the main space’s probation victim; the higher sketch count wins. Hits in probation promote entries to the protected segment. A hill climber resizes the window at runtime: recency-heavy workloads get a bigger window, frequency-heavy ones a smaller one.',
        'The count-min sketch uses 4-bit counters (max 15), several hash functions and takes the minimum; every ~10× maximum-size increments it halves all counters, so frequencies age and the cache adapts to shifting popularity. To resist hash-flooding attacks that pump a victim’s apparent frequency, Caffeine adds a little randomness to admission of warm candidates.',
      ],
      diagram: {
        type: 'flow',
        title: 'W-TinyLFU admission',
        nodes: [
          { label: 'New entry', sub: 'into window LRU', tone: 'info' },
          { label: 'Window victim', sub: 'the candidate', tone: 'neutral' },
          { label: 'Sketch compare', sub: 'freq(cand) vs freq(victim)', tone: 'accent' },
          { label: 'Probation SLRU', sub: 'winner stays', tone: 'ok' },
          { label: 'Protected SLRU', sub: 'promoted on hit', tone: 'violet' },
        ],
        caption: 'The loser of the comparison is evicted; one-hit wonders rarely beat a proven key.',
      },
      insight:
        'For the same memory, admission typically adds more hit ratio than any eviction tweak, and the sketch costs only ~8 bytes per entry — so a 10k-entry W-TinyLFU cache can outperform a much larger LRU on skewed traffic.',
    },
    {
      title: 'Guava vs Caffeine: concurrency design',
      hook: 'Under 64 threads, the cache’s bookkeeping, not the lookup, becomes the bottleneck.',
      body: [
        'Guava Cache is a segmented hash table: each segment has a lock, an access-order queue and a write-order queue. Reads append to a per-segment recency queue and occasionally take the segment lock to drain it; writes always lock the segment. Eviction is per segment, so with 4 segments a 1,000-entry cache is really four 250-entry LRUs — an approximate LRU with uneven pressure.',
        'Caffeine borrows from databases (write-ahead logs) instead: the map is a `ConcurrentHashMap`, reads record into striped lossy buffers, writes into a bounded buffer, and one thread at a time applies them to the policy under `tryLock`. Lost read events slightly blur recency but never block. Benchmarks show read throughput scaling nearly with core count, many times Guava’s under contention.',
      ],
      table: {
        columns: ['Aspect', 'Guava Cache', 'Caffeine'],
        rows: [
          ['Policy', 'LRU per segment', 'W-TinyLFU, adaptive window'],
          ['Read path', 'Recency queue + periodic lock', 'Lossy striped buffers, no lock'],
          ['refreshAfterWrite', 'Sync on reader unless asyncReloading', 'Async on executor by default'],
          ['Variable per-entry TTL', 'No', 'Yes, timer wheel'],
          ['Async API', 'ListenableFuture loaders', 'AsyncCache with CompletableFuture'],
        ],
      },
      code: {
        lang: 'java',
        code: `LoadingCache<Long, Product> products = Caffeine.newBuilder()
    .maximumWeight(256L * 1024 * 1024)                 // ~256 MB
    .weigher((Long id, Product p) -> p.approxBytes())
    .expireAfterWrite(Duration.ofMinutes(5))           // hard staleness bound
    .refreshAfterWrite(Duration.ofSeconds(30))         // serve old, reload async
    .recordStats()
    .build(id -> productClient.load(id));              // L2 Redis, then DB`,
      },
      insight:
        'Migrating Guava → Caffeine changes `refreshAfterWrite` from blocking the unlucky reader to fully async; code that relied on “the next read sees fresh data” needs review, and the reload executor (common pool by default) must not be starved by blocking I/O.',
    },
    {
      title: 'expireAfterWrite vs refreshAfterWrite vs expireAfterAccess',
      hook: 'Three knobs that look alike but trade staleness against tail latency in opposite ways.',
      body: [
        '`expireAfterWrite(d)` is a hard bound: after `d` the entry is gone and the next reader blocks on a load — latency spikes at every expiry, but nothing older than `d` is ever served. `expireAfterAccess(d)` evicts entries idle for `d`; a hot entry never expires, so it is a memory policy, not a freshness policy.',
        '`refreshAfterWrite(d)` makes an entry **eligible** for reload after `d`; the first read after that triggers an async reload and still gets the old value, so hot keys are refreshed in the background with no latency spike. Cold keys are not refreshed at all (no wasted loads). If the reload fails, the old value stays.',
        'Use both: `refreshAfterWrite` shorter (e.g. 30 s) for smoothness, `expireAfterWrite` longer (e.g. 5 min) as the hard bound for keys nobody read, so a key untouched for an hour is not served once at hour-old staleness.',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'expireAfterWrite', points: ['Hard staleness bound', 'Reader blocks on reload', 'Spike at each expiry'], tone: 'warn' },
          { name: 'refreshAfterWrite', points: ['Old value served', 'Async reload on access', 'Failures keep old value'], tone: 'ok' },
          { name: 'expireAfterAccess', points: ['Idle-time eviction', 'Hot keys never expire', 'Memory, not freshness'], tone: 'info' },
        ],
      },
      insight:
        'Serving stale on reload failure is a resilience feature: with `refreshAfterWrite`, an L2/DB outage degrades to “slightly old data” instead of errors — make sure that is acceptable for the data and that the staleness is observable.',
    },
    {
      title: 'Near cache over Redis: client-side caching and tracking',
      hook: 'Redis 6 can tell your process exactly which local entries just became stale.',
      body: [
        'With `CLIENT TRACKING ON`, Redis records in an invalidation table which keys each client read; when any client modifies one, Redis sends that client an `invalidate` push (RESP3 on the same connection, or in RESP2 via `REDIRECT` to a connection subscribed to `__redis__:invalidate`). The server then forgets the key for that client until it reads it again. `tracking-table-max-keys` (default 1M) bounds server memory; when exceeded, Redis evicts entries and sends invalidations for them.',
        '**Broadcasting mode** (`BCAST PREFIX user:`) keeps no per-client state: every client subscribed to a prefix gets invalidations for all matching keys — cheap for the server, noisy for clients. `OPTIN` caches only keys read after `CLIENT CACHING yes`; `NOLOOP` skips invalidations for the client’s own writes.',
        'Correctness rules: subscribe before reading; if the invalidation connection drops, flush the whole local cache (you may have missed messages); and guard the read-then-store window, because an invalidation can arrive while your read is in flight. Client libraries (Lettuce, Jedis 5, redis-py) implement these; still keep a TTL as a safety net.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Tracking-based invalidation',
        actors: ['Pod A', 'Redis', 'Pod B'],
        messages: [
          { from: 'Pod A', to: 'Redis', label: 'CLIENT TRACKING ON', tone: 'info' },
          { from: 'Pod A', to: 'Redis', label: 'GET price:9' },
          { from: 'Redis', to: 'Pod A', label: '42 (key tracked)', dashed: true },
          { from: 'Pod B', to: 'Redis', label: 'SET price:9 45', tone: 'accent' },
          { from: 'Redis', to: 'Pod A', label: 'push: invalidate price:9', tone: 'warn' },
          { from: 'Pod A', to: 'Redis', label: 'next GET reloads 45', tone: 'ok' },
        ],
        caption: 'Only writes through Redis generate invalidations; direct DB writes do not.',
      },
      insight:
        'Tracking invalidates when the **Redis** key changes. If L2 is itself cache-aside and invalidated by deletes, L1 learns about the delete and reloads — but anything that changes the DB without touching Redis leaves both layers stale. The invalidation chain is only as complete as its first link.',
    },
    {
      title: 'Consistency across N instances',
      hook: 'Fifty pods, fifty caches, fifty different answers for up to one TTL.',
      body: [
        'Each instance loads at a different moment, so after a write the fleet is a mix of old and new values; a user’s consecutive requests hitting different pods can see time move backwards. Options, in order of cost: **short TTL** (bounded inconsistency, simple); **pub/sub broadcast** of invalidations (Redis pub/sub is at-most-once — a pod that reconnects missed them); a **durable log** such as a Kafka topic where every pod consumes all invalidations from its last offset; **versioned reads** where the request carries a minimum version and the pod bypasses L1 if its copy is older.',
        'Make invalidation idempotent and coarse when in doubt (drop a whole namespace on reconnect). Measure staleness directly: emit the age of served L1 entries, and sample-compare L1 vs L2 values in production.',
        'Alternatively remove duplication: route requests by key to a consistent owner pod (sticky by key, or groupcache-style peer fetch), so each key lives in one process — higher hit ratio, but you have rebuilt a distributed cache with your app servers as nodes.',
      ],
      table: {
        columns: ['Strategy', 'Staleness bound', 'Failure mode', 'Cost'],
        rows: [
          ['TTL only', '≤ TTL', 'None beyond TTL', 'Free'],
          ['Redis pub/sub', '~ms, unbounded if message lost', 'Missed messages on reconnect', 'Low'],
          ['Kafka invalidation topic', '~ms–s, replayable', 'Consumer lag', 'Medium'],
          ['Client tracking (Redis 6)', '~ms', 'Disconnect → must flush all', 'Low'],
          ['Version check per request', 'None for that request', 'Extra L2 read on mismatch', 'Medium'],
        ],
      },
      insight:
        'Always pair a push invalidation mechanism with a TTL. The push gives you freshness in the common case; the TTL is the only thing that bounds staleness when the push silently fails — and it will.',
    },
    {
      title: 'Memory and GC: on-heap vs off-heap',
      hook: 'A cache full of long-lived objects is exactly the workload generational GCs handle worst.',
      body: [
        'Cached objects survive many young collections and get promoted to the old generation; churn there (evictions, refreshes) creates old-gen garbage that only mixed/full collections reclaim. Large on-heap caches in Java mean longer marking, more remembered-set work in G1 and bigger heaps to size; low-pause collectors (ZGC, Shenandoah) help pause times but not CPU or memory. Java objects also cost 2–5× their serialized size (headers, pointers, boxed fields, Strings).',
        'Off-heap stores (Ehcache off-heap, OHC, Chronicle Map) keep values as bytes outside the GC, enabling multi-GB caches with no GC cost, but each read deserializes (µs, not ns) and you manage memory explicitly. In Go, the GC scans every pointer in a map of pointers; bigcache/freecache keep entries in big `[]byte` arenas indexed by `map[uint64]uint32` precisely so the GC has nothing to scan.',
        'Always bound by **weight** (approximate bytes) rather than entry count when values vary in size, and export the cache’s estimated size next to heap usage so a growing cache is visible before it becomes a GC problem.',
      ],
      code: {
        lang: 'go',
        code: `// Request coalescing in Go: one load per key per process
var g singleflight.Group

func getProduct(ctx context.Context, id string) (*Product, error) {
    if p, ok := l1.Get(id); ok {
        return p, nil
    }
    v, err, _ := g.Do(id, func() (any, error) {
        p, err := loadFromRedisOrDB(ctx, id)
        if err == nil {
            l1.SetWithTTL(id, p, p.Cost(), 5*time.Second)
        }
        return p, err
    })
    if err != nil {
        return nil, err
    }
    return v.(*Product), nil
}`,
        caption: 'singleflight + a bounded TTL cache is the Go equivalent of a Caffeine LoadingCache.',
      },
      insight:
        'Cached objects must be immutable: handing the same reference to many threads means one caller mutating “its” copy corrupts it for everyone — a bug class that remote caches (which always deserialize a fresh copy) never had.',
    },
  ],
  scaling: {
    body: [
      'A local cache scales for free with the fleet — and so does its duplication. Total memory is pods × cache size, hit ratio per pod falls as traffic is spread over more pods, and L2 refresh traffic grows with pods × hot keys / refresh interval. Keep the L1 small and targeted (the top few thousand keys), and let L2 hold the working set.',
      'There is no control plane to fail, but there is a **cold-start** problem: every deploy restarts every cache. A rolling deploy of 200 pods with empty L1s pushes the full read load onto L2/DB for minutes. Mitigate with slow rollouts, warmup on startup (preload the hot keys from L2 before passing readiness), and request coalescing.',
      'Across regions, each region’s pods should load from that region’s L2 and invalidation stream; never broadcast L1 invalidations cross-region synchronously. Treat L1 staleness per region as the sum of DB replica lag + invalidation lag + L1 TTL.',
    ],
    bullets: [
      'Load on L2 from refresh ≈ pods × distinct hot keys / refresh interval — compute it before choosing a 1 s TTL.',
      'Gate readiness on warmup for caches that protect weak backends.',
      'Expose `hitRate`, `evictionCount`, `loadFailureCount` and estimated weight per cache per pod.',
      'Make cache sizes config-driven so you can shrink them during a GC incident without a code change.',
      'For huge read-mostly datasets, prefer key-affinity routing (consistent hashing to pods) over replicating the set into every pod.',
    ],
    diagram: {
      type: 'layers',
      title: 'Where each copy lives',
      layers: [
        { name: 'L1 (per pod × N)', items: ['top ~1k–100k keys', 'TTL seconds', 'µs or faster'], tone: 'ok' },
        { name: 'L2 (shared)', items: ['working set', 'TTL minutes–hours', '~0.3 ms'], tone: 'info' },
        { name: 'Source of truth', items: ['DB / service', 'CDC → invalidations'], tone: 'accent' },
      ],
      caption: 'Invalidations flow up from the source; reads flow down only on misses.',
    },
  },
  failures: [
    {
      name: 'Fleet disagreement',
      symptom: 'Users see a value flip between old and new across requests; permission revocations take minutes to apply.',
      detect: 'Emit served-entry age; periodically compare a sample of L1 values with L2/DB; alert on invalidation consumer lag.',
      mitigate: 'Shorter TTL, durable invalidation stream plus TTL, never L1-cache security-critical or money data.',
    },
    {
      name: 'Unbounded growth / GC death spiral',
      symptom: 'Heap grows, GC time climbs to tens of % of CPU, p99 latency explodes, eventual OOM kill.',
      detect: 'GC pause and GC CPU %, old-gen occupancy after collections, cache estimated size, `evictionCount` stuck at 0.',
      mitigate: 'Always `maximumWeight`/`maximumSize`, weigher on real sizes, off-heap for large caches, config-driven sizes.',
    },
    {
      name: 'Cold-start stampede after deploy',
      symptom: 'L2/DB QPS jumps N× during rollouts; new pods fail readiness or have high latency.',
      detect: 'L1 hit ratio per pod by uptime, L2 QPS correlated with deploy events.',
      mitigate: 'Warm on startup before readiness, slower rollouts, request coalescing in the loader.',
    },
    {
      name: 'Loader thundering herd',
      symptom: 'An expiry causes all threads to call the backend for the same key; thread pools saturate.',
      detect: 'Load count vs unique keys, `loadFailureCount`, backend QPS spikes aligned with TTL boundaries.',
      mitigate: 'Use `get(key, loader)` / LoadingCache or singleflight, `refreshAfterWrite`, TTL jitter.',
    },
    {
      name: 'Mutated shared object',
      symptom: 'Rare, unreproducible data corruption: one request’s modification appears in another’s response.',
      detect: 'Hard to detect at runtime; find in code review, enforce immutability in types, fuzz tests with concurrent readers.',
      mitigate: 'Cache immutable value objects only; defensive copies at the cache boundary.',
    },
  ],
  warStories: [
    {
      title: 'Discord read states: LRU cache vs Go’s garbage collector',
      source: 'Discord Engineering, “Why Discord is switching from Go to Rust”, 2020',
      what:
        'The Read States service kept a large in-memory LRU cache of per-user, per-channel read state. Go forced a garbage collection at least every two minutes, and each one scanned the huge cache, causing regular latency and CPU spikes. Shrinking the cache reduced the spikes but raised latency because more reads went to the database. The team rewrote the service in Rust, where memory is freed deterministically on eviction, removing the spikes.',
      lesson:
        'A big in-process cache is a GC workload. Measure GC cost as a function of cache size, and use pointer-free/off-heap layouts or a runtime without tracing GC when the cache must be large.',
    },
    {
      title: 'Revoked access still works for ten minutes',
      source: 'Composite of common incidents',
      what:
        'An authorization service cached each user’s roles in every API pod with `expireAfterWrite(10m)` to cut DB load. An employee was offboarded and their roles revoked; requests landing on pods with warm entries kept succeeding for up to ten minutes, which a security review flagged as an incident.',
      lesson:
        'Local TTL caching of security decisions needs an explicit, accepted staleness window — or push invalidation backed by a short TTL, plus a deny-list check that bypasses the cache.',
    },
    {
      title: 'Deploy wipes 300 caches at once',
      source: 'Composite of common incidents',
      what:
        'A service with a 95% L1 hit ratio in front of a modest Redis deployed with a fast rolling strategy (50% surge). Within minutes, hundreds of fresh pods missed on every key; Redis CPU hit 100% on the shards holding hot keys and the service’s p99 tripled until caches filled.',
      lesson:
        'The backend behind an L1 must be sized for the deploy, not the steady state — or the deploy must warm caches and roll slowly enough for the backend to absorb the misses.',
    },
  ],
  numbers: [
    { label: 'L1 hit latency', value: '~50–200 ns', note: 'vs ~300 µs Redis in-AZ' },
    { label: 'Caffeine window', value: '~1% of capacity', note: 'adaptive via hill climbing' },
    { label: 'Main space split', value: '20% probation / 80% protected', note: 'segmented LRU' },
    { label: 'Sketch counter', value: '4 bits, halved periodically', note: 'aging every ~10× max size samples' },
    { label: 'Sketch overhead', value: '~8 B per entry', note: 'vs ~100+ B per cached entry anyway' },
    { label: 'Guava concurrencyLevel', value: '4 (default)', note: 'segments = independent LRUs' },
    { label: 'Redis tracking table', value: '1M keys default', note: '`tracking-table-max-keys`' },
    { label: 'JVM object overhead', value: '2–5× serialized size', note: 'headers, pointers, boxing' },
    { label: 'Refresh load on L2', value: 'pods × hot keys / interval', note: '100 pods × 1k keys / 10 s = 10k/s' },
  ],
  capacity: {
    question:
      'A catalog service runs 60 pods at 120k req/s total; each request reads 3 product keys from Redis (360k GET/s). The hottest key gets 40k reads/s and pins one Redis shard. Design an L1.',
    steps: [
      'Skew: the top 2,000 keys cover ~80% of reads. L1 holds just those: 2,000 × ~6 KB on-heap (2 KB serialized × 3) ≈ 12 MB per pod — negligible heap.',
      'Freshness: product edits are tolerated within 10 s, so `refreshAfterWrite(10s)` + `expireAfterWrite(60s)`.',
      'Redis traffic: misses 20% × 360k = 72k/s, plus refreshes ≤ 60 pods × 2,000 keys / 10 s = 12k/s → ~84k/s vs 360k/s (−77%).',
      'Hot key: 40k reads/s on one shard becomes ≤ 60 pods / 10 s = 6 reloads/s — the hot-shard problem disappears.',
      'Deploy: a cold pod adds ~6k extra reads/s (its share of 360k) for the seconds it takes to load 2,000 keys; with 10% surge, ~36k/s extra — within Redis headroom.',
    ],
    answer:
      'A 2,000-entry W-TinyLFU L1 per pod (~12 MB) with 10 s refresh cuts Redis load ~4× and flattens the hot key, at the cost of up to ~10 s (hard max 60 s) fleet-wide staleness.',
  },
  comparison: {
    caption: 'In-process cache options',
    columns: ['Product', 'Eviction / admission', 'Expiry & refresh', 'Memory', 'Notes'],
    rows: [
      ['Caffeine', 'W-TinyLFU, adaptive window', 'Write/access/variable TTL, async refresh', 'On-heap', 'Best general JVM choice'],
      ['Guava Cache', 'Per-segment LRU', 'Write/access TTL, sync refresh by default', 'On-heap', 'Legacy; migrate to Caffeine'],
      ['Ehcache 3', 'LRU-family per tier', 'TTL/TTI, JCache API', 'Heap + off-heap + disk', 'Large caches beyond GC comfort'],
      ['Ristretto (Go)', 'TinyLFU + sampled LFU', 'Per-item TTL', 'Go heap, cost-bounded', 'Sets may be dropped under load'],
      ['Redis client-side caching', 'Client library LRU', 'Server-pushed invalidation + TTL', 'Client heap', 'Near cache with real invalidation'],
      ['Plain HashMap', 'None', 'None', 'Unbounded', 'Leak and stale data — avoid'],
    ],
  },
  whenNot: [
    'Mutable data shared across users where inconsistency between pods is visible or dangerous (balances, inventory, permissions) — use a shared cache or read the source.',
    'Large working sets: duplicating 50 GB across 100 pods is 5 TB of RAM and still has a poor per-pod hit ratio — use Redis/Memcached, or key-affinity routing.',
    'Read-your-writes requirements: the pod that serves the next read may not be the one that saw the write — bypass L1 after writes or use L2.',
    'Write-heavy keys: constant invalidation makes the hit ratio near zero while adding invalidation traffic.',
    'Short-lived processes (serverless functions, batch jobs): the cache dies before it warms up.',
  ],
  interview: [
    {
      q: 'Why not cache everything in each app server’s memory instead of running Redis?',
      a: 'Every pod holds a separate copy, so memory is multiplied by the fleet size and the hit ratio per pod drops as traffic spreads. Writes can’t atomically invalidate N heaps, so pods disagree for up to a TTL, and every deploy starts all caches cold, pushing load to the backend. A shared cache gives one copy, one invalidation point and survives deploys. Local caches are great as a small L1 for hot, slow-changing or immutable data.',
      followUps: ['When does the math favour local caching?', 'How would you bound inconsistency across pods?', 'What does a deploy do to the backend?'],
      seniorSignal: 'Quantifies duplication, per-pod hit ratio and cold starts, and positions L1 as a complement to L2 rather than a replacement.',
    },
    {
      q: 'Explain W-TinyLFU and why it beats LRU.',
      a: 'TinyLFU adds an admission decision: when the cache is full, the candidate is only admitted if a count-min sketch says it is more frequently requested than the eviction victim. The sketch tracks frequency for keys not in the cache using 4-bit counters that are periodically halved, so popularity ages. A small window LRU lets new bursty keys build frequency before competing, and the main space is a segmented LRU. On skewed workloads this resists scans and one-hit wonders and approaches optimal hit ratios.',
      followUps: ['What is the aging mechanism for?', 'Why is there a window at all?', 'How could an attacker abuse a frequency sketch?'],
      seniorSignal: 'Separates admission from eviction and explains sketch aging and the window’s purpose.',
    },
    {
      q: 'refreshAfterWrite vs expireAfterWrite — which would you use for a pricing config?',
      a: 'Both: refreshAfterWrite of e.g. 30 s so hot keys are reloaded asynchronously and readers never block, and expireAfterWrite of a few minutes as the hard bound so a rarely read key isn’t served very old. refreshAfterWrite keeps the old value on reload failure, which gives resilience during an outage. If the business can’t accept 30 s of stale prices, a local cache is the wrong tool and pricing should read L2 or the source with push invalidation.',
      followUps: ['What happens when the reload throws?', 'Which thread runs the reload?', 'How would you observe staleness?'],
      seniorSignal: 'Picks combined settings tied to a staleness budget and knows refresh semantics on failure.',
    },
    {
      q: 'How do you invalidate local caches across 200 pods when a value changes?',
      a: 'Publish an invalidation event on change — ideally driven from the DB change stream so all write paths are covered — and have every pod drop the key. Redis pub/sub is at-most-once, so a pod that reconnects must flush its cache; a Kafka topic gives replayable invalidations. Redis 6 client tracking does this automatically for keys read through Redis. In every case, keep a TTL as the safety net and measure served-entry age.',
      followUps: ['What happens during a network partition?', 'Pub/sub vs Kafka vs client tracking?', 'What about writes that bypass Redis?'],
      seniorSignal: 'Recognises at-most-once delivery and designs for missed messages with flush-on-reconnect and TTLs.',
    },
    {
      q: 'A single Redis key gets 200k reads/s. How does a local cache help, and what does it cost?',
      a: 'Cache that key in each pod with a short refresh, e.g. 1 s; the shard then sees about pods ÷ refresh-interval reads/s — 100 pods give ~100 reads/s instead of 200k. The cost is up to ~1 s of staleness and per-pod memory, and invalidation needs push messages if 1 s is too much. Alternatives are replicating the key under suffixed names across shards, but L1 is simpler and also removes network latency.',
      followUps: ['How do you detect hot keys in the first place?', 'What if the value is 5 MB?', 'How would you make this automatic for any hot key?'],
      seniorSignal: 'Computes the L2 load reduction from pods and refresh interval rather than hand-waving.',
    },
    {
      q: 'Your JVM service’s GC time doubled after you increased cache size. What do you do?',
      a: 'Confirm with GC logs that old-gen occupancy and mixed/full collection time track the cache’s estimated weight. Then check whether the extra size bought hit ratio — often the miss-ratio curve is flat beyond the hot set, and shrinking it is free. If the size is needed, bound by weight, reduce per-entry overhead (compact representations), move values off-heap (Ehcache off-heap, OHC) or to Redis, or use a low-pause collector — knowing that only reduces pauses, not GC CPU.',
      followUps: ['How do you measure the hit-ratio gain from extra memory?', 'What does off-heap cost you?', 'Why do cached objects stress generational GC?'],
      seniorSignal: 'Links cache sizing to the miss-ratio curve and GC behaviour, choosing between shrink, off-heap and remote by data.',
    },
  ],
  takeaways: [
    'L1 local caches win on hot, small, slow-changing data: ns latency and hot-key protection.',
    'N pods means N copies: duplicated memory, lower per-pod hit ratio and fleet-wide disagreement.',
    'Always bound by weight and use a loader with per-key coalescing; never a bare HashMap.',
    'W-TinyLFU’s admission filter beats LRU on skewed traffic for almost no memory.',
    'Use refreshAfterWrite for smooth hot keys and expireAfterWrite as the hard staleness bound.',
    'Push invalidation (tracking, pub/sub, Kafka) plus a TTL; assume messages will be lost.',
    'Plan for cold starts on deploy and for GC cost as the cache grows.',
  ],
};
export default deep;
