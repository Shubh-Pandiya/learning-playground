import type { Predict } from '../../types';

/* ── Model ─────────────────────────────────────────────────────────────
   A plan is an ordered list of step cards. We replay it against a tiny
   state machine of the table, with a rolling deploy in the middle:
   before the deploy step only app v1 serves traffic, during it v1 and v2
   pods run side by side (~4 min), afterwards only v2. For every row we
   ask: can v1 / v2 still read and write, and does the step take a lock
   that stalls live traffic? */

export type Col = 'v1r' | 'v1w' | 'v2r' | 'v2w' | 'lock';
export const COLS: { key: Col; label: string }[] = [
  { key: 'v1r', label: 'v1 reads' },
  { key: 'v1w', label: 'v1 writes' },
  { key: 'v2r', label: 'v2 reads' },
  { key: 'v2w', label: 'v2 writes' },
  { key: 'lock', label: 'lock risk' },
];

export type CellS = 'ok' | 'warn' | 'bad' | 'na';
export interface Cell {
  s: CellS;
  why: string;
}
export type Phase = 'v1' | 'both' | 'v2';
export type Fill = 'none' | 'racy' | 'done';

export interface MigState {
  /** old column(s) still exist */
  old: boolean;
  /** new column / table exists */
  neu: boolean;
  /** two-way sync (trigger / dual write) active */
  sync: boolean;
  fill: Fill;
  fk: boolean;
  idx: boolean;
  nn: boolean;
  swapped: boolean;
}

interface Outcome {
  state?: Partial<MigState>;
  fail?: string;
  lock: Cell;
  /** live traffic stalls behind this step's lock */
  blocks?: 'writes' | 'all';
  /** force the phase this step runs in (e.g. a pre-deploy migration of the v2 release) */
  phase?: Phase;
  cells?: Partial<Record<Col, Cell>>;
}

export interface StepCard {
  id: string;
  title: string;
  sql: string;
  trap?: boolean;
  deploy?: boolean;
  /** shown after a check: why this step is needed, or why it is a trap */
  why: string;
  run: (s: MigState) => Outcome;
}

export type ScenarioId = 'rename' | 'split' | 'bigint';

export interface Scenario {
  id: ScenarioId;
  exId: string;
  title: string;
  short: string;
  table: string;
  context: string[];
  predict: Predict;
  steps: StepCard[];
  /** initial shuffled pool order */
  pool: string[];
  /** a correct order, revealed on demand */
  solution: string[];
  initial: MigState;
  health: (s: MigState, live: { v1: boolean; v2: boolean }) => Record<Exclude<Col, 'lock'>, Cell>;
}

export const ROLLOUT_MIN = 4;

const ok = (why: string): Cell => ({ s: 'ok', why });
const bad = (why: string): Cell => ({ s: 'bad', why });
const warn = (why: string): Cell => ({ s: 'warn', why });
const NA_V2: Cell = { s: 'na', why: 'v2 is not deployed yet.' };
const NA_V1: Cell = { s: 'na', why: 'All v1 pods have been drained.' };

const BASE: MigState = { old: true, neu: false, sync: false, fill: 'none', fk: false, idx: false, nn: false, swapped: false };

const briefLock = (what: string) => ok(`${what} Run it with \`SET lock_timeout = '3s'\` and retry, so it can’t queue behind a long query and stall everyone behind it.`);

/* ── Scenario 1 · rename fullname → display_name ──────────────────────── */

