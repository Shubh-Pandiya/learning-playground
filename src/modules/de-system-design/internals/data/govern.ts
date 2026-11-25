import type { Internals } from '../types';

const DQ: Internals = {
  kind: 'dq',
  summary:
    'A data quality gate turns assumptions about data ("`order_id` is unique", "yesterday’s partition has ~2M rows", "`amount` is never negative") into **executable checks** that run between write and publish. Rule-based tests catch known failure modes, ML monitors catch unknown drift, and a failing **blocking** check stops the pipeline (circuit breaker) and quarantines the batch instead of letting bad numbers reach dashboards.',
  parts: [
    { id: 'contract', name: 'Data contract', role: 'Producer-owned schema, semantics and SLAs', detail: 'A versioned spec (YAML/protobuf) owned by the producing team: column names and types, allowed values, nullability, primary key, freshness SLA and owner. Breaking changes are caught in **CI** (schema diff on the PR) before deploy, and at runtime by schema registries and dbt `contract: {enforced: true}`.' },
    { id: 'suite', name: 'Expectations / tests', role: 'Declarative rules over a dataset', detail: 'Great Expectations **expectations** (`expect_column_values_to_not_be_null`, `..._to_be_between`) grouped into **suites**; dbt generic tests (`unique`, `not_null`, `accepted_values`, `relationships`) compile to SQL that returns failing rows. Each rule has a severity: `warn` or `error`.' },
    { id: 'checkpoint', name: 'Checkpoint / runner', role: 'Runs suites against a batch', detail: 'A GE **checkpoint** binds a suite to a batch (e.g. partition `dt=2026-11-25` in staging), runs it and triggers actions (store results, Slack, Data Docs). In dbt, `dbt build` runs each model’s tests right after the model and **skips downstream models** if an `error` test fails.' },
    { id: 'monitors', name: 'Observability monitors', role: 'Freshness, volume, schema, distribution anomalies', detail: 'Tools like Monte Carlo, Soda or Elementary read warehouse metadata and query logs to learn baselines per table: **freshness** (last update), **volume** (row count vs seasonal forecast), **schema** (columns added/dropped/retyped) and **field health/distribution** (null rate, mean, distinct count). No rules to write, but they alert after the fact unless wired as gates.' },
    { id: 'gate', name: 'Circuit breaker & quarantine', role: 'Blocks publish, isolates bad data', detail: '**Write-audit-publish**: write to a staging table or an Iceberg branch, audit, then publish (fast-forward the branch or swap the table). Failing rows go to a `_quarantine` table with the reason; a failing batch keeps consumers on yesterday’s good data.' },
    { id: 'alerting', name: 'Alerting & incident', role: 'Routes failures to owners with lineage', detail: 'Failures page the dataset owner (from the catalog), with downstream impact from lineage ("12 dashboards and the revenue model read this"). Results are stored to track data downtime and tune noisy checks.' },
  ],
  flow: [
    { part: 'contract', title: 'Contract defines expectations', text: 'The payments team publishes a contract for `payments.v3`: `payment_id` unique, `currency` in ISO-4217, `amount_cents >= 0`, freshness < 1 h. A PR that renames `amount_cents` fails CI as a breaking change.' },
    { part: 'suite', title: 'Suite derived from contract', text: 'The contract compiles into a suite: uniqueness, accepted values, range, plus a volume check of "within 30% of the same weekday last 4 weeks".' },
    { part: 'checkpoint', title: 'Batch audited before publish', text: 'Airflow loads today’s data into `staging.payments`, then runs the checkpoint against that partition only. 0.2% of rows have `currency = \u2018XXX\u2019`.' },
    { part: 'gate', title: 'Quarantine or block', text: 'Rows failing a `warn`-level rule go to `payments_quarantine` and the rest publish. Had the volume check failed (row count -80%: an upstream outage), the `error` severity would trip the circuit breaker and stop downstream tasks.' },
    { part: 'monitors', title: 'Monitors watch what rules miss', text: 'An ML monitor notices `refund_rate` distribution shifted 3 sigma after a mobile release: no explicit rule covered it, but the baseline did.' },
    { part: 'alerting', title: 'Owner alerted with impact', text: 'The on-call gets a Slack alert listing the failed check, sample bad rows and downstream assets from lineage. Consumers saw yesterday’s correct numbers, not today’s broken ones.' },
  ],
  knobs: [
    {
      name: 'Where checks run',
      options: [
        { label: 'After publish (monitor only)', effect: 'Easy to adopt, zero pipeline changes; consumers may already have seen bad data before the alert.', when: 'Broad coverage across hundreds of tables as a safety net.' },
        { label: 'Before publish (write-audit-publish gate)', effect: 'Bad data never reaches consumers; adds latency and a failure point that can block freshness.', when: 'Tier-1 tables: finance, metrics shown to execs or customers, ML training data.' },
      ],
    },
    {
      name: 'Failure handling',
      options: [
        { label: 'Fail the batch (hard stop)', effect: 'Guarantees no bad data downstream; one bad row can delay everything.', when: 'Structural problems: schema break, volume collapse, duplicate keys.' },
        { label: 'Quarantine bad rows', effect: 'Pipeline continues with good rows; you must monitor the quarantine rate and reprocess.', when: 'Row-level validity issues at small rates (< ~1%).' },
        { label: 'Warn only', effect: 'No disruption; risk of alert fatigue.', when: 'New or soft checks still being tuned.' },
      ],
    },
    {
      name: 'Rule source',
      options: [
        { label: 'Hand-written rules', effect: 'Precise, explainable, versioned with code; only catches what you thought of.', when: 'Known invariants and contracts.' },
        { label: 'Learned anomaly baselines', effect: 'Catches unknown unknowns (seasonality-aware); can be noisy and needs feedback.', when: 'Wide coverage of volume/freshness/distribution.' },
      ],
    },
  ],
  implementations: [
    { name: 'Great Expectations', how: 'Python library: expectations → suites → checkpoints with actions; runs on Pandas, Spark or SQL engines; renders Data Docs. Often invoked from Airflow as a gating task.' },
    { name: 'dbt tests & contracts', how: 'Generic and singular tests compiled to SQL returning failing rows, severity and thresholds (`error_if: ">100"`), model contracts enforcing column types at build, `dbt build` skipping children of failed tests.' },
    { name: 'Monte Carlo / Soda / Elementary', how: 'Data observability: metadata-based freshness, volume and schema monitors plus field-level distribution checks, with lineage for impact analysis. Soda uses SodaCL check files; Elementary runs as a dbt package.' },
  ],
  ha: 'The gate is control-plane: it holds no data, so its availability matters mostly because a blocking gate that is down blocks publishing. Make checks idempotent and rerunnable, store results durably, and decide explicitly whether a gate outage fails open (publish with warning) or closed (hold). Scale by pushing checks into the warehouse/Spark as SQL instead of pulling data into Python, and by sampling or checking only the new partition.',
  failureModes: [
    { name: 'Checks after publish', symptom: 'The CFO’s dashboard showed revenue down 40% for 3 hours before the alert fired.', fix: 'Write-audit-publish for tier-1 tables: audit in staging or on a branch, then publish atomically.' },
    { name: 'Alert fatigue', symptom: '200 warn-level alerts a day; the channel is muted and the real incident is missed.', fix: 'Fewer, owned checks with severity tiers; tune thresholds; route to owners; delete checks nobody acts on.' },
    { name: 'Silent upstream schema change', symptom: 'A producer changed `amount` from dollars to cents; all rules still pass because types are the same.', fix: 'Producer-owned contracts with semantic fields, CI diffing, distribution monitors on key metrics.' },
    { name: 'Quarantine black hole', symptom: 'Quarantined rows pile up for months; revenue quietly understated by 2%.', fix: 'Monitor quarantine rate as a metric, alert above a threshold, and own the reprocessing.' },
  ],
  numbers: ['Typical volume check tolerance: ±20–30% vs same weekday baseline', 'Freshness SLA tiers: < 1 h for operational, < 24 h for daily marts', 'Quarantine rates > ~1% usually mean a systemic issue, not bad rows', 'Data downtime = time to detect + time to resolve; gates cut detection to minutes'],
  interview: [
    { q: 'How do you prevent bad data from reaching an executive dashboard?', a: 'Write-audit-publish. Load into staging (or an Iceberg/Nessie branch), run blocking checks on the new partition only: schema/contract, uniqueness of keys, volume vs seasonal baseline, freshness, null rates and business invariants (revenue >= 0, totals reconcile with the source). If error-level checks pass, publish atomically (table swap or branch fast-forward); otherwise stop downstream tasks, keep yesterday’s data visible, and page the owner with lineage impact. Row-level issues below a threshold go to quarantine instead of blocking.' },
    { q: 'What is a data contract and how is it enforced?', a: 'An explicit, versioned agreement owned by the producer about a dataset or event: schema, types, semantics, keys, allowed values, SLAs and owner. It moves quality left: changes are checked in the producer’s CI (breaking-change diff, consumers notified), at runtime by schema registry compatibility rules for events and dbt model contracts in the warehouse, and by quality checks generated from the contract. The point is that the team that can break the data is the one accountable for it.' },
  ],
};

