import type { IncidentCase } from '../types';

export const INCIDENTS: IncidentCase[] = [
  /* ------------------------------------------------------------------ */
  {
    id: 'inc-revenue-doubled',
    title: 'The revenue dashboard doubled overnight',
    severity: 'SEV2',
    alert: 'PAGE (manual, from the CFO’s chief of staff): "Exec dashboard shows $9.0M net revenue for Nov 24. Is that real? Board deck goes out at 10:00."',
    context:
      'An e-commerce company streams `order_placed` events (6,000/s at peak) from checkout into Kafka. A loader service consumes them and INSERTs rows into `raw.orders` in Snowflake. A dbt incremental model (no `unique_key`, filtered on `loaded_at`) builds `marts.fct_revenue` at 02:00, and the exec dashboard reads it. Yesterday a loader bug wrote `discount_amount = 0` for every order for about 9 hours; the fix shipped at 22:40.',
    workload: { eps: 6000, queryQps: 4, dup: 0.002, unit: 'order event' },
    patterns: ['dedup-idempotent', 'exactly-once', 'data-quality'],
    graph: {
      nodes: [
        { id: 'events', kind: 'events', label: 'Checkout service', x: 0, y: 140 },
        { id: 'kafka', kind: 'kafka', label: 'Kafka: orders', count: 3, x: 190, y: 140 },
        { id: 'loader', kind: 'append-sink', label: 'Order loader (JDBC INSERT)', count: 2, x: 380, y: 140 },
        { id: 'raw', kind: 'warehouse', label: 'raw.orders', x: 570, y: 140 },
        { id: 'dbt', kind: 'dbt', label: 'dbt: fct_revenue (incremental)', x: 760, y: 140 },
        { id: 'mart', kind: 'warehouse', label: 'marts.fct_revenue', x: 950, y: 140 },
        { id: 'bi', kind: 'bi', label: 'Exec revenue dashboard', x: 1140, y: 140 },
        { id: 'af', kind: 'airflow', label: 'Airflow (02:00)', x: 760, y: 320 },
      ],
      edges: [
        { from: 'events', to: 'kafka' },
        { from: 'kafka', to: 'loader' },
        { from: 'loader', to: 'raw' },
        { from: 'raw', to: 'dbt' },
        { from: 'dbt', to: 'mart' },
        { from: 'mart', to: 'bi' },
        { from: 'af', to: 'dbt' },
      ],
    },
    inject: { chaos: 'replay' },
    timeline: [
      { t: 'Nov 24 13:20', event: 'Loader v4.2 deployed. A field-mapping change writes `discount_amount` as 0 for every order.' },
      { t: 'Nov 24 22:40', event: 'Bug found and fixed. Net revenue for 13:20-22:40 is overstated in `raw.orders`.' },
      { t: 'Nov 24 23:05', event: 'On-call "replays the day": `kafka-consumer-groups --reset-offsets --to-datetime 2026-11-24T00:00` on the loader’s group.' },
      { t: 'Nov 25 00:10', event: 'Loader catches up. Every Nov 24 order is now in `raw.orders` twice: the original row and the corrected one.' },
      { t: 'Nov 25 02:00', event: 'dbt incremental run succeeds. It picks up everything with `loaded_at` after its last run, which is the whole replay.' },
      { t: 'Nov 25 07:40', event: 'You are paged.' },
    ],
    signals: [
      { label: 'Net revenue Nov 24 (dashboard)', value: '$9.0M (7-day avg $4.4M)', tone: 'bad' },
      { label: 'raw.orders rows, Nov 24', value: '2.12M', tone: 'bad' },
      { label: 'COUNT(DISTINCT order_id), Nov 24', value: '1.06M', tone: 'warn' },
      { label: 'Checkout: orders placed Nov 24', value: '1.06M (a normal Tuesday)', tone: 'ok' },
      { label: 'Loader / dbt run status', value: 'all green', tone: 'neutral' },
      { label: 'Consumer group offset reset', value: '23:05 by on-call', tone: 'warn' },
    ],
    stages: [
      {
        title: 'Triage',
        question: 'Checkout says 1.06M orders, the table has 2.12M rows, and distinct order ids match the product. What is this?',
        options: [
          'A genuine sales spike the product metrics haven’t caught up with',
          'Duplicate rows: some orders are in the table more than once',
          'A currency-conversion bug inflating amounts',
          'A dashboard caching issue; refresh the extracts',
        ],
        answer: 1,
        explain:
          'Rows > distinct keys is the signature of **duplicates**, and the distinct count matching the source system rules out a real spike. A mapping or currency bug would change the sum but not the row count. Always compare `COUNT(*)` with `COUNT(DISTINCT business_key)` before you debug anything else.',
      },
      {
        title: 'Root cause',
        question: 'Why did "replaying the day" create duplicates instead of filling the gap?',
        options: [
          'Kafka delivered every message twice during the reset',
          'The loader has no idempotency: it INSERTs whatever it reads, so re-reading orders that were already loaded appends them again, and the incremental dbt model (no `unique_key`) carries the duplicates into the mart',
          'dbt ran twice because Airflow retried it',
          'The bug fix itself introduced a second write path',
        ],
        answer: 1,
        explain:
          'A replay is **at-least-once by definition**: you re-read records you already processed. That is only safe if the sink is idempotent (MERGE/upsert on `order_id`) or something downstream deduplicates. Here both the loader and the incremental model append, so the whole day was written twice, and the first copy still carries the bad discounts. Kafka didn’t misbehave; it did exactly what it was told.',
      },
      {
        title: 'Mitigate now',
        question: 'The board deck goes out at 10:00. What do you do?',
        options: [
          'Delete all Nov 24 rows from `raw.orders` and replay the day again',
          'Divide Nov 24 revenue by 2 in the dashboard',
          'Deduplicate `raw.orders` for Nov 24 (keep one row per `order_id`, latest `loaded_at`), full-refresh the affected mart partitions, check the totals against checkout, and annotate the dashboard',
          'Roll the loader back to v4.1',
        ],
        answer: 2,
        explain:
          'Repair the data deterministically: `QUALIFY ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY loaded_at DESC) = 1` into a corrected partition, rebuild downstream for that date, then **verify against an independent source** (checkout’s count and sum) before telling anyone it’s fixed. Deleting and replaying again works only if nothing else writes concurrently, and it leaves the board blind for an hour. Dividing by two is wrong: the two copies differ (the first has no discounts), so you must keep the corrected row, not half of the sum. v4.1 has nothing to do with duplicates.',
      },
      {
        title: 'Prevent',
        question: 'Which change makes the next replay or backfill a non-event?',
        options: [
          'Forbid offset resets without a manager’s approval',
          'Increase Kafka retention so replays are rarer',
          'Move the loader to a bigger warehouse',
          'Make every write idempotent: the loader MERGEs on `order_id` (or loads to staging and merges), the dbt model uses `unique_key: order_id` with a merge strategy, and a uniqueness test on `order_id` blocks the mart from publishing',
        ],
        answer: 3,
        explain:
          'Replays, retries and backfills are routine operations; the system must make them safe rather than rare. **Idempotent sinks** turn a replay into a no-op for rows that already exist, and a `unique` test on the business key is the tripwire that catches the next path you forgot. Process controls help, but they don’t fix a design where the obvious recovery action corrupts data.',
      },
    ],
    lesson:
      'Every pipeline will be replayed: by a consumer restart, a retry, a backfill, or a human fixing a bug at 23:00. If any writer on the path appends without a key, the recovery action itself corrupts the numbers. Make sinks idempotent (MERGE on a business key, overwrite a partition, or a transactional sink), deduplicate on a stable id, and put a uniqueness test between raw and anything an executive reads. The on-call engineer did the reasonable thing; the design made it unsafe.',
    realWorld:
      'This shape is common enough that dbt’s documentation calls it out: an incremental model without a `unique_key` simply appends, so re-running it over the same window duplicates rows. Most "revenue doubled" stories in data teams are an append-only writer meeting a rerun.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'inc-empty-partition',
    title: 'Yesterday’s ad spend is $0, and every job is green',
    severity: 'SEV2',
    alert: 'Slack #data-help, 09:12: "Marketing dashboard shows $0 spend for yesterday and ROAS of infinity. The budget-pacing sheet raised caps on 30 campaigns. Help?"',
    context:
      'Marketing analytics pulls daily spend from an ad platform’s reporting API. A cron job on an EC2 box runs `pull_spend.py` at 02:00 and writes a CSV to `s3://raw/spend/dt=YYYY-MM-DD/`. An Airflow DAG scheduled at 06:00 runs Spark to build `spend_daily` (overwrite the date partition) in the warehouse, and the dashboard reads it. About 500 spend rows/s during the pull.',
    workload: { eps: 500, queryQps: 3, unit: 'spend row' },
    patterns: ['orchestration', 'data-quality', 'batch-elt'],
    graph: {
      nodes: [
        { id: 'api', kind: 'saas', label: 'Ad platform reporting API', x: 0, y: 140 },
        { id: 'cron', kind: 'cron-script', label: '02:00 cron: pull_spend.py', x: 190, y: 140 },
        { id: 's3', kind: 'object-store', label: 's3://raw/spend/', x: 380, y: 140 },
        { id: 'spark', kind: 'spark', label: '06:00 Spark: spend_daily', x: 570, y: 140 },
        { id: 'wh', kind: 'warehouse', label: 'Warehouse: spend_daily', x: 760, y: 140 },
        { id: 'bi', kind: 'bi', label: 'Marketing ROAS dashboard', x: 950, y: 140 },
        { id: 'af', kind: 'airflow', label: 'Airflow (time-based schedule)', x: 570, y: 320 },
      ],
      edges: [
        { from: 'api', to: 'cron' },
        { from: 'cron', to: 's3' },
        { from: 's3', to: 'spark' },
        { from: 'spark', to: 'wh' },
        { from: 'wh', to: 'bi' },
        { from: 'af', to: 'spark' },
      ],
    },
    inject: { chaos: 'outage' },
    timeline: [
      { t: '01:40', event: 'The ad platform has an incident: its reporting API returns HTTP 200 with `{"data": []}` for every account until 03:30.' },
      { t: '02:00', event: 'pull_spend.py runs, receives zero rows, writes a header-only CSV, exits 0.' },
      { t: '06:00', event: 'Airflow starts the DAG on schedule. Spark reads the empty file and overwrites `dt=2026-11-24` with 0 rows. Run: success.' },
      { t: '07:30', event: 'A budget-pacing sheet reads $0 spend and raises daily caps on 30 campaigns.' },
      { t: '09:12', event: 'Marketing asks in Slack. You pick it up.' },
    ],
    signals: [
      { label: 'spend_daily rows, Nov 24', value: '0 (trailing 7-day avg 41,200)', tone: 'bad' },
      { label: 'Airflow DAG run Nov 24', value: 'success, 4 min', tone: 'ok' },
      { label: 'Raw file size, dt=2026-11-24', value: '96 bytes (header only)', tone: 'bad' },
      { label: 'Cron exit code', value: '0', tone: 'neutral' },
      { label: 'Ad platform status page', value: 'Reporting API degraded 01:40-03:30 UTC (resolved)', tone: 'warn' },
      { label: 'Freshness / volume alerts', value: 'none configured', tone: 'warn' },
    ],
    stages: [
      {
        title: 'Triage',
        question: 'Every job succeeded, yet the partition is empty. Where do you look first?',
        options: [
          'The dashboard’s SQL: it probably filters the wrong date',
          'Row counts hop by hop, from the dashboard back to the source: the partition, then the raw file, then what the API returned',
          'Spark executor logs for out-of-memory errors',
          'Restart Airflow’s scheduler',
        ],
        answer: 1,
        explain:
          'With green jobs and wrong data, **walk the lineage backwards with counts**: warehouse partition (0 rows) → raw file (header only) → the extract that wrote it. You find the hop where the data disappeared in minutes. A dashboard bug wouldn’t make the table empty, and there was no failure for logs to explain.',
      },
      {
        title: 'Root cause',
        question: 'What actually made this a silent incident?',
        options: [
          'The ad platform’s outage',
          'Spark’s overwrite mode',
          'The pipeline runs on a clock, not on data: nothing checked that the extract was complete, an empty response was treated as success, and the 06:00 job published whatever was there',
          'The EC2 box is too small',
        ],
        answer: 2,
        explain:
          'Upstream outages are a given; you don’t control them. The defect is that **no step asserted completeness**: the extract accepted 0 rows, the DAG had no sensor on "yesterday’s data is ready", and nothing compared volume with history before publishing. Overwrite was actually right: it means a rerun cleanly replaces the bad partition.',
      },
      {
        title: 'Mitigate now',
        question: 'The API has recovered. What do you do, in what order?',
        options: [
          'Insert yesterday’s numbers by hand from the ad platform UI',
          'Tell marketing to revert the cap changes, re-pull Nov 24 from the API, rerun the DAG for that date (overwriting the partition), verify the row count and total spend against the platform UI, then announce the fix',
          'Wait for tonight’s run; it will catch up',
          'Delete the empty partition so the dashboard shows "no data" instead of $0',
        ],
        answer: 1,
        explain:
          'Stop the bleeding first: **downstream actions** (raised caps) are spending real money. Then repair with the normal path: the API supports date ranges and the Spark job overwrites one partition, so a targeted rerun is idempotent. Verify against an independent number before closing. Tonight’s run only pulls today, so it never fixes yesterday; hand-typed numbers bypass the pipeline and won’t be reproducible.',
      },
      {
        title: 'Prevent',
        question: 'Which follow-up most directly prevents a repeat?',
        options: [
          'Switch to a different ad platform',
          'Run the cron job twice a night',
          'Have someone check the dashboard every morning',
          'Move the extract into the DAG with retries, treat an empty or anomalously small result as a failure, gate publishing on DQ checks (row count vs trailing average, non-zero spend per active account), and alert on a freshness SLA for `spend_daily`',
        ],
        answer: 3,
        explain:
          'Make completeness an explicit, automated gate: the orchestrator owns the extract (retries, backoff, alerting), the extract **fails loudly** on zero rows, a volume/anomaly check runs before the partition is published (write-audit-publish), and a freshness SLA pages when data is missing or late. A human checking dashboards is a monitor with no pager.',
      },
    ],
    lesson:
      '"The job succeeded" and "the data is correct" are different claims. Pipelines that run on a schedule and trust their input turn every upstream hiccup into a silent hole. Put data checks between stages: assert the input exists and is plausibly complete, fail on empty, compare volume with history, and only then publish. Treat freshness and volume as SLOs with alerts, and remember that downstream automation acts on wrong data faster than humans notice it.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'inc-late-mobile-undercount',
    title: 'Evening engagement "dropped 9%" after the offline-mode launch',
    severity: 'SEV3',
    alert: 'Growth team escalation: "Hourly active sessions between 18:00 and 22:00 are down 9% since app v8 shipped. Is v8 broken? We’re about to roll it back."',
    context:
      'A news app streams app events (20,000/s at peak) into Kafka. A streaming job counts sessions per country in one-hour tumbling windows and writes them into a real-time OLAP table that drives the growth dashboard. Separately, a Spark Structured Streaming job lands raw events into a lakehouse table that analysts query through Trino. App v8 added offline reading: events are queued on the device and uploaded when the phone reconnects, often on the commute home.',
    workload: { eps: 20000, queryQps: 6, late: 0.06, unit: 'app event' },
    patterns: ['late-data', 'realtime-olap'],
    graph: {
      nodes: [
        { id: 'events', kind: 'events', label: 'News app (offline queue)', x: 0, y: 160 },
        { id: 'kafka', kind: 'kafka', label: 'Kafka: app_events', count: 3, x: 190, y: 160 },
        { id: 'win', kind: 'proc-time', label: 'Hourly windows (processing time)', count: 2, x: 380, y: 40 },
        { id: 'olap', kind: 'olap', label: 'Pinot: sessions_hourly', x: 570, y: 40 },
        { id: 'growth', kind: 'bi', label: 'Growth dashboard', x: 760, y: 40 },
        { id: 'sss', kind: 'spark-ss', label: 'Raw landing (Structured Streaming)', count: 2, x: 380, y: 280 },
        { id: 'lake', kind: 'lakehouse', label: 'Lakehouse: app_events', x: 570, y: 280 },
        { id: 'trino', kind: 'trino', label: 'Trino', x: 760, y: 280 },
        { id: 'analysts', kind: 'bi', label: 'Analyst notebooks', x: 950, y: 280 },
        { id: 'maint', kind: 'compaction', label: 'Nightly compaction', x: 570, y: 400 },
      ],
      edges: [
        { from: 'events', to: 'kafka' },
        { from: 'kafka', to: 'win' },
        { from: 'win', to: 'olap' },
        { from: 'olap', to: 'growth' },
        { from: 'kafka', to: 'sss' },
        { from: 'sss', to: 'lake' },
        { from: 'lake', to: 'trino' },
        { from: 'trino', to: 'analysts' },
        { from: 'maint', to: 'lake' },
      ],
    },
    inject: { chaos: 'late' },
    timeline: [
      { t: 'Nov 17', event: 'App v8 with offline reading reaches 60% of Android users.' },
      { t: 'Nov 18-24', event: 'Growth dashboard: 18:00-22:00 sessions down 7-11% vs the prior week; 22:00-01:00 slightly up.' },
      { t: 'Nov 25 10:00', event: 'Growth drafts a rollback of v8 and escalates to data engineering.' },
      { t: 'Nov 25 10:20', event: 'An analyst’s Trino query on the lakehouse table, grouped by `event_time`, shows evening sessions flat week over week.' },
    ],
    signals: [
      { label: 'Evening sessions (dashboard)', value: '-9% WoW', tone: 'bad' },
      { label: 'Evening sessions (lakehouse, by event_time)', value: '+0.4% WoW', tone: 'ok' },
      { label: 'Events with ingest_time − event_time > 1 h', value: '6.1% (was 0.3% before v8)', tone: 'warn' },
      { label: 'Late events by platform', value: '94% Android v8', tone: 'neutral' },
      { label: 'Streaming job lag', value: '< 2 s', tone: 'ok' },
      { label: 'Daily total sessions', value: 'unchanged', tone: 'neutral' },
    ],
    stages: [
      {
        title: 'Triage',
        question: 'The dashboard says evenings dropped, the raw table grouped by event time says they didn’t, and the daily total is unchanged. What is going on?',
        options: [
          'v8 has a real engagement regression in the evening',
          'The streaming job is dropping events under load',
          'Events aren’t missing, they’re misattributed: they arrive hours after they happened and are being counted in the hour they arrived',
          'Pinot is returning stale segments',
        ],
        answer: 2,
        explain:
          'An unchanged daily total rules out loss, and lag under 2 s rules out an overloaded job. A dip in one window plus a bump in a later one, matching a jump in **ingest_time − event_time**, means events are being bucketed by arrival. The two systems disagree only because they use different clocks.',
      },
      {
        title: 'Root cause',
        question: 'Why does the real-time number differ from the lakehouse number?',
        options: [
          'The real-time job windows by processing time, so an article read on the subway at 19:10 and uploaded at 23:40 is counted at 23:00; the lakehouse query groups by the event’s own timestamp',
          'The lakehouse double-counts events',
          'Kafka reordered the events',
          'Pinot’s retention dropped the evening segments',
        ],
        answer: 0,
        explain:
          '**Processing-time windows** are only correct if events arrive in order and on time. Offline mode broke that assumption for 6% of events. Kafka preserves order per partition, but it can’t reorder events that were produced hours late. The lakehouse was right because it kept `event_time` and let the query bucket by it.',
      },
      {
        title: 'Mitigate now',
        question: 'Growth is about to roll back a healthy release. What do you do now?',
        options: [
          'Let them roll back to be safe',
          'Show Growth the event-time comparison so the rollback is cancelled, recompute last week’s hourly table from the lakehouse by `event_time` and backfill those Pinot segments, and annotate the dashboard',
          'Restart the streaming job',
          'Add 9% to evening numbers in the dashboard',
        ],
        answer: 1,
        explain:
          'The most expensive outcome here is a **wrong business decision**, so stop that first with evidence. Then correct history from the source of truth (raw events with event time) by overwriting the affected segments. Restarting changes nothing about the clock the job uses, and a hand-tuned fudge factor will be wrong tomorrow.',
      },
      {
        title: 'Prevent',
        question: 'What is the durable fix?',
        options: [
          'Ask the app team to disable offline mode',
          'Shrink windows to one minute so late events land closer to the right time',
          'Window by event time with a watermark (a few minutes of out-of-orderness) and allowed lateness that updates the right window via upserts; send very late events to a side output; restate yesterday nightly from the lakehouse; and alert on the arrival-delay distribution',
          'Move the dashboard to the lakehouse and accept hourly freshness',
        ],
        answer: 2,
        explain:
          '**Event time + watermarks** make results depend on when things happened, not when they arrived, and upsert-capable stores (Pinot upsert tables, a KV) let late events correct a window after it first emitted. Lateness is unbounded on mobile, so pair it with a nightly restatement and a monitor on arrival delay so the next behaviour change is visible. Smaller windows just misattribute more precisely.',
      },
    ],
    lesson:
      'Mobile clients are distributed systems with terrible networks: events arrive minutes to days late, and a product change can shift that distribution overnight. Any metric bucketed by arrival time will silently move numbers between windows. Window by event time, decide explicitly how long to wait (watermark) and what to do after (allowed lateness, side output, restatement), and monitor the gap between event and ingest time like any other SLO.',
    realWorld:
      'Google’s 2015 Dataflow Model paper and Tyler Akidau’s "Streaming 101/102" articles use offline mobile devices that upload hours later as a motivating example, to argue that processing-time windowing gives wrong answers and to motivate event-time windows, watermarks and triggers.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'inc-renamed-column-nulls',
    title: 'Upstream renamed a column, and revenue in the gold table went to zero',
    severity: 'SEV2',
    alert: 'Account managers in #sales: "Salesforce shows $0 lifetime spend for every account updated since yesterday afternoon. Customers are getting renewal emails with $0."',
    context:
      'Finance and sales read `gold.account_revenue`, a scheduled SQL transform in the warehouse over `raw.orders`. A managed ELT connector (Fivetran-style) replicates the orders Postgres database into `raw` every 15 minutes, and a reverse-ETL sync pushes account revenue into Salesforce hourly. Yesterday at 14:05 the orders team shipped a migration that renamed `orders.amount` to `orders.amount_cents` (and switched it to integer cents). Nobody told the data team.',
    workload: { eps: 1500, queryQps: 4, unit: 'order row' },
    patterns: ['data-quality', 'batch-elt', 'governance'],
    graph: {
      nodes: [
        { id: 'db', kind: 'app-db', label: 'Orders Postgres', x: 0, y: 140 },
        { id: 'conn', kind: 'connector', label: 'Managed ELT (every 15 min)', x: 190, y: 140 },
        { id: 'raw', kind: 'warehouse', label: 'raw.orders', x: 380, y: 140 },
        { id: 'gold', kind: 'warehouse', label: 'gold.account_revenue (scheduled SQL)', x: 570, y: 140 },
        { id: 'bi', kind: 'bi', label: 'Finance dashboards', x: 760, y: 40 },
        { id: 'retl', kind: 'reverse-etl', label: 'Reverse ETL → Salesforce', x: 760, y: 260 },
      ],
      edges: [
        { from: 'db', to: 'conn' },
        { from: 'conn', to: 'raw' },
        { from: 'raw', to: 'gold' },
        { from: 'gold', to: 'bi' },
        { from: 'gold', to: 'retl' },
      ],
    },
    inject: { chaos: 'schema' },
    timeline: [
      { t: 'Mon 14:05', event: 'Orders team deploys migration: `ALTER TABLE orders RENAME COLUMN amount TO amount_cents` plus a backfill to cents.' },
      { t: 'Mon 14:15', event: 'The connector sees a new column `amount_cents` and adds it to `raw.orders`. The old `amount` column stays and is NULL for every new or updated row.' },
      { t: 'Mon 15:00', event: 'gold.account_revenue refresh: `SUM(amount)` silently skips NULLs. Accounts with new orders lose those orders’ revenue.' },
      { t: 'Mon 16:00', event: 'Reverse ETL pushes the new totals to Salesforce. Accounts whose every order was re-touched by the backfill now show $0.' },
      { t: 'Tue 09:30', event: 'Account managers notice. You are pulled in.' },
    ],
    signals: [
      { label: 'Rows in raw.orders since Mon 14:15', value: 'normal volume', tone: 'ok' },
      { label: 'NULL rate of raw.orders.amount', value: '100% since 14:15 (was 0%)', tone: 'bad' },
      { label: 'New column raw.orders.amount_cents', value: 'appeared Mon 14:15', tone: 'warn' },
      { label: 'gold refresh / connector syncs', value: 'all succeeded', tone: 'neutral' },
      { label: 'Revenue in gold, Mon vs prior Mon', value: '-58%', tone: 'bad' },
      { label: 'Salesforce accounts showing $0', value: '3,412', tone: 'bad' },
    ],
    stages: [
      {
        title: 'Triage',
        question: 'Row counts are normal, every sync succeeded, but revenue fell off a cliff at one precise time. What do you check first?',
        options: [
          'Column-level health of `raw.orders` around 14:15: null rates and schema changes',
          'Warehouse credit usage',
          'The reverse-ETL vendor’s status page',
          'Whether finance changed the dashboard filter',
        ],
        answer: 0,
        explain:
          'Normal volume with wrong values points at **columns, not rows**. A step change at one timestamp is almost always a deploy. Null rate by column and the table’s schema history immediately show `amount` going NULL as `amount_cents` appears.',
      },
      {
        title: 'Root cause',
        question: 'Why did a rename upstream produce zeros instead of an error?',
        options: [
          'The connector is buggy and should have renamed the column',
          'Postgres doesn’t support renames during replication',
          'There is no contract between the orders team and the data team: the ELT tool handles a rename as "new column added, old column stops receiving values", and `SUM()` ignores NULLs, so every step succeeded and the meaning changed silently',
          'The gold SQL should have used AVG instead of SUM',
        ],
        answer: 2,
        explain:
          'Log- or query-based replication sees a rename as a drop plus an add; tools keep the old column for history and fill the new one. Nothing is **broken**, which is the problem: SQL aggregates skip NULLs, so the failure shows up as plausible-looking smaller numbers. The real root cause is organisational: the producer’s schema is an API with consumers, but it is treated as a private implementation detail.',
      },
      {
        title: 'Mitigate now',
        question: 'Salesforce is sending $0 renewal emails. What first?',
        options: [
          'Fix the gold SQL and wait for the next hourly sync',
          'Pause the reverse-ETL sync immediately, then patch gold to read `COALESCE(amount, amount_cents / 100.0)`, rebuild it, verify totals against the orders database, and resume the sync to overwrite the bad values',
          'Ask the orders team to roll back the migration',
          'Delete the bad rows from Salesforce by hand',
        ],
        answer: 1,
        explain:
          'The fastest-spreading damage is the **outbound sync** to a customer-facing system, so stop it first. Then repair in the warehouse with an explicit mapping (watch the unit change: cents vs dollars), verify against the source, and let the normal sync overwrite Salesforce. Rolling back a production migration that already backfilled data is riskier than adapting downstream.',
      },
      {
        title: 'Prevent',
        question: 'Which change most directly prevents this class of incident?',
        options: [
          'Freeze schema changes on the orders database',
          'Switch to a different ELT vendor',
          'Add a weekly manual review of Salesforce values',
          'A data contract: the replicated tables (or an outbox/CDC topic) have an owned, versioned schema checked in the producer’s CI; plus DQ gates in the warehouse (`not_null` on amount, revenue-vs-trailing-average checks) that block gold and the reverse-ETL sync when they fail',
        ],
        answer: 3,
        explain:
          'Two layers: **shift left** so a breaking change fails the producer’s build (contract tests, or a schema registry with compatibility rules if you publish events), and **fail closed** downstream so anything that slips through quarantines the batch instead of publishing zeros. Freezes and manual reviews don’t scale with the number of producers.',
      },
    ],
    lesson:
      'When analytics reads another team’s database, that team’s schema becomes your API, but nobody has agreed to treat it like one. ELT tools are designed to keep loading through schema changes, so the failure mode is not an error but quietly wrong numbers. Make the interface explicit (a data contract owned by the producer and checked in their CI), and put quality gates before anything that publishes, especially syncs that push data back into operational tools.',
    realWorld:
      'The "data contracts" movement grew out of exactly this pain: Chad Sanderson, then at Convoy, popularised the term after repeated incidents where routine upstream application changes silently broke downstream analytics and ML.',
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'inc-lakehouse-small-files',
    title: 'Lakehouse queries got 20× slower after the streaming launch',
    severity: 'SEV3',
    alert: 'Trino p99 query latency 64 s (SLO 5 s) for 3 days running · analysts report dashboards timing out',
    context:
      'A product-analytics team replaced its hourly Spark batch load with a Flink job to get fresher data: 40,000 events/s, written into an Iceberg table partitioned by `hour, event_type` (120 event types), sink parallelism 48, committing on every checkpoint (10 s). Trino serves analysts and dashboards. The table has no maintenance jobs: the hourly batch used to write a few large files per partition, so nobody needed them.',
    workload: { eps: 40000, queryQps: 8, unit: 'event' },
    patterns: ['small-files', 'table-formats'],
    graph: {
      nodes: [
        { id: 'events', kind: 'events', label: 'Web + mobile SDKs', x: 0, y: 140 },
        { id: 'kafka', kind: 'kafka', label: 'Kafka', count: 3, x: 190, y: 140 },
        { id: 'flink', kind: 'flink', label: 'Flink → Iceberg (10 s commits)', count: 3, x: 380, y: 140 },
        { id: 'lake', kind: 'lakehouse', label: 'Iceberg: events', x: 570, y: 140 },
        { id: 'trino', kind: 'trino', label: 'Trino', count: 2, x: 760, y: 140 },
        { id: 'bi', kind: 'bi', label: 'Product dashboards', x: 950, y: 140 },
      ],
      edges: [
        { from: 'events', to: 'kafka' },
        { from: 'kafka', to: 'flink' },
        { from: 'flink', to: 'lake' },
        { from: 'lake', to: 'trino' },
        { from: 'trino', to: 'bi' },
      ],
    },
    inject: { chaos: 'smallfiles' },
    timeline: [
      { t: 'Nov 18', event: 'Flink streaming ingestion goes live; hourly Spark load retired. Freshness improves from ~70 min to ~15 s.' },
      { t: 'Nov 19', event: 'Dashboard p99 creeps from 3 s to 9 s. Attributed to "pre-Black Friday traffic".' },
      { t: 'Nov 22', event: 'Trino coordinator CPU high. Workers doubled for the weekend; no change, scaled back to 2.' },
      { t: 'Nov 25', event: 'p99 at 64 s; S3 returns 503 SlowDown on the events prefix. You are asked to investigate.' },
    ],
    signals: [
      { label: 'Trino p99 (events table)', value: '64 s (was 3.1 s)', tone: 'bad' },
      { label: 'Data files in events table', value: '2.4M (was 9k)', tone: 'bad' },
      { label: 'Average data file size', value: '310 KB (target 512 MB)', tone: 'bad' },
      { label: 'Snapshots retained', value: '60,500', tone: 'warn' },
      { label: 'Query planning time share', value: '78% of wall time', tone: 'warn' },
      { label: 'Flink job', value: 'healthy, lag < 1 s', tone: 'ok' },
    ],
    stages: [
      {
        title: 'Triage',
        question: 'Flink is healthy, data volume is the same as before, Trino spends most of its time planning. What is the likely shape?',
        options: [
          'Trino is undersized; add workers',
          'Pre-Black Friday traffic doubled the data',
          'A metadata and file-count problem: the table now has far too many small files and snapshots, so planning and file opens dominate every query',
          'A bad Trino upgrade',
        ],
        answer: 2,
        explain:
          'Same bytes, **270× more files**, and planning time dominating are the signature of small files. Each query must read manifests listing millions of files, then open each one (an S3 GET for the footer, another for the data). More workers don’t help the coordinator plan, and they make S3 throttling worse.',
      },
      {
        title: 'Root cause',
        question: 'Where do 2.4M files in a week come from?',
        options: [
          'Every 10-second commit, each of 48 writers writes one file per partition it touches (up to dozens of event types per hour), so commits × writers × partitions explodes, and nothing compacts files or expires snapshots',
          'Iceberg always writes small files',
          'Kafka partitions were misconfigured',
          'Trino creates temp files during queries',
        ],
        answer: 0,
        explain:
          'File count ≈ commits × writers × partitions touched per commit. 8,640 commits/day × 48 writers × a handful of event types each is hundreds of thousands of files a day. The hourly batch hid this because it committed 24 times a day. Streaming into a table format is fine; **streaming without maintenance** is not.',
      },
      {
        title: 'Mitigate now',
        question: 'What brings latency back down today?',
        options: [
          'Turn off the Flink job and go back to hourly batch',
          'Add 10 more Trino workers',
          'Repartition the table by minute',
          'Run compaction on the affected partitions (`rewrite_data_files`, bin-pack to ~512 MB), then `expire_snapshots` and `rewrite_manifests`; raise the checkpoint interval to a few minutes',
        ],
        answer: 3,
        explain:
          'Compaction rewrites the many small files into a few large ones in a new snapshot, without blocking writers; **expiring snapshots** lets old files be deleted and shrinks metadata; rewriting manifests speeds planning. A longer checkpoint interval cuts new files by the same factor. Finer partitions would multiply the problem.',
      },
      {
        title: 'Prevent',
        question: 'What should have shipped with the streaming launch?',
        options: [
          'A load test on Trino',
          'A rule that only batch jobs may write to the lake',
          'Table maintenance as part of the pipeline: scheduled compaction of closed partitions, snapshot expiry and orphan-file cleanup, hash distribution so each partition has one writer, a coarser partition spec, and alerts on average file size and files per partition',
          'Moving the table to the warehouse',
        ],
        answer: 2,
        explain:
          'Treat compaction like vacuum in Postgres: an operational duty of the table. `write.distribution-mode=hash` makes each partition’s data go through one writer (fewer, bigger files), coarser partitions (day + bucket) reduce fan-out, and a **file-size metric** would have shown the problem on day one rather than day seven.',
      },
    ],
    lesson:
      'Table formats give you atomic commits from a stream, but every commit creates files and metadata. Freshness is bought with file count, so a streaming writer must ship with the maintenance that pays it back: compaction, snapshot expiry and sensible partitioning, plus a metric on file sizes. Choose the commit interval from the freshness the consumers actually need, not the smallest number the engine allows.',
    realWorld:
      'Small files are why Delta Lake added `OPTIMIZE` and auto-compaction, why Iceberg ships `rewrite_data_files` and `expire_snapshots` procedures, and why Uber built automatic file sizing and compaction into Apache Hudi for its incremental ingestion.',
  },
];
