import type { Internals } from '../types';

// ───────────────────────────── kafka ─────────────────────────────
const KAFKA: Internals = {
  kind: 'kafka',
  summary:
    'For a data platform, Kafka is the **durable, replayable buffer** between operational systems and everything downstream. Each topic is split into **partitions**, each partition is an append-only log replicated to 3 brokers, and every consumer group tracks its own **offset**. That offset is what makes the log valuable to data engineering: a broken job can rewind and reprocess days of data without asking the source to resend anything.',
  parts: [
    { id: 'producer', name: 'Producer client', role: 'Keys, batches and compresses records', detail: 'Hashes the key (`murmur2(key) % partitions`) so all events of one entity land in one partition, batches per partition for `linger.ms` (5–20 ms) up to `batch.size`, compresses with lz4/zstd and sends to the partition leader. `enable.idempotence=true` (default since Kafka 3.0) makes retries duplicate-free per partition.' },
    { id: 'log', name: 'Partition log', role: 'Append-only, offset-numbered segments on disk', detail: 'The leader assigns monotonically increasing **offsets** and appends to the active ~1 GB `.log` segment via the OS page cache, with sparse offset and time indexes. Pure sequential I/O is why one broker moves hundreds of MB/s up to ~1 GB/s.' },
    { id: 'isr', name: 'ISR replicas', role: 'Replicate each partition for durability', detail: 'Followers fetch from the leader; those within `replica.lag.time.max.ms` (30 s) form the **in-sync replica set**. With RF=3, `acks=all` and `min.insync.replicas=2`, an acked record survives any single broker loss. Consumers only see data below the **high watermark** (replicated to all ISR).' },
    { id: 'group', name: 'Consumer group', role: 'Spreads partitions over parallel readers', detail: 'A group coordinator assigns each partition to exactly one member, so parallelism per group is capped at the partition count. Flink, Spark, Kafka Connect sinks and a fraud service can each be a separate group reading the same topic independently.' },
    { id: 'offsets', name: 'Committed offsets', role: 'Each group’s bookmark; enables replay', detail: 'Groups commit offsets to the compacted `__consumer_offsets` topic (Flink and Spark instead store offsets in their own checkpoints). Rewinding is a metadata operation: `kafka-consumer-groups --reset-offsets --to-datetime 2026-11-22T00:00:00` and the job re-reads three days of history.' },
    { id: 'retention', name: 'Retention / compaction', role: 'Bounds history by time, size or key', detail: '`cleanup.policy=delete` drops whole segments past `retention.ms` (default 7 days). `compact` keeps the latest record per key (a null value is a **tombstone**), which turns a CDC topic into a rebuildable table. **Tiered storage** (KIP-405) moves old segments to S3 for months of cheap replay.' },
  ],
  flow: [
    { part: 'producer', title: 'Click event produced', text: 'The web tier emits `page_view` keyed by `user_id=81`. The hash picks partition 14; the record waits ~5 ms in a batch with 400 others and the zstd-compressed batch goes to p14’s leader.' },
    { part: 'log', title: 'Appended at offset 52,118,903', text: 'Broker 3 checks the producer sequence number (a retried batch is dropped as a duplicate), assigns offsets and appends to the tail of the active segment. No random I/O, no index rebuild.' },
    { part: 'isr', title: 'Replicated, then acked', text: 'Both followers fetch the batch; the high watermark advances and the producer gets its ack (~5–20 ms end to end). If broker 3 dies now, a follower from the ISR becomes leader with the record intact.' },
    { part: 'group', title: 'Three groups read it', text: 'Group `flink-sessions` owns p14 on subtask 6, group `s3-sink` archives it to the raw zone, and group `fraud` scores it. None of them slows the others down; each is just a different offset in the same log.' },
    { part: 'offsets', title: 'Bug found, rewind', text: 'A sessionization bug shipped on Monday. The team deploys the fix, starts the Flink job from offsets at Monday 00:00 (or resets the group to that timestamp) and rebuilds the output with an **idempotent/overwrite sink**, so replayed rows replace rather than duplicate.' },
    { part: 'retention', title: 'History ages out', text: 'After 7 days the segment is deleted as a single file. Anything older can only be replayed from the lake’s raw zone, which is why the S3 sink group exists and why retention must outlast your longest expected outage plus fix time.' },
  ],
  knobs: [
    {
      name: 'Durability (acks / replication)',
      options: [
        { label: 'RF=1 or acks=1', effect: 'Lowest latency and cost; a broker or disk loss silently drops acked events.', when: 'Throwaway telemetry only. Never for CDC, orders or billing events.' },
        { label: 'RF=3, acks=all, min.insync.replicas=2', effect: 'Survives one broker loss with zero acked-data loss; costs ~3× disk and cross-AZ replication traffic.', when: 'The default for any topic that feeds a lake or warehouse.' },
      ],
    },
    {
      name: 'Partition count',
      options: [
        { label: 'Sized to today (6–12)', effect: 'Cheap, but caps consumer parallelism; adding partitions later remaps keys and breaks per-key order.', when: 'Low-volume topics that will stay low-volume.' },
        { label: 'Sized for peak (≈ peak MB/s ÷ ~10 MB/s per partition, ×2)', effect: 'Room for Flink/Spark parallelism to grow without repartitioning; more files and metadata per broker.', when: 'Main event and CDC topics.' },
      ],
    },
    {
      name: 'History',
      options: [
        { label: 'delete, 7 days', effect: 'A sliding replay window; older replays come from the lake.', when: 'Event streams with an S3 sink archiving the raw data.' },
        { label: 'compact', effect: 'Latest value per key forever; a new consumer can bootstrap the full table.', when: 'CDC/changelog topics, reference data, Kafka Streams state.' },
        { label: 'Tiered storage (weeks–months)', effect: 'Local disk holds hours; S3 holds the rest at object-store prices. Old reads are slower.', when: 'Long replay windows without huge broker disks.' },
      ],
    },
  ],
  implementations: [
    { name: 'Apache Kafka', how: 'Brokers own partition replicas on local disk; metadata and leader election via the **KRaft** controller quorum (ZooKeeper removed in 4.0). Kafka Connect runs source/sink connectors on top.' },
    { name: 'Amazon MSK / Confluent Cloud', how: 'Managed Kafka. Confluent adds managed connectors, Schema Registry, Flink SQL and its Kora engine with tiered storage by default; MSK Serverless bills by throughput.' },
    { name: 'Kinesis / Google Pub/Sub', how: 'Kinesis: shards with fixed limits (1 MB/s or 1,000 records/s in, 2 MB/s out per shard), 24 h–365 d retention. Pub/Sub: per-message acks and no partitions to manage, ordering only with ordering keys, seek-to-timestamp for replay.' },
    { name: 'Redpanda / WarpStream', how: 'Kafka-API compatible. Redpanda is C++ thread-per-core with Raft per partition. WarpStream has stateless agents writing straight to S3: no cross-AZ replication bill, but ~hundreds of ms latency.' },
  ],
  ha: 'Each partition has 3 replicas spread across AZs. When a leader dies the controller elects a new one from the ISR in seconds; clients refresh metadata and continue. `unclean.leader.election.enable=false` stops an out-of-date replica from becoming leader and truncating acked data. Scaling is adding brokers and reassigning partitions (data is copied, so it takes hours for big topics); consumer throughput scales with partitions.',
  failureModes: [
    { name: 'Consumer lag = stale lake', symptom: 'Lag on the sink group grows for hours; dashboards show yesterday afternoon.', fix: 'Alert on lag in time (not just records), add consumers up to the partition count, speed up the sink, size partitions for peak.' },
    { name: 'Retention shorter than the outage', symptom: 'A sink was down for 9 days with 7-day retention; two days of events are gone (`OffsetOutOfRange`, auto reset to latest).', fix: 'Retention > max outage + fix time, tiered storage, and an always-on raw archive to S3. Set `auto.offset.reset` deliberately.' },
    { name: 'Hot partition', symptom: 'One bot or celebrity key sends 30% of traffic to one partition; its consumer is pegged while others idle.', fix: 'Better keys, salting the key with downstream re-aggregation, or isolate the hot tenant.' },
    { name: 'Replay creates duplicates', symptom: 'After rewinding offsets, the warehouse has every row twice.', fix: 'Make sinks idempotent: MERGE by key, overwrite partitions, or transactional (Flink 2PC) writes.' },
  ],
  numbers: ['Broker: hundreds of MB/s up to ~1 GB/s of sequential disk/NIC throughput', 'Plan ~10 MB/s per partition', 'Default retention 7 days; segment 1 GB; max message 1 MB', 'End-to-end latency ~5–20 ms with acks=all', 'RF=3 + min.insync.replicas=2 = survives 1 broker loss'],
  interview: [
    { q: 'A bug corrupted 3 days of output from your streaming job. How do you fix it?', a: 'Deploy the fixed job and restart it from the offsets (or timestamp) at the start of the bad window, either by resetting the group or starting from an old checkpoint/savepoint. The output must be idempotent: upsert/MERGE by key or overwrite the affected partitions, otherwise the replay duplicates. This only works if retention covers the window, which is why you also archive raw events to S3 and can replay from there for older ranges.' },
    { q: 'How many partitions should a new topic have?', a: 'Take peak throughput and divide by what one consumer instance can handle per partition (often ~10 MB/s, less if processing is heavy), then add ~2× headroom, e.g. 200 MB/s ÷ 10 = 20 → 40. Partitions cap consumer parallelism and are hard to change later because the key→partition mapping moves, breaking per-key order. Too many (thousands per broker) slows failover and adds overhead.' },
    { q: 'Why put Kafka between the database and the lake instead of writing directly?', a: 'Decoupling and replay. The lake writer can be down, slow or buggy without back-pressuring the source; several consumers (lake, search index, cache invalidation) read the same changes independently; and a bad deploy can be fixed by rewinding offsets. The cost is another system to operate and bounded retention.' },
  ],
  kafka: true,
};

