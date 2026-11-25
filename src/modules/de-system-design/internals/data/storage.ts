import type { Internals } from '../types';

const OBJECT_STORE: Internals = {
  kind: 'object-store',
  summary:
    'An object store is a huge, durable key → immutable-bytes map with an HTTP API: you `PUT` a whole object and `GET` byte ranges of it, nothing is ever edited in place. A data lake is just a naming convention (`s3://lake/events/dt=2026-11-25/part-0007.parquet`) plus a file format. **Parquet** makes those files queryable: columnar row groups with min/max statistics in a footer let engines read only the columns and row groups a query needs.',
  parts: [
    { id: 'api', name: 'S3 API & request router', role: 'Stateless HTTP front door, billed per request', detail: 'A stateless fleet serves `PUT`, `GET` (with `Range`), `LIST` and multipart uploads. Every call is billed: ~**$0.005 per 1,000 PUT/LIST** and ~**$0.0004 per 1,000 GET**. Throughput scales per key prefix, about **3,500 writes and 5,500 reads per second per prefix**.' },
    { id: 'index', name: 'Metadata index', role: 'Maps bucket/key to shard locations, partitioned by prefix', detail: 'A replicated key-value index, range-partitioned by key and split automatically when a prefix gets hot. An object becomes visible when its record commits here. That commit point is why S3 has had **strong read-after-write and list consistency since December 2020**: no more "write then list misses the file" bugs.' },
    { id: 'storage', name: 'Erasure-coded storage nodes', role: 'Spread data and parity shards across AZs', detail: 'Bytes are split into k data + m parity shards (Reed-Solomon style, e.g. 6+3) on different disks, hosts and **at least 3 AZs**, then continuously scrubbed and repaired. That gives **11 nines** of durability at ~1.5x raw overhead, priced at ~**$0.023/GB-month** (Standard).' },
    { id: 'rowgroup', name: 'Parquet row groups', role: 'Horizontal slices of rows, ~128 MB each', detail: 'A Parquet file is split into **row groups** (default target ~**128 MB**, often 1 row group per 128–512 MB file). A row group is the unit of parallelism: one Spark/Trino split usually reads one or more whole row groups.' },
    { id: 'chunk', name: 'Column chunks & pages', role: 'Per-column bytes, encoded and compressed', detail: 'Inside a row group each column is stored contiguously as a **column chunk**, made of **pages** (~**1 MB**). Low-cardinality columns use a **dictionary page + RLE/bit-packed** indexes (`country` becomes 1-byte codes), ints use `DELTA_BINARY_PACKED`, and each page is compressed with Snappy or ZSTD. Typical result: 5–10x smaller than JSON.' },
    { id: 'footer', name: 'Footer & statistics', role: 'Schema, offsets, min/max per chunk', detail: 'The file ends with a Thrift `FileMetaData` footer, its 4-byte length and the magic `PAR1`. It holds the schema, the byte offset of every column chunk and **min/max/null-count statistics** per column chunk (plus optional page-level column indexes and bloom filters). Readers fetch the footer first, then only what they need.' },
    { id: 'reader', name: 'Reader & pushdown', role: 'Projection and predicate pushdown via range GETs', detail: 'An engine reads the footer with one ranged `GET`, skips row groups whose min/max cannot match `WHERE` (**predicate pushdown**), then issues ranged `GET`s only for the needed column chunks (**projection pushdown**). Reading 3 of 100 columns and 1 of 20 row groups touches ~0.15% of the bytes.' },
  ],
  flow: [
    { part: 'rowgroup', title: 'Writer buffers rows', text: 'A Spark task writing `events` buffers rows in memory per column until the row group reaches ~128 MB, then flushes it. This is why writers need memory proportional to the row group size times the number of open files (one per partition being written).' },
    { part: 'chunk', title: 'Columns are encoded', text: 'For `event_type` (40 distinct values) the writer builds a dictionary and stores 6-bit RLE codes; `ts` is delta-encoded; `payload` is plain + ZSTD. 1 GB of JSON typically becomes 100–200 MB of Parquet.' },
    { part: 'footer', title: 'Footer seals the file', text: 'After the last row group the writer appends the footer with min/max of every column chunk, e.g. `ts: [09:00:00, 09:59:58]`. A Parquet file is unreadable until the footer is written, so a crashed writer leaves junk, never a half-readable file.' },
    { part: 'api', title: 'Multipart upload to S3', text: 'The file is uploaded as a multipart upload (parts of 5 MB to 5 GB) and only appears when `CompleteMultipartUpload` succeeds. That single call is atomic for one object, but **not across many files**: a job writing 500 files has no atomic commit without a table format.' },
    { part: 'storage', title: 'Shards land across AZs', text: 'Each part is checksummed, erasure-coded and spread across 3+ AZs before the PUT is acknowledged. Losing an AZ loses capacity, not data.' },
    { part: 'index', title: 'Object becomes visible', text: 'The metadata record commits and any subsequent `GET` or `LIST` sees the object (strong consistency). Keys are partitioned by prefix: `dt=2026-11-25/` gets its own index partition when it gets hot.' },
    { part: 'reader', title: 'Query reads only what it needs', text: 'Trino runs `SELECT sum(amount) WHERE ts > 09:30`. It reads the footer (a ranged GET of the last ~64 KB), skips row groups with `max(ts) < 09:30`, and fetches only the `ts` and `amount` column chunks.' },
  ],
  knobs: [
    {
      name: 'File / row group size',
      options: [
        { label: 'Tiny files (KBs, streaming every few seconds)', effect: 'Millions of objects: every query pays a GET + footer read per file, request bills explode, and listing/planning dominates runtime.', when: 'Never as a steady state; only as a landing zone that compaction rewrites.' },
        { label: '128 MB–1 GB files, 128 MB row groups', effect: 'Few requests per GB, good parallelism and strong pruning per row group.', when: 'Default target for analytical tables.' },
        { label: 'Multi-GB files with one row group', effect: 'Little parallelism and coarse stats; one straggler task reads the whole file.', when: 'Rarely; only archive data read sequentially.' },
      ],
    },
    {
      name: 'Encoding & compression',
      options: [
        { label: 'Snappy', effect: 'Fast to decode, ~2–3x compression.', when: 'Hot tables scanned constantly, CPU-bound engines.' },
        { label: 'ZSTD (level 1–3)', effect: '20–40% smaller than Snappy at similar decode speed, so less S3 I/O and cost.', when: 'Default for most lake data today.' },
        { label: 'Sort before write', effect: 'Sorting by a filter column (e.g. `customer_id`, `ts`) makes min/max ranges tight, so pushdown skips most row groups; also boosts RLE.', when: 'Columns that appear in most WHERE clauses.' },
      ],
    },
    {
      name: 'Key layout',
      options: [
        { label: 'Hive-style `dt=/hour=` prefixes', effect: 'Engines prune whole directories by path; each prefix gets its own request budget.', when: 'Plain object-store tables without a table format.' },
        { label: 'Table format manages paths (Iceberg)', effect: 'Paths can be random-hashed; the manifest, not LIST, says which files exist, so no LIST cost or prefix hot spots.', when: 'Any table with concurrent writers, deletes or schema change.' },
      ],
    },
  ],
  implementations: [
    { name: 'Amazon S3', how: 'Stateless front ends, a prefix-partitioned metadata index and erasure-coded ShardStore nodes across 3+ AZs. Strongly consistent since 2020. S3 Express One Zone trades multi-AZ durability for single-digit-ms latency.' },
    { name: 'GCS / ADLS Gen2', how: 'GCS keeps object metadata in Spanner (consistent listing) over Colossus. ADLS Gen2 adds a hierarchical namespace, so directory renames are atomic metadata operations instead of copy+delete, which helps Hadoop-style committers.' },
    { name: 'Apache Parquet', how: 'Columnar file format (Dremel-style repetition/definition levels for nested data). Row groups → column chunks → pages, Thrift footer with stats, page indexes and bloom filters since 1.11/1.12. ORC is the Hive-world sibling (stripes of ~64–256 MB with indexes every 10k rows).' },
  ],
  ha: 'The store itself is regional and multi-AZ: stateless API, replicated index, shards in 3+ AZs, background repair, so 11 nines durability and 99.99% availability come for free. What you design is the **layout**: prefix spread for request rate, file sizes for request cost, and a table format on top when many writers or deletes are involved. Cross-region DR uses Cross-Region Replication (async, minutes of lag).',
  failureModes: [
    { name: 'Small-files explosion', symptom: 'A streaming job writes 10 files per minute per partition; after a month queries spend 90% of their time opening files and the GET bill exceeds the storage bill.', fix: 'Compact into 128 MB–1 GB files (Iceberg/Delta `OPTIMIZE`), batch writes in larger intervals, or use a table format with maintenance.' },
    { name: 'Partial writes visible to readers', symptom: 'A job that died halfway left 300 of 500 files; a reader listing the folder sees half a day of data.', fix: 'Write to a staging path and commit atomically through a table format (or `_SUCCESS` markers as a weak fallback).' },
    { name: '503 SlowDown on one prefix', symptom: 'Thousands of tasks hammer `s3://lake/events/dt=today/` and get throttled.', fix: 'Spread keys with hashed prefixes, retry with jittered backoff, let S3 split the partition.' },
    { name: 'No pruning because data is unsorted', symptom: 'Every row group has min/max covering the full range, so `WHERE user_id = 42` scans everything.', fix: 'Sort or Z-order by common filter columns at write/compaction time; add bloom filters for high-cardinality equality lookups.' },
  ],
  numbers: ['S3 Standard ~$0.023/GB-month; PUT ~$0.005/1k, GET ~$0.0004/1k', '3,500 writes / 5,500 reads per second per prefix', 'Parquet row group ~128 MB, page ~1 MB, target file 128 MB–1 GB', 'First byte 10–100 ms per GET, so file count matters more than file size', 'Parquet is typically 5–10x smaller than JSON and scans 10–100x less for column-selective queries'],
  interview: [
    { q: 'Why does a query over 1 TB of Parquet sometimes run faster than one over 10 GB of the same data?', a: 'Because cost is driven by request count and pruning, not bytes. 1 TB in 2,000 well-sorted 512 MB files lets the engine read 2,000 footers, prune most row groups by min/max and fetch only the needed column chunks. 10 GB in 2 million 5 KB files means 2 million GETs at 10–100 ms each, huge planning/listing time, no useful stats and per-request cost. The fix is compaction to 128 MB–1 GB files and sorting by filter columns.' },
    { q: 'Explain predicate pushdown in Parquet end to end.', a: 'The reader issues a ranged GET for the footer, which lists every row group with per-column min/max and null counts. For `WHERE country = \u2018DE\u2019 AND ts >= X` it drops row groups where `max(ts) < X` or where `DE` is outside `[min, max]` of `country`; page indexes can drop individual ~1 MB pages and bloom filters handle high-cardinality equality. Then it fetches only the column chunks of surviving row groups for the selected columns, decodes dictionary/RLE pages and applies the filter row by row. Pushdown only works if data is clustered, which is why you sort on write.' },
    { q: 'S3 is strongly consistent now. Can I just write a table as a folder of Parquet files?', a: 'Strong consistency is per object. A job that writes 500 files has no multi-object atomic commit, so readers can see half the files, a retry can leave duplicates, and two concurrent jobs can clobber each other. There are also no deletes or updates except rewriting files, and schema is whatever each file says. A table format (Iceberg/Delta/Hudi) adds an atomic metadata commit over the set of files, which is what makes the folder a table.' },
  ],
  lab: 'parquet',
};

