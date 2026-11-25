import type { Pattern } from '../../types';
import { E, N, W, X, req } from './dsl';

export const exactlyOnce: Pattern = {
  id: 'exactly-once',
  num: 7,
  title: 'Exactly-once streaming',
  group: 'Streaming',
  tagline: 'Retries and restarts are guaranteed. Make every record count once anyway, using checkpoints plus a transactional or idempotent sink.',
  minutes: 12,
  level: 'Intermediate',
  signals: ['"money" / "billing" / "balances": double counting costs real dollars', '"real-time" plus "accurate"', 'consumers restart, rebalance or replay', '"we see duplicates after deploys"'],
  learn: [
    'Why at-least-once delivery plus a naive sink double-counts',
    'How Flink checkpoints (barriers) snapshot offsets and state together',
    'Transactional (2PC) vs idempotent (upsert) sinks',
    'What exactly-once really guarantees, and what it doesn’t',
  ],
  realWorld: [
    { who: 'Uber', how: 'Flink jobs compute driver earnings and surge pricing from Kafka with checkpointed state.' },
    { who: 'Stripe', how: 'Idempotency keys on every write make retries harmless end to end.' },
    { who: 'Alibaba', how: 'Flink with exactly-once state powers Singles’ Day real-time GMV dashboards at millions of events/s.' },
  ],
  scenario: {
    id: 'eo-merchant-revenue',
    title: 'Real-time merchant revenue',
    context:
      'A payments company shows every merchant their revenue today, live, in the merchant app. 40,000 payment events/s at peak. Producers retry on timeouts, consumers restart during deploys, and the numbers are money: a duplicate is a support ticket and a refund dispute.',
    workload: { eps: 40000, unit: 'payment', dup: 0.01 },
    requirements: [
      req.exactlyOnce('Duplicates arrive (producer retries) and restarts re-read data. Deduplicate in a stateful processor, or write idempotently.'),
      req.noLoss(),
      req.fresh(10, 'Merchants expect seconds, not an hourly batch.'),
      req.throughput(40000, 'payments'),
      req.chaos('crash', 'A processor crash mid-write leaves totals correct', 'Restarts must resume from a consistent checkpoint, and the sink must not apply a write twice.'),
      req.survives('flink', 'Losing one processor instance loses nothing', 'Run more than one instance so partitions rebalance onto the survivors.'),
    ],
    palette: ['events', 'kafka', 'mem-buffer', 'flink', 'spark', 'append-sink', 'proc-time', 'kv', 'warehouse', 'app-api', 'airflow'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 120, 'Payment service emits a `payment_captured` event with a unique `payment_id`.'),
        N('kafka', 'kafka', X[1], 120, 'Durable, replicated log (3 brokers, RF=3, acks=all). Producers use idempotence, so broker-side retries don’t duplicate.', { count: 3 }),
        N('flink', 'flink', X[2], 120, 'Keyed by merchant. Keeps a dedup set of recent `payment_id`s in state and sums revenue. Checkpoints offsets and state together every few seconds.', { count: 3 }),
        N('kv', 'kv', X[3], 120, 'Serving table: `merchant_id → revenue_today`. Writes are upserts, so re-applying the same result is harmless (idempotent sink).'),
        N('api', 'app-api', X[4], 120, 'Merchant app reads its total by key in milliseconds.'),
      ],
      edges: [
        E('events', 'kafka', 'Produce with acks=all and enable.idempotence=true.'),
        E('kafka', 'flink', 'Flink owns the offsets: they live in its checkpoints, not in Kafka’s committed offsets.'),
        E('flink', 'kv', 'Upsert by merchant_id. A replay after restart overwrites with the same value.'),
        E('kv', 'api'),
      ],
    },
    wrong: {
      'append-sink': W.appendSink,
      'mem-buffer': W.memBuffer,
      'proc-time': W.procTime,
      spark: {
        why: 'A Spark batch job every hour can’t meet a 10-second freshness target, and an hourly run still has to deal with the same retries.',
        instead: 'A stateful stream processor (Flink / Spark Structured Streaming).',
      },
    },
    alt: {
      warehouse: 'You could also land the stream in a warehouse for finance reconciliation. It doesn’t serve millisecond lookups, but it is the place to double-check totals daily.',
    },
  },
  extras: {
    nodes: [N('naive', 'append-sink', X[2], 240, 'The naive consumer: read a message, INSERT a row, commit the offset afterwards.')],
    edges: [E('kafka', 'naive'), E('naive', 'kv')],
  },
  guided: [
    {
      title: 'The naive consumer double-counts',
      tag: 'problem',
      body: [
        'Payments land in Kafka. A small consumer reads each message, does `INSERT` (or `+= amount`) and commits the offset afterwards.',
        'If it crashes **after the write but before the offset commit**, it re-reads those messages on restart and adds them again. Producer retries add more duplicates on top.',
      ],
      add: ['events', 'kafka', 'naive', 'kv', 'api'],
      chaos: 'replay',
      predict: {
        question: 'A deploy restarts the consumer and it re-reads the last 30 seconds. What happens to merchant totals?',
        options: ['Nothing, Kafka guarantees exactly-once', 'Totals are inflated by the replayed payments', 'Totals go down', 'The consumer refuses to start'],
        answer: 1,
        explain: 'Kafka gives you at-least-once delivery to consumers by default. Without dedup or an idempotent write, every re-read message is applied again.',
      },
    },
    {
      title: 'Checkpoint offsets and state together',
      tag: 'technique',
      body: [
        'Replace the consumer with **Flink**. The JobManager periodically injects a **checkpoint barrier** into every input partition. When an operator has seen the barrier on all inputs, it snapshots its state (the running totals and a set of recently seen `payment_id`s) to durable storage. The source snapshots its Kafka offsets at the same instant.',
        'On a crash, Flink rewinds **both** offsets and state to the last completed checkpoint. Records after it are re-read, but against state that hasn’t counted them yet.',
      ],
      add: ['flink'],
      remove: ['naive'],
      chaos: 'crash',
      keyIdea: 'Exactly-once is not “each record delivered once”. It is “each record’s effect applied once”, which comes from consistent snapshots of offsets plus state.',
      goodToKnow: 'This is the Chandy–Lamport distributed snapshot algorithm. Barriers flow with the data, so no global pause is needed.',
    },
    {
      title: 'The sink is the hard part',
      tag: 'tradeoff',
      body: [
        'State inside Flink is now exactly-once, but the **output** can still be written twice when the job replays from a checkpoint. Two fixes:',
        '**Idempotent sink:** upsert by key (`merchant_id`), so re-writing the same value is harmless. This is simple, fast and visible immediately. It needs a deterministic key and result.',
        '**Transactional sink (two-phase commit):** write inside a transaction and commit only when the checkpoint completes (Kafka transactions, Iceberg/Delta commits). Readers set to `read_committed` see output only after each checkpoint, so latency ≈ the checkpoint interval.',
      ],
      keyIdea: 'End-to-end exactly-once = replayable source + checkpointed processor + transactional or idempotent sink. Remove any one of the three and you are back to at-least-once.',
    },
    {
      title: 'A processor instance dies',
      tag: 'failure',
      body: ['Kill one of the three Flink TaskManagers mid-stream.'],
      kill: ['flink'],
      predict: {
        question: 'One of three Flink instances dies during peak. What do merchants see?',
        options: ['Lost payments', 'Duplicated revenue', 'A short delay, then correct totals', 'Nothing at all'],
        answer: 2,
        explain: 'Flink restarts the job from the last checkpoint (a few seconds old) on the surviving slots. Kafka still holds the records, so they are re-read and applied once. The cost is a few seconds of freshness.',
      },
      goodToKnow: 'Checkpoint interval is the knob: shorter means faster recovery and lower sink latency, but more snapshot overhead. Typical values are 10 s to 1 min. Use incremental RocksDB checkpoints for big state.',
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        'Replayable log (Kafka, RF=3, idempotent producer), then a checkpointed stateful processor (Flink, keyed dedup), then an idempotent or transactional sink.',
        'Exactly-once covers the pipeline’s **effects**. It doesn’t stop a client from emitting the same business event twice with different ids, so carry a real business key (`payment_id`) and deduplicate on it.',
      ],
    },
  ],
  quiz: [
    {
      id: 'eo-q1',
      q: 'A Kafka consumer writes to Postgres with plain INSERTs, then commits offsets. What delivery guarantee does the pipeline have?',
      options: ['Exactly-once', 'At-least-once', 'At-most-once', 'It depends on the partition count'],
      answer: 1,
      why: 'A crash between the INSERT and the offset commit replays those records: duplicates, never loss. Commit offsets before writing and you get at-most-once instead.',
    },
    {
      id: 'eo-q2',
      q: 'Why does a transactional sink add latency?',
      options: ['Transactions are slow to write', 'Output becomes visible only when the checkpoint that covers it completes', 'It disables parallelism', 'It requires a second Kafka cluster'],
      answer: 1,
      why: 'Two-phase commit: pre-commit on the checkpoint barrier, commit when the checkpoint is acknowledged. read_committed readers wait for it.',
    },
    {
      id: 'eo-q3',
      q: 'Which sink makes replays harmless without transactions?',
      options: ['Append-only log table', 'Upsert keyed by a deterministic id', 'CSV files', 'A bigger batch size'],
      answer: 1,
      why: 'An idempotent write produces the same end state no matter how many times it is applied.',
    },
  ],
  challenge: {
    id: 'eo-ad-budget',
    title: 'Ad budget pacing',
    context:
      'An ad platform must stop serving an advertiser’s ads the moment their daily budget is spent. 60,000 billable impressions/s at peak. Over-counting stops campaigns early (lost revenue). Under-counting overspends the customer’s budget (refunds). The ad server reads each campaign’s spend by key on every auction.',
    workload: { eps: 60000, unit: 'impression', dup: 0.02 },
    requirements: [
      req.exactlyOnce(),
      req.noLoss(),
      req.fresh(60, 'Spend must be visible to the ad server within a minute.'),
      req.throughput(60000, 'impressions'),
      req.chaos('replay', 'A producer re-sending an hour of impressions doesn’t change spend', 'Deduplicate by impression_id in the processor, or upsert into the serving store.'),
      req.survives('spark-ss', 'Losing one processor instance loses nothing', 'Run several executors so the survivors take over partitions.'),
    ],
    palette: ['events', 'kafka', 'mem-buffer', 'spark-ss', 'flink', 'cron-script', 'append-sink', 'proc-time', 'kv', 'olap', 'app-api'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 120, 'Ad servers emit an impression event with a unique `impression_id`.'),
        N('kafka', 'kafka', X[1], 120, 'Replicated log: 3 brokers, RF=3, acks=all.', { count: 3 }),
        N('sss', 'spark-ss', X[2], 120, 'Structured Streaming micro-batches every ~30 s: `dropDuplicates(impression_id)` with a watermark, sum by campaign. Offsets and state go in the checkpoint directory.', { count: 5 }),
        N('kv', 'kv', X[3], 120, '`campaign_id → spend_today`, upserted every micro-batch (idempotent).'),
        N('api', 'app-api', X[4], 120, 'The ad server checks remaining budget on every auction.'),
      ],
      edges: [E('events', 'kafka'), E('kafka', 'sss'), E('sss', 'kv', 'foreachBatch upsert keyed by campaign: replaying a micro-batch rewrites the same values.'), E('kv', 'api')],
    },
    wrong: {
      'append-sink': W.appendSink,
      'mem-buffer': W.memBuffer,
      'proc-time': W.procTime,
      'cron-script': W.cronScript,
    },
    alt: {
      flink: 'Flink would work too, with sub-second latency and per-record processing. Structured Streaming’s ~30 s micro-batches already meet the 1-minute target, and the team runs Spark elsewhere.',
      olap: 'An OLAP store could also serve spend, but the ad server needs single-key lookups at very high QPS. A key-value store is the simpler, cheaper fit.',
    },
  },
  deeper: [{ label: 'Kafka delivery semantics, producers & consumer groups', to: '/kafka' }],
};


