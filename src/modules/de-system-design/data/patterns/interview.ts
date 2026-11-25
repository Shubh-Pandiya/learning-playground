import type { Pattern } from '../../types';
import { E, N, W, X, req } from './dsl';

/* ------------------------------------------------------------------ */
/* 17. Clickstream analytics                                            */
/* ------------------------------------------------------------------ */

export const clickstream: Pattern = {
  id: 'clickstream',
  num: 17,
  title: 'Design clickstream analytics',
  group: 'Interview',
  tagline: 'The classic data-engineering interview: billions of user events a day, live dashboards and years of history. Size it, buffer it, sessionize it by event time, then serve hot and cold data differently.',
  minutes: 18,
  level: 'Advanced',
  signals: [
    '"design Google Analytics / Mixpanel / a product analytics pipeline"',
    '"page views, clicks, sessions, funnels"',
    '"real-time dashboard" plus "historical analysis"',
    'web and mobile SDKs: offline phones, retries, bots',
  ],
  learn: [
    'Napkin math: events/s at peak, TB/day raw and compressed, and what that implies for each tier',
    'Collector → Kafka → Flink: a durable buffer, then sessionization with event-time session windows',
    'Two serving paths: real-time OLAP for live tiles, a compacted lakehouse + Trino for history',
    'Late mobile events, duplicate SDK retries and bot traffic',
  ],
  realWorld: [
    { who: 'Snowplow', how: 'Open-source collector → enrich → stream pipeline with schema validation (Iglu); events land in the lake or warehouse, and bad rows go to a separate stream.' },
    { who: 'Netflix', how: 'Keystone routes trillions of events a day through Kafka and Flink into Iceberg tables and real-time consumers.' },
    { who: 'LinkedIn', how: 'Apache Pinot (built at LinkedIn) ingests Kafka in real time to power member-facing analytics like “Who viewed your profile”.' },
  ],
  scenario: {
    id: 'cs-ecommerce',
    title: 'E-commerce clickstream analytics',
    context:
      'A shopping app with 20 million daily users sends ~150 events per user per day (page views, searches, add-to-cart, checkout): ~3 billion events/day, ~35,000/s on average and ~100,000/s at the evening peak, ~1 KB each. Product managers want live tiles (active users, conversion funnel) refreshed within seconds; analysts want years of sessions to query; marketing wants bots out of the numbers.',
    workload: { eps: 100000, queryQps: 40, late: 0.03, dup: 0.01, unit: 'event' },
    requirements: [
      req.throughput(100000, 'events'),
      req.noLoss('Phones and browsers can’t buffer for long. Events need a durable, replicated log right behind the collectors.'),
      req.lateData('Mobile apps batch events offline and send them hours later. Sessions and funnels must use event time.'),
      req.exactlyOnce('SDKs retry on flaky networks. Drop duplicates by `event_id` in the stream processor.'),
      req.backfill('full', 'When the bot filter or the session definition changes, you must recompute past months.'),
      req.queryP99(3000, 'At the top of the hour 40 queries/s hit the dashboards. Offload live tiles to a real-time store, and keep the history in compacted files.'),
      req.has('olap', 'Live tiles (active users, funnel) refresh within seconds at dashboard concurrency', 'The lakehouse commits once a minute and Trino answers in seconds. Seconds-fresh aggregates at high QPS need a real-time OLAP store fed by the stream.'),
    ],
    palette: ['events', 'mem-buffer', 'kafka', 'schema-registry', 'flink', 'spark-ss', 'spark', 'object-store', 'lakehouse', 'compaction', 'olap', 'warehouse', 'trino', 'bi', 'tiny-writer', 'proc-time'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 160, 'Web and mobile SDKs batch events (every few seconds or 20 events) and POST them to a stateless collector fleet behind a load balancer. Each event has an `event_id` (UUID), `user_id`/`anonymous_id`, `event_time` and `sent_at`.'),
        N('kafka', 'kafka', X[1], 160, 'Collectors produce to Kafka with acks=all and return 200 only after the write. 3 brokers, RF=3, ~100 partitions keyed by `anonymous_id` so a user’s events stay ordered. 7 days of retention is a replay buffer.', { count: 3 }),
        N('flink', 'flink', X[2], 160, 'Dedup by `event_id` (keyed state with a 24 h TTL), flag bots, enrich (geo-IP, device), and sessionize with event-time session windows (30 min gap). Emits clean events and session rows.', { count: 6 }),
        N('olap', 'olap', X[3], 50, 'Pinot/Druid: per-minute rollups by page, country and device, ingested within seconds. Star-tree indexes keep funnel and active-user tiles in tens of milliseconds.', { count: 2 }),
        N('lake', 'lakehouse', X[3], 280, 'Iceberg tables `events` and `sessions`, partitioned by event date. The full, replayable history: years of data at ~0.4 TB/day compressed.'),
        N('compact', 'compaction', X[2], 380, 'Flink commits every minute from 6 writers. Hourly compaction rewrites those files into ~512 MB files, sorted by `event_name`, and expires old snapshots.'),
        N('trino', 'trino', X[4], 280, 'Analysts’ SQL over the lakehouse: funnels over 90 days, cohort retention, ad-hoc questions.', { count: 2 }),
        N('bi', 'bi', X[5], 160, 'Dashboards: live tiles from OLAP, history and deep-dives through Trino.'),
      ],
      edges: [
        E('events', 'kafka', 'Collector → Kafka, acks=all. The collector is stateless; Kafka is the buffer.'),
        E('kafka', 'flink'),
        E('flink', 'olap', 'Clean, deduplicated events and minute rollups (via an output topic that Pinot/Druid ingest).'),
        E('flink', 'lake', 'Exactly-once Iceberg commits on each checkpoint (~1 min).'),
        E('compact', 'lake'),
        E('lake', 'trino'),
        E('olap', 'bi', 'Live tiles: last minutes to days.'),
        E('trino', 'bi', 'History: months to years.'),
      ],
    },
    wrong: {
      'mem-buffer': W.memBuffer,
      'tiny-writer': W.tinyWriter,
      'proc-time': {
        why: `${W.procTime.why} Sessions are worse: an offline phone’s 20-minute session arrives in one burst and becomes a 2-second session, and conversion rates drift.`,
        instead: 'Event-time session windows with a watermark and allowed lateness.',
      },
    },
    alt: {
      'spark-ss': 'Structured Streaming (30–60 s micro-batches) can sessionize and write to Iceberg too, and is a fine choice on a Databricks stack. Flink gives lower latency for the live path.',
      warehouse: 'BigQuery or Snowflake can hold the history instead of lakehouse + Trino. Simpler to run, but at ~3 TB/day of raw events, storage and scans are usually cheaper on open tables.',
      'schema-registry': 'Validating events against versioned schemas (like Snowplow’s Iglu) at the collector is a strong addition: malformed events go to a bad-rows topic instead of polluting tables.',
      'object-store': 'Also archiving the raw collector payloads to object storage is common. It is the last-resort replay source if enrichment had a bug.',
    },
  },
  extras: {
    nodes: [
      N('tiny', 'tiny-writer', X[2], 280, 'The naive approach: the collector writes each event as a JSON object to S3.', { label: 'Collector: one file per event' }),
      N('rawobj', 'object-store', X[3], 280, 'A bucket with billions of 1 KB JSON objects, queried with Athena/Trino.', { label: 'S3 bucket (JSON per event)' }),
    ],
    edges: [E('events', 'tiny', undefined, 'kafka'), E('kafka', 'tiny'), E('tiny', 'rawobj'), E('rawobj', 'trino')],
  },
  guided: [
    {
      title: 'Napkin math first',
      tag: 'problem',
      body: [
        'Start every interview by sizing it. 20 M daily users × 150 events = **3 B events/day**. Divided by 86,400 s that is ~35 k/s on average; evening peaks run ~3× the average, so design for **100 k events/s**.',
        'At ~1 KB per event that is **3 TB/day raw**, about 1 PB a year. As compressed Parquet (~8×) it is ~0.4 TB/day. Dashboards add ~40 queries/s at the top of the hour.',
        'The naive design: collectors write each event as its own JSON object to S3, and analysts query the bucket. At 100 k objects/s, see what breaks first.',
      ],
      add: ['events', 'tiny', 'rawobj', 'trino', 'bi'],
      predict: {
        question: 'Collectors PUT one S3 object per event at 100,000 events/s. What breaks first?',
        options: ['Nothing: S3 scales infinitely', 'The writers can’t keep up, events are dropped, and the bucket fills with billions of tiny files that queries can’t scan', 'Only the cost goes up', 'Queries get faster because files are small'],
        answer: 1,
        explain: 'Per-object PUT latency and per-prefix request limits cap the writers, and there is no buffer, so events are lost. The files that do land make every query list and open millions of objects.',
      },
    },
    {
      title: 'A durable buffer behind the collectors',
      tag: 'technique',
      body: [
        'Put **Kafka** right behind the collectors. The collector returns 200 only after Kafka has acknowledged the batch (acks=all, RF=3), so an accepted event is never lost, even if everything downstream is down.',
        'Kafka also absorbs the evening peak: consumers that fall behind build lag, not data loss. 100 k events/s × 1 KB is ~100 MB/s in, well within 3 brokers, and 7 days of retention is your replay window.',
      ],
      add: ['kafka'],
      keyIdea: 'Separate accepting data from processing it. The collector’s only job is to validate lightly and write durably; everything else reads from the log at its own pace.',
    },
    {
      title: 'Sessionize by event time',
      tag: 'technique',
      body: [
        'Replace the file-per-event writer with **Flink**. Per `anonymous_id` it deduplicates by `event_id`, enriches (geo-IP, device), and builds **session windows**: a session ends after 30 minutes without activity, measured in event time.',
        'A **watermark** (for example max event time minus 10 minutes) says when a window is probably complete; allowed lateness keeps it updatable for hours, so a phone that was offline still lands its events in the right session.',
        'Output goes to Iceberg tables `events` and `sessions`, committed exactly-once on each checkpoint.',
      ],
      add: ['flink', 'lake'],
      remove: ['tiny', 'rawobj'],
      chaos: 'late',
      predict: {
        question: 'A phone was offline on the subway for 25 minutes and uploads 40 events at once. With event-time session windows, what happens?',
        options: ['They form a new session at upload time', 'They are merged into the user’s session at the times they happened', 'They are dropped', 'They double the session count'],
        answer: 1,
        explain: 'Event-time windows use the timestamps on the events, not the arrival time. Sessions that fall within the gap merge; allowed lateness keeps the window updatable.',
      },
    },
    {
      title: 'Every minute, 6 new files per partition',
      tag: 'failure',
      body: [
        'Flink commits on every checkpoint: 6 writers × every minute × each date/event partition is thousands of small files per hour, and millions per year.',
        'Queries now spend most of their time listing and opening files. At 40 queries/s Trino queues, and p99 grows from seconds to tens of seconds as the table ages.',
      ],
      chaos: 'smallfiles',
      predict: {
        question: 'Nothing compacts the streaming table for a month. What happens?',
        options: ['Data is lost', 'Numbers become wrong', 'Queries stay correct but get slower every day', 'Flink stops writing'],
        answer: 2,
        explain: 'Small files are a performance failure, not a correctness one: planning and opening files dominates the query time.',
      },
    },
    {
      title: 'Compact the history',
      tag: 'technique',
      body: [
        'Add **table maintenance**: an hourly job rewrites the last hour’s small files into ~512 MB files, sorted by `event_name` so funnel queries skip most of them, and expires old snapshots. Iceberg’s atomic commits let it run while Flink keeps writing.',
      ],
      add: ['compact'],
      chaos: 'smallfiles',
      goodToKnow: 'Partition by event date, not by user or event name: the partition count stays small and every query prunes by time. Use sort order or Z-ordering within partitions for the other columns.',
    },
    {
      title: 'Live tiles need a different store',
      tag: 'tradeoff',
      body: [
        'Trino over a compacted lake answers in seconds, but the lake is only as fresh as the last commit (about a minute), and every live tile at the top of the hour is a distributed scan.',
        'Add a **real-time OLAP** store (Pinot/Druid/ClickHouse). It ingests Flink’s output within seconds, pre-aggregates per minute, and answers funnel and active-user tiles in tens of milliseconds at thousands of QPS. The lake stays the system of record; the OLAP store keeps, say, 30 days.',
      ],
      add: ['olap'],
      keyIdea: 'Hot and cold data have different access patterns. Serve recent, pre-aggregated data from a real-time store and long history from cheap open tables, instead of one store that is bad at both.',
      predict: {
        question: 'What should the OLAP store NOT be in this design?',
        options: ['The source for live tiles', 'The only copy of the data', 'Pre-aggregated by minute', 'Fed from the stream'],
        answer: 1,
        explain: 'OLAP stores are serving layers with limited retention and joins. If a bot rule changes, you recompute from the lake and reload; the lake is the source of truth.',
      },
    },
    {
      title: 'Bots and duplicates',
      tag: 'failure',
      body: [
        'A large share of web traffic is automated. Filter in layers: known user agents (the IAB spiders and bots list), data-centre IP ranges, and behaviour (100 page views a minute, no mouse events). **Flag, don’t delete**: write `is_bot` on the event, exclude it in metrics, and keep the raw rows so a better rule can be applied retroactively.',
        'SDK retries resend the same batch. Flink keeps seen `event_id`s in keyed state for 24 hours, so a replayed hour changes nothing.',
      ],
      chaos: 'replay',
      predict: {
        question: 'A collector bug resends the last hour of events. What happens to page views?',
        options: ['They double for that hour', 'Nothing: Flink drops event ids it has already seen', 'They are lost', 'Only the OLAP store doubles'],
        answer: 1,
        explain: 'Dedup on a client-generated id in keyed state makes replays idempotent. Both outputs are written from the deduplicated stream.',
      },
    },
    {
      title: 'Lose a stream processor at peak',
      tag: 'failure',
      body: ['Kill one of the six Flink TaskManagers during the evening peak.'],
      kill: ['flink'],
      predict: {
        question: 'One of six Flink instances dies at 100 k events/s. What do dashboards see?',
        options: ['Lost events', 'A short freshness dip, then correct numbers', 'Duplicated sessions', 'Nothing at all'],
        answer: 1,
        explain: 'Flink restarts from the last checkpoint on five instances (now running hotter, at ~80%). Kafka holds the unprocessed events, so live tiles lag for a minute and then catch up.',
      },
      goodToKnow: 'Run with headroom (~60–70% at peak), so losing one instance doesn’t push the rest over capacity. Autoscaling Flink means rescaling from a savepoint, which takes minutes, not seconds.',
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        'Size it (3 B/day, 100 k/s peak, 3 TB/day raw). SDKs → stateless collectors → **Kafka** (acks=all, RF=3) → **Flink** (dedup, bot flags, enrichment, event-time sessions) → **OLAP** for live tiles and a compacted **lakehouse** + Trino for history.',
        'Name the failure modes before the interviewer does: late mobile events (event time, watermarks), retries (event-id dedup), bots (flag, don’t delete), small files (compaction), peaks (Kafka lag, headroom) and recomputation (replay from the lake).',
      ],
    },
  ],
  quiz: [
    {
      id: 'cs-q1',
      q: '3 billion events/day at ~1 KB each. Roughly what peak rate and daily raw volume do you design for?',
      options: ['3.5 k/s and 300 GB/day', '~35 k/s average, ~100 k/s peak, ~3 TB/day', '1 M/s and 30 TB/day', '350 k/s and 3 PB/day'],
      answer: 1,
      why: '3e9 / 86,400 ≈ 35 k/s on average; with a ~3× peak, about 100 k/s. 3e9 × 1 KB ≈ 3 TB/day before compression.',
    },
    {
      id: 'cs-q2',
      q: 'Why do session windows need event time?',
      options: ['They are faster', 'Mobile events arrive late and out of order; arrival-time sessions split or merge incorrectly', 'Kafka requires it', 'To save storage'],
      answer: 1,
      why: 'Session boundaries depend on gaps between when actions happened. Arrival time compresses an offline session into a burst.',
    },
    {
      id: 'cs-q3',
      q: 'Why not serve the live dashboard straight from Trino over the lakehouse?',
      options: ['Trino can’t read Iceberg', 'Freshness is bounded by commit intervals and each tile is a distributed scan taking seconds', 'It loses data', 'It doesn’t support SQL'],
      answer: 1,
      why: 'Real-time OLAP pre-aggregates and indexes for millisecond queries on seconds-fresh data. Trino is for flexible history queries.',
    },
    {
      id: 'cs-q4',
      q: 'What is the best way to handle bot traffic?',
      options: ['Drop it at the collector', 'Flag it in the stream (`is_bot`), exclude it in metrics, keep raw rows for re-classification', 'Ignore it', 'Rate-limit all users'],
      answer: 1,
      why: 'Bot rules improve over time. Deleting at ingest makes past numbers impossible to fix; flagging lets you recompute.',
    },
    {
      id: 'cs-q5',
      q: 'The collector returns HTTP 200 to the SDK. When should it do that?',
      options: ['As soon as the request is parsed', 'After the events are acknowledged by Kafka (acks=all)', 'After Flink processes them', 'After they reach the lakehouse'],
      answer: 1,
      why: 'Acknowledging after the durable write makes the SDK retry on failure (at-least-once), and dedup later turns that into exactly-once. Waiting for downstream would couple the collector to every consumer.',
    },
  ],
  challenge: {
    id: 'cs-video-qoe',
    title: 'Video streaming quality of experience',
    context:
      'A streaming service tracks playback quality: 2 million concurrent streams send a heartbeat every 30 s, plus start, stall, bitrate-switch and error events, about 80,000 events/s at peak. The ops team needs a live console of rebuffering ratio and startup time by CDN, ISP and device, to steer traffic away from a failing CDN within minutes. Data scientists need a year of history for encoding and CDN contracts.',
    workload: { eps: 80000, queryQps: 30, late: 0.05, dup: 0.02, unit: 'player event' },
    requirements: [
      req.throughput(80000, 'events'),
      req.noLoss(),
      req.lateData('Players on mobile networks flush events late. QoE per minute must use event time.'),
      req.exactlyOnce('Players resend heartbeats on reconnect. Deduplicate by `(session_id, seq)`.'),
      req.backfill('full'),
      req.queryP99(3000),
      req.has('olap', 'The ops console shows QoE per CDN/ISP within seconds', 'Minute-level rollups by CDN, ISP and device, queried live, belong in a real-time OLAP store.'),
    ],
    palette: ['events', 'mem-buffer', 'kafka', 'flink', 'spark-ss', 'spark', 'lakehouse', 'compaction', 'olap', 'warehouse', 'trino', 'app-api', 'bi', 'tiny-writer', 'proc-time'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 160, 'Player SDKs on TVs, phones and browsers: heartbeats with `session_id`, `seq`, CDN, bitrate and buffer state.'),
        N('kafka', 'kafka', X[1], 160, '3 brokers, RF=3, keyed by `session_id`.', { count: 3 }),
        N('flink', 'flink', X[2], 160, 'Dedup by `(session_id, seq)`, sessionize playback, compute per-minute rebuffer ratio and startup time by CDN/ISP/device with event-time windows.', { count: 5 }),
        N('olap', 'olap', X[3], 50, 'Druid/Pinot with minute rollups for the last 30 days.', { count: 2 }),
        N('api', 'app-api', X[4], 50, 'Ops QoE console and the CDN steering service’s alerts.'),
        N('lake', 'lakehouse', X[3], 280, 'Iceberg tables of playback sessions and events: a year of history.'),
        N('compact', 'compaction', X[2], 380, 'Compacts the minute commits into large files.'),
        N('trino', 'trino', X[4], 280, 'SQL for data scientists and CDN contract analysis.', { count: 3 }),
        N('bi', 'bi', X[5], 280, 'Notebooks and QoE trend dashboards.'),
      ],
      edges: [
        E('events', 'kafka'),
        E('kafka', 'flink'),
        E('flink', 'olap'),
        E('olap', 'api'),
        E('flink', 'lake'),
        E('compact', 'lake'),
        E('lake', 'trino'),
        E('trino', 'bi'),
      ],
    },
    wrong: {
      'mem-buffer': W.memBuffer,
      'tiny-writer': W.tinyWriter,
      'proc-time': W.procTime,
    },
    alt: {
      'spark-ss': 'Micro-batches every 30 s would also work for minute-level QoE; Flink reacts faster for CDN steering.',
      warehouse: 'A warehouse could hold the year of history instead of lakehouse + Trino.',
    },
  },
  deeper: [
    { label: 'Kafka partitions, keys and consumer lag', to: '/kafka' },
    { label: 'Modelling events and sessions as facts', to: '/data-modeling' },
  ],
};