const rename: Scenario = {
  id: 'rename',
  exId: 'migrate-rename',
  title: 'Rename `users.fullname` → `display_name`',
  short: 'rename column',
  table: 'users · 500M rows · ~3k writes/s · Postgres 16',
  context: [
    'Product wants `display_name`. 40 app pods read and write `fullname` on every request; a rolling deploy takes **~4 min**, so old and new pods overlap.',
    'Goal: rename with zero 500s, zero lost writes and no long locks.',
  ],
  predict: {
    question: 'During the ~4-minute rolling deploy of app v2, which code is serving traffic against the database?',
    options: ['Only v2: Kubernetes swaps all pods at once', 'v1 and v2 at the same time: some pods are old, some new', 'Nothing: there is a brief maintenance window', 'Only v1 until the migration finishes'],
    answer: 1,
    explain: 'A rolling deploy replaces pods gradually. For minutes, **v1 and v2 hit the same schema**. Every schema state in the plan must work for both, which is why a one-shot rename breaks whoever doesn’t know the new name.',
  },
  initial: BASE,
  steps: [
    {
      id: 'add',
      title: 'Expand: add the new column',
      sql: 'ALTER TABLE users ADD COLUMN display_name text;',
      why: 'Nullable, no default: a metadata-only change, instant on 500M rows.',
      run: (s) => (s.neu ? { fail: 'ERROR: column "display_name" already exists.', lock: ok('') } : { state: { neu: true }, lock: briefLock('Brief ACCESS EXCLUSIVE, metadata only.') }),
    },
    {
      id: 'sync',
      title: 'Sync both columns with a trigger',
      sql: `CREATE TRIGGER users_sync_name BEFORE INSERT OR UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION sync_fullname_display_name();
-- copies whichever column changed into the other`,
      why: 'Dual-write: while v1 (writes `fullname`) and v2 (writes `display_name`) overlap, each sees the other’s writes. GitLab’s `rename_column_concurrently` does exactly this.',
      run: (s) =>
        !s.neu ? { fail: 'ERROR: column "display_name" does not exist (the trigger function references it).', lock: ok('') } : { state: { sync: true }, lock: ok('CREATE TRIGGER takes a brief SHARE ROW EXCLUSIVE lock.') },
    },
    {
      id: 'backfill',
      title: 'Backfill in batches',
      sql: `UPDATE users SET display_name = fullname
WHERE id BETWEEN $1 AND $1 + 9999 AND display_name IS NULL;
-- 10k rows per transaction, sleep on replica lag`,
      why: 'Small transactions: row locks held for milliseconds, WAL spread out, autovacuum keeps up, and a failure loses one batch.',
      run: (s) =>
        !s.neu
          ? { fail: 'ERROR: column "display_name" does not exist.', lock: ok('') }
          : { state: { fill: s.sync ? 'done' : 'racy' }, lock: ok('10k rows per transaction: row locks last milliseconds, throttled on replica lag.') },
    },
    {
      id: 'deploy',
      title: 'Rolling deploy of app v2',
      sql: '-- v2 reads and writes display_name\nkubectl rollout restart deploy/api   # ~4 min',
      deploy: true,
      why: 'Ship the code only once the schema already supports both versions.',
      run: () => ({ lock: ok('No DDL.') }),
    },
    {
      id: 'contract',
      title: 'Contract (next release): drop trigger + old column',
      sql: `DROP TRIGGER users_sync_name ON users;
ALTER TABLE users DROP COLUMN fullname;`,
      why: 'Only after no running code references `fullname`. DROP COLUMN is metadata-only; space is reclaimed as rows are rewritten.',
      run: (s) => (!s.old ? { fail: 'ERROR: column "fullname" does not exist.', lock: ok('') } : { state: { old: false, sync: false }, lock: briefLock('Brief ACCESS EXCLUSIVE, metadata only.') }),
    },
    {
      id: 'rename1',
      title: 'RENAME COLUMN and ship v2 in one deploy',
      sql: 'ALTER TABLE users RENAME COLUMN fullname TO display_name;\n-- runs as the v2 release’s pre-deploy migration',
      trap: true,
      why: 'The rename itself is instant, but v1 pods keep sending `fullname` for the whole rollout.',
      run: (s) =>
        !s.old || s.neu
          ? { fail: 'ERROR: cannot rename: target column already exists or source column is gone.', lock: ok('') }
          : { state: { old: false, neu: true, fill: 'done' }, phase: 'both', lock: ok('RENAME is metadata-only: the lock is not the problem here, the app is.') },
    },
    {
      id: 'backfill1',
      title: 'Backfill in one transaction',
      sql: 'UPDATE users SET display_name = fullname;',
      trap: true,
      why: 'One 500M-row UPDATE: every row locked until commit, ~100 GB of WAL at once, 500M dead tuples.',
      run: (s) =>
        !s.neu
          ? { fail: 'ERROR: column "display_name" does not exist.', lock: ok('') }
          : {
              state: { fill: s.sync ? 'done' : 'racy' },
              blocks: 'writes',
              lock: bad(
                'One UPDATE of 500M rows holds a row lock on every user for **~45 min**. Any profile edit waits on it until the pool runs out and requests time out. Also: ~100 GB of WAL at once, replicas lag, and the table doubles in size from 500M dead tuples.',
              ),
            },
    },
    {
      id: 'dropsame',
      title: 'Drop `fullname` in the same release as v2',
      sql: 'DROP TRIGGER IF EXISTS users_sync_name ON users;\nALTER TABLE users DROP COLUMN fullname;\n-- pre-deploy migration of the v2 release',
      trap: true,
      why: 'Pre-deploy migrations run while v1 is still serving 100% of traffic.',
      run: (s) => (!s.old ? { fail: 'ERROR: column "fullname" does not exist.', lock: ok('') } : { state: { old: false, sync: false }, phase: 'both', lock: ok('Brief ACCESS EXCLUSIVE, metadata only.') }),
    },
  ],
  pool: ['backfill1', 'deploy', 'add', 'dropsame', 'contract', 'rename1', 'backfill', 'sync'],
  solution: ['add', 'sync', 'backfill', 'deploy', 'contract'],
  health: (s, live) => ({
    v1r: !live.v1 ? NA_V1 : s.old ? ok('SELECT fullname ✓') : bad(`SELECT fullname → ERROR: column "fullname" does not exist → v1 pods return 500 on every profile read for the ~${ROLLOUT_MIN} min they keep serving.`),
    v1w: !live.v1
      ? NA_V1
      : !s.old
        ? bad(`v1 pods INSERT/UPDATE into the dropped column → 500s on sign-up and profile edit for ${ROLLOUT_MIN} minutes.`)
        : live.v2 && !s.sync
          ? bad('v1 writes `fullname` only. Users served by v2 pods see the **old name**: their edit is invisible to v2.')
          : ok(s.sync ? 'Writes fullname; trigger mirrors it into display_name.' : 'Writes fullname.'),
    v2r: !live.v2
      ? NA_V2
      : !s.neu
        ? bad('SELECT display_name → column does not exist → 500s.')
        : s.fill === 'none'
          ? bad('Existing 500M users have `display_name = NULL` (never backfilled) → blank names everywhere.')
          : s.fill === 'racy'
            ? bad('Users who edited their name between their batch being copied and the trigger existing show a **stale** display_name. Create the sync trigger before backfilling.')
            : ok('SELECT display_name ✓ (all rows backfilled)'),
    v2w: !live.v2
      ? NA_V2
      : !s.neu
        ? bad('INSERT … (display_name) → column does not exist → 500s.')
        : live.v1 && !s.sync
          ? bad('v2 writes `display_name` only; v1 pods still read `fullname` and show the old value.')
          : ok(live.v1 ? 'Writes display_name; trigger mirrors it into fullname for v1.' : 'Writes display_name.'),
  }),
};

