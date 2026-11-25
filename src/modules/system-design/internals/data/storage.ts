import type { Internals } from '../types';

const OBJECT_STORE: Internals = {
  kind: 'object-store',
  summary:
    'Object storage is a giant key → bytes map. A stateless API fleet authenticates the request, a strongly consistent **metadata index** maps `bucket/key` to where the bytes live, and the bytes themselves are erasure-coded across thousands of storage nodes in several availability zones. Objects are immutable: you replace them whole, never edit in place.',
  parts: [
    { id: 'frontend', name: 'API front-end', role: 'Stateless HTTP fleet terminating every request', detail: 'Thousands of identical web servers behind DNS round-robin and LBs speak the S3 REST API (`PUT`, `GET`, `LIST`, multipart). They hold no data, so any node can serve any request.' },
    { id: 'auth', name: 'Auth & signing', role: 'Verifies SigV4 signature, policy and expiry', detail: 'Recomputes the **HMAC-SHA256 SigV4** signature over method, path, headers and `X-Amz-Expires` using the caller’s secret, then evaluates IAM + bucket policies. A **presigned URL** is just this signature baked into the query string, so a browser can upload without your servers in the path.' },
    { id: 'coder', name: 'Erasure coder', role: 'Splits bytes into data + parity shards', detail: 'Reed–Solomon style coding turns a chunk into k data + m parity shards (e.g. **6+3**): any 6 of 9 rebuild the chunk, so it survives 3 lost disks at **1.5×** overhead instead of 3× for triple replication. Small objects may simply be replicated.' },
    { id: 'storage', name: 'Storage nodes', role: 'Persist shards on disks across AZs', detail: 'Dense JBOD servers (tens of HDDs each) run a local key-value store for shards (S3’s **ShardStore**, written in Rust). Shards of one chunk are placed on different disks, hosts, racks and **≥3 AZs**, with checksums stored alongside.' },
    { id: 'index', name: 'Metadata index', role: 'Maps bucket+key+version to shard locations', detail: 'A partitioned, replicated key-value index keyed by `bucket/key` (range-partitioned, auto-splitting hot prefixes). The object only becomes visible when its record commits here — the commit point that gives **strong read-after-write** consistency (S3 since Dec 2020).' },
    { id: 'lifecycle', name: 'Scrubber & lifecycle', role: 'Repairs shards, tiers and expires objects', detail: 'Background workers re-read checksums, rebuild shards from lost disks within hours (fast repair is what makes the durability math work) and apply lifecycle rules: move to Infrequent Access / Glacier, expire versions, abort stale multipart uploads.' },
  ],
  flow: [
    { part: 'frontend', title: 'Upload hits the API fleet', text: 'The browser `PUT`s a 4 GB video straight to the bucket using a presigned URL your backend minted — your app servers never see the bytes. Large files use **multipart upload**: up to 10,000 parts of 5 MB–5 GB, uploaded in parallel and retried individually.' },
    { part: 'auth', title: 'Signature checked', text: 'The front-end recomputes the SigV4 HMAC for `PUT /videos/u42/raw.mp4` and checks the 15-minute expiry. A tampered key, method or expired URL fails with `403` — the URL grants exactly one operation on one key.' },
    { part: 'coder', title: 'Bytes erasure-coded', text: 'Each part is checksummed and split into 6 data + 3 parity shards. Storing 1 GB costs 1.5 GB of raw disk instead of 3 GB, which is a big reason object storage is ~$0.023/GB-month.' },
    { part: 'storage', title: 'Shards spread across AZs', text: 'The 9 shards land on 9 different hosts across 3 AZs. The write is acknowledged only after enough shards are durably on disk to survive the loss of a whole AZ.' },
    { part: 'index', title: 'Metadata committed = visible', text: '`CompleteMultipartUpload` writes one index record: key, version id, size, ETag, shard map. From this moment every `GET` or `LIST` anywhere sees the new object; before it, no reader sees a partial file.' },
    { part: 'frontend', title: 'Read path', text: 'A `GET` looks up the index, fetches any 6 healthy shards in parallel and decodes. First-byte latency is typically **10–100 ms** — fine for media behind a CDN, too slow for per-request hot data.' },
    { part: 'lifecycle', title: 'Repair and tiering', text: 'A disk dies; the scrubber notices missing shards and rebuilds them from the surviving 8 onto new disks. After 30 days a lifecycle rule moves the raw video to a colder class, cutting cost ~5×.' },
  ],
  knobs: [
    {
      name: 'Redundancy scheme',
      options: [
        { label: '3× replication', effect: '3.0× storage overhead; reads hit one copy, repair is a simple copy. Survives 2 losses.', when: 'Small/hot objects, metadata, low-latency tiers.' },
        { label: 'Erasure coding (e.g. 6+3)', effect: '1.5× overhead, survives 3 losses, but reads/repairs touch several nodes and cost CPU.', when: 'Bulk capacity: the default for large objects at S3/GCS/Azure scale.' },
      ],
    },
    {
      name: 'Upload path',
      options: [
        { label: 'Through app servers', effect: 'Every byte crosses your fleet twice: threads, memory and bandwidth burned on proxying.', when: 'Only for tiny files that need server-side processing first.' },
        { label: 'Presigned URL (direct)', effect: 'Client talks to the store directly; your API only signs a short-lived URL and records metadata.', when: 'Default for user uploads and downloads.' },
        { label: 'Multipart + presigned parts', effect: 'Parallel, resumable uploads; a failed part is retried alone.', when: 'Files > ~100 MB, flaky mobile networks.' },
      ],
    },
    {
      name: 'Storage class',
      options: [
        { label: 'Standard', effect: 'ms access, highest $/GB (~$0.023).', when: 'Hot and recently uploaded data.' },
        { label: 'Infrequent Access', effect: '~half the storage price, but per-GB retrieval fee and 30-day minimum.', when: 'Backups and media read a few times a month.' },
        { label: 'Glacier / Deep Archive', effect: '~$0.001/GB-month; restores take minutes to 12 h.', when: 'Compliance archives, raw footage you hope never to read.' },
      ],
    },
  ],
  implementations: [
    { name: 'Amazon S3', how: 'Front-end fleet + partitioned metadata index + ShardStore storage nodes, erasure-coded across ≥3 AZs. Strong read-after-write consistency since 2020 via a replicated witness that tracks the latest index version per key. Holds hundreds of trillions of objects.' },
    { name: 'Google Cloud Storage', how: 'Object metadata lives in **Spanner** (hence strongly consistent listing) and bytes in **Colossus**, Google’s distributed filesystem with Reed–Solomon encoding.' },
    { name: 'Azure Blob Storage', how: 'Stream layer of extent nodes with **Local Reconstruction Codes** (LRC), which rebuild a lost fragment from a small local group instead of reading all fragments.' },
    { name: 'MinIO / Ceph RGW', how: 'Self-hosted S3 APIs. MinIO erasure-codes each object across an erasure set and stores metadata in `xl.meta` next to the shards (no central DB); Ceph places objects with the **CRUSH** hash instead of a lookup table.' },
  ],
  ha: 'Every layer is redundant and independently scaled: the API fleet is stateless, the metadata index is range-partitioned and replicated (hot key prefixes split automatically), and shards are spread across ≥3 AZs so a full AZ loss loses no data and only some capacity. Durability comes from math plus fast repair: with 6+3 coding, data is lost only if 4 of 9 specific disks die within one repair window.',
  failureModes: [
    { name: 'Hot prefix throttling', symptom: '`503 SlowDown` when one key prefix exceeds ~3,500 writes or 5,500 reads per second.', fix: 'Spread keys across prefixes (hash prefix), let S3 re-partition, retry with jittered backoff.' },
    { name: 'Serving hot objects directly', symptom: 'High egress bill and 50–100 ms first-byte latency for every image view.', fix: 'Put a CDN in front; long `Cache-Control` with content-hashed keys.' },
    { name: 'Leaked or over-broad presigned URLs', symptom: 'Anyone with the link can download or overwrite a file for days.', fix: 'Short expiry (minutes), sign one method + key, enforce content-type/length conditions, private buckets.' },
    { name: 'Using LIST as a database', symptom: 'Listing millions of keys page by page (1,000 per call) is slow and costly.', fix: 'Keep metadata (owner, size, status) in your DB; use S3 Inventory for bulk audits.' },
  ],
  numbers: ['Durability 99.999999999% (11 nines): store 10M objects, expect to lose one every ~10,000 years', 'Single PUT ≤ 5 GB, object ≤ 5 TB, multipart ≤ 10,000 parts', '~3,500 PUT / 5,500 GET per second per prefix', 'First byte 10–100 ms; Standard ~$0.023/GB-month, Deep Archive ~$0.001'],
  interview: [
    { q: 'How do users upload a 2 GB video without overloading your API servers?', a: 'The API authenticates the user and returns presigned multipart URLs (SigV4, minutes of expiry, one key). The client uploads parts in parallel directly to the store, then calls complete. An upload-finished event (S3 notification → queue) triggers transcoding, and the DB stores only the key and metadata.' },
    { q: 'Why does erasure coding give 11 nines cheaper than replication?', a: 'With k+m coding you survive m failures at (k+m)/k overhead: 6+3 survives 3 losses at 1.5×, while replication needs 4 copies (4×) to survive 3. Durability depends on losing more than m shards before repair completes, so fast background repair across independent failure domains (AZs) is as important as the code itself.' },
    { q: 'Object store vs a filesystem — what do you give up?', a: 'No in-place edits, appends, renames or POSIX locks; listing is slow and paginated; latency is tens of ms. In return you get near-infinite capacity, 11 nines durability, HTTP access and pay-per-GB pricing. It fits immutable blobs (media, backups, logs), not databases or scratch files.' },
  ],
};

