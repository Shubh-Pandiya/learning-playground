import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'monitor',

  problem: {
    why:
      'A distributed system fails partially and constantly; you cannot SSH into 2,000 pods to find out why checkout is slow. Monitoring turns behaviour into **signals** — metrics for cheap aggregate trends and alerts, logs for detailed events, traces for where one request spent its time — and turns user-facing objectives (SLOs) into pages only when users are actually being hurt. Without it you learn about outages from customers, and you debug by guessing.',
    withoutIt: [
      'Outages are detected by customers on social media, adding 10–30 minutes to every incident.',
      'Alerting on causes (CPU 80%) pages people for non-problems and misses real ones; on-call ignores the noise.',
      'Averages hide pain: mean latency is fine while 1% of users wait 5 s.',
      'Cross-service latency problems are unfindable without traces; teams blame each other’s services.',
      'Capacity runs out silently — disks fill, connection pools saturate — until something falls over.',
    ],
    position:
      'Out of band, in the control plane: every service emits signals to collectors/scrapers; storage and query live in a separate monitoring stack; alerting routes to humans and to autoscalers. It must keep working when the system it watches is failing.',
    diagram: {
      type: 'flow',
      title: 'Signal pipeline',
      nodes: [
        { label: 'Instrumented code', sub: 'OTel SDK, client libs', tone: 'neutral' },
        { label: 'Collect', sub: 'scrape or push', tone: 'info' },
        { label: 'Store', sub: 'TSDB, log, trace stores', tone: 'violet' },
        { label: 'Evaluate', sub: 'SLO burn rules', tone: 'accent' },
        { label: 'Route & page', sub: 'Alertmanager, PagerDuty', tone: 'warn' },
      ],
    },
  },

  architecture: {
    overview:
      'Three pipelines with different economics. **Metrics**: numeric time series identified by name + labels, scraped or pushed, stored in a compressed TSDB; cost scales with the number of series (cardinality), not traffic. **Logs**: discrete structured events; cost scales with volume (GB/day). **Traces**: trees of spans for single requests; cost scales with traffic × sampling rate. Exemplars and shared trace ids link them so an alert leads to a trace and then to the logs.',
    diagram: {
      type: 'layers',
      title: 'A typical open-source observability stack',
      layers: [
        { name: 'Instrumentation', items: ['OTel SDKs', 'Prometheus client libs', 'Structured logs', 'Exporters'], tone: 'neutral' },
        { name: 'Collection', items: ['Prometheus scrape', 'OTel Collector', 'Fluent Bit', 'Blackbox exporter'], tone: 'info' },
        { name: 'Storage', items: ['Prometheus TSDB', 'Mimir / Thanos (S3)', 'Loki / Elastic', 'Tempo / Jaeger'], tone: 'violet' },
        { name: 'Use', items: ['Grafana dashboards', 'Recording + alert rules', 'Alertmanager', 'SLO reports'], tone: 'accent' },
      ],
    },
    blocks: [
      { name: 'Instrumentation', what: 'Counters, gauges, histograms (latency buckets) and spans created in code via OpenTelemetry or Prometheus client libraries; context propagated in the W3C `traceparent` header.' },
      { name: 'Scraper / collector', what: 'Prometheus pulls `/metrics` from targets found via service discovery every `scrape_interval` (global default 1 m; 15–30 s common). OTel Collector receives OTLP pushes and runs receivers → processors (batch, tail sampling, attributes) → exporters.' },
      { name: 'TSDB head block', what: 'Most recent ~2–3 h of samples in memory per series, protected by a WAL; compressed with Gorilla-style delta-of-delta timestamps and XOR floats (~1–2 bytes/sample).' },
      { name: 'Persistent blocks', what: 'Every 2 h the head is cut into an immutable block (chunks + inverted index of labels → series); blocks are compacted into larger ones; default local retention 15 d. Thanos/Mimir ship blocks to object storage for long retention and global queries.' },
      { name: 'Rule engine', what: 'Recording rules precompute expensive aggregations; alerting rules evaluate PromQL every `evaluation_interval` and fire after the `for:` duration holds.' },
      { name: 'Alertmanager', what: 'Deduplicates, groups (`group_wait` 30 s, `group_interval` 5 m), inhibits and silences alerts, routes by label to PagerDuty/Slack/email; runs as a gossiping HA cluster.' },
      { name: 'Black-box probes', what: 'Synthetic checks from outside (Blackbox exporter, Pingdom, CloudWatch Synthetics) that exercise real user paths — catching DNS, TLS, CDN and LB failures that white-box metrics cannot see.' },
    ],
    real: [
      { name: 'Prometheus', how: 'Single Go binary: pull-based scraping, local TSDB (head + 2 h blocks), PromQL, rule evaluation. Deliberately not clustered — HA by running two identical replicas; scale by sharding scrape targets.' },
      { name: 'Grafana Mimir / Thanos / Cortex', how: 'Horizontally scalable Prometheus-compatible backends: ingesters build blocks and upload to S3/GCS; queriers fan out across blocks; HA pairs are deduplicated at query time. Monarch (Google) and M3 (Uber) solve the same problem in-house.' },
      { name: 'OpenTelemetry', how: 'Vendor-neutral API/SDKs and the Collector; OTLP as wire protocol for traces, metrics and logs. Lets you switch backends (Jaeger, Tempo, Honeycomb, Datadog) without re-instrumenting.' },
      { name: 'Datadog / New Relic / Honeycomb', how: 'SaaS: agents push metrics/logs/traces; managed storage and correlation. Billing per host, per custom metric series, per GB ingested/indexed and per span — cardinality and log volume drive cost. Honeycomb is built around high-cardinality event queries.' },
      { name: 'Google Borgmon → Monarch', how: 'Borgmon inspired Prometheus’ pull model and rule language; Monarch is Google’s planet-scale, regionally partitioned in-memory TSDB, described in a 2020 VLDB paper.' },
    ],
  },

  lifecycle: {
    summary:
      'Time from a user-facing failure to a human being paged, with a typical Prometheus + Alertmanager setup. Values are detection latency in ms: ~3 minutes, mostly from deliberate waiting (`for:` and grouping) that trades speed for fewer false pages.',
    stages: [
      { stage: 'Counter increment', what: '`http_requests_total{code="500"}` incremented in-process (atomic add).', cost: 'Nanoseconds', ms: 0.01 },
      { stage: 'Histogram observe', what: 'Latency recorded into a fixed bucket; no per-request storage.', cost: 'Nanoseconds', ms: 0.01 },
      { stage: 'Scrape wait', what: 'Sample becomes visible at the next scrape (15 s interval; avg half).', cost: '0–15 s', ms: 7500 },
      { stage: 'Ingest', what: 'Appended to the head block and WAL; existing series ⇒ ~bytes.', cost: 'ms per scrape', ms: 1 },
      { stage: 'Rule evaluation', what: 'Next `evaluation_interval` tick computes the burn rate.', cost: '0–15 s', ms: 7500 },
      { stage: '`for:` duration', what: 'Condition must hold for 2 m before firing, filtering blips.', cost: 'Configured', ms: 120000 },
      { stage: 'Alertmanager grouping', what: '`group_wait` 30 s collects related alerts into one notification.', cost: '30 s default', ms: 30000 },
      { stage: 'Page delivered', what: 'PagerDuty push/phone call to on-call.', cost: '~5–30 s', ms: 10000 },
    ],
  },

  deepDives: [
    {
      title: 'Metrics vs logs vs traces — and how to link them',
      hook: 'Each signal answers a different question at a different cost; the value is in the links.',
      body: [
        'Metrics answer “is something wrong and how much?” cheaply: a histogram costs the same at 10 or 10 million req/s, but every label combination is a new series, so metrics cannot hold per-user or per-request detail. Logs answer “what exactly happened in this event?” and are priced per GB. Traces answer “where did this request spend its time across services?” and are priced per span, so they are sampled.',
        'Linking is what makes them useful in an incident: **exemplars** attach a trace id to a histogram bucket sample (Prometheus/OpenMetrics), logs carry `trace_id` and `span_id`, and trace spans carry the same service/route labels as metrics. Dashboard spike → exemplar trace → the slow span → the logs of that span.',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Metrics', tone: 'ok', points: ['Aggregates, low cardinality', 'Cost ∝ series count', 'Alerting, trends, SLOs'] },
          { name: 'Logs', tone: 'info', points: ['Discrete rich events', 'Cost ∝ GB ingested', 'Forensics, audit'] },
          { name: 'Traces', tone: 'violet', points: ['Causal request tree', 'Cost ∝ spans kept', 'Latency across services'] },
        ],
      },
      insight:
        'Wide structured events (one rich log/span per request with many fields) can answer most questions on their own; what they cannot do cheaply is long-range trends and alerting — keep metrics for those, events for exploration.',
    },
    {
      title: 'Prometheus TSDB and the cardinality problem',
      hook: 'Series count, not request rate, is what kills a metrics backend.',
      body: [
        'Each unique combination of metric name and label values is a **series** with its own in-memory head chunk, index entries and WAL records — a rule of thumb is a few KB of RAM per active series. Cardinality multiplies: `http_request_duration_seconds_bucket` with 12 buckets × 30 routes × 5 status codes × 200 pods = 360,000 series from one metric. Add a `user_id` label and it becomes unbounded; Prometheus runs out of memory.',
        'Samples flow: scrape → head block (memory + WAL) → every 2 h an immutable on-disk block (chunks + label index) → background compaction into larger blocks → deletion after retention. Remote write or a Thanos sidecar ships data to object storage for long retention.',
        'Pull model consequences: Prometheus knows when a target is down (`up == 0`), controls its own ingest rate, but needs to reach targets. Short-lived batch jobs push to the **Pushgateway**, which is meant only for service-level batch results — it never expires series on its own and becomes a single point of failure if used for per-instance metrics.',
      ],
      diagram: {
        type: 'flow',
        title: 'Prometheus storage path',
        nodes: [
          { label: 'Scrape', sub: 'every 15–30 s', tone: 'info' },
          { label: 'Head block', sub: 'memory + WAL', tone: 'accent' },
          { label: '2 h block', sub: 'chunks + index', tone: 'neutral' },
          { label: 'Compaction', sub: 'larger blocks', tone: 'neutral' },
          { label: 'Object storage', sub: 'Thanos / Mimir', tone: 'violet' },
        ],
      },
      code: {
        lang: 'text',
        caption: 'PromQL: find what is exploding',
        code: `# top 10 metric names by series count
topk(10, count by (__name__) ({__name__=~".+"}))

# total active series in the head
prometheus_tsdb_head_series

# per-target guard in scrape config
#   sample_limit: 50000   -> scrape fails instead of OOMing Prometheus`,
      },
      insight:
        'Put unbounded identifiers (user, request, order ids) in logs and trace attributes, never in metric labels. If you need per-customer metrics, bound them (top-N tenants) or use a high-cardinality event store.',
    },
    {
      title: 'SLOs, error budgets and multi-window burn-rate alerts',
      hook: 'Page on how fast you are spending the error budget, not on a static threshold.',
      body: [
        'An **SLI** is a ratio of good events to valid events (non-5xx responses; requests under 300 ms). An **SLO** is a target for it over a window (99.9% over 30 days). The **error budget** is 1 − SLO: 0.1% of requests, or ~43 minutes of full outage per 30 days. Burn rate 1 spends the budget exactly over the window; burn rate 14.4 spends 2% of a 30-day budget in one hour.',
        'The Google SRE Workbook recommends **multi-window, multi-burn-rate** alerts: a long window to ensure significance and a short window (1/12 of it) so the alert stops soon after the problem ends. Fast burns page; slow burns open tickets.',
      ],
      table: {
        caption: 'SRE Workbook recommended thresholds for a 30-day SLO',
        columns: ['Budget consumed', 'Long window', 'Short window', 'Burn rate', 'Action'],
        rows: [
          ['2%', '1 h', '5 min', '14.4', 'Page'],
          ['5%', '6 h', '30 min', '6', 'Page'],
          ['10%', '3 d', '6 h', '1', 'Ticket'],
        ],
      },
      code: {
        lang: 'yaml',
        caption: 'Fast-burn page for a 99.9% availability SLO',
        code: `- alert: CheckoutErrorBudgetFastBurn
  expr: |
    (
      sum(rate(http_requests_total{job="checkout",code=~"5.."}[1h]))
      / sum(rate(http_requests_total{job="checkout"}[1h]))
    ) > (14.4 * 0.001)
    and
    (
      sum(rate(http_requests_total{job="checkout",code=~"5.."}[5m]))
      / sum(rate(http_requests_total{job="checkout"}[5m]))
    ) > (14.4 * 0.001)
  labels: { severity: page }
  annotations: { runbook: "https://runbooks/checkout-slo" }`,
      },
      insight:
        'An SLO is also a decision tool: when the budget is exhausted, the agreed response (freeze risky launches, prioritize reliability) matters more than the alert. Without that agreement, SLOs are just dashboards.',
    },
    {
      title: 'Health checks: shallow vs deep, black-box vs white-box',
      hook: 'A health check that fails everywhere at once is an outage generator.',
      body: [
        '**Shallow** checks (process up, can serve a trivial request) are safe for load balancers and orchestrators because failures are local. **Deep** checks (can reach the DB, the cache, the payment provider) tell you more but fail on every instance at the same time when a shared dependency blips — and whoever consumes them will remove or restart the whole fleet.',
        'Load balancers defend against this by **failing open**: an AWS ALB routes to all targets if all are unhealthy, and Envoy’s panic threshold (default 50% healthy) ignores health status when too many hosts are ejected. Your own automation should do the same.',
        '**White-box** monitoring reads internal metrics; **black-box** probes the system from outside like a user (DNS, TLS, CDN, LB, app). You need both: white-box explains, black-box proves users can actually get in.',
      ],
      table: {
        columns: ['Check', 'Consumer', 'Checks', 'Risk'],
        rows: [
          ['Liveness (shallow)', 'Orchestrator restarts', 'Process responsive', 'Restart storm if it checks deps'],
          ['Readiness (shallow+local)', 'LB / endpoints', 'Warm, not draining, not overloaded', 'All-unready ⇒ fail open or 503'],
          ['Deep dependency check', 'Dashboards, alerts', 'DB, cache, third parties', 'Correlated failure if used for routing'],
          ['Synthetic (black-box)', 'On-call, status page', 'Real user journey from outside', 'Flaky probes ⇒ noise'],
        ],
      },
      insight:
        'Facebook’s 2021 outage was amplified by a health-driven automation: DNS servers that could not reach the data centers withdrew their own BGP routes. Health signals that trigger self-removal need a global sanity check (“am I the only one failing?”).',
    },
    {
      title: 'Tracing pipelines: head vs tail sampling',
      hook: 'Keeping 1% of traces at random keeps 1% of your errors — usually not the ones you need.',
      body: [
        '**Head sampling** decides at the root span (e.g. 1% by trace id hash) and propagates the decision in `traceparent` flags; cheap and consistent, but blind to outcome. **Tail sampling** buffers all spans of a trace and decides after it completes: keep all errors, all requests over 1 s, and 1% of the rest.',
        'Tail sampling requires every span of a trace to reach the **same** collector instance: a first tier of OTel Collectors uses the `loadbalancing` exporter keyed by trace id to route to a second tier running the `tail_sampling` processor, which waits `decision_wait` (default 30 s) before deciding. Memory = spans/s × decision wait.',
      ],
      diagram: {
        type: 'flow',
        title: 'Two-tier OTel Collector for tail sampling',
        nodes: [
          { label: 'Services', sub: 'OTLP spans', tone: 'neutral' },
          { label: 'Agent collectors', sub: 'batch, enrich', tone: 'info' },
          { label: 'LB exporter', sub: 'route by trace id', tone: 'accent' },
          { label: 'Sampling tier', sub: 'tail_sampling 30 s', tone: 'warn' },
          { label: 'Tempo / Jaeger', sub: 'kept traces', tone: 'violet' },
        ],
      },
      code: {
        lang: 'yaml',
        code: `processors:
  tail_sampling:
    decision_wait: 30s
    policies:
      - name: errors
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: slow
        type: latency
        latency: { threshold_ms: 1000 }
      - name: baseline
        type: probabilistic
        probabilistic: { sampling_percentage: 1 }`,
      },
      insight:
        'Sampling biases derived metrics: never compute request rates or error ratios from sampled traces unless you weight by sampling rate — compute RED metrics from unsampled counters (or span-metrics generated before sampling).',
    },
    {
      title: 'What to measure and when to page',
      hook: 'Dashboards can be noisy; pages must be rare, urgent and actionable.',
      body: [
        'Frameworks for coverage: Google’s **four golden signals** (latency, traffic, errors, saturation) for user-facing systems; **RED** (rate, errors, duration) per service and route; **USE** (utilization, saturation, errors) per resource — CPU, disk, pools, queues. RED tells you users are hurting; USE tells you which resource is why.',
        'Alert fatigue comes from paging on causes (CPU 80%, a single pod restart) and on things nobody can act on. Rules of thumb: page only on SLO burn and imminent resource exhaustion (disk full in < 4 h via `predict_linear`), route everything else to tickets or dashboards, every page has a runbook and an owner, and review page volume weekly.',
      ],
      bullets: [
        'Latency: histograms, never averages; alert on the fraction of requests over a threshold.',
        'Separate successful and failed request latency — fast errors make averages look great.',
        'Saturation: queue depth and pool wait time often lead CPU by minutes.',
        'Meta-monitoring: a dead man’s switch alert that always fires, so silence itself pages.',
      ],
      insight:
        'You cannot average percentiles across instances or time windows; aggregate histogram buckets first (`histogram_quantile(0.99, sum by (le) (rate(..._bucket[5m])))`), then compute the quantile.',
    },
  ],

  scaling: {
    body: [
      'Prometheus scales by **sharding**: functional (one per team/cluster) or hashmod across targets; global views come from Thanos/Mimir querying many sources plus object storage. HA is two identical replicas scraping the same targets, deduplicated at query time; Alertmanager instances gossip to dedupe notifications.',
      'Monitoring must fail **independently** of what it monitors: different cluster, different region or a SaaS vendor, its own DNS and auth path. Out-of-band black-box probes from outside your cloud catch the failures your in-cluster stack shares with your app.',
      'Multi-region: keep collection and alerting regional (so a region alerts on itself even when cut off) and aggregate globally for dashboards. The global layer being down must not stop regional paging.',
    ],
    bullets: [
      'Budget cardinality per team; enforce `sample_limit`, label allow-lists and relabeling at ingest.',
      'Recording rules for expensive SLO queries keep dashboards and alerts fast.',
      'Logs: sample or drop debug logs at the edge; index only fields you query (Loki indexes labels, not content).',
      'Traces: tail sampling tier sized for spans/s × decision wait.',
      'Dead man’s switch to an external service (e.g. healthchecks endpoint) proves the alert pipeline works.',
      'Status pages hosted independently of the product infrastructure.',
    ],
    diagram: {
      type: 'layers',
      title: 'Independent failure domains',
      layers: [
        { name: 'External', items: ['Synthetic probes', 'Status page', 'Dead man’s switch'], tone: 'warn' },
        { name: 'Global', items: ['Thanos/Mimir query', 'Long-term S3', 'Global dashboards'], tone: 'violet' },
        { name: 'Regional', items: ['Prometheus HA pair', 'Alertmanager cluster', 'OTel collectors'], tone: 'accent' },
        { name: 'Workloads', items: ['Services', 'Exporters', 'Logs agents'], tone: 'neutral' },
      ],
    },
  },

  failures: [
    {
      name: 'Cardinality explosion',
      symptom: 'Prometheus memory climbs until OOM after a deploy adds a high-cardinality label; dashboards time out; SaaS bill spikes.',
      detect: '`prometheus_tsdb_head_series` growth, `scrape_series_added`, `prometheus_target_scrapes_exceeded_sample_limit_total`, vendor custom-metric usage alerts.',
      mitigate: '`sample_limit` per job, relabel to drop labels, label allow-lists in CI, move ids to logs/traces.',
    },
    {
      name: 'Alert fatigue',
      symptom: 'Dozens of pages per shift, most auto-resolve; on-call mutes channels and misses the real incident.',
      detect: 'Pages per on-call shift, % of pages with no action taken, mean time to acknowledge trending up.',
      mitigate: 'Page only on SLO burn and imminent exhaustion; delete or demote non-actionable alerts; Alertmanager grouping and inhibition.',
    },
    {
      name: 'Monitoring shares fate with the system',
      symptom: 'An outage takes down the metrics stack, status page or paging integration too; nobody is notified.',
      detect: 'Dead man’s switch stops arriving at the external receiver; external synthetic probes fail while internal dashboards are blank.',
      mitigate: 'Separate failure domains, external probes, out-of-band status page, regional alerting independent of global layer.',
    },
    {
      name: 'Averages and sampled data hide problems',
      symptom: 'Mean latency and sampled traces look healthy while a cohort of users sees multi-second responses or errors.',
      detect: 'SLIs on percentiles/thresholds; latency split by route, region, client version; tail-sampled error traces.',
      mitigate: 'Histograms, SLO on “% under threshold”, compute RED from unsampled counters, tail sampling for errors.',
    },
    {
      name: 'Health checks that remove everything',
      symptom: 'A shared dependency blip makes every instance fail a deep health check; LB or orchestration removes the whole fleet.',
      detect: 'Healthy host count dropping to 0 simultaneously (`envoy_cluster_membership_healthy`, ALB `HealthyHostCount`).',
      mitigate: 'Shallow checks for routing, fail-open (panic threshold), deep checks only for alerting.',
    },
  ],

  warStories: [
    {
      title: 'AWS S3 outage: the status dashboard ran on S3',
      source: 'AWS post-event summary, February 2017 (us-east-1)',
      what:
        'A mistyped command during debugging removed more S3 index and placement servers than intended, and S3 in us-east-1 was unavailable for hours. The AWS Service Health Dashboard could not be updated because its administration depended on S3, so AWS communicated via Twitter until it was fixed.',
      lesson: 'Your monitoring and status communication must not depend on the systems they report on.',
    },
    {
      title: 'Facebook: health checks withdrew DNS from the internet',
      source: 'Facebook engineering blog, October 2021',
      what:
        'A maintenance command accidentally disconnected Facebook’s backbone. DNS servers, designed to withdraw their BGP advertisements when they could not reach the data centers, all did so — making Facebook, Instagram and WhatsApp unreachable for about six hours, and taking internal tools down with them.',
      lesson: 'Automated self-removal on failed health checks needs protection against everyone failing at once, and recovery tools need out-of-band paths.',
    },
    {
      title: 'Datadog: a monitoring vendor down everywhere at once',
      source: 'Datadog incident post-mortem, March 2023',
      what:
        'An automatic OS security update (systemd) applied across many hosts at roughly the same time broke networking on those nodes in several regions and clouds simultaneously. Customers lost metrics, logs and alerting for many hours during recovery.',
      lesson: 'Even SaaS monitoring can fail globally; keep a minimal independent path (synthetic probes, a dead man’s switch to another provider) for critical alerting.',
    },
    {
      title: 'The user_id label',
      source: 'Composite of common incidents',
      what:
        'An engineer added `customer_id` to a latency histogram “for debugging”. Series jumped from ~2M to ~40M within an hour of the deploy; both Prometheus replicas OOMed and restarted in a loop replaying the WAL, leaving the company without metrics or alerts during a busy period.',
      lesson: 'Enforce cardinality limits at ingest (`sample_limit`, relabel rules) and review label changes like schema changes.',
    },
  ],

  numbers: [
    { label: '99.9% over 30 days', value: '43.2 min budget', note: '99.99% ⇒ 4.3 min' },
    { label: 'Fast-burn page', value: '14.4× over 1 h & 5 m', note: '2% of 30-day budget' },
    { label: 'Prometheus sample size', value: '~1–2 bytes', note: 'Gorilla-style compression' },
    { label: 'RAM per active series', value: '~few KB', note: 'rule of thumb for head block' },
    { label: 'Prometheus block / retention', value: '2 h / 15 d', note: 'defaults' },
    { label: 'Scrape interval', value: '15–30 s typical', note: 'global default 1 m' },
    { label: 'Alertmanager group_wait', value: '30 s', note: 'group_interval 5 m, repeat 4 h' },
    { label: 'OTel tail sampling decision_wait', value: '30 s', note: 'memory ∝ spans/s × wait' },
    { label: 'Fan-out of 1 histogram', value: 'buckets × labels × pods', note: '12 × 150 × 200 = 360k series' },
  ],

  capacity: {
    question:
      'Plan a Prometheus setup for 2,000 pods exposing ~1,500 series each, scraped every 15 s, with 15 days local retention.',
    steps: [
      'Active series: 2,000 × 1,500 = 3M series (plus churn from deploys — budget 1.5× ⇒ ~4.5M).',
      'Ingest: 3M / 15 s = 200k samples/s.',
      'Disk: 200k × ~1.5 B ≈ 300 KB/s ≈ 26 GB/day ⇒ ~390 GB for 15 days (plus WAL and compaction headroom ⇒ ~600 GB).',
      'Memory: ~4.5M series × ~4 KB ≈ 18 GB for the head, plus query headroom ⇒ 32–64 GB per instance.',
      'HA and scale: one HA pair is at the upper comfortable limit; shard into 2–3 functional Prometheus pairs and use Thanos/Mimir for global queries and long retention in S3.',
    ],
    answer:
      '~200k samples/s, ~3–4.5M series: 2–3 Prometheus HA pairs with ~64 GB RAM and ~600 GB SSD each, plus object storage for long-term data — or a horizontally scaled Mimir cluster.',
  },

  comparison: {
    caption: 'Observability backends',
    columns: ['Product', 'Signal', 'Model', 'Storage', 'Cost driver'],
    rows: [
      ['Prometheus', 'Metrics', 'Pull, PromQL, local rules', 'Local TSDB, 15 d default', 'RAM per series (cardinality)'],
      ['Mimir / Thanos', 'Metrics', 'Prometheus-compatible, horizontally scaled', 'Object storage blocks', 'Series + query load'],
      ['Datadog', 'All three', 'Agent push, SaaS', 'Managed', 'Hosts, custom metrics, GB, spans'],
      ['Loki / Elasticsearch', 'Logs', 'Label index (Loki) / full-text index (ES)', 'Object store / Lucene shards', 'GB ingested and indexed'],
      ['Tempo / Jaeger', 'Traces', 'OTLP ingest, trace-id lookup', 'Object store / Cassandra/ES', 'Spans kept × retention'],
      ['CloudWatch', 'All three (AWS)', 'Push from AWS services/agents', 'Managed', 'Metrics, API calls, GB'],
    ],
  },

  whenNot: [
    'Per-user or per-request analytics: use an event store / analytics DB, not metric labels.',
    'Business-critical counts (billing, inventory): monitoring pipelines drop and sample data — compute them from the source of truth.',
    'Audit trails: immutable audit logs with retention guarantees, not debug log pipelines.',
    'Control decisions needing exact, real-time data (rate limiting, fraud blocks): use purpose-built counters in the request path, not scraped metrics that are 15–60 s old.',
  ],

  interview: [
    {
      q: 'What would you alert on for a new user-facing service?',
      a: 'Define SLIs on user experience — availability (non-5xx ratio) and latency (fraction of requests under a threshold) — and set SLOs. Page on multi-window burn-rate alerts (e.g. 14.4× over 1 h and 5 m), ticket on slow burns. Add pages only for imminent exhaustion (disk full soon, certificate expiry). Everything else — CPU, single pod restarts — goes to dashboards. Each page has a runbook.',
      followUps: ['Why two windows?', 'How would you alert on a low-traffic service?', 'What does the team do when the budget is exhausted?'],
      seniorSignal: 'Pages on symptoms via budget burn and treats alert count as a quality metric.',
    },
    {
      q: 'Prometheus is running out of memory. How do you debug and prevent it?',
      a: 'It is almost always cardinality: check `prometheus_tsdb_head_series` and find top metrics and labels by series count with `count by (__name__)`. Look for unbounded labels (ids, URLs with parameters) and churn from short-lived pods. Fix via relabeling to drop labels, `sample_limit` per scrape job, CI checks on new labels, and sharding. Long-term, move high-cardinality questions to logs, traces or event stores.',
      followUps: ['What is series churn and why does it hurt?', 'How do histograms affect cardinality?', 'When would you shard vs move to Mimir?'],
      seniorSignal: 'Reasons about series count and churn, not traffic, and puts guardrails at ingest.',
    },
    {
      q: 'Head vs tail sampling for traces — which and why?',
      a: 'Head sampling is cheap and consistent but random, so it misses most rare errors and slow requests. Tail sampling keeps errors and slow traces after seeing the outcome, but needs all spans of a trace routed to the same collector (load-balancing by trace id) and memory for the decision window. A common setup: tail sampling for errors and slow requests plus a small probabilistic baseline, and RED metrics computed from unsampled data.',
      followUps: ['How do you route spans to the same collector?', 'Why not compute error rates from traces?', 'What happens with very long traces?'],
      seniorSignal: 'Knows the operational requirements of tail sampling and the bias in sampled data.',
    },
    {
      q: 'Shallow vs deep health checks — what goes where?',
      a: 'Shallow, local checks for anything that routes or restarts (LB, liveness, readiness), because failures there are per-instance. Deep checks of dependencies go to dashboards and alerts, because they fail on every instance at once and would remove the whole fleet. Load balancers mitigate with fail-open (ALB all-unhealthy behaviour, Envoy panic threshold). Black-box probes from outside verify the real user path.',
      followUps: ['What does fail-open mean in an ALB or Envoy?', 'How did health checks contribute to Facebook’s 2021 outage?', 'Where should synthetic probes run?'],
      seniorSignal: 'Thinks in terms of correlated failure and who consumes each check.',
    },
    {
      q: 'How do you make monitoring reliable?',
      a: 'Separate failure domains from production (cluster, region, or vendor), HA pairs with query-time dedupe, Alertmanager clustering, and a dead man’s switch that pages if alerts stop arriving. External synthetic probes catch DNS/CDN/LB failures. Regional alerting keeps working when the global layer is down, and the status page is hosted independently. Test it: break things in game days and verify pages arrive.',
      followUps: ['What is a dead man’s switch?', 'How did the 2017 S3 outage illustrate this?', 'How do you monitor the alerting pipeline itself?'],
      seniorSignal: 'Treats monitoring as a system that needs its own SLO and independent failure domain.',
    },
    {
      q: 'Why can’t you average p99s, and how should latency be measured?',
      a: 'Percentiles are not additive: the mean of per-pod p99s is not the fleet p99, and a p99 over 5 minutes cannot be derived from 1-minute p99s. Record histograms, sum bucket rates across instances, then compute quantiles; or define SLIs as the fraction of requests under a threshold, which is additive. Separate successful and failed requests, because fast errors make latency look better.',
      followUps: ['How do bucket boundaries affect accuracy?', 'What are native histograms?', 'What about client-side vs server-side latency?'],
      seniorSignal: 'Understands the math of percentile aggregation and designs SLIs to be aggregatable.',
    },
  ],

  takeaways: [
    'Metrics for alerting and trends, logs for events, traces for cross-service latency — linked by trace ids and exemplars.',
    'Metrics cost scales with cardinality; never label with unbounded ids.',
    'Page on SLO burn rate (multi-window), not on causes like CPU.',
    'Health checks used for routing must be shallow; deep checks fail everywhere at once.',
    'Tail sampling keeps the interesting traces but needs trace-id-aware routing.',
    'Aggregate histograms, never percentiles.',
    'Monitoring must fail independently of the system it watches — plus a dead man’s switch.',
  ],
};

export default deep;
