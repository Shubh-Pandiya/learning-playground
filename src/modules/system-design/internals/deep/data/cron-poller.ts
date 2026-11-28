import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'cron-poller',

  problem: {
    why:
      'The simplest way to “react” to new work is a cron job that runs `SELECT … WHERE status = \'pending\'` every N seconds. It ships in an afternoon and needs no new infrastructure. It also quietly buys you latency of interval/2 on average, constant database load even when idle, duplicate pickup when you add a second instance, and missed runs when the one cron box dies. For a few hundred jobs a day it is fine; as the event path of a growing system it becomes the bottleneck nobody designed.',
    withoutIt: [
      'Without any background processing, slow work (emails, exports, webhooks) runs inside the user request and times out.',
      'Without a schedule, periodic tasks (billing runs, cleanups, reports) depend on someone remembering.',
      'With naive polling at scale, the scan query dominates DB CPU and new work waits a full interval.',
      'With two pollers and no row locking, every job runs twice.',
    ],
    position:
      'A timer-driven worker that queries the primary database for rows in a pending state, claims them and processes them; it sits beside the app tier and reads the same tables the app writes.',
    diagram: {
      type: 'flow',
      title: 'The polling loop',
      nodes: [
        { label: 'Cron / timer', sub: 'every N s', tone: 'neutral' },
        { label: 'SELECT pending', sub: 'scan + claim', tone: 'warn' },
        { label: 'Process rows', tone: 'accent' },
        { label: 'UPDATE status', sub: 'done / failed', tone: 'info' },
        { label: 'Sleep', sub: 'latency = N/2 avg', tone: 'bad' },
      ],
      caption: 'Every cycle costs a query whether or not there is work.',
    },
  },

  architecture: {
    overview:
      'A poller is a loop: wake on a timer, claim a batch of pending rows, process them, mark them done, sleep. Making it safe needs three things the naive version lacks: an atomic **claim** (`FOR UPDATE SKIP LOCKED` or a conditional update), a **lease** so crashed claims are reclaimed, and an **index** that keeps the scan cheap. Done well, this is exactly how Postgres-backed job queues work; done naively, it is the anti-pattern.',
    diagram: {
      type: 'layers',
      title: 'Naive vs hardened poller',
      layers: [
        { name: 'Trigger', items: ['crontab on one host', 'In-process timer', 'k8s CronJob'], tone: 'neutral' },
        { name: 'Claim', items: ['SELECT then UPDATE (racy)', 'FOR UPDATE SKIP LOCKED', 'Conditional UPDATE … RETURNING'], tone: 'warn' },
        { name: 'Lease', items: ['locked_until column', 'Reaper for stale claims', 'Attempts + backoff'], tone: 'info' },
        { name: 'Wake-up', items: ['Fixed interval', 'LISTEN/NOTIFY nudge', 'Adaptive backoff when idle'], tone: 'ok' },
      ],
    },
    blocks: [
      { name: 'Jobs / outbox table', what: 'Rows with `status`, `run_at`, `attempts`, `locked_by`, `locked_until`, payload. The application inserts them in the same transaction as the business change.' },
      { name: 'Partial index', what: '`CREATE INDEX ON jobs (run_at) WHERE status = \'pending\'` keeps the scan proportional to pending rows, not table size.' },
      { name: 'Claim query', what: '`SELECT … FOR UPDATE SKIP LOCKED LIMIT n` (Postgres 9.5+, MySQL 8.0+) lets concurrent pollers take disjoint rows without blocking each other.' },
      { name: 'Lease and reaper', what: 'A claimed row gets `locked_until = now() + 5 min`; a reaper returns expired claims to pending so a crashed worker does not strand jobs.' },
      { name: 'Scheduler trigger', what: 'crontab, systemd timers, k8s CronJob, Quartz, or a loop in a long-lived worker. Determines who notices missed runs.' },
      { name: 'Retention', what: 'Completed rows are deleted or archived; otherwise dead tuples and index bloat slow every poll (autovacuum pressure in Postgres).' },
    ],
    real: [
      { name: 'Postgres job queues', how: 'pg-boss, Oban (Elixir), River (Go) and Solid Queue (Rails 8) claim with `FOR UPDATE SKIP LOCKED`; Que and GoodJob use advisory locks. All are hardened pollers, often with LISTEN/NOTIFY to cut latency.' },
      { name: 'Transactional outbox relays', how: 'Many outbox implementations poll the outbox table every 100 ms–1 s and publish to Kafka; Debezium replaces polling with log-based CDC.' },
      { name: 'Quartz clustered JobStore', how: 'Nodes share JDBC tables and coordinate through row locks in `QRTZ_LOCKS`, so each trigger fires on one node; misfire handling covers downtime.' },
      { name: 'Kubernetes CronJob', how: 'The controller creates a Job per schedule tick; `concurrencyPolicy` (Allow, Forbid, Replace) and `startingDeadlineSeconds` govern overlap and missed runs.' },
    ],
  },

  lifecycle: {
    summary:
      'One poll cycle with a 5 s interval, claiming 100 rows from an indexed Postgres jobs table. The work is fast; the waiting is the dominant term.',
    stages: [
      { stage: 'Wait for tick', what: 'Job inserted at a random point in the interval waits on average half of it.', cost: 'interval/2', ms: 2500 },
      { stage: 'Claim batch', what: '`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT 100) RETURNING *`.', cost: 'Index scan + row locks', ms: 3 },
      { stage: 'Commit claim', what: 'Rows now show `locked_by`, `locked_until`; other pollers skip them.', cost: 'WAL fsync', ms: 2 },
      { stage: 'Process', what: 'Send email / call webhook per row.', cost: 'Your work', ms: 200 },
      { stage: 'Mark done', what: 'Batch `UPDATE status = \'done\'` (or delete).', cost: '1 txn', ms: 3 },
      { stage: 'Reap stale', what: 'Separate periodic sweep resets claims whose lease expired.', cost: 'Off path', ms: 0 },
    ],
  },

  deepDives: [
    {
      title: 'Latency and load: the polling tax',
      hook: 'You pay for every poll, and every job waits for the next one.',
      body: [
        'With interval N, a job waits on average N/2 and at worst N before it is noticed. To make that small you poll faster, and load grows linearly: a 1 s interval is 86,400 queries per day per poller; ten pollers at 100 ms is 8.6 million queries a day — most of them returning nothing.',
        'The scan itself degrades as the table grows unless it uses a partial index on pending rows and completed rows are removed. A sequential scan on a 50 M-row jobs table every second is a common reason a “simple” poller shows up as the top query in `pg_stat_statements`.',
      ],
      table: {
        columns: ['Interval', 'Avg added latency', 'Queries/day (1 poller)', 'Queries/day (10 pollers)'],
        rows: [
          ['60 s', '30 s', '1,440', '14,400'],
          ['5 s', '2.5 s', '17,280', '172,800'],
          ['1 s', '0.5 s', '86,400', '864,000'],
          ['100 ms', '50 ms', '864,000', '8,640,000'],
        ],
      },
      insight:
        'Polling trades latency against idle load on a fixed line. Push (queue, NOTIFY, CDC) breaks the trade-off: zero cost when idle, milliseconds when busy.',
    },
    {
      title: 'Duplicate pickup without SKIP LOCKED',
      hook: 'Scaling the poller from one to two instances doubles the work, not the throughput.',
      body: [
        'The naive loop is `SELECT id FROM jobs WHERE status = \'pending\' LIMIT 100`, process, then `UPDATE … SET status = \'done\'`. With two instances both select the same rows. Adding `FOR UPDATE` alone serializes them: the second poller blocks on the first’s locks. `FOR UPDATE SKIP LOCKED` skips rows locked by others, so pollers claim disjoint batches without waiting.',
        'Claim in a short transaction and record a lease rather than holding row locks while doing slow work: long transactions hold back vacuum, keep connections busy and lose all claims on crash only after TCP timeouts.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Two pollers, naive select',
        actors: ['Poller A', 'Postgres', 'Poller B'],
        messages: [
          { from: 'Poller A', to: 'Postgres', label: 'SELECT pending LIMIT 100' },
          { from: 'Poller B', to: 'Postgres', label: 'SELECT pending LIMIT 100' },
          { from: 'Postgres', to: 'Poller A', label: 'rows 1–100', dashed: true },
          { from: 'Postgres', to: 'Poller B', label: 'rows 1–100', dashed: true, tone: 'bad' },
          { from: 'Poller A', to: 'Postgres', label: 'process + mark done' },
          { from: 'Poller B', to: 'Postgres', label: 'process + mark done (again)', tone: 'bad' },
        ],
        caption: 'Each job ran twice; with SKIP LOCKED, B would have received rows 101–200.',
      },
      code: {
        lang: 'sql',
        caption: 'Hardened claim with lease (Postgres)',
        code: `-- claim a batch atomically; concurrent pollers get disjoint rows
UPDATE jobs
SET status = 'running',
    locked_by = :worker_id,
    locked_until = now() + interval '5 minutes',
    attempts = attempts + 1
WHERE id IN (
  SELECT id FROM jobs
  WHERE status = 'pending' AND run_at <= now()
  ORDER BY run_at
  LIMIT 100
  FOR UPDATE SKIP LOCKED
)
RETURNING id, payload;

-- reaper: return expired claims to the queue
UPDATE jobs SET status = 'pending', locked_by = NULL
WHERE status = 'running' AND locked_until < now();

CREATE INDEX jobs_pending_idx ON jobs (run_at) WHERE status = 'pending';`,
      },
      insight:
        'SKIP LOCKED turns a racy poller into a real work queue. It gives at-least-once delivery, so handlers still need to be idempotent — the reaper will re-run jobs whose worker died after doing the side effect.',
    },
    {
      title: 'Missed runs, SPOFs and overlap',
      hook: 'A crontab line on one VM is a single point of failure with no alerting.',
      body: [
        'Classic cron on one host has no memory: if the host is down at 02:00, the 02:00 run never happens and nothing reports it. Adding a second host running the same crontab fixes availability and creates duplicates. Overlap is the other trap: if the job takes longer than its interval, cron starts another copy on top of the first.',
        'Kubernetes CronJob moves the trigger into the control plane: `concurrencyPolicy: Forbid` skips a tick if the previous Job is running, `Replace` kills it, `Allow` (the default) overlaps. `startingDeadlineSeconds` bounds how late a missed run may start; if more than 100 schedules are missed, the controller stops scheduling and logs an error. Quartz clustered mode and Temporal Schedules offer misfire and catch-up policies (Temporal’s overlap policies include Skip, BufferOne, BufferAll, CancelOther, TerminateOther and AllowAll).',
      ],
      code: {
        lang: 'yaml',
        caption: 'A CronJob that neither overlaps nor silently disappears',
        code: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-billing
spec:
  schedule: "0 2 * * *"
  timeZone: "Etc/UTC"            # stable since Kubernetes 1.27
  concurrencyPolicy: Forbid      # never two runs at once
  startingDeadlineSeconds: 3600  # may start up to 1 h late, else counted missed
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      backoffLimit: 2
      activeDeadlineSeconds: 7200
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: billing
              image: registry.example.com/billing:1.42.0
              args: ["run-nightly", "--date=yesterday"]`,
      },
      insight:
        'Monitor the absence of success, not the presence of failure: a dead-man’s-switch alert (“no successful run in 26 h”) catches every way a schedule can silently stop.',
    },
    {
      title: 'Time zones and DST',
      hook: 'Twice a year, local-time schedules run zero or two times.',
      body: [
        'A job scheduled at 02:30 local time does not exist on the spring-forward day and happens twice on fall-back in many zones. Implementations differ: some cron daemons skip, some run immediately, some run twice. Business logic like “bill yesterday’s usage” then misses or doubles a day.',
        'Schedule in UTC and compute business dates explicitly in the job (“the day that ended at 00:00 Europe/Berlin”), passing the logical date as a parameter so runs are idempotent and replayable. If you must schedule in local time, pick an hour outside the DST transition window (transitions usually happen between 01:00 and 03:00).',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Local-time cron', tone: 'bad', points: ['02:30 skipped in spring', 'Runs twice in autumn', 'Depends on host TZ'] },
          { name: 'UTC schedule + logical date', tone: 'ok', points: ['Fires exactly once per tick', 'Job derives business day', 'Replay = same date param'] },
        ],
      },
      insight:
        'Idempotency by logical date (“billing for 2024-11-27”) makes duplicates harmless and missed runs re-runnable — it fixes DST, overlap and failover at once.',
    },
    {
      title: 'When polling is right — and what replaces it',
      hook: 'A Postgres job queue is a legitimate design; an accidental poller is not.',
      body: [
        'Polling is the right call when volume is low (thousands of jobs per hour), latency of seconds is fine, and the work must commit atomically with business data — the job row is inserted in the same transaction, so there is no dual-write problem. Libraries like pg-boss, Oban, River, Solid Queue, Que and GoodJob make this robust and add NOTIFY-based wake-ups to cut latency.',
        'Move off polling when you need sub-second latency at volume, fan-out to many consumers, or the scan load matters. Options: a message queue/stream (SQS, RabbitMQ, Kafka), outbox + log-based CDC (Debezium reading the WAL), or a workflow engine (Temporal) for long-running, stateful schedules.',
      ],
      table: {
        columns: ['Need', 'Poller OK?', 'Better fit'],
        rows: [
          ['< 10k jobs/day, seconds latency, same DB', 'Yes', 'Postgres job queue (SKIP LOCKED)'],
          ['Periodic batch at fixed times', 'Yes, with care', 'k8s CronJob Forbid / Quartz cluster / Temporal Schedule'],
          ['Events to many consumers', 'No', 'Kafka / SNS fan-out'],
          ['Reliable publish after DB commit', 'Sometimes', 'Outbox + CDC (Debezium)'],
          ['High volume, sub-100 ms latency', 'No', 'Message queue with push consumers'],
        ],
      },
      insight:
        'The question is not “polling vs events” but “is the scan cost and latency acceptable at our volume, and is the claim safe?”',
    },
  ],

  scaling: {
    body: [
      'A poller scales by adding instances only if claims are disjoint (SKIP LOCKED) and the database can absorb the extra polls. In practice the database becomes the limit first: each poll is a transaction, each claimed row a write, and every completed job creates dead tuples to vacuum.',
      'Postgres job queues commonly sustain thousands to low tens of thousands of jobs per second on good hardware with batching, partitioned or frequently cleaned tables and NOTIFY wake-ups; beyond that, a dedicated broker is cheaper.',
    ],
    bullets: [
      'Claim in batches (50–500 rows) to amortize the transaction.',
      'Partial index on pending rows; delete or partition-drop completed rows.',
      'LISTEN/NOTIFY or adaptive backoff: poll fast when busy, slowly when idle.',
      'Short claim transactions + leases; never hold row locks during the work.',
      'Run pollers against the primary only for claims; reporting queries elsewhere.',
      'Cap pollers × batch size by DB connection budget.',
    ],
  },

  failures: [
    {
      name: 'Duplicate processing',
      symptom: 'Emails or webhooks sent twice after adding a second poller or during a deploy overlap.',
      detect: 'Duplicate idempotency keys downstream; jobs with two `done` transitions in audit logs.',
      mitigate: '`FOR UPDATE SKIP LOCKED` claims, leases, idempotent handlers keyed by job id.',
    },
    {
      name: 'Silent missed schedule',
      symptom: 'The cron host was down or the CronJob hit its missed-schedule limit; nobody notices until a customer asks.',
      detect: 'Dead-man’s-switch alert on last success timestamp; CronJob `lastSuccessfulTime`.',
      mitigate: 'Run the trigger in an HA scheduler; `startingDeadlineSeconds`; idempotent catch-up by logical date.',
    },
    {
      name: 'Scan load on the primary',
      symptom: 'Poll query tops `pg_stat_statements`; DB CPU rises with table size even at low traffic.',
      detect: 'Query time and rows examined per poll; sequential scans on the jobs table.',
      mitigate: 'Partial index, retention/partitioning, longer idle interval, NOTIFY wake-ups, or move to a queue.',
    },
    {
      name: 'Stranded claims',
      symptom: 'Jobs stuck in `running` forever after a worker crash.',
      detect: 'Count and age of `running` rows past their lease.',
      mitigate: 'Lease column plus reaper; attempts counter with dead-letter state after max retries.',
    },
    {
      name: 'Overlapping long runs',
      symptom: 'A 70-minute job on an hourly schedule stacks up copies; DB and memory pressure grow.',
      detect: 'Concurrent run count; job duration vs interval.',
      mitigate: '`concurrencyPolicy: Forbid`, Temporal overlap policy Skip, or a lock with the run date as key.',
    },
    {
      name: 'DST double run',
      symptom: 'A local-time job runs twice (or never) on transition days, doubling or skipping a business day.',
      detect: 'Run history around DST dates; reconciliation of daily totals.',
      mitigate: 'Schedule in UTC; pass explicit logical dates; idempotent per date.',
    },
  ],

  warStories: [
    {
      title: 'The poller that became the top query',
      source: 'Composite of common incidents',
      what:
        'An outbox relay polled `SELECT * FROM outbox WHERE sent = false ORDER BY id LIMIT 100` every 200 ms from 6 pods. Sent rows were never deleted. After a year the table had 80 M rows, the boolean filter could not use an index efficiently, and the poll consumed a large share of primary CPU while finding nothing most of the time. Checkout latency rose during peaks.',
      lesson: 'Index the pending subset, delete or partition finished rows, and prefer CDC for high-volume outbox relays.',
    },
    {
      title: 'Two cron hosts, two invoices',
      source: 'Composite of common incidents',
      what:
        'To remove a single point of failure, the team copied the billing crontab to a second VM. The job used `SELECT … WHERE status = \'pending\'` without row locks, so both hosts invoiced the same customers each night until finance spotted duplicates days later.',
      lesson: 'HA scheduling needs one trigger (CronJob Forbid, Quartz cluster, Temporal) plus idempotent, claim-safe jobs — not copies of crontab.',
    },
  ],

  numbers: [
    { label: 'Average added latency', value: 'interval / 2', note: 'worst case = interval' },
    { label: 'Polls per day at 1 s', value: '86,400', note: 'per poller, mostly empty' },
    { label: 'SKIP LOCKED availability', value: 'Postgres 9.5+, MySQL 8.0+' },
    { label: 'Claim batch size', value: '50–500 rows', note: 'amortizes transaction cost' },
    { label: 'Lease length', value: '2–10× p99 job time', note: 'reaper resets after expiry' },
    { label: 'k8s CronJob missed limit', value: '100 schedules', note: 'then stops scheduling' },
    { label: 'Quartz misfireThreshold', value: '60 s default' },
    { label: 'LISTEN/NOTIFY wake-up', value: '~ms', note: 'removes interval latency' },
  ],

  capacity: {
    question:
      'An app creates 200 jobs/s at peak (each ~20 ms of work) in Postgres. Can a SKIP LOCKED poller handle it with < 1 s p50 pickup latency?',
    steps: [
      'Latency: interval 1 s ⇒ ~0.5 s average wait; meets p50 < 1 s (add NOTIFY for lower).',
      'Throughput: 200 jobs/s × 20 ms = 4 worker-seconds per second ⇒ ≥ 4 busy workers; run 8 for headroom.',
      'DB writes: claim + done = 2 row updates/job ⇒ 400 updates/s plus 200 inserts — modest for Postgres.',
      'Polls: 8 workers × 1/s = 8 claims/s with batch 50 — fine; idle cost ~700k empty polls/day, acceptable.',
      'Retention: 17 M rows/day ⇒ delete hourly or use daily partitions to keep vacuum and the index small.',
    ],
    answer:
      'Yes — 8 SKIP LOCKED workers at 1 s with batching and aggressive cleanup handle it comfortably. At 10× volume or with fan-out needs, move to a broker or CDC.',
  },

  comparison: {
    caption: 'Ways to trigger background work',
    columns: ['Option', 'Latency', 'Duplicates', 'Missed runs', 'Best for'],
    rows: [
      ['crontab + naive SELECT', 'interval/2', 'Yes, with >1 host', 'Silent on host loss', 'Prototypes only'],
      ['Postgres queue (SKIP LOCKED)', 'interval/2 or ~ms with NOTIFY', 'At-least-once, disjoint claims', 'Lease + reaper', 'Low–mid volume, same-DB jobs'],
      ['k8s CronJob (Forbid)', 'Schedule-bound', 'Rare (controller-level)', 'startingDeadlineSeconds', 'Periodic batch'],
      ['Quartz cluster / Temporal Schedule', 'Schedule-bound', 'One node fires', 'Misfire / catch-up policy', 'Business schedules'],
      ['Queue / outbox + CDC', '~ms', 'At-least-once', 'Durable log', 'Event-driven, high volume'],
    ],
  },

  whenNot: [
    'High-volume event processing where seconds of latency or idle scan load matter — use a queue or CDC.',
    'Fan-out to many independent consumers — a log or pub/sub fits; a polled table creates per-consumer state you have to build.',
    'Running the same crontab on several hosts for HA — use a single HA trigger plus idempotent jobs.',
    'Polling another team’s database — couple to an event or API instead of their schema.',
    'Detecting deletes or every intermediate change — polling sees only current state; use CDC.',
  ],

  interview: [
    {
      q: 'What is wrong with a cron job that polls a table for pending work?',
      a: 'Latency of interval/2 on average, continuous load on the database even when idle, duplicate processing once there is more than one poller unless claims use row locks, missed runs when the single cron host is down, overlap when jobs take longer than the interval, and DST/time-zone surprises. It is fine for low volume if hardened with SKIP LOCKED claims, leases and idempotent handlers.',
      followUps: ['How do you make two pollers not collide?', 'How would you cut latency without polling faster?', 'How do you detect a schedule that stopped?'],
      seniorSignal: 'Distinguishes the naive version from a hardened Postgres queue and knows when each is acceptable.',
    },
    {
      q: 'Explain FOR UPDATE SKIP LOCKED.',
      a: 'It locks the selected rows like FOR UPDATE, but rows already locked by another transaction are skipped instead of waited on. Multiple workers running the same claim query receive disjoint batches with no blocking. Combine it with an UPDATE that marks the rows claimed and sets a lease, commit quickly, and process outside the transaction.',
      followUps: ['Why not hold the lock while processing?', 'What ordering guarantees do you lose?', 'Which databases support it?'],
      seniorSignal: 'Keeps the claim transaction short and adds a lease/reaper for crashes.',
    },
    {
      q: 'How do you run a nightly job reliably across failures?',
      a: 'Use one HA trigger — a Kubernetes CronJob with concurrencyPolicy Forbid and startingDeadlineSeconds, a Quartz cluster, or a Temporal Schedule — scheduled in UTC. Make the job idempotent by logical date so retries and catch-up are safe, and alert when there has been no successful run within the expected window.',
      followUps: ['What happens if the job overruns?', 'How do you backfill a missed week?', 'Why UTC?'],
      seniorSignal: 'Uses idempotency by logical date and dead-man’s-switch monitoring.',
    },
    {
      q: 'Outbox relay: poll the table or use CDC?',
      a: 'Polling is simple and fine at modest volume, with a partial index and prompt deletion of sent rows; it adds interval latency and DB load. Log-based CDC (Debezium) reads the WAL, adds no query load, delivers in milliseconds and preserves commit order, at the cost of running Kafka Connect and managing replication slots. I would start with polling and switch when latency or load justify it.',
      followUps: ['What happens if a replication slot falls behind?', 'How do you keep ordering per aggregate?', 'How do consumers dedupe?'],
      seniorSignal: 'Names the operational costs of CDC as well as its benefits.',
    },
    {
      q: 'When would you choose a Postgres-backed job queue over SQS or Kafka?',
      a: 'When jobs must be created atomically with business data (same transaction, no dual write), volume is moderate, and the team wants one stateful dependency. Libraries like pg-boss, Oban, River or Solid Queue give retries, scheduling and uniqueness. Choose a broker when volume, fan-out or isolation from the primary database matters more.',
      followUps: ['How would you know you have outgrown it?', 'How do you isolate job load from OLTP?', 'What about vacuum?'],
      seniorSignal: 'Treats the DB queue as a deliberate trade-off with clear exit criteria.',
    },
  ],

  takeaways: [
    'Polling costs interval/2 latency and constant load, even when there is no work.',
    'More than one poller requires atomic claims: `FOR UPDATE SKIP LOCKED` plus leases.',
    'Single-host cron silently misses runs; use an HA trigger and dead-man’s-switch alerts.',
    'Schedule in UTC and make jobs idempotent by logical date.',
    'Hardened Postgres job queues are legitimate at moderate volume.',
    'Move to queues, CDC or workflow schedulers when latency, volume or fan-out demand it.',
  ],
};

export default deep;
