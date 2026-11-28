import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'nosql',

  problem: {
    why: 'A single relational primary tops out at one machine’s write throughput and one region’s failure domain. NoSQL stores (Dynamo-style wide-column/KV like Cassandra, ScyllaDB, DynamoDB; document stores like MongoDB) give up joins, ad-hoc queries and usually multi-row transactions in exchange for **automatic partitioning**, replication across racks/AZs/regions, and predictable single-digit-ms latency at almost any scale — as long as every query is a lookup by key.',
    withoutIt: [
      'Write throughput is capped by one primary’s fsync, CPU and disk; past ~tens of thousands of writes/s you are hand-sharding a relational DB.',
      'Losing the primary’s AZ means a failover pause, while a leaderless or per-partition-replicated store keeps serving.',
      'Multi-region low-latency writes (local writes in each region) require bespoke conflict handling on top of a single-leader DB.',
      'Huge, simple, append-heavy datasets (messages, events, sessions, carts) pay for B-tree page writes, MVCC and planner overhead they do not need.',
    ],
    position: 'Sits behind application services as the system of record for high-volume, key-addressed data; a token-aware driver (or the DynamoDB request router) sends each request straight to the replicas owning that key. Secondary search/analytics are fed from it via CDC (Cassandra CDC, DynamoDB Streams, MongoDB change streams).',
    diagram: {
      type: 'flow',
      title: 'Request path (Cassandra-style)',
      nodes: [
        { label: 'Service', sub: 'token-aware driver' },
        { label: 'Coordinator', sub: 'any node', tone: 'info' },
        { label: 'Hash partition key', sub: 'Murmur3 → token', tone: 'accent' },
        { label: 'RF replicas', sub: 'racks / AZs', tone: 'violet' },
        { label: 'LSM per node', sub: 'commitlog, memtable, SSTables', tone: 'ok' },
      ],
      caption: 'No planner and no joins: the key decides the nodes before any I/O happens.',
    },
  },

  architecture: {
    overview: 'Two ideas compose most NoSQL stores. **Distribution**: hash (or range) the partition key onto a ring of token ranges, replicate each range to N nodes, and coordinate reads/writes with quorums (Dynamo, Cassandra) or a per-partition leader (DynamoDB, MongoDB, Bigtable). **Storage**: an **LSM tree** per node — sequential commit log, in-memory memtable, immutable sorted SSTables merged by compaction — or a B-tree engine (WiredTiger in MongoDB, DynamoDB storage nodes).',
    diagram: {
      type: 'layers',
      title: 'Dynamo-style store, top to bottom',
      layers: [
        { name: 'Client / router', items: ['token-aware driver', 'consistency level', 'speculative retry'], tone: 'info' },
        { name: 'Cluster', items: ['token ring + vnodes', 'gossip membership', 'replication strategy', 'hinted handoff'], tone: 'accent' },
        { name: 'Consistency', items: ['N/R/W quorums', 'read repair', 'Merkle-tree repair', 'LWW timestamps'], tone: 'violet' },
        { name: 'Storage (LSM)', items: ['commit log', 'memtable', 'SSTables + bloom', 'compaction'], tone: 'ok' },
      ],
    },
    blocks: [
      { name: 'Partitioner + token ring', what: 'Cassandra hashes the partition key with Murmur3 into a 64-bit token; each node owns several token ranges (**vnodes**: `num_tokens`, 16 by default since Cassandra 4.0, 256 before). Replicas are the next RF distinct nodes clockwise, placed on different racks/DCs by `NetworkTopologyStrategy`.' },
      { name: 'Coordinator', what: 'Whichever node receives the request; it fans out to replicas, waits for the consistency level, retries speculatively on slow replicas, and stores **hints** for down replicas (up to `max_hint_window`, 3 h default).' },
      { name: 'Gossip + failure detector', what: 'Nodes exchange state every second with a few peers; the phi-accrual failure detector marks nodes down based on heartbeat inter-arrival times, not a fixed timeout.' },
      { name: 'Commit log + memtable', what: 'Writes append to a commit log (default `commitlog_sync: periodic`, fsync every 10 s — durability comes from RF copies) and insert into a sorted in-memory memtable. No read-before-write: updates and deletes are just newer cells with timestamps.' },
      { name: 'SSTables + bloom filters', what: 'Flushed memtables become immutable sorted files with a partition index, summary and **bloom filter** (`bloom_filter_fp_chance` 0.01 by default for STCS) so reads skip files that cannot contain the key.' },
      { name: 'Compaction', what: 'Background merge of SSTables that keeps the newest cell per column, drops shadowed data and purges tombstones older than `gc_grace_seconds` (864000 s = 10 days). Strategy (STCS, LCS, TWCS, UCS in 5.0) trades write, read and space amplification.' },
      { name: 'Anti-entropy', what: '**Read repair** fixes divergence seen on reads; **hinted handoff** replays missed writes; **repair** builds Merkle trees per token range on each replica and streams only mismatched ranges. Must complete within `gc_grace_seconds` or deletes can resurrect.' },
    ],
    real: [
      { name: 'Apache Cassandra', how: 'Dynamo-style leaderless replication (ring, gossip, tunable consistency, hinted handoff) plus Bigtable-style LSM storage on the JVM. Lightweight transactions (`IF NOT EXISTS`) use Paxos with ~4 round trips; Accord-based general transactions are arriving in 5.x.' },
      { name: 'ScyllaDB', how: 'Cassandra-compatible C++ rewrite on the Seastar framework: **shard-per-core**, each core owns a slice of data with its own memtable, cache and I/O queue, no locks and no JVM GC; its own I/O scheduler keeps compaction from starving queries.' },
      { name: 'Amazon DynamoDB', how: 'Managed; tables are split into partitions (≤ 10 GB, ≤ 3000 RCU and 1000 WCU each), each replicated 3 ways across AZs with a **Multi-Paxos leader** per partition (per the 2022 USENIX ATC paper — not the leaderless 2007 Dynamo design). A request router authenticates, looks up partition metadata and forwards to the leader. Adaptive capacity and split-for-heat rebalance hot keys.' },
      { name: 'MongoDB', how: 'Document store on WiredTiger (B-tree, MVCC, compression). Replica sets elect a primary via a Raft-like protocol (pv1); sharded clusters route through `mongos` using a config-server replica set that maps **chunks** (key ranges) to shards; the balancer migrates chunks.' },
      { name: 'Google Bigtable / HBase', how: 'Range-partitioned **tablets/regions** served by one tablet server each, on a distributed file system (Colossus/HDFS) that provides replication; strongly consistent per row, LSM storage. The ancestor of Cassandra’s storage engine.' },
    ],
  },

  lifecycle: {
    summary: 'A `LOCAL_QUORUM` write then read of one chat message in a Cassandra cluster with RF=3 in the local DC (token-aware driver, warm caches).',
    stages: [
      { stage: 'Driver routes', what: 'Token-aware driver hashes `channel_id, bucket` locally and sends the request to one of the three replicas, which coordinates.', cost: 'Client-side hash; same-AZ RTT ~0.3 ms', ms: 0.3 },
      { stage: 'Fan-out to replicas', what: 'Coordinator forwards the mutation to the other two replicas in parallel (other AZs).', cost: 'Cross-AZ one-way ~0.3–0.5 ms', ms: 0.4 },
      { stage: 'Commit log append', what: 'Each replica appends the mutation to its commit log (periodic sync: no fsync on the request path).', cost: 'Memory-mapped sequential write', ms: 0.02 },
      { stage: 'Memtable insert + ack', what: 'Cell inserted into the memtable; replica acks. Coordinator returns once 2 of 3 acked (W=2).', cost: 'µs insert + return trip; p99 dominated by the slower of the fastest two', ms: 0.5 },
      { stage: 'Read: digest + data', what: 'A `LOCAL_QUORUM` read asks one replica for data and one for a digest (hash).', cost: 'One cross-AZ round trip', ms: 0.8 },
      { stage: 'Replica read path', what: 'Check row cache/memtable, then each SSTable whose bloom filter says “maybe”; partition index → data block (from page cache or disk); merge cells by timestamp.', cost: '1–3 SSTables with LCS; one NVMe read ~0.1 ms if not cached', ms: 0.3 },
      { stage: 'Reconcile + repair', what: 'If digests differ, fetch full data, return the newest cell and write it back to the stale replica (blocking read repair).', cost: 'Only on mismatch; extra round trip', ms: 0.1 },
      { stage: 'Background', what: 'Memtable flush to a new SSTable, compaction merges files, hints replayed to any replica that was down.', cost: 'Off request path; compaction can steal disk and CPU', ms: 0 },
    ],
  },

  deepDives: [
    {
      title: 'Partitioning: consistent hashing and vnodes',
      hook: 'Adding a node should move 1/N of the data, not reshuffle everything.',
      body: [
        'With `hash(key) mod N`, changing N remaps almost every key. **Consistent hashing** places nodes and keys on the same hash ring; a key belongs to the next node clockwise, so adding or removing a node only moves the ranges adjacent to it. Replicas are the next RF distinct nodes (skipping same-rack nodes with `NetworkTopologyStrategy`).',
        'One token per node gives uneven ranges and makes a new node stream from just one or two neighbours. **Virtual nodes** give each physical node many tokens, so ownership evens out and bootstrap/decommission streams from many peers in parallel. Too many vnodes hurt repair and availability (more replica-set combinations), which is why Cassandra 4.0 dropped the default from 256 to 16 with a token allocation algorithm.',
        'DynamoDB and MongoDB use **range-based splits** managed by a metadata service instead: a partition or chunk splits when it grows too big or too hot, and the router/balancer moves it. Range partitioning keeps sorted scans cheap but needs active rebalancing; hashing spreads load but makes range scans across keys scatter-gather.',
      ],
      diagram: {
        type: 'flow',
        title: 'Key → replicas',
        nodes: [
          { label: 'partition key', sub: 'channel_id, bucket' },
          { label: 'Murmur3', sub: '64-bit token', tone: 'accent' },
          { label: 'Ring lookup', sub: 'owning vnode', tone: 'info' },
          { label: 'Replica 1', sub: 'rack a', tone: 'ok' },
          { label: 'Replica 2', sub: 'rack b', tone: 'ok' },
          { label: 'Replica 3', sub: 'rack c', tone: 'ok' },
        ],
      },
      insight: 'Consistent hashing balances **keys**, not **load**: one celebrity key still lands on exactly RF nodes. Hot-key mitigation (key salting, caching, request coalescing) is a data-modelling job no partitioner can do for you.',
    },
    {
      title: 'Quorums, sloppy quorums, hinted handoff and repair',
      hook: 'R + W > N gives overlap, not linearizability.',
      body: [
        'With N replicas, a write waits for W acks and a read for R replies. If **R + W > N** the sets overlap, so a read normally contacts at least one replica holding the latest acknowledged write (QUORUM/QUORUM with N=3 is 2+2). Lower R or W buys latency and availability at the cost of stale reads. `LOCAL_QUORUM` applies the quorum within one DC so cross-region latency stays off the request path.',
        'The Dynamo paper’s **sloppy quorum** lets a write succeed on the first N *healthy* nodes even if they are not the key’s home replicas, storing a hint to forward later; Cassandra instead counts only real replicas toward the consistency level and uses hints purely as a catch-up mechanism. **Read repair** fixes divergence on keys that are read; full **anti-entropy repair** compares Merkle trees (hash trees over token sub-ranges) between replicas and streams only differing leaves.',
        'Quorums do not provide linearizability: a write that failed (timed out after reaching one replica) may later appear, concurrent writers race with last-write-wins, and without blocking read repair two consecutive quorum reads can disagree. For compare-and-set, use Cassandra LWTs (Paxos), DynamoDB conditional writes, or a consensus store.',
      ],
      diagram: {
        type: 'sequence',
        title: 'QUORUM write with one replica down',
        actors: ['Client', 'Coordinator', 'Replica A', 'Replica B', 'Replica C'],
        messages: [
          { from: 'Client', to: 'Coordinator', label: 'write, CL=QUORUM' },
          { from: 'Coordinator', to: 'Replica A', label: 'mutation' },
          { from: 'Coordinator', to: 'Replica B', label: 'mutation' },
          { from: 'Coordinator', to: 'Replica C', label: 'mutation (down)', tone: 'bad' },
          { from: 'Replica A', to: 'Coordinator', label: 'ack', dashed: true, tone: 'ok' },
          { from: 'Replica B', to: 'Coordinator', label: 'ack', dashed: true, tone: 'ok' },
          { from: 'Coordinator', to: 'Client', label: 'success (2/3)', tone: 'accent' },
          { from: 'Coordinator', to: 'Replica C', label: 'hint replay later', dashed: true, tone: 'warn' },
        ],
      },
      insight: 'Hints expire after `max_hint_window` (3 h): a node down longer than that must be repaired before it serves reads, and every cluster needs repair (e.g. Cassandra Reaper, incremental repair) scheduled well inside `gc_grace_seconds`, or deleted data comes back.',
    },
    {
      title: 'Conflict resolution: vector clocks vs last-write-wins',
      hook: 'Concurrent writes either merge, or one silently disappears.',
      body: [
        'The 2007 Dynamo paper tracked causality with **vector clocks**: each version carries (node, counter) pairs; if neither version descends from the other they are **siblings** returned to the client to merge (the shopping cart unions items, so deleted items can reappear). Riak productised this with dotted version vectors and CRDTs (counters, sets, maps) that merge automatically.',
        'Cassandra and ScyllaDB use **last-write-wins per cell**: every column value carries a microsecond write timestamp (usually from the client or coordinator clock) and the highest wins on read and compaction. Simple and fast, but clock skew can make a later write lose, and read-modify-write sequences from two clients drop updates. DynamoDB global tables also reconcile concurrent cross-region writes with LWW.',
      ],
      diagram: {
        type: 'compare',
        title: 'Two philosophies',
        columns: [
          { name: 'Vector clocks / CRDTs', points: ['Detects concurrency', 'Siblings or automatic merge', 'No data silently dropped', 'App or type defines merge', 'Riak, Dynamo paper'], tone: 'ok' },
          { name: 'Last-write-wins', points: ['Timestamp per cell', 'Highest timestamp wins', 'Clock skew loses writes', 'Zero client complexity', 'Cassandra, Scylla, DynamoDB GT'], tone: 'warn' },
        ],
      },
      insight: 'Design LWW data so that concurrent writes do not conflict: write immutable rows (one row per event or message with a time-based clustering key) or per-field cells instead of read-modify-writing a blob, and use counters, LWTs or conditional writes where order matters.',
    },
    {
      title: 'Cassandra write/read path and compaction strategies',
      hook: 'Writes are cheap because the cost is deferred to reads and compaction.',
      body: [
        'Write: commit log append → memtable insert → ack. When the memtable fills, it is flushed to an immutable SSTable. Nothing is updated in place, so an update or delete is just a newer cell or a **tombstone**. Read: merge the memtable with every SSTable that might hold the partition (bloom filter → partition index → data block), resolving by timestamp. Read cost grows with the number of SSTables a partition is spread across.',
        '**STCS** (size-tiered) merges ~4 similar-sized SSTables: low write amplification, but a partition can live in many files and a major compaction can need ~2× disk. **LCS** (leveled) keeps non-overlapping 160 MB SSTables per level so ~90% of reads touch one SSTable, at roughly 2× more compaction I/O. **TWCS** (time-window) groups data by write time and drops whole expired windows: ideal for TTL’d time series, terrible if you update or delete old data. Cassandra 5.0 adds **UCS** (unified) to tune between them.',
      ],
      table: {
        caption: 'Compaction strategy trade-offs',
        columns: ['Strategy', 'Write amp', 'Read amp', 'Space amp', 'Best for'],
        rows: [
          ['STCS', 'Low', 'High (many files)', 'High (needs ~50% free)', 'Write-heavy, rarely read'],
          ['LCS', 'High', 'Low (~1 SSTable)', 'Low (~10%)', 'Read-heavy, updates'],
          ['TWCS', 'Low', 'Low within window', 'Low', 'Immutable TTL time series'],
          ['UCS (5.0)', 'Tunable', 'Tunable', 'Tunable', 'One knob across workloads'],
        ],
      },
      insight: 'Compaction is a throughput tax you must provision for: a cluster sized for request load alone will slowly fall behind (pending compactions climb, SSTables per read rise, p99 drifts) until it hits a cliff weeks later.',
    },
    {
      title: 'Tombstones: why deletes are the most dangerous write',
      hook: 'A delete adds data, and reading past it can time out the whole query.',
      body: [
        'Because SSTables are immutable, a delete writes a **tombstone** that shadows older values. Tombstones must survive at least `gc_grace_seconds` (10 days) so that a replica which missed the delete is repaired rather than resurrecting the value. TTL’d cells become tombstones when they expire.',
        'Queue-like patterns (insert, read, delete) and wide partitions with many deleted rows force reads to scan past thousands of tombstones to find live rows. Cassandra warns at `tombstone_warn_threshold` (1,000 per query) and aborts at `tombstone_failure_threshold` (100,000), and scanning them creates heap pressure and GC pauses on the JVM.',
        'Mitigations: never model queues in Cassandra; partition by time bucket so old buckets are never read; use TWCS with TTLs so whole SSTables expire; delete whole partitions or ranges (one tombstone) rather than individual rows; and only lower `gc_grace_seconds` if repair reliably runs more often.',
      ],
      code: {
        lang: 'sql',
        caption: 'CQL: one range tombstone vs thousands of row tombstones',
        code: `-- Bad: per-row deletes in a queue-like table
DELETE FROM jobs WHERE queue = 'email' AND job_id = ?;   -- x 1,000,000

-- Better: time-bucketed partitions, TTL, TWCS; old buckets are never read
CREATE TABLE events (
  device_id uuid, day date, ts timeuuid, payload blob,
  PRIMARY KEY ((device_id, day), ts)
) WITH CLUSTERING ORDER BY (ts DESC)
  AND default_time_to_live = 2592000
  AND compaction = {'class': 'TimeWindowCompactionStrategy',
                    'compaction_window_unit': 'DAYS', 'compaction_window_size': 1};

-- One range tombstone instead of N row tombstones
DELETE FROM events WHERE device_id = ? AND day = ? AND ts < ?;`,
      },
      insight: 'Tombstone problems appear weeks after launch, when deletes accumulate faster than `gc_grace_seconds` lets them go. Load tests that run for an hour never see them.',
    },
    {
      title: 'Data modeling: query-first, partition key + clustering key',
      hook: 'In NoSQL you design tables from queries, not from entities.',
      body: [
        'Start from the access patterns, then design one table (or one GSI) per query. The **partition key** decides which nodes hold the data and must be in every query’s equality filter; **clustering columns** sort rows within the partition so range queries (“latest 50 messages”) are a sequential slice. Denormalise: the same message may live in `messages_by_channel` and `messages_by_user`, written together (logged batch or async fan-out).',
        'Keep partitions bounded: Cassandra guidance is under ~100 MB and ~100k rows. Unbounded keys (`channel_id` for a 10-year-old busy channel) become **large partitions** that slow compaction, repair and reads. Add a bucket to the key: Discord used `(channel_id, bucket)` with a fixed 10-day time window per bucket. Avoid `ALLOW FILTERING` and secondary indexes on high-cardinality columns, which scatter across the cluster.',
      ],
      code: {
        lang: 'sql',
        caption: 'Discord-style message table (CQL)',
        code: `CREATE TABLE messages (
  channel_id bigint,
  bucket     int,          -- e.g. days_since_epoch / 10
  message_id bigint,       -- Snowflake id: time-ordered
  author_id  bigint,
  content    text,
  PRIMARY KEY ((channel_id, bucket), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);

-- "Latest 50 messages": single partition, sequential slice
SELECT * FROM messages WHERE channel_id = ? AND bucket = ? LIMIT 50;`,
      },
      insight: 'Your partition key is a load-distribution decision and a product decision at once: every new query you did not model needs a new table plus a backfill, so senior engineers enumerate access patterns (including admin and deletion/GDPR flows) before choosing NoSQL.',
    },
    {
      title: 'DynamoDB: partitions, capacity, GSIs, single-table design',
      hook: 'Pricing and throttling are per partition, so key design is capacity planning.',
      body: [
        'Each partition holds up to 10 GB and serves up to **3,000 RCU and 1,000 WCU** (1 WCU = one write of ≤ 1 KB/s; 1 RCU = one strongly consistent read of ≤ 4 KB/s, or two eventually consistent). Items are capped at 400 KB. **Adaptive capacity** lends unused throughput to hot partitions and **split for heat** can isolate a hot key range, but one partition-key value can never exceed a single partition’s limits — a single hot key still throttles.',
        '**GSIs** are separate tables with their own partitions, updated asynchronously: reads are eventually consistent only, and a throttled GSI back-pressures writes to the base table. LSIs share the base partition key, must be defined at creation and cap each item collection at 10 GB. **Single-table design** co-locates entities that are read together under one partition key (`PK = CUSTOMER#42`, `SK = ORDER#2025-…`) so one `Query` returns a customer and their orders.',
        '`TransactWriteItems` gives ACID across up to 100 items (cost: 2× the capacity of normal writes); conditional writes (`attribute_not_exists`, version checks) give compare-and-set per item. **DynamoDB Streams** (24 h retention) feed CDC; global tables replicate across regions with last-writer-wins by default.',
      ],
      code: {
        lang: 'json',
        caption: 'Optimistic concurrency with a conditional update',
        code: `{
  "TableName": "app",
  "Key": { "PK": { "S": "CUSTOMER#42" }, "SK": { "S": "PROFILE" } },
  "UpdateExpression": "SET email = :e, version = :next",
  "ConditionExpression": "version = :expected",
  "ExpressionAttributeValues": {
    ":e": { "S": "ana@example.com" },
    ":expected": { "N": "7" },
    ":next": { "N": "8" }
  }
}`,
      },
      insight: 'A table with plenty of provisioned capacity can still throttle: total capacity is spread across partitions, and a few hot keys exceed their per-partition share. Watch `ThrottledRequests` together with CloudWatch Contributor Insights for the hottest keys, not just consumed vs provisioned.',
    },
    {
      title: 'MongoDB: replica sets, write/read concern and sharding',
      hook: 'The defaults decide whether an acknowledged write can be rolled back.',
      body: [
        'A **replica set** has one primary and secondaries replicating the oplog. Elections use a Raft-like protocol (pv1, terms, majority votes; `electionTimeoutMillis` 10 s default). If the old primary accepted writes that no majority replicated, they are **rolled back** after a new primary is elected.',
        '**Write concern** sets the ack point: `w: 1` (primary only) versus `w: "majority"` (default since MongoDB 5.0) with `j: true` for journaling. **Read concern** sets what you see: `local` (may be rolled back), `majority` (durable), `linearizable` (single-document, confirms primacy), `snapshot` (multi-document transactions). Causally consistent sessions give read-your-writes across secondaries.',
        '**Sharding**: `mongos` routers consult the config servers to map shard-key ranges (**chunks**, 128 MB default since 6.0) to shards; the **balancer** migrates chunks to even out data. Hashed shard keys spread writes; ranged keys keep range queries targeted but a monotonically increasing key sends all inserts to one shard. Queries without the shard key are scatter-gather.',
      ],
      insight: 'Pick the shard key for both cardinality and query targeting; resharding exists since 5.0 but rewrites the collection, so a poor key (e.g. a timestamp) is an expensive, multi-day fix.',
    },
  ],

  scaling: {
    body: [
      'Scale by adding nodes: new Cassandra nodes take token ranges and stream data from existing replicas (bootstrap); DynamoDB splits partitions automatically; MongoDB adds shards and the balancer moves chunks. Throughput scales roughly linearly **if** load is spread across many partition keys; it does not help a single hot key.',
      'Data plane vs control plane: Cassandra’s data plane is peer-to-peer (gossip, no master), so there is no metadata service to lose, but schema and topology changes must propagate via gossip (check `nodetool describecluster` for schema agreement before the next DDL). DynamoDB and MongoDB rely on metadata services (partition maps, config servers); routers cache that metadata, so a metadata outage hurts new routing decisions more than steady traffic.',
      'Multi-region: Cassandra replicates per DC (`NetworkTopologyStrategy {dc1: 3, dc2: 3}`) with `LOCAL_QUORUM` for local latency; DynamoDB global tables and MongoDB zone sharding offer active-active or region-pinned data. All active-active modes resolve concurrent cross-region writes (LWW or per-region ownership), so design data so that one region owns each record’s writes.',
    ],
    bullets: [
      'Throughput scales with distinct partition keys, not with node count alone.',
      'Keep partitions bounded (Cassandra < ~100 MB); bucket by time or hash suffix.',
      'Provision for compaction and repair I/O, not just request load.',
      'Leave ~50% free disk for STCS, ~20–30% for LCS.',
      'Use `LOCAL_QUORUM` per region; replicate async across regions.',
      'Shard keys and partition keys are near-permanent; model access patterns first.',
      'Cache or coalesce hot keys in front of the store.',
    ],
    diagram: {
      type: 'compare',
      title: 'Leaderless vs leader-per-partition',
      columns: [
        { name: 'Leaderless (Cassandra)', points: ['Any replica takes writes', 'No failover pause', 'LWW conflicts', 'Repair required'], tone: 'info' },
        { name: 'Leader per partition', points: ['DynamoDB, MongoDB, Bigtable', 'Strong reads from leader', 'Election on failure (s)', 'Simpler consistency'], tone: 'violet' },
      ],
    },
  },

  failures: [
    {
      name: 'Hot partition / hot key',
      symptom: 'One key (big channel, celebrity, popular SKU) saturates its RF nodes or DynamoDB partition: high p99 on those nodes, throttling, timeouts, while the cluster average looks fine.',
      detect: 'Per-node latency skew in `nodetool tablestats`/`toppartitions`; DynamoDB `ThrottledRequests` + Contributor Insights top keys; ScyllaDB per-shard load.',
      mitigate: 'Salt or bucket the key, cache and coalesce reads for hot keys, split write fan-out, rate limit abusive tenants.',
    },
    {
      name: 'Large partitions',
      symptom: 'Partitions of GBs: slow reads, heap pressure, compaction and repair choke on one partition, streaming stalls.',
      detect: 'Cassandra large-partition warnings (`compaction_large_partition_warning_threshold`), `nodetool tablehistograms` partition size percentiles.',
      mitigate: 'Add time/hash buckets to the partition key and backfill into the new table.',
    },
    {
      name: 'Tombstone overload',
      symptom: 'Reads time out with `TombstoneOverwhelmingException`; GC pauses; queue-like tables degrade over weeks.',
      detect: 'Tombstone warnings in logs, `tombstones scanned` histograms in `nodetool tablestats`, tracing slow queries.',
      mitigate: 'Remodel (time buckets, TWCS + TTL, range deletes), never use as a queue, run repair so tombstones can be purged.',
    },
    {
      name: 'Compaction backlog',
      symptom: 'SSTables per read climb, read latency drifts up, disk fills (STCS needs headroom).',
      detect: '`nodetool compactionstats` pending tasks, SSTables-per-read histogram, disk usage forecast.',
      mitigate: 'Correct strategy (LCS for reads, TWCS for TTL data), raise compaction throughput, add nodes before disk passes ~50–70%.',
    },
    {
      name: 'Zombie data / missed repair',
      symptom: 'Deleted data reappears after a node returns or after replacing a node.',
      detect: 'Repair completion age per table vs `gc_grace_seconds`; Reaper dashboards.',
      mitigate: 'Automated repair inside the grace window; replace long-dead nodes instead of restarting them.',
    },
    {
      name: 'GSI or replica back-pressure',
      symptom: 'DynamoDB base-table writes throttled because a GSI is under-provisioned; MongoDB `w: majority` writes slow because a secondary lags.',
      detect: 'GSI `WriteThrottleEvents`, `OnlineIndexThrottleEvents`; MongoDB replication lag and `majority` commit point.',
      mitigate: 'Provision GSIs at least as high as base-table writes (or on-demand), keep secondaries healthy and sized like the primary.',
    },
  ],

  warStories: [
    {
      title: 'Hot partitions and GC pauses drove a Cassandra → ScyllaDB migration',
      source: 'Discord engineering blog “How Discord stores trillions of messages”, March 2023',
      what: 'Discord’s messages cluster grew to 177 Cassandra nodes. Busy channels created hot partitions; reads on them caused latency spikes that cascaded across the cluster, compactions fell behind, and JVM GC pauses were a constant operational burden. They put Rust **data services** in front (request coalescing per channel, consistent-hash routing) and migrated trillions of messages to ScyllaDB in about nine days, ending on 72 nodes with p99 read latency around 15 ms (from 40–125 ms).',
      lesson: 'Hot keys are a data-modelling and request-shaping problem: coalesce concurrent reads for the same partition, and choose engines whose per-core design isolates noisy partitions.',
    },
    {
      title: 'Millions of tombstones in one channel',
      source: 'Discord engineering blog “How Discord stores billions of messages”, January 2017',
      what: 'Shortly after moving messages to Cassandra, loading one public channel became pathological: users had deleted almost all of its millions of messages, so reads scanned millions of tombstones to find a single live message, causing long JVM GC pauses on the replicas. Discord lowered `gc_grace_seconds` from 10 days to 2 days (with reliable repair) and changed query code to avoid scanning empty buckets.',
      lesson: 'Deletes are writes with a long tail. Model data so reads never scan large deleted ranges, and size `gc_grace_seconds` around how often repair really runs.',
    },
    {
      title: 'Metadata service overload took down DynamoDB in us-east-1',
      source: 'AWS “Summary of the Amazon DynamoDB Service Disruption”, September 20 2015',
      what: 'Storage servers periodically fetch their partition membership from an internal metadata service. GSI adoption had greatly increased membership data per server; after a brief network disruption many servers requested membership at once, responses exceeded timeouts, servers retried, and those that could not confirm membership stopped serving. Error rates stayed elevated for hours and cascaded to services built on DynamoDB until AWS paused requests and added metadata capacity.',
      lesson: 'Control-plane metadata grows with features, and synchronized retries after a blip become a self-inflicted DDoS. Budget timeouts against payload growth, and add jitter and backoff to every recovery path.',
    },
  ],

  numbers: [
    { label: 'Cassandra write latency', value: '~1 ms p50', note: 'Commit log + memtable; p99 a few ms' },
    { label: 'Writes per node', value: '10k–100k/s', note: 'Cassandra; ScyllaDB often several × higher per core' },
    { label: 'Default RF / QUORUM', value: '3 / 2', note: 'Tolerates one replica down' },
    { label: 'Partition size guidance', value: '< ~100 MB', note: 'And < ~100k rows (Cassandra)' },
    { label: 'gc_grace_seconds', value: '10 days', note: 'Repair must run more often' },
    { label: 'Tombstone thresholds', value: '1k warn / 100k fail', note: 'Per query, Cassandra defaults' },
    { label: 'DynamoDB partition', value: '10 GB, 3000 RCU, 1000 WCU', note: 'Per partition; item max 400 KB' },
    { label: 'DynamoDB transaction', value: '≤ 100 items', note: '2× capacity cost' },
    { label: 'MongoDB chunk size', value: '128 MB', note: 'Default since 6.0 (64 MB before)' },
    { label: 'Hinted handoff window', value: '3 h', note: '`max_hint_window` default' },
  ],

  capacity: {
    question: 'A chat app stores 2B messages/day (avg 300 B), peak 3× average, keeps 2 years, reads 5× writes. Size a Cassandra/ScyllaDB cluster (RF=3).',
    steps: [
      'Write rate: 2B / 86,400 ≈ 23k/s average ⇒ ~70k/s peak; with RF=3 the cluster performs ~210k replica writes/s.',
      'Reads: 5× ⇒ ~350k/s peak at LOCAL_QUORUM (2 replicas each) ⇒ ~700k replica reads/s, mostly hitting recent buckets in cache.',
      'Storage: 2B × 300 B × 730 days ≈ 440 TB raw; ×3 RF ≈ 1.3 PB; compression ~2× ⇒ ~650 TB; plus 30% headroom for compaction (LCS) ⇒ ~850 TB.',
      'Per node: ~4 TB usable data per node keeps streaming/repair times sane ⇒ ~210 nodes for storage; at ~10k–20k mixed ops/s per Cassandra node, 910k replica ops/s needs ~60–90 nodes, so **storage dominates**.',
      'With ScyllaDB on dense NVMe nodes (higher per-node throughput, comfortable at ~10+ TB per node), the same data fits in ~70–90 nodes.',
    ],
    answer: 'Roughly 200+ Cassandra nodes (or ~80 dense ScyllaDB nodes), storage-bound rather than throughput-bound. Cut it by tiering old buckets to cheaper storage or object storage, and partition by `(channel_id, 10-day bucket)` to keep partitions bounded.',
  },

  comparison: {
    caption: 'NoSQL families vs relational',
    columns: ['Product', 'Data model', 'Replication / consistency', 'Transactions', 'Sweet spot'],
    rows: [
      ['Cassandra / ScyllaDB', 'Wide-column, partition + clustering key', 'Leaderless, tunable N/R/W, LWW', 'Per-partition batches, LWT (Paxos)', 'Massive write-heavy time-ordered data'],
      ['DynamoDB', 'KV / document, PK + SK, GSIs', 'Leader per partition (Paxos), 3 AZs', 'ACID up to 100 items', 'Serverless, predictable key access at any scale'],
      ['MongoDB', 'JSON documents, rich secondary indexes', 'Replica set primary, Raft-like elections', 'Multi-document ACID (4.0+/4.2+)', 'Flexible schemas with rich queries'],
      ['Bigtable / HBase', 'Wide-column, range-partitioned rows', 'Single server per tablet, DFS replication', 'Single-row atomic', 'Huge sorted scans, analytics + serving'],
      ['PostgreSQL / MySQL', 'Relational, joins, constraints', 'Single primary + replicas', 'Full ACID, any rows', 'Default system of record up to one primary’s limits'],
    ],
  },

  whenNot: [
    'Access patterns are unknown or evolving with lots of ad-hoc queries, joins and reports: use a relational DB (and a warehouse).',
    'Invariants span many rows (ledgers, inventory, uniqueness across entities): use a relational or distributed SQL database with real transactions.',
    'The data fits comfortably on one Postgres primary: NoSQL adds modelling rigidity and operational burden for no gain.',
    'Queue or work-item semantics with frequent deletes: use Kafka/SQS; Cassandra tombstones will hurt.',
    'Full-text search or analytics: feed a search engine or columnar store via CDC.',
  ],

  interview: [
    {
      q: 'Explain N, R and W in a Dynamo-style store. What does R + W > N guarantee and what doesn’t it?',
      a: 'N is the replication factor, W the replicas that must ack a write, R the replicas consulted on a read. R + W > N makes the read and write sets overlap, so a read normally includes at least one replica with the latest acknowledged write. It does not give linearizability: failed writes may be partially applied and appear later, concurrent writes are resolved by LWW timestamps (clock skew loses writes), and without blocking read repair two reads can disagree. For compare-and-set you need Paxos LWTs, conditional writes or a consensus system.',
      followUps: [
        'What is a sloppy quorum and how does Cassandra differ from the Dynamo paper?',
        'How does LOCAL_QUORUM change this across regions?',
        'Why might QUORUM reads still be slow with one dead replica?',
      ],
      seniorSignal: 'Articulates what quorum overlap does not guarantee (linearizability, conflict-free concurrency) and names the right primitive for CAS.',
    },
    {
      q: 'Design the message storage for a Discord-like chat on Cassandra.',
      a: 'Access patterns: latest N messages of a channel, page backwards, fetch by id, edit/delete. Partition key `(channel_id, bucket)` where bucket is a fixed time window so partitions stay bounded, clustering key a time-ordered Snowflake id descending. Reads hit one partition (two at bucket boundaries); writes are appends. Edits overwrite cells (LWW is fine since only the author edits); deletes are row tombstones, so avoid scanning heavily deleted ranges and run repair inside gc_grace. Hot channels get request coalescing and caching in a service layer in front.',
      followUps: [
        'How do you choose the bucket size?',
        'How would you support “messages by user” for GDPR export?',
        'What breaks if a channel gets 100k messages/minute?',
      ],
      seniorSignal: 'Bounds partitions explicitly, reasons about tombstones and hot partitions, and adds a second table for each additional access pattern.',
    },
    {
      q: 'Why are LSM writes fast, and what do you pay for it?',
      a: 'A write is a sequential commit-log append plus an in-memory insert, with no read-before-write and no random I/O; disk work happens later as large sequential flushes and compactions. You pay in read amplification (merge memtable and several SSTables, mitigated by bloom filters and leveled compaction), write amplification from rewriting data during compaction, space amplification from obsolete versions and tombstones, and background I/O that competes with requests.',
      followUps: [
        'When would you choose LCS over STCS?',
        'Why is TWCS bad for data that gets updated?',
        'How does a B-tree engine compare on the same workload?',
      ],
      seniorSignal: 'Uses the read/write/space amplification triangle to choose a compaction strategy for a specific workload.',
    },
    {
      q: 'Your DynamoDB table is throttling but consumed capacity is far below provisioned. What is happening?',
      a: 'Capacity is enforced per partition (3,000 RCU / 1,000 WCU each), so a few hot partition-key values can exceed their partition’s limit while the table total looks idle. Adaptive capacity and split-for-heat help, but a single key cannot exceed one partition. Confirm with Contributor Insights for the hottest keys and check GSI throttling, which back-pressures base-table writes. Fix by raising key cardinality (write sharding with a suffix), caching hot reads (DAX), or redesigning the key.',
      followUps: [
        'How does write sharding complicate reads?',
        'What changes with on-demand mode?',
        'How would a GSI cause base-table throttling?',
      ],
      seniorSignal: 'Knows the per-partition limits and GSI back-pressure rather than just “increase capacity”.',
    },
    {
      q: 'How do deletes work in Cassandra, and how can deleted data come back?',
      a: 'A delete writes a tombstone with a timestamp, because SSTables are immutable. Reads see it shadowing older values; compaction drops the tombstone and shadowed data only after gc_grace_seconds (10 days). If a replica missed the delete (down, hint expired) and repair did not run within gc_grace, the other replicas purge the tombstone, and the stale replica’s old value is later treated as live and repaired back everywhere — a zombie.',
      followUps: [
        'Why are queue-like tables an anti-pattern?',
        'What are range tombstones?',
        'When is it safe to lower gc_grace_seconds?',
      ],
      seniorSignal: 'Connects tombstones, gc_grace and repair cadence into one operational rule.',
    },
    {
      q: 'When would you choose DynamoDB or Cassandra over Postgres, and when not?',
      a: 'Choose them when the access patterns are known and key-based, the write rate or data size exceeds a single primary (or is expected to soon), and you need multi-AZ or multi-region availability without failover pauses; DynamoDB adds zero-ops scaling and Cassandra/Scylla better economics at very high sustained throughput. Stay on Postgres when you need joins, ad-hoc queries, multi-row invariants, or when the data fits one well-sized primary, because NoSQL makes every new query a new table and backfill.',
      followUps: [
        'How would you migrate a hot table from Postgres to DynamoDB with no downtime?',
        'What about distributed SQL like Spanner or CockroachDB?',
        'How do you do reporting on NoSQL data?',
      ],
      seniorSignal: 'Decides from access patterns, invariants and growth rather than “NoSQL scales”, and names distributed SQL as the middle option.',
    },
    {
      q: 'In MongoDB, what does `w: 1` vs `w: "majority"` mean for durability during failover?',
      a: 'With `w: 1` the primary acks after applying locally; if it fails before a secondary replicates the write, the new primary does not have it and the old one rolls it back when it rejoins, so an acknowledged write is lost. With `w: "majority"` (the default since 5.0) the ack waits until a majority has the write, so any electable new primary has it. Pair it with `readConcern: "majority"` so reads never observe data that could be rolled back.',
      followUps: [
        'What is the latency cost of majority writes across regions?',
        'How do causally consistent sessions work?',
        'What happens during an election?',
      ],
      seniorSignal: 'Ties write concern to rollback behaviour and pairs it with the matching read concern.',
    },
  ],

  takeaways: [
    'NoSQL trades joins and ad-hoc queries for partitioned, replicated, key-addressed scale.',
    'Design tables from access patterns; partition key = distribution, clustering key = order.',
    'R + W > N gives overlap, not linearizability; LWW silently drops concurrent writes.',
    'LSM writes are cheap; compaction and reads pay the bill — provision for it.',
    'Tombstones, large partitions and hot keys are the three classic Cassandra outages.',
    'DynamoDB limits are per partition: 3000 RCU / 1000 WCU / 10 GB; GSIs are eventually consistent.',
    'Repair within gc_grace_seconds or deleted data comes back.',
  ],
};

export default deep;
