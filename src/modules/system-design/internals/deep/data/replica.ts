import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'replica',

  problem: {
    why: 'A single primary is both a capacity ceiling for reads and a single point of failure. A replica keeps a continuously updated copy by replaying the primary’s ordered change log, so it can serve reads, take over when the primary dies, feed analytics or CDC, and seed new environments. The hard part is not copying bytes; it is deciding **when a commit counts** and what readers are allowed to see while copies disagree.',
    withoutIt: [
      'Read traffic (feeds, search pages, reports) competes with writes for the primary’s CPU and buffer pool, so a heavy report slows checkout.',
      'A primary hardware failure means restoring from backup: RTO in hours and RPO back to the last archived WAL or snapshot.',
      'Analytics and ad-hoc queries run on the system of record and evict the OLTP working set from cache.',
      'Major-version upgrades and region moves require long downtime instead of a replicate-then-switch cut-over.',
    ],
    position: 'Replicas hang off the primary’s WAL/binlog stream (directly or cascaded); a read router (app logic, ProxySQL, pgpool, RDS reader endpoint) sends read-only traffic to them, and a failover manager can promote one to primary.',
    diagram: {
      type: 'flow',
      title: 'Replication path',
      nodes: [
        { label: 'Primary commit', sub: 'WAL / binlog append', tone: 'violet' },
        { label: 'Sender', sub: 'walsender / dump thread', tone: 'info' },
        { label: 'Network', sub: 'same AZ / cross-region' },
        { label: 'Receiver', sub: 'write + fsync locally', tone: 'accent' },
        { label: 'Applier', sub: 'replay into pages', tone: 'warn' },
        { label: 'Read queries', sub: 'see replayed state', tone: 'ok' },
      ],
      caption: 'Lag can accumulate at every arrow: send, network, flush, and (most often) apply.',
    },
  },

  architecture: {
    overview: 'Replication = an ordered log + a position. The primary appends changes to a log (Postgres **WAL** addressed by **LSN**; MySQL **binlog** addressed by file/position or **GTID**), a sender streams it, the replica persists and replays it, and reports positions back. Those reported positions drive synchronous acks, lag metrics, retention of old log segments, and failover candidate selection.',
    diagram: {
      type: 'layers',
      title: 'Replication building blocks',
      layers: [
        { name: 'Control', items: ['failover manager', 'consensus store (etcd)', 'read router', 'fencing'], tone: 'info' },
        { name: 'Primary', items: ['WAL / binlog', 'walsender / dump thread', 'replication slots', 'sync wait queue'], tone: 'violet' },
        { name: 'Replica', items: ['walreceiver / IO thread', 'relay log / pg_wal', 'startup / applier workers', 'hot standby reads'], tone: 'ok' },
        { name: 'Positions', items: ['sent', 'write', 'flush', 'replay / apply'], tone: 'accent' },
      ],
      caption: 'Four positions per replica; each synchronous mode waits on a different one.',
    },
    blocks: [
      { name: 'Change log', what: 'Postgres reuses its physical redo WAL (page-level changes, 16 MB segments). MySQL writes a separate logical **binlog** (row-based images by default since 5.7.7) in addition to the InnoDB redo log, kept consistent by an internal two-phase commit.' },
      { name: 'Sender', what: 'One `walsender` process per Postgres replica; one binlog dump thread per MySQL replica. Streams over a long-lived TCP connection using the replication protocol, reading from OS cache when replicas are caught up.' },
      { name: 'Replication slot', what: 'Postgres object that records how far a consumer has confirmed, so the primary keeps WAL (and for logical slots, catalog rows) until it is consumed. Protects slow replicas; a dead consumer makes WAL pile up until the disk fills unless `max_slot_wal_keep_size` caps it.' },
      { name: 'Receiver', what: '`walreceiver` writes and fsyncs incoming WAL to the standby’s `pg_wal`; MySQL’s IO (receiver) thread writes the **relay log**. Feedback messages report write/flush/replay LSNs and optionally the standby’s oldest snapshot (`hot_standby_feedback`).' },
      { name: 'Applier', what: 'Postgres: the startup process replays WAL **single-threaded**, exactly like crash recovery. MySQL: the SQL/coordinator thread plus `replica_parallel_workers` apply transactions in parallel when the source marks them independent (`LOGICAL_CLOCK` + WRITESET dependency tracking).' },
      { name: 'Hot standby', what: 'A replica that answers read-only queries on the replayed state. Replay and queries can conflict (replay wants to remove rows a query still sees); `max_standby_streaming_delay` (30 s default) decides how long replay waits before cancelling the query.' },
      { name: 'Failover manager', what: 'Patroni, repmgr, Stolon (Postgres); Orchestrator, MHA, MySQL Group Replication/InnoDB Cluster; or the cloud control plane. Picks the most advanced replica, promotes it, repoints others, fences the old primary, updates routing.' },
    ],
    real: [
      { name: 'PostgreSQL streaming replication', how: 'Physical WAL streaming with slots; `synchronous_commit` (`off`, `local`, `remote_write`, `on`, `remote_apply`) plus `synchronous_standby_names` with `FIRST n` or `ANY n` quorum. Logical replication (publications/subscriptions, PG10+) decodes WAL into row changes per table.' },
      { name: 'MySQL replication', how: 'Row-based binlog → relay log → parallel applier. GTIDs make every transaction globally identifiable so replicas can be repointed by `SOURCE_AUTO_POSITION`. Semi-sync plugin with `AFTER_SYNC` (lossless) wait point; Group Replication adds Paxos-based certification.' },
      { name: 'Amazon Aurora replicas', how: 'Readers attach to the same shared storage volume, so they do not apply data; they receive the redo stream only to update or invalidate pages cached in memory. Replica lag is typically tens of ms; up to 15 replicas; promotion does not need a data copy.' },
      { name: 'Vitess / GitHub Orchestrator', how: 'Orchestrator maps the MySQL topology, detects primary failure using the replicas’ view (not just one ping), promotes by GTID position and runs hooks; deployed as a Raft cluster so the orchestrator itself is HA.' },
    ],
  },

  lifecycle: {
    summary: 'One `UPDATE` on a Postgres primary with one quorum-synchronous standby in another AZ and one async read replica, then a read on the replica.',
    stages: [
      { stage: 'Local commit', what: 'Primary writes and fsyncs the commit record in its own WAL (LSN `0/3A00F28`).', cost: 'Local fsync', ms: 0.5 },
      { stage: 'Stream to standby', what: 'walsender wakes and pushes the new WAL bytes to every connected standby over TCP.', cost: 'Cross-AZ one-way ~0.3–0.5 ms', ms: 0.4 },
      { stage: 'Standby write + flush', what: 'walreceiver writes and fsyncs the WAL locally and sends back `flush_lsn`.', cost: 'Remote fsync + return trip', ms: 0.8 },
      { stage: 'Sync ack releases commit', what: 'With `synchronous_commit = on` and `ANY 1 (s1, s2)`, the backend waited in the sync queue until one standby’s flush LSN passed the commit LSN; now the client is acked.', cost: 'Latency only; throughput unaffected with group commit', ms: 0.05 },
      { stage: 'Async replica receives', what: 'The async read replica (maybe cross-region) receives the same WAL; the primary never waited for it.', cost: 'Cross-region one-way 30–70 ms; zero commit cost', ms: 0 },
      { stage: 'Replay on replica', what: 'Startup process applies the WAL to pages; the row is now visible to new snapshots on that replica.', cost: 'µs per record when caught up; seconds–minutes if replay is the bottleneck', ms: 0.2 },
      { stage: 'Router picks replica', what: 'The app’s read goes to the replica pool (driver `target_session_attrs=prefer-standby`, ProxySQL hostgroup, or reader endpoint).', cost: 'Pool checkout + RTT', ms: 0.4 },
      { stage: 'Read on replica', what: 'Query runs on the replayed state; whether it sees the write depends on replay vs the user’s last write LSN.', cost: 'Same as primary for cached data', ms: 0.5 },
    ],
  },

  deepDives: [
    {
      title: 'Physical vs logical replication',
      hook: 'Byte-identical copies for HA, row-level change streams for everything else.',
      body: [
        '**Physical** replication ships the redo stream itself: the replica is a block-for-block clone of the whole cluster, same major version and architecture, read-only. It is cheap to apply, carries everything (DDL, indexes, sequences) and is the right tool for HA standbys and read replicas.',
        '**Logical** replication decodes the log into row changes (`INSERT id=7 …`) per table. Postgres logical replication (publications/subscriptions) and MySQL row-based binlogs let you replicate a subset of tables, across major versions, into a writable target or into CDC (Debezium → Kafka). Costs: decoding CPU on the primary, tables need a primary key or replica identity, and Postgres logical replication does not carry DDL, so schema changes must be applied on both sides.',
        'MySQL’s binlog is logical even when used for ordinary replicas; that is why MySQL replicas can have extra indexes or different storage engines, and also why non-deterministic statements were dangerous in the old statement-based format.',
      ],
      diagram: {
        type: 'compare',
        title: 'Two kinds of stream',
        columns: [
          { name: 'Physical (WAL)', points: ['Page-level redo bytes', 'Whole cluster, same version', 'Replica read-only', 'Cheap apply, carries DDL', 'HA standbys, read replicas'], tone: 'info' },
          { name: 'Logical (rows)', points: ['Row changes per table', 'Cross-version, subset', 'Target can be writable', 'Decode CPU, PK required', 'Upgrades, CDC, consolidation'], tone: 'violet' },
        ],
      },
      insight: 'Zero-downtime major upgrades are a logical-replication project: replicate into the new version, verify, then cut over writes. Remember that logical slots only became failover-safe with PG17 failover slots; before that, a primary failover silently broke CDC consumers.',
    },
    {
      title: 'Async, semi-sync, sync and quorum commit',
      hook: 'Where you put the ack decides how much acknowledged data a failover can lose.',
      body: [
        '**Async**: the client is acked after the local commit; replicas follow. Zero latency cost, but on failover anything not yet received by the promoted replica is lost. **Semi-sync** (MySQL): the source waits until at least `rpl_semi_sync_source_wait_for_replica_count` replicas have *received* the transaction into their relay log. With `AFTER_SYNC` (the default wait point) no other session sees the commit before a replica has it; after `rpl_semi_sync_source_timeout` (10 s default) it silently falls back to async.',
        'Postgres **sync** replication waits on a chosen position via `synchronous_commit`: `remote_write` (in standby OS memory), `on` (flushed to standby disk), `remote_apply` (replayed, so reads on that standby see it). `synchronous_standby_names = \'FIRST 1 (s1, s2)\'` is priority-based; `\'ANY 1 (s1, s2, s3)\'` is **quorum commit**: any one of three suffices, so a single slow or dead standby does not stall writes.',
        'Postgres sync replication never falls back to async on its own: if no listed standby is connected, commits hang. That is the RPO-0 promise, and the reason to always list more standbys than the quorum needs.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Quorum commit (ANY 1 of 2)',
        actors: ['Client', 'Primary', 'Standby A', 'Standby B'],
        messages: [
          { from: 'Client', to: 'Primary', label: 'COMMIT (WAL fsynced locally)' },
          { from: 'Primary', to: 'Standby A', label: 'stream WAL' },
          { from: 'Primary', to: 'Standby B', label: 'stream WAL' },
          { from: 'Standby A', to: 'Primary', label: 'flush_lsn ≥ commit', dashed: true, tone: 'ok' },
          { from: 'Primary', to: 'Client', label: 'COMMIT OK', tone: 'accent' },
          { from: 'Standby B', to: 'Primary', label: 'ack later (slow AZ)', dashed: true, tone: 'warn' },
        ],
        caption: 'Commit latency = local fsync + fastest standby round trip.',
      },
      code: {
        lang: 'sql',
        caption: 'Postgres and MySQL settings',
        code: `-- Postgres (postgresql.conf / ALTER SYSTEM)
ALTER SYSTEM SET synchronous_standby_names = 'ANY 1 (s1, s2)';
ALTER SYSTEM SET synchronous_commit = 'on';        -- or remote_write / remote_apply
SET LOCAL synchronous_commit = 'local';            -- per txn: skip sync wait for low-value writes

-- MySQL 8.0.26+ semi-sync (older: rpl_semi_sync_master_*)
SET GLOBAL rpl_semi_sync_source_enabled = 1;
SET GLOBAL rpl_semi_sync_source_wait_point = 'AFTER_SYNC';
SET GLOBAL rpl_semi_sync_source_timeout = 10000;   -- ms before silent async fallback`,
      },
      insight: 'Semi-sync’s silent fallback means your RPO is “zero, except during the incidents where you need it”. Alert on `Rpl_semi_sync_source_status = OFF` and on `Rpl_semi_sync_source_no_tx`, or you are running async without knowing it.',
    },
    {
      title: 'Replication lag: causes and honest measurement',
      hook: 'The lag number on your dashboard is often lying exactly when it matters.',
      body: [
        'Common causes: a **single-threaded applier** (Postgres replay, or MySQL without parallel workers) behind a multi-core primary; one huge transaction (a 50M-row `UPDATE` or backfill) that replicas apply serially; replicas on smaller instances or colder caches; long queries on the replica pausing replay (conflict handling); network throughput on cross-region links; and DDL that replays as one long operation.',
        'In Postgres, measure from the primary with `pg_stat_replication` (`write_lag`, `flush_lag`, `replay_lag`, and byte distance between `pg_current_wal_lsn()` and `replay_lsn`). On the replica, `now() - pg_last_xact_replay_timestamp()` reports growing lag when the primary is simply idle, so pair it with LSN distance.',
        'MySQL `Seconds_Behind_Source` (formerly `Seconds_Behind_Master`) compares the replica’s clock with the original timestamp of the event currently being applied. It reads 0 when the applier has caught up with a relay log that the IO thread is still far behind on, jumps from 0 to hours on one long transaction, is NULL when a thread is stopped, and is skewed by clock drift. Use a **heartbeat** table (`pt-heartbeat`) or performance_schema commit timestamps instead.',
      ],
      code: {
        lang: 'sql',
        caption: 'Lag you can trust',
        code: `-- On the Postgres primary: per-replica lag in time and bytes
SELECT application_name, state, sync_state,
       write_lag, flush_lag, replay_lag,
       pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS replay_bytes_behind
FROM pg_stat_replication;

-- Slots that pin WAL (dead consumers fill the disk)
SELECT slot_name, active,
       pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) AS retained_bytes
FROM pg_replication_slots;

-- MySQL: heartbeat row written every second by pt-heartbeat on the source
SELECT TIMESTAMPDIFF(MICROSECOND, ts, NOW(6)) / 1e6 AS lag_s FROM heartbeat.heartbeat;`,
      },
      insight: 'Lag is a function of the **biggest transaction**, not average load: batch every backfill (e.g. 1–5k rows per transaction) and throttle it on measured replica lag, the way gh-ost and most online migration tools do.',
    },
    {
      title: 'Read-your-writes and monotonic reads',
      hook: 'Users do not care about lag until they cannot see the comment they just posted.',
      body: [
        '**Read-your-writes**: after a user writes, their own subsequent reads must reflect it. Options, from simple to precise: route that user (or that entity) to the primary for N seconds after a write, where N exceeds p99 lag; or record the commit position (Postgres `pg_current_wal_lsn()` after commit, MySQL `@@gtid_executed` / session tracking of the last GTID) in the session or a cookie, and only read from a replica whose replay position has passed it, otherwise wait briefly or fall back to the primary.',
        '**Monotonic reads**: a user must not see data appear and then disappear because consecutive reads hit replicas with different lag. Pin a session to one replica (hash user id → replica), or carry the highest position seen and require it on every read. **Consistent prefix** matters for causally related data (question before answer); single-primary log replication gives it for free per replica.',
      ],
      diagram: {
        type: 'sequence',
        title: 'LSN/GTID token routing',
        actors: ['User', 'App', 'Primary', 'Replica'],
        messages: [
          { from: 'User', to: 'App', label: 'POST comment' },
          { from: 'App', to: 'Primary', label: 'INSERT + COMMIT' },
          { from: 'Primary', to: 'App', label: 'commit LSN 0/5A1', dashed: true },
          { from: 'App', to: 'User', label: 'cookie: min_lsn=0/5A1', dashed: true },
          { from: 'User', to: 'App', label: 'GET thread' },
          { from: 'App', to: 'Replica', label: 'replay_lsn ≥ 0/5A1 ?', tone: 'accent' },
          { from: 'Replica', to: 'App', label: 'yes → serve read', dashed: true, tone: 'ok' },
          { from: 'App', to: 'Primary', label: 'else → fallback read', tone: 'warn' },
        ],
      },
      code: {
        lang: 'sql',
        caption: 'Position checks',
        code: `-- Postgres: on the primary right after COMMIT
SELECT pg_current_wal_lsn();                     -- store as the session's min_lsn
-- on the replica before reading
SELECT pg_last_wal_replay_lsn() >= '0/5A1'::pg_lsn AS fresh_enough;

-- MySQL: block up to 1 s until the replica has applied the GTID set
SELECT WAIT_FOR_EXECUTED_GTID_SET('3E11FA47-71CA-11E1-9E33-C80AA9429562:1-1234', 1);`,
      },
      insight: 'Time-based pinning (“primary for 5 s after a write”) silently breaks during the incidents that cause lag spikes; position-based routing degrades gracefully by falling back to the primary, so cap that fallback rate or a lag spike becomes a primary overload.',
    },
    {
      title: 'Failover, promotion, fencing and split brain',
      hook: 'Promotion is easy; making sure the old primary stops is the hard part.',
      body: [
        'A safe failover is: **detect** (multiple observers agree the primary is gone, not one flaky ping), **select** the most advanced eligible candidate (highest flushed LSN / most complete GTID set, preferring sync standbys and same region), **fence** the old primary (lease expiry so it demotes itself, STONITH, revoke its VIP or security group), **promote** (new timeline in Postgres), **repoint** the remaining replicas, and **reroute** clients through one source of truth (DNS, VIP, Consul, pooler config).',
        'With async replication, any commits the old primary acked but the candidate never received are **lost acknowledged writes**. Worse, if the old primary comes back and still accepts writes, you get **split brain**: two divergent histories that cannot be merged automatically. Postgres needs `pg_rewind` (or a re-clone) before the old primary can follow the new one; MySQL may hold errant GTIDs that must be reconciled.',
        'Failover managers themselves need consensus: Patroni holds a TTL’d leader key in etcd/Consul/ZooKeeper and a primary that cannot renew it demotes itself; Orchestrator runs as a Raft cluster. Detection timeouts are a trade-off between unnecessary failovers on a blip and longer outages.',
      ],
      diagram: {
        type: 'flow',
        title: 'Safe failover sequence',
        nodes: [
          { label: 'Detect', sub: 'quorum of observers', tone: 'warn' },
          { label: 'Select', sub: 'highest LSN / GTID', tone: 'info' },
          { label: 'Fence old', sub: 'lease, STONITH, VIP', tone: 'bad' },
          { label: 'Promote', sub: 'new timeline', tone: 'accent' },
          { label: 'Repoint replicas', sub: 'follow new primary' },
          { label: 'Reroute clients', sub: 'DNS / VIP / pooler', tone: 'ok' },
        ],
        caption: 'Fence before promote; skipping it is how split brain happens.',
      },
      insight: 'Decide in advance whether a cross-region promotion is ever automatic. Short network blips are far more common than data-center loss, and an automatic cross-region failover with async replication converts a 40-second blip into a day of reconciliation.',
    },
    {
      title: 'Replicas for analytics: query conflicts and hot_standby_feedback',
      hook: 'A long report on a replica either gets cancelled or quietly bloats the primary.',
      body: [
        'When the primary vacuums away rows, the cleanup WAL record reaches the standby; if a running query there still needs those rows, replay must either wait or cancel the query (`ERROR: canceling statement due to conflict with recovery`). `max_standby_streaming_delay` (30 s default) is how long replay waits, so a long report either dies or makes that replica lag.',
        '`hot_standby_feedback = on` makes the standby send its oldest snapshot to the primary, which then keeps those rows. Queries stop being cancelled, but a 6-hour report now holds back VACUUM on the **primary**, causing bloat there. MySQL replicas have the analogous issue: long transactions on the replica grow its own undo history and slow apply.',
      ],
      table: {
        caption: 'Choosing a replica for long queries',
        columns: ['Setting', 'Long query', 'Replica lag', 'Primary impact'],
        rows: [
          ['Defaults (30 s delay, feedback off)', 'May be cancelled', 'Up to 30 s extra', 'None'],
          ['max_standby_streaming_delay = -1', 'Never cancelled', 'Unbounded while query runs', 'None'],
          ['hot_standby_feedback = on', 'Rarely cancelled', 'Normal', 'Vacuum held back → bloat'],
          ['Separate analytics replica / warehouse', 'Isolated', 'Only that replica', 'None'],
        ],
      },
      insight: 'Never put HA failover candidates and analytics on the same replica: a lagging analytics replica must not be the one you promote, and its feedback must not bloat the primary. Better still, ship CDC to a warehouse.',
    },
    {
      title: 'Topologies: fan-out, cascading and cross-region',
      hook: 'Each extra replica costs the primary a sender; cascading moves that cost downstream.',
      body: [
        'Every directly attached replica costs the primary a sender process, network egress and, for sync, a place in the ack path. **Cascading** replication (Postgres standbys feeding other standbys; MySQL replicas with `log_replica_updates`) keeps the primary’s fan-out small, at the cost of additive lag and an intermediate node whose failure orphans its children until they are repointed (GTID/LSN-based repointing makes that quick).',
        'A common production shape: primary + 2 quorum-sync standbys in other AZs (HA, RPO 0), several async read replicas behind a reader endpoint, one delayed replica (`recovery_min_apply_delay = \'1h\'`) as a fast undo for fat-fingered deletes, and one cascaded cross-region replica for DR.',
      ],
      diagram: {
        type: 'layers',
        title: 'Typical topology',
        layers: [
          { name: 'Primary (AZ a)', items: ['writes', 'walsenders'], tone: 'violet' },
          { name: 'Sync standbys', items: ['AZ b (ANY 1)', 'AZ c (ANY 1)'], tone: 'ok' },
          { name: 'Async replicas', items: ['reader pool x3', 'delayed 1h replica', 'analytics replica'], tone: 'info' },
          { name: 'Cascaded DR', items: ['region 2 replica', 'feeds region-2 readers'], tone: 'warn' },
        ],
      },
      insight: 'A delayed replica is the cheapest “undo button” you can buy: recovering a dropped table from it takes minutes, versus hours for PITR from a multi-terabyte base backup.',
    },
  ],

  scaling: {
    body: [
      'Read scaling is roughly linear in replicas for cacheable, independent reads, but writes are replayed on **every** replica, so each replica needs the same write capacity as the primary and adds zero write throughput. Once replay saturates (especially Postgres’ single-threaded startup process), adding replicas does not help; you need to reduce write volume or shard.',
      'The data plane (WAL streaming, replay, read serving) keeps working without the control plane; the control plane (failover manager, consensus store, routing updates) must fail safe — if etcd is unavailable, Patroni demotes the primary to read-only rather than risk two primaries. Routing changes (DNS TTLs, driver caches) are the slowest part of most failovers.',
      'Multi-region: replicate async to remote regions for local reads and DR; accept that writes still go to one region and that remote reads are stale by at least one cross-region one-way trip. Active-active writes need either conflict resolution (multi-master) or a consensus database.',
    ],
    bullets: [
      'Replicas scale reads, never writes; each one replays 100% of primary writes.',
      'Watch single-threaded replay CPU on Postgres replicas as the real ceiling.',
      'Keep quorum-sync standbys separate from read and analytics replicas.',
      'Eject replicas from the read pool when lag exceeds the product’s staleness budget.',
      'Cap slot retention with `max_slot_wal_keep_size`; alert on inactive slots.',
      'Low DNS TTLs or a pooler/proxy layer make failover rerouting fast.',
      'Cross-region replicas are DR and local reads, not active-active writes.',
    ],
    diagram: {
      type: 'compare',
      title: 'What replicas buy you',
      columns: [
        { name: 'Scales', points: ['Read throughput', 'Availability (failover)', 'Geographic read latency', 'Analytics isolation'], tone: 'ok' },
        { name: 'Does not scale', points: ['Write throughput', 'Storage per node', 'Single-row hotspots', 'Consistency for free'], tone: 'bad' },
      ],
    },
  },

  failures: [
    {
      name: 'Replication lag spike',
      symptom: 'Users see stale data or “missing” recent writes; read-your-writes fallbacks overload the primary; failover candidates fall behind.',
      detect: '`pg_stat_replication.replay_lag` and byte distance; pt-heartbeat lag; per-replica lag SLO alert (e.g. > 5 s for 1 min); replica CPU of the startup/applier process.',
      mitigate: 'Batch and throttle backfills on lag, enable parallel apply (MySQL), size replicas like the primary, eject lagging replicas from the read pool.',
    },
    {
      name: 'Silent loss of synchronous protection',
      symptom: 'MySQL semi-sync times out and falls back to async; a later failover loses acked writes nobody expected to lose.',
      detect: '`Rpl_semi_sync_source_status`, `Rpl_semi_sync_source_no_tx` counters; Postgres `sync_state` in `pg_stat_replication` not showing `sync`/`quorum`.',
      mitigate: 'Alert on fallback, keep more semi-sync replicas than required, quorum sync in Postgres.',
    },
    {
      name: 'Split brain after failover',
      symptom: 'Old primary keeps accepting writes from some clients after a partition; two timelines diverge; IDs collide.',
      detect: 'More than one node reporting `pg_is_in_recovery() = false` / `read_only = OFF`; writes on unexpected hosts; GTID errant transactions.',
      mitigate: 'Lease-based leadership with self-demotion, STONITH/VIP revocation, clients connect only through the managed endpoint; `pg_rewind` or re-clone the loser.',
    },
    {
      name: 'WAL retention fills the primary disk',
      symptom: 'An abandoned replica or CDC connector leaves an inactive slot; `pg_wal` grows until the primary stops.',
      detect: 'Retained bytes per slot from `pg_replication_slots`, `active = false` for > N minutes, disk usage forecast.',
      mitigate: '`max_slot_wal_keep_size`, drop dead slots, alert on inactive slots, monitor CDC consumer health.',
    },
    {
      name: 'Query conflicts / feedback bloat',
      symptom: 'Reports on replicas cancelled with “conflict with recovery”, or primary tables bloat after enabling `hot_standby_feedback`.',
      detect: '`pg_stat_database_conflicts`, dead tuples and `backend_xmin` of walsenders in `pg_stat_replication`.',
      mitigate: 'Dedicated analytics replica, statement timeouts, move analytics to a warehouse via CDC.',
    },
    {
      name: 'Broken replica after errant write or corruption',
      symptom: 'MySQL replica stops with duplicate-key or row-not-found errors (someone wrote to it), or Postgres replica refuses to start after storage issues.',
      detect: 'Replica IO/SQL thread state, `Last_SQL_Error`, replay stopped while receive continues.',
      mitigate: '`super_read_only = ON` on MySQL replicas, rebuild from a fresh clone (CLONE plugin, pg_basebackup), never “skip the error” on critical data.',
    },
  ],

  warStories: [
    {
      title: 'Cross-coast promotion after a 43-second partition',
      source: 'GitHub post-incident analysis, October 21 2018',
      what: 'A 43 s network partition between GitHub’s US East Coast hub and its primary East Coast data center let Orchestrator promote MySQL primaries in the West Coast data center. The old East Coast primaries held a few seconds of writes that had never replicated West. Applications in the East now wrote cross-country with much higher latency, and replicas had to be rebuilt from backups before topology could be restored: 24 h 11 min of degraded service.',
      lesson: 'Async replication plus automated cross-region failover turns a blip into data divergence. Encode region-aware promotion rules, and know how long rebuilding replicas from backup takes at your data size.',
    },
    {
      title: 'Fixing replication lag deleted the primary',
      source: 'GitLab.com postmortem, January 31 2017',
      what: 'Spam load caused the Postgres secondary to fall too far behind (needed WAL segments had already been removed on the primary), so replication stopped. While trying to re-seed the secondary with `pg_basebackup`, an engineer wiped the data directory on the primary host by mistake. Replication had already been broken, the backups were not usable, and about 6 hours of data was lost.',
      lesson: 'Use replication slots or WAL archiving so a lagging replica can catch up instead of needing a re-seed; automate replica rebuilds; and remember that a replica protects against hardware failure, not human error.',
    },
    {
      title: 'Byzantine network failure triggers database failover',
      source: 'Cloudflare blog “A Byzantine failure in the real world”, November 2020',
      what: 'A partially failing switch let some nodes talk while others could not, which broke the etcd cluster backing Cloudflare’s highly available Postgres for its control-plane APIs. The cluster manager failed over the primary; afterwards replicas had to be rebuilt from the new primary, which took hours, and the API and dashboard were degraded for several hours while capacity on the remaining replicas was constrained.',
      lesson: 'Failover managers are only as healthy as their consensus layer, and partial failures are worse than clean ones. Measure replica rebuild time; it often dominates the incident.',
    },
    {
      title: 'Seconds_Behind_Master said 0 while replicas were minutes behind',
      source: 'Composite of common incidents',
      what: 'A replica’s IO thread fell behind on a saturated cross-region link while the SQL thread had applied everything in the relay log, so `Seconds_Behind_Master` reported 0. The read router kept sending traffic to it; users saw minutes-old data and a failover picked it as a candidate.',
      lesson: 'Measure lag end to end with a heartbeat written on the source, not with the replica’s own estimate.',
    },
  ],

  numbers: [
    { label: 'Async lag in-region', value: '1–100 ms', note: 'Spikes to minutes under big transactions' },
    { label: 'Sync commit cost', value: '+1 RTT + remote fsync', note: '~0.5–2 ms cross-AZ; 50–150 ms cross-region' },
    { label: 'Semi-sync timeout', value: '10 s', note: 'MySQL default before silent async fallback' },
    { label: 'max_standby_streaming_delay', value: '30 s', note: 'Postgres replay wait before cancelling queries' },
    { label: 'Patroni leader TTL', value: '30 s', note: 'Typical failover 10–40 s end to end' },
    { label: 'RDS Multi-AZ instance failover', value: '60–120 s', note: 'DNS-based; Aurora ~30 s' },
    { label: 'Aurora replicas', value: 'Up to 15', note: 'Shared storage; lag typically tens of ms' },
    { label: 'WAL segment', value: '16 MB', note: 'Postgres default size' },
    { label: 'Read capacity', value: '≈ N× with N replicas', note: 'Write capacity stays 1×' },
  ],

  capacity: {
    question: 'A primary handles 4k writes/s and 40k reads/s; reads will grow 5× next year. How many replicas, and can they keep up with replay?',
    steps: [
      'Target reads: 200k/s. Keep ~30% of reads on the primary for read-your-writes and RMW paths ⇒ replicas serve ~140k/s.',
      'A replica of the same size serves ~35k reads/s at a healthy ~60% CPU (same per-query cost as the primary) ⇒ 140k / 35k = 4 replicas, +1 for N+1 headroom = 5.',
      'Replay: each replica must apply 4k writes/s. A single-threaded Postgres replay process handles this only if WAL volume stays below what one core can apply (often ~tens of MB/s); at 4k writes/s × ~1 KB WAL ≈ 4 MB/s, fine.',
      'Primary fan-out: 5 replicas + 2 sync standbys = 7 walsenders ≈ 7 × 4 MB/s = 28 MB/s egress; acceptable, but cascade the cross-region one.',
      'Lag budget: product tolerates 2 s staleness ⇒ eject a replica from the pool when replay_lag > 2 s; route read-your-writes by LSN.',
    ],
    answer: 'Five same-sized async read replicas (plus the two HA standbys, which stay out of the read pool) cover 5× read growth; replay is comfortably within one core. The next limit is write growth, which replicas cannot help with.',
  },

  comparison: {
    caption: 'Replication approaches',
    columns: ['Approach', 'Ack point', 'RPO on failover', 'Write latency cost', 'Typical use'],
    rows: [
      ['Async (Postgres / MySQL)', 'Local commit', 'ms–s of writes', 'None', 'Read replicas, cross-region DR'],
      ['MySQL semi-sync (AFTER_SYNC)', 'Replica received (relay log)', '~0 unless fallen back', '+1 RTT', 'Primary HA in one region'],
      ['Postgres sync / quorum (ANY n)', 'Standby flushed (or applied)', '0', '+1 RTT + fsync', 'Payments, orders'],
      ['Aurora shared storage', '4/6 storage quorum', '0 (storage level)', 'Built in', 'Managed HA, fast replicas'],
      ['Logical / CDC (Debezium)', 'Independent of commit', 'n/a (derived copy)', 'Decode CPU', 'Upgrades, search, warehouse'],
    ],
  },

  whenNot: [
    'To scale writes: replicas replay every write; shard or reduce write volume instead.',
    'For read-modify-write logic, uniqueness checks or balances: read from the primary inside the transaction.',
    'As a backup: replicas faithfully replay `DROP TABLE`; use PITR (base backup + WAL archive) and a delayed replica.',
    'For heavy analytics on the HA path: use a dedicated replica or a warehouse fed by CDC.',
    'When reads are cacheable and hot: a cache in front of the primary is often cheaper than replicas.',
  ],

  interview: [
    {
      q: 'Explain the difference between async, semi-sync and synchronous replication and what each costs.',
      a: 'Async acks after the local commit, so there is no latency cost but a failover can lose whatever the promoted replica had not received. MySQL semi-sync waits until a replica has received the transaction (AFTER_SYNC ensures no one sees it first), costing one RTT, but it falls back to async after a timeout. Postgres sync replication waits for a standby to write, flush or apply the commit depending on `synchronous_commit`, giving RPO 0 at the cost of an RTT plus remote fsync, and it blocks if no sync standby is available, which is why you use quorum (`ANY 1` of 2–3).',
      followUps: [
        'What does `remote_apply` give you that `on` does not?',
        'How do you avoid write stalls when a sync standby dies?',
        'How would you run this across regions?',
      ],
      seniorSignal: 'Names the exact ack point for each mode, knows semi-sync silently degrades, and uses quorum sync to avoid single-standby availability coupling.',
    },
    {
      q: 'A user edits their profile, refreshes, and sees the old value. Design a fix that still uses replicas.',
      a: 'It is a read-your-writes violation caused by replica lag. After the write, capture the commit position (Postgres LSN, MySQL GTID) and store it in the user’s session; on reads, use a replica whose replayed position is at least that value, otherwise wait briefly or fall back to the primary. A simpler variant pins the user to the primary for a few seconds after a write. Add monotonic reads by sticking a session to one replica or carrying the max-seen position.',
      followUps: [
        'What happens to the primary when lag spikes and every read falls back?',
        'How do you do this across devices for the same user?',
        'Which reads should never go to replicas?',
      ],
      seniorSignal: 'Prefers position tokens over time windows, and considers the fallback load on the primary during lag incidents.',
    },
    {
      q: 'How do you measure replication lag correctly, and why is Seconds_Behind_Master misleading?',
      a: 'Measure end to end: write a heartbeat timestamp on the source every second and compare on the replica, or use Postgres `pg_stat_replication` replay_lag and LSN byte distance from the primary. `Seconds_Behind_Master` compares the replica clock with the timestamp of the event the applier is currently running, so it shows 0 when the applier is idle even if the IO thread is far behind, spikes on long transactions, goes NULL when threads stop, and is sensitive to clock skew. On Postgres, replay-timestamp lag inflates when the primary is idle.',
      followUps: [
        'What lag threshold would you alert on and why?',
        'How do backfills create lag and how do you prevent it?',
        'How does lag interact with failover candidate selection?',
      ],
      seniorSignal: 'Distinguishes receive, flush and replay lag and ties alerts to the product’s staleness budget rather than arbitrary numbers.',
    },
    {
      q: 'The primary dies. Walk me through a correct automated failover.',
      a: 'Multiple observers must agree it is down (Patroni’s leader key expiry, Orchestrator consulting replicas) to avoid failing over on a blip. Pick the most advanced eligible replica by flushed LSN or GTID set, preferring sync standbys in the same region. Fence the old primary (lease-based self-demotion, STONITH, VIP removal), promote the candidate, repoint other replicas to it, and switch client routing through a single source of truth. Afterwards rewind or rebuild the old primary, and reconcile any un-replicated writes if replication was async.',
      followUps: [
        'How do you prevent split brain during a network partition?',
        'When should failover not be automatic?',
        'How long does each step take in practice?',
      ],
      seniorSignal: 'Puts fencing before promotion, mentions lost acknowledged writes with async, and treats routing/DNS as part of the failover.',
    },
    {
      q: 'Physical or logical replication for a zero-downtime Postgres major-version upgrade?',
      a: 'Logical, because physical replication requires the same major version. Create a publication on the old cluster, build the new cluster with the schema, subscribe so it copies existing data and then streams changes, verify row counts and lag, then freeze writes briefly, wait for catch-up, sync sequences and switch connections. Watch out for tables without primary keys, DDL during the migration (not replicated), sequence values and large initial copy times.',
      followUps: [
        'How do you handle sequences?',
        'What is the rollback plan?',
        'How would you do the same on MySQL?',
      ],
      seniorSignal: 'Knows logical replication’s gaps (DDL, sequences, replica identity) and plans the cut-over and rollback explicitly.',
    },
    {
      q: 'Your analytics team wants to run 2-hour queries on a replica. What do you need to configure and what are the risks?',
      a: 'Long queries conflict with WAL replay: replay waits up to `max_standby_streaming_delay` then cancels the query. Raising that delay makes the replica lag for the duration of the query; enabling `hot_standby_feedback` avoids cancellations but holds back vacuum on the primary and causes bloat there. The clean answer is a dedicated analytics replica excluded from failover and the read pool, with a large delay, or better a warehouse fed by CDC.',
      followUps: [
        'How do you detect feedback-induced bloat?',
        'Why must this replica never be a failover candidate?',
        'When is a warehouse worth it?',
      ],
      seniorSignal: 'Understands that replica settings can harm the primary and isolates workloads accordingly.',
    },
  ],

  takeaways: [
    'Replication is an ordered log plus positions: sent, written, flushed, replayed.',
    'The ack point (async, semi-sync, sync, quorum) defines RPO; quorum sync avoids stalls.',
    'Replicas scale reads only; every replica replays every write.',
    'Read-your-writes needs position tokens or primary pinning; monotonic reads need stickiness.',
    'Measure lag with heartbeats or LSN distance, not Seconds_Behind_Master.',
    'Fence before promote; async failover loses acknowledged writes.',
    'Replicas are not backups; delayed replicas and PITR are.',
  ],
};

export default deep;
