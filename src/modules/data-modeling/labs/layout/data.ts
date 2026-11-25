import type { Predict, StepTag } from '../../types';
import type { Layout, QueryId } from './engine';

export interface LayoutStep {
  title: string;
  tag: StepTag;
  body: string[];
  layout: Layout;
  query: QueryId;
  predict?: Predict;
  keyIdea?: string;
  underHood?: string;
}

export const STEPS: LayoutStep[] = [
  {
    title: 'One folder, 2 TB',
    tag: 'problem',
    body: [
      'A clickstream `events` table in a lakehouse: Parquet files on object storage, tracked by Iceberg or Delta. One year, **~2 TB compressed, ~3B events**, 50M users. Traffic is skewed: the **US is 40%** of events, India 15%, and 180 small countries share 12%.',
      'Four teams query it (pick them above the grid). Every engine on object storage pays per file opened and per byte read: Athena and BigQuery on-demand bill **~$5 per TB scanned**.',
      'Start with no layout at all: files are ~128 MB and compaction has mixed days together inside each file.',
    ],
    layout: { part: 'none', cluster: 'none', bucket: 'none' },
    query: 'dau',
    predict: {
      question: 'The growth dashboard asks for the **last 7 days**. How much of the 2 TB does it read?',
      options: ['~39 GB: 7/365 of the table', '~200 GB', 'All 2 TB', 'Depends on the Parquet row-group size'],
      answer: 2,
      explain:
        'Nothing in the metadata says which files hold last week, so the planner keeps all **16,384 files** and reads 2 TB: ~3.5 min and **~$10 per refresh**. Refreshed every 15 minutes that is ~$29k a month for one chart.',
    },
    keyIdea: 'A query engine can only skip what the **metadata** proves irrelevant. Layout is how you give it that proof.',
  },
  {
    title: 'Partition by event_date',
    tag: 'technique',
    body: [
      'Write each day into its own partition: `event_date=2026-11-24/`. The table now has **365 partitions of ~5.6 GB**, each ~45 files.',
      'Partition values live in metadata (directory names for Hive tables, manifest entries for Iceberg/Delta), so filtering on them happens **before** any data file is touched.',
    ],
    layout: { part: 'date', cluster: 'none', bucket: 'none' },
    query: 'dau',
    predict: {
      question: 'With 365 day partitions, how many partitions does the 7-day query open?',
      options: ['7', 'All 365, but reads less from each', '1: the latest', 'All of them: partitions only help writes'],
      answer: 0,
      explain:
        '**Partition pruning** drops 358 partitions at planning time. 315 files, **39 GB (1.9%)**, ~4 s, ~$0.19. Same answer, 50× cheaper.',
    },
    keyIdea: 'Partition on the column **almost every query filters on**, at a grain that keeps partitions ≥ ~1 GB. For events: the event day.',
    underHood:
      'Iceberg records each data file’s partition tuple in a manifest, plus per-manifest partition ranges, so the planner prunes whole manifests without listing S3. With **hidden partitioning** (`days(event_ts)`) users filter on `event_ts` and still get pruning; Hive-style tables need an explicit `event_date` predicate.',
  },
  {
    title: 'Finer must be better? hour × country',
    tag: 'failure',
    body: [
      'The India team only wants yesterday’s IN rows, so someone partitions by **hour and country**. Every partition now holds one hour of one country.',
      'The US-hour is ~94 MB; Iceland’s hour is ~160 KB. Writers emit at least one file per partition per commit.',
    ],
    layout: { part: 'hour_country', cluster: 'none', bucket: 'none' },
    query: 'in_purchases',
    predict: {
      question: 'Partition by hour × country (190 countries). How many files does the table hold now?',
      options: ['~16k: same data, same files', '~80k', '~1.7M', '~50M'],
      answer: 2,
      explain:
        '8,760 hours × 190 countries = **1.66M partitions**, each with ≥ 1 file. Avg file **1.3 MB**. The IN query reads only 0.84 GB, but it opens 24 files and plans over 1.7M manifest entries; DAU got **3× slower** (4 s → 13 s) from file overhead alone.',
    },
    keyIdea: 'Over-partitioning causes the **small-file problem**: below ~64 MB per file, per-file overhead (GET, footer read, manifest entry, task) dominates the bytes.',
    underHood:
      'Fixes: coarser partitions, `rewrite_data_files` (Iceberg) or `OPTIMIZE` (Delta) to bin-pack, writer settings like `write.distribution-mode=hash` so each task writes one file per partition, and Delta auto-compaction / optimized writes.',
  },
  {
    title: 'Partition by user_id for support?',
    tag: 'failure',
    body: [
      'Support complains that one user’s history takes minutes. Tempting fix: `PARTITIONED BY (user_id)` so each user is one folder.',
      '50M users means **50M partitions of ~41 KB**.',
    ],
    layout: { part: 'user', cluster: 'none', bucket: 'none' },
    query: 'dau',
    predict: {
      question: 'Partition by user_id. What happens to the **DAU dashboard**?',
      options: ['Unchanged: it filters on date', 'A bit slower', 'It opens all 50M one-file folders: hours', 'It errors: you can’t filter on a non-partition column'],
      answer: 2,
      explain:
        'No time partition, so nothing prunes: **50M files × ~20 ms** open overhead ≈ 3 hours on 100 cores. Even the user lookup spends ~50 s **planning** over 50M partitions. Never partition by a high-cardinality key.',
    },
    keyIdea: 'Partition columns need **low cardinality** and **even sizes**. High-cardinality lookups belong to sorting, bucketing or bloom filters.',
  },
  {
    title: 'Cluster inside partitions: sort by user_id',
    tag: 'technique',
    body: [
      'Keep day partitions. Inside each day, write files **sorted by user_id**. Each file now covers a narrow, disjoint `user_id` range, and its min/max is in the manifest.',
      'This is **data skipping**: partition pruning removes folders, then file-level stats remove files inside the surviving folders.',
    ],
    layout: { part: 'date', cluster: 'user', bucket: 'none' },
    query: 'user',
    predict: {
      question: 'Day partitions, files sorted by user_id. How many files does the one-user query open?',
      options: ['1', '~365: one per day', '~1,100', 'All 16,425'],
      answer: 1,
      explain:
        'Per day exactly one file’s [min, max] contains `u_8c1f`: **365 of 16,425 files (97.8% skipped)**, 46 GB, ~5 s instead of 3.5 min. DAU is untouched. Min/max can’t prove absence, so days with no events for that user still cost one file: a **bloom filter** on user_id would skip those too.',
    },
    keyIdea: 'Partition for the **coarse, universal** filter; sort/cluster for the **selective** one. Min/max stats only skip when data is sorted on that column.',
    underHood:
      'Iceberg: `ALTER TABLE … WRITE ORDERED BY user_id` plus column-level lower/upper bounds in manifests. Delta: per-file `minValues/maxValues` in the log, `OPTIMIZE … ZORDER BY`, or liquid clustering. Parquet adds row-group and page-level min/max on top.',
  },
  {
    title: 'Z-order for two filter columns',
    tag: 'technique',
    body: [
      'The India team filters on **country and event_type**. Partitioning by country gave 600× skew and 81k small files. Instead, keep day partitions and **Z-order by (country, event_type)** inside them.',
      'A linear sort helps only its first column; Z-order interleaves the bits of both, so either filter (and both together) gets tight min/max ranges.',
    ],
    layout: { part: 'date', cluster: 'country_type', bucket: 'none' },
    query: 'in_purchases',
    predict: {
      question: 'Day partitions Z-ordered by (country, event_type). How much does “purchases yesterday in IN” read?',
      options: ['5.6 GB: the whole day', '~0.4 GB: about 3 files', '0.84 GB: the whole IN slice', 'Only the ~12k matching rows'],
      answer: 1,
      explain:
        'Pruning keeps 1 day (45 files); min/max on the Z-ordered columns keeps **3 files, 0.37 GB**, still ~128 MB each. Better than partitioning by country (0.84 GB) with none of its 81k small files.',
    },
    keyIdea: 'Skewed or medium-cardinality filter columns go into the **clustering**, not the partition spec.',
    underHood:
      'Iceberg: `rewrite_data_files(strategy => \'sort\', sort_order => \'zorder(country, event_type)\')`. Delta: `OPTIMIZE events ZORDER BY (country, event_type)`; Databricks liquid clustering replaces both partitioning and Z-order with incremental Hilbert clustering.',
  },
  {
    title: 'Bucketing: joins without a shuffle',
    tag: 'technique',
    body: [
      'The weekly cohort job joins 57M events to **50M users** (10 GB, far above the 10 MB broadcast threshold). Spark must **shuffle both sides** by `user_id` so matching rows meet on the same task.',
      'Bucketing pre-hashes rows into a fixed number of buckets at write time: `bucket(16, user_id)` on both tables.',
    ],
    layout: { part: 'date', cluster: 'user', bucket: 'user16' },
    query: 'join',
    predict: {
      question: 'Events and users are both bucketed 16 ways on user_id. What disappears from the join plan?',
      options: ['The scan of users', 'The shuffle (Exchange) of both sides', 'The date filter', 'Nothing: Spark always shuffles a join'],
      answer: 1,
      explain:
        'Bucket N of events joins bucket N of users locally: a **storage-partitioned join**. Shuffle **49 GB → 0**, 30 s → 5 s. Equality lookups on user_id also read 1 bucket of 16. The catch: both sides need the same column, bucket count and hash function.',
    },
    keyIdea: 'Bucket on the **join key** of large-to-large joins. It multiplies file count by the bucket count, so keep partitions coarse.',
    underHood:
      'Hive/Spark: `bucketBy(16, \'user_id\')` + `spark.sql.sources.bucketing.enabled`. Iceberg: `bucket(16, user_id)` partition transform + storage-partitioned join (Spark 3.3+, `spark.sql.sources.v2.bucketing.enabled`). Try `event_hour` + bucketing: 140k files of 15 MB.',
  },
  {
    title: 'Recap: no layout wins every query',
    tag: 'recap',
    body: [
      'Layout = **partition** (coarse, low-cardinality, almost always filtered: the day) + **cluster/sort** (selective filters) + optional **buckets** (join key) + **compaction** to keep files near 128 MB to 1 GB.',
      'Here: `days(event_ts)` + sort by user_id + bucket(16, user_id) serves DAU, support and the join; the IN query reads one day (5.6 GB, ~1 s). If that one became hot, add a small gold table instead of contorting the raw layout.',
      'Now play: change the controls on the right of the toolbar, watch each ChangeCard, and solve the exercises.',
    ],
    layout: { part: 'date', cluster: 'user', bucket: 'user16' },
    query: 'dau',
  },
];

