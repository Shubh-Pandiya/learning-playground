import type { Pattern } from '../../types';
import { E, N, R, W, X, req } from './dsl';

/* ------------------------------------------------------------------ */
/* 14. Data quality & observability                                     */
/* ------------------------------------------------------------------ */

export const dataQuality: Pattern = {
  id: 'data-quality',
  num: 14,
  title: 'Data quality & observability',
  group: 'Trust',
  tagline: 'The worst failure is a dashboard that is silently wrong. Stop breaking changes at the producer, audit every batch before you publish it, and alert on freshness and volume.',
  minutes: 14,
  level: 'Intermediate',
  signals: [
    '"the CFO found the bug before we did"',
    '"an upstream team renamed a column and nobody told us"',
    '"the dashboard showed zero revenue for a day"',
    'many producer teams, many consumers, and nobody owns the shape of the data',
  ],
  learn: [
    'Data downtime: why silently wrong is worse than loudly broken',
    'Data contracts and a schema registry: stopping breaking changes at the producer',
    'Write-audit-publish with dbt tests / Great Expectations: freshness, volume, schema, distribution and uniqueness checks',
    'Quarantine vs fail-fast, and how to keep alerts from turning into noise',
  ],
  realWorld: [
    { who: 'Netflix', how: 'Write-audit-publish on Iceberg: jobs write an unpublished snapshot (or branch), audits run against it, and only a passing snapshot is published atomically.' },
    { who: 'Airbnb', how: 'Midas certifies core tables and metrics: a named owner, documented definitions and mandatory quality checks before data counts as trusted.' },
    { who: 'GoCardless', how: 'Popularised data contracts: producer teams own versioned event schemas with SLAs, enforced in CI before events reach the data platform.' },
    { who: 'Uber', how: 'Its data quality platform runs freshness, completeness and anomaly tests on critical tables and alerts owners or blocks consumers when they fail.' },
  ],
  scenario: {
    id: 'dq-marketplace-finance',
    title: 'Trusted marketplace finance metrics',
    context:
      'A marketplace’s finance team reports GMV, take rate and refunds from order events: 6,000 events/s at peak from 40 services owned by 12 teams. Last quarter the checkout team renamed `amount` to `amount_cents`, and GMV on the board dashboard was 40% low for six days before the CFO noticed. Make bad data loud, caught early, and hard to ship in the first place.',
    workload: { eps: 6000, queryQps: 8, dup: 0.005, late: 0.01, unit: 'order event' },
    requirements: [
      req.schemaSafe('Producers will change schemas. Enforce compatibility on the log (schema registry), or check a data contract before publishing.'),
      req.quality(),
      req.chaos('schema', 'A renamed or retyped field never reaches the finance dashboard as silent zeros', 'Something must validate the shape before consumers read it: a registry rejects it at produce time, a contract check quarantines it.'),
      req.exactlyOnce('Producers retry and the loader re-reads. Merge by `order_id` (connector upserts, dbt `unique_key`) so nothing counts twice.'),
      req.backfill('full', 'When a bug is found you must rebuild the affected days. Keep raw history in the warehouse (or lake), not only in Kafka.'),
      req.fresh(7200, 'Finance needs numbers within 2 hours: hourly dbt runs are fine, a nightly cron isn’t.'),
    ],
    palette: ['events', 'kafka', 'schema-registry', 'connector', 'flink', 'dbt', 'airflow', 'warehouse', 'lakehouse', 'dq', 'catalog', 'bi', 'cron-script', 'append-sink', 'raw-files'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 160, 'Checkout, payments and refunds services emit `order_*` events with an `order_id`, an `event_time` and a contract-owned schema.'),
        N('sr', 'schema-registry', X[1], 30, 'Holds the versioned Avro/Protobuf schema of every topic with BACKWARD compatibility. The producer’s serializer registers the schema on deploy, and an incompatible change is rejected (HTTP 409) before a single bad event is written.'),
        N('kafka', 'kafka', X[1], 160, 'Durable log between 40 producers and the platform: 3 brokers, RF=3, acks=all. Events carry a schema id, so every consumer knows exactly which version it is reading.', { count: 3 }),
        N('conn', 'connector', X[2], 160, 'Kafka Connect / Snowpipe sink loads the topics into raw tables every ~15 min and merges by `order_id`, so retries don’t duplicate.'),
        N('wraw', 'warehouse', X[3], 160, 'Raw landing tables: exactly what producers sent, kept forever so any day can be rebuilt. Nobody outside the data team queries them.', { label: 'Warehouse · raw' }),
        N('dbt', 'dbt', X[4], 160, 'Hourly `dbt build`: models select explicit, typed columns (`amount::numeric(12,2)`) and every model has tests. A failing test stops the models downstream of it.'),
        N('af', 'airflow', X[4], 30, 'Schedules the hourly build, retries transient failures, and owns the SLA: if the 08:00 publish hasn’t happened by 09:00, someone is paged.'),
        N('wmart', 'warehouse', X[5], 160, 'Published marts (`fct_orders`, `gmv_daily`). They only change when a build has passed its audits, so dashboards see stale-but-correct data or nothing new, never half-checked data.', { label: 'Warehouse · marts' }),
        N('dq', 'dq', X[4], 310, 'The audit step of write-audit-publish. On the raw tables: contract (required columns and types), freshness and volume. On the marts: uniqueness of `order_id`, not-null, accepted values, and distribution checks (null rate, average order value, refund share) against a 4-week baseline.'),
        N('bi', 'bi', X[6], 160, 'Finance dashboards and the board deck. They read only the published marts.'),
      ],
      edges: [
        E('events', 'kafka', 'Produce with the registry-aware serializer: the schema id travels in every message header.'),
        E('sr', 'kafka', 'Compatibility is enforced per topic subject (`orders-value`), at produce time.'),
        E('kafka', 'conn'),
        E('conn', 'wraw', 'MERGE by `order_id` into the raw tables.'),
        E('wraw', 'dbt'),
        E('af', 'dbt', 'Airflow runs `dbt build` (models and tests together), with retries and an SLA.'),
        E('dbt', 'wmart', 'Build into a staging schema, test, then swap: publish only what passed.'),
        E('dq', 'wraw', 'Contract, freshness and volume checks on landing. Failing rows go to a `_quarantine` table.'),
        E('dq', 'wmart', 'Uniqueness, not-null and distribution tests gate the publish.'),
        E('wmart', 'bi'),
      ],
    },
    wrong: {
      'cron-script': W.cronScript,
      'append-sink': W.appendSink,
      'raw-files': W.rawFiles,
    },
    alt: {
      flink: 'A Flink job could validate every event in flight and route contract violations to a dead-letter topic. That is useful at much higher volume or for real-time consumers; here an hourly audit in the warehouse is simpler.',
      lakehouse: 'Landing raw data in Iceberg works too, and Iceberg branches give write-audit-publish natively: write to an `audit` branch, test, then fast-forward `main`.',
      catalog: 'A catalog with lineage tells you which dashboards and teams are downstream of a failing table, so an incident notice reaches the right people. It’s a natural next step.',
    },
  },
  extras: {
    nodes: [],
    edges: [E('wraw', 'bi', 'The naive setup: the dashboard sums `amount` straight from the raw landing table.', 'dbt')],
  },
  guided: [
    {
      title: 'Data downtime: wrong, not broken',
      tag: 'problem',
      body: [
        'Order events flow through Kafka, a connector loads them into a raw warehouse table every 15 minutes, and the finance dashboard runs `SUM(amount)` straight on it. There are no tests and no contracts, and it works for months.',
        'Then the checkout team ships `amount_cents` (an integer) in place of `amount` (a decimal). The loader helpfully adds the new column, `amount` is NULL for every new row, and GMV quietly drops. No job fails, so nobody is paged.',
        '**Data downtime** is any period when data is missing, late or wrong. The expensive kind is the silent kind: without monitoring, a stakeholder usually finds the problem first, days later, after decisions were made on it.',
      ],
      add: ['events', 'kafka', 'conn', 'wraw', 'bi'],
      chaos: 'schema',
      predict: {
        question: 'The field is renamed at 09:00 on Monday. When does someone notice?',
        options: ['Immediately: the connector fails', 'When the dashboard shows an error', 'When a human notices the numbers look low, possibly days later', 'Never: the connector maps the new name automatically'],
        answer: 2,
        explain: 'Nothing validates the shape. Schema evolution in the loader turns a breaking change into a NULL column, and SUM ignores NULLs. The numbers are wrong, not broken, so only a human can notice.',
      },
    },
    {
      title: 'Model it, and fail loudly',
      tag: 'technique',
      body: [
        'Put dbt models between raw and the dashboard. A model selects **explicit, typed columns** (`amount::numeric(12,2) as amount`) instead of `SELECT *`, and the dashboard reads the model.',
        'Now the same rename makes the build fail with `invalid identifier AMOUNT`. The mart keeps its last good data, and someone gets an error instead of the CFO getting a wrong number.',
      ],
      add: ['dbt', 'wmart'],
      chaos: 'schema',
      keyIdea: 'Loud beats silent. A failed job costs a few hours of staleness; a wrong number in a board deck costs trust in every number you publish afterwards.',
      predict: {
        question: 'The same rename happens again, but the dashboard reads a dbt model that selects `amount` explicitly. What do consumers see?',
        options: ['Silent zeros, as before', 'The last successfully built numbers, while the build fails and alerts', 'Duplicated revenue', 'Nothing changes because dbt maps renamed columns'],
        answer: 1,
        explain: 'The model no longer compiles, so the run fails and the published table isn’t replaced. It is data downtime (stale), but visible and attributable. The next step is catching it before the build, and catching the subtle cases a compile error can’t.',
      },
    },
    {
      title: 'Write, audit, publish',
      tag: 'technique',
      body: [
        'A compile error only catches missing columns. Most bad data is perfectly valid SQL. So every build **writes** to a staging schema, **audits** it, and **publishes** (swaps) only if the audits pass.',
        'The checks cover five pillars: **freshness** (`max(event_time)` is less than 2 h old), **volume** (row count inside the expected band), **schema/contract** (required columns, types, enums), **distribution** (null rate of `payment_method`, average order value, refund share against a 4-week baseline) and **integrity** (`order_id` unique, every order has a known merchant).',
        'On the raw side, contract violations go to a `_quarantine` table instead of disappearing, so you can fix the mapping and replay them.',
      ],
      add: ['dq'],
      chaos: 'schema',
      keyIdea: 'Test before publishing, not after. A check that runs after consumers can read the table is monitoring, not a gate.',
      goodToKnow: 'In dbt: `unique`, `not_null`, `accepted_values` and `relationships` tests, plus packages like dbt-expectations. `dbt build` runs each model’s tests right after it and skips everything downstream of a failure. Great Expectations and Soda express the same checks as suites/checkpoints. Snowflake zero-copy clones or Iceberg branches make the publish an atomic swap.',
    },
    {
      title: 'Quarantine or fail fast?',
      tag: 'tradeoff',
      body: [
        'When a check fails you have two options. **Fail fast:** stop the publish; consumers see yesterday’s correct numbers marked stale. **Quarantine:** move the failing rows aside, publish the rest, and alert.',
        'Choose by blast radius. For money (GMV, payouts, invoices) a partial table is a wrong table, so fail fast. For high-volume behavioural events, where 0.1% malformed rows is normal, quarantine with a threshold: publish if under 1% is quarantined, fail above it.',
        'An orchestrator turns this into a process: Airflow runs `dbt build`, retries transient errors, skips downstream tasks on failure and enforces an **SLA**. If the 08:00 publish hasn’t landed by 09:00, the owner is paged before finance opens the dashboard.',
      ],
      add: ['af'],
      keyIdea: 'Every check needs an owner, a severity (error blocks, warn notifies) and a runbook. A check that nobody acts on is noise, and noisy checks train people to ignore the one that matters.',
    },
    {
      title: 'Shift left: contracts and a schema registry',
      tag: 'technique',
      body: [
        'Catching the rename in the warehouse still means an hour of broken data and a replay. It’s cheaper to stop it at the producer. A **data contract** is a versioned, producer-owned spec of an event: schema, semantics (`amount` in minor units, `currency` as ISO 4217), SLAs and an owner, plus a rule for how it may change.',
        'The **schema registry** enforces the schema part. The producer’s serializer registers each new schema version, and the registry checks it against the subject’s compatibility mode. Under **BACKWARD** (the Confluent default) consumers on the new schema must be able to read old data. Renaming `amount` is a delete plus a new field with no default, so it is rejected with HTTP 409, in the producer’s CI or deploy, not in your pipeline.',
      ],
      add: ['sr'],
      chaos: 'schema',
      predict: {
        question: 'The `orders-value` subject uses BACKWARD compatibility. Which change does the registry accept?',
        options: ['Renaming `amount` to `amount_cents`', 'Changing `amount` from decimal to string', 'Adding an optional `coupon_code` field with a default of null', 'Adding a required `fx_rate` field with no default'],
        answer: 2,
        explain: 'New readers must handle old records. An added field with a default can be filled in for old records; a renamed, retyped or required-without-default field can’t, so those are rejected.',
      },
      goodToKnow: 'The registry checks shape, not meaning. Sending `amount` in cents under the same name and type passes every compatibility rule. That is why the contract also carries semantics, and why distribution checks downstream still matter.',
    },
    {
      title: 'A quiet day is not a healthy day',
      tag: 'failure',
      body: [
        'The checkout service’s producer can’t reach Kafka for 2 hours. Every event that does arrive is perfectly valid, so the registry and the contract checks are happy.',
        'Kafka and the producers’ retries mean the data arrives late rather than never. The danger is the dashboard in the meantime: it shows a dip that looks exactly like a slow morning.',
        'This is what **freshness** and **volume** monitors are for: alert when `max(event_time)` lags more than 30 minutes, or when the hourly order count falls far below the same hour last week. Mark the dashboard stale instead of letting people read a partial hour as a real one.',
      ],
      chaos: 'outage',
      predict: {
        question: 'Producers are down from 09:00 to 11:00, then recover. Without freshness or volume checks, what does finance see at 10:30?',
        options: ['An error banner on the dashboard', 'A dip that looks like a slow morning, with nothing saying the data is incomplete', 'Duplicated orders', 'Correct numbers, because Kafka buffers everything'],
        answer: 1,
        explain: 'Nothing is lost (it’s delayed and catches up), but a partial hour looks like a real hour. Only a freshness or volume check can tell “no orders” from “no data”.',
      },
    },
    {
      title: 'Black Friday is not an incident',
      tag: 'tradeoff',
      body: [
        'Traffic triples on Black Friday. The pipeline copes, but a volume check written as “row count within ±30% of yesterday” pages the on-call engineer every hour, all weekend.',
        'Static thresholds don’t know about seasonality. Compare against the **same hour on the same weekday** over the last 4 weeks, use bands learned from history (Monte Carlo, Soda, Elementary and similar tools do this), and let owners annotate known events like a sale or a launch.',
      ],
      traffic: 3,
      predict: {
        question: 'Volume triples on a planned sale day. Your check is “row count within ±30% of yesterday”. What happens?',
        options: ['Nothing: the check passes', 'The check fires every hour and the team learns to ignore it', 'The pipeline drops the extra rows', 'The schema registry rejects the extra events'],
        answer: 1,
        explain: 'A real, expected spike trips a naive threshold. Alert fatigue is how real incidents get missed, so tune checks for seasonality and give every alert an owner.',
      },
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        '**Prevent** at the producer: data contracts plus a schema registry with BACKWARD compatibility. **Detect** before publishing: write-audit-publish with contract, freshness, volume, distribution and uniqueness checks. **Respond** with a policy: fail fast for money, quarantine with thresholds for behaviour, SLAs and owners for both.',
        'Measure data downtime the way SREs measure uptime: incidents, time to detection and time to resolution per critical table. The goal is that the data team always hears about a problem before its consumers do.',
      ],
    },
  ],
  quiz: [
    {
      id: 'dq-q1',
      q: 'Which outcome of an upstream schema change is the worst for a finance dashboard?',
      options: ['The load job crashes and pages on-call', 'The dashboard shows yesterday’s numbers marked stale', 'The dashboard silently shows lower revenue', 'The producer’s deploy is rejected by the registry'],
      answer: 2,
      why: 'Silent wrongness is discovered late, by consumers, after decisions were made on it. A crash or a rejected deploy is loud and attributable.',
    },
    {
      id: 'dq-q2',
      q: 'What makes write-audit-publish different from running tests on the published table every hour?',
      options: ['It runs faster', 'Consumers can never read data that hasn’t passed the audit', 'It doesn’t need a warehouse', 'It removes the need for alerts'],
      answer: 1,
      why: 'Audits run on a staging copy (schema, clone or branch), and publishing is an atomic swap. Testing after publishing only tells you what consumers have already seen.',
    },
    {
      id: 'dq-q3',
      q: 'A schema registry with BACKWARD compatibility will NOT catch which of these?',
      options: ['A renamed field', 'A field changing from number to string', 'A field whose unit silently changes from dollars to cents', 'A new required field without a default'],
      answer: 2,
      why: 'Same name and same type is a compatible schema. Unit and meaning changes need contract semantics and distribution checks (average order value jumps 100×).',
    },
    {
      id: 'dq-q4',
      q: 'For a payouts table, a uniqueness test on `payout_id` fails. What is the better default?',
      options: ['Quarantine the duplicates and publish the rest', 'Fail the publish and keep the last good version, then page the owner', 'Publish and fix tomorrow', 'Disable the test'],
      answer: 1,
      why: 'For money, partial or duplicated data is wrong data. Fail fast and keep consumers on the last correct version. Quarantine suits high-volume data where a small error rate is acceptable.',
    },
    {
      id: 'dq-q5',
      q: 'Your volume check pages every Black Friday and every Monday morning. What is the best fix?',
      options: ['Raise the threshold to ±300%', 'Delete the check', 'Compare against the same weekday/hour baseline and annotate known events', 'Run the check once a week'],
      answer: 2,
      why: 'Seasonality-aware baselines keep the check sensitive to real drops while ignoring expected peaks. A huge static threshold would also hide real incidents.',
    },
  ],
  challenge: {
    id: 'dq-partner-claims',
    title: 'Partner claims file feed',
    context:
      'An insurer receives nightly claim files from 30 partner clinics and administrators over SFTP: about 40 million rows a night, loaded at ~3,000 rows/s. Files arrive late, sometimes twice, with reordered columns, two date formats or half the rows missing. Actuaries’ reserve dashboards must be ready by 08:00 and must never be built from a partial or duplicated file.',
    workload: { eps: 3000, queryQps: 6, dup: 0.02, unit: 'claim row' },
    requirements: [
      req.quality('Check every file before loading it: arrival time, row count against the trailer record, required columns, date formats.'),
      req.schemaSafe('There is no schema registry for files. A contract check on the landing zone or the table is your only gate.'),
      req.chaos('schema', 'A partner reordering or renaming columns never corrupts the claims table', 'Validate headers and types against the partner’s contract and quarantine files that fail.'),
      req.chaos('outage', 'A late file delays the load; it never silently skips a day', 'An orchestrator should wait for the file (sensor), retry, and alert on a missed SLA, instead of running once at 02:00.'),
      req.chaos('replay', 'A partner re-sending yesterday’s file doesn’t double-count claims', 'Load idempotently: overwrite the partner’s partition for that date, or MERGE on claim id.'),
      req.backfill('full', 'Keep every received file, unchanged, so you can reload a partner’s history after fixing a parser bug.'),
      req.fresh(7200),
    ],
    palette: ['saas', 'object-store', 'connector', 'spark', 'dbt', 'airflow', 'warehouse', 'lakehouse', 'dq', 'bi', 'cron-script', 'raw-files'],
    reference: {
      nodes: [
        N('partner', 'saas', X[0], 160, 'Partners drop `claims_<partner>_<date>.csv` plus a trailer with the expected row count and checksum.'),
        N('landing', 'object-store', X[1], 160, 'Immutable landing zone: every file kept as received, partitioned by partner and date. This is your audit trail and your backfill source.', { label: 'Landing zone (raw files)' }),
        N('spark', 'spark', X[2], 160, 'Parses with the partner’s explicit schema, normalises dates and codes, and overwrites the (partner, date) partition, so re-sent files replace rather than add.', { label: 'Validate & load' }),
        N('af', 'airflow', X[2], 30, 'A file sensor waits for each partner’s file, then triggers the load. Retries, a 06:00 SLA alert, and one-click reruns for any partner and date.'),
        N('dq', 'dq', X[2], 310, 'Per-file contract: header and types, row count equals the trailer, no duplicate claim ids, dates within range, amounts non-negative. Failing files are quarantined and the partner is notified; the rest load.'),
        N('wh', 'warehouse', X[3], 160, 'The claims table. It only receives files that passed the contract.', { label: 'Warehouse · claims' }),
        N('bi', 'bi', X[4], 160, 'Actuarial reserve dashboards, showing per partner whether today’s file has arrived and passed.'),
      ],
      edges: [
        E('partner', 'landing', 'Copy files unchanged; never edit them in place.'),
        E('landing', 'spark'),
        E('af', 'spark', 'Sensor, then load, with retries and an SLA per partner.'),
        E('dq', 'landing', 'File-level checks: arrival, size, trailer count, checksum.'),
        E('dq', 'wh', 'Row-level contract and distribution checks before publish.'),
        E('spark', 'wh', 'Overwrite the (partner, date) partition: idempotent reloads.'),
        E('wh', 'bi'),
      ],
    },
    wrong: {
      'cron-script': W.cronScript,
      'raw-files': {
        why: 'Pointing analysts at the folder of CSVs means every query re-parses text, a half-uploaded file is visible immediately, and a re-sent file is counted twice. There is no place to enforce a contract.',
        instead: 'Keep the files as an immutable landing zone, but load validated rows into a table (warehouse or Iceberg) that readers query.',
      },
    },
    alt: {
      connector: 'Managed connectors (Fivetran, Airbyte) can load SFTP/S3 files incrementally. You still need the contract checks and per-partner SLAs on top.',
      lakehouse: 'An Iceberg table queried with Trino works as well, and branches give you write-audit-publish per load.',
      dbt: 'dbt tests on the loaded table are a good second layer for cross-partner checks (claim totals per partner against the trailing month).',
    },
  },
  deeper: [
    { label: 'Schema registry, Avro and compatibility modes', to: '/kafka' },
    { label: 'Keys, constraints and modelling the tables you test', to: '/data-modeling' },
  ],
};