export const lateData: Pattern = {
  id: 'late-data',
  num: 8,
  title: 'Late data, event time & watermarks',
  group: 'Streaming',
  tagline: 'Events arrive late and out of order. Window by when things happened, not when they arrived, and decide explicitly how long to wait.',
  minutes: 14,
  level: 'Intermediate',
  signals: [
    '"mobile" / "offline mode" / "IoT": devices buffer events and upload them later',
    '"per day" / "per hour" numbers that must match a later recompute',
    '"the numbers change when we replay" or "yesterday’s total keeps drifting"',
    'events cross time zones, regions or flaky networks before they reach you',
  ],
  learn: [
    'Event time vs processing time, and why arrival order lies',
    'How a watermark estimates “everything up to T has arrived”',
    'Allowed lateness, re-fired windows and why they need an upsert sink',
    'Tumbling, sliding and session windows: which question each one answers',
    'Side outputs for very late events, and how to reconcile them',
  ],
  realWorld: [
    { who: 'Google', how: 'The Dataflow Model paper (2015, built on MillWheel and FlumeJava) defined watermarks, triggers and accumulation modes. Apache Beam and Cloud Dataflow implement it.' },
    { who: 'Spotify', how: 'Runs Beam pipelines on Dataflow through its Scio library. Plays from offline devices sync later and must count toward the hour and day they actually happened.' },
    { who: 'Uber', how: 'Mobile apps on flaky networks send trip and app events late. Uber’s Flink SQL platform (AthenaX) windows these streams by event time.' },
  ],
  scenario: {
    id: 'ld-learning-streaks',
    title: 'Daily learning streaks',
    context:
      'A language-learning app shows every learner a daily streak: did they finish a lesson today, in their own time zone? Many learners study offline on subways and planes. The app queues lesson events and uploads them when the phone reconnects, sometimes hours later. 30,000 events/s at peak. If a 23:50 lesson that syncs at 00:20 counts for the next day, a 400-day streak breaks and support gets an angry email. Product also wants a live “lessons per hour by country” dashboard.',
    workload: { eps: 30000, unit: 'lesson event', late: 0.12, queryQps: 500 },
    requirements: [
      req.lateData('Bucket each event by its own timestamp (event time) with a watermark and allowed lateness, not by when it reached the server.'),
      req.chaos('late', 'A burst of events synced hours late lands on the right day', 'Processing-time windows have already closed when late events arrive. Use event-time windows with allowed lateness and an upsert sink.'),
      req.fresh(60, 'Learners expect the streak flame to light up within a minute of finishing a lesson.'),
      req.throughput(30000, 'events'),
      req.noLoss(),
      req.survives('flink', 'Losing one processor instance loses no window state', 'Run several instances: open windows are restored from the last checkpoint on the survivors.'),
    ],
    palette: ['events', 'mem-buffer', 'kafka', 'proc-time', 'flink', 'spark-ss', 'cron-script', 'kv', 'olap', 'lakehouse', 'app-api', 'bi'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 160, 'The app stamps every event with `event_time` (device clock, corrected by the server’s clock offset at sync) and the user’s time-zone offset, and queues events while offline.'),
        N('kafka', 'kafka', X[1], 160, 'Durable buffer for sync storms (3 brokers, RF=3). Keyed by `user_id`, so one learner’s events stay in order within a partition.', { count: 3 }),
        N('flink', 'flink', X[2], 160, 'Event-time processing. Watermark = max event time − 10 min, allowed lateness 2 days. Keys streaks by (`user_id`, local date) and uses 1-hour tumbling windows for the dashboard. Anything later goes to a side output.', { count: 3 }),
        N('kv', 'kv', X[3], 80, '`user_id → {last_active_local_date, streak}`. Flink upserts, so a re-fired window simply overwrites the earlier answer.'),
        N('olap', 'olap', X[3], 260, 'Lessons per hour by country, upserted by (`window_start`, `country`) so late updates replace the earlier count.', { count: 2 }),
        N('api', 'app-api', X[4], 80, 'The app reads the learner’s streak by key in milliseconds.'),
        N('bi', 'bi', X[4], 260, 'Live dashboard of lessons per hour by country.'),
      ],
      edges: [
        E('events', 'kafka', 'Upload queued events in batches; each keeps its original event_time.'),
        E('kafka', 'flink', 'Watermarks are generated per Kafka partition, and the operator’s watermark is the minimum across partitions.'),
        E('flink', 'kv', 'Upsert per (user, local date): the on-time firing writes the streak, late firings overwrite it.'),
        E('flink', 'olap', 'Hourly counts per country, re-emitted when late events update a window.'),
        E('kv', 'api'),
        E('olap', 'bi'),
      ],
    },
    wrong: {
      'proc-time': W.procTime,
      'mem-buffer': W.memBuffer,
      'cron-script': {
        why: 'A nightly script that counts yesterday’s partition once never sees the phones that sync tomorrow, and streaks would update only once a day. Re-running it to catch the late rows appends duplicates.',
        instead: 'Event-time streaming with allowed lateness, or an orchestrated batch job that recomputes a lookback window (the last 3 days) with MERGE.',
      },
    },
    alt: {
      'spark-ss': 'Structured Streaming with `withWatermark("event_time", "2 days")` also works and meets the 1-minute target with ~30 s micro-batches. It has no side output: rows behind the watermark are silently dropped, so watch `numRowsDroppedByWatermark`.',
      lakehouse: 'Also landing raw events in a lakehouse table partitioned by event date gives you full history to recompute from, and a home for very late events. Add compaction if a stream writes into it.',
    },
  },
  extras: {
    nodes: [N('pt', 'proc-time', X[2], 160, 'The naive job: daily and hourly windows by server arrival time (`TUMBLE(PROCTIME(), …)`).', { count: 2 })],
    edges: [E('kafka', 'pt'), E('pt', 'kv'), E('pt', 'olap')],
  },
  guided: [
    {
      title: 'The naive job counts arrival time',
      tag: 'problem',
      body: [
        'Lesson events land in Kafka. A streaming job groups them into daily and hourly windows by **arrival time** on the server (processing time). It is simple, low-latency, and matches what you see in the logs.',
        'Then a learner on the 23:40 train finishes a lesson at 23:50, the phone reconnects at 00:20, and the event lands in **tomorrow’s** window. Today shows no lesson, so the streak resets to zero.',
      ],
      add: ['events', 'kafka', 'pt', 'kv', 'olap', 'api', 'bi'],
      chaos: 'late',
      predict: {
        question: 'Right after midnight, a region’s phones sync 2 hours of offline lessons. What happens to yesterday’s streaks and hourly counts?',
        options: ['Nothing: Kafka keeps events in order', 'Yesterday is undercounted and today overcounted, and nothing errors', 'The job crashes on out-of-order timestamps', 'The late events are dropped and logged'],
        answer: 1,
        explain: 'Processing-time windows only look at the wall clock when an event arrives. Late events are silently counted in the wrong window: streaks break, and replaying the same data tomorrow would give different numbers again.',
      },
    },
    {
      title: 'Two clocks: event time and processing time',
      tag: 'technique',
      body: [
        '**Event time** is when it happened (stamped on the device). **Processing time** is when your operator sees it. The gap is near zero for a server app and hours for an offline phone, and it changes constantly: deploys, backlogs and replays all stretch it.',
        'Processing-time windows answer “what arrived between 10:00 and 11:00?”, which is a question about your pipeline, not about your users. Event-time windows answer the business question and give the **same answer on every replay**: the result is deterministic.',
        'The price: you no longer know when a window is complete. An event for 10:59 could still be sitting in someone’s pocket. You need a rule for when to emit, and a rule for stragglers.',
      ],
      keyIdea: 'Bucket by event time for correctness and reproducibility. Processing time tells you about your pipeline, not about the world.',
      goodToKnow: 'Device clocks lie. Record the server receive time and the client clock at sync, and correct event_time by the offset. Kafka’s record timestamp (CreateTime) is set by whoever produces, here the upload service, so it is upload time, not lesson time.',
    },
    {
      title: 'Event-time windows with a watermark',
      tag: 'technique',
      body: [
        'Replace the job with **Flink** in event-time mode. Each source partition tracks the largest event time it has seen and emits a **watermark** = max − 10 min, a claim that “events older than this should not arrive any more”. An operator’s watermark is the **minimum** over its input partitions.',
        'The window [10:00, 11:00) fires when the watermark passes 11:00. Events from slightly out-of-order phones (within 10 minutes) are already inside, and nothing is misattributed: a 23:50 lesson goes to yesterday, whenever it arrives.',
      ],
      add: ['flink'],
      remove: ['pt'],
      chaos: 'late',
      predict: {
        question: 'With watermark = max event time − 10 min, when does the 10:00–11:00 window first fire?',
        options: ['At 11:00 server time', 'Once every input partition has seen an event with event time ≥ 11:10', 'After 10 minutes with no new events', 'At midnight'],
        answer: 1,
        explain: 'Watermarks advance with event time, not the wall clock. When every partition has seen 11:10 or later, the minimum watermark passes 11:00 and the window fires. One idle partition holds everything back, which is why Flink has `withIdleness()`.',
      },
      keyIdea: 'A watermark is a heuristic, not a guarantee. A longer delay buys completeness and costs latency.',
    },
    {
      title: 'Allowed lateness: update instead of drop',
      tag: 'tradeoff',
      body: [
        'Most late events are minutes late; offline phones can be days late. Waiting 2 days before emitting anything would make the streak useless.',
        'So emit **early, then update**. Fire the window when the watermark passes (fast, maybe incomplete), keep its state for an **allowed lateness** of 2 days, and re-fire it whenever a late event arrives. Downstream receives a **new version of the same row**, so the sink must upsert by (user, date) or (window, country). An append sink would count the window twice.',
        'The cost is state: every window stays in RocksDB for 2 more days. For 50M daily learners that is on the order of 100M small (user, date) entries. That is fine for RocksDB on local disk, and a problem for heap state.',
      ],
      keyIdea: 'Watermark delay controls latency. Allowed lateness controls how long you keep state to fix results. Late firings need an idempotent (upsert) sink.',
      goodToKnow: 'Beam calls this triggers plus accumulation mode: early, on-time and late firings, each either accumulating (the full new total) or discarding (just the delta). Accumulating results pair naturally with upserts.',
    },
    {
      title: 'Pick the window that matches the question',
      tag: 'technique',
      body: [
        '**Tumbling** windows (fixed, non-overlapping, e.g. every hour) answer “lessons per hour”. Each event belongs to exactly one window.',
        '**Sliding (hopping)** windows (size 1 h, sliding every 5 min) answer “lessons in the last hour, refreshed every 5 minutes”. Each event lands in size/slide = 12 windows, so state and output are about 12× larger.',
        '**Session** windows close after a gap of inactivity (say 30 min) and have a different length per key: “how long was this study session?”. A late event can **merge** two sessions into one, so the sink must be able to replace the old rows.',
        'A daily streak in the learner’s own time zone is not a global UTC window at all. Key by (`user_id`, `local_date`), where local_date comes from the event’s own timestamp and offset.',
      ],
      goodToKnow: 'Flink day windows align to UTC midnight (with one optional offset for the whole window assigner), so per-user time zones need the local-date key, not a window offset.',
    },
    {
      title: 'Too late: side outputs and reconciliation',
      tag: 'technique',
      body: [
        'A phone back from a 5-day trek sends events beyond the 2-day allowed lateness. Their window state is gone. Spark drops such rows silently; Flink lets you route them to a **side output** (`sideOutputLateData(tag)`).',
        'Write the side output to a “late events” table or topic and chart its volume. A daily batch job can recompute the affected days with MERGE, or product can decide that streaks older than 2 days are frozen. Either is fine, as long as it is an explicit business decision.',
        'Alert on the late-event rate. If it jumps from 0.1% to 5%, a client release probably broke timestamps, or a partition is lagging.',
      ],
      keyIdea: 'Every late-data design has three tiers: on time (inside the watermark), late (allowed lateness, re-fire), and too late (side output, then reconcile or ignore on purpose).',
    },
    {
      title: 'Sync storm',
      tag: 'failure',
      body: [
        'A country’s mobile network comes back after an outage, and millions of phones sync at once: 3× normal traffic, most of it hours late.',
        'Kafka holds the burst while Flink works through it. Because windows use event time, the backlog produces the same numbers it would have produced on time.',
      ],
      traffic: 3,
      predict: {
        question: 'Traffic triples for 20 minutes, mostly late events. What happens?',
        options: ['Flink drops the overflow', 'Kafka buffers the burst; Flink lags, catches up, and re-fires late windows with correct totals', 'The watermark jumps forward and every late event is lost', 'Each streak is counted twice'],
        answer: 1,
        explain: 'The log absorbs the burst durably and Flink processes the backlog as fast as its parallelism allows. Event-time results don’t depend on when processing happens, so they are delayed, not wrong. Size parallelism for catch-up speed, not just for steady state.',
      },
    },
    {
      title: 'A processor instance dies',
      tag: 'failure',
      body: ['Kill one of the three Flink instances while thousands of windows are open.'],
      kill: ['flink'],
      goodToKnow: 'Window contents, timers and watermarks all live in checkpointed state. Windows that fired after the last checkpoint fire again after the restore, and the upsert sink makes that harmless.',
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        'Stamp event time at the source, buffer in a durable log, window by event time with a watermark (latency) and allowed lateness (completeness), write to an upsert sink, and send the too-late tail to a side output you monitor.',
        'In an interview, say the numbers out loud: “watermark 10 minutes, allowed lateness 2 days, side output beyond that, reconciled nightly”. That shows you made the latency vs completeness tradeoff on purpose.',
      ],
    },
  ],
  quiz: [
    {
      id: 'ld-q1',
      q: 'An event happened at 23:58 and arrives at 00:04. With processing-time daily windows, which day counts it?',
      options: ['The day it happened', 'The next day', 'Both days', 'Neither'],
      answer: 1,
      why: 'Processing-time windows assign events by arrival time, so it lands in the next day. Event-time windows would put it in the day it happened.',
    },
    {
      id: 'ld-q2',
      q: 'What does a watermark of 10:50 assert?',
      options: ['Events with event time ≤ 10:50 have (probably) all arrived', 'The server clock reads 10:50', 'Events after 10:50 are dropped', 'The window closes at 10:50 processing time'],
      answer: 0,
      why: 'A watermark is the system’s estimate of event-time progress. Windows ending at or before it can fire; later arrivals for them are “late”.',
    },
    {
      id: 'ld-q3',
      q: 'You set allowed lateness to 2 days. What must the sink support?',
      options: ['Append-only inserts', 'Replacing a previously emitted window result (upsert by window key)', 'Exactly one write per window', 'Transactions across tables'],
      answer: 1,
      why: 'Late events re-fire the window with an updated result. Appending it would double-count; upserting by the window key replaces the old answer.',
    },
    {
      id: 'ld-q4',
      q: 'Which window answers “how long did each study session last”?',
      options: ['Tumbling, 1 hour', 'Sliding, 1 hour every 5 minutes', 'Session window with a 30-minute gap', 'One global window'],
      answer: 2,
      why: 'Session windows are per key and end after a period of inactivity, so their length varies with the user’s behaviour.',
    },
    {
      id: 'ld-q5',
      q: 'One Kafka partition stops receiving events (a quiet region at night). What happens to event-time windows downstream?',
      options: ['Nothing', 'The watermark stalls at that partition’s last event time, so windows stop firing until it is marked idle', 'Flink drops that partition', 'Windows fire early'],
      answer: 1,
      why: 'The operator watermark is the minimum over its inputs. An idle input pins it; `withIdleness()` excludes idle partitions from the minimum.',
    },
  ],
  challenge: {
    id: 'ld-cold-chain',
    title: 'Cold-chain temperature compliance',
    context:
      'A logistics company tracks 200,000 refrigerated trucks. Each sensor reports a temperature every 4 seconds: 50,000 readings/s. In tunnels and rural areas the gateway buffers readings on flash and uploads them minutes or hours later. Food-safety rules require a 5-minute average per truck, and an excursion report whenever a 5-minute window averages above 8 °C. Shippers watch their shipments in a portal; auditors pull reports.',
    workload: { eps: 50000, unit: 'reading', late: 0.2, queryQps: 200 },
    requirements: [
      req.lateData('Each 5-minute average must use the readings taken in that window, wherever and whenever they upload.'),
      req.chaos('late', 'A gateway uploading 2 hours of buffered readings fixes the right windows', 'Window by the sensor’s timestamp with a watermark generous enough for offline gateways.'),
      req.fresh(120, 'Shippers expect the portal to be at most a couple of minutes behind.'),
      req.throughput(50000, 'readings'),
      req.noLoss(),
      req.survives('spark-ss', 'Losing one processor instance loses no readings', 'Run several executors; state and offsets come back from the checkpoint.'),
    ],
    palette: ['events', 'mem-buffer', 'kafka', 'proc-time', 'spark-ss', 'flink', 'cron-script', 'olap', 'kv', 'warehouse', 'app-api', 'bi'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 160, 'Gateways stamp each reading with the sensor’s event time and buffer on local flash while offline.', { label: 'Truck sensors' }),
        N('kafka', 'kafka', X[1], 160, 'Keyed by `truck_id`: 3 brokers, RF=3. Absorbs the upload bursts when a convoy leaves a tunnel.', { count: 3 }),
        N('sss', 'spark-ss', X[2], 160, '5-minute tumbling windows on `event_time` with `withWatermark("event_time", "6 hours")`, output mode update, a micro-batch every 30 s. Offsets and window state live in the checkpoint.', { count: 4 }),
        N('olap', 'olap', X[3], 160, 'Upsert table of (truck, window) → avg/max temperature, so late updates replace earlier values.', { count: 2 }),
        N('bi', 'bi', X[4], 80, 'Auditors’ excursion reports.'),
        N('api', 'app-api', X[4], 260, 'Shipper portal: temperature history per shipment.'),
      ],
      edges: [E('events', 'kafka'), E('kafka', 'sss'), E('sss', 'olap', 'Each micro-batch upserts the windows it updated, including late ones.'), E('olap', 'bi'), E('olap', 'api')],
    },
    wrong: {
      'proc-time': {
        why: 'A reading taken in a tunnel at 10:02 that uploads at 10:40 would land in the 10:40 window. The excursion is attributed to the wrong time, maybe to a different leg of the trip, and a compliance report built on it is wrong.',
        instead: W.procTime.instead,
      },
      'mem-buffer': W.memBuffer,
      'cron-script': W.cronScript,
    },
    alt: {
      flink: 'Flink works too, with per-record latency and a side output for readings beyond the watermark. Spark’s 30-second micro-batches already meet the 2-minute target.',
    },
  },
  deeper: [{ label: 'Kafka record timestamps, partitions & ordering', to: '/kafka' }],
};