const SEARCH: Internals = {
  kind: 'search',
  summary:
    'A search engine turns documents into an **inverted index**: for every term, a sorted list of the documents containing it. Text is normalized by an analyzer, buffered and flushed into immutable segments, and queries are scattered to every shard, scored with BM25 and gathered into a global top-k. It is a derived, near-real-time copy of your data, not the source of truth.',
  parts: [
    { id: 'coord', name: 'Coordinating node', role: 'Routes documents, scatters and gathers queries', detail: 'Any node can coordinate. Documents go to shard `hash(_routing) % num_primary_shards` (which is why the primary shard count is fixed at index creation); queries fan out to one copy of every shard.' },
    { id: 'analyzer', name: 'Analyzer', role: 'Turns text into normalized terms', detail: 'Char filters (strip HTML) → **tokenizer** (split on word boundaries) → token filters (lowercase, stop words, **stemming** `running → run`, synonyms, ASCII folding). The same analyzer must run at index and query time or terms won’t match.' },
    { id: 'buffer', name: 'Buffer + translog', role: 'Accepts writes durably before indexing', detail: 'New docs go into an in-memory indexing buffer and are appended to the **translog** (fsynced per request by default), so an acked write survives a crash even before it is in a segment. The primary forwards the op to its replicas before acking.' },
    { id: 'segment', name: 'Immutable segments', role: 'On-disk inverted index, searchable after refresh', detail: 'A **refresh** (every 1 s by default) turns the buffer into a new Lucene segment: a term dictionary (an FST) pointing to **postings lists** of doc ids, frequencies and positions, plus doc values for sorting/aggregations. Segments are never modified; deletes are just bitmap marks.' },
    { id: 'merge', name: 'Segment merger', role: 'Compacts small segments, purges deletes', detail: 'A tiered merge policy continuously merges many small segments into bigger ones in the background, dropping deleted docs. Fewer segments = fewer files to search per query, at the cost of disk I/O.' },
    { id: 'scorer', name: 'Query & scorer', role: 'Walks postings and ranks by BM25', detail: 'Intersects/unions postings lists (skipping with skip lists / WAND), scores each match with **BM25** (term frequency, inverse document frequency, length normalization) and keeps a top-k heap per shard.' },
  ],
  flow: [
    { part: 'coord', title: 'Document routed', text: '`PUT /products/_doc/42` arrives; the coordinator computes `hash(42) % 5 = 3` and forwards it to the primary of shard 3.' },
    { part: 'analyzer', title: 'Text analyzed', text: '"Running Shoes for Men" becomes terms `[run, shoe, men]`: lowercased, stop word "for" removed, Porter-stemmed. These are the only things the index will ever know about the title.' },
    { part: 'buffer', title: 'Buffered and logged', text: 'The doc is added to the in-memory buffer and appended to the translog, then replicated to shard 3’s replicas, and the client gets `201`. It is durable but **not searchable yet**.' },
    { part: 'segment', title: 'Refresh makes it visible', text: 'Within ~1 s a refresh writes a new segment where `shoe → [3, 17, 42, …]`. This is why Elasticsearch is **near-real-time**: a search issued immediately after the write may miss it.' },
    { part: 'merge', title: 'Background merge', text: 'Dozens of tiny 1-second segments are merged into larger ones; documents updated since (an update = delete + reinsert) are physically dropped.' },
    { part: 'coord', title: 'Query scattered', text: 'A search for "running shoe" is analyzed with the same analyzer into `[run, shoe]` and sent to one copy (primary or replica) of each of the 5 shards in parallel.' },
    { part: 'scorer', title: 'Score, then gather top-k', text: 'Each shard intersects the `run` and `shoe` postings, ranks with BM25 (a rare term weighs more than a common one) and returns its top 10 ids + scores. The coordinator merges 5×10 candidates into the global top 10, then fetches only those 10 documents.' },
  ],
  knobs: [
    {
      name: 'Refresh interval',
      options: [
        { label: '1 s (default)', effect: 'New docs searchable in ~1 s; many tiny segments and more merge work.', when: 'User-facing search where freshness matters.' },
        { label: '30 s or -1 (off)', effect: 'Much higher indexing throughput, staler results.', when: 'Bulk loads and reindexing, log analytics.' },
      ],
    },
    {
      name: 'Shard count',
      options: [
        { label: 'Few large shards', effect: 'Less per-query fan-out overhead, but slow recovery/rebalance and a hard ceiling on parallelism.', when: 'Small or slowly growing indexes.' },
        { label: 'Many small shards', effect: 'More parallelism, but each shard costs heap and threads; thousands of tiny shards hurt the cluster.', when: 'Rarely — aim for ~10–50 GB per shard, use time-based indexes for logs.' },
      ],
    },
    {
      name: 'Analyzer',
      options: [
        { label: 'Standard + stemming', effect: 'Matches word variants (`runs`, `running`); loses exactness.', when: 'Natural-language text: titles, descriptions.' },
        { label: 'Edge n-grams', effect: 'Indexes prefixes (`sh`, `sho`, `shoe`) for instant autocomplete; index grows several ×.', when: 'Search-as-you-type boxes.' },
        { label: 'Keyword (no analysis)', effect: 'Exact match only, enables terms aggregations.', when: 'IDs, tags, status fields, facets.' },
      ],
    },
  ],
  implementations: [
    { name: 'Apache Lucene', how: 'The Java library underneath Elasticsearch, OpenSearch and Solr: analyzers, segment files, FST term dictionaries, compressed postings, BM25 similarity and the merge policy all live here.' },
    { name: 'Elasticsearch / OpenSearch', how: 'Distribute Lucene: an index = N primary shards (each a Lucene index) + replicas, a master-elected cluster state, translog for durability, and the scatter-gather query/fetch protocol.' },
    { name: 'Apache Solr', how: 'Also Lucene-based; SolrCloud uses ZooKeeper for cluster state and leader election per shard.' },
    { name: 'Algolia / Typesense / Meilisearch', how: 'Product-search engines optimized for typo tolerance and instant results; indexes held largely in memory with prefix-oriented data structures, trading flexibility for latency.' },
  ],
  ha: 'Each shard has ≥1 replica on a different node (zone-aware allocation); if a node dies, a replica is promoted and new replicas are rebuilt elsewhere. Replicas also serve reads, so adding replicas scales query throughput while adding primaries (at index creation or via reindex) scales indexing and data size. Dedicated master-eligible nodes (3) keep the cluster state with quorum-based election.',
  failureModes: [
    { name: 'Dual-write drift', symptom: 'The app writes the DB and then the index; a crash or failed request leaves them permanently different.', fix: 'Index from the DB’s change stream (CDC/outbox → queue → indexer) and support full reindex.' },
    { name: 'Deep pagination', symptom: '`from: 10000, size: 10` makes every shard build a 10,010-entry heap; latency and memory blow up.', fix: 'Use `search_after` cursors; cap page depth in the UI.' },
    { name: 'Mapping explosion', symptom: 'Dynamic mapping turns arbitrary JSON keys into thousands of fields; cluster state and heap balloon.', fix: 'Strict mappings, `flattened` fields for free-form data.' },
    { name: 'Oversharding / hot shard', symptom: 'Thousands of tiny shards exhaust heap, or one routing key puts most traffic on one shard.', fix: 'Size shards 10–50 GB, rollover/ILM for time series, avoid skewed custom routing.' },
  ],
  numbers: ['Refresh 1 s ⇒ ~1 s write-to-search lag', 'Target 10–50 GB per shard', 'Typical query 5–50 ms', 'Heap ≤ ~31 GB (compressed pointers); leave the rest of RAM to the OS page cache', 'BM25 defaults k1 = 1.2, b = 0.75'],
  interview: [
    { q: 'Walk through how a full-text query for "running shoes" is answered.', a: 'The coordinator analyzes the query into `[run, shoe]` and scatters it to one copy of each shard. Each shard looks up both terms in its term dictionary, walks the postings lists, scores matches with BM25 and returns its top-k. The coordinator merges the per-shard top-k into a global top-k and fetches those documents.' },
    { q: 'How do you keep the search index in sync with the database?', a: 'Never dual-write from request handlers. Treat the DB as the source of truth and stream its changes (Debezium CDC or a transactional outbox) through Kafka to an indexer that upserts by document id with an external version, so replays and out-of-order events are safe. Keep a full reindex path into a new index plus an alias swap.' },
    { q: 'Why is Elasticsearch "near real-time" and what is the translog for?', a: 'Docs become searchable only when a refresh turns the in-memory buffer into a segment (every ~1 s), because building segments per document would be too expensive. Durability is separate: the translog is fsynced on each request so acknowledged writes survive a crash and are replayed on restart.' },
  ],
  lab: 'inverted',
};

const SQL_LIKE: Internals = {
  kind: 'sql-like',
  summary:
    "`WHERE title LIKE '%shoe%'` looks like search but is a brute-force substring scan. A B-tree index is sorted by the value’s prefix, so a leading wildcard gives the planner no starting point: it reads every row, runs a substring match on each, and returns unranked results. It works on 10k rows and melts a primary at 10M.",
  parts: [
    { id: 'planner', name: 'Query planner', role: 'Chooses index scan or full scan', detail: "Parses `SELECT … WHERE title ILIKE '%shoe%'` and costs the options. With a leading `%` no B-tree predicate is usable, so it picks a **Seq Scan** (Postgres) / `type: ALL` (MySQL `EXPLAIN`)." },
    { id: 'btree', name: 'B-tree index', role: 'Sorted by prefix — useless here', detail: "A B-tree can seek to a prefix range: `LIKE 'shoe%'` becomes `title >= 'shoe' AND title < 'shof'` (needs C collation or `text_pattern_ops`). A substring can start anywhere, so there is no range to seek." },
    { id: 'scan', name: 'Sequential scan', role: 'Reads every page of the table', detail: 'Walks all heap pages (8 KB in Postgres, 16 KB in InnoDB). A 10M-row, 3 GB table means 3 GB of I/O and memory bandwidth per search, regardless of how few rows match.' },
    { id: 'pool', name: 'Buffer pool', role: 'Caches pages; churned by scans', detail: 'Large scans compete with the OLTP working set for cache and I/O. Postgres limits damage with a small ring buffer for big seq scans, InnoDB with midpoint insertion — but disk and CPU are still saturated.' },
    { id: 'matcher', name: 'Pattern matcher', role: 'Runs substring match on each row', detail: 'A per-row byte/character comparison (`ILIKE`/`LOWER()` adds case folding cost). No tokenizing, no stemming, no synonyms, no typo tolerance: `%running%` does not match "run", `%shoes%` does not match "shoe".' },
    { id: 'result', name: 'Unranked result', role: 'Returns matches with no relevance', detail: 'SQL has no notion of relevance, so results come back in arbitrary or `ORDER BY created_at` order. `LIMIT 20` only stops early if 20 matches are found quickly; rare terms still scan the whole table.' },
  ],
  flow: [
    { part: 'planner', title: 'Query planned', text: "A user types \"shoe\"; the app runs `SELECT * FROM products WHERE title ILIKE '%shoe%' LIMIT 20` on the primary." },
    { part: 'btree', title: 'Index rejected', text: 'The `products(title)` B-tree is sorted alphabetically. "Contains shoe" could be anywhere in the string, so the planner cannot seek and falls back to scanning.' },
    { part: 'scan', title: 'Full table scan', text: 'All 10M rows (~3 GB) are read. Even from cache that is ~1–3 s of one core; from disk it is worse. `EXPLAIN` shows `Seq Scan on products`.' },
    { part: 'pool', title: 'Working set squeezed', text: 'Fifty users searching at once means fifty concurrent scans: I/O and CPU saturate and ordinary checkout queries on the same primary start timing out.' },
    { part: 'matcher', title: 'Naive matching', text: '"Running shoes" fails to match "run shoe", and "sheo" (typo) matches nothing. Meanwhile `%shoe%` happily matches "horseshoe".' },
    { part: 'result', title: 'Unranked output', text: 'The 20 rows returned are whichever matched first, not the best ones. To rank you’d have to fetch all matches and score them in the app.' },
  ],
  knobs: [
    {
      name: 'Search approach',
      options: [
        { label: "LIKE '%q%'", effect: 'Full scan per query; O(rows) latency; no ranking.', when: 'Admin tools on tables < ~100k rows.' },
        { label: 'pg_trgm GIN index', effect: 'Indexes 3-letter grams; `%shoe%` becomes a bitmap index scan + recheck. Fast substring and similarity matching, but no stemming or real relevance; index ~2–3× the text size and slower writes.', when: 'Fuzzy name/email lookup inside Postgres.' },
        { label: 'Postgres FTS (tsvector + GIN)', effect: 'Real tokenizing, stemming and `ts_rank`; good enough for modest corpora, all in one DB.', when: 'Small/medium search features without new infrastructure.' },
        { label: 'Search engine (Elasticsearch)', effect: 'Inverted index, BM25, typo tolerance, facets, horizontal scale; extra system to keep in sync.', when: 'Any real product search.' },
      ],
    },
    {
      name: 'Where the query runs',
      options: [
        { label: 'Primary', effect: 'Every scan competes with writes and transactions.', when: 'Never for search-like workloads.' },
        { label: 'Read replica', effect: 'Protects the primary but still slow; replica lag grows under scan load.', when: 'A stopgap while building proper search.' },
      ],
    },
  ],
  implementations: [
    { name: 'PostgreSQL LIKE / ILIKE', how: 'Without a special index: Seq Scan plus per-row pattern match. Prefix patterns can use a B-tree with `text_pattern_ops`.' },
    { name: 'PostgreSQL pg_trgm', how: 'Breaks text into trigrams (`"shoe"` → `"  s"," sh","sho","hoe","oe "`) stored in a GIN index; the query’s trigrams are intersected, then candidate rows are rechecked against the real pattern.' },
    { name: 'MySQL InnoDB FULLTEXT', how: 'A built-in inverted index (`MATCH … AGAINST`) with auxiliary index tables; basic relevance, limited language support.' },
    { name: 'The fix: CDC → Elasticsearch', how: 'Debezium streams row changes from the WAL/binlog to Kafka, an indexer updates Elasticsearch, and search queries never touch the primary.' },
  ],
  ha: 'There is nothing to scale: the cost is O(table size) per query, so more traffic or more rows means proportionally more scanning on the same database. Read replicas only spread the pain. The scalable answer is to move search into a dedicated, horizontally sharded inverted index fed asynchronously from the DB.',
  failureModes: [
    { name: 'Primary meltdown', symptom: 'Search traffic spikes; CPU and I/O hit 100%, checkout and login queries time out.', fix: 'Move search off the primary to a search engine fed by CDC.' },
    { name: 'Latency grows with the table', symptom: 'Fast in staging (10k rows), 2–5 s in production (10M rows).', fix: 'Test with production-size data; `EXPLAIN` every search query.' },
    { name: 'Poor relevance', symptom: 'Users get "horseshoe" first, nothing for plurals or typos.', fix: 'Analyzers with stemming, BM25 ranking, fuzzy matching — i.e. a real inverted index.' },
  ],
  numbers: ['Seq scan ≈ 1–3 GB/s per core from memory, much less from disk', '10M rows × 300 B ≈ 3 GB read per query', 'Trigram GIN index ≈ 2–3× indexed text size'],
  interview: [
    { q: "Why can't the database use an index for LIKE '%term%'?", a: 'A B-tree orders values by their leading characters, so it can answer prefix ranges. A substring may start at any position, so there is no contiguous range to seek; the planner must read every row. Trigram (GIN) indexes help by indexing all 3-character substrings, but they still provide no relevance.' },
    { q: 'When is LIKE acceptable, and how would you migrate away?', a: 'Acceptable for small tables or internal admin screens with low QPS. To migrate: add an inverted index (Postgres FTS for modest needs, Elasticsearch for real search), feed it from CDC, backfill with a bulk reindex, then switch reads behind a feature flag.' },
  ],
  lab: 'inverted',
};

