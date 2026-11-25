/**
 * Pure relational-design logic for the normal-forms lab: attribute closure, candidate keys,
 * normal-form classification, lossless-join (chase) and dependency-preservation tests,
 * plus measurements on sample rows (duplicated values, rows touched by an update, joins).
 */

export interface FD {
  lhs: string[];
  rhs: string[];
}

export type Val = string | string[];
export type Row = Record<string, Val>;

export interface Tbl {
  id: string;
  name: string;
  cols: string[];
  pk: string[];
  /** Columns that hold a list (repeating group): a 1NF violation. */
  multi?: string[];
  rows: Row[];
  /** Foreign keys: local columns → referenced table name. */
  fks?: { cols: string[]; ref: string }[];
  badge?: string;
}

export type NF = 0 | 1 | 2 | 3 | 4;
export const NF_LABEL: Record<NF, string> = { 0: 'Not 1NF', 1: '1NF', 2: '2NF', 3: '3NF', 4: 'BCNF' };

export const setKey = (xs: string[]) => [...xs].sort().join(',');
const subsetOf = (a: string[], b: string[]) => a.every((x) => b.includes(x));

export function closure(x: Iterable<string>, fds: FD[]): Set<string> {
  const c = new Set(x);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of fds) {
      if (f.lhs.every((a) => c.has(a)) && f.rhs.some((a) => !c.has(a))) {
        f.rhs.forEach((a) => c.add(a));
        changed = true;
      }
    }
  }
  return c;
}

/** All non-empty subsets, smallest first (attribute order preserved). */
export function subsets(xs: string[]): string[][] {
  const out: string[][] = [];
  for (let m = 1; m < 1 << xs.length; m++) out.push(xs.filter((_, i) => m & (1 << i)));
  return out.sort((a, b) => a.length - b.length);
}

export function isSuperkey(x: string[], R: string[], fds: FD[]): boolean {
  const c = closure(x, fds);
  return R.every((a) => c.has(a));
}

export function candidateKeys(R: string[], fds: FD[]): string[][] {
  const keys: string[][] = [];
  for (const s of subsets(R)) {
    if (keys.some((k) => subsetOf(k, s))) continue;
    if (isSuperkey(s, R, fds)) keys.push(s);
  }
  return keys;
}

export type ViolationKind = 'partial' | 'transitive' | 'bcnf';

export interface Violation {
  lhs: string[];
  rhs: string[];
  kind: ViolationKind;
}

export interface NFReport {
  nf: NF;
  keys: string[][];
  prime: string[];
  violations: Violation[];
  multi: string[];
}

/** Classify relation R (FDs may span a wider universe; they are projected via closure) into its highest normal form. */
export function analyzeNF(R: string[], fds: FD[], multi: string[] = []): NFReport {
  const keys = candidateKeys(R, fds);
  const prime = [...new Set(keys.flat())];
  const violations: Violation[] = [];
  for (const X of subsets(R)) {
    if (isSuperkey(X, R, fds)) continue;
    const c = closure(X, fds);
    let D = R.filter((a) => c.has(a) && !X.includes(a));
    // Skip attributes already explained by a smaller determinant inside X.
    for (const v of violations) if (subsetOf(v.lhs, X)) D = D.filter((a) => !v.rhs.includes(a));
    if (!D.length) continue;
    const partialKey = keys.some((k) => k.length > X.length && subsetOf(X, k));
    const nonPrime = D.filter((a) => !prime.includes(a));
    const primeD = D.filter((a) => prime.includes(a));
    if (nonPrime.length) violations.push({ lhs: X, rhs: nonPrime, kind: partialKey ? 'partial' : 'transitive' });
    if (primeD.length) violations.push({ lhs: X, rhs: primeD, kind: 'bcnf' });
  }
  const multiIn = multi.filter((m) => R.includes(m));
  const nf: NF = multiIn.length
    ? 0
    : violations.some((v) => v.kind === 'partial')
      ? 1
      : violations.some((v) => v.kind === 'transitive')
        ? 2
        : violations.length
          ? 3
          : 4;
  return { nf, keys, prime, violations, multi: multiIn };
}

