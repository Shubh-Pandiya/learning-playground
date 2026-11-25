/** Flaw taxonomy, matching and scoring for the schema-review drill. Pure: no React. */

export type FlawKind =
  | 'float-money'
  | 'csv-list'
  | 'fk-no-index'
  | 'free-text-status'
  | 'age-not-dob'
  | 'timestamp-no-tz'
  | 'eav-core'
  | 'polymorphic-fk'
  | 'mutable-pk'
  | 'mixed-grain'
  | 'missing-unique-idem'
  | 'nullable-required-fk'
  | 'god-table'
  | 'missing-updated-at'
  | 'soft-delete-unique'
  | 'random-uuid-pk';

export type DecoyKind = 'json-column' | 'text-not-varchar' | 'no-cascade' | 'surrogate-key' | 'composite-pk' | 'denormalized-dim';

export type KindId = FlawKind | DecoyKind;

export interface KindInfo {
  label: string;
  hint: string;
  group: 'Types' | 'Keys & constraints' | 'Shape' | 'Time & change' | 'Analytics';
  /** Decoys are not flaws: tagging them counts as a false positive with this explanation. */
  whyFine?: string;
}

export const KINDS: Record<KindId, KindInfo> = {
  'float-money': { group: 'Types', label: 'Money as FLOAT / DOUBLE', hint: 'binary floating point for currency' },
  'csv-list': { group: 'Types', label: 'Comma-separated list in a column', hint: "'a,b,c' in one text cell" },
  'free-text-status': { group: 'Types', label: 'Free-text status', hint: 'no enum, lookup FK or CHECK' },
  'age-not-dob': { group: 'Types', label: 'Stores age, not birth date', hint: 'a derived value that decays' },
  'json-column': {
    group: 'Types',
    label: 'JSON / JSONB column',
    hint: 'semi-structured payload',
    whyFine: 'JSON is fine for opaque payloads you store and pass on (provider responses, event bodies). It is a flaw only for core attributes you filter, join or constrain.',
  },
  'text-not-varchar': {
    group: 'Types',
    label: 'TEXT instead of VARCHAR(n)',
    hint: 'unbounded string type',
    whyFine: 'In Postgres `text` and `varchar(n)` share one storage format; `varchar(n)` only adds a length check. Use a CHECK if you need a limit.',
  },
  'fk-no-index': { group: 'Keys & constraints', label: 'FK without an index on the child', hint: 'referencing column not indexed' },
  'missing-unique-idem': { group: 'Keys & constraints', label: 'Idempotency / dedupe key not UNIQUE', hint: 'retries can insert twice' },
  'nullable-required-fk': { group: 'Keys & constraints', label: 'Nullable FK for a required relation', hint: 'NULL allowed where the rule says "must"' },
  'mutable-pk': { group: 'Keys & constraints', label: 'Mutable natural primary key', hint: 'PK value can change' },
  'soft-delete-unique': { group: 'Keys & constraints', label: 'Soft delete without partial unique index', hint: 'UNIQUE counts deleted rows' },
  'random-uuid-pk': { group: 'Keys & constraints', label: 'Random UUIDv4 as clustered PK', hint: 'random inserts into a clustered index' },
  'no-cascade': {
    group: 'Keys & constraints',
    label: 'FK missing ON DELETE CASCADE',
    hint: 'children not deleted automatically',
    whyFine: 'The default (NO ACTION) blocks deleting a parent that still has children. For money, orders and audit data that is the safe choice: cascades silently erase history.',
  },
  'surrogate-key': {
    group: 'Keys & constraints',
    label: 'Surrogate key instead of natural key',
    hint: 'id column instead of a business key',
    whyFine: 'A stable surrogate key plus a UNIQUE constraint on the business key is the standard pattern: the PK never changes, the business rule is still enforced.',
  },
  'composite-pk': {
    group: 'Keys & constraints',
    label: 'Composite primary key',
    hint: 'PK spans several columns',
    whyFine: 'A composite PK on a link or line table states its grain and enforces uniqueness. Nothing wrong with it.',
  },
  'polymorphic-fk': { group: 'Shape', label: 'Polymorphic FK (type + id)', hint: 'one id column pointing at many tables' },
  'eav-core': { group: 'Shape', label: 'EAV for core attributes', hint: 'entity / attribute / value rows' },
  'god-table': { group: 'Shape', label: 'God table (too many columns)', hint: 'unrelated concerns in one wide row' },
  'timestamp-no-tz': { group: 'Time & change', label: 'Timestamp without time zone', hint: 'wall-clock time for global events' },
  'missing-updated-at': { group: 'Time & change', label: 'No updated_at on a synced source', hint: 'incremental sync cannot see updates' },
  'mixed-grain': { group: 'Analytics', label: 'Fact table mixes grains', hint: 'order-level measures on line rows' },
  'denormalized-dim': {
    group: 'Analytics',
    label: 'Denormalized column in a mart',
    hint: 'attribute copied into a dimension',
    whyFine: 'Star-schema dimensions are denormalized on purpose: the mart is rebuilt by the pipeline, never edited, so the copies cannot drift.',
  },
};

