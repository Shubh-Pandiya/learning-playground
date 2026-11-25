# Data Modelling Playground: learning design

The goal is to model a schema you have never seen before, and to defend it: why this grain, why this key, which query pays for which choice.
Memorising textbook definitions of 3NF or SCD2 is not the goal.
Each mechanic below comes from learning research. The app shows the same list at `/data-modeling/method`; the source of truth is `PRINCIPLES` in `pages/Method.tsx`.

## The loop for each canvas topic

| Stage | Route | What you do | Why |
| --- | --- | --- | --- |
| **Learn** | `/data-modeling/t/:id/learn` | Step through a narrated build of the reference model on the canvas. Key steps freeze until you predict the outcome ("how many rows does this UPDATE touch?"). Each step shows *what changed → impact*. | Worked example, generation effect |
| **Build** | `/data-modeling/t/:id/build` | Same scenario, no narration. Drag tables, columns and keys, draw FKs, add indexes. The closeness score, requirements and red flags update live. Three hint levels. | Faded guidance, immediate feedback |
| **Challenge** | `/data-modeling/t/:id/challenge` | A new domain with the same deep structure. Two hints, and the "still to do" list is hidden. | Transfer, desirable difficulty |
| **Review** | `/data-modeling/review` | Recall questions interleaved across topics, plus "name the technique from the interview cue" drills, on an SM-2 schedule. | Retrieval, spacing, interleaving |

A canvas topic counts as **mastered** once you solve its Challenge.
A lab topic counts as mastered once you have done all its exercises.

## The impact model: every change tells you what it did

`engine/analyze.ts` treats a schema as tables of *attributes* backed by a scenario's functional dependencies, row counts and access patterns. From that it derives:

- **Normal form per table:** 1NF, 2NF, 3NF or BCNF, computed from the FDs. It names the partial or transitive dependency at fault.
- **Write anomalies:** update, insert and delete anomalies, and rows touched per write pattern (for example, renaming a category touches 30k rows → 1 row).
- **Read cost per access pattern:** joins against the pattern's budget, seek or scan per hop (using PKs and indexes), and rows read. The path is highlighted on the canvas.
- **Storage and duplication:** bytes per table and the share of the total that is duplicated.
- **Red flags:** for example, a fact table at the wrong grain, a dimension attribute stored in a fact, many-to-many without a bridge, a list in a column, a natural key that changes, a non-additive measure that gets summed, or a lost attribute.

`diffImpact(before, after)` turns any two schemas into a ranked list of human-readable deltas, for example "Order page: 0 → 1 join (+1, within budget 3)" or "Storage 1.5 GB → 990 MB (−32%)".
Each Learn step and Build action shows this list, and the *Changes* tab keeps a full log.
`engine/evaluate.ts` scores closeness to the reference (tables, columns placed, keys and relationships), checks requirements, and marks trap tables red, along with the scenario-specific reason and the right alternative.

## Labs: mechanism and judgment

Some ideas are processes over time or decisions under constraints, not just shapes on a canvas. Each of these gets an interactive lab (`labs/*`) with "under the hood" notes and scored exercises:

| Lab | What you manipulate | What it shows |
| --- | --- | --- |
| **Normal forms, row by row** | Rows of a real table. Trigger an update, insert or delete, then decompose. | Anomalies animate row by row. The decomposition is checked for lossless joins and dependency preservation. |
| **Schema review** | A teammate's plausible but flawed schema | You flag and classify each flaw. False alarms cost points. |
| **Slowly changing dimensions** | A stream of changes over a timeline | SCD types 0, 1, 2, 3, 4 and 6 side by side. You see which reports change their answer, and how a MERGE closes and opens rows. |
| **Schema evolution & data contracts** | Expand/contract migration steps, and Avro schema changes | Locks, dual-writes, backfills and reader/writer compatibility (BACKWARD/FORWARD/FULL). |
| **NoSQL access patterns** | DynamoDB PK/SK and GSIs, and Cassandra partition and clustering keys | Items per query, hot partitions, and partition-size limits. |
| **Partitioning, clustering & the lakehouse** | Partition columns, clustering, file sizes, late data, and medallion layers | Bytes scanned, files skipped, the small-file problem, and bronze/silver/gold placement. |
| **Multi-tenancy** | Shared table, schema-per-tenant or DB-per-tenant, tenant packing and RLS | Blast radius, noisy neighbours, cost per tenant, and isolation. |

