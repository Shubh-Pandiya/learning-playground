import type { Predict } from '../../types';
import type { Flaw, STable } from './engine';

export interface ReviewSchema {
  id: number;
  exId: string;
  title: string;
  engine: string;
  pr: { number: number; title: string; author: string; body: string; requirements: string[] };
  tables: STable[];
  flaws: Flaw[];
  /** Why a spot that looks suspicious is actually fine (shown on false positives). */
  fine: Record<string, string>;
  predict: Predict;
  comment: string[];
}

export const SCHEMAS: ReviewSchema[] = [
  /* ───────────────────────── 1. payments ledger ───────────────────────── */
  {
    id: 1,
    exId: 'review-1',
    title: 'Payments ledger',
    engine: 'PostgreSQL 16',
    pr: {
      number: 412,
      title: 'feat(payments): accounts, payments and double-entry ledger',
      author: 'dana',
      body: 'Adds the core payment tables. Mobile clients retry on timeout and send an `Idempotency-Key` header. Finance reconciles the ledger to the cent every night.',
      requirements: [
        'A retried request must never charge twice',
        'Ledger must balance to the cent (debits = credits)',
        'Users and servers in 9 countries',
        'Account statement page: entries for one account, newest first',
      ],
    },
    tables: [
      {
        name: 'accounts',
        cols: [
          { name: 'id', type: 'bigint', flags: ['PK', 'IDENTITY'] },
          { name: 'owner_id', type: 'bigint', flags: ['NN', 'FK'] },
          { name: 'currency', type: 'char(3)', flags: ['NN'], sample: "'EUR'" },
          { name: 'created_at', type: 'timestamptz', flags: ['NN'] },
        ],
        extra: ['accounts_owner_id_idx (owner_id)'],
      },
      {
        name: 'payments',
        cols: [
          { name: 'id', type: 'bigint', flags: ['PK', 'IDENTITY'] },
          { name: 'account_id', type: 'bigint', flags: ['NN', 'FK', 'IDX'] },
          { name: 'idempotency_key', type: 'text', flags: ['NN', 'IDX'], sample: "'9f2c…'" },
          { name: 'amount_cents', type: 'bigint', flags: ['NN'], sample: '1999' },
          { name: 'currency', type: 'char(3)', flags: ['NN'] },
          { name: 'status', type: 'payment_status', flags: ['NN'], sample: "enum: pending|succeeded|failed" },
          { name: 'provider_response', type: 'jsonb', flags: ['NULL'] },
          { name: 'created_at', type: 'timestamp', flags: ['NN', 'DEFAULT now()'] },
        ],
        extra: ['payments_account_id_idx (account_id)', 'payments_idempotency_key_idx (idempotency_key)', 'FK account_id → accounts (NO ACTION)'],
      },
      {
        name: 'ledger_entries',
        cols: [
          { name: 'id', type: 'bigint', flags: ['PK', 'IDENTITY'] },
          { name: 'payment_id', type: 'bigint', flags: ['NN', 'FK', 'IDX'] },
          { name: 'account_id', type: 'bigint', flags: ['NN', 'FK'] },
          { name: 'direction', type: 'text', flags: ['NN', 'CHECK'], sample: "IN ('debit','credit')" },
          { name: 'amount', type: 'double precision', flags: ['NN'], sample: '19.99' },
          { name: 'created_at', type: 'timestamptz', flags: ['NN'] },
        ],
        extra: ['ledger_entries_payment_id_idx (payment_id)', 'FK payment_id → payments (NO ACTION)', 'FK account_id → accounts (NO ACTION)'],
      },
    ],
    flaws: [
      {
        id: 'ledger-float',
        kind: 'float-money',
        targets: ['ledger_entries.amount'],
        anchor: 'ledger_entries.amount',
        title: '`ledger_entries.amount` is `double precision`',
        impact: 'Binary floating point cannot represent 0.10 exactly, so sums drift and rounding to cents goes wrong. The PR even stores `payments.amount_cents` correctly, so the two tables will disagree.',
        numbers: '`0.1 + 0.2 = 0.30000000000000004`. Summing 1M entries of 0.10 gives `100000.00000133288`. `floor(amount * 100)` loses a cent on 5.7% of prices (1.15 → 114): ~$573 drift per 1M transactions.',
        fix: `ALTER TABLE ledger_entries
  ALTER COLUMN amount TYPE bigint USING round(amount * 100)::bigint;
ALTER TABLE ledger_entries RENAME COLUMN amount TO amount_cents;
-- or: numeric(19,4) when you need sub-cent precision`,
        hood: 'IEEE 754 binary64 stores a 53-bit binary fraction; 0.1 is a repeating fraction in base 2. `numeric` is decimal and exact (slower arithmetic); `bigint` minor units are exact and fastest.',
      },
      {
        id: 'payments-idem',
        kind: 'missing-unique-idem',
        targets: ['payments.idempotency_key'],
        anchor: 'payments.idempotency_key',
        title: '`payments.idempotency_key` is indexed but not UNIQUE',
        impact: 'The app checks `SELECT … WHERE idempotency_key = $1` and then inserts. Two retries that arrive together both see nothing and both insert: a double charge. Only a unique index makes the check atomic.',
        numbers: 'If 0.05% of 1M daily payments are retried while the first attempt is still in flight, that is up to **500 double charges a day**.',
        fix: `DROP INDEX payments_idempotency_key_idx;
CREATE UNIQUE INDEX CONCURRENTLY payments_idem_uq
  ON payments (account_id, idempotency_key);
-- app: INSERT … ON CONFLICT (account_id, idempotency_key) DO NOTHING RETURNING id`,
        hood: 'Under READ COMMITTED, check-then-insert is a race. A unique B-tree insert makes the second writer wait for the first transaction, then fail (or hit `ON CONFLICT`). Stripe keeps keys for at least 24 h for the same reason.',
      },
      {
        id: 'ledger-fk-idx',
        kind: 'fk-no-index',
        targets: ['ledger_entries.account_id'],
        anchor: 'ledger_entries.account_id',
        title: '`ledger_entries.account_id` has no index',
        impact: 'The statement page filters by account and every account delete checks the FK: both seq-scan the whole ledger. Postgres indexes the parent key, never the child column.',
        numbers: 'At 50M ledger rows (~5 GB) each statement query reads ~5 GB instead of a few index pages: from ~1 ms to many seconds.',
        fix: `CREATE INDEX CONCURRENTLY ledger_entries_account_created_idx
  ON ledger_entries (account_id, created_at DESC);`,
        hood: 'FKs run as RI triggers. The child-side check (`SELECT 1 FROM ledger_entries WHERE account_id = $1 FOR KEY SHARE`) has no index to use. MySQL InnoDB creates one automatically; Postgres does not.',
      },
      {
        id: 'payments-ts',
        kind: 'timestamp-no-tz',
        targets: ['payments.created_at'],
        anchor: 'payments.created_at',
        title: '`payments.created_at` is `timestamp` (without time zone)',
        impact: '`now()` is converted to the **session** time zone and the zone is thrown away. Servers in 9 countries write local wall-clock times, so ordering, daily settlement cut-offs and SLA math are wrong. The other tables use `timestamptz`.',
        numbers: 'A Mumbai server (UTC+5:30) and a Virginia server (UTC−4) writing at the same instant store values **9.5 hours apart**. One DST night repeats 01:00–02:00, so an hour of rows is ambiguous.',
        fix: `ALTER TABLE payments
  ALTER COLUMN created_at TYPE timestamptz
  USING created_at AT TIME ZONE 'UTC';  -- if writers were UTC`,
        hood: '`timestamptz` is also 8 bytes. It stores a UTC instant and converts on input and output; `timestamp` stores the wall-clock digits.',
      },
    ],
    fine: {
      'payments.amount_cents': '`bigint` minor units: exact integer cents. This is the right money type.',
      'payments.provider_response': 'An opaque provider payload you store for debugging: JSONB is the right tool. Nothing filters or joins on it.',
      'accounts.currency': 'ISO 4217 codes are always 3 letters; `char(3)` is fine (a CHECK on the format would be a bonus).',
      'payments.status': 'Already a Postgres enum: values are constrained.',
      'ledger_entries.direction': 'Text with a CHECK constraint: constrained, fine.',
      'payments.account_id': 'Indexed FK (`payments_account_id_idx`): fine.',
      'ledger_entries.payment_id': 'Indexed FK: fine.',
    },
    predict: {
      question: 'A nightly job runs `SUM(amount)` over **1,000,000** ledger entries of `0.10`, stored as `double precision`. What does it return?',
      options: ['100000 exactly', '100000.00000133288', '99999.99', 'An overflow error'],
      answer: 1,
      explain: 'Each addition rounds to the nearest binary64 value; the error accumulates. Finance sees a ledger that is off by a fraction, then by cents after rounding.',
    },
    comment: [
      '**Request changes.** Nice structure; four things before this ships:',
      '1. `ledger_entries.amount` is `double precision`. Use `bigint` cents like `payments.amount_cents`; floats drift (1M × 0.10 sums to 100000.0000013).',
      '2. `idempotency_key` needs a **UNIQUE** index `(account_id, idempotency_key)` and `ON CONFLICT DO NOTHING`; a plain index does not stop concurrent retries.',
      '3. Add an index on `ledger_entries(account_id, created_at DESC)`. Postgres does not index FK children, and the statement page will seq-scan.',
      '4. `payments.created_at` should be `timestamptz` like the other tables.',
    ],
  },

  /* ───────────────────────── 2. SaaS users & teams ───────────────────────── */
  {
    id: 2,
    exId: 'review-2',
    title: 'SaaS users & teams',
    engine: 'PostgreSQL 16',
    pr: {
      number: 418,
      title: 'feat(accounts): users, teams and sessions',
      author: 'leo',
      body: 'Moves accounts out of the monolith. I kept everything we know about a user in one table so the profile page needs no joins.',
      requirements: [
        'Every user belongs to exactly one team',
        'Users can change their login email',
        'Teams are soft-deleted and restorable for 30 days; slugs are unique among live teams',
        'Admin list shows 5 columns for 1M users; every login updates `last_login_at`',
      ],
    },
    tables: [
      {
        name: 'teams',
        cols: [
          { name: 'id', type: 'bigint', flags: ['PK', 'IDENTITY'] },
          { name: 'slug', type: 'text', flags: ['NN', 'UQ'], sample: "'acme'" },
          { name: 'name', type: 'text', flags: ['NN'] },
          { name: 'plan', type: 'text', flags: ['NN', 'CHECK'], sample: "IN ('free','pro','enterprise')" },
          { name: 'deleted_at', type: 'timestamptz', flags: ['NULL'] },
          { name: 'created_at', type: 'timestamptz', flags: ['NN'] },
        ],
        extra: ['teams_slug_key UNIQUE (slug)'],
      },
      {
        name: 'users',
        note: '58 columns',
        cols: [
          { name: 'email', type: 'text', flags: ['PK'], sample: "'ana@acme.io'" },
          { name: 'team_id', type: 'bigint', flags: ['NULL', 'FK', 'IDX'] },
          { name: 'full_name', type: 'text', flags: ['NN'] },
          { name: 'password_hash', type: 'text', flags: ['NN'] },
          { name: 'last_login_at', type: 'timestamptz', flags: ['NULL'] },
          { name: 'avatar_url', type: 'text', flags: ['NULL'] },
        ],
        more: {
          count: 52,
          sample: ['pref_theme', 'pref_locale', 'notif_email_digest', 'notif_push_mentions', 'billing_line1', 'billing_vat_id', 'utm_source', 'last_login_ip', 'ff_new_editor', 'onboarding_step', '…'],
        },
        extra: ['users_team_id_idx (team_id)', 'FK team_id → teams'],
      },
      {
        name: 'sessions',
        cols: [
          { name: 'id', type: 'bigint', flags: ['PK', 'IDENTITY'] },
          { name: 'user_email', type: 'text', flags: ['NN', 'FK', 'IDX'] },
          { name: 'token_hash', type: 'bytea', flags: ['NN', 'UQ'] },
          { name: 'expires_at', type: 'timestamptz', flags: ['NN'] },
        ],
        extra: ['sessions_user_email_idx (user_email)', 'FK user_email → users(email) ON UPDATE CASCADE'],
      },
    ],
    flaws: [
      {
        id: 'users-email-pk',
        kind: 'mutable-pk',
        targets: ['users.email', 'sessions.user_email'],
        anchor: 'users.email',
        title: '`users.email` is the primary key, and emails change',
        impact: 'Every email change rewrites the PK and cascades to every referencing row (`sessions`, and later audit logs, invoices…), under row locks. External systems keyed by email (billing, analytics, support) silently lose the link. `Ana@acme.io` and `ana@acme.io` become two users.',
        numbers: 'A user with 40 sessions and 2,000 audit rows: one email change = **2,041 row rewrites** plus their index entries, instead of 1.',
        fix: `ALTER TABLE users ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY;
-- repoint FKs to users(id), then:
ALTER TABLE users DROP CONSTRAINT users_pkey, ADD PRIMARY KEY (id);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));`,
        hood: 'MVCC: each cascaded update writes a new tuple version and new index entries in every referencing table. A surrogate key never changes, so FKs never move.',
      },
      {
        id: 'users-team-null',
        kind: 'nullable-required-fk',
        targets: ['users.team_id'],
        anchor: 'users.team_id',
        title: '`users.team_id` is nullable, but every user must have a team',
        impact: 'Any code path that creates a user before assigning a team leaves an orphan. `JOIN teams` silently drops those users from seat counts and billing; `NOT IN (SELECT team_id …)` returns nothing once a NULL is present.',
        numbers: 'If 1% of 1M users slip through, **10,000 seats** are missing from invoices, with no error anywhere.',
        fix: `-- backfill orphans first, then without a long full-table lock:
ALTER TABLE users ADD CONSTRAINT users_team_nn
  CHECK (team_id IS NOT NULL) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT users_team_nn;
ALTER TABLE users ALTER COLUMN team_id SET NOT NULL;  -- uses the CHECK, no rescan`,
        hood: 'Since Postgres 12, `SET NOT NULL` skips the table scan when a validated CHECK already proves it. `VALIDATE` takes only a SHARE UPDATE EXCLUSIVE lock, so writes continue.',
      },
      {
        id: 'teams-slug-soft',
        kind: 'soft-delete-unique',
        targets: ['teams.slug', 'teams.deleted_at'],
        anchor: 'teams.slug',
        title: '`UNIQUE (slug)` also counts soft-deleted teams',
        impact: 'Once `acme` is soft-deleted, nobody can create a new `acme` for 30 days (and after purging, the restore window is gone). The requirement is "unique among **live** teams".',
        numbers: '`INSERT … slug = \'acme\'` → `ERROR: duplicate key value violates unique constraint "teams_slug_key"`.',
        fix: `ALTER TABLE teams DROP CONSTRAINT teams_slug_key;
CREATE UNIQUE INDEX teams_slug_live_uq
  ON teams (slug) WHERE deleted_at IS NULL;`,
        hood: 'A partial index stores only rows matching its WHERE clause, so deleted rows are not in it and cannot collide. Restoring a team re-checks uniqueness at that moment.',
      },
      {
        id: 'users-god',
        kind: 'god-table',
        targets: ['users.*'],
        anchor: 'users',
        title: '`users` is a 58-column god table',
        impact: 'Identity, preferences, notification settings, billing, marketing attribution and feature flags in one row. Every login rewrites the whole wide tuple (MVCC). Narrow reads such as the admin list pay for every column.',
        numbers: '~1.4 KB per row → **~5 rows per 8 KB page** vs ~60 for a 120-byte core row. Admin list of 1M users: ~1.6 GB scanned instead of ~130 MB. Each login writes 1.4 KB of new tuple.',
        fix: `-- keep users narrow (id, email, team_id, full_name, password_hash)
CREATE TABLE user_preferences (user_id bigint PRIMARY KEY REFERENCES users, theme text, locale text /* … */);
CREATE TABLE user_billing     (user_id bigint PRIMARY KEY REFERENCES users, line1 text, vat_id text /* … */);
CREATE TABLE user_activity    (user_id bigint PRIMARY KEY REFERENCES users, last_login_at timestamptz, last_login_ip inet);`,
        hood: 'Postgres has no in-place update: changing one column copies the whole tuple. HOT helps only if no indexed column changes and the page has room, and 5 fat tuples per page rarely leave room.',
      },
    ],
    fine: {
      'teams.plan': 'Text with a CHECK listing the allowed values: constrained and easy to extend. Not a free-text status.',
      'users.password_hash': '`text` is fine in Postgres; `varchar(n)` adds nothing but a length check.',
      'sessions.id': 'bigint identity: compact and sequential. Fine.',
      'sessions.token_hash': 'Hashed token with a UNIQUE constraint: correct.',
      'teams.id': 'Surrogate PK with a UNIQUE business key (slug): the standard pattern.',
      'users.last_login_at': 'The column is fine; the problem is that it lives in a 58-column row (god table).',
    },
    predict: {
      question: "Team `acme` was soft-deleted yesterday (`deleted_at` set). A new customer signs up with slug `acme`. What happens?",
      options: ['The row is inserted', 'The old team is restored', 'Postgres appends a suffix: acme-1', 'ERROR: duplicate key value violates unique constraint "teams_slug_key"'],
      answer: 3,
      explain: 'The unique index still contains the soft-deleted row. Uniqueness has to be scoped to live rows with a partial index.',
    },
    comment: [
      '**Request changes.** The one-table design will hurt us early:',
      '1. Don\'t make `email` the PK: users change it. Add `id bigint` identity, keep `UNIQUE (lower(email))`, and point `sessions` at `users(id)`.',
      '2. "Every user has a team" means `team_id NOT NULL` (CHECK … NOT VALID → VALIDATE → SET NOT NULL).',
      '3. Replace `UNIQUE (slug)` with `UNIQUE (slug) WHERE deleted_at IS NULL`, or `acme` is blocked for 30 days.',
      '4. Split the 58 columns: core `users` plus 1:1 `user_preferences`, `user_billing`, `user_activity`. Logins shouldn\'t rewrite 1.4 KB rows.',
    ],
  },

  /* ───────────────────────── 3. e-commerce catalog ───────────────────────── */
  {
    id: 3,
    exId: 'review-3',
    title: 'E-commerce catalog',
    engine: 'PostgreSQL 16',
    pr: {
      number: 431,
      title: 'feat(catalog): products, attributes, reviews and comments',
      author: 'priya',
      body: 'Flexible catalog: attributes are rows, so merchandisers can add new ones without migrations. Comments work on anything.',
      requirements: [
        '2M products; storefront shows only active products',
        'Filter by tag (`sale`, `eco`) and facet by brand, colour and weight',
        'Customers comment on products and on reviews',
        'Prices in many currencies',
      ],
    },
    tables: [
      {
        name: 'products',
        cols: [
          { name: 'id', type: 'bigint', flags: ['PK', 'IDENTITY'] },
          { name: 'sku', type: 'text', flags: ['NN', 'UQ'] },
          { name: 'title', type: 'text', flags: ['NN'] },
          { name: 'price_cents', type: 'bigint', flags: ['NN', 'CHECK'], sample: '>= 0' },
          { name: 'currency', type: 'char(3)', flags: ['NN'] },
          { name: 'tags', type: 'text', flags: ['NULL'], sample: "'sale,eco,kitchen'" },
          { name: 'status', type: 'text', flags: ['NN'], sample: "'active' · 'Active' · 'draft '" },
          { name: 'created_at', type: 'timestamptz', flags: ['NN'] },
        ],
        extra: ['products_sku_key UNIQUE (sku)', 'products_tags_idx (tags)'],
      },
      {
        name: 'product_attributes',
        cols: [
          { name: 'product_id', type: 'bigint', flags: ['PK', 'FK'] },
          { name: 'attr_name', type: 'text', flags: ['PK'], sample: "'brand' · 'color' · 'weight_g'" },
          { name: 'attr_value', type: 'text', flags: ['NN'], sample: "'Acme' · 'red' · '1.2kg'" },
        ],
        extra: ['PRIMARY KEY (product_id, attr_name)', 'FK product_id → products'],
      },
      {
        name: 'reviews',
        cols: [
          { name: 'id', type: 'bigint', flags: ['PK', 'IDENTITY'] },
          { name: 'product_id', type: 'bigint', flags: ['NN', 'FK', 'IDX'] },
          { name: 'rating', type: 'smallint', flags: ['NN', 'CHECK'], sample: 'BETWEEN 1 AND 5' },
          { name: 'body', type: 'text', flags: ['NN'] },
        ],
        extra: ['reviews_product_id_idx (product_id)'],
      },
      {
        name: 'comments',
        cols: [
          { name: 'id', type: 'bigint', flags: ['PK', 'IDENTITY'] },
          { name: 'commentable_type', type: 'text', flags: ['NN'], sample: "'Product' · 'Review'" },
          { name: 'commentable_id', type: 'bigint', flags: ['NN'] },
          { name: 'body', type: 'text', flags: ['NN'] },
        ],
        extra: ['comments_target_idx (commentable_type, commentable_id)', 'no foreign key'],
      },
    ],
    flaws: [
      {
        id: 'products-tags',
        kind: 'csv-list',
        targets: ['products.tags'],
        anchor: 'products.tags',
        title: '`products.tags` is a comma-separated string',
        impact: '"Products tagged sale" becomes `tags LIKE \'%sale%\'`: no B-tree can seek on a substring, it also matches `wholesale`, and nothing stops `Sale`, `sale ` or a deleted tag. Renaming a tag means rewriting every product string.',
        numbers: 'Each tag filter reads **all 2M rows (~250 MB)**; the `products_tags_idx` B-tree is never used for `%…%`.',
        fix: `CREATE TABLE tags (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL UNIQUE);
CREATE TABLE product_tags (
  product_id bigint REFERENCES products,
  tag_id     bigint REFERENCES tags,
  PRIMARY KEY (product_id, tag_id));
CREATE INDEX ON product_tags (tag_id, product_id);
-- lighter option: tags text[] + GIN index, WHERE tags @> '{sale}'`,
        hood: 'A B-tree orders whole values, so it can seek on a prefix (`LIKE \'sale%\'`) but not on a substring. A list in a cell also breaks 1NF: the database cannot see individual tags.',
      },
      {
        id: 'attrs-eav',
        kind: 'eav-core',
        targets: ['product_attributes.*'],
        anchor: 'product_attributes',
        title: '`product_attributes` is EAV for core attributes',
        impact: 'Brand, colour and weight are needed on every product and in every facet query, but here they are untyped strings with no NOT NULL, CHECK or FK. Weight comparisons need casts that fail on `\'1.2kg\'`. Each extra facet adds a self-join, and planner estimates are guesses.',
        numbers: '2M products × 3 attributes = **6M rows** plus ~24 B header each; brand + colour + weight filter = **3 self-joins** instead of one indexed WHERE.',
        fix: `ALTER TABLE products
  ADD COLUMN brand    text,
  ADD COLUMN color    text,
  ADD COLUMN weight_g integer CHECK (weight_g > 0);
-- backfill, then SET NOT NULL where required;
-- keep a jsonb "extra_attrs" for the true long tail`,
        hood: 'Column statistics are per column: with EAV, `attr_value` mixes brands, colours and weights in one histogram, so selectivity estimates are wrong and join orders suffer.',
      },
      {
        id: 'comments-poly',
        kind: 'polymorphic-fk',
        targets: ['comments.commentable_type', 'comments.commentable_id', 'comments'],
        anchor: 'comments.commentable_id',
        title: '`comments.commentable_type / commentable_id` is a polymorphic FK',
        impact: 'One column cannot reference two tables, so there is **no FK**: deleting a product leaves orphan comments, a typo like `\'product\'` silently points at nothing, and reads need a CASE or UNION per target type.',
        numbers: 'Nothing enforces integrity: every orphan has to be found by a cleanup job (`LEFT JOIN … WHERE p.id IS NULL`, once per type).',
        fix: `ALTER TABLE comments
  ADD COLUMN product_id bigint REFERENCES products,
  ADD COLUMN review_id  bigint REFERENCES reviews,
  ADD CONSTRAINT comments_one_target
    CHECK (num_nonnulls(product_id, review_id) = 1);
CREATE INDEX ON comments (product_id);
CREATE INDEX ON comments (review_id);`,
        hood: 'Rails popularised `commentable_type/id`. GitLab\'s database guide forbids polymorphic associations for exactly this reason: no FK and no clean index per target.',
      },
      {
        id: 'products-status',
        kind: 'free-text-status',
        targets: ['products.status'],
        anchor: 'products.status',
        title: '`products.status` is free text',
        impact: 'The sample data already holds `active`, `Active` and `draft `. `WHERE status = \'active\'` on the storefront hides the others, with no error.',
        numbers: 'If 7.5% of rows are mis-cased like the seed data, **150,000 of 2M products** vanish from the storefront.',
        fix: `UPDATE products SET status = lower(trim(status));
CREATE TYPE product_status AS ENUM ('draft', 'active', 'archived');
ALTER TABLE products
  ALTER COLUMN status TYPE product_status USING status::product_status;
-- or CHECK (status IN (…)), or a lookup table + FK`,
        hood: 'A Postgres enum value is 4 bytes and is compared by sort order; a CHECK keeps text but rejects unknown values. Either way, bad values fail at write time instead of hiding at read time.',
      },
    ],
    fine: {
      'products.price_cents': '`bigint` minor units with a CHECK: the right money type.',
      'products.sku': 'Business key with a UNIQUE constraint next to a surrogate PK: correct.',
      'products.currency': 'ISO 4217 code: `char(3)` is fine.',
      'reviews.product_id': 'Indexed FK (`reviews_product_id_idx`): fine.',
      'reviews.rating': 'smallint with a CHECK: constrained.',
      'product_attributes.product_id': 'Leading column of the composite PK, so the FK is indexed. The problem is EAV, not this key.',
    },
    predict: {
      question: "With a B-tree index on `tags`, what does `SELECT * FROM products WHERE tags LIKE '%sale%'` do on 2M rows?",
      options: ['Seq scan of all 2M rows, and it also matches `wholesale`', 'Index seek, reads a few pages', 'Index-only scan', 'An error: LIKE needs a GIN index'],
      answer: 0,
      explain: 'A leading wildcard gives the B-tree no prefix to seek, so Postgres reads the whole table. Substring matching also hits unrelated tags.',
    },
    comment: [
      '**Request changes.** Flexibility here costs us correctness:',
      '1. `tags` as CSV can\'t be indexed or constrained (`%sale%` also hits `wholesale`). Use `product_tags` (or `text[]` + GIN).',
      '2. Brand, colour and weight are core: make them typed columns. Keep EAV/jsonb only for the long tail.',
      '3. `commentable_type/id` can\'t have an FK. Use `product_id` / `review_id` with a `num_nonnulls(...) = 1` CHECK.',
      '4. `status` needs an enum or CHECK; the seed already has `Active` and `draft `.',
    ],
  },

  /* ───────────────────────── 4. analytics mart ───────────────────────── */
  {
    id: 4,
    exId: 'review-4',
    title: 'Analytics mart',
    engine: 'BigQuery + Postgres source',
    pr: {
      number: 77,
      title: 'feat(mart): order lines fact, customer and product dims',
      author: 'sam',
      body: 'First version of the sales mart. `orders` and `order_lines` sync nightly from the app DB with an incremental Airbyte connection; the dbt models build on top.',
      requirements: [
        'Revenue by product and day; shipping revenue by region',
        'Marketing wants customer age bands (18–24, 25–34, …)',
        'Refunds and cancellations must be reflected in revenue',
        'Nightly incremental sync, no full reloads (the orders table is 400M rows)',
      ],
    },
    tables: [
      {
        name: 'fact_order_lines',
        note: 'BigQuery',
        cols: [
          { name: 'order_id', type: 'STRING', flags: ['NN'] },
          { name: 'line_number', type: 'INT64', flags: ['NN'] },
          { name: 'order_date', type: 'DATE', flags: ['NN'] },
          { name: 'customer_key', type: 'INT64', flags: ['NN'] },
          { name: 'product_key', type: 'INT64', flags: ['NN'] },
          { name: 'quantity', type: 'INT64', flags: ['NN'] },
          { name: 'line_revenue', type: 'NUMERIC', flags: ['NN'] },
          { name: 'shipping_fee', type: 'NUMERIC', flags: ['NN'], sample: 'order fee, on each line' },
          { name: 'order_discount', type: 'NUMERIC', flags: ['NN'], sample: 'order total discount' },
        ],
        extra: ['PARTITION BY order_date', 'CLUSTER BY product_key', 'grain: one row per order line'],
      },
      {
        name: 'dim_customer',
        note: 'BigQuery',
        cols: [
          { name: 'customer_key', type: 'INT64', flags: ['NN'] },
          { name: 'customer_id', type: 'STRING', flags: ['NN'] },
          { name: 'region', type: 'STRING', flags: ['NN'] },
          { name: 'age', type: 'INT64', flags: ['NULL'], sample: '34' },
          { name: 'loaded_at', type: 'TIMESTAMP', flags: ['NN'] },
        ],
      },
      {
        name: 'dim_product',
        note: 'BigQuery',
        cols: [
          { name: 'product_key', type: 'INT64', flags: ['NN'] },
          { name: 'product_id', type: 'STRING', flags: ['NN'] },
          { name: 'name', type: 'STRING', flags: ['NN'] },
          { name: 'category', type: 'STRING', flags: ['NN'] },
          { name: 'category_group', type: 'STRING', flags: ['NN'] },
        ],
      },
      {
        name: 'orders',
        note: 'source · app Postgres',
        cols: [
          { name: 'id', type: 'bigint', flags: ['PK'] },
          { name: 'customer_id', type: 'bigint', flags: ['NN', 'FK', 'IDX'] },
          { name: 'status', type: 'order_status', flags: ['NN'], sample: 'paid → refunded' },
          { name: 'total_cents', type: 'bigint', flags: ['NN'] },
          { name: 'created_at', type: 'timestamptz', flags: ['NN', 'IDX'] },
        ],
        extra: ['Airbyte incremental, cursor = created_at', 'rows are updated on refund / cancel'],
      },
    ],
    flaws: [
      {
        id: 'fact-grain',
        kind: 'mixed-grain',
        targets: ['fact_order_lines.shipping_fee', 'fact_order_lines.order_discount', 'fact_order_lines'],
        anchor: 'fact_order_lines.shipping_fee',
        title: 'Order-level measures on a line-grain fact',
        impact: '`shipping_fee` and `order_discount` belong to the order, but the table has one row per line. Any `SUM` repeats them once per line, so shipping revenue and discounts are inflated and every analyst must remember to de-duplicate.',
        numbers: 'A 3-line order with a $10 fee sums to **$30**. At 2.7 lines per order on average, shipping revenue is reported at **2.7×** its real value.',
        fix: `-- option A: a fact at order grain
CREATE TABLE fact_orders (order_id STRING, order_date DATE, customer_key INT64,
  shipping_fee NUMERIC, order_discount NUMERIC);
-- option B: allocate to lines so sums are correct
-- shipping_fee_alloc = shipping_fee * line_revenue / order_revenue`,
        hood: 'Kimball: declare the grain first, and every measure must be true at that grain. Allocated measures must sum back exactly to the header (put any rounding remainder on one line).',
      },
      {
        id: 'dim-age',
        kind: 'age-not-dob',
        targets: ['dim_customer.age'],
        anchor: 'dim_customer.age',
        title: '`dim_customer.age` stores a value that changes every year',
        impact: 'Age is derived from birth date and today. It is right on load day and drifts afterwards; historical facts cannot be banded by age at the time of the order.',
        numbers: 'With 10-year bands, about **10% of customers** cross into a new band every year. After 12 months, every stored age is off by one.',
        fix: `ALTER TABLE dim_customer ADD COLUMN birth_date DATE;
-- age at order time, in the model:
-- DATE_DIFF(f.order_date, c.birth_date, YEAR)
--   - IF(FORMAT_DATE('%m%d', f.order_date) < FORMAT_DATE('%m%d', c.birth_date), 1, 0)`,
        hood: 'Store the stable fact (birth date), derive the volatile one at query time. `DATE_DIFF(…, YEAR)` counts year boundaries, so correct for the birthday not yet reached.',
      },
      {
        id: 'src-updated',
        kind: 'missing-updated-at',
        targets: ['orders.*'],
        anchor: 'orders',
        title: 'Source `orders` has no `updated_at` for the incremental sync',
        impact: 'Cursor-based sync asks `WHERE created_at > :last_cursor`, so it only ever sees **new** rows. When an order is refunded or cancelled, the change never reaches the mart.',
        numbers: 'With a 2% refund rate, reported revenue stays **~2% too high forever**, and the gap grows with every refund.',
        fix: `ALTER TABLE orders ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE FUNCTION touch() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER orders_touch BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION touch();
CREATE INDEX CONCURRENTLY ON orders (updated_at);
-- or switch to log-based CDC (Debezium / Airbyte CDC) reading the WAL`,
        hood: 'Cursor syncs also miss hard deletes, and an app-set `updated_at` can be skipped by bulk UPDATEs. Log-based CDC reads every change from the WAL and needs neither.',
      },
    ],
    fine: {
      'dim_product.category_group': 'Denormalizing category hierarchies into the dimension is standard star-schema design: the mart is rebuilt, not edited.',
      'dim_product.category': 'Denormalized on purpose in a dimension: fine.',
      'fact_order_lines.line_revenue': 'NUMERIC is exact decimal in BigQuery: right for money.',
      'fact_order_lines.customer_key': 'BigQuery does not enforce FKs; surrogate keys from the dims are the norm.',
      'fact_order_lines.product_key': 'Surrogate key from the dimension: fine. Clustering on it helps product filters.',
      'dim_customer.loaded_at': 'BigQuery `TIMESTAMP` is an absolute UTC instant (unlike `DATETIME`): fine.',
      'orders.created_at': 'timestamptz and indexed: fine as a column. The flaw is that no column tracks updates.',
    },
    predict: {
      question: 'Order #9001 has 3 lines. Its $10 shipping fee is copied onto each line. What does `SUM(shipping_fee)` report for that order?',
      options: ['$10', '$3.33', '$30', 'NULL'],
      answer: 2,
      explain: 'Each line carries the full order fee, so the sum counts it three times. Measures must be true at the table\'s grain.',
    },
    comment: [
      '**Request changes.** Numbers from this mart will be wrong in three ways:',
      '1. `shipping_fee` / `order_discount` are order-grain on a line-grain fact: `SUM` multiplies them by lines per order. Add `fact_orders` or allocate to lines.',
      '2. Store `birth_date`, not `age`; compute age at `order_date` in the model.',
      '3. The sync cursor is `created_at`, so refunds never arrive. We need `orders.updated_at` (+ trigger + index) or log-based CDC.',
    ],
  },

  /* ───────────────────────── 5. event outbox ───────────────────────── */
  {
    id: 5,
    exId: 'review-5',
    title: 'Event outbox',
    engine: 'MySQL 8.0 · InnoDB',
    pr: {
      number: 156,
      title: 'feat(events): transactional outbox + consumer dedupe',
      author: 'kai',
      body: 'Services write events to `outbox_events` in the same transaction as the business change; Debezium relays them to Kafka. Consumers record what they processed in `processed_messages`.',
      requirements: [
        '~300 events/s, kept 7 days for replay (~180M rows)',
        'Services run in 4 regions',
        'Each consumer must apply each message exactly once',
        'Debezium outbox event router reads `aggregate_type` / `aggregate_id`',
      ],
    },
    tables: [
      {
        name: 'outbox_events',
        cols: [
          { name: 'id', type: 'BINARY(16)', flags: ['PK'], sample: 'uuid4().bytes (app)' },
          { name: 'aggregate_type', type: 'VARCHAR(64)', flags: ['NN'], sample: "'order'" },
          { name: 'aggregate_id', type: 'VARCHAR(64)', flags: ['NN'] },
          { name: 'event_type', type: 'VARCHAR(128)', flags: ['NN'] },
          { name: 'payload', type: 'JSON', flags: ['NN'] },
          { name: 'occurred_at', type: 'DATETIME(6)', flags: ['NN'], sample: 'service local time' },
        ],
        extra: ['PRIMARY KEY (id)  -- InnoDB clustered index', 'idx_aggregate (aggregate_type, aggregate_id)'],
      },
      {
        name: 'processed_messages',
        cols: [
          { name: 'id', type: 'BIGINT', flags: ['PK', 'AUTO_INCREMENT'] },
          { name: 'consumer', type: 'VARCHAR(64)', flags: ['NN'] },
          { name: 'message_id', type: 'BINARY(16)', flags: ['NN', 'IDX'] },
          { name: 'processed_at', type: 'TIMESTAMP(6)', flags: ['NN'] },
        ],
        extra: ['idx_message (message_id)'],
      },
    ],
    flaws: [
      {
        id: 'outbox-uuid',
        kind: 'random-uuid-pk',
        targets: ['outbox_events.id'],
        anchor: 'outbox_events.id',
        title: 'Random UUIDv4 as the InnoDB clustered primary key',
        impact: 'InnoDB stores rows **inside** the PK B-tree. Random keys land on random leaf pages, so inserts split full pages and the whole index must stay in the buffer pool instead of just the rightmost page.',
        numbers: 'Random inserts leave pages **~69% full** vs ~94% (15/16) for sequential keys. At 180M rows × ~400 B that is ~104 GB instead of ~77 GB, and most inserts need a random page read.',
        fix: `-- app: generate UUIDv7 (time-ordered) instead of v4
-- or keep a sequential clustered key:
ALTER TABLE outbox_events
  DROP PRIMARY KEY,
  ADD COLUMN seq BIGINT AUTO_INCREMENT PRIMARY KEY FIRST,
  ADD UNIQUE KEY uq_event_id (id);`,
        hood: 'Sequential inserts fill pages to 15/16 and split off a new right page. Random splits are 50/50 and settle around ln 2 ≈ 69% fill. MySQL `UUID_TO_BIN(UUID(), 1)` reorders v1 UUIDs to be time-first; PostgreSQL 18 adds `uuidv7()`.',
      },
      {
        id: 'outbox-datetime',
        kind: 'timestamp-no-tz',
        targets: ['outbox_events.occurred_at'],
        anchor: 'outbox_events.occurred_at',
        title: '`occurred_at` is `DATETIME` in service local time',
        impact: '`DATETIME` stores wall-clock digits with no zone. Four regions writing local time make event ordering, consumer-lag dashboards and replay windows wrong.',
        numbers: 'Mumbai (UTC+5:30) and Virginia (UTC−4) events from the same instant sort **9.5 hours** apart; a 7-day replay window starting "now" skips or repeats hours of events.',
        fix: `-- every service: SET time_zone = '+00:00', write UTC
ALTER TABLE outbox_events
  CHANGE occurred_at occurred_at_utc DATETIME(6) NOT NULL;
-- TIMESTAMP(6) converts to UTC automatically but ends at 2038-01-19`,
        hood: 'MySQL `TIMESTAMP` is stored as UTC and converted with the session `time_zone`, but its range ends in 2038. `DATETIME` has a wide range and no conversion, so UTC must be enforced by convention and named in the column.',
      },
      {
        id: 'dedupe-unique',
        kind: 'missing-unique-idem',
        targets: ['processed_messages.message_id'],
        anchor: 'processed_messages.message_id',
        title: '`processed_messages.message_id` is not UNIQUE',
        impact: 'Kafka and Debezium are at-least-once. After a connector restart or a consumer rebalance, the same message arrives twice; two consumer threads both check, find nothing, and both apply it.',
        numbers: 'Kafka Connect flushes offsets every 60 s by default: a restart can replay up to **60 s × 300/s = 18,000** messages.',
        fix: `ALTER TABLE processed_messages
  DROP INDEX idx_message,
  ADD UNIQUE KEY uq_consumer_message (consumer, message_id);
-- consumer: INSERT the row and apply the side effect in ONE transaction;
-- ER_DUP_ENTRY (1062) → already processed, skip`,
        hood: 'Exactly-once processing = at-least-once delivery + an idempotent consumer. The unique key is the idempotency check; it must be scoped per consumer and written in the same transaction as the effect.',
      },
    ],
    fine: {
      'outbox_events.aggregate_type':
        'Looks polymorphic, but the outbox is a transport table: rows are relayed and expire, nothing joins back, and the Debezium outbox router expects exactly these columns. No FK is needed.',
      'outbox_events.aggregate_id': 'Same: an outbox references aggregates by value on purpose. Fine.',
      'outbox_events.payload': 'The event body is opaque to the database: JSON is right here.',
      'processed_messages.id': 'AUTO_INCREMENT clustered key: sequential inserts. Fine.',
      'processed_messages.processed_at': 'TIMESTAMP is stored as UTC in MySQL: fine for a short-lived dedupe record.',
    },
    predict: {
      question: '`outbox_events` uses random UUIDv4 as its InnoDB primary key. After millions of inserts, how full are its leaf pages on average?',
      options: ['~94% (15/16), like sequential inserts', '~69%', '~25%', '100%: InnoDB compacts on insert'],
      answer: 1,
      explain: 'Random inserts split pages 50/50; the steady state is about ln 2 ≈ 69% full. Sequential inserts fill each page to 15/16 before moving right.',
    },
    comment: [
      '**Request changes.** The outbox pattern is right; three storage details:',
      '1. UUIDv4 as the clustered PK means random page splits (~69% fill) and a hot working set the size of the table. Use UUIDv7, or a BIGINT AUTO_INCREMENT PK with `id` as a UNIQUE key.',
      '2. `occurred_at` is DATETIME in local time across 4 regions. Write UTC everywhere and name it `occurred_at_utc`.',
      '3. `processed_messages` needs `UNIQUE (consumer, message_id)`; otherwise redeliveries are applied twice.',
      '`aggregate_type` / `aggregate_id` without an FK is fine here: that is the outbox contract.',
    ],
  },
];
