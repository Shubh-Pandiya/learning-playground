# Data Engineering System Design Playground: learning design

The goal is to design data platforms you have never seen and defend them: why streaming here and batch there, what happens when data arrives late or twice, what a backfill costs, and who notices when an upstream schema changes.
Memorising a stack of pipeline diagrams is not the goal.
The learner this module targets is a backend engineer moving into data engineering. Ideas that carry over (idempotency, queues, SPOFs) are reused. Data-specific failure modes, which are silent wrong numbers rather than 500s, get the most practice.

Each mechanic below comes from learning research. The app shows the same list at `/de-system-design/method`; the source of truth is `PRINCIPLES` in `pages/Method.tsx`.
The module is a twin of `/system-design`. It has the same mechanics and look, but its domain model, engine, content, internals and drills are data-engineering specific.
Deep dives live in the sibling modules and are linked, not duplicated: `/kafka` (partitions, consumer groups, EOS) and `/data-modeling` (star schema, SCD, partition keys).

## The loop for each pattern

| Stage | Route | What you do | Why |
| --- | --- | --- | --- |
| **Learn** | `/de-system-design/p/:id/learn` | Step through a narrated build of the reference pipeline. Steps that inject a data incident (late burst, duplicate replay, crash mid-write…) or a node failure pause until you predict the outcome. Each step shows *what this step changed* as a measured diff. | Worked example, generation effect |
| **Build** | `/de-system-design/p/:id/build` | The sources are pre-placed and the SLAs are real. Drag components, wire them, and watch freshness, throughput, guarantees and cost update. Traps in the palette turn red with a scenario-specific reason. 3 hint levels. | Faded guidance, immediate feedback |
| **Challenge** | `/de-system-design/p/:id/challenge` | A new domain with the same deep structure. 2 hints, and the "still missing" list is hidden. | Transfer, desirable difficulty |
| **Review** | `/de-system-design/review` | Recall questions interleaved across patterns, plus "name the pattern from the interview cue" drills, on a spaced schedule. | Retrieval, spacing, interleaving |

A pattern counts as **mastered** once its Challenge is solved.

## The impact model: every change tells you what it did

The live **Capabilities** panel and the top **metric strip** are data-engineering specific:

| Capability | What it means |
| --- | --- |
| Freshness | Event → queryable delay, compared with the scenario's target (seconds for streams, the schedule interval plus job runtime for batch). |
| Throughput | The max records/s the design sustains, and the bottleneck node. 2×/3×/5× volume shows where it bends. |
| Delivery guarantee | At-most-once, at-least-once (duplicates possible) or effectively exactly-once (replayable source, checkpointed processor and a transactional or idempotent sink, end to end). |
| Late data | Dropped, processing-time (wrong buckets), or event-time with watermarks and allowed lateness. |
| Backfill | None, a manual re-ingest, replay from a retained log, or re-runnable partitioned tasks with an orchestrator. |
| Schema safety | Fragile, or enforced by a schema registry or data contracts. |
| Query p99 | For serving stores, at the scenario's query load. Unsuitable stores (row-store OLTP for aggregates, an object store scan) are slow. |
| Loss risks and SPOFs | Concrete data-loss paths (non-replayable source plus a crash, a buffer with no durability) and single points of failure. |
| Small files, cost, trust | File-count blow-up without compaction, monthly cost, quality checks, lineage, PII handling, and load on the production OLTP database. |

Every add, remove, connect, scale, kill, volume or **chaos** action writes a change-log entry. Each entry shows the before→after deltas of those capabilities, per-node load shifts, new risks, and requirements gained or lost.

## Chaos: data-specific failure, predicted first

The **Chaos** menu (Learn, Build, Challenge and design reviews) runs seven data incidents against the current design. You must predict the outcome first. The outcome scale is *absorbed → delayed but correct → breaks loudly → silently wrong numbers → data permanently lost*:

