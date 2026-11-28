import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'cdc',

  problem: {
    why: 'Every database already writes each committed change to a log for crash recovery and replication (Postgres WAL, MySQL binlog). Change data capture reads that log and turns it into an ordered stream of row-level events, so other systems — caches, search, warehouses, other services — can follow the database without the application doing **dual writes**. It is the only approach that captures every change, including deletes and writes from scripts or migrations, with sub-second lag and almost no query load.',
    withoutIt: [
      'The app writes to the DB and then to Kafka/Elasticsearch/cache; a crash or error between the two leaves them permanently inconsistent.',
      'Polling `WHERE updated_at > :last` misses deletes, misses intermediate updates, and misses rows whose transaction committed late with an older timestamp.',
      'Writes from admin scripts, backfills or other services bypass application-level event publishing entirely.',
      'Nightly full dumps make search indexes and warehouses hours stale and hammer the primary.',
    ],
    position: 'Attached to the source database as a replication client (logical replication slot or binlog replica), typically running in Kafka Connect, publishing per-table topics consumed by sinks and services.',
    diagram: {
      type: 'flow',
      title: 'From commit log to consumers',
      nodes: [
        { label: 'App writes', sub: 'single DB transaction', tone: 'neutral' },
        { label: 'WAL / binlog', sub: 'already written', tone: 'accent' },
        { label: 'CDC connector', sub: 'decode + snapshot', tone: 'info' },
        { label: 'Kafka topics', sub: 'per table, keyed by PK', tone: 'accent' },
        { label: 'Search / cache / lake', sub: 'independent consumers', tone: 'ok' },
      ],
    },
  },

  architecture: {
    overview: 'A log-based CDC pipeline has a **source position** pinned in the database (a Postgres replication slot or a MySQL binlog file/GTID), a **decoder** that turns physical log records into row changes, a **snapshotter** that captures existing rows and hands off to streaming at a consistent position, an **event envelope** with before/after images and source metadata, a **schema** channel, and an **offset store** that records how far the pipeline has durably published. Debezium implements these as Kafka Connect source connectors; managed services (DMS, Datastream, Fivetran) implement the same ideas behind an API.',
    diagram: {
      type: 'flow',
      title: 'Debezium on Kafka Connect',
      nodes: [
        { label: 'Postgres WAL', sub: 'wal_level=logical', tone: 'neutral' },
        { label: 'Slot + pgoutput', sub: 'decodes at commit', tone: 'accent' },
        { label: 'Debezium task', sub: 'snapshot → stream', tone: 'info' },
        { label: 'Converter', sub: 'Avro + registry', tone: 'violet' },
        { label: 'Kafka topics', sub: 'db.schema.table', tone: 'accent' },
        { label: 'Offsets topic', sub: 'LSN → flush to slot', tone: 'warn' },
      ],
      caption: 'Kafka Connect stores the last published LSN and confirms it back to Postgres, which then recycles older WAL.',
    },
    blocks: [
      { name: 'Replication slot (Postgres)', what: 'Server-side cursor that guarantees WAL is retained until the consumer confirms an LSN (`confirmed_flush_lsn`). Logical slots decode WAL via an output plugin (`pgoutput` built in since PG10).' },
      { name: 'Publication', what: '`CREATE PUBLICATION` defines which tables `pgoutput` emits. Debezium can auto-create `dbz_publication`; on large schemas, explicitly listing tables avoids decoding noise.' },
      { name: 'Binlog reader (MySQL)', what: 'The connector registers as a replica with a unique `server_id` and streams row events; requires `binlog_format=ROW`, `binlog_row_image=FULL`, and GTIDs for failover-safe positions.' },
      { name: 'Snapshotter', what: 'Initial consistent snapshot of existing rows, then streaming from the exact log position of that snapshot. Incremental snapshots chunk tables by PK and interleave with streaming (DBLog watermark algorithm).' },
      { name: 'Event envelope', what: '`before`, `after`, `op` (c/u/d/r/t), `ts_ms`, `source` (LSN/GTID, txId, table). Deletes are followed by a tombstone so compacted topics drop the key.' },
      { name: 'Schema history / registry', what: 'MySQL binlog lacks column names, so Debezium replays DDL from a **schema history topic**; Postgres sends relation metadata in-stream. Payload schemas go to a schema registry with compatibility checks.' },
      { name: 'Offset store', what: 'Kafka Connect `offset.storage.topic` holds the last LSN/GTID published; flushed every `offset.flush.interval.ms` (60 s default) — the at-least-once replay window after a crash.' },
    ],
    real: [
      { name: 'Debezium', how: 'Open-source Kafka Connect source connectors for Postgres, MySQL/MariaDB, SQL Server, Oracle, MongoDB, Db2 and more; also runs as Debezium Server (sinks to Kinesis, Pub/Sub, Pulsar, Redis) or embedded. Provides incremental snapshots via a signaling table and an outbox event router transform.' },
      { name: 'Maxwell’s daemon', how: 'Zendesk’s single-process MySQL binlog reader emitting JSON rows to Kafka, Kinesis, RabbitMQ, Redis and others; stores its position in a `maxwell` schema in MySQL; has a bootstrap command for backfills. Simple, MySQL-only, no Connect cluster.' },
      { name: 'DynamoDB Streams', how: 'Built-in CDC: each item change appears once in a shard-based stream, ordered per item, retained 24 h, with KEYS_ONLY / NEW / OLD / NEW_AND_OLD images; consumed by Lambda or KCL. Kinesis Data Streams for DynamoDB is the longer-retention alternative.' },
      { name: 'AWS DMS', how: 'Managed replication instance running full load + ongoing CDC tasks from logical replication/binlog to targets such as S3, Redshift, Kinesis or Kafka. Strong for migrations; long-running CDC needs careful monitoring of task latency and LOB settings.' },
      { name: 'Fivetran (and HVR)', how: 'Managed ELT connectors using log-based capture into warehouses (Snowflake, BigQuery, Databricks) on a sync schedule (minutes), priced by monthly active rows. Analytics replication, not low-latency event streaming to services.' },
    ],
  },

  lifecycle: {
    summary: 'One `UPDATE orders SET status=\'paid\'` from commit to a search index update. End-to-end lag is typically 100 ms–1 s, dominated by connector batching; it explodes only when the connector or a consumer falls behind.',
    stages: [
      { stage: 'Commit + WAL fsync', what: 'The transaction commits; the change is already in the WAL as for any write.', cost: 'Normal commit cost — CDC adds nothing here.', ms: 1 },
      { stage: 'Logical decoding', what: 'The walsender decodes the WAL record through `pgoutput` and streams it to the slot’s client after the commit record.', cost: 'Server CPU; spills large transactions to disk.', ms: 1 },
      { stage: 'Connector batching', what: 'Debezium queues events and emits a batch every `poll.interval.ms` (500 ms default) or when `max.batch.size` fills.', cost: 'Deliberate batching delay.', ms: 250 },
      { stage: 'Convert + schema', what: 'Avro converter serializes with a cached schema id (registry call only on new schema).', cost: 'CPU, µs per event.', ms: 0.1 },
      { stage: 'Produce to Kafka', what: 'Keyed by `id=42` to `pg.public.orders`, `acks=all`.', cost: 'Replication RTT.', ms: 5 },
      { stage: 'Consumer applies', what: 'Search sink upserts the document if `source.lsn` is newer than the stored version.', cost: 'Sink write (bulk).', ms: 20 },
      { stage: 'Offset flush + slot advance', what: 'Connect commits the LSN; Debezium confirms it to Postgres so older WAL can be recycled.', cost: 'Async, every flush interval.', ms: 0.5 },
    ],
  },

  deepDives: [
    {
      title: 'Log-based vs trigger-based vs query-based capture',
      hook: 'All three "capture changes"; only one captures all of them without hurting the source.',
      body: [
        '**Query-based polling** (`SELECT … WHERE updated_at > :watermark`) is easy and works over plain SQL, but misses hard deletes, collapses multiple updates between polls into one, and misses rows from long transactions that commit after the watermark moved past their `updated_at`. It also adds scan load proportional to poll frequency.',
        '**Trigger-based** capture writes each change into a shadow/audit table inside the same transaction. It catches deletes and every update, but adds write amplification and latency to every transaction on the primary, and the shadow table still needs polling.',
        '**Log-based** capture reads the WAL/binlog the database writes anyway: every committed change, in commit order, with before/after images, no extra writes, sub-second lag. The costs are operational: replication privileges, log configuration, and the retained-log risk of slots.',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Query polling', tone: 'bad', points: ['Misses deletes', 'Misses intermediate updates', 'Late-commit gaps', 'Scan load on DB'] },
          { name: 'Triggers', tone: 'warn', points: ['Catches everything', 'Extra write per write', 'Slower transactions', 'Shadow table to poll'] },
          { name: 'Log-based', tone: 'ok', points: ['Every commit, in order', 'Before + after images', 'Near-zero query load', 'Slot / binlog retention ops'] },
        ],
      },
      insight: 'The late-commit gap is subtle: a transaction that started at 10:00:00 and commits at 10:00:05 has `updated_at = 10:00:00`; a poller that already advanced its watermark to 10:00:03 never sees it.',
    },
    {
      title: 'Postgres logical decoding: slots, pgoutput, replica identity',
      hook: 'The slot is both the guarantee (no change lost) and the liability (WAL kept forever).',
      body: [
        'With `wal_level=logical`, a logical replication slot tracks a consumer’s position. The walsender reads WAL, reassembles transactions, and passes changes to the output plugin **only at commit**, in commit order; rolled-back transactions are never emitted. Transactions larger than `logical_decoding_work_mem` spill to disk on the server.',
        '**Replica identity** decides what the `before` image contains for UPDATE/DELETE: DEFAULT gives only the primary key; FULL logs the entire old row (more WAL). Unchanged TOASTed (large) columns are not in the WAL for an update, so Debezium emits a placeholder (`__debezium_unavailable_value`) unless replica identity is FULL — consumers must not overwrite stored values with the placeholder.',
        'Logical decoding does not emit DDL. Schema changes become visible when `pgoutput` sends an updated relation message before the next change to that table, so consumers see a new shape without an explicit "ALTER" event.',
      ],
      code: {
        lang: 'sql',
        caption: 'Source setup and slot health',
        code: `-- postgresql.conf: wal_level = logical, max_slot_wal_keep_size = '50GB'
CREATE PUBLICATION dbz_orders FOR TABLE public.orders, public.outbox;
ALTER TABLE public.orders REPLICA IDENTITY FULL;   -- full before-image

SELECT slot_name, active, wal_status,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn))
         AS retained_wal,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn))
         AS lag
FROM pg_replication_slots WHERE slot_type = 'logical';`,
      },
      insight: 'Before PG17, logical slots lived only on the primary, so a failover lost the slot and the connector’s position — forcing a re-snapshot or risking gaps; PG17 failover slots (`failover` option + `sync_replication_slots` on the standby) or vendor equivalents fix this and belong in your HA plan.',
    },
    {
      title: 'MySQL binlog: row format, GTIDs, schema history',
      hook: 'Binlog events carry values but not column names — the connector must replay your DDL history.',
      body: [
        'The MySQL connector acts like a replica: it connects with a unique `server_id` and reads binlog events. It needs `binlog_format=ROW` (statement format records SQL, not row values) and `binlog_row_image=FULL` for complete before/after images. With `gtid_mode=ON`, positions are global transaction ids, so the connector can resume against a promoted replica after failover; file+offset positions differ per server.',
        'Row events reference a table id and column values by position only. Debezium therefore parses every DDL statement from the binlog and stores it in a **schema history topic** (single partition, infinite retention); on restart it replays that history to know the table shape at the resume position. Deleting or truncating that topic breaks the connector.',
        'Binlog retention is your outage budget: `binlog_expire_logs_seconds` (30 days default in MySQL 8.0), but on Amazon RDS binlogs are purged quickly unless you set `binlog retention hours`. If the connector is down longer than retention, the position is gone and a new snapshot is required.',
      ],
      code: {
        lang: 'text',
        caption: 'my.cnf for CDC',
        code: `[mysqld]
server_id                = 101
log_bin                  = mysql-bin
binlog_format            = ROW
binlog_row_image         = FULL
gtid_mode                = ON
enforce_gtid_consistency = ON
binlog_expire_logs_seconds = 604800   # 7 days of outage budget

-- RDS: CALL mysql.rds_set_configuration('binlog retention hours', 72);`,
      },
      insight: 'Online schema change tools (gh-ost, pt-osc) create shadow tables and rename them; CDC consumers will see events for `_orders_gho` tables and a rename — filter shadow tables in the connector or your search index will ingest the migration.',
    },
    {
      title: 'Debezium architecture: snapshot, streaming, offsets',
      hook: 'The hard problem is not tailing the log; it is joining a snapshot to the log without gaps or duplicates.',
      body: [
        'A new connector first takes a consistent snapshot, then streams from the log position at which the snapshot was taken. On Postgres, creating the slot exports a snapshot; the connector reads all rows in that snapshot (`op: r`) and then streams from the slot’s start LSN — no gap, no overlap. On MySQL, it records the binlog position under a brief lock or a consistent-read transaction, depending on `snapshot.locking.mode`.',
        'Blocking snapshots of billion-row tables take hours, and the slot retains WAL the whole time. **Incremental snapshots** (inspired by Netflix’s DBLog) read the table in PK chunks while streaming continues: low/high watermark markers are written to a signaling table, and any streamed change to a key inside the current chunk supersedes the snapshot row. Snapshots become resumable and can be triggered per table on demand.',
        'Postgres and MySQL connectors run as a single Kafka Connect task (one log, one reader), so per-connector throughput is bounded (tens of thousands of events/s). Scale by splitting databases/tables across connectors, not by adding tasks.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Snapshot → stream handoff (Postgres)',
        actors: ['Debezium', 'Postgres', 'Kafka'],
        messages: [
          { from: 'Debezium', to: 'Postgres', label: 'CREATE slot (export snapshot)' },
          { from: 'Postgres', to: 'Debezium', label: 'snapshot id + start LSN', dashed: true },
          { from: 'Debezium', to: 'Postgres', label: 'SELECT * AS OF snapshot' },
          { from: 'Debezium', to: 'Kafka', label: 'op=r rows' },
          { from: 'Debezium', to: 'Postgres', label: 'START_REPLICATION at LSN' },
          { from: 'Debezium', to: 'Kafka', label: 'op=c/u/d changes', tone: 'ok' },
          { from: 'Debezium', to: 'Postgres', label: 'confirm flushed LSN', dashed: true },
        ],
      },
      insight: 'Consumers must treat snapshot reads (`op: r`) and streamed creates (`op: c`) as upserts; a consumer that only handles inserts on `c` will silently drop the entire initial snapshot.',
    },
    {
      title: 'The replication slot WAL retention danger',
      hook: 'A stopped CDC connector can take down your primary database by filling its disk.',
      body: [
        'A slot holds back `restart_lsn`; Postgres keeps all WAL after it. If the connector stops (crash, paused Connect cluster, deleted connector that left its slot behind), WAL accumulates at the database’s full write rate — gigabytes per hour on a busy primary — until the disk fills and Postgres stops accepting writes.',
        'A quieter variant: the captured tables are idle but other databases on the same instance write heavily. WAL is instance-wide, the slot only advances when the connector confirms an LSN, and with no captured changes it has nothing to confirm. Debezium’s `heartbeat.interval.ms` plus `heartbeat.action.query` (writing to a small heartbeat table) forces regular progress.',
        'Since PG13, `max_slot_wal_keep_size` caps retained WAL: past the cap the slot is invalidated (`wal_status = lost`), the primary survives, and the connector must re-snapshot. That is the right trade — losing a CDC position is recoverable; losing the primary is an outage.',
      ],
      diagram: {
        type: 'flow',
        title: 'How a slot fills a disk',
        nodes: [
          { label: 'Connector down', sub: 'Friday 18:00', tone: 'warn' },
          { label: 'Slot pinned', sub: 'restart_lsn frozen', tone: 'warn' },
          { label: 'WAL grows', sub: '20 GB/hour', tone: 'bad' },
          { label: 'Disk full', sub: 'Saturday night', tone: 'bad' },
          { label: 'Primary stops', sub: 'writes fail', tone: 'bad' },
        ],
      },
      bullets: [
        'Alert on retained WAL per slot (`pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)`) and on `active = false` for more than a few minutes.',
        'Set `max_slot_wal_keep_size` to a value the disk can absorb with margin.',
        'Drop slots when decommissioning connectors — orphaned slots are the classic cause.',
      ],
      insight: 'CDC turns a downstream pipeline’s availability into an upstream database risk; the slot is the one place where "consumer is down" propagates backwards, so its cap and alert are mandatory, not tuning.',
    },
    {
      title: 'Ordering, at-least-once and transactions',
      hook: 'CDC preserves commit order per row — not across tables, and not exactly once.',
      body: [
        'Within one connector, events are emitted in commit order. Publishing with the primary key as the Kafka key keeps all changes to a row in one partition, so consumers see a row’s history in order. Across tables (separate topics) and across rows (separate partitions) there is no ordering, and a multi-table transaction arrives as independent events. Debezium’s `provide.transaction.metadata` emits BEGIN/END markers with event counts so consumers can reassemble transactions if they must.',
        'Delivery is at-least-once: after a crash, Connect resumes from the last flushed offset (up to `offset.flush.interval.ms` of replay). Consumers should apply events idempotently, ideally conditionally on a monotonic source position (LSN, GTID sequence, or a row version column): "upsert if incoming LSN > stored LSN". Kafka Connect’s exactly-once source support (KIP-618) narrows duplicates into Kafka, but sinks still need idempotency.',
      ],
      code: {
        lang: 'json',
        caption: 'Change event (abridged)',
        code: `{
  "before": { "id": 42, "status": "pending", "total": 1999 },
  "after":  { "id": 42, "status": "paid",    "total": 1999 },
  "source": { "connector": "postgresql", "db": "shop", "table": "orders",
              "lsn": 24023128, "txId": 5521, "ts_ms": 1764355200000 },
  "op": "u",
  "ts_ms": 1764355200123
}`,
      },
      insight: 'Raw table CDC exposes intermediate states and internal columns as a de facto public API; any refactor of the source schema becomes a breaking change for consumers you do not own.',
    },
    {
      title: 'Outbox event router, schema changes and use-cases',
      hook: 'Table CDC replicates data; outbox CDC publishes intent — use each for what it is good at.',
      body: [
        'For **service-to-service events**, write an explicit event to an `outbox` table (id, aggregatetype, aggregateid, type, payload) in the same transaction as the business change, and let Debezium’s **Outbox Event Router** transform route each row to a topic per aggregate type, keyed by aggregate id. Consumers get a stable, versioned contract instead of your table layout; the outbox row can be deleted right after insert because CDC reads the log, not the table.',
        '**Schema changes**: prefer expand/contract migrations (add nullable column, backfill, switch readers, drop later), keep registry compatibility at BACKWARD or FULL, and never rename columns in place on captured tables. Column drops and type changes need a coordinated consumer rollout.',
        'Typical uses: cache invalidation (evict on change, no app hooks), search indexing (Elasticsearch/OpenSearch sink with upserts and delete tombstones), the outbox pattern, streaming to a data lake (S3/Iceberg via Connect or Flink), and strangler-fig migrations where a new service builds its read model from the monolith’s tables.',
      ],
      code: {
        lang: 'json',
        caption: 'Debezium Postgres connector with outbox routing',
        code: `{
  "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
  "plugin.name": "pgoutput",
  "slot.name": "orders_cdc",
  "publication.name": "dbz_orders",
  "table.include.list": "public.outbox",
  "heartbeat.interval.ms": "10000",
  "heartbeat.action.query": "UPDATE cdc_heartbeat SET ts = now()",
  "transforms": "outbox",
  "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter",
  "transforms.outbox.table.field.event.key": "aggregateid",
  "key.converter": "org.apache.kafka.connect.storage.StringConverter",
  "value.converter": "io.confluent.connect.avro.AvroConverter"
}`,
      },
      insight: 'Insert-then-delete in the same transaction keeps the outbox table empty forever while CDC still sees every event — no cleanup job, no bloat.',
    },
  ],

  scaling: {
    body: [
      'Each Postgres or MySQL connector is a single reader of a single log, so throughput per source database is bounded by one task (typically 10k–50k events/s depending on event size and converters). Scale out across databases and shards (one connector per shard), and keep heavy transforms out of the connector — do enrichment in a stream processor.',
      'The control plane is Kafka Connect: connector configs, offsets and status live in Kafka topics, and tasks rebalance across workers on failure. The data plane’s weakest link is the source: slot or binlog position must survive database failover (GTIDs for MySQL, PG17 failover slots or vendor features for Postgres), otherwise a failover means a re-snapshot.',
      'Multi-region: run CDC in the source database’s region and replicate the resulting topics (MirrorMaker 2 / Cluster Linking). Never run cross-region replication connections against the primary for every consumer; one reader per database, fan-out via Kafka.',
    ],
    bullets: [
      'One slot per connector; every extra slot multiplies WAL retention risk and decoding CPU.',
      'Cap retained WAL (`max_slot_wal_keep_size`) and alert on retained bytes and inactive slots.',
      'Use incremental snapshots for large tables and for adding tables to a running connector.',
      'Schema history topic (MySQL): single partition, infinite retention, backed up.',
      'Key topics by primary key; compact table topics to bootstrap new consumers cheaply.',
      'Run Connect in distributed mode across AZs; size `offset.flush.interval.ms` to your replay tolerance.',
    ],
    diagram: {
      type: 'layers',
      title: 'Where CDC can fail',
      layers: [
        { name: 'Consumers', items: ['search sink', 'cache invalidator', 'lake writer'], tone: 'ok' },
        { name: 'Kafka', items: ['per-table topics', 'compaction', 'schema registry'], tone: 'accent' },
        { name: 'Connect cluster', items: ['task per DB', 'offsets topic', 'rebalance'], tone: 'info' },
        { name: 'Source DB', items: ['slot / binlog', 'WAL retention', 'failover'], tone: 'warn' },
      ],
      caption: 'Failures below propagate up as gaps; failures above propagate down as WAL retention.',
    },
  },

  failures: [
    {
      name: 'Slot pins WAL until disk fills',
      symptom: 'Primary disk usage climbs steadily; eventually Postgres stops accepting writes.',
      detect: 'Retained WAL per slot from `pg_replication_slots` (`restart_lsn` lag), `active = false`, `wal_status` = extended/unreserved, disk usage alerts.',
      mitigate: '`max_slot_wal_keep_size`, heartbeats for idle tables, drop orphaned slots, page on inactive slots.',
    },
    {
      name: 'Position lost after DB failover or log purge',
      symptom: 'Connector fails to start after failover, or binlog file no longer exists; consumers have a gap.',
      detect: 'Connector task FAILED with missing position errors; slot absent on new primary; GTID set not found.',
      mitigate: 'GTIDs (MySQL), failover slots (PG17+), binlog retention > worst outage, runbook for incremental re-snapshot.',
    },
    {
      name: 'Schema change breaks consumers',
      symptom: 'A column rename/type change ships; sink connectors and services fail deserialization.',
      detect: 'Registry compatibility failures, consumer deserialization error rate, sink task failures.',
      mitigate: 'Expand/contract migrations, registry compatibility enforced, outbox contracts for services, CI check of DDL against captured tables.',
    },
    {
      name: 'Connector lag',
      symptom: 'Search/cache stale by minutes; lag grows during batch jobs on the source.',
      detect: 'Debezium `MilliSecondsBehindSource` JMX metric, slot `confirmed_flush_lsn` lag, end-to-end freshness probes.',
      mitigate: 'Split hot tables into separate connectors, lighter transforms, bigger batches, throttle bulk updates on the source.',
    },
    {
      name: 'Placeholder or partial images overwrite data',
      symptom: 'Large text fields in search become `__debezium_unavailable_value` after unrelated updates.',
      detect: 'Data-quality checks for placeholder values in sinks.',
      mitigate: '`REPLICA IDENTITY FULL` on affected tables or partial-update logic that skips unavailable fields.',
    },
  ],

  warStories: [
    {
      title: 'DBLog: snapshots without locks',
      source: 'Netflix Tech Blog (2019) and DBLog paper',
      what: 'Netflix needed to capture full table state as well as ongoing changes from MySQL and Postgres without stopping log processing or locking tables for hours. DBLog interleaves PK-ordered chunks of the table with log events, using low/high watermarks written to the source to decide which chunk rows are superseded by concurrent changes. Debezium’s incremental snapshots adopted this approach.',
      lesson: 'Make backfills a first-class, resumable, online operation of the CDC system; you will need to re-snapshot more often than you expect.',
    },
    {
      title: 'The orphaned slot',
      source: 'Composite of common incidents',
      what: 'A team replaced a Debezium connector with a new one under a new slot name and deleted the old connector, but not its replication slot. The old slot stayed inactive, retaining WAL. Six days later the primary’s volume filled and the production database went read-only during peak traffic.',
      lesson: 'Slots outlive connectors. Alert on inactive slots and retained WAL, cap with `max_slot_wal_keep_size`, and make slot cleanup part of decommissioning.',
    },
    {
      title: 'Idle tables, busy instance',
      source: 'Composite of common incidents',
      what: 'A connector captured a low-traffic `config` database on a shared Postgres instance whose other databases wrote 10 GB of WAL per hour. With no captured changes, the connector never confirmed a newer LSN, and retained WAL grew even though the connector was healthy and "caught up".',
      lesson: 'WAL is instance-wide; configure Debezium heartbeats with a heartbeat action query so the slot advances when captured tables are quiet.',
    },
  ],

  numbers: [
    { label: 'End-to-end lag', value: '~100 ms–1 s', note: 'poll.interval.ms 500 ms default' },
    { label: 'Debezium task throughput', value: '~10k–50k events/s', note: 'One task per PG/MySQL connector' },
    { label: 'Connect offset flush', value: '60 s default', note: 'At-least-once replay window' },
    { label: 'Incremental snapshot chunk', value: '1,024 rows default' },
    { label: 'MySQL binlog retention', value: '30 days default (8.0)', note: 'RDS: set explicitly' },
    { label: 'DynamoDB Streams retention', value: '24 h' },
    { label: 'Busy-primary WAL rate', value: '5–50 GB/hour', note: 'Retained if slot stalls' },
    { label: 'logical_decoding_work_mem', value: '64 MB default', note: 'Big txns spill to disk' },
  ],

  capacity: {
    question: 'A Postgres primary generates 15 GB of WAL/hour at peak and has 400 GB free disk. You add a Debezium connector. How long can the connector be down before the primary is at risk, and how do you size the safeguards?',
    steps: [
      'Peak WAL rate: 15 GB/h; assume sustained peak for a worst case (nights are lower, so this is conservative).',
      'Time to fill 400 GB: 400 ÷ 15 ≈ 26.7 hours of connector outage.',
      'Leave 30% margin for other disk growth → usable 280 GB → set `max_slot_wal_keep_size = 250GB` ≈ 16 h at peak.',
      'Alert at 20 GB retained (≈ 1.3 h) to page, and at 100 GB (≈ 6.7 h) to escalate.',
      'Re-snapshot cost if the slot is invalidated: 2 TB of tables at ~50 MB/s incremental snapshot ≈ 11 h — acceptable compared to a primary outage.',
    ],
    answer: 'About a day of outage fills the disk; cap retained WAL at ~250 GB (~16 h), page at ~20 GB retained, and accept an incremental re-snapshot (~11 h) as the recovery path beyond that.',
  },

  comparison: {
    caption: 'CDC options',
    columns: ['Product', 'Sources', 'Mechanism', 'Delivery & ordering', 'Destinations', 'Pick when'],
    rows: [
      ['Debezium', 'PG, MySQL, SQL Server, Oracle, Mongo, …', 'Log-based, Kafka Connect', 'At-least-once; per-key order', 'Kafka (or Server sinks)', 'Event streaming to services, outbox, search'],
      ['Maxwell', 'MySQL only', 'Binlog daemon', 'At-least-once; JSON rows', 'Kafka, Kinesis, Redis, …', 'Simple MySQL CDC without Connect'],
      ['DynamoDB Streams', 'DynamoDB', 'Built-in item stream', 'Exactly once per record; per-item order', 'Lambda, KCL', 'React to DynamoDB changes, 24 h window'],
      ['AWS DMS', 'Most RDBMS', 'Full load + log CDC', 'At-least-once; task-level', 'S3, Redshift, Kinesis, Kafka', 'Migrations, AWS-managed replication'],
      ['Fivetran', '100s of DBs and SaaS', 'Managed log-based ELT', 'Batch syncs (minutes)', 'Warehouses / lakes', 'Analytics replication, no ops'],
    ],
  },

  whenNot: [
    'Publishing domain events from a service you own: prefer an outbox table (still captured via CDC) over raw table CDC, so consumers get a contract, not your schema.',
    'Small tables changing rarely, where minutes of staleness are fine: a periodic full export or query-based sync is simpler.',
    'You cannot get replication privileges or log configuration on the source (some SaaS DBs): use the vendor’s change API or webhooks.',
    'Synchronous consistency is required (read-your-writes in another system): CDC is asynchronous; read from the source or use a synchronous write path.',
    'The team cannot operate slots, Connect and Kafka: use a managed option (DMS, Datastream, Fivetran) or DynamoDB Streams-style built-ins.',
  ],

  interview: [
    {
      q: 'Why is log-based CDC better than polling an `updated_at` column?',
      a: 'Polling misses hard deletes, collapses multiple updates between polls, and has a late-commit gap: a transaction that commits after the watermark advanced past its timestamp is never seen. It also costs repeated scans. Log-based CDC reads the WAL/binlog the database already writes, so it sees every committed change in commit order, including deletes, with before/after images, sub-second lag and almost no query load. The trade-off is operational: replication privileges, log configuration and retained-log risk.',
      followUps: ['Explain the late-commit gap precisely.', 'When is polling still acceptable?', 'What does a trigger-based approach cost?'],
      seniorSignal: 'Names the late-commit gap and the operational costs of log-based CDC, not just "it is real time".',
    },
    {
      q: 'What can a Postgres CDC pipeline do to the source database?',
      a: 'The replication slot retains WAL until the connector confirms progress, so a stopped connector, an orphaned slot, or idle captured tables on a busy instance can grow WAL until the disk fills and the primary stops writing. Mitigations: `max_slot_wal_keep_size` to cap retention (the slot is invalidated instead), alerts on retained WAL and inactive slots, Debezium heartbeats with an action query, and slot cleanup on decommission. Also decoding CPU and REPLICA IDENTITY FULL increase load.',
      followUps: ['What happens when the slot is invalidated?', 'How does PG17 change failover?', 'Why do idle tables matter?'],
      seniorSignal: 'Understands the slot as backward-propagating risk and chooses losing the CDC position over losing the primary.',
    },
    {
      q: 'How does Debezium take an initial snapshot without missing or duplicating changes?',
      a: 'It anchors the snapshot to a log position: on Postgres the slot is created with an exported snapshot, rows are read within that snapshot, and streaming starts from the slot’s LSN, so there is no gap or overlap. On MySQL it records the binlog position under a short lock or consistent read. For large tables, incremental snapshots read PK chunks interleaved with streaming, using watermarks in a signaling table so streamed changes supersede stale chunk rows. Consumers treat snapshot reads as upserts.',
      followUps: ['Why do blocking snapshots hurt Postgres specifically?', 'How do you add a table to a running connector?', 'What is DBLog?'],
      seniorSignal: 'Explains the consistent handoff point and the watermark algorithm rather than "it copies the table first".',
    },
    {
      q: 'What ordering and delivery guarantees do CDC consumers get?',
      a: 'Commit order per connector, and with the primary key as the Kafka key, per-row ordering within a partition. No ordering across tables or rows, and multi-table transactions are split into independent events unless transaction metadata is enabled. Delivery is at-least-once: Connect replays from the last flushed offset after a crash. Consumers should upsert conditionally on a monotonic position like the LSN or a version column so duplicates and replays are harmless.',
      followUps: ['How would you rebuild a transaction across tables?', 'What happens if the topic is repartitioned?', 'How do you handle deletes in a search index?'],
      seniorSignal: 'Uses source position for idempotent, order-tolerant consumers and knows the cross-table limitation.',
    },
    {
      q: 'Raw table CDC or outbox — how do you decide?',
      a: 'Raw table CDC is right for replication-type uses — search indexes, caches, data lakes, migrations — where consumers want the data as stored and the team owning the schema accepts that consumers are coupled to it. For events consumed by other services, the outbox gives an explicit, versioned contract that expresses intent (OrderPlaced) instead of row diffs, while keeping atomicity with the business change. Debezium’s outbox event router routes outbox rows to per-aggregate topics, and the outbox can be insert-then-delete to stay empty.',
      followUps: ['Why can you delete the outbox row immediately?', 'How do you version outbox events?', 'Who owns the topic contract?'],
      seniorSignal: 'Distinguishes data replication from domain event publishing and assigns ownership of contracts.',
    },
    {
      q: 'Debezium vs DMS vs Fivetran vs DynamoDB Streams — when each?',
      a: 'Debezium when you want low-latency change streams into Kafka for services, search and outbox, and can operate Connect and slots. DMS for AWS-managed migrations and replication into S3/Redshift/Kinesis with less operational surface but less control. Fivetran for analytics replication into a warehouse on a minutes-level schedule with zero ops, priced by active rows. DynamoDB Streams when the source is DynamoDB: built-in, ordered per item, 24-hour retention, ideal for Lambda triggers.',
      followUps: ['What breaks first in long-running DMS tasks?', 'How would you get DynamoDB changes into Kafka?', 'What does Fivetran cost at scale?'],
      seniorSignal: 'Matches tools to latency, destination and operational ownership instead of declaring one best.',
    },
  ],

  takeaways: [
    'Log-based CDC captures every committed change in commit order, including deletes; polling cannot.',
    'The replication slot is a backward-propagating risk: cap WAL retention and alert on inactive slots.',
    'Snapshots must hand off to streaming at a consistent position; incremental (watermark) snapshots scale.',
    'Ordering is per row (PK key); delivery is at-least-once — upsert conditionally on LSN/version.',
    'MySQL CDC depends on ROW binlogs, GTIDs and an intact schema history topic.',
    'Use outbox CDC for service events and raw table CDC for replication into search, caches and lakes.',
    'Plan schema changes as expand/contract migrations; captured tables are a public API.',
  ],
};

export default deep;
