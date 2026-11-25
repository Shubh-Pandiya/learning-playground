import type { Concept } from '../types';

/**
 * Track: Window functions.
 * Every worked example keeps its window functions in the MAIN select so the pipeline's window stage
 * can colour partitions and highlight frames. All numbers quoted in prose were checked on the seed data.
 */
export const windows: Concept[] = [
  {
    id: 'ranking-functions',
    track: 'windows',
    title: 'Ranking: ROW_NUMBER, RANK, DENSE_RANK, NTILE',
    tagline: 'Number rows inside groups without collapsing them — and decide, on purpose, what happens to ties.',
    level: 'core',
    minutes: 14,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      'A window function computes a value **for every row** from a set of related rows (its window), but unlike `GROUP BY` it does not collapse them: 11 rows in, 11 rows out, each with an extra column. `PARTITION BY` says which rows belong together, `ORDER BY` inside `OVER (…)` says in what order the function walks them.',
      'The four ranking functions differ only in how they treat **ties** (peers: rows with an equal ORDER BY key). With salaries 170, 110, 110, 95: `ROW_NUMBER` gives 1, 2, 3, 4 (ties broken arbitrarily), `RANK` gives 1, 2, 2, 4 (ties share, then a gap — “competition ranking”), `DENSE_RANK` gives 1, 2, 2, 3 (no gap — “the 3rd distinct value”). `NTILE(n)` deals rows into n equal-size buckets and ignores ties entirely.',
      'Pick by the business question, not by habit: “exactly one row per group” → `ROW_NUMBER` with a deterministic tie-breaker; “everyone who shares 2nd place” → `RANK`/`DENSE_RANK`; “the N-th highest **distinct** value” → `DENSE_RANK`; “split into quartiles” → `NTILE` (or `CUME_DIST`/`PERCENT_RANK` if ties must stay together).',
      'Ranking is non-deterministic whenever the ORDER BY has ties and you use ROW_NUMBER or NTILE: the same query can return a different winner after a VACUUM, a new index or a parallel plan. Always append a unique column (`id`, `hired_at, id`) when one row must win — reproducible results are a correctness property, not a nicety.',
    ],
    internals: [
      'Postgres evaluates window functions in a **WindowAgg** plan node that sits above the scan/join/aggregate. WindowAgg needs its input **sorted by PARTITION BY keys then ORDER BY keys**; the planner adds a Sort (or uses an index that already delivers that order — that is why `CREATE INDEX ON employees (dept, salary DESC)` can remove the sort).',
      'ROW_NUMBER, RANK and DENSE_RANK are streaming: WindowAgg keeps a counter and compares the current row’s sort key with the previous one (peer detection), so they cost O(1) per row after the sort. NTILE, PERCENT_RANK and CUME_DIST need the **partition size** (and CUME_DIST the end of the peer group), so WindowAgg buffers the partition in a tuplestore (memory, spilling to a temp file beyond `work_mem`).',
      'Several window functions with the **same** `OVER (…)` share one sort and one WindowAgg. Each distinct window spec adds another WindowAgg — and possibly another full sort of the input. Reusing one spec (or a named `WINDOW w AS (…)` clause) is a real optimisation on big tables.',
      'Since Postgres 15, a filter like `WHERE rn <= 3` in an outer query becomes a **Run Condition** on WindowAgg: once ROW_NUMBER passes 3 in a partition the node stops emitting rows for it. The sort of the whole input still has to happen, which is why top-N over a huge table is usually better served by an index (see top-n-per-group).',
    ],
    signals: ['rank / position within each group', 'N-th highest (salary, score, price)', 'ties should share a place', 'split into quartiles / deciles / buckets', 'leaderboard'],
    template: `SELECT dept, name, salary,
       ROW_NUMBER() OVER w AS row_num,   -- 1,2,3,4  (unique; needs a tie-breaker)
       RANK()       OVER w AS rnk,       -- 1,2,2,4  (ties share, then gap)
       DENSE_RANK() OVER w AS dense_rnk, -- 1,2,2,3  (ties share, no gap)
       NTILE(4)     OVER w AS quartile   -- equal-size buckets, ignores ties
FROM employees
WINDOW w AS (PARTITION BY dept ORDER BY salary DESC, id);`,
    realWorld: [
      {
        title: 'Leaderboards and “top sellers” pages',
        body: 'Gaming, sales and creator leaderboards need ties that share a place (`RANK`) and a stable order for display. Product decides 1,2,2,4 vs 1,2,2,3 — ask, because it changes who gets a prize.',
      },
      {
        title: 'Deterministic pipelines',
        body: 'An ETL step that keeps `ROW_NUMBER() = 1` without a unique tie-breaker produces different outputs on re-runs (backfills, Spark retries, Snowflake re-clustering). Diff-based data tests then flap. Always order by something unique.',
      },
      {
        title: 'Segmentation with NTILE vs CUME_DIST',
        body: 'Marketing “top 10% customers” via `NTILE(10)` can put two customers with identical spend into different deciles. `CUME_DIST()`/`PERCENT_RANK()` keep ties together; warehouses (BigQuery, Snowflake) behave the same way.',
      },
    ],
    mistakes: [
      {
        title: 'ROW_NUMBER without a unique tie-breaker',
        why: 'Peers are numbered in whatever order the sort happened to emit them; the “winner” can change between runs.',
        fix: 'Append a unique column: `ORDER BY salary DESC, hired_at, id`.',
      },
      {
        title: 'Using RANK for “N-th highest distinct value”',
        why: 'With 190, 165, 150, 150, 135, RANK skips 4: there is no rank 4, so “4th highest salary” returns nothing.',
        fix: 'Use `DENSE_RANK` when you mean distinct values; `RANK` when positions should be skipped after ties.',
      },
      {
        title: 'Forgetting PARTITION BY',
        why: 'Without it the whole result is one partition: you rank across the company instead of within each department.',
        fix: 'Partition by the “per X” in the question.',
      },
      {
        title: 'Expecting OVER (ORDER BY …) to sort the output',
        why: 'The window ORDER BY only orders rows for the function. The output order is unspecified unless the query has its own ORDER BY.',
        fix: 'Repeat the ordering in the outer `ORDER BY`.',
      },
    ],
    worked: {
      question: 'HR wants salary positions inside each department (Exec excluded): show ROW_NUMBER, RANK, DENSE_RANK and a top/bottom-half split side by side.',
      sql: `SELECT dept, name, salary,
       RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS rnk,
       ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC, hired_at) AS row_num,
       DENSE_RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS dense_rnk,
       NTILE(2) OVER (PARTITION BY dept ORDER BY salary DESC, hired_at) AS half
FROM employees
WHERE dept <> 'Exec'
ORDER BY dept, salary DESC, hired_at`,
      notes: {
        where: 'Filtering happens before ranking: Maya (Exec) never enters a partition, so she cannot take a rank from anyone.',
        window:
          'Two partitions: Engineering (6) and Sales (4). Hover Priya/Quinn (150k) and Vik/Wen (110k): RANK and DENSE_RANK give each pair the same number, ROW_NUMBER needs `hired_at` to decide (Priya, hired 2018, gets 3; Quinn 4). Ravi shows the difference: RANK 5 (a gap after the tie), DENSE_RANK 4. NTILE(2) splits Engineering 3 + 3 — and puts the tied Priya and Quinn in different halves.',
        order: 'The final ORDER BY repeats the window ordering: OVER (ORDER BY …) only orders rows for the function and never guarantees output order.',
      },
      predictions: [
        {
          stage: 'where',
          kind: 'rowcount',
          question: 'How many employees reach the window stage once Exec is filtered out?',
          explain: '12 employees minus Maya (Exec) = 11. Window functions only ever see rows that survived WHERE.',
        },
        {
          stage: 'window',
          kind: 'choice',
          question: 'Sales salaries are Olga 170k, Vik 110k, Wen 110k, Uma 95k. What are Uma’s RANK and DENSE_RANK?',
          options: ['4 and 4', '4 and 3', '3 and 3', '3 and 4'],
          answer: 1,
          explain: 'Vik and Wen share rank 2. RANK then skips to 4 (two people are ahead of position 3); DENSE_RANK continues with the next distinct value, 3.',
        },
      ],
      takeaway: 'Choose the ranking function by how ties must behave, partition by the “per X”, and add a unique tie-breaker whenever exactly one row must win.',
    },
    build: {
      prompt:
        'Rank employees inside each department (exclude Exec) by salary, highest first. Equal salaries share a rank and the next rank is **not** skipped. Also show the department headcount. Order by department, rank, then name.',
      blocks: [
        { slot: 'select', sql: 'dept', why: 'The partition key — shown so each rank has context.' },
        { slot: 'select', sql: 'name', why: 'Who is being ranked.' },
        { slot: 'select', sql: 'salary', why: 'The value the rank is based on.' },
        {
          slot: 'select',
          sql: 'DENSE_RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS salary_rank',
          why: 'Ties share a rank and no number is skipped → DENSE_RANK. PARTITION BY restarts numbering per department.',
        },
        {
          slot: 'select',
          sql: 'COUNT(*) OVER (PARTITION BY dept) AS headcount',
          why: 'No ORDER BY in OVER → the frame is the whole partition, so every row sees the full department count.',
        },
        { slot: 'from', sql: 'employees', why: 'One row per employee — already the grain we want.' },
        { slot: 'where', sql: "dept <> 'Exec'", why: 'Runs before the window: Exec rows never enter a partition.' },
        { slot: 'orderBy', sql: 'dept', why: 'Output order must be explicit — the OVER ordering doesn’t sort the result.' },
        { slot: 'orderBy', sql: 'salary_rank', why: 'ORDER BY runs after SELECT, so it can use the alias.' },
        { slot: 'orderBy', sql: 'name', why: 'Tie-breaker for equal ranks so the output is deterministic.' },
      ],
      traps: [
        {
          slot: 'select',
          sql: 'RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS salary_rank',
          replaces: 'DENSE_RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS salary_rank',
          why: 'RANK skips after ties: Ravi becomes 5 instead of 4 and Uma 4 instead of 3 — the spec said “not skipped”.',
        },
        {
          slot: 'select',
          sql: 'ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) AS salary_rank',
          replaces: 'DENSE_RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS salary_rank',
          why: 'ROW_NUMBER never shares: Priya and Quinn (both 150k) get different ranks, decided arbitrarily.',
        },
        {
          slot: 'select',
          sql: 'DENSE_RANK() OVER (ORDER BY salary DESC) AS salary_rank',
          replaces: 'DENSE_RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS salary_rank',
          why: 'Without PARTITION BY you rank across the whole company: Olga (Sales top earner) becomes 2 behind Noah.',
        },
        {
          slot: 'select',
          sql: 'COUNT(*) OVER (PARTITION BY dept ORDER BY salary DESC) AS headcount',
          replaces: 'COUNT(*) OVER (PARTITION BY dept) AS headcount',
          why: 'Adding ORDER BY turns on the default frame (start → current row + peers): it becomes a running count, not the headcount.',
        },
        {
          slot: 'select',
          sql: 'DENSE_RANK() OVER (PARTITION BY dept ORDER BY salary) AS salary_rank',
          replaces: 'DENSE_RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS salary_rank',
          why: 'Ascending order ranks the lowest earner first — rank 1 must be the highest salary.',
        },
      ],
    },
    exercises: [
      {
        id: 'rk-second-highest',
        kind: 'write',
        title: 'Second-highest salary per department',
        difficulty: 'Medium',
        prompt:
          'Return every employee who earns the **second-highest distinct salary** of their department: `dept`, `name`, `salary`. If two people share the top salary, the next lower salary is “second”. Order by dept, name.',
        solution: `WITH ranked AS (
  SELECT dept, name, salary,
         DENSE_RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS salary_rank
  FROM employees
)
SELECT dept, name, salary
FROM ranked
WHERE salary_rank = 2
ORDER BY dept, name`,
        hints: ['“Distinct salary” → which ranking function never skips numbers?', 'You can’t filter a window result in WHERE of the same query — wrap it in a CTE.'],
        explanation:
          'DENSE_RANK = 2 is “the second distinct value”, so both Vik and Wen (110k) qualify in Sales, and Tom in Engineering. Exec has a single employee, so it has no second salary — the classic LeetCode follow-up is to return NULL for such groups (LEFT JOIN the departments to this result). ROW_NUMBER = 2 would return only one of Vik/Wen; RANK = 2 would fail if the top salary were tied.',
      },
      {
        id: 'rk-leaderboard',
        kind: 'fix-bug',
        title: 'Leaderboard ties',
        difficulty: 'Easy',
        prompt:
          'Customer leaderboard by number of **paid** orders: `name`, `paid_orders`, `position`. Customers with the same count must share a position and the next position is skipped (1, 2, 2, 4). Order by position, name. The query below gives tied customers different positions. Fix it.',
        starter: `SELECT u.name,
       COUNT(*) AS paid_orders,
       ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS position
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.status = 'paid'
GROUP BY u.id, u.name
ORDER BY position, u.name`,
        solution: `SELECT u.name,
       COUNT(*) AS paid_orders,
       RANK() OVER (ORDER BY COUNT(*) DESC) AS position
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.status = 'paid'
GROUP BY u.id, u.name
ORDER BY position, u.name`,
        hints: ['Which function shares positions and then leaves a gap?', 'Note the window runs after GROUP BY, so it can order by COUNT(*).'],
        explanation:
          'RANK gives Asha 1, Dana and Fatima 2, and the four one-order customers 4. ROW_NUMBER numbered the ties arbitrarily (Goran happened to get 4, Ben 5…). Also notice the evaluation order on display: GROUP BY builds one row per customer first, then the window ranks those groups — that is why `RANK() OVER (ORDER BY COUNT(*) DESC)` is legal.',
      },
      {
        id: 'rk-spend-bands',
        kind: 'write',
        title: 'Three equal spend bands',
        difficulty: 'Easy',
        prompt:
          'Split the **paid** orders into 3 equally sized bands by amount, band 1 = biggest orders. Return `id`, `amount`, `band`, ordered by amount descending then id. Make the banding deterministic.',
        solution: `SELECT id, amount,
       NTILE(3) OVER (ORDER BY amount DESC, id) AS band
FROM orders
WHERE status = 'paid'
ORDER BY amount DESC, id`,
        hints: ['NTILE(n) deals rows into n buckets of (almost) equal size.', 'Add `id` to the window ORDER BY so equal amounts can’t swap bands between runs.'],
        explanation:
          '12 paid orders / 3 = 4 per band (when it doesn’t divide evenly, the first buckets get one extra row). NTILE ignores ties: two equal amounts at a boundary land in different bands, which is why `id` is needed for reproducibility — and why “top 10%” segmentation with ties is often better done with `CUME_DIST()`.',
      },
    ],
    judgment: [
      {
        id: 'rk-ntile-tiers',
        kind: 'peer-review',
        title: 'PR: loyalty tiers with NTILE',
        context:
          'Growth wants customers split into gold (top half by paid orders) and silver. The PR uses NTILE(2). Support already had a complaint: “I have the same number of orders as my friend, why is he gold?”',
        sql: `WITH spend AS (
  SELECT u.name, COUNT(*) AS paid_orders
  FROM orders o
  JOIN users u ON u.id = o.user_id
  WHERE o.status = 'paid'
  GROUP BY u.id, u.name
)
SELECT name, paid_orders,
       CASE NTILE(2) OVER (ORDER BY paid_orders DESC)
            WHEN 1 THEN 'gold' ELSE 'silver' END AS tier
FROM spend
ORDER BY paid_orders DESC, name`,
        bugLines: [9],
        options: [
          {
            text: 'NTILE fills equal-size buckets and ignores ties, so one of four customers with 1 order is gold and the others silver; use CUME_DIST/PERCENT_RANK so ties stay together.',
            correct: true,
            why: '7 customers → buckets of 4 and 3. The 4th slot goes to an arbitrary one-order customer (Goran here). CUME_DIST gives all tied rows the same value.',
          },
          { text: 'COUNT(*) should be COUNT(DISTINCT o.id).', why: 'Each order is one row here (no fan-out), so COUNT(*) is already the number of orders.' },
          { text: 'NTILE needs PARTITION BY name.', why: 'Partitioning by name would put every customer alone in a bucket — everyone would be gold.' },
          { text: 'The CASE must be in the CTE, not the outer query.', why: 'Window functions are allowed in the outer SELECT; the placement is fine.' },
        ],
        fixedSql: `WITH spend AS (
  SELECT u.name, COUNT(*) AS paid_orders
  FROM orders o
  JOIN users u ON u.id = o.user_id
  WHERE o.status = 'paid'
  GROUP BY u.id, u.name
)
SELECT name, paid_orders,
       CASE WHEN CUME_DIST() OVER (ORDER BY paid_orders DESC) <= 0.5
            THEN 'gold' ELSE 'silver' END AS tier
FROM spend
ORDER BY paid_orders DESC, name`,
        lesson: 'NTILE guarantees bucket sizes, not fairness. When equal values must get equal treatment, rank by CUME_DIST/PERCENT_RANK and threshold it (here: 3 gold, 4 silver).',
      },
    ],
    recall: [
      { q: 'Salaries 190, 165, 150, 150, 135. Give ROW_NUMBER, RANK and DENSE_RANK for 135.', a: 'ROW_NUMBER 5, RANK 5, DENSE_RANK 4.' },
      { q: 'Which ranking function answers “N-th highest distinct value”?', a: 'DENSE_RANK — it never skips numbers after ties.' },
      { q: 'Why can a ROW_NUMBER-based query return different rows on two runs?', a: 'Ties in the window ORDER BY are numbered in arbitrary order; add a unique tie-breaker.' },
      { q: 'Which plan node computes window functions and what input does it need?', a: 'WindowAgg; input sorted by PARTITION BY then ORDER BY keys (a Sort node or an index providing that order).' },
    ],
    transfer: [
      {
        id: 'rk-t-exam',
        scenario: 'A school publishes class rankings per grade: equal scores share a place and the next student is placed after all of them (1, 2, 2, 4).',
        approach: 'RANK() OVER (PARTITION BY grade ORDER BY score DESC). Use DENSE_RANK only if the school wants 1, 2, 2, 3. Order the output by grade, rank, name.',
      },
      {
        id: 'rk-t-sellers',
        scenario: 'Marketplace: label each seller with their revenue quartile within their country for a payout experiment.',
        approach: 'Aggregate revenue per seller, then NTILE(4) OVER (PARTITION BY country ORDER BY revenue DESC, seller_id). If ties must share a quartile use CEIL(4 * CUME_DIST()) instead.',
      },
    ],
    confusable: ['top-n-per-group', 'dedup-latest', 'percentiles-median'],
  },
  {
    id: 'top-n-per-group',
    track: 'windows',
    title: 'Top-N per group',
    tagline: 'Rank inside each group in a CTE, then filter outside — or let an index fetch N rows per group directly.',
    level: 'intermediate',
    minutes: 15,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      '“Top 3 products per category”, “latest 5 orders per customer”, “highest-paid per department” are the same pattern: **number the rows inside each group, keep numbers ≤ N**.',
      'You cannot write `WHERE ROW_NUMBER() OVER (…) <= 3`: WHERE runs **before** window functions exist (logical order FROM → WHERE → GROUP BY → HAVING → window → SELECT). So compute the rank in a CTE/subquery and filter in the outer query. Snowflake, BigQuery and Databricks add `QUALIFY` to do this in one level; Postgres does not have it.',
      'Ties decide the function: `ROW_NUMBER` returns exactly N rows per group (arbitrary among ties unless you add a tie-breaker), `RANK() <= N` returns everyone tied at the boundary (can be more than N), `DENSE_RANK() <= N` returns the top N **distinct values**. Groups with fewer than N rows simply return fewer rows.',
      'There are three physical strategies: (1) window + filter — one sort of everything, best when you need most groups; (2) `DISTINCT ON (group) … ORDER BY group, x DESC` — Postgres shorthand for N = 1; (3) `LATERAL (… ORDER BY x DESC LIMIT N)` per group driven by an index — best when you need a few groups out of a huge table.',
    ],
    internals: [
      'Window approach plan: Scan → **Sort** (group keys, order keys) → **WindowAgg** → Subquery Scan with the `rn <= N` filter. The sort touches every row, O(n log n), spilling to disk beyond `work_mem`. Since Postgres 15 the filter becomes a WindowAgg **Run Condition**, so rows after N in a partition aren’t emitted — but they are still read and sorted.',
      '`DISTINCT ON` plans as Sort → **Unique**: one pass that keeps the first row of each group from sorted input. Same O(n log n) sort, less machinery, Postgres-only syntax.',
      'LATERAL plans as a **Nested Loop**: for each outer group row, an **Index Scan** on `(group_key, order_key DESC)` reads N entries and a **Limit** stops it. Cost ≈ groups × (B-tree descent + N tuples) instead of a full sort — on 200k orders, 201 users × 3 rows takes ~2 ms versus ~130 ms for ranking the whole table (see the judgment drill).',
      'The tradeoff flips with selectivity: if you need the top 3 of **every** one of 20 000 users, 20 000 index probes (random I/O) can lose to one sequential scan + sort. Measure with EXPLAIN ANALYZE; the planner estimates this from row counts and index correlation.',
    ],
    signals: ['top N / best N per group', 'latest K events per user', 'highest-paid in each department', 'first purchase of each customer', 'include ties at the cut-off'],
    template: `WITH ranked AS (
  SELECT t.*,
         ROW_NUMBER() OVER (PARTITION BY group_key
                            ORDER BY score DESC, id) AS rn  -- tie-breaker!
  FROM t
)
SELECT * FROM ranked WHERE rn <= 3;   -- filter outside: WHERE can't see window results

-- index-driven alternative for a few groups out of a huge table
SELECT g.id, x.*
FROM groups g
CROSS JOIN LATERAL (
  SELECT * FROM t WHERE t.group_key = g.id ORDER BY score DESC LIMIT 3
) x;`,
    realWorld: [
      {
        title: 'API: “latest 3 orders” on every customer card',
        body: 'A customer list page shows each customer’s last orders. A window over the whole orders table is a full sort per request; LATERAL + `LIMIT 3` on an index `(user_id, created_at DESC)` reads exactly 3 index entries per customer shown.',
      },
      {
        title: 'Warehouse: QUALIFY',
        body: 'In Snowflake/BigQuery/Databricks you write `QUALIFY ROW_NUMBER() OVER (…) <= 3` — same semantics as the CTE + filter. Porting such SQL to Postgres means adding a subquery level.',
      },
      {
        title: 'Recommendation feeds',
        body: '“Top 10 items per category” for a homepage is computed in batch with window + filter (every category needed, one big sort is cheapest), then cached — not computed per request.',
      },
    ],
    mistakes: [
      {
        title: 'Filtering the window result in WHERE',
        why: 'Error: window functions are not allowed in WHERE — they are computed after it.',
        fix: 'Compute the rank in a CTE/subquery and filter outside (or QUALIFY in warehouses).',
      },
      {
        title: 'ROW_NUMBER when ties must be included',
        why: 'Two products tied for 1st: ROW_NUMBER silently drops one of them.',
        fix: '`RANK() <= N` (all tied at the boundary) or `DENSE_RANK() <= N` (top N distinct values).',
      },
      {
        title: 'Global LIMIT instead of per-group',
        why: '`ORDER BY score DESC LIMIT 3` returns 3 rows total, not 3 per group.',
        fix: 'PARTITION BY the group, or LATERAL … LIMIT per group.',
      },
      {
        title: 'Ranking the whole table to show a handful of groups',
        why: 'The window sorts every row even when you only need 20 users’ top 3.',
        fix: 'Index `(group_key, order_key DESC)` + LATERAL … LIMIT N.',
      },
    ],
    worked: {
      question: 'Top 2 earners per department, and how far each is ahead of the next person shown.',
      sql: `WITH ranked AS (
  SELECT dept, name, salary,
         ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC, hired_at) AS rn
  FROM employees
)
SELECT dept, name, salary, rn,
       salary - LEAD(salary) OVER (PARTITION BY dept ORDER BY rn) AS ahead_of_next
FROM ranked
WHERE rn <= 2
ORDER BY dept, rn`,
      notes: {
        cte: 'The ranking happens here, on all 12 employees. Vik and Wen tie at 110k in Sales; `hired_at` breaks the tie, so Vik (hired 2020) is rn 2 and Wen rn 3.',
        where: 'This is the top-N step: an ordinary WHERE on a column that already exists. Exec has only Maya, so it contributes 1 row — groups smaller than N just return fewer rows.',
        window: 'The second window runs on the **filtered** rows: Tom’s LEAD looks for the next row in his partition and finds none, because Priya was removed by WHERE before this window ran.',
      },
      predictions: [
        {
          stage: 'where',
          kind: 'rowcount',
          question: 'Engineering has 6 people, Sales 5, Exec 1. How many rows survive `rn <= 2`?',
          explain: '2 + 2 + 1 = 5. Exec has only one employee, so it can’t contribute two.',
        },
        {
          stage: 'window',
          kind: 'choice',
          question: 'Tom (165k) is rn 2 in Engineering; Priya (150k) is rn 3. What is Tom’s ahead_of_next?',
          options: ['15000 (Tom − Priya)', 'NULL', '0', '25000'],
          answer: 1,
          explain: 'The outer window only sees rows that survived WHERE. Priya was filtered out, so Tom is the last row of his partition and LEAD returns NULL.',
        },
      ],
      takeaway: 'Rank in a CTE, filter outside. Pick ROW_NUMBER / RANK / DENSE_RANK by how ties at the cut-off must behave, and remember that anything computed after the filter only sees the kept rows.',
    },
    build: {
      prompt:
        'Best-selling product(s) per category by **units sold on paid orders**. If products tie for first place, show all of them. Return category, product name and units; order by category, name.',
      ctes: ['ranked'],
      blocks: [
        { scope: 'ranked', slot: 'select', sql: 'p.category', why: 'The group we want a winner for.' },
        { scope: 'ranked', slot: 'select', sql: 'p.name', why: 'The candidate.' },
        { scope: 'ranked', slot: 'select', sql: 'SUM(i.qty) AS units', why: 'Units sold — an aggregate per product.' },
        {
          scope: 'ranked',
          slot: 'select',
          sql: 'RANK() OVER (PARTITION BY p.category ORDER BY SUM(i.qty) DESC) AS pos',
          why: 'Windows run after GROUP BY, so they can order by an aggregate. RANK keeps ties at position 1.',
        },
        { scope: 'ranked', slot: 'from', sql: 'order_items i', why: 'One row per line item: units live here.' },
        { scope: 'ranked', slot: 'join', sql: 'JOIN products p ON p.id = i.product_id', why: 'Many-to-one lookup of category and name — no fan-out.' },
        { scope: 'ranked', slot: 'join', sql: 'JOIN orders o ON o.id = i.order_id', why: 'Needed to know the order status.' },
        { scope: 'ranked', slot: 'where', sql: "o.status = 'paid'", why: 'Only paid orders count as sales.' },
        { scope: 'ranked', slot: 'groupBy', sql: 'p.id', why: 'One row per product…' },
        { scope: 'ranked', slot: 'groupBy', sql: 'p.category', why: '…keeping category…' },
        { scope: 'ranked', slot: 'groupBy', sql: 'p.name', why: '…and name selectable.' },
        { slot: 'select', sql: 'category', why: 'Output column.' },
        { slot: 'select', sql: 'name', why: 'Output column.' },
        { slot: 'select', sql: 'units', why: 'Output column.' },
        { slot: 'from', sql: 'ranked', why: 'Read the ranked products like a table.' },
        { slot: 'where', sql: 'pos = 1', why: 'The top-N filter, outside the query that computed the rank.' },
        { slot: 'orderBy', sql: 'category', why: 'Stable output.' },
        { slot: 'orderBy', sql: 'name', why: 'Tie-breaker for tied winners.' },
      ],
      traps: [
        {
          scope: 'ranked',
          slot: 'select',
          sql: 'ROW_NUMBER() OVER (PARTITION BY p.category ORDER BY SUM(i.qty) DESC) AS pos',
          replaces: 'RANK() OVER (PARTITION BY p.category ORDER BY SUM(i.qty) DESC) AS pos',
          why: 'Chair and Lamp both sold 4 units: ROW_NUMBER keeps only one of them, chosen arbitrarily.',
        },
        {
          scope: 'ranked',
          slot: 'select',
          sql: 'RANK() OVER (ORDER BY SUM(i.qty) DESC) AS pos',
          replaces: 'RANK() OVER (PARTITION BY p.category ORDER BY SUM(i.qty) DESC) AS pos',
          why: 'No PARTITION BY → one global ranking: only Notebook (12 units) is “first”.',
        },
        {
          scope: 'ranked',
          slot: 'select',
          sql: 'RANK() OVER (PARTITION BY p.category ORDER BY SUM(i.qty)) AS pos',
          replaces: 'RANK() OVER (PARTITION BY p.category ORDER BY SUM(i.qty) DESC) AS pos',
          why: 'Ascending order makes the worst seller rank 1.',
        },
        {
          scope: 'ranked',
          slot: 'where',
          sql: 'pos = 1',
          why: 'Error: `pos` doesn’t exist yet in WHERE of the query that computes it — WHERE runs before window functions. Filter in the outer query.',
        },
      ],
    },
    exercises: [
      {
        id: 'tn-top2-orders',
        kind: 'write',
        title: 'Two biggest orders per customer',
        difficulty: 'Easy',
        prompt:
          'For every registered customer (ignore guest orders), return their **two largest orders** of any status: `user_id`, `id`, `amount`. Order by user_id, then amount descending.',
        solution: `WITH ranked AS (
  SELECT user_id, id, amount,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY amount DESC, id) AS rn
  FROM orders
  WHERE user_id IS NOT NULL
)
SELECT user_id, id, amount
FROM ranked
WHERE rn <= 2
ORDER BY user_id, amount DESC`,
        hints: ['Number each customer’s orders from biggest to smallest.', 'Filter the number in an outer query.'],
        explanation:
          'Customers with a single order (Chen, Eli, Goran, Hana) return one row. `id` in the window ORDER BY is the tie-breaker; for “two per customer, exactly” ROW_NUMBER is right. On a large table with a few customers on screen, `LATERAL (… ORDER BY amount DESC LIMIT 2)` with an index on `(user_id, amount DESC)` avoids sorting all orders.',
      },
      {
        id: 'tn-recent-hires',
        kind: 'fix-bug',
        title: 'Two most recent hires per department',
        difficulty: 'Easy',
        prompt: 'Return the two most recently hired employees of each department: `dept`, `name`, `hired_at`, ordered by dept then hired_at descending. The query below doesn’t even run. Fix it.',
        starter: `SELECT dept, name, hired_at
FROM employees
WHERE ROW_NUMBER() OVER (PARTITION BY dept ORDER BY hired_at DESC) <= 2
ORDER BY dept, hired_at DESC`,
        solution: `WITH ranked AS (
  SELECT dept, name, hired_at,
         ROW_NUMBER() OVER (PARTITION BY dept ORDER BY hired_at DESC, id) AS rn
  FROM employees
)
SELECT dept, name, hired_at
FROM ranked
WHERE rn <= 2
ORDER BY dept, hired_at DESC`,
        hints: ['Read the error: where are window functions allowed?', 'Move the ROW_NUMBER into a CTE and filter on its alias.'],
        explanation:
          'Window functions are evaluated after WHERE, so Postgres rejects them there (“window functions are not allowed in WHERE”). The CTE materialises the number as a normal column, which the outer WHERE can filter. Warehouses offer `QUALIFY` for exactly this.',
      },
      {
        id: 'tn-bonus-ties',
        kind: 'write',
        title: 'Top-3 bonus with ties',
        difficulty: 'Medium',
        prompt:
          'Everyone in the top 3 positions of their department by salary gets a bonus. Tied salaries share a position and the following position is skipped (so a tie at 2nd means nobody is 3rd). Return `dept`, `name`, `salary`, `pos`, ordered by dept, pos, name.',
        solution: `WITH ranked AS (
  SELECT dept, name, salary,
         RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS pos
  FROM employees
)
SELECT dept, name, salary, pos
FROM ranked
WHERE pos <= 3
ORDER BY dept, pos, name`,
        hints: ['Shared position + skip afterwards = competition ranking.', 'Some departments may return more than 3 people.'],
        explanation:
          'RANK returns 8 people: Engineering 4 (Priya and Quinn tie at 3), Sales 3 (Vik and Wen tie at 2, so Uma is 4th and out), Exec 1. DENSE_RANK ≤ 3 would also include Uma (third distinct salary); ROW_NUMBER ≤ 3 would arbitrarily drop Quinn or Priya.',
      },
    ],
    judgment: [
      {
        id: 'tn-lateral-latest',
        kind: 'slow-query',
        title: 'Slow “latest 3 orders” for new users',
        context:
          'The onboarding dashboard shows the 3 most recent orders of users who signed up in the last week of 2023. It takes 130 ms on a 200k-row table and will grow with the table. An index on (user_id, created_at DESC) already exists.',
        setup: 'CREATE INDEX bo_user_created ON big_orders (user_id, created_at DESC); ANALYZE big_orders;',
        sql: `WITH ranked AS (
  SELECT user_id, id, created_at, amount,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
  FROM big_orders
)
SELECT u.id AS user_id, r.id AS order_id, r.created_at, r.amount
FROM big_users u
JOIN ranked r ON r.user_id = u.id AND r.rn <= 3
WHERE u.created_at >= '2023-12-25'
ORDER BY u.id, r.created_at DESC`,
        bugLines: [1, 2, 3, 4],
        options: [
          {
            text: 'The CTE ranks all 200k orders before the join can restrict to ~200 users; fetch each user’s 3 rows with LATERAL … LIMIT 3 so the index is probed per user.',
            correct: true,
            why: 'The plan shows WindowAgg over a full index scan of big_orders (200k rows). LATERAL turns it into a Nested Loop with 201 Index Scan + Limit probes.',
          },
          { text: 'ROW_NUMBER is slower than RANK; switching would fix it.', why: 'Both are O(1) per row after the sort; the cost is reading and ordering every order.' },
          { text: 'The CTE is materialised; add NOT MATERIALIZED.', why: 'It is already inlined (referenced once). The predicate on users still can’t be pushed through the window, because it filters by a joined table.' },
          { text: 'Add an index on big_users(created_at).', why: 'The users side is cheap (~1 ms); the 130 ms is the window over all orders.' },
        ],
        fixedSql: `SELECT u.id AS user_id, r.id AS order_id, r.created_at, r.amount
FROM big_users u
CROSS JOIN LATERAL (
  SELECT o.id, o.created_at, o.amount
  FROM big_orders o
  WHERE o.user_id = u.id
  ORDER BY o.created_at DESC
  LIMIT 3
) r
WHERE u.created_at >= '2023-12-25'
ORDER BY u.id, r.created_at DESC`,
        comparePlans: true,
        lesson:
          'Window + filter is “sort everything, keep a few”; LATERAL + LIMIT on a matching index is “read only what you return”. Use the first for all groups in batch, the second for a few groups at request time.',
      },
    ],
    recall: [
      { q: 'Why can’t you write WHERE ROW_NUMBER() OVER (…) <= 3?', a: 'WHERE is evaluated before window functions; compute the rank in a CTE/subquery (or use QUALIFY in warehouses) and filter outside.' },
      { q: 'Top-N with ties at the cut-off included: which function?', a: 'RANK() <= N (may return more than N); DENSE_RANK() <= N for the top N distinct values.' },
      { q: 'Postgres shorthand for top-1 per group?', a: 'SELECT DISTINCT ON (group) … ORDER BY group, score DESC, id.' },
      { q: 'When does LATERAL + LIMIT beat window + filter?', a: 'When you need a few groups out of a big table and an index on (group_key, order_key) exists: per-group index probes instead of sorting everything.' },
    ],
    transfer: [
      {
        id: 'tn-t-support',
        scenario: 'Support wants, for each agent, the three tickets with the longest resolution time this month (ties at 3rd place should all be shown).',
        approach: 'CTE: RANK() OVER (PARTITION BY agent_id ORDER BY resolution_minutes DESC) over this month’s tickets; outer WHERE rank <= 3. RANK because ties at the boundary are wanted.',
      },
      {
        id: 'tn-t-feed',
        scenario: 'A mobile API returns the 5 newest posts for each of the 20 accounts a user follows; the posts table has 500M rows.',
        approach: 'Index posts(author_id, created_at DESC); SELECT … FROM follows f CROSS JOIN LATERAL (SELECT … FROM posts p WHERE p.author_id = f.followee_id ORDER BY created_at DESC LIMIT 5). 20 index probes instead of a window over 500M rows.',
      },
      {
        id: 'tn-t-first-purchase',
        scenario: 'Attribution: find each customer’s first purchase to credit the acquisition channel.',
        approach: 'Top-1 per group: DISTINCT ON (customer_id) … ORDER BY customer_id, purchased_at, id — or ROW_NUMBER() = 1 for portability.',
      },
    ],
    confusable: ['ranking-functions', 'dedup-latest', 'semi-anti-joins'],
  },
  {
    id: 'lag-lead',
    track: 'windows',
    title: 'LAG / LEAD: compare with the previous or next row',
    tagline: 'Look one row back or ahead inside a partition — deltas, gaps between events, “what happened next” — without a self-join.',
    level: 'core',
    minutes: 12,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      '`LAG(x)` returns `x` from the **previous** row of the partition (in the window ORDER BY), `LEAD(x)` from the **next** row. That turns “compare each row with its neighbour” into a single pass: day-over-day change, time since the previous order, the next page a user visited.',
      'Full signature: `LAG(value, offset = 1, default = NULL)`. The first row of a partition has no previous row, so LAG returns NULL — or the default you pass (`LAG(amount, 1, 0)`). Decide deliberately: NULL means “unknown/not applicable”, 0 can fake a change of +100%.',
      '“Previous row” is **positional**, not calendar-based. If a day has no sales it has no row, and LAG on daily totals happily compares Mar 10 with Mar 6. When you mean “the previous day”, first build a complete calendar (`generate_series`) and LEFT JOIN the data to it.',
      "Window functions see only the rows that survive WHERE. Filtering to `status = 'paid'` before LAG means “previous paid order”; if you want “previous order of any status”, compute LAG in a CTE first and filter afterwards. Same for LEAD on events: filter first and the “next event” changes.",
    ],
    internals: [
      'LAG/LEAD run inside **WindowAgg** on input sorted by PARTITION BY + ORDER BY. WindowAgg keeps the current partition in a **tuplestore** with read pointers, so fetching the row `offset` positions back/ahead is a cheap pointer move — no join, no extra scan.',
      'The classic pre-window alternative is a self-join on `b.rn = a.rn - 1` (or a correlated subquery for “max date before this one”). That costs a second scan plus a hash/merge join (or a subquery per row); LAG is one sort and one streaming pass.',
      'Several LAG/LEAD calls with the same `OVER (…)` share one sort and one WindowAgg; write them with an identical window (or a named `WINDOW w AS (…)`) so you don’t pay for extra sorts.',
      'Postgres does not support `IGNORE NULLS` (Oracle, Snowflake, BigQuery and Spark do). “Carry the last non-NULL value forward” in Postgres needs a gaps-and-islands trick: a running `COUNT(col)` as a group id, then `MAX(col)` per group.',
    ],
    signals: ['compared with the previous day / month / order', 'change, delta, growth rate', 'time since last / time until next event', 'what did the user do next', 'consecutive rows'],
    template: `SELECT user_id, ordered_at, amount,
       amount - LAG(amount) OVER w                 AS change_vs_prev,
       ordered_at - LAG(ordered_at) OVER w         AS since_prev,
       LEAD(ordered_at, 1, 'infinity') OVER w      AS next_order_at
FROM orders
WINDOW w AS (PARTITION BY user_id ORDER BY ordered_at, id);`,
    realWorld: [
      {
        title: 'Month-over-month KPIs',
        body: 'Every growth dashboard has “revenue vs last month”: aggregate to the month, then `LAG(revenue) OVER (ORDER BY month)`. Guard the percentage with `NULLIF(prev, 0)` and fill missing months from a calendar.',
      },
      {
        title: 'Event streams and SLAs',
        body: 'Time between `order_placed` and `order_shipped`, time to the next heartbeat (gaps = outages), price change detection in CDC feeds: all `LEAD`/`LAG` per entity ordered by event time.',
      },
      {
        title: 'Building validity intervals',
        body: 'Turning a stream of status changes into SCD2 rows: `valid_to = LEAD(changed_at) OVER (PARTITION BY key ORDER BY changed_at)`, with a far-future default (`9999-12-31`) or NULL for the current version.',
      },
    ],
    mistakes: [
      {
        title: 'Missing PARTITION BY',
        why: 'The first row of user 2 is compared with the last row of user 1 — deltas across entities.',
        fix: 'PARTITION BY the entity (user, sensor, account).',
      },
      {
        title: 'Treating “previous row” as “previous day”',
        why: 'Days with no data have no row; LAG skips over them silently.',
        fix: 'Generate a calendar with `generate_series` and LEFT JOIN, then LAG.',
      },
      {
        title: 'Filtering before LEAD/LAG when you meant after',
        why: 'WHERE runs first, so the neighbour is chosen among the kept rows only.',
        fix: 'Compute LAG/LEAD in a CTE over all rows, filter in the outer query.',
      },
      {
        title: 'Non-unique ORDER BY in the window',
        why: 'Two events with the same timestamp: which one is “previous” is arbitrary.',
        fix: 'Add a tie-breaker: `ORDER BY event_time, id`.',
      },
    ],
    worked: {
      question: 'For each customer’s paid orders: how much more or less did they spend than last time, how many days passed, and when is their next order?',
      sql: `SELECT user_id, id, ordered_at, amount,
       LAG(amount) OVER (PARTITION BY user_id ORDER BY ordered_at) AS prev_amount,
       amount - LAG(amount) OVER (PARTITION BY user_id ORDER BY ordered_at) AS change,
       ordered_at::date - LAG(ordered_at::date) OVER (PARTITION BY user_id ORDER BY ordered_at) AS days_since_prev,
       LEAD(ordered_at::date, 1, DATE '9999-12-31') OVER (PARTITION BY user_id ORDER BY ordered_at) AS next_order_day
FROM orders
WHERE status = 'paid' AND user_id IS NOT NULL
ORDER BY user_id, ordered_at`,
      notes: {
        where: 'Pending/refunded orders and the guest order are removed **before** the window: “previous order” will mean “previous paid order”.',
        window:
          'Hover any row to see which neighbour LAG reads. 7 customers → 7 partitions; 4 of them have a single paid order, so all their LAG columns are NULL and next_order_day is the default 9999-12-31. Asha: 130 → 300 (+170, 14 days) → 70 (−230, 45 days).',
        select: 'Arithmetic with NULL stays NULL: `amount - NULL` is NULL for each first order, which is honest — there is no change to report.',
      },
      predictions: [
        {
          stage: 'where',
          kind: 'rowcount',
          question: 'How many paid orders from registered customers reach the window?',
          explain: '16 orders − 2 pending − 2 refunded − 1 guest = 11.',
        },
        {
          stage: 'window',
          kind: 'choice',
          question: 'Dana (user 4) has paid order 6 (680), pending order 7 (50), then paid order 8 (480). What is prev_amount for order 8?',
          options: ['50 — the pending order 7', '680 — order 6', 'NULL'],
          answer: 1,
          explain: 'WHERE removed the pending order before LAG ran, so the previous row in Dana’s partition is order 6 (680) and the change is −200.',
        },
      ],
      takeaway: 'LAG/LEAD read neighbours by position inside the partition, after WHERE. Partition by the entity, order deterministically, and fill calendars when “previous” must mean a time period.',
    },
    build: {
      prompt:
        'For users 1 and 2, list every event with the **previous event type of the same user** and the minutes since that event. Order by user, then event time.',
      blocks: [
        { slot: 'select', sql: 'user_id', why: 'The entity whose timeline we walk.' },
        { slot: 'select', sql: 'id', why: 'Identifies the event.' },
        { slot: 'select', sql: 'event_type', why: 'What happened now…' },
        {
          slot: 'select',
          sql: 'LAG(event_type) OVER (PARTITION BY user_id ORDER BY event_time) AS prev_type',
          why: '…and what happened just before, for the same user, in time order.',
        },
        {
          slot: 'select',
          sql: 'EXTRACT(EPOCH FROM event_time - LAG(event_time) OVER (PARTITION BY user_id ORDER BY event_time)) / 60 AS gap_min',
          why: 'timestamp − timestamp is an interval; EPOCH / 60 turns it into minutes (NULL for the first event).',
        },
        { slot: 'from', sql: 'events', why: 'One row per event.' },
        { slot: 'where', sql: 'user_id IN (1, 2)', why: 'Keeps the output short; filtering whole users doesn’t change anyone’s neighbours.' },
        { slot: 'orderBy', sql: 'user_id', why: 'Readable output…' },
        { slot: 'orderBy', sql: 'event_time', why: '…in timeline order.' },
      ],
      traps: [
        {
          slot: 'select',
          sql: 'LAG(event_type) OVER (ORDER BY event_time) AS prev_type',
          replaces: 'LAG(event_type) OVER (PARTITION BY user_id ORDER BY event_time) AS prev_type',
          why: 'Without PARTITION BY the previous row can belong to another user: user 2’s 10:00 view would “follow” user 1’s 09:22 purchase.',
        },
        {
          slot: 'select',
          sql: 'LEAD(event_type) OVER (PARTITION BY user_id ORDER BY event_time) AS prev_type',
          replaces: 'LAG(event_type) OVER (PARTITION BY user_id ORDER BY event_time) AS prev_type',
          why: 'LEAD looks forward: this is the next event, not the previous one.',
        },
        {
          slot: 'where',
          sql: "event_type <> 'view'",
          why: 'Dropping views before the window changes the neighbours: an add_to_cart now “follows” whatever non-view event came earlier, and the gaps grow.',
        },
      ],
    },
    exercises: [
      {
        id: 'll-mom-revenue',
        kind: 'write',
        title: 'Month-over-month revenue',
        difficulty: 'Medium',
        prompt:
          'Monthly revenue of **paid** orders: `month` (date of the first day), `revenue`, `prev_revenue` and `pct_change` = 100 × (revenue − prev) / prev rounded to 1 decimal (NULL for the first month). Order by month.',
        solution: `WITH monthly AS (
  SELECT date_trunc('month', ordered_at)::date AS month,
         SUM(amount) AS revenue
  FROM orders
  WHERE status = 'paid'
  GROUP BY 1
)
SELECT month, revenue,
       LAG(revenue) OVER (ORDER BY month) AS prev_revenue,
       ROUND(100.0 * (revenue - LAG(revenue) OVER (ORDER BY month))
             / NULLIF(LAG(revenue) OVER (ORDER BY month), 0), 1) AS pct_change
FROM monthly
ORDER BY month`,
        hints: ['Aggregate to one row per month first.', 'Then LAG over the months; NULLIF avoids division by zero.'],
        explanation:
          'Jan 965 → Feb 2305 (+138.9%) → Mar 715 (−69.0%). Aggregate first, then window: the window runs after GROUP BY, so you could even write `LAG(SUM(amount)) OVER (ORDER BY …)` in one level. In production, LEFT JOIN a month calendar so a month with zero sales isn’t skipped.',
      },
      {
        id: 'll-login-gaps',
        kind: 'fix-bug',
        title: 'Days since previous login',
        difficulty: 'Easy',
        prompt:
          'For every login return `user_id`, `login_date` and `gap_days` = days since the **same user’s** previous login (NULL for their first). Order by user_id, login_date. The query below gives users 2, 3 and 4 a gap on their first login. Fix it.',
        starter: `SELECT user_id, login_date,
       login_date - LAG(login_date) OVER (ORDER BY user_id, login_date) AS gap_days
FROM logins
ORDER BY user_id, login_date`,
        solution: `SELECT user_id, login_date,
       login_date - LAG(login_date) OVER (PARTITION BY user_id ORDER BY login_date) AS gap_days
FROM logins
ORDER BY user_id, login_date`,
        hints: ['Ordering by user_id is not the same as partitioning by it.', 'Where does user 2’s first login look for its “previous” row?'],
        explanation:
          'Ordering by user_id keeps users adjacent but still one partition: user 2’s first login (Mar 1) was compared with user 1’s last (Mar 12) → −11 days. PARTITION BY restarts LAG per user. Note user 2’s duplicate Mar 4 login produces a gap of 0 — a data-quality signal worth deduplicating.',
      },
      {
        id: 'll-after-cart',
        kind: 'write',
        title: 'What happens after add-to-cart?',
        difficulty: 'Medium',
        prompt:
          'For each `add_to_cart` event return `user_id`, `id`, the type of the **same user’s next event of any type** (`next_event`) and the minutes until it (`minutes_to_next`). Order by id.',
        solution: `WITH nxt AS (
  SELECT id, user_id, event_type,
         LEAD(event_type) OVER (PARTITION BY user_id ORDER BY event_time) AS next_event,
         EXTRACT(EPOCH FROM LEAD(event_time) OVER (PARTITION BY user_id ORDER BY event_time) - event_time) / 60 AS minutes_to_next
  FROM events
)
SELECT user_id, id, next_event, minutes_to_next
FROM nxt
WHERE event_type = 'add_to_cart'
ORDER BY id`,
        hints: ['If you filter to add_to_cart first, what is the “next” event?', 'Compute LEAD over all events in a CTE, filter afterwards.'],
        explanation:
          'Filtering first would make LEAD return the next add_to_cart (or NULL). Computing LEAD over the full stream shows users 2 and 3 went back to browsing (`view`, 45–47 min later) instead of checking out — a funnel insight from one pass.',
      },
    ],
    judgment: [
      {
        id: 'll-dod-gaps',
        kind: 'spot-bug',
        title: 'Day-over-day revenue skips quiet days',
        context: 'Ops dashboard ticket: “DoD change for March 1–10”. Finance noticed Mar 5 shows −45 although Mar 4 had no sales at all.',
        sql: `SELECT ordered_at::date AS day,
       SUM(amount) AS revenue,
       SUM(amount) - LAG(SUM(amount)) OVER (ORDER BY ordered_at::date) AS dod_change
FROM orders
WHERE status = 'paid'
  AND ordered_at >= '2024-03-01' AND ordered_at < '2024-03-11'
GROUP BY ordered_at::date
ORDER BY day`,
        bugLines: [3, 4],
        options: [
          {
            text: 'Days without sales have no row, so LAG compares with the last day that had sales; build a calendar and LEFT JOIN before LAG.',
            correct: true,
            why: 'Only 4 of 10 days have rows. Mar 5 is compared with Mar 2 (115 → 70). With a calendar Mar 5 is +70 vs Mar 4 (0).',
          },
          { text: 'LAG over an aggregate is not allowed; it should be computed in a subquery.', why: 'It is allowed: windows run after GROUP BY, so LAG(SUM(amount)) is valid.' },
          { text: 'The window needs PARTITION BY day.', why: 'Partitioning by day gives one row per partition: LAG would always be NULL.' },
          { text: 'ordered_at < 2024-03-11 drops Mar 10.', why: 'Mar 10 14:10 < Mar 11 00:00 — the half-open range is correct.' },
        ],
        fixedSql: `WITH days AS (
  SELECT d::date AS day
  FROM generate_series(DATE '2024-03-01', DATE '2024-03-10', INTERVAL '1 day') AS g(d)
), daily AS (
  SELECT days.day, COALESCE(SUM(o.amount), 0) AS revenue
  FROM days
  LEFT JOIN orders o ON o.ordered_at::date = days.day AND o.status = 'paid'
  GROUP BY days.day
)
SELECT day, revenue,
       revenue - LAG(revenue) OVER (ORDER BY day) AS dod_change
FROM daily
ORDER BY day`,
        lesson: 'LAG is positional. Whenever “previous” means a time bucket, densify the series first (calendar + LEFT JOIN + COALESCE), then compare.',
      },
    ],
    recall: [
      { q: 'What does LAG return for the first row of a partition?', a: 'NULL, or the third argument (default) if given: LAG(x, 1, 0).' },
      { q: 'Why can LAG on daily totals compare non-adjacent days?', a: 'It is positional: days without rows are skipped. Densify with generate_series + LEFT JOIN first.' },
      { q: 'How do you get “minutes until the next event” per user?', a: 'EXTRACT(EPOCH FROM LEAD(event_time) OVER (PARTITION BY user_id ORDER BY event_time) - event_time) / 60.' },
      { q: 'Postgres lacks IGNORE NULLS. How do you forward-fill?', a: 'Running COUNT(col) OVER (ORDER BY t) as a group id, then MAX(col) OVER (PARTITION BY grp).' },
    ],
    transfer: [
      {
        id: 'll-t-price',
        scenario: 'A pricing table logs a row per product per price change. Show each change with old price, new price and percent change.',
        approach: 'LAG(price) OVER (PARTITION BY product_id ORDER BY changed_at, id) as old_price; percent = 100 * (price - old) / NULLIF(old, 0). First row per product has NULL old price.',
      },
      {
        id: 'll-t-heartbeat',
        scenario: 'IoT devices send heartbeats every minute; find outages where the gap to the next heartbeat exceeds 5 minutes.',
        approach: 'CTE with LEAD(sent_at) OVER (PARTITION BY device_id ORDER BY sent_at) AS next_at; outer WHERE next_at - sent_at > interval \'5 minutes\'.',
      },
    ],
    confusable: ['running-totals-frames', 'self-joins', 'sessionization', 'gaps-islands'],
  },
  {
    id: 'running-totals-frames',
    track: 'windows',
    title: 'Running totals, moving averages and window frames',
    tagline: 'SUM OVER (ORDER BY …) is a running total — but which rows are “so far”? ROWS vs RANGE, peers, and the LAST_VALUE trap.',
    level: 'core',
    minutes: 14,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      'Aggregate functions become window functions with `OVER`. With `ORDER BY` inside the window, each row aggregates a **frame**: the slice of its partition from the start “up to here”. `SUM(amount) OVER (ORDER BY day)` is a running total; `OVER (PARTITION BY user_id ORDER BY day)` restarts it per user; `OVER ()` (no ORDER BY) gives every row the grand total.',
      'The **default frame** with ORDER BY is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. RANGE works with **peers**: all rows with the same ORDER BY value are included together. Two orders on the same day both show the day’s full total — the running total “jumps” and duplicates. `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` counts physical rows and grows one row at a time (add a tie-breaker so the order is deterministic).',
      'Moving windows are frames too: `AVG(x) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)` averages the current row and the 6 before it — 7 **rows**, which equals 7 **days** only if every day has exactly one row. For calendar windows on sparse data use `RANGE BETWEEN INTERVAL \'6 days\' PRECEDING AND CURRENT ROW` or densify first.',
      '`FIRST_VALUE` is safe with the default frame (the frame always starts at the partition start), but `LAST_VALUE` returns the last row **of the frame** — i.e. the current row or its last peer, not the last of the partition. Use `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`, or simply `FIRST_VALUE` with the order reversed.',
    ],
    internals: [
      'WindowAgg evaluates frames incrementally. For SUM/COUNT/AVG Postgres uses **moving-aggregate inverse transition functions**: when the frame slides, it adds the new row and subtracts the one that left — O(1) per row. MIN/MAX have no inverse, so a sliding frame recomputes them from the frame start whenever the head moves out.',
      'Three frame modes: `ROWS` (physical offsets), `RANGE` (value offsets from the current row’s ORDER BY value — offsets like `INTERVAL \'6 days\'` need exactly one ORDER BY column of a numeric/date type), and `GROUPS` (count peer groups). `EXCLUDE CURRENT ROW | GROUP | TIES` removes rows from the frame, e.g. “average of the other rows”.',
      'All windows with an identical PARTITION BY/ORDER BY share one sort. Different ORDER BYs (even just adding the tie-breaker `id` in one of them) force an extra Sort + WindowAgg node; in EXPLAIN you’ll see the WindowAgg nodes stacked.',
      'With the default RANGE frame the executor must look ahead to find the last peer before emitting a row; with ROWS it doesn’t. That is one reason (besides correctness) to write `ROWS` explicitly on a unique order.',
    ],
    signals: ['running / cumulative total', 'year-to-date', 'moving / rolling average', 'last N rows / last 7 days', 'share of total', 'first / last value in group'],
    template: `SELECT day, amount,
       SUM(amount) OVER (ORDER BY day, id
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total,
       AVG(amount) OVER (ORDER BY day, id
                         ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)         AS moving_avg_7,
       amount * 1.0 / SUM(amount) OVER ()                                    AS share_of_total
FROM t;`,
    realWorld: [
      {
        title: 'Finance: cumulative and YTD figures',
        body: 'Account balances from a ledger (`SUM(delta) OVER (PARTITION BY account ORDER BY posted_at, id)`), year-to-date revenue (`PARTITION BY year`). Peers matter: two postings in the same second must not both show the combined balance.',
      },
      {
        title: 'Product metrics: smoothing noisy series',
        body: '7-day rolling DAU/revenue lines on every dashboard. Build a complete daily series first, then a ROWS moving average — or RANGE with an interval when days may be missing.',
      },
      {
        title: 'Pareto / ABC analysis',
        body: '“Which products make 80% of revenue?” = running sum ordered by revenue DESC divided by `SUM() OVER ()`, then filter where the cumulative share ≤ 0.8.',
      },
    ],
    mistakes: [
      {
        title: 'Relying on the default RANGE frame with duplicate order keys',
        why: 'Peers share the frame: both orders of Mar 2 show the same running total and the curve skips a step.',
        fix: 'Order by a unique key (`day, id`) and write `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`.',
      },
      {
        title: 'LAST_VALUE with the default frame',
        why: 'The frame ends at the current row (or its last peer), so LAST_VALUE returns the current row.',
        fix: 'Frame `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`, or FIRST_VALUE with the reverse order.',
      },
      {
        title: '“N PRECEDING” on sparse data called a 7-day average',
        why: 'ROWS counts rows: with missing days, 6 PRECEDING reaches back weeks.',
        fix: 'Densify the calendar, or use `RANGE BETWEEN INTERVAL \'6 days\' PRECEDING AND CURRENT ROW`.',
      },
      {
        title: 'Off-by-one in the frame size',
        why: '`ROWS 7 PRECEDING` is 8 rows (7 before + current).',
        fix: 'An N-row window is `N-1 PRECEDING AND CURRENT ROW`.',
      },
    ],
    worked: {
      question: 'Running revenue of paid orders by day — what is the difference between the default frame and an explicit ROWS frame, and why does LAST_VALUE look broken?',
      sql: `WITH paid AS (
  SELECT id, ordered_at::date AS day, amount
  FROM orders
  WHERE status = 'paid'
)
SELECT day, id, amount,
       SUM(amount) OVER (ORDER BY day) AS range_total,
       SUM(amount) OVER (ORDER BY day, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS rows_total,
       ROUND(AVG(amount) OVER (ORDER BY day, id ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2) AS avg_last_3,
       LAST_VALUE(amount) OVER (ORDER BY day) AS last_value_trap
FROM paid
ORDER BY day, id`,
      notes: {
        cte: '12 paid orders, reduced to day + amount. Orders 11 and 13 share 2024-03-02 — two **peers** under `ORDER BY day`.',
        window:
          'Hover order 11: its range_total frame includes order 13 (same day) → 3385, while rows_total stops at order 11 → 3350. They agree again at order 13. last_value_trap for order 11 is 35 — the last **peer**, not the last order overall (3985 is the final total). avg_last_3 slides a 3-row frame.',
        order: 'The final ORDER BY only sorts the output; the frames were already fixed by each window’s own ORDER BY.',
      },
      predictions: [
        {
          stage: 'window',
          kind: 'choice',
          question: 'Order 11 (3,350 cumulative by rows) shares its day with order 13 (35). What is order 11’s range_total?',
          options: ['3350', '3385', '3985'],
          answer: 1,
          explain: 'The default RANGE frame includes all peers of the current row, so order 13’s 35 is already counted: 3350 + 35 = 3385.',
        },
        {
          stage: 'window',
          kind: 'choice',
          question: 'Order 10 (1600) is alone on its day. What does LAST_VALUE(amount) OVER (ORDER BY day) return for it?',
          options: ['1600 — its own amount', '35 — the last paid order', 'NULL'],
          answer: 0,
          explain: 'The default frame ends at the current row’s last peer. With no peers, that is the current row itself.',
        },
      ],
      takeaway: 'Every windowed aggregate has a frame. Know the default (RANGE … CURRENT ROW with peers), write ROWS + a unique ORDER BY for running totals, and widen the frame for LAST_VALUE.',
    },
    build: {
      prompt:
        'For paid orders, return `day`, `id`, `amount`, a strictly row-by-row **running revenue** and the **average of the last 3 orders** (including the current one). Order by day, id.',
      blocks: [
        { slot: 'select', sql: 'ordered_at::date AS day', why: 'The calendar day of the order.' },
        { slot: 'select', sql: 'id', why: 'Tie-breaker and identifier.' },
        { slot: 'select', sql: 'amount', why: 'The value being accumulated.' },
        {
          slot: 'select',
          sql: 'SUM(amount) OVER (ORDER BY ordered_at::date, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_revenue',
          why: 'Unique order + ROWS: each row adds exactly itself; no peer jumps.',
        },
        {
          slot: 'select',
          sql: 'ROUND(AVG(amount) OVER (ORDER BY ordered_at::date, id ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2) AS avg_last_3',
          why: '2 preceding + current = 3 rows.',
        },
        { slot: 'from', sql: 'orders', why: 'One row per order.' },
        { slot: 'where', sql: "status = 'paid'", why: 'Revenue counts only paid orders.' },
        { slot: 'orderBy', sql: 'day', why: 'Output in the same order as the frames…' },
        { slot: 'orderBy', sql: 'id', why: '…including the tie-breaker.' },
      ],
      traps: [
        {
          slot: 'select',
          sql: 'SUM(amount) OVER (ORDER BY ordered_at::date) AS running_revenue',
          replaces: 'SUM(amount) OVER (ORDER BY ordered_at::date, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_revenue',
          why: 'Default RANGE frame: orders 11 and 13 (same day) both show 3385.',
        },
        {
          slot: 'select',
          sql: 'SUM(amount) OVER () AS running_revenue',
          replaces: 'SUM(amount) OVER (ORDER BY ordered_at::date, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_revenue',
          why: 'No ORDER BY → the frame is the whole partition: every row shows the grand total 3985.',
        },
        {
          slot: 'select',
          sql: 'SUM(amount) OVER (PARTITION BY ordered_at::date ORDER BY id) AS running_revenue',
          replaces: 'SUM(amount) OVER (ORDER BY ordered_at::date, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_revenue',
          why: 'Partitioning by day restarts the total every day — a per-day subtotal, not a running total.',
        },
        {
          slot: 'select',
          sql: 'ROUND(AVG(amount) OVER (ORDER BY ordered_at::date, id ROWS BETWEEN 3 PRECEDING AND CURRENT ROW), 2) AS avg_last_3',
          replaces: 'ROUND(AVG(amount) OVER (ORDER BY ordered_at::date, id ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2) AS avg_last_3',
          why: '3 PRECEDING + current = 4 rows. Off by one.',
        },
      ],
    },
    exercises: [
      {
        id: 'rt-customer-running',
        kind: 'write',
        title: 'Customer lifetime spend, step by step',
        difficulty: 'Easy',
        prompt:
          'For every **paid** order of a registered customer return `user_id`, `id`, `amount`, `running_spend` (that customer’s cumulative spend in order of `ordered_at`) and `pct_of_customer` = the order’s share of that customer’s total paid spend, in percent rounded to 1 decimal. Order by user_id, ordered_at.',
        solution: `SELECT user_id, id, amount,
       SUM(amount) OVER (PARTITION BY user_id ORDER BY ordered_at, id
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_spend,
       ROUND(100.0 * amount / SUM(amount) OVER (PARTITION BY user_id), 1) AS pct_of_customer
FROM orders
WHERE status = 'paid' AND user_id IS NOT NULL
ORDER BY user_id, ordered_at`,
        hints: ['Two windows: one ordered (running), one without ORDER BY (total).', 'Both are partitioned by the customer.'],
        explanation:
          'Asha: 130 → 430 → 500, shares 26.0 / 60.0 / 14.0. `OVER (PARTITION BY user_id)` without ORDER BY has the whole partition as its frame — that is how you get “total per group” next to each row without a GROUP BY + join.',
      },
      {
        id: 'rt-lowest-paid',
        kind: 'fix-bug',
        title: 'Lowest-paid colleague per department',
        difficulty: 'Medium',
        prompt:
          'Next to every employee show `dept`, `name`, `salary` and `lowest_paid` = the name of the lowest-paid employee **in the same department**. The query returns the employee’s own name for most rows. Fix it. Order by dept, salary DESC, name.',
        starter: `SELECT dept, name, salary,
       LAST_VALUE(name) OVER (PARTITION BY dept ORDER BY salary DESC) AS lowest_paid
FROM employees
ORDER BY dept, salary DESC, name`,
        solution: `SELECT dept, name, salary,
       FIRST_VALUE(name) OVER (PARTITION BY dept ORDER BY salary ASC, name) AS lowest_paid
FROM employees
ORDER BY dept, salary DESC, name`,
        hints: ['What is the default frame when the window has ORDER BY?', 'Either widen the frame to UNBOUNDED FOLLOWING or flip the order and use FIRST_VALUE.'],
        explanation:
          'The default frame ends at the current row (plus its peers), so LAST_VALUE is the current row. `FIRST_VALUE(name) OVER (… ORDER BY salary ASC)` needs no frame change. Equivalent: keep LAST_VALUE and add `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`. Answers: Engineering → Sara, Sales → Xia, Exec → Maya.',
      },
      {
        id: 'rt-dau-moving',
        kind: 'write',
        title: '3-day moving average of daily active users',
        difficulty: 'Medium',
        prompt:
          'From `logins`, compute per `login_date` the number of distinct users (`dau`) and `dau_3d` = average of dau over that day and the 2 previous days, rounded to 2 decimals. Order by login_date.',
        solution: `WITH daily AS (
  SELECT login_date, COUNT(DISTINCT user_id) AS dau
  FROM logins
  GROUP BY login_date
)
SELECT login_date, dau,
       ROUND(AVG(dau) OVER (ORDER BY login_date ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2) AS dau_3d
FROM daily
ORDER BY login_date`,
        hints: ['Aggregate to one row per day first — COUNT(DISTINCT) can’t be a window function in Postgres.', 'ROWS BETWEEN 2 PRECEDING AND CURRENT ROW = 3 rows.'],
        explanation:
          'Every day from Mar 1 to Mar 16 has logins here, so 3 rows = 3 days. User 2 logged in twice on Mar 4, so COUNT(DISTINCT) gives 1, not 2. On real data, LEFT JOIN a calendar (or use RANGE with an interval) so a missing day doesn’t stretch the window.',
      },
    ],
    judgment: [
      {
        id: 'rt-7day',
        kind: 'peer-review',
        title: '“7-day” average on sparse days',
        context: 'A PR adds a “7-day rolling revenue” tile. Orders don’t happen every day.',
        sql: `WITH daily AS (
  SELECT ordered_at::date AS day, SUM(amount) AS revenue
  FROM orders
  WHERE status = 'paid'
  GROUP BY 1
)
SELECT day, revenue,
       ROUND(AVG(revenue) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) AS rolling_7d
FROM daily
ORDER BY day`,
        bugLines: [8],
        options: [
          {
            text: 'Request changes: ROWS 6 PRECEDING averages the last 7 days **with sales**, which can span weeks; use a calendar or a RANGE interval frame and divide by 7.',
            correct: true,
            why: 'On Mar 10 the frame reaches back to January. A true 7-day window (Mar 4–10) sums 600 → 85.71/day, not 431.43.',
          },
          { text: 'Approve: 6 PRECEDING + current row is exactly 7 days.', why: 'Only if every day has exactly one row. Here many days have none.' },
          { text: 'Request changes: should be 7 PRECEDING.', why: 'That would be 8 rows — and it still counts rows, not days.' },
          { text: 'Request changes: AVG can’t be used with a frame clause.', why: 'Any aggregate can take a frame.' },
        ],
        fixedSql: `WITH daily AS (
  SELECT ordered_at::date AS day, SUM(amount) AS revenue
  FROM orders
  WHERE status = 'paid'
  GROUP BY 1
)
SELECT day, revenue,
       ROUND(SUM(revenue) OVER (ORDER BY day RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW) / 7.0, 2) AS rolling_7d
FROM daily
ORDER BY day`,
        lesson: 'ROWS counts rows; RANGE with an interval counts time. For calendar windows on sparse data use RANGE (one date/numeric ORDER BY column) or densify the series, and decide whether missing days count as zero.',
      },
    ],
    recall: [
      { q: 'What is the default frame when a window has ORDER BY?', a: 'RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW — includes all peers of the current row.' },
      { q: 'Why does LAST_VALUE often return the current row?', a: 'The default frame ends at the current row (or its last peer). Widen to UNBOUNDED FOLLOWING or use FIRST_VALUE reversed.' },
      { q: 'How many rows is ROWS BETWEEN 6 PRECEDING AND CURRENT ROW?', a: '7 (6 before + current) — but rows, not days.' },
      { q: 'Window with no ORDER BY: what is the frame?', a: 'The whole partition — every row gets the partition total.' },
    ],
    transfer: [
      {
        id: 'rt-t-balance',
        scenario: 'A ledger table has (account_id, posted_at, delta). Show the balance after each posting; several postings can share a timestamp.',
        approach: 'SUM(delta) OVER (PARTITION BY account_id ORDER BY posted_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW). The id tie-breaker plus ROWS keeps same-second postings from sharing a balance.',
      },
      {
        id: 'rt-t-pareto',
        scenario: 'Find the smallest set of products that makes up 80% of revenue.',
        approach: 'Per-product revenue CTE; cumulative share = SUM(rev) OVER (ORDER BY rev DESC, id ROWS UNBOUNDED PRECEDING) / SUM(rev) OVER (); keep rows where the share before the current row (cumulative − rev) < 0.8.',
      },
    ],
    confusable: ['lag-lead', 'ranking-functions', 'conditional-aggregation', 'retention-cohort'],
  },
  {
    id: 'dedup-latest',
    track: 'windows',
    title: 'Deduplicate: keep the latest row per key',
    tagline: 'Staging tables, CDC feeds and double-submits all produce duplicates. Rank versions per key, keep rn = 1 — and know how to delete the rest.',
    level: 'core',
    minutes: 12,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      'Deduplication is top-1-per-group where the group is the **business key** and the order is “newest first”: `ROW_NUMBER() OVER (PARTITION BY key ORDER BY updated_at DESC, tie_breaker)`, then keep `rn = 1`. Everything else (rn > 1) is a duplicate or an older version.',
      'Get the **key** right first. Emails differ in case and whitespace (`Eli@Mail.com` vs `eli@mail.com`), phone numbers in formatting. Partition by the normalised key (`lower(trim(email))`), otherwise “duplicates” sail through as different keys.',
      'Get the **order** right second. If two versions have the same `updated_at` (true duplicates, or same-second updates), the winner is arbitrary and can change between runs. Add a deterministic tie-breaker (ingestion id, `_loaded_at`, source offset); for byte-identical rows it doesn’t matter which survives — but the query should still be stable.',
      'Postgres has a shortcut: `SELECT DISTINCT ON (key) … ORDER BY key, updated_at DESC` keeps the first row of each key. It’s concise and fast, but Postgres-only and limited to one row per key; ROW_NUMBER works everywhere and also lets you keep rn ≤ N or count copies.',
    ],
    internals: [
      'Both ROW_NUMBER and DISTINCT ON need input sorted by key + order: a Sort (or an index scan on `(key, updated_at DESC)`) followed by WindowAgg / Unique. Since PG 15, a `rn = 1` / `rn <= N` filter on the outer query becomes a **Run Condition** that lets WindowAgg stop emitting rows of a partition early.',
      'Deleting duplicates in place needs a row identity. With a surrogate `id`: `DELETE … WHERE id IN (SELECT id FROM ranked WHERE rn > 1)`. Without one, Postgres has the physical row address **`ctid`** — fine inside a single statement, but it changes on UPDATE/VACUUM FULL, so never store it or use it across transactions.',
      '`INSERT … ON CONFLICT DO UPDATE` fails with “command cannot affect row a second time” if the same key appears twice in one batch, and `MERGE` raises an error when several source rows match one target row. Dedup the staging batch **before** upserting.',
      'In warehouses (BigQuery, Snowflake, Databricks) the idiom is `QUALIFY ROW_NUMBER() OVER (PARTITION BY key ORDER BY ts DESC) = 1` — QUALIFY is a WHERE for window results. Postgres has no QUALIFY, so it’s a CTE/subquery.',
    ],
    signals: ['latest record per key', 'remove duplicates / keep one', 'current version', 'CDC / changelog / staging table', 'double-submitted', 'upsert fails with duplicates'],
    template: `WITH ranked AS (
  SELECT t.*,
         ROW_NUMBER() OVER (PARTITION BY lower(email)
                            ORDER BY updated_at DESC, ingest_id DESC) AS rn
  FROM staging_users t
)
SELECT * FROM ranked WHERE rn = 1;

-- Postgres shortcut
SELECT DISTINCT ON (lower(email)) *
FROM staging_users
ORDER BY lower(email), updated_at DESC, ingest_id DESC;`,
    realWorld: [
      {
        title: 'ELT staging → dimension tables',
        body: 'Each load appends the source extract to a staging table; the merge step keeps the newest version per natural key (ROW_NUMBER / QUALIFY) before MERGE-ing into the dimension, so the MERGE never sees two source rows for one target.',
      },
      {
        title: 'CDC streams (Debezium, Kafka)',
        body: 'Change events are at-least-once: the same change can arrive twice, out of order. Deduplicate on (key, source LSN/offset), then keep the max offset per key to get the current state.',
      },
      {
        title: 'Cleaning double submits',
        body: 'A form double-posts and creates two identical signups. A one-off `DELETE … WHERE id IN (… rn > 1)` cleans up, followed by a UNIQUE index (on `lower(email)`) so it can’t happen again.',
      },
    ],
    mistakes: [
      {
        title: 'Partitioning by the raw, un-normalised key',
        why: '`Eli@Mail.com` and `eli@mail.com` are different strings, so both survive.',
        fix: 'Partition by `lower(trim(email))` (and enforce it with a unique expression index).',
      },
      {
        title: 'Ordering ascending',
        why: 'rn = 1 becomes the oldest version.',
        fix: '`ORDER BY updated_at DESC` — and decide where NULL timestamps go (`NULLS LAST`).',
      },
      {
        title: 'Using RANK instead of ROW_NUMBER',
        why: 'Ties both get rank 1, so exact duplicates survive the dedup.',
        fix: 'ROW_NUMBER with a tie-breaker.',
      },
      {
        title: 'Relying on ctid outside one statement',
        why: 'ctid is a physical location; UPDATE and VACUUM FULL move rows.',
        fix: 'Use ctid only inside a single DELETE; otherwise add a surrogate key.',
      },
    ],
    worked: {
      question: 'Audit the staging table: which email keys are duplicated, and which version of each is the newest?',
      sql: `SELECT lower(email) AS email_key, email, name, country, updated_at,
       ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY updated_at DESC) AS version_rank,
       COUNT(*) OVER (PARTITION BY lower(email)) AS copies
FROM staging_users
ORDER BY email_key, version_rank`,
      notes: {
        from: '6 staged rows. `Eli@Mail.com` and `eli@mail.com` look different; the two Kim rows are byte-identical.',
        window:
          'Partitioning by `lower(email)` gives 4 keys. Eli’s newest version is “Eli R.” (Mar 21). COUNT(*) OVER the same partition shows copies next to each row — the audit view you show before deleting anything.',
        order: 'Sorting by version_rank puts the keeper (1) first in each key; the dedup itself is just “keep version_rank = 1”.',
      },
      predictions: [
        {
          stage: 'window',
          kind: 'rowcount',
          question: 'How many rows leave the window stage?',
          explain: 'Window functions never remove rows: still 6. Deduplication needs a filter afterwards (rn = 1 in an outer query).',
        },
        {
          stage: 'window',
          kind: 'choice',
          question: 'The two Kim rows have the same updated_at. Which one gets version_rank 1?',
          options: ['The one inserted first', 'The one inserted last', 'Either — the tie is arbitrary'],
          answer: 2,
          explain: 'ROW_NUMBER breaks ties in whatever order the sort produced them. Here the rows are identical so it doesn’t matter, but on real data add a tie-breaker (ingest id) to make the winner stable.',
        },
      ],
      takeaway: 'Normalise the key, order newest-first with a tie-breaker, ROW_NUMBER, keep rn = 1. Audit with COUNT(*) OVER before deleting.',
    },
    build: {
      prompt:
        'Produce the cleaned staging table: one row per **case-insensitive** email with its newest `name`, `country` and `updated_at`. Output `email` in lower case. Order by email.',
      ctes: ['ranked'],
      blocks: [
        { scope: 'ranked', slot: 'select', sql: 'lower(email) AS email', why: 'The normalised business key.' },
        { scope: 'ranked', slot: 'select', sql: 'name', why: 'Attribute to keep.' },
        { scope: 'ranked', slot: 'select', sql: 'country', why: 'Attribute to keep.' },
        { scope: 'ranked', slot: 'select', sql: 'updated_at', why: 'Version timestamp.' },
        {
          scope: 'ranked',
          slot: 'select',
          sql: 'ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY updated_at DESC) AS rn',
          why: 'Newest version per normalised key gets 1; ROW_NUMBER guarantees exactly one 1 per key.',
        },
        { scope: 'ranked', slot: 'from', sql: 'staging_users', why: 'The raw extract.' },
        { slot: 'select', sql: 'email', why: 'Output the cleaned row…' },
        { slot: 'select', sql: 'name', why: '…' },
        { slot: 'select', sql: 'country', why: '…' },
        { slot: 'select', sql: 'updated_at', why: '…with its version time.' },
        { slot: 'from', sql: 'ranked', why: 'Read the ranked CTE.' },
        { slot: 'where', sql: 'rn = 1', why: 'Keep only the newest version — must be outside the query that computes rn.' },
        { slot: 'orderBy', sql: 'email', why: 'Stable output.' },
      ],
      traps: [
        {
          scope: 'ranked',
          slot: 'select',
          sql: 'ROW_NUMBER() OVER (PARTITION BY email ORDER BY updated_at DESC) AS rn',
          replaces: 'ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY updated_at DESC) AS rn',
          why: 'Case-sensitive key: Eli@Mail.com and eli@mail.com both survive → 5 rows.',
        },
        {
          scope: 'ranked',
          slot: 'select',
          sql: 'ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY updated_at ASC) AS rn',
          replaces: 'ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY updated_at DESC) AS rn',
          why: 'Keeps the oldest version: Eli instead of Eli R.',
        },
        {
          scope: 'ranked',
          slot: 'select',
          sql: 'RANK() OVER (PARTITION BY lower(email) ORDER BY updated_at DESC) AS rn',
          replaces: 'ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY updated_at DESC) AS rn',
          why: 'The two identical Kim rows tie at rank 1 — the duplicate survives.',
        },
        {
          scope: 'ranked',
          slot: 'where',
          sql: 'rn = 1',
          why: 'rn doesn’t exist yet in the query that defines it (and windows run after WHERE): error.',
        },
      ],
    },
    exercises: [
      {
        id: 'dd-latest-order',
        kind: 'write',
        title: 'Each customer’s most recent order',
        difficulty: 'Easy',
        prompt:
          'For every registered customer return their most recent order (any status): `user_id`, `id`, `ordered_at`, `status`. Order by user_id.',
        solution: `WITH ranked AS (
  SELECT user_id, id, ordered_at, status,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY ordered_at DESC, id DESC) AS rn
  FROM orders
  WHERE user_id IS NOT NULL
)
SELECT user_id, id, ordered_at, status
FROM ranked
WHERE rn = 1
ORDER BY user_id`,
        hints: ['Partition by the customer, newest first.', 'DISTINCT ON (user_id) … ORDER BY user_id, ordered_at DESC is the Postgres shortcut.'],
        explanation:
          '8 customers → 8 rows (e.g. Asha → order 15, Dana → order 8). `DISTINCT ON (user_id)` gives the same result in one level. Exclude the guest order (NULL user_id) or it becomes its own “customer”.',
      },
      {
        id: 'dd-current-tier',
        kind: 'fix-bug',
        title: 'Current loyalty tier',
        difficulty: 'Easy',
        prompt:
          '`customer_tiers` holds the tier history. Return each user’s **current** tier (`user_id`, `tier`, `valid_from`) as the row with the latest `valid_from`. Order by user_id. The query reports user 1 as bronze. Fix it.',
        starter: `SELECT DISTINCT ON (user_id) user_id, tier, valid_from
FROM customer_tiers
ORDER BY user_id, valid_from`,
        solution: `SELECT DISTINCT ON (user_id) user_id, tier, valid_from
FROM customer_tiers
ORDER BY user_id, valid_from DESC`,
        hints: ['DISTINCT ON keeps the first row per key in ORDER BY order.', 'Which row is first with ascending valid_from?'],
        explanation:
          'DISTINCT ON keeps the **first** row of each key according to the ORDER BY, so the ORDER BY must start with the DISTINCT ON key and then put the winner first: `valid_from DESC`. Result: 1 gold, 2 bronze, 4 silver, 6 gold, 8 bronze.',
      },
      {
        id: 'dd-delete-dupes',
        kind: 'write',
        title: 'Delete the stale staging rows',
        difficulty: 'Hard',
        prompt:
          '`staging_users` has no primary key. **DELETE** every row that is not the newest version of its case-insensitive email, and return the deleted rows’ `email`, `name`, `updated_at` ordered by email, updated_at. (Your changes are rolled back after the run.)',
        solution: `WITH deleted AS (
  DELETE FROM staging_users
  WHERE ctid IN (
    SELECT ctid
    FROM (
      SELECT ctid,
             ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY updated_at DESC) AS rn
      FROM staging_users
    ) ranked
    WHERE rn > 1
  )
  RETURNING email, name, updated_at
)
SELECT email, name, updated_at
FROM deleted
ORDER BY email, updated_at`,
        hints: ['Without an id, ctid identifies the physical row within this statement.', 'Rank in a subquery, delete where rn > 1; RETURNING shows what went.'],
        explanation:
          'Two rows go: the older Eli@Mail.com version and one of the identical Kim rows. ctid is safe here because ranking and deleting happen in one statement; don’t persist it. Afterwards add `CREATE UNIQUE INDEX ON staging_users (lower(email))` so duplicates can’t come back.',
      },
    ],
    judgment: [
      {
        id: 'dd-case-email',
        kind: 'spot-bug',
        title: 'Dedup that keeps a duplicate',
        context: 'The nightly job dedups staging_users before upserting into users with ON CONFLICT ((lower(email))). It fails with “ON CONFLICT DO UPDATE command cannot affect row a second time”.',
        sql: `SELECT DISTINCT ON (email) email, name, country, updated_at
FROM staging_users
ORDER BY email, updated_at DESC`,
        bugLines: [1, 3],
        options: [
          {
            text: 'The dedup key is case-sensitive: Eli@Mail.com and eli@mail.com both survive and collide on lower(email) in the upsert.',
            correct: true,
            why: 'The query returns 5 rows for 4 real users. Using lower(email) in DISTINCT ON and ORDER BY returns 4.',
          },
          { text: 'DISTINCT ON keeps the oldest row because of the ORDER BY.', why: 'updated_at DESC puts the newest first; that part is right.' },
          { text: 'The identical Kim rows both survive DISTINCT ON.', why: 'DISTINCT ON keeps exactly one row per key, even for identical rows.' },
          { text: 'DISTINCT ON cannot be combined with ORDER BY.', why: 'It requires ORDER BY to start with the DISTINCT ON expressions.' },
        ],
        fixedSql: `SELECT DISTINCT ON (lower(email)) lower(email) AS email, name, country, updated_at
FROM staging_users
ORDER BY lower(email), updated_at DESC`,
        lesson: 'Dedup on exactly the key the target’s unique constraint uses. A batch that is “deduplicated” on a different key still contains conflicts for the upsert.',
      },
    ],
    recall: [
      { q: 'Standard dedup pattern?', a: 'ROW_NUMBER() OVER (PARTITION BY key ORDER BY updated_at DESC, tie_breaker) in a CTE; keep rn = 1.' },
      { q: 'Why ROW_NUMBER and not RANK for dedup?', a: 'RANK gives ties the same rank, so exact duplicates both keep rank 1.' },
      { q: 'How do you delete duplicates in a table without a primary key?', a: 'DELETE … WHERE ctid IN (SELECT ctid FROM (ranked) WHERE rn > 1) — in one statement.' },
      { q: 'Why must a batch be deduplicated before INSERT … ON CONFLICT DO UPDATE?', a: 'Two rows with the same key in one statement raise “cannot affect row a second time”; MERGE errors similarly.' },
    ],
    transfer: [
      {
        id: 'dd-t-cdc',
        scenario: 'A CDC feed lands (pk, op, payload, lsn) rows, sometimes twice, sometimes out of order. Build the current-state table.',
        approach: 'ROW_NUMBER() OVER (PARTITION BY pk ORDER BY lsn DESC) = 1 (duplicates share an lsn, any one wins); then drop keys whose winning op is a delete. Upsert by pk.',
      },
      {
        id: 'dd-t-bigquery',
        scenario: 'In BigQuery, keep the latest event per session_id from a 2 TB table.',
        approach: 'SELECT * FROM events WHERE TRUE QUALIFY ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY ts DESC) = 1 — or ARRAY_AGG(e ORDER BY ts DESC LIMIT 1)[OFFSET(0)] grouped by session_id, which often shuffles less.',
      },
    ],
    confusable: ['top-n-per-group', 'upsert-idempotent', 'scd2-asof', 'ranking-functions'],
  },
  {
    id: 'percentiles-median',
    track: 'windows',
    title: 'Percentiles and medians',
    tagline: 'Averages lie on skewed data. percentile_cont vs percentile_disc, medians per group, p95 latency — and why percentiles don’t add up.',
    level: 'advanced',
    minutes: 13,
    interview: 2,
    viz: 'pipeline',
    intuition: [
      'Latency, order values and salaries are **skewed**: a few huge values drag the average far from the typical row. In the sample, 8 of 10 /search requests are below the average (186 ms) — the average describes almost nobody. The **median** (p50) is the typical value; **p95/p99** describe the tail users actually complain about.',
      'Postgres computes percentiles with **ordered-set aggregates**: `percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)`. They are aggregates — they work with GROUP BY and collapse rows. The `WITHIN GROUP (ORDER BY …)` says which value to rank; the fraction is between 0 and 1 (0.95, not 95).',
      '`percentile_cont` **interpolates** between the two nearest values (the median of 45 and 47 is 46, a value that may not exist). `percentile_disc` returns an **actual** value — the first one whose cumulative share reaches the fraction (45). Use cont for metrics (latency, money), disc when the answer must be a real row or the type isn’t numeric (dates, text).',
      'Percentiles are **not additive**: the p95 of all traffic is not the average (or max) of per-endpoint p95s, and you can’t sum daily p95s into a monthly one. Recompute from raw rows — or keep a mergeable sketch (t-digest, histogram).',
    ],
    internals: [
      'An ordered-set aggregate must **sort the whole group** (or buffer it) before it can answer: O(n log n) and memory proportional to the group size, spilling to disk past `work_mem`. It has no partial/combine function, so it gets no parallel or partial aggregation.',
      'Postgres does not allow `percentile_cont(…) WITHIN GROUP (…) OVER (…)`. To put a group percentile next to every row, compute it in a GROUP BY CTE and join back (as in the worked example), or use window functions like `CUME_DIST()` / `PERCENT_RANK()` / `NTILE(100)` to place each row within its group.',
      'At scale, exact percentiles mean a global sort. Warehouses offer **approximate** ones with small mergeable sketches: BigQuery `APPROX_QUANTILES(x, 100)[OFFSET(95)]`, Snowflake `APPROX_PERCENTILE` (t-digest), Spark `percentile_approx`, Druid/ClickHouse quantile sketches. In Postgres, extensions such as `tdigest` provide the same. Error is typically well under 1% of rank.',
      'Monitoring systems (Prometheus, Datadog) store latency **histograms** (counts per bucket) because buckets *are* additive across servers and time; p95 is estimated from merged buckets at query time.',
    ],
    signals: ['median', 'p50 / p90 / p95 / p99', 'typical value', 'tail latency, SLO', 'skewed / outliers', 'quartiles, deciles'],
    template: `SELECT endpoint,
       percentile_cont(0.5)  WITHIN GROUP (ORDER BY latency_ms) AS p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_actual_value,
       percentile_cont(ARRAY[0.5, 0.9, 0.99]) WITHIN GROUP (ORDER BY latency_ms) AS several
FROM requests
GROUP BY endpoint;`,
    realWorld: [
      {
        title: 'Latency SLOs',
        body: '“p95 of checkout under 500 ms” is the classic SLO. The average can look fine while 1 request in 20 takes seconds — exactly the users who abandon the cart.',
      },
      {
        title: 'Compensation and pricing benchmarks',
        body: 'Median salary per role/level, median basket size per country: robust to a few executives or bulk B2B orders that would distort the mean.',
      },
      {
        title: 'Data-quality and anomaly thresholds',
        body: 'Flag rows above the p99 of their group (e.g. transaction amount per merchant) — computed per group in a CTE and joined back.',
      },
    ],
    mistakes: [
      {
        title: 'Reporting AVG as “typical”',
        why: 'One 1.2 s request lifts the /search average to 186 ms while the median is 46 ms.',
        fix: 'Report p50 and p95/p99 (and the average only alongside them).',
      },
      {
        title: 'Averaging percentiles',
        why: 'Percentiles of subgroups don’t combine: avg(p95 per endpoint) ≠ p95 of all requests.',
        fix: 'Recompute from raw rows, or store mergeable sketches/histograms.',
      },
      {
        title: 'Writing the fraction as a percent',
        why: '`percentile_cont(95)` → error: percentile value 95 is not between 0 and 1.',
        fix: '`percentile_cont(0.95)`.',
      },
      {
        title: 'Hand-rolled median picks one middle row',
        why: 'With an even count there are two middle rows; `rn = (n+1)/2` takes the lower one.',
        fix: 'Use percentile_cont(0.5), or average rn IN ((n+1)/2, (n+2)/2).',
      },
    ],
    worked: {
      question: 'Per endpoint, how do average, median and p95 latency compare — and where does each request sit in its endpoint’s distribution?',
      sql: `WITH stats AS (
  SELECT endpoint,
         ROUND(AVG(latency_ms), 1) AS avg_ms,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
         percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_disc,
         ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) AS p95_cont
  FROM requests
  GROUP BY endpoint
)
SELECT r.endpoint, r.id, r.latency_ms,
       CUME_DIST() OVER (PARTITION BY r.endpoint ORDER BY r.latency_ms) AS cume_dist,
       s.avg_ms, s.p50, s.p95_disc, s.p95_cont
FROM requests r
JOIN stats s ON s.endpoint = r.endpoint
ORDER BY r.endpoint, r.latency_ms`,
      notes: {
        cte: 'Ordered-set aggregates collapse each endpoint to one row. /search: avg 186.2 but p50 46. p95_disc = 1200 (a real request), p95_cont = 795 (interpolated between 300 and 1200).',
        join: 'Percentiles can’t be window functions in Postgres, so the per-endpoint stats are joined back to each request: 20 rows in, 20 out (one stats row per endpoint).',
        window:
          'CUME_DIST = share of the endpoint’s requests with latency ≤ this one. Hover /search: the 60 ms request is at 0.8 — 80% of requests are at or below it, yet still far below the average.',
      },
      predictions: [
        {
          stage: 'cte',
          kind: 'choice',
          question: '/search has 10 requests; sorted, the 5th and 6th are 45 and 47 ms. What is percentile_cont(0.5)?',
          options: ['45', '46', '47', '186.2'],
          answer: 1,
          explain: 'With an even count, percentile_cont interpolates halfway between the two middle values: 46. percentile_disc(0.5) would return 45.',
        },
        {
          stage: 'window',
          kind: 'choice',
          question: 'How many of the 10 /search requests are faster than the /search average (186.2 ms)?',
          options: ['5', '8', '9'],
          answer: 1,
          explain: 'Only the 300 ms and 1200 ms requests are above it. The average is pulled up by the tail — 80% of users see “better than average”.',
        },
      ],
      takeaway: 'Use ordered-set aggregates for medians and tail percentiles; cont interpolates, disc returns a real value. Join group stats back when you need them per row.',
    },
    build: {
      prompt:
        'An SLO report per endpoint: `endpoint`, number of `requests`, `avg_ms` (1 decimal), interpolated median `p50` and interpolated `p95` (rounded to 1 decimal). Worst p95 first.',
      blocks: [
        { slot: 'select', sql: 'endpoint', why: 'The group.' },
        { slot: 'select', sql: 'COUNT(*) AS requests', why: 'Sample size — percentiles from 10 requests are shaky.' },
        { slot: 'select', sql: 'ROUND(AVG(latency_ms), 1) AS avg_ms', why: 'Shown for contrast with the median.' },
        { slot: 'select', sql: 'percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50', why: 'The typical request.' },
        {
          slot: 'select',
          sql: 'ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) AS p95',
          why: 'The tail. percentile_cont returns double precision; cast to numeric to ROUND.',
        },
        { slot: 'from', sql: 'requests', why: 'One row per request.' },
        { slot: 'groupBy', sql: 'endpoint', why: 'One distribution per endpoint.' },
        { slot: 'orderBy', sql: 'p95 DESC', why: 'Worst tail first.' },
      ],
      traps: [
        {
          slot: 'select',
          sql: 'percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50',
          replaces: 'percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50',
          why: 'Discrete: returns the lower middle value (45, 199) instead of the interpolated median (46, 202).',
        },
        {
          slot: 'select',
          sql: 'ROUND(AVG(latency_ms), 1) AS p50',
          replaces: 'percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50',
          why: 'The mean is not the median: 186.2 vs 46 on /search.',
        },
        {
          slot: 'select',
          sql: 'ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms DESC)::numeric, 1) AS p95',
          replaces: 'ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) AS p95',
          why: 'Descending order flips the distribution: this is the 5th percentile, the fastest requests.',
        },
        {
          slot: 'select',
          sql: 'ROUND(percentile_cont(95) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) AS p95',
          replaces: 'ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) AS p95',
          why: 'Error: the fraction must be between 0 and 1.',
        },
        {
          slot: 'where',
          sql: 'latency_ms < 1000',
          why: '“Removing outliers” removes exactly the tail p95 is supposed to measure — the SLO suddenly looks great.',
        },
      ],
    },
    exercises: [
      {
        id: 'pc-latency-slo',
        kind: 'write',
        title: 'p50 / p95 / p99 per endpoint',
        difficulty: 'Easy',
        prompt:
          'Per endpoint return `p50`, `p95` and `p99` latency (interpolated, rounded to 1 decimal). Order by endpoint.',
        solution: `SELECT endpoint,
       ROUND(percentile_cont(0.5)  WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) AS p50,
       ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) AS p95,
       ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) AS p99
FROM requests
GROUP BY endpoint
ORDER BY endpoint`,
        hints: ['percentile_cont(fraction) WITHIN GROUP (ORDER BY col).', 'Cast to numeric before ROUND(…, 1).'],
        explanation:
          '/checkout: 202 / 1747.5 / 2269.5; /search: 46 / 795 / 1119. Shortcut: `percentile_cont(ARRAY[0.5,0.95,0.99]) WITHIN GROUP (…)` returns all three in one sort as an array.',
      },
      {
        id: 'pc-avg-of-p95',
        kind: 'fix-bug',
        title: 'Overall p95 from per-endpoint p95s',
        difficulty: 'Medium',
        prompt:
          'The platform team wants the p95 latency over **all** requests as `p95_ms` (rounded to 1 decimal). This query reuses the per-endpoint numbers and reports 1271.3. Fix it.',
        starter: `WITH per_endpoint AS (
  SELECT endpoint,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
  FROM requests
  GROUP BY endpoint
)
SELECT ROUND(AVG(p95)::numeric, 1) AS p95_ms
FROM per_endpoint`,
        solution: `SELECT ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric, 1) AS p95_ms
FROM requests`,
        hints: ['Is the average of two p95s a p95?', 'Compute the percentile over the raw rows.'],
        explanation:
          'Percentiles are not additive: the true p95 is 1260. With uneven traffic per endpoint the gap can be huge. Dashboards that roll up “p95 per server” by averaging are a classic bug; store histograms or sketches if you need to merge.',
      },
      {
        id: 'pc-median-by-hand',
        kind: 'write',
        title: 'Median without percentile_cont',
        difficulty: 'Hard',
        prompt:
          'Interview twist: compute the median latency per endpoint **using window functions only** (no percentile_cont/disc). Return `endpoint`, `median_ms` rounded to 1 decimal, ordered by endpoint.',
        solution: `WITH ranked AS (
  SELECT endpoint, latency_ms,
         ROW_NUMBER() OVER (PARTITION BY endpoint ORDER BY latency_ms) AS rn,
         COUNT(*) OVER (PARTITION BY endpoint) AS n
  FROM requests
)
SELECT endpoint, ROUND(AVG(latency_ms), 1) AS median_ms
FROM ranked
WHERE rn IN ((n + 1) / 2, (n + 2) / 2)
GROUP BY endpoint
ORDER BY endpoint`,
        hints: ['Number the rows per endpoint and count them.', 'For odd n the two expressions (n+1)/2 and (n+2)/2 pick the same row; for even n the two middle rows.'],
        explanation:
          'Integer division does the trick: n = 10 → rows 5 and 6, averaged (202 and 46); n = 9 → row 5 twice. This is the portable answer for engines without a median function — and a good way to show you understand what percentile_cont(0.5) does.',
      },
    ],
    judgment: [
      {
        id: 'pc-lower-middle',
        kind: 'spot-bug',
        title: 'Median order value per status',
        context: 'A legacy report computes the median order amount per status by hand. Finance’s spreadsheet says the paid median is 105.',
        sql: `WITH ranked AS (
  SELECT status, amount,
         ROW_NUMBER() OVER (PARTITION BY status ORDER BY amount) AS rn,
         COUNT(*) OVER (PARTITION BY status) AS n
  FROM orders
)
SELECT status, amount AS median
FROM ranked
WHERE rn = (n + 1) / 2
ORDER BY status`,
        bugLines: [7, 9],
        options: [
          {
            text: 'For an even count, (n + 1) / 2 picks only the lower middle row; the median is the average of both middle rows.',
            correct: true,
            why: 'Paid has 12 orders: row 6 is 80, rows 6–7 average to 105. Pending and refunded (2 each) are also wrong.',
          },
          { text: 'ROW_NUMBER should be RANK to handle ties.', why: 'Ties don’t change which values sit in the middle positions; ROW_NUMBER is right for positions.' },
          { text: 'COUNT(*) OVER should have ORDER BY amount.', why: 'With ORDER BY it would become a running count — n would be wrong.' },
          { text: '(n + 1) / 2 uses float division.', why: 'Both operands are integers (bigint): integer division.' },
        ],
        fixedSql: `SELECT status,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS median
FROM orders
GROUP BY status
ORDER BY status`,
        lesson: 'Use the built-in percentile_cont(0.5) when you can. If you must hand-roll a median, average the two middle rows for even counts.',
      },
    ],
    recall: [
      { q: 'percentile_cont vs percentile_disc?', a: 'cont interpolates between neighbours (may not be an actual value); disc returns the first actual value whose cumulative share reaches the fraction.' },
      { q: 'Can you use percentile_cont as a window function in Postgres?', a: 'No. Compute it per group in a CTE and join back, or use CUME_DIST/PERCENT_RANK/NTILE per row.' },
      { q: 'Why can’t you average per-server p95s into a global p95?', a: 'Percentiles aren’t additive; recompute from raw data or merge histograms/sketches (t-digest).' },
      { q: 'How do warehouses compute p95 on billions of rows?', a: 'Approximate sketches: APPROX_QUANTILES (BigQuery), APPROX_PERCENTILE (Snowflake), percentile_approx (Spark).' },
    ],
    transfer: [
      {
        id: 'pc-t-salary',
        scenario: 'HR wants each employee’s salary next to their department’s median salary and the difference.',
        approach: 'CTE: SELECT dept, percentile_cont(0.5) WITHIN GROUP (ORDER BY salary) AS med FROM employees GROUP BY dept; join back on dept; salary - med. (Engineering median 150000, Sales 110000.)',
      },
      {
        id: 'pc-t-daily-p95',
        scenario: 'You store a daily p95 latency per service and now need the monthly p95.',
        approach: 'You can’t derive it from daily p95s. Recompute over raw requests for the month, or store a mergeable t-digest / histogram per day and merge them (tdigest extension, APPROX sketches).',
      },
    ],
    confusable: ['ranking-functions', 'conditional-aggregation', 'running-totals-frames'],
  },
];