const LAKEHOUSE: Internals = {
  kind: 'lakehouse',
  summary:
    'A lakehouse table is Parquet files plus a **metadata tree** that says exactly which files make up each version of the table. Writers never modify files; they write new files and new metadata, then **atomically swap one pointer** in the catalog. Every swap is a snapshot, which gives ACID commits, time travel, schema/partition evolution and row-level deletes on top of plain object storage.',
  parts: [
    { id: 'catalog', name: 'Catalog pointer', role: 'Holds the current metadata location atomically', detail: 'Hive Metastore, AWS Glue, a REST catalog (Polaris, Unity, Nessie) or a JDBC table stores one thing per table: the path of the **current `metadata.json`**. Committing means compare-and-swap of that pointer, so the catalog is the only place that needs atomicity.' },
    { id: 'metadata', name: 'metadata.json', role: 'Schemas, partition specs, snapshot list', detail: 'An immutable JSON file per table version: schema history (columns tracked by **field id**, so renames are safe), partition specs, sort orders, properties and the list of **snapshots** with `current-snapshot-id`. Each commit writes `v124.metadata.json`.' },
    { id: 'manifestlist', name: 'Manifest list', role: 'One per snapshot: which manifests make it up', detail: 'An Avro file (`snap-<id>.avro`) listing the manifests in the snapshot, with per-manifest **partition value ranges** and added/deleted file counts. Planners skip whole manifests whose partition range cannot match the query.' },
    { id: 'manifests', name: 'Manifests', role: 'List data/delete files with column stats', detail: 'Avro files each tracking thousands of data files: path, partition tuple, record count, file size and **per-column lower/upper bounds and null counts**. Manifests are reused across snapshots, so a commit that adds 10 files writes one new small manifest, not a copy of the table.' },
    { id: 'datafiles', name: 'Data files', role: 'Immutable Parquet files in object storage', detail: 'Ordinary Parquet (or ORC/Avro) files at arbitrary paths. Iceberg never LISTs directories; the manifests are the source of truth, which avoids LIST costs and lets data files be spread across hashed prefixes.' },
    { id: 'deletes', name: 'Delete files / deletion vectors', role: 'Merge-on-read row-level deletes', detail: 'With **merge-on-read**, an update/delete writes small **position-delete** files (file + row number), **equality-delete** files (`id = 42`) or, in Iceberg v3/Delta, **deletion vector** bitmaps, instead of rewriting data files. Readers merge them at scan time until compaction folds them in.' },
  ],
  flow: [
    { part: 'datafiles', title: 'Writer stages new files', text: 'A Spark `MERGE INTO orders` for 50k changed rows writes new Parquet files (copy-on-write) or delete files plus new files (merge-on-read). Nothing is visible yet: unreferenced files are invisible by construction.' },
    { part: 'deletes', title: 'Row-level changes recorded', text: 'In merge-on-read mode the 50k updates become one position-delete file listing `(file, row)` pairs, plus a file of new row versions. The commit writes ~MBs instead of rewriting GBs of data files.' },
    { part: 'manifests', title: 'New manifest written', text: 'The writer creates a manifest that adds the new files with their stats, and reuses all existing manifests by reference.' },
    { part: 'manifestlist', title: 'New manifest list', text: 'A new manifest list for snapshot `S124` points to the old manifests plus the new one, each with partition summaries for pruning.' },
    { part: 'metadata', title: 'New metadata.json', text: '`v124.metadata.json` is written: same schema, snapshot list now ends with `S124` (parent `S123`), with a summary like `added-records=50000`.' },
    { part: 'catalog', title: 'Atomic swap = commit', text: 'The writer asks the catalog to swap the pointer from `v123` to `v124` **only if it is still `v123`**. If another writer committed first, the swap fails; the writer re-reads, checks for conflicts (did they touch the same files/partitions?) and retries on top of the new version (optimistic concurrency, Iceberg default 4 retries).' },
    { part: 'manifestlist', title: 'Readers plan from a snapshot', text: 'A query reads the pointer once and plans against that snapshot: prune manifests by partition range, then files by column bounds. It never sees a half-committed state, and `FOR VERSION AS OF S100` or `TIMESTAMP AS OF` time-travels by picking an older snapshot.' },
    { part: 'datafiles', title: 'Maintenance', text: 'Compaction (`rewrite_data_files`) merges small files and applies delete files; `expire_snapshots` drops old snapshots and **physically deletes** files no snapshot references; `remove_orphan_files` cleans up failed writes.' },
  ],
  knobs: [
    {
      name: 'Row-level change strategy',
      options: [
        { label: 'Copy-on-write (COW)', effect: 'Rewrite every data file containing a changed row. Reads are fastest (no merging), writes are expensive: updating 1 row rewrites a 512 MB file.', when: 'Read-heavy tables with infrequent batch updates.' },
        { label: 'Merge-on-read (MOR)', effect: 'Write small delete files / deletion vectors; reads merge them. Cheap frequent writes, slower reads until compaction.', when: 'CDC upserts, GDPR deletes, streaming merges every few minutes.' },
      ],
    },
    {
      name: 'Partitioning',
      options: [
        { label: 'Hidden partitioning (`days(ts)`, `bucket(16, id)`)', effect: 'Partition values are derived from columns by transforms; users filter on `ts` and get pruning without knowing a `dt` column exists. Specs can evolve without rewriting old data.', when: 'Default in Iceberg.' },
        { label: 'Over-partitioning (e.g. by `user_id`)', effect: 'Millions of tiny partitions and files, huge manifests, slow planning.', when: 'Never: partition by time/coarse buckets, cluster/sort within.' },
      ],
    },
    {
      name: 'Snapshot retention',
      options: [
        { label: 'Short (hours to a few days)', effect: 'Small metadata, deleted data physically removed quickly (needed for GDPR).', when: 'High-frequency streaming commits; tables with PII.' },
        { label: 'Long (weeks)', effect: 'Time travel and easy rollback after bad loads, but storage keeps every rewritten file.', when: 'Critical batch tables where `rollback_to_snapshot` is the recovery plan.' },
      ],
    },
  ],
  implementations: [
    { name: 'Apache Iceberg', how: 'Catalog pointer → metadata.json → manifest list → manifests → files, as above. Hidden partitioning, partition evolution, branches/tags (used for write-audit-publish), v2 position/equality deletes, v3 deletion vectors. Netflix, Apple, Stripe.' },
    { name: 'Delta Lake', how: 'A `_delta_log/` of ordered JSON commit files (`000…0124.json`) listing add/remove actions, with a Parquet checkpoint every 10 commits. Commit = atomically create the next numbered file (put-if-absent). Deletion vectors for MOR, Liquid Clustering instead of fixed partitions.' },
    { name: 'Apache Hudi', how: 'A timeline of instants in `.hoodie/`, record-level indexes for fast upserts, COW and MOR table types where MOR appends Avro log files to file groups that compaction merges into base Parquet. Built at Uber for CDC-heavy upserts.' },
  ],
  ha: 'There is no server to keep up: data and metadata live in object storage, so durability is the object store’s. The catalog is the one stateful piece (Glue, a replicated metastore DB, or a managed REST catalog) and must be HA, because if it is down nobody can commit. Concurrency is optimistic, so throughput is limited by commit rate per table (realistically one commit every few seconds), which is why streaming writers commit every 1–5 minutes rather than per record.',
  failureModes: [
    { name: 'Commit conflicts between writers', symptom: 'A streaming upsert and a nightly compaction both touch the same partition; one keeps failing with `CommitFailedException` after retries.', fix: 'Partition the work so writers touch disjoint files, schedule compaction on cold partitions, raise retries, or use MOR so compaction does not conflict with appends.' },
    { name: 'Metadata and small-file bloat', symptom: 'A job committing every 10 s creates 8,640 snapshots and tens of thousands of tiny files a day; planning takes minutes.', fix: 'Commit every 1–5 minutes, run compaction and `rewrite_manifests`, expire snapshots regularly.' },
    { name: 'Deleted data still readable', symptom: 'A GDPR delete succeeded, but the user’s rows are still in old snapshots and their files, reachable by time travel.', fix: 'Expire snapshots past the deletion and run orphan cleanup / `VACUUM` so files are physically removed within the legal window.' },
    { name: 'Read slowdown from delete files', symptom: 'A CDC table in MOR mode accumulates thousands of equality-delete files; every scan joins against them.', fix: 'Frequent compaction to apply deletes, prefer position deletes/deletion vectors over equality deletes.' },
  ],
  numbers: ['Target data files 128 MB–512 MB; manifests ~8 MB', 'Practical commit rate: ~1 commit per table every few seconds (OCC on one pointer)', 'Streaming commit interval: 1–5 min', 'Delta checkpoint every 10 commits; Iceberg default commit retries 4', 'Snapshot expiry commonly 1–7 days'],
  interview: [
    { q: 'How does Iceberg give atomic commits on S3, which has no multi-file transactions?', a: 'It never mutates anything visible. The writer writes new data files, a new manifest, a new manifest list and a new metadata.json, all at fresh paths that no reader references. The only mutable state is the catalog pointer to the current metadata.json, and the commit is a compare-and-swap on it (Glue/Hive lock, REST catalog, or a conditional DB update). If the swap fails, the writer re-reads the latest metadata, validates that the concurrent commit did not touch conflicting files, rebuilds its metadata on top and retries. Readers resolve the pointer once and see a consistent snapshot.' },
    { q: 'Copy-on-write or merge-on-read for a CDC table updated every 5 minutes?', a: 'Merge-on-read. COW would rewrite every 512 MB file containing even one changed row every 5 minutes: massive write amplification, cost and conflict risk. MOR writes small delete files or deletion vectors plus new rows, so commits are cheap. Reads pay a merge cost, so you schedule compaction (hourly/daily) to fold deletes into base files, and keep equality deletes under control. For a read-heavy table updated nightly, COW is better.' },
    { q: 'What is hidden partitioning and why does it matter?', a: 'In Hive-style tables users had to filter on a derived `dt` column; filtering on `ts` alone scanned everything, and a wrong `dt` silently gave wrong results. Iceberg stores the partition transform (`days(ts)`, `bucket(16, id)`) in metadata and derives partition values itself, so `WHERE ts > X` prunes automatically. Because the spec is metadata, you can change it (daily → hourly) going forward without rewriting old data; old files keep their old spec and planning handles both.' },
  ],
  lab: 'iceberg',
};

