import type { Concept } from '../types';

/**
 * Performance track: indexes, sargability, reading plans, and query anti-patterns.
 * Variants and optimize exercises run on `big_orders` (200k rows) / `big_users` (20k rows);
 * worked examples use the small seeded tables so the pipeline visualizer can show every row.
 */

const btreeIndexes: Concept = {
  id: 'btree-indexes',
  track: 'performance',
  title: 'B-tree indexes: how a lookup really works',
  tagline: 'A sorted, shallow tree of pages that turns "read 200,000 rows" into "read 4 pages" — when the predicate is selective enough.',
  level: 'intermediate',
  minutes: 30,
  interview: 3,
  viz: 'index',
  intuition: [
    'Without an index, `WHERE user_id = 4242` has only one strategy: read **every** page of the table and test every row (a `Seq Scan`). On `big_orders` that is 1,666 pages and 200,000 comparisons to return 15 rows.',
    'A B-tree index is a **sorted copy of the key column(s)**, each entry pointing at the row\'s physical address (its TID: page number + slot). Because it is sorted, the database can binary-search it instead of scanning: find the first `4242`, walk forward while the key is still `4242`, done.',
    'The tree is **wide, not tall**. Each 8 kB page holds hundreds of keys (the fan-out), so a root page points to hundreds of internal pages, each pointing to hundreds of leaf pages. Even millions of rows need only 3–4 levels, which means a point lookup touches ~3–4 index pages plus the heap pages that hold the matches.',
    'An index is only worth it when it **filters out most rows**. `status = \'pending\'` (1% of rows) uses the index; `status = \'delivered\'` (94% of rows) does not — jumping from index to table 188k times in random order is slower than reading the table front to back once.',
  ],
  internals: [
    '**Structure.** Postgres B-trees are B+trees: the root and internal pages hold only separator keys and child pointers; all real entries `(key, TID)` live in the **leaf** level, and leaf pages are linked left↔right. A range predicate (`BETWEEN`, `>=`, prefix `LIKE`) descends once to the first matching leaf, then follows the sibling links — it never climbs back up the tree. Duplicate keys are deduplicated into posting lists, which is why `bo_user` (19,998 distinct users) is only 228 pages while the primary key is 551.',
    '**Three ways to use an index.** `Index Scan`: walk the index and fetch each heap tuple immediately, in index order — best for a few rows or when the order is needed. `Bitmap Index Scan` + `Bitmap Heap Scan`: collect all matching TIDs first, sort them by page, then read each heap page once — best for hundreds/thousands of rows scattered across the table (the plan shows `Heap Blocks: exact=736`). `Index Only Scan`: every column the query needs is in the index, so the heap is skipped for pages the **visibility map** marks all-visible (`Heap Fetches: 0`).',
    '**Why the planner sometimes ignores your index.** It estimates selectivity from `pg_statistic` (most-common values, histogram) and costs a random page read (`random_page_cost = 4`) at 4× a sequential one. Many random heap visits quickly cost more than one sequential pass. **Correlation** matters too: `id` is perfectly correlated with physical order, so even a range on the primary key uses a plain `Index Scan` (consecutive heap pages); `user_id` is uncorrelated, so ranges on it go through a bitmap.',
    '**Indexes are not free.** Every `INSERT` adds an entry to every index; an `UPDATE` that changes an indexed column (or cannot be done as a HOT update) writes new entries to all of them; leaf page splits and vacuum of dead entries add I/O. Indexes also take memory in the shared buffer cache. Index the columns real queries filter, join or sort on — not every column "just in case".',
  ],
  signals: [
    'A lookup by a key that returns a handful of rows out of millions ("orders of user X", "the row with id Y").',
    'A query that is fast in dev and slow in production — the table grew and a `Seq Scan` that was cheap at 1k rows is now reading GBs.',
    '"Why is Postgres not using my index?" — think selectivity, data type of the comparison, and whether a sequential read is honestly cheaper.',
    'Write-heavy tables with many indexes and slow inserts — the opposite side of the same trade-off.',
  ],
  template: `-- point / range lookup backed by a B-tree
CREATE INDEX big_orders_user_id_idx ON big_orders (user_id);

EXPLAIN ANALYZE
SELECT id, amount
FROM big_orders
WHERE user_id = 4242;          -- equality on the indexed column, same type`,
  realWorld: [
    {
      title: 'Foreign keys are not indexed automatically',
      body: 'Postgres indexes the primary key and UNIQUE constraints, but **not** the referencing column of a foreign key. `orders.user_id` without an index means every "orders for this customer" page view is a full table scan — and every `DELETE FROM users` has to scan `orders` to check the constraint. Indexing FK columns that you query by is one of the highest-value, lowest-risk changes in a real schema.',
    },
    {
      title: 'Status columns and partial indexes',
      body: 'A queue table where 99% of rows are `done` and the worker polls `WHERE status = \'pending\'` is the classic low-cardinality case. A full index on `status` mostly indexes rows nobody asks for. A **partial index** `CREATE INDEX … ON jobs (created_at) WHERE status = \'pending\'` stays tiny, stays hot in cache, and also gives the worker its order.',
    },
    {
      title: 'The write bill',
      body: 'An events table ingesting 50k rows/s with eight secondary indexes pays for eight extra B-tree inserts per row, plus WAL for each. Teams routinely drop unused indexes found via `pg_stat_user_indexes.idx_scan = 0` and see ingest throughput and vacuum times improve immediately.',
    },
  ],
  mistakes: [
    {
      title: 'Indexing low-selectivity columns and expecting a speed-up',
      why: 'For a value that matches a large fraction of the table, the planner correctly prefers a `Seq Scan`; the index is pure write overhead for that query.',
      fix: 'Index columns that are selective for the values you actually query, or use a partial index for the rare value (`WHERE status = \'pending\'`).',
    },
    {
      title: 'Comparing the indexed column as a different type',
      why: 'An index on `user_id int` answers `int = int`. `user_id::text = \'42\'` or `id = 123456.0` (numeric) forces a cast on every row, so the index can\'t be searched and the plan becomes a `Seq Scan` with a `Filter`.',
      fix: 'Cast the **constant**, not the column: `user_id = 42`, `user_id = ANY (\'{11,12,13}\'::int[])`.',
    },
    {
      title: 'Writing `<>` / `NOT IN` when you mean "the rare ones"',
      why: '`status <> \'delivered\'` is a negation: a B-tree can\'t descend to "everything except X", so it scans the table even though only 6% of rows match.',
      fix: 'Name the values you want positively — `status IN (\'cancelled\', \'pending\', \'shipped\')` — so each becomes an index search.',
    },
    {
      title: 'Adding an index per column instead of one that fits the query',
      why: 'Separate single-column indexes can be combined via `BitmapAnd`, but that is far less efficient than one composite index ordered for the query, and every extra index slows writes.',
      fix: 'Design indexes from the query workload (see composite & covering indexes) and check with `EXPLAIN` before and after.',
    },
  ],
  worked: {
    question: 'Show user 4\'s February orders, newest first. (The plan lab on the right runs the same lookup shape on 200,000 rows.)',
    sql: `SELECT id, ordered_at, status, amount
FROM orders
WHERE user_id = 4
  AND ordered_at >= '2024-02-01'
  AND ordered_at < '2024-03-01'
ORDER BY ordered_at DESC`,
    notes: {
      from: 'Logically, FROM hands **all 16 rows** to WHERE. Physically, that is exactly what a `Seq Scan` does. With an index on `user_id`, the executor would instead descend the B-tree to the first `4` and only ever touch user 4\'s 3 rows.',
      where: 'The filter is a conjunction of an equality and a half-open range. Both are **sargable**: the column stands alone on one side, so a B-tree on `(user_id, ordered_at)` could answer the whole WHERE with one descent plus a short leaf walk.',
      order: 'An index on `(user_id, ordered_at)` already stores user 4\'s rows sorted by `ordered_at`, so the plan could read it backwards and skip the Sort entirely.',
    },
    predictions: [
      {
        stage: 'where',
        kind: 'rowcount',
        question: 'How many of the 16 orders survive WHERE (user 4, February)?',
        explain: 'User 4 has orders 6, 7 and 8; order 8 is from March 10, so only 6 and 7 remain. Note the half-open range `< \'2024-03-01\'` — it includes all of Feb 29 without guessing the last timestamp.',
      },
      {
        stage: 'from',
        kind: 'choice',
        question: 'Same query shape on big_orders (200,000 rows), `WHERE user_id = 4242`, **no** index on user_id. How many rows does the Seq Scan test?',
        options: ['15 — only the matches', 'About 18 — a binary search', 'All 200,000', 'About 1,000 — one page per user'],
        answer: 2,
        explain: 'A Seq Scan has no way to jump: it reads all 1,666 pages and the plan shows `Rows Removed by Filter: 199985`. With `CREATE INDEX … (user_id)` the same query becomes a Bitmap Index Scan touching 3 index pages and 15 heap pages.',
      },
    ],
    takeaway: 'A B-tree turns "test every row" into "descend 3–4 pages, then read only the matches" — as long as the predicate is selective and compares the bare column with a value of the same type.',
  },
  build: {
    prompt: 'List the paid orders of users 1 and 4 (id, user_id, ordered_at, amount), newest first — a lookup an index on `(user_id)` would serve with two searches.',
    blocks: [
      { slot: 'select', sql: 'o.id', why: 'Order identifier.' },
      { slot: 'select', sql: 'o.user_id', why: 'Which of the two users it belongs to.' },
      { slot: 'select', sql: 'o.ordered_at', why: 'Needed for the newest-first ordering.' },
      { slot: 'select', sql: 'o.amount', why: 'The value of the order.' },
      { slot: 'from', sql: 'orders o', why: 'One table; the lookup key is `user_id`.' },
      { slot: 'where', sql: 'o.user_id IN (1, 4)', why: 'An IN list is two equality searches into a B-tree — sargable and exact.' },
      { slot: 'where', sql: "o.status = 'paid'", why: 'Positive equality on the value we want; applied as a filter on the few rows found.' },
      { slot: 'orderBy', sql: 'o.ordered_at DESC', why: 'Newest first, as asked.' },
    ],
    traps: [
      { slot: 'where', sql: 'o.user_id BETWEEN 1 AND 4', replaces: 'o.user_id IN (1, 4)', why: 'A range is also index-friendly, but it means users 1, 2, 3 **and** 4 — users 2 and 3 sneak in.' },
      { slot: 'where', sql: "o.status <> 'refunded'", replaces: "o.status = 'paid'", why: '"Not refunded" is not "paid": user 4\'s pending order 7 slips through. Negations are also unsearchable in a B-tree.' },
      { slot: 'orderBy', sql: 'o.id DESC', replaces: 'o.ordered_at DESC', why: 'Ids are not guaranteed to follow time: order 15 (Mar 5) has a higher id than order 8 (Mar 10).' },
    ],
  },
  variants: [
    {
      label: 'No index: Seq Scan',
      sql: `SELECT id, amount
FROM big_orders
WHERE user_id = 4242`,
      note: 'Baseline. The only plan is a `Seq Scan on big_orders` with `Filter: (user_id = 4242)`: all 1,666 pages are read, 199,985 rows are removed by the filter, 15 come out. Estimated cost ≈ 4,166.',
    },
    {
      label: 'Index on user_id: Bitmap Heap Scan',
      setup: 'CREATE INDEX bo_user ON big_orders (user_id);',
      sql: `SELECT id, amount
FROM big_orders
WHERE user_id = 4242`,
      note: 'Changed: added `bo_user`. The plan becomes `Bitmap Index Scan using bo_user` (Index Cond: user_id = 4242) feeding a `Bitmap Heap Scan` that visits 15 heap blocks. Cost drops from ≈4,166 to ≈42 — about 100× less work. Bitmap because the 15 matching rows sit on 15 different pages.',
    },
    {
      label: 'Only indexed columns needed: Index Only Scan',
      setup: 'CREATE INDEX bo_user ON big_orders (user_id);',
      sql: `SELECT count(*)
FROM big_orders
WHERE user_id = 4242`,
      note: 'Changed: the query needs nothing but `user_id`, which lives in the index. Plan: `Index Only Scan using bo_user`, cost ≈ 8.5 — the heap is not touched at all for all-visible pages (`Heap Fetches: 0`).',
    },
    {
      label: 'Range on an uncorrelated column: bitmap over many pages',
      setup: 'CREATE INDEX bo_user ON big_orders (user_id);',
      sql: `SELECT id, amount
FROM big_orders
WHERE user_id BETWEEN 4000 AND 4100`,
      note: 'Changed: equality → range. The B-tree descends once to 4000 and walks the leaf chain to 4100 (~960 entries), but those rows are scattered over ~736 heap pages, so the planner still uses a bitmap to read each page once in physical order. Cost rises to the hundreds — still far below a Seq Scan.',
    },
    {
      label: 'Range on the primary key: plain Index Scan',
      sql: `SELECT id, amount
FROM big_orders
WHERE id BETWEEN 1000 AND 1100`,
      note: 'Changed: range on `id` (primary key) instead of `user_id`. `id` follows the physical row order (correlation = 1), so the 101 matching rows sit on a few consecutive pages and a plain `Index Scan using big_orders_pkey` in key order is cheapest — no bitmap needed.',
    },
    {
      label: 'Low selectivity: index ignored',
      setup: 'CREATE INDEX bo_status ON big_orders (status);',
      sql: `SELECT id, amount
FROM big_orders
WHERE status = 'delivered'`,
      note: 'Changed: an index on `status`, querying the value held by 94% of rows (187,945). The planner reads the statistics, sees the index would return almost the whole table, and picks a `Seq Scan` anyway. The index exists — it just isn\'t the cheap path.',
    },
    {
      label: 'High selectivity: same index used',
      setup: 'CREATE INDEX bo_status ON big_orders (status);',
      sql: `SELECT id, amount
FROM big_orders
WHERE status = 'pending'`,
      note: 'Changed: only the value, `\'delivered\'` → `\'pending\'` (1,939 rows, 1%). Now the plan is an `Index Scan using bo_status`. Same index, same column — the decision is driven by how many rows the value matches.',
    },
  ],
  exercises: [
    {
      id: 'bt-status-in-list',
      kind: 'optimize',
      title: 'Count the non-delivered orders without a full scan',
      prompt: 'An ops dashboard shows how many orders are in each non-delivered status. `bo_status` exists (see setup), yet the query reads the whole table. Rewrite the WHERE so the index is actually searched. Same result; the plan must show an `Index Cond` (a filter applied while reading the whole table or index doesn\'t count).',
      difficulty: 'Easy',
      setup: 'CREATE INDEX bo_status ON big_orders (status);',
      starter: `SELECT status, count(*) AS orders
FROM big_orders
WHERE status <> 'delivered'
GROUP BY status
ORDER BY status`,
      solution: `SELECT status, count(*) AS orders
FROM big_orders
WHERE status IN ('cancelled', 'pending', 'shipped')
GROUP BY status
ORDER BY status`,
      plan: { mustContain: ['Index Cond'] },
      hints: [
        'A B-tree can descend to a value; it cannot descend to "everything except a value".',
        'Only four statuses exist. Which three do you want?',
        'Use `status IN (\'cancelled\', \'pending\', \'shipped\')`.',
      ],
      explanation: 'Each IN element becomes a separate index search, and since only `status` is needed the plan is an `Index Only Scan using bo_status` feeding a GroupAggregate — the 188k delivered rows are never touched. The `<>` version can also appear as an `Index Only Scan` with only a `Filter`: that reads all 200k index entries and discards most of them, which is why the requirement is an `Index Cond`, not merely "uses the index". Caveat: the rewrite hard-codes the domain; if a new status appears it is silently excluded, which is why a CHECK constraint or enum on `status` should back this kind of query.',
    },
    {
      id: 'bt-any-int-array',
      kind: 'optimize',
      title: 'Lookup by a list of ids from the API',
      prompt: 'An API endpoint receives user ids as a comma-separated string and fetches their orders. There is an index on `user_id` (see setup) but the plan is a Seq Scan. Fix the comparison so the B-tree can be searched. Same rows, no `Seq Scan on big_orders`.',
      difficulty: 'Medium',
      setup: 'CREATE INDEX bo_user ON big_orders (user_id);',
      starter: `SELECT id, user_id, amount
FROM big_orders
WHERE user_id::text = ANY (string_to_array('11,12,13', ','))
ORDER BY id`,
      solution: `SELECT id, user_id, amount
FROM big_orders
WHERE user_id = ANY ('{11,12,13}'::int[])
ORDER BY id`,
      plan: { mustNotContain: ['Seq Scan on big_orders'] },
      hints: [
        'Which side of the comparison is being cast? The index stores integers.',
        'Convert the list once (the constant side) instead of converting 200,000 column values.',
        '`user_id = ANY (\'{11,12,13}\'::int[])` or `string_to_array(…)::int[]`.',
      ],
      explanation: 'The index is ordered by integer comparison; `user_id::text` changes the operator to text comparison, which the index cannot answer, so every row is cast and compared. Casting the array to `int[]` keeps the column bare: the plan becomes a `Bitmap Index Scan using bo_user` with `Index Cond: (user_id = ANY (…))`. In application code, pass a typed array parameter rather than a string.',
    },
    {
      id: 'bt-index-sizes',
      kind: 'write',
      title: 'How big are the table and its indexes?',
      prompt: 'Before adding more indexes you want to see what the existing ones cost. With the indexes from setup in place, list `relname` and `relpages` (8 kB pages) from `pg_class` for `big_orders`, `big_orders_pkey`, `bo_user` and `bo_status`, largest first.',
      difficulty: 'Easy',
      setup: 'CREATE INDEX bo_user ON big_orders (user_id); CREATE INDEX bo_status ON big_orders (status);',
      solution: `SELECT relname, relpages
FROM pg_class
WHERE relname IN ('big_orders', 'big_orders_pkey', 'bo_user', 'bo_status')
ORDER BY relpages DESC`,
      hints: [
        '`pg_class` has one row per table and index; `relpages` is its size in pages.',
        'Filter with `relname IN (…)` and sort by `relpages DESC`.',
      ],
      explanation: 'The heap is 1,666 pages; the primary key 551; `bo_user` only 228 and `bo_status` 175 because B-tree deduplication stores each repeated key once with a list of TIDs. Indexes together are already ~57% of the table\'s size — every one of them is updated on every insert. `pg_relation_size(oid)` / `pg_size_pretty` give bytes; `pg_stat_user_indexes.idx_scan` tells you whether an index is ever used.',
    },
  ],
  judgment: [
    {
      id: 'bt-judge-not-in-status',
      kind: 'slow-query',
      title: 'The "open orders" widget times out',
      context: 'Ticket: "Open orders panel takes 2 s on the big tenant." An index on status was added last sprint (setup) but the plan still reads the whole table.',
      setup: 'CREATE INDEX bo_status ON big_orders (status);',
      sql: `SELECT id, user_id, status, amount
FROM big_orders
WHERE status NOT IN ('delivered', 'shipped')
ORDER BY id`,
      bugLines: [3],
      options: [
        { text: 'The negated predicate cannot be turned into an index search; list the wanted statuses positively.', correct: true, why: 'NOT IN on a B-tree column is a filter over every row. `status IN (\'cancelled\', \'pending\')` becomes two index searches over ~6k rows.' },
        { text: 'ORDER BY id forces the Seq Scan; remove it.', why: 'Sorting 6k rows is cheap; the Seq Scan is chosen because of the WHERE shape, not the ORDER BY.' },
        { text: 'The index needs to be rebuilt with REINDEX.', why: 'The index is fine; the planner can\'t use it for a negation.' },
        { text: 'Add `id` to the index so it covers the query.', why: 'Coverage doesn\'t help if the predicate can\'t be searched in the first place.' },
      ],
      fixedSql: `SELECT id, user_id, status, amount
FROM big_orders
WHERE status IN ('cancelled', 'pending')
ORDER BY id`,
      comparePlans: true,
      lesson: 'Indexes answer "where is X", not "where is everything but X". Rewrite negations of a small domain as positive IN lists (backed by a constraint on the domain) or use a partial index on the rare values.',
    },
  ],
  recall: [
    { q: 'Why is a B-tree over 200,000 rows only about 3 levels deep?', a: 'Each 8 kB page holds hundreds of keys (high fan-out), so each level multiplies reach by hundreds: root → hundreds of internal pages → tens of thousands of leaves.' },
    { q: 'How does a range scan move through a B+tree?', a: 'It descends once to the first matching leaf entry, then follows the leaf-to-leaf sibling links until the key leaves the range.' },
    { q: 'When does the planner choose a Bitmap Heap Scan instead of an Index Scan?', a: 'When many matching rows are scattered across pages: it collects TIDs, sorts them by page, and reads each heap page once instead of random-hopping per row.' },
    { q: 'What does an Index Only Scan need?', a: 'All referenced columns in the index, and heap pages marked all-visible in the visibility map (otherwise it fetches the heap to check visibility — see Heap Fetches).' },
  ],
  transfer: [
    { id: 'bt-t-ticket-lookup', scenario: 'A support tool looks up tickets by `customer_id` (2M tickets, ~10 per customer) and is getting slower every month.', approach: 'Index `customer_id` (probably as `(customer_id, created_at)` if the UI shows newest first); verify the plan moves from Seq Scan to an index or bitmap scan.' },
    { id: 'bt-t-flag-column', scenario: 'Someone proposes an index on `is_deleted` (99.5% false) to speed up `WHERE NOT is_deleted`.', approach: 'The common value isn\'t selective: the planner will Seq Scan anyway. A partial index on what you search (e.g. `WHERE is_deleted`) or on other columns `WHERE NOT is_deleted` is the useful version.' },
    { id: 'bt-t-ingest', scenario: 'An append-only clickstream table has 9 indexes and inserts are falling behind.', approach: 'Check `pg_stat_user_indexes` for unused indexes, drop them, and keep only indexes that serve real queries — every index is paid for on every insert.' },
  ],
  confusable: ['composite-covering', 'sargability', 'explain-joins'],
};

