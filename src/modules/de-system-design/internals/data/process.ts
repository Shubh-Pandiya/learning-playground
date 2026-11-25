import type { Internals } from '../types';

// ───────────────────────────── flink ─────────────────────────────
const FLINK: Internals = {
  kind: 'flink',
  summary:
    'Flink runs a streaming job as a graph of long-lived parallel operators. Events flow continuously; per-key state lives next to the operator in **RocksDB**; **watermarks** tell windows when event time has advanced; and periodic **checkpoint barriers** snapshot every operator’s state plus the source offsets as one consistent cut (Chandy–Lamport). On failure the job rewinds to the last checkpoint, and **two-phase-commit sinks** make the output exactly-once too.',
  parts: [
    { id: 'jobmanager', name: 'JobManager', role: 'Plans, schedules and coordinates checkpoints', detail: 'Turns the program into a JobGraph and then a parallel **ExecutionGraph**, asks the ResourceManager for task slots and deploys tasks. Its **CheckpointCoordinator** triggers checkpoints every 10–60 s and records completed ones in HA storage.' },
    { id: 'source', name: 'Source + watermarks', role: 'Reads splits, stamps event time', detail: 'The Kafka source assigns partitions (splits) to subtasks and tracks their offsets in state. A `WatermarkStrategy` extracts the event timestamp and emits **watermarks** such as `max_seen − 5 s` per partition; `withIdleness` stops an idle partition from holding time back.' },
    { id: 'chain', name: 'Operator chains in slots', role: 'Fuses operators into one thread', detail: 'TaskManagers (JVM workers) offer **task slots**. Consecutive operators with the same parallelism and no repartition (source → parse → filter) are **chained** into one task: records pass as method calls, with no serialization or network hop.' },
    { id: 'shuffle', name: 'keyBy network shuffle', role: 'Routes each key to one subtask', detail: '`keyBy(user_id)` hashes the key into one of `maxParallelism` **key groups** (≥128), each owned by one subtask. Records travel in 32 KB network buffers with **credit-based flow control**, so a slow downstream naturally back-pressures the upstream.' },
    { id: 'state', name: 'Keyed state (RocksDB)', role: 'Per-key state on local disk', detail: 'The RocksDB state backend keeps `ValueState`/`MapState` per key in an embedded LSM store on local SSD, so state can be far larger than memory (TBs per job). Checkpoints upload **incremental** SST files to S3, so each checkpoint ships only what changed.' },
    { id: 'window', name: 'Windows & timers', role: 'Groups by event time, fires on watermark', detail: 'Tumbling, sliding and session windows keep their accumulators in keyed state and register an event-time timer at window end. The window fires when the watermark passes the end; `allowedLateness` keeps it updatable a bit longer and later records go to a **side output**.' },
    { id: 'sink', name: 'Two-phase-commit sink', role: 'Commits output only with the checkpoint', detail: 'Writes go into a Kafka transaction (or pending files for Iceberg/FileSink) that is **pre-committed** when the barrier arrives and **committed** only after the JobManager confirms the checkpoint. `read_committed` consumers never see output from a failed attempt.' },
  ],
  flow: [
    { part: 'jobmanager', title: 'Job deployed', text: 'A sessionization job is submitted with parallelism 24. The JobManager builds the ExecutionGraph and places 24 chained source→parse tasks and 24 window tasks into TaskManager slots.' },
    { part: 'source', title: 'Event read, watermark emitted', text: 'Subtask 6 reads `click{user: 81, ts: 12:00:03}` from partition 14 at offset 77,120. Its watermark is now `12:00:03 − 5 s = 11:59:58`: "no more events older than this are expected".' },
    { part: 'chain', title: 'Parsed in the same thread', text: 'Parse and filter run in the chained task as plain function calls, about a microsecond each. No serialization happens until the record must change subtask.' },
    { part: 'shuffle', title: 'keyBy(user)', text: 'The record is serialized into a network buffer and routed to the subtask owning user 81’s key group. If that subtask is slow, buffer credits run out and the source slows down instead of dropping data.' },
    { part: 'window', title: 'Session updated, then fired', text: 'User 81’s session window (30 min gap) is extended in RocksDB. When the watermark from **all** input channels passes the session end plus the gap, the timer fires and the session row is emitted.' },
    { part: 'state', title: 'Checkpoint barrier n=1,204', text: 'Every 30 s the coordinator injects barrier 1,204 into each source, which snapshots its offsets. Each operator **aligns** barriers from all inputs, snapshots its state asynchronously (RocksDB SST diff to S3) and forwards the barrier. That is a consistent cut of the whole job.' },
    { part: 'sink', title: 'Pre-commit on barrier', text: 'When barrier 1,204 reaches the Kafka sink it flushes and **pre-commits** the open transaction, then opens a new one for checkpoint 1,205.' },
    { part: 'jobmanager', title: 'Checkpoint complete → commit', text: 'All tasks acknowledged, so checkpoint 1,204 is durable and the sink commits its transaction. If a TaskManager crashes later, every task restores from 1,204, sources rewind to its offsets, and the uncommitted transaction is aborted: **exactly-once** end to end.' },
  ],
  knobs: [
    {
      name: 'State backend',
      options: [
        { label: 'HashMap (heap)', effect: 'Fastest access, state is Java objects; limited by heap and GC pauses; full snapshots.', when: 'Small state (≤ a few GB per TaskManager).' },
        { label: 'RocksDB (embedded)', effect: 'State on local SSD, TBs possible, incremental checkpoints; each access serializes, ~2–10× slower than heap.', when: 'Large keyed state, long windows, joins, dedup over days.' },
      ],
    },
    {
      name: 'Checkpoint interval',
      options: [
        { label: '1–10 s', effect: 'Small replay on failure and low latency for transactional sinks; more overhead and many small commits/files.', when: 'Low-latency exactly-once pipelines with small state.' },
        { label: '30–60 s', effect: 'Balanced: modest overhead, output visible to `read_committed` readers within ~a minute.', when: 'Most production jobs.' },
        { label: '5+ min', effect: 'Cheap for huge state, but long replay after failure and output delayed by the interval.', when: 'TB-scale state where uploads take minutes.' },
      ],
    },
    {
      name: 'Sink guarantee',
      options: [
        { label: 'At-least-once', effect: 'No transactions; replays after recovery produce duplicates.', when: 'Idempotent targets (upsert by key) or metrics that tolerate duplicates.' },
        { label: 'Exactly-once (2PC)', effect: 'Kafka transactions / Iceberg commits per checkpoint; output delayed by the checkpoint interval.', when: 'Billing, counts, anything summed downstream.' },
        { label: 'Idempotent upsert', effect: 'Deterministic keys + upsert into a KV/DB; duplicates overwrite themselves.', when: 'Serving stores (Cassandra, Redis, Postgres).' },
      ],
    },
    {
      name: 'Watermark bound',
      options: [
        { label: 'Tight (1–5 s)', effect: 'Results emitted quickly; more events arrive after their window closed.', when: 'Alerts and live dashboards.' },
        { label: 'Loose (minutes) + allowedLateness', effect: 'More complete results, more state held, later output.', when: 'Billing and reporting from mobile clients that buffer offline.' },
      ],
    },
  ],
  implementations: [
    { name: 'Apache Flink on Kubernetes', how: 'The Flink Kubernetes Operator manages application clusters, savepoint-based upgrades and autoscaling. Uber, Netflix and Alibaba run thousands of jobs this way.' },
    { name: 'Managed Flink', how: 'Amazon Managed Service for Apache Flink, Confluent Cloud for Apache Flink (serverless Flink SQL) and Ververica: the same engine with checkpoints and scaling handled for you.' },
    { name: 'Kafka Streams', how: 'A library, not a cluster: state in local RocksDB backed by compacted changelog topics, exactly-once via Kafka transactions. Simpler to deploy, but Kafka-in, Kafka-out only.' },
    { name: 'RisingWave / Materialize', how: 'Streaming databases: write SQL materialized views, the engine maintains them incrementally with state in object storage.' },
  ],
  ha: 'JobManager HA uses Kubernetes (or ZooKeeper) leader election, with the job graph and the latest checkpoint pointer in HA storage. When a TaskManager dies, the restart strategy redeploys the affected region and **all** tasks restore from the last completed checkpoint; sources rewind to the checkpointed offsets. Rescaling takes a savepoint and restarts with new parallelism, redistributing key groups (so `maxParallelism` must be set high enough up front).',
  failureModes: [
    { name: 'Backpressure stalls checkpoints', symptom: 'A slow sink backs up the job; barriers queue behind data, checkpoints time out and the job has not completed one in an hour.', fix: 'Fix or scale the bottleneck, enable **unaligned checkpoints** or buffer debloating, raise checkpoint timeout.' },
    { name: 'Unbounded state', symptom: 'RocksDB state grows 50 GB a day; checkpoints and restores get slower until the job falls over.', fix: 'State TTL, event-time windows instead of global state, bounded dedup windows.' },
    { name: 'Idle partition freezes watermarks', symptom: 'One Kafka partition gets no traffic; the job’s watermark stops and no window ever fires.', fix: '`withIdleness(1 min)`, or fewer partitions than active producers.' },
    { name: 'Kafka transaction timeout', symptom: 'After a long outage, the recovered job’s pre-committed transactions were aborted by the broker: data lost.', fix: 'Sink `transaction.timeout.ms` > checkpoint interval + max recovery time, and ≤ broker `transaction.max.timeout.ms` (default 15 min, often raised).' },
  ],
  numbers: ['Checkpoint every 10–60 s typical', 'Throughput: ~10k–100k+ events/s per slot for simple ops', 'Latency: milliseconds (at-least-once) to the checkpoint interval (2PC sinks)', 'Network buffer 32 KB; key groups = maxParallelism (≥128)', 'RocksDB state: TBs per job with incremental checkpoints'],
  interview: [
    { q: 'Explain how Flink achieves end-to-end exactly-once.', a: 'Sources record their offsets in state. The coordinator injects a numbered barrier into every source; each operator waits until it has the barrier from all inputs (alignment), snapshots its state and forwards the barrier. When every task has acknowledged, the checkpoint (offsets + state) is a consistent cut. Sinks take part via two-phase commit: pre-commit on the barrier, commit when the checkpoint completes. On failure everything restores to the last checkpoint, sources rewind, uncommitted transactions are aborted. Internal state is exactly-once; the output is only exactly-once with a transactional or idempotent sink.' },
    { q: 'What is a watermark and what happens to a late event?', a: 'A watermark W(t) is the operator’s assertion that it has seen all events with timestamp ≤ t, usually `max_event_time − bound`. Windows fire when the watermark passes their end. An event older than the current watermark is late: within `allowedLateness` it updates the window and re-emits a result; beyond it, it is dropped or routed to a side output for a correction job. The bound trades latency for completeness.' },
    { q: 'Checkpoint vs savepoint?', a: 'Checkpoints are automatic, frequent, owned by Flink and optimized for recovery (incremental, may be in a native format). Savepoints are user-triggered, portable snapshots used for upgrades, rescaling, migrations and A/B of code versions; you restore a new job version from a savepoint. Stable operator `uid`s are what make state mappable across versions.' },
  ],
  lab: 'flink',
  kafka: true,
};