const WAREHOUSE: Internals = {
  kind: 'warehouse',
  summary:
    'A cloud warehouse is a managed MPP SQL engine whose **storage is cheap object storage** and whose **compute is elastic clusters** that come and go. Tables are cut into immutable columnar **micro-partitions** with min/max metadata, so most queries prune 90%+ of the data before reading anything, and the remaining scan is spread across many nodes in parallel.',
  parts: [
    { id: 'services', name: 'Cloud services / control plane', role: 'Parse, optimize, authorize, track metadata', detail: 'A shared, always-on layer (Snowflake cloud services, BigQuery’s Dremel root + metadata) handles auth, SQL parsing, the cost-based optimizer, transactions and the **metadata store** (Snowflake keeps it in FoundationDB) with per-partition column stats.' },
    { id: 'resultcache', name: 'Result cache', role: 'Returns identical query results without compute', detail: 'If the same query text runs again and the underlying micro-partitions have not changed, the stored result is returned in milliseconds with **no warehouse running**. Snowflake keeps results 24 h (extended on reuse, up to 31 days); BigQuery caches ~24 h.' },
    { id: 'pruner', name: 'Metadata pruner', role: 'Skips micro-partitions via min/max', detail: 'For `WHERE event_date = \u20182026-11-25\u2019` the planner reads only metadata and keeps partitions whose `[min, max]` range contains that date. On a well-clustered table this cuts 10,000 partitions to 30 before any I/O.' },
    { id: 'compute', name: 'Virtual warehouse / slots', role: 'Elastic MPP compute, billed per second', detail: 'A Snowflake **virtual warehouse** is a cluster of nodes (XS = 1 credit/hour, each size doubles up to 6XL = 512); BigQuery schedules work on **slots** (virtual CPUs) from a shared pool. Compute is isolated per workload: ETL and BI never fight for the same cluster.' },
    { id: 'execution', name: 'MPP execution & shuffle', role: 'Parallel scan, join and aggregate across nodes', detail: 'The plan is split into fragments; every node scans its share of partitions, applies filters, does partial aggregation, then **shuffles** rows by join/group key to other nodes. Vectorized columnar operators process batches of values, with spill to local SSD then remote storage when memory runs out.' },
    { id: 'storage', name: 'Micro-partitions in object storage', role: 'Immutable compressed columnar files', detail: 'Snowflake **micro-partitions** hold **50–500 MB uncompressed** (~16 MB compressed) in a proprietary columnar format; BigQuery uses Capacitor files on Colossus; Redshift RA3 uses 1 MB blocks with zone maps on managed storage. Nodes cache hot partitions on local SSD.' },
  ],
  flow: [
    { part: 'services', title: 'Query arrives', text: 'A Looker dashboard sends `SELECT region, sum(revenue) FROM orders WHERE order_date >= \u20182026-11-01\u2019 GROUP BY region`. The services layer authenticates, parses and optimizes it using table statistics.' },
    { part: 'resultcache', title: 'Result cache check', text: 'The same tile ran 10 minutes ago and no new data was loaded since, so the result is served from cache in ~50 ms for 0 credits. A load that changes `orders` invalidates it.' },
    { part: 'pruner', title: 'Prune by metadata', text: 'After a new load the cache misses. The pruner checks min/max of `order_date` for all 40,000 micro-partitions and keeps 1,300. Clustering by `order_date` is what makes those ranges narrow.' },
    { part: 'compute', title: 'Warehouse resumes', text: 'The BI warehouse (Medium, 4 credits/hour) auto-resumes in a second or two and is billed per second with a 60 s minimum. Its local SSD cache may already hold yesterday’s partitions.' },
    { part: 'execution', title: 'Parallel scan + partial aggregate', text: 'Each node scans its partitions, reading only `region`, `revenue`, `order_date` columns, and computes partial sums per region. Partials are shuffled by `region` and merged.' },
    { part: 'storage', title: 'Cold partitions fetched', text: 'Partitions not in SSD cache are fetched from object storage. Writes never update a micro-partition: an UPDATE writes new partitions and the old ones are retained for **Time Travel** (1–90 days) then Fail-safe.' },
    { part: 'compute', title: 'Auto-suspend', text: 'After 60 s idle the warehouse suspends and billing stops. Many concurrent users queue at ~8 queries per cluster; a **multi-cluster** warehouse adds clusters instead of queueing.' },
  ],
  knobs: [
    {
      name: 'Cost model',
      options: [
        { label: 'Per TB scanned (BigQuery on-demand, Athena)', effect: '~$6.25/TiB in BigQuery, ~$5/TB in Athena. `SELECT *` on a big table costs real money; partitioning and clustering cut the bill directly.', when: 'Spiky, unpredictable, low-volume analytics.' },
        { label: 'Per compute-second (Snowflake credits, BQ slots/editions)', effect: 'You pay for warehouse uptime regardless of bytes; idle warehouses and oversized clusters burn money.', when: 'Steady heavy workloads where you can size and auto-suspend.' },
      ],
    },
    {
      name: 'Clustering',
      options: [
        { label: 'Natural load order', effect: 'Data arriving by time is naturally clustered on time; filters on other columns prune nothing.', when: 'Tables mostly filtered by load date.' },
        { label: 'Clustering key / sort key', effect: 'Background reclustering (paid) keeps min/max tight on chosen columns, so pruning works for those filters.', when: 'Large tables (TB+) with a dominant filter column like `customer_id` or `tenant_id`.' },
      ],
    },
    {
      name: 'Scaling for concurrency vs query size',
      options: [
        { label: 'Bigger warehouse (scale up)', effect: 'Each size doubles nodes and cost; a single big query roughly halves in runtime, so cost per query stays similar.', when: 'Heavy transformations and large joins.' },
        { label: 'More clusters (scale out)', effect: 'Same size, more copies; removes queueing for many small concurrent queries.', when: 'BI with hundreds of dashboard users at 9 AM.' },
      ],
    },
  ],
  implementations: [
    { name: 'Snowflake', how: 'Three layers: cloud services (metadata in FoundationDB), virtual warehouses (EC2 clusters with SSD cache), and micro-partitions in S3/GCS/Azure. Zero-copy clones and Time Travel fall out of immutable partitions.' },
    { name: 'Google BigQuery', how: 'Dremel execution tree over Capacitor columnar files on Colossus, connected by the Jupiter network; a disaggregated in-memory shuffle tier. Serverless slots; partitioned + clustered tables (block pruning); on-demand per-TiB or slot-based editions.' },
    { name: 'Amazon Redshift', how: 'Leader node plans, compute nodes split into slices execute. RA3 separates managed storage on S3 from compute; distribution keys co-locate join rows, sort keys + 1 MB block zone maps give pruning. Concurrency scaling adds transient clusters.' },
  ],
  ha: 'Storage durability is the object store’s (11 nines, multi-AZ). The services layer is a replicated multi-AZ fleet, and compute is stateless: a failed node is replaced and its fragments are retried, and a whole warehouse can be resumed elsewhere because no data lives only on it. Concurrency scales out with multi-cluster warehouses or more slots. Cross-region DR uses database replication/failover (async).',
  failureModes: [
    { name: 'Runaway cost', symptom: 'A dashboard refresh every minute keeps an XL warehouse awake 24/7 (16 credits/hour, ~$40k/month), or `SELECT *` scans 50 TB on-demand.', fix: 'Auto-suspend 60 s, right-size, resource monitors/quotas, result cache, require partition filters, incremental models.' },
    { name: 'No pruning', symptom: 'Query on `customer_id` scans 100% of partitions because data is clustered by load time.', fix: 'Clustering key on the filter column, or a separate table/materialized view ordered for that access path.' },
    { name: 'Serving user-facing traffic', symptom: 'A product page querying the warehouse at 500 QPS sees seconds of latency and queueing.', fix: 'Precompute into a KV store or real-time OLAP; warehouses are built for ~10s of concurrent analytical queries per cluster.' },
    { name: 'Spill and skewed joins', symptom: 'One node processes a hot join key while the rest idle; query spills terabytes to remote storage.', fix: 'Filter early, pre-aggregate, handle null/hot keys separately, size the warehouse for the join.' },
  ],
  numbers: ['Snowflake micro-partition 50–500 MB uncompressed (~16 MB compressed)', 'Snowflake XS = 1 credit/hour, doubling per size; credit ~$2–4', 'BigQuery on-demand ~$6.25/TiB scanned; Athena ~$5/TB', 'Result cache 24 h; Time Travel 1–90 days', 'Typical dashboard query 1–5 s; storage ~$23–40/TB-month'],
  interview: [
    { q: 'Why can Snowflake or BigQuery scan a 10 TB table in seconds?', a: 'Mostly because they don’t scan it. Metadata min/max per micro-partition prunes everything outside the filter range, columnar storage reads only referenced columns (often 5% of bytes), and compression shrinks that further. What is left is split across dozens to hundreds of nodes reading in parallel from object storage with local SSD caching, using vectorized operators and partial aggregation before the shuffle. If the filter column is not clustered, pruning fails and the same query takes minutes.' },
    { q: 'What does separating storage from compute buy you, and what does it cost?', a: 'You scale and pay for each independently: storage at object-store prices, compute per second only while queries run. Multiple isolated clusters (ETL, BI, data science) read the same data without contention, and clones/time travel are cheap metadata operations. The cost is that cold reads come from remote storage (higher latency than local disk), mitigated by SSD caches, and that per-second compute can become expensive if warehouses are left running or oversized.' },
    { q: 'A BI team complains the 9 AM dashboards are slow but the same queries are fast at noon. What do you do?', a: 'This is concurrency, not query size: at 9 AM hundreds of queries queue on one cluster. Check queue time vs execution time. Scale out with a multi-cluster warehouse (or more slots) rather than up, enable the result cache by making queries deterministic, pre-aggregate the heavy tiles into marts or materialized views refreshed before 9 AM, and separate ETL onto its own warehouse so loads do not compete.' },
  ],
};

