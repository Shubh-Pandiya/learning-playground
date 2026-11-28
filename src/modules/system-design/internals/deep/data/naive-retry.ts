import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'naive-retry',

  // ───────────────────────────── 1. PROBLEM ─────────────────────────────
  problem: {
    why:
      'Naive retry is the reflex `for i in 0..3: try call()` — no delay, no jitter, no budget, no check of whether the operation is idempotent or the error is retryable — applied independently at every layer. It is tempting because most failures in a healthy system **are** transient (a reset connection, a GC pause, one bad host) and an immediate retry hides them with zero design. It breaks exactly when failures are **correlated** — overload, a brownout, a failover — because then every retry is extra load on the one component with no spare capacity.',
    withoutIt: [
      'Without any retry, a stale pooled keep-alive connection closed by the server surfaces as a user-visible error.',
      'Without any retry, one bad host or a rolling deploy produces a steady trickle of 5xx that a retry on another host would hide.',
      'Without any retry, a 5–30 s database or Redis failover becomes an error for every request in flight.',
      'Without any retry, mobile clients on lossy networks feel broken — which is why every SDK, gateway and mesh ships retries on by default.',
    ],
    position:
      'Hidden in HTTP/DB client defaults, cloud SDKs, gateway and mesh route configs, job runners and hand-written loops — usually at several layers of the same call path at once, each unaware of the others.',
    diagram: {
      type: 'flow',
      title: 'Three layers × 3 attempts',
      nodes: [
        { label: 'User action', sub: '1 request', tone: 'neutral' },
        { label: 'Client', sub: '3 attempts', tone: 'warn' },
        { label: 'Gateway', sub: '3 × 3 = 9', tone: 'warn' },
        { label: 'Service', sub: '9 × 3 = 27', tone: 'bad' },
        { label: 'Database', sub: '27× load when sick', tone: 'bad' },
      ],
      caption: 'Amplification is `attempts ^ layers` and it only kicks in when the bottom is already failing.',
    },
  },

  // ───────────────────────────── 2. ARCHITECTURE ─────────────────────────────
  architecture: {
    overview:
      'There is no component — that is the problem. The “architecture” is an emergent multiplier: independent retry loops stacked along the call path, each with its own timeout, all triggered by the same event. What is missing is equally structural: no shared retry budget, no deadline that travels with the request, no classification of errors, no idempotency, and a server that queues work for callers who have already given up.',
    diagram: {
      type: 'layers',
      title: 'Stacked loops, nobody in charge',
      layers: [
        { name: 'Client / SDK', items: ['3 attempts', '1 s timeout', 'no sleep, no jitter'], tone: 'warn' },
        { name: 'Gateway / mesh', items: ['retry on 5xx + timeout', '3 attempts', 'unaware of client'], tone: 'warn' },
        { name: 'Service', items: ['DB driver retries 3×', 'retries POSTs too', 'inner timeout > outer'], tone: 'warn' },
        { name: 'Database', items: ['FIFO accept queue', 'zombie requests', 'goodput → 0'], tone: 'bad' },
      ],
    },
    blocks: [
      { name: 'Immediate retry loop', what: 'Retries the moment an attempt fails or times out. Because thousands of clients failed at the same moment, they retry at the same moment: synchronized waves.' },
      { name: 'Missing error classifier', what: 'Retries `400`, `401`, `404`, `409`, `422` — deterministic errors that will fail identically — and ignores overload signals such as `429`/`503` with `Retry-After` or gRPC `RESOURCE_EXHAUSTED`.' },
      { name: 'Missing idempotency', what: 'Retries `POST /charge` after a timeout, although a timeout means “unknown outcome”, not “did not happen”.' },
      { name: 'Unnested timeouts', what: 'Each layer picks its own timeout; when an inner timeout × attempts exceeds the outer timeout, inner work continues after the caller left — pure waste.' },
      { name: 'No budget, no deadline', what: 'Retries are unbounded as a fraction of traffic, and no remaining-time budget is propagated, so servers cannot drop work that is already too late.' },
      { name: 'Server-side FIFO queue', what: 'The overloaded server processes requests oldest first, i.e. mostly requests whose callers already timed out and retried.' },
    ],
    real: [
      { name: 'AWS SDKs (standard retry mode)', how: 'Default 3 attempts, exponential backoff with jitter capped at 20 s, and a client-side **retry quota** (botocore: 500 tokens, a retry costs 5, a timeout retry 10, successes refund): when a dependency fails broadly, the quota empties and the SDK stops retrying.' },
      { name: 'gRPC retry policy (gRFC A6)', how: '`maxAttempts` (capped at 5), `initialBackoff`, `maxBackoff`, `backoffMultiplier`, `retryableStatusCodes`, with a randomised (jittered) delay. `retryThrottling` keeps a token count per server — failures subtract 1, successes add `tokenRatio` — and disables retries while tokens ≤ `maxTokens / 2`. Transparent retries happen only when the RPC never reached the server application.' },
      { name: 'Envoy retry_policy', how: '`num_retries` defaults to 1, `retry_on` picks conditions (`5xx`, `reset`, `connect-failure`, `retriable-4xx`…), `per_try_timeout` bounds each attempt, and back-off is fully jittered exponential from a 25 ms base (max 10× base). Cluster `retry_budget` caps concurrent retries as a percentage of active requests.' },
      { name: 'Linkerd retry budgets', how: 'Retries are allowed only while they stay under a ratio of live traffic: default `retryRatio` 0.2 plus `minRetriesPerSecond` 10 over a 10 s window, so retries can never more than add ~20% load mesh-wide.' },
      { name: 'Google SRE practice', how: 'At most 3 attempts per request, a per-client budget where retries stay below ~10% of requests, retries at a single layer, and an explicit “overloaded; don’t retry” error that callers propagate instead of retrying.' },
    ],
  },

  // ───────────────────────────── 3. LIFECYCLE ─────────────────────────────
  lifecycle: {
    summary:
      'One user action during a database brownout with naive retries at three layers. The user waits ~3 s for an error while the bottom tier receives up to 27 attempts — and a non-idempotent write may have run more than once.',
    stages: [
      { stage: 'Attempt 1 times out', what: 'Backend p99 jumped from 200 ms to 2 s; the client’s 1 s timeout fires. The request is still queued at the backend.', cost: 'Full client timeout', ms: 1000, part: 'client' },
      { stage: 'Immediate retry 2', what: 'Sent with zero delay, in the same instant as every other client that timed out — a synchronized wave.', cost: 'Full client timeout again', ms: 1000, part: 'client' },
      { stage: 'Immediate retry 3', what: 'Third wave; the backend queue now holds three copies of this user’s request.', cost: 'Full client timeout again', ms: 1000, part: 'client' },
      { stage: 'Gateway multiplies', what: 'Each client attempt that fails upstream is retried 3× by the gateway: 9 upstream calls.', cost: 'No extra user latency, 3× load', ms: 0, part: 'gateway' },
      { stage: 'Service multiplies', what: 'The service’s DB driver retries each query 3×: up to 27 queries for one click.', cost: 'No extra user latency, 27× load', ms: 0, part: 'service' },
      { stage: 'Zombie work', what: 'The DB executes queued queries whose callers left long ago; fresh requests wait behind them and time out too.', cost: 'Capacity burned on abandoned work', ms: 0, part: 'queue' },
      { stage: 'Error to user', what: 'After ~3 s the user sees an error; if the call was `POST /charge`, one or more charges may have succeeded.', cost: 'Error rendering', ms: 0.01, part: 'backend' },
    ],
  },

  // ───────────────────────────── 4. DEEP DIVES ─────────────────────────────
  deepDives: [
    {
      title: 'Retry amplification math',
      hook: 'Load at the bottom is attempts raised to the number of retrying layers.',
      body: [
        'With a attempts per layer and L independent retrying layers, one top-level request can become `a^L` calls at the bottom. More precisely, if each attempt fails with probability f, the expected attempts per layer are `1 + f + f² + … + f^(a−1)`, and the layers multiply.',
        'At f = 1% this costs ~1% extra: retries look free in every load test run at normal load. At f = 50% and a = 3, each layer multiplies by 1.75 and three layers by **5.4×**; at f ≈ 100% it is the full 27×. Amplification is a function of the failure rate, so it is largest exactly when the system is weakest.',
      ],
      table: {
        caption: 'Worst-case load multiplier at the bottom tier',
        columns: ['Setup', 'Multiplier', 'Comment'],
        rows: [
          ['1 layer × 3 attempts', '3×', 'tolerable with backoff'],
          ['3 layers × 3 attempts', '27×', 'classic retry storm'],
          ['5 layers × 3 attempts', '243×', 'microservice depth makes it worse'],
          ['3 layers, retry only at the top', '3×', 'other layers fail fast'],
          ['3 layers, 10% budget each', '≈ 1.33×', '1.1³; Google SRE guidance'],
          ['1 layer, 20% budget (Linkerd)', '≤ 1.2×', 'bounded regardless of failure rate'],
        ],
      },
      insight:
        'A retry policy should be judged by its behaviour at 100% failure, not at 1%. If the worst case is more than ~1.2× load, it is an outage amplifier.',
    },
    {
      title: 'Synchronized retries and the thundering herd',
      hook: 'Exponential backoff without jitter just moves the wave later.',
      body: [
        'Clients that fail together retry together. With no delay, retries land as waves at multiples of the timeout. With plain exponential backoff (100 ms, 200 ms, 400 ms…) they are still synchronized, just spaced out — each wave hits the server at once.',
        'Marc Brooker’s AWS Architecture Blog post “Exponential Backoff And Jitter” (2015) simulated contending clients: **full jitter** (`sleep = random(0, min(cap, base × 2^n))`) and decorrelated jitter both completed the work with far fewer calls than no jitter, while “equal jitter” did worse. Randomness spreads retries across the whole window.',
        'Recovery has its own herd: when a service restarts, every client with pent-up retries and every reconnecting connection pool arrives at once against cold caches. Jitter, gradual traffic ramp-up and server-side admission control are the defences.',
      ],
      diagram: {
        type: 'compare',
        title: 'Retry timing',
        columns: [
          { name: 'Immediate', points: ['waves every timeout', 'max synchronization', 'never acceptable'], tone: 'bad' },
          { name: 'Exponential', points: ['waves spaced 2^n apart', 'still synchronized', 'fewer, bigger spikes'], tone: 'warn' },
          { name: 'Exponential + full jitter', points: ['uniform over window', 'smooth load', 'fewest total calls'], tone: 'ok' },
        ],
      },
      code: {
        lang: 'python',
        caption: 'Full jitter and decorrelated jitter (from the AWS Architecture Blog).',
        code: `import random

def full_jitter(attempt, base=0.1, cap=10.0):
    return random.uniform(0, min(cap, base * 2 ** attempt))

def decorrelated_jitter(prev_sleep, base=0.1, cap=10.0):
    return min(cap, random.uniform(base, prev_sleep * 3))`,
      },
      insight:
        'Jitter matters even for a single client fleet you control: autoscaled workers started by the same event, cron jobs at :00 and pods restarted by one deploy are all synchronized by construction.',
    },
    {
      title: 'Metastable failures: how a brownout becomes an outage',
      hook: 'The trigger is gone, the system is still down — because retries keep it down.',
      body: [
        '“Metastable Failures in Distributed Systems” (Bronson, Aghayev, Charapko, Zhu — HotOS 2021) describes systems that run in a **vulnerable** state — efficient, high utilisation — where a temporary **trigger** (a failover, a load spike, a slow deploy) tips them into a bad state held in place by a **sustaining effect**, even after the trigger is removed.',
        'Retries are the textbook sustaining effect: slow responses cause timeouts, timeouts cause retries, retries raise load, load keeps responses slow. Goodput collapses toward zero while throughput stays at 100%, because the server is busy completing requests nobody is waiting for. The follow-up study “Metastable Failures in the Wild” (OSDI 2022) found retry policies among the most common sustaining effects in real incidents.',
        'Recovery requires pushing load below a recovery threshold that is **lower** than the load that originally worked — usually by blocking traffic, disabling retries, or restarting fleets — which is why these outages last hours.',
      ],
      diagram: {
        type: 'flow',
        title: 'States of a metastable failure',
        nodes: [
          { label: 'Stable', sub: 'load < capacity', tone: 'ok' },
          { label: 'Vulnerable', sub: 'high utilisation, efficient', tone: 'info' },
          { label: 'Trigger', sub: 'failover, spike, slow deploy', tone: 'warn' },
          { label: 'Metastable', sub: 'retries sustain overload', tone: 'bad' },
          { label: 'Load shed', sub: 'block traffic, stop retries', tone: 'violet' },
          { label: 'Stable', sub: 'only after load drops', tone: 'ok' },
        ],
      },
      insight:
        'You cannot find metastability by load-testing at normal error rates. Test overload with retries enabled and measure **goodput** (successful responses within deadline), not throughput.',
    },
    {
      title: 'Retrying the wrong things',
      hook: 'A timeout means “unknown outcome”, and a 4xx means “will fail again”.',
      body: [
        'Non-idempotent operations: a timeout on `POST /charges` does not mean the charge failed — it may have succeeded and only the response was lost. Retrying without an idempotency key creates duplicates. Retry writes only with an idempotency key the server deduplicates on.',
        'Non-retryable errors: `400`, `401`, `403`, `404`, `409`, `422` are deterministic; retrying them wastes capacity and can trigger lockouts (retried logins tripping account protection). Overload responses (`429`, `503` with `Retry-After`, gRPC `RESOURCE_EXHAUSTED`) must be honoured with at least the indicated delay — or propagated upward as “don’t retry”.',
      ],
      table: {
        caption: 'Retry decision table',
        columns: ['Failure', 'Retry?', 'How'],
        rows: [
          ['Connection refused / reset before request sent', 'Yes', 'Once, immediately, other host'],
          ['Timeout after send, idempotent op', 'Yes', 'Backoff + jitter, within deadline and budget'],
          ['Timeout after send, non-idempotent op', 'Only with idempotency key', 'Same key, backoff + jitter'],
          ['502 / 503 / 504', 'Usually', 'Backoff + jitter, honour Retry-After'],
          ['429 Too Many Requests', 'Later', 'Wait Retry-After; do not count as failure'],
          ['400 / 401 / 403 / 404 / 409 / 422', 'No', 'Fix the request or surface the error'],
        ],
      },
      insight:
        'Classify errors at the layer that understands them and translate overload into an explicit non-retryable signal for upstream layers; otherwise every layer above re-amplifies the same failure.',
    },
    {
      title: 'The correct alternative: scarce, smart retries',
      hook: 'Retry at one layer, with jitter, a budget and a deadline — behind a breaker.',
      body: [
        'Use exponential backoff with full jitter, a small attempt cap (2–3), and a **retry budget** (token bucket: retries allowed only while they are below ~10–20% of requests). Retry at **one** layer — usually the one closest to the user or with the most context — and let other layers fail fast and propagate the error.',
        'Propagate **deadlines**: the remaining time travels with the request (gRPC deadlines), each attempt gets a per-try timeout within it, and servers drop work whose deadline has passed. Combine with idempotency keys for writes, circuit breakers that stop retries when failure is persistent, and server-side load shedding with explicit `Retry-After`.',
        '**Hedging** — sending a second copy of an idempotent read after a delay instead of after a failure — cuts tail latency cheaply when bounded: in “The Tail at Scale” (Dean & Barroso, 2013), hedging BigTable reads after 10 ms reduced the 99.9th-percentile latency from 1,800 ms to 74 ms for 2% more requests. Unbounded hedging during overload is just another retry storm.',
      ],
      code: {
        lang: 'json',
        caption: 'gRPC service config: bounded, jittered retries plus throttling.',
        code: `{
  "methodConfig": [{
    "name": [{ "service": "ledger.Ledger", "method": "GetBalance" }],
    "timeout": "2s",
    "retryPolicy": {
      "maxAttempts": 3,
      "initialBackoff": "0.1s",
      "maxBackoff": "1s",
      "backoffMultiplier": 2,
      "retryableStatusCodes": ["UNAVAILABLE"]
    }
  }],
  "retryThrottling": { "maxTokens": 10, "tokenRatio": 0.1 }
}`,
      },
      insight:
        'A retry budget turns the worst case from “attempts^layers” into a fixed percentage. It is the single most effective change, and it requires no coordination between teams.',
    },
    {
      title: 'When an immediate retry IS right',
      hook: 'Some failures are guaranteed not to have reached the server — retry those at once.',
      body: [
        'If the failure happened **before the request was sent** — connection refused, TLS handshake failure, or a pooled keep-alive connection the server had already closed — the server did no work and the operation is safe to repeat immediately on a fresh connection, preferably to a different host. Go’s `net/http` transport and most HTTP clients do this for idempotent requests on reused connections; gRPC does “transparent retries” when the RPC never reached the server application.',
        'An idempotent read retried once against a **different replica** after a fast failure (connection reset, one host returning 503 during a deploy) is also fine, as long as it is counted against a budget so it stops when failures stop being isolated.',
      ],
      bullets: [
        'One immediate retry, never a loop.',
        'Different host or fresh connection, not the same broken one.',
        'Counted against the retry budget.',
        'Only for failures that prove the server did not process the request, or for idempotent reads.',
      ],
      insight:
        'The useful question is not “should I retry?” but “do I know the server did nothing, and is the failure isolated?” Immediate retry is right only when both answers are yes.',
    },
  ],

  // ───────────────────────────── 5. SCALING ─────────────────────────────
  scaling: {
    body: [
      'Naive retry load scales with **fleet size × attempts × layers**, and it activates fleet-wide at the same moment. Every autoscaled caller instance adds retry capacity aimed at the weakest dependency, so scaling callers during an incident makes it worse.',
      'Recovery from a retry-sustained outage needs global action: shed load at the edge (rate limits, temporarily blocking a client class), turn off retries via config, and bring capacity back with a ramp rather than all at once. Retry config is therefore a control-plane concern: it must be centrally visible and changeable in seconds (mesh retry policies, SDK config flags).',
    ],
    bullets: [
      'Inventory retries per hop: client SDK, gateway, mesh, service HTTP client, DB driver, job runner.',
      'Pick one retrying layer per call path; set `num_retries: 0` or fail-fast elsewhere.',
      'Retry budgets at the mesh (Envoy `retry_budget`, Linkerd `retryRatio`) cap the worst case for every service at once.',
      'Propagate deadlines end to end; servers check them before starting expensive work.',
      'Servers shed with `503` + `Retry-After` (or `RESOURCE_EXHAUSTED`) rather than queueing, and mark such errors non-retryable upstream.',
    ],
    diagram: {
      type: 'layers',
      title: 'Where each control belongs',
      layers: [
        { name: 'Client / SDK', items: ['backoff + full jitter', 'retry quota', 'idempotency keys'], tone: 'ok' },
        { name: 'Mesh / gateway', items: ['retry budget 10–20%', 'per-try timeout', 'outlier ejection'], tone: 'info' },
        { name: 'Service', items: ['deadline checks', 'fail fast, no inner loops', 'circuit breaker'], tone: 'violet' },
        { name: 'Backend', items: ['admission control', '503 + Retry-After', 'LIFO / CoDel queues'], tone: 'accent' },
      ],
    },
  },

  // ───────────────────────────── 6. FAILURES ─────────────────────────────
  failures: [
    {
      name: 'Retry storm',
      symptom: 'During a minor slowdown, request rate at the bottom tier jumps 5–27× while user traffic is flat.',
      detect: 'Attempts-to-requests ratio per hop, e.g. Envoy `upstream_rq_retry` ÷ `upstream_rq_total`; DB QPS rising while edge RPS is flat.',
      mitigate: 'Retry at one layer; retry budgets; exponential backoff with full jitter; circuit breakers.',
    },
    {
      name: 'Metastable outage',
      symptom: 'The original trigger (failover, deploy) is resolved but errors and latency stay high for hours.',
      detect: 'Goodput (successes within deadline) near zero while CPU/throughput is at 100%; queue age above client timeouts.',
      mitigate: 'Shed load at the edge, disable retries via config, drop requests past deadline, ramp traffic back gradually.',
    },
    {
      name: 'Duplicate side effects',
      symptom: 'Customers charged twice, duplicate orders, emails or payouts after a timeout spike.',
      detect: 'Reconciliation: duplicate business records within seconds for the same user and amount; spikes after timeout incidents.',
      mitigate: 'Never retry non-idempotent calls without an idempotency key; server-side dedup.',
    },
    {
      name: 'Retrying deterministic errors',
      symptom: 'Wasted capacity and account lockouts: 401/422 retried three times at every layer.',
      detect: 'Retry counters broken down by status code; `upstream_rq_retry` with 4xx `retry_on` conditions.',
      mitigate: 'Explicit retryable-status allow-list; never `retriable-4xx` except 409 when it is truly transient.',
    },
    {
      name: 'Zombie work from unnested timeouts',
      symptom: 'Backend busy at 100% but most completed responses are discarded by callers that already timed out.',
      detect: 'Server-side “client disconnected before response” / cancelled-request counters; request age at dequeue > caller timeout.',
      mitigate: 'Deadline propagation; inner timeout × attempts < outer timeout; drop expired requests on dequeue.',
    },
    {
      name: 'Thundering herd on recovery',
      symptom: 'A restarted service is flattened within seconds by synchronized retries and reconnects.',
      detect: 'Connection-establishment rate and RPS spike at restart; repeated crash/restart cycles.',
      mitigate: 'Jittered backoff and reconnects; slow-start / gradual traffic shifting; admission control.',
    },
  ],

  warStories: [
    {
      title: 'AWS us-east-1 network congestion',
      source: 'AWS, “Summary of the AWS Service Event in the Northern Virginia (US-EAST-1) Region” (December 2021)',
      what: 'An automated capacity-scaling activity triggered unexpected behaviour from a large number of clients inside AWS’s internal network, causing a surge of connection activity that overwhelmed the devices linking the internal and main networks. AWS wrote that its clients had well-tested back-off behaviour, but a latent issue prevented them from backing off adequately, so retries and reconnects kept the congestion going for hours.',
      lesson: 'Backoff is a safety mechanism that only matters in rare conditions, so it must be tested in those conditions; retries are a classic sustaining effect.',
    },
    {
      title: 'DynamoDB metadata service overload',
      source: 'AWS, “Summary of the Amazon DynamoDB Service Disruption” (US-East-1, September 2015)',
      what: 'After a brief network disruption, storage servers simultaneously re-requested membership data from the metadata service. Larger responses (due to Global Secondary Indexes) exceeded the retrieval timeout, so requests failed and were retried, keeping the metadata service saturated until AWS paused requests to it and added capacity.',
      lesson: 'Retries against a shared control service with a too-tight timeout create a self-sustaining loop; recovery needed cutting load, not waiting.',
    },
    {
      title: 'The gateway that charged twice',
      source: 'Composite of common incidents',
      what: 'A gateway was configured to retry “on timeout” for all routes, including `POST /payments`. A database brownout made payment calls exceed the gateway timeout after the charge had been submitted; the gateway retried, and the payment service — which had no idempotency key support — charged a few thousand customers twice.',
      lesson: 'Retry policy must be per route and per method; writes need idempotency keys before they get retries.',
    },
  ],

  // ───────────────────────────── 7. NUMBERS ─────────────────────────────
  numbers: [
    { label: 'Amplification', value: '3³ = 27×, 3⁵ = 243×', note: '3 attempts at 3 or 5 layers' },
    { label: 'Retry budget (Google SRE)', value: '≤ 10% of requests', note: '⇒ ~1.1× worst-case load per layer' },
    { label: 'Linkerd default budget', value: '20% + 10 retries/s', note: '10 s window' },
    { label: 'Envoy retry defaults', value: '1 retry, 25 ms base', note: 'fully jittered, max interval 10× base' },
    { label: 'gRPC retries', value: 'maxAttempts ≤ 5', note: 'throttled when tokens ≤ maxTokens/2' },
    { label: 'AWS SDK standard mode', value: '3 attempts, 20 s cap', note: 'retry quota 500 tokens, 5 per retry, 10 per timeout' },
    { label: 'Full jitter', value: 'random(0, min(cap, base·2ⁿ))', note: 'e.g. base 100 ms, cap 10 s' },
    { label: 'Hedged reads (Tail at Scale)', value: 'p99.9 1,800 → 74 ms', note: '+2% requests, hedge after 10 ms' },
  ],
  capacity: {
    question:
      'A database saturates at 10k qps and normally serves 6k qps. Three layers each retry 3× immediately. A failover halves capacity for 20 s. Does the system recover when capacity returns?',
    steps: [
      'During the failover capacity is 5k < 6k offered, so requests start timing out; assume half of attempts fail (f = 0.5).',
      'One retrying layer: expected attempts = 1 + 0.5 + 0.25 = 1.75 ⇒ 6k × 1.75 = 10.5k qps — already above the **full** 10k capacity.',
      'Three layers: 1.75³ ≈ 5.4 ⇒ ~32k qps offered to the database.',
      'When capacity returns to 10k, offered load (10.5k–32k) is still above it, f stays high, and the loop sustains itself: a metastable failure.',
      'With retries at one layer under a 10% budget: ≤ 6.6k qps ⇒ below 10k once capacity returns, so the system recovers on its own.',
    ],
    answer:
      'No. Naive retries push offered load to 1.75–5.4× (10.5k–32k qps), above even the restored 10k capacity, so the outage outlives the 20 s trigger. A 10% budget at one layer caps load at ~6.6k qps and the system self-heals.',
  },

  // ───────────────────────────── 8. COMPARISON ─────────────────────────────
  comparison: {
    caption: 'Retry strategies under a dependency outage',
    columns: ['Strategy', 'Load at 100% failure', 'Duplicate risk', 'User latency', 'Verdict'],
    rows: [
      ['Immediate ×3 at every layer', 'attempts^layers (27×)', 'High for writes', 'Full timeouts × attempts', 'Anti-pattern'],
      ['Exponential backoff, no jitter', 'Same total, synchronized waves', 'High for writes', 'Long', 'Better, still spiky'],
      ['Backoff + full jitter + budget, one layer', '≤ 1.1–1.2×', 'None with idempotency keys', 'Bounded by deadline', 'Default choice'],
      ['Hedged idempotent reads', '+ a few % (bounded)', 'None (reads)', 'Lower tail latency', 'Good for read tails'],
      ['No retries, fail fast', '1×', 'None', 'Fast error', 'Right for inner layers'],
    ],
  },
  whenNot: [
    'Never retry non-idempotent writes without an idempotency key the server deduplicates on — use keys plus jittered backoff.',
    'Never retry at more than one layer of a call path — pick the layer with the most context and make others fail fast.',
    'Never retry deterministic errors (400, 401, 403, 404, 422) — surface them.',
    'Never retry immediately on overload signals (429, 503 with Retry-After, `RESOURCE_EXHAUSTED`) — wait at least the indicated delay or propagate.',
    'Not in queue consumers — use the broker’s redelivery with visibility-timeout backoff and a dead-letter queue instead of an in-process loop.',
  ],

  // ───────────────────────────── 9. INTERVIEW ─────────────────────────────
  interview: [
    {
      q: 'How can retries turn a 20-second database failover into a two-hour outage?',
      a: 'The failover makes requests slow, so callers time out and retry; with retries at several layers the load multiplies (up to attempts^layers), pushing offered load above even the restored capacity. The system enters a metastable state: retries sustain the overload, queues fill with requests nobody waits for, and goodput collapses even after the trigger ends. Recovery requires cutting load — blocking traffic, disabling retries, dropping expired work — and then ramping back.',
      followUps: ['How would you detect this state?', 'What is goodput and why does it matter here?', 'How do you ramp traffic back?'],
      seniorSignal: 'Explains the sustaining feedback loop and why recovery needs load below the original capacity.',
    },
    {
      q: 'Design the retry policy for mobile app → API gateway → three internal tiers.',
      a: 'Retry in one place for each class of failure: the mobile SDK retries user-level operations with exponential backoff and full jitter, idempotency keys for writes, and honours Retry-After. The gateway/mesh does at most one retry for connection-level failures on idempotent requests under a 10–20% retry budget. Internal tiers fail fast, propagate deadlines and translate overload into non-retryable errors; circuit breakers stop calls during persistent failure.',
      followUps: ['What timeout does each tier get?', 'Which status codes are retryable?', 'How do you enforce this across 50 teams?'],
      seniorSignal: 'Assigns retries to exactly one layer and backs it with budgets, deadlines and idempotency instead of per-team defaults.',
    },
    {
      q: 'Explain full jitter versus equal and decorrelated jitter.',
      a: 'Full jitter sleeps a uniform random time between 0 and min(cap, base × 2^n), spreading retries evenly over the window. Equal jitter keeps half the exponential delay fixed and randomises the other half, so clients remain partially synchronized. Decorrelated jitter picks min(cap, random(base, previous × 3)). In AWS’s simulation full and decorrelated jitter completed the work with far fewer calls; equal jitter did worst among the jittered variants.',
      followUps: ['Why is plain exponential backoff not enough?', 'Does jitter alone prevent retry storms?'],
      seniorSignal: 'Notes that jitter fixes synchronization but not amplification — a budget is still needed.',
    },
    {
      q: 'When is an immediate retry the right thing to do?',
      a: 'When you know the server did no work and the failure is isolated: connection refused, a TLS failure, or a stale pooled connection closed by the server before the request was sent. Retry once on a fresh connection, ideally to a different host, counted against the retry budget. Idempotent reads after a fast failure on one replica also qualify.',
      followUps: ['How does gRPC decide a transparent retry is safe?', 'Why does it matter whether bytes were written?'],
      seniorSignal: 'Reasons from “did the server process it?” rather than from error type alone.',
    },
    {
      q: 'Retry budgets and circuit breakers both limit retries. Do you need both?',
      a: 'They act on different signals. A budget caps retries to a fixed fraction of traffic regardless of cause, bounding amplification even during partial failures where a breaker would stay closed. A breaker stops all calls, not just retries, when failure is persistent and enables a fallback. Use the budget everywhere as a cheap global safety net and breakers on important dependencies.',
      followUps: ['What happens with a 30% failure rate and no budget?', 'Where would you implement the budget?'],
      seniorSignal: 'Identifies the partial-failure regime where only the budget protects you.',
    },
    {
      q: 'Is request hedging just retrying, and when is it safe?',
      a: 'Hedging sends a duplicate of an idempotent request after a delay (e.g. the p95 latency) and uses whichever answer arrives first; it targets tail latency, not errors. It is safe for idempotent reads when bounded — the Tail at Scale BigTable example cut p99.9 from 1,800 ms to 74 ms for 2% extra load. It must be disabled or budgeted under overload, otherwise it becomes another retry storm.',
      followUps: ['How do you pick the hedge delay?', 'How do you cancel the losing request?'],
      seniorSignal: 'Bounds hedging by a budget and ties it to idempotency and cancellation.',
    },
  ],

  takeaways: [
    'Naive retries are free at 1% errors and catastrophic at 50%: amplification grows with failure rate.',
    'Load at the bottom is attempts^layers; retry at one layer only.',
    'Exponential backoff needs full jitter, or clients stay synchronized.',
    'A retry budget (10–20%) bounds the worst case and is the highest-leverage fix.',
    'Retries are the classic sustaining effect of metastable failures; recovery needs load shedding.',
    'Never retry non-idempotent writes without idempotency keys, or deterministic 4xx errors.',
    'Immediate retry is right only when the server provably did nothing and the failure is isolated.',
  ],
};

export default deep;