const BLOB_COLUMN: Internals = {
  kind: 'blob-column',
  summary:
    'Putting files in a `BYTEA`/`BLOB` column makes the database carry bytes it was never designed for. Every upload streams through an app server, is written to the WAL, chunked into off-page storage, shipped to every replica and copied into every backup. The fix is boring and universal: bytes in object storage, a small metadata row in the DB.',
  parts: [
    { id: 'app', name: 'App server', role: 'Buffers and proxies the whole file', detail: 'The upload must pass through your API process (often fully in memory) to become an `INSERT` parameter; downloads come back the same way. A 50 MB file ties up a worker thread and 50+ MB of heap for seconds.' },
    { id: 'wal', name: 'WAL / binlog', role: 'Logs every byte before commit', detail: 'Durability means the whole blob is written to the write-ahead log (Postgres WAL, MySQL redo log + binlog) before the row commits — the file is written at least twice locally, and the log volume is what replication and point-in-time recovery must carry.' },
    { id: 'toast', name: 'Off-page storage', role: 'Chunks big values outside the row', detail: 'Postgres **TOAST** compresses values > ~2 KB (pointless for already-compressed JPEG/MP4) and splits them into ~2 KB chunks in a side table; InnoDB `DYNAMIC` rows keep a 20-byte pointer and store the value in 16 KB overflow pages. One 10 MB image ≈ 5,000 TOAST rows.' },
    { id: 'pool', name: 'Buffer pool', role: 'Shared page cache, polluted by blobs', detail: 'Reading a blob pulls its pages through the same cache that holds your hot indexes and rows. A few image downloads can evict the working set, turning cheap cached queries into disk reads.' },
    { id: 'replica', name: 'Replicas', role: 'Receive every byte via the log', detail: 'Each replica replays the full blob from the WAL/binlog stream. Large writes inflate replication lag for all tables, so unrelated reads from replicas go stale.' },
    { id: 'backup', name: 'Backups', role: 'Copy the blobs again, every time', detail: 'Full backups and snapshots include every file ever stored; a 50 GB schema becomes a 5 TB database. Restore time (RTO) grows from minutes to many hours.' },
  ],
  flow: [
    { part: 'app', title: 'Upload proxied', text: 'A user uploads an 8 MB photo. The API server reads it into memory and runs `INSERT INTO photos(user_id, data) VALUES ($1, $2)`.' },
    { part: 'wal', title: 'Logged first', text: 'All 8 MB go into the WAL and are fsynced before commit. Write amplification on the database disk is now dominated by images, not business data.' },
    { part: 'toast', title: 'Chunked off-page', text: 'Postgres tries to compress the already-compressed JPEG (wasted CPU), then stores ~4,000 TOAST chunks. The `photos` table looks small; the TOAST table is enormous.' },
    { part: 'pool', title: 'Cache pollution', text: 'Displaying a gallery reads dozens of blobs through the buffer pool, evicting index pages that the orders and users queries needed.' },
    { part: 'replica', title: 'Replication lag', text: 'A burst of uploads produces gigabytes of WAL; replicas fall seconds behind and serve stale reads for every table.' },
    { part: 'backup', title: 'Backup bloat', text: 'The nightly backup now takes 9 hours and a restore would take longer — the DB’s recovery story is held hostage by profile pictures.' },
  ],
  knobs: [
    {
      name: 'Where the bytes live',
      options: [
        { label: 'BLOB column', effect: 'Transactional with the row, but DB disk, WAL, replicas and backups all carry the bytes; costly provisioned SSD storage.', when: 'Tiny, few, rarely read values (< ~100 KB): signatures, small config files.' },
        { label: 'Object store + metadata row', effect: 'DB stores `key, size, content_type, sha256, owner`; bytes in S3 at ~1/5–1/10 the price with 11-nines durability; downloads via CDN.', when: 'Default for any user-generated file.' },
      ],
    },
    {
      name: 'Consistency between row and object',
      options: [
        { label: 'Object first, then row', effect: 'Upload to a unique key (UUID), then commit the row. A crash leaves only an orphan object, never a row pointing at nothing.', when: 'Default; clean orphans with a lifecycle rule or sweeper.' },
        { label: 'Row first (status=pending)', effect: 'Row is created, client uploads via presigned URL, an S3 event flips status to `ready`.', when: 'Direct browser uploads where you need the id up front.' },
      ],
    },
  ],
  implementations: [
    { name: 'PostgreSQL bytea + TOAST', how: 'Up to 1 GB per value; values over ~2 KB are compressed (pglz/lz4) and chunked into a per-table TOAST relation referenced by an out-of-line pointer.' },
    { name: 'MySQL InnoDB LONGBLOB', how: 'Up to 4 GB; stored in off-page overflow pages with a 20-byte in-row pointer; limited by `max_allowed_packet` (64 MB default in 8.0).' },
    { name: 'SQL Server FILESTREAM', how: 'Keeps blobs as NTFS files managed transactionally by the DB — an admission that pages are the wrong home for big binaries.' },
    { name: 'The fix: S3 + metadata row', how: 'Instagram, Dropbox and practically every web app keep media in object storage and only references in the DB; clients upload/download via presigned URLs and a CDN.' },
  ],
  ha: 'It doesn’t scale independently: file storage capacity, throughput and durability are welded to the database’s single primary, its replicas and its backup window. Scaling the DB to hold files means bigger instances and more replicas, all paying premium SSD prices for cold bytes. Separating bytes (object store) from metadata (DB) lets each scale on its own curve.',
  failureModes: [
    { name: 'Replication lag and WAL bloat', symptom: 'Upload bursts make replicas lag; WAL disk fills; failover is slower.', fix: 'Move bytes to object storage; DB writes become tiny metadata rows.' },
    { name: 'Backup/restore window explodes', symptom: 'Backups take hours, restores exceed the RTO.', fix: 'Object store with versioning/replication protects files; DB backups shrink to metadata.' },
    { name: 'App servers exhausted', symptom: 'Large downloads tie up threads and memory; API latency spikes for everyone.', fix: 'Presigned URLs + CDN so bytes never transit the app tier.' },
    { name: 'Packet/size limits', symptom: '`max_allowed_packet` or 1 GB field errors on big files.', fix: 'Don’t raise the limit — change the architecture.' },
  ],
  numbers: ['Postgres TOAST chunk ≈ 2 KB ⇒ 10 MB file ≈ 5,000 chunk rows', 'Managed DB SSD ≈ $0.10–0.25/GB-month × replicas vs S3 ≈ $0.023/GB-month', 'InnoDB page 16 KB, Postgres page 8 KB'],
  interview: [
    { q: 'Why not store user images in the database?', a: 'Every byte goes through app servers, the WAL, every replica and every backup, pollutes the buffer pool and lives on expensive SSD. Object storage is cheaper, more durable, CDN-friendly and lets clients upload/download directly with presigned URLs; the DB keeps only a metadata row with the object key.' },
    { q: 'How do you keep the object store and the DB row consistent without a distributed transaction?', a: 'Order the writes so failure leaves harmless garbage: upload the object under a unique key first, then commit the row. Orphaned objects (no row) are deleted by a sweeper or lifecycle rule on an `uploads/tmp/` prefix. For deletes, mark the row deleted, then remove the object asynchronously.' },
  ],
};