const OLAP: Internals = {
  kind: 'olap',
  summary:
    'Real-time OLAP stores ingest events straight from Kafka, index them into columnar **segments** within seconds, and answer slice-and-dice aggregations in tens of milliseconds at thousands of QPS. They are fast because of three choices: **pre-aggregation at ingest** (rollup, star-tree), **heavy indexing** (dictionary, bitmap/inverted, sorted) and **scatter-gather** across many servers each scanning a few segments.',
  parts: [
    { id: 'ingest', name: 'Real-time ingestion', role: 'Consumes Kafka partitions into mutable segments', detail: 'Druid real-time tasks / Pinot real-time servers each consume assigned Kafka partitions, apply rollup and build an in-memory **consuming segment** that is queryable immediately (seconds of freshness). Offsets are committed with the segment, giving exactly-once ingestion.' },
    { id: 'segment', name: 'Segment builder', role: 'Seals rows into immutable columnar segments', detail: 'When a consuming segment hits a row/time threshold (e.g. **~5M rows** or 1 hour) it is sealed: columns are dictionary-encoded, sorted, compressed and indexed, then uploaded to **deep storage** (S3/HDFS). Druid recommends segments of 300–700 MB, ~5M rows.' },
    { id: 'indexes', name: 'Indexes', role: 'Bitmap, inverted, sorted, range, star-tree', detail: 'Each dimension gets a dictionary and a **bitmap (Roaring) index** per value: `country=DE AND device=ios` becomes a bitwise AND of two bitmaps. Pinot adds sorted, range, JSON, text and **star-tree** indexes, which pre-aggregate metrics for dimension combinations so a group-by reads ≤ ~10k pre-aggregated records.' },
    { id: 'historical', name: 'Historical / offline servers', role: 'Serve sealed segments from local disk', detail: 'Druid Historicals and Pinot offline servers download assigned segments from deep storage, memory-map them and serve queries. A coordinator/controller (Helix in Pinot) assigns segments and replicas; deep storage is the source of truth, so a lost server just reloads.' },
    { id: 'broker', name: 'Broker', role: 'Scatter-gather and merge partial results', detail: 'The broker knows which servers hold which segments (and time ranges), prunes segments by time and partition, fans the query out, and merges partial aggregates. p99 is bounded by the slowest server, so replicas and segment balance matter.' },
    { id: 'merge', name: 'Compaction / MergeTree merges', role: 'Merge small segments or parts in background', detail: 'Druid compaction and Pinot minion tasks merge and re-roll-up small segments. ClickHouse **MergeTree** writes each INSERT as an immutable **part** (column files + sparse primary index every 8,192 rows) and merges parts in the background, which is also where `ReplacingMergeTree` dedups and `AggregatingMergeTree` rolls up.' },
  ],
  flow: [
    { part: 'ingest', title: 'Event consumed from Kafka', text: 'An ad impression `{ts: 10:00:03, campaign: 77, country: DE, device: ios, cost: 0.002}` is read from Kafka partition 12 by the real-time server that owns that partition.' },
    { part: 'ingest', title: 'Rolled up at ingest', text: 'With rollup at minute granularity, all impressions with the same `(10:00, 77, DE, ios)` collapse into one row with `count` and `sum(cost)`. A 100:1 rollup ratio is common, cutting storage and scan by 100x but losing per-event detail.' },
    { part: 'segment', title: 'Queryable in seconds, then sealed', text: 'The row is queryable from the consuming segment within ~1–2 s. After ~5M rows the segment is sealed, encoded and uploaded to deep storage, and its Kafka end offset is committed with it.' },
    { part: 'indexes', title: 'Indexes built', text: 'Dictionaries map `DE` → 17; bitmaps record which row ids have `country=17`; a star-tree pre-aggregates `sum(cost)` by `(campaign, country)`. These are built once at seal time and make queries mostly index lookups.' },
    { part: 'historical', title: 'Handoff to historicals', text: 'The controller assigns the new segment to 2 historical/offline servers, which download it from S3. The real-time server drops its copy once they report it loaded.' },
    { part: 'broker', title: 'Dashboard query', text: '`SELECT country, sum(cost) WHERE campaign = 77 AND ts > now() - 1h GROUP BY country` hits the broker, which prunes to segments in the last hour, scatters to ~10 servers and merges partial sums. Typical p99: 20–100 ms.' },
    { part: 'merge', title: 'Background compaction', text: 'Overnight, hourly segments are compacted into daily ones and re-rolled up to hour granularity, keeping segment counts and query fan-out low.' },
  ],
  knobs: [
    {
      name: 'Rollup at ingest',
      options: [
        { label: 'Rollup on (minute/hour granularity)', effect: '10–100x fewer rows, much faster and cheaper queries; raw events and any dimension you drop are gone.', when: 'Known dashboards over metrics (counts, sums, HLL sketches).' },
        { label: 'Rollup off (raw events)', effect: 'Full detail and flexible filters, more storage and slower scans.', when: 'Exploratory analysis, or when the raw copy is not kept elsewhere.' },
      ],
    },
    {
      name: 'Index choice',
      options: [
        { label: 'Inverted / bitmap indexes', effect: 'Fast filters on low/medium-cardinality dimensions; extra size per indexed column.', when: 'Columns used in WHERE.' },
        { label: 'Sorted column / primary key order', effect: 'One sorted column per segment gives range lookups for free (ClickHouse `ORDER BY`).', when: 'The most selective filter, often tenant or customer id.' },
        { label: 'Star-tree', effect: 'Pre-aggregated cube with bounded scan cost; costs build time and storage.', when: 'High-QPS group-bys on a fixed set of dimensions (Pinot at LinkedIn).' },
      ],
    },
    {
      name: 'Upserts',
      options: [
        { label: 'Append-only', effect: 'Simplest, fastest; duplicates on replay unless ingestion is exactly-once.', when: 'Immutable events.' },
        { label: 'Upsert by primary key', effect: 'Pinot upsert tables / ClickHouse `ReplacingMergeTree` keep the latest row per key; costs memory for the key map or dedups only after merges (`FINAL`).', when: 'Order status, CDC-sourced dimensions.' },
      ],
    },
  ],
  implementations: [
    { name: 'Apache Druid', how: 'Overlord + MiddleManager tasks ingest, Historicals serve segments from deep storage, Brokers scatter-gather, Coordinator balances; metadata in Postgres/MySQL. Time-partitioned segments with rollup and Roaring bitmaps. Airbnb, Netflix.' },
    { name: 'Apache Pinot', how: 'Helix-managed Controller, Brokers and real-time/offline Servers; consuming segments per Kafka partition; rich index set including star-tree and upserts. Powers LinkedIn "Who viewed my profile" and Uber Eats dashboards at 100k+ QPS.' },
    { name: 'ClickHouse', how: 'Shared-nothing columnar DBMS: MergeTree parts sorted by `ORDER BY` with a sparse index (every 8,192 rows), background merges, `ReplicatedMergeTree` via ClickHouse Keeper, materialized views for ingest-time rollup, Kafka engine for streaming. Cloudflare, Uber logging.' },
  ],
  ha: 'Every segment is replicated on at least 2 servers and also stored in deep storage, so a lost server only costs re-downloading its segments. Brokers are stateless and load-balanced; controllers/coordinators run with standbys (Helix/ZooKeeper leader election). Real-time ingestion can run replicated consumers for the same partition. Scale reads by adding replicas, writes by adding Kafka partitions and real-time servers.',
  failureModes: [
    { name: 'Too many small segments / parts', symptom: 'ClickHouse `Too many parts` errors from row-by-row inserts; Druid queries fan out to 100k tiny segments and p99 climbs to seconds.', fix: 'Batch inserts (≥10k rows or `async_insert`), compaction tasks, sensible segment size (~5M rows).' },
    { name: 'High-cardinality dimension kills rollup', symptom: 'Adding `user_id` or `request_id` as a dimension makes every row unique: rollup ratio drops to 1:1, storage 50x.', fix: 'Keep high-cardinality ids out of rolled-up tables; use HLL/theta sketches for distinct counts.' },
    { name: 'Joins and ad-hoc analytics', symptom: 'Multi-table joins time out or require huge broadcast tables.', fix: 'Denormalise at ingest (enrich in Flink), use lookup tables for small dimensions, send ad-hoc work to the warehouse.' },
    { name: 'Used as the only copy', symptom: 'Rollup dropped a dimension or a bug corrupted segments, and there is no raw data to rebuild from.', fix: 'Keep raw events in the lake; rebuild segments with batch ingestion.' },
  ],
  numbers: ['Druid segment ~5M rows, 300–700 MB', 'Ingest-to-query freshness 1–5 s', 'Query p99 10–100 ms at 1k–100k+ QPS', 'ClickHouse sparse index granule 8,192 rows; aim for ~1 insert per second per table', 'Rollup ratios of 10–100x are common'],
  interview: [
    { q: 'Why does Pinot/Druid answer in 50 ms what takes 5 s in a warehouse?', a: 'It trades flexibility for precomputation. Data is rolled up at ingest so there are fewer rows, every filter column has a dictionary and bitmap/inverted index so filters are bitmap ANDs instead of scans, star-tree pre-aggregates common group-bys, segments are memory-mapped on local SSD rather than fetched from object storage, and brokers prune by time before scattering. The cost: limited joins, a cluster to run, and you must know your query shapes in advance.' },
    { q: 'How do you get exactly-once ingestion from Kafka into a real-time OLAP store?', a: 'The ingestion task owns a Kafka partition and commits the segment and its end offset together in the metadata store (Druid) or controller (Pinot). On failure, the task restarts from the last committed offset and rebuilds the consuming segment, so rows are neither lost nor duplicated. Upstream duplicates (a producer retry that wrote twice) still need dedup by key, e.g. Pinot upsert or ReplacingMergeTree.' },
    { q: 'How does ClickHouse MergeTree work, and why do small inserts hurt?', a: 'Each INSERT writes an immutable part: one file per column sorted by the table’s `ORDER BY`, plus a sparse primary index entry every 8,192 rows and marks to locate granules. Background threads merge parts into larger ones, applying Replacing/Summing/Aggregating logic during merges. Many tiny inserts create parts faster than merges can keep up, so reads touch thousands of parts and ClickHouse eventually rejects inserts with "Too many parts". Batch inserts or use async inserts / a Kafka engine table.' },
  ],
  lab: 'olap',
  kafka: true,
};

