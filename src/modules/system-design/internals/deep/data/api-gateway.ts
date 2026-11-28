import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'api-gateway',

  // ───────────────────────────── 1. PROBLEM ─────────────────────────────
  problem: {
    why:
      'Once a product is split into dozens of services, every one of them needs TLS, authentication, quotas, routing, timeouts, tracing and protection from abusive clients. An API gateway is an **L7 reverse proxy with a programmable filter chain** that does those cross-cutting jobs once, at the north-south edge, so that services receive only authenticated, rate-checked, well-formed requests. It is also the place where the public API contract (paths, versions, keys) is decoupled from the internal topology.',
    withoutIt: [
      'Every service re-implements JWT validation, JWKS caching and key rotation — each with its own bugs and clock-skew handling.',
      'Quotas per API key or tenant are impossible to enforce consistently: each service sees only its own slice of a client’s traffic.',
      'Clients are coupled to internal topology: splitting `orders-svc` into two services breaks every mobile app in the field.',
      'Abusive or buggy clients reach the services directly; a retry loop from one tenant becomes everyone’s outage.',
      'No single place to terminate TLS, emit per-route RED metrics, start the trace and make the sampling decision.',
    ],
    position:
      'Behind the CDN/WAF and an L4 load balancer (NLB or anycast), in front of the service fleet. It talks to an identity provider (JWKS/introspection), a rate-limit store, an optional authorization service (OPA/ext_authz) and a control plane that pushes its configuration.',
    diagram: {
      type: 'flow',
      title: 'Where the gateway sits (north-south path)',
      nodes: [
        { label: 'Client', sub: 'browser, mobile, partner', tone: 'neutral' },
        { label: 'CDN / WAF', sub: 'cache, DDoS, bot rules', tone: 'info' },
        { label: 'L4 LB / anycast', sub: 'NLB, ECMP, no TLS', tone: 'neutral' },
        { label: 'API gateway', sub: 'TLS, authN, limits, route', tone: 'violet' },
        { label: 'Services', sub: 'orders, payments, users', tone: 'ok' },
      ],
      caption: 'East-west (service-to-service) traffic normally does NOT go back through the gateway; that is the mesh’s job.',
    },
  },

  // ───────────────────────────── 2. ARCHITECTURE ─────────────────────────────
  architecture: {
    overview:
      'Every serious gateway has the same skeleton, most explicitly visible in **Envoy**: a **listener** accepts connections, **listener filters** peek at the first bytes (SNI, ALPN, PROXY protocol) to pick a **filter chain**, the **HTTP connection manager** (HCM) decodes HTTP/1.1, HTTP/2 or HTTP/3 into streams, an ordered list of **HTTP filters** runs (auth, limits, CORS, Lua/Wasm), and the terminal **router** filter matches a route and hands the request to the **cluster manager**, which picks a host with a load balancer and borrows a connection from a **per-worker connection pool**. A separate **control plane** pushes all of this configuration over xDS; the data plane never reads a database on the hot path.',
    diagram: {
      type: 'flow',
      title: 'Envoy data path (one worker thread)',
      nodes: [
        { label: 'Listener :443', sub: 'accept, SO_REUSEPORT', tone: 'neutral' },
        { label: 'Listener filters', sub: 'tls_inspector reads SNI', tone: 'info' },
        { label: 'Network filters', sub: 'TLS + HTTP conn manager', tone: 'info' },
        { label: 'HTTP filters', sub: 'jwt, ratelimit, ext_authz', tone: 'violet' },
        { label: 'Router', sub: 'route match, retries', tone: 'accent' },
        { label: 'Cluster manager', sub: 'LB, outlier detection', tone: 'accent' },
        { label: 'Conn pool', sub: 'per worker, per host', tone: 'ok' },
        { label: 'Upstream hosts', sub: 'from EDS', tone: 'ok' },
      ],
      caption: 'Everything left of the router runs per request on the worker that owns the downstream connection; no locks are taken on this path.',
    },
    blocks: [
      {
        name: 'Listener + listener filters',
        what: 'A bound socket per port; with `SO_REUSEPORT` the kernel spreads new connections across workers. Listener filters such as `envoy.filters.listener.tls_inspector` peek the ClientHello (SNI, ALPN) without consuming it, so `filter_chain_match` can select a certificate and chain per hostname.',
      },
      {
        name: 'HTTP connection manager (codec)',
        what: 'The terminal network filter. It runs the HTTP/1.1, HTTP/2 (nghttp2/oghttp2) or HTTP/3 (QUICHE) codec, turns bytes into streams, enforces header/size limits, generates `x-request-id`, starts the tracing span and owns access logging.',
      },
      {
        name: 'HTTP filter chain',
        what: 'An ordered list of decoder/encoder filters (`jwt_authn`, `ext_authz`, `ratelimit`, `local_ratelimit`, `cors`, `lua`, `wasm`, `grpc_json_transcoder`, …). Each filter may continue, stop and resume later (async I/O), or **send a local reply** (401/429/403) which short-circuits everything after it.',
      },
      {
        name: 'Route table',
        what: 'Virtual hosts (by `:authority`) containing ordered routes matched by prefix/path/regex/headers/query; first match wins. A route carries per-route config: timeout, retry policy, weighted clusters, mirror policy, hash policy and filter overrides (`typed_per_filter_config`).',
      },
      {
        name: 'Cluster manager + load balancer',
        what: 'Owns clusters (logical upstream services) and their endpoints from EDS, health-check state, outlier detection and circuit-breaker counters. LB policies: round robin, least request (power-of-two-choices), ring hash, Maglev, random.',
      },
      {
        name: 'Per-worker connection pools',
        what: 'Each worker keeps its own pool per (cluster, host, protocol, priority). HTTP/1.1 pools hold one request per connection; HTTP/2 pools multiplex streams and open another connection when the peer’s `SETTINGS_MAX_CONCURRENT_STREAMS` is reached.',
      },
      {
        name: 'Main thread + TLS slots',
        what: 'The main thread runs xDS, the admin API, DNS and stats flushing. New config is built there as an immutable snapshot and posted to every worker’s **thread-local storage slot**; workers swap pointers between events, so the hot path is lock-free (RCU-style).',
      },
      {
        name: 'Control plane (xDS server)',
        what: 'Istiod, Envoy Gateway, Contour, Gloo or a custom go-control-plane server. Translates high-level objects (Gateway API `HTTPRoute`, CRDs) into LDS/RDS/CDS/EDS/SDS resources and streams them to proxies over gRPC.',
      },
    ],
    real: [
      {
        name: 'Envoy (Envoy Gateway, Istio ingress, Contour, Emissary)',
        how: 'C++ proxy, one main thread plus `--concurrency` worker threads (default = hardware threads), each a libevent loop owning its connections for life. Everything is configured via xDS, so routes, clusters, endpoints and certificates change without restart. Extensibility via C++ filters, Lua, Wasm, or out-of-process `ext_authz`/`ext_proc` gRPC calls.',
      },
      {
        name: 'Kong (NGINX + OpenResty)',
        how: 'NGINX master + worker processes with LuaJIT. Plugins hook OpenResty phases (`certificate`, `rewrite`, `access`, `header_filter`, `body_filter`, `log`) and run in descending `PRIORITY` (cors 2000 > jwt 1450 > key-auth 1250 > acl 950 > rate-limiting 910). Config comes from Postgres (nodes poll `db_update_frequency`, default 5 s, to invalidate their mlcache) or DB-less declarative YAML; hybrid mode separates control plane and data planes.',
      },
      {
        name: 'AWS API Gateway',
        how: 'Managed multi-tenant fleet. **REST APIs** offer usage plans and API keys, caching, request validation, WAF and edge-optimised endpoints (an AWS-managed CloudFront distribution); **HTTP APIs** are cheaper and lower-latency with native JWT authorizers but fewer features. Lambda authorizers return an IAM policy cached by token for a TTL (default 300 s, max 3600 s). Integration timeout 29 s by default; 10,000 rps steady / 5,000 burst per account per region.',
      },
      {
        name: 'Spring Cloud Gateway',
        how: 'Java on Spring WebFlux, Project Reactor and Netty event loops. A route = id + URI + **predicates** (Path, Host, Header, Weight) + **filters** (per-route `GatewayFilter` plus ordered `GlobalFilter`s). `RequestRateLimiter` with `RedisRateLimiter` runs a Lua token bucket (`replenishRate`, `burstCapacity`). Any blocking call in a filter stalls an event-loop thread and the whole node’s latency.',
      },
      {
        name: 'Apollo Router (GraphQL federation)',
        how: 'Rust gateway for a federated supergraph. It parses and validates the operation, builds a **query plan** (Fetch, Sequence, Parallel, Flatten nodes) across subgraphs, caches plans, batches entity lookups through `_entities`, and enforces operation limits (depth, aliases, root fields) and cost-based demand control.',
      },
    ],
  },

  // ───────────────────────────── 3. LIFECYCLE ─────────────────────────────
  lifecycle: {
    summary:
      'A well-tuned self-hosted gateway adds **~0.3–2 ms** at p50 on a warm connection. Almost all of that is the two network calls it might make (global rate limit, external authz); local work is measured in microseconds. The big outliers are new TLS connections, token introspection, cold JWKS caches and new upstream connections — and the upstream itself, whose latency the gateway multiplies through retries.',
    stages: [
      {
        stage: 'Accept + TLS',
        what: 'Kernel hands the connection to one worker (`SO_REUSEPORT`); TLS 1.3 handshake or session resumption; ALPN picks h2 or http/1.1.',
        cost: 'Keep-alive reuse ≈ 0. New TLS 1.3 = 1 RTT plus ~1 ms CPU for an RSA-2048 signature (ECDSA P-256 ~20× cheaper). Shown amortised.',
        ms: 1,
        part: 'listener',
      },
      {
        stage: 'Parse + route match',
        what: 'Codec decodes headers, enforces limits, adds `x-request-id`, starts the root span; virtual host and route are matched.',
        cost: 'Microseconds; regex routes and very large route tables cost more than prefix tries.',
        ms: 0.02,
        part: 'route',
      },
      {
        stage: 'Cheap rejections',
        what: 'CORS preflight answered locally, body/header size limits, coarse per-IP or per-node `local_ratelimit` token bucket.',
        cost: 'In-memory only, ~µs. Rejects junk before any crypto or network call.',
        ms: 0.01,
        part: 'limit',
      },
      {
        stage: 'AuthN (JWT)',
        what: 'Verify signature with the cached JWKS key selected by `kid`; check `exp`, `nbf`, `iss`, `aud`; copy claims to headers.',
        cost: 'RS256 verify ~20–50 µs; cold JWKS fetch ~10–100 ms once. Opaque-token introspection 1–5 ms per uncached call.',
        ms: 0.05,
        part: 'auth',
      },
      {
        stage: 'Global rate limit',
        what: 'Descriptors (tenant, route, user) sent to the rate-limit service, which increments Redis counters.',
        cost: 'One gRPC + Redis round trip in-AZ, ~0.5–1 ms. Local-only limits cost ~0.',
        ms: 0.7,
        part: 'limit',
      },
      {
        stage: 'AuthZ (ext_authz/OPA)',
        what: 'Optional policy call with method, path and claims; OPA sidecar evaluates Rego and returns allow/deny plus headers.',
        cost: 'Sidecar over localhost ~0.2–1 ms; remote authz service 1–3 ms. Often the most expensive filter.',
        ms: 0.6,
        part: 'auth',
      },
      {
        stage: 'Transform',
        what: 'Header and path rewrites, schema validation, REST↔gRPC transcoding, identity headers injected.',
        cost: 'Header ops ~µs; body transforms require buffering and JSON parsing, ~0.05–1 ms depending on size.',
        ms: 0.05,
        part: 'transform',
      },
      {
        stage: 'Upstream connect',
        what: 'Load balancer picks a host (least request, P2C); the worker borrows a pooled connection or opens one.',
        cost: 'Pooled ≈ 10 µs. New TCP + mTLS inside the DC ~0.5–2 ms — which is why pools and keep-alive matter.',
        ms: 0.05,
        part: 'upstream',
      },
      {
        stage: 'Upstream service',
        what: 'The service does the actual work under the route timeout and per-try timeout; retries may repeat this stage.',
        cost: 'Not gateway overhead, but the gateway decides how many times it is paid (retries, hedging).',
        ms: 25,
        part: 'upstream',
      },
      {
        stage: 'Response + access log',
        what: 'Encoder filters (CORS headers, response transforms, compression) run in reverse order; stats updated; access log entry buffered.',
        cost: 'Microseconds; logs are written asynchronously by a flush thread or streamed to a gRPC access-log service.',
        ms: 0.05,
        part: 'upstream',
      },
    ],
  },

  // ───────────────────────────── 4. DEEP DIVES ─────────────────────────────
  deepDives: [
    {
      title: 'Envoy anatomy: threads, TLS slots and per-worker pools',
      hook: 'Why a gateway with 32 workers opens 32× the upstream connections you expected — and why config updates never take a lock.',
      body: [
        'Envoy runs **one main thread and N worker threads**. A connection accepted by a worker stays on that worker for its whole life; all of its filters, timers and upstream requests run on that worker’s event loop, so there is no cross-thread handoff and almost no locking. The main thread does everything slow or shared: xDS, DNS, health-check coordination, admin and stats flushing.',
        'Config changes use **thread-local storage slots**: the main thread builds a new immutable snapshot (route table, cluster set) and posts it to every worker; each worker swaps its pointer between events. In-flight requests keep the old snapshot via reference counting. This is why route updates are cheap and safe to apply thousands of times a day.',
        'The cost of this design is **per-worker connection pools**. Each worker has its own pool per upstream host, so 20 gateway pods × 16 workers × 1 HTTP/2 connection = 320 connections to every backend pod. Circuit-breaker limits, however, are per cluster per Envoy process, not per worker.',
        'Observability is built in: per-cluster and per-route counters, histograms, and an access log with **response flags** (`UH` no healthy upstream, `UF` connect failure, `UO` overflow, `UT` timeout, `URX` retry limit, `RL` rate limited, `UAEX` ext_authz denied, `NR` no route) that tell you which component produced a 5xx.',
      ],
      diagram: {
        type: 'layers',
        title: 'Envoy threading model',
        layers: [
          { name: 'Main thread', items: ['xDS client', 'admin API', 'DNS, health checks', 'stats flush'], tone: 'violet' },
          { name: 'TLS slots', items: ['immutable config snapshot', 'posted to each worker', 'refcounted, RCU-style'], tone: 'info' },
          { name: 'Worker 1..N', items: ['own event loop', 'owns its connections', 'own conn pools', 'filter instances'], tone: 'accent' },
          { name: 'Flush threads', items: ['access log writes', 'async, buffered'], tone: 'neutral' },
        ],
        caption: 'Workers never share a hot-path data structure; shared state flows one way, from main thread to workers.',
      },
      code: {
        lang: 'yaml',
        caption: 'Listener skeleton (abridged): SNI picks the chain, HCM gets routes via ADS',
        code: `listeners:
- name: https_443
  address: {socket_address: {address: 0.0.0.0, port_value: 443}}
  listener_filters:
  - name: envoy.filters.listener.tls_inspector   # peek SNI + ALPN
  filter_chains:
  - filter_chain_match: {server_names: ["api.example.com"]}
    transport_socket:
      name: envoy.transport_sockets.tls           # cert delivered by SDS
    filters:
    - name: envoy.filters.network.http_connection_manager
      typed_config:
        stat_prefix: edge
        rds: {route_config_name: edge_routes, config_source: {ads: {}}}
        http_filters: [...]                       # ordered; router last`,
      },
      insight:
        'Per-worker pools mean upstream connection count scales with **gateway pods × workers × backend pods**. Large fleets hit backend `ulimit`, conntrack or HTTP/2 SETTINGS limits long before CPU. Set `--concurrency` to the container’s CPU limit (not the host’s core count) and watch `upstream_cx_active`.',
    },
    {
      title: 'Filter ordering: cheapest rejection first',
      hook: 'The order of the filter chain decides how much an attacker can make you spend per rejected request.',
      body: [
        'Each filter can send a local reply that stops the chain, so order filters by **cost of the check versus fraction of traffic it rejects**. The canonical order is: CORS preflight → coarse IP/connection limits → authN → per-identity rate limit → authZ → transform → router.',
        '**CORS preflight goes first** because browsers send `OPTIONS` preflights without the `Authorization` header; if JWT auth runs first, every preflight is a 401 and the browser blocks the real call (Envoy’s `jwt_authn` has `bypass_cors_preflight` for exactly this). Kong encodes the same idea with priorities: cors (2000) runs before jwt (1450).',
        '**Per-user rate limiting cannot run before authentication**: until the signature is verified, the `sub` claim is attacker-controlled. Keying a limit on an unverified token lets an attacker drain a victim’s quota or rotate fake identities to evade the limit. But some limiting must run **before** auth, keyed on what you do trust (source IP, connection, TLS fingerprint), to protect the auth step itself — especially introspection or ext_authz calls that cost milliseconds and network fan-out.',
        'Expensive filters (ext_authz, body buffering, schema validation, transcoding) go last so that they only see traffic that is authenticated and within quota.',
      ],
      diagram: {
        type: 'flow',
        title: 'Recommended HTTP filter order',
        nodes: [
          { label: 'CORS', sub: 'answer preflight, no auth', tone: 'info' },
          { label: 'Coarse limit', sub: 'per IP, local, µs', tone: 'warn' },
          { label: 'AuthN', sub: 'JWT verify ~50 µs', tone: 'violet' },
          { label: 'Per-user limit', sub: 'global RLS ~0.7 ms', tone: 'warn' },
          { label: 'AuthZ', sub: 'OPA / ext_authz', tone: 'violet' },
          { label: 'Transform', sub: 'rewrite, transcode', tone: 'neutral' },
          { label: 'Router', sub: 'must be last', tone: 'accent' },
        ],
        caption: 'Each box can short-circuit with a local reply (204/429/401/403); later boxes never see rejected traffic.',
      },
      code: {
        lang: 'yaml',
        caption: 'Envoy http_filters (typed_config omitted). Order in this list IS execution order on the request path.',
        code: `http_filters:
- name: envoy.filters.http.cors              # preflight answered here
- name: envoy.filters.http.local_ratelimit   # coarse token bucket, no I/O
- name: envoy.filters.http.jwt_authn         # local verify, JWKS cached
- name: envoy.filters.http.ratelimit         # global per-identity quota (gRPC RLS)
- name: envoy.filters.http.ext_authz         # OPA / authz service, most expensive
- name: envoy.filters.http.grpc_json_transcoder
- name: envoy.filters.http.router            # terminal filter, always last`,
      },
      insight:
        'Response (encoder) filters run in **reverse** order, and a local reply from filter X travels back only through the filters before X. So CORS must sit before `jwt_authn` and `ratelimit`, or a 401/429 reaches the browser without CORS headers and the app sees an opaque network error instead of your 429 and `Retry-After`.',
    },
    {
      title: 'Control plane: xDS, hot reload and config consistency',
      hook: 'Most large gateway outages are config pushes, not traffic. How config reaches the data plane decides your blast radius.',
      body: [
        'Envoy splits config into resource types: **LDS** (listeners), **RDS** (routes), **CDS** (clusters), **EDS** (endpoints), **SDS** (secrets/certs). Each can be a separate gRPC stream or multiplexed over one **ADS** stream, which lets the control plane enforce make-before-break ordering (CDS → EDS → LDS → RDS) so a route never points at a cluster the proxy has not received. In **state-of-the-world** mode every response carries the full set of a type; **delta/incremental** xDS sends only changes, which matters once you have 10k+ clusters or endpoints.',
        'Every response has a `version_info` and `nonce`. The proxy **ACKs** by echoing the new version, or **NACKs** by echoing the previous version plus `error_detail`, and keeps running the last good config. New clusters and listeners go through **warming** (waiting for EDS, initial health checks) before taking traffic. If the control plane dies, proxies keep serving with their last-known-good config; only changes stop.',
        'Without xDS, reloads are heavier. `nginx -s reload` makes the master parse the new config, fork new workers and tell old ones to finish in-flight requests and exit; long-lived WebSocket/gRPC streams keep old workers alive (memory doubles under frequent reloads), which is why ingress-nginx and Kong update upstreams dynamically in Lua instead. Envoy **hot restart** (binary upgrades) passes listen sockets to the new process over a Unix socket and shares stats via shared memory while the old process drains (`--drain-time-s`, default 600 s).',
        'Kong in **Postgres mode** caches entities per worker (mlcache: Lua VM → shared dict → DB) and each node polls a cluster-events table every `db_update_frequency` to invalidate; in **DB-less/hybrid mode** the whole declarative config is pushed to data planes and swapped atomically, so there is no database on the request path at all.',
      ],
      diagram: {
        type: 'sequence',
        title: 'xDS ACK / NACK with last-known-good',
        actors: ['Control plane', 'Envoy'],
        messages: [
          { from: 'Envoy', to: 'Control plane', label: 'subscribe RDS edge_routes' },
          { from: 'Control plane', to: 'Envoy', label: 'v41, nonce n-77', dashed: true },
          { from: 'Envoy', to: 'Control plane', label: 'ACK version 41', tone: 'ok' },
          { from: 'Control plane', to: 'Envoy', label: 'v42 (bad regex), n-78', dashed: true, tone: 'bad' },
          { from: 'Envoy', to: 'Control plane', label: 'NACK: version 41 + error', tone: 'warn' },
          { from: 'Control plane', to: 'Envoy', label: 'v43 fixed, n-79', dashed: true },
          { from: 'Envoy', to: 'Control plane', label: 'ACK version 43', tone: 'ok' },
        ],
        caption: 'A NACK only protects you from config the proxy can detect as invalid. Valid-but-wrong config (bad route weight, deny-all policy) is ACKed and served.',
      },
      table: {
        caption: 'How config changes reach the data plane',
        columns: ['Mechanism', 'What happens', 'Drops connections?', 'Typical use'],
        rows: [
          ['NGINX reload (SIGHUP)', 'New workers forked, old drain', 'No, but old workers linger', 'Static nginx, OpenResty'],
          ['Envoy hot restart', 'New process inherits sockets', 'No, drains over minutes', 'Binary upgrades'],
          ['xDS update', 'Snapshot swapped in TLS slots', 'No (listener drain only if listener changes)', 'Routes, clusters, endpoints, certs'],
          ['Kong DB-less / hybrid', 'Declarative config swapped atomically', 'No', 'Kubernetes, GitOps'],
        ],
      },
      insight:
        'xDS is **eventually consistent per proxy**: during a rollout, some proxies run v41 and some v43, and a request’s retry may land on a different version. Design route changes to be valid under version skew (add cluster before route, remove route before cluster) and gate pushes with canary proxies plus automatic rollback on 5xx-by-route.',
    },
    {
      title: 'Authentication and authorization at the edge',
      hook: 'Local JWT verification is ~50 µs; getting key rotation, clock skew and revocation right is the real work.',
      body: [
        'JWT validation steps: split and base64url-decode, **reject `alg: none` and any algorithm not on an allow-list** (prevents RS256→HS256 confusion), find the key by `kid` in the cached JWKS, verify the signature, then check `exp`/`nbf` with a small skew allowance (Envoy `clock_skew_seconds`, default 60), `iss`, `aud` and required scopes. RSA verification is cheap (~20–50 µs); ECDSA verify is somewhat slower but signing is far cheaper, which matters to the IdP, not the gateway.',
        '**Key rotation** relies on `kid`: the IdP publishes the new key in JWKS before signing with it, and keeps the old key until all tokens signed with it expire. A gateway that sees an unknown `kid` should trigger a rate-limited JWKS refresh rather than reject — otherwise a rotation causes a 401 wave until the cache TTL expires.',
        'The **revocation problem**: a self-contained JWT is valid until `exp`. Options are short lifetimes (5–15 min) with refresh tokens, a small deny-list of revoked `jti`/session ids pushed to gateways, or **token introspection** (RFC 7662) on sensitive routes — 1–5 ms per call, so cache active results for seconds, keyed by token hash, never beyond the token’s `exp`.',
        'For service and partner identities, **mTLS** authenticates the connection itself; SPIFFE IDs (`spiffe://prod.example.com/ns/payments/sa/api`) in the certificate SAN become the principal. Fine-grained decisions go to **ext_authz**: Envoy sends method, path, headers and the verified claims to OPA or an authz service. Note the defaults: `ext_authz` fails closed (`failure_mode_allow: false`) while the `ratelimit` filter fails open (`failure_mode_deny: false`).',
      ],
      diagram: {
        type: 'sequence',
        title: 'Key rotation without a 401 wave',
        actors: ['Client', 'Gateway', 'IdP JWKS', 'Service'],
        messages: [
          { from: 'IdP JWKS', to: 'Gateway', label: 'JWKS {k1, k2} (k2 pre-published)', dashed: true },
          { from: 'Client', to: 'Gateway', label: 'Bearer JWT kid=k2' },
          { from: 'Gateway', to: 'Service', label: 'k2 cached, verified: x-user-id', tone: 'ok' },
          { from: 'Client', to: 'Gateway', label: 'Bearer JWT kid=k3 (unknown)', tone: 'warn' },
          { from: 'Gateway', to: 'IdP JWKS', label: 'refresh JWKS (rate-limited)' },
          { from: 'IdP JWKS', to: 'Gateway', label: '{k2, k3}', dashed: true },
          { from: 'Gateway', to: 'Service', label: 'verified, forwarded', tone: 'ok' },
        ],
      },
      code: {
        lang: 'yaml',
        caption: 'Envoy jwt_authn provider (abridged)',
        code: `providers:
  idp:
    issuer: https://idp.example.com
    audiences: [api.example.com]
    remote_jwks:
      http_uri: {uri: https://idp.example.com/.well-known/jwks.json, cluster: idp, timeout: 1s}
      cache_duration: 600s
      async_fetch: {}               # fetch at startup, not on first request
    clock_skew_seconds: 60
    claim_to_headers:
    - {header_name: x-user-id, claim_name: sub}
rules:
- match: {prefix: /v1/}
  requires: {provider_name: idp}
bypass_cors_preflight: true`,
      },
      insight:
        'Strip any incoming `x-user-id`-style identity headers at the edge before setting them, or clients can forge identity for services that trust them. And on AWS, a cached Lambda authorizer policy scoped to one method ARN is reused for the same token on other routes — return a wildcard resource or the user gets random 403s.',
    },
    {
      title: 'Distributed rate limiting: local, global and hybrid',
      hook: 'A limit of 1,000 rps across 50 gateway pods is a distributed-counter problem, and the counter store becomes a dependency on every request.',
      body: [
        'Token bucket: each key has capacity **b** (burst) and refill rate **r**. On each request, `tokens = min(b, tokens + (now − last) × r)`; allow and decrement if `tokens ≥ cost`. Over any window T a client gets at most `b + r × T` requests — so r = 100/s, b = 200 allows 1,200 in a 10 s window, and a burst of 200 at t=0. State is two numbers per key.',
        '**Local** limits (Envoy `local_ratelimit`, NGINX `limit_req`) live in each proxy: zero latency, but the effective global limit is `limit × pods` and shifts with autoscaling. **Global** limits call a shared service: Envoy’s `ratelimit` filter sends **descriptors** such as `[(tenant, acme), (route, orders_write)]` to the RLS (envoyproxy/ratelimit), which matches them against nested rules and increments Redis counters. Note that reference implementation uses **fixed windows** per time unit, not token buckets, so clients can get up to 2× at window edges.',
        'Correctness needs an atomic read-modify-write: a Redis **Lua script** or `INCR` + `EXPIRE` pipelined, with keys sharded across Redis Cluster by hash tag. Decide failure behaviour explicitly: the Envoy filter **fails open** by default, which keeps the API up when Redis dies but removes protection exactly when you might be under attack.',
        'The production answer is usually **hybrid**: a generous local bucket per proxy (protects against floods with no I/O) plus a global quota for business limits (per plan, per day), optionally using local leases — each proxy takes a batch of tokens from the global store and spends them locally, trading a little precision for 10–100× fewer Redis calls.',
      ],
      code: {
        lang: 'lua',
        caption: 'Atomic token bucket as a Redis script (EVALSHA). One round trip, no race between gateway nodes.',
        code: `-- KEYS[1] = bucket key   ARGV = rate r (tok/s), burst b, now_ms, cost
local r, b = tonumber(ARGV[1]), tonumber(ARGV[2])
local now, cost = tonumber(ARGV[3]), tonumber(ARGV[4])
local s = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(s[1]) or b
local ts = tonumber(s[2]) or now
tokens = math.min(b, tokens + (now - ts) / 1000 * r)
local allowed = 0
if tokens >= cost then tokens = tokens - cost; allowed = 1 end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(b / r * 1000) * 2)
return {allowed, math.floor(tokens)}`,
      },
      table: {
        caption: 'Where each limit belongs',
        columns: ['Limit', 'Key', 'Where', 'Why'],
        rows: [
          ['Flood guard', 'source IP / conn', 'Local, before authN', 'Protects auth step, no I/O'],
          ['Plan quota', 'tenant or API key', 'Global, after authN', 'Business contract, must be shared'],
          ['Per-route cost', 'user + route', 'Global, after authN', 'Expensive endpoints (search, export)'],
          ['Backend protection', 'cluster', 'Circuit breaker / adaptive concurrency', 'Protects capacity, not fairness'],
        ],
      },
      insight:
        'Pass `now` from the gateway and node clock skew silently changes refill math; use Redis `TIME` inside the script or tolerate it. And **rate limits protect fairness, not capacity** — a backend that can handle 5k rps needs a concurrency limit or circuit breaker, because 1,000 tenants each within quota can still overload it.',
    },
    {
      title: 'Timeouts, retries, deadlines and idempotency',
      hook: 'Retries at every layer multiply: 3 attempts at each of 3 layers is 27 calls to the bottom service for one user click.',
      body: [
        'Timeouts must **shrink inward**: client 10 s > gateway route 3 s > service 2 s > DB 1 s; otherwise outer layers give up while inner ones keep working, and retries duplicate work that is still running. Envoy’s route `timeout` defaults to **15 s** and covers all retries; `per_try_timeout` bounds each attempt. For gRPC, propagate the deadline: clients send `grpc-timeout`, and Envoy honours it when `max_stream_duration.grpc_timeout_header_max` is set; services should pass the remaining budget downstream.',
        'Retry storms are multiplicative: if each of 3 layers makes up to 3 attempts, a failing leaf sees up to 3³ = 27× load exactly when it is weakest. Rules: retry at **one layer only** (usually the one closest to the failure or the edge), use exponential backoff with jitter, retry only idempotent requests or on errors that guarantee no processing (`connect-failure`, `refused-stream`), and cap retries with a **retry budget** — Envoy’s `retry_budget` limits active retries to a percentage of active requests (default 20%, min concurrency 3), so retries can never more than ~1.2× the load.',
        '**Hedging** sends a second attempt after a delay (Envoy `hedge_on_per_try_timeout`) without cancelling the first; it cuts tail latency but adds load, so hedge only idempotent reads, after roughly the p95, and inside a budget.',
        '**Idempotency keys** make POST retries safe: the client sends `Idempotency-Key`; the first request stores the key with a fingerprint of the parameters and the final response (Stripe keeps keys for 24 h); repeats replay the stored response, and the same key with different parameters is rejected. The gateway can require the header on unsafe methods, but storage belongs to the service that owns the side effect.',
      ],
      diagram: {
        type: 'flow',
        title: 'Retry amplification (3 attempts per layer)',
        nodes: [
          { label: '1 user request', tone: 'neutral' },
          { label: 'Gateway', sub: '3 attempts', tone: 'warn' },
          { label: 'Service A', sub: '3 × 3 = 9 calls', tone: 'warn' },
          { label: 'Service B', sub: '27 calls', tone: 'bad' },
          { label: 'DB overloaded', sub: 'never recovers', tone: 'bad' },
        ],
        caption: 'With a 20% retry budget at one layer, the same failure costs at most ~1.2× load.',
      },
      code: {
        lang: 'yaml',
        caption: 'Envoy route retry policy for an idempotent route, plus a cluster retry budget',
        code: `route:
  cluster: orders
  timeout: 2s                      # whole request incl. retries (default 15s)
  retry_policy:
    retry_on: "connect-failure,refused-stream,gateway-error"
    num_retries: 2
    per_try_timeout: 0.6s
    retry_back_off: {base_interval: 0.025s, max_interval: 0.25s}
    retry_host_predicate:
    - name: envoy.retry_host_predicates.previous_hosts   # try a different host
    host_selection_retry_max_attempts: 3
# on the cluster:
circuit_breakers:
  thresholds:
  - retry_budget: {budget_percent: {value: 20.0}, min_retry_concurrency: 3}`,
      },
      insight:
        '`gateway-error` includes 504: retrying a timed-out non-idempotent POST can charge a card twice. A timeout means "unknown outcome", not "failed" — only idempotency keys make it safe to retry.',
    },
    {
      title: 'Circuit breaking, outlier detection and traffic shifting',
      hook: 'Envoy’s "circuit breaker" is a concurrency limit, not a Hystrix state machine — and outlier detection is the part that ejects bad hosts.',
      body: [
        'Envoy circuit breakers are **per-cluster resource caps**: `max_connections`, `max_pending_requests`, `max_requests` and `max_retries`, each defaulting to 1024/1024/1024/3. When a cap is hit, the request fails immediately with 503 and response flag `UO` instead of queueing. Default 1024 is often too low for a busy gateway (spurious 503s) and too high for a fragile backend — size them from Little’s law: concurrency ≈ rps × latency.',
        '**Outlier detection** ejects individual hosts: by default after 5 `consecutive_5xx` (also `consecutive_gateway_failure`, success-rate and failure-percentage detectors), for `base_ejection_time` 30 s × number of previous ejections, with at most `max_ejection_percent` 10% of hosts ejected. Separately, if fewer than `healthy_panic_threshold` (50%) of hosts are healthy, Envoy enters **panic mode** and balances across all hosts, healthy or not, to avoid overloading the survivors.',
        'Traffic management is route config: **weighted clusters** for canaries (95/5), **header matching** for internal testers (`x-canary: 1`), **request mirroring** to shadow a new version with production traffic (fire-and-forget; responses discarded; host gets a `-shadow` suffix), and **hash policies** with ring-hash or Maglev load balancing for stickiness by user or session.',
      ],
      table: {
        caption: 'Envoy cluster protections',
        columns: ['Mechanism', 'Default', 'On trigger', 'Stat to alert on'],
        rows: [
          ['max_connections', '1024', 'no new conn, request queues or fails', 'upstream_cx_overflow'],
          ['max_pending_requests', '1024', '503 UO immediately', 'upstream_rq_pending_overflow'],
          ['max_requests', '1024', '503 UO immediately', 'upstream_rq_pending_overflow'],
          ['max_retries / retry_budget', '3 / 20%', 'retry skipped', 'upstream_rq_retry_overflow'],
          ['outlier consecutive_5xx', '5, 30 s, ≤10%', 'host ejected', 'outlier_detection.ejections_active'],
          ['healthy_panic_threshold', '50%', 'LB ignores health', 'lb_healthy_panic'],
        ],
      },
      code: {
        lang: 'yaml',
        caption: 'Header-routed testers, 5% weighted canary, 10% shadow traffic',
        code: `routes:
- match:
    prefix: /v1/orders
    headers: [{name: x-canary, string_match: {exact: "1"}}]
  route: {cluster: orders-v2}
- match: {prefix: /v1/orders}
  route:
    weighted_clusters:
      clusters:
      - {name: orders-v1, weight: 95}
      - {name: orders-v2, weight: 5}
    request_mirror_policies:
    - cluster: orders-shadow
      runtime_fraction: {default_value: {numerator: 10, denominator: HUNDRED}}`,
      },
      insight:
        'A weighted split is decided **per request**, so one user flips between v1 and v2 across page loads; if the versions differ in behaviour, pin users (cookie or header set once, then header-match). And mirror only idempotent traffic, or point the shadow at a sandbox — shadowed POSTs really execute.',
    },
    {
      title: 'Protocols and API shaping: HTTP/2, gRPC, HTTP/3, BFF, GraphQL',
      hook: 'gRPC behind an L4 load balancer pins every request from a client to one pod; the fix is per-request L7 balancing.',
      body: [
        'HTTP/2 multiplexes many streams on one long-lived connection. That removes HTTP-level head-of-line blocking but not TCP’s: one lost packet stalls every stream on the connection. Because a gRPC client opens one connection and keeps it for hours, an **L4 load balancer balances connections, not requests** — new pods get no traffic, and one hot client can saturate one pod. Fixes: an L7 proxy (Envoy) that balances each stream, client-side/xDS load balancing (proxyless gRPC), or forcing periodic reconnects with the server’s `MaxConnectionAge`.',
        '**HTTP/3 (QUIC)** runs over UDP with per-stream loss recovery, 1-RTT handshakes and 0-RTT resumption (replayable, so only for idempotent requests), and connection migration via connection IDs. The L4 tier in front must route by QUIC connection ID, not by 5-tuple, or migration breaks; most edges still speak HTTP/2 or HTTP/1.1 to upstreams.',
        '**Transcoding** (Envoy `grpc_json_transcoder`, using the proto descriptor and `google.api.http` annotations) exposes gRPC services as REST/JSON. **Request coalescing** collapses concurrent cache misses for the same key into one upstream call (NGINX `proxy_cache_lock`, Varnish by default). **Versioning** is easiest by path (`/v1`) at the gateway; Stripe-style dated versions pinned per account need response transformation that belongs in the service layer, not gateway plugins.',
        'For client-specific aggregation use a **BFF** (one backend per client experience, owned by that frontend team) or a **GraphQL federation router**: Apollo Router builds a query plan across subgraphs and batches entity fetches via `_entities`, which avoids cross-service N+1, while subgraphs still need DataLoader for their own N+1. Protect it with depth/alias limits, cost analysis and persisted (safelisted) operations.',
      ],
      diagram: {
        type: 'compare',
        title: 'Load balancing long-lived gRPC connections',
        columns: [
          { name: 'L4 LB (NLB)', points: ['balances TCP connections', 'one conn = all streams', 'new pods idle', 'hot-spotting'], tone: 'bad' },
          { name: 'L7 gateway / sidecar', points: ['balances each stream', 'least-request per call', 'extra hop ~0.3 ms', 'works for any client'], tone: 'ok' },
          { name: 'Client-side (xDS)', points: ['client picks per call', 'no extra hop', 'needs gRPC xDS support', 'harder to govern'], tone: 'info' },
        ],
      },
      insight:
        'The gateway is a natural place for **protocol** translation (HTTP/3 → HTTP/2, JSON → gRPC) but a terrible place for **business** composition; once a gateway plugin knows what an "order" is, every product change queues behind the platform team’s deploy.',
    },
  ],

  // ───────────────────────────── 5. SCALING ─────────────────────────────
  scaling: {
    body: [
      'The data plane is **stateless**: run N replicas across AZs behind an L4 NLB or anycast/ECMP, autoscale on CPU and active connections, and keep shared state (rate-limit counters, introspection cache) in external stores that the gateway can survive losing. Scale-out is linear until the shared dependencies (Redis, RLS, IdP) or upstream connection counts become the bottleneck.',
      'Separate **control-plane failure** from **data-plane failure**. If Istiod, Envoy Gateway or the Kong control plane dies, proxies keep serving last-known-good config; you lose deploys, endpoint updates and cert rotation, so stale EDS slowly routes to dead pods (outlier detection and health checks hide this for a while). If the data plane fails, the API is down — so the data plane must not depend on the control plane, a database, or a single Redis to serve requests.',
      'For **multi-region active-active**, each region runs its own gateway fleet and control plane, users are steered by GeoDNS or anycast, and global quotas become per-region quotas or asynchronously reconciled counters (a client can briefly exceed a global limit by the number of regions). Config is rolled out region by region, cell by cell, never globally at once.',
      'Contain blast radius with **separate gateways per domain or tenant tier** (public API, partner API, internal admin) and **cell-based** deployments where each cell has its own gateway, services and data; a bad route or plugin then takes down one cell, not the company.',
    ],
    bullets: [
      'Stateless data plane behind NLB/anycast; scale on CPU and `downstream_cx_active`, not only rps.',
      'Data plane keeps last-known-good config when the control plane is down; alert on xDS staleness (`control_plane.connected_state`, config version age).',
      'Roll config like code: validate → canary proxies → one AZ → one region → global, with automatic rollback on 5xx-by-route.',
      'Expect version skew during rollouts; make changes backward-compatible (add cluster before route, remove route before cluster).',
      'Rate-limit store: fail open with local fallback buckets; shard Redis by hash tag; keep it in-region.',
      'Per-tenant or per-domain gateways and cells cap blast radius; noisy tenants get their own fleet.',
      'Drain on deploy: remove from LB, wait out keep-alive and HTTP/2 GOAWAY, then stop — or clients see resets.',
    ],
    diagram: {
      type: 'layers',
      title: 'Control plane vs data plane',
      layers: [
        { name: 'Config sources', items: ['Gateway API CRDs', 'Git / declarative YAML', 'service registry'], tone: 'neutral' },
        { name: 'Control plane', items: ['Istiod / Envoy Gateway', 'Kong CP', 'validate + version', 'xDS / WebSocket push'], tone: 'violet' },
        { name: 'Data plane (per region)', items: ['Envoy / Kong pods', 'last-known-good config', 'stateless, autoscaled'], tone: 'accent' },
        { name: 'Shared dependencies', items: ['Redis / RLS', 'IdP JWKS', 'OPA', 'telemetry'], tone: 'info' },
      ],
      caption: 'Control plane down = no changes. Data plane down = outage. Design dependencies accordingly.',
    },
  },

  // ───────────────────────────── 6. FAILURES ─────────────────────────────
  failures: [
    {
      name: 'Retry storm',
      symptom: 'Upstream error rate rises, then gateway-to-upstream rps doubles or triples while user rps is flat; the backend never recovers.',
      detect: 'Ratio of `upstream_rq_retry` to `upstream_rq_total`; `envoy_cluster_upstream_rq_retry_overflow` and `upstream_rq_retry_limit_exceeded` rising; upstream rps ≫ downstream rps.',
      mitigate: 'Retry budget (20%) instead of fixed counts, retries at one layer only, jittered backoff, retry only idempotent routes, honour `Retry-After` and load-shed upstream.',
    },
    {
      name: 'Pending-queue overflow / spurious 503s',
      symptom: 'Bursts of 503 with `x-envoy-overloaded` while backends look healthy, or a slow backend makes all routes on the gateway slow.',
      detect: '`envoy_cluster_upstream_rq_pending_overflow`, `upstream_cx_overflow`, response flag `UO` in access logs; `upstream_rq_pending_active` near the limit.',
      mitigate: 'Size circuit-breaker thresholds per cluster from rps × p99 latency; separate clusters for slow endpoints; adaptive concurrency for fragile services.',
    },
    {
      name: 'Rate-limit store outage or latency',
      symptom: 'Every request gets +50 ms or 5xx because the global limit call times out; or limits silently stop being enforced.',
      detect: '`ratelimit.error`, `ratelimit.failure_mode_allowed` and `ratelimit.over_limit` per route; RLS p99; Redis latency and `connected_clients`.',
      mitigate: 'Tight timeout on the RLS call (~20–50 ms), fail open with local fallback buckets, alert on failure_mode_allowed, keep Redis in-region and sharded.',
    },
    {
      name: 'JWKS fetch failure or key rotation 401 wave',
      symptom: 'Sudden spike of 401s for one issuer after an IdP key rotation, or all auth fails after a gateway restart because JWKS cannot be fetched.',
      detect: '`jwt_authn.jwks_fetch_failed`, `jwt_authn.denied` by issuer; 401 rate per route compared to baseline; IdP availability probe.',
      mitigate: 'Pre-publish keys before signing, refresh on unknown `kid`, `async_fetch` at startup, long cache with background refresh, keep serving the last good JWKS.',
    },
    {
      name: 'Bad config push',
      symptom: 'A route, regex, WAF rule or plugin change takes down many routes at once — often everywhere within seconds.',
      detect: '`update_rejected` per xDS type (NACKs), config version per proxy, 5xx and `NR` (no route) by route right after the push, CPU jump after deploy.',
      mitigate: 'Validate in CI against real traffic samples, staged rollout with automatic rollback, linear-time regex engines, a global kill switch for each rule set.',
    },
    {
      name: 'TLS reconnect storm',
      symptom: 'After a gateway deploy or LB failover, CPU pegs and p99 spikes as every client re-handshakes at once.',
      detect: '`downstream_cx_total` rate, `ssl.handshake` rate vs `ssl.session_reused`, CPU per pod, handshake latency.',
      mitigate: 'ECDSA certificates, session tickets/resumption shared across pods, slow drains with HTTP/2 GOAWAY, staggered rollouts, headroom for reconnects.',
    },
    {
      name: 'Connection-level imbalance (gRPC / HTTP/2)',
      symptom: 'A few backend pods at 100% CPU while others idle; scaling out does not help.',
      detect: 'Per-host `upstream_rq_total` and `upstream_cx_active` skew; per-pod CPU variance; new pods receiving ~0 rps.',
      mitigate: 'L7 per-request balancing with least-request, `max_requests_per_connection` or server `MaxConnectionAge` to recycle connections, client-side xDS LB.',
    },
  ],
  warStories: [
    {
      title: 'One WAF regex took down the edge',
      source: 'Cloudflare, 2 July 2019 (public postmortem)',
      what: 'A new managed WAF rule containing a regex with catastrophic backtracking was deployed globally at once. CPU on every HTTP/HTTPS-serving core worldwide went to 100%, and Cloudflare’s proxies returned 502s for about 27 minutes until the WAF rules were globally disabled.',
      lesson: 'Gateway rules are code: stage them, measure CPU per rule, use linear-time regex engines, and have a global kill switch that works when the proxy itself is overloaded.',
    },
    {
      title: 'A generated config file exceeded a hard limit',
      source: 'Cloudflare, 18 November 2025 (public postmortem)',
      what: 'A database permissions change caused the query that generates the Bot Management feature file to return duplicate rows, doubling the file. The proxy had a preallocated limit of 200 features and panicked on load; because the file was regenerated every few minutes, the network flapped between good and bad config before failing broadly for hours.',
      lesson: 'Treat machine-generated config like untrusted input: validate size and shape before propagating, and make the data plane keep last-known-good config instead of crashing.',
    },
    {
      title: 'HTTP/2 Rapid Reset',
      source: 'CVE-2023-44487, disclosed October 2023 by Google, Cloudflare and AWS',
      what: 'Attackers opened HTTP/2 streams and immediately cancelled them with RST_STREAM. Cancelled streams did not count against `MAX_CONCURRENT_STREAMS`, so one connection could trigger unbounded request work in proxies; Google reported a peak of 398 million rps. Envoy, NGINX and others shipped limits on premature resets.',
      lesson: 'The gateway’s protocol stack is attack surface; keep proxies patched quickly and bound per-connection work, not just per-connection concurrency.',
    },
    {
      title: 'Three retry layers, one dead database',
      source: 'Composite of common incidents',
      what: 'A database failover added 5 s of errors. The gateway retried 3 times, service A retried 3 times, service B’s client library retried 3 times. Effective load on the database hit ~27× just as it came back, it fell over again, and the outage lasted 40 minutes instead of 5 seconds.',
      lesson: 'Retry at one layer with a budget, propagate deadlines so dead requests are dropped, and make retries visible as a ratio on dashboards.',
    },
  ],

  // ───────────────────────────── 7. NUMBERS ─────────────────────────────
  numbers: [
    { label: 'Gateway overhead per hop', value: '~0.3–2 ms p50', note: 'Self-hosted, warm connections; dominated by external calls (RLS, authz).' },
    { label: 'Envoy throughput', value: '~10k–20k rps per core', note: 'Plain HTTP proxying; roughly 3–8k with TLS, JWT and a global rate-limit call. Benchmark your own filters.' },
    { label: 'Kong latency', value: '<1 ms added with light plugins', note: 'Visible per request in `X-Kong-Proxy-Latency`; Lua body plugins cost more.' },
    { label: 'TLS 1.3 full handshake', value: '1 RTT + ~1 ms CPU', note: 'RSA-2048 sign ~1–2k/s per core; ECDSA P-256 tens of thousands/s. Resumption skips the signature.' },
    { label: 'JWT verify (RS256)', value: '~20–50 µs', note: 'Local, CPU only; introspection is 1–5 ms per uncached call.' },
    { label: 'Global rate-limit call', value: '~0.5–1 ms', note: 'gRPC to RLS + Redis round trip, same AZ.' },
    { label: 'Envoy defaults', value: 'route timeout 15 s; CB 1024/1024/1024/3', note: 'Retry budget 20% with min 3; outlier: 5 × 5xx, 30 s ejection, ≤10% hosts.' },
    { label: 'Memory per connection', value: '~10–50 KB', note: 'Proxy state plus kernel socket buffers; 100k idle keep-alives ≈ a few GB.' },
    { label: 'AWS API GW throttle', value: '10,000 rps + 5,000 burst', note: 'Per account per region, soft limit, shared by all APIs in the region.' },
    { label: 'AWS API GW timeout', value: '29 s integration', note: 'REST default (raisable for regional/private REST APIs); payload max 10 MB.' },
    { label: 'AWS API GW price', value: 'REST $3.50/M, HTTP $1.00/M', note: 'First pricing tier, us-east-1; 10k rps sustained ≈ 26B calls/month ≈ $55–60k/month on REST after volume tiers.' },
    { label: 'Lambda authorizer cache', value: 'TTL 300 s default, 3600 s max', note: 'Cached per token source; 0 disables caching.' },
  ],
  capacity: {
    question: 'Size a self-hosted Envoy gateway fleet for 500k rps peak: TLS at the gateway, local JWT verification, one global rate-limit call per request, 3 AZs.',
    steps: [
      'Per-core budget with TLS + JWT + RLS call: assume ~5k rps/core (benchmark it) → 500k / 5k = 100 cores of pure work.',
      'Run at ≤60% CPU for bursts and reconnect storms → 100 / 0.6 ≈ 167 cores.',
      'Survive losing 1 of 3 AZs: the other two must carry everything → 167 × 3/2 ≈ 250 cores → ~32 pods of 8 vCPU (≈11 per AZ).',
      'TLS: if 5% of requests arrive on new connections → 25k handshakes/s; with RSA-2048 (~1.5k/s/core) that is ~17 extra cores, with ECDSA ~1 core — use ECDSA and resumption.',
      'Rate limiting: 500k Redis ops/s; at ~100k Lua evals/s per shard that is 5+ shards plus headroom → ~8 shards; or hybrid local leases to cut calls 10×.',
      'Upstream connections: 32 pods × 8 workers × 1 HTTP/2 conn to each of 200 backend pods = 51,200 connections; check backend limits.',
    ],
    answer:
      '~250 vCPU (~32 × 8-vCPU pods across 3 AZs), ECDSA certs with resumption, an ~8-shard Redis (or hybrid local/global limiting), and a check that backends can hold ~50k inbound connections. The rate-limit store and upstream connection fan-out, not gateway CPU, are the scaling risks.',
  },

  // ───────────────────────────── 8. COMPARISON ─────────────────────────────
  comparison: {
    caption: 'Gateway products compared',
    columns: ['Product', 'Core / runtime', 'Config model', 'Extensibility', 'Performance', 'Best for'],
    rows: [
      ['Envoy (Envoy Gateway, Istio ingress)', 'C++, worker threads + event loops', 'xDS from a control plane; Gateway API CRDs', 'C++ filters, Lua, Wasm, ext_authz / ext_proc', 'Very high; lock-free hot path', 'Kubernetes platforms, gRPC, mesh + edge on one proxy'],
      ['Kong', 'NGINX + OpenResty (LuaJIT)', 'Admin API + Postgres, or DB-less / hybrid declarative', 'Lua plugins with phases + priority; Go/JS/Python PDKs', 'High; sub-ms with light plugins', 'API products: keys, consumers, plugin marketplace'],
      ['NGINX (OSS / Plus)', 'C, master + worker processes', 'Static config files + reload (Plus: API for upstreams)', 'C modules, njs, OpenResty Lua', 'Very high, tiny footprint', 'Simple edge proxying, static routing, caching'],
      ['AWS API Gateway', 'Managed multi-tenant fleet', 'Console / OpenAPI / CloudFormation', 'Lambda authorizers, mapping templates', 'Adds ~10+ ms; 10k rps default quota', 'Serverless and Lambda backends, low ops, moderate QPS'],
      ['Spring Cloud Gateway', 'Java, Netty + Reactor', 'Java DSL or properties, predicates + filters', 'Java filters, Spring ecosystem', 'Good; JVM memory, GC tails', 'Spring shops wanting gateway logic in Java'],
      ['Apollo Router', 'Rust, async', 'Supergraph schema + YAML', 'Rhai scripts, coprocessors', 'High; cost is in the query plan', 'GraphQL federation across many teams'],
    ],
  },
  whenNot: [
    'East-west service-to-service calls: do not hairpin them through the edge gateway; use a service mesh or client libraries for mTLS, retries and balancing.',
    'A single service or a monolith: an L7 load balancer or ingress controller gives TLS and routing without another hop and another critical component.',
    'Business logic or orchestration ("god gateway"): put aggregation in a BFF owned by the client team or in a domain service, not in gateway plugins.',
    'Bulk uploads, downloads and long streams: hand out presigned URLs to object storage or a CDN; do not pump gigabytes through a 29 s, 10 MB-limited or per-request-billed gateway.',
    'Ultra-low-latency or non-HTTP traffic (game UDP, market data, raw TCP): use L4 load balancing; an L7 filter chain adds latency and buys nothing.',
  ],

  // ───────────────────────────── 9. INTERVIEW ─────────────────────────────
  interview: [
    {
      q: 'Design the authentication path for a public API at 500k rps.',
      a: 'Use self-contained, short-lived JWTs (5–15 min) signed with asymmetric keys and verify them locally at the gateway: allow-listed `alg`, key by `kid` from a JWKS cache that is fetched at startup and refreshed in the background or on an unknown `kid`, `exp`/`nbf` with ~60 s skew, `iss`, `aud`, scopes. That costs ~50 µs of CPU per request, so 500k rps needs only a few cores for auth and has no network dependency. Revocation is handled by short expiry plus a small pushed deny-list of revoked sessions; only high-risk routes (payouts, admin) use introspection with a seconds-long cache. Strip client-supplied identity headers, then inject verified claims for services, and put coarse IP limits before auth so floods cannot make you burn CPU or IdP calls.',
      followUps: [
        'The IdP rotates keys and you see a 401 spike — what happened?',
        'How do you revoke a stolen token within one minute?',
        'Partners need machine-to-machine auth — what changes?',
        'What if the JWKS endpoint is down when a gateway pod starts?',
      ],
      seniorSignal: 'Quantifies the cost of each option (µs vs ms vs IdP QPS), designs for key rotation and revocation explicitly, and treats the IdP as a dependency the hot path must not need.',
    },
    {
      q: 'Why rate-limit after authentication rather than before? Should any limit come before it?',
      a: 'Per-identity quotas must run after authentication because before verification the user id, tenant or API key is attacker-controlled; keying on it lets an attacker drain someone else’s quota or rotate fake identities to evade limits. But a coarse limit keyed on something you trust without auth — source IP, connection, TLS fingerprint — must run **before** auth, locally and without I/O, to protect the authentication step itself, especially if it involves introspection or an external authz call. So the order is CORS preflight, coarse local limit, authN, per-identity global limit, authZ, transform, route: cheapest and highest-rejection checks first. Behind a CDN or NLB you must take the client IP from a trusted `X-Forwarded-For` hop or PROXY protocol, or the IP limit is useless.',
      followUps: [
        'Should denied (403) requests consume the user’s quota?',
        'How do you handle thousands of users behind one corporate NAT IP?',
        'Where does CORS go and why?',
      ],
      seniorSignal: 'Separates abuse protection (pre-auth, keyed on trusted network attributes) from fairness/quotas (post-auth, keyed on verified identity) and reasons about filter cost ordering.',
    },
    {
      q: 'API gateway vs load balancer vs service mesh — when do you need which?',
      a: 'An L4/L7 load balancer spreads traffic across replicas of one service and terminates connections; it knows nothing about API keys or tenants. An API gateway is the north-south L7 entry point that owns the public API contract: authentication, quotas per consumer, versioned routing, transformation and edge observability. A service mesh handles east-west traffic between services with sidecars or node proxies: mTLS identity, retries, timeouts and balancing on every hop. They often share the same data plane (Envoy), but differ in who owns the config and which traffic they see; a typical stack is NLB → gateway → services, with the mesh between services.',
      followUps: [
        'Why not route internal calls through the gateway too?',
        'Can the mesh ingress be your API gateway?',
        'Where do retries live when you have both?',
      ],
      seniorSignal: 'Distinguishes by traffic direction and ownership (platform vs API product), and notes retries must be configured in exactly one of the layers.',
    },
    {
      q: 'How do you roll out a gateway configuration change safely?',
      a: 'Treat config as code: schema-validate and lint in CI, run it against recorded traffic or a shadow proxy, and check regex/rule CPU cost. Push through the control plane in stages — canary proxies, one AZ, one region, then global — watching 5xx and latency by route, `update_rejected` (NACKs) and CPU, with automatic rollback on regression. Make each change valid under version skew, because proxies converge at different times: add clusters before routes that use them and remove routes before clusters. Keep a per-feature kill switch and rely on the data plane keeping last-known-good config if the control plane misbehaves. Cloudflare’s 2019 WAF outage is the canonical example of what a global, unstaged rule push does.',
      followUps: [
        'Envoy ACKed the config but traffic still broke — how?',
        'What happens to in-flight requests during an NGINX reload or Envoy listener change?',
        'How do you roll back if the control plane itself is broken?',
      ],
      seniorSignal: 'Knows NACK only catches invalid config, plans for eventual consistency across proxies, and cites staged rollout plus automated rollback on route-level SLOs.',
    },
    {
      q: 'A backend starts failing and the outage gets worse instead of better. Explain the retry storm and fix it.',
      a: 'If the gateway, service A and service B each make up to 3 attempts, a failing leaf receives up to 27× load at exactly the moment it is weakest, so it never recovers. Fix it structurally: retry at one layer only, with jittered exponential backoff, and bound retries with a budget (Envoy `retry_budget` 20% of active requests) instead of per-request counts. Retry only idempotent requests or errors that prove no work happened (`connect-failure`, `refused-stream`), use idempotency keys for POSTs, and propagate deadlines so inner layers stop work the caller has already abandoned. Add circuit breakers and load shedding upstream, honour `Retry-After`, and alert on the retry ratio and `upstream_rq_retry_overflow`.',
      followUps: [
        'Is hedging a good idea here?',
        'What should the timeout hierarchy look like?',
        'How does the client SDK’s retry interact with the gateway’s?',
      ],
      seniorSignal: 'Does the multiplicative math, prefers budgets over counts, and connects retries to idempotency and deadline propagation.',
    },
    {
      q: 'Your gRPC services sit behind an NLB and some pods are at 100% CPU while new pods get no traffic. Why, and what do you do?',
      a: 'gRPC uses long-lived HTTP/2 connections and multiplexes all calls over them, so an L4 load balancer balances connections, not requests: each client is pinned to whichever pod it connected to, and pods added by autoscaling get no existing connections. Options are an L7 proxy or gateway (Envoy) that balances each stream with least-request; client-side balancing via DNS/xDS (proxyless gRPC) with round robin or weighted policies; or forcing periodic reconnects with `MaxConnectionAge` on servers (or `max_requests_per_connection` on proxies) so connections redistribute. The L7 hop costs ~0.3 ms but also gives per-call retries, outlier detection and metrics.',
      followUps: [
        'What does `MAX_CONCURRENT_STREAMS` do to the proxy’s connection pool?',
        'How does Envoy’s per-worker pool affect the number of connections to each pod?',
        'Would HTTP/3 change this picture?',
      ],
      seniorSignal: 'Explains connection-vs-request balancing precisely and weighs proxy, proxyless and connection-recycling options by cost and operability.',
    },
    {
      q: 'The control plane (Istiod / Envoy Gateway / Kong CP) goes down for 30 minutes. What breaks?',
      a: 'Nothing breaks immediately: proxies keep serving the last-known-good listeners, routes, clusters and secrets from memory. What stops is change: new routes, endpoint updates from autoscaling or deploys, and certificate rotation. Stale EDS means traffic is still sent to pods that were removed, which health checks and outlier detection partially hide, and new pods receive no traffic; expiring certificates are the real time bomb. A restarted proxy pod may come up with no config at all, so avoid restarting the data plane during a control-plane outage, or bootstrap from a static/cached snapshot.',
      followUps: [
        'How would you alert on config staleness?',
        'How do you run control planes for multi-region active-active?',
        'What if the control plane pushes a deny-all policy instead of dying?',
      ],
      seniorSignal: 'Separates data-plane availability from control-plane freshness and identifies second-order risks (stale endpoints, cert expiry, cold-start proxies).',
    },
    {
      q: 'The mobile team wants the gateway to aggregate five services into one home-screen call. What do you say?',
      a: 'The need is valid — mobile clients on high-latency networks should not make five round trips — but putting aggregation in the shared gateway turns it into a god gateway: business logic in plugins, every product change blocked on the platform team, and one slow dependency degrading every API. Instead build a BFF for the mobile experience, owned by the mobile team, deployed behind the gateway, with its own timeouts, partial-failure handling and caching. If many clients need flexible composition, a GraphQL federation router with query planning, cost limits and persisted operations is the scalable version. The gateway keeps doing auth, quotas, routing and protocol translation.',
      followUps: [
        'How should the BFF handle one of five calls timing out?',
        'When is GraphQL federation better than several BFFs?',
        'How do you avoid N+1 across subgraphs?',
      ],
      seniorSignal: 'Agrees with the client need while protecting the platform boundary, and offers BFF vs federation with ownership and failure handling.',
    },
  ],

  // ───────────────────────────── 10. TAKEAWAYS ─────────────────────────────
  takeaways: [
    'A gateway is an L7 proxy plus an ordered filter chain; cheapest, highest-rejection filters go first and the router is always last.',
    'Coarse IP limits before auth protect the auth step; per-identity quotas after auth, because unverified identities are attacker-controlled.',
    'Local work costs microseconds; latency comes from network calls (RLS, authz, introspection) and from new TLS or upstream connections.',
    'Control plane down means no changes; data plane down means outage — keep databases and control planes off the request path.',
    'Most gateway outages are config pushes: stage rollouts, expect version skew, auto-rollback on 5xx by route.',
    'Retries multiply across layers; retry at one layer with a budget, propagate deadlines, and require idempotency for unsafe methods.',
    'gRPC/HTTP/2 needs per-request L7 balancing; L4 balancers pin long-lived connections.',
    'Keep business logic out: BFFs or GraphQL federation for composition, services for rules.',
  ],
};

export default deep;