/* ------------------------------------------------------------------ */
/* 18. Ad click aggregation                                             */
/* ------------------------------------------------------------------ */

export const adClick: Pattern = {
  id: 'ad-click',
  num: 18,
  title: 'Design ad click aggregation',
  group: 'Interview',
  tagline: 'Count clicks per ad per minute, fast enough for advertisers and exact enough to bill. Stream for speed, dedup and event time for correctness, salt for hot ads, and a batch reconciliation as the source of truth for invoices.',
  minutes: 18,
  level: 'Advanced',
  signals: [
    '"ad click aggregation" / "count events per key per minute"',
    '"used for billing": exactly-once matters',
    '"top N ads in the last M minutes"',
    'one campaign (a Super Bowl ad) dwarfs the rest',
  ],
  learn: [
    'Napkin math for a counting pipeline, and why the counts are the product',
    'Event-time tumbling windows with dedup by click id, into an idempotent sink',
    'Hot keys: two-phase (salted) aggregation',
    'Reconciliation: recompute from raw in batch and compare against the stream before invoicing',
  ],
  realWorld: [
    { who: 'Google', how: 'Photon joins ad clicks with queries exactly-once across data centres for billing; Mesa stores the aggregated ad metrics.' },
    { who: 'Uber', how: 'Uber Eats ads count impressions and clicks with Flink exactly-once from Kafka into Pinot, with idempotent upserts and record-level unique ids.' },
    { who: 'Pinterest', how: 'Real-time ad spend and pacing from Kafka and Flink, with batch jobs reconciling the totals used for billing.' },
  ],
  scenario: {
    id: 'ad-billing',
    title: 'Ad click aggregation for billing',
    context:
      'An ad network records 2.5 billion clicks a day: ~30,000/s on average and ~90,000/s at peak. Advertisers watch clicks per ad per minute on a live dashboard (300 queries/s), and the same counts become invoices at the end of the month. Duplicate clicks (double-taps, retries, click fraud) must not be billed, late clicks must count in the right minute, and during the Super Bowl one ad gets 30% of all clicks.',
    workload: { eps: 90000, queryQps: 300, late: 0.02, dup: 0.02, skew: 0.3, unit: 'click' },
    requirements: [
      req.exactlyOnce('Clicks are retried and replayed. Dedup by `click_id` in keyed state, and write minute counts idempotently.'),
      req.throughput(90000, 'clicks', 'Watch the processor during the Super Bowl: one ad holds 30% of the clicks. More instances don’t help a single key; spread it.'),
      req.lateData('Clicks are logged by edge servers and arrive late. Count them in the minute they happened.'),
      req.queryP99(200, 'Advertisers query per-ad, per-minute counts 300 times a second: a real-time OLAP store or a key-value table, not a warehouse.'),
      req.chaos('replay', 'A replayed hour of clicks never bills an advertiser twice', 'Something on every path must deduplicate by `click_id`.'),
      req.backfill('full', 'Keep raw clicks so a billing dispute or a fraud-rule change can be recomputed.'),
      req.edge('lakehouse', 'spark', 'A daily batch job recomputes counts from raw clicks and reconciles them with the stream before invoicing', 'Archive raw clicks independently of the streaming job, and recompute per ad per day in batch.'),
    ],
    palette: ['events', 'mem-buffer', 'kafka', 'salt', 'flink', 'spark-ss', 'spark', 'airflow', 'lakehouse', 'olap', 'kv', 'warehouse', 'app-api', 'reverse-etl', 'append-sink', 'proc-time'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 170, 'The click redirect service logs each click with a unique `click_id`, `ad_id`, `event_time`, user and IP, then sends the browser on to the advertiser.'),
        N('kafka', 'kafka', X[1], 170, '3 brokers, RF=3, acks=all, idempotent producers. Raw clicks are retained 7 days as the replay buffer.', { count: 3 }),
        N('salt', 'salt', X[2], 60, 'Phase 1 of a two-phase aggregation: clicks are pre-aggregated per `(ad_id, salt 0..15, minute)`, so the Super Bowl ad is spread over 16 sub-keys instead of one instance.', { label: 'Salted pre-aggregation' }),
        N('flink', 'flink', X[3], 60, 'Dedup by `click_id` (keyed state, 1 h TTL), filter invalid clicks, then 1-minute event-time tumbling windows per ad with a 2 min watermark; phase 2 merges the salted partials. Checkpoints every 30 s.', { count: 6 }),
        N('olap', 'olap', X[4], 60, 'Pinot with upsert on `(ad_id, minute)`: re-emitted windows overwrite rather than add. Serves per-ad minute counts and top-N queries in tens of ms.', { count: 2 }),
        N('api', 'app-api', X[5], 60, 'Advertiser dashboard and the budget pacing service.'),
        N('lake', 'lakehouse', X[2], 290, 'Raw clicks archived straight from Kafka (Kafka Connect Iceberg sink), independent of the streaming job: the evidence for billing and disputes.', { label: 'Raw clicks (Iceberg)' }),
        N('spark', 'spark', X[3], 290, 'Daily reconciliation: dedup and fraud-filter the day’s raw clicks, count per ad, compare with the stream’s totals, and alert on differences over 0.1%. The batch result is what gets billed.', { label: 'Daily reconciliation' }),
        N('af', 'airflow', X[3], 400, 'Runs reconciliation once late clicks have settled (D+1 06:00), with retries, SLAs, and reruns of any day for disputes.'),
        N('wh', 'warehouse', X[4], 290, 'The billing ledger: reconciled clicks per ad per day, immutable once invoiced.', { label: 'Billing ledger' }),
        N('retl', 'reverse-etl', X[5], 290, 'Syncs reconciled totals to the invoicing system.', { label: 'Invoicing sync' }),
      ],
      edges: [
        E('events', 'kafka', 'acks=all with an idempotent producer.'),
        E('kafka', 'salt'),
        E('salt', 'flink', 'Partial counts per salted key, merged per ad.'),
        E('flink', 'olap', 'Upsert minute counts by `(ad_id, minute)`: idempotent on replay.'),
        E('olap', 'api'),
        E('kafka', 'lake', 'A separate, simple archiver: a bug in the streaming job can’t corrupt the raw evidence.'),
        E('lake', 'spark'),
        E('af', 'spark'),
        E('spark', 'wh', 'Overwrite the day’s partition: reruns are idempotent.'),
        E('wh', 'retl'),
      ],
    },
    wrong: {
      'append-sink': W.appendSink,
      'proc-time': {
        why: `${W.procTime.why} For billing, a backlog after an outage would put 20 minutes of clicks into one minute, and a replay would produce different invoices.`,
        instead: W.procTime.instead,
      },
      'mem-buffer': W.memBuffer,
    },
    alt: {
      kv: 'The classic interview answer stores minute counts in Cassandra/DynamoDB keyed by `(ad_id, minute)`. Fine for per-ad lookups; an OLAP store also answers top-N and slice-and-dice queries.',
      'spark-ss': 'Structured Streaming with `dropDuplicates(click_id)` and 1-minute windows works too, with ~30 s extra latency.',
    },
  },
  extras: {
    nodes: [N('naive', 'append-sink', X[3], 170, 'The naive counter: for each click, `UPDATE ad_minute SET clicks = clicks + 1`.', { label: 'Counter service (+1 per click)' })],
    edges: [E('kafka', 'naive'), E('naive', 'olap'), E('kafka', 'flink', undefined, 'salt')],
  },
  guided: [
    {
      title: 'Size it, then count naively',
      tag: 'problem',
      body: [
        '2.5 B clicks/day ÷ 86,400 ≈ **30 k/s** on average; at a 3× peak, **90 k/s**. At ~200 bytes per click that is only ~0.5 TB/day raw. The hard part isn’t volume, it’s that **the counts are money**.',
        'The naive design: a consumer does `clicks = clicks + 1` per message and commits offsets afterwards.',
      ],
      add: ['events', 'kafka', 'naive', 'olap', 'api'],
      chaos: 'replay',
      predict: {
        question: 'A consumer rebalance re-delivers the last 5 minutes of clicks to the counter service. What happens to the invoice?',
        options: ['Nothing, Kafka delivers exactly once', 'Those clicks are counted twice and billed twice', 'They are dropped', 'The counter rejects duplicates'],
        answer: 1,
        explain: '`+1` is not idempotent. Every redelivery, retry and replay adds again. It also can’t keep up: one row update per click is far below 90 k/s.',
      },
    },
    {
      title: 'Windows, dedup and checkpoints',
      tag: 'technique',
      body: [
        'Replace the counter with **Flink**. It keeps recently seen `click_id`s in keyed state (1 h TTL) and drops repeats, then counts per ad in **1-minute event-time tumbling windows**. Checkpoints snapshot offsets, dedup state and open windows together.',
        'Each window emits `(ad_id, minute, count)`, **upserted** into the OLAP store, so a window re-emitted after a restart overwrites instead of adding.',
        'Look at the processor, though: one instance is overloaded.',
      ],
      add: ['flink'],
      remove: ['naive'],
      chaos: 'replay',
      keyIdea: 'Make the operation idempotent, not the delivery. Dedup by a business id, and write results as upserts keyed by (ad, minute).',
    },
    {
      title: 'The Super Bowl ad',
      tag: 'failure',
      body: [
        'Keying by `ad_id` sends every click for an ad to one Flink subtask. When one ad gets 30% of all clicks, that subtask receives 27 k clicks/s while the other five idle. It falls behind, and Kafka lag grows for every ad sharing it.',
        'Fix it with **two-phase aggregation**: append a salt (`ad_id#0..15`), count per salted key and minute, then merge the 16 partial counts per ad. Counts are decomposable (sum of partial sums), so the result is identical.',
      ],
      add: ['salt'],
      predict: {
        question: 'One ad holds 30% of clicks and its subtask is at 108%. What fixes it?',
        options: ['Double the Flink instances', 'Salt the key and aggregate in two phases', 'Increase Kafka partitions only', 'Drop clicks for that ad'],
        answer: 1,
        explain: 'More instances don’t split a single key. Salting spreads the key over N subtasks; the merge stage only receives N partial counts per minute.',
      },
      goodToKnow: 'Flink SQL does this with `table.optimizer.agg-phase-strategy = TWO_PHASE` plus mini-batch, and distinct counts with `distinct-agg.split.enabled`.',
    },
    {
      title: 'Crash in the middle of a window',
      tag: 'failure',
      body: [
        'A TaskManager is killed while windows are open. Flink restores offsets, dedup state and partial windows from the last checkpoint and re-reads from Kafka. Windows already emitted may be emitted again, and the upsert makes that harmless.',
      ],
      chaos: 'crash',
      predict: {
        question: 'The job crashes 20 s after the last checkpoint and restarts. What happens to the counts for that minute?',
        options: ['They lose 20 s of clicks', 'They are double-counted', 'They are correct: state rewinds with the offsets and the sink upserts', 'The minute is skipped'],
        answer: 2,
        explain: 'Replayable source + consistent checkpoint + idempotent sink = exactly-once effects, as in the exactly-once pattern.',
      },
    },
    {
      title: 'Reconcile before you invoice',
      tag: 'tradeoff',
      body: [
        'Streaming counts are fast and very good, but invoices need a number you can defend. Archive raw clicks straight from Kafka into Iceberg with a separate, simple job, so a streaming bug can’t touch the evidence.',
        'Every day at 06:00, once late clicks have settled, **Spark** recomputes clicks per ad from raw, with the same dedup and fraud rules, and compares them with the stream’s totals. Differences over 0.1% raise an alert. The batch result goes into the billing ledger and on to invoicing.',
      ],
      add: ['lake', 'spark', 'af', 'wh', 'retl'],
      keyIdea: 'The stream gives advertisers speed; the batch gives finance truth. Reconciliation is how you find bugs in either one before a customer does.',
      goodToKnow: 'This is a pragmatic lambda architecture: the batch layer exists to verify and correct, not to duplicate every feature. If the stream and batch disagree often, fix the stream rather than living with two numbers.',
    },
    {
      title: 'Late clicks',
      tag: 'failure',
      body: [
        'An edge region loses connectivity, and its clicks arrive 4 minutes late. The watermark (2 minutes) has already closed those windows.',
        'Allowed lateness (say 10 minutes) keeps windows updatable, and the upsert writes the corrected count. Anything later goes to a side output; the daily reconciliation counts it anyway, because it recomputes the whole day from raw.',
      ],
      chaos: 'late',
      predict: {
        question: 'A click from 12:03 arrives at 12:09, after the window closed. Where does it end up?',
        options: ['In the 12:09 window', 'Dropped forever', 'In the 12:03 window (allowed lateness) and certainly in the daily reconciled total', 'It doubles the 12:03 count'],
        answer: 2,
        explain: 'Event time puts it in 12:03. Allowed lateness updates that window; anything beyond is still covered by the batch recomputation.',
      },
    },
    {
      title: 'Duplicate and fraudulent clicks',
      tag: 'technique',
      body: [
        'Not every unique click is billable. Industry rules separate **invalid traffic**: obvious bots and data-centre IPs (general), and sophisticated patterns like click farms (needs models). A simple, auditable rule set runs in Flink: the same user and ad within 30 s counts once; known bad IPs and user agents are excluded.',
        'Invalid clicks are flagged, not deleted, so advertisers can see what was filtered and why, and the batch job can apply improved rules to past days.',
      ],
      chaos: 'replay',
    },
    {
      title: 'Lose a stream processor',
      tag: 'failure',
      body: ['Kill one of the six Flink instances at peak.'],
      kill: ['flink'],
      predict: {
        question: 'One of six Flink instances dies at 90 k clicks/s. What do advertisers see?',
        options: ['Missing clicks', 'Double-billed clicks', 'Counts a few seconds behind, then correct', 'An empty dashboard'],
        answer: 2,
        explain: 'The survivors restore from the checkpoint and catch up from Kafka; salting keeps the load even across the five that remain (~72% each).',
      },
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        'Clicks → **Kafka** (RF=3, idempotent producer) → **salted pre-aggregation** → **Flink** (dedup by `click_id`, invalid-click rules, 1-min event-time windows, checkpoints) → **OLAP upserts** for advertisers. In parallel: raw clicks → **Iceberg** → daily **Spark reconciliation** → billing ledger → invoicing.',
        'Interview talking points: napkin math, why counts must be idempotent, watermark vs allowed lateness, hot-ad salting, and why billing comes from the reconciled batch.',
      ],
    },
  ],
  quiz: [
    {
      id: 'ad-q1',
      q: 'Why is `UPDATE … SET clicks = clicks + 1` per click wrong for billing?',
      options: ['SQL is slow', 'It is not idempotent: retries and replays add again', 'It loses precision', 'It needs a warehouse'],
      answer: 1,
      why: 'At-least-once delivery plus a non-idempotent write double counts. Dedup by id and upsert per window instead.',
    },
    {
      id: 'ad-q2',
      q: 'One ad gets 30% of clicks. What does salting change?',
      options: ['It removes the ad’s clicks', 'It spreads the ad over N sub-keys for partial counts, then merges them', 'It adds Kafka brokers', 'It changes the window size'],
      answer: 1,
      why: 'Two-phase aggregation works for decomposable aggregates like counts and sums. The merge stage handles N small partials per minute.',
    },
    {
      id: 'ad-q3',
      q: 'Why archive raw clicks from Kafka with a separate job rather than from the Flink aggregation job?',
      options: ['It is cheaper', 'So a bug in the streaming logic can’t corrupt the evidence used to reconcile it', 'Flink can’t write Iceberg', 'Kafka requires it'],
      answer: 1,
      why: 'Reconciliation only finds bugs if its input is independent of the system being checked.',
    },
    {
      id: 'ad-q4',
      q: 'What is the difference between the watermark and allowed lateness?',
      options: ['None', 'The watermark decides when a window first fires; allowed lateness keeps it updatable for late events afterwards', 'Allowed lateness is for processing time', 'The watermark drops duplicates'],
      answer: 1,
      why: 'Fire early for freshness, then update with late data until the lateness bound; anything later goes to a side output.',
    },
    {
      id: 'ad-q5',
      q: 'Which number should go on the invoice?',
      options: ['The real-time count at midnight', 'The reconciled daily batch count from raw clicks, after late data has settled', 'The maximum of both', 'The advertiser’s own count'],
      answer: 1,
      why: 'The batch recomputation sees all late data, applies the final fraud rules and is reproducible on demand for disputes.',
    },
  ],
  challenge: {
    id: 'ad-video-views',
    title: 'Video view counts',
    context:
      'A video platform shows a live view count on every watch page (20,000 lookups/s) and pays creators from verified daily views. 120,000 view events/s at peak; a single music-video premiere can hold 25% of all views. Refresh spam and bots must not count, and creator payouts must be reproducible when a creator disputes them.',
    workload: { eps: 120000, queryQps: 20000, late: 0.02, dup: 0.05, skew: 0.25, unit: 'view' },
    requirements: [
      req.exactlyOnce('Refreshes, retries and replays resend views. Dedup by view id and write counts idempotently.'),
      req.throughput(120000, 'views', 'A premiere holds 25% of the views. Spread the hot key before the keyed aggregation.'),
      req.queryP99(20, 'Watch pages look up one video’s count by key: a key-value store in milliseconds.'),
      req.lateData(),
      req.chaos('replay', 'A replayed hour of views doesn’t inflate counts or payouts', 'Deduplicate by view id on every path.'),
      req.backfill('full'),
      req.edge('lakehouse', 'spark', 'Daily payouts are recomputed from raw views and reconciled with the live counts', 'Archive raw views and run a daily batch verification.'),
    ],
    palette: ['events', 'mem-buffer', 'kafka', 'salt', 'flink', 'spark-ss', 'spark', 'airflow', 'lakehouse', 'olap', 'kv', 'warehouse', 'app-api', 'reverse-etl', 'append-sink', 'proc-time'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 170, 'Players emit a view event once playback passes the qualifying threshold, with a `view_id`.'),
        N('kafka', 'kafka', X[1], 170, '3 brokers, RF=3.', { count: 3 }),
        N('salt', 'salt', X[2], 60, 'Pre-aggregates per `(video_id, salt)` so a premiere spreads across subtasks.', { label: 'Salted pre-aggregation' }),
        N('flink', 'flink', X[3], 60, 'Dedup by `view_id`, spam rules (same viewer and video within a short window), per-video running totals in event time.', { count: 8 }),
        N('kv', 'kv', X[4], 60, '`video_id → views`, upserted every few seconds and read by watch pages in ~5 ms.'),
        N('api', 'app-api', X[5], 60, 'Watch pages and creator studio live counters.'),
        N('lake', 'lakehouse', X[2], 290, 'Raw views archived from Kafka by a separate sink.', { label: 'Raw views (Iceberg)' }),
        N('spark', 'spark', X[3], 290, 'Daily verification: dedup, apply the full spam/bot models, count per video, reconcile with live totals.', { label: 'Daily verification' }),
        N('af', 'airflow', X[3], 400, 'Schedules verification after late data settles; reruns disputed days.'),
        N('wh', 'warehouse', X[4], 290, 'Verified views per video per day: the basis for creator payouts.', { label: 'Verified views ledger' }),
        N('retl', 'reverse-etl', X[5], 290, 'Sends verified totals to the payouts system.', { label: 'Payout sync' }),
      ],
      edges: [
        E('events', 'kafka'),
        E('kafka', 'salt'),
        E('salt', 'flink'),
        E('flink', 'kv', 'Upsert the running total per video.'),
        E('kv', 'api'),
        E('kafka', 'lake'),
        E('lake', 'spark'),
        E('af', 'spark'),
        E('spark', 'wh'),
        E('wh', 'retl'),
      ],
    },
    wrong: {
      'append-sink': W.appendSink,
      'proc-time': W.procTime,
      'mem-buffer': W.memBuffer,
    },
    alt: {
      olap: 'An OLAP store could serve per-video counts too, and adds slice-and-dice for creator analytics. For 20,000 single-key lookups/s, a KV store is simpler.',
      'spark-ss': 'Micro-batch streaming works if counts may lag ~30 s.',
    },
  },
  deeper: [{ label: 'Kafka idempotent producers and exactly-once semantics', to: '/kafka' }],
};