/* ── Scenario 2 · split address columns into addresses ────────────────── */

const split: Scenario = {
  id: 'split',
  exId: 'migrate-split',
  title: 'Split `users.street/city/zip` → `addresses`',
  short: 'split table',
  table: 'users · 500M rows · checkout reads the address on every order',
  context: [
    'Move the address columns into `addresses(user_id PK → users.id)` so users can later have several addresses.',
    'The checkout path must not show a blank or stale address at any point, and the FK must end up enforced.',
  ],
  predict: {
    question: 'You create `addresses` and copy all rows once. Users keep editing addresses on v1 during and after the copy. What keeps the two places consistent until v1 is gone?',
    options: ['Nothing needed: the copy is a snapshot', 'A sync mechanism (triggers or app dual-write) that mirrors every write both ways', 'Run the copy again after the deploy', 'A foreign key'],
    answer: 1,
    explain: 'A copy is a snapshot; writes after it are lost to the other side. Until the last v1 pod is gone, **both shapes are live** and every write must reach both: triggers or application dual-writes.',
  },
  initial: BASE,
  steps: [
    {
      id: 'create',
      title: 'Expand: create the new table',
      sql: `CREATE TABLE addresses (
  user_id bigint PRIMARY KEY,
  street text, city text, zip text
);`,
      why: 'A new empty table: no lock on `users`. The FK comes later, without a long lock.',
      run: (s) => (s.neu ? { fail: 'ERROR: relation "addresses" already exists.', lock: ok('') } : { state: { neu: true }, lock: ok('New empty table: no lock on users.') }),
    },
    {
      id: 'sync',
      title: 'Two-way sync triggers',
      sql: `-- on users: upsert the address into addresses
INSERT INTO addresses VALUES (NEW.id, NEW.street, NEW.city, NEW.zip)
ON CONFLICT (user_id) DO UPDATE SET street = EXCLUDED.street, …;
-- on addresses: UPDATE users SET street = NEW.street, … WHERE id = NEW.user_id`,
      why: 'Dual-write: v1 writes `users`, v2 writes `addresses`; triggers mirror both directions (guard against recursion with `pg_trigger_depth()`).',
      run: (s) => (!s.neu ? { fail: 'ERROR: relation "addresses" does not exist.', lock: ok('') } : { state: { sync: true }, lock: ok('CREATE TRIGGER: brief SHARE ROW EXCLUSIVE on both tables.') }),
    },
    {
      id: 'backfill',
      title: 'Backfill in batches',
      sql: `INSERT INTO addresses
SELECT id, street, city, zip FROM users
WHERE id BETWEEN $1 AND $1 + 9999
ON CONFLICT (user_id) DO NOTHING;`,
      why: '`DO NOTHING` skips rows the trigger already wrote (they are newer). Each batch commits in milliseconds.',
      run: (s) =>
        !s.neu ? { fail: 'ERROR: relation "addresses" does not exist.', lock: ok('') } : { state: { fill: s.sync ? 'done' : 'racy' }, lock: ok('10k users per transaction; short-lived and resumable.') },
    },
    {
      id: 'fk',
      title: 'Add FK as NOT VALID, then VALIDATE',
      sql: `ALTER TABLE addresses ADD CONSTRAINT addresses_user_fk
  FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;
ALTER TABLE addresses VALIDATE CONSTRAINT addresses_user_fk;`,
      why: '`NOT VALID` enforces new rows immediately with only a brief lock; `VALIDATE` scans old rows under SHARE UPDATE EXCLUSIVE, so reads and writes continue.',
      run: (s) =>
        !s.neu
          ? { fail: 'ERROR: relation "addresses" does not exist.', lock: ok('') }
          : { state: { fk: true }, lock: ok('NOT VALID: brief lock, no scan. VALIDATE: SHARE UPDATE EXCLUSIVE on addresses, ROW SHARE on users → traffic continues.') },
    },
    {
      id: 'deploy',
      title: 'Rolling deploy of app v2',
      sql: '-- v2: SELECT … FROM users JOIN addresses USING (user_id)\nkubectl rollout restart deploy/api   # ~4 min',
      deploy: true,
      why: 'Ship v2 once `addresses` is complete and kept in sync.',
      run: () => ({ lock: ok('No DDL.') }),
    },
    {
      id: 'contract',
      title: 'Contract (next release): drop triggers + old columns',
      sql: `DROP TRIGGER users_addr_sync ON users;
DROP TRIGGER addresses_sync ON addresses;
ALTER TABLE users DROP COLUMN street, DROP COLUMN city, DROP COLUMN zip;`,
      why: 'After the last v1 pod is gone.',
      run: (s) => (!s.old ? { fail: 'ERROR: column "street" does not exist.', lock: ok('') } : { state: { old: false, sync: false }, lock: briefLock('Brief ACCESS EXCLUSIVE, metadata only.') }),
    },
    {
      id: 'move1',
      title: 'Move it all in one migration',
      sql: `CREATE TABLE addresses AS SELECT id AS user_id, street, city, zip FROM users;
ALTER TABLE users DROP COLUMN street, DROP COLUMN city, DROP COLUMN zip;
-- pre-deploy migration of the v2 release`,
      trap: true,
      why: 'Big-bang: a 20-minute copy, then v1 loses its columns while it is still serving traffic.',
      run: (s) =>
        s.neu
          ? { fail: 'ERROR: relation "addresses" already exists.', lock: ok('') }
          : {
              state: { neu: true, old: false, fill: 'done' },
              phase: 'both',
              lock: warn('CTAS reads 500M rows in one ~20 min statement; the DROP then needs ACCESS EXCLUSIVE and queues behind every running query, and every new query queues behind it.'),
            },
    },
    {
      id: 'backfill1',
      title: 'Backfill with one INSERT … SELECT',
      sql: 'INSERT INTO addresses SELECT id, street, city, zip FROM users;',
      trap: true,
      why: 'A ~2-hour transaction that blocks trigger upserts and holds back vacuum for the whole database.',
      run: (s) =>
        !s.neu
          ? { fail: 'ERROR: relation "addresses" does not exist.', lock: ok('') }
          : {
              state: { fill: s.sync ? 'done' : 'racy' },
              blocks: 'writes',
              lock: bad(
                'One ~2 h transaction. Trigger upserts for users it already inserted **wait on its uncommitted unique-index entries**, so address edits hang until it commits. It holds back `xmin`: autovacuum can’t clean any table in the DB. A failure at 95% rolls back everything.',
              ),
            },
    },
    {
      id: 'fkinline',
      title: 'ADD FOREIGN KEY, validated inline',
      sql: 'ALTER TABLE addresses ADD CONSTRAINT addresses_user_fk\n  FOREIGN KEY (user_id) REFERENCES users(id);',
      trap: true,
      why: 'Validates all 500M rows while holding SHARE ROW EXCLUSIVE on **both** tables.',
      run: (s) =>
        !s.neu
          ? { fail: 'ERROR: relation "addresses" does not exist.', lock: ok('') }
          : {
              state: { fk: true },
              blocks: 'writes',
              lock: bad('Inline validation scans all of `addresses` holding SHARE ROW EXCLUSIVE on `users` and `addresses`: every INSERT/UPDATE/DELETE on users blocks for **~15 min** (sign-ups, logins that touch last_seen…).'),
            },
    },
    {
      id: 'dropsame',
      title: 'Drop the old columns in the same release as v2',
      sql: 'ALTER TABLE users DROP COLUMN street, DROP COLUMN city, DROP COLUMN zip;\n-- pre-deploy migration of the v2 release',
      trap: true,
      why: 'Runs while v1 is still serving 100% of traffic.',
      run: (s) => (!s.old ? { fail: 'ERROR: column "street" does not exist.', lock: ok('') } : { state: { old: false, sync: false }, phase: 'both', lock: ok('Brief ACCESS EXCLUSIVE, metadata only.') }),
    },
  ],
  pool: ['move1', 'sync', 'fkinline', 'deploy', 'backfill1', 'create', 'contract', 'fk', 'dropsame', 'backfill'],
  solution: ['create', 'sync', 'backfill', 'fk', 'deploy', 'contract'],
  health: (s, live) => ({
    v1r: !live.v1 ? NA_V1 : s.old ? ok('SELECT street, city, zip FROM users ✓') : bad(`SELECT street, city, zip FROM users → column does not exist → checkout 500s on every v1 pod for ${ROLLOUT_MIN} minutes.`),
    v1w: !live.v1
      ? NA_V1
      : !s.old
        ? bad(`v1 pods UPDATE users SET city = … → column does not exist → 500s for ${ROLLOUT_MIN} minutes.`)
        : live.v2 && !s.sync
          ? bad('v1 updates `users.city` only; v2 reads `addresses` → parcels ship to the **old address**.')
          : ok(s.sync ? 'Writes users.*; trigger mirrors into addresses.' : 'Writes users.street/city/zip.'),
    v2r: !live.v2
      ? NA_V2
      : !s.neu
        ? bad('JOIN addresses → relation does not exist → 500s.')
        : s.fill === 'none'
          ? bad('`addresses` was never backfilled: existing users have **no address** at checkout.')
          : s.fill === 'racy'
            ? bad('Addresses edited between their batch copy and the trigger’s creation are **stale** in `addresses`. Create the sync before the backfill.')
            : ok('JOIN addresses ✓'),
    v2w: !live.v2
      ? NA_V2
      : !s.neu
        ? bad('INSERT INTO addresses → relation does not exist → 500s.')
        : live.v1 && !s.sync
          ? bad('v2 writes `addresses` only; v1 pods read `users.city` and show the old address.')
          : !s.fk
            ? warn('Works, but there is no FK yet: an address for a deleted user can be inserted (orphans).')
            : ok('Writes addresses (FK enforced).'),
  }),
};

