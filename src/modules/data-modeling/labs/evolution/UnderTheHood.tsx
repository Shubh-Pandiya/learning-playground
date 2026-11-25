import { HoodSection } from '../scd/bits';

const SYNC_TRIGGER = `CREATE FUNCTION sync_fullname_display_name() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.display_name := COALESCE(NEW.display_name, NEW.fullname);
    NEW.fullname     := COALESCE(NEW.fullname, NEW.display_name);
  ELSIF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    NEW.fullname := NEW.display_name;          -- written by v2
  ELSIF NEW.fullname IS DISTINCT FROM OLD.fullname THEN
    NEW.display_name := NEW.fullname;          -- written by v1
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER users_sync_name BEFORE INSERT OR UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION sync_fullname_display_name();`;

const BACKFILL = `-- driver loop (app script or DO block with COMMIT per batch, PG11+)
-- keyset pagination: never OFFSET, never one giant UPDATE
UPDATE users SET display_name = fullname
WHERE id >= :lo AND id < :lo + 10000
  AND display_name IS DISTINCT FROM fullname;
-- commit, then:
--   lo += 10000
--   if replica lag > 5s: sleep
--   checkpoint lo somewhere durable, so a crash resumes, not restarts`;

const CONCURRENTLY = `SET lock_timeout = '3s';
CREATE UNIQUE INDEX CONCURRENTLY orders_id_new_uq ON orders (id_new);
-- can't run inside BEGIN … COMMIT (most migration tools need a "no transaction" flag)

-- if it failed, it leaves an INVALID index that still slows writes:
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
DROP INDEX CONCURRENTLY orders_id_new_uq;   -- then retry`;

const NOT_VALID = `-- 1. instant: brief SHARE ROW EXCLUSIVE, no scan; new rows are checked from now on
ALTER TABLE addresses ADD CONSTRAINT addresses_user_fk
  FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;

-- 2. scan existing rows under SHARE UPDATE EXCLUSIVE: reads and writes continue
ALTER TABLE addresses VALIDATE CONSTRAINT addresses_user_fk;

-- same trick for NOT NULL on a big table (PG12+):
ALTER TABLE orders ADD CONSTRAINT id_new_nn CHECK (id_new IS NOT NULL) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT id_new_nn;
ALTER TABLE orders ALTER id_new SET NOT NULL;   -- skips the scan: proven by the check
ALTER TABLE orders DROP CONSTRAINT id_new_nn;`;

const LOCK_TIMEOUT = `-- session A: a 5-min analytics query holds ACCESS SHARE on orders
-- session B (migration):
ALTER TABLE orders ADD COLUMN note text;   -- wants ACCESS EXCLUSIVE → waits
-- session C, D, E … : SELECT * FROM orders WHERE id = 1;
--   → queue BEHIND B. The site is down for 5 minutes.

-- fix: fail fast and retry
SET lock_timeout = '3s';
ALTER TABLE orders ADD COLUMN note text;   -- gives up after 3s, retry with backoff
-- also: SET statement_timeout for the DDL itself`;

const AVRO = `// v1 (writer)                          // v2 (reader) with alias
{"name": "amount", "type": "long"}       {"name": "total_amount", "type": "long",
                                          "aliases": ["amount"]}
{"name": "quantity", "type": "int"}      {"name": "quantity", "type": "long"}     // int → long promotes
                                          {"name": "coupon_code",
                                           "type": ["null", "string"], "default": null}

// resolution, reader-driven:
//  · match fields by name, or by the READER's aliases
//  · reader field missing in data  → use reader default, else error
//  · writer field unknown to reader → skipped
//  · types: int→long/float/double, long→float/double, float→double, string↔bytes
//  · enums: writer symbol unknown to reader → error, unless the reader enum has a default`;

const PROTO = `message OrderPlaced {
  reserved 4, 9;                     // numbers of removed fields: never reuse
  reserved "sales_rep", "legacy_channel";
  string order_id    = 1;
  int64  customer_id = 2;
  int64  amount      = 3;            // renaming is wire-safe: only the number travels
  optional string coupon_code = 10;  // new field, new number: old readers skip it
  OrderStatus status = 7;
}
enum OrderStatus {
  ORDER_STATUS_UNSPECIFIED = 0;      // proto3: first value must be 0, the default
  PLACED = 1; PAID = 2; SHIPPED = 3; CANCELLED = 4;
}`;

