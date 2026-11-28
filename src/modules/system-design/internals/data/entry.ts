import type { Internals } from '../types';

export const ENTRY_INTERNALS: Internals[] = [
  // ───────────────────────────── DNS ─────────────────────────────
  {
    kind: 'dns',
    summary:
      'DNS is a hierarchical, heavily cached, eventually consistent key-value lookup: hostname → records. A **recursive resolver** walks root → TLD → authoritative servers and caches every answer for its TTL. Smart authoritative servers (GeoDNS, latency routing, health-checked failover) turn this lookup into a coarse, global traffic-steering layer.',
    parts: [
      { id: 'stub', name: 'Stub resolver', role: 'OS/browser cache, asks one resolver', detail: 'The browser and OS (`getaddrinfo`, `systemd-resolved`, `nscd`) keep a small cache and send a single recursive query over UDP/53 (or DoH/DoT) to the configured resolver. Browsers cap TTLs (Chrome ~60 s) regardless of what you set.' },
      { id: 'recursive', name: 'Recursive resolver', role: 'Walks the hierarchy, caches answers', detail: 'ISP resolver or public anycast resolvers (`8.8.8.8`, `1.1.1.1`). Holds a huge shared cache keyed by (name, type); a cache hit answers in ~1 ms. On a miss it iterates, caching NS/glue records along the way so most lookups skip root and TLD.' },
      { id: 'root', name: 'Root servers', role: 'Point to the TLD servers', detail: '13 logical root identities (`a`–`m.root-servers.net`) served by **1,500+ anycast instances**. They only answer referrals like "`.com` is served by these NS", cached for 2 days, so they see a tiny share of traffic.' },
      { id: 'tld', name: 'TLD servers', role: 'Point to the domain’s nameservers', detail: 'Operated by the registry (Verisign for `.com`). Returns the NS delegation for `example.com` plus glue A records, typically with a 1–2 day TTL — which is why changing nameservers is slow.' },
      { id: 'authoritative', name: 'Authoritative DNS', role: 'Owns the zone, returns final records', detail: 'Route 53, Cloudflare DNS, NS1. Anycast fleets serving the zone from memory; the answer can be **computed per query**: GeoDNS by resolver IP or EDNS Client Subnet, latency-based, weighted, or failover records.' },
      { id: 'health', name: 'Health checker', role: 'Removes dead endpoints from answers', detail: 'Distributed probers hit each endpoint (`HTTPS /health` every 10–30 s from several regions). When a quorum fails, the record is pulled from answers so new lookups go to the healthy region.' },
    ],
    flow: [
      { part: 'stub', title: 'Local cache miss', text: 'The browser needs `api.example.com`. Neither the browser nor the OS has a fresh entry, so the stub sends one query to the recursive resolver.' },
      { part: 'recursive', title: 'Resolver checks its cache', text: 'A busy resolver usually already has the answer (hit → ~1 ms). On a miss it still has the `.com` NS cached, so it skips the root entirely.' },
      { part: 'root', title: 'Root referral (rare)', text: 'Only on a cold cache: the nearest anycast root instance replies "ask the `.com` servers" — a referral, not an answer.' },
      { part: 'tld', title: 'TLD delegation', text: 'The `.com` server returns the NS records for `example.com` (e.g. `ns-1.awsdns-…`) plus glue IPs.' },
      { part: 'authoritative', title: 'Answer computed per query', text: 'Route 53 sees the resolver (or ECS subnet) is in Frankfurt and returns the `eu-central-1` LB IPs with **TTL 60**. A plain zone would return the same static record to everyone.' },
      { part: 'health', title: 'Failover baked into answers', text: 'If `eu-central-1` fails its health checks, the authoritative server starts returning `eu-west-1` instead. Clients holding the old answer keep using it until their TTL expires.' },
      { part: 'recursive', title: 'Cached for TTL', text: 'The resolver caches the answer for 60 s and serves it to millions of users behind it. This caching is why DNS scales — and why failover is never instant.' },
    ],
    knobs: [
      {
        name: 'TTL',
        options: [
          { label: 'Short (30–60 s)', effect: 'Fast failover and traffic shifts; more queries to authoritative servers (cost) and a bit more lookup latency.', when: 'Records you steer: LB endpoints, failover, blue/green cutovers.' },
          { label: 'Long (1 h – 1 day)', effect: 'Nearly all lookups served from cache, resilient to DNS provider outages; changes take hours to propagate.', when: 'Stable records: MX, NS, static asset hosts. Lower it a day before a planned migration.' },
        ],
      },
      {
        name: 'Routing policy',
        options: [
          { label: 'Simple / round-robin', effect: 'Returns all IPs, clients pick one. No health or load awareness; clients cache and stick.', when: 'Tiny setups; never as your only load balancing.' },
          { label: 'GeoDNS / latency-based', effect: 'Answer depends on where the resolver is; routes users to the nearest region. Accuracy depends on resolver location (ECS helps).', when: 'Multi-region active/active.' },
          { label: 'Failover / weighted', effect: 'Health-checked primary/secondary, or % splits for canary regions.', when: 'DR setups, gradual region migrations.' },
        ],
      },
      {
        name: 'Anycast vs unicast nameservers',
        options: [
          { label: 'Anycast', effect: 'Same IP announced via BGP from many PoPs; queries hit the nearest one and DDoS is spread out.', when: 'Any serious authoritative DNS (all major providers).' },
          { label: 'Unicast', effect: 'Few fixed servers; latency to far users and an easy DDoS target.', when: 'Internal/private zones only.' },
        ],
      },
    ],
    implementations: [
      { name: 'BIND / Unbound / CoreDNS', how: 'BIND is the classic authoritative + recursive server; Unbound a fast caching recursive resolver; CoreDNS a plugin-chain Go server that is the default DNS inside Kubernetes (`svc.cluster.local`).' },
      { name: 'Amazon Route 53', how: 'Authoritative-only, anycast across 4 NS sets on different TLDs for blast-radius isolation. Alias, latency, geolocation, weighted and failover records backed by global health checkers; 100% availability SLA.' },
      { name: 'Cloudflare 1.1.1.1 / Google 8.8.8.8', how: 'Anycast recursive resolvers in hundreds of PoPs with shared caches per PoP, DNSSEC validation, DoH/DoT, aggressive prefetch of popular names before TTL expiry.' },
      { name: 'NS1 / Akamai GTM', how: 'Traffic-management DNS with "filter chains" per record: health → geo → shuffle → select-first-N, fed by real-user latency telemetry.' },
    ],
    ha: 'DNS is made available by **massive redundancy plus caching**: every zone has ≥2 NS (ideally on different providers), each NS IP is anycast across many PoPs, and resolver caches keep answering even while the authoritative tier is down (some serve stale per RFC 8767). The Dyn outage (2016) showed the risk of a single DNS provider — big sites now run multi-provider DNS.',
    failureModes: [
      { name: 'Slow failover', symptom: 'Region dies but traffic keeps arriving for minutes: resolvers, JVMs (`networkaddress.cache.ttl`) and apps cache the old IP beyond the TTL.', fix: 'Short TTLs on steered records, plus an anycast/global LB layer that fails over without DNS changes.' },
      { name: 'DNS provider outage', symptom: 'Every lookup fails once caches expire → total outage even though servers are fine.', fix: 'Secondary DNS provider, longer TTLs on stable records, serve-stale on resolvers.' },
      { name: 'Treating DNS RR as a load balancer', symptom: 'Uneven load, traffic still going to dead IPs, clients pinning one address.', fix: 'Point DNS at a real LB (VIP/anycast); use DNS only for coarse region selection.' },
      { name: 'Misconfig propagation', symptom: 'A bad record with a 1-day TTL is cached worldwide and cannot be recalled.', fix: 'Lower TTLs before changes, stage changes, keep NS TTLs in mind.' },
    ],
    numbers: ['Resolver cache hit ~1 ms; full cold resolution ~50–200 ms', 'Root: 13 identities, 1,500+ anycast instances', 'Typical steered TTL 60 s ⇒ ~1–5 min real failover (sticky clients)', 'Route 53: $0.40 per million queries'],
    interview: [
      { q: 'Walk me through what happens when you type a URL and DNS resolves it.', a: 'Browser and OS caches first, then one recursive query to the resolver. On a miss the resolver iterates: root gives the TLD referral, TLD gives the domain’s NS, the authoritative server returns the record with a TTL. Every step is cached, so most lookups end at the resolver in ~1 ms.' },
      { q: 'Can you use DNS for failover between regions? What are the limits?', a: 'Yes — health-checked failover or latency records in Route 53. The limit is caching: even with TTL 60 s, resolvers, OSes and long-running clients hold old answers, so expect minutes, not seconds. For faster failover put anycast or a global L7 LB (e.g. Global Accelerator, Cloudflare) in front so the IP never changes.' },
      { q: 'How does GeoDNS know where the user is?', a: 'It sees the recursive resolver’s IP, not the user’s, so a user on a far-away public resolver gets mis-routed. EDNS Client Subnet passes a truncated client subnet to the authoritative server to fix this; anycast resolvers also help because they sit near users.' },
    ],
  },

  // ───────────────────────────── CDN ─────────────────────────────
  {
    kind: 'cdn',
    summary:
      'A CDN is a globally distributed, tiered reverse-proxy cache. Anycast or GeoDNS lands the user on a nearby PoP that terminates TLS and serves from RAM/SSD; misses go up to a regional tier or **origin shield** and only then to your origin. Hit ratio is everything: it is decided by the cache key, the TTLs you send, and how you invalidate.',
    parts: [
      { id: 'anycast', name: 'Anycast routing', role: 'Lands user on the nearest PoP', detail: 'The same IP prefix is announced via BGP from hundreds of PoPs, so the internet’s routing delivers packets to the topologically closest one (some CDNs use GeoDNS instead). Also absorbs DDoS by spreading it.' },
      { id: 'edge-tls', name: 'Edge TLS', role: 'Terminates TLS/HTTP3 close to user', detail: 'The TLS (or QUIC) handshake happens ~10 ms from the user instead of ~150 ms away at origin. Certs are distributed to every PoP (or keyless SSL keeps the private key at the customer).' },
      { id: 'cache-key', name: 'Cache key', role: 'Normalises request into lookup key', detail: 'Usually `scheme + host + path + selected query params`, plus headers listed in `Vary` (e.g. `Accept-Encoding`). Dropping useless params (`utm_*`) and not varying on cookies is the biggest hit-ratio lever.' },
      { id: 'edge-cache', name: 'Edge cache', role: 'RAM + SSD object store, LRU', detail: 'Hot objects in RAM, the long tail on NVMe SSD, evicted with LRU-like policies (often segmented LRU to resist one-hit wonders). Each PoP has many servers; the key is consistent-hashed to one server so the PoP’s capacity isn’t duplicated.' },
      { id: 'collapse', name: 'Request collapsing', role: 'Merges concurrent misses into one', detail: 'If 10k users miss the same object at once, only **one** request goes upstream; the rest wait on it (NGINX `proxy_cache_lock`, Varnish request coalescing). Prevents a thundering herd on origin.' },
      { id: 'shield', name: 'Origin shield', role: 'Regional tier in front of origin', detail: 'A designated mid-tier PoP that all edges ask on a miss, so origin sees one fetch per object instead of one per PoP. Raises the overall hit ratio from ~85% to ~95%+.' },
      { id: 'origin', name: 'Origin', role: 'Source of truth (S3, app servers)', detail: 'Your S3 bucket or app/LB. Sends `Cache-Control`, `ETag` and `Last-Modified` that drive every caching decision downstream; should only see misses and revalidations.' },
    ],
    flow: [
      { part: 'anycast', title: 'Nearest PoP via BGP', text: 'A user in Mumbai resolves `cdn.example.com` to an anycast IP; BGP routes the SYN to the Mumbai PoP, not to Virginia.' },
      { part: 'edge-tls', title: 'TLS at the edge', text: 'TLS 1.3 / QUIC handshake completes in one ~10 ms round trip. Everything after this is a local cache lookup or a reused warm connection upstream.' },
      { part: 'cache-key', title: 'Key built', text: '`GET /img/logo.v42.png?utm_source=x` → key `https://cdn.example.com/img/logo.v42.png` + `Accept-Encoding: br`. The `utm` param is stripped so all campaigns share one entry.' },
      { part: 'edge-cache', title: 'Edge lookup', text: 'Hit in RAM → served in <1 ms of server time. If the object is stale but within `stale-while-revalidate`, it is served immediately and refreshed in the background.' },
      { part: 'collapse', title: 'Misses collapsed', text: 'On a true miss, concurrent requests for the same key queue behind a single upstream fetch instead of stampeding.' },
      { part: 'shield', title: 'Shield checked', text: 'The edge asks the Singapore shield, which likely has it from another PoP’s earlier miss. One more cache layer before origin.' },
      { part: 'origin', title: 'Origin fetch (rare)', text: 'Only if the shield also misses: S3 returns the object with `Cache-Control: public, max-age=31536000, immutable`. Shield and edge store it and stream it back.' },
    ],
    knobs: [
      {
        name: 'Invalidation strategy',
        options: [
          { label: 'Versioned URLs', effect: 'New content = new URL (`app.3f9a.js`), so objects can be cached forever with `immutable`; no purge needed, instant and atomic.', when: 'All static assets built by a pipeline. The default answer.' },
          { label: 'Purge API', effect: 'Removes a URL or tag from every PoP; Fastly ~150 ms globally, CloudFront seconds–minutes and charged per path.', when: 'Content at a fixed URL that must change (articles, prices).' },
          { label: 'Short TTL + revalidate', effect: 'Edge re-checks with `If-None-Match` → `304` after a few seconds; bounded staleness, more origin hits.', when: 'Semi-dynamic pages, API responses.' },
        ],
      },
      {
        name: 'Tiering',
        options: [
          { label: 'Edge only', effect: 'Each PoP misses independently: N PoPs ⇒ up to N origin fetches per object.', when: 'Small footprint or very hot content.' },
          { label: 'Edge + origin shield', effect: 'One origin fetch per object; extra hop on misses.', when: 'Long-tail catalogs (video, images), weak origins.' },
        ],
      },
      {
        name: 'Staleness on failure',
        options: [
          { label: 'Strict TTL', effect: 'Once expired, origin errors become user errors.', when: 'Content that must never be stale.' },
          { label: 'stale-if-error / stale-while-revalidate', effect: 'Serve the old copy while refreshing or while origin is down; the CDN becomes an availability layer.', when: 'Most public content.' },
        ],
      },
    ],
    implementations: [
      { name: 'Cloudflare', how: 'Anycast everywhere: every server in every PoP runs every service. Cache is built on NGINX-derived and newer Rust proxies (Pingora), with Tiered Cache and Cache Reserve (R2-backed) for the long tail.' },
      { name: 'Fastly', how: 'Varnish-based with VCL / Compute@Edge (Wasm) for custom logic; famous for ~150 ms global **instant purge** and surrogate-key (tag) purging.' },
      { name: 'Amazon CloudFront', how: '400+ edge locations + regional edge caches as a built-in mid tier, optional Origin Shield; Lambda@Edge / CloudFront Functions for request rewriting.' },
      { name: 'Netflix Open Connect', how: 'Netflix’s own appliances placed inside ISPs, pre-filled overnight with predicted popular titles; ~95%+ of traffic served without crossing the ISP boundary.' },
    ],
    ha: 'Availability comes from the fleet: anycast withdraws a sick PoP’s BGP route and traffic shifts to the next-nearest PoP automatically; inside a PoP, the LB rehashes keys away from a dead server. Serve-stale directives let the CDN keep answering while **your origin** is down; multi-CDN (with DNS steering) protects against a CDN-wide outage.',
    failureModes: [
      { name: 'Cache-key explosion', symptom: 'Hit ratio ~10% because keys include cookies, session ids or random query params.', fix: 'Whitelist query params and headers in the key; never `Vary: Cookie` on public content.' },
      { name: 'Thundering herd on purge/expiry', symptom: 'A global purge of a hot object sends every PoP to origin at once; origin falls over.', fix: 'Request collapsing, origin shield, soft purge (mark stale) + stale-while-revalidate.' },
      { name: 'Caching private data', symptom: 'User A sees user B’s account page served from the edge.', fix: '`Cache-Control: private, no-store` on personalised responses; cache only explicitly public routes.' },
      { name: 'Stale content after deploy', symptom: 'New HTML references `app.js` that is still the old version at the edge.', fix: 'Fingerprinted asset names; short TTL on HTML, long on hashed assets.' },
    ],
    numbers: ['Edge hit: ~5–20 ms to user vs ~100–300 ms cross-continent origin', 'Good static hit ratio: 90–99% (by bytes)', 'Fastly purge ~150 ms; CloudFront invalidation seconds–minutes', 'Egress ~$0.02–0.085/GB depending on region and volume'],
    interview: [
      { q: 'How do you update a JS bundle that is cached at the CDN for a year?', a: 'You don’t purge it — you change its name. The build fingerprints assets (`app.3f9a.js`), HTML references the new name, and HTML itself has a short TTL. Old and new versions coexist, so the cutover is atomic and needs no invalidation.' },
      { q: 'A viral video makes origin collapse even though it is behind a CDN. Why?', a: 'Each of hundreds of PoPs (and each server inside them) misses independently at the same moment. Fix with an origin shield so there is one origin fetch per object, request collapsing so concurrent misses share one fetch, and stale-while-revalidate so expiry never causes a stampede.' },
      { q: 'Can a CDN help with dynamic, per-user APIs?', a: 'Not by caching the response, but yes for latency: TLS terminates near the user and the CDN reuses warm, long-lived connections over its private backbone to origin. Edge compute can also handle auth or personalisation of cached fragments.' },
    ],
    lab: 'eviction',
  },

  // ───────────────────────────── API GATEWAY ─────────────────────────────
  {
    kind: 'api-gateway',
    summary:
      'An API gateway is an L7 reverse proxy with a **filter (plugin) chain**: every request passes through authentication, rate limiting, transformation and routing before reaching a backend service. It centralises cross-cutting concerns so services don’t each reimplement them — but it must stay thin and highly available because every call goes through it.',
    parts: [
      { id: 'listener', name: 'Listener + TLS', role: 'Accepts and decrypts client traffic', detail: 'Event-loop workers (NGINX/Envoy style) terminate TLS/HTTP2, enforce max body size and header limits, and assign a **request id** for tracing.' },
      { id: 'route', name: 'Route matcher', role: 'Maps method+path to an upstream', detail: 'A route table (`GET /v1/orders/{id} → orders-svc`) compiled into a prefix trie or regex set. The matched route selects which plugins run and with what config.' },
      { id: 'auth', name: 'Auth filter', role: 'Validates API key, JWT or OAuth', detail: 'JWTs are verified locally with cached public keys from a JWKS endpoint (no network call per request); opaque tokens/API keys need a lookup cached for a few seconds. Injects identity headers like `X-User-Id` for services.' },
      { id: 'limit', name: 'Rate-limit filter', role: 'Enforces quotas per key/plan', detail: 'Token bucket per API key or user, local in memory or against Redis / a rate-limit service (Envoy `ratelimit`). Returns `429` with `Retry-After` before any backend work is done.' },
      { id: 'transform', name: 'Transformer', role: 'Rewrites, versions, aggregates requests', detail: 'Header/path rewrites, REST↔gRPC transcoding, request validation against an OpenAPI schema, and optionally fan-out aggregation (BFF) that merges several service responses.' },
      { id: 'upstream', name: 'Upstream client', role: 'Balances, retries, times out to services', detail: 'Service discovery (DNS, Consul, k8s endpoints), load balancing, per-route timeouts, retry budgets and circuit breakers. Emits metrics, access logs and trace spans for every call.' },
    ],
    flow: [
      { part: 'listener', title: 'Request arrives', text: '`POST /v1/orders` over HTTP/2. TLS is terminated, a request id `req-7f3a` is attached and a trace span starts.' },
      { part: 'route', title: 'Route resolved', text: 'Trie lookup matches `/v1/orders` → `orders-svc` with plugins `[jwt, rate-limit(100/min), validate]`.' },
      { part: 'auth', title: 'JWT verified locally', text: 'Signature checked against the cached JWKS key, `exp` and `aud` validated in microseconds. Invalid → `401` here; the service never sees it.' },
      { part: 'limit', title: 'Quota checked', text: 'User `u42` on the free plan has 3 tokens left in its bucket → allowed. At 0 tokens the gateway replies `429` with `Retry-After: 12`.' },
      { part: 'transform', title: 'Request shaped', text: 'Body validated against the schema, `X-User-Id: u42` injected, `/v1/orders` rewritten to the internal `/orders` path.' },
      { part: 'upstream', title: 'Forwarded with guardrails', text: 'Sent to a healthy `orders-svc` pod with a 2 s timeout; if the circuit for that service is open the gateway fails fast with `503` instead of piling on.' },
    ],
    knobs: [
      {
        name: 'Gateway scope',
        options: [
          { label: 'Thin edge gateway', effect: 'Only auth, limits, routing, TLS. Services own business logic; gateway stays generic and fast.', when: 'Default. Keeps teams independent.' },
          { label: 'BFF / aggregation', effect: 'Gateway (or a per-client BFF) fans out and merges responses for mobile/web; fewer round trips, but logic and coupling move into the gateway.', when: 'Chatty mobile clients; one BFF per client type, owned by that frontend team.' },
        ],
      },
      {
        name: 'Token validation',
        options: [
          { label: 'Local JWT verify', effect: 'No network hop, scales linearly; revocation is delayed until expiry (keep `exp` short, ~5–15 min).', when: 'High-QPS APIs.' },
          { label: 'Introspection call', effect: 'Instant revocation, but adds a dependency and ~1–5 ms per request (cache helps).', when: 'Opaque tokens, high-security operations.' },
        ],
      },
      {
        name: 'Deployment',
        options: [
          { label: 'Managed (AWS API GW, Apigee)', effect: 'No ops, built-in keys/usage plans; per-request pricing and limits (e.g. 29 s timeout on REST APIs).', when: 'Serverless, small teams, moderate QPS.' },
          { label: 'Self-hosted (Kong, Envoy)', effect: 'Full control, cheap at high QPS, custom plugins; you run HA and upgrades.', when: 'High QPS, Kubernetes platforms, custom logic.' },
        ],
      },
    ],
    implementations: [
      { name: 'Kong', how: 'Built on NGINX + OpenResty (LuaJIT): each request runs plugin phases (`access`, `header_filter`, `log`). Config in Postgres or DB-less YAML, cached in worker memory.' },
      { name: 'Envoy-based (Envoy Gateway, Istio ingress, Ambassador)', how: 'An ordered list of HTTP filters (`jwt_authn`, `ratelimit`, `ext_authz`, `router`) per listener, configured dynamically via xDS from a control plane.' },
      { name: 'AWS API Gateway', how: 'Fully managed, multi-tenant fleet in front of Lambda/HTTP backends; usage plans and API keys for throttling, Lambda/Cognito authorizers with result caching. HTTP APIs are cheaper and faster than REST APIs.' },
      { name: 'Netflix Zuul 2', how: 'Async Netty-based Java gateway with inbound/endpoint/outbound filter chains; famous for dynamic routing and load shedding at Netflix’s edge.' },
    ],
    ha: 'The gateway is stateless by design: run many replicas across AZs behind an L4 LB / anycast, keep config in a control plane pushed to every node, and keep shared state (rate-limit counters) in Redis that **fails open** if unavailable. Separate gateways per domain or tenant contain blast radius.',
    failureModes: [
      { name: 'God gateway', symptom: 'Business logic and orchestration pile into gateway plugins; every team blocks on one deploy queue.', fix: 'Keep only cross-cutting concerns; aggregation goes into per-client BFFs owned by product teams.' },
      { name: 'Hard dependency on auth/limit store', symptom: 'Redis or the auth service blips → gateway returns 5xx for everything.', fix: 'Local JWT validation, cached decisions, fail-open rate limiting with local fallback buckets.' },
      { name: 'Timeout mismatch', symptom: 'Gateway timeout 30 s, service 60 s: clients get 504s while the service keeps working (and retries duplicate it).', fix: 'Deadlines shrink inward (gateway > service > DB); propagate a deadline header; idempotency keys for retries.' },
    ],
    numbers: ['Self-hosted gateway overhead: ~0.5–2 ms per request', 'Envoy/Kong: ~10k+ req/s per core for simple routes', 'AWS API GW: default 10k req/s per account per region, ~$1–3.50 per million calls'],
    interview: [
      { q: 'What belongs in the API gateway and what doesn’t?', a: 'In: TLS, authentication, coarse authorisation, rate limiting, routing, request validation, observability. Out: business rules and multi-service orchestration — those belong in services or a BFF owned by the client team. A gateway full of logic becomes a distributed monolith’s bottleneck.' },
      { q: 'How does the gateway validate a JWT without calling the auth server each time?', a: 'It caches the issuer’s public keys from the JWKS endpoint and verifies the signature, `exp`, `iss` and `aud` locally in microseconds. Because revocation then waits for expiry, tokens are short-lived and refreshed; high-risk actions can still do an introspection call.' },
      { q: 'API gateway vs load balancer vs service mesh?', a: 'An LB spreads traffic over replicas of one thing. A gateway is a smart L7 entry point for **north-south** traffic with API concerns (keys, quotas, versioning). A service mesh handles **east-west** service-to-service traffic with sidecars (mTLS, retries). Envoy can play all three roles.' },
    ],
    lab: 'gateway',
    moreLabs: ['ratelimit'],
  },

  // ───────────────────────────── RATE LIMITER ─────────────────────────────
  {
    kind: 'rate-limiter',
    summary:
      'A rate limiter decides, per request, whether a key (user, API key, IP) still has budget. The algorithm (token bucket, sliding window…) defines the shape of allowed traffic; the hard part at scale is keeping the counter **atomic and shared** across many gateway nodes without adding a slow network hop to every request.',
    parts: [
      { id: 'key', name: 'Key extractor', role: 'Identifies who the request counts against', detail: 'Builds the limit key from the request: API key, user id from the JWT, IP (careful with NAT and `X-Forwarded-For` spoofing), plus route or tier, e.g. `rl:{apikey}:POST:/charges`.' },
      { id: 'rules', name: 'Rule lookup', role: 'Finds the limit for this key', detail: 'Rules like "free plan: 100 req/min, burst 20" loaded from config and cached in memory. Multiple rules can apply (per-second burst + per-day quota); all must pass.' },
      { id: 'local', name: 'Local bucket', role: 'In-process fast path, no network', detail: 'An in-memory token bucket per key on each node (a hash map with lazy refill on access). Absorbs most decisions in nanoseconds; with N nodes each gets ~1/N of the global limit, or syncs periodically.' },
      { id: 'store', name: 'Shared counter', role: 'Atomic global count in Redis', detail: 'Redis with a **Lua script** (atomic read-modify-write) or `INCR` + `EXPIRE` for fixed windows. Keys are sharded across a Redis Cluster; TTLs garbage-collect idle keys.' },
      { id: 'decision', name: 'Decision', role: 'Allow, or reject with 429', detail: 'Allow and forward, or return `429 Too Many Requests` with `Retry-After` and `X-RateLimit-Limit/Remaining/Reset` (or the IETF `RateLimit` header) so well-behaved clients back off.' },
    ],
    flow: [
      { part: 'key', title: 'Key built', text: 'Request from API key `sk_live_42` to `POST /charges` → key `rl:sk_live_42:charges`.' },
      { part: 'rules', title: 'Limit found', text: 'Rule: **100 req/s, burst 100** as a token bucket — capacity 100, refill 100 tokens per second.' },
      { part: 'local', title: 'Local pre-check', text: 'The node’s local bucket still has budget, so obviously-OK traffic is not blocked by the network. A key already hard-blocked locally is rejected here without touching Redis.' },
      { part: 'store', title: 'Atomic refill + take', text: 'Lua script in Redis: read `tokens, last_ts`, add `(now − last_ts) × rate` capped at capacity, subtract 1 if ≥1, write back, set TTL — one round trip, ~0.3 ms, no race between nodes.' },
      { part: 'decision', title: 'Allowed', text: 'Tokens left: 37. Response carries `RateLimit-Remaining: 37` and the request continues to the service.' },
      { part: 'decision', title: 'Burst exhausted → 429', text: 'A retry loop drains the bucket to 0. Next call gets `429` with `Retry-After: 1` in ~1 ms, costing the backend nothing.' },
    ],
    knobs: [
      {
        name: 'Algorithm',
        options: [
          { label: 'Token bucket', effect: 'Allows bursts up to capacity, then a steady rate. Two numbers per key (tokens, timestamp); O(1).', when: 'Default for APIs (Stripe, AWS, NGINX-like burst).' },
          { label: 'Leaky bucket (queue)', effect: 'Smooths output to a constant rate by queuing; adds latency, drops when the queue is full.', when: 'Protecting a fixed-throughput downstream (e.g. SMS provider).' },
          { label: 'Fixed window counter', effect: '`INCR` per minute bucket; simplest, but allows 2× the limit across a window boundary.', when: 'Coarse quotas (per day), when boundary bursts don’t matter.' },
          { label: 'Sliding window log / counter', effect: 'Log: exact, stores every timestamp (memory-heavy). Counter: weights previous + current window — ~exact with 2 counters.', when: 'When boundary bursts are unacceptable; sliding counter is the usual compromise (Cloudflare).' },
        ],
      },
      {
        name: 'Where state lives',
        options: [
          { label: 'Local only', effect: 'Zero latency, no dependency; limit is per node and drifts as nodes scale (N nodes ⇒ up to N× limit).', when: 'DDoS/abuse shields, coarse per-node protection.' },
          { label: 'Central (Redis)', effect: 'Exact global limit; +~0.5 ms and a dependency on every request.', when: 'Billing-grade quotas, paid tiers.' },
          { label: 'Hybrid', effect: 'Local buckets sync deltas to Redis every ~100 ms or lease batches of tokens; near-exact with almost no per-request hops.', when: 'High-QPS gateways at scale.' },
        ],
      },
      {
        name: 'On store failure',
        options: [
          { label: 'Fail open', effect: 'Allow traffic if Redis is down; availability preserved, temporarily unlimited.', when: 'Most product APIs, with local limits as a backstop.' },
          { label: 'Fail closed', effect: 'Reject when unsure; protects downstream but turns a Redis blip into an outage.', when: 'Expensive or abuse-prone operations (login, SMS).' },
        ],
      },
    ],
    implementations: [
      { name: 'Redis + Lua', how: 'A script implementing token bucket / GCRA executed atomically by Redis’ single-threaded engine; `redis-cell` provides `CL.THROTTLE` as a module. Key per client with TTL ≈ window.' },
      { name: 'Envoy global rate limit service', how: 'Envoy filter calls a gRPC `ratelimit` service (Lyft, Go) backed by Redis with descriptors like `(api_key, route)`; local token-bucket filter as a first line.' },
      { name: 'NGINX `limit_req`', how: 'Leaky bucket in a shared-memory zone keyed by `$binary_remote_addr`; `burst` + `nodelay` give token-bucket-like behaviour. Per instance only.' },
      { name: 'Stripe / GitHub', how: 'Stripe layers a request-rate token bucket, a concurrency limiter and load-shedders that drop low-priority traffic first. GitHub exposes 5,000 req/h per token with `x-ratelimit-*` headers and secondary limits for abuse.' },
    ],
    ha: 'The limiter must never be the reason the API is down: keep it in the request path only as a fast check, shard counters across a Redis Cluster (hash by key), replicate for failover, set a tight timeout (~5 ms) on the Redis call and **fail open** to local buckets. Losing a few seconds of counter accuracy on failover is acceptable.',
    failureModes: [
      { name: 'Race conditions', symptom: 'Two nodes `GET` count 99, both allow, limit exceeded under concurrency.', fix: 'Atomic `INCR` or a Lua script; never read-then-write from the app.' },
      { name: 'Hot key', symptom: 'One huge customer’s key hammers one Redis shard.', fix: 'Local pre-aggregation / token leasing for big keys, or split the key across sub-buckets.' },
      { name: 'Retry storms after 429', symptom: 'Clients retry immediately in a tight loop, multiplying traffic.', fix: 'Send `Retry-After`; SDKs use exponential backoff with jitter.' },
      { name: 'Wrong identity', symptom: 'Limiting by IP blocks a whole office/NAT or mobile carrier; trusting `X-Forwarded-For` lets attackers spoof.', fix: 'Limit by authenticated key/user; take client IP only from your trusted proxy hop.' },
    ],
    numbers: ['Redis: ~100k+ simple ops/s per shard, ~0.2–0.5 ms in-region round trip', 'Token bucket state: ~2 numbers per key (~50–100 B in Redis)', 'Fixed window worst case: 2× the limit at a boundary'],
    interview: [
      { q: 'Design a distributed rate limiter for 1M req/s across 100 gateway nodes.', a: 'Token bucket per API key. Each node keeps local buckets and leases batches of tokens (or syncs counts every ~100 ms) from a sharded Redis Cluster using atomic Lua scripts. Return 429 with Retry-After, fail open to local limits if Redis is slow, and send rate-limit headers so clients self-throttle.' },
      { q: 'Token bucket vs sliding window — which and why?', a: 'Token bucket allows controlled bursts and costs two numbers per key, ideal for APIs. A fixed window lets 2× through at boundaries; a sliding window log is exact but stores every timestamp. A sliding window counter approximates it with two counters and is what many CDNs use.' },
      { q: 'Where should rate limiting happen?', a: 'As early as possible and in layers: coarse IP limits at the edge/CDN to absorb abuse, per-key quotas at the gateway, and concurrency limits / load shedding inside critical services to protect themselves regardless of upstream config.' },
    ],
    lab: 'ratelimit',
  },

  // ───────────────────────────── WS GATEWAY ─────────────────────────────
  {
    kind: 'ws-gateway',
    summary:
      'A WebSocket gateway holds millions of long-lived TCP connections so the server can push events. It is a stateful edge: each box owns a set of sockets, a **connection registry** records which box holds which user, and a pub/sub backbone fans messages out to the right boxes. The engineering is about cheap idle connections, heartbeats, and surviving deploys.',
    parts: [
      { id: 'lb', name: 'L4 balancer', role: 'Spreads new connections across gateways', detail: 'An L4 LB (NLB, HAProxy TCP mode) using least-connections, with long idle timeouts (≥ heartbeat interval). Only the initial connect is balanced; after that the socket stays pinned.' },
      { id: 'upgrade', name: 'Handshake + auth', role: 'HTTP Upgrade, validates token', detail: '`GET /ws` with `Upgrade: websocket`; the gateway validates a token (JWT in query/cookie) **before** returning `101 Switching Protocols`, then the socket speaks WebSocket frames.' },
      { id: 'loop', name: 'Event loop', role: 'epoll over hundreds of thousands sockets', detail: 'A few threads each run `epoll` over their sockets; an idle connection is just a file descriptor plus a few KB of buffers. Written in Go, Elixir/Erlang, Rust, Java Netty or C++ for memory efficiency.' },
      { id: 'registry', name: 'Connection registry', role: 'Maps user → gateway node', detail: 'Redis (or a distributed KV) with `user:42 → gw-17` entries written on connect, removed on disconnect, with TTL refreshed by heartbeats so crashed nodes’ entries expire.' },
      { id: 'pubsub', name: 'Pub/sub fan-out', role: 'Routes events to owning gateways', detail: 'Backends publish to a channel (Redis Pub/Sub, NATS, Kafka) per user, room or gateway node; each gateway subscribes to the channels for the users it holds.' },
      { id: 'heartbeat', name: 'Heartbeats', role: 'Detects dead connections, keeps NAT open', detail: 'Ping/pong every 20–45 s; no pong within ~2 intervals ⇒ close the socket and clean the registry. Also keeps mobile NATs and LB idle timers from silently dropping the connection.' },
    ],
    flow: [
      { part: 'lb', title: 'Connection balanced once', text: 'The app opens `wss://ws.example.com`. The L4 LB picks `gw-17`, the gateway with the fewest open connections.' },
      { part: 'upgrade', title: 'Authenticated upgrade', text: 'JWT verified → `101 Switching Protocols`. Unauthenticated sockets are rejected before they consume a slot.' },
      { part: 'registry', title: 'Presence registered', text: '`SET user:42 gw-17 EX 90` and subscribe `gw-17` to `user:42`’s channel. The user is now reachable.' },
      { part: 'loop', title: 'Idle and cheap', text: 'The socket sits in `epoll` costing ~10–20 KB of memory and zero CPU until data arrives.' },
      { part: 'pubsub', title: 'Event pushed', text: 'The chat service publishes "new message for user 42"; only `gw-17` is subscribed, receives it and writes a frame to the socket in milliseconds.' },
      { part: 'heartbeat', title: 'Liveness maintained', text: 'Every 30 s a ping/pong refreshes the registry TTL. When the phone goes into a tunnel, pongs stop, the socket is closed and the client reconnects (with backoff + jitter) later.' },
    ],
    knobs: [
      {
        name: 'Fan-out routing',
        options: [
          { label: 'Broadcast to all gateways', effect: 'Every gateway receives every message and drops what it doesn’t own; simple, O(gateways) waste.', when: 'Few gateways, low message volume.' },
          { label: 'Registry lookup + targeted publish', effect: 'Look up the user’s gateway and publish only there; efficient but the registry is a hot dependency.', when: 'Large 1:1 messaging (WhatsApp-style).' },
          { label: 'Channel subscriptions', effect: 'Gateways subscribe to room/guild topics they have members in; scales to group fan-out.', when: 'Rooms/channels (Slack, Discord).' },
        ],
      },
      {
        name: 'Deploy strategy',
        options: [
          { label: 'Kill and let clients reconnect', effect: 'Simple, but a deploy causes a reconnect storm that can overload auth and the registry.', when: 'Small fleets.' },
          { label: 'Graceful drain', effect: 'Stop accepting, send a "reconnect" frame to clients in batches over minutes, then exit.', when: 'Any fleet with 100k+ connections.' },
        ],
      },
    ],
    implementations: [
      { name: 'Discord', how: 'Elixir/Erlang gateway: one lightweight BEAM process per session and per guild; guild processes fan messages to session processes across a distributed cluster. Millions of concurrent users per cluster.' },
      { name: 'Slack', how: 'Gateway servers hold client sockets and subscribe to channel servers (consistent-hashed by channel) for the channels their users are in; edge "Flannel" caches boot data near users.' },
      { name: 'WhatsApp', how: 'Erlang/FreeBSD boxes tuned to ~2M concurrent TCP connections each; messages routed by a user→connection mapping in-cluster.' },
      { name: 'Managed (AWS API GW WebSocket, Pusher, Ably)', how: 'Provider holds the sockets; your backend pushes via an HTTP API with a connection id. Easy, but per-message/per-minute pricing.' },
    ],
    ha: 'Assume any gateway can die: clients **auto-reconnect** with exponential backoff and jitter to any node, re-register, and fetch missed messages from durable storage using a cursor (the socket is a delivery hint, not the source of truth). Spread gateways across AZs, keep the registry replicated, and drain nodes gradually on deploy.',
    failureModes: [
      { name: 'Reconnect storm', symptom: 'A gateway dies or deploys; 500k clients reconnect in the same second and overwhelm auth/registry.', fix: 'Jittered backoff in clients, connection rate limits on accept, gradual drains.' },
      { name: 'Stale registry entries', symptom: 'Messages routed to a gateway that no longer holds the user → silently lost.', fix: 'TTL on entries refreshed by heartbeat; persist messages and let clients sync by cursor on reconnect.' },
      { name: 'Imbalance after scale-out', symptom: 'New gateways sit empty while old ones are full because connections are long-lived.', fix: 'Least-connections on connect plus periodic, randomised connection recycling.' },
      { name: 'Slow consumer', symptom: 'A client on a bad network can’t keep up; its outbound buffer grows until the gateway OOMs.', fix: 'Bounded per-connection send queues; drop or disconnect slow consumers.' },
    ],
    numbers: ['Idle WebSocket: ~10–50 KB RAM ⇒ ~1M conns needs ~16–64 GB', 'Tuned Linux box: 1–2M concurrent connections (raise `ulimit -n`, `somaxconn`, ephemeral ports)', 'Heartbeat 20–45 s; mobile NATs often drop idle flows after ~30 s–5 min'],
    interview: [
      { q: 'User A sends a message to user B who is connected to a different gateway. How does it get there?', a: 'A’s gateway forwards the message to the chat service, which persists it, then looks up B in the connection registry (`user:B → gw-9`) and publishes to gw-9’s channel (or B’s channel that gw-9 subscribes to). gw-9 writes it to B’s socket. If B is offline, the message waits in storage and a push notification is sent.' },
      { q: 'How do you deploy a new version of a gateway holding 1M connections?', a: 'Drain: remove the node from the LB, send clients a reconnect hint in batches over several minutes, let them reconnect elsewhere with jitter, then stop the process. Never kill all nodes at once, and make clients resume from a message cursor so nothing is lost.' },
      { q: 'How many connections can one box hold and what limits it?', a: 'Memory and file descriptors, not CPU, for idle sockets: at ~20 KB per connection, 1M needs ~20 GB. Raise fd limits and kernel buffers, use an event loop (not a thread per connection), and the real ceiling becomes message throughput and fan-out bandwidth.' },
    ],
  },

  // ───────────────────────────── APP ─────────────────────────────
  {
    kind: 'app',
    summary:
      'An app server is a process that turns requests into responses. Internally it is a concurrency model (thread pool or event loop), a middleware pipeline, your handler code, and pools of connections to state that lives elsewhere. Being **stateless** is what makes it horizontally scalable: any instance can serve any request, and instances can be killed at any time.',
    parts: [
      { id: 'server', name: 'HTTP server', role: 'Accepts and parses HTTP requests', detail: 'Embedded server (Tomcat/Netty, Gunicorn/Uvicorn, Node `http`, Go `net/http`) behind an LB. Keeps keep-alive connections from the LB and parses requests into objects.' },
      { id: 'concurrency', name: 'Worker model', role: 'Thread pool or event loop', detail: '**Thread-per-request** (Tomcat 200 threads, simple blocking code) or **event loop** (Node, Netty: few threads, non-blocking I/O). Go goroutines and Java virtual threads give blocking-style code at event-loop cost.' },
      { id: 'middleware', name: 'Middleware chain', role: 'Auth, logging, tracing, validation', detail: 'Ordered filters wrap every handler: request id, auth/session from a token or Redis, metrics, tracing, panic/exception recovery, CORS, body limits.' },
      { id: 'handler', name: 'Handler', role: 'Your business logic for the route', detail: 'Router dispatches to the controller; it validates input, calls domain code and dependencies with **timeouts**, and must not keep per-user state in memory between requests.' },
      { id: 'pools', name: 'Connection pools', role: 'Reused connections to DB, cache, services', detail: 'HikariCP / pgx / redis-py pools hold e.g. 10–20 warm DB connections per instance. Total = instances × pool size must stay below the DB’s `max_connections` (or use PgBouncer).' },
      { id: 'lifecycle', name: 'Lifecycle', role: 'Health probes and graceful shutdown', detail: 'Exposes `/livez` and `/readyz`; on `SIGTERM` it fails readiness, stops accepting, finishes in-flight requests (e.g. 30 s), closes pools and exits — what makes rolling deploys error-free.' },
    ],
    flow: [
      { part: 'server', title: 'Request parsed', text: '`GET /cart` arrives over a reused keep-alive connection from the LB and is parsed into a request object.' },
      { part: 'concurrency', title: 'Scheduled', text: 'A pool thread (or the event loop) picks it up. If all 200 threads are busy, requests queue — this queue is where latency hides under load.' },
      { part: 'middleware', title: 'Cross-cutting checks', text: 'Trace id attached, JWT validated, session read from Redis (not local memory), metrics timer started.' },
      { part: 'handler', title: 'Logic runs', text: 'Handler loads the cart: cache lookup first, DB on miss, each call with a deadline of a few hundred ms.' },
      { part: 'pools', title: 'Warm connection borrowed', text: 'A DB connection is borrowed from the pool, the query runs, the connection is returned. If the pool is exhausted the request waits up to `connectionTimeout` then fails fast.' },
      { part: 'lifecycle', title: 'Deploy without errors', text: 'During a rolling deploy this instance gets `SIGTERM`: `/readyz` goes red, the LB stops routing, in-flight `/cart` requests finish, then the process exits.' },
    ],
    knobs: [
      {
        name: 'Concurrency model',
        options: [
          { label: 'Thread pool (blocking)', effect: 'Simple code; each in-flight request holds a thread (~1 MB stack), so concurrency is capped by threads.', when: 'CPU-bound or moderate-concurrency CRUD (Spring MVC, Django).' },
          { label: 'Event loop (async)', effect: 'Thousands of concurrent I/O-bound requests on few threads; a single CPU-heavy or blocking call stalls everything.', when: 'I/O-heavy APIs, proxies, streaming (Node, Netty, asyncio).' },
          { label: 'Green threads (Go, Java 21 virtual threads)', effect: 'Blocking-style code with ~KB per task; the runtime multiplexes onto cores.', when: 'Most new high-concurrency services.' },
        ],
      },
      {
        name: 'Pool sizing',
        options: [
          { label: 'Small pool (~cores × 2)', effect: 'DB stays efficient; requests queue in the app instead of the DB.', when: 'Default (HikariCP advice); scale out instances instead.' },
          { label: 'Large pool', effect: 'More parallel queries but DB context-switching and `max_connections` exhaustion as you add instances.', when: 'Rarely; prefer a pooler like PgBouncer.' },
        ],
      },
    ],
    implementations: [
      { name: 'Java (Spring Boot on Tomcat/Netty)', how: 'Tomcat: acceptor + 200-thread worker pool by default; WebFlux/Netty: event loop per core. HikariCP for DB pooling; Actuator for health probes.' },
      { name: 'Node.js (Express/Fastify)', how: 'Single-threaded libuv event loop per process; run one process per core (cluster/PM2 or more pods). Never block the loop with CPU work.' },
      { name: 'Python (Gunicorn + Uvicorn)', how: 'Pre-fork model: a master forks N worker processes (GIL ⇒ processes for parallelism), each sync or async (ASGI).' },
      { name: 'Go `net/http`', how: 'One goroutine per connection, scheduled M:N onto OS threads by the runtime; `http.Server.Shutdown(ctx)` provides graceful drain.' },
    ],
    ha: 'Run N+2 stateless instances across AZs behind an LB with readiness checks; autoscale on CPU or in-flight requests. Externalise all state (sessions in Redis, files in S3, config in env vars — **12-factor**) so killing any instance loses nothing. Rolling or blue/green deploys rely on graceful shutdown.',
    failureModes: [
      { name: 'Local state', symptom: 'Users logged out or uploads missing when the LB sends them to another instance.', fix: 'Sessions in Redis/JWT, files in object storage; treat instances as disposable.' },
      { name: 'Pool exhaustion cascade', symptom: 'A slow DB query holds connections; all threads wait on the pool; health checks time out; everything restarts.', fix: 'Timeouts on every call, bulkheads per dependency, circuit breakers, load shedding.' },
      { name: 'Connection explosion on scale-out', symptom: 'Autoscaling to 200 pods × 20 conns = 4,000 → DB rejects connections.', fix: 'PgBouncer/RDS Proxy, smaller pools, cap autoscaling.' },
      { name: 'Blocked event loop', symptom: 'One JSON parse of a 50 MB body freezes all requests on a Node process.', fix: 'Body limits, offload CPU work to workers/queues.' },
    ],
    numbers: ['Typical stateless instance: ~1k–5k simple req/s', 'Thread ≈ 1 MB stack; goroutine/virtual thread ≈ 2–8 KB', 'Little’s law: concurrency = throughput × latency (1k req/s × 100 ms = 100 in flight)'],
    interview: [
      { q: 'What does "stateless" mean for an app server and why does it matter?', a: 'No request depends on memory or disk left by a previous request on that instance. All durable or shared state lives in the DB, cache or object store. Then any instance can serve any request, autoscaling and failover are trivial, and deploys can kill instances freely.' },
      { q: 'How do you size threads and DB connections?', a: 'Use Little’s law: in-flight = req/s × latency. Size the thread pool for that with headroom, but keep DB pools small (~2× cores of the DB divided across instances) because the database, not the app, is the bottleneck. Add a pooler when instance count grows.' },
      { q: 'How do you deploy without dropping requests?', a: 'Readiness probe + graceful shutdown: on SIGTERM fail readiness, wait for the LB to notice, finish in-flight requests, close pools, exit. Combined with rolling or blue/green deploys and backward-compatible schema changes.' },
    ],
  },

  // ───────────────────────────── SERVICE ─────────────────────────────
  {
    kind: 'service',
    summary:
      'A microservice is an independently deployable process that owns **one business capability and its own data**, exposed only through an API contract. Internally it looks like an app server, but around it sit discovery, a sidecar or client library for resilient network calls, and observability — because every dependency is now a network hop that can fail.',
    parts: [
      { id: 'contract', name: 'API contract', role: 'Versioned interface others depend on', detail: 'OpenAPI or Protobuf/gRPC schema, versioned and backward compatible (add fields, never repurpose). Consumer-driven contract tests catch breaking changes before deploy.' },
      { id: 'sidecar', name: 'Mesh sidecar', role: 'mTLS, retries, metrics for traffic', detail: 'Envoy (Istio/Linkerd proxy) next to the app intercepts inbound and outbound traffic: mTLS identity, load balancing, retries with budgets, timeouts, circuit breaking and golden metrics — no code changes.' },
      { id: 'logic', name: 'Service logic', role: 'Implements the bounded context', detail: 'Domain code for one capability (Orders, Payments). Validates input, enforces invariants, and calls other services only through their APIs or events.' },
      { id: 'own-db', name: 'Private database', role: 'Data only this service touches', detail: 'Its own schema/DB, chosen for its access pattern. No other service reads its tables; they ask the API or consume events, so the schema can change freely.' },
      { id: 'outbox', name: 'Outbox + events', role: 'Publishes state changes reliably', detail: 'The state change and an `outbox` row are written in one local transaction; a relay (Debezium/CDC or poller) publishes it to Kafka, avoiding dual-write inconsistency.' },
      { id: 'telemetry', name: 'Observability', role: 'Traces, metrics, logs per request', detail: 'OpenTelemetry spans propagated via `traceparent` headers, RED metrics (rate, errors, duration) and structured logs with the trace id, so one request can be followed across 20 services.' },
    ],
    flow: [
      { part: 'contract', title: 'Called via its contract', text: 'Checkout calls `orders.CreateOrder(cart_id, idempotency_key)` over gRPC — the only way in.' },
      { part: 'sidecar', title: 'Through the sidecar', text: 'Caller’s Envoy picks a healthy Orders pod, upgrades to mTLS, applies a 300 ms timeout; the callee’s Envoy checks the caller’s identity against policy.' },
      { part: 'logic', title: 'Business rules', text: 'Orders validates the cart, checks the idempotency key (a retried call returns the first result instead of a duplicate order).' },
      { part: 'own-db', title: 'Local transaction', text: 'Order row and an `OrderCreated` outbox row are committed atomically in Orders’ own Postgres.' },
      { part: 'outbox', title: 'Event published', text: 'CDC streams the outbox row to Kafka; Inventory and Email react asynchronously — no synchronous chain, no distributed transaction.' },
      { part: 'telemetry', title: 'Traced end to end', text: 'The span for `CreateOrder` (42 ms) is linked to Checkout’s span and the Kafka consumers’ spans in Jaeger/Tempo.' },
    ],
    knobs: [
      {
        name: 'Communication',
        options: [
          { label: 'Synchronous (REST/gRPC)', effect: 'Simple request/response; availability multiplies (5 deps at 99.9% ⇒ ~99.5%) and latency adds up.', when: 'Queries that need an answer now.' },
          { label: 'Asynchronous (events)', effect: 'Temporal decoupling, natural fan-out; eventual consistency and harder debugging.', when: 'Side effects of a state change (notify, index, update read models).' },
        ],
      },
      {
        name: 'Resilience location',
        options: [
          { label: 'Library (Resilience4j, Polly)', effect: 'Fine control in code; must be implemented per language.', when: 'Few languages, no mesh.' },
          { label: 'Service mesh sidecar', effect: 'Uniform mTLS/retries/metrics for every language; extra hop (~1 ms) and operational complexity.', when: 'Many services and languages (Istio, Linkerd).' },
        ],
      },
      {
        name: 'Granularity',
        options: [
          { label: 'Modular monolith', effect: 'One deployable, clear module boundaries, in-process calls, ACID.', when: 'Small teams, unclear domain — usually the right start.' },
          { label: 'Microservices', effect: 'Independent deploy and scale per team; network failures, eventual consistency, platform cost.', when: 'Many teams that block each other; well-understood boundaries.' },
        ],
      },
    ],
    implementations: [
      { name: 'Istio / Linkerd', how: 'Istio injects Envoy sidecars configured by `istiod` via xDS (or sidecar-less ambient mode); Linkerd uses a tiny Rust proxy. Both give mTLS, retries, traffic splitting and metrics.' },
      { name: 'gRPC + Protobuf', how: 'HTTP/2 multiplexed RPCs with generated clients, deadlines propagated across calls, and backward-compatible schema evolution by field numbers.' },
      { name: 'Amazon / Netflix', how: 'Amazon’s "two-pizza teams" own services end to end behind APIs (the Bezos mandate). Netflix built Eureka (discovery), Hystrix (circuit breakers) and Zuul before meshes existed.' },
    ],
    ha: 'Each service runs ≥3 replicas across AZs with its own autoscaling and DB replication. Isolation matters more than redundancy: timeouts, retry budgets, circuit breakers and bulkheads stop one failing dependency from cascading, and async events let downstream services be down without blocking writes.',
    failureModes: [
      { name: 'Distributed monolith', symptom: 'Services share a DB or must deploy together; every change needs 5 teams.', fix: 'Own your data, version contracts, split by business capability, or merge back.' },
      { name: 'Cascading failure', symptom: 'One slow service exhausts threads in every caller up the chain → site down.', fix: 'Deadlines everywhere, circuit breakers, bulkheads, fallbacks.' },
      { name: 'Retry amplification', symptom: '3 layers × 3 retries = 27× load on the deepest service during an incident.', fix: 'Retry only at one layer, retry budgets, jittered backoff, idempotency keys.' },
      { name: 'Dual write', symptom: 'DB commit succeeds, Kafka publish fails → other services never learn about the order.', fix: 'Transactional outbox / CDC.' },
    ],
    numbers: ['Each network hop: ~0.5–2 ms in-DC; sidecar adds ~1 ms', 'Serial availability: 0.999^10 ≈ 99.0%', 'Fan-out tail: 100 parallel calls with 1% slow ⇒ ~63% of requests hit a slow one'],
    interview: [
      { q: 'When should you split a monolith into microservices?', a: 'When organisational scaling hurts — teams blocking each other on deploys — and domain boundaries are understood. Start with a modular monolith, extract services along bounded contexts with their own data. Splitting earlier produces a distributed monolith with all the costs and none of the independence.' },
      { q: 'How do you keep data consistent across services without distributed transactions?', a: 'Each service commits locally and publishes events via a transactional outbox; others update their own state from those events. For multi-step business processes use a saga with compensating actions, and make every handler idempotent.' },
      { q: 'What does a service mesh actually do?', a: 'A sidecar proxy beside each service intercepts traffic and, configured by a control plane, provides mTLS identity, load balancing, retries/timeouts, circuit breaking, traffic splitting for canaries, and uniform metrics/traces — moving network resilience out of application code.' },
    ],
  },

  // ───────────────────────────── STICKY LB ─────────────────────────────
  {
    kind: 'sticky-lb',
    summary:
      'A sticky load balancer adds an **affinity table** to normal balancing: once a client is assigned a backend (by cookie, source IP or hash), every later request goes to that same backend. It exists to keep in-memory session state working — which is exactly why it is a trap: the state still lives on one server, so balancing, scaling and failover all suffer.',
    parts: [
      { id: 'listener', name: 'Listener', role: 'Accepts the client request', detail: 'Same event-loop proxy as any LB (HAProxy, NGINX, ALB). Must be L7 for cookie stickiness; L4 can only use the source IP.' },
      { id: 'identify', name: 'Client identifier', role: 'Reads cookie or source IP', detail: 'Looks for an affinity cookie (`AWSALB`, `SERVERID`, `JSESSIONID` route suffix) or uses the client IP / a hash of it. Behind NAT, thousands of users share one IP.' },
      { id: 'affinity', name: 'Affinity table', role: 'Maps client → pinned backend', detail: 'Either stored in the LB (HAProxy **stick table** with an expiry) or encoded in the cookie itself, so any LB node can decode the target server without shared state.' },
      { id: 'balancer', name: 'Balancer (first hit)', role: 'Assigns new clients a backend', detail: 'Only new or expired clients go through normal round-robin/least-conn. Everyone else bypasses balancing entirely — the main source of skew.' },
      { id: 'backend', name: 'Stateful backend', role: 'Holds the session in memory', detail: 'An app server (classic Java EE `HttpSession`, PHP file sessions) keeping the user’s session and cart in local RAM; losing it means losing the session.' },
    ],
    flow: [
      { part: 'listener', title: 'Request arrives', text: 'A returning user requests `/checkout`; the LB parses it at L7.' },
      { part: 'identify', title: 'Cookie found', text: 'The request carries `SERVERID=app3` set on a previous response.' },
      { part: 'affinity', title: 'Pinned target', text: 'Affinity says `app3` — the balancing algorithm is skipped, even though `app3` is at 95% CPU and `app1` is idle.' },
      { part: 'balancer', title: 'Only for newcomers', text: 'A first-time visitor has no cookie, so least-conn assigns `app1` and the LB sets `SERVERID=app1` on the response.' },
      { part: 'backend', title: 'Session in RAM', text: '`app3` reads the cart from its local `HttpSession`. If `app3` crashes now, that cart is gone and the user is logged out — the LB will pick a new server that knows nothing about them.' },
    ],
    knobs: [
      {
        name: 'Affinity method',
        options: [
          { label: 'LB-inserted cookie', effect: 'Precise per-browser pinning, survives IP changes; L7 only, broken for non-cookie clients.', when: 'Legacy web apps you can’t change yet.' },
          { label: 'Source-IP hash', effect: 'Works at L4 with no cookies; NAT and mobile networks put huge groups on one server or move users when their IP changes.', when: 'Non-HTTP protocols that need affinity.' },
          { label: 'Consistent hash on a key', effect: 'Affinity for **cache locality**, not correctness; only ~1/N of keys move when servers change.', when: 'Routing to shard-owning or cache-warm nodes — the legitimate use.' },
        ],
      },
      {
        name: 'Session storage (the real fix)',
        options: [
          { label: 'In server memory + sticky', effect: 'Fast, but state dies with the server and pins users.', when: 'Only as a temporary migration step.' },
          { label: 'External store (Redis) or JWT', effect: 'Any server can serve any request; plain round-robin works again.', when: 'Default for stateless app servers.' },
        ],
      },
    ],
    implementations: [
      { name: 'HAProxy', how: '`cookie SERVERID insert` or `stick-table type ip` + `stick on src`; stick tables can be synced between HAProxy peers so failover of the LB itself keeps affinity.' },
      { name: 'AWS ALB', how: 'Target-group stickiness with an LB-generated `AWSALB` cookie (duration-based) or an application cookie; NLB offers source-IP stickiness.' },
      { name: 'NGINX', how: 'Open source: `ip_hash` or `hash $cookie_x consistent`; NGINX Plus adds `sticky cookie`/`sticky route`.' },
      { name: 'Kubernetes', how: 'Service `sessionAffinity: ClientIP` (kube-proxy, IP-based with timeout) or ingress-nginx cookie annotations.' },
    ],
    ha: 'The LB can be made HA like any other (VRRP, synced stick tables), but **the sessions cannot**: affinity means each user’s state is on exactly one backend, so that backend is a per-user single point of failure. Replicating sessions between servers (Tomcat session replication) is chatty and doesn’t scale; externalising state is the real HA answer.',
    failureModes: [
      { name: 'Hot server', symptom: 'A big NAT’d office or heavy users stick to one backend at 100% CPU while others idle; the LB can’t rebalance.', fix: 'Remove affinity; store sessions externally and use least-conn.' },
      { name: 'Failover logs users out', symptom: 'One instance dies → its users lose carts and sessions.', fix: 'Sessions in Redis/DB or stateless JWTs.' },
      { name: 'Scale-out doesn’t help', symptom: 'New instances get only new users; existing load stays on old servers for the cookie lifetime.', fix: 'Stateless servers so new capacity is used immediately.' },
      { name: 'Deploys are slow', symptom: 'Draining a server must wait for all its sessions to expire (hours) or break them.', fix: 'External session store; short draining windows.' },
    ],
    numbers: ['NAT: one corporate IP can represent 1,000s of users', 'Redis session read: ~0.3 ms — the cost of removing stickiness'],
    interview: [
      { q: 'Your app logs users out whenever you deploy. Someone proposes sticky sessions. What do you say?', a: 'Stickiness hides the problem: sessions are still in server memory, so deploys, crashes and scale-in still destroy them, and load becomes uneven. Move session state to Redis (or use signed JWTs), make servers stateless, and plain round-robin/least-conn works with graceful drains.' },
      { q: 'Is affinity ever a good idea?', a: 'Yes, for performance rather than correctness: consistent hashing a key to a cache-warm or shard-owning node (e.g. routing a chat room to the node holding it). The system must still work correctly if the key moves — affinity as an optimisation, never as the only copy of state.' },
    ],
    lab: 'lb',
  },

  // ───────────────────────────── CLIENT POLLING ─────────────────────────────
  {
    kind: 'client-polling',
    summary:
      'Short polling is a client timer that asks "anything new?" every N seconds over plain HTTP. It is trivial to build and works everywhere, but it is a trap at scale: almost every poll returns nothing, yet each pays for a full request (TLS, auth, routing, a DB or cache read), and users still see data up to N seconds late. Push (long-poll, SSE, WebSocket) inverts this.',
    parts: [
      { id: 'timer', name: 'Client timer', role: 'Fires a request every interval', detail: '`setInterval(() => fetch("/updates?since=" + cursor), 1000)` in every open tab and app. Load is proportional to **connected clients ÷ interval**, not to how much actually changes.' },
      { id: 'request', name: 'HTTP request', role: 'Full request with headers and auth', detail: 'Each poll carries cookies/JWT and ~0.5–1 KB of headers, may need a new TCP/TLS connection, and traverses LB, gateway and auth like any request.' },
      { id: 'edge', name: 'LB + gateway', role: 'Routes, authenticates, rate limits', detail: 'Every poll costs LB, gateway and auth work and counts against rate limits; at 1 poll/s, 1M clients = 1M req/s of pure overhead.' },
      { id: 'handler', name: 'Update handler', role: 'Checks for changes since cursor', detail: 'Queries `WHERE updated_at > :since` or a cache key. Unless it is served from a cheap cache (`ETag` → `304`), every empty poll is a DB read.' },
      { id: 'response', name: 'Empty response', role: 'Usually 204/304, nothing new', detail: 'If 1 in 100 polls has data, 99% of the work is wasted, and the average delay to see an update is interval ÷ 2.' },
    ],
    flow: [
      { part: 'timer', title: 'Tick', text: 'The timer fires on 1M open clients; each sends `GET /updates?since=1714` regardless of whether anything changed.' },
      { part: 'request', title: 'Full HTTP cost', text: 'Headers, cookies and possibly a TLS handshake — for a question whose answer is almost always "no".' },
      { part: 'edge', title: 'Edge pays too', text: 'LB, gateway and JWT validation process ~1M req/s; capacity is now sized for polls, not users’ actual actions.' },
      { part: 'handler', title: 'Mostly empty reads', text: 'The handler checks the DB/cache: nothing new for 99% of clients.' },
      { part: 'response', title: 'Wasted work, still late', text: 'Returns `204 No Content`. When a message does arrive, the user waits on average 0.5 s (up to 1 s) for the next tick.' },
    ],
    knobs: [
      {
        name: 'Update mechanism',
        options: [
          { label: 'Short polling', effect: 'Simple, cacheable, stateless; load ∝ clients/interval, latency ≈ interval/2.', when: 'Rarely-changing data, few clients, or a job-status page polling every 5–30 s.' },
          { label: 'Long polling', effect: 'Server holds the request until data arrives or ~30 s timeout; near-instant delivery, ~1 request per event, but holds connections open.', when: 'Push needed where WebSockets are blocked; legacy fallback.' },
          { label: 'Server-Sent Events', effect: 'One long HTTP response streaming `text/event-stream`; server→client only, auto-reconnect with `Last-Event-ID`, works over HTTP/2.', when: 'Feeds, notifications, dashboards, LLM token streams.' },
          { label: 'WebSocket', effect: 'Full-duplex persistent connection; lowest latency, needs a stateful gateway and registry.', when: 'Chat, collaboration, games — bidirectional real-time.' },
        ],
      },
      {
        name: 'If you must poll',
        options: [
          { label: 'Fixed 1 s', effect: 'Maximum load, constant even when idle.', when: 'Avoid.' },
          { label: 'Adaptive + conditional', effect: 'Back off when idle (1 s → 30 s), use `ETag`/`If-None-Match` for cheap `304`s served from cache, add jitter.', when: 'Status/progress pages, low-scale integrations.' },
        ],
      },
    ],
    implementations: [
      { name: 'Facebook / Gmail (historical)', how: 'Early chat and mail used long polling (Comet) before WebSockets were universal; it was the scalable alternative to short polling.' },
      { name: 'GitHub notifications API', how: 'Supports polling but sends `X-Poll-Interval` and `Last-Modified`; conditional requests that return `304` don’t count against the rate limit — server-controlled polling.' },
      { name: 'Webhooks', how: 'For server-to-server integrations, the producer pushes HTTP callbacks (Stripe, GitHub) instead of consumers polling an events endpoint.' },
    ],
    ha: 'Polling endpoints are stateless, so they are easy to scale horizontally — the problem is the bill, not the design. If polling stays, serve it from a cache/CDN with `ETag`s, add jitter so clients don’t synchronise into a thundering herd after an outage, and let the server dictate the interval.',
    failureModes: [
      { name: 'Request amplification', symptom: '1M clients at 1 s = 1M req/s even when nothing happens; infra sized 10–100× too large.', fix: 'Push (SSE/WebSocket) or at least adaptive intervals and cache-served 304s.' },
      { name: 'Synchronised herd', symptom: 'After an outage all clients retry and poll in lockstep, creating periodic spikes.', fix: 'Random jitter on interval and on reconnect.' },
      { name: 'Staleness', symptom: 'Users see messages up to one interval late; shrinking the interval multiplies load.', fix: 'Push-based delivery; polling only as fallback.' },
    ],
    numbers: ['1M clients ÷ 1 s interval = 1M req/s; at 30 s it is ~33k req/s', 'Average latency to see an update ≈ interval ÷ 2', 'Typical poll ~1 KB headers ⇒ 1M req/s ≈ 1 GB/s of mostly empty traffic'],
    interview: [
      { q: 'Polling vs long polling vs SSE vs WebSocket — how do you choose?', a: 'Short polling for rare changes and small scale. Long polling when you need push but only have plain HTTP. SSE for one-way server→client streams (notifications, feeds) — simple, HTTP-native, auto-reconnect. WebSocket when the client also sends frequent messages in real time (chat, games, collaboration).' },
      { q: 'Estimate the load of a chat app where 10M online users poll every second.', a: '10M req/s just for polls — more than most companies’ total traffic — and ~99% return nothing. With WebSockets, load is proportional to actual messages, plus heartbeats every ~30 s (~330k tiny frames/s), at the cost of holding 10M connections (~10 gateways of 1M each).' },
    ],
  },

  // ───────────────────────────── BIG SERVER ─────────────────────────────
  {
    kind: 'big-server',
    summary:
      'Vertical scaling replaces a machine with a bigger one: more cores, RAM, memory bandwidth and faster disks, with zero code changes. Modern boxes are enormous (hundreds of cores, terabytes of RAM), so it is often the right first move — but it has a hard ceiling, a super-linear cost curve, NUMA effects that limit gains, and it is **still one machine** that can fail.',
    parts: [
      { id: 'nic', name: 'Network card', role: 'Brings packets in at line rate', detail: '25–100 Gbit/s NICs with multiple RX queues; RSS spreads flows across cores. One NIC is also a shared bottleneck for everything on the box.' },
      { id: 'cores', name: 'CPU cores', role: 'Run threads in parallel', detail: 'Up to ~192 cores per socket (AMD EPYC), 2 sockets per server. Gains stop at the **serial fraction** of the workload (Amdahl’s law) and at lock contention.' },
      { id: 'numa', name: 'NUMA nodes', role: 'Each socket owns local memory', detail: 'RAM is attached per socket; accessing the other socket’s memory crosses the interconnect (~1.5–2× latency). Unaware software (big JVM heaps, DBs) loses performance when threads migrate across nodes.' },
      { id: 'memory', name: 'RAM + bandwidth', role: 'Holds the working set', detail: 'Up to several TB of DDR5 (AWS `u-*` instances: 24 TB). Memory bandwidth (~400–900 GB/s per box) — not cores — often caps analytical workloads.' },
      { id: 'storage', name: 'Local NVMe', role: 'Fast persistent storage', detail: 'NVMe SSDs deliver ~1M IOPS each with ~100 µs latency; a box with 8 drives can serve a large OLTP database entirely locally.' },
    ],
    flow: [
      { part: 'nic', title: 'Traffic arrives', text: 'All 30k req/s land on one machine’s NIC; RSS hashes flows to different cores.' },
      { part: 'cores', title: 'More cores, more parallelism', text: 'Doubling from 32 to 64 cores helps until a global lock or single-threaded component (e.g. Redis’ main thread) becomes the limit.' },
      { part: 'numa', title: 'NUMA penalty', text: 'A thread on socket 0 reads a buffer allocated on socket 1 and pays ~2× memory latency; pinning processes per socket (`numactl`) fixes it.' },
      { part: 'memory', title: 'Working set fits in RAM', text: 'With 1 TB of RAM the whole database fits in the buffer cache — a big reason scale-up works so well for OLTP databases.' },
      { part: 'storage', title: 'Local NVMe for the rest', text: 'Misses hit local NVMe in ~100 µs. But when this box’s PSU fails, the whole service is down until failover to a standby.' },
    ],
    knobs: [
      {
        name: 'Scaling direction',
        options: [
          { label: 'Scale up (vertical)', effect: 'No code changes, no distributed-systems problems, strong consistency stays easy; hard ceiling, super-linear cost, downtime to resize, still a SPOF.', when: 'Early stage, primary databases, workloads hard to shard.' },
          { label: 'Scale out (horizontal)', effect: 'Near-linear capacity and redundancy from commodity boxes; needs statelessness, sharding and handling partial failure.', when: 'Stateless tiers always; data tiers once one box isn’t enough.' },
        ],
      },
      {
        name: 'Redundancy for the big box',
        options: [
          { label: 'None', effect: 'Every hardware failure or resize is an outage.', when: 'Never in production.' },
          { label: 'Hot standby replica', effect: 'Second identical box with replication and automated failover; doubles cost but keeps the simplicity.', when: 'Scaled-up databases (Stack Overflow’s SQL Server pair).' },
        ],
      },
    ],
    implementations: [
      { name: 'Stack Overflow', how: 'Famously served a top-50 site from a handful of large SQL Server and web boxes with huge RAM, plus redundant pairs — scale-up chosen deliberately, with a standby for failover.' },
      { name: 'Cloud high-memory instances', how: 'AWS `u7i`/`x2iedn`, Azure M-series: up to ~24–32 TB RAM and hundreds of vCPUs for SAP HANA and in-memory DBs; priced at a steep premium per GB.' },
      { name: 'Primary databases', how: 'Most Postgres/MySQL primaries scale up first (bigger instance class) and add read replicas before sharding, because the write path is hard to distribute.' },
    ],
    ha: 'A bigger server does nothing for availability — it concentrates risk. Pair it with a **hot standby** (synchronous or async replication, automated failover via Patroni/RDS Multi-AZ), and keep the stateless tiers scaled out across AZs. Resizing usually requires a restart, so plan it as a failover to an already-bigger replica.',
    failureModes: [
      { name: 'Hit the ceiling', symptom: 'Already on the largest instance; traffic keeps growing and there is no next size.', fix: 'Plan the scale-out path (read replicas, caching, sharding) before you need it.' },
      { name: 'Single point of failure', symptom: 'One hardware fault or kernel panic takes down the whole service.', fix: 'Hot standby with automated failover; redundancy across AZs.' },
      { name: 'Doesn’t scale linearly', symptom: '2× cores gives 1.3× throughput due to locks, NUMA traffic and a single-threaded component.', fix: 'Profile first; NUMA pinning, shard per core, or scale out.' },
      { name: 'Cost explosion', symptom: 'The top instance sizes cost far more per core/GB than mid sizes.', fix: 'Compare with N smaller nodes; reserve/commit for big boxes you keep.' },
    ],
    numbers: ['Largest common servers: ~2×192 cores, 6–24 TB RAM', 'Remote NUMA access ~1.5–2× local latency', 'NVMe: ~1M IOPS, ~100 µs; RAM: ~100 ns', 'Amdahl: 5% serial work ⇒ max 20× speed-up, however many cores'],
    interview: [
      { q: 'When is scaling up the right answer?', a: 'Early on and for components that are hard to distribute, especially the primary database: a bigger box with RAM to hold the working set avoids sharding complexity for a long time. It must be paired with a standby for failover, and you should know your next step before you reach the largest size.' },
      { q: 'Why doesn’t doubling the cores double throughput?', a: 'Amdahl’s law (the serial part doesn’t speed up), lock contention, single-threaded components, memory bandwidth limits and NUMA: threads touching memory on the other socket pay extra latency. Fixes are NUMA-aware placement, sharding work per core, or scaling out.' },
    ],
  },
];