/** FDs from F that no single table can enforce (Ullman's preservation test, no projection needed). */
export function lostDependencies(tables: string[][], fds: FD[]): FD[] {
  return fds.filter((f) => {
    const z = new Set(f.lhs);
    let changed = true;
    while (changed) {
      changed = false;
      for (const R of tables) {
        const c = closure(
          [...z].filter((a) => R.includes(a)),
          fds,
        );
        for (const a of R)
          if (c.has(a) && !z.has(a)) {
            z.add(a);
            changed = true;
          }
      }
    }
    return !f.rhs.every((a) => z.has(a));
  });
}

/** Chase test: does joining the projections give back exactly the original relation? */
export function isLossless(U: string[], tables: string[][], fds: FD[]): boolean {
  const T = tables.map((R, i) => Object.fromEntries(U.map((a) => [a, R.includes(a) ? 'a' : `b${i}`] as [string, string])));
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    for (const f of fds) {
      for (let i = 0; i < T.length; i++)
        for (let j = i + 1; j < T.length; j++) {
          if (!f.lhs.every((a) => T[i][a] === T[j][a])) continue;
          for (const a of f.rhs) {
            if (!U.includes(a) || T[i][a] === T[j][a]) continue;
            const keep = T[i][a] === 'a' || T[j][a] === 'a' ? 'a' : T[i][a] < T[j][a] ? T[i][a] : T[j][a];
            const olds = [T[i][a], T[j][a]];
            for (const r of T) if (olds.includes(r[a])) r[a] = keep;
            changed = true;
          }
        }
    }
  }
  return T.some((r) => U.every((a) => r[a] === 'a'));
}

/* ───────────────────────── sample-data measurements ───────────────────────── */

export const showVal = (v: Val | undefined) => (Array.isArray(v) ? v.join(',') : (v ?? ''));