// ───────────────────────────── cdc ─────────────────────────────
const CDC: Internals = {
  kind: 'cdc',
  summary:
    'CDC turns a database’s **write-ahead log** into a stream of row-level change events. Debezium connects as a replication client, takes a consistent **initial snapshot**, then streams every committed insert, update and delete in commit order, each wrapped in an envelope with `before` and `after` images and the log position. Nothing polls the tables, deletes are captured, and the primary does almost no extra work.',
  parts: [
    { id: 'wal', name: 'Database log', role: 'Committed changes in commit order', detail: 'Postgres writes the **WAL** (`wal_level=logical` lets it be decoded into rows); MySQL writes the **binlog** (`binlog_format=ROW`, `binlog_row_image=FULL`). The log already exists for crash recovery and replicas, so CDC adds no write amplification.' },
    { id: 'slot', name: 'Replication slot / position', role: 'Remembers how far CDC has read', detail: 'Postgres: a **logical replication slot** with the `pgoutput` plugin and a publication; it pins WAL until the connector confirms an LSN, so a dead connector makes WAL pile up on the primary. MySQL: the connector registers as a replica (`server.id`) and tracks binlog file+position or GTID; the server purges binlogs on its own schedule.' },
    { id: 'snapshot', name: 'Initial snapshot', role: 'Backfills existing rows consistently', detail: 'On first start Debezium reads every table in a consistent snapshot aligned with the log position it will stream from, emitting `op: "r"` events. **Incremental snapshots** (Netflix DBLog-style watermarks, triggered via a signal table) read in chunks of ~1,024 rows by primary key, interleaved with live streaming and resumable.' },
    { id: 'reader', name: 'Connector task', role: 'Decodes log entries into row changes', detail: 'Runs inside a Kafka Connect worker (or Debezium Server). It is **one task per database**, because a log is a single ordered stream. It maps each change to its table schema and keeps a source position (LSN, binlog pos, GTID, txId) for every event.' },
    { id: 'envelope', name: 'Event envelope', role: 'before, after, op, source, ts_ms', detail: 'Value: `{before, after, op: c|u|d|r, source: {db, table, lsn, txId, ts_ms}, ts_ms}`. Key: the primary key. Postgres only puts the full `before` row in the log with `REPLICA IDENTITY FULL`; by default `before` holds just the key columns.' },
    { id: 'history', name: 'Schema history topic', role: 'Replays DDL to rebuild table schemas', detail: 'MySQL binlog row events carry no column names, so Debezium records every DDL with its binlog position in a single-partition, infinite-retention **schema history topic** and replays it on restart. Postgres does not need it: `pgoutput` sends relation (schema) messages inline.' },
    { id: 'topics', name: 'Per-table topics + offsets', role: 'Ordered changes per key, resumable', detail: 'One topic per table (`shop.public.orders`), keyed by primary key, so all changes to a row stay ordered in one partition. A delete emits an `op: "d"` event plus a **tombstone** (key, null value) so compaction can drop the key. The read position goes to the Connect `offsets` topic.' },
  ],
  flow: [
    { part: 'snapshot', title: 'Snapshot first', text: 'The new connector opens a repeatable-read transaction pinned to the slot’s starting LSN and streams all 40 M `orders` rows as `op: "r"` events. Changes made during the snapshot stay in the WAL and are streamed after it, so nothing is missed.' },
    { part: 'wal', title: 'An order is updated', text: 'The app runs `UPDATE orders SET status = \'shipped\' WHERE id = 42` and commits. Postgres writes the change to the WAL like any other write; the app sees no extra latency.' },
    { part: 'slot', title: 'Slot decodes it', text: '`pgoutput` decodes the WAL record for the publication’s tables and streams it to the connector at commit time. The slot will not release this WAL until the connector confirms LSN `0/3A2F9C8`.' },
    { part: 'reader', title: 'Task builds the event', text: 'The Debezium task turns the row change into a typed record using the cached table schema and attaches the source position and transaction id.' },
    { part: 'envelope', title: 'Envelope with before/after', text: '`before: {id: 42, status: "paid"}`, `after: {id: 42, status: "shipped"}`, `op: "u"`. Downstream can compute diffs, build SCD2 history or just upsert `after`.' },
    { part: 'topics', title: 'Published, offset stored', text: 'The record goes to `shop.public.orders`, partition chosen by `id=42`. After Kafka acks, the LSN is flushed to the offsets topic and confirmed to the slot. A crash in between replays a few events: CDC is **at-least-once**, so sinks MERGE by key.' },
    { part: 'history', title: 'A column is added', text: 'On MySQL, `ALTER TABLE orders ADD COLUMN coupon VARCHAR(32)` is written to the schema history topic with its binlog position. A restart replays history up to the resume position so old and new rows decode with the right columns.' },
  ],
  knobs: [
    {
      name: 'Snapshot mode',
      options: [
        { label: 'initial (blocking)', effect: 'Full consistent copy, then streaming. Large tables take hours and a failure mid-way restarts it.', when: 'Small/medium databases, first setup.' },
        { label: 'Incremental snapshot (signal table)', effect: 'Chunked by PK, runs alongside streaming, resumable, can be re-triggered for one table.', when: 'Big tables, adding a table later, re-syncing after a bug.' },
        { label: 'no_data / never', effect: 'Stream from now; history must come from a bulk export.', when: 'Bootstrapping from a dump/S3 export loaded separately.' },
      ],
    },
    {
      name: 'Delete handling',
      options: [
        { label: 'Delete event + tombstone', effect: 'Compacted topics drop the key; MERGE sinks issue DELETE. Faithful mirror.', when: 'Replicating tables, GDPR erasure must propagate.' },
        { label: 'Soft delete (`__deleted=true` via unwrap SMT)', effect: 'Row stays with a flag; history preserved, consumers must filter.', when: 'Analytics needs to count deleted entities.' },
      ],
    },
    {
      name: 'Replica identity (Postgres)',
      options: [
        { label: 'DEFAULT', effect: '`before` has only the PK; unchanged TOASTed columns arrive as a placeholder. Smallest WAL.', when: 'Consumers just upsert `after`.' },
        { label: 'FULL', effect: 'Full `before` image and all columns on every update; more WAL volume.', when: 'Diffs, audit trails, SCD2, or tables with large TOASTed columns.' },
      ],
    },
  ],
  implementations: [
    { name: 'Debezium', how: 'Open-source Kafka Connect source connectors for Postgres, MySQL, SQL Server, Oracle, MongoDB and more; also Debezium Server (to Kinesis/Pub/Sub) or embedded as a library. Envelope format is the de facto standard.' },
    { name: 'AWS DMS / Google Datastream', how: 'Managed log-based replication into S3, Redshift, BigQuery or Kafka. Less control over format and ordering, but no Connect cluster to run.' },
    { name: 'Netflix DBLog / Airbnb SpinalTap', how: 'In-house CDC. DBLog introduced watermark-based chunked snapshots interleaved with log events, the idea behind Debezium incremental snapshots.' },
    { name: 'Fivetran / Airbyte log-based', how: 'Read the same WAL/binlog but deliver micro-batches straight into the warehouse every few minutes, merged by primary key.' },
  ],
  ha: 'A database log is one ordered stream, so each connector runs **one task**; HA is restart, not parallelism. Kafka Connect in distributed mode reschedules the task on another worker within seconds and resumes from the offsets topic. The fragile part is the database side: on Postgres before 17, logical slots were not copied to standbys, so a primary failover lost the slot and forced a re-snapshot. Postgres 17 failover slots (`failover = true` + `sync_replication_slots`) fix that.',
  failureModes: [
    { name: 'WAL bloat from a stuck slot', symptom: 'The connector has been down since Friday; the Postgres primary disk fills with retained WAL and the database stops accepting writes.', fix: 'Alert on slot lag (`pg_replication_slots`), cap it with `max_slot_wal_keep_size`, and enable Debezium heartbeats so idle databases still advance the slot.' },
    { name: 'Log purged during downtime', symptom: 'MySQL binlogs (or RDS binlog retention of a few hours) expired while the connector was down; it cannot resume.', fix: 'Retention > max expected downtime (e.g. 3–7 days), then an incremental re-snapshot of the affected tables.' },
    { name: 'Duplicates and out-of-order applies', symptom: 'After a restart, the lake has two versions of a row, or an older update overwrites a newer one.', fix: 'Treat CDC as at-least-once: MERGE by primary key and only apply if the source LSN/position is newer.' },
    { name: 'Breaking upstream DDL', symptom: 'A dropped/renamed column or type change breaks the sink or downstream models.', fix: 'Schema registry with compatibility checks, data contracts with the app team, expand-contract migrations.' },
  ],
  numbers: ['Latency: typically sub-second to a few seconds from commit to Kafka', 'One task per source database; order of 10k change events/s per task', 'Incremental snapshot chunk default 1,024 rows', 'Log retention ≥ max outage: 3–7 days is common'],
  interview: [
    { q: 'Why CDC instead of polling `WHERE updated_at > last_run`?', a: 'Polling misses hard deletes, collapses intermediate updates, depends on every writer setting `updated_at`, and can miss rows from long transactions that commit with a timestamp older than the cursor. It also runs scans against the primary. CDC reads the commit-ordered log: every insert, update and delete, with exact ordering and almost no load on the primary.' },
    { q: 'How do you get an exactly-once copy of a table in the lakehouse from Debezium, which is at-least-once?', a: 'Make the apply idempotent: MERGE into an Iceberg/Delta table on the primary key, ordered by the source position (LSN or binlog pos), keeping only the newest version per key within each batch and ignoring changes older than what the target already has. Deletes become `WHEN MATCHED AND op = \'d\' THEN DELETE`. Replays and duplicates then converge to the same state.' },
    { q: 'The connector was down for a week. What happens?', a: 'Postgres: the slot pinned a week of WAL, so the primary may be running out of disk. If it survives, the connector resumes and catches up. MySQL: if binlogs were purged, the stored position no longer exists and you must re-snapshot. That is why you monitor slot lag, cap retained WAL, and keep log retention longer than your worst outage.' },
  ],
  lab: 'cdc',
  kafka: true,
};