const CATALOG: Internals = {
  kind: 'catalog',
  summary:
    'A data catalog is a **metadata graph**: datasets, columns, jobs, dashboards and people as nodes, with ownership and **lineage** as edges. Connectors crawl systems and jobs **emit events** as they run, a metadata service stores it, and a search index makes it discoverable. It answers "what is this, who owns it, can I trust it, and what breaks if I change it?".',
  parts: [
    { id: 'sources', name: 'Ingestion connectors (pull)', role: 'Crawl warehouses, BI, dbt, Kafka', detail: 'Scheduled recipes connect to Snowflake, BigQuery, Glue, Kafka, Looker and dbt (`manifest.json`, `catalog.json`) to extract schemas, descriptions, tags, usage stats and query logs. Glue crawlers infer schemas from S3 files.' },
    { id: 'emitters', name: 'Runtime emitters (push)', role: 'Jobs report inputs/outputs as they run', detail: '**OpenLineage** integrations in Spark, Airflow, Flink and dbt emit `RunEvent`s (`START`/`COMPLETE`) naming input and output datasets with facets: schema, row counts and **columnLineage**. Push gives accurate, timely lineage without parsing SQL.' },
    { id: 'parser', name: 'Query log / SQL lineage parser', role: 'Derives lineage from executed SQL', detail: 'Parses warehouse query history (Snowflake `ACCESS_HISTORY`, BigQuery `INFORMATION_SCHEMA.JOBS`) with a SQL parser (sqlglot-based in DataHub) to extract `INSERT ... SELECT` table and column lineage, including ad-hoc jobs nobody registered.' },
    { id: 'store', name: 'Metadata service & store', role: 'Versioned aspects of every entity', detail: 'DataHub’s GMS stores entities as typed **aspects** (schema, ownership, tags, glossary terms) in MySQL/Postgres keyed by URN, accepts changes as Metadata Change Proposals over REST/Kafka and emits change logs others can subscribe to. Unity Catalog additionally enforces **grants** on catalog.schema.table.' },
    { id: 'graph', name: 'Lineage graph', role: 'Upstream/downstream traversal at column level', detail: 'Edges dataset → job → dataset and column → column, stored in a graph index (Elasticsearch or Neo4j). Impact analysis is a downstream traversal: "this column feeds 3 models and 14 dashboards owned by these teams".' },
    { id: 'search', name: 'Search & UI', role: 'Discovery ranked by usage and trust', detail: 'An Elasticsearch index over names, descriptions, columns, tags and owners, **ranked by usage** (query counts, popular users) and certification badges, so `revenue` returns the certified mart before 40 scratch tables.' },
  ],
  flow: [
    { part: 'sources', title: 'Crawl schemas and owners', text: 'A nightly recipe ingests 12,000 Snowflake tables with columns, descriptions and dbt metadata (owners, tests, docs) from `manifest.json`.' },
    { part: 'emitters', title: 'Job emits lineage', text: 'The Spark job `build_fct_orders` runs; its OpenLineage listener emits `COMPLETE` with inputs `raw.orders`, `raw.customers`, output `fct_orders`, and column lineage `fct_orders.revenue ← raw.orders.amount, raw.orders.fx_rate`.' },
    { part: 'parser', title: 'Ad-hoc SQL parsed', text: 'An analyst’s scheduled `CREATE TABLE tmp_rev AS SELECT ... FROM fct_orders` shows up in query history; the parser adds an edge nobody declared.' },
    { part: 'store', title: 'Metadata stored as aspects', text: 'Each fact is written as an aspect on a URN like `urn:li:dataset:(snowflake,prod.fct_orders,PROD)`, versioned so you can see when ownership or schema changed.' },
    { part: 'graph', title: 'Impact analysis', text: 'An engineer plans to change `raw.orders.amount` to cents. Downstream traversal shows 2 dbt models, a churn model and 14 Looker dashboards, with owners to notify.' },
    { part: 'search', title: 'Discovery', text: 'A new analyst searches "revenue" and gets `fct_orders` first: certified, owned by Finance Data, 4,000 queries last month, tests passing.' },
  ],
  knobs: [
    {
      name: 'Lineage collection',
      options: [
        { label: 'Push (OpenLineage from jobs)', effect: 'Accurate, real-time, includes non-SQL jobs (Spark, Python); requires instrumenting every runtime.', when: 'Orchestrated pipelines you control.' },
        { label: 'Pull (parse query logs)', effect: 'Zero instrumentation and catches ad-hoc SQL; misses non-SQL processing and complex dynamic SQL.', when: 'Warehouse-centric stacks; as a complement to push.' },
      ],
    },
    {
      name: 'Catalog role',
      options: [
        { label: 'Discovery catalog (DataHub, Atlan)', effect: 'Indexes everything across tools; does not enforce access.', when: 'Heterogeneous stacks needing search, lineage and ownership.' },
        { label: 'Governing catalog (Unity, Glue + Lake Formation, Polaris)', effect: 'The engines resolve tables and permissions through it, so policy is enforced, not just documented.', when: 'Central access control over a lakehouse.' },
      ],
    },
  ],
  implementations: [
    { name: 'DataHub', how: 'LinkedIn-born: pull recipes + push emitters, GMS with aspect store in MySQL, Kafka change streams, Elasticsearch for search and graph, column-level lineage via SQL parsing and OpenLineage.' },
    { name: 'Unity Catalog', how: 'Databricks’ governing catalog: three-level namespace, grants and row/column policies enforced by compute, automatic runtime lineage capture for notebooks, jobs and SQL; open-sourced as an Iceberg REST-compatible catalog.' },
    { name: 'AWS Glue Data Catalog', how: 'Hive-metastore-compatible table catalog used by Athena, EMR and Redshift Spectrum; crawlers infer schemas and partitions; Lake Formation adds fine-grained permissions. More table registry than discovery tool.' },
    { name: 'OpenLineage + Marquez', how: 'Open standard for run/job/dataset events with extensible facets; Marquez is the reference backend. Integrations exist for Airflow, Spark, Flink and dbt.' },
  ],
  ha: 'A discovery catalog is off the data path: if it is down, pipelines still run and only discovery and lineage updates lag (push events can buffer in Kafka). A governing catalog (Unity, Glue, Iceberg REST) is on the query path for table resolution and auth, so it needs multi-AZ HA and caching in engines. Scale ingestion by running recipes incrementally and processing push events asynchronously.',
  failureModes: [
    { name: 'Stale, manual metadata', symptom: 'Wiki-documented lineage is months out of date; a "safe" column drop breaks the board deck.', fix: 'Automate: OpenLineage from jobs plus query-log parsing; treat the catalog as generated, not written.' },
    { name: 'No ownership', symptom: '40% of tables have no owner; alerts go nowhere, nobody can approve access.', fix: 'Require owner in dbt/contracts to deploy; ownership from code (CODEOWNERS); report coverage.' },
    { name: 'Search drowned in junk', symptom: 'Searching "revenue" returns 300 tables, mostly temp and deprecated ones.', fix: 'Usage-based ranking, certification badges, deprecation flags, auto-hide unused tables.' },
  ],
  numbers: ['Large orgs: 10^5–10^6 datasets, 10^7 columns in the graph', 'Push lineage latency: seconds; pull recipes: hourly/daily', 'Column-level lineage: typically 5–20 upstream columns per mart column'],
  interview: [
    { q: 'How would you build column-level lineage across Airflow, Spark and Snowflake?', a: 'Combine push and pull. Instrument Spark and Airflow with OpenLineage so every run emits inputs, outputs and the columnLineage facet from the Spark logical plan. For Snowflake, parse `ACCESS_HISTORY`/query history with a SQL parser to derive `INSERT ... SELECT` column mappings, and ingest dbt’s manifest for model-level lineage. Normalize everything to the same dataset URNs, store as a graph and expose upstream/downstream traversal for impact analysis.' },
    { q: 'What is the difference between a discovery catalog and a governing catalog?', a: 'A discovery catalog (DataHub, Amundsen) indexes metadata from many systems for search, lineage and ownership, but engines do not consult it, so it can document policy but not enforce it. A governing catalog (Unity, Glue + Lake Formation, Iceberg REST catalogs) is in the query path: engines resolve tables and permissions through it, so grants, row filters and column masks are enforced uniformly. Many companies run both.' },
  ],
};