const NFS: Internals = {
  kind: 'nfs',
  summary:
    'NFS makes a directory on one file server look like a local disk on every client. Each `open`, `stat`, `read` and `write` becomes an RPC to that server, with client-side caches that are only loosely coherent. It is convenient for lift-and-shift apps, but it couples every web server to one fragile box and gives weak, surprising consistency.',
  parts: [
    { id: 'vfs', name: 'Kernel NFS client', role: 'Turns file syscalls into RPCs', detail: 'The app calls ordinary `open()`/`write()`; the kernel VFS routes calls on the mount point to the NFS client, so applications don’t know the disk is remote — including that it can be slow or gone.' },
    { id: 'cache', name: 'Client caches', role: 'Caches attributes and pages per client', detail: 'Attribute cache (`acregmin` 3 s to `acdirmax` 60 s) and page cache avoid RPCs, giving only **close-to-open** consistency: another server may see an old size, missing file or stale directory listing for seconds.' },
    { id: 'rpc', name: 'RPC transport', role: 'ONC RPC over TCP to server', detail: 'Every cache miss is a network round trip (~0.2–1 ms in a LAN, more in cloud). Metadata-heavy work — `ls` on a 100k-file directory, many small files — becomes thousands of serial RPCs.' },
    { id: 'server', name: 'NFS server', role: 'Single box exporting the filesystem', detail: '`nfsd` threads serve requests from one host (or an HA pair in NetApp-style filers). Its CPU, NIC and disks are shared by every client: one noisy job slows all web servers.' },
    { id: 'locks', name: 'Lock manager', role: 'Advisory locks across clients', detail: 'NFSv3 uses a separate **NLM** daemon with fragile recovery; NFSv4 has leases (~90 s) and a grace period after server restart. Locks are advisory, and apps like SQLite famously corrupt data on NFS.' },
    { id: 'disk', name: 'Backing storage', role: 'Local RAID/filesystem on the server', detail: 'Ultimately an ext4/XFS/ZFS filesystem on RAID. Capacity and durability are bounded by that box unless you buy a clustered filer.' },
  ],
  flow: [
    { part: 'vfs', title: 'Looks local', text: 'Web server A saves an upload with `write("/mnt/shared/uploads/u42.jpg")`. The code is identical to writing a local file.' },
    { part: 'cache', title: 'Written to client cache', text: 'Data sits in A’s page cache and is flushed on `close()`/`fsync`. Web server B lists the directory and, thanks to its attribute cache, may not see the file for up to 60 s.' },
    { part: 'rpc', title: 'RPC per operation', text: 'Flushing issues `WRITE` and `COMMIT` RPCs; B’s later `open` issues `LOOKUP` + `GETATTR`. Thumbnails of 20 images = dozens of round trips per page view.' },
    { part: 'server', title: 'One server serves all', text: 'The server handles every web server’s requests. A backup job reading the share saturates its disks and all page loads slow down.' },
    { part: 'locks', title: 'Locking surprises', text: 'Two servers process the same upload; their `flock` calls don’t coordinate across hosts on this mount, and both write the thumbnail.' },
    { part: 'disk', title: 'Server dies', text: 'The NFS box reboots. With a `hard` mount, every process touching `/mnt/shared` blocks in uninterruptible sleep (D state) — the entire web tier hangs, not just uploads.' },
  ],
  knobs: [
    {
      name: 'Mount mode',
      options: [
        { label: 'hard', effect: 'Retries forever: no data corruption, but processes hang (unkillable) while the server is down.', when: 'Default for writes you can’t lose.' },
        { label: 'soft', effect: 'Returns `EIO` after timeouts: apps don’t hang, but writes can be silently lost or files corrupted.', when: 'Read-only data only.' },
      ],
    },
    {
      name: 'Attribute caching',
      options: [
        { label: 'Default (3–60 s)', effect: 'Fewer RPCs, but clients see stale metadata.', when: 'Mostly read-only shares.' },
        { label: '`noac` / `actimeo=0`', effect: 'Closer to coherent, but every access is an RPC — throughput collapses.', when: 'Rarely worth it; rethink the design instead.' },
      ],
    },
    {
      name: 'Shared storage choice',
      options: [
        { label: 'NFS / EFS', effect: 'POSIX semantics for unmodified apps; latency in ms per metadata op, a shared bottleneck.', when: 'Legacy apps (CMS, ML training datasets) that need a filesystem.' },
        { label: 'Object storage', effect: 'HTTP API, no locks or renames, but infinite scale, 11 nines and CDN-friendly.', when: 'User uploads and static assets in web systems.' },
      ],
    },
  ],
  implementations: [
    { name: 'Linux knfsd', how: 'In-kernel NFS server exporting a local filesystem via `/etc/exports`; a single host unless you build Pacemaker/DRBD failover yourself.' },
    { name: 'NetApp ONTAP / Dell Isilon', how: 'Commercial filers: NVRAM write caching, HA controller pairs and snapshots — expensive appliances that mitigate (not remove) the shared-box problem.' },
    { name: 'AWS EFS / Google Filestore', how: 'Managed NFSv4.1: EFS stores data redundantly across AZs and scales throughput with size, but each metadata operation still costs milliseconds.' },
    { name: 'The alternative: S3 + CDN', how: 'Uploads go to object storage via presigned URLs, servers stay stateless, and any server can be killed without hanging the fleet.' },
  ],
  ha: 'A plain NFS server is a single point of failure that every client depends on synchronously; its failure hangs the whole tier. HA requires active/passive failover with shared or replicated disks and a floating IP, during which clients stall through a grace period. Managed services (EFS) solve durability and failover but not the latency or coupling.',
  failureModes: [
    { name: 'Server outage hangs everything', symptom: 'All web servers stuck in D-state processes, health checks time out, total outage.', fix: 'Keep web servers stateless; store uploads in object storage.' },
    { name: 'Stale reads', symptom: 'Server B 404s a file server A just wrote; listings disagree between servers.', fix: 'Don’t use a shared FS as a coordination mechanism; use a DB/queue for state.' },
    { name: 'Lock and corruption bugs', symptom: 'Two writers clobber the same file; SQLite/embedded DBs corrupt.', fix: 'Never run databases or lock-based coordination over NFS.' },
    { name: 'Small-file latency', symptom: 'Directory listings and many tiny files make requests take seconds.', fix: 'Object storage keyed by id; avoid huge directories.' },
  ],
  numbers: ['Each metadata op = 1 RPC ≈ 0.2–1 ms LAN, 1–5 ms on managed cloud NFS', 'Attribute cache 3–60 s ⇒ cross-client staleness window', 'NFSv4 lease ≈ 90 s; grace period after restart'],
  interview: [
    { q: 'Why is NFS a poor choice for storing user uploads behind a web tier?', a: 'It is a shared, stateful dependency in every request path: a slow or dead server hangs all web servers, latency per metadata op is high, client caches make files appear late, and locks are unreliable. Object storage gives stateless servers, near-infinite scale, 11 nines and direct client upload/download via presigned URLs and a CDN.' },
    { q: 'What is close-to-open consistency?', a: 'NFS only guarantees that a client opening a file after another client closed it sees the closed data, because flush happens on close and revalidation on open. Between those points, cached attributes and pages may be stale for up to the attribute-cache timeout, so concurrent writers and readers see inconsistent views.' },
  ],
};

const EVENT_STORE: Internals = {
  kind: 'event-store',
  summary:
    'An event store keeps every state change as an immutable event appended to a per-aggregate **stream**; current state is a fold (replay) of those events. Writes are guarded by optimistic concurrency on the stream version, every event also gets a global position, and subscribers tail the log to build read models. Nothing is ever updated or deleted — you append corrections.',
  parts: [
    { id: 'handler', name: 'Command handler', role: 'Loads aggregate, validates, emits events', detail: 'Receives a command like `Withdraw(acc-42, 50)`, rebuilds the aggregate’s state, checks invariants (balance ≥ 50) and decides which new events to append. Pure domain logic; no updates in place.' },
    { id: 'snapshot', name: 'Snapshot store', role: 'Caches folded state every N events', detail: 'Stores `(streamId, version, serializedState)` every ~100–1,000 events so loading a long stream reads one snapshot + a short tail instead of replaying years of history. Snapshots are a disposable cache, never the truth.' },
    { id: 'stream', name: 'Aggregate stream', role: 'Ordered events for one entity', detail: 'All events of `account-42` in order, versions 0..N. Read the tail after the snapshot and fold: `state = events.reduce(apply, snapshot)`. Streams are the unit of consistency, so keep aggregates small.' },
    { id: 'occ', name: 'Version check', role: 'Optimistic concurrency on expected version', detail: 'The append says `expectedVersion: 1037`. If the stream is now at 1038, the store rejects with **WrongExpectedVersion** and the handler reloads and retries. In SQL this is a `UNIQUE (stream_id, version)` constraint; in DynamoDB a conditional put.' },
    { id: 'log', name: 'Append-only log', role: 'Durably appends, assigns global position', detail: 'Events are appended atomically as a batch, fsynced, and stamped with both the stream version and a monotonically increasing **global position** (`$all` / commit position) used for subscriptions and checkpoints.' },
    { id: 'subs', name: 'Subscriptions', role: 'Push new events to consumers', detail: 'Catch-up subscriptions replay from a checkpoint then switch to live; persistent/competing subscriptions spread load. Consumers (projectors, integrations) store their last position and resume after crashes.' },
  ],
  flow: [
    { part: 'handler', title: 'Command received', text: '`Withdraw(account-42, $50)` arrives. The handler must know the current balance before deciding anything.' },
    { part: 'snapshot', title: 'Snapshot loaded', text: 'The latest snapshot says balance = $320 at version 1000, saving the replay of 1,000 older events.' },
    { part: 'stream', title: 'Tail replayed', text: 'Events 1001–1037 (deposits, withdrawals) are read and folded onto the snapshot: balance = $180. Invariant holds, so the handler emits `MoneyWithdrawn{amount: 50}`.' },
    { part: 'occ', title: 'Optimistic concurrency', text: 'Append with `expectedVersion: 1037`. A concurrent withdrawal already wrote 1038, so this append fails; the handler reloads (balance now $30), re-validates and rejects the command — no overdraft, no locks held.' },
    { part: 'log', title: 'Durable append', text: 'When an append passes the version check, the event is written as stream version 1038 and global position 9,812,331 in one atomic batch, fsynced and acknowledged. That event is now a permanent fact.' },
    { part: 'subs', title: 'Fan-out to subscribers', text: 'The balance projector and the fraud detector, subscribed from their checkpoints, receive event 9,812,331 within milliseconds and update their own models.' },
    { part: 'snapshot', title: 'Periodic snapshot', text: 'Every 100 events a background job writes a new snapshot so future loads stay fast; if the aggregate code changes, snapshots are simply discarded and rebuilt.' },
  ],
  knobs: [
    {
      name: 'Storage backend',
      options: [
        { label: 'Purpose-built (EventStoreDB)', effect: 'Streams, expected-version checks, `$all` ordering and subscriptions built in.', when: 'Event sourcing is the core architecture.' },
        { label: 'SQL table', effect: '`events(stream_id, version, position, type, data)` with `UNIQUE(stream_id, version)`; easy ops, but global ordering under concurrent commits needs care.', when: 'Moderate volume, team already runs Postgres (Marten, Axon JDBC).' },
        { label: 'Kafka', effect: 'Great distribution log and replay, but **no per-key expected-version check** and retention must be infinite.', when: 'Event backbone between services, rarely as the aggregate store itself.' },
      ],
    },
    {
      name: 'Snapshots',
      options: [
        { label: 'None', effect: 'Load cost grows linearly with stream length.', when: 'Short-lived aggregates (orders with ~20 events).' },
        { label: 'Every N events', effect: 'Bounded load time; extra storage and invalidation when code changes.', when: 'Long-lived aggregates (accounts, inventory items).' },
      ],
    },
    {
      name: 'Schema evolution',
      options: [
        { label: 'Upcasting on read', effect: 'Old event versions are transformed to the latest shape when loaded; history untouched.', when: 'Additive or renaming changes — the default.' },
        { label: 'New event type (v2)', effect: 'Handlers understand both; explicit but code accumulates.', when: 'Meaning of the event changed.' },
        { label: 'Copy-transform migration', effect: 'Rewrite into a new store; heavy and risky.', when: 'Last resort for fundamental model changes.' },
      ],
    },
  ],
  implementations: [
    { name: 'EventStoreDB (KurrentDB)', how: 'Append-only chunk files with a global transaction log, per-stream indexes, expected-version appends, catch-up and persistent subscriptions; leader + followers with quorum replication.' },
    { name: 'PostgreSQL (Marten, Axon JDBC)', how: 'An events table with a unique `(stream_id, version)` constraint for concurrency and a sequence for global position; projections tail it by position.' },
    { name: 'DynamoDB + Streams', how: 'Partition key = stream id, sort key = version, `PutItem` with `attribute_not_exists` as the expected-version check; DynamoDB Streams delivers changes per partition in order to Lambdas.' },
    { name: 'Kafka', how: 'Used as the durable, replayable distribution log (often fed from the store via outbox/CDC); compacted or infinite-retention topics for rebuilds.' },
  ],
  ha: 'Writes are replicated to a quorum before ack (EventStoreDB cluster of 3, or the underlying DB’s replication), with a single leader per stream/partition to keep ordering. Reads and subscriptions can be served by followers. Because events are immutable, they cache and replicate trivially; scaling writes means partitioning streams across nodes or clusters.',
  failureModes: [
    { name: 'Hot aggregate contention', symptom: 'Many concurrent commands on one stream cause constant WrongExpectedVersion retries.', fix: 'Smaller aggregates, split the hot entity, or serialize commands per stream through a queue.' },
    { name: 'Long streams load slowly', symptom: 'Loading an aggregate replays 500k events; command latency in seconds.', fix: 'Snapshots, or model with a shorter lifecycle (close the books per period).' },
    { name: 'Global position gaps', symptom: 'With a SQL sequence, a transaction that commits later can have a lower position; subscribers that already moved past it skip it forever.', fix: 'Single writer, read only up to the oldest in-flight transaction, or a store that assigns positions at commit.' },
    { name: 'Deleting personal data', symptom: 'GDPR erasure conflicts with immutable history.', fix: '**Crypto-shredding**: encrypt PII per user and delete the key; or keep PII outside events.' },
  ],
  numbers: ['Append latency ≈ 1–5 ms (fsync + replication)', 'Snapshot every 100–1,000 events', 'Single EventStoreDB node: ~10k–15k+ appends/s'],
  interview: [
    { q: 'Two withdrawals hit the same account concurrently. How does the event store prevent an overdraft?', a: 'Both handlers load the stream at version N and append with `expectedVersion = N`. The store accepts exactly one append; the other gets WrongExpectedVersion, reloads the now-updated stream, re-checks the balance invariant and rejects or succeeds. That is optimistic concurrency per stream, no locks.' },
    { q: 'How do you change an event’s schema when old events can’t be modified?', a: 'Version events and keep them backward compatible. Upcasters transform old versions to the current shape on read, so handlers only know the latest. For real semantic changes, introduce a new event type. Snapshots and read models are rebuilt from the upcasted stream.' },
    { q: 'Why not just use Kafka as the event store?', a: 'Kafka is a great ordered, replayable log, but it can’t append conditionally on a stream’s current version, a partition holds many aggregates so loading one entity means scanning, and retention must be infinite. Use a proper store (or DB table) for aggregates and Kafka to distribute the events.' },
  ],
  kafka: true,
};

