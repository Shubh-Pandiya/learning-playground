import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'search',

  problem: {
    why: 'A B-tree answers "rows where column = value"; it cannot answer "documents most relevant to these words, tolerant of typos, stems and synonyms, ranked, faceted, in 20 ms". `LIKE \'%shoe%\'` is a full scan with no ranking. A search engine precomputes an **inverted index** (term → sorted doc ids) plus per-field columnar data, so queries become merges of short sorted lists and ranking is arithmetic on stored statistics. It is a derived read model fed from your source of truth.',
    withoutIt: [
      '`ILIKE \'%term%\'` scans the table on every keystroke and melts the primary (see `sql-like`).',
      'No relevance ranking: results are in insertion order, not "best match first".',
      'No stemming, synonyms, typo tolerance or language handling — "running shoes" misses "run shoe".',
      'Facets ("brand: 31, size: 12") need GROUP BY over every match on every query.',
      'Text search load competes with transactional writes on the same database.',
    ],
    position: 'A read-side replica of your data: the DB stays the system of record, a CDC/outbox pipeline feeds an indexer, and the API queries the search cluster for ids/snippets, then hydrates from cache/DB if needed.',
    diagram: {
      type: 'flow',
      title: 'Search as a derived read model',
      nodes: [
        { label: 'Primary DB', sub: 'source of truth', tone: 'ok' },
        { label: 'CDC / outbox', sub: 'Debezium, binlog' },
        { label: 'Kafka', sub: 'ordered per doc id', tone: 'info' },
        { label: 'Indexer', sub: 'bulk, external version', tone: 'accent' },
        { label: 'Search cluster', sub: 'ES / OpenSearch', tone: 'violet' },
        { label: 'Search API', sub: 'query + hydrate' },
      ],
      caption: 'Writes never dual-write from request handlers; the index lags the DB by seconds.',
    },
  },

  architecture: {
    overview: 'Elasticsearch/OpenSearch distribute **Apache Lucene**. An index is N primary shards, each a full Lucene index made of immutable **segments**, plus replica copies. Writes go to the primary shard (routed by `hash(_routing) % primaries`), are logged to a translog and replicated; a periodic **refresh** makes them searchable. Queries scatter to one copy of every shard and gather a global top-k. A small set of master nodes owns the **cluster state** (mappings, shard allocation).',
    diagram: {
      type: 'layers',
      title: 'Elasticsearch / OpenSearch cluster',
      layers: [
        { name: 'Coordinating', items: ['Parse + analyze query', 'Route by _routing', 'Scatter / gather', 'Reduce aggs'], tone: 'accent' },
        { name: 'Shard (data nodes)', items: ['Indexing buffer', 'Translog', 'Lucene segments', 'Query + fetch'], tone: 'ok' },
        { name: 'Lucene segment', items: ['Terms dict (FST)', 'Postings + skips', 'Doc values', 'Stored _source', 'Live-docs bitset'], tone: 'info' },
        { name: 'Control plane', items: ['3 master-eligible nodes', 'Cluster state', 'Shard allocation', 'Mappings'], tone: 'violet' },
      ],
      caption: 'Data plane: coordinators + shards. Control plane: elected master publishing cluster state.',
    },
    blocks: [
      { name: 'Analyzer chain', what: 'Char filters → tokenizer → token filters (lowercase, stop, stemmer, synonym_graph, asciifolding, edge_ngram). Determines the only terms the index will ever know; index-time and query-time analysis must be compatible.' },
      { name: 'Terms dictionary + FST index', what: 'Lucene’s BlockTree terms dict stores sorted terms in blocks (`.tim`); an **FST** (`.tip`) maps term prefixes to blocks, compressing shared prefixes and suffixes so lookup is a few memory hops. Loaded off-heap via mmap in modern versions.' },
      { name: 'Postings lists', what: 'Per term: sorted doc ids (delta-encoded, bit-packed in blocks of 128, vInt tail), term frequencies, and optionally positions/offsets (`.pos`, `.pay`) for phrase queries and highlighting. Skip data and per-block max-score "impacts" let queries jump ahead.' },
      { name: 'Doc values', what: 'Column-oriented, on-disk per-field values (`keyword`, numbers, dates) used for sorting, aggregations and scripts. Built at index time; `text` fields have none, which is why aggregating on `text` requires heap-hungry `fielddata`.' },
      { name: 'Stored fields / _source', what: 'The original JSON, compressed in blocks (LZ4 by default, DEFLATE with `best_compression`). Read only in the fetch phase for the final hits — never for matching.' },
      { name: 'Translog', what: 'Per-shard write-ahead log. With `index.translog.durability: request` (default) it is fsynced before the write is acknowledged, so acked docs survive a crash before they are in a committed segment.' },
      { name: 'Merge scheduler', what: '`TieredMergePolicy` merges similar-sized segments in the background (max merged segment ~5 GB by default), purging deleted docs. Merges are the main source of indexing I/O.' },
      { name: 'Cluster state + masters', what: 'Mappings, settings, index metadata and the shard routing table, published by the elected master to every node. Quorum-based election among master-eligible nodes (since 7.0 no `minimum_master_nodes` to misconfigure).' },
    ],
    real: [
      { name: 'Elasticsearch', how: 'Lucene + distribution (shards, replicas, translog, cluster coordination), REST/JSON DSL, aggregations, ILM, kNN on Lucene HNSW. Licensed SSPL/Elastic License from 2021; AGPL added as an option in 2024.' },
      { name: 'OpenSearch', how: 'AWS-led fork of Elasticsearch 7.10.2 (2021) under Apache 2.0. Same Lucene core and mostly compatible APIs; diverging features (segment replication, k-NN plugin with Faiss/nmslib engines, remote-backed storage).' },
      { name: 'Apache Solr', how: 'Also Lucene. SolrCloud keeps cluster state and per-shard leader election in **ZooKeeper**; strong faceting heritage; config via schema files and collections API.' },
      { name: 'GitHub code search (Blackbird)', how: 'GitHub moved code search off Elasticsearch to a custom Rust engine (2023) using n-gram indexes and content-deduplicated shards, because general-purpose full-text indexing of 100+ TB of code was too slow and costly to index and query.' },
      { name: 'Algolia / Typesense / Meilisearch', how: 'Product-search engines: mostly in-memory indexes, prefix/typo tolerance built in, rule-based ranking tie-breaks instead of BM25 tuning. Algolia is hosted SaaS; Typesense (C++) and Meilisearch (Rust, LMDB) are open source.' },
    ],
  },

  lifecycle: {
    summary: 'A user types "running shoes" on an e-commerce site with a 4-primary-shard index, 2 replicas each. The query-then-fetch protocol takes ~20 ms end to end.',
    stages: [
      { stage: 'Request to coordinator', what: 'API sends `_search` to any node (or a dedicated coordinating-only node) over a pooled HTTP connection.', cost: 'Intra-DC RTT + JSON parse', ms: 1 },
      { stage: 'Query analysis + rewrite', what: 'Query text analyzed into `[run, shoe]`, synonyms expanded, query tree rewritten (bool, multi_match).', cost: 'CPU, microseconds to sub-ms', ms: 0.3 },
      { stage: 'Scatter', what: 'One copy of each of 4 shards chosen via adaptive replica selection; shard requests sent in parallel.', cost: 'Network fan-out', ms: 0.5 },
      { stage: 'Query phase per shard', what: 'Lookup terms in FST, iterate postings with skips, score with BM25, keep top-10 heap; compute aggregations from doc values.', cost: 'Dominant cost; tail = slowest shard', ms: 8 },
      { stage: 'Reduce', what: 'Coordinator merges 4 × 10 (id, score) pairs into global top 10 and merges partial aggregations.', cost: 'CPU, small', ms: 0.5 },
      { stage: 'Fetch phase', what: 'Coordinator asks only the shards holding the 10 winners for `_source`; decompress stored-field blocks.', cost: 'Second round trip + disk/page cache', ms: 3 },
      { stage: 'Highlight', what: 'Re-analyze or use stored offsets to mark matched terms in snippets.', cost: 'CPU per hit', ms: 2 },
      { stage: 'Response', what: 'Serialize JSON, return to API; API may hydrate prices/stock from cache.', cost: 'Serialization + RTT', ms: 1 },
    ],
  },

  deepDives: [
    {
      title: 'Inside a Lucene segment',
      hook: 'Search speed comes from compressed, sorted, immutable files that the OS page cache can hold.',
      body: [
        'A segment is a self-contained mini index. Looking up a term walks the **FST** terms index (a minimal automaton sharing prefixes and suffixes) to a block in the terms dictionary, which points to the term’s postings. Because segments are immutable, all of this can be written once, compressed aggressively and served via mmap from the page cache with no locking.',
        'Postings store doc ids as **deltas** (gaps between sorted ids), bit-packed 128 at a time (frame-of-reference: each block uses the bit width of its largest gap), with a vInt-encoded tail. Common terms compress to a bit or two per doc. Skip data lets a conjunction (`run AND shoe`) jump over blocks instead of decoding every id.',
        'Since Lucene 8, postings also carry per-block **impacts** (max term frequency / min norm), enabling **block-max WAND**: blocks whose best possible score cannot enter the current top-k are skipped. That is why Elasticsearch 7+ defaults `track_total_hits` to 10,000 — exact total counts would force visiting every match and disable the skipping.',
      ],
      diagram: {
        type: 'flow',
        title: 'Term lookup to doc ids',
        nodes: [
          { label: 'Query term', sub: '"shoe"' },
          { label: 'FST index', sub: '.tip, prefix → block', tone: 'accent' },
          { label: 'Terms block', sub: '.tim, docFreq + ptr', tone: 'info' },
          { label: 'Postings', sub: '.doc deltas + freqs', tone: 'ok' },
          { label: 'Positions', sub: '.pos, phrases only' },
          { label: 'Live docs', sub: '.liv, drop deleted', tone: 'warn' },
        ],
      },
      code: {
        lang: 'text',
        caption: 'Delta + bit-packing of a postings block',
        code: `doc ids:   [3, 7, 8, 21, 22, 40 ...]
deltas:    [3, 4, 1, 13, 1, 18 ...]
max delta in this 128-doc block = 18 -> 5 bits per entry
128 ids x 5 bits = 80 bytes instead of 512 bytes (int32)
remaining < 128 ids: vInt (7 bits per byte, high bit = continue)`,
      },
      insight: 'Deletes and updates do not modify segments; they flip a bit in `.liv` and add a new doc. Update-heavy indexes (inventory counts, view counters) churn segments and merges — keep fast-changing fields out of the search doc or update them in batches.',
    },
    {
      title: 'Write path: buffer, translog, refresh, flush, merge',
      hook: 'Durable and searchable are two different moments, separated by about a second.',
      body: [
        'An index request is routed to the primary shard, analyzed, added to the in-memory **indexing buffer** and appended to the **translog**. The primary forwards the operation to all in-sync replicas in parallel and acknowledges only after they apply it. With `durability: request` each ack implies an fsynced translog.',
        'A **refresh** (default `index.refresh_interval: 1s`) writes the buffer into a new segment and opens a new searcher — the doc becomes visible ("near-real-time"). Refresh does not fsync. Since 7.0, shards that have not been searched for 30 s (`index.search.idle.after`) skip scheduled refreshes until the next search, which is why the first query after a quiet period can be slower.',
        'A **flush** is a Lucene commit: fsync segments and start a new translog generation, triggered by translog size. **Merges** combine small segments in the background. For bulk loads, set `refresh_interval: -1` and `number_of_replicas: 0`, then restore both — often a 2–5× indexing speedup.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Index one document',
        actors: ['Client', 'Coordinator', 'Primary', 'Translog', 'Replica', 'Segments'],
        messages: [
          { from: 'Client', to: 'Coordinator', label: 'PUT /products/_doc/42' },
          { from: 'Coordinator', to: 'Primary', label: 'route: hash(42) % 4 = 1' },
          { from: 'Primary', to: 'Translog', label: 'append + fsync' },
          { from: 'Primary', to: 'Replica', label: 'replicate op (seq_no)', tone: 'info' },
          { from: 'Replica', to: 'Primary', label: 'ack', dashed: true },
          { from: 'Primary', to: 'Coordinator', label: 'ok', dashed: true },
          { from: 'Coordinator', to: 'Client', label: '201 (not yet searchable)', dashed: true, tone: 'warn' },
          { from: 'Primary', to: 'Segments', label: 'refresh ≤1 s: new segment', tone: 'ok' },
        ],
      },
      table: {
        columns: ['Operation', 'Trigger', 'Makes searchable', 'Durable on disk', 'Cost'],
        rows: [
          ['Index + translog', 'every request', 'no', 'yes (translog fsync)', 'low'],
          ['Refresh', '1 s (default)', 'yes', 'no (OS cache)', 'small segment per refresh'],
          ['Flush', 'translog size', 'no change', 'yes (Lucene commit)', 'fsync of segments'],
          ['Merge', 'merge policy', 'no change', 'yes', 'heavy I/O + CPU'],
        ],
      },
      insight: '`?refresh=true` on every write in tests or "to make it consistent" creates one tiny segment per doc and destroys indexing throughput. Use `refresh=wait_for` sparingly, or design the UX to tolerate ~1 s lag (show the user’s own write from the DB).',
    },
    {
      title: 'Analysis and BM25 relevance',
      hook: 'Relevance bugs are almost always analysis bugs: the terms you indexed are not the terms you searched.',
      body: [
        'BM25 scores each matching term by IDF (rare terms weigh more) times a saturating term-frequency component normalized by field length: `k1` (default 1.2) controls how fast extra occurrences stop mattering, `b` (0.75) how much long fields are penalized. Scores are summed across query clauses and boosted per field.',
        'Statistics (doc count, doc frequency) are **per shard** by default. With few documents or skewed routing, the same doc scores differently depending on its shard; `dfs_query_then_fetch` gathers global stats first at the cost of an extra round trip — rarely needed at large scale where shards are statistically similar.',
        'Use query-time `synonym_graph` (synonyms can change without reindexing and multi-word synonyms are handled correctly). Use `edge_ngram` only on a dedicated autocomplete subfield, and `keyword` subfields for exact match, sorting and facets.',
      ],
      code: {
        lang: 'json',
        caption: 'Index settings: analyzer with stemming and query-time synonyms',
        code: `{
  "settings": { "analysis": {
    "filter": {
      "en_stem": { "type": "stemmer", "language": "light_english" },
      "syn":     { "type": "synonym_graph", "synonyms_path": "analysis/syn.txt", "updateable": true }
    },
    "analyzer": {
      "idx": { "tokenizer": "standard", "filter": ["lowercase", "asciifolding", "en_stem"] },
      "qry": { "tokenizer": "standard", "filter": ["lowercase", "asciifolding", "syn", "en_stem"] }
    }
  }},
  "mappings": { "dynamic": "strict", "properties": {
    "title": { "type": "text", "analyzer": "idx", "search_analyzer": "qry",
               "fields": { "raw": { "type": "keyword" } } },
    "brand": { "type": "keyword" },
    "price": { "type": "scaled_float", "scaling_factor": 100 }
  }}
}`,
      },
      insight: 'Relevance is a product feature with a test suite: keep a judgment list of queries → expected top results and measure NDCG/MRR on every analyzer or boost change (ES `_rank_eval`). Without it, tuning one query silently breaks ten others.',
    },
    {
      title: 'Distributed query: scatter-gather, routing and deep pagination',
      hook: 'Every query pays for the slowest shard, and page 1,000 costs 1,000× page 1.',
      body: [
        'In **query-then-fetch**, each shard returns only (doc id, score/sort values) for its local top `from + size`; the coordinator merges them and then fetches `_source` for just the final page. Latency is the max over shards, so more shards means more fan-out and a fatter tail. Adaptive replica selection (default since 7.0) routes to the copy with the best recent response time and queue size.',
        'Custom **routing** (e.g. `_routing: tenant_id`) sends a tenant’s docs to one shard and lets queries hit only that shard — a huge win for multi-tenant search, but large tenants create hot shards. `index.routing_partition_size` spreads each routing key over a subset of shards.',
        '`from: 9990, size: 10` forces every shard to build a 10,000-entry priority queue and ship it; `index.max_result_window` (10,000) blocks deeper. Use `search_after` with a **point-in-time** (PIT) for consistent cursor pagination, and cap UI depth.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Query then fetch',
        actors: ['API', 'Coordinator', 'Shard 0', 'Shard 1'],
        messages: [
          { from: 'API', to: 'Coordinator', label: '_search "running shoes"' },
          { from: 'Coordinator', to: 'Shard 0', label: 'query phase' },
          { from: 'Coordinator', to: 'Shard 1', label: 'query phase' },
          { from: 'Shard 0', to: 'Coordinator', label: 'top-10 ids + scores', dashed: true },
          { from: 'Shard 1', to: 'Coordinator', label: 'top-10 ids + scores', dashed: true },
          { from: 'Coordinator', to: 'Shard 1', label: 'fetch 7 docs', tone: 'accent' },
          { from: 'Coordinator', to: 'Shard 0', label: 'fetch 3 docs', tone: 'accent' },
          { from: 'Coordinator', to: 'API', label: 'global top-10', dashed: true, tone: 'ok' },
        ],
      },
      code: {
        lang: 'json',
        caption: 'Cursor pagination with PIT + search_after',
        code: `POST /_search
{
  "size": 20,
  "pit": { "id": "<pit-id>", "keep_alive": "1m" },
  "query": { "match": { "title": "running shoes" } },
  "sort": [ { "_score": "desc" }, { "_shard_doc": "asc" } ],
  "search_after": [ 11.42, 98321 ]
}`,
      },
      insight: 'Shard count is a latency decision, not just a size decision: 1 shard of 30 GB is often faster per query than 30 shards of 1 GB, because each query pays per-shard overhead and waits for the slowest one.',
    },
    {
      title: 'Keeping the index in sync and zero-downtime reindexing',
      hook: 'The index is a cache of your DB that you will need to rebuild from scratch — design for it on day one.',
      body: [
        'Dual-writing (DB then ES in the request handler) drifts: a crash between the writes, a timeout that actually succeeded, or two concurrent updates applied in opposite order. Instead capture changes from the DB (Debezium reading the WAL/binlog, or a transactional **outbox** table), publish to Kafka keyed by document id (per-key ordering), and have an idempotent indexer bulk-upsert with `version_type=external` using the row’s version or LSN so older events can never overwrite newer ones.',
        'Changing analyzers or primary shard count requires a reindex. Create `products_v2` with new mappings, backfill from the DB snapshot (or `_reindex` from v1), replay the change stream from the snapshot position, verify counts and judgment-list relevance, then atomically swap the **alias** the app queries. Keep v1 for fast rollback.',
      ],
      diagram: {
        type: 'flow',
        title: 'Alias-swap reindex',
        nodes: [
          { label: 'Create v2', sub: 'new mapping', tone: 'accent' },
          { label: 'Backfill', sub: 'snapshot, refresh off' },
          { label: 'Catch up', sub: 'replay CDC from offset', tone: 'info' },
          { label: 'Verify', sub: 'counts + rank eval', tone: 'warn' },
          { label: 'Swap alias', sub: 'atomic _aliases', tone: 'ok' },
          { label: 'Keep v1', sub: 'rollback window' },
        ],
      },
      code: {
        lang: 'json',
        caption: 'Atomic alias swap',
        code: `POST /_aliases
{ "actions": [
  { "remove": { "index": "products_v1", "alias": "products" } },
  { "add":    { "index": "products_v2", "alias": "products" } }
]}`,
      },
      insight: 'Measure and alert on **indexing lag** (DB commit time → searchable time) as an SLO. Users tolerate a second; they do not tolerate a product that was deleted an hour ago still showing up because the indexer’s consumer group was stuck.',
    },
    {
      title: 'Cluster state, masters, heap and mapping explosion',
      hook: 'Most Elasticsearch outages are control-plane outages: too many shards, too many fields, too little heap.',
      body: [
        'Run **3 dedicated master-eligible nodes**. Before 7.0, `discovery.zen.minimum_master_nodes` had to be set to a quorum by hand; leaving it at the default of 1 allowed two halves of a partitioned cluster to elect two masters (**split brain**) and diverge. 7.0 replaced Zen discovery with a quorum-based coordination layer that manages the voting configuration automatically.',
        'Every index, shard and field lives in the cluster state the master publishes to all nodes. Dynamic mapping of arbitrary JSON keys (user attributes, log labels) creates thousands of fields — **mapping explosion** — bloating cluster state and heap; `index.mapping.total_fields.limit` defaults to 1,000 as a guard. Use `dynamic: strict` and the `flattened` type for free-form maps.',
        'Give the JVM heap at most ~50% of RAM and stay under ~31 GB so the JVM can keep **compressed oops** (32-bit object pointers); above that every reference doubles in size and a 40 GB heap can hold less than a 30 GB one. The rest of RAM is the OS page cache, which is where segment files actually get served from.',
      ],
      table: {
        caption: 'Node roles',
        columns: ['Role', 'Count', 'Sizing', 'Failure impact'],
        rows: [
          ['Master-eligible (dedicated)', '3', 'Small CPU/heap, stable', 'Lose quorum → no index/mapping changes, no allocation'],
          ['Data (hot)', 'N', 'NVMe, 64 GB RAM, ≤31 GB heap', 'Replicas promoted, recovery traffic'],
          ['Data (warm/cold)', 'M', 'Dense HDD/object-backed', 'Slower queries on old data'],
          ['Coordinating-only', 'optional', 'CPU + heap for reduce', 'Big aggregations isolated from data nodes'],
        ],
      },
      insight: 'A cluster with 50,000 tiny shards will fall over long before it runs out of disk: each shard costs heap, file handles and cluster-state entries. Shard count is the scaling limit to budget, not GB.',
    },
    {
      title: 'Vector and hybrid search (briefly)',
      hook: 'kNN on HNSW is now built into Lucene, but it has very different cost characteristics from BM25.',
      body: [
        'Lucene 9 added HNSW graphs for `dense_vector` fields; a `knn` query explores the graph with `num_candidates` per shard and returns approximate nearest neighbours. Each segment has its own graph, so merges rebuild graphs (expensive) and search visits a graph per segment. Performance needs the vectors resident in page cache — budget roughly dims × 4 bytes × docs (less with int8/binary quantization).',
        'Hybrid search runs BM25 and kNN and fuses ranks (reciprocal rank fusion) to get both exact keyword matches (SKUs, names) and semantic recall. Dedicated vector databases make sense at very large vector counts or when you need GPU/disk-based ANN, but for most product search, vectors next to the inverted index are simpler.',
      ],
      insight: 'Embedding model changes are reindexes of every document. Version the model in the index name and plan the alias swap the same way you plan analyzer changes.',
    },
  ],

  scaling: {
    body: [
      'Two independent axes: **primary shards** fix the write and data partitioning (changeable only via `_split`/`_shrink` or reindex), **replicas** add read throughput and HA and can be changed any time. Size shards around 10–50 GB (and under ~200M docs), and use time-based indices with rollover/ILM for logs so old data moves to warm/cold tiers and is deleted by dropping whole indices.',
      'Control plane vs data plane: if the master quorum is lost, existing shards keep serving searches and (mostly) writes to existing indices, but you cannot create indices, change mappings or reallocate shards. Data-node loss triggers replica promotion and recovery traffic; throttle recovery so it does not starve queries.',
      'Multi-region: there is no synchronous multi-region cluster. Either index independently in each region from the same change stream (simple, each region is eventually consistent), or use cross-cluster replication (leader → follower indices, async). Cross-cluster search can query remote clusters but adds WAN latency to every request.',
    ],
    bullets: [
      'Read scaling: add replicas and nodes; adaptive replica selection spreads load.',
      'Write scaling: more primaries (at creation), bulk API with 5–15 MB batches, longer refresh interval.',
      'Zone awareness: `cluster.routing.allocation.awareness.attributes: zone` keeps primary and replica in different AZs.',
      'Hot-warm-cold: ILM moves indices from NVMe nodes to dense nodes to searchable snapshots on object storage.',
      'Isolate heavy aggregations on coordinating-only nodes to protect data nodes’ heap.',
      'Circuit breakers (`indices.breaker.*`) reject requests that would exceed heap rather than OOM the node.',
    ],
    diagram: {
      type: 'compare',
      title: 'Multi-region options',
      columns: [
        { name: 'Index per region from CDC', points: ['Each region independent', 'Same Kafka topic replicated', 'Small divergence windows', 'Simplest failover'], tone: 'ok' },
        { name: 'Cross-cluster replication', points: ['Leader / follower indices', 'Async, per-shard', 'Writes only on leader', 'Promote on failover'], tone: 'info' },
        { name: 'Cross-cluster search', points: ['Query remote clusters', 'WAN latency per query', 'Good for analytics', 'Not for user-facing p99'], tone: 'warn' },
      ],
    },
  },

  failures: [
    {
      name: 'Indexing lag / pipeline stall',
      symptom: 'Deleted or updated items keep appearing; search disagrees with product pages.',
      detect: 'Kafka consumer lag for the indexer group; end-to-end lag metric (commit ts → indexed ts) p99; `_cat/thread_pool/write` rejections.',
      mitigate: 'CDC with external versioning, autoscale indexers, DLQ for poison docs, full-reindex runbook.',
    },
    {
      name: 'Heap pressure and GC storms',
      symptom: 'Latency spikes, nodes dropping out of the cluster, circuit breaker exceptions.',
      detect: '`jvm.mem.heap_used_percent` > 75% sustained, old-gen GC time, `breakers.*.tripped` counts.',
      mitigate: 'Heap ≤ ~31 GB, fewer shards, no `fielddata` on text, bound aggregations (`size`, composite aggs), coordinating-only nodes.',
    },
    {
      name: 'Mapping explosion / huge cluster state',
      symptom: 'Master slow to publish, index creation times out, all nodes use more heap.',
      detect: 'Field count per index, cluster state size, `cluster.pending_tasks` growing.',
      mitigate: '`dynamic: strict`, `flattened` for free-form keys, field limit alerts, reject unknown fields at the indexer.',
    },
    {
      name: 'Hot shard',
      symptom: 'One node at 100% CPU while others idle; p99 tied to one shard.',
      detect: 'Per-node search/indexing rate, `_cat/shards` size skew, slow log by shard.',
      mitigate: 'Avoid skewed custom routing or use `routing_partition_size`, split large tenants to their own index, more replicas of the hot index.',
    },
    {
      name: 'Deep pagination and expensive queries',
      symptom: 'Occasional multi-second queries, CPU spikes from scrapers or leading-wildcard queries.',
      detect: 'Search slow log (`index.search.slowlog.threshold.query.warn`), task API long-running searches.',
      mitigate: '`search_after` + PIT, cap `from`, disallow leading wildcards (`search.allow_expensive_queries: false`), per-client rate limits.',
    },
    {
      name: 'Red cluster after node loss',
      symptom: 'Some primaries unassigned; queries return partial results or errors.',
      detect: 'Cluster health `red`, `unassigned_shards` > 0, `_cluster/allocation/explain`.',
      mitigate: '≥1 replica across zones, disk watermarks headroom (>15% free), snapshots to object storage for restore.',
    },
  ],

  warStories: [
    {
      title: '"Meow" bot wipes unsecured clusters',
      source: 'Widely reported, July 2020',
      what: 'An automated attack found thousands of internet-exposed Elasticsearch and MongoDB instances with no authentication and deleted their indices, leaving only "meow" in the name. Earlier the same year and in 2019, researchers repeatedly found open Elasticsearch clusters leaking hundreds of millions to over a billion personal records.',
      lesson: 'A search cluster is a database: private networking, authentication/TLS (on by default since 8.0), and snapshots. Never expose port 9200 to the internet.',
    },
    {
      title: 'GitHub rebuilds code search outside Elasticsearch',
      source: 'GitHub Engineering blog, Feb 2023',
      what: 'GitHub’s earlier code search ran on Elasticsearch, but indexing and serving 100+ TB of source with general-purpose text analysis was slow and expensive and could not support exact/regex matching well. GitHub built Blackbird, a Rust engine with n-gram indexes and content-addressed dedup of files across forks.',
      lesson: 'General-purpose engines fit most search; at extreme scale or with unusual query semantics (code, regex), a specialized index can beat them by orders of magnitude.',
    },
    {
      title: 'Split brain on a two-node cluster',
      source: 'Composite of common incidents (pre-7.0 Elasticsearch)',
      what: 'A team ran two nodes with `minimum_master_nodes: 1`. A network blip made each node elect itself master; both accepted writes. When the network healed, one side’s writes were discarded during re-merge, silently losing hours of documents.',
      lesson: 'Quorum needs an odd number (≥3) of master-eligible nodes. ES 7+ automates the quorum, but you still need three masters for HA.',
    },
    {
      title: 'Dynamic mapping meets log labels',
      source: 'Composite of common incidents',
      what: 'A logging pipeline indexed arbitrary Kubernetes labels and JSON payload keys as fields. Field count grew past 50,000 after the limit was raised "temporarily"; cluster state updates took seconds, masters ran out of heap and index rollover failed, stopping ingestion.',
      lesson: 'Never raise the field limit as a fix. Model free-form maps as `flattened` or key/value nested pairs and reject unknown top-level fields.',
    },
  ],

  numbers: [
    { label: 'Refresh interval (default)', value: '1 s', note: 'skipped on search-idle shards after 30 s' },
    { label: 'Shard size target', value: '10–50 GB', note: 'and < ~200M docs' },
    { label: 'JVM heap', value: '≤ ~31 GB and ≤ 50% RAM', note: 'compressed oops' },
    { label: 'BM25 defaults', value: 'k1 = 1.2, b = 0.75' },
    { label: 'max_result_window', value: '10,000', note: 'use search_after beyond' },
    { label: 'track_total_hits default', value: '10,000', note: 'enables block-max WAND skipping' },
    { label: 'total_fields.limit', value: '1,000 per index' },
    { label: 'Merged segment max', value: '~5 GB', note: 'TieredMergePolicy default' },
    { label: 'Typical query latency', value: '5–50 ms', note: 'p99 driven by slowest shard' },
    { label: 'Bulk request size', value: '5–15 MB', note: 'common starting point' },
    { label: 'Master-eligible nodes', value: '3', note: 'quorum of 2' },
  ],

  capacity: {
    question: 'E-commerce search: 50M products (~2 KB of JSON each), 3,000 searches/s at peak with facets, ~2M updates/day. How big a cluster?',
    steps: [
      'Data: 50M × 2 KB = 100 GB raw; inverted index + doc values + compressed `_source` ≈ 1.5× ⇒ ~150 GB per copy.',
      'Shards: 4 primaries of ~38 GB (within 10–50 GB); 2 replicas for read throughput and AZ loss ⇒ 12 shard copies, ~450 GB on disk.',
      'Query CPU: each search hits 4 shards ⇒ 12,000 shard-queries/s; at ~4 ms CPU each ⇒ ~48 cores busy; target 50% utilization ⇒ ~96 vCPU.',
      'Memory: 6 data nodes × 16 vCPU / 64 GB (31 GB heap, ~30 GB page cache) ⇒ ~75 GB of shard data per node, hot postings and doc values largely cached.',
      'Writes: 2M/day ≈ 25/s average — trivial; refresh 1 s is fine; reindex of 50M docs at ~20k docs/s ≈ 45 minutes with refresh off.',
    ],
    answer: '6 data nodes (16 vCPU, 64 GB, NVMe) + 3 small dedicated masters, index with 4 primaries × 2 replicas behind an alias, fed by CDC — with room to add replicas/nodes for read growth.',
  },

  comparison: {
    caption: 'Search engines and alternatives',
    columns: ['Product', 'Core', 'Strengths', 'Operational cost', 'Choose when'],
    rows: [
      ['Elasticsearch / OpenSearch', 'Lucene, sharded', 'Full-text + aggregations + logs + kNN', 'High: shards, heap, upgrades', 'Large or complex search, analytics'],
      ['Apache Solr', 'Lucene + ZooKeeper', 'Mature faceting, schema-driven', 'High, ZooKeeper too', 'Existing Solr skills, enterprise search'],
      ['Postgres FTS (+pg_trgm)', 'tsvector + GIN', 'Transactional, no sync pipeline', 'Low (already have it)', '< ~10M docs, simple ranking OK'],
      ['Algolia / Typesense', 'In-memory, prefix-first', 'Typo tolerance, instant UX', 'Algolia: none (SaaS $); Typesense: low', 'Product/site search-as-you-type'],
      ['Meilisearch', 'Rust, LMDB', 'Great defaults, easy ops', 'Low, single-node focus', 'Small–medium app search'],
    ],
  },

  whenNot: [
    'Exact-match lookups by id, email or SKU — a DB index is simpler and consistent.',
    'Small datasets (< a few million rows) with basic text search — Postgres `tsvector` + GIN or `pg_trgm` avoids a second system and a sync pipeline.',
    'As the system of record or for read-your-writes transactional reads — it is near-real-time and can be rebuilt; keep truth in the DB.',
    'Heavy joins and relational constraints — denormalize at index time or keep it in SQL.',
    'Pure analytics over billions of rows — a columnar store (ClickHouse, BigQuery) is cheaper and faster for aggregations.',
  ],

  interview: [
    {
      q: 'Walk me through what happens inside Elasticsearch when I index a document and then immediately search for it.',
      a: 'The coordinator routes the doc to its primary shard by `hash(_routing) % primaries`. The primary analyzes it, adds it to the indexing buffer, fsyncs the translog entry, replicates to in-sync replicas and acks. The doc is durable but not searchable until the next refresh (default 1 s) writes a new immutable segment and reopens the searcher, so an immediate search may miss it. Later flushes commit segments and trim the translog, and merges compact segments and purge deleted docs.',
      followUps: ['How would you give a user read-your-own-write after editing a listing?', 'What does `refresh=wait_for` cost?', 'What happens to the translog on crash recovery?'],
      seniorSignal: 'Separates durability (translog) from visibility (refresh) and proposes a UX/architecture answer to the lag instead of forcing refreshes.',
    },
    {
      q: 'How do you keep the search index consistent with the primary database?',
      a: 'Never dual-write in the request handler. Capture changes from the database via CDC (Debezium on the WAL/binlog) or a transactional outbox, publish to Kafka keyed by document id, and have an idempotent indexer bulk-upsert with external versioning so out-of-order or replayed events cannot regress a doc. Monitor end-to-end lag as an SLO and keep a full-rebuild path into a new index with an alias swap. Periodic reconciliation compares counts or checksums per partition.',
      followUps: ['How do you handle a document that fails to index?', 'How do you denormalize data from three tables into one doc?', 'What about deletes?'],
      seniorSignal: 'Brings up ordering per key, external versions, lag SLOs and the rebuild path — treating the index as a disposable projection.',
    },
    {
      q: 'Search p99 went from 40 ms to 400 ms after the index grew. How do you investigate?',
      a: 'Check whether it is all queries or some: slow log and profile API for expensive clauses (wildcards, deep `from`, large terms aggregations). Look at per-node CPU, heap and GC, and per-shard latency — one hot or oversized shard sets the tail. Check segment counts and merges, page-cache hit ratio (index outgrew RAM), and whether `track_total_hits: true` or scripts disabled early termination. Fixes range from query rewrites and caps to resharding, adding replicas/nodes, or moving old data to separate indices.',
      followUps: ['How does shard count affect tail latency?', 'What is adaptive replica selection?', 'When would you force-merge?'],
      seniorSignal: 'Reasons from the scatter-gather tail and storage hierarchy (heap vs page cache), not just "add nodes".',
    },
    {
      q: 'You need to change the analyzer on a 2 TB production index without downtime. How?',
      a: 'Create a new index with the new mappings behind a versioned name, backfill it from the source of truth with refresh disabled and replicas at 0, then replay the change stream from the snapshot position so it catches up. Restore replicas/refresh, validate doc counts and run a relevance judgment set, then atomically move the read alias (and the indexer’s write target). Keep the old index for rollback until confidence is high.',
      followUps: ['How do you avoid missing writes during the backfill?', 'How would you A/B test the new analyzer?'],
      seniorSignal: 'Uses alias indirection, change-stream catch-up and relevance validation; treats rollback as part of the plan.',
    },
    {
      q: 'Why is deep pagination expensive and what do you do instead?',
      a: 'With `from + size`, every shard must collect and sort its top `from + size` hits and ship them to the coordinator, which merges shards × (from + size) entries — cost grows linearly with page depth and multiplies by shard count. ES caps it at `max_result_window` = 10,000. Use `search_after` with a point-in-time for stable cursor pagination, limit how deep the UI goes, and use scroll/PIT exports for bulk extraction.',
      followUps: ['Why does a PIT matter for consistency across pages?', 'How do you paginate with a tie-breaker?'],
      seniorSignal: 'Quantifies the per-shard priority-queue cost and mentions consistent snapshots plus tie-breaker sort.',
    },
    {
      q: 'Postgres full-text search or Elasticsearch for a new product?',
      a: 'If the corpus is modest (millions of rows), relevance needs are basic and you value transactional consistency, Postgres `tsvector` with GIN (and `pg_trgm` for fuzzy) avoids a second cluster and a sync pipeline. Postgres lacks BM25-quality ranking out of the box, rich analyzers, fast faceting over large result sets and horizontal sharding. Move to Elasticsearch/OpenSearch when relevance tuning, facets, typo tolerance or scale demand it — and budget for the CDC pipeline and cluster operations.',
      followUps: ['How would you migrate later with minimal risk?', 'What about Algolia or Typesense?'],
      seniorSignal: 'Chooses by corpus size, relevance needs and operational cost, and names the hidden cost (sync pipeline) of adding a search cluster.',
    },
    {
      q: 'How many shards should an index have?',
      a: 'Enough that each shard is roughly 10–50 GB (and under ~200M docs) at the expected size, and that the cluster’s total shard count stays modest — every shard costs heap, file handles and cluster-state entries, and every query pays per-shard overhead and waits for the slowest shard. Primaries are fixed at creation (changeable by split/shrink/reindex); replicas scale reads and can change any time. For time-series data, use rollover so each index reaches the target size instead of guessing upfront.',
      followUps: ['What happens with 30,000 shards in a cluster?', 'How does custom routing change the answer?'],
      seniorSignal: 'Treats shard count as a latency and control-plane budget, not just a storage division.',
    },
  ],

  takeaways: [
    'An inverted index is term → sorted, delta-compressed doc ids in immutable segments; queries merge lists, BM25 ranks.',
    'Durable (translog) and searchable (refresh, ~1 s) are different moments — design UX for near-real-time.',
    'The index is a projection: feed it via CDC/outbox with external versions, never dual-write.',
    'Reindex behind aliases; changing analyzers or primaries always means a new index.',
    'Every query pays for the slowest shard; shard count is a latency and cluster-state budget.',
    'Heap ≤ ~31 GB, the rest of RAM is page cache for segments; 3 dedicated masters.',
    'Use `search_after` + PIT, strict mappings, and a relevance judgment set.',
  ],
};

export default deep;