const compositeCovering: Concept = {
  id: 'composite-covering',
  track: 'performance',
  title: 'Composite & covering indexes',
  tagline: 'Column order decides which queries an index can serve; INCLUDE columns let it answer them without touching the table.',
  level: 'advanced',
  minutes: 35,
  interview: 3,
  viz: 'index',
  intuition: [
    'A composite index on `(status, created_at)` is sorted like a phone book sorted by last name, then first name: all `cancelled` entries first (in time order), then all `delivered` (in time order), and so on. Finding "pending orders since October" is one jump to `(pending, 2024-10-01)` and a walk to the end of the pending block.',
    'The same phone book is useless for "everyone named Anna" — first names are scattered across every last name. That is the **leftmost-prefix rule**: an index on `(a, b, c)` can be searched by `a`, by `a, b`, or by `a, b, c`, but not efficiently by `b` alone.',
    'Put **equality columns first, then the range or sort column**. With `status = \'pending\'` fixed, the `created_at` values inside that block are contiguous and sorted, so both the range filter and `ORDER BY created_at DESC LIMIT 20` come straight out of the index — no Sort node, and the scan stops after 20 entries.',
    'If the index also contains every column the query reads, Postgres can answer from the index alone (`Index Only Scan`). `INCLUDE (amount)` adds payload columns to the leaf entries without making them part of the sort key.',
  ],
  internals: [
    '**Index Cond vs Filter.** In a plan, `Index Cond` is what bounds the B-tree descent and leaf walk; `Filter` is checked row-by-row after fetching. With `(created_at, status)` and `status = \'pending\' AND created_at >= …`, both columns appear in Index Cond, but the walk still covers **every** order since October (all statuses) and discards 98% — the range on the first column decides the walk length. With `(status, created_at)` the walk covers only pending orders since October.',
    '**Sort elimination.** A B-tree can be read forwards or backwards (`Index Scan Backward`), so `(status, created_at)` serves both `ORDER BY created_at` and `ORDER BY created_at DESC` after an equality on `status`. Mixed directions (`created_at DESC, id ASC`) don\'t match either direction of `(status, created_at, id)`; Postgres falls back to an `Incremental Sort` (sort only within equal `created_at` groups) or a full Sort. `NULLS FIRST/LAST` must match too: a default ASC index stores NULLs last, so `DESC NULLS LAST` cannot be read backwards from it.',
    '**Skip scan (Postgres 18+).** When the leading column has few distinct values, the planner can still use `(status, created_at)` for a predicate on `created_at` alone by doing one descent per distinct `status` (the plan shows `Index Searches: 4`). It is a rescue, not a design: with a high-cardinality leading column (`user_id`) it is hopeless and you get a Seq Scan.',
    '**Covering and INCLUDE.** `CREATE INDEX … (status, created_at) INCLUDE (amount)` stores `amount` only in leaf entries: it can\'t be searched or sorted on, but it lets `SELECT created_at, amount` skip the heap. Index-only scans still consult the visibility map; on a table with many recently-modified pages, `Heap Fetches` climbs and the advantage shrinks until VACUUM runs. Wider indexes cost more space and write amplification — cover only hot queries.',
  ],
  signals: [
    'A query that filters on one column and sorts or ranges on another: "pending orders, newest first", "this user\'s events since Monday".',
    'A plan with an index scan **plus** a big `Filter: … Rows Removed` or a separate `Sort` above it — the index matches only part of the query.',
    '"Top N" / pagination queries with `ORDER BY … LIMIT` that should stop after N rows.',
    'A hot query that reads only 2–3 columns and still does thousands of heap fetches — a covering index candidate.',
  ],
  template: `-- equality columns first, then the range / sort column, then payload
CREATE INDEX big_orders_status_created_idx
  ON big_orders (status, created_at) INCLUDE (amount);

SELECT created_at, amount
FROM big_orders
WHERE status = 'pending'               -- equality on the leading column
  AND created_at >= '2024-10-01'       -- range on the next column
ORDER BY created_at DESC               -- same order as the index (read backwards)
LIMIT 20;`,
  realWorld: [
    {
      title: 'Multi-tenant SaaS: tenant_id first',
      body: 'Almost every query in a multi-tenant schema has `WHERE tenant_id = $1`. Indexes like `(tenant_id, created_at)` or `(tenant_id, status, updated_at)` keep each tenant\'s rows contiguous in the index, so a large tenant doesn\'t slow down a small one\'s queries — and the leftmost prefix `(tenant_id)` is served by the same index.',
    },
    {
      title: 'Feeds and inboxes',
      body: '"Latest 50 messages in conversation X" is `WHERE conversation_id = $1 ORDER BY sent_at DESC LIMIT 50`. With `(conversation_id, sent_at)` it reads exactly 50 index entries regardless of whether the conversation has 60 or 6 million messages. Without it, Postgres reads all of them and sorts.',
    },
    {
      title: 'Covering indexes for dashboards',
      body: 'A metrics endpoint polled every few seconds computing `sum(amount)` per day for one merchant can be served by `(merchant_id, created_at) INCLUDE (amount)` with an index-only scan — a few cached index pages instead of thousands of heap pages per request.',
    },
  ],
  mistakes: [
    {
      title: 'Range column first',
      why: '`(created_at, status)` with `created_at >= X AND status = \'pending\'` walks every row since X across all statuses; the status condition only trims after the fact.',
      fix: 'Order key columns as: equality predicates, then the one range / ORDER BY column. `(status, created_at)`.',
    },
    {
      title: 'Expecting an index on (a, b) to help a query on b',
      why: 'Entries are sorted by `a` first, so `b` values are scattered. At best you get a skip scan over few `a` values; usually a Seq Scan.',
      fix: 'Create an index that starts with `b`, or check whether the query can also constrain `a`.',
    },
    {
      title: 'ORDER BY that doesn\'t match the index order',
      why: 'Mixed directions or `NULLS LAST` on a default ASC index force a Sort (and the whole matching set has to be read before the LIMIT applies).',
      fix: 'Match the index (`ORDER BY created_at DESC, id DESC`), or build the index with the needed directions: `(status, created_at DESC, id ASC)`.',
    },
    {
      title: 'Throwing every column into INCLUDE',
      why: 'A "covering" index that duplicates half the table doubles write cost and cache footprint, and `SELECT *` still can\'t use it index-only.',
      fix: 'Cover only the columns of a few hot, read-heavy queries; select only the columns you need.',
    },
  ],
  worked: {
    question: 'Show the 3 most recent paid orders. Which index would let Postgres stop after reading just 3 entries?',
    sql: `SELECT id, user_id, ordered_at, amount
FROM orders
WHERE status = 'paid'
ORDER BY ordered_at DESC
LIMIT 3`,
    notes: {
      where: 'Equality on `status` — the natural **leading** column. In an index on `(status, ordered_at)` all 12 paid orders form one contiguous block, already sorted by `ordered_at`.',
      order: 'Without a matching index this is a real Sort of all 12 survivors. With `(status, ordered_at)` the executor reads the paid block **backwards** (`Index Scan Backward`) and rows come out already in this order.',
      limit: 'LIMIT stops the pipeline: with the index, the scan reads 3 entries and ends. Without it, everything had to be filtered and sorted first — the cost difference grows with table size.',
    },
    predictions: [
      {
        stage: 'where',
        kind: 'rowcount',
        question: 'How many orders have status = \'paid\'?',
        explain: '12 of 16 orders are paid (7 and 12 are pending, 4 and 14 refunded). Without a suitable index every one of them must be sorted before LIMIT can pick 3.',
      },
      {
        stage: 'limit',
        kind: 'choice',
        question: 'On big_orders, which index lets `WHERE status = \'pending\' ORDER BY created_at DESC LIMIT 20` read only ~20 index entries and skip the Sort?',
        options: ['(created_at)', '(created_at, status)', '(status, created_at)', '(status) plus a separate (created_at)'],
        answer: 2,
        explain: 'Equality column first, sort column second: `(status, created_at)` keeps each status\'s rows sorted by time, so a backward walk from the end of the pending block yields the newest 20 directly. `(created_at, status)` mixes all statuses together and must skip non-pending rows.',
      },
    ],
    takeaway: 'Order composite keys as equality columns, then the range/sort column; then ORDER BY … LIMIT reads only LIMIT entries, and INCLUDE columns can make it index-only.',
  },
  build: {
    prompt: 'Return the 3 most recent paid orders (id, user_id, ordered_at, amount) with a deterministic tie-breaker — the exact shape an index on `(status, ordered_at, id)` serves without a Sort.',
    blocks: [
      { slot: 'select', sql: 'o.id', why: 'Order id, also the tie-breaker.' },
      { slot: 'select', sql: 'o.user_id', why: 'Who placed it.' },
      { slot: 'select', sql: 'o.ordered_at', why: 'The sort key.' },
      { slot: 'select', sql: 'o.amount', why: 'Order value.' },
      { slot: 'from', sql: 'orders o', why: 'Single table.' },
      { slot: 'where', sql: "o.status = 'paid'", why: 'Equality on the leading index column.' },
      { slot: 'orderBy', sql: 'o.ordered_at DESC', why: 'Second index column, read backwards.' },
      { slot: 'orderBy', sql: 'o.id DESC', why: 'Tie-breaker in the **same direction**, so the index can still be read in one backward pass.' },
      { slot: 'limit', sql: '3', why: 'With a matching index the scan stops after 3 entries.' },
    ],
    traps: [
      { slot: 'where', sql: "o.status <> 'refunded'", replaces: "o.status = 'paid'", why: 'Pending order 12 (Mar 20) becomes the "most recent paid order" — wrong rows, and a negation can\'t lead an index search.' },
      { slot: 'orderBy', sql: 'o.ordered_at ASC', replaces: 'o.ordered_at DESC', why: 'Ascending gives the three **oldest** paid orders.' },
    ],
  },
  variants: [
    {
      label: 'No index: Seq Scan + top-N sort',
      sql: `SELECT id, created_at, amount
FROM big_orders
WHERE status = 'pending' AND created_at >= '2024-10-01'
ORDER BY created_at DESC
LIMIT 20`,
      note: 'Baseline: `Seq Scan on big_orders` filters all 200,000 rows, then `Sort` (top-N heapsort) keeps the newest 20. Cost ≈ 4,700 regardless of the LIMIT.',
    },
    {
      label: 'Single-column (status)',
      setup: 'CREATE INDEX bo_status ON big_orders (status);',
      sql: `SELECT id, created_at, amount
FROM big_orders
WHERE status = 'pending' AND created_at >= '2024-10-01'
ORDER BY created_at DESC
LIMIT 20`,
      note: 'Changed: index on `status` only. Plan: `Index Scan using bo_status` (Index Cond: status) + `Filter` on created_at, then a `Sort`. It reads all ~1,900 pending rows from the heap to keep ~250, then sorts. Cost ≈ 1,000 — better, but the Sort and the filter remain.',
    },
    {
      label: 'Wrong column order (created_at, status)',
      setup: 'CREATE INDEX bo_created_status ON big_orders (created_at, status);',
      sql: `SELECT id, created_at, amount
FROM big_orders
WHERE status = 'pending' AND created_at >= '2024-10-01'
ORDER BY created_at DESC
LIMIT 20`,
      note: 'Changed: composite index, range column first. Plan: `Index Scan Backward using bo_created_status` — no Sort, both columns in `Index Cond`, but walking backwards from the newest order it must step over every delivered/shipped/cancelled entry to find 20 pending ones. Cost ≈ 97 (≈1,100 for the full range).',
    },
    {
      label: 'Right column order (status, created_at)',
      setup: 'CREATE INDEX bo_status_created ON big_orders (status, created_at);',
      sql: `SELECT id, created_at, amount
FROM big_orders
WHERE status = 'pending' AND created_at >= '2024-10-01'
ORDER BY created_at DESC
LIMIT 20`,
      note: 'Changed: equality column first. `Index Scan Backward using bo_status_created` jumps to the end of the pending block and reads exactly 20 entries, all matches. Cost ≈ 44 — about half the previous variant and 100× the baseline.',
    },
    {
      label: 'Covering: INCLUDE payload → Index Only Scan',
      setup: 'CREATE INDEX bo_status_created_cov ON big_orders (status, created_at) INCLUDE (amount);',
      sql: `SELECT created_at, amount
FROM big_orders
WHERE status = 'pending' AND created_at >= '2024-10-01'
ORDER BY created_at DESC
LIMIT 20`,
      note: 'Changed: `INCLUDE (amount)` and the query selects only indexed columns. Plan: `Index Only Scan Backward` — the 20 heap visits disappear (Heap Fetches: 0 on all-visible pages). Add `id` to the SELECT without adding it to the index and you\'re back to an Index Scan.',
    },
    {
      label: 'Leading column missing: skip scan',
      setup: 'CREATE INDEX bo_status_created ON big_orders (status, created_at);',
      sql: `SELECT id, amount
FROM big_orders
WHERE created_at >= '2024-12-20'`,
      note: 'Changed: no predicate on the leading `status`. Postgres 18+ can still use the index by skipping through the 4 distinct statuses (one descent each — `Index Searches` in ANALYZE). This only works because the leading column has very few values.',
    },
    {
      label: 'Leading column missing, high cardinality: Seq Scan',
      setup: 'CREATE INDEX bo_user_created ON big_orders (user_id, created_at);',
      sql: `SELECT id, amount
FROM big_orders
WHERE created_at >= '2024-12-20'`,
      note: 'Changed: leading column is `user_id` (≈20,000 distinct values). Skipping would mean ~20,000 descents, so the planner gives up and reads the table: `Seq Scan on big_orders`. Leftmost-prefix rule in action.',
    },
  ],
  exercises: [
    {
      id: 'cc-mixed-direction',
      kind: 'optimize',
      title: 'Remove the sort from the pending-orders feed',
      prompt: 'The pending-orders feed uses the index in setup, `(status, created_at, id)`, but the plan still contains a sort step. Make the ORDER BY match the index so rows stream straight out of it. Same 20 rows in the same order; no `Sort` in the plan.',
      difficulty: 'Medium',
      setup: 'CREATE INDEX bo_status_created_id ON big_orders (status, created_at, id);',
      starter: `SELECT id, created_at
FROM big_orders
WHERE status = 'pending'
ORDER BY created_at DESC, id
LIMIT 20`,
      solution: `SELECT id, created_at
FROM big_orders
WHERE status = 'pending'
ORDER BY created_at DESC, id DESC
LIMIT 20`,
      plan: { mustNotContain: ['Sort'] },
      hints: [
        'The index can be read forwards (created_at ASC, id ASC) or backwards (created_at DESC, id DESC). Which one does your ORDER BY match?',
        '`id` is only a tie-breaker; its direction is your choice as long as it is consistent between pages.',
        'Use `ORDER BY created_at DESC, id DESC`.',
      ],
      explanation: 'With `created_at DESC, id ASC` the index order matches only the first key, so Postgres adds an `Incremental Sort` to fix the order inside equal timestamps. Flipping the tie-breaker to DESC makes the whole ORDER BY the exact reverse of the index, giving a pure `Index Only Scan Backward` that stops after 20 entries. If the product truly needs `id ASC` within a timestamp, build the index as `(status, created_at DESC, id)` instead.',
    },
    {
      id: 'cc-lateral-latest',
      kind: 'optimize',
      title: 'Latest order per recent Japanese user',
      prompt: 'For JP users who signed up since 2023-12-01, return each user\'s latest order. The DISTINCT ON version reads every order of those users and sorts them. With the index in setup on `(user_id, created_at)`, rewrite it so each user costs one short backward index probe. Same rows; the plan must read the index backward (`Direction: Backward`) and have no `Unique` step.',
      difficulty: 'Hard',
      setup: 'CREATE INDEX bo_user_created ON big_orders (user_id, created_at);',
      starter: `SELECT DISTINCT ON (u.id) u.id, o.id AS order_id, o.created_at
FROM big_users u
JOIN big_orders o ON o.user_id = u.id
WHERE u.country = 'JP' AND u.created_at >= '2023-12-01'
ORDER BY u.id, o.created_at DESC`,
      solution: `SELECT u.id, l.order_id, l.created_at
FROM big_users u
CROSS JOIN LATERAL (
  SELECT o.id AS order_id, o.created_at
  FROM big_orders o
  WHERE o.user_id = u.id
  ORDER BY o.created_at DESC
  LIMIT 1
) l
WHERE u.country = 'JP' AND u.created_at >= '2023-12-01'
ORDER BY u.id`,
      plan: { mustContain: ['Direction: Backward'], mustNotContain: ['Unique'] },
      hints: [
        'For one user, `WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1` is a single backward probe of `(user_id, created_at)`.',
        'A LATERAL subquery runs once per outer row and can reference `u.id`.',
        '`CROSS JOIN LATERAL (SELECT … WHERE o.user_id = u.id ORDER BY o.created_at DESC LIMIT 1) l`.',
      ],
      explanation: 'The LATERAL version becomes a Nested Loop: for each of the ~85 users, `Limit → Index Scan Backward using bo_user_created` reads one entry. DISTINCT ON has to fetch all ~850 orders of those users, sort them and keep the first per user with `Unique` (cost ≈ 3,800 vs ≈ 880). LATERAL wins when the outer set is small and each group is large; for "latest per user across all users" a single sorted pass (DISTINCT ON / window) is usually better.',
    },
    {
      id: 'cc-nulls-last',
      kind: 'optimize',
      title: 'Top 5 orders by amount',
      prompt: 'The "biggest orders" widget sorts 200,000 rows every time, even though `(amount, id)` is indexed (setup) and `amount` is declared NOT NULL. Make the ORDER BY readable straight from the index. Same 5 rows in the same order; plan must contain `Index Only Scan` and no `Sort`.',
      difficulty: 'Medium',
      setup: 'CREATE INDEX bo_amount_id ON big_orders (amount, id);',
      starter: `SELECT id, amount
FROM big_orders
ORDER BY amount DESC NULLS LAST, id DESC
LIMIT 5`,
      solution: `SELECT id, amount
FROM big_orders
ORDER BY amount DESC, id DESC
LIMIT 5`,
      plan: { mustContain: ['Index Only Scan'], mustNotContain: ['Sort'] },
      hints: [
        'A default B-tree stores NULLs last in ascending order. What does reading it backwards give you?',
        'Since `amount` can\'t be NULL, `NULLS LAST` changes nothing about the result — only about the plan.',
        'Drop `NULLS LAST`.',
      ],
      explanation: 'Read backwards, an ASC NULLS LAST index yields `DESC NULLS FIRST` — the default for DESC. Asking for `DESC NULLS LAST` doesn\'t match, so Postgres scans everything and sorts (cost ≈ 7,000). Without it the plan is `Limit → Index Only Scan Backward` with cost < 1. On a nullable column where NULLs must go last, create the index as `(amount DESC NULLS LAST, id DESC)` instead.',
    },
  ],
  judgment: [
    {
      id: 'cc-judge-select-star',
      kind: 'slow-query',
      title: 'The covering index that covers nothing',
      context: 'PR: "Added a covering index `(user_id) INCLUDE (amount)` for the revenue-by-user service." The service only reads `user_id` and `amount`, but latency didn\'t move.',
      setup: 'CREATE INDEX bo_user_cov ON big_orders (user_id) INCLUDE (amount);',
      sql: `SELECT *
FROM big_orders
WHERE user_id BETWEEN 4000 AND 4100`,
      bugLines: [1],
      options: [
        { text: '`SELECT *` needs columns that are not in the index, so every match still goes to the heap.', correct: true, why: 'An index-only scan requires all referenced columns in the index. Selecting `user_id, amount` turns ~730 heap page reads into an Index Only Scan.' },
        { text: 'INCLUDE columns can\'t be returned from an index.', why: 'They can — that is their purpose. They just can\'t be searched or sorted on.' },
        { text: 'BETWEEN can\'t use a B-tree; use `IN`.', why: 'BETWEEN is a range and is fully sargable; the plan shows it in Index Cond.' },
        { text: 'The index must be `(user_id, amount)` instead of INCLUDE.', why: 'A key column would work too, but it isn\'t the problem; the extra columns from `*` are.' },
      ],
      fixedSql: `SELECT user_id, amount
FROM big_orders
WHERE user_id BETWEEN 4000 AND 4100`,
      comparePlans: true,
      lesson: 'A covering index covers a specific column list. `SELECT *` silently turns an index-only scan into heap fetches — select the columns you use.',
    },
  ],
  recall: [
    { q: 'State the leftmost-prefix rule.', a: 'An index on (a, b, c) can be searched efficiently by a, (a, b) or (a, b, c); a predicate on b or c alone can\'t bound the scan (except via skip scan with few distinct a values).' },
    { q: 'Why equality columns before the range column?', a: 'With the equality columns fixed, the range column is contiguous and sorted, so the walk covers only matches; a leading range column makes the walk cover all values of the later columns too.' },
    { q: 'How can an index remove a Sort?', a: 'If ORDER BY matches the index key order (or its exact reverse) after the equality-fixed columns, rows come out already sorted, and LIMIT can stop the scan early.' },
    { q: 'What do INCLUDE columns do?', a: 'Store extra columns in the leaf entries only (not part of the key), so queries that read them can use an Index Only Scan without changing search/sort behaviour.' },
  ],
  transfer: [
    { id: 'cc-t-chat', scenario: 'A chat app shows the latest 50 messages per conversation and the query plan sorts 2M rows per request for big group chats.', approach: 'Index `(conversation_id, sent_at)` (plus `id` as a tie-breaker in the same direction) and keep `ORDER BY sent_at DESC LIMIT 50` matching it.' },
    { id: 'cc-t-tenant', scenario: 'Every query in a multi-tenant app filters by `tenant_id`; the existing index is `(created_at, tenant_id)` and big tenants slow down small ones.', approach: 'Reorder to `(tenant_id, created_at)`: equality first so each tenant\'s slice is contiguous; the old index likely becomes redundant.' },
  ],
  confusable: ['btree-indexes', 'sargability', 'top-n-per-group'],
};