const READ_MODEL: Internals = {
  kind: 'read-model',
  summary:
    'A read model is a denormalized, query-shaped copy of data built from the write side’s events or CDC stream — the "Q" in CQRS. Each screen or query gets a table (or index) that answers it with a single lookup, kept up to date asynchronously and always rebuildable from the event history. You trade freshness and storage for fast, simple reads.',
  parts: [
    { id: 'feed', name: 'Change feed', role: 'Ordered events or CDC rows', detail: 'The input: domain events from the event store or row changes captured by Debezium from the WAL/binlog, each with a monotonically increasing **position** per stream or partition.' },
    { id: 'writer', name: 'Projection writer', role: 'Upserts rows idempotently per event', detail: 'Applies each event as an idempotent upsert, e.g. `INSERT … ON CONFLICT (order_id) DO UPDATE … WHERE order_summary.version < EXCLUDED.version`, so a replayed or older event is a no-op.' },
    { id: 'table', name: 'Denormalized tables', role: 'Pre-joined, query-shaped storage', detail: 'One row already contains everything a screen needs (customer name, item count, total, status) with indexes matching its `WHERE`/`ORDER BY`. Can live in Postgres, Redis, Elasticsearch, Cassandra — whatever the query wants.' },
    { id: 'checkpoint', name: 'Checkpoint', role: 'Last applied position, stored atomically', detail: 'A row `projection_checkpoints(name, position)` updated in the same transaction as the data, so after a crash the projection resumes exactly where its data reflects — and the API can tell how fresh the model is.' },
    { id: 'query', name: 'Query API', role: 'Serves reads; handles staleness', detail: 'Reads are a single indexed lookup, no joins. For read-your-writes it can wait until `checkpoint ≥ position` returned by the command, or the UI applies the change optimistically.' },
  ],
  flow: [
    { part: 'feed', title: 'Event arrives', text: '`OrderPlaced{orderId: 77, customerId: 5, items: 3, total: 120}` arrives at global position 5001.' },
    { part: 'writer', title: 'Idempotent upsert', text: 'The writer upserts `order_summary(77)` with the customer’s name (copied from an earlier `CustomerRenamed` event), 3 items, $120 and status `PLACED`. If position 5001 is delivered twice, the version guard makes the second a no-op.' },
    { part: 'table', title: 'Multiple views updated', text: 'The same event also increments `customer_stats(5).order_count` and adds a row to `orders_by_day`. Each view is shaped for exactly one query.' },
    { part: 'checkpoint', title: 'Checkpoint committed', text: 'Position 5001 is stored in the same transaction as the upserts: data and checkpoint can never disagree.' },
    { part: 'query', title: 'Fast reads', text: '"My orders" is `SELECT * FROM order_summary WHERE customer_id = 5 ORDER BY placed_at DESC LIMIT 20` — one index range scan, ~1 ms, no joins across services.' },
    { part: 'query', title: 'Read-your-writes', text: 'The command returned position 5001; the client’s next query passes `minPosition=5001` and the API waits (bounded, e.g. 500 ms) until the checkpoint catches up, hiding eventual consistency from the user.' },
    { part: 'feed', title: 'Rebuild', text: 'Need a new column? Create `order_summary_v2`, replay the feed from position 0 into it, then switch the query alias — the old model keeps serving until v2 catches up (blue/green).' },
  ],
  knobs: [
    {
      name: 'Read store',
      options: [
        { label: 'Same relational DB', effect: 'Simple ops, transactional checkpoint, SQL flexibility.', when: 'Most CQRS apps.' },
        { label: 'Redis', effect: 'Sub-ms lookups, sorted sets for feeds/leaderboards; memory-bound.', when: 'Timelines, counters, hot dashboards.' },
        { label: 'Elasticsearch', effect: 'Full-text and faceted queries; near-real-time and harder to make transactional.', when: 'Search and filtering screens.' },
      ],
    },
    {
      name: 'Staleness handling',
      options: [
        { label: 'Plain eventual', effect: 'Simplest; users may not see their own change for ~100 ms–seconds.', when: 'Dashboards, other users’ data.' },
        { label: 'Wait-for-position', effect: 'Read-your-writes at the cost of occasional waits.', when: 'User just submitted a form and expects to see it.' },
        { label: 'Optimistic UI', effect: 'Client shows the change immediately and reconciles later.', when: 'Interactive apps (likes, comments).' },
      ],
    },
    {
      name: 'Rebuild strategy',
      options: [
        { label: 'In place (truncate + replay)', effect: 'Simple; the view is empty or wrong until replay finishes.', when: 'Small models, maintenance windows.' },
        { label: 'Blue/green (v2 + swap)', effect: 'Zero downtime; double storage during the rebuild.', when: 'Production models of any size.' },
      ],
    },
  ],
  implementations: [
    { name: 'Postgres projection tables', how: 'Marten, Axon or hand-written projectors maintain tables plus a checkpoint row in one transaction.' },
    { name: 'Redis sorted sets', how: 'Twitter-style home timelines are read models: fan-out on write pushes tweet ids into each follower’s list for O(1) reads.' },
    { name: 'Materialize / ksqlDB / RisingWave', how: 'Incrementally maintained materialized views over Kafka/CDC streams: you declare the SQL view, the engine updates it per event.' },
    { name: 'DynamoDB GSIs', how: 'A global secondary index is a managed, asynchronously maintained read model of the base table with a different key.' },
  ],
  ha: 'Read models are disposable and rebuildable, so they scale like caches: add read replicas or more shards, or run several copies in different regions near users. Losing one is an availability problem, not a data-loss problem, because the event log is the source of truth.',
  failureModes: [
    { name: 'Stale reads confuse users', symptom: 'User saves a change, refreshes, and it is gone.', fix: 'Wait-for-position, optimistic UI, or read the write model for that one screen.' },
    { name: 'Writing from the command side', symptom: 'Command handlers also update the read model directly; two sources of truth drift.', fix: 'Only projectors write read models.' },
    { name: 'Bug corrupts the view', symptom: 'A projection bug produced wrong totals for weeks.', fix: 'Fix the code and rebuild from events (blue/green); this is the superpower of the pattern.' },
    { name: 'Rebuilds too slow', symptom: 'Replaying 2 billion events takes days.', fix: 'Batch writes, parallelize by partition, start from snapshots or a backfill from the current DB state.' },
  ],
  numbers: ['Typical projection lag 10 ms – 1 s', 'Read = 1 indexed lookup ≈ 1 ms vs multi-join query 10–100+ ms', 'Rebuild throughput ≈ 5k–50k events/s per partition with batching'],
  interview: [
    { q: 'What is CQRS and when is it worth it?', a: 'Separate the model that handles writes (enforces invariants, normalized or event-sourced) from models that serve reads (denormalized, per query). Worth it when read and write shapes or loads differ a lot — dashboards, feeds, search — and you accept eventual consistency. Overkill for simple CRUD.' },
    { q: 'How do you give a user read-your-writes on an eventually consistent read model?', a: 'Return the write’s log position from the command; the query API waits (bounded) until the projection checkpoint reaches it, or routes that user’s reads to the write model briefly, or the UI applies the change optimistically.' },
  ],
};

