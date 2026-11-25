import type { Predict, StepTag } from '../../types';
import { NOISY_INPUTS, SCENARIOS, type Inputs, type Strategy } from './engine';

export interface TenancyStep {
  title: string;
  tag: StepTag;
  body: string[];
  strategy: Strategy;
  inputs: Inputs;
  spike?: boolean;
  predict?: Predict;
  keyIdea?: string;
  underHood?: string;
}

const STARTUP = SCENARIOS[0].inputs;
const BANK = SCENARIOS[1].inputs;
const SCALE: Inputs = { tenants: 100_000, whales: 1, share: 0.01, compliance: 'none', custom: 'none' };

export const STEPS: TenancyStep[] = [
  {
    title: 'Pool: everyone in the same tables',
    tag: 'technique',
    body: [
      'A B2B project tool with **5,000 small tenants**. Each averages ~1 query/s; the biggest is ~2% of traffic.',
      'The **pool** model puts every tenant in the same tables. Every row carries `tenant_id`, and every query filters on it. One schema, one migration, one connection pool per app server.',
      'Each dot on the right is a tenant (one dot stands for many). The box is one Postgres instance planned to 65% utilisation.',
    ],
    strategy: 'pool',
    inputs: STARTUP,
    predict: {
      question: '5,000 tenants, ~5,100 queries/s in total, one pooled Postgres at **$900/month**. What is the database cost **per tenant**?',
      options: ['~$150: a small database each', '~$1.80', '~$0.18', '~$0.02'],
      answer: 2,
      explain: 'One instance serves all 5,100 qps at ~51% utilisation: $900 / 5,000 = **$0.18 per tenant per month**. That density is why most SaaS starts pooled.',
    },
    keyIdea: 'Pool trades isolation for density: cheapest per tenant, simplest to operate, and every query must be tenant-scoped.',
  },
  {
    title: 'RLS: the safety net under tenant_id',
    tag: 'technique',
    body: [
      'Pool’s risk is a single missing `WHERE tenant_id = $1`: one endpoint, and tenant A sees tenant B’s data.',
      'Postgres **row-level security** attaches a predicate to the table itself. The app sets `app.tenant_id` at the start of each transaction; the policy adds `tenant_id = current_setting(\'app.tenant_id\')` to every query, including the ones developers forget.',
      'Try it in the **Modelling** tab: switch the session tenant and the role.',
    ],
    strategy: 'pool',
    inputs: STARTUP,
    predict: {
      question: 'A new endpoint runs `SELECT * FROM projects` with **no tenant filter**. RLS is enabled and forced; the app set `app.tenant_id = acme`. What comes back?',
      options: ['Every tenant’s projects', 'Only acme’s projects', 'An error: missing WHERE clause', 'Nothing until the query names a tenant'],
      answer: 1,
      explain: 'The policy’s `USING (tenant_id = current_setting(\'app.tenant_id\')::uuid)` is ANDed into the query, so only acme’s rows are visible. Caveats: table owners and `BYPASSRLS` roles skip policies unless you `FORCE ROW LEVEL SECURITY`, and with PgBouncer in transaction mode you must use `SET LOCAL` / `set_config(…, true)`.',
    },
    underHood: 'RLS policies are rewritten into the query tree as security-barrier quals, so the planner can still use an index on `(tenant_id, …)`. Foreign-key checks run as the table owner and **do not** apply RLS, which is why composite FKs matter.',
  },
  {
    title: 'The noisy neighbour',
    tag: 'failure',
    body: [
      'Two years later: **10,000 tenants**, and 3 enterprise customers each drive **~15%** of all traffic. Hash sharding spreads tenants over 3 pooled shards, so each whale lands on a shard with ~3,300 small tenants.',
      'Month-end: whale 1 runs its batch reports at **5×** its normal load.',
    ],
    strategy: 'pool',
    inputs: NOISY_INPUTS,
    spike: true,
    predict: {
      question: 'Whale 1 spikes to 5×. What do the ~3,300 small tenants on **its shard** see?',
      options: ['Nothing: Postgres isolates sessions', 'p99 rises a little: 15 → ~25 ms', 'The shard saturates: their requests time out', 'All 10,000 tenants time out'],
      answer: 2,
      explain: 'The shard goes from **61% to 170%** of capacity. Queues grow without bound, so p99 goes from ~15 ms to timeouts for **3,332 tenants** who did nothing. Tenants on the other two shards are fine: pool’s blast radius is the shard.',
    },
    keyIdea: 'In a pool, a tenant’s worst day becomes its neighbours’ worst day. Plan for the largest tenant’s peak, not the average.',
  },
  {
    title: 'Bridge: a schema per tenant',
    tag: 'tradeoff',
    body: [
      'Back to 5,000 small tenants. **Bridge** gives each tenant its own Postgres schema (`tenant_0042.projects`) on shared servers; the app sets `search_path` per request.',
      'It feels isolated: no `tenant_id` column needed, per-tenant `pg_dump -n`, per-tenant DDL. But each schema has its own 40 tables and their indexes.',
    ],
    strategy: 'bridge',
    inputs: STARTUP,
    predict: {
      question: 'A release adds one column to `projects`. How many times does the migration run?',
      options: ['Once', 'Twice: once per server', '5,000 times', 'Zero: search_path makes it shared'],
      answer: 2,
      explain: 'Every schema has its own `projects` table: **5,000 ALTERs** (~25 min at 10 in parallel). If run 3,812 fails, tenants are on mixed versions and the app must handle both. Each server also carries **300k relations** in `pg_class`, which bloats relcache memory per connection and slows `pg_dump` and autovacuum.',
    },
    keyIdea: 'Schema-per-tenant scales to hundreds of tenants, not tens of thousands.',
  },
  {
    title: 'Silo: a database per tenant',
    tag: 'technique',
    body: [
      'A core-banking platform: **20 regulated banks**. Contracts require data residency, a dedicated database, their own encryption keys and per-bank restore.',
      'The **silo** model gives each tenant its own database (and instance), placed in the bank’s region. Nothing is shared but the application code.',
    ],
    strategy: 'silo',
    inputs: BANK,
    predict: {
      question: 'Bank 7’s operator deletes a ledger by mistake. It asks to restore **its** data to yesterday 14:00. What does that take?',
      options: ['Point-in-time restore of bank 7’s own database: nobody else is touched', 'Restore the whole cluster to a side instance and copy bank 7’s rows back', 'Impossible without restoring every bank', 'Replay the application logs'],
      answer: 0,
      explain: 'With a database per tenant, backup, PITR, encryption keys, maintenance windows and even Postgres versions are per tenant. At 20 tenants the cost ($150 each) and 20 migrations per release are easy to justify.',
    },
    keyIdea: 'Silo buys hard isolation and per-tenant operations. You pay in money and in N of everything.',
  },
  {
    title: 'Silo for the long tail',
    tag: 'failure',
    body: ['What if the seed-stage SaaS with 5,000 small tenants chose silo “to be safe”?'],
    strategy: 'silo',
    inputs: STARTUP,
    predict: {
      question: '5,000 tenant databases. 20 app servers each keep a connection pool per database. How many pools?',
      options: ['20', '5,000', '100,000', '200'],
      answer: 2,
      explain: '20 × 5,000 = **100,000 pools** and ≥200k server connections, so you need PgBouncer per database or a routing proxy. Cost goes from $900 to **$750,000 a month** ($150 per tenant paying maybe $50), and every release runs 5,000 migrations.',
    },
    keyIdea: 'Silo per tenant only works when each tenant pays for its database.',
  },
  {
    title: 'Hybrid: pool the tail, silo the whales',
    tag: 'technique',
    body: [
      'Back to 10,000 tenants with 3 whales. **Hybrid** keeps the 9,997 small tenants pooled and moves each tenant above a threshold (here 15% of an instance) to its own database.',
      'Same schema everywhere, so the app only needs a **tenant → database** routing table (a “tenant catalog”).',
    ],
    strategy: 'hybrid',
    inputs: NOISY_INPUTS,
    spike: true,
    predict: {
      question: 'Whale 1 spikes 5× again, now on its own database. Who suffers?',
      options: ['Every tenant', 'The small tenants on its old shard', 'Only whale 1: its database hits 136%, so scale it up or rate-limit it', 'Nobody'],
      answer: 2,
      explain: 'The pooled shards stay at ~50% and p99 ~12 ms. Whale 1 saturates **its own** database, which you can size for its peak and bill for. Cost per tenant rises from $0.27 to **$0.45**, and a release runs 5 migrations instead of 3.',
    },
    keyIdea: 'Hybrid is where most mature SaaS ends up: density for the tail, isolation for those who need or pay for it.',
    underHood: 'Moving a tenant between tiers is a live migration: logical replication (or CDC) of rows `WHERE tenant_id = X` into the new database, a short write freeze, then flip the routing entry.',
  },
  {
    title: 'Sharding the pool by tenant_id',
    tag: 'recap',
    body: [
      'At **100,000 tenants** a single pool is 16 shards. Distributed Postgres (Citus) shards every table **by `tenant_id`** and co-locates shards of related tables, so joins and FKs within a tenant stay on one node.',
      'Whales get `isolate_tenant_to_new_shard` and can be moved to a dedicated node: hybrid inside one cluster. Everything here works only if **`tenant_id` leads every key**, which is the Modelling tab.',
    ],
    strategy: 'hybrid',
    inputs: SCALE,
    keyIdea: 'Choose by tenant count, size skew, isolation contracts and customization. Pool by default; silo when someone pays for it; hybrid when both exist.',
  },
];

