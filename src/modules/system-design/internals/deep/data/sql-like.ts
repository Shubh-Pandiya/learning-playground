import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'sql-like',

  problem: {
    why: '`WHERE title ILIKE \'%shoe%\'` is the fastest way to ship a search box: no new infrastructure, it works in the demo, and the data is already in the database. But it is a brute-force **substring scan**, not search. Its cost grows linearly with table size, it runs on the system of record, and it has no notion of words, relevance, stemming or typos. It is tempting precisely because it fails late — on production data volumes, under real traffic.',
    withoutIt: [
      'Without a dedicated index, every search reads every row: 10M rows × 300 B ≈ 3 GB of page reads per keystroke-driven query.',
      'Search CPU and I/O land on the primary, so a burst of searches slows checkout, login and every other OLTP query sharing the box.',
      'Results come back unranked: `%shoe%` matches “horseshoe” as readily as “running shoe”, and `LIMIT 20` returns whichever rows the scan hit first.',
      'No tokenising, stemming, synonyms or typo tolerance: “running shoes” does not match “run shoe”, and “sheo” matches nothing.',
    ],
    position: 'Runs inside the relational primary (or a replica) on the synchronous request path: search endpoint → ORM → `SELECT … WHERE col LIKE \'%q%\'` → sequential scan over the table’s heap or clustered index.',
    diagram: {
      type: 'flow',
      title: 'What the query actually does',
      nodes: [
        { label: 'Search box', sub: '"shoe"' },
        { label: 'ILIKE %shoe%', sub: 'on primary', tone: 'warn' },
        { label: 'Planner', sub: 'no usable index', tone: 'info' },
        { label: 'Seq Scan', sub: 'every page, every row', tone: 'bad' },
        { label: 'Substring match', sub: 'per row, CPU', tone: 'bad' },
        { label: 'Unranked rows', sub: 'first 20 found' },
      ],
      caption: 'Cost ∝ table size, not result size.',
    },
  },

  architecture: {
    overview: 'There is no search architecture here — that is the point. The query passes through the normal SQL pipeline: the planner looks for an index whose ordering matches the predicate, finds that a B-tree sorted by `title` cannot seek to “contains shoe”, and falls back to a **sequential scan** (Postgres `Seq Scan`, MySQL `type: ALL`) or at best a full index scan. Each row is pattern-matched in the executor and survivors are returned in scan order.',
    diagram: {
      type: 'layers',
      title: 'The pieces involved',
      layers: [
        { name: 'App', items: ['search endpoint', 'ORM `contains` / `icontains`', 'no debounce'], tone: 'info' },
        { name: 'Planner', items: ['B-tree on title (unusable)', 'statistics guess selectivity', 'chooses Seq Scan'], tone: 'warn' },
        { name: 'Executor', items: ['scan all pages', 'LIKE / ILIKE per row', 'optional parallel workers'], tone: 'bad' },
        { name: 'Buffer pool / disk', items: ['ring buffer (Postgres)', 'midpoint LRU (InnoDB)', 'I/O contention'], tone: 'neutral' },
      ],
    },
    blocks: [
      { name: 'B-tree index', what: 'Ordered by the value’s leading bytes (under the column’s collation), so it can answer equality and **prefix** ranges only. `LIKE \'abc%\'` becomes `>= \'abc\' AND < \'abd\'`; a leading wildcard gives no range to seek.' },
      { name: 'Sequential scan', what: 'Reads every heap page (8 KB Postgres) or every leaf of the clustered index (16 KB InnoDB). Postgres can split it across parallel workers (`max_parallel_workers_per_gather`, 2 by default), which cuts latency but multiplies CPU per query.' },
      { name: 'Pattern matcher', what: 'Per-row byte/character comparison. `ILIKE` (or `LOWER(col) LIKE`) adds case folding per row; multi-byte UTF-8 and non-deterministic collations make it slower still.' },
      { name: 'Buffer pool protection', what: 'Postgres reads large seq scans (tables bigger than a quarter of `shared_buffers`) through a small **ring buffer** (256 KB) so they do not evict the whole cache; InnoDB inserts scanned pages at the old-sublist midpoint (`innodb_old_blocks_pct` 37, `innodb_old_blocks_time` 1000 ms). Cache survives, but disk bandwidth and CPU are still burned.' },
      { name: 'Collation', what: 'Decides case and accent sensitivity. MySQL’s default `utf8mb4_0900_ai_ci` makes `LIKE` case- and accent-insensitive; Postgres `LIKE` is case-sensitive, so people reach for `ILIKE`, which a plain B-tree cannot help.' },
      { name: 'LIMIT', what: 'Stops the scan early only once enough matches are found. Common terms return fast; rare or absent terms scan the entire table — the worst case is the “no results” search.' },
    ],
    real: [
      { name: 'PostgreSQL LIKE / ILIKE', how: 'Seq Scan + per-row match without a special index. Prefix patterns can use a B-tree only with the C collation or a `text_pattern_ops`/`varchar_pattern_ops` operator class.' },
      { name: 'PostgreSQL pg_trgm', how: 'Indexes every 3-character gram in a GIN or GiST index; `LIKE \'%shoe%\'` becomes a bitmap index scan over rows containing all query trigrams, then a recheck of the real pattern. Also offers `similarity()` and `%` for fuzzy matching.' },
      { name: 'Postgres full-text search', how: '`to_tsvector` tokenises and stems text into lexemes stored in a GIN inverted index; `to_tsquery`/`websearch_to_tsquery` match, `ts_rank` scores. Real words and stemming, modest ranking, no typo tolerance.' },
      { name: 'MySQL InnoDB FULLTEXT', how: 'Built-in inverted index (`MATCH … AGAINST`) with natural-language and boolean modes, stopwords, `innodb_ft_min_token_size` (3) and an ngram parser for CJK. Basic relevance; index updates applied at commit.' },
      { name: 'Elasticsearch / OpenSearch', how: 'Dedicated inverted index with analyzers (tokenize, lowercase, stem, synonyms), BM25 scoring, fuzzy queries, facets and horizontal sharding; fed from the DB via CDC (Debezium → Kafka → indexer).' },
    ],
  },

  lifecycle: {
    summary: '`SELECT id, title FROM products WHERE title ILIKE \'%shoe%\' ORDER BY created_at DESC LIMIT 20` on a 10M-row, ~3 GB Postgres table, partially cached, on the primary.',
    stages: [
      { stage: 'Network + parse', what: 'Query arrives from the app; parse/analyze as usual.', cost: 'RTT + µs', ms: 0.5 },
      { stage: 'Plan', what: 'No index supports `%shoe%`; planner estimates selectivity from statistics and picks a (parallel) Seq Scan, then a top-N sort.', cost: 'µs; but the plan is O(table)', ms: 0.1 },
      { stage: 'Scan heap pages', what: 'Read ~370k 8 KB pages. Cached pages cost memory bandwidth; uncached ones are disk reads.', cost: '~1 GB/s per core from cache; far less from disk', ms: 1500 },
      { stage: 'Per-row ILIKE', what: 'Case-fold and substring-match 10M titles.', cost: 'Tens to hundreds of ns per row', ms: 600 },
      { stage: 'Sort + limit', what: 'Every match must be collected to sort by `created_at`; LIMIT cannot stop the scan early because of ORDER BY.', cost: 'Top-N heapsort over matches', ms: 20 },
      { stage: 'Return', what: '20 rows sent back, no relevance score.', cost: 'RTT', ms: 0.5 },
    ],
  },

  deepDives: [
    {
      title: 'Why a B-tree cannot answer %term%',
      hook: 'Indexes are sorted by prefix; substrings have no prefix.',
      body: [
        'A B-tree stores keys in collation order, so it can find a contiguous range: everything starting with “shoe” sits between “shoe” and “shof”. Postgres rewrites `title LIKE \'shoe%\'` into `title >= \'shoe\' AND title < \'shof\'` — but only if the index uses the C collation or the `text_pattern_ops` operator class, because linguistic collations do not order strings byte-by-byte.',
        'With a leading wildcard, matching rows are scattered throughout the key space (“horseshoe”, “snowshoe”, “shoelace”). There is no range to seek, so the planner chooses between a **Seq Scan** and a **full index scan** (reading every leaf, useful only if the index covers the needed columns and is much smaller than the table). MySQL shows this as `type: ALL` or `type: index` in `EXPLAIN`.',
      ],
      diagram: {
        type: 'compare',
        title: 'Prefix vs substring',
        columns: [
          { name: "LIKE 'shoe%'", points: ['Contiguous key range', 'Index range scan', 'O(log n + matches)', 'Needs C / text_pattern_ops (PG)'], tone: 'ok' },
          { name: "LIKE '%shoe%'", points: ['Matches anywhere in key space', 'No seekable range', 'Seq Scan / full index scan', 'O(n) per query'], tone: 'bad' },
        ],
      },
      code: {
        lang: 'sql',
        caption: 'Prefix search that does use an index (Postgres)',
        code: `CREATE INDEX products_title_prefix ON products (lower(title) text_pattern_ops);

EXPLAIN SELECT id FROM products WHERE lower(title) LIKE 'shoe%';
-- Index Scan using products_title_prefix
--   Index Cond: (lower(title) ~>=~ 'shoe' AND lower(title) ~<~ 'shof')

EXPLAIN SELECT id FROM products WHERE lower(title) LIKE '%shoe%';
-- Seq Scan on products  Filter: (lower(title) ~~ '%shoe%')`,
      },
      insight: 'Autocomplete over names (“starts with”) is a legitimate B-tree use case — just index `lower(col)` with `text_pattern_ops` and query the same expression. The anti-pattern is specifically the **leading** wildcard.',
    },
    {
      title: 'The cost math: latency and CPU vs table size',
      hook: 'It is fast in staging because staging has 10k rows.',
      body: [
        'Scan cost is linear in table bytes. At roughly 1 GB/s of cached scan + match per core, a 30 MB table answers in ~30 ms; a 3 GB table takes ~3 core-seconds; a 30 GB table ~30 core-seconds. Parallel workers reduce latency but not total CPU. Disk-bound scans are slower still and compete with the OLTP working set.',
        'Throughput is the bigger problem: at 3 core-seconds per search, a 32-core primary that is otherwise idle can serve about 10 searches/s before it is saturated. Add `ORDER BY created_at` and `LIMIT` cannot stop early; search for an absent term and the whole table is read every time.',
      ],
      table: {
        caption: 'Approximate cost of one %term% search (cached, ~1 GB/s/core)',
        columns: ['Rows (≈300 B)', 'Table size', 'Core-seconds/query', 'Max QPS on 32 cores', 'With pg_trgm GIN'],
        rows: [
          ['10k', '3 MB', '0.003', '~10,000', 'Not needed'],
          ['1M', '300 MB', '0.3', '~100', '~1–10 ms'],
          ['10M', '3 GB', '3', '~10', '~1–20 ms'],
          ['100M', '30 GB', '30', '~1', '~5–50 ms, depends on term'],
        ],
      },
      insight: 'Always test search with production-sized data and the **no-results** query. Plot p99 against table size; a straight line upward is the signature of a scan.',
    },
    {
      title: 'Collation and case: the hidden second scan tax',
      hook: 'ILIKE and LOWER() quietly disable the indexes you did build.',
      body: [
        'Postgres `LIKE` is case-sensitive, so teams switch to `ILIKE` or `lower(title) LIKE`, which a plain B-tree on `title` cannot serve even for prefix patterns. You need an expression index on `lower(title)`, a `citext` column, or pg_trgm (which supports `ILIKE` directly). Non-deterministic ICU collations in Postgres do not support `LIKE` at all before PG18.',
        'MySQL’s default `utf8mb4_0900_ai_ci` collation makes `LIKE` case- and accent-insensitive “for free”, which surprises people the other way: “resume” matches “résumé”, and changing the collation later changes query results and index ordering. Unicode normalisation (precomposed vs combining accents) can make visually identical strings fail to match in either engine.',
      ],
      insight: 'Matching rules (case, accents, normalisation, language) are search-relevance decisions. A search engine makes them explicit in analyzers; SQL hides them in column collations that are painful to change later.',
    },
    {
      title: 'Postgres pg_trgm: substring search with an index',
      hook: 'The quickest real fix when you must stay inside Postgres.',
      body: [
        'pg_trgm splits text into 3-character grams (“shoe” → `"  s"`, `" sh"`, `"sho"`, `"hoe"`, `"oe "`) and stores them in a **GIN** inverted index (or GiST for nearest-neighbour similarity). A `LIKE`/`ILIKE \'%shoe%\'` or regex query extracts the pattern’s trigrams, intersects their posting lists into a bitmap of candidate rows, then rechecks each candidate against the real pattern.',
        'Limits: patterns shorter than 3 characters yield no usable trigrams and degrade to a full index scan; very common trigrams produce huge candidate sets; the GIN index is often 2–3× the size of the indexed text and slows writes (GIN `fastupdate` pending lists help, at the cost of occasional slow flushes). It gives fuzzy `similarity()`, but still no word semantics or BM25-style ranking.',
      ],
      code: {
        lang: 'sql',
        caption: 'pg_trgm setup',
        code: `CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY products_title_trgm
  ON products USING gin (title gin_trgm_ops);

EXPLAIN ANALYZE SELECT id, title FROM products WHERE title ILIKE '%shoe%' LIMIT 20;
-- Bitmap Heap Scan on products  Recheck Cond: (title ~~* '%shoe%')
--   -> Bitmap Index Scan on products_title_trgm

-- Typo-tolerant-ish lookup
SELECT title, similarity(title, 'sheo') AS s
FROM products WHERE title % 'sheo' ORDER BY s DESC LIMIT 10;`,
      },
      insight: 'pg_trgm is the right tool for **fuzzy lookup** of names, emails, SKUs and admin search; it is not a relevance engine. If product people start asking for “better ranking”, that is the signal to move to an inverted index with BM25.',
    },
    {
      title: 'In-database full-text search: tsvector and FULLTEXT',
      hook: 'Words, stemming and ranking without new infrastructure.',
      body: [
        'Postgres full-text search tokenises and stems text into a `tsvector` (“running shoes” → `run`, `shoe`), indexes it with **GIN**, and matches `tsquery` expressions (`websearch_to_tsquery` accepts Google-like syntax). `ts_rank`/`ts_rank_cd` score by term frequency and proximity, and `setweight` lets title outrank body. A stored generated column keeps the vector in sync transactionally.',
        'MySQL InnoDB `FULLTEXT` indexes provide `MATCH (title, body) AGAINST (?)` in natural-language or boolean mode with stopwords and a minimum token size. Both are good enough for modest corpora (up to a few million documents) and simple relevance; neither offers typo tolerance, rich analyzers per language, facets at scale, or independent scaling from the OLTP primary.',
      ],
      code: {
        lang: 'sql',
        caption: 'Postgres FTS with a generated column',
        code: `ALTER TABLE products ADD COLUMN search tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;
CREATE INDEX CONCURRENTLY products_search ON products USING gin (search);

SELECT id, title, ts_rank(search, q) AS rank
FROM products, websearch_to_tsquery('english', 'running shoes') q
WHERE search @@ q
ORDER BY rank DESC LIMIT 20;`,
      },
      insight: 'Ranking with `ts_rank` requires scoring every matching row before `LIMIT`, so broad queries on large tables get slow again; it is a mid-scale tool, not a forever answer.',
    },
    {
      title: 'The real fix: CDC into Elasticsearch/OpenSearch',
      hook: 'Move search off the system of record, keep the DB as the source of truth.',
      body: [
        'Stream row changes from the WAL/binlog with Debezium into Kafka; an indexer service denormalises and upserts documents into Elasticsearch/OpenSearch (using the row version or LSN as an external version to make out-of-order updates safe). Search queries hit the search cluster: inverted index, analyzers, BM25, fuzzy matching, facets, horizontal sharding and replicas.',
        'Consequences to design for: search is **eventually consistent** (index refresh is 1 s by default plus pipeline lag), so read-your-writes UIs may need to show the just-created item from the DB; you need a bulk **reindex** path (snapshot + stream catch-up, alias swap) for mapping changes; and deletes must flow through CDC too.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Write path and search path',
        actors: ['App', 'Postgres', 'Debezium', 'Kafka', 'Indexer', 'Search'],
        messages: [
          { from: 'App', to: 'Postgres', label: 'INSERT / UPDATE product' },
          { from: 'Postgres', to: 'Debezium', label: 'logical decoding (slot)', dashed: true },
          { from: 'Debezium', to: 'Kafka', label: 'change event' },
          { from: 'Kafka', to: 'Indexer', label: 'consume, denormalise' },
          { from: 'Indexer', to: 'Search', label: 'bulk upsert (version)', tone: 'accent' },
          { from: 'App', to: 'Search', label: 'match "running shoes"', tone: 'ok' },
          { from: 'Search', to: 'App', label: 'BM25-ranked ids', dashed: true, tone: 'ok' },
        ],
        caption: 'The primary never sees search traffic; lag is typically sub-second to seconds.',
      },
      insight: 'Prefer CDC over dual writes from the app: dual writes drift on partial failures, while CDC replays from the log and can rebuild the whole index from a snapshot.',
    },
  ],

  scaling: {
    body: [
      'A `%term%` scan cannot be scaled within itself: cost per query is O(table size), so both more rows and more queries multiply load on the same database. Parallel query trades latency for more CPU per query; read replicas spread the pain but each replica still scans the full table and replay lag grows when they are saturated.',
      'The scaling path is to change the data structure: an index whose lookup cost depends on the query, not the table (trigram GIN, tsvector GIN), and then a separate, horizontally sharded search cluster fed asynchronously, so search capacity scales independently of the OLTP primary.',
    ],
    bullets: [
      'Short term: statement timeout on search queries, run them on a replica, debounce the UI and require ≥ 3 characters.',
      'Medium term: pg_trgm GIN for substring/fuzzy lookup, or tsvector GIN for word search with ranking.',
      'Long term: Elasticsearch/OpenSearch via CDC; DB remains source of truth.',
      'Cache popular queries; most search traffic follows a Zipf distribution.',
      'Never let search traffic share a connection pool with checkout/login paths.',
    ],
    diagram: {
      type: 'flow',
      title: 'Migration path',
      nodes: [
        { label: "LIKE '%q%'", sub: 'O(n) scan', tone: 'bad' },
        { label: 'Timeouts + replica', sub: 'contain blast radius', tone: 'warn' },
        { label: 'pg_trgm / tsvector', sub: 'indexed, in-DB', tone: 'info' },
        { label: 'CDC → search', sub: 'BM25, scale-out', tone: 'ok' },
      ],
    },
  },

  failures: [
    {
      name: 'Primary saturated by search',
      symptom: 'Search traffic spikes (marketing email, bot crawl); CPU and I/O hit 100% and unrelated queries (checkout, login) time out.',
      detect: '`pg_stat_statements` top by total time showing the `ILIKE` fingerprint; `Seq Scan` counts in `pg_stat_user_tables.seq_scan` and `seq_tup_read` rising; CPU and disk read throughput on the primary.',
      mitigate: 'Statement timeout and a separate pool for search, route to a replica immediately, then add a trigram/FTS index or move to a search engine.',
    },
    {
      name: 'Latency grows with the table',
      symptom: 'Search p99 creeps from 50 ms to seconds over months without any code change.',
      detect: 'p99 by endpoint plotted against table row count; `EXPLAIN` showing `Seq Scan` / `type: ALL`; slow-query log entries for the search query.',
      mitigate: 'Index-backed search (pg_trgm, tsvector, FULLTEXT) or an external search engine; test with production-sized data.',
    },
    {
      name: 'Worst case on no-result queries',
      symptom: 'Typos and rare terms are the slowest searches because LIMIT never stops the scan; bots probing random strings cause outages.',
      detect: 'Latency split by result count (zero-hit queries); query logs with high-entropy terms.',
      mitigate: 'Rate limit search per client, minimum query length, cache, and an index whose cost depends on matches.',
    },
    {
      name: 'Poor relevance and missed matches',
      symptom: 'Users report “search is broken”: plurals, stems and typos miss, substrings like “horseshoe” rank first; conversion from search drops.',
      detect: 'Search analytics: zero-result rate, click-through on top results, reformulation rate.',
      mitigate: 'Analyzers with stemming and synonyms, BM25 ranking, fuzzy matching — an inverted index.',
    },
    {
      name: 'Index built but not used',
      symptom: 'A team adds a B-tree on `title` and nothing improves, or a trigram index is ignored for 1–2 character queries.',
      detect: '`EXPLAIN ANALYZE` still shows Seq Scan; `pg_stat_user_indexes.idx_scan` stays 0.',
      mitigate: 'Match the operator class to the query (`gin_trgm_ops`, `text_pattern_ops`, expression on `lower(col)`), enforce ≥ 3-character queries.',
    },
  ],

  warStories: [
    {
      title: 'The admin search that took down checkout',
      source: 'Composite of common incidents',
      what: 'An internal support tool searched orders with `WHERE email ILIKE \'%\' || ? || \'%\'` against the production primary. It was fine for years; after the orders table passed ~50M rows, each search took ~20 s. During a busy sale, a support team of 40 ran searches in parallel, saturating CPU and I/O on the primary, and customer checkouts started timing out.',
      lesson: 'Internal tools are production traffic. Put statement timeouts and a separate replica/pool behind them, and index the lookup (exact email match or pg_trgm) instead of substring scanning.',
    },
    {
      title: 'Search was fast in staging',
      source: 'Composite of common incidents',
      what: 'A product search shipped using `LIKE \'%q%\'` across title and description. Staging had 20k products and answered in 15 ms. Production had 8M products plus `ORDER BY popularity`, so every query scanned and sorted all matches; p99 hit 4 s on launch day, autoscaled app pods added more concurrent queries, and the database fell over.',
      lesson: 'Validate query plans against production-sized data before launch, and understand that autoscaling the app tier multiplies load on a shared database.',
    },
  ],

  numbers: [
    { label: 'Scan throughput', value: '~0.5–2 GB/s per core', note: 'Cached; disk-bound is much slower' },
    { label: '10M rows × 300 B', value: '~3 GB per query', note: 'Read for every %term% search' },
    { label: 'B-tree prefix lookup', value: 'O(log n), ~ms', note: "LIKE 'abc%' with the right opclass" },
    { label: 'pg_trgm GIN size', value: '~2–3× text', note: 'Indexed column size; slows writes' },
    { label: 'Trigram minimum', value: '3 characters', note: 'Shorter patterns cannot use the index well' },
    { label: 'Postgres seq-scan ring buffer', value: '256 KB', note: 'For tables > ¼ shared_buffers' },
    { label: 'MySQL FULLTEXT min token', value: '3', note: '`innodb_ft_min_token_size` default' },
    { label: 'Elasticsearch refresh', value: '1 s', note: 'Default `refresh_interval`; search is near-real-time' },
  ],

  capacity: {
    question: 'A marketplace has 20M listings (~400 B of searchable text each) and expects 200 searches/s at peak. Can `ILIKE \'%q%\'` on the primary handle it?',
    steps: [
      'Bytes per search: 20M × 400 B ≈ 8 GB of row data read per query (more with page overhead).',
      'CPU per search at ~1 GB/s/core cached: ~8 core-seconds.',
      'Peak demand: 200 searches/s × 8 core-s = 1,600 cores — about 25 of the largest single-socket database servers, just for search.',
      'With a trigram GIN index: typical queries touch thousands of candidates ⇒ ~5–20 ms, ~0.01 core-s ⇒ ~2 cores at peak, but relevance is still poor.',
      'With an Elasticsearch cluster: ~10–30 ms per query, scales by replicas, ranking with BM25, and zero load on the primary.',
    ],
    answer: 'No: the scan approach needs on the order of a thousand cores. An index-backed approach reduces it by about three orders of magnitude; for a product-facing marketplace search, use a search engine fed by CDC.',
  },

  comparison: {
    caption: 'Options for “find rows containing text”',
    columns: ['Approach', 'Query cost', 'Relevance / typos', 'Write cost', 'Use when'],
    rows: [
      ["LIKE '%q%'", 'O(table) scan', 'None / none', 'None', 'Tables < ~100k rows, low-QPS admin tools'],
      ["LIKE 'q%' + B-tree", 'O(log n)', 'None / none', 'One B-tree', 'Prefix autocomplete on names, codes'],
      ['pg_trgm GIN', 'O(candidates)', 'Similarity only / some', 'Heavy GIN updates', 'Fuzzy lookup of names, emails, SKUs'],
      ['Postgres FTS / MySQL FULLTEXT', 'O(matches) + rank', 'Stemming, basic rank / none', 'Inverted index updates', 'Modest corpora, one database'],
      ['Elasticsearch / OpenSearch', 'O(top-k) with BM25', 'Analyzers, BM25 / fuzzy', 'Async via CDC', 'Any real product search'],
    ],
  },

  whenNot: [
    'Do not use it for any user-facing search over a table that grows: use Postgres FTS for modest needs or Elasticsearch/OpenSearch via CDC.',
    'Do not run it on the primary under real traffic: at minimum route to a replica with a statement timeout.',
    'Do not use it when relevance, stemming or typo tolerance matter: those need analyzers and an inverted index.',
    'It IS fine for small tables (≲ 100k rows), internal admin screens with low QPS, one-off analyst queries, and prefix patterns (`LIKE \'abc%\'`) backed by a `text_pattern_ops` B-tree.',
  ],

  interview: [
    {
      q: 'Why can’t the database use an index for `LIKE \'%term%\'`, and what are your options?',
      a: 'A B-tree is ordered by the leading characters of the key, so it can only seek to a contiguous range such as a prefix. A substring can occur anywhere, so matching keys are scattered and the planner must scan the whole table or index. Options: a trigram GIN index (pg_trgm) that indexes every 3-gram and rechecks candidates, in-DB full-text search (tsvector GIN, MySQL FULLTEXT) for word-level matching and ranking, or an external search engine fed by CDC for real relevance and scale.',
      followUps: [
        'When does `LIKE \'abc%\'` use an index in Postgres, and when not?',
        'What happens with a 2-character query on a trigram index?',
        'How would you rank results?',
      ],
      seniorSignal: 'Explains the mechanism (prefix ordering) and maps each alternative to its trade-offs instead of jumping straight to “use Elasticsearch”.',
    },
    {
      q: 'Search latency has grown from 50 ms to 3 s over six months. Diagnose and plan a fix.',
      a: 'Linear growth with data and no code change points to a scan: confirm with `EXPLAIN (ANALYZE, BUFFERS)` and `pg_stat_statements`, and check `seq_tup_read` on the table. Immediately contain it: statement timeout, route search to a replica, rate-limit and require ≥ 3 characters. Then add a pg_trgm or tsvector GIN index built concurrently, and if the product needs relevance, plan a CDC-fed search cluster with a backfill and a feature-flagged cut-over.',
      followUps: [
        'How do you prevent the search fix from hurting write latency?',
        'How do you backfill the search index without downtime?',
        'What metrics prove the fix worked?',
      ],
      seniorSignal: 'Separates containment from the structural fix and considers the write-path cost of new indexes.',
    },
    {
      q: 'How would you keep Elasticsearch in sync with Postgres?',
      a: 'Use CDC rather than dual writes: Debezium reads the WAL through a logical replication slot, publishes change events to Kafka keyed by primary key, and an indexer upserts documents with the row version as an external version so stale events cannot overwrite newer ones. Bootstrap with a snapshot then stream; do mapping changes by reindexing into a new index and swapping an alias. Monitor slot lag (it pins WAL on the primary) and consumer lag, and handle deletes and tombstone events.',
      followUps: [
        'What if the indexer is down for a day?',
        'How do you give users read-your-writes on search?',
        'Why not write to both from the app?',
      ],
      seniorSignal: 'Handles ordering (external versions), reindexing via aliases, and the WAL-retention risk of a stalled slot.',
    },
    {
      q: 'When is `LIKE` perfectly fine?',
      a: 'When the table is small enough that a scan costs a few milliseconds (≲ 100k rows), the QPS is low (internal admin tools, analyst queries), or the pattern is a prefix backed by a suitable B-tree (`text_pattern_ops`, or an expression index on `lower(col)`). It is also fine on a replica or warehouse for ad-hoc investigation. The key is to bound it with a statement timeout and to revisit when the table grows.',
      followUps: [
        'How would you enforce that bound automatically?',
        'What changes if the admin tool gets 50 users?',
      ],
      seniorSignal: 'Gives concrete thresholds and guardrails instead of a blanket “never”.',
    },
    {
      q: 'pg_trgm, Postgres FTS or Elasticsearch for a 2M-document help-center search?',
      a: 'Help-center search is word-based with relevance needs (title over body, stemming), modest size and low write rate, so Postgres FTS with a weighted generated tsvector column and GIN is a reasonable first choice with no new infrastructure. pg_trgm fits fuzzy name/ID lookup rather than prose. Move to Elasticsearch/OpenSearch when you need typo tolerance, synonyms, multiple languages, facets, analytics on queries, or the search load starts to threaten the primary.',
      followUps: [
        'How would you add typo tolerance in Postgres?',
        'How would you measure search quality?',
        'What would trigger the move to Elasticsearch?',
      ],
      seniorSignal: 'Matches the tool to corpus size, relevance needs and operational cost, and names the triggers for the next step.',
    },
  ],

  takeaways: [
    "`LIKE '%q%'` is an O(table) scan per query; B-trees only help prefixes.",
    'It fails late: fine at 10k rows, an outage at 10M rows under real traffic.',
    'No ranking, stemming or typo tolerance — it is substring matching, not search.',
    'pg_trgm fixes substring/fuzzy lookup; tsvector/FULLTEXT add words and basic ranking.',
    'Real search belongs in an inverted index (Elasticsearch/OpenSearch) fed by CDC.',
    'Contain it first: statement timeout, replica, separate pool, min query length.',
    'It is fine for small tables, admin tools and prefix patterns with the right opclass.',
  ],
};

export default deep;