export const TIME_NOTES: { title: string; body: string; code?: string }[] = [
  {
    title: 'event_time vs ingest_time',
    body: '`event_ts` is when it happened on the device; `ingest_ts` is when the pipeline saw it. Phones go offline, so events arrive hours or days late. Analysts filter on **event time**, so partition by `days(event_ts)` and keep `ingest_ts` as a column for incremental processing and debugging.',
  },
  {
    title: 'Late data and watermarks',
    body: 'A **watermark** says “I believe all events up to T have arrived”. Streaming aggregates for day D are finalised once the watermark passes D + allowed lateness; later events are dropped from that aggregate or routed to a correction job. Batch pipelines do the same by reprocessing a trailing window (e.g. the last 3 event days) every run.',
    code: `-- Spark Structured Streaming
events
  .withWatermark("event_ts", "2 days")
  .groupBy(window("event_ts", "1 day"), "country")
  .count()`,
  },
  {
    title: 'Partition by event_date, process by ingest window',
    body: 'Late events land in **old** partitions, so writes are no longer append-to-today. Use a `MERGE`/overwrite of the affected event days (idempotent), and recompute downstream aggregates for the days the batch touched, not just today.',
    code: `MERGE INTO lake.events t
USING staged s
  ON t.event_id = s.event_id
 AND t.event_ts >= current_date - INTERVAL 3 DAYS  -- bounds the files touched
WHEN NOT MATCHED THEN INSERT *;`,
  },
  {
    title: 'Compaction',
    body: 'Streaming and late writes produce many small files and delete files. Schedule bin-packing (and re-sorting) per partition, newest partitions first, and expire old snapshots so storage can be reclaimed.',
    code: `-- Iceberg
CALL system.rewrite_data_files(table => 'lake.events',
  where => 'event_ts >= current_date - 3',
  options => map('target-file-size-bytes', '536870912'));
CALL system.expire_snapshots('lake.events', TIMESTAMP '2026-11-18 00:00:00');
-- Delta
OPTIMIZE events WHERE event_date >= current_date() - 3 ZORDER BY (user_id);`,
  },
  {
    title: 'Hidden partitioning & partition evolution (Iceberg)',
    body: 'Iceberg derives partition values with transforms (`days(ts)`, `hours(ts)`, `bucket(n, col)`, `truncate(w, col)`), so queries filter on the real column and can’t forget the partition predicate. The spec can **evolve** without rewriting data: old files keep the old spec, new files use the new one, and the planner prunes each with its own spec.',
    code: `ALTER TABLE lake.events ADD PARTITION FIELD days(event_ts);
-- traffic grew 30×: switch new data to hourly
ALTER TABLE lake.events REPLACE PARTITION FIELD days(event_ts) WITH hours(event_ts);`,
  },
];

