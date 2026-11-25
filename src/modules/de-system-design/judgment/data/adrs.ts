import type { AdrCase } from '../types';

export const ADRS: AdrCase[] = [
  /* ------------------------------------------------------------------ */
  {
    id: 'adr-batch-vs-streaming',
    title: 'Retail sales and stock: batch or streaming?',
    context:
      'An omnichannel retailer (600 stores plus an online shop) wants a "real-time" sales and inventory platform. Digging in: store managers review sales at 10:00 and 15:00; regional ops make replenishment calls hourly; finance closes daily. One requirement is genuinely urgent: the online shop must stop selling an item within a minute of it going out of stock in the fulfilment warehouse, because overselling costs ~$30 per cancelled order. Volume: 3,000 POS and stock events/s at peak. The team is 4 data engineers who run Airflow, dbt and Snowflake well and have never operated a stream processor.',
    patterns: ['batch-elt', 'orchestration', 'exactly-once', 'realtime-olap'],
    options: [
      { name: 'Micro-batch ELT everywhere', summary: 'CDC/Snowpipe into the warehouse and incremental dbt models every 15 minutes. One stack, one skill set; ~15-30 min freshness for everything, including the stock signal.' },
      { name: 'Streaming end to end', summary: 'Kafka + Flink for every metric, Pinot for dashboards, the warehouse fed from the stream. Seconds of freshness everywhere; new on-call surface and skills for the whole platform.' },
      { name: 'Batch by default, one narrow streaming path', summary: 'Keep 15-minute micro-batch ELT for sales, replenishment and finance. Build a small, dedicated stream (CDC on stock → Kafka → Flink/KV) only for the out-of-stock signal the shop reads.' },
    ],
    recommended: 2,
    considerations: [
      { label: 'The freshness each consumer actually needs', keywords: ['freshness', 'latency', 'sla', 'minute', 'seconds', 'real-time', 'real time', 'hourly', 'stale'], why: '"Real-time" was a request, not a requirement. Only the stock signal has a business cost per minute of delay; everything else is consumed hourly or twice a day.' },
      { label: 'Cost of always-on compute', keywords: ['cost', 'compute', 'always-on', 'always on', '24/7', 'credits', 'cluster', '$'], why: 'Streaming jobs run 24/7 whether or not anyone looks. A 15-minute batch runs a few minutes per hour, and the warehouse auto-suspends in between.' },
      { label: 'Team skills and operational burden', keywords: ['team', 'skill', 'on-call', 'oncall', 'ops', 'operat', 'experience', 'expertise', 'learn'], why: 'Checkpoints, watermarks, state migration and backpressure are a new on-call surface. Four engineers can absorb one small job, not a whole streaming platform.' },
      { label: 'Correctness under retries, replays and late data', keywords: ['late', 'replay', 'backfill', 'idempot', 'exactly-once', 'exactly once', 'duplicate', 'reprocess', 'correct'], why: 'Batch recomputes a window and overwrites it, which makes late data and reruns easy. Streaming needs event time, watermarks and idempotent or transactional sinks to be equally correct.' },
      { label: 'Blast radius and isolation of the urgent path', keywords: ['isolat', 'narrow', 'dedicated', 'separate', 'blast radius', 'scope', 'critical path'], why: 'A small stream that does one thing (stock level per SKU into a KV store) is easy to reason about, test and fail over, and doesn’t drag the rest of the platform with it.' },
      { label: 'Path to more streaming later', keywords: ['later', 'evolve', 'migrat', 'incremental', 'revisit', 'grow', 'expand'], why: 'Once Kafka/CDC exists for stock, moving another use case to streaming is a deliberate, cheap step if a real sub-minute need appears.' },
    ],
    expert: {
      decision: 'Run sales, replenishment and finance on 15-minute micro-batch ELT (CDC/Snowpipe into the warehouse, incremental dbt, orchestrated with Airflow). Build one narrow streaming path for stock: CDC on the inventory table → Kafka → a Flink job keyed by SKU → a KV store the shop reads, with alerts on lag.',
      rationale: [
        'Freshness is a per-consumer requirement. Only the out-of-stock signal loses money per minute; every other consumer is served well by 15 minutes.',
        'Micro-batch keeps the team on the stack they operate well, and makes late data and backfills simple (recompute and overwrite a window).',
        'The streaming path is small and stateless-ish (latest stock per SKU, upserts), so exactly-once is easy: an idempotent upsert by SKU makes replays harmless.',
        'This is not a Lambda architecture: each metric has exactly one code path. Stock availability is computed only in the stream; sales only in batch.',
      ],
      consequences: [
        'Dashboards are up to ~15-30 minutes behind; this needs to be communicated as a feature, with a visible "data as of" timestamp.',
        'The team must learn and operate Kafka and one Flink job; budget training and a runbook before launch.',
        'Two ingestion styles for stock data (CDC stream and batch ELT) must agree; add a daily reconciliation of stock levels.',
      ],
      revisitWhen: 'A second use case appears with a measurable cost per minute of delay (fraud, dynamic pricing, live promotions), or the 15-minute batch starts costing more than an always-on stream because it runs constantly anyway.',
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'adr-warehouse-vs-lakehouse',
    title: 'Analytics platform: cloud warehouse or lakehouse?',
    context:
      'A 400-person fintech is replacing a Postgres reporting replica. Data: ~3 TB of relational business data (accounts, transactions, ledgers) growing slowly, plus clickstream and device telemetry at ~1.5 TB/day raw. Consumers: 25 SQL analysts and finance (Looker), a 4-person ML team that trains fraud models in Python/Spark on months of raw events, and regulators who require 7-year retention of transaction history. The data platform team is 5 engineers.',
    patterns: ['warehouse', 'table-formats', 'medallion', 'governance'],
    options: [
      { name: 'Cloud warehouse for everything', summary: 'Load everything (including raw telemetry) into Snowflake/BigQuery; dbt for transforms; ML exports or reads via the warehouse’s Python APIs.' },
      { name: 'Lakehouse for everything', summary: 'Iceberg/Delta tables on object storage for all layers; Spark for ELT; Trino (or Databricks SQL) for BI; a catalog for governance.' },
      { name: 'Lakehouse storage, warehouse serving', summary: 'Raw and cleaned data (bronze/silver) in open Iceberg tables on S3, used directly by Spark/ML. Curated gold marts for BI in the warehouse, built from those tables (or read in place as external Iceberg tables).' },
    ],
    recommended: 2,
    considerations: [
      { label: 'Data volume and storage/compute cost', keywords: ['volume', 'tb', 'cost', 'storage', 'compute', 'credits', 'cheap', 'expensive', 'scan'], why: '1.5 TB/day of telemetry is ~550 TB a year. Object storage is cheap per TB; the expensive part is warehouse compute spent transforming and scanning raw telemetry most people never query.' },
      { label: 'Workload mix: SQL BI vs Python/Spark ML', keywords: ['ml', 'python', 'spark', 'notebook', 'training', 'bi', 'sql', 'analyst', 'looker', 'workload'], why: 'Analysts need fast, concurrent SQL; ML needs bulk reads of months of raw data in Spark/Python. One engine is rarely best at both.' },
      { label: 'Open formats and lock-in', keywords: ['open', 'lock-in', 'lock in', 'vendor', 'iceberg', 'delta', 'format', 'portab', 'engine'], why: 'Open table formats let several engines read one copy of the data, and keep a 7-year archive readable without a specific vendor.' },
      { label: 'Operational burden on a 5-person team', keywords: ['ops', 'operat', 'maintenance', 'compaction', 'team', 'managed', 'platform', 'tuning'], why: 'A warehouse is close to zero-ops. A lakehouse means compaction, snapshot expiry, catalog and engine tuning, which is real work for 5 people.' },
      { label: 'BI concurrency and latency', keywords: ['concurren', 'dashboard', 'latency', 'p99', 'interactive', 'cache', 'fast'], why: 'Warehouses are tuned for many concurrent interactive queries with result caching; Trino on a lake can do it but needs care.' },
      { label: 'Governance, PII and retention', keywords: ['pii', 'governance', 'access', 'catalog', 'lineage', 'retention', 'regulat', 'gdpr', 'mask', 'audit'], why: 'Fintech data needs column-level access control, masking, lineage and auditable retention/erasure in whichever store holds PII.' },
    ],
    expert: {
      decision: 'Use Iceberg on S3 as the system of record for raw and cleaned data (bronze/silver), registered in one catalog, with Spark for heavy transforms and ML. Build curated gold marts for finance and analysts in the warehouse, reading Iceberg directly where the warehouse supports it, otherwise loading only the gold layer.',
      rationale: [
        'Telemetry dominates volume but is read mostly by ML in bulk; keeping it in open tables on S3 avoids paying warehouse compute to ingest and store hundreds of TB that analysts rarely touch.',
        'Analysts and finance get what warehouses are best at: concurrent, cached, low-ops SQL on modest, well-modelled marts.',
        'One open copy of raw and silver data serves Spark, Trino and the warehouse, and the 7-year archive stays readable without a specific vendor.',
        'Starting warehouse-only would also be defensible for the relational data alone; the telemetry and ML workload are what tip the balance.',
      ],
      consequences: [
        'The team now operates table maintenance (compaction, snapshot expiry) and a catalog; automate it from day one.',
        'Two engines mean two cost models and two places to enforce access policies; use the catalog as the single source of permissions where possible.',
        'Gold marts are a copy (or an external read) of silver; the boundary between "lake" and "warehouse" must be documented and owned.',
      ],
      revisitWhen: 'If ML moves fully into the warehouse’s own Python runtime and telemetry volume stays small, collapse onto the warehouse; if BI on Trino/Databricks SQL proves good enough, drop the warehouse layer and run a pure lakehouse.',
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'adr-lambda-vs-kappa',
    title: 'Ad-click aggregation: Lambda or Kappa?',
    context:
      'An ad network aggregates clicks and impressions (200,000 events/s at peak) for two consumers: advertiser dashboards and budget pacing that need per-minute counts within seconds, and invoicing that needs exact, auditable daily totals (deduplicated, bot-filtered, late events included up to 24 h). Raw events land in Kafka (7-day retention, tiered storage available) and in an Iceberg bronze table. The team today runs a Flink job and a nightly Spark job that compute the same counts separately, and they disagree by 0.5-2% every day.',
    patterns: ['lambda-kappa', 'exactly-once', 'late-data', 'ad-click'],
    options: [
      { name: 'Lambda: keep both layers', summary: 'Flink speed layer for live counts, Spark batch layer as the source of truth for invoicing, merged at serving time. Two codebases.' },
      { name: 'Kappa: one event-time streaming pipeline', summary: 'A single Flink job (event time, watermarks, dedup by click id, exactly-once sinks) produces both live and final counts; reprocessing replays history through the same code (Kafka tiered storage or Iceberg as a bounded source).' },
      { name: 'Batch only, every 5 minutes', summary: 'Drop streaming and run Spark micro-batches every 5 minutes for everything.' },
    ],
    recommended: 1,
    considerations: [
      { label: 'One codebase vs two that drift', keywords: ['codebase', 'drift', 'two code', 'duplicate logic', 'same code', 'one code', 'single code', 'logic', 'maintain'], why: 'The 0.5-2% daily gap is the classic Lambda cost: the same business rules implemented twice, changed at different times, never quite equal.' },
      { label: 'Reprocessing and backfill', keywords: ['replay', 'reprocess', 'backfill', 'retention', 'tiered', 'history', 'bounded', 'rerun'], why: 'Kappa’s answer to bug fixes is "replay through the fixed job". That needs history to replay from (tiered Kafka or the Iceberg bronze table) and a job that can run over it at high speed.' },
      { label: 'Correctness: dedup, late data, exactly-once', keywords: ['exactly-once', 'exactly once', 'dedup', 'duplicate', 'late', 'watermark', 'event time', 'event-time', 'idempot'], why: 'Billing-grade counts from a stream need event-time windows, deduplication by click id, allowed lateness up to 24 h (with upserts) and transactional or idempotent sinks.' },
      { label: 'Freshness requirements', keywords: ['freshness', 'seconds', 'pacing', 'real-time', 'real time', 'latency'], why: 'Budget pacing needs seconds; 5-minute batches overspend budgets for high-velocity campaigns.' },
      { label: 'Auditability and reconciliation', keywords: ['audit', 'reconcil', 'invoice', 'billing', 'verify', 'check', 'final'], why: 'Invoices must be reproducible. A scheduled reconciliation against the bronze table (a check, not a second serving path) gives auditors confidence.' },
      { label: 'Cost and operational load', keywords: ['cost', 'compute', 'ops', 'on-call', 'team', 'double', 'operat'], why: 'Two pipelines double compute and on-call surface; one well-built streaming job with occasional replays is usually cheaper.' },
    ],
    expert: {
      decision: 'Move to Kappa: a single Flink job with event-time windows, dedup by click id, 24 h allowed lateness writing upserts per (campaign, minute), feeding both dashboards and the daily invoice table. Reprocess by running the same job over the Iceberg bronze table as a bounded source. Keep a nightly reconciliation job that compares totals with bronze and alerts, but never serves numbers.',
      rationale: [
        'The divergence between layers is the real problem, and it can only be fixed by having one implementation of the counting rules.',
        'Modern stream processors give the correctness that used to require a batch layer: exactly-once state, event time, watermarks and late-data handling.',
        'Raw events in Iceberg make replays possible beyond Kafka retention with the same code (Flink batch execution mode over a bounded source).',
        'This is the shape Jay Kreps described as "Kappa" (2014) and Uber later extended as "Kappa+" for backfills from the lake.',
      ],
      consequences: [
        'Backfills of months of data require capacity planning: the replay job must run many times faster than real time without disturbing the live job.',
        '24 h allowed lateness means large keyed state; size the state backend (RocksDB) and checkpoint storage accordingly.',
        'The team must be strong at Flink operations: savepoints, upgrades with state, and reprocessing runbooks.',
      ],
      revisitWhen: 'If a workload needs complex logic that is impractical in streaming (large historical joins, ML features over years of history), batch it as a separate product with its own definition rather than a second copy of these counts.',
    },
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'adr-etl-vs-elt',
    title: 'Moving off a legacy ETL server: ETL or ELT?',
    context:
      'A mid-size insurer runs 300 nightly jobs on a legacy ETL server that extracts from ~60 sources (core policy database, claims system, Salesforce, payment provider), transforms in proprietary mappings, and loads only finished reporting tables into an on-prem database. They are moving to a cloud warehouse. Problems today: nobody can answer questions the mappings didn’t anticipate, reprocessing a month takes days, and only two people understand the tool. Constraint: full card numbers from the payment provider must never land in the analytics environment (PCI DSS scope), and health data in claims is restricted.',
    patterns: ['batch-elt', 'warehouse', 'governance'],
    options: [
      { name: 'ETL in Spark/Python', summary: 'Rebuild the jobs as Spark/Python transforms that run before load; only curated tables land in the warehouse.' },
      { name: 'Pure ELT', summary: 'Managed connectors load every source as-is into raw schemas; all transformation happens in the warehouse with dbt (SQL, version-controlled, tested).' },
      { name: 'ELT with targeted pre-load controls', summary: 'ELT by default (raw → staging → marts in dbt), but sensitive fields are dropped, tokenized or hashed in the connector/ingest step so PCI and restricted data never land in raw.' },
    ],
    recommended: 2,
    considerations: [
      { label: 'Keeping raw data for new questions and reprocessing', keywords: ['raw', 'replay', 'reprocess', 'backfill', 'history', 'new question', 'rebuild', 'recompute'], why: 'ELT keeps the untransformed source in the warehouse, so a new question or a logic fix is a SQL change plus a rebuild, not a re-extract from 60 systems.' },
      { label: 'Who writes transformations', keywords: ['analyst', 'sql', 'dbt', 'self-serve', 'self serve', 'analytics engineer', 'skills', 'hire'], why: 'SQL in dbt is readable by analysts and analytics engineers; proprietary or Spark-heavy ETL concentrates knowledge in a few people, which is today’s problem.' },
      { label: 'Compliance: PCI, PII and restricted data', keywords: ['pci', 'pii', 'gdpr', 'hipaa', 'mask', 'tokeniz', 'hash', 'sensitive', 'compliance', 'scope', 'restricted'], why: 'Some data must never land at all. Filtering or tokenizing before load is the one place where "transform first" is required, not optional.' },
      { label: 'Testing, lineage and change management', keywords: ['test', 'lineage', 'version', 'git', 'ci/cd', 'pull request', 'review', 'document'], why: 'dbt gives tests, lineage graphs and code review for every model; legacy mappings are opaque.' },
      { label: 'Where compute is spent and what it costs', keywords: ['cost', 'compute', 'credits', 'warehouse', 'expensive', 'efficien'], why: 'ELT spends warehouse compute on transforms. It is usually cheaper than running and staffing a separate ETL cluster, but full rebuilds of large models need incremental strategies.' },
      { label: 'Transforms SQL handles badly', keywords: ['python', 'spark', 'complex', 'unstructured', 'ml', 'nested', 'json', 'documents', 'pdf'], why: 'Parsing claim documents or heavy ML feature engineering still belongs in Python/Spark; ELT doesn’t ban that, it just isn’t the default.' },
    ],
    expert: {
      decision: 'Adopt ELT (managed connectors → raw → dbt staging/marts in the warehouse) as the default. Apply ETL-style controls only at ingest for sensitive fields: card numbers are dropped or replaced by the payment provider’s tokens before load, and restricted claims fields are hashed or loaded into a separately governed schema. Use Python/Spark only for the few transforms SQL can’t express well.',
      rationale: [
        'Keeping raw data in the warehouse fixes the main complaint: new questions and reprocessing become SQL changes and rebuilds, not projects.',
        'dbt makes transformations readable, tested and reviewed, which ends the two-person dependency on a proprietary tool.',
        'Compliance is the legitimate reason to transform before load; scoping it to specific fields keeps PCI data out of the analytics environment without giving up ELT everywhere else.',
        'Managed connectors remove most custom extraction code for the 60 sources.',
      ],
      consequences: [
        'Warehouse compute becomes the main cost driver; invest early in incremental models and cost monitoring.',
        'Raw schemas contain everything else as-is; they need strict access control, classification tags and retention policies.',
        'Schema changes in sources now flow straight into raw; add source freshness checks, tests and contracts with source owners.',
      ],
      revisitWhen: 'Data volume makes in-warehouse transforms clearly more expensive than a lake engine, a large share of transforms becomes non-SQL (documents, ML), or regulation expands the set of fields that must be filtered before load.',
    },
  },
];