const PII: Internals = {
  kind: 'pii',
  summary:
    'PII governance means **find it, minimize it, control it, and be able to delete it**. Classifiers tag sensitive columns; ingestion tokenizes, hashes or encrypts them so raw values never spread; policies mask columns and filter rows by role at query time; and deletes (GDPR right to erasure) are honored across immutable lake files, often by **crypto-shredding**: destroying a per-user key.',
  parts: [
    { id: 'classify', name: 'Classifier', role: 'Detects and tags sensitive columns', detail: 'Scans samples with regex, dictionaries, checksums (Luhn for card numbers) and ML (AWS Macie, Google DLP, BigID) to tag columns like `pii.email`, `pii.phone`, `pii.ssn`. Tags propagate downstream via lineage so derived columns inherit them.' },
    { id: 'tokenize', name: 'Tokenization / pseudonymization', role: 'Replaces raw values at ingestion', detail: '**Vault tokenization** maps value → random token in a secured lookup (reversible only via the vault); **deterministic** tokens or **keyed HMAC** keep joins working. Plain SHA-256 of an email or phone is reversible by dictionary attack, so always use a secret key. Format-preserving encryption (FF1/FF3-1) keeps the shape (e.g. 16 digits).' },
    { id: 'crypto', name: 'Per-subject encryption keys', role: 'Enables crypto-shredding', detail: 'PII fields are encrypted with a **per-user data key** held in a KMS-backed key store. Deleting the key makes every copy unreadable: in Parquet files, Kafka topics, backups and snapshots, without rewriting them.' },
    { id: 'policy', name: 'Policy engine', role: 'Column masks and row filters by role', detail: 'Tag-based policies (Unity column masks/row filters, Snowflake masking + row access policies, Lake Formation, Immuta) evaluated at query time: support sees `j***@gmail.com`, fraud sees the full email, EU analysts see only EU rows.' },
    { id: 'engine', name: 'Query engine enforcement', role: 'Applies policies during every query', detail: 'The engine rewrites the query: `email` becomes `CASE WHEN is_member(\u2018pii_readers\u2019) THEN email ELSE mask(email) END`, and a row filter adds `WHERE region IN (...)`. Enforcement must be in the engine, not in BI tools, or direct SQL bypasses it.' },
    { id: 'erasure', name: 'Deletion workflow', role: 'Honors right-to-be-forgotten requests', detail: 'A request keyed by user id fans out to every system: delete rows in lakehouse tables (row-level deletes), expire snapshots and vacuum files, delete or shred keys for immutable stores, and log completion for audit. GDPR expects this "without undue delay", generally within **one month**.' },
  ],
  flow: [
    { part: 'classify', title: 'Column classified', text: 'A scan of `raw.signups` finds that 98% of `contact` values match an email pattern and tags it `pii.email`; lineage propagates the tag to 6 downstream tables.' },
    { part: 'tokenize', title: 'Tokenized at ingestion', text: 'The ingestion job replaces `email` with `HMAC(key, lower(email))`, giving a stable token that still joins across tables. Raw email only lives in one access-controlled vault table.' },
    { part: 'crypto', title: 'Encrypted with a user key', text: 'Free-text fields that may contain PII (addresses, notes) are encrypted with user 42’s data key before landing in the lake and in Kafka.' },
    { part: 'policy', title: 'Policy attached by tag', text: 'One policy says "columns tagged `pii.*` are masked unless the user is in `pii_readers`"; it applies automatically to every table carrying the tag, including new ones.' },
    { part: 'engine', title: 'Masked at query time', text: 'A marketing analyst runs `SELECT email, ltv FROM customers` and sees masked emails; a fraud investigator running the same query sees clear text. Both are audited.' },
    { part: 'erasure', title: 'Erasure request', text: 'User 42 asks to be deleted. The workflow runs `DELETE FROM ... WHERE user_id = 42` on lakehouse tables, expires snapshots and vacuums so old files go away, deletes user 42’s data key (shredding Kafka and backups), removes the vault entry and records proof.' },
  ],
  knobs: [
    {
      name: 'Protection technique',
      options: [
        { label: 'Masking (dynamic)', effect: 'Data stored in clear, hidden at query time per role; easy, but the raw value exists everywhere it was copied.', when: 'Warehouse/lakehouse access control for analysts.' },
        { label: 'Tokenization (vault or deterministic)', effect: 'Raw value removed from analytics entirely; joins still work with deterministic tokens; detokenization is a controlled, audited call.', when: 'Emails, phones, card numbers flowing into the lake.' },
        { label: 'Keyed hashing (HMAC)', effect: 'Irreversible pseudonym good for joins and counting distincts; no way back to the value even when legitimately needed.', when: 'Analytics that only need identity, never the value.' },
      ],
    },
    {
      name: 'Deletion strategy',
      options: [
        { label: 'Physical row delete', effect: 'Exact, but every table, snapshot, Kafka topic and backup must be found and rewritten; expensive on immutable files.', when: 'Lakehouse tables with MOR deletes and short snapshot retention.' },
        { label: 'Crypto-shredding', effect: 'Delete one key and all copies become unreadable, including backups; requires encryption at write time and key management at scale.', when: 'Immutable logs, backups, event stores.' },
      ],
    },
  ],
  implementations: [
    { name: 'Snowflake / Unity Catalog policies', how: 'Tag-based masking policies and row access policies (Snowflake); column masks and row filters as SQL UDFs attached to tables or tags (Unity). Enforced inside the engine for every query path.' },
    { name: 'Tokenization services', how: 'Vault-based (Skyflow, VGS, in-house vaults with KMS) or vaultless FPE (Protegrity, Voltage). Uber and Airbnb run internal tokenization at ingestion so raw PII never lands in the lake.' },
    { name: 'Lakehouse deletes', how: 'Iceberg/Delta `DELETE` with deletion vectors or position deletes, then `expire_snapshots` / `VACUUM` to physically remove old files within the deletion SLA.' },
  ],
  ha: 'Policy enforcement lives in the query engines and catalogs, so it is as available as they are; it must fail closed (deny) rather than open. Token vaults and key stores are on the hot path of ingestion and detokenization, so they need multi-AZ replication, caching of keys (short TTL) and strict backup of keys, since losing a key store is irreversible data loss. Erasure workflows are asynchronous, idempotent and retried until every system confirms.',
  failureModes: [
    { name: 'PII sprawl', symptom: 'Raw emails copied into 300 tables and exports; a single deletion request takes weeks and misses copies.', fix: 'Tokenize at ingestion, classify continuously, propagate tags via lineage, block untagged PII from leaving the raw zone.' },
    { name: 'Unsalted hashes', symptom: '`sha256(email)` in a shared dataset is reversed by hashing a list of known emails.', fix: 'Keyed HMAC with a secret in KMS, or vault tokens; treat hashes as personal data (pseudonymous, not anonymous).' },
    { name: 'Deletes that do not delete', symptom: 'Rows deleted from the table are still in time-travel snapshots, old Parquet files and backups.', fix: 'Expire snapshots and vacuum within the SLA, crypto-shred backups, verify by scanning files.' },
    { name: 'Masking only in BI', symptom: 'Dashboards hide emails but anyone with SQL access selects them directly.', fix: 'Enforce policies in the engine/catalog, least-privilege grants, audit logs.' },
  ],
  numbers: ['GDPR erasure: without undue delay, generally ≤ 1 month', 'GDPR fines up to 4% of global annual revenue', 'Lakehouse snapshot retention must be shorter than the deletion SLA (e.g. 7 days)', 'One key per user: millions of keys, cached with short TTLs'],
  interview: [
    { q: 'How do you implement GDPR deletes in a data lake of immutable Parquet files?', a: 'Use a table format that supports row-level deletes (Iceberg/Delta/Hudi): `DELETE WHERE user_id = X` writes deletion vectors or rewrites affected files. Then make it physical: expire snapshots and vacuum/remove orphan files so time travel cannot resurrect the rows, within the legal window. For immutable stores you cannot rewrite (Kafka, backups), encrypt PII with per-user keys and crypto-shred by deleting the key. Minimize the problem upfront by tokenizing at ingestion so most tables hold only tokens, and track every copy via lineage.' },
    { q: 'Tokenization vs masking vs hashing: when do you use each?', a: 'Masking hides values at query time by role, while the data stays in clear underneath: good for analyst access control, but copies spread the raw value. Tokenization replaces the value at ingestion with a token; only an audited vault can reverse it, and deterministic tokens keep joins working, so it is best for sensitive identifiers flowing into the lake. Hashing (always keyed HMAC, never plain SHA-256) gives an irreversible pseudonym for joins and distinct counts when nobody ever needs the original. All three are still personal data under GDPR if re-identification is possible.' },
  ],
};

export const GOVERN_INTERNALS: Internals[] = [DQ, CATALOG, PII];