const sargability: Concept = {
  id: 'sargability',
  track: 'performance',
  title: 'Sargable predicates',
  tagline: 'An index can only be searched when the indexed column stands alone on one side of the comparison — wrap it in a function and the index goes blind.',
  level: 'intermediate',
  minutes: 30,
  interview: 3,
  viz: 'index',
  intuition: [
    '**SARGable** = "Search ARGument-able": a predicate the database can turn into an index search. The rule of thumb: the indexed column must appear **bare** on one side, compared with something that is constant for the duration of the scan.',
    'An index on `created_at` is sorted by `created_at`, not by `date_trunc(\'day\', created_at)` or `created_at::date`. The database can\'t know where "all rows whose truncated day is June 15" begin without computing the function for every row — so it scans.',
    'The fix is almost always to **move the work to the constant side**: `created_at >= \'2024-06-15\' AND created_at < \'2024-06-16\'` is the same set of rows as `created_at::date = \'2024-06-15\'`, and it is a plain range on the index.',
    'When you can\'t rewrite (case-insensitive email lookup, a computed key), index the expression itself: `CREATE INDEX … ON users (lower(email))`. The query must then use **exactly** that expression.',
  ],
  internals: [
    '**Operators belong to an operator class.** A B-tree on `int` supports `<, <=, =, >=, >` for `int` (and compatible integer types). `id = 123456.0` compares with `numeric`, so Postgres casts the column (`(id)::numeric = 123456.0`) — a different operator the index doesn\'t implement — and the plan shows a `Filter` on a `Seq Scan`. Same for `user_id::text = \'42\'`. Implicit casts on the **constant** side are fine; on the **column** side they kill the index.',
    '**Functions also blind the statistics.** For `date_trunc(\'day\', created_at) = …` the planner has no histogram for the expression and falls back to default selectivities (e.g. 0.5% → `rows=1000`), so a bad predicate can misestimate badly and drag the rest of the plan (join order, join method) with it. An expression index gets its own statistics after `ANALYZE`, which fixes both problems.',
    '**LIKE and pattern matching.** `email LIKE \'user77%\'` is a range (`>= \'user77\' AND < \'user78\'`) and can use a B-tree **if the collation sorts bytewise** (`C`) or the index uses `text_pattern_ops` — in a typical `en_US.UTF-8` database you need `CREATE INDEX … (email text_pattern_ops)`. A leading wildcard `LIKE \'%@mail.com\'` has no starting point in a sorted structure: Seq Scan, or a trigram GIN index (`pg_trgm`). `ILIKE` is not B-tree-searchable at all; use `lower(col)` with an expression index or the `citext` type.',
    '**OR across different columns** can\'t be one B-tree range. Postgres can answer it with a `BitmapOr` of two index scans — but only if **every** branch is indexable; one unindexed branch forces a Seq Scan for the whole predicate. Arithmetic on the column (`amount * 1.18 > 589`) is the same story as a function: solve for the column (`amount > 589 / 1.18`).',
  ],
  signals: [
    'A WHERE clause with `date_trunc`, `::date`, `extract`, `lower`, `coalesce`, `substring` or arithmetic applied to an indexed column.',
    '"Orders from June", "events on a given day", "case-insensitive email lookup", "search by suffix" requirements.',
    'A plan with `Seq Scan … Filter: (some_function(col) = …)` even though `col` is indexed.',
    'Wildly wrong row estimates (`rows=1000` for a predicate that matches 270) on computed predicates.',
  ],
  template: `-- not sargable: function on the column
--   WHERE created_at::date = '2024-06-15'
-- sargable: bare column, half-open range on the constant side
SELECT id, amount
FROM big_orders
WHERE created_at >= '2024-06-15'
  AND created_at <  '2024-06-16';

-- when the expression is unavoidable, index the expression
CREATE INDEX big_users_lower_email_idx ON big_users (lower(email));
SELECT id FROM big_users WHERE lower(email) = lower('User777@Mail.com');`,
  realWorld: [
    {
      title: 'Daily reports that scan years of data',
      body: 'A BI query "yesterday\'s orders" written as `WHERE created_at::date = current_date - 1` scans the entire orders table every morning. Rewritten as `created_at >= current_date - 1 AND created_at < current_date` it reads one day of index entries. On a 500M-row table this is the difference between minutes and milliseconds.',
    },
    {
      title: 'Login by email',
      body: 'Users type `Ana@Example.com`, the database stored `ana@example.com`. `WHERE lower(email) = lower($1)` with a plain index on `email` is a Seq Scan on every login. A unique index on `lower(email)` both makes it a point lookup **and** enforces case-insensitive uniqueness — two bugs fixed by one index.',
    },
    {
      title: 'ORM-generated type mismatches',
      body: 'An ORM binds a Java `BigDecimal` or a string parameter against an integer key, Postgres casts the column, and a lookup that used to take 1 ms takes 800 ms. `EXPLAIN` shows `Filter: ((id)::numeric = …)` — the tell-tale cast on the column side. The fix is in the parameter type, not the database.',
    },
  ],
  mistakes: [
    {
      title: 'Truncating the column to match a date',
      why: '`date_trunc(\'month\', created_at) = \'2024-03-01\'` or `extract(month FROM created_at) = 3` must evaluate the function for every row; the index on `created_at` is ignored.',
      fix: 'Half-open range: `created_at >= \'2024-03-01\' AND created_at < \'2024-04-01\'`.',
    },
    {
      title: 'Rewriting with BETWEEN on timestamps',
      why: '`created_at BETWEEN \'2024-03-01\' AND \'2024-03-31\'` is sargable but drops everything after midnight on March 31.',
      fix: 'Always use `>= start AND < next_start` for timestamp ranges.',
    },
    {
      title: 'Indexing an expression but querying a different one',
      why: 'An index on `lower(email)` is not used by `email ILIKE …` or `upper(email) = …`: the planner matches expressions structurally.',
      fix: 'Write the predicate with exactly the indexed expression: `lower(email) = lower($1)`.',
    },
    {
      title: 'Mixing indexed and unindexed columns in an OR',
      why: '`WHERE user_id = 42 OR note LIKE \'%refund%\'` must check every row for the second branch, so the index on `user_id` can\'t help at all.',
      fix: 'Index every branch so a `BitmapOr` is possible, or split into `UNION` of two queries each with its own access path.',
    },
  ],
  worked: {
    question: 'List February 2024 orders in time order — written so that an index on `ordered_at` could answer it.',
    sql: `SELECT id, user_id, ordered_at, amount
FROM orders
WHERE ordered_at >= '2024-02-01'
  AND ordered_at < '2024-03-01'
ORDER BY ordered_at`,
    notes: {
      from: 'All 16 orders enter logically. With an index on `ordered_at`, the physical plan would never touch the January and March rows.',
      where: 'The column is **bare** on both comparisons and the bounds are constants: this is a single contiguous range of the index, `[\'2024-02-01\', \'2024-03-01\')`. The half-open upper bound includes every instant of Feb 29 without knowing the precision of the timestamp.',
      order: 'The range comes out of the index already in `ordered_at` order, so the Sort is free with an index.',
    },
    predictions: [
      {
        stage: 'where',
        kind: 'rowcount',
        question: 'How many orders fall in February 2024?',
        explain: 'Orders 6, 7, 9, 10 and 4 (Feb 3, 3, 11, 19 and 14). Five rows — and with an index, five index entries read.',
      },
      {
        stage: 'where',
        kind: 'choice',
        question: 'Which predicate is equivalent to `date_trunc(\'month\', ordered_at) = \'2024-02-01\'` **and** sargable on an index on `ordered_at`?',
        options: [
          "ordered_at BETWEEN '2024-02-01' AND '2024-02-29'",
          "ordered_at >= '2024-02-01' AND ordered_at < '2024-03-01'",
          'extract(month FROM ordered_at) = 2',
          "ordered_at::date >= '2024-02-01' AND ordered_at::date < '2024-03-01'",
        ],
        answer: 1,
        explain: 'BETWEEN stops at Feb 29 00:00 and loses the rest of that day. `extract(month …)` matches February of **every** year and isn\'t sargable. The `::date` version is correct but wraps the column, so the index is ignored. Only the half-open range is both right and indexable.',
      },
    ],
    takeaway: 'Keep the indexed column bare and move all computation to the constant side; for timestamps that means `>= start AND < next_start`.',
  },
  build: {
    prompt: 'Daily paid revenue for February 2024 (day, number of orders, revenue), in date order — with a WHERE an index on `ordered_at` can search.',
    blocks: [
      { slot: 'select', sql: 'ordered_at::date AS day', why: 'Truncating in SELECT / GROUP BY is fine — only the WHERE needs to stay sargable.' },
      { slot: 'select', sql: 'count(*) AS orders', why: 'Paid orders that day.' },
      { slot: 'select', sql: 'sum(amount) AS revenue', why: 'Revenue that day.' },
      { slot: 'from', sql: 'orders', why: 'Single table.' },
      { slot: 'where', sql: "ordered_at >= '2024-02-01'", why: 'Lower bound on the bare column.' },
      { slot: 'where', sql: "ordered_at < '2024-03-01'", why: 'Half-open upper bound: everything before March, whatever the time of day.' },
      { slot: 'where', sql: "status = 'paid'", why: 'Only paid orders count as revenue.' },
      { slot: 'groupBy', sql: 'ordered_at::date', why: 'One group per calendar day.' },
      { slot: 'orderBy', sql: 'day', why: 'Chronological report.' },
    ],
    traps: [
      { slot: 'where', sql: "ordered_at <= '2024-02-19'", replaces: "ordered_at < '2024-03-01'", why: 'A date literal compared with a timestamp means **midnight**: order 10 at 2024-02-19 11:11 is silently excluded, and so is the rest of February.' },
      { slot: 'where', sql: "status <> 'refunded'", replaces: "status = 'paid'", why: 'Pending order 7 is counted as revenue on Feb 3.' },
      { slot: 'orderBy', sql: 'revenue DESC', replaces: 'day', why: 'Sorts by revenue, not chronologically — the report reads out of order.' },
    ],
  },
  variants: [
    {
      label: 'Function on the column: Seq Scan',
      setup: 'CREATE INDEX bo_created ON big_orders (created_at);',
      sql: `SELECT id, amount
FROM big_orders
WHERE date_trunc('day', created_at) = '2024-06-15'`,
      note: 'Baseline with an index on `created_at`. The plan is still `Seq Scan on big_orders` with `Filter: (date_trunc(…) = …)`, and the estimate is a default guess (`rows=1000`) — about 4× the real ~270.',
    },
    {
      label: 'Same rows as a range: Index Scan',
      setup: 'CREATE INDEX bo_created ON big_orders (created_at);',
      sql: `SELECT id, amount
FROM big_orders
WHERE created_at >= '2024-06-15' AND created_at < '2024-06-16'`,
      note: 'Changed: only the predicate shape. `Index Scan using bo_created` with both bounds in `Index Cond`; the estimate is now accurate from the column histogram. Cost drops from ≈5,000 to ≈20 — same index, same rows.',
    },
    {
      label: 'Expression index on created_at::date',
      setup: 'CREATE INDEX bo_created_day ON big_orders ((created_at::date)); ANALYZE big_orders;',
      sql: `SELECT id, amount
FROM big_orders
WHERE created_at::date = '2024-06-15'`,
      note: 'Changed: the expression itself is indexed, and ANALYZE gathers stats for it. The non-sargable-looking query now uses `bo_created_day` with an accurate estimate. Works, but costs an extra index that only serves this exact expression.',
    },
    {
      label: 'Numeric literal against an int key',
      sql: `SELECT id, amount
FROM big_orders
WHERE id = 123456.0`,
      note: 'Changed: a primary-key lookup with a `numeric` literal. Postgres casts the column: `Filter: ((id)::numeric = 123456.0)` on a `Seq Scan` — 200,000 casts for one row. `WHERE id = 123456` is an `Index Scan using big_orders_pkey` at cost ≈8.',
    },
    {
      label: 'lower(email) with a plain index: Seq Scan',
      setup: 'CREATE INDEX bu_email ON big_users (email);',
      sql: `SELECT id, email
FROM big_users
WHERE lower(email) = 'user777@mail.com'`,
      note: 'Changed: case-insensitive lookup on `big_users`. The index on `email` is ignored because the predicate is on `lower(email)`: `Seq Scan on big_users` over 20,000 rows.',
    },
    {
      label: 'lower(email) with an expression index',
      setup: 'CREATE INDEX bu_email_lower ON big_users (lower(email)); ANALYZE big_users;',
      sql: `SELECT id, email
FROM big_users
WHERE lower(email) = 'user777@mail.com'`,
      note: 'Changed: index on `lower(email)`. The same query becomes `Index Scan using bu_email_lower` — a point lookup. The predicate must use exactly this expression.',
    },
    {
      label: 'Leading wildcard LIKE: Seq Scan',
      setup: 'CREATE INDEX bu_email ON big_users (email);',
      sql: `SELECT id, email
FROM big_users
WHERE email LIKE '%777@mail.com'`,
      note: 'Changed: suffix search. A sorted index has no entry point for "ends with", so it\'s a `Seq Scan` with a `Filter`. Suffix/infix search needs a trigram (GIN) index or a reversed-string expression index.',
    },
    {
      label: 'Prefix LIKE: index range',
      setup: 'CREATE INDEX bu_email ON big_users (email);',
      sql: `SELECT id, email
FROM big_users
WHERE email LIKE 'user777%'`,
      note: 'Changed: wildcard only at the end. The planner derives a range (`email >= \'user777\' AND email < \'user778\'`) and uses `bu_email`. This works here because the database collation is `C`; with a linguistic collation you\'d need `text_pattern_ops` on the index.',
    },
  ],
  exercises: [
    {
      id: 'sg-extract-range',
      kind: 'optimize',
      title: 'March revenue without scanning two years',
      prompt: 'Finance wants March 2024 order count and revenue. `created_at` is indexed (setup), but the query reads the whole table. Make the WHERE sargable. Same result; no `Seq Scan on big_orders`.',
      difficulty: 'Easy',
      setup: 'CREATE INDEX bo_created ON big_orders (created_at);',
      starter: `SELECT count(*) AS orders, sum(amount) AS revenue
FROM big_orders
WHERE extract(year FROM created_at) = 2024
  AND extract(month FROM created_at) = 3`,
      solution: `SELECT count(*) AS orders, sum(amount) AS revenue
FROM big_orders
WHERE created_at >= '2024-03-01'
  AND created_at < '2024-04-01'`,
      plan: { mustNotContain: ['Seq Scan on big_orders'] },
      hints: [
        'Both `extract` calls wrap the indexed column.',
        'Express "March 2024" as a range of timestamps.',
        '`created_at >= \'2024-03-01\' AND created_at < \'2024-04-01\'`.',
      ],
      explanation: 'The range scans only March\'s ~8,500 index entries (via `bo_created`) instead of 200,000 rows, and the estimate is accurate. Use a half-open range rather than `BETWEEN … \'2024-03-31\'`, which would drop most of March 31. In application code, compute `[start, next_start)` from the user\'s month once and pass both as parameters.',
    },
    {
      id: 'sg-ilike-lower',
      kind: 'optimize',
      title: 'Case-insensitive login lookup',
      prompt: 'Login looks up the user by email case-insensitively. An expression index on `lower(email)` exists (setup), but `ILIKE` can\'t use it. Rewrite the predicate so the plan uses `bu_email_lower`. Same row.',
      difficulty: 'Medium',
      setup: 'CREATE INDEX bu_email_lower ON big_users (lower(email)); ANALYZE big_users;',
      starter: `SELECT id, email, country
FROM big_users
WHERE email ILIKE 'User777@Mail.com'`,
      solution: `SELECT id, email, country
FROM big_users
WHERE lower(email) = lower('User777@Mail.com')`,
      plan: { mustContain: ['bu_email_lower'] },
      hints: [
        'An expression index is used only when the query contains the same expression.',
        'Case-insensitive equality can be written as equality of lowercased values.',
        '`lower(email) = lower(\'User777@Mail.com\')`.',
      ],
      explanation: '`lower(email) = lower(…)` matches the indexed expression, so the plan is an `Index Scan using bu_email_lower` instead of a Seq Scan over 20,000 users. It is also more correct: `ILIKE` treats `_` and `%` in the input as wildcards, so an email containing `_` could match other users. Making the index UNIQUE also enforces case-insensitive uniqueness; `citext` is an alternative.',
    },
    {
      id: 'sg-arith-constant',
      kind: 'optimize',
      title: 'Orders above a gross threshold',
      prompt: 'Find orders whose amount including 18% tax exceeds 589. `amount` is indexed (setup), but the arithmetic is applied to the column. Solve for the column so the index can be used. Same rows; the plan must use `bo_amount`.',
      difficulty: 'Medium',
      setup: 'CREATE INDEX bo_amount ON big_orders (amount);',
      starter: `SELECT id, amount
FROM big_orders
WHERE amount * 1.18 > 589
ORDER BY id`,
      solution: `SELECT id, amount
FROM big_orders
WHERE amount > 589 / 1.18
ORDER BY id`,
      plan: { mustContain: ['using bo_amount'] },
      hints: [
        'Move the multiplication to the other side of the inequality.',
        'Dividing by a positive constant keeps the inequality direction.',
        '`amount > 589 / 1.18`.',
      ],
      explanation: '`589 / 1.18` is a constant computed once, so the predicate becomes a range on `bo_amount` (a bitmap scan over 366 rows) instead of computing `amount * 1.18` for 200,000 rows (the original walks the whole primary-key index for its ORDER BY and filters every row). Be careful with integer division and rounding when moving arithmetic: here `numeric` keeps full precision, and the result set is identical.',
    },
  ],
  judgment: [
    {
      id: 'sg-judge-numeric-literal',
      kind: 'slow-query',
      title: 'Primary-key lookup that takes 40 ms',
      context: 'APM shows the order-detail endpoint doing a full scan per request. The ORM builds the query from a decimal parameter.',
      sql: `SELECT id, user_id, status, amount
FROM big_orders
WHERE id = 123456.0`,
      bugLines: [3],
      options: [
        { text: 'The numeric literal forces a cast of `id` on every row, so the primary-key index can\'t be searched.', correct: true, why: 'The plan shows `Filter: ((id)::numeric = 123456.0)`. Passing an integer makes it an Index Scan on the pkey.' },
        { text: 'The primary key index is missing.', why: 'It exists (`big_orders_pkey`); the comparison just can\'t use it.' },
        { text: 'The table needs ANALYZE.', why: 'Statistics don\'t matter — no statistics make a cast column searchable.' },
        { text: 'Selecting four columns prevents an index scan.', why: 'Selected columns only matter for index-only scans; a plain Index Scan can return any column.' },
      ],
      fixedSql: `SELECT id, user_id, status, amount
FROM big_orders
WHERE id = 123456`,
      comparePlans: true,
      lesson: 'Compare indexed columns with values of their own type. A cast on the column side — explicit or implicit — turns an index lookup into a full scan.',
    },
    {
      id: 'sg-judge-between-rewrite',
      kind: 'spot-bug',
      title: 'The sargable rewrite that lost a day',
      context: 'PR: "Made the March report sargable: replaced `ordered_at::date BETWEEN \'2024-03-01\' AND \'2024-03-20\'` with a bare-column BETWEEN." The numbers in the report changed.',
      sql: `SELECT count(*) AS orders, sum(amount) AS revenue
FROM orders
WHERE ordered_at BETWEEN '2024-03-01' AND '2024-03-20'`,
      bugLines: [3],
      options: [
        { text: 'The upper bound is `2024-03-20 00:00`, so orders later on March 20 are dropped.', correct: true, why: 'Order 12 at 2024-03-20 10:00 was in the old report and is missing now. Use `< \'2024-03-21\'`.' },
        { text: 'BETWEEN isn\'t sargable; use two comparisons.', why: 'BETWEEN on a bare column is sargable; the bug is the inclusive bound on a timestamp.' },
        { text: 'sum(amount) should be coalesced.', why: 'NULL handling isn\'t what changed between the two versions.' },
        { text: 'The lower bound excludes orders at midnight on March 1.', why: 'BETWEEN is inclusive on both ends; midnight on March 1 is included.' },
      ],
      fixedSql: `SELECT count(*) AS orders, sum(amount) AS revenue
FROM orders
WHERE ordered_at >= '2024-03-01'
  AND ordered_at < '2024-03-21'`,
      lesson: 'A sargable rewrite must be equivalent. For "dates d1..d2 inclusive" on a timestamp, the exact equivalent is `>= d1 AND < d2 + 1 day`.',
    },
  ],
  recall: [
    { q: 'What makes a predicate sargable?', a: 'The indexed column appears bare on one side, compared with a value constant during the scan, using an operator the index\'s operator class supports.' },
    { q: 'Why does `id = 123456.0` on an int column cause a Seq Scan?', a: 'The column is cast to numeric to compare, and the int B-tree can\'t answer a numeric comparison of a cast expression.' },
    { q: 'Two ways to make `lower(email) = $1` fast?', a: 'An expression index on lower(email) (used only when the query uses the same expression), or store/compare the value with a case-insensitive type such as citext.' },
    { q: 'Why can\'t `LIKE \'%abc\'` use a B-tree?', a: 'With a leading wildcard there is no prefix to position the search in sorted order; it needs a trigram index or a full scan.' },
  ],
  transfer: [
    { id: 'sg-t-yesterday', scenario: 'A nightly job counts "yesterday\'s signups" with `WHERE signup_at::date = current_date - 1` and is getting slower every month.', approach: 'Rewrite as `signup_at >= current_date - 1 AND signup_at < current_date`, keeping the indexed column bare.' },
    { id: 'sg-t-sku', scenario: 'Support searches products by SKU typed in any case: `WHERE upper(sku) = upper($1)` on a 5M-row table.', approach: 'Create an expression index on `upper(sku)` (unique if SKUs are unique) and keep the predicate using exactly that expression.' },
    { id: 'sg-t-phone', scenario: 'A CRM finds customers by the last 4 digits of their phone number: `WHERE phone LIKE \'%1234\'`.', approach: 'Leading wildcard is not sargable: index `right(phone, 4)` (or `reverse(phone)` with prefix LIKE), or use a trigram GIN index.' },
  ],
  confusable: ['btree-indexes', 'composite-covering', 'null-semantics'],
};