const PROJECTOR: Internals = {
  kind: 'projector',
  summary:
    'A projector is a long-running consumer that reads an ordered stream of events (or CDC changes) from a checkpoint and applies each one to a read model. Delivery is at-least-once, so every write must be idempotent; ordering is guaranteed only per key, so it partitions work by aggregate id. Its health is measured in lag.',
  parts: [
    { id: 'checkpoint', name: 'Checkpoint store', role: 'Remembers the last processed position', detail: 'On start it reads its last committed position (a DB row, a Kafka consumer-group offset, an Axon tracking token). Position 0 means "rebuild from the beginning".' },
    { id: 'fetch', name: 'Subscription fetch', role: 'Pulls batches after the checkpoint', detail: 'A catch-up subscription, Kafka `poll()`, Debezium connector or DynamoDB Streams iterator returns batches (e.g. 500 events) after the checkpoint, then tails live events.' },
    { id: 'router', name: 'Key router', role: 'Keeps per-key order, parallelizes keys', detail: 'Events are routed by `hash(aggregateId)` to a worker/partition, so all events of one order are applied in sequence while different orders are processed in parallel. Kafka does this with partition keys.' },
    { id: 'handler', name: 'Event handler', role: 'Maps each event type to updates', detail: 'A switch on event type: `OrderPlaced` → insert summary, `ItemAdded` → increment count. Upcasts old versions, ignores unknown types, and must be deterministic so replays give the same result.' },
    { id: 'sink', name: 'Idempotent sink', role: 'Writes model and checkpoint safely', detail: 'Writes the read model and the checkpoint in one transaction when they share a DB; otherwise makes the write idempotent (doc id = aggregate id, `version_type=external` in Elasticsearch, or a per-row `last_position` guard).' },
    { id: 'monitor', name: 'Lag monitor', role: 'Measures head position minus checkpoint', detail: 'Exports `lag = head_position − checkpoint` (events) and age of the oldest unprocessed event (seconds), alerts when it grows, and parks poison events.' },
  ],
  flow: [
    { part: 'checkpoint', title: 'Resume from checkpoint', text: 'After a deploy the projector reads its checkpoint: position 8,400.' },
    { part: 'fetch', title: 'Fetch a batch', text: 'It requests events 8,401–8,900 from the log and then keeps the subscription open for new ones.' },
    { part: 'router', title: 'Route by key', text: 'Events for `order-77` all go to worker 3, preserving `Placed → Paid → Shipped`. Events for other orders run concurrently on other workers.' },
    { part: 'handler', title: 'Apply event', text: '`OrderShipped{orderId: 77, v: 3}` → set `status = SHIPPED`, `shipped_at = …` on the summary row.' },
    { part: 'sink', title: 'Write + checkpoint atomically', text: 'One transaction updates the row `WHERE last_version < 3` and sets the checkpoint to 8,900. Commit.' },
    { part: 'sink', title: 'Crash and redelivery', text: 'If the process had died before committing, the batch would be redelivered after restart; thanks to the version guard, re-applying it is a no-op instead of double-counting.' },
    { part: 'monitor', title: 'Watch lag', text: 'Head is 8,950, checkpoint 8,900: lag 50 events / 80 ms. A poison event that keeps failing is retried a few times, then parked and alerted on — silently skipping it would corrupt the model.' },
  ],
  knobs: [
    {
      name: 'Checkpoint commit',
      options: [
        { label: 'Same transaction as the write', effect: 'Effectively exactly-once into that DB.', when: 'Read model and checkpoint share a database.' },
        { label: 'After the write (separate store)', effect: 'At-least-once: crashes cause replays, so writes must be idempotent.', when: 'Sink is Elasticsearch, Redis, another service.' },
        { label: 'Before the write / auto-commit', effect: 'At-most-once: a crash loses events silently.', when: 'Never for read models.' },
      ],
    },
    {
      name: 'Parallelism',
      options: [
        { label: 'Single consumer', effect: 'Total order, simple; throughput limited to one thread.', when: 'Low volume, or projections needing global order.' },
        { label: 'Partitioned by key', effect: 'Scales out across partitions; order only within a key.', when: 'Default for high volume (Kafka partitions, consumer groups).' },
      ],
    },
    {
      name: 'Poison events',
      options: [
        { label: 'Block and alert', effect: 'Never applies events out of order; the projection stalls until fixed.', when: 'Correctness-critical models (balances).' },
        { label: 'Park to DLQ and continue', effect: 'Stays live, but that key’s view may be wrong until re-driven.', when: 'Best-effort views (search, recommendations).' },
      ],
    },
  ],
  implementations: [
    { name: 'Kafka consumer groups / Kafka Streams', how: 'Partitions are assigned across instances; offsets are committed to `__consumer_offsets`; Kafka Streams adds local state stores and transactional exactly-once processing within Kafka.' },
    { name: 'Debezium + sink connectors', how: 'CDC reads the DB’s WAL/binlog, publishes row changes keyed by primary key to Kafka, and Kafka Connect sinks upsert them into Elasticsearch, Snowflake, etc.' },
    { name: 'EventStoreDB / Axon tracking processors', how: 'Catch-up subscriptions on `$all` or a category stream; Axon stores a tracking token per processor segment and can split segments to scale out.' },
    { name: 'Lambda on DynamoDB Streams', how: 'One concurrent invocation per shard keeps per-key order; failed batches are retried and bisected to isolate the poison record.' },
  ],
  ha: 'Projectors are stateless apart from the checkpoint, so you run several instances: either a leader lease per projection (only one active, others standby) or partition assignment (each instance owns some partitions, rebalanced when one dies). Throughput scales with partitions; a full rebuild can run as a separate, temporarily wide deployment writing into a v2 model.',
  failureModes: [
    { name: 'Double counting on replay', symptom: 'Totals drift upward after every restart or rebalance.', fix: 'Idempotent writes: version/position guard per row or atomic checkpoint.' },
    { name: 'Out-of-order application', symptom: '`Shipped` applied before `Placed`; row ends in the wrong state.', fix: 'Partition by aggregate id; reject events with a version ≤ the row’s version.' },
    { name: 'Poison event stalls the stream', symptom: 'Lag grows forever behind one malformed event.', fix: 'Bounded retries, park + alert, tolerant deserialization.' },
    { name: 'Lag spiral', symptom: 'Traffic spike makes lag minutes long; users see stale data.', fix: 'Batch writes, more partitions/instances, alert on lag age, shed non-critical projections.' },
  ],
  numbers: ['Normal lag: tens to hundreds of ms', 'Batching 100–1,000 events per transaction ⇒ 10–50× faster rebuilds', 'Kafka default retention 7 days — keep full history elsewhere if you need rebuilds'],
  interview: [
    { q: 'Your projector crashed mid-batch. How do you avoid double-applying events?', a: 'Either commit the checkpoint in the same transaction as the read-model writes, or make each write idempotent — upserts keyed by entity id guarded by the event version/position — so redelivered events are no-ops. Never commit the checkpoint before the write.' },
    { q: 'How do you scale a projector while keeping order?', a: 'Order only matters per aggregate, so partition the stream by aggregate id (Kafka partition key) and process partitions in parallel, one consumer per partition. Global order is rarely needed; when it is, you are limited to one consumer.' },
  ],
  kafka: true,
};

const SAGA: Internals = {
  kind: 'saga',
  summary:
    'A saga replaces one distributed transaction with a sequence of **local** transactions, each in its own service, plus a **compensating action** for every step that can be undone. An orchestrator (a persisted state machine) or a chain of events drives the steps; if one fails, completed steps are compensated in reverse. You get atomicity eventually, but no isolation.',
  parts: [
    { id: 'start', name: 'Saga start', role: 'Creates saga instance with idempotency key', detail: '`POST /orders` creates a saga id (e.g. the order id) and records it with the client’s idempotency key, so a retried request resumes the same saga instead of starting a second one.' },
    { id: 'orchestrator', name: 'Orchestrator', role: 'State machine deciding the next step', detail: 'Encodes `Reserve stock → Charge card → Book shipping`, the compensations and retry policies. In Temporal it is ordinary code replayed deterministically; in Step Functions a JSON state machine (ASL).' },
    { id: 'state', name: 'Durable state', role: 'Persists progress before each step', detail: 'Every transition is persisted (Temporal’s event history in Cassandra/MySQL, a `saga_state` table) before acting, so a crashed orchestrator resumes exactly where it stopped on another worker.' },
    { id: 'outbox', name: 'Outbox', role: 'Sends commands atomically with state', detail: 'The command to a participant is written to an `outbox` table in the same transaction as the state change and relayed to Kafka/SQS by CDC or a poller — no "state saved but message lost" gap. Delivery is at-least-once.' },
    { id: 'participant', name: 'Participant services', role: 'Execute idempotent local transactions', detail: 'Inventory, Payments, Shipping each commit locally and reply. Each dedupes on `(sagaId, step)` so a redelivered command doesn’t reserve or charge twice.' },
    { id: 'compensator', name: 'Compensations', role: 'Semantically undo completed steps', detail: '`ReleaseStock` undoes `ReserveStock`; `Refund` undoes `Charge`. They are new business transactions (not rollbacks), must be idempotent and are retried until they succeed.' },
  ],
  flow: [
    { part: 'start', title: 'Saga begins', text: 'Checkout creates saga `order-77` with status `PENDING` (a **semantic lock**: the UI shows "processing", other flows know it’s in-flight).' },
    { part: 'orchestrator', title: 'Plan the first step', text: 'The state machine’s first step is `ReserveStock(order-77, sku-9, qty 2)`.' },
    { part: 'state', title: 'Persist before acting', text: 'The transition "step 1 started" is durably recorded. If the worker crashes now, another worker replays the history and continues.' },
    { part: 'outbox', title: 'Command published', text: 'The command row commits with the state and is relayed to the inventory queue; a duplicate delivery is possible and harmless.' },
    { part: 'participant', title: 'Local transactions run', text: 'Inventory reserves (idempotent on `order-77/1`) and replies OK. Payments tries the charge: **card declined**.' },
    { part: 'compensator', title: 'Compensate in reverse', text: 'The orchestrator runs `ReleaseStock(order-77)` and marks the order `CANCELLED`. Had the charge succeeded — the **pivot** step, the point of no return — later steps like shipping would only be retried forward, never compensated.' },
    { part: 'orchestrator', title: 'Saga completes', text: 'Final state is recorded. Every outcome is visible in the persisted history: which steps ran, retries, compensations — invaluable for support and audits.' },
  ],
  knobs: [
    {
      name: 'Coordination style',
      options: [
        { label: 'Orchestration', effect: 'One place defines the flow, timeouts and compensations; easy to see and test; the orchestrator is a dependency.', when: 'More than 3–4 steps, complex branching, need for visibility.' },
        { label: 'Choreography', effect: 'Services react to each other’s events; loose coupling, no central component, but the flow is implicit and hard to trace or change.', when: 'Few steps, simple linear flows, teams owning their reactions.' },
      ],
    },
    {
      name: 'Isolation countermeasures',
      options: [
        { label: 'Semantic lock (status = PENDING)', effect: 'Others see intermediate state as explicitly pending and can wait or refuse.', when: 'Default for business entities.' },
        { label: 'Commutative updates', effect: 'Design steps (increment/decrement) so order doesn’t matter.', when: 'Counters, balances, stock levels.' },
        { label: 'Reorder steps', effect: 'Put risky/rejectable steps first and the irreversible pivot as late as possible.', when: 'Always — reduces compensations.' },
      ],
    },
    {
      name: 'Engine',
      options: [
        { label: 'Durable execution (Temporal, Step Functions)', effect: 'Persistence, retries, timers and history for free.', when: 'Most teams; long-running or business-critical flows.' },
        { label: 'Home-grown state table + outbox', effect: 'Full control, no new infra; you build retries, timers, visibility.', when: 'A couple of simple sagas.' },
      ],
    },
  ],
  implementations: [
    { name: 'Temporal / Cadence', how: 'Workflow code runs on workers; every activity result is appended to an event history sharded by workflow id. After a crash, the code is replayed against the history to rebuild state — which is why workflow code must be deterministic.' },
    { name: 'AWS Step Functions', how: 'Amazon States Language JSON state machines with `Retry`/`Catch` per task; Standard workflows run up to a year with exactly-once state transitions, Express workflows are high-rate and at-least-once.' },
    { name: 'Netflix Conductor / Camunda', how: 'JSON/BPMN workflow definitions executed by a server that queues tasks for polling workers and persists state in a DB.' },
    { name: 'Choreography with Kafka + outbox', how: 'Each service writes its state and an outbox event in one local transaction; Debezium publishes it; the next service reacts. Compensation is triggered by failure events.' },
  ],
  ha: 'The orchestrator is stateless code over durable state, so you run many workers and any worker can resume any saga. Temporal shards workflow histories across a persistence cluster; Step Functions is a managed multi-AZ service. Participants scale independently; queues between them absorb bursts and outages.',
  failureModes: [
    { name: 'Compensation fails or is missing', symptom: 'Customer charged but order cancelled; stock reserved forever.', fix: 'Every step has a compensation that is idempotent and retried until success, with alerting and manual repair tooling.' },
    { name: 'Non-idempotent steps', symptom: 'Redelivered command charges the card twice.', fix: 'Idempotency keys per `(sagaId, step)`, passed to downstream APIs (Stripe `Idempotency-Key`).' },
    { name: 'Isolation anomalies', symptom: 'Another request reads reserved-but-not-paid stock as sold, or acts on a saga that later rolls back.', fix: 'Semantic locks, pending states, commutative updates, re-check values before the pivot.' },
    { name: 'Choreography spaghetti', symptom: 'Nobody can say what happens after `OrderPlaced`; cyclic event chains.', fix: 'Move multi-step flows into an orchestrator; trace with saga/correlation ids.' },
  ],
  numbers: ['Typical saga: 3–7 steps', 'Temporal step overhead ≈ a few ms + persistence write', 'Step Functions Standard ≈ $25 per million state transitions'],
  interview: [
    { q: 'Saga vs two-phase commit — why do microservices use sagas?', a: '2PC needs every participant to support prepare, holds locks across network round trips and blocks if the coordinator dies, so availability is the product of all services’. Sagas commit locally at each step and undo with compensations, so services stay independent and available, at the cost of no isolation and eventual consistency.' },
    { q: 'What happens if a compensating action fails?', a: 'It is retried (with backoff) until it succeeds, because the saga must reach a consistent end state; compensations are therefore designed to be idempotent and not to fail for business reasons. If retries are exhausted, the saga is parked in a failed state for alerting and manual repair.' },
    { q: 'Orchestration or choreography?', a: 'Choreography for short, simple flows where loose coupling matters. Orchestration once there are several steps, branching, timeouts or a need to see "where is order 77?" — the flow lives in one place and is persisted, testable and observable.' },
  ],
};

