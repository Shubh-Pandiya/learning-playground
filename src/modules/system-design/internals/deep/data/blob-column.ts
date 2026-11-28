import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'blob-column',

  problem: {
    why: 'Storing files in a `BYTEA`/`BLOB` column is tempting because it is one system, one transaction, one backup and one permission model. But a relational database is optimized for small rows touched by many concurrent transactions; every byte you put in it is logged, cached, replicated, vacuumed and backed up with the same care as an account balance. Files are large, immutable, rarely updated and read sequentially — the exact opposite workload, which an object store serves at a fraction of the cost.',
    withoutIt: [
      'Without blobs in the DB you need a second system (object store) and must keep row and object consistent yourself.',
      'Permissions are no longer enforced by the same SQL grants; you need presigned URLs or a proxy.',
      'Backups of the DB no longer contain the files; they need their own protection (versioning, replication).',
      'For a handful of tiny files, the extra moving parts can genuinely cost more than they save.',
    ],
    position: 'The anti-pattern puts the file on the synchronous write and read path of the primary database and the app tier; the fix moves bytes to object storage and leaves a small metadata row (key, size, hash, owner) in the DB.',
    diagram: {
      type: 'compare',
      title: 'Same feature, two designs',
      columns: [
        { name: 'Blob in SQL', points: ['Bytes via app server', 'WAL + TOAST + replicas', 'Backups grow with files', 'Premium SSD $/GB'], tone: 'bad' },
        { name: 'Object store + row', points: ['Client → S3 direct', 'DB row ~200 bytes', 'CDN serves reads', '~$0.023/GB-month'], tone: 'ok' },
      ],
    },
  },

  architecture: {
    overview: 'Follow one 8 MB photo through the database. It arrives through an app server, is written to the WAL (plus full-page images), compressed (uselessly) and chunked into an out-of-line table, cached in the shared buffer pool, streamed to every replica, captured by CDC, and copied into every backup forever. Each layer was designed for small rows; the photo turns them into a bulk-transfer system.',
    diagram: {
      type: 'flow',
      title: 'Life of a blob in Postgres',
      nodes: [
        { label: 'App server', sub: 'buffers whole file', tone: 'warn' },
        { label: 'WAL', sub: 'every byte logged', tone: 'bad' },
        { label: 'TOAST table', sub: '~2 KB chunks', tone: 'warn' },
        { label: 'Buffer pool', sub: 'evicts hot pages', tone: 'bad' },
        { label: 'Replicas + CDC', sub: 'replay every byte', tone: 'warn' },
        { label: 'Backups', sub: 'copied forever', tone: 'bad' },
      ],
      caption: 'Every arrow is paid again for every file, on the most expensive storage you own.',
    },
    blocks: [
      { name: 'App-tier proxying', what: 'To become a bind parameter, the file must be fully read by the API process; downloads come back the same way. A 50 MB file holds a worker and ≥50 MB of heap for the whole transfer, and the DB connection is held while bytes move.' },
      { name: 'WAL / redo + binlog', what: 'Postgres writes the full value to WAL; MySQL writes it to the InnoDB redo log and, with row-based binlog and the default `binlog_row_image=FULL`, logs before and after images — so updating any column of a row with a blob can log the blob twice.' },
      { name: 'TOAST / off-page storage', what: 'Postgres TOASTs values beyond ~2 KB: tries compression (pglz, or lz4 since 14) and splits the rest into ~2 KB chunks in a hidden `pg_toast_NNN` table indexed by (value id, chunk seq). InnoDB DYNAMIC rows keep a 20-byte pointer and store the value in 16 KB overflow pages.' },
      { name: 'Buffer pool', what: 'Blob pages flow through `shared_buffers` / the InnoDB buffer pool and the OS cache, competing with indexes and hot rows. Sequential reads of large values evict the working set that made your queries fast.' },
      { name: 'Replication and CDC', what: 'Physical replicas replay the WAL bytes; logical decoding/Debezium must ship the value as an event. Kafka’s default max message size is ~1 MB, so CDC either breaks or needs blobs excluded.' },
      { name: 'Backups and restore', what: 'Base backups, snapshots and `pg_dump` include every file ever stored (`pg_dump` plain format hex-encodes `bytea`, roughly doubling it). Restore time — your RTO — now scales with media, not with business data.' },
    ],
    real: [
      { name: 'PostgreSQL bytea + TOAST', how: '`bytea` up to 1 GB per value; TOAST strategies `EXTENDED` (compress + out-of-line, default), `EXTERNAL` (out-of-line, no compression), `MAIN`, `PLAIN`. Unchanged TOASTed values are not rewritten when other columns of the row are updated.' },
      { name: 'PostgreSQL large objects', how: '`lo_create`/`lo_import` store up to 4 TB per object in `pg_largeobject` in 2 KB pages, with a stream API. Rows only hold an OID, so deleting the row leaks the object unless you `lo_unlink` (or run `vacuumlo`).' },
      { name: 'MySQL InnoDB LONGBLOB', how: 'Up to 4 GB; off-page overflow pages; client packets capped by `max_allowed_packet` (64 MB default in 8.0); a single blob larger than 10% of the redo log size is rejected.' },
      { name: 'SQL Server FILESTREAM', how: 'Stores `varbinary(max)` values as NTFS files that participate in transactions and backups — Microsoft’s own acknowledgment that large blobs do not belong in data pages.' },
      { name: 'The fix: S3/GCS + metadata row', how: 'Instagram, Dropbox, Slack and virtually every large app keep media in object storage and only keys and metadata in the DB, serving bytes via CDN and presigned URLs.' },
    ],
  },

  lifecycle: {
    summary: 'Uploading and later downloading an 8 MB photo stored in a Postgres `bytea` column. Note where your app servers and DB are busy for seconds.',
    stages: [
      { stage: 'Upload to API', what: 'Client streams 8 MB to the app server over a 20 Mbit/s mobile uplink; worker held throughout.', cost: '8 MB ÷ 2.5 MB/s', ms: 3200 },
      { stage: 'Bind + send to DB', what: 'App sends `INSERT … VALUES ($1, $2)` with 8 MB parameter over the DB connection.', cost: 'Network + protocol encoding', ms: 70 },
      { stage: 'TOAST compress attempt', what: 'pglz tries to compress an already-compressed JPEG, gives up, stores ~4,000 chunks.', cost: 'Wasted CPU on the primary', ms: 40 },
      { stage: 'WAL write + fsync', what: '8 MB+ of WAL written and flushed before commit.', cost: 'Disk bandwidth shared with all txns', ms: 25 },
      { stage: 'Replicate', what: 'Streaming replicas receive and replay 8 MB of WAL; synchronous replica delays commit.', cost: 'Network + replay; lag for all tables', ms: 30 },
      { stage: 'Download: SELECT', what: '`SELECT data FROM photos WHERE id=$1` detoasts 4,000 chunks through the buffer pool.', cost: 'Index lookups + 8 MB read', ms: 60 },
      { stage: 'Stream to client', what: 'App holds the DB result and a worker while sending 8 MB; no CDN, no range requests.', cost: 'Bound by client downlink', ms: 800 },
    ],
  },

  deepDives: [
    {
      title: 'Write amplification: one file, many copies',
      hook: 'A 1 GB/day upload stream becomes many GB/day of DB I/O, replication and backup traffic.',
      body: [
        'Count the copies of an uploaded file in a typical Postgres setup: WAL on the primary, the TOAST heap pages, WAL archive for point-in-time recovery, each streaming replica’s WAL and heap, each daily base backup or snapshot, and logical CDC if enabled. Six to ten copies on expensive storage is normal, versus the object store’s internally coded ~1.5–2× on cheap disks.',
        'This load is not isolated. WAL bandwidth, checkpoint I/O and replication are shared with every transaction. A burst of uploads raises commit latency and replica lag for orders and logins, and archived WAL volume can fill disks and block the primary.',
      ],
      table: {
        caption: 'Where 1 TB of uploaded files ends up (illustrative)',
        columns: ['Copy', 'Size', 'Storage tier', 'Retention'],
        rows: [
          ['Primary heap (TOAST)', '1 TB', 'Provisioned SSD', 'forever'],
          ['WAL archive (PITR)', '1 TB+ per window', 'Object store / disk', '7–35 days'],
          ['2 streaming replicas', '2 TB', 'Provisioned SSD', 'forever'],
          ['Daily snapshots (30)', 'incremental, but grows', 'Backup storage', '30 days'],
          ['Object store alternative', '1 TB billed', 'S3 Standard → IA', 'lifecycle-managed'],
        ],
      },
      diagram: {
        type: 'flow',
        title: 'Upload burst side effects',
        nodes: [
          { label: 'Upload burst', sub: '500 files/min', tone: 'warn' },
          { label: 'WAL volume ↑', sub: 'GB per minute', tone: 'bad' },
          { label: 'Replica lag ↑', sub: 'stale reads everywhere', tone: 'bad' },
          { label: 'Commit p99 ↑', sub: 'all tables', tone: 'bad' },
          { label: 'Failover slower', sub: 'more WAL to replay', tone: 'warn' },
        ],
      },
      insight: 'Managed databases bill storage on every instance; Aurora is an exception (replicas share one cluster volume) — but it still bills I/O and keeps the blob on your most expensive, least elastic tier.',
    },
    {
      title: 'TOAST and InnoDB off-page storage, precisely',
      hook: 'The database does have machinery for big values — and it shows exactly why big values are second-class.',
      body: [
        'In Postgres, a row must fit in an 8 KB page. Values pushing a row past ~2 KB are compressed and/or moved out-of-line into the table’s TOAST relation as ~2 KB chunks with an index on (chunk_id, chunk_seq). A 10 MB file is ~5,000 TOAST rows, each with tuple headers, and every read reassembles them. `SELECT *` on a table with blobs detoasts all of them — a classic accidental 100× slowdown.',
        'Already-compressed media (JPEG, MP4, ZIP) gains nothing from pglz/lz4; set `STORAGE EXTERNAL` to skip the attempt. On updates, Postgres reuses unchanged TOAST pointers, so updating `title` does not rewrite the blob — but deleting rows leaves dead TOAST tuples that only `VACUUM` reclaims, and file space only shrinks with `VACUUM FULL`/`pg_repack` (both rewrite the table).',
        'InnoDB stores large BLOB/TEXT values off-page in 16 KB pages linked from a 20-byte in-row pointer. With `binlog_row_image=FULL` (the default) an update to any column logs the full before and after row images including blobs; `MINIMAL` or `NOBLOB` avoids it.',
      ],
      code: {
        lang: 'sql',
        caption: 'Inspecting and mitigating blob overhead in Postgres',
        code: `-- how big is the hidden TOAST table?
SELECT relname,
       pg_size_pretty(pg_relation_size(oid))             AS heap,
       pg_size_pretty(pg_total_relation_size(oid)
                      - pg_relation_size(oid))           AS toast_and_indexes
FROM pg_class WHERE relname = 'photos';

-- stop wasting CPU compressing JPEGs
ALTER TABLE photos ALTER COLUMN data SET STORAGE EXTERNAL;

-- never SELECT * on blob tables
SELECT id, owner_id, content_type, byte_size FROM photos WHERE owner_id = $1;`,
      },
      insight: 'A table that "looks small" in `\\dt+` can hide terabytes in its TOAST relation. Capacity dashboards that only track heap size miss the real growth.',
    },
    {
      title: 'The read path: buffer pool pollution and pinned app servers',
      hook: 'Serving a gallery from the DB evicts the indexes your checkout query needed.',
      body: [
        'Each download pulls the blob’s pages through the DB’s shared cache and the OS page cache. Large sequential reads push out hot B-tree pages and rows; cache hit ratio drops and unrelated queries start hitting disk. Postgres uses ring buffers only for large sequential scans, VACUUM and bulk writes — not for detoasting individual values fetched by index.',
        'The bytes then travel DB → app → client. The app holds a DB connection (from a small pool) and a worker for the whole transfer to a slow client; the DB connection pool exhausts long before CPU does. There is no CDN, no HTTP range support unless you build it with `substring()`, and no conditional GET unless you add ETags yourself.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Downloading a 20 MB file from a bytea column',
        actors: ['Client', 'App', 'Pool', 'Postgres'],
        messages: [
          { from: 'Client', to: 'App', label: 'GET /files/42' },
          { from: 'App', to: 'Pool', label: 'borrow connection', tone: 'warn' },
          { from: 'App', to: 'Postgres', label: 'SELECT data …' },
          { from: 'Postgres', to: 'App', label: '20 MB (detoast via cache)', dashed: true, tone: 'bad' },
          { from: 'App', to: 'Client', label: 'stream 20 MB at 2 MB/s', tone: 'warn' },
          { from: 'App', to: 'Pool', label: 'return after ~10 s', dashed: true },
        ],
        caption: '20 such downloads exhaust a 20-connection pool for everyone.',
      },
      insight: 'Even if you stream the result in chunks, the DB connection and transaction stay open for the slowest client’s download time, holding back VACUUM’s xmin horizon on Postgres.',
    },
    {
      title: 'The right alternative: object store + metadata row',
      hook: 'Bytes in S3, facts in SQL, and an ordering that makes failures harmless.',
      body: [
        'The DB keeps a row with `object_key`, `byte_size`, `content_type`, `sha256`, `owner_id`, `status`. Clients upload directly with a presigned URL and download through a CDN or a short-lived presigned GET; app servers only sign URLs and write metadata. Permissions move from SQL grants to the API that signs URLs.',
        'Without a distributed transaction, order operations so a crash leaves garbage, never a dangling reference. Either upload first to a unique key and then commit the row, or commit a `pending` row first and flip it to `ready` on the upload-complete event. Deletes: mark the row deleted in the transaction, enqueue the object deletion via an outbox, and let a lifecycle rule or sweeper clean orphans.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Pending-row upload protocol',
        actors: ['Client', 'API', 'DB', 'S3'],
        messages: [
          { from: 'Client', to: 'API', label: 'request upload' },
          { from: 'API', to: 'DB', label: 'INSERT status=pending, key=uuid' },
          { from: 'API', to: 'Client', label: 'presigned PUT', dashed: true },
          { from: 'Client', to: 'S3', label: 'PUT bytes', tone: 'accent' },
          { from: 'S3', to: 'API', label: 'ObjectCreated event', tone: 'info' },
          { from: 'API', to: 'DB', label: 'UPDATE status=ready', tone: 'ok' },
        ],
        caption: 'A sweeper deletes pending rows and orphan objects older than 24 h.',
      },
      code: {
        lang: 'sql',
        caption: 'Metadata row instead of bytes',
        code: `CREATE TABLE files (
  id           uuid PRIMARY KEY,
  owner_id     bigint NOT NULL,
  object_key   text   NOT NULL UNIQUE,   -- e.g. u/42/7f3c9a....jpg
  content_type text   NOT NULL,
  byte_size    bigint NOT NULL,
  sha256       bytea,                     -- 32 bytes: dedupe + integrity
  status       text   NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);`,
      },
      insight: 'Content-addressed keys (`sha256` as the key) give you free dedupe and immutable, forever-cacheable CDN URLs — something a blob column can never offer.',
    },
    {
      title: 'When a blob column IS the right call',
      hook: 'Small, few, transactional — and measured, not assumed.',
      body: [
        'Microsoft Research’s "To BLOB or Not To BLOB" (Sears, van Ingen, Gray, 2006) measured SQL Server vs NTFS: objects under ~256 KB were handled better in the database, over ~1 MB better in the filesystem, with fragmentation over time as the decider in between. SQLite documents that for small blobs (tens of KB) reading from the database file can be faster than separate files, because it avoids per-file open/close overhead.',
        'Reasonable uses: avatars-as-thumbnails in a small internal tool, signature images, small generated PDFs that must commit atomically with an invoice row, encrypted secrets, or an embedded/edge app where SQLite is the only storage. Rules: keep values small (≲ 100 KB), keep them in a separate table (not on the hot row), never `SELECT *`, and have a size cap enforced by a `CHECK (octet_length(data) < …)` constraint.',
      ],
      table: {
        columns: ['Situation', 'Blob column?', 'Why'],
        rows: [
          ['Few thousand files < 100 KB, internal tool', 'OK', 'Simplicity beats a second system'],
          ['Must commit atomically with a financial row', 'OK if small', 'One transaction, one backup'],
          ['User uploads (images, video, docs)', 'No', 'Volume grows unbounded; CDN needed'],
          ['Files > 1 MB', 'No', 'Bytes dominate WAL, cache and backups'],
          ['Embedded app on SQLite', 'Often yes', 'No network, small-blob reads are fast'],
        ],
      },
      insight: 'Even when you choose the column, put it in a side table `file_contents(file_id, data)` so ordinary queries on `files` never touch blob pages and you can later migrate bytes out without changing every query.',
    },
    {
      title: 'Migrating blobs out of a live database',
      hook: 'Moving terabytes out is easy; reclaiming the space on the primary is the hard part.',
      body: [
        'Add `object_key` nullable; backfill in batches (copy bytes to S3 under content-hash keys, set `object_key`), throttled to keep replica lag low. Switch reads to "object if present, else column", then switch writes to object-only, then null out the column in batches and finally drop it.',
        'Nulling values creates dead TOAST tuples; `VACUUM` makes space reusable but does not return it to the OS. To shrink the files, use `pg_repack` (online, needs free space roughly equal to the table) or `VACUUM FULL` (exclusive lock). On managed services, a logical-replication move to a fresh instance can be cleaner.',
      ],
      code: {
        lang: 'sql',
        caption: 'Batched backfill marker (Postgres)',
        code: `-- worker loop: claim a batch of un-migrated rows
SELECT id FROM photos
WHERE object_key IS NULL
ORDER BY id
LIMIT 500
FOR UPDATE SKIP LOCKED;
-- for each: PUT to S3 as sha256 key, then:
UPDATE photos SET object_key = $2 WHERE id = $1 AND object_key IS NULL;`,
      },
      insight: 'Budget the migration in WAL bytes, not rows: nulling 2 TB of blobs and repacking generates large WAL and replication load, so run it with replica-lag-aware throttling.',
    },
  ],

  scaling: {
    body: [
      'A blob column cannot scale independently: file capacity, throughput and durability are welded to the primary database, whose write path is the hardest thing in your stack to scale. More files means a bigger instance, bigger replicas and longer backups, all priced as premium SSD.',
      'Splitting bytes (object store, effectively unlimited, CDN in front) from metadata (DB, small rows) lets each scale on its own curve: the DB grows with the number of files (≈200 bytes each), not with their size.',
    ],
    bullets: [
      'DB storage grows with total bytes; with object storage it grows with file count only.',
      'Replica count multiplies blob storage on most managed DBs (Aurora shares storage).',
      'Backup/restore time scales with blob volume; RTO quietly degrades month by month.',
      'Connection pool, not CPU, is the first limit for blob downloads.',
      'Sharding a blob-heavy DB moves terabytes; sharding a metadata DB moves gigabytes.',
    ],
    diagram: {
      type: 'compare',
      title: 'Growth curves at 10M files of 2 MB',
      columns: [
        { name: 'Blob column', points: ['20 TB on primary', '× replicas on SSD', 'Backups ~20 TB each', 'Restore: many hours'], tone: 'bad' },
        { name: 'Object store + rows', points: ['~2 GB of metadata rows', '20 TB in S3 (tiered)', 'DB backup minutes', 'CDN for reads'], tone: 'ok' },
      ],
    },
  },

  failures: [
    {
      name: 'Replica lag during upload bursts',
      symptom: 'Users see stale data on replica reads after marketing campaigns that drive uploads.',
      detect: '`pg_stat_replication` replay lag / `Seconds_Behind_Source`, WAL bytes/s per table via `pg_stat_statements` (`wal_bytes`).',
      mitigate: 'Move bytes to object storage; meanwhile throttle upload concurrency and route critical reads to primary.',
    },
    {
      name: 'Backup and restore window blown',
      symptom: 'Nightly backups overrun; a restore drill takes 14 hours against a 1-hour RTO.',
      detect: 'Backup duration trend, DB size vs TOAST size, periodic timed restore drills.',
      mitigate: 'Externalize blobs; protect them with versioning + cross-account replication instead.',
    },
    {
      name: 'Connection pool exhaustion',
      symptom: 'API timeouts everywhere while DB CPU is low; pool wait time spikes during downloads.',
      detect: 'Pool wait time / active connections (HikariCP `pending`, PgBouncer `cl_waiting`), slow queries returning large bytea.',
      mitigate: 'Presigned GETs + CDN; never stream files through a pooled DB connection.',
    },
    {
      name: 'CDC / logical replication breaks',
      symptom: 'Debezium connector fails on large messages or emits placeholder values for unchanged TOAST columns.',
      detect: 'Connector task failures, Kafka `RecordTooLargeException`, unavailable-value placeholders in events.',
      mitigate: 'Exclude blob columns from CDC; store keys, not bytes.',
    },
    {
      name: 'Hidden table bloat',
      symptom: 'Disk usage climbs although rows are deleted; table looks small in dashboards.',
      detect: '`pg_total_relation_size` vs `pg_relation_size`, dead tuples in TOAST, autovacuum lag.',
      mitigate: 'Tune autovacuum, `pg_repack` during migration, separate blob table, then move bytes out.',
    },
  ],

  warStories: [
    {
      title: 'Profile photos held the restore hostage',
      source: 'Composite of common incidents',
      what: 'A SaaS stored user avatars and attachments in a `bytea` column. Five years in, the 40 GB of business data sat next to 3 TB of TOAST. A storage failure forced a restore from backup; it took most of a day, while the team realized the actual business data could have been restored in under an hour.',
      lesson: 'RTO is driven by your largest, least important data. Keep media out so the database’s recovery story stays fast.',
    },
    {
      title: 'Binlog explosion from a status update',
      source: 'Composite of common incidents (MySQL)',
      what: 'A MySQL table held document PDFs alongside a `status` column. A nightly job updated `status` on a million rows; with `binlog_row_image=FULL` every update logged the full before and after image including the PDFs. Binlog volume hit hundreds of GB, replicas fell hours behind and the disk filled.',
      lesson: 'Blobs make innocent updates expensive. If you must keep them, isolate them in their own table and consider `binlog_row_image=MINIMAL`/`NOBLOB`.',
    },
    {
      title: 'The research that drew the line',
      source: 'Sears, van Ingen, Gray — "To BLOB or Not To BLOB", Microsoft Research 2006',
      what: 'Measuring SQL Server against NTFS over long-running workloads, the authors found the database better for objects under ~256 KB and the filesystem better above ~1 MB, with fragmentation as objects were replaced being a major factor.',
      lesson: 'The answer depends on object size and churn; for user-generated media, which is large and unbounded, the bytes belong outside the database.',
    },
  ],

  numbers: [
    { label: 'Postgres page / TOAST threshold', value: '8 KB / ~2 KB', note: 'chunks ~2 KB each' },
    { label: '10 MB file in TOAST', value: '~5,000 chunk rows' },
    { label: 'bytea max', value: '1 GB', note: 'large objects up to 4 TB' },
    { label: 'MySQL max_allowed_packet', value: '64 MB default (8.0)' },
    { label: 'InnoDB page', value: '16 KB', note: '20-byte off-page pointer' },
    { label: 'Managed DB SSD', value: '~$0.10–0.23/GB-month', note: 'per instance on most engines' },
    { label: 'S3 Standard', value: '~$0.023/GB-month', note: 'IA ~$0.0125' },
    { label: 'Kafka default max message', value: '~1 MB', note: 'CDC of blobs breaks' },
    { label: 'DB-vs-filesystem crossover', value: '~256 KB–1 MB', note: '"To BLOB or Not To BLOB"' },
  ],

  capacity: {
    question: 'A document app stores 200k uploads/day averaging 1.5 MB in a `bytea` column with one primary and two replicas. What does a year cost in DB terms versus S3?',
    steps: [
      'Volume: 200k × 1.5 MB = 300 GB/day ≈ 110 TB/year of raw bytes.',
      'DB storage: 110 TB × 3 instances = 330 TB of provisioned SSD; at ~$0.115/GB-month ≈ $38k/month by year end (before IOPS, WAL archive, snapshots).',
      'WAL: ≥300 GB/day of WAL to archive and replicate (~3.5 MB/s average, peaks 10×) competing with all transactions.',
      'S3 alternative: 110 TB at $0.023 ≈ $2.5k/month, ~$1.4k with IA after 30 days; DB keeps 73M metadata rows × ~200 B ≈ 15 GB.',
      'Restore: a 110 TB DB restore at ~500 MB/s ≈ 61 hours vs ~15 GB metadata in minutes.',
    ],
    answer: 'Roughly 15–25× cheaper storage with S3, a DB that stays ~15 GB instead of 110 TB+, and an RTO measured in minutes instead of days.',
  },

  comparison: {
    caption: 'Where to keep file bytes',
    columns: ['Option', 'Transactional with row', 'Cost / GB', 'Read path', 'Fits'],
    rows: [
      ['bytea / BLOB column', 'Yes', 'DB SSD × replicas', 'DB → app → client', 'Tiny, few, must be atomic'],
      ['Postgres large objects', 'Yes (OID only)', 'DB SSD × replicas', 'Stream API via app', 'Rarely; legacy'],
      ['SQL Server FILESTREAM', 'Yes', 'Server disk', 'Win32 streaming / app', 'SQL Server shops, medium files'],
      ['Object store + metadata row', 'No (ordered writes)', '~$0.023 → $0.001', 'Client ↔ S3 / CDN', 'Default for user files'],
      ['Shared filesystem (NFS)', 'No', 'File server', 'App reads mount', 'Legacy only (see nfs)'],
    ],
  },

  whenNot: [
    'User-generated media (images, video, documents) — unbounded volume; use object storage + CDN.',
    'Anything over ~1 MB, or anything that will be downloaded frequently by end users.',
    'Databases with CDC/logical replication feeding Kafka — blobs break message size limits.',
    'Systems with a tight RTO — backup and restore time will be dominated by files.',
    'Large files needing range requests, resumable uploads or streaming playback.',
  ],

  interview: [
    {
      q: 'A reviewer sees `photos.bytes BYTEA` in your design. Defend or fix it.',
      a: 'Fix it: user photos are large, unbounded and read-heavy. In the DB they inflate WAL, replicas, CDC and backups, pollute the buffer pool, and every byte streams through app servers holding pooled connections. Instead store them in S3 with a metadata row (key, size, type, hash, owner, status), upload via presigned PUT, serve via CDN or presigned GET. Consistency comes from ordering: pending row → upload → event flips to ready, with a sweeper for orphans.',
      followUps: ['How do you enforce that only the owner can download?', 'What happens if the upload succeeds but the event is lost?', 'How do you delete a photo safely?'],
      seniorSignal: 'Names the specific DB subsystems that suffer and replaces the transaction with an ordered protocol plus reconciliation.',
    },
    {
      q: 'Without a distributed transaction, how do you keep the DB row and the S3 object consistent?',
      a: 'Order writes so failure leaves only garbage. Option one: upload to a unique key, then insert the row; a crash leaves an orphan object, cleaned by a lifecycle rule on a temporary prefix. Option two: insert a pending row, upload, and mark ready on the S3 event or client confirmation; a reconciler HEADs objects for stale pending rows. Deletes go through an outbox: mark deleted in the transaction, delete the object asynchronously.',
      followUps: ['Which option fits direct browser uploads?', 'How do you make the event handler idempotent?'],
      seniorSignal: 'Thinks in failure orderings and reconciliation instead of reaching for 2PC.',
    },
    {
      q: 'When is storing blobs in the database actually fine?',
      a: 'When objects are small (tens of KB), few, rarely read by end users, and benefit from atomicity with a row — signatures, small generated documents tied to an invoice, encrypted secrets, or embedded SQLite apps. Microsoft Research found databases competitive below ~256 KB. Even then, isolate them in a side table, cap sizes with a constraint, never `SELECT *`, and watch TOAST size.',
      followUps: ['Why a side table rather than a column on the main row?', 'How would you migrate out later?'],
      seniorSignal: 'Gives size/volume thresholds and containment practices rather than a dogmatic "never".',
    },
    {
      q: 'Your Postgres replicas lag every afternoon. You find a `bytea` attachments table. Explain the mechanism.',
      a: 'Every attachment insert writes its full size into WAL, which streaming replicas must receive and replay serially. Afternoon upload peaks generate WAL faster than replicas can apply it, so lag rises for every table, not just attachments. Confirm with `pg_stat_statements.wal_bytes` by query and replication lag graphs. Short term throttle uploads or read critical paths from the primary; long term move bytes to object storage.',
      followUps: ['Why doesn’t adding replicas help?', 'What does this do to failover time?'],
      seniorSignal: 'Connects WAL volume to replica replay and failover, and proves it with WAL-per-query metrics.',
    },
    {
      q: 'You have 4 TB of blobs in a production table. Plan the migration to S3.',
      a: 'Add a nullable `object_key`; backfill in batches with `FOR UPDATE SKIP LOCKED` workers that upload under content-hash keys and set the key, throttled on replica lag. Switch reads to prefer the object, then writes to object-only, verify checksums, null the column in batches and drop it. Reclaim disk with `pg_repack` or a logical-replication move to a new instance, since VACUUM does not shrink files.',
      followUps: ['How do you verify nothing was lost?', 'How do you roll back mid-migration?'],
      seniorSignal: 'Plans dual-read, throttling by replica lag and the space-reclamation step most people forget.',
    },
  ],

  takeaways: [
    'Every blob byte is logged, cached, replicated, CDC’d and backed up — 6–10 copies on premium storage.',
    'TOAST/off-page storage exists, but compression is wasted on media and `SELECT *` detoasts everything.',
    'Downloads through the DB pin pooled connections and app workers for the slowest client.',
    'Bytes in object storage, metadata row in SQL, ordered writes + reconciler instead of a transaction.',
    'Fine for small (≲100 KB), few, transactional values — in a side table with a size constraint.',
    'Migrating out is easy; reclaiming space needs `pg_repack` or a fresh instance.',
  ],
};

export default deep;