const SEQ_ONLY = 'False fix: the sequence can now return 2,147,483,648, but the column is still int4 → `integer out of range` on INSERT at the same moment. Nothing changed.';

/* ── Scenario 3 · widen orders.id int → bigint ────────────────────────── */

const bigint: Scenario = {
  id: 'bigint',
  exId: 'migrate-bigint',
  title: 'Widen `orders.id` int → bigint before overflow',
  short: 'int → bigint',
  table: 'orders · 1.9B of 2,147,483,647 ids used · ~6M orders/day · ~40 days left',
  context: [
    '`orders.id` is `int4` with a sequence. At 2³¹−1 every INSERT fails with `integer out of range`. ~40 days of headroom.',
    'Goal: a `bigint` primary key with no outage: build a shadow column, then swap in one short transaction.',
  ],
  predict: {
    question: '`ALTER TABLE orders ALTER COLUMN id TYPE bigint;` on 500M rows. What happens to live traffic?',
    options: ['Nothing: Postgres widens ints in place', 'Writes pause for a second', 'The whole table and all its indexes are rewritten under ACCESS EXCLUSIVE: reads and writes block for hours', 'Only new rows become bigint'],
    answer: 2,
    explain: 'int4 → int8 changes the on-disk width, so Postgres **rewrites every row and rebuilds every index** while holding ACCESS EXCLUSIVE. Even SELECTs queue. Hence the shadow-column + swap dance.',
  },
  initial: BASE,
  steps: [
    {
      id: 'add',
      title: 'Add shadow column `id_new bigint`',
      sql: 'ALTER TABLE orders ADD COLUMN id_new bigint;',
      why: 'Nullable, no default: metadata-only.',
      run: (s) => (s.neu ? { fail: 'ERROR: column "id_new" already exists.', lock: ok('') } : { state: { neu: true }, lock: briefLock('Brief ACCESS EXCLUSIVE, metadata only.') }),
    },
    {
      id: 'sync',
      title: 'Trigger: copy id into id_new on write',
      sql: `CREATE TRIGGER orders_id_sync BEFORE INSERT OR UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION set_id_new();  -- NEW.id_new := NEW.id`,
      why: 'Every new order gets `id_new` without any app change.',
      run: (s) => (!s.neu ? { fail: 'ERROR: column "id_new" does not exist.', lock: ok('') } : { state: { sync: true }, lock: ok('CREATE TRIGGER: brief SHARE ROW EXCLUSIVE.') }),
    },
    {
      id: 'backfill',
      title: 'Backfill id_new in batches',
      sql: `UPDATE orders SET id_new = id
WHERE id BETWEEN $1 AND $1 + 9999 AND id_new IS NULL;`,
      why: 'Resumable, short transactions, throttled on replica lag.',
      run: (s) => (!s.neu ? { fail: 'ERROR: column "id_new" does not exist.', lock: ok('') } : { state: { fill: s.sync ? 'done' : 'racy' }, lock: ok('10k rows per transaction.') }),
    },
    {
      id: 'index',
      title: 'Build the unique index CONCURRENTLY',
      sql: 'CREATE UNIQUE INDEX CONCURRENTLY orders_id_new_uq ON orders (id_new);',
      why: 'Becomes the new PK later via `USING INDEX`, so the swap doesn’t build an index under lock.',
      run: (s) =>
        !s.neu
          ? { fail: 'ERROR: column "id_new" does not exist.', lock: ok('') }
          : { state: { idx: true }, lock: ok('SHARE UPDATE EXCLUSIVE: reads and writes continue. Two table scans; not allowed inside a transaction; on failure it leaves an INVALID index to drop and retry.') },
    },
    {
      id: 'check',
      title: 'CHECK (id_new IS NOT NULL) NOT VALID, then VALIDATE',
      sql: `ALTER TABLE orders ADD CONSTRAINT id_new_nn
  CHECK (id_new IS NOT NULL) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT id_new_nn;`,
      why: 'A validated CHECK lets `SET NOT NULL` skip its full-table scan (Postgres 12+).',
      run: (s) =>
        !s.neu
          ? { fail: 'ERROR: column "id_new" does not exist.', lock: ok('') }
          : s.fill !== 'done'
            ? {
                fail:
                  s.fill === 'none'
                    ? `VALIDATE CONSTRAINT fails: check constraint "id_new_nn" is violated by some row (backfill hasn’t run).${s.sync ? '' : ' Worse, with no trigger the NOT VALID check already rejects every new INSERT that lacks id_new.'}`
                    : 'VALIDATE CONSTRAINT fails: orders inserted after their batch but before the trigger existed have id_new NULL.',
                lock: ok(''),
              }
            : { state: { nn: true }, lock: ok('NOT VALID: brief lock. VALIDATE: SHARE UPDATE EXCLUSIVE, traffic continues.') },
    },
    {
      id: 'deploy',
      title: 'Rolling deploy of app v2 (int64 ids)',
      sql: '-- v2 parses order ids as int64 (Java long, Go int64, JSON string)\nkubectl rollout restart deploy/api   # ~4 min',
      deploy: true,
      why: 'Clients must handle ids > 2³¹−1 **before** the database can hand one out.',
      run: () => ({ lock: ok('No DDL.') }),
    },
    {
      id: 'swap',
      title: 'Swap in one short transaction',
      sql: `BEGIN;
SET LOCAL lock_timeout = '2s';            -- give up + retry, don't queue
ALTER TABLE orders ALTER id_new SET NOT NULL;   -- instant: valid CHECK
ALTER TABLE orders DROP CONSTRAINT orders_pkey,
  ADD CONSTRAINT orders_pkey PRIMARY KEY USING INDEX orders_id_new_uq;
ALTER SEQUENCE orders_id_seq AS bigint;
ALTER TABLE orders ALTER id_new SET DEFAULT nextval('orders_id_seq'),
  ALTER id DROP DEFAULT, ALTER id DROP NOT NULL;
ALTER TABLE orders RENAME id TO id_old;
ALTER TABLE orders RENAME id_new TO id;
DROP TRIGGER orders_id_sync ON orders;
COMMIT;`,
      why: 'Every statement is metadata-only thanks to the prepared index and CHECK, so ACCESS EXCLUSIVE is held for ~50 ms.',
      run: (s) => {
        if (s.swapped) return { fail: 'ERROR: id is already bigint.', lock: ok('') };
        if (!s.neu) return { fail: 'ERROR: column "id_new" does not exist.', lock: ok('') };
        if (s.fill !== 'done') return { fail: 'SET NOT NULL fails: column "id_new" contains null values (backfill incomplete or raced the trigger).', lock: ok('') };
        const slow = [!s.idx && 'ADD PRIMARY KEY builds a 500M-row index (~25 min)', !s.nn && 'SET NOT NULL scans all 500M rows (~8 min)'].filter(Boolean) as string[];
        return {
          state: { swapped: true, sync: false },
          blocks: slow.length ? 'all' : undefined,
          lock: slow.length ? bad(`Inside the swap, under ACCESS EXCLUSIVE: ${slow.join('; ')}. Reads and writes block the whole time.`) : ok('ACCESS EXCLUSIVE for ~50 ms; `lock_timeout` makes it retry instead of queueing every query behind it.'),
        };
      },
    },
    {
      id: 'contract',
      title: 'Contract (later release): drop id_old',
      sql: 'ALTER TABLE orders DROP COLUMN id_old;',
      why: 'Keep it a while as a rollback path; dropping is metadata-only.',
      run: (s) => (!s.swapped ? { fail: 'ERROR: column "id_old" does not exist (no swap yet).', lock: ok('') } : { lock: briefLock('Brief ACCESS EXCLUSIVE, metadata only.') }),
    },
    {
      id: 'altertype',
      title: 'ALTER COLUMN TYPE bigint in place',
      sql: 'ALTER TABLE orders ALTER COLUMN id TYPE bigint;',
      trap: true,
      why: 'Rewrites the table and every index under ACCESS EXCLUSIVE.',
      run: (s) =>
        s.swapped
          ? { fail: 'ERROR: id is already bigint.', lock: ok('') }
          : {
              state: { swapped: true },
              blocks: 'all',
              lock: bad('Rewrites all 500M rows and rebuilds every index while holding **ACCESS EXCLUSIVE for ~3 h**: even SELECTs queue. A full outage of the orders service.'),
            },
    },
    {
      id: 'indexplain',
      title: 'CREATE UNIQUE INDEX (no CONCURRENTLY)',
      sql: 'CREATE UNIQUE INDEX orders_id_new_uq ON orders (id_new);',
      trap: true,
      why: 'A plain index build takes a SHARE lock: reads continue, writes block.',
      run: (s) =>
        !s.neu
          ? { fail: 'ERROR: column "id_new" does not exist.', lock: ok('') }
          : { state: { idx: true }, blocks: 'writes', lock: bad('SHARE lock for the **~25 min** build: every INSERT/UPDATE on orders blocks. No new orders for 25 minutes.') },
    },
    {
      id: 'notnull',
      title: 'SET NOT NULL directly',
      sql: 'ALTER TABLE orders ALTER COLUMN id_new SET NOT NULL;',
      trap: true,
      why: 'Without a validated CHECK, Postgres proves NOT NULL by scanning the table under ACCESS EXCLUSIVE.',
      run: (s) =>
        !s.neu
          ? { fail: 'ERROR: column "id_new" does not exist.', lock: ok('') }
          : s.fill !== 'done'
            ? { fail: 'ERROR: column "id_new" contains null values.', blocks: 'all', lock: bad('Scanned under ACCESS EXCLUSIVE, then failed.') }
            : { state: { nn: true }, blocks: 'all', lock: bad('Full scan of 500M rows under **ACCESS EXCLUSIVE (~8 min)**: reads and writes block.') },
    },
    {
      id: 'seqonly',
      title: 'ALTER SEQUENCE … AS bigint and call it done',
      sql: 'ALTER SEQUENCE orders_id_seq AS bigint;',
      trap: true,
      why: 'Fixes the sequence, not the column.',
      run: () => ({
        lock: ok('No meaningful lock.'),
        cells: {
          v1w: warn(SEQ_ONLY),
          v2w: warn(SEQ_ONLY),
        },
      }),
    },
  ],
  pool: ['notnull', 'swap', 'add', 'altertype', 'check', 'deploy', 'seqonly', 'backfill', 'indexplain', 'contract', 'sync', 'index'],
  solution: ['add', 'sync', 'backfill', 'index', 'check', 'deploy', 'swap', 'contract'],
  health: (s, live) => {
    const write = (who: 'v1' | 'v2'): Cell =>
      !s.swapped && s.neu && s.nn && !s.sync
        ? bad(`${who} INSERTs don’t set id_new and there is no trigger → CHECK (id_new IS NOT NULL) rejects **every new order**.`)
        : ok(s.swapped ? 'INSERT … RETURNING id (bigint) ✓' : s.sync ? 'INSERT ✓ (trigger fills id_new)' : 'INSERT ✓');
    return {
      v1r: !live.v1
        ? NA_V1
        : s.swapped
          ? bad('v1 still parses order ids as int32. Fine today, but the first id above 2,147,483,647 crashes v1’s parsing → ship the int64 app **before** the swap.')
          : ok('SELECT … WHERE id = $1 ✓'),
      v1w: !live.v1 ? NA_V1 : write('v1'),
      v2r: !live.v2 ? NA_V2 : ok('SELECT ✓ (int64-safe)'),
      v2w: !live.v2 ? NA_V2 : write('v2'),
    };
  },
};