// ───────────────────────────── spark-ss ─────────────────────────────
const SPARK_SS: Internals = {
  kind: 'spark-ss',
  summary:
    'Structured Streaming treats a stream as an unbounded table and runs your query as a sequence of small **micro-batches**. Each batch decides its offset range and writes it to an **offset log** before running, processes it with the normal Spark engine, updates a versioned **state store**, writes to the sink and then records a **commit**. Recovery re-runs the last uncommitted batch with exactly the same offsets.',
  parts: [
    { id: 'trigger', name: 'Trigger / driver loop', role: 'Decides when the next batch runs', detail: 'The driver’s `MicroBatchExecution` loop starts a batch as soon as the previous one ends (default), every interval (`Trigger.ProcessingTime("1 minute")`), or once over everything available and then stops (`Trigger.AvailableNow`).' },
    { id: 'source', name: 'Source offsets', role: 'Plans this batch’s input range', detail: 'For Kafka the driver asks each partition for its latest offset and caps the batch with `maxOffsetsPerTrigger`. File/Auto Loader sources track which files were already seen. The range [start, end) defines the batch.' },
    { id: 'offsets', name: 'Offset log (WAL)', role: 'Records the batch before running it', detail: 'Before any work, the driver writes `checkpoint/offsets/42` with the exact ranges and the current watermark. This write-ahead record is what makes a re-run of batch 42 read the identical input.' },
    { id: 'exec', name: 'Incremental execution', role: 'Runs the batch as a Spark job', detail: 'Catalyst plans the query incrementally (only the new rows), then it runs as a normal job: tasks on executors, shuffles for `groupBy`/joins. Stateful shuffles use `spark.sql.shuffle.partitions` (default 200), which is **fixed for the life of the checkpoint**.' },
    { id: 'statestore', name: 'State store', role: 'Versioned per-partition aggregation state', detail: 'Each stateful partition has a key-value store versioned by batch id. The default keeps state in executor memory with delta/snapshot files in the checkpoint; the **RocksDB provider** keeps it on local disk for millions to billions of keys, with changelog checkpointing to cut latency.' },
    { id: 'watermark', name: 'Watermark & eviction', role: 'Bounds lateness and state size', detail: '`withWatermark("event_time", "10 minutes")` sets watermark = max event time seen − 10 min, computed at the end of each batch and used in the next. Windows older than it are finalized (append mode) and their state evicted; later rows are dropped.' },
    { id: 'sink', name: 'Sink + commit log', role: 'Writes output, then marks batch done', detail: 'The sink writes batch 42 idempotently: Delta/Iceberg commits record the batch id, `foreachBatch` can use `txnAppId`/`txnVersion` or MERGE. Then the driver writes `checkpoint/commits/42`. Offsets without a commit = re-run on restart.' },
  ],
  flow: [
    { part: 'trigger', title: 'Trigger fires', text: 'With `Trigger.ProcessingTime("30 seconds")`, batch 42 starts at 12:00:30. Batch 41 took 18 s, so the cluster is keeping up.' },
    { part: 'source', title: 'Offsets planned', text: 'The driver sees 600k new records across 24 Kafka partitions, under `maxOffsetsPerTrigger = 1,000,000`, so batch 42 takes all of them.' },
    { part: 'offsets', title: 'Written ahead', text: '`offsets/42` is written to the checkpoint on S3/HDFS with every partition’s end offset and watermark `11:52:00`. From now on batch 42 is defined.' },
    { part: 'exec', title: 'Batch runs', text: 'Executors read the ranges, parse and filter, then shuffle by `(window, campaign_id)` into 200 state partitions. Everything is ordinary Spark tasks.' },
    { part: 'statestore', title: 'State updated', text: 'Each partition loads state version 41, adds counts for the new clicks and saves version 42 (on RocksDB, only changed keys are uploaded).' },
    { part: 'watermark', title: 'Old windows finalized', text: 'The max event time seen was 12:02:00, so the next watermark is 11:52:00. Windows ending before it are emitted in append mode and their state is dropped.' },
    { part: 'sink', title: 'Delta commit, then commit log', text: 'The batch is written as one Delta transaction tagged with the query id and batch 42, then `commits/42` is written. If the driver dies between the two, the restart re-runs batch 42 and Delta skips the already committed version: **exactly-once**.' },
  ],
  knobs: [
    {
      name: 'Trigger',
      options: [
        { label: 'Default (ASAP)', effect: 'Lowest latency, ~seconds; one small commit per batch, so many small files.', when: 'Low-latency pipelines into Kafka or a KV store.' },
        { label: 'ProcessingTime (1–5 min)', effect: 'Fewer, larger commits and files; latency ≈ interval + batch time.', when: 'Lakehouse ingestion (Delta/Iceberg) where minutes are fine.' },
        { label: 'AvailableNow', effect: 'Processes the backlog then stops: streaming semantics with batch cost.', when: 'Hourly/daily incremental jobs scheduled by Airflow.' },
      ],
    },
    {
      name: 'Output mode',
      options: [
        { label: 'Append', effect: 'Each result row is emitted once, after the watermark finalizes it. Required for most file sinks.', when: 'Windowed aggregates to Delta/Iceberg/Parquet.' },
        { label: 'Update', effect: 'Emits changed rows every batch, before windows close.', when: 'Upserting into a KV store or MERGE via foreachBatch.' },
        { label: 'Complete', effect: 'Rewrites the whole result each batch; only for small aggregates.', when: 'Small dashboards, never large state.' },
      ],
    },
    {
      name: 'State store provider',
      options: [
        { label: 'HDFS-backed (in-memory)', effect: 'Simple, all state in executor heap; GC trouble beyond a few million keys.', when: 'Small state.' },
        { label: 'RocksDB', effect: 'Off-heap on local disk, scales to large state with stable GC.', when: 'Dedup, stream-stream joins, many keys.' },
      ],
    },
  ],
  implementations: [
    { name: 'Apache Spark', how: 'Micro-batch engine with Kafka, file and rate sources, Delta/Iceberg/Kafka/foreachBatch sinks, RocksDB state store since 3.2, `dropDuplicatesWithinWatermark` since 3.5.' },
    { name: 'Databricks', how: 'Adds Auto Loader (`cloudFiles`) for incremental file ingest, RocksDB changelog checkpointing, and declarative pipelines (formerly Delta Live Tables) that manage checkpoints and retries.' },
    { name: 'AWS Glue / EMR streaming', how: 'Managed Spark clusters running Structured Streaming jobs against Kinesis/MSK with checkpoints on S3.' },
  ],
  ha: 'The driver is a single point of failure, so it runs under a supervisor (job retries on Databricks/EMR, Kubernetes restart). On restart it reads the checkpoint: the last offsets entry without a matching commit is re-run with identical ranges, and state is reloaded at that version. Lost executors just mean tasks are rescheduled. Scaling adds executors, but the number of state partitions cannot change without a new checkpoint.',
  failureModes: [
    { name: 'Small files from short triggers', symptom: 'A 5-second trigger writes 17k commits a day; queries crawl over a million tiny files.', fix: 'Longer trigger, optimized writes, scheduled compaction (OPTIMIZE / rewrite_data_files).' },
    { name: 'State without a watermark', symptom: '`dropDuplicates("event_id")` keeps every id ever seen; state and batch time grow until OOM.', fix: 'Add a watermark (`dropDuplicatesWithinWatermark`) or bounded windows.' },
    { name: 'Falling behind', symptom: 'Batch duration exceeds the trigger interval; latency grows and Kafka lag climbs.', fix: 'More executors/partitions, cap `maxOffsetsPerTrigger`, fix skew, simplify the batch.' },
    { name: 'Checkpoint incompatible after a change', symptom: 'Changing the aggregation keys or shuffle partitions makes the query fail to restart from its checkpoint.', fix: 'Plan state-compatible changes; otherwise start a new checkpoint and backfill from the source.' },
  ],
  numbers: ['Latency: ~1 s to minutes (trigger + batch time)', 'Default `spark.sql.shuffle.partitions` = 200, fixed per checkpoint', 'Typical lakehouse triggers: 1–5 min', 'Checkpoint retains ~100 recent batches by default (`minBatchesToRetain`)'],
  interview: [
    { q: 'How does Structured Streaming give exactly-once output?', a: 'Three pieces: replayable sources (Kafka offsets), a write-ahead offset log so a re-run of batch N reads exactly the same data, and idempotent sinks keyed by batch id (Delta/Iceberg record which batches committed; foreachBatch can MERGE or use txnVersion). State is versioned per batch, so a re-run starts from the same state version. Commit log entries mark completion.' },
    { q: 'Spark Structured Streaming or Flink?', a: 'Spark SS when latency of seconds to minutes is fine, the team already runs Spark for batch, and the main sink is a lakehouse table: one engine, one API, AvailableNow for incremental batch. Flink when you need millisecond to sub-second latency, very large keyed state, complex event-time logic (session windows, timers, CEP) or per-record processing. Both give exactly-once with the right sinks.' },
  ],
  kafka: true,
};