const KV: Internals = {
  kind: 'kv',
  summary:
    'A serving KV store is the last hop between a data pipeline and a product: jobs **precompute** exactly what the app will read (a user’s 7-day spend, a counter, a recommendation list) and **upsert** it by key, and the app does single-digit-ms point lookups at huge QPS. Because a put by key overwrites, re-running the job converges to the same state, which makes the sink idempotent.',
  parts: [
    { id: 'writer', name: 'Pipeline writer', role: 'Batch or stream job upserting by key', detail: 'A Spark/Flink sink writes `PUT key=user:42 value={spend_7d: 310.5, v: 2026-11-25T10:00}` in batches (DynamoDB `BatchWriteItem` 25 items, Cassandra unlogged batches per partition), with retries and rate limiting to respect provisioned throughput.' },
    { id: 'router', name: 'Partitioner / router', role: 'Hashes key to owning partition', detail: 'DynamoDB hashes the partition key to a partition (~10 GB, ~**1,000 WCU / 3,000 RCU each**); Cassandra uses consistent hashing on a token ring with vnodes; Redis Cluster uses **16,384 hash slots**. A hot key always lands on one partition, which is the scaling limit.' },
    { id: 'log', name: 'Commit log + memtable', role: 'Durable append, then in-memory write', detail: 'Cassandra/DynamoDB-style engines append the write to a **commit log**, apply it to an in-memory **memtable**, and acknowledge. Redis applies in memory and persists by AOF (fsync every second by default) or RDB snapshots.' },
    { id: 'sstable', name: 'SSTables & compaction', role: 'Immutable sorted files merged in background', detail: 'Memtables flush to immutable sorted **SSTables**; compaction merges them and drops overwritten values and tombstones. Each cell carries a write **timestamp**, and reads resolve conflicts by **last-write-wins**.' },
    { id: 'replicas', name: 'Replicas & quorum', role: 'Replicate N=3, tune read/write consistency', detail: 'Each key is stored on 3 replicas across AZs. Cassandra lets you choose `LOCAL_QUORUM` (2 of 3) for reads and writes so they overlap; DynamoDB offers eventually or strongly consistent reads; Redis replicas are async.' },
    { id: 'reader', name: 'Serving read path', role: 'Point lookup by key in milliseconds', detail: 'The app calls `GetItem(user:42)`: route to the partition, check memtable/row cache, then bloom filters skip SSTables that cannot contain the key, so p99 stays ~**1–10 ms** at tens of thousands of QPS per node.' },
  ],
  flow: [
    { part: 'writer', title: 'Job computes the aggregate', text: 'An hourly Spark job computes `spend_7d` for 30M users and writes them out at a throttled 20k writes/s, or a Flink job upserts each user’s window result as it closes.' },
    { part: 'router', title: 'Key routed', text: '`user:42` hashes to token range 0x3A..., owned by nodes A, D and F. Keys spread evenly unless one key (a celebrity, a global counter) is far hotter than the rest.' },
    { part: 'log', title: 'Durable write', text: 'Each replica appends to its commit log and memtable and acks; with `LOCAL_QUORUM`, the coordinator returns success after 2 of 3 acks.' },
    { part: 'sstable', title: 'Replay is harmless', text: 'The job crashes and reruns the hour: it writes the same keys with the same values again. Because a put by key overwrites, the end state is identical: **idempotent upsert**. Setting the write timestamp to the logical version (e.g. window end) stops a late, older run from overwriting a newer value.' },
    { part: 'replicas', title: 'Replicas converge', text: 'A replica that was down gets missed writes via hinted handoff and read repair; anti-entropy repair (Merkle trees) fixes the rest.' },
    { part: 'reader', title: 'App reads', text: 'The checkout page calls `GET user:42` and gets `spend_7d` in ~3 ms. No GROUP BY at request time: everything was computed upstream.' },
  ],
  knobs: [
    {
      name: 'Bulk load strategy',
      options: [
        { label: 'Upsert in place', effect: 'Simple; readers see a mix of old and new values during the load, and the write rate must fit provisioned capacity.', when: 'Incremental streaming updates, small daily deltas.' },
        { label: 'Versioned swap', effect: 'Write the whole dataset under version `v42` (new table or key prefix), validate, then flip a pointer; instant rollback, but 2x storage during the swap.', when: 'Full recomputes of features or recommendations (LinkedIn Venice, Airbnb style).' },
      ],
    },
    {
      name: 'Store choice',
      options: [
        { label: 'DynamoDB', effect: 'Fully managed, autoscaling, on-demand or provisioned; per-partition limits and 400 KB item limit.', when: 'AWS shops that want zero ops.' },
        { label: 'Cassandra / ScyllaDB', effect: 'Write-optimized LSM, multi-region active-active, tunable consistency; you run it.', when: 'Very high write rates, multi-DC, cost at scale.' },
        { label: 'Redis', effect: 'Sub-ms in memory, rich data types (sorted sets, HLL); RAM is ~10–30x the price of SSD per GB.', when: 'Hot, small datasets: counters, leaderboards, session state.' },
      ],
    },
    {
      name: 'TTL',
      options: [
        { label: 'TTL on every key', effect: 'Stale keys expire on their own and storage stays bounded; expired data disappears even if the job is late.', when: 'Rolling-window features, caches.' },
        { label: 'No TTL', effect: 'Keys live until deleted; deleted users and old entities accumulate.', when: 'Profiles or reference data with explicit deletes.' },
      ],
    },
  ],
  implementations: [
    { name: 'Amazon DynamoDB', how: 'Partitions of ~10 GB replicated 3x across AZs with Multi-Paxos leaders; adaptive capacity shifts throughput to hot partitions. Conditional writes (`attribute_not_exists`, version checks) for idempotency; S3 import for bulk loads.' },
    { name: 'Apache Cassandra / ScyllaDB', how: 'Token ring, RF=3, commit log + memtable + SSTables with size-tiered or leveled compaction. LWW by cell timestamp; `USING TIMESTAMP` lets replays write deterministic versions. Netflix and Apple run it at petabyte scale.' },
    { name: 'Redis', how: 'Single-threaded in-memory engine (~100k+ ops/s per core), Redis Cluster with 16,384 slots and async replicas, persistence via AOF/RDB. Often a cache in front of Dynamo/Cassandra.' },
  ],
  ha: 'Data is hash-partitioned and each partition is replicated 3x across AZs (Redis with async replicas and failover). Losing a node only shifts its token ranges to replicas; quorum reads/writes keep working with one replica down. Scale out by adding nodes (Cassandra streams token ranges) or by letting DynamoDB split partitions. Multi-region: DynamoDB Global Tables or Cassandra multi-DC with last-write-wins.',
  failureModes: [
    { name: 'Hot partition', symptom: 'One key (a global counter, a viral item) gets 50k writes/s and is throttled while the cluster idles.', fix: 'Shard the key (`counter#0..15`) and sum on read, pre-aggregate in the stream processor, cache hot reads.' },
    { name: 'Bulk load overwhelms serving', symptom: 'The nightly job writes 300M keys at full speed and p99 for live reads goes from 5 ms to 500 ms.', fix: 'Rate-limit the writer, use a separate table + pointer swap, or native bulk import.' },
    { name: 'Out-of-order overwrite', symptom: 'A delayed retry of an old run overwrites a newer value with stale data.', fix: 'Write with a version/timestamp and conditional put (`only if version >`), or LWW timestamps derived from event time.' },
    { name: 'Tombstone buildup', symptom: 'Cassandra reads slow down and time out after mass deletes or TTL expiry.', fix: 'Avoid delete-heavy patterns, tune `gc_grace_seconds` and compaction, prefer full-partition replacement.' },
  ],
  numbers: ['Point read p99 1–10 ms (Redis < 1 ms)', 'DynamoDB partition ~10 GB, 1,000 WCU / 3,000 RCU; item ≤ 400 KB', 'Redis ~100k+ ops/s per core; Cluster has 16,384 slots', 'Replication factor 3 across AZs'],
  interview: [
    { q: 'Why is a KV store the usual serving layer for pipeline outputs, and why is it idempotent?', a: 'Products need millisecond lookups at thousands of QPS, which warehouses and lakes cannot give. So the pipeline precomputes the answer per key and upserts it. A put by primary key replaces the whole value, so rerunning a job or replaying a stream writes the same final values: duplicates collapse. The remaining risk is ordering (a stale run overwriting a newer value), handled with version numbers and conditional writes or event-time timestamps for LWW.' },
    { q: 'You need a real-time "likes per post" counter at 100k likes/s, with viral posts. How?', a: 'Don’t increment a single key from every event: one hot partition caps throughput and increments are not idempotent on retry. Aggregate in a stream processor (Flink) keyed by post with short windows, then upsert the absolute count per post. For extreme hot keys, salt the key into N sub-counters and sum on read. Use exactly-once processing or versioned writes so replays don’t double count.' },
  ],
};