export const KIND_GROUPS: KindInfo['group'][] = ['Types', 'Keys & constraints', 'Shape', 'Time & change', 'Analytics'];

export const isDecoy = (k: KindId) => !!KINDS[k].whyFine;

/* ───────────────────────── schema model ───────────────────────── */

export interface Col {
  name: string;
  type: string;
  /** Short badges: PK, FK, NN, UQ, NULL, IDX, DEFAULT … */
  flags?: string[];
  sample?: string;
}

export interface STable {
  name: string;
  note?: string;
  cols: Col[];
  /** Extra columns shown collapsed (god table). */
  more?: { count: number; sample: string[] };
  /** Constraints and indexes, one per line. */
  extra?: string[];
}

export interface Flaw {
  id: string;
  kind: FlawKind;
  /** Accepted anchors: `table`, `table.col`, or `table.*` (table or any column). */
  targets: string[];
  /** Where to draw the marker on reveal. */
  anchor: string;
  title: string;
  impact: string;
  numbers: string;
  fix: string;
  hood: string;
}

export interface Tag {
  target: string;
  kind: KindId;
}

export type Verdict =
  | { tag: Tag; status: 'hit'; flaw: Flaw }
  | { tag: Tag; status: 'dup'; flaw: Flaw }
  | { tag: Tag; status: 'wrong-kind'; flaw: Flaw }
  | { tag: Tag; status: 'decoy'; note: string }
  | { tag: Tag; status: 'fp'; note?: string };

export const matches = (flawTarget: string, target: string) => {
  if (flawTarget === target) return true;
  if (!flawTarget.endsWith('.*')) return false;
  const t = flawTarget.slice(0, -2);
  return target === t || target.startsWith(`${t}.`);
};

const flawAt = (f: Flaw, target: string) => f.targets.some((t) => matches(t, target));

export interface Grade {
  verdicts: Verdict[];
  hits: Flaw[];
  misses: Flaw[];
  fp: number;
  solved: boolean;
  score: number;
}

export function grade(flaws: Flaw[], tags: Tag[], fine: Record<string, string> = {}): Grade {
  const hit = new Set<string>();
  const verdicts: Verdict[] = tags.map((tag) => {
    const same = flaws.filter((f) => f.kind === tag.kind && flawAt(f, tag.target));
    const fresh = same.find((f) => !hit.has(f.id));
    if (fresh) {
      hit.add(fresh.id);
      return { tag, status: 'hit', flaw: fresh };
    }
    if (same.length) return { tag, status: 'dup', flaw: same[0] };
    if (isDecoy(tag.kind)) return { tag, status: 'decoy', note: fine[tag.target] ?? KINDS[tag.kind].whyFine! };
    const near = flaws.find((f) => flawAt(f, tag.target));
    if (near) return { tag, status: 'wrong-kind', flaw: near };
    return { tag, status: 'fp', note: fine[tag.target] ?? fine[tag.target.split('.')[0]] };
  });
  const hits = flaws.filter((f) => hit.has(f.id));
  const misses = flaws.filter((f) => !hit.has(f.id));
  const fp = verdicts.filter((v) => v.status === 'decoy' || v.status === 'wrong-kind' || v.status === 'fp').length;
  const solved = hits.length >= flaws.length - 1 && fp <= 1;
  const score = Math.max(0, Math.round((100 * hits.length) / flaws.length - 15 * fp));
  return { verdicts, hits, misses, fp, solved, score };
}