// ───────────────────────────── spark ─────────────────────────────
const SPARK: Internals = {
  kind: 'spark',
  summary:
    'Spark batch turns a query into a DAG of **stages** separated by **shuffles**. Each stage runs one task per data partition on executors in parallel; between stages, map tasks write sorted **shuffle files** that the next stage fetches over the network. Almost all cost and failure lives in the shuffles, and **AQE** re-plans at each shuffle boundary using real sizes: it coalesces tiny partitions, splits skewed ones and switches to broadcast joins.',
  parts: [
    { id: 'driver', name: 'Driver + Catalyst', role: 'Plans the query into physical operators', detail: 'The driver JVM parses SQL/DataFrame code, Catalyst optimizes the logical plan (predicate and column pushdown into Parquet) and picks physical operators: **BroadcastHashJoin** when one side is under `autoBroadcastJoinThreshold` (10 MB), else **SortMergeJoin**. Whole-stage codegen fuses operators into Java bytecode.' },
    { id: 'dag', name: 'DAG scheduler', role: 'Cuts the plan into stages at shuffles', detail: 'Narrow transformations (filter, map, project) stay in one stage; every **wide** dependency (groupBy, join, repartition) ends a stage with a shuffle map stage. Stages run in dependency order and a lost shuffle output re-runs only its parent stage.' },
    { id: 'tasks', name: 'Task scheduler', role: 'One task per partition, locality-aware', detail: 'A stage of N partitions becomes N tasks. File scans split input into ~128 MB partitions (`spark.sql.files.maxPartitionBytes`); post-shuffle stages use `spark.sql.shuffle.partitions` (default **200**). Failed tasks retry up to 4 times; speculation re-launches stragglers.' },
    { id: 'executors', name: 'Executors', role: 'JVMs that run tasks in parallel', detail: 'Each executor has cores (task slots, typically 4–5) and unified memory shared by execution (sort/hash buffers) and storage (cache). When buffers fill, operators **spill** to local disk instead of failing, at a big speed cost.' },
    { id: 'shuffle', name: 'Shuffle files', role: 'Repartitions data between stages by key', detail: 'Each map task hashes rows by key into the target partitions and writes one sorted data file plus an index to local disk. Reducers fetch their block from every map output: M × R network fetches. An external shuffle service or decommissioning keeps these files when executors go away.' },
    { id: 'aqe', name: 'Adaptive Query Execution', role: 'Re-plans using real shuffle statistics', detail: 'On by default since Spark 3.2. After a shuffle map stage finishes, AQE reads the actual partition sizes and **coalesces** small partitions toward 64 MB, **converts** a join to broadcast if a side turned out small, and **splits skewed partitions** (> 5× median and > 256 MB) into sub-tasks.' },
    { id: 'writer', name: 'Output committer', role: 'Writes files and commits atomically', detail: 'Tasks write files to a staging location; the job commit publishes them (or one atomic Delta/Iceberg commit). `partitionOverwriteMode=dynamic` replaces only the partitions this run wrote, which makes daily reruns idempotent.' },
  ],
  flow: [
    { part: 'driver', title: 'Query planned', text: 'The daily job runs `orders JOIN customers GROUP BY country, day` over 256 GB of Parquet. Catalyst pushes `day = 2026-11-24` into the scan and estimates customers at 2 GB, so it plans a sort-merge join.' },
    { part: 'dag', title: 'Three stages', text: 'The DAG scheduler cuts at both shuffles: stage 1 scans orders, stage 2 scans customers, stage 3 joins and aggregates.' },
    { part: 'tasks', title: '2,000 scan tasks', text: '256 GB / 128 MB ≈ 2,000 tasks for stage 1. With 50 executors × 4 cores = 200 slots, they run in ~10 waves.' },
    { part: 'shuffle', title: 'Shuffle write', text: 'Each scan task hashes rows by `customer_id` into 200 buckets and writes a sorted shuffle file to local disk: 2,000 × 200 = 400k blocks for stage 3 to fetch.' },
    { part: 'aqe', title: 'AQE re-plans', text: 'Stage 2 shows customers is only **8 MB** after the filter, so AQE switches to a broadcast join and skips the big sort. It also sees partition 117 (a marketplace account) is 9 GB against a 300 MB median and splits it into 30 sub-tasks.' },
    { part: 'executors', title: 'Join and aggregate', text: 'Stage 3 tasks run hash aggregation in executor memory; one task that still overflows spills to local disk rather than failing.' },
    { part: 'writer', title: 'Partition overwritten', text: 'Output is repartitioned by `day` and written with dynamic partition overwrite, replacing only `day=2026-11-24`. Running the job again produces the same table, not duplicates.' },
  ],
  knobs: [
    {
      name: 'Shuffle partitions',
      options: [
        { label: 'Default 200', effect: 'Fine for ~10–50 GB shuffles; at 2 TB each task holds 10 GB and spills or OOMs.', when: 'Small/medium jobs.' },
        { label: 'Sized: shuffle bytes ÷ ~128–200 MB', effect: 'Right-sized tasks, less spill; too many → task overhead and small output files.', when: 'Large jobs; let AQE coalesce from a high starting number.' },
      ],
    },
    {
      name: 'Join strategy',
      options: [
        { label: 'Broadcast hash', effect: 'Small side copied to every executor; no shuffle of the big side. Driver/executor OOM if the "small" side is not small.', when: 'Fact ⋈ dimension under ~10–100 MB.' },
        { label: 'Sort-merge', effect: 'Both sides shuffled and sorted; scales to any size, sensitive to skew.', when: 'Big ⋈ big.' },
        { label: 'Bucketed / storage-partitioned', effect: 'Pre-partitioned tables on the join key skip the shuffle entirely.', when: 'The same large join every day.' },
      ],
    },
    {
      name: 'Write mode',
      options: [
        { label: 'Append', effect: 'Cheap, but every rerun duplicates rows.', when: 'Only with a dedup step downstream.' },
        { label: 'Dynamic partition overwrite', effect: 'Replaces exactly the partitions written; idempotent reruns and backfills.', when: 'Daily/hourly partitioned batch jobs.' },
        { label: 'MERGE (Delta/Iceberg)', effect: 'Row-level upserts; rewrites touched files, costlier than overwrite.', when: 'Late updates spread across many partitions, CDC applies.' },
      ],
    },
  ],
  implementations: [
    { name: 'Databricks', how: 'Spark plus the **Photon** vectorized C++ engine, Delta Lake, serverless compute and predictive optimization of table layout.' },
    { name: 'EMR / Dataproc / Glue', how: 'Managed Spark on YARN or Kubernetes. EMR and Dataproc expose full cluster config; Glue is serverless Spark with DPU-based billing.' },
    { name: 'Spark on Kubernetes', how: 'Driver and executors as pods (Spark Operator), dynamic allocation with shuffle tracking or decommissioning since there is no external shuffle service by default.' },
  ],
  ha: 'The driver is a single point of failure for a job; the orchestrator retries the whole job, which is safe only if writes are idempotent (overwrite/MERGE). Within a job, failed tasks retry (`spark.task.maxFailures` = 4), a lost executor’s shuffle output is recomputed from lineage by re-running the parent stage, and speculative execution handles slow nodes. Scaling is dynamic allocation of executors; spot capacity works if shuffle files survive decommissioning.',
  failureModes: [
    { name: 'Skewed straggler', symptom: '199 tasks finish in 2 minutes, one runs for 2 hours on a hot key.', fix: 'AQE skew join, salting the key with two-phase aggregation, broadcast the other side, or handle the hot key separately.' },
    { name: 'Executor OOM / heavy spill', symptom: '`OutOfMemoryError` or `ExecutorLostFailure` with TBs spilled on a few tasks.', fix: 'More shuffle partitions, avoid `collect()` and oversized broadcasts, more memory per core.' },
    { name: 'Shuffle fetch failures', symptom: '`FetchFailedException` after spot executors were reclaimed; stages re-run again and again.', fix: 'Graceful decommissioning with shuffle migration, external shuffle service, on-demand nodes for shuffle-heavy stages.' },
    { name: 'Small-file explosion on write', symptom: '200 tasks × 365 date partitions = 73k files of 2 MB.', fix: '`repartition(day)` before writing, optimized writes, compaction afterwards.' },
  ],
  numbers: ['Default `spark.sql.shuffle.partitions` = 200', 'Input split 128 MB; aim for ~128–200 MB per task', 'Broadcast threshold 10 MB by default (often raised to ~100 MB)', 'AQE skew: partition > 5× median and > 256 MB', 'Executors: typically 4–5 cores, 4–8 GB per core'],
  interview: [
    { q: 'What creates a stage boundary and why are shuffles expensive?', a: 'Any wide dependency, where an output partition needs rows from many input partitions: groupBy, join (non-broadcast), distinct, repartition. A shuffle serializes every row, writes it to local disk, sends it over the network as M × R blocks, and the reducers often sort it again. It is disk, network and CPU, plus a barrier: the next stage cannot start until all map tasks finish, so one straggler delays everything.' },
    { q: 'Your join has one task running for hours. What do you do?', a: 'Confirm skew in the Spark UI (task duration and shuffle read size per task). First, if one side is small enough, broadcast it. Else turn on AQE skew join, which splits the large partition and replicates the matching partition of the other side. If that is not enough, salt the hot keys: add a random suffix 0..N−1 on the big side and explode the other side N times, or for aggregations do a two-phase aggregate. Also check for junk keys like null or "unknown" that should be filtered.' },
    { q: 'How do you make a daily Spark job safe to rerun and backfill?', a: 'Make every run a pure function of its date: read the input for that data interval and overwrite exactly that output partition (dynamic partition overwrite, or `replaceWhere`/Iceberg overwrite). Never append. Then an orchestrator can retry or backfill any range in parallel and the table converges to the same result.' },
  ],
  lab: 'spark',
};

