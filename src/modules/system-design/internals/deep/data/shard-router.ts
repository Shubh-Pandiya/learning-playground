import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'shard-router',
  problem: {
    why: 'Once one database primary can no longer hold the data or absorb the writes, you split the data across N databases. Something must then answer, for every query, **which database owns this row** — and keep answering correctly while shards are added, split, moved and failed over. The shard router is that something: it hides N databases behind one logical endpoint and owns the mapping key → shard → current primary.',
    withoutIt: [
      'Every service embeds its own copy of the shard map; a reshard means a coordinated redeploy of every client, and one stale client writes rows to the wrong shard.',
      'Queries without the shard key have nowhere to go: every team hand-rolls fan-out, merge-sort and LIMIT logic, each with different bugs.',
      'Failover of one shard primary requires every client to learn the new host; without a central map they keep writing to the demoted node.',
      'Online resharding is impossible: there is no single place to pause writes, flip the map atomically and resume.',
      'Connection counts explode: M app instances × N shards × pool size direct connections instead of pooled router connections.',
    ],
    position: 'Sits between application servers and the shard databases (or inside the app as a library). It reads the shard map from a topology service (etcd/ZooKeeper/config servers) and forwards each query to one shard, or scatters it to all and merges results.',
    diagram: {
      type: 'flow',
      title: 'Where the router sits',
      nodes: [
        { label: 'App servers', sub: 'normal MySQL/PG driver' },
        { label: 'Shard router', sub: 'VTGate / mongos / coordinator', tone: 'accent' },
        { label: 'Shard map cache', sub: 'versioned, from etcd', tone: 'info' },
        { label: 'Shard 1..N', sub: 'primary + replicas', tone: 'violet' },
      ],
      caption: 'The router is stateless; the only state it depends on is the versioned shard map.',
    },
  },
  architecture: {
    overview: 'A production router has a **data plane** (protocol frontend, query planner, key mapper, dispatcher, merger) that runs on every request using only in-memory state, and a **control plane** (topology service, resharding workflows, health checker) that changes the map. The hot path never touches the topology store: routers keep a versioned cached copy and get pushed updates via watches. Shards defend themselves by checking the routing version, so a stale router gets an error rather than silently writing to the wrong place.',
    diagram: {
      type: 'layers',
      title: 'Router anatomy (Vitess-style)',
      layers: [
        { name: 'Frontend', items: ['MySQL/PG wire protocol', 'Conn pooling', 'Auth'], tone: 'accent' },
        { name: 'Planner', items: ['SQL parse', 'Plan cache', 'Vindex lookup', 'Route / Scatter / Join'], tone: 'info' },
        { name: 'Executor', items: ['Tablet pick (primary/replica)', 'Parallel fan-out', 'Merge-sort / aggregate', 'Write buffering'], tone: 'ok' },
        { name: 'Control plane', items: ['Topo (etcd/ZK/Consul)', 'Health check stream', 'VReplication workflows'], tone: 'violet' },
      ],
      caption: 'Only the bottom layer changes the map; the top three run per query from memory.',
    },
    blocks: [
      { name: 'Wire-protocol frontend', what: 'Speaks MySQL (VTGate), MongoDB (mongos) or Postgres (Citus coordinator) so apps use unmodified drivers. Terminates client connections and multiplexes them onto a small pool per shard.' },
      { name: 'Query planner + plan cache', what: 'Parses SQL and classifies it: single-shard **Route**, **Scatter**, **Join** (nested-loop across shards), **Reference** (read replicated table locally). Plans are cached by normalized query text so the parse cost is paid once.' },
      { name: 'Key mapper (vindex / shard function)', what: 'Turns the shard-key value into a position in the keyspace: Vitess `hash` vindex → 64-bit keyspace id; MongoDB hashed/ranged shard key → chunk; Citus `hash(dist_col)` → shard id. Lookup vindexes map secondary columns (email) to the keyspace id via a side table.' },
      { name: 'Shard map (SrvKeyspace / routing table)', what: 'Ordered list of ranges `-40, 40-80, 80-c0, c0-` → shard → serving tablets. Stored in the topology service, cached in every router with a version/epoch and refreshed by watch or on a stale-version error.' },
      { name: 'Health-checked tablet set', what: 'Per shard, the live primary and replicas with replication lag. Reads can target replicas under a lag threshold; writes always go to the primary.' },
      { name: 'Dispatcher + merger', what: 'Single-shard: stream through. Scatter: parallel requests, then merge-sort for ORDER BY, re-apply LIMIT, sum partial COUNT/SUM, compute AVG from SUM/COUNT, dedupe DISTINCT.' },
      { name: 'Write buffer', what: 'During a primary failover or resharding cutover the router holds incoming writes for a few seconds instead of failing them (Vitess `--enable_buffer`), then flushes them to the new primary.' },
    ],
    real: [
      { name: 'Vitess VTGate', how: 'Stateless Go proxies; topology in etcd/ZooKeeper/Consul; a `vttablet` sidecar beside every MySQL enforces query rules and serving state. VSchema declares vindexes per table. VReplication powers Reshard/MoveTables. Runs Slack, GitHub, YouTube-era MySQL; PlanetScale is managed Vitess.' },
      { name: 'MongoDB mongos', how: 'Routers cache the routing table from the **config server replica set** (CSRS). Collections split into chunks (128 MB default since 6.0) by ranged or hashed key; the balancer migrates chunks. Shards reject requests with an older shard version (`StaleConfig`) so mongos refreshes and retries.' },
      { name: 'Citus coordinator', how: 'A Postgres extension: the coordinator stores shard metadata in catalog tables (`pg_dist_shard`, `pg_dist_placement`), rewrites queries into per-shard fragments and pushes down co-located joins. `citus.shard_count` defaults to 32. Rebalancing moves shards via logical replication.' },
      { name: 'ProxySQL', how: 'A MySQL proxy whose `mysql_query_rules` route by regex, schema, user or query comment to hostgroups. It is primarily read/write splitting; sharding is possible via rules but it has no vindex, scatter-merge or resharding workflow — the app owns the shard logic.' },
      { name: 'Client library (Instagram, Pinterest, Figma-era apps)', how: 'The shard id is embedded in the 64-bit object id (Instagram: 13 bits) and a config table maps thousands of logical shards to a few physical hosts. Zero extra hop, but the map must be distributed to every client consistently.' },
    ],
  },
  lifecycle: {
    summary: 'A single-shard read through a Vitess-style proxy adds roughly one LAN hop plus sub-millisecond CPU. A scatter query is dominated by the slowest shard.',
    stages: [
      { stage: 'Accept on pooled connection', what: 'App driver sends `SELECT … FROM orders WHERE user_id = 42 ORDER BY created_at DESC LIMIT 20` to a VTGate behind an L4 LB.', cost: 'LB hop + reuse of an open connection', ms: 0.2 },
      { stage: 'Normalize + plan cache hit', what: 'Literals are replaced by bind vars; the normalized text hits the plan cache → plan type `Route` on `user_id`.', cost: 'Hash lookup; a cache miss costs a full parse (~0.1–0.5 ms)', ms: 0.03 },
      { stage: 'Vindex: key → keyspace id', what: '`hash` vindex maps 42 → 64-bit keyspace id `0x6c…`.', cost: 'One hash computation', ms: 0.01 },
      { stage: 'Shard map lookup', what: 'In-memory SrvKeyspace: `0x6c…` ∈ range `40-80` → shard `40-80`.', cost: 'Binary search over ranges, no network', ms: 0.01 },
      { stage: 'Tablet selection', what: 'Primary for writes; for reads, a healthy replica in the local cell with lag under threshold.', cost: 'In-memory health-check stream state', ms: 0.01 },
      { stage: 'Forward to vttablet', what: 'gRPC to the vttablet beside the shard primary; it checks query rules and serving state for the shard.', cost: 'One LAN RTT', ms: 0.3 },
      { stage: 'MySQL executes', what: 'Index range scan on `(user_id, created_at)`; 20 rows.', cost: 'Buffer-pool hit; disk read would be 1–10 ms', ms: 1.0 },
      { stage: 'Stream result back', what: 'Rows stream through VTGate unmodified for a single-shard route.', cost: 'Serialization + RTT', ms: 0.2 },
      { stage: 'Scatter variant (no shard key)', what: '`WHERE status = "late"` fans out to all 32 shards; each returns its top 20; VTGate merge-sorts 640 rows to 20.', cost: 'max(shard latencies) — p99 of 32 draws', ms: 6 },
    ],
  },
  deepDives: [
    {
      title: 'Where to put the router: library vs proxy vs coordinator',
      hook: 'The placement decides your extra hop, your blast radius and how fast a shard-map change reaches every caller.',
      body: [
        'A **client library** (Instagram, early Pinterest, many in-house ORMs) routes inside the app process: zero extra hop, no proxy fleet to run. The cost is distribution: every service in every language needs the same library version and map; a stale or buggy client is a correctness bug, and resharding requires every client to observe the cutover.',
        'A **proxy** (VTGate, mongos, ProxySQL) is a separate stateless fleet: +0.3–1 ms and another tier to capacity-plan, but language-agnostic, one place to buffer writes during cutover, and connection multiplexing to shards. A **coordinator** (Citus) is a database node that also plans distributed SQL — strongest SQL coverage, but it is stateful metadata and must be made HA itself.',
        'Many large systems end up hybrid: a thin smart client for hot single-key paths and a proxy for everything else. Figma’s 2024 sharding built a Go proxy (DBProxy) precisely so application code would not need to know about shards.',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Client library', points: ['0 extra hops', 'Map in every process', 'Per-language library', 'Hard coordinated cutover'], tone: 'info' },
          { name: 'Proxy fleet', points: ['+1 LAN hop', 'Language-agnostic', 'Central write buffering', 'Conn multiplexing'], tone: 'accent' },
          { name: 'Coordinator node', points: ['Full distributed SQL', 'Stateful metadata', 'Can bottleneck', 'Citus, Postgres-XL'], tone: 'violet' },
        ],
      },
      insight: 'The real cost of a client library is not latency — it is that the shard map becomes a distributed-systems problem across hundreds of deploy units. A proxy turns map consistency into a problem of one fleet you control.',
    },
    {
      title: 'Shard map: hash vs range vs directory, and how it is cached',
      hook: 'The mapping function decides whether you can split a hot range, move one tenant, or do range scans.',
      body: [
        '**Hash** (Vitess `hash` vindex, Mongo hashed keys, Citus): even spread, monotonic ids are safe, but range scans across keys scatter. **Range** (Mongo ranged, Bigtable/HBase, CockroachDB): ordered scans stay local and splitting is natural, but monotonic keys (timestamps, auto-increment) hot-spot the last range. **Directory** (a lookup table key → shard): any tenant can live anywhere and be moved alone, at the cost of an extra lookup and a table that must be HA and cached.',
        'Vitess combines them: hash the key into a 64-bit keyspace id, then assign **ranges of keyspace ids** to shards. Splitting `40-80` into `40-60` and `60-80` is then a range split, not a rehash. That two-level design — hash for spread, ranges for elasticity — is the pattern to reach for.',
        'The map lives in a consensus store (etcd, ZooKeeper, Mongo config servers). Routers **watch** it and keep an in-memory copy; if the store is down, routing continues from cache — only map changes stop. Correctness comes from versioning: each request carries the version it routed with, and shards reject older versions.',
      ],
      code: {
        lang: 'json',
        caption: 'Vitess VSchema: hash vindex on user_id, lookup vindex for email',
        code: `{
  "sharded": true,
  "vindexes": {
    "hash": { "type": "hash" },
    "email_lookup": {
      "type": "consistent_lookup_unique",
      "params": { "table": "user_email_idx", "from": "email", "to": "keyspace_id" },
      "owner": "users"
    }
  },
  "tables": {
    "users": { "column_vindexes": [
      { "column": "user_id", "name": "hash" },
      { "column": "email", "name": "email_lookup" } ] },
    "orders": { "column_vindexes": [ { "column": "user_id", "name": "hash" } ] }
  }
}`,
      },
      insight: 'Shard `orders` by `user_id`, not `order_id`: the shard key should be the entity that transactions and the dominant queries group by, so related rows co-locate and most transactions are single-shard.',
    },
    {
      title: 'Scatter-gather and the tail-latency tax',
      hook: 'A query without the shard key costs N× the load and inherits the worst shard’s p99.',
      body: [
        'If each shard is slow (above its p99) 1% of the time, a query that must wait for all N shards is slow with probability 1 − 0.99^N: 10 shards → 9.6%, 32 → 27.5%, 100 → 63%. Your fan-out p50 approaches the per-shard p99. This is Dean & Barroso’s “The Tail at Scale” applied to databases.',
        'Load multiplies too: a scatter query costs one query on **every** shard, so adding shards does not add capacity for it. 10% scatter traffic on 32 shards can outweigh the 90% that is single-shard (see the capacity estimate).',
        'Merging is subtle: `ORDER BY … LIMIT 20 OFFSET 1000` must fetch 1020 rows from each shard; `AVG` must be rewritten to `SUM`/`COUNT`; `COUNT(DISTINCT)` needs all distinct values or a sketch (HyperLogLog). Deep pagination over scatter is a classic production fire.',
      ],
      bullets: [
        'Mitigate with secondary lookup tables (email → user_id) so alternate access paths become 2 targeted hops.',
        'Push analytics and search to a CDC-fed read model (Elasticsearch, warehouse) instead of the OLTP shards.',
        'Use keyset pagination (`WHERE (created_at, id) < (?, ?)`) rather than OFFSET.',
        'Hedge or set per-shard deadlines and return partial results where the product allows it.',
      ],
      code: {
        lang: 'python',
        caption: 'Probability that a fan-out query hits at least one slow shard',
        code: `def p_slow(n_shards, p_shard_slow=0.01):
    return 1 - (1 - p_shard_slow) ** n_shards

# p_slow(10) = 0.096, p_slow(32) = 0.275, p_slow(100) = 0.634`,
      },
      insight: 'Count scatter queries as a first-class SLO metric. The fraction of traffic that scatters, multiplied by shard count, is what actually sizes each shard — not total QPS divided by N.',
    },
    {
      title: 'Cross-shard joins and transactions',
      hook: 'Sharding quietly removes JOIN and ACID across keys; the router can fake both, at a price.',
      body: [
        'Joins between tables sharded on the same key (users and orders on `user_id`) are pushed down whole to one shard — Citus calls this **co-location**. Small, rarely-written tables (countries, plans) are **reference tables** copied to every shard so joins against them stay local. Anything else becomes a router-side nested-loop join: for each row from shard A, query shard B — slow and unbounded.',
        'Vitess exposes the trade-off directly with `--transaction_mode`: `SINGLE` rejects transactions that touch more than one shard; `MULTI` (default) commits shard by shard and can leave a **partial commit** if the second shard fails; `TWOPC` runs two-phase commit with a coordinator log, paying extra round trips and blocking if the coordinator dies mid-protocol.',
        'The senior design move is to make cross-shard transactions rare by key choice, then handle the remainder with sagas (per-shard local transactions plus compensations) or an outbox for downstream effects, rather than leaning on 2PC on the hot path.',
      ],
      table: {
        caption: 'Options for work spanning shards',
        columns: ['Approach', 'Atomic?', 'Latency', 'Failure behaviour'],
        rows: [
          ['Co-located keys', 'Yes (local tx)', '1 shard', 'Same as single DB'],
          ['MULTI (best effort)', 'No', '+1 commit per shard', 'Partial commits possible'],
          ['2PC (TWOPC)', 'Yes', '+2 RTT, locks held', 'Blocks on coordinator loss'],
          ['Saga + compensation', 'Eventually', 'Async', 'Visible intermediate states'],
        ],
      },
      insight: 'If an interview design needs frequent cross-shard transactions, the shard key is wrong. Say so, and re-key around the transaction boundary before reaching for 2PC.',
    },
    {
      title: 'Online resharding: copy, catch up, verify, cut over',
      hook: 'Splitting a live shard without downtime is the hardest thing a router does.',
      body: [
        'Every serious system uses the same four phases. **Copy**: snapshot rows from the source into the target shards, filtered by the target key ranges. **Catch up**: tail the source binlog/oplog and apply changes to targets until lag is near zero (Vitess VReplication, Mongo range migration, Citus logical replication). **Verify**: diff source and target (Vitess `VDiff`). **Cut over**: switch reads first, then writes.',
        'The write cutover is a short critical section: stop writes on the source (Vitess sets denied tables on the source primary), wait for targets to apply the final binlog position, update the shard map in topo, let routers buffer writes in the meantime, then release them to the new shards. Vitess starts **reverse replication** target → source at cutover so you can `ReverseTraffic` if the new shards misbehave.',
        'App-level dual writes (write to old and new, backfill, compare, switch reads) is the alternative when you have no CDC-based tool. It is error-prone: the two writes are not atomic, so you need idempotent backfill and a reconciliation job. Notion’s 2021 migration used an audit-log-driven catch-up rather than naive dual writes for this reason.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Write cutover (Vitess-style)',
        actors: ['Operator', 'Router', 'Source', 'Targets', 'Topo'],
        messages: [
          { from: 'Source', to: 'Targets', label: 'binlog stream (lag ~0)', dashed: true },
          { from: 'Operator', to: 'Source', label: 'deny writes' },
          { from: 'Router', to: 'Router', label: 'buffer incoming writes', tone: 'warn' },
          { from: 'Targets', to: 'Operator', label: 'caught up to GTID' },
          { from: 'Operator', to: 'Topo', label: 'new map version' },
          { from: 'Topo', to: 'Router', label: 'watch: map changed', dashed: true },
          { from: 'Router', to: 'Targets', label: 'flush buffered writes', tone: 'ok' },
          { from: 'Targets', to: 'Source', label: 'reverse replication', dashed: true },
        ],
        caption: 'Writes pause for seconds, not minutes; reverse replication keeps rollback possible.',
      },
      code: {
        lang: 'bash',
        caption: 'Vitess Reshard workflow (v17+ vtctldclient; flags vary by version)',
        code: `vtctldclient Reshard --workflow split --target-keyspace customer \\
  create --source-shards '40-80' --target-shards '40-60,60-80'
vtctldclient VDiff --workflow split --target-keyspace customer create
vtctldclient Reshard --workflow split --target-keyspace customer \\
  SwitchTraffic --tablet-types "rdonly,replica"
vtctldclient Reshard --workflow split --target-keyspace customer SwitchTraffic
# if needed: ... ReverseTraffic ; when confident: ... Complete`,
      },
      insight: 'Switch reads before writes and keep reverse replication running: the rollback plan is what makes a reshard a routine operation instead of a one-way door.',
    },
    {
      title: 'Routing consistency during migration',
      hook: 'The bug that loses data is a router that still believes the old map for a few seconds.',
      body: [
        'Watches are asynchronous: after the topo changes, some routers learn of it later than others. If the source shard still accepted writes, a lagging router would write rows the targets never see. So correctness must not depend on routers being up to date — the **shard** must refuse.',
        'MongoDB attaches a shard version to every routed operation; a shard whose version is newer replies `StaleConfig`, and mongos refreshes from the config servers and retries. During a chunk migration the donor enters a short **critical section** that blocks writes to that range until the recipient commits ownership. Vitess achieves the same by putting denied-tables / non-serving state on the source tablets before the map flips.',
        'This is fencing, the same idea as fencing tokens for leases: every request carries the epoch it was routed under, and the owner rejects lower epochs. Without it, any resharding scheme — including hand-rolled ones — has a window for silently misplaced writes.',
      ],
      bullets: [
        'Always: version the map, carry the version on requests, enforce on the shard.',
        'Never: rely on TTL expiry of router caches for correctness.',
        'Alert on any writes arriving at a shard for keys outside its current range.',
      ],
      insight: 'Ask “what enforces ownership if the router is stale?” of any sharding design. If the answer is “the router will refresh soon”, there is a data-loss window.',
    },
    {
      title: 'Hot shard detection and response',
      hook: 'Even with perfect hashing, load is skewed by tenants and celebrities, not keys.',
      body: [
        'Hashing balances the **number of keys** per shard, not the **load**. A large tenant, a viral post or a bot hammering one account concentrates QPS on one shard, and adding shards does not help because the hot key still maps to one place.',
        'Detect with per-shard QPS, CPU and p99 dashboards (alert on max/median ratio, e.g. > 2×), plus sampled top-k keys at the router — the router is the one place that sees every key. MongoDB `sh.status()` and balancer logs show chunk skew; Vitess exports per-keyspace/shard query metrics from VTGate and vttablet.',
        'Respond by granularity: a hot **range** can be split and moved; a hot **tenant** can be moved to its own shard via a directory/lookup entry (Vitess MoveTables or a custom vindex); a hot **key** needs caching, request coalescing, or write sharding (key salting `key#0..7`, merged on read).',
      ],
      diagram: {
        type: 'flow',
        title: 'Escalation by granularity',
        nodes: [
          { label: 'Hot range', sub: 'split + move', tone: 'ok' },
          { label: 'Hot tenant', sub: 'directory: own shard', tone: 'info' },
          { label: 'Hot key (reads)', sub: 'cache + coalesce', tone: 'warn' },
          { label: 'Hot key (writes)', sub: 'salt key, merge reads', tone: 'bad' },
        ],
      },
      insight: 'Build the directory escape hatch early: being able to pin one big tenant to a dedicated shard turns a recurring outage into a config change.',
    },
  ],
  scaling: {
    body: [
      'The data plane scales horizontally: routers hold no durable state, so you add instances behind an L4 load balancer. Size them on CPU (parse/plan/merge) and connection count; scatter-heavy workloads need far more router CPU because merges happen there.',
      'The control plane (topology store + resharding workflows) is small but critical. If etcd/ZooKeeper is down, routers keep routing from their cached map; what stops is failover, resharding and schema-routing changes. Keep the topo store per region (Vitess has a global topo plus per-cell local topos) so a regional outage does not freeze routing elsewhere.',
      'Multi-region: route reads to local replicas and writes to each shard’s primary region; if users are pinned to a home region, shard so each user’s primary lives there. Config propagation is eventually consistent by design — fencing on the shard side is what makes that safe.',
    ],
    bullets: [
      'Routers: stateless, N+2, spread across AZs; scale on CPU and connections.',
      'Connection math: routers × shards × pool size must fit each MySQL `max_connections`.',
      'Topo store: 3 or 5 voters; routers watch, never poll per query.',
      'Cell-local topo so a remote region failure does not block local routing.',
      'Write buffering absorbs a few seconds of primary failover or cutover.',
      'Start with many logical shards (e.g. 256–4096) on few hosts so growth is moving shards, not splitting them.',
    ],
    diagram: {
      type: 'layers',
      title: 'Control plane vs data plane',
      layers: [
        { name: 'Data plane (per query)', items: ['Routers ×N', 'Cached map', 'Shard primaries/replicas'], tone: 'ok' },
        { name: 'Control plane (on change)', items: ['Topo store', 'Failover orchestrator', 'Reshard workflows'], tone: 'violet' },
      ],
      caption: 'Control-plane outage freezes changes; it must never stop routing.',
    },
  },
  failures: [
    { name: 'Scatter-gather creep', symptom: 'Per-shard QPS rises in lockstep across all shards; p99 climbs as shards are added.', detect: 'Fraction of queries planned as Scatter (Vitess query plan stats at `/debug/query_plans`, Mongo broadcast vs targeted counts); per-shard QPS correlation near 1.0.', mitigate: 'Lookup vindexes / secondary mapping tables, CDC read model for search/analytics, block new scatter queries in CI via plan checks.' },
    { name: 'Stale map after cutover', symptom: 'Rows written to the old shard after a split; later “missing” data.', detect: 'Any write QPS on source shards after SwitchTraffic; Mongo `StaleConfig` error rate; keys outside a shard’s range in audit.', mitigate: 'Fence on the shard (denied tables, shard versions), never rely on cache TTLs; reconcile with VDiff.' },
    { name: 'Hot shard', symptom: 'One shard at 90% CPU while others idle; its p99 dominates scatter queries.', detect: 'Max/median per-shard CPU or QPS > 2×; router top-k key sampling.', mitigate: 'Split/move the range, pin big tenants via directory, cache or salt hot keys.' },
    { name: 'Partial cross-shard commit', symptom: 'Order exists without its ledger entry after a shard hiccup.', detect: 'Invariant-checking jobs (orphan rows), Vitess warnings on multi-shard commit failures.', mitigate: '`SINGLE` transaction mode for critical paths, sagas with compensation, or `TWOPC` for rare cases.' },
    { name: 'Connection exhaustion on shards', symptom: '`Too many connections` on MySQL after scaling the router fleet.', detect: 'MySQL `Threads_connected` vs `max_connections`; router pool wait time.', mitigate: 'Pool per router-shard pair sized from Little’s law; scale routers and pools together.' },
    { name: 'Topology store outage', symptom: 'Failover of a dead primary does not happen; resharding stalls.', detect: 'etcd `etcd_server_has_leader == 0`, leader-change rate, router topo watch errors.', mitigate: 'Routers serve from cache; HA topo with 3/5 voters across AZs; cell-local topo.' },
  ],
  warStories: [
    {
      title: 'Figma builds a sharding proxy for Postgres',
      source: 'Figma engineering blog, “How Figma’s databases team lived to tell the scale” (2024)',
      what: 'After vertically partitioning tables across Postgres instances, Figma’s largest tables approached the limits of a single host. They built horizontal sharding in-house with **DBProxy**, a Go service between the app and PgBouncer that parses SQL, plans queries and routes or scatters them. Tables sharing a shard key were grouped into “colos” so joins and transactions within a colo stay single-shard, and they first did logical sharding (routing through views) before physically splitting data.',
      lesson: 'Separate logical from physical sharding so the risky routing change can be rolled out and rolled back before any data moves; restrict the supported SQL to what can be routed safely.',
    },
    {
      title: 'The scatter query that scaled with the shard count',
      source: 'Composite of common incidents',
      what: 'An admin “search orders by status” endpoint had no shard key. It was harmless at 4 shards. After growing to 64 shards it fanned out to every primary on each page view, consumed a large share of total DB CPU, and its p99 rose to the slowest of 64 shards. Adding more shards made it worse.',
      lesson: 'Gate scatter queries in code review and dashboards; move non-key access paths to a lookup table or a CDC-fed search index before the shard count grows.',
    },
    {
      title: 'Writes to the old shard after a split',
      source: 'Composite of common incidents',
      what: 'A hand-rolled resharding flipped the map in ZooKeeper and relied on clients refreshing within 30 s. A few app instances with a broken watch kept writing to the source shard for an hour. Those rows were invisible after cutover and had to be reconciled by hand.',
      lesson: 'Fence ownership at the shard: make the source refuse writes for moved ranges before flipping the map, and alert on writes to out-of-range keys.',
    },
  ],
  numbers: [
    { label: 'Proxy router overhead', value: '~0.3–1 ms', note: 'One LAN hop + parse/plan from cache' },
    { label: 'Fan-out slow probability', value: '1 − 0.99^N', note: '32 shards → 27%, 100 → 63%' },
    { label: 'MongoDB chunk size', value: '128 MB', note: 'Default since 6.0 (was 64 MB)' },
    { label: 'Citus default shards', value: '32', note: '`citus.shard_count`' },
    { label: 'Instagram id layout', value: '41 + 13 + 10 bits', note: 'ms timestamp, logical shard, per-shard sequence' },
    { label: 'Logical shards to start', value: '256–4096', note: 'Map many logical to few physical hosts' },
    { label: 'Notion 2021', value: '480 logical / 32 hosts', note: 'Postgres, keyed by workspace id' },
    { label: 'Write pause at cutover', value: 'seconds', note: 'Router buffers writes during the critical section' },
    { label: 'Topo store size', value: '3 or 5 voters', note: 'Off the hot path; routers watch it' },
  ],
  capacity: {
    question: 'A service does 200k QPS: 90% single-shard by user_id, 10% scatter. With 32 shards, what load does each shard see and how many routers do you need?',
    steps: [
      'Single-shard: 180k / 32 ≈ 5.6k QPS per shard.',
      'Scatter: 20k QPS × every shard = 20k QPS per shard.',
      'Per shard total ≈ 25.6k QPS — 78% of it from the 10% scatter traffic.',
      'Fix the scatter path with a lookup table: 20k → 2 targeted hops each ≈ 40k / 32 = 1.25k per shard → ~6.9k QPS per shard total.',
      'Routers: assume ~5k QPS per vCPU for simple routed queries → 200k / 5k = 40 vCPU, ×1.5 headroom ≈ 60 vCPU, e.g. 8 × 8-vCPU routers across 3 AZs.',
    ],
    answer: '≈25.6k QPS per shard as designed, dominated by scatter; removing scatter cuts it to ≈7k. Run ~8 routers of 8 vCPU (assumption-driven; benchmark your query mix).',
  },
  comparison: {
    caption: 'Routing tiers',
    columns: ['Product', 'Placement', 'Map storage', 'Online resharding', 'Cross-shard tx'],
    rows: [
      ['Vitess VTGate', 'Proxy (MySQL protocol)', 'etcd / ZK / Consul', 'VReplication Reshard, MoveTables', 'SINGLE / MULTI / TWOPC'],
      ['MongoDB mongos', 'Proxy (Mongo protocol)', 'Config server replica set', 'Balancer chunk migration, reshardCollection', 'Distributed tx (4.2+)'],
      ['Citus coordinator', 'Coordinator node', 'Postgres catalog tables', 'Shard move via logical replication', '2PC built in'],
      ['ProxySQL', 'Proxy (rules-based)', 'Its own config DB', 'None — app/ops managed', 'None'],
      ['App library', 'In-process', 'Config table / ZK', 'Custom (dual write / CDC)', 'Whatever you build'],
    ],
  },
  whenNot: [
    'Data fits on one well-tuned primary with read replicas and a cache (single Postgres/MySQL handles multi-TB and tens of thousands of writes/s): sharding adds permanent complexity.',
    'The workload is analytical (big scans, ad-hoc joins): use a columnar warehouse or OLAP engine, not a sharded OLTP router.',
    'You need global serializable transactions across arbitrary keys: use a distributed SQL database (Spanner, CockroachDB, YugabyteDB) whose ranges and routing are built in.',
    'A managed store already shards for you (DynamoDB, Bigtable, Cosmos DB): adding your own router on top duplicates the partitioning layer.',
  ],
  interview: [
    {
      q: 'Walk me through how you would reshard a live MySQL shard into two without downtime.',
      a: 'Create two target shards for the split key ranges, snapshot-copy rows filtered by range, and tail the source binlog to keep targets in sync (VReplication). Verify with a row-level diff. Switch replica reads first, then do a short write cutover: deny writes on the source, wait for targets to reach the final GTID, flip the versioned map in the topology store while routers buffer writes, then release them. Keep reverse replication running so you can roll back, and only drop the source after a soak period.',
      followUps: ['What happens to a router that has not seen the new map?', 'How long are writes paused and what bounds it?', 'How would you do this with no CDC tooling?'],
      seniorSignal: 'Names fencing on the shard and a rollback path (reverse replication), not just copy-and-flip.',
    },
    {
      q: 'How do you choose between hash, range and directory sharding?',
      a: 'Hash for even spread with point lookups and monotonic ids; range when ordered scans matter and keys are not monotonic; directory when tenants are very uneven and you need to move one independently. In practice combine them: hash into a large keyspace and assign ranges of that keyspace to shards, with a directory override for outlier tenants. The choice follows the dominant access pattern and the transaction boundary.',
      followUps: ['Your key is a timestamp. What now?', 'How does a directory stay available and fast?', 'How many logical shards would you start with?'],
      seniorSignal: 'Recognises the two-level hash-then-range design and plans for tenant skew from day one.',
    },
    {
      q: 'A product manager wants “search orders by status across all users.” Your orders are sharded by user_id. What do you do?',
      a: 'That is a scatter query whose cost grows with shard count and whose latency is the slowest shard. If it is a rare admin query, allow scatter with deadlines and keyset pagination. If it is user-facing or frequent, stream changes via CDC into a secondary store indexed by status (Elasticsearch or a separate table sharded by status+time) and serve it from there, accepting seconds of staleness.',
      followUps: ['How do you paginate a scatter query?', 'How do you keep the secondary index consistent?', 'What if it must be strongly consistent?'],
      seniorSignal: 'Quantifies fan-out cost and moves the access path rather than accepting scatter by default.',
    },
    {
      q: 'What happens to routing if the topology store (etcd) goes down?',
      a: 'Routing continues: routers serve from their cached, versioned map and the data plane needs no topo access per query. What stops is change — primary failover, resharding, map updates. Mitigate with a 3/5-node HA topo across AZs, cell-local topo instances, and alerting on leader loss; never design routers to fetch the map per request.',
      followUps: ['A primary dies during the etcd outage — now what?', 'How do new router instances start without topo?'],
      seniorSignal: 'Separates control-plane and data-plane failure and states which operations degrade.',
    },
    {
      q: 'How would you support a transaction that debits user A and credits user B on different shards?',
      a: 'First question the key: if this is the core operation, maybe shard by account group or keep the ledger in one shard. Otherwise use a saga: debit A in a local transaction with an outbox event, credit B idempotently on consumption, compensate on failure, and expose a pending state. 2PC (Vitess TWOPC, Citus) is possible for rare cases but adds round trips, holds locks and blocks if the coordinator dies.',
      followUps: ['How do you make the credit idempotent?', 'What does the user see in between?', 'When would you accept 2PC?'],
      seniorSignal: 'Treats frequent cross-shard transactions as a modelling smell and picks saga vs 2PC by failure semantics.',
    },
    {
      q: 'Library-based routing or a proxy tier — which would you build and why?',
      a: 'A proxy when there are many services or languages, when you need write buffering for cutovers, and when connection multiplexing matters; it costs one hop and a fleet. A library when a single service owns the data, latency is paramount, and you can roll the library and map in lockstep. Either way, enforce ownership at the shard so a stale client cannot corrupt data.',
      followUps: ['How do you roll out a new map to 500 library-based clients?', 'How do you size the proxy fleet?'],
      seniorSignal: 'Frames it as map-consistency and operational blast-radius trade-off, not just latency.',
    },
  ],
  takeaways: [
    'The router owns key → shard → primary; keep that map versioned, cached and off the hot path.',
    'Shards must reject stale routing (shard versions, denied tables) — router freshness is never the safety mechanism.',
    'Scatter queries cost N× load and inherit the worst shard’s p99; track them as a metric.',
    'Pick the shard key around the transaction boundary so most transactions are single-shard.',
    'Online resharding = copy, catch up via CDC, verify, switch reads, then a short fenced write cutover with rollback.',
    'Start with many logical shards on few hosts so growth is moving shards, not rehashing data.',
    'Hash balances keys, not load: plan directory overrides for big tenants and caching/salting for hot keys.',
  ],
};
export default deep;