// ───────────────────────────── connector ─────────────────────────────
const CONNECTOR: Internals = {
  kind: 'connector',
  summary:
    'A managed ELT connector is a **scheduled incremental copy** with a saved cursor. Each sync reads the last state, pulls only what changed (API pages with `updated_since`, or the database log), lands it in a staging area and **MERGEs** it into the warehouse by primary key, then saves the new cursor. Because the cursor only advances after the data is committed, a failed sync just reruns.',
  parts: [
    { id: 'scheduler', name: 'Sync scheduler', role: 'Starts a sync per connection', detail: 'Runs each connection every 5 min to 24 h. Airbyte launches source and destination containers per sync (pods on Kubernetes); Fivetran runs them on its own fleet. Streams (tables/endpoints) within a sync run in parallel.' },
    { id: 'state', name: 'State / cursor store', role: 'Last committed position per stream', detail: 'Per stream: a cursor such as `updated_at = 2026-11-25T10:00:00Z`, an API page token, or a WAL/binlog position for databases. In the Airbyte protocol the source emits `STATE` messages between records, and the platform persists one only after the destination confirms that everything before it is committed.' },
    { id: 'extract', name: 'Extractor', role: 'Pulls changed records from the source', detail: 'SaaS: paginated REST/GraphQL calls with `updated_since=cursor - lookback`, or bulk/export APIs for large volumes. Databases: log-based CDC, or a cursor column query when the log is not available. Hard deletes are only visible via the log or a "deleted records" endpoint.' },
    { id: 'ratelimit', name: 'Rate limiter / backoff', role: 'Stays under the source API quota', detail: 'Honors `429` and `Retry-After` with exponential backoff and jitter, and paces requests to the vendor’s limits (Shopify REST is a leaky bucket of 40 requests draining at 2/s; Salesforce has a rolling 24-hour API-call allowance per org that other tools share).' },
    { id: 'stage', name: 'Staging', role: 'Lands batches as files or raw tables', detail: 'Records are written as compressed CSV/JSON/Parquet to a stage (S3/GCS) and bulk-loaded with `COPY INTO` into a temp or raw table. Airbyte Destinations V2 keeps a raw table of JSON (`_airbyte_raw_id`, `_airbyte_extracted_at`) and types it into the final table.' },
    { id: 'drift', name: 'Schema drift handler', role: 'Applies source schema changes safely', detail: 'Diffs the discovered source schema with the destination: new columns get `ALTER TABLE ADD COLUMN`, removed columns are kept (left null), type changes widen to a supertype (e.g. INT → STRING). Policy per connection: Fivetran "allow all / allow columns / block all"; Airbyte propagate, ignore or pause.' },
    { id: 'merge', name: 'Merge into warehouse', role: 'Upserts by primary key, then advances cursor', detail: '`MERGE INTO target USING staged ON pk` updates matched rows and inserts new ones, deduping staged rows to the latest per key first. Metadata columns record lineage (`_fivetran_synced`, `_fivetran_deleted` for soft deletes). Only after the MERGE commits is the new cursor saved.' },
  ],
  flow: [
    { part: 'scheduler', title: 'Sync starts', text: 'At 10:15 the 15-minute schedule fires for the HubSpot connection; the `contacts`, `deals` and `companies` streams start in parallel.' },
    { part: 'state', title: 'Cursor read', text: 'The `deals` stream’s state says `updated_at = 10:00:00Z`. The sync asks for everything modified since **09:55**: a 5-minute lookback covers clock skew and records committed late.' },
    { part: 'extract', title: 'Pages pulled', text: 'The extractor walks 37 pages of 100 deals each. Records in the overlap window will be fetched again; that is fine because the merge is keyed.' },
    { part: 'ratelimit', title: 'Throttled, backs off', text: 'Page 23 returns `429 Too Many Requests` with `Retry-After: 10`. The connector sleeps and resumes from the same page token instead of failing the sync.' },
    { part: 'stage', title: 'Batch staged', text: '3,700 records are written as a gzip JSON file to the stage and `COPY`-loaded into a temp table in a few seconds.' },
    { part: 'drift', title: 'New field appears', text: 'Sales ops added a custom property `deal_region`. The handler runs `ALTER TABLE deals ADD COLUMN deal_region STRING`; older rows stay null. Downstream dbt models are unaffected unless they `SELECT *`.' },
    { part: 'merge', title: 'MERGE and commit cursor', text: '`MERGE` updates 3,512 deals and inserts 188, keeping the latest version of each id. Only now is the cursor moved to the max `updated_at` seen. A crash before this point reruns the sync and converges to the same result.' },
  ],
  knobs: [
    {
      name: 'Sync mode',
      options: [
        { label: 'Full refresh (overwrite)', effect: 'Simple, catches hard deletes, but re-reads everything every time: slow and quota-hungry.', when: 'Small tables, or sources with no reliable cursor.' },
        { label: 'Incremental append', effect: 'Cheap; every changed version is appended, so the table holds history and duplicates.', when: 'Immutable event endpoints, or you dedupe downstream deliberately.' },
        { label: 'Incremental + dedupe (MERGE by PK)', effect: 'Current-state table, idempotent reruns; MERGE costs warehouse compute each sync.', when: 'The default for entity tables (accounts, deals, orders).' },
      ],
    },
    {
      name: 'Sync frequency',
      options: [
        { label: '5–15 min', effect: 'Fresher data; more API calls, more MERGEs (warehouse compute) and more usage-based cost.', when: 'Ops dashboards that need near-current data.' },
        { label: '1–24 h', effect: 'Cheapest, fewer merges on big tables; data is hours old.', when: 'Finance and BI that report on yesterday.' },
      ],
    },
    {
      name: 'Schema change policy',
      options: [
        { label: 'Allow all', effect: 'New tables and columns flow in automatically; surprises reach the warehouse.', when: 'Exploratory/raw zones.' },
        { label: 'Allow columns only / block', effect: 'New tables or all changes wait for review; nothing unexpected lands.', when: 'Regulated data (PII may appear in new fields).' },
      ],
    },
  ],
  implementations: [
    { name: 'Fivetran', how: 'Fully managed, 500+ connectors, log-based CDC for databases (HVR), soft deletes via `_fivetran_deleted`, priced by **monthly active rows** (distinct primary keys changed per month).' },
    { name: 'Airbyte', how: 'Open source or cloud. Every connector is a Docker image speaking the Airbyte protocol over stdout (`RECORD`, `STATE`, `LOG`); a CDK makes building new ones easy. Syncs run as Kubernetes pods.' },
    { name: 'Kafka Connect', how: 'JDBC source in `timestamp+incrementing` mode or Debezium for logs; sink connectors with `insert.mode=upsert` into a warehouse or lake. Streaming rather than scheduled.' },
    { name: 'Singer / Meltano, dlt', how: 'Singer taps and targets exchange JSON `RECORD` and `STATE` messages (Airbyte’s protocol grew from this). dlt is a Python library that infers schemas and merges incrementally inside your own jobs.' },
  ],
  ha: 'Syncs are stateless jobs around a durable cursor, so HA is retry: a failed sync restarts from the last committed state and the MERGE makes overlap harmless. Throughput scales by running streams in parallel, but the real ceiling is usually the **source’s API quota**, not the connector. Long historical syncs are resumable at page/chunk granularity.',
  failureModes: [
    { name: 'Cursor misses rows', symptom: 'Rows written by a long transaction or a bulk script that did not touch `updated_at` never arrive.', fix: 'Lookback window, log-based CDC for databases, periodic full re-syncs or reconciliation counts.' },
    { name: 'Hard deletes never propagate', symptom: 'A deal deleted in the CRM still shows in the warehouse forever.', fix: 'Log-based replication, deleted-records endpoints, or scheduled full refresh to detect missing keys.' },
    { name: 'Type drift breaks models', symptom: '`amount` changes from number to string; the connector widens the column and dbt casts start failing.', fix: 'Block or review policy on critical tables, dbt contracts and tests on staging models.' },
    { name: 'Quota exhaustion', symptom: 'A 5-minute sync burns the shared Salesforce API allowance; the sales team’s own integrations start failing.', fix: 'Lower frequency, bulk APIs for large objects, sync only needed objects and fields.' },
  ],
  numbers: ['Sync interval: typically 5–60 min, freshness = interval + sync duration', 'Lookback windows: minutes to hours', 'Shopify REST: bucket of 40 requests, leak 2 requests/s', 'Historical sync of a large SaaS org: hours to days'],
  interview: [
    { q: 'How does a connector guarantee no data loss if it crashes mid-sync?', a: 'The cursor is only advanced after the data before it is committed in the destination (Airbyte persists a STATE message only after the destination confirms the records before it). A crash means the next sync restarts from the old cursor and re-reads some records; the MERGE by primary key makes those duplicates harmless. That is at-least-once delivery with idempotent apply, which looks exactly-once in the table.' },
    { q: 'When would you not use Fivetran/Airbyte?', a: 'When you need sub-minute freshness (use CDC into Kafka plus a stream processor), when volumes make per-row pricing expensive (high-churn tables with billions of monthly active rows), or when you need custom transformation in flight. For standard SaaS sources into a warehouse with minute-to-hour freshness, buying beats building and maintaining 50 API integrations.' },
  ],
};