// ───────────────────────────── dbt ─────────────────────────────
const DBT: Internals = {
  kind: 'dbt',
  summary:
    'dbt is a **compiler and runner for SQL inside the warehouse**. Every model is a `SELECT`; `ref()` calls build the dependency DAG; the **materialization** decides what DDL/DML wraps the SELECT (view, table, incremental MERGE). dbt runs the graph in topological order, tests the results and writes a **manifest** describing the whole project. The warehouse does all the compute.',
  parts: [
    { id: 'project', name: 'Models & sources', role: 'SQL SELECTs plus YAML configs', detail: '`models/marts/fct_orders.sql` is just a SELECT with Jinja. YAML declares `sources` (raw tables loaded by Fivetran/Airbyte), column docs, tests, contracts and configs like `materialized` and `unique_key`.' },
    { id: 'parser', name: 'Parser / compiler', role: 'Resolves Jinja, ref() and source()', detail: '`{{ ref(\'stg_orders\') }}` compiles to the fully qualified relation for the target environment and records an edge in the DAG; macros expand into adapter-specific SQL. Partial parsing re-parses only changed files.' },
    { id: 'dag', name: 'DAG & selection', role: 'Orders models, selects a subgraph', detail: 'The graph is sorted topologically and run with N **threads**: independent models execute concurrently. Selectors like `+fct_orders`, `tag:finance` or `state:modified+` pick a subgraph.' },
    { id: 'materialize', name: 'Materializations', role: 'Wrap the SELECT in DDL/DML', detail: '**view**: `CREATE VIEW`. **table**: `CREATE TABLE AS` then swap. **incremental**: build only new rows with `is_incremental()` and apply via `merge` on `unique_key`, `delete+insert`, `insert_overwrite` (partitions) or `microbatch` (dbt 1.9+, by `event_time`). **ephemeral**: inlined as a CTE.' },
    { id: 'adapter', name: 'Adapter', role: 'Executes SQL on the warehouse', detail: 'dbt-snowflake, dbt-bigquery, dbt-databricks, dbt-postgres… translate generic macros into dialect SQL and run them over the warehouse connection. dbt holds no data itself.' },
    { id: 'tests', name: 'Tests & contracts', role: 'Assert data properties after each model', detail: 'Generic tests (`unique`, `not_null`, `accepted_values`, `relationships`) and singular SQL tests compile to queries that should return zero rows. In `dbt build`, a failing test with severity `error` **skips all downstream models**. Contracts enforce column names and types at build time.' },
    { id: 'artifacts', name: 'Artifacts (manifest)', role: 'Machine-readable project and run state', detail: '`manifest.json` (every node, its compiled SQL, config and edges), `run_results.json` (timing, status) and `catalog.json`. They power docs and lineage, `dbt retry`, and **slim CI**: compare with prod’s manifest via `--state`, build only `state:modified+`, `--defer` to prod for unchanged parents.' },
  ],
  flow: [
    { part: 'project', title: 'Model written', text: '`fct_orders.sql` selects from `{{ ref(\'stg_orders\') }}` and `{{ ref(\'stg_payments\') }}`, configured `materialized=\'incremental\'`, `unique_key=\'order_id\'`.' },
    { part: 'parser', title: 'Compiled', text: '`dbt build -s +fct_orders` parses the project; refs become `analytics.staging.stg_orders` in prod or `dev_alice.stg_orders` in development. The edges go into the manifest.' },
    { part: 'dag', title: 'Graph ordered', text: 'Selection yields 6 models and 14 tests. With `threads: 8`, `stg_orders` and `stg_payments` build in parallel; `fct_orders` waits for both.' },
    { part: 'materialize', title: 'Incremental SQL generated', text: 'Because the table exists, `is_incremental()` is true and the filter `updated_at > (select max(updated_at) - interval \'3 hours\' from {{ this }})` keeps a 3-hour lookback. The macro wraps it in `MERGE INTO fct_orders USING (...) ON order_id`.' },
    { part: 'adapter', title: 'Runs in the warehouse', text: 'Snowflake executes the MERGE: 41k rows scanned instead of 900 M, updated and inserted in one transaction. Reruns converge because the merge key is unique.' },
    { part: 'tests', title: 'Tests gate downstream', text: '`unique(order_id)` and `not_null(customer_id)` run right after the model. If one fails, the 3 downstream mart models are skipped instead of publishing bad numbers.' },
    { part: 'artifacts', title: 'Artifacts written', text: '`manifest.json` and `run_results.json` are saved. Tomorrow’s pull request CI builds only `state:modified+` against them, so a one-model change runs in minutes, not hours.' },
  ],
  knobs: [
    {
      name: 'Materialization',
      options: [
        { label: 'view', effect: 'No storage, always fresh; compute happens on every query, stacked views get slow.', when: 'Light staging models.' },
        { label: 'table', effect: 'Full rebuild each run: simple and always correct, cost grows with history.', when: 'Small/medium marts, anything with complex logic that is hard to make incremental.' },
        { label: 'incremental', effect: 'Processes only new/changed rows; needs a unique key and a lookback for late data; occasional `--full-refresh`.', when: 'Large fact tables (hundreds of millions of rows and up).' },
      ],
    },
    {
      name: 'Incremental strategy',
      options: [
        { label: 'append', effect: 'Insert only: cheapest, but reruns and lookbacks duplicate.', when: 'Truly immutable events with exact-once inputs.' },
        { label: 'merge on unique_key', effect: 'Upserts, idempotent; scans the target for matches (cluster/partition on the key).', when: 'Entity and fact tables with updates.' },
        { label: 'insert_overwrite / microbatch', effect: 'Replace whole date partitions or event-time batches; idempotent and backfill-friendly.', when: 'Big time-partitioned facts, late data within a known window.' },
      ],
    },
    {
      name: 'Test severity',
      options: [
        { label: 'error', effect: 'Fails the node and skips downstream models: bad data never reaches marts, but dashboards go stale.', when: 'Primary keys, money columns, joins that fan out.' },
        { label: 'warn (+ store_failures)', effect: 'Run continues; failing rows saved for inspection.', when: 'Soft expectations, known noisy sources.' },
      ],
    },
  ],
  implementations: [
    { name: 'dbt Core', how: 'Open-source Python CLI with adapter plugins; you schedule it with Airflow/Dagster or CI.' },
    { name: 'dbt Cloud / Fusion engine', how: 'Hosted IDE, scheduler, CI and state-aware runs. The Fusion engine (Rust) parses and type-checks SQL itself, giving faster parsing and compile-time errors.' },
    { name: 'SQLMesh', how: 'Alternative with virtual data environments (dev tables are views over prod snapshots), column-level lineage and a plan/apply workflow for changes.' },
    { name: 'Dataform', how: 'Google’s SQLX framework built into BigQuery: similar refs, assertions and incremental tables.' },
  ],
  ha: 'dbt itself is a stateless CLI; availability and scale come from the warehouse and the scheduler that invokes it. Make runs idempotent (table swaps, MERGE with a unique key, partition overwrite) so a failed job can simply be re-run or resumed with `dbt retry`. Avoid two concurrent runs touching the same models (one job per environment, or a lock in the orchestrator). Scale with threads and warehouse size, not more dbt processes.',
  failureModes: [
    { name: 'Incremental without unique_key', symptom: 'A retried run appends the last 3 hours again; revenue is double-counted.', fix: '`unique_key` + merge (or insert_overwrite), plus a `unique` test on the key.' },
    { name: 'Late data missed by max() filter', symptom: 'Rows that arrive after the run with older `updated_at` never enter the model.', fix: 'Lookback window in the incremental filter, `microbatch` with lookback, periodic full refresh.' },
    { name: 'Silent schema drift', symptom: 'A new source column never appears in the incremental table (`on_schema_change` defaults to ignore).', fix: '`on_schema_change: append_new_columns` or `fail`, contracts on public models.' },
    { name: 'Non-unique merge source', symptom: 'MERGE fails with "duplicate row detected" or updates nondeterministically.', fix: 'Deduplicate in the model with `qualify row_number() over (partition by key order by updated_at desc) = 1`.' },
  ],
  numbers: ['Threads: typically 4–16', 'Large projects: 1,000–5,000 models', 'Incremental runs often scan 10–100× less than full rebuilds', 'Slim CI: build only `state:modified+` instead of the whole DAG'],
  interview: [
    { q: 'How does dbt know what order to run models in?', a: 'Every `ref()` and `source()` call is resolved at parse time into an edge in a DAG, stored in `manifest.json`. dbt topologically sorts the selected subgraph and runs nodes whose parents are done, up to N threads in parallel. You never write the order yourself, which is why hard-coded table names instead of `ref()` break lineage and ordering.' },
    { q: 'Walk me through an incremental model and how it handles late or re-delivered data.', a: 'On first run it builds the full table. Afterwards `is_incremental()` adds a filter so the SELECT only reads new rows, typically `updated_at > max(updated_at) − lookback`. The strategy applies them: merge on `unique_key` upserts, so rows read twice due to the lookback or a retry overwrite themselves rather than duplicating. Data later than the lookback is missed, so you size the lookback from observed lateness and schedule periodic full refreshes or reconciliation.' },
    { q: 'How do you run CI on a 2,000-model project?', a: 'Slim CI: keep the production manifest, run `dbt build --select state:modified+ --defer --state prod-artifacts` so only changed models and their children are built in a PR schema, while unchanged parents resolve to production tables. Add contracts and tests on public models so breaking changes fail in the PR.' },
  ],
};