- **Late-data burst:** event-time windows plus a watermark absorb it, while processing-time aggregation puts late events in the wrong buckets.
- **Upstream schema change:** a registry or contract fails fast, while without one the pipeline breaks or silently nulls a column.
- **Hot key:** one key overloads a task unless the job salts or does a two-phase aggregation.
- **Job crash mid-write:** checkpoints plus transactional or atomic commits absorb it, while plain file writes leave partial output or duplicates.
- **Duplicate replay:** idempotent or upsert sinks and exactly-once absorb it, while append sinks double-count.
- **Source outage:** a durable log or CDC with retained WAL replays the gap, while push sources without a buffer lose the data.
- **Small-files explosion:** compaction absorbs it, while without compaction query latency and metadata costs climb.

"Kill one instance" on any node also asks for a prediction. The engine (`engine/chaos.ts`) explains *why*, naming the nodes where the effect shows up, and highlights them on the canvas.

## Beyond patterns: internals and judgment

| Surface | Route | What you do | Why |
| --- | --- | --- | --- |
| **Inside** | `/de-system-design/inside`, `/inside/:kind`, or "Look inside" on any selected component | Animated record path through the component's parts, drag-to-order Assemble, design knobs with real defaults, implementations, failure modes, napkin numbers, interview questions, and labs. | Mental models, generation, productive play |
| **Labs** | `/de-system-design/inside/:kind?tab=lab` | **Spark** (DAG → stages at shuffle boundaries, partitions and skew), **Flink** (watermarks, windows, allowed lateness; checkpoint barriers and recovery), **Parquet** (row groups, column chunks, min/max stats, predicate pushdown and pruning), **Iceberg** (snapshot → manifest list → manifests → data files, time travel, compaction), **Airflow** (scheduler, executor, retries, catchup and backfill of idempotent partitions), **CDC** (WAL/binlog → Debezium → Kafka; snapshot vs streaming, ordering per key), **OLAP** (rollup and pre-aggregation vs raw scan, segments and indexes). | Productive play |
| **Design review** | `/de-system-design/practice/review/:id` | Critique a teammate's plausible but flawed pipeline. Test it live with volume, chaos and kill, then flag nodes and edges and classify each flaw: data loss, duplicates, late data, schema, SPOF, bottleneck, freshness, wrong tool, cost or governance. False alarms cost points. | Erroneous examples |
| **Incident drill** | `/de-system-design/practice/incident/:id` | On-call for the data platform: a dashboard doubled overnight, partitions are missing, a stream is stuck. Go through triage → root cause → mitigate → prevent, then read a blameless postmortem. The injected chaos is re-run against the live design to show what happened. | Case-based, deliberate practice |
| **ADR-lite** | `/de-system-design/practice/adr/:id` | Decisions such as batch vs streaming, warehouse vs lakehouse, Lambda vs Kappa, or CDC vs dual writes. Commit to an option, write Decision / Because / We accept / Revisit when, then compare with the expert ADR. | Self-explanation, metacognition |

## Principles applied