/* ------------------------------------------------------------------ */
/* 15. Governance: catalog, lineage, PII, deletes                       */
/* ------------------------------------------------------------------ */

export const governance: Pattern = {
  id: 'governance',
  num: 15,
  title: 'Governance: catalog, lineage & PII',
  group: 'Trust',
  tagline: 'Know what data you have, where it flows and who may see it. Classify and tokenize PII early, enforce access in one place, and make a GDPR delete actually delete.',
  minutes: 14,
  level: 'Intermediate',
  signals: [
    '"GDPR" / "HIPAA" / "right to be forgotten" / "DSAR"',
    '"who owns this table?" / "can I use this column?"',
    '"emails are in 300 tables and we don’t know which"',
    'an auditor asks where a number or a field came from',
  ],
  learn: [
    'A catalog with automatically collected lineage (OpenLineage): ownership, discovery and impact analysis',
    'PII classification, tokenization vs hashing vs masking, and role-based access policies',
    'Why a right-to-be-forgotten delete needs a table format, and why it isn’t done until old snapshots expire',
    'Retention as a design choice: keep less, for less time',
  ],
  realWorld: [
    { who: 'LinkedIn', how: 'Built DataHub (and WhereHows before it); dataset metadata and field-level PII tags drive automated GDPR purges across the lake.' },
    { who: 'Airbnb', how: 'Its data protection platform scans data stores to detect and classify personal data, then feeds the classifications into access control and deletion workflows.' },
    { who: 'Databricks', how: 'Unity Catalog captures column-level lineage from every query and enforces grants, row filters and column masks in one place across engines.' },
  ],
  scenario: {
    id: 'gov-customer-360',
    title: 'Customer analytics under GDPR',
    context:
      'A European e-commerce company replicates its customer and order databases (4,000 changes/s at peak) into the lake for 60 analysts and 3 data science teams. Tables contain names, emails, phone numbers and addresses. The DPO needs: personal data visible only to people who need it, an answer to “where does this email end up?”, and right-to-be-forgotten requests completed within the legal one-month deadline.',
    workload: { eps: 4000, queryQps: 10, unit: 'row change' },
    requirements: [
      req.lineage('Collect lineage automatically from the jobs (OpenLineage from CDC, Flink and Trino) into a catalog. A wiki page is out of date the day it’s written.'),
      req.edge('pii', 'lakehouse', 'Personal columns are tokenized or masked by policy wherever analysts query them', 'Classify the columns, tokenize them in the pipeline, and attach masking/row policies to the analytics tables.'),
      R(
        'erase',
        'A right-to-be-forgotten request physically removes the person’s rows, old snapshots included',
        { type: 'all', checks: [{ type: 'has', kind: 'lakehouse' }, { type: 'edge', from: 'compaction', to: 'lakehouse' }] },
        'Plain files can’t delete a row. Use a table format with row-level deletes, then rewrite files and expire old snapshots so the data is really gone.',
      ),
      req.noOltp(),
      req.backfill('full'),
      req.fresh(900, 'Analysts want today’s orders within 15 minutes.'),
    ],
    palette: ['app-db', 'cdc', 'full-dump', 'kafka', 'flink', 'spark-ss', 'lakehouse', 'raw-files', 'warehouse', 'compaction', 'trino', 'catalog', 'pii', 'dq', 'bi', 'prod-analytics'],
    reference: {
      nodes: [
        N('appdb', 'app-db', X[0], 160, 'Customer, address and order tables in Postgres: the system of record, and where an erasure starts.'),
        N('cdc', 'cdc', X[1], 160, 'Debezium tails the WAL. Every insert, update and **delete** becomes an event, so erasing a customer in the app propagates downstream as a delete.'),
        N('kafka', 'kafka', X[2], 160, 'One topic per table, 3 brokers, RF=3. Retention is 7 days, so personal data in the log ages out on its own instead of being kept forever.', { count: 3 }),
        N('flink', 'flink', X[3], 160, 'Tokenizes PII in flight: `email` becomes a deterministic token from a vault, so analysts can still join and count distinct customers without ever seeing the address.', { count: 2 }),
        N('lake', 'lakehouse', X[4], 160, 'Iceberg tables with row-level deletes. `DELETE FROM customers WHERE customer_id = ?` is a metadata-tracked operation, not a rewrite of the whole lake by hand.', { label: 'Lakehouse (tokenized)' }),
        N('trino', 'trino', X[5], 160, 'The one query engine for analysts. Access policies are enforced here, from the catalog’s tags.'),
        N('bi', 'bi', X[6], 160, 'Analyst dashboards and notebooks, which only see tokens or masked values unless the role allows more.'),
        N('pii', 'pii', X[3], 30, 'Classification (scanners plus owner review) tags columns like `email:pii.direct`. Policies follow the tags: tokenize in Flink, mask by role at query time, purpose-based row filters, and the erasure workflow.'),
        N('catalog', 'catalog', X[2], 310, 'DataHub / Unity Catalog: owner, description and tags per table and column, and column-level lineage pushed by every job (OpenLineage). It answers “where does `email` flow?” in one query.'),
        N('compact', 'compaction', X[4], 310, 'Rewrites files that carry delete markers and expires old snapshots (`expire_snapshots`, `VACUUM`). Until then the deleted rows still exist in older files reachable by time travel.'),
      ],
      edges: [
        E('appdb', 'cdc', 'Log-based capture: no queries on the primary.'),
        E('cdc', 'kafka'),
        E('kafka', 'flink'),
        E('flink', 'lake', 'Upserts and deletes are applied by primary key (MERGE), so the lake mirrors the source, erasures included.'),
        E('lake', 'trino'),
        E('trino', 'bi'),
        E('pii', 'flink', 'Tokenization policy applied before data lands.'),
        E('pii', 'lake', 'Column masks and row filters attached to the tables, plus the erasure job.'),
        E('catalog', 'kafka', 'Topics and schemas registered with owners.'),
        E('catalog', 'lake', 'Tables, column tags and lineage.'),
        E('compact', 'lake', 'Rewrite deleted rows out of data files and expire snapshots on a schedule shorter than the erasure deadline.'),
      ],
    },
    wrong: {
      'full-dump': W.fullDump,
      'prod-analytics': W.prodAnalytics,
      'raw-files': {
        why: `${W.rawFiles.why} For GDPR it is worse: deleting one person means finding and rewriting every file that contains them, by hand, with no record of what was removed.`,
        instead: 'A table format with row-level deletes (Iceberg / Delta / Hudi), plus compaction and snapshot expiry.',
      },
    },
    alt: {
      'spark-ss': 'Spark Structured Streaming can apply the same tokenization and MERGE into Iceberg every 30–60 s.',
      warehouse: 'A warehouse works too: Snowflake and BigQuery have tag-based masking policies, row access policies and lineage built in. Deletes are simple there, but time travel/fail-safe still keeps old versions for a while, so check the retention settings.',
      dq: 'Quality checks are worth adding, including a check that no column tagged PII appears untokenized in an analytics table.',
    },
  },
  extras: {
    nodes: [
      N('dump', 'full-dump', X[1], 160, 'The naive copy: a nightly `pg_dump` of every table, emails and phone numbers included.'),
      N('files', 'raw-files', X[4], 160, 'The dump lands as CSV/Parquet files in a shared bucket that every analyst can read.', { label: 'Shared bucket (files)' }),
    ],
    edges: [E('appdb', 'dump'), E('dump', 'files'), E('files', 'trino')],
  },
  guided: [
    {
      title: 'Everyone can see everything',
      tag: 'problem',
      body: [
        'The quick start: dump every table nightly into a shared bucket and let analysts query it with Trino. Within a year there are 300 derived tables, and nobody knows which ones contain emails, phone numbers or home addresses.',
        'Then a customer sends a GDPR Article 17 erasure request. You have one month to delete her data everywhere it lives.',
      ],
      add: ['appdb', 'dump', 'files', 'trino', 'bi'],
      predict: {
        question: 'How do you delete one customer from this setup?',
        options: ['`DELETE FROM customers WHERE id = 42`', 'Find every file and derived table that contains her, rewrite each by hand, and hope you found them all', 'Wait for the nightly dump to overwrite her', 'Tell the DPO it can’t be done'],
        answer: 1,
        explain: 'Plain files have no row-level delete, and without lineage you can’t even list the copies. The next dump re-copies her from the source only if the app deleted her; the 300 derived tables keep her forever.',
      },
    },
    {
      title: 'A pipeline that carries deletes',
      tag: 'technique',
      body: [
        'Replace the dump with **CDC**. Debezium reads the database’s WAL, so a delete in the app becomes a delete event, not a row that silently stays in yesterday’s copy. Production is no longer scanned every night.',
        'Land it in **Iceberg** tables. A table format tracks files in metadata and supports row-level deletes: copy-on-write rewrites the affected files immediately, while merge-on-read writes small delete files that readers apply. Either way, `DELETE ... WHERE customer_id = 42` is one statement.',
      ],
      add: ['cdc', 'kafka', 'flink', 'lake'],
      remove: ['dump', 'files'],
      keyIdea: 'Erasure is a data flow, not a one-off script. If deletes propagate through the pipeline the same way inserts do, most copies clean themselves up.',
    },
    {
      title: 'Know what you have: catalog and lineage',
      tag: 'technique',
      body: [
        'You can’t protect what you can’t find. A **catalog** stores owner, description and tags for every topic, table and column. Lineage is collected **automatically**: CDC, Flink, Spark, dbt and Trino emit OpenLineage events saying which inputs produced which outputs, down to the column.',
        'Now “where does `customers.email` flow?” is one lineage query. Impact analysis works the same way: before dropping a column, see the 14 dashboards and 2 ML features that read it.',
      ],
      add: ['catalog'],
      goodToKnow: 'Coverage is everything. A catalog fed by hand rots in months; one fed by job metadata stays correct because it is a by-product of running the pipeline.',
    },
    {
      title: 'Classify, tokenize, mask',
      tag: 'technique',
      body: [
        '**Classify** columns: scanners flag likely PII (regexes, ML classifiers), owners confirm, and tags (`pii.direct`, `pii.quasi`, `sensitive.health`) live in the catalog.',
        '**Tokenize early.** Flink swaps each email for a deterministic token from a vault before data lands. Analysts can still join and count distinct customers, and only a small, audited service can map a token back.',
        '**Mask late.** Policies attached to tags are enforced in the query engine: support agents see `j***@gmail.com`, marketing sees only the token, and EU rows are filtered for teams outside the purpose.',
      ],
      add: ['pii'],
      keyIdea: 'Policies attach to tags, not to tables. Tag a new column `pii.direct` and every masking rule and erasure job picks it up automatically.',
    },
    {
      title: 'Hashing is not anonymisation',
      tag: 'tradeoff',
      body: [
        '`sha256(email)` looks safe, but anyone with a list of emails can hash them and join back: it is **pseudonymised** data, still personal data under GDPR. Use a vault or a keyed HMAC, so tokens can’t be recomputed without the key.',
        '**Crypto-shredding** is a powerful option for erasure: encrypt each person’s fields with a per-person key, and delete the key to make every copy unreadable, including backups and Kafka segments you can’t rewrite.',
        'Retention is governance too. Kafka keeps 7 days, raw CDC history keeps 13 months, and aggregates without personal data keep forever. Data you don’t keep can’t leak and doesn’t need deleting.',
      ],
      predict: {
        question: 'An analyst table stores `sha256(email)` instead of the email. Under GDPR, is that table still personal data?',
        options: ['No, hashing anonymises it', 'Yes: it is pseudonymised, and anyone with the email can recompute the hash and re-identify the person', 'Only if the table also has names', 'Only outside the EU'],
        answer: 1,
        explain: 'Unsalted hashes of low-entropy identifiers are trivially reversible by lookup. Pseudonymised data stays in scope for access control, retention and erasure.',
      },
    },
    {
      title: 'The delete isn’t done yet',
      tag: 'failure',
      body: [
        'The erasure job ran `DELETE FROM customers WHERE customer_id = 42`. But Iceberg and Delta keep old snapshots for time travel, and with merge-on-read the original data file still contains her row, hidden only by a delete file.',
        'Until **compaction** rewrites those files and **snapshot expiry** (`expire_snapshots`, `VACUUM`) removes the old files, `SELECT ... FOR VERSION AS OF` last week still returns her. Schedule both well inside the one-month deadline, and log each erasure as evidence for the DPO.',
      ],
      add: ['compact'],
      chaos: 'smallfiles',
      keyIdea: 'In an immutable lake, a logical delete hides data; only rewriting files and expiring snapshots physically removes it.',
    },
    {
      title: 'The catalog goes down',
      tag: 'failure',
      body: ['The catalog service is unavailable for an hour during a release.'],
      kill: ['catalog'],
      predict: {
        question: 'The catalog is down. What happens to the data pipeline?',
        options: ['All queries fail', 'Records keep flowing; discovery, lineage capture and documentation pause', 'Data is lost', 'PII becomes visible to everyone'],
        answer: 1,
        explain: 'The catalog is out of band for the data path. Lineage events queue in the jobs (OpenLineage clients buffer or drop and catch up). Policy enforcement must not depend on it being up, which is why engines cache policies and fail closed.',
      },
      goodToKnow: 'Fail closed: if the query engine can’t fetch a masking policy, it should deny access to tagged columns rather than show them unmasked.',
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        '**Find** it: a catalog fed automatically by job lineage, with owners and column tags. **Protect** it: tokenize direct identifiers in the pipeline, mask and filter by role in one query layer, keep it for as short a time as you can. **Delete** it: CDC carries deletes, a table format applies them, and compaction plus snapshot expiry make them physical.',
        'In interviews, say who owns each step and how you would prove an erasure happened, not just that it is possible.',
      ],
    },
  ],
  quiz: [
    {
      id: 'gov-q1',
      q: 'Why does a GDPR erasure in an Iceberg/Delta lake need snapshot expiry?',
      options: ['To speed up queries', 'Old snapshots still reference files that contain the deleted rows, reachable by time travel', 'Because DELETE is not supported', 'To free up Kafka retention'],
      answer: 1,
      why: 'A DELETE creates a new snapshot. The previous snapshots, and the data files they point to, remain until they are expired and the files removed.',
    },
    {
      id: 'gov-q2',
      q: 'Analysts must count distinct customers and join orders to customers, but must never see emails. What fits best?',
      options: ['Drop the email column', 'Deterministic tokenization (vault or keyed HMAC) applied in the pipeline', 'Plain SHA-256 of the email', 'Give analysts a read replica of production'],
      answer: 1,
      why: 'Deterministic tokens preserve joins and distinct counts. A keyed or vaulted token can’t be reversed by hashing a list of known emails.',
    },
    {
      id: 'gov-q3',
      q: 'What is the main advantage of lineage collected from jobs (OpenLineage) over documented lineage?',
      options: ['It is prettier', 'It stays accurate because it is produced every time a job runs', 'It removes the need for owners', 'It encrypts data'],
      answer: 1,
      why: 'Lineage as a by-product of execution can’t drift from reality. Hand-written lineage is wrong the first time someone adds a job and forgets to update it.',
    },
    {
      id: 'gov-q4',
      q: 'Why is CDC better than a nightly full dump for privacy?',
      options: ['It is cheaper', 'Deletes in the source arrive as delete events and propagate downstream', 'It compresses data', 'It doesn’t copy PII'],
      answer: 1,
      why: 'A snapshot only shows rows that exist. CDC also shows the ones that stopped existing, which is what an erasure needs to reach every copy.',
    },
    {
      id: 'gov-q5',
      q: 'Where should masking policies be enforced?',
      options: ['In each dashboard', 'In every analyst’s SQL', 'Once, in the query/catalog layer, attached to column tags', 'In the source database'],
      answer: 2,
      why: 'One enforcement point driven by tags covers every tool and every new table, and can be audited. Policies scattered across dashboards miss the next notebook.',
    },
  ],
  challenge: {
    id: 'gov-hospital-analytics',
    title: 'Hospital network analytics under HIPAA',
    context:
      'A hospital network wants analytics on admissions, diagnoses and readmissions from its EHR database (about 1,500 changes/s at peak). Clinicians may see patient identifiers for their own patients; researchers may only see de-identified data; auditors must be able to trace every report back to its sources. The EHR primary is life-critical and must not be loaded by analytics.',
    workload: { eps: 1500, queryQps: 5, unit: 'EHR change' },
    requirements: [
      req.lineage('Auditors need column-level lineage from each report back to the EHR tables, captured from the transformations themselves.'),
      req.edge('pii', 'warehouse', 'Protected health information is masked or filtered by role in the analytics tables', 'Tag PHI columns and attach masking and row-access policies to the warehouse tables.'),
      req.noOltp('Use log-based replication, never queries against the EHR primary.'),
      req.fresh(7200, 'Bed management wants data within 2 hours.'),
      req.backfill('full'),
      req.chaos('outage', 'If the EHR is unreachable for maintenance, replication resumes without gaps', 'A log-based connector resumes from its saved position (LSN) after an outage.'),
    ],
    palette: ['app-db', 'connector', 'full-dump', 'cdc', 'warehouse', 'dbt', 'raw-files', 'catalog', 'pii', 'dq', 'bi', 'prod-analytics'],
    reference: {
      nodes: [
        N('ehr', 'app-db', X[0], 160, 'The EHR database: patients, encounters, diagnoses (ICD-10), medications.'),
        N('conn', 'connector', X[1], 160, 'Log-based managed replication (Fivetran/HVR-style) every 15 min, merging by primary key. It reads the transaction log, not the tables.'),
        N('wraw', 'warehouse', X[2], 160, 'Raw replicated tables with full PHI. Only the data platform team and break-glass roles can read them.', { label: 'Warehouse · raw (PHI)' }),
        N('dbt', 'dbt', X[3], 160, 'Builds curated marts: identified marts for care teams, and a de-identified research mart (HIPAA Safe Harbor: the 18 identifiers removed or generalised, dates shifted per patient).'),
        N('wmart', 'warehouse', X[4], 160, 'Curated marts with column masks and row-access policies: clinicians see their own patients, researchers see only the de-identified mart.', { label: 'Warehouse · marts' }),
        N('bi', 'bi', X[5], 160, 'Readmission and capacity dashboards; research notebooks.'),
        N('pii', 'pii', X[3], 30, 'PHI classification and policies: tags on columns, masking by role, row access by care relationship, and an audit log of every access to identified data.'),
        N('catalog', 'catalog', X[3], 310, 'Catalog with lineage from dbt (manifest) and query history: every report traces back to EHR columns, which is what auditors ask for.'),
      ],
      edges: [
        E('ehr', 'conn'),
        E('conn', 'wraw'),
        E('wraw', 'dbt'),
        E('dbt', 'wmart'),
        E('wmart', 'bi'),
        E('pii', 'wraw', 'Raw PHI is locked down to a few roles.'),
        E('pii', 'wmart', 'Masks and row policies per role on the curated marts.'),
        E('catalog', 'dbt', 'dbt publishes models, tests and column lineage to the catalog.'),
        E('catalog', 'wmart'),
      ],
    },
    wrong: {
      'full-dump': W.fullDump,
      'prod-analytics': W.prodAnalytics,
      'raw-files': {
        why: 'Exporting PHI to CSV files in a shared bucket bypasses every access policy and audit log, and you can’t delete or correct one patient’s rows without rewriting files.',
        instead: 'Keep PHI in governed tables with masking, row-access policies and access auditing.',
      },
    },
    alt: {
      cdc: 'Debezium CDC into Kafka is the real-time version of the same idea, worth it if you need minutes rather than a 2-hour freshness target.',
      dq: 'Quality checks (no identifiers in the research mart, encounter counts per hospital) are a strong addition for a regulated dataset.',
    },
  },
  deeper: [{ label: 'Modelling customer dimensions, SCDs and keys', to: '/data-modeling' }],
};