## Principles applied

1. **Causal feedback** (Mayer: signalling and contiguity). Every drop, move, key toggle, index or FK writes a before → after entry: joins gained or lost, rows touched, anomalies, storage and closeness.
2. **Worked example → faded guidance → scratch** (Sweller, Renkl). Learn builds the reference. Build fades the narration to 3 hints. Challenge allows 2 hints and gives no checklist.
3. **Prediction before reveal** (Slamecka & Graf, Kornell). The canvas keeps the old schema until you commit to a guess. Accuracy is tracked on the home page.
4. **Desirable difficulty** (Bjork). Palettes mix in plausible traps: a list column, a dropped price snapshot, a snowflaked dimension, a summed balance, a hot partition key.
5. **Dual coding and animation** (Paivio, Mayer). Query paths light up across joins and scans are badged. Anomalies, SCD versions and partition pruning all animate.
6. **Mechanism, not labels** (Chi). Labs explain how Postgres enforces FKs, how a MERGE rewrites files, how DynamoDB hashes keys, how RLS filters rows, and how expand/contract avoids locks.
7. **Retrieval and spacing** (Roediger & Karpicke, Cepeda). Recall questions are graded by confidence and feed an SM-2 schedule. Due cards appear on the home page and in the cross-module Today plan.
8. **Interleaving** (Rohrer & Taylor). Review mixes topics, so you practise *choosing* the technique.
9. **Transfer** (Gick & Holyoak). Each Challenge changes the domain while keeping the deep structure.
10. **Error detection** (Große & Renkl). The schema-review lab trains you to spot flaws, and false-alarm penalties teach you to verify before you object.
11. **Judgment under constraints** (Ericsson, Klein). Labs ask for decisions with costs: a zero-downtime migration, a partition key under skew, a tenancy model at 10 vs 10,000 tenants.
12. **Concrete anchors** (elaborative encoding). Each topic lists real systems, such as Stripe ledgers, Uber trips, DynamoDB single-table design, Databricks medallion layers and Kimball retail schemas.

## Topics

- **Foundations:** ER modelling, cardinality and keys (natural vs surrogate).
- **Relational design:** normal forms row by row (lab), normalizing a production table, denormalization tradeoffs, and schema review (lab).
- **Analytics modelling:** star schema and grain, fact types (transaction, periodic and accumulating snapshots, factless; additive, semi-additive and non-additive measures), advanced dimensions (conformed, junk, degenerate, role-playing, bridge), SCD types 0–6 (lab), Data Vault (hubs, links, satellites), and event and time-series modelling (One Big Table).
- **Physical and platform:** partitioning, clustering, bucketing and lakehouse medallion layers (lab), and NoSQL access-pattern modelling (lab).
- **Change and scale:** schema evolution and data contracts (lab), and multi-tenancy (lab).

## How it is built

- `types.ts` defines the model. A `Scenario` has attributes, FDs, row counts, access patterns, requirements, table templates (including traps), a reference solution and per-template notes.
- `data/canvas/*.ts` holds one file per canvas topic: the scenario, guided frames with predictions, the challenge scenario, the brief and the quiz. `data/topics.ts` discovers these files and `labs/*/topic.ts` by glob, and orders them.
- `engine/analyze.ts` covers FDs, normal forms, anomalies, read paths, write cost, storage and `diffImpact`. `engine/evaluate.ts` covers closeness, requirements, verdicts and hints.
- `ui/*` is the React Flow canvas (`TableNode`, `RelEdge`), plus the palette, metrics strip, impact panel, inspector and change card.
- `store.ts` holds persisted progress under `lp:dm:*` and SM-2 review state, and reports to the home page with `reviews` and `nextSteps`.
