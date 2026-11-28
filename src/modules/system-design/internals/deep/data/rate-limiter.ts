import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'rate-limiter',

  // ───────────────────────────── 1. PROBLEM ─────────────────────────────
  problem: {
    why:
      'Every shared resource has finite capacity, and demand from thousands of independent clients is not coordinated. A rate limiter turns “whoever sends most wins” into an explicit **per-key contract**: a sustained rate plus a bounded burst, with the excess rejected cheaply (a `429` in ~1 ms) before it consumes expensive capacity such as DB connections, GPU seconds or SMS spend. It is both **protection** (availability for everyone) and **policy** (fairness between tenants, pricing tiers, abuse control).',
    withoutIt: [
      'One buggy client in a tight retry loop consumes the fleet and every other tenant sees timeouts (the noisy-neighbour outage).',
      'Credential stuffing and scraping run at line rate: 10k login attempts/s against `/login`, each one costing a bcrypt hash on your CPU.',
      'Unbounded calls to paid downstreams (SMS, card networks, LLM tokens) are billed to you, not to the abuser.',
      'Overload has no cheap rejection path: excess requests queue, latency rises past client timeouts, and the service does work nobody waits for.',
      'No basis for products: you cannot sell “Pro: 10× limits” or enforce a monthly plan without a per-key counter.',
    ],
    position:
      'In layers along the request path: coarse per-IP limits at the CDN/edge, per-API-key and per-tenant limits in the API gateway (often via a shared counter service), and concurrency limits or load shedding inside each critical service. On the hot path it talks to a fast counter store: process memory, Redis, or a dedicated rate-limit service.',
    diagram: {
      type: 'flow',
      title: 'Limits are layered, each with a different key',
      nodes: [
        { label: 'Client', sub: 'SDK honours Retry-After', tone: 'neutral' },
        { label: 'CDN / edge', sub: 'per IP, per PoP', tone: 'info' },
        { label: 'API gateway', sub: 'per key, tenant, route', tone: 'violet' },
        { label: 'Service', sub: 'concurrency limit, shedding', tone: 'accent' },
        { label: 'DB / paid API', sub: 'the thing being protected', tone: 'ok' },
      ],
      caption: 'Edge limits protect you from the internet, gateway limits protect tenants from each other, in-service limits protect the service from a wrong gateway config.',
    },
  },

  // ───────────────────────────── 2. ARCHITECTURE ─────────────────────────────
  architecture: {
    overview:
      'Every limiter is the same four things: an **identity function** (request → key and cost), a **policy table** (key class → rate, burst, window), a **state store** holding per-key counters with an atomic read-modify-write, and a **decision path** (allow/deny, headers, metrics). Production designs differ mainly in where state lives — in-process, shared Redis, or a dedicated rate-limit service — and in how much exactness they trade for latency and availability.',
    diagram: {
      type: 'layers',
      title: 'Anatomy of a distributed limiter',
      layers: [
        { name: 'Request path (data plane)', items: ['key + cost extraction', 'descriptor build', 'local bucket / deny cache', 'allow or 429 + headers'], tone: 'violet' },
        { name: 'Counter tier', items: ['Redis Cluster shards', 'Lua / GCRA atomic update', 'TTL garbage collection', 'hash tags per tenant'], tone: 'accent' },
        { name: 'Control plane', items: ['rule config (YAML/DB)', 'plan tier → limits', 'hot reload, versioned'], tone: 'info' },
        { name: 'Observability', items: ['allowed / limited per rule', 'near-limit ratio', 'store latency + errors', 'fail-open count'], tone: 'ok' },
      ],
      caption: 'The data plane must keep working with the last-known rules if the control plane is down, and must have a defined behaviour if the counter tier is down.',
    },
    blocks: [
      {
        name: 'Key / descriptor extractor',
        what: 'Builds a tuple such as `(tenant=acme, api_key=k_42, route=POST /charges)` plus a **cost** (1 for a cheap GET, 10 for a search, tokens for an LLM call). Client IP is taken from the rightmost **trusted** proxy hop in `X-Forwarded-For`, never the leftmost value the client controls.',
      },
      {
        name: 'Policy store',
        what: 'Rules map descriptors to `(rate, burst)` or `(unit, requests_per_unit)`. Several rules usually apply at once (per-second burst, per-minute tenant limit, per-day quota) and **all must pass**. Rules are cached in memory and hot-reloaded; a request never reads a database to find its limit.',
      },
      {
        name: 'Token bucket state',
        what: 'Two numbers per key: `tokens` and `last_refill_ts`. Refill is lazy on access — `tokens = min(b, tokens + r·(now − ts))` — so there is no timer per key and idle keys cost nothing but memory until their TTL expires.',
      },
      {
        name: 'GCRA state',
        what: 'The Generic Cell Rate Algorithm stores a single timestamp per key: the **theoretical arrival time** (TAT). It is mathematically equivalent to a token bucket (leaky bucket as a meter) but needs one integer and one compare, which is why `redis-cell` and many gateways use it.',
      },
      {
        name: 'Window counters',
        what: 'Fixed window: key `rl:{k}:{floor(now/W)}` with `INCR` + `EXPIRE`. Sliding-window counter: current and previous window counts, weighted. Sliding log: a sorted set of timestamps per key (exact, memory-heavy).',
      },
      {
        name: 'Atomic executor',
        what: 'A Redis Lua script (`EVALSHA`) or module command so the read-modify-write runs on the single-threaded shard without races. Multi-key scripts need all keys in one hash slot, e.g. `rl:{acme}:sec` and `rl:{acme}:day`.',
      },
      {
        name: 'Local deny cache',
        what: 'An in-process LRU of keys known to be over limit until their window resets. Abusive keys are rejected without a network hop, which is what keeps an attack from turning into a Redis overload (envoyproxy/ratelimit has this as an optional local cache).',
      },
      {
        name: 'Response encoder',
        what: '`429 Too Many Requests` with `Retry-After` and remaining-budget headers for contract violations; `503` with `Retry-After` for load shedding. The body names the limit that was hit so client developers can fix their code.',
      },
    ],
    real: [
      {
        name: 'Envoy + envoyproxy/ratelimit (Lyft)',
        how: 'The `envoy.filters.http.ratelimit` filter builds **descriptors** from route actions and calls the Go rate-limit service over gRPC (`ShouldRateLimit`). The service matches YAML rules per `domain` and keeps **fixed-window** counters in Redis (pipelined `INCRBY` + `EXPIRE`, key includes the window start). The filter’s default timeout is 20 ms and `failure_mode_deny: false` means fail open. A separate `local_ratelimit` filter gives a per-instance token bucket in front.',
      },
      {
        name: 'redis-cell (GCRA)',
        how: 'A Redis module exposing `CL.THROTTLE key max_burst count period [quantity]`. One atomic call returns limited (0/1), total limit, remaining, `retry_after` and `reset_after` seconds. State is a single TAT value per key, so memory is minimal and there is no INCR/EXPIRE race to get wrong.',
      },
      {
        name: 'NGINX limit_req',
        how: 'A leaky bucket per key in a shared-memory zone: `limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s`. `burst=20` queues excess requests, `nodelay` serves the burst immediately (token-bucket-like). A 1 MB zone holds about 16k IP states. Default rejection is `503` unless `limit_req_status 429` is set. State is per NGINX instance: N boxes admit N× the rate.',
      },
      {
        name: 'Cloudflare rate limiting',
        how: 'Rules are evaluated in every PoP and counters are kept **per data center**, not globally synchronised — anycast routes a given client to mostly one PoP, so local counting is good enough. Their 2017 design used a **sliding-window counter** over a per-PoP memcache and measured only 0.003% wrong decisions across 400M requests.',
      },
      {
        name: 'Stripe',
        how: 'Four layers described publicly: a Redis token-bucket **request-rate limiter** per user, a **concurrent-requests limiter** (caps in-flight requests, mainly for expensive endpoints), a **fleet-usage load shedder** that reserves capacity for critical requests, and a **worker-utilisation load shedder** that drops traffic by priority class when workers are saturated.',
      },
    ],
  },

  // ───────────────────────────── 3. LIFECYCLE ─────────────────────────────
  lifecycle: {
    summary:
      'One request through a gateway with a local bucket in front of a global Redis-backed limit. The limiter adds well under a millisecond when allowed, and a rejected request costs the backend nothing.',
    stages: [
      { stage: 'Resolve identity', what: 'API key or JWT already verified by the auth filter; tenant and plan tier read from the cached claims.', cost: 'Cached lookup, no I/O', ms: 0.02, part: 'key' },
      { stage: 'Build descriptors + match rules', what: 'Route actions produce `(tenant, route)` descriptors; in-memory rule trie returns per-second and per-day limits and the request cost.', cost: 'Hash/trie lookups', ms: 0.01, part: 'rules' },
      { stage: 'Local deny cache + local bucket', what: 'Keys already known to be over limit are rejected here; the per-instance token bucket absorbs floods without touching Redis.', cost: 'In-process map + lock-free counter', ms: 0.01, part: 'local' },
      { stage: 'gRPC to rate-limit service', what: 'Envoy sends `ShouldRateLimit` to a nearby RLS pod over a persistent HTTP/2 connection; deadline 20 ms.', cost: '1 in-AZ RTT', ms: 0.3, part: 'store' },
      { stage: 'Atomic counter update', what: 'RLS pipelines `INCRBY` + `EXPIRE` (or a Lua token-bucket script) to the Redis shard that owns the key’s slot.', cost: '1 Redis RTT + a few µs of script', ms: 0.4, part: 'store' },
      { stage: 'Decision + headers', what: 'OK → forward with `RateLimit` headers; OVER_LIMIT → local `429` with `Retry-After`, key inserted into the deny cache.', cost: 'Header encoding', ms: 0.01, part: 'decision' },
      { stage: 'Emit stats', what: 'Counters `ratelimit.ok`, `over_limit`, `error`, `failure_mode_allowed` incremented; flushed to the metrics sink asynchronously.', cost: 'Atomic increments', ms: 0.01, part: 'decision' },
    ],
  },

  // ───────────────────────────── 4. DEEP DIVES ─────────────────────────────
  deepDives: [
    {
      title: 'Token bucket and GCRA: the math behind “rate + burst”',
      hook: 'Two numbers define the traffic shape every downstream must survive.',
      body: [
        'A token bucket has capacity **b** and refill rate **r** tokens/s. A request of cost c is admitted if `tokens ≥ c`. Over **any** interval of length T the bucket admits at most `b + r·T` units: the long-run rate is r and the worst instantaneous burst is b. Picking b is the real product decision, because b is how much traffic can land on your backend in ~0 time.',
        'A **leaky bucket** has two readings. As a **queue** (NGINX `limit_req` without `nodelay`) it holds requests and releases them at exactly r/s, smoothing output at the cost of added latency. As a **meter** it is identical to a token bucket — and that is GCRA.',
        '**GCRA** keeps one timestamp, the theoretical arrival time TAT. With emission interval `T = 1/r` and burst tolerance `τ = (b − 1)·T`, a request at time t is allowed iff `TAT − t ≤ τ`; then `TAT = max(TAT, t) + T`. `Retry-After` falls out for free: `TAT − τ − t`.',
        'Implement both lazily inside Redis so the read-modify-write is atomic, and use the Redis server clock (`TIME`) rather than each gateway’s clock — skew between gateways otherwise mints or burns tokens.',
      ],
      diagram: {
        type: 'compare',
        title: 'Same contract, three implementations',
        columns: [
          { name: 'Token bucket', points: ['state: tokens + timestamp', 'admits b instantly, then r/s', 'cost-weighted requests easy', 'Stripe, AWS API GW'], tone: 'ok' },
          { name: 'Leaky bucket (queue)', points: ['state: FIFO of requests', 'output exactly r/s', 'adds queueing latency', 'NGINX limit_req, traffic shaping'], tone: 'info' },
          { name: 'GCRA', points: ['state: one TAT integer', '≡ token bucket as a meter', 'Retry-After from TAT', 'redis-cell, many gateways'], tone: 'violet' },
        ],
      },
      code: {
        lang: 'lua',
        caption: 'Atomic token bucket in Redis (EVALSHA). Clock from Redis, not the caller.',
        code: `-- KEYS[1] = bucket key; ARGV = rate (tokens/s), burst, cost
local r, b, cost = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)        -- ms
local s = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(s[1]) or b
local ts = tonumber(s[2]) or now
tokens = math.min(b, tokens + (now - ts) / 1000 * r)      -- lazy refill
local ok = tokens >= cost
if ok then tokens = tokens - cost end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(b / r * 1000) + 1000)
local retry_ms = 0
if not ok then retry_ms = math.ceil((cost - tokens) / r * 1000) end
return { ok and 1 or 0, math.floor(tokens), retry_ms }`,
      },
      insight:
        'Size the backend for the **sum of bursts that can align**, not the sum of rates. 1,000 tenants at r = 10/s with b = 100 is 10k/s steady but 100k requests in one instant after a shared trigger (a cron, a deploy, a recovered network).',
    },
    {
      title: 'Window algorithms: fixed, sliding log, sliding counter',
      hook: 'The cheapest algorithm lets 2× the limit through at a boundary.',
      body: [
        '**Fixed window** counts per aligned window: `INCR rl:k:1700000040`. A client can send L requests at 0:59.9 and L more at 1:00.0 — **2L in 200 ms** while never violating “L per minute”. Fine for daily quotas, wrong for protecting a backend.',
        '**Sliding log** stores every timestamp in a sorted set (`ZADD`, `ZREMRANGEBYSCORE` older than now − W, `ZCARD`). It is exact, but memory is O(limit) per key: a 1,000/hour limit is up to 1,000 entries × ~60–100 B once the set leaves listpack encoding ≈ 80 KB per key, i.e. ~80 GB for a million active keys.',
        '**Sliding-window counter** keeps two counters and assumes the previous window was uniform: `estimate = prev × (W − elapsed)/W + curr`. Example: W = 60 s, 15 s into the window, prev = 84, curr = 36 → `84 × 0.75 + 36 = 99`. Two integers per key, and in Cloudflare’s measurement wrong in about 0.003% of decisions.',
      ],
      table: {
        caption: 'Per-key cost and behaviour',
        columns: ['Algorithm', 'State per key', 'Boundary burst', 'Accuracy', 'Redis primitive'],
        rows: [
          ['Fixed window', '1 counter', 'up to 2×', 'exact per window', '`INCR` + `EXPIRE`'],
          ['Sliding log', 'O(limit) timestamps', 'none', 'exact', '`ZADD` / `ZREMRANGEBYSCORE` / `ZCARD`'],
          ['Sliding counter', '2 counters', '≈ none', 'approx. (uniformity)', '2× `GET` + `INCR` in Lua'],
          ['Token bucket', '2 numbers', 'exactly b by design', 'exact', 'Lua script'],
          ['GCRA', '1 timestamp', 'exactly b by design', 'exact', '`CL.THROTTLE` or Lua'],
        ],
      },
      insight:
        'The sliding counter errs in both directions — it can reject a client that was actually under the limit. That is acceptable for protection, never for billing: meter billable usage from durable logs and reconcile, do not invoice from a limiter.',
    },
    {
      title: 'Distributed counters: atomicity, sharding and the over-admission bound',
      hook: 'Exact, fast, available — a global limiter gets two of three.',
      body: [
        '**Central Redis.** Each decision is one atomic round trip. The classic bug is `INCR` then `EXPIRE` as two calls: if the process dies between them the key never expires and the client is blocked forever. Use a Lua script, `MULTI`/`EXEC`, or `SET k 0 EX 60 NX` followed by `INCR`. Keys shard by hash slot, so one huge tenant is one hot shard.',
        '**Local buckets + periodic sync.** Each of N nodes decides locally and pushes deltas every Δ (e.g. 100 ms). If every node may spend the full remaining budget R it last saw, the worst-case overshoot in one interval is `(N − 1)·R`; bounded more usefully as `Σ local admit rate × Δ`.',
        '**Token leasing.** A node takes chunks of c tokens from Redis and spends them locally. Over-admission is zero; the cost is up to `N·c` stranded tokens (under-admission) and skew when traffic is uneven. Use it only for hot keys.',
        'Hybrid schemes only save Redis ops when a key sees **many requests per node per interval**. With 1M req/s spread over 2M keys, most keys see one request per minute and syncing is pure overhead.',
      ],
      diagram: {
        type: 'compare',
        title: 'Where the counter lives',
        columns: [
          { name: 'Central (Redis/RLS)', points: ['exact, atomic', '+0.3–1 ms per request', 'store outage = policy decision', 'hot key = hot shard'], tone: 'info' },
          { name: 'Local + sync', points: ['~0 ms, no dependency', 'overshoot ≤ Σ rate × Δ', 'limit drifts with fleet size', 'needs many req per key'], tone: 'warn' },
          { name: 'Token lease', points: ['local fast path', 'no over-admission', 'stranded tokens N × c', 'best for hot keys'], tone: 'ok' },
        ],
      },
      code: {
        lang: 'bash',
        caption: 'Fixed window done safely without Lua (Redis 7 `EXPIRE ... NX`).',
        code: `# window key embeds the window start; atomic transaction
MULTI
INCRBY rl:{acme}:/v1/search:1732817400 1
EXPIRE rl:{acme}:/v1/search:1732817400 120 NX   # set TTL only once
EXEC
# -> 1) (integer) 37   2) (integer) 1
# allow iff 37 <= limit; TTL = 2 windows so late readers still see it`,
      },
      insight:
        'Choose the error you can afford. A limiter exists to protect capacity, so 5% over-admission for 100 ms is harmless; what is not harmless is a design where the limiter’s own dependency (Redis) becomes the most likely cause of a full outage.',
    },
    {
      title: 'Envoy global rate limiting: descriptors and the RLS',
      hook: 'Route actions turn a request into keys; a Go service turns keys into counters.',
      body: [
        'Each entry in a route’s `rate_limits` produces one **descriptor** (an ordered list of key/value pairs) per request. Envoy sends all of them in one `ShouldRateLimit` call; the request is limited if **any** descriptor is over limit. Response `OVER_LIMIT` becomes a `429` with `x-envoy-ratelimited`.',
        'In the service config a descriptor key with no `value` means “one counter per distinct value” (per tenant); a key with a value matches only that value (one route). Nested descriptors express “tenant-wide 100/s, and within it `/v1/search` at 10/s”.',
        'Envoy emits `cluster.<name>.ratelimit.ok`, `over_limit`, `error` and `failure_mode_allowed`. With the default `failure_mode_deny: false`, an RLS or Redis problem silently disables limiting — so `failure_mode_allowed` is the alert, not the 429 rate.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Global limit check in the request path',
        actors: ['Client', 'Envoy', 'RLS', 'Redis', 'Upstream'],
        messages: [
          { from: 'Client', to: 'Envoy', label: 'POST /v1/search' },
          { from: 'Envoy', to: 'RLS', label: 'ShouldRateLimit(descriptors)' },
          { from: 'RLS', to: 'Redis', label: 'INCRBY + EXPIRE (pipeline)' },
          { from: 'Redis', to: 'RLS', label: 'counts', dashed: true },
          { from: 'RLS', to: 'Envoy', label: 'OK / OVER_LIMIT', dashed: true },
          { from: 'Envoy', to: 'Upstream', label: 'forward if OK', tone: 'ok' },
          { from: 'Envoy', to: 'Client', label: '429 + Retry-After if over', tone: 'bad', dashed: true },
        ],
      },
      code: {
        lang: 'yaml',
        caption: 'Envoy route actions (top) and ratelimit service rules (bottom).',
        code: `# Envoy route: each entry yields one descriptor per request
rate_limits:
  - actions:                      # (tenant_id=<header>)
      - request_headers: { header_name: x-tenant-id, descriptor_key: tenant_id }
  - actions:                      # (tenant_id=<header>, path=<:path>)
      - request_headers: { header_name: x-tenant-id, descriptor_key: tenant_id }
      - request_headers: { header_name: ":path", descriptor_key: path }
---
# envoyproxy/ratelimit config
domain: public_api
descriptors:
  - key: tenant_id                # no value => one counter per tenant
    rate_limit: { unit: second, requests_per_unit: 100 }
    descriptors:
      - key: path
        value: /v1/search
        rate_limit: { unit: second, requests_per_unit: 10 }`,
      },
      insight:
        'The RLS is synchronous on every request, so its p99 is your gateway’s p99 floor. Run it in every zone next to the gateways, keep the 20 ms deadline tight, enable the local over-limit cache, and put a `local_ratelimit` token bucket in front as a backstop for when you fail open.',
    },
    {
      title: 'Where to enforce and what to key on',
      hook: 'The wrong key either blocks a whole university or lets an attacker walk around the limit.',
      body: [
        '**Edge/CDN**: per IP, IP prefix, ASN or bot score; cheap, absorbs floods before they cost you a TLS handshake. **Gateway**: per API key, user or tenant, per route, per plan tier — the contract layer. **Service**: concurrency limits and per-tenant fairness that hold even if the gateway config is wrong. **Datastore**: per-tenant query or IOPS quotas in multi-tenant databases.',
        'IP is a weak identity. Carrier-grade NAT and corporate proxies put thousands of users behind one IPv4; IPv6 users each get a /64, so limit by prefix not address. Take the client IP from the rightmost hop your own proxies appended — trusting the leftmost `X-Forwarded-For` lets attackers rotate it freely.',
        'Requests are not equal. Weight by cost: GitHub’s GraphQL API charges **points** per query based on the nodes requested, and LLM APIs limit tokens per minute alongside requests per minute. A token bucket with `cost = n` handles this naturally.',
      ],
      bullets: [
        'Anonymous endpoints (login, signup, password reset): per IP prefix + per target account, fail closed with a local fallback.',
        'Authenticated API: per API key and per tenant (a tenant with 500 keys must not get 500× the limit).',
        'Expensive routes (search, export, report): separate lower limit or a concurrency cap.',
        'Webhooks and partner integrations: per partner with a negotiated limit; they often egress from a single IP.',
      ],
      insight:
        'Key hierarchy matters more than algorithm: always pair a fine-grained key (API key) with its aggregate (tenant), otherwise the cheapest bypass is to mint more keys.',
    },
    {
      title: 'Response semantics, fail-open vs fail-closed, and client behaviour',
      hook: 'A 429 is an API contract: tell the client exactly when to come back.',
      body: [
        'Use `429 Too Many Requests` (RFC 6585) with `Retry-After` (seconds or HTTP-date, RFC 9110) for contract violations, and `503` + `Retry-After` for server-side load shedding. Advertise remaining budget: GitHub sends `x-ratelimit-limit`, `-remaining`, `-used`, `-reset`; the IETF `draft-ietf-httpapi-ratelimit-headers` standardises this (early drafts `RateLimit-Limit/Remaining/Reset`, later drafts structured `RateLimit` and `RateLimit-Policy` fields).',
        '**Fail open** when the counter store is unreachable: availability beats exact limits for most routes, as long as a local bucket bounds the damage. **Fail closed** only where an unlimited window is worse than an outage: login, OTP/SMS sending, money movement — and even there fall back to a conservative local limit rather than rejecting everything.',
        'Clients must honour `Retry-After`, back off exponentially with full jitter, and ideally rate-limit themselves (AWS SDKs keep a client-side retry quota). A reset timestamp shared by all clients causes a synchronized wave at that exact second; jitter it.',
      ],
      table: {
        caption: 'Choosing behaviour when the limiter cannot decide',
        columns: ['Route class', 'Store down', 'Why'],
        rows: [
          ['Read APIs, product traffic', 'fail open + local bucket', 'limiter must not be the outage'],
          ['Login / OTP / SMS', 'fail closed to local strict limit', 'abuse window costs money and accounts'],
          ['Paid quota (monthly)', 'fail open, reconcile later', 'meter from durable logs'],
          ['Internal batch callers', 'fail open', 'use queues/backpressure instead'],
        ],
      },
      insight:
        'Measure the limiter by its **false positives** too: alert when 429s are spread across many keys at once (a limiter or config bug) versus concentrated in a few keys (real abuse).',
    },
    {
      title: 'Adaptive concurrency limits and load shedding vs rate limiting',
      hook: 'Rate limits enforce a contract; they cannot know how much capacity you have right now.',
      body: [
        'By Little’s law, `in-flight = throughput × latency`. Static rate limits are set per client in advance, but real capacity moves with deploys, GC, noisy neighbours and slow dependencies. A **concurrency limiter** caps in-flight requests and rejects the rest immediately, which is what actually protects a server.',
        'Netflix’s **concurrency-limits** library borrows TCP congestion control: **Vegas** estimates queueing from `RTTnoLoad / RTTactual` and nudges the limit up or down; **Gradient2** multiplies the limit by the ratio of long-term to short-term RTT so rising latency shrinks the limit automatically.',
        '**CoDel** sheds based on queueing delay: if the minimum delay in a 100 ms interval stays above a 5 ms target, start dropping. Facebook runs request queues with CoDel plus adaptive LIFO so that, under overload, fresh requests are served first. **Priority shedding** (Google’s criticality levels, Netflix Zuul’s prioritized shedding, Stripe’s worker-utilisation shedder) drops the least important traffic first.',
      ],
      diagram: {
        type: 'compare',
        title: 'Three tools, three questions',
        columns: [
          { name: 'Rate limiter', points: ['is this client within contract?', 'per key, static limits', 'answer: 429 + Retry-After'], tone: 'violet' },
          { name: 'Concurrency limiter', points: ['can I take one more now?', 'per server, adaptive', 'answer: 503 immediately'], tone: 'accent' },
          { name: 'Load shedder', points: ['what should I drop first?', 'priority / criticality', 'answer: shed test, then GETs'], tone: 'warn' },
        ],
      },
      code: {
        lang: 'text',
        caption: 'Gradient-style adaptive limit (simplified from Netflix concurrency-limits).',
        code: `on each completed request (rtt):
  shortRtt = ewma_fast(rtt)              # recent latency
  longRtt  = ewma_slow(rtt)              # baseline latency
  gradient = clamp(0.5, 1.0, tolerance * longRtt / shortRtt)
  newLimit = limit * gradient + queueSize   # small headroom
  limit    = smoothing * newLimit + (1 - smoothing) * limit

on each new request:
  if inflight >= limit: reject now (503, no queueing)
  else: inflight++ and serve`,
      },
      insight:
        'You need both: a set of perfectly well-behaved tenants, each inside its rate limit, can still collectively overload you. Rate limits are for clients; concurrency limits and shedders are for you.',
    },
    {
      title: 'Quotas vs rate limits',
      hook: 'A per-second limit and a per-month quota look alike but need opposite designs.',
      body: [
        'A **rate limit** has a short horizon (seconds to minutes), protects capacity, tolerates approximation and can live in volatile memory. A **quota** has a long horizon (day, month), is part of a commercial plan, must survive restarts and failovers, and must be auditable when a customer disputes an overage.',
        'Quotas are usually built as **metering**: every request emits a usage event, an aggregator maintains durable per-tenant totals, and the gateway enforces from a cached “remaining” value refreshed every few seconds — soft enforcement with reconciliation. AWS API Gateway usage plans separate the two explicitly: a throttle (rate + burst, token bucket) and a quota (requests per day, week or month).',
      ],
      bullets: [
        'Do not store a monthly quota as a Redis key with a 30-day TTL: a failover or eviction resets a customer’s usage.',
        'Expose quota usage in a dashboard and headers; surprise hard cut-offs generate support tickets.',
        'Over-quota is often a billing event (overage) rather than a 429.',
      ],
      insight:
        'If finance will ever ask “how many calls did tenant X make in March”, the answer must come from durable logs, not from the limiter’s counters.',
    },
  ],

  // ───────────────────────────── 5. SCALING ─────────────────────────────
  scaling: {
    body: [
      'The **data plane** (gateway filters, RLS pods, Redis) scales horizontally: RLS is stateless, Redis Cluster shards keys by slot. The **control plane** (rule config, plan tiers) changes rarely; the data plane must keep enforcing last-known rules if it is down, and rule pushes must be versioned so a bad rule can be rolled back in seconds.',
      'Multi-region limits are a consistency choice. Most systems enforce **per region** with the global limit split by traffic share (Cloudflare goes further: per PoP). A truly global counter needs either a home region per tenant (all its traffic counted there) or async replication of per-region counters, where over-admission is bounded by `regions × rate × replication lag`.',
      'Hot keys are the main scaling limit: a 50k req/s tenant saturates one Redis shard. Lease tokens locally for the top keys or split a key into k sub-buckets each with b/k and r/k.',
    ],
    bullets: [
      'Redis latency budget: one RTT per decision; colocate counter shards in the gateway’s zone or accept cross-AZ ~1 ms.',
      'Rule changes propagate via xDS/runtime reload; during rollout different gateways may enforce different limits for a few seconds.',
      'Redis failover takes seconds; with async replication recently incremented counters can be lost — acceptable for rate limits, not for quotas.',
      'Never let the limiter tier autoscale slower than the gateway tier; an overloaded RLS that fails open is equivalent to no limiter.',
      'Per-node local limits must be recomputed as `L / N` when the fleet scales, or limits silently grow with autoscaling.',
      'Load-test the limiter with realistic key cardinality: 2M distinct keys behaves very differently from 10 keys in a benchmark.',
    ],
    diagram: {
      type: 'compare',
      title: 'Multi-region strategies',
      columns: [
        { name: 'Per-region split', points: ['L × share per region', 'no cross-region calls', 'wrong when traffic shifts'], tone: 'ok' },
        { name: 'Home region', points: ['tenant counted in one place', 'exact', 'cross-region RTT for remote traffic'], tone: 'info' },
        { name: 'Async global counters', points: ['local decide, replicate deltas', 'overshoot ≤ R × rate × lag', 'CRDT-style G-counters'], tone: 'warn' },
      ],
    },
  },

  // ───────────────────────────── 6. FAILURES ─────────────────────────────
  failures: [
    {
      name: 'Silent fail-open',
      symptom: 'Redis or the RLS is slow; every check times out and is allowed. An abusive tenant reaches the backend unthrottled.',
      detect: '`cluster.<name>.ratelimit.failure_mode_allowed` and `ratelimit.error` above zero; RLS p99 approaching the 20 ms filter timeout; Redis `instantaneous_ops_per_sec` flat while gateway RPS rises.',
      mitigate: 'Local token bucket backstop sized to `L / N`; page on failure-mode counts; scale RLS/Redis ahead of gateways.',
    },
    {
      name: 'Fail-closed outage',
      symptom: 'A 15-second Redis failover turns into 15 seconds of 429/503 for every customer.',
      detect: '429 rate spikes across **all** keys simultaneously (not concentrated in the top keys); correlated with Redis failover events or `master_link_status:down`.',
      mitigate: 'Fail open for most routes; fail closed only for abuse-sensitive routes, and even then to a local strict limit.',
    },
    {
      name: 'Hot key saturates a shard',
      symptom: 'One large tenant’s key drives a single Redis primary to 100% CPU; every other key on that shard gets slow.',
      detect: 'Per-shard `instantaneous_ops_per_sec` and CPU skew; `redis-cli --hotkeys` (LFU policy) or `MONITOR` sampling; latency on one slot range only.',
      mitigate: 'Token leasing or local pre-aggregation for top-N keys; split keys into sub-buckets; move the tenant to a dedicated shard.',
    },
    {
      name: 'Key without TTL blocks a client forever',
      symptom: 'A customer is rate-limited permanently after a deploy; their counter never resets.',
      detect: 'Sampled `TTL` on `rl:*` keys returning `-1`; memory growth in the limiter Redis; support tickets clustered on one key.',
      mitigate: 'Lua or `MULTI` with `EXPIRE ... NX`; never separate `INCR` and `EXPIRE` round trips; periodic audit job.',
    },
    {
      name: 'Wrong identity (NAT, spoofed XFF)',
      symptom: 'A whole office or mobile carrier gets 429s, while an attacker rotating `X-Forwarded-For` is never limited.',
      detect: '429s concentrated on a few IPs that carry many distinct user ids/user agents; distinct-key cardinality per authenticated user exploding.',
      mitigate: 'Key on authenticated identity; derive IP from trusted proxy hops only; limit IPv6 per /64.',
    },
    {
      name: 'Limits multiply with autoscaling',
      symptom: 'Local-only limits per node: the fleet scales 10 → 40 nodes during an event and the effective limit quadruples, overloading the protected DB.',
      detect: 'Downstream RPS from one tenant exceeds the configured global limit; ratio of admitted RPS to configured limit tracks node count.',
      mitigate: 'Global store or membership-aware `L / N`; protect the downstream with its own concurrency limit.',
    },
    {
      name: 'Synchronized reset waves',
      symptom: 'Fixed windows plus a shared reset time: request rate spikes every minute at :00, then 429s, then idle.',
      detect: 'Periodic sawtooth in request rate and 429s aligned to window boundaries.',
      mitigate: 'Token bucket/GCRA; per-key `Retry-After` with jitter; client SDKs with jittered backoff.',
    },
  ],

  warStories: [
    {
      title: 'Stripe: four limiters, not one',
      source: 'Stripe engineering blog, “Scaling your API with rate limiters” (2017)',
      what: 'Stripe described running a Redis token-bucket request-rate limiter per user, a concurrent-requests limiter, a fleet-usage load shedder that always reserves a share of capacity (their example: 20%) for critical requests such as charges, and a worker-utilisation shedder that sheds by priority (test-mode traffic first, then GETs, then POSTs, critical methods last). The request-rate limiter fires constantly; the shedders only during incidents.',
      lesson: 'Layer per-client limits with server-side shedding, and roll limiters out safely: dark-launch them, fail open if Redis breaks, and keep a kill switch per limiter.',
    },
    {
      title: 'The limiter that took the API down',
      source: 'Composite of common incidents',
      what: 'A team made its Redis-backed limiter fail closed “for safety”. A routine Redis primary failover took ~20 s; every API request during that window was rejected with 503, and clients retrying immediately prolonged the spike after Redis returned. The limiter, not any real overload, caused the only customer-visible outage that quarter.',
      lesson: 'The limiter’s availability must exceed the service’s. Fail open with a local backstop, and test the store-down path in game days.',
    },
    {
      title: 'One IP, ten thousand users',
      source: 'Composite of common incidents',
      what: 'An anonymous endpoint was limited per IP. A large customer moved its staff behind a single egress proxy and a mobile carrier rolled out CGNAT; both started receiving 429s. Meanwhile a scraper sent requests with random `X-Forwarded-For` values and the gateway trusted the leftmost entry, so it was never limited.',
      lesson: 'IP is a coarse, last-resort key. Use authenticated identity, trusted-hop IP extraction and IPv6 prefixes, and monitor distinct users per limited key.',
    },
  ],

  // ───────────────────────────── 7. NUMBERS ─────────────────────────────
  numbers: [
    { label: 'Redis shard throughput', value: '~100k–200k simple ops/s', note: 'single-threaded command execution; Lua scripts cost more, budget tens of thousands/s per shard' },
    { label: 'Redis RTT', value: '0.2–0.5 ms in-AZ', note: '~0.5–1 ms cross-AZ; this is the limiter’s per-request cost' },
    { label: 'Envoy ratelimit filter timeout', value: '20 ms default', note: '`failure_mode_deny: false` by default ⇒ fail open' },
    { label: 'Token bucket state', value: '2 numbers / key', note: '~100 B per key in Redis incl. key name and overhead' },
    { label: 'GCRA state', value: '1 timestamp / key', note: 'redis-cell `CL.THROTTLE`' },
    { label: 'Fixed window worst case', value: '2× limit', note: 'L at the end of one window + L at the start of the next' },
    { label: 'Sliding log memory', value: 'O(limit) per key', note: '1,000/h ⇒ ~80 KB per key' },
    { label: 'Sliding counter error', value: '~0.003%', note: 'Cloudflare, 400M requests (2017)' },
    { label: 'NGINX zone', value: '1 MB ≈ 16k IPs', note: '`$binary_remote_addr` states' },
    { label: 'GitHub REST limit', value: '5,000 req/h', note: 'per authenticated user; 60/h unauthenticated' },
    { label: 'AWS API Gateway default', value: '10,000 rps, 5,000 burst', note: 'per account per region, token bucket' },
    { label: 'CoDel defaults', value: '5 ms target / 100 ms interval', note: 'queueing-delay based shedding' },
  ],
  capacity: {
    question:
      'A public API peaks at 1M req/s across 200 gateway nodes with 2M active API keys, each limited by a token bucket. How big is the Redis tier, and what about the largest tenant at 50k req/s?',
    steps: [
      'Exact global path: 1 Lua call per request ⇒ 1M script calls/s. Assume a conservative ~40k script calls/s per shard at safe CPU ⇒ ~25 primaries (+25 replicas).',
      'Memory: 2M keys × ~120 B (hash with 2 fields, key name, TTL) ≈ 240 MB in total — memory is irrelevant; CPU/ops sizing is everything.',
      'Would local buckets + 100 ms sync help? Mean rate per key is 0.5 req/s, so almost no key sees 2 requests per node per interval; syncing would cost as many ops as it saves. Keep the exact path for the long tail.',
      'Hot key: 50k req/s on one key would need more than a whole shard. Lease tokens: each of 200 nodes leases 500 tokens at a time ⇒ ~100 lease calls/s instead of 50k, with at most 100k stranded tokens (2 s of that tenant’s rate).',
      'Latency: +0.3–0.5 ms p50, ~1–2 ms p99 per request; 20 ms deadline then fail open to a per-node bucket of `L / 200`.',
    ],
    answer:
      '~25 Redis primaries with replicas and a few hundred MB of state for the long tail, plus token leasing for the handful of hot tenants. Ops per second, not memory, sizes a rate limiter.',
  },

  // ───────────────────────────── 8. COMPARISON ─────────────────────────────
  comparison: {
    caption: 'Real rate-limiting options',
    columns: ['Product', 'Algorithm', 'State / scope', 'Global accuracy', 'Store failure', 'Best for'],
    rows: [
      ['Envoy + ratelimit RLS', 'Fixed window per descriptor (+ local token bucket filter)', 'Redis behind a gRPC service', 'Exact per window, global', 'Fail open by default (20 ms timeout)', 'Mesh / gateway with many tenants'],
      ['Redis + Lua / redis-cell', 'Token bucket or GCRA', 'Redis Cluster owned by the app', 'Exact, atomic per key', 'App decides; set tight timeouts', 'Custom per-key limits in app or gateway'],
      ['NGINX limit_req', 'Leaky bucket (burst queue, nodelay)', 'Shared memory per instance', 'Per instance only (N× drift)', 'No external dependency', 'Edge per-IP protection'],
      ['Cloudflare rules', 'Counting per period (sliding counter in 2017 design)', 'Per data center', 'Approximate, not global', 'Managed', 'L7 abuse / DDoS at the edge'],
      ['Kong rate-limiting', 'Fixed windows (Advanced: sliding)', '`local`, `cluster` (DB) or `redis` policy', 'Exact with redis, drift with local', '`fault_tolerant: true` ⇒ fail open', 'API products already on Kong'],
      ['AWS API GW usage plans', 'Token bucket throttle + quota', 'Managed, per API key / stage', 'Best effort (documented)', 'Managed', 'Serverless public APIs'],
    ],
  },
  whenNot: [
    'Protecting a service whose capacity varies (deploys, GC, slow dependencies): use adaptive concurrency limits and priority load shedding; static rate limits cannot track capacity.',
    'Internal batch or background workloads you control: use a queue with fixed consumer concurrency (backpressure) instead of 429-and-retry loops.',
    'Exact billing or monthly quotas: use durable metering with reconciliation; limiter counters are approximate and volatile.',
    'Volumetric L3/L4 DDoS: needs network-level scrubbing (anycast, SYN cookies); an L7 limiter sees the traffic too late.',
    'A low-volume internal service with a few trusted callers: a per-caller semaphore/bulkhead is simpler than a distributed limiter.',
  ],

  // ───────────────────────────── 9. INTERVIEW ─────────────────────────────
  interview: [
    {
      q: 'Design a distributed rate limiter for a public API: 1M req/s, per-API-key limits with plan tiers.',
      a: 'Enforce in the gateway with descriptors `(tenant, api_key, route)` and cost weights. Use a token bucket or GCRA executed atomically in a sharded Redis Cluster via Lua, one RTT per decision, with a local deny cache and a per-node local bucket as backstop. Rules live in a versioned config pushed to gateways. Return 429 with Retry-After and remaining-budget headers, fail open on store errors except abuse-sensitive routes, and lease tokens locally for hot keys.',
      followUps: ['How many Redis shards, and what dominates sizing?', 'What happens during a Redis failover?', 'How do you handle one tenant at 50k req/s?', 'How do rule changes roll out safely?'],
      seniorSignal: 'Sizes by ops/s not memory, separates the long tail from hot keys, and defines failure behaviour per route class before being asked.',
    },
    {
      q: 'Token bucket, sliding-window counter or GCRA — which would you choose and why?',
      a: 'For an API contract, token bucket or GCRA: two parameters with clear meaning (rate and burst), O(1) state, exact, and cost-weighted requests are trivial. GCRA is the same contract as a meter with one timestamp per key and gives Retry-After directly. Sliding-window counter is a good approximation when you already think in “N per window” and want no boundary burst, at the cost of rare wrong decisions. Fixed windows only for coarse daily quotas.',
      followUps: ['Derive the maximum admitted requests in T seconds.', 'Show the fixed-window 2× burst.', 'What is τ in GCRA in terms of burst?'],
      seniorSignal: 'States `b + r·T` and explains that burst, not rate, is what the backend must be sized for.',
    },
    {
      q: 'The limiter’s Redis is down. What does your system do?',
      a: 'It depends on the route class and must be decided up front. For most traffic fail open, bounded by a per-node local token bucket of roughly `L / N` so abuse is still capped. For login, OTP and money movement fail closed to a strict local limit rather than rejecting everything. Alert on fail-open counts, because silent fail-open looks like a healthy system with no 429s.',
      followUps: ['How do you notice you are failing open?', 'What if Redis is slow rather than down?', 'How do you test this path?'],
      seniorSignal: 'Treats the limiter’s own dependency as a top outage risk and designs degraded modes, not just the happy path.',
    },
    {
      q: 'A tenant’s global limit is 1,000 req/s and it is served from three active regions. How do you enforce it?',
      a: 'Options: split the limit by expected traffic share per region (simple, wrong when traffic shifts), route the tenant’s counting to a home region (exact, adds cross-region latency for remote traffic), or count locally and replicate per-region counters asynchronously (overshoot bounded by regions × rate × lag). Most systems choose per-region enforcement with periodic rebalancing, because a few percent of over-admission is harmless while a cross-region dependency on every request is not.',
      followUps: ['What is the overshoot with 500 ms replication lag?', 'What changes on a regional failover?', 'Is this different for a monthly quota?'],
      seniorSignal: 'Quantifies over-admission and chooses inexactness deliberately instead of reaching for global consensus.',
    },
    {
      q: 'When do you use rate limiting, concurrency limiting or load shedding?',
      a: 'Rate limits enforce a per-client contract and fairness; they are static and do not know current capacity. Concurrency limits protect a server by capping in-flight work, ideally adaptively from latency (Netflix concurrency-limits, Vegas/Gradient), rejecting immediately instead of queueing. Load shedding chooses what to drop by priority when capacity is short. A robust service has all three, because well-behaved tenants can still collectively overload it.',
      followUps: ['How does Little’s law relate concurrency to latency?', 'How would you prioritise traffic classes?', 'What does CoDel measure?'],
      seniorSignal: 'Separates contract enforcement from self-protection and knows adaptive limits exist.',
    },
    {
      q: 'How do you rate-limit an expensive GraphQL or LLM endpoint fairly?',
      a: 'Weight by cost, not by request: compute a static cost before execution (GitHub-style points from requested nodes, or estimated tokens) and charge it to a token bucket; reconcile with the actual cost afterwards. Combine with a per-tenant concurrency cap for long-running calls and a separate tokens-per-minute budget. Expose the cost and remaining budget in headers so clients can self-throttle.',
      followUps: ['What if the actual cost is only known after execution?', 'How do you stop a tenant from opening 500 parallel streams?', 'How do you key anonymous traffic?'],
      seniorSignal: 'Recognises request count is a poor proxy for cost and designs pre-charge plus reconciliation.',
    },
  ],

  takeaways: [
    'A token bucket admits at most `b + r·T` in any interval: size downstreams for aligned bursts, not average rates.',
    'Fixed windows allow 2× at boundaries; sliding counters approximate with two integers; GCRA is an exact token bucket in one timestamp.',
    'Make the read-modify-write atomic (Lua, `CL.THROTTLE`, `MULTI` + `EXPIRE NX`); never separate `INCR` and `EXPIRE` calls.',
    'Global exactness costs a network hop and a dependency; pick per route whether to fail open (with a local backstop) or closed.',
    'Key on authenticated identity and aggregate (key + tenant); IP is a weak, spoofable, NAT-shared key.',
    'Rate limits are a contract for clients; adaptive concurrency limits and priority shedding protect the server.',
    'Quotas and billing need durable metering, not limiter counters.',
  ],
};

export default deep;