export const dedupIdempotent: Pattern = {
  id: 'dedup-idempotent',
  num: 9,
  title: 'Deduplication & idempotent writes',
  group: 'Streaming',
  tagline: 'At-least-once delivery means duplicates are normal. Give every event an identity, remember it for long enough, and make every write safe to repeat.',
  minutes: 13,
  level: 'Intermediate',
  signals: [
    '"the service saves to the DB and then publishes an event"',
    'retries anywhere: mobile clients, producers, webhooks, CDC restarts',
    '"points / balances / counts are sometimes doubled"',
    'loading a stream into a warehouse table that finance reconciles',
  ],
  learn: [
    'Why the dual write loses or invents events, and how the transactional outbox fixes it',
    'Idempotency keys: giving every business event a stable identity',
    'A dedup state store with a TTL, and how to size it',
    'Idempotent sinks: upsert/SET instead of INCR, MERGE instead of INSERT',
  ],
  realWorld: [
    { who: 'Segment', how: 'Built a dedup service on Kafka and RocksDB that remembers every message id for a 4-week window, so retried client sends are dropped before they reach destinations.' },
    { who: 'Stripe', how: 'Every mutating API call accepts an `Idempotency-Key`. The server stores the first result and returns it for retries of the same key (keys expire after 24 hours).' },
    { who: 'Debezium (Red Hat)', how: 'Ships an Outbox Event Router: a service writes an outbox row in the same transaction as the business change, and CDC publishes it, so the event and the write can’t diverge.' },
  ],
  scenario: {
    id: 'dd-loyalty-points',
    title: 'Loyalty points from orders',
    context:
      'A marketplace awards loyalty points for every order. The app shows each customer’s balance, and finance reports the points liability from the warehouse. During sales the order service handles 15,000 order events/s. Mobile clients retry checkout on flaky networks, and today the service saves the order and then publishes an event to Kafka from application code. Customers have started noticing double points, and some orders never earned any.',
    workload: { eps: 15000, unit: 'order event', dup: 0.03 },
    requirements: [
      req.edge('app-db', 'cdc', 'Every committed order produces its event atomically (outbox + CDC)', 'Publishing from app code after the commit can lose events. Write an outbox row in the same transaction and let CDC publish it.'),
      req.exactlyOnce('Duplicates will arrive (client retries, CDC restarts). Deduplicate by event id in a stateful processor and write idempotently.'),
      req.noLoss(),
      req.fresh(120, 'Points should show up in the app within seconds and in finance reports within a couple of minutes.'),
      req.chaos('replay', 'An hour of re-delivered events doesn’t change any balance', 'Remember recently seen event ids (keyed state with a TTL), or make the write an upsert.'),
      req.chaos('crash', 'A processor crash mid-write leaves balances correct', 'Checkpoint offsets and state together, and make the sink idempotent or transactional.'),
    ],
    palette: ['app-db', 'events', 'dual-write', 'cdc', 'kafka', 'append-sink', 'flink', 'spark', 'cron-script', 'kv', 'warehouse', 'lakehouse', 'app-api', 'bi'],
    reference: {
      nodes: [
        N('db', 'app-db', X[0], 160, 'Orders DB. The order row and an `outbox` row (`event_id`, payload) commit in the same transaction. A unique constraint on the client’s idempotency key turns a retried checkout into a no-op.'),
        N('cdc', 'cdc', X[1], 160, 'Debezium tails the write-ahead log and publishes outbox rows. After a restart it resumes from its last stored log position, so it may re-send a few events: at-least-once.'),
        N('kafka', 'kafka', X[2], 160, 'Replicated log (3 brokers, RF=3) keyed by `customer_id`, so one customer’s events stay in order.', { count: 3 }),
        N('flink', 'flink', X[3], 160, 'Keyed by `event_id` first: a dedup state store (RocksDB) keeps each id for 7 days (state TTL) and drops repeats. Then keyed by customer, it sums points into an absolute balance. Checkpoints every 30 s.', { count: 2 }),
        N('kv', 'kv', X[4], 80, '`customer_id → points_balance`. Flink writes the absolute balance (SET), never an increment, so a repeated write is harmless.'),
        N('wh', 'warehouse', X[4], 260, '`fct_points` loaded by `MERGE … ON event_id`: a row that already exists is never inserted again.'),
        N('api', 'app-api', X[5], 80, 'The app reads the balance by key.'),
        N('bi', 'bi', X[5], 260, 'Finance’s points-liability report.'),
      ],
      edges: [
        E('db', 'cdc', 'CDC reads only committed transactions from the WAL, so an event exists if and only if the order does.'),
        E('cdc', 'kafka', 'Each outbox row becomes one message keyed by customer, with `event_id` in the payload.'),
        E('kafka', 'flink'),
        E('flink', 'kv', 'Idempotent sink: SET balance, keyed by customer.'),
        E('flink', 'wh', 'Micro-batches go to a staging table, deduplicated within the batch, then MERGE on event_id.'),
        E('kv', 'api'),
        E('wh', 'bi'),
      ],
    },
    wrong: {
      'dual-write': W.dualWrite,
      'append-sink': W.appendSink,
      'cron-script': W.cronScript,
    },
    alt: {
      lakehouse: 'An Iceberg/Delta table loaded with `MERGE INTO … ON event_id` is just as idempotent as the warehouse, and cheaper for long history. Add compaction if a stream writes into it.',
      spark: 'A daily Spark job that rebuilds `fct_points` partitions from the raw events (overwrite per date, `dropDuplicates(event_id)`) is a fine reconciliation layer, but it can’t keep the app’s balance fresh.',
    },
  },
  extras: {
    nodes: [
      N('dw', 'dual-write', X[1], 160, 'Order service: `db.commit(order)` then `kafka.send(event)` in application code.'),
      N('naive', 'append-sink', X[3], 160, 'Consumer that does `INCR points` in the KV store and `INSERT` into the warehouse for every message.', { count: 4 }),
    ],
    edges: [E('db', 'dw'), E('dw', 'kafka'), E('kafka', 'naive'), E('naive', 'kv'), E('naive', 'wh')],
  },
  guided: [
    {
      title: 'The dual write',
      tag: 'problem',
      body: [
        'The order service commits the order to Postgres, then publishes `order_placed` to Kafka. A consumer adds points with `INCR` and inserts a row for finance.',
        'Two writes, no transaction. If the process dies or the Kafka send times out **after** the commit, the order exists and the event never does. If you publish first and the commit then fails, you get an event for an order that doesn’t exist. Retrying the send after a timeout can publish it twice.',
      ],
      add: ['db', 'dw', 'kafka', 'naive', 'kv', 'wh', 'api', 'bi'],
      chaos: 'crash',
      predict: {
        question: 'The service commits an order, then the pod is killed before `kafka.send` returns. What happens to the points?',
        options: ['Kafka retries automatically', 'The order exists but the event is lost, so no points, ever', 'The DB rolls back the order', 'Points are awarded twice'],
        answer: 1,
        explain: 'The DB commit and the Kafka send are independent. Nothing will ever re-send that event, so the two systems now disagree for good. The reverse ordering has the opposite failure.',
      },
    },
    {
      title: 'Transactional outbox + CDC',
      tag: 'technique',
      body: [
        'Write the event into an `outbox` table **in the same database transaction** as the order. Either both commit or neither does. Then **CDC** (Debezium) tails the write-ahead log and publishes each outbox row to Kafka.',
        'The service no longer talks to Kafka at all. Atomicity comes from the database, and delivery from a process that resumes from a stored log position (LSN). Delete outbox rows after a few days, or let a partitioned table drop old partitions.',
        'At the very edge, the mobile client sends an **idempotency key** with checkout. A unique constraint on it means a retried request finds the existing order instead of creating a second one, so a second outbox row is never written.',
      ],
      add: ['cdc'],
      remove: ['dw'],
      keyIdea: 'Never write to two systems from application code. Write once, transactionally, and derive the second write from the first (outbox + CDC).',
      goodToKnow: 'The outbox row carries a stable `event_id` (e.g. order_id + event type + version). That id is what every downstream dedup step keys on, so mint it once, at the source.',
    },
    {
      title: 'Duplicates are normal',
      tag: 'problem',
      body: [
        'The outbox fixed loss, but delivery is still **at-least-once**. CDC re-sends events after a restart (it resumes from the last LSN it stored, not the last one it sent). Producers retry on timeouts. Consumers re-read after a rebalance.',
        'The naive consumer turns every one of those into extra points: `INCR` is not idempotent, and neither is a plain `INSERT`.',
      ],
      chaos: 'replay',
      predict: {
        question: 'Kafka Connect restarts and re-publishes the last 10 minutes of outbox rows. What happens with the INCR consumer?',
        options: ['Nothing: Kafka drops duplicate messages', 'Those customers get their points twice, and finance’s table has duplicate rows', 'The consumer detects the restart and skips', 'The balances go negative'],
        answer: 1,
        explain: 'To Kafka, the re-published rows are new messages with new offsets. Only something that remembers event ids, or a write that is naturally repeatable, can tell they are duplicates.',
      },
    },
    {
      title: 'A dedup state store with a TTL',
      tag: 'technique',
      body: [
        'Replace the consumer with **Flink**. Key the stream by `event_id` and keep a tiny piece of state per id: “seen”. If the state exists, drop the event; otherwise emit it and set the state with a **TTL** of 7 days.',
        'The state lives in RocksDB on local disk and is part of every checkpoint, so it survives restarts together with the Kafka offsets. Then key by customer and keep the running balance.',
      ],
      add: ['flink'],
      remove: ['naive'],
      chaos: 'replay',
      keyIdea: 'Deduplication = a stable event id + memory of ids you’ve seen, for at least as long as a duplicate can arrive late.',
    },
    {
      title: 'Sizing the TTL',
      tag: 'tradeoff',
      body: [
        'The TTL must cover the longest gap between an original and its duplicate: CDC restarts (minutes), consumer replays after an incident (hours), a re-sent backfill (days).',
        'State size ≈ unique ids per second × TTL × bytes per entry. 15,000/s × 7 days ≈ 9 billion ids. At ~40 bytes each in RocksDB that is ~360 GB spread over the cluster: possible, but it makes checkpoints and restores heavy. 24 hours is ~1.3 B ids, ~50 GB.',
        'Options: a shorter TTL plus an idempotent sink as a second line of defence; dedup per customer (fewer ids per key, same total); or a Bloom filter per time bucket if a tiny false-positive rate (dropping a real event) is acceptable. It rarely is, for money.',
      ],
      predict: {
        question: 'Dedup TTL is 24 hours. During an incident, someone replays a 3-day-old batch of events. What protects the balances?',
        options: ['Nothing: the old ids have expired, so those events count again', 'Kafka’s idempotent producer', 'The idempotent sink: SET of a recomputed balance and MERGE on event_id', 'The TTL is extended automatically'],
        answer: 2,
        explain: 'Expired ids pass the dedup operator. A second line of defence in the sink catches them: MERGE on event_id never inserts an existing row. Defence in depth beats one huge TTL.',
      },
    },
    {
      title: 'Idempotent sinks',
      tag: 'technique',
      body: [
        '**Upsert/SET, not INCR.** Flink owns the balance in its state and writes the absolute value (`SET points:42 = 1250`). Writing it twice leaves 1250. `INCR` twice leaves the wrong number.',
        '**MERGE, not INSERT.** For the warehouse: land a micro-batch in staging, deduplicate it (`QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY ingested_at) = 1`), then `MERGE INTO fct_points USING staging ON event_id WHEN NOT MATCHED THEN INSERT`. Re-running the same batch changes nothing.',
        'Kill the job mid-write: it restores offsets and the dedup state from the last checkpoint, re-reads a few seconds of events, and the repeated writes are no-ops.',
      ],
      chaos: 'crash',
      keyIdea: 'A write is idempotent if applying it twice leaves the same state as applying it once. Prefer writes of absolute values keyed by a stable id.',
    },
    {
      title: 'A processor instance dies',
      tag: 'failure',
      body: ['Kill one of the two Flink instances at peak.'],
      kill: ['flink'],
      predict: {
        question: 'One Flink instance dies. Its partitions move to the survivor. What happens to duplicates in flight?',
        options: ['They get through, because the dedup state was on the dead instance', 'The survivor restores that key range’s dedup state from the checkpoint, so they are still dropped', 'Kafka deletes them', 'All points are recomputed from zero'],
        answer: 1,
        explain: 'Keyed state is checkpointed per key group. The survivor restores exactly the key groups it takes over, dedup ids included, and resumes from the matching offsets.',
      },
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        'Source: write the event atomically with the business change (outbox + CDC), and reject retried requests with an idempotency key. Pipeline: deduplicate by `event_id` in checkpointed state with a TTL sized for your worst replay. Sink: SET/upsert and MERGE, never INCR/INSERT.',
        'Each layer catches what the previous one missed. Interviewers listen for “where does the event id come from?” and “what happens when the dedup TTL has expired?”.',
      ],
    },
  ],
  quiz: [
    {
      id: 'dd-q1',
      q: 'The order service commits to Postgres, then publishes to Kafka. What can go wrong?',
      options: ['Nothing, if Kafka has RF=3', 'A crash between the two leaves an order with no event, and a retried send can publish it twice', 'Postgres rejects the commit', 'Only performance suffers'],
      answer: 1,
      why: 'Two independent writes without a shared transaction can fail independently. The outbox makes them one write.',
    },
    {
      id: 'dd-q2',
      q: 'Why does outbox + CDC give at-least-once and not exactly-once delivery into Kafka?',
      options: ['CDC can re-publish rows after a restart, from its last stored log position', 'Outbox rows can be lost', 'Kafka reorders messages', 'Debezium samples rows'],
      answer: 0,
      why: 'Connectors store their position periodically. After a crash they resume from that position and re-send what came after it, so downstream must deduplicate.',
    },
    {
      id: 'dd-q3',
      q: 'Which write is idempotent?',
      options: ['UPDATE accounts SET points = points + 10', 'INSERT INTO points_log VALUES (…)', 'SET points:42 = 1250, computed from all of the customer’s events', 'INCR points:42 10'],
      answer: 2,
      why: 'Writing an absolute value keyed by id gives the same end state no matter how many times it is applied. Increments and inserts accumulate.',
    },
    {
      id: 'dd-q4',
      q: 'A MERGE inserts rows WHEN NOT MATCHED on event_id. The incoming batch itself contains the same event_id twice. What happens?',
      options: ['MERGE always keeps one', 'Both rows may be inserted, or the MERGE errors, depending on the engine: deduplicate the batch first', 'The target table is truncated', 'The second row updates the first'],
      answer: 1,
      why: 'Neither source row matches the target, so both are “not matched”. Deduplicate the source (ROW_NUMBER() = 1 per event_id) before the MERGE.',
    },
    {
      id: 'dd-q5',
      q: 'Dedup state keeps ids for 24 h at 15,000 new ids/s. Roughly how many ids are in state?',
      options: ['~15 million', '~1.3 billion', '~90 billion', 'It depends only on the number of customers'],
      answer: 1,
      why: '15,000 × 86,400 ≈ 1.3 billion. At tens of bytes each that is tens of GB: fine in RocksDB, too big for heap state. Always do this math before choosing a TTL.',
    },
  ],
  challenge: {
    id: 'dd-payments-ledger',
    title: 'Payment webhooks into the finance ledger',
    context:
      'A fintech receives payment status webhooks (authorized, captured, refunded) from its card processor. The processor retries every webhook until it gets a 200, so 5% arrive two or three times, sometimes hours apart. Finance’s ledger table in the warehouse must hold exactly one row per payment event, and reconciliation against the processor’s settlement file runs every hour. 8,000 webhooks/s at peak.',
    workload: { eps: 8000, unit: 'webhook', dup: 0.05 },
    requirements: [
      req.exactlyOnce('Webhook retries are duplicates with the same processor event id. Deduplicate on it, and MERGE into the ledger.'),
      req.noLoss('Return 200 only after the event is durably in the log; never from memory.'),
      req.fresh(300, 'Hourly reconciliation needs the ledger at most a few minutes behind.'),
      req.chaos('replay', 'A re-delivered hour of webhooks leaves the ledger unchanged', 'Deduplicate by the processor’s event id, and make the load a MERGE.'),
      req.chaos('crash', 'A loader crash mid-batch neither drops nor doubles rows', 'Checkpointed offsets plus a transactional MERGE: a retried micro-batch rewrites the same rows.'),
      req.backfill('full', 'Keep the full ledger in a table you can re-derive from and audit.'),
    ],
    palette: ['events', 'app-db', 'dual-write', 'mem-buffer', 'kafka', 'cdc', 'append-sink', 'spark-ss', 'flink', 'cron-script', 'warehouse', 'dbt', 'bi'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 160, 'Verifies the signature, produces to Kafka keyed by `payment_id` with acks=all, and only then returns 200. A failed produce returns 500, so the processor retries.', { label: 'Webhook receiver' }),
        N('kafka', 'kafka', X[1], 160, '3 brokers, RF=3. Keyed by payment, so a payment’s events stay in order.', { count: 3 }),
        N('sss', 'spark-ss', X[2], 160, '`dropDuplicatesWithinWatermark("processor_event_id")` with a 24 h watermark, then `foreachBatch`: dedupe the batch and MERGE into the ledger. Offsets in the checkpoint.', { count: 2 }),
        N('wh', 'warehouse', X[3], 160, '`ledger_events` with a MERGE on `processor_event_id`: existing rows are never inserted twice. Full history for audits.'),
        N('bi', 'bi', X[4], 160, 'Finance reconciliation and ledger reports.'),
      ],
      edges: [E('events', 'kafka'), E('kafka', 'sss'), E('sss', 'wh', 'MERGE per micro-batch, in one transaction: a retried batch is a no-op.'), E('wh', 'bi')],
    },
    wrong: {
      'append-sink': W.appendSink,
      'dual-write': {
        why: 'Writing the webhook to a ledger DB and then publishing it to Kafka from the handler is two non-atomic writes: a crash between them leaves the ledger and the stream disagreeing, and the retried webhook may only half-repeat.',
        instead: 'Produce to Kafka first and acknowledge only after acks=all; everything else derives from the log.',
      },
      'mem-buffer': W.memBuffer,
      'cron-script': W.cronScript,
    },
    alt: {
      dbt: 'Land raw webhooks in a staging table, then a dbt incremental model with `unique_key=\'processor_event_id\'` does the MERGE. That is idempotent too, at batch freshness.',
      flink: 'Flink with keyed dedup state and a JDBC upsert sink works as well; Structured Streaming fits a team that already runs Spark.',
    },
  },
  deeper: [
    { label: 'Kafka idempotent producers, transactions & delivery semantics', to: '/kafka' },
    { label: 'Keys, uniqueness and fact table grain', to: '/data-modeling' },
  ],
};