const FEATURE_STORE: Internals = {
  kind: 'feature-store',
  summary:
    'A feature store keeps **one definition** of each ML feature and serves it from **two stores**: an **offline store** with full history for building training sets with **point-in-time-correct joins**, and an **online store** with the latest value per entity for millisecond lookups at inference. Materialization jobs keep the two in sync, which is what removes training/serving skew.',
  parts: [
    { id: 'registry', name: 'Feature registry', role: 'Versioned feature definitions and metadata', detail: 'Code-defined `Entity` (e.g. `user_id`), `FeatureView` (source, columns, TTL) and feature services are applied with `feast apply` into a registry (file in S3 or SQL DB). Both training and serving resolve feature names through it, so they compute the same thing.' },
    { id: 'transform', name: 'Feature pipelines', role: 'Batch and streaming feature computation', detail: 'Spark/dbt jobs compute batch features (`orders_30d`), Flink/Spark Streaming compute streaming features (`clicks_5m`), and on-demand transforms run at request time on request data. Tecton computes sliding-window aggregations from pre-aggregated **tiles** to keep streaming features cheap.' },
    { id: 'offline', name: 'Offline store', role: 'Full timestamped history for training', detail: 'A warehouse or lakehouse table (BigQuery, Snowflake, Iceberg/Delta) with every feature value and its **event timestamp**. History is what makes point-in-time joins and backfills of new features possible.' },
    { id: 'pit', name: 'Point-in-time join', role: 'Builds leakage-free training sets', detail: 'For each label row `(user_id, event_ts, label)` it picks, per feature view, the **latest feature row with `feature_ts <= event_ts`** and within TTL (an "as-of" join). Using today’s value instead leaks the future into training.' },
    { id: 'materialize', name: 'Materialization job', role: 'Copies latest values offline → online', detail: '`feast materialize-incremental` (or a streaming push) reads feature rows newer than the last run and upserts the latest value per entity into the online store. It is idempotent: reruns write the same latest values.' },
    { id: 'online', name: 'Online store & serving API', role: 'Latest value per entity in ms', detail: 'Redis, DynamoDB, Cassandra or Bigtable keyed by entity, read via `get_online_features(["user:orders_30d"], entity_rows=[{user_id: 42}])` with p99 **< 10 ms**. Served values are logged so training can later use exactly what the model saw.' },
  ],
  flow: [
    { part: 'registry', title: 'Feature defined once', text: 'A data scientist defines `user_txn_stats` (entity `user_id`, features `txn_count_7d`, `avg_amount_30d`, TTL 2 days, source `fct_transactions`) and applies it to the registry.' },
    { part: 'transform', title: 'Pipelines compute it', text: 'A daily Spark job computes `avg_amount_30d` per user; a Flink job updates `txn_count_1h` every minute from Kafka. Both write timestamped rows.' },
    { part: 'offline', title: 'History lands offline', text: 'Every computed row is appended to the offline table with its `event_timestamp`, so the store can answer "what was this feature at 14:03 on March 2?".' },
    { part: 'pit', title: 'Training set built', text: 'For 10M fraud labels, the as-of join attaches for each transaction the feature values that existed **just before** it happened. A chargeback label from March 2 gets March 1 features, not today’s.' },
    { part: 'materialize', title: 'Latest values materialized', text: 'Every hour, materialization reads rows since the last watermark and upserts the newest value per user into the online store. Streaming features are pushed directly within seconds.' },
    { part: 'online', title: 'Inference lookup', text: 'At checkout the fraud service fetches 40 features for `user_id=42` in ~5 ms, adds request-time features, and scores. The same definitions produced the training data, so there is no skew.' },
  ],
  knobs: [
    {
      name: 'Feature freshness',
      options: [
        { label: 'Batch (daily/hourly materialization)', effect: 'Cheap and simple; features are hours old at inference.', when: 'Slow-moving features: 30-day aggregates, profiles.' },
        { label: 'Streaming (seconds)', effect: 'Fresh features (last 5 minutes of activity) but needs a stream pipeline and must be written to both stores consistently.', when: 'Fraud, ranking, ETA: where recent behavior matters.' },
        { label: 'On-demand (request time)', effect: 'Always fresh, uses request data; adds latency and must be identical in training code.', when: 'Features of the request itself (cart value vs user average).' },
      ],
    },
    {
      name: 'Online store',
      options: [
        { label: 'Redis', effect: 'Sub-ms reads, RAM-priced storage.', when: 'Small-to-medium entity counts, strict latency.' },
        { label: 'DynamoDB / Cassandra / Bigtable', effect: '1–10 ms reads, cheap at billions of keys.', when: 'Large entity spaces (all users × items).' },
      ],
    },
    {
      name: 'Training data source',
      options: [
        { label: 'Point-in-time join on offline store', effect: 'Can backfill new features over years of history; correctness depends on accurate timestamps.', when: 'Default for new features.' },
        { label: 'Logged served features', effect: 'Exactly what the model saw at inference, no skew; only available from when logging started.', when: 'Mature models retrained continuously.' },
      ],
    },
  ],
  implementations: [
    { name: 'Feast', how: 'Open-source, library-first: registry file/SQL, pluggable offline (BigQuery, Snowflake, Redshift, Spark) and online stores (Redis, DynamoDB), CLI-driven materialization. It orchestrates stores you already run rather than computing features itself.' },
    { name: 'Tecton', how: 'Managed platform (from Uber Michelangelo’s creators): declarative batch/stream/on-demand features, tile-based window aggregations, managed materialization to online/offline stores and monitoring.' },
    { name: 'Databricks / Vertex / SageMaker feature stores', how: 'Offline store as Delta/BigQuery tables with primary and timestamp keys; online tables published to a low-latency store; point-in-time lookups built into the training set API.' },
  ],
  ha: 'The offline store inherits warehouse/lakehouse durability and can always rebuild the online store, which is effectively a cache of latest values. The online store is a replicated KV store (multi-AZ, often multi-region) sized for inference QPS. If materialization falls behind, serving continues with stale values; TTLs ensure overly stale features return null so the model falls back to defaults instead of using week-old data.',
  failureModes: [
    { name: 'Label leakage', symptom: 'Offline AUC 0.95, production 0.70: training joined labels with current feature values that include post-event information.', fix: 'Point-in-time as-of joins with correct event timestamps; never join on entity id alone.' },
    { name: 'Training/serving skew', symptom: 'The model behaves differently online because the online feature was computed by different code (Java service vs SQL).', fix: 'One registered definition for both paths; log served features and compare distributions.' },
    { name: 'Stale online features', symptom: 'Materialization failed for 2 days; fraud model scores with stale counts.', fix: 'Freshness monitors per feature view, TTLs, alerting on materialization lag.' },
    { name: 'Backfill overwrites online', symptom: 'A historical backfill materialized old values over newer ones in the online store.', fix: 'Materialize only the latest per entity and compare timestamps on write.' },
  ],
  numbers: ['Online read p99 < 10 ms for tens of features', 'Inference fan-out: 50–500 features per request', 'Batch materialization hourly/daily; streaming features seconds', 'Training sets: 10M–1B label rows joined as-of'],
  interview: [
    { q: 'What is a point-in-time join and why is it needed?', a: 'Training rows are labeled events at specific times. For each row you must attach feature values as they were just before that time, i.e. the latest feature row with `feature_ts <= label_ts` (within a TTL). A naive join on entity id attaches today’s values, which include information from after the event (e.g. a chargeback count that already includes this fraud), so the model looks great offline and fails online. Feature stores implement as-of joins efficiently on the offline store.' },
    { q: 'Why have both an offline and an online store?', a: 'They answer different questions. Training needs full history, scanned in bulk, to reconstruct any point in time: a warehouse/lakehouse is cheap and good at that. Inference needs the latest value for one entity in a few milliseconds at thousands of QPS: a KV store. Keeping one definition and materializing offline → online (and writing streaming features to both) gives each workload the right store without two diverging implementations.' },
  ],
};

