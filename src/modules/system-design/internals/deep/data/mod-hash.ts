import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'mod-hash',
  problem: {
    why: '`server = hash(key) % N` is the first placement function everyone writes: stateless, one line, perfectly even, and every client computes the same answer with no coordination. Its flaw is structural — the owner of every key depends on N. When N changes (scale-out, scale-in, a failed node removed from the list), almost every key changes owner at once. For a cache that is a fleet-wide miss storm; for a database it is a near-total data migration.',
    withoutIt: [
      'Without a deterministic key → node function, clients cannot find data without a lookup service.',
      'Random or round-robin placement spreads load but scatters each key’s data, destroying cache locality.',
      'A central directory for every key adds a hop and a component that must be HA.',
      '`% N` satisfies all three needs — until N changes, which is exactly when you are already under pressure.',
    ],
    position: 'Lives in the client library or proxy (memcached client, Kafka producer partitioner, app-level DB router) and maps a key to an index in an ordered server or partition list.',
    diagram: {
      type: 'compare',
      title: 'Why it is tempting vs where it breaks',
      columns: [
        { name: 'Tempting', points: ['One line of code', 'Perfectly even', 'No state, no coordination', 'Same answer everywhere'], tone: 'ok' },
        { name: 'Breaks', points: ['Owner depends on N', 'N → N+1 moves N/(N+1)', 'Failure removal remaps all', 'Miss storm or full migration'], tone: 'bad' },
      ],
    },
  },
  architecture: {
    overview: 'The mechanism is a hash, a modulo and an ordered list. Everything that goes wrong comes from the list: its length is N, its order defines indexes, and it is edited when servers are added, removed or fail. The fix keeps the cheap modulo but takes it over a **fixed** number of slots, then maps slots to servers with a table — so membership changes edit the table, not the hash.',
    diagram: {
      type: 'flow',
      title: 'How % N placement works',
      nodes: [
        { label: 'Key', sub: '"user:42"' },
        { label: 'Hash', sub: 'CRC32 / Murmur / FNV', tone: 'info' },
        { label: '% N', sub: 'N = live servers', tone: 'bad' },
        { label: 'servers[i]', sub: 'ordered list in config', tone: 'warn' },
        { label: 'Target node', tone: 'violet' },
      ],
      caption: 'The red box is the problem: placement depends on cluster size.',
    },
    blocks: [
      { name: 'Hash function', what: 'Turns the key into an integer. Must be identical across languages and processes — Java `String.hashCode()`, Python’s randomized `hash()` and Go’s map hash are all unsuitable for cross-process placement.' },
      { name: 'Modulo N', what: '`h % N` where N is the current server count. Even for a good hash; skewed if the hash has weak low bits and N is a power of two.' },
      { name: 'Ordered server list', what: 'Index → host. Order is part of the placement: reordering the config file is as bad as changing N.' },
      { name: 'Config distribution', what: 'Every client must see the same list at the same time; during a rollout, old and new clients disagree on N.' },
      { name: 'The fix: fixed slots + table', what: '`slot = h % S` with S constant (Redis Cluster S = 16384), then `slot → node` from a table. Adding nodes moves whole slots; keys never change slot.' },
    ],
    real: [
      { name: 'Early memcached clients', how: 'Default “standard”/modula distribution: `hash % N` over the server list. Adding or removing a server invalidated most of the cache, which is why Last.fm released **libketama** (2007) and consistent hashing became the default in libmemcached and most clients.' },
      { name: 'twemproxy (nutcracker)', how: 'Pools choose `distribution: ketama | modula | random`. With `modula` and `auto_eject_hosts: true`, ejecting a failed host changes N and remaps nearly all keys — ketama is the recommended choice for caches.' },
      { name: 'Kafka default partitioner', how: '`toPositive(murmur2(keyBytes)) % numPartitions`. Fine because the partition count is normally fixed; increasing it later changes the partition of most keys and breaks per-key ordering across the change.' },
      { name: 'Elasticsearch routing', how: 'A document’s shard is derived from `hash(_routing) % num_primary_shards` (with `routing_num_shards` enabling splits). This is why the primary count is fixed at index creation; `_split` only multiplies it by a factor so each old shard maps to known new shards.' },
      { name: 'Redis Cluster (the right way)', how: '`CRC16(key) mod 16384` → slot; a cluster-wide slot table maps slots to masters. Resharding migrates individual slots with `MIGRATE` and ASK/MOVED redirects; keys never change slot.' },
    ],
  },
  lifecycle: {
    summary: 'In steady state `% N` is the cheapest placement there is. The cost appears during a membership change.',
    stages: [
      { stage: 'Hash key', what: '`crc32("user:42")` = 9,812,345.', cost: 'Nanoseconds', ms: 0.01 },
      { stage: 'Modulo', what: '9,812,345 % 4 = 1.', cost: 'One integer division', ms: 0.01 },
      { stage: 'Index → host', what: '`servers[1]` = cache-b; request sent, cache hit.', cost: 'Array read + LAN RTT', ms: 0.5 },
      { stage: 'Add a 5th server', what: 'Config push: N = 5. Now 9,812,345 % 5 = 0 → cache-a, which does not have the key.', cost: 'Config rollout', ms: 0.01 },
      { stage: 'Mass miss', what: 'A key stays put only if h % 4 == h % 5 — 1 in 5 keys. ~80% of requests miss.', cost: 'Miss → DB fetch', ms: 5 },
      { stage: 'DB stampede', what: 'Miss traffic multiplies DB load (e.g. 5% → ~80% of requests); DB latency climbs, cache refills slowly.', cost: 'Queueing at the DB', ms: 50 },
      { stage: 'Mixed rollout', what: 'During config rollout some clients use N = 4 and others N = 5: the same key is cached twice and invalidations miss one copy.', cost: 'Stale reads', ms: 0 },
    ],
  },
  deepDives: [
    {
      title: 'The remapping math',
      hook: 'How many keys move depends on how N changes — and one special case is actually optimal.',
      body: [
        'For N → N+1, a key keeps its owner only when h mod N equals h mod (N+1), which holds for about 1/(N+1) of keys. So N/(N+1) of keys move: 4 → 5 moves 80%, 10 → 11 about 91%, 100 → 101 about 99%. Removing one of N servers moves about (N−1)/N. The minimum possible movement is 1/(N+1) on add and 1/N on removal — `% N` is the worst case, not a mild inefficiency.',
        'The exception is multiplying N by an integer factor. For N → 2N, a key stays put exactly when h mod 2N < N, i.e. half the keys — the optimal amount for doubling — and every moved key goes from bucket b to bucket b + N. Each old bucket splits into known children, so data moves locally. This is why Elasticsearch `_split` only allows multiplying the shard count, and why “double the cluster” resharding schemes work with modulo.',
      ],
      table: {
        caption: 'Fraction of keys that change owner',
        columns: ['Change', '% N', 'Optimal (consistent / slots)', 'Notes'],
        rows: [
          ['4 → 5', '80%', '20%', 'Typical small cache scale-out'],
          ['10 → 11', '~91%', '~9%', ''],
          ['100 → 101', '~99%', '~1%', 'Worse as clusters grow'],
          ['10 → 9 (failure)', '~90%', '10%', 'If the dead node is dropped from the list'],
          ['8 → 16 (double)', '50%', '50%', 'Each bucket splits into 2 known children'],
        ],
      },
      code: {
        lang: 'python',
        caption: 'Measure it yourself',
        code: `import zlib

def moved(n_old, n_new, keys=100_000):
    m = 0
    for i in range(keys):
        h = zlib.crc32(f"user:{i}".encode())
        m += (h % n_old) != (h % n_new)
    return m / keys

# moved(4, 5) ≈ 0.80   moved(10, 11) ≈ 0.91   moved(8, 16) ≈ 0.50`,
      },
      insight: 'If you are stuck with modulo, grow only by integer multiples: each shard splits into known children and the migration is local and parallel.',
    },
    {
      title: 'The scale-out miss storm',
      hook: 'You add cache capacity because the database is struggling — and modulo turns that into an outage.',
      body: [
        'Scale-out usually happens under load. With `% N`, the new config makes most cached keys unreachable at the moment the database has the least headroom. Every miss becomes a DB read and a cache write; DB latency rises, timeouts trigger retries, and the cache refills slowly because the DB is slow. The capacity you added is filled with cold data.',
        'The same storm happens on scale-in and — worst — on failure, if the client drops the dead server from its list. A single node failure, which should cost 1/N of the cache, costs nearly all of it.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Adding a 5th cache node',
        actors: ['Ops', 'Clients', 'Caches', 'Database'],
        messages: [
          { from: 'Ops', to: 'Clients', label: 'config: N = 5' },
          { from: 'Clients', to: 'Caches', label: 'GET (new owner)' },
          { from: 'Caches', to: 'Clients', label: 'miss (~80%)', dashed: true, tone: 'bad' },
          { from: 'Clients', to: 'Database', label: 'read-through ×16 load', tone: 'bad' },
          { from: 'Database', to: 'Clients', label: 'slow / timeouts', dashed: true, tone: 'warn' },
          { from: 'Clients', to: 'Database', label: 'retries amplify', tone: 'bad' },
        ],
        caption: 'Hit rate 95% → ~20%: DB read load jumps by about 16×.',
      },
      insight: 'The danger is proportional to the cache hit rate: the better your cache, the bigger the multiplier on the database when it is wiped.',
    },
    {
      title: 'Never shrink N on failure',
      hook: 'Auto-ejecting a dead host from a modulo pool converts one failure into a cluster-wide remap.',
      body: [
        'Health-check ejection is good practice with consistent hashing (only the dead node’s arcs move) and catastrophic with modulo. A flapping host is worse still: each ejection and readmission remaps nearly every key twice.',
        'If you must keep modulo, keep N fixed and handle failure **inside the index**: fail over to a replica that takes the same index, or return a miss for that index’s keys and let them hit the DB. Only 1/N of keys are affected.',
      ],
      code: {
        lang: 'yaml',
        caption: 'twemproxy: distribution choice matters most when hosts are ejected',
        code: `cache_pool:
  listen: 127.0.0.1:22121
  hash: fnv1a_64
  distribution: ketama        # not "modula"
  auto_eject_hosts: true
  server_retry_timeout: 30000
  server_failure_limit: 3
  servers:
    - 10.0.0.1:11211:1 cache-a
    - 10.0.0.2:11211:1 cache-b
    - 10.0.0.3:11211:1 cache-c`,
      },
      insight: 'Name servers by stable identity (the trailing name in twemproxy’s server line) so a replaced host with a new IP keeps the same position.',
    },
    {
      title: 'The fixes: fixed slots, consistent hashing, jump hash',
      hook: 'Keep the cheap math, remove the dependency on cluster size.',
      body: [
        '**Fixed slots**: hash into a constant S (Redis Cluster 16384, Couchbase 1024 vBuckets, or 4096 logical DB shards), then map slot → node with a small table. Scaling edits the table and migrates only reassigned slots; the table is explicit, observable and lets you move hot slots. This is the default choice for stores you operate.',
        '**Consistent hashing** (ring with vnodes, rendezvous, Maglev) needs no table and moves ~1/N keys on any change — ideal for caches with dynamic membership. **Jump consistent hash** gives optimal movement with zero memory when buckets are numbered and only grow or shrink at the end — a drop-in replacement for `% N` over shard numbers.',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Fixed slots + table', points: ['h % 16384 → slot', 'Table: slot → node', 'Move whole slots', 'Redis Cluster'], tone: 'ok' },
          { name: 'Consistent hash', points: ['Ring / HRW / Maglev', 'No table', '~1/N keys move', 'Caches, Dynamo'], tone: 'info' },
          { name: 'Jump hash', points: ['Zero memory', 'Optimal movement', 'Append/remove last only', 'Numbered shards'], tone: 'accent' },
        ],
      },
      code: {
        lang: 'bash',
        caption: 'Redis Cluster: slots, hash tags, and slot ownership',
        code: `redis-cli CLUSTER KEYSLOT user:1000           # CRC16 % 16384
redis-cli CLUSTER KEYSLOT "{user:1000}.cart"  # hash tag: same slot
redis-cli CLUSTER SHARDS                      # slot ranges per shard
# moving a slot: CLUSTER SETSLOT <slot> IMPORTING/MIGRATING, MIGRATE keys,
# then CLUSTER SETSLOT <slot> NODE <target>; clients follow MOVED/ASK`,
      },
      insight: 'Fixed slots are still modulo — over a constant. The lesson is not “never use %”, it is “never take % over something that changes”.',
    },
    {
      title: 'Implementation traps even when N never changes',
      hook: 'Negative hashes, weak low bits and per-process hash seeds break modulo placement silently.',
      body: [
        '**Negative values**: in Java, `key.hashCode() % N` is negative for negative hashes, and `Math.abs(Integer.MIN_VALUE)` is still negative — an index-out-of-bounds bug that appears for one key in four billion. Kafka uses `Utils.toPositive` (mask the sign bit) for this reason; use `Math.floorMod` or mask.',
        '**Weak low bits**: with N a power of two, `h % N` uses only the low bits; hashes like `String.hashCode()` or integer identity hashes of sequential ids cluster there. Use a well-mixed hash (Murmur3, xxHash) before reducing.',
        '**Per-process randomness**: Python randomizes `str` hashing per process (`PYTHONHASHSEED`), so `hash(key) % N` differs between workers; Go map hashing is also seeded. Placement hashes must be explicit, stable functions shared across languages.',
      ],
      code: {
        lang: 'java',
        caption: 'Correct reduction in Java',
        code: `int h = murmur3_32(keyBytes);          // stable, well-mixed
int idx = (h & 0x7fffffff) % n;        // or Math.floorMod(h, n)
// WRONG: Math.abs(key.hashCode()) % n  -> negative for MIN_VALUE`,
      },
      insight: 'Write cross-language test vectors for your placement function (key → index for a fixed N). Mismatched hashing between services is a silent split-brain for cached data.',
    },
    {
      title: 'When % N is the right answer',
      hook: 'Modulo is fine when N is a constant of the design, not of the deployment.',
      body: [
        'Use it when N truly never changes for the life of the data: lock striping and sharded counters inside one process (`stripes[h % 64]`), worker affinity in a fixed pool, a Kafka topic whose partition count you will not change, or a pre-split logical shard space (`h % 4096`) mapped to physical hosts by a table. Also acceptable for purely ephemeral, cheap-to-recompute data where a full remap on change is tolerable and rare.',
        'Even then, document N as immutable, grow only by integer multiples if it must change, and keep failure handling inside each index.',
      ],
      bullets: [
        'In-process striping: N = fixed number of locks/segments.',
        'Logical shards: `% 4096` then a slot → host table.',
        'Fixed-partition logs: Kafka with partitions sized for years.',
        'Batch jobs: partition work by `% workers` for one run.',
      ],
      insight: 'In an interview, say “hash mod a fixed number of logical shards, then map shards to nodes” — it shows you know both why modulo is cheap and why its denominator must be constant.',
    },
  ],
  scaling: {
    body: [
      '`% N` has no scaling problem in steady state — lookup is O(1) and stateless. Its scaling problem is the transition: every change of N is a global event that touches nearly all keys, so it must be scheduled, warmed and rolled out atomically across clients, which is effectively impossible for a large fleet.',
      'Config propagation makes it worse: during rollout, clients with old and new N disagree, so the same key is written to two servers and invalidations reach only one. Consistent schemes still have a transition, but only 1/N of keys are ambiguous.',
    ],
    bullets: [
      'Adding capacity remaps ~N/(N+1) of keys; plan it as a migration, not a config change.',
      'Grow by integer multiples only (N → 2N) so each bucket splits locally.',
      'Never remove failed nodes from the list; fail over within the index.',
      'Prefer fixed slots + table for stores, consistent hashing for caches.',
      'Use a stable, cross-language hash and mask the sign bit.',
    ],
    diagram: {
      type: 'flow',
      title: 'Migrating off % N',
      nodes: [
        { label: 'h % N', sub: 'today', tone: 'bad' },
        { label: 'h % 4096 → table', sub: 'table = old mapping', tone: 'info' },
        { label: 'Move slots', sub: 'one at a time', tone: 'accent' },
        { label: 'Elastic cluster', tone: 'ok' },
      ],
      caption: 'If 4096 is a multiple of N, the initial table reproduces today’s placement exactly.',
    },
  },
  failures: [
    { name: 'Scale-out miss storm', symptom: 'Hit rate drops from ~95% to ~20% right after adding a node; DB CPU and latency spike.', detect: 'memcached `get_misses`/`get_hits` ratio, Redis `keyspace_misses`, DB QPS — correlated with config deploys.', mitigate: 'Consistent hashing or fixed slots; warm new nodes; roll back the config if already hit.' },
    { name: 'Failure reshuffle', symptom: 'One cache node dies and the whole cluster’s hit rate collapses.', detect: 'Hit-rate drop coinciding with host ejection events (twemproxy `server_ejects` stat).', mitigate: 'Do not eject under modulo; replica per index; switch to ketama.' },
    { name: 'Partition count change', symptom: 'After adding Kafka partitions, per-key ordering breaks and stateful consumers see keys on new partitions.', detect: 'Consumer state store misses; ordering assertions; partition count change in topic audit log.', mitigate: 'Over-provision partitions up front; create a new topic and migrate.' },
    { name: 'Inconsistent hash across processes', symptom: 'Same key cached on several nodes; stale reads after updates.', detect: 'Cross-language test vectors failing; key present on multiple nodes in sampling.', mitigate: 'Explicit stable hash (Murmur3/CRC32), never language-default hashes.' },
    { name: 'Negative index / skew', symptom: 'Rare `IndexOutOfBounds` or one node consistently hotter.', detect: 'Exception logs; per-node QPS skew with power-of-two N.', mitigate: 'Mask sign bit or `floorMod`; well-mixed hash before modulo.' },
  ],
  warStories: [
    {
      title: 'Last.fm releases libketama',
      source: 'Last.fm engineering blog post announcing libketama (Richard Jones, 2007)',
      what: 'Last.fm ran a large memcached tier. With the usual `hash % N` client distribution, adding or removing a server remapped most keys and effectively flushed the cache, pushing load to the databases. They implemented a consistent-hashing continuum (MD5 points per server) and released it as libketama so clients in different languages would agree on placement.',
      lesson: 'Placement that survives membership change is a cross-client protocol; standardize it instead of letting every client choose.',
    },
    {
      title: 'Adding Kafka partitions to “scale” a keyed topic',
      source: 'Composite of common incidents',
      what: 'A team doubled a topic’s partitions to add consumer parallelism. The default partitioner’s `murmur2(key) % numPartitions` sent many existing keys to different partitions. Events for the same entity were now split across two partitions, and a stateful consumer processed an update before the create for some entities.',
      lesson: 'Partition count is part of the key → partition contract; size it for future parallelism up front or migrate to a new topic.',
    },
    {
      title: 'Python workers that disagreed on hash(key)',
      source: 'Composite of common incidents',
      what: 'A service routed cache keys with `hash(key) % len(servers)` in Python. Each worker process had a different hash seed, so the same key mapped to different servers per worker. Hit rate was low and invalidations missed, serving stale data intermittently.',
      lesson: 'Use an explicit, stable hash for placement; language-default hashes are for in-process tables only.',
    },
  ],
  numbers: [
    { label: 'N → N+1 movement', value: 'N/(N+1)', note: '4→5 = 80%, 10→11 ≈ 91%, 100→101 ≈ 99%' },
    { label: 'Consistent hashing', value: '1/(N+1)', note: '10→11 ≈ 9%' },
    { label: 'Doubling N', value: '50%', note: 'Optimal; each bucket splits into 2' },
    { label: 'Redis Cluster slots', value: '16,384', note: 'CRC16 mod 16384' },
    { label: 'Couchbase vBuckets', value: '1,024', note: 'Fixed per bucket' },
    { label: 'Kafka default partitioner', value: 'murmur2 % partitions', note: 'Sign bit masked' },
    { label: 'Miss multiplier at 95% hit', value: '~16×', note: '5% → ~80% misses on 4→5' },
  ],
  capacity: {
    question: '8 memcached nodes serve 100k reads/s at 95% hit rate; the DB can handle 15k reads/s. What happens when you add a 9th node with `% N` vs consistent hashing?',
    steps: [
      'Baseline DB load = 5% × 100k = 5k reads/s.',
      '`% N` 8 → 9: 8/9 ≈ 89% of keys move. Miss rate ≈ 5% + 95% × 89% ≈ 90% → ~90k reads/s to the DB.',
      'That is 6× the DB’s capacity: timeouts, retries and a cascading outage.',
      'Consistent hashing: 1/9 ≈ 11% of keys move → miss rate ≈ 5% + 95% × 11% ≈ 15.5% → ~15.5k reads/s, right at DB capacity for a few minutes.',
      'Add one node off-peak, pre-warm it, or use request coalescing to stay below 15k.',
    ],
    answer: '`% N`: ~90k reads/s (6× DB capacity) — outage. Consistent hashing: ~15k reads/s briefly — survivable with care.',
  },
  comparison: {
    caption: 'Placement schemes',
    columns: ['Scheme', 'Keys moved on +1 node', 'State needed', 'Balance', 'Use when'],
    rows: [
      ['hash % N', '~N/(N+1)', 'Server list', 'Perfect', 'N never changes'],
      ['hash % S + slot table', 'Only moved slots', 'S-entry table', 'Good (tunable)', 'Stores you operate (Redis Cluster)'],
      ['Ring + vnodes', '~1/(N+1)', 'Token array', 'Good with many vnodes', 'Caches, Dynamo-style'],
      ['Jump hash', '~1/(N+1)', 'None', 'Near perfect', 'Numbered shards'],
      ['Rendezvous (HRW)', '~1/(N+1)', 'Server list', 'Near perfect', 'Small node sets'],
    ],
  },
  whenNot: [
    'Elastic cache clusters where nodes are added, removed or fail: use ketama/ring hashing or Maglev.',
    'Persistent shards that will grow: hash into a fixed number of logical shards/slots and map them to hosts.',
    'Kafka or similar topics whose partition count may change: over-provision partitions or plan a new topic.',
    'Any setup where clients auto-eject failed nodes from the list: modulo turns each ejection into a global remap.',
  ],
  interview: [
    {
      q: 'What is wrong with sharding by hash(key) % N?',
      a: 'The owner of every key depends on N, so changing N remaps about N/(N+1) of keys on scale-out and (N−1)/N on removal. For a cache that is a fleet-wide miss storm that hits the database exactly when capacity is tight; for a store it is a near-total migration. Use a fixed number of slots mapped to nodes, or consistent/jump hashing, which move only ~1/N.',
      followUps: ['What fraction moves when you double N?', 'What if a node fails?', 'How would you migrate an existing % N cluster?'],
      seniorSignal: 'Quantifies movement and ties it to the operational moment (scale-out under load) when it hurts most.',
    },
    {
      q: 'Redis Cluster uses CRC16(key) mod 16384. Isn’t that the same mistake?',
      a: 'No — the modulo is over a constant 16384 slots, not over the number of nodes. A key’s slot never changes; scaling reassigns slots to nodes in the cluster table and migrates only those slots’ keys, with MOVED/ASK redirects during migration. The table decouples key placement from cluster size and lets operators move hot slots.',
      followUps: ['How do hash tags work and why do they exist?', 'What happens to a client during slot migration?'],
      seniorSignal: 'States the principle (modulo over a constant) and knows the redirect protocol.',
    },
    {
      q: 'You inherit a memcached fleet using % N and need to add capacity tomorrow. What do you do?',
      a: 'Avoid a single N change under load. Option 1: double N (8 → 16), which moves exactly half the keys, each to a known sibling, and do it off-peak with DB headroom. Option 2: switch clients to ketama first in a controlled rollout — a one-time remap — then add nodes cheaply forever after. Either way, add request coalescing and protect the DB with rate limits during the transition.',
      followUps: ['How do you roll a placement change across 300 clients?', 'How do you pre-warm a cache?'],
      seniorSignal: 'Plans the migration as a one-time cost with DB protection, not just “use consistent hashing”.',
    },
    {
      q: 'When is hash % N perfectly fine?',
      a: 'When N is a constant of the design: lock striping inside a process, a fixed worker pool, a topic whose partition count will not change, or hashing into a fixed logical shard space that a table maps to hosts. Also for ephemeral, cheap data where a rare full remap is acceptable.',
      followUps: ['Why do power-of-two N values need a good hash?', 'What goes wrong with Java hashCode here?'],
      seniorSignal: 'Recognises modulo as correct over constants and names implementation traps.',
    },
    {
      q: 'Why does Elasticsearch only let you split an index by a factor?',
      a: 'Routing is `hash(_routing) % primaries`. Multiplying the primary count by k maps each old shard’s keys to k specific new shards, so a split can hard-link/copy each shard locally and delete the keys that do not belong. Arbitrary changes in count would remap almost every document across shards, requiring a full reindex.',
      followUps: ['What does `routing_num_shards` control?', 'How would you shrink instead?'],
      seniorSignal: 'Explains the integer-multiple property of modulo and connects it to an actual product constraint.',
    },
  ],
  takeaways: [
    '`hash % N` is even and stateless, but every key’s owner depends on N.',
    'N → N+1 moves N/(N+1) of keys; removing a failed node moves (N−1)/N.',
    'Doubling N moves 50% locally — the one safe way to grow a modulo scheme.',
    'Fix: modulo over a constant (fixed slots/logical shards) plus a slot → node table, or consistent/jump hashing.',
    'Never eject failed nodes from a modulo list; fail over within the index.',
    'Use a stable cross-language hash and mask the sign bit.',
  ],
};
export default deep;
