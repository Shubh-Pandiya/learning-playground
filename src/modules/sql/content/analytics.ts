import type { Concept } from '../types';

/**
 * Track: Analytics patterns — the data-engineering interview staples.
 * Every SQL string runs against the seeded dataset (data/dataset.ts) and is checked by
 * scripts/validate.ts. Numbers quoted in predictions / explanations are true on that data.
 */
export const analytics: Concept[] = [
  // ───────────────────────────────────────────────────────────────── gaps & islands
  {
    id: 'gaps-islands',
    track: 'analytics',
    title: 'Gaps & islands (streaks)',
    tagline: 'Consecutive values share a constant “value minus row number” — group by that and every unbroken run (island) collapses into one row.',
    level: 'advanced',
    minutes: 15,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      'An **island** is a maximal run of consecutive values (login days, sequence numbers, minutes a sensor was up); a **gap** is what lies between two islands. “Longest login streak”, “periods a service was down”, “consecutive months a customer paid” are all the same problem.',
      'The trick: number each user’s days 1, 2, 3… with `ROW_NUMBER()`. Inside an unbroken run both the date and the row number go up by exactly 1, so `login_date - rn` is **constant** for the whole run. The moment a day is skipped, the date jumps by 2 while rn still jumps by 1, and the difference changes. That constant (`grp`) is a free island id: `GROUP BY user_id, grp`.',
      'The second family uses **LAG**: flag a row as an island start when it is not exactly “previous + 1” (`is_start = 1`), then a running `SUM(is_start)` gives every row the id of the island it belongs to. It is more verbose but handles any rule (“gap of more than 2 days”, “same status as previous row”) — which is why sessionization is the same pattern with a time threshold.',
      'Duplicates break the row-number trick: two logins on the same day take two row numbers but only one date step, so the difference shifts and the island splits. Deduplicate first (`SELECT DISTINCT`) or use `DENSE_RANK()`, which gives equal dates the same number.',
      'Gaps are the mirror image: for each row, `LEAD(login_date)` is the next day present; if it is more than 1 day later, `[login_date + 1, next - 1]` is a missing range.',
    ],
    internals: [
      'The row-number trick is one **WindowAgg** over a **Sort** on `(user_id, login_date)`, then a **HashAggregate** (or GroupAggregate if the planner keeps the sort) on `(user_id, grp)`. Two passes over the data, O(n log n) for the sort — and only O(1) state per partition in the window node, because ROW_NUMBER never needs to look back. With an index on `(user_id, login_date)` Postgres can feed the WindowAgg from an Index (Only) Scan and skip the sort entirely.',
      'The LAG + running SUM version needs two window passes with the same `PARTITION BY … ORDER BY`. Postgres notices identical window specs and evaluates them in **one** WindowAgg node over one sort; different specs force a re-sort between WindowAgg nodes — something to read for in EXPLAIN on large tables.',
      'The `date - integer` arithmetic is a real date operator (`date - int → date`), so `grp` is a date that means nothing on its own (2024-02-29 for an island starting Mar 1). `ROW_NUMBER()` returns `bigint` and there is no `date - bigint` operator, hence the `::int` cast. For timestamps use `ts - rn * interval \'1 day\'`; for integer sequences plain `id - rn`.',
      'Self-join alternatives (“is there a row for day − 1?”) are O(n²)-ish without an index and painful to extend; window functions are the expected interview answer. On warehouses (Snowflake/BigQuery) the same query distributes by the PARTITION BY key, so one user with millions of rows becomes a skewed, single-worker partition.',
    ],
    signals: ['consecutive days / months / numbers', 'longest streak', 'unbroken run of the same status', 'find the missing ids / dates (gaps)', 'periods when a sensor was down'],
    template: `WITH days AS (                        -- 1. one row per user-day (duplicates break the trick)
  SELECT DISTINCT user_id, login_date FROM logins
), tagged AS (                         -- 2. constant inside a run of consecutive days
  SELECT user_id, login_date,
         login_date - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY login_date))::int AS grp
  FROM days
)
SELECT user_id, MIN(login_date) AS streak_start, MAX(login_date) AS streak_end, COUNT(*) AS days
FROM tagged
GROUP BY user_id, grp;                 -- 3. one row per island`,
    realWorld: [
      {
        title: 'Engagement streaks and badges',
        body: 'Duolingo-style “7-day streak” features, “paid 6 consecutive months” loyalty rules and churn models that use “current streak length” as a feature are all islands queries, usually run nightly over a `user_activity_daily` table at one row per user-day.',
      },
      {
        title: 'SLA / uptime reporting',
        body: 'Health checks every minute → islands of `status = \'down\'` give incident start, end and duration; gaps in the check sequence itself reveal when the monitor was not running (no data is not the same as up). The LAG + SUM form handles “same status as previous row” islands.',
      },
      {
        title: 'Data-quality checks in pipelines',
        body: 'A daily-partitioned fact table should have one partition per day; a gaps query over `SELECT DISTINCT load_date` flags missing loads, and over an auto-increment / Kafka offset column flags lost or skipped records before they reach a dashboard.',
      },
    ],
    mistakes: [
      {
        title: 'Not deduplicating before ROW_NUMBER',
        why: 'User 2 logged in twice on Mar 4: the duplicate consumes a row number without advancing the date, so `login_date - rn` shifts and the 3-day streak splits (and can even merge with an older island).',
        fix: '`SELECT DISTINCT user_id, login_date` first, or use `DENSE_RANK()`, which gives equal dates the same number.',
      },
      {
        title: 'Forgetting PARTITION BY',
        why: 'A global ROW_NUMBER / LAG interleaves users: the “previous login” of Ben is Asha’s login on the same day, so islands mix users and streaks become absurdly long.',
        fix: 'Partition every window by the entity whose runs you measure (`PARTITION BY user_id`).',
      },
      {
        title: 'Filtering short islands with WHERE',
        why: '`WHERE days >= 2` fails — `days` is an aggregate computed after WHERE. Filtering the raw rows instead (e.g. by date) cuts islands in half at the boundary.',
        fix: 'Filter islands with HAVING (or in an outer query); restrict the date range only when you accept truncated islands at the edges.',
      },
      {
        title: 'Using ROW_NUMBER on timestamps without truncating',
        why: 'Several logins per day at different times are distinct values, so DISTINCT does not dedupe them and every extra login breaks the arithmetic.',
        fix: 'Reduce to the grain of the run first: `DISTINCT user_id, ts::date` (or `date_trunc(\'month\', ts)` for monthly streaks).',
      },
    ],
    worked: {
      question: 'Product wants every login streak of at least 2 consecutive days in March, per user, to design a streak badge.',
      sql: `WITH login_days AS (
  SELECT DISTINCT user_id, login_date
  FROM logins
),
tagged AS (
  SELECT user_id,
         login_date,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY login_date) AS rn,
         login_date - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY login_date))::int AS grp
  FROM login_days
)
SELECT user_id,
       grp,
       MIN(login_date) AS streak_start,
       MAX(login_date) AS streak_end,
       COUNT(*) AS days
FROM tagged
GROUP BY user_id, grp
HAVING COUNT(*) >= 2
ORDER BY user_id, streak_start`,
      notes: {
        cte: '`login_days` removes user 2’s duplicate Mar 4 login. In `tagged`, look at user 1: Mar 1–3 have rn 1–3 → grp Feb 29; Mar 5–8 have rn 4–7 → grp Mar 1. The date jumped by 2 (Mar 3 → Mar 5) while rn jumped by 1, so grp moved: a new island.',
        group: 'Each (user_id, grp) bucket is exactly one island. grp values collide across users (Feb 29 appears for users 1, 2 and 4) — that is why user_id must be part of the key.',
        having: 'HAVING works on whole islands, after they exist. A WHERE on login_date here would have cut islands instead of filtering them.',
      },
      predictions: [
        {
          stage: 'cte',
          kind: 'rowcount',
          question: '`logins` has 27 rows and user 2 logged in twice on Mar 4. How many rows does `login_days` have?',
          explain: 'DISTINCT collapses the one duplicate (2, Mar 4): 27 → 26 user-days. Without this step user 2’s Mar 3–5 streak would split.',
        },
        {
          stage: 'group',
          kind: 'rowcount',
          question: 'How many islands (streaks, including 1-day ones) exist across all 4 users?',
          explain: 'User 1: Mar 1–3, 5–8, 12 (3). User 2: Mar 1, 3–5, 10–11 (3). User 3: Mar 2, 9–14 (2). User 4: Mar 1–2, 8, 15–16 (3). Total 11.',
        },
        {
          stage: 'having',
          kind: 'choice',
          question: 'Which user has the longest streak, and how long is it?',
          options: ['User 1, 4 days', 'User 3, 6 days', 'User 2, 4 days (Mar 3, 4, 4, 5)', 'User 4, 2 days'],
          answer: 1,
          explain: 'User 3 logged in every day Mar 9–14: 6 days. User 2’s Mar 3–5 streak is 3 days — the duplicate Mar 4 is one day, not two.',
        },
      ],
      takeaway: 'Reduce to one row per (entity, step), compute `value − ROW_NUMBER()` per entity, and every island is one `GROUP BY entity, grp` bucket.',
    },
    build: {
      prompt: 'List **every** login streak (1-day streaks included): `user_id`, `streak_start`, `streak_end`, `days` (distinct days). Do it straight from `logins` — it contains a duplicate — ordered by user_id, streak_start.',
      ctes: ['tagged'],
      blocks: [
        { scope: 'tagged', slot: 'select', sql: 'user_id', why: 'The entity whose streaks we measure.' },
        { scope: 'tagged', slot: 'select', sql: 'login_date', why: 'Kept so the outer query can take MIN/MAX per island.' },
        {
          scope: 'tagged',
          slot: 'select',
          sql: 'login_date - (DENSE_RANK() OVER (PARTITION BY user_id ORDER BY login_date))::int AS grp',
          why: 'DENSE_RANK gives both Mar 4 logins the same number, so the duplicate does not shift grp. The ::int cast is needed because there is no date − bigint operator.',
        },
        { scope: 'tagged', slot: 'from', sql: 'logins', why: 'Raw logins, duplicates and all.' },
        { slot: 'select', sql: 'user_id', why: 'Island owner.' },
        { slot: 'select', sql: 'MIN(login_date) AS streak_start', why: 'First day of the island.' },
        { slot: 'select', sql: 'MAX(login_date) AS streak_end', why: 'Last day of the island.' },
        { slot: 'select', sql: 'COUNT(DISTINCT login_date) AS days', why: 'Distinct days — the duplicate login still sits in the island as two rows.' },
        { slot: 'from', sql: 'tagged', why: 'Read the tagged rows.' },
        { slot: 'groupBy', sql: 'user_id', why: 'grp values collide across users, so the user is part of the island key…' },
        { slot: 'groupBy', sql: 'grp', why: '…and grp identifies the run within the user.' },
        { slot: 'orderBy', sql: 'user_id', why: 'Stable output order.' },
        { slot: 'orderBy', sql: 'streak_start', why: 'Chronological within each user.' },
      ],
      traps: [
        {
          scope: 'tagged',
          slot: 'select',
          sql: 'login_date - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY login_date))::int AS grp',
          replaces: 'login_date - (DENSE_RANK() OVER (PARTITION BY user_id ORDER BY login_date))::int AS grp',
          why: 'ROW_NUMBER gives the two Mar 4 logins different numbers: grp shifts mid-streak and user 2’s Mar 3–5 streak is split (and partly merged with Mar 1).',
        },
        {
          scope: 'tagged',
          slot: 'select',
          sql: 'login_date - (DENSE_RANK() OVER (ORDER BY login_date))::int AS grp',
          replaces: 'login_date - (DENSE_RANK() OVER (PARTITION BY user_id ORDER BY login_date))::int AS grp',
          why: 'Without PARTITION BY the numbering is global over all users’ dates, so a user’s rank jumps whenever other users log in on days they don’t — islands break apart.',
        },
        {
          scope: 'tagged',
          slot: 'select',
          sql: 'login_date - (DENSE_RANK() OVER (PARTITION BY user_id))::int AS grp',
          replaces: 'login_date - (DENSE_RANK() OVER (PARTITION BY user_id ORDER BY login_date))::int AS grp',
          why: 'Without ORDER BY every row is a peer of every other: all ranks are 1, grp = date − 1 is different for every day, and each day becomes its own 1-day island.',
        },
        {
          slot: 'select',
          sql: 'COUNT(*) AS days',
          replaces: 'COUNT(DISTINCT login_date) AS days',
          why: 'COUNT(*) counts rows: user 2’s Mar 3–5 streak would claim 4 days because Mar 4 appears twice.',
        },
        {
          slot: 'having',
          sql: 'COUNT(DISTINCT login_date) >= 2',
          why: 'The task asks for every streak; a single login day is an island of length 1. Dropping them hides users who never had a streak.',
        },
      ],
    },
    exercises: [
      {
        id: 'gi-longest-streak',
        kind: 'write',
        title: 'Longest streak per user',
        difficulty: 'Medium',
        prompt: 'Return each user’s longest run of consecutive login days: `user_id`, `longest_streak` (number of days). Remember `logins` contains a duplicate. Order by user_id.',
        solution: `WITH login_days AS (
  SELECT DISTINCT user_id, login_date
  FROM logins
),
islands AS (
  SELECT user_id,
         login_date - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY login_date))::int AS grp
  FROM login_days
),
streaks AS (
  SELECT user_id, grp, COUNT(*) AS days
  FROM islands
  GROUP BY user_id, grp
)
SELECT user_id, MAX(days) AS longest_streak
FROM streaks
GROUP BY user_id
ORDER BY user_id`,
        hints: ['First collapse to one row per user-day.', 'Islands → one row per (user, grp) with its length → then MAX per user: two levels of GROUP BY.'],
        explanation: 'Aggregating twice is the shape: islands are groups of rows, and the longest island is a group of islands. Interview follow-up “and its dates?” → replace the outer MAX with `DISTINCT ON (user_id) … ORDER BY user_id, days DESC, streak_start` (and decide how to break ties between equally long streaks).',
      },
      {
        id: 'gi-dup-fix',
        kind: 'fix-bug',
        title: 'The streak that skipped a day',
        difficulty: 'Medium',
        prompt: 'This query should list every streak (`user_id`, `streak_start`, `streak_end`, `days`) ordered by user_id, streak_start. Support noticed user 2 has a “streak” from Mar 1 to Mar 5 although they did not log in on Mar 2. Fix it.',
        starter: `WITH tagged AS (
  SELECT user_id,
         login_date,
         login_date - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY login_date))::int AS grp
  FROM logins
)
SELECT user_id,
       MIN(login_date) AS streak_start,
       MAX(login_date) AS streak_end,
       COUNT(*) AS days
FROM tagged
GROUP BY user_id, grp
ORDER BY user_id, streak_start`,
        solution: `WITH login_days AS (
  SELECT DISTINCT user_id, login_date
  FROM logins
),
tagged AS (
  SELECT user_id,
         login_date,
         login_date - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY login_date))::int AS grp
  FROM login_days
)
SELECT user_id,
       MIN(login_date) AS streak_start,
       MAX(login_date) AS streak_end,
       COUNT(*) AS days
FROM tagged
GROUP BY user_id, grp
ORDER BY user_id, streak_start`,
        hints: ['Run the CTE alone for user 2 and look at the grp column around Mar 4.', 'Two rows with the same date get two different row numbers.'],
        explanation: 'The duplicate Mar 4 row takes rn 4 while the date stays Mar 4, so its grp (Feb 29) equals the grp of Mar 1 (also Feb 29): the island Mar 3–5 is torn apart and half of it is glued to Mar 1. Deduplicating to the user-day grain (or `DENSE_RANK`) restores “date and number both step by 1”.',
      },
      {
        id: 'gi-missing-ranges',
        kind: 'write',
        title: 'Missing login ranges (gaps)',
        difficulty: 'Hard',
        prompt: 'For each user, list the gaps **between** their first and last login: `user_id`, `gap_start` (first missing day), `gap_end` (last missing day), `missing_days`. Order by user_id, gap_start.',
        solution: `WITH login_days AS (
  SELECT DISTINCT user_id, login_date
  FROM logins
),
nexts AS (
  SELECT user_id,
         login_date,
         LEAD(login_date) OVER (PARTITION BY user_id ORDER BY login_date) AS next_login
  FROM login_days
)
SELECT user_id,
       login_date + 1 AS gap_start,
       next_login - 1 AS gap_end,
       next_login - login_date - 1 AS missing_days
FROM nexts
WHERE next_login - login_date > 1
ORDER BY user_id, gap_start`,
        hints: ['A gap starts the day after a login whose next login is more than 1 day later.', '`LEAD(login_date)` gives the next login; `date - date` is an integer number of days.'],
        explanation: 'Each gap sits between two consecutive present rows, so LEAD pairs each login with the next one and the difference tells you how much is missing. The last login has `next_login` NULL, so the comparison is NULL and WHERE drops it — no special case. For gaps against a calendar (including before the first / after the last login), anti-join a `generate_series` of dates instead.',
      },
    ],
    judgment: [
      {
        id: 'gi-judge-lag-partition',
        kind: 'spot-bug',
        title: 'Streak badge awards everyone a 5+ day streak',
        context: 'The new “longest streak” feature uses the LAG + running SUM method. QA reports that every test user has a streak longer than they could possibly have. Find the line.',
        sql: `WITH flagged AS (
  SELECT user_id,
         login_date,
         CASE WHEN login_date - LAG(login_date) OVER (ORDER BY login_date) <= 1
              THEN 0 ELSE 1 END AS is_start
  FROM logins
),
islands AS (
  SELECT user_id,
         login_date,
         SUM(is_start) OVER (PARTITION BY user_id ORDER BY login_date) AS island_id
  FROM flagged
)
SELECT user_id,
       MAX(days) AS longest_streak
FROM (SELECT user_id, island_id, COUNT(DISTINCT login_date) AS days
      FROM islands GROUP BY user_id, island_id) s
GROUP BY user_id
ORDER BY user_id`,
        bugLines: [4],
        options: [
          {
            text: 'LAG has no PARTITION BY user_id: the “previous login” is usually another user’s login on the same or previous day, so almost nothing is flagged as an island start.',
            correct: true,
            why: 'Ordered globally by date, consecutive rows are mostly other users with gap 0 or 1. The buggy query reports 8 days for user 1, 6 for user 2, 7 for user 3 and 5 for user 4 — the real answers are 4, 3, 6 and 2.',
          },
          { text: '`<= 1` should be `= 1`; duplicates (gap 0) must start a new island.', why: 'A duplicate login on the same day continues the island; `<= 1` is the right rule for a deduplicating LAG.' },
          { text: 'The running SUM needs `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`.', why: 'With RANGE (the default) duplicate dates share one sum, which is exactly what you want here.' },
          { text: 'COUNT(DISTINCT login_date) should be COUNT(*).', why: 'COUNT(*) would count the duplicate Mar 4 login twice; DISTINCT is correct.' },
        ],
        fixedSql: `WITH flagged AS (
  SELECT user_id,
         login_date,
         CASE WHEN login_date - LAG(login_date) OVER (PARTITION BY user_id ORDER BY login_date) <= 1
              THEN 0 ELSE 1 END AS is_start
  FROM logins
),
islands AS (
  SELECT user_id,
         login_date,
         SUM(is_start) OVER (PARTITION BY user_id ORDER BY login_date) AS island_id
  FROM flagged
)
SELECT user_id,
       MAX(days) AS longest_streak
FROM (SELECT user_id, island_id, COUNT(DISTINCT login_date) AS days
      FROM islands GROUP BY user_id, island_id) s
GROUP BY user_id
ORDER BY user_id`,
        lesson: 'Every window in an islands query must be partitioned by the entity. The bug hides in the first CTE while the second one is partitioned correctly — review each OVER clause separately.',
      },
    ],
    recall: [
      { q: 'Why is `login_date - ROW_NUMBER()` constant inside a streak?', a: 'Inside an unbroken run both the date and the row number increase by exactly 1 per row, so their difference does not change; a skipped day changes it.' },
      { q: 'How do duplicates break the row-number trick, and two fixes?', a: 'A duplicate takes a row number without advancing the date, shifting grp. Fix: SELECT DISTINCT to the run grain first, or DENSE_RANK.' },
      { q: 'The LAG-based islands recipe in three steps?', a: '1) flag is_start when the value is not “previous + 1” (or status changed); 2) running SUM(is_start) per entity = island id; 3) GROUP BY entity, island id.' },
      { q: 'How do you find missing ranges (gaps)?', a: 'LEAD(value) per entity; where next − value > 1 the gap is [value + 1, next − 1]. For gaps against a full calendar, anti-join generate_series.' },
    ],
    transfer: [
      {
        id: 'gi-t-subscriptions',
        scenario: 'Billing has one row per customer per paid month. Marketing wants customers who paid for at least 6 consecutive months, with the start of that run.',
        approach: 'Months instead of days: grp = month_start − ROW_NUMBER() * interval \'1 month\' (or month index = year*12+month minus rn). GROUP BY customer, grp HAVING COUNT(*) >= 6, MIN(month) as the start.',
      },
      {
        id: 'gi-t-status',
        scenario: 'A machine reports its status every minute (‘up’, ‘degraded’, ‘down’). Ops wants every contiguous period of the same status with start, end and duration.',
        approach: 'Status islands, not number islands: is_start = status IS DISTINCT FROM LAG(status) per machine ordered by time; running SUM = period id; GROUP BY machine, period_id with MIN/MAX(ts) and status.',
      },
      {
        id: 'gi-t-invoices',
        scenario: 'Auditors want to know which invoice numbers are missing from the sequence 1000–1999.',
        approach: 'Gaps: LEAD(invoice_no) ORDER BY invoice_no, report [no + 1, next − 1] where next − no > 1; or anti-join generate_series(1000, 1999) to list every missing number.',
      },
    ],
    confusable: ['sessionization', 'lag-lead', 'recursive-graph-dates', 'running-totals-frames'],
  },
  // ───────────────────────────────────────────────────────────────── sessionization
  {
    id: 'sessionization',
    track: 'analytics',
    title: 'Sessionization (inactivity gaps)',
    tagline: 'A session ends when a user is idle longer than a threshold: LAG the timestamp, flag big gaps as new sessions, and a running SUM of the flags numbers the sessions.',
    level: 'advanced',
    minutes: 15,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      'Raw clickstream has no session id — a “session” is a modelling decision: **a burst of activity separated from the next burst by more than N minutes of silence** (30 minutes is the Google Analytics convention). Everything downstream — session counts, duration, conversion per session, attribution — depends on it.',
      'It is the gaps-and-islands LAG pattern with a time threshold. Step 1: for every event, `gap = event_time − LAG(event_time)` within the user. Step 2: `is_new_session = 1` when there is no previous event or the gap exceeds 30 minutes. Step 3: `SUM(is_new_session) OVER (PARTITION BY user_id ORDER BY event_time)` — a running count of “session starts so far” — **is** the session number.',
      'Once each event carries `(user_id, session_no)`, sessions are just a GROUP BY: `MIN/MAX(event_time)` for start/end, `COUNT(*)` events, `bool_or(event_type = \'purchase\')` for converting sessions.',
      'Why not `date_trunc(\'hour\', …)`? That is a **tumbling window**: fixed boundaries that ignore behaviour. It splits a session crossing 10:59 → 11:01 and merges two visits 50 minutes apart inside one hour. Session windows are data-driven: their boundaries are wherever the user went quiet.',
    ],
    internals: [
      'In Postgres the LAG and the running SUM are **WindowAgg** nodes over a **Sort** on `(user_id, event_time)` (or an index scan on that pair). Because the second window has the same PARTITION BY / ORDER BY, it reuses the sort order; the final GROUP BY on `(user_id, session_no)` can then be a streaming GroupAggregate. Cost is dominated by the sort: on 1B events that is an external merge sort spilling to disk once `work_mem` is exceeded — partition the job by day/user hash.',
      'Batch pipelines usually sessionize **incrementally**: process yesterday’s events, but read the last 30 minutes of the day before as well (and carry the open session id forward), otherwise every session crossing midnight is split at the partition boundary. The output is a `sessions` table keyed by `(user_id, session_start)`, plus a `session_id` stamped onto events.',
      'In streaming (Flink, Kafka Streams, Spark `session_window`) a session window is per-key state: each event opens a window `[t, t + gap)`, overlapping windows **merge**, and the window is emitted when the **watermark** passes its end. A late event can bridge two already-separate windows and merge them, so engines keep state for an allowed-lateness / grace period and may emit updated (retracted) results. That is why streaming session counts can change after the fact while the batch recomputation is the source of truth.',
      'Sessions are not idempotent to change: altering the threshold (30 → 20 minutes) renumbers every session after the first changed boundary. Store the threshold with the dataset (or in the model name) and backfill when it changes.',
    ],
    signals: ['session / visit without a session id', 'split activity when idle for more than N minutes', 'events per session, session duration', 'sessions crossing an hour or midnight', 'session window (streaming)'],
    template: `WITH flagged AS (
  SELECT user_id, event_time,
         CASE WHEN event_time - LAG(event_time) OVER (PARTITION BY user_id ORDER BY event_time)
                   <= interval '30 minutes'
              THEN 0 ELSE 1 END AS is_new          -- first event: LAG is NULL → ELSE → 1
  FROM events
), numbered AS (
  SELECT *, SUM(is_new) OVER (PARTITION BY user_id ORDER BY event_time) AS session_no
  FROM flagged
)
SELECT user_id, session_no, MIN(event_time) AS started, MAX(event_time) AS ended, COUNT(*) AS events
FROM numbered
GROUP BY user_id, session_no;`,
    realWorld: [
      {
        title: 'Web/app analytics models',
        body: 'dbt projects for product analytics (e.g. Snowplow’s web model) build `page_views → sessions → users` exactly like this, incrementally, with a lookback so cross-midnight sessions are not split. Session-level conversion and bounce rate come from the sessions table, not from raw events.',
      },
      {
        title: 'Streaming: Flink / Kafka Streams session windows',
        body: '`SESSION(event_time, INTERVAL \'30\' MINUTE)` in Flink SQL or `SessionWindows.ofInactivityGapWithNoGrace(…)` in Kafka Streams keep per-user state and merge windows as events arrive; results are final only after the watermark (+ grace). Real-time dashboards use them; the nightly batch job reconciles.',
      },
      {
        title: 'Billing and security',
        body: 'Usage-based billing groups API calls into “active periods”; fraud/security tools sessionize logins per IP or device to spot impossible travel or credential stuffing bursts. Same LAG → flag → running SUM, different key and threshold.',
      },
    ],
    mistakes: [
      {
        title: 'Using EXTRACT(MINUTE FROM gap)',
        why: '`EXTRACT(MINUTE FROM interval)` returns the minutes **field** (0–59), not the total: a gap of 23h30m gives 30 and is treated as “30 minutes”.',
        fix: 'Compare intervals directly (`gap > interval \'30 minutes\'`) or use `EXTRACT(EPOCH FROM gap) / 60` for total minutes.',
      },
      {
        title: 'Fixed hourly/daily buckets instead of gaps',
        why: '`date_trunc(\'hour\', event_time)` cuts sessions at clock boundaries and merges separate visits within one hour.',
        fix: 'Derive boundaries from inactivity gaps (LAG), or use a session window in streaming engines.',
      },
      {
        title: 'Forgetting the first event of each user',
        why: 'LAG is NULL for the first event; `gap > 30 min` is NULL → ELSE 0, so numbering starts at 0 and “first session” filters (`session_no = 1`) pick the wrong one.',
        fix: 'Write the condition so NULL falls into “new session”: `CASE WHEN gap <= interval \'30 minutes\' THEN 0 ELSE 1 END`, or test `gap IS NULL` explicitly.',
      },
      {
        title: 'Window without PARTITION BY user',
        why: 'The previous event becomes another user’s event, so gaps are meaningless and sessions mix users.',
        fix: '`PARTITION BY user_id` (or device/anonymous id) in both LAG and the running SUM.',
      },
    ],
    worked: {
      question: 'Growth wants to see how users 2 and 5 are split into sessions using a 30-minute inactivity rule, before the logic goes into the nightly model.',
      sql: `WITH gaps AS (
  SELECT user_id,
         event_time,
         event_type,
         event_time - LAG(event_time) OVER (PARTITION BY user_id ORDER BY event_time) AS gap
  FROM events
),
flagged AS (
  SELECT user_id,
         event_time,
         event_type,
         gap,
         CASE WHEN gap IS NULL OR gap > interval '30 minutes' THEN 1 ELSE 0 END AS is_new_session
  FROM gaps
)
SELECT user_id,
       event_time,
       event_type,
       gap,
       is_new_session,
       SUM(is_new_session) OVER (PARTITION BY user_id ORDER BY event_time) AS session_no
FROM flagged
WHERE user_id IN (2, 5)
ORDER BY user_id, event_time`,
      notes: {
        cte: '`gaps` puts the time since the previous event on every row (NULL for each user’s first event). `flagged` turns that into a 0/1 “starts a new session” flag. Nothing is grouped yet — every event is still a row.',
        where: 'Filtering on user_id is safe after LAG because it is the PARTITION BY column: whole partitions are kept or dropped. Filtering on event_time here would be different — the rows would still carry gaps computed against events you no longer see.',
        window: 'The running SUM counts session starts so far. Hover user 5’s 21:30 row: the frame covers 20:00 → 21:30, which contains two 1-flags, so session_no = 2.',
      },
      predictions: [
        {
          stage: 'where',
          kind: 'rowcount',
          question: 'Users 2 and 5 have how many events between them?',
          explain: 'User 2 has 7 events (5 on Mar 1, 2 on Mar 2) and user 5 has 8 → 15 rows. The other 21 events are dropped, but their gaps were already computed per user, so nothing leaks.',
        },
        {
          stage: 'window',
          kind: 'choice',
          question: 'User 5 browsed at 20:00, 20:10, 20:25, 20:50, 21:30 on Mar 1 and 21:00–21:10 on Mar 2. Which session_no does the 21:30 event get?',
          options: ['1 — it is the same evening', '2 — the 40-minute gap starts a new session', '3', '0'],
          answer: 1,
          explain: '20:50 → 21:30 is 40 minutes > 30, so 21:30 starts session 2 on its own; the Mar 2 visit is session 3. Note 20:25 → 20:50 (25 min) did not split.',
        },
      ],
      takeaway: 'LAG gives the gap, a CASE turns gaps into “new session” flags, and a running SUM of flags is the session id — then sessions are a plain GROUP BY.',
    },
    build: {
      prompt: 'Build the sessions table: one row per session with `user_id`, `session_no` (starting at 1 per user), `session_start`, `session_end`, `events`. A new session starts after more than 30 minutes of inactivity. Order by user_id, session_no.',
      ctes: ['flagged', 'numbered'],
      blocks: [
        { scope: 'flagged', slot: 'select', sql: 'user_id', why: 'Sessions are per user.' },
        { scope: 'flagged', slot: 'select', sql: 'event_time', why: 'Needed for ordering and for start/end.' },
        {
          scope: 'flagged',
          slot: 'select',
          sql: "CASE WHEN event_time - LAG(event_time) OVER (PARTITION BY user_id ORDER BY event_time) <= interval '30 minutes' THEN 0 ELSE 1 END AS is_new",
          why: 'Gap within 30 minutes → same session (0). A bigger gap **and** the first event (LAG is NULL → comparison NULL → ELSE) start a session (1).',
        },
        { scope: 'flagged', slot: 'from', sql: 'events', why: 'Raw clickstream.' },
        { scope: 'numbered', slot: 'select', sql: 'user_id', why: 'Carry the key.' },
        { scope: 'numbered', slot: 'select', sql: 'event_time', why: 'Carry the timestamp.' },
        {
          scope: 'numbered',
          slot: 'select',
          sql: 'SUM(is_new) OVER (PARTITION BY user_id ORDER BY event_time) AS session_no',
          why: 'Running count of session starts = which session this event belongs to.',
        },
        { scope: 'numbered', slot: 'from', sql: 'flagged', why: 'Window functions can’t be nested, so the running SUM reads the flags from the previous step.' },
        { slot: 'select', sql: 'user_id', why: 'Session owner.' },
        { slot: 'select', sql: 'session_no', why: 'Session number within the user.' },
        { slot: 'select', sql: 'MIN(event_time) AS session_start', why: 'First event of the session.' },
        { slot: 'select', sql: 'MAX(event_time) AS session_end', why: 'Last event of the session.' },
        { slot: 'select', sql: 'COUNT(*) AS events', why: 'Events in the session.' },
        { slot: 'from', sql: 'numbered', why: 'Events stamped with their session.' },
        { slot: 'groupBy', sql: 'user_id', why: 'session_no restarts per user, so the user is part of the session key…' },
        { slot: 'groupBy', sql: 'session_no', why: '…plus the number within the user.' },
        { slot: 'orderBy', sql: 'user_id', why: 'Stable order.' },
        { slot: 'orderBy', sql: 'session_no', why: 'Chronological sessions.' },
      ],
      traps: [
        {
          scope: 'flagged',
          slot: 'select',
          sql: "CASE WHEN event_time - LAG(event_time) OVER (PARTITION BY user_id ORDER BY event_time) > interval '30 minutes' THEN 1 ELSE 0 END AS is_new",
          replaces: "CASE WHEN event_time - LAG(event_time) OVER (PARTITION BY user_id ORDER BY event_time) <= interval '30 minutes' THEN 0 ELSE 1 END AS is_new",
          why: 'Looks equivalent, but for the first event the comparison is NULL → ELSE 0: the first session is numbered 0, and every “first session” metric is now off by one.',
        },
        {
          scope: 'flagged',
          slot: 'select',
          sql: "CASE WHEN event_time - LAG(event_time) OVER (ORDER BY event_time) <= interval '30 minutes' THEN 0 ELSE 1 END AS is_new",
          replaces: "CASE WHEN event_time - LAG(event_time) OVER (PARTITION BY user_id ORDER BY event_time) <= interval '30 minutes' THEN 0 ELSE 1 END AS is_new",
          why: 'Without PARTITION BY the previous event may belong to another user: gaps are measured between different people and sessions merge/split arbitrarily.',
        },
        {
          scope: 'numbered',
          slot: 'select',
          sql: 'COUNT(*) OVER (PARTITION BY user_id ORDER BY event_time) AS session_no',
          replaces: 'SUM(is_new) OVER (PARTITION BY user_id ORDER BY event_time) AS session_no',
          why: 'COUNT(*) numbers events, not session starts: every event becomes its own “session”.',
        },
        {
          scope: 'numbered',
          slot: 'select',
          sql: 'SUM(is_new) OVER (PARTITION BY user_id) AS session_no',
          replaces: 'SUM(is_new) OVER (PARTITION BY user_id ORDER BY event_time) AS session_no',
          why: 'Without ORDER BY the frame is the whole partition: every event gets the user’s total session count, so all of a user’s events collapse into one row.',
        },
      ],
    },
    exercises: [
      {
        id: 'ss-sessions-per-user',
        kind: 'write',
        title: 'Sessions per user',
        difficulty: 'Medium',
        prompt: 'Using a 30-minute inactivity threshold, return `user_id` and `sessions` (number of sessions) for every user in `events`, ordered by user_id.',
        solution: `WITH flagged AS (
  SELECT user_id,
         CASE WHEN event_time - LAG(event_time) OVER (PARTITION BY user_id ORDER BY event_time)
                   <= interval '30 minutes'
              THEN 0 ELSE 1 END AS is_new
  FROM events
)
SELECT user_id, SUM(is_new) AS sessions
FROM flagged
GROUP BY user_id
ORDER BY user_id`,
        hints: ['You don’t need a session id to count sessions — only the number of session starts.', 'Flag session starts with LAG, then SUM the flags per user.'],
        explanation: 'Counting sessions only needs the starts: SUM(is_new) per user (2, 3, 3, 2, 3). The running SUM is only necessary when you must assign each event to a session (durations, per-session metrics).',
      },
      {
        id: 'ss-extract-minute',
        kind: 'fix-bug',
        title: 'User 5 lost a session',
        difficulty: 'Medium',
        prompt: 'This query should return `user_id`, `sessions` per user (30-minute inactivity rule), ordered by user_id. User 5 visited on Mar 1 evening and again on Mar 2 at 21:00, yet the query merges two of their sessions. Fix it.',
        starter: `WITH flagged AS (
  SELECT user_id,
         CASE WHEN LAG(event_time) OVER (PARTITION BY user_id ORDER BY event_time) IS NULL
                OR EXTRACT(MINUTE FROM event_time - LAG(event_time) OVER (PARTITION BY user_id ORDER BY event_time)) > 30
              THEN 1 ELSE 0 END AS is_new
  FROM events
)
SELECT user_id, SUM(is_new) AS sessions
FROM flagged
GROUP BY user_id
ORDER BY user_id`,
        solution: `WITH flagged AS (
  SELECT user_id,
         CASE WHEN LAG(event_time) OVER (PARTITION BY user_id ORDER BY event_time) IS NULL
                OR event_time - LAG(event_time) OVER (PARTITION BY user_id ORDER BY event_time) > interval '30 minutes'
              THEN 1 ELSE 0 END AS is_new
  FROM events
)
SELECT user_id, SUM(is_new) AS sessions
FROM flagged
GROUP BY user_id
ORDER BY user_id`,
        hints: ['What is the gap between user 5’s Mar 1 21:30 event and their Mar 2 21:00 event?', 'What does EXTRACT(MINUTE FROM interval \'23:30:00\') return?'],
        explanation: 'The gap is 23 h 30 min. `EXTRACT(MINUTE …)` reads only the minutes field → 30, which is not > 30, so the next-day visit was glued to the previous one. Comparing intervals (`> interval \'30 minutes\'`) or total minutes (`EXTRACT(EPOCH FROM gap) / 60`) fixes it. The other users only look right by luck (their long gaps happen to have minute fields above 30).',
      },
      {
        id: 'ss-session-conversion',
        kind: 'write',
        title: 'Session conversion rate',
        difficulty: 'Hard',
        prompt: 'Sessionize with the 30-minute rule and return one row: `sessions` (total), `converting_sessions` (sessions containing a `purchase` event) and `conversion_pct` = converting / total × 100 rounded to 1 decimal.',
        solution: `WITH flagged AS (
  SELECT user_id,
         event_time,
         event_type,
         CASE WHEN event_time - LAG(event_time) OVER (PARTITION BY user_id ORDER BY event_time)
                   <= interval '30 minutes'
              THEN 0 ELSE 1 END AS is_new
  FROM events
),
numbered AS (
  SELECT user_id,
         event_type,
         SUM(is_new) OVER (PARTITION BY user_id ORDER BY event_time) AS session_no
  FROM flagged
),
sessions AS (
  SELECT user_id,
         session_no,
         bool_or(event_type = 'purchase') AS converted
  FROM numbered
  GROUP BY user_id, session_no
)
SELECT COUNT(*) AS sessions,
       COUNT(*) FILTER (WHERE converted) AS converting_sessions,
       ROUND(100.0 * COUNT(*) FILTER (WHERE converted) / COUNT(*), 1) AS conversion_pct
FROM sessions`,
        hints: ['You need a session id per event this time (running SUM), then one row per session.', '`bool_or(event_type = \'purchase\')` per session; then conditional aggregation over sessions.', 'Use 100.0 to avoid integer division.'],
        explanation: '13 sessions, 3 of them contain a purchase (user 1’s morning session and both of user 4’s) → 23.1%. The grain matters: conversion per **user** would be 2/5 = 40%, per **event** meaningless. Always say which denominator a rate uses.',
      },
    ],
    judgment: [
      {
        id: 'ss-judge-hour-buckets',
        kind: 'peer-review',
        title: 'PR: “simpler sessions with date_trunc”',
        context: 'A teammate replaces the LAG-based session model with a “simpler and faster” version for the real-time dashboard: “a session is all events of a user within the same hour”. You are reviewing the PR; the expected output is one row per session with start and event count.',
        sql: `SELECT user_id,
       date_trunc('hour', event_time) AS session_id,
       MIN(event_time) AS session_start,
       COUNT(*) AS events
FROM events
GROUP BY user_id, date_trunc('hour', event_time)
ORDER BY user_id, session_start`,
        bugLines: [2, 6],
        options: [
          {
            text: 'Hourly buckets are tumbling windows: they merge visits separated by a long break inside one hour and would split a visit crossing an hour boundary. Sessions must come from inactivity gaps.',
            correct: true,
            why: 'User 2’s 10:00–10:03 and 10:50–10:55 visits (47 minutes apart) become one “session”; user 3’s 11:00 and 11:40 visits too. 11 hour-buckets vs 13 real sessions.',
          },
          { text: 'GROUP BY must use the alias session_id instead of repeating the expression.', why: 'Repeating the expression (or GROUP BY 2) is fine in Postgres; it doesn’t change the result.' },
          { text: 'MIN(event_time) is wrong; the session start is date_trunc(\'hour\').', why: 'The first event is the real start; the bucket boundary is an artifact.' },
          { text: 'It needs COUNT(DISTINCT event_type).', why: 'Events per session is a row count; distinct types answer a different question.' },
        ],
        fixedSql: `WITH flagged AS (
  SELECT user_id,
         event_time,
         CASE WHEN event_time - LAG(event_time) OVER (PARTITION BY user_id ORDER BY event_time)
                   <= interval '30 minutes'
              THEN 0 ELSE 1 END AS is_new
  FROM events
),
numbered AS (
  SELECT user_id,
         event_time,
         SUM(is_new) OVER (PARTITION BY user_id ORDER BY event_time) AS session_no
  FROM flagged
)
SELECT user_id,
       session_no AS session_id,
       MIN(event_time) AS session_start,
       COUNT(*) AS events
FROM numbered
GROUP BY user_id, session_no
ORDER BY user_id, session_start`,
        lesson: 'Tumbling windows (fixed buckets) answer “activity per hour”; session windows answer “visits”. If the dashboard must be real time, use a streaming session window (Flink/Kafka Streams) rather than redefining the metric.',
      },
    ],
    recall: [
      { q: 'The three steps of sessionization in SQL?', a: 'LAG(event_time) per user → flag is_new when gap > threshold or no previous event → running SUM(is_new) per user = session number.' },
      { q: 'Why does `EXTRACT(MINUTE FROM gap) > 30` break sessionization?', a: 'It returns only the minutes field (0–59) of the interval, so a 23h30m gap reads as 30. Compare intervals or use EXTRACT(EPOCH)/60.' },
      { q: 'Session window vs tumbling window?', a: 'Tumbling = fixed, aligned buckets (every hour). Session = boundaries wherever activity stops for longer than the gap; length varies per key.' },
      { q: 'How do streaming engines handle a late event that bridges two sessions?', a: 'Session windows merge: the late event’s window overlaps both, they are merged into one, and an updated result is emitted (within allowed lateness / grace); after that the event is dropped or side-outputted.' },
    ],
    transfer: [
      {
        id: 'ss-t-trips',
        scenario: 'A fleet sends GPS pings every few seconds while a truck is moving. Ops wants trips: a trip ends when a truck sends nothing for 10 minutes.',
        approach: 'Sessionization with key = truck_id and a 10-minute threshold: LAG(ping_time) per truck, flag gaps > 10 min, running SUM = trip_no, GROUP BY truck, trip_no for start/end/ping count (and distance with LAG on coordinates).',
      },
      {
        id: 'ss-t-support',
        scenario: 'Support chat messages arrive per customer. A “conversation” is a series of messages with no pause longer than 4 hours; SLA is measured per conversation.',
        approach: 'Same pattern on messages: partition by customer, 4-hour gap threshold, running SUM = conversation id; first response time = MIN(agent message time) − MIN(customer message time) per conversation.',
      },
    ],
    confusable: ['gaps-islands', 'lag-lead', 'running-totals-frames', 'funnel-analysis'],
  },
  // ───────────────────────────────────────────────────────────────── pivot / unpivot
  {
    id: 'pivot-unpivot',
    track: 'analytics',
    title: 'Pivot & unpivot',
    tagline: 'Rows → columns is one GROUP BY with one filtered aggregate per output column; columns → rows is a lateral VALUES list (or unnest) that emits one row per column.',
    level: 'intermediate',
    minutes: 12,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      '**Pivot** turns values of a column into columns: “one row per month, one column per order status”. In standard SQL that is conditional aggregation: `GROUP BY month` decides the rows, and each output column is its own aggregate that only looks at the matching rows — `SUM(amount) FILTER (WHERE status = \'paid\') AS paid`.',
      'Postgres has the `FILTER (WHERE …)` clause; the portable spelling is `SUM(CASE WHEN status = \'paid\' THEN amount END)`. Both feed the aggregate only the matching rows. Watch what “no matching rows” yields: `SUM` / `AVG` / `MAX` return **NULL**, `COUNT` returns **0**. Wrap sums in `COALESCE(…, 0)` when a report needs zeros.',
      '**Unpivot** goes the other way: wide columns (`paid`, `pending`, `refunded`) become rows `(status, amount)`. Join each row to a tiny inline table built from its own columns: `CROSS JOIN LATERAL (VALUES (\'paid\', paid), (\'pending\', pending), …) v(status, amount)`. Every input row fans out into one row per listed column — the fan-out is the point here.',
      'A SQL query must declare its columns before it runs, so a pivot can only produce the columns you list. A **dynamic** pivot (one column per value that exists in the data) needs generated SQL, or returns the pivot as a single `jsonb_object_agg(key, value)` column that the application spreads out.',
    ],
    internals: [
      'A conditional-aggregation pivot is a **single pass**: one HashAggregate (or Sort + GroupAggregate) node keeps one transition state per output column per group; for each input row the executor evaluates every FILTER and only advances the aggregates whose filter is true. That is why it beats writing one subquery per column (N scans) or N self-joins.',
      'Postgres has no `PIVOT` keyword; `crosstab()` lives in the `tablefunc` extension (not installed here) and still requires a column definition list. Snowflake, BigQuery, SQL Server and DuckDB have `PIVOT`/`UNPIVOT` syntax, but under the hood they are rewritten to the same conditional aggregation / union shape, and they too need the value list at compile time (Snowflake’s `ANY` and DuckDB’s dynamic PIVOT run a first query to discover the values).',
      '`CROSS JOIN LATERAL (VALUES …)` plans as a **Nested Loop** whose inner side is a **Values Scan** re-evaluated per outer row — cheap, no hashing, no extra table scans. `unnest(ARRAY[…], ARRAY[…])` produces the same rows through a **ProjectSet** node. Both read the wide table once; the old `UNION ALL` of N selects reads it N times.',
      'Wide (pivoted) tables are for presentation and ML features; long (unpivoted) tables are for storage and aggregation, because adding a new status/metric is a new row, not a schema migration. Data engineers convert between the two constantly — e.g. long `metric_name, value` EAV/telemetry tables pivoted into feature columns.',
    ],
    signals: ['one column per status / month / category', 'turn rows into columns (crosstab report)', 'turn columns into rows / normalize a wide table', 'side-by-side comparison in one row', 'key-value (EAV) attributes as columns'],
    template: `-- pivot: rows → columns
SELECT month,
       COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)     AS paid,
       COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0) AS refunded
FROM monthly_orders
GROUP BY month;

-- unpivot: columns → rows
SELECT w.month, v.status, v.amount
FROM wide w
CROSS JOIN LATERAL (VALUES ('paid', w.paid), ('refunded', w.refunded)) AS v(status, amount);`,
    realWorld: [
      {
        title: 'Finance and ops reports',
        body: 'Month × status, region × product, week × channel reports are pivots. Doing the pivot in SQL (instead of in the BI tool) is common for exports and emails; the BI layer often prefers the long form and pivots itself.',
      },
      {
        title: 'Feature tables for ML',
        body: 'Event logs (long) are pivoted into one row per user with `views_7d`, `carts_7d`, `purchases_7d` columns using `COUNT(*) FILTER (WHERE …)`. The FILTER predicates usually combine type **and** time window, still in a single scan.',
      },
      {
        title: 'Normalizing spreadsheets and vendor files',
        body: 'Ingested CSVs arrive wide (`jan, feb, mar, …` columns). The first transformation unpivots them into `(entity, month, value)` so that new months don’t need schema changes and the data can be joined and aggregated.',
      },
    ],
    mistakes: [
      {
        title: '`COUNT(CASE WHEN … THEN 1 ELSE 0 END)`',
        why: 'COUNT counts non-NULL values, and 0 is not NULL — this counts every row.',
        fix: '`COUNT(*) FILTER (WHERE …)`, `SUM(CASE WHEN … THEN 1 ELSE 0 END)` or `COUNT(CASE WHEN … THEN 1 END)` (no ELSE).',
      },
      {
        title: 'AVG with `ELSE 0`',
        why: '`AVG(CASE WHEN status = \'paid\' THEN amount ELSE 0 END)` averages zeros for every non-paid row, dragging the average down.',
        fix: 'Leave out the ELSE (NULLs are ignored by AVG) or use `AVG(amount) FILTER (WHERE status = \'paid\')`.',
      },
      {
        title: 'Expecting 0 from an empty SUM',
        why: 'A month with no refunded orders shows NULL in the refunded column; totals that add columns (`paid + refunded`) then become NULL too.',
        fix: '`COALESCE(SUM(…) FILTER (…), 0)` for every summed pivot column.',
      },
      {
        title: 'Grouping by the pivoted column',
        why: '`GROUP BY month, status` returns one row per month and status — the rows never collapse, each pivot column is filled in only one row.',
        fix: 'GROUP BY only the row key; the pivoted column appears only inside the FILTER conditions.',
      },
    ],
    worked: {
      question: 'Finance wants one row per month with order count and revenue split by status (paid / pending / refunded) side by side.',
      sql: `SELECT date_trunc('month', ordered_at)::date AS month,
       COUNT(*) AS orders,
       SUM(amount) FILTER (WHERE status = 'paid') AS paid,
       SUM(amount) FILTER (WHERE status = 'pending') AS pending,
       SUM(amount) FILTER (WHERE status = 'refunded') AS refunded,
       COUNT(*) FILTER (WHERE status = 'refunded') AS refunds
FROM orders
GROUP BY date_trunc('month', ordered_at)
ORDER BY month`,
      notes: {
        from: 'Long format: one row per order, the status is a value in a column.',
        group: 'The group key is only the month. Inside each month’s bucket every FILTER picks its own subset of rows — six aggregates, one pass, no re-scan per column.',
        select: 'January has no pending and no refunded orders: the SUM columns are NULL, while COUNT(*) FILTER gives 0. Wrap the sums in COALESCE for a finance export.',
      },
      predictions: [
        {
          stage: 'group',
          kind: 'rowcount',
          question: '16 orders span January–March. How many rows does the pivot produce?',
          explain: 'GROUP BY month → 3 groups (4, 5 and 7 orders). The status values become columns, not rows.',
        },
        {
          stage: 'select',
          kind: 'choice',
          question: 'January has only paid orders. What do `pending` (SUM … FILTER) and `refunds` (COUNT(*) FILTER) show for January?',
          options: ['0 and 0', 'NULL and 0', 'NULL and NULL', 'The January row is missing'],
          answer: 1,
          explain: 'SUM over zero rows is NULL; COUNT over zero rows is 0. The row itself exists because GROUP BY month found 4 January orders.',
        },
      ],
      takeaway: 'Pivot = GROUP BY the row key + one filtered aggregate per output column; decide explicitly between NULL and 0 for empty cells.',
    },
    build: {
      prompt: 'Build a per-user activity pivot from `events`: `user_id`, `views`, `carts` (add_to_cart), `checkouts`, `purchases` — one row per user, zeros where a user never did that action. Order by user_id.',
      blocks: [
        { slot: 'select', sql: 'user_id', why: 'The row key of the pivot.' },
        { slot: 'select', sql: "COUNT(*) FILTER (WHERE event_type = 'view') AS views", why: 'Counts only view rows of this user.' },
        { slot: 'select', sql: "COUNT(*) FILTER (WHERE event_type = 'add_to_cart') AS carts", why: 'One filtered aggregate per output column.' },
        { slot: 'select', sql: "COUNT(*) FILTER (WHERE event_type = 'checkout') AS checkouts", why: 'Same pattern; COUNT over no rows is 0, not NULL.' },
        { slot: 'select', sql: "COUNT(*) FILTER (WHERE event_type = 'purchase') AS purchases", why: 'Users 2, 3 and 5 never purchased: 0.' },
        { slot: 'from', sql: 'events', why: 'Long format: one row per event.' },
        { slot: 'groupBy', sql: 'user_id', why: 'Only the row key — event_type lives inside the FILTERs.' },
        { slot: 'orderBy', sql: 'user_id', why: 'Stable order.' },
      ],
      traps: [
        {
          slot: 'select',
          sql: "COUNT(event_type = 'purchase') AS purchases",
          replaces: "COUNT(*) FILTER (WHERE event_type = 'purchase') AS purchases",
          why: 'The boolean is TRUE or FALSE, never NULL, so COUNT counts every event of the user.',
        },
        {
          slot: 'select',
          sql: "SUM(CASE WHEN event_type = 'purchase' THEN 1 END) AS purchases",
          replaces: "COUNT(*) FILTER (WHERE event_type = 'purchase') AS purchases",
          why: 'Correct for purchasers, but SUM over no matching rows is NULL — users 2, 3 and 5 get NULL instead of 0.',
        },
        {
          slot: 'select',
          sql: "MAX(CASE WHEN event_type = 'view' THEN 1 ELSE 0 END) AS views",
          replaces: "COUNT(*) FILTER (WHERE event_type = 'view') AS views",
          why: 'MAX(CASE …) is the pivot for key-value attributes (one value per key). Here it only says “ever viewed” (1), not how many views.',
        },
        {
          slot: 'groupBy',
          sql: 'event_type',
          why: 'Grouping by the pivoted column un-pivots the result: one row per user and event type, with three of the four columns 0 in each.',
        },
        {
          slot: 'where',
          sql: "event_type = 'purchase'",
          why: 'WHERE removes rows before any aggregate sees them: views/carts/checkouts become 0 and non-purchasers disappear entirely. Filters per column belong in FILTER.',
        },
      ],
    },
    exercises: [
      {
        id: 'pv-payment-methods',
        kind: 'write',
        title: 'Collected per payment method',
        difficulty: 'Easy',
        prompt: 'From `payments`, return one row per month of `paid_at`: `month` (date, first of month), `card`, `paypal`, `giftcard` (sum of amount per method, **0** when none). Order by month.',
        solution: `SELECT date_trunc('month', paid_at)::date AS month,
       COALESCE(SUM(amount) FILTER (WHERE method = 'card'), 0) AS card,
       COALESCE(SUM(amount) FILTER (WHERE method = 'paypal'), 0) AS paypal,
       COALESCE(SUM(amount) FILTER (WHERE method = 'giftcard'), 0) AS giftcard
FROM payments
GROUP BY 1
ORDER BY month`,
        hints: ['GROUP BY the month only.', 'One `SUM(amount) FILTER (WHERE method = …)` per column; COALESCE for the zeros.'],
        explanation: 'Four months (April only has the second installment of order 8). The giftcard column is non-zero only in February — without COALESCE you would ship three NULLs.',
      },
      {
        id: 'pv-unpivot-status',
        kind: 'write',
        title: 'Unpivot a wide report',
        difficulty: 'Medium',
        prompt: 'The editor contains a wide CTE `monthly` (month, paid, pending, refunded). Unpivot it into rows `month`, `status`, `amount`, skipping empty (NULL) cells. Order by month, status.',
        starter: `WITH monthly AS (
  SELECT date_trunc('month', ordered_at)::date AS month,
         SUM(amount) FILTER (WHERE status = 'paid') AS paid,
         SUM(amount) FILTER (WHERE status = 'pending') AS pending,
         SUM(amount) FILTER (WHERE status = 'refunded') AS refunded
  FROM orders
  GROUP BY 1
)
SELECT *
FROM monthly`,
        solution: `WITH monthly AS (
  SELECT date_trunc('month', ordered_at)::date AS month,
         SUM(amount) FILTER (WHERE status = 'paid') AS paid,
         SUM(amount) FILTER (WHERE status = 'pending') AS pending,
         SUM(amount) FILTER (WHERE status = 'refunded') AS refunded
  FROM orders
  GROUP BY 1
)
SELECT m.month, v.status, v.amount
FROM monthly m
CROSS JOIN LATERAL (
  VALUES ('paid', m.paid), ('pending', m.pending), ('refunded', m.refunded)
) AS v(status, amount)
WHERE v.amount IS NOT NULL
ORDER BY m.month, v.status`,
        hints: ['Each month row must become three rows — join it to a 3-row inline table built from its own columns.', '`CROSS JOIN LATERAL (VALUES (\'paid\', m.paid), …) AS v(status, amount)`; then drop NULL amounts.'],
        explanation: '3 months × 3 statuses = 9 rows, minus January’s two empty cells = 7. LATERAL lets the VALUES list reference the current row; the alternative `unnest(ARRAY[\'paid\',\'pending\',\'refunded\'], ARRAY[paid, pending, refunded])` does the same. A UNION ALL of three SELECTs works too but scans `monthly` three times.',
      },
      {
        id: 'pv-avg-else-zero',
        kind: 'fix-bug',
        title: 'Average paid order looks too low',
        difficulty: 'Medium',
        prompt: 'The report should show `month` and `avg_paid` (average amount of **paid** orders, rounded to 2 decimals) per month, ordered by month. February’s value looks far too low. Fix it.',
        starter: `SELECT date_trunc('month', ordered_at)::date AS month,
       ROUND(AVG(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 2) AS avg_paid
FROM orders
GROUP BY 1
ORDER BY month`,
        solution: `SELECT date_trunc('month', ordered_at)::date AS month,
       ROUND(AVG(amount) FILTER (WHERE status = 'paid'), 2) AS avg_paid
FROM orders
GROUP BY 1
ORDER BY month`,
        hints: ['How many rows does AVG see in February, and how many of them are paid?', 'Which values does AVG ignore?'],
        explanation: '`ELSE 0` turns every non-paid order into a 0 that AVG happily averages: February = 2305 / 5 = 461 instead of 2305 / 3 = 768.33. AVG ignores NULLs, so dropping the ELSE (or using FILTER) restricts the denominator to paid orders. January looked right only because all its orders were paid.',
      },
    ],
    judgment: [
      {
        id: 'pv-judge-count-else',
        kind: 'spot-bug',
        title: 'Everyone is a heavy purchaser',
        context: 'A feature table for the churn model counts actions per user. The data scientist complains that `purchases` equals the total number of events for every user. Find the line.',
        sql: `SELECT user_id,
       COUNT(*) AS events,
       COUNT(CASE WHEN event_type = 'view' THEN 1 END) AS views,
       COUNT(CASE WHEN event_type = 'purchase' THEN 1 ELSE 0 END) AS purchases
FROM events
GROUP BY user_id
ORDER BY user_id`,
        bugLines: [4],
        options: [
          {
            text: 'COUNT counts non-NULL values; `ELSE 0` makes every row non-NULL, so it counts all events.',
            correct: true,
            why: 'User 1 shows 7 purchases (all 7 events) instead of 1. Line 3 is right precisely because it has no ELSE.',
          },
          { text: 'COUNT(*) on line 2 should be COUNT(event_type).', why: 'event_type is NOT NULL — both count every row and that column is meant to.' },
          { text: 'It needs GROUP BY user_id, event_type.', why: 'That would split each user into several rows and break the one-row-per-user feature table.' },
          { text: 'CASE inside COUNT is not allowed; it must be FILTER.', why: 'CASE inside an aggregate is valid (and portable); the ELSE is the problem.' },
        ],
        fixedSql: `SELECT user_id,
       COUNT(*) AS events,
       COUNT(CASE WHEN event_type = 'view' THEN 1 END) AS views,
       COUNT(*) FILTER (WHERE event_type = 'purchase') AS purchases
FROM events
GROUP BY user_id
ORDER BY user_id`,
        lesson: 'Pick one idiom per codebase: `COUNT(*) FILTER (WHERE …)` in Postgres, or `SUM(CASE WHEN … THEN 1 ELSE 0 END)` for portability. Mixing COUNT with ELSE 0 is the classic pivot bug.',
      },
    ],
    recall: [
      { q: 'How do you pivot rows into columns without crosstab?', a: 'GROUP BY the row key; one aggregate per output column restricted to its rows: `SUM(x) FILTER (WHERE k = …)` or `SUM(CASE WHEN k = … THEN x END)`.' },
      { q: 'What does an empty pivot cell show for SUM vs COUNT?', a: 'SUM/AVG/MAX → NULL; COUNT → 0. COALESCE sums when zeros are needed.' },
      { q: 'Two ways to unpivot in Postgres?', a: '`CROSS JOIN LATERAL (VALUES (\'a\', a), (\'b\', b)) v(key, val)` or `unnest(ARRAY[\'a\',\'b\'], ARRAY[a, b])`; UNION ALL works but rescans the table per column.' },
      { q: 'Why can’t plain SQL do a dynamic pivot?', a: 'Result columns must be known when the query is planned. Generate the SQL from a first query of distinct keys, or return a jsonb_object_agg(key, value) column.' },
    ],
    transfer: [
      {
        id: 'pv-t-telemetry',
        scenario: 'IoT devices write `(device_id, ts, metric, value)` rows with metrics temperature, humidity and battery. The dashboard needs one row per device per hour with the three metrics as columns (hourly average).',
        approach: 'Pivot: GROUP BY device_id, date_trunc(\'hour\', ts); `AVG(value) FILTER (WHERE metric = \'temperature\')` etc. One scan; unknown future metrics would need generated SQL or a jsonb_object_agg column.',
      },
      {
        id: 'pv-t-budget',
        scenario: 'Finance uploads a budget spreadsheet with columns department, jan, feb, …, dec and wants it compared to actual spend stored per department and month.',
        approach: 'Unpivot the budget with LATERAL VALUES (or unnest of two arrays: month numbers and the 12 columns) into (department, month, budget), then join to actuals aggregated at the same grain.',
      },
    ],
    confusable: ['conditional-aggregation', 'retention-cohort', 'funnel-analysis', 'cte-basics'],
  },
  // ───────────────────────────────────────────────────────────────── retention cohorts
  {
    id: 'retention-cohort',
    track: 'analytics',
    title: 'Cohort retention',
    tagline: 'Group users by when they started (cohort), measure activity by months since start (offset), and divide by the full cohort size — not by whoever happened to be active.',
    level: 'advanced',
    minutes: 16,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      'A **cohort** is a set of users who share a start event in the same period — here, everyone who signed up in January 2024. Comparing cohorts answers “are newer users sticking around better than older ones?”, which a single overall active-user number hides (growth in signups masks churn).',
      'Each activity is placed on a **relative** axis: `month_offset` = months between the cohort month and the activity month (0 = signup month, 1 = the next month…). The result is the classic triangle: one row per cohort, one column (or row) per offset, newer cohorts having fewer observable offsets.',
      'The number in each cell is **distinct active users** of that cohort at that offset, and retention = active / **cohort size**. The cohort size must be computed from **everyone who signed up**, including users who never did anything — those are exactly the users retention is supposed to expose.',
      'Three building blocks, each at its own grain: `cohorts` (one row per user → cohort month), `activity` (one row per user per active month — deduplicated, so 5 orders in a month count once), and `cohort_size` (one row per cohort). Join activity to cohorts, compute the offset, count distinct users per (cohort, offset), divide.',
    ],
    internals: [
      'The plan is a couple of **HashAggregate**s (the DISTINCT in `activity`, the cohort sizes, the final GROUP BY) over **Hash Join**s. `COUNT(DISTINCT …)` is not hashable inside a single aggregate in Postgres: GroupAggregate sorts each group’s values to dedupe, which is why deduplicating `activity` up front (a cheap HashAggregate) and then plain `COUNT(*)` is the faster shape on large event tables.',
      '`age(later, earlier)` returns an interval in years/months/days; for two first-of-month dates `years * 12 + months` is the exact month offset. For days/weeks use plain date subtraction (`activity_date - cohort_date` = days, `/ 7` for week offsets). Never derive offsets from calendar month numbers alone — December → January would be −11.',
      'Missing cells are missing rows: if nobody from a cohort was active at offset 1, GROUP BY simply produces no row. A dashboard that pivots the long result will show a blank instead of 0%. Generate the full grid (cohort × offset with `generate_series`) and LEFT JOIN the activity onto it when zeros matter.',
      'At warehouse scale cohort tables are incremental: append the new month’s activity, recompute only the newest offsets of every cohort. Late-arriving data (refunds, backfills) changes old cells, so “retention for January” is a moving number until the source is closed — document the as-of date.',
    ],
    signals: ['retention by signup month / week', 'what % of users come back after N days/months', 'cohort analysis / cohort triangle', 'are newer users stickier than older ones', 'month 0, month 1, month 2…'],
    template: `WITH cohorts AS (SELECT id AS user_id, date_trunc('month', signup_date)::date AS cohort_month FROM users),
sizes    AS (SELECT cohort_month, COUNT(*) AS cohort_size FROM cohorts GROUP BY 1),   -- ALL signups
activity AS (SELECT DISTINCT user_id, date_trunc('month', ordered_at)::date AS m FROM orders)
SELECT c.cohort_month,
       (EXTRACT(YEAR FROM age(a.m, c.cohort_month)) * 12 + EXTRACT(MONTH FROM age(a.m, c.cohort_month)))::int AS month_offset,
       COUNT(DISTINCT a.user_id) AS active,
       ROUND(100.0 * COUNT(DISTINCT a.user_id) / s.cohort_size, 1) AS pct
FROM cohorts c
JOIN activity a ON a.user_id = c.user_id
JOIN sizes s    ON s.cohort_month = c.cohort_month
GROUP BY c.cohort_month, month_offset, s.cohort_size;`,
    realWorld: [
      {
        title: 'Product and growth reviews',
        body: 'Monthly retention triangles are a standard slide in SaaS / consumer growth reviews and investor decks; D1/D7/D30 retention (day offsets) is the mobile-app equivalent. Analysts usually build a `user_activity_daily` table once and derive every retention view from it.',
      },
      {
        title: 'Revenue retention (NRR / GRR)',
        body: 'Same skeleton with SUM(revenue) instead of COUNT(DISTINCT user): revenue of the cohort at offset N divided by its offset-0 revenue. Net revenue retention above 100% means expansion outweighs churn — a key SaaS metric computed exactly this way.',
      },
      {
        title: 'Experiment and channel analysis',
        body: 'Cohort by acquisition channel or experiment variant instead of month (`cohort = signup_channel`) to see whether paid-social users churn faster than organic, or whether a new onboarding flow changes week-4 retention.',
      },
    ],
    mistakes: [
      {
        title: 'Denominator = users active in month 0',
        why: 'Users who signed up but never did anything disappear from both numerator and denominator, so retention is inflated (March looks 100% instead of 50%).',
        fix: 'Count the cohort size from the signup table (all users), separately from activity.',
      },
      {
        title: 'Counting events instead of users',
        why: '`COUNT(*)` over raw orders counts a user with two January orders twice; retention can exceed 100%.',
        fix: 'Deduplicate activity to (user, period) first, or `COUNT(DISTINCT user_id)`.',
      },
      {
        title: 'Calendar month instead of offset',
        why: '“Active in February” means month 1 for the January cohort but month 0 for the February cohort; mixing them compares different stages of life.',
        fix: 'Compute `month_offset` relative to each cohort and group by it.',
      },
      {
        title: 'Treating missing cells as missing data',
        why: 'No row for (Jan, offset 1) is a real 0%, but charts render it blank and averages skip it.',
        fix: 'LEFT JOIN activity onto a generated cohort × offset grid and COALESCE counts to 0.',
      },
    ],
    worked: {
      question: 'Growth wants a monthly retention table: for each signup cohort and month offset, how many users placed an order and what share of the cohort that is.',
      sql: `WITH cohorts AS (
  SELECT id AS user_id,
         date_trunc('month', signup_date)::date AS cohort_month
  FROM users
),
cohort_size AS (
  SELECT cohort_month, COUNT(*) AS users
  FROM cohorts
  GROUP BY cohort_month
),
activity AS (
  SELECT DISTINCT user_id,
         date_trunc('month', ordered_at)::date AS active_month
  FROM orders
  WHERE user_id IS NOT NULL
)
SELECT c.cohort_month,
       (EXTRACT(YEAR FROM age(a.active_month, c.cohort_month)) * 12
        + EXTRACT(MONTH FROM age(a.active_month, c.cohort_month)))::int AS month_offset,
       COUNT(DISTINCT a.user_id) AS active_users,
       s.users AS cohort_size,
       ROUND(100.0 * COUNT(DISTINCT a.user_id) / s.users, 1) AS retention_pct
FROM cohorts c
JOIN activity a ON a.user_id = c.user_id
JOIN cohort_size s ON s.cohort_month = c.cohort_month
GROUP BY c.cohort_month, month_offset, s.users
ORDER BY c.cohort_month, month_offset`,
      notes: {
        cte: '`cohort_size` is computed from **all** 10 users (3 / 3 / 4). `activity` is one row per user per month with an order — Asha’s two January orders become one row, so nobody can be counted twice.',
        join: 'Joining activity drops Ivan and Jo (March signups, no orders). That is fine for the numerator — inactive users are not active — but it is exactly why the denominator comes from `cohort_size`, which still counts them.',
        group: 'Each group is one cell of the retention triangle: (cohort, months since signup). The January cohort has offsets 0, 1, 2; March only offset 0 — newer cohorts have had less time.',
      },
      predictions: [
        {
          stage: 'join',
          kind: 'rowcount',
          question: '10 users join `activity` (12 user-months with orders). How many rows come out of the first JOIN?',
          explain: '8 users have orders; Asha, Ben, Dana and Fatima were active in 2 months each, so 4 users appear twice → 12 rows. Ivan and Jo never ordered and vanish.',
        },
        {
          stage: 'select',
          kind: 'choice',
          question: 'The March cohort has 4 signups; Goran and Hana ordered in March. What retention_pct does (March, offset 0) show?',
          options: ['100.0', '50.0', '25.0', 'No row for March'],
          answer: 1,
          explain: '2 active / 4 signed up = 50.0. A denominator taken from the active users (2) would claim 100% and hide that half the cohort never converted.',
        },
      ],
      takeaway: 'Numerator: distinct active users per (cohort, offset). Denominator: everyone in the cohort, computed separately — never from the activity you are measuring.',
    },
    build: {
      prompt: 'Build the retention matrix in wide form: one row per `cohort_month` with `cohort_size` (all signups), and `m0`, `m1`, `m2` = distinct users with an order in the signup month, the month after, and two months after. Order by cohort_month.',
      given: `cohorts AS (
  SELECT id AS user_id, date_trunc('month', signup_date)::date AS cohort_month
  FROM users
),
activity AS (
  SELECT DISTINCT user_id, date_trunc('month', ordered_at)::date AS active_month
  FROM orders
  WHERE user_id IS NOT NULL
)`,
      blocks: [
        { slot: 'select', sql: 'c.cohort_month', why: 'Row key of the matrix.' },
        { slot: 'select', sql: 'COUNT(DISTINCT c.user_id) AS cohort_size', why: 'After the join a user appears once per active month — DISTINCT counts each signup once. Users without orders still count (LEFT JOIN).' },
        { slot: 'select', sql: 'COUNT(DISTINCT a.user_id) FILTER (WHERE a.active_month = c.cohort_month) AS m0', why: 'Offset 0: active in the signup month.' },
        {
          slot: 'select',
          sql: "COUNT(DISTINCT a.user_id) FILTER (WHERE a.active_month = c.cohort_month + interval '1 month') AS m1",
          why: 'Offset 1 is relative to **each** cohort: February for January signups, March for February signups.',
        },
        { slot: 'select', sql: "COUNT(DISTINCT a.user_id) FILTER (WHERE a.active_month = c.cohort_month + interval '2 months') AS m2", why: 'Offset 2.' },
        { slot: 'from', sql: 'cohorts c', why: 'Start from all signups — the population retention is measured against.' },
        { slot: 'join', sql: 'LEFT JOIN activity a ON a.user_id = c.user_id', why: 'LEFT keeps users who never ordered in the cohort size.' },
        { slot: 'groupBy', sql: 'c.cohort_month', why: 'One row per cohort; offsets become columns (a pivot).' },
        { slot: 'orderBy', sql: 'c.cohort_month', why: 'Oldest cohort first.' },
      ],
      traps: [
        {
          slot: 'join',
          sql: 'JOIN activity a ON a.user_id = c.user_id',
          replaces: 'LEFT JOIN activity a ON a.user_id = c.user_id',
          why: 'An inner join removes Ivan and Jo before counting: the March cohort size drops from 4 to 2 and its retention doubles.',
        },
        {
          slot: 'select',
          sql: 'COUNT(*) AS cohort_size',
          replaces: 'COUNT(DISTINCT c.user_id) AS cohort_size',
          why: 'Fan-out: after joining activity each user appears once per active month, so COUNT(*) counts user-months (January would be 5, not 3).',
        },
        {
          slot: 'select',
          sql: "COUNT(DISTINCT a.user_id) FILTER (WHERE a.active_month = date '2024-02-01') AS m1",
          replaces: "COUNT(DISTINCT a.user_id) FILTER (WHERE a.active_month = c.cohort_month + interval '1 month') AS m1",
          why: 'A calendar month is not an offset: February is month 1 for January signups but month 0 for February signups, so the February cohort’s “m1” becomes its m0.',
        },
        {
          slot: 'where',
          sql: "a.active_month >= date '2024-01-01'",
          why: 'A WHERE on the LEFT-joined table is NULL for users without activity and removes them — the LEFT JOIN silently becomes an inner join and the denominators shrink.',
        },
      ],
    },
    exercises: [
      {
        id: 'rc-month1-retention',
        kind: 'write',
        title: 'Month-1 retention per cohort',
        difficulty: 'Medium',
        prompt: 'For each signup-month cohort return `cohort_month`, `cohort_size` (all signups), `retained_m1` (users with an order in the month right after their signup month) and `pct_m1` (rounded to 1 decimal). Include cohorts with 0 retained. Order by cohort_month.',
        solution: `WITH cohorts AS (
  SELECT id AS user_id,
         date_trunc('month', signup_date)::date AS cohort_month
  FROM users
),
activity AS (
  SELECT DISTINCT user_id,
         date_trunc('month', ordered_at)::date AS active_month
  FROM orders
  WHERE user_id IS NOT NULL
)
SELECT c.cohort_month,
       COUNT(*) AS cohort_size,
       COUNT(a.user_id) AS retained_m1,
       ROUND(100.0 * COUNT(a.user_id) / COUNT(*), 1) AS pct_m1
FROM cohorts c
LEFT JOIN activity a
  ON a.user_id = c.user_id
 AND a.active_month = c.cohort_month + interval '1 month'
GROUP BY c.cohort_month
ORDER BY c.cohort_month`,
        hints: ['Put the “month after signup” condition in the LEFT JOIN’s ON, so non-retained users stay as NULL-extended rows.', 'Then COUNT(*) is the cohort size and COUNT(a.user_id) the retained users.'],
        explanation: 'Because the offset condition lives in ON and activity has one row per user-month, each user matches at most one row: COUNT(*) = cohort size, COUNT(a.user_id) = retained. January 1/3, February 2/3, March 0/4 = 0.0 — the March row only exists because of the LEFT JOIN.',
      },
      {
        id: 'rc-orders-not-users',
        kind: 'fix-bug',
        title: 'Retention above 100%',
        difficulty: 'Medium',
        prompt: 'This query should return `cohort_month`, `month_offset`, `active_users` (distinct users with an order) ordered by cohort_month, month_offset. The January month-0 cell shows more users than signed up. Fix it.',
        starter: `WITH cohorts AS (
  SELECT id AS user_id,
         date_trunc('month', signup_date)::date AS cohort_month
  FROM users
)
SELECT c.cohort_month,
       (EXTRACT(YEAR FROM age(date_trunc('month', o.ordered_at), c.cohort_month)) * 12
        + EXTRACT(MONTH FROM age(date_trunc('month', o.ordered_at), c.cohort_month)))::int AS month_offset,
       COUNT(*) AS active_users
FROM cohorts c
JOIN orders o ON o.user_id = c.user_id
GROUP BY 1, 2
ORDER BY 1, 2`,
        solution: `WITH cohorts AS (
  SELECT id AS user_id,
         date_trunc('month', signup_date)::date AS cohort_month
  FROM users
)
SELECT c.cohort_month,
       (EXTRACT(YEAR FROM age(date_trunc('month', o.ordered_at), c.cohort_month)) * 12
        + EXTRACT(MONTH FROM age(date_trunc('month', o.ordered_at), c.cohort_month)))::int AS month_offset,
       COUNT(DISTINCT c.user_id) AS active_users
FROM cohorts c
JOIN orders o ON o.user_id = c.user_id
GROUP BY 1, 2
ORDER BY 1, 2`,
        hints: ['What is one row after joining orders?', 'Asha ordered twice in January.'],
        explanation: 'After the join one row = one order, so COUNT(*) counts orders: Asha’s two January orders make (Jan, 0) = 4 although the cohort has 3 users; Dana’s two February orders do the same for (Feb, 0). COUNT(DISTINCT user) — or deduplicating activity to user-month first — counts people.',
      },
      {
        id: 'rc-full-grid',
        kind: 'write',
        title: 'Paid-order retention with zero cells',
        difficulty: 'Hard',
        prompt: 'Retention based on **paid** orders only. Return every cell of the triangle from each cohort’s signup month up to March 2024: `cohort_month`, `month_offset`, `active_users` (0 when nobody was active), `retention_pct` (of all signups, 1 decimal). Order by cohort_month, month_offset.',
        solution: `WITH cohorts AS (
  SELECT id AS user_id,
         date_trunc('month', signup_date)::date AS cohort_month
  FROM users
),
sizes AS (
  SELECT cohort_month, COUNT(*) AS cohort_size
  FROM cohorts
  GROUP BY cohort_month
),
grid AS (
  SELECT s.cohort_month, s.cohort_size, m::date AS activity_month
  FROM sizes s
  CROSS JOIN generate_series(s.cohort_month, date '2024-03-01', interval '1 month') AS m
),
cohort_activity AS (
  SELECT DISTINCT c.cohort_month,
         date_trunc('month', o.ordered_at)::date AS activity_month,
         o.user_id
  FROM orders o
  JOIN cohorts c ON c.user_id = o.user_id
  WHERE o.status = 'paid'
)
SELECT g.cohort_month,
       (EXTRACT(YEAR FROM age(g.activity_month, g.cohort_month)) * 12
        + EXTRACT(MONTH FROM age(g.activity_month, g.cohort_month)))::int AS month_offset,
       COUNT(ca.user_id) AS active_users,
       ROUND(100.0 * COUNT(ca.user_id) / g.cohort_size, 1) AS retention_pct
FROM grid g
LEFT JOIN cohort_activity ca
  ON ca.cohort_month = g.cohort_month
 AND ca.activity_month = g.activity_month
GROUP BY g.cohort_month, g.activity_month, g.cohort_size
ORDER BY g.cohort_month, month_offset`,
        hints: ['Generate the grid first: each cohort × every month from its cohort month to 2024-03-01 (`generate_series` with a 1 month step).', 'LEFT JOIN deduplicated (cohort, month, user) paid activity onto the grid and COUNT a column from the right side.'],
        explanation: 'Ben’s only February order was refunded, so the (January, 1) cell has nobody — without the grid that row would simply be missing and a chart would show a blank instead of 0%. The March cohort is 1/4 = 25.0 because Hana’s only order was refunded too. A set-returning function in FROM can reference earlier FROM items (implicit LATERAL), which is how each cohort gets its own series.',
      },
    ],
    judgment: [
      {
        id: 'rc-judge-first-value',
        kind: 'peer-review',
        title: 'PR: “cohort size without another join”',
        context: 'To save a join, a teammate derives cohort size from the month-0 cell with a window function. The PR description says: “month 0 is everyone in the cohort by definition”. Review it.',
        sql: `WITH cohorts AS (
  SELECT id AS user_id, date_trunc('month', signup_date)::date AS cohort_month
  FROM users
),
activity AS (
  SELECT DISTINCT user_id, date_trunc('month', ordered_at)::date AS active_month
  FROM orders
  WHERE user_id IS NOT NULL
),
cells AS (
  SELECT c.cohort_month,
         (EXTRACT(YEAR FROM age(a.active_month, c.cohort_month)) * 12
          + EXTRACT(MONTH FROM age(a.active_month, c.cohort_month)))::int AS month_offset,
         COUNT(*) AS active_users
  FROM cohorts c
  JOIN activity a ON a.user_id = c.user_id
  GROUP BY 1, 2
)
SELECT cohort_month,
       month_offset,
       active_users,
       ROUND(100.0 * active_users / FIRST_VALUE(active_users) OVER (PARTITION BY cohort_month ORDER BY month_offset), 1) AS retention_pct
FROM cells
ORDER BY cohort_month, month_offset`,
        bugLines: [22],
        options: [
          {
            text: 'Month-0 actives are not the cohort: users who signed up but never ordered are excluded from the denominator, inflating retention.',
            correct: true,
            why: 'The March cohort has 4 signups but only 2 ordered: the PR shows 100.0% where the truth is 50.0%. It also breaks for cohorts whose month 0 is empty (the first cell would be month 1).',
          },
          { text: 'FIRST_VALUE needs ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING.', why: 'FIRST_VALUE only needs the frame start, which the default frame already includes.' },
          { text: 'COUNT(*) in `cells` double counts users with several orders.', why: '`activity` is deduplicated to one row per user-month, so COUNT(*) per (cohort, offset) counts users.' },
          { text: 'Integer division truncates the percentage.', why: '100.0 makes the expression numeric; no truncation happens.' },
        ],
        fixedSql: `WITH cohorts AS (
  SELECT id AS user_id, date_trunc('month', signup_date)::date AS cohort_month
  FROM users
),
sizes AS (
  SELECT cohort_month, COUNT(*) AS cohort_size
  FROM cohorts
  GROUP BY cohort_month
),
activity AS (
  SELECT DISTINCT user_id, date_trunc('month', ordered_at)::date AS active_month
  FROM orders
  WHERE user_id IS NOT NULL
),
cells AS (
  SELECT c.cohort_month,
         (EXTRACT(YEAR FROM age(a.active_month, c.cohort_month)) * 12
          + EXTRACT(MONTH FROM age(a.active_month, c.cohort_month)))::int AS month_offset,
         COUNT(*) AS active_users
  FROM cohorts c
  JOIN activity a ON a.user_id = c.user_id
  GROUP BY 1, 2
)
SELECT x.cohort_month,
       x.month_offset,
       x.active_users,
       ROUND(100.0 * x.active_users / s.cohort_size, 1) AS retention_pct
FROM cells x
JOIN sizes s ON s.cohort_month = x.cohort_month
ORDER BY x.cohort_month, x.month_offset`,
        lesson: 'Never derive a denominator from the numerator’s population. “Who could have been active” comes from the signup source; “who was active” from the activity source.',
      },
    ],
    recall: [
      { q: 'What is a cohort and what is a month offset?', a: 'A cohort = users sharing a start period (signup month). Offset = months between the cohort month and the activity month (0 = signup month).' },
      { q: 'Where must the cohort-size denominator come from?', a: 'From all users who started in that period (the signup table), not from users active in month 0.' },
      { q: 'How do you compute a month offset between two first-of-month dates in Postgres?', a: 'EXTRACT(YEAR FROM age(b, a)) * 12 + EXTRACT(MONTH FROM age(b, a)) — or (year diff) * 12 + (month diff). Never month numbers alone.' },
      { q: 'How do you make empty retention cells show 0 instead of disappearing?', a: 'Generate the cohort × period grid (generate_series) and LEFT JOIN deduplicated activity onto it; COUNT a right-side column.' },
    ],
    transfer: [
      {
        id: 'rc-t-d7',
        scenario: 'The mobile team wants D1 and D7 retention: of users who installed on a given day, what share opened the app exactly 1 day and 7 days later?',
        approach: 'Daily cohorts: cohort = install_date; offset = open_date − install_date (integer days). Dedup to (user, day), COUNT(DISTINCT user) FILTER (WHERE offset = 1) and (= 7) per install date, divided by all installs that day — only for cohorts at least 7 days old.',
      },
      {
        id: 'rc-t-nrr',
        scenario: 'Finance asks for net revenue retention: for customers who started paying in each quarter, how does their total MRR four quarters later compare to their starting MRR?',
        approach: 'Revenue cohorts: cohort = first paying quarter; SUM(mrr) per (cohort, quarter offset); NRR = revenue at offset 4 / revenue at offset 0 of the same cohort (here the offset-0 revenue is the right denominator because it is a revenue base, not a user count).',
      },
    ],
    confusable: ['funnel-analysis', 'pivot-unpivot', 'conditional-aggregation', 'gaps-islands'],
  },
  // ───────────────────────────────────────────────────────────────── funnels
  {
    id: 'funnel-analysis',
    track: 'analytics',
    title: 'Funnel analysis',
    tagline: 'Per user, find the first time each step happened *after the previous step* — then count users per step. Users, not events; order enforced, not assumed.',
    level: 'advanced',
    minutes: 15,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      'A **funnel** is an ordered list of steps (view → add_to_cart → checkout → purchase) and the question “how many users reached each step, and where do they drop off?”. The unit is the **user** (or session), never the event: a user who adds to cart five times is still one user at the cart step.',
      'Reaching a step means doing it **after** the previous step. Each user is reduced to one timestamp per step — the first occurrence — and a user counts at step N only if `t1 < t2 < … < tN`. Without the order check, a user who purchased on Monday and only browsed a product page on Tuesday would be counted as a full conversion.',
      'Two standard shapes: (1) **pivoted firsts** — one GROUP BY user with `MIN(event_time) FILTER (WHERE event_type = …)` per step, then `COUNT(*) FILTER (WHERE t2 > t1 AND …)`; cheap, one scan, but each MIN is independent of the others. (2) **chained steps** — step N’s CTE joins events to step N−1 and takes the first matching event *after* the previous step’s time. Chaining is exact when a user repeats steps (first cart after the first product view, not the first cart ever).',
      'Drop-off is the difference between consecutive steps: step conversion = users(N) / users(N−1), overall conversion = users(N) / users(1). Product funnels usually add a **conversion window** (“purchase within 7 days of the first view”) so a visit last year does not convert today.',
    ],
    internals: [
      'The pivoted-firsts form is one **Seq Scan** (or Index Scan) of events plus a **HashAggregate** grouped by user that evaluates four filtered MINs per row — linear in the number of events and the plan you want on large tables. Filters on `event_type` belong inside `FILTER`, not in WHERE, unless WHERE restricts to exactly the funnel’s event types (which lets an index on event_type prune rows first).',
      'The chained form is N joins of a shrinking user set back to events. With an index on `(user_id, event_type, event_time)` each step is a **Nested Loop** with an index range scan that finds “first event of type X after time T” cheaply; without it each step re-hashes the events table. Its cost grows with the number of steps, the pivoted form’s does not.',
      'Postgres has no funnel function. ClickHouse has `windowFunnel(window)(ts, cond1, cond2, …)`, Snowflake/Oracle/Trino have `MATCH_RECOGNIZE` (regex over ordered rows), and product tools (Amplitude, Mixpanel) implement funnels as per-user state machines over sorted events — the same chaining logic you write here, with “strict order” and “conversion window” as options.',
      'Data-quality traps: client clocks (mobile events can arrive with timestamps out of order — prefer server receive time or a sequence number), duplicate events from retries (dedupe by event id), and identity stitching (anonymous view → logged-in purchase is one person only if the anonymous id was linked to the user id).',
    ],
    signals: ['conversion rate from step A to step B', 'where do users drop off', 'view → cart → checkout → purchase', 'how many users completed onboarding steps in order', 'conversion within N days of first visit'],
    template: `WITH firsts AS (                                   -- one row per user, first time of each step
  SELECT user_id,
         MIN(event_time) FILTER (WHERE event_type = 'step1') AS t1,
         MIN(event_time) FILTER (WHERE event_type = 'step2') AS t2,
         MIN(event_time) FILTER (WHERE event_type = 'step3') AS t3
  FROM events
  GROUP BY user_id
)
SELECT COUNT(t1)                                            AS step1,
       COUNT(*) FILTER (WHERE t2 > t1)                      AS step2,   -- order enforced
       COUNT(*) FILTER (WHERE t3 > t2 AND t2 > t1)          AS step3
FROM firsts;`,
    realWorld: [
      {
        title: 'E-commerce checkout optimisation',
        body: 'The weekly checkout funnel (product page → cart → checkout → paid) split by device or traffic source is how teams find the step to fix: a mobile-only drop at checkout usually means a broken form, not low intent.',
      },
      {
        title: 'Onboarding and activation',
        body: 'SaaS “activation” is a funnel: signed up → verified email → created first project → invited a teammate, often within a 7-day window. Each step’s conversion becomes a product KPI owned by a team.',
      },
      {
        title: 'A/B test readouts',
        body: 'Experiments are judged on funnel conversion per variant. Counting events instead of users, or ignoring step order, can flip the winner — which is why experiment platforms compute funnels per exposed user from the exposure time onward.',
      },
    ],
    mistakes: [
      {
        title: 'Counting events instead of users',
        why: 'Users who view 6 pages inflate the top of the funnel; repeat buyers inflate the bottom. Here 22 view events vs 5 users turns a 40% conversion into 13.6%.',
        fix: 'Reduce to one row per user (MIN per step), then count users.',
      },
      {
        title: 'Not enforcing step order',
        why: 'Counting users who “have a purchase” and “have a view” independently credits purchases that happened before the view, or without any cart.',
        fix: 'Require t_step > t_previous for every step, or chain each step from the previous one.',
      },
      {
        title: 'Independent MINs when steps repeat',
        why: 'MIN(cart) may be an old cart from before the first qualifying view; the order check then rejects a user who did convert later (Dana: cart on Mar 1, product view and cart again on Mar 2).',
        fix: 'Chain the steps: first cart *after* the first view, first checkout after that cart, and so on.',
      },
      {
        title: 'Filtering the base population on a later step',
        why: '`WHERE t_purchase IS NOT NULL` (or an inner join to purchases) leaves only converters, so every step shows 100%.',
        fix: 'Start from everyone who did step 1 and use LEFT JOINs / FILTER for later steps.',
      },
    ],
    worked: {
      question: 'Marketing wants a product funnel per user: first product-page view (page under /p/), then the first add_to_cart after it, the first checkout after that, the first purchase after that. Show each user’s timeline and the furthest step reached.',
      sql: `WITH viewed AS (
  SELECT user_id, MIN(event_time) AS viewed_at
  FROM events
  WHERE event_type = 'view' AND page LIKE '/p/%'
  GROUP BY user_id
),
carted AS (
  SELECT v.user_id, MIN(e.event_time) AS carted_at
  FROM viewed v
  JOIN events e ON e.user_id = v.user_id
               AND e.event_type = 'add_to_cart'
               AND e.event_time > v.viewed_at
  GROUP BY v.user_id
),
checked_out AS (
  SELECT c.user_id, MIN(e.event_time) AS checked_out_at
  FROM carted c
  JOIN events e ON e.user_id = c.user_id
               AND e.event_type = 'checkout'
               AND e.event_time > c.carted_at
  GROUP BY c.user_id
),
purchased AS (
  SELECT k.user_id, MIN(e.event_time) AS purchased_at
  FROM checked_out k
  JOIN events e ON e.user_id = k.user_id
               AND e.event_type = 'purchase'
               AND e.event_time > k.checked_out_at
  GROUP BY k.user_id
)
SELECT v.user_id,
       v.viewed_at,
       c.carted_at,
       k.checked_out_at,
       p.purchased_at,
       CASE WHEN p.user_id IS NOT NULL THEN 'purchase'
            WHEN k.user_id IS NOT NULL THEN 'checkout'
            WHEN c.user_id IS NOT NULL THEN 'add_to_cart'
            ELSE 'view' END AS furthest_step
FROM viewed v
LEFT JOIN carted c ON c.user_id = v.user_id
LEFT JOIN checked_out k ON k.user_id = v.user_id
LEFT JOIN purchased p ON p.user_id = v.user_id
ORDER BY v.user_id`,
      notes: {
        cte: 'Each step CTE has **one row per user** and only contains users who reached that step *after* the previous one: viewed 5 → carted 5 → checked_out 4 → purchased 2. The shrinking row counts *are* the funnel.',
        join: 'LEFT JOINs keep everyone who entered the funnel; a NULL time means “dropped before this step”. Because every CTE is one row per user, no join can fan out.',
        select: 'The CASE walks the steps from the bottom up to label the furthest step — the per-user drop-off point that a dashboard groups by.',
      },
      predictions: [
        {
          stage: 'cte',
          kind: 'rowcount',
          question: 'There are 10 product-page view events across 5 users. How many rows does `viewed` produce?',
          explain: '5: GROUP BY user_id collapses each user’s product views into one row holding the earliest one. Funnels count people, so every step CTE is one row per user.',
        },
        {
          stage: 'join',
          kind: 'choice',
          question: 'Dana (user 4) added a monitor to the cart on Mar 1 08:01 without viewing a product page, then viewed /p/chair on Mar 2 08:10 and added it to the cart at 08:12. What is her carted_at?',
          options: ['2024-03-01 08:01', '2024-03-02 08:12', 'NULL — she drops out of the funnel', 'Two rows, one per cart'],
          answer: 1,
          explain: '`carted` only looks at carts after her first product view (Mar 2 08:10), so the Mar 1 cart is ignored and the first qualifying one is 08:12. An independent MIN(cart) would pick 08:01, fail the “after view” check and wrongly drop her.',
        },
      ],
      takeaway: 'A funnel step is “first occurrence after the previous step’s time”, one row per user; LEFT JOIN the steps so drop-offs stay visible as NULLs.',
    },
    build: {
      prompt: 'Build the one-row funnel summary with the pivoted-firsts approach (step 1 = any view): `viewed`, `carted`, `checked_out`, `purchased` (each step must come after the previous ones) and `conversion_pct` = purchased / viewed × 100, rounded to 1 decimal.',
      ctes: ['firsts'],
      blocks: [
        { scope: 'firsts', slot: 'select', sql: 'user_id', why: 'The funnel unit: one row per user.' },
        { scope: 'firsts', slot: 'select', sql: "MIN(event_time) FILTER (WHERE event_type = 'view') AS t_view", why: 'First time the user did step 1.' },
        { scope: 'firsts', slot: 'select', sql: "MIN(event_time) FILTER (WHERE event_type = 'add_to_cart') AS t_cart", why: 'First cart — MIN, because the funnel asks when the user first got there.' },
        { scope: 'firsts', slot: 'select', sql: "MIN(event_time) FILTER (WHERE event_type = 'checkout') AS t_checkout", why: 'First checkout.' },
        { scope: 'firsts', slot: 'select', sql: "MIN(event_time) FILTER (WHERE event_type = 'purchase') AS t_purchase", why: 'First purchase; NULL for users who never bought.' },
        { scope: 'firsts', slot: 'from', sql: 'events', why: 'One scan of the clickstream.' },
        { scope: 'firsts', slot: 'groupBy', sql: 'user_id', why: 'Collapse events to users so repeat events can’t inflate counts.' },
        { slot: 'select', sql: 'COUNT(t_view) AS viewed', why: 'Users who entered the funnel.' },
        { slot: 'select', sql: 'COUNT(*) FILTER (WHERE t_cart > t_view) AS carted', why: 'Cart must come after the view. NULL comparisons are not true, so users without a cart are not counted.' },
        { slot: 'select', sql: 'COUNT(*) FILTER (WHERE t_checkout > t_cart AND t_cart > t_view) AS checked_out', why: 'Each step repeats the whole chain of order conditions.' },
        {
          slot: 'select',
          sql: 'COUNT(*) FILTER (WHERE t_purchase > t_checkout AND t_checkout > t_cart AND t_cart > t_view) AS purchased',
          why: 'Full conversion: all four steps in order.',
        },
        {
          slot: 'select',
          sql: 'ROUND(100.0 * COUNT(*) FILTER (WHERE t_purchase > t_checkout AND t_checkout > t_cart AND t_cart > t_view) / COUNT(t_view), 1) AS conversion_pct',
          why: '100.0 forces numeric division; the denominator is the top of the funnel.',
        },
        { slot: 'from', sql: 'firsts', why: 'One row per user.' },
      ],
      traps: [
        {
          scope: 'firsts',
          slot: 'select',
          sql: "MAX(event_time) FILTER (WHERE event_type = 'add_to_cart') AS t_cart",
          replaces: "MIN(event_time) FILTER (WHERE event_type = 'add_to_cart') AS t_cart",
          why: 'The last cart is not when the user reached the step. Dana’s last cart (Mar 2) is after her first checkout (Mar 1), so she fails the order check and checked_out drops from 4 to 3.',
        },
        {
          scope: 'firsts',
          slot: 'groupBy',
          sql: 'user_id, event_type',
          replaces: 'user_id',
          why: 'One row per user *and* event type puts each step’s time on a different row, so no row ever has t_cart and t_view together — every step after the first counts 0.',
        },
        {
          slot: 'select',
          sql: 'ROUND(COUNT(*) FILTER (WHERE t_purchase > t_checkout AND t_checkout > t_cart AND t_cart > t_view) / COUNT(t_view) * 100, 1) AS conversion_pct',
          replaces: 'ROUND(100.0 * COUNT(*) FILTER (WHERE t_purchase > t_checkout AND t_checkout > t_cart AND t_cart > t_view) / COUNT(t_view), 1) AS conversion_pct',
          why: 'COUNT returns bigint: 2 / 5 is integer division = 0, so conversion shows 0 instead of 40.0.',
        },
        {
          slot: 'where',
          sql: 't_purchase IS NOT NULL',
          why: 'Filters the population to buyers before counting: every step becomes 2 and conversion 100% — the drop-off you wanted to measure is gone.',
        },
      ],
    },
    exercises: [
      {
        id: 'fn-step-table',
        kind: 'write',
        title: 'Funnel as a step table',
        difficulty: 'Medium',
        prompt: 'Return one row per funnel step with `step_no` (1–4), `step` (view, add_to_cart, checkout, purchase), `users` (users who did that step after all previous steps, step 1 = any view), `pct_of_previous` and `pct_of_first` (1 decimal; pct_of_previous is NULL for step 1). Order by step_no.',
        solution: `WITH firsts AS (
  SELECT user_id,
         MIN(event_time) FILTER (WHERE event_type = 'view') AS t_view,
         MIN(event_time) FILTER (WHERE event_type = 'add_to_cart') AS t_cart,
         MIN(event_time) FILTER (WHERE event_type = 'checkout') AS t_checkout,
         MIN(event_time) FILTER (WHERE event_type = 'purchase') AS t_purchase
  FROM events
  GROUP BY user_id
),
counts AS (
  SELECT COUNT(t_view) AS viewed,
         COUNT(*) FILTER (WHERE t_cart > t_view) AS carted,
         COUNT(*) FILTER (WHERE t_checkout > t_cart AND t_cart > t_view) AS checked_out,
         COUNT(*) FILTER (WHERE t_purchase > t_checkout AND t_checkout > t_cart AND t_cart > t_view) AS purchased
  FROM firsts
),
steps AS (
  SELECT s.step_no, s.step, s.users
  FROM counts c
  CROSS JOIN LATERAL (VALUES (1, 'view', c.viewed), (2, 'add_to_cart', c.carted),
                             (3, 'checkout', c.checked_out), (4, 'purchase', c.purchased)) AS s(step_no, step, users)
)
SELECT step_no,
       step,
       users,
       ROUND(100.0 * users / LAG(users) OVER (ORDER BY step_no), 1) AS pct_of_previous,
       ROUND(100.0 * users / FIRST_VALUE(users) OVER (ORDER BY step_no), 1) AS pct_of_first
FROM steps
ORDER BY step_no`,
        hints: ['Compute the four counts in one row first (firsts → counts), then unpivot them into four rows with LATERAL VALUES.', 'Step-to-step conversion is users / LAG(users); overall is users / FIRST_VALUE(users).'],
        explanation: 'View 5 → cart 5 (100.0) → checkout 4 (80.0) → purchase 2 (50.0); overall 40.0. Computing the counts wide and unpivoting keeps the order logic in one place; LAG over step_no then gives the step conversion without a self-join. The biggest drop is checkout → purchase — that is where to look.',
      },
      {
        id: 'fn-chain-steps',
        kind: 'fix-bug',
        title: 'The funnel that lost a buyer',
        difficulty: 'Hard',
        prompt: 'Step 1 of this funnel is a **product-page view** (`page LIKE \'/p/%\'`), followed by add_to_cart, checkout, purchase, each after the previous step. It should return one row: `viewed`, `carted`, `checked_out`, `purchased`. Dana viewed /p/chair, added it, checked out and paid on Mar 2 — yet she is missing from every step after the view. Fix the query.',
        starter: `WITH firsts AS (
  SELECT user_id,
         MIN(event_time) FILTER (WHERE event_type = 'view' AND page LIKE '/p/%') AS t_view,
         MIN(event_time) FILTER (WHERE event_type = 'add_to_cart') AS t_cart,
         MIN(event_time) FILTER (WHERE event_type = 'checkout') AS t_checkout,
         MIN(event_time) FILTER (WHERE event_type = 'purchase') AS t_purchase
  FROM events
  GROUP BY user_id
)
SELECT COUNT(t_view) AS viewed,
       COUNT(*) FILTER (WHERE t_cart > t_view) AS carted,
       COUNT(*) FILTER (WHERE t_checkout > t_cart AND t_cart > t_view) AS checked_out,
       COUNT(*) FILTER (WHERE t_purchase > t_checkout AND t_checkout > t_cart AND t_cart > t_view) AS purchased
FROM firsts`,
        solution: `WITH viewed AS (
  SELECT user_id, MIN(event_time) AS viewed_at
  FROM events
  WHERE event_type = 'view' AND page LIKE '/p/%'
  GROUP BY user_id
),
carted AS (
  SELECT v.user_id, MIN(e.event_time) AS carted_at
  FROM viewed v
  JOIN events e ON e.user_id = v.user_id
               AND e.event_type = 'add_to_cart'
               AND e.event_time > v.viewed_at
  GROUP BY v.user_id
),
checked_out AS (
  SELECT c.user_id, MIN(e.event_time) AS checked_out_at
  FROM carted c
  JOIN events e ON e.user_id = c.user_id
               AND e.event_type = 'checkout'
               AND e.event_time > c.carted_at
  GROUP BY c.user_id
),
purchased AS (
  SELECT k.user_id, MIN(e.event_time) AS purchased_at
  FROM checked_out k
  JOIN events e ON e.user_id = k.user_id
               AND e.event_type = 'purchase'
               AND e.event_time > k.checked_out_at
  GROUP BY k.user_id
)
SELECT (SELECT COUNT(*) FROM viewed) AS viewed,
       (SELECT COUNT(*) FROM carted) AS carted,
       (SELECT COUNT(*) FROM checked_out) AS checked_out,
       (SELECT COUNT(*) FROM purchased) AS purchased`,
        hints: ['Look at Dana’s firsts: t_view = Mar 2 08:10 but t_cart = Mar 1 08:01. Which cart should the funnel use?', 'Each step needs the first event *after the previous step’s time*, so the steps have to be computed one after another (CTE chain), not independently.'],
        explanation: 'Independent MINs pick Dana’s Mar 1 cart/checkout/purchase, which all happened before her first product view, so the order checks reject her: 5 / 4 / 3 / 1. Chaining each step from the previous one finds her Mar 2 cart (08:12), checkout (08:15) and purchase (08:16): 5 / 5 / 4 / 2. The pivoted form is only correct when “first of each step” is guaranteed to be in order — true when step 1 is the user’s very first event, not for a filtered step 1.',
      },
      {
        id: 'fn-conversion-window',
        kind: 'write',
        title: 'Checkout within 24 hours',
        difficulty: 'Medium',
        prompt: 'Return one row: `viewed` (users with any view), `checked_out` (users whose first checkout came after their first view) and `checked_out_24h` (same, but the first checkout happened at most 24 hours after the first view).',
        solution: `WITH firsts AS (
  SELECT user_id,
         MIN(event_time) FILTER (WHERE event_type = 'view') AS first_view,
         MIN(event_time) FILTER (WHERE event_type = 'checkout') AS first_checkout
  FROM events
  GROUP BY user_id
)
SELECT COUNT(first_view) AS viewed,
       COUNT(*) FILTER (WHERE first_checkout > first_view) AS checked_out,
       COUNT(*) FILTER (WHERE first_checkout > first_view
                          AND first_checkout <= first_view + interval '24 hours') AS checked_out_24h
FROM firsts`,
        hints: ['Timestamp + interval \'24 hours\' is the deadline.', 'Both conditions go in FILTER clauses of the same one-row aggregate.'],
        explanation: '5 viewed, 4 checked out, but only 3 within 24 hours: Eli first viewed on Mar 1 20:00 and checked out on Mar 2 21:10 — 25 h 10 min later. Conversion windows make funnels comparable across time (a user from last month can’t “convert” today) and are a standard option in every product-analytics tool.',
      },
    ],
    judgment: [
      {
        id: 'fn-judge-events',
        kind: 'spot-bug',
        title: 'Dashboard: “only 13.6% of viewers buy”',
        context: 'A dashboard tile shows the purchase funnel; the PM is alarmed that conversion is 13.6%. This is the query behind it. Find the problem.',
        sql: `SELECT event_type AS step,
       COUNT(*) AS users,
       ROUND(100.0 * COUNT(*) / MAX(COUNT(*)) OVER (), 1) AS pct_of_top
FROM events
WHERE event_type IN ('view', 'add_to_cart', 'checkout', 'purchase')
GROUP BY event_type
ORDER BY users DESC`,
        bugLines: [2, 3],
        options: [
          {
            text: 'It counts events, not users: 22 view events from 5 users and 3 purchases from 2 users. It also ignores step order.',
            correct: true,
            why: 'The fixed query reduces to one row per user with the first time of each step and enforces order: 5 / 5 / 4 / 2, i.e. 40.0% conversion, not 13.6%.',
          },
          { text: 'A window function cannot wrap an aggregate (MAX(COUNT(*)) OVER ()).', why: 'It can: window functions run after GROUP BY, so aggregates are valid inputs to them.' },
          { text: 'ORDER BY users DESC does not guarantee funnel order.', why: 'True but cosmetic — the numbers themselves are wrong.' },
          { text: 'The IN filter drops users who have no purchase.', why: 'WHERE removes events of other types, not users; every user still has views.' },
        ],
        fixedSql: `WITH firsts AS (
  SELECT user_id,
         MIN(event_time) FILTER (WHERE event_type = 'view') AS t_view,
         MIN(event_time) FILTER (WHERE event_type = 'add_to_cart') AS t_cart,
         MIN(event_time) FILTER (WHERE event_type = 'checkout') AS t_checkout,
         MIN(event_time) FILTER (WHERE event_type = 'purchase') AS t_purchase
  FROM events
  GROUP BY user_id
),
counts AS (
  SELECT COUNT(t_view) AS v,
         COUNT(*) FILTER (WHERE t_cart > t_view) AS c,
         COUNT(*) FILTER (WHERE t_checkout > t_cart AND t_cart > t_view) AS k,
         COUNT(*) FILTER (WHERE t_purchase > t_checkout AND t_checkout > t_cart AND t_cart > t_view) AS p
  FROM firsts
)
SELECT s.step, s.users, ROUND(100.0 * s.users / MAX(s.users) OVER (), 1) AS pct_of_top
FROM counts
CROSS JOIN LATERAL (VALUES (1, 'view', v), (2, 'add_to_cart', c), (3, 'checkout', k), (4, 'purchase', p)) AS s(step_no, step, users)
ORDER BY s.step_no`,
        lesson: 'A funnel is a statement about people moving through steps in order. Collapse to one row per user (first time per step) before counting anything.',
      },
    ],
    recall: [
      { q: 'What is the unit of a funnel count?', a: 'Distinct users (or sessions) — never events.' },
      { q: 'How do you enforce step order with the pivoted-firsts approach?', a: 'MIN(event_time) FILTER per step per user, then COUNT(*) FILTER (WHERE t2 > t1 AND t3 > t2 …) — every step repeats the earlier conditions.' },
      { q: 'When do independent MINs give the wrong answer, and what is the fix?', a: 'When steps repeat and a later step’s first occurrence predates the qualifying earlier step. Chain the steps: first X after the previous step’s time.' },
      { q: 'Step conversion vs overall conversion?', a: 'Step: users(N) / users(N−1) (LAG). Overall: users(N) / users(step 1) (FIRST_VALUE).' },
    ],
    transfer: [
      {
        id: 'fn-t-hiring',
        scenario: 'Recruiting has an `application_events(candidate_id, stage, happened_at)` log (applied, screen, onsite, offer, hired). They want pass-through rates per stage for candidates who applied in Q1.',
        approach: 'Funnel per candidate: MIN(happened_at) FILTER per stage, restrict to candidates whose applied time is in Q1, count candidates per stage with order checks, then stage-to-stage rates via LAG.',
      },
      {
        id: 'fn-t-activation',
        scenario: 'Product defines activation as: signed up → connected a data source → built a dashboard, all within 7 days of signup. What share of last month’s signups activated, and where do the others stop?',
        approach: 'Chained steps from signup time with a window: first connect after signup and ≤ signup + 7 days, first dashboard after that connect and within the same deadline; LEFT JOIN the steps to all signups and label the furthest step reached.',
      },
    ],
    confusable: ['retention-cohort', 'sessionization', 'conditional-aggregation', 'pivot-unpivot'],
  },
  // ───────────────────────────────────────────────────────────────── SCD2 & as-of joins
  {
    id: 'scd2-asof',
    track: 'analytics',
    title: 'SCD Type 2 & as-of joins',
    tagline: 'History tables keep one row per version with a validity interval; join facts to the version that was valid *at the fact’s time* with a range predicate — and treat the open-ended current row explicitly.',
    level: 'advanced',
    minutes: 16,
    interview: 3,
    viz: 'pipeline',
    intuition: [
      'Dimensions change: a customer moves from bronze to silver to gold. **SCD Type 1** overwrites the attribute (no history — every old order now looks like a gold order). **SCD Type 2** keeps a new **row per version** with `valid_from` / `valid_to` (and often an `is_current` flag), so you can ask what was true at any point in time.',
      'Intervals are **half-open**: `[valid_from, valid_to)`. The next version’s `valid_from` equals the previous version’s `valid_to`, so a timestamp falls in exactly one version: `ts >= valid_from AND ts < valid_to`. The current version has no end — `valid_to IS NULL` (or `\'infinity\'`) — and that open end must be handled in the predicate.',
      'An **as-of join** attaches each fact to the dimension version valid at the fact’s time: `ON d.key = f.key AND f.ts >= d.valid_from AND (d.valid_to IS NULL OR f.ts < d.valid_to)`. Joining on the key alone fans out (one row per version); joining on `is_current` silently rewrites history with today’s values.',
      'Correctness depends on the table’s invariant: **no overlapping intervals and no gaps** per key, and exactly one current row. One bad load that leaves two open rows for a customer doubles every one of their facts in every as-of join.',
    ],
    internals: [
      'Postgres plans the as-of join as a **Hash Join** on the equality part (`user_id`) with the range conditions as a **Join Filter** evaluated per candidate pair — fine while each key has a handful of versions. With an index on `(user_id, valid_from)`, `JOIN LATERAL (… WHERE valid_from <= f.ts ORDER BY valid_from DESC LIMIT 1)` becomes a Nested Loop with one index probe per fact. Postgres has no `ASOF JOIN`; DuckDB, ClickHouse and Snowflake (`MATCH_CONDITION`) do, implemented as a sort-merge on the time column.',
      'Integrity can be enforced in the database: a partial unique index `ON customer_tiers (user_id) WHERE valid_to IS NULL` allows one current row per key, and `EXCLUDE USING gist (user_id WITH =, daterange(valid_from, valid_to) WITH &&)` (needs the `btree_gist` extension) rejects overlapping versions. Postgres 18 adds `WITHOUT OVERLAPS` temporal primary keys for the same purpose. A NULL upper bound in `daterange` means unbounded, so open rows participate correctly.',
      'NULL vs `\'infinity\'` for the open end: `\'infinity\'::date` turns the predicate into a plain `ts < valid_to`, which is simpler and index-friendly, and makes BETWEEN-style bugs less likely. NULL is the dbt default and reads naturally as “unknown end”. Pick one convention per warehouse and never mix them.',
      '**dbt snapshots** implement SCD2 for you: each run compares the source to the snapshot table (`strategy: timestamp` using an `updated_at` column, or `strategy: check` comparing `check_cols`) and issues a MERGE that closes changed rows (`dbt_valid_to = now`) and inserts new versions (`dbt_valid_from`, `dbt_valid_to = NULL`, `dbt_scd_id`). Changes between two snapshot runs are invisible — history is only as fine-grained as the schedule. The alternative, **daily full snapshots** (copy the whole table each day with a `snapshot_date`), is trivial to query (`JOIN ON snapshot_date = fact_date`) but stores every row every day.',
    ],
    signals: ['what was the customer’s tier / price / plan at the time of the order', 'history of changes to a dimension', 'valid_from / valid_to / is_current columns', 'point-in-time or as-of reporting', 'dbt snapshot', 'slowly changing dimension'],
    template: `SELECT f.*, d.attribute
FROM facts f
LEFT JOIN dim_history d
  ON d.key = f.key
 AND f.ts >= d.valid_from                              -- version started on/before the fact
 AND (d.valid_to IS NULL OR f.ts < d.valid_to);        -- and had not ended yet (half-open)
-- current version:   WHERE d.valid_to IS NULL   (or is_current)
-- state on a date:   :d >= valid_from AND (valid_to IS NULL OR :d < valid_to)`,
    realWorld: [
      {
        title: 'Revenue by plan / tier / region at time of sale',
        body: 'Finance reports revenue by the customer’s segment *when they bought*, not today’s segment — otherwise last year’s numbers change every time a customer upgrades. The as-of join to an SCD2 customer dimension is the standard star-schema pattern.',
      },
      {
        title: 'Prices, FX rates and contracts',
        body: 'Product price history, exchange rates and contract terms are versioned the same way. Invoicing an old order at today’s price, or converting a past transaction at today’s FX rate, is the as-of bug in its most expensive form.',
      },
      {
        title: 'dbt snapshots and audit',
        body: 'Teams snapshot mutable OLTP tables (users, accounts, subscriptions) nightly with dbt so analysts can answer “what did this account look like on March 1?” and auditors can see when a field changed.',
      },
    ],
    mistakes: [
      {
        title: 'Joining on the key only',
        why: 'Every fact matches every version of its customer: 16 orders become 28 rows and revenue is multiplied by the number of versions.',
        fix: 'Add the range predicate so each fact matches exactly one version.',
      },
      {
        title: 'Forgetting the open-ended current row',
        why: '`ts < valid_to` is NULL when valid_to is NULL, so every fact in a current version is dropped (or ends up as “no tier”).',
        fix: '`(valid_to IS NULL OR ts < valid_to)`, or store `\'infinity\'` instead of NULL.',
      },
      {
        title: 'Using is_current for historical facts',
        why: 'All of a customer’s past orders get today’s tier: gold revenue jumps from 150 to 2180 because Asha and Fatima are gold *now*.',
        fix: 'is_current is for “what is true today” questions; historical facts need the range join.',
      },
      {
        title: 'Closed intervals (BETWEEN) and overlapping loads',
        why: 'With `BETWEEN valid_from AND valid_to` a fact exactly on a boundary matches two versions; a bad load that leaves two open rows does the same for every later fact.',
        fix: 'Half-open intervals, plus checks (or an exclusion constraint) for overlaps and exactly one current row per key.',
      },
    ],
    worked: {
      question: 'Finance wants paid revenue split by the tier each customer had **when they placed the order** (customers without any tier row as “none”).',
      sql: `SELECT COALESCE(t.tier, 'none') AS tier_at_order,
       COUNT(*) AS paid_orders,
       SUM(o.amount) AS revenue
FROM orders o
LEFT JOIN customer_tiers t
  ON t.user_id = o.user_id
 AND o.ordered_at >= t.valid_from
 AND (t.valid_to IS NULL OR o.ordered_at < t.valid_to)
WHERE o.status = 'paid'
GROUP BY COALESCE(t.tier, 'none')
ORDER BY revenue DESC`,
      notes: {
        from: '16 orders. `ordered_at` is a timestamp and `valid_from` / `valid_to` are dates; comparing them treats the date as midnight, so a tier valid from 2024-03-01 applies from 00:00 that day.',
        join: 'Each order picks the single version whose half-open interval contains `ordered_at`. Asha’s order on Jan 20 18:40 is still bronze (silver starts Jan 21); her Mar 5 order matches the open-ended gold row through the `valid_to IS NULL` branch. Chen, Eli, Goran and the guest order have no tier rows and are NULL-extended.',
        where: 'Filtering on the left table (`o.status`) is safe after a LEFT JOIN — it removes 2 pending and 2 refunded orders, not NULL-extended rows.',
        group: 'COALESCE turns “no version” into an explicit `none` bucket, so the four buckets add up to all paid revenue (3985).',
      },
      predictions: [
        {
          stage: 'join',
          kind: 'rowcount',
          question: '16 orders are LEFT JOINed to 9 tier-history rows with the range predicate. How many rows come out?',
          explain: '16: every order matches at most one version, and the LEFT JOIN keeps orders with none. Joining on user_id alone would give 28 rows — Asha’s 3 orders × 3 versions, Dana’s and Fatima’s 3 orders × 2 versions each.',
        },
        {
          stage: 'group',
          kind: 'choice',
          question: 'Asha and Fatima are gold **today** and together have 1680 + 500 of paid orders. How much revenue lands in the gold bucket?',
          options: ['150', '2180', '1680', 'Gold is missing'],
          answer: 0,
          explain: 'Only orders placed after their upgrade on Mar 1 count as gold: Fatima’s Mar 2 order (80) and Asha’s Mar 5 order (70) = 150. 2180 is what a join on is_current would report — history rewritten with today’s tier.',
        },
      ],
      takeaway: 'Facts join the dimension version valid at the fact’s time: key equality plus `ts >= valid_from AND (valid_to IS NULL OR ts < valid_to)` — one version per fact, history preserved.',
    },
    build: {
      prompt: 'Build paid revenue by tier **at the time of the order**: `tier` (“none” for customers without a tier row), `orders`, `revenue`, ordered by revenue descending.',
      blocks: [
        { slot: 'select', sql: "COALESCE(t.tier, 'none') AS tier", why: 'Orders from customers without history get an explicit bucket instead of a NULL group.' },
        { slot: 'select', sql: 'COUNT(*) AS orders', why: 'One row per order after a correct as-of join.' },
        { slot: 'select', sql: 'SUM(o.amount) AS revenue', why: 'Paid revenue per bucket.' },
        { slot: 'from', sql: 'orders o', why: 'The facts drive the query; the dimension is looked up per fact.' },
        {
          slot: 'join',
          sql: 'LEFT JOIN customer_tiers t ON t.user_id = o.user_id AND o.ordered_at >= t.valid_from AND (t.valid_to IS NULL OR o.ordered_at < t.valid_to)',
          why: 'Key + half-open validity range, with the open-ended current version handled. LEFT keeps orders without a tier.',
        },
        { slot: 'where', sql: "o.status = 'paid'", why: 'Revenue = paid orders only; a filter on the fact table is safe after the LEFT JOIN.' },
        { slot: 'groupBy', sql: "COALESCE(t.tier, 'none')", why: 'Group by the same expression as the select.' },
        { slot: 'orderBy', sql: 'revenue DESC', why: 'Biggest bucket first.' },
      ],
      traps: [
        {
          slot: 'join',
          sql: 'LEFT JOIN customer_tiers t ON t.user_id = o.user_id',
          replaces: 'LEFT JOIN customer_tiers t ON t.user_id = o.user_id AND o.ordered_at >= t.valid_from AND (t.valid_to IS NULL OR o.ordered_at < t.valid_to)',
          why: 'Without the range every order matches every version of its customer: Asha’s orders are counted 3 times, once per tier, and revenue is inflated.',
        },
        {
          slot: 'join',
          sql: 'LEFT JOIN customer_tiers t ON t.user_id = o.user_id AND o.ordered_at >= t.valid_from AND o.ordered_at < t.valid_to',
          replaces: 'LEFT JOIN customer_tiers t ON t.user_id = o.user_id AND o.ordered_at >= t.valid_from AND (t.valid_to IS NULL OR o.ordered_at < t.valid_to)',
          why: '`ordered_at < NULL` is NULL, so no order ever matches a current version: gold disappears and those orders fall into “none”.',
        },
        {
          slot: 'join',
          sql: 'LEFT JOIN customer_tiers t ON t.user_id = o.user_id AND t.is_current',
          replaces: 'LEFT JOIN customer_tiers t ON t.user_id = o.user_id AND o.ordered_at >= t.valid_from AND (t.valid_to IS NULL OR o.ordered_at < t.valid_to)',
          why: 'Today’s tier, not the tier at purchase: gold shows 2180 instead of 150 because past orders of current gold customers are relabelled.',
        },
        {
          slot: 'join',
          sql: 'JOIN customer_tiers t ON t.user_id = o.user_id AND o.ordered_at >= t.valid_from AND (t.valid_to IS NULL OR o.ordered_at < t.valid_to)',
          replaces: 'LEFT JOIN customer_tiers t ON t.user_id = o.user_id AND o.ordered_at >= t.valid_from AND (t.valid_to IS NULL OR o.ordered_at < t.valid_to)',
          why: 'An inner join drops the 4 paid orders (600) from customers without tier history — the buckets no longer add up to total revenue.',
        },
        {
          slot: 'where',
          sql: 't.is_current',
          why: 'Keeps only orders placed during the customer’s current version: all bronze-era orders of upgraded customers vanish, and orders without a tier are removed too.',
        },
      ],
    },
    exercises: [
      {
        id: 'scd-state-on-date',
        kind: 'write',
        title: 'Tier on a given date',
        difficulty: 'Easy',
        prompt: 'For every user who had signed up by 2024-02-20, return `user_id`, `name` and the `tier` valid on 2024-02-20 (NULL if they had none). Order by user_id.',
        solution: `SELECT u.id AS user_id, u.name, t.tier
FROM users u
LEFT JOIN customer_tiers t
  ON t.user_id = u.id
 AND t.valid_from <= date '2024-02-20'
 AND (t.valid_to IS NULL OR t.valid_to > date '2024-02-20')
WHERE u.signup_date <= date '2024-02-20'
ORDER BY u.id`,
        hints: ['A version is valid on day D when valid_from <= D and (valid_to IS NULL or D < valid_to).', 'Put the date conditions in the LEFT JOIN’s ON so users without a valid version stay with NULL.'],
        explanation: 'Asha silver (Jan 21 – Mar 1), Ben bronze (open), Dana bronze, Fatima silver (from Feb 18); Chen and Eli have no history. Point-in-time state is the same predicate as the as-of join with a constant instead of a fact timestamp. Putting the range in WHERE instead would drop Chen and Eli.',
      },
      {
        id: 'scd-duplicate-orders',
        kind: 'fix-bug',
        title: 'Orders listed three times',
        difficulty: 'Medium',
        prompt: 'This should list every paid order of a customer with tier history — `order_id`, `user_id`, `ordered_at`, `tier` at the time of the order — one row per order, ordered by order_id. Some orders appear two or three times. Fix it.',
        starter: `SELECT o.id AS order_id, o.user_id, o.ordered_at, t.tier
FROM orders o
JOIN customer_tiers t
  ON t.user_id = o.user_id
 AND t.valid_from <= o.ordered_at
WHERE o.status = 'paid'
ORDER BY o.id`,
        solution: `SELECT o.id AS order_id, o.user_id, o.ordered_at, t.tier
FROM orders o
JOIN customer_tiers t
  ON t.user_id = o.user_id
 AND t.valid_from <= o.ordered_at
 AND (t.valid_to IS NULL OR o.ordered_at < t.valid_to)
WHERE o.status = 'paid'
ORDER BY o.id`,
        hints: ['Order 15 (Asha, Mar 5) matches bronze, silver and gold. Which of them were already over?', 'A version must have started *and not yet ended*.'],
        explanation: 'With only the lower bound, every version that started before the order matches — all of them for later orders: 12 rows instead of 8. Adding the upper bound (with the NULL branch for current rows) leaves exactly one. An equivalent form is `JOIN LATERAL (SELECT tier FROM customer_tiers WHERE user_id = o.user_id AND valid_from <= o.ordered_at ORDER BY valid_from DESC LIMIT 1)`, which relies on the history having no gaps.',
      },
      {
        id: 'scd-overlaps',
        kind: 'write',
        title: 'Detect overlapping versions',
        difficulty: 'Hard',
        prompt: 'A faulty load added an open-ended silver row for Ben (the starter simulates it in the `tiers` CTE). Find every pair of versions of the same user whose validity intervals overlap: `user_id`, `first_tier`, `second_tier` (first = the version that starts earlier), `overlap_from`, `overlap_to` (NULL = open-ended). Order by user_id, overlap_from.',
        starter: `WITH tiers AS (
  SELECT user_id, tier, valid_from, valid_to FROM customer_tiers
  UNION ALL
  SELECT 2, 'silver', date '2024-02-01', NULL
)
SELECT *
FROM tiers
ORDER BY user_id, valid_from`,
        solution: `WITH tiers AS (
  SELECT user_id, tier, valid_from, valid_to FROM customer_tiers
  UNION ALL
  SELECT 2, 'silver', date '2024-02-01', NULL
)
SELECT a.user_id,
       a.tier AS first_tier,
       b.tier AS second_tier,
       GREATEST(a.valid_from, b.valid_from) AS overlap_from,
       LEAST(a.valid_to, b.valid_to) AS overlap_to
FROM tiers a
JOIN tiers b
  ON b.user_id = a.user_id
 AND (a.valid_from, a.tier) < (b.valid_from, b.tier)
 AND daterange(a.valid_from, a.valid_to) && daterange(b.valid_from, b.valid_to)
ORDER BY a.user_id, overlap_from`,
        hints: ['Self-join the history on user_id; order the pair so each one is reported once.', 'Two half-open intervals overlap when each starts before the other ends — or use `daterange(valid_from, valid_to) && …`, where a NULL upper bound means unbounded.'],
        explanation: 'Only Ben’s bronze [Jan 12, ∞) and the bad silver [Feb 1, ∞) overlap, from Feb 1 with no end. Adjacent versions like Asha’s bronze [Jan 5, Jan 21) and silver [Jan 21, Mar 1) touch but do not overlap — exactly why intervals are half-open. LEAST ignores NULLs in Postgres, so an open end yields the other end (or NULL when both are open). In production, run this as a data test (dbt) or prevent it with an exclusion constraint.',
      },
    ],
    judgment: [
      {
        id: 'scd-judge-open-end',
        kind: 'spot-bug',
        title: 'Where did gold go?',
        context: 'The “revenue by tier at order time” tile shows only silver and bronze, and the total is far below the paid revenue in the finance report. Find the bug.',
        sql: `SELECT t.tier, SUM(o.amount) AS revenue
FROM orders o
JOIN customer_tiers t
  ON t.user_id = o.user_id
 AND o.ordered_at >= t.valid_from
 AND o.ordered_at < t.valid_to
WHERE o.status = 'paid'
GROUP BY t.tier
ORDER BY revenue DESC`,
        bugLines: [6],
        options: [
          {
            text: 'Current versions have valid_to = NULL; `ordered_at < NULL` is never true, so every order placed in a customer’s current tier is dropped.',
            correct: true,
            why: 'Gold exists only as current rows, so it vanishes; Ben’s bronze orders and Dana’s March silver order are lost too. Fixed: silver 2080, bronze 1155, gold 150 (customers without any tier still need a LEFT JOIN to appear).',
          },
          { text: 'It should use `o.ordered_at BETWEEN t.valid_from AND t.valid_to`.', why: 'BETWEEN has the same NULL problem and additionally double-matches facts exactly on a boundary.' },
          { text: 'It needs `AND t.is_current` so each order matches one row.', why: 'That would give every order today’s tier — a different bug.' },
          { text: 'Comparing a timestamp with a date column is invalid.', why: 'Postgres casts the date to midnight and compares; the comparison is fine.' },
        ],
        fixedSql: `SELECT t.tier, SUM(o.amount) AS revenue
FROM orders o
JOIN customer_tiers t
  ON t.user_id = o.user_id
 AND o.ordered_at >= t.valid_from
 AND (t.valid_to IS NULL OR o.ordered_at < t.valid_to)
WHERE o.status = 'paid'
GROUP BY t.tier
ORDER BY revenue DESC`,
        lesson: 'Every predicate on valid_to must say what happens when it is NULL — or store \'infinity\' so it never is.',
      },
    ],
    recall: [
      { q: 'SCD1 vs SCD2 vs daily snapshots?', a: 'SCD1 overwrites (no history). SCD2 adds a row per version with valid_from/valid_to (+ is_current). Snapshots copy the whole table per date — simple to query, expensive to store.' },
      { q: 'Write the as-of join predicate for a half-open SCD2 table with NULL for the current row.', a: 'd.key = f.key AND f.ts >= d.valid_from AND (d.valid_to IS NULL OR f.ts < d.valid_to)' },
      { q: 'Why half-open intervals?', a: 'Consecutive versions share the boundary (prev.valid_to = next.valid_from) and every instant belongs to exactly one version; BETWEEN would match both on the boundary.' },
      { q: 'How does a dbt snapshot maintain SCD2?', a: 'Each run detects changed rows (timestamp strategy via updated_at, or check strategy via check_cols), closes the old version by setting dbt_valid_to, and inserts the new one with dbt_valid_from and NULL dbt_valid_to — via MERGE.' },
      { q: 'How can Postgres prevent overlapping versions?', a: 'An exclusion constraint: EXCLUDE USING gist (key WITH =, daterange(valid_from, valid_to) WITH &&) with btree_gist; plus a partial unique index on key WHERE valid_to IS NULL for one current row.' },
    ],
    transfer: [
      {
        id: 'scd-t-fx',
        scenario: 'Payments in many currencies must be reported in EUR using the exchange rate that applied on the payment date; rates are stored as `fx_rates(currency, rate, valid_from, valid_to)`.',
        approach: 'As-of join payments to fx_rates on currency and payment time inside [valid_from, valid_to) with the open-end branch; multiply. Add a data test that each currency has no overlaps/gaps, otherwise payments silently disappear or double.',
      },
      {
        id: 'scd-t-plan-history',
        scenario: 'The subscriptions table is updated in place when a customer changes plan. Analysts now need MRR by the plan customers were on each month of last year.',
        approach: 'The source is SCD1, so history must be captured going forward: a dbt snapshot (timestamp strategy on updated_at) or nightly full snapshots. Then join each month-end date to the version valid on that date. Past history cannot be reconstructed unless an audit/CDC log exists.',
      },
    ],
    confusable: ['outer-join-filters', 'joins-fanout', 'dedup-latest', 'self-joins'],
  },
];
