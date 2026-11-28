import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'autoscaler',

  problem: {
    why:
      'Load changes by 3–10× over a day and spikes faster than humans react. Provisioning for peak wastes most of the fleet most of the time; provisioning for average fails every evening. An autoscaler is a **feedback controller** that keeps a measured signal near a target by changing capacity — and like every controller, its hard parts are lag, noise and side effects on everything downstream.',
    withoutIt: [
      'Static fleets sized for peak: 50–70% of compute idle off-peak.',
      'Static fleets sized for average: queue backlogs and timeouts at every daily peak or launch.',
      'Humans paged at 3 a.m. to add instances, and forgetting to remove them.',
      'Worker pools that cannot keep up with bursty queues, so message age (and SLA misses) grows for hours.',
    ],
    position:
      'A control-plane loop beside the data plane: it reads metrics (metrics-server, Prometheus, CloudWatch, queue APIs) and writes desired capacity to the orchestrator (Deployment replicas, ASG desired count, node provisioning). It is never in the request path.',
    diagram: {
      type: 'flow',
      title: 'A feedback loop with lag at every step',
      nodes: [
        { label: 'Load changes', tone: 'neutral' },
        { label: 'Metric observed', sub: '15–60 s lag', tone: 'info' },
        { label: 'Controller decides', sub: 'formula + damping', tone: 'accent' },
        { label: 'Capacity created', sub: 'pods s, nodes min', tone: 'warn' },
        { label: 'Metric recovers', sub: 'feeds back', tone: 'ok' },
      ],
      caption: 'Total reaction time is the sum of all lags — usually 1–5 minutes.',
    },
  },

  architecture: {
    overview:
      'Every autoscaler has the same parts: a **metrics pipeline**, a **control loop** that runs periodically, a **policy** that turns metrics into a desired count, a **damper** (stabilization windows, rate limits, min/max) that keeps it stable, and an **actuator** that changes capacity. In Kubernetes there are two layers: pod autoscalers (HPA, KEDA, VPA) change how many pods you want; node autoscalers (Cluster Autoscaler, Karpenter) make room for them.',
    diagram: {
      type: 'layers',
      title: 'Kubernetes autoscaling stack',
      layers: [
        { name: 'Signals', items: ['metrics-server (CPU/mem)', 'Prometheus Adapter', 'KEDA scalers (SQS, Kafka)'], tone: 'info' },
        { name: 'Pod autoscaling', items: ['HPA control loop', 'behavior policies', 'VPA (requests)'], tone: 'accent' },
        { name: 'Scheduling', items: ['kube-scheduler', 'Pending pods', 'Priority / preemption'], tone: 'neutral' },
        { name: 'Node autoscaling', items: ['Cluster Autoscaler → ASG', 'Karpenter → EC2 Fleet', 'Consolidation'], tone: 'violet' },
      ],
      caption: 'HPA creates pods; node autoscalers react to pods that cannot be scheduled.',
    },
    blocks: [
      { name: 'Metrics pipeline', what: 'metrics-server scrapes kubelets (~15 s resolution) for CPU/memory; custom/external metrics come via Prometheus Adapter or KEDA’s metrics server; AWS uses CloudWatch (1-minute metrics typical).' },
      { name: 'Control loop', what: 'HPA runs in kube-controller-manager every `--horizontal-pod-autoscaler-sync-period` (15 s). It averages the metric across ready pods, ignoring not-yet-ready pods for CPU during the initialization period.' },
      { name: 'Scaling policy', what: '`desired = ceil(current × currentMetric / target)`; skipped if the ratio is within the 10% tolerance; with multiple metrics the largest desired count wins.' },
      { name: 'Stabilizer', what: '`behavior.scaleDown.stabilizationWindowSeconds` (default 300) takes the highest recommendation over the window; rate policies (e.g. +100% or +4 pods per 15 s for scale-up by default) cap the step size.' },
      { name: 'Actuator', what: 'Patches the `/scale` subresource of a Deployment/StatefulSet, or sets ASG desired capacity. Node autoscalers launch instances when pods are `Pending` with `Unschedulable`.' },
      { name: 'Bounds', what: '`minReplicas` (enough to survive an AZ loss and absorb a spike during lag) and `maxReplicas` (what downstream dependencies and budgets can afford).' },
    ],
    real: [
      { name: 'Kubernetes HPA (autoscaling/v2)', how: 'Ratio controller with tolerance, multiple metric types (Resource, Pods, Object, External), and a `behavior` field for per-direction policies and stabilization windows. CPU utilization is a percentage of the pod’s **requests**.' },
      { name: 'KEDA', how: 'Event-driven autoscaler with 60+ scalers (SQS, Kafka lag, Redis lists, Prometheus, cron). Creates and drives an HPA for 1↔N and handles 0↔1 itself, enabling scale-to-zero; `pollingInterval` 30 s and `cooldownPeriod` 300 s by default.' },
      { name: 'Cluster Autoscaler / Karpenter', how: 'Cluster Autoscaler simulates scheduling against node groups (ASGs) and bumps their size; scales down nodes unneeded for 10 min by default. Karpenter watches unschedulable pods, picks instance types directly via EC2 Fleet, and consolidates underused nodes.' },
      { name: 'AWS EC2 Auto Scaling', how: 'Target tracking (e.g. CPU 50%, `ALBRequestCountPerTarget`), step scaling, scheduled actions, predictive scaling (forecast from history), warm pools of pre-initialized stopped/running instances, lifecycle hooks for draining.' },
      { name: 'Netflix Scryer', how: 'Predictive autoscaling (2013): forecasts traffic from historical daily/weekly patterns and pre-scales ASGs ahead of the evening peak, with reactive scaling as a safety net.' },
    ],
  },

  lifecycle: {
    summary:
      'One scale-up event from a traffic spike to new capacity serving, when a new node is needed. Values are reaction time in ms (not per-request latency): about 2 minutes end to end, during which existing pods must absorb the spike.',
    stages: [
      { stage: 'Metric freshness', what: 'Kubelet/cAdvisor stats aggregated by metrics-server; the spike becomes visible.', cost: '~15 s resolution', ms: 15000 },
      { stage: 'HPA sync wait', what: 'Next control-loop tick (every 15 s; avg half that).', cost: '0–15 s', ms: 7500 },
      { stage: 'Compute desired', what: '`ceil(10 × 90/60) = 15`; outside 10% tolerance; within scale-up rate policy.', cost: 'Negligible', ms: 1 },
      { stage: 'Scale + schedule', what: 'Deployment scaled, ReplicaSet creates pods, scheduler finds no room ⇒ `Pending`.', cost: 'API + scheduler', ms: 1000 },
      { stage: 'Node provisioning', what: 'Karpenter/Cluster Autoscaler launches an instance; boot, kubelet registers, CNI ready.', cost: '~40–120 s', ms: 60000 },
      { stage: 'Image pull', what: 'Container image pulled to the new node (cached on existing nodes).', cost: '~5–30 s', ms: 10000 },
      { stage: 'App start + readiness', what: 'JVM boot, config load, pool warm-up, readiness probe passes.', cost: '~5–60 s', ms: 20000 },
      { stage: 'Join load balancing', what: 'EndpointSlice updated; ALB target registration and health checks.', cost: '~1–30 s', ms: 10000 },
    ],
  },

  deepDives: [
    {
      title: 'The HPA control loop, precisely',
      hook: 'A ratio controller with tolerance and asymmetric damping — small details decide stability.',
      body: [
        'Each sync, HPA computes `desiredReplicas = ceil(currentReplicas × currentMetricValue / desiredMetricValue)`. If `currentMetric / target` is within 1 ± 0.1 (`--horizontal-pod-autoscaler-tolerance`), it does nothing. With several metrics it computes each and takes the **maximum**, so adding a metric can only make it scale up more eagerly.',
        'Edge cases matter: pods without metrics are treated conservatively (assumed 100% of target on scale-down, 0% on scale-up) and not-yet-ready pods are excluded for CPU during start-up, so JIT warm-up CPU does not trigger more scale-up. Scale-down uses the highest recommendation within the 300 s stabilization window; scale-up has no window by default.',
        'CPU utilization is relative to the container’s **CPU request**, not to the node. Wrong requests produce wrong scaling: requests set too low make every pod look 200% busy.',
      ],
      code: {
        lang: 'yaml',
        caption: 'autoscaling/v2: fast up, slow down',
        code: `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: api }
  minReplicas: 6          # survives 1 AZ loss at baseline
  maxReplicas: 120        # bounded by DB connection budget
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 60 } }
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies: [{ type: Percent, value: 100, periodSeconds: 15 }]
    scaleDown:
      stabilizationWindowSeconds: 300
      policies: [{ type: Percent, value: 10, periodSeconds: 60 }]`,
      },
      insight:
        'Do not run HPA on CPU and VPA on CPU for the same workload: VPA changes requests, which changes utilization, which makes HPA move — two controllers fighting over one variable.',
    },
    {
      title: 'Choosing the scaling signal',
      hook: 'Scale on what saturates first and what users feel — but never on something your scaling makes worse.',
      body: [
        '**CPU** works for CPU-bound stateless services and is built in, but it lags for I/O-bound services and drops when threads are blocked on a slow dependency (so the autoscaler scales **in** during an outage). **Requests per pod / concurrency** tracks demand directly when per-pod capacity is known (Knative concurrency, `ALBRequestCountPerTarget`).',
        'For workers, scale on **backlog per worker** or **age of oldest message**: `desired = ceil(backlog / (rate per worker × acceptable delay))`. KEDA’s SQS/Kafka scalers do exactly that, and can scale to zero when idle.',
        '**Latency** is a poor primary signal: it rises when a dependency is slow, and adding replicas then adds load to that dependency. Use it for alerting, not for scaling.',
      ],
      table: {
        columns: ['Signal', 'Good for', 'Lag', 'Failure mode'],
        rows: [
          ['CPU utilization', 'CPU-bound APIs', '30–60 s', 'Scales in when blocked on I/O'],
          ['RPS / concurrency per pod', 'Request-driven services', 'Seconds', 'Needs known per-pod capacity'],
          ['Queue backlog per worker', 'Async workers', 'Poll interval', 'Ignores message cost variance'],
          ['Oldest message age / lag', 'SLA-bound pipelines', 'Poll interval', 'Reacts only once already late'],
          ['Latency p99', 'Alerting, not scaling', 'Minutes', 'Positive feedback on slow deps'],
        ],
      },
      code: {
        lang: 'yaml',
        caption: 'KEDA ScaledObject on SQS backlog',
        code: `apiVersion: keda.sh/v1alpha1
kind: ScaledObject
spec:
  scaleTargetRef: { name: invoice-worker }
  minReplicaCount: 0
  maxReplicaCount: 50
  triggers:
    - type: aws-sqs-queue
      metadata:
        queueURL: https://sqs.eu-west-1.amazonaws.com/123/invoices
        queueLength: "200"   # target messages per replica`,
      },
      insight:
        'Each signal encodes an assumption about the bottleneck. When the bottleneck moves (a DB becomes the constraint), the same autoscaler starts doing harm — revisit the signal whenever the architecture changes.',
    },
    {
      title: 'Node provisioning: the slow half of scaling',
      hook: 'Pods start in seconds; nodes take a minute or more — and that is where spikes hurt.',
      body: [
        'HPA only creates pods. If no node has room, pods sit in `Pending` until a node autoscaler acts. **Cluster Autoscaler** simulates whether a pending pod would fit on a new node from each node group and increases the ASG size; it scales down nodes that have been underutilized (below 50% requested by default) for 10 minutes and whose pods can move. **Karpenter** skips node groups: it batches pending pods, chooses instance types that fit them and calls EC2 Fleet directly, typically getting nodes ready faster and consolidating aggressively.',
        'To hide node lag, run **overprovisioning**: low-priority “pause” pods that reserve headroom; real pods preempt them instantly and the evicted pause pods trigger the node scale-up in the background.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Headroom via low-priority placeholder pods',
        actors: ['HPA', 'Scheduler', 'Pause pods', 'Karpenter'],
        messages: [
          { from: 'HPA', to: 'Scheduler', label: '+5 api pods' },
          { from: 'Scheduler', to: 'Pause pods', label: 'preempt (priority -10)', tone: 'warn' },
          { from: 'Scheduler', to: 'HPA', label: 'api pods running in ~5 s', dashed: true, tone: 'ok' },
          { from: 'Pause pods', to: 'Karpenter', label: 'now Pending' },
          { from: 'Karpenter', to: 'Scheduler', label: 'new node ready ~60 s', dashed: true },
        ],
        caption: 'Users get capacity from the buffer; nodes refill the buffer.',
      },
      insight:
        'Node autoscalers respect PodDisruptionBudgets and `do-not-evict`/`do-not-disrupt` annotations; a single PDB with `maxUnavailable: 0` can block scale-down of a whole node pool and quietly double your bill.',
    },
    {
      title: 'Cold starts, warm pools and predictive scaling',
      hook: 'If capacity takes 3 minutes to arrive, you must either predict or keep it ready.',
      body: [
        'Reactive scaling always lags the spike by the full chain (metric → decision → node → image → boot → warm-up). Options: keep **headroom** (target 50–60% CPU instead of 80%), **warm pools** (AWS ASG warm pools keep pre-initialized instances stopped or running; Lambda provisioned concurrency keeps execution environments initialized), **faster startup** (smaller images, lazy init, CRaC/native images, pre-pulled images), and **scheduled or predictive** scaling ahead of known peaks.',
        'Predictive scaling (AWS predictive scaling policies, Netflix Scryer) forecasts from historical daily/weekly patterns and scales out minutes before the expected load; reactive scaling remains as a floor for surprises. Scheduled actions handle known events — a sale at 09:00, a TV ad, a marketing email blast.',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Reactive', tone: 'warn', points: ['After load arrives', '1–5 min lag', 'Handles surprises', 'Needs headroom'] },
          { name: 'Predictive', tone: 'ok', points: ['Forecast from history', 'Ready before peak', 'Fails on novel events'] },
          { name: 'Scheduled / warm pool', tone: 'info', points: ['Known events', 'Pre-initialized capacity', 'Costs while idle'] },
        ],
      },
      insight:
        'Headroom is the price of lag: if capacity takes T minutes and load can grow g% per minute, your target utilization must leave about g × T percent spare. Faster startup directly buys higher utilization.',
    },
    {
      title: 'Stability: flapping, oscillation and feedback',
      hook: 'Lag plus aggressive gain makes any controller oscillate.',
      body: [
        'Flapping happens when the controller reacts to noise or its own effects: scale up → per-pod CPU drops → scale down → CPU jumps → scale up. Every cycle costs cold starts, cache misses and connection churn. Standard damping: tolerance band (10%), **scale up fast, scale down slow** (300 s window, small down-steps), cooldowns (ASG default cooldown 300 s for simple scaling), and min/max bounds.',
        'Watch for metrics that depend on replica count in non-obvious ways: per-pod averages of a shared queue, JIT warm-up CPU of new pods, or a cache whose hit rate drops when you add pods (more cold local caches) — each forms a positive feedback loop.',
      ],
      table: {
        columns: ['Damper', 'Default (where known)', 'Effect'],
        rows: [
          ['HPA tolerance', '10%', 'Ignore small deviations'],
          ['HPA scale-down window', '300 s', 'Use max recommendation over window'],
          ['HPA scale-up policy', '+100% or +4 pods / 15 s (max)', 'Caps growth rate'],
          ['ASG target tracking scale-in', 'Slower alarm than scale-out', 'Conservative removal'],
          ['KEDA cooldownPeriod', '300 s', 'Delay before scaling to zero'],
        ],
      },
      insight:
        'Scale-in is where outages hide: removing capacity just before the next spike, or terminating instances mid-job. Use scale-in protection or lifecycle hooks for long work and treat scale-down rate limits as a reliability setting, not a cost one.',
    },
    {
      title: 'Scaling dependencies, limits and quotas',
      hook: 'Autoscaling the app tier moves the bottleneck — usually to the database.',
      body: [
        'Every new pod opens connections: 200 pods × 20 Hikari connections = 4,000 Postgres backends, far past what the DB can handle (Postgres creates a process per connection). The autoscaler sees rising latency or CPU, adds more pods, and makes it worse. `maxReplicas` must be derived from downstream capacity, and poolers (PgBouncer, RDS Proxy) decouple pod count from DB connections.',
        'Platform limits cap scale too: cloud vCPU and instance quotas, subnet IP addresses (with the AWS VPC CNI each pod takes a VPC IP), API rate limits of the cloud provider, container registry pull throughput, and per-host OS limits (threads, file descriptors) when every server connects to every other one.',
      ],
      bullets: [
        'Alert when replicas sit at `maxReplicas` (`kube_horizontalpodautoscaler_status_current_replicas == ..._spec_max_replicas`) — you are capped, not stable.',
        'Load-test the scale-out itself: launch 3× nodes and pods in a staging account and watch quotas, IPs and DB connections.',
        'Scale stateful tiers deliberately (read replicas, shards) — they do not autoscale like stateless pods.',
      ],
      insight:
        'The safest autoscaler configuration encodes the whole system’s capacity: maxReplicas = min(budget, DB connection budget / pool size, downstream rate limit / per-pod rate).',
    },
  ],

  scaling: {
    body: [
      'The autoscaler is **control plane**: if it fails, the fleet freezes at its current size and keeps serving. That makes `minReplicas` the real availability guarantee — it must cover an AZ loss and the spike you can absorb during the autoscaler’s reaction time.',
      'Bad inputs are worse than a dead autoscaler: a broken metrics pipeline that reports 0% CPU (or missing metrics treated as low) can scale a fleet down during peak. Guard with sane minimums, scale-down rate limits, and alerts on metric staleness.',
      'Multi-region: autoscale each region independently on local signals, but plan for **failover load** — when region A fails, region B must absorb its traffic faster than reactive scaling can provide; pre-scale or keep standing headroom sized for evacuation.',
    ],
    bullets: [
      'Pods: HPA/KEDA. Nodes: Cluster Autoscaler/Karpenter. VMs: ASG target tracking. Functions: concurrency limits.',
      'Scale-up fast (100%/15 s), scale-down slow (10%/min, 5 min window).',
      'Readiness gates and LB slow start prevent new cold pods from being overwhelmed.',
      'Overprovisioning pods hide node provisioning lag.',
      'maxReplicas from downstream capacity; alert at max.',
      'Track cost per request alongside utilization to catch runaway scale.',
    ],
    diagram: {
      type: 'flow',
      title: 'Reaction budget for a spike',
      nodes: [
        { label: 'Spike', tone: 'bad' },
        { label: 'Detect', sub: '15–60 s', tone: 'info' },
        { label: 'Pods', sub: '5–60 s', tone: 'accent' },
        { label: 'Nodes', sub: '40–120 s', tone: 'warn' },
        { label: 'Warm & ready', sub: '10–60 s', tone: 'ok' },
      ],
      caption: 'Headroom must carry the load for the sum of these.',
    },
  },

  failures: [
    {
      name: 'Too slow for the spike',
      symptom: 'Errors and latency for the first 2–5 minutes of every spike; then recovery once capacity lands.',
      detect: 'Time between `kube_horizontalpodautoscaler_status_desired_replicas` rising and ready replicas catching up; `Pending` pod duration; error rate at spike start.',
      mitigate: 'Lower target utilization, overprovisioning pods, warm pools, predictive/scheduled scaling, faster startup.',
    },
    {
      name: 'Flapping',
      symptom: 'Replicas oscillate every few minutes; constant cold starts and cache churn.',
      detect: 'Frequent `SuccessfulRescale` events; replica count graph sawtooth; HPA `ScalingLimited` conditions.',
      mitigate: 'Scale-down stabilization window, smaller down-steps, tolerance, exclude warm-up CPU, smoother metric.',
    },
    {
      name: 'Scaling into a downstream bottleneck',
      symptom: 'More pods ⇒ more DB connections and load ⇒ latency rises ⇒ autoscaler adds even more pods.',
      detect: 'Replica count rising while throughput is flat; DB `numbackends` near `max_connections`; pool acquire timeouts.',
      mitigate: 'maxReplicas from DB budget, PgBouncer/RDS Proxy, circuit breakers, scale on a signal the DB cannot inflate.',
    },
    {
      name: 'Wrong signal: scale-in during an outage',
      symptom: 'A dependency stalls, threads block, CPU drops, autoscaler removes instances; when the dependency recovers there is too little capacity.',
      detect: 'Replica count dropping while request rate is unchanged and error/latency is high.',
      mitigate: 'Scale on demand (RPS, concurrency) rather than CPU for I/O-bound services; slow scale-in; min replicas.',
    },
    {
      name: 'Hitting quotas and platform limits',
      symptom: 'Desired replicas rise but pods stay Pending; node launches fail with insufficient capacity or quota errors.',
      detect: 'Cloud API errors (`InsufficientInstanceCapacity`, vCPU limit exceeded), subnet free IPs, Cluster Autoscaler/Karpenter error events.',
      mitigate: 'Raise quotas ahead of events, multiple instance types and AZs, larger subnets/prefix delegation, capacity reservations.',
    },
  ],

  warStories: [
    {
      title: 'Slack: autoscaling down during a network problem',
      source: 'Slack engineering blog, January 2021 outage write-up',
      what:
        'On the first workday of 2021, packet loss in AWS networking (Transit Gateways) made Slack’s servers wait on the network; with lower CPU utilization, autoscaling **removed** web capacity. When they tried to add ~1,200 servers at once, their provisioning service hit its own limits (including Linux open-file limits and AWS quotas), slowing recovery.',
      lesson: 'CPU is a misleading signal when the bottleneck is I/O, and the scale-out path itself must be load-tested at outage scale.',
    },
    {
      title: 'AWS Kinesis: adding capacity broke the fleet',
      source: 'AWS post-event summary, November 2020 (us-east-1)',
      what:
        'A planned capacity addition to the Kinesis front-end fleet caused every front-end server to exceed the OS limit on threads, because each server kept a thread per other server in the fleet. The front-end could not build its shard map; Kinesis and dependent services (Cognito, CloudWatch, and others) were impaired for hours.',
      lesson: 'Some designs have per-node costs that grow with fleet size (O(N) connections or threads). Scaling out is a change that needs limits, testing and a rollback path.',
    },
    {
      title: 'Autoscaling the app into the database',
      source: 'Composite of common incidents',
      what:
        'A marketing push tripled traffic; HPA scaled the API from 30 to 150 pods, each with a 20-connection pool. Postgres hit `max_connections`, connection attempts failed, latency and CPU on pods rose, and HPA kept adding pods until `maxReplicas` — the database was the bottleneck all along.',
      lesson: 'Cap replicas by downstream capacity and put a connection pooler between an elastic tier and an inelastic one.',
    },
  ],

  numbers: [
    { label: 'HPA sync period', value: '15 s', note: '`--horizontal-pod-autoscaler-sync-period`' },
    { label: 'HPA tolerance', value: '10%', note: 'no action within ±10% of target' },
    { label: 'HPA scale-down stabilization', value: '300 s', note: 'scale-up window 0 s by default' },
    { label: 'HPA default scale-up rate', value: '+100% or +4 pods / 15 s', note: 'whichever is larger' },
    { label: 'Cluster Autoscaler scale-down', value: '10 min unneeded, < 50% requested', note: 'defaults' },
    { label: 'New node ready', value: '~40–120 s', note: 'boot + kubelet + CNI' },
    { label: 'New pod on existing node', value: '~5–60 s', note: 'image cached vs JVM warm-up' },
    { label: 'KEDA defaults', value: 'poll 30 s, cooldown 300 s', note: '`pollingInterval`, `cooldownPeriod`' },
    { label: 'Typical CPU target', value: '50–70%', note: 'headroom pays for reaction lag' },
  ],

  capacity: {
    question:
      'Invoice workers consume an SQS queue. Peak arrival 3,000 msg/s, each message takes 50 ms with 8 concurrent handlers per pod, and messages should start within 30 s. The DB allows 400 connections for this workload; each pod uses 8. Configure the autoscaler.',
    steps: [
      'Per-pod throughput: 8 handlers / 0.05 s = 160 msg/s.',
      'Pods for steady peak: 3,000 / 160 ≈ 19; add 30% headroom for variance ⇒ ~25.',
      'Backlog target per pod: to drain within 30 s, each pod can own 160 × 30 = 4,800 messages; use a conservative `queueLength` target of ~1,000 so scaling reacts early.',
      'Downstream cap: 400 connections / 8 per pod = 50 ⇒ `maxReplicaCount: 50`.',
      'Reaction lag: KEDA poll 30 s + node ~90 s ⇒ ~2 min; a 2× burst for 2 min accumulates ~360k extra messages; 50 pods (8,000 msg/s) drain them at ~2,000 msg/s surplus in ~3 min — acceptable only if the SLA tolerates it; otherwise keep min 20 pods during business hours (scheduled scaling).',
    ],
    answer:
      'KEDA on SQS backlog with target ~1,000 msgs/pod, min 2 (20 in business hours), max 50 (DB-bound). Peak needs ~25 pods; bursts beyond 50 pods’ capacity are absorbed by the queue, not the database.',
  },

  comparison: {
    caption: 'Autoscalers',
    columns: ['Product', 'Scales', 'Signal', 'Reaction time', 'Scale to zero', 'Watch out for'],
    rows: [
      ['Kubernetes HPA', 'Pods', 'CPU/mem, custom, external', '15 s loop + pod start', 'No (min 1)', 'CPU is % of requests'],
      ['KEDA', 'Pods (via HPA)', 'Queue/stream/event scalers', 'Poll interval (30 s)', 'Yes', 'Per-message cost variance'],
      ['Cluster Autoscaler', 'Nodes (ASG groups)', 'Pending pods', '~1–3 min', 'Node groups to 0', 'Slow scale-down, PDB blocks'],
      ['Karpenter', 'Nodes (direct EC2)', 'Pending pods', '~1 min', 'Yes', 'Aggressive consolidation churn'],
      ['AWS ASG target tracking', 'VMs', 'CloudWatch metric', 'Minutes', 'Yes (min 0)', 'Slow scale-in alarms, warm-up'],
      ['Lambda concurrency', 'Execution envs', 'Incoming requests', 'Per request (+ cold start)', 'Yes', 'Concurrency quotas, cold starts'],
    ],
  },

  whenNot: [
    'Stateful primaries (databases, Kafka brokers): scale by planned resharding/replicas, not a reactive loop that moves data under load.',
    'Sub-minute spikes (flash crowds, retries): autoscaling is too slow — use headroom, queues, rate limiting and load shedding.',
    'When the bottleneck is downstream (DB, third-party API): more instances add load to the bottleneck; fix or protect it instead.',
    'Tiny, steady services where min = max anyway: autoscaling adds moving parts without savings.',
  ],

  interview: [
    {
      q: 'How does the Kubernetes HPA compute replicas, and how does it avoid flapping?',
      a: 'desired = ceil(current × currentMetric / target), averaged over ready pods, skipped within a 10% tolerance; with multiple metrics the maximum wins. It runs every 15 s. Flapping is prevented by the scale-down stabilization window (default 300 s, using the highest recommendation in the window), rate-limiting policies on each direction, and min/max bounds. Not-ready pods are excluded from CPU during startup so warm-up does not trigger extra scale-up.',
      followUps: ['Why is CPU utilization relative to requests a trap?', 'What happens with missing metrics?', 'Why scale up fast and down slow?'],
      seniorSignal: 'Knows the asymmetric damping and the requests-relative CPU subtlety.',
    },
    {
      q: 'Which metric would you scale a queue worker pool on?',
      a: 'Backlog per worker or the age of the oldest message, not CPU. Target backlog per worker = processing rate per worker × acceptable delay, and desired = ceil(backlog / target). Bound max replicas by what downstream systems can take, and use KEDA or SQS-based target tracking; scale-to-zero is fine if a cold start fits within the latency target.',
      followUps: ['What if message processing time varies 100×?', 'How do you avoid scaling into the DB limit?', 'When is age better than depth?'],
      seniorSignal: 'Derives the target from an SLA and caps by downstream capacity.',
    },
    {
      q: 'Your service fails for the first 3 minutes of every traffic spike. What do you do?',
      a: 'Break down the reaction chain: metric lag, loop interval, pod start, node provisioning, warm-up, LB registration. Then shorten it (faster startup, pre-pulled images, Karpenter) and hide what remains: lower target utilization for headroom, overprovisioning pause pods, warm pools, predictive or scheduled scaling for regular peaks. Also add load shedding so the existing fleet degrades gracefully instead of collapsing.',
      followUps: ['How do you size headroom?', 'How do overprovisioning pods work?', 'What about known events like a sale?'],
      seniorSignal: 'Decomposes lag and combines faster reaction with headroom and shedding.',
    },
    {
      q: 'Why can autoscaling make an outage worse?',
      a: 'If the bottleneck is downstream — DB connections, a third-party API — adding replicas adds connections and retries to the bottleneck, and higher latency triggers more scaling. CPU-based scaling can also scale in during an I/O stall. And scale-out itself may hit quotas or per-node O(N) costs, as in the Kinesis 2020 event. The fix is caps from downstream capacity, poolers, breakers and signals that reflect demand rather than symptoms.',
      followUps: ['How do you choose maxReplicas?', 'What signals create positive feedback?', 'How would you test scale-out?'],
      seniorSignal: 'Sees the autoscaler as part of the system’s feedback dynamics, citing real failure patterns.',
    },
    {
      q: 'Cluster Autoscaler vs Karpenter — what differs?',
      a: 'Cluster Autoscaler works through pre-defined node groups (ASGs): it simulates whether pending pods fit a group’s template and increases that group, and scales down nodes underutilized for a period. Karpenter provisions directly: it batches pending pods, picks instance types across a wide set to fit them, launches via EC2 Fleet and continuously consolidates nodes. Karpenter is usually faster and more cost-efficient; Cluster Autoscaler is more predictable and cloud-agnostic.',
      followUps: ['How do PDBs affect scale-down?', 'What is consolidation and its risk?', 'How do spot interruptions fit in?'],
      seniorSignal: 'Understands node-group simulation vs direct provisioning and the disruption trade-offs.',
    },
  ],

  takeaways: [
    'An autoscaler is a feedback controller: lag and gain determine stability.',
    'HPA: ceil(current × metric / target), 10% tolerance, 15 s loop, 5 min scale-down window.',
    'Scale on demand signals that saturate first; scale workers on backlog/age, not CPU.',
    'Node provisioning dominates reaction time — hide it with headroom, overprovisioning or prediction.',
    'Scale up fast, scale down slow; scale-in is where surprises happen.',
    'maxReplicas must come from downstream capacity; alert when pinned at max.',
    'If the autoscaler dies the fleet freezes — minReplicas is your real safety net.',
  ],
};

export default deep;