export const NOISY_PREDICT: Predict = {
  question: 'Pool, 10,000 tenants, 3 whales at 15% each. Whale 1 spikes 5×. What happens to the small tenants on its shard?',
  options: ['Nothing: sessions are isolated', 'p99 roughly doubles', 'Their shard saturates and requests time out', 'Every tenant on every shard times out'],
  answer: 2,
  explain: 'Whale 1’s shard goes from 61% to 170% utilisation: the ~3,300 small tenants co-located with it time out; the other shards are unaffected. Now fix it without paying for 10,000 databases.',
};

/* ───────────────────────── modelling notes ───────────────────────── */

export const RLS_SQL = `ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;   -- owner obeys too

CREATE POLICY tenant_isolation ON projects
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- per request, inside the transaction (safe with PgBouncer txn mode)
BEGIN;
SELECT set_config('app.tenant_id', $1, true);   -- = SET LOCAL
SELECT * FROM projects;                          -- only this tenant
COMMIT;`;

export const MODEL_NOTES: { title: string; body: string; code?: string }[] = [
  {
    title: 'tenant_id leads every key',
    body: 'Primary keys, unique constraints and indexes start with `tenant_id`. Every query is tenant-scoped, so `(tenant_id, …)` turns it into one index range; it is also the distribution column Citus needs in every PK and unique constraint.',
    code: `CREATE TABLE projects (
  tenant_id  uuid   NOT NULL REFERENCES tenants,
  id         bigint GENERATED ALWAYS AS IDENTITY,
  name       text   NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, name)
);`,
  },
  {
    title: 'Composite FKs block cross-tenant references',
    body: 'A plain `project_id REFERENCES projects (id)` lets tenant A’s task point at tenant B’s project, and FK checks bypass RLS. Carry `tenant_id` into the FK so the database proves both rows belong to the same tenant.',
    code: `CREATE TABLE tasks (
  tenant_id  uuid   NOT NULL,
  id         bigint GENERATED ALWAYS AS IDENTITY,
  project_id bigint NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES projects (tenant_id, id)
);`,
  },
  {
    title: 'Uniqueness is per tenant',
    body: '`UNIQUE (email)` stops the same person joining two tenants and leaks “this email exists elsewhere” through the error. Scope it: `UNIQUE (tenant_id, email)`. Keep genuinely global identities (login accounts) in a separate table.',
  },
  {
    title: 'Tenant-specific custom fields',
    body: '**JSONB column** (`custom jsonb` + a `field_definitions` table, GIN or expression indexes): flexible, typed by the app, the default choice. **EAV** (`entity_id, field_id, value`): fully dynamic but every read is a pivot and values lose types. **Real columns per tenant**: fast and typed, but only possible with schema/database per tenant and every tenant drifts. Salesforce uses a metadata-driven variant: generic slots in shared tables plus a metadata dictionary.',
    code: `ALTER TABLE projects ADD COLUMN custom jsonb NOT NULL DEFAULT '{}';
CREATE INDEX ON projects USING gin (tenant_id, custom jsonb_path_ops); -- needs btree_gin
SELECT * FROM projects
WHERE tenant_id = $1 AND custom @> '{"region": "EMEA"}';`,
  },
  {
    title: 'Sharding by tenant_id (Citus)',
    body: 'Distribute every tenant-scoped table on `tenant_id` and co-locate them: a tenant’s rows for all tables live on one node, so joins, FKs and transactions stay local. Small shared tables become reference tables. Whales are moved to their own shard and node.',
    code: `SELECT create_distributed_table('projects', 'tenant_id');
SELECT create_distributed_table('tasks', 'tenant_id',
                                colocate_with => 'projects');
SELECT create_reference_table('plans');
SELECT isolate_tenant_to_new_shard('tasks', '0b7…', cascade_option => 'CASCADE');`,
  },
];

