import type { Pattern } from '../../types';
import { E, N, W, X, req } from './dsl';

/* ------------------------------------------------------------------ */
/* 1. Batch ETL vs ELT                                                 */
/* ------------------------------------------------------------------ */

export const batchElt: Pattern = {
  id: 'batch-elt',
  num: 1,
  title: 'Batch ETL vs ELT',
  group: 'Batch',
  tagline: 'Copy raw data into the warehouse incrementally, then transform it there with versioned, tested SQL. Every load and every rerun must be idempotent.',
  minutes: 12,
  level: 'Beginner',
  signals: [
    '"we need dashboards on our product data and Stripe/Salesforce"',
    '"the nightly job hammers the production database"',
    '"a rerun doubled last month’s revenue"',
    '"finance changed the metric definition, restate history"',
  ],
  learn: [
    'Why dashboards on the production database fail, even on a replica',
    'ETL vs ELT: where the transform runs, and why ELT won with cloud warehouses',
    'Incremental extraction: log-based vs `updated_at` cursors, and what each misses',
    'Idempotent loads: MERGE by primary key, dbt incremental models with `unique_key` and a lookback window',
    'When ETL (transform before load) is still the right call',
  ],
  realWorld: [
    { who: 'GitLab', how: 'Its public handbook documents an ELT stack: extractors land raw data in Snowflake, and a large open dbt project builds the marts.' },
    { who: 'JetBlue', how: 'Moved reporting to Fivetran-loaded raw tables in Snowflake, transformed with dbt, replacing hand-built ETL.' },
    { who: 'Monzo', how: 'Runs thousands of dbt models on BigQuery: raw events and tables land first, SQL models transform them in the warehouse.' },
  ],
  scenario: {
    id: 'elt-saas-metrics',
    title: 'Subscription metrics for a B2B SaaS',
    context:
      'A B2B SaaS company (8,000 customers) wants MRR, churn and expansion dashboards for finance and the exec team. The data lives in the product Postgres (accounts, seats, usage), Stripe (subscriptions, invoices) and Salesforce (opportunities). About 3,000 rows change per second at peak. Finance closes the month on these numbers, so a rerun that double-counts an invoice is a real problem, and the production database is already busy serving customers.',
    workload: { eps: 3000, queryQps: 5, late: 0.02, dup: 0.01, unit: 'row change' },
    requirements: [
      req.noOltp('Extract incrementally (WAL or an `updated_at` cursor). No nightly full scans and no dashboards on the primary.'),
      req.exactlyOnce('Connector retries and dbt reruns will happen. MERGE by primary key (`unique_key`) instead of appending.'),
      req.fresh(3 * 3600, 'Finance wants numbers a few hours old, not yesterday’s. Count every sync interval and model run on the path.'),
      req.backfill('full', 'When the MRR definition changes you must rebuild history. Keep untouched raw tables to rebuild from.'),
      req.chaos('outage', 'A 2-hour database or Stripe outage ends with complete data, just later', 'The extractor must resume from a saved position (WAL LSN or cursor), not skip the window or start from scratch.'),
      req.lateData('Invoices get corrected days later. Re-process a lookback window with MERGE so late updates land.'),
    ],
    palette: ['app-db', 'saas', 'full-dump', 'cron-script', 'connector', 'cdc', 'spark', 'dbt', 'warehouse', 'prod-analytics', 'airflow', 'bi'],
    reference: {
      nodes: [
        N('db', 'app-db', X[0], 60, 'Product Postgres: accounts, seats and usage. Tuned for customer transactions, so analytics must never scan it.'),
        N('saas', 'saas', X[0], 220, 'Stripe (subscriptions, invoices) and Salesforce (opportunities): rate-limited, paginated APIs that keep their own history.', { label: 'Stripe + Salesforce' }),
        N('conn', 'connector', X[1], 140, 'Fivetran/Airbyte. Reads Postgres changes from the WAL through a logical replication slot, and Stripe/Salesforce through their APIs with an `updated_at` cursor. Lands each source table 1:1 and MERGEs by primary key every 15 minutes.'),
        N('wraw', 'warehouse', X[2], 140, 'Raw schema: untouched copies of the source tables plus sync metadata (`_fivetran_synced`, `_fivetran_deleted`). Nobody edits it, so every model can be rebuilt from it.', { label: 'Warehouse · raw' }),
        N('dbt', 'dbt', X[3], 140, 'SQL models in git: staging (rename, cast, dedup per key) → intermediate (Stripe customer → product account) → marts (`fct_mrr`, `dim_customer`). Incremental models MERGE on `unique_key` with a 3-day lookback; tests run on every build.'),
        N('wmart', 'warehouse', X[4], 140, 'Analytics-ready, tested tables: one `fct_mrr` that finance and the exec team agree on.', { label: 'Warehouse · marts' }),
        N('bi', 'bi', X[5], 140, 'Looker/Tableau reads marts only, never raw tables, so a metric is defined once.'),
      ],
      edges: [
        E('db', 'conn', 'Log-based: reads the WAL, so no queries run on the primary and deletes are captured.'),
        E('saas', 'conn', 'API pulls with a saved cursor; a failed sync resumes where it stopped.'),
        E('conn', 'wraw', 'Load first, as-is. MERGE by primary key makes a retried sync harmless.'),
        E('wraw', 'dbt', 'Transform inside the warehouse: the T in ELT.'),
        E('dbt', 'wmart', 'Incremental MERGE on `unique_key`; reruns overwrite instead of appending.'),
        E('wmart', 'bi'),
      ],
    },
    wrong: {
      'full-dump': W.fullDump,
      'cron-script': W.cronScript,
      'prod-analytics': W.prodAnalytics,
    },
    alt: {
      cdc: 'Debezium-style CDC gives seconds-fresh changes, but you then run Kafka and a MERGE job yourself. With a 3-hour target, a managed connector (which also reads the WAL for Postgres) is simpler.',
      spark: 'Spark is the classic ETL engine: transform outside the warehouse, then load. It is the right call for huge or non-SQL work (nested JSON, ML features). Here, SQL inside the warehouse is cheaper to build and maintain.',
      airflow: 'An orchestrator that triggers the sync, then `dbt build`, then alerts on failure is common. At this size the connector’s scheduler plus dbt Cloud’s scheduler also work.',
    },
  },
  extras: {
    nodes: [
      N('prod', 'prod-analytics', X[2], 300, 'Looker connected straight to the production Postgres (or its read replica).', { label: 'BI on prod Postgres' }),
      N('dump', 'full-dump', X[1], 300, 'Every night: `SELECT *` from every table into CSV files.'),
      N('etl', 'cron-script', X[2], 300, 'A Python script on one VM joins the dumps and INSERTs report rows into the warehouse.', { label: 'Nightly Python ETL' }),
    ],
    edges: [E('db', 'prod'), E('prod', 'bi'), E('db', 'dump'), E('dump', 'etl'), E('etl', 'wmart')],
  },
  guided: [
    {
      title: 'Just point the dashboards at production',
      tag: 'problem',
      body: [
        'The quickest “pipeline” is no pipeline: connect Looker to the product Postgres and write SQL. It works for the first ten dashboards.',
        'Then finance asks for MRR by plan by month over three years. That is a `GROUP BY` over 400M invoice-line rows on a **row store**: every row’s 30 columns are read to use 2, there are no per-column statistics to skip data, and the scan competes with checkout for CPU, IO and buffer cache.',
      ],
      add: ['db', 'prod', 'bi'],
      traffic: 3,
      predict: {
        question: 'Monday 9 a.m.: three times the usual dashboard load hits the database. What breaks first?',
        options: ['Nothing, Postgres can handle it', 'Dashboards time out and customer requests slow down too', 'Only dashboards slow down; customers are isolated', 'The database runs out of disk'],
        answer: 1,
        explain: 'Analytical scans and customer transactions share the same CPU, IO and buffer cache. A read replica protects the primary’s writes, but it still scans slowly, lags behind, and long queries get cancelled by replication conflicts on a hot standby.',
      },
      keyIdea: 'OLTP stores keep each row together for fast single-row reads and writes. Analytics reads a few columns over many rows. Different access pattern, different engine.',
    },
    {
      title: 'Classic ETL: extract, transform, then load',
      tag: 'technique',
      body: [
        'The 2000s answer: a nightly job dumps every table (`SELECT *`), a Python or Informatica server joins and aggregates the dumps, and only the finished report tables are loaded into the warehouse. Transform came **before** load because warehouse compute (Teradata, Oracle) was fixed and expensive.',
        'Three problems show up fast. The dump scans production every night and gets slower as tables grow. It misses hard deletes and every intermediate state between two dumps. And only the transformed output is kept, so a bug in the transform means re-extracting from sources that have changed since.',
      ],
      add: ['dump', 'etl', 'wmart'],
      remove: ['prod'],
      chaos: 'outage',
      predict: {
        question: 'The database is in maintenance at 2 a.m. when the dump runs. What does finance see at 9 a.m.?',
        options: ['An error on the dashboard', 'Yesterday’s numbers, flagged as stale', 'A missing day that looks like a revenue dip', 'Correct numbers, because the job retried'],
        answer: 2,
        explain: 'Cron has no retries, no dependency on the dump succeeding and no alerting. The dashboard shows a dip instead of an error, and silent wrongness is worse than a loud failure.',
      },
    },
    {
      title: 'Rerun it by hand and count twice',
      tag: 'failure',
      body: [
        'Someone notices and re-runs the script at 10 a.m. It does `INSERT INTO fct_invoices SELECT …` for yesterday, but half of yesterday was inserted before the crash.',
        'Appending is not idempotent: running the job twice gives a different result from running it once. Every manual rerun, retry or overlap with the next night double-counts revenue.',
      ],
      kill: ['etl'],
      predict: {
        question: 'The ETL box restarts and the job runs again for the same day. What happens to MRR?',
        options: ['Unchanged', 'Inflated by the rows written before the crash', 'Lower, because the second run overwrote the first', 'The job refuses to run twice'],
        answer: 1,
        explain: 'A plain INSERT has no key to match on, so rows written before the crash are written again. The fix is to make each run replace its slice: overwrite the date partition, or MERGE on a primary key.',
      },
      keyIdea: 'Idempotent means running a job N times gives the same result as running it once. Retries, reruns and backfills are only safe if every write is idempotent.',
    },
    {
      title: 'ELT, part 1: extract and load raw, incrementally',
      tag: 'technique',
      body: [
        'Flip the order. A managed connector (Fivetran, Airbyte, Stitch) copies each source table **as-is** into a raw schema. Transforms happen later, inside the warehouse.',
        '**Incremental, not full.** For Postgres it reads the WAL through a logical replication slot, so it sees inserts, updates and deletes without scanning tables. For Stripe and Salesforce it asks the API for rows with `updated_at > last_cursor`. Each sync moves a few thousand changed rows, not 400M.',
        '**Idempotent load.** Changed rows are MERGEd into the raw table by primary key, so a retried sync overwrites the same rows. Deletes become a `_deleted` flag (soft delete), so history isn’t silently lost.',
      ],
      add: ['saas', 'conn', 'wraw'],
      remove: ['dump', 'etl'],
      chaos: 'outage',
      keyIdea: 'Keep raw data untouched. With raw kept, every transform can be fixed and re-run; with only transformed output kept, a bug is permanent.',
      goodToKnow: 'Cursor-based extraction misses hard deletes (a deleted row has no `updated_at`) and rows whose transaction commits with an older timestamp than the cursor. Log-based extraction sees both, which is why connectors prefer it for databases.',
    },
    {
      title: 'ELT, part 2: transform inside the warehouse with dbt',
      tag: 'technique',
      body: [
        'Transforms are now SQL `SELECT` statements in a git repo. dbt turns each model into a table or view, builds the dependency DAG from `ref()` calls and runs it in order inside the warehouse.',
        'Layers: **staging** (one model per source table: rename, cast, keep the latest row per key), **intermediate** (joins, e.g. Stripe customer → product account) and **marts** (`fct_mrr`, `dim_customer`) that BI reads. Tests (`unique`, `not_null`, `relationships`, accepted values) run on every build.',
        'The compute is the warehouse itself: it scans columnar data in parallel, so a join that took an hour on the ETL box takes a minute, and you pay only while it runs.',
      ],
      add: ['dbt'],
      chaos: 'replay',
      predict: {
        question: 'The connector re-delivers two hours of Stripe invoices after a retry. What happens to `fct_mrr`?',
        options: ['Double-counted for those two hours', 'Unchanged: raw MERGEs by primary key and staging keeps one row per invoice_id', 'The dbt run fails on a uniqueness test', 'Lower, because rows were overwritten'],
        answer: 1,
        explain: 'Both layers are keyed. The connector MERGEs on the primary key, and staging keeps one row per `invoice_id` (latest `updated_at`). Replays rewrite the same rows. A `unique` test on `invoice_id` would catch it if either key were missing.',
      },
    },
    {
      title: 'Incremental models and late updates',
      tag: 'tradeoff',
      body: [
        'Rebuilding `fct_invoices` from scratch every hour scans all history. That is simple and always correct, but the cost grows with the table. An **incremental** model processes only new rows (`where updated_at > (select max(updated_at) from {{ this }})`) and MERGEs them on `unique_key: invoice_id`.',
        'Two traps. Without `unique_key` the incremental model appends, so a rerun duplicates. And `max(updated_at)` misses rows that arrive late with an older timestamp, like a Stripe invoice corrected three days later. The fix is a **lookback window**: re-process the last 3 days on every run and let the MERGE overwrite them.',
        'Rule of thumb: full refresh while a model is cheap (a few minutes); incremental with MERGE plus a lookback once it is expensive; an occasional `--full-refresh` to catch drift.',
      ],
      chaos: 'late',
      keyIdea: 'Incremental models are cheaper, but you own correctness: a unique key for idempotency and a lookback window for late data.',
    },
    {
      title: 'Why ELT won, and when ETL still wins',
      tag: 'tradeoff',
      body: [
        'ELT became the default around 2016–2020 because cloud warehouses separated storage from compute. Storage is cheap object storage, and compute scales up for a dbt run and suspends afterwards. Transforming where the data already sits removes a fleet of ETL servers and a copy step, and analysts can own the SQL.',
        'Keeping raw also changes what mistakes cost. When the MRR definition changes, you edit one model and rebuild history from raw in minutes. With ETL you would re-extract years of data from sources that no longer hold it.',
        '**ETL still wins** when data must be cleaned before it lands (PII that may not be stored raw under GDPR or HIPAA), when transforms aren’t SQL (images, deeply nested JSON, ML features in Spark), or when warehouse compute over huge raw volumes costs more than a Spark cluster on the lake.',
      ],
      traffic: 3,
      goodToKnow: 'Connector pricing is usage-based (Fivetran bills by monthly active rows). Triple the volume and the connector bill roughly triples. A table that updates every row hourly can cost more than the warehouse, so check which tables really need syncing, and how often.',
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        'Extract incrementally (WAL or cursor, never a nightly full dump), load raw tables 1:1 with MERGE by primary key, transform in the warehouse with dbt (staging → marts, tests, incremental MERGE with a lookback), and point BI at marts only.',
        'Every step is idempotent, so retries, reruns and backfills are boring. Raw is kept, so any definition can be rebuilt from history.',
      ],
    },
  ],
  quiz: [
    {
      id: 'elt-q1',
      q: 'What is the core difference between ETL and ELT?',
      options: ['ELT is real-time, ETL is batch', 'ELT loads raw data first and transforms inside the warehouse; ETL transforms before loading', 'ETL uses SQL, ELT uses Python', 'ELT skips the transform step'],
      answer: 1,
      why: 'The letters are the order. ELT keeps raw copies in the warehouse and transforms them there with SQL, which is what makes rebuilding history cheap.',
    },
    {
      id: 'elt-q2',
      q: 'An incremental dbt model without `unique_key` re-processes a 3-day lookback window on every run. What happens?',
      options: ['Late rows are merged correctly', 'Every run appends the last 3 days again, so rows are duplicated', 'dbt deduplicates automatically', 'The run fails'],
      answer: 1,
      why: 'Without a unique key the incremental strategy is a plain insert. With `unique_key`, dbt uses MERGE (or delete+insert) and overwrites instead.',
    },
    {
      id: 'elt-q3',
      q: 'Why does a query-based (`updated_at` cursor) extract miss hard deletes?',
      options: ['Deletes are too fast to see', 'A deleted row no longer exists, so no query can return it', 'Postgres hides deleted rows from replicas', 'It doesn’t miss them'],
      answer: 1,
      why: 'A cursor query only sees rows that exist now. Log-based extraction reads the delete from the WAL. Without it you need soft deletes in the app or periodic full key comparisons.',
    },
    {
      id: 'elt-q4',
      q: 'When is ETL (transform before load) still the better choice?',
      options: ['Always, it is cheaper', 'When PII must be removed before data is stored in the analytics platform', 'Whenever you use dbt', 'When hourly freshness is enough'],
      answer: 1,
      why: 'If raw data may not be stored (regulated PII), it has to be cleaned on the way in. Heavy non-SQL processing is the other classic reason.',
    },
    {
      id: 'elt-q5',
      q: 'Finance changes how MRR is defined. Which design restates three years of history fastest?',
      options: ['Nightly ETL that keeps only report tables', 'ELT with raw tables kept in the warehouse and dbt models', 'Dashboards on the production database', 'A cron script that appends daily totals'],
      answer: 1,
      why: 'Change one model and rebuild it from raw. The other designs either never kept the inputs or can’t express history at all.',
    },
  ],
  challenge: {
    id: 'elt-plg-crm',
    title: 'Product-qualified leads to the CRM',
    context:
      'A developer-tools company sells self-serve and enterprise plans. Sales wants a **PQL score** (active seats, API calls, invites in the last 14 days) on every Salesforce account so reps call the right teams, and RevOps wants the same numbers in a dashboard. Usage lives in the product Postgres and billing in Stripe. About 2,000 rows change per second. Scores must reach Salesforce within 2 hours and must never create duplicate Salesforce records.',
    workload: { eps: 2000, queryQps: 3, dup: 0.01, unit: 'row change' },
    requirements: [
      req.noOltp(),
      req.exactlyOnce('Syncs and reruns retry. MERGE by key in the warehouse, and upsert into Salesforce by an external id.'),
      req.fresh(2 * 3600, 'Scores must reach Salesforce within 2 hours. Add up every sync interval and model run on the path.'),
      req.edge('reverse-etl', 'saas', 'Scores land in Salesforce, where reps work', 'A dashboard isn’t enough: sync the modelled table back into the CRM with a reverse-ETL tool.'),
      req.backfill('full'),
      req.chaos('replay', 'A re-delivered day of usage rows doesn’t inflate scores', 'Deduplicate by primary key on load (MERGE) and in the staging models.'),
    ],
    palette: ['app-db', 'saas', 'full-dump', 'cron-script', 'connector', 'kafka', 'dbt', 'warehouse', 'prod-analytics', 'airflow', 'reverse-etl', 'bi'],
    reference: {
      nodes: [
        N('db', 'app-db', X[0], 60, 'Product Postgres: seats, API keys and usage counters.'),
        N('stripe', 'saas', X[0], 220, 'Plans, invoices and payment status.', { label: 'Stripe (billing)' }),
        N('conn', 'connector', X[1], 140, 'Incremental syncs every 15 min: WAL for Postgres, cursor for Stripe, MERGE by primary key.'),
        N('wraw', 'warehouse', X[2], 140, 'Untouched raw copies of every source table.', { label: 'Warehouse · raw' }),
        N('dbt', 'dbt', X[3], 140, '`int_account_usage` → `pql_scores`: one row per Salesforce account id, rebuilt hourly with tests on uniqueness and nulls.'),
        N('wmart', 'warehouse', X[4], 140, 'Marts: `pql_scores` for the CRM and the RevOps dashboard. One definition for both.', { label: 'Warehouse · marts' }),
        N('bi', 'bi', X[5], 60, 'RevOps dashboard on the same marts.'),
        N('retl', 'reverse-etl', X[5], 220, 'Hightouch/Census: diffs `pql_scores` against the last sync and upserts only changed rows, respecting Salesforce API limits.'),
        N('crm', 'saas', X[6], 220, 'Reps see the score on the account page. (Most companies also sync Salesforce into the warehouse; here it only receives.)', { label: 'Salesforce (CRM)' }),
      ],
      edges: [
        E('db', 'conn'),
        E('stripe', 'conn'),
        E('conn', 'wraw', 'Load raw first; MERGE makes retried syncs harmless.'),
        E('wraw', 'dbt'),
        E('dbt', 'wmart', 'Incremental MERGE on `account_id`.'),
        E('wmart', 'bi'),
        E('wmart', 'retl', 'Reverse ETL reads the modelled table, never raw.'),
        E('retl', 'crm', 'Upsert matched on an external id field, so a re-sync updates the same account instead of creating duplicates.'),
      ],
    },
    wrong: {
      'full-dump': W.fullDump,
      'cron-script': W.cronScript,
      'prod-analytics': W.prodAnalytics,
    },
    alt: {
      airflow: 'An orchestrator can chain sync → `dbt build` → reverse-ETL sync so the CRM only gets scores after tests pass. The tools’ own schedulers also work at this size.',
    },
  },
  deeper: [{ label: 'Star schemas, facts, dimensions and SCDs for marts', to: '/data-modeling' }],
};

