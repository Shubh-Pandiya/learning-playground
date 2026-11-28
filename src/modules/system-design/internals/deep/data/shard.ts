import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'shard',
  problem: {
    why: 'A single database primary has hard ceilings: disk size, buffer-pool RAM, write IOPS, WAL throughput, vacuum/compaction time and the blast radius of one machine. Replicas scale reads but every write still lands on one node. A shard is one horizontal slice of the data — a key range or set of hash slots — running as an ordinary database with its own replicas, so storage and write throughput scale by adding slices.',
    withoutIt: [
      'Write throughput is capped by one primary’s WAL fsync and I/O, no matter how many replicas you add.',
      'Working set outgrows RAM; cache misses turn into disk reads and p99 climbs steadily with data size.',
      'Maintenance (index builds, VACUUM, schema changes, backups, restores) scales with total data — a 20 TB restore takes many hours.',
      'One bad query, lock pileup or failover takes down 100% of tenants instead of 1/N.',
      'Postgres transaction-ID wraparound and table bloat get harder to manage as single tables reach billions of rows.',
    ],
    position: 'Behind the shard router (or a smart client): the router maps the partition key to a shard, and the shard — a primary plus replicas, or a Raft group — stores and serves only the keys it owns.',
    diagram: {
      type: 'flow',
      title: 'From one database to N shards',
      nodes: [
        { label: 'Router', sub: 'key → shard', tone: 'accent' },
        { label: 'Shard A', sub: 'keys [0, 1/3)', tone: 'violet' },
        { label: 'Shard B', sub: 'keys [1/3, 2/3)', tone: 'violet' },
        { label: 'Shard C', sub: 'keys [2/3, 1)', tone: 'violet' },
      ],
      caption: 'Each shard is a full database for its slice, with its own replicas and failover.',
    },
  },
  architecture: {
    overview: 'Internally a shard is a normal storage engine (InnoDB B+tree, RocksDB/Pebble LSM) plus an ownership layer: the range or slots it owns, the map version/epoch it believes is current, and a replication group that elects one writer. Around it sit the mechanisms that make a fleet of shards manageable: load/size statistics, split and move procedures, and an ID scheme that keeps keys unique without a global sequence.',
    diagram: {
      type: 'layers',
      title: 'Inside one shard',
      layers: [
        { name: 'Ownership', items: ['Key range / slots', 'Map epoch check', 'Reject stale routing'], tone: 'accent' },
        { name: 'Replication group', items: ['Leader / primary', 'Followers in other AZs', 'Lease / fencing'], tone: 'info' },
        { name: 'Storage engine', items: ['WAL', 'B+tree or LSM', 'Local secondary indexes'], tone: 'violet' },
        { name: 'Ops plane', items: ['Size + QPS stats', 'Split / merge', 'Snapshot + move'], tone: 'ok' },
      ],
    },
    blocks: [
      { name: 'Partition key + ownership metadata', what: 'The shard knows its range (`[user:5000, user:7500)`) or slot set and the map epoch. Requests routed under an older epoch are rejected so the router refreshes (MongoDB `StaleConfig`, CockroachDB `RangeKeyMismatchError`).' },
      { name: 'Leader / primary', what: 'One writer per shard: a MySQL/Postgres primary (Vitess, Citus) or a Raft leader with a lease (CockroachDB leaseholder, TiKV region leader) that can serve consistent reads locally.' },
      { name: 'Replicas', what: 'Async or semi-sync replicas (MySQL), or a 3/5-way Raft group committing on majority. Replicas of different shards are interleaved so every node leads some shards and follows others.' },
      { name: 'Storage engine', what: 'Unchanged from single-node: InnoDB, Postgres heap + B-tree, RocksDB/Pebble. Many small ranges can share one engine instance per node (CockroachDB, TiKV).' },
      { name: 'Local secondary indexes', what: 'Indexes on non-key columns cover only this shard’s rows; querying them without the partition key means asking every shard.' },
      { name: 'Statistics', what: 'Bytes, QPS, CPU per range and sampled hot keys — inputs to split, merge and rebalancing decisions.' },
      { name: 'Split / move machinery', what: 'Split at a size or load midpoint by updating range metadata atomically; move replicas by streaming a snapshot plus log catch-up, then transfer leadership.' },
      { name: 'ID generator', what: 'Per-shard unique id scheme (Snowflake-style or Instagram-style with the shard id embedded) so inserts need no global coordination.' },
    ],
    real: [
      { name: 'CockroachDB ranges', how: 'One ordered keyspace split into ranges (default max 512 MiB via `range_max_bytes`), each a Raft group with 3 replicas and a leaseholder. Ranges split on size and on load, and the allocator rebalances replicas and leases across nodes.' },
      { name: 'MongoDB shards', how: 'Each shard is a replica set (elections after `electionTimeoutMillis`, default 10 s). Data is grouped into chunks/ranges (128 MB default since 6.0) by ranged or hashed shard key; the balancer migrates ranges between shards.' },
      { name: 'Vitess shards', how: 'Each shard is a MySQL primary plus replicas, owning a range of 64-bit keyspace ids (`-80`, `80-`). Failover is orchestrated (VTOrc / Orchestrator); splits are explicit Reshard workflows.' },
      { name: 'DynamoDB partitions', how: 'Hash of the partition key picks a partition (~10 GB, up to 3,000 RCU / 1,000 WCU each). Partitions split automatically on size or sustained heat; each is replicated across 3 AZs with a leader.' },
      { name: 'Instagram on Postgres', how: 'Thousands of **logical shards** implemented as Postgres schemas, mapped onto a handful of physical servers. Ids embed the logical shard, so moving a schema to a new server only changes the shard→host map.' },
    ],
  },
  lifecycle: {
    summary: 'A write to a Raft-replicated shard (CockroachDB/TiKV style) inside one region. A MySQL shard with semi-sync replication has a similar shape.',
    stages: [
      { stage: 'Ownership + epoch check', what: 'Write for `user:6123` arrives with map epoch 41; the shard owns `[user:5000, user:7500)` and its epoch is 41 → accepted.', cost: 'In-memory compare', ms: 0.01 },
      { stage: 'Leaseholder / primary', what: 'Only the leaseholder proposes writes; a request at a follower is redirected.', cost: 'Possible extra hop if mis-routed', ms: 0.02 },
      { stage: 'Concurrency control', what: 'Acquire latches / row locks; check for conflicting intents (MVCC).', cost: 'In-memory; waits if contended', ms: 0.05 },
      { stage: 'Append to Raft log + WAL fsync', what: 'Leader appends the entry and fsyncs to its local disk.', cost: 'NVMe fsync ~0.1–1 ms', ms: 0.5 },
      { stage: 'Replicate to majority', what: 'Followers in two other AZs append + fsync and ack; commit at 2 of 3.', cost: 'Cross-AZ RTT ~0.5–2 ms', ms: 1.2 },
      { stage: 'Apply to state machine', what: 'Committed entry applied to the LSM memtable / B+tree; local secondary indexes updated in the same batch.', cost: 'Memory write', ms: 0.05 },
      { stage: 'Ack to router', what: 'Response returns through the router to the client.', cost: 'LAN RTT', ms: 0.3 },
      { stage: 'Background: stats + split check', what: 'Range size/QPS updated; if over threshold, a split is queued (not on the request path).', cost: 'Async', ms: 0 },
    ],
  },
  deepDives: [
    {
      title: 'Choosing the partition key',
      hook: 'The partition key is the most expensive decision in a sharded system — changing it means re-sharding everything.',
      body: [
        'Score candidates on four axes. **Cardinality**: enough distinct values to spread over thousands of logical shards (country or status fail). **Access distribution**: load per value must be reasonably even (a tenant id is fine until one tenant is 30% of traffic). **Query patterns**: the dominant reads and writes must include the key, or they scatter. **Transaction boundary**: rows changed together must share the key so transactions stay single-shard.',
        'Multi-tenant SaaS almost always lands on tenant/workspace id (Notion: workspace id; Figma grouped tables into “colos” sharing keys like file or org id). Consumer apps usually use user id, with content tables keyed by their owner so a user’s data co-locates.',
        'Write the top 10 queries and top 5 transactions down before choosing. If one key does not serve them, keep the key that serves writes/transactions and build secondary access paths (lookup tables, CDC-fed indexes) for the rest.',
      ],
      table: {
        caption: 'Candidate keys for an orders table',
        columns: ['Key', 'Cardinality', 'Distribution', 'Queries served', 'Verdict'],
        rows: [
          ['order_id', 'Very high', 'Even', 'Point lookups only', 'User history scatters'],
          ['user_id', 'High', 'Mostly even', 'History, cart, checkout tx', 'Usually best'],
          ['merchant_id', 'Medium', 'Very skewed', 'Merchant dashboards', 'Hot shards'],
          ['created_at', 'High', 'Monotonic', 'Time ranges', 'All inserts on last shard'],
          ['country', 'Very low', 'Skewed', 'Regional reports', 'Cannot scale'],
        ],
      },
      insight: 'A partition key that is perfect for reads but splits transactions across shards is wrong; read paths can be patched with indexes, transaction boundaries cannot.',
    },
    {
      title: 'Range vs hash vs compound partitioning',
      hook: 'Hash spreads load; range keeps order; compound keys get both for per-entity timelines.',
      body: [
        '**Range** partitioning keeps keys sorted, so scans like “orders for user 42 in March” or “all keys with prefix X” hit one or few shards, and splitting a range is a metadata operation. Its failure mode is monotonic keys: timestamps and auto-increment ids send every insert to the last range, which no amount of splitting fixes — the new right-hand range is immediately hot again.',
        '**Hash** partitioning spreads monotonic keys evenly but destroys order: any range query becomes scatter-gather. **Compound** keys hash a prefix and sort within it: Cassandra’s `PRIMARY KEY ((user_id), created_at)`, DynamoDB partition key + sort key, Bigtable row keys like `user#reverse_ts`. Each entity’s rows are ordered and local; entities are spread.',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Range', points: ['Ordered scans local', 'Split = metadata change', 'Monotonic keys hot-spot', 'Bigtable, HBase, CockroachDB'], tone: 'info' },
          { name: 'Hash', points: ['Even writes', 'Range scans scatter', 'Rehash costly unless slotted', 'DynamoDB, Cassandra, Vitess'], tone: 'accent' },
          { name: 'Compound', points: ['Hash entity, sort within', 'Per-entity timelines', 'Entity size must be bounded', 'Cassandra, DynamoDB PK+SK'], tone: 'ok' },
        ],
      },
      code: {
        lang: 'sql',
        caption: 'Cassandra compound key with time bucketing (Discord-style)',
        code: `CREATE TABLE messages (
  channel_id bigint,
  bucket     int,        -- e.g. 10-day window derived from message id
  message_id bigint,     -- Snowflake: time-ordered
  author_id  bigint,
  content    text,
  PRIMARY KEY ((channel_id, bucket), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);`,
      },
      insight: 'Compound keys need a bound on partition size: bucket by time (Discord’s `(channel_id, bucket)`) so one busy entity does not grow a single partition forever.',
    },
    {
      title: 'Hot partitions and the celebrity problem',
      hook: 'Balanced key counts do not mean balanced load: one celebrity, tenant or channel can melt a shard.',
      body: [
        'Skew comes from popularity, not hashing: a celebrity’s post receiving millions of likes, one enterprise tenant, a global counter, a big Discord server. Every request for that key lands on one shard (and one leader), so its CPU, lock contention and replication stream saturate while others idle.',
        'Mitigations by type. **Read-hot**: cache in front (with request coalescing), serve from followers/replicas where staleness is acceptable. **Write-hot**: key salting / write sharding — append a suffix `key#0..N−1` on write and fan in on read (AWS documents this for DynamoDB). **Hot range** (not single key): split it; CockroachDB and DynamoDB split automatically on load. **Hot tenant**: isolate it on its own shard via a directory entry.',
      ],
      code: {
        lang: 'python',
        caption: 'Write sharding a hot counter (DynamoDB-style)',
        code: `N = 16  # sub-keys for the hot item

def incr_like(post_id):
    shard = random.randrange(N)
    table.update_item(Key={"pk": f"post#{post_id}#{shard}"},
                      UpdateExpression="ADD likes :one",
                      ExpressionAttributeValues={":one": 1})

def get_likes(post_id):
    keys = [{"pk": f"post#{post_id}#{i}"} for i in range(N)]
    return sum(i.get("likes", 0) for i in batch_get(keys))`,
      },
      diagram: {
        type: 'flow',
        title: 'Escalation ladder',
        nodes: [
          { label: 'Cache + coalesce', sub: 'read-hot keys', tone: 'ok' },
          { label: 'Split range', sub: 'hot range, many keys', tone: 'info' },
          { label: 'Isolate tenant', sub: 'directory override', tone: 'accent' },
          { label: 'Salt key', sub: 'write-hot single key', tone: 'warn' },
        ],
      },
      insight: 'A single hot key cannot be split by any automatic rebalancer — CockroachDB and DynamoDB can split a range down to one key and stop there. Hot single keys need application-level design.',
    },
    {
      title: 'Secondary indexes: local vs global',
      hook: 'Indexing a non-key column forces a choice between scatter reads and cross-shard writes.',
      body: [
        'A **local** (document-partitioned) index lives inside each shard and indexes only that shard’s rows. Writes stay single-shard and atomic with the row, but a query by the indexed column must ask every shard. MongoDB, Elasticsearch and Cassandra secondary indexes work this way.',
        'A **global** (term-partitioned) index is itself partitioned by the indexed value: `email → user_id` lives on the shard that owns that email. Reads are targeted (one index shard, then one data shard), but each write now touches two shards, so the index is updated asynchronously (DynamoDB GSIs are eventually consistent) or via a cross-shard transaction (Vitess consistent lookup vindexes use ordered writes to stay consistent without 2PC).',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Local index', points: ['Write: 1 shard, atomic', 'Read by index: all shards', 'Mongo, ES, Cassandra 2i'], tone: 'info' },
          { name: 'Global index', points: ['Write: 2+ shards', 'Read: targeted', 'Usually async (DynamoDB GSI)', 'Vitess lookup vindex'], tone: 'accent' },
        ],
      },
      insight: 'Uniqueness on a non-key column (unique email across all shards) requires a global index — a local unique index only guarantees uniqueness within one shard.',
    },
    {
      title: 'Rebalancing: fixed partitions vs dynamic splits',
      hook: 'How the system grows decides whether adding capacity is moving files or rewriting keys.',
      body: [
        '**Fixed number of partitions**: create many more partitions than nodes up front and move whole partitions as nodes are added. Key → partition never changes; only partition → node does. Elasticsearch primaries, Kafka partitions, Redis Cluster’s 16384 slots, Couchbase’s 1024 vBuckets and Riak’s ring all work this way. You must guess the partition count well: too few caps growth, too many wastes per-partition overhead.',
        '**Dynamic splitting**: start with one range and split when it exceeds a size or load threshold — HBase regions (`hbase.hregion.max.filesize`, 10 GB default), Bigtable tablets, CockroachDB ranges (512 MiB), MongoDB chunks. Shard count tracks data size automatically, at the cost of a metadata service that must keep up with splits.',
        '**Logical shards on physical hosts** is the pragmatic middle ground for SQL fleets: Notion created 480 logical shards (schemas) on 32 Postgres hosts in 2021, chosen because 480 divides evenly in many ways, then later moved them onto more hosts without changing any key’s logical shard.',
      ],
      table: {
        columns: ['Strategy', 'Examples', 'Key remaps?', 'Operational cost'],
        rows: [
          ['Fixed partitions', 'ES, Kafka, Redis Cluster, Couchbase', 'Never', 'Must pick count up front'],
          ['Dynamic range split', 'HBase, Bigtable, CockroachDB, MongoDB', 'No (ranges split)', 'Metadata churn, split storms'],
          ['Logical → physical map', 'Instagram, Notion, Pinterest', 'Never', 'Manual moves, map distribution'],
          ['Hash % nodes', 'Naive designs', 'Almost all', 'Full migration on growth'],
        ],
      },
      insight: 'Choose logical shard counts with many divisors (480, 4096, 16384) so you can spread them evenly over many different physical host counts.',
    },
    {
      title: 'Per-shard replication and failover',
      hook: 'Sharding multiplies failovers: with 100 shards, some shard is failing over most weeks.',
      body: [
        'Each shard needs its own HA: a primary with replicas (MySQL/Postgres) or a Raft/Paxos group. Async replicas can lose the last transactions on failover; semi-sync or synchronous-quorum replication bounds that at the cost of commit latency. Raft-based shards (CockroachDB, TiKV, Spanner) commit on a majority, so a leader loss loses nothing acknowledged.',
        'The failover must be fenced: the old primary must stop accepting writes before the new one starts (STONITH, lease expiry, setting `read_only`/`super_read_only` on the demoted MySQL), and the router must learn the new primary. Raft leases do this structurally — a new leader cannot serve until the old lease has expired.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Fenced primary failover for one shard',
        actors: ['Orchestrator', 'OldPrimary', 'Replica', 'Topo', 'Router'],
        messages: [
          { from: 'Orchestrator', to: 'OldPrimary', label: 'health check fails', tone: 'bad' },
          { from: 'Orchestrator', to: 'OldPrimary', label: 'fence: read_only / kill', tone: 'warn' },
          { from: 'Orchestrator', to: 'Replica', label: 'pick most advanced GTID' },
          { from: 'Orchestrator', to: 'Replica', label: 'promote to primary', tone: 'ok' },
          { from: 'Orchestrator', to: 'Topo', label: 'update shard primary' },
          { from: 'Topo', to: 'Router', label: 'watch event', dashed: true },
          { from: 'Router', to: 'Replica', label: 'flush buffered writes', tone: 'ok' },
        ],
        caption: 'Fence first, promote second; routers buffer writes for the few seconds in between.',
      },
      insight: 'Spread each shard’s replicas across AZs but also spread primaries across hosts: if one host leads 20 shards, losing it is 20 simultaneous failovers.',
    },
    {
      title: 'ID generation without a global sequence',
      hook: 'Auto-increment per shard collides; a central sequence is a bottleneck. Embed time and shard in the id.',
      body: [
        '**Snowflake** (Twitter, 2010): 64-bit id = 41 bits of milliseconds since a custom epoch + 10 bits machine id + 12 bits per-ms sequence → 4,096 ids per ms per generator, roughly time-ordered, no coordination. Depends on clocks moving forward: generators must refuse to issue ids if the clock goes backwards.',
        '**Instagram** (2012): generated inside Postgres per logical shard: 41 bits ms timestamp + 13 bits logical shard id + 10 bits of a per-shard sequence (mod 1024). The shard id inside the id means any id can be routed without a lookup, and ids sort by time, which keeps B-tree inserts append-mostly.',
        'UUIDv4 avoids coordination but is random, which scatters B-tree inserts and inflates index size; UUIDv7 (time-ordered) fixes locality but carries no shard id.',
      ],
      code: {
        lang: 'sql',
        caption: 'Instagram-style id generated in a Postgres logical shard (schema s5)',
        code: `CREATE FUNCTION s5.next_id(OUT result bigint) AS $$
DECLARE
  epoch    bigint := 1314220021721;   -- custom epoch (ms)
  shard_id int    := 5;
  seq      bigint;
  now_ms   bigint;
BEGIN
  SELECT nextval('s5.id_seq') % 1024 INTO seq;
  SELECT floor(extract(epoch FROM clock_timestamp()) * 1000) INTO now_ms;
  result := ((now_ms - epoch) << 23) | (shard_id << 10) | seq;
END;
$$ LANGUAGE plpgsql;`,
      },
      insight: 'Embedding the logical shard in the id makes routing free for every child object, but locks the object to that logical shard forever — moves happen at the logical-shard level only.',
    },
  ],
  scaling: {
    body: [
      'Shards scale storage and writes linearly only if load is even and cross-shard work is rare. Plan the unit of scaling as the logical shard: many per host early, fewer per host later, moved by replica-based migration (add a replica on the new host, catch up, promote, retire the old).',
      'Every shard is its own failure domain: a bad shard affects 1/N of tenants. That is a feature — combine it with cell-based architecture (a cell = a set of shards plus app servers) to bound blast radius further.',
      'Multi-region: put each shard’s primary in its owners’ home region (user or tenant pinned to a region) and replicate elsewhere for DR and local reads. Raft-based systems can do this per row (CockroachDB `REGIONAL BY ROW`).',
    ],
    bullets: [
      'Logical shards ≫ physical hosts; move logical shards, never rehash keys.',
      'Size targets per shard: data that fits comfortably in hours-scale backup/restore, working set in RAM.',
      'Spread primaries/leaders across hosts and AZs; avoid one host leading many shards.',
      'Automate per-shard failover with fencing; you will run many of them.',
      'Rebalance with throttled snapshot streaming to protect live traffic.',
      'Treat schema migrations as fleet operations (run per shard, track progress, resume on failure).',
    ],
    diagram: {
      type: 'flow',
      title: 'Moving a logical shard to a new host',
      nodes: [
        { label: 'Add replica', sub: 'on new host', tone: 'info' },
        { label: 'Catch up', sub: 'snapshot + log', tone: 'accent' },
        { label: 'Fence + promote', sub: 'seconds of buffering', tone: 'warn' },
        { label: 'Update map', sub: 'logical → new host', tone: 'ok' },
        { label: 'Retire old', sub: 'after soak', tone: 'violet' },
      ],
    },
  },
  failures: [
    { name: 'Hot partition', symptom: 'One shard at 100% CPU or throttled while the fleet averages 30%.', detect: 'Per-shard CPU/QPS max/median ratio; DynamoDB `ThrottledRequests` + CloudWatch Contributor Insights; CockroachDB hot ranges page.', mitigate: 'Split range, isolate tenant, cache reads, salt write-hot keys.' },
    { name: 'Monotonic key hotspot', symptom: 'All inserts go to the newest range; it splits repeatedly but stays hot.', detect: 'Write QPS concentrated on the right-most range; split rate on one key span.', mitigate: 'Hash or bucket the key prefix; Snowflake ids with hashed partitioning.' },
    { name: 'Shard outgrows its host', symptom: 'Working set exceeds RAM; p99 creeps up; backups exceed window.', detect: 'Buffer-pool hit ratio, disk usage per shard vs target, backup duration trend.', mitigate: 'Move logical shards off the host, split, archive cold data.' },
    { name: 'Data loss on failover', symptom: 'Recent acknowledged writes missing after promotion of an async replica.', detect: 'Replication lag (`Seconds_Behind_Source`, `pg_stat_replication` replay lag) at failover time; GTID gap reports.', mitigate: 'Semi-sync / quorum commit, promote most advanced replica, fence old primary.' },
    { name: 'Global index drift', symptom: 'Lookup by email returns a user that moved or misses a new user.', detect: 'Periodic reconciliation job counting index vs base mismatches; DynamoDB `WriteThrottleEvents` on the GSI (index throttling back-pressures base-table writes).', mitigate: 'Consistent lookup writes (ordered or transactional), idempotent repair job.' },
    { name: 'Rebalance storm', symptom: 'Adding nodes triggers so many moves that network and disk saturate.', detect: 'Snapshot/streaming bytes per second, concurrent range moves, p99 during rebalance.', mitigate: 'Throttle (`kv.snapshot_rebalance.max_rate` in CockroachDB, Mongo balancer windows), add capacity before you are at the limit.' },
  ],
  warStories: [
    {
      title: 'Notion shards Postgres into 480 logical shards',
      source: 'Notion engineering blog, “Herding elephants: Lessons learned from sharding Postgres at Notion” (2021)',
      what: 'Notion’s monolithic Postgres was approaching limits (vacuum stalls, TXID wraparound risk). They partitioned by workspace id into 480 logical shards — 15 schemas on each of 32 physical databases — and migrated by double-writing via an audit log, backfilling, verifying, then switching over with a short maintenance window. In 2023 they re-sharded the same logical shards onto more physical hosts.',
      lesson: 'Choose a partition key that matches the tenancy boundary and create many logical shards with friendly divisors so future growth is a host move, not a re-key.',
    },
    {
      title: 'Foursquare’s 11-hour outage on an overloaded MongoDB shard',
      source: 'Foursquare / 10gen public postmortem (October 2010)',
      what: 'Check-in data was sharded by user id across two MongoDB shards. Growth was uneven, one shard’s data exceeded its RAM and it started thrashing to disk. Adding a shard and migrating chunks did not relieve it quickly, because migrated documents left fragmented pages and the resident memory did not shrink. The site was down for about 11 hours while the shard was repaired.',
      lesson: 'Monitor per-shard working set versus RAM and rebalance well before the limit; rebalancing is slowest exactly when the shard is already overloaded.',
    },
    {
      title: 'Discord’s hot Cassandra partitions',
      source: 'Discord engineering blog, “How Discord Stores Trillions of Messages” (2023)',
      what: 'Messages were stored in Cassandra keyed by `(channel_id, bucket)`. Very large servers produced hot partitions whose reads overloaded the replicas that owned them, causing latency that cascaded through the cluster, plus GC-pause and compaction toil. Discord moved to ScyllaDB and placed Rust data services in front that route by channel and **coalesce** concurrent requests for the same channel.',
      lesson: 'Partition-level popularity skew is an application problem: put coalescing and routing in front of the store, not just a bigger cluster.',
    },
  ],
  numbers: [
    { label: 'CockroachDB range max', value: '512 MiB', note: '`range_max_bytes`, 3 replicas by default' },
    { label: 'HBase region split', value: '10 GB', note: '`hbase.hregion.max.filesize` default' },
    { label: 'MongoDB chunk', value: '128 MB', note: 'Default since 6.0' },
    { label: 'DynamoDB partition', value: '~10 GB, 3k RCU / 1k WCU', note: 'Per-partition limits' },
    { label: 'Elasticsearch shard size', value: '10–50 GB', note: 'Common sizing guidance' },
    { label: 'Redis Cluster slots', value: '16,384', note: 'CRC16(key) mod 16384' },
    { label: 'Snowflake id', value: '41 + 10 + 12 bits', note: '4,096 ids/ms per generator' },
    { label: 'Instagram id', value: '41 + 13 + 10 bits', note: '8,192 logical shards max' },
    { label: 'Notion 2021', value: '480 logical / 32 hosts', note: '15 schemas per host' },
    { label: 'Mongo election timeout', value: '10 s', note: '`electionTimeoutMillis` default' },
  ],
  capacity: {
    question: 'You have 2 TB of data growing 50%/year and 30k writes/s at peak, also growing 50%/year. Each shard should stay ≤ 500 GB and ≤ 5k writes/s. Plan for 3 years.',
    steps: [
      'Growth factor over 3 years: 1.5³ ≈ 3.4.',
      'Data: 2 TB × 3.4 ≈ 6.8 TB → 6.8 TB / 500 GB ≈ 14 shards.',
      'Writes: 30k × 3.4 ≈ 100k writes/s → 100k / 5k = 20 shards (write-bound dominates).',
      'Add 50% headroom for skew and failover → ~30; round to 32 physical shards eventually.',
      'Create 1,024 logical shards now (32 per host at the end, 128 per host if you start on 8 hosts).',
      'HA: primary + 2 replicas per physical shard → 96 database instances at year 3.',
    ],
    answer: 'Start with 1,024 logical shards on ~8 primaries, grow to 32 primaries (96 instances with replicas) by moving logical shards — no re-keying needed.',
  },
  comparison: {
    caption: 'How real systems partition',
    columns: ['Product', 'Partitioning', 'Split / rebalance', 'Replication per shard', 'Unit size'],
    rows: [
      ['DynamoDB', 'Hash of partition key, sort key within', 'Automatic on size/heat', '3 AZs, leader-based', '~10 GB'],
      ['Cassandra', 'Murmur3 token ring + clustering order', 'Add nodes, stream ranges', 'RF per DC, tunable consistency', 'Keep partitions < ~100 MB'],
      ['MongoDB', 'Ranged or hashed shard key', 'Balancer migrates chunks', 'Replica set per shard', '128 MB chunks'],
      ['CockroachDB', 'Ordered ranges', 'Auto split on size/load + rebalance', 'Raft, 3 replicas', '512 MiB'],
      ['Vitess', 'Hash vindex → keyspace-id ranges', 'Explicit Reshard workflow', 'MySQL primary + replicas', 'Operator-chosen'],
      ['Elasticsearch', 'hash(_routing) % primaries', 'Fixed; _split / _shrink', 'Primary + replica shards', '10–50 GB'],
    ],
  },
  whenNot: [
    'One primary still fits with headroom after tuning, read replicas and caching — sharding is a one-way door that complicates every query, migration and on-call shift.',
    'The workload is dominated by cross-entity joins and ad-hoc analytics: use a warehouse or columnar store, or a distributed SQL database.',
    'You need strong global invariants across keys (global uniqueness, cross-account balances) on every write: prefer a distributed SQL database that shards with consensus and transactions built in.',
    'The data is append-only time series with time-range queries: use time-based table partitioning (Postgres declarative partitioning, TimescaleDB) on one node first.',
    'A managed store already partitions for you (DynamoDB, Bigtable, Spanner): design the key well instead of building your own shards.',
  ],
  interview: [
    {
      q: 'How do you choose a partition key for a multi-tenant SaaS product?',
      a: 'Start from the transaction boundary and dominant queries: almost all reads and writes are scoped to one tenant, so tenant/workspace id keeps transactions single-shard and queries targeted. Check cardinality (thousands+ of tenants) and skew: if a few tenants are huge, plan a directory override so they can live on dedicated shards, and possibly sub-partition them by a second key. Cross-tenant admin queries go to a CDC-fed warehouse.',
      followUps: ['Your largest tenant is 25% of traffic. Now what?', 'How do you handle users that belong to many tenants?', 'How do you migrate a tenant between shards?'],
      seniorSignal: 'Plans for tenant skew and tenant moves explicitly rather than assuming hashing will even it out.',
    },
    {
      q: 'Your table is range-partitioned by created_at and one shard is always at 100% CPU. Why, and how do you fix it?',
      a: 'Monotonic keys send every insert to the right-most range; splitting just creates a new hot right-most range. Fix the key: hash or bucket the prefix (e.g. `(hash(user_id) % 64, created_at)` or a compound key `(user_id, created_at)`), so inserts spread while ordering is preserved within each prefix. Time-range queries then fan out to the buckets, which is acceptable if bounded.',
      followUps: ['What does a time-range query cost after the change?', 'How do you migrate existing data?'],
      seniorSignal: 'Explains why automatic splitting cannot fix a monotonic hotspot and quantifies the read-side cost of the fix.',
    },
    {
      q: 'Local or global secondary index for “find user by email” in a user table sharded by user_id?',
      a: 'A global index partitioned by email: a lookup is one targeted read for email → user_id then one for the row, and uniqueness of email can be enforced. Local indexes would scatter to every shard and could not enforce global uniqueness. The cost is that writes touch two shards, so either update the index asynchronously and tolerate lag, or use ordered/consistent lookup writes (Vitess consistent_lookup) or a transaction.',
      followUps: ['How do you keep the index consistent on email change?', 'What happens if the index write succeeds and the row write fails?'],
      seniorSignal: 'Connects the global-vs-local choice to uniqueness enforcement and write consistency semantics.',
    },
    {
      q: 'How would you design ids for a sharded system?',
      a: 'Use 64-bit, roughly time-ordered ids generated without coordination: Snowflake (timestamp + worker id + sequence) or Instagram-style with the logical shard id embedded so any id routes without a lookup. Time ordering keeps B-tree inserts append-mostly and enables cursor pagination. Guard against clock regressions and reserve bits for growth (shard bits cap the number of logical shards).',
      followUps: ['What if the clock jumps backwards?', 'Why not UUIDv4?', 'How many ids per second can one generator issue?'],
      seniorSignal: 'Discusses index locality, embedded routing information and clock failure modes.',
    },
    {
      q: 'Fixed number of partitions or dynamic splitting — which would you choose for a new system?',
      a: 'For a SQL fleet I operate myself, a fixed large number of logical shards mapped to hosts: key → shard never changes, moves are whole-shard replica migrations, and behaviour is predictable. Dynamic splitting is great when the database does it for you (CockroachDB, Bigtable, DynamoDB) because the metadata service and split logic are already solved. The risk of fixed partitions is choosing too few; choose generously with many divisors.',
      followUps: ['How would you pick the number?', 'What is the overhead of too many partitions?'],
      seniorSignal: 'Ties the choice to who operates the metadata/split machinery and to divisibility for future host counts.',
    },
    {
      q: 'A celebrity post gets 2M likes per minute. Your likes are sharded by post_id. What breaks and what do you do?',
      a: 'All like writes and count reads for that post hit one shard and one row/partition, saturating its leader and lock. For writes, split the counter into N sub-keys chosen randomly and sum on read (or aggregate likes in a stream processor and write batched counts). For reads, cache the count with a short TTL and coalesce. Keep the per-user “did I like this” record keyed by user to avoid the hot partition for that query.',
      followUps: ['How do you show an exact count?', 'How do you detect such posts early?'],
      seniorSignal: 'Separates the counter, the membership set and the read path, and accepts approximate counts where the product allows.',
    },
  ],
  takeaways: [
    'A shard is an ordinary database for one key range or slot set, plus ownership checks and its own HA.',
    'Pick the partition key from transaction boundaries first, then dominant queries, cardinality and skew.',
    'Range keeps order but hot-spots on monotonic keys; hash spreads but scatters ranges; compound keys get both.',
    'Hot single keys cannot be split by any rebalancer — cache, coalesce or salt them.',
    'Global indexes give targeted reads and global uniqueness at the cost of multi-shard writes.',
    'Create many logical shards with friendly divisors and move them; never rehash keys to grow.',
    'Embed time and shard in ids (Snowflake, Instagram) to avoid global sequences and to route for free.',
  ],
};
export default deep;
