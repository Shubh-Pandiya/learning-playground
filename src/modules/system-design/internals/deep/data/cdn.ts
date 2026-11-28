import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'cdn',
  problem: {
    why:
      'The speed of light makes a round trip from Mumbai to Virginia ~200 ms, and a cold HTTPS fetch needs several round trips. A CDN moves TLS termination and cacheable bytes into hundreds of PoPs a few ms from users, so most requests never cross an ocean or touch your origin. At scale it is also your egress-cost lever, your DDoS shield and the place where you run request logic closest to users.',
    withoutIt: [
      'Every handshake and every asset pays the full user↔origin RTT: 3–4 RTTs of 150 ms before the first byte of a cold page.',
      'Origin egress and server count scale with total traffic instead of with the miss rate; a viral asset becomes an origin outage.',
      'Volumetric DDoS (hundreds of Gbps to multi-Tbps) lands on your own links and load balancers.',
      'Long-haul TCP loss and congestion from the public internet sit directly in your dynamic API latency.',
    ],
    position:
      'The outermost hop: DNS or anycast steers the client to an edge PoP, which terminates TLS, applies WAF/edge logic and serves from cache; misses go to a mid-tier/shield and only then to your origin (S3, load balancer, app).',
    diagram: {
      type: 'flow',
      title: 'Tiered CDN path',
      nodes: [
        { label: 'User', sub: 'Mumbai', tone: 'neutral' },
        { label: 'Edge PoP', sub: '~5–20 ms away', tone: 'ok' },
        { label: 'Shield / tier', sub: 'regional, on miss', tone: 'info' },
        { label: 'Origin', sub: 'S3 / LB, ~150 ms', tone: 'accent' },
      ],
      caption: 'Each tier only sees the misses of the tier below; origin should see 1–5% of requests.',
    },
  },
  architecture: {
    overview:
      'A CDN is a fleet of reverse-proxy caches in PoPs connected by a private backbone and controlled by a global config/purge plane. Inside a PoP, an L4 load balancer spreads connections across servers that terminate TLS/QUIC; the request’s cache key is consistent-hashed to the server that owns that object so the PoP’s RAM and SSD behave as one big cache instead of N duplicates. Misses walk a cache hierarchy (edge → tier/shield → origin) with request collapsing at each level.',
    diagram: {
      type: 'layers',
      title: 'CDN anatomy',
      layers: [
        { name: 'Request routing', items: ['Anycast BGP', 'GeoDNS / ECS', 'Load feedback'], tone: 'info' },
        { name: 'Edge server', items: ['TLS / QUIC termination', 'WAF + bot rules', 'Edge compute', 'Cache key build'], tone: 'accent' },
        { name: 'PoP cache', items: ['Consistent hash to owner', 'RAM hot tier', 'NVMe long tail', 'Request collapsing'], tone: 'ok' },
        { name: 'Upstream', items: ['Tier / origin shield', 'Warm origin connections', 'Backbone routing'], tone: 'violet' },
        { name: 'Control plane', items: ['Config push', 'Purge fan-out', 'Certs + keys', 'Logs + analytics'], tone: 'neutral' },
      ],
      caption: 'Data plane serves from local state; the control plane only pushes config, certs and purges.',
    },
    blocks: [
      { name: 'Request routing', what: '**Anycast**: the same prefix announced from every PoP, BGP picks the topologically nearest. **DNS-based**: the authoritative DNS returns a PoP IP chosen by resolver location (better with EDNS Client Subnet), latency maps and PoP load.' },
      { name: 'Edge proxy', what: 'Terminates TCP/TLS 1.3/QUIC, speaks HTTP/1.1, /2, /3 to clients; runs WAF, rate limits, redirects and edge functions before the cache lookup.' },
      { name: 'Cache key', what: 'Normally `scheme + host + path + query`, customizable to drop or sort query params and to include selected headers/cookies; `Vary` adds response-selected headers as secondary keys.' },
      { name: 'Object store', what: 'RAM for the hottest objects, NVMe SSD for the long tail; LRU-family eviction, often with admission filtering so one-hit wonders don’t flush the disk. Large files are stored and fetched as byte-range chunks.' },
      { name: 'Intra-PoP sharding', what: 'Consistent hashing of the cache key to an “owner” server inside the PoP: the server that accepted the connection fetches from the owner, so each object is stored once per PoP and capacity adds up.' },
      { name: 'Tiered cache / shield', what: 'Edges ask an upper tier (regional cache or a single designated shield PoP) on a miss, so the origin sees roughly one fetch per object per TTL instead of one per PoP.' },
      { name: 'Purge & config plane', what: 'Global fan-out of config versions and purges (by URL, prefix or surrogate key/tag). Fastly reports ~150 ms global purge; CloudFront invalidations take from seconds to minutes.' },
    ],
    real: [
      { name: 'Cloudflare', how: 'Anycast on every IP; every server in every PoP runs every service (DDoS, WAF, cache, Workers). Origin-facing proxying moved from NGINX to the in-house Rust Pingora, and the core request proxy to Rust (FL2). Tiered Cache picks upper tiers by topology; Cache Reserve keeps the long tail on R2. No per-GB egress fee on standard plans.' },
      { name: 'Fastly', how: 'Varnish-derived caching with VCL, plus Compute (WebAssembly on Wasmtime). Fewer, larger PoPs; anycast; ~150 ms instant purge via a gossip-style fan-out; first-class `Surrogate-Key` tag purge and soft purge; shielding configured per backend.' },
      { name: 'Akamai', how: 'The original CDN: ~4,000 locations deeply embedded in ISP networks, DNS-based mapping that picks servers by real-time network measurements, parent tiers (Tiered Distribution / SureRoute for dynamic routing), Edge-Cache-Tag purge.' },
      { name: 'Amazon CloudFront', how: '600+ edge PoPs plus regional edge caches as a built-in mid tier and optional Origin Shield; DNS-based routing; CloudFront Functions (lightweight JS at the edge) and Lambda@Edge (Node/Python at regional caches). Origin fetch from AWS origins is free; invalidations charged per path beyond 1,000/month.' },
      { name: 'Netflix Open Connect', how: 'Self-built: FreeBSD + NGINX appliances placed inside ISPs and at IXPs, filled proactively during off-peak hours with titles predicted to be popular. Netflix’s AWS control plane steers each client to specific appliances; no DNS/anycast tricks. Single boxes serve hundreds of Gbps.' },
    ],
  },
  lifecycle: {
    summary:
      'A first visit from Mumbai for `/img/hero.v42.webp` on an anycast CDN. A hit completes in ~30–40 ms including handshakes; a full miss adds the shield hop and a long-haul origin fetch.',
    stages: [
      { stage: 'DNS resolution', what: 'Resolver returns the CDN anycast address (or a GeoDNS-selected PoP IP). Usually cached; CDN DNS TTLs are short (20–300 s).', cost: 'One resolver RTT if uncached', ms: 10, part: 'anycast' },
      { stage: 'TCP + TLS 1.3 at edge', what: 'SYN to the nearest PoP via BGP; 1-RTT TLS 1.3 handshake with a stapled OCSP response. QUIC merges both into one RTT; resumption can be 0-RTT.', cost: '2 × ~8 ms RTT (1 with QUIC)', ms: 16, part: 'edge-tls' },
      { stage: 'WAF and edge rules', what: 'Managed rules, rate limits, bot score, redirects, header rewrites or an edge function.', cost: 'Sub-ms CPU per request; regex-heavy rules cost more', ms: 0.3 },
      { stage: 'Cache key + owner hash', what: 'Normalize the URL, strip `utm_*`, add `Accept-Encoding` variant; hash key to the owning server in the PoP.', cost: 'Intra-PoP hop if not local', ms: 0.2, part: 'cache-key' },
      { stage: 'Edge lookup', what: 'RAM or NVMe lookup; fresh → serve. Stale within `stale-while-revalidate` → serve and refresh in the background.', cost: 'RAM ~µs, SSD ~0.1–1 ms', ms: 0.5, part: 'edge-cache' },
      { stage: 'Miss: shield hop', what: 'Collapsed request to the regional tier/shield over warm backbone connections.', cost: 'One regional RTT', ms: 30, part: 'shield' },
      { stage: 'Miss: origin fetch', what: 'Shield misses too: conditional or full GET to origin over a reused TLS connection; response cached at shield and edge per `Cache-Control`.', cost: 'Long-haul RTT + origin time', ms: 160, part: 'origin' },
      { stage: 'Response to user', what: 'Bytes stream from edge as they arrive (no store-and-forward for large objects); compression (Brotli) applied or served pre-compressed.', cost: 'Transfer time, size-dependent', ms: 8 },
    ],
  },
  deepDives: [
    {
      title: 'Request routing: anycast vs DNS-based mapping',
      hook: 'How a user lands on a PoP decides latency, failover speed and how well you can shed load.',
      body: [
        '**Anycast** announces the same IP prefix from every PoP; the internet’s BGP routing delivers each packet to the “nearest” PoP by AS-path, not by measured latency. Failover is fast and automatic (withdraw the route and traffic shifts within seconds to minutes as BGP converges), and DDoS traffic is spread across all PoPs by construction. The downsides: coarse control (you can’t move 10% of a PoP’s users), occasional poor routes, and a route flap can break long-lived TCP flows mid-stream.',
        '**DNS-based** routing (Akamai, CloudFront) answers each DNS query with a PoP chosen from latency measurements, PoP load and health. It can steer precisely and per-customer, but it sees the resolver, not the user — public resolvers far from users mislead it unless they send **EDNS Client Subnet** — and failover is bounded by DNS TTLs and clients that cache answers longer than told.',
        'Many CDNs blend both: anycast for DNS itself and for DDoS absorption, plus internal load feedback that adjusts announcements or redirects traffic between nearby PoPs.',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Anycast', points: ['One IP, many PoPs', 'BGP picks nearest', 'Fast, automatic failover', 'DDoS spread for free', 'Coarse traffic control'], tone: 'info' },
          { name: 'DNS mapping', points: ['Per-query PoP choice', 'Latency + load aware', 'Sees resolver, not user', 'Failover ≥ DNS TTL', 'Fine-grained steering'], tone: 'accent' },
        ],
      },
      insight:
        'For multi-CDN, DNS steering across providers is the only practical layer (each CDN anycasts its own space) — so your multi-CDN failover is only as fast as your DNS TTL and resolver behaviour, typically minutes, not seconds.',
    },
    {
      title: 'Cache keys, Vary and Cache-Control semantics',
      hook: 'Hit ratio is decided by headers you send from origin, long before any CDN tuning.',
      body: [
        'The default key is the full URL including query string. Unordered or junk params (`utm_*`, `fbclid`, cache-busting timestamps) create distinct keys for identical content; normalize by allow-listing params and sorting them. `Vary` tells shared caches to store variants per request header value: `Vary: Accept-Encoding` is fine (CDNs normalize it to a few values), `Vary: User-Agent` or `Vary: Cookie` fragments the cache into near-uniqueness.',
        '`max-age` applies to browsers and shared caches; `s-maxage` overrides it for shared caches only; `Surrogate-Control` (Fastly, Akamai) and the standardized `CDN-Cache-Control` (RFC 9213) target the CDN and are stripped or ignored by browsers. `no-cache` means “store but revalidate every time”, `no-store` means don’t store, `private` means browsers only. `immutable` tells browsers not to revalidate on reload.',
        'RFC 5861 adds `stale-while-revalidate=N` (serve stale while one background refresh runs — no user waits on origin) and `stale-if-error=N` (serve stale if origin errors or is unreachable). Together with validators (`ETag` → `If-None-Match` → `304`) they turn the CDN into a latency and availability layer for origin.',
      ],
      code: {
        lang: 'text',
        code: `# Fingerprinted static asset
Cache-Control: public, max-age=31536000, immutable

# HTML: browsers revalidate, CDN keeps 60 s, survives origin outage
Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=30, stale-if-error=86400
Surrogate-Key: home article-123 author-9

# Personalised API
Cache-Control: private, no-store`,
        caption: 'Three response classes cover most sites.',
      },
      insight:
        'Measure **byte** hit ratio and **request** hit ratio separately: small HTML/API objects drive request count and latency, big media drives egress cost. A 95% request hit ratio can coexist with a 60% byte hit ratio and a large origin bill.',
    },
    {
      title: 'Tiered caching and origin shield',
      hook: 'Without a mid tier, N PoPs each miss once per object per TTL — long-tail content never gets hot anywhere.',
      body: [
        'An object requested once per hour in each of 300 PoPs has a near-zero edge hit ratio with a 10-minute TTL, yet it is “popular” globally. A tier funnels all edge misses for a region (or the world) into one upper cache, where it is hot. CloudFront has regional edge caches by default plus an optional Origin Shield; Cloudflare Tiered Cache selects upper tiers by topology; Fastly lets you pick a shield PoP near the origin.',
        'At each level, **request collapsing** merges concurrent misses for the same key into one upstream fetch (Varnish request coalescing, NGINX `proxy_cache_lock`). Combined with a single shield, origin sees roughly one request per object per TTL regardless of how many users or PoPs ask.',
        'Cost: an extra hop on misses (~10–50 ms), and the shield becomes a concentration point — if the shield PoP is impaired, misses must fail over to a secondary shield or go direct to origin, which is exactly the thundering herd you built it to avoid.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Collapsed miss through a shield',
        actors: ['Users', 'Edge PoP', 'Shield', 'Origin'],
        messages: [
          { from: 'Users', to: 'Edge PoP', label: '5,000 × GET /v.m3u8' },
          { from: 'Edge PoP', to: 'Shield', label: '1 collapsed miss', tone: 'info' },
          { from: 'Shield', to: 'Origin', label: '1 fetch (other PoPs wait)', tone: 'accent' },
          { from: 'Origin', to: 'Shield', label: '200 + Cache-Control', dashed: true },
          { from: 'Shield', to: 'Edge PoP', label: 'stream + store', dashed: true, tone: 'ok' },
          { from: 'Edge PoP', to: 'Users', label: '5,000 responses', dashed: true, tone: 'ok' },
        ],
        caption: 'Live video manifests with 2 s TTLs depend entirely on this collapse.',
      },
      insight:
        'Request collapsing must not apply to uncacheable responses: if origin returns `private` or `Set-Cookie`, waiting requests are released one by one (a serialized queue) unless the CDN caches the “uncacheable” decision (Varnish hit-for-pass/hit-for-miss) — a classic cause of mysterious latency.',
    },
    {
      title: 'Invalidation: versioned URLs, purge and surrogate keys',
      hook: 'The best purge is the one you never send.',
      body: [
        'For build artifacts, put a content hash in the filename (`app.3f9a1c.js`) and cache for a year with `immutable`. A deploy changes the HTML (short TTL) to point at new names; old and new versions coexist, rollbacks are instant, and nothing needs purging.',
        'For content at stable URLs (articles, product pages, API responses), tag responses with **surrogate keys** (`Surrogate-Key` on Fastly, `Cache-Tag` on Cloudflare, `Edge-Cache-Tag` on Akamai) and purge by tag when the underlying entity changes — one purge invalidates every page that embedded product 123. CloudFront invalidates by path/wildcard only.',
        'Prefer **soft purge** (mark stale instead of evicting) so the next request is served stale-while-revalidate and only one fetch goes to origin. A hard global purge of a hot object makes every PoP miss simultaneously — a self-inflicted stampede.',
      ],
      code: {
        lang: 'bash',
        code: `# Fastly: soft-purge every object tagged with product-123
curl -X POST -H "Fastly-Key: $TOKEN" -H "Fastly-Soft-Purge: 1" \\
  https://api.fastly.com/service/$SERVICE_ID/purge/product-123

# CloudFront: path-based invalidation (charged per path after 1,000/month)
aws cloudfront create-invalidation --distribution-id E123 --paths "/products/123*"`,
      },
      insight:
        'Wire purges to your data change stream (CDC/events), not to the deploy pipeline or a human: the same “every write path must invalidate” rule from application caches applies at the edge, and purge-by-tag is what makes it tractable.',
    },
    {
      title: 'TLS, HTTP/2/3 and dynamic content acceleration',
      hook: 'A CDN speeds up uncacheable APIs too — by fixing round trips, not by caching.',
      body: [
        'Terminating TLS 1.3 at a PoP 8 ms away instead of origin 150 ms away saves 1–2 long-haul RTTs per new connection. Edges use session tickets/resumption (0-RTT for safe idempotent requests only, due to replay risk) and **OCSP stapling** so clients don’t make a separate revocation lookup. Keyless SSL lets a bank keep its private key on-prem while the edge does the handshake via a remote signing call.',
        'HTTP/2 multiplexes requests on one TCP connection but still suffers TCP head-of-line blocking on loss; **HTTP/3 over QUIC** (UDP) has per-stream loss recovery, 1-RTT setup and connection migration across network changes — significant on lossy mobile links.',
        'For dynamic requests, the edge keeps a pool of warm, long-lived connections to origin (no handshake per request, large congestion windows) and may route over the provider’s backbone or the best-measured internet path (Cloudflare Argo Smart Routing, Akamai SureRoute). Edge compute (Workers, Compute, Lambda@Edge, CloudFront Functions) can authenticate, A/B route or assemble cached fragments without an origin round trip.',
      ],
      table: {
        columns: ['Edge compute', 'Runtime', 'Where it runs', 'Typical use'],
        rows: [
          ['Cloudflare Workers', 'V8 isolates (JS/Wasm)', 'Every PoP', 'Auth, routing, full apps with KV/D1/R2'],
          ['Fastly Compute', 'WebAssembly (Wasmtime)', 'Every PoP', 'Low-latency request logic, per-request isolation'],
          ['CloudFront Functions', 'Lightweight JS, sub-ms limits', 'Edge PoPs', 'Header/URL rewrites, redirects'],
          ['Lambda@Edge', 'Node.js / Python', 'Regional edge caches', 'Heavier logic, origin selection, network calls'],
        ],
      },
      insight:
        'Edge compute is shared, globally deployed code: it inherits the CDN’s blast radius. Treat edge functions like a global config push — canary by PoP, keep them small, and never let one hold the only copy of business logic you can’t run at origin.',
    },
    {
      title: 'Security at the edge: DDoS, WAF and signed URLs',
      hook: 'The CDN is the cheapest place to drop bad traffic — and a single point of global failure for good traffic.',
      body: [
        'Anycast spreads volumetric attacks across every PoP, so a multi-Tbps flood becomes a few Gbps per PoP, dropped in XDP/eBPF or hardware before it reaches the proxy. L7 floods are handled by rate limits, bot scoring and challenges. The defence only works if the origin is not reachable directly: lock origin to CDN IP ranges, mTLS (authenticated origin pulls) or private connectivity.',
        'A WAF evaluates managed and custom rules (SQLi, XSS, known CVEs) on every request — CPU-bound regex work on the hot path, which is why rule deployment safety matters as much as rule quality.',
        'Private content uses **signed URLs or cookies**: the app signs `path + expiry (+ IP)` with a key the CDN trusts (CloudFront key groups, HMAC tokens on Fastly/Akamai), so the edge can authorize without calling origin and still cache one shared copy.',
      ],
      code: {
        lang: 'python',
        code: `# HMAC token check at the edge (generic)
def allowed(path, exp, sig, now):
    if now > exp:
        return False
    expected = hmac_sha256(EDGE_SECRET, f"{path}:{exp}")
    return constant_time_eq(sig, expected)
# cache key excludes exp/sig so all viewers share one object`,
      },
      insight:
        'Strip the token parameters from the cache key, otherwise every signed URL is a unique cache entry and your hit ratio on paid content goes to zero.',
    },
    {
      title: 'Inside a PoP: sharding, RAM/SSD tiers and admission',
      hook: 'A PoP of 100 servers is one cache only if requests for an object land on the same server.',
      body: [
        'Connections are spread by an L4 load balancer (ECMP + consistent hashing on the flow, e.g. Cloudflare Unimog, Google Maglev-style designs) so any server can terminate any connection. If every server cached independently, a PoP of 100 servers would store each hot object 100 times and miss the long tail 100 times. Instead the receiving server hashes the cache key to an **owner** server (consistent/rendezvous hashing) and fetches from it over the PoP network; Fastly calls this clustering (delivery node vs fetch node).',
        'Very hot objects are an exception: forwarding all requests for one viral object to its owner would overload it, so CDNs keep a small local RAM copy on the delivery server or replicate hot keys across several owners — the same hot-key trick as in Redis.',
        'Storage is RAM for the top few percent and NVMe for the rest, with eviction close to LRU but guarded by **admission**: an object must be requested at least twice (or pass a frequency filter) before it is written to SSD, so crawler sweeps and one-hit wonders don’t burn disk write endurance or evict the hot set.',
      ],
      diagram: {
        type: 'flow',
        title: 'Request inside a PoP',
        nodes: [
          { label: 'L4 LB', sub: 'ECMP + flow hash', tone: 'info' },
          { label: 'Delivery server', sub: 'TLS, WAF, key', tone: 'neutral' },
          { label: 'Owner server', sub: 'hash(key) → owner', tone: 'accent' },
          { label: 'RAM / NVMe', sub: 'admit on 2nd hit', tone: 'ok' },
          { label: 'Upstream', sub: 'tier or origin', tone: 'violet' },
        ],
        caption: 'Consistent hashing makes PoP capacity additive; adding a server moves ~1/N of keys.',
      },
      insight:
        'A PoP losing servers loses cache capacity proportionally and rehashes keys onto cold owners — a rolling restart of a PoP is a temporary hit-ratio drop that your origin feels, just like a Redis cluster restart.',
    },
    {
      title: 'Hit-ratio economics and building your own (Open Connect)',
      hook: 'At enough scale, the CDN bill becomes a reason to build a CDN.',
      body: [
        'CDN pricing is per GB delivered (plus per-request fees on some providers), so the CDN bill tracks total bytes, while origin cost tracks misses. The byte hit ratio therefore matters for origin capacity and origin egress, and the CDN unit price matters for the bill. Commit contracts drop list prices by multiples; at petabytes per month, a few tenths of a cent per GB is the whole negotiation.',
        'Netflix built Open Connect because video is huge, predictable and immutable. Appliances sit inside ISPs (free to the ISP), are filled overnight with the titles predicted to be watched there, and the playback control plane in AWS hands each client a ranked list of appliance URLs. No purge problem (files never change), no reactive misses for popular titles, and traffic never crosses the ISP’s transit links.',
        'Self-building only pays when traffic is enormous, content is cacheable and predictable, and you can negotiate with ISPs. Everyone else should buy, and possibly split across two CDNs for resilience and price leverage.',
      ],
      table: {
        columns: ['Lever', 'Effect on CDN bill', 'Effect on origin'],
        rows: [
          ['Higher byte hit ratio', 'none', 'fewer servers, less origin egress'],
          ['Better compression (Brotli, AVIF)', 'fewer bytes billed', 'fewer bytes fetched'],
          ['Committed volume contract', 'lower $/GB', 'none'],
          ['Shield / tiered cache', 'small tier fee on some CDNs', 'large drop in misses'],
          ['Multi-CDN', 'price leverage', 'split cache warmth, more misses'],
        ],
      },
      insight:
        'Shrinking bytes (image formats, compression, not shipping unused JS) is the only lever that cuts both the CDN bill and user latency at the same time — it usually beats any CDN negotiation.',
    },
  ],
  scaling: {
    body: [
      'The data plane scales horizontally by adding servers to PoPs and PoPs to the map; capacity is planned per PoP for peak plus failover traffic from neighbours. Inside a PoP, consistent hashing keeps adding servers from flushing the cache — only ~1/N of keys move.',
      'The **control plane** (config, certificates, WAF rules, purges, edge code) is global and is historically where the largest CDN outages originate: one change reaches every PoP in seconds. Mature CDNs stage changes PoP by PoP with automatic health-gated rollback; customers should do the same with their own config (staging service versions, canary hosts).',
      'Origin-side scaling is about the miss path: shield placement near the origin, collapse, `stale-if-error` for origin outages, and multi-origin failover (primary/secondary origin groups). For CDN-level outages, multi-CDN with DNS steering and health checks is the only defence, at the cost of lowest-common-denominator features and split cache hit ratios.',
    ],
    bullets: [
      'Edge config consistency: version every service config; PoPs may run N and N+1 for seconds during rollout.',
      'Purge propagation is eventually consistent; design for “purged within ~1 s (Fastly) to minutes (CloudFront)”.',
      'PoP failure shifts load to neighbours whose caches are cold for that traffic: expect a hit-ratio dip and origin spike.',
      'Large-file delivery uses range requests and chunked caching so one 4 GB file doesn’t occupy a whole fetch.',
      'Live streaming needs short-TTL manifests + long-TTL segments and collapse at every tier.',
      'Multi-CDN splits traffic and therefore cache warmth; weight by cost and performance, keep both warm.',
    ],
    diagram: {
      type: 'layers',
      title: 'Planes and blast radius',
      layers: [
        { name: 'Customer config', items: ['VCL / rules', 'Edge code', 'Purges'], tone: 'warn' },
        { name: 'CDN control plane', items: ['Global config push', 'Certs', 'WAF rule sets'], tone: 'bad' },
        { name: 'Data plane (PoPs)', items: ['Serves from local state', 'Anycast failover', 'Stale on origin error'], tone: 'ok' },
      ],
      caption: 'Data-plane failures are local; control-plane failures are global.',
    },
  },
  failures: [
    {
      name: 'Cache-key fragmentation',
      symptom: 'Hit ratio stuck at 20–60%; origin traffic grows linearly with users.',
      detect: 'CDN analytics: hit ratio by path/content type, top uncached URLs, count of unique query-string variants; origin request rate vs edge request rate.',
      mitigate: 'Allow-list query params, normalize headers, drop `Vary: User-Agent/Cookie`, separate personalised fragments from cacheable shells.',
    },
    {
      name: 'Origin stampede after purge or PoP failover',
      symptom: 'Origin CPU and 5xx spike right after a global purge, deploy or PoP drain.',
      detect: 'Origin RPS from CDN IP ranges, shield miss rate, `X-Cache: MISS` ratio, correlation with purge API audit log.',
      mitigate: 'Soft purge + stale-while-revalidate, single shield with collapse, versioned URLs instead of purges, origin rate limits.',
    },
    {
      name: 'Private data cached publicly',
      symptom: 'Users see another user’s account page or session cookie.',
      detect: 'Synthetic logged-in probes comparing user identity in responses; alert on `Set-Cookie` in responses served as HIT.',
      mitigate: '`Cache-Control: private, no-store` on all personalised routes, default-deny caching config, strip `Set-Cookie` on cacheable routes.',
    },
    {
      name: 'Bad global config push',
      symptom: 'Errors or 100% CPU across all PoPs within minutes of a change (yours or the provider’s).',
      detect: 'Edge 5xx rate by config version, external synthetic monitoring from multiple networks, provider status feeds.',
      mitigate: 'Staged rollouts with automatic rollback, versioned configs with instant revert, multi-CDN DNS failover for critical properties.',
    },
    {
      name: 'Origin exposed / bypassed',
      symptom: 'Attack traffic or scrapers hit origin directly despite the CDN.',
      detect: 'Origin traffic from non-CDN source IPs; origin RPS not matching CDN miss rate.',
      mitigate: 'Firewall origin to CDN ranges, authenticated origin pulls (mTLS) or a shared secret header, private origin connectivity.',
    },
    {
      name: 'Stale content after deploy',
      symptom: 'New HTML references assets that are missing or old at some PoPs; broken pages for minutes.',
      detect: 'Client-side JS error rate after deploy, 404 rate on asset paths.',
      mitigate: 'Fingerprinted assets uploaded before HTML is switched, keep old assets for days, short TTL on HTML.',
    },
    {
      name: 'Edge certificate expiry or mismatch',
      symptom: 'Browsers show TLS errors for one hostname or one region while origin is healthy.',
      detect: 'External synthetic TLS checks per hostname from several regions; alert on cert days-to-expiry and on handshake failure rate in CDN logs.',
      mitigate: 'Managed auto-renewing certs (ACME) at the CDN, inventory of custom certs with owners, alert at 30/14/7 days.',
    },
  ],
  warStories: [
    {
      title: 'Fastly global outage triggered by one customer’s config',
      source: 'Fastly, “Summary of June 8 outage”, 2021',
      what:
        'A software deployment on May 12 introduced a latent bug. On June 8 a single customer pushed a valid configuration change that triggered it, causing about 85% of Fastly’s network to return errors. Major news sites, Reddit, Amazon and gov.uk were affected; Fastly detected it within a minute and 95% of the network was operating normally within 49 minutes after disabling the config and later deploying a fix.',
      lesson:
        'In a shared multi-tenant edge, one tenant’s input is everyone’s blast radius. Fuzz config paths, roll out code and configs progressively per PoP, and keep a tested multi-CDN or origin-direct fallback for critical properties.',
    },
    {
      title: 'Cloudflare WAF regex exhausts CPU worldwide',
      source: 'Cloudflare blog, “Details of the Cloudflare outage on July 2, 2019”',
      what:
        'A new managed WAF rule contained a regular expression with catastrophic backtracking. WAF rules were deployed globally at once (to respond quickly to threats), so every HTTP-serving core on every server hit 100% CPU, and proxied traffic failed with 502s for ~27 minutes until the WAF ruleset was globally disabled.',
      lesson:
        'Hot-path pattern matching needs linear-time engines (RE2/Rust regex) and CPU limits, and “urgent” changes still need staged rollout. Cloudflare afterwards moved WAF rules onto staged deployment and replaced the backtracking engine.',
    },
    {
      title: 'Cloudbleed: memory leak into cached responses',
      source: 'Cloudflare blog, “Incident report on memory leak caused by Cloudflare parser bug”, February 2017',
      what:
        'A bug in an HTML parser used by edge features (email obfuscation, server-side excludes, automatic HTTPS rewrites) read past the end of a buffer, leaking uninitialized memory — including other customers’ cookies, tokens and request data — into some responses. Some were cached by search engines, which Cloudflare had to work with to purge.',
      lesson:
        'Edge features that rewrite content run in a multi-tenant process: memory-safety bugs there are cross-customer data leaks. A reason for memory-safe languages and isolation in edge runtimes, and for minimising content rewriting at the edge.',
    },
    {
      title: 'Akamai Edge DNS outage takes down major brands',
      source: 'Akamai incident statement, July 22, 2021',
      what:
        'A software configuration update triggered a bug in Akamai’s Edge DNS service. For roughly an hour, DNS lookups for many large customers (airlines, banks, retailers) failed, so their sites were unreachable even though origins and edge caches were healthy. Akamai rolled back the change to restore service.',
      lesson:
        'DNS is part of the CDN’s request path and its control plane: a DNS failure is a total outage regardless of cache health. Critical properties need secondary DNS on an independent provider, not just multi-CDN behind one DNS.',
    },
  ],
  numbers: [
    { label: 'Edge RTT to user', value: '~5–20 ms', note: 'vs 100–250 ms cross-continent origin' },
    { label: 'Good static hit ratio', value: '95–99%', note: 'requests; check bytes separately' },
    { label: 'Fastly purge', value: '~150 ms global', note: 'CloudFront: seconds to minutes' },
    { label: 'CloudFront invalidations', value: '1,000 paths/month free', note: 'then per path' },
    { label: 'CloudFront egress (US)', value: '~$0.085/GB', note: 'first 10 TB; falls with volume and commits' },
    { label: 'PoP footprint', value: 'Cloudflare 300+ cities', note: 'CloudFront 600+ PoPs, Akamai ~4,000 locations' },
    { label: 'TLS 1.3 handshake', value: '1 RTT', note: 'QUIC: 1 RTT incl. transport; 0-RTT on resumption' },
    { label: 'Shield hop cost', value: '~10–50 ms', note: 'only on edge misses' },
    { label: 'Open Connect appliance', value: '100–400 Gbps', note: 'per server, FreeBSD + NGINX' },
    { label: 'Intra-PoP rehash on add', value: '~1/N keys move', note: 'consistent hashing' },
    { label: 'Origin load with shield', value: '≈ 1 fetch / object / TTL', note: 'with request collapsing at every tier' },
    { label: 'Long-lived asset TTL', value: 'max-age=31536000', note: '1 year + `immutable` for hashed names' },
  ],
  capacity: {
    question:
      'An image-heavy site serves 20k requests/s at peak (avg 150 KB) and ~1.5 PB/month. What do origin traffic and CDN cost look like at 90% vs 98% byte hit ratio?',
    steps: [
      'Peak edge bandwidth: 20k × 150 KB = 3 GB/s ≈ 24 Gbps; the CDN absorbs that, origin only sees misses.',
      'At 90% byte hit ratio: origin = 10% → 2.4 Gbps peak and 150 TB/month of origin egress; at 98% → 0.48 Gbps and 30 TB/month.',
      'Origin request rate (request hit ratio ~ byte ratio here): 2,000 vs 400 req/s → roughly 5× fewer origin servers and DB/storage calls.',
      'CDN egress at a blended ~$0.02–0.04/GB committed rate: 1.5 PB ≈ $30k–60k/month either way; origin egress (if not free to the CDN) at $0.05–0.09/GB: ~$7.5k–13.5k vs ~$1.5k–2.7k.',
      'Adding a shield typically moves long-tail byte hit ratio by several points — here the difference between 90% and 98% is worth ~5× origin capacity.',
    ],
    answer:
      'CDN cost is driven by total bytes and barely moves; origin cost and capacity scale with the miss ratio, so going from 90% to 98% cuts origin traffic 5× — invest in cache keys, TTLs and shielding before buying origin capacity.',
  },
  comparison: {
    caption: 'CDN options',
    columns: ['Product', 'Routing', 'Invalidation', 'Edge compute', 'Strengths / watch-outs'],
    rows: [
      ['Cloudflare', 'Anycast everywhere', 'URL, prefix, host, `Cache-Tag`', 'Workers (V8 isolates)', 'Bundled security, no per-GB egress on plans; less low-level cache control'],
      ['Fastly', 'Anycast', '~150 ms purge, surrogate keys, soft purge', 'Compute (Wasm), VCL', 'Programmable caching, instant purge; fewer, larger PoPs'],
      ['Akamai', 'DNS mapping, deep ISP presence', 'URL, CP code, `Edge-Cache-Tag`', 'EdgeWorkers', 'Largest footprint, enterprise media/security; complex config'],
      ['Amazon CloudFront', 'DNS-based', 'Path/wildcard, per-path fee', 'CloudFront Functions, Lambda@Edge', 'Deep AWS integration, free origin fetch from AWS; slower invalidations'],
      ['Self-built (Netflix Open Connect)', 'App control plane steers', 'Proactive fill, content is immutable', 'None needed', 'Lowest unit cost at massive scale; needs ISP partnerships and a team'],
    ],
  },
  whenNot: [
    'Per-user, write-heavy or strongly consistent responses: there is nothing to cache — use the CDN only for TLS/routing acceleration, or go direct.',
    'Internal service-to-service traffic inside a region: add latency and cost for no benefit — use the service mesh/LB and an internal cache.',
    'Small audiences concentrated near one region: a single regional LB with HTTP/2 and good compression may be simpler and cheaper.',
    'Data with strict residency or confidentiality limits where edge TLS termination by a third party is not allowed (unless using keyless/regional services).',
    'As a substitute for fixing slow origin pages that are uncacheable: the miss path still runs at origin speed.',
  ],
  interview: [
    {
      q: 'Design CDN caching for a news site where articles are edited after publication.',
      a: 'Static assets get fingerprinted names and one-year `immutable` caching. Article HTML gets `s-maxage` of minutes plus `stale-while-revalidate` and `stale-if-error`, and is tagged with surrogate keys for the article, its section and authors. The CMS publishes change events that trigger a soft purge by tag, so edits appear within ~1 s on a Fastly-class CDN while origin sees one revalidation per object. An origin shield and request collapsing protect origin during breaking-news spikes.',
      followUps: ['What happens to the homepage that lists 50 articles when one changes?', 'How do you handle a purge storm during breaking news?', 'What if the CDN were CloudFront without tag purge?'],
      seniorSignal: 'Separates content classes with different headers and uses event-driven tag purges with soft purge rather than global hard purges or tiny TTLs.',
    },
    {
      q: 'Anycast vs DNS-based routing — what are the trade-offs?',
      a: 'Anycast announces one prefix from all PoPs and lets BGP pick the nearest; it fails over quickly by withdrawing routes and naturally spreads DDoS, but BGP is not latency-aware and offers only coarse traffic control. DNS-based routing chooses a PoP per query using measurements and load, allowing precise steering, but it sees the resolver rather than the user (EDNS Client Subnet helps) and failover is limited by DNS TTLs and caching. Large CDNs often combine them.',
      followUps: ['How does a TCP connection survive a BGP route change under anycast?', 'Why does EDNS Client Subnet matter?', 'How would you build multi-CDN failover?'],
      seniorSignal: 'Brings up failover timing, DDoS behaviour and the resolver-vs-user problem, not just “anycast is faster”.',
    },
    {
      q: 'Your CDN hit ratio is 55%. How do you investigate?',
      a: 'Break it down by content type and path, request vs byte ratio, and by cache status (MISS, EXPIRED, PASS/uncacheable). Look for cache-key fragmentation (query params, `Vary` on User-Agent or Cookie), responses marked `private`/`no-cache` or with `Set-Cookie`, very short TTLs, and long-tail content missing in each PoP independently, which a shield fixes. Then fix headers at origin, normalize keys and add tiering, and re-measure per change.',
      followUps: ['What is the difference between PASS and MISS?', 'Why might byte hit ratio be much lower than request hit ratio?', 'How does a shield change the numbers?'],
      seniorSignal: 'Uses cache-status breakdowns and distinguishes uncacheable from evicted from expired traffic.',
    },
    {
      q: 'How can a CDN make an uncacheable, personalised API faster?',
      a: 'It terminates TLS and QUIC near the user, saving long-haul round trips on connection setup. It reuses warm, long-lived connections to origin with large congestion windows and can route over a better path or private backbone. Edge compute can do auth checks, redirects or assemble a cacheable shell with a small personalised fragment fetched from origin. Typical gains are tens of ms per request on far-away users.',
      followUps: ['What is 0-RTT and why is it restricted to idempotent requests?', 'What is the security model of terminating TLS at a third party?', 'When would you split a page into cached shell + personalised fragments?'],
      seniorSignal: 'Quantifies RTT savings and knows the 0-RTT replay caveat.',
    },
    {
      q: 'How do you protect a live-streaming origin when a match draws 10M viewers?',
      a: 'Segments are immutable and get long TTLs; manifests have TTLs around the segment duration. Every tier must collapse concurrent misses so each new segment is fetched from origin once per shield, not per viewer or per PoP. Use an origin shield, pre-scale or pre-warm edge capacity in the right regions, keep `stale-if-error` on manifests, and possibly multi-CDN to spread load.',
      followUps: ['What happens if request collapsing is disabled for manifests?', 'How do you size origin for this?', 'How would you fail over between CDNs mid-stream?'],
      seniorSignal: 'Identifies manifest vs segment caching behaviour and request collapsing as the core mechanism.',
    },
    {
      q: 'What can a customer do to limit their exposure to a CDN-wide outage like Fastly 2021?',
      a: 'Keep critical properties behind DNS that can switch providers — multi-CDN with health-checked steering and low TTLs — and keep the secondary path warm and configured equivalently. Keep an origin that can survive serving some traffic directly, at least for critical paths. Stage your own CDN config changes and keep instant rollback. Accept that failover is DNS-bound, so measure it in minutes.',
      followUps: ['What features do you lose with multi-CDN?', 'How do you keep two CDNs’ configs in sync?', 'What does it cost?'],
      seniorSignal: 'Recognises the control plane as the global blast radius and plans DNS-level failover with realistic timings.',
    },
    {
      q: 'How would you serve paid video so that only subscribers can watch it, without losing cacheability?',
      a: 'The app authorizes the user and returns signed URLs or signed cookies with a short expiry, scoped to a path prefix (e.g. the title’s segment directory). The edge verifies the signature locally with a shared or public key, so no origin call is needed. The cache key excludes the signature and expiry parameters, so all subscribers share one cached copy. DRM protects the content itself; the signature only controls who can fetch it.',
      followUps: ['Signed URLs vs signed cookies for HLS with hundreds of segment requests?', 'How do you rotate signing keys?', 'What stops a subscriber from sharing a signed URL?'],
      seniorSignal: 'Keeps authorization at the edge while explicitly keeping tokens out of the cache key.',
    },
    {
      q: 'An API response varies by language and device type. How do you cache it at the CDN without destroying the hit ratio?',
      a: 'Never `Vary` on raw `User-Agent` or `Accept-Language`, which have thousands of distinct values. Normalize at the edge into a small set — e.g. an edge function maps User-Agent to `mobile|desktop` and Accept-Language to one of the supported locales — and put that normalized value into the cache key (or a custom header that you `Vary` on). That gives a handful of variants per URL. Better still, put the locale in the URL path so it is explicit and shareable.',
      followUps: ['Where does the normalization run and what does it cost?', 'How does this interact with browser caches?', 'What happens when you add a new locale?'],
      seniorSignal: 'Controls variant cardinality explicitly instead of trusting `Vary` on raw headers.',
    },
  ],
  takeaways: [
    'A CDN wins by cutting round trips: TLS at the edge, cached bytes nearby, warm connections upstream.',
    'Hit ratio is set by your cache key and `Cache-Control` headers; measure request and byte hit ratios separately.',
    'Fingerprinted assets need no purges; stable URLs use surrogate keys with soft purge.',
    'Tiered caching + request collapsing make origin load ~one fetch per object per TTL.',
    '`stale-while-revalidate` and `stale-if-error` turn the CDN into an availability layer for origin.',
    'Control-plane pushes are the global blast radius: stage them, and keep DNS-level multi-CDN for critical paths.',
    'Lock origin to the CDN, or DDoS protection is optional for attackers.',
    'Edge config, WAF rules and edge code deploy globally in seconds: canary them per PoP like any production release.',
  ],
};
export default deep;