// ───────────────────────────── salt ─────────────────────────────
const SALT: Internals = {
  kind: 'salt',
  summary:
    'Partitioning by key sends every row of a key to one task, so one hot key (a marketplace seller, a bot, `null`) makes one task do 40% of the work while the rest idle. **Salting** splits the hot key into N sub-keys, **pre-aggregates** each sub-key in parallel, then a second, tiny stage **merges** the N partial results per key. It works because sums, counts and max are associative.',
  parts: [
    { id: 'detect', name: 'Hot-key detection', role: 'Finds keys that dominate the data', detail: 'Sample key frequencies (`groupBy(key).count()` on a 1% sample), read the Spark UI’s per-task shuffle read sizes, or track heavy hitters with a Count-Min sketch in streaming. Usually a handful of keys (or `null`/`unknown`) carry most of the skew.' },
    { id: 'salt', name: 'Salt assignment', role: 'Appends a suffix 0..N−1 to hot keys', detail: '`salted_key = key || \'#\' || (hash(event_id) % 16)`. Derive the salt **deterministically** from a row attribute, not `rand()`, so a retried task puts the same row in the same sub-key. Only hot keys need salting; cold keys can keep suffix 0.' },
    { id: 'partial', name: 'Partial aggregation', role: 'Aggregates per (key, salt) in parallel', detail: 'Stage 1 groups by `salted_key`: the hot key’s rows are now spread across 16 tasks, each producing one partial (sum, count, max, or a sketch such as HyperLogLog for distinct counts). Map-side combining shrinks the shuffle further.' },
    { id: 'rekey', name: 'Re-key shuffle', role: 'Strips the salt, groups by key', detail: 'The partials are re-keyed by the original key and shuffled again. This shuffle is tiny: at most N rows per key instead of millions.' },
    { id: 'merge', name: 'Final merge', role: 'Combines partials into one result', detail: 'Sum the sums, sum the counts, max the maxes, merge the sketches. Averages must be carried as (sum, count), never as averages of averages. In streaming, the merge for a window fires when the watermark passes, once all partials have arrived.' },
    { id: 'join', name: 'Salted join (variant)', role: 'Replicates the other side N times', detail: 'For a skewed join, salt the big side with `rand_or_hash % N` and **explode** the small side’s matching keys into N copies (`key#0..key#N−1`), so each copy joins one slice. Cost: the replicated side grows N×, so salt only hot keys. Spark AQE’s skew join does the same automatically.' },
  ],
  flow: [
    { part: 'detect', title: 'Skew found', text: 'The hourly revenue-by-seller job has one task running 50 minutes. Seller `S-1` (a marketplace aggregator) is **40%** of all orders; the other 199 tasks finish in 90 seconds.' },
    { part: 'salt', title: 'Salt the hot key', text: 'Choose N ≈ hot share ÷ target share = 40% ÷ 2.5% = 16. Rows for `S-1` get `S-1#0..S-1#15` from `hash(order_id) % 16`; other sellers stay as they are.' },
    { part: 'partial', title: 'Parallel partial sums', text: 'Stage 1 groups by salted key. `S-1` is now 16 partitions of ~2.5% each; every task finishes in ~2 minutes and emits `(S-1#7, sum=1.9M, count=41k)`.' },
    { part: 'rekey', title: 'Re-key by seller', text: 'The salt is stripped and partials shuffle by `seller_id`. For `S-1` that is 16 rows crossing the network, not 16 million.' },
    { part: 'merge', title: 'Merge partials', text: 'The final stage sums 16 partial sums and counts into one row for `S-1`. Total job time drops from 50 to ~4 minutes; results are identical.' },
    { part: 'join', title: 'Same trick for a join', text: 'Enriching orders with seller attributes is also skewed on `S-1`, so the seller dimension row for `S-1` is exploded into 16 copies and each salted order slice joins its copy.' },
  ],
  knobs: [
    {
      name: 'Salt factor N',
      options: [
        { label: 'Small (4–8)', effect: 'Little extra shuffle/state; may not flatten an extreme key.', when: 'Moderate skew (hot key 5–15% of data).' },
        { label: 'Sized: hot share ÷ target share (16–64)', effect: 'Flattens the hot key to about the size of a normal partition.', when: 'A single key with 20–50% of traffic.' },
        { label: 'Huge everywhere (1,000)', effect: 'Partials and replicated join rows ×1,000 for every key; slower than the skew it fixes.', when: 'Never. Salt only detected hot keys.' },
      ],
    },
    {
      name: 'Where to pre-aggregate',
      options: [
        { label: 'Map-side combine (Spark)', effect: 'Automatic partial agg before the shuffle; helps sums/counts, does not split one key’s reduce task.', when: 'Always on; salting is needed on top for extreme keys.' },
        { label: 'Local-global (Flink mini-batch)', effect: 'Each subtask buffers ~2 s or 5k rows and pre-aggregates before keyBy; adds that much latency.', when: 'Streaming aggregates with hot keys (`table.exec.mini-batch.*`, `TWO_PHASE`).' },
        { label: 'Explicit salted two-stage', effect: 'Full control over N and which keys; more code and an extra stage.', when: 'Joins, or when automatic options are not enough.' },
      ],
    },
  ],
  implementations: [
    { name: 'Manual salting in Spark/SQL', how: '`concat(key, \'#\', pmod(hash(id), 16))` → `groupBy(salted)` → `groupBy(key)`; for joins, `explode(sequence(0, 15))` on the small side.' },
    { name: 'Spark AQE skew join', how: '`spark.sql.adaptive.skewJoin.enabled` splits partitions > 5× median and > 256 MB into sub-partitions and replicates the matching partition of the other side. Joins only, not aggregations.' },
    { name: 'Flink SQL two-phase and split-distinct', how: 'Mini-batch plus `table.optimizer.agg-phase-strategy=TWO_PHASE` does local-global aggregation; `distinct-agg.split.enabled` buckets `COUNT(DISTINCT)` by hash of the distinct key (1,024 buckets) then merges.' },
    { name: 'Kafka key salting', how: 'Producers append a suffix to a hot key so it spreads over several partitions; consumers must re-aggregate, and per-key ordering is lost.' },
  ],
  ha: 'Salting is a query-shape change, not a service, so it inherits the HA of the engine. Its one HA hazard is non-determinism: with `rand()` salts, a retried task can place rows in different sub-keys than the first attempt, and partial recomputation then double-counts or drops rows. A deterministic salt (hash of a row id) makes retries safe.',
  failureModes: [
    { name: 'Non-decomposable aggregate', symptom: 'Exact `COUNT(DISTINCT user)` summed across salts over-counts users who appear in several slices; a median of medians is wrong.', fix: 'Salt by the distinct key itself (two-level distinct), use mergeable sketches (HLL, t-digest), or accept a separate exact path.' },
    { name: 'Random salt on retry', symptom: 'Totals differ slightly between identical reruns after task failures.', fix: 'Deterministic salt from a row attribute: `hash(event_id) % N`.' },
    { name: 'Over-salting', symptom: 'Shuffle volume and state grow N× for every key; the job is slower than before.', fix: 'Salt only detected hot keys and size N from the hot share.' },
  ],
  numbers: ['N ≈ hot-key share ÷ target per-task share (40% ÷ 2.5% = 16)', 'Second-stage input: ≤ N rows per key', 'Spark AQE skew threshold: > 5× median and > 256 MB', 'Flink mini-batch: ~1–5 s latency, a few thousand rows per batch'],
  interview: [
    { q: 'Why does adding more workers not fix skew?', a: 'Hash partitioning sends every row of a key to the same partition, and a partition is processed by one task. With a key holding 40% of the data, that one task does 40% of the work no matter how many workers exist; the others finish early and idle. You have to change the key distribution (salting, splitting the key, or broadcasting the other side of a join), not the cluster size.' },
    { q: 'Implement a skew-safe "revenue and unique buyers per seller".', a: 'Revenue: salt hot sellers with `hash(order_id) % N`, sum per salted key, then sum the partials per seller. Unique buyers cannot be summed across salts because the same buyer may land in several slices. Either salt by `hash(buyer_id) % N` so each buyer lives in exactly one slice (then partial distinct counts do add up), or compute a HyperLogLog sketch per slice and merge sketches (~1–2% error).' },
  ],
};