const TWO_PC: Internals = {
  kind: 'two-pc',
  summary:
    'Two-phase commit makes several resource managers commit atomically: a coordinator asks everyone to **prepare** (make the change durable and promise to commit), then broadcasts **commit** only if all voted yes. The promise is what makes it a trap — prepared participants hold locks and cannot decide on their own, so a slow or dead coordinator blocks them.',
  parts: [
    { id: 'client', name: 'Transaction client', role: 'Starts a global transaction', detail: 'The app begins a distributed transaction (JTA `UserTransaction.begin()`, XA `xa_start`) and does work on several databases, each enlisted as a branch with a global transaction id (XID).' },
    { id: 'coordinator', name: 'Coordinator', role: 'Runs prepare and commit phases', detail: 'A transaction manager (Atomikos, Narayana, the DB itself) sends `PREPARE` to every participant, collects votes, decides, and then sends `COMMIT` or `ROLLBACK`.' },
    { id: 'participant', name: 'Participants', role: 'Durably prepare, then vote yes/no', detail: 'Each DB writes all changes plus a **prepare record** to its WAL and fsyncs (`PREPARE TRANSACTION` in Postgres, `XA PREPARE` in MySQL). Voting yes is a promise: it must be able to commit even after a crash.' },
    { id: 'locks', name: 'Prepared locks', role: 'Rows locked while in doubt', detail: 'Between the yes vote and the decision, the participant is **in doubt**: it can’t commit or abort alone, so row locks stay held and other transactions touching those rows wait.' },
    { id: 'decision', name: 'Decision log', role: 'Coordinator’s durable commit point', detail: 'The coordinator fsyncs `COMMIT xid` to its own log before telling anyone. That record — not the participants — is the single source of truth for the outcome.' },
    { id: 'recovery', name: 'Recovery manager', role: 'Resolves in-doubt transactions after crashes', detail: 'On restart, the coordinator rereads its log and re-sends decisions; participants list in-doubt branches (`pg_prepared_xacts`, `XA RECOVER`). Without the coordinator, they wait — or an operator decides by hand.' },
  ],
  flow: [
    { part: 'client', title: 'Global transaction begins', text: 'A transfer debits account A in DB-1 and credits account B in DB-2 under one XID.' },
    { part: 'coordinator', title: 'Phase 1: prepare', text: 'The coordinator sends `PREPARE` to DB-1 and DB-2 and waits for both votes — one network round trip plus each DB’s fsync.' },
    { part: 'participant', title: 'Durable yes vote', text: 'Each DB persists the changes and a prepare record, then votes YES. From now on it has given up the right to abort unilaterally.' },
    { part: 'locks', title: 'Locks held in doubt', text: 'Account rows A and B stay locked. Every other transaction touching them queues up behind this one for as long as phase 2 takes.' },
    { part: 'decision', title: 'Commit point', text: 'Both voted yes, so the coordinator fsyncs `COMMIT` to its log. The transaction is now committed, even though no participant knows yet.' },
    { part: 'coordinator', title: 'Phase 2: commit', text: 'The coordinator sends `COMMIT`; participants commit, release locks and ack. Total: 2 round trips and ≥3 fsyncs on the critical path.' },
    { part: 'recovery', title: 'Coordinator dies at the worst moment', text: 'If the coordinator crashes after the prepares but before sending the decision, DB-1 and DB-2 sit in doubt with locks held — minutes or hours — until it recovers. This is the **blocking** problem.' },
  ],
  knobs: [
    {
      name: 'Coordinator durability',
      options: [
        { label: 'Single coordinator process', effect: 'Its crash blocks all in-doubt participants until it comes back.', when: 'Classic XA in one app server — avoid for critical paths.' },
        { label: 'Replicated coordinator (Paxos/Raft)', effect: 'Decision survives node loss; blocking only if a quorum is lost.', when: 'Inside distributed databases (Spanner, CockroachDB).' },
      ],
    },
    {
      name: 'Scope',
      options: [
        { label: 'Inside one database system', effect: 'Participants are shards of the same engine, low latency, managed recovery.', when: 'Cross-shard transactions in Spanner/CockroachDB/Vitess.' },
        { label: 'Across microservices / third parties', effect: 'Most can’t prepare (HTTP APIs, Stripe, email); locks held across slow networks; availability = product of all.', when: 'Don’t. Use a saga + outbox + idempotency.' },
      ],
    },
    {
      name: 'Optimizations',
      options: [
        { label: 'One-phase commit', effect: 'If only one participant is enlisted, skip prepare entirely.', when: 'Automatic in most transaction managers.' },
        { label: 'Read-only votes / presumed abort', effect: 'Read-only branches drop out after phase 1; no log record needed for aborts.', when: 'Standard in production 2PC implementations.' },
      ],
    },
  ],
  implementations: [
    { name: 'XA / JTA (Atomikos, Narayana)', how: 'The app server’s transaction manager coordinates XA-capable DBs and brokers via `xa_prepare`/`xa_commit`; the coordinator log lives on the app server’s disk.' },
    { name: 'Postgres / MySQL XA', how: '`PREPARE TRANSACTION \'xid\'` / `XA PREPARE` persist a prepared branch that survives restarts; forgotten ones hold locks and block vacuum.' },
    { name: 'Google Spanner', how: 'Cross-shard transactions run 2PC where each participant and the coordinator is a **Paxos group**, so a single machine failure doesn’t block; TrueTime provides commit timestamps.' },
    { name: 'CockroachDB / Kafka transactions', how: 'CockroachDB uses a replicated transaction record and parallel commits to cut a round trip; Kafka’s transaction coordinator runs a 2PC-like protocol over partitions with commit markers.' },
  ],
  ha: 'Classic 2PC is not highly available: any participant voting no or timing out aborts the transaction, and a coordinator failure blocks prepared participants. Availability of the whole is roughly the product of the parts (5 services at 99.9% ≈ 99.5%). It only becomes tolerable when every role is itself a consensus-replicated group inside one database system.',
  failureModes: [
    { name: 'Blocking on coordinator failure', symptom: 'Prepared transactions hold locks indefinitely; queries on those rows hang.', fix: 'Replicated coordinator (Paxos) or avoid 2PC; monitor and resolve in-doubt branches.' },
    { name: 'Lock-holding latency', symptom: 'Throughput collapses as locks are held across 2 network round trips and multiple fsyncs.', fix: 'Keep transactions inside one DB/shard; design for single-partition writes.' },
    { name: 'Participant can’t prepare', symptom: 'Payment API or email service has no prepare phase; "atomicity" is fake.', fix: 'Saga with compensations, outbox, idempotency keys.' },
    { name: 'Orphaned prepared transactions', symptom: 'Postgres `pg_prepared_xacts` grows, vacuum is blocked, table bloat.', fix: 'Alert on prepared xact age; recovery tooling; `max_prepared_transactions = 0` if unused.' },
  ],
  numbers: ['Critical path: 2 round trips + ≥3 fsyncs', 'Cross-region round trip 50–150 ms ⇒ locks held ≥ 100–300 ms', 'Availability ≈ product: 0.999^5 ≈ 0.995'],
  interview: [
    { q: 'Why is 2PC called a blocking protocol?', a: 'After voting yes, a participant has promised to commit if told to, so it cannot abort on its own; it must wait for the coordinator’s decision. If the coordinator crashes after collecting votes, participants stay in doubt with locks held until it recovers. 3PC tries to fix this but fails under network partitions; real systems replicate the coordinator with consensus instead.' },
    { q: 'Spanner uses 2PC — why is it OK there but not across microservices?', a: 'In Spanner every participant and the coordinator are Paxos groups in one system with controlled latency, so no single crash blocks progress and all participants support prepare. Microservices are independently deployed, often can’t prepare (third-party APIs), and coupling their locks and availability defeats the point; use sagas.' },
  ],
};

