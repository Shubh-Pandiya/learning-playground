import type { Concept } from '../types';

/**
 * Track: Transactions & concurrency.
 * The database is single-connection, so concurrent interleavings are simulated in the isolation
 * visualizer; exercises and judgment drills replay an interleaving as one session (the "other"
 * transaction's statements are written inline and labelled). Everything runs inside BEGIN … ROLLBACK.
 */
export const transactions: Concept[] = [
  // ───────────────────────────────────────────────────────────────── isolation-anomalies
  {
    id: 'isolation-anomalies',
    track: 'transactions',
    title: 'Isolation levels & anomalies',
    tagline: 'Isolation is a menu of anomalies you agree to tolerate. Know which ones each level allows in Postgres — and when your app code reintroduces them anyway.',
    level: 'intermediate',
    minutes: 16,
    interview: 3,
    viz: 'isolation',
    scenarios: ['dirty-read', 'non-repeatable-read', 'phantom', 'lost-update'],
    intuition: [
      'A transaction promises **all-or-nothing** (atomicity). Isolation is a separate promise: how much of *other* in-flight or just-committed transactions you can observe while yours runs. Full isolation (every run looks as if transactions ran one after another) costs waiting or retries, so SQL defines weaker levels by the **anomalies** they allow.',
      'The four classic anomalies: **dirty read** (you see another transaction’s uncommitted write, which may roll back), **non-repeatable read** (you read a row twice and get different values because someone committed in between), **phantom** (you re-run a predicate query and new rows match), and **lost update** (two read-modify-write cycles overlap and one write silently overwrites the other).',
      'The standard levels: **Read Uncommitted** allows all of them, **Read Committed** forbids dirty reads, **Repeatable Read** also forbids non-repeatable reads, **Serializable** forbids every anomaly. Postgres is stricter than the standard: Read Uncommitted behaves as Read Committed (Postgres **never** dirty-reads), and Repeatable Read also prevents phantoms because it reads from one snapshot.',
      'The key mental model in Postgres is **snapshot timing**. Read Committed takes a fresh snapshot for **every statement**; Repeatable Read and Serializable take one snapshot at the **first statement** of the transaction and keep it. Most “mysterious” production bugs come from app code doing a read in one statement and a dependent write in another under Read Committed — the default.',
      'Stronger levels do not make conflicts disappear, they turn them into **errors**: Repeatable Read raises `could not serialize access due to concurrent update` when you update a row someone else changed, and Serializable aborts transactions whose combined effect has no serial order. Both use SQLSTATE `40001`, and the application must **retry the whole transaction**.',
    ],
    internals: [
      'Postgres implements isolation with **MVCC snapshots**, not read locks. A snapshot is (xmin, xmax, list of in-progress transaction ids); a row version is visible if the transaction that created it committed before the snapshot and the one that deleted it did not. Readers never block writers and writers never block readers — only two writers on the same row wait for each other.',
      'Under **Read Committed**, an `UPDATE`/`DELETE`/`SELECT … FOR UPDATE` that finds its target row being changed by another transaction waits for it. If that transaction commits, Postgres re-fetches the **newest** row version and **re-evaluates the WHERE clause** on it (the “EvalPlanQual” recheck) before applying the change. That is why `UPDATE … SET balance = balance - 80 WHERE balance >= 80` is safe under concurrency while “SELECT, compute in the app, UPDATE SET balance = 20” is not.',
      'Under **Repeatable Read** the same situation cannot re-read the new version (it would break the snapshot), so the statement fails with `40001`. **Serializable** is Serializable Snapshot Isolation (SSI, since 9.1): on top of snapshots it records which transactions read what (SIREAD predicate locks, not blocking) and aborts one transaction when it detects a dangerous cycle of read/write dependencies. It costs some CPU/memory and false-positive aborts, but no blocking reads.',
      'Other engines differ, which interviewers love: MySQL/InnoDB defaults to Repeatable Read but implements it with consistent reads plus **next-key (gap) locks** for locking reads; SQL Server defaults to locking Read Committed (readers can block writers) unless RCSI is enabled; Oracle’s “serializable” is really snapshot isolation; Snowflake only offers Read Committed for tables.',
    ],
    signals: [
      'two requests update the same balance / counter / stock at the same time',
      'a report reads totals in several statements and the numbers don’t add up',
      'which isolation level should this transaction use?',
      'could not serialize access (40001) / retry logic',
      'read a value, check it in code, then write it back',
    ],
    template: `-- 1. Prefer a single statement: the WHERE is re-checked on the newest row version
UPDATE accounts
SET balance = balance - 80
WHERE id = 1
  AND balance >= 80          -- the guard and the write are atomic
RETURNING id, balance;       -- 0 rows = insufficient funds

-- 2. Multi-statement invariant? Run it as SERIALIZABLE and retry on SQLSTATE 40001
BEGIN ISOLATION LEVEL SERIALIZABLE;
  -- reads + writes that must behave as if run alone
COMMIT;                      -- may fail with 40001 → retry the whole transaction`,
    realWorld: [
      {
        title: 'Wallet double-spend under the default isolation',
        body: 'A payments service reads the balance, checks `balance >= amount` in code and writes the new value. Two concurrent withdrawals both pass the check and one write overwrites the other (lost update) — or both succeed and overdraw. Fix: a single guarded `UPDATE … WHERE balance >= :amount`, or `SELECT … FOR UPDATE` before the check.',
      },
      {
        title: 'Finance reports that don’t reconcile',
        body: 'A nightly job runs `SELECT SUM(...)` and then a per-account query in separate statements under Read Committed. A transfer commits between them and totals differ from details (read skew). Run the report in one statement, or in a `REPEATABLE READ READ ONLY` transaction so every statement sees the same snapshot (pg_dump does exactly this).',
      },
      {
        title: 'Retry loops are part of the design',
        body: 'Teams that switch to Serializable without a retry wrapper see random 500s under load. Correct pattern: catch SQLSTATE `40001` (and `40P01` deadlock), roll back, retry the whole transaction with backoff a few times, and keep transactions short so retries are cheap. Never retry a single statement inside a failed transaction.',
      },
    ],
    mistakes: [
      {
        title: 'Read-modify-write in application code',
        why: 'The value you read is stale the moment another transaction commits; writing back a computed constant (`SET balance = 20`) overwrites their change — a lost update, even inside a transaction under Read Committed.',
        fix: 'Express the change relative to the current value in one statement (`SET balance = balance - 80 WHERE balance >= 80`), or lock the row first with `SELECT … FOR UPDATE`.',
      },
      {
        title: 'Assuming BEGIN freezes what you see',
        why: 'Under Read Committed every statement gets a new snapshot, so two SELECTs in the same transaction can disagree (non-repeatable reads, phantoms).',
        fix: 'Do the work in one statement, or use `BEGIN ISOLATION LEVEL REPEATABLE READ` for multi-statement consistent reads.',
      },
      {
        title: 'Raising isolation without retries',
        why: 'Repeatable Read and Serializable report conflicts as SQLSTATE `40001` errors instead of waiting them out; without a retry loop users see failures.',
        fix: 'Wrap the transaction in a retry helper (whole transaction, bounded attempts, jittered backoff) and make it idempotent.',
      },
      {
        title: 'Thinking Repeatable Read prevents everything',
        why: 'Snapshot isolation still allows **write skew**: two transactions read overlapping data and write different rows, each valid alone, together breaking an invariant.',
        fix: 'Use Serializable, or lock the rows the invariant depends on (`SELECT … FOR UPDATE`), or encode the rule as a constraint.',
      },
    ],
    worked: {
      question: 'The risk team lists accounts with at least 50 in balance. While this query runs inside transaction T2, transaction T1 is moving money around. What can T2 see at each isolation level?',
      sql: `SELECT id, owner, balance
FROM accounts
WHERE balance >= 50
ORDER BY id`,
      notes: {
        from: 'T2’s snapshot decides which row versions exist here. Under Read Committed the snapshot was taken when this statement started; under Repeatable Read, when the transaction’s first statement started.',
        where: 'A predicate like `balance >= 50` is exactly what phantoms are about: re-running it later may match rows that were inserted or updated into range by transactions that committed in between.',
        select: 'Nothing here takes a lock: plain SELECTs read a snapshot and never block writers (and are never blocked by them).',
      },
      predictions: [
        {
          stage: 'where',
          kind: 'rowcount',
          question: 'No other transaction is active. How many accounts pass `balance >= 50`?',
          explain: 'alice (100) and bob (50) pass; carol (0) is dropped → 2 rows. `>=` keeps bob, who is exactly on the boundary.',
        },
        {
          stage: 'select',
          kind: 'choice',
          question: 'T1 has run `UPDATE accounts SET balance = 0 WHERE id = 1` but not committed. T2 runs this query under READ UNCOMMITTED. What does T2 see for alice?',
          options: ['balance 0 (dirty read)', 'balance 100 (the last committed version)', 'T2 blocks until T1 commits or rolls back', 'An error: row is locked'],
          answer: 1,
          explain: 'Postgres never dirty-reads: READ UNCOMMITTED is silently treated as READ COMMITTED. T2’s snapshot excludes T1’s uncommitted version, and readers don’t wait for writers, so it sees 100 immediately.',
        },
        {
          stage: 'order',
          kind: 'choice',
          question: 'T2 runs this query (2 rows), then T1 inserts account (4, \'dave\', 70) and commits, then T2 runs it again in the same transaction. Under REPEATABLE READ, how many rows does the second run return?',
          options: ['3 — dave is a phantom', '2 — the transaction keeps its first snapshot', 'It errors with 40001', '0'],
          answer: 1,
          explain: 'Repeatable Read in Postgres reads from the snapshot taken at the transaction’s first statement, so dave stays invisible: no phantom (stricter than the SQL standard requires). Under READ COMMITTED the second run takes a new snapshot and returns 3 rows.',
        },
      ],
      takeaway: 'Isolation in Postgres = which snapshot you read from (per statement vs per transaction) + what happens when you write a row someone else changed (re-check vs 40001). Plain SELECTs never block.',
    },
    build: {
      prompt: 'Lost updates leave no error — you find them by **reconciliation**. Compare each account’s stored balance with the sum of its ledger entries (`ledger` is given; accounts with no entries count as 0) and list only the drifted accounts with `id`, `owner`, `balance`, `ledger_balance` and `drift` (= balance − ledger), by id.',
      given: `ledger AS (
  SELECT *
  FROM (VALUES (101, 2, 20), (102, 2, 30), (103, 2, 20),
               (104, 3, 40), (105, 3, -40)) AS v(entry_id, account_id, delta)
)`,
      blocks: [
        { slot: 'select', sql: 'a.id', why: 'One output row per account — the grain of the check.' },
        { slot: 'select', sql: 'a.owner', why: 'Allowed without grouping by it: `a.id` is the primary key, so owner is functionally dependent on it.' },
        { slot: 'select', sql: 'a.balance', why: 'The stored (possibly corrupted) value.' },
        { slot: 'select', sql: 'COALESCE(SUM(l.delta), 0) AS ledger_balance', why: 'The balance implied by history. SUM over no entries is NULL; an account without entries has ledger balance 0.' },
        { slot: 'select', sql: 'a.balance - COALESCE(SUM(l.delta), 0) AS drift', why: 'Positive = money appeared from nowhere, negative = a credit was lost (bob’s concurrent +20 was overwritten).' },
        { slot: 'from', sql: 'accounts a', why: 'Start from the entity you are auditing so nothing can be silently skipped.' },
        { slot: 'join', sql: 'LEFT JOIN ledger l ON l.account_id = a.id', why: 'LEFT keeps accounts with no ledger entries at all — alice was migrated without an opening entry, the worst kind of drift.' },
        { slot: 'groupBy', sql: 'a.id', why: 'Collapse the ledger to one row per account.' },
        { slot: 'having', sql: 'a.balance <> COALESCE(SUM(l.delta), 0)', why: 'Filter on the aggregate, after grouping — WHERE cannot see SUM.' },
        { slot: 'orderBy', sql: 'a.id', why: 'Stable output for the on-call runbook.' },
      ],
      traps: [
        {
          slot: 'join',
          sql: 'JOIN ledger l ON l.account_id = a.id',
          replaces: 'LEFT JOIN ledger l ON l.account_id = a.id',
          why: 'An inner join silently drops accounts with no ledger entries, so alice’s 100 of unexplained money never shows up in the audit.',
        },
        {
          slot: 'having',
          sql: 'a.balance <> SUM(l.delta)',
          replaces: 'a.balance <> COALESCE(SUM(l.delta), 0)',
          why: '`100 <> NULL` is NULL, not TRUE, so HAVING drops alice. Comparisons with NULL need COALESCE (or IS DISTINCT FROM).',
        },
        {
          slot: 'select',
          sql: 'COALESCE(SUM(DISTINCT l.delta), 0) AS ledger_balance',
          replaces: 'COALESCE(SUM(l.delta), 0) AS ledger_balance',
          why: 'Bob has two legitimate +20 entries; DISTINCT collapses them, so the ledger shows 50 and the report contradicts its own drift column.',
        },
        {
          slot: 'where',
          sql: 'l.delta > 0',
          why: 'Counting only credits makes carol (deposit 40, withdrawal −40) look drifted, and the WHERE on the outer-joined table removes alice’s NULL row too.',
        },
      ],
    },
    exercises: [
      {
        id: 'iso-atomic-transfer',
        kind: 'write',
        title: 'Transfer in one statement',
        difficulty: 'Easy',
        prompt: 'Move 30 from alice (id 1) to bob (id 2) with a **single UPDATE** statement (so both rows change atomically, even in autocommit mode), then return `id`, `owner`, `balance` of all accounts ordered by id.',
        solution: `UPDATE accounts
SET balance = balance + CASE id WHEN 1 THEN -30 WHEN 2 THEN 30 END
WHERE id IN (1, 2);
SELECT id, owner, balance FROM accounts ORDER BY id`,
        hints: ['One UPDATE can touch both rows: filter `id IN (1, 2)`.', 'Use a CASE on id to choose −30 or +30, relative to the current balance.'],
        explanation: 'A single statement is atomic on its own and both row changes become visible together. Writing `balance + …` instead of a precomputed constant means a concurrent change to either row is not lost: under Read Committed the UPDATE waits for the other writer and re-applies the expression to the newest version. Bonus: one statement locks both rows in one go, in the order the plan visits them; with two separate UPDATEs, two opposite transfers can deadlock.',
      },
      {
        id: 'iso-fee-guard',
        kind: 'fix-bug',
        title: 'Monthly fee overdraws accounts',
        difficulty: 'Medium',
        prompt: 'A batch job charges a fee of 60 to every account that can afford it (balance must never go negative); accounts that can’t afford it are skipped. The job below overdraws bob and carol. Fix the statement, then return `id`, `owner`, `balance` ordered by id.',
        starter: `UPDATE accounts
SET balance = balance - 60;
SELECT id, owner, balance FROM accounts ORDER BY id`,
        solution: `UPDATE accounts
SET balance = balance - 60
WHERE balance >= 60;
SELECT id, owner, balance FROM accounts ORDER BY id`,
        hints: ['The guard belongs in the same statement as the write.', 'Which rows should the UPDATE target at all?'],
        explanation: 'Putting the guard in the UPDATE’s WHERE makes check and write one atomic step. Even with concurrent writers it stays correct: under Read Committed, if another transaction changed a row first, Postgres waits, re-reads the newest version and re-evaluates `balance >= 60` on it before charging. Checking in application code (“SELECT balance … if balance >= 60 then UPDATE”) loses that guarantee.',
      },
      {
        id: 'iso-batch-overdraft',
        kind: 'write',
        title: 'Each check passes, together they overdraw',
        difficulty: 'Medium',
        prompt: 'A queue holds pending debits: `(1, 60), (1, 50), (2, 30), (2, 40), (3, 0)` as `(account_id, amount)`. Every single debit is ≤ its account’s balance, so a per-debit check passes them all. Return the accounts that would go **negative if all debits are applied**: `id`, `owner`, `balance`, `total_debits`, `balance_after`, ordered by id.',
        solution: `WITH debits(account_id, amount) AS (
  VALUES (1, 60), (1, 50), (2, 30), (2, 40), (3, 0)
)
SELECT a.id, a.owner, a.balance,
       SUM(d.amount) AS total_debits,
       a.balance - SUM(d.amount) AS balance_after
FROM accounts a
JOIN debits d ON d.account_id = a.id
GROUP BY a.id
HAVING a.balance - SUM(d.amount) < 0
ORDER BY a.id`,
        hints: ['Put the debits in a VALUES CTE.', 'Aggregate debits per account before comparing with the balance; filter with HAVING.'],
        explanation: 'alice: 60 and 50 each fit in 100, together they need 110 (−10); bob: 30 + 40 = 70 > 50 (−20). This is exactly what concurrent transactions do when each checks the balance against its own snapshot: every check is true, the combination is not. Set-based checks (or guarded atomic updates applied one at a time) see the cumulative effect.',
      },
    ],
    judgment: [
      {
        id: 'iso-review-withdraw',
        kind: 'peer-review',
        title: 'PR: “withdraw endpoint (inside a transaction, so it’s safe)”',
        context: 'The withdraw handler runs in a transaction at the default isolation (Read Committed). It reads the balance, checks it in Python and writes back `balance - amount`. Below, a concurrent deposit of 50 is replayed in between, exactly as it happened in production.',
        sql: `-- request A (withdraw 80): read the balance
SELECT balance FROM accounts WHERE id = 1;            -- app sees 100
-- request B (deposit 50) commits meanwhile:
UPDATE accounts SET balance = balance + 50 WHERE id = 1;
-- request A writes the value it computed: 100 - 80
UPDATE accounts SET balance = 20 WHERE id = 1;
SELECT id, owner, balance FROM accounts ORDER BY id;`,
        bugLines: [6],
        options: [
          {
            text: 'The write uses a value computed from a stale read, so B’s deposit is overwritten (lost update). Do it as one guarded, relative UPDATE.',
            correct: true,
            why: '`SET balance = balance - 80 WHERE id = 1 AND balance >= 80` is re-evaluated on the newest row version after B commits: 150 − 80 = 70, nothing lost.',
          },
          {
            text: 'Being inside a transaction already prevents this; the bug is elsewhere.',
            why: 'A transaction makes A all-or-nothing; under Read Committed it does not stop B from committing between A’s read and write.',
          },
          {
            text: 'Request A should use READ UNCOMMITTED so it sees B’s deposit.',
            why: 'Postgres has no dirty reads, and B commits after A’s read anyway; no isolation level makes a stale constant correct.',
          },
          {
            text: 'The SELECT should be `SELECT *` to read the latest version.',
            why: 'Column lists don’t change which version is read; the problem is the time gap between read and write.',
          },
        ],
        fixedSql: `-- request B (deposit 50) commits first:
UPDATE accounts SET balance = balance + 50 WHERE id = 1;
-- request A: check and write in one atomic statement
UPDATE accounts SET balance = balance - 80 WHERE id = 1 AND balance >= 80;
SELECT id, owner, balance FROM accounts ORDER BY id;`,
        lesson: 'Never write back a value computed from an earlier read. Make the write relative (`balance - 80`) with the guard in its WHERE — or lock the row with `SELECT … FOR UPDATE` before reading.',
      },
      {
        id: 'iso-spot-read-skew',
        kind: 'spot-bug',
        title: 'Share-of-deposits report adds up to 133 %',
        context: 'A nightly report first fetches the total, caches it in the app, then computes each account’s share in a second query (Read Committed). A deposit to carol committed between the two statements; the replay below reproduces it. Finance noticed the percentages sum to more than 100.',
        sql: `SELECT SUM(balance) AS cached_total FROM accounts;   -- app caches 150
-- a deposit of 50 to carol commits between the two statements:
UPDATE accounts SET balance = balance + 50 WHERE id = 3;
-- second statement uses the cached total
SELECT id, owner, balance,
       round(100.0 * balance / 150, 1) AS pct_of_total
FROM accounts
ORDER BY id;`,
        bugLines: [6],
        options: [
          {
            text: 'The total and the details come from two different snapshots (read skew); compute the total in the same statement with `SUM(balance) OVER ()`.',
            correct: true,
            why: 'One statement = one snapshot under Read Committed, so shares always sum to 100 %. Alternatively run both statements in a REPEATABLE READ transaction.',
          },
          {
            text: 'Integer division truncates the percentages.',
            why: '`100.0 * balance` is numeric, so the division is exact enough; the numbers are wrong because the total is stale.',
          },
          {
            text: 'round(…, 1) accumulates rounding errors.',
            why: 'Rounding moves totals by tenths, not by 33 percentage points.',
          },
          {
            text: 'The report needs `SELECT … FOR UPDATE` to block deposits.',
            why: 'Locking every account to produce a report would stall payments; a consistent snapshot gives the same correctness without blocking anyone.',
          },
        ],
        fixedSql: `-- a deposit of 50 to carol commits before the (single) report statement:
UPDATE accounts SET balance = balance + 50 WHERE id = 3;
SELECT id, owner, balance,
       round(100.0 * balance / SUM(balance) OVER (), 1) AS pct_of_total
FROM accounts
ORDER BY id;`,
        lesson: 'Under Read Committed each statement sees a different moment. Numbers that must agree should come from one statement — or from one REPEATABLE READ (read-only) transaction.',
      },
    ],
    recall: [
      { q: 'Which anomalies does each standard isolation level allow?', a: 'Read Uncommitted: dirty reads, non-repeatable reads, phantoms. Read Committed: non-repeatable reads, phantoms. Repeatable Read: phantoms. Serializable: none. (Lost updates and write skew are also prevented only by Serializable.)' },
      { q: 'How does Postgres differ from the standard table?', a: 'Read Uncommitted = Read Committed (never dirty reads); Repeatable Read is snapshot isolation and also prevents phantoms; Serializable is SSI (snapshot + dependency tracking, aborts with 40001).' },
      { q: 'When is the snapshot taken in Read Committed vs Repeatable Read?', a: 'Read Committed: at the start of every statement. Repeatable Read / Serializable: at the first statement of the transaction (not at BEGIN), then reused.' },
      { q: 'What must the application do on SQLSTATE 40001?', a: 'Roll back and retry the whole transaction (bounded attempts, backoff). The error means “no serial order exists for what you did”, not a bug.' },
    ],
    transfer: [
      {
        id: 'iso-t-tickets',
        scenario: 'A concert ticketing API must never sell more seats than capacity, even when 1 000 people click “buy” for the last 10 seats at the same second.',
        approach: 'Make the decrement atomic: `UPDATE events SET sold = sold + :n WHERE id = :id AND sold + :n <= capacity RETURNING sold` — 0 rows means sold out. Under Read Committed the guard is re-checked on the newest version, so no oversell, no retries needed. Avoid SELECT-then-UPDATE in app code.',
      },
      {
        id: 'iso-t-month-close',
        scenario: 'Month-end close runs ten queries (totals per ledger, per region, per product) that auditors compare with each other, while payments keep flowing.',
        approach: 'Run all of them inside one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction (or SERIALIZABLE READ ONLY DEFERRABLE): every query sees the same snapshot, nothing is locked, writers continue. Keep it reasonably short — a long snapshot holds back VACUUM.',
      },
      {
        id: 'iso-t-doctors',
        scenario: 'Doctors can leave the on-call rota as long as at least one doctor remains on call. Two doctors press “leave” simultaneously and the rota ends up empty.',
        approach: 'That is write skew, which Repeatable Read allows. Run the check + update as SERIALIZABLE and retry on 40001, or lock the shift’s rows (`SELECT … FROM rota WHERE shift_id = :s FOR UPDATE`) before counting.',
      },
    ],
    confusable: ['mvcc-locking', 'upsert-idempotent'],
  },

  // ───────────────────────────────────────────────────────────────── mvcc-locking
  {
    id: 'mvcc-locking',
    track: 'transactions',
    title: 'MVCC, row locks & concurrency patterns',
    tagline: 'Every UPDATE writes a new row version; locks only serialize writers. Pick the right tool: atomic UPDATE, FOR UPDATE, SKIP LOCKED, optimistic versions, or SERIALIZABLE.',
    level: 'advanced',
    minutes: 20,
    interview: 3,
    viz: 'isolation',
    scenarios: ['lost-update-fixed', 'write-skew', 'deadlock'],
    intuition: [
      'Postgres never overwrites a row in place. An `UPDATE` marks the current version as dead (sets its `xmax`) and appends a **new version** (with a new `xmin` and a new physical address, `ctid`). Readers pick the version their snapshot can see, which is why reads never wait for writes.',
      'Writers on the **same row** do wait: the second `UPDATE` blocks until the first transaction ends. That row lock is what makes `UPDATE … SET stock = stock - 1 WHERE stock > 0` safe. When the decision needs several statements, take the lock yourself up front with `SELECT … FOR UPDATE`, decide, then write — the **pessimistic** approach.',
      'The **optimistic** approach takes no lock: read a `version` column, and write with `WHERE id = :id AND version = :read_version`, bumping the version. If 0 rows were updated, someone else won; reload and retry (or show “this record was changed”). Great for long user think-time (edit forms) where holding a lock is impossible.',
      'Locks have their own failure modes. **Deadlocks** happen when two transactions lock the same rows in opposite orders — fix by always locking in a consistent order (e.g. by id). **Write skew** happens when the invariant spans rows nobody writes in common — lock all of them, or use SERIALIZABLE. **Queues** need workers to skip rows others hold: `FOR UPDATE SKIP LOCKED`; and **NOWAIT** fails fast instead of queueing.',
    ],
    internals: [
      'Each heap tuple has a header with **xmin** (inserting transaction), **xmax** (deleting or locking transaction) and **ctid** (pointer to the newer version). Visibility = is xmin committed and in my snapshot, and is xmax not. Commit status lives in the commit log (pg_xact); hint bits cache it on the tuple. An UPDATE that changes no indexed column and fits on the same page is a **HOT** update: no new index entries, which is why `fillfactor` < 100 helps hot-updated tables.',
      'Dead versions are reclaimed by **VACUUM** (autovacuum) once no snapshot can still see them — i.e. older than the oldest running transaction’s xmin. One idle-in-transaction session or a long analytics query holds that horizon back and the table **bloats**: more pages to scan, bigger indexes. VACUUM also **freezes** old xids to avoid 32-bit transaction-id wraparound; `VACUUM FULL` rewrites the table but takes an ACCESS EXCLUSIVE lock.',
      'Row locks are stored **in the tuple** (xmax + infomask bits; a MultiXact when several share it), not in a lock table, so locking a million rows costs no shared memory but does dirty pages. Modes, strongest first: `FOR UPDATE`, `FOR NO KEY UPDATE` (taken by ordinary UPDATEs), `FOR SHARE`, `FOR KEY SHARE` (taken by foreign-key checks). A waiter sleeps on the holder’s transaction id; after `deadlock_timeout` (1 s) the deadlock detector walks the wait-for graph and aborts one victim with SQLSTATE `40P01`.',
      '**Advisory locks** (`pg_advisory_xact_lock(key)`, `pg_try_advisory_lock(key)`) are app-defined locks on a bigint in the shared lock table — handy for “only one cron run at a time” or per-tenant migrations. Transaction-level ones release at commit; session-level ones survive it and are dangerous behind a transaction-pooling PgBouncer. Under **SERIALIZABLE**, SSI adds non-blocking SIREAD locks to detect write skew and aborts with `40001` instead.',
    ],
    signals: [
      'job queue / workers pick the next task without double-processing',
      'counter, stock or balance decremented concurrently',
      'two users edit the same record (edit form, CMS) — last write wins?',
      'deadlock detected (40P01) / lock waits / NOWAIT',
      'invariant across several rows (at least one on call, total limit)',
      'table bloat, autovacuum, long-running transaction',
    ],
    template: `-- atomic: the row lock + WHERE re-check make this safe
UPDATE products SET stock = stock - 1 WHERE id = :id AND stock > 0 RETURNING stock;

-- pessimistic: lock first (consistent order!), decide, then write
SELECT id, balance FROM accounts WHERE id IN (:a, :b) ORDER BY id FOR UPDATE;

-- optimistic: no lock, compare-and-set on a version column (0 rows = conflict → retry)
UPDATE docs SET body = :body, version = version + 1 WHERE id = :id AND version = :read_version;

-- work queue: each worker grabs a different row, nobody waits
UPDATE jobs SET status = 'running', worker = :me
WHERE id = (SELECT id FROM jobs WHERE status = 'queued'
            ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING id;`,
    realWorld: [
      {
        title: 'Postgres as a job queue (and outbox)',
        body: 'Tools like Que, GoodJob, graphile-worker and many outbox relays claim work with `FOR UPDATE SKIP LOCKED`: workers never block each other and a crashed worker’s lock disappears with its connection. Pair it with a partial index on the queued rows (`WHERE status = \'queued\'`) and delete/archive finished jobs, or the table bloats from constant updates.',
      },
      {
        title: 'Optimistic locking in ORMs and APIs',
        body: 'JPA `@Version`, Rails `lock_version`, Django-concurrency and HTTP `ETag` / `If-Match` all implement compare-and-set on a version. A 0-row update becomes an `OptimisticLockException` / 409 / 412. It scales because nothing is held while the user thinks.',
      },
      {
        title: 'Incident: autovacuum can’t keep up',
        body: 'A reporting replica with `hot_standby_feedback` or an app session left `idle in transaction` pins the xmin horizon; a hot `UPDATE`-heavy table grows 10× and queries slow down. Monitor `pg_stat_activity` (xact_start), set `idle_in_transaction_session_timeout`, and keep transactions short.',
      },
    ],
    mistakes: [
      {
        title: 'Locking in inconsistent order',
        why: 'T1 locks alice then bob, T2 locks bob then alice: each waits for the other until the deadlock detector kills one (40P01).',
        fix: 'Always lock rows in a deterministic order (`ORDER BY id FOR UPDATE`), or update both in one statement; retry on 40P01 anyway.',
      },
      {
        title: 'SELECT then UPDATE a queue row without SKIP LOCKED',
        why: 'Two workers read the same “next job” and both process it; with plain `FOR UPDATE` they don’t double-process but queue behind each other, killing throughput.',
        fix: '`… ORDER BY created_at LIMIT n FOR UPDATE SKIP LOCKED` inside the claiming UPDATE.',
      },
      {
        title: 'Holding locks across user think-time or network calls',
        why: 'A transaction that locks a row and then calls a payment API (or waits for a user) blocks every other writer and pins VACUUM.',
        fix: 'Keep transactions short; use optimistic version checks for long edits and an outbox for external calls.',
      },
      {
        title: 'Believing Repeatable Read stops write skew',
        why: 'Both transactions read the same snapshot and write different rows; there is no row-level conflict to detect.',
        fix: 'Lock every row the invariant reads (`FOR UPDATE`), materialize the conflict on a shared row, or run SERIALIZABLE with retries.',
      },
    ],
    worked: {
      question: 'Look under the hood: every row version carries hidden system columns. What do they say about alice’s row now, and what changes when someone updates it?',
      sql: `SELECT ctid, xmin, xmax, id, owner, balance
FROM accounts
ORDER BY id`,
      notes: {
        from: 'A sequential scan reads heap page 0 and checks each tuple header against this statement’s snapshot. Dead versions would be read too and skipped — that is the cost of bloat.',
        select: '`ctid` = (page, slot) physical address; `xmin` = id of the transaction that created this version (all three rows come from the same seed transaction); `xmax` = 0 means nobody has deleted, updated or locked it. If you see a non-zero xmax on a live row, it belongs to a transaction that **aborted** (every exercise here runs in BEGIN … ROLLBACK) — the version stays visible because the commit log says that writer never committed.',
        order: 'ctid order and id order coincide here only because rows were inserted in id order and never updated. After updates, physical order drifts — never rely on it without ORDER BY.',
      },
      predictions: [
        {
          stage: 'select',
          kind: 'choice',
          question: 'A transaction runs `UPDATE accounts SET balance = balance - 30 WHERE id = 1` and commits. Re-running this query, what is alice’s ctid?',
          options: ['(0,1) — updated in place', 'A new address such as (0,4) — a new version was appended', '(1,1) — the row always moves to a new page', 'NULL until VACUUM runs'],
          answer: 1,
          explain: 'UPDATE = insert a new version + mark the old one dead. On a fresh database the new tuple lands in the next free slot on the same page, (0,4) (later if rolled-back runs left dead versions behind), with xmin = the updating transaction; (0,1) stays on disk as a dead tuple until pruning/VACUUM reclaims it.',
        },
        {
          stage: 'order',
          kind: 'choice',
          question: 'T1 has updated alice but not committed. T2 runs this query. What happens?',
          options: ['T2 blocks until T1 finishes', 'T2 sees balance 70 (T1’s new version)', 'T2 sees 100, and alice’s xmax shows T1’s transaction id', 'T2 gets a serialization error'],
          answer: 2,
          explain: 'Readers never wait for writers: T2 reads the old version (visible to its snapshot). Its xmax is now T1’s id — a hint that someone is changing it — but T1 hasn’t committed, so the version is still live for T2.',
        },
      ],
      takeaway: 'MVCC = new version per write + snapshot per reader; locks only order writers on the same row. Every concurrency pattern (atomic update, FOR UPDATE, SKIP LOCKED, version checks) builds on that.',
    },
    build: {
      prompt: 'Build the claim query for a worker that processes **pending** orders as a queue: the 2 oldest pending orders (`id`, `user_id`, `amount`, `ordered_at`), oldest first (ties by id), locked for this worker while other workers skip them.',
      blocks: [
        { slot: 'select', sql: 'o.id', why: 'The job key the worker will update when done.' },
        { slot: 'select', sql: 'o.user_id', why: 'Payload the worker needs.' },
        { slot: 'select', sql: 'o.amount', why: 'Payload the worker needs.' },
        { slot: 'select', sql: 'o.ordered_at', why: 'Shows FIFO order in the result.' },
        { slot: 'from', sql: 'orders o', why: 'The queue table. Plain rows only: row locks need to know which physical row each output row came from.' },
        { slot: 'where', sql: "o.status = 'pending'", why: 'Only unclaimed work. In production, a partial index `WHERE status = \'pending\'` keeps this cheap as finished rows pile up.' },
        { slot: 'orderBy', sql: 'o.ordered_at', why: 'FIFO: oldest work first, so nothing starves.' },
        { slot: 'orderBy', sql: 'o.id', why: 'Deterministic tie-break — also gives every worker the same lock order.' },
        {
          slot: 'limit',
          sql: '2 FOR UPDATE SKIP LOCKED',
          why: 'Batch of 2, locked until this worker commits. SKIP LOCKED makes other workers pass over these rows instead of waiting — the locking clause is written after LIMIT.',
        },
      ],
      traps: [
        {
          slot: 'orderBy',
          sql: 'o.ordered_at DESC',
          replaces: 'o.ordered_at',
          why: 'LIFO: new work is always taken first and the oldest pending order (7, from February) can starve forever under load.',
        },
        {
          slot: 'where',
          sql: "o.status <> 'paid'",
          replaces: "o.status = 'pending'",
          why: 'A negative filter also matches refunded orders (and any future status) — the worker would “process” order 4, a refund.',
        },
        {
          slot: 'select',
          sql: 'COUNT(*) OVER () AS queue_depth',
          why: 'Postgres refuses: FOR UPDATE is not allowed with window functions (or GROUP BY / DISTINCT / aggregates) — locks need one output row per physical row. Get the queue depth in a separate query.',
        },
        {
          slot: 'groupBy',
          sql: 'o.id',
          why: 'FOR UPDATE is not allowed with GROUP BY: grouped rows no longer map to single heap tuples, so there is nothing to lock.',
        },
      ],
    },
    exercises: [
      {
        id: 'mvcc-optimistic-version',
        kind: 'fix-bug',
        title: 'Edit form overwrites a newer change',
        difficulty: 'Medium',
        setup: `ALTER TABLE accounts ADD COLUMN version int NOT NULL DEFAULT 1;
-- after the form was loaded, another request deposited 50 to alice:
UPDATE accounts SET balance = balance + 50, version = version + 1 WHERE id = 1;`,
        prompt: 'An admin loaded alice (balance 100, `version` 1) and bob (balance 50, `version` 1) into an edit form. Since then another request changed alice (the setup already did that: 150, version 2). Saving the form must use **optimistic locking**: set alice to 20 and bob to 30 only if the row still has the version that was read, and bump `version` on success. Return `id`, `balance`, `version` ordered by id.',
        starter: `UPDATE accounts SET balance = 20 WHERE id = 1;
UPDATE accounts SET balance = 30 WHERE id = 2;
SELECT id, balance, version FROM accounts ORDER BY id`,
        solution: `UPDATE accounts SET balance = 20, version = version + 1 WHERE id = 1 AND version = 1;
UPDATE accounts SET balance = 30, version = version + 1 WHERE id = 2 AND version = 1;
SELECT id, balance, version FROM accounts ORDER BY id`,
        hints: ['Add the version you read to the WHERE clause (compare-and-set).', 'Increment version in the same UPDATE so the next writer with the old version fails.'],
        explanation: 'Alice’s update matches 0 rows (her version is now 2), so the deposit survives and the app reports a conflict (409 / reload). Bob’s update succeeds and moves him to version 2. No lock is held while the admin edits; the cost is a retry on conflict. Check the affected row count (or use RETURNING) — silently ignoring 0 is the classic bug.',
      },
      {
        id: 'mvcc-skip-locked-claim',
        kind: 'write',
        title: 'Claim the next job',
        difficulty: 'Medium',
        prompt: 'Workers treat pending orders as a queue. Write **one statement** that claims the oldest pending order (ties by id) by setting its `status` to `\'processing\'`, skipping rows other workers have locked, and returns its `id`, `user_id`, `status`.',
        solution: `UPDATE orders
SET status = 'processing'
WHERE id = (
  SELECT id
  FROM orders
  WHERE status = 'pending'
  ORDER BY ordered_at, id
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING id, user_id, status`,
        hints: ['Pick the row in a subquery with ORDER BY … LIMIT 1.', 'Add `FOR UPDATE SKIP LOCKED` to the subquery and RETURNING to the UPDATE.'],
        explanation: 'The subquery locks one pending row that no one else holds; the UPDATE claims it and RETURNING hands it to the worker in the same round trip. Concurrent workers each get a different order without waiting. If a worker crashes before committing, its lock vanishes and the row is claimable again. Without SKIP LOCKED, workers serialize behind the first one; without FOR UPDATE, two workers can claim the same row.',
      },
      {
        id: 'mvcc-batch-transfers',
        kind: 'fix-bug',
        title: 'Batch transfers lose money',
        difficulty: 'Hard',
        prompt: 'Apply these transfers `(src, dst, amount)`: `(1, 2, 30), (1, 3, 20), (2, 3, 10)`. The job below debits and credits with `UPDATE … FROM`, but balances come out wrong (alice is debited only once). Fix it so each account receives its **net** change, then return `id`, `owner`, `balance` ordered by id.',
        starter: `WITH transfers(src, dst, amount) AS (VALUES (1, 2, 30), (1, 3, 20), (2, 3, 10))
UPDATE accounts a SET balance = a.balance - t.amount
FROM transfers t WHERE a.id = t.src;
WITH transfers(src, dst, amount) AS (VALUES (1, 2, 30), (1, 3, 20), (2, 3, 10))
UPDATE accounts a SET balance = a.balance + t.amount
FROM transfers t WHERE a.id = t.dst;
SELECT id, owner, balance FROM accounts ORDER BY id`,
        solution: `WITH transfers(src, dst, amount) AS (
  VALUES (1, 2, 30), (1, 3, 20), (2, 3, 10)
),
net AS (
  SELECT id, SUM(delta) AS delta
  FROM (SELECT src AS id, -amount AS delta FROM transfers
        UNION ALL
        SELECT dst, amount FROM transfers) d
  GROUP BY id
)
UPDATE accounts a
SET balance = a.balance + n.delta
FROM net n
WHERE a.id = n.id;
SELECT id, owner, balance FROM accounts ORDER BY id`,
        hints: ['How many transfer rows match alice as src? How many times can one UPDATE change a row?', 'Turn transfers into (account, delta) rows, sum per account, then update once per account.'],
        explanation: 'A statement can replace a row version only once: when `UPDATE … FROM` joins a target row to several source rows, Postgres applies one (unpredictable) match and ignores the rest, because the row version was already replaced by this statement — no error, just lost money. Aggregating to one net delta per account makes the join one-to-one: alice 50, bob 70, carol 30 (total still 150). One statement also locks each account exactly once, and sorting work by id is the standard way to keep batch jobs deadlock-free.',
      },
    ],
    judgment: [
      {
        id: 'mvcc-review-double-claim',
        kind: 'peer-review',
        title: 'PR: “scale the order worker to 2 replicas”',
        context: 'The worker reads the next pending order, then marks it processing by id. With two replicas, ops sees some orders shipped twice and others waiting. The replay shows both workers polling at the same moment.',
        sql: `-- worker A and worker B poll at the same time (no locks taken):
SELECT id FROM orders WHERE status = 'pending' ORDER BY ordered_at, id LIMIT 1;  -- both get 7
-- worker A claims what it read
UPDATE orders SET status = 'processing' WHERE id = 7;
-- worker B claims what it read
UPDATE orders SET status = 'processing' WHERE id = 7;
SELECT id, status FROM orders WHERE id IN (7, 12) ORDER BY id;`,
        bugLines: [2],
        options: [
          {
            text: 'The read takes no lock, so both workers pick order 7; claim inside one UPDATE with a `FOR UPDATE SKIP LOCKED` subquery.',
            correct: true,
            why: 'Each worker then locks a different pending row: A gets 7, B skips it and gets 12. Both are processed exactly once and nobody waits.',
          },
          {
            text: 'Add `FOR UPDATE` (without SKIP LOCKED) to the SELECT.',
            why: 'Prevents the double claim only if the UPDATE re-checks status, and B waits for A’s whole transaction — two replicas, one worker’s throughput.',
          },
          {
            text: 'Run the workers under SERIALIZABLE.',
            why: 'One worker would fail with 40001 and retry — correct, but it turns every collision into an aborted transaction instead of simply taking the next job.',
          },
          {
            text: 'ORDER BY ordered_at is non-deterministic; that is why orders are processed twice.',
            why: 'The tie-break by id makes it deterministic — and determinism is exactly why both workers pick the same row.',
          },
        ],
        fixedSql: `-- each worker runs the same atomic claim (worker A, then worker B):
UPDATE orders SET status = 'processing'
WHERE id = (SELECT id FROM orders WHERE status = 'pending'
            ORDER BY ordered_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING id;
UPDATE orders SET status = 'processing'
WHERE id = (SELECT id FROM orders WHERE status = 'pending'
            ORDER BY ordered_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING id;
SELECT id, status FROM orders WHERE id IN (7, 12) ORDER BY id;`,
        lesson: 'A read that informs a write must either lock (FOR UPDATE [SKIP LOCKED]) or be re-checked inside the write. For queues, the claim and the lock belong in one statement.',
      },
      {
        id: 'mvcc-spot-write-skew',
        kind: 'spot-bug',
        title: 'Joint-account limit breached under REPEATABLE READ',
        context: 'Rule: alice and bob share a household limit — their combined balance must stay ≥ 100. The service checks the sum and then withdraws, in a REPEATABLE READ transaction “so the numbers can’t change under us”. Two withdrawals of 40 ran concurrently; the replay shows both decisions.',
        sql: `-- T1 and T2 run concurrently under REPEATABLE READ; each checks the rule first:
SELECT SUM(balance) AS household FROM accounts WHERE id IN (1, 2);  -- both see 150
-- T1: 150 - 40 = 110 >= 100, ok → withdraw 40 from alice
UPDATE accounts SET balance = balance - 40 WHERE id = 1;
-- T2 (own snapshot, still sees 150): ok → withdraw 40 from bob
UPDATE accounts SET balance = balance - 40 WHERE id = 2;
SELECT id, owner, balance, SUM(balance) OVER () AS household
FROM accounts WHERE id IN (1, 2) ORDER BY id;`,
        bugLines: [2],
        options: [
          {
            text: 'Write skew: the check reads rows it doesn’t lock, and T1/T2 write different rows, so snapshot isolation sees no conflict. Lock both rows (FOR UPDATE) before checking, or use SERIALIZABLE.',
            correct: true,
            why: 'With `FOR UPDATE` on both rows (in id order) T2 waits for T1, then (Read Committed) re-reads 110 and refuses. Under SERIALIZABLE, SSI aborts one transaction with 40001 instead.',
          },
          {
            text: 'Repeatable Read should have raised 40001 — this is a Postgres bug.',
            why: 'Repeatable Read only errors when two transactions update the same row; here they update different rows.',
          },
          {
            text: 'Use READ COMMITTED so T2 sees T1’s update.',
            why: 'T1 hasn’t committed when T2 checks; under Read Committed both checks still see 150.',
          },
          {
            text: 'The UPDATEs need `RETURNING balance`.',
            why: 'Returning the new balance doesn’t stop the second withdrawal; the decision was already made on stale data.',
          },
        ],
        fixedSql: `-- each transaction first locks BOTH rows of the invariant, in id order:
SELECT id, balance FROM accounts WHERE id IN (1, 2) ORDER BY id FOR UPDATE;
-- T1: 150 - 40 = 110 >= 100 → withdraw from alice, commit
UPDATE accounts SET balance = balance - 40 WHERE id = 1;
-- T2 waited on the lock; under READ COMMITTED it re-checks and sees 110 → refuses
-- (under REPEATABLE READ it gets 40001 instead, and its retry sees 110)
UPDATE accounts SET balance = balance - 40
WHERE id = 2
  AND (SELECT SUM(balance) FROM accounts WHERE id IN (1, 2)) - 40 >= 100;
SELECT id, owner, balance, SUM(balance) OVER () AS household
FROM accounts WHERE id IN (1, 2) ORDER BY id;`,
        lesson: 'Snapshot isolation protects rows you write, not invariants over rows you only read. Lock what the decision depends on (in a consistent order), materialize the conflict on one shared row, or let SERIALIZABLE detect it and retry.',
      },
    ],
    recall: [
      { q: 'What physically happens on an UPDATE in Postgres?', a: 'A new tuple version is written (new xmin, new ctid); the old version gets xmax = updater’s xid and becomes dead after commit. VACUUM reclaims it once no snapshot needs it. HOT updates avoid new index entries when no indexed column changes.' },
      { q: 'FOR UPDATE vs FOR UPDATE SKIP LOCKED vs NOWAIT?', a: 'FOR UPDATE waits for conflicting locks; SKIP LOCKED silently omits locked rows (queues); NOWAIT raises an error (55P03) immediately instead of waiting.' },
      { q: 'Optimistic vs pessimistic locking — when each?', a: 'Pessimistic (FOR UPDATE) for short, high-contention critical sections inside one transaction. Optimistic (version column, compare-and-set, retry on 0 rows) for low contention or long think-time where holding locks is impossible.' },
      { q: 'How do you prevent deadlocks?', a: 'Acquire locks in a consistent global order (e.g. ORDER BY id FOR UPDATE), keep transactions short, touch rows in one statement when possible — and still retry on 40P01.' },
    ],
    transfer: [
      {
        id: 'mvcc-t-inventory',
        scenario: 'Flash sale: 5 000 requests per second try to reserve units of one SKU; the stock row becomes a hotspot and p99 latency explodes.',
        approach: 'Correctness: atomic `UPDATE stock SET qty = qty - 1 WHERE sku = :s AND qty > 0 RETURNING qty`. Hotspot: every writer queues on one row lock, so split stock into N bucket rows (pick a random bucket, fall back to others) or pre-allocate reservation tokens claimed with SKIP LOCKED.',
      },
      {
        id: 'mvcc-t-cron',
        scenario: 'A billing cron runs on 3 app servers for redundancy, but the monthly invoice job must run only once at a time.',
        approach: '`SELECT pg_try_advisory_xact_lock(hashtext(\'monthly-invoices\'))` at the start of the job’s transaction: only one server gets true; the others exit. The lock releases automatically at commit or if the server dies. Make the job itself idempotent too.',
      },
      {
        id: 'mvcc-t-wiki',
        scenario: 'A wiki lets two editors open the same page for 20 minutes; the second save must not silently erase the first editor’s changes.',
        approach: 'Optimistic locking: send the page version (or ETag) with the form and save with `WHERE id = :id AND version = :v`, incrementing version. 0 rows → show a merge/conflict screen. Never hold a FOR UPDATE lock across user think-time.',
      },
    ],
    confusable: ['isolation-anomalies', 'upsert-idempotent'],
  },

  // ───────────────────────────────────────────────────────────────── upsert-idempotent
  {
    id: 'upsert-idempotent',
    track: 'transactions',
    title: 'Upserts & idempotent writes',
    tagline: 'Retries, re-runs and duplicate messages are normal. Design every write so doing it twice has the same effect as doing it once.',
    level: 'intermediate',
    minutes: 16,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      'Networks time out, schedulers retry, Kafka redelivers, users double-click. If a write is not **idempotent**, every retry is a potential duplicate charge, duplicate row or double-counted metric. The goal: running the same operation N times leaves the system exactly as running it once.',
      'The database tool is the **upsert**: `INSERT … ON CONFLICT (key) DO UPDATE SET col = EXCLUDED.col` (insert, or update the existing row with the proposed values) or `ON CONFLICT DO NOTHING` (insert once, ignore repeats). It needs a **unique index/constraint** on the natural key — the constraint, not your code, decides what “the same” means.',
      'Idempotent loads also need **clean input**: one row per key. If the batch itself contains the key twice (CDC events, mixed-case emails), the upsert fails with `ON CONFLICT DO UPDATE command cannot affect row a second time`. Normalize the key and keep the latest version per key first (`DISTINCT ON` / `ROW_NUMBER`).',
      'Two more rules make upserts truly idempotent: **overwrite with recomputed values, don’t increment** (`SET revenue = EXCLUDED.revenue`, not `revenue + EXCLUDED.revenue`), and **don’t let old data overwrite new** (`DO UPDATE … WHERE target.updated_at < EXCLUDED.updated_at`). For APIs, the client sends an **idempotency key**; the server stores it under a unique constraint with the result and replays the stored result on retry.',
    ],
    internals: [
      '`ON CONFLICT` uses **speculative insertion**: Postgres first probes the arbiter unique index; if no conflict, it inserts the heap tuple marked speculative, then inserts the index entry. If a concurrent transaction inserted the same key in between, it kills its own speculative tuple and loops back to the update/nothing path. Result: under Read Committed you never get a unique violation on the arbiter and never lose the update — no retry loop needed, unlike “SELECT then INSERT”.',
      '`DO UPDATE` locks the existing row (like FOR UPDATE) and updates it even if it isn’t visible to your snapshot. `EXCLUDED` is the row that was proposed for insertion (after BEFORE triggers). Rows skipped by `DO NOTHING` or by a false `DO UPDATE … WHERE` are not returned by RETURNING. Default values such as `nextval()` are evaluated **before** the conflict check, so sequences get gaps on every update path.',
      '`MERGE` (Postgres 15+, RETURNING and `merge_action()` in 17) is the SQL-standard multi-branch statement: `WHEN MATCHED [AND …] THEN UPDATE/DELETE`, `WHEN NOT MATCHED THEN INSERT`, and in 17 `WHEN NOT MATCHED BY SOURCE`. It is a join, not a speculative insert: two concurrent MERGEs inserting the same new key can still raise a unique violation, so for high-concurrency upserts ON CONFLICT is the safer tool. Duplicate source keys fail with `MERGE command cannot affect row a second time`.',
      'Every upsert that updates writes a **new row version** (MVCC), even if nothing changed: dead tuples, WAL, index churn and spurious CDC events. Add `WHERE (target.name, …) IS DISTINCT FROM (EXCLUDED.name, …)` to skip no-op updates. Warehouses differ: Snowflake and BigQuery have no ON CONFLICT and don’t enforce unique constraints, so `MERGE` on a deduplicated source is the only protection.',
    ],
    signals: [
      'load / sync / merge a staging table into a target',
      'the job may be re-run or retried',
      'insert if it doesn’t exist, otherwise update',
      'duplicate events / at-least-once delivery / Kafka consumer',
      'idempotency key / client retries / double charge',
    ],
    template: `INSERT INTO target (key, col1, col2, updated_at)
SELECT DISTINCT ON (key) key, col1, col2, updated_at     -- 1. one row per key
FROM staging
ORDER BY key, updated_at DESC                            --    keep the latest
ON CONFLICT (key) DO UPDATE                              -- 2. arbiter = unique index
SET col1 = EXCLUDED.col1,                                -- 3. overwrite, don't increment
    col2 = EXCLUDED.col2,
    updated_at = EXCLUDED.updated_at
WHERE target.updated_at < EXCLUDED.updated_at;           -- 4. never let old data win`,
    realWorld: [
      {
        title: 'Idempotent ETL / dbt incremental models',
        body: 'A daily load recomputes yesterday (and a few late days) and upserts by natural key — re-running it after a failure produces the same table. dbt’s incremental `merge` / `delete+insert` strategies and Airflow backfills rely on this; jobs that `INSERT` blindly or increment counters double-count on every retry.',
      },
      {
        title: 'Payment API idempotency keys',
        body: 'Stripe-style APIs require an `Idempotency-Key` header. The server inserts (key, request hash, response) under a unique constraint in the same transaction as the charge; a retry with the same key finds the row and returns the stored response instead of charging again. Different payload + same key → 422; concurrent duplicates → one wins, the other waits or gets 409.',
      },
      {
        title: '“Exactly-once” Kafka consumers',
        body: 'Kafka gives at-least-once delivery to a database sink. Effectively-once = idempotent writes: upsert by business key, or record processed `(topic, partition, offset)` / message ids in an inbox table with `ON CONFLICT DO NOTHING` in the **same transaction** as the side effect, and store offsets there too. Kafka transactions alone only cover Kafka-to-Kafka.',
      },
    ],
    mistakes: [
      {
        title: 'Upserting a batch with duplicate keys',
        why: 'The same key twice in one INSERT … ON CONFLICT DO UPDATE (or MERGE) raises “cannot affect row a second time”, failing the whole load.',
        fix: 'Normalize the key (`lower(email)`) and keep one row per key with `DISTINCT ON (key) … ORDER BY key, updated_at DESC` before upserting.',
      },
      {
        title: 'Incrementing in DO UPDATE',
        why: '`SET total = target.total + EXCLUDED.total` doubles the value every time the job is retried.',
        fix: 'Recompute the full value for the affected keys and overwrite (`SET total = EXCLUDED.total`).',
      },
      {
        title: 'Check-then-insert in application code',
        why: '“SELECT … WHERE email = ?; if none, INSERT” races: two requests both see nothing and both insert (or one gets a unique-violation 500).',
        fix: 'Rely on a unique constraint and `INSERT … ON CONFLICT DO NOTHING / DO UPDATE` (with RETURNING); the constraint is the only check that sees uncommitted concurrent inserts.',
      },
      {
        title: 'Letting late data overwrite newer data',
        why: 'Out-of-order CDC events or a lagging feed replay an older version over a newer one.',
        fix: 'Carry a version / updated_at and guard: `DO UPDATE … WHERE target.updated_at < EXCLUDED.updated_at`.',
      },
    ],
    worked: {
      question: 'Before upserting the CDC feed in `staging_users` into `users`, produce exactly one row per (normalized) email — the latest version — and preview whether each becomes an INSERT or an UPDATE.',
      sql: `WITH ranked AS (
  SELECT lower(email) AS email, name, country, updated_at,
         ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY updated_at DESC) AS rn
  FROM staging_users
)
SELECT r.email, r.name, r.country, r.updated_at,
       u.id AS user_id,
       CASE WHEN u.id IS NULL THEN 'insert' ELSE 'update' END AS action
FROM ranked r
LEFT JOIN users u ON u.email = r.email
WHERE r.rn = 1
ORDER BY r.email`,
      notes: {
        cte: 'Normalize first: `Eli@Mail.com` and `eli@mail.com` are the same person, and so are `IVAN@mail.com` and ivan. rn = 1 marks the newest version per email. Kim’s two rows are exact duplicates (a redelivered event) — rn breaks the tie arbitrarily, which is harmless only because they are identical.',
        join: 'The LEFT JOIN is the upsert’s conflict check made visible: a match on the unique key means ON CONFLICT will take the UPDATE path; NULL-extended rows will be inserted.',
        where: 'Without this dedup step the upsert would see eli and kim twice and abort with “ON CONFLICT DO UPDATE command cannot affect row a second time”.',
        select: 'This is the exact source you would feed to `INSERT INTO users … SELECT … ON CONFLICT (email) DO UPDATE` or to `MERGE … USING`.',
      },
      predictions: [
        {
          stage: 'join',
          kind: 'choice',
          question: 'After `LEFT JOIN users`, how many of the 6 staged rows found an existing user (u.id not NULL)?',
          options: ['2', '3', '4', '6'],
          answer: 1,
          explain: 'Both eli versions match user 5 and ivan matches user 9 → 3 rows. Kim’s two rows and Lea are new. Without `lower(email)`, `Eli@Mail.com` and `IVAN@mail.com` would not have matched and would have been inserted as duplicate people.',
        },
        {
          stage: 'where',
          kind: 'rowcount',
          question: 'How many rows survive `rn = 1` — i.e. how many rows will the upsert touch?',
          explain: '4 distinct emails (eli, ivan, kim, lea): eli’s older version and kim’s duplicate are dropped. That is 2 updates + 2 inserts.',
        },
      ],
      takeaway: 'An idempotent load is three steps: normalize the key, keep one (latest) row per key, then let a unique constraint arbitrate INSERT vs UPDATE.',
    },
    build: {
      prompt: 'The feed (staging plus a re-sent, unchanged record for Asha) has been deduplicated into `latest` (given). Build the **change set** to apply: rows that are new or actually differ from `users` (no-op updates only create dead tuples and noisy CDC). Return `email`, `name`, `country`, `user_id`, `action`, by email.',
      given: `feed AS (
  SELECT email, name, country, updated_at FROM staging_users
  UNION ALL
  SELECT 'asha@mail.com', 'Asha', 'IN', timestamp '2024-03-22 09:00'   -- re-sent, unchanged
),
latest AS (
  SELECT DISTINCT ON (lower(email)) lower(email) AS email, name, country, updated_at
  FROM feed
  ORDER BY lower(email), updated_at DESC
)`,
      blocks: [
        { slot: 'select', sql: 'l.email', why: 'The natural key the upsert will arbitrate on.' },
        { slot: 'select', sql: 'l.name', why: 'Proposed value (becomes EXCLUDED.name).' },
        { slot: 'select', sql: 'l.country', why: 'Proposed value (becomes EXCLUDED.country).' },
        { slot: 'select', sql: 'u.id AS user_id', why: 'NULL means no existing row — the insert path.' },
        { slot: 'select', sql: "CASE WHEN u.id IS NULL THEN 'insert' ELSE 'update' END AS action", why: 'Makes the plan reviewable before running it (a dry run).' },
        { slot: 'from', sql: 'latest l', why: 'Always upsert from the deduplicated source: one row per key.' },
        { slot: 'join', sql: 'LEFT JOIN users u ON u.email = l.email', why: 'LEFT keeps new emails (kim, lea) — they are the inserts.' },
        {
          slot: 'where',
          sql: '(u.id IS NULL OR u.name IS DISTINCT FROM l.name OR u.country IS DISTINCT FROM l.country)',
          why: 'New, or something really changed. IS DISTINCT FROM treats NULL as a value, so ivan’s NULL → RS counts as a change; asha’s identical re-send is skipped.',
        },
        { slot: 'orderBy', sql: 'l.email', why: 'Deterministic review order.' },
      ],
      traps: [
        {
          slot: 'join',
          sql: 'JOIN users u ON u.email = l.email',
          replaces: 'LEFT JOIN users u ON u.email = l.email',
          why: 'An inner join keeps only existing users: kim and lea would never be inserted.',
        },
        {
          slot: 'where',
          sql: '(u.id IS NULL OR u.name <> l.name OR u.country <> l.country)',
          replaces: '(u.id IS NULL OR u.name IS DISTINCT FROM l.name OR u.country IS DISTINCT FROM l.country)',
          why: '`NULL <> \'RS\'` is NULL, not TRUE: ivan’s first-ever country is treated as “no change” and silently never loaded.',
        },
        {
          slot: 'from',
          sql: 'staging_users l',
          replaces: 'latest l',
          why: 'The raw feed has mixed-case emails and duplicates: `Eli@Mail.com` would be inserted as a second Eli, and kim appears twice — the real upsert would abort with “cannot affect row a second time”.',
        },
        {
          slot: 'where',
          sql: 'u.id IS NOT NULL',
          why: 'Restricting to existing users turns the upsert into an update-only sync — new customers never arrive.',
        },
      ],
    },
    exercises: [
      {
        id: 'ups-load-users',
        kind: 'write',
        title: 'Idempotent load from staging',
        difficulty: 'Medium',
        setup: `CREATE SEQUENCE user_ids START 11;
ALTER TABLE users ALTER COLUMN id SET DEFAULT nextval('user_ids');`,
        prompt: 'Load `staging_users` into `users` (ids now default from a sequence). Emails must be lower-cased; when an email appears several times keep the version with the latest `updated_at`. New users get `plan` \'free\' and `signup_date` = `updated_at::date`; existing users get their `name` and `country` updated. Use `INSERT … ON CONFLICT` or `MERGE`. Then return `email`, `name`, `country`, `plan` of **all** users ordered by email.',
        solution: `INSERT INTO users (email, name, country, plan, signup_date)
SELECT DISTINCT ON (lower(email))
       lower(email), name, country, 'free', updated_at::date
FROM staging_users
ORDER BY lower(email), updated_at DESC
ON CONFLICT (email) DO UPDATE
SET name = EXCLUDED.name,
    country = EXCLUDED.country;
SELECT email, name, country, plan FROM users ORDER BY email`,
        hints: [
          'Without deduplication you’ll get “ON CONFLICT DO UPDATE command cannot affect row a second time”.',
          '`DISTINCT ON (lower(email)) … ORDER BY lower(email), updated_at DESC` keeps the latest row per email.',
          'The conflict target is the UNIQUE `email` column; refer to the proposed row as `EXCLUDED`.',
        ],
        explanation: 'Eli becomes “Eli R.” in PT, Ivan gets RS, Kim and Lea are inserted with plan free — and running the statement again changes nothing (idempotent). The MERGE equivalent: `MERGE INTO users t USING (<dedup query>) s ON t.email = s.email WHEN MATCHED THEN UPDATE SET name = s.name, country = s.country WHEN NOT MATCHED THEN INSERT (email, name, country, plan, signup_date) VALUES (s.email, s.name, s.country, \'free\', s.updated_at::date)`. Note: with ON CONFLICT the sequence is called for every proposed row, so eli and ivan burn ids 11 and 12 (gaps are normal; never rely on gap-free ids).',
      },
      {
        id: 'ups-idempotency-key',
        kind: 'fix-bug',
        title: 'Client retry double-charges',
        difficulty: 'Medium',
        setup: `CREATE SEQUENCE payment_ids START 15;
ALTER TABLE payments ALTER COLUMN id SET DEFAULT nextval('payment_ids');
ALTER TABLE payments ADD COLUMN idempotency_key text UNIQUE;`,
        prompt: 'The mobile app POSTs a 50 card payment for order 7 (`paid_at` \'2024-03-21 10:00\') with `Idempotency-Key: pay-7-a1`, times out, and retries the identical request. The handler below runs the insert for both calls and records two payments. A migration (setup) added a UNIQUE `idempotency_key` column. Fix the insert so the retry has no effect (keep both calls), then return `order_id`, `amount`, `method`, `idempotency_key` of order 7’s payments.',
        starter: `-- first call
INSERT INTO payments (order_id, paid_at, amount, method)
VALUES (7, '2024-03-21 10:00', 50, 'card');
-- retry of the same request
INSERT INTO payments (order_id, paid_at, amount, method)
VALUES (7, '2024-03-21 10:00', 50, 'card');
SELECT order_id, amount, method, idempotency_key FROM payments WHERE order_id = 7`,
        solution: `-- first call
INSERT INTO payments (order_id, paid_at, amount, method, idempotency_key)
VALUES (7, '2024-03-21 10:00', 50, 'card', 'pay-7-a1')
ON CONFLICT (idempotency_key) DO NOTHING;
-- retry of the same request
INSERT INTO payments (order_id, paid_at, amount, method, idempotency_key)
VALUES (7, '2024-03-21 10:00', 50, 'card', 'pay-7-a1')
ON CONFLICT (idempotency_key) DO NOTHING;
SELECT order_id, amount, method, idempotency_key FROM payments WHERE order_id = 7`,
        hints: ['Store the client’s key with the payment.', 'Let the UNIQUE constraint decide: `ON CONFLICT (idempotency_key) DO NOTHING`.'],
        explanation: 'The first call inserts; the retry hits the unique index and does nothing, so there is exactly one payment. A plain INSERT with the key would make the retry fail with a unique-violation 500 even though the charge succeeded. In a real API, `RETURNING id` returns nothing on the retry, so the handler then SELECTs the stored row/response by key and returns it (same status, same body); store a hash of the request too and reject a different payload with the same key.',
      },
      {
        id: 'ups-daily-revenue',
        kind: 'fix-bug',
        title: 'Retried job doubles the revenue',
        difficulty: 'Hard',
        setup: `CREATE TABLE daily_revenue (
  day date PRIMARY KEY,
  orders int NOT NULL,
  revenue numeric(10,2) NOT NULL
);`,
        prompt: 'A scheduled job aggregates **paid** March orders per day into `daily_revenue` and upserts by day. The scheduler retried it once, and the dashboard now shows double revenue. Fix the upsert so any number of runs gives the same table (keep both runs), then return `day`, `orders`, `revenue` ordered by day.',
        starter: `INSERT INTO daily_revenue (day, orders, revenue)
SELECT ordered_at::date, COUNT(*), SUM(amount)
FROM orders
WHERE status = 'paid' AND ordered_at >= '2024-03-01' AND ordered_at < '2024-04-01'
GROUP BY 1
ON CONFLICT (day) DO UPDATE
SET orders = daily_revenue.orders + EXCLUDED.orders,
    revenue = daily_revenue.revenue + EXCLUDED.revenue;
-- the scheduler retried the job:
INSERT INTO daily_revenue (day, orders, revenue)
SELECT ordered_at::date, COUNT(*), SUM(amount)
FROM orders
WHERE status = 'paid' AND ordered_at >= '2024-03-01' AND ordered_at < '2024-04-01'
GROUP BY 1
ON CONFLICT (day) DO UPDATE
SET orders = daily_revenue.orders + EXCLUDED.orders,
    revenue = daily_revenue.revenue + EXCLUDED.revenue;
SELECT day, orders, revenue FROM daily_revenue ORDER BY day`,
        solution: `INSERT INTO daily_revenue (day, orders, revenue)
SELECT ordered_at::date, COUNT(*), SUM(amount)
FROM orders
WHERE status = 'paid' AND ordered_at >= '2024-03-01' AND ordered_at < '2024-04-01'
GROUP BY 1
ON CONFLICT (day) DO UPDATE
SET orders = EXCLUDED.orders,
    revenue = EXCLUDED.revenue;
-- the scheduler retried the job:
INSERT INTO daily_revenue (day, orders, revenue)
SELECT ordered_at::date, COUNT(*), SUM(amount)
FROM orders
WHERE status = 'paid' AND ordered_at >= '2024-03-01' AND ordered_at < '2024-04-01'
GROUP BY 1
ON CONFLICT (day) DO UPDATE
SET orders = EXCLUDED.orders,
    revenue = EXCLUDED.revenue;
SELECT day, orders, revenue FROM daily_revenue ORDER BY day`,
        hints: ['What does the second run add to what the first run wrote?', 'The job recomputes each day completely — so overwrite instead of adding.'],
        explanation: 'Each run recomputes the full value for each day, so the upsert must **replace** it (`EXCLUDED.revenue`); adding makes every retry double-count. Incremental accumulation is only safe with an exactly-once record of what was already added (e.g. a processed-batch table in the same transaction). Recompute-and-overwrite a window of recent days is also what makes late-arriving orders and backfills safe. (Days without paid orders in the window would need a delete-then-insert of the partition to disappear.)',
      },
    ],
    judgment: [
      {
        id: 'ups-review-signup-race',
        kind: 'peer-review',
        title: 'PR: “prevent duplicate signups (check before insert)”',
        context: 'After support found duplicate accounts, a teammate added a case-insensitive existence check before the INSERT in the signup handler. Two signup requests for Kim (one typed `Kim@Mail.com`) arrived within milliseconds; the replay shows how they interleave.',
        sql: `-- request A and request B both check first (neither has committed yet):
SELECT count(*) FROM users WHERE lower(email) = 'kim@mail.com';   -- A: 0
SELECT count(*) FROM users WHERE lower(email) = 'kim@mail.com';   -- B: 0
-- both see no user, so both insert:
INSERT INTO users (id, name, email, plan, signup_date)
VALUES (11, 'Kim', 'kim@mail.com', 'free', '2024-03-20');
INSERT INTO users (id, name, email, plan, signup_date)
VALUES (12, 'Kim', 'Kim@Mail.com', 'free', '2024-03-20');
SELECT id, name, email FROM users WHERE lower(email) = 'kim@mail.com' ORDER BY id;`,
        bugLines: [2, 3],
        options: [
          {
            text: 'Check-then-insert races: neither check can see the other’s uncommitted insert. Enforce it with a unique index on lower(email) and `ON CONFLICT DO NOTHING`.',
            correct: true,
            why: 'The unique index is the only check that sees concurrent uncommitted inserts (the second inserter waits on the first, then conflicts). ON CONFLICT turns that into a clean no-op instead of a 500.',
          },
          {
            text: 'The check should use `email = …` instead of `lower(email)`.',
            why: 'That makes it worse: `Kim@Mail.com` would pass even a serial check. Case-insensitivity is right; the timing is the bug.',
          },
          {
            text: 'Wrap the check and insert in a transaction.',
            why: 'Under Read Committed both transactions still see no Kim and both insert; a transaction alone doesn’t serialize them.',
          },
          {
            text: 'Use `count(1)` — `count(*)` misses rows with NULLs.',
            why: '`count(*)` counts rows regardless of NULLs; it is equivalent here.',
          },
        ],
        fixedSql: `CREATE UNIQUE INDEX users_email_lower ON users (lower(email));   -- migration
-- request A and request B: the constraint arbitrates
INSERT INTO users (id, name, email, plan, signup_date)
VALUES (11, 'Kim', 'kim@mail.com', 'free', '2024-03-20')
ON CONFLICT (lower(email)) DO NOTHING;
INSERT INTO users (id, name, email, plan, signup_date)
VALUES (12, 'Kim', 'Kim@Mail.com', 'free', '2024-03-20')
ON CONFLICT (lower(email)) DO NOTHING;
SELECT id, name, email FROM users WHERE lower(email) = 'kim@mail.com' ORDER BY id;`,
        lesson: 'Uniqueness belongs to a constraint, not to a SELECT in app code. The conflict target can be an expression index (`lower(email)`), which also defines what “duplicate” means.',
      },
      {
        id: 'ups-spot-stale-overwrite',
        kind: 'spot-bug',
        title: 'Lagging feed reverts a profile edit',
        context: 'Users edit their profile in the app (the setup gives every user `updated_at` = 2024-03-21 12:00). The CDC feed in staging_users lags behind and is upserted nightly. Eli complains his name change was reverted.',
        setup: `ALTER TABLE users ADD COLUMN updated_at timestamp NOT NULL DEFAULT '2024-03-21 12:00';
CREATE SEQUENCE user_ids START 11;
ALTER TABLE users ALTER COLUMN id SET DEFAULT nextval('user_ids');`,
        sql: `INSERT INTO users (email, name, country, plan, signup_date, updated_at)
SELECT DISTINCT ON (lower(email)) lower(email), name, country, 'free', updated_at::date AS signup_date, updated_at
FROM staging_users
ORDER BY lower(email), updated_at DESC
ON CONFLICT (email) DO UPDATE
SET name = EXCLUDED.name,
    country = EXCLUDED.country,
    updated_at = EXCLUDED.updated_at;
SELECT email, name, country, updated_at FROM users
WHERE email IN ('eli@mail.com', 'ivan@mail.com', 'kim@mail.com', 'lea@mail.com')
ORDER BY email;`,
        bugLines: [5],
        options: [
          {
            text: 'DO UPDATE applies unconditionally, so an older feed version (Eli, 03-21 09:00) overwrites a newer edit (12:00). Guard with `WHERE users.updated_at < EXCLUDED.updated_at`.',
            correct: true,
            why: 'With the guard, eli’s stale row is skipped while ivan’s newer row (03-22) still applies, and kim/lea are inserted. Re-runs and out-of-order delivery become harmless.',
          },
          {
            text: 'DISTINCT ON picks the wrong version per email.',
            why: '`ORDER BY lower(email), updated_at DESC` keeps the newest staged version — the problem is comparing it with the target’s version.',
          },
          {
            text: 'It should be DO NOTHING so existing users are never touched.',
            why: 'Then legitimate newer changes (ivan’s country) would never arrive.',
          },
          {
            text: 'The conflict target should be the primary key id.',
            why: 'Staged rows don’t know user ids; email is the natural key that identifies the person.',
          },
        ],
        fixedSql: `INSERT INTO users (email, name, country, plan, signup_date, updated_at)
SELECT DISTINCT ON (lower(email)) lower(email), name, country, 'free', updated_at::date AS signup_date, updated_at
FROM staging_users
ORDER BY lower(email), updated_at DESC
ON CONFLICT (email) DO UPDATE
SET name = EXCLUDED.name,
    country = EXCLUDED.country,
    updated_at = EXCLUDED.updated_at
WHERE users.updated_at < EXCLUDED.updated_at;
SELECT email, name, country, updated_at FROM users
WHERE email IN ('eli@mail.com', 'ivan@mail.com', 'kim@mail.com', 'lea@mail.com')
ORDER BY email;`,
        lesson: 'Idempotent is not enough when sources disagree: compare versions (updated_at, LSN, sequence number) in `DO UPDATE … WHERE` so the newest write wins regardless of arrival order.',
      },
    ],
    recall: [
      { q: 'What does `EXCLUDED` refer to in ON CONFLICT DO UPDATE?', a: 'The row that was proposed for insertion (after BEFORE INSERT triggers); the existing row is referenced by the table name/alias.' },
      { q: 'Why does an upsert fail with “cannot affect row a second time”?', a: 'The input contains the same conflict key more than once in one statement. Dedupe (DISTINCT ON / ROW_NUMBER) on the normalized key first.' },
      { q: 'ON CONFLICT vs MERGE under concurrency?', a: 'ON CONFLICT uses speculative insertion and is race-safe on the arbiter index (no unique violations). MERGE is a join: concurrent inserts of the same new key can still raise a unique violation. MERGE is more expressive (DELETE branch, conditions, NOT MATCHED BY SOURCE).' },
      { q: 'Three rules for an idempotent load?', a: 'One row per key in the source (dedupe), overwrite with recomputed values (don’t increment), and guard against older versions overwriting newer ones (`WHERE target.version < EXCLUDED.version`).' },
    ],
    transfer: [
      {
        id: 'ups-t-webhooks',
        scenario: 'A payment provider sends webhooks at least once, sometimes out of order (`payment.succeeded` after `payment.refunded`). Your handler updates the order status.',
        approach: 'Insert the event id into a `processed_events` table with `ON CONFLICT DO NOTHING` in the same transaction as the update (duplicate → skip). Apply status changes only if the event is newer (`WHERE orders.last_event_at < :event_at`) or follows the allowed state machine.',
      },
      {
        id: 'ups-t-kafka-counts',
        scenario: 'A Kafka consumer maintains per-product view counts in Postgres. After a rebalance, some messages were processed twice and counts are inflated.',
        approach: 'Either store the consumed offsets per partition in the same DB transaction as the count updates (skip messages at or below the stored offset), or recompute counts per time bucket and upsert with overwrite. Blind `count = count + 1` is only safe with transactional dedup.',
      },
      {
        id: 'ups-t-warehouse',
        scenario: 'A Snowflake/BigQuery table must be synced hourly from a raw CDC table containing inserts, updates and deletes with an `op` column.',
        approach: 'Deduplicate to the latest event per key with `QUALIFY ROW_NUMBER() OVER (PARTITION BY key ORDER BY lsn DESC) = 1`, then `MERGE` with `WHEN MATCHED AND op = \'d\' THEN DELETE`, `WHEN MATCHED THEN UPDATE`, `WHEN NOT MATCHED AND op <> \'d\' THEN INSERT`. Warehouses don’t enforce unique keys, so the dedup is mandatory.',
      },
    ],
    confusable: ['dedup-latest', 'mvcc-locking', 'scd2-asof'],
  },
];
