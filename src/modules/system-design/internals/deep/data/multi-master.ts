import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'multi-master',
  problem: {
    why: 'Multi-master (multi-leader) replication lets more than one node accept writes for the **same** data, commit locally, and replicate to the others afterwards. The appeal is real: local write latency in every region, no failover step, and writes that keep working during a partition. The price is equally real: two leaders can change the same row concurrently and both succeed, so conflicts are discovered after both clients were told “committed”, and must be resolved by a rule — often one that silently discards a write.',
    withoutIt: [
      'With one leader per dataset, users far from it pay a cross-region round trip (~70–150 ms) on every write.',
      'Leader failure needs failover: detection plus promotion takes seconds to minutes, and async replicas may lose recent writes.',
      'Offline-first clients (mobile, desktop, field devices) cannot accept writes without connectivity.',
      'Real-time collaborative editing needs every participant’s edits to apply locally and immediately.',
    ],
    position: 'A replication topology between database nodes (often one per region or per device). Each node serves local reads and writes; a change-capture stream ships writes to peers, where conflict detection and resolution run on apply.',
    diagram: {
      type: 'sequence',
      title: 'The conflict nobody sees at write time',
      actors: ['EU user', 'Leader EU', 'Leader US', 'US user'],
      messages: [
        { from: 'EU user', to: 'Leader EU', label: 'stock 10 → 9' },
        { from: 'US user', to: 'Leader US', label: 'stock 10 → 9' },
        { from: 'Leader EU', to: 'EU user', label: 'committed', dashed: true, tone: 'ok' },
        { from: 'Leader US', to: 'US user', label: 'committed', dashed: true, tone: 'ok' },
        { from: 'Leader EU', to: 'Leader US', label: 'replicate (~80 ms)', dashed: true },
        { from: 'Leader US', to: 'Leader EU', label: 'replicate (~80 ms)', dashed: true },
        { from: 'Leader US', to: 'Leader US', label: 'LWW: stock = 9', tone: 'bad' },
      ],
      caption: 'Two units sold, one decrement survives. Neither client got an error.',
    },
  },
  architecture: {
    overview: 'Every multi-master system has the same pipeline: a local write path, change capture tagged with origin and version metadata, a replication topology between leaders, and an apply step that detects concurrent modification and resolves it. Where they differ is **when** conflicts are handled: after commit (async: LWW, CRDTs, app merge), at commit (certification: Galera, Group Replication — conflicting transactions abort), or never (consensus systems give each key exactly one leader, so they are not multi-master in the conflict sense).',
    diagram: {
      type: 'flow',
      title: 'Async multi-leader pipeline',
      nodes: [
        { label: 'Local commit', sub: 'local constraints only', tone: 'accent' },
        { label: 'Change capture', sub: 'origin id + version', tone: 'info' },
        { label: 'Ship to peers', sub: 'mesh, star or ring', tone: 'violet' },
        { label: 'Detect conflict', sub: 'concurrent versions?', tone: 'warn' },
        { label: 'Resolve', sub: 'LWW / CRDT / custom', tone: 'bad' },
      ],
    },
    blocks: [
      { name: 'Local write path', what: 'Transaction runs against the local copy only; `UNIQUE`/`CHECK` constraints and row locks are local. This is what makes writes fast — and invariants unenforceable globally.' },
      { name: 'Origin-tagged change capture', what: 'Logical decoding of the WAL/binlog with origin node id, commit timestamp and/or version vector. Origin tags stop loops (Postgres 16 subscriptions with `origin = none` apply only changes that originated locally on the publisher).' },
      { name: 'Replication topology', what: 'All-to-all mesh (most robust), star or ring. In a ring, one broken node stops propagation downstream; in a mesh, out-of-order arrival can apply an update before its insert.' },
      { name: 'Conflict detection', what: 'Compare the incoming row’s version with the local one: version vectors detect true concurrency; timestamps only order writes and cannot tell concurrent from sequential.' },
      { name: 'Conflict resolution', what: 'Last-writer-wins on timestamp, origin priority, column-level merge, custom handlers, or CRDT merge functions that are commutative, associative and idempotent.' },
      { name: 'Certification (synchronous variant)', what: 'Galera / MySQL Group Replication broadcast each transaction’s write-set in a total order at commit; every node certifies it against concurrent write-sets and the later conflicting one aborts.' },
    ],
    real: [
      { name: 'Galera Cluster / MySQL Group Replication', how: 'Virtually synchronous certification: total-order broadcast of write-sets, deterministic certification on every node, first committer wins and the loser gets a deadlock error (1213). Group Replication supports up to 9 members and defaults to single-primary mode.' },
      { name: 'Postgres BDR / EDB Postgres Distributed', how: 'Async logical replication between all nodes with configurable conflict resolution (default newer-commit-timestamp wins), conflict logging, and CRDT column types for counters. Also offers stronger commit scopes at higher latency.' },
      { name: 'DynamoDB global tables', how: 'Every replica region accepts writes; changes replicate asynchronously (typically within a second, exposed as the `ReplicationLatency` metric) and concurrent updates to the same item are resolved by last-writer-wins. AWS later added a multi-Region strong consistency mode as a separate option.' },
      { name: 'Cassandra multi-DC', how: 'Any node in any DC coordinates writes; each cell carries a write timestamp and reads merge cells by highest timestamp (LWW per column). Compare-and-set needs lightweight transactions (Paxos, `SERIAL`/`LOCAL_SERIAL`).' },
      { name: 'CRDT-based: Redis Enterprise Active-Active, Riak DT, Automerge / Yjs', how: 'Data types whose merges never lose updates — counters, sets, maps, sequences for text. Redis Active-Active databases use CRDTs per data type; Automerge and Yjs merge document edits on devices.' },
    ],
  },
  lifecycle: {
    summary: 'An async multi-master write in a two-region deployment: the client sees local latency, the conflict window is the replication delay.',
    stages: [
      { stage: 'Local transaction', what: 'Client in EU writes to Leader EU; row lock and constraint checks are local.', cost: 'Local commit with fsync', ms: 2 },
      { stage: 'Ack to client', what: 'Committed — before any other region knows.', cost: 'Same-region RTT', ms: 0.5 },
      { stage: 'Change capture', what: 'Logical decoding emits the row change with origin = EU and commit timestamp.', cost: 'Async, near-zero on the write path', ms: 0.1 },
      { stage: 'Cross-region ship', what: 'Batch sent to US leader over the replication link.', cost: 'One-way ~40–75 ms, plus batching and backlog', ms: 80 },
      { stage: 'Apply + conflict check', what: 'US compares versions: has the local row changed since the version the EU write was based on?', cost: 'Index lookup per row', ms: 0.2 },
      { stage: 'Resolve', what: 'No conflict → apply. Conflict → LWW, custom handler or CRDT merge; optionally log the loser.', cost: 'Usually µs; custom handlers can call out', ms: 0.05 },
      { stage: 'Converged', what: 'Both regions hold the same value — not necessarily one any client intended.', cost: 'Total window ≈ 100 ms to seconds', ms: 0 },
    ],
  },
  deepDives: [
    {
      title: 'Anatomy of a conflict',
      hook: 'The bugs are not exotic: lost increments, duplicate usernames, edits to deleted rows.',
      body: [
        'A conflict occurs when two leaders modify the same item without either having seen the other’s change. Four shapes recur. **Lost update**: two read-modify-writes (counter, balance, stock) — one is overwritten. **Uniqueness violation**: both regions insert `username = alice`; each local unique index passes. **Invariant violation**: two withdrawals each check `balance >= amount` locally; the merged result is negative. **Update vs delete**: one region deletes a row the other updates; resolution may resurrect or drop it.',
        'Detecting concurrency needs causality: **version vectors** (one counter per leader) can tell “B saw A’s write” from “A and B were concurrent”. Timestamps only order writes; with LWW on timestamps, a concurrent write and a later sequential write look the same, so the system cannot even tell you a conflict happened.',
      ],
      table: {
        columns: ['Data', 'Concurrent writes', 'LWW outcome', 'Correct approach'],
        rows: [
          ['Counter / stock', 'Two decrements', 'One lost', 'CRDT counter or single owner'],
          ['Unique username', 'Two inserts', 'Duplicate or one silently replaced', 'Single owner for uniqueness'],
          ['Balance', 'Two withdrawals', 'Overdraft possible', 'Consensus / single owner'],
          ['Profile bio', 'Two edits', 'One edit wins', 'LWW acceptable'],
          ['Shopping cart', 'Add + remove', 'Items vanish or return', 'OR-Set CRDT'],
        ],
      },
      insight: 'Classify every table by its conflict semantics before choosing multi-master. If any table holds counters, balances or uniqueness, those writes need a single owner even if the rest is multi-leader.',
    },
    {
      title: 'Last-writer-wins and clock skew',
      hook: 'LWW always converges — by deleting data, with the winner chosen by whichever clock runs fastest.',
      body: [
        'LWW attaches a timestamp to each write and keeps the highest. It is simple, always converges, and is the default in DynamoDB global tables, Cassandra (per cell) and many BDR-style setups. But every concurrent write except one is discarded without an error, and the “last” writer is determined by wall clocks that disagree by milliseconds to more with NTP — a node with a fast clock wins every close race, even against writes that truly happened later.',
        'Hybrid logical clocks (HLC: physical time plus a logical counter, used by CockroachDB and others) make timestamps causally consistent across nodes but do not change LWW’s fundamental property: concurrent writes lose. Use LWW only where losing a concurrent overwrite is acceptable: last-seen time, user preferences, caches, idempotent upserts of the same value.',
      ],
      code: {
        lang: 'sql',
        caption: 'Cassandra: per-cell LWW, and a client timestamp that beats everyone',
        code: `-- each cell keeps the highest write timestamp
UPDATE users SET bio = 'from EU' WHERE id = 42;   -- ts = t1
UPDATE users SET bio = 'from US' WHERE id = 42;   -- ts = t2 (skewed clock)
-- a client-supplied timestamp in the future silently wins all later writes:
UPDATE users USING TIMESTAMP 9999999999999999 SET bio = 'stuck' WHERE id = 42;
-- conditional writes need Paxos (LWT), not LWW:
UPDATE users SET bio = 'x' WHERE id = 42 IF bio = 'from EU';`,
      },
      insight: 'LWW does not “resolve” conflicts — it hides them. If the business would want to know that two writes collided, LWW is the wrong rule.',
    },
    {
      title: 'CRDTs and application-level merge',
      hook: 'If merges are commutative, associative and idempotent, replicas converge without losing writes.',
      body: [
        'Conflict-free replicated data types define state plus a merge that every replica can apply in any order. A **G-Counter** keeps one count per node and sums them; a **PN-Counter** uses two G-Counters (increments, decrements). An **OR-Set** tags each add with a unique id so a concurrent add and remove resolve to “present”. Sequence CRDTs (RGA, the structures in Yjs and Automerge) give every character a stable id so concurrent text edits interleave instead of overwriting.',
        'CRDTs cannot enforce global invariants: a PN-Counter for stock will happily go negative, because preventing that requires coordination. Application merge (CouchDB keeps conflicting revisions and lets the app pick; Riak returns siblings) is the alternative when the domain has a meaningful merge — at the cost of writing and testing that merge logic.',
      ],
      code: {
        lang: 'python',
        caption: 'PN-Counter: no increment is ever lost',
        code: `class PNCounter:
    def __init__(self, node):
        self.node, self.p, self.n = node, {}, {}

    def incr(self, d=1):
        bucket = self.p if d > 0 else self.n
        bucket[self.node] = bucket.get(self.node, 0) + abs(d)

    def value(self):
        return sum(self.p.values()) - sum(self.n.values())

    def merge(self, other):  # element-wise max: commutative, idempotent
        for mine, theirs in ((self.p, other.p), (self.n, other.n)):
            for k, v in theirs.items():
                mine[k] = max(mine.get(k, 0), v)`,
      },
      diagram: {
        type: 'compare',
        columns: [
          { name: 'CRDT', points: ['Automatic merge', 'No lost updates', 'No global invariants', 'Metadata overhead'], tone: 'ok' },
          { name: 'App merge', points: ['Siblings / revisions', 'Domain-aware', 'Code you must test', 'CouchDB, Riak'], tone: 'info' },
          { name: 'LWW', points: ['Trivial', 'Silent data loss', 'Clock-dependent'], tone: 'bad' },
        ],
      },
      insight: 'CRDTs answer “how do we merge?”, not “how do we prevent overselling?”. Anything with a must-not-exceed invariant still needs a single owner or consensus.',
    },
    {
      title: 'Avoid conflicts: a home region per record',
      hook: 'The most common correct answer to “we need writes in every region” is not multi-master at all.',
      body: [
        'Assign every record (user, tenant, account) a **home region** and send its writes there. Each record has a single leader, so there are no write conflicts, yet most writes are local because users mostly live near their home region. Other regions hold read replicas for local reads. This is multi-leader at the cluster level and single-leader at the record level.',
        'Moving a user who relocates is an explicit, fenced migration of their rows (or a flip of their home in a directory) — rare and controlled. CockroachDB builds this in with `REGIONAL BY ROW` tables, where each row’s `crdb_region` column decides where its Raft leaseholder lives.',
      ],
      diagram: {
        type: 'flow',
        title: 'Home-region routing',
        nodes: [
          { label: 'Request', sub: 'user 42' },
          { label: 'Directory', sub: 'user 42 → EU', tone: 'info' },
          { label: 'EU leader', sub: 'all writes for 42', tone: 'ok' },
          { label: 'US replica', sub: 'local reads, stale ok', tone: 'violet' },
        ],
      },
      code: {
        lang: 'sql',
        caption: 'CockroachDB: per-row home region',
        code: `ALTER DATABASE app SET PRIMARY REGION "eu-west1";
ALTER DATABASE app ADD REGION "us-east1";
ALTER TABLE users SET LOCALITY REGIONAL BY ROW;
-- each row's crdb_region column pins its leaseholder:
UPDATE users SET crdb_region = 'us-east1' WHERE id = 42;`,
      },
      insight: 'Shared global data (usernames, inventory across regions) does not have a natural home; give it one explicit owner region and accept remote-write latency for that small slice.',
    },
    {
      title: 'Certification-based multi-master: Galera and Group Replication',
      hook: 'No silent loss — conflicting transactions abort instead — but every write pays a group round trip.',
      body: [
        'At commit, the transaction’s write-set (keys of modified rows) is broadcast with total-order delivery. Every node runs the same deterministic certification: if a concurrently ordered write-set touched the same keys, the later one fails. The local client sees a deadlock error and must retry. Nothing is lost silently, which is a real improvement over async LWW.',
        'The costs: commit latency includes a group round trip (keep the group within one region or nearby), throughput is bounded by the slowest node because flow control pauses writers when a node’s apply queue grows, and hot rows written from several nodes cause certification-failure storms. Hence the common advice to write to one node at a time, which is why Group Replication defaults to single-primary mode.',
      ],
      code: {
        lang: 'text',
        caption: 'MySQL Group Replication multi-primary + Galera metrics to watch',
        code: `# my.cnf (Group Replication, multi-primary)
group_replication_single_primary_mode = OFF
group_replication_enforce_update_everywhere_checks = ON

# Galera status variables
SHOW STATUS LIKE 'wsrep_local_cert_failures';   -- certification conflicts
SHOW STATUS LIKE 'wsrep_local_bf_aborts';       -- local txns aborted by replicated ones
SHOW STATUS LIKE 'wsrep_flow_control_paused';   -- fraction of time writes paused`,
      },
      insight: 'Certification turns conflicts into retries. Applications that were not written to retry deadlocks will surface them as user-facing errors the first time two nodes write the same rows.',
    },
    {
      title: 'Spanner and CockroachDB are not multi-master',
      hook: 'Writes are accepted in every region, but each key still has exactly one leader.',
      body: [
        'Distributed SQL databases partition data into ranges (CockroachDB) or splits (Spanner), each replicated by a Raft or Paxos group with a single leader/leaseholder. A client anywhere can write, but the write is routed to that key’s leader and commits on a majority quorum. Conflicts are prevented by locks and serializable timestamps — they are never resolved after the fact.',
        'The price is latency: a write pays at least one quorum round trip, and if the quorum spans regions, cross-region RTTs. Spanner also waits out TrueTime uncertainty at commit (commit wait). Placement controls (leader regions, REGIONAL BY ROW, GLOBAL tables) let you choose which region gets fast writes for which data.',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Async multi-master', points: ['Local write latency', 'Conflicts after commit', 'LWW / CRDT resolve', 'Available in partitions'], tone: 'warn' },
          { name: 'Consensus (Spanner, CRDB)', points: ['One leader per range', 'Quorum latency', 'Serializable, no conflicts', 'Minority side unavailable'], tone: 'ok' },
        ],
      },
      insight: 'This is the CAP/PACELC trade made concrete: you choose between local-latency writes with after-the-fact merge, or correct writes that wait for a quorum. There is no option that gives both for the same key.',
    },
  ],
  scaling: {
    body: [
      'Multi-master does not scale write throughput the way people hope: every leader must still apply every other leader’s writes, so total write capacity is roughly that of one node (Galera is bounded by the slowest node). What it scales is write **locality** and availability. To scale writes, shard; to localise them, pin records to a home region.',
      'Topology matters at scale: an all-to-all mesh among N leaders has N(N−1) links; rings are cheaper but a single node failure halts propagation. Monitor replication delay per link, because the conflict window equals that delay.',
      'Configuration and schema changes are multi-leader problems too: DDL applied in different orders on different leaders can break replication. Run schema changes through a single coordinated process.',
    ],
    bullets: [
      'Write capacity ≈ one node: every leader applies every write.',
      'Conflict window = replication delay; alert on it per link.',
      'Prefer all-to-all topology with origin tracking to avoid loops and single points.',
      'Avoid id collisions: `auto_increment_increment`/`auto_increment_offset`, Galera `wsrep_auto_increment_control`, or Snowflake/UUIDv7.',
      'Coordinate DDL; never let leaders diverge in schema.',
      'Keep certification-based groups within low-latency distance.',
    ],
    diagram: {
      type: 'layers',
      title: 'Choosing a multi-region write model',
      layers: [
        { name: 'Mergeable data', items: ['CRDTs', 'LWW for prefs', 'Async multi-leader'], tone: 'ok' },
        { name: 'Ownable data', items: ['Home region per record', 'Single leader each', 'Local replicas'], tone: 'info' },
        { name: 'Global invariants', items: ['Consensus DB', 'Quorum latency', 'Serializable'], tone: 'violet' },
      ],
      caption: 'Most systems need all three layers for different tables.',
    },
  },
  failures: [
    { name: 'Silent lost updates', symptom: 'Counters, stock and balances drift; users report edits disappearing.', detect: 'Reconciliation jobs comparing derived totals with event logs; conflict logs where the product exposes them (BDR/PGD conflict history); spikes in concurrent-write counts per key.', mitigate: 'Single owner for counters/balances, CRDT counters, or a consensus store.' },
    { name: 'Uniqueness and invariant violations', symptom: 'Duplicate usernames, overbooked seats, negative balances.', detect: 'Periodic duplicate-detection queries; invariant checks on the merged data.', mitigate: 'Route uniqueness checks to one owner region; reservation tables with a single leader.' },
    { name: 'Clock skew decides LWW', symptom: 'Writes from one node always win; newer data overwritten by older.', detect: 'NTP offset per host (node_exporter `node_timex_offset_seconds`), alert at a few ms; writes with future timestamps.', mitigate: 'Tight time sync, HLC, version vectors; avoid LWW for important data.' },
    { name: 'Replication delay widens conflict window', symptom: 'Conflict rate and stale reads rise during traffic peaks.', detect: 'DynamoDB `ReplicationLatency`; Postgres `pg_stat_subscription` lag; Galera `wsrep_local_recv_queue`.', mitigate: 'Capacity for apply, batch tuning, fewer cross-region writers for hot data.' },
    { name: 'Certification abort storm', symptom: 'Deadlock errors spike when several nodes write the same hot rows; throughput collapses.', detect: '`wsrep_local_cert_failures`, `wsrep_local_bf_aborts`, application deadlock-retry counts.', mitigate: 'Write to a single node for hot tables, retry with backoff, reduce row hotness.' },
    { name: 'Topology break or replication loop', symptom: 'Changes stop flowing past one node, or the same change bounces forever.', detect: 'Per-link lag and last-applied position; duplicate change ids.', mitigate: 'All-to-all topology, origin filtering (`origin = none`), automated link health checks.' },
  ],
  warStories: [
    {
      title: 'GitHub’s 24-hour degradation after a cross-coast failover',
      source: 'GitHub blog, “October 21 post-incident analysis” (2018)',
      what: 'A 43-second network partition between GitHub’s US East Coast hub and its primary East Coast data center led the failover tooling (Orchestrator) to promote database primaries on the West Coast. Some writes had been accepted on the East Coast that were not replicated West, and new writes then landed on the West Coast primaries. With two divergent write histories, GitHub chose data integrity over availability, ran degraded for over 24 hours, restored from backups and reconciled the unreplicated writes.',
      lesson: 'Accepting writes in two places for the same data — by design or by accidental failover — creates divergence that must be reconciled by hand. Fence old leaders and constrain cross-region promotion.',
    },
    {
      title: 'Inventory oversold under global tables',
      source: 'Composite of common incidents',
      what: 'A retailer enabled multi-region writes with last-writer-wins to cut checkout latency. During a flash sale, both regions decremented stock for the same items within the replication window. LWW kept one decrement per collision, stock never reached zero in the database, and thousands of orders were accepted for items that did not exist.',
      lesson: 'Inventory is an invariant, not mergeable data: give each SKU an owner region or use a consensus store; keep multi-region writes for data where overwrites are harmless.',
    },
    {
      title: 'Galera cluster with writes spread across all nodes',
      source: 'Composite of common incidents',
      what: 'A team load-balanced writes round-robin across a 3-node Galera cluster for “write scaling”. A hot counter row was updated on all three nodes concurrently; certification failures surfaced as deadlock errors the application did not retry, and flow control paused the cluster when one node lagged. Moving all writes to one node fixed both problems.',
      lesson: 'Certification-based clusters give HA, not write scaling; send writes to one node and use the others as hot standbys and read replicas.',
    },
  ],
  numbers: [
    { label: 'Cross-region RTT', value: '~70–150 ms', note: 'e.g. US-East ↔ EU-West ~70–80 ms' },
    { label: 'Conflict window', value: '= replication delay', note: '100 ms to seconds for async' },
    { label: 'DynamoDB global tables', value: '~≤ 1 s typical', note: '`ReplicationLatency` metric, LWW' },
    { label: 'NTP clock offset', value: '~1–10+ ms', note: 'Enough to invert LWW order' },
    { label: 'Galera commit', value: '+1 group RTT', note: 'Throughput ≈ slowest node' },
    { label: 'Group Replication size', value: '≤ 9 members', note: 'Single-primary by default' },
    { label: 'Write capacity', value: '≈ one node', note: 'Every leader applies every write' },
    { label: 'Auto-increment offsets', value: 'increment = N, offset = i', note: 'Avoids id collisions across N leaders' },
  ],
  capacity: {
    question: 'Two regions each take 5k writes/s with ~200 ms replication delay. How often do conflicts happen for (a) user profiles and (b) a popular product’s stock row?',
    steps: [
      'A write conflicts if the other region wrote the same key within the window: P ≈ λ_other × window, where λ_other is that key’s write rate in the other region.',
      '(a) Profiles: 10M users, ~1 update/user/day → λ ≈ 1.2 × 10⁻⁵ /s per key; P ≈ 1.2 × 10⁻⁵ × 0.2 ≈ 2 × 10⁻⁶ → about 0.01 conflicts/s fleet-wide. LWW is fine.',
      '(b) Flash-sale SKU: 20 decrements/s per region → P ≈ 20 × 0.2 = 4 expected concurrent writes per write: effectively every write conflicts.',
      'With LWW, most decrements on that row are lost; even a PN-counter would oversell because it cannot block at zero.',
      'Conclusion: conflict rate is per-key write rate × replication delay, not total throughput.',
    ],
    answer: 'Profiles: ~0.01 conflicts/s, LWW acceptable. Hot stock row: nearly 100% of writes conflict — must have a single owner or consensus.',
  },
  comparison: {
    caption: 'Multi-region write models',
    columns: ['Model', 'Write latency', 'Conflicts', 'Consistency', 'Examples'],
    rows: [
      ['Single leader + replicas', 'Remote for far users', 'None', 'Strong on leader', 'Postgres, MySQL, Aurora Global'],
      ['Home region per record', 'Local for most', 'None', 'Strong per record', 'Sharded by user/tenant, CRDB REGIONAL BY ROW'],
      ['Async multi-master (LWW)', 'Local', 'Resolved after commit, data loss', 'Eventual', 'DynamoDB global tables, Cassandra, BDR'],
      ['CRDT active-active', 'Local', 'Merged, no loss', 'Eventual, no invariants', 'Redis Active-Active, Automerge, Riak DT'],
      ['Certification', '+1 group RTT', 'Abort at commit', 'Strong-ish in group', 'Galera, MySQL Group Replication'],
      ['Consensus per range', 'Quorum RTT', 'Prevented', 'Serializable', 'Spanner, CockroachDB, YugabyteDB'],
    ],
  },
  whenNot: [
    'Data with invariants — inventory, balances, seat bookings, unique usernames: use a single owner per item or a consensus database.',
    'To scale write throughput: every leader applies every write; shard instead.',
    'HA within one region: a single primary with automated, fenced failover (or a Raft-based store) is simpler and loses nothing.',
    'When nobody can state the merge rule for each table: without it, you will get LWW by default and silent data loss.',
  ],
  interview: [
    {
      q: 'Product wants writes accepted in US and EU with local latency. How do you design it?',
      a: 'Classify data. Records owned by a user or tenant get a home region and are written only there — most writes are local and there are no conflicts; other regions hold read replicas. Mergeable data (preferences, presence, collaborative docs) can be multi-leader with LWW or CRDTs. Global invariants (usernames, inventory, money) get one owner region or a consensus store, paying remote latency for that small slice.',
      followUps: ['A user moves from EU to US — what happens?', 'How do you enforce unique usernames globally?', 'What do reads in the non-home region see?'],
      seniorSignal: 'Splits the problem by data semantics instead of choosing one replication model for everything.',
    },
    {
      q: 'What does last-writer-wins actually do to concurrent writes?',
      a: 'It keeps the write with the highest timestamp and discards the others without telling anyone, so concurrent increments, edits and inserts are lost. Because the timestamp comes from clocks that disagree by milliseconds or more, the winner may not even be the later write. It is acceptable only where overwriting is harmless, like last-seen time or preferences.',
      followUps: ['How do version vectors differ from timestamps?', 'Would hybrid logical clocks fix this?'],
      seniorSignal: 'Separates convergence from correctness and knows LWW cannot even detect a conflict.',
    },
    {
      q: 'Is CockroachDB or Spanner multi-master?',
      a: 'Not in the conflict sense. Any node accepts a client write, but each key range has one Raft/Paxos leader; the write is routed there and commits on a quorum, with serializable isolation. Conflicts are prevented by locking and timestamps rather than resolved later. The cost is quorum latency, which can include cross-region RTTs depending on replica placement.',
      followUps: ['How would you make EU writes fast for EU users in CockroachDB?', 'What is Spanner’s commit wait?'],
      seniorSignal: 'Distinguishes “write from anywhere” from “multiple leaders for the same data”.',
    },
    {
      q: 'Galera markets itself as synchronous multi-master. Can you load-balance writes across all nodes?',
      a: 'You can, but conflicting transactions on different nodes fail certification and return deadlock errors that the app must retry; hot rows cause abort storms, and flow control limits throughput to the slowest node. It does not increase write capacity, because every node applies every write-set. The usual practice is to direct writes to one node and use the cluster for fast, lossless failover.',
      followUps: ['Which metrics show certification trouble?', 'How does Group Replication differ?'],
      seniorSignal: 'Knows certification semantics and that multi-master is not write scaling.',
    },
    {
      q: 'When is multi-leader replication the right choice?',
      a: 'When writes must be local or offline and the data merges cleanly: offline-first mobile/desktop apps (each device is a leader), collaborative editing with CRDTs or OT, multi-region data where LWW is acceptable (presence, preferences, caches), and HA clusters with certification where writes go mostly to one node. It is also fine when writes are partitioned so that each record is in practice written by only one leader.',
      followUps: ['How do you sync an offline device after a week?', 'How do you garbage-collect CRDT metadata?'],
      seniorSignal: 'Names concrete fits and the condition that conflicts are rare or mergeable.',
    },
    {
      q: 'Two MySQL masters replicate to each other. What breaks first?',
      a: 'Auto-increment collisions unless you set `auto_increment_increment = 2` and different offsets; then concurrent updates to the same rows, which replicate with no conflict detection, so whichever applies last wins on each side — the two masters can end up with different values. Unique keys can collide and stop replication with a duplicate-key error. If one master fails, determining which writes reached the other is guesswork.',
      followUps: ['How would you detect divergence?', 'How would you migrate to a safer setup?'],
      seniorSignal: 'Knows that classic circular replication can diverge permanently, not just conflict.',
    },
  ],
  takeaways: [
    'Multi-master buys local writes and no failover; it costs conflicts resolved after both clients saw success.',
    'LWW converges by discarding writes, and clocks pick the winner.',
    'CRDTs merge without loss but cannot enforce invariants like “stock ≥ 0”.',
    'The usual right answer is a home region per record: local writes, single leader, no conflicts.',
    'Certification (Galera, Group Replication) aborts conflicts instead of hiding them, at group-RTT cost.',
    'Spanner/CockroachDB write from anywhere but keep one leader per range — not multi-master.',
    'Conflict rate = per-key write rate × replication delay; hot keys conflict almost always.',
  ],
};
export default deep;