/* ------------------------------------------------------------------ */
/* 19. Log analytics                                                    */
/* ------------------------------------------------------------------ */

export const logAnalytics: Pattern = {
  id: 'log-analytics',
  num: 19,
  title: 'Design log analytics at scale',
  group: 'Interview',
  tagline: 'Logs are huge, bursty and mostly never read. Buffer them in a log, index only recent data in a search cluster, keep the rest cheaply in object storage, and decide what deserves indexing at all.',
  minutes: 15,
  level: 'Intermediate',
  signals: [
    '"centralised logging" / "design Splunk / ELK / Datadog logs"',
    '"hundreds of thousands of lines per second"',
    '"keep logs for a year for compliance" alongside "search the last hour fast"',
    '"our Elasticsearch bill is out of control"',
  ],
  learn: [
    'Napkin math for logs: lines/s → MB/s → TB/day, and what retention does to it',
    'Kafka as the shock absorber for incident log storms',
    'Hot (search index) vs cold (Parquet in a lakehouse, queried with Trino) tiers',
    'Sampling, routing and retention tiers: cost is a design input',
  ],
  realWorld: [
    { who: 'Uber', how: 'Moved its log analytics from Elasticsearch to ClickHouse to cut cost and handle schema-agnostic logs at petabyte scale.' },
    { who: 'Cloudflare', how: 'Ingests tens of millions of log events per second into ClickHouse and ships customer logs to object storage with Logpush.' },
    { who: 'Grafana Labs', how: 'Loki indexes only labels and keeps log content as compressed chunks in object storage, trading query speed for a far smaller index.' },
  ],
  scenario: {
    id: 'logs-platform',
    title: 'Central log platform for 5,000 services',
    context:
      '5,000 hosts run Fluent Bit agents. Normal volume is 100,000 log lines/s (~500 bytes each, so ~50 MB/s and ~4.3 TB/day); during incidents it triples. On-call engineers need full-text search over the last 7 days within seconds of a line being written. Security and compliance need 13 months, queryable by SQL. The budget is $15k/month.',
    workload: { eps: 100000, queryQps: 20, late: 0.02, unit: 'log line' },
    requirements: [
      req.throughput(100000, 'log lines'),
      req.noLoss('Agents buffer only a few MB. Put a replicated log between them and indexing, so a slow index doesn’t drop lines.'),
      req.has('search', 'On-call can full-text search the last 7 days within seconds of a line being written', 'Free-text search over recent logs needs an inverted index (Elasticsearch/OpenSearch), with a short retention.'),
      req.backfill('full', 'Compliance needs 13 months of logs you can re-query or re-index: keep them in object storage.'),
      req.queryP99(3000, 'Month-long investigations scan the cold tier. Keep it in compacted columnar files.'),
      req.noSpof('Kill each node in turn: the log needs 3 brokers and the index at least 2 nodes.'),
      req.cost(15000, 'Indexing everything for a year needs hundreds of search nodes. Keep the index small and short; put history in object storage.'),
    ],
    palette: ['logs', 'mem-buffer', 'kafka', 'flink', 'spark-ss', 'spark', 'search', 'olap', 'object-store', 'lakehouse', 'compaction', 'trino', 'bi', 'tiny-writer', 'raw-files'],
    reference: {
      nodes: [
        N('logs', 'logs', X[0], 170, 'Fluent Bit / Vector agents tail files and container stdout, add host and service labels, and ship batches with a small on-disk buffer.', { label: 'Agents on 5,000 hosts' }),
        N('kafka', 'kafka', X[1], 170, '3 brokers, RF=3, ~50 MB/s in with lz4/zstd compression; 3 days of retention covers a weekend outage of either sink.', { count: 3 }),
        N('flink', 'flink', X[2], 170, 'Parses JSON and common formats, adds Kubernetes metadata, redacts secrets and PII, and routes: everything to the cold tier; errors, warnings and sampled info lines to the index.', { label: 'Parse, enrich, redact, route', count: 6 }),
        N('search', 'search', X[3], 60, 'OpenSearch hot tier: daily indices, 7 days, 1 replica. ~10 data nodes hold ~60 TB; ILM deletes whole indices, which is cheap.', { label: 'Search · hot (7 days)', count: 10 }),
        N('oncall', 'bi', X[5], 60, 'Kibana / Grafana for on-call: free-text search and live tail.', { label: 'Log explorer' }),
        N('lake', 'lakehouse', X[3], 290, 'Iceberg tables of every log line as Parquet in S3, partitioned by day and service: ~10× compression, ~0.4 TB/day, ~170 TB for 13 months.', { label: 'Cold tier (13 months)' }),
        N('compact', 'compaction', X[2], 390, 'Rewrites the minute commits into ~512 MB files sorted by service and level, and expires snapshots; also enforces the 13-month retention.'),
        N('trino', 'trino', X[4], 290, 'SQL over months of logs for incident reviews, security investigations and audits.', { count: 2 }),
        N('analysts', 'bi', X[5], 290, 'Security and SRE notebooks and SQL dashboards.', { label: 'SQL investigations' }),
      ],
      edges: [
        E('logs', 'kafka', 'Agents produce with acks=all; Kafka absorbs incident bursts.'),
        E('kafka', 'flink'),
        E('flink', 'search', 'Bulk-index the routed subset with a document id, so retries overwrite rather than duplicate.'),
        E('flink', 'lake', 'Everything, as columnar Parquet, committed every minute.'),
        E('compact', 'lake'),
        E('search', 'oncall'),
        E('lake', 'trino'),
        E('trino', 'analysts'),
      ],
    },
    wrong: {
      'mem-buffer': W.memBuffer,
      'tiny-writer': W.tinyWriter,
      'raw-files': {
        why: 'Gzipped JSON in date folders is a common start (CloudTrail does it), but every query decompresses and parses text, there is no schema or statistics to prune with, and half-written files are visible. Month-long scans take minutes.',
        instead: 'Columnar Parquet in a table format (Iceberg), compacted, queried with Trino.',
      },
    },
    alt: {
      olap: 'ClickHouse is a popular alternative to Elasticsearch for logs (Uber, Cloudflare): columnar compression makes it much cheaper per TB, with token/bloom-filter indexes for text search instead of a full inverted index.',
      'object-store': 'Plain Parquet in S3 queried by Athena is a valid cold tier, but without a table format you lose atomic commits and compaction is harder, so queries over many small files are slower.',
      'spark-ss': 'Structured Streaming can parse and route too, adding ~30 s of latency to search.',
    },
  },
  extras: {
    nodes: [N('esall', 'search', X[3], 170, 'The naive design: every agent ships straight to one Elasticsearch cluster that keeps everything for a year.', { label: 'Elasticsearch · everything, 1 year', count: 8 })],
    edges: [E('logs', 'esall', undefined, 'kafka'), E('flink', 'esall'), E('esall', 'oncall')],
  },
  guided: [
    {
      title: 'Napkin math, and the naive cluster',
      tag: 'problem',
      body: [
        '100 k lines/s × 500 B = **50 MB/s ≈ 4.3 TB/day** raw. An inverted index with one replica stores roughly 2× that: ~9 TB/day. Keeping a year in the index means ~3 PB on SSD-backed nodes, hundreds of them.',
        'The naive design ships every agent straight to one Elasticsearch cluster and keeps everything. Eight nodes keep up with normal traffic, just about, and the bill grows every day as retention fills up.',
      ],
      add: ['logs', 'esall', 'oncall'],
      predict: {
        question: 'What drives the size (and cost) of a log search cluster that keeps a year of data?',
        options: ['Query volume', 'Ingest rate only', 'Retained, indexed bytes: retention × daily volume × index overhead × replicas', 'The number of services'],
        answer: 2,
        explain: 'Ingest sets a minimum node count, but retention multiplies storage. A year of indexed logs is ~50× the size of 7 days.',
      },
    },
    {
      title: 'An incident is a log storm',
      tag: 'failure',
      body: [
        'A bad deploy makes every service log stack traces in a loop: volume triples exactly when on-call needs logs most. Indexing is CPU-heavy, the cluster saturates, bulk requests are rejected, and the agents’ small buffers overflow.',
      ],
      traffic: 3,
      predict: {
        question: 'Volume triples during an incident and agents send directly to the saturated cluster. What happens to the lines?',
        options: ['They are indexed late', 'Agents’ buffers fill and lines are dropped: the logs from the incident itself go missing', 'Elasticsearch scales automatically', 'Nothing changes'],
        answer: 1,
        explain: 'With nothing durable between agents and the index, overload means loss. The most important logs of the year are the ones you lose.',
      },
    },
    {
      title: 'Kafka absorbs the storm',
      tag: 'technique',
      body: [
        'Put **Kafka** between agents and indexing, with a **Flink** job that parses, enriches with service metadata and redacts secrets. Now a burst becomes consumer lag in Kafka, not lost lines, and the indexer catches up when the storm passes.',
        'Decoupling also lets several consumers read the same logs: the index, a cold archive, a security detection job.',
      ],
      add: ['kafka', 'flink'],
      traffic: 1.5,
      predict: {
        question: 'Traffic is 1.5× and the search cluster can’t keep up. What happens now?',
        options: ['Lines are dropped', 'Search falls behind (lag), but nothing is lost and it catches up', 'Kafka rejects producers', 'Duplicates appear in search'],
        answer: 1,
        explain: 'The durable log in front of the slow consumer turns overload into delay. Size Kafka retention to cover the longest outage of any sink.',
      },
    },
    {
      title: 'Hot and cold tiers',
      tag: 'tradeoff',
      body: [
        'Most log lines are never read, and almost all searches cover the last few days. So split by age. **Hot:** a search cluster with 7 days of daily indices, the only data on SSD. **Cold:** every line as Parquet in an Iceberg table on S3, ~10× smaller than the raw text, at ~$23/TB-month. Trino queries it by SQL when an investigation needs last March.',
        'The index shrinks from a year to a week, and the cold tier costs a few thousand dollars a month for 13 months.',
      ],
      add: ['search', 'lake', 'trino', 'analysts'],
      remove: ['esall'],
      chaos: 'smallfiles',
      keyIdea: 'Match storage to access patterns: an expensive index for the hot, frequently searched window, and cheap columnar storage for long, rarely read history.',
    },
    {
      title: 'Compact the cold tier',
      tag: 'technique',
      body: [
        'Six Flink writers commit every minute, so the cold table gathers thousands of small files a day and investigations over a month crawl. **Compaction** rewrites them into ~512 MB files sorted by service and level, so Trino reads only the row groups it needs. The same maintenance job drops partitions older than 13 months.',
      ],
      add: ['compact'],
      chaos: 'smallfiles',
      predict: {
        question: 'A security analyst scans 30 days of auth logs for one IP. What makes that fast in the cold tier?',
        options: ['More Kafka partitions', 'Large compacted Parquet files, partition pruning by day and column statistics', 'A bigger search cluster', 'Raw JSON files'],
        answer: 1,
        explain: 'Columnar files with min/max statistics let Trino skip most data. Small files and text formats force it to open and parse everything.',
      },
    },
    {
      title: 'Sampling, routing and retention tiers',
      tag: 'tradeoff',
      body: [
        'Not every line deserves an index. Route by value: errors and warnings 100% to search; info lines from noisy services sampled (say 10%); health checks and debug never indexed. **Everything** still goes to the cold tier, so nothing is truly lost.',
        'Turn high-volume, repetitive logs into **metrics** (requests per status code) instead of indexing them. Set retention per tier and per class: 7 days hot, 13 months cold, longer only for audit logs under legal hold.',
      ],
      keyIdea: 'Log cost is mostly a product decision: what to index, for how long, at what sampling rate. Write it down as a policy per log class.',
      goodToKnow: 'Elasticsearch ILM can add warm/cold/frozen phases with searchable snapshots on S3. That is a middle ground: slower searches over older data, without a separate SQL stack.',
    },
    {
      title: 'Lose a search node',
      tag: 'failure',
      body: ['Kill one of the ten search data nodes.'],
      kill: ['search'],
      predict: {
        question: 'One of ten search nodes dies. What happens?',
        options: ['Recent logs are lost', 'Replicas take over, shards re-replicate in the background, and searches keep working', 'Search is down until it’s replaced', 'Kafka stops'],
        answer: 1,
        explain: 'With one replica per shard, every shard still has a copy. Indexing continues on the survivors (now ~74% busy), and Kafka buffers if they slow down.',
      },
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        'Agents → **Kafka** (the shock absorber) → **Flink** (parse, enrich, redact, route, sample) → **search** for 7 hot days and a compacted **lakehouse** for 13 cold months, queried with **Trino**.',
        'In the interview, lead with the napkin math (MB/s, TB/day, retained TB), then show that retention and indexing policy, not ingest, drive cost.',
      ],
    },
  ],
  quiz: [
    {
      id: 'log-q1',
      q: '100,000 lines/s at 500 bytes. Roughly how much raw data per day?',
      options: ['430 GB', '4.3 TB', '43 TB', '430 TB'],
      answer: 1,
      why: '100 k × 500 B = 50 MB/s; × 86,400 s ≈ 4.3 TB/day.',
    },
    {
      id: 'log-q2',
      q: 'Why put Kafka between log agents and Elasticsearch?',
      options: ['Kafka indexes logs', 'It buffers bursts and sink outages durably, so overload becomes lag instead of loss', 'It compresses logs to zero', 'Elasticsearch requires it'],
      answer: 1,
      why: 'Agents have tiny buffers. A replicated log decouples producers from slower consumers and allows several consumers.',
    },
    {
      id: 'log-q3',
      q: 'What usually dominates the cost of a log search cluster?',
      options: ['The number of dashboards', 'Indexed bytes retained (retention × volume × replicas)', 'The number of hosts', 'Kafka partitions'],
      answer: 1,
      why: 'Storage on index nodes scales with retention. Moving older data to object storage cuts most of it.',
    },
    {
      id: 'log-q4',
      q: 'Which sampling policy is most sensible?',
      options: ['Sample errors at 1%', 'Index all errors, sample noisy info logs, archive 100% to cheap storage', 'Drop all info logs everywhere', 'Index everything forever'],
      answer: 1,
      why: 'Keep what you need for debugging fully indexed, reduce the noise, and keep a complete cheap archive for investigations.',
    },
  ],
  challenge: {
    id: 'logs-siem',
    title: 'Security analytics (SIEM)',
    context:
      'A security team collects CloudTrail, VPC flow, authentication and endpoint logs: 60,000 events/s. Analysts must hunt across the last 30 days interactively, detections must run in near real time, and regulators require a year of logs to be kept and queryable. The SIEM vendor’s ingest-based pricing is $40k/month; the target is under $10k.',
    workload: { eps: 60000, queryQps: 10, late: 0.03, unit: 'security event' },
    requirements: [
      req.throughput(60000, 'events'),
      req.noLoss('A dropped log line during an attack is evidence you no longer have.'),
      req.has('search', 'Analysts hunt interactively over the last 30 days', 'Interactive free-text hunting over recent data needs a search index.'),
      req.backfill('full'),
      req.queryP99(3000),
      req.cost(10000),
      req.chaos('outage', 'A collector outage delays logs but never loses them', 'Agents buffer only briefly; the log must absorb the catch-up.'),
    ],
    palette: ['logs', 'mem-buffer', 'kafka', 'flink', 'spark-ss', 'search', 'olap', 'object-store', 'lakehouse', 'compaction', 'trino', 'warehouse', 'bi', 'tiny-writer', 'raw-files'],
    reference: {
      nodes: [
        N('logs', 'logs', X[0], 170, 'CloudTrail, VPC flow, IdP and EDR logs shipped by collectors.', { label: 'Security log sources' }),
        N('kafka', 'kafka', X[1], 170, '3 brokers, RF=3; 7 days of retention.', { count: 3 }),
        N('flink', 'flink', X[2], 170, 'Normalises every source to one schema (OCSF), enriches with asset and identity data, and runs streaming detection rules.', { count: 4 }),
        N('search', 'search', X[3], 60, 'Hot tier: 30 days for interactive hunting.', { label: 'Search · hot (30 days)', count: 6 }),
        N('soc', 'bi', X[4], 60, 'SOC console: alerts and hunting.', { label: 'SOC console' }),
        N('lake', 'lakehouse', X[3], 290, 'A security data lake: one year of normalised events in Iceberg.', { label: 'Cold tier (1 year+)' }),
        N('compact', 'compaction', X[2], 390, 'Compaction and retention enforcement.'),
        N('trino', 'trino', X[4], 290, 'SQL for long-range investigations and audits.'),
        N('hunt', 'bi', X[5], 290, 'Threat-hunting notebooks and compliance reports.', { label: 'Investigations' }),
      ],
      edges: [
        E('logs', 'kafka'),
        E('kafka', 'flink'),
        E('flink', 'search'),
        E('flink', 'lake'),
        E('compact', 'lake'),
        E('search', 'soc'),
        E('lake', 'trino'),
        E('trino', 'hunt'),
      ],
    },
    wrong: {
      'mem-buffer': W.memBuffer,
      'tiny-writer': W.tinyWriter,
      'raw-files': W.rawFiles,
    },
    alt: {
      olap: 'ClickHouse could replace the search cluster for hunting, at lower cost per TB.',
      warehouse: 'Some teams use Snowflake as the security data lake; check the usage-based cost at 60,000 events/s against the budget.',
    },
  },
  deeper: [{ label: 'Kafka retention, compression and consumer lag', to: '/kafka' }],
};

export const INTERVIEW_PATTERNS: Pattern[] = [clickstream, adClick, logAnalytics];