// ───────────────────────────── schema-registry ─────────────────────────────
const SCHEMA_REGISTRY: Internals = {
  kind: 'schema-registry',
  summary:
    'A schema registry is a small versioned store of **Avro/Protobuf/JSON schemas** plus a compatibility checker. Producers register or look up a schema and put only its numeric **id** in each message; consumers fetch the schema by id and decode. A change that would break readers is rejected at registration time, before a single bad record reaches the topic.',
  parts: [
    { id: 'serializer', name: 'Producer serializer', role: 'Encodes record, looks up schema id', detail: '`KafkaAvroSerializer` (or Protobuf/JSON Schema) derives the subject name, asks the registry for the schema’s id (cached after the first call) and encodes the record as compact binary with no field names.' },
    { id: 'subjects', name: 'Subjects & versions', role: 'Named, ordered history of a schema', detail: 'A **subject** is the unit of evolution; by default `TopicNameStrategy` gives `orders-value` and `orders-key`. Each subject holds versions 1..n. `RecordNameStrategy` allows several event types in one topic. The same schema text always maps to the same global id.' },
    { id: 'compat', name: 'Compatibility checker', role: 'Rejects changes that break readers', detail: 'On registration the new schema is checked against the latest version (or all versions with `_TRANSITIVE`). **BACKWARD** (default): new schema can read old data, e.g. delete a field or add one with a default; upgrade consumers first. **FORWARD**: old schema can read new data; upgrade producers first. **FULL**: both. A failure returns `409 Conflict`.' },
    { id: 'store', name: 'Schema store', role: 'Durable log of all schemas', detail: 'Confluent Schema Registry stores everything in a single-partition compacted Kafka topic `_schemas`. One elected primary handles writes and assigns ids; every node replays the topic into memory and serves reads.' },
    { id: 'wire', name: 'Wire format', role: 'Schema id travels with each message', detail: 'Confluent format: byte 0 is a magic byte `0`, bytes 1–4 the schema id (big-endian int), then the binary payload; Protobuf adds message indexes. Apicurio and newer serializers can carry the id in a Kafka **record header** instead, leaving the payload untouched. Either way it is ~5 bytes instead of a full schema.' },
    { id: 'deserializer', name: 'Consumer deserializer', role: 'Fetches writer schema, resolves to reader', detail: 'Reads the id, fetches `GET /schemas/ids/{id}` once and caches it forever (ids are immutable). Avro **schema resolution** maps the writer schema to the consumer’s reader schema: missing fields get defaults, unknown fields are skipped.' },
  ],
  flow: [
    { part: 'subjects', title: 'New version proposed', text: 'The checkout team adds an optional `coupon_code` (default null) to `OrderPlaced`. CI calls the registry to register it under subject `orders-value`.' },
    { part: 'compat', title: 'Compatibility check passes', text: 'Under BACKWARD, a new optional field with a default is safe: readers on v4 can still decode v3 data. Version 4 is accepted. A rename of `amount` to `total` would have returned **409** and failed the build.' },
    { part: 'store', title: 'Stored with a global id', text: 'The primary appends the schema to `_schemas` and assigns global id **117**. All registry nodes replay the topic and can now serve id 117.' },
    { part: 'serializer', title: 'Producer encodes', text: 'The deployed producer serializes an order with the v4 schema, gets id 117 from its local cache (one HTTP call per process, not per message) and writes the Avro binary.' },
    { part: 'wire', title: 'Five bytes of overhead', text: 'The Kafka value is `0x00 | 00 00 00 75 | <avro bytes>`. With no field names repeated, the payload is often a fraction of the equivalent JSON.' },
    { part: 'deserializer', title: 'Old consumer still works', text: 'The Flink job still compiled against v3 sees id 117, fetches and caches the writer schema, and Avro resolution drops `coupon_code`. Nothing breaks; the job picks up the field when it upgrades.' },
  ],
  knobs: [
    {
      name: 'Compatibility mode',
      options: [
        { label: 'BACKWARD (default)', effect: 'Consumers on the new schema can read old data. Allows deleting fields and adding fields with defaults. Upgrade consumers first.', when: 'Most event topics, especially when consumers replay old data.' },
        { label: 'FORWARD', effect: 'Old consumers can read new data. Allows adding fields and deleting optional ones. Upgrade producers first.', when: 'Many consumers you do not control that upgrade slowly.' },
        { label: 'FULL / FULL_TRANSITIVE', effect: 'Both directions, against all versions: only optional fields with defaults can change. Safest, least flexible.', when: 'Long-retention or compacted topics read years later; shared company-wide events.' },
        { label: 'NONE', effect: 'Anything goes; the registry only stores schemas.', when: 'Almost never; maybe a dev sandbox.' },
      ],
    },
    {
      name: 'Format',
      options: [
        { label: 'Avro', effect: 'Compact, writer/reader schema resolution, first-class in Kafka and lake tooling.', when: 'Default for data platforms and CDC (Debezium).' },
        { label: 'Protobuf', effect: 'Compact, field numbers make evolution natural, generated code for services.', when: 'Events owned by gRPC/Protobuf service teams.' },
        { label: 'JSON Schema', effect: 'Human-readable payloads but large and slower; evolution rules are weaker.', when: 'Teams already emitting JSON that want validation first.' },
      ],
    },
    {
      name: 'Who registers schemas',
      options: [
        { label: '`auto.register.schemas=true`', effect: 'Any producer deploy can create a new version; convenient, uncontrolled.', when: 'Development only.' },
        { label: 'CI registers, producers `use.latest.version`', effect: 'Schema changes are reviewed like code; producers cannot invent schemas at runtime.', when: 'Production.' },
      ],
    },
  ],
  implementations: [
    { name: 'Confluent Schema Registry', how: 'REST service backed by the `_schemas` Kafka topic, single primary for writes, Avro/Protobuf/JSON Schema, subject- and global-level compatibility, schema contexts and linking for multi-cluster setups.' },
    { name: 'AWS Glue Schema Registry', how: 'Serverless; the serializer prefixes a header with a 16-byte schema version UUID. Integrates with MSK, Kinesis and Glue jobs.' },
    { name: 'Apicurio / Karapace', how: 'Open-source registries with a Confluent-compatible API. Apicurio can store schemas in Kafka or a SQL database and supports header-based ids; Karapace (Aiven) is a drop-in Confluent replacement.' },
    { name: 'Buf Schema Registry', how: 'Protobuf-first: modules, generated SDKs and `buf breaking` checks in CI, with a Kafka-compatible registry in front of it.' },
  ],
  ha: 'Reads scale horizontally: every node holds the full schema set in memory from `_schemas` (RF=3). Writes go to one elected primary. Because clients cache ids, a registry outage only blocks **new** schemas and the first lookup by a freshly started client; running producers and consumers keep working. Across regions, use one source of truth (schema linking/contexts) so an id always means the same schema everywhere.',
  failureModes: [
    { name: 'Compatibility set to NONE', symptom: 'A renamed field passes registration; consumers fail to deserialize or silently read nulls.', fix: 'BACKWARD or FULL at the global level, plus `buf breaking`/compat checks in CI.' },
    { name: 'Poison message without registry', symptom: 'A producer bypasses the serializer and writes raw JSON; consumers throw on the magic byte and stop.', fix: 'Enforce the serializer (broker-side schema validation in Confluent), dead-letter undecodable records.' },
    { name: 'Ids differ across environments', symptom: 'Data mirrored from prod to a DR cluster decodes with the wrong schema because id 117 means something else there.', fix: 'One registry (or schema linking) shared by all clusters that exchange data.' },
  ],
  numbers: ['Wire overhead: 5 bytes per message (magic + 4-byte id)', 'Lookups cached: about one HTTP call per schema per client process', '`_schemas`: one partition, compacted', 'Default compatibility: BACKWARD'],
  interview: [
    { q: 'BACKWARD vs FORWARD compatibility: which do you pick and what deploy order does each imply?', a: 'BACKWARD means the new schema can read data written with the old one, so you upgrade consumers first; it allows deleting fields and adding fields with defaults. FORWARD means old consumers can read data written with the new schema, so you upgrade producers first. For a data platform where consumers replay old data from Kafka or the lake, BACKWARD (or FULL_TRANSITIVE for long-lived topics) is the usual choice.' },
    { q: 'How do you rename a field without breaking anyone?', a: 'You do not rename in place. Add the new field with a default, have producers write both, migrate consumers to the new field, then stop writing and finally remove the old one (each step passes the compatibility check). Avro aliases can map an old name for readers, but expand-then-contract is the reliable, format-agnostic approach.' },
  ],
  kafka: true,
};

export const INGEST_INTERNALS: Internals[] = [KAFKA, CDC, CONNECTOR, SCHEMA_REGISTRY];