// ───────────────────────────── airflow ─────────────────────────────
const AIRFLOW: Internals = {
  kind: 'airflow',
  summary:
    'Airflow is a **scheduler over a database**. Python files define DAGs; a DAG processor parses them into the **metadata DB**; the scheduler creates a DAG run per **data interval** and moves task instances through states as their dependencies finish; an **executor** hands ready tasks to workers. It orchestrates work done elsewhere (Spark, dbt, the warehouse) and makes retries and backfills safe only if each task is idempotent for its interval.',
  parts: [
    { id: 'dagfiles', name: 'DAG files & processor', role: 'Parses Python into serialized DAGs', detail: 'The DAG processor imports every file in the DAGs folder on a loop (re-parse ~every 30 s by default) and stores **serialized DAGs** in the DB. Top-level code runs on every parse, so a DB query or API call there slows the whole system. Airflow 3 makes the processor a separate, mandatory component.' },
    { id: 'scheduler', name: 'Scheduler', role: 'Creates runs, queues ready tasks', detail: 'Each loop: create DAG runs whose data interval has ended, evaluate task dependencies and trigger rules, then queue task instances while respecting `max_active_runs`, `max_active_tasks`, **pools** and global `parallelism` (default 32). Several schedulers run active-active, coordinating with `SELECT … FOR UPDATE SKIP LOCKED`.' },
    { id: 'metadb', name: 'Metadata DB', role: 'Source of truth for every state', detail: 'Postgres (or MySQL) holds `dag_run`, `task_instance` states, XComs, pools, connections and variables. Every component reads and writes it, so it is the real bottleneck and single point of failure.' },
    { id: 'executor', name: 'Executor', role: 'Sends queued tasks to workers', detail: '**LocalExecutor**: subprocesses on the scheduler host. **CeleryExecutor**: pushes to a Redis/RabbitMQ queue consumed by a long-lived worker fleet (seconds to start). **KubernetesExecutor**: one pod per task, isolated images and resources, 10–60 s startup.' },
    { id: 'worker', name: 'Worker', role: 'Runs the task, reports state', detail: 'Executes the operator: usually a thin call that submits Spark, runs `dbt build` or a warehouse query and waits. Logs go to remote storage (S3/GCS). Airflow 3 workers talk to a **Task Execution API** instead of the DB directly.' },
    { id: 'triggerer', name: 'Triggerer', role: 'Waits asynchronously for deferred tasks', detail: '**Deferrable** sensors and operators release their worker slot and hand an async trigger (poll S3, wait for a Databricks run) to the triggerer, which can wait on thousands of them in one asyncio loop and resumes the task when the condition fires.' },
  ],
  flow: [
    { part: 'dagfiles', title: 'DAG parsed', text: '`daily_orders.py` defines `wait_for_export >> spark_orders >> dbt_marts` with `schedule="@daily"`. The processor parses it in 0.3 s and stores the serialized DAG.' },
    { part: 'scheduler', title: 'Run for the 24th created', text: 'At 00:00 on Nov 25 the interval **[Nov 24 00:00, Nov 25 00:00)** has closed, so the scheduler creates the run whose logical date is **2026-11-24**: a daily run processes the day that just ended.' },
    { part: 'triggerer', title: 'Sensor defers', text: '`wait_for_export` is a deferrable S3 sensor for `exports/dt=2026-11-24/_SUCCESS`. It frees its worker slot and the triggerer polls. At 01:12 the marker appears and the task completes.' },
    { part: 'executor', title: 'Spark task queued', text: '`spark_orders` is in pool `spark` (4 slots, 2 used), so it is queued and the KubernetesExecutor launches a pod for it.' },
    { part: 'worker', title: 'Task runs for its interval', text: 'The operator submits a Spark job with `--date {{ ds }}` that overwrites partition `dt=2026-11-24`. It fails on a transient error; with `retries=3, retry_delay=5m` it re-runs and, because the write is an overwrite, the retry is harmless.' },
    { part: 'metadb', title: 'States recorded', text: '`spark_orders` → success, so the scheduler sees `dbt_marts`’s upstream is done and queues it. Every transition is a row update in `task_instance`.' },
    { part: 'scheduler', title: 'Backfill March', text: 'A bug fix requires recomputing March. A backfill creates 31 runs (one per data interval), limited by `max_active_runs=4` and the pool so the warehouse is not flooded. Idempotent tasks make the result identical to on-time runs.' },
  ],
  knobs: [
    {
      name: 'Executor',
      options: [
        { label: 'LocalExecutor', effect: 'No extra infra; limited to one machine.', when: 'Small teams, dozens of DAGs.' },
        { label: 'CeleryExecutor', effect: 'Warm workers start tasks in seconds; shared dependencies, a broker to run.', when: 'Many short tasks, uniform environments.' },
        { label: 'KubernetesExecutor', effect: 'Pod per task: isolation, per-task images and resources; 10–60 s startup each.', when: 'Heterogeneous dependencies, spiky workloads.' },
      ],
    },
    {
      name: 'catchup',
      options: [
        { label: 'True', effect: 'Every missed interval since `start_date` gets a run: new DAG with a year-old start date = 365 runs at once.', when: 'Pipelines that must have every interval (partitioned facts).' },
        { label: 'False (default in Airflow 3)', effect: 'Only the latest interval runs; history needs an explicit backfill.', when: 'Snapshots, reports, anything where only "now" matters.' },
      ],
    },
    {
      name: 'Sensor mode',
      options: [
        { label: 'poke', effect: 'Holds a worker slot the entire wait; 50 sensors can fill all slots and deadlock real work.', when: 'Very short waits only.' },
        { label: 'reschedule', effect: 'Frees the slot between checks; each check is a new task attempt.', when: 'Minutes-to-hours waits without a triggerer.' },
        { label: 'deferrable', effect: 'Waits in the triggerer at near-zero cost.', when: 'Default for waiting on files, partitions, external jobs.' },
      ],
    },
  ],
  implementations: [
    { name: 'Apache Airflow', how: 'Created at Airbnb in 2014. Airflow 2 added the HA scheduler, TaskFlow API and deferrable operators; Airflow 3 (2025) adds the Task Execution API, DAG versioning and asset-based scheduling.' },
    { name: 'MWAA / Cloud Composer / Astronomer', how: 'Managed Airflow: hosted scheduler, metadata DB and workers with autoscaling; you ship DAG files.' },
    { name: 'Dagster', how: 'Asset-centric: you declare the tables (assets) and their partitions, and it tracks which are stale. Strong local testing and lineage.' },
    { name: 'Prefect', how: 'Python-native dynamic flows with a hosted control plane and lightweight workers; less DAG ceremony.' },
  ],
  ha: 'Run 2+ schedulers active-active (row-level locks make them safe), multiple triggerers, and a horizontally scaled worker fleet. The **metadata DB** is the real single point of failure: use managed Postgres with a standby and keep it small (`airflow db clean` for old runs, XComs and logs). Workers are disposable because tasks retry; zombie detection re-queues tasks whose worker vanished.',
  failureModes: [
    { name: 'Slow DAG parsing', symptom: 'Top-level code queries an API in 200 DAG files; parsing takes minutes and tasks start late.', fix: 'No I/O at top level; move work inside tasks; watch parse-time metrics.' },
    { name: 'Non-idempotent tasks', symptom: 'A retry or backfill appends a second copy of the day’s data.', fix: 'Each task writes exactly its interval with overwrite/MERGE, using `data_interval_start/end` instead of `now()`.' },
    { name: 'Sensor deadlock', symptom: 'All worker slots are held by poking sensors waiting on tasks that can never get a slot.', fix: 'Deferrable or reschedule sensors, a dedicated pool for sensors.' },
    { name: 'Catchup stampede', symptom: 'A new DAG with `start_date` a year back launches hundreds of runs and saturates the warehouse.', fix: '`catchup=False`, or a controlled backfill with `max_active_runs` and pools.' },
  ],
  numbers: ['Default `parallelism` 32 per scheduler, `max_active_runs_per_dag` 16, `default_pool` 128 slots', 'DAG re-parse interval ~30 s by default; keep each file < 1 s', 'Task start latency: Celery seconds, Kubernetes 10–60 s', 'Not for sub-minute schedules: scheduling overhead is seconds per task'],
  interview: [
    { q: 'Why does the run with logical date 2026-11-24 start on Nov 25?', a: 'Airflow schedules **data intervals**. A daily run covers [Nov 24 00:00, Nov 25 00:00) and can only process that day once it has ended, so it starts just after midnight on the 25th. The logical date labels the interval (its start). Tasks should use `data_interval_start/end` (or `ds`) to choose their input, never the wall clock, which is what makes reruns and backfills reproduce the same result.' },
    { q: 'How do you make backfills safe?', a: 'Every task must be a deterministic function of its data interval and write idempotently: overwrite the interval’s partition or MERGE on keys, never append. Then any interval can be re-run any number of times. Control blast radius with `max_active_runs`, pools for shared resources (warehouse slots) and backfilling downstream DAGs in order.' },
    { q: 'Should heavy data processing run inside Airflow tasks?', a: 'No. Airflow workers are for orchestration: submit a Spark job, trigger dbt, run a warehouse query and wait (ideally deferrably). Pulling data into the worker with pandas couples job size to worker memory, blocks slots and makes the scheduler fleet a compute cluster. Use XCom only for small metadata such as paths and counts.' },
  ],
  lab: 'airflow',
};

