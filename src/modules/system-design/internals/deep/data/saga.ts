import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'saga',

  problem: {
    why: 'Once data is split across services, a business operation like "place order" touches inventory, payments and shipping, each with its own database. A distributed ACID transaction across them (2PC) needs every participant to support prepare, holds locks across the network and blocks when the coordinator fails — and third-party APIs cannot participate at all. A **saga** (Garcia-Molina & Salem, 1987) gives up isolation: it runs a sequence of local transactions and, if one fails, executes **compensating transactions** for those already committed.',
    withoutIt: [
      'A failed payment leaves stock reserved forever because nothing undoes earlier steps.',
      'A crash between "charge card" and "create shipment" leaves a paid order nobody ships, with no record of where the flow stopped.',
      'Retries of non-idempotent calls charge customers twice.',
      'Teams reach for 2PC/XA and couple the availability of every service to every other.',
      'Long-running flows (approvals, waiting for a courier) hold threads or HTTP requests open for hours.',
    ],
    position: 'Above the participating services: an orchestrator (or a chain of event reactions) receives the business request, issues commands to each service through queues/RPC, persists its progress, and drives compensations and timeouts.',
    diagram: {
      type: 'sequence',
      title: 'Orchestrated order saga with a failure',
      actors: ['Orchestrator', 'Inventory', 'Payments', 'Shipping'],
      messages: [
        { from: 'Orchestrator', to: 'Inventory', label: 'ReserveStock' },
        { from: 'Inventory', to: 'Orchestrator', label: 'Reserved', dashed: true, tone: 'ok' },
        { from: 'Orchestrator', to: 'Payments', label: 'Charge' },
        { from: 'Payments', to: 'Orchestrator', label: 'Declined', dashed: true, tone: 'bad' },
        { from: 'Orchestrator', to: 'Inventory', label: 'ReleaseStock (compensate)', tone: 'warn' },
        { from: 'Inventory', to: 'Orchestrator', label: 'Released', dashed: true },
      ],
      caption: 'Shipping is never called: risky steps run first, compensations run in reverse.',
    },
  },

  architecture: {
    overview: 'An orchestrated saga is a **persistent state machine**: each transition (step started, step succeeded, compensation started…) is durably recorded before the next action, commands to participants leave through an **outbox** or a durable task queue, and every participant handles commands idempotently. Durable-execution engines (Temporal, Cadence, Step Functions) package all of this — history, timers, retries, task queues — so the saga is written as ordinary code or a state-machine definition.',
    diagram: {
      type: 'layers',
      title: 'Saga orchestrator anatomy',
      layers: [
        { name: 'Definition', items: ['Steps + compensations', 'Retry policies', 'Timeouts / deadlines'], tone: 'accent' },
        { name: 'Execution', items: ['State machine / workflow code', 'Timers', 'Signals (external events)'], tone: 'info' },
        { name: 'Durability', items: ['Saga state / event history', 'Outbox or task queues', 'Idempotency keys'], tone: 'violet' },
        { name: 'Participants', items: ['Local ACID transactions', 'Dedupe on (sagaId, step)', 'Compensation handlers'], tone: 'ok' },
      ],
    },
    blocks: [
      { name: 'Saga instance state', what: '`saga(id, type, state, step, data, version, deadline)` or an append-only history. Updated with optimistic concurrency so two workers cannot advance the same saga.' },
      { name: 'Step types', what: '**Compensatable** steps (can be undone), the **pivot** (go/no-go point, e.g. charge card) and **retriable** steps after the pivot that must eventually succeed and are never compensated.' },
      { name: 'Transactional outbox', what: 'Commands are inserted into an `outbox` table in the same transaction as the state change and relayed by CDC (Debezium Outbox Event Router) or a poller — no "state saved, message lost" window.' },
      { name: 'Idempotent participants', what: 'Each command carries `(sagaId, step)` as an idempotency key; participants store processed keys with the business change so redeliveries return the original result.' },
      { name: 'Timers and deadlines', what: 'Durable timers ("cancel if not paid in 15 min") stored with the saga, not in process memory, so they fire after restarts.' },
      { name: 'Compensation log', what: 'The list of completed compensatable steps, so compensation runs in reverse order and only for steps that actually happened.' },
    ],
    real: [
      { name: 'Temporal (fork of Uber Cadence)', how: 'Workflow code runs on your workers; every decision and activity result is appended to an **event history** in a sharded persistence layer (Cassandra, MySQL or Postgres). On a worker crash, another worker **replays** the code against the history to rebuild local state — so workflow code must be deterministic. Activities have `StartToClose`, `ScheduleToClose` and heartbeat timeouts plus retry policies.' },
      { name: 'AWS Step Functions', how: 'Amazon States Language (JSON) state machines with per-state `Retry` and `Catch`. **Standard** workflows run up to 1 year with exactly-once state transitions and a 25,000-event history limit; **Express** workflows run up to 5 minutes at high rates with at-least-once (async) semantics. Priced per state transition for Standard (~$25 per million).' },
      { name: 'Axon Framework sagas', how: 'Event-driven sagas in Java: `@StartSaga`/`@SagaEventHandler(associationProperty = "orderId")` route events to saga instances, which are persisted in a saga store and send commands via the command gateway; deadlines via a `DeadlineManager`.' },
      { name: 'Camunda (BPMN, Zeebe)', how: 'Flows modelled in BPMN with compensation events and boundary timers; Camunda 8’s Zeebe engine stores process state in Raft-replicated, event-sourced partitions and hands tasks to job workers.' },
      { name: 'Choreography with Kafka + outbox', how: 'No central engine: each service commits its state + outbox event, and the next service reacts. Compensation is triggered by failure events (`PaymentDeclined` → inventory releases). Simple for 2–3 steps; hard to observe and change beyond that.' },
    ],
  },

  lifecycle: {
    summary: 'One successful three-step order saga on a durable-execution engine; most time is spent in participants, not the orchestrator.',
    stages: [
      { stage: 'Start saga', what: 'API starts workflow `order-77` with the client’s idempotency key as the workflow id (duplicate starts are rejected).', cost: 'Persist start event', ms: 10, part: 'start' },
      { stage: 'Schedule step 1', what: 'Record "ReserveStock scheduled" and enqueue the task.', cost: 'History write + task queue', ms: 5, part: 'state' },
      { stage: 'Reserve stock', what: 'Inventory runs a local transaction, deduped on `order-77/reserve`.', cost: 'Service call + DB commit', ms: 25, part: 'participant' },
      { stage: 'Charge (pivot)', what: 'Payments calls the PSP with `Idempotency-Key: order-77/charge`.', cost: 'External PSP call', ms: 400, part: 'participant' },
      { stage: 'Book shipping', what: 'Retriable step after the pivot: retried with backoff until it succeeds.', cost: 'Service call + DB commit', ms: 40, part: 'participant' },
      { stage: 'Complete', what: 'Record completion, release semantic lock (`status = CONFIRMED`), emit `OrderConfirmed` via outbox.', cost: 'History write + outbox', ms: 10, part: 'orchestrator' },
    ],
  },

  deepDives: [
    {
      title: 'Orchestration vs choreography',
      hook: 'Choreography looks decoupled until nobody can tell what happens after `OrderPlaced`.',
      body: [
        '**Choreography**: services react to each other’s events. No single point of control, natural for 2–3 steps, but the flow is implicit (spread across consumers), cyclic dependencies creep in, and "where is order 77?" requires correlating logs across services.',
        '**Orchestration**: one component owns the flow, sends commands and handles replies, timeouts and compensations. The flow is explicit, testable and observable; the orchestrator is a dependency, but a stateless-over-durable-state one that scales horizontally.',
      ],
      diagram: {
        type: 'compare',
        columns: [
          { name: 'Choreography', tone: 'info', points: ['Services react to events', 'No central component', 'Flow implicit, hard to trace', 'Good for 2–3 steps'] },
          { name: 'Orchestration', tone: 'ok', points: ['Orchestrator sends commands', 'Flow in one place', 'Timeouts + compensation explicit', 'Good for 4+ steps, branching'] },
        ],
      },
      insight: 'Many systems mix them: choreography between bounded contexts (publish `OrderConfirmed`), orchestration inside one business process. The question is who owns the process — if the answer is "nobody", you need an orchestrator.',
    },
    {
      title: 'Compensations, pivot and retriable steps',
      hook: 'A compensation is a new business transaction, not a rollback — and some steps cannot be undone.',
      body: [
        'Compensation is **semantic undo**: `Refund` for `Charge`, `ReleaseStock` for `ReserveStock`, `SendApology` for an email that cannot be unsent. It may not restore the exact prior state (a refund shows on the statement; fees may apply), and it must be idempotent and retried until it succeeds.',
        'Order the saga so that **compensatable** steps (cheap to undo, likely to fail) come first, then the **pivot** (the go/no-go step — after it succeeds the saga only moves forward), then **retriable** steps that cannot fail for business reasons and are retried until done. Validating stock and credit before charging minimizes compensations.',
      ],
      diagram: {
        type: 'flow',
        title: 'Step classification',
        nodes: [
          { label: 'Create order PENDING', sub: 'compensatable', tone: 'info' },
          { label: 'Reserve stock', sub: 'compensatable', tone: 'info' },
          { label: 'Charge card', sub: 'pivot: point of no return', tone: 'warn' },
          { label: 'Book shipping', sub: 'retriable until success', tone: 'ok' },
          { label: 'Confirm order', sub: 'retriable', tone: 'ok' },
        ],
      },
      insight: 'If a step after the pivot can fail for business reasons (shipping unavailable to that address), your pivot is in the wrong place — move the validation before the charge, or make the step compensatable and accept a refund path.',
    },
    {
      title: 'Isolation anomalies and countermeasures',
      hook: 'Sagas are ACD without I: other requests see — and act on — intermediate states.',
      body: [
        'Anomalies: **lost updates** (saga B overwrites changes made by saga A before A compensates), **dirty reads** (a request reads stock reserved by a saga that later rolls back), **fuzzy reads** (a saga reads a value twice and gets different results). Countermeasures, catalogued by Lars Frank and Torben Zahle (1998) and popularized by Chris Richardson:',
      ],
      bullets: [
        '**Semantic lock**: an application-level flag (`status = APPROVAL_PENDING`) that tells others the record is in-flight; they wait, fail, or treat it specially.',
        '**Commutative updates**: design steps so order does not matter (debit/credit as deltas), so interleaving sagas cannot lose updates.',
        '**Pessimistic view**: reorder steps to minimize business risk from dirty reads (e.g. increase available credit only in a final retriable step).',
        '**Reread value**: before overwriting, re-read and verify the record has not changed (optimistic check), and abort or restart otherwise.',
        '**Version file**: record operations as they arrive so non-commutative ones can be reordered correctly (e.g. a cancel that arrives before the create).',
        '**By value**: choose the concurrency mechanism per request risk — high-value requests use distributed locking or stricter flows, low-value ones plain sagas.',
      ],
      insight: 'A semantic lock is a lock — it needs a timeout and an owner, or a crashed saga leaves records stuck in `PENDING` forever. Durable timers on the saga are what release it.',
    },
    {
      title: 'Reliable commands: outbox and idempotency',
      hook: 'The saga is only as reliable as the gap between "state saved" and "message sent".',
      body: [
        'Without an outbox, the orchestrator saves "step 2 started" and then publishes a command; a crash in between leaves the saga waiting forever, while publishing first and saving second can send a command the saga does not know about. The **transactional outbox** writes the command row in the same local transaction as the state; a relay (CDC or poller) publishes it at least once.',
        'At-least-once delivery means every participant needs idempotency on `(sagaId, step)`. Store the processed key and the result together with the business change, and return the stored result on duplicates. For external APIs, pass the key through (Stripe `Idempotency-Key`; Stripe keeps keys for at least 24 hours) — and make sure saga retries outlast neither that window nor your own dedupe retention.',
      ],
      code: {
        lang: 'sql',
        caption: 'State change + command in one local transaction',
        code: `BEGIN;
UPDATE saga_instance
   SET state = 'CHARGING', step = 2, version = version + 1
 WHERE saga_id = 'order-77' AND version = 4;        -- optimistic guard

INSERT INTO outbox (id, aggregate_id, type, payload)
VALUES (gen_random_uuid(), 'order-77', 'ChargeCard',
        '{"sagaId":"order-77","step":2,"amount":12000,"idemKey":"order-77/charge"}');
COMMIT;
-- Debezium Outbox Event Router publishes outbox rows to Kafka`,
      },
      insight: 'Deriving the idempotency key deterministically from `(sagaId, step)` — not generating a fresh UUID per attempt — is what makes retries safe. A random key per retry is the most common double-charge bug.',
    },
    {
      title: 'Durable execution: how Temporal/Cadence work',
      hook: 'Write the saga as normal code; the engine makes it survive crashes by replaying history.',
      body: [
        'Cadence was built at Uber by Maxim Fateev and Samar Abbas, who had earlier worked on AWS Simple Workflow; they forked it into Temporal in 2019. Workflow code calls activities (side effects) through the SDK; each call’s scheduling and result is appended to the workflow’s **event history**. If a worker dies, another worker re-executes the workflow function from the start, and the SDK feeds recorded results instead of re-running activities, until the code reaches the new point.',
        'Consequences: workflow code must be **deterministic** (no wall-clock time, random numbers, threads or direct I/O — use SDK APIs), code changes need versioning (`workflow.GetVersion` / patching) so in-flight histories still replay, and histories have limits (Temporal warns around 10k events and terminates at 51,200 events or 50 MB) — long-running sagas use **Continue-As-New**.',
      ],
      code: {
        lang: 'go',
        caption: 'Temporal saga with compensations (Go SDK, simplified)',
        code: `func OrderSaga(ctx workflow.Context, o Order) (err error) {
    ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
        StartToCloseTimeout: 10 * time.Second,
        RetryPolicy: &temporal.RetryPolicy{MaximumAttempts: 5},
    })
    var comps []func(workflow.Context) error
    defer func() {
        if err != nil { // compensate in reverse, on a disconnected ctx
            dc, _ := workflow.NewDisconnectedContext(ctx)
            for i := len(comps) - 1; i >= 0; i-- { _ = comps[i](dc) }
        }
    }()
    if err = workflow.ExecuteActivity(ctx, ReserveStock, o).Get(ctx, nil); err != nil { return }
    comps = append(comps, func(c workflow.Context) error {
        return workflow.ExecuteActivity(c, ReleaseStock, o).Get(c, nil) })
    if err = workflow.ExecuteActivity(ctx, Charge, o).Get(ctx, nil); err != nil { return } // pivot
    return workflow.ExecuteActivity(ctx, BookShipping, o).Get(ctx, nil) // retriable
}`,
      },
      insight: 'Durable execution makes the **orchestrator** exactly-once at the level of state transitions, but activities are still at-least-once. Idempotency in participants remains your job.',
    },
    {
      title: 'Declarative sagas: Step Functions `Catch` chains',
      hook: 'In a state-machine engine, compensation is just another branch of the graph.',
      body: [
        'Step Functions models each step as a `Task` state with `Retry` (transient errors, exponential backoff) and `Catch` (route to a compensation state). Compensation states chain in reverse and end in a `Fail` state, so the execution history shows exactly which steps ran and which were undone. Standard workflows give exactly-once state transitions and can wait up to a year (e.g. for a human approval via a task token).',
        'The same structure appears in BPMN engines (Camunda compensation events) and in Axon/Temporal code — the engine changes, the shape does not: forward steps, a pivot, and a reverse chain of idempotent compensations.',
      ],
      code: {
        lang: 'json',
        caption: 'Amazon States Language (excerpt)',
        code: `"ReserveStock": {
  "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
  "Parameters": { "FunctionName": "reserve-stock", "Payload.$": "$" },
  "Retry": [{ "ErrorEquals": ["States.TaskFailed"], "IntervalSeconds": 2,
              "MaxAttempts": 3, "BackoffRate": 2.0 }],
  "Catch": [{ "ErrorEquals": ["States.ALL"], "ResultPath": "$.error",
              "Next": "OrderFailed" }],
  "Next": "ChargeCard"
},
"ChargeCard": {
  "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
  "Parameters": { "FunctionName": "charge-card", "Payload.$": "$" },
  "Catch": [{ "ErrorEquals": ["States.ALL"], "ResultPath": "$.error",
              "Next": "ReleaseStock" }],
  "Next": "BookShipping"
},
"ReleaseStock": {
  "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
  "Parameters": { "FunctionName": "release-stock", "Payload.$": "$" },
  "Retry": [{ "ErrorEquals": ["States.ALL"], "MaxAttempts": 10, "BackoffRate": 2.0 }],
  "Next": "OrderFailed"
}`,
      },
      insight: 'Express workflows are at-least-once for asynchronous invocations: a saga on Express can run a step twice, so participant idempotency matters even more there — and Express cannot wait for long human or partner callbacks.',
    },
    {
      title: 'Timeouts, stuck sagas and operability',
      hook: 'Every saga eventually meets a participant that never answers.',
      body: [
        'Every step needs a timeout, and the saga needs an overall deadline that triggers compensation ("cancel and refund if not shipped in 48 h"). Distinguish "no reply" from "failed": a timed-out charge may have succeeded, so the next action is to **query** the participant (or retry with the same idempotency key), not to blindly compensate.',
        'Operability: a searchable view of saga instances by state and age, alerts on sagas stuck in one state beyond its SLO, a "compensation failed" queue with manual-repair tooling, and the ability to retry or skip a step for a given instance.',
      ],
      bullets: [
        'Metrics: sagas started/completed/compensated per type, step latency p99, age of oldest in-flight saga, compensation-failure count.',
        'Temporal: `ScheduleToStart` latency shows worker starvation; Step Functions: `ExecutionsTimedOut`, `ExecutionsFailed` CloudWatch metrics.',
      ],
      insight: 'Compensations must be designed not to fail for business reasons (a refund cannot be "declined"). When they fail technically, retry with backoff, then park for humans — never drop silently.',
    },
  ],

  scaling: {
    body: [
      'The orchestrator is stateless compute over durable state, so it scales horizontally: any worker can advance any saga. The persistence layer is sharded by saga/workflow id (Temporal uses a fixed number of history shards set at cluster creation — choose it for the largest scale you expect, because it cannot be changed later).',
      'Participants scale independently; queues between orchestrator and participants absorb bursts and outages, at the cost of end-to-end latency. Throughput limits usually come from persistence writes per transition (several per step) and from participant rate limits (PSPs).',
      'Multi-region: a saga instance should have one home region at a time. Temporal’s multi-cluster replication and Step Functions’ regional nature mean failover moves ownership; participants must still dedupe because in-flight commands may be re-sent after failover.',
    ],
    bullets: [
      'Each step costs several persistence writes (scheduled, started, completed); size the store for transitions/s, not sagas/s.',
      'Keep payloads small (Step Functions: 256 KB per state input/output); pass references, not documents.',
      'Separate task queues per participant so a slow service does not starve others.',
      'Long-running sagas: Continue-As-New to bound history size.',
      'Rate-limit activity workers to protect downstream services and third-party quotas.',
    ],
    diagram: {
      type: 'flow',
      title: 'Scaled orchestration',
      nodes: [
        { label: 'API', sub: 'start saga (idempotent id)' },
        { label: 'Orchestrator workers', sub: 'stateless, N replicas', tone: 'accent' },
        { label: 'Sharded history', sub: 'by saga id', tone: 'violet' },
        { label: 'Task queues', sub: 'per participant', tone: 'info' },
        { label: 'Participants', sub: 'idempotent local tx', tone: 'ok' },
      ],
    },
  },

  failures: [
    { name: 'Compensation fails', symptom: 'Order cancelled but card still charged; stock reserved forever.', detect: 'Compensation-failure counter, sagas in `COMPENSATING` older than N minutes.', mitigate: 'Infinite-ish retries with backoff, idempotent compensations, park + alert + manual repair tooling.' },
    { name: 'Duplicate side effects', symptom: 'Customer charged twice after a timeout/retry.', detect: 'PSP reconciliation report vs orders; duplicate `(sagaId, step)` attempts.', mitigate: 'Deterministic idempotency keys passed to every participant and external API.' },
    { name: 'Message lost between state and send', symptom: 'Sagas stuck in a step with no participant activity.', detect: 'Age of oldest in-flight saga per state; outbox relay lag.', mitigate: 'Transactional outbox or durable task queue; re-send on timeout.' },
    { name: 'Non-deterministic workflow code', symptom: 'Temporal workers fail with non-determinism errors after a deploy; sagas stall.', detect: 'Workflow task failure rate after deploys; replay tests in CI.', mitigate: 'Versioning/patching APIs, replay tests against production histories.' },
    { name: 'Isolation anomaly', symptom: 'Overselling: two sagas both see stock available.', detect: 'Negative stock or reconciliation mismatches.', mitigate: 'Reserve with a local atomic decrement (semantic lock), commutative updates, re-read before pivot.' },
    { name: 'Choreography cycle', symptom: 'Event ping-pong between services; unexpected cascades.', detect: 'Trace depth per correlation id; event rate amplification.', mitigate: 'Move the flow to an orchestrator; causation ids; cycle detection.' },
  ],

  warStories: [
    { title: 'The refund that could not be issued', source: 'Composite of common incidents', what: 'A checkout saga compensated a failed shipment by refunding the card. The PSP rejected refunds on cards that had since expired, and the compensation retried forever; thousands of sagas sat in `COMPENSATING` while customers waited for money.', lesson: 'Compensations need alternative paths (store credit, manual payout) and a human-escalation queue; "retry until success" needs a ceiling and an alert.' },
    { title: 'Cadence: born from Uber’s orchestration pain', source: 'Uber Engineering / Temporal founders’ public talks', what: 'Uber had many teams hand-building flows from queues, cron jobs and state tables, each with its own retry, timeout and recovery bugs. Cadence centralized durable execution (event history + replay) and was open-sourced in 2017; its authors forked it into Temporal in 2019.', lesson: 'If you have more than a couple of sagas, the durable-execution infrastructure (history, timers, retries, visibility) is the hard part — buy or adopt it rather than re-building it per team.' },
    { title: 'Random idempotency keys, double charges', source: 'Composite of common incidents', what: 'A payment step generated a new UUID as the PSP idempotency key on each retry. A network timeout after a successful charge led to a retry with a fresh key and a second charge.', lesson: 'Derive keys from `(sagaId, step)` so every retry of the same step is the same request.' },
  ],

  numbers: [
    { label: 'Typical saga length', value: '3–7 steps', note: 'longer flows usually split into sub-sagas' },
    { label: 'Orchestrator overhead per step', value: '~5–20 ms', note: 'persistence writes + queueing' },
    { label: 'Step Functions Standard price', value: '~$25 per million transitions', note: '$0.025 per 1,000' },
    { label: 'Step Functions Standard limits', value: '1 year, 25,000 events', note: 'Express: 5 minutes' },
    { label: 'Step Functions payload', value: '256 KB', note: 'per state input/output' },
    { label: 'Temporal history limit', value: '51,200 events / 50 MB', note: 'warns at ~10k; use Continue-As-New' },
    { label: 'Stripe idempotency key retention', value: '≥ 24 hours', note: 'retries must happen inside the window' },
    { label: 'Compensation rate (healthy)', value: '< 1–5% of sagas', note: 'higher means steps are mis-ordered' },
  ],

  capacity: {
    question: 'Checkout runs 2,000 orders/s at peak through a 5-step saga on a durable-execution engine. Each step costs ~3 persistence writes. Size the persistence layer.',
    steps: [
      'Transitions: 2,000 sagas/s × 5 steps ≈ 10,000 steps/s.',
      'Writes: ≈ 3 per step + ~2 per saga for start/complete ⇒ ~34,000 writes/s.',
      'History size: ~5 steps × 3 events × ~1 KB ≈ 15–20 KB per saga ⇒ ~35 MB/s ⇒ ~3 TB/day before retention cleanup.',
      'Retention 7 days for visibility/audit ⇒ ~20 TB; archive older histories to object storage.',
      'Shards: at ~1,000 writes/s per shard host comfortably, plan for 40+ active shard owners and a shard count (e.g. 4k–16k) that will not need changing.',
    ],
    answer: '~34k persistence writes/s and ~3 TB/day of history: a sizeable Cassandra (or equivalent) cluster with short retention plus archival. Persistence, not orchestrator CPU, is the cost driver — keep payloads small and steps few.',
  },

  comparison: {
    caption: 'Ways to implement sagas',
    columns: ['Option', 'Model', 'Durability', 'Strengths', 'Weaknesses'],
    rows: [
      ['Temporal / Cadence', 'Code + event-history replay', 'Sharded DB (Cassandra/SQL)', 'Any language logic, timers, visibility', 'Determinism rules, infra to run'],
      ['AWS Step Functions', 'JSON state machine (ASL)', 'Managed', 'No servers, AWS integrations', 'Per-transition cost, payload limits, vendor lock-in'],
      ['Camunda / Zeebe', 'BPMN', 'Raft-replicated partitions', 'Business-visible models, human tasks', 'Heavier, BPMN learning curve'],
      ['Axon sagas', 'Event-driven classes', 'Saga store (SQL)', 'Fits Axon CQRS/ES apps', 'Java/Axon only'],
      ['Home-grown table + outbox', 'Custom state machine', 'Your DB', 'No new infra', 'You rebuild retries, timers, tooling'],
    ],
  },

  whenNot: [
    'When the data can live in one database — use a local ACID transaction; redraw service boundaries before adding a saga.',
    'When you need strict isolation (financial ledger postings) — keep it within one transactional store or use a ledger with double-entry invariants.',
    'For two-step fire-and-forget reactions — a simple event consumer with idempotency is enough.',
    'Inside a distributed SQL database — its own transactions (2PC over consensus) are simpler and correct.',
  ],

  interview: [
    {
      q: 'Design order placement across inventory, payment and shipping services.',
      a: 'An orchestrated saga: create order `PENDING` (semantic lock), reserve stock, charge card as the pivot, then book shipping and confirm as retriable steps. State and commands are persisted atomically (outbox or durable execution), every step is idempotent on `(sagaId, step)`, and failures before the pivot trigger compensations in reverse. Timeouts query participants before compensating, and an overall deadline cancels stale orders.',
      followUps: ['Why is the charge the pivot?', 'What if shipping fails after charging?', 'How does the user see progress?'],
      seniorSignal: 'Orders steps by risk around an explicit pivot and treats timeouts as "unknown outcome" rather than failure.',
    },
    {
      q: 'Sagas have no isolation. Give a concrete anomaly and how you prevent it.',
      a: 'Dirty read: saga A reserves the last unit; a stock-level report or saga B reads it as sold; A then compensates and the unit reappears — B may have rejected a valid order. Lost update: B changes an order while A is mid-flight, and A’s compensation overwrites B’s change. Countermeasures: semantic locks (`PENDING` states), commutative delta updates, re-reading values before the pivot, and ordering steps so dirty reads only cause conservative decisions.',
      followUps: ['How long can a semantic lock be held?', 'What is a version file?', 'When would you use real locks?'],
      seniorSignal: 'Names specific countermeasures (semantic lock, commutative updates, reread, pessimistic view) and their costs.',
    },
    {
      q: 'What happens when a compensation fails?',
      a: 'Compensations are designed so they cannot fail for business reasons and are idempotent, so technical failures are retried with backoff — possibly for hours. If retries are exhausted the saga parks in a `COMPENSATION_FAILED` state with alerting and repair tooling (retry, alternative remedy like store credit, manual action). The system must never silently stop in an inconsistent state.',
      followUps: ['Give an example of a compensation that can fail for business reasons.', 'How do you test compensations?', 'Who owns the manual repair queue?'],
      seniorSignal: 'Designs alternative compensation paths and operational ownership, not just "retry".',
    },
    {
      q: 'How does Temporal survive a worker crash mid-saga?',
      a: 'Every activity scheduling and result is recorded in the workflow’s event history. Another worker picks up the workflow task and re-executes the workflow code from the beginning; the SDK returns recorded results for completed activities instead of running them, so the code deterministically reaches the same point and continues. That is why workflow code must be deterministic and versioned on change; activities themselves are at-least-once and must be idempotent.',
      followUps: ['What makes code non-deterministic?', 'How do you deploy a change to a running workflow?', 'What is Continue-As-New for?'],
      seniorSignal: 'Explains replay precisely and separates workflow determinism from activity idempotency.',
    },
    {
      q: 'Orchestration or choreography for a 6-step onboarding flow across 4 teams?',
      a: 'Orchestration: six steps with branching and timeouts need an explicit, observable owner of the process; choreography would spread the flow over four teams’ consumers and make changes and debugging cross-team projects. I would still publish domain events (choreography) at the boundaries for other consumers. The orchestrator is owned by the team that owns the business process.',
      followUps: ['Does the orchestrator become a bottleneck or a coupling point?', 'How do teams change their step independently?', 'How do you trace one onboarding?'],
      seniorSignal: 'Frames it as process ownership and team topology, and combines both styles.',
    },
    {
      q: 'How do you make sure the orchestrator does not lose commands?',
      a: 'The state change and the command are written in one local transaction via an outbox, and a relay (CDC or poller) publishes at-least-once; or a durable-execution engine whose task queues and history provide the same guarantee. Participants dedupe on `(sagaId, step)`. A stuck-saga detector re-sends commands for steps without a reply after a timeout.',
      followUps: ['Poller vs CDC relay trade-offs?', 'What ordering does the relay guarantee?', 'What if the participant is a third-party HTTP API?'],
      seniorSignal: 'Covers both ends: atomic publish on the sender and idempotent handling on the receiver.',
    },
  ],

  takeaways: [
    'A saga is a sequence of local transactions with compensations — atomicity eventually, isolation never.',
    'Compensations are semantic undo: new business transactions, idempotent, retried, with a human fallback.',
    'Order steps: compensatable first, then the pivot, then retriable steps that cannot fail for business reasons.',
    'Counter isolation anomalies with semantic locks, commutative updates, re-reads and careful ordering.',
    'Outbox (or durable execution) on the sending side, idempotency keys from `(sagaId, step)` on the receiving side.',
    'Durable execution (Temporal, Step Functions) gives history, timers and retries — but code must be deterministic and activities idempotent.',
    'Prefer orchestration once a flow has more than a few steps; keep choreography for boundaries.',
  ],
};

export default deep;