export const SCENARIOS: Scenario[] = [rename, split, bigint];

/* ── Simulation ─────────────────────────────────────────────────────── */

export interface SimRow {
  id: string;
  title: string;
  phase: Phase;
  fail?: string;
  cells: Record<Col, Cell>;
}

export interface SimResult {
  rows: SimRow[];
  bad: number;
  warn: number;
  missing: StepCard[];
  trapsNotBinned: StepCard[];
  solved: boolean;
  final: MigState;
}

export function simulate(scn: Scenario, plan: string[], bin: string[]): SimResult {
  const byId = Object.fromEntries(scn.steps.map((s) => [s.id, s]));
  let s: MigState = { ...scn.initial };
  let deployed = false;
  const rows: SimRow[] = plan.map((id) => {
    const st = byId[id];
    const out = st.run(s);
    if (st.deploy) deployed = true;
    const phase: Phase = st.deploy ? 'both' : (out.phase ?? (deployed ? 'v2' : 'v1'));
    const live = { v1: phase !== 'v2', v2: phase !== 'v1' };
    if (out.fail) {
      const na: Cell = { s: 'na', why: 'Migration aborted.' };
      return { id, title: st.title, phase, fail: out.fail, cells: { v1r: na, v1w: na, v2r: na, v2w: na, lock: bad(out.fail) } };
    }
    s = { ...s, ...out.state };
    const h = scn.health(s, live);
    const cells: Record<Col, Cell> = { ...h, lock: out.lock };
    if (out.blocks) {
      const stalled = bad(`Blocked behind this step’s lock: requests queue, the connection pool runs dry, users get timeouts.`);
      const keys: Col[] = out.blocks === 'all' ? ['v1r', 'v1w', 'v2r', 'v2w'] : ['v1w', 'v2w'];
      for (const k of keys) if (cells[k].s !== 'na') cells[k] = stalled;
    }
    if (out.cells) for (const [k, c] of Object.entries(out.cells) as [Col, Cell][]) if (cells[k].s !== 'na') cells[k] = c;
    return { id, title: st.title, phase, cells };
  });
  let badN = 0;
  let warnN = 0;
  for (const r of rows)
    for (const c of Object.values(r.cells)) {
      if (c.s === 'bad') badN++;
      if (c.s === 'warn') warnN++;
    }
  const missing = scn.steps.filter((st) => !st.trap && !plan.includes(st.id));
  const trapsNotBinned = scn.steps.filter((st) => st.trap && !bin.includes(st.id));
  return { rows, bad: badN, warn: warnN, missing, trapsNotBinned, solved: badN === 0 && missing.length === 0 && trapsNotBinned.length === 0 && plan.length > 0, final: s };
}

/** First failing cell, as a one-liner for ChangeCards. */
export function firstBreak(r: SimResult): { step: string; col: string; why: string } | null {
  for (const row of r.rows) {
    if (row.cells.lock.s === 'bad') return { step: row.title, col: 'lock risk', why: row.cells.lock.why };
    for (const c of COLS) {
      const cell = row.cells[c.key];
      if (cell.s === 'bad') return { step: row.title, col: c.label, why: cell.why };
    }
  }
  return null;
}