export function MigrationHood() {
  return (
    <div className="space-y-2">
      <div className="eyebrow">Under the hood · online schema changes</div>
      <HoodSection
        title="Expand → migrate → contract (parallel change)"
        body={[
          'A rolling deploy means **two app versions share one schema** for minutes; a canary or rollback stretches that to hours. So no single migration may remove or rename anything the older live version still uses.',
          '**Expand**: add new structures, backwards-compatible (nullable column, new table, NOT VALID constraint). **Migrate**: sync both shapes, backfill, move reads, then writes, to the new shape. **Contract**: in a *later* release, once nothing references the old shape, drop it.',
          'Stripe’s version is four deployable steps: dual-write → read from new → write only new → remove old. Each step is reversible, which is the real point.',
        ]}
      />
      <HoodSection
        title="Dual-write with a sync trigger"
        body={[
          'v1 writes `fullname`, v2 writes `display_name`. The trigger copies whichever side changed, using `IS DISTINCT FROM` so NULLs compare sanely. GitLab ships this as `rename_column_concurrently`.',
          'Create it **before** the backfill: rows edited between their batch being copied and the trigger existing would otherwise stay stale forever. App-level dual-write works too, but every writer (cron jobs, admin scripts, other services) must do it.',
        ]}
        code={SYNC_TRIGGER}
      />
      <HoodSection
        title="Backfill in batches, never one transaction"
        body={[
          'One `UPDATE` over 500M rows locks every row until commit, writes ~all its WAL in one burst (replicas lag), creates 500M dead tuples (bloat, vacuum debt), and holds back `xmin` so vacuum can’t clean *any* table. If it fails at 95%, all of it rolls back.',
          'Batches of 1–10k by primary-key range: each commits in milliseconds, is idempotent (`IS DISTINCT FROM` / `ON CONFLICT DO NOTHING`), throttles on replica lag, and resumes from a checkpoint.',
        ]}
        code={BACKFILL}
      />
      <HoodSection
        title="CREATE INDEX CONCURRENTLY"
        body={[
          'A plain `CREATE INDEX` holds a **SHARE** lock: reads continue but every INSERT/UPDATE/DELETE waits for the whole build. `CONCURRENTLY` holds SHARE UPDATE EXCLUSIVE, scans the table twice and waits for older transactions, so it is slower but writes keep flowing.',
          'Then attach it without a rebuild: `ADD CONSTRAINT … PRIMARY KEY USING INDEX` or `UNIQUE USING INDEX`.',
        ]}
        code={CONCURRENTLY}
      />
      <HoodSection
        title="NOT VALID + VALIDATE CONSTRAINT"
        body={[
          'Adding a FK or CHECK normally validates every existing row while holding a lock that blocks writes (SHARE ROW EXCLUSIVE for FKs, on **both** tables). Split it: `NOT VALID` adds the constraint instantly and enforces it for new rows; `VALIDATE CONSTRAINT` later scans old rows under SHARE UPDATE EXCLUSIVE, which doesn’t block reads or writes.',
        ]}
        code={NOT_VALID}
      />
      <HoodSection
        title="lock_timeout and the lock queue"
        body={[
          'Even a metadata-only DDL needs ACCESS EXCLUSIVE for a moment. If it waits behind a long query, **every later query queues behind the waiting DDL**: a two-line migration becomes an outage. Always set `lock_timeout` (a few seconds) and retry with backoff.',
          'Triggerless alternatives exist: **gh-ost** (GitHub, MySQL) copies into a ghost table and tails the binlog; **pg-osc** and **pgroll** do shadow-table / view-based migrations for Postgres.',
        ]}
        code={LOCK_TIMEOUT}
      />
    </div>
  );
}

export function ContractHood() {
  return (
    <div className="space-y-2">
      <div className="eyebrow">Under the hood · data contracts</div>
      <HoodSection
        title="Avro resolution: reader schema vs writer schema"
        body={[
          'Avro data carries no field names, so decoding always uses **two** schemas: the writer’s (looked up by the schema id in the message header) and the reader’s (compiled into the consumer). Resolution is driven by the reader.',
          'That’s why **adding a field needs a default** (new readers, old data), **removing a field needs it to have had a default** (old readers, new data), and **aliases help only the reader that declares them**. A rename with alias is BACKWARD, never FORWARD.',
        ]}
        code={AVRO}
        language="javascript"
      />
      <HoodSection
        title="Modes, transitivity and who deploys first"
        body={[
          '**BACKWARD** (Confluent default): new schema reads the latest version’s data → upgrade **consumers first**. **FORWARD**: the latest schema reads new data → upgrade **producers first**. **FULL**: both → any order.',
          'Non-transitive modes compare only with the latest version. If v2 is checked against v1 and v3 only against v2, v3 may not read v1 events still sitting in a 30-day topic, or replayed from offset 0. `*_TRANSITIVE` checks every registered version; FULL_TRANSITIVE is the strictest and the safest for long-retention or compacted topics.',
          'Two-step tricks keep FULL happy: give a field a default first, then remove it later; add `quantity_long` instead of widening `quantity`. Transitive modes may still reject them, because v1 never had the default.',
        ]}
      />
      <HoodSection
        title="Protobuf: field numbers are the contract"
        body={[
          'Protobuf encodes the **field number**, not the name. Renaming is wire-safe; changing a number is a new field. Never reuse a number: old data would decode with the wrong meaning. Mark removed numbers and names `reserved` so `protoc` rejects reuse.',
          'proto3 has no `required`, so adding and removing fields are both safe by default, and readers skip unknown fields. Unknown enum values are preserved as their integer (open enums), so add an `UNSPECIFIED = 0`. Compatible type swaps are limited (int32/int64/uint32/bool share an encoding but truncate). `buf breaking` catches these in CI.',
        ]}
        code={PROTO}
        language="cpp"
      />
      <HoodSection
        title="A data contract is more than a schema"
        body={[
          'Schema compatibility catches structural breaks only. A contract also pins **semantics** (is `amount` in paise or rupees? gross or net?), **ownership** (the producing team owns and versions it), **SLAs** (freshness, completeness), and **enforcement** in CI: the producer’s pipeline checks compatibility against the registry *before* merge, not at runtime.',
          'Breaking anyway? Publish a new subject or topic (`orders.v2`), dual-publish during the migration, and retire v1 when the consumer list is empty.',
        ]}
      />
    </div>
  );
}