const CIRCUIT_BREAKER: Internals = {
  kind: 'circuit-breaker',
  summary:
    'A circuit breaker is an in-process state machine wrapped around calls to one dependency. While **closed** it passes calls through and records outcomes in a rolling window; when the failure rate crosses a threshold it **opens** and fails fast for a cool-down, then lets a few **half-open** probe calls test recovery. Paired with timeouts and bulkheads, it stops one sick dependency from consuming every thread in the caller.',
  parts: [
    { id: 'gate', name: 'State gate', role: 'Allows, rejects or probes each call', detail: 'An atomic state (`CLOSED`, `OPEN`, `HALF_OPEN`) checked before every call. Open → throw `CallNotPermitted` immediately (microseconds) instead of waiting on a doomed request.' },
    { id: 'bulkhead', name: 'Bulkhead', role: 'Caps concurrent calls to this dependency', detail: 'A semaphore or dedicated thread pool (e.g. 20 permits) per dependency. When full, extra calls are rejected, so a slow recommendations service can’t exhaust the threads that checkout needs.' },
    { id: 'timeout', name: 'Timeout', role: 'Bounds how long one call waits', detail: 'Set from the dependency’s p99/p99.9 (e.g. 800 ms), and within the caller’s own deadline. Without timeouts a breaker never sees failures — calls just hang.' },
    { id: 'window', name: 'Sliding window', role: 'Records outcomes of recent calls', detail: 'A ring buffer of the last N calls (count-based) or per-second buckets over the last T seconds (time-based), tracking failures, timeouts and slow calls with O(1) updates.' },
    { id: 'trip', name: 'Trip logic', role: 'Opens/closes the circuit on thresholds', detail: 'Trips when `calls ≥ minimumNumberOfCalls` **and** failure rate ≥ threshold (e.g. 50%) or slow-call rate ≥ threshold. After `waitDurationInOpenState` it goes half-open; N successful probes close it, any failure re-opens it.' },
    { id: 'fallback', name: 'Fallback', role: 'Degraded answer when call not made', detail: 'Cached value, default, empty list, queued for later, or a clear error. Without a fallback the breaker only turns slow failures into fast ones (still valuable: threads are freed).' },
  ],
  flow: [
    { part: 'gate', title: 'Closed: call allowed', text: 'Product page calls the reviews service; breaker is `CLOSED`, so the call proceeds.' },
    { part: 'bulkhead', title: 'Permit acquired', text: 'One of 20 permits for `reviews` is taken. If 20 calls were already in flight, this one would be rejected instantly rather than queueing.' },
    { part: 'timeout', title: 'Bounded wait', text: 'Reviews is degraded; the call hits its 800 ms timeout and is recorded as a failure instead of hanging for 30 s.' },
    { part: 'window', title: 'Outcome recorded', text: 'The last 100 calls now contain 62 failures/timeouts — 62% failure rate, above the minimum of 20 calls.' },
    { part: 'trip', title: 'Circuit opens', text: '62% ≥ 50% threshold → `OPEN` for 30 s. For that time, calls to reviews cost ~0 ms and zero load on the struggling service, giving it room to recover.' },
    { part: 'fallback', title: 'Degrade gracefully', text: 'The page renders with cached reviews or "Reviews unavailable" — still sellable, instead of the whole page timing out.' },
    { part: 'trip', title: 'Half-open probes', text: 'After 30 s, 5 probe calls are allowed through. All succeed → `CLOSED` and the window resets. Any failure → back to `OPEN` (often with a longer wait).' },
  ],
  knobs: [
    {
      name: 'Window type',
      options: [
        { label: 'Count-based (last N calls)', effect: 'Predictable statistics; at low traffic old calls linger for a long time.', when: 'Steady, high-volume dependencies.' },
        { label: 'Time-based (last T seconds)', effect: 'Reacts to what happened recently regardless of volume.', when: 'Bursty or low traffic.' },
      ],
    },
    {
      name: 'Thresholds',
      options: [
        { label: 'Sensitive (e.g. 20%, min 10 calls)', effect: 'Trips fast, protects quickly; risk of flapping on noise.', when: 'Non-critical features with good fallbacks.' },
        { label: 'Tolerant (e.g. 50%, min 50 calls)', effect: 'Fewer false trips; slower to protect.', when: 'Critical calls where a fallback is costly.' },
        { label: 'Slow-call rate', effect: 'Trips on latency (e.g. 50% of calls > 2 s), not only errors.', when: 'Dependencies that degrade by slowing down rather than failing.' },
      ],
    },
    {
      name: 'Scope',
      options: [
        { label: 'Per dependency (service)', effect: 'Simple; one bad instance can trip the breaker for the whole service.', when: 'Calls through a load balancer.' },
        { label: 'Per host (outlier ejection)', effect: 'Ejects only the bad instance from the pool; others keep serving.', when: 'Client-side load balancing / service mesh.' },
      ],
    },
  ],
  implementations: [
    { name: 'Netflix Hystrix', how: 'Wrapped calls in commands with thread-pool bulkheads; 10 s rolling window of 1 s buckets, tripping at ≥20 requests and ≥50% errors, 5 s sleep window. In maintenance since 2018.' },
    { name: 'Resilience4j', how: 'Lightweight Java library: count- or time-based sliding windows, failure and slow-call rate thresholds, `minimumNumberOfCalls`, half-open probe count, plus separate Bulkhead, TimeLimiter, Retry and RateLimiter decorators.' },
    { name: 'Envoy / Istio', how: '`circuit_breakers` cap max connections, pending requests, requests and retries per upstream cluster; `outlier_detection` ejects hosts after e.g. 5 consecutive 5xx for a growing ejection time, capped by `max_ejection_percent`.' },
    { name: 'Polly (.NET), gobreaker (Go), opossum (Node)', how: 'Same closed/open/half-open state machine as in-process libraries; Polly composes it with retry and timeout policies.' },
  ],
  ha: 'Breakers are in-process and per-instance by design: each caller instance decides from its own observations, with no shared state to fail or coordinate. That means 100 instances trip at slightly different times, which is fine. It is itself never a SPOF; the HA it buys is for the caller, by isolating failures (bulkheads) and shedding load from the callee.',
  failureModes: [
    { name: 'No timeouts', symptom: 'Calls hang for 30–60 s; threads exhaust before the breaker ever records a failure.', fix: 'Always set timeouts below the caller’s deadline; count timeouts as failures.' },
    { name: 'Flapping', symptom: 'Breaker opens and closes every few seconds, giving erratic user experience.', fix: 'Raise minimum calls, longer open duration with backoff, several successful probes before closing.' },
    { name: 'Service-wide trip for one bad host', symptom: 'One broken pod opens the breaker; 9 healthy pods go unused.', fix: 'Per-host outlier detection in the client/mesh.' },
    { name: 'No fallback', symptom: 'Open breaker turns into errors on the page anyway.', fix: 'Design degraded modes: cache, defaults, hide the feature, queue the write.' },
  ],
  numbers: ['Open-state rejection ≈ µs vs timeout of 100s of ms', 'Typical: 50% failure rate, ≥20 calls, 10–30 s open, 3–10 half-open probes', 'Timeout ≈ dependency p99.9, well inside the end-to-end deadline'],
  interview: [
    { q: 'Walk through the circuit breaker state machine.', a: 'Closed: calls flow, outcomes go into a rolling window. When failures or slow calls exceed a threshold over a minimum number of calls, it opens: calls fail fast to a fallback for a cool-down. Then half-open: a few probes go through; success closes it, failure reopens it.' },
    { q: 'Circuit breaker vs retry vs timeout — how do they fit together?', a: 'Timeout bounds each attempt; retry (with backoff, jitter and a budget) handles transient blips; the breaker sits outside retries and stops all attempts when failure is persistent; bulkheads cap concurrency so one dependency can’t take all threads. Order: bulkhead → breaker → retry → timeout → call.' },
  ],
  lab: 'breaker',
};

const NAIVE_RETRY: Internals = {
  kind: 'naive-retry',
  summary:
    'Naive retry catches an error and immediately tries again, a fixed number of times, at every layer. It hides one-off blips, but when a dependency is slow because it is **overloaded**, each retry adds load exactly when there is least capacity, and retries multiply across layers. It turns a brief slowdown into a self-sustaining outage.',
  parts: [
    { id: 'client', name: 'Client', role: 'Times out and retries instantly', detail: 'An app or mobile client with a timeout and a `for (i = 0; i < 3; i++)` loop around the call; no sleep, no jitter, no check of whether the request is idempotent.' },
    { id: 'gateway', name: 'API gateway', role: 'Retries each failed upstream again', detail: 'The gateway/LB has its own retry policy (e.g. 3 attempts on 5xx/timeout) unaware that the client is also retrying.' },
    { id: 'service', name: 'Mid-tier service', role: 'Retries its DB/backend calls too', detail: 'The service’s HTTP/DB client library retries 3× by default. Three layers × 3 attempts each = **27 calls** to the bottom per user action.' },
    { id: 'queue', name: 'Backend queue', role: 'Fills with already-abandoned requests', detail: 'Requests whose callers already timed out stay in the backend’s accept queue and thread pool. The backend works on **zombie** requests whose answers nobody will read.' },
    { id: 'backend', name: 'Overloaded backend', role: 'Saturated; goodput collapses to zero', detail: 'At 100% CPU or connection limit, latency rises past every caller’s timeout, so nearly all completed work is wasted — a **metastable failure** that persists even after the original trigger is gone.' },
  ],
  flow: [
    { part: 'backend', title: 'A small trigger', text: 'A database failover makes the backend 3× slower for 20 s; p99 rises from 200 ms to 2 s.' },
    { part: 'client', title: 'Instant retries', text: 'Clients time out at 1 s and immediately retry. Because thousands of clients timed out at the same moment, their retries arrive in a synchronized wave.' },
    { part: 'gateway', title: 'Second layer multiplies', text: 'Each client attempt that times out at the gateway is retried 3× more upstream: 9 attempts per user action.' },
    { part: 'service', title: 'Third layer multiplies', text: 'The service retries each DB call 3×: up to **27×** the normal load reaches the database exactly when it has the least capacity.' },
    { part: 'queue', title: 'Zombie work', text: 'Queues fill with requests whose callers gave up; the backend spends its capacity on them while fresh requests wait and time out too.' },
    { part: 'backend', title: 'Metastable outage', text: 'The failover finished long ago, but retry traffic alone keeps the backend saturated. Only shedding load (blocking traffic, restarting fleets) recovers it — and a non-idempotent `POST /charge` may have been executed several times along the way.' },
  ],
  knobs: [
    {
      name: 'Backoff',
      options: [
        { label: 'None (immediate)', effect: 'Synchronized retry waves; maximal amplification.', when: 'Never.' },
        { label: 'Exponential', effect: 'Waits 100 ms, 200 ms, 400 ms…; spreads load over time but clients stay synchronized.', when: 'Better, but add jitter.' },
        { label: 'Exponential + full jitter', effect: '`sleep = random(0, min(cap, base × 2^attempt))` de-synchronizes clients; best total completion time in AWS’s analysis.', when: 'Default for every retry.' },
      ],
    },
    {
      name: 'Where to retry',
      options: [
        { label: 'Every layer', effect: 'Multiplicative amplification (3^layers).', when: 'Never.' },
        { label: 'One layer only', effect: 'Amplification bounded to the attempt count; usually at the edge or the layer closest to the failure.', when: 'Default; other layers fail fast and propagate the error.' },
      ],
    },
    {
      name: 'Budget and deadlines',
      options: [
        { label: 'Retry budget (≤ 10%)', effect: 'Retries allowed only while they are < ~10% of requests (token bucket); caps amplification at ~1.1× during outages.', when: 'Always, in clients and meshes.' },
        { label: 'Deadline propagation', effect: 'Remaining time travels with the request (gRPC deadlines); servers drop work whose deadline has passed, killing zombie work.', when: 'Any multi-hop RPC system.' },
      ],
    },
  ],
  implementations: [
    { name: 'Naive loop (the anti-pattern)', how: '`for i in range(3): try: return call() except: pass` — no sleep, retries everything including non-idempotent writes and 4xx errors, at every layer.' },
    { name: 'AWS SDKs (standard retry mode)', how: 'Exponential backoff with jitter plus a client-side **retry quota** token bucket: each retry spends tokens, successes refill them, so a failing dependency quickly stops receiving retries.' },
    { name: 'gRPC retry policy', how: '`maxAttempts`, backoff with jitter, retryable status codes only, and `retryThrottling` (token ratio) that disables retries when failures dominate; deadlines propagate across hops.' },
    { name: 'Envoy / Linkerd retry budgets', how: 'Envoy `retry_budget` (e.g. 20% of active requests) and Linkerd’s default 20% budget cap retries mesh-wide; combined with outlier detection and circuit breakers.' },
  ],
  ha: 'Naive retries reduce availability under stress: they convert overload into amplified overload and keep a recovered system down. Resilient systems make retries scarce and smart — idempotent operations only, one layer, jittered backoff, a budget, propagated deadlines — and combine them with circuit breakers and load shedding on the server (reject early with `429/503 Retry-After` rather than queueing).',
  failureModes: [
    { name: 'Retry storm / amplification', symptom: 'Load on the bottom tier jumps 9–27× during a minor slowdown.', fix: 'Retry at one layer, retry budget, exponential backoff with full jitter.' },
    { name: 'Metastable failure', symptom: 'Outage persists after the root cause is fixed.', fix: 'Load shedding, circuit breakers, deadline propagation, drop zombie work.' },
    { name: 'Duplicate side effects', symptom: 'Customers charged twice, duplicate emails or orders.', fix: 'Retry only idempotent operations; idempotency keys for writes.' },
    { name: 'Thundering herd on recovery', symptom: 'Service restarts and is immediately flattened by synchronized retries.', fix: 'Jitter, gradual traffic ramp, server-side admission control.' },
  ],
  numbers: ['3 layers × 3 attempts = 27× load at the bottom', 'Retry budget 10% ⇒ worst case ~1.1× load', 'Full jitter: sleep = random(0, min(cap, base·2^n)), e.g. base 100 ms, cap 10 s'],
  interview: [
    { q: 'Why can retries cause an outage, and how do you retry safely?', a: 'When a service is slow from overload, retries add load at the worst moment, and retries at several layers multiply (3 layers × 3 = 27×), keeping it saturated even after the trigger passes. Retry only idempotent calls, at one layer, with exponential backoff and full jitter, under a retry budget and the caller’s deadline, behind a circuit breaker.' },
    { q: 'What is jitter and why does it matter?', a: 'Randomizing the backoff delay. Without it, all clients that failed together retry together, producing synchronized waves that re-overload the server. Full jitter spreads retries uniformly over the backoff window, smoothing load and finishing the work sooner.' },
  ],
  lab: 'breaker',
};

export const STORAGE_INTERNALS: Internals[] = [
  OBJECT_STORE,
  SEARCH,
  SQL_LIKE,
  BLOB_COLUMN,
  NFS,
  EVENT_STORE,
  READ_MODEL,
  PROJECTOR,
  SAGA,
  TWO_PC,
  CIRCUIT_BREAKER,
  NAIVE_RETRY,
];