export const UNDER_HOOD = [
  '**Planning** reads the snapshot’s manifest list → manifests → data-file entries (partition tuple, row count, per-column lower/upper bounds, null counts). Pruning and skipping happen here, before any Parquet is opened.',
  '**Parquet** adds a second layer: row groups (~128 MB) and pages carry min/max (and optional bloom filters), so a reader can skip inside a file it had to open.',
  '**Column pruning**: only referenced columns are read. This lab counts whole files so layouts compare fairly; real bytes scanned are smaller by the column fraction.',
  'Model assumptions: compaction has mixed days inside files (no natural time locality), 128 MB target files, 100 cores, ~20 ms per file open, 10 GB/s scan, 2 GB/s shuffle.',
];

/* ───────────────────────── medallion ───────────────────────── */

export type Layer = 'bronze' | 'silver' | 'gold';

export const LAYERS: { id: Layer; name: string; tone: 'warn' | 'info' | 'accent'; guarantees: string[]; example: string }[] = [
  {
    id: 'bronze',
    name: 'Bronze · raw',
    tone: 'warn',
    guarantees: ['As received, append-only', 'Source metadata: offset, ingest_ts, file name', 'Long retention: the **replay** point', 'No business logic, schema-on-read'],
    example: 'bronze.events_raw',
  },
  {
    id: 'silver',
    name: 'Silver · clean',
    tone: 'info',
    guarantees: ['Typed and validated against a contract', '**Deduplicated** (event_id), conformed codes', 'History kept: **SCD2** dimensions', 'Bad records quarantined, not dropped'],
    example: 'silver.events · silver.customer_scd2',
  },
  {
    id: 'gold',
    name: 'Gold · business',
    tone: 'accent',
    guarantees: ['Business aggregates and **star schemas**', 'Feature tables for ML', 'Rebuildable from silver at any time', 'Owned metric definitions, SLAs'],
    example: 'gold.daily_revenue · gold.fact_orders',
  },
];

