import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'hash-ring',
  problem: {
    why: 'Any system that spreads keys over a changing set of servers — cache clusters, Dynamo-style stores, L4/L7 load balancers with affinity — needs a placement function where **adding or removing one server moves only that server’s share of keys**. Karger et al. (1997, for Akamai’s caches) solved it by hashing servers and keys onto the same circle: a key belongs to the first server clockwise. Membership changes then disturb ~1/N of keys instead of nearly all.',
    withoutIt: [
      'With `hash(key) % N`, adding one cache to 10 remaps ~91% of keys: hit rate collapses and the database takes the full miss storm.',
      'A storage cluster growing from N to N+1 nodes must migrate almost all data instead of ~1/(N+1).',
      'A failed node’s keys cannot be absorbed by its neighbours without re-placing everyone else.',
      'Replica placement has no natural order; each system invents its own “next N servers” rule.',
      'L7 affinity (session or cache locality) breaks every time an upstream host is added or ejected.',
    ],
    position: 'A pure function evaluated in the client library, proxy or coordinator node: (key, membership list) → owner (and replicas). It sits in front of the cache/storage nodes and depends only on a consistently distributed membership list.',
    diagram: {
      type: 'compare',
      title: 'Adding a 5th server',
      columns: [
        { name: 'hash % N', points: ['owner = h % 5', '~80% keys move', 'Cache hit rate collapses'], tone: 'bad' },
        { name: 'Consistent hash ring', points: ['New tokens steal arcs', '~20% keys move', 'Taken evenly from all'], tone: 'ok' },
      ],
    },
  },
  architecture: {
    overview: 'A ring implementation is a **sorted array of tokens** (hash positions), each pointing at a physical node. A lookup hashes the key and binary-searches for the first token ≥ hash, wrapping at the end. Each node owns many tokens (**virtual nodes**) so its total arc is the sum of many small random arcs, which evens out load and spreads failures. Replication walks clockwise collecting distinct nodes (and distinct racks/AZs). Membership changes rebuild the token array identically in every client.',
    diagram: {
      type: 'flow',
      title: 'Lookup path',
      nodes: [
        { label: 'Key', sub: '"session:9f2c"' },
        { label: 'Hash', sub: 'Murmur3 / xxHash / MD5', tone: 'info' },
        { label: 'Binary search', sub: 'sorted token array', tone: 'accent' },
        { label: 'Token → node', sub: 'vnode owner', tone: 'violet' },
        { label: 'Replica walk', sub: 'next distinct nodes', tone: 'ok' },
      ],
      caption: 'O(log V) per lookup where V = total tokens; no network calls.',
    },
    blocks: [
      { name: 'Hash function', what: 'Fast, well-mixed, identical in every client: MD5 in ketama, Murmur3 in Cassandra’s `Murmur3Partitioner` (tokens −2^63..2^63−1), xxHash default in Envoy `ring_hash`. Different hash or seed = different ring.' },
      { name: 'Token array', what: 'Sorted array of (position, node). With 100 nodes × 160 tokens = 16k entries, a few hundred KB; rebuilt on membership change.' },
      { name: 'Virtual nodes', what: 'Each physical node hashes `node#i` for i in 0..v−1 onto the ring. Weight is expressed as token count: a 2× machine gets 2× tokens.' },
      { name: 'Successor search', what: 'Binary search for first token ≥ h, wrap to index 0. ~log2(V) comparisons, a few hundred nanoseconds.' },
      { name: 'Preference list', what: 'Walk clockwise from the key’s position collecting the first N **distinct** physical nodes, optionally skipping same rack/AZ (Cassandra `NetworkTopologyStrategy`).' },
      { name: 'Membership source', what: 'Gossip (Cassandra, Dynamo), a coordination service (ZooKeeper), or the service-discovery feed (Envoy EDS). The ring is only as consistent as this list.' },
    ],
    real: [
      { name: 'Ketama (libmemcached, twemproxy)', how: 'MD5 of `host:port-i` for 40 iterations, each 16-byte digest split into 4 points → 160 points per server, weighted by memory. Sorted continuum, binary search. It became the de facto standard so clients in different languages agree.' },
      { name: 'Amazon Dynamo / Cassandra', how: 'Dynamo: preference list of N successors, sloppy quorum and hinted handoff, later moved to Q equal-size partitions. Cassandra: `num_tokens` 256 random tokens before 4.0; 4.0 defaults to 16 tokens with `allocate_tokens_for_local_replication_factor: 3` to keep balance with fewer ranges to repair.' },
      { name: 'Envoy ring_hash and maglev', how: '`ring_hash` builds a ring between `minimum_ring_size` (default 1024) and `maximum_ring_size` (default 8M) entries, scaled by host weight. `maglev` builds a fixed lookup table (`table_size` default 65537, prime) for O(1) lookups and near-perfect balance.' },
      { name: 'HAProxy / NGINX', how: 'HAProxy `hash-type consistent` with optional `hash-balance-factor` (bounded loads); NGINX `hash $request_uri consistent;` uses ketama-compatible points.' },
      { name: 'Discord', how: 'Routes each guild to the Elixir process/node that owns it via a consistent hash ring over the service nodes, so a node change only moves a fraction of guild sessions.' },
    ],
  },
  lifecycle: {
    summary: 'A ring lookup is pure CPU — microseconds. The real latency is the network call to the chosen node and, on membership change, the data movement.',
    stages: [
      { stage: 'Extract key', what: 'Client or proxy picks the routing key (cache key, partition key, header such as `x-user-id`).', cost: 'String handling', ms: 0.01 },
      { stage: 'Hash', what: '`murmur3_128(key)` → 64-bit position on the ring.', cost: '~20–100 ns for short keys', ms: 0.01 },
      { stage: 'Binary search tokens', what: 'Search 16k tokens: ~14 comparisons, a few cache misses.', cost: '~0.1–0.5 µs', ms: 0.01 },
      { stage: 'Resolve node + replicas', what: 'Token → node; walk for RF = 3 distinct nodes (skip duplicate nodes/racks).', cost: 'A handful of array reads', ms: 0.01 },
      { stage: 'Health filter / fallback', what: 'If the primary is marked down, use the next replica in the preference list (Dynamo hinted handoff writes there).', cost: 'In-memory health state', ms: 0.01 },
      { stage: 'Network call', what: 'Request to the chosen cache/storage node in the same AZ.', cost: 'One LAN RTT + server time', ms: 0.5 },
      { stage: 'Membership change (rare)', what: 'New node joins; every client rebuilds the token array; storage streams ~1/(N+1) of data to it.', cost: 'Rebuild: ms of CPU; streaming: minutes–hours', ms: 0.02 },
    ],
  },
  deepDives: [
    {
      title: 'Why 1/N movement, and the variance problem',
      hook: 'Consistent hashing minimises movement on average — but with one token per node the load spread is terrible.',
      body: [
        'When a node joins, each of its tokens takes the arc between the previous token and itself. Only keys in those arcs move, and they move **to the new node** — never between old nodes. Expected movement is K/(N+1) keys, the theoretical minimum. A leave is symmetric: only the leaving node’s keys move, to its successors.',
        'With one random token per node, arc lengths are roughly exponentially distributed: the largest arc among N nodes is about (ln N)/N of the ring, so the busiest node owns ~ln N times the average (≈4.6× for 100 nodes). And a failed node’s entire arc lands on one neighbour, which may then fail too.',
        'With v tokens per node, a node’s share is the sum of v small arcs, so its relative standard deviation falls roughly as 1/√v: v = 100 → ~10%, v = 1000 → ~3%. Failures and joins also spread across ~all nodes. The cost is a bigger token array and, in storage systems, more ranges to stream and repair.',
      ],
      table: {
        caption: 'Approximate load spread vs tokens per node (relative std-dev ≈ 1/√v)',
        columns: ['Tokens per node', 'Std-dev of load', 'Typical max/avg (100 nodes)', 'Used by'],
        rows: [
          ['1', '~100%', 'several ×', 'Original paper only'],
          ['16 (allocated)', 'low, by algorithm', '~1.1–1.2×', 'Cassandra 4.0 default'],
          ['100–160', '~8–10%', '~1.2–1.3×', 'ketama'],
          ['256 (random)', '~6%', '~1.15×', 'Cassandra < 4.0'],
        ],
      },
      insight: 'Random vnodes trade balance for operational cost (more ranges, slower repairs, more streaming peers). Cassandra moved to 16 tokens chosen by an allocation algorithm because smart placement beats brute-force randomness.',
    },
    {
      title: 'Building the ring correctly',
      hook: 'Twenty lines of code, three classic bugs: weak point hashing, collisions and non-deterministic order.',
      body: [
        'Generate token positions from a strong hash of a stable node identity (`host:port#i`, not an IP that changes on restart), sort once per membership change, and publish the array as an immutable snapshot so readers never see a half-built ring. Lookups are lock-free reads of the current snapshot.',
        'Handle token collisions deterministically (tie-break by node id) and make the replica walk skip nodes already chosen. Weight by token count: `tokens = base × weight`. Keep the build deterministic — iteration order over a hash map must not affect the result, or two processes build different rings from the same list.',
      ],
      code: {
        lang: 'go',
        caption: 'Minimal ring with vnodes and replica walk',
        code: `type token struct{ pos uint64; node string }
type Ring struct{ toks []token } // immutable snapshot
func Build(nodes []string, vnodes int) *Ring {
	var t []token
	for _, n := range nodes {
		for i := 0; i < vnodes; i++ {
			t = append(t, token{xxhash.Sum64String(n + "#" + strconv.Itoa(i)), n})
		}
	}
	sort.Slice(t, func(a, b int) bool { // tie-break collisions by node id
		return t[a].pos < t[b].pos || (t[a].pos == t[b].pos && t[a].node < t[b].node)
	})
	return &Ring{t}
}
func (r *Ring) Owners(key string, rf int) []string {
	h := xxhash.Sum64String(key)
	i := sort.Search(len(r.toks), func(j int) bool { return r.toks[j].pos >= h })
	seen, out := map[string]bool{}, []string{}
	for k := 0; k < len(r.toks) && len(out) < rf; k++ {
		n := r.toks[(i+k)%len(r.toks)].node
		if !seen[n] { seen[n] = true; out = append(out, n) }
	}
	return out
}`,
      },
      insight: 'Use a stable logical node id for tokens. Hashing the IP means a pod reschedule with a new IP is a full leave + join — double the key movement for no reason.',
    },
    {
      title: 'Ring vs jump hash vs rendezvous vs Maglev',
      hook: 'Four algorithms, four different trade-offs in memory, lookup cost, balance and what membership changes they allow.',
      body: [
        '**Ring hash**: arbitrary add/remove/weights, natural successor list for replication; O(log V) lookup and memory for tokens; balance depends on v. **Jump consistent hash** (Lamping & Veach, Google 2014): zero memory, O(ln N) time, near-perfect balance and optimal movement — but buckets are numbered 0..N−1 and can only be added or removed at the end, so it suits numbered shards, not failing cache hosts.',
        '**Rendezvous / HRW** (Thaler & Ravishankar): for each node compute `score = hash(key, node)`, pick the max. O(N) per lookup, perfect minimal movement, weights via a log transform, and top-k replicas for free (take the k highest). Fine for tens of nodes, too slow for thousands without a tree variant. **Maglev** (Google, NSDI 2016): each backend fills a prime-sized table by its own permutation; lookup is one array index. Extremely even and fast, at the cost of slightly more than minimal movement on changes — designed for packet-level load balancers.',
      ],
      table: {
        columns: ['Algorithm', 'Lookup', 'Memory', 'Balance', 'Membership'],
        rows: [
          ['Ring + vnodes', 'O(log V)', 'O(V)', 'Good with many vnodes', 'Any add/remove, weights'],
          ['Jump hash', 'O(ln N)', 'None', 'Near perfect', 'Only append/remove last bucket'],
          ['Rendezvous (HRW)', 'O(N)', 'O(N)', 'Near perfect', 'Any; top-k replicas natural'],
          ['Maglev', 'O(1)', 'O(M), M ≈ 65537', 'Near perfect', 'Any; slightly > minimal movement'],
        ],
      },
      code: {
        lang: 'go',
        caption: 'Jump consistent hash (Lamping & Veach 2014)',
        code: `func JumpHash(key uint64, numBuckets int32) int32 {
	var b, j int64 = -1, 0
	for j < int64(numBuckets) {
		b = j
		key = key*2862933555777941757 + 1
		j = int64(float64(b+1) * (float64(int64(1)<<31) / float64((key>>33)+1)))
	}
	return int32(b)
}`,
      },
      insight: 'Pick by the membership model: numbered shards that never fail out of order → jump hash; dynamic hosts with replication → ring; small node sets with top-k → rendezvous; packet-rate LB → Maglev.',
    },
    {
      title: 'Bounded-load consistent hashing',
      hook: 'Consistent hashing balances keys, not traffic. Bounded loads caps any node at (1+ε)× the average.',
      body: [
        'Mirrokni, Thorup and Zadimoghaddam (Google, 2016; Google AI blog 2017) added a capacity to each node: `cap = ceil((1+ε) × total_load / N)`. A request goes to the first node clockwise whose current load is below cap; if full, it continues clockwise. With ε = 0.25, no node exceeds 125% of average, and the expected movement on changes stays bounded (roughly O(1/ε²) extra moves).',
        'Vimeo implemented it in HAProxy for its video cache tier, where popular content made a few cache nodes far hotter than others; it is available as `hash-balance-factor` (e.g. 125 = ε of 0.25). Envoy exposes the same idea as `hash_balance_factor` in its consistent-hashing load-balancer config.',
        'The trade-off is affinity: a hot key now spills to the next node(s), lowering hit rate a little for that key in exchange for not melting one node. It needs live load knowledge — easy in a single proxy, harder across many independent clients.',
      ],
      code: {
        lang: 'text',
        caption: 'HAProxy backend with bounded-load consistent hashing',
        code: `backend video_cache
    balance uri
    hash-type consistent
    hash-balance-factor 125
    server c1 10.0.0.1:80 check
    server c2 10.0.0.2:80 check
    server c3 10.0.0.3:80 check`,
      },
      insight: 'If the problem is a few hot keys, bounded loads (or replicating hot keys) fixes it; adding vnodes does nothing, because vnodes balance key-space, not popularity.',
    },
    {
      title: 'Replication along the ring: preference lists',
      hook: 'The ring gives replica placement for free — if you skip duplicates and respect failure domains.',
      body: [
        'Dynamo stores a key on the first N distinct nodes clockwise — the **preference list**. With vnodes, consecutive tokens often belong to the same physical node, so the walk must skip already-chosen nodes, and should skip already-chosen racks/AZs (Cassandra `NetworkTopologyStrategy` places replicas per DC on distinct racks where possible).',
        'Reads and writes use quorums over the preference list (R + W > N for overlap). When a preferred node is down, Dynamo writes to the next healthy node with a **hint** naming the intended owner (sloppy quorum + hinted handoff) and replays it later; anti-entropy with Merkle trees repairs whatever hints missed.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Write with RF = 3 and one node down',
        actors: ['Coordinator', 'NodeB', 'NodeC', 'NodeA', 'NodeD'],
        messages: [
          { from: 'Coordinator', to: 'NodeB', label: 'write (replica 1)' },
          { from: 'Coordinator', to: 'NodeC', label: 'write (replica 2)' },
          { from: 'Coordinator', to: 'NodeA', label: 'write (replica 3)', tone: 'bad' },
          { from: 'Coordinator', to: 'NodeD', label: 'write + hint for A', tone: 'warn' },
          { from: 'NodeB', to: 'Coordinator', label: 'ack', dashed: true },
          { from: 'NodeC', to: 'Coordinator', label: 'ack (W=2 met)', dashed: true, tone: 'ok' },
          { from: 'NodeD', to: 'NodeA', label: 'handoff when A returns', dashed: true },
        ],
        caption: 'Sloppy quorum keeps writes available; hints and repair restore placement.',
      },
      insight: 'Rack/AZ-aware walking can create imbalance when racks have unequal node counts — Cassandra docs recommend equal nodes per rack for exactly this reason.',
    },
    {
      title: 'Membership changes and the consistency of the ring itself',
      hook: 'The ring is a function of the member list — two clients with different lists are two different rings.',
      body: [
        'Every client must compute the same ring: same hash, same seed, same token scheme, same member list, same weights. Mixed client libraries (e.g. one using ketama, one using a different point scheme) silently route the same key to different nodes, producing double caching and misses — for stores, split data.',
        'Membership comes from gossip (eventually consistent; Cassandra nodes converge in seconds), from ZooKeeper/etcd (consistent, but clients see updates at different times), or from service discovery (Envoy EDS). During propagation, some clients use the old ring. Caches tolerate it (a few misses); storage systems need ownership handoff: the new node streams its ranges before being declared owner (Cassandra bootstrap marks it **joining** until streaming completes).',
        'Avoid flapping: ejecting a node on a short health blip remaps its keys twice (out and back). Caches commonly use a grace period before removing a node, and stores distinguish “down” (use replicas/hints) from “removed” (rebalance).',
      ],
      bullets: [
        'Pin library, hash and point scheme across all languages; test cross-client agreement in CI.',
        'Separate temporary failure (route to replica) from permanent removal (rebalance).',
        'Throttle streaming on join (`stream_throughput_outbound` in Cassandra) so bootstrap does not hurt live traffic.',
      ],
      insight: 'Key movement is not just a performance cost: for a cache, each moved key is a miss that hits the database. Plan joins off-peak or pre-warm the new node.',
    },
    {
      title: 'Hot keys: what the ring cannot fix',
      hook: 'Consistent hashing guarantees nothing about one key receiving 100k req/s.',
      body: [
        'A single key always maps to one owner (plus replicas). A celebrity profile, a trending video or a global config key will saturate that node regardless of vnode count. Bounded loads help reads by spilling; for writes it does not apply.',
        'Standard fixes: a local in-process cache (L1) with short TTL in front of the ring; replicating the hot key to k nodes by appending a suffix (`key#0..k−1`, pick randomly on read); request coalescing so N concurrent misses become one backend call; and for counters, split writes across sub-keys and sum on read.',
      ],
      diagram: {
        type: 'flow',
        title: 'Hot-key read path',
        nodes: [
          { label: 'L1 in-process cache', sub: 'TTL 1–5 s', tone: 'ok' },
          { label: 'Pick key#rand(k)', sub: 'k replicas on ring', tone: 'info' },
          { label: 'Ring owner', sub: 'coalesced miss', tone: 'accent' },
          { label: 'Database', sub: 'one fetch per TTL', tone: 'violet' },
        ],
      },
      insight: 'Detect hot keys at the client/proxy (top-k sampling) — by the time the cache node’s CPU alerts, the node is already the bottleneck.',
    },
  ],
  scaling: {
    body: [
      'The ring has no data plane of its own: it is evaluated in every client or proxy, so it scales with them. What must be engineered is the **membership plane** — how all evaluators get the same list — and the **data movement** when it changes.',
      'For caches, a change is cheap but causes misses proportional to keys moved; adding many nodes at once compounds it. For stores, each join/leave streams data; Cassandra recommends adding nodes one at a time and running cleanup on old owners afterwards.',
      'Multi-region: usually one ring per region/DC with replication between DCs (Cassandra per-DC replication factor), not one global ring — a global ring would place a key’s replicas across oceans.',
    ],
    bullets: [
      'Membership via gossip (AP, converges in seconds) or ZK/etcd/EDS (CP, push).',
      'Add nodes one at a time; throttle streaming; run cleanup on previous owners.',
      'Debounce health ejection so blips do not double-remap keys.',
      'Weights via token counts (ring) or table share (Maglev) for mixed hardware.',
      'One ring per DC; replicate between DCs explicitly.',
      'Bounded loads when popularity skew, not key skew, is the problem.',
    ],
    diagram: {
      type: 'layers',
      title: 'Planes of a ring-based system',
      layers: [
        { name: 'Evaluation (every client)', items: ['Hash', 'Token search', 'Replica walk'], tone: 'ok' },
        { name: 'Membership plane', items: ['Gossip / ZK / EDS', 'Weights', 'Health state'], tone: 'info' },
        { name: 'Data movement', items: ['Streaming', 'Hinted handoff', 'Repair / cleanup'], tone: 'violet' },
      ],
    },
  },
  failures: [
    { name: 'Uneven load from too few tokens', symptom: 'One cache node at 2–4× the traffic of others; it evicts more and its hit rate drops.', detect: 'Per-node QPS/bytes max/avg ratio; `nodetool status` “Owns” percentages in Cassandra.', mitigate: '100+ vnodes (caches) or token allocation algorithm (Cassandra 4.0), weights per hardware.' },
    { name: 'Clients disagree on the ring', symptom: 'Same key cached on two nodes, persistent misses after deploys, or split data in a store.', detect: 'Cross-client routing test in CI; per-node miss rate rising after a client library upgrade.', mitigate: 'One hashing library/config everywhere, ring version in membership, cross-language test vectors.' },
    { name: 'Miss storm on membership change', symptom: 'DB load spikes when a cache node is added, removed or flaps.', detect: 'Cache `get_misses` rate and DB QPS correlated with membership events.', mitigate: 'Debounce ejection, add nodes one at a time off-peak, pre-warm, request coalescing.' },
    { name: 'Hot key overload', symptom: 'One node CPU-bound on a single key; consistent across rebalances.', detect: 'Top-k key sampling at the client; Redis `--hotkeys` / memcached per-key stats where available.', mitigate: 'L1 cache, key replication with suffixes, bounded-load hashing, coalescing.' },
    { name: 'Cascading failure to one neighbour', symptom: 'With few tokens, a dead node’s whole arc goes to one successor, which then falls over.', detect: 'Successor node load jumps on peer failure; correlated failures in adjacent tokens.', mitigate: 'Vnodes so load spreads, headroom per node, bounded loads.' },
  ],
  warStories: [
    {
      title: 'Vimeo brings bounded loads to HAProxy',
      source: 'Vimeo engineering blog (2016), based on Mirrokni, Thorup, Zadimoghaddam',
      what: 'Vimeo’s video delivery used consistent hashing to send requests for the same video to the same cache server. Popular videos made some cache servers much hotter than others. An engineer implemented the bounded-loads algorithm in HAProxy (`hash-balance-factor`), capping each server relative to the average while keeping most requests on their natural owner.',
      lesson: 'Balance the thing that hurts — request load, not key count — and accept a small locality loss for hot keys.',
    },
    {
      title: 'Two client libraries, two rings',
      source: 'Composite of common incidents',
      what: 'A Python service and a Java service shared a memcached tier. One library used ketama; the other used its own default point scheme. The same key landed on different servers, so writes from one service were invisible to the other and invalidations missed, serving stale data for hours.',
      lesson: 'Treat the hashing scheme as a protocol: specify it, share test vectors, and verify cross-client agreement.',
    },
    {
      title: 'Health-check flapping remaps the cache',
      source: 'Composite of common incidents',
      what: 'A proxy ejected cache nodes after one failed health check. During a GC-pause-heavy period nodes flapped in and out, each flap moving their arcs away and back. Hit rate dropped sharply and the database saturated, which slowed caches further.',
      lesson: 'Debounce ejection and separate “temporarily unhealthy” from “removed from the ring”.',
    },
  ],
  numbers: [
    { label: 'Keys moved on N → N+1', value: '≈ 1/(N+1)', note: '10 → 11 ≈ 9% (vs ~91% with % N)' },
    { label: 'Ketama points per server', value: '160', note: '40 MD5 digests × 4 points' },
    { label: 'Cassandra num_tokens', value: '256 → 16', note: '4.0 default 16 with allocation' },
    { label: 'Load std-dev with v vnodes', value: '≈ 1/√v', note: 'v = 100 → ~10%' },
    { label: 'Envoy ring size', value: '1024 – 8M', note: '`minimum_ring_size` / `maximum_ring_size`' },
    { label: 'Maglev table size', value: '65537', note: 'Prime; Envoy default' },
    { label: 'Ring lookup', value: '< 1 µs', note: '~log2(V) comparisons' },
    { label: 'Jump hash', value: 'O(ln N), 0 bytes', note: 'Numbered buckets only' },
    { label: 'Bounded loads', value: '≤ (1+ε)× avg', note: 'HAProxy `hash-balance-factor 125`' },
  ],
  capacity: {
    question: 'A 20-node memcached tier holds 400 GB at 95% hit rate behind 200k req/s. You add 2 nodes. How much DB load does the change cause with a ring vs `% N`?',
    steps: [
      'Ring: fraction of keys moved ≈ 2/22 ≈ 9%. Those keys miss once on their new owner.',
      'Extra misses ≈ 9% of the working set re-fetched; at 200k req/s, first-touch misses add ~9% × 200k ≈ 18k req/s at peak, decaying as keys warm.',
      'Baseline DB load = 5% × 200k = 10k req/s → transiently ~28k req/s (≈2.8×) for minutes.',
      '`% N` (20 → 22): a key stays only if h % 20 == h % 22, roughly 1 in 11 keys → ~91% move → DB load ≈ 10k + ~175k req/s transiently.',
      'Memory per node after change: 400 GB / 22 ≈ 18 GB; vnodes keep it within ~±10%.',
    ],
    answer: 'Ring: ~2.8× DB load briefly, usually survivable (and avoidable by adding one node at a time). Modulo: ~18×, an outage.',
  },
  comparison: {
    caption: 'Key-placement algorithms in production',
    columns: ['Algorithm', 'Used by', 'Lookup cost', 'Change movement', 'Best for'],
    rows: [
      ['Ring + vnodes', 'Cassandra, ketama, Envoy ring_hash', 'O(log V)', '≈ 1/N (minimal)', 'Caches, Dynamo-style stores'],
      ['Jump hash', 'Sharded storage, internal Google systems', 'O(ln N)', 'Minimal', 'Numbered shards'],
      ['Rendezvous (HRW)', 'CDN edge selection, some LBs', 'O(N)', 'Minimal', 'Small node sets, top-k'],
      ['Maglev', 'Google Maglev, Envoy maglev', 'O(1)', 'Slightly > minimal', 'L4/L7 load balancers'],
      ['Fixed slots + table', 'Redis Cluster (16384), Kafka', 'O(1)', 'Only moved slots', 'Explicitly managed clusters'],
    ],
  },
  whenNot: [
    'Membership is fixed for the life of the data: plain `% N` or jump hash is simpler and perfectly balanced.',
    'You need ordered range scans: hashing destroys key order — use range partitioning (Bigtable, CockroachDB ranges).',
    'You need explicit, operator-controlled placement and moves: a fixed slot table (Redis Cluster style) or a directory gives control and observability that a ring does not.',
    'The skew is popularity (hot keys), not key distribution: fix with caching, key replication or bounded loads — more vnodes will not help.',
  ],
  interview: [
    {
      q: 'Explain consistent hashing and why virtual nodes are needed.',
      a: 'Servers and keys are hashed onto the same ring; a key belongs to the first server clockwise. Adding a server only takes the arcs before its tokens, so ~K/N keys move, all to the new server. With one token per server, arc sizes vary by ~ln N× and a failed server dumps everything on one neighbour. Virtual nodes give each server many small arcs, so load evens out (std-dev ~1/√v), weights are easy, and joins/failures spread across all servers.',
      followUps: ['What is the downside of 256 vnodes in Cassandra?', 'How do you weight a bigger machine?', 'How many keys move when you remove a node?'],
      seniorSignal: 'Quantifies variance and mentions the operational cost of vnodes (repair/streaming), not only the benefit.',
    },
    {
      q: 'Ring hash, jump hash, rendezvous or Maglev — which would you use for a stateful shard layer with 64 numbered shards?',
      a: 'Jump hash: zero memory, near-perfect balance, minimal movement when appending shards, and shards are already numbered and do not disappear arbitrarily (each shard has its own replicas for failure). A ring adds memory and imbalance for no benefit there. For a dynamic cache fleet I would choose ring or Maglev instead, since nodes come and go arbitrarily.',
      followUps: ['What happens if shard 17 must be removed?', 'How would you do weighted jump hash?'],
      seniorSignal: 'Chooses by membership model and failure handling rather than by familiarity.',
    },
    {
      q: 'One key gets 200k req/s. Consistent hashing sends it all to one node. What do you do?',
      a: 'Consistent hashing balances key ownership, not popularity. For reads: L1 in-process cache with short TTL, replicate the key under k suffixes and pick one randomly, coalesce concurrent misses, or use bounded-load hashing to spill to the next node. For writes: split into sub-keys and aggregate on read. Detect hot keys by sampling at the client.',
      followUps: ['How do you invalidate k replicas of a key?', 'How do you detect hot keys cheaply?'],
      seniorSignal: 'Separates key-space balance from load balance and picks read vs write strategies.',
    },
    {
      q: 'How does Dynamo choose replicas, and what happens when one is down?',
      a: 'It walks clockwise from the key to collect N distinct physical nodes — the preference list — ideally in distinct racks/AZs. Writes need W acks, reads R, with R + W > N for overlap. If a preferred node is down, the write goes to the next healthy node with a hint (sloppy quorum) and is handed off when the owner returns; Merkle-tree anti-entropy repairs remaining divergence.',
      followUps: ['Does sloppy quorum still guarantee read-your-writes?', 'What does Cassandra do differently from Dynamo here?'],
      seniorSignal: 'Notes that sloppy quorum breaks the R + W > N overlap guarantee during failures.',
    },
    {
      q: 'What is bounded-load consistent hashing and when would you use it?',
      a: 'Each node gets a capacity of (1+ε) × average load; a request goes to the first node clockwise with spare capacity. It caps the hottest node (e.g. 125% with ε = 0.25) while keeping most requests on their natural owner. Use it in a proxy that knows live load — cache tiers with popularity skew; HAProxy `hash-balance-factor` and Envoy `hash_balance_factor` implement it.',
      followUps: ['What does it cost in hit rate?', 'Can independent clients implement it?'],
      seniorSignal: 'Knows it needs shared load state and trades a bit of locality for tail protection.',
    },
    {
      q: 'Your cache fleet runs on Kubernetes and pods get new IPs on every restart. What goes wrong with consistent hashing and how do you fix it?',
      a: 'If tokens are derived from the IP, every restart is a leave plus a join of a “new” node: its keys move away and then a different set of arcs moves in, so a rolling restart of the whole fleet churns most of the cache. Derive tokens from a stable identity instead — a StatefulSet ordinal or logical node name — and keep the ring entry while the pod is briefly unhealthy. Then a restart only causes the misses of that node’s cold start.',
      followUps: ['How do you handle a permanently replaced node?', 'How would you pre-warm a restarted cache node?'],
      seniorSignal: 'Connects ring identity to deployment mechanics and distinguishes restart from replacement.',
    },
  ],
  takeaways: [
    'Consistent hashing moves ~1/N of keys on membership change, all to/from the changed node.',
    'Vnodes fix the ln N imbalance and spread failures; balance improves roughly as 1/√v.',
    'Choose the algorithm by membership model: ring, jump, rendezvous or Maglev.',
    'The ring is only as consistent as the member list and the hashing scheme shared by all clients.',
    'Hashing balances keys, not popularity — hot keys need caching, replication or bounded loads.',
    'Replicas = next N distinct nodes clockwise, ideally in distinct failure domains.',
    'Debounce health ejection: every flap is a remap and a miss storm.',
  ],
};
export default deep;