const explainJoins: Concept = {
  id: 'explain-joins',
  track: 'performance',
  title: 'Reading EXPLAIN & join algorithms',
  tagline: 'A plan is a tree of operators with estimated costs and rows; reading it — and knowing why Postgres picked Hash, Merge or Nested Loop — is how you debug slow joins.',
  level: 'advanced',
  minutes: 40,
  interview: 3,
  viz: 'plan',
  intuition: [
    'SQL says **what** you want; `EXPLAIN` shows **how** Postgres decided to get it: a tree where each node (scan, join, sort, aggregate) pulls rows from its children. Read it from the innermost, most-indented nodes outwards.',
    'Every node has `cost=startup..total` (abstract units: 1.0 ≈ one sequential page read), `rows` (estimated output rows) and `width`. `EXPLAIN ANALYZE` actually runs the query and adds `actual time`, real `rows` and `loops`. The single most useful check: **are estimated rows close to actual rows?** Big misestimates cause bad join choices.',
    'There are three join algorithms. **Nested Loop**: for each outer row, look up matches in the inner side — great when the outer side is small and the inner side has an index. **Hash Join**: build a hash table on the smaller input, stream the larger through it — great for big unsorted inputs with an equality condition. **Merge Join**: walk two inputs sorted on the join key in lockstep — great when both are already sorted (indexes) or the result must be sorted anyway.',
    'You can make the planner show you the alternatives with `SET LOCAL enable_hashjoin = off` (and friends) inside a transaction. They are **diagnostic** switches, not production fixes: if a forced plan is much faster, fix the estimate or the index, not the setting.',
  ],
  internals: [
    '**Cost model.** Costs combine `seq_page_cost` (1.0), `random_page_cost` (4.0 by default), `cpu_tuple_cost`, `cpu_operator_cost` and row estimates from `pg_statistic`. A parent\'s cost includes its children. In ANALYZE output, `actual time` and `rows` are **per loop**: a node with `rows=1 loops=3830` produced 3,830 rows in total.',
    '**Nested Loop** costs ≈ outer_rows × cost_of_one_inner_probe. With an index on the inner join key that is cheap for a few hundred outer rows; without one, every loop is a full scan — the classic disaster when the outer estimate is "1 row" but the reality is 10,000. Postgres may add a `Memoize` node to cache inner results for repeated keys.',
    '**Hash Join** builds a hash table from the inner input (`Hash` node) in `work_mem`. If it doesn\'t fit, it splits both inputs into **batches** written to temp files (`Buckets: … Batches: 8` in ANALYZE) — still correct, but extra I/O. It only supports equality conditions and must consume the whole build side before returning the first row. **Merge Join** needs both inputs sorted; explicit `Sort` nodes may spill to disk too (`Sort Method: external merge`).',
    '**Where misestimates come from.** Correlated predicates (Postgres multiplies selectivities as if independent: `created_at < X AND id < Y` are actually the same condition here), functions on columns, stale statistics after bulk loads, and skewed join keys. Fixes: `ANALYZE`, extended statistics (`CREATE STATISTICS … (dependencies)`), sargable predicates, or restructuring the query so the planner has less to guess.',
  ],
  signals: [
    'A query that is slow only for some parameter values (a "big customer") — check estimated vs actual rows.',
    'A plan with `Nested Loop` and a huge `loops=` count on an inner Seq Scan.',
    '`Batches: N` > 1 on a Hash node or `external merge` on a Sort — memory pressure.',
    'Interview prompt: "walk me through this EXPLAIN" or "why might Postgres choose a hash join here?"',
  ],
  template: `EXPLAIN (ANALYZE, BUFFERS)
SELECT u.id, o.id AS order_id, o.amount
FROM big_users u
JOIN big_orders o ON o.user_id = u.id
WHERE u.country = 'JP'
  AND o.created_at >= '2024-12-01';
-- read bottom-up: scans → join → (sort/aggregate) → result
-- compare rows= (estimate) with actual rows=… loops=…`,
  realWorld: [
    {
      title: 'The "fast in staging, slow in prod" join',
      body: 'Staging has 1,000 orders per customer, prod has one customer with 3M. The planner estimates the average, picks a Nested Loop, and that one customer\'s report runs for minutes. `EXPLAIN ANALYZE` with that customer\'s id shows `rows=40` estimated vs `rows=3000000` actual — the fix is statistics/query shape, not more hardware.',
    },
    {
      title: 'Spilling hash joins in ETL',
      body: 'A nightly ETL joins two 50M-row tables with the default `work_mem = 4MB`. ANALYZE shows `Batches: 512` and gigabytes of temp files. Raising `work_mem` for that session only (`SET LOCAL work_mem = \'512MB\'`) makes the hash fit and cuts runtime several-fold — without raising it globally for 200 concurrent connections.',
    },
    {
      title: 'Using enable_* in an incident',
      body: 'During an incident an engineer runs the slow query inside `BEGIN; SET LOCAL enable_nestloop = off; EXPLAIN ANALYZE …; ROLLBACK;` to confirm that a hash join would be 100× faster. That proves the misestimate is the cause; the permanent fix is an `ANALYZE` and extended statistics on the correlated columns.',
    },
  ],
  mistakes: [
    {
      title: 'Reading EXPLAIN without ANALYZE and trusting it',
      why: 'Plain EXPLAIN shows only estimates. A plan that looks cheap may be cheap only because the estimate is wrong.',
      fix: 'Use `EXPLAIN (ANALYZE, BUFFERS)` (in a transaction you roll back for writes) and compare estimated vs actual rows node by node.',
    },
    {
      title: 'Forgetting loops',
      why: '`actual time=0.01..0.02 rows=1 loops=50000` looks tiny, but it ran 50,000 times.',
      fix: 'Multiply per-loop time and rows by `loops` to get the node\'s real total.',
    },
    {
      title: 'Leaving enable_* switches on',
      why: '`SET enable_nestloop = off` globally hides one bad plan and creates many others.',
      fix: 'Use the switches only to diagnose (`SET LOCAL` in a transaction); fix statistics, indexes or the query.',
    },
    {
      title: 'Joining on expressions or mismatched types',
      why: '`ON o.user_id::text = u.id::text` can\'t use the index on `user_id`, so a cheap indexed Nested Loop becomes a Hash Join over the whole table.',
      fix: 'Join on bare columns of the same type; fix the schema if the types differ.',
    },
  ],
  worked: {
    question: 'List the orders of US users with the user\'s name, oldest first. The plan explorer runs the same shape on big_users × big_orders.',
    sql: `SELECT u.name, o.id, o.ordered_at, o.amount
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE u.country = 'US'
ORDER BY o.ordered_at`,
    notes: {
      from: 'Logically FROM starts with `users`. Physically, the planner decides which side is the outer/build side based on estimated sizes after filters — `WHERE u.country = \'US\'` will be pushed down into the users scan.',
      join: 'Equality join on `user_id = id`: all three algorithms are possible. On the big tables, Postgres hashes the filtered users (small) and streams orders through the hash.',
      where: 'Logically the filter runs after the join; in the real plan it is applied **inside the scan** of users before the join, so far fewer rows reach the Hash node.',
      order: 'A Sort on top of the join. A Merge Join on `ordered_at` isn\'t possible (the join key is `user_id`), so the sort is a separate node.',
    },
    predictions: [
      {
        stage: 'join',
        kind: 'rowcount',
        question: 'How many rows does users JOIN orders produce, before the country filter?',
        explain: '16 orders, but order 16 has `user_id` NULL and finds no user, so the inner join keeps 15 rows.',
      },
      {
        stage: 'join',
        kind: 'choice',
        question: 'On big_users (20k) × big_orders (200k), JP users and orders since 2024-12-01, no index on `big_orders.user_id`. Which join does the planner pick?',
        options: ['Nested Loop', 'Hash Join', 'Merge Join', 'It refuses without an index'],
        answer: 1,
        explain: 'Both inputs are scanned anyway and neither is sorted on the join key, so building a hash on the ~2,000 JP users and probing it with ~8,000 recent orders is cheapest (cost ≈ 4,600). Forcing Merge Join adds two Sorts; forcing Nested Loop costs ≈ 7,000+.',
      },
    ],
    takeaway: 'Read plans bottom-up, compare estimated and actual rows, and know the trade-off: Nested Loop for small outer + indexed inner, Hash for big unsorted equality joins, Merge for pre-sorted inputs.',
  },
  variants: [
    {
      label: 'Default: Hash Join',
      sql: `SELECT u.id, o.id AS order_id, o.amount
FROM big_users u
JOIN big_orders o ON o.user_id = u.id
WHERE u.country = 'JP' AND o.created_at >= '2024-12-01'`,
      note: 'Baseline. `Hash Join` with `Hash Cond: (o.user_id = u.id)`: big_users is filtered to ~2,000 JP users and hashed; big_orders is seq-scanned with the date filter and probed. Cost ≈ 4,600, dominated by the Seq Scan of big_orders.',
    },
    {
      label: 'Hash disabled: Merge Join',
      setup: 'SET LOCAL enable_hashjoin = off;',
      sql: `SELECT u.id, o.id AS order_id, o.amount
FROM big_users u
JOIN big_orders o ON o.user_id = u.id
WHERE u.country = 'JP' AND o.created_at >= '2024-12-01'`,
      note: 'Changed: `enable_hashjoin = off`. The planner falls back to a `Merge Join`, which needs both inputs sorted by the join key — so two `Sort` nodes appear (users by id may come from the pkey). Higher cost: sorting is the price of merging unsorted inputs.',
    },
    {
      label: 'Hash and merge disabled: Nested Loop',
      setup: 'SET LOCAL enable_hashjoin = off; SET LOCAL enable_mergejoin = off;',
      sql: `SELECT u.id, o.id AS order_id, o.amount
FROM big_users u
JOIN big_orders o ON o.user_id = u.id
WHERE u.country = 'JP' AND o.created_at >= '2024-12-01'`,
      note: 'Changed: merge also disabled. Now a `Nested Loop`: for each recent order, probe `big_users_pkey` (with a `Memoize` cache for repeated user ids). ~8,000 index probes cost ≈ 7,000+ — more than the hash join. This is why the planner didn\'t pick it.',
    },
    {
      label: 'Small outer + indexed inner: Nested Loop wins',
      setup: 'CREATE INDEX bo_user ON big_orders (user_id);',
      sql: `SELECT u.id, o.id AS order_id, o.amount
FROM big_users u
JOIN big_orders o ON o.user_id = u.id
WHERE u.email = 'user4242@mail.com'`,
      note: 'Changed: one user (by email) and an index on `big_orders.user_id`. Now the planner itself chooses `Nested Loop`: one outer row, one `Bitmap Index Scan using bo_user` for the inner side. Cost ≈ 450 versus ≈ 4,600 for a hash join that would scan all orders. Nested Loop is the right algorithm when the outer side is tiny.',
    },
    {
      label: 'Tiny work_mem: hash batches',
      setup: "SET LOCAL work_mem = '64kB';",
      sql: `SELECT u.country, o.id, o.amount
FROM big_users u
JOIN big_orders o ON o.user_id = u.id
WHERE o.created_at >= '2024-09-15'`,
      note: 'Changed: a larger join (~30k orders × all 20k users) with `work_mem` cut to 64 kB. The hash of big_users no longer fits in memory, so ANALYZE shows `Batches: 8` (or more) on the Hash node: both sides are partitioned to temp files and joined batch by batch. Same result, extra disk I/O.',
    },
    {
      label: 'Correlated predicates: misestimate → Nested Loop',
      sql: `SELECT o.id, u.country
FROM big_orders o
JOIN big_users u ON u.id = o.user_id
WHERE o.created_at < '2023-01-15' AND o.id < 4000`,
      note: 'Changed: two predicates that mean nearly the same thing (ids grow with time). Postgres multiplies their selectivities as if independent and estimates ~76 rows; ANALYZE shows ~3,800. On that estimate it picks a `Nested Loop` with `loops≈3800` on the users pkey — fine here, catastrophic at larger scale. `CREATE STATISTICS` or dropping the redundant predicate fixes the estimate.',
    },
  ],
  exercises: [
    {
      id: 'ej-distinct-to-exists',
      kind: 'optimize',
      title: 'Stop multiplying rows just to de-duplicate them',
      prompt: 'List JP users (id, email) who have at least one order above 490, by id. The current query joins every matching order and then removes duplicates. Rewrite it so the plan uses a semi-join (`Semi` in the join type) and has no `Unique` step.',
      difficulty: 'Medium',
      starter: `SELECT DISTINCT u.id, u.email
FROM big_users u
JOIN big_orders o ON o.user_id = u.id
WHERE u.country = 'JP' AND o.amount > 490
ORDER BY u.id`,
      solution: `SELECT u.id, u.email
FROM big_users u
WHERE u.country = 'JP'
  AND EXISTS (
    SELECT 1 FROM big_orders o
    WHERE o.user_id = u.id AND o.amount > 490
  )
ORDER BY u.id`,
      plan: { mustContain: ['Semi'], mustNotContain: ['Unique'] },
      hints: [
        'You only need to know whether a matching order exists, not how many.',
        'A semi-join stops at the first match per user.',
        '`WHERE u.country = \'JP\' AND EXISTS (SELECT 1 FROM big_orders o WHERE o.user_id = u.id AND o.amount > 490)`.',
      ],
      explanation: 'The JOIN + DISTINCT version produces one row per matching order and then sorts/de-duplicates them (`Unique` over a `Sort`). `EXISTS` is planned as a semi-join (here `Hash Join (Right Semi)`: users are hashed and each one is emitted on its first matching order): each user is emitted at most once, so there is nothing to de-duplicate and no fan-out. It\'s also safer: DISTINCT would also collapse genuinely duplicate users if you selected fewer columns.',
    },
    {
      id: 'ej-aggregate-then-join',
      kind: 'optimize',
      title: 'Top 5 customers by revenue: aggregate first, join later',
      prompt: 'The leaderboard joins all 200,000 orders to users before grouping, only to keep 5 rows. Aggregate and limit on `big_orders` first, then fetch the emails for just those 5 users. Same rows in the same order; the plan must not contain a `Hash Join`.',
      difficulty: 'Hard',
      starter: `SELECT u.id, u.email, sum(o.amount) AS revenue
FROM big_users u
JOIN big_orders o ON o.user_id = u.id
GROUP BY u.id, u.email
ORDER BY revenue DESC
LIMIT 5`,
      solution: `SELECT u.id, u.email, t.revenue
FROM (
  SELECT user_id, sum(amount) AS revenue
  FROM big_orders
  GROUP BY user_id
  ORDER BY revenue DESC
  LIMIT 5
) t
JOIN big_users u ON u.id = t.user_id
ORDER BY t.revenue DESC`,
      plan: { mustNotContain: ['Hash Join'] },
      hints: [
        'Which table do you need to compute revenue? Which only for display?',
        'Put the GROUP BY … ORDER BY … LIMIT 5 in a subquery on big_orders.',
        'Join the 5-row subquery to big_users on the primary key.',
      ],
      explanation: 'Joining first hashes all 20,000 users and probes 200,000 orders before aggregating. Aggregating first reduces big_orders to 5 rows, and the join becomes a `Nested Loop` with 5 primary-key lookups — no hash table at all. The general rule: reduce rows (filter/aggregate/limit) as early as possible, join for decoration last. This rewrite is only equivalent because every order has a matching user (inner join wouldn\'t drop any revenue).',
    },
    {
      id: 'ej-users-without-orders',
      kind: 'write',
      title: 'Users who never ordered',
      prompt: 'Return the id and email of every big_users row that has no orders at all, ordered by id. Write it so the planner can use an anti-join (check the plan: you should see `Anti Join`).',
      difficulty: 'Easy',
      solution: `SELECT u.id, u.email
FROM big_users u
WHERE NOT EXISTS (
  SELECT 1 FROM big_orders o WHERE o.user_id = u.id
)
ORDER BY u.id`,
      hints: [
        '"No matching row" is an anti-join.',
        '`NOT EXISTS (SELECT 1 FROM big_orders o WHERE o.user_id = u.id)`.',
      ],
      explanation: '`NOT EXISTS` becomes a `Hash Right Anti Join`: big_users is hashed, big_orders is streamed once, and users never matched are emitted. `LEFT JOIN … WHERE o.id IS NULL` gives the same plan. Avoid `NOT IN (SELECT user_id …)` when the subquery column can be NULL — then it returns no rows at all.',
    },
  ],
  judgment: [
    {
      id: 'ej-judge-text-join-keys',
      kind: 'peer-review',
      title: 'Review: "join keys normalised to text"',
      context: 'PR from a teammate: "Some upstream ids come as strings, so I cast both join keys to text to be safe." The query powers a per-account page that should be instant. An index on `big_orders.user_id` exists (setup).',
      setup: 'CREATE INDEX bo_user ON big_orders (user_id);',
      sql: `SELECT u.id, u.email, o.id AS order_id, o.amount
FROM big_users u
JOIN big_orders o
  ON o.user_id::text = u.id::text
WHERE u.id BETWEEN 100 AND 120`,
      bugLines: [4],
      options: [
        { text: 'Casting the join keys prevents using `bo_user`, so the plan hashes and scans all 200,000 orders instead of 21 index probes.', correct: true, why: 'With `o.user_id = u.id` the plan is a Nested Loop with an index scan on bo_user (cost ≈ 900 vs ≈ 6,900).' },
        { text: 'Text comparison can match different numbers (e.g. "1" and "01").', why: 'Both sides come from int columns, so the text forms are canonical; the result is the same — the problem is the plan.' },
        { text: 'BETWEEN on u.id is not sargable.', why: 'It is a range on the primary key and is used as an Index Cond.' },
        { text: 'The join should be a LEFT JOIN.', why: 'Nothing in the requirement asks for users without orders.' },
      ],
      fixedSql: `SELECT u.id, u.email, o.id AS order_id, o.amount
FROM big_users u
JOIN big_orders o
  ON o.user_id = u.id
WHERE u.id BETWEEN 100 AND 120`,
      comparePlans: true,
      lesson: 'Join conditions follow the same sargability rules as WHERE: an expression on the inner key disables index nested loops. Fix types at the boundary (cast the parameter, fix the schema), never by casting columns.',
    },
  ],
  recall: [
    { q: 'What do the two numbers in cost=0.29..8.44 mean?', a: 'Startup cost (before the first row can be returned) and total cost (to return all rows), in planner units where one sequential page read ≈ 1.' },
    { q: 'When does a Nested Loop win?', a: 'When the outer side is small and the inner side can be probed cheaply per row (an index on the join key), or when only the first few rows are needed.' },
    { q: 'What does `Batches: 8` on a Hash node mean?', a: 'The hash table didn\'t fit in work_mem, so both inputs were partitioned into 8 batches spilled to temp files and joined batch by batch.' },
    { q: 'How do you check whether a bad plan comes from a misestimate?', a: 'EXPLAIN ANALYZE and compare estimated rows with actual rows × loops at each node; the first node where they diverge by orders of magnitude is the source.' },
  ],
  transfer: [
    { id: 'ej-t-report', scenario: 'A monthly report that joins invoices to line items suddenly takes 20 minutes after a bulk import; EXPLAIN shows a Nested Loop with estimated rows=12.', approach: 'Run EXPLAIN ANALYZE, find the misestimated node, ANALYZE the freshly loaded tables (and add extended statistics for correlated columns) so the planner switches to a hash join.' },
    { id: 'ej-t-etl', scenario: 'An ETL join of two large tables writes gigabytes of temp files.', approach: 'Check the Hash node for Batches > 1; raise work_mem for that session only (SET LOCAL), or reduce the build side by filtering/aggregating before the join.' },
  ],
  confusable: ['joins-fanout', 'semi-anti-joins', 'btree-indexes'],
};