export function project(rows: Row[], cols: string[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const r of rows) {
    const p: Row = Object.fromEntries(cols.map((c) => [c, r[c]]));
    const k = cols.map((c) => showVal(p[c])).join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

export function naturalJoin(a: Row[], b: Row[]): Row[] {
  if (!a.length || !b.length) return [];
  const common = Object.keys(a[0]).filter((c) => c in b[0]);
  const out: Row[] = [];
  for (const x of a) for (const y of b) if (common.every((c) => showVal(x[c]) === showVal(y[c]))) out.push({ ...x, ...y });
  return out;
}

/** Given FDs, restricted to a table's columns (non-trivial, non-empty right side). */
export function fdsIn(cols: string[], fds: FD[]): FD[] {
  return fds
    .filter((f) => subsetOf(f.lhs, cols))
    .map((f) => ({ lhs: f.lhs, rhs: f.rhs.filter((a) => cols.includes(a) && !f.lhs.includes(a)) }))
    .filter((f) => f.rhs.length);
}

export type Lane = FD & { derived?: boolean };

/**
 * FD lanes to draw for a table: the given FDs that live inside it, plus a derived lane when a
 * split left an implied dependency (e.g. student_id → advisor_name) without its intermediate.
 */
export function lanesFor(cols: string[], fds: FD[]): Lane[] {
  const inside = fdsIn(cols, fds);
  const out: Lane[] = [...inside];
  const lhsSeen = new Set<string>();
  for (const f of fds) {
    if (!subsetOf(f.lhs, cols) || lhsSeen.has(setKey(f.lhs))) continue;
    lhsSeen.add(setKey(f.lhs));
    const truth = closure(f.lhs, fds);
    const local = closure(f.lhs, inside);
    const extra = cols.filter((a) => truth.has(a) && !local.has(a));
    if (extra.length) out.push({ lhs: f.lhs, rhs: extra, derived: true });
  }
  return out;
}

/** How a lane relates to the table's keys. */
export function laneKind(lane: FD, cols: string[], fds: FD[], multi: string[] = []): 'key' | 'repeating' | ViolationKind {
  if (lane.lhs.some((a) => multi.includes(a))) return 'repeating';
  if (isSuperkey(lane.lhs, cols, fds)) return 'key';
  const keys = candidateKeys(cols, fds);
  const prime = new Set(keys.flat());
  if (lane.rhs.every((a) => prime.has(a))) return 'bcnf';
  return keys.some((k) => k.length > lane.lhs.length && subsetOf(lane.lhs, k)) ? 'partial' : 'transitive';
}

/** Cells that are redundant copies of a fact already stated in another row (`row:col` or `row:col:i`). */
export function redundancy(t: Tbl, fds: FD[]): { count: number; cells: Set<string> } {
  const cells = new Set<string>();
  let count = 0;
  const multi = t.multi ?? [];
  for (const f of fdsIn(t.cols, fds)) {
    if (isSuperkey(f.lhs, t.cols, fds)) continue;
    const seen = new Set<string>();
    const lhsMulti = f.lhs.some((a) => multi.includes(a));
    t.rows.forEach((r, ri) => {
      if (lhsMulti) {
        const n = Math.max(...f.lhs.map((a) => (Array.isArray(r[a]) ? (r[a] as string[]).length : 1)));
        for (let k = 0; k < n; k++) {
          const v = f.lhs.map((a) => (Array.isArray(r[a]) ? (r[a] as string[])[k] : r[a])).join('|');
          if (seen.has(v)) {
            count += f.rhs.length;
            f.rhs.forEach((c) => cells.add(multi.includes(c) ? `${ri}:${c}:${k}` : `${ri}:${c}`));
          } else seen.add(v);
        }
      } else {
        const v = f.lhs.map((a) => showVal(r[a])).join('|');
        if (seen.has(v)) {
          count += f.rhs.length;
          f.rhs.forEach((c) => cells.add(`${ri}:${c}`));
        } else seen.add(v);
      }
    });
  }
  return { count, cells };
}

/** Rows a single-fact UPDATE must rewrite: rows of the table holding `attr` whose `by` column matches. */
export function rowsTouched(tables: Tbl[], attr: string, by: string, value: string): number {
  let n = 0;
  for (const t of tables) {
    if (!t.cols.includes(attr) || !t.cols.includes(by)) continue;
    n += t.rows.filter((r) => (Array.isArray(r[by]) ? (r[by] as string[]).includes(value) : r[by] === value)).length;
  }
  return n;
}

export interface SchemaMetrics {
  tables: number;
  rows: number;
  cells: number;
  dup: number;
  /** Joins needed for the full order report (every attribute). */
  joins: number;
  c1Move: number;
  p2Price: number;
}

export function schemaMetrics(tables: Tbl[], fdsOf: (t: Tbl) => FD[]): SchemaMetrics {
  return {
    tables: tables.length,
    rows: tables.reduce((s, t) => s + t.rows.length, 0),
    cells: tables.reduce((s, t) => s + t.rows.length * t.cols.length, 0),
    dup: tables.reduce((s, t) => s + redundancy(t, fdsOf(t)).count, 0),
    joins: Math.max(0, tables.length - 1),
    c1Move: rowsTouched(tables, 'customer_city', 'customer_id', 'C1'),
    p2Price: rowsTouched(tables, 'unit_price', 'product_id', 'P2'),
  };
}

/* ───────────────────────── decomposition (exercise) ───────────────────────── */

export interface Split {
  lhs: string[];
  rhs: string[];
}

/** Split R on X → Y: R1 = X ∪ Y, R2 = R − (Y − X). */
export function splitOn(R: string[], s: Split): [string[], string[]] {
  const r1 = R.filter((a) => s.lhs.includes(a) || s.rhs.includes(a));
  const r2 = R.filter((a) => !s.rhs.includes(a) || s.lhs.includes(a));
  return [r1, r2];
}

export const fmtSet = (xs: string[]) => (xs.length === 1 ? xs[0] : `{${xs.join(', ')}}`);
export const fmtFD = (f: FD) => `${fmtSet(f.lhs)} → ${f.rhs.join(', ')}`;
