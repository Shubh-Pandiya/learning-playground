import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'db',

  problem: {
    why: 'Every business needs one place where a fact is either true or not: an order was paid, a seat is taken, a balance is 40. A relational database is that **system of record**: it turns concurrent, failure-prone writes into atomic, isolated, durable transactions and lets you ask new questions of old data with SQL. Almost every other data component (cache, replica, search index, warehouse) is a derived copy of it.',
    withoutIt: [
      'Two requests read balance 100 and both withdraw 80: without isolation and row locks you get a **lost update** and money appears from nowhere.',
      'A crash halfway through “debit A, credit B” leaves half a transfer on disk: no **atomicity** and no WAL-based recovery means manual repair.',
      'Invariants (unique email, order → existing customer, `qty >= 0`) live only in app code and drift as soon as a second service or a backfill script writes the data.',
      'Every new question (“orders by region last week”) needs new code paths over flat files or KV blobs instead of a declarative query the planner optimises.',
      'Power loss after you told the user “saved” loses the write: durability needs an fsynced log, not a page in the OS cache.',
    ],
    position: 'Sits at the bottom of the synchronous request path: app servers reach it through a connection pool (PgBouncer, RDS Proxy, ProxySQL), and its change log feeds replicas, CDC pipelines (Debezium → Kafka), caches and search indexes.',
    diagram: {
      type: 'flow',
      title: 'Where the primary sits',
      nodes: [
        { label: 'App servers', sub: 'ORM / driver pool' },
        { label: 'Connection pooler', sub: 'PgBouncer, RDS Proxy', tone: 'info' },
        { label: 'Primary DB', sub: 'single writer', tone: 'violet' },
        { label: 'WAL / binlog', sub: 'ordered change log', tone: 'accent' },
        { label: 'Standbys + replicas', sub: 'HA and read scale', tone: 'ok' },
        { label: 'CDC consumers', sub: 'cache, search, warehouse' },
      ],
      caption: 'One writer, one ordered log; everything downstream is a derived, lagging copy.',
    },
  },

  architecture: {
    overview: 'A single-node RDBMS is four layers: a **connection layer** (process or thread per session), a **query layer** (parser → rewriter → cost-based planner → Volcano-style executor), a **transaction layer** (MVCC snapshots, lock manager, WAL) and a **storage layer** (fixed-size pages in a buffer pool backed by heap/index files). The one rule holding it together: a change is durable once its **WAL record** is fsynced; data pages are written lazily later.',
    diagram: {
      type: 'layers',
      title: 'Inside one Postgres / MySQL node',
      layers: [
        { name: 'Connection', items: ['postmaster fork / thread', 'auth + TLS', 'session state', 'pooler in front'], tone: 'info' },
        { name: 'Query processing', items: ['parser', 'analyzer + rewriter', 'cost-based planner', 'executor (iterators)'], tone: 'accent' },
        { name: 'Transactions', items: ['MVCC snapshots', 'lock manager', 'WAL / redo + undo', 'deadlock detector'], tone: 'violet' },
        { name: 'Storage', items: ['buffer pool', 'heap / clustered B+tree', 'secondary indexes', 'checkpointer + bgwriter'], tone: 'ok' },
        { name: 'Disk', items: ['WAL segments (16 MB)', 'data files', 'fsync'], tone: 'neutral' },
      ],
      caption: 'Durability lives in the WAL; performance lives in the buffer pool; correctness lives in MVCC + locks.',
    },
    blocks: [
      { name: 'Process/thread per connection', what: 'Postgres forks a backend **process** per connection (a few MB of private memory plus `work_mem` per sort/hash node); MySQL runs a **thread** per connection (thread pool plugin in Percona/Enterprise). Either way, thousands of active sessions mean context switching and lock contention, hence poolers.' },
      { name: 'Cost-based planner', what: 'Enumerates access paths (seq scan, index scan, index-only, bitmap) and join orders/methods (nested loop, hash, merge), costing each from **statistics**: `pg_statistic` histograms, most-common values, n_distinct, correlation. Postgres samples `default_statistics_target = 100` buckets; MySQL 8 uses index dives plus optional histograms.' },
      { name: 'Executor', what: 'Volcano iterator model: each plan node implements `next()` and pulls tuples from its children. Applies MVCC visibility per tuple and takes row locks for writes. Parallel query (Postgres gather workers) splits seq scans and aggregates across cores.' },
      { name: 'Buffer pool', what: 'Page cache owned by the DB: `shared_buffers` (Postgres, ~25% RAM, clock-sweep eviction, rest left to the OS page cache → double buffering) or `innodb_buffer_pool_size` (InnoDB, 60–80% RAM, `O_DIRECT`, midpoint-insertion LRU). Hit ratio below ~99% on OLTP usually means the working set no longer fits.' },
      { name: 'Heap vs clustered B+tree', what: 'Postgres stores rows in an unordered **heap** of 8 KB pages; every index (including the PK) maps key → `ctid` (page, slot). InnoDB stores rows **inside the PK B+tree** leaves (16 KB pages); secondary indexes map key → PK, so a secondary lookup is two tree descents.' },
      { name: 'Write-ahead log', what: 'Append-only, sequential, LSN-addressed record of every page change. Commit = append commit record + fsync (shared via **group commit**). Also the replication stream (Postgres WAL; MySQL replicates via the separate logical **binlog**, kept consistent with the InnoDB redo log by an internal two-phase commit).' },
      { name: 'MVCC + lock manager', what: 'Readers see a snapshot and never block writers. Postgres keeps old versions in the heap (`xmin`/`xmax`, cleaned by VACUUM); InnoDB updates in place and rebuilds old versions from **undo logs** (cleaned by purge). Writers on the same row still serialise on row locks.' },
      { name: 'Checkpointer + background writer', what: 'Periodically flushes dirty pages and writes a checkpoint record so recovery only replays WAL after it. Postgres: `checkpoint_timeout = 5min`, `max_wal_size = 1GB` defaults; spread over `checkpoint_completion_target = 0.9` to avoid I/O storms.' },
    ],
    real: [
      { name: 'PostgreSQL', how: 'Process-per-connection, heap storage + separate indexes (B-tree, GIN, GiST, BRIN, hash), MVCC in the heap with VACUUM, full-page writes for torn-page safety, physical WAL streaming and logical decoding. Extensible types/indexes (PostGIS, pg_trgm, pgvector).' },
      { name: 'MySQL / InnoDB', how: 'Thread-per-connection; clustered PK B+tree; undo-log MVCC with purge threads; redo log + **doublewrite buffer** against torn pages; separate row-based binlog for replication with GTIDs. Default isolation REPEATABLE READ with next-key locking.' },
      { name: 'Amazon Aurora (MySQL/Postgres)', how: '“The log is the database”: the compute node ships only redo records to a shared storage service that keeps **6 copies across 3 AZs**, acknowledges on a **4/6 write quorum** (3/6 read quorum) and materialises pages itself — no checkpoints, full-page writes or doublewrite from the engine. Storage is split into 10 GB protection groups; up to 15 replicas share it.' },
      { name: 'CockroachDB / Google Spanner', how: 'SQL on a range-sharded, Raft (Cockroach) or Paxos (Spanner) replicated KV layer with LSM storage (Pebble). Serializable distributed transactions; Spanner uses TrueTime commit-wait for external consistency. Each write pays a consensus round trip (ms in-region, 10s–100s of ms cross-region).' },
      { name: 'SQLite', how: 'Embedded library, one file, B-tree storage, single writer at a time (WAL mode allows concurrent readers). Perfect for edge, mobile and per-tenant databases; not a networked multi-writer server.' },
    ],
  },

  lifecycle: {
    summary: 'One transaction `UPDATE accounts SET balance = balance - 100 WHERE id = 42; COMMIT;` on a warm Postgres primary over a same-AZ network. Steady-state cost is dominated by network round trips and the commit fsync, not by SQL processing.',
    stages: [
      { stage: 'Pool checkout', what: 'App borrows an already-open connection from its pool (HikariCP, pgx) or hits PgBouncer, which assigns a server connection for the transaction.', cost: 'In-memory queue; a fresh TCP + TLS + auth handshake would be 3–10 ms', ms: 0.02 },
      { stage: 'Network to DB', what: 'Query bytes travel to the primary (extended protocol: Parse/Bind/Execute or a cached prepared statement).', cost: 'Same-AZ RTT ~0.2–0.5 ms; cross-AZ ~0.5–1 ms', ms: 0.4 },
      { stage: 'Parse + analyze + rewrite', what: 'SQL → parse tree; names resolved against catalog caches; views/rules expanded. Skipped when a prepared statement reuses its plan.', cost: 'Tens of µs for simple statements', ms: 0.03 },
      { stage: 'Plan', what: 'Planner picks an index scan on `accounts_pkey` (unique, ~4 page reads) over a seq scan using statistics.', cost: 'µs for single-table; ms for 10-way joins (GEQO kicks in at 12 tables)', ms: 0.05 },
      { stage: 'Index descent + row lock', what: 'B+tree root → internal → leaf (all buffer hits), fetch heap tuple, check snapshot visibility, take a row lock (`FOR UPDATE` semantics of UPDATE).', cost: 'Buffer hits ~µs each; a cache miss is a random read (~0.1 ms NVMe, ~0.5–1 ms EBS)', ms: 0.02 },
      { stage: 'Write new version + WAL insert', what: 'New tuple written (HOT if no indexed column changed and the page has room), old tuple gets `xmax`; WAL records copied into the in-memory WAL buffer.', cost: 'Memory only; page stays dirty in shared_buffers', ms: 0.02 },
      { stage: 'COMMIT: WAL flush', what: 'Commit record appended, WAL `fsync`ed. Concurrent committers piggyback on the same flush (group commit). This is the only synchronous disk write.', cost: 'NVMe with power-loss protection ~0.05–0.2 ms; EBS/network storage ~0.5–2 ms', ms: 1 },
      { stage: 'Sync standby ack (optional)', what: 'With `synchronous_commit = on` and a synchronous standby, the backend waits until the standby has flushed the commit record.', cost: '+1 cross-AZ RTT + remote fsync', ms: 1.5 },
      { stage: 'Reply to app', what: 'CommandComplete + ReadyForQuery back to the client; connection returned to the pool.', cost: 'Half an RTT on the way back', ms: 0.2 },
      { stage: 'Lazy background work', what: 'Checkpointer writes the dirty page minutes later; autovacuum eventually reclaims the dead tuple; walsender streams WAL to replicas.', cost: 'Off the request path, but competes for I/O', ms: 0 },
    ],
  },

  deepDives: [
    {
      title: 'Storage engines: Postgres heap vs InnoDB clustered index',
      hook: 'Your primary-key choice and update pattern cost very differently on the two engines.',
      body: [
        'Postgres keeps rows in an unordered **heap**: 8 KB pages, each with a line-pointer array and tuples carrying a 23-byte header (`xmin`, `xmax`, `ctid`, infomask). Every index, including the primary key, stores `key → ctid`. Any update writes a new tuple somewhere, so unless it qualifies as a **HOT update** (no indexed column changed and space on the same page), every index on the table gets a new entry.',
        'InnoDB stores the row **inside the primary-key B+tree** (16 KB pages); the PK is the physical order. Secondary indexes store `key → PK value`, so a secondary-index lookup descends two trees, and a fat PK (e.g. a 36-char UUID string) is copied into every secondary index. Updates are in place; the old version goes to the **undo log**.',
        'Consequence: InnoDB loves **monotonic PKs** (auto-increment, UUIDv7/ULID) because inserts append at the right edge; random UUIDv4 PKs scatter inserts across the tree, cause page splits and leave pages ~50–70% full. Postgres heap inserts are append-ish regardless of PK, but random keys still hurt the PK index and its cache footprint.',
      ],
      diagram: {
        type: 'compare',
        title: 'Same table, two layouts',
        columns: [
          { name: 'Postgres heap', points: ['Rows in heap pages, any order', 'PK index: key → ctid', 'Update = new tuple + maybe index entries', 'Old versions in heap → VACUUM', 'Index-only scan needs visibility map'], tone: 'info' },
          { name: 'InnoDB clustered', points: ['Rows in PK B+tree leaves', 'Secondary: key → PK', 'Update in place, old → undo log', 'Purge threads trim undo', 'Range by PK is sequential I/O'], tone: 'violet' },
        ],
      },
      insight: 'Ask “what does one UPDATE cost in index writes?” Postgres tables with 10 indexes and frequently updated non-HOT columns write 11 tuples per update; raising `fillfactor` headroom (e.g. 80–90) to enable HOT is often a bigger win than any hardware.',
    },
    {
      title: 'B+tree internals: fanout, height, splits, fill factor',
      hook: 'Why an index lookup on a billion rows is only 3–4 page reads — and when that stops being true.',
      body: [
        'Internal pages hold only separator keys and child pointers, so with an 8-byte key a single 8–16 KB page holds several hundred children (**fanout**). Height grows with log base fanout: ~300 fanout gives 27M rows at height 3 and ~8B at height 4. The root and internal levels are always hot in the buffer pool, so a point lookup costs ~1 random I/O for the leaf (plus one heap fetch in Postgres).',
        'Inserting into a full leaf triggers a **page split**: half the entries move to a new page and a separator is pushed into the parent (which may split recursively). Sequential keys split only the rightmost page (Postgres and InnoDB both optimise this to leave the left page full); random keys split everywhere, producing half-full pages, more pages to cache and more WAL (Postgres logs full-page images after each checkpoint).',
        '**Fill factor** leaves free space for future updates: Postgres B-tree leaves default to 90, heaps to 100; InnoDB `innodb_fill_factor` (default 100) applies to sorted index builds, which still leave 1/16 of each page free. Deleted entries are not reclaimed until VACUUM (Postgres) or page merge (InnoDB, `MERGE_THRESHOLD` 50%).',
      ],
      table: {
        caption: 'Rows addressable by height (fanout ≈ 300, leaf ≈ 100 rows)',
        columns: ['Height', 'Leaf pages', 'Rows', 'Page reads per lookup'],
        rows: [
          ['2', '300', '~30k', '2'],
          ['3', '90k', '~9M', '3'],
          ['4', '27M', '~2.7B', '4 (top 3 levels cached)'],
          ['5', '8.1B', '~800B', 'Rare outside huge tables'],
        ],
      },
      insight: 'B+tree reads are O(log n) but cache-dependent: the real cliff is when the **leaf level** of your hot indexes outgrows RAM and every lookup becomes a disk read. Track index size vs buffer pool, not just row count.',
    },
    {
      title: 'WAL, group commit, checkpoints and crash recovery',
      hook: 'Commit latency is fsync latency; recovery time is checkpoint distance.',
      body: [
        'Write-ahead rule: a data page may be written to disk only after the WAL records describing its changes are durable. So at COMMIT the database only has to fsync the sequential log. **Group commit** lets one fsync cover every transaction waiting at that moment: 1,000 concurrent commits on a 1 ms fsync device still finish in ~1–2 ms each, not 1 s total (Postgres can widen the window with `commit_delay`; InnoDB/binlog with `binlog_group_commit_sync_delay`).',
        'A **checkpoint** flushes all dirty pages and records a redo start LSN. After a crash, recovery reads WAL from that point and re-applies every change (**redo**). Larger `max_wal_size` means fewer checkpoints (less I/O) but longer recovery. Because the first change to a page after a checkpoint logs a **full-page image** (`full_page_writes = on`), Postgres can repair torn 8 KB pages; InnoDB uses the doublewrite buffer instead.',
        'ARIES (IBM, 1992) formalised this as analysis → redo (repeat history) → undo (roll back losers). InnoDB follows it: redo everything, then roll back uncommitted transactions using undo logs. Postgres skips undo entirely: uncommitted tuples are simply invisible because the commit log (`pg_xact`) never marks their xid committed.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Commit and crash recovery',
        actors: ['Backend', 'WAL buffer', 'WAL disk', 'Data files'],
        messages: [
          { from: 'Backend', to: 'WAL buffer', label: 'insert change records' },
          { from: 'Backend', to: 'WAL buffer', label: 'COMMIT record' },
          { from: 'WAL buffer', to: 'WAL disk', label: 'fsync (group commit)', tone: 'accent' },
          { from: 'WAL disk', to: 'Backend', label: 'durable → ack client', dashed: true, tone: 'ok' },
          { from: 'WAL buffer', to: 'Data files', label: 'checkpoint flushes dirty pages', dashed: true },
          { from: 'WAL disk', to: 'Data files', label: 'after crash: redo from checkpoint', tone: 'warn' },
        ],
      },
      code: {
        lang: 'sql',
        caption: 'Durability knobs (Postgres / MySQL)',
        code: `-- Postgres: per-transaction trade of durability for latency
SET LOCAL synchronous_commit = off;   -- ack before WAL flush; crash loses <= ~3x wal_writer_delay
SHOW full_page_writes;                -- on: torn-page protection (never disable on normal storage)
SHOW checkpoint_timeout;              -- 5min default
SHOW max_wal_size;                    -- 1GB default; raise on write-heavy boxes

-- MySQL/InnoDB
-- innodb_flush_log_at_trx_commit = 1  (fsync redo per commit; 2 = write, fsync ~1/s)
-- sync_binlog = 1                     (fsync binlog per commit group)`,
      },
      insight: 'Never turn off fsync to “go faster” — `synchronous_commit = off` gives most of the speed and only loses the last few hundred ms of commits on a crash, whereas `fsync = off` can corrupt the whole cluster.',
    },
    {
      title: 'MVCC, VACUUM/purge and transaction ID wraparound',
      hook: 'Readers never block writers — and garbage is the price you pay forever.',
      body: [
        'Postgres stamps every tuple with `xmin` (creating xid) and `xmax` (deleting/updating xid). A snapshot is (xmin, xmax, in-progress list); a tuple is visible if its creator committed before the snapshot and its deleter did not. Updates leave dead tuples in the heap and indexes; **autovacuum** removes those no snapshot can still see, updates the visibility map (which enables index-only scans) and **freezes** old tuples.',
        'Transaction IDs are 32-bit and compared modulo 2^32, so only ~2 billion xids are “in the past”. Tuples must be frozen before their xid falls off that horizon; autovacuum starts aggressive anti-wraparound scans at `autovacuum_freeze_max_age` (200M default). If it cannot keep up, Postgres warns and eventually **refuses new write transactions** until a manual VACUUM finishes — a full write outage on a big table.',
        'InnoDB updates in place and writes the previous version to **undo logs**; readers walk the roll-pointer chain back to the version their read view can see. Purge threads delete undo once no read view needs it. A single long-running transaction (an `idle in transaction` session, a 6-hour report on REPEATABLE READ) blocks purge/VACUUM for the whole instance: history list length grows, bloat grows, every query slows.',
      ],
      diagram: {
        type: 'compare',
        title: 'Where old versions live',
        columns: [
          { name: 'Postgres', points: ['Old tuple stays in heap', 'xmin/xmax visibility', 'VACUUM reclaims space', 'Bloat if vacuum lags', 'xid wraparound risk'], tone: 'info' },
          { name: 'InnoDB', points: ['Row updated in place', 'Old version in undo log', 'Purge trims undo', 'History list length grows', 'Undo tablespace bloat'], tone: 'violet' },
        ],
        caption: 'Same disease, different organ: long transactions hold back cleanup in both.',
      },
      code: {
        lang: 'sql',
        caption: 'The three queries every Postgres on-call should know',
        code: `-- Oldest open transactions (vacuum blockers)
SELECT pid, state, now() - xact_start AS age, left(query, 60)
FROM pg_stat_activity WHERE xact_start IS NOT NULL ORDER BY xact_start LIMIT 5;

-- Distance to wraparound per database (alert well before 1B)
SELECT datname, age(datfrozenxid) FROM pg_database ORDER BY 2 DESC;

-- Dead tuples and last autovacuum per table
SELECT relname, n_dead_tup, last_autovacuum FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC LIMIT 10;`,
      },
      insight: 'Set `idle_in_transaction_session_timeout` and a statement timeout on day one; most bloat and wraparound emergencies trace back to one forgotten open transaction, not to autovacuum tuning.',
    },
    {
      title: 'Isolation levels, anomalies and locking',
      hook: '“We use transactions” does not mean your invariant is protected.',
      body: [
        'Postgres defaults to **READ COMMITTED** (new snapshot per statement); MySQL InnoDB defaults to **REPEATABLE READ** (one snapshot per transaction for plain SELECTs). Neither prevents **write skew**: two doctors each check “≥ 2 on call”, both go off call, invariant broken. Read-modify-write in application code (`SELECT balance` then `UPDATE … SET balance = :new`) is a **lost update** under READ COMMITTED.',
        'Fixes, in order of preference: make the write atomic (`UPDATE … SET balance = balance - 100 WHERE balance >= 100`), lock what you read (`SELECT … FOR UPDATE`), use **optimistic concurrency** (`UPDATE … WHERE id = ? AND version = ?`, retry on 0 rows), or run **SERIALIZABLE**. Postgres SSI tracks read/write dependencies with SIRead predicate locks and aborts one transaction of a dangerous cycle with SQLSTATE `40001`; the client must retry.',
        'InnoDB locks index records, not rows in the abstract: under REPEATABLE READ, locking reads and updates take **next-key locks** (record + gap before it) to block phantoms, so `UPDATE … WHERE status = ?` without an index can lock most of the table. Both engines detect **deadlocks** via wait-for graphs (Postgres checks after `deadlock_timeout` = 1 s; InnoDB immediately) and kill a victim; InnoDB lock waits time out after `innodb_lock_wait_timeout` = 50 s.',
      ],
      table: {
        caption: 'What each level prevents (Postgres semantics)',
        columns: ['Level', 'Dirty read', 'Non-repeatable read', 'Phantom', 'Lost update', 'Write skew'],
        rows: [
          ['Read committed', 'No', 'Yes', 'Yes', 'Yes (app RMW)', 'Yes'],
          ['Repeatable read (SI)', 'No', 'No', 'No (Postgres)', 'No (aborts, 40001)', 'Yes'],
          ['Serializable (SSI)', 'No', 'No', 'No', 'No', 'No (aborts, 40001)'],
          ['MySQL RR (InnoDB)', 'No', 'No for plain reads', 'Next-key locks on locking reads', 'Yes (locking reads see latest)', 'Yes'],
        ],
      },
      insight: 'Isolation names are not portable: MySQL REPEATABLE READ silently lets a read-modify-write lose an update where Postgres REPEATABLE READ would abort it. Senior engineers encode invariants as constraints or atomic statements and treat retries on 40001/deadlock as mandatory client behaviour.',
    },
    {
      title: 'Planner, statistics, EXPLAIN ANALYZE and indexing strategy',
      hook: 'Most “the DB is slow” incidents are one bad plan, not a slow database.',
      body: [
        'Read `EXPLAIN (ANALYZE, BUFFERS)` bottom-up: compare **estimated vs actual rows** at each node (a 100× miss means stale or insufficient stats or correlated columns), look at `shared hit` vs `read` buffers (cache misses), and at loops (a nested loop with 50k inner index scans). Fix stats with `ANALYZE`, a higher per-column statistics target, or `CREATE STATISTICS` for correlated columns.',
        '**Composite index order**: equality columns first, then the range or sort column (`(tenant_id, status, created_at)` serves `WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC LIMIT 50` with no sort). A **covering** index (`INCLUDE (total)` in Postgres, or extra key columns in InnoDB) allows an **index-only scan**. **Partial indexes** (`WHERE status = \'pending\'`) index only the hot 1% (Postgres; MySQL lacks them).',
        'Every index is a write tax: each insert updates every index (InnoDB buffers secondary-index changes in its change buffer; Postgres does not), adds WAL, competes for buffer pool and lengthens VACUUM. Audit with `pg_stat_user_indexes.idx_scan = 0` and drop unused indexes; build new ones with `CREATE INDEX CONCURRENTLY` (Postgres) or online DDL (InnoDB).',
      ],
      code: {
        lang: 'sql',
        caption: 'Spotting a misestimate and the index that fixes it',
        code: `EXPLAIN (ANALYZE, BUFFERS)
SELECT id, total FROM orders
WHERE tenant_id = 42 AND status = 'pending'
ORDER BY created_at DESC LIMIT 50;
-- Limit (actual rows=50)
--   -> Sort (Sort Method: top-N heapsort)
--     -> Seq Scan on orders (rows=120 est. / 48210 actual)  <-- misestimate
--          Filter: tenant_id = 42 AND status = 'pending'
--          Buffers: shared hit=1203 read=88412                <-- cold reads

CREATE INDEX CONCURRENTLY orders_tenant_pending
  ON orders (tenant_id, created_at DESC) INCLUDE (total)
  WHERE status = 'pending';
-- -> Index Only Scan using orders_tenant_pending (actual rows=50) Buffers: shared hit=6`,
      },
      insight: 'A plan can flip overnight with no deploy: data growth crosses a cost threshold or a prepared statement switches from a custom to a generic plan after 5 executions (`plan_cache_mode`). Capture plans with `auto_explain` / `pg_stat_statements` so you can diff before vs after.',
    },
    {
      title: 'Connection management and pooling',
      hook: 'Postgres `max_connections` is not a capacity knob — it is a foot-gun.',
      body: [
        'Each Postgres connection is an OS process with its own memory and catalog caches; computing snapshots scaled with connection count until PG14 improved it. Throughput peaks at roughly **2–4× CPU cores of active connections** and then falls as they fight over locks and CPU. 200 Kubernetes pods × a pool of 20 = 4,000 connections is a classic outage.',
        '**PgBouncer** in `transaction` mode multiplexes thousands of client connections onto a small server pool: a server connection is assigned only for the duration of a transaction. Session-level state does not survive across transactions: `SET` without `LOCAL`, session advisory locks, `LISTEN/NOTIFY`, temp tables; protocol-level prepared statements need PgBouncer ≥ 1.21 with `max_prepared_statements`. Alternatives: RDS Proxy, Odyssey, PgCat, Supavisor; ProxySQL for MySQL.',
      ],
      table: {
        caption: 'PgBouncer pool modes',
        columns: ['Mode', 'Server conn held for', 'Multiplexing', 'Breaks'],
        rows: [
          ['session', 'Whole client session', 'Low (1:1 while connected)', 'Nothing; just caps total'],
          ['transaction', 'One transaction', 'High (10–100:1)', 'Session SET, advisory locks, LISTEN, temp tables'],
          ['statement', 'One statement', 'Highest', 'Multi-statement transactions entirely'],
        ],
      },
      code: {
        lang: 'text',
        caption: 'pgbouncer.ini (essentials)',
        code: `[pgbouncer]
pool_mode = transaction
max_client_conn = 10000        ; app side
default_pool_size = 40         ; server conns per db/user pair (~2-4x cores)
reserve_pool_size = 10
server_idle_timeout = 60
max_prepared_statements = 200  ; >= 1.21, keeps prepared stmts working
query_wait_timeout = 5         ; fail fast instead of queueing forever`,
      },
      insight: 'Size the pool from the database side (cores and disk), then make the app queue: a pool wait that fails fast at 5 s is a recoverable error, while 4,000 backends thrashing the primary is an outage for every caller.',
    },
    {
      title: 'HA, backups/PITR and online schema changes',
      hook: 'A replica is not a backup, and an ALTER TABLE is a production deploy.',
      body: [
        '**HA**: Patroni runs beside each Postgres, holds a leader key with TTL (30 s default) in etcd/Consul/ZooKeeper, and promotes the most caught-up standby when the key expires; the old primary demotes itself when it cannot renew. RDS Multi-AZ (instance) keeps a synchronous block-level standby and fails over in ~1–2 min via DNS; Aurora fails over to a reader in ~30 s because storage is shared.',
        '**Backups**: base backup plus continuous WAL archiving (pgBackRest, WAL-G; Percona XtraBackup + binlogs for MySQL) enables **point-in-time recovery** to just before the bad `DELETE`. Replicas faithfully replicate the `DELETE`, so they are not backups. A backup is only real after a scheduled, monitored **restore test**.',
        '**Online migrations**: in Postgres, `ALTER TABLE` takes an ACCESS EXCLUSIVE lock; if it waits behind a long query, every new query queues behind it. Always set `lock_timeout` and retry. For big MySQL tables use **gh-ost** (triggerless: copies rows into a ghost table while tailing the binlog, then atomic cut-over) or **pt-online-schema-change** (trigger-based). Model breaking changes as **expand → migrate → contract** across deploys.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Patroni failover',
        actors: ['Primary', 'etcd', 'Standby', 'Pooler'],
        messages: [
          { from: 'Primary', to: 'etcd', label: 'renew leader key (TTL 30s)' },
          { from: 'Primary', to: 'etcd', label: 'renewals stop (crash)', tone: 'bad' },
          { from: 'etcd', to: 'Standby', label: 'leader key expired', dashed: true },
          { from: 'Standby', to: 'etcd', label: 'acquire key (CAS)', tone: 'accent' },
          { from: 'Standby', to: 'Pooler', label: 'promoted, new timeline' },
          { from: 'Pooler', to: 'Standby', label: 'repoint via VIP / DNS', tone: 'ok' },
        ],
        caption: 'Only the key holder may be primary; a revived old primary must rejoin as a standby (pg_rewind).',
      },
      code: {
        lang: 'sql',
        caption: 'Safe DDL pattern in Postgres',
        code: `SET lock_timeout = '3s';          -- give up instead of blocking the world
SET statement_timeout = '15min';
ALTER TABLE orders ADD COLUMN source text;           -- metadata-only (PG11+ even with constant default)
CREATE INDEX CONCURRENTLY orders_source ON orders (source);
ALTER TABLE orders ADD CONSTRAINT source_chk
  CHECK (source IN ('web','app')) NOT VALID;         -- instant
ALTER TABLE orders VALIDATE CONSTRAINT source_chk;   -- scans without blocking writes`,
      },
      insight: 'RPO and RTO are product decisions: async standbys give RPO > 0, sync standbys cost a cross-AZ RTT per commit, and PITR restore time scales with database size plus WAL to replay — measure it, because “hours” is a common surprise.',
    },
  ],

  scaling: {
    body: [
      'Scale **up** first: a modern 64–128 vCPU box with NVMe and 0.5–2 TB RAM handles tens of thousands of write TPS and keeps most working sets in memory. Then offload **reads** to replicas and caches, move analytics to a warehouse via CDC, and use **partitioning** (Postgres declarative range/list/hash) so huge tables get partition pruning and old data is dropped with `DROP/DETACH PARTITION` instead of a massive `DELETE`.',
      'Writes beyond one primary need **sharding**: application-level (tenant → shard map), a proxy layer (Vitess for MySQL — YouTube, Slack, GitHub; Citus for Postgres), or a distributed SQL database (Spanner, CockroachDB, TiDB, Aurora Limitless). Each trades away cheap cross-shard joins and transactions or pays consensus latency.',
      'Control plane vs data plane: the failover manager (Patroni + etcd, Orchestrator + raft, RDS control plane) must fail **safe** — if it cannot reach consensus it should do nothing rather than promote a second primary. Multi-region active-active for a single relational primary is not a thing: either one write region with async cross-region replicas, or a consensus database with per-row homing (Spanner, CockroachDB REGIONAL BY ROW).',
    ],
    bullets: [
      'Vertical first: RAM for working set, NVMe for fsync latency, cores for concurrency.',
      'Read replicas and caches for read scale; never for write scale.',
      'Partition time-series tables by month; drop old partitions instead of DELETE.',
      'Shard by the key that keeps transactions single-shard (tenant_id, user_id).',
      'Pooler in front of every primary; cap total connections.',
      'Synchronous standby in another AZ for RPO 0; async cross-region for DR.',
      'Test failover and restore regularly; both are code paths that rot.',
    ],
    diagram: {
      type: 'flow',
      title: 'Typical scaling path',
      nodes: [
        { label: 'Bigger box', sub: 'RAM, NVMe, cores' },
        { label: 'Pooler + indexes', sub: 'fix the 10 worst queries', tone: 'info' },
        { label: 'Replicas + cache', sub: 'read offload', tone: 'ok' },
        { label: 'Partitioning', sub: 'prune and drop', tone: 'accent' },
        { label: 'Functional split', sub: 'DB per domain', tone: 'warn' },
        { label: 'Sharding', sub: 'Vitess, Citus, Spanner', tone: 'bad' },
      ],
      caption: 'Each step to the right costs more engineering; most companies stop at step 4.',
    },
  },

  failures: [
    {
      name: 'Connection storm / exhaustion',
      symptom: 'Autoscaled pods or a deploy open thousands of connections; `FATAL: sorry, too many clients already`, CPU in kernel scheduling, latency for everyone.',
      detect: '`pg_stat_activity` count by state vs `max_connections`; pooler `cl_waiting` and `maxwait` (`SHOW POOLS`); MySQL `Threads_connected`/`Threads_running`.',
      mitigate: 'Pooler in transaction mode, per-pod pool caps sized from DB cores, fail-fast pool wait timeouts, jittered reconnects.',
    },
    {
      name: 'Plan regression / missing index',
      symptom: 'A 2 ms query becomes a multi-second seq scan after data growth, a stats change or a new code path; CPU and I/O spike.',
      detect: '`pg_stat_statements` top by `total_exec_time` and mean time delta; slow query log (`log_min_duration_statement`); `auto_explain` for plans; p99 latency by query fingerprint.',
      mitigate: 'Right composite/partial index (built concurrently), `ANALYZE`, extended statistics; query timeouts so one bad query cannot pile up.',
    },
    {
      name: 'Vacuum debt / bloat / wraparound',
      symptom: 'Tables and indexes grow while row counts are flat; scans slow; ultimately `database is not accepting commands to avoid wraparound data loss`.',
      detect: '`age(datfrozenxid)` alert at ~500M–1B; `n_dead_tup` trends; oldest `xact_start`; InnoDB `History list length` in `SHOW ENGINE INNODB STATUS`.',
      mitigate: 'Kill long/idle-in-transaction sessions, tune autovacuum per table (scale factor, cost limit), `pg_repack` for bloat, schedule manual freezes on huge tables.',
    },
    {
      name: 'Lock queue behind DDL / hot rows',
      symptom: 'A migration’s ALTER waits on a long SELECT and every query queues behind it; or all checkouts update one inventory row and serialise.',
      detect: '`pg_locks` joined to `pg_stat_activity` with `wait_event_type = Lock`; `pg_blocking_pids()`; InnoDB `innodb_row_lock_waits`, deadlock count.',
      mitigate: '`lock_timeout` on every migration, online DDL tools, split hot counters into N rows or move them to Redis, keep transactions short.',
    },
    {
      name: 'Checkpoint / fsync I/O stalls',
      symptom: 'Periodic latency spikes every few minutes; commit p99 jumps when the checkpointer flushes or the disk hits its IOPS/throughput cap (EBS burst exhausted).',
      detect: '`pg_stat_bgwriter`/`pg_stat_checkpointer` (requested vs timed checkpoints), WAL fsync time, disk queue depth, EBS `BurstBalance`.',
      mitigate: 'Raise `max_wal_size`, `checkpoint_completion_target = 0.9`, provisioned IOPS/NVMe, separate WAL volume.',
    },
    {
      name: 'Failover gone wrong',
      symptom: 'Promotion of a lagging standby loses acknowledged writes, or two primaries accept writes after a partition (split brain).',
      detect: 'Replication lag at failover time, timeline/GTID divergence, writes observed on more than one node, orchestration audit log.',
      mitigate: 'Consensus-based leader lease + fencing, synchronous/quorum standby for critical data, `pg_rewind` for the old primary, game-day tests.',
    },
  ],

  warStories: [
    {
      title: 'Primary data directory deleted; five backup mechanisms failed',
      source: 'GitLab.com postmortem, January 31 2017',
      what: 'During a spam-driven load spike, replication to the secondary broke. While re-seeding it late at night, an engineer ran `rm -rf` on the data directory of the **primary** instead of the secondary, deleting ~300 GB. Regular `pg_dump` backups had been silently failing (wrong client version, alert emails rejected), disk snapshots were not enabled for the DB hosts, so the restore used a staging copy taken ~6 hours earlier. About 6 hours of data (projects, issues, comments, users) was lost and the site was down for ~18 hours.',
      lesson: 'Backups that are not restore-tested and alerted on do not exist. Make destructive commands host-aware (prompts showing role), use PITR via WAL archiving, and never debug replication on the primary under fatigue.',
    },
    {
      title: '43-second partition, 24 hours of degradation',
      source: 'GitHub post-incident analysis, October 21 2018',
      what: 'Replacing failing optical equipment caused a 43 s loss of connectivity between the US East Coast hub and its primary data center. Orchestrator (Raft-based) promoted MySQL primaries in the **West Coast** data center. When connectivity returned, the East Coast primaries held a few seconds of writes never replicated West, and applications in the East now paid cross-country latency on every write. GitHub chose data integrity: restored from backups, re-synced replicas and reconciled the orphaned writes, running degraded for **24 h 11 min**.',
      lesson: 'Automated failover must encode topology policy (do not promote across regions on a short blip); async cross-region replicas mean any cross-region promotion loses data; recovery time is dominated by how fast you can restore and re-seed replicas.',
    },
    {
      title: 'Transaction ID wraparound took the database read-only',
      source: 'Sentry engineering blog, July 2015',
      what: 'Sentry’s very write-heavy Postgres burned through transaction IDs faster than autovacuum could freeze old tuples on large tables. Postgres hit its wraparound safety limit and stopped accepting writes; the only fix was a long manual VACUUM, during which Sentry was down for most of a working day.',
      lesson: 'Alert on `age(datfrozenxid)` long before the limit, give autovacuum enough workers and cost budget on huge tables, partition so freezing is incremental, and avoid burning xids (e.g. one transaction per row in batch jobs).',
    },
  ],

  numbers: [
    { label: 'Page size', value: '8 KB / 16 KB', note: 'Postgres heap and index / InnoDB' },
    { label: 'Row overhead', value: '~23 B + 4 B', note: 'Postgres tuple header + line pointer; InnoDB ~18–20 B' },
    { label: 'B+tree height', value: '3–4 levels', note: 'For millions to billions of rows; upper levels cached' },
    { label: 'fsync latency', value: '0.05–0.2 ms / 0.5–2 ms', note: 'NVMe with PLP / EBS or network storage' },
    { label: 'Simple write TPS', value: '~1k–5k per core', note: 'Single-row txns, group commit, in-memory working set' },
    { label: 'Point reads', value: '100k–1M+/s', note: 'Large box, cached, prepared statements' },
    { label: 'Healthy active connections', value: '2–4× cores', note: 'Beyond that throughput drops; pool the rest' },
    { label: 'Postgres max_connections', value: '100 (default)', note: 'Each a process; raise with care' },
    { label: 'Wraparound horizon', value: '~2.1B xids', note: 'Freeze starts at autovacuum_freeze_max_age = 200M' },
    { label: 'Failover time', value: '10–30 s / 60–120 s', note: 'Patroni / RDS Multi-AZ instance' },
    { label: 'Aurora storage', value: '6 copies, 3 AZs', note: '4/6 write quorum, 3/6 read quorum' },
  ],

  capacity: {
    question: 'An order service expects 3,000 orders/s at peak; each order is one transaction inserting 1 order row + 5 line items and updating inventory. Will a single Postgres primary cope, and how big must it be?',
    steps: [
      'Writes: 3,000 txn/s × (6 inserts + 5 inventory updates) ≈ 33k row writes/s. Each row touches ~3 indexes ⇒ ~100k index entry writes/s.',
      'WAL: ~300 B per row change incl. index records ⇒ ~33k × 300 B × 3 ≈ 30 MB/s of WAL, plus full-page images after checkpoints (often 2–3× more) ⇒ plan for ~60–100 MB/s sequential WAL.',
      'Commits: 3,000/s with group commit on NVMe (0.1 ms fsync) is trivial; on 1 ms network storage each flush still batches ~3 commits, fine — but a sync standby adds ~1 ms cross-AZ per commit to latency, not to throughput.',
      'CPU: at ~2k simple write txns/s per core, these heavier txns (~11 statements) need ~10–15 cores busy ⇒ a 32–48 vCPU box keeps headroom; pool at ~64–96 server connections.',
      'Storage: 3,000 × 86,400 × 6 rows × ~200 B ≈ 300 GB/day raw ⇒ ~100 TB/year: partition orders by month and archive to object storage; keep hot months in RAM-sized indexes.',
      'Inventory hotspot: popular SKUs updated 100s of times/s serialise on row locks ⇒ reserve stock in N bucket rows per SKU or decrement in Redis with reconciliation.',
    ],
    answer: 'One well-provisioned primary (≈48 vCPU, 384 GB RAM, NVMe or high-IOPS storage, separate WAL volume) handles the throughput; the real risks are storage growth (needs monthly partitioning + archival) and hot inventory rows, not TPS. Add a sync standby in a second AZ for RPO 0 and replicas for reads.',
  },

  comparison: {
    caption: 'Relational engines for the system of record',
    columns: ['Product', 'Storage / MVCC', 'Write scaling', 'HA model', 'Best for', 'Watch out'],
    rows: [
      ['PostgreSQL', 'Heap + indexes; tuple versions, VACUUM', 'Single primary (Citus to shard)', 'Streaming standbys + Patroni', 'Rich SQL, extensions, mixed workloads', 'Bloat, wraparound, connection cost'],
      ['MySQL / InnoDB', 'Clustered PK B+tree; undo logs', 'Single primary (Vitess to shard)', 'Binlog replicas + Orchestrator / group replication', 'Simple high-QPS OLTP at huge scale', 'RR lost updates, gap-lock surprises'],
      ['Amazon Aurora', 'Engine on log-structured shared storage', 'Single writer (Limitless for sharding)', '6 copies/3 AZs, ~30 s failover', 'Managed HA with fast replicas', 'Cost per I/O, vendor lock-in'],
      ['CockroachDB / Spanner', 'Raft/Paxos ranges on LSM', 'Horizontal writes, auto-split', 'Consensus per range, multi-region', 'Global, strongly consistent OLTP', 'Consensus latency per write, contention retries'],
      ['SQLite', 'Single-file B-tree, WAL mode', 'One writer at a time', 'Copy file / Litestream', 'Embedded, edge, per-tenant DBs', 'Not a shared network server'],
    ],
  },

  whenNot: [
    'Queue or job table polled by many workers at high rate: use Kafka/SQS/RabbitMQ (or `SKIP LOCKED` only at modest scale) — polling and deletes create bloat and lock contention.',
    'Large binary objects (images, video, PDFs): store in object storage (S3) and keep only the key and metadata in the DB.',
    'Full-text search, relevance and typo tolerance: use Elasticsearch/OpenSearch fed by CDC (or Postgres FTS for small needs).',
    'Write-heavy append-only telemetry at millions of rows/s with simple key access: a wide-column store (Cassandra/ScyllaDB) or a time-series DB.',
    'Analytical scans over billions of rows: a columnar warehouse (BigQuery, Snowflake, ClickHouse) fed from the primary, not the primary itself.',
  ],

  interview: [
    {
      q: 'Walk me through what happens, physically, when a transaction commits in Postgres.',
      a: 'The backend has already modified pages in shared_buffers and copied WAL records into the WAL buffer. At COMMIT it appends a commit record and calls fsync on the WAL up to that LSN; concurrent committers share that flush (group commit). Only then is the transaction marked committed in `pg_xact` and the client acked. Data pages are written later by the checkpointer/bgwriter; after a crash, redo replays WAL from the last checkpoint, and uncommitted tuples are just invisible, so no undo pass is needed.',
      followUps: [
        'What does `synchronous_commit = off` lose, and what does it not risk?',
        'Why do full-page writes exist and what do they cost?',
        'How does a synchronous standby change the commit path?',
      ],
      seniorSignal: 'Separates durability (WAL fsync) from data-file writes, mentions group commit and checkpoint distance as the recovery-time trade-off, and knows Postgres needs no undo phase.',
    },
    {
      q: 'Two users book the last seat at the same time. How do you guarantee only one succeeds?',
      a: 'Encode the invariant so the database enforces it: a unique constraint on `(flight_id, seat_no)` for seat bookings, or an atomic conditional update `UPDATE seats SET booked_by = ? WHERE id = ? AND booked_by IS NULL` and check rows affected. If the rule spans rows (capacity counts), lock the parent row with `SELECT … FOR UPDATE` or run SERIALIZABLE and retry on 40001. Avoid read-then-write in app code under READ COMMITTED; it is a lost-update race.',
      followUps: [
        'What is write skew and which isolation level prevents it?',
        'How does this change on MySQL REPEATABLE READ?',
        'How would you handle 10k people racing for 100 concert seats?',
      ],
      seniorSignal: 'Prefers constraints and atomic statements over application locks, knows SSI requires client retries, and recognises hot-row contention at scale (queue or token bucket in front).',
    },
    {
      q: 'A query that took 5 ms yesterday takes 8 seconds today with no deploy. How do you debug it?',
      a: 'Confirm with `pg_stat_statements` which fingerprint regressed, then capture the current plan with `EXPLAIN (ANALYZE, BUFFERS)` (or `auto_explain` logs) and compare estimated vs actual rows. Typical causes: stale statistics after a bulk load, a generic plan chosen for a prepared statement, data distribution crossing a cost threshold (index scan → seq scan), bloat, or lock waits rather than execution. Fix the root cause: `ANALYZE`, extended statistics, a better composite or partial index, or a rewrite; and add a statement timeout so one plan cannot take the box down.',
      followUps: [
        'How do you tell a lock wait from a slow plan?',
        'What makes an index-only scan fall back to heap fetches?',
        'When would you use a partial index?',
      ],
      seniorSignal: 'Reads plans by estimate-vs-actual and buffers rather than guessing, and knows the planner can change its mind without code changes.',
    },
    {
      q: 'Your Postgres table is 400 GB but holds only 80 GB of live data. What happened and what do you do?',
      a: 'That is MVCC bloat: dead tuples that autovacuum never reclaimed, usually because a long-running or idle-in-transaction session held back the xmin horizon, autovacuum thresholds were too lax for a huge high-churn table, or a replication slot / `hot_standby_feedback` pinned old rows. First remove the cause (kill the old transaction, drop stale slots), then tune autovacuum per table. VACUUM marks space reusable but rarely shrinks files; to give space back use `pg_repack` (online) rather than `VACUUM FULL` (exclusive lock).',
      followUps: [
        'How does this relate to transaction ID wraparound?',
        'What is the InnoDB equivalent and how would you see it?',
        'Why do HOT updates reduce index bloat?',
      ],
      seniorSignal: 'Goes straight to the xmin horizon (long transactions, slots, standby feedback) instead of “run VACUUM FULL”, and knows the operational difference between reclaiming and returning space.',
    },
    {
      q: 'How would you make a relational primary highly available with RPO 0 and RTO under a minute?',
      a: 'Run a primary plus at least two standbys in different AZs with quorum synchronous replication (`synchronous_standby_names = \'ANY 1 (s1, s2)\'`), so every acked commit is on two nodes and one standby can fail without blocking writes. Use Patroni (or a managed equivalent) with a consensus store for leader election, fencing of the old primary, and a single routing endpoint (VIP, DNS or pooler) for clients. Add WAL archiving for PITR because HA does not protect against logical errors. Rehearse failover regularly and alert on standby lag.',
      followUps: [
        'What happens to writes if both synchronous standbys are down?',
        'How do clients find the new primary fast?',
        'How does Aurora achieve similar guarantees differently?',
      ],
      seniorSignal: 'Uses quorum sync to avoid the single-sync-standby availability trap, separates HA from backups, and mentions fencing and client routing, not just promotion.',
    },
    {
      q: 'How do you add a NOT NULL column with an index to a 2-billion-row table without downtime?',
      a: 'Expand-contract: add the column nullable (metadata-only in modern Postgres and instant ADD COLUMN in MySQL 8), deploy code that writes it, backfill in small batches with throttling and replica-lag checks, then add the constraint as `CHECK (col IS NOT NULL) NOT VALID` and `VALIDATE` it (Postgres can then set NOT NULL cheaply on PG12+), and build the index with `CREATE INDEX CONCURRENTLY`. On MySQL use gh-ost or pt-online-schema-change for table rebuilds. Every DDL statement runs with a `lock_timeout` and retries.',
      followUps: [
        'Why is the lock queue more dangerous than the lock itself?',
        'How does gh-ost avoid triggers?',
        'How do you keep backfill from lagging replicas?',
      ],
      seniorSignal: 'Treats schema changes as multi-deploy migrations, knows the ACCESS EXCLUSIVE lock-queue trap, and throttles on replica lag.',
    },
    {
      q: 'Postgres, MySQL, Aurora, or Spanner/CockroachDB for a new payments ledger — how do you decide?',
      a: 'Start from requirements: write rate, data size growth, latency budget, region topology and team expertise. A single-region ledger at thousands of TPS fits Postgres or Aurora with sync standbys and strict constraints; Aurora buys faster failover and replica scaling for a cost-per-I/O premium. If writes must be accepted in multiple regions with strong consistency, or growth will exceed one primary within the planning horizon, Spanner or CockroachDB trade higher per-write latency for horizontal, serializable writes. MySQL with Vitess is proven at enormous scale but pushes cross-shard transactions to the application.',
      followUps: [
        'What latency does a cross-region consensus write cost?',
        'How would you shard a ledger on Vitess?',
        'What would make you choose SERIALIZABLE?',
      ],
      seniorSignal: 'Frames the choice around write scaling, consistency across regions and operational maturity, with concrete latency costs rather than brand preference.',
    },
  ],

  takeaways: [
    'Durability = fsynced WAL; data pages are written lazily, and recovery time ∝ distance from the last checkpoint.',
    'MVCC means readers never block writers, but long transactions block cleanup — bloat and wraparound follow.',
    'Isolation names are not portable; encode invariants as constraints or atomic statements and retry 40001s.',
    'Index order is equality → range/sort; every index is a write tax; read plans as estimated vs actual rows.',
    'Pool connections: throughput peaks around 2–4× cores of active sessions.',
    'HA (standbys + fenced failover) is not backup (PITR + restore tests).',
    'Scale up, then read replicas and partitioning; shard writes only when you must, along the transaction boundary.',
  ],
};

export default deep;