export const lambdaKappa: Pattern = {
  id: 'lambda-kappa',
  num: 10,
  title: 'Lambda vs Kappa',
  group: 'Streaming',
  tagline: 'Two pipelines (batch + speed) or one streaming pipeline you can replay? Kappa keeps one codebase and reprocesses by replaying the log into a new table version.',
  minutes: 13,
  level: 'Advanced',
  signals: [
    '"real-time, but we also need accurate history"',
    '"the logic changes every month and history must be recomputed"',
    '"the batch numbers and the streaming numbers don’t match"',
    'two teams maintaining the same metric in Spark SQL and in a streaming job',
  ],
  learn: [
    'Lambda: batch layer + speed layer + merge at query time, and why it was invented',
    'The real cost of Lambda: two codebases that drift apart',
    'Kappa: one streaming job, a replayable log, and reprocessing by replay',
    'Replaying from offset 0 into a new table version, then swapping readers',
    'What Kappa needs: retention, deterministic event-time logic, catch-up capacity',
  ],
  realWorld: [
    { who: 'LinkedIn', how: 'Jay Kreps’ “Questioning the Lambda Architecture” (2014) proposed Kappa: keep the raw log in Kafka, reprocess by running a second copy of the job from the start of the log, then switch readers.' },
    { who: 'Twitter', how: 'Summingbird let one Scala job run on both Hadoop (batch) and Storm (real time): a Lambda architecture that tried to remove the two-codebase cost.' },
    { who: 'Uber', how: 'Described a “Kappa+” design: backfills run the same streaming code against Hive tables instead of Kafka, because keeping years of history in Kafka was too expensive.' },
  ],
  scenario: {
    id: 'lk-creator-analytics',
    title: 'Creator analytics with reprocessing',
    context:
      'A video platform shows creators views and watch time per video, per hour, live in the creator dashboard. 30,000 playback events/s. The definition of a view changes every few months (bot filtering, “counts after 30 s of watch time”), and every change must be applied to all of history so creators never see a jump. Analysts also query the full history.',
    workload: { eps: 30000, unit: 'playback event' },
    requirements: [
      req.fresh(120, 'Creators expect the dashboard to be about a minute behind, at most.'),
      req.throughput(30000, 'events'),
      req.exactlyOnce('Restarts and replays must not inflate view counts: checkpointed state plus an idempotent or transactional sink.'),
      req.backfill('full', 'Logic changes must be applied to all history. Keep a replayable history (long log retention plus a lakehouse table), not just a few days of Kafka.'),
      req.cost(6500, 'Two parallel pipelines (batch + speed + their serving views) roughly double compute and storage. One replayable streaming path is cheaper.'),
      req.survives('flink', 'Losing one processor instance loses nothing', 'Run several instances; state restores from the last checkpoint.'),
    ],
    palette: ['events', 'mem-buffer', 'kafka', 'flink', 'spark', 'proc-time', 'cron-script', 'object-store', 'lakehouse', 'compaction', 'olap', 'kv', 'trino', 'app-api', 'bi'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 160, 'Players emit playback events with an event id and event time.'),
        N('kafka', 'kafka', X[1], 160, 'The source of truth for reprocessing: 3 brokers, RF=3, 30 days on broker disks and older segments in tiered storage (S3). Replays read from offset 0.', { count: 3 }),
        N('flink', 'flink', X[2], 160, 'One codebase for live and replay: event-time hourly windows, bot filtering, view definition v1. A replay is the same job with `--version v2` reading from the earliest offset.', { count: 3 }),
        N('olap', 'olap', X[3], 80, '`creator_stats_v1` in Pinot/Druid. A reprocessing run writes `creator_stats_v2` next to it; the API switches via an alias.', { count: 2 }),
        N('api', 'app-api', X[4], 80, 'Creator dashboard, reading through a table alias so the swap to v2 is instant.'),
        N('lake', 'lakehouse', X[3], 260, 'Iceberg table of cleaned events and hourly aggregates, kept forever. Flink can read it as a bounded source to replay beyond Kafka’s retention.'),
        N('cmp', 'compaction', X[3], 380, 'Rewrites the streaming job’s small commit files into large files and expires old snapshots.'),
        N('trino', 'trino', X[4], 260, 'Analysts’ SQL over the full history.'),
        N('bi', 'bi', X[5], 260, 'Analyst dashboards and ad-hoc queries.'),
      ],
      edges: [
        E('events', 'kafka'),
        E('kafka', 'flink', 'Live job reads from the latest committed offsets; a reprocessing job reads from offset 0 with its own consumer group.'),
        E('flink', 'olap', 'Upserts per (video, hour) into the versioned table.'),
        E('olap', 'api'),
        E('flink', 'lake', 'Exactly-once commits on each checkpoint.'),
        E('cmp', 'lake'),
        E('lake', 'trino'),
        E('trino', 'bi'),
      ],
    },
    wrong: {
      'proc-time': {
        why: 'Processing-time windows make replays non-deterministic: replaying a month in 3 hours puts the whole month into 3 hourly windows. Kappa only works if the job computes the same result whenever it runs.',
        instead: W.procTime.instead,
      },
      'mem-buffer': W.memBuffer,
      'cron-script': W.cronScript,
    },
    alt: {
      'object-store': 'Archiving raw events to object storage (Kafka Connect S3 sink) is a cheap safety net for replays beyond the log’s retention.',
    },
  },
  extras: {
    nodes: [
      N('raw', 'object-store', X[2], 300, 'Lambda batch layer: Kafka Connect dumps raw events to S3 every hour (the master dataset).'),
      N('batch', 'spark', X[3], 300, 'Lambda batch layer: a nightly Spark SQL job recomputes all views from the full raw history. Codebase #2.'),
      N('bview', 'kv', X[4], 300, 'Lambda serving layer: batch views, replaced wholesale every night.', { label: 'Batch views' }),
    ],
    edges: [E('kafka', 'raw'), E('raw', 'batch'), E('batch', 'bview'), E('bview', 'api')],
  },
  guided: [
    {
      title: 'A streaming job with no way back',
      tag: 'problem',
      body: [
        'Start with a Flink job: Kafka → hourly views per video → OLAP → creator dashboard. It is fresh and simple.',
        'Then the data team finds a bug: bot traffic from one ASN was counted as views for the last 3 weeks. Kafka keeps 3 days. The raw events for the other 18 days are gone, so the inflated numbers can never be fixed.',
      ],
      add: ['events', 'kafka', 'flink', 'olap', 'api'],
      predict: {
        question: 'Kafka retention is 3 days. How do you correct the last 3 weeks of view counts?',
        options: ['Replay Kafka from offset 0', 'You can’t: 18 days of raw events no longer exist anywhere', 'Subtract an estimate in the dashboard', 'Restart Flink from an old checkpoint'],
        answer: 1,
        explain: 'Reprocessing needs the raw input. A checkpoint holds state, not the events that built it. Whatever architecture you choose, keeping replayable history is the first requirement.',
      },
    },
    {
      title: 'Lambda: add a batch layer',
      tag: 'technique',
      body: [
        'Nathan Marz’s **Lambda architecture**: keep every raw event forever in object storage (the master dataset). A **batch layer** recomputes all views from scratch every night (Spark), so any bug is fixed by the next run. A **speed layer** (Flink) covers only the hours since the last batch. The **serving layer** merges both at query time.',
        'Historically this made sense: in 2011 stream processors couldn’t do exactly-once state or event-time windows, so the batch layer was the source of truth and the stream was a fast approximation.',
      ],
      add: ['raw', 'batch', 'bview'],
      keyIdea: 'Lambda = immutable master data + recompute in batch for correctness + a stream for freshness + merge at read time.',
    },
    {
      title: 'The price: two codebases',
      tag: 'tradeoff',
      body: [
        'Every metric now exists twice: Flink Java in the speed layer, Spark SQL in the batch layer. A bot-filter change has to ship to both, tested twice, in two languages, by two teams.',
        'They drift. Creators see a video at 10,400 views at 23:59, then 9,870 after the nightly batch replaces the speed view. Every mismatch is a support ticket and a debugging session across two systems.',
        'Cost doubles too: two compute paths, two sets of serving tables and the glue that merges them.',
      ],
      predict: {
        question: 'Creators report that views “drop” every night at 01:00. What is the most likely cause?',
        options: ['Kafka loses data at night', 'The batch view and the speed layer compute “a view” differently, and the batch result replaces the streaming one', 'Time-zone bugs in the dashboard', 'Too few OLAP replicas'],
        answer: 1,
        explain: 'This is the classic Lambda symptom: two implementations of the same logic that disagree. The batch run is usually “right”, so the speed layer’s number is replaced.',
      },
    },
    {
      title: 'Kappa: one path, a replayable log',
      tag: 'technique',
      body: [
        'Modern stream processors give exactly-once state and event-time windows, so the stream can be the source of truth. **Kappa**: drop the batch layer. Keep the log replayable (30 days on Kafka brokers plus tiered storage), and have the same Flink job also write a lakehouse table kept forever, for analysts and for replays older than the log.',
        'One codebase, one definition of a view, one set of tests. The lakehouse gets **compaction** because the stream commits small files every checkpoint.',
      ],
      add: ['lake', 'cmp', 'trino', 'bi'],
      remove: ['raw', 'batch', 'bview'],
      keyIdea: 'Kappa treats batch as a special case of streaming: reprocessing is just running the same job over older data.',
      goodToKnow: 'Kafka tiered storage (KIP-405, in Confluent and Apache Kafka 3.6+) moves old segments to object storage, so months of retention don’t need months of broker disk.',
    },
    {
      title: 'Reprocessing: replay into v2, then swap',
      tag: 'technique',
      body: [
        'The view definition changes. Deploy **a second copy** of the job (v2 logic) with its own consumer group, reading from **offset 0** (or the lakehouse for older history) and writing to a **new table**, `creator_stats_v2`. The live v1 job keeps serving.',
        'v2 catches up at many times real-time speed. When its lag reaches zero, compare v1 and v2 on a sample, flip the alias the API reads, keep v1 for a day as a rollback, then stop it and drop the table.',
        'The catch-up needs capacity: replaying 30 days in 6 hours means about 120× the live rate for that job. Give it its own resources, so it doesn’t starve the live job.',
      ],
      traffic: 2,
      predict: {
        question: 'You run the v2 replay on the same Flink cluster as the live job, sharing its slots. What happens?',
        options: ['Nothing: replays are free', 'The live job competes for CPU and falls behind, so creators’ dashboards go stale during the backfill', 'Kafka rejects the second consumer group', 'v2 overwrites v1’s table'],
        answer: 1,
        explain: 'A replay is a burst of extra throughput. With shared capacity, both jobs slow down (watch the processor run hot). Isolate the replay: a separate deployment, separate slots, and a quota on the Kafka read rate.',
      },
      keyIdea: 'Never reprocess in place. Write a new version next to the old one, verify, swap atomically, keep a rollback.',
    },
    {
      title: 'Replays must be deterministic',
      tag: 'tradeoff',
      body: [
        'A replay only reproduces history if the job computes the same answer whenever it runs. That rules out processing-time windows, `now()` in logic, and lookups against mutable external services (today’s user profile applied to last year’s events).',
        'Use event-time windows, versioned reference data (join with the dimension as of event time), and deterministic ids. Late events are then handled the same way live and in replay.',
        'When is Lambda still reasonable? When the batch recomputation is genuinely different work (huge joins over years of history, model retraining) and the real-time view is allowed to be an approximation.',
      ],
      chaos: 'late',
    },
    {
      title: 'A processor instance dies',
      tag: 'failure',
      body: ['Kill one of the three Flink instances.'],
      kill: ['flink'],
      goodToKnow: 'With Kappa, a total disaster is also just a replay: lose the OLAP table, and the same job rebuilds it from the log.',
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        'Lambda: batch + speed + merge. It is correct and robust, and you pay twice for every metric. Kappa: one deterministic event-time streaming job, a log with long retention (tiered storage) plus a lakehouse copy, and reprocessing by replay into a new table version followed by a swap.',
        'In an interview, say how you’d reprocess: “new consumer group from offset 0 into `stats_v2`, isolated capacity, compare, flip the alias, keep v1 for rollback”.',
      ],
    },
  ],
  quiz: [
    {
      id: 'lk-q1',
      q: 'What is the main ongoing cost of a Lambda architecture?',
      options: ['Kafka storage', 'The same logic implemented twice (batch and streaming) and kept in sync', 'Batch jobs are slow', 'It can’t handle late data'],
      answer: 1,
      why: 'Two codebases drift, double testing and ownership, and produce visible mismatches when one view replaces the other.',
    },
    {
      id: 'lk-q2',
      q: 'In Kappa, how do you apply a logic fix to all of history?',
      options: ['Edit rows in the OLAP table', 'Run a new version of the job from the earliest offset into a new table, then switch readers when it catches up', 'Restart the live job from an old checkpoint', 'Run a nightly batch job'],
      answer: 1,
      why: 'Reprocessing = replay the log through the new code into a new output, then swap. The live version keeps serving until the swap.',
    },
    {
      id: 'lk-q3',
      q: 'Which property must the streaming job have for replays to reproduce correct results?',
      options: ['Low latency', 'Determinism: event-time windows and no dependence on wall-clock time or mutable lookups', 'High parallelism', 'Processing-time triggers'],
      answer: 1,
      why: 'If the result depends on when the job runs, a replay computes something different from what live processing did.',
    },
    {
      id: 'lk-q4',
      q: 'Kafka keeps 7 days, but a logic change must be applied to 2 years of history. What do you do?',
      options: ['Give up on Kappa', 'Replay older data from a lakehouse copy (or tiered storage) with the same job, then switch to the log', 'Increase partitions', 'Use processing time'],
      answer: 1,
      why: 'Kappa needs replayable history, not necessarily all of it in Kafka. Flink and Spark can read a table as a bounded source with the same code (Uber’s “Kappa+”).',
    },
  ],
  challenge: {
    id: 'lk-fraud-features',
    title: 'Fraud features with reprocessing',
    context:
      'A card issuer scores every authorization for fraud within 100 ms. The model reads per-card features (transactions in the last hour, distinct merchants in 24 h, amount vs the card’s 30-day average) from a feature store at 5,000 lookups/s. Data scientists add features every month and must backfill them over a year of history to train, with exactly the same logic as production, or the model sees training/serving skew. 40,000 authorizations/s.',
    workload: { eps: 40000, unit: 'authorization', queryQps: 5000 },
    requirements: [
      req.fresh(5, 'A feature that is a minute old misses a burst of fraudulent swipes.'),
      req.throughput(40000, 'authorizations'),
      req.exactlyOnce('A replayed authorization must not inflate a card’s counts.'),
      req.backfill('full', 'New features must be backfilled over a year of history with the same code. Keep full history in the feature store’s offline store or the lake.'),
      req.queryP99(50, 'The model has a 100 ms budget for the whole decision; feature lookups get half.'),
      req.survives('flink', 'Losing one processor instance loses nothing', 'Run several instances so partitions rebalance onto the survivors.'),
    ],
    palette: ['events', 'mem-buffer', 'kafka', 'flink', 'spark', 'proc-time', 'cron-script', 'object-store', 'feature-store', 'kv', 'ml', 'airflow'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 160, 'Card authorizations from the payment switch, each with an id and event time.', { label: 'Card authorizations' }),
        N('kafka', 'kafka', X[1], 160, '3 brokers, RF=3, tiered storage for a year of history: the replay source for new features.', { count: 3 }),
        N('flink', 'flink', X[2], 160, 'One feature pipeline in event time, keyed by card. Live, it reads the latest offsets; a backfill runs the same job from offset 0 into a new feature version.', { count: 3 }),
        N('fs', 'feature-store', X[3], 160, 'Online store (low-latency lookups by card) plus offline store (full, timestamped history for point-in-time training sets). Features are versioned.'),
        N('ml', 'ml', X[4], 160, 'Fraud model: reads online features at scoring time, trains on point-in-time offline features.'),
      ],
      edges: [E('events', 'kafka'), E('kafka', 'flink'), E('flink', 'fs', 'Upserts per (card, feature version), with the event timestamp for point-in-time joins.'), E('fs', 'ml')],
    },
    wrong: {
      'proc-time': {
        why: 'Processing-time windows give different feature values in a replay than they did live, which is exactly the training/serving skew you are trying to avoid.',
        instead: W.procTime.instead,
      },
      'mem-buffer': W.memBuffer,
      'cron-script': W.cronScript,
    },
    alt: {
      spark: 'A Spark job that computes the same features over the lake for backfills is the Lambda way (many feature platforms offer it). It works, but now two implementations of every feature must match exactly.',
      'object-store': 'Archiving raw authorizations to object storage is a cheap safety net for replays beyond the log’s retention.',
    },
  },
  deeper: [
    { label: 'Kafka retention, tiered storage & consumer offsets', to: '/kafka' },
    { label: 'Versioned tables and slowly changing dimensions', to: '/data-modeling' },
  ],
};

export const STREAMING_PATTERNS: Pattern[] = [exactlyOnce, lateData, dedupIdempotent, lambdaKappa];
