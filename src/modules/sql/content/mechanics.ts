import type { Concept } from '../types';

/**
 * Track: Query mechanics.
 * Authoring rules (all content files): every SQL string runs against the seeded dataset
 * (see data/dataset.ts) and is checked by scripts/validate.ts. Prefer realistic business
 * questions, name the trap each piece avoids, and tie every concept to backend / DE work.
 */
export const mechanics: Concept[] = [
  {
    id: 'logical-order',
    track: 'mechanics',
    title: 'Logical query order (how SQL is really evaluated)',
    tagline: 'SQL is written SELECT-first but evaluated FROM-first — that one fact explains every “column does not exist”, WHERE-vs-HAVING and “can’t filter a window function” error.',
    level: 'core',
    minutes: 12,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      'You write `SELECT … FROM … WHERE … GROUP BY … HAVING … ORDER BY … LIMIT`, but the database evaluates it as **FROM/JOIN → WHERE → GROUP BY → HAVING → window functions → SELECT → DISTINCT → ORDER BY → LIMIT**. Each step only sees the rows the previous step produced.',
      'That explains the classic errors. A SELECT alias does not exist yet in WHERE (`column "revenue" does not exist`), but it does in ORDER BY, which runs after SELECT. An aggregate can’t appear in WHERE because the groups haven’t been formed yet — that is what HAVING is for.',
      'WHERE filters **rows** before grouping; HAVING filters **groups** after aggregation. `WHERE amount > 200` changes *what gets averaged*; `HAVING AVG(amount) > 200` changes *which averages you keep*. They answer different questions, and confusing them gives plausible but wrong numbers.',
      'Window functions run after HAVING, on the grouped rows: they can rank aggregates (`RANK() OVER (ORDER BY SUM(amount) DESC)`), but they can’t be filtered in WHERE or HAVING. Compute them in a subquery/CTE and filter outside.',
      'LIMIT is the very last step. It trims the final result; it does not mean “read only N rows”. `SELECT SUM(amount) … LIMIT 3` still sums every row and then returns the single result row.',
    ],
    internals: [
      'The order is **logical**, not physical. The planner may rewrite the query freely as long as the result is identical: it **pushes WHERE predicates down** into table scans (and through joins, into inlined subqueries/CTEs), turns `IN`/`EXISTS` into semi-joins, and even moves a HAVING condition that has no aggregate (e.g. `HAVING country = \'US\'`) down into WHERE so rows are filtered before grouping.',
      'Physically a plan is a tree of executor nodes pulling rows from their children (the iterator / Volcano model). Read EXPLAIN bottom-up and you see the logical order again: `Seq Scan`/`Index Scan` (with `Filter:` = your WHERE) → `Hash Join`/`Merge Join`/`Nested Loop` → `HashAggregate` or `Sort` + `GroupAggregate` (GROUP BY; HAVING shows up as a `Filter:` on the aggregate node) → `WindowAgg` (fed by a `Sort` on PARTITION BY + ORDER BY) → `Unique`/`HashAggregate` for DISTINCT → `Sort` → `Limit`.',
      '`Limit` over `Sort` becomes a **top-N heapsort** that keeps only N rows in memory; over an index scan that already returns rows in ORDER BY order it simply stops early. That is the only way LIMIT saves work — above an aggregate it saves nothing, because the aggregate must consume all its input first.',
      'Postgres extensions: GROUP BY (not WHERE/HAVING) may use SELECT aliases or ordinals (`GROUP BY 1`), and grouping by a table’s primary key lets you select its other columns (functional dependency). Warehouses differ: Snowflake even allows SELECT aliases in WHERE, and Snowflake, BigQuery and DuckDB support `QUALIFY` to filter window results directly. Code that relies on those fails when ported to Postgres.',
    ],
    signals: ['column "x" does not exist when using an alias', 'filter on an aggregate (total > N, at least N orders)', 'filter on a rank / row_number result', 'top N after grouping', 'condition about each row vs about each group'],
    template: `SELECT   country,                              -- 6 SELECT: aliases are born here
         SUM(amount) AS revenue,
         RANK() OVER (ORDER BY SUM(amount) DESC) AS rnk  -- 5 window: after HAVING
FROM     orders o JOIN users u ON u.id = o.user_id       -- 1 FROM / JOIN
WHERE    o.status = 'paid'                     -- 2 WHERE: rows, no aggregates, no aliases
GROUP BY country                               -- 3 GROUP BY
HAVING   COUNT(*) >= 2                         -- 4 HAVING: groups (aggregates OK)
ORDER BY revenue DESC                          -- 7 ORDER BY (after DISTINCT): aliases OK
LIMIT    10;                                   -- 8 LIMIT: last`,
    realWorld: [
      {
        title: 'Top-N per group in an API',
        body: '“Latest 3 reviews per product” needs `ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY created_at DESC)` and then `rn <= 3`. Because windows run after WHERE, the filter must live in an outer query. ORM code that tries to add `rn <= 3` to the same WHERE produces invalid SQL.',
      },
      {
        title: 'Porting SQL between engines',
        body: 'Queries written for Snowflake (`WHERE revenue > 100` using a SELECT alias, `QUALIFY rn = 1`) fail on Postgres. Writing in standard logical order — repeat the expression or wrap in a CTE — keeps SQL portable across your OLTP database and the warehouse.',
      },
      {
        title: 'Why LIMIT didn’t make the endpoint fast',
        body: 'A paginated endpoint does `GROUP BY customer … ORDER BY total DESC LIMIT 20`. LIMIT runs last, so every customer is still aggregated on every request. Fixes: pre-aggregate into a summary table, or restructure so an index can deliver rows already in ORDER BY order.',
      },
    ],
    mistakes: [
      {
        title: 'Using a SELECT alias in WHERE (or HAVING)',
        why: 'WHERE runs before SELECT, so the alias does not exist yet → `column "discounted" does not exist`. Postgres doesn’t allow aliases in HAVING either.',
        fix: 'Repeat the expression, or compute it in a subquery/CTE and filter in the outer query. ORDER BY can use the alias.',
      },
      {
        title: 'WHERE vs HAVING mixed up',
        why: '`WHERE amount > 200` keeps only big orders and then averages those — a different question from “customers whose average is above 200”. An aggregate in WHERE is simply an error.',
        fix: 'Ask: is this condition about one row (WHERE) or about a group (HAVING)?',
      },
      {
        title: 'Filtering a window function in the same query level',
        why: '`WHERE ROW_NUMBER() OVER (…) = 1` → “window functions are not allowed in WHERE”: windows are computed after WHERE, GROUP BY and HAVING.',
        fix: 'Compute the window in a subquery/CTE, filter `WHERE rn = 1` outside (QUALIFY in Snowflake/BigQuery/DuckDB).',
      },
      {
        title: 'Expecting LIMIT to limit the input',
        why: '`SELECT SUM(amount) FROM orders ORDER BY … LIMIT 3` aggregates all rows into one row, then limits that one row.',
        fix: 'Pick the N rows in a subquery (`ORDER BY amount DESC LIMIT 3`), aggregate outside.',
      },
    ],
    worked: {
      question: 'Which countries bring the most paid revenue? Only countries with at least 2 paid orders count; rank them and show the top 2.',
      sql: `SELECT u.country,
       COUNT(*) AS paid_orders,
       SUM(o.amount) AS revenue,
       RANK() OVER (ORDER BY SUM(o.amount) DESC) AS revenue_rank
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.status = 'paid'
GROUP BY u.country
HAVING COUNT(*) >= 2
ORDER BY revenue DESC
LIMIT 2`,
      notes: {
        from: 'Execution starts here, not at SELECT. Nothing called `revenue` or `revenue_rank` exists yet — that is why WHERE can’t mention them.',
        join: 'Guest order 16 has `user_id` NULL, so it finds no user and drops out: the guest’s revenue silently leaves a “per country” report.',
        where: '`o.status = \'paid\'` is about one row, so it belongs here: refunded and pending rows leave before any grouping work. `WHERE revenue > 500` would fail here — `revenue` is born in SELECT; `WHERE SUM(o.amount) > 500` would fail too — no groups exist yet.',
        group: 'Rows collapse to one per country. Eli has no country, so his order forms the NULL group.',
        having: '`COUNT(*) >= 2` is about a group, so it has to wait until groups exist. CN, DE and the NULL group (one paid order each) are removed.',
        window: 'RANK() runs after HAVING, so it ranks only the 3 surviving groups — and it can order by `SUM(o.amount)` because aggregates are already computed.',
        order: '`ORDER BY revenue` may use the alias because ORDER BY runs after SELECT.',
        limit: 'Last step: all 3 groups were fully aggregated and ranked, then one is thrown away. LIMIT saved no aggregation work.',
      },
      predictions: [
        {
          stage: 'join',
          kind: 'rowcount',
          question: '16 orders are inner-joined to users. One is a guest checkout with `user_id` NULL. How many rows come out of the join?',
          explain: '`u.id = NULL` is never true, so the guest order finds no partner and disappears → 15 rows.',
        },
        {
          stage: 'having',
          kind: 'rowcount',
          question: 'GROUP BY produced 6 country groups from the 11 paid rows. How many groups survive `HAVING COUNT(*) >= 2`?',
          explain: '3: AE (2 paid orders), IN (3) and US (3). CN, DE and the NULL-country group have one paid order each.',
        },
        {
          stage: 'window',
          kind: 'choice',
          question: 'Could you replace `LIMIT 2` with `WHERE revenue_rank <= 2` in this same query?',
          options: ['Yes — WHERE can see every column', 'No — WHERE runs before windows and SELECT, so revenue_rank doesn’t exist there yet', 'Only if written in HAVING instead', 'Yes, if you repeat the RANK() expression in WHERE'],
          answer: 1,
          explain: 'Window functions are computed after WHERE, GROUP BY and HAVING; Postgres rejects them in all three. Wrap the query: `SELECT * FROM (…) t WHERE revenue_rank <= 2` (which, unlike LIMIT, also keeps ties).',
        },
      ],
      takeaway: 'Read a query in evaluation order — FROM, WHERE, GROUP BY, HAVING, window, SELECT, DISTINCT, ORDER BY, LIMIT — and every “why can’t I use that here?” answers itself.',
    },
    build: {
      prompt: 'Customers with **at least 2 paid orders**: `name`, number of paid orders (`paid_orders`) and their average paid order rounded to 2 decimals (`avg_order`). Highest average first.',
      blocks: [
        { slot: 'select', sql: 'u.name', why: 'One output row per customer.' },
        { slot: 'select', sql: 'COUNT(*) AS paid_orders', why: 'After WHERE only paid rows remain, so COUNT(*) counts paid orders per group.' },
        { slot: 'select', sql: 'ROUND(AVG(o.amount), 2) AS avg_order', why: 'Aggregate computed once per group.' },
        { slot: 'from', sql: 'orders o', why: 'Start from the rows being measured.' },
        { slot: 'join', sql: 'JOIN users u ON u.id = o.user_id', why: 'Many-to-one lookup of the customer: no fan-out.' },
        { slot: 'where', sql: "o.status = 'paid'", why: 'A condition on each row → WHERE, so unpaid rows never reach the grouping (cheaper, index-friendly).' },
        { slot: 'groupBy', sql: 'u.id', why: 'Group by the key — names are not guaranteed unique…' },
        { slot: 'groupBy', sql: 'u.name', why: '…and by name so it can be selected.' },
        { slot: 'having', sql: 'COUNT(*) >= 2', why: 'A condition on the group → HAVING; the count only exists after GROUP BY.' },
        { slot: 'orderBy', sql: 'avg_order DESC', why: 'ORDER BY runs after SELECT, so the alias is visible here.' },
      ],
      traps: [
        {
          slot: 'where',
          sql: 'paid_orders >= 2',
          why: 'WHERE runs before GROUP BY and SELECT: neither the count nor its alias exists yet → column "paid_orders" does not exist.',
        },
        {
          slot: 'where',
          sql: 'COUNT(*) >= 2',
          why: 'Aggregates are not allowed in WHERE: WHERE decides which rows enter the groups, so it can’t depend on the groups.',
        },
        {
          slot: 'having',
          sql: "o.status = 'paid'",
          why: 'After GROUP BY individual rows are gone; o.status is not a group key, so HAVING can’t see it (“must appear in the GROUP BY clause”). Row conditions belong in WHERE.',
        },
        {
          slot: 'where',
          sql: 'o.amount > 100',
          why: 'A row filter changes what gets averaged: Asha’s 70 order disappears (her “average” jumps to 215) and Fatima now has only one paid order, so she drops out. If you meant “average above 100”, that is HAVING AVG(o.amount) > 100.',
        },
      ],
    },
    exercises: [
      {
        id: 'lo-big-spenders',
        kind: 'write',
        title: 'Customers above 400 in paid orders',
        difficulty: 'Easy',
        prompt: 'Customers whose **paid** orders total more than 400. Return `name` and `paid_total`, highest total first.',
        solution: `SELECT u.name,
       SUM(o.amount) AS paid_total
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE o.status = 'paid'
GROUP BY u.id, u.name
HAVING SUM(o.amount) > 400
ORDER BY paid_total DESC`,
        hints: ['“paid” is a condition on each order → WHERE. “total more than 400” is a condition on the group → HAVING.', 'Postgres doesn’t accept the alias paid_total in HAVING — repeat SUM(o.amount).'],
        explanation: 'WHERE removes unpaid rows before grouping; HAVING keeps groups whose sum exceeds 400 (Fatima 1680, Dana 1160, Asha 500, Chen 490). ORDER BY may use the alias because it runs after SELECT.',
      },
      {
        id: 'lo-alias-where',
        kind: 'fix-bug',
        title: 'Alias in WHERE',
        difficulty: 'Easy',
        prompt: 'List orders whose amount after a 10% discount is above 100: `id` and `discounted` (= amount × 0.9), largest first, ties by id. The query fails — fix it.',
        starter: `SELECT o.id, o.amount * 0.9 AS discounted
FROM orders o
WHERE discounted > 100
ORDER BY discounted DESC, o.id`,
        solution: `SELECT o.id, o.amount * 0.9 AS discounted
FROM orders o
WHERE o.amount * 0.9 > 100
ORDER BY discounted DESC, o.id`,
        hints: ['When is the alias `discounted` created, and when does WHERE run?', 'Repeat the expression in WHERE, or wrap the SELECT in a subquery and filter outside.'],
        explanation: 'WHERE is evaluated before SELECT, so the alias does not exist there; ORDER BY runs after SELECT and can use it. On a big table write the filter as `o.amount > 100 / 0.9` — a bare column compared with a constant can use an index on amount (see sargability).',
      },
      {
        id: 'lo-window-filter',
        kind: 'fix-bug',
        title: 'Orders above the customer’s average',
        difficulty: 'Medium',
        prompt: 'Find orders (any status) strictly above the average amount of **their customer’s** orders: `id`, `user_id`, `amount`, `user_avg` (rounded to 2 decimals). Order by id. The query errors — fix it.',
        starter: `SELECT o.id, o.user_id, o.amount,
       ROUND(AVG(o.amount) OVER (PARTITION BY o.user_id), 2) AS user_avg
FROM orders o
WHERE o.amount > AVG(o.amount) OVER (PARTITION BY o.user_id)
ORDER BY o.id`,
        solution: `SELECT id, user_id, amount, ROUND(user_avg, 2) AS user_avg
FROM (
  SELECT o.id, o.user_id, o.amount,
         AVG(o.amount) OVER (PARTITION BY o.user_id) AS user_avg
  FROM orders o
) t
WHERE amount > user_avg
ORDER BY id`,
        hints: ['Window functions are computed after WHERE.', 'Compute the window in a subquery (or CTE), then filter in the outer query.'],
        explanation: 'The inner query computes the per-customer average for every row; the outer WHERE then sees it as an ordinary column. Compare against the unrounded average and round only for display. The guest order forms its own partition (NULL user_id) and equals its own average, so it is excluded. Alternative: join to a GROUP BY user_id subquery of averages.',
      },
    ],
    judgment: [
      {
        id: 'lo-avg-where',
        kind: 'spot-bug',
        title: 'Premium invite: average order above 200',
        context: 'Marketing ticket: “List customers whose **average** paid order is above 200, for a premium-tier invite.” The analyst’s query returns 4 customers, including Asha.',
        sql: `SELECT u.name, ROUND(AVG(o.amount), 2) AS avg_order
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE o.status = 'paid'
  AND o.amount > 200
GROUP BY u.id, u.name
ORDER BY avg_order DESC`,
        bugLines: [5],
        options: [
          {
            text: 'The > 200 test runs on individual orders before grouping, so it averages only the big orders. It must be a group condition: HAVING AVG(o.amount) > 200.',
            correct: true,
            why: 'Asha’s paid orders are 130, 300 and 70 (avg 166.67). WHERE keeps only the 300, so she appears with an “average” of 300. Fatima’s 840 average is reported as 1600.',
          },
          { text: 'The status filter should be in HAVING.', why: 'status is a property of each row: WHERE is correct and cheaper. In HAVING it would be an error (not a group key).' },
          { text: 'ORDER BY can’t use the alias avg_order.', why: 'ORDER BY is evaluated after SELECT, so aliases are allowed there.' },
          { text: 'Grouping by both u.id and u.name double counts orders.', why: 'u.name is functionally dependent on u.id; the groups are identical to grouping by u.id alone.' },
        ],
        fixedSql: `SELECT u.name, ROUND(AVG(o.amount), 2) AS avg_order
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE o.status = 'paid'
GROUP BY u.id, u.name
HAVING AVG(o.amount) > 200
ORDER BY avg_order DESC`,
        lesson: 'Before writing a condition, ask whether it is about a row (WHERE) or about a group (HAVING). Moving it changes the question, not just the performance.',
      },
      {
        id: 'lo-limit-sum',
        kind: 'peer-review',
        title: 'PR: “revenue from our 3 biggest orders”',
        context: 'A PR adds a “whales” KPI: total revenue of the 3 largest paid orders. The author explains: “ORDER BY … DESC LIMIT 3 picks the top 3, then SUM adds them.”',
        sql: `SELECT SUM(amount) AS top3_revenue
FROM orders
WHERE status = 'paid'
ORDER BY SUM(amount) DESC
LIMIT 3`,
        bugLines: [4, 5],
        options: [
          {
            text: 'SUM collapses all paid orders into one row first; ORDER BY and LIMIT then act on that single row. This returns total paid revenue, not the top 3.',
            correct: true,
            why: 'Logical order: WHERE → aggregate → ORDER BY → LIMIT. The result is 3985 (all 12 paid orders) instead of 1600 + 680 + 490 = 2770.',
          },
          { text: 'It needs GROUP BY amount.', why: 'That would produce one row per distinct amount, still not a single sum of the top 3.' },
          { text: 'ORDER BY an aggregate is not allowed without GROUP BY.', why: 'It is allowed — the whole input is one group. It is just meaningless with one row.' },
          { text: 'The WHERE should be HAVING status = \'paid\'.', why: 'status is a row condition; in HAVING it would be an error.' },
        ],
        fixedSql: `SELECT SUM(amount) AS top3_revenue
FROM (
  SELECT amount
  FROM orders
  WHERE status = 'paid'
  ORDER BY amount DESC
  LIMIT 3
) top3`,
        lesson: 'LIMIT is the last step of a query level. To aggregate “the top N”, pick the N rows in a subquery first.',
      },
    ],
    recall: [
      { q: 'Logical evaluation order of a SELECT?', a: 'FROM/JOIN → WHERE → GROUP BY → HAVING → window functions → SELECT → DISTINCT → ORDER BY → LIMIT/OFFSET.' },
      { q: 'Why can ORDER BY use a SELECT alias but WHERE can’t?', a: 'ORDER BY runs after SELECT has created the alias; WHERE runs before SELECT.' },
      { q: 'WHERE vs HAVING?', a: 'WHERE filters rows before grouping (no aggregates); HAVING filters groups after aggregation (aggregates allowed).' },
      { q: 'How do you filter on ROW_NUMBER() in Postgres?', a: 'Compute it in a subquery/CTE and filter in the outer query; Postgres has no QUALIFY.' },
    ],
    transfer: [
      {
        id: 'lo-t-sellers',
        scenario: 'Sales ops wants sellers whose monthly revenue exceeded 10k in at least 3 months of 2024, ignoring cancelled orders.',
        approach: 'Rows: WHERE status <> cancelled AND date in 2024. Inner query: GROUP BY seller, month HAVING SUM(amount) > 10000. Outer query: GROUP BY seller HAVING COUNT(*) >= 3. Two levels of grouping = two stacked query levels.',
      },
      {
        id: 'lo-t-reviews',
        scenario: 'The product page needs the 5 most recent reviews with rating ≥ 4 for each product.',
        approach: 'rating ≥ 4 is a row filter (WHERE). ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY created_at DESC) in a subquery, outer WHERE rn <= 5 — a window can’t be filtered at its own level.',
      },
    ],
    confusable: ['conditional-aggregation', 'top-n-per-group', 'sargability'],
  },
  {
    id: 'joins-fanout',
    track: 'mechanics',
    title: 'Joins & row multiplication (fan-out)',
    tagline: 'A join produces one row per matching pair — so a one-to-many join silently multiplies rows and inflates every SUM after it.',
    level: 'core',
    minutes: 12,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      'A join is not "attach the other table’s columns". It produces **one output row per matching pair**. If a user matches 3 orders, that user now exists 3 times.',
      'That is exactly what you want for detail rows (one row per order). It is a bug the moment you then `SUM` a column that came from the **one** side: each value is counted once per match.',
      'Always know the grain of each table (one row per *what*?) and ask after every join: “what is one row now?” If the answer changed, every aggregate over the old grain is suspect.',
      'Fixes, in order of preference: aggregate the many side to the join key first (a CTE/subquery), use `EXISTS` when you only need to filter, or count `DISTINCT` keys when you only need a count.',
    ],
    internals: [
      'Postgres implements an equi-join as a **Hash Join** (hash the smaller input on the key, stream the larger and probe), a **Merge Join** (walk two key-sorted inputs together) or a **Nested Loop** (for each outer row, look up matches — fast with an index on the inner key). All three emit one row per matching pair, so the multiplication is semantic, not an implementation detail.',
      'The planner estimates join output as `rows(L) × rows(R) × selectivity`, where selectivity for `a.k = b.k` is about `1 / max(ndistinct(a.k), ndistinct(b.k))`. A badly wrong estimate here (EXPLAIN “rows=1” vs actual 50 000) is the classic cause of a nested loop that should have been a hash join.',
      'Pre-aggregating before the join is also faster: the grouped side is smaller, so the hash table is smaller and fewer rows flow upward.',
    ],
    signals: ['total / sum per X after joining a detail table', 'numbers look too high after adding a join', 'one row per X expected', 'orders with their items and payments'],
    template: `WITH item_totals AS (            -- 1. collapse the many side to the join key
  SELECT order_id, SUM(qty) AS units
  FROM order_items
  GROUP BY order_id
)
SELECT o.id, o.amount, t.units      -- 2. now the join is one-to-one
FROM orders o
JOIN item_totals t ON t.order_id = o.id;`,
    realWorld: [
      {
        title: 'Finance dashboard double counts revenue',
        body: 'Someone joins orders → order_items to filter by category and keeps `SUM(orders.amount)`. Revenue is now multiplied by the number of line items. Shipped dashboards with 2× revenue are a real, recurring incident.',
      },
      {
        title: 'ETL fact table at the wrong grain',
        body: 'A pipeline joins a fact (orders) to a dimension that is not unique on the key (e.g. a customer table with duplicate CDC rows). Row counts silently grow every run. Assert key uniqueness on dimensions before joining.',
      },
      {
        title: 'ORM N+1 vs JOIN',
        body: 'Replacing N+1 queries with one JOIN is right — but if you eager-load two independent has-many relations in one SQL join (items and payments), you get items × payments rows per order. ORMs split these into separate queries for that reason.',
      },
    ],
    mistakes: [
      {
        title: 'Summing a one-side column after a one-to-many join',
        why: '`SUM(o.amount)` after joining order_items counts each order once per line item.',
        fix: 'Aggregate the many side in a CTE first, or filter with `EXISTS` instead of joining.',
      },
      {
        title: 'Joining two independent many sides at once',
        why: 'orders → items (3) and orders → payments (2) gives 3 × 2 = 6 rows per order: both aggregates are wrong.',
        fix: 'Aggregate each child table to the order grain separately, then join the aggregates.',
      },
      {
        title: 'Hiding fan-out with DISTINCT',
        why: '`SELECT DISTINCT` after a fanning join makes the row count look right while `SUM`s are still inflated, and adds a sort/hash.',
        fix: 'Find which join changed the grain and fix it there.',
      },
      {
        title: '`COUNT(*)` when you meant “number of orders”',
        why: 'After a join, `COUNT(*)` counts joined rows, not orders.',
        fix: '`COUNT(DISTINCT o.id)` — or pre-aggregate.',
      },
    ],
    worked: {
      question: 'Finance wants paid revenue per customer. A colleague also joined order_items “to have the details”. What happens to the revenue?',
      sql: `SELECT u.name,
       COUNT(*) AS joined_rows,
       SUM(o.amount) AS naive_revenue
FROM users u
JOIN orders o ON o.user_id = u.id
JOIN order_items i ON i.order_id = o.id
WHERE o.status = 'paid'
GROUP BY u.id, u.name
ORDER BY naive_revenue DESC`,
      notes: {
        from: 'Grain: one row per user.',
        join: 'Watch the grain change: after orders it is one row per order; after order_items one row per line item. o.amount is now repeated on every line of its order.',
        group: 'Dana’s group has 4 rows but only 2 paid orders — each order amount is summed twice.',
      },
      predictions: [
        {
          stage: 'join',
          kind: 'rowcount',
          question: '10 users join 15 orders (two users have none). How many rows come out of `JOIN orders`?',
          explain: '8 users have orders; each appears once per order → 15 rows. The 2 users without orders vanish (inner join).',
        },
        {
          stage: 'group',
          kind: 'choice',
          question: 'Dana has two paid orders worth 680 + 480 = 1160. What will naive_revenue show for Dana?',
          options: ['1160', '2320', '680', '4 (the row count)'],
          answer: 1,
          explain: 'Each of Dana’s paid orders has 2 line items, so each amount is summed twice: 2 × 1160 = 2320.',
        },
      ],
      takeaway: 'After every join ask “what is one row now?”. Aggregate the many side to the join key before joining, or use EXISTS when you only filter.',
    },
    build: {
      prompt: 'Revenue per customer from **paid** orders, counting each order once, and keeping customers with no paid orders (revenue 0). Highest revenue first, then name.',
      blocks: [
        { slot: 'select', sql: 'u.name', why: 'The customer — one row per customer is the target grain.' },
        { slot: 'select', sql: 'COUNT(o.id) AS paid_orders', why: '`COUNT(column)` skips NULLs, so customers without orders get 0 (COUNT(*) would say 1).' },
        { slot: 'select', sql: 'COALESCE(SUM(o.amount), 0) AS revenue', why: 'SUM over no rows is NULL; COALESCE turns it into 0 for reporting.' },
        { slot: 'from', sql: 'users u', why: 'Start from the entity every output row is about.' },
        {
          slot: 'join',
          sql: "LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'paid'",
          why: 'LEFT keeps customers without orders; the status filter lives in ON so it can’t remove them.',
        },
        { slot: 'groupBy', sql: 'u.id', why: 'Group by the key (names are not unique)…' },
        { slot: 'groupBy', sql: 'u.name', why: '…and by name so it can be selected.' },
        { slot: 'orderBy', sql: 'revenue DESC', why: 'ORDER BY runs after SELECT, so it can use the alias.' },
        { slot: 'orderBy', sql: 'u.name', why: 'Tie-breaker: the four customers with revenue 0 come out in a stable order.' },
      ],
      traps: [
        {
          slot: 'join',
          sql: "JOIN orders o ON o.user_id = u.id AND o.status = 'paid'",
          replaces: "LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'paid'",
          why: 'An inner join drops customers with no paid orders — the report silently loses rows.',
        },
        {
          slot: 'join',
          sql: 'JOIN order_items i ON i.order_id = o.id',
          why: 'Fan-out: every order is repeated per line item, so SUM(o.amount) is inflated. You don’t need items for revenue.',
        },
        {
          slot: 'where',
          sql: "o.status = 'paid'",
          why: 'A WHERE on the outer-joined table is NULL for customers without orders and removes them — your LEFT JOIN becomes an inner join.',
        },
        {
          slot: 'select',
          sql: 'SUM(o.amount) AS revenue',
          replaces: 'COALESCE(SUM(o.amount), 0) AS revenue',
          why: 'SUM over zero rows is NULL, not 0 — and NULLs sort first with DESC.',
        },
        {
          slot: 'select',
          sql: 'COUNT(*) AS paid_orders',
          replaces: 'COUNT(o.id) AS paid_orders',
          why: 'COUNT(*) counts the NULL-extended row: customers with no orders would show 1.',
        },
      ],
    },
    exercises: [
      {
        id: 'jf-category-orders',
        kind: 'write',
        title: 'Orders and units per category',
        difficulty: 'Easy',
        prompt: 'For each product category return `category`, the number of **distinct orders** containing it (`orders`) and total units sold (`units`). Order by category.',
        solution: `SELECT p.category,
       COUNT(DISTINCT i.order_id) AS orders,
       SUM(i.qty) AS units
FROM order_items i
JOIN products p ON p.id = i.product_id
GROUP BY p.category
ORDER BY p.category`,
        hints: ['Start from order_items (one row per line) and look up the product.', 'An order can contain several products of the same category — count DISTINCT order ids.'],
        explanation: 'order_items → products is many-to-one (each line has one product), so the join does not fan out; but one order has several lines per category, so `COUNT(*)` would count lines. `COUNT(DISTINCT order_id)` counts orders.',
      },
      {
        id: 'jf-billed-collected',
        kind: 'fix-bug',
        title: 'Billed vs collected',
        difficulty: 'Medium',
        prompt: 'Finance wants, over all **paid** orders, the total billed (`billed` = sum of order amounts) and total collected (`collected` = sum of payments). The query below over-reports billed. Fix it.',
        starter: `SELECT SUM(o.amount) AS billed,
       SUM(p.amount) AS collected
FROM orders o
LEFT JOIN payments p ON p.order_id = o.id
WHERE o.status = 'paid'`,
        solution: `SELECT SUM(o.amount) AS billed,
       SUM(pay.collected) AS collected
FROM orders o
LEFT JOIN (
  SELECT order_id, SUM(amount) AS collected
  FROM payments
  GROUP BY order_id
) pay ON pay.order_id = o.id
WHERE o.status = 'paid'`,
        hints: ['Which orders have more than one payment row?', 'Collapse payments to one row per order before joining.'],
        explanation: 'Orders 2 and 8 were paid in two installments, so the join repeats their amount. Aggregating payments to the order grain first makes the join one-to-one, so both sums are right.',
      },
      {
        id: 'jf-user-activity',
        kind: 'write',
        title: 'Orders and distinct products per user',
        difficulty: 'Medium',
        prompt: 'For every user (including those who never ordered) return `name`, number of orders (`orders`) and number of distinct products they ever bought (`products`), ordered by user id.',
        solution: `SELECT u.name,
       COUNT(DISTINCT o.id) AS orders,
       COUNT(DISTINCT i.product_id) AS products
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
LEFT JOIN order_items i ON i.order_id = o.id
GROUP BY u.id, u.name
ORDER BY u.id`,
        hints: ['Two LEFT JOINs keep users with no orders.', 'After joining items, one row = one line item: count DISTINCT ids.'],
        explanation: 'Here fan-out is harmless because both measures are DISTINCT counts of keys. It would not be harmless for a SUM — that is when you pre-aggregate.',
      },
    ],
    judgment: [
      {
        id: 'jf-review-electronics',
        kind: 'peer-review',
        title: 'PR: “monthly revenue of orders with electronics”',
        context: 'A teammate’s PR for the growth dashboard: monthly revenue of paid orders that contain at least one electronics item. It passed review once already.',
        sql: `SELECT date_trunc('month', o.ordered_at)::date AS month,
       SUM(o.amount) AS revenue
FROM orders o
JOIN order_items i ON i.order_id = o.id
JOIN products p ON p.id = i.product_id
WHERE o.status = 'paid'
  AND p.category = 'electronics'
GROUP BY 1
ORDER BY 1`,
        bugLines: [4],
        options: [
          {
            text: 'Joining order_items repeats o.amount once per electronics line, inflating revenue; filter with EXISTS instead.',
            correct: true,
            why: 'Order 1 has a keyboard and a mouse: its 130 is counted twice. EXISTS keeps one row per order.',
          },
          { text: 'date_trunc should be applied in WHERE, not SELECT.', why: 'date_trunc in SELECT/GROUP BY is fine; it only shapes the month key.' },
          { text: 'GROUP BY 1 is ambiguous and groups by the wrong column.', why: 'Ordinal 1 refers to the first select item (month) — legal and correct here.' },
          { text: 'It should be a LEFT JOIN to keep orders without items.', why: 'Orders without electronics must be excluded, so an inner semantics is right; the issue is multiplicity.' },
        ],
        fixedSql: `SELECT date_trunc('month', o.ordered_at)::date AS month,
       SUM(o.amount) AS revenue
FROM orders o
WHERE o.status = 'paid'
  AND EXISTS (
    SELECT 1
    FROM order_items i
    JOIN products p ON p.id = i.product_id
    WHERE i.order_id = o.id
      AND p.category = 'electronics'
  )
GROUP BY 1
ORDER BY 1`,
        lesson: 'When a join is only there to filter, use EXISTS (a semi-join): it answers “is there at least one?” and never multiplies rows.',
      },
    ],
    recall: [
      { q: 'A user has 3 orders and each order has 2 items. How many rows does users ⋈ orders ⋈ order_items produce for that user?', a: '6 — one per (order, item) pair.' },
      { q: 'Why is `SUM(orders.amount)` wrong after joining order_items?', a: 'Each order’s amount is repeated once per line item, so it is summed multiple times.' },
      { q: 'Three ways to avoid fan-out when aggregating?', a: 'Pre-aggregate the many side to the join key; use EXISTS for filter-only joins; COUNT(DISTINCT key) for counts.' },
      { q: 'What is the “grain” of a table/result?', a: 'What one row represents (one order, one line item, one user-day). Joins can change it.' },
    ],
    transfer: [
      {
        id: 'jf-t-courses',
        scenario: 'An LMS has courses, enrollments (many per course) and reviews (many per course). Report per course: number of students and average rating.',
        approach: 'Aggregate enrollments per course and reviews per course in two separate CTEs, then join both to courses (LEFT). Joining both raw tables at once gives enrollments × reviews rows per course.',
      },
      {
        id: 'jf-t-tickets',
        scenario: 'Support wants total refund amount per agent; tickets have many messages and you joined messages to filter on “contains the word refund”.',
        approach: 'Filter tickets with EXISTS (SELECT 1 FROM messages m WHERE m.ticket_id = t.id AND m.body ILIKE \'%refund%\'), then SUM refunds per agent — no fan-out.',
      },
    ],
    confusable: ['semi-anti-joins', 'outer-join-filters', 'dedup-latest'],
  },
  {
    id: 'outer-join-filters',
    track: 'mechanics',
    title: 'Outer joins & where the filter goes',
    tagline: 'A condition on the optional side belongs in ON — in WHERE it deletes the NULL-extended rows and silently turns your LEFT JOIN into an INNER JOIN.',
    level: 'core',
    minutes: 12,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      'A LEFT JOIN keeps every row of the left table. When a left row has no match, it is kept **once** with every right-side column set to NULL — a **NULL-extended** row.',
      'ON decides **which right rows match**; it can never remove a left row. WHERE runs **after** the join and filters the combined rows — including the NULL-extended ones. A test like `o.ordered_at >= \'2024-03-01\'` is NULL on those rows, WHERE treats NULL like FALSE, and they vanish. You have written an inner join with extra steps.',
      'Rule of thumb: conditions on the **optional (right) table** go in ON; conditions on the **preserved (left) table** go in WHERE. A left-table condition in ON does not filter the left table at all — failing rows simply get no match.',
      'After a LEFT JOIN, count the optional side with `COUNT(o.id)` (skips NULLs) rather than `COUNT(*)` (counts the NULL-extended row as 1), and wrap sums in `COALESCE(…, 0)` because SUM over nothing is NULL.',
      'RIGHT JOIN is a LEFT JOIN with the tables swapped (most teams always write LEFT for readability). FULL OUTER JOIN keeps unmatched rows from **both** sides — the tool for reconciliation: only in source, only in target, in both.',
    ],
    internals: [
      'Outer joins use the same algorithms as inner joins: `Hash Left Join` / `Hash Right Join` (“Right” only means the planner chose to hash the preserved side), `Merge Left/Full Join`, `Nested Loop Left Join`. The executor remembers whether each preserved row found a match and emits the unmatched ones with NULLs. FULL JOIN needs a hash or merge join, so its condition must be a hashable/mergeable equality.',
      '**Outer-join reduction**: while planning, Postgres checks whether a WHERE condition is *strict* for the nullable side (it can’t be TRUE when those columns are NULL). If so, NULL-extended rows could never survive, so it converts the LEFT JOIN into a plain inner join — EXPLAIN shows `Hash Join`, not `Hash Left Join`. The planner is telling you what your query really means.',
      'Inner joins can be reordered freely; outer joins can’t, because `A LEFT JOIN (B JOIN C)` ≠ `(A LEFT JOIN B) JOIN C`. That also explains a common bug: `users LEFT JOIN orders … JOIN order_items …` — the later inner join rejects the NULL-extended rows the LEFT JOIN kept.',
      'Placement also drives pushdown: a right-table condition in ON is pushed into the scan of the right table (fewer rows to hash), a left-table condition in WHERE is pushed into the scan of the left table. Same cheap filtering, different meaning — so choose by meaning first.',
    ],
    signals: ['including customers with no orders / zero', 'for every X, even if it has none', 'count per X where some X have nothing', 'reconcile / compare two sources', 'which keys are missing on either side'],
    template: `SELECT u.id,
       COUNT(o.id)                AS orders,      -- not COUNT(*)
       COALESCE(SUM(o.amount), 0) AS spend        -- SUM of nothing is NULL
FROM users u                                      -- preserved side
LEFT JOIN orders o
       ON o.user_id = u.id
      AND o.status = 'paid'                       -- optional-side filter: ON
WHERE u.plan = 'pro'                              -- preserved-side filter: WHERE
GROUP BY u.id;`,
    realWorld: [
      {
        title: 'The zeros vanish from the dashboard',
        body: 'A “sign-ups and their first-week orders” chart filters orders in WHERE. Every sign-up without an order disappears, so conversion looks like 100%. It survives review because the SQL “looks right” — check row counts against the base table.',
      },
      {
        title: 'Reconciliation and CDC diffs with FULL OUTER JOIN',
        body: 'Comparing source vs warehouse, or yesterday’s snapshot vs today’s, by key: FULL JOIN classifies rows as inserted (only new), deleted (only old) or possibly changed (both — compare with IS DISTINCT FROM). It is the core of data-diff and audit jobs.',
      },
      {
        title: 'ORM “include with condition”',
        body: 'Eager-loading parents with a filtered child relation can put the child condition in WHERE and drop parents without matching children. Use a join-level condition (Django `FilteredRelation`, JPQL `JOIN … ON`) when parents must stay.',
      },
    ],
    mistakes: [
      {
        title: 'Filtering the optional table in WHERE',
        why: 'NULL-extended rows fail the test (NULL ≠ TRUE) and are removed: the outer join becomes an inner join.',
        fix: 'Move the condition into the ON clause of that join.',
      },
      {
        title: 'Filtering the preserved table in ON',
        why: '`LEFT JOIN orders o ON o.user_id = u.id AND u.country = \'US\'` still returns every user; non-US users just get no matches.',
        fix: 'Conditions that should remove left rows go in WHERE.',
      },
      {
        title: 'COUNT(*) after a LEFT JOIN',
        why: 'The NULL-extended row is a row: users with zero orders show 1.',
        fix: 'Count a column of the optional table (its key): `COUNT(o.id)`.',
      },
      {
        title: 'An inner join after a left join',
        why: '`LEFT JOIN orders o … JOIN order_items i ON i.order_id = o.id` removes users without orders again, and a filtered `LEFT JOIN orders` after a plain `LEFT JOIN order_items` keeps items of non-matching orders.',
        fix: 'Join the optional chain as a unit — `LEFT JOIN (order_items i JOIN orders o ON …) ON …` — or pre-aggregate it in a subquery.',
      },
    ],
    worked: {
      question: 'Growth wants the number of **March** orders for **every** user (zeros included) to find inactive ones. The analyst LEFT JOINed orders and filtered March in WHERE. Who is left?',
      sql: `SELECT u.name,
       COUNT(o.id) AS march_orders,
       COALESCE(SUM(o.amount), 0) AS march_spend
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.ordered_at >= '2024-03-01'
GROUP BY u.id, u.name
ORDER BY march_spend DESC, u.name`,
      notes: {
        from: 'Target grain: one row per user — 10 users, and the report must keep all 10.',
        join: 'So far so good: Ivan and Jo (no orders at all) are kept as NULL-extended rows.',
        where: 'Here the LEFT JOIN is undone. Pre-March orders are FALSE and the NULL-extended rows are NULL — both are dropped. Ben, Chen and Eli lose all their (older) orders, Ivan and Jo lose their NULL row: every user without a March order is gone.',
        group: 'Only 5 users remain — exactly the opposite of the inactive users Growth asked for.',
        order: 'COALESCE(…, 0) never gets to produce a 0: the zero rows were deleted two stages earlier. Fix: `LEFT JOIN orders o ON o.user_id = u.id AND o.ordered_at >= \'2024-03-01\'` and no WHERE.',
      },
      predictions: [
        {
          stage: 'join',
          kind: 'rowcount',
          question: '10 users LEFT JOIN 16 orders. The guest order has no user; Ivan and Jo have no orders. How many rows come out?',
          explain: '15 orders belong to 8 users, plus 2 NULL-extended rows for Ivan and Jo = 17. The guest order has no left partner, and LEFT JOIN only preserves the left side.',
        },
        {
          stage: 'where',
          kind: 'rowcount',
          question: 'How many rows survive `WHERE o.ordered_at >= \'2024-03-01\'`?',
          explain: 'Only the 6 March orders that belong to users (orders 8, 11, 12, 13, 14, 15). The 9 earlier orders are FALSE, the 2 NULL-extended rows are NULL — all dropped.',
        },
        {
          stage: 'group',
          kind: 'choice',
          question: 'How many of the 10 users appear in the final report?',
          options: ['10', '8', '5', '2'],
          answer: 2,
          explain: '5: Asha, Dana, Fatima, Goran and Hana. With the date moved into ON, all 10 appear and Ben, Chen, Eli, Ivan and Jo show 0.',
        },
      ],
      takeaway: 'Filters on the optional side of an outer join go in ON; in WHERE they delete the NULL-extended rows and silently convert the join to INNER.',
    },
    build: {
      prompt: 'For every user who signed up **before March 2024**: `name`, number of **March** orders (`march_orders`) and March spend (`march_spend`, 0 if none). Keep users with no March orders. Highest spend first, then name.',
      blocks: [
        { slot: 'select', sql: 'u.name', why: 'One row per user.' },
        { slot: 'select', sql: 'COUNT(o.id) AS march_orders', why: 'Counts only real matches: NULL-extended rows contribute 0.' },
        { slot: 'select', sql: 'COALESCE(SUM(o.amount), 0) AS march_spend', why: 'SUM over no matches is NULL; report 0.' },
        { slot: 'from', sql: 'users u', why: 'The preserved side: every output row is a user.' },
        {
          slot: 'join',
          sql: "LEFT JOIN orders o ON o.user_id = u.id AND o.ordered_at >= '2024-03-01'",
          why: 'The March condition is about the optional side, so it lives in ON: it limits which orders match without removing users.',
        },
        { slot: 'where', sql: "u.signup_date < '2024-03-01'", why: 'A condition on the preserved table: in WHERE it really removes users (in ON it would only stop them from matching).' },
        { slot: 'groupBy', sql: 'u.id', why: 'Group by the key…' },
        { slot: 'groupBy', sql: 'u.name', why: '…and the name to select it.' },
        { slot: 'orderBy', sql: 'march_spend DESC', why: 'Biggest spenders first (alias is visible in ORDER BY).' },
        { slot: 'orderBy', sql: 'u.name', why: 'Tie-breaker for the three users with 0.' },
      ],
      traps: [
        {
          slot: 'where',
          sql: "o.ordered_at >= '2024-03-01'",
          why: 'A WHERE on the optional table rejects the NULL-extended rows (and older orders): Ben, Chen and Eli disappear — the LEFT JOIN is now an inner join.',
        },
        {
          slot: 'select',
          sql: 'COUNT(*) AS march_orders',
          replaces: 'COUNT(o.id) AS march_orders',
          why: 'COUNT(*) counts the NULL-extended row: users with no March order show 1.',
        },
        {
          slot: 'join',
          sql: "JOIN orders o ON o.user_id = u.id AND o.ordered_at >= '2024-03-01'",
          replaces: "LEFT JOIN orders o ON o.user_id = u.id AND o.ordered_at >= '2024-03-01'",
          why: 'An inner join keeps only users with a March order — the zero rows are lost.',
        },
        {
          slot: 'join',
          sql: "RIGHT JOIN orders o ON o.user_id = u.id AND o.ordered_at >= '2024-03-01'",
          replaces: "LEFT JOIN orders o ON o.user_id = u.id AND o.ordered_at >= '2024-03-01'",
          why: 'RIGHT JOIN preserves orders, not users: non-March orders become rows with a NULL user (removed again by the WHERE on u) and users without March orders vanish.',
        },
        {
          slot: 'select',
          sql: 'SUM(o.amount) AS march_spend',
          replaces: 'COALESCE(SUM(o.amount), 0) AS march_spend',
          why: 'SUM over zero matches is NULL, not 0 — and NULLs sort first with DESC.',
        },
      ],
    },
    exercises: [
      {
        id: 'ojf-us-users',
        kind: 'fix-bug',
        title: 'Orders of US users',
        difficulty: 'Easy',
        prompt: 'Order count for every **US** user, including US users with no orders: `name`, `orders`, ordered by name. The query returns all 10 users — fix it.',
        starter: `SELECT u.name, COUNT(o.id) AS orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id AND u.country = 'US'
GROUP BY u.id, u.name
ORDER BY u.name`,
        solution: `SELECT u.name, COUNT(o.id) AS orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.country = 'US'
GROUP BY u.id, u.name
ORDER BY u.name`,
        hints: ['Can a condition in the ON clause of a LEFT JOIN ever remove a left row?', 'Conditions on the preserved table belong in WHERE.'],
        explanation: 'In ON, `u.country = \'US\'` only prevents non-US users from matching orders; LEFT JOIN still returns them with 0. In WHERE it removes them. Result: Ben 2, Dana 3, Jo 0.',
      },
      {
        id: 'ojf-feed-diff',
        kind: 'write',
        title: 'Diff the CDC feed against users',
        difficulty: 'Medium',
        prompt: 'Compare `staging_users` with `users` by **lower-cased email** (the feed contains duplicates and mixed case). Return `status` and `emails` (number of distinct emails), where status is `new` (only in the feed), `not_in_feed` (only in users) or `in_both`. Order by status.',
        solution: `WITH feed AS (
  SELECT DISTINCT lower(email) AS email
  FROM staging_users
)
SELECT CASE
         WHEN u.id IS NULL THEN 'new'
         WHEN f.email IS NULL THEN 'not_in_feed'
         ELSE 'in_both'
       END AS status,
       COUNT(*) AS emails
FROM feed f
FULL JOIN users u ON u.email = f.email
GROUP BY 1
ORDER BY 1`,
        hints: ['Normalise and de-duplicate the feed in a CTE first, otherwise duplicates multiply the join.', 'FULL JOIN keeps unmatched rows from both sides; classify by which side is NULL.'],
        explanation: 'FULL OUTER JOIN is the reconciliation join: kim and lea are new, eli and ivan exist on both sides, the other 8 users are not in this feed. Testing the side’s key (`u.id IS NULL`) is reliable because keys are never NULL in a matched row.',
      },
      {
        id: 'ojf-product-units',
        kind: 'write',
        title: 'Units sold per product (paid only)',
        difficulty: 'Hard',
        prompt: 'For **every** product (including never-sold ones), the total units sold in **paid** orders: `name`, `units` (0 if none). Order by units desc, then name.',
        solution: `SELECT p.name,
       COALESCE(SUM(i.qty), 0) AS units
FROM products p
LEFT JOIN (order_items i
           JOIN orders o ON o.id = i.order_id AND o.status = 'paid')
       ON i.product_id = p.id
GROUP BY p.id, p.name
ORDER BY units DESC, p.name`,
        hints: ['products → order_items → orders: the paid filter is two joins away from the preserved table.', '`LEFT JOIN order_items … LEFT JOIN orders o ON … AND o.status = \'paid\'` keeps the item rows of unpaid orders (only o becomes NULL), so SUM(i.qty) still counts them.'],
        explanation: 'The parenthesised join builds “items of paid orders” first and outer-joins that unit to products, so unpaid items never match. The naive chain reports 22 Notebooks instead of 12 (it counts the pending order of 10). Alternatives: `SUM(i.qty) FILTER (WHERE o.id IS NOT NULL)`, or pre-aggregate paid units per product in a subquery and LEFT JOIN it.',
      },
    ],
    judgment: [
      {
        id: 'ojf-card-total',
        kind: 'spot-bug',
        title: 'Card payments per customer',
        context: 'Finance ticket: “Card payments collected per customer — list **every** customer, 0 if they never paid by card.” The query returns only 5 of the 10 customers.',
        sql: `SELECT u.name,
       COALESCE(SUM(p.amount), 0) AS card_total
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
LEFT JOIN payments p ON p.order_id = o.id
WHERE p.method = 'card'
GROUP BY u.id, u.name
ORDER BY card_total DESC, u.name`,
        bugLines: [6],
        options: [
          {
            text: 'The card filter in WHERE rejects NULL-extended payment rows (and non-card ones), so customers without card payments disappear. It belongs in the payments ON clause.',
            correct: true,
            why: 'Eli and Goran paid by giftcard/paypal, Hana has no payment, Ivan and Jo have no orders: their rows are NULL or non-card and WHERE removes them.',
          },
          { text: 'COALESCE should wrap p.amount inside SUM.', why: 'It changes nothing: the rows were already removed before aggregation.' },
          { text: 'The joins should be inner joins.', why: 'That removes the same customers deliberately — the opposite of “every customer”.' },
          { text: 'p.method must be added to GROUP BY.', why: 'It isn’t selected; adding it would split customers by method, not bring them back.' },
        ],
        fixedSql: `SELECT u.name,
       COALESCE(SUM(p.amount), 0) AS card_total
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
LEFT JOIN payments p ON p.order_id = o.id AND p.method = 'card'
GROUP BY u.id, u.name
ORDER BY card_total DESC, u.name`,
        lesson: 'Every filter on an outer-joined table must sit in that join’s ON clause — otherwise “every customer” quietly becomes “customers that match”.',
      },
      {
        id: 'ojf-avg-orders',
        kind: 'peer-review',
        title: 'PR: average orders per registered user',
        context: 'A PR adds the KPI “average orders per registered user”. The author notes: “LEFT JOIN, so users without orders count as zero.”',
        sql: `WITH per_user AS (
  SELECT u.id, COUNT(*) AS orders
  FROM users u
  LEFT JOIN orders o ON o.user_id = u.id
  GROUP BY u.id
)
SELECT ROUND(AVG(orders), 2) AS avg_orders_per_user
FROM per_user`,
        bugLines: [2],
        options: [
          {
            text: 'COUNT(*) counts the NULL-extended row, so users without orders count as 1, not 0. Use COUNT(o.id).',
            correct: true,
            why: 'Ivan and Jo each contribute 1: the KPI is 17 / 10 = 1.70 instead of 15 / 10 = 1.50.',
          },
          { text: 'AVG ignores users with zero orders.', why: 'AVG ignores NULLs, not zeros — and here the counts are never NULL.' },
          { text: 'The guest order should be joined with a FULL JOIN.', why: 'Guest orders belong to no registered user; excluding them is correct for this KPI.' },
          { text: 'GROUP BY u.id is not enough; it needs all user columns.', why: 'Only u.id is selected; grouping by the key is fine.' },
        ],
        fixedSql: `WITH per_user AS (
  SELECT u.id, COUNT(o.id) AS orders
  FROM users u
  LEFT JOIN orders o ON o.user_id = u.id
  GROUP BY u.id
)
SELECT ROUND(AVG(orders), 2) AS avg_orders_per_user
FROM per_user`,
        lesson: 'After an outer join, count a column of the optional table; COUNT(*) turns every “none” into “one”.',
      },
    ],
    recall: [
      { q: 'Where does a filter on the right table of a LEFT JOIN go, and why?', a: 'In ON: in WHERE it is NULL for NULL-extended rows, which are dropped, turning the join into an inner join.' },
      { q: 'What does a left-table condition in the ON clause of a LEFT JOIN do?', a: 'It doesn’t remove left rows; rows failing it just get no match (NULL-extended). Put it in WHERE to filter.' },
      { q: 'COUNT(*) vs COUNT(o.id) after a LEFT JOIN?', a: 'COUNT(*) counts the NULL-extended row (no orders → 1); COUNT(o.id) skips NULLs (no orders → 0).' },
      { q: 'When do you need FULL OUTER JOIN?', a: 'When unmatched rows from both sides matter: reconciliation, diffs between two sources or snapshots.' },
    ],
    transfer: [
      {
        id: 'ojf-t-onboarding',
        scenario: 'Product wants, for every trial account created last month, whether it created a project within its first 7 days, and the overall activation rate.',
        approach: 'accounts a LEFT JOIN projects p ON p.account_id = a.id AND p.created_at < a.created_at + interval \'7 days\' (time window in ON); WHERE a.created_at in last month; per account COUNT(p.id) > 0, then AVG over accounts.',
      },
      {
        id: 'ojf-t-inventory',
        scenario: 'Warehouses A and B each export SKU stock levels. List SKUs missing from either side or whose quantities differ.',
        approach: 'a FULL JOIN b ON a.sku = b.sku WHERE a.sku IS NULL OR b.sku IS NULL OR a.qty IS DISTINCT FROM b.qty; COALESCE(a.sku, b.sku) as the key.',
      },
    ],
    confusable: ['semi-anti-joins', 'joins-fanout', 'null-semantics'],
  },
  {
    id: 'semi-anti-joins',
    track: 'mechanics',
    title: 'Semi-joins & anti-joins (EXISTS, IN, NOT EXISTS)',
    tagline: '“Has at least one” and “has none” are filters, not joins: EXISTS never multiplies rows, and NOT IN breaks the moment its subquery returns a NULL.',
    level: 'intermediate',
    minutes: 14,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      'A **semi-join** returns each left row **once** if at least one match exists; an **anti-join** returns it if **no** match exists. Neither adds columns from the other table — they are filters.',
      'Write semi-joins as `EXISTS (SELECT 1 FROM … WHERE inner.key = outer.key)` or `key IN (SELECT …)`. Unlike JOIN, a customer with 10 matching orders still comes out once: no fan-out, no DISTINCT needed.',
      'Write anti-joins as `NOT EXISTS` or `LEFT JOIN … WHERE right.key IS NULL`. Avoid `NOT IN (subquery)`: `x NOT IN (1, 2, NULL)` means `x <> 1 AND x <> 2 AND x <> NULL`, and `x <> NULL` is NULL — so the test is never TRUE and the query silently returns **nothing**.',
      'In our data one guest order has `user_id` NULL, so `u.id NOT IN (SELECT user_id FROM orders)` returns zero users while `NOT EXISTS` finds the right ones. Nullable foreign keys — guest checkouts, optional referrers, soft links — are exactly where this bites.',
      '“For all” questions (“orders where **every** item is electronics”) are double negations: there is **no** item that is **not** electronics → `NOT EXISTS (… AND category <> \'electronics\')`.',
    ],
    internals: [
      'The planner turns `EXISTS` and `IN (subquery)` into a **semi-join**: `Hash Semi Join` (hash one side, stop probing at the first hit), `Merge Semi Join`, or `Nested Loop Semi Join` (one index probe per outer row that stops at the first match). `NOT EXISTS` becomes `Hash Anti Join` / `Nested Loop Anti Join`. A correlated EXISTS is **not** re-run per row in modern Postgres — it is flattened into a join.',
      '`NOT IN (subquery)` can’t become an anti-join because its NULL semantics differ. Postgres evaluates it as a **hashed SubPlan** (hash the subquery result, probe per row, track whether a NULL was seen) or — if the result doesn’t fit in work_mem — a plain SubPlan rescanned for every outer row: O(n × m). It is a correctness trap and a performance trap.',
      '`LEFT JOIN r … WHERE r.key IS NULL` is also recognised as an anti-join when the IS NULL test is on a column the join condition forces to be non-NULL (e.g. the join key). It is equivalent to NOT EXISTS; NOT EXISTS states intent more clearly and can’t fan out if someone later selects columns from r.',
      'Semi-join vs `JOIN` + `DISTINCT`: the join materialises every matching pair and then de-duplicates them with a sort or hash over the whole joined set; the semi-join emits each outer row at most once and never builds the pairs. On big one-to-many tables that is the difference between de-duplicating millions of rows and none.',
    ],
    signals: ['customers who have / have never …', 'at least one matching', 'no matching / missing / without any', 'every item is … (for all)', 'exclude anything that appears in another table'],
    template: `-- semi-join: users with at least one paid order (each user once)
SELECT u.*
FROM users u
WHERE EXISTS (SELECT 1 FROM orders o
              WHERE o.user_id = u.id AND o.status = 'paid');

-- anti-join: users with no orders (NULL-safe, unlike NOT IN)
SELECT u.*
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);`,
    realWorld: [
      {
        title: 'Suppression lists and win-back campaigns',
        body: '“Bought in 2023 but not in 2024”, “emails not in the unsubscribe table”. One NULL in the unsubscribe table plus NOT IN produces an empty campaign — or, with inverted logic, mails people who opted out. NOT EXISTS is the safe default.',
      },
      {
        title: 'Incremental ETL loads',
        body: 'Insert only new keys: `INSERT INTO target SELECT … FROM staging s WHERE NOT EXISTS (SELECT 1 FROM target t WHERE t.id = s.id)` — an anti-join (or `ON CONFLICT DO NOTHING` with a unique key). Warehouses apply the same NULL rules to NOT IN, so the trap travels with your SQL.',
      },
      {
        title: 'Authorization filters in APIs',
        body: '“Projects the user can see” = EXISTS a membership row. A JOIN on memberships duplicates a project when the user holds two roles on it, and page sizes / total counts go wrong.',
      },
    ],
    mistakes: [
      {
        title: 'NOT IN over a nullable column',
        why: 'A single NULL in the subquery makes `x NOT IN (…)` NULL for every non-matching x: zero rows, no error.',
        fix: 'Use NOT EXISTS (or add `WHERE col IS NOT NULL` inside the subquery if you must keep NOT IN).',
      },
      {
        title: 'JOIN + DISTINCT as an existence filter',
        why: 'Fans out to one row per match, then pays a sort/hash to undo it — and the duplicates leak into any SUM.',
        fix: 'EXISTS: one row per outer row by construction.',
      },
      {
        title: 'Forgetting to correlate the subquery',
        why: '`EXISTS (SELECT 1 FROM orders WHERE status = \'paid\')` has no link to the outer row: it is TRUE for every user or for none.',
        fix: 'Always tie the subquery to the outer row: `WHERE o.user_id = u.id`.',
      },
      {
        title: '“Has an old X” instead of “has no new X”',
        why: '`EXISTS (… ordered_at < \'2024-03-01\')` is not the same as `NOT EXISTS (… ordered_at >= \'2024-03-01\')`: users who ordered in both periods pass the first.',
        fix: 'Translate “no … since” literally into NOT EXISTS.',
      },
    ],
    worked: {
      question: 'Lifecycle wants a first-purchase coupon for users with **no paid order**. We compute it with NOT EXISTS and show, side by side, what NOT IN would have said.',
      sql: `SELECT u.id,
       u.name,
       EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id) AS has_any_order,
       u.id NOT IN (SELECT o.user_id FROM orders o WHERE o.status = 'paid') AS not_in_paid
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM orders o
  WHERE o.user_id = u.id
    AND o.status = 'paid'
)
ORDER BY u.id`,
      notes: {
        from: '10 users. The subqueries read orders, which contains guest order 16 with `user_id` NULL.',
        where: 'NOT EXISTS asks each user “is there a paid order with my id?” — always TRUE or FALSE, never NULL. Postgres runs it as a Hash Anti Join, not as a loop of subqueries. No user can appear twice, however many orders they have.',
        select: '`not_in_paid` is NULL for all three survivors: the paid user_ids include NULL (the guest order), so “9 <> NULL” is unknown. Had NOT IN been the WHERE condition, the coupon list would be empty. `has_any_order` shows Hana does have an order — just not a paid one.',
      },
      predictions: [
        {
          stage: 'where',
          kind: 'rowcount',
          question: 'How many users have no paid order?',
          explain: '3: Hana (her only order was refunded), Ivan and Jo (never ordered). Everyone else has at least one paid order.',
        },
        {
          stage: 'select',
          kind: 'choice',
          question: 'For Ivan (never ordered), what is `u.id NOT IN (SELECT o.user_id FROM orders o WHERE o.status = \'paid\')`?',
          options: ['TRUE — 9 is not in the list', 'FALSE', 'NULL', 'An error, because the subquery returns a NULL'],
          answer: 2,
          explain: 'The list contains NULL (guest order 16 is paid). `9 NOT IN (1, 2, …, NULL)` = `9 <> 1 AND … AND 9 <> NULL` = TRUE AND … AND NULL = NULL. WHERE would drop Ivan.',
        },
      ],
      takeaway: 'Use EXISTS / NOT EXISTS for “has some” / “has none”: they never fan out and never trip over NULLs. NOT IN on a nullable column silently returns nothing.',
    },
    build: {
      prompt: 'Win-back list: customers (`id`, `name`) with **at least one paid order** who have placed **no order at all since 2024-03-01**. Each customer once, ordered by id.',
      blocks: [
        { slot: 'select', sql: 'u.id', why: 'Customer key.' },
        { slot: 'select', sql: 'u.name', why: 'Customer name.' },
        { slot: 'from', sql: 'users u', why: 'Output grain: one row per user — no join needed, both conditions are filters.' },
        {
          slot: 'where',
          sql: "EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status = 'paid')",
          why: 'Semi-join: at least one paid order; a user with 3 paid orders still appears once.',
        },
        {
          slot: 'where',
          sql: "NOT EXISTS (SELECT 1 FROM orders r WHERE r.user_id = u.id AND r.ordered_at >= '2024-03-01')",
          why: 'Anti-join: no order of any status since March 1. NULL-safe.',
        },
        { slot: 'orderBy', sql: 'u.id', why: 'Stable output order.' },
      ],
      traps: [
        {
          slot: 'where',
          sql: "u.id NOT IN (SELECT user_id FROM orders WHERE ordered_at >= '2024-03-01')",
          replaces: "NOT EXISTS (SELECT 1 FROM orders r WHERE r.user_id = u.id AND r.ordered_at >= '2024-03-01')",
          why: 'The guest order (user_id NULL) was placed in March, so the list contains NULL and NOT IN is never TRUE: the result is empty.',
        },
        {
          slot: 'join',
          sql: 'JOIN orders o ON o.user_id = u.id',
          why: 'A join for a filter fans out: Ben has two orders, so he now appears twice.',
        },
        {
          slot: 'where',
          sql: "NOT EXISTS (SELECT 1 FROM orders r WHERE r.ordered_at >= '2024-03-01')",
          replaces: "NOT EXISTS (SELECT 1 FROM orders r WHERE r.user_id = u.id AND r.ordered_at >= '2024-03-01')",
          why: 'Not correlated to u: “does any March order exist at all?” is the same answer (yes) for everyone → NOT EXISTS is FALSE for all users.',
        },
        {
          slot: 'where',
          sql: "EXISTS (SELECT 1 FROM orders r WHERE r.user_id = u.id AND r.ordered_at < '2024-03-01')",
          replaces: "NOT EXISTS (SELECT 1 FROM orders r WHERE r.user_id = u.id AND r.ordered_at >= '2024-03-01')",
          why: '“Has an order before March” ≠ “has no order since March”: Asha, Dana and Fatima ordered in both periods and wrongly pass.',
        },
      ],
    },
    exercises: [
      {
        id: 'sa-unsold-products',
        kind: 'write',
        title: 'Products never ordered',
        difficulty: 'Easy',
        prompt: 'Products that appear in no order: `id`, `name`, ordered by id.',
        solution: `SELECT p.id, p.name
FROM products p
WHERE NOT EXISTS (
  SELECT 1 FROM order_items i WHERE i.product_id = p.id
)
ORDER BY p.id`,
        hints: ['“No matching row in another table” is an anti-join.', 'NOT EXISTS, or LEFT JOIN order_items … WHERE i.product_id IS NULL.'],
        explanation: 'Only Pen Set has never been ordered. Here NOT IN would also work (order_items.product_id is NOT NULL), but NOT EXISTS keeps working if the column ever becomes nullable, and both plan as a Hash Anti Join.',
      },
      {
        id: 'sa-non-referrers',
        kind: 'fix-bug',
        title: 'Users who never referred anyone',
        difficulty: 'Medium',
        prompt: 'Users who have **not referred anyone** (no user has them as `referred_by`): `name`, ordered by user id. The query returns nothing — fix it.',
        starter: `SELECT u.name
FROM users u
WHERE u.id NOT IN (SELECT r.referred_by FROM users r)
ORDER BY u.id`,
        solution: `SELECT u.name
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM users r WHERE r.referred_by = u.id
)
ORDER BY u.id`,
        hints: ['What does `SELECT referred_by FROM users` contain for users who signed up without a referral?', 'Rewrite the anti-join with NOT EXISTS.'],
        explanation: 'referred_by is NULL for 4 users, so the NOT IN list contains NULL and is never TRUE. NOT EXISTS returns the 7 users nobody points at. `NOT IN (SELECT referred_by … WHERE referred_by IS NOT NULL)` also works but is easy to forget.',
      },
      {
        id: 'sa-only-electronics',
        kind: 'write',
        title: 'Orders made only of electronics',
        difficulty: 'Hard',
        prompt: 'Orders in which **every** line item is an electronics product: `id`, `amount`, ordered by id.',
        solution: `SELECT o.id, o.amount
FROM orders o
WHERE NOT EXISTS (
  SELECT 1
  FROM order_items i
  JOIN products p ON p.id = i.product_id
  WHERE i.order_id = o.id
    AND p.category <> 'electronics'
)
ORDER BY o.id`,
        hints: ['“Every item is electronics” = “there is no item that is not electronics”.', 'Alternative: GROUP BY order HAVING COUNT(*) FILTER (WHERE category <> \'electronics\') = 0.'],
        explanation: 'Double negation turns “for all” into an anti-join (7 orders: 1, 2, 6, 9, 11, 14, 16). Note the vacuous case: an order with no items at all would also qualify — add `AND EXISTS (SELECT 1 FROM order_items …)` if that matters. The GROUP BY version (or `bool_and(category = \'electronics\')`) is equivalent and reads well too.',
      },
    ],
    judgment: [
      {
        id: 'sa-free-coupon',
        kind: 'spot-bug',
        title: 'Coupon for free users who never paid',
        context: 'Growth job: “Send a 20% coupon to free-plan users who have never completed a paid order.” Since guest checkout launched, the job sends nothing.',
        sql: `SELECT u.name, u.email
FROM users u
WHERE u.plan = 'free'
  AND u.id NOT IN (
    SELECT o.user_id
    FROM orders o
    WHERE o.status = 'paid'
  )`,
        bugLines: [4],
        options: [
          {
            text: 'Guest orders have user_id NULL, so the NOT IN list contains NULL and the condition is never TRUE. Use NOT EXISTS.',
            correct: true,
            why: 'Guest order 16 is paid; from then on `u.id NOT IN (…)` is NULL or FALSE for every user. NOT EXISTS returns Ivan and Jo.',
          },
          { text: 'The plan filter must be inside the subquery.', why: 'plan is a users column; the outer WHERE is the right place.' },
          { text: 'The subquery needs DISTINCT to remove duplicate user_ids.', why: 'IN / NOT IN already ignore duplicates; the NULL is still there.' },
          { text: 'It should be IN instead of NOT IN.', why: 'That returns users who HAVE paid — the opposite audience.' },
        ],
        fixedSql: `SELECT u.name, u.email
FROM users u
WHERE u.plan = 'free'
  AND NOT EXISTS (
    SELECT 1
    FROM orders o
    WHERE o.user_id = u.id
      AND o.status = 'paid'
  )`,
        lesson: 'A schema change that makes a column nullable (guest checkout) can silently break every NOT IN that reads it. Default to NOT EXISTS for anti-joins.',
      },
      {
        id: 'sa-pending-users',
        kind: 'slow-query',
        title: 'Dashboard tile: users with a pending order',
        context: 'An ops dashboard tile counts users with at least one pending order on the 200k-order table. It joins and de-duplicates; the reviewer asks for a semi-join.',
        sql: `SELECT COUNT(DISTINCT u.id) AS users_with_pending
FROM big_users u
JOIN big_orders o ON o.user_id = u.id
WHERE o.status = 'pending'`,
        bugLines: [1, 3],
        options: [
          {
            text: 'The join emits one row per pending order and COUNT(DISTINCT) then sorts them to remove duplicate users; an EXISTS semi-join stops at the first match per user and needs no de-duplication.',
            correct: true,
            why: 'The plan changes from Hash Join → Sort → Aggregate (distinct) to a Hash Semi Join feeding a plain count. Same number (1859), less work — and the gap grows with matches per user.',
          },
          { text: 'big_users needs an index on id.', why: 'id is the primary key; it is already indexed.' },
          { text: 'COUNT(DISTINCT) returns a different number than EXISTS.', why: 'Both count each user once; the issue is the work, not the result.' },
          { text: 'Moving the status filter into ON makes it faster.', why: 'For an inner join ON and WHERE are equivalent; the planner pushes the filter into the scan either way.' },
        ],
        fixedSql: `SELECT COUNT(*) AS users_with_pending
FROM big_users u
WHERE EXISTS (
  SELECT 1
  FROM big_orders o
  WHERE o.user_id = u.id
    AND o.status = 'pending'
)`,
        comparePlans: true,
        lesson: 'If you only need to know that a match exists, say so with EXISTS: the planner can use a semi-join instead of building and de-duplicating every pair.',
      },
    ],
    recall: [
      { q: 'Why does `x NOT IN (SELECT col …)` return no rows when col contains a NULL?', a: 'It expands to x <> a AND x <> b AND x <> NULL; the last term is NULL, so the whole condition is never TRUE.' },
      { q: 'Which plan nodes implement EXISTS and NOT EXISTS?', a: 'Semi-join (Hash/Merge/Nested Loop Semi Join) and anti-join (Hash/Nested Loop Anti Join).' },
      { q: 'Why doesn’t EXISTS cause fan-out?', a: 'A semi-join emits each outer row at most once, at the first match; it adds no columns from the inner table.' },
      { q: 'How do you express “every item is X” in SQL?', a: 'NOT EXISTS an item that is not X (double negation), or GROUP BY … HAVING COUNT(*) FILTER (WHERE NOT X) = 0.' },
    ],
    transfer: [
      {
        id: 'sa-t-unsubscribed',
        scenario: 'Marketing: newsletter to all active customers except those in `unsubscribes` — which has rows with NULL customer_id from anonymous unsubscribe links.',
        approach: 'customers c WHERE c.active AND NOT EXISTS (SELECT 1 FROM unsubscribes x WHERE x.customer_id = c.id). NOT IN would return nobody because of the NULL rows.',
      },
      {
        id: 'sa-t-skills',
        scenario: 'Recruiting: candidates who have **all** the skills required by job 42 (tables job_skills, candidate_skills).',
        approach: 'Relational division: candidates c WHERE NOT EXISTS (required skill s of job 42 WHERE NOT EXISTS (candidate_skills cs WHERE cs.candidate_id = c.id AND cs.skill = s.skill)). Or join on skill, GROUP BY candidate HAVING COUNT(*) = number of required skills.',
      },
    ],
    confusable: ['joins-fanout', 'outer-join-filters', 'null-semantics'],
  },
  {
    id: 'null-semantics',
    track: 'mechanics',
    title: 'NULL & three-valued logic',
    tagline: 'NULL means “unknown”: comparisons with it are neither true nor false, aggregates skip it, GROUP BY lumps it together — every one of those rules gets asked in interviews.',
    level: 'core',
    minutes: 14,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      'SQL logic has three values: TRUE, FALSE and **UNKNOWN** (NULL). Any comparison with NULL — `=`, `<>`, `<`, even `NULL = NULL` — is UNKNOWN. WHERE, HAVING, ON, FILTER and CASE WHEN only accept TRUE, so UNKNOWN rows are dropped exactly like FALSE.',
      'That is why `country <> \'US\'` silently excludes users with no country: “is unknown different from US?” is unknown. Test with `IS NULL` / `IS NOT NULL`, or use the NULL-safe comparisons `IS DISTINCT FROM` / `IS NOT DISTINCT FROM`, which treat NULL like an ordinary value.',
      'Boolean operators follow the truth tables: `FALSE AND NULL` = FALSE, `TRUE OR NULL` = TRUE, everything else involving NULL stays NULL. `NOT NULL` is NULL — negating an unknown condition does not bring rows back.',
      'Aggregates skip NULLs: `COUNT(col)`, `SUM`, `AVG`, `MIN`, `MAX` ignore them (AVG of 10, NULL, 20 is 15, not 10); only `COUNT(*)` counts rows. SUM over no rows (or only NULLs) is NULL, not 0 → `COALESCE(SUM(x), 0)`.',
      'Grouping and sorting, however, treat NULLs as equal: GROUP BY, DISTINCT and UNION put all NULLs in **one** group; ORDER BY puts them **last** ascending and **first** descending in Postgres (override with `NULLS FIRST/LAST`). A UNIQUE constraint allows many NULLs (unless declared `NULLS NOT DISTINCT`, Postgres 15+).',
    ],
    internals: [
      'Each Postgres tuple has a **null bitmap** in its header (one bit per column, present only when some column is NULL); a NULL occupies no space in the data area. There is literally no value to compare — which is why comparisons can’t be TRUE, and why adding a nullable column without a default is instant.',
      'Most operators and functions are declared **STRICT**: if any input is NULL the executor returns NULL without calling them. That is the mechanism behind `x + NULL` = NULL and `x = NULL` = NULL. The planner relies on it too: a strict WHERE predicate on the nullable side of an outer join lets it reduce the join to INNER. Aggregates with strict transition functions skip NULL inputs instead of being poisoned by them.',
      'Postgres B-tree indexes **do** store NULLs (unlike Oracle’s single-column indexes), so `WHERE col IS NULL` can use an index; ascending indexes place NULLs last, and `CREATE INDEX … (col DESC NULLS LAST)` can match a ranking ORDER BY. Hash joins never match NULL keys — consistent with `NULL = NULL` being unknown — and `IS NOT DISTINCT FROM` is not hashable/mergeable, so on big joins prefer a COALESCE-d key or separate IS NULL handling.',
      '`NULLIF(a, b)` returns NULL when a = b — the standard guard against division by zero (`x / NULLIF(y, 0)`), because a division-by-zero error aborts the whole statement, not just one row. `COALESCE(a, b, …)` returns the first non-NULL argument and stops evaluating there. `CASE` without ELSE yields NULL, which conditional aggregates rely on.',
    ],
    signals: ['column may be missing / unknown / optional', 'not equal to X (and some values are NULL)', 'average or count where some values are missing', 'rate / ratio where the denominator can be 0', 'detect changed values between two versions'],
    template: `SELECT COALESCE(country, 'unknown')  AS country,      -- label the NULL group
       COUNT(*)                       AS users,        -- rows
       COUNT(referred_by)             AS referred,     -- non-NULL values only
       ROUND(100.0 * COUNT(referred_by) / NULLIF(COUNT(*), 0), 1) AS referred_pct
FROM users
WHERE country IS DISTINCT FROM 'US'                     -- NULL-safe "not US"
GROUP BY country
ORDER BY users DESC, country NULLS LAST;`,
    realWorld: [
      {
        title: 'CDC change detection',
        body: '`WHERE old.phone <> new.phone` misses every change from or to NULL — e.g. a user adding a phone for the first time. Upsert/merge jobs and snapshot tools compare with `IS DISTINCT FROM` (or hash a row of COALESCE-d columns).',
      },
      {
        title: 'Metrics with missing data',
        body: 'AVG(rating) ignores unrated orders — right for “average rating”, wrong for “average satisfaction where no rating = 0”. Decide explicitly (COALESCE or not) and document the denominator; COUNT(*) vs COUNT(col) in a rate can differ by 2×.',
      },
      {
        title: 'Leaderboards ported from MySQL',
        body: 'Postgres sorts NULLs first in DESC; MySQL and SQL Server sort them last. A “top spenders” endpoint moved to Postgres suddenly shows users with no spend at the top. Add `NULLS LAST` or COALESCE the metric.',
      },
    ],
    mistakes: [
      {
        title: '`= NULL` instead of `IS NULL`',
        why: '`col = NULL` is UNKNOWN for every row, so the query returns nothing (no error).',
        fix: '`col IS NULL` / `col IS NOT NULL`.',
      },
      {
        title: '`<>` or NOT IN on nullable columns',
        why: 'Rows where the column is NULL are neither equal nor unequal — they silently disappear.',
        fix: '`IS DISTINCT FROM`, or `col <> x OR col IS NULL`; NOT EXISTS instead of NOT IN.',
      },
      {
        title: 'Forgetting that SUM of nothing is NULL',
        why: 'After a LEFT JOIN with no matches SUM returns NULL, which then propagates (`total + NULL` = NULL) and sorts first in DESC.',
        fix: '`COALESCE(SUM(x), 0)` where 0 is the right business answer.',
      },
      {
        title: 'Dividing by a count that can be 0',
        why: '`x / COUNT(…)` raises “division by zero” for one group and the whole query fails. And bigint / bigint is integer division (1 / 2 = 0).',
        fix: '`100.0 * x / NULLIF(y, 0)` — numeric arithmetic, NULL instead of an error.',
      },
    ],
    worked: {
      question: 'Ops asks: how many **non-US** users per country, and how many of them came via a referral? A first draft used `country <> \'US\'`; we keep that test as a column to compare.',
      sql: `SELECT u.country,
       COUNT(*) AS users,
       COUNT(*) FILTER (WHERE u.country <> 'US') AS naive_not_us,
       COUNT(u.referred_by) AS referred
FROM users u
WHERE u.country IS DISTINCT FROM 'US'
GROUP BY u.country
ORDER BY u.country NULLS FIRST`,
      notes: {
        from: '10 users: 3 in the US, 2 with country NULL (Eli, Ivan).',
        where: '`IS DISTINCT FROM` is the NULL-safe “not equal”: for Eli and Ivan it is TRUE. With `u.country <> \'US\'` it would be NULL for them and they would be dropped — 5 rows instead of 7.',
        group: 'GROUP BY treats the two NULL countries as equal and puts Eli and Ivan in one group — even though `NULL = NULL` is not TRUE. Grouping uses “not distinct”, comparisons use “equal”.',
        select: 'Compare `users` and `naive_not_us` in the NULL group: 2 vs 0 — the `<>` test is unknown for both and FILTER keeps only TRUE. `referred` is COUNT(column), which skips NULLs: Asha, Fatima and Hana have no referrer.',
        order: 'Ascending order puts NULLs last by default in Postgres; `NULLS FIRST` brings the unknown bucket to the top so nobody overlooks it.',
      },
      predictions: [
        {
          stage: 'where',
          kind: 'rowcount',
          question: 'How many of the 10 users pass `u.country IS DISTINCT FROM \'US\'`? (3 users are in the US, 2 have no country.)',
          explain: '7: the 2 NULL-country users are “distinct from US”. `u.country <> \'US\'` would have kept only 5.',
        },
        {
          stage: 'select',
          kind: 'choice',
          question: 'For the NULL-country group (Eli and Ivan), what are `users` and `naive_not_us`?',
          options: ['2 and 2', '2 and 0', '0 and 0', 'There is no NULL group — GROUP BY drops NULL keys'],
          answer: 1,
          explain: 'COUNT(*) counts both rows (2), but `NULL <> \'US\'` is UNKNOWN, and FILTER (like WHERE) keeps only TRUE → 0. GROUP BY keeps NULL keys as one group.',
        },
      ],
      takeaway: 'NULL is unknown, not a value: comparisons with it are never TRUE, aggregates skip it, grouping and sorting lump it together. Use IS [NOT] DISTINCT FROM, COALESCE and NULLIF to say what you mean.',
    },
    build: {
      prompt: 'Per country (NULL shown as `unknown`), **excluding users referred by Asha (id 1)**: `country`, `users`, paid revenue (`paid_revenue`, 0 if none) and `revenue_per_user` rounded to 2 decimals. Countries with no paid orders must still appear. Order by paid_revenue desc, then country.',
      blocks: [
        { slot: 'select', sql: "COALESCE(u.country, 'unknown') AS country", why: 'GROUP BY already put both unknown-country users in one group; COALESCE only labels it.' },
        { slot: 'select', sql: 'COUNT(DISTINCT u.id) AS users', why: 'A user with several paid orders appears on several joined rows — count distinct users.' },
        { slot: 'select', sql: 'COALESCE(SUM(o.amount), 0) AS paid_revenue', why: 'SUM over no paid orders is NULL; the business answer is 0.' },
        {
          slot: 'select',
          sql: 'ROUND(COALESCE(SUM(o.amount), 0) / NULLIF(COUNT(DISTINCT u.id), 0), 2) AS revenue_per_user',
          why: 'NULLIF guards the division: if a group could ever have 0 users you get NULL instead of an error.',
        },
        { slot: 'from', sql: 'users u', why: 'Every output row is about users.' },
        { slot: 'join', sql: "LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'paid'", why: 'LEFT keeps users without paid orders; the status filter sits in ON.' },
        { slot: 'where', sql: 'u.referred_by IS DISTINCT FROM 1', why: 'NULL-safe: users with no referrer (Asha, Fatima, Hana, Jo) are “not referred by Asha” and must stay.' },
        { slot: 'groupBy', sql: 'u.country', why: 'NULL countries form one group.' },
        { slot: 'orderBy', sql: 'paid_revenue DESC', why: 'Largest revenue first.' },
        { slot: 'orderBy', sql: 'country', why: 'Tie-breaker by the output label.' },
      ],
      traps: [
        {
          slot: 'where',
          sql: 'u.referred_by <> 1',
          replaces: 'u.referred_by IS DISTINCT FROM 1',
          why: '`NULL <> 1` is UNKNOWN: the 4 users without any referrer vanish, taking AE, IN and JP with them.',
        },
        {
          slot: 'select',
          sql: 'u.country AS country',
          replaces: "COALESCE(u.country, 'unknown') AS country",
          why: 'The NULL group is still there, but shows up as an empty cell nobody can filter on in a BI tool — label it.',
        },
        {
          slot: 'select',
          sql: 'SUM(o.amount) AS paid_revenue',
          replaces: 'COALESCE(SUM(o.amount), 0) AS paid_revenue',
          why: 'JP (Hana only has a refunded order) gets NULL instead of 0 — and NULL sorts first under DESC.',
        },
        {
          slot: 'select',
          sql: 'COUNT(*) AS users',
          replaces: 'COUNT(DISTINCT u.id) AS users',
          why: 'COUNT(*) counts joined rows: Fatima’s two paid orders make AE look like 2 users.',
        },
        {
          slot: 'where',
          sql: "o.status = 'paid'",
          why: 'A WHERE on the outer-joined table drops users without paid orders: JP disappears and US/unknown user counts shrink.',
        },
      ],
    },
    exercises: [
      {
        id: 'ns-refund-rate',
        kind: 'write',
        title: 'Refund rate without dividing by zero',
        difficulty: 'Easy',
        prompt: 'For every user: `name`, `orders` (0 if none) and `refund_rate` = refunded orders / orders, rounded to 2 decimals — **NULL** (not an error, not 0) for users with no orders. Order by user id.',
        solution: `SELECT u.name,
       COUNT(o.id) AS orders,
       ROUND(COUNT(o.id) FILTER (WHERE o.status = 'refunded') * 1.0
             / NULLIF(COUNT(o.id), 0), 2) AS refund_rate
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.name
ORDER BY u.id`,
        hints: ['LEFT JOIN + COUNT(o.id) gives 0 for users without orders.', '`x / NULLIF(y, 0)` is NULL when y = 0. Multiply by 1.0 to avoid integer division.'],
        explanation: 'Dividing by COUNT(o.id) raises “division by zero” for Ivan and Jo and aborts the whole query; NULLIF turns the zero denominator into NULL, so the rate is NULL (“undefined”), which is more honest than 0. Without `* 1.0`, bigint / bigint is integer division and Ben’s 1/2 would be 0.',
      },
      {
        id: 'ns-cdc-country',
        kind: 'fix-bug',
        title: 'CDC: detect country changes',
        difficulty: 'Medium',
        prompt: 'An ETL step must find users whose country in the CDC feed (`staging_users`, matched on lower-cased email) differs from `users.country` — a change from or to NULL **is** a change. Return distinct `email` (lower-cased), `old_country`, `new_country`, ordered by email. The query finds nothing — fix it.',
        starter: `SELECT DISTINCT lower(s.email) AS email,
       u.country AS old_country,
       s.country AS new_country
FROM staging_users s
JOIN users u ON u.email = lower(s.email)
WHERE u.country <> s.country
ORDER BY email`,
        solution: `SELECT DISTINCT lower(s.email) AS email,
       u.country AS old_country,
       s.country AS new_country
FROM staging_users s
JOIN users u ON u.email = lower(s.email)
WHERE u.country IS DISTINCT FROM s.country
ORDER BY email`,
        hints: ['What is `NULL <> \'PT\'`?', 'Postgres has a NULL-safe inequality operator.'],
        explanation: 'Both matched users (Eli, Ivan) had no country, so `<>` is UNKNOWN and every change is missed. `IS DISTINCT FROM` treats NULL vs value as different and NULL vs NULL as equal — exactly the semantics change detection needs.',
      },
      {
        id: 'ns-tier-asof',
        kind: 'write',
        title: 'Tier as of a date (open-ended validity)',
        difficulty: 'Medium',
        prompt: 'Each user’s tier **as of 2024-02-25** from `customer_tiers` (`valid_from` inclusive, `valid_to` exclusive, `valid_to` NULL = still current): `user_id`, `tier`, ordered by user_id.',
        solution: `SELECT user_id, tier
FROM customer_tiers
WHERE valid_from <= DATE '2024-02-25'
  AND (valid_to > DATE '2024-02-25' OR valid_to IS NULL)
ORDER BY user_id`,
        hints: ['A NULL valid_to means “no end yet”. What is `NULL > date`?', 'Handle the open end explicitly: `OR valid_to IS NULL`, or `COALESCE(valid_to, \'infinity\')`.'],
        explanation: 'With only `valid_to > \'2024-02-25\'`, current rows (valid_to NULL) evaluate to UNKNOWN and user 2 (bronze, still current) disappears. `COALESCE(valid_to, \'infinity\'::date)` or a `daterange(valid_from, valid_to) @> date` test are equivalent; the range form can use a GiST index.',
      },
    ],
    judgment: [
      {
        id: 'ns-top-spenders',
        kind: 'spot-bug',
        title: 'Top customers widget shows non-buyers',
        context: 'After moving from MySQL to Postgres, the “top 3 customers by paid spend” widget shows Ivan, Jo and Hana — who never paid anything.',
        sql: `SELECT u.name,
       SUM(o.amount) AS paid_spend
FROM users u
LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'paid'
GROUP BY u.id, u.name
ORDER BY paid_spend DESC
LIMIT 3`,
        bugLines: [6],
        options: [
          {
            text: 'Users without paid orders get SUM = NULL, and Postgres sorts NULLs first in DESC (MySQL sorts them last). Add NULLS LAST (or COALESCE the sum).',
            correct: true,
            why: 'The three NULL sums take all three slots. With NULLS LAST: Fatima 1680, Dana 1160, Asha 500.',
          },
          { text: 'LIMIT runs before ORDER BY.', why: 'LIMIT is the last step of the query; ORDER BY runs first.' },
          { text: 'SUM should be COUNT.', why: 'The widget is about spend; COUNT would answer a different question.' },
          { text: 'GROUP BY must include o.amount.', why: 'That would produce one row per order amount, not per customer.' },
        ],
        fixedSql: `SELECT u.name,
       SUM(o.amount) AS paid_spend
FROM users u
LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'paid'
GROUP BY u.id, u.name
ORDER BY paid_spend DESC NULLS LAST
LIMIT 3`,
        lesson: 'Any DESC ranking over a nullable metric needs a NULL decision: NULLS LAST, COALESCE, or filtering NULLs out.',
      },
      {
        id: 'ns-eq-null',
        kind: 'peer-review',
        title: 'PR: data-quality check for missing countries',
        context: 'A PR adds a nightly data-quality check: “alert if any user has no country”. In CI it always reports 0, even on fixtures with missing countries.',
        sql: `SELECT COUNT(*) AS users_without_country
FROM users
WHERE country = NULL`,
        bugLines: [3],
        options: [
          {
            text: '`country = NULL` is UNKNOWN for every row, so WHERE keeps nothing. Use `country IS NULL`.',
            correct: true,
            why: 'No value — not even NULL — is “equal” to NULL. The real count is 2 (Eli, Ivan).',
          },
          { text: 'COUNT(*) skips NULL rows.', why: 'COUNT(*) counts rows regardless of their values; COUNT(country) would skip NULLs.' },
          { text: 'It should be COUNT(country).', why: 'COUNT(country) over NULL countries is always 0 — the opposite of what we need.' },
          { text: 'It needs GROUP BY country.', why: 'A single count doesn’t need grouping; the filter is the bug.' },
        ],
        fixedSql: `SELECT COUNT(*) AS users_without_country
FROM users
WHERE country IS NULL`,
        lesson: 'A data-quality check that can never fire is worse than none. Test every check against data that should trigger it.',
      },
    ],
    recall: [
      { q: 'What does `NULL = NULL` return, and what does WHERE do with it?', a: 'NULL (unknown). WHERE keeps only TRUE, so the row is dropped.' },
      { q: 'COUNT(*) vs COUNT(col) vs AVG(col) with NULLs?', a: 'COUNT(*) counts rows; COUNT(col) counts non-NULL values; AVG(col) = SUM of non-NULLs / COUNT(col) — NULLs ignored, not treated as 0.' },
      { q: 'How do GROUP BY, ORDER BY and UNIQUE treat NULLs in Postgres?', a: 'GROUP BY/DISTINCT: all NULLs in one group. ORDER BY: last ASC, first DESC. UNIQUE: multiple NULLs allowed (unless NULLS NOT DISTINCT).' },
      { q: 'Safe ratio when the denominator may be 0?', a: '`100.0 * num / NULLIF(den, 0)` — numeric math, NULL instead of a division-by-zero error.' },
    ],
    transfer: [
      {
        id: 'ns-t-survey',
        scenario: 'Survey table: `score` is NULL when the user skipped the question. Product wants response rate and average score of those who answered, per country (some users have no country).',
        approach: 'COUNT(score) * 1.0 / NULLIF(COUNT(*), 0) for response rate; AVG(score) already ignores skips; COALESCE(country, \'unknown\') as the label. Never COALESCE(score, 0) unless a skip should really count as 0.',
      },
      {
        id: 'ns-t-match',
        scenario: 'Match incoming leads to existing contacts on (email, phone), where phone may be NULL on both sides and two NULL phones with the same email should match.',
        approach: 'ON l.email = c.email AND l.phone IS NOT DISTINCT FROM c.phone. On large tables keep a hash join with ON l.email = c.email AND COALESCE(l.phone, \'\') = COALESCE(c.phone, \'\').',
      },
    ],
    confusable: ['outer-join-filters', 'semi-anti-joins', 'conditional-aggregation'],
  },
  {
    id: 'conditional-aggregation',
    track: 'mechanics',
    title: 'Conditional aggregation (FILTER / SUM(CASE …))',
    tagline: 'Compute many differently-filtered metrics in a single pass: one scan, one GROUP BY, one row per entity — instead of a pile of subqueries or self-joins.',
    level: 'intermediate',
    minutes: 12,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      'WHERE applies **one** filter to the whole query. When each output column needs its **own** filter — paid vs refunded, this month vs last month, mobile vs web — move the condition **inside** the aggregate.',
      'Postgres supports the standard `COUNT(*) FILTER (WHERE status = \'paid\')`. The portable form is `SUM(CASE WHEN status = \'paid\' THEN 1 ELSE 0 END)` or `COUNT(CASE WHEN status = \'paid\' THEN 1 END)` — CASE without ELSE yields NULL, which COUNT skips.',
      'Every row is visited once and updates only the counters it qualifies for, so one query replaces several UNIONs, scalar subqueries or self-joins — and all metrics come from the same snapshot and the same base filter, so they always add up.',
      'Ratios fall out naturally: `100.0 * COUNT(*) FILTER (WHERE status = \'refunded\') / NULLIF(COUNT(*), 0)`. It is also how you **pivot** in Postgres (no PIVOT keyword, and no crosstab here): one aggregate per target column, e.g. `SUM(x) FILTER (WHERE category = \'electronics\') AS electronics`.',
      'Choose the “else” deliberately: for counts and sums, FILTER or `ELSE 0` is fine; for **AVG / MIN / MAX** leave ELSE out (NULL), otherwise the zeros get averaged in.',
    ],
    internals: [
      'One aggregate node (`HashAggregate`, `GroupAggregate`, or plain `Aggregate` without GROUP BY) keeps a transition state per aggregate per group. With FILTER, each row evaluates the filter and only advances the states whose filter is TRUE; with CASE the transition function runs on every row and receives NULL or 0. Either way: **one scan of the input**.',
      'The alternatives cost more: N scalar subqueries → N `InitPlan`/`SubPlan` scans; `UNION ALL` of N filtered queries → N scans; one self-join per metric → N joins and a fan-out risk. On the 200k-row table, three scalar subqueries are three Seq Scans; the FILTER version is one.',
      'Memory: a HashAggregate holds one entry per group with all its states; more aggregates make entries wider but add no passes. If the hash table outgrows `work_mem`, Postgres 13+ spills partitions to disk rather than failing. A `COUNT(DISTINCT …)` (filtered or not) makes the whole aggregate sort-based, because distinct aggregates sort their input.',
      'One index can’t serve several different filters at once, so conditional aggregation is a scan-shaped pattern: ideal for ETL and dashboards, where a common WHERE (e.g. a date range) can still use an index first. In BigQuery/Snowflake, which bill or scale by bytes scanned, one pass instead of N is a direct cost saving.',
    ],
    signals: ['counts by status side by side', 'X vs Y in the same row', 'rate / ratio / percentage of …', 'pivot: one column per category / month', 'this period vs last period'],
    template: `SELECT user_id,
       COUNT(*)                                    AS orders,
       COUNT(*) FILTER (WHERE status = 'paid')     AS paid,
       SUM(amount) FILTER (WHERE status = 'paid')  AS paid_revenue,
       SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) AS refunded,  -- portable form
       ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'refunded')
             / NULLIF(COUNT(*), 0), 1)             AS refund_pct
FROM orders
GROUP BY user_id;`,
    realWorld: [
      {
        title: 'KPI tiles from one query',
        body: 'A dashboard with orders / paid / refunded / refund-rate tiles used to fire four queries: four scans, four round trips, and numbers taken at slightly different moments that don’t add up. One FILTER query returns a consistent row.',
      },
      {
        title: 'Pivot reports and ML feature tables',
        body: 'Monthly revenue per category as columns, or per-user features like `purchases_7d`, `purchases_30d`, `views_30d` — each a conditional aggregate over a single scan of the events with a time-window filter.',
      },
      {
        title: 'Funnels and A/B metrics',
        body: '`COUNT(DISTINCT user_id) FILTER (WHERE event = \'checkout\')` per variant gives every funnel step in one GROUP BY; their ratios are the conversion rates an experiment platform reports.',
      },
    ],
    mistakes: [
      {
        title: '`COUNT(CASE WHEN … THEN 1 ELSE 0 END)`',
        why: 'COUNT counts every non-NULL value — 0 included — so it returns the total row count.',
        fix: 'SUM(CASE … THEN 1 ELSE 0 END), COUNT(CASE … THEN 1 END) without ELSE, or COUNT(*) FILTER (WHERE …).',
      },
      {
        title: '`AVG(CASE WHEN … THEN x ELSE 0 END)`',
        why: 'Non-matching rows contribute 0 and drag the average down.',
        fix: 'Leave ELSE out (NULLs are ignored) or use AVG(x) FILTER (WHERE …).',
      },
      {
        title: 'Putting the condition in WHERE',
        why: 'WHERE filters rows for **all** columns: the other metrics become 0 and entities with no matching rows vanish.',
        fix: 'Keep only the common filter in WHERE; per-metric conditions go into FILTER/CASE.',
      },
      {
        title: 'Integer division in ratios',
        why: '`COUNT(*) FILTER (…) / COUNT(*)` is bigint / bigint → 2 / 3 = 0.',
        fix: 'Multiply by 100.0 (or cast to numeric) before dividing; guard with NULLIF.',
      },
    ],
    worked: {
      question: 'Account managers want one row per customer with total orders, paid and refunded counts, paid revenue and the share of orders that were paid — without five separate queries.',
      sql: `SELECT u.name,
       COUNT(*) AS orders,
       COUNT(*) FILTER (WHERE o.status = 'paid') AS paid,
       COUNT(*) FILTER (WHERE o.status = 'refunded') AS refunded,
       SUM(CASE WHEN o.status = 'paid' THEN o.amount ELSE 0 END) AS paid_revenue,
       ROUND(100.0 * COUNT(*) FILTER (WHERE o.status = 'paid') / COUNT(*), 1) AS paid_pct
FROM users u
JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.name
ORDER BY paid_revenue DESC, u.name`,
      notes: {
        from: 'No WHERE: every order must reach the aggregation, because each column applies its own filter.',
        join: 'One row per order. Ivan and Jo have no orders and drop out (inner join); the guest order has no user.',
        group: 'One pass per group: every row bumps COUNT(*), and only the counters whose FILTER is TRUE for it. Hana’s single refunded row increments `orders` and `refunded` and adds 0 to paid_revenue.',
        select: '`paid_pct` multiplies by 100.0 first so the division is numeric. Without it, `COUNT(*) FILTER (…) / COUNT(*)` is integer division: Dana’s 2 / 3 would be 0.',
      },
      predictions: [
        {
          stage: 'group',
          kind: 'rowcount',
          question: 'How many groups (customers) does GROUP BY produce?',
          explain: '8 — the users with at least one order. To list Ivan and Jo with zeros you would LEFT JOIN and count o.id.',
        },
        {
          stage: 'select',
          kind: 'choice',
          question: 'Dana has 3 orders: 2 paid and 1 pending. What is her `paid_pct`?',
          options: ['66.7', '100.0', '0', '2'],
          answer: 0,
          explain: '100.0 × 2 / 3 = 66.7. Pending is neither paid nor refunded, so it counts only in `orders` — the denominator.',
        },
      ],
      takeaway: 'When columns need different filters, move the filter into the aggregate (FILTER / CASE): one scan, one row per entity, numbers that add up.',
    },
    build: {
      prompt: 'One row per product category: units in **paid** orders (`paid_units`), in **pending** orders (`pending_units`, 0 if none), in **refunded** orders (`refunded_units`, 0 if none), and paid line revenue (`paid_revenue` = Σ qty × unit_price of paid lines). Order by category.',
      blocks: [
        { slot: 'select', sql: 'p.category', why: 'The pivot key: one row per category.' },
        { slot: 'select', sql: "SUM(i.qty) FILTER (WHERE o.status = 'paid') AS paid_units", why: 'Units, not lines: SUM the quantity of paid lines only.' },
        { slot: 'select', sql: "COALESCE(SUM(i.qty) FILTER (WHERE o.status = 'pending'), 0) AS pending_units", why: 'No pending electronics → SUM of nothing is NULL → 0.' },
        { slot: 'select', sql: "COALESCE(SUM(i.qty) FILTER (WHERE o.status = 'refunded'), 0) AS refunded_units", why: 'Same pattern, another filter — still the same single scan.' },
        {
          slot: 'select',
          sql: "SUM(CASE WHEN o.status = 'paid' THEN i.qty * i.unit_price ELSE 0 END) AS paid_revenue",
          why: 'The portable CASE form; ELSE 0 is fine for a SUM. Line revenue, so no fan-out from order amounts.',
        },
        { slot: 'from', sql: 'order_items i', why: 'Line grain: quantities and prices live here.' },
        { slot: 'join', sql: 'JOIN orders o ON o.id = i.order_id', why: 'Many-to-one: brings the status to each line.' },
        { slot: 'join', sql: 'JOIN products p ON p.id = i.product_id', why: 'Many-to-one: brings the category.' },
        { slot: 'groupBy', sql: 'p.category', why: 'One group per category.' },
        { slot: 'orderBy', sql: 'p.category', why: 'Stable order.' },
      ],
      traps: [
        {
          slot: 'where',
          sql: "o.status = 'paid'",
          why: 'WHERE removes pending and refunded lines before aggregation, so those columns all become 0.',
        },
        {
          slot: 'select',
          sql: "SUM(o.amount) FILTER (WHERE o.status = 'paid') AS paid_revenue",
          replaces: "SUM(CASE WHEN o.status = 'paid' THEN i.qty * i.unit_price ELSE 0 END) AS paid_revenue",
          why: 'Fan-out: the whole order amount is repeated on each of its lines, and attributed to every category in the order.',
        },
        {
          slot: 'select',
          sql: "COUNT(*) FILTER (WHERE o.status = 'paid') AS paid_units",
          replaces: "SUM(i.qty) FILTER (WHERE o.status = 'paid') AS paid_units",
          why: 'COUNT(*) counts lines, not units: a line with qty 4 counts as 1.',
        },
        {
          slot: 'select',
          sql: "SUM(i.qty) FILTER (WHERE o.status = 'pending') AS pending_units",
          replaces: "COALESCE(SUM(i.qty) FILTER (WHERE o.status = 'pending'), 0) AS pending_units",
          why: 'Electronics has no pending lines: SUM over nothing is NULL, not 0.',
        },
        {
          slot: 'groupBy',
          sql: 'o.status',
          why: 'Grouping by status undoes the pivot: you get one row per category × status, with the other columns NULL/0.',
        },
      ],
    },
    exercises: [
      {
        id: 'ca-status-kpis',
        kind: 'write',
        title: 'Order status KPIs in one row',
        difficulty: 'Easy',
        prompt: 'One row for the whole shop: `total_orders`, `paid_orders`, `refunded_orders`, `pending_orders` and `refund_rate_pct` = refunded / (paid + refunded) × 100, rounded to 1 decimal.',
        solution: `SELECT COUNT(*) AS total_orders,
       COUNT(*) FILTER (WHERE status = 'paid') AS paid_orders,
       COUNT(*) FILTER (WHERE status = 'refunded') AS refunded_orders,
       COUNT(*) FILTER (WHERE status = 'pending') AS pending_orders,
       ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'refunded')
             / NULLIF(COUNT(*) FILTER (WHERE status IN ('paid', 'refunded')), 0), 1) AS refund_rate_pct
FROM orders`,
        hints: ['No GROUP BY: the whole table is one group.', 'Each column gets its own FILTER; the ratio divides two filtered counts.'],
        explanation: '16 orders: 12 paid, 2 refunded, 2 pending; refund rate 2 / 14 = 14.3%. Pending orders are excluded from the denominator because they can’t be refunded yet — decide and document denominators explicitly.',
      },
      {
        id: 'ca-monthly-pivot',
        kind: 'write',
        title: 'Monthly revenue by category (pivot)',
        difficulty: 'Medium',
        prompt: 'Paid line revenue (qty × unit_price) per month with one column per category: `month` (date of the first of the month), `electronics`, `furniture`, `stationery` (0 if none). Order by month.',
        solution: `SELECT date_trunc('month', o.ordered_at)::date AS month,
       COALESCE(SUM(i.qty * i.unit_price) FILTER (WHERE p.category = 'electronics'), 0) AS electronics,
       COALESCE(SUM(i.qty * i.unit_price) FILTER (WHERE p.category = 'furniture'), 0) AS furniture,
       COALESCE(SUM(i.qty * i.unit_price) FILTER (WHERE p.category = 'stationery'), 0) AS stationery
FROM orders o
JOIN order_items i ON i.order_id = o.id
JOIN products p ON p.id = i.product_id
WHERE o.status = 'paid'
GROUP BY 1
ORDER BY 1`,
        hints: ['The common filter (paid) goes in WHERE; the per-column filter (category) goes in FILTER.', 'Use line revenue, not order amount, so orders spanning categories are split correctly.'],
        explanation: 'Rows = months, columns = categories: the classic pivot. Unlike crosstab/PIVOT, the column list is fixed in the SQL; a new category needs a new column (or generate the SQL). February has no paid stationery, hence COALESCE.',
      },
      {
        id: 'ca-count-case',
        kind: 'fix-bug',
        title: 'Paid and refunded counts are identical',
        difficulty: 'Easy',
        prompt: 'Per customer: `name`, `paid_orders`, `refunded_orders`, ordered by user id. Every customer shows the same number in both columns — fix it.',
        starter: `SELECT u.name,
       COUNT(CASE WHEN o.status = 'paid' THEN 1 ELSE 0 END) AS paid_orders,
       COUNT(CASE WHEN o.status = 'refunded' THEN 1 ELSE 0 END) AS refunded_orders
FROM users u
JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.name
ORDER BY u.id`,
        solution: `SELECT u.name,
       COUNT(*) FILTER (WHERE o.status = 'paid') AS paid_orders,
       COUNT(*) FILTER (WHERE o.status = 'refunded') AS refunded_orders
FROM users u
JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.name
ORDER BY u.id`,
        hints: ['What does COUNT do with the value 0?', 'Either SUM the 1/0 values, drop the ELSE, or use FILTER.'],
        explanation: 'COUNT counts non-NULL values, and 0 is not NULL, so both columns equal the order count. SUM(CASE … THEN 1 ELSE 0 END), COUNT(CASE … THEN 1 END) and COUNT(*) FILTER (WHERE …) are all correct.',
      },
    ],
    judgment: [
      {
        id: 'ca-avg-else0',
        kind: 'spot-bug',
        title: 'Average paid order value is too low',
        context: 'CRM field “average paid order value” per customer. Dana’s shows 386.67, but her paid orders were 680 and 480.',
        sql: `SELECT u.name,
       ROUND(AVG(CASE WHEN o.status = 'paid' THEN o.amount ELSE 0 END), 2) AS avg_paid_order
FROM users u
JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.name
ORDER BY u.id`,
        bugLines: [2],
        options: [
          {
            text: 'ELSE 0 feeds a 0 into AVG for every non-paid order, so they count in the denominator. Leave out ELSE (NULLs are ignored) or use AVG(o.amount) FILTER (WHERE …).',
            correct: true,
            why: 'Dana: (680 + 480 + 0) / 3 = 386.67 instead of 580. Hana, who never paid, gets 0 instead of NULL.',
          },
          { text: 'It needs a WHERE o.status = \'paid\'.', why: 'That gives the right averages here but drops customers without paid orders; the defect is the ELSE 0 inside AVG.' },
          { text: 'ROUND must be applied before AVG.', why: 'Rounding each amount first would only add rounding error.' },
          { text: 'The join fans out and repeats amounts.', why: 'users → orders is the intended grain here; each order is one row.' },
        ],
        fixedSql: `SELECT u.name,
       ROUND(AVG(o.amount) FILTER (WHERE o.status = 'paid'), 2) AS avg_paid_order
FROM users u
JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.name
ORDER BY u.id`,
        lesson: 'In conditional aggregation, the ELSE branch is part of the math: 0 is right for SUM, wrong for AVG/MIN, and wrong for COUNT.',
      },
      {
        id: 'ca-status-tiles',
        kind: 'slow-query',
        title: 'Three subqueries for three tiles',
        context: 'The ops homepage shows delivered / cancelled / pending counts for the 200k-order table. The endpoint is the slowest on the page.',
        sql: `SELECT
  (SELECT COUNT(*) FROM big_orders WHERE status = 'delivered') AS delivered,
  (SELECT COUNT(*) FROM big_orders WHERE status = 'cancelled') AS cancelled,
  (SELECT COUNT(*) FROM big_orders WHERE status = 'pending') AS pending`,
        bugLines: [2, 3, 4],
        options: [
          {
            text: 'Each scalar subquery is a separate full scan of big_orders (three InitPlans). One pass with COUNT(*) FILTER (WHERE …) per tile reads the table once.',
            correct: true,
            why: 'The plan goes from three Seq Scans to one, roughly halving the estimated cost — and the three numbers now come from one consistent read.',
          },
          { text: 'Add an index on status.', why: 'It helps the rare statuses, but “delivered” is ~94% of rows — that count still reads nearly everything, three times over.' },
          { text: 'Use UNION ALL of the three counts.', why: 'Still three scans, just stacked as rows instead of columns.' },
          { text: 'Use COUNT(1) instead of COUNT(*).', why: 'They are identical in Postgres; COUNT(*) is, if anything, slightly cheaper.' },
        ],
        fixedSql: `SELECT COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
       COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
       COUNT(*) FILTER (WHERE status = 'pending') AS pending
FROM big_orders`,
        comparePlans: true,
        lesson: 'N metrics over the same table should cost one scan, not N: move the conditions into the aggregates.',
      },
    ],
    recall: [
      { q: 'Postgres syntax to count only paid orders inside a GROUP BY?', a: "COUNT(*) FILTER (WHERE status = 'paid') — portable: SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END)." },
      { q: 'Why is `COUNT(CASE WHEN x THEN 1 ELSE 0 END)` wrong?', a: 'COUNT counts every non-NULL value, including 0 — it returns the row count. Drop ELSE or use SUM.' },
      { q: 'Why leave out ELSE in AVG(CASE …)?', a: 'ELSE 0 puts zeros into the average; NULLs (no ELSE) are ignored by AVG.' },
      { q: 'How do you pivot rows into columns in Postgres without crosstab?', a: 'GROUP BY the row key and write one aggregate per target column with FILTER (WHERE key = value).' },
    ],
    transfer: [
      {
        id: 'ca-t-wow',
        scenario: 'Sales wants, per region: revenue this week, revenue last week and week-over-week change in %, in one table.',
        approach: 'WHERE ordered_at >= start of last week (index-friendly common filter); SUM(amount) FILTER (WHERE ordered_at >= this_week) and FILTER (WHERE ordered_at < this_week); pct = 100.0 * (this - last) / NULLIF(last, 0). One scan, GROUP BY region.',
      },
      {
        id: 'ca-t-features',
        scenario: 'The ML team needs per-user features: logins in the last 7 and 30 days, and whether the user ever contacted support.',
        approach: 'One GROUP BY user_id over the events: COUNT(*) FILTER (WHERE type = \'login\' AND at >= now() - interval \'7 days\'), same for 30 days, bool_or(type = \'support\'). LEFT JOIN from users and COALESCE to keep inactive users with 0.',
      },
    ],
    confusable: ['pivot-unpivot', 'logical-order', 'funnel-analysis'],
  },
  {
    id: 'self-joins',
    track: 'mechanics',
    title: 'Self-joins (comparing rows of the same table)',
    tagline: 'Join a table to itself under two aliases to put an employee next to their manager, every pair next to each other, or each event next to the next one.',
    level: 'intermediate',
    minutes: 12,
    interview: 2,
    viz: 'pipeline',
    intuition: [
      'A self-join is an ordinary join whose two inputs are the same table under two aliases. The aliases are **roles**: the employee row and the manager row, the earlier event and the later one. Once both roles sit on one row, any comparison between them is a plain WHERE.',
      'Hierarchies: `employees e JOIN employees m ON m.id = e.manager_id` puts each employee next to their manager. Use LEFT JOIN to keep the root (the CEO has no manager). Each extra level is another alias (skip-level manager = a third copy); for arbitrary depth use a recursive CTE.',
      'Pairs: `ON b.dept = a.dept AND a.id < b.id` lists each unordered pair **once**. `a.id <> b.id` gives every pair twice (A,B and B,A); `<=` adds each row paired with itself; no condition at all gives n² rows.',
      'Sequences and duplicates: match a row with “the next one” (`b.login_date = a.login_date + 1`) or with another row sharing a key. For previous/next-row questions `LAG`/`LEAD` are usually simpler and faster, and for duplicates `GROUP BY … HAVING COUNT(*) > 1` — interviewers often ask for the self-join first, then “now do it with a window function”.',
    ],
    internals: [
      'The planner treats the two aliases as independent relations: it scans the table twice and chooses Hash Join / Merge Join / Nested Loop as usual. `m.id = e.manager_id` is a many-to-one lookup on a primary key — a hash join on a small table, or a nested loop with an **index scan on the PK** per row on a big one — and cannot fan out.',
      'Inequality self-joins are the dangerous kind. `p.user_id = o.user_id AND p.created_at < o.created_at` is a **triangular join**: a user with k orders produces k(k−1)/2 pairs. A hash join can use only the equality part; the inequality becomes a `Join Filter` applied to every candidate pair, so the work grows quadratically with group size.',
      '`LAG`/`LEAD` answer the positional version with one sort on `(user_id, created_at)` and a single `WindowAgg` pass — O(n log n), no pairs materialised. The self-join wins when the match is not positional (“any login exactly one day later”, “pairs with equal salary”), or when a selective index lets a nested loop probe a few rows per outer row.',
      'Cardinality estimates for self-joins with extra conditions are often far off — both sides are the same, correlated data, while the planner assumes independent columns. Check EXPLAIN ANALYZE before trusting a plan, and keep the equality key indexed.',
    ],
    signals: ['employee and their manager', 'compare a row with another row of the same table', 'pairs of … with the same …', 'consecutive days / next event', 'find duplicates'],
    template: `-- hierarchy: each employee with their manager (CEO kept)
SELECT e.name AS employee, m.name AS manager
FROM employees e
LEFT JOIN employees m ON m.id = e.manager_id;

-- unordered pairs, each listed once
SELECT a.name, b.name
FROM employees a
JOIN employees b ON b.dept = a.dept AND a.id < b.id;`,
    realWorld: [
      {
        title: 'Org-chart rules and HR data quality',
        body: '“Expenses must be approved by the submitter’s manager”, “flag employees paid more than their manager” and skip-level views are self-joins on manager_id, typically run as nightly checks in HR/payroll pipelines.',
      },
      {
        title: 'Fraud and abuse detection',
        body: '“Two accounts sharing a card fingerprint, created within 10 minutes” = self-join on fingerprint with `a.id < b.id` and a time window. Index the equality key — or the join is quadratic over popular fingerprints.',
      },
      {
        title: 'Entity resolution in ETL',
        body: 'Candidate duplicate customers (same normalised email or phone) come from a self-join on the normalised key; the pairs feed a merge step. At warehouse scale, “blocking keys” keep the self-join from exploding.',
      },
    ],
    mistakes: [
      {
        title: '`a.id <> b.id` for pairs',
        why: 'Every pair appears twice (A,B and B,A), doubling counts.',
        fix: '`a.id < b.id` — one canonical order per pair.',
      },
      {
        title: 'Inner self-join on a nullable parent',
        why: 'Rows whose parent is NULL (the CEO, root categories) vanish.',
        fix: 'LEFT JOIN the parent alias.',
      },
      {
        title: 'Duplicates in the input',
        why: 'A duplicated row matches twice and is matched twice: counts inflate (user 2’s duplicate login doubles its pairs).',
        fix: 'De-duplicate in a CTE (SELECT DISTINCT) before self-joining.',
      },
      {
        title: 'Triangular self-join for the previous row',
        why: 'O(k²) pairs per group, two scans of the table, and fragile with ties.',
        fix: 'LAG() OVER (PARTITION BY key ORDER BY ts).',
      },
    ],
    worked: {
      question: 'Comp review: which employees earn at least 80% of their manager’s salary (pay compression), and how close are they?',
      sql: `SELECT e.name AS employee,
       e.salary,
       m.name AS manager,
       m.salary AS manager_salary,
       ROUND(100.0 * e.salary / m.salary) AS pct_of_manager
FROM employees e
JOIN employees m ON m.id = e.manager_id
WHERE e.salary >= 0.8 * m.salary
ORDER BY pct_of_manager DESC`,
      notes: {
        from: '`e` plays the employee role. The same 12 rows will be read again as `m`, the manager role.',
        join: 'Many-to-one: each employee finds exactly one manager row (m.id is the primary key), so no fan-out. Maya (CEO, manager_id NULL) has no partner and disappears — fine here; use LEFT JOIN when the root must stay.',
        where: 'Both roles are on the same row now, so “employee vs manager” is a plain row condition. Sara earns exactly 80% (120k vs 150k) and passes thanks to `>=`.',
        order: 'Tom earns 110% of Priya’s salary — an IC out-earning their manager, the case comp reviews look for.',
      },
      predictions: [
        {
          stage: 'join',
          kind: 'rowcount',
          question: 'Joining the 12 employees to their managers (`m.id = e.manager_id`) — how many rows?',
          explain: '11: everyone except Maya, whose manager_id is NULL and therefore matches nobody.',
        },
        {
          stage: 'where',
          kind: 'rowcount',
          question: 'How many employees earn at least 80% of their manager’s salary?',
          explain: '2: Tom (165k vs Priya’s 150k = 110%) and Sara (120k vs 150k = exactly 80%). Priya and Quinn are at 79% of Noah.',
        },
      ],
      takeaway: 'A self-join puts two rows of one table side by side in different roles; after that, comparing them is an ordinary WHERE.',
    },
    build: {
      prompt: 'Pairs of employees in the **same department** with the **same salary**, each pair listed once: `dept`, `employee_a`, `employee_b`, `salary`. Order by dept, employee_a.',
      blocks: [
        { slot: 'select', sql: 'a.dept', why: 'Department of the pair.' },
        { slot: 'select', sql: 'a.name AS employee_a', why: 'First member (lower id).' },
        { slot: 'select', sql: 'b.name AS employee_b', why: 'Second member (higher id).' },
        { slot: 'select', sql: 'a.salary', why: 'Equal on both sides by construction.' },
        { slot: 'from', sql: 'employees a', why: 'First role.' },
        { slot: 'join', sql: 'JOIN employees b ON b.dept = a.dept AND b.salary = a.salary', why: 'Second role: same table, matched on the attributes the pair must share.' },
        { slot: 'where', sql: 'a.id < b.id', why: 'Removes self-pairs (a = b) and mirrored pairs (b, a): each unordered pair once.' },
        { slot: 'orderBy', sql: 'a.dept', why: 'Group pairs by department.' },
        { slot: 'orderBy', sql: 'employee_a', why: 'Stable order inside the department.' },
      ],
      traps: [
        {
          slot: 'where',
          sql: 'a.id <> b.id',
          replaces: 'a.id < b.id',
          why: 'Removes self-pairs but keeps both orders: Priya–Quinn and Quinn–Priya. Every pair is counted twice.',
        },
        {
          slot: 'where',
          sql: 'a.id <= b.id',
          replaces: 'a.id < b.id',
          why: 'Every employee is equal to themselves: all 12 appear paired with their own row.',
        },
        {
          slot: 'join',
          sql: 'CROSS JOIN employees b',
          replaces: 'JOIN employees b ON b.dept = a.dept AND b.salary = a.salary',
          why: 'Without the matching condition every row pairs with every other: 12 × 11 / 2 = 66 pairs instead of 2.',
        },
      ],
    },
    exercises: [
      {
        id: 'sj-skip-level',
        kind: 'write',
        title: 'Manager and skip-level manager',
        difficulty: 'Easy',
        prompt: 'For every employee: `employee`, `manager` and `skip_level` (the manager’s manager), NULL where there is none. Order by employee id.',
        solution: `SELECT e.name AS employee,
       m.name AS manager,
       s.name AS skip_level
FROM employees e
LEFT JOIN employees m ON m.id = e.manager_id
LEFT JOIN employees s ON s.id = m.manager_id
ORDER BY e.id`,
        hints: ['One alias per role: employee, manager, skip-level.', 'LEFT JOIN both levels so Maya, Noah and Olga stay.'],
        explanation: 'Each level is one more self-join on manager_id; LEFT JOINs keep the top of the tree (Maya has neither, Noah/Olga have no skip-level). For “all ancestors at any depth” switch to a recursive CTE.',
      },
      {
        id: 'sj-streak-days',
        kind: 'fix-bug',
        title: 'Days followed by another login',
        difficulty: 'Medium',
        prompt: 'For each user in `logins`, count the days on which they **also logged in the next day** (`streak_days`). Return `user_id`, `streak_days`, ordered by user_id. `logins` contains a duplicate row, and the query over-counts user 2 — fix it.',
        starter: `SELECT a.user_id, COUNT(*) AS streak_days
FROM logins a
JOIN logins b
  ON b.user_id = a.user_id
 AND b.login_date = a.login_date + 1
GROUP BY a.user_id
ORDER BY a.user_id`,
        solution: `WITH days AS (
  SELECT DISTINCT user_id, login_date
  FROM logins
)
SELECT a.user_id, COUNT(*) AS streak_days
FROM days a
JOIN days b
  ON b.user_id = a.user_id
 AND b.login_date = a.login_date + 1
GROUP BY a.user_id
ORDER BY a.user_id`,
        hints: ['User 2 logged in twice on March 4. How many pairs does that create with March 3 and March 5?', 'De-duplicate to one row per user and day before self-joining.'],
        explanation: 'The duplicate March 4 row matches March 3 twice (as b) and March 5 twice (as a): 5 instead of 3. De-duplicating first fixes the grain. The window alternative: `LEAD(login_date) OVER (PARTITION BY user_id ORDER BY login_date) = login_date + 1` over the distinct days.',
      },
      {
        id: 'sj-higher-peers',
        kind: 'write',
        title: 'How many colleagues earn more?',
        difficulty: 'Hard',
        prompt: 'For every employee: `dept`, `name`, `salary` and `higher_paid_peers` = number of colleagues in the same department earning strictly more (0 for the top earner). Order by dept, salary desc, name.',
        solution: `SELECT e.dept, e.name, e.salary,
       COUNT(p.id) AS higher_paid_peers
FROM employees e
LEFT JOIN employees p
  ON p.dept = e.dept
 AND p.salary > e.salary
GROUP BY e.id, e.dept, e.name, e.salary
ORDER BY e.dept, e.salary DESC, e.name`,
        hints: ['Self-join each employee to the colleagues who earn more (inequality join).', 'LEFT JOIN + COUNT(p.id) so the top earner gets 0.'],
        explanation: 'An inequality self-join: each row matches every better-paid colleague (a triangular join, O(n²) per department). The window equivalent is `RANK() OVER (PARTITION BY dept ORDER BY salary DESC) - 1` — one sort, and it handles ties the same way (Priya and Quinn both have 2 higher-paid peers).',
      },
    ],
    judgment: [
      {
        id: 'sj-dupe-emails',
        kind: 'spot-bug',
        title: 'Duplicate check before an upsert',
        context: 'Pre-upsert data-quality check: “list emails that appear more than once in the CDC feed”. It reports none, yet the upsert then fails with “ON CONFLICT DO UPDATE command cannot affect row a second time”.',
        sql: `SELECT DISTINCT a.email
FROM staging_users a
JOIN staging_users b
  ON a.email = b.email
 AND a.updated_at <> b.updated_at
ORDER BY a.email`,
        bugLines: [4, 5],
        options: [
          {
            text: 'Exact `=` misses Eli@Mail.com vs eli@mail.com, and `updated_at <>` excludes the two identical Kim rows. Group by lower(email) HAVING COUNT(*) > 1 instead.',
            correct: true,
            why: 'Both real duplicates slip through the self-join’s conditions. The GROUP BY version finds eli (2 rows) and kim (2 rows).',
          },
          { text: 'DISTINCT hides the duplicates.', why: 'DISTINCT only collapses the output emails; the join produced no rows to begin with.' },
          { text: 'It should be a LEFT JOIN.', why: 'A LEFT JOIN would return every email, duplicated or not.' },
          { text: 'ORDER BY a.email is not allowed with DISTINCT.', why: 'a.email is in the select list, so ORDER BY on it is fine.' },
        ],
        fixedSql: `SELECT lower(email) AS email, COUNT(*) AS copies
FROM staging_users
GROUP BY lower(email)
HAVING COUNT(*) > 1
ORDER BY 1`,
        lesson: 'For “which keys are duplicated”, GROUP BY the normalised key; a self-join needs every row-distinguishing condition right, and exact copies have nothing to distinguish them.',
      },
      {
        id: 'sj-prev-order',
        kind: 'slow-query',
        title: 'Previous order via a triangular self-join',
        context: 'A churn feature needs each order’s previous order time for the same user. The batch job uses a self-join and is the slowest step in the pipeline.',
        sql: `SELECT o.id,
       MAX(p.created_at) AS prev_order_at
FROM big_orders o
LEFT JOIN big_orders p
  ON p.user_id = o.user_id
 AND p.created_at < o.created_at
WHERE o.user_id <= 100
GROUP BY o.id`,
        bugLines: [4, 5, 6],
        options: [
          {
            text: 'Triangular self-join: each order is paired with all earlier orders of its user (k(k−1)/2 pairs), using a second scan of the 200k-row table; then a HashAggregate collapses the pairs. LAG() gets the previous row in one sorted pass.',
            correct: true,
            why: 'The plan drops the second Seq Scan, the hash join with its Join Filter and the HashAggregate: one scan, one sort, one WindowAgg.',
          },
          { text: 'MAX should be MIN.', why: 'MAX of the earlier timestamps is exactly the previous order; the logic is right, the cost is the problem.' },
          { text: 'LEFT JOIN should be JOIN.', why: 'Then each user’s first order disappears; it would not remove the pair explosion.' },
          { text: 'GROUP BY o.id needs o.user_id as well.', why: 'o.id is the primary key; grouping by it is sufficient.' },
        ],
        fixedSql: `SELECT o.id,
       LAG(o.created_at) OVER (PARTITION BY o.user_id ORDER BY o.created_at) AS prev_order_at
FROM big_orders o
WHERE o.user_id <= 100`,
        comparePlans: true,
        lesson: 'Self-joins that compare “earlier vs later” rows grow quadratically per group. When the question is positional (previous / next), use LAG/LEAD.',
      },
    ],
    recall: [
      { q: 'Why `a.id < b.id` rather than `a.id <> b.id` when listing pairs?', a: '`<>` returns each pair twice (A,B and B,A); `<` keeps one canonical order and also excludes self-pairs.' },
      { q: 'How do you list every employee with their manager and keep the CEO?', a: 'employees e LEFT JOIN employees m ON m.id = e.manager_id.' },
      { q: 'What is a triangular join and why is it slow?', a: 'A self-join on key plus inequality (earlier rows): k(k−1)/2 pairs per key, evaluated as a Join Filter on every candidate pair.' },
      { q: 'Self-join vs LAG for “previous event”?', a: 'LAG: one sort + WindowAgg, O(n log n). Self-join: pairs and aggregation, O(k²) per group — use it only for non-positional matches.' },
    ],
    transfer: [
      {
        id: 'sj-t-devices',
        scenario: 'Risk team: find pairs of accounts that used the same device id and signed up within one hour of each other.',
        approach: 'accounts a JOIN accounts b ON b.device_id = a.device_id AND a.id < b.id AND b.created_at BETWEEN a.created_at - interval \'1 hour\' AND a.created_at + interval \'1 hour\'. Index device_id; popular devices can still explode — cap or pre-filter.',
      },
      {
        id: 'sj-t-flights',
        scenario: 'Travel site: list one-stop itineraries from SFO to BOS from a routes(src, dst, minutes) table, with total minutes.',
        approach: 'routes r1 JOIN routes r2 ON r2.src = r1.dst WHERE r1.src = \'SFO\' AND r2.dst = \'BOS\', total = r1.minutes + r2.minutes. Any number of stops needs a recursive CTE.',
      },
    ],
    confusable: ['lag-lead', 'recursive-hierarchy', 'joins-fanout'],
  },
];