/* ------------------------------------------------------------------ */
/* 2. Cloud data warehouse internals                                   */
/* ------------------------------------------------------------------ */

export const warehouse: Pattern = {
  id: 'warehouse',
  num: 2,
  title: 'Cloud data warehouse internals',
  group: 'Batch',
  tagline: 'Columnar storage, pruning and separate compute clusters let one SQL engine serve hundreds of analysts. The same levers decide the bill.',
  minutes: 14,
  level: 'Intermediate',
  signals: [
    '"dashboards are slow every Monday morning"',
    '"hundreds of analysts doing self-serve BI"',
    '"the Snowflake/BigQuery bill doubled"',
    '"the dbt run slows down the dashboards"',
  ],
  learn: [
    'Why columnar storage and compression make analytical scans 10–100× cheaper',
    'Micro-partitions, min/max metadata and pruning; when a clustering key pays off',
    'Storage/compute separation: isolating loads, transforms and BI on separate clusters',
    'MPP execution: how one query is split, shuffled and aggregated',
    'Concurrency scaling and the cost model (credits, slots, bytes scanned)',
  ],
  realWorld: [
    { who: 'Snowflake', how: 'Its 2016 SIGMOD paper describes the design: immutable micro-partitions in S3, stateless virtual warehouses, and a cloud services layer for metadata and optimisation.' },
    { who: 'Spotify', how: 'Moved its analytics to BigQuery when it migrated to Google Cloud; Dremel-style columnar scans over a shared slot pool.' },
    { who: 'Amazon', how: 'Its consumer business moved its Oracle warehouse to Redshift plus an S3 data lake, using RA3 nodes with managed storage.' },
  ],
  scenario: {
    id: 'wh-self-serve',
    title: 'Self-serve analytics for 400 analysts',
    context:
      'An online marketplace has 400 analysts and PMs on Looker. Data arrives from the product database through a connector (about 4,000 changed rows/s), and dbt rebuilds the marts every hour. Every Monday at 9 a.m., 40 dashboard queries per second hit the warehouse while the hourly dbt build is also running. Dashboards must stay under 5 seconds at p99, and the CFO has capped the platform at $10,000/month.',
    workload: { eps: 4000, queryQps: 40, unit: 'row change' },
    requirements: [
      req.queryP99(5000, 'One cluster serves about 15 queries/s before queries queue. Scale BI compute out (multi-cluster), and keep loads and dbt on their own cluster.'),
      req.cost(10000, 'Every cluster is billed while it runs. Size BI compute for the peak, not above it.'),
      req.noOltp(),
      req.fresh(2 * 3600, 'Marts must be at most 2 hours old: one sync plus one hourly dbt run.'),
      req.chaos('crash', 'A dbt run killed mid-build never shows half-built tables', 'Warehouse DML writes new immutable files and commits metadata atomically; a retried run replaces, not appends.'),
    ],
    palette: ['app-db', 'connector', 'full-dump', 'raw-files', 'trino', 'dbt', 'warehouse', 'olap', 'prod-analytics', 'bi'],
    reference: {
      nodes: [
        N('db', 'app-db', X[0], 140, 'Product Postgres: orders, listings, users.'),
        N('conn', 'connector', X[1], 140, 'Incremental, log-based sync every 15 minutes into the raw schema.'),
        N('wraw', 'warehouse', X[2], 140, 'Raw and staging schemas. Loads and the hourly `dbt build` run on their own virtual warehouse (`TRANSFORM_WH`, size M), so a heavy rebuild never steals compute from dashboards.', { label: 'Warehouse · raw (ELT compute)' }),
        N('dbt', 'dbt', X[3], 140, 'Builds marts incrementally; the expensive work runs on `TRANSFORM_WH`.'),
        N('wbi', 'warehouse', X[4], 140, 'Marts read by Looker through `BI_WH`, a multi-cluster warehouse sized for 4 clusters at the Monday peak. Same storage as the raw schema; only the compute is separate.', { label: 'Warehouse · marts (BI ×4)', count: 4 }),
        N('bi', 'bi', X[5], 140, '400 analysts on Looker, 40 queries/s at peak.'),
      ],
      edges: [
        E('db', 'conn'),
        E('conn', 'wraw', 'Loads land on the ELT cluster, isolated from BI.'),
        E('wraw', 'dbt'),
        E('dbt', 'wbi', 'Marts are written once to shared storage and read by a different compute cluster.'),
        E('wbi', 'bi', 'BI only ever reads marts through its own cluster.'),
      ],
    },
    wrong: {
      'prod-analytics': W.prodAnalytics,
      'raw-files': {
        why: `Pointing BI at a folder of CSV/JSON exports means every query parses text and reads every column of every file: no pruning statistics, no compression, no cache. ${W.rawFiles.why}`,
        instead: 'Load into the warehouse’s columnar storage (or a table format on the lake) and query there.',
      },
      'full-dump': W.fullDump,
    },
    alt: {
      trino: 'Trino/Athena over Iceberg tables in the lake is a valid alternative to a warehouse (Netflix, Lyft). It needs well-compacted files and its own cluster sizing. Here the data is already modelled in the warehouse.',
      olap: 'Real-time OLAP (Pinot, ClickHouse, Druid) serves thousands of queries/s in milliseconds, but over pre-joined, denormalised tables. Analysts here need ad-hoc joins across hundreds of models, which is what an MPP warehouse is for.',
    },
  },
  extras: {
    nodes: [
      N('files', 'raw-files', X[2], 300, 'A flat folder of daily JSON exports in S3 that analysts query directly.', { label: 'JSON exports in S3' }),
      N('wone', 'warehouse', X[3], 300, 'One warehouse cluster for everything: loads, dbt and every dashboard.', { label: 'Warehouse · one cluster' }),
    ],
    edges: [E('conn', 'files'), E('files', 'bi'), E('conn', 'wone'), E('wone', 'bi')],
  },
  guided: [
    {
      title: 'Query the exports directly',
      tag: 'problem',
      body: [
        'The data team’s first idea: the connector already writes daily JSON exports to S3, so point a query engine at the folder and let analysts write SQL.',
        'A typical question is `SELECT region, sum(gmv) … WHERE day = yesterday`. The files are row-oriented text with no statistics, so the engine can’t tell which files hold yesterday or skip the 118 columns nobody asked for.',
      ],
      add: ['db', 'conn', 'files', 'bi'],
      predict: {
        question: 'The export folder holds 3 TB. Roughly how much does that query read?',
        options: ['Only yesterday’s rows of two columns', 'All 3 TB: every file, every column, parsed as text', 'Only the file headers', 'Nothing, results are cached'],
        answer: 1,
        explain: 'Without a columnar format, per-file statistics or a partition layout the engine understands, it must open and parse everything. That is why p99 is measured in tens of seconds or minutes.',
      },
    },
    {
      title: 'Columnar storage',
      tag: 'technique',
      body: [
        'Load the data into a warehouse instead. It stores each **column** contiguously, not each row. A query that touches 3 of 120 columns reads about 3% of the bytes.',
        'A column holds similar values, so it compresses 5–10× with dictionary, run-length and delta encoding, and the engine processes it in vectorised batches of thousands of values per CPU instruction loop. Early morning, with a quarter of the usual load, queries take a couple of seconds.',
      ],
      add: ['wone'],
      remove: ['files'],
      traffic: 0.25,
      keyIdea: 'Analytics reads few columns over many rows. Columnar layout plus compression means you read and move far fewer bytes, and bytes are what queries cost.',
    },
    {
      title: 'Micro-partitions and pruning',
      tag: 'technique',
      body: [
        'Snowflake stores every table as immutable **micro-partitions** of 50–500 MB (uncompressed), and keeps min/max, null count and distinct count per column for each one. `WHERE order_date = \'2026-11-24\'` is answered from metadata first: partitions whose date range excludes that day are never read. BigQuery (partitioning plus clustering) and Redshift (zone maps on sort keys) work the same way.',
        'Pruning only works when the data is **clustered** on the filter column. Rows loaded in time order are naturally clustered by date. Filter by `customer_id` instead and every partition overlaps, so the query scans everything. A clustering key re-sorts the table in the background, which costs credits, so add one only for big tables with a dominant filter.',
        'Updates never modify files in place: a DML writes new micro-partitions and commits a new metadata version atomically. That is also what gives you time travel (Snowflake keeps old versions for 1–90 days).',
      ],
      traffic: 0.25,
      predict: {
        question: 'A 3-year orders table was loaded day by day. How much does `WHERE order_date = yesterday` scan?',
        options: ['All 3 years', 'About one day: data loaded in time order is naturally clustered by date', 'Nothing', 'Half the table'],
        answer: 1,
        explain: 'Each micro-partition’s min/max order_date spans roughly one day, so pruning skips almost everything. Filter on a column with no correlation to load order and every partition matches. That is when a clustering key helps.',
      },
    },
    {
      title: 'Monday 9 a.m.',
      tag: 'failure',
      body: [
        'Back to full load: 40 dashboard queries per second, and the hourly dbt build running on the same cluster.',
        'A warehouse cluster runs a limited number of queries at once (Snowflake’s default `MAX_CONCURRENCY_LEVEL` is 8) and queues the rest. Queue time, not execution time, now dominates p99.',
      ],
      predict: {
        question: 'Query load jumps to 40/s on one cluster that comfortably serves 15/s. What happens to p99?',
        options: ['It roughly triples, in proportion to load', 'Queries queue, and p99 goes from seconds to most of a minute', 'The warehouse adds storage automatically', 'Queries fail with an error'],
        answer: 1,
        explain: 'Past saturation, every new query waits for all those ahead of it. Latency grows non-linearly, and the dbt build competing for the same CPU makes it worse.',
      },
    },
    {
      title: 'Separate compute: isolate, then scale out',
      tag: 'technique',
      body: [
        '**Storage/compute separation:** the data lives once in object storage, in the warehouse’s own columnar format. Compute clusters (Snowflake virtual warehouses, BigQuery slots, Redshift RA3 nodes) are stateless and read it, with a local SSD cache for hot data.',
        'That gives two levers. **Isolation:** loads and dbt run on `TRANSFORM_WH`, dashboards on `BI_WH`, so a 20-minute rebuild can’t slow a dashboard. **Scale-out for concurrency:** a multi-cluster `BI_WH` adds identical clusters as the queue grows (here up to 4) and removes them when it drains. Redshift calls this concurrency scaling; BigQuery shares a slot pool across queries.',
        'A dbt run killed mid-build is harmless too: its new micro-partitions were never committed, so readers keep seeing the previous version until the retry commits.',
      ],
      add: ['wraw', 'dbt', 'wbi'],
      remove: ['wone'],
      chaos: 'crash',
      keyIdea: 'Scale **up** (a bigger size) to make one heavy query faster. Scale **out** (more clusters) to serve more concurrent queries. Use separate clusters for workloads that must not interfere.',
    },
    {
      title: 'MPP: how one query runs',
      tag: 'technique',
      body: [
        'The services layer parses the SQL, prunes micro-partitions from metadata and builds a plan. Every node in the cluster scans its share of the remaining files in parallel.',
        'Joins and GROUP BYs need **exchanges**: rows are hash-partitioned on the key and shuffled so matching keys meet on one node, or a small dimension table is **broadcast** to every node. Partial aggregates are computed locally, then merged. A step that doesn’t fit in memory spills to local SSD, then to remote storage, and slows down sharply.',
        'Now lose one of the four BI clusters at peak.',
      ],
      kill: ['wbi'],
      predict: {
        question: 'One of four BI clusters fails during the Monday peak. What happens?',
        options: ['Data is lost', 'Dashboards error until it comes back', 'Queries keep running on the other three, but p99 creeps past the target', 'Nothing at all'],
        answer: 2,
        explain: 'Compute is stateless, so no data is lost and the provider replaces the cluster. But 40 queries/s on 3 clusters is about 90% of capacity, and queues start to form until it returns.',
      },
      goodToKnow: 'Skewed join keys (one huge customer) send most rows to one node, and the whole query waits on that node. Check the query profile for one node doing most of the work.',
    },
    {
      title: 'The bill',
      tag: 'tradeoff',
      body: [
        'Snowflake bills credits per second while a warehouse runs, and each size up doubles credits per hour (XS = 1, S = 2, M = 4 …). BigQuery on-demand bills per TB scanned, or you reserve slots. Redshift bills nodes per hour. It is the same principle everywhere: **bytes scanned × time running**.',
        'Levers that cut cost without hurting users: auto-suspend after 60 s idle, the result cache (an identical query within 24 h costs nothing), pruning-friendly filters and clustering, incremental dbt models instead of full rebuilds, and a **max cluster count** that caps spend. Past the cap, extra load queues instead of costing more.',
        'Watch for the opposite failure too: a 4XL warehouse left running all weekend for one forgotten query. Resource monitors and budgets alert or suspend.',
      ],
      traffic: 1.5,
      predict: {
        question: 'Traffic grows 50% but `BI_WH` is capped at 4 clusters. What happens?',
        options: ['The bill grows 50%', 'Queries queue: p99 rises while the bill stays flat', 'Storage costs rise', 'The warehouse ignores the cap'],
        answer: 1,
        explain: 'The cap trades latency for cost. Raise it if the latency matters more than the money, or cut the work per query (pruning, aggregates, caching).',
      },
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        'Columnar, compressed, immutable micro-partitions with per-column min/max: queries read only the columns and partitions they need.',
        'Storage is shared; compute is separate and stateless. Isolate ELT from BI, scale BI out for concurrency (up only for heavy single queries), cap clusters to cap cost, and treat bytes scanned as the unit of both speed and money.',
      ],
    },
  ],
  quiz: [
    {
      id: 'wh-q1',
      q: 'Why does a columnar store make `SELECT sum(amount) FROM orders` cheaper than a row store?',
      options: ['It caches every query', 'It reads only the `amount` column, which also compresses well', 'It keeps the table sorted by amount', 'It skips NULLs'],
      answer: 1,
      why: 'Column layout means one column’s bytes are contiguous and similar, so the query reads and decompresses a small fraction of the table.',
    },
    {
      id: 'wh-q2',
      q: 'Queries filter on `customer_id` but the table was loaded in date order. What helps most?',
      options: ['A bigger warehouse size', 'A clustering key on customer_id (or a table clustered by it)', 'More clusters', 'A result cache'],
      answer: 1,
      why: 'Pruning needs micro-partitions whose min/max ranges for the filter column don’t overlap. Clustering re-sorts data so they don’t. Bigger compute just scans everything faster.',
    },
    {
      id: 'wh-q3',
      q: 'Dashboards slow down at 9 a.m. because 60 people open them at once. Each query alone is fast. Which lever fits?',
      options: ['Scale up to a larger size', 'Scale out: a multi-cluster warehouse / concurrency scaling', 'Add a clustering key', 'Turn off the result cache'],
      answer: 1,
      why: 'The problem is concurrency, not one heavy query. More clusters serve more queries in parallel; a bigger size makes individual queries faster.',
    },
    {
      id: 'wh-q4',
      q: 'What does storage/compute separation let you do that a classic shared-nothing MPP (data on the compute nodes) can’t?',
      options: ['Store data in rows', 'Run several independent clusters on the same data, and suspend compute when idle', 'Avoid paying for storage', 'Skip query planning'],
      answer: 1,
      why: 'With data in object storage, any number of stateless clusters can read it. You can isolate workloads and pay for compute only while it runs.',
    },
    {
      id: 'wh-q5',
      q: 'In BigQuery on-demand pricing, which change cuts a query’s cost?',
      options: ['Adding `LIMIT 10`', 'Selecting fewer columns and filtering on the partition column', 'Running it at night', 'Using a bigger machine'],
      answer: 1,
      why: 'On-demand bills bytes scanned. `LIMIT` doesn’t reduce the scan; column selection and partition/cluster pruning do.',
    },
  ],
  challenge: {
    id: 'wh-finance-close',
    title: 'Month-end close on a budget',
    context:
      'A fintech’s finance team (60 people) runs month-end close in the warehouse: ledger entries from the product Postgres, plus invoices and payments from NetSuite and Stripe. In close week, 20 report queries per second hit the warehouse and need p99 ≤ 4 s. The data platform budget is $6,000/month, and auditors need numbers that never double-count an entry and can be restated for any past period.',
    workload: { eps: 1500, queryQps: 20, dup: 0.005, unit: 'ledger row' },
    requirements: [
      req.queryP99(4000, 'One cluster serves about 15 queries/s. Find the smallest number of BI clusters that keeps the queue empty.'),
      req.cost(6000, 'Every BI cluster costs as much as the ELT cluster. Don’t over-provision.'),
      req.exactlyOnce('Ledger rows are re-delivered on retries. MERGE by entry id on load and in models.'),
      req.noOltp(),
      req.backfill('full', 'Keep raw ledger tables so any period can be restated.'),
    ],
    palette: ['app-db', 'saas', 'connector', 'full-dump', 'cron-script', 'raw-files', 'dbt', 'warehouse', 'trino', 'prod-analytics', 'bi'],
    reference: {
      nodes: [
        N('db', 'app-db', X[0], 60, 'Ledger Postgres: double-entry journal lines.'),
        N('saas', 'saas', X[0], 220, 'Invoices and payments from finance SaaS tools.', { label: 'NetSuite + Stripe' }),
        N('conn', 'connector', X[1], 140, 'Incremental syncs with MERGE by primary key.'),
        N('wraw', 'warehouse', X[2], 140, 'Raw tables on a small ELT cluster that auto-suspends between runs.', { label: 'Warehouse · raw (ELT compute)' }),
        N('dbt', 'dbt', X[3], 140, 'Builds `fct_journal`, `fct_revenue` and reconciliation models with tests that debits equal credits.'),
        N('wfin', 'warehouse', X[4], 140, 'Finance marts on a 2-cluster BI warehouse: 20 queries/s fit with headroom, and a third cluster would break the budget.', { label: 'Warehouse · marts (BI ×2)', count: 2 }),
        N('bi', 'bi', X[5], 140, 'Close reports and reconciliations.'),
      ],
      edges: [E('db', 'conn'), E('saas', 'conn'), E('conn', 'wraw'), E('wraw', 'dbt'), E('dbt', 'wfin', 'Incremental MERGE on entry id.'), E('wfin', 'bi')],
    },
    wrong: {
      'prod-analytics': W.prodAnalytics,
      'raw-files': W.rawFiles,
      'cron-script': W.cronScript,
      'full-dump': W.fullDump,
    },
    alt: {
      trino: 'Trino over lake tables could serve these reports too, with the same sizing question. The team already models finance in the warehouse.',
    },
  },
  deeper: [{ label: 'Modelling marts: star schemas, grain and partitioning keys', to: '/data-modeling' }],
};