const SEARCH: Internals = {
  kind: 'search',
  summary:
    'Elasticsearch/OpenSearch splits each index into **shards**, and each shard is a Lucene index made of immutable **segments** containing an **inverted index** (term → documents) plus columnar doc values for aggregations. New documents become searchable on **refresh** (default every 1 s), and log indices are rotated by time and moved through **hot/warm/cold** tiers by ILM, so old data gets cheaper and finally deleted.',
  parts: [
    { id: 'coord', name: 'Coordinating node', role: 'Routes bulk writes and fans out searches', detail: 'Receives `_bulk` requests (5–15 MB batches work well) and routes each doc to a primary shard by `hash(_routing) % num_primary_shards`. For searches it queries one copy of every shard and merges top-k results and aggregations.' },
    { id: 'shard', name: 'Primary & replica shards', role: 'Unit of scale and of replication', detail: 'Each index has N primary shards (fixed at creation; changing needs reindex/split/shrink) and R replicas on other nodes. Target **10–50 GB per shard**; too many small shards waste heap, too few huge ones recover slowly.' },
    { id: 'buffer', name: 'Indexing buffer + translog', role: 'Accepts writes durably before they are searchable', detail: 'Docs are analyzed (tokenized, lowercased) into an in-memory buffer and appended to the **translog**, fsynced per request by default, so acknowledged writes survive a crash. The primary forwards to replicas before acking.' },
    { id: 'segment', name: 'Lucene segments (inverted index)', role: 'Immutable term dictionaries and postings', detail: 'A **refresh** (default `1s`) writes the buffer into a new segment: term dictionary (FST), postings lists of doc ids per term, stored fields and **doc values** (columnar, for sorting/aggregations). Searches open all segments; deletes are bitmaps until merged.' },
    { id: 'merge', name: 'Segment merging', role: 'Merges small segments, purges deletes', detail: 'The tiered merge policy merges small segments into larger ones (up to ~5 GB) in the background, removing deleted docs. A **flush** performs a Lucene commit and trims the translog. Read-only indices can be force-merged to 1 segment.' },
    { id: 'ilm', name: 'ILM & data tiers', role: 'Rollover, tier moves, deletion by age', detail: 'Logs go to a **data stream** whose backing index **rolls over** at e.g. 50 GB per primary shard or 1 day. ILM moves it hot (NVMe) → warm (bigger HDD/SSD nodes, fewer replicas) → cold/frozen (**searchable snapshots** in S3) → delete after 30–90 days.' },
  ],
  flow: [
    { part: 'coord', title: 'Bulk request arrives', text: 'Fluent Bit / Logstash sends a `_bulk` of 5,000 log lines to `logs-checkout` (a data stream). The coordinator routes each line to a primary shard of the current backing index.' },
    { part: 'buffer', title: 'Indexed and logged', text: 'The primary analyzes `message: "payment timeout for order 991"` into terms, buffers the doc, appends to the translog and forwards to the replica. The write is acked but **not yet searchable**.' },
    { part: 'segment', title: 'Refresh makes it searchable', text: 'Within 1 s a refresh writes a new small segment and the line appears in Kibana: **near-real-time** search. The term `timeout` now has a postings entry pointing to this doc.' },
    { part: 'merge', title: 'Segments merge', text: 'One refresh per second creates 86,400 tiny segments a day per shard if nothing merged them; background merging keeps it to dozens. Merging is a big part of indexing CPU and disk I/O.' },
    { part: 'shard', title: 'Search fans out', text: '`message:timeout AND service:checkout` over the last 15 minutes hits one copy of each shard of today’s index; each shard intersects postings lists, returns top hits and partial aggregations, and the coordinator merges.' },
    { part: 'ilm', title: 'Rollover and tiering', text: 'At 50 GB per shard the index rolls over; after 2 days it moves to warm nodes and is force-merged; after 14 days it becomes a searchable snapshot in S3; after 30 days it is deleted with one cheap index delete.' },
  ],
  knobs: [
    {
      name: 'Refresh interval',
      options: [
        { label: '`1s` (default)', effect: 'Logs searchable within ~1 s; many small segments and more merge work.', when: 'Interactive debugging on hot logs.' },
        { label: '`30s` or `-1` during bulk loads', effect: 'Much higher indexing throughput (often 2x+), fewer merges; data appears later.', when: 'High-volume ingest, reindex/backfill jobs.' },
      ],
    },
    {
      name: 'Shard sizing',
      options: [
        { label: 'Many small shards (< 1 GB)', effect: 'Each shard costs heap and cluster-state overhead; thousands of them slow searches and the master.', when: 'Avoid: a classic daily-index-per-service mistake.' },
        { label: '10–50 GB shards with rollover', effect: 'Balanced recovery time and per-shard overhead; rollover by size keeps it consistent regardless of traffic.', when: 'Default for logs and time series.' },
      ],
    },
    {
      name: 'Mapping',
      options: [
        { label: 'Dynamic mapping', effect: 'Any new JSON field becomes a mapped field; arbitrary keys cause **mapping explosion** (default limit 1,000 fields).', when: 'Only for prototypes.' },
        { label: 'Explicit mapping, `keyword` vs `text`', effect: '`keyword` for exact filters/aggs, `text` for full-text; unknown fields disabled or flattened.', when: 'Production log schemas.' },
      ],
    },
  ],
  implementations: [
    { name: 'Elasticsearch', how: 'Lucene shards, master-eligible nodes managing cluster state, data tiers (hot/warm/cold/frozen), data streams with ILM, searchable snapshots on S3.' },
    { name: 'OpenSearch', how: 'Apache-2.0 fork of Elasticsearch 7.10 with the same shard/segment model; ISM instead of ILM, UltraWarm/cold storage on S3, and segment replication (copy segments instead of re-indexing on replicas).' },
    { name: 'Loki / ClickHouse (alternatives)', how: 'Loki indexes only labels and stores compressed chunks in S3 (grep at query time): far cheaper, slower for full-text. ClickHouse stores logs columnar with token bloom filters. Both trade search power for 5–10x lower cost.' },
  ],
  ha: 'Each primary shard has ≥1 replica on a different node (and AZ with allocation awareness); if a node dies, replicas are promoted and new replicas rebuilt. A dedicated set of 3 master-eligible nodes keeps a quorum for cluster state. Scale writes by adding primaries (at rollover) and nodes, reads by adding replicas. Snapshots to S3 protect against cluster loss.',
  failureModes: [
    { name: 'Oversharding', symptom: 'A daily index per service with 5 shards each: 50,000 tiny shards, master nodes overloaded, cluster state updates take minutes.', fix: 'Data streams with size-based rollover, fewer primaries, shrink old indices, target 10–50 GB per shard.' },
    { name: 'Mapping explosion', symptom: 'Logs with arbitrary JSON keys (user ids as field names) create tens of thousands of fields; indexing fails at the field limit.', fix: 'Explicit mappings, `flattened` type, drop/rename unknown fields at ingest.' },
    { name: 'Keeping too much hot', symptom: 'A year of logs on NVMe hot nodes; cost grows linearly and heap pressure causes GC pauses.', fix: 'ILM tiers and deletion; archive raw logs to object storage and query them with Trino/Athena when needed.' },
    { name: 'Indexing backpressure', symptom: '`429 es_rejected_execution_exception` on write threadpool during spikes.', fix: 'Buffer in Kafka before ES, tune bulk sizes, raise refresh interval, add hot nodes.' },
  ],
  numbers: ['Shard 10–50 GB; < ~200M docs per shard', 'Refresh 1 s default; bulk request 5–15 MB', 'JVM heap ≤ ~31 GB (compressed oops), ~50% of RAM', 'Index size often 1–1.5x raw log size with replicas excluded', 'Hot retention days–2 weeks; delete at 30–90 days'],
  interview: [
    { q: 'Why is Elasticsearch search "near real-time" rather than real-time?', a: 'Writes go into an in-memory buffer and the translog for durability, but Lucene can only search segments. A refresh (default every 1 s) turns the buffer into a new immutable segment and opens it for search. Until then the doc is durable but invisible. You can trade freshness for throughput by raising the interval; segments created by frequent refreshes are later merged in the background.' },
    { q: 'Design log retention for 5 TB/day of logs with 30-day search and 1-year compliance.', a: 'Ingest via Kafka into a data stream with rollover at 50 GB per primary shard. ILM: hot on NVMe for ~3 days (1 replica), warm for days 3–14 with force-merge, cold/frozen as searchable snapshots in S3 until day 30, then delete. In parallel, land raw logs in object storage as compressed Parquet for 1 year and query them with Trino/Athena when an audit needs it. That keeps the expensive hot tier to ~15 TB plus replicas instead of 150 TB.' },
  ],
};

