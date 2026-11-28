import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'two-pc',

  problem: {
    why: 'Two-phase commit is the textbook answer to "commit in several databases atomically": a coordinator asks every participant to **prepare** (durably promise to commit), and only if all vote yes does it log and broadcast **commit**. It is tempting in microservice designs because it promises ACID across services with no compensation logic. The catch is the promise itself: a prepared participant has given up the right to decide, so it holds locks and **blocks** until the coordinator answers.',
    withoutIt: [
      'Inside one database engine, a cross-shard transaction could commit on shard A and abort on shard B — 2PC (over consensus) is how Spanner, CockroachDB and Kafka avoid that.',
      'Legacy XA setups (app server + two databases, or DB + message broker) would need sagas or outbox to stay consistent.',
      'Across microservices, nothing breaks without it — that is the point: sagas, outbox and idempotency replace it with better availability.',
    ],
    position: 'A coordinator (transaction manager, or one shard acting as coordinator) sits between the application and every resource manager touched by the transaction, on the **synchronous commit path**.',
    diagram: {
      type: 'sequence',
      title: 'The protocol',
      actors: ['App', 'Coordinator', 'Decision log', 'DB-1', 'DB-2'],
      messages: [
        { from: 'App', to: 'Coordinator', label: 'commit(xid)' },
        { from: 'Coordinator', to: 'DB-1', label: 'PREPARE' },
        { from: 'Coordinator', to: 'DB-2', label: 'PREPARE' },
        { from: 'DB-1', to: 'Coordinator', label: 'YES (fsynced, locks held)', dashed: true, tone: 'warn' },
        { from: 'DB-2', to: 'Coordinator', label: 'YES (fsynced, locks held)', dashed: true, tone: 'warn' },
        { from: 'Coordinator', to: 'Decision log', label: 'COMMIT record (fsync)', tone: 'accent' },
        { from: 'Coordinator', to: 'DB-1', label: 'COMMIT' },
        { from: 'Coordinator', to: 'DB-2', label: 'COMMIT' },
        { from: 'Coordinator', to: 'App', label: 'committed', dashed: true, tone: 'ok' },
      ],
      caption: 'Between YES and COMMIT the participants are "in doubt": they cannot decide alone.',
    },
  },

  architecture: {
    overview: 'Four pieces: participants that can **prepare** (persist all changes plus a prepare record, keep locks), a coordinator that collects votes, a **decision log** that is the single source of truth for the outcome, and recovery on both sides that resolves in-doubt transactions after crashes. The commit point is the moment the coordinator’s `COMMIT` record is durable — not when any participant commits.',
    diagram: {
      type: 'flow',
      title: 'Participant state machine',
      nodes: [
        { label: 'Active', sub: 'executing statements' },
        { label: 'Prepared', sub: 'fsynced, locks held', tone: 'warn' },
        { label: 'In doubt', sub: 'waiting for coordinator', tone: 'bad' },
        { label: 'Committed / aborted', sub: 'locks released', tone: 'ok' },
      ],
      caption: 'Before voting a participant may abort unilaterally; after voting YES it may not.',
    },
    blocks: [
      { name: 'Global transaction id (XID)', what: 'Identifies the transaction across participants (XA: format id + global id + branch qualifier). Every participant records it in its prepare record.' },
      { name: 'Prepare record', what: 'Written to the participant’s WAL and fsynced before voting YES, so the promise survives a crash. Postgres: `PREPARE TRANSACTION \'xid\'` (requires `max_prepared_transactions` > 0; default 0). MySQL: `XA PREPARE`.' },
      { name: 'Coordinator decision log', what: 'The coordinator fsyncs `COMMIT xid` (with the participant list) before phase 2. With **presumed abort**, no record means abort, so aborts need no forced log write.' },
      { name: 'Locks held while in doubt', what: 'Row locks (and in Postgres, the xmin horizon) are retained across the prepare–commit gap; other transactions on those rows wait.' },
      { name: 'Recovery manager', what: 'After a restart the coordinator replays its log and re-sends decisions; participants list in-doubt branches (`pg_prepared_xacts`, `XA RECOVER`) and wait for — or are manually forced to — an outcome.' },
      { name: 'Heuristic decisions', what: 'Operators can force a participant to commit or roll back unilaterally; if it disagrees with the coordinator, you get a **heuristic mixed** outcome (JTA `HeuristicMixedException`) — atomicity is gone and humans must reconcile.' },
    ],
    real: [
      { name: 'XA / JTA (Narayana, Atomikos, MSDTC)', how: 'Application-side transaction managers coordinate XA-capable resources via `xa_prepare`/`xa_commit`; the decision log lives on the app server’s disk, so that host’s failure blocks participants until it returns with its log.' },
      { name: 'Postgres / MySQL native', how: '`PREPARE TRANSACTION` / `COMMIT PREPARED` and `XA START … XA PREPARE … XA COMMIT` expose participant-side 2PC; the coordinator is your code or a TM. Older MySQL (before 5.7.7) rolled back prepared XA transactions when the client disconnected and did not binlog them safely.' },
      { name: 'Google Spanner', how: 'Each participant and the coordinator is a **Paxos group** (leader + replicas), so the decision log and prepare records are replicated; a single machine failure does not block. Commit timestamps come from TrueTime, with commit-wait covering the clock uncertainty.' },
      { name: 'CockroachDB parallel commits', how: 'The transaction record is replicated by Raft; writes leave **intents**. With parallel commits (since v19.2), the record is written in a `STAGING` state in parallel with the intent writes, and the transaction is implicitly committed once all succeed — cutting commit latency to roughly one consensus round.' },
      { name: 'Kafka transactions (KIP-98)', how: 'A transaction coordinator (a broker) logs state to `__transaction_state`, then writes commit/abort **markers** to every partition touched; `isolation.level=read_committed` consumers hide uncommitted data. Producer epochs fence zombie producers with the same `transactional.id`.' },
    ],
  },

  lifecycle: {
    summary: 'A classic 2PC across two databases in different availability zones, with locks held for the whole window.',
    stages: [
      { stage: 'Execute statements', what: 'App runs UPDATEs on DB-1 and DB-2 under one XID; row locks acquired.', cost: 'Normal statement latency', ms: 4, part: 'client' },
      { stage: 'Phase 1: send PREPARE', what: 'Coordinator sends prepare to all participants in parallel.', cost: '½ RTT cross-AZ', ms: 0.5, part: 'coordinator' },
      { stage: 'Participant prepare fsync', what: 'Each DB flushes changes + prepare record to WAL.', cost: 'fsync ~0.5–2 ms', ms: 1.5, part: 'participant' },
      { stage: 'Votes return', what: 'Slowest participant’s vote decides phase-1 latency.', cost: '½ RTT, max over participants', ms: 0.5, part: 'locks' },
      { stage: 'Coordinator log fsync', what: 'Durable COMMIT decision — the commit point.', cost: 'fsync', ms: 1.5, part: 'decision' },
      { stage: 'Phase 2: COMMIT', what: 'Broadcast decision; participants commit and release locks.', cost: '1 RTT + commit write', ms: 2, part: 'coordinator' },
      { stage: 'Forget', what: 'Coordinator lazily writes an end record after acks.', cost: 'Async', ms: 0.1, part: 'recovery' },
    ],
  },

  deepDives: [
    {
      title: 'Why 2PC blocks: the in-doubt window',
      hook: 'A YES vote is a promise that only the coordinator can release.',
      body: [
        'Once a participant votes YES it cannot abort (others may have been told to commit) and cannot commit (the coordinator may have decided abort because someone voted NO). If the coordinator crashes after collecting votes, every prepared participant waits **with locks held** until the coordinator recovers and reads its log. Timeouts do not help: a participant that times out still does not know the outcome.',
        'The blast radius grows over time: blocked rows block other transactions, connection pools fill, and in Postgres a forgotten prepared transaction holds back the xmin horizon, so `VACUUM` cannot clean dead tuples and, if left for very long, it can push the database toward transaction-id wraparound protection.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Coordinator dies at the worst moment',
        actors: ['Coordinator', 'DB-1', 'DB-2', 'Other tx'],
        messages: [
          { from: 'Coordinator', to: 'DB-1', label: 'PREPARE' },
          { from: 'Coordinator', to: 'DB-2', label: 'PREPARE' },
          { from: 'DB-1', to: 'Coordinator', label: 'YES', dashed: true },
          { from: 'DB-2', to: 'Coordinator', label: 'YES', dashed: true },
          { from: 'Coordinator', to: 'Coordinator', label: 'crash before decision', tone: 'bad' },
          { from: 'Other tx', to: 'DB-1', label: 'UPDATE same row → waits', tone: 'warn' },
          { from: 'Other tx', to: 'DB-2', label: 'UPDATE same row → waits', tone: 'warn' },
          { from: 'Coordinator', to: 'DB-1', label: 'recovered: COMMIT (minutes later)', tone: 'ok' },
        ],
      },
      code: {
        lang: 'sql',
        caption: 'Finding and resolving in-doubt transactions in Postgres',
        code: `-- alert if any prepared transaction is older than a minute
SELECT gid, prepared, owner, database,
       now() - prepared AS age
FROM pg_prepared_xacts
ORDER BY prepared;

-- only after confirming the coordinator's decision:
COMMIT PREPARED 'order-77-db1';
-- or
ROLLBACK PREPARED 'order-77-db1';`,
      },
      insight: 'The only real fix for blocking is to make the coordinator’s decision **highly available** — replicate it with Paxos/Raft (Gray & Lamport’s "Paxos Commit", Spanner). That is why production 2PC lives inside consensus-replicated databases, not across app servers.',
    },
    {
      title: 'Latency and availability arithmetic',
      hook: '2PC multiplies failure probabilities and holds locks for network round trips.',
      body: [
        'Critical path: 2 round trips (prepare, commit) plus at least 2 forced fsyncs (participant prepare, coordinator decision) and the participant commit write. Locks are held from the first statement until phase 2 reaches each participant, so lock hold time ≈ transaction time + 2 RTT + fsyncs. In-region that is a few ms; cross-region (RTT 50–150 ms) it is ≥ 100–300 ms per transaction on hot rows, capping throughput per hot row at a few transactions per second.',
        'Availability is the product: every participant must be up and vote YES. Five services at 99.9% give 0.999^5 ≈ 99.5% — about 44 hours of unavailability a year instead of 9 — before counting coordinator outages.',
      ],
      table: {
        columns: ['Setting', 'RTT', 'Added commit latency', 'Hot-row ceiling'],
        rows: [
          ['Same AZ', '~0.2 ms', '~3–5 ms (fsync-bound)', '~200–300 tx/s'],
          ['Cross-AZ', '~1 ms', '~5–8 ms', '~150 tx/s'],
          ['Cross-region', '50–150 ms', '100–300+ ms', '~3–10 tx/s'],
        ],
      },
      insight: 'The throughput limit is not CPU — it is lock hold time on contended rows. 2PC turns network latency into lock contention, which is why it collapses under load long before servers are busy.',
    },
    {
      title: 'Why it does not work across microservices',
      hook: 'Most participants cannot prepare, and the ones that can should not be coupled.',
      body: [
        'Participants must implement prepare: durably stage a change and hold it under lock until told otherwise. HTTP APIs, Stripe, email providers, SQS, most NoSQL stores and Kafka (which has its own transactions but no XA) cannot. A "2PC" that includes them is fake atomicity.',
        'Even when all services own XA-capable databases, 2PC couples them: one team’s slow deploy or DB failover blocks everyone’s locks; schemas and transaction managers become shared infrastructure; and the coordinator becomes a single point of failure for every business flow. That is exactly the coupling microservices were meant to remove.',
      ],
      diagram: {
        type: 'compare',
        title: '2PC vs saga across services',
        columns: [
          { name: '2PC / XA', tone: 'bad', points: ['Needs prepare everywhere', 'Locks across network', 'Blocks on coordinator loss', 'Availability = product'] },
          { name: 'Saga + outbox', tone: 'ok', points: ['Local commits only', 'Compensations, no locks', 'Each service independently up', 'No isolation: design for it'] },
        ],
      },
      insight: 'The real question is usually a boundary question: if two pieces of data need atomic commits all the time, they probably belong in one service and one database.',
    },
    {
      title: 'Where 2PC is right: inside one database system',
      hook: 'Spanner, CockroachDB and Kafka all use 2PC — over replicated participants they control.',
      body: [
        '**Spanner**: each shard (split) is a Paxos group. For a cross-group write, one group’s leader coordinates; prepare records and the commit decision are Paxos-replicated, so losing a machine does not block. TrueTime assigns commit timestamps and the coordinator **commit-waits** out the clock uncertainty (a few ms) for external consistency.',
        '**CockroachDB**: a replicated transaction record plus write intents; **parallel commits** write the record as `STAGING` concurrently with the intents, so a transaction commits in about one consensus round trip, and any reader that finds a staging record can determine the outcome by checking the intents. **Percolator/TiDB**: 2PC with a primary lock in the storage layer as the commit point.',
        '**Postgres `PREPARE TRANSACTION`** is right for building those systems (e.g. Citus uses it for multi-shard writes) with automated recovery. **Kafka transactions** make read-process-write atomic across partitions for stream processors (exactly-once within Kafka).',
      ],
      insight: 'What these have in common: every participant supports prepare natively, the coordinator’s state is replicated, recovery is automated, latency is controlled, and one team operates the whole thing. Remove any of these and you are back to classic blocking 2PC.',
    },
    {
      title: '3PC and why nobody ships it',
      hook: 'Adding a phase removes blocking only in a world without network partitions.',
      body: [
        'Three-phase commit (Skeen, 1981) inserts a **pre-commit** phase so that no participant is in doubt about whether others might have committed, letting survivors elect a new coordinator and finish. It assumes bounded message delays and no partitions; under a partition, two sides can each decide differently — violating atomicity. It also costs an extra round trip.',
        'Practice went another way: keep 2PC but make the coordinator a consensus group (Paxos Commit, Spanner, CockroachDB). Consensus already handles partitions correctly — it simply stops making progress on the minority side.',
      ],
      insight: 'If an interviewer asks "how would you fix 2PC blocking?", "use 3PC" is the SDE-2 answer; "replicate the coordinator and participant state with consensus, or avoid the distributed transaction" is the SDE-3 answer.',
    },
  ],

  scaling: {
    body: [
      'Classic 2PC does not scale out well: coordinator throughput is bounded by its log fsyncs, and every added participant raises latency (slowest vote) and lowers availability (product of uptimes). The recovery story requires the coordinator to come back with its log — a single point of failure unless replicated.',
      'Systems that scale distributed transactions avoid 2PC where possible (single-shard fast path: CockroachDB and Spanner commit single-range/single-group transactions without 2PC), batch commits, and replicate coordinator state. In application architecture the scalable alternative is to keep transactions inside one service’s database and coordinate across services asynchronously.',
    ],
    bullets: [
      'Design keys so most transactions touch one shard; cross-shard 2PC should be the exception.',
      'One-phase optimization: a transaction manager skips prepare when only one resource is enlisted.',
      'Read-only participants vote "read-only" and drop out of phase 2.',
      'Presumed abort avoids forced log writes for aborts.',
      'Monitor in-doubt counts and age; they are the canary for coordinator problems.',
    ],
  },

  failures: [
    { name: 'Coordinator crash after votes', symptom: 'Queries on certain rows hang; connection pools exhaust.', detect: '`pg_prepared_xacts` count/age > 0 for > 60 s; `XA RECOVER` non-empty; lock-wait time spikes.', mitigate: 'Restore coordinator with its log; replicated coordinators; runbook for manual resolution with decision verification.' },
    { name: 'Lock contention collapse', symptom: 'Throughput drops sharply as load rises; p99 commit latency jumps.', detect: 'Lock-wait time per transaction, commit latency p99 by participant count.', mitigate: 'Move to single-DB boundaries or sagas; reduce participants; never cross regions on hot rows.' },
    { name: 'Heuristic mixed outcome', symptom: 'One DB committed, another rolled back after manual intervention.', detect: '`HeuristicMixedException` / heuristic outcome logs in the TM; reconciliation mismatch.', mitigate: 'Never force decisions without checking the coordinator log; reconcile and repair data.' },
    { name: 'Orphaned prepared transactions block vacuum', symptom: 'Table bloat, rising `age(datfrozenxid)`, eventually wraparound warnings.', detect: 'Oldest prepared xact age; xmin horizon age alerts.', mitigate: 'Alert and resolve; set `max_prepared_transactions = 0` where 2PC is not used.' },
    { name: 'Non-XA participant in the "transaction"', symptom: 'Email sent / API called even though the transaction aborted.', detect: 'Reconciliation of external side effects vs committed state.', mitigate: 'Outbox pattern: emit side effects only after commit, idempotently.' },
  ],

  warStories: [
    { title: 'The prepared transaction nobody remembered', source: 'Composite of common incidents', what: 'A migration script used `PREPARE TRANSACTION` for testing and crashed before `COMMIT PREPARED`. The prepared transaction survived restarts, held the xmin horizon for weeks, and autovacuum could not reclaim dead rows; the main table bloated many-fold before someone checked `pg_prepared_xacts`.', lesson: 'Keep `max_prepared_transactions = 0` unless you run 2PC, and alert on prepared-transaction age wherever you do.' },
    { title: 'XA across services during a DB failover', source: 'Composite of common incidents', what: 'An order platform used JTA/XA across the order DB, the payment DB and a JMS broker. During a routine failover of the payment DB, prepared branches were in doubt; the app server’s TM kept retrying, order-table locks were held, and checkout stalled for all customers — not just payment.', lesson: 'Distributed transactions couple the availability of every participant; replace with local transactions + outbox + saga.' },
  ],

  numbers: [
    { label: 'Critical path', value: '2 RTT + ≥2 forced fsyncs', note: 'plus participant commit write' },
    { label: 'Cross-region lock hold', value: '≥ 100–300 ms', note: 'RTT 50–150 ms' },
    { label: 'Availability of 5 participants at 99.9%', value: '≈ 99.5%', note: '0.999^5' },
    { label: 'Postgres `max_prepared_transactions` default', value: '0', note: '2PC disabled by default' },
    { label: 'CockroachDB parallel commits', value: '~1 consensus round', note: 'vs 2 sequential rounds' },
    { label: 'Spanner commit wait', value: '≈ TrueTime uncertainty (ms)', note: 'paper: ε typically 1–7 ms' },
  ],

  capacity: {
    question: 'A team proposes XA across an EU and a US database for 500 transfers/s, 5% of which hit 20 "hot" accounts. Is it viable?',
    steps: [
      'Cross-region RTT ≈ 90 ms; 2PC adds ≥ 2 RTT ≈ 180 ms plus fsyncs ⇒ locks held ≈ 200 ms per transaction.',
      'Hot accounts: 500 × 5% = 25 tx/s spread over 20 accounts ≈ 1.25 tx/s each — but bursts and skew concentrate them.',
      'Per-row ceiling ≈ 1 / 0.2 s = 5 tx/s; any account above that queues without bound.',
      'Availability: two DBs + coordinator at 99.95% each ≈ 99.85% ⇒ ~13 h/year of failed transfers, plus in-doubt blocking on failovers.',
    ],
    answer: 'Marginal at best and fragile under skew; a coordinator failover blocks hot accounts entirely. Prefer a single home region per account (single-DB transaction) and an async, idempotent transfer saga between regions — or a distributed SQL database with replicated 2PC if global atomicity is a hard requirement.',
  },

  comparison: {
    caption: 'Atomic commit options',
    columns: ['Option', 'Atomicity', 'Blocking risk', 'Latency', 'Use when'],
    rows: [
      ['Classic 2PC / XA', 'Yes (if all can prepare)', 'High: coordinator SPOF', '2 RTT + fsyncs, locks held', 'Legacy monolith with 2 XA resources'],
      ['2PC over consensus (Spanner, CockroachDB)', 'Yes', 'Low: replicated coordinator', '1–2 consensus rounds', 'Cross-shard transactions in one DB'],
      ['Kafka transactions', 'Within Kafka', 'Low (coordinator is a broker)', 'Commit markers per partition', 'Exactly-once stream processing'],
      ['Saga + outbox', 'Eventual, via compensation', 'None (no cross-service locks)', 'Async', 'Across microservices / third parties'],
      ['Single-DB boundary', 'Yes (local ACID)', 'None', 'One commit', 'Data that must change together'],
    ],
  },

  whenNot: [
    'Across microservices or third-party APIs — use a saga with outbox and idempotency keys.',
    'Across regions on contended rows — lock hold time destroys throughput; home each entity in one region.',
    'Between a database and a message broker — use the transactional outbox (or Kafka transactions if both sides are Kafka).',
    'When data must always change together — redraw the boundary so it lives in one database.',
  ],

  interview: [
    {
      q: 'Explain 2PC and why it is called a blocking protocol.',
      a: 'Phase 1: the coordinator asks participants to prepare; each durably logs its changes and a prepare record, keeps locks and votes. Phase 2: if all voted YES the coordinator durably logs COMMIT and broadcasts it; otherwise ABORT. After voting YES a participant cannot decide alone, so if the coordinator fails after collecting votes, participants stay in doubt with locks held until it recovers. Timeouts cannot resolve this safely.',
      followUps: ['What exactly is the commit point?', 'What is presumed abort?', 'How do you resolve in-doubt transactions manually, and what can go wrong?'],
      seniorSignal: 'Identifies the coordinator’s durable log record as the commit point and the heuristic-outcome risk of manual resolution.',
    },
    {
      q: 'Spanner uses 2PC. Why is it acceptable there but not across your microservices?',
      a: 'In Spanner each participant and the coordinator is a Paxos group, so the decision and prepare state are replicated and survive machine failures; all participants support prepare, latency is controlled, and recovery is automated by one system. Microservices are independently deployed and operated, often include participants that cannot prepare, and 2PC would couple their locks and availability. So across services use sagas; inside a database, replicated 2PC is fine.',
      followUps: ['What role does TrueTime play?', 'How does CockroachDB reduce 2PC latency?', 'Would 3PC fix the microservice case?'],
      seniorSignal: 'Names replicated coordinator state as the key difference, not just "Google has good networks".',
    },
    {
      q: 'Your colleague proposes XA between the orders DB and Kafka. What do you say?',
      a: 'Kafka does not support XA, and even if it did, coupling DB commits to broker availability hurts both. Use a transactional outbox: write the event in the same local transaction as the order, then relay it to Kafka with CDC or a poller, at least once; consumers dedupe. If the flow is Kafka-in, Kafka-out, use Kafka transactions instead.',
      followUps: ['What ordering does the outbox give you?', 'Poller vs Debezium?', 'Where do Kafka transactions stop guaranteeing exactly-once?'],
      seniorSignal: 'Offers outbox and Kafka transactions as precise replacements and scopes their guarantees.',
    },
    {
      q: 'Why doesn’t 3PC solve the blocking problem in practice?',
      a: '3PC adds a pre-commit phase so survivors can always finish without the coordinator, but it assumes synchronous networks with bounded delays and no partitions. Under a partition, the two sides can reach different decisions, breaking atomicity, and it adds a round trip. Real systems instead replicate coordinator and participant state with consensus, which tolerates partitions by stalling the minority.',
      followUps: ['What is Paxos Commit?', 'What does the minority side see?', 'How does this relate to FLP?'],
      seniorSignal: 'Explains the partition failure and points to consensus-replicated 2PC.',
    },
    {
      q: 'Estimate the cost of 2PC for a cross-region transaction on a hot row.',
      a: 'Two round trips at ~90 ms plus fsyncs keep locks for roughly 200 ms, so a single hot row supports about 5 transactions per second before queueing. Availability is the product of participants and coordinator. I would avoid it by homing the entity in one region and coordinating across regions asynchronously.',
      followUps: ['How do Spanner or CockroachDB fare here?', 'What about read-only participants?', 'How would you migrate off it?'],
      seniorSignal: 'Converts latency into lock-hold time and per-row throughput, which is the real limit.',
    },
  ],

  takeaways: [
    '2PC: prepare (durable promise, locks held), then the coordinator’s logged decision; the log record is the commit point.',
    'It blocks: in-doubt participants hold locks until the coordinator returns.',
    'Cost: 2 RTT + forced fsyncs on the lock-holding path; availability is the product of participants.',
    'It does not fit microservices: most participants cannot prepare and it couples everyone’s availability.',
    '3PC is not the fix; consensus-replicated coordinators are (Spanner, CockroachDB).',
    'Right uses: inside one database system, Postgres `PREPARE TRANSACTION` for sharding layers, Kafka transactions.',
    'Across services: saga + outbox + idempotency, or redraw the boundary into one database.',
  ],
};

export default deep;
