import { HoodSection } from './bits';

const MERGE_SQL = `-- SCD2 load: one MERGE closes changed versions AND inserts new ones.
-- hashdiff covers only Type 2 attributes (city, segment). name is Type 1.
WITH stg AS (
  SELECT customer_id, name, city, segment, signup_channel, changed_at,
         md5(concat_ws('|', coalesce(city, ''), coalesce(segment, ''))) AS hashdiff
  FROM   stg_customer
)
MERGE INTO dim_customer d
USING (
  -- 1) every staged row keyed by customer_id:
  --    matches the current version → close it; no match → brand-new customer
  SELECT customer_id AS merge_key, * FROM stg
  UNION ALL
  -- 2) changed customers again with a NULL key: never match → INSERT new version
  SELECT NULL AS merge_key, s.*
  FROM   stg s
  JOIN   dim_customer cur
    ON   cur.customer_id = s.customer_id AND cur.is_current
  WHERE  cur.hashdiff <> s.hashdiff
) u
ON  d.customer_id = u.merge_key AND d.is_current
WHEN MATCHED AND d.hashdiff <> u.hashdiff THEN
  UPDATE SET valid_to = u.changed_at, is_current = false
WHEN NOT MATCHED THEN
  INSERT (customer_id, name, city, segment, signup_channel,
          hashdiff, valid_from, valid_to, is_current)
  VALUES (u.customer_id, u.name, u.city, u.segment, u.signup_channel,
          u.hashdiff, u.changed_at, DATE '9999-12-31', true);
-- customer_sk is an IDENTITY column: every INSERT mints a new surrogate key.

-- Type 1 attributes (corrections): overwrite on every version, no new row.
UPDATE dim_customer d
SET    name = s.name
FROM   stg_customer s
WHERE  d.customer_id = s.customer_id AND d.name IS DISTINCT FROM s.name;`;

const LOOKUP_SQL = `-- Facts resolve the version valid on the EVENT date, not the load date.
INSERT INTO fact_sales (sale_id, sale_date, customer_sk, amount)
SELECT s.sale_id, s.sale_date, d.customer_sk, s.amount
FROM   stg_sales s
JOIN   dim_customer d
  ON   d.customer_id = s.customer_id
 AND   s.sale_date >= d.valid_from
 AND   s.sale_date <  d.valid_to;   -- half-open: exactly one version matches
-- ✗ AND d.is_current       → late facts land on today's version
-- ✗ BETWEEN from AND to    → boundary day matches two versions (double count)`;

const INDEX_SQL = `-- At most one current version per customer, and a tiny index for the hot lookup
CREATE UNIQUE INDEX dim_customer_current_uq
  ON dim_customer (customer_id) WHERE is_current;

-- No overlapping validity ranges for the same customer (needs btree_gist)
ALTER TABLE dim_customer ADD CONSTRAINT dim_customer_no_overlap
  EXCLUDE USING gist (customer_id WITH =,
                      daterange(valid_from, valid_to, '[)') WITH &&);`;

const NATURAL_SQL = `-- ✗ joining facts on the natural key in a Type 2 dim
SELECT d.city, sum(f.amount)
FROM   fact_sales f
JOIN   dim_customer d ON d.customer_id = f.customer_id   -- 3 versions match!
GROUP  BY d.city;
-- Each of the 6 facts matches sk 1 (Pune), sk 2 and sk 3 (Mumbai):
-- Pune ₹70k + Mumbai ₹140k = ₹210k reported from ₹70k of real sales.`;

export function ScdUnderTheHood({ fanout }: { fanout: { versions: number; total: number } }) {
  return (
    <section className="space-y-2">
      <div className="eyebrow">Under the hood</div>
      <HoodSection
        title="The SCD2 MERGE (upsert) with hashdiff"
        body={[
          'Real loads are set-based: a staging table (or CDC stream) of changed customers is merged into the dim. The classic trick unions the staged rows twice: once keyed by `customer_id` to **close** the current version, once with a NULL key so the new version always falls into `WHEN NOT MATCHED` and gets **inserted**.',
          '**Hashdiff**: hash the Type 2 attributes into one column and compare it to the current version. One comparison instead of N, unchanged rows are skipped, and `concat_ws` with a delimiter plus `coalesce` avoids collisions like `ab|c` vs `a|bc` and NULL-swallowing. dbt’s `check` snapshot strategy does the same comparison.',
          'Corrections (`name` typo) stay out of the hashdiff and are applied with a plain UPDATE across all versions.',
        ]}
        code={MERGE_SQL}
      />
      <HoodSection
        title="Fact lookup by validity range (late-arriving facts)"
        body={[
          'Facts arrive late all the time (offline POS, retries, backfills). Resolve the surrogate key by the **event date** inside `[valid_from, valid_to)`, never by `is_current`.',
          'The opposite case, a fact arriving **before** its dimension row (early-arriving fact / late-arriving dimension), is handled by inserting an **inferred member** placeholder row and filling it in when the real dim row lands.',
        ]}
        code={LOOKUP_SQL}
      />
      <HoodSection
        title="Why natural keys alone break SCD2"
        body={[
          `\`customer_id = C-1042\` now appears on **${fanout.versions} rows**. A fact joined on it matches every version: total revenue ${'₹'}${Math.round(fanout.total / 1000)}k becomes ${'₹'}${Math.round((fanout.total * fanout.versions) / 1000)}k, and you still can’t say which city applied.`,
          'The surrogate key identifies a **version**, the natural key identifies the **entity**. Facts store the surrogate key (point-in-time), and you keep the natural key (or a durable key) on the dim for as-is self-joins and for the MERGE.',
        ]}
        code={NATURAL_SQL}
      />
      <HoodSection
        title="is_current partial index + no-overlap constraint"
        body={[
          'The MERGE and every as-is query look up `WHERE customer_id = ? AND is_current`. A **partial unique index** only indexes current rows (10M entries, not 30M), and doubles as a guard: a buggy load can’t create two current versions.',
          'An exclusion constraint on `daterange(valid_from, valid_to)` makes overlapping versions impossible in Postgres. Warehouses (Snowflake, BigQuery) don’t enforce this, so add a data test (e.g. dbt’s `unique` on `customer_id` where `is_current`).',
        ]}
        code={INDEX_SQL}
      />
      <HoodSection
        title="Two different things are called Type 4"
        body={[
          '**Kimball’s Type 4 = mini-dimension**: move rapidly changing attributes (credit band, segment, age band) out of the big dim into `dim_profile`, one row per *combination* (e.g. 5 bands × 4 segments = 20 rows). Each fact stores `profile_sk` captured at event time. The 50M-row customer dim never versions for monthly band changes.',
          '**The "history table" Type 4** (the one animated here): a lean current table for as-is plus an append-only history table with validity ranges for as-was. Same idea: pay for history only where it is queried.',
        ]}
      />
    </section>
  );
}
