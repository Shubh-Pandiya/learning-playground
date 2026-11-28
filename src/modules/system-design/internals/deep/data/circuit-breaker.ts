import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'circuit-breaker',

  // ───────────────────────────── 1. PROBLEM ─────────────────────────────
  problem: {
    why:
      'In a call graph a **slow** dependency is worse than a dead one. Every in-flight call holds a thread, a connection and memory for the full timeout, so when a dependency slows from 50 ms to 5 s the caller’s in-flight work grows 100× (Little’s law: `in-flight = rps × latency`) and its pools run dry. A circuit breaker watches outcomes the caller already sees, detects **persistent** failure, and stops calling: 5-second failures become 50-microsecond failures, the caller’s resources are freed, and the callee gets the load drop it needs to recover.',
    withoutIt: [
      'Pool exhaustion: one slow dependency takes all 200 worker threads and unrelated endpoints of the caller go down too (cascading failure).',
      'The sick dependency never gets a break: callers keep sending full load plus retries, so its queues never drain.',
      'Every user waits the full timeout for an answer that is going to be an error anyway, instead of a fast degraded response.',
      'Retries have no stop signal: they keep hammering a failure that is clearly not transient.',
      'One bad instance behind a load balancer keeps receiving 1/N of traffic indefinitely without per-host ejection.',
    ],
    position:
      'In the caller, wrapping each outbound dependency: either an in-process library (Resilience4j, Polly, gobreaker) between business code and the HTTP/gRPC client, or the sidecar/proxy (Envoy `circuit_breakers` + `outlier_detection`). It sits around a timeout and alongside retries and a bulkhead.',
    diagram: {
      type: 'compare',
      title: 'Reviews service slows to 5 s',
      columns: [
        { name: 'No breaker, 30 s timeout', points: ['400 rps × 5 s = 2,000 in flight', '200-thread pool gone in 0.5 s', 'checkout also fails', 'reviews gets full load + retries'], tone: 'bad' },
        { name: 'Bulkhead + timeout + breaker', points: ['≤ 40 threads for reviews', 'timeout 300 ms, then open', 'calls fail in µs to fallback', 'reviews load drops to ~0'], tone: 'ok' },
      ],
      caption: 'The breaker’s value is mostly what it frees in the caller; the load relief for the callee is a bonus.',
    },
  },

  // ───────────────────────────── 2. ARCHITECTURE ─────────────────────────────
  architecture: {
    overview:
      'A breaker is a small **state machine** (CLOSED → OPEN → HALF_OPEN) fed by a **sliding window** of call outcomes. It never acts alone: a **timeout** turns hangs into countable failures, a **bulkhead** caps concurrency so damage is bounded before the window has enough data, a **retry** policy handles transient blips, and a **fallback** decides what the user gets when the call is not made. Libraries compose these as decorators; proxies implement the concurrency caps and per-host ejection.',
    diagram: {
      type: 'flow',
      title: 'Resilience4j decorator chain (default Spring aspect order)',
      nodes: [
        { label: 'Caller code', sub: 'business logic', tone: 'neutral' },
        { label: 'Retry', sub: 'budgeted, jittered backoff', tone: 'info' },
        { label: 'CircuitBreaker', sub: 'state + sliding window', tone: 'violet' },
        { label: 'TimeLimiter', sub: 'per-attempt timeout', tone: 'accent' },
        { label: 'Bulkhead', sub: 'semaphore or thread pool', tone: 'accent' },
        { label: 'Dependency', sub: 'HTTP / gRPC call', tone: 'ok' },
        { label: 'Fallback', sub: 'when not permitted', tone: 'warn' },
      ],
      caption: 'With Retry outermost every attempt is counted by the breaker, and `CallNotPermittedException` must be configured as non-retryable so an open breaker stops retries instantly.',
    },
    blocks: [
      {
        name: 'State machine',
        what: 'An atomic reference holding CLOSED, OPEN or HALF_OPEN (Resilience4j adds DISABLED, FORCED_OPEN and METRICS_ONLY for operations). Transitions use compare-and-set so concurrent calls agree on one transition and listeners fire once.',
      },
      {
        name: 'Count-based window',
        what: 'A circular array of the last N outcomes with running totals: on each call subtract the evicted outcome and add the new one — O(1) time, O(N) memory.',
      },
      {
        name: 'Time-based window',
        what: 'N partial aggregations, one per epoch second, summed for the last N seconds (Hystrix used 10 buckets over 10 s). Old buckets are reset lazily when their second comes round again.',
      },
      {
        name: 'Thresholds',
        what: '`failureRateThreshold`, `slowCallRateThreshold` with `slowCallDurationThreshold`, gated by `minimumNumberOfCalls` so three errors out of four calls at 3 a.m. do not trip it.',
      },
      {
        name: 'Open timer and half-open permits',
        what: '`waitDurationInOpenState` (optionally growing via an interval function) then HALF_OPEN with `permittedNumberOfCallsInHalfOpenState` probes; all other calls are still rejected while the probes run.',
      },
      {
        name: 'Outcome classifier',
        what: '`recordExceptions`, `ignoreExceptions` and a result predicate decide what counts. A `400` or `404` is the caller’s problem and must not count; timeouts, connection errors and `5xx` must.',
      },
      {
        name: 'Bulkhead',
        what: 'A semaphore (cheap, runs on the caller’s thread) or a dedicated bounded thread pool (can abandon a hung call) per dependency. Caps the blast radius from the very first second, before the breaker has statistics.',
      },
      {
        name: 'Event stream and metrics',
        what: 'State transitions, not-permitted calls and failure rates exported per breaker name; the open/closed state of every dependency is one of the most useful dashboards during an incident.',
      },
    ],
    real: [
      {
        name: 'Resilience4j',
        how: 'Lightweight Java library of decorators (CircuitBreaker, Retry, Bulkhead, TimeLimiter, RateLimiter). Defaults: COUNT_BASED window of 100 calls, `minimumNumberOfCalls` 100, `failureRateThreshold` 50%, `slowCallRateThreshold` 100% at `slowCallDurationThreshold` 60 s, `waitDurationInOpenState` 60 s, 10 permitted calls in half-open. Lock-free ring buffers; Micrometer metrics out of the box.',
      },
      {
        name: 'Netflix Hystrix',
        how: 'Each dependency call is a `HystrixCommand` run on a per-dependency thread pool (default `coreSize` 10) or under a semaphore. A 10 s rolling window of 1 s buckets trips at ≥ 20 requests (`requestVolumeThreshold`) and ≥ 50% errors, with a 5 s sleep window and a 1,000 ms default timeout. In maintenance mode since 2018; Netflix pointed users to Resilience4j and moved toward adaptive concurrency limits.',
      },
      {
        name: 'Envoy',
        how: '`circuit_breakers` are **concurrency caps** per upstream cluster and priority — `max_connections`, `max_pending_requests`, `max_requests` (all default 1024) and `max_retries` (default 3) — that overflow instantly with a 503. `outlier_detection` is the per-host breaker: eject a host after e.g. 5 consecutive 5xx for `base_ejection_time × times ejected`, capped by `max_ejection_percent`.',
      },
      {
        name: 'Polly v8 (.NET)',
        how: 'A resilience pipeline of strategies (retry, circuit breaker, timeout, rate limiter, hedging). Circuit breaker defaults: `FailureRatio` 0.1, `MinimumThroughput` 100, `SamplingDuration` 30 s, `BreakDuration` 5 s — a time-based window with throughput gating.',
      },
      {
        name: 'gobreaker (Go)',
        how: 'Minimal state machine: `Settings{MaxRequests, Interval, Timeout, ReadyToTrip}`. Defaults trip after more than 5 consecutive failures, stay open 60 s, allow 1 half-open request; `Interval` periodically clears counts while closed.',
      },
    ],
  },

  // ───────────────────────────── 3. LIFECYCLE ─────────────────────────────
  lifecycle: {
    summary:
      'One call from checkout to the reviews service through a Resilience4j chain. Everything except the network call costs microseconds; when the breaker is open the whole call costs the fallback.',
    stages: [
      { stage: 'Retry wrapper', what: 'Attempt 1 of at most 2; checks the retry budget before any later attempt.', cost: 'Object allocation, counter check', ms: 0.01, part: 'gate' },
      { stage: 'Breaker permission', what: 'Atomic read of state: CLOSED → permitted. OPEN → `CallNotPermittedException` thrown immediately.', cost: 'One volatile read / CAS', ms: 0.01, part: 'gate' },
      { stage: 'Bulkhead acquire', what: 'Takes 1 of 40 semaphore permits for `reviews`; if none are free the call is rejected now rather than queued.', cost: 'Semaphore tryAcquire', ms: 0.01, part: 'bulkhead' },
      { stage: 'Timeout armed', what: 'TimeLimiter schedules a 300 ms cancellation on a timer wheel; the HTTP client also has connect (100 ms) and read timeouts.', cost: 'Timer scheduling', ms: 0.02, part: 'timeout' },
      { stage: 'Network call', what: 'Pooled HTTP/2 connection to a reviews pod; typical p50 latency.', cost: '1 RTT + server time', ms: 40, part: 'timeout' },
      { stage: 'Record outcome', what: 'Success, failure, or slow (above `slowCallDurationThreshold`) written into the current window bucket.', cost: 'O(1) ring-buffer update', ms: 0.01, part: 'window' },
      { stage: 'Evaluate thresholds', what: 'If calls ≥ minimum and failure or slow rate ≥ threshold, CAS to OPEN and publish a state-transition event.', cost: 'Two divisions', ms: 0.01, part: 'trip' },
      { stage: 'Fallback (open path)', what: 'When not permitted: serve reviews from a local cache or render “reviews unavailable”.', cost: 'In-memory cache read', ms: 0.05, part: 'fallback' },
    ],
  },

  // ───────────────────────────── 4. DEEP DIVES ─────────────────────────────
  deepDives: [
    {
      title: 'The state machine and its thresholds',
      hook: 'Five numbers decide whether it trips on an outage or on noise.',
      body: [
        '**CLOSED**: every call is permitted and recorded. Once at least `minimumNumberOfCalls` are in the window, the breaker computes the failure rate and the slow-call rate; if either is at or above its threshold it moves to **OPEN**.',
        '**OPEN**: every call is rejected immediately for `waitDurationInOpenState`. After it elapses (on the next call, or automatically with `automaticTransitionFromOpenToHalfOpenEnabled`) it goes **HALF_OPEN**.',
        '**HALF_OPEN**: exactly `permittedNumberOfCallsInHalfOpenState` probe calls go through; others are rejected. When the probes complete, Resilience4j recomputes the rates over them: at or above threshold → OPEN again, below → CLOSED with a fresh window.',
        'The **slow-call rate** is what makes a breaker useful for brownouts. A dependency that answers in 4 s with `200 OK` has a 0% failure rate; only a slow-call threshold (or a timeout that converts it into a failure) lets the breaker see it.',
      ],
      diagram: {
        type: 'flow',
        title: 'Transitions',
        nodes: [
          { label: 'CLOSED', sub: 'record every outcome', tone: 'ok' },
          { label: 'rate ≥ threshold', sub: 'after minimum calls', tone: 'warn' },
          { label: 'OPEN', sub: 'reject for wait duration', tone: 'bad' },
          { label: 'HALF_OPEN', sub: 'N probe calls only', tone: 'info' },
          { label: 'CLOSED or OPEN', sub: 'rate over the probes', tone: 'violet' },
        ],
      },
      code: {
        lang: 'yaml',
        caption: 'Resilience4j (Spring Boot) tuned for a 400 rps-per-instance dependency.',
        code: `resilience4j.circuitbreaker:
  instances:
    reviews:
      slidingWindowType: TIME_BASED
      slidingWindowSize: 10                 # seconds
      minimumNumberOfCalls: 50
      failureRateThreshold: 50
      slowCallDurationThreshold: 1s
      slowCallRateThreshold: 80
      waitDurationInOpenState: 20s
      permittedNumberOfCallsInHalfOpenState: 5
      automaticTransitionFromOpenToHalfOpenEnabled: true
      recordExceptions:
        - java.io.IOException
        - java.util.concurrent.TimeoutException
      ignoreExceptions:
        - com.example.reviews.ClientErrorException   # 4xx: caller's fault`,
      },
      insight:
        '`minimumNumberOfCalls` is evaluated **per caller instance**. A service with 300 instances each doing 1 rps toward a dependency sees 10 calls per 10 s window per instance — a minimum of 100 means the breaker can never trip, however bad the outage.',
    },
    {
      title: 'Count-based vs time-based windows',
      hook: 'The window decides how fast it reacts and how stale its memory is.',
      body: [
        'A **count-based** window of N remembers the last N calls regardless of when they happened. At high, steady traffic it is predictable. At low traffic it remembers failures from an hour ago — or after a quiet night it trips on a handful of old errors plus a few new ones.',
        'A **time-based** window sums per-second buckets over the last T seconds, so it reflects “now” regardless of volume. At low volume it rarely reaches the minimum number of calls and simply never trips. Hystrix used this model with ten 1-second buckets.',
      ],
      table: {
        caption: 'Choosing a window',
        columns: ['Window', 'Data structure', 'Good at', 'Bad at'],
        rows: [
          ['Count-based (N calls)', 'Ring buffer of N outcomes', 'Stable stats at high, steady rps', 'Stale memory at low traffic'],
          ['Time-based (T seconds)', 'T per-second buckets', 'Bursty traffic, reacts to “now”', 'Never reaches minimum at low rps'],
          ['Consecutive failures (gobreaker)', 'One counter', 'Simple, low traffic', 'One success hides a 90% error rate'],
        ],
      },
      insight:
        'For low-volume dependencies a breaker adds little: rely on tight timeouts, a small bulkhead and alerting. Breakers earn their keep where traffic is high enough that a window of 10 s holds dozens of calls per instance.',
    },
    {
      title: 'Timeouts are the foundation',
      hook: 'A breaker can only react to failures that a timeout surfaces.',
      body: [
        'Without a timeout a hung call is not a failure, it is just “in progress” — the window stays empty while threads exhaust. Java’s `HttpURLConnection` defaults to **infinite** connect and read timeouts; many drivers default to tens of seconds. Set a **connect timeout** (tens to a few hundred ms) and a **request timeout** near the dependency’s p99.9, always smaller than the caller’s own remaining deadline.',
        'Little’s law gives the stakes. At 400 rps a 40 ms dependency needs 16 concurrent calls; at a 30 s timeout during a hang it needs 12,000. The timeout bounds the worst case per call; the bulkhead bounds the worst case in total; the breaker removes the load once the pattern is clear.',
        'Propagate deadlines, not just timeouts: gRPC sends the remaining deadline with the call so downstream services stop working on requests the caller has already abandoned.',
      ],
      bullets: [
        'Per-attempt timeout × attempts + backoff must fit in the caller’s deadline.',
        'Inner timeouts must be shorter than outer ones; otherwise the inner work outlives the request (zombie work).',
        'Count timeouts as failures and slow successes as slow calls.',
      ],
      insight:
        'Most “the breaker didn’t help” incidents are really “there was no effective timeout”. Audit the client libraries’ defaults before tuning breaker thresholds.',
    },
    {
      title: 'Bulkheads and Hystrix’s thread pools',
      hook: 'A bulkhead limits damage from the first second; a breaker needs a window of failures first.',
      body: [
        'Hystrix ran every dependency call on a **dedicated thread pool** (default 10 threads, no queue by default). If the dependency hung, only its 10 threads blocked; the request thread could time out and walk away because the work ran elsewhere. Netflix ran this for billions of calls a day and accepted the context-switch overhead as the price of isolation.',
        '**Semaphore isolation** runs the call on the caller’s thread and just counts permits. It is nearly free but cannot abandon a blocked call — it relies on the client library’s own timeouts. Resilience4j offers both (`SemaphoreBulkhead`, `FixedThreadPoolBulkhead`); in reactive or virtual-thread code semaphores are the norm.',
        'Hystrix went into maintenance in 2018. Static per-dependency pool sizes and thresholds were hard to tune across hundreds of services; Netflix moved toward **adaptive** concurrency limits that infer the right limit from latency.',
      ],
      diagram: {
        type: 'compare',
        title: 'Isolation styles',
        columns: [
          { name: 'Thread-pool bulkhead', points: ['call runs on pool thread', 'caller can abandon hung call', 'extra context switch', 'Hystrix default'], tone: 'info' },
          { name: 'Semaphore bulkhead', points: ['call on caller thread', 'near-zero overhead', 'needs client timeouts', 'reactive / virtual threads'], tone: 'ok' },
          { name: 'Adaptive limit', points: ['limit from latency', 'no static tuning', 'Netflix concurrency-limits', 'server or client side'], tone: 'violet' },
        ],
      },
      insight:
        'If you can only have one, have the bulkhead plus a timeout. They bound the damage deterministically; the breaker optimises the steady state of a long outage.',
    },
    {
      title: 'Envoy: circuit breaking vs outlier detection',
      hook: 'Envoy’s “circuit breaker” is a concurrency cap; its real breaker is outlier detection.',
      body: [
        '`circuit_breakers` thresholds are per upstream cluster, per priority, **per Envoy instance**. When `max_pending_requests` or `max_requests` is exceeded the request fails immediately with a 503 and `x-envoy-overloaded`, and counters like `upstream_rq_pending_overflow` increment. There is no open/half-open state — it is a bulkhead.',
        '`outlier_detection` is the per-host breaker: after `consecutive_5xx` (default 5) a host is ejected from the load-balancing set for `base_ejection_time` (default 30 s) multiplied by how many times it has been ejected, scanned every `interval` (10 s). `max_ejection_percent` (default 10%) caps how much of the cluster can be ejected, though at least one host can always be ejected.',
        'If healthy hosts drop below `healthy_panic_threshold` (default 50%), Envoy enters **panic mode** and balances across all hosts, ejected or not — deliberately preferring degraded service to sending all traffic to a few survivors.',
      ],
      diagram: {
        type: 'compare',
        title: 'Two mechanisms, two scopes',
        columns: [
          { name: 'circuit_breakers', points: ['per cluster, per proxy', 'caps conns / pending / rq / retries', 'overflow ⇒ instant 503', 'protects the caller'], tone: 'accent' },
          { name: 'outlier_detection', points: ['per host', 'consecutive 5xx / success rate', 'eject for 30 s × n', 'protects users from a bad pod'], tone: 'violet' },
        ],
      },
      code: {
        lang: 'yaml',
        caption: 'Envoy cluster: caps, retry budget and per-host ejection.',
        code: `clusters:
- name: reviews
  circuit_breakers:
    thresholds:
    - priority: DEFAULT
      max_connections: 1024
      max_pending_requests: 1024
      max_requests: 1024
      retry_budget:                       # overrides max_retries when set
        budget_percent: { value: 20.0 }
        min_retry_concurrency: 3
  outlier_detection:
    consecutive_5xx: 5
    interval: 10s
    base_ejection_time: 30s
    max_ejection_percent: 50
    enforcing_success_rate: 100`,
      },
      insight:
        'These limits are per sidecar. 1,000 caller pods × `max_requests: 1024` allows a million concurrent requests toward a service — mesh circuit breakers protect each caller, not the callee. The callee still needs its own concurrency limit.',
    },
    {
      title: 'Fallbacks and why they are dangerous',
      hook: 'A fallback is a second code path that only runs during an incident.',
      body: [
        'Good fallbacks are cheap and local: a stale cached value, a static default, hiding a non-critical widget, or accepting a write into a durable queue for later. Bad fallbacks call **another** remote system — often the database behind the cache that just failed — which turns one outage into two (a fallback stampede).',
        'Fallbacks are rarely exercised, so they rot: wrong data, missing permissions, untested load. Amazon’s Builders’ Library (“Avoiding fallback in distributed systems”) argues for making the primary path more robust, pushing data proactively and failing fast, rather than relying on code that only runs in emergencies.',
        'Some fallbacks are silently wrong: authorization that defaults to “allow”, a pricing service that defaults to the list price, a fraud score that defaults to “safe”. For those, a fast, explicit error is the correct fallback.',
      ],
      bullets: [
        'Cached/stale: best for read-heavy, tolerance for staleness (catalog, reviews).',
        'Static default: recommendations → top sellers list shipped with the build.',
        'Degraded feature: hide the module, keep the page.',
        'Deferred write: enqueue durably, process when healthy (with idempotency).',
        'Fail fast: correctness-critical decisions (auth, payments, fraud).',
      ],
      insight:
        'Exercise fallbacks continuously — force a small percentage of traffic through them or run chaos experiments — or assume they do not work.',
    },
    {
      title: 'Per-host vs per-service breakers, retries and load balancers',
      hook: 'A service-level breaker punishes nine healthy pods for one bad one.',
      body: [
        'A breaker keyed on the **service** (one logical endpoint behind a load balancer) sees the blended error rate. If one of ten pods returns 100% errors, the service-level failure rate is 10% — below most thresholds, so users keep seeing 10% errors; if the threshold is low it opens for everyone. Per-host ejection (client-side LB or mesh outlier detection) removes the bad pod and leaves the rest serving.',
        'Use both, at different layers: per-host ejection in the LB/mesh for single-instance faults, and a per-dependency breaker in the application for whole-service outages and to drive the fallback.',
        'Retries interact with both. Retrying to a different host is how per-host faults get hidden; retries during a whole-service outage are pure amplification. Bound retries with a budget, make the breaker see every attempt, and never retry `CallNotPermittedException` or an Envoy overflow 503 (`x-envoy-overloaded`).',
      ],
      table: {
        caption: 'Signals worth a dashboard',
        columns: ['Metric', 'Source', 'What it tells you'],
        rows: [
          ['`resilience4j_circuitbreaker_state`', 'Resilience4j / Micrometer', 'Which dependencies are open right now'],
          ['`resilience4j_circuitbreaker_not_permitted_calls_total`', 'Resilience4j', 'Calls short-circuited to fallback'],
          ['`resilience4j_bulkhead_available_concurrent_calls`', 'Resilience4j', 'Headroom before rejections'],
          ['`upstream_rq_pending_overflow`, `upstream_cx_overflow`', 'Envoy cluster stats', 'Caps hit — may be your config, not the callee'],
          ['`outlier_detection.ejections_active`', 'Envoy cluster stats', 'Hosts currently ejected'],
        ],
      },
      insight:
        'Interpret the breaker as a symptom, not a root cause: an open breaker on a dependency whose own dashboards look green usually means the caller’s timeout, bulkhead or classifier is wrong.',
    },
  ],

  // ───────────────────────────── 5. SCALING ─────────────────────────────
  scaling: {
    body: [
      'Breakers are deliberately **per caller instance** with no shared state: nothing to coordinate, nothing to fail. The consequence is statistical — 200 instances trip at slightly different moments, each from its own sample — which is fine at high traffic and useless at low traffic where no instance has enough samples.',
      'Distributed (shared-state) breakers are rarely worth it: they add a dependency on the failure path, and a shared state store that is itself slow re-creates the problem. Prefer per-instance breakers plus server-side protection (concurrency limits, shedding) on the callee.',
      'In a mesh, thresholds are control-plane config (Istio `DestinationRule` `connectionPool` and `outlierDetection`) pushed over xDS; during a rollout, sidecars briefly run different thresholds. Multi-region: keep breakers and ejection per zone/region endpoint set, and let locality-aware load balancing fail over — Istio’s locality failover only works when outlier detection is configured.',
    ],
    bullets: [
      'Breaker state is per process: a deploy resets every breaker to CLOSED, which can send a fresh wave at a still-sick dependency.',
      'Half-open probes from N instances arrive together after the same wait: add jitter to the open duration or grow it on repeated trips.',
      'Size Envoy `max_requests` from Little’s law for peak rps × p99 latency per sidecar, not the default 1024.',
      'Outlier detection with few hosts: ejecting 1 of 3 removes 33% capacity; check `max_ejection_percent` and panic threshold together.',
      'Export breaker state per dependency per zone so an incident commander can see the blast radius at a glance.',
    ],
    diagram: {
      type: 'layers',
      title: 'Where each protection lives',
      layers: [
        { name: 'Control plane', items: ['Istio / xDS config', 'thresholds per dependency', 'rollout in seconds'], tone: 'info' },
        { name: 'Caller process', items: ['timeout', 'bulkhead', 'breaker + fallback', 'retry budget'], tone: 'violet' },
        { name: 'Caller sidecar', items: ['conn / request caps', 'outlier ejection', 'locality failover'], tone: 'accent' },
        { name: 'Callee', items: ['concurrency limit', 'load shedding', 'deadline checks'], tone: 'ok' },
      ],
    },
  },

  // ───────────────────────────── 6. FAILURES ─────────────────────────────
  failures: [
    {
      name: 'Breaker never trips',
      symptom: 'Dependency is returning 100% errors or hanging, but all breakers stay CLOSED and callers’ thread pools are saturated.',
      detect: '`resilience4j_circuitbreaker_state{state="closed"}` = 1 while dependency 5xx rate is high; `resilience4j_circuitbreaker_buffered_calls` below `minimumNumberOfCalls`; worker pool active = max.',
      mitigate: 'Add/tighten timeouts; size minimum calls per instance traffic; use time-based windows; add a bulkhead.',
    },
    {
      name: 'Flapping',
      symptom: 'Breaker opens and closes every few seconds; users see intermittent errors and the callee sees bursty load.',
      detect: 'State-transition events per minute per breaker; sawtooth in `not_permitted_calls`.',
      mitigate: 'Raise minimum calls; more half-open probes; exponentially growing open duration; jitter the wait.',
    },
    {
      name: 'Trips on client errors',
      symptom: 'A caller bug sends invalid requests; 4xx responses open the breaker and block valid traffic too.',
      detect: 'Failure rate dominated by 4xx status codes or validation exceptions; breaker opens while callee’s 5xx rate is zero.',
      mitigate: '`ignoreExceptions` for client errors; result predicate that records only 5xx, timeouts and connection errors.',
    },
    {
      name: 'One bad host opens the service breaker',
      symptom: 'One of ten pods is broken; the service-level breaker opens and all ten stop receiving traffic.',
      detect: 'Errors concentrated on one upstream host (`upstream_rq_5xx` per host / per-pod error rate).',
      mitigate: 'Per-host outlier detection in the LB/mesh; breaker per dependency only for whole-service outages.',
    },
    {
      name: 'Fallback stampede',
      symptom: 'Cache cluster fails, breaker opens, fallback reads from the database, the database melts.',
      detect: 'DB QPS jumps exactly when `not_permitted_calls` rises; fallback invocation rate metric.',
      mitigate: 'Local/static fallbacks only; cap fallback concurrency with its own bulkhead; fail fast for expensive fallbacks.',
    },
    {
      name: 'Proxy caps mistaken for callee failure',
      symptom: 'After moving to a mesh, a traffic spike yields 503s even though the callee is healthy.',
      detect: '`upstream_rq_pending_overflow` / `upstream_rq_overflow` increasing; responses carry `x-envoy-overloaded`.',
      mitigate: 'Size `circuit_breakers` from peak rps × latency; alert on overflow counters separately from upstream 5xx.',
    },
  ],

  warStories: [
    {
      title: 'DynamoDB metadata service retry storm',
      source: 'AWS, “Summary of the Amazon DynamoDB Service Disruption” (US-East-1, September 2015)',
      what: 'A brief network disruption made many storage servers re-request their partition membership from the metadata service at the same time. Membership lists had grown (Global Secondary Indexes), so responses took longer than the storage servers’ timeout; they treated it as failure, took themselves out of service and retried — keeping the metadata service overloaded. AWS had to pause requests to the metadata service to add capacity; the disruption lasted hours and spilled into SQS, EC2 Auto Scaling and CloudWatch.',
      lesson: 'Tight timeouts plus unbounded retries against a shared control service create a self-sustaining overload. Callers need breakers/backoff and the control service needs headroom and admission control.',
    },
    {
      title: 'Why Netflix built Hystrix',
      source: 'Netflix Tech Blog, “Fault Tolerance in a High Volume, Distributed System” (2012) and Hystrix wiki',
      what: 'The Netflix API fanned out to dozens of dependencies. Their arithmetic: 30 dependencies at 99.99% each gives 99.7% for the whole, about 3M failures per billion requests and over 2 hours of downtime a month. Worse, one latent dependency saturated all request threads. Hystrix wrapped every call in a timeout, a per-dependency thread pool, a breaker and a fallback.',
      lesson: 'Isolation (bulkheads + timeouts) is the primary defence; the breaker and fallback come on top. Availability of a fan-out service is the product of its dependencies unless you isolate them.',
    },
    {
      title: 'The fallback that took down the database',
      source: 'Composite of common incidents',
      what: 'A product service read prices from Redis with a breaker whose fallback was “read from Postgres”. A Redis cluster failover opened the breaker on every instance at once; 40k rps of fallback reads hit a Postgres sized for 2k rps of cache misses, and checkout failed for 25 minutes after Redis was back because the database queue never drained.',
      lesson: 'A fallback that calls a shared, smaller system is a second outage waiting to happen. Bound fallbacks with their own bulkhead or make them local.',
    },
    {
      title: 'Default mesh limits at launch traffic',
      source: 'Composite of common incidents',
      what: 'A team migrated to a service mesh without touching cluster circuit-breaker settings. On a launch day the gateway sidecar exceeded the default pending/request caps toward one backend and returned bursts of 503 with `x-envoy-overloaded` while the backend sat at 30% CPU; dashboards showed “backend errors”, so the team scaled the backend, which did nothing.',
      lesson: 'Know which layer produced a 503. Alert on proxy overflow counters separately and size proxy caps from Little’s law.',
    },
  ],

  // ───────────────────────────── 7. NUMBERS ─────────────────────────────
  numbers: [
    { label: 'Resilience4j defaults', value: '50% / 100 calls / 60 s', note: 'failure threshold / window & minimum calls / open wait; 10 half-open calls' },
    { label: 'Hystrix defaults', value: '20 req / 50% / 5 s', note: 'volume threshold / error % / sleep window; 10 s window, 1,000 ms timeout, pool 10' },
    { label: 'Polly v8 defaults', value: '0.1 / 100 / 30 s / 5 s', note: 'failure ratio / min throughput / sampling / break duration' },
    { label: 'Envoy circuit_breakers', value: '1024 / 1024 / 1024 / 3', note: 'connections / pending / requests / retries per cluster per proxy' },
    { label: 'Envoy outlier defaults', value: '5 × 5xx, 30 s, 10%', note: 'consecutive 5xx, base ejection time, max ejection %, 10 s interval' },
    { label: 'Envoy panic threshold', value: '50% healthy', note: 'below it, balance across all hosts' },
    { label: 'Open-state rejection', value: '~µs', note: 'vs hundreds of ms for a timed-out call' },
    { label: 'Fan-out availability', value: '99.99%^30 ≈ 99.7%', note: 'without isolation, dependencies multiply' },
    { label: 'Little’s law', value: '400 rps × 5 s = 2,000', note: 'in-flight calls when a dependency slows to 5 s' },
  ],
  capacity: {
    question:
      'Checkout runs 400 rps per instance on a 200-thread pool and calls Reviews (p50 40 ms, p99 300 ms). Size the timeout, bulkhead and breaker so Reviews hanging cannot take checkout down.',
    steps: [
      'Normal concurrency toward Reviews: 400 × 0.04 s = 16 in flight; bursts toward p99 need more headroom ⇒ bulkhead of 40 permits.',
      'Timeout at ~p99.9, say 300 ms. If Reviews hangs: 400 × 0.3 = 120 would be in flight; the bulkhead admits 40 and rejects the rest instantly ⇒ at most 40 of 200 threads are lost.',
      'Without timeout or bulkhead (30 s default): 400 × 30 = 12,000 in flight ⇒ the 200-thread pool is gone in half a second.',
      'Breaker: time-based 10 s window holds ~4,000 calls; with `minimumNumberOfCalls` 50 and 50% threshold it trips within the first ~0.5 s of a hard outage.',
      'Open for 20 s: Reviews gets ~0 rps from this instance; then 5 half-open probes decide whether to close.',
    ],
    answer:
      'Timeout 300 ms, bulkhead 40, time-based breaker (10 s, min 50 calls, 50%), 20 s open with 5 probes, and a cached fallback. Worst case checkout loses 20% of its threads for under a second, then none.',
  },

  // ───────────────────────────── 8. COMPARISON ─────────────────────────────
  comparison: {
    caption: 'Circuit-breaking implementations',
    columns: ['Product', 'Model', 'Window / trigger', 'Scope', 'Isolation', 'Status'],
    rows: [
      ['Resilience4j', 'CLOSED/OPEN/HALF_OPEN + slow calls', 'Count or time window, failure & slow-call rate', 'Per breaker name in process', 'Semaphore or thread-pool bulkhead', 'Active (JVM default)'],
      ['Hystrix', 'Breaker per command', '10 s rolling, ≥ 20 req, ≥ 50% errors', 'Per command key', 'Thread pool per dependency', 'Maintenance since 2018'],
      ['Envoy circuit_breakers', 'Concurrency caps, no states', 'Instant overflow', 'Per cluster per proxy', 'Is the bulkhead', 'Active'],
      ['Envoy outlier_detection', 'Per-host ejection', 'Consecutive 5xx, success-rate stats', 'Per upstream host', 'LB removes host', 'Active'],
      ['Polly v8', 'Breaker strategy in pipeline', 'Failure ratio over sampling duration', 'Per pipeline', 'Separate concurrency limiter', 'Active (.NET)'],
      ['gobreaker', 'Minimal state machine', 'Consecutive failures (pluggable)', 'Per breaker instance', 'None built in', 'Active (Go)'],
    ],
  },
  whenNot: [
    'Low-volume calls (a few per minute): statistics never become meaningful; use timeouts, backoff with jitter and alerting instead.',
    'Queue consumers: pause or slow consumption (backpressure) and let the queue buffer; nacking messages from an open breaker causes redelivery storms.',
    'Calls whose failure is deterministic and local (bad input, local disk, in-process library): a breaker adds nothing a proper error does not.',
    'Writes that must not be dropped (ledger, orders): do not “fall back” to skipping them — fail fast to the user or write to a durable outbox for later.',
    'As the callee’s overload protection: client breakers are voluntary and per instance; the server needs its own concurrency limits and load shedding.',
  ],

  // ───────────────────────────── 9. INTERVIEW ─────────────────────────────
  interview: [
    {
      q: 'Walk through the circuit breaker state machine and how you would choose its thresholds.',
      a: 'CLOSED records outcomes in a sliding window; once there are at least minimumNumberOfCalls, a failure or slow-call rate at or above threshold opens it. OPEN rejects immediately for a wait duration, then HALF_OPEN lets a fixed number of probes through and decides from their results. I size the window and minimum from per-instance traffic so the breaker can actually trip within seconds, include a slow-call threshold for brownouts, and classify only timeouts, connection errors and 5xx as failures.',
      followUps: ['What happens with 300 instances at 1 rps each?', 'Count- or time-based window here?', 'How do you avoid flapping?'],
      seniorSignal: 'Reasons about thresholds per instance and about slow calls, not only error counts.',
    },
    {
      q: 'How do timeouts, retries, bulkheads and circuit breakers fit together?',
      a: 'Timeout bounds one attempt and converts hangs into failures; bulkhead bounds total concurrency per dependency from the first second; retries handle transient errors with jittered backoff under a budget; the breaker stops all attempts when failure is persistent and routes to a fallback. Ordering varies — Resilience4j’s default puts Retry outermost so each attempt is recorded — but the invariant is that an open breaker sends nothing on the wire and is never retried.',
      followUps: ['Which is most important if you can have only one?', 'Where does deadline propagation fit?', 'Should the breaker count each retry attempt?'],
      seniorSignal: 'Explains invariants rather than reciting one fixed order, and puts timeouts and bulkheads first.',
    },
    {
      q: 'Envoy has circuit breakers and outlier detection. What is the difference?',
      a: 'Envoy circuit_breakers are per-cluster, per-proxy concurrency caps on connections, pending requests, requests and retries; exceeding them gives an immediate 503 with x-envoy-overloaded. Outlier detection is a per-host breaker that ejects hosts after consecutive 5xx or poor success rate, for a growing ejection time, limited by max_ejection_percent and the panic threshold. The first protects the caller’s proxy; the second protects users from one bad instance.',
      followUps: ['Why do these limits not protect the callee?', 'What is panic mode?', 'How do you size max_requests?'],
      seniorSignal: 'Notes the limits are per sidecar, so they multiply with caller count.',
    },
    {
      q: 'Why did Hystrix use thread pools, and why did the industry move away?',
      a: 'Thread-pool isolation let a caller abandon a hung call and capped each dependency’s share of threads, which mattered for blocking I/O with unreliable timeouts. The cost was context switches, static pool sizes and many knobs to tune per dependency. With better client timeouts, reactive and virtual-thread runtimes, semaphores became sufficient, and adaptive concurrency limits replaced static tuning; Hystrix entered maintenance in 2018.',
      followUps: ['When is a thread-pool bulkhead still the right choice?', 'What does an adaptive limiter measure?'],
      seniorSignal: 'Connects the design to the runtime model (blocking I/O) and explains the operational cost of static tuning.',
    },
    {
      q: 'Your fallback reads from the database when the cache breaker is open. Good idea?',
      a: 'Usually not. The breaker opens on every instance at once, so the fallback sends the full read load to a database sized only for cache misses, creating a second outage. Prefer local or static fallbacks, stale data from a local cache, or failing fast; if a remote fallback is unavoidable, give it its own small bulkhead and test it under load regularly.',
      followUps: ['What fallbacks are safe for authorization or pricing?', 'How do you know a fallback still works?'],
      seniorSignal: 'Recognises correlated activation across the fleet and that rarely-run code paths rot.',
    },
    {
      q: 'One of ten pods behind a service starts failing. What should happen, and what does a service-level breaker do?',
      a: 'Ideally the bad pod is ejected by per-host outlier detection in the client-side load balancer or mesh, and the remaining nine serve all traffic. A service-level breaker sees a blended 10% failure rate: either it stays closed and users keep getting 10% errors, or, if sensitive, it opens and blocks all ten. Use per-host ejection for instance faults and the per-dependency breaker for whole-service outages.',
      followUps: ['How does retrying on another host interact with this?', 'What if three of ten fail?'],
      seniorSignal: 'Separates instance-level and service-level failure and assigns each to the right layer.',
    },
  ],

  takeaways: [
    'A slow dependency is worse than a dead one: Little’s law turns latency into exhausted pools.',
    'Timeouts and bulkheads come first; the breaker only sees failures the timeout surfaces.',
    'Use failure-rate and slow-call-rate thresholds gated by a minimum number of calls sized per caller instance.',
    'Envoy circuit_breakers are per-proxy concurrency caps; outlier detection is the per-host breaker.',
    'Fallbacks must be cheap and local; a remote fallback activated fleet-wide is a second outage.',
    'Never retry a short-circuited call; an open breaker must mean nothing goes on the wire.',
    'Client-side breakers protect callers; callees still need their own concurrency limits and shedding.',
  ],
};

export default deep;
