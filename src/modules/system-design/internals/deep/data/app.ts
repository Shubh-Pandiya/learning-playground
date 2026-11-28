import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'app',

  problem: {
    why:
      'An app server turns HTTP/gRPC requests into responses by running business logic against state that lives elsewhere. The whole point of the tier is to be **disposable and interchangeable**: if no request depends on what a previous request left in this process’s memory or disk, any instance can serve any request, so you scale by adding copies and survive failures by killing them. Almost every hard problem in this tier — sizing, deploys, health, tail latency — is about keeping that property true under load.',
    withoutIt: [
      'Sessions or uploads kept in local memory/disk: users are logged out or lose files whenever the LB moves them or an instance dies.',
      'No graceful shutdown: every rolling deploy produces a burst of 502/503s as in-flight requests are cut off.',
      'Unbounded threads or pools: a slow dependency turns into thread starvation and a fleet-wide outage instead of a few failed requests.',
      'Liveness probes that check the database: a DB blip makes Kubernetes restart every pod at once, turning a 30 s hiccup into a 10 min outage.',
      'Pool size × instance count above the DB’s `max_connections`: autoscaling out takes the database down.',
    ],
    position:
      'Sits behind the load balancer / API gateway and in front of caches, databases, queues and other services. It owns compute, not data: every byte of durable or shared state is one network hop away.',
    diagram: {
      type: 'flow',
      title: 'Where the app tier sits',
      nodes: [
        { label: 'Load balancer', sub: 'health-checked pool', tone: 'neutral' },
        { label: 'App instance ×N', sub: 'stateless, identical', tone: 'accent' },
        { label: 'Redis', sub: 'sessions, cache', tone: 'info' },
        { label: 'Postgres', sub: 'durable state', tone: 'violet' },
        { label: 'S3 / queue', sub: 'files, async work', tone: 'info' },
      ],
      caption: 'Anything the instance would need after a restart must live to the right of it.',
    },
  },

  architecture: {
    overview:
      'Inside one instance: a listener accepts connections, a **concurrency model** (thread pool, event loop or virtual threads) schedules requests, a middleware chain applies cross-cutting concerns, the handler runs domain logic, and **connection pools** multiplex requests onto a small number of warm connections to backing services. Around it sits a **lifecycle** layer — probes, signal handling, config/secrets loading — that the orchestrator uses to start, route to, and stop it safely.',
    diagram: {
      type: 'layers',
      title: 'Anatomy of one app instance',
      layers: [
        { name: 'Edge of process', items: ['Listener / acceptor', 'TLS (often at LB)', 'HTTP/1.1, h2 parser'], tone: 'neutral' },
        { name: 'Scheduling', items: ['Thread pool', 'Event loop', 'Virtual threads', 'Accept queue'], tone: 'accent' },
        { name: 'Request pipeline', items: ['Auth / tracing', 'Rate limit', 'Router', 'Handler'], tone: 'ok' },
        { name: 'Outbound', items: ['DB pool (Hikari)', 'HTTP client pool', 'Redis pool', 'Timeouts, breakers'], tone: 'info' },
        { name: 'Lifecycle', items: ['/livez /readyz', 'SIGTERM drain', 'Config + secrets', 'Metrics endpoint'], tone: 'violet' },
      ],
      caption: 'Requests flow top-down; lifecycle hooks are what the orchestrator talks to.',
    },
    blocks: [
      { name: 'Listener + accept queue', what: 'Kernel listen backlog (`somaxconn`) plus the server’s own queue (Tomcat `acceptCount` default 100). When workers are saturated, requests wait here — invisible to handler-level latency metrics.' },
      { name: 'Worker model', what: 'Tomcat NIO: a poller hands ready sockets to a 200-thread pool (`server.tomcat.threads.max`). Node: one libuv event loop per process. Go: one goroutine per connection, M:N scheduled. Java 21: virtual threads mounted on a ForkJoinPool of carrier threads.' },
      { name: 'Middleware chain', what: 'Ordered filters: request id, W3C `traceparent`, authn (JWT verify ~0.05 ms), authz, body-size limits, panic/exception recovery, metrics timer. Order matters — e.g. recovery must wrap everything, auth before body parsing.' },
      { name: 'Handler + domain code', what: 'Validates input, calls dependencies with explicit deadlines, never stores per-user state in process memory between requests. In-process caches are allowed only as optimizations that can be lost.' },
      { name: 'Connection pools', what: 'HikariCP (default `maximumPoolSize` 10, `connectionTimeout` 30 s), pgx, Lettuce/redis-py, HTTP keep-alive pools. A pool is a **semaphore on a downstream**: it caps concurrency and is where back-pressure appears first.' },
      { name: 'Health endpoints', what: '`/livez` (is the process wedged?), `/readyz` (should I get traffic now?), and in Kubernetes a `startupProbe` for slow boots. Each has a different consumer and must check different things.' },
      { name: 'Shutdown handler', what: 'On `SIGTERM`: flip readiness, keep serving while the LB deregisters, stop accepting, drain in-flight requests, close pools, flush telemetry, exit before `terminationGracePeriodSeconds` (default 30 s) ends in `SIGKILL`.' },
      { name: 'Config & secrets loader', what: '12-factor: config from env vars or mounted files, secrets from Vault / AWS Secrets Manager / k8s Secrets (mounted, ideally rotated without restart). Same artifact promoted dev → prod; only config differs.' },
    ],
    real: [
      { name: 'Spring Boot (Tomcat / Netty)', how: 'Embedded Tomcat with a 200-thread pool and NIO connector; or WebFlux on Netty with one event loop per core. Since Spring Boot 3.2, `spring.threads.virtual.enabled=true` runs requests on Java 21 virtual threads. Actuator exposes liveness/readiness groups; `server.shutdown=graceful` drains.' },
      { name: 'Node.js (Express / Fastify)', how: 'Single-threaded event loop per process; blocking file/DNS/crypto calls go to the libuv pool (`UV_THREADPOOL_SIZE` default 4). Run one process per vCPU (cluster module or one container per core). Any CPU-heavy handler stalls every request on that process.' },
      { name: 'Go `net/http`', how: 'A goroutine per connection (initial stack 2 KB, grows on demand), M:N scheduled onto `GOMAXPROCS` OS threads. `http.Server.Shutdown(ctx)` stops listeners and waits for idle connections — the canonical graceful drain.' },
      { name: 'Python (Gunicorn / Uvicorn)', how: 'Pre-fork master with N worker processes (GIL ⇒ processes for CPU parallelism); docs suggest `(2 × cores) + 1` workers. Sync workers handle one request each; Uvicorn workers run an asyncio loop for ASGI apps.' },
      { name: 'AWS Lambda (contrast)', how: 'One request per execution environment at a time, environments reused while warm and frozen between invocations. Statelessness is forced on you, at the cost of cold starts and per-invocation connection management (RDS Proxy).' },
    ],
  },

  lifecycle: {
    summary:
      'A typical `GET /cart` inside one Java/Go instance: ~4 ms of server time, dominated by the DB and Redis round trips. Queue wait is ~0 when healthy and the single biggest contributor when saturated.',
    stages: [
      { stage: 'Accept / read', what: 'Request arrives on a keep-alive connection already open from the LB; no TCP or TLS handshake (TLS ended at the LB).', cost: 'Syscall + buffer copy', ms: 0.02 },
      { stage: 'Parse + route', what: 'HTTP parser builds the request object; router matches `/cart` to a handler.', cost: 'Tens of µs', ms: 0.05 },
      { stage: 'Queue for worker', what: 'Waits for a free thread / event-loop turn. ~0 at 50% utilization; grows non-linearly near saturation (queueing theory).', cost: '0 to seconds', ms: 0.1 },
      { stage: 'Middleware', what: 'Trace context extracted, JWT signature verified, request id and metrics timer attached.', cost: 'JWT verify ~0.05 ms', ms: 0.1 },
      { stage: 'Session / cache read', what: 'Session and cart cache fetched from Redis over a pooled connection.', cost: '1 RTT ~0.3–1 ms', ms: 0.6 },
      { stage: 'DB query', what: 'Connection borrowed from Hikari (~µs if free), indexed query runs, connection returned.', cost: 'RTT + query ~1–5 ms', ms: 2.5 },
      { stage: 'Business logic + JSON', what: 'Price rules applied, response serialized. Allocation here drives GC pressure later.', cost: 'CPU ~0.2–1 ms', ms: 0.4 },
      { stage: 'Write response + telemetry', what: 'Bytes written to socket; histogram observed, access log line buffered, span ended.', cost: 'Tens of µs', ms: 0.05 },
    ],
  },

  deepDives: [
    {
      title: 'Concurrency models: threads, event loops, virtual threads',
      hook: 'The model decides what “one slow dependency” does to every other request on the box.',
      body: [
        '**Thread-per-request** (Tomcat, Gunicorn sync) gives each in-flight request an OS thread with ~1 MB of reserved stack. Code is simple and blocking; concurrency is capped by the pool (200 by default in Tomcat). When a dependency slows from 5 ms to 5 s, all 200 threads block on it within seconds and even `/healthz` cannot get a thread.',
        '**Event loop** (Node, Netty, asyncio) multiplexes thousands of connections over a few threads with non-blocking I/O. Memory per request is small, but one CPU-bound or accidentally blocking call (sync crypto, a 50 MB JSON parse, a blocking JDBC driver) freezes every request on that loop.',
        '**Virtual threads / goroutines** give blocking-style code at near event-loop cost: the runtime parks the lightweight thread on I/O and reuses the carrier. Java 21 virtual threads are cheap enough to create one per request; but in JDK 21–23 a virtual thread blocking inside `synchronized` **pins** its carrier (fixed by JEP 491 in JDK 24).',
      ],
      diagram: {
        type: 'compare',
        title: 'What a 5 s downstream stall does',
        columns: [
          { name: 'Thread pool (200)', tone: 'warn', points: ['200 threads block', 'New requests queue', 'Health checks time out', 'Fix: timeouts, bulkheads'] },
          { name: 'Event loop', tone: 'info', points: ['Loop stays free', 'Pending promises pile up', 'Memory grows', 'Fix: concurrency limit'] },
          { name: 'Virtual threads', tone: 'ok', points: ['Millions can park', 'DB pool becomes limit', 'Waiters queue on pool', 'Fix: pool timeout, shed'] },
        ],
        caption: 'Cheap concurrency moves the bottleneck to the next semaphore — usually the connection pool.',
      },
      insight:
        'Virtual threads and async remove the thread limit, not the downstream limit. Without an explicit concurrency cap (pool size, semaphore, adaptive limiter like Netflix `concurrency-limits`), an async server will happily accept 50,000 requests for a database that can serve 200 and time all of them out together.',
    },
    {
      title: 'Sizing threads and pools with Little’s law',
      hook: 'In-flight = throughput × latency — and every pool across the fleet multiplies at the database.',
      body: [
        '**Little’s law**: L = λ × W. An instance serving 400 req/s with 50 ms mean latency has 20 requests in flight on average. Size the worker pool for peak in-flight plus headroom (2–3×), not for “as many as possible”: extra threads only add context switching and memory.',
        'Pools to a database should be sized by the **database**, not the app. The HikariCP guidance is `connections ≈ (core_count × 2) + effective_spindle_count` for the whole DB — a 16-core Postgres is happiest with ~30–40 active connections total. Divide that across instances; when the instance count makes per-instance pools tiny, put PgBouncer (transaction pooling) or RDS Proxy in between.',
        'Per-request hold time matters more than request latency: if a 50 ms request holds a DB connection for 5 ms, 400 req/s needs only 400 × 0.005 = 2 connections on average.',
      ],
      code: {
        lang: 'yaml',
        caption: 'Spring Boot: explicit limits instead of defaults',
        code: `server:
  tomcat:
    threads:
      max: 64            # peak in-flight × headroom, not 200 by habit
    accept-count: 50     # bounded queue → fast 503 instead of slow death
spring:
  datasource:
    hikari:
      maximum-pool-size: 8     # (db cores × 2) / instances, then PgBouncer
      connection-timeout: 250  # ms; default 30000 hides saturation
      max-lifetime: 1800000    # < DB / proxy idle kill
  lifecycle:
    timeout-per-shutdown-phase: 25s`,
      },
      insight:
        'A 30 s pool `connectionTimeout` (Hikari’s default) means a saturated pool turns into 30 s requests and full thread pools; a short timeout turns it into fast, sheddable errors. Fail fast is a capacity decision, not just an error-handling one.',
    },
    {
      title: 'Graceful shutdown on Kubernetes',
      hook: 'Most deploy-time 502s come from the race between SIGTERM and endpoint removal.',
      body: [
        'When a pod is deleted, two things happen **in parallel**: the kubelet sends `SIGTERM` (after running any `preStop` hook) and the endpoints controller removes the pod from Service endpoints, which kube-proxy, ingress controllers and cloud LBs pick up seconds later. If the app exits on `SIGTERM` immediately, traffic still routed to it fails.',
        'The robust recipe: a `preStop` sleep of 5–15 s (traffic keeps flowing while routing converges), then on `SIGTERM` stop accepting, fail readiness, finish in-flight requests, close keep-alive connections (`Connection: close`, HTTP/2 `GOAWAY`), close pools and exit — all within `terminationGracePeriodSeconds` (default 30 s; the preStop time counts against it).',
      ],
      diagram: {
        type: 'sequence',
        title: 'Pod termination without dropped requests',
        actors: ['Kubelet', 'App', 'Endpoints', 'LB'],
        messages: [
          { from: 'Kubelet', to: 'App', label: 'run preStop (sleep 10s)' },
          { from: 'Kubelet', to: 'Endpoints', label: 'pod Terminating' },
          { from: 'Endpoints', to: 'LB', label: 'remove pod IP', dashed: true },
          { from: 'LB', to: 'App', label: 'last requests still arrive', tone: 'warn' },
          { from: 'Kubelet', to: 'App', label: 'SIGTERM' },
          { from: 'App', to: 'App', label: 'stop accept, drain in-flight' },
          { from: 'App', to: 'Kubelet', label: 'exit 0 before grace ends', tone: 'ok' },
        ],
        caption: 'Exit too early → 502s. Exceed the grace period → SIGKILL mid-request.',
      },
      code: {
        lang: 'yaml',
        code: `spec:
  terminationGracePeriodSeconds: 45
  containers:
    - name: api
      lifecycle:
        preStop:
          exec: { command: ["sh", "-c", "sleep 10"] }
      readinessProbe:
        httpGet: { path: /readyz, port: 8080 }
        periodSeconds: 5
        failureThreshold: 2`,
      },
      insight:
        'Long-lived connections (gRPC streams, WebSockets, HTTP/2 to a client-side LB) are not drained by readiness at all — the client keeps using the open connection. You must actively send `GOAWAY` / close and have clients reconnect, or every deploy is a reconnect storm.',
    },
    {
      title: 'Liveness vs readiness vs startup probes',
      hook: 'A liveness probe that checks dependencies converts a dependency blip into a fleet restart.',
      body: [
        '**Liveness** answers “is this process wedged beyond self-repair?” — deadlocked, event loop stuck. Failing it kills the container. It must check only the process itself. **Readiness** answers “should I receive traffic right now?” — warming up, draining, overloaded. Failing it removes the pod from endpoints without restarting. **Startup** protects slow boots from liveness until the app is up.',
        'If liveness pings Postgres and Postgres has a 20 s failover, every pod fails liveness simultaneously, restarts, re-warms JIT and caches and reconnects at once (thundering herd) — a 20 s blip becomes minutes. Even readiness checking a shared dependency is dangerous: all pods go unready together and the LB has nowhere to send traffic.',
      ],
      table: {
        caption: 'Kubernetes probe defaults: periodSeconds 10, timeoutSeconds 1, failureThreshold 3',
        columns: ['Probe', 'Question', 'On failure', 'Should check', 'Never check'],
        rows: [
          ['livenessProbe', 'Is the process hopelessly stuck?', 'Container restarted', 'Event loop lag, deadlock watchdog', 'DB, Redis, downstream services'],
          ['readinessProbe', 'Can I take traffic now?', 'Removed from endpoints', 'Warm-up done, not draining, local saturation', 'Shared deps (all pods fail together)'],
          ['startupProbe', 'Has boot finished?', 'Restart after budget', 'App initialized', 'Anything slow and external'],
        ],
      },
      insight:
        'Health is local; dependency health belongs in metrics and circuit breakers. A pod whose DB is down should still be “ready” and return fast errors or degraded responses — otherwise the LB fails open or shows a blank 503 page with no useful error.',
    },
    {
      title: 'Deployment strategies and automated canary analysis',
      hook: 'During every deploy, two versions run at once — design for N and N−1 coexisting.',
      body: [
        '**Rolling** replaces pods in batches (`maxSurge`, `maxUnavailable`); cheap, but rollback is another rolling deploy and a bad version reaches everyone at the batch rate. **Blue/green** stands up a full new fleet and flips the LB: instant rollback, double capacity during the switch. **Canary** sends 1–5% of traffic to the new version and compares it with the baseline before proceeding.',
        'Mature canaries are judged by machines: Netflix/Google’s **Kayenta** compares canary vs a fresh baseline cluster with statistical tests on error rate, latency and resource metrics; Argo Rollouts `AnalysisTemplate` and Flagger query Prometheus/Datadog and auto-abort. Comparing against a fresh baseline (not the old long-running fleet) removes warm-cache and uptime bias.',
        'Because versions overlap, database changes follow **expand → migrate → contract**: add the nullable column, deploy code that writes both, backfill, switch reads, then drop the old column in a later release.',
      ],
      table: {
        columns: ['Strategy', 'Blast radius', 'Rollback', 'Extra capacity', 'Main risk'],
        rows: [
          ['Rolling', 'Grows batch by batch', 'Minutes (redeploy)', '`maxSurge` (e.g. 25%)', 'Bad build reaches all before detection'],
          ['Blue/green', '100% at flip', 'Seconds (flip back)', '2× during switch', 'Shared DB/schema not reversible'],
          ['Canary + analysis', '1–5% first', 'Seconds (shift weight)', 'Small', 'Low traffic ⇒ weak statistics'],
          ['Feature flags', 'Per user / cohort', 'Instant toggle', 'None', 'Flag debt, untested combinations'],
        ],
      },
      insight:
        'Canaries only catch what the metrics measure and what canary traffic exercises. Global config pushes that bypass the canary path (rules, flags, WAF regexes) have caused some of the largest outages — config needs the same staged rollout as code.',
    },
    {
      title: 'GC pauses, warm-up and tail latency',
      hook: 'p99 on a JVM service is often set by the collector and the JIT, not by your code.',
      body: [
        'A stop-the-world pause stalls every in-flight request on the instance at once, so GC shows up as p99/p999 spikes and as timeouts in callers. G1 (Java default) targets `MaxGCPauseMillis=200`; ZGC and Shenandoah do concurrent compaction with sub-millisecond pauses at some throughput cost. Go’s concurrent collector has sub-ms STW phases but trades CPU (tuned with `GOGC` / `GOMEMLIMIT`).',
        'Fresh JVM instances run interpreted/C1 code until hot methods are compiled by C2, caches are empty and pools are cold — the first minute can be several times slower. Mitigations: LB **slow start** (Envoy `slow_start_config`, ALB slow start mode), synthetic warm-up requests before readiness, CDS/AppCDS or CRaC for faster boot, GraalVM native image (no JIT warm-up, lower peak throughput).',
      ],
      table: {
        columns: ['Runtime / GC', 'Typical STW pause', 'Trade-off'],
        rows: [
          ['JVM G1 (default)', 'Tens–200 ms target', 'Good throughput; pauses grow with live set'],
          ['JVM ZGC (generational in 21)', '< 1 ms', 'More CPU/memory overhead'],
          ['JVM Parallel GC', '100s of ms – seconds', 'Max throughput, batch only'],
          ['Go GC', 'Sub-ms STW phases', 'Background CPU; tune GOGC/GOMEMLIMIT'],
          ['Node V8 (Orinoco)', 'Few ms typically', 'Large heaps hurt; one heap per process'],
        ],
      },
      insight:
        'Pauses also break liveness probes (1 s timeout), lock leases and session heartbeats: a 3 s pause can make a healthy pod look dead to Kubernetes, ZooKeeper and your lock service simultaneously. Tune timeouts with pause distributions in mind.',
    },
    {
      title: 'Statelessness, config and secrets (12-factor in practice)',
      hook: 'Stateless means “losable”, not “no memory use”.',
      body: [
        'An instance may hold caches, compiled templates and connection pools — as long as losing them only costs performance. What it must not hold is the **only copy** of anything: sessions (move to Redis or signed tokens), uploads (stream to S3 via pre-signed URLs), in-progress jobs (queue with acks), scheduled timers (external scheduler), WebSocket subscriptions (pub/sub fan-out tier).',
        '12-factor rules that matter at SDE-3 level: one immutable artifact promoted across environments; config injected at runtime; backing services as attached resources (swap a DB by changing a URL); fast startup and graceful shutdown (disposability); logs to stdout as event streams.',
      ],
      bullets: [
        'Secrets: fetched from Vault / Secrets Manager or mounted files, never baked into images or committed; support rotation (dual-valid credentials) without redeploys.',
        'Dynamic config (flags, limits) from a config service with local caching and last-known-good fallback — so the config service is not in the request path.',
        'Local disk only for scratch; assume it vanishes on every reschedule.',
      ],
      insight:
        'In-process caches across N instances are N inconsistent copies: after an update, different instances serve different values until TTL. Fine for reference data; wrong for anything users expect to read-their-writes on.',
    },
  ],

  scaling: {
    body: [
      'Horizontal scale is the default: identical instances behind an LB, spread across ≥3 AZs, sized so losing one AZ leaves enough capacity (N+1 at the AZ level means running ~150% of peak need across 3 AZs). Scale on a demand signal (CPU at 50–70%, RPS per pod or concurrency), with `minReplicas` covering an AZ loss.',
      'The **control plane** (Kubernetes API, deploy pipeline, autoscaler) can fail without stopping the **data plane**: running pods keep serving if the API server is down, but you cannot deploy, scale or reschedule. Avoid app startup paths that need the control plane or a config service to be up — cache last-known-good config locally.',
      'Multi-region active-active is easy for the stateless tier and hard for its state: the app can run anywhere, but sessions, writes and caches must be designed for regional affinity or replication. Config and flag changes propagate eventually; never assume all instances see a new value at the same instant.',
    ],
    bullets: [
      'Watch the multiplier: instances × pool size vs DB `max_connections`; instances × keep-alive conns vs downstream limits.',
      'Vertical before horizontal for tiny services: 2 pods of 2 vCPU beat 10 pods of 0.2 vCPU (GC, JIT and sidecar overhead per pod).',
      'Bounded queues everywhere; reject early with 503 + `Retry-After` instead of queueing past the caller’s timeout.',
      'Pod disruption budgets keep rolling node drains from removing too many replicas at once.',
      'Topology spread constraints / anti-affinity: replicas must not share a node or AZ by accident.',
      'Warm capacity: slow-start in LB, readiness gated on warm-up, overprovisioned buffer pods for spikes.',
    ],
    diagram: {
      type: 'layers',
      title: 'Control plane vs data plane for the app tier',
      layers: [
        { name: 'Control plane', items: ['K8s API / etcd', 'CI/CD + Argo', 'HPA', 'Config service'], tone: 'violet' },
        { name: 'Data plane', items: ['LB / ingress', 'App pods (3 AZs)', 'Sidecars', 'Pools to deps'], tone: 'ok' },
        { name: 'State', items: ['Redis', 'Postgres', 'S3', 'Kafka'], tone: 'info' },
      ],
      caption: 'Control-plane outage freezes change; data-plane outage drops traffic.',
    },
  },

  failures: [
    {
      name: 'Thread / pool starvation cascade',
      symptom: 'One dependency slows down; all workers block waiting on it; unrelated endpoints and health checks time out; LB marks pods unhealthy.',
      detect: '`tomcat_threads_busy_threads` at max, `hikaricp_connections_pending` > 0, p99 by route rising on routes that do not use the slow dependency.',
      mitigate: 'Per-call timeouts shorter than the caller’s, bulkheads (separate pools per dependency), circuit breakers, bounded queues with fast 503s.',
    },
    {
      name: 'Connection explosion on scale-out',
      symptom: 'Autoscaler goes from 40 to 200 pods × 20 connections; Postgres hits `max_connections` and rejects new sessions; latency worsens, autoscaler adds more pods.',
      detect: 'Postgres `numbackends` vs `max_connections`, “too many clients” errors, Hikari connection-acquire failures correlated with replica count.',
      mitigate: 'PgBouncer / RDS Proxy, smaller per-pod pools, `maxReplicas` derived from DB capacity, scale on a signal the DB cannot inflate.',
    },
    {
      name: 'Dropped requests on deploy',
      symptom: 'Spike of 502/503 for 10–30 s during each rollout, worse for long requests and gRPC streams.',
      detect: 'LB 5xx (`HTTPCode_ELB_502_Count`, ingress `nginx_ingress_controller_requests{status=~"5.."}`) aligned with deploy annotations on dashboards.',
      mitigate: 'preStop sleep, readiness flip, graceful drain, `GOAWAY` for HTTP/2, grace period longer than the longest request.',
    },
    {
      name: 'Restart storm from bad probes',
      symptom: 'A dependency blip makes every pod fail liveness; Kubernetes restarts the fleet; cold JVMs and reconnect herds prolong the outage.',
      detect: '`kube_pod_container_status_restarts_total` rising across all pods simultaneously; liveness failure events in `kubectl describe`.',
      mitigate: 'Liveness checks only the process; dependency status goes to metrics/breakers; generous `failureThreshold`; startupProbe for slow boots.',
    },
    {
      name: 'Blocked event loop / GC thrash',
      symptom: 'Node process freezes on a huge payload or sync crypto; or JVM spends > 20% time in GC, p99 explodes, eventually OOMKilled.',
      detect: '`nodejs_eventloop_lag_seconds` > 100 ms; `jvm_gc_pause_seconds` p99, GC time ratio; `kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}`.',
      mitigate: 'Body size limits, move CPU work to workers, heap sized below the container limit (`-XX:MaxRAMPercentage`), low-pause collector, fix leaks.',
    },
    {
      name: 'Hidden local state',
      symptom: 'Random logouts, missing uploads, duplicate scheduled jobs after scaling from 1 to 3 instances.',
      detect: 'Errors correlated with instance id in logs; bug reports after scale-out or deploys; sticky-session config appearing in LB.',
      mitigate: 'Externalize sessions/files/timers; chaos-test by killing pods during load tests; forbid sticky sessions as a crutch.',
    },
  ],

  warStories: [
    {
      title: 'Knight Capital: a partial deploy and a repurposed flag',
      source: 'SEC filing on Knight Capital Americas, 2013 (incident August 2012)',
      what:
        'New trading code was deployed manually to 8 servers; one was missed. The new release reused a flag that, on the old code still running on that server, activated long-dead “Power Peg” logic. It sent millions of unintended orders, and Knight lost about $460M in roughly 45 minutes.',
      lesson:
        'Deploys are never atomic: N and N−1 coexist. Automate deploys with verification of every instance, never repurpose flags or fields, and have a kill switch.',
    },
    {
      title: 'Cloudflare: one regex, every edge server at 100% CPU',
      source: 'Cloudflare blog, July 2019',
      what:
        'A new WAF rule containing a catastrophically backtracking regular expression was pushed globally at once. Every HTTP-serving core hit 100% CPU and Cloudflare served 502s worldwide for about 27 minutes.',
      lesson:
        'Config and rule changes need staged, canaried rollout like code, plus CPU limits on user-controlled work. Global instant pushes have a global blast radius.',
    },
    {
      title: 'The liveness probe that checked the database',
      source: 'Composite of common incidents',
      what:
        'A service’s `/health` (used for liveness) ran `SELECT 1`. During a 25 s managed-DB failover, all 120 pods failed liveness and were restarted together. Cold JVMs, empty caches and 120 × 10 simultaneous reconnections kept the service down for 9 minutes after the DB was back.',
      lesson: 'Liveness must be local. Dependency health belongs in metrics, breakers and degraded responses, not in a probe that kills pods.',
    },
  ],

  numbers: [
    { label: 'Tomcat default worker threads', value: '200', note: '`server.tomcat.threads.max`; `acceptCount` 100' },
    { label: 'HikariCP defaults', value: 'pool 10, wait 30 s', note: '`maximumPoolSize`, `connectionTimeout`' },
    { label: 'Platform thread vs goroutine stack', value: '~1 MB vs 2 KB', note: 'virtual threads also KB-scale' },
    { label: 'Little’s law example', value: '1k req/s × 100 ms = 100', note: 'requests in flight' },
    { label: 'k8s `terminationGracePeriodSeconds`', value: '30 s default', note: 'preStop counts against it' },
    { label: 'k8s probe defaults', value: '10 s / 1 s / 3', note: 'period / timeout / failureThreshold' },
    { label: 'G1 pause target', value: '200 ms', note: '`MaxGCPauseMillis`; ZGC < 1 ms' },
    { label: 'Simple stateless instance', value: '~1k–5k req/s', note: 'per few vCPU, I/O-bound CRUD' },
    { label: 'Gunicorn worker guidance', value: '(2 × cores) + 1', note: 'process per worker' },
    { label: 'Node libuv thread pool', value: '4 threads', note: '`UV_THREADPOOL_SIZE`' },
  ],

  capacity: {
    question:
      'Peak 30,000 req/s. Each request: 40 ms wall time, 8 ms CPU, holds a DB connection for ~5 ms. Pods have 4 vCPU. Postgres can handle ~400 connections. How many pods, threads and DB connections?',
    steps: [
      'CPU per pod: 4 cores × 1000 ms / 8 ms = 500 req/s at 100% CPU; target 60% ⇒ ~300 req/s per pod.',
      'Pods for peak: 30,000 / 300 = 100. Survive losing 1 of 3 AZs: 100 × 3/2 = 150 pods.',
      'In flight per pod (Little): 300 × 0.040 s = 12 ⇒ a 32–48 worker pool is ample (or virtual threads with a 48 concurrency cap).',
      'DB connections per pod: 300 × 0.005 s = 1.5 busy on average ⇒ pool of 4 per pod for bursts.',
      'Fleet total: 150 × 4 = 600 > 400 ⇒ add PgBouncer in transaction mode (600 client conns → ~100 server conns), or cut pools to 2.',
    ],
    answer:
      '~150 pods (100 needed + AZ headroom), ~40 workers each, pool of 4 per pod behind PgBouncer. The DB connection budget, not app CPU, is the binding constraint.',
  },

  comparison: {
    caption: 'App runtimes and concurrency models',
    columns: ['Runtime', 'Concurrency model', 'Per in-flight request', 'Characteristic failure', 'Sweet spot'],
    rows: [
      ['Spring MVC on Tomcat', 'Thread-per-request (200)', '~1 MB stack', 'Thread starvation on slow deps', 'CRUD, moderate concurrency'],
      ['Spring WebFlux / Netty', 'Event loop per core', 'Small (reactive chain)', 'Blocking call on loop; hard debugging', 'Proxies, streaming, high fan-in'],
      ['Java 21 virtual threads', 'Virtual thread per request', 'KB-scale', 'Pinning; downstream overload', 'Blocking code at high concurrency'],
      ['Node.js', 'Single event loop per process', 'Closure + promise', 'CPU work freezes all requests', 'I/O-heavy APIs, BFFs'],
      ['Go net/http', 'Goroutine per conn, M:N', '2 KB+ stack', 'Goroutine leaks without ctx', 'General services, infra'],
      ['Python Gunicorn/Uvicorn', 'Pre-fork processes (+asyncio)', 'Process or coroutine', 'GIL, memory per process', 'Django/FastAPI apps, ML serving glue'],
    ],
  },

  whenNot: [
    'Static assets and cacheable pages: serve from a CDN / object storage, not through app instances.',
    'Long-running or CPU-heavy work (video encode, reports): enqueue to a worker pool; the request path should return quickly.',
    'Very spiky, low-average traffic: serverless (Lambda, Cloud Run with scale-to-zero) beats idle always-on instances.',
    'Inherently stateful real-time sessions (game rooms, collaborative docs): use a deliberately stateful, sharded tier with explicit ownership, not a “stateless” app with sticky sessions.',
    'Millions of idle persistent connections: a dedicated WebSocket/connection gateway that fans out via pub/sub.',
  ],

  interview: [
    {
      q: 'How do you size the thread pool and DB pool for a service?',
      a: 'Start with Little’s law: in-flight = peak throughput × latency, and size workers at 2–3× that, not at an arbitrary 200. DB pools are sized from the database: roughly (DB cores × 2) active connections total, divided across instances; per-instance need is throughput × connection hold time. When instances × pool exceeds what the DB can handle, add a pooler like PgBouncer or RDS Proxy. Set short acquire timeouts so saturation becomes fast failures.',
      followUps: ['What happens to that math when the autoscaler triples replicas?', 'Why is a bigger DB pool often slower?', 'How would virtual threads change your sizing?'],
      seniorSignal: 'Reasons from the database’s capacity backwards and treats pools as semaphores that implement back-pressure, including the fleet-wide multiplier.',
    },
    {
      q: 'Walk me through a zero-downtime deploy on Kubernetes.',
      a: 'Rolling update with `maxUnavailable` 0 and some surge; new pods only get traffic after readiness passes (startup probe for slow boots, warm-up before ready). Old pods get a preStop sleep so endpoint removal propagates to kube-proxy and LBs, then on SIGTERM stop accepting, drain in-flight requests, send GOAWAY on HTTP/2, close pools and exit inside the grace period. Schema changes are expand/contract so N and N−1 both work. Ideally a canary with automated analysis gates the rollout.',
      followUps: ['Why is the preStop sleep needed if readiness fails on SIGTERM?', 'How do you drain gRPC streams or WebSockets?', 'How do you roll back a migration?'],
      seniorSignal: 'Knows the SIGTERM/endpoint-removal race and the N/N−1 coexistence constraint, not just “use rolling updates”.',
    },
    {
      q: 'What should liveness and readiness probes check?',
      a: 'Liveness only detects an unrecoverable process — deadlock, stuck event loop — because failing it restarts the container. Readiness says whether this instance should receive traffic now: warming, draining or locally overloaded. Neither should check shared dependencies, because the failure is correlated across all pods: liveness causes a restart storm, readiness empties the endpoint list. Dependency health goes into metrics, breakers and degraded responses.',
      followUps: ['What if the DB is truly down — should the service be ready?', 'How does an ALB behave when every target is unhealthy?', 'When would you use a startupProbe?'],
      seniorSignal: 'Reasons about correlated failure across the fleet and the different consumers of each probe.',
    },
    {
      q: 'Thread-per-request, event loop or virtual threads for a new service?',
      a: 'For I/O-bound services with high concurrency, virtual threads (Java 21+) or goroutines give blocking code with cheap concurrency; event loops give similar efficiency but punish any blocking call. Thread-per-request is fine at moderate concurrency and simplest to debug. Whatever the model, concurrency must be bounded explicitly at the downstream (pools, semaphores, adaptive limits), because cheap concurrency just moves the queue to the database.',
      followUps: ['What is pinning and why does it matter?', 'How do you detect a blocked event loop in production?', 'How do you apply back-pressure in an async server?'],
      seniorSignal: 'Separates the cost of a waiting request from the capacity of what it waits on.',
    },
    {
      q: 'Your p99 is 5× your p50 on a JVM service. How do you investigate?',
      a: 'Check whether tail requests share a cause: GC pause logs vs latency spikes, queue wait (thread pool saturation, accept queue), pool acquire time, and slow dependencies via traces with exemplars. Look at warm-up — new pods after deploys or autoscaling are often slow for a minute. Fixes range from a low-pause collector and less allocation, to slow-start in the LB, to hedging or timeouts on slow dependencies.',
      followUps: ['How would you measure queue wait separately from handler time?', 'ZGC vs G1 — what do you give up?', 'How do pauses interact with lock leases or ZK sessions?'],
      seniorSignal: 'Breaks latency into queueing, pause and service components and connects pauses to failures elsewhere (probes, leases).',
    },
    {
      q: 'What does stateless actually mean and what state is acceptable on an instance?',
      a: 'No request depends on data that exists only on that instance. Caches, pools and compiled artifacts are fine because losing them only costs performance; sessions, uploads, job progress and timers must live in external stores. The test: can you kill any instance at any moment without user-visible loss beyond retries? In-process caches still need a consistency story, because N instances means N stale copies.',
      followUps: ['How do you handle file uploads statelessly?', 'Where do scheduled jobs run if instances are stateless?', 'When is sticky routing acceptable?'],
      seniorSignal: 'Defines statelessness operationally (killability) and calls out cache inconsistency across instances.',
    },
  ],

  takeaways: [
    'Stateless = any instance can be killed at any time without losing anything but performance.',
    'Little’s law sizes workers; the database sizes connection pools — and replicas multiply pools.',
    'Cheap concurrency (async, virtual threads) moves the bottleneck; bound it explicitly downstream.',
    'Graceful shutdown needs preStop + readiness flip + drain; long-lived connections need GOAWAY.',
    'Liveness checks the process only; never put shared dependencies in liveness.',
    'N and N−1 always coexist during deploys: expand/contract schemas, canary with automated analysis.',
    'GC pauses and cold JIT drive tail latency and also break probes and leases.',
  ],
};

export default deep;