export const TRANSFORMS: { id: string; text: string; layer: Layer; why: string }[] = [
  { id: 't1', text: 'Land Kafka JSON exactly as received, with topic, partition, offset and ingest_ts', layer: 'bronze', why: 'Raw, append-only, replayable: the definition of bronze.' },
  { id: 't2', text: 'Append the Debezium CDC change log from Postgres unchanged', layer: 'bronze', why: 'Change events as captured; silver later applies them (MERGE) into current state and history.' },
  { id: 't3', text: 'Parse JSON, cast types, enforce the event schema; route failures to a quarantine table', layer: 'silver', why: 'Typing and validation is the bronze → silver contract.' },
  { id: 't4', text: 'Deduplicate events by event_id and conform country codes to ISO-3166', layer: 'silver', why: 'Dedup and conformance give one clean, trustworthy record per fact.' },
  { id: 't5', text: 'Maintain customer history with valid_from / valid_to (SCD2)', layer: 'silver', why: 'Conformed, historised entities live in silver so every gold table shares them.' },
  { id: 't6', text: 'Daily revenue by country for the finance dashboard', layer: 'gold', why: 'A business aggregate with an owned metric definition.' },
  { id: 't7', text: 'fact_orders joined to conformed dimensions for BI (star schema)', layer: 'gold', why: 'Consumption-shaped model for BI tools.' },
  { id: 't8', text: 'Per-user 30-day activity features for the churn model', layer: 'gold', why: 'Feature tables are consumption-specific products built from silver.' },
];

export const BUG_PREDICT: Predict = {
  question: 'A bug in the **gold revenue** logic shipped 3 days ago (refunds double-counted). Silver is fine. Where do you rebuild from?',
  options: [
    'Re-ingest from the source APIs: the lake is tainted',
    'Fix the code, recompute gold for the 3 affected days from silver',
    'Restore gold from a 4-day-old backup and lose 3 days',
    'Patch the wrong rows by hand with UPDATEs',
  ],
  answer: 1,
  explain:
    'Silver is typed, deduped and correct, so gold is a **pure function of silver**: deploy the fix and overwrite the 3 gold day-partitions (`INSERT OVERWRITE … WHERE day >= d-3`). If the bug had been in silver, you would replay silver from **bronze**, which is why bronze keeps raw, append-only history.',
};

export const MALFORMED_PREDICT: Predict = {
  question: 'A record arrives with `event_ts = "yesterday-ish"` (not a timestamp). What should the pipeline do?',
  options: [
    'Fail the whole job until someone fixes it',
    'Drop it silently',
    'Keep it in bronze, route it to a quarantine table with the error, continue, alert',
    'Write it to silver with event_ts NULL',
  ],
  answer: 2,
  explain:
    'Bronze already holds the raw bytes. The silver validation step writes the record to `silver.events_quarantine` with the error and source offset; good records flow on. After the parser is fixed, **replay the quarantined rows from bronze**. Failing the job lets one bad producer stop everyone; dropping or NULLing silently corrupts metrics.',
};