// ───────────────────────────── compaction ─────────────────────────────
const COMPACTION: Internals = {
  kind: 'compaction',
  summary:
    'Streaming and frequent batch writes leave a table with thousands of small files, and every query pays per file opened. Table maintenance **rewrites small files into a few large ones** (128 MB–1 GB), optionally **sorted or Z-ordered** for data skipping, commits the swap as one atomic snapshot, **rewrites manifests** and **expires old snapshots** so their files can be deleted. It must coexist with writers that commit at the same time.',
  parts: [
    { id: 'planner', name: 'Planner', role: 'Finds partitions worth rewriting', detail: 'Reads table metadata (manifests list every file with its size and stats, no S3 listing needed) and selects files below the min size (Iceberg default 75% of target), above the max, or with many delete files. Partitions with fewer than `min-input-files` (5) are skipped.' },
    { id: 'binpack', name: 'Bin-packing', role: 'Groups small files into target-sized outputs', detail: 'Packs candidate files per partition into **file groups** that will produce ~target-size files (Iceberg `target-file-size-bytes` = 512 MB, Delta OPTIMIZE ~1 GB). Groups rewrite in parallel (`max-concurrent-file-group-rewrites`, default 5).' },
    { id: 'rewrite', name: 'Rewrite (sort / Z-order)', role: 'Reads, optionally sorts, writes new files', detail: 'A Spark job reads each group and writes new Parquet files. **binpack** only concatenates; **sort** orders by columns so min/max stats become tight; **Z-order** interleaves bits of 2–4 columns so filters on any of them can skip files. Sorting costs a shuffle.' },
    { id: 'commit', name: 'Atomic commit', role: 'Swaps old files for new in one snapshot', detail: 'A `replace` snapshot removes the old files and adds the new ones via an optimistic compare-and-swap of the table metadata pointer. Before committing it validates that no concurrent commit deleted or updated the files it rewrote; if one did, that group fails and is retried or skipped.' },
    { id: 'manifests', name: 'Manifest rewrite', role: 'Re-clusters metadata for fast planning', detail: 'Each commit adds manifest files; after thousands of streaming commits, query planning reads thousands of manifests. `rewrite_manifests` regroups entries by partition into a few manifests (~8 MB each), so planning touches only relevant ones.' },
    { id: 'expire', name: 'Snapshot expiry & cleanup', role: 'Drops old snapshots, deletes their files', detail: '`expire_snapshots` removes snapshots older than the retention (Iceberg default 5 days) and deletes files no longer referenced by any live snapshot; Delta `VACUUM` does the same (7 days default). `remove_orphan_files` deletes files never committed (default only those older than 3 days).' },
  ],
  flow: [
    { part: 'planner', title: 'Many tiny files found', text: 'A Flink job commits every minute into 24 hourly partitions: yesterday’s `dt=2026-11-24` has **34,000 files** averaging 6 MB. The planner reads manifests and selects them all.' },
    { part: 'binpack', title: 'Packed into groups', text: '200 GB of small files are packed into groups that produce ~400 files of 512 MB, rewritten 5 groups at a time.' },
    { part: 'rewrite', title: 'Rewritten sorted', text: 'Each group is read and written sorted by `(customer_id, event_ts)`. Min/max stats per file now cover narrow ranges, so a `customer_id = 81` query will skip ~99% of files.' },
    { part: 'commit', title: 'Atomic swap', text: 'The compaction commits snapshot 9,412: remove 34,000 files, add 400. Readers on snapshot 9,411 keep reading the old files; new queries see the new ones. No reader ever sees a half-compacted partition.' },
    { part: 'commit', title: 'Concurrent writer conflict', text: 'Meanwhile a CDC MERGE rewrote 3 files in the same partition. Those groups fail validation and are retried on the next run; with **partial progress** enabled the other groups are already committed. Plain appends to new files never conflict with compaction.' },
    { part: 'manifests', title: 'Manifests consolidated', text: '1,440 manifests from a day of per-minute commits become 12; query planning drops from 8 s to under 1 s.' },
    { part: 'expire', title: 'Old snapshots expired', text: 'Snapshots older than 5 days are expired and the 34,000 small files, no longer referenced, are deleted. Storage drops; time travel before that point is no longer possible.' },
  ],
  knobs: [
    {
      name: 'Layout strategy',
      options: [
        { label: 'binpack', effect: 'Cheapest: fixes file count only; no better pruning.', when: 'Frequent compaction of streaming partitions.' },
        { label: 'sort', effect: 'Tight min/max stats on the leading column; costs a shuffle.', when: 'Queries filter on one or two dominant columns.' },
        { label: 'Z-order / liquid clustering', effect: 'Pruning on several columns at once; most expensive; benefit fades past ~4 columns.', when: 'Ad-hoc BI filters on a few high-cardinality columns.' },
      ],
    },
    {
      name: 'When to compact',
      options: [
        { label: 'Inline / auto-compaction after writes', effect: 'Always tidy; adds latency and conflict risk to the writer.', when: 'Managed platforms (Databricks auto-compaction, S3 Tables).' },
        { label: 'Scheduled on closed partitions (e.g. hourly for hour−2)', effect: 'No conflicts with the streaming writer; the current hour stays fragmented.', when: 'Streaming ingestion into time-partitioned tables.' },
      ],
    },
    {
      name: 'Snapshot retention',
      options: [
        { label: 'Short (1–3 days)', effect: 'Small metadata and storage; little time travel; streaming readers that fall behind can lose their snapshot.', when: 'High-churn streaming tables.' },
        { label: 'Long (7–30 days)', effect: 'Time travel and rollback after bad writes; deleted data (and PII) lingers in old files.', when: 'Business-critical tables; keep within your GDPR deletion SLA.' },
      ],
    },
  ],
  implementations: [
    { name: 'Apache Iceberg', how: 'Spark procedures `rewrite_data_files` (binpack/sort/zorder, partial progress), `rewrite_manifests`, `expire_snapshots`, `remove_orphan_files`. AWS S3 Tables and Glue can run them automatically.' },
    { name: 'Delta Lake', how: '`OPTIMIZE … ZORDER BY`, liquid clustering, optimized writes and auto-compaction, `VACUUM`. Databricks predictive optimization schedules them for you.' },
    { name: 'Apache Hudi', how: 'Merge-on-read tables need **compaction** to merge row-level log files into base Parquet files (inline or async), plus **clustering** for layout and a cleaner for old versions.' },
    { name: 'Snowflake / BigQuery', how: 'Do this internally: micro-partitions and storage blocks are rewritten and automatically reclustered in the background, billed as service compute.' },
  ],
  ha: 'Compaction is a retryable batch job: each commit is atomic, so a crash leaves the table at the last good snapshot and only wastes work (orphan files are cleaned later). Run one compactor per table at a time (orchestrator lock), commit partially for large tables so progress survives conflicts, and scale by rewriting more file groups in parallel. Readers are never blocked thanks to snapshot isolation.',
  failureModes: [
    { name: 'Endless conflicts with MERGE writers', symptom: 'Compaction of a CDC table fails every run because upserts keep rewriting the same files.', fix: 'Compact partitions not being written, partial progress, schedule between merge windows, row-level concurrency/deletion vectors.' },
    { name: 'Never expiring snapshots', symptom: 'Storage grows forever, metadata files reach hundreds of MB, and "deleted" GDPR rows still exist in old files.', fix: 'Scheduled `expire_snapshots` / `VACUUM` with retention aligned to time-travel and deletion SLAs.' },
    { name: 'Expiring too aggressively', symptom: 'A long query or lagging streaming reader fails with `FileNotFound` on files of a snapshot it was using.', fix: 'Retention longer than the longest query and reader lag; never `remove_orphan_files` with a window shorter than the longest write job.' },
    { name: 'Never compacting', symptom: '1 M files of 50 KB; planning and opening files dominate query time and S3 request costs.', fix: 'Scheduled compaction and manifest rewrites; larger trigger intervals on writers.' },
  ],
  numbers: ['Target file size: 128 MB–1 GB (Iceberg 512 MB default, Delta OPTIMIZE ~1 GB)', 'Per-minute commits × 24 partitions ≈ 35k files/day', 'S3 first-byte latency ~10–100 ms per file opened', 'Snapshot retention: Iceberg 5 days, Delta VACUUM 7 days by default', 'Z-order: effective on ~2–4 columns'],
  interview: [
    { q: 'Why are small files a problem and how do you fix them for a streaming table?', a: 'Each file costs a metadata entry, an S3 GET with ~10–100 ms latency, a Parquet footer read and a task to schedule; a million 50 KB files make planning and scanning far slower than a few hundred 512 MB files with the same data, and cost more in requests. Fix at both ends: commit less often (longer trigger/checkpoint interval, optimized writes) and run scheduled compaction plus manifest rewrites on closed partitions, then expire snapshots so the small files are actually deleted.' },
    { q: 'How can compaction run while a streaming job keeps writing to the same table?', a: 'Optimistic concurrency. Compaction reads a snapshot, writes new files, and commits a replace that removes the old files only if they are still live. New appends add new files and do not conflict; a concurrent delete/update/MERGE that touched a rewritten file makes that file group fail validation, which is retried later. Compacting partitions that are no longer being written (e.g. hours older than now − 2 h) avoids conflicts altogether.' },
    { q: 'You deleted a user for GDPR. Is the data gone?', a: 'Not yet. A DELETE creates a new snapshot without the rows (or with delete files), but older snapshots still reference data files containing them, so time travel can read them. The data is physically gone only after those snapshots are expired and the files removed (`expire_snapshots` / `VACUUM`), and with merge-on-read deletes, after compaction rewrites the affected files. Retention must fit the legal deletion deadline.' },
  ],
};

export const PROCESS_INTERNALS: Internals[] = [FLINK, SPARK_SS, SPARK, DBT, SALT, AIRFLOW, COMPACTION];