/* ------------------------------------------------------------------ */
/* 16. Feature store                                                    */
/* ------------------------------------------------------------------ */

export const featureStore: Pattern = {
  id: 'feature-store',
  num: 16,
  title: 'Feature pipelines & feature stores',
  group: 'Serving',
  tagline: 'Models train on history and predict on the present. Define each feature once, keep a timestamped offline history for point-in-time training, and an online store for millisecond lookups.',
  minutes: 15,
  level: 'Advanced',
  signals: [
    '"the model was great offline and bad in production"',
    '"features from the last 10 minutes" / "real-time ML"',
    'inference latency budget in milliseconds',
    'data scientists and engineers re-implementing the same feature twice',
  ],
  learn: [
    'Offline store (history, for training) vs online store (latest value, for inference)',
    'Point-in-time correct training sets, and how label leakage happens',
    'Training/serving skew: different code, different data, different time',
    'Streaming features with event-time windows in Flink',
  ],
  realWorld: [
    { who: 'Uber', how: 'Michelangelo introduced the shared feature store: features computed in batch and streaming, stored offline in Hive and online in Cassandra, reused across teams.' },
    { who: 'Airbnb', how: 'Zipline (open-sourced as Chronon) defines a feature once and generates both point-in-time backfills and online serving.' },
    { who: 'DoorDash', how: 'Runs a Redis-based online feature store serving billions of feature values for ETA, ranking and fraud models.' },
  ],
  scenario: {
    id: 'fs-delivery-eta',
    title: 'Delivery ETA predictions',
    context:
      'A food-delivery app predicts the delivery time shown at checkout. The model uses slow features (a restaurant’s average prep time over 90 days) and fast ones (orders the restaurant received in the last 15 minutes, courier supply nearby). 30,000 order and courier events/s at peak; 3,000 predictions/s, each with a 50 ms budget. Last year the offline model beat the old one by 20% and was worse in production.',
    workload: { eps: 30000, queryQps: 3000, late: 0.03, dup: 0.01, unit: 'event' },
    requirements: [
      req.queryP99(25, 'Inference has ~50 ms in total. Feature lookups by key must take single-digit milliseconds: an online store, not a warehouse.'),
      R('rt', 'Fast features (last 15 minutes of activity) are computed from the stream, within seconds', { type: 'hasAny', kinds: ['flink', 'spark-ss'] }, 'Kitchen load changes minute by minute. Compute windowed aggregates in a stream processor and push them to the online store.'),
      req.edge('lakehouse', 'spark', 'Training sets are point-in-time correct, built from timestamped feature history', 'Keep every feature value with its timestamp in an offline store, and build training rows with an as-of join at each label’s time.'),
      req.lateData('Courier phones lose signal. Windows must use event time, or the features at training time and serving time disagree.'),
      req.backfill('full', 'A new feature must be backfilled over 2 years of history to train on.'),
      req.throughput(30000, 'events'),
    ],
    palette: ['events', 'kafka', 'mem-buffer', 'flink', 'spark-ss', 'spark', 'airflow', 'lakehouse', 'compaction', 'warehouse', 'feature-store', 'kv', 'ml', 'proc-time', 'cron-script'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 160, 'Order placed/accepted/picked-up and courier location events, each with an `event_time`.'),
        N('kafka', 'kafka', X[1], 160, 'The shared event log, 3 brokers, RF=3. Both the streaming features and the offline history read from it, so they see the same events.', { count: 3 }),
        N('flink', 'flink', X[2], 160, 'Streaming features: `orders_last_15m` per restaurant and `idle_couriers_2km` per zone, as event-time sliding windows with watermarks. It writes each update to the online store and appends it, timestamped, to the offline history.', { count: 3 }),
        N('fs', 'feature-store', X[4], 60, 'Feature definitions plus the online store (Redis/DynamoDB underneath): the latest value per entity key, served in ~10 ms. Training sets are requested through the same definitions.', { label: 'Feature store · online' }),
        N('lake', 'lakehouse', X[3], 270, 'Offline store: every feature value with its `event_time` and `created_at`, plus labels (actual delivery times), going back years. Training reads history from here.', { label: 'Offline store (feature history)' }),
        N('compact', 'compaction', X[2], 380, 'Flink appends every minute; compaction keeps the history in large files so 2-year training scans stay fast.'),
        N('spark', 'spark', X[4], 270, 'Batch features (90-day prep time per restaurant), materialised into the online store daily, and point-in-time training sets: for each label, the feature values as they were at that order’s timestamp.', { label: 'Batch features + PIT joins' }),
        N('af', 'airflow', X[5], 330, 'Schedules daily batch features, materialisation and training-set builds; backfills a new feature over 2 years.'),
        N('ml', 'ml', X[5], 160, 'ETA model: trained on point-in-time training sets, and at checkout fetches the same features by `restaurant_id` and `zone_id` from the online store.'),
      ],
      edges: [
        E('events', 'kafka'),
        E('kafka', 'flink'),
        E('flink', 'fs', 'Upsert the latest window value per key: idempotent, a replay rewrites the same value.'),
        E('flink', 'lake', 'Append every feature value with its timestamp: the history that makes point-in-time joins possible.'),
        E('compact', 'lake'),
        E('lake', 'spark'),
        E('af', 'spark'),
        E('spark', 'fs', 'Materialise batch features online, from the same definitions used for training.'),
        E('fs', 'ml', 'Online lookups at inference; training sets via the same feature definitions.'),
      ],
    },
    wrong: {
      'proc-time': {
        why: `${W.procTime.why} For features it also breaks training: the offline backfill uses event time, so the model is trained on different numbers than it is served.`,
        instead: W.procTime.instead,
      },
      'mem-buffer': W.memBuffer,
      'cron-script': W.cronScript,
    },
    alt: {
      kv: 'A plain Redis/DynamoDB table can be the online store. You then own the feature registry and the offline/online consistency yourself, which is exactly where skew creeps in.',
      'spark-ss': 'Spark Structured Streaming can compute the windows too, with 30-second micro-batches. Fine for 15-minute features, slower for second-level ones.',
      warehouse: 'A warehouse (Snowflake/BigQuery) is a fine offline store for training. It can’t be the online store at 3,000 lookups/s with a 50 ms budget.',
    },
  },
  extras: {
    nodes: [N('wh', 'warehouse', X[3], 160, 'The naive approach: features are SQL in the warehouse, used for training and queried at prediction time too.', { label: 'Warehouse (features as SQL)' })],
    edges: [E('kafka', 'wh'), E('wh', 'ml', 'The model queries the warehouse per prediction.', 'fs')],
  },
  guided: [
    {
      title: 'Serve features from the warehouse?',
      tag: 'problem',
      body: [
        'Data scientists built the features as SQL in the warehouse and trained there. The quickest way to ship: have the model service run the same SQL for every checkout.',
        'The warehouse is built for big scans by a few dozen analysts, with seconds per query. Checkout needs 3,000 lookups/s, each inside a 50 ms budget.',
      ],
      add: ['events', 'kafka', 'wh', 'ml'],
      predict: {
        question: 'The model queries the warehouse 3,000 times a second. What happens?',
        options: ['It works, with a bigger warehouse', 'Queries queue up and p99 goes to seconds or worse, so checkout times out', 'The warehouse caches everything and returns in 5 ms', 'Only the first query is slow'],
        answer: 1,
        explain: 'A warehouse cluster serves ~10–20 concurrent queries with seconds of latency. 3,000/s is two orders of magnitude beyond that, and even an idle warehouse can’t answer in 50 ms.',
      },
    },
    {
      title: 'An online store, fed by streaming features',
      tag: 'technique',
      body: [
        'Inference needs **the latest value per key**, fast. The **online store** is a key-value layout: `restaurant:123 → {orders_last_15m: 42, avg_prep_90d: 14.2}`, read in ~10 ms at any QPS.',
        'Fast features come from **Flink**: an event-time sliding window (15 minutes, sliding every minute) per restaurant, with a watermark for late events, upserted into the online store on every update.',
      ],
      add: ['flink', 'fs'],
      remove: ['wh'],
      keyIdea: 'Online stores hold the present and answer by key in milliseconds. They don’t hold the past, so they can’t produce training data.',
    },
    {
      title: 'What does the model learn from?',
      tag: 'problem',
      body: [
        'To train, you need for each past order the features **as they were at that moment**: how busy that kitchen was at 19:42 last Tuesday. The online store only knows the value right now.',
        'So Flink also appends every feature value with its timestamp to an **offline store**: an Iceberg table partitioned by date. Compaction keeps it in big files, because training will scan two years of it.',
      ],
      add: ['lake', 'compact'],
    },
    {
      title: 'Point-in-time joins (no label leakage)',
      tag: 'technique',
      body: [
        'A training row is `(order_id, order_time, label = actual delivery minutes)`. For each row, a **point-in-time (as-of) join** picks the latest feature value with `event_time <= order_time`, and nothing after it.',
        'The naive join, “today’s features joined to last year’s labels”, leaks the future: today’s `avg_prep_90d` already includes those very orders. The model looks brilliant offline and fails in production.',
        'Spark builds these training sets and computes slow batch features, materialising them into the online store daily. Airflow schedules it and backfills a new feature over 2 years.',
      ],
      add: ['spark', 'af'],
      predict: {
        question: 'A training set joins each historical order to the restaurant’s current `avg_prep_90d`. Offline accuracy jumps 20%. Why is that suspicious?',
        options: ['It isn’t: more data helps', 'The current value includes information from after each order (including its outcome), so the model learns from the future', 'Spark is non-deterministic', 'The online store is too slow'],
        answer: 1,
        explain: 'That is label leakage. Production never has future information, so the gain disappears. Point-in-time joins only use values that existed at the label’s timestamp.',
      },
      goodToKnow: 'Feast calls this `get_historical_features(entity_df, features)`: `entity_df` carries an `event_timestamp` per row, and each feature view has a TTL so stale values aren’t used. Tecton and Chronon do the same.',
    },
    {
      title: 'Training/serving skew',
      tag: 'tradeoff',
      body: [
        'Skew is any difference between what the model saw in training and what it sees at inference. There are three kinds. **Code skew:** Python in training, Java in serving, with slightly different logic (is a cancelled order counted?). **Data skew:** the online value is minutes stale while training assumed exact values. **Time skew:** the windows were computed by event time offline and by arrival time online.',
        'A feature store attacks all three: **one definition** generates both the streaming/batch pipelines and the training backfill; both stores are fed from the same log; and **feature logging** records the exact values served, so the next model can train on what production actually saw.',
      ],
      keyIdea: 'If a feature is written twice, by two teams, in two languages, it will differ. Define it once and generate both paths.',
    },
    {
      title: 'Couriers in a tunnel',
      tag: 'failure',
      body: [
        'Couriers’ phones lose signal in tunnels and car parks, so their events arrive minutes late and out of order.',
        'Flink windows by **event time**: the watermark waits a bounded time, and late events within the allowed lateness update the right window. The backfill computes the same windows from the same timestamps, so online and offline agree.',
      ],
      chaos: 'late',
      predict: {
        question: '3% of courier events arrive 2–5 minutes late. With event-time windows, what happens to `idle_couriers_2km`?',
        options: ['It is permanently wrong', 'The right window is updated when the late events arrive, and offline and online agree', 'The job crashes', 'The events are dropped'],
        answer: 1,
        explain: 'Event-time windows with allowed lateness absorb this. With arrival-time windows, online values would differ from the backfill, which is time skew.',
      },
    },
    {
      title: 'A stream processor dies at dinner rush',
      tag: 'failure',
      body: ['Kill one of the three Flink TaskManagers at peak.'],
      kill: ['flink'],
      predict: {
        question: 'One of three Flink instances dies. What does the ETA model see?',
        options: ['Wrong features forever', 'A few seconds of slightly stale fast features, then normal', 'No features at all', 'Duplicated orders in the features'],
        answer: 1,
        explain: 'Flink restores state from the last checkpoint on the survivors and catches up from Kafka. The online store keeps serving the last values meanwhile. Models should also handle stale or missing features (TTL plus a default) gracefully.',
      },
      goodToKnow: 'Store a timestamp with each online value and monitor feature freshness. A model silently fed 2-hour-old “last 15 minutes” values is worse than one that knows the value is missing.',
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        'One log feeds both paths. Streaming features (Flink, event time) are upserted online and appended, timestamped, offline. Batch features and point-in-time training sets come from the offline store (Spark, scheduled). The model reads the online store at inference and trains through the same definitions.',
        'The interview checklist: online vs offline stores, point-in-time joins, the three kinds of skew, feature freshness, and backfilling a new feature.',
      ],
    },
  ],
  quiz: [
    {
      id: 'fs-q1',
      q: 'Why can’t the online store be used to build training sets?',
      options: ['It is too slow', 'It only holds the latest value per key, not the value at each past moment', 'It has no keys', 'It is too expensive'],
      answer: 1,
      why: 'Training needs history (values as of each label’s time). The online store overwrites values, by design.',
    },
    {
      id: 'fs-q2',
      q: 'What does a point-in-time join guarantee?',
      options: ['The newest features for every row', 'Each training row only uses feature values that existed at that row’s timestamp', 'No duplicates', 'Faster training'],
      answer: 1,
      why: 'As-of semantics prevent future information (often the label itself) from leaking into features.',
    },
    {
      id: 'fs-q3',
      q: 'A model performs much worse online than offline, and the features are computed in Python for training and in Java for serving. Most likely cause?',
      options: ['Overfitting', 'Training/serving skew from two implementations of the same feature', 'Kafka lag', 'Too few features'],
      answer: 1,
      why: 'Two codebases drift on edge cases (nulls, cancelled orders, time zones). Define features once and generate both paths.',
    },
    {
      id: 'fs-q4',
      q: 'Which is the right home for a “card transactions in the last 10 minutes” feature?',
      options: ['A nightly Spark job', 'A stream processor with event-time windows, written to the online store and logged offline', 'A warehouse view queried at inference', 'Computed in the model service from the transactions table'],
      answer: 1,
      why: 'Fast-moving features need streaming computation. Logging them offline keeps training consistent with serving.',
    },
  ],
  challenge: {
    id: 'fs-card-fraud',
    title: 'Card fraud scoring',
    context:
      'A card issuer scores every authorisation for fraud before approving it: 20,000 authorisations/s at peak, a 100 ms end-to-end budget, so feature lookups must take a few ms. Features: card velocity (transactions in the last 10 minutes and the last hour), distance from the previous transaction, and merchant risk scores computed nightly. Labels (chargebacks) arrive 30–90 days later, so training must be strictly point-in-time.',
    workload: { eps: 20000, queryQps: 2000, late: 0.01, dup: 0.01, unit: 'authorisation' },
    requirements: [
      req.queryP99(20, 'A 100 ms authorisation budget leaves a few ms for feature lookups: a key-value online store.'),
      R('rt', 'Velocity features reflect transactions from seconds ago', { type: 'hasAny', kinds: ['flink', 'spark-ss'] }, 'Card velocity is a sliding window over the stream; a nightly job can’t see a burst of 30 transactions in 2 minutes.'),
      req.edge('lakehouse', 'spark', 'Training sets are point-in-time correct, even though chargebacks arrive months later', 'Keep timestamped feature history offline, and join each label to the features as of the authorisation time.'),
      req.lateData(),
      req.backfill('full'),
      req.noLoss('Every authorisation must reach the features: a missing one is exactly what a fraudster’s burst looks like.'),
    ],
    palette: ['events', 'kafka', 'mem-buffer', 'flink', 'spark-ss', 'spark', 'airflow', 'lakehouse', 'compaction', 'warehouse', 'kv', 'ml', 'proc-time', 'cron-script'],
    reference: {
      nodes: [
        N('events', 'events', X[0], 160, 'Authorisation events from the card processor: card, merchant, amount, location, `event_time`.'),
        N('kafka', 'kafka', X[1], 160, 'Replicated log, 3 brokers, RF=3, keyed by card id so each card’s events stay ordered.', { count: 3 }),
        N('flink', 'flink', X[2], 160, 'Keyed by card: sliding event-time windows for velocity, plus the last location in state for the distance feature.', { count: 2 }),
        N('kv', 'kv', X[4], 60, 'Online store: `card:… → {txn_10m, txn_1h, last_lat_lon}` and `merchant:… → risk`, read in single-digit ms.', { label: 'Online store (KV)' }),
        N('lake', 'lakehouse', X[3], 270, 'Offline store: every feature value with timestamps, plus labels joined in when chargebacks arrive.', { label: 'Offline store' }),
        N('compact', 'compaction', X[2], 380, 'Keeps the streaming-appended history in large files.'),
        N('spark', 'spark', X[4], 270, 'Nightly merchant risk scores, materialised to the KV store, and point-in-time training sets for retraining.'),
        N('af', 'airflow', X[5], 330, 'Schedules the nightly features, materialisation and weekly retraining sets.'),
        N('ml', 'ml', X[5], 160, 'The fraud model in the authorisation path. It fetches card and merchant features by key and scores in milliseconds.'),
      ],
      edges: [
        E('events', 'kafka'),
        E('kafka', 'flink'),
        E('flink', 'kv', 'Upsert the latest velocity per card (idempotent).'),
        E('flink', 'lake', 'Append timestamped feature values for training.'),
        E('compact', 'lake'),
        E('lake', 'spark'),
        E('af', 'spark'),
        E('spark', 'kv', 'Nightly merchant risk materialised online.'),
        E('kv', 'ml'),
      ],
    },
    wrong: {
      'proc-time': W.procTime,
      'mem-buffer': W.memBuffer,
      'cron-script': W.cronScript,
    },
    alt: {
      'spark-ss': 'Structured Streaming works for hourly velocity; for “last 2 minutes” bursts, Flink’s per-event processing reacts faster.',
      warehouse: 'The warehouse is a reasonable offline store for training sets, never the online path.',
    },
  },
  deeper: [
    { label: 'Kafka keys, partitions and ordering per entity', to: '/kafka' },
    { label: 'Slowly changing dimensions and as-of joins', to: '/data-modeling' },
  ],
};

export const TRUST_PATTERNS: Pattern[] = [dataQuality, governance, featureStore];
