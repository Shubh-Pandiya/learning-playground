import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'service',

  problem: {
    why:
      'Microservices exist to scale **organizations**, not CPUs: when dozens of teams share one deployable, they block each other on releases, schemas and on-call. Splitting by business capability, each with its own data and API contract, lets a team change, deploy and scale its part independently. The price is that every former function call becomes a network call that can be slow, fail, or be partially applied — so the real design work is boundaries, contracts and failure isolation.',
    withoutIt: [
      'In a large monolith, one team’s bad migration or memory leak takes down every feature and blocks every other team’s release train.',
      'Every capability scales together: you buy 50 more search-sized instances because checkout needs more CPU.',
      'A shared schema becomes an implicit API: no one can rename a column because unknown code reads it.',
      'Ownership blurs: incidents bounce between teams because nobody owns the module end to end.',
    ],
    position:
      'Called by the gateway/BFF or other services over gRPC/HTTP, or triggered by events from a broker. It owns a private database and publishes changes as events; everything else talks to it only through its contract.',
    diagram: {
      type: 'flow',
      title: 'One capability, one owner',
      nodes: [
        { label: 'Gateway / BFF', sub: 'composes responses', tone: 'neutral' },
        { label: 'Orders service', sub: 'API contract (proto)', tone: 'accent' },
        { label: 'Orders DB', sub: 'private to Orders', tone: 'violet' },
        { label: 'Outbox → Kafka', sub: 'OrderCreated events', tone: 'info' },
        { label: 'Inventory, Email', sub: 'react asynchronously', tone: 'ok' },
      ],
      caption: 'Others never read the Orders tables; they call the API or consume events.',
    },
  },

  architecture: {
    overview:
      'A service is an app server plus the machinery that makes network boundaries survivable: a versioned **contract** (Protobuf/OpenAPI), a **resilience layer** (timeouts, retries with budgets, circuit breakers — in a client library or a mesh sidecar), **discovery and load balancing**, a **private datastore** with an outbox for reliable events, and **observability** that stitches one user request across many services.',
    diagram: {
      type: 'layers',
      title: 'Service and its platform',
      layers: [
        { name: 'Contract', items: ['Protobuf / OpenAPI', 'Versioning rules', 'Contract tests'], tone: 'accent' },
        { name: 'Network layer', items: ['Envoy sidecar / lib', 'mTLS identity', 'Retries + budgets', 'Breakers, outlier ejection'], tone: 'info' },
        { name: 'Service code', items: ['Bounded context logic', 'Idempotency keys', 'Deadline handling'], tone: 'ok' },
        { name: 'Owned data', items: ['Private DB', 'Outbox table', 'CDC relay'], tone: 'violet' },
        { name: 'Platform', items: ['Discovery', 'Tracing (OTel)', 'RED metrics', 'CI/CD per service'], tone: 'neutral' },
      ],
    },
    blocks: [
      { name: 'API contract', what: 'Protobuf/gRPC or OpenAPI schema in a shared registry (Buf Schema Registry, an `api` repo). Breaking-change detection in CI (`buf breaking`), consumer-driven contract tests (Pact) for HTTP.' },
      { name: 'Client stub + deadline', what: 'Generated client that carries a deadline (`grpc-timeout` header) and trace context on every call; the callee checks remaining time before doing work.' },
      { name: 'Sidecar proxy / resilience library', what: 'Envoy (Istio) or linkerd2-proxy intercepts traffic: mTLS with SPIFFE identities, per-route timeouts, retry policies and budgets, outlier detection, circuit breaking (`max_pending_requests`, `max_requests`). Without a mesh: Resilience4j, Polly, gRPC service config.' },
      { name: 'Service discovery', what: 'Kubernetes Services/EndpointSlices, Consul, or xDS from a mesh control plane give the caller a live list of healthy endpoints; client-side LB picks one per request (important for HTTP/2, where one connection would pin traffic).' },
      { name: 'Private database', what: 'Database per service (or schema per service with strictly separate credentials). The service chooses the engine for its access pattern; no cross-service joins or foreign keys.' },
      { name: 'Transactional outbox + CDC', what: 'State change and event row committed in one local transaction; Debezium tails the WAL/binlog and publishes to Kafka. Consumers are idempotent because delivery is at-least-once.' },
      { name: 'Telemetry', what: 'OpenTelemetry spans propagated via W3C `traceparent`; RED metrics per route and per dependency; structured logs carrying trace ids so a page can jump from metric → exemplar trace → logs.' },
    ],
    real: [
      { name: 'Amazon', how: 'The ~2002 “API mandate”: teams expose data and functionality only through service interfaces, with no direct DB access. Two-pizza teams own services end to end (“you build it, you run it”).' },
      { name: 'Netflix', how: 'Hundreds of Java services; built Eureka (discovery), Ribbon (client LB), Hystrix (bulkheads/breakers, now in maintenance mode) and Zuul (edge gateway) before meshes existed; now largely gRPC with adaptive concurrency limits.' },
      { name: 'Uber DOMA', how: 'With ~2,200 critical microservices, Uber grouped services into **domains** behind gateways with layered dependencies (2020 blog) — an admission that a flat graph of thousands of services is unmanageable.' },
      { name: 'Istio / Linkerd', how: 'Istio: `istiod` pushes xDS config to Envoy sidecars (or ztunnel + waypoint proxies in ambient mode). Linkerd: Rust micro-proxy focused on low overhead; both provide mTLS, retries, traffic splitting and golden metrics.' },
      { name: 'Shopify (contrast)', how: 'Runs one of the largest Rails **modular monoliths**, enforcing component boundaries with static tooling (Packwerk) instead of the network — microservice-style ownership without network calls.' },
    ],
  },

  lifecycle: {
    summary:
      'Checkout calls `Orders.CreateOrder` over gRPC through a sidecar mesh in the same region: ~6 ms, of which the network and two proxies are ~1.5 ms and the owned DB transaction dominates. Event publication happens after the response, off the critical path.',
    stages: [
      { stage: 'Client stub', what: 'Serialize protobuf, attach deadline (`grpc-timeout: 280m`), `traceparent`, idempotency key.', cost: 'µs-level', ms: 0.02 },
      { stage: 'Outbound sidecar', what: 'Envoy picks a healthy endpoint (least-request), reuses an mTLS HTTP/2 connection, applies route timeout.', cost: '~0.2–0.5 ms p50', ms: 0.4 },
      { stage: 'Network hop', what: 'Pod to pod in the same AZ (cross-AZ adds ~0.5–1 ms and data-transfer cost).', cost: '~0.1–0.5 ms', ms: 0.3 },
      { stage: 'Inbound sidecar', what: 'Terminates mTLS, checks AuthorizationPolicy (caller SPIFFE id), records metrics.', cost: '~0.2–0.5 ms', ms: 0.4 },
      { stage: 'Handler', what: 'Checks remaining deadline, validates, looks up idempotency key to return a prior result on retry.', cost: 'CPU + 1 Redis/DB read', ms: 0.8 },
      { stage: 'Owned DB transaction', what: '`INSERT order` + `INSERT outbox` in one Postgres transaction, commit with fsync.', cost: '~2–5 ms', ms: 3 },
      { stage: 'Response path', what: 'Back through both sidecars; caller span closed with status and duration.', cost: '~0.6 ms', ms: 0.6 },
      { stage: 'Async event (off path)', what: 'Debezium reads the outbox from the WAL and publishes `OrderCreated` to Kafka ~100 ms–1 s later.', cost: 'Not on the request path', ms: 0 },
    ],
  },

  deepDives: [
    {
      title: 'Finding boundaries: bounded contexts and data ownership',
      hook: 'Split by who changes the data and why — not by nouns.',
      body: [
        'A good service boundary is a **bounded context** (DDD): a region of the domain where terms have one meaning and one team owns the rules. “Customer” in Billing (payment methods, dunning) and in Support (tickets, SLA tier) are different models; forcing one Customer service onto both creates a chatty, coupled hub.',
        '**Database per service** is the non-negotiable part: if two services read the same tables, the schema is a shared API and you cannot deploy them independently. Cross-context data flows by API calls (for fresh reads) or by events that let consumers keep a local read model (for availability and speed).',
        'Entity services (UserService, ProductService, OrderService as CRUD wrappers) are the classic mistake: every business operation then spans many services, needs distributed transactions and fails if any hop fails.',
      ],
      diagram: {
        type: 'compare',
        title: 'Capability split vs entity split',
        columns: [
          { name: 'By capability', tone: 'ok', points: ['Checkout, Pricing, Fulfilment', 'One team per context', 'Most ops are local', 'Events between contexts'] },
          { name: 'By entity (CRUD)', tone: 'bad', points: ['User, Product, Order', 'Every op touches 4 services', 'Sync chains, 2PC temptation', 'Distributed monolith'] },
        ],
      },
      insight:
        'A useful test: for the top 10 business operations, count the services each must call synchronously to succeed. If most need 3+, your boundaries follow data shapes, not change reasons.',
    },
    {
      title: 'Sync vs async communication',
      hook: 'Synchronous calls multiply availability and add latency; events trade both for eventual consistency.',
      body: [
        'With synchronous calls, a request succeeds only if every service in the chain is up: 10 services at 99.9% each give 0.999¹⁰ ≈ 99.0% — ~7 hours of failure per month instead of 43 minutes. Latencies add along the chain and tail latencies compound.',
        'Asynchronous messaging removes **temporal coupling**: Orders can accept writes while Email is down, and consumers catch up later. In exchange you get eventual consistency, duplicate and out-of-order delivery (handlers must be idempotent), and harder debugging (traces must link through the broker).',
      ],
      table: {
        columns: ['Style', 'Example', 'Coupling', 'Consistency', 'Use when'],
        rows: [
          ['Request/response (gRPC/REST)', 'GetPrice(sku)', 'Temporal + behavioural', 'Immediate', 'Caller needs the answer now'],
          ['Command via queue', 'GenerateInvoice job', 'Behavioural only', 'Eventually done', 'Work can be deferred, needs retry'],
          ['Event notification', 'OrderCreated{id}', 'Low', 'Consumers fetch details', 'Many reactors, small payloads'],
          ['Event-carried state transfer', 'OrderCreated{full order}', 'Lowest', 'Local read models', 'Consumers need data while producer is down'],
        ],
      },
      insight:
        'Choreography (services react to events) scales teams but hides the business process; once a flow spans 4+ steps with compensations, an explicit orchestrator (Temporal, Step Functions, a saga service) makes it observable and changeable.',
    },
    {
      title: 'Contracts and versioning: Protobuf compatibility rules',
      hook: 'Deploys are not atomic — old clients meet new servers and vice versa, for days.',
      body: [
        'Protobuf’s wire format identifies fields by **number**, not name, which defines the rules: add new fields with new numbers (old readers ignore unknown fields); never change a field’s number or reuse a deleted number — mark it `reserved`; do not change types except within documented compatible groups (e.g. `int32`/`int64`/`uint32`/`bool` on the wire); renaming a field is wire-safe but breaks JSON mapping and generated code.',
        'Both directions must work: new server with old clients (backward compatibility) and old server with new clients (forward compatibility), because canaries and rollbacks guarantee mixed versions. Enforce with `buf breaking` against the main branch in CI; for REST, consumer-driven contract tests (Pact) run the consumers’ expectations against the provider build.',
        'Breaking changes go through a new version (`orders.v2` package, `/v2/` path) run side by side, with usage metrics per client to know when v1 can be removed.',
      ],
      code: {
        lang: 'text',
        caption: 'proto3: removing a field safely',
        code: `syntax = "proto3";
package orders.v1;

message Order {
  reserved 4;                 // was: string coupon_code
  reserved "coupon_code";     // also block the name (JSON)
  string id = 1;
  int64 total_cents = 2;      // int32 -> int64 is wire-compatible
  repeated LineItem items = 3;
  optional string promo_id = 5; // new: old readers skip it
  OrderStatus status = 6;
}
enum OrderStatus {
  ORDER_STATUS_UNSPECIFIED = 0;  // proto3 enums must start at 0
  ORDER_STATUS_PLACED = 1;
}`,
      },
      insight:
        'Semantic changes break consumers even when the schema is compatible: changing `total` from “incl. tax” to “excl. tax” passes every linter. Version meaning, not just shape.',
    },
    {
      title: 'Timeouts, deadline propagation and retry discipline',
      hook: 'Every hop needs a timeout smaller than its caller’s — and only one layer should retry.',
      body: [
        'A **deadline** is an absolute point in time that travels with the request (gRPC sends the remaining time as `grpc-timeout`; Go uses `context.WithTimeout`). Each service checks it before expensive work and passes the remainder downstream, so work for a caller that already gave up is never started.',
        'Retries multiply: if gateway, service A and service B each retry 3 times, the deepest service sees up to 3³ = 27× load exactly when it is struggling. Retry at one layer (usually closest to the failure), only idempotent operations, with jittered exponential backoff and a **retry budget** (Envoy `retry_budget`, gRPC `retryThrottling`, e.g. retries ≤ 10–20% of requests).',
      ],
      diagram: {
        type: 'sequence',
        title: 'Deadline shrinks as it propagates',
        actors: ['Gateway', 'Checkout', 'Pricing', 'Tax'],
        messages: [
          { from: 'Gateway', to: 'Checkout', label: 'deadline 500 ms' },
          { from: 'Checkout', to: 'Pricing', label: 'remaining 470 ms' },
          { from: 'Pricing', to: 'Tax', label: 'remaining 300 ms' },
          { from: 'Tax', to: 'Pricing', label: 'too slow: DEADLINE_EXCEEDED', dashed: true, tone: 'bad' },
          { from: 'Pricing', to: 'Checkout', label: 'fallback: cached tax rate', dashed: true, tone: 'warn' },
          { from: 'Checkout', to: 'Gateway', label: '200 in 480 ms', dashed: true, tone: 'ok' },
        ],
      },
      code: {
        lang: 'go',
        code: `func (s *Pricing) Quote(ctx context.Context, r *Req) (*Quote, error) {
    if dl, ok := ctx.Deadline(); ok && time.Until(dl) < 20*time.Millisecond {
        return nil, status.Error(codes.DeadlineExceeded, "no budget left")
    }
    taxCtx, cancel := context.WithTimeout(ctx, 150*time.Millisecond)
    defer cancel()
    tax, err := s.tax.Rate(taxCtx, &TaxReq{Region: r.Region})
    if err != nil {
        tax = s.cachedRate(r.Region) // degrade, don't fail the order
    }
    return price(r, tax), nil
}`,
      },
      insight:
        'A service mesh with retries enabled plus client-library retries plus application retries is the most common hidden retry storm. Audit retry policy end to end, not per service.',
    },
    {
      title: 'Fan-out and the tail at scale',
      hook: 'Fan out to 100 servers and the 1% tail becomes the common case.',
      body: [
        'If each backend has a 1% chance of a slow response, a request that waits for N parallel backends is slow with probability 1 − 0.99ᴺ. Dean and Barroso’s “The Tail at Scale” (CACM 2013) made this concrete: with 100-way fan-out, 63% of user requests see at least one backend’s p99.',
        'Mitigations from the paper and practice: **hedged requests** (send a second copy if the first has not returned by ~p95; the paper reports p99.9 for a 100-server fan-out falling from 1,800 ms to 74 ms with ~2% extra requests), tied requests (both copies cancel each other once one starts), partial results with a deadline (search returns from 98% of shards), and reducing variance at the source (GC tuning, background work throttling).',
      ],
      table: {
        caption: 'P(request hits ≥1 slow backend) when each backend is slow 1% of the time',
        columns: ['Fan-out N', 'Probability', 'Effective user-facing percentile'],
        rows: [
          ['1', '1%', 'p99 is p99'],
          ['10', '9.6%', 'backend p99 ≈ user p90'],
          ['50', '39.5%', 'backend p99 ≈ user p60'],
          ['100', '63.4%', 'backend p99 ≈ user median'],
        ],
      },
      insight:
        'For fan-out services, set backend SLOs at p99.9 or tighter, not p99 — and hedge only idempotent reads, with a budget, or hedging becomes a load amplifier during incidents.',
    },
    {
      title: 'Cascading failure, meshes and isolation',
      hook: 'One slow leaf service can take the whole graph down through thread and connection exhaustion.',
      body: [
        'Cascades follow a pattern: a leaf gets slow → callers’ threads and pools fill waiting on it → callers get slow → their callers fill up. Retries add load at the worst moment, and autoscalers add instances that open even more connections to the struggling dependency.',
        'Isolation tools: **bulkheads** (separate pools per dependency so a slow Recommendations call cannot starve Checkout), **circuit breakers** (stop calling after an error threshold and fail fast/fallback), **outlier detection** (Envoy ejects individual bad hosts on consecutive 5xx), **load shedding** with priority (drop optional work first), and **adaptive concurrency** (Netflix `concurrency-limits`, Envoy adaptive concurrency filter) which lowers limits when latency rises.',
        'A mesh centralizes these as config pushed by a control plane, uniform across languages. Its control plane is not in the request path — sidecars keep last-known config if `istiod` is down — but a bad pushed config is instantly global.',
      ],
      diagram: {
        type: 'layers',
        title: 'Mesh: control plane vs data plane',
        layers: [
          { name: 'Control plane', items: ['istiod', 'xDS config push', 'Cert authority (SPIFFE)'], tone: 'violet' },
          { name: 'Data plane', items: ['Envoy sidecar per pod', 'mTLS', 'Retries, breakers', 'Metrics, traces'], tone: 'info' },
          { name: 'Services', items: ['Checkout', 'Pricing', 'Orders', 'Tax'], tone: 'ok' },
        ],
        caption: 'Control-plane outage freezes config; data plane keeps serving.',
      },
      insight:
        'Observe dependencies from the caller side: RED metrics per (caller, callee, route) reveal which edge is failing; callee-only metrics hide requests that never arrived because the caller’s breaker or pool rejected them.',
    },
    {
      title: 'Conway, team topology and when NOT to split',
      hook: 'Architecture mirrors communication structure — split when teams need it, not before.',
      body: [
        '**Conway’s law** (1968): systems mirror the communication structure of the organisations that build them. Team Topologies (Skelton & Pais) turns this into a tool: align services with **stream-aligned teams**, keep cognitive load bounded, and let platform teams provide discovery, CI/CD and observability as a product.',
        'Distributed monolith smells: services must deploy in lockstep; shared database or shared “common” library with domain logic; synchronous call chains 5+ deep for one user action; one team owning 15 services; end-to-end tests are the only safety net.',
      ],
      bullets: [
        'Do not split when: one or two teams, domain still being discovered, or no platform for deploys/observability yet — use a modular monolith with enforced module boundaries.',
        'Split when: teams block each other’s deploys, components have very different scaling or reliability needs, or a capability needs isolation (payments PCI scope).',
        'Extraction order: strangler fig — route one capability’s traffic to the new service, move its data ownership, then delete the old code path.',
      ],
      insight:
        'The cost of microservices is mostly fixed (platform, on-call, observability, contract discipline); the benefit scales with the number of teams. Below ~5 teams the math rarely works.',
    },
  ],

  scaling: {
    body: [
      'Each service scales independently on its own signal and owns its datastore’s scaling — that is the point. The shared risk is the **dependency graph**: total availability and latency are determined by the critical path, and capacity planning must follow fan-out ratios (one homepage request = 1 Profile + 3 Pricing + 40 Recommendations calls).',
      'Control plane (mesh control plane, discovery, CI/CD, schema registry) vs data plane (sidecars, services, brokers): design so the data plane runs on cached state when the control plane is down, and so config pushes are staged per cluster/region rather than global.',
      'Multi-region: keep request paths region-local (cell-based architecture), replicate data asynchronously via events, and avoid synchronous cross-region calls on the hot path — one cross-region hop (~60–150 ms) usually costs more than the entire local request.',
    ],
    bullets: [
      'Cells: deploy the whole service graph per cell/shard so a bad deploy or poison request affects one cell, not all customers.',
      'Critical-path analysis: mark which dependencies are hard (fail request) vs soft (degrade), and test soft ones with fault injection.',
      'Capacity follows fan-out: a 2× homepage spike can be 2× on 30 services at once.',
      'Rate limits and priorities at service entry protect owners from noisy internal callers.',
      'Contract and schema registries are build-time dependencies, not runtime ones.',
    ],
    diagram: {
      type: 'flow',
      title: 'Critical path vs soft dependencies',
      nodes: [
        { label: 'Gateway', tone: 'neutral' },
        { label: 'Checkout', sub: 'hard dependency', tone: 'accent' },
        { label: 'Orders', sub: 'hard dependency', tone: 'accent' },
        { label: 'Recs', sub: 'soft: degrade', tone: 'warn' },
        { label: 'Email', sub: 'async via events', tone: 'ok' },
      ],
      caption: 'Only hard dependencies multiply availability; make everything else soft or async.',
    },
  },

  failures: [
    {
      name: 'Cascading failure from a slow dependency',
      symptom: 'One leaf service’s latency rises; callers’ pools fill; error rate spreads up the graph to the edge.',
      detect: 'Per-edge latency/error dashboards (`istio_request_duration_milliseconds` by source/destination), pool saturation, breaker-open events (`resilience4j_circuitbreaker_state`).',
      mitigate: 'Deadlines, bulkheads per dependency, circuit breakers with fallbacks, adaptive concurrency, load shedding.',
    },
    {
      name: 'Retry storm',
      symptom: 'During a partial outage, request volume at the deepest service jumps several-fold; it never recovers until traffic is cut.',
      detect: 'Ratio of attempts to requests (`envoy_cluster_upstream_rq_retry` vs `upstream_rq_total`), `envoy_cluster_upstream_rq_retry_overflow`, sudden RPS increase without user traffic increase.',
      mitigate: 'Retry at one layer, retry budgets, jittered backoff, idempotency keys, server-side load shedding with `Retry-After`.',
    },
    {
      name: 'Breaking contract change',
      symptom: 'After a deploy, a subset of consumers fails to parse responses or silently gets zero values for a field.',
      detect: 'Error spikes split by client version/caller identity; deserialization errors; canary analysis on consumer-side metrics.',
      mitigate: '`buf breaking` / Pact in CI, `reserved` fields, additive changes, parallel `v2` with migration tracking.',
    },
    {
      name: 'Distributed monolith',
      symptom: 'Releases need coordinated deploys of 4 services; outages in one take down everything; lead time worse than the old monolith.',
      detect: 'Co-change analysis in git (services always changed together), synchronous call depth in traces, shared DB credentials.',
      mitigate: 'Re-draw boundaries around capabilities, give each its own data, replace sync chains with events — or merge services back.',
    },
    {
      name: 'Dual write inconsistency',
      symptom: 'Order committed but `OrderCreated` never published (or published for a rolled-back transaction).',
      detect: 'Reconciliation jobs comparing DB state with downstream projections; outbox lag metric; consumer-side gaps in sequence numbers.',
      mitigate: 'Transactional outbox with CDC, idempotent consumers, periodic reconciliation.',
    },
  ],

  warStories: [
    {
      title: 'Segment: “Goodbye Microservices”',
      source: 'Segment engineering blog, 2018',
      what:
        'Segment had split each event destination into its own service and queue — 140+ services. Shared libraries diverged across services, every fix needed 140 deploys, and operational load grew with each destination. They merged them back into one service with one repo, and productivity and reliability improved.',
      lesson: 'Services that share a domain, a codebase pattern and a team are not independent. Split for independent change, not by configuration value.',
    },
    {
      title: 'Prime Video: monitoring pipeline back to a monolith',
      source: 'Prime Video Tech blog, 2023',
      what:
        'A video-quality monitoring system built from distributed serverless components (Step Functions orchestration, S3 for intermediate frames) hit scaling limits and high cost from per-transition and data-transfer charges. Rebuilding it as a single process running in ECS cut infrastructure cost by over 90%.',
      lesson: 'Network boundaries cost money and latency per hop; data-heavy pipelines with tight coupling belong in one process.',
    },
    {
      title: 'Three layers of retries',
      source: 'Composite of common incidents',
      what:
        'A database failover made the Inventory service slow for 40 s. The mesh retried twice, the Checkout client library retried three times and the mobile app retried on timeout. Inventory saw ~15× its normal load, never recovered on its own and stayed down until traffic was shed manually.',
      lesson: 'Retry policy is a system property. Budget retries, retry at one layer, and make the overloaded service shed load early.',
    },
  ],

  numbers: [
    { label: 'Same-AZ RTT', value: '~0.1–0.5 ms', note: 'cross-AZ ~0.5–2 ms; cross-region 30–150 ms' },
    { label: 'Sidecar proxy overhead', value: '~0.2–1 ms per proxy', note: 'p50; two per hop; higher at p99' },
    { label: 'Serial availability', value: '0.999¹⁰ ≈ 99.0%', note: '10 hard dependencies' },
    { label: 'Fan-out 100, 1% slow each', value: '63% of requests slow', note: 'The Tail at Scale' },
    { label: 'Retry amplification', value: '3 layers × 3 tries = 27×', note: 'at the deepest service' },
    { label: 'gRPC default max receive message', value: '4 MB', note: 'large payloads → streaming or blob store' },
    { label: 'Protobuf field numbers 1–15', value: '1-byte tag', note: 'reserve for frequent fields' },
    { label: 'Uber (2020)', value: '~2,200 critical services', note: 'led to domain-oriented architecture' },
  ],

  capacity: {
    question:
      'The product page has a 300 ms p99 SLO. It calls Catalog (p99 40 ms), then in parallel Pricing (p99 60 ms) and Inventory, which fans out to 20 warehouse shards (each p99 50 ms). Can it meet the SLO and what should change?',
    steps: [
      'Fan-out tail: 20 shards at p99 50 ms ⇒ P(any shard slow) = 1 − 0.99²⁰ ≈ 18%, so ~18% of requests see a shard’s p99 or worse; the user-facing p99 of Inventory ≈ a shard’s p99.95 — assume ~150 ms.',
      'Critical path p99 ≈ Catalog 40 + max(Pricing 60, Inventory ~150) + gateway/serialization ~20 ⇒ ~210 ms; plus sidecar overhead 4 hops × ~1 ms.',
      'Retries: one retry at 150 ms timeout on Inventory adds up to another 150 ms ⇒ worst case ~360 ms — over budget.',
      'Fix: hedge shard reads at ~p95 (≈30 ms) with a 5% budget, return partial availability (“in stock at 19/20 warehouses”) at a 120 ms deadline, and no retries beyond the hedge.',
    ],
    answer:
      'Without changes the SLO is met only if no retries happen and shard tails behave; with hedging, a per-shard deadline and partial results, p99 lands around ~200 ms with headroom.',
  },

  comparison: {
    caption: 'Architecture styles',
    columns: ['Style', 'Deploy unit', 'Data', 'Cross-module consistency', 'Fixed cost', 'Best for'],
    rows: [
      ['Monolith', 'One', 'Shared DB', 'ACID transactions', 'Lowest', 'Small teams, early product'],
      ['Modular monolith', 'One', 'Schema per module', 'ACID, enforced boundaries', 'Low', 'Growing teams, unclear domain'],
      ['Microservices', 'Per service', 'DB per service', 'Sagas, outbox, eventual', 'High (platform, on-call)', 'Many teams, divergent scaling'],
      ['Serverless functions', 'Per function', 'Managed stores', 'Eventual; orchestrators', 'Low ops, high per-call', 'Spiky, event-driven glue'],
      ['Cell-based services', 'Per cell', 'Sharded per cell', 'Within cell ACID', 'Highest', 'Blast-radius control at huge scale'],
    ],
  },

  whenNot: [
    'One or two teams, or a domain still being discovered: build a modular monolith and extract later along proven seams.',
    'Operations needing strong multi-entity transactions all the time (ledger + balances): keep them in one service/database.',
    'No platform yet (CI/CD per service, tracing, discovery, on-call): microservices will multiply toil faster than they help.',
    'Pure data pipelines with heavy intermediate data: one process or a stream processor, not a chain of services passing blobs.',
  ],

  interview: [
    {
      q: 'How do you decide service boundaries?',
      a: 'I look for bounded contexts: areas with their own language, rules and a single owning team, and I split along business capabilities rather than entities. The key test is data ownership — each service owns its data and others use its API or events — and how many services a top business operation must call synchronously. If most operations span several services, the boundaries are wrong. I start from a modular monolith and extract along seams that change independently.',
      followUps: ['How do you handle data that two contexts need?', 'What is an entity service and why is it a smell?', 'How would you migrate a shared table out of a monolith?'],
      seniorSignal: 'Ties boundaries to data ownership and change cadence and quantifies coupling via synchronous call counts.',
    },
    {
      q: 'Service A calls B, which calls C. How do you set timeouts and retries?',
      a: 'Propagate a deadline from the edge so each hop knows its remaining budget, and set per-hop timeouts that are strictly smaller than the caller’s. Retry at only one layer, only idempotent calls, with jittered backoff and a retry budget so retries cannot exceed ~10–20% of traffic. Use circuit breakers and fallbacks so B degrades when C fails. Verify the mesh and client libraries are not retrying on top of each other.',
      followUps: ['What breaks if C’s timeout is longer than B’s?', 'How do idempotency keys work?', 'How does a retry budget differ from a max-attempts setting?'],
      seniorSignal: 'Thinks about retries as load amplification across the whole graph, not a per-call reliability tweak.',
    },
    {
      q: 'How do you evolve an API without breaking consumers?',
      a: 'Additive changes only within a version: new optional fields with new numbers, never reuse or renumber fields, reserve removed ones, keep enum zero values. Enforce with breaking-change detection in CI and consumer-driven contract tests. Both old-client/new-server and new-client/old-server combinations must work because deploys overlap. For a real break, run v2 side by side and track per-consumer usage of v1 until it can be removed.',
      followUps: ['Is renaming a protobuf field safe?', 'How do you know who still uses v1?', 'What about semantic changes?'],
      seniorSignal: 'Considers both compatibility directions and semantic (not just structural) breaks.',
    },
    {
      q: 'Why does fan-out hurt tail latency and what do you do about it?',
      a: 'The response waits for the slowest backend, so per-backend tails compound: with 100 backends each slow 1% of the time, 63% of requests are slow. Mitigations: hedged or tied requests for idempotent reads, deadlines with partial results, reducing variance at backends (GC, background jobs), and setting backend SLOs at p99.9. Hedging needs a budget so it does not double load during incidents.',
      followUps: ['When does hedging make things worse?', 'How would you return partial results safely?', 'What percentile should a shard be held to?'],
      seniorSignal: 'Does the probability math and knows the Tail at Scale techniques with their costs.',
    },
    {
      q: 'What is a distributed monolith and how do you get out of one?',
      a: 'Services that cannot change or deploy independently: shared databases, lockstep releases, deep synchronous chains, shared domain libraries. You pay network costs without independence. To fix it, redraw boundaries around capabilities, give each service exclusive data ownership, replace synchronous chains with events and read models, or merge services that always change together back into one.',
      followUps: ['How do you detect it from data rather than opinions?', 'When is merging services the right call?', 'How does Conway’s law apply?'],
      seniorSignal: 'Willing to recommend fewer services and uses evidence (co-change, call depth) rather than ideology.',
    },
    {
      q: 'What does a service mesh give you, and what does it cost?',
      a: 'A sidecar (or node proxy) handles mTLS identity, load balancing, retries/timeouts, circuit breaking, traffic splitting and uniform golden metrics for every language, configured centrally via xDS. Costs: an extra ~0.5–2 ms per hop and CPU/memory per pod, operational complexity, and a control plane whose bad config is instantly global. It is worth it with many services and languages; with a few services in one language, a library is simpler.',
      followUps: ['What happens if istiod goes down?', 'How do mesh retries interact with app retries?', 'Sidecar vs ambient/sidecar-less?'],
      seniorSignal: 'Separates control-plane and data-plane failure modes and quantifies overhead.',
    },
  ],

  takeaways: [
    'Microservices scale organizations; adopt them when teams, not CPUs, are the bottleneck.',
    'Boundaries follow bounded contexts and data ownership — database per service is non-negotiable.',
    'Sync chains multiply failure and latency; use events for side effects and keep the critical path short.',
    'Contracts evolve additively in both directions; N and N−1 always coexist.',
    'Propagate deadlines; retry at one layer with a budget.',
    'Fan-out turns backend p99 into user median — hedge, set deadlines, return partial results.',
    'A distributed monolith is worse than a monolith; merging services back is a valid fix.',
  ],
};

export default deep;