const antipatternsPagination: Concept = {
  id: 'antipatterns-pagination',
  track: 'performance',
  title: 'Query anti-patterns & keyset pagination',
  tagline: 'OFFSET, per-row subqueries, ORDER BY random(), exact counts: queries that are correct, look harmless, and get slower with every row you add.',
  level: 'advanced',
  minutes: 35,
  interview: 3,
  viz: 'plan',
  intuition: [
    '`LIMIT 20 OFFSET 100000` does not jump to row 100,000. It **produces** 100,020 rows in order and throws away the first 100,000. Page 5,000 of an infinite scroll costs 5,000 times page 1.',
    '**Keyset (seek) pagination** remembers where the last page ended — the `(created_at, id)` of its last row — and asks for rows strictly after it: `WHERE (created_at, id) < (:last_created_at, :last_id) ORDER BY created_at DESC, id DESC LIMIT 20`. With an index on `(created_at, id)` every page is one index descent plus 20 entries, no matter how deep.',
    'Many slow queries are "do something per row" in disguise: a correlated subquery in SELECT, an ORM lazily loading each order\'s user (the **N+1** problem), a function in WHERE. Sets are cheap; loops of tiny queries are not. Express the whole thing as one join or one aggregate.',
    'Some questions are expensive by nature: `ORDER BY random()` sorts the whole table to keep 5 rows, `count(*)` on a 500M-row table reads it all (MVCC means Postgres has no stored row count). Often the business needs an **approximation** — a sample, an estimate — which is orders of magnitude cheaper.',
  ],
  internals: [
    '**OFFSET in the plan.** It is a property of the `Limit` node: the child must still emit `offset + limit` rows. Without an index that means Seq Scan + Sort of the whole table; with an index on the sort key it\'s an Index Scan that walks 100,020 entries and fetches their heap rows. Keyset turns the cursor into an `Index Cond` — a row comparison `ROW(created_at, id) < ROW(…)` that a B-tree on `(created_at, id)` searches directly.',
    '**Keyset requirements.** The ORDER BY must be **total** (end with a unique column like `id`) or rows with equal keys are skipped or repeated across pages; the row-value comparison must use the same directions as ORDER BY (all DESC → `<`); and the index must match. Trade-offs: no "jump to page 37", only next/previous; the client keeps an opaque cursor. Consistent results under concurrent inserts are a bonus — OFFSET pages shift when new rows arrive.',
    '**Correlated subqueries and N+1.** A subquery in SELECT referencing the outer row appears as a `SubPlan` executed once per outer row (`loops=2040`). The planner can flatten EXISTS/IN into semi/anti joins, but not a scalar `(SELECT count(*) …)` — that stays a loop. Rewriting as `LEFT JOIN … GROUP BY` (or a `LATERAL` join where a per-row LIMIT is needed) lets it choose a hash join over one pass. The N+1 pattern is the same loop executed from application code, with a network round trip per iteration on top.',
    '**Approximations.** `TABLESAMPLE SYSTEM (p)` reads a random p% of **pages** (fast, clustered sample); `BERNOULLI (p)` tests each row (uniform, but scans everything). `pg_class.reltuples` holds the row estimate from the last VACUUM/ANALYZE — instant and usually within a few percent, ideal for "about 1.2M results". `SELECT *` is the quiet one: it ships unused columns (including big TOASTed text/JSON) over the network, defeats index-only scans, and breaks when columns are added.',
  ],
  signals: [
    'Pagination with page numbers over a large, growing table; "infinite scroll"; an export that pages through everything with OFFSET.',
    'A `SubPlan` in the plan, or an ORM log showing the same query repeated with different ids.',
    '"Show a random sample", "show the total count" on a huge table.',
    'Queries that degrade linearly with table size or page depth rather than staying flat.',
  ],
  template: `-- keyset (seek) pagination: index on (created_at, id)
SELECT id, created_at, amount
FROM big_orders
WHERE (created_at, id) < (:last_created_at, :last_id)   -- cursor from the previous page
ORDER BY created_at DESC, id DESC                        -- total order, matches the index
LIMIT 20;`,
  realWorld: [
    {
      title: 'Deep pages and crawlers',
      body: 'Product listing pages with `?page=N` look fine to users who stop at page 3, until a crawler requests page 40,000. Each request sorts and discards millions of rows and the database CPU goes to 100%. Switching the API to cursor-based pagination (`?after=<opaque cursor>`) makes every page cost the same — this is why the GitHub, Stripe and Slack APIs use cursors.',
    },
    {
      title: 'The N+1 behind a slow page',
      body: 'An order history page loads 50 orders, then for each one the ORM issues `SELECT * FROM users WHERE id = ?` and `SELECT * FROM items WHERE order_id = ?` — 101 round trips. Each query is 1 ms, but the page takes 300 ms. Eager loading (one join, or one `WHERE id = ANY(…)` per relation) brings it to 3 queries.',
    },
    {
      title: '"Showing 1–20 of 1,245,883 results"',
      body: 'An exact count over a filtered 50M-row table can cost more than fetching the page itself. Many products show "1,000+" or an estimate (from `reltuples` or `EXPLAIN`\'s row estimate) and only compute exact counts on demand or in a background job.',
    },
  ],
  mistakes: [
    {
      title: 'OFFSET pagination on large tables',
      why: 'Cost grows linearly with page depth because skipped rows are still produced; pages also shift when rows are inserted, causing duplicates/misses.',
      fix: 'Keyset pagination with a total order and a matching composite index.',
    },
    {
      title: 'Keyset on a non-unique sort key',
      why: '`WHERE created_at < :last ORDER BY created_at DESC` skips rows that share the last timestamp.',
      fix: 'Add a unique tie-breaker to both the ORDER BY and the cursor: `(created_at, id) < (:ts, :id)`.',
    },
    {
      title: 'Scalar subquery per row',
      why: '`SELECT u.id, (SELECT count(*) FROM orders o WHERE o.user_id = u.id)` runs the subquery once per user — a SubPlan with thousands of loops.',
      fix: '`LEFT JOIN orders … GROUP BY u.id` with `count(o.id)`, which the planner can execute as one hash join.',
    },
    {
      title: 'ORDER BY random() for sampling',
      why: 'Every row gets a random number and the whole table is sorted to keep a handful.',
      fix: '`TABLESAMPLE SYSTEM (p)` / `BERNOULLI (p)`, or pick random ids within the key range and look them up.',
    },
  ],
  worked: {
    question: 'Page 2 of the "latest orders" list, 5 per page. Page 1 ended at order 14 (2024-03-04 09:50). Fetch the next page with a keyset cursor instead of OFFSET.',
    sql: `SELECT id, ordered_at, amount
FROM orders
WHERE (ordered_at, id) < ('2024-03-04 09:50', 14)
ORDER BY ordered_at DESC, id DESC
LIMIT 5`,
    notes: {
      where: 'The row comparison `(ordered_at, id) < (…)` means "earlier timestamp, or same timestamp and smaller id" — strictly after the last row of page 1 in this sort order. With an index on `(ordered_at, id)` this is a single index position, not a filter over every row.',
      order: 'The ORDER BY uses exactly the cursor columns, in the same direction (DESC ↔ `<`), with `id` as a unique tie-breaker so the order is total.',
      limit: 'LIMIT takes the first 5 rows after the cursor. Nothing is skipped and thrown away — page 1,000 costs the same as page 2.',
    },
    predictions: [
      {
        stage: 'where',
        kind: 'rowcount',
        question: 'How many orders are strictly "after" the cursor (2024-03-04 09:50, 14) in newest-first order?',
        explain: 'Page 1 was orders 12, 8, 16, 15, 14 (the 5 newest). The other 11 orders are all older than the cursor.',
      },
      {
        stage: 'limit',
        kind: 'choice',
        question: 'The OFFSET version (`ORDER BY ordered_at DESC, id DESC LIMIT 5 OFFSET 5`) returns the same page. How many rows must the sort/scan produce for it?',
        options: ['5', '10', '11', 'Only the rows of page 2, like keyset'],
        answer: 1,
        explain: 'OFFSET 5 LIMIT 5 needs the first 10 rows in order and discards 5. At OFFSET 100,000 on big_orders that is 100,020 rows produced to return 20 — the plan explorer shows the cost going from ≈5,000 to ≈2.',
      },
    ],
    takeaway: 'Keyset pagination turns "skip N rows" into "seek to a position": constant cost per page, stable under inserts — at the price of a total order, a matching index and no random page jumps.',
  },
  build: {
    prompt: 'Build page 2 of "latest orders" (id, ordered_at, amount), 5 per page, newest first, continuing after the last row of page 1: order 14 at 2024-03-04 09:50.',
    blocks: [
      { slot: 'select', sql: 'id', why: 'Unique tie-breaker and part of the next cursor.' },
      { slot: 'select', sql: 'ordered_at', why: 'Sort key and part of the next cursor.' },
      { slot: 'select', sql: 'amount', why: 'Payload.' },
      { slot: 'from', sql: 'orders', why: 'Single table.' },
      { slot: 'where', sql: "(ordered_at, id) < ('2024-03-04 09:50', 14)", why: 'Seek past the cursor: `<` because the order is DESC; row comparison handles timestamp ties via id.' },
      { slot: 'orderBy', sql: 'ordered_at DESC', why: 'Newest first.' },
      { slot: 'orderBy', sql: 'id DESC', why: 'Total order, same direction as the cursor comparison.' },
      { slot: 'limit', sql: '5', why: 'Page size — no OFFSET needed.' },
    ],
    traps: [
      { slot: 'where', sql: "(ordered_at, id) > ('2024-03-04 09:50', 14)", replaces: "(ordered_at, id) < ('2024-03-04 09:50', 14)", why: 'With DESC order, "after the cursor" means smaller keys. `>` returns page 1 again (minus the cursor row).' },
      { slot: 'where', sql: 'id < 14', replaces: "(ordered_at, id) < ('2024-03-04 09:50', 14)", why: 'Ids don\'t follow time: order 12 (Mar 20, the newest) has id < 14 and reappears on page 2.' },
      { slot: 'limit', sql: '5 OFFSET 5', replaces: '5', why: 'Mixing both skips twice: the cursor already moved past page 1, OFFSET skips page 2 as well.' },
    ],
  },
  variants: [
    {
      label: 'Deep OFFSET, no index',
      sql: `SELECT id, created_at, amount
FROM big_orders
ORDER BY created_at DESC, id DESC
LIMIT 20 OFFSET 100000`,
      note: 'Baseline: `Limit` over a `Sort` of a full `Seq Scan` — all 200,000 rows are sorted (spilling past `work_mem`) to return rows 100,001–100,020. Cost ≈ 25,000.',
    },
    {
      label: 'Deep OFFSET with an index',
      setup: 'CREATE INDEX bo_created_id ON big_orders (created_at, id);',
      sql: `SELECT id, created_at, amount
FROM big_orders
ORDER BY created_at DESC, id DESC
LIMIT 20 OFFSET 100000`,
      note: 'Changed: index on `(created_at, id)`. The Sort disappears (`Index Scan Backward`), but the Limit still pulls 100,020 rows from it and fetches each from the heap. Cost ≈ 5,000 — better, still proportional to page depth.',
    },
    {
      label: 'Keyset with the same index',
      setup: 'CREATE INDEX bo_created_id ON big_orders (created_at, id);',
      sql: `SELECT id, created_at, amount
FROM big_orders
WHERE (created_at, id) < ('2024-01-01 00:39:50.044029', 100000)
ORDER BY created_at DESC, id DESC
LIMIT 20`,
      note: 'Changed: OFFSET replaced by the cursor of the previous page\'s last row. The row comparison becomes `Index Cond: (ROW(created_at, id) < ROW(…))`: one descent, 20 entries. Cost ≈ 2 — about 2,500× cheaper than the indexed OFFSET, and constant for any page.',
    },
    {
      label: 'Correlated subquery: SubPlan per row',
      setup: 'CREATE INDEX bo_user ON big_orders (user_id);',
      sql: `SELECT u.id,
       (SELECT count(*) FROM big_orders o WHERE o.user_id = u.id) AS orders
FROM big_users u
WHERE u.country = 'JP'`,
      note: 'New query: order count per JP user. The scalar subquery is a `SubPlan` executed once per JP user (~2,000 loops of an index-only probe). Cost ≈ 2,500 even with `bo_user`; without the index each loop would be a Seq Scan and cost ≈ 350,000.',
    },
    {
      label: 'Same question as one join',
      setup: 'CREATE INDEX bo_user ON big_orders (user_id);',
      sql: `SELECT u.id, count(o.id) AS orders
FROM big_users u
LEFT JOIN big_orders o ON o.user_id = u.id
WHERE u.country = 'JP'
GROUP BY u.id`,
      note: 'Changed: set-based rewrite. No SubPlan: a single join plus aggregate, where the planner is free to pick a hash join (one pass over big_orders) or index probes based on cost. `count(o.id)` keeps users with no orders at 0, like the subquery.',
    },
    {
      label: 'ORDER BY random()',
      sql: `SELECT id, amount
FROM big_orders
ORDER BY random()
LIMIT 5`,
      note: 'New query: 5 random orders. Every one of 200,000 rows gets a random() value and goes through a top-N `Sort`. Cost ≈ 7,500, growing with the table.',
    },
    {
      label: 'TABLESAMPLE instead',
      sql: `SELECT id, amount
FROM big_orders TABLESAMPLE SYSTEM (0.1)
LIMIT 5`,
      note: 'Changed: `TABLESAMPLE SYSTEM (0.1)` reads ~0.1% of the pages at random (`Sample Scan`), cost in the single digits. Rows come in page clusters, so it\'s less uniform than random() — fine for spot checks and previews, not for statistics needing independent rows (use BERNOULLI).',
    },
    {
      label: 'Exact count(*)',
      sql: `SELECT count(*)
FROM big_orders`,
      note: 'New query: exact row count. MVCC means each row\'s visibility must be checked, so it\'s an `Aggregate` over a full `Seq Scan` (or an index-only scan of the smallest index). Cost ≈ 4,200 and linear in table size.',
    },
    {
      label: 'Estimated count from the catalog',
      sql: `SELECT reltuples::bigint AS estimated_rows
FROM pg_class
WHERE relname = 'big_orders'`,
      note: 'Changed: read the planner\'s own estimate (maintained by VACUUM/ANALYZE). One catalog index lookup, constant cost, and here exactly 200,000. Use it for "about N rows" UI and monitoring.',
    },
  ],
  exercises: [
    {
      id: 'ap-keyset-page',
      kind: 'optimize',
      title: 'Infinite scroll at depth 100,000',
      prompt: 'The orders feed loads the page after offset 100,000 (20 rows, newest first). The previous page ended with order id 100000, `created_at = \'2024-01-01 00:39:50.044029\'`. Using the index in setup, rewrite as keyset pagination. Same 20 rows in the same order; the plan must have an `Index Cond` and cost at most 5% of the OFFSET version.',
      difficulty: 'Medium',
      setup: 'CREATE INDEX bo_created_id ON big_orders (created_at, id);',
      starter: `SELECT id, created_at, amount
FROM big_orders
ORDER BY created_at DESC, id DESC
LIMIT 20 OFFSET 100000`,
      solution: `SELECT id, created_at, amount
FROM big_orders
WHERE (created_at, id) < ('2024-01-01 00:39:50.044029', 100000)
ORDER BY created_at DESC, id DESC
LIMIT 20`,
      plan: { mustContain: ['Index Cond'], maxCostRatio: 0.05 },
      hints: [
        'Instead of counting past 100,000 rows, start right after the last row you already showed.',
        'The order is DESC on both columns, so "after" means smaller `(created_at, id)`.',
        '`WHERE (created_at, id) < (\'2024-01-01 00:39:50.044029\', 100000)` and drop the OFFSET.',
      ],
      explanation: 'The row-value comparison matches the index `(created_at, id)` column for column, so the B-tree positions directly at the cursor and the Limit stops after 20 entries (cost ≈ 2 vs ≈ 5,000). Writing `created_at < … OR (created_at = … AND id < …)` is equivalent but older planners don\'t always turn it into one index condition — the row form is cleaner. In an API, encode `(created_at, id)` of the last row as an opaque cursor.',
    },
    {
      id: 'ap-subquery-to-join',
      kind: 'optimize',
      title: 'Order counts per user without a per-row subquery',
      prompt: 'A report lists every JP user with their number of orders, by user id. The scalar subquery runs once per user. Rewrite it as a single join + aggregate: same rows (users with no orders show 0), ordered by id, and no `SubPlan` in the plan.',
      difficulty: 'Medium',
      setup: 'CREATE INDEX bo_user ON big_orders (user_id);',
      starter: `SELECT u.id,
       (SELECT count(*) FROM big_orders o WHERE o.user_id = u.id) AS orders
FROM big_users u
WHERE u.country = 'JP'
ORDER BY u.id`,
      solution: `SELECT u.id, count(o.id) AS orders
FROM big_users u
LEFT JOIN big_orders o ON o.user_id = u.id
WHERE u.country = 'JP'
GROUP BY u.id
ORDER BY u.id`,
      plan: { mustNotContain: ['SubPlan'] },
      hints: [
        'Join orders to users and count per user.',
        'An inner join would drop users with no orders; the subquery returned 0 for them.',
        '`LEFT JOIN big_orders o ON o.user_id = u.id … GROUP BY u.id` with `count(o.id)`.',
      ],
      explanation: '`count(o.id)` (not `count(*)`) counts only matched orders, so users without orders get 0 instead of 1. The planner can now choose one pass over big_orders with a hash join instead of ~2,000 separate probes. Aggregating orders first (`SELECT user_id, count(*) … GROUP BY user_id`) and joining that is another good form, especially when you need several aggregates.',
    },
    {
      id: 'ap-reltuples',
      kind: 'write',
      title: 'An instant row-count estimate',
      prompt: 'The admin dashboard shows "~N orders" and must not scan the table. Return the planner\'s row estimate for `big_orders` from the catalog as a bigint column `estimated_rows`.',
      difficulty: 'Easy',
      solution: `SELECT reltuples::bigint AS estimated_rows
FROM pg_class
WHERE relname = 'big_orders'`,
      hints: [
        'The planner keeps a per-table row estimate in `pg_class`.',
        '`reltuples` is a float; cast it to bigint.',
      ],
      explanation: '`pg_class.reltuples` is updated by VACUUM, ANALYZE and CREATE INDEX; here it is exactly 200,000. It can lag behind heavy writes, so use it for approximate UI numbers and monitoring, and `count(*)` only when exactness is required. Filtered estimates can be taken from `EXPLAIN` output in the same spirit. (In multi-schema databases filter on `oid = \'big_orders\'::regclass` instead of the name.)',
    },
  ],
  judgment: [
    {
      id: 'ap-judge-random-sample',
      kind: 'slow-query',
      title: 'The "random orders to QA" job',
      context: 'Every 10 minutes a QA job pulls 5 random orders to spot-check. DBA: "this one query is the top CPU consumer on the primary."',
      sql: `SELECT id, user_id, amount
FROM big_orders
ORDER BY random()
LIMIT 5`,
      bugLines: [3],
      options: [
        { text: '`ORDER BY random()` evaluates and sorts all 200,000 rows to keep 5; sample pages with TABLESAMPLE instead.', correct: true, why: 'The plan is Seq Scan → Sort → Limit (cost ≈ 7,500). `TABLESAMPLE SYSTEM (0.1)` is a Sample Scan reading ~0.1% of pages.' },
        { text: 'LIMIT 5 should be applied before ORDER BY with a subquery.', why: 'Limiting first returns the first 5 rows in storage order — not random at all.' },
        { text: 'An index on random() would make it fast.', why: 'random() is volatile; it can\'t be indexed, and it\'s different on every call.' },
        { text: 'Selecting fewer columns would remove the Sort.', why: 'The Sort is required by ORDER BY random(), regardless of columns.' },
      ],
      fixedSql: `SELECT id, user_id, amount
FROM big_orders TABLESAMPLE SYSTEM (0.1)
LIMIT 5`,
      comparePlans: true,
      lesson: 'Exact randomness over a whole table costs a full scan and sort. When "a few arbitrary rows" is good enough, sample pages (SYSTEM) or rows (BERNOULLI) and keep the cost independent of table size.',
    },
  ],
  recall: [
    { q: 'Why does OFFSET get slower with page depth?', a: 'The Limit node must pull and discard offset rows from its child, so the work is proportional to offset + limit.' },
    { q: 'What three things does keyset pagination need?', a: 'A total ORDER BY (ending in a unique column), a cursor comparison in the same direction (row value `<` for DESC), and an index matching the ORDER BY columns.' },
    { q: 'What is the N+1 problem?', a: 'Fetching a list with one query, then issuing one more query per item for related data; fix with a join or one batched `= ANY(…)` query per relation.' },
    { q: 'Why can\'t Postgres return count(*) from metadata instantly?', a: 'MVCC: which rows are visible depends on the transaction, so it must check row visibility; only estimates (reltuples) are stored.' },
  ],
  transfer: [
    { id: 'ap-t-export', scenario: 'A nightly CSV export pages through a 30M-row events table with `ORDER BY id LIMIT 10000 OFFSET n` and takes longer every week.', approach: 'Use keyset on the primary key: `WHERE id > :last_id ORDER BY id LIMIT 10000`, carrying the last id forward between batches.' },
    { id: 'ap-t-orm', scenario: 'An API endpoint listing 100 invoices issues 201 queries according to the ORM log.', approach: 'N+1: eager-load related rows with a join or one `WHERE invoice_id = ANY(:ids)` query per relation.' },
    { id: 'ap-t-total', scenario: 'A search page shows "Showing 1–25 of N results" and the count query is slower than the search.', approach: 'Show an estimate (EXPLAIN row estimate / reltuples) or a capped count (`count(*)` over a `LIMIT 1001` subquery → "1,000+"), and compute exact totals only on demand.' },
  ],
  confusable: ['composite-covering', 'explain-joins', 'top-n-per-group'],
};

export const perfConcepts: Concept[] = [btreeIndexes, compositeCovering, sargability, explainJoins, antipatternsPagination];
