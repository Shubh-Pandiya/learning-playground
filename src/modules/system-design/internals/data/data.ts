import type { Internals } from '../types';

export const DATA_INTERNALS: Internals[] = [
  {
    kind: 'cache',
    summary:
      'A remote cache like Redis is an in-memory hash table behind a single-threaded event loop: every command runs atomically, one at a time, in microseconds. Memory is bounded by `maxmemory` plus an eviction policy, keys die by TTL, and durability (RDB snapshots / AOF log) and replicas are optional add-ons. Redis Cluster splits the keyspace into 16384 hash slots owned by different primaries.',
    parts: [
      { id: 'client', name: 'Smart client', role: 'Hashes key to slot, picks node', detail: 'Computes `CRC16(key) % 16384` and looks the slot up in a cached slot→node map. A `MOVED` reply means the map is stale (refresh it); `ASK` means the slot is mid-migration (retry once on the target).' },
      { id: 'loop', name: 'Event loop', role: 'Executes commands one at a time', detail: 'One main thread runs an `epoll` loop and executes every command atomically, so there are no locks. Since Redis 6, optional `io-threads` read/parse sockets and write replies in parallel; execution stays single-threaded.' },
      { id: 'evict', name: 'Memory guard', role: 'Evicts keys when over maxmemory', detail: 'Before a write, if `used_memory > maxmemory`, it samples `maxmemory-samples` (default 5) keys into an eviction pool and evicts the worst by **approximate** LRU (24-bit clock) or LFU (8-bit log counter with decay). A background cycle also expires TTL keys by sampling.' },
      { id: 'keyspace', name: 'Keyspace dict', role: 'O(1) hash table of all keys', detail: 'A chained hash table that grows by **incremental rehashing**: two tables coexist and each operation migrates a few buckets, so a resize never blocks. A second `expires` dict holds TTLs; an expired key is deleted lazily when touched.' },
      { id: 'types', name: 'Data structures', role: 'Typed values with compact encodings', detail: 'Strings (SDS), hashes, lists (quicklist of listpacks), sets, **sorted sets = skiplist + hash** (O(log N) rank, O(1) score lookup), HyperLogLog (12 KB for ~0.8% cardinality error). Small collections use compact `listpack` encoding.' },
      { id: 'persist', name: 'Persistence', role: 'Optional RDB snapshots or AOF log', detail: '**RDB**: `fork()` and the child writes a snapshot while copy-on-write keeps the parent serving. **AOF**: every write is appended to a log, fsynced `always`, `everysec` (default) or by the OS; rewritten periodically to stay compact.' },
      { id: 'repl', name: 'Replication', role: 'Streams writes to replicas async', detail: 'The primary streams the command stream to replicas and keeps a **replication backlog** ring buffer (default 1 MB) so a briefly disconnected replica resumes with `PSYNC <offset>` instead of a full resync.' },
    ],
    flow: [
      { part: 'client', title: 'Slot resolved', text: '`ZINCRBY lb:global 10 user:42` → `CRC16("lb:global") % 16384` = slot 1043 → node B. Use `{hash tags}` to force related keys into one slot for multi-key ops.' },
      { part: 'loop', title: 'Command executed atomically', text: 'An I/O thread parses the RESP bytes; the main thread runs the command start to finish. No other client can interleave — which is why `INCR` needs no lock and why one slow `KEYS *` stalls everyone.' },
      { part: 'evict', title: 'Memory checked', text: 'The node is at `maxmemory` with `allkeys-lfu`, so before writing it samples 5 keys and evicts the least frequently used. With `noeviction` the write would fail with an OOM error instead.' },
      { part: 'keyspace', title: 'Key looked up', text: 'O(1) dict lookup; the key’s TTL in the `expires` dict hasn’t passed. A rehash is in progress, so this call also moves one bucket from the old table to the new one.' },
      { part: 'types', title: 'Sorted set updated', text: 'The member’s score is found in the hash in O(1), then its skiplist node is re-positioned in O(log N). `ZREVRANGE 0 9` for the top 10 is now O(log N + 10).' },
      { part: 'persist', title: 'Appended to AOF', text: 'The write goes to the AOF buffer; a background thread `fsync`s once per second, so a crash loses ≤ 1 s of writes. The client already got its reply.' },
      { part: 'repl', title: 'Shipped to replicas', text: 'The command is sent to replicas and written to the backlog. Replication is **async**: if the primary dies now, an acknowledged write can be lost on failover (`WAIT 1 100` narrows the window).' },
    ],
    knobs: [
      {
        name: 'Eviction policy',
        options: [
          { label: 'allkeys-lru', effect: 'Evicts the (approximately) least recently used key of any kind.', when: 'Classic cache with recency-skewed access.' },
          { label: 'allkeys-lfu', effect: 'Keeps frequently hit keys even if not touched in a while; resists scan pollution.', when: 'Stable hot set (product pages, profiles).' },
          { label: 'volatile-ttl / volatile-*', effect: 'Only evicts keys that have a TTL; keys without TTL are pinned.', when: 'Mixing cache data with must-keep data (better: separate instances).' },
          { label: 'noeviction', effect: 'Writes fail when full instead of dropping data.', when: 'Redis used as a primary store or queue.' },
        ],
      },
      {
        name: 'Persistence',
        options: [
          { label: 'None', effect: 'Fastest; restart = empty cache = cold-start load on the DB.', when: 'Pure cache with a DB that can absorb a warm-up.' },
          { label: 'RDB snapshots', effect: 'Compact, fast restart; lose everything since the last snapshot. `fork()` can double memory under heavy writes.', when: 'Cache warm restarts, backups.' },
          { label: 'AOF everysec', effect: 'Lose ≤ 1 s; larger files and rewrite overhead.', when: 'Redis holds data you can’t cheaply rebuild (sessions, counters).' },
        ],
      },
      {
        name: 'Stampede protection',
        options: [
          { label: 'Request coalescing', effect: 'One caller recomputes (lock via `SET lock NX EX`), others wait or serve stale.', when: 'Expensive recompute of a hot key.' },
          { label: 'Jittered TTL', effect: 'TTL ± 10–20% so keys written together don’t expire together.', when: 'Always for bulk-populated keys.' },
          { label: 'Probabilistic early refresh', effect: 'Each read refreshes early with rising probability as expiry nears (XFetch), so exactly-at-expiry herds never form.', when: 'Very hot keys with known recompute cost.' },
        ],
      },
    ],
    implementations: [
      { name: 'Redis', how: 'Single-threaded executor + I/O threads, rich data types, Lua/Functions for atomic multi-step logic, RDB/AOF, async replicas, Sentinel or Cluster (16384 slots, gossip bus, `MOVED`/`ASK`). Valkey is the open-source fork.' },
      { name: 'Memcached', how: 'Multi-threaded, strings only, no persistence. Memory is carved into 1 MB pages split by a **slab allocator** into size classes (×1.25 growth) to avoid fragmentation; LRU is per slab class. Sharding is done by the client (ketama).' },
      { name: 'mcrouter (Meta)', how: 'Memcached proxy doing consistent-hash routing, replication pools and failover. Meta’s paper adds **leases**: a miss gets a lease token so only one client refills the key — stampede and stale-set protection.' },
      { name: 'ElastiCache / MemoryDB / Dragonfly', how: 'Managed Redis with multi-AZ failover; MemoryDB adds a durable multi-AZ transaction log. Dragonfly is a multi-threaded, shared-nothing Redis-compatible engine.' },
    ],
    ha: 'Each primary gets 1–2 replicas in other AZs. **Sentinel** (≥3 processes) agrees by quorum that a primary is down and promotes a replica; clients ask Sentinel for the current primary. In **Redis Cluster** the primaries gossip, and a majority of primaries authorizes a replica to take over a failed primary’s slots. Because replication is async, a failover can drop the last few writes — fine for a cache, not for money.',
    failureModes: [
      { name: 'Cache stampede', symptom: 'A hot key expires, thousands of requests miss together and hammer the DB.', fix: 'Coalesce recomputes with a lock or lease, jitter TTLs, refresh early, serve stale while revalidating.' },
      { name: 'Hot key', symptom: 'One key (celebrity, flash sale) saturates one shard’s single core while others idle.', fix: 'Local L1 cache with a short TTL for that key, or replicate the key under N suffixed names and read a random copy.' },
      { name: 'Blocking command', symptom: '`KEYS *`, `DEL` of a 10M-element set or a big Lua script freezes every client for seconds.', fix: '`SCAN` instead of `KEYS`, `UNLINK` (background free), cap collection sizes, watch the slowlog.' },
      { name: 'Stale cache after write', symptom: 'Read-miss loads the old value, a concurrent write deletes the key, then the old value is set — stale until TTL.', fix: 'Delete-after-commit plus a short TTL as a safety net, versioned values, or CDC-driven invalidation.' },
    ],
    numbers: ['Redis: ~100k ops/s per instance, ~1M+ with pipelining', 'GET in-DC: ~0.2–0.5 ms round trip', 'Redis Cluster: 16384 slots, up to ~1000 nodes', '`fork()` copies page tables: ~10–20 ms per GB of RSS', 'Memcached max item size: 1 MB by default'],
    interview: [
      { q: 'How is Redis so fast if it is single-threaded?', a: 'All data is in RAM, every command is O(1) or O(log N), and one thread means no locks or context switches — the bottleneck is the network, not the CPU. I/O threads parallelise socket reads/writes. You scale out with Cluster (one process per core per box), not up.' },
      { q: 'A popular key expires and your DB falls over. What happened and how do you prevent it?', a: 'A cache stampede: every concurrent request missed and recomputed. Fix with request coalescing (one recompute holds a `SET NX` lock or lease, others wait or get stale data), jittered TTLs, and probabilistic early refresh so the key is renewed before it expires.' },
      { q: 'How do you keep a cache consistent with the database?', a: 'Cache-aside: write the DB, then **delete** (not update) the key, so the next read loads fresh data. Races still exist, so keep a TTL as the bound on staleness; for stronger guarantees, invalidate from the DB change stream (CDC) or use versioned keys.' },
    ],
    lab: 'eviction',
  },
  {
    kind: 'local-cache',
    summary:
      'An in-process cache is a bounded, concurrent hash map living in each server’s heap: lookups cost ~100 ns and no network hop. The engineering lives in the bounding (admission + eviction), expiry and the loader. The catch is architectural: N servers hold N independent copies, so hit rates divide and invalidation across the fleet is hard — great as a tiny L1, a trap as the main cache.',
    parts: [
      { id: 'api', name: 'Cache API', role: '`get(key, loader)` called in-process', detail: 'A library call (`cache.get(k, k -> db.load(k))`) on the request thread. No serialization or network: the value is a live object reference.' },
      { id: 'map', name: 'Concurrent map', role: 'Thread-safe O(1) key lookup', detail: 'A `ConcurrentHashMap`-style table with per-bin locks/CAS so reads are lock-free. Access is recorded into lossy ring buffers and replayed in batches, so reads never contend on policy bookkeeping.' },
      { id: 'expiry', name: 'Expiry', role: 'Drops entries after TTL', detail: '`expireAfterWrite` / `expireAfterAccess` checked on read, plus a **hierarchical timer wheel** that expires entries in O(1) without scanning.' },
      { id: 'loader', name: 'Loader', role: 'Fetches value once on miss', detail: 'On a miss the map computes the value **once per key** (`computeIfAbsent`); concurrent callers for the same key block on that future — built-in request coalescing (Go: `singleflight`).' },
      { id: 'admission', name: 'Admission filter', role: 'Decides if newcomer deserves space', detail: '**TinyLFU**: a count-min sketch (~4 bits/counter, periodically halved) estimates key frequency; a new entry is admitted only if it is hotter than the eviction victim, so one-off scans can’t flush the hot set.' },
      { id: 'eviction', name: 'Eviction', role: 'Keeps size under the bound', detail: 'Window LRU (~1%) feeding a segmented LRU (probation/protected). Bound by entry count or by **weight** (bytes) — unbounded maps are the classic memory leak.' },
    ],
    flow: [
      { part: 'api', title: 'Lookup in-process', text: '`featureFlags.get("checkout-v2")` runs on the request thread. No socket, no serialization: ~50–200 ns.' },
      { part: 'map', title: 'Hash table probe', text: 'Lock-free read finds the entry; the access is appended to a read buffer for the policy to process later.' },
      { part: 'expiry', title: 'TTL checked', text: 'The entry was written 70 s ago with `expireAfterWrite(60s)`, so it is treated as a miss. Meanwhile other servers may still be serving their own copies of it — each fleet member expires on its own schedule.' },
      { part: 'loader', title: 'Loaded once', text: '200 threads ask for the same key; one runs the DB query and the rest wait on its future. Without this, a local cache multiplies stampedes by the number of threads × servers.' },
      { part: 'admission', title: 'Admission decision', text: 'The cache is full. TinyLFU estimates the new key was seen 9 times vs 2 for the eviction candidate, so the newcomer is admitted.' },
      { part: 'eviction', title: 'Victim evicted', text: 'The probation segment’s LRU tail is evicted and becomes garbage for the GC. Memory stays at the configured `maximumWeight`.' },
    ],
    knobs: [
      {
        name: 'Size bound',
        options: [
          { label: 'Unbounded map', effect: 'Grows until OutOfMemoryError or long GC pauses.', when: 'Never — this is the classic leak.' },
          { label: 'Max entries', effect: 'Simple, but a few large values can still blow the heap.', when: 'Uniformly sized values.' },
          { label: 'Max weight (bytes)', effect: 'Bounds memory precisely via a weigher function.', when: 'Variable-sized values.' },
        ],
      },
      {
        name: 'Freshness',
        options: [
          { label: 'expireAfterWrite', effect: 'Hard staleness bound; a miss blocks the caller on reload.', when: 'Data that must not be older than X.' },
          { label: 'refreshAfterWrite', effect: 'Serves the old value while one background reload runs — no latency spike.', when: 'Hot config/reference data that can be slightly stale.' },
        ],
      },
      {
        name: 'Fleet invalidation',
        options: [
          { label: 'TTL only', effect: 'Servers disagree for up to one TTL.', when: 'Staleness is harmless (feature flags, currency list).' },
          { label: 'Pub/sub broadcast', effect: 'Writer publishes "evict k"; every server drops it. Lost messages = silent staleness, so keep a TTL too.', when: 'L1 in front of Redis for hot keys.' },
          { label: 'Client-side tracking', effect: 'Redis 6 `CLIENT TRACKING` pushes invalidations for keys the client read.', when: 'Near-cache over Redis.' },
        ],
      },
    ],
    implementations: [
      { name: 'Caffeine (Java)', how: 'W-TinyLFU admission + segmented LRU, lossy read buffers, timer wheel for expiry, async refresh. Near-optimal hit rates; successor to Guava Cache.' },
      { name: 'Ristretto (Go)', how: 'Sharded map, TinyLFU admission with sampled-LFU eviction, cost-based bounding, writes batched through ring buffers (so a `Set` may be dropped under contention).' },
      { name: 'Near caches', how: 'Hazelcast/Coherence near cache and Redis client-side caching keep a local L1 that the server invalidates when the authoritative copy changes.' },
      { name: 'groupcache', how: 'Each process caches its own share of keys (consistent hash) and asks the owner peer on a miss — one copy per key fleet-wide, but values are immutable (no invalidation at all).' },
    ],
    ha: 'Nothing to make HA — it dies and restarts with its process. The real availability risk is the **cold start**: after a deploy every server starts empty and the backing store takes N× the miss traffic. Warm up from a snapshot or roll deploys slowly.',
    failureModes: [
      { name: 'Servers disagree', symptom: 'User sees price $10 on one request and $12 on the next, depending on which server answered.', fix: 'Don’t locally cache mutable shared data; use a shared Redis, or keep TTLs tiny with broadcast invalidation.' },
      { name: 'Hit rate divided by N', symptom: '20 servers each cache the same hot set; long-tail keys miss almost everywhere.', fix: 'Shared distributed cache as L2; local cache only for the hottest few keys.' },
      { name: 'Heap blow-up / GC pauses', symptom: 'Unbounded map grows until full GCs and OOM kills.', fix: 'Weight-bounded cache, off-heap or a separate cache tier.' },
    ],
    numbers: ['Local hit: ~50–200 ns vs ~0.3 ms for Redis in-DC', '20 servers × 1 GB local cache = 20 GB holding mostly the same keys', 'TinyLFU sketch: ~8 bytes per cached entry of overhead'],
    interview: [
      { q: 'Why not just cache everything in each app server’s memory?', a: 'Each server holds its own copy: hit rate falls with fleet size, memory is wasted on duplicates, and a write can’t invalidate N heaps reliably, so servers serve different values. A shared cache (Redis) gives one copy, one invalidation point, and survives deploys.' },
      { q: 'When is a local cache the right call?', a: 'Small, immutable or slowly changing data (config, feature flags, country lists) and as a short-TTL L1 in front of Redis for a handful of extreme hot keys, where saving the network hop or protecting one Redis shard matters more than seconds of staleness.' },
    ],
    lab: 'eviction',
  },
  {
    kind: 'db',
    summary:
      'A relational database turns SQL into a plan, executes it against fixed-size pages cached in a buffer pool, and makes changes durable by appending to a **write-ahead log** and fsyncing it at commit — data pages are written back lazily. MVCC keeps multiple row versions so readers never block writers, and crash recovery replays the WAL from the last checkpoint.',
    parts: [
      { id: 'conn', name: 'Connection', role: 'Session per client, auth, protocol', detail: 'Postgres forks a **process per connection** (~5–10 MB each); MySQL uses a thread per connection. Thousands of connections hurt, so a pooler like PgBouncer multiplexes many clients onto ~100 server connections.' },
      { id: 'parser', name: 'Parser', role: 'SQL text → validated query tree', detail: 'Lexes and parses SQL into a tree, resolves table/column names against the system catalog and checks permissions. Prepared statements skip this on re-execution.' },
      { id: 'planner', name: 'Optimizer', role: 'Chooses the cheapest execution plan', detail: '**Cost-based**: uses table statistics (row counts, histograms, distinct values from `ANALYZE`) to compare seq scan vs index scan and nested-loop vs hash vs merge join. Stale stats = bad plans. Inspect with `EXPLAIN ANALYZE`.' },
      { id: 'executor', name: 'Executor', role: 'Runs plan, applies MVCC visibility', detail: 'Pulls rows through the plan tree (Volcano iterator model). Walks **B+tree** indexes root→leaf (3–4 levels even for billions of rows), checks each row version against the transaction’s snapshot, and takes row locks for writes.' },
      { id: 'buffer', name: 'Buffer pool', role: 'Caches pages, tracks dirty ones', detail: 'Fixed-size pages (8 KB Postgres, 16 KB InnoDB) cached in RAM (`shared_buffers`, `innodb_buffer_pool_size`) with clock-sweep/LRU eviction. Modified pages are marked dirty and **not** written at commit.' },
      { id: 'wal', name: 'Write-ahead log', role: 'Sequential log made durable at commit', detail: 'Every change is first appended as a WAL (InnoDB: redo log) record. At COMMIT the log is `fsync`ed; **group commit** batches many transactions into one fsync. Rule: the log record hits disk before the data page does.' },
      { id: 'files', name: 'Data files', role: 'Heap and index pages on disk', detail: 'The **checkpointer** periodically flushes dirty pages and records a checkpoint so recovery only replays WAL after it. Postgres `VACUUM` reclaims dead row versions; InnoDB purges undo logs.' },
    ],
    flow: [
      { part: 'conn', title: 'Session picked', text: 'The app borrows a pooled connection and sends `UPDATE accounts SET balance = balance - 100 WHERE id = 42` inside a transaction.' },
      { part: 'parser', title: 'Parsed and resolved', text: '`accounts`, `balance` and `id` are resolved in the catalog; the user’s UPDATE privilege is checked.' },
      { part: 'planner', title: 'Plan chosen', text: 'Stats say `id` is unique and the table has 50M rows, so an **index scan on `accounts_pkey`** (≈4 page reads) beats a seq scan (≈600k pages).' },
      { part: 'executor', title: 'New row version written', text: 'The B+tree leaf points to the row. Under **MVCC** Postgres doesn’t overwrite it: it writes a new tuple with `xmin = 1001` and stamps the old one `xmax = 1001`. Concurrent readers with older snapshots still see the old balance; a concurrent writer to row 42 waits on the row lock.' },
      { part: 'buffer', title: 'Page dirtied in memory', text: 'The heap page (and an index page if a key changed) is modified in the buffer pool and marked dirty. Nothing has gone to the data files yet.' },
      { part: 'wal', title: 'Commit = WAL fsync', text: 'COMMIT appends a commit record and `fsync`s the WAL — the only synchronous disk write. 50 concurrent commits share one fsync via group commit. Now the client gets OK: durable even if power fails this instant.' },
      { part: 'files', title: 'Lazy write-back and cleanup', text: 'Minutes later the checkpointer writes the dirty page. After a crash, recovery replays WAL from the last checkpoint. Once no snapshot can see the old tuple, autovacuum marks its space reusable.' },
    ],
    knobs: [
      {
        name: 'Isolation level',
        options: [
          { label: 'Read committed', effect: 'Each statement sees a fresh snapshot; non-repeatable reads and lost updates are possible.', when: 'Default in Postgres; fine for most CRUD with `SELECT … FOR UPDATE` where needed.' },
          { label: 'Repeatable read / snapshot', effect: 'One snapshot per transaction; write skew still possible. Default in MySQL InnoDB.', when: 'Consistent reports, multi-read logic.' },
          { label: 'Serializable', effect: 'Behaves as if transactions ran one by one (Postgres SSI aborts conflicting ones). Clients must retry on serialization failures.', when: 'Invariants across rows (double-booking, balances) without manual locking.' },
        ],
      },
      {
        name: 'Commit durability',
        options: [
          { label: 'fsync every commit', effect: 'No acknowledged write lost on crash; commit latency = fsync latency (amortised by group commit).', when: 'Default; anything that matters.' },
          { label: 'Relaxed (`synchronous_commit=off`, `innodb_flush_log_at_trx_commit=2`)', effect: 'Several× faster commits; a crash loses the last ~1 s of acknowledged transactions (no corruption).', when: 'Logs, metrics, re-derivable data.' },
        ],
      },
      {
        name: 'Connection handling',
        options: [
          { label: 'Direct connections', effect: 'Simple, but each costs memory and a process/thread; thousands cause contention.', when: 'Few app instances.' },
          { label: 'Transaction pooling (PgBouncer, RDS Proxy)', effect: 'Thousands of clients share ~100 server connections; session features (prepared statements, `SET`) need care.', when: 'Many app pods or serverless functions.' },
        ],
      },
    ],
    implementations: [
      { name: 'PostgreSQL', how: 'Heap tables with separate B+tree (and GIN/GiST/BRIN) indexes; MVCC stores old versions in the heap (`xmin`/`xmax`) and needs **VACUUM**. Process per connection, WAL used for both recovery and replication.' },
      { name: 'MySQL InnoDB', how: '**Clustered index**: rows live in the primary-key B+tree leaves; secondary indexes store the PK. Updates are in place with old versions kept in **undo logs** (purged later). Redo log + doublewrite buffer guard against torn pages.' },
      { name: 'Amazon Aurora', how: '“The log is the database”: compute ships only redo records to a storage fleet that keeps 6 copies across 3 AZs (4/6 write quorum) and materialises pages itself — no checkpoints or full-page writes from the engine.' },
      { name: 'CockroachDB / Spanner', how: 'SQL layer on top of a sharded, Raft/Paxos-replicated KV store (LSM-based); serializable transactions across shards, at the cost of consensus latency per write.' },
    ],
    ha: 'One primary takes writes; standbys replay its WAL (see Read Replica). An orchestrator (Patroni, Orchestrator, RDS Multi-AZ) detects failure and promotes a standby in ~10–60 s. Synchronous standby = no lost commits; scaling writes beyond one box means sharding.',
    failureModes: [
      { name: 'Connection exhaustion', symptom: 'Autoscaled app pods open thousands of connections; `too many clients`, memory pressure, latency spikes.', fix: 'Connection pooler, cap pool size per pod (cores × 2–4 total is often optimal).' },
      { name: 'Missing index / bad plan', symptom: 'A query that was 2 ms becomes a 30 s seq scan after data growth or stale stats.', fix: '`EXPLAIN ANALYZE`, add the right composite index, keep `ANALYZE` current, alert on slow-query log.' },
      { name: 'Vacuum/undo debt', symptom: 'A long-running transaction pins old versions: table bloat, slow scans, in Postgres eventually txid wraparound protection.', fix: 'Kill idle-in-transaction sessions, short transactions, tune autovacuum.' },
      { name: 'Hot row contention', symptom: 'Every order updates one counter row; transactions queue on its row lock.', fix: 'Shard the counter into N rows, batch updates, or move it to Redis `INCR`.' },
    ],
    numbers: ['Page: 8 KB (Postgres), 16 KB (InnoDB)', 'B+tree fanout ~100s ⇒ 3–4 levels for 1B rows', 'NVMe fsync ~0.1 ms; network block storage ~1–2 ms', 'One well-tuned node: ~10k–50k write TPS, 100k+ simple reads/s', 'Postgres connection: ~5–10 MB each'],
    interview: [
      { q: 'What exactly happens when you COMMIT?', a: 'The commit record is appended to the WAL and the WAL is fsynced (group commit batches concurrent commits). Only then is the client acknowledged. Data pages stay dirty in the buffer pool and are flushed later by checkpoints; after a crash, recovery replays the WAL from the last checkpoint, so committed work is redone and uncommitted work is ignored.' },
      { q: 'How does MVCC let readers and writers not block each other?', a: 'Writers create a new row version instead of overwriting; each transaction reads with a snapshot that decides which versions are visible (Postgres: `xmin`/`xmax` vs the snapshot; InnoDB: rebuild old versions from undo). Writers still block writers on the same row. The cost is garbage: dead versions must be vacuumed/purged.' },
      { q: 'B+tree vs LSM tree storage?', a: 'B+tree updates pages in place: reads are fast and predictable (one root-to-leaf path), writes cost random I/O and write amplification from whole-page writes. LSM buffers writes in memory and flushes sorted immutable files: very high write throughput, but reads may check several files (bloom filters help) and compaction costs background I/O.' },
    ],
    lab: 'storage',
  },
  {
    kind: 'replica',
    summary:
      'A read replica is a copy of the primary kept up to date by replaying the primary’s change log — Postgres ships WAL, MySQL ships the binlog. Replicas serve reads and are failover candidates. The central trade-off is when the primary acknowledges a commit: before (async, fast, may lose data and lag) or after a replica has it (sync, safer, slower).',
    parts: [
      { id: 'log', name: 'Primary log', role: 'Ordered record of every change', detail: 'Postgres reuses its **WAL** (physical: page-level byte changes, addressed by LSN). MySQL writes a separate **binlog** (logical: row images or statements, addressed by GTID) in addition to the InnoDB redo log.' },
      { id: 'sender', name: 'Log sender', role: 'Streams log records to replicas', detail: 'A `walsender` process (Postgres) or binlog dump thread (MySQL) per replica reads the log and pushes new records over a long-lived TCP connection. Replication slots stop the primary deleting WAL a replica still needs.' },
      { id: 'receiver', name: 'Log receiver', role: 'Persists incoming records on replica', detail: '`walreceiver` writes and fsyncs the stream locally (MySQL: I/O thread → relay log) and reports back `write`/`flush`/`replay` positions — the basis of semi-sync and sync acks and of lag metrics.' },
      { id: 'apply', name: 'Applier', role: 'Replays changes into replica data', detail: 'Postgres’ startup process redoes WAL exactly like crash recovery (single-threaded). MySQL’s SQL/applier threads re-execute row events, in parallel per schema or by commit groups (`replica_parallel_workers`).' },
      { id: 'reads', name: 'Read serving', role: 'Answers queries on slightly-old data', detail: 'A **hot standby** accepts read-only queries on whatever has been replayed so far. Long queries can conflict with replay (rows they need are vacuumed on the primary) → cancelled, or replay is delayed.' },
      { id: 'failover', name: 'Failover manager', role: 'Detects primary death, promotes replica', detail: 'Patroni (leader key with TTL in etcd/Consul/ZK) or Orchestrator picks the most up-to-date replica, promotes it, repoints the others and **fences** the old primary so two primaries never accept writes.' },
    ],
    flow: [
      { part: 'log', title: 'Change logged on primary', text: '`UPDATE users SET name = "Ana" WHERE id = 7` commits; its WAL records end at LSN `0/3A00F28`.' },
      { part: 'sender', title: 'Streamed out', text: 'The walsender pushes the new records to each connected replica within milliseconds. In **async** mode the client already got its OK.' },
      { part: 'receiver', title: 'Received and flushed', text: 'The replica fsyncs the records and replies `flush = 0/3A00F28`. In **sync / semi-sync** mode the primary waited for this ack before confirming the commit — one extra network RTT per commit.' },
      { part: 'apply', title: 'Replayed', text: 'The startup process applies the change. A big batch update or a single-threaded applier behind a write-heavy primary shows up here as **replication lag**.' },
      { part: 'reads', title: 'Read served (maybe stale)', text: 'The user reloads their profile 50 ms after saving. If routed to a replica 200 ms behind, they see the old name — a **read-your-writes** violation. Route that user’s reads to the primary for a few seconds, or wait until the replica’s replay LSN ≥ the write’s LSN.' },
      { part: 'failover', title: 'Primary dies → promotion', text: 'Patroni’s leader key expires after ~30 s. The replica with the highest LSN is promoted, others follow it, the VIP/DNS moves. With async replication any commits it never received are **lost**.' },
    ],
    knobs: [
      {
        name: 'Commit acknowledgement',
        options: [
          { label: 'Async', effect: 'No latency cost; replicas lag; failover can lose the last ms–s of acknowledged writes.', when: 'Default; read scaling, cross-region DR.' },
          { label: 'Semi-sync (MySQL) / remote_write', effect: 'At least one replica has **received** the change before ack; small latency cost, near-zero loss.', when: 'Primary DBs in one region across AZs.' },
          { label: 'Sync / quorum sync (`ANY 1 (r1, r2)`)', effect: 'Commit waits for a replica flush (or apply); no data loss on failover, writes stall if sync replicas are down (use quorum of several).', when: 'Money, orders — RPO = 0.' },
        ],
      },
      {
        name: 'Read routing',
        options: [
          { label: 'All reads to replicas', effect: 'Maximum offload; users may not see their own writes.', when: 'Feeds, analytics, anything staleness-tolerant.' },
          { label: 'Read-your-writes routing', effect: 'Pin a user to the primary for N s after a write, or pass the commit LSN/GTID and wait for it on the replica.', when: 'User-facing “I just saved this” flows.' },
          { label: 'Primary only', effect: 'Always fresh; no read scaling.', when: 'Read-modify-write logic, balances, uniqueness checks.' },
        ],
      },
      {
        name: 'Log format',
        options: [
          { label: 'Physical (WAL)', effect: 'Byte-exact copy, cheap to apply; same major version and whole cluster only.', when: 'HA standbys and read replicas.' },
          { label: 'Logical (row-based binlog, Postgres logical decoding)', effect: 'Per-table, cross-version, feeds CDC (Debezium → Kafka); more CPU, no DDL in Postgres.', when: 'Zero-downtime upgrades, CDC, selective replication.' },
        ],
      },
    ],
    implementations: [
      { name: 'PostgreSQL streaming replication', how: 'walsender → walreceiver over TCP; replication slots retain WAL; `synchronous_standby_names` sets sync/quorum; hot standby for reads; Patroni for automatic failover.' },
      { name: 'MySQL replication', how: 'Binlog (row-based) shipped to relay logs, applied by parallel workers; **GTIDs** make repointing replicas trivial; semi-sync plugin; Orchestrator (GitHub) handles topology and failover.' },
      { name: 'Aurora / AlloyDB replicas', how: 'Replicas share the same distributed storage, so they don’t replay full data — only invalidate cached pages from the redo stream. Lag is typically < 20 ms and up to 15 replicas.' },
    ],
    ha: 'Replicas *are* the HA mechanism: keep ≥1 sync or semi-sync replica in another AZ for zero-loss failover and async replicas (maybe cross-region) for reads and DR. The failover manager itself uses a consensus store (etcd) so only one node can hold the leader key, plus fencing (STONITH, revoked VIP) against split brain.',
    failureModes: [
      { name: 'Replication lag', symptom: 'A big migration or bulk update makes replicas minutes behind; users see stale data, failover candidates are far behind.', fix: 'Batch large writes, parallel apply, alert on lag, eject lagging replicas from the read pool.' },
      { name: 'Split brain', symptom: 'Network partition: old primary still accepts writes while a replica is promoted; two diverging histories.', fix: 'Consensus-based leader lock with TTL, fencing old primary, clients connect only via the leader endpoint.' },
      { name: 'Data loss on async failover', symptom: 'Orders acknowledged in the last second before the crash vanish after promotion.', fix: 'Semi-sync/sync to at least one replica for critical data; reconcile from the old primary’s WAL if recoverable.' },
      { name: 'WAL pile-up', symptom: 'A dead replica holds a replication slot; primary disk fills with retained WAL and the primary goes down.', fix: '`max_slot_wal_keep_size`, monitor slot lag, drop abandoned slots.' },
    ],
    numbers: ['Typical async lag in-region: ~1–100 ms; spikes to minutes', 'Sync commit adds 1 RTT: ~0.5–2 ms cross-AZ, 50–150 ms cross-region', 'Patroni failover: ~10–30 s (leader TTL + promotion)', 'Read scaling: N replicas ≈ N× read capacity, 0× write capacity'],
    interview: [
      { q: 'A user updates their profile, refreshes, and sees the old value. Why, and how do you fix it?', a: 'The read went to an async replica that hadn’t replayed the write yet. Fix with read-your-writes: route that user’s reads to the primary for a short window after a write, or record the write’s LSN/GTID and only read from a replica that has replayed past it (else fall back to primary).' },
      { q: 'Async vs synchronous replication?', a: 'Async: commit is acked before replicas have it — no latency cost, but lag and possible loss of recent writes on failover. Sync: commit waits for a replica’s ack — RPO 0, but +1 RTT per write and writes block if the sync replica is down, so use quorum sync across ≥2 replicas.' },
      { q: 'How do you prevent split brain during failover?', a: 'Only the holder of a lease in a consensus store (etcd/ZooKeeper) may be primary; the old primary must demote itself when it can’t renew the lease, and the new one fences it (revoke VIP, STONITH). Clients find the primary through that single source of truth.' },
    ],
  },
  {
    kind: 'nosql',
    summary:
      'A Dynamo-style wide-column store (Cassandra, ScyllaDB) hashes the partition key onto a token ring, writes to N replicas without a leader, and acks once W of them reply. Each replica stores data in an **LSM tree**: append to a commit log, insert into an in-memory memtable, flush immutable sorted SSTables, merge them in the background. Read repair, hinted handoff and Merkle-tree anti-entropy heal divergence.',
    parts: [
      { id: 'coordinator', name: 'Coordinator', role: 'Any node fronting the request', detail: 'The node the driver contacted (token-aware drivers pick a replica directly). It sends the request to replicas, waits for the consistency level, and stores **hints** for replicas that are down.' },
      { id: 'partitioner', name: 'Partitioner', role: 'Partition key → token → replicas', detail: '`Murmur3(partition_key)` gives a 64-bit token; the replicas are the next **RF** distinct nodes clockwise on the ring (rack/DC-aware with `NetworkTopologyStrategy`). Clustering columns sort rows within a partition.' },
      { id: 'commitlog', name: 'Commit log', role: 'Sequential append for durability', detail: 'Every write is appended to a shared commit log first. Default `commitlog_sync: periodic` fsyncs every 10 s — durability comes from having RF copies, not from per-write fsync.' },
      { id: 'memtable', name: 'Memtable', role: 'Sorted in-memory write buffer', detail: 'A concurrent skiplist per table, sorted by token then clustering key. No read-before-write: an update or delete is just a newer cell with a timestamp (deletes write a **tombstone**).' },
      { id: 'sstable', name: 'SSTables', role: 'Immutable sorted files on disk', detail: 'A full memtable is flushed to an SSTable: data file + partition index + summary + **bloom filter** (~1% FP) so reads skip files that can’t contain the key. Reads merge cells from memtable + SSTables by timestamp (last write wins).' },
      { id: 'compaction', name: 'Compaction', role: 'Merges SSTables, drops garbage', detail: 'Background merge-sort of SSTables that keeps the newest cell, drops overwritten data and tombstones older than `gc_grace_seconds` (10 days). Strategy trades write amplification vs read amplification vs space.' },
      { id: 'repair', name: 'Anti-entropy', role: 'Heals divergent replicas', detail: '**Read repair** fixes mismatches seen during reads; **hinted handoff** replays missed writes when a node returns; **nodetool repair** compares Merkle trees of token ranges and streams only differing ranges.' },
    ],
    flow: [
      { part: 'coordinator', title: 'Write arrives', text: '`INSERT INTO msgs (chat_id, ts, body) …` with `CONSISTENCY QUORUM` reaches node C, which acts as coordinator.' },
      { part: 'partitioner', title: 'Replicas found', text: '`Murmur3(chat_id)` → token `-4611…` → RF=3 replicas A, D, F (in three racks). The write is sent to all three in parallel; the coordinator needs W=2 acks.' },
      { part: 'commitlog', title: 'Logged on each replica', text: 'Each replica appends the mutation to its commit log — a sequential write, no seek.' },
      { part: 'memtable', title: 'Inserted into memtable', text: 'The cell goes into the memtable skiplist; the replica acks. A and D reply in 2 ms → quorum reached → client gets success. F is down, so C keeps a **hint** and replays it when F returns.' },
      { part: 'sstable', title: 'Flushed, then read', text: 'When the memtable hits its size limit it is flushed to a new SSTable. A later `QUORUM` read asks 2 replicas; each checks its memtable and only the SSTables whose bloom filter says “maybe”, merging cells by timestamp. R=2 + W=2 > N=3, so the read overlaps the write.' },
      { part: 'repair', title: 'Divergence repaired', text: 'The two replicas returned different digests, so the coordinator fetches full data, returns the newest cell and writes it back to the stale replica (**read repair**). Weekly `nodetool repair` catches data that is never read.' },
      { part: 'compaction', title: 'Compacted', text: 'Compaction merges SSTables, keeps the newest version of each cell and purges tombstones older than 10 days. Run repair within that window or deleted data can resurrect (“zombies”).' },
    ],
    knobs: [
      {
        name: 'Consistency level (N=3)',
        options: [
          { label: 'ONE / ONE', effect: 'Lowest latency, highest availability; reads may miss recent writes.', when: 'Metrics, logs, likes.' },
          { label: 'QUORUM / QUORUM', effect: 'R + W > N ⇒ reads see the latest acknowledged write (barring LWW clock issues); tolerates 1 down replica.', when: 'Default for user data.' },
          { label: 'LOCAL_QUORUM', effect: 'Quorum inside the local DC; other DCs replicate async. Avoids cross-region latency.', when: 'Multi-region clusters.' },
          { label: 'ALL', effect: 'Any single replica down fails the request.', when: 'Rarely; mostly a mistake.' },
        ],
      },
      {
        name: 'Compaction strategy',
        options: [
          { label: 'Size-tiered (STCS)', effect: 'Merges similar-sized files: cheap writes, but a key may live in many files and compaction needs up to 2× disk.', when: 'Write-heavy, rarely read.' },
          { label: 'Leveled (LCS)', effect: 'Non-overlapping levels: a read touches ~1 file per level (~90% of reads hit 1 SSTable); ~2× more compaction I/O.', when: 'Read-heavy, updates.' },
          { label: 'Time-window (TWCS)', effect: 'One bucket per time window, dropped whole on TTL expiry.', when: 'Time series with TTL.' },
        ],
      },
      {
        name: 'Data modelling',
        options: [
          { label: 'Query-first, denormalized', effect: 'One table per query, partition key = what you look up by; reads hit one partition.', when: 'Always — there are no joins.' },
          { label: 'Relational-style', effect: 'Secondary indexes / `ALLOW FILTERING` scatter across the cluster.', when: 'Never at scale.' },
        ],
      },
    ],
    implementations: [
      { name: 'Apache Cassandra', how: 'Leaderless Dynamo replication + Bigtable LSM storage, gossip membership, tunable consistency per query, LWT via Paxos for compare-and-set (4 round trips).' },
      { name: 'ScyllaDB', how: 'Cassandra-compatible in C++ on Seastar: **shard-per-core**, each core owns a slice of data with no locks or shared memory; its own I/O scheduler.' },
      { name: 'Amazon DynamoDB', how: 'Managed; partitions (≤10 GB, ~3000 RCU / 1000 WCU each) are replicated across 3 AZs by a **Multi-Paxos leader** per partition (not leaderless like the Dynamo paper); B-tree storage nodes; adaptive capacity splits hot partitions.' },
      { name: 'RocksDB', how: 'Embedded LSM library (from LevelDB) used inside MySQL MyRocks, Kafka Streams, TiKV, CockroachDB (Pebble): leveled compaction, per-file bloom/ribbon filters, block cache.' },
    ],
    ha: 'No single primary: any node coordinates, data lives on RF nodes across racks/AZs, and QUORUM tolerates one replica down. Multi-DC replication is built in (`NetworkTopologyStrategy`, per-DC RF). Scale by adding nodes — they take token ranges and stream data from neighbours.',
    failureModes: [
      { name: 'Hot / huge partition', symptom: 'A partition key like `country` or a celebrity’s timeline grows to GBs; one replica set melts, compaction and repairs choke.', fix: 'Higher-cardinality keys, bucketing (`chat_id + day`), keep partitions < ~100 MB.' },
      { name: 'Tombstone overload', symptom: 'Queue-like table: deletes leave tombstones, reads scan 100k of them and time out.', fix: 'Don’t model queues in Cassandra; TTL + TWCS; time-bucketed partitions.' },
      { name: 'Compaction falling behind', symptom: 'SSTable count climbs, read latency rises, disk fills.', fix: 'Right strategy, keep ~50% free disk for STCS, throttle writes, add nodes.' },
      { name: 'Zombie data', symptom: 'Deleted rows reappear after a node returns.', fix: 'Run repair more often than `gc_grace_seconds`.' },
    ],
    numbers: ['Cassandra node: ~10k–100k writes/s; writes ~1 ms', 'Default RF=3, QUORUM=2', 'Keep partitions < 100 MB, < ~100k rows', 'DynamoDB partition: 10 GB, 3000 RCU, 1000 WCU', 'gc_grace_seconds default: 10 days'],
    interview: [
      { q: 'Why are LSM-tree writes so fast?', a: 'A write is a sequential append to the commit log plus an in-memory insert — no random I/O, no read-before-write. Disk work happens later in large sequential flushes and compactions. The cost moves to reads (merge several files, bloom filters mitigate) and to background compaction I/O.' },
      { q: 'What does R + W > N buy you, and what doesn’t it?', a: 'The read and write replica sets must overlap, so a read sees at least one copy of the latest acknowledged write. It doesn’t give linearizability: concurrent writes are resolved by last-write-wins timestamps (clock skew can drop writes), and a failed write may still be partially applied. Use LWT/Paxos or a consensus store for compare-and-set.' },
      { q: 'How does a delete work in an LSM store?', a: 'It writes a tombstone, because older SSTables still contain the value and are immutable. Reads see the tombstone shadowing the value; compaction drops both after `gc_grace_seconds`. If a replica missed the tombstone and repair didn’t run in time, the old value can come back.' },
    ],
    lab: 'storage',
  },
  {
    kind: 'shard-router',
    summary:
      'A shard router is a stateless proxy that makes N databases look like one. It parses each query, extracts the shard key, maps it to a shard through a versioned shard map stored in a consensus store, and forwards the query — or, if no shard key is present, scatters it to every shard and merges the results. It also orchestrates resharding by flipping the map once data has been copied.',
    parts: [
      { id: 'frontend', name: 'Protocol frontend', role: 'Speaks the DB wire protocol', detail: 'vtgate speaks the MySQL protocol and mongos the MongoDB protocol, so apps use ordinary drivers. Routers are **stateless** and run as many replicas behind a load balancer.' },
      { id: 'parser', name: 'Query analyzer', role: 'Parses SQL, finds shard key', detail: 'Parses the query and looks for an equality or IN predicate on the shard key column (`WHERE user_id = 42`). Joins, aggregates and ORDER BY/LIMIT are noted for the merge step.' },
      { id: 'vindex', name: 'Key mapper', role: 'Shard key → keyspace position', detail: 'Applies the sharding function — Vitess **vindex** (e.g. `hash(user_id)` → 64-bit keyspace id), MongoDB hashed or ranged shard key, Citus `hash(dist_col)` → shard id. Lookup vindexes map non-key columns (email → user_id) through a side table.' },
      { id: 'topo', name: 'Shard map', role: 'Position → shard → primary host', detail: 'Ranges like `-40, 40-80, 80-c0, c0-` → shard → current primary, stored in etcd/ZooKeeper (Vitess) or config servers (MongoDB) and **cached with a version** in every router; refreshed on change or on a stale-version error.' },
      { id: 'dispatch', name: 'Dispatcher', role: 'Sends query to one/all shards', detail: 'Single-shard queries go to one primary (or replica for reads). Queries without a shard key are **scatter-gathered** in parallel to every shard; the slowest shard sets the latency.' },
      { id: 'merge', name: 'Result merger', role: 'Combines per-shard results', detail: 'Merge-sorts streams for ORDER BY, re-applies LIMIT, sums partial COUNT/SUM (AVG = SUM/COUNT), dedups. Cross-shard joins are limited or executed as nested lookups — expensive.' },
    ],
    flow: [
      { part: 'frontend', title: 'Query received', text: 'The app’s MySQL driver sends `SELECT * FROM orders WHERE user_id = 42 ORDER BY created_at DESC LIMIT 20` to a vtgate behind the LB.' },
      { part: 'parser', title: 'Shard key spotted', text: 'The analyzer sees `user_id = 42`, and `orders` is sharded by `user_id`, so this can be a **single-shard** query.' },
      { part: 'vindex', title: 'Key hashed', text: 'The hash vindex maps 42 → keyspace id `0x6c…`.' },
      { part: 'topo', title: 'Shard located', text: 'The cached map says `0x6c…` falls in range `40-80` → shard 2, primary `db-2a`. No call to etcd on the hot path.' },
      { part: 'dispatch', title: 'Routed (or scattered)', text: 'The query goes only to shard 2. A query like `WHERE status = "late"` has no shard key, so it fans out to all 4 shards in parallel — 4× load, and p99 = the slowest of the 4.' },
      { part: 'merge', title: 'Results merged', text: 'For the scatter query each shard returns its top 20 by `created_at`; the router merge-sorts 80 rows and keeps 20. Single-shard results stream straight through.' },
      { part: 'topo', title: 'Resharding cut-over', text: 'To split `40-80` into `40-60` and `60-80`, VReplication copies rows and tails the binlog into the new shards, then the router briefly holds writes, flips the map version and resumes — seconds of pause, no downtime.' },
    ],
    knobs: [
      {
        name: 'Sharding scheme',
        options: [
          { label: 'Hash of key', effect: 'Even spread, no hot tail range; range scans across keys hit all shards.', when: 'Point lookups by id (users, orders by user).' },
          { label: 'Range of key', effect: 'Efficient range scans, easy splits; sequential keys (timestamps) hot-spot the last range.', when: 'Time/alphabetic scans with non-monotonic keys.' },
          { label: 'Directory (lookup table)', effect: 'Any key → any shard, can move single tenants; the directory is an extra lookup and must be HA.', when: 'Multi-tenant SaaS with very uneven tenants.' },
        ],
      },
      {
        name: 'Queries without the shard key',
        options: [
          { label: 'Scatter-gather', effect: 'Works transparently, cost grows with shard count and tail latency.', when: 'Rare admin/report queries.' },
          { label: 'Secondary lookup index', effect: 'Maintain `email → user_id` mapping (lookup vindex / global index table) so it becomes 2 single-shard hops.', when: 'Frequent alternate access paths.' },
          { label: 'Separate read model', effect: 'Stream changes (CDC) to Elasticsearch / warehouse for cross-shard queries.', when: 'Search, analytics.' },
        ],
      },
      {
        name: 'Cross-shard writes',
        options: [
          { label: 'Disallow', effect: 'Each transaction touches one shard; design keys so related rows co-locate (orders with their user).', when: 'Preferred.' },
          { label: '2PC', effect: 'Atomic but slow and blocking on coordinator failure.', when: 'Rare, small transactions (Vitess/Citus support it).' },
          { label: 'Saga', effect: 'Per-shard steps with compensations; eventually consistent.', when: 'Business workflows spanning entities.' },
        ],
      },
    ],
    implementations: [
      { name: 'Vitess', how: '**vtgate** routers + a **vttablet** sidecar per MySQL; topology in etcd; vindexes define sharding; **VReplication** does online resharding and MoveTables. Runs YouTube, Slack, GitHub-scale MySQL; PlanetScale is managed Vitess.' },
      { name: 'MongoDB mongos', how: 'Routers cache the chunk map from the **config server** replica set; data is split into chunks (default 128 MB) by ranged or hashed shard key; a balancer migrates chunks, and shards reject stale-version requests so mongos refreshes.' },
      { name: 'Citus (Postgres)', how: 'Coordinator node rewrites queries into per-shard fragments; co-located distributed tables join locally; small **reference tables** are replicated to every node.' },
      { name: 'App-level routing', how: 'Instagram/Pinterest embed the logical shard id in the 64-bit object id and map thousands of logical shards to few physical hosts in a config table — no proxy, the client library routes.' },
    ],
    ha: 'Routers are stateless: run many behind an LB and scale horizontally. The shard map lives in a replicated consensus store (etcd, ZooKeeper, config-server replica set); routers keep serving from their cached copy even if that store is briefly down. Each shard is itself a primary + replicas with its own failover.',
    failureModes: [
      { name: 'Scatter-gather everywhere', symptom: 'Most queries lack the shard key; every query hits all 64 shards, load ×64 and p99 explodes.', fix: 'Pick the shard key from the dominant access pattern; add lookup indexes or a separate read model.' },
      { name: 'Hot shard', symptom: 'One tenant or celebrity dominates a shard; adding shards doesn’t help.', fix: 'Split that range, move the tenant via directory, or salt the key.' },
      { name: 'Stale shard map', symptom: 'After a migration a router writes to the old shard.', fix: 'Versioned maps; shards reject requests with an old version; router refreshes and retries.' },
    ],
    numbers: ['Router hop: ~0.5–1 ms', 'Scatter p99 ≈ max of N shards’ latencies: with 1% slow per shard and 100 shards, ~63% of queries hit a slow one', 'MongoDB default chunk: 128 MB', 'Start with many logical shards (e.g. 4096) on few hosts'],
    interview: [
      { q: 'How do you choose a shard key?', a: 'From the dominant query: the key that most reads/writes filter by, with high cardinality and even load, and that co-locates rows touched in one transaction (shard orders by `user_id`, not `order_id`). Avoid monotonic keys with range sharding and low-cardinality keys like country.' },
      { q: 'How do you handle a query that doesn’t include the shard key?', a: 'Scatter-gather to all shards and merge (fine if rare), or maintain a secondary mapping table (email → user_id) to turn it into targeted lookups, or serve it from a separate read model (Elasticsearch, warehouse) fed by CDC.' },
      { q: 'How do you reshard without downtime?', a: 'Copy data to new shards while tailing the change log to keep them in sync (VReplication, chunk migration), verify, then briefly pause writes, flip the versioned shard map, and resume. Pre-splitting into many logical shards means future growth only moves whole logical shards between hosts.' },
    ],
    lab: 'ring',
  },
  {
    kind: 'hash-ring',
    summary:
      'Consistent hashing places both nodes and keys on the same circular hash space; a key belongs to the first node clockwise from it. Adding or removing a node only moves the keys in the arcs next to it — about K/N keys instead of nearly all. Virtual nodes (many tokens per server) smooth out load and spread a failed node’s keys over everyone.',
    parts: [
      { id: 'hash', name: 'Hash function', role: 'Key → position on ring', detail: 'A fast, well-mixed hash (MD5 in ketama, Murmur3 in Cassandra) maps the key to a 32/64-bit position. Same function and seed in every client, or they disagree on ownership.' },
      { id: 'tokens', name: 'Token array', role: 'Sorted positions of all vnodes', detail: 'Each server is hashed onto the ring many times (`hash("cacheA#0")`, `hash("cacheA#1")`, …). All tokens are kept in one **sorted array** — a few KB for hundreds of servers.' },
      { id: 'search', name: 'Clockwise search', role: 'Finds the first token ≥ hash', detail: '**Binary search** in the token array, O(log V); wrap to index 0 past the end. That token’s owner is the key’s primary.' },
      { id: 'vnodes', name: 'Vnode → server', role: 'Maps token to physical node', detail: 'Each token records its physical server (and weight: bigger boxes get more tokens). With 100–256 tokens per server, each owns many small arcs, so load evens out.' },
      { id: 'replicas', name: 'Replica walk', role: 'Next N distinct servers clockwise', detail: 'For replication, keep walking clockwise, skipping tokens of servers already chosen (and optionally same rack/AZ), until N distinct servers — Dynamo’s **preference list**.' },
      { id: 'membership', name: 'Membership', role: 'Updates ring on join/leave', detail: 'Gossip (Cassandra) or a coordination service (ZooKeeper) distributes the server list; every client rebuilds the same token array. Data stores then stream the moved ranges to their new owners.' },
    ],
    flow: [
      { part: 'hash', title: 'Key hashed', text: '`murmur3("session:9f2c")` → position 0x7A31… on a 2^64 ring.' },
      { part: 'search', title: 'First token clockwise', text: 'Binary search over 300 tokens (3 servers × 100 vnodes) finds the first token ≥ 0x7A31… in ~9 comparisons.' },
      { part: 'vnodes', title: 'Owner resolved', text: 'That token is `B#17`, so server B owns the key.' },
      { part: 'replicas', title: 'Replicas chosen', text: 'With RF=3, keep walking: next tokens are `B#40` (skip, same server), `C#3`, `A#81` → replicas B, C, A.' },
      { part: 'membership', title: 'Server D joins', text: 'D adds 100 tokens. Each one steals the arc just before it from whichever server owned it — so D takes ~1/4 of the keys, roughly evenly **from all three** servers. The other ~75% of keys don’t move.' },
      { part: 'tokens', title: 'Server A dies', text: 'A’s 100 tokens are removed from the array. Each of its small arcs falls to the next token clockwise — spread across B, C and D, not dumped on one neighbour as it would be with one token per server.' },
    ],
    knobs: [
      {
        name: 'Tokens per server',
        options: [
          { label: '1', effect: 'Arc sizes vary wildly (some servers own several × average); a failure doubles one neighbour’s load.', when: 'Never in practice.' },
          { label: '16–256 vnodes', effect: 'Load within ~±10%; failures spread evenly; more tokens = bigger ring and more ranges to repair.', when: 'Default (Cassandra 4: 16 with smart allocation; ketama: 100–160).' },
        ],
      },
      {
        name: 'Algorithm',
        options: [
          { label: 'Ring + vnodes', effect: 'Arbitrary add/remove, weights, natural replica walk; O(log V) lookup, memory for tokens.', when: 'Caches, Dynamo-style stores.' },
          { label: 'Jump consistent hash', effect: 'No memory, near-perfect balance, ~5 lines; buckets must be numbered 0..N-1, only add/remove at the end.', when: 'Sharding storage into numbered shards that never fail out of order.' },
          { label: 'Rendezvous (HRW)', effect: 'Score every node `hash(key, node)`, take the max; O(N) per lookup, perfect minimal movement, easy top-k replicas.', when: 'Small node sets (CDN edge selection, a few dozen nodes).' },
          { label: 'Maglev table', effect: 'Precomputed lookup table: O(1) lookup, very even, slightly more movement.', when: 'Packet-level load balancers.' },
        ],
      },
    ],
    implementations: [
      { name: 'Ketama (memcached clients)', how: '100–160 points per server from MD5 of `host:port-i`, sorted continuum, binary search. Became the standard so all clients route identically.' },
      { name: 'Cassandra / Dynamo / Riak', how: 'Token ring with vnodes; replicas = next RF distinct nodes (rack/DC aware). Cassandra 4 uses 16 tokens with an allocation algorithm instead of 256 random ones to keep repairs cheap.' },
      { name: 'Envoy / NGINX `hash … consistent`', how: 'Ring-hash and Maglev load balancing for session or cache affinity; Envoy exposes `minimum_ring_size` to control evenness.' },
      { name: 'Google jump hash', how: 'Uses the key as a PRNG seed and jumps bucket indexes forward until passing N; used for sharding where buckets are fixed and numbered.' },
    ],
    ha: 'The ring is just a deterministic function of the membership list, so HA means keeping membership consistent: gossip or ZooKeeper propagate it, and every client computes the same ring. Replication to the next N distinct servers makes data survive node loss; vnodes spread the recovery work across the cluster.',
    failureModes: [
      { name: 'Uneven arcs', symptom: 'Without vnodes one server owns 2–3× the average key range and runs hot.', fix: '100+ vnodes per server, or weighted tokens.' },
      { name: 'Hot key', symptom: 'One key gets 50k req/s; consistent hashing still sends it all to one server.', fix: 'Hashing balances keys, not load: replicate or locally cache that key, add a random suffix to spread it.' },
      { name: 'Clients disagree on ring', symptom: 'Different client versions/hash seeds route the same key to different servers → misses and split data.', fix: 'Same library and config everywhere; ring version in membership.' },
    ],
    numbers: ['Add 1 server to 10: ~1/11 ≈ 9% of keys move (vs ~91% with % N)', '100–200 vnodes/server ⇒ load within ~±5–10%', 'Lookup: binary search over V tokens, ~log2(V) ≈ 10–14 comparisons', 'Jump hash: O(ln N) time, zero memory'],
    interview: [
      { q: 'Why consistent hashing instead of hash(key) % N?', a: 'With % N, changing N changes almost every key’s owner (only ~1/(N+1) stay put), which means a mass cache miss or migrating almost all data. On a ring, a new node only takes the arcs before its tokens — ~K/N keys — and a removed node’s keys go only to its successors.' },
      { q: 'What problem do virtual nodes solve?', a: 'With one token per server, arc sizes are random and very uneven, and a failed server’s whole range lands on one neighbour, possibly cascading. Many tokens per server average out arc sizes, let you weight bigger machines, and spread a failure or a join across all servers.' },
      { q: 'Ring vs jump hash vs rendezvous?', a: 'Ring: flexible membership and replica walk, O(log V) lookups. Jump: zero memory and perfect balance, but buckets are numbered and can only change at the end — good for fixed shard ids. Rendezvous: O(N) per lookup but trivially minimal movement and top-k selection — good for small node sets.' },
    ],
    lab: 'ring',
  },
  {
    kind: 'shard',
    summary:
      'A shard is one partition of a dataset: it owns a contiguous key range (or a set of hash slots) and runs as a normal database — usually a primary plus replicas, or a Raft group. It must reject requests for keys it no longer owns, and it splits or moves when it grows too big or too hot. Its main enemies are hot keys and monotonic keys.',
    parts: [
      { id: 'ownership', name: 'Ownership check', role: 'Verifies key and map version', detail: 'Each request carries the router’s shard-map version / epoch. The shard checks the key is inside its range `[user:5000, user:7500)` and rejects stale routing so the caller refreshes.' },
      { id: 'leader', name: 'Shard leader', role: 'Orders writes for its range', detail: 'One primary (Vitess: MySQL primary) or **Raft leader** (CockroachDB, TiKV) serialises writes for the range; leases let it serve consistent reads without a round of consensus.' },
      { id: 'replicas', name: 'Shard replicas', role: 'Copies across AZs for durability', detail: 'Async MySQL replicas (Vitess) or a 3/5-way Raft group where a write commits on a majority. Replicas of different shards are spread so each node leads some shards and follows others.' },
      { id: 'engine', name: 'Storage engine', role: 'Persists the range locally', detail: 'An ordinary engine — InnoDB B+tree, RocksDB/Pebble LSM — with its own WAL. Many small ranges can share one engine instance on a node.' },
      { id: 'stats', name: 'Load tracker', role: 'Measures size and QPS per range', detail: 'Tracks bytes, QPS and CPU per range (and per key sample). This drives split and rebalancing decisions.' },
      { id: 'splitter', name: 'Splitter / mover', role: 'Splits ranges, moves them between nodes', detail: 'Splits at a key in the middle of size or load (**load-based splitting**), updates the range metadata atomically, then moves replicas by snapshot + log catch-up so nodes stay balanced.' },
    ],
    flow: [
      { part: 'ownership', title: 'Ownership verified', text: 'A write for `user:6123` arrives at shard 3 (`[user:5000, user:7500)`) with map version 41 — current, so it is accepted. With version 40 it would be bounced to the router.' },
      { part: 'leader', title: 'Leader orders the write', text: 'The range’s Raft leader assigns it the next log index (or the MySQL primary takes the row lock).' },
      { part: 'replicas', title: 'Replicated', text: 'The entry is sent to 2 followers in other AZs; once a majority (2 of 3) has it on disk, it is committed.' },
      { part: 'engine', title: 'Applied locally', text: 'The committed entry is applied to the storage engine. The shard is just a normal database for its slice of keys.' },
      { part: 'stats', title: 'Hot range detected', text: 'The tracker sees the range has hit 512 MB, or that a burst sends 20k QPS to it while neighbours idle.' },
      { part: 'splitter', title: 'Split and rebalance', text: 'It splits at `user:6200` into two ranges, each with its own leader; one moves to a less loaded node by snapshot. A single hot **key** can’t be split — that needs caching or key salting.' },
    ],
    knobs: [
      {
        name: 'Partitioning',
        options: [
          { label: 'Range', effect: 'Range scans stay local; splits are natural; monotonic keys (timestamps, auto-increment) send all inserts to the last shard.', when: 'Ordered access, keys with spread-out prefixes.' },
          { label: 'Hash', effect: 'Even writes, including monotonic keys; range scans become scatter-gather.', when: 'Point lookups by id.' },
          { label: 'Compound (hash prefix + range)', effect: '`(user_id hash, created_at)`: spread across users, ordered within a user.', when: 'Per-entity timelines, chats, events.' },
        ],
      },
      {
        name: 'Split policy',
        options: [
          { label: 'Size-based', effect: 'Splits when a range exceeds X MB; keeps moves cheap.', when: 'Default (CockroachDB 512 MB, HBase ~10 GB).' },
          { label: 'Load-based', effect: 'Splits on QPS/CPU, isolating hot ranges.', when: 'Skewed traffic.' },
          { label: 'Pre-split', effect: 'Create N empty ranges up front so the first load doesn’t hit one shard.', when: 'Bulk loads, launches.' },
        ],
      },
    ],
    implementations: [
      { name: 'Vitess shard', how: 'A MySQL primary + replicas owning a keyspace-id range like `40-80`; resharding splits ranges by copying into new shards.' },
      { name: 'CockroachDB range / TiKV region', how: 'Small ranges (512 MB / ~96–256 MB) each a Raft group; automatic size- and load-based splits; a placement driver/allocator rebalances leases and replicas.' },
      { name: 'DynamoDB partition', how: 'Up to 10 GB and ~3000 RCU / 1000 WCU; split automatically when size or sustained heat exceeds limits (adaptive capacity).' },
      { name: 'Kafka partition / Redis Cluster slot', how: 'Kafka: an ordered log per partition, count fixed at creation (adding breaks key→partition). Redis: 16384 slots, migrated between nodes key by key.' },
    ],
    ha: 'Each shard is replicated independently (primary/replica with failover or a Raft group), so losing a node only affects the shards it led until their followers take over (seconds). Many small shards make failover and rebuild parallel across the cluster.',
    failureModes: [
      { name: 'Hot partition', symptom: 'One shard at 100% CPU while others idle — a celebrity, a big tenant, or `created_at` as range key.', fix: 'Hash or compound keys, load-based splitting, cache or salt hot keys.' },
      { name: 'Shard too big', symptom: 'Backups, restores and moves take hours; one failure is slow to recover.', fix: 'Split early; many small shards per node.' },
      { name: 'Cross-shard operations', symptom: 'Transactions or joins spanning shards are slow and complex.', fix: 'Co-locate related rows on the same shard key; sagas for the rest.' },
    ],
    numbers: ['CockroachDB range: 512 MB; HBase region: ~10 GB', 'DynamoDB partition: 10 GB / 3000 RCU / 1000 WCU', 'Rule of thumb: keep a shard restorable in < 1 h'],
    interview: [
      { q: 'One shard is overloaded. What are your options?', a: 'If it’s a hot range, split it and move half to another node (or let load-based splitting do it). If it’s a single hot key, splitting can’t help: cache it, replicate reads, or salt the key into N sub-keys and aggregate. Longer term, revisit the shard key.' },
      { q: 'Why are auto-increment or timestamp keys dangerous with range partitioning?', a: 'Every new insert has the largest key, so all writes go to the last range — one hot shard while the rest idle. Hash the key, prefix it with a hash/bucket, or use random/UUIDv4-style or Snowflake ids hashed for placement.' },
    ],
    lab: 'storage',
  },
  {
    kind: 'mod-hash',
    summary:
      '`hash(key) % N` maps a key to one of N servers with one multiplication-and-divide: perfectly even and stateless. The trap is that the owner depends on N itself — add or lose one server and about N/(N+1) of all keys change owner at once, turning scale-out into a cache wipe or a full data migration. The fix is a fixed number of slots or consistent hashing.',
    parts: [
      { id: 'key', name: 'Key extraction', role: 'Picks the routing key', detail: 'The client or proxy takes the routing key (`user:42`, a cache key, a Kafka message key).' },
      { id: 'hash', name: 'Hash function', role: 'Key → large integer', detail: 'A fast hash (CRC32, Murmur2/3, FNV) turns the key into a 32/64-bit integer. A weak hash (or `String.hashCode` with power-of-two N) gives skew.' },
      { id: 'modulo', name: 'Modulo N', role: 'Integer → server index', detail: '`idx = h % N`, where N is the **current** number of servers. This single dependency on N is the whole problem.' },
      { id: 'list', name: 'Server list', role: 'Index → host address', detail: 'An ordered array `[cache-a, cache-b, cache-c, cache-d]` in client config. If a dead server is removed from the array, N changes and every index shifts.' },
      { id: 'node', name: 'Target node', role: 'Serves or stores the key', detail: 'The chosen server. For a cache, a wrong choice = a miss; for a database shard, a wrong choice = data not found until it is migrated.' },
    ],
    flow: [
      { part: 'key', title: 'Key chosen', text: 'The app wants `user:42`’s profile from the cache cluster.' },
      { part: 'hash', title: 'Hashed', text: '`crc32("user:42")` = 9,812,345.' },
      { part: 'modulo', title: 'Modulo 4', text: '9,812,345 % 4 = 1.' },
      { part: 'list', title: 'Index resolved', text: '`servers[1]` = cache-b → cache hit. Distribution across the 4 servers is perfectly even.' },
      { part: 'modulo', title: 'A 5th server is added', text: 'Now 9,812,345 % 5 = 0 → cache-a, which doesn’t have it. A key stays put only if `h % 4 == h % 5`: about **1 in 5** keys. ~80% of the cache misses at once.' },
      { part: 'node', title: 'The database melts', text: 'All those misses hit the DB at the same moment — a self-inflicted stampede during the very scale-out meant to add capacity. For DB shards it would mean moving ~80% of all rows.' },
    ],
    knobs: [
      {
        name: 'How N is used',
        options: [
          { label: '% number of servers', effect: 'Any membership change remaps ~N/(N+1) of keys.', when: 'Only when N truly never changes (and servers never fail out).' },
          { label: '% fixed number of slots, slot → server map', effect: 'Keys never change slot; scaling moves whole slots, only those whose owner changes (Redis Cluster: CRC16 % 16384).', when: 'The standard fix for sharding.' },
          { label: 'Consistent / jump / rendezvous hashing', effect: 'Adding a node moves only ~K/N keys.', when: 'Elastic caches and stores.' },
        ],
      },
      {
        name: 'Handling a dead server',
        options: [
          { label: 'Remove it from the list', effect: 'N shrinks → nearly every key remaps.', when: 'Never with % N.' },
          { label: 'Keep slot, fail over to replica', effect: 'Indexes stay stable; only that server’s keys are affected.', when: 'Always.' },
        ],
      },
    ],
    implementations: [
      { name: 'Early memcached clients', how: 'PHP/Java clients defaulted to `hash % N` ("standard" strategy); adding a server wiped most of the cache, which is why **ketama** consistent hashing was invented and became the default.' },
      { name: 'Kafka default partitioner', how: '`murmur2(key) % numPartitions` — fine because partition count is fixed. Adding partitions later silently breaks per-key ordering and co-location.' },
      { name: 'Elasticsearch routing', how: '`shard = hash(_routing) % number_of_primary_shards` — the reason primary shard count can’t change in place; `_split` only multiplies it by a factor so keys map predictably.' },
      { name: 'Redis Cluster (the fix)', how: 'Modulo over a **fixed** 16384 slots, then a slot table to nodes. Resharding migrates individual slots; keys never change slot.' },
    ],
    ha: 'Simple and stateless, so the router itself is trivially replicated — but the scheme makes the *backends* fragile: every membership change is a mass remap. Avoid removing failed nodes from the list; promote replicas into the same index instead.',
    failureModes: [
      { name: 'Scale-out stampede', symptom: 'Adding 1 cache node to 4 drops the hit rate from 95% to ~20%; DB CPU pegs.', fix: 'Consistent hashing or fixed slots; warm new nodes before switching.' },
      { name: 'Failure reshuffle', symptom: 'One node dies, the client drops it from the list, and the whole cluster’s mapping changes.', fix: 'Replace in place or fail over to a replica; never shrink N on failure.' },
      { name: 'Silent repartitioning', symptom: 'Raising Kafka partitions or ES shards sends existing keys to new places; ordering and lookups break.', fix: 'Over-provision partitions/slots up front.' },
    ],
    numbers: ['N → N+1 moves N/(N+1) of keys: 4→5 = 80%, 10→11 ≈ 91%, 100→101 ≈ 99%', 'Consistent hashing for 10→11 moves ≈ 9%', 'Redis Cluster: 16384 fixed slots'],
    interview: [
      { q: 'What’s wrong with sharding by hash(key) % N?', a: 'The owner depends on N, so changing N (scale-out, scale-in or removing a dead node) remaps almost every key: ~N/(N+1). For a cache that is a mass miss and DB stampede; for a database it means migrating nearly all data. Use consistent hashing or a fixed number of logical slots mapped to servers.' },
      { q: 'Redis Cluster also uses modulo. Why is it fine there?', a: 'It takes modulo over a fixed 16384 slots, not over servers. A key’s slot never changes; scaling reassigns some slots to new nodes and migrates only those keys. The extra slot→node table is what decouples key placement from cluster size.' },
    ],
    lab: 'ring',
  },
  {
    kind: 'multi-master',
    summary:
      'Multi-master (multi-leader) replication lets every node accept writes, commit them locally and replicate them to the others asynchronously. It sounds like “write scaling + no failover”, but two nodes can change the same row concurrently and both succeed, so the system needs conflict resolution — usually last-writer-wins, which silently discards one of them. Uniqueness, counters and invariants break. For most designs, prefer a single leader per piece of data.',
    parts: [
      { id: 'accept', name: 'Local write', role: 'Any node accepts the write', detail: 'Clients write to their nearest node (often per region). The node runs the transaction against **its own** data and locks only local rows — no coordination with other leaders.' },
      { id: 'commit', name: 'Local commit', role: 'Acks before others know', detail: 'The transaction commits and is acknowledged locally. Constraints (`UNIQUE`, `CHECK balance >= 0`) are checked only against local state.' },
      { id: 'capture', name: 'Change capture', role: 'Records row changes with metadata', detail: 'Changes are captured from the binlog/WAL (logical replication) with origin node id and a timestamp or version vector so loops are suppressed and conflicts can be detected.' },
      { id: 'ship', name: 'Async shipping', role: 'Sends changes to other leaders', detail: 'All-to-all, ring or star topologies push changes to peers, typically 100 ms–seconds later across regions; a broken link in a ring topology stalls everyone downstream.' },
      { id: 'detect', name: 'Conflict detection', role: 'Spots concurrent changes to same row', detail: 'On apply, the incoming row version is compared with the local one: if the local row also changed since the common ancestor, it is a **conflict**.' },
      { id: 'resolve', name: 'Conflict resolution', role: 'Picks or merges a winner', detail: '**LWW** by timestamp (clock skew decides!), origin-priority, custom merge handlers, or **CRDTs** whose merges are commutative so no write is lost.' },
    ],
    flow: [
      { part: 'accept', title: 'Two writes, two regions', text: 'Stock for item X is 10. A buyer in the EU writes to node A, another in the US writes to node B, within the same 100 ms.' },
      { part: 'commit', title: 'Both commit locally', text: 'A sets stock = 9, B sets stock = 9. Both checks `stock > 0` pass and both customers get “order confirmed”.' },
      { part: 'capture', title: 'Changes captured', text: 'Each node logs `item X: stock 10 → 9` with its origin and timestamp.' },
      { part: 'ship', title: 'Shipped across regions', text: '~120 ms later each change arrives at the other node.' },
      { part: 'detect', title: 'Conflict detected', text: 'Node A receives B’s update for a row it also changed since version 10 → concurrent modification.' },
      { part: 'resolve', title: 'LWW loses an update', text: 'LWW picks the later timestamp: final stock = 9, though two units were sold — one decrement silently **lost**. Two users registering the username `alice` on different nodes end up with a duplicate. Nobody gets an error.' },
    ],
    knobs: [
      {
        name: 'Conflict handling',
        options: [
          { label: 'Last-writer-wins', effect: 'Simple, always converges; silently drops concurrent writes; clock skew picks the “winner”.', when: 'Only for data where losing an overwrite is fine (last-seen time, preferences).' },
          { label: 'CRDTs', effect: 'Counters, sets, registers that merge without loss (PN-counter: per-node increments summed).', when: 'Collaborative/offline data, counters, carts.' },
          { label: 'Avoid conflicts: home region per record', effect: 'Each user/tenant’s writes go to one leader; effectively sharded single-leader.', when: 'The usual right answer for geo-distributed apps.' },
        ],
      },
      {
        name: 'Synchrony',
        options: [
          { label: 'Async multi-leader', effect: 'Low latency, available during partitions, conflicts after the fact.', when: 'Offline-first clients, multi-region with conflict-free data.' },
          { label: 'Certification (Galera / Group Replication)', effect: 'Writes certified cluster-wide at commit; conflicting transactions abort — no silent loss, but commit waits for the group and hot rows cause abort storms.', when: 'HA within one region, writing mostly to one node.' },
          { label: 'Consensus (Spanner, CockroachDB)', effect: 'Every key has one Raft/Paxos leader; serializable everywhere, writes pay quorum latency.', when: 'Global data needing correctness.' },
        ],
      },
    ],
    implementations: [
      { name: 'Galera / MySQL Group Replication', how: 'Virtually synchronous: a write-set is broadcast at commit and certified in the same order on all nodes; the first committer wins, others get deadlock errors. Throughput limited by the slowest node.' },
      { name: 'Postgres BDR / pgEdge, MySQL circular replication', how: 'Async logical replication between leaders with LWW or custom handlers; offset sequences (`auto_increment_increment`/`offset`) to avoid id collisions.' },
      { name: 'DynamoDB Global Tables, Cassandra multi-DC', how: 'Every region writable; replicated asynchronously; conflicts resolved by last-writer-wins on timestamps.' },
      { name: 'CouchDB / Riak / Automerge', how: 'Keep conflicting revisions (revision trees, siblings) and let the app merge, or use CRDTs so merges are automatic.' },
    ],
    ha: 'Its pitch is HA: any node can take writes, so losing one needs no failover. The price is that after a partition the nodes have diverged and must reconcile, and correctness depends on clocks and resolution rules. Single-leader with fast automatic failover, or consensus-based stores, give HA without silent conflicts.',
    failureModes: [
      { name: 'Lost updates', symptom: 'Counters, balances and inventory drift; concurrent edits disappear without errors.', fix: 'Single leader per record, CRDT counters, or a consensus store.' },
      { name: 'Broken invariants', symptom: 'Duplicate usernames, overbooked seats, negative balances — each node checked the constraint locally.', fix: 'Route uniqueness/invariant checks to one owner (home region) or use serializable consensus.' },
      { name: 'Clock skew', symptom: 'A node with a fast clock always “wins” LWW, overwriting newer writes.', fix: 'Hybrid logical clocks, version vectors, avoid LWW for important data.' },
      { name: 'Replication topology breaks', symptom: 'A node in a ring dies and changes stop flowing; or infinite loops of the same change.', fix: 'All-to-all topology, origin tracking, monitoring of apply lag.' },
    ],
    numbers: ['Cross-region replication delay: ~100 ms–seconds ⇒ the conflict window', 'Galera commit: +1 group round trip; throughput ≈ slowest node', 'Clock skew with NTP: typically 1–100 ms ⇒ LWW order is a coin flip for close writes'],
    interview: [
      { q: 'Why is multi-master SQL usually a trap?', a: 'Each node accepts writes against its own state and replicates later, so concurrent writes to the same data both succeed and must be resolved afterwards — typically LWW, which silently drops one. Constraints are only checked locally, so uniqueness and balances break. It also doesn’t scale write throughput much, because every node must still apply every write.' },
      { q: 'You need writes in several regions. What do you do instead?', a: 'Give each record a home region (shard by user/tenant) so each piece of data has a single leader and writes go there — low latency for most users, no conflicts. If data really is global and must be correct, use a consensus-based database (Spanner, CockroachDB) and pay quorum latency. Reserve multi-leader for data that merges cleanly (CRDTs).' },
      { q: 'When is multi-leader actually appropriate?', a: 'When conflicts are rare or mergeable: offline-first apps (each device is a leader), collaborative editing with CRDTs/OT, or multi-region data like “last seen” where LWW is acceptable.' },
    ],
  },
  {
    kind: 'bloom',
    summary:
      'A Bloom filter is a bit array of m bits plus k hash functions. Adding a key sets k bits; a lookup checks those k bits — if any is 0 the key was **definitely never added**, if all are 1 it is **probably** present. It never gives false negatives, uses ~10 bits per key for a 1% false-positive rate regardless of key size, and is used to skip expensive lookups that would find nothing.',
    parts: [
      { id: 'hasher', name: 'Hash functions', role: 'Key → k independent hashes', detail: 'Instead of k separate hashes, real implementations compute two (e.g. 128-bit Murmur3 split into h1, h2) and derive `g_i = h1 + i·h2` (Kirsch–Mitzenmacher) — same accuracy, one hash computation.' },
      { id: 'indexer', name: 'Bit indexer', role: 'Hashes → k bit positions', detail: 'Each `g_i mod m` picks a bit. **Blocked** Bloom filters keep all k bits inside one 64-byte cache line, so a lookup costs a single cache miss (RocksDB, Parquet).' },
      { id: 'bits', name: 'Bit array', role: 'm bits shared by all keys', detail: 'A plain `long[]`; bits are only ever set, never cleared. Sized from n (expected keys) and target FP rate: m = −n·ln p / (ln 2)², optimal k = (m/n)·ln 2.' },
      { id: 'check', name: 'Membership test', role: 'All k bits set → maybe', detail: 'Any 0 bit → **definitely absent**, return immediately. All 1s → maybe present, with probability of a false positive ≈ (1 − e^(−kn/m))^k.' },
      { id: 'store', name: 'Backing store', role: 'Authoritative lookup on “maybe”', detail: 'The filter is only a guard: on “maybe” the caller still does the real lookup (SSTable read, DB query, remote call) and accepts that ~p of these were wasted.' },
    ],
    flow: [
      { part: 'hasher', title: 'Add “alice”', text: 'Murmur3 gives h1, h2; with k = 7 we derive 7 hashes.' },
      { part: 'indexer', title: 'Pick 7 positions', text: 'Positions 12, 907, 3,311, 40,102, 51,888, 77,004, 95,210 in a 100,000-bit array (sized for 10,000 keys at 1%).' },
      { part: 'bits', title: 'Set the bits', text: 'Those 7 bits become 1. Nothing records which key set them — that is why the filter is tiny and why you can’t delete.' },
      { part: 'check', title: 'Lookup “bob” → no', text: '“bob” maps to 7 positions; position 18,420 is 0, so bob was **never added**. The disk read for this SSTable is skipped entirely.' },
      { part: 'check', title: 'Lookup “carol” → maybe', text: 'All 7 of carol’s bits happen to be set by other keys. The filter says “maybe” — a false positive (~1% of absent keys).' },
      { part: 'store', title: 'Fall through to storage', text: 'The real lookup reads the SSTable index and finds nothing. Cost: one wasted read, which is the price for skipping 99% of them.' },
    ],
    knobs: [
      {
        name: 'Bits per key (m/n)',
        options: [
          { label: '~5 bits, k = 3', effect: '~10% false positives.', when: 'Memory-starved, cheap fallback.' },
          { label: '~10 bits, k = 7', effect: '~1% false positives — the common default.', when: 'LSM stores, caches, crawlers.' },
          { label: '~15 bits, k = 10', effect: '~0.1% false positives; every ~4.8 bits/key buys another 10× fewer FPs.', when: 'Fallback is a slow network or disk call.' },
        ],
      },
      {
        name: 'Variant',
        options: [
          { label: 'Standard', effect: 'Insert and test only; no deletes; FP rate climbs past design n.', when: 'Immutable sets (SSTables, snapshots).' },
          { label: 'Counting Bloom', effect: '4-bit counters instead of bits → supports delete at 4× memory.', when: 'Sets with removals.' },
          { label: 'Cuckoo / Ribbon / XOR filter', effect: 'Cuckoo: deletes and better space below ~3% FP; Ribbon/XOR: ~30% smaller but built once from a static set.', when: 'Dynamic sets (cuckoo); static files (ribbon in RocksDB).' },
          { label: 'Scalable Bloom', effect: 'Chains filters of growing size as n grows, keeping total FP bounded.', when: 'Unknown final size.' },
        ],
      },
    ],
    implementations: [
      { name: 'Cassandra / HBase / Bigtable', how: 'One filter per SSTable/HFile kept in memory (Cassandra off-heap, `bloom_filter_fp_chance` 0.01 default). A read checks the filter before touching each file, so most files are skipped.' },
      { name: 'RocksDB', how: 'Per-file full filter, 10 bits/key default, cache-line-blocked; optional **Ribbon** filter saves ~30% memory; prefix blooms for range-prefix seeks.' },
      { name: 'CDNs (Akamai)', how: '“Cache on second hit”: a Bloom filter remembers URLs seen once; only URLs requested again are cached, keeping one-hit wonders (~75% of objects) out of cache.' },
      { name: 'RedisBloom, Guava BloomFilter', how: '`BF.ADD` / `BF.EXISTS` with scalable filters in Redis; Guava’s `BloomFilter.create(funnel, n, fpp)` sizes m and k from n and p.' },
    ],
    ha: 'A Bloom filter is derived data: it can always be rebuilt from the source set, so it is persisted alongside the data it guards (in the SSTable file) or periodically rebuilt. Being probabilistic, it fails *safe* only one way — it may waste a lookup, never hide existing data.',
    failureModes: [
      { name: 'Overfilled filter', symptom: 'Sized for 1M keys, holding 10M: FP rate approaches 100% and every lookup falls through.', fix: 'Size for peak n with headroom, rebuild larger, or use scalable filters.' },
      { name: '“Maybe” treated as yes', symptom: 'Usernames rejected as “taken” or URLs skipped as “already crawled” that were never seen.', fix: 'Always confirm a “maybe” against the source of truth when correctness matters.' },
      { name: 'Trying to delete', symptom: 'Clearing bits of a removed key creates false **negatives** for other keys.', fix: 'Counting Bloom or cuckoo filter, or rebuild periodically.' },
    ],
    numbers: ['FP ≈ (1 − e^(−kn/m))^k; optimal k = (m/n)·ln 2', '1% FP ≈ 9.6 bits/key, k = 7; 0.1% ≈ 14.4 bits/key, k = 10', '1B keys at 1% ≈ 1.2 GB (vs ~50+ GB to store the keys)', 'Lookup: k bit reads, ~1 cache miss if blocked'],
    interview: [
      { q: 'Your crawler must not revisit 1B URLs. How big is a Bloom filter and what are the trade-offs?', a: 'At 1% FP: ~9.6 bits/key × 1B ≈ 1.2 GB with k = 7 — fits in RAM, versus tens of GB for the URLs. False positives mean ~1% of new URLs are wrongly skipped; acceptable for crawling. If not, confirm “maybe” against a URL store, or lower p (each extra ~4.8 bits/key cuts FPs 10×).' },
      { q: 'Why can a Bloom filter have false positives but never false negatives?', a: 'Adding only sets bits and nothing ever clears them, so every bit of an added key stays 1 → it always tests positive. A non-member can test positive only if other keys happened to set all of its k bits.' },
      { q: 'How do LSM databases use Bloom filters?', a: 'A read for a key may have to check many SSTables. Each SSTable has an in-memory filter over its keys; the read only opens files whose filter says “maybe”, cutting disk reads for absent keys by ~99% at 10 bits/key.' },
    ],
    lab: 'bloom',
  },
  {
    kind: 'idem-store',
    summary:
      'An idempotency store makes a non-idempotent operation (charge a card, create an order) safe to retry. The client sends a unique `Idempotency-Key`; the server atomically claims the key, runs the operation once, and stores the response so every retry with the same key gets the same response instead of a second side effect. It is a small table: key → (request fingerprint, status, response) with a TTL.',
    parts: [
      { id: 'header', name: 'Key extractor', role: 'Reads client Idempotency-Key header', detail: 'The client generates a random key (UUIDv4) **per logical operation** and reuses it on every retry. The server scopes it by account + endpoint so keys from different users can’t collide.' },
      { id: 'fingerprint', name: 'Fingerprint', role: 'Hashes the request parameters', detail: '`sha256(method + path + canonical body)` stored with the key. A retry with the same key but different parameters is a client bug → reject with 422 instead of replaying an unrelated response.' },
      { id: 'claim', name: 'Atomic claim', role: 'Insert-if-absent, exactly one wins', detail: '`INSERT … ON CONFLICT DO NOTHING` on a unique `(account, key)` constraint, or Redis `SET key v NX EX 86400`. Never GET-then-SET: two concurrent requests would both see “absent”.' },
      { id: 'execute', name: 'Executor', role: 'Runs the side effect once', detail: 'Holds the key in state `started` (with `locked_at`) while it works. Local DB effects run in the **same transaction** as the key update; external calls pass the key downstream (e.g. to the payment processor) so they are idempotent too.' },
      { id: 'record', name: 'Response record', role: 'Saves status code and body', detail: 'Stores `status=completed`, HTTP code and response body. Deterministic errors are saved too, so retries see the same outcome; rows expire after a TTL (Stripe: 24 h).' },
      { id: 'replay', name: 'Replay', role: 'Returns stored response on retry', detail: 'A retry whose claim fails loads the row: completed + same fingerprint → return the saved response verbatim; still `started` → 409 “in progress, retry later”; fingerprint mismatch → 422.' },
    ],
    flow: [
      { part: 'header', title: 'Request with key', text: '`POST /v1/charges` with `Idempotency-Key: 7c1e…` for $50.' },
      { part: 'fingerprint', title: 'Fingerprint computed', text: '`sha256` of the canonical body → `a91f…`, stored with the key.' },
      { part: 'claim', title: 'Key claimed atomically', text: '`INSERT INTO idem_keys (account, key, fp, status) VALUES (…, "started")` succeeds — this request owns the operation. A concurrent duplicate hits the unique constraint.' },
      { part: 'execute', title: 'Charge executed once', text: 'The card is charged, passing the key to the processor. The charge row and the key update commit in one DB transaction (Stripe calls these **atomic phases**, with recovery points between external calls).' },
      { part: 'record', title: 'Response stored', text: 'Status `completed`, `200` and the charge JSON are saved. The response is sent — and lost to a network timeout before the client reads it.' },
      { part: 'replay', title: 'Retry replays', text: 'The client retries with the same key. The claim conflicts, the row is `completed` with matching fingerprint, so the stored 200 is returned. One charge, despite two requests.' },
    ],
    knobs: [
      {
        name: 'Where keys live',
        options: [
          { label: 'Same SQL DB as the data', effect: 'Key state and side effect commit atomically — no window where one exists without the other.', when: 'Default when the operation writes to that DB.' },
          { label: 'Redis `SET NX EX`', effect: 'Fast, TTL built-in; not atomic with the DB write and async replication can lose a key on failover.', when: 'High-volume dedup where a rare duplicate is tolerable or the downstream is idempotent too.' },
        ],
      },
      {
        name: 'Stuck in-progress keys',
        options: [
          { label: '409 until TTL', effect: 'Safe but the client is blocked if the server crashed mid-operation.', when: 'Short operations.' },
          { label: 'Lock timeout + recovery', effect: 'After `locked_at` + N s a retry resumes from the last recovery point (or a reaper completes/rolls back).', when: 'Multi-step operations with external calls.' },
        ],
      },
      {
        name: 'Retention (TTL)',
        options: [
          { label: 'Hours', effect: 'Small table; retries after expiry execute again.', when: 'Clients retry only within seconds/minutes.' },
          { label: '24 h – days', effect: 'Covers long retry/backoff and offline queues; more storage.', when: 'Payments and public APIs (Stripe: 24 h).' },
        ],
      },
    ],
    implementations: [
      { name: 'Stripe API', how: '`Idempotency-Key` header on POSTs; stores code + body of the first result (even 500s), errors if parameters differ, 409 on concurrent use, prunes keys after 24 h.' },
      { name: 'AWS ClientToken', how: 'EC2 `RunInstances` and others accept a client token; a repeat with the same token returns the original result instead of launching more instances.' },
      { name: 'Kafka idempotent producer', how: 'Same idea at the protocol level: producer id + per-partition sequence number; the broker drops duplicates from retries.' },
      { name: 'Consumer dedup tables', how: 'Event consumers store processed message ids in a unique-keyed table inside the same transaction as their side effect — the “inbox” pattern for at-least-once delivery.' },
    ],
    ha: 'The store must be at least as durable as the side effect it protects, so it usually lives in the primary database (replicated, same transaction). A Redis-based store should use AOF + replicas and accept that a failover can forget the newest keys. Partition keys by account so the table shards with the data.',
    failureModes: [
      { name: 'Check-then-act race', symptom: 'Two retries arrive together, both `GET` → absent, both charge the card.', fix: 'Atomic insert-if-absent (unique constraint or `SET NX`), never a separate check.' },
      { name: 'Crash between effect and record', symptom: 'The charge happened but the key is stuck at `started`; a retry either blocks forever or charges again.', fix: 'Commit effect + key in one transaction; pass the key to external services; recovery points and lock timeouts.' },
      { name: 'Key generated per attempt', symptom: 'Client makes a new UUID on each retry, so nothing is deduplicated.', fix: 'Generate the key once per logical operation and persist it client-side before the first attempt.' },
      { name: 'TTL shorter than retries', symptom: 'A queued retry after 2 days executes as a new charge.', fix: 'TTL > maximum retry horizon; reject stale requests by timestamp.' },
    ],
    numbers: ['Typical TTL: 24 h (Stripe)', 'Storage: 1M requests/day × ~1 KB ≈ 1 GB/day of keys', 'Overhead: one indexed insert + one update per request (~1 ms)', 'UUIDv4: 122 random bits ⇒ collisions practically impossible'],
    interview: [
      { q: 'Design a payment API that never double-charges when clients retry.', a: 'Require an `Idempotency-Key` per payment. Atomically insert (account, key, request hash, status=started) under a unique constraint; the winner executes the charge, passing the key to the processor, and stores status + response in the same transaction. Retries load the row: return the stored response if completed, 409 if still in progress, 422 if the parameters differ. Expire keys after 24 h.' },
      { q: 'Why not just check whether the key exists before processing?', a: 'GET-then-INSERT is a race: two concurrent retries both see “absent” and both execute. The check and the claim must be one atomic operation — a unique constraint violation or `SET NX` — so exactly one request wins.' },
      { q: 'What if the server crashes after charging but before saving the response?', a: 'Avoid the gap by committing local effects and the key record in one transaction, and make external calls idempotent by forwarding the key. For multi-step flows store recovery points so a retry (after a lock timeout) resumes from the last completed step instead of redoing it.' },
    ],
  },
];