/* ------------------------------------------------------------------ */
/* 3. Orchestration & idempotent backfills                             */
/* ------------------------------------------------------------------ */

export const orchestration: Pattern = {
  id: 'orchestration',
  num: 3,
  title: 'Orchestration & idempotent backfills',
  group: 'Batch',
  tagline: 'Run batch work as a DAG of idempotent, partition-scoped tasks, so retries, catch-up and backfills are routine instead of emergencies.',
  minutes: 14,
  level: 'Intermediate',
  signals: [
    '"the job failed at 2 a.m. and nobody noticed"',
    '"we need to re-run all of March"',
    '"task B started before task A finished"',
    '"a rerun doubled the numbers"',
    '"pipelines with dependencies, retries and SLAs"',
  ],
  learn: [
    'Scheduler, executor and workers: what Airflow does, and what it shouldn’t do',
    'Logical date and data interval: why the run for Monday starts on Tuesday',
    'Idempotent tasks: INSERT OVERWRITE one partition instead of appending',
    'Retries, sensors, SLAs, catchup and backfill',
  ],
  realWorld: [
    { who: 'Airbnb', how: 'Created Airflow in 2014 to run thousands of interdependent batch jobs as code-defined DAGs with backfills; it is now an Apache project.' },
    { who: 'Lyft', how: 'Runs Airflow at large scale for ETL, ML and reporting, with custom tooling for DAG ownership, SLAs and alerting.' },
    { who: 'Spotify', how: 'Built Luigi (2012) for dependency-driven batch pipelines, later moved workflows to Flyte; same ideas of idempotent, partitioned tasks.' },
  ],
  scenario: {
    id: 'orch-marketplace-hourly',
    title: 'Hourly marketplace finance tables',
    context:
      'A food-delivery marketplace computes hourly order, refund and payout tables for finance and operations. Orders come from the product Postgres; payouts and refunds from the Stripe API, about 5,000 records/s at peak. Today it is a crontab on one VM. When it fails an hour silently goes missing, and when someone re-runs it the hour is counted twice. Finance needs each hour within 3 hours, complete and exactly once, and auditors regularly ask for a quarter to be recomputed after a logic fix.',
    workload: { eps: 5000, queryQps: 3, late: 0.01, dup: 0.01, unit: 'record' },
    requirements: [
      req.survives('airflow', 'If the scheduler dies, data ends up late, never wrong', 'Link an orchestrator to the batch jobs it runs, and make every task idempotent per interval so catch-up is safe.'),
      req.exactlyOnce('Retries and backfills re-run tasks. Each task must overwrite its partition or MERGE, never append.'),
      req.chaos('outage', 'A 2-hour source outage ends complete, just late', 'Something must retry and resume: an incremental extractor with a saved position, or orchestrated retries. Not a cron job that silently skips the hour.'),
      req.chaos('crash', 'A task killed mid-write never leaves half an hour visible', 'Commit each partition atomically (overwrite or MERGE in a transaction), then retry.'),
      req.backfill('full', 'Keep raw extracts per hour so any quarter can be recomputed from them.'),
      req.fresh(3 * 3600, 'Each hour must be ready within 3 hours: one extract, one transform run, one load.'),
      req.noOltp(),
    ],
    palette: ['app-db', 'saas', 'full-dump', 'connector', 'cron-script', 'airflow', 'spark', 'dbt', 'flink', 'append-sink', 'object-store', 'warehouse', 'bi'],
    reference: {
      nodes: [
        N('db', 'app-db', X[0], 60, 'Product Postgres: orders and deliveries.'),
        N('saas', 'saas', X[0], 220, 'Payouts and refunds, pulled through the API.', { label: 'Stripe API' }),
        N('conn', 'connector', X[1], 140, 'Extract task: incremental sync per hour (WAL position for Postgres, `updated_at` cursor for Stripe). Airflow triggers it and waits for it to finish.'),
        N('raw', 'object-store', X[2], 140, 'Raw extracts land under `raw/orders/dt=2026-11-24/hr=10/`. Immutable and kept forever: the input to every rerun and backfill.', { label: 'Raw zone · dt/hr' }),
        N('spark', 'spark', X[3], 140, 'Transform task for one data interval: reads `hr=10` and replaces the `hr=10` partition of the output (INSERT OVERWRITE, dynamic partition overwrite). Same input, same output, however many times it runs.'),
        N('wh', 'warehouse', X[4], 140, 'Finance tables partitioned by hour; each partition is swapped atomically by its task.', { label: 'Warehouse · finance tables' }),
        N('bi', 'bi', X[5], 140, 'Finance and ops dashboards.'),
        N('af', 'airflow', X[2], 0, 'DAG `marketplace_hourly`: extract → sensor (raw partition complete) → transform → publish. Retries ×3 with exponential backoff, deadline alerts, `catchup=True`, `max_active_runs=3`.'),
      ],
      edges: [
        E('db', 'conn'),
        E('saas', 'conn'),
        E('conn', 'raw', 'One folder per data interval; a retried extract rewrites the same folder.'),
        E('raw', 'spark', 'Reads exactly the interval’s partition, never “everything since the last run”.'),
        E('spark', 'wh', 'INSERT OVERWRITE the interval’s partition: idempotent.', 'append'),
        E('wh', 'bi'),
        E('af', 'conn', 'Triggers the extract for `{{ data_interval_start }}` and retries it on failure.'),
        E('af', 'spark', 'Runs the transform only after the extract and sensor succeed.'),
      ],
    },
    wrong: {
      'cron-script': W.cronScript,
      'append-sink': W.appendSink,
      'full-dump': W.fullDump,
    },
    alt: {
      dbt: 'dbt models as downstream Airflow tasks (e.g. via Cosmos) are common: Spark for heavy lifting on the raw zone, dbt for SQL marts in the warehouse. Same rule: incremental with `unique_key`, or overwrite per partition.',
    },
  },
  extras: {
    nodes: [
      N('cron', 'cron-script', X[2], 300, '`0 * * * * python etl.py`: reads “the last hour” from Postgres and INSERTs into the warehouse.', { label: 'crontab · etl.py' }),
      N('append', 'append-sink', X[4], 300, 'The transform’s write step does `INSERT INTO finance_hourly SELECT …` instead of overwriting the partition.', { label: 'INSERT INTO task' }),
    ],
    edges: [E('db', 'cron'), E('cron', 'wh'), E('spark', 'append'), E('append', 'wh')],
  },
  guided: [
    {
      title: 'A crontab on one VM',
      tag: 'problem',
      body: [
        'Every hour, cron runs `etl.py`: query Postgres for “the last hour” (`now() - interval \'1 hour\'`), compute totals, INSERT them into the warehouse.',
        'Cron knows only *when* to start a process. It doesn’t know whether the last run succeeded, whether the inputs are ready, which hour a run was meant for, or that anyone should be told when it fails.',
      ],
      add: ['db', 'cron', 'wh', 'bi'],
      chaos: 'outage',
      predict: {
        question: 'Postgres is unreachable from 02:00 to 04:00. What do the finance tables show the next morning?',
        options: ['An error banner', 'Two missing hours that look like a drop in orders', 'Correct numbers, because cron retries', 'The hours are filled in automatically when the DB returns'],
        answer: 1,
        explain: 'The 02:00 and 03:00 runs crashed and nothing retried them. The 04:00 run computed “the last hour” from `now()`, so 02:00–04:00 is never processed. Silent gaps are the worst failure mode: nobody knows to fix them.',
      },
    },
    {
      title: 'Rerun by hand, count twice',
      tag: 'failure',
      body: [
        'Someone spots the gap and re-runs `etl.py` for 03:00. Except it had crashed halfway through its INSERTs, so part of 03:00 was already written.',
        'There is a second bug hiding in `now()`: a rerun at 10:15 computes 09:15–10:15, not 03:00–04:00. A task’s output depends on **when** it runs, not on **which interval** it is for.',
      ],
      kill: ['cron'],
      predict: {
        question: 'The VM reboots mid-run and cron starts the job again. What happens to that hour?',
        options: ['It is processed once', 'Rows written before the crash are inserted again: double-counted', 'It is skipped', 'Cron detects the partial run and rolls it back'],
        answer: 1,
        explain: 'Plain INSERTs have no key and no transaction across the run, so the restart writes the same rows again. Retries are only safe when tasks are idempotent.',
      },
      keyIdea: 'A batch task must be a pure function of its interval: same interval in, same partition out, no matter when or how often it runs.',
    },
    {
      title: 'A DAG with an orchestrator',
      tag: 'technique',
      body: [
        'Replace cron with an Airflow DAG: `extract_orders` and `extract_stripe` → `wait_for_raw` (sensor) → `transform` → `publish`. Raw extracts land in an hourly folder of the raw zone, and Spark builds the finance tables from it.',
        'How Airflow runs it: the **scheduler** parses DAG files, creates a DAG run per interval and queues task instances whose upstreams succeeded. The **executor** (Celery, Kubernetes) hands them to **workers**. Every state lives in the **metadata database**, so a failed task retries (3×, exponential backoff) and a run that exhausts its retries pages someone.',
        'Airflow orchestrates; it doesn’t process. Heavy work runs in Spark or the warehouse, and the Airflow task just submits it and waits.',
      ],
      add: ['saas', 'conn', 'raw', 'spark', 'af'],
      remove: ['cron'],
      chaos: 'outage',
      keyIdea: 'An orchestrator gives you dependencies, retries, alerting and history per interval. Correctness still comes from the tasks being idempotent.',
    },
    {
      title: 'Logical date and data interval',
      tag: 'technique',
      body: [
        'Each DAG run covers a **data interval**. The hourly run for 10:00–11:00 has `logical_date = 10:00`, `data_interval_start = 10:00`, `data_interval_end = 11:00`, and it is triggered just **after** 11:00, when that hour is complete.',
        'Tasks use those values, never `now()`: extract `WHERE updated_at >= \'{{ data_interval_start }}\' AND updated_at < \'{{ data_interval_end }}\'`, write to `dt={{ ds }}/hr=10`. A run for 03:00 made at 10:15 now processes 03:00, which is what makes retries and backfills possible.',
      ],
      predict: {
        question: 'A daily DAG has `schedule="@daily"`. When does the run with logical date 14 March start?',
        options: ['00:00 on 14 March', 'Just after 00:00 on 15 March, once the 14 March interval is over', 'Whenever the scheduler restarts', 'Noon on 14 March'],
        answer: 1,
        explain: 'A run is triggered at the end of its data interval, because that is when the interval’s data is complete. It confuses everyone once, and then it is the whole point.',
      },
    },
    {
      title: 'A retried task that appends',
      tag: 'failure',
      body: [
        'Orchestration doesn’t make a task idempotent by itself. Suppose the transform’s write step is `INSERT INTO finance_hourly SELECT …`.',
        'Airflow retries it after a timeout, a backfill re-runs it, or an engineer clears the task to pick up a fix. Each time, the hour is appended again.',
      ],
      add: ['append'],
      chaos: 'replay',
      predict: {
        question: 'An engineer clears and re-runs yesterday’s transform tasks after a bug fix. What happens?',
        options: ['Yesterday is replaced with the fixed numbers', 'Yesterday now holds both the old and the new rows', 'Airflow skips tasks that already succeeded', 'The warehouse rejects duplicate rows'],
        answer: 1,
        explain: 'Warehouses don’t enforce primary keys on analytic tables (Snowflake and BigQuery constraints are informational). The append lands on top of the old rows, so the totals double.',
      },
    },
    {
      title: 'Overwrite the partition',
      tag: 'technique',
      body: [
        'Make the write replace exactly the interval it owns: `INSERT OVERWRITE finance_hourly PARTITION (dt=\'{{ ds }}\', hr=10) SELECT … WHERE dt=\'{{ ds }}\' AND hr=10`. In Spark set `partitionOverwriteMode=dynamic`; on Iceberg/Delta use `overwritePartitions()` or `replaceWhere`; in a warehouse, DELETE the interval and INSERT it in one transaction, or MERGE on a key.',
        'The commit is atomic: readers see the old partition until the new one is complete. A task killed mid-write leaves nothing visible, and its retry writes the whole partition again.',
      ],
      remove: ['append'],
      chaos: 'crash',
      keyIdea: 'Idempotency comes from the write pattern: each task owns a partition and replaces it atomically. Then retry, clear and backfill are all the same safe operation.',
    },
    {
      title: 'The scheduler goes down',
      tag: 'failure',
      body: [
        'The Airflow scheduler crashes at 01:00 and comes back at 07:00. Tasks already running on workers finish; nothing new starts.',
        'With `catchup=True`, the scheduler sees six intervals with no run and creates them, oldest first, limited by `max_active_runs`. Because every task is idempotent per interval, catching up is just running those hours late.',
      ],
      kill: ['af'],
      predict: {
        question: 'The scheduler is down for 6 hours. What does finance see once it recovers?',
        options: ['Six hours permanently missing', 'Late numbers that fill in hour by hour as catch-up runs, all correct', 'Doubled numbers for those hours', 'Nothing changes: the runs were skipped on purpose'],
        answer: 1,
        explain: 'Missed intervals are scheduled on recovery, and each run reads its own interval from the raw zone. Late, not wrong. Use managed Airflow (MWAA, Cloud Composer, Astronomer) or a highly available scheduler pair for less downtime.',
      },
    },
    {
      title: 'Backfills, sensors and SLAs',
      tag: 'technique',
      body: [
        '**Backfill:** auditors want Q3 recomputed after a logic fix. Run `airflow dags backfill -s 2026-07-01 -e 2026-09-30 marketplace_hourly` (or clear those runs): 2,208 hourly runs, each overwriting its own partition from immutable raw. Limit concurrency so the backfill doesn’t starve today’s runs.',
        '**Sensors** wait for a condition (a file, a partition, another DAG) before downstream tasks start. Use `mode="reschedule"` or deferrable sensors so waiting doesn’t hold a worker slot for hours. Newer Airflow versions can also trigger DAGs from dataset/asset updates instead of polling.',
        '**SLAs / deadline alerts:** page when the 10:00 partition isn’t published by 13:00, even if nothing failed. A stuck sensor is otherwise invisible.',
      ],
      chaos: 'late',
      goodToKnow: 'Late data is a backfill too: re-run a short lookback (say the last 6 hours) on every run, and the overwrite picks up rows that landed after their interval was first processed.',
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        'Orchestrate with a DAG (dependencies, retries, sensors, alerts), parameterise every task by its data interval, never `now()`, and make every write replace the partition it owns.',
        'Keep raw inputs immutable per interval. Then a crash, a scheduler outage, a manual clear and a quarter-long backfill are all the same safe operation: run the interval again.',
      ],
    },
  ],
  quiz: [
    {
      id: 'orch-q1',
      q: 'Which write makes a daily task idempotent?',
      options: [
        '`INSERT INTO sales SELECT … WHERE dt = current_date - 1`',
        '`INSERT OVERWRITE sales PARTITION (dt=\'{{ ds }}\') SELECT … WHERE dt=\'{{ ds }}\'`',
        'Appending to a CSV named with today’s timestamp',
        'Updating a running counter with `+=` per row',
      ],
      answer: 1,
      why: 'It depends only on the logical date and replaces that partition atomically. The first option depends on when it runs and appends.',
    },
    {
      id: 'orch-q2',
      q: 'The scheduler was down for 6 hours on an hourly DAG with `catchup=True`. What happens when it returns?',
      options: ['Only the latest interval runs', 'It creates runs for the 6 missed intervals and runs them, bounded by `max_active_runs`', 'All tasks are marked failed', 'It waits for a manual backfill'],
      answer: 1,
      why: 'Catchup schedules every interval since the last run. That is safe only because each run processes its own interval idempotently.',
    },
    {
      id: 'orch-q3',
      q: 'Why should a long-waiting sensor use `mode="reschedule"` or be deferrable?',
      options: ['It checks faster', 'A poking sensor holds a worker slot the whole time; reschedule/deferrable frees it between checks', 'It retries more', 'It is required for catchup'],
      answer: 1,
      why: 'Hundreds of sensors in poke mode can occupy every worker slot and deadlock the cluster while they wait.',
    },
    {
      id: 'orch-q4',
      q: 'Where should a 2 TB join run in an Airflow pipeline?',
      options: ['In a PythonOperator on the Airflow worker', 'On Spark or the warehouse, submitted and monitored by an Airflow task', 'In the scheduler process', 'In the metadata database'],
      answer: 1,
      why: 'Airflow workers are sized for orchestration. Push heavy compute to engines built for it and keep the task a thin submit-and-wait.',
    },
  ],
  challenge: {
    id: 'orch-churn-features',
    title: 'Daily churn-model training set',
    context:
      'A music-streaming service retrains its churn model every night. Inputs are subscriptions and listening aggregates from the product Postgres and support tickets from Zendesk, about 3,000 records/s at peak. Spark builds one feature row per user per day (`dt` partition) and the model trains on the last 180 days. A wrong or duplicated day silently skews the model, and data scientists regularly ask to recompute 6 months of features after changing a definition.',
    workload: { eps: 3000, dup: 0.01, unit: 'record' },
    requirements: [
      req.survives('airflow', 'If the scheduler dies, features end up late, never wrong', 'Link the orchestrator to the batch jobs, and make each daily task overwrite its own `dt`.'),
      req.exactlyOnce('Retries and backfills re-run days. Overwrite partitions or upsert by (user_id, dt).'),
      req.chaos('outage', 'A Zendesk API outage ends complete, just late', 'Extract incrementally from a saved cursor, and let the orchestrator retry.'),
      req.chaos('replay', 'A re-delivered day of tickets doesn’t double ticket counts', 'Deduplicate by primary key on load and in the feature job.'),
      req.backfill('full', 'Keep raw tables so 6 months of features can be recomputed.'),
      req.fresh(6 * 3600, 'Features for yesterday must be ready before the 06:00 training run.'),
      req.noOltp(),
    ],
    palette: ['app-db', 'saas', 'full-dump', 'connector', 'cron-script', 'airflow', 'spark', 'flink', 'append-sink', 'lakehouse', 'feature-store', 'ml'],
    reference: {
      nodes: [
        N('db', 'app-db', X[0], 60, 'Subscriptions and daily listening aggregates.'),
        N('zd', 'saas', X[0], 220, 'Support tickets pulled through the API.', { label: 'Zendesk API' }),
        N('conn', 'connector', X[1], 140, 'Incremental extracts with MERGE by primary key, triggered per `ds`.'),
        N('raw', 'lakehouse', X[2], 140, 'Raw Iceberg tables: immutable history, the input to every backfill.', { label: 'Raw tables (Iceberg)' }),
        N('spark', 'spark', X[3], 140, 'Feature job for one `ds`: 7/30/90-day windows ending at `ds`, overwriting the `dt=ds` partition.'),
        N('fs', 'feature-store', X[4], 140, 'Offline store keyed by (user_id, dt): point-in-time training sets without leakage, upserts make reruns harmless.'),
        N('ml', 'ml', X[5], 140, 'Nightly retraining on the last 180 days of features.'),
        N('af', 'airflow', X[2], 0, 'DAG `churn_features` (daily, `catchup=True`): extract → sensor → features → train. A 6-month backfill is 180 independent runs.'),
      ],
      edges: [
        E('db', 'conn'),
        E('zd', 'conn'),
        E('conn', 'raw'),
        E('raw', 'spark'),
        E('spark', 'fs', 'Overwrite `dt=ds`; upsert by (user_id, dt).'),
        E('fs', 'ml'),
        E('af', 'conn'),
        E('af', 'spark'),
      ],
    },
    wrong: {
      'cron-script': W.cronScript,
      'append-sink': W.appendSink,
      'full-dump': W.fullDump,
    },
  },
  deeper: [{ label: 'Partitioning keys and slowly changing dimensions', to: '/data-modeling' }],
};

export const BATCH_PATTERNS: Pattern[] = [batchElt, warehouse, orchestration];
