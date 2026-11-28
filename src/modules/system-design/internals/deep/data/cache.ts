import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'cache',
  problem: {
    why:
      'A database read costs 1–10 ms and a fixed slice of a scarce resource (connections, buffer pool, IOPS); a RAM lookup over the network costs ~0.3 ms and scales out cheaply. Read traffic is heavily skewed — a few percent of keys take most reads — so a shared in-memory tier in front of the DB absorbs 90–99% of reads. The price is a second copy of the data that can be stale, cold or missing, and every hard problem of caching follows from that.',
    withoutIt: [
      'Every read hits the DB, so read QPS is capped by the primary plus replicas, and p99 follows the DB’s worst query plan.',
      'Hot rows (a celebrity profile, a flash-sale item) serialize on one DB page and its locks while the rest of the cluster idles.',
      'Expensive derived results (feeds, aggregates, rendered fragments) are recomputed on every request instead of once per TTL.',
      'Shared ephemeral state (sessions, rate-limit counters, leaderboards, locks) has no fast, atomic home that all app servers can see.',
    ],
    position:
      'Between stateless app servers and the database, called by the app (cache-aside) over a pooled TCP connection; it never talks to the DB itself unless you add a read-through layer. Writers invalidate it; readers fill it.',
    diagram: {
      type: 'flow',
      title: 'Cache-aside read path',
      nodes: [
        { label: 'App server', sub: 'GET user:42', tone: 'neutral' },
        { label: 'Redis shard', sub: 'hit ≈ 0.3 ms', tone: 'ok' },
        { label: 'Miss', sub: '1–5% of reads', tone: 'warn' },
        { label: 'Database', sub: 'query 2–10 ms', tone: 'info' },
        { label: 'SET with TTL', sub: 'refill + jitter', tone: 'accent' },
      ],
      caption: 'DB load = (1 − hit ratio) × read QPS: going from 99% to 98% hit ratio doubles DB reads.',
    },
  },
  architecture: {
    overview:
      'Redis is an in-memory dictionary behind a single-threaded command executor. One `ae` event loop (`epoll` on Linux, `kqueue` on BSD/macOS) multiplexes thousands of sockets; every command runs to completion with no locks, so each command is atomic and the CPU cost per op is ~1–5 µs. Values are typed objects whose encoding switches from compact (listpack, intset, embstr) to pointer-rich (hashtable, skiplist) as they grow. Durability (RDB/AOF), replication and clustering are layered around that core and are all asynchronous by default.',
    diagram: {
      type: 'layers',
      title: 'Inside one Redis node',
      layers: [
        { name: 'Network', items: ['RESP2/RESP3 parser', 'io-threads (6+)', 'Client output buffers'], tone: 'info' },
        { name: 'Executor (1 thread)', items: ['ae event loop', 'Command table', 'Lua / Functions', 'maxmemory check'], tone: 'accent' },
        { name: 'Keyspace', items: ['main dict', 'expires dict', 'incremental rehash', 'eviction pool'], tone: 'ok' },
        { name: 'Values', items: ['SDS strings', 'quicklist / listpack', 'intset', 'skiplist + dict'], tone: 'violet' },
        { name: 'Background', items: ['fork → RDB / AOF rewrite', 'bio: fsync, lazyfree', 'Replication stream'], tone: 'neutral' },
      ],
      caption: 'Only the executor touches data; everything slow is pushed to a forked child or a bio thread.',
    },
    blocks: [
      { name: 'ae event loop', what: 'Single thread waits on `epoll_wait`, reads query buffers, executes commands, queues replies. Timer events run `serverCron` (`hz` 10 by default) for expiry, rehash, stats and client timeouts.' },
      { name: 'I/O threads', what: 'Since Redis 6, `io-threads N` offloads socket writes (and reads/parsing with `io-threads-do-reads yes`) to helper threads; execution stays single-threaded. Valkey 8 reworked this to reach ~1M requests/s on a single instance.' },
      { name: 'RESP protocol', what: 'Length-prefixed text protocol: `*3\\r\\n$3\\r\\nSET\\r\\n...`. Cheap to parse, pipelining-friendly; RESP3 (`HELLO 3`) adds typed replies and out-of-band push messages used by client-side caching.' },
      { name: 'Keyspace dict', what: 'Chained hash table of `dictEntry` → key SDS + `robj` value, plus a separate `expires` dict of key → absolute ms timestamp. Grows by **incremental rehash**: two tables coexist and every operation (plus a cron slice) moves a few buckets.' },
      { name: 'Object encodings', what: 'Each `robj` has a type and an encoding: strings as `int`/`embstr` (≤ 44 bytes)/`raw`; small hashes, sets and sorted sets as a flat `listpack`; integer sets as `intset`; big sorted sets as **skiplist + dict**.' },
      { name: 'Eviction pool', what: 'A 16-entry pool of best eviction candidates refilled by sampling `maxmemory-samples` keys per round; the 24-bit `lru` field in each object holds either an LRU clock or an LFU counter + decay timestamp.' },
      { name: 'Persistence', what: 'RDB: `fork()` and the child serializes a point-in-time snapshot while copy-on-write isolates it. AOF: every write appended and `fsync`ed per `appendfsync`; Redis 7 uses multi-part AOF (base RDB + incremental files + manifest).' },
      { name: 'Replication & cluster bus', what: 'Async command stream to replicas with a ring-buffer backlog for `PSYNC`; in Cluster mode a second port (+10000) runs a binary gossip bus for failure detection and slot ownership.' },
    ],
    real: [
      { name: 'Redis / Valkey', how: 'The reference design above. Valkey is the Linux Foundation fork created after Redis’s 2024 license change; protocol-compatible, used by ElastiCache and Memorystore. Scale by sharding (Cluster) one process per core.' },
      { name: 'Memcached', how: 'Multi-threaded (libevent loop per worker thread, `-t 4` default), strings only, no persistence or replication. Memory managed by a **slab allocator** with 1 MB pages split into size classes (growth factor `-f 1.25`); segmented HOT/WARM/COLD LRU per class since 1.5.' },
      { name: 'Meta mcrouter + Memcached', how: 'Memcached fleets fronted by mcrouter (consistent-hash routing, replicated pools, failover to a **gutter pool**). Invalidations come from **McSqueal** tailing the MySQL commit log; **leases** stop stampedes and stale sets.' },
      { name: 'Dragonfly', how: 'Redis/Memcached-compatible, multi-threaded shared-nothing: each thread owns a shard of the keyspace in a `dashtable`, cross-shard ops coordinate via a lock-free transaction framework, snapshots without `fork()`.' },
      { name: 'Amazon MemoryDB / ElastiCache', how: 'ElastiCache is managed Redis/Valkey/Memcached with Multi-AZ failover. MemoryDB keeps the Redis API but commits writes to a multi-AZ transaction log before acking, trading write latency (single-digit ms) for durability.' },
    ],
  },
  lifecycle: {
    summary:
      'One cache-aside read of `user:42` against Redis Cluster in the same AZ: a hit is ~0.3–0.5 ms end-to-end, dominated by the network round trip, not by Redis. A miss adds the DB query plus a refill write.',
    stages: [
      { stage: 'Key → slot → node', what: 'Client computes `CRC16(key) mod 16384`, finds the owning primary in its cached slot map.', cost: 'Pure CPU in the client', ms: 0.001, part: 'client' },
      { stage: 'Connection checkout', what: 'Borrow a pooled (or multiplexed, e.g. Lettuce) connection; serialize the command to RESP.', cost: 'Pool contention is the hidden cost under load', ms: 0.01 },
      { stage: 'Network to Redis', what: 'One request packet over the same-AZ network (cross-AZ adds ~0.3–1 ms round trip).', cost: 'Half of an in-AZ RTT', ms: 0.12 },
      { stage: 'Read + parse', what: 'Event loop (or an I/O thread) reads the socket and parses RESP into argv.', cost: 'Syscall + parse', ms: 0.005, part: 'loop' },
      { stage: 'Execute', what: 'dict lookup, check `expires` (lazy expiry), touch LRU/LFU bits, build reply. Queued behind any slow command ahead of it.', cost: 'O(1) ~1–2 µs; unbounded behind a `KEYS *`', ms: 0.002, part: 'keyspace' },
      { stage: 'Reply to client', what: 'Reply buffered then written back in the next loop iteration (or by an I/O thread).', cost: 'Half an RTT', ms: 0.12 },
      { stage: 'Deserialize', what: 'Client decodes bytes into an object (JSON/Protobuf); large values make this dominate.', cost: '~10–100 µs for a few KB of JSON', ms: 0.05 },
      { stage: 'Miss: DB query', what: 'Only on a miss (1–5% of reads): primary-key lookup on a replica.', cost: 'Indexed read 1–10 ms', ms: 4 },
      { stage: 'Miss: refill SET', what: '`SET user:42 <v> EX 3600±jitter` (ideally guarded by a lease/lock against stampedes).', cost: 'Another round trip', ms: 0.3 },
    ],
  },
  deepDives: [
    {
      title: 'Single thread, I/O threads and why one slow command hurts everyone',
      hook: 'Redis is fast because it is single-threaded — and fragile for exactly the same reason.',
      body: [
        'The executor processes one command at a time, so `INCR`, `SETNX` and a Lua script are atomic without locks, and the per-command cost is a few µs. A single instance does ~100k–200k simple ops/s without pipelining; the limit is syscalls and network packets, which is why **pipelining** (many commands per round trip) pushes it past 1M ops/s.',
        'The flip side: any O(N) command blocks every other client. `KEYS *` on 50M keys, `HGETALL` on a 2M-field hash, `DEL` of a huge set, `SMEMBERS`, an unbounded `ZRANGE`, or a long Lua script all stall the loop for hundreds of ms — and in Cluster, a node stalled past `cluster-node-timeout` can be failed over by its peers.',
        'Redis 6 `io-threads` parallelize socket reads/writes, not execution; they help when you are network-bound with many clients, not when one command is slow. To use more cores you run more shards (one process per core), or a multi-threaded engine like Dragonfly.',
      ],
      bullets: [
        'Use `SCAN`/`HSCAN`/`SSCAN` cursors instead of `KEYS`/`HGETALL` on unbounded collections.',
        '`UNLINK` (and `lazyfree-lazy-*` options) frees big values on a bio thread instead of the main loop.',
        '`SLOWLOG GET`, `LATENCY DOCTOR` and `INFO commandstats` (`usec_per_call`) find the offenders.',
        'Rename or ACL-deny `KEYS`, `FLUSHALL` and `DEBUG` in production.',
      ],
      diagram: {
        type: 'flow',
        title: 'One loop iteration',
        nodes: [
          { label: 'epoll_wait', sub: 'ready sockets', tone: 'info' },
          { label: 'Read + parse', sub: 'io-threads optional', tone: 'neutral' },
          { label: 'Execute commands', sub: 'one thread, atomic', tone: 'accent' },
          { label: 'Write replies', sub: 'io-threads optional', tone: 'neutral' },
          { label: 'serverCron', sub: 'expiry, rehash, stats', tone: 'violet' },
        ],
        caption: 'A 300 ms command in the middle box is 300 ms of added latency for every connected client.',
      },
      insight:
        'Redis p99 is usually set by the worst command anyone runs on that shard, not by the average. Treat O(N) commands like table scans in a DB review: bound collection sizes in the schema, not in a runbook.',
    },
    {
      title: 'Data structures, encodings and real memory cost',
      hook: 'A 10-byte value can cost 80+ bytes of RAM; encoding thresholds decide whether you pay 1× or 10×.',
      body: [
        'Every key costs a `dictEntry` (~24 B), a `robj` header (16 B), an SDS key (header + bytes + NUL) and, if it has a TTL, a second entry in the `expires` dict — roughly **50–100 bytes of overhead per key** before the value, plus allocator (jemalloc) rounding. Hundreds of millions of tiny keys are therefore mostly overhead.',
        'Small aggregates use compact, cache-friendly flat encodings (`listpack`, `intset`) with O(N) access but tiny N; once a collection exceeds a threshold Redis converts it (one-way) to a pointer-based encoding. Sorted sets become a **skiplist + dict**: the dict gives O(1) member→score, the skiplist gives O(log N) rank and range queries.',
        'The keyspace dict resizes by **incremental rehash**: a new table is allocated and each subsequent operation migrates a few buckets, so a resize never causes one giant pause. Resizing is deferred while a fork child exists to avoid triggering copy-on-write of the whole table.',
      ],
      table: {
        caption: 'Encodings (Redis 7.x defaults)',
        columns: ['Type', 'Compact encoding', 'Converts when', 'Large encoding'],
        rows: [
          ['String', '`int` / `embstr`', 'not an int, or > 44 bytes', '`raw` SDS'],
          ['Hash', '`listpack`', '> 128 fields or a value > 64 B', '`hashtable`'],
          ['Set', '`intset` / `listpack`', '> 512 ints / > 128 members', '`hashtable`'],
          ['Sorted set', '`listpack`', '> 128 members or a member > 64 B', '`skiplist` + `dict`'],
          ['List', '`quicklist` of listpacks', 'node > `list-max-listpack-size` (-2 = 8 KB)', 'more quicklist nodes'],
        ],
      },
      code: {
        lang: 'bash',
        code: `# One hash of 100 fields instead of 100 top-level keys (Instagram's classic trick)
HSET user:1000:{bucket} 1000042 "a1b2" 1000043 "c3d4"
OBJECT ENCODING user:1000:{bucket}      # "listpack"
MEMORY USAGE user:1000:{bucket}         # bytes incl. overhead
redis-cli --bigkeys                     # largest key per type (SCAN-based)
redis-cli --memkeys                     # largest by MEMORY USAGE`,
        caption: 'Bucketing small values into listpack hashes can cut memory 5–10× for tiny values.',
      },
      insight:
        'Size a cache by `MEMORY USAGE` on real samples × key count × 1.2–1.5 for fragmentation (`mem_fragmentation_ratio`), not by raw payload size — and leave headroom for fork copy-on-write and client output buffers.',
    },
    {
      title: 'Expiry and eviction: approximated LRU, LFU with Morris counters',
      hook: 'Redis never knows the true LRU key — it samples, and the sample size is a knob.',
      body: [
        'Expiry is **lazy + active**: a key is deleted when touched after its deadline, and `serverCron` runs an active cycle (`hz` 10 times/s) that samples 20 keys with TTLs, deletes the expired ones and repeats while > 25% of the sample was expired, under a CPU time budget (`active-expire-effort` raises it). So expired-but-untouched keys can linger and hold memory briefly.',
        'Eviction only runs when `used_memory > maxmemory`, before executing a write. Redis samples `maxmemory-samples` (default 5) keys, merges them into a 16-entry eviction pool sorted by idle time (or frequency), and evicts the best candidate. With 10 samples the result is very close to true LRU; with 5 it is good enough at lower CPU cost. The default policy is `noeviction` — writes fail with OOM errors — so a cache must set a policy explicitly.',
        '**LFU** reuses the 24-bit field: 16 bits of last-decrement time (minutes) + an 8-bit **logarithmic Morris counter**. Each hit increments with probability `1 / ((counter − 5) × lfu-log-factor + 1)`, so 255 represents ~1M hits at the default factor 10; the counter decays by 1 per `lfu-decay-time` minutes idle. New keys start at 5 so they aren’t evicted instantly.',
      ],
      table: {
        columns: ['Policy', 'Candidates', 'Use when'],
        rows: [
          ['`noeviction` (default)', 'none — writes error', 'Redis is a store/queue, not a cache'],
          ['`allkeys-lru`', 'all keys, by idle time', 'General cache with recency skew'],
          ['`allkeys-lfu`', 'all keys, by log-frequency', 'Stable hot set, scans pollute LRU'],
          ['`volatile-lru` / `volatile-lfu` / `volatile-ttl`', 'only keys with a TTL', 'Mixed cache + pinned data (better: two instances)'],
          ['`allkeys-random` / `volatile-random`', 'random', 'Uniform access; cheapest'],
        ],
      },
      code: {
        lang: 'text',
        code: `maxmemory 24gb                 # leave ~25% of RAM for fork CoW + buffers
maxmemory-policy allkeys-lfu
maxmemory-samples 10           # closer to true LRU/LFU, a bit more CPU
lfu-log-factor 10
lfu-decay-time 1
lazyfree-lazy-eviction yes     # free evicted big values off-thread`,
        caption: 'redis.conf for a pure cache.',
      },
      insight:
        'A `volatile-*` policy with keys that have no TTL behaves like `noeviction` once those keys fill memory. Rising `evicted_keys` with a falling hit ratio means the working set no longer fits — eviction policy tuning will not fix a capacity problem.',
    },
    {
      title: 'Persistence and replication: fork, copy-on-write, PSYNC, WAIT',
      hook: 'The `fork()` behind every snapshot can double memory and freeze the loop; replication can silently lose acked writes.',
      body: [
        '**RDB** (`BGSAVE`, `save 3600 1 300 100 60 10000`) forks; the child writes a snapshot while the OS shares pages copy-on-write. Every page the parent writes during the dump is duplicated, so a write-heavy node can approach **2× RSS**; with Transparent Huge Pages each touched page copies 2 MB, so disable THP. `fork()` itself copies page tables — ~10–20 ms per GB on typical VMs (`latest_fork_usec`) — during which the loop is frozen.',
        '**AOF** appends every write; `appendfsync everysec` (default) loses ≤ ~1–2 s on crash, `always` fsyncs per write (slow), `no` leaves it to the OS. `BGREWRITEAOF` compacts the log by forking; `aof-use-rdb-preamble yes` (default) makes the base an RDB snapshot — the hybrid format.',
        '**Replication** is async: the primary streams the command stream to replicas and into `repl-backlog-size` (default 1 MB). A reconnecting replica sends `PSYNC <replid> <offset>`; if the offset is still in the backlog it gets a partial resync, otherwise a full RDB transfer (diskless by default in Redis 7). `WAIT 1 100` blocks until 1 replica acked — it narrows the loss window but does not make failover consistent.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Partial vs full resync',
        actors: ['Replica', 'Primary', 'Backlog'],
        messages: [
          { from: 'Replica', to: 'Primary', label: 'PSYNC replid 9500', tone: 'info' },
          { from: 'Primary', to: 'Backlog', label: 'offset 9500 still held?' },
          { from: 'Backlog', to: 'Primary', label: 'yes', dashed: true, tone: 'ok' },
          { from: 'Primary', to: 'Replica', label: '+CONTINUE + missing bytes', tone: 'ok' },
          { from: 'Replica', to: 'Primary', label: 'PSYNC after long outage', tone: 'info' },
          { from: 'Primary', to: 'Replica', label: '+FULLRESYNC: fork + RDB', tone: 'bad' },
        ],
        caption: 'A too-small backlog turns every network blip into a fork + full copy.',
      },
      insight:
        'Size `repl-backlog-size` to cover write rate × longest expected disconnect (e.g. 20 MB/s × 60 s = 1.2 GB), and raise `client-output-buffer-limit replica` — otherwise a full sync of a big dataset overflows the buffer, the replica is dropped, retries, and the primary forks in a loop.',
    },
    {
      title: 'Sentinel vs Redis Cluster: slots, MOVED/ASK, gossip',
      hook: 'Sentinel gives HA for one dataset; Cluster gives sharding + HA but changes what commands you can run.',
      body: [
        '**Sentinel**: ≥ 3 sentinel processes monitor one primary. After `down-after-milliseconds` a sentinel marks it SDOWN; when `quorum` agree it is ODOWN, the sentinels elect a leader (per-epoch vote) that promotes the best replica (priority, replication offset) and reconfigures the rest. Clients ask Sentinel `get-master-addr-by-name` — so the dataset still has to fit on one primary.',
        '**Cluster**: the keyspace is 16384 slots, `slot = CRC16(key) mod 16384`; each primary owns ranges. Nodes gossip PING/PONG on the cluster bus; a node unreachable for `cluster-node-timeout` (default 15 s) is PFAIL, and FAIL once a majority of primaries report it, then its replicas run an election. 16384 was chosen so the slot bitmap in each heartbeat stays at 2 KB; the practical ceiling is ~1000 nodes.',
        'A smart client caches the slot map. **MOVED** = the slot permanently lives elsewhere (refresh the map). **ASK** = the slot is mid-migration and this key already moved: send `ASKING` + the command to the target once, without updating the map. Multi-key commands, transactions and Lua must touch one slot (`CROSSSLOT` error otherwise), so you co-locate with **hash tags**: only the `{...}` part is hashed.',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Sentinel', points: ['One primary + replicas', 'Quorum of sentinels decides', 'All commands work', 'Scale = bigger box'], tone: 'info' },
          { name: 'Cluster', points: ['16384 slots over N primaries', 'Primaries vote on failover', 'Multi-key only within a slot', 'Online resharding'], tone: 'accent' },
        ],
        caption: 'Both are async-replicated: a failover can lose the writes not yet shipped.',
      },
      code: {
        lang: 'bash',
        code: `CLUSTER KEYSLOT user:42                 # 8174 (example)
MGET {user:42}:profile {user:42}:prefs   # same slot via hash tag
GET order:9
-MOVED 3999 10.0.1.7:6379               # stale map: refresh, retry
-ASK 3999 10.0.1.9:6379                 # migrating: ASKING + retry once`,
      },
      insight:
        'Hash tags are a capacity decision: `{tenant}` on every key puts a whole tenant on one shard and recreates the hot-shard problem. Use the narrowest tag that covers your multi-key operations.',
    },
    {
      title: 'Caching patterns and the invalidation race',
      hook: 'Delete-after-write still serves stale data forever under one unlucky interleaving.',
      body: [
        '**Cache-aside** (app reads cache, on miss reads DB and sets) is the default. **Read-through** moves the loader into a library/proxy. **Write-through** writes cache and DB synchronously (fresh but every write pays both). **Write-behind** acks after the cache write and flushes to the DB later (fast, but a cache loss loses data). **Refresh-ahead** reloads hot keys before expiry.',
        'For cache-aside writes, **delete** the key after the DB commit rather than setting it: two concurrent setters can apply in the wrong order, deletes are idempotent. But the classic race remains: reader misses, reads the OLD row, writer commits and deletes, then reader sets the OLD value — stale until TTL.',
        'Fixes, in increasing strength: a TTL as the staleness bound; **delayed double delete** (delete again after ~replica lag); **versioned values** set via Lua only if the version is newer; **leases** (Meta: a miss returns a token, and a delete invalidates outstanding tokens so the late set is rejected); **CDC-driven invalidation** (tail the binlog — McSqueal, Debezium — so every committed write produces a delete, even from other services).',
      ],
      diagram: {
        type: 'sequence',
        title: 'Stale set race',
        actors: ['Reader', 'Cache', 'DB', 'Writer'],
        messages: [
          { from: 'Reader', to: 'Cache', label: 'GET k → miss' },
          { from: 'Reader', to: 'DB', label: 'SELECT → v1' },
          { from: 'Writer', to: 'DB', label: 'UPDATE → v2, commit', tone: 'info' },
          { from: 'Writer', to: 'Cache', label: 'DEL k', tone: 'info' },
          { from: 'Reader', to: 'Cache', label: 'SET k v1 (stale!)', tone: 'bad' },
          { from: 'Cache', to: 'Reader', label: 'lease: reject late set', dashed: true, tone: 'ok' },
        ],
        caption: 'Leases or versioned sets close the window; a TTL only bounds it.',
      },
      code: {
        lang: 'lua',
        code: `-- SET only if newer: KEYS[1]=key, ARGV[1]=version, ARGV[2]=value, ARGV[3]=ttl
local cur = redis.call('HGET', KEYS[1], 'v')
if cur and tonumber(cur) >= tonumber(ARGV[1]) then return 0 end
redis.call('HSET', KEYS[1], 'v', ARGV[1], 'd', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1`,
        caption: 'Version = DB row version or commit LSN, so out-of-order sets can’t regress the cache.',
      },
      insight:
        'Invalidation from the app’s write path misses every write it doesn’t see (other services, backfills, manual SQL). For anything shared, invalidate from the DB change stream and keep a TTL as the backstop — never rely on a single mechanism.',
    },
    {
      title: 'Stampedes, hot keys, big keys, penetration and avalanche',
      hook: 'Most cache outages are a sudden drop in hit ratio, not a cache crash.',
      body: [
        '**Stampede / dogpile**: a hot key expires and thousands of concurrent misses recompute it. Fixes: per-key lock (`SET lock:k token NX PX 5000`) or lease so one caller recomputes while others wait or get stale; in-process **singleflight** to collapse misses per server; **stale-while-revalidate** (store a soft TTL inside the value, hard TTL on the key); and probabilistic early expiration (**XFetch**, Vattani et al. 2015).',
        '**Hot key**: one key at 200k reads/s saturates one shard’s single core regardless of cluster size. Detect with `redis-cli --hotkeys` (needs an LFU policy) or client-side sampling; fix with an in-process L1 with a 1–5 s TTL, or replicate the key as `k#0..k#N` across slots and read a random copy (writes fan out).',
        '**Big key**: a 50 MB value or 5M-member set blocks the loop on read/delete, skews memory and breaks migration. **Penetration**: lookups for non-existent IDs always miss — cache negative results briefly and/or front with a Bloom filter. **Avalanche**: many keys set together expire together, or a shard restart empties the cache — jitter TTLs and warm up before taking traffic.',
      ],
      code: {
        lang: 'python',
        code: `# XFetch: recompute early with probability rising toward expiry
# delta = last recompute time, beta = 1.0 (>1 = earlier)
def get(key, ttl, beta=1.0):
    value, delta, expiry = cache.read(key)
    if value is None or now() - delta * beta * math.log(random()) >= expiry:
        start = now()
        value = recompute(key)
        delta = now() - start
        cache.write(key, (value, delta), ttl)
    return value`,
        caption: 'log(random()) is negative, so the check fires a little before expiry, more often for slow recomputes.',
      },
      table: {
        columns: ['Problem', 'Signal', 'First fix'],
        rows: [
          ['Stampede', 'DB QPS spike aligned with a key’s expiry', 'Lease/lock + serve stale'],
          ['Hot key', 'One shard at 100% CPU, others idle', 'L1 cache or key replicas'],
          ['Big key', '`SLOWLOG` DEL/HGETALL, latency spikes', 'Split, `UNLINK`, cap size'],
          ['Penetration', 'High misses on IDs that don’t exist', 'Negative cache / Bloom filter'],
          ['Avalanche', 'Hit ratio cliff after deploy/restart', 'TTL jitter, warmup, rate-limit DB'],
        ],
      },
      insight:
        'Your DB is sized for the miss rate, so the cache is a load-bearing wall: plan capacity for the cache being cold (deploy, failover, flush) — with load shedding or a warmup gate — or the first cache incident becomes a DB incident.',
    },
    {
      title: 'Hit-ratio math, sizing and warmup',
      hook: 'The last few percent of hit ratio are worth more than the first fifty.',
      body: [
        'Effective latency is `h × t_cache + (1 − h) × (t_cache + t_db)` — a miss pays the cache lookup and the DB. With 0.3 ms cache and 5 ms DB, 90% → 0.8 ms, 99% → 0.35 ms. Mean latency barely moves above ~95%, but **DB load is proportional to the miss ratio**: 99% → 98% doubles it, 99% → 99.9% cuts it 10×.',
        'Access patterns are roughly Zipfian, so hit ratio grows with the log of cache size: doubling memory buys a few points, not a doubling. Measure the curve instead of guessing: replay a sampled key trace through a simulator, or use miss-ratio-curve tooling, and buy memory up to the knee where the next GB saves less DB cost than it adds.',
        'Warmup matters because a new or restarted shard starts at 0%. Options: route a slowly increasing share of traffic to new nodes, prefill from a key dump or the previous primary’s RDB, shadow-read from the old cluster during migrations, and gate failover so not all replicas restart at once.',
      ],
      table: {
        caption: '1M reads/s, 0.3 ms cache, 5 ms DB',
        columns: ['Hit ratio', 'DB reads/s', 'Mean latency', 'Relative DB size'],
        rows: [
          ['90%', '100k', '0.80 ms', '100×'],
          ['99%', '10k', '0.35 ms', '10×'],
          ['99.9%', '1k', '0.305 ms', '1×'],
          ['0% (cold)', '1M', '5.3 ms', '1000×'],
        ],
      },
      diagram: {
        type: 'flow',
        title: 'Safe warmup of a new shard',
        nodes: [
          { label: 'Prefill hot keys', sub: 'dump or RDB', tone: 'info' },
          { label: '1% traffic', sub: 'watch DB QPS', tone: 'neutral' },
          { label: '10% → 50%', sub: 'hit ratio ≥ target', tone: 'accent' },
          { label: '100%', sub: 'old shard drained', tone: 'ok' },
        ],
      },
      insight:
        'Measure hit ratio per key family and per byte, not just globally: a 99% global ratio can hide a 60% ratio on the expensive query that actually loads the DB.',
    },
    {
      title: 'Memcached internals and Meta’s memcache architecture',
      hook: 'The largest cache deployment in the world runs on the “dumber” engine — the smarts live around it.',
      body: [
        'Memcached is multi-threaded and only stores opaque blobs, so it scales up on one box to millions of ops/s. Memory is pre-split into 1 MB pages; each page is assigned to a **slab class** of fixed-size chunks (96 B, 120 B, … growing ×1.25). An item goes into the smallest chunk that fits, so there is no fragmentation but some internal waste; max item size is 1 MB by default (`-I`).',
        '**Slab calcification**: pages once assigned to a class stayed there, so if the value-size mix shifted (e.g. 200 B → 2 KB) the new class starved and evicted while old classes held idle memory. Modern versions rebalance with `slab_reassign` + `slab_automove`, and use a segmented HOT/WARM/COLD LRU per class with a background LRU crawler that reclaims expired items.',
        'Meta’s “Scaling Memcache at Facebook” (NSDI 2013) adds the missing pieces outside the server: client-side consistent hashing and mcrouter; **leases** (a miss returns a 64-bit token; a delete invalidates it; the server hands out tokens to one requester per key every few seconds so the rest wait or take stale data); **McSqueal** turning MySQL commits into batched deletes; a small **gutter pool** that takes over for failed servers with short TTLs instead of rehashing load onto healthy ones.',
      ],
      diagram: {
        type: 'flow',
        title: 'Meta look-aside with CDC invalidation',
        nodes: [
          { label: 'Web server', sub: 'get / lease-set', tone: 'neutral' },
          { label: 'mcrouter', sub: 'route, replicate', tone: 'info' },
          { label: 'Memcached pool', sub: 'regional, sharded', tone: 'ok' },
          { label: 'MySQL', sub: 'commit log', tone: 'accent' },
          { label: 'McSqueal', sub: 'binlog → deletes', tone: 'violet' },
        ],
        caption: 'Writers never set; deletes come from the commit log, so every write path invalidates.',
      },
      insight:
        'A gutter pool beats rehashing: rehashing a dead node’s keys onto the survivors moves a hot key’s load onto another node and can cascade; a separate idle pool absorbs it with short TTLs and isolates the blast radius.',
    },
  ],
  scaling: {
    body: [
      'Scale reads by adding shards (Cluster slots or client-side consistent hashing), not replicas: replica reads are stale and add failover complexity. Each Redis process uses one core for execution, so pack one shard per core and keep shards small (≤ 25 GB) so fork, full resync and restart stay fast.',
      'The **control plane** (Sentinel quorum, cluster gossip, slot migration, managed-service orchestration) decides who is primary; the **data plane** keeps serving from cached slot maps. A partitioned primary keeps accepting writes until it notices it is in the minority (`min-replicas-to-write` limits this), and those writes are discarded after failover — acceptable for a cache, not for a ledger.',
      'Multi-region: keep caches **regional** and invalidate locally from each region’s DB replica change stream, so a region never caches data older than its own replica. Active-active cross-region caches (Redis Enterprise CRDTs, Meta’s remote markers) are niche — usually the right answer is per-region cache + per-region invalidation.',
    ],
    bullets: [
      'Online resharding moves slots key by key (`MIGRATE`); big keys make it stall, ASK redirections add latency during moves.',
      'Client slot-map refresh storms after a failover: cap refresh rate, use topology refresh on MOVED only.',
      'Spread primaries and their replicas across AZs; cross-AZ reads cost latency and transfer fees.',
      'Connection count is a scaling limit: 2,000 pods × 50 connections × 30 shards — use multiplexed clients or a proxy (Envoy, twemproxy, mcrouter).',
      'Warm new shards/regions with shadow traffic or by replaying hot keys before shifting load.',
      'Keep cache and durable Redis (queues, locks, sessions) on separate clusters with different eviction and persistence settings.',
    ],
    diagram: {
      type: 'layers',
      title: 'Cluster planes',
      layers: [
        { name: 'Clients', items: ['slot map cache', 'MOVED/ASK handling', 'connection pools'], tone: 'info' },
        { name: 'Control plane', items: ['gossip bus', 'failure votes', 'slot migration', 'config epochs'], tone: 'violet' },
        { name: 'Data plane', items: ['primary per slot range', 'async replicas', 'eviction + expiry'], tone: 'ok' },
      ],
    },
  },
  failures: [
    {
      name: 'Hit ratio collapse → DB overload',
      symptom: 'DB CPU and connection count jump, p99 of every endpoint rises; cache itself looks healthy.',
      detect: 'Alert on `keyspace_misses / (hits + misses)` and DB QPS per endpoint; correlate with deploys, `evicted_keys` rate and shard restarts (`uptime_in_seconds` reset).',
      mitigate: 'Request coalescing + serve-stale, load shedding / circuit breaker in front of the DB, warmup gates for new shards, TTL jitter.',
    },
    {
      name: 'Hot shard',
      symptom: 'One node at 100% `used_cpu_sys/user` with growing latency; cluster average fine.',
      detect: 'Per-node ops/s and CPU dashboards (not cluster averages); `redis-cli --hotkeys`; client-side top-K key sampling.',
      mitigate: 'L1 in-process cache for the key, key replicas across slots, move the slot to a dedicated node, narrower hash tags.',
    },
    {
      name: 'Event-loop stall',
      symptom: 'Periodic latency spikes for all clients, timeouts, sometimes spurious cluster failovers.',
      detect: '`SLOWLOG`, `latency_percentiles_usec_*`, `latest_fork_usec`, `blocked_clients`; client timeout rate per shard.',
      mitigate: 'Ban O(N) commands, `UNLINK` instead of `DEL`, split big keys, smaller shards (cheaper fork), disable THP.',
    },
    {
      name: 'OOM / fork memory blow-up',
      symptom: 'Instance OOM-killed during BGSAVE or AOF rewrite, or writes fail with `OOM command not allowed`.',
      detect: '`used_memory` vs `maxmemory`, `used_memory_rss`, `mem_fragmentation_ratio`, `rdb_last_bgsave_status`, `aof_last_bgrewrite_status`, host memory.',
      mitigate: '`maxmemory` ≤ ~60–75% of RAM when persistence is on, disable persistence on pure caches, replica-only snapshots, `activedefrag yes`.',
    },
    {
      name: 'Replication full-sync loop',
      symptom: 'Replica repeatedly reconnects, primary forks again and again, latency and network saturate.',
      detect: '`sync_full` increasing, `sync_partial_err`, `master_link_status:down`, client-output-buffer disconnect logs.',
      mitigate: 'Bigger `repl-backlog-size`, higher `client-output-buffer-limit replica`, smaller shards, diskless sync.',
    },
    {
      name: 'Stale reads after writes',
      symptom: 'Users see old data for minutes; support tickets after profile/price edits.',
      detect: 'Sampled read-your-write probes comparing cache vs DB; invalidation lag metric from CDC consumer offset.',
      mitigate: 'Delete-after-commit + CDC invalidation, versioned or lease-guarded sets, bounded TTL.',
    },
    {
      name: 'Connection storm and retry amplification',
      symptom: 'After a failover or deploy, thousands of clients reconnect and retry at once; CPU spent on TLS/AUTH, `maxclients` reached.',
      detect: '`connected_clients`, `rejected_connections`, `total_connections_received` rate, client-side timeout and retry counters per shard.',
      mitigate: 'Bounded pools or multiplexed clients, exponential backoff with jitter, retry budgets, short timeouts with fallback to DB only behind a limiter.',
    },
  ],
  warStories: [
    {
      title: 'Facebook’s 2.5-hour outage: cache invalidation feedback loop',
      source: 'Facebook Engineering, “More Details on Today’s Outage”, September 2010',
      what:
        'An automated system that verified configuration values saw a value it considered invalid and “fixed” it by deleting the cached copy so clients would re-read the DB. The DB copy itself was the invalid one, so every client that read it deleted the cache key and queried the DB again. Hundreds of thousands of queries per second overwhelmed the database cluster; errors made clients treat the value as invalid again. Engineers had to block traffic to the DB cluster, effectively taking the site down to break the loop.',
      lesson:
        'Error handling that invalidates the cache and retries the source of truth is an amplifier. Rate-limit cache refills per key, prefer serving the last good value over re-fetching on error, and make sure a bad value cannot drive N× load at the DB.',
    },
    {
      title: 'Slack 2-22-22: cache flush meets an expensive query',
      source: 'Slack Engineering, “Slack’s Incident on 2-22-22”, 2022',
      what:
        'During a rolling restart of Consul agents, the memcached nodes being restarted were removed from the service registry and replaced with empty ones, steadily lowering the cache hit rate. A particular query for group-DM membership that was normally cached was expensive against the sharded Vitess database; misses drove database load past capacity and the system could not recover on its own because every slow query also failed to refill the cache.',
      lesson:
        'Infrastructure work that silently empties cache nodes is a capacity event. Track hit ratio as an SLO, restart cache nodes slowly with warmup, and know which miss paths are expensive enough to need throttling.',
    },
    {
      title: 'Snapshot fork kills the primary',
      source: 'Composite of common incidents',
      what:
        'A 40 GB Redis on a 64 GB VM runs a scheduled `BGSAVE` during a write burst. Copy-on-write (amplified by THP) grows RSS toward 2×; the kernel OOM-kills the parent, a replica with a stale backlog is promoted, and the other replicas full-resync from it — a second fork and a cluster-wide latency spike.',
      lesson:
        'Leave fork headroom (`maxmemory` well below RAM), disable THP, snapshot only on replicas, and question whether a pure cache needs persistence at all.',
    },
    {
      title: 'The celebrity key',
      source: 'Composite of common incidents',
      what:
        'A viral post’s counter and payload live under one key. Reads spike to 300k/s on a single shard; its CPU saturates, latency for every other key on that shard climbs, clients time out and retry, doubling the load. Adding shards does nothing because the key cannot be split by the cluster.',
      lesson:
        'Clusters scale keys, not a key. Detect top-K keys continuously and put a short-TTL L1 or key replicas in front of anything that can go viral.',
    },
  ],
  numbers: [
    { label: 'Redis ops/s per instance', value: '~100k–200k', note: '1M+ with pipelining or io-threads; per core' },
    { label: 'GET round trip', value: '0.2–0.5 ms in-AZ', note: '+0.3–1 ms cross-AZ' },
    { label: 'Per-key overhead', value: '~50–100 B', note: 'dictEntry + robj + SDS + expires entry' },
    { label: 'Cluster slots', value: '16384', note: 'CRC16 mod 16384; ~1000 nodes practical max' },
    { label: 'fork() pause', value: '~10–20 ms/GB', note: 'page-table copy; see `latest_fork_usec`' },
    { label: 'maxmemory-samples', value: '5 (default)', note: '10 ≈ true LRU' },
    { label: 'repl-backlog-size', value: '1 MB default', note: 'usually far too small' },
    { label: 'cluster-node-timeout', value: '15 s default', note: 'failover detection floor' },
    { label: 'Memcached max item', value: '1 MB default', note: 'slab growth factor 1.25' },
    { label: 'HyperLogLog', value: '12 KB', note: '0.81% standard error' },
    { label: 'Active expiry', value: '20 keys × hz 10/s', note: 'repeats while > 25% expired' },
    { label: 'Effective latency', value: 'h·t_c + (1−h)·(t_c + t_db)', note: '99% × 0.3 + 1% × 5.3 ≈ 0.35 ms' },
  ],
  capacity: {
    question:
      'A product catalog serves 300k reads/s and 3k writes/s; 50M products, 2 KB average JSON. Size a Redis cache for a 98% hit ratio and the DB behind it.',
    steps: [
      'Working set: analytics show 20% of products take 98% of reads → 10M keys × (2 KB value + ~100 B overhead) ≈ 21 GB; × 1.3 fragmentation/headroom ≈ 28 GB.',
      'Throughput: 300k GET/s + 6k invalidations and ~6k refills/s. At a conservative 80k ops/s per shard (2 KB values cost bandwidth) → 4 shards minimum; hot-key skew and N+1 → 8 primaries.',
      'Memory per shard: 28 GB / 8 ≈ 3.5 GB — small shards keep fork, resync and restart cheap. Add 1 replica each in another AZ: 16 nodes of ~8 GB RAM.',
      'Bandwidth: 300k × 2 KB = 600 MB/s ≈ 4.8 Gbps total, ~0.6 Gbps per shard — fine, but compress values > 1 KB if growth is expected.',
      'DB load: (1 − 0.98) × 300k = 6k reads/s + 3k writes/s. Cold-cache case: 300k reads/s would need ~10× the DB — so add request coalescing, warmup and load shedding instead of sizing the DB for it.',
    ],
    answer:
      '8 primaries + 8 replicas, ~4 GB data each, `allkeys-lfu`, no persistence; the DB is sized for ~10k QPS plus a coalesced cold-start, with hit ratio alerting at < 97%.',
  },
  comparison: {
    caption: 'Distributed cache engines',
    columns: ['Product', 'Threading', 'Data model', 'Durability / HA', 'Best for'],
    rows: [
      ['Redis / Valkey', 'Single executor + I/O threads', 'Rich types, Lua, streams', 'RDB/AOF, async replicas, Sentinel/Cluster', 'Default choice: cache + counters, leaderboards, locks'],
      ['Memcached', 'Multi-threaded', 'Opaque blobs ≤ 1 MB', 'None; client-side sharding', 'Huge simple look-aside caches, multi-core boxes'],
      ['Dragonfly', 'Multi-threaded shared-nothing', 'Redis + Memcached API', 'Forkless snapshots, replication', 'Vertical scale on big instances, fewer shards'],
      ['Amazon MemoryDB', 'Redis/Valkey engine', 'Redis API', 'Multi-AZ transaction log before ack', 'Redis as a durable primary store'],
      ['Hazelcast (IMDG)', 'JVM, partitioned (271 partitions)', 'Maps, near cache, compute', 'Sync/async backups in-cluster', 'JVM shops wanting embedded/near caching + compute'],
    ],
  },
  whenNot: [
    'Write-heavy or rarely re-read data: hit ratio stays low, you pay for invalidation traffic and staleness for nothing — tune the DB or add read replicas instead.',
    'Data that must be strongly consistent with the DB (balances, inventory decrements): read from the primary or use the DB’s own cache; a cache can only bound staleness.',
    'As the only copy of important data with `noeviction` + AOF “because it’s fast”: async replication loses acked writes on failover — use a durable store (Postgres, DynamoDB, MemoryDB).',
    'Tiny, immutable reference data read on every request: an in-process cache is 1000× faster and has no hot-shard risk.',
    'To hide a missing index or an N+1 query pattern: fix the query; a cache in front of a broken query becomes a stampede generator.',
  ],
  interview: [
    {
      q: 'Walk me through how Redis evicts keys under allkeys-lru, and why it is not true LRU.',
      a: 'Eviction runs before a write when `used_memory` exceeds `maxmemory`. Redis samples `maxmemory-samples` keys (default 5), adds them to a 16-entry pool ordered by idle time from a 24-bit per-object clock, and evicts the worst, repeating until under the limit. True LRU would need a linked list with two pointers per key and a list update on every read — memory and CPU Redis avoids. With 10 samples the approximation is nearly indistinguishable from true LRU; LFU uses the same field as a logarithmic Morris counter with time decay.',
      followUps: ['When would you pick allkeys-lfu over allkeys-lru?', 'What happens with volatile-lru when most keys have no TTL?', 'How do you tell an eviction problem from a capacity problem?'],
      seniorSignal: 'Explains the sampling pool and the memory trade-off, and ties eviction metrics to working-set sizing rather than policy tweaking.',
    },
    {
      q: 'How do you keep a cache consistent with the database under concurrent writes?',
      a: 'Use cache-aside with delete-after-commit, because deletes are idempotent and order-insensitive. That still leaves the read-miss/stale-set race, so add a TTL bound and either version-guarded sets (Lua compare on row version) or leases that a delete invalidates. To catch writes from every path, drive invalidation from the DB change stream (binlog/CDC) like Meta’s McSqueal. For read-your-writes, route that user’s reads to the primary or skip the cache briefly after a write.',
      followUps: ['Why delete rather than update the cache?', 'What does double delete buy you and what does it cost?', 'How do you invalidate across regions with replica lag?'],
      seniorSignal: 'Draws the exact stale-set interleaving and picks a mechanism by required staleness bound, rather than claiming write-through makes it consistent.',
    },
    {
      q: 'A hot key expires and the database falls over. Design the fix.',
      a: 'It is a stampede: all concurrent misses recompute. One recompute per key via a lock or lease (`SET NX PX`) with others serving stale or waiting briefly; in-process singleflight so one server sends at most one miss per key; stale-while-revalidate by storing a soft expiry inside the value; and XFetch-style probabilistic early refresh for the hottest keys. Add TTL jitter so bulk-loaded keys don’t expire together, and a DB-side concurrency limit as the last line of defence.',
      followUps: ['What if the lock holder dies?', 'How does XFetch choose when to refresh?', 'How would you protect against a full cache flush?'],
      seniorSignal: 'Layers defences (server, fleet, DB) and plans for the cold-cache case, not just one expiring key.',
    },
    {
      q: 'Redis Cluster vs Sentinel — how do you choose, and what changes for application code?',
      a: 'Sentinel provides failover for a single primary and is fine while the dataset and write load fit one node; all commands work. Cluster shards 16384 hash slots across primaries with built-in failover; clients must be cluster-aware (slot map, MOVED/ASK), there is only database 0, and multi-key ops, MULTI and Lua must stay within one slot via hash tags. Both replicate asynchronously, so either can lose recent writes on failover.',
      followUps: ['What is the difference between MOVED and ASK?', 'Why 16384 slots?', 'How do hash tags create hot shards?'],
      seniorSignal: 'Names the application-level constraints (CROSSSLOT, hash-tag design) and the shared async-replication caveat.',
    },
    {
      q: 'Your Redis p99 jumps from 1 ms to 200 ms every few minutes. How do you debug it?',
      a: 'Check whether the spikes align with forks (`latest_fork_usec`, BGSAVE/AOF rewrite schedule, THP), with slow commands (`SLOWLOG GET`, `INFO commandstats` usec_per_call), with big-key deletes or expiry of large keys, or with eviction bursts (`evicted_keys`). Look at per-node CPU for a hot key. Also rule out the client: connection pool exhaustion, GC pauses and cross-AZ routing show up as Redis latency in app metrics but not in `LATENCY` history on the server.',
      followUps: ['How would you confirm it is the client and not Redis?', 'How do you safely delete a 10M-member set?', 'What does THP have to do with it?'],
      seniorSignal: 'Separates server-side latency from client-observed latency and knows the single-thread stall sources.',
    },
    {
      q: 'Estimate the DB load impact of the cache hit ratio dropping from 99% to 95%.',
      a: 'DB reads scale with the miss ratio, so going from 1% to 5% misses is a 5× increase in DB read load, not a 4% one. Average latency also moves: with 0.3 ms cache and 5 ms DB, effective latency goes from ~0.35 ms to ~0.55 ms, and p99 is dominated by misses. So the DB must be provisioned for the plausible worst miss ratio, and hit ratio needs an alert like any SLO.',
      followUps: ['What would cause such a drop?', 'How do you protect the DB if it happens at peak?', 'How do you measure hit ratio per key family?'],
      seniorSignal: 'Reasons about miss ratio multiplicatively and turns it into provisioning and alerting decisions.',
    },
    {
      q: 'When would you choose Memcached over Redis today?',
      a: 'When the workload is a pure look-aside cache of opaque blobs at very high volume and you want to use all cores of large boxes with one process, with predictable memory via the slab allocator and no persistence or fork pauses. You give up data types, replication and server-side atomic logic, and need client-side or proxy (mcrouter) sharding and failover. Meta’s and Netflix’s (EVCache) fleets show it works at huge scale with the smarts in the client and proxy.',
      followUps: ['What is slab calcification and how is it mitigated?', 'How does mcrouter’s gutter pool work?', 'What do you lose without replication?'],
      seniorSignal: 'Compares threading and memory models and places routing/HA in the client tier, not just “Redis has more features”.',
    },
    {
      q: 'Attackers request millions of random product IDs that don’t exist. What happens and how do you defend?',
      a: 'That is cache penetration: every lookup misses, so the cache provides zero protection and the DB takes the full load. Cache negative results (a tombstone with a short TTL, e.g. 30–60 s) so repeated misses are absorbed, and for random-key floods put a Bloom filter of valid IDs in front so non-members are rejected without touching cache or DB. Combine with rate limiting per client and validation of ID formats at the edge.',
      followUps: ['How do you keep the Bloom filter current as products are added?', 'What false-positive rate would you target and how much memory is that?', 'What goes wrong if the negative-cache TTL is too long?'],
      seniorSignal: 'Distinguishes penetration from stampede and avalanche, and weighs negative-cache staleness against DB protection.',
    },
  ],
  takeaways: [
    'DB load = miss ratio × read QPS: protect and alert on hit ratio like an SLO.',
    'Redis is single-threaded per shard: one O(N) command or one hot key hurts everyone on that shard.',
    'Size memory with real per-key overhead, fragmentation and fork copy-on-write headroom.',
    'Delete-after-commit + TTL is the baseline; leases, versioned sets or CDC close the stale-set race.',
    'Stampedes need coalescing + serve-stale + jitter; plan explicitly for a fully cold cache.',
    'Replication is async in Sentinel and Cluster: a cache, not a ledger.',
    'Cluster scales keys, not a key: hash tags and hot keys decide real capacity.',
    'Keep cache Redis and durable Redis (queues, locks, sessions) on separate clusters with different eviction and persistence.',
  ],
};
export default deep;