/* ───────────────────────── scoped-keys exercise ───────────────────────── */

export interface KeyQuestion {
  id: 'pk' | 'unique' | 'fk' | 'index';
  label: string;
  options: { sql: string; ok: boolean; why: string }[];
}

export const KEY_QUESTIONS: KeyQuestion[] = [
  {
    id: 'pk',
    label: 'Primary key of projects',
    options: [
      { sql: 'id bigserial PRIMARY KEY', ok: false, why: 'Unique, but nothing to reference with a composite FK, and Citus needs the distribution column in the PK.' },
      { sql: 'PRIMARY KEY (tenant_id, id)', ok: true, why: 'Tenant-leading: one index range per tenant, the target for composite FKs, and shardable by tenant_id.' },
      { sql: 'PRIMARY KEY (tenant_id)', ok: false, why: 'One project per tenant.' },
    ],
  },
  {
    id: 'unique',
    label: 'Users: one account per email',
    options: [
      { sql: 'UNIQUE (email)', ok: false, why: 'Blocks the same person in two tenants and the error leaks that the email exists in another tenant.' },
      { sql: 'UNIQUE (tenant_id, email)', ok: true, why: 'Unique within a tenant, independent across tenants.' },
      { sql: '-- checked in the app', ok: false, why: 'Two concurrent sign-ups both pass the check: duplicates.' },
    ],
  },
  {
    id: 'fk',
    label: 'tasks → projects',
    options: [
      { sql: 'project_id REFERENCES projects (id)', ok: false, why: 'Any tenant’s project satisfies it: a task in acme can reference globex’s project. RLS does not apply to FK checks.' },
      { sql: 'FOREIGN KEY (tenant_id, project_id)\n  REFERENCES projects (tenant_id, id)', ok: true, why: 'The referenced row must have the same tenant_id: cross-tenant references are impossible.' },
      { sql: 'project_id REFERENCES projects (id)\n  -- plus RLS on projects', ok: false, why: 'FK checks run as the table owner and ignore RLS, so the cross-tenant reference still succeeds.' },
    ],
  },
  {
    id: 'index',
    label: 'Index for “a tenant’s latest tasks”',
    options: [
      { sql: 'CREATE INDEX ON tasks (created_at DESC)', ok: false, why: 'Scans every tenant’s recent tasks and filters: cost grows with the whole table.' },
      { sql: 'CREATE INDEX ON tasks (created_at, tenant_id)', ok: false, why: 'Wrong order: the equality column should lead; a range on created_at first forces scanning all tenants.' },
      { sql: 'CREATE INDEX ON tasks (tenant_id, created_at DESC)', ok: true, why: 'Equality on tenant_id, then already sorted by time: an index range read of exactly 20 rows.' },
    ],
  },
];

export const UNDER_HOOD = [
  '**Postgres RLS** is enforced in the rewriter: policies become extra quals on every scan of the table. Superusers, the table owner (without FORCE) and roles with `BYPASSRLS` skip it; FK and unique checks are not filtered by it.',
  '**Connection pooling**: per-tenant settings must be transaction-scoped (`SET LOCAL`) when PgBouncer reuses server connections across clients; schema-per-tenant must reset `search_path` on every checkout.',
  '**Catalog**: every table, index, sequence and TOAST table is a row in `pg_class`. Each backend caches the ones it touches (relcache), so 100k+ relations per server multiplies memory by connection count.',
  'Model assumptions: small tenant ≈ 1 qps; pooled instance 10k qps at 65% target, $900/mo; smallest dedicated DB $150/mo; 20 app servers × pool of 10; p99 ≈ 6 ms / (1 − utilisation), timeouts above 95%.',
];