const TRINO: Internals = {
  kind: 'trino',
  summary:
    'Trino is a distributed SQL engine with **no storage of its own**: a coordinator plans the query, **connectors** expose tables in S3/Iceberg/Hive/Kafka/Postgres, and workers stream data through **pipelined in-memory operators**. You query the lake where it sits, without loading it into a warehouse, and scale compute independently of data.',
  parts: [
    { id: 'coordinator', name: 'Coordinator', role: 'Parses, analyzes, plans, schedules', detail: 'A single coordinator per cluster parses SQL, resolves tables through connectors, runs the **cost-based optimizer** (join order and broadcast vs partitioned joins from table stats) and splits the plan into **stages** connected by exchanges.' },
    { id: 'connector', name: 'Connectors (SPI)', role: 'Metadata, splits and data per source', detail: 'Each catalog is a connector implementing metadata (schemas, stats), a **split manager** (how to divide the data) and a page source (how to read it). The Iceberg connector reads manifests; Hive reads the metastore and lists files; Postgres pushes down filters as SQL.' },
    { id: 'splits', name: 'Split scheduler', role: 'Assigns file chunks to workers', detail: 'Files are divided into **splits** (e.g. a Parquet file or ~64 MB of it). The coordinator streams splits to tasks as workers free up, so planning and reading overlap and stragglers are reduced.' },
    { id: 'workers', name: 'Workers & tasks', role: 'Read, filter, join, aggregate in memory', detail: 'Each worker runs tasks with many **drivers**, pipelines of operators over columnar **pages**. Readers apply projection and predicate pushdown into Parquet/ORC, and **dynamic filtering** pushes join keys from the build side into the probe-side scan.' },
    { id: 'exchange', name: 'Exchanges (pipelined)', role: 'Stream pages between stages', detail: 'Stages stream pages to each other over HTTP as soon as they are produced: no materialization to disk between stages, which is why Trino is fast for interactive queries. Default retry policy is to restart the whole query; `retry-policy=TASK` spools exchanges to S3 for fault-tolerant batch.' },
    { id: 'client', name: 'Client results', role: 'Streams final rows back to the user', detail: 'The root stage gathers results on the coordinator, which streams them to the client (JDBC, BI tools) in pages. Large result sets are paged so the client can start reading before the query finishes.' },
  ],
  flow: [
    { part: 'coordinator', title: 'Query planned', text: '`SELECT c.country, sum(o.amount) FROM iceberg.sales.orders o JOIN pg.crm.customers c ON ... WHERE o.order_date >= DATE \u20182026-11-01\u2019 GROUP BY 1` arrives. The optimizer, using stats, chooses to broadcast the small `customers` table.' },
    { part: 'connector', title: 'Connectors resolve tables', text: 'The Iceberg connector reads the current snapshot’s manifests and prunes to files in November; the Postgres connector pushes the projection into a SQL query. No data is copied anywhere first.' },
    { part: 'splits', title: 'Splits stream out', text: '1,200 Parquet files become ~2,000 splits handed to 20 workers as they have capacity; a slow S3 read does not hold up other splits.' },
    { part: 'workers', title: 'Scan with pushdown', text: 'Each task reads Parquet footers, skips row groups by min/max on `order_date`, reads only 3 columns, and a dynamic filter built from `customers` keys prunes rows during the scan.' },
    { part: 'exchange', title: 'Partial aggregates streamed', text: 'Workers compute partial sums per country and stream them through an exchange, hash-partitioned by country, to the final aggregation stage. All in memory: a query exceeding `query.max-memory` fails (or spills if enabled).' },
    { part: 'client', title: 'Result returned', text: 'The final stage sends ~200 rows to the coordinator, which streams them to the dashboard. Typical: seconds for GBs scanned, and cost is just the cluster’s time (or ~$5/TB scanned on Athena).' },
  ],
  knobs: [
    {
      name: 'Fault tolerance',
      options: [
        { label: 'Pipelined (`retry-policy=NONE` / QUERY)', effect: 'Fastest; a worker failure fails the query, which is rerun from scratch.', when: 'Interactive queries of seconds to minutes.' },
        { label: 'Fault-tolerant (`retry-policy=TASK`)', effect: 'Exchanges spooled to object storage, failed tasks retried individually; slower but survives node loss and spot reclaims.', when: 'Long ETL queries, spot instances.' },
      ],
    },
    {
      name: 'Join distribution',
      options: [
        { label: 'Broadcast', effect: 'Small side copied to every worker; no shuffle of the big side. Fails if the "small" side is actually large.', when: 'Fact-to-dimension joins with dimensions of MBs.' },
        { label: 'Partitioned (hash)', effect: 'Both sides shuffled by join key; scales to big-big joins at network cost.', when: 'Large-to-large joins; let the CBO choose with good stats.' },
      ],
    },
    {
      name: 'Where data lives',
      options: [
        { label: 'Query the lake directly', effect: 'No load step, one copy, open formats; speed depends on file layout and stats.', when: 'Ad-hoc and exploratory analytics over Iceberg/Hive.' },
        { label: 'Load into a warehouse', effect: 'Managed caching, clustering and concurrency; another copy and more cost.', when: 'High-concurrency BI with strict SLAs.' },
      ],
    },
  ],
  implementations: [
    { name: 'Trino (ex-PrestoSQL)', how: 'Coordinator/worker MPP engine created at Facebook as Presto; pipelined execution, 40+ connectors, fault-tolerant execution mode. Used at Netflix, Lyft, LinkedIn. Starburst adds caching and management.' },
    { name: 'Amazon Athena', how: 'Serverless Trino (engine v3) over Glue Catalog and S3, billed ~$5 per TB scanned with a 10 MB minimum per query, so Parquet + partitioning directly cut cost.' },
    { name: 'Spark SQL', how: 'Stage-by-stage execution with shuffle files on disk: slower to start but resilient for huge batch jobs; Adaptive Query Execution re-plans joins at runtime. Often Spark for ETL, Trino for interactive.' },
  ],
  ha: 'Workers are stateless and can be added or removed; storage durability belongs to the lake. The coordinator is a single point per cluster, so production setups run several clusters behind a **Trino Gateway**/load balancer and route by workload (ETL vs BI). Fault-tolerant execution makes long queries survive worker loss. Scale by worker count for throughput and by clusters for concurrency isolation.',
  failureModes: [
    { name: 'Small files and missing stats', symptom: 'A query over a streaming table spends 3 minutes planning 400k files; the CBO picks a terrible join order without stats.', fix: 'Compact tables, run `ANALYZE`, use Iceberg (manifests instead of listing).' },
    { name: 'Query exceeds memory', symptom: '`Query exceeded per-node memory limit` on a big join or high-cardinality GROUP BY.', fix: 'Filter earlier, use partitioned joins, enable spill or fault-tolerant execution, run it as a Spark job.' },
    { name: 'Coordinator overload', symptom: 'Hundreds of concurrent BI queries make the coordinator the bottleneck; all queries slow down.', fix: 'Resource groups with concurrency limits, multiple clusters behind a gateway, result caching in BI.' },
    { name: 'Scanning raw JSON', symptom: 'Querying gzip JSON logs reads every byte, and Athena bills accordingly.', fix: 'Convert to partitioned Parquet/Iceberg (CTAS or ETL) and query that.' },
  ],
  numbers: ['Interactive queries: seconds over GBs to TBs', 'Athena ~$5/TB scanned (10 MB minimum per query)', 'Split ~ one Parquet file or up to ~64 MB', 'Coordinator: 1 per cluster; workers: 10s–1000s'],
  interview: [
    { q: 'How does Trino query S3 data without loading it?', a: 'Connectors map tables to files via a catalog (Hive metastore, Glue, Iceberg metadata). The coordinator gets the file list (pruned by partitions and file stats), turns files into splits and schedules them on workers. Workers read Parquet directly from S3 with ranged GETs, pushing projection and predicates into the reader so only needed columns and row groups are fetched, then process pages in a pipelined, in-memory operator graph. Nothing is copied into Trino-owned storage.' },
    { q: 'When would you choose Spark over Trino for a SQL job?', a: 'Trino is pipelined and in-memory: low latency, great for interactive queries, but a long query fails entirely on node loss (unless fault-tolerant mode) and huge joins can exceed memory. Spark writes shuffle to disk and retries failed tasks, starts slower but handles hours-long, multi-TB ETL robustly, and offers DataFrame/Python APIs. Typical split: Spark (or Trino FTE) for heavy ETL, Trino for ad-hoc and BI over the lake.' },
  ],
};

export const STORAGE_INTERNALS: Internals[] = [OBJECT_STORE, LAKEHOUSE, WAREHOUSE, OLAP, KV, FEATURE_STORE, SEARCH, TRINO];
