# Advanced SQL Playground: learning design

The aim is engineering judgment, not syntax recall. A learner should be able to:

1. Predict what Postgres will do with a query: rows, cardinality and plan.
2. Pick the right technique for an unseen business question.
3. Spot the bug, slow plan or race condition in someone else's SQL, and justify the fix with measured impact.

Every query runs on a real Postgres 17 (PGlite/WASM in a Web Worker) against small, hand-seeded datasets. They're small enough to see every row, but they contain the traps that matter: NULLs, duplicates, users with no orders, ties and fan-out. The `big_*` tables (≈220k rows, loaded on demand) make the planner choose real plans.

## The loop per concept

| Tab | What happens | Principle |
| --- | --- | --- |
| Understand | Intuition, **how Postgres implements it** (executor nodes, hash tables, sort/frame buffers, B+tree pages, MVCC), common mistakes, question signals, template, real DE/backend uses | Mechanism over magic; elaboration |
| Visualize | Real rows step through FROM → JOIN → WHERE → GROUP BY → HAVING → window → SELECT → DISTINCT → ORDER BY → LIMIT, with fan-out, NULL-extended, dropped rows, groups and partitions coloured. Predictions are asked before key reveals. For indexes, plans and isolation it shows the B+tree lab, EXPLAIN variant lab or MVCC simulator instead | Generation effect; dual coding |
| Build | Drag-and-drop clauses into a query skeleton: worked → faded → scratch. Each drop re-runs the query and shows **what changed** (rows ±, cardinality, plan). Trap blocks give a targeted "why this is wrong" | Worked examples, fading; immediate causal feedback |
| Practice | Exercises (write, fix-bug, optimize) graded against the reference result. Optimize exercises also check the plan. Results are diffed against your previous run. Hints are graded and the reference is unlocked only after effort | Desirable difficulty; feedback |
| Judge | Realistic PRs, slow dashboards and race conditions: click the faulty line, pick the diagnosis, then both versions run and the result/plan diff shows the impact | Deliberate practice on flawed artefacts |
| Reflect | Recall questions, an "explain it to a junior" note, and transfer scenarios | Self-explanation; retrieval; transfer |

## Change → impact, everywhere

- **Builder:** every drop or removal re-assembles the SQL, runs it and diffs it against the previous result. The diff covers rows added/removed, cardinality and plan cost, and gives a reason when a trap block was used.
- **Lab and Practice:** every run is compared with your last one, and every EXPLAIN with your last plan (scan type, join algorithm, cost and ms).
- **Plan lab:** "What changed vs v(n-1)" for each variant, e.g. adding an index or rewriting a predicate, plus a "try your own change" editor.
- **B+tree lab:** each page visited is narrated, and the totals for pages read, heap pages and matches end with an impact summary. Inserts log their page splits.
- **Isolation lab:** each step lists the row versions created or expired, locks taken and snapshots. Switching level keeps your place, so you see exactly which step diverges. A matrix runs the same interleaving at all four levels.

## Cross-concept practice

- **Drill (interleaving):** 10 unseen scenarios shuffled across tracks with no two from the same track in a row. Distractors come from each concept's `confusable` list.
- **Review (spacing):** SM-2 cards are created when a concept is built or solved, then graded Again/Hard/Good/Easy. Due reviews and next steps feed the app-wide Today plan (`useReportProgress('sql', {reviews, nextSteps})`).
- **Judgment page:** every drill in one place, filterable by spot-bug, slow-query or peer-review.

## Mastery

0 new · 1 explored (visualized/predicted) · 2 built (faded or scratch) · 3 practised (an exercise solved) · 4 mastered (scratch build, all exercises, and at least one successful review).

## Content quality

`scripts/validate.ts` runs every worked query, build assembly, trap block, exercise solution, starter, judgment pair and plan variant against the same seeded PGlite in Node. It checks that predictions match real results, fix-bug starters actually differ, optimize plans meet their constraints, and the pipeline parser can stage worked queries.
