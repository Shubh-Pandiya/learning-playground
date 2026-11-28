import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'worker',

  problem: {
    why: 'A worker pool is the compute side of asynchronous work: a fleet of stateless processes that pull jobs from a queue or log, run them with bounded concurrency, and ack on success. It exists so that slow, bursty or failure-prone work (emails, image processing, webhooks, reports) leaves the request path and runs at a pace the downstream systems can sustain. The hard parts are not the loop itself but **leases, idempotency, shutdown and scaling**.',
    withoutIt: [
      'Slow work runs on request threads: p99 of unrelated endpoints rises and a spike exhausts the web tier.',
      'Background work started in-process (`go func()`, thread pools in the API) is lost on every deploy or crash.',
      'Retries, backoff and concurrency limits get reimplemented ad hoc in every service.',
      'There is no clean way to scale processing independently of web traffic or to cap load on a fragile dependency.',
    ],
    position: 'Downstream of a queue/stream/subscription, upstream of databases and third-party APIs. Workers pull, process, write side effects, then ack back to the broker.',
    diagram: {
      type: 'flow',
      title: 'Request path vs work path',
      nodes: [
        { label: 'API', sub: 'enqueue, return 202', tone: 'neutral' },
        { label: 'Queue', sub: 'durable backlog', tone: 'accent' },
        { label: 'Worker pool', sub: 'N pods × C slots', tone: 'ok' },
        { label: 'DB / APIs', sub: 'capped concurrency', tone: 'info' },
      ],
    },
  },

  architecture: {
    overview: 'Inside one worker process: a **fetcher** that pulls only when there is free capacity, a **bounded buffer**, an **executor** with C concurrent slots, the **handler** (idempotent, with timeouts), a **lease manager** that heartbeats long jobs, and an **acker** that batches deletes/commits. Around the pool: an autoscaler driven by backlog/age, and a lifecycle manager for graceful shutdown. Frameworks (Sidekiq, Celery, BullMQ, Temporal workers, Lambda event source mappings) package these pieces with different defaults — and the defaults matter.',
    diagram: {
      type: 'flow',
      title: 'Inside a worker',
      nodes: [
        { label: 'Fetcher', sub: 'pull when slots free', tone: 'neutral' },
        { label: 'Bounded buffer', sub: 'backpressure point', tone: 'warn' },
        { label: 'Executor', sub: 'C slots / semaphore', tone: 'accent' },
        { label: 'Handler', sub: 'idempotent, timeout', tone: 'ok' },
        { label: 'Lease manager', sub: 'heartbeat / extend', tone: 'info' },
        { label: 'Acker', sub: 'batched delete/commit', tone: 'violet' },
      ],
      caption: 'The fetcher must never lease more than the executor can finish before leases expire.',
    },
    blocks: [
      { name: 'Fetch loop', what: 'Long-poll (SQS `WaitTimeSeconds=20`, `XREADGROUP BLOCK`, Kafka `poll()`, Temporal long-poll on a task queue). Fetch size = free slots, so backpressure is natural.' },
      { name: 'Executor', what: 'Thread pool, goroutines + semaphore, asyncio tasks, or prefork processes (Celery default for CPU-bound Python). C ≈ cores for CPU-bound, higher for I/O-bound, capped by downstream pools.' },
      { name: 'Per-dependency limits', what: 'Semaphores/bulkheads per downstream (DB pool size, third-party rate limit) so total concurrency across the fleet stays below what each dependency can take.' },
      { name: 'Lease manager', what: 'Extends visibility/ack deadlines for running jobs (SQS `ChangeMessageVisibility`, Pub/Sub modifyAckDeadline, Temporal activity heartbeat) and aborts the job if extension fails.' },
      { name: 'Idempotency store', what: 'Unique constraint or processed-ids table written in the same transaction as the side effect; idempotency keys forwarded to external APIs.' },
      { name: 'Lifecycle manager', what: 'SIGTERM → stop fetching → drain in-flight within the grace period → release unfinished leases → exit. Readiness/liveness probes reflect loop health, not just process liveness.' },
      { name: 'Autoscaler', what: 'KEDA / SQS target tracking / Lambda concurrency scaling on backlog per worker or age of oldest message, with min/max bounds tied to downstream capacity.' },
    ],
    real: [
      { name: 'Sidekiq (Ruby)', how: 'Threads in one process pull from Redis lists. OSS uses `BRPOP`, so a job fetched by a process that crashes is lost; Sidekiq Pro’s super_fetch moves jobs to a per-process working list and recovers them. On TERM it stops fetching, waits up to the shutdown timeout (25 s default) and pushes unfinished jobs back. Default retries: 25 over about 3 weeks.' },
      { name: 'Celery (Python)', how: 'Prefork pool by default (concurrency = CPU count) over RabbitMQ or Redis. Defaults are surprising: `task_acks_late=False` acks **before** running (at-most-once on crash) and `worker_prefetch_multiplier=4` reserves extra messages per process. With Redis, unacked tasks are redelivered after `visibility_timeout` (1 h default).' },
      { name: 'Temporal activity workers', how: 'Workers long-poll task queues; the Temporal server owns retries (exponential backoff, unlimited attempts by default), timeouts (schedule-to-close, start-to-close, heartbeat) and history. Long activities heartbeat with progress details so a retry can resume.' },
      { name: 'AWS Lambda event source mapping', how: 'AWS runs the pollers: batches from SQS (up to 10,000 with a batching window), Kinesis or Kafka; deletes on success; `ReportBatchItemFailures` retries only failed items; a maximum-concurrency setting caps fan-out for SQS sources.' },
      { name: 'Kafka consumers', how: 'One consumer thread per partition assignment, sequential per partition, offsets committed after processing. Confluent’s parallel consumer processes keys concurrently within a partition while preserving per-key order.' },
    ],
  },

  lifecycle: {
    summary: 'One `ResizeImage` job in an SQS-backed worker with 16 slots. The handler dominates; everything else is a few ms — unless the job waits in the local buffer, which is why buffers must stay small.',
    stages: [
      { stage: 'Long-poll fetch', what: '`ReceiveMessage(max=free slots, wait=20s)` returns as soon as messages are visible.', cost: '1 RTT when backlog exists.', ms: 5 },
      { stage: 'Local buffer', what: 'Bounded channel to the executor; normally empty when fetch = free slots.', cost: 'Near zero; grows if over-fetching.', ms: 0.1 },
      { stage: 'Acquire slot + dependency permit', what: 'Executor slot, then DB/S3 semaphore.', cost: 'µs unless saturated.', ms: 0.05 },
      { stage: 'Idempotency check', what: '`INSERT … ON CONFLICT DO NOTHING` on job id inside the transaction.', cost: '1 DB RTT.', ms: 1 },
      { stage: 'Do the work', what: 'Download from S3, resize, upload result to a deterministic key.', cost: 'I/O + CPU.', ms: 180 },
      { stage: 'Commit effect', what: 'Mark image ready in the same transaction as the processed-id row.', cost: '1 DB RTT + fsync.', ms: 3 },
      { stage: 'Ack (batched)', what: '`DeleteMessageBatch` every 100 ms or 10 messages.', cost: 'Amortised RTT.', ms: 2 },
    ],
  },

  deepDives: [
    {
      title: 'The pull loop: fetch only what you can finish',
      hook: 'Most duplicate and timeout bugs come from a fetcher that leases faster than the executor works.',
      body: [
        'A correct loop ties fetch size to free capacity: acquire slots first, then fetch at most that many messages. Every leased message starts its visibility clock the moment it is received, so a message sitting in a local buffer behind slow jobs can expire and be processed twice. Bounded buffers (or no buffer) keep the lease clock and real work aligned.',
        'Long polling avoids empty-receive cost and latency; a tight loop of short polls against an empty SQS queue burns API calls (and money) and still adds latency. On Kafka the analogous rule is: keep `max.poll.records` small enough that processing a batch fits well within `max.poll.interval.ms`, or the consumer is evicted from the group.',
      ],
      code: {
        lang: 'go',
        caption: 'Capacity-driven fetch loop',
        code: `sem := make(chan struct{}, 16)          // executor slots
for ctx.Err() == nil {
    free := cap(sem) - len(sem)
    if free == 0 { <-time.After(50 * time.Millisecond); continue }
    msgs, err := q.Receive(ctx, min(free, 10), 20*time.Second)
    if err != nil { backoff(); continue }
    for _, m := range msgs {
        sem <- struct{}{}
        go func(m Msg) {
            defer func() { <-sem }()
            stop := lease.Keepalive(m)  // extend visibility while running
            defer stop()
            if err := handle(ctx, m); err == nil { acker.Add(m) }
        }(m)
    }
}`,
      },
      insight: 'Prefetch is a lease you have already started paying for: the right prefetch is the smallest one that keeps slots busy, not the largest the broker allows.',
    },
    {
      title: 'Concurrency and prefetch tuning',
      hook: 'Concurrency per worker is set by the bottleneck resource, not by CPU count alone.',
      body: [
        'For CPU-bound handlers, slots ≈ cores (more just adds context switching; in Python, use processes, not threads). For I/O-bound handlers, slots ≈ target throughput × latency per worker, often 16–256 — but the fleet total must stay below the tightest downstream limit: 40 pods × 50 slots = 2,000 concurrent DB queries against a 500-connection pool is a self-inflicted outage.',
        'Framework defaults are tuned for short jobs. Celery’s `worker_prefetch_multiplier=4` lets each process reserve 4 messages; with 10-minute tasks one busy process hoards work while others idle — set the multiplier to 1 and `task_acks_late=True` for long tasks. RabbitMQ prefetch 1 gives fair dispatch for uneven jobs; 50–300 for tiny ones.',
      ],
      table: {
        columns: ['Workload', 'Slots per worker', 'Prefetch', 'Watch'],
        rows: [
          ['CPU-bound (encode, ML)', '≈ cores', '1–2 per slot', 'CPU, run-queue length'],
          ['I/O-bound short (webhooks)', '32–256', 'free slots', 'Downstream pool, 429s'],
          ['Long jobs (minutes)', 'small', '1, ack late', 'Lease extensions, fairness'],
          ['DB writes', '≤ pool size / pods', 'batch-sized', 'DB connections, lock waits'],
        ],
      },
      insight: 'Set a fleet-wide concurrency budget per dependency first (e.g. "≤ 400 concurrent DB transactions"), then derive slots per pod and max pods from it — autoscaling without that budget turns backlog into a DB outage.',
    },
    {
      title: 'Graceful shutdown: stop, drain, release',
      hook: 'Every deploy is a mass worker failure unless shutdown is designed.',
      body: [
        'Kubernetes sends SIGTERM, waits `terminationGracePeriodSeconds` (default 30 s), then SIGKILLs. A correct worker on SIGTERM: (1) stops fetching immediately, (2) lets in-flight jobs finish within the grace period, extending leases if needed, (3) for jobs that cannot finish, releases them early (`ChangeMessageVisibility` to 0, `basic.nack(requeue=true)`, Sidekiq push-back) so another worker starts them now rather than after the full visibility timeout, (4) flushes pending acks and exits.',
        'Size the grace period to job length: long jobs need either long grace periods or checkpointing (save progress, release, resume). Kafka consumers should commit processed offsets and leave the group cleanly to trigger a fast rebalance instead of waiting for session timeout.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Rolling deploy',
        actors: ['Kubelet', 'Worker', 'Queue'],
        messages: [
          { from: 'Kubelet', to: 'Worker', label: 'SIGTERM (grace 60s)' },
          { from: 'Worker', to: 'Worker', label: 'stop fetching' },
          { from: 'Worker', to: 'Queue', label: 'extend leases for 7 jobs' },
          { from: 'Worker', to: 'Queue', label: 'delete 6 finished', tone: 'ok' },
          { from: 'Worker', to: 'Queue', label: 'release 1 (visibility 0)', tone: 'warn' },
          { from: 'Worker', to: 'Kubelet', label: 'exit 0 before SIGKILL', dashed: true },
        ],
      },
      insight: 'Visibility timeout and grace period must be designed together: if a worker is killed mid-job, the job is invisible until the timeout expires, so a 1-hour timeout means every deploy delays some jobs by up to an hour unless you release them explicitly.',
    },
    {
      title: 'Leases and heartbeats for long jobs',
      hook: 'A heartbeat proves the process is alive, not that the job is making progress.',
      body: [
        'For jobs whose duration varies (seconds to an hour), keep the visibility timeout moderate (e.g. 5 min) and extend it from a background heartbeat every ~1/3 of the timeout. Crashed workers then release work within minutes, while healthy long jobs keep their lease. Temporal formalises this: an activity with a `HeartbeatTimeout` that stops heartbeating is considered failed and retried, and heartbeat details carry progress for resumption.',
        'Two traps. A **hung** job (deadlock, stuck socket) with a healthy heartbeat thread holds the lease forever — cap total extensions or heartbeat from the work loop with progress. And a **lost lease** (extension fails because the handle expired or the job was reassigned) means another worker may already be running it: stop work and do not commit, or protect the commit with a fencing token/version check.',
      ],
      code: {
        lang: 'python',
        caption: 'Temporal activity with heartbeats',
        code: `@activity.defn
async def transcode(video_id: str) -> str:
    start = activity.info().heartbeat_details  # resume point on retry
    seg = start[0] if start else 0
    for seg in range(seg, total_segments(video_id)):
        await encode_segment(video_id, seg)
        activity.heartbeat(seg + 1)            # progress, not just liveness
    return output_key(video_id)

# workflow side
await workflow.execute_activity(transcode, vid,
    start_to_close_timeout=timedelta(hours=2),
    heartbeat_timeout=timedelta(seconds=60),
    retry_policy=RetryPolicy(maximum_attempts=5))`,
      },
      insight: 'Heartbeat from the code path that does the work (per chunk processed), not from an independent timer thread, so a stuck job stops heartbeating and is retried.',
    },
    {
      title: 'Autoscaling on backlog and age (KEDA)',
      hook: 'CPU is the wrong signal for a worker that spends its life waiting on I/O.',
      body: [
        'Scale on demand: **backlog per worker** (messages visible ÷ replicas) toward a target derived from throughput and the latency SLO, plus **age of oldest message** as an override. KEDA reads SQS, RabbitMQ, Kafka lag, Redis lists and more, feeds an HPA, and can scale to zero. AWS recommends a backlog-per-instance custom metric for SQS with target tracking.',
        'Guardrails: a max replica count derived from the downstream budget; scale-up fast, scale-down slow (cooldown) to avoid flapping; for Kafka, max replicas ≤ partitions, and every scale event triggers a rebalance that pauses consumption briefly.',
      ],
      code: {
        lang: 'yaml',
        caption: 'KEDA ScaledObject for an SQS worker',
        code: `apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: { name: resize-worker }
spec:
  scaleTargetRef: { name: resize-worker }
  minReplicaCount: 2
  maxReplicaCount: 40          # = DB budget / slots per pod
  pollingInterval: 15
  cooldownPeriod: 300
  triggers:
    - type: aws-sqs-queue
      metadata:
        queueURL: https://sqs.eu-west-1.amazonaws.com/123/resize
        queueLength: "50"      # target backlog per replica
        awsRegion: eu-west-1`,
      },
      diagram: {
        type: 'flow',
        title: 'Scaling control loop',
        nodes: [
          { label: 'Queue metrics', sub: 'visible + age', tone: 'neutral' },
          { label: 'KEDA', sub: 'backlog ÷ target', tone: 'info' },
          { label: 'HPA', sub: 'desired replicas', tone: 'accent' },
          { label: 'Workers', sub: 'capped at max', tone: 'ok' },
          { label: 'Downstream', sub: 'budget enforced', tone: 'warn' },
        ],
      },
      insight: 'Autoscaling a worker pool whose bottleneck is a shared database is a positive feedback loop: slower DB → more backlog → more workers → slower DB. The max replica count is a safety control, not a cost setting.',
    },
    {
      title: 'Idempotent handlers in practice',
      hook: 'At-least-once is guaranteed; exactly-once effects are something you build.',
      body: [
        'Pick an idempotency key that identifies the **logical operation** (event id, or `order_id + action`), not the delivery. Record it in the same transaction as the side effect with a unique constraint; if the insert conflicts, the work was already done — ack and return. For external APIs (Stripe, payment providers, email services), pass the key in the provider’s idempotency header so their side is deduped too.',
        'Where a transaction cannot cover the effect (S3 upload + DB write), make each step individually idempotent: deterministic output keys (`thumbs/{image_id}/{size}.jpg`), upserts instead of inserts, and conditional updates (`UPDATE … WHERE version = $expected`). Natural idempotency (set-state operations) beats bookkeeping (increment operations) every time.',
      ],
      code: {
        lang: 'sql',
        caption: 'Effect + dedup in one transaction',
        code: `BEGIN;
INSERT INTO processed_jobs(job_id) VALUES ($1)
  ON CONFLICT (job_id) DO NOTHING;     -- 0 rows → duplicate, skip
-- only if 1 row inserted:
UPDATE accounts SET balance = balance - $2 WHERE id = $3;
INSERT INTO ledger(job_id, account_id, amount) VALUES ($1, $3, -$2);
COMMIT;
-- then ack the message`,
      },
      insight: 'Dedup tables need retention: keep ids at least as long as the maximum redelivery horizon (queue retention + DLQ redrive window), or a redriven message from 10 days ago becomes a duplicate effect.',
    },
    {
      title: 'Batching, work-stealing and choosing a job framework',
      hook: 'Pull-based pools load-balance themselves; partitioned ones do not.',
      body: [
        '**Batching** amortises per-message overhead: one `DeleteMessageBatch`, one multi-row insert, one bulk index request. It trades latency (waiting to fill a batch) and failure granularity (one bad item fails the batch — use partial-failure reporting like Lambda’s `ReportBatchItemFailures`).',
        'A shared pull queue is natural **work-stealing**: idle workers simply take the next job. Partitioned assignment (Kafka partitions, Sidekiq per-queue processes) loses this — a worker with a hot partition is overloaded while others idle. Fixes: smaller units of assignment, key-level parallelism inside a partition, or redistributing via a queue.',
      ],
      table: {
        caption: 'Job frameworks',
        columns: ['Framework', 'Broker', 'Delivery default', 'Strength', 'Watch out'],
        rows: [
          ['Sidekiq', 'Redis lists', 'At-most-once on crash (OSS)', 'Fast, simple, Ruby ecosystem', 'Use super_fetch for reliability'],
          ['Celery', 'RabbitMQ / Redis', 'Ack early by default', 'Python ecosystem, canvas', 'acks_late, prefetch multiplier'],
          ['BullMQ', 'Redis lists + sorted sets', 'At-least-once with locks', 'Node, delays, rate limits', 'Redis memory, stalled jobs'],
          ['Temporal', 'Temporal server (DB)', 'Retries until success', 'Durable workflows, heartbeats', 'Operational weight, determinism'],
          ['Lambda + SQS', 'SQS', 'At-least-once', 'Zero ops, scales fast', '15 min max, concurrency caps'],
        ],
      },
      insight: 'If jobs are multi-step with waits and compensation, a durable workflow engine replaces a tangle of queues, cron jobs and status columns; if jobs are single-step and short, a plain queue + worker is simpler and cheaper.',
    },
  ],

  scaling: {
    body: [
      'Workers are stateless, so the data plane scales horizontally across AZs; the queue holds all durable state. Capacity math is Little’s law: concurrent slots = throughput × time per job. The real ceiling is downstream: each dependency gets a fleet-wide concurrency budget, and max replicas × slots per pod must fit inside it.',
      'The control plane here is the autoscaler and deployment system. If the autoscaler fails (metrics outage), workers should stay at their last size rather than scale to zero; KEDA’s fallback replicas cover this. Deploys must be rolling with graceful shutdown so capacity never drops to zero.',
      'Multi-region: run workers next to their queue and their data. Cross-region workers pulling from a remote queue pay RTT on every receive/ack and couple failure domains. For active-active, each region drains its own queue; idempotency keys must be globally unique because failover can replay work across regions.',
    ],
    bullets: [
      'Slots = λ × W; add 30–50% headroom for variance and deploys.',
      'Scale on backlog per worker and age; cap by downstream budget.',
      'Scale up fast, down slowly; KEDA fallback replicas when metrics fail.',
      'Separate pools for critical vs bulk jobs so a backfill cannot starve payments.',
      'Kafka-driven pools: replicas ≤ partitions; expect a rebalance pause per scale event.',
      'Spread across AZs; any worker may die at any time without loss.',
    ],
  },

  failures: [
    {
      name: 'Duplicate side effects',
      symptom: 'Customers receive two emails or two charges, clustered around deploys and slow periods.',
      detect: 'Receive-to-delete ratio > 1, `ApproximateReceiveCount > 1` rate, idempotency-conflict counter, provider-side duplicate reports.',
      mitigate: 'Idempotency keys with unique constraints, provider idempotency headers, leases longer than p99.9, graceful shutdown.',
    },
    {
      name: 'Lost jobs on crash',
      symptom: 'Jobs vanish after OOM kills or node failures; no retries, no DLQ entries.',
      detect: 'Reconciliation (expected vs completed jobs), framework config audit (Celery `acks_late`, Sidekiq fetch strategy), OOMKilled events.',
      mitigate: 'Ack after processing, reliable fetch (Sidekiq super_fetch), `task_reject_on_worker_lost`, memory limits per job.',
    },
    {
      name: 'Autoscaling melts the downstream',
      symptom: 'Backlog triggers scale-out; DB connections max out; every service sharing the DB degrades.',
      detect: 'Replica count rising while job latency rises (not falls); DB `max_connections` saturation, lock waits.',
      mitigate: 'Fleet-wide concurrency budget per dependency, max replicas derived from it, adaptive concurrency / circuit breakers.',
    },
    {
      name: 'Hung jobs holding leases',
      symptom: 'Throughput drops slowly; workers show all slots busy but low CPU; some messages never complete.',
      detect: 'Job duration histogram tail, per-slot "running for" age, lease-extension count per message.',
      mitigate: 'Per-job timeouts with cancellation, progress-based heartbeats, max extensions, watchdog that kills the process.',
    },
    {
      name: 'Kafka consumer evicted mid-batch',
      symptom: 'Repeated rebalances, duplicated processing, lag sawtooth.',
      detect: 'Rebalance rate, `max.poll.interval.ms` exceeded logs, `last-poll-seconds-ago`.',
      mitigate: 'Smaller `max.poll.records`, process asynchronously with pause/resume, cooperative-sticky assignment, static membership.',
    },
  ],

  warStories: [
    {
      title: 'Celery acked before it worked',
      source: 'Composite of common incidents',
      what: 'An invoicing service ran on Celery with default settings. Workers processing large PDFs were periodically OOM-killed. Because Celery acks before execution by default, every killed task simply disappeared: no retry, no error, no DLQ. Finance found hundreds of missing invoices at month end.',
      lesson: 'Audit framework delivery defaults: `task_acks_late=True` plus `task_reject_on_worker_lost=True` (and idempotent tasks) for anything that must happen.',
    },
    {
      title: 'Scale-out into a database brownout',
      source: 'Composite of common incidents',
      what: 'A notification backfill put 5M jobs on a queue. The autoscaler, keyed on backlog, scaled workers from 10 to 200 pods with 20 slots each — 4,000 concurrent transactions against a Postgres primary sized for 500. Lock waits and connection exhaustion took down the user-facing API that shared the database.',
      lesson: 'Derive max replicas from a per-dependency concurrency budget, isolate bulk work in its own pool, and route backfills through a rate limiter.',
    },
    {
      title: 'Every deploy sent duplicate webhooks',
      source: 'Composite of common incidents',
      what: 'Workers ignored SIGTERM and were SIGKILLed after 30 s, mid-request to customer webhooks. Messages became visible again after the 15-minute visibility timeout and were sent a second time, now late. Customers built dedup on their side and filed complaints about "random" duplicates that correlated with deploy times.',
      lesson: 'Handle SIGTERM: stop fetching, finish or release in-flight jobs, and send idempotency keys to webhook receivers.',
    },
  ],

  numbers: [
    { label: 'Little’s law', value: 'slots = λ × W', note: '500 jobs/s × 0.2 s = 100 slots' },
    { label: 'k8s grace period', value: '30 s default' },
    { label: 'Sidekiq shutdown timeout', value: '25 s default', note: 'Then jobs pushed back' },
    { label: 'Sidekiq retries', value: '25 over ~3 weeks', note: 'Exponential backoff' },
    { label: 'Celery prefetch multiplier', value: '4 default', note: 'Set 1 for long tasks' },
    { label: 'Celery Redis visibility_timeout', value: '1 h default' },
    { label: 'SQS receive batch', value: '≤ 10 messages, ≤ 20 s wait' },
    { label: 'Heartbeat interval', value: '~1/3 of lease', note: 'Extend before expiry' },
    { label: 'Lambda max duration', value: '15 min' },
  ],

  capacity: {
    question: 'A webhook delivery system must send 3,000 webhooks/s at peak. Median receiver latency 150 ms, p99 2 s, timeout 10 s. 5% of receivers are slow/timing out at any time. How many slots, pods, and what protects the fleet?',
    steps: [
      'Mean service time ≈ 0.95 × 0.25 s (mix of median and tail) + 0.05 × 10 s (timeouts) ≈ 0.24 + 0.5 ≈ 0.74 s.',
      'Little’s law: 3,000/s × 0.74 s ≈ 2,220 concurrent slots; with 40% headroom ≈ 3,100.',
      'I/O-bound async workers at 200 slots per pod → ~16 pods at peak; min 4 across 3 AZs.',
      'Timeouts consume ~1,500 of the slots (0.05 × 3,000 × 10 s): a per-receiver concurrency cap (e.g. 20) stops one dead endpoint from eating the fleet.',
      'Lower the timeout to 5 s and move failing receivers to a slower retry queue → mean ≈ 0.49 s → ~1,500 slots, ~2,100 with headroom, ~11 pods.',
    ],
    answer: '~3,100 slots (~16 pods × 200) with the naive design; per-receiver caps, a shorter timeout and a separate retry lane cut it to ~11 pods — slow receivers, not traffic, drive capacity.',
  },

  comparison: {
    caption: 'Ways to run async workers',
    columns: ['Option', 'Scaling', 'Delivery / retries', 'Long jobs', 'Best for'],
    rows: [
      ['Pods + queue (custom loop)', 'KEDA/HPA on backlog', 'Your code + broker', 'Heartbeats, any length', 'Full control, steady load'],
      ['Sidekiq / Celery / BullMQ', 'Processes × threads', 'Framework retries; check ack defaults', 'OK with care', 'Language-native background jobs'],
      ['AWS Lambda + SQS', 'Automatic, capped concurrency', 'Batch item failures + DLQ', '≤ 15 min', 'Spiky, short jobs, zero ops'],
      ['Temporal workers', 'Workers poll task queues', 'Server-side retries, durable', 'Hours–days with heartbeats', 'Multi-step workflows, sagas'],
      ['Kafka consumer group', 'Replicas ≤ partitions', 'Offsets; DIY retries', 'Blocks partition', 'Ordered stream processing'],
    ],
  },

  whenNot: [
    'The user needs the result in the same request and it is fast enough: do it synchronously; async adds complexity and eventual consistency.',
    'Multi-step processes with waits, timers and compensation: use a workflow engine rather than chaining queues and workers.',
    'Continuous stateful aggregation over streams (windows, joins): use a stream processor (Flink, Kafka Streams).',
    'Rare, scheduled batch jobs: a scheduled job (k8s CronJob, Airflow) is simpler than an always-on pool.',
    'Polling a DB table as the work queue at high volume: use a real queue (or SKIP LOCKED with care at low volume).',
  ],

  interview: [
    {
      q: 'How do you size a worker pool?',
      a: 'With Little’s law: concurrent slots = arrival rate × mean service time, including timeouts and retries in the mean. Add headroom for variance and deploys, then split slots into pods by the per-pod concurrency the workload supports (≈ cores for CPU-bound, much higher for I/O-bound). Finally cap total concurrency per dependency — the DB or third-party limit usually sets max replicas. Autoscale on backlog per worker and age, not CPU.',
      followUps: ['What dominates the mean in a webhook system?', 'How do you pick the autoscaling target?', 'What changes for CPU-bound jobs?'],
      seniorSignal: 'Includes tail/timeouts in the service time and caps by downstream budget, not just throughput math.',
    },
    {
      q: 'How do you shut down a worker without losing or duplicating jobs?',
      a: 'On SIGTERM, stop fetching, let in-flight jobs finish within the grace period while extending their leases, and explicitly release any job that cannot finish (visibility 0, nack with requeue) so it is retried immediately rather than after the timeout. Flush pending acks, commit Kafka offsets and leave the group, then exit before SIGKILL. Handlers are idempotent anyway, because a node can still die without warning.',
      followUps: ['How long should the grace period be?', 'What about a 2-hour job?', 'How does Kafka rebalancing interact?'],
      seniorSignal: 'Releases unfinished leases proactively and ties the grace period to the visibility timeout.',
    },
    {
      q: 'A job sometimes takes 2 seconds and sometimes 40 minutes. How do you configure leases?',
      a: 'Use a moderate visibility timeout (a few minutes) and heartbeat-extend it while the job runs, so crashed workers release work quickly but long jobs keep their lease. Heartbeat from the work loop with progress so hung jobs stop extending; cap total runtime with a timeout. If an extension fails, assume another worker has the job and abort without committing, or guard the commit with a version check. For very long jobs, checkpoint progress so retries resume — Temporal activity heartbeats do exactly this.',
      followUps: ['Why not just set 1 hour?', 'What is a fencing token here?', 'How do you resume from a checkpoint?'],
      seniorSignal: 'Distinguishes liveness from progress and handles the lost-lease case explicitly.',
    },
    {
      q: 'Your workers autoscaled and the database fell over. What went wrong and how do you design against it?',
      a: 'The autoscaler optimised for backlog without knowing the downstream capacity, so concurrency multiplied until the DB saturated, which slowed jobs, increased backlog and triggered more scaling. Design a fleet-wide concurrency budget per dependency and derive max replicas from it; add adaptive concurrency or a circuit breaker that reduces load when latency rises; separate bulk and critical pools. Accept that backlog age will rise — that is what the queue is for.',
      followUps: ['How would you enforce a fleet-wide limit?', 'Which metric shows this feedback loop early?', 'How do you prioritise critical jobs during the backlog?'],
      seniorSignal: 'Recognises the positive feedback loop and treats max replicas as a safety control.',
    },
    {
      q: 'Sidekiq, Celery, Temporal or plain SQS + pods — how would you choose?',
      a: 'In a Ruby or Python codebase with short single-step jobs, Sidekiq or Celery are productive, but I would audit delivery defaults: Sidekiq OSS loses in-progress jobs on crash without reliable fetch, Celery acks early by default. For AWS-native, short, spiky work, Lambda + SQS removes operations. For multi-step workflows with retries, timers and compensation, Temporal gives durability and visibility. Plain pods + SQS when I need full control over concurrency and long-running jobs.',
      followUps: ['What does Temporal cost operationally?', 'How do you get priorities in each?', 'Why does reliable fetch matter?'],
      seniorSignal: 'Knows the delivery-semantics defaults of each framework and matches the tool to job shape.',
    },
  ],

  takeaways: [
    'Fetch only as many messages as you have free slots; prefetch is a lease clock already running.',
    'Size with Little’s law including timeouts, then cap by a per-dependency concurrency budget.',
    'Graceful shutdown: stop fetching, finish or release in-flight work, flush acks.',
    'Heartbeat long jobs from the work loop; a lost lease means stop and do not commit.',
    'Autoscale on backlog per worker and age; max replicas protects the downstream.',
    'Idempotency key = logical operation, recorded in the same transaction as the effect.',
    'Audit framework defaults: Celery acks early, Sidekiq OSS fetch is not crash-safe.',
  ],
};

export default deep;
