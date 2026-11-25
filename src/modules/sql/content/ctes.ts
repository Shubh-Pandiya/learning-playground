import type { Concept } from '../types';

/**
 * Track: CTEs & recursion.
 * Every SQL string runs against the seeded dataset (data/dataset.ts) and is checked by
 * scripts/validate.ts. Numbers quoted in prose / predictions were verified on that data.
 */
export const ctes: Concept[] = [
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'cte-basics',
    track: 'ctes',
    title: 'CTEs: named steps, and what the planner does with them',
    tagline: 'WITH turns a nest of subqueries into a readable pipeline of steps — and since Postgres 12 the planner decides whether each step is inlined or computed once.',
    level: 'core',
    minutes: 12,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      'A CTE (`WITH name AS (…)`) gives an intermediate result a **name**, so a query reads top to bottom as a list of steps: “first collapse orders to one row per customer, then compute the benchmark, then compare”. Each step has one job and a grain you can say out loud.',
      'For a single reference a CTE means exactly the same as a derived table (`FROM (SELECT …) x`). The wins are human ones: you can read it in order, you can **reference the same step twice** (a per-customer aggregate and the average of that aggregate) without copy-pasting it, and you can debug by temporarily ending the query with `SELECT * FROM step_2`.',
      'A **temp table** is the heavier tool: it survives across statements, can be indexed and `ANALYZE`d, so the planner has real statistics. Reach for it when several statements reuse a large intermediate result or when a bad row estimate on a CTE ruins the rest of the plan. A CTE lives for exactly one statement.',
      'CTEs can also contain `INSERT/UPDATE/DELETE … RETURNING`. That lets you do multi-step changes atomically in one statement (`WITH moved AS (DELETE … RETURNING *) INSERT INTO archive SELECT * FROM moved`). The catch: every part of the statement sees the **same snapshot**, so the main query does not see the CTE’s changes — only its `RETURNING` rows.',
    ],
    internals: [
      'Up to Postgres 11 every CTE was an **optimization fence**: it was executed once into a tuplestore and read back through a `CTE Scan`, and no outer predicate was pushed into it. Since **Postgres 12** a non-recursive, side-effect-free CTE that is referenced **exactly once** is inlined like a subquery, so `WHERE user_id = 42` outside can be pushed down and use an index. A CTE referenced **two or more times** is still materialized by default: EXPLAIN shows `CTE paid` once and one `CTE Scan on paid` per reference.',
      '`AS MATERIALIZED` forces the old fence (compute once, reuse — good for an expensive step used many times, or to stop a volatile function from being evaluated per reference). `AS NOT MATERIALIZED` forces inlining even when referenced twice: the work is duplicated, but each reference gets its own predicate pushdown and index use. The materialized tuplestore lives in `work_mem` and spills to a temp file; it has no indexes and no column statistics, so filters on a `CTE Scan` are estimated with default selectivities.',
      'Recursive CTEs, data-modifying CTEs and CTEs calling volatile functions are always materialized. A data-modifying CTE runs **to completion exactly once**, whether or not anything reads it, and all sub-statements share one snapshot: they cannot see each other’s writes, and two of them must not modify the same row.',
      'Other engines differ, and interviewers like this follow-up: SQL Server always inlines (a CTE referenced twice is executed twice); BigQuery also re-evaluates a non-recursive CTE per reference (so a CTE using `RAND()` can disagree with itself and you pay the scan twice); Snowflake usually computes a multi-reference CTE once (`WithClause` / `WithReference` in the query profile); MySQL 8 merges or materializes much like Postgres 12+.',
    ],
    signals: [
      'multi-step logic: first compute X, then compare to Y',
      'compare each row against an overall benchmark / average',
      'the same intermediate result is needed twice',
      'unreadable nest of subqueries in a PR',
      'move / archive rows and report on them in one statement',
    ],
    template: `WITH per_user AS (                 -- step 1: collapse to the grain you need
  SELECT user_id, SUM(amount) AS revenue
  FROM orders
  WHERE status = 'paid'
  GROUP BY user_id
),
benchmark AS (                     -- step 2: built from step 1
  SELECT AVG(revenue) AS avg_revenue FROM per_user
)
SELECT p.user_id, p.revenue        -- step 1 referenced again → materialized once
FROM per_user p
CROSS JOIN benchmark b
WHERE p.revenue > b.avg_revenue;`,
    realWorld: [
      {
        title: 'dbt models are CTE pipelines',
        body: 'The dbt style guide is “import CTEs → logical CTEs → final select”. Reviewers read each step’s grain in order instead of decoding nested subqueries. The same structure makes it trivial to unit-test a step by selecting from it.',
      },
      {
        title: 'The Postgres 12 upgrade that changed plans',
        body: 'Teams that relied on CTEs as fences (to force a join order) saw plans change after upgrading to 12; others found reports got faster because predicates were finally pushed into CTEs. Knowing `MATERIALIZED` / `NOT MATERIALIZED` is how you pin either behaviour explicitly.',
      },
      {
        title: 'Archive + audit in one atomic statement',
        body: '`WITH moved AS (DELETE FROM jobs WHERE finished_at < now() - interval \'30 days\' RETURNING *) INSERT INTO jobs_archive SELECT * FROM moved` moves rows without a window where they exist in both or neither table — no application-side transaction juggling.',
      },
    ],
    mistakes: [
      {
        title: 'Assuming a CTE is always (or never) materialized',
        why: 'Postgres 12+ inlines single-reference CTEs and materializes multi-reference ones; older versions and some tutorials say “CTEs are fences”. Adding `MATERIALIZED` out of habit can block index use on a filtered reference.',
        fix: 'Read EXPLAIN: `CTE Scan` means materialized. Use `MATERIALIZED` / `NOT MATERIALIZED` deliberately.',
      },
      {
        title: 'Averaging averages across chained steps',
        why: 'Step 1 computes AVG per customer, step 2 averages those per plan — every customer weighs the same regardless of how many orders they placed.',
        fix: 'Carry additive measures (SUM, COUNT) through the steps and divide only at the end.',
      },
      {
        title: 'Expecting the main query to see a data-modifying CTE’s changes',
        why: 'All parts of the statement read the same snapshot taken before it started; `SELECT … FROM orders` after `UPDATE orders` in a CTE still sees the old rows.',
        fix: 'Consume the CTE’s `RETURNING` rows (join them in), or run a second statement.',
      },
      {
        title: 'Using a CTE where a temp table is needed',
        why: 'A huge intermediate reused by several statements is recomputed every time, and its rows have no statistics or indexes.',
        fix: '`CREATE TEMP TABLE … AS`, add an index, `ANALYZE` it, then reuse it.',
      },
    ],
    worked: {
      question: 'Customer success wants the customers whose paid revenue is above the average paying customer’s revenue — with the average shown next to them.',
      sql: `WITH paid AS (
  SELECT user_id, COUNT(*) AS orders, SUM(amount) AS revenue
  FROM orders
  WHERE status = 'paid' AND user_id IS NOT NULL
  GROUP BY user_id
),
benchmark AS (
  SELECT AVG(revenue) AS avg_revenue FROM paid
)
SELECT u.name, p.orders, p.revenue, ROUND(b.avg_revenue, 2) AS avg_revenue
FROM paid p
JOIN users u ON u.id = p.user_id
CROSS JOIN benchmark b
WHERE p.revenue > b.avg_revenue
ORDER BY p.revenue DESC`,
      notes: {
        cte: '`paid` is referenced twice (by `benchmark` and by the main FROM), so Postgres does **not** inline it here: EXPLAIN shows `CTE paid` computed once and two `CTE Scan on paid` nodes reading the same tuplestore. `benchmark` is referenced once and is a single-row step.',
        join: 'The CROSS JOIN with a one-row CTE is the idiomatic way to put a benchmark next to every row: it cannot fan out because the right side has exactly one row.',
        where: 'The mean is 3935 / 7 = 562.14 and is dragged up by Fatima’s 1680. Asha (500) is a top customer by orders but falls just under it — a median benchmark would tell a different story.',
      },
      predictions: [
        {
          stage: 'cte',
          kind: 'rowcount',
          question: '8 distinct user_id values have paid orders if you count the guest checkout (user_id NULL). How many rows does `paid` contain?',
          explain: '7: the guest order 16 is excluded by `user_id IS NOT NULL`. Without that filter the NULL user would form its own group and drag the average down to 498.13.',
        },
        {
          stage: 'where',
          kind: 'choice',
          question: 'Paid revenue per customer is 1680, 1160, 500, 490, 45, 35, 25. How many customers beat the average?',
          options: ['2', '3', '4', 'All 7 — it’s per customer'],
          answer: 0,
          explain: 'The average is 562.14, so only Fatima (1680) and Dana (1160) pass. A single big customer pulls the mean above most customers — a classic skew follow-up question.',
        },
      ],
      takeaway: 'Name each step and its grain; reference a step as often as you like — Postgres materializes a multi-reference CTE once and inlines a single-reference one.',
    },
    build: {
      prompt: 'Revenue share per product category from **paid** orders. `paid_lines` (one row per paid line item) is given. Build `by_category` (one row per category: `orders` = distinct orders, `revenue`) and a main query returning category, orders, revenue and `pct_of_revenue` (1 decimal), biggest revenue first.',
      given: `paid_lines AS (
  SELECT o.id AS order_id, p.category, i.qty * i.unit_price AS line_total
  FROM orders o
  JOIN order_items i ON i.order_id = o.id
  JOIN products p ON p.id = i.product_id
  WHERE o.status = 'paid'
)`,
      ctes: ['by_category'],
      blocks: [
        { scope: 'by_category', slot: 'select', sql: 'category', why: 'The grain of this step: one row per category.' },
        { scope: 'by_category', slot: 'select', sql: 'COUNT(DISTINCT order_id) AS orders', why: 'paid_lines is one row per line item; an order with a keyboard and a mouse has two electronics lines, so count distinct orders.' },
        { scope: 'by_category', slot: 'select', sql: 'SUM(line_total) AS revenue', why: 'Line totals are additive, so summing them per category is exact (no fan-out: each line appears once).' },
        { scope: 'by_category', slot: 'from', sql: 'paid_lines', why: 'Chain on the previous step instead of repeating its joins.' },
        { scope: 'by_category', slot: 'groupBy', sql: 'category', why: 'Collapse lines to categories.' },
        { slot: 'select', sql: 'b.category', why: 'One output row per category.' },
        { slot: 'select', sql: 'b.orders', why: 'Carried through from the step.' },
        { slot: 'select', sql: 'b.revenue', why: 'Carried through from the step.' },
        {
          slot: 'select',
          sql: 'ROUND(100 * b.revenue / (SELECT SUM(revenue) FROM by_category), 1) AS pct_of_revenue',
          why: '`by_category` is referenced a second time for the grand total, so Postgres materializes it once and reads it twice.',
        },
        { slot: 'from', sql: 'by_category b', why: 'The main query reads the finished step like a table.' },
        { slot: 'orderBy', sql: 'b.revenue DESC', why: 'Biggest category first.' },
      ],
      traps: [
        {
          scope: 'by_category',
          slot: 'select',
          sql: 'COUNT(*) AS orders',
          replaces: 'COUNT(DISTINCT order_id) AS orders',
          why: 'Counts line items, not orders: electronics would show 11 instead of 9 because several paid orders have two electronics lines.',
        },
        {
          scope: 'by_category',
          slot: 'groupBy',
          sql: 'order_id',
          why: 'Adding order_id changes the grain to category × order: you get one row per order per category and the percentages no longer describe categories.',
        },
        {
          slot: 'select',
          sql: 'ROUND(100 * b.revenue / SUM(b.revenue), 1) AS pct_of_revenue',
          replaces: 'ROUND(100 * b.revenue / (SELECT SUM(revenue) FROM by_category), 1) AS pct_of_revenue',
          why: 'A plain aggregate turns the main query into a GROUP BY query, and b.revenue is not grouped — error. Use a scalar subquery on the CTE (or `SUM(b.revenue) OVER ()`).',
        },
        {
          slot: 'from',
          sql: 'paid_lines b',
          replaces: 'by_category b',
          why: 'Skips the aggregation step: paid_lines has no orders/revenue columns at category grain — error, and the wrong grain even if it ran.',
        },
      ],
    },
    exercises: [
      {
        id: 'cb-country-above-avg',
        kind: 'write',
        title: 'Countries above the average country',
        difficulty: 'Medium',
        prompt: 'Using paid orders of registered users, compute per country (NULL country → `\'unknown\'`) the number of distinct buyers (`buyers`) and revenue (`revenue`). Return `country, buyers, revenue` only for countries whose revenue is above the average country revenue, highest revenue first.',
        solution: `WITH country_rev AS (
  SELECT COALESCE(u.country, 'unknown') AS country,
         COUNT(DISTINCT o.user_id) AS buyers,
         SUM(o.amount) AS revenue
  FROM orders o
  JOIN users u ON u.id = o.user_id
  WHERE o.status = 'paid'
  GROUP BY COALESCE(u.country, 'unknown')
)
SELECT country, buyers, revenue
FROM country_rev
WHERE revenue > (SELECT AVG(revenue) FROM country_rev)
ORDER BY revenue DESC`,
        hints: ['Step 1: one row per country. Step 2: the average of step 1.', 'You can reference the same CTE in FROM and in a scalar subquery.'],
        explanation: 'The CTE is referenced twice (FROM and the scalar subquery), so it is computed once. Six countries average 655.83; only AE (1680) and US (1205) beat it. Doing it without a CTE means writing the aggregate twice — and keeping both copies in sync forever.',
      },
      {
        id: 'cb-aov-by-plan',
        kind: 'fix-bug',
        title: 'Average order value per plan',
        difficulty: 'Medium',
        prompt: 'Return `plan` and `aov` = average value of a **paid order** placed by users on that plan (2 decimals), ordered by plan. The query below reports pro AOV as 373.33. Fix it.',
        starter: `WITH per_user AS (
  SELECT user_id, AVG(amount) AS avg_order
  FROM orders
  WHERE status = 'paid' AND user_id IS NOT NULL
  GROUP BY user_id
)
SELECT u.plan, ROUND(AVG(p.avg_order), 2) AS aov
FROM per_user p
JOIN users u ON u.id = p.user_id
GROUP BY u.plan
ORDER BY u.plan`,
        solution: `WITH per_user AS (
  SELECT user_id, COUNT(*) AS orders, SUM(amount) AS revenue
  FROM orders
  WHERE status = 'paid' AND user_id IS NOT NULL
  GROUP BY user_id
)
SELECT u.plan, ROUND(SUM(p.revenue) / SUM(p.orders), 2) AS aov
FROM per_user p
JOIN users u ON u.id = p.user_id
GROUP BY u.plan
ORDER BY u.plan`,
        hints: ['Asha has 3 paid orders, Dana 2. Should they weigh the same in the plan’s average?', 'Carry SUM and COUNT through the step and divide at the end.'],
        explanation: 'The starter averages per-user averages: Asha (166.67 over 3 orders) and Dana (580 over 2) weigh equally → 373.33. The order-weighted AOV is 1660 / 5 = 332. Chained steps should pass additive measures forward; ratios are computed last.',
      },
      {
        id: 'cb-repeat-rate',
        kind: 'write',
        title: 'Repeat-buyer rate',
        difficulty: 'Easy',
        prompt: 'Among registered users with at least one paid order, return a single row: `buyers`, `repeat_buyers` (2+ paid orders) and `repeat_pct` (percentage, 1 decimal).',
        solution: `WITH buyers AS (
  SELECT user_id, COUNT(*) AS paid_orders
  FROM orders
  WHERE status = 'paid' AND user_id IS NOT NULL
  GROUP BY user_id
)
SELECT COUNT(*) AS buyers,
       COUNT(*) FILTER (WHERE paid_orders >= 2) AS repeat_buyers,
       ROUND(100.0 * COUNT(*) FILTER (WHERE paid_orders >= 2) / COUNT(*), 1) AS repeat_pct
FROM buyers`,
        hints: ['Step 1 at user grain: paid orders per user.', 'Step 2: count users, and count users with FILTER (WHERE paid_orders >= 2).'],
        explanation: '7 buyers, 3 repeat (Asha, Dana, Fatima) → 42.9%. The CTE fixes the grain to “one row per buyer” so the outer COUNT(*) counts people, not orders. Use `100.0` to avoid integer division.',
      },
    ],
    judgment: [
      {
        id: 'cb-dml-snapshot',
        kind: 'peer-review',
        title: 'PR: “cancel stale pending orders + post the status breakdown”',
        context: 'Nightly job PR. It cancels every pending order and, in the same statement, returns the status breakdown that gets posted to Slack. QA says the Slack message still shows 2 pending orders after the run.',
        sql: `WITH cancelled AS (
  UPDATE orders SET status = 'cancelled'
  WHERE status = 'pending'
  RETURNING id
)
SELECT status, COUNT(*) AS orders
FROM orders
GROUP BY status
ORDER BY status`,
        bugLines: [7],
        options: [
          {
            text: 'The main SELECT reads `orders` with the statement’s snapshot, taken before the UPDATE — it never sees the CTE’s changes. Use the RETURNING rows.',
            correct: true,
            why: 'All sub-statements of one statement share a snapshot. The UPDATE did run (data-modifying CTEs always execute), but the report reads pre-update rows.',
          },
          { text: 'The UPDATE never runs because `cancelled` is not referenced in the main query.', why: 'Data-modifying CTEs always run to completion exactly once, referenced or not.' },
          { text: 'It needs `AS MATERIALIZED` to execute the UPDATE first.', why: 'Data-modifying CTEs are already materialized; ordering is not the issue — visibility is.' },
          { text: 'GROUP BY status should be GROUP BY 1.', why: 'Same grouping; cosmetic.' },
        ],
        fixedSql: `WITH cancelled AS (
  UPDATE orders SET status = 'cancelled'
  WHERE status = 'pending'
  RETURNING id
)
SELECT CASE WHEN c.id IS NOT NULL THEN 'cancelled' ELSE o.status END AS status,
       COUNT(*) AS orders
FROM orders o
LEFT JOIN cancelled c ON c.id = o.id
GROUP BY 1
ORDER BY 1`,
        lesson: 'In a data-modifying CTE, the only way to “see” what changed inside the same statement is its RETURNING output. Everything else reads the snapshot from before the statement started.',
      },
      {
        id: 'cb-materialized-fence',
        kind: 'slow-query',
        title: 'Customer-profile endpoint got slow',
        context: 'The `/customers/:id/summary` API runs this for one user. Someone added `MATERIALIZED` “so the CTE is only computed once”. p95 went from 2 ms to 60 ms. An index on big_orders(user_id) exists.',
        setup: 'CREATE INDEX bo_user ON big_orders (user_id); ANALYZE big_orders;',
        sql: `WITH user_totals AS MATERIALIZED (
  SELECT user_id, COUNT(*) AS orders, SUM(amount) AS revenue
  FROM big_orders
  GROUP BY user_id
)
SELECT user_id, orders, revenue
FROM user_totals
WHERE user_id = 4242`,
        bugLines: [1],
        options: [
          {
            text: 'MATERIALIZED is a fence: all 200k orders are aggregated for 20k users before `user_id = 4242` is applied to the CTE Scan. Without it, Postgres inlines the CTE and pushes the filter down to the index.',
            correct: true,
            why: 'Materialized: Seq Scan + HashAggregate over the whole table. Inlined: Bitmap Index Scan on bo_user for ~15 rows, then a tiny aggregate.',
          },
          { text: 'The index on user_id is not used because of GROUP BY.', why: 'It is used as soon as the predicate can reach the scan — the fence is what stops it.' },
          { text: 'COUNT(*) forces a full scan; use COUNT(user_id).', why: 'Both count the same rows; the cost is in what gets scanned, not how it is counted.' },
          { text: 'The CTE should be replaced with a temp table.', why: 'That still aggregates the whole table; the fix is to let the filter reach the scan.' },
        ],
        fixedSql: `WITH user_totals AS (
  SELECT user_id, COUNT(*) AS orders, SUM(amount) AS revenue
  FROM big_orders
  GROUP BY user_id
)
SELECT user_id, orders, revenue
FROM user_totals
WHERE user_id = 4242`,
        comparePlans: true,
        lesson: '“Computed once” is only a win when the result is reused. For a single, filtered reference, inlining lets predicate pushdown turn a full aggregation into an index lookup.',
      },
    ],
    recall: [
      { q: 'When does Postgres 12+ inline a CTE, and when does it materialize it?', a: 'Inline: non-recursive, no side effects, no volatile functions, referenced exactly once. Materialize: referenced 2+ times, recursive, data-modifying, or `AS MATERIALIZED`.' },
      { q: 'What does `AS NOT MATERIALIZED` do?', a: 'Forces inlining even for a multi-reference CTE: work may be duplicated, but each reference gets predicate pushdown / index use.' },
      { q: 'Can the main query see rows changed by an `UPDATE` inside a CTE?', a: 'No — all sub-statements share the pre-statement snapshot. Use the CTE’s RETURNING rows.' },
      { q: 'CTE vs temp table — when do you pick the temp table?', a: 'When the intermediate is large and reused across several statements, or needs an index / real statistics (ANALYZE) for good plans.' },
    ],
    transfer: [
      {
        id: 'cb-t-sla',
        scenario: 'Support wants every agent whose median ticket resolution time is worse than the team median, with both numbers side by side.',
        approach: 'CTE 1: resolution time per agent (percentile_cont per agent). CTE 2: the team median over all tickets. CROSS JOIN the one-row CTE 2 and filter. Reference CTE 1 again if you also need the rank.',
      },
      {
        id: 'cb-t-archive',
        scenario: 'Move all sessions older than 90 days into sessions_archive and return how many rows were moved per day, atomically.',
        approach: '`WITH moved AS (DELETE FROM sessions WHERE started_at < now() - interval \'90 days\' RETURNING *), ins AS (INSERT INTO sessions_archive SELECT * FROM moved) SELECT started_at::date, COUNT(*) FROM moved GROUP BY 1`. One snapshot, one transaction.',
      },
      {
        id: 'cb-t-dbt',
        scenario: 'A 200-line reporting query with five levels of nested subqueries keeps getting the grain wrong in code review.',
        approach: 'Refactor into named CTE steps, each with a comment stating its grain (one row per user, per user-day…). Check EXPLAIN afterwards: single-reference steps are inlined, so performance is unchanged.',
      },
    ],
    confusable: ['joins-fanout', 'logical-order', 'recursive-hierarchy', 'conditional-aggregation'],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'recursive-hierarchy',
    track: 'ctes',
    title: 'Recursive CTEs: walking a hierarchy',
    tagline: 'An anchor row plus a step that finds “the next level” — Postgres repeats the step on only the newest rows until a level comes back empty.',
    level: 'intermediate',
    minutes: 15,
    interview: 3,
    viz: 'recursive',
    intuition: [
      'A recursive CTE is a loop written as a query: an **anchor** (where to start: the CEO, or one manager) `UNION ALL` a **recursive member** that joins the table to the rows found in the previous step (“everyone whose manager I just found”). It stops when a step finds nobody.',
      'The **direction is the join**. Walking down (reports): `e.manager_id = t.id`. Walking up (chain of command): `e.id = t.manager_id`. Swapping them is the #1 bug — it silently walks the other way.',
      'Carry state from level to level: `depth + 1` for the level, a **path** (`path || e.name` as an array or string) for display order and ancestry, running products for things like bill-of-materials quantities. `ORDER BY path` gives a depth-first, indented org chart; `ORDER BY depth` gives level by level.',
      'Termination is your job. A tree ends naturally at the leaves; bad data with a cycle (A manages B manages A) loops forever. `UNION` instead of `UNION ALL` only removes **identical** rows — once a depth or path column differs, it no longer stops anything. Guard with the path (`WHERE e.id <> ALL(t.path)`) or Postgres 14’s `CYCLE` clause, and treat a depth cap as a smoke alarm, not a fix.',
    ],
    internals: [
      'EXPLAIN shows a **Recursive Union** node with two children: the anchor plan and the recursive plan, which reads a **WorkTable Scan**. Execution: run the anchor, append its rows to the result and to the *working table*. Then loop: run the recursive member against the working table **only** (not everything found so far), append the output to the result, make it the new working table, repeat until it is empty. That is breadth-first, level-by-level (“semi-naive”) evaluation.',
      'With `UNION`, the executor also keeps a hash table of every row emitted so far and discards duplicates before they enter the working table — memory grows with the whole result. Postgres restricts the recursive member: it may reference the CTE only once, and not inside an aggregate, a subquery or the nullable side of an outer join (`aggregate functions are not allowed in a recursive query’s recursive term`).',
      'Each iteration is a join of the working table with `employees`. With an index on `employees(manager_id)` each level becomes a nested loop of index lookups (cost ∝ rows found); without it, every iteration scans the table. The planner cannot know how deep the recursion goes and guesses the CTE’s size (for this 12-person org EXPLAIN estimates 111 rows), so estimates above a recursive CTE are often far off — check `EXPLAIN ANALYZE` before trusting the join choice on top.',
      'For read-heavy hierarchies, teams precompute instead: a **closure table** (every ancestor–descendant pair, like the `tree` CTE in the builder), a **materialized path** (`ltree` extension, `\'1.2.4\'` with GiST indexes), or nested sets. A recursive CTE is the right default for thousands of rows and changing data.',
    ],
    signals: [
      'all reports under a manager, at any level',
      'chain of command / all ancestors of X',
      'category tree, folder tree, bill of materials',
      'depth or level in a hierarchy',
      'referral chains (who referred whom, transitively)',
    ],
    template: `WITH RECURSIVE org AS (
  SELECT id, name, 0 AS depth, ARRAY[id] AS path   -- anchor: where to start
  FROM employees
  WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, e.name, o.depth + 1, o.path || e.id  -- step: next level down
  FROM employees e
  JOIN org o ON e.manager_id = o.id                 -- direction lives here
  WHERE e.id <> ALL (o.path)                        -- cycle guard
)
SELECT * FROM org ORDER BY path;`,
    realWorld: [
      {
        title: 'Permissions that inherit',
        body: 'RBAC with role → parent role, or folders with inherited ACLs: “can user X read doc Y?” walks up the folder tree until an ACL matches. A cycle in role inheritance (from an admin UI bug) must not take the auth service down — guard the recursion.',
      },
      {
        title: 'Category trees in e-commerce',
        body: '“All products under Electronics” must include Laptops → Gaming Laptops. A recursive CTE expands the category subtree, then a join pulls products. Large catalogs often precompute a closure table nightly and serve reads from it.',
      },
      {
        title: 'Bill of materials explosion',
        body: 'A bike needs 2 wheels, each wheel 32 spokes: carry `qty * parent_qty` down the recursion to get total spokes per bike. The same pattern computes total headcount or payroll under each manager.',
      },
    ],
    mistakes: [
      {
        title: 'Joining in the wrong direction',
        why: '`e.id = t.manager_id` walks up to the boss when you wanted the reports (or vice versa). It still runs and returns plausible rows.',
        fix: 'Say it out loud: “find rows whose manager is a row I already have” → `e.manager_id = t.id`.',
      },
      {
        title: 'Filtering inside the recursive member',
        why: 'A row rejected there is never expanded, so its whole subtree disappears — not just that row.',
        fix: 'Walk the full tree, then filter in the outer query. Filter inside only when pruning whole branches is the intent.',
      },
      {
        title: 'A depth cap as the only termination',
        why: '`WHERE depth < 5` stops cycles, but also silently truncates a legitimately deeper tree — wrong answers without an error.',
        fix: 'Use a path-based cycle guard (or `CYCLE`) for correctness; keep a generous cap only as a safety net and alert when it is hit.',
      },
      {
        title: 'Believing UNION prevents infinite loops',
        why: 'UNION removes only exact duplicate rows. With depth or path columns every lap around the cycle is a new row.',
        fix: 'Guard explicitly with the visited path.',
      },
    ],
    worked: {
      question: 'HR wants the full org chart: every employee, indented under their manager, with their chain of command.',
      sql: `WITH RECURSIVE org AS (
  SELECT id, name, manager_id, 0 AS depth, ARRAY[name] AS path
  FROM employees
  WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, e.name, e.manager_id, o.depth + 1, o.path || e.name
  FROM employees e
  JOIN org o ON e.manager_id = o.id
)
SELECT repeat('    ', depth) || name AS org_chart,
       depth,
       array_to_string(path, ' > ') AS chain
FROM org
ORDER BY path`,
      recursiveLevel: 'depth',
      notes: {
        cte: 'Iteration by iteration: the anchor finds Maya (depth 0). Run 1 of the recursive member joins employees to {Maya} → Noah, Olga. Run 2 joins to {Noah, Olga} only → 6 people. Run 3 → Sara, Tom, Xia. Run 4 finds nobody whose manager is Sara, Tom or Xia, so the loop ends. The recursive member never re-reads Maya: it only sees the previous level (the WorkTable).',
        select: '`repeat(\'    \', depth)` turns depth into indentation; `array_to_string(path, \' > \')` renders the ancestry. The path array is the real workhorse: it is the sort key and, if you store ids, the cycle guard.',
        order: 'Arrays compare element by element, so ORDER BY path puts every subtree right under its root (depth-first) with siblings alphabetical. ORDER BY depth would print level by level instead.',
      },
      predictions: [
        {
          stage: 'cte',
          kind: 'rowcount',
          question: 'The company has 12 employees and one CEO. How many rows will `org` contain?',
          explain: '12 — every employee is reachable from Maya exactly once (a tree has one path to each node): 1 + 2 + 6 + 3 across four levels.',
        },
        {
          stage: 'order',
          kind: 'choice',
          question: 'After sorting by path, which row comes immediately after Tom (Maya > Noah > Priya > Tom)?',
          options: ['Olga', 'Quinn', 'Sara', 'Uma'],
          answer: 1,
          explain: 'Priya’s subtree (Sara, Tom) is finished, so the next path is Maya > Noah > Quinn. Olga comes only after all of Noah’s subtree.',
        },
      ],
      takeaway: 'Anchor + one-level step; the join decides direction, the path decides order and protects against cycles, and the loop ends when a level is empty.',
    },
    build: {
      prompt: 'The given `tree` CTE pairs every employee (`root_id`) with everyone in their org, including themselves at depth 0. For each manager, return `name`, `reports` (direct + indirect), `team_payroll` (salaries of those reports) and `levels_below` (max depth). Largest org first, then name.',
      given: `tree AS (
  SELECT id AS root_id, id, 0 AS depth
  FROM employees
  UNION ALL
  SELECT t.root_id, e.id, t.depth + 1
  FROM tree t
  JOIN employees e ON e.manager_id = t.id
)`,
      recursive: true,
      blocks: [
        { slot: 'select', sql: 'm.name', why: 'The manager (the root of each subtree).' },
        { slot: 'select', sql: 'COUNT(*) AS reports', why: 'After excluding depth 0, each tree row is one report somewhere below the manager.' },
        { slot: 'select', sql: 'SUM(e.salary) AS team_payroll', why: 'Salary of the report (e), not of the manager (m).' },
        { slot: 'select', sql: 'MAX(t.depth) AS levels_below', why: 'How deep the org goes under this manager.' },
        { slot: 'from', sql: 'tree t', why: 'One row per (manager, member-of-their-org) pair — a closure table built on the fly.' },
        { slot: 'join', sql: 'JOIN employees m ON m.id = t.root_id', why: 'Look up the manager’s name.' },
        { slot: 'join', sql: 'JOIN employees e ON e.id = t.id', why: 'Look up the report’s salary.' },
        { slot: 'where', sql: 't.depth > 0', why: 'Depth 0 is the person themself — not a report. This also drops ICs, who only have their depth-0 row.' },
        { slot: 'groupBy', sql: 'm.id', why: 'Group by the key…' },
        { slot: 'groupBy', sql: 'm.name', why: '…and the name so it can be selected.' },
        { slot: 'orderBy', sql: 'reports DESC', why: 'Largest org first.' },
        { slot: 'orderBy', sql: 'm.name', why: 'Deterministic tie-break.' },
      ],
      traps: [
        {
          slot: 'where',
          sql: 't.depth >= 0',
          replaces: 't.depth > 0',
          why: 'Includes everyone as their own report: every count is +1, payroll includes the manager, and all 7 ICs show up with 1 “report”.',
        },
        {
          slot: 'where',
          sql: 't.depth = 1',
          replaces: 't.depth > 0',
          why: 'Only direct reports: Maya would have 2 instead of 11 — this is what a plain self-join gives you, not the whole org.',
        },
        {
          slot: 'join',
          sql: 'JOIN employees e ON e.manager_id = t.id',
          replaces: 'JOIN employees e ON e.id = t.id',
          why: 'That joins the reports *of* each tree member — one level too deep — so counts and payroll shift down a level.',
        },
        {
          slot: 'groupBy',
          sql: 't.depth',
          why: 'Grouping by depth splits each manager into one row per level; the totals are no longer per manager.',
        },
      ],
    },
    exercises: [
      {
        id: 'rh-chain-up',
        kind: 'write',
        title: 'Chain of command',
        difficulty: 'Easy',
        prompt: 'Return Xia’s chain of command upward: `name` and `depth` (0 for Xia, 1 for her manager, …), ordered by depth.',
        solution: `WITH RECURSIVE up AS (
  SELECT id, name, manager_id, 0 AS depth
  FROM employees
  WHERE name = 'Xia'
  UNION ALL
  SELECT m.id, m.name, m.manager_id, u.depth + 1
  FROM employees m
  JOIN up u ON m.id = u.manager_id
)
SELECT name, depth
FROM up
ORDER BY depth`,
        hints: ['Anchor: Xia. Step: “the employee whose id is my manager_id”.', 'It stops at Maya because her manager_id is NULL — the join finds nothing.'],
        explanation: 'Walking up, each level has at most one row, so it ends at the root: Xia → Uma → Olga → Maya. The only difference from walking down is the join direction.',
      },
      {
        id: 'rh-noah-team',
        kind: 'fix-bug',
        title: 'Everyone under Noah',
        difficulty: 'Medium',
        prompt: 'List everyone in Noah’s org (direct and indirect reports, not Noah himself): `name`, `depth` (1 = direct report), ordered by depth then name. The query below returns only Maya.',
        starter: `WITH RECURSIVE team AS (
  SELECT id, name, manager_id, 0 AS depth
  FROM employees
  WHERE id = 2
  UNION ALL
  SELECT e.id, e.name, e.manager_id, t.depth + 1
  FROM employees e
  JOIN team t ON e.id = t.manager_id
)
SELECT name, depth
FROM team
WHERE depth > 0
ORDER BY depth, name`,
        solution: `WITH RECURSIVE team AS (
  SELECT id, name, manager_id, 0 AS depth
  FROM employees
  WHERE id = 2
  UNION ALL
  SELECT e.id, e.name, e.manager_id, t.depth + 1
  FROM employees e
  JOIN team t ON e.manager_id = t.id
)
SELECT name, depth
FROM team
WHERE depth > 0
ORDER BY depth, name`,
        hints: ['Which direction does `e.id = t.manager_id` walk?', 'You want employees whose manager is someone already in the team.'],
        explanation: 'The starter walks **up** from Noah and finds his boss Maya. Flipping the join to `e.manager_id = t.id` walks down: Priya, Quinn, Ravi (1), Sara, Tom (2).',
      },
      {
        id: 'rh-cycle-guard',
        kind: 'write',
        title: 'Survive a cycle',
        difficulty: 'Hard',
        prompt: 'A bad HR import set Maya’s manager to Tom (the setup applies it), so the chain of command now loops. Walk **up** from Sara and return `name` and `steps_up` (0 for Sara) for every person reached, stopping before anyone repeats. Order by steps_up. (Add the guard before you run it — an unguarded version never ends.)',
        setup: 'UPDATE employees SET manager_id = 8 WHERE id = 1;',
        solution: `WITH RECURSIVE up AS (
  SELECT id, name, manager_id, ARRAY[id] AS seen
  FROM employees
  WHERE name = 'Sara'
  UNION ALL
  SELECT e.id, e.name, e.manager_id, u.seen || e.id
  FROM employees e
  JOIN up u ON e.id = u.manager_id
  WHERE e.id <> ALL (u.seen)
)
SELECT name, cardinality(seen) - 1 AS steps_up
FROM up
ORDER BY steps_up`,
        hints: ['Carry an array of visited ids.', '`WHERE e.id <> ALL (u.seen)` refuses to step onto someone already visited.', 'The Postgres 14 alternative: `) CYCLE id SET is_cycle USING path` after the CTE body, then filter `NOT is_cycle`.'],
        explanation: 'Sara → Priya → Noah → Maya → Tom, and Tom’s manager Priya is already in `seen`, so the step returns nothing and the loop ends. `UNION` would not help: `seen` makes every lap a different row. The `CYCLE` clause does the same bookkeeping for you but still emits the cycle-closing row (Priya again) with `is_cycle = true`.',
      },
    ],
    judgment: [
      {
        id: 'rh-depth-cap',
        kind: 'peer-review',
        title: 'PR: “add a safety limit to the org-tree query”',
        context: 'After an incident where bad data made a recursive query spin forever, a teammate added a depth limit to the org chart used by the HR directory. Tests pass on a 3-level fixture.',
        sql: `WITH RECURSIVE org AS (
  SELECT id, name, 0 AS depth, ARRAY[id] AS path
  FROM employees
  WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, e.name, o.depth + 1, o.path || e.id
  FROM employees e
  JOIN org o ON e.manager_id = o.id
  WHERE o.depth < 2
)
SELECT name, depth
FROM org
ORDER BY depth, name`,
        bugLines: [9],
        options: [
          {
            text: 'The cap silently truncates the real org: depth-3 people (Sara, Tom, Xia) disappear. Guard cycles with the path array instead.',
            correct: true,
            why: 'The org is 4 levels deep. The path is already carried, so `e.id <> ALL (o.path)` stops cycles without cutting legitimate depth.',
          },
          { text: 'It should use UNION to stop infinite loops.', why: 'UNION only drops identical rows; depth and path differ on every lap, so it would not stop a cycle.' },
          { text: 'The anchor should start from all employees.', why: 'Then every subtree is repeated under every root — a different query (a closure table).' },
          { text: '`o.depth < 2` should be in the outer WHERE.', why: 'In the outer query it no longer protects against runaway recursion; it is still a truncation.' },
        ],
        fixedSql: `WITH RECURSIVE org AS (
  SELECT id, name, 0 AS depth, ARRAY[id] AS path
  FROM employees
  WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, e.name, o.depth + 1, o.path || e.id
  FROM employees e
  JOIN org o ON e.manager_id = o.id
  WHERE e.id <> ALL (o.path)
)
SELECT name, depth
FROM org
ORDER BY depth, name`,
        lesson: 'A depth cap turns an infinite loop into a wrong answer. Cycle detection on the visited path is the correct termination; a generous cap is only an alarm.',
      },
      {
        id: 'rh-prune-filter',
        kind: 'spot-bug',
        title: 'Recent hires in Noah’s org',
        context: 'Engineering wants everyone in Noah’s org hired since 2020 for an onboarding survey. The query returns only Ravi, but the team lead is sure Sara and Tom joined in 2021.',
        sql: `WITH RECURSIVE team AS (
  SELECT id, name, hired_at, 0 AS depth
  FROM employees
  WHERE name = 'Noah'
  UNION ALL
  SELECT e.id, e.name, e.hired_at, t.depth + 1
  FROM employees e
  JOIN team t ON e.manager_id = t.id
  WHERE e.hired_at >= date '2020-01-01'
)
SELECT name, hired_at, depth
FROM team
WHERE depth > 0
ORDER BY hired_at`,
        bugLines: [9],
        options: [
          {
            text: 'The date filter inside the recursive member prunes whole subtrees: Priya (hired 2018) is rejected, so her reports Sara and Tom are never reached.',
            correct: true,
            why: 'A row rejected in the recursive step is never expanded. Walk the full tree, then filter in the outer query.',
          },
          { text: 'The join should be `e.id = t.manager_id`.', why: 'That would walk up to Maya — the direction is correct here.' },
          { text: '`depth > 0` removes the new hires.', why: 'It only removes Noah himself (depth 0).' },
          { text: 'The date literal is compared as text.', why: '`date \'2020-01-01\'` is a typed date; the comparison is correct.' },
        ],
        fixedSql: `WITH RECURSIVE team AS (
  SELECT id, name, hired_at, 0 AS depth
  FROM employees
  WHERE name = 'Noah'
  UNION ALL
  SELECT e.id, e.name, e.hired_at, t.depth + 1
  FROM employees e
  JOIN team t ON e.manager_id = t.id
)
SELECT name, hired_at, depth
FROM team
WHERE depth > 0
  AND hired_at >= date '2020-01-01'
ORDER BY hired_at`,
        lesson: 'Filters in the recursive member decide what gets *expanded*; filters outside decide what gets *returned*. Mixing them up silently drops entire branches.',
      },
    ],
    recall: [
      { q: 'What are the two parts of a recursive CTE and how does Postgres evaluate them?', a: 'Anchor (runs once) and recursive member; Recursive Union reruns the member on only the previous iteration’s rows (the WorkTable) until it returns nothing.' },
      { q: 'Join condition to walk DOWN an employees(manager_id) tree vs UP?', a: 'Down: `e.manager_id = t.id`. Up: `e.id = t.manager_id`.' },
      { q: 'Why doesn’t UNION (instead of UNION ALL) protect you from cycles when you carry depth or path?', a: 'UNION only drops exact duplicate rows; depth/path change every lap, so rows are never duplicates.' },
      { q: 'How do you print an org chart depth-first with siblings sorted?', a: 'Carry a path array (`path || name`) and ORDER BY path; indent with `repeat(\' \', depth)`.' },
    ],
    transfer: [
      {
        id: 'rh-t-categories',
        scenario: 'A marketplace has categories(id, parent_id, name) and products(category_id). Product search needs “all products in Home & Garden, including every subcategory”.',
        approach: 'Recursive CTE from the Home & Garden id walking down `c.parent_id = t.id`, then JOIN products ON category_id IN the subtree. If it is hot, precompute a closure table.',
      },
      {
        id: 'rh-t-bom',
        scenario: 'Manufacturing: parts(parent_part, child_part, qty). How many screws are needed to build 10 desks?',
        approach: 'Recursive CTE from the desk with `total_qty = parent.total_qty * child.qty` carried down; SUM total_qty where child is the screw; multiply by 10.',
      },
      {
        id: 'rh-t-referrals',
        scenario: 'Growth wants, for each user, how many people they brought in directly or indirectly through the referral program (users.referred_by).',
        approach: 'Closure-table pattern: anchor every user as their own root, step `u.referred_by = t.id`; GROUP BY root, COUNT(*) − 1, with a path guard in case of bad data.',
      },
    ],
    confusable: ['self-joins', 'recursive-graph-dates', 'cte-basics'],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'recursive-graph-dates',
    track: 'ctes',
    title: 'Graph walks & date spines',
    tagline: 'Recursion over a graph enumerates paths (so guard cycles and aggregate at the end); a generated calendar turns “no rows” into explicit zeros.',
    level: 'advanced',
    minutes: 15,
    interview: 2,
    viz: 'recursive',
    intuition: [
      'A graph walk is the hierarchy loop with two complications: a node can be reached by **many paths**, and edges can form **cycles** (SFO → SEA → SFO). So carry the path and refuse to revisit: `WHERE r.dst <> ALL (t.path)`. Postgres 14 also offers `CYCLE dst SET is_cycle USING path` to do that bookkeeping for you.',
      'Each row of a recursive graph CTE is a **path**, not a node. That is great for “shortest hops” (aggregate `MIN(hops)` per destination at the end) and “list the routes”, but path counts can explode exponentially on dense graphs. If you only need reachability, recurse on the node alone with `UNION`: then the deduplication *is* the visited set and the walk is polynomial.',
      'Breadth-first evaluation means the first iteration that reaches a node gives its **fewest hops** — but hop count does not pick the itinerary. BOS has three different 3-hop routes (415, 455 and 485 min), and on other networks a 4-hop route can beat a 2-hop one. For weighted “shortest” you compare the candidate paths’ totals (or use Dijkstra in a graph engine at scale).',
      'The other recursive classic is the **date spine**. `GROUP BY day` only creates groups for days that have data, so a chart silently skips zero days and a 7-day moving average averages the wrong days. Generate every day first — `generate_series` or a recursive `day + 1` CTE — then `LEFT JOIN` the facts onto it and count a fact column so empty days read 0.',
    ],
    internals: [
      'Graph walks run on the same **Recursive Union / WorkTable Scan** machinery: the working table is the current frontier of paths. The array guard costs O(path length) per candidate row and `path || dst` copies the array on every step, which is fine for short paths but not for million-edge graphs (that is pgRouting / a graph database / application-side BFS territory).',
      'The `CYCLE` clause (PG 14) adds an `is_cycle` flag and a path column of row values; it still **emits** the row that closes a cycle (with `is_cycle = true`) and stops extending it, so filter `WHERE NOT is_cycle`. `SEARCH BREADTH FIRST BY …` / `SEARCH DEPTH FIRST BY …` add an ordering column for you.',
      '`generate_series(start, stop, step)` is a set-returning function executed by a **Function Scan** node that streams values with no table access; with constant arguments the planner knows the row count. With `date` arguments it resolves to the timestamp version, so cast back with `::date`. A recursive date CTE works everywhere (and is what you write in engines without generate_series), but the planner has to guess its size.',
      'How you join facts to the spine decides the plan. `o.ordered_at >= d.day AND o.ordered_at < d.day + interval \'1 day\'` is **sargable**: a Nested Loop can do one index range scan per day. `o.ordered_at::date = d.day` wraps the indexed column in a cast, so Postgres must read and sort/hash the entire fact table. Warehouses use `GENERATE_DATE_ARRAY` + `UNNEST` (BigQuery), `GENERATOR` (Snowflake), or simply a permanent `dim_date` table.',
    ],
    signals: [
      'can I get from A to B / everything reachable from X',
      'fewest hops / degrees of separation',
      'detect cycles in dependencies',
      'show every day, even days with zero',
      'fill missing dates in a time series / continuous calendar',
    ],
    template: `-- graph: reachable nodes with fewest hops
WITH RECURSIVE walk AS (
  SELECT dst, 1 AS hops, ARRAY[src, dst] AS path
  FROM routes WHERE src = 'SFO'
  UNION ALL
  SELECT r.dst, w.hops + 1, w.path || r.dst
  FROM walk w JOIN routes r ON r.src = w.dst
  WHERE r.dst <> ALL (w.path)            -- never revisit
)
SELECT dst, MIN(hops) FROM walk GROUP BY dst;

-- date spine: one row per day, zeros included
SELECT d.day::date, COUNT(o.id) AS orders
FROM generate_series(date '2024-03-01', date '2024-03-31', interval '1 day') AS d(day)
LEFT JOIN orders o
  ON o.ordered_at >= d.day AND o.ordered_at < d.day + interval '1 day'
GROUP BY d.day ORDER BY d.day;`,
    realWorld: [
      {
        title: 'Dependency graphs in schedulers',
        body: 'Airflow and dbt refuse to run a DAG with a cycle. If task dependencies live in a table, a recursive CTE with a path guard both computes “everything downstream of this failed task” (what to re-run) and detects cycles (the guard fires) before deploy.',
      },
      {
        title: 'Fraud rings and degrees of separation',
        body: 'Accounts that share devices, cards or addresses form a graph. “Everything within 3 hops of this chargeback account” is a bounded graph walk; at production scale it moves to a graph store, but the SQL version is the investigation tool.',
      },
      {
        title: 'Dashboards that skip zero days',
        body: 'A line chart of daily signups connects Monday straight to Thursday when Tue/Wed had no rows, and a 7-row moving average spans 10 days. Every serious metrics layer joins facts onto a calendar (generate_series or a dim_date table) first.',
      },
    ],
    mistakes: [
      {
        title: 'Only a hop limit on a cyclic graph',
        why: 'The walk bounces SFO → SEA → SFO … until the cap, generating duplicate paths and even “reaching” the origin itself.',
        fix: 'Carry the path and exclude visited nodes (or use `CYCLE`); keep a hop limit only for business reasons (“max 2 layovers”).',
      },
      {
        title: 'Filtering facts in WHERE after the spine LEFT JOIN',
        why: '`WHERE o.status = \'paid\'` is NULL for empty days, so those rows vanish — exactly the days you generated the spine for.',
        fix: 'Put fact filters in the ON clause (or pre-filter the facts in a CTE).',
      },
      {
        title: '`COUNT(*)` on a zero-filled spine',
        why: 'An empty day still has its one NULL-extended row, so COUNT(*) says 1.',
        fix: 'Count a column from the fact side (`COUNT(o.id)`) and `COALESCE(SUM(…), 0)`.',
      },
      {
        title: 'Casting the indexed timestamp to match the spine',
        why: '`o.created_at::date = d.day` prevents index range scans and forces a full scan + sort/hash of the fact table.',
        fix: 'Join on a half-open range: `>= d.day AND < d.day + interval \'1 day\'`.',
      },
    ],
    worked: {
      question: 'Ops wants every airport reachable from SFO: the fewest hops, the fastest total flight time, and how many distinct routes exist.',
      sql: `WITH RECURSIVE trips AS (
  SELECT src AS origin, dst, 1 AS hops, minutes AS total_minutes, ARRAY[src, dst] AS path
  FROM routes
  WHERE src = 'SFO'
  UNION ALL
  SELECT t.origin, r.dst, t.hops + 1, t.total_minutes + r.minutes, t.path || r.dst
  FROM trips t
  JOIN routes r ON r.src = t.dst
  WHERE r.dst <> ALL (t.path)
)
SELECT dst,
       MIN(hops) AS fewest_hops,
       MIN(total_minutes) AS fastest_minutes,
       COUNT(*) AS paths
FROM trips
GROUP BY dst
ORDER BY fewest_hops, fastest_minutes`,
      recursiveLevel: 'hops',
      notes: {
        cte: 'Anchor: the 2 direct flights (SEA, DEN). Iteration 2 extends both: SEA → ORD, DEN → ORD, DEN → JFK — and SEA → SFO is **rejected** by the path guard because SFO is already in the path. Iteration 3 adds 5 paths, iteration 4 adds 2 (both end at BOS), and BOS has no outgoing flights, so iteration 5 is empty. Note ORD appears twice at hop 2: rows are paths, not airports.',
        group: 'Grouping by destination turns paths into answers. MIN(hops) and MIN(total_minutes) are independent: for JFK the 2-hop path (380 min) is also fastest, but for BOS the fastest route is a 3-hop one — the minimums may come from different paths.',
        order: 'SFO itself is absent: the guard never lets a path return to its origin. Without the guard, SEA → SFO → SEA … would loop until memory or a hop cap stopped it.',
      },
      predictions: [
        {
          stage: 'cte',
          kind: 'rowcount',
          question: 'Each row of `trips` is one cycle-free path starting at SFO. How many rows does it hold?',
          explain: '12 paths: 2 at hop 1, 3 at hop 2, 5 at hop 3 and 2 at hop 4. Only 5 distinct airports are reachable — path enumeration grows much faster than the node count.',
        },
        {
          stage: 'group',
          kind: 'choice',
          question: 'How many distinct cycle-free routes go from SFO to BOS?',
          options: ['1', '3', '5', '12'],
          answer: 2,
          explain: 'Five: via DEN-ORD (415), DEN-JFK (455), SEA-ORD (485), DEN-ORD-JFK (495) and SEA-ORD-JFK (565). The fastest is a 3-hop route; fewer hops (3) and fewer minutes happen to agree here, but the 4-hop routes are never fastest.',
        },
      ],
      takeaway: 'Recursive graph CTEs enumerate paths: carry the path to stop cycles, aggregate per node at the end, and remember path counts can explode.',
    },
    build: {
      prompt: 'Ops dashboard: daily active users for **1–21 March 2024**, one row per day including days with no logins. Return `day`, `active_users` (distinct users) and `logins` (login rows). The calendar CTE `days` is given.',
      given: `days AS (
  SELECT date '2024-03-01' AS day
  UNION ALL
  SELECT day + 1
  FROM days
  WHERE day < date '2024-03-21'
)`,
      recursive: true,
      blocks: [
        { slot: 'select', sql: 'd.day', why: 'The spine supplies the day — never the fact table, which has no row for empty days.' },
        { slot: 'select', sql: 'COUNT(DISTINCT l.user_id) AS active_users', why: 'User 2 logged in twice on 4 March: distinct users ≠ login rows.' },
        { slot: 'select', sql: 'COUNT(l.user_id) AS logins', why: 'Counting a fact column ignores the NULL-extended row of an empty day → 0.' },
        { slot: 'from', sql: 'days d', why: 'Start from the calendar so every day exists before any fact is attached.' },
        { slot: 'join', sql: 'LEFT JOIN logins l ON l.login_date = d.day', why: 'LEFT keeps days without logins (17–21 March).' },
        { slot: 'groupBy', sql: 'd.day', why: 'One row per calendar day.' },
        { slot: 'orderBy', sql: 'd.day', why: 'Charts want chronological order.' },
      ],
      traps: [
        {
          slot: 'join',
          sql: 'JOIN logins l ON l.login_date = d.day',
          replaces: 'LEFT JOIN logins l ON l.login_date = d.day',
          why: 'An inner join drops the 5 empty days — the spine becomes pointless and the chart skips 17–21 March.',
        },
        {
          slot: 'select',
          sql: 'COUNT(*) AS logins',
          replaces: 'COUNT(l.user_id) AS logins',
          why: 'Empty days still have one NULL-extended row, so COUNT(*) reports 1 login on days nobody logged in.',
        },
        {
          slot: 'select',
          sql: 'COUNT(l.user_id) AS active_users',
          replaces: 'COUNT(DISTINCT l.user_id) AS active_users',
          why: 'Counts login rows, not people: 4 March shows 2 active users because user 2 has a duplicate login.',
        },
        {
          slot: 'where',
          sql: "l.login_date >= date '2024-03-01'",
          why: 'A WHERE on the outer-joined table is NULL for empty days and removes them — the LEFT JOIN quietly becomes an inner join.',
        },
      ],
    },
    exercises: [
      {
        id: 'rg-fastest-route',
        kind: 'write',
        title: 'Fastest itinerary SFO → BOS',
        difficulty: 'Medium',
        prompt: 'Return the single fastest route from SFO to BOS: `route` as text like `SFO > DEN > BOS`, `hops` and `total_minutes`.',
        solution: `WITH RECURSIVE trips AS (
  SELECT dst, 1 AS hops, minutes AS total_minutes, ARRAY[src, dst] AS path
  FROM routes
  WHERE src = 'SFO'
  UNION ALL
  SELECT r.dst, t.hops + 1, t.total_minutes + r.minutes, t.path || r.dst
  FROM trips t
  JOIN routes r ON r.src = t.dst
  WHERE r.dst <> ALL (t.path)
)
SELECT array_to_string(path, ' > ') AS route, hops, total_minutes
FROM trips
WHERE dst = 'BOS'
ORDER BY total_minutes
LIMIT 1`,
        hints: ['Carry total_minutes and the path array through the recursion.', 'Filter to BOS at the end and take the minimum by total_minutes.'],
        explanation: 'SFO > DEN > ORD > BOS in 415 minutes. Enumerating all paths and picking the best is exact but exponential in the worst case; for real route planning you would prune (stop extending a path once it is slower than the best known) or use Dijkstra (pgRouting).',
      },
      {
        id: 'rg-march-revenue',
        kind: 'write',
        title: 'Zero-filled daily revenue',
        difficulty: 'Medium',
        prompt: 'For the finance chart, return every day from 1 to 14 March 2024: `day` (date), `orders` (number of **paid** orders placed that day) and `revenue` (their total amount, 0 when none). Order by day. Use `generate_series`.',
        solution: `SELECT d.day::date AS day,
       COUNT(o.id) AS orders,
       COALESCE(SUM(o.amount), 0) AS revenue
FROM generate_series(date '2024-03-01', date '2024-03-14', interval '1 day') AS d(day)
LEFT JOIN orders o
  ON o.ordered_at >= d.day
 AND o.ordered_at < d.day + interval '1 day'
 AND o.status = 'paid'
GROUP BY d.day
ORDER BY d.day`,
        hints: ['orders.ordered_at is a timestamp — match it to a whole day with a half-open range.', 'Keep the status filter in the ON clause.', 'COUNT a fact column and COALESCE the SUM.'],
        explanation: '14 rows, only 4 of them non-zero (2, 5, 6 and 10 March). The half-open range is index-friendly and has no midnight edge cases. The status filter must live in ON: in WHERE it would delete every zero day.',
      },
      {
        id: 'rg-reach-sea',
        kind: 'fix-bug',
        title: 'Reachable from SEA',
        difficulty: 'Hard',
        prompt: 'List every airport reachable from SEA (not SEA itself) with the fewest hops: `dst`, `hops`, ordered by hops then dst. The query below relies on a hop cap, generates 24 paths, and claims SEA is reachable from SEA. Fix it properly.',
        starter: `WITH RECURSIVE reach AS (
  SELECT dst, 1 AS hops
  FROM routes
  WHERE src = 'SEA'
  UNION ALL
  SELECT r.dst, x.hops + 1
  FROM reach x
  JOIN routes r ON r.src = x.dst
  WHERE x.hops < 5
)
SELECT dst, MIN(hops) AS hops
FROM reach
GROUP BY dst
ORDER BY hops, dst`,
        solution: `WITH RECURSIVE reach AS (
  SELECT dst, 1 AS hops, ARRAY[src, dst] AS path
  FROM routes
  WHERE src = 'SEA'
  UNION ALL
  SELECT r.dst, x.hops + 1, x.path || r.dst
  FROM reach x
  JOIN routes r ON r.src = x.dst
  WHERE r.dst <> ALL (x.path)
)
SELECT dst, MIN(hops) AS hops
FROM reach
GROUP BY dst
ORDER BY hops, dst`,
        hints: ['SEA → SFO → SEA is a cycle; the cap lets it run 5 laps.', 'Start the path with both src and dst so the origin is never revisited.'],
        explanation: 'With a path guard the walk visits 5 airports via cycle-free paths only, and the origin can never reappear. The cap “worked” on 9 edges, but on a real network the number of capped paths grows exponentially with the cap. If you only need reachability, `WITH RECURSIVE reach(airport) AS (SELECT \'SEA\' UNION SELECT r.dst FROM reach x JOIN routes r ON r.src = x.airport)` terminates because UNION dedups single-column rows.',
      },
    ],
    judgment: [
      {
        id: 'rg-zero-fill-where',
        kind: 'spot-bug',
        title: 'Zero-filled chart still has gaps',
        context: 'Ticket: “Daily paid revenue chart for early March skips days.” The author already added a generate_series calendar and a LEFT JOIN, yet only 4 days appear.',
        sql: `SELECT d.day::date AS day,
       COUNT(o.id) AS orders,
       COALESCE(SUM(o.amount), 0) AS revenue
FROM generate_series(date '2024-03-01', date '2024-03-14', interval '1 day') AS d(day)
LEFT JOIN orders o ON o.ordered_at::date = d.day
WHERE o.status = 'paid'
GROUP BY d.day
ORDER BY d.day`,
        bugLines: [6],
        options: [
          {
            text: 'The status filter in WHERE is NULL for days without orders, removing them; move it into the ON clause.',
            correct: true,
            why: 'Empty days carry a NULL-extended order row; `NULL = \'paid\'` is not TRUE, so WHERE drops exactly the zero days.',
          },
          { text: 'generate_series returns timestamps, so the join never matches.', why: 'The cast makes them match — 4 days do match. The missing days are removed afterwards.' },
          { text: 'COUNT(o.id) should be COUNT(*).', why: 'COUNT(*) would report 1 on empty days once they are back; COUNT(o.id) is correct.' },
          { text: 'GROUP BY d.day should be GROUP BY 1.', why: 'Equivalent grouping; not the cause.' },
        ],
        fixedSql: `SELECT d.day::date AS day,
       COUNT(o.id) AS orders,
       COALESCE(SUM(o.amount), 0) AS revenue
FROM generate_series(date '2024-03-01', date '2024-03-14', interval '1 day') AS d(day)
LEFT JOIN orders o ON o.ordered_at::date = d.day
 AND o.status = 'paid'
GROUP BY d.day
ORDER BY d.day`,
        lesson: 'A spine only helps if nothing downstream filters on the fact side. Conditions about the facts belong in ON (or in a pre-filtered CTE), never in WHERE.',
      },
      {
        id: 'rg-spine-sargable',
        kind: 'slow-query',
        title: 'Weekly orders widget scans 200k rows',
        context: 'The admin home page shows orders per day for the last week of data. There is an index on big_orders(created_at), yet the widget is the slowest query on the page.',
        setup: 'CREATE INDEX bo_created ON big_orders (created_at); ANALYZE big_orders;',
        sql: `SELECT d.day::date AS day, COUNT(o.id) AS orders
FROM generate_series(date '2024-12-01', date '2024-12-07', interval '1 day') AS d(day)
LEFT JOIN big_orders o ON o.created_at::date = d.day
GROUP BY d.day
ORDER BY d.day`,
        bugLines: [3],
        options: [
          {
            text: 'Casting created_at to date hides the indexed column, so Postgres seq-scans and sorts all 200k orders. Join on a half-open timestamp range instead.',
            correct: true,
            why: 'With `created_at >= d.day AND created_at < d.day + 1 day` the plan becomes a Nested Loop with one Index Scan using bo_created per day.',
          },
          { text: 'generate_series is slow; use a recursive CTE.', why: 'The Function Scan produces 7 rows instantly; the fact-table access is the cost.' },
          { text: 'LEFT JOIN prevents index use; use an inner join.', why: 'Outer joins can use index nested loops; the cast is what blocks it — and an inner join would drop empty days.' },
          { text: 'COUNT(o.id) should be COUNT(*).', why: 'Changes semantics for empty days and not the plan.' },
        ],
        fixedSql: `SELECT d.day::date AS day, COUNT(o.id) AS orders
FROM generate_series(date '2024-12-01', date '2024-12-07', interval '1 day') AS d(day)
LEFT JOIN big_orders o
  ON o.created_at >= d.day
 AND o.created_at < d.day + interval '1 day'
GROUP BY d.day
ORDER BY d.day`,
        comparePlans: true,
        lesson: 'Join a calendar to facts with a sargable half-open range on the raw column: the spine drives a Nested Loop of index range scans instead of a full scan + sort.',
      },
    ],
    recall: [
      { q: 'Why does a recursive graph CTE need a path column, and what is the guard?', a: 'Graphs have cycles and multiple paths; carry visited nodes and require `next <> ALL (path)` (or use the CYCLE clause).' },
      { q: 'When does UNION alone make a graph walk terminate?', a: 'When the recursive rows contain only the node (no depth/path): UNION dedups, acting as the visited set.' },
      { q: 'Two ways to generate a date spine in Postgres?', a: '`generate_series(start, stop, interval \'1 day\')` (cast to date) or a recursive CTE `SELECT day + 1 … WHERE day < end`.' },
      { q: 'Spine LEFT JOIN facts: where do fact filters go, and which COUNT do you use?', a: 'Filters in ON; `COUNT(fact_col)` (not COUNT(*)) and `COALESCE(SUM(…), 0)`.' },
    ],
    transfer: [
      {
        id: 'rg-t-downstream',
        scenario: 'A data platform stores table lineage as edges(upstream, downstream). A source table is corrupted: list every table that must be rebuilt, and fail loudly if the lineage has a cycle.',
        approach: 'Recursive CTE from the source walking `e.upstream = w.node` with a path array; return DISTINCT nodes. Add `CYCLE node SET is_cycle USING path` and raise if any row has is_cycle.',
      },
      {
        id: 'rg-t-hourly',
        scenario: 'An SRE dashboard needs error counts for every hour of the last 48 hours, including quiet hours, for a heatmap.',
        approach: '`generate_series(date_trunc(\'hour\', now()) - interval \'47 hours\', date_trunc(\'hour\', now()), interval \'1 hour\')` LEFT JOIN errors on a half-open hour range; COUNT(e.id).',
      },
      {
        id: 'rg-t-friends',
        scenario: 'A social app wants “people you may know”: users within 2 hops in the friendship graph who are not already friends.',
        approach: 'Bounded recursive walk (hops ≤ 2) over the friendships edge table with a visited path, then anti-join existing friends and the user themself; rank by number of distinct paths (mutual friends).',
      },
    ],
    confusable: ['recursive-hierarchy', 'outer-join-filters', 'gaps-islands', 'self-joins'],
  },
];