1. **Worked example → faded guidance** (Sweller, Renkl). Learn → Build (3 hints) → Challenge (2 hints, hidden gaps).
2. **Prediction before reveal** (Slamecka & Graf; Kornell). Guided chaos steps, the Chaos menu and kill all ask first. Accuracy is tracked.
3. **Immediate, specific feedback** (Hattie & Timperley). Every component and link explains itself *in this scenario*. Traps turn red with "use instead".
4. **Dual coding and animation** (Paivio, Mayer). Streams flow as dots, batches as slow blocks, queries in blue and orchestration as dotted lines. Lagging nodes glow, with lag, hot-key and file counts shown.
5. **Desirable difficulty** (Bjork). Palettes mix the right parts with plausible traps: a nightly cron for a seconds-fresh SLA, dual writes instead of CDC, dashboards on the production OLTP database, a lake without a table format.
6. **Retrieval and spacing** (Roediger & Karpicke; Cepeda). Confidence-graded recall feeds an SM-2-style schedule, and due cards appear on the app's home "Today" plan.
7. **Interleaving** (Rohrer & Taylor). Review mixes patterns, so you practise *choosing* the pattern.
8. **Transfer** (Gick & Holyoak). Each Challenge has the same deep structure with a different surface story and numbers.
9. **Concrete anchors.** Real platforms (Uber, Netflix, Airbnb, LinkedIn, Shopify…) for every pattern and component.
10. **Failure as a teacher** (Kapur). Data-specific chaos lets you break your own pipeline.
11. **Causal feedback** (Mayer's signalling). Each change appears next to its measured effect.
12. **Mechanism over label** (Chi). Inside views and labs teach how Spark shuffles, how Flink checkpoints, how Parquet skips data and how Iceberg commits.
13. **Erroneous examples** (Große & Renkl). Design reviews.
14. **Deliberate, case-based practice** (Ericsson, Klein). Incident drills.
15. **Self-explanation + expert comparison** (Chi, Dunlosky). ADR-lite.

## Patterns

- **Batch:** 1 Batch ELT into a warehouse · 2 Cloud data warehouse (storage/compute separation, MPP, columnar) · 3 Orchestration (idempotent, backfillable DAGs, SLAs).
- **Lakehouse:** 4 CDC into a lakehouse · 5 Table formats (Iceberg/Delta/Hudi: snapshots, ACID, time travel) · 6 Medallion layers.
- **Streaming:** 7 Exactly-once streaming · 8 Late data, event time and watermarks · 9 Deduplication and idempotent sinks · 10 Lambda vs Kappa.
- **Serving:** 11 Real-time OLAP · 12 Small files and compaction · 13 Partitioning and skew · 16 Feature store / ML pipeline.
- **Trust:** 14 Data quality and observability (contracts, freshness/volume/schema checks) · 15 Governance, catalog, lineage and PII.
- **Interview:** 17 Clickstream analytics · 18 Ad click aggregation · 19 Log analytics.

## How it is built

- `data/components.ts`: the component catalog (sources, ingest, process, store, govern, serve and anti-patterns). Each component lists what it solves, its tradeoffs, real-world use, a pitfall, and its flow model (role, capacity in records/s, added delay, delivery semantics, replayability, cost).
- `data/patterns/*`: each pattern as data, written with a small DSL (`dsl.ts`). It holds the scenario (workload in records/s, late/duplicate/skew fractions, query load), requirements as checks, the reference graph, guided steps (with optional `chaos`, `kill` and `predict`), per-scenario wrong-component notes, a transfer challenge, and quizzes.
- `engine/simulate.ts`: a napkin-math dataflow model. It propagates records/s from sources, applies capacity and skew, and derives freshness, throughput and bottleneck, delivery semantics, late-data handling, backfill, schema safety, query p99, small files, loss risks, SPOFs, OLTP load and cost.
- `engine/chaos.ts`: the seven chaos events plus `predictKill`, with outcomes and explanations.
- `engine/evaluate.ts`: requirement checks, closeness to the reference, node and edge verdicts, and hints.
- `engine/diff.ts`: change-log diffs.
- `internals/`: per-component internals (`data/{ingest,process,storage,govern}.ts`), views and labs (`labs/*`).
- `judgment/`: review, incident and ADR cases. Drill pages live in `pages/{Practice,DesignReview,Incident,Adr}.tsx`.
- `store.ts`: progress, canvases, spaced-repetition cards and drill scores, persisted under `lp:desd:*`. It reports to the shell via `reportProgress('de-system-design', …)` with `reviews` and `nextSteps` for the home "Today" plan.

## Content validation

`scripts/validate.ts` checks the content against the engine. It exits 1 on errors:

```
npx rolldown src/modules/de-system-design/scripts/validate.ts --file node_modules/.cache/desd-validate.mjs --platform node --format esm \
  && node node_modules/.cache/desd-validate.mjs [patternId] [--verbose]
```

For every scenario (build and challenge) it checks:
- the reference design solves at **100%** with every node and edge verdict "good", and no reference node is overloaded or dead
- the palette contains every reference kind
- **every trap is flagged**: each `wrong` kind and each anti-pattern in the palette gets a "wrong" verdict, and adding it to the reference makes the design unsolved

It also checks:
- guided step ids, kill targets and visibility, and quiz and predict answer ranges, with unique ids
- internals parts and flow references
- that drill graphs, flaw targets, incident injections and ADR and pattern references all resolve
