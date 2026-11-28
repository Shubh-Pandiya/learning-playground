import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'bloom',
  problem: {
    why: 'Many systems spend most of their I/O proving that something is **not** there: an LSM read checking SSTables that do not contain the key, a cache miss for an id that does not exist, a crawler asking whether a URL was seen. A Bloom filter (Burton Bloom, 1970) answers “definitely not” or “maybe” from a compact bit array — about 10 bits per key for 1% false positives regardless of key size — so the expensive lookup only happens when it might succeed.',
    withoutIt: [
      'An LSM point read for an absent key touches every level’s SSTable on disk; read amplification grows with the number of files.',
      'Requests for non-existent ids (bots, enumeration attacks) miss the cache every time and hit the database — classic cache penetration.',
      'A CDN caches every one-hit-wonder object, evicting useful content for objects that are never requested again.',
      'Membership checks over billions of keys need the full key set in memory (tens of GB) instead of ~1.2 GB of bits.',
      'Distributed joins and replication protocols ship full key lists where a compact filter would do.',
    ],
    position: 'An in-memory guard placed in front of an expensive lookup (disk file, database, remote service). It is derived data: built from the authoritative set and consulted before it; on “maybe” the caller still performs the real lookup.',
    diagram: {
      type: 'flow',
      title: 'Guarding an expensive lookup',
      nodes: [
        { label: 'Lookup key', sub: 'e.g. user:42' },
        { label: 'Bloom filter', sub: 'k bit probes in RAM', tone: 'accent' },
        { label: 'Definitely absent', sub: 'return now (~99%)', tone: 'ok' },
        { label: 'Maybe → real lookup', sub: 'disk / DB / network', tone: 'warn' },
      ],
      caption: 'Never a false negative; false positives cost one wasted lookup each.',
    },
  },
  architecture: {
    overview: 'A Bloom filter is an array of m bits and k hash functions. Insert sets the k bits a key maps to; query checks them — any 0 means the key was never inserted, all 1s means “probably inserted”. Real implementations compute one strong hash and derive k positions from it (Kirsch–Mitzenmacher), and lay bits out so all k probes fall into one cache line (blocked filters). Everything else — sizing, rebuild, variants for deletes or growth — follows from the false-positive formula.',
    diagram: {
      type: 'flow',
      title: 'Insert / query path',
      nodes: [
        { label: 'Key', sub: '"alice"' },
        { label: 'One 128-bit hash', sub: 'h1, h2 halves', tone: 'info' },
        { label: 'k positions', sub: 'g_i = h1 + i·h2 mod m', tone: 'accent' },
        { label: 'Bit array (m)', sub: 'set or test k bits', tone: 'violet' },
        { label: 'Answer', sub: 'no / maybe', tone: 'ok' },
      ],
    },
    blocks: [
      { name: 'Bit array', what: 'A `uint64[]` of m bits. Bits are only ever set, never cleared, which is why there are no false negatives and no deletes.' },
      { name: 'Hashing', what: 'One fast, well-mixed hash (Murmur3-128, xxHash/XXH3) split into h1, h2; positions `g_i = h1 + i·h2 (mod m)` for i in 0..k−1. Same asymptotic FPR as k independent hashes.' },
      { name: 'Sizing', what: 'From expected n and target p: m = −n·ln p / (ln 2)², k = (m/n)·ln 2. 1% → 9.6 bits/key, k = 7.' },
      { name: 'Blocked layout', what: 'Pick a 64-byte block with one hash, then set all k bits inside it: one cache miss per query instead of k. Slightly higher FPR at the same m (RocksDB’s cache-local filters).' },
      { name: 'Serialization', what: 'Filters are persisted next to the data they guard (in the SSTable footer or a sidecar file) together with m, k and hash seed — the parameters are part of the format.' },
      { name: 'Variants', what: 'Counting (deletes), cuckoo (deletes, better space at low FPR), scalable (unknown n), XOR/Ribbon (static sets, ~20–30% smaller).' },
    ],
    real: [
      { name: 'RocksDB', how: 'One filter per SST file (or partitioned filters for very large files), typically 10 bits/key. Since format_version 5 the Bloom implementation is cache-local; the Ribbon filter policy saves roughly 30% memory at the same FPR in exchange for more CPU at build time. Prefix Bloom filters support prefix seeks.' },
      { name: 'Cassandra / ScyllaDB', how: 'A filter per SSTable over partition keys, kept off-heap in Cassandra. `bloom_filter_fp_chance` defaults to 0.01 (0.1 for LeveledCompactionStrategy tables, since LCS already bounds the files per read).' },
      { name: 'RedisBloom (Redis Stack)', how: '`BF.RESERVE key error_rate capacity [EXPANSION n] [NONSCALING]` creates a scalable filter: when full it adds a larger sub-filter with a tighter error rate. Cuckoo filters via `CF.*` support deletes.' },
      { name: 'Akamai “cache on second hit”', how: 'A Bloom filter of recently requested URLs; an object is cached only on its second request, keeping one-hit wonders (about three quarters of objects in their measurements) out of disk cache.' },
      { name: 'Guava / libraries', how: '`BloomFilter.create(Funnels.stringFunnel(UTF_8), n, fpp)` computes m and k; `mightContain` returns the maybe/no answer. Filters with the same parameters can be merged with `putAll` (bitwise OR).' },
    ],
  },
  lifecycle: {
    summary: 'A point read for an absent key in a RocksDB-style LSM: filters let the read skip almost every file without touching disk.',
    stages: [
      { stage: 'Memtable lookup', what: 'Skiplist search in the active and immutable memtables — miss.', cost: 'In-memory, ~µs', ms: 0.01 },
      { stage: 'Hash the key once', what: 'XXH3/Murmur3 → 64/128 bits reused for every filter probe.', cost: '~20–50 ns', ms: 0.01 },
      { stage: 'Probe L0 file filters', what: 'L0 files overlap, so each (say 4) is checked; each blocked filter = 1 cache miss.', cost: '4 × ~100 ns', ms: 0.01 },
      { stage: 'Probe one file per level L1–L6', what: 'Find the file covering the key per level via file metadata, probe its filter — all say “no”.', cost: '6 × ~100 ns', ms: 0.01 },
      { stage: 'Occasional false positive', what: 'With ~10 files probed at 1% FPR, ~10% of absent-key reads still read one data block.', cost: 'Amortized: 0.1 × SSD read ~0.1 ms', ms: 0.01 },
      { stage: 'Return NotFound', what: 'No disk I/O for ~90% of absent-key reads.', cost: 'Total ≈ microseconds', ms: 0.01 },
      { stage: 'Without filters (for contrast)', what: 'Index + data block read per level that overlaps the key: several SSD reads if blocks are not cached.', cost: '~6 × 0.1 ms', ms: 0.6 },
    ],
  },
  deepDives: [
    {
      title: 'The math: sizing m and k',
      hook: 'Every operational decision about a Bloom filter falls out of one formula.',
      body: [
        'After inserting n keys into m bits with k hashes, the probability a given bit is still 0 is about e^(−kn/m). A non-member is a false positive if all its k bits are 1: **p ≈ (1 − e^(−kn/m))^k**. Minimising over k gives **k = (m/n)·ln 2**, at which point about half the bits are set and **m/n = −ln p / (ln 2)² ≈ 1.44·log2(1/p)**.',
        'So 1% costs ~9.6 bits per key (k = 7), 0.1% costs ~14.4 (k = 10), and each additional ~4.8 bits/key buys another 10× fewer false positives. The key size does not matter — a 2 KB URL costs the same 9.6 bits as an 8-byte id.',
        'The formula also tells you how a filter degrades: inserting 2× the design n into a 1%-sized filter raises the FPR to roughly 15%; at 4× it is over 50%. Monitor fill ratio (fraction of bits set — ~50% at design capacity) to detect overfilling.',
      ],
      table: {
        caption: 'Bits per key and optimal k for common targets',
        columns: ['Target FPR', 'Bits/key (m/n)', 'Optimal k', 'Memory for 1B keys'],
        rows: [
          ['10%', '4.8', '3', '~600 MB'],
          ['1%', '9.6', '7', '~1.2 GB'],
          ['0.1%', '14.4', '10', '~1.8 GB'],
          ['0.01%', '19.2', '13', '~2.4 GB'],
        ],
      },
      code: {
        lang: 'python',
        caption: 'Sizing from n and p',
        code: `import math

def size(n, p):
    m = math.ceil(-n * math.log(p) / (math.log(2) ** 2))
    k = max(1, round(m / n * math.log(2)))
    return m, k

def fpr(m, n, k):
    return (1 - math.exp(-k * n / m)) ** k

# size(1_000_000, 0.01) -> (9_585_059 bits ≈ 1.2 MB, k = 7)`,
      },
      insight: 'Size for peak n with headroom, not today’s n. An overfilled filter does not fail loudly — it silently stops filtering and every lookup falls through to the slow path.',
    },
    {
      title: 'Hashing tricks: double hashing and cache-blocked filters',
      hook: 'Naive filters compute k hashes and take k cache misses; production filters do one hash and one miss.',
      body: [
        '**Kirsch–Mitzenmacher (2006)** showed that deriving positions as `g_i = h1 + i·h2 mod m` from two hash values gives the same asymptotic false-positive rate as k independent hashes. One 128-bit Murmur3 or XXH3 call supplies both halves.',
        'A standard filter spreads k probes across the whole array — k cache misses for a large filter. A **blocked** filter uses part of the hash to pick one 64-byte block (512 bits) and places all k bits inside it, so a query costs one cache miss. Load per block varies, which raises the FPR slightly for the same memory; implementations compensate with a little more memory or tuned k. RocksDB’s current Bloom implementation is cache-local in this way.',
      ],
      code: {
        lang: 'go',
        caption: 'Double hashing over a plain bit array',
        code: `func (f *Filter) positions(key []byte) []uint64 {
	h1, h2 := murmur3.Sum128(key)
	pos := make([]uint64, f.k)
	for i := uint64(0); i < f.k; i++ {
		pos[i] = (h1 + i*h2) % f.m
	}
	return pos
}

func (f *Filter) MightContain(key []byte) bool {
	for _, p := range f.positions(key) {
		if f.bits[p/64]&(1<<(p%64)) == 0 {
			return false // definitely absent
		}
	}
	return true // maybe present
}`,
      },
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Standard filter', points: ['k probes anywhere', 'k cache misses', 'Lowest FPR per bit'], tone: 'info' },
          { name: 'Blocked filter', points: ['1 block of 512 bits', '1 cache miss', 'Slightly higher FPR'], tone: 'ok' },
        ],
      },
      insight: 'At large sizes the filter’s cost is memory latency, not hashing. Blocked filters are why an LSM can probe ten filters per read in about a microsecond.',
    },
    {
      title: 'Deletes: counting Bloom filters and cuckoo filters',
      hook: 'Clearing a bit for a deleted key can create false negatives for other keys — the one error a Bloom filter must never make.',
      body: [
        'Bits are shared, so unsetting key A’s bits may unset bits that key B also relies on; B then tests negative even though it is present. A **counting Bloom filter** (Fan et al., 2000, for web cache summaries) replaces each bit with a 4-bit counter: insert increments, delete decrements. That is 4× the memory, and deleting a key that was never inserted corrupts counts.',
        'A **cuckoo filter** (Fan, Andersen, Kaminsky, Mitzenmacher, 2014) stores short fingerprints in a cuckoo hash table with buckets of 4. Each item has two candidate buckets, `i2 = i1 XOR hash(fingerprint)`, so items can be relocated without the original key. It supports deletion, reaches ~95% occupancy, and uses less space than a Bloom filter for FPR below roughly 3%. Inserts can fail when the table is too full, so capacity must be planned.',
        'For **static** sets (an immutable SSTable), XOR filters and Ribbon filters are built once and use about 20–30% less memory than Bloom at the same FPR, but cannot accept inserts after construction.',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Counting Bloom', points: ['4-bit counters', 'Deletes OK', '~4× memory'], tone: 'warn' },
          { name: 'Cuckoo filter', points: ['Fingerprints in buckets', 'Deletes OK', 'Better < 3% FPR', 'Insert can fail when full'], tone: 'ok' },
          { name: 'XOR / Ribbon', points: ['Built once', 'No inserts', '~20–30% smaller'], tone: 'info' },
        ],
      },
      insight: 'If you need deletes, first ask whether you can rebuild instead: rebuilding a filter from the source set every hour is often simpler and more robust than counting filters.',
    },
    {
      title: 'Growing sets: scalable Bloom filters and rebuilds',
      hook: 'When n is unknown, a fixed filter either wastes memory or overfills.',
      body: [
        'A **scalable Bloom filter** (Almeida et al., 2007) is a chain of filters: when the current one reaches capacity, add a new one with larger capacity (growth factor, e.g. 2×) and a tighter error rate (ratio r, e.g. 0.5–0.9), so the overall FPR, a geometric series, stays bounded. Queries check every sub-filter, so lookups get slower as the chain grows.',
        'RedisBloom implements this: `BF.RESERVE` sets the initial error rate and capacity, and `EXPANSION` the growth factor (default 2); `NONSCALING` makes it fail instead of growing. The alternative for long-lived sets is periodic **rebuild** from the source of truth into a right-sized filter, then atomic swap.',
      ],
      code: {
        lang: 'bash',
        caption: 'RedisBloom: reserve, add, check',
        code: `BF.RESERVE usernames 0.001 10000000 EXPANSION 2
BF.MADD usernames alice bob carol
BF.EXISTS usernames dave      # 0 = definitely free
BF.EXISTS usernames alice     # 1 = maybe taken -> check DB
BF.INFO usernames             # capacity, size, filters, items
CF.RESERVE sessions 1000000   # cuckoo filter if deletes needed
CF.DEL sessions s-123`,
      },
      insight: 'Every insert path into the source of truth must also insert into the filter. A missed insert becomes a false **negative** — the guard then hides data that exists.',
    },
    {
      title: 'Bloom filters inside LSM storage engines',
      hook: 'The single biggest production use: turning N disk probes per point read into roughly one.',
      body: [
        'An LSM tree keeps data in many immutable sorted files across levels. A point read must check each level that could contain the key — up to one file per level plus every L0 file. With a filter per file, the read probes in-memory filters and only reads data blocks from files that say “maybe”.',
        'The cost is memory: filters for every file must fit in RAM (or block cache). For a node with billions of keys that is gigabytes; RocksDB partitioned filters and `cache_index_and_filter_blocks` let filters be paged through the block cache, and `optimize_filters_for_hits` skips filters on the last level (useful when most lookups are for keys that exist, since the last level holds most data). Cassandra’s higher default FPR for LCS tables reflects that LCS already limits files per read.',
        'Filters help **point** lookups only. Range scans cannot use whole-key filters; RocksDB’s prefix Bloom (with a `prefix_extractor`) helps seeks within a known prefix.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Point read for an absent key',
        actors: ['Reader', 'Memtable', 'Filters', 'SSD'],
        messages: [
          { from: 'Reader', to: 'Memtable', label: 'get(k)' },
          { from: 'Memtable', to: 'Reader', label: 'miss', dashed: true },
          { from: 'Reader', to: 'Filters', label: 'probe L0..L6 filters' },
          { from: 'Filters', to: 'Reader', label: 'all "no"', dashed: true, tone: 'ok' },
          { from: 'Reader', to: 'SSD', label: 'skipped (no I/O)', dashed: true, tone: 'ok' },
        ],
        caption: 'On a false positive, one data block read happens and finds nothing.',
      },
      code: {
        lang: 'sql',
        caption: 'Cassandra: trade filter memory for disk reads per table',
        code: `-- default 0.01 (STCS), 0.1 (LCS); takes effect for new SSTables
ALTER TABLE ks.events WITH bloom_filter_fp_chance = 0.01;
-- check: nodetool tablestats ks.events
--   Bloom filter false ratio / Bloom filter space used`,
      },
      insight: 'Filter memory grows with key count, not data size. Tables with billions of tiny rows can run nodes out of off-heap memory because of their Bloom filters — tune FPR per table.',
    },
    {
      title: 'Beyond storage: cache penetration, one-hit wonders, “is it taken?”',
      hook: 'Anywhere a “no” is common and a lookup is expensive, a filter pays for itself.',
      body: [
        '**Cache penetration**: requests for ids that do not exist bypass the cache (nothing to cache) and hit the DB every time — bots enumerating ids can take down a database this way. A filter of all existing ids rejects them in memory. Negative caching (cache “not found” with a short TTL) is the complementary fix for ids that are requested repeatedly.',
        '**CDN one-hit wonders**: cache an object only on its second request within a window (Akamai). **Username availability**: “definitely free” from the filter instantly; “maybe taken” confirmed against the DB. **Chrome Safe Browsing** historically shipped a client-side Bloom filter of malicious URL prefixes, later replaced with a more compact prefix-set structure.',
      ],
      diagram: {
        type: 'flow',
        title: 'Cache penetration guard',
        nodes: [
          { label: 'GET /item/999999', sub: 'id never existed' },
          { label: 'Bloom of item ids', sub: 'says "no"', tone: 'ok' },
          { label: '404 immediately', sub: 'cache + DB untouched', tone: 'ok' },
        ],
      },
      bullets: [
        'Insert into the filter in the same code path (or CDC consumer) that creates the row.',
        'Rebuild periodically from the table to drop deleted ids and fix drift.',
        'Treat “maybe” as “go look”, never as “yes”.',
        'Filters with identical m, k and hash can be merged by OR — useful for per-shard filters.',
      ],
      insight: 'A guard filter that lags inserts turns a performance optimisation into a correctness bug: newly created items return 404 until the filter catches up.',
    },
  ],
  scaling: {
    body: [
      'A Bloom filter is derived data, so HA means “can be rebuilt” rather than replication. Persist it with the data it guards (SSTable footer, snapshot) or keep it in a replicated store (RedisBloom with replicas) and rebuild from the source of truth on loss.',
      'For sharded data, keep one filter per shard and route the query to the shard first; or, when a global answer is needed, OR together per-shard filters with identical parameters. Bitwise OR is a correct union; AND only approximates intersection.',
      'Very large filters (billions of keys) should be partitioned by hash prefix so each piece fits in memory and can be rebuilt independently.',
    ],
    bullets: [
      'Size for peak n; alert on fill ratio > ~50% or measured FPR above target.',
      'Rebuild periodically (or on compaction) instead of deleting.',
      'Keep m, k, hash and seed in the serialized format; version it.',
      'Per-shard filters; merge by OR only with identical parameters.',
      'For filters exposed to clients, assume attackers can craft inputs to raise FPR — use keyed hashes.',
    ],
    diagram: {
      type: 'layers',
      title: 'Filter lifecycle',
      layers: [
        { name: 'Serve', items: ['In-memory probes', 'Per shard / per file'], tone: 'ok' },
        { name: 'Maintain', items: ['Insert with writes', 'Fill-ratio metric', 'Measured FPR'], tone: 'info' },
        { name: 'Rebuild', items: ['From source of truth', 'Right-size m', 'Atomic swap'], tone: 'violet' },
      ],
    },
  },
  failures: [
    { name: 'Overfilled filter', symptom: 'Disk reads or DB queries rise steadily although traffic is flat; the filter answers “maybe” for most keys.', detect: 'Fill ratio (bits set / m) well above 50%; measured FPR (Cassandra `nodetool tablestats` “Bloom filter false ratio”, RocksDB `rocksdb.bloom.filter.useful` vs `rocksdb.bloom.filter.full.positive` tickers).', mitigate: 'Rebuild with larger m, use scalable filters, size for peak n.' },
    { name: 'Missed inserts → false negatives', symptom: 'New items 404 or are treated as “never seen” by the guard.', detect: 'Reconciliation sampling: check a sample of recent source-of-truth ids against the filter; error rate should be exactly 0.', mitigate: 'Insert in the same write path or via CDC with retries; rebuild periodically; fail open on doubt.' },
    { name: '“Maybe” treated as “yes”', symptom: 'Usernames reported taken, URLs never crawled, users blocked — at ~p of all checks.', detect: 'Support tickets/complaints; compare filter positives to DB truth in sampled checks.', mitigate: 'Confirm positives against the source of truth whenever correctness matters.' },
    { name: 'Filter memory blowup', symptom: 'Cassandra nodes run out of off-heap memory; RocksDB block cache thrashes.', detect: 'Cassandra `BloomFilterOffHeapMemoryUsed`; RocksDB `rocksdb.estimate-table-readers-mem`.', mitigate: 'Raise FPR on large-key-count tables, Ribbon filters, partitioned filters in block cache.' },
    { name: 'Incompatible filters across services', symptom: 'A filter built by one service always says “no” (or “maybe”) when read by another.', detect: 'Cross-language test vectors in CI; sudden 0% or 100% positive rate after a deploy.', mitigate: 'Version the serialization format including hash function, seed, m and k.' },
    { name: 'Adversarial saturation', symptom: 'Attacker-controlled inserts (e.g. user-submitted keys) fill the filter or craft collisions, raising FPR.', detect: 'Fill ratio jumps faster than real n grows.', mitigate: 'Keyed hash (SipHash with secret), rate-limit inserts, rebuild.' },
  ],
  warStories: [
    {
      title: 'Akamai keeps one-hit wonders out of the cache',
      source: 'Maggs & Sitaraman, “Algorithmic Nuggets in Content Delivery” (ACM SIGCOMM CCR, 2015)',
      what: 'Akamai observed that about three quarters of objects requested at its edge servers were requested only once. Caching them wasted disk writes and evicted useful content. They used a Bloom filter to record objects seen once and cached an object only on its second request, significantly improving disk hit rates and reducing disk writes.',
      lesson: 'Filters are useful as admission control, not just lookup avoidance: “have I seen this before?” is cheap to answer approximately.',
    },
    {
      title: 'Bitcoin SPV Bloom filters leak wallet addresses',
      source: 'Gervais et al., “On the Privacy Provisions of Bloom Filters in Lightweight Bitcoin Clients” (ACSAC 2014)',
      what: 'BIP37 let lightweight clients send a Bloom filter of their addresses to full nodes to receive only relevant transactions, assuming false positives would hide which addresses were really theirs. Researchers showed that with typical parameters a node could identify a large fraction of a client’s addresses, especially by combining filters from the same client over time. The ecosystem moved to alternatives such as compact block filters (BIP157/158).',
      lesson: 'False positives are not a privacy mechanism. Do not ship filters of sensitive sets to untrusted parties.',
    },
    {
      title: 'The guard that hid new products',
      source: 'Composite of common incidents',
      what: 'A team added a Bloom filter of product ids in front of the product cache to stop enumeration bots. The filter was rebuilt nightly from the database, but new-product creation did not add to it. Every product launched during the day returned 404 until the next rebuild.',
      lesson: 'A guard filter must be updated on every insert path; reconcile it continuously against the source of truth.',
    },
  ],
  numbers: [
    { label: 'False-positive rate', value: '(1 − e^(−kn/m))^k', note: 'Optimal k = (m/n)·ln 2' },
    { label: '1% FPR', value: '9.6 bits/key, k = 7', note: 'Independent of key size' },
    { label: '0.1% FPR', value: '14.4 bits/key, k = 10', note: '+4.8 bits per 10× fewer FPs' },
    { label: '1B keys at 1%', value: '~1.2 GB', note: 'vs tens of GB for the keys' },
    { label: 'Fill ratio at design n', value: '~50% bits set', note: 'Higher means overfilled' },
    { label: 'Blocked filter probe', value: '1 cache miss', note: '512-bit block' },
    { label: 'Counting Bloom memory', value: '~4×', note: '4-bit counters' },
    { label: 'Cuckoo filter load', value: '~95%', note: 'Buckets of 4; wins below ~3% FPR' },
    { label: 'Cassandra fp chance', value: '0.01 / 0.1', note: 'STCS default / LCS default' },
    { label: 'Ribbon vs Bloom', value: '~30% smaller', note: 'RocksDB, static per file' },
  ],
  capacity: {
    question: 'A Cassandra node holds 2 billion partitions. Half of its 20k point reads/s are for keys that do not exist. What do filters cost and save at FPR 1% vs 10%?',
    steps: [
      'Memory at 1%: 2B × 9.6 bits ≈ 19.2 Gbit ≈ 2.4 GB off-heap; at 10%: 2B × 4.8 bits ≈ 1.2 GB.',
      'Assume ~8 SSTables could contain a key per read (STCS). Absent-key reads: 10k/s × 8 = 80k filter probes/s.',
      'Wasted SSTable reads at 1%: 80k × 0.01 = 800 reads/s; at 10%: 8,000 reads/s.',
      'At ~0.1–0.2 ms per SSD read (index + data block), 8,000 extra reads/s is a significant share of the node’s random-read budget; 800/s is noise.',
      'With LCS (≈1 SSTable per level checked, fewer overlapping files) the 10% default wastes far fewer reads, which is why it is the LCS default.',
    ],
    answer: 'Spend ~2.4 GB for 1% on STCS (saves ~7k disk reads/s); with LCS or memory pressure, 10% at ~1.2 GB is reasonable.',
  },
  comparison: {
    caption: 'Approximate membership structures at ~1% FPR',
    columns: ['Structure', 'Bits/key', 'Deletes', 'Inserts after build', 'Typical use'],
    rows: [
      ['Bloom', '~9.6', 'No', 'Yes (until overfilled)', 'LSM files, caches, crawlers'],
      ['Blocked Bloom', '~10–11', 'No', 'Yes', 'RocksDB, Parquet, high-QPS probes'],
      ['Counting Bloom', '~38 (4-bit counters)', 'Yes', 'Yes', 'Sets with churn, router tables'],
      ['Cuckoo filter', '~10 (better below ~3%)', 'Yes', 'Yes, can fail when full', 'Dynamic sets, RedisBloom CF'],
      ['XOR / Ribbon', '~7–8', 'No', 'No (static)', 'Immutable files'],
    ],
  },
  whenNot: [
    'You need exact answers or enumeration of members: use a hash set, a database index or a sorted file.',
    'The set is small (thousands of keys): a plain hash set in memory is simpler and exact.',
    'Most lookups are for keys that exist: a filter adds a probe and saves almost nothing (consider RocksDB `optimize_filters_for_hits`).',
    'The data must be hidden from the party holding the filter: filters leak membership information.',
    'Frequent deletes with no possibility of rebuild: use a cuckoo filter or exact structure instead of a standard Bloom filter.',
  ],
  interview: [
    {
      q: 'Size a Bloom filter for 1 billion URLs at a 1% false-positive rate, and explain the trade-off.',
      a: 'm/n = −ln(0.01)/(ln 2)² ≈ 9.6 bits per key, so about 9.6 Gbit ≈ 1.2 GB with k = 7 hashes. Each additional ~4.8 bits per key cuts the FPR by 10×. A false positive means a new URL is wrongly treated as seen (skipped) — acceptable for a crawler, otherwise confirm positives against the URL store. Plan for growth: at 2× the design n the FPR jumps to ~15%.',
      followUps: ['How would you shard this across machines?', 'What happens if you need to forget old URLs?', 'How many hash computations per lookup?'],
      seniorSignal: 'Does the arithmetic, states the degradation curve when overfilled and picks one hash with double hashing.',
    },
    {
      q: 'Why can a Bloom filter return false positives but never false negatives, and what operations break that guarantee?',
      a: 'Inserts only set bits and nothing clears them, so an inserted key’s k bits are always 1 and it always tests positive. A non-member tests positive only if other keys happened to set all its bits. The guarantee breaks if you clear bits (deleting), if an insert into the source of truth is not mirrored into the filter, or if reader and writer disagree on m, k or hash.',
      followUps: ['How do counting filters support deletes?', 'How would you detect a missed insert?'],
      seniorSignal: 'Identifies operational ways to get false negatives, not just the theoretical property.',
    },
    {
      q: 'How do LSM databases use Bloom filters, and what does it cost?',
      a: 'Each SSTable has a filter over its keys. A point read checks the memtable, then probes each candidate file’s filter in memory, reading data blocks only from files that say maybe — absent-key reads drop from several disk reads to almost none. The cost is RAM proportional to key count (~1.2 bytes per key at 1%), which can dominate for tables with many tiny rows; tune FPR per table, use Ribbon or partitioned filters in block cache.',
      followUps: ['Do filters help range scans?', 'Why does Cassandra default to 0.1 for LCS?', 'What is a prefix Bloom filter?'],
      seniorSignal: 'Connects filter FPR choice to compaction strategy and memory budget.',
    },
    {
      q: 'Bots are requesting random product ids and overloading the database through cache misses. Design a fix.',
      a: 'Put a Bloom filter of all existing product ids in front of the cache: “definitely absent” returns 404 without touching cache or DB. Insert into the filter on product creation (same code path or CDC) and rebuild periodically to drop deleted ids. Add negative caching with a short TTL for repeated misses, and rate-limit by client. The key correctness risk is a missed insert, which would 404 real products — reconcile continuously.',
      followUps: ['How do you handle deletes?', 'Where does the filter live with 50 app servers?', 'What FPR would you choose?'],
      seniorSignal: 'Treats filter freshness as a correctness requirement and layers it with negative caching and rate limiting.',
    },
    {
      q: 'When would you use a cuckoo filter instead of a Bloom filter?',
      a: 'When you need deletes without rebuilds, or a low FPR (below roughly 3%) where cuckoo filters use less space. Cuckoo filters store fingerprints in buckets and relocate them using the fingerprint alone, so items can be removed. The trade-offs: inserts can fail when the table nears capacity, so you must size it, and deleting a never-inserted item can remove another item’s fingerprint.',
      followUps: ['What happens when a cuckoo insert fails?', 'Why are XOR filters smaller still?'],
      seniorSignal: 'Knows the failure mode of cuckoo inserts and the space crossover point.',
    },
    {
      q: 'You have a Bloom filter per shard. How do you answer “is key X anywhere?”',
      a: 'Prefer routing: hash X to its shard and ask that shard’s filter. If keys are not routable, OR the per-shard filters into one — that is an exact union provided all filters share m, k, hash and seed — and the result has the FPR of a filter holding all n keys, so size each shard filter for the global n. Intersection by AND only approximates and has a higher FPR.',
      followUps: ['What if shards used different sizes?', 'How do you rebuild the merged filter incrementally?'],
      seniorSignal: 'Knows OR-merge semantics and the sizing implication for the merged filter.',
    },
  ],
  takeaways: [
    'A Bloom filter answers “definitely not” or “maybe” in ~10 bits per key at 1% FPR, independent of key size.',
    'p ≈ (1 − e^(−kn/m))^k; k = (m/n)·ln 2; each ~4.8 bits/key buys 10× fewer false positives.',
    'Production filters use one hash (double hashing) and one cache line (blocked layout).',
    'No deletes: rebuild, or use counting/cuckoo filters; XOR/Ribbon for static sets.',
    'Overfilling silently destroys usefulness — monitor fill ratio and measured FPR.',
    'Missed inserts create false negatives; a guard filter must track every write path.',
    'Biggest use: LSM point reads skipping SSTables; also cache-penetration guards and CDN admission.',
  ],
};
export default deep;
