/**
 * Schema analysis engine.
 *
 * Everything is derived from (scenario attributes + functional dependencies + grains) and the
 * user's placement of attributes into tables:
 *  - keys and normal forms (closure of the PK over the scenario's FDs, projected onto the table)
 *  - update / insert / delete anomalies with "rows touched" estimates
 *  - relationships (a child holds a parent's full primary key)
 *  - per access pattern: the cheapest connected set of tables, joins, seek vs scan, correctness
 *  - per write: rows touched; storage and duplication
 */
import type {
  AccessPattern,
  Attr,
  AttrType,
  Column,
  DTable,
  IssueCode,
  Op,
  Paradigm,
  ReadPattern,
  Scenario,
  Schema,
  TableKind,
  WritePattern,
} from '../types';

export type Severity = 'bad' | 'warn' | 'info';
export type Level = 'ok' | 'warn' | 'bad';

export interface Issue {
  key: string;
  code: IssueCode;
  severity: Severity;
  /** Table id the issue is about (if any). */
  table?: string;
  /** Access pattern id (if any). */
  pattern?: string;
  attrs?: string[];
  title: string;
  detail: string;
  fix?: string;
}

export interface Violation {
  kind: 'partial' | 'transitive' | 'bcnf';
  lhs: string[];
  rhs: string[];
}

export interface Anomaly {
  kind: 'update' | 'insert' | 'delete';
  table: string;
  lhs: string[];
  rhs: string[];
  /** Update: rows that must change together. */
  rows?: number;
  text: string;
}

export interface TableInfo {
  id: string;
  name: string;
  kind: TableKind;
  pk: string[];
  attrs: string[];
  rows: number;
  rowBytes: number;
  bytes: number;
  /** 0 = not even 1NF / broken key, 1..3 = 1NF..3NF, 4 = BCNF. */
  nf: number;
  violations: Violation[];
  anomalies: Anomaly[];
  /** Denormalised on purpose (dimensions, read models): NF findings are informational. */
  byDesign: boolean;
  undetermined: string[];
}

export interface Rel {
  id: string;
  parent: string;
  child: string;
  attrs: string[];
  card: '1:1' | '1:N';
  /** FK is part of the child's PK. */
  identifying: boolean;
}

export interface ReadResult {
  id: string;
  name: string;
  level: Level;
  tables: string[];
  joins: number;
  access: 'seek' | 'scan' | 'none';
  /** Tables reached by a full scan. */
  scans: string[];
  rowsRead: number;
  missing: string[];
  perSec: number;
  maxJoins: number;
}

export interface WriteResult {
  id: string;
  name: string;
  level: Level;
  rows: number;
  perTable: { table: string; rows: number }[];
  perSec: number;
}

export interface Impact {
  paradigm: Paradigm;
  tables: Record<string, TableInfo>;
  order: string[];
  rels: Rel[];
  reads: Record<string, ReadResult>;
  writes: Record<string, WriteResult>;
  issues: Issue[];
  storage: number;
  dupBytes: number;
  duplicated: { attr: string; tables: string[] }[];
  unplaced: string[];
  counts: { bad: number; warn: number; info: number; anomalies: number };
}

// ---------------------------------------------------------------- helpers

const TYPE_BYTES: Record<AttrType, number> = { id: 8, text: 32, int: 4, money: 8, date: 4, ts: 8, bool: 1, enum: 2, json: 200, array: 64, hash: 16 };
/** Postgres heap tuple header + item pointer, roughly. */
export const ROW_OVERHEAD = 28;

const RELATIONAL: TableKind[] = ['entity', 'bridge', 'lookup', 'flat', 'hub', 'link'];
const FACTISH: TableKind[] = ['fact', 'snapshot', 'factless', 'event'];
const BY_DESIGN: TableKind[] = ['dim', 'junk', 'obt', 'feed', 'aggregate'];

export const isFactish = (k: TableKind) => FACTISH.includes(k);

export function attrBytes(a: Attr | undefined): number {
  if (!a) return 8;
  return a.bytes ?? (a.multi ? 64 : TYPE_BYTES[a.type]);
}

export function fmtNum(n: number): string {
  if (!isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a >= 1e9) return `${+(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${+(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${Math.round(n)}`;
}

export function fmtBytes(b: number): string {
  if (b >= 1e12) return `${+(b / 1e12).toFixed(1)} TB`;
  if (b >= 1e9) return `${+(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${+(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${+(b / 1e3).toFixed(1)} kB`;
  return `${Math.round(b)} B`;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const subset = (a: string[], b: string[] | Set<string>) => a.every((x) => (b instanceof Set ? b.has(x) : b.includes(x)));

function properSubsets<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  const n = xs.length;
  if (n > 6) return out;
  for (let m = 1; m < (1 << n) - 1; m++) out.push(xs.filter((_, i) => m & (1 << i)));
  return out.sort((a, b) => a.length - b.length);
}

export const attrName = (sc: Scenario, id: string) => sc.attrs.find((a) => a.id === id)?.name ?? id;
const names = (sc: Scenario, ids: string[]) => ids.map((i) => attrName(sc, i)).join(', ');

/** Per-scenario cached helpers. */
export class Model {
  readonly sc: Scenario;
  readonly attr: Map<string, Attr>;
  private cache = new Map<string, Set<string>>();

  constructor(sc: Scenario) {
    this.sc = sc;
    this.attr = new Map(sc.attrs.map((a) => [a.id, a]));
  }

  closure(xs: string[]): Set<string> {
    const k = [...xs].sort().join('|');
    const hit = this.cache.get(k);
    if (hit) return hit;
    const out = new Set(xs);
    let changed = true;
    while (changed) {
      changed = false;
      for (const fd of this.sc.fds) {
        if (subset(fd.lhs, out) && fd.rhs.some((r) => !out.has(r))) {
          fd.rhs.forEach((r) => out.add(r));
          changed = true;
        }
      }
    }
    this.cache.set(k, out);
    return out;
  }

  determines(xs: string[], ys: string[]) {
    return subset(ys, this.closure(xs));
  }

  /** Distinct values of a key. */
  rowsOfKey(key: string[]): number {
    if (!key.length) return 1;
    const kc = this.closure(key);
    let best = Infinity;
    for (const g of this.sc.grains) {
      const gc = this.closure(g.key);
      if (subset(key, gc) && subset(g.key, kc)) return g.rows;
      if (subset(key, gc)) best = Math.min(best, g.rows);
    }
    if (best < Infinity) return best;
    let lo = 1;
    for (const g of this.sc.grains) if (subset(g.key, kc)) lo = Math.max(lo, g.rows);
    return lo;
  }

  grainLabel(key: string[]): string | undefined {
    const kc = this.closure(key);
    return this.sc.grains.find((g) => subset(key, this.closure(g.key)) && subset(g.key, kc))?.label;
  }

  /** Attributes that identify an entity on their own (a grain key of size 1). */
  isEntityKey(a: string) {
    return this.sc.grains.some((g) => g.key.length === 1 && g.key[0] === a);
  }

  isTechnical(a: string) {
    return !!this.attr.get(a)?.technical;
  }
}

// ---------------------------------------------------------------- schema ops

let seq = 0;
const uid = (base: string, taken: Set<string>) => {
  if (!taken.has(base)) return base;
  let id = `${base}-${++seq}`;
  while (taken.has(id)) id = `${base}-${++seq}`;
  return id;
};

export function makeTable(sc: Scenario, tplId: string, taken: Set<string>, pos?: { x: number; y: number }): DTable | undefined {
  const t = sc.templates.find((x) => x.id === tplId);
  if (!t) return undefined;
  const p = pos ?? sc.layout[tplId] ?? { x: 80 + taken.size * 40, y: 80 + taken.size * 30 };
  return { id: uid(tplId, taken), tpl: t.id, name: t.name, kind: t.kind, columns: t.columns.map((c) => ({ ...c })), x: p.x, y: p.y };
}

export function startSchema(sc: Scenario): Schema {
  const taken = new Set<string>();
  const tables: DTable[] = [];
  for (const id of sc.start ?? []) {
    const t = makeTable(sc, id, taken);
    if (t) {
      taken.add(t.id);
      tables.push(t);
    }
  }
  return { tables };
}

export function referenceSchema(sc: Scenario): Schema {
  const taken = new Set<string>();
  const tables: DTable[] = [];
  for (const id of sc.reference) {
    const t = makeTable(sc, id, taken);
    if (t) {
      taken.add(t.id);
      tables.push(t);
    }
  }
  return { tables };
}

const mapTable = (s: Schema, id: string, f: (t: DTable) => DTable): Schema => ({ tables: s.tables.map((t) => (t.id === id ? f(t) : t)) });

export function addTable(sc: Scenario, s: Schema, tplId: string, pos?: { x: number; y: number }): Schema {
  const t = makeTable(sc, tplId, new Set(s.tables.map((x) => x.id)), pos);
  return t ? { tables: [...s.tables, t] } : s;
}

export const removeTable = (s: Schema, id: string): Schema => ({ tables: s.tables.filter((t) => t.id !== id) });

export function addColumn(s: Schema, attr: string, to: string, extra?: Partial<Column>): Schema {
  return mapTable(s, to, (t) => (t.columns.some((c) => c.attr === attr) ? t : { ...t, columns: [...t.columns, { attr, ...extra }] }));
}

export const dropColumn = (s: Schema, attr: string, from: string): Schema => mapTable(s, from, (t) => ({ ...t, columns: t.columns.filter((c) => c.attr !== attr) }));

export function moveColumn(s: Schema, attr: string, from: string, to: string): Schema {
  if (from === to) return s;
  return dropColumn(addColumn(s, attr, to), attr, from);
}

export const togglePk = (s: Schema, attr: string, on: string): Schema =>
  mapTable(s, on, (t) => ({ ...t, columns: t.columns.map((c) => (c.attr === attr ? { ...c, pk: !c.pk } : c)) }));

export const toggleIndex = (s: Schema, attr: string, on: string): Schema =>
  mapTable(s, on, (t) => ({ ...t, columns: t.columns.map((c) => (c.attr === attr ? { ...c, indexed: !c.indexed } : c)) }));

export const setPk = (s: Schema, attrs: string[], on: string): Schema =>
  mapTable(s, on, (t) => {
    const cols = t.columns.map((c) => ({ ...c, pk: attrs.includes(c.attr) }));
    for (const a of attrs) if (!cols.some((c) => c.attr === a)) cols.push({ attr: a, pk: true });
    // PK columns first, in the requested order
    cols.sort((a, b) => (a.pk === b.pk ? (a.pk ? attrs.indexOf(a.attr) - attrs.indexOf(b.attr) : 0) : a.pk ? -1 : 1));
    return { ...t, columns: cols };
  });

export const moveTable = (s: Schema, id: string, x: number, y: number): Schema => mapTable(s, id, (t) => ({ ...t, x, y }));

export const pkOf = (t: DTable) => t.columns.filter((c) => c.pk).map((c) => c.attr);

/** Draw a relationship child → parent: copy parent's PK into child as a foreign key. */
export function connect(s: Schema, child: string, parent: string): { schema: Schema; added: string[]; error?: string } {
  const p = s.tables.find((t) => t.id === parent);
  const c = s.tables.find((t) => t.id === child);
  if (!p || !c || p.id === c.id) return { schema: s, added: [] };
  const pk = pkOf(p);
  if (!pk.length) return { schema: s, added: [], error: `${p.name} has no primary key, so nothing can reference it. Mark its key column first.` };
  const added = pk.filter((a) => !c.columns.some((col) => col.attr === a));
  let out = s;
  for (const a of added) out = addColumn(out, a, child);
  return { schema: out, added };
}

/** Remove a relationship: drop the FK columns from the child (keeps PK columns). */
export function disconnect(s: Schema, rel: Rel): Schema {
  const c = s.tables.find((t) => t.id === rel.child);
  if (!c) return s;
  let out = s;
  for (const a of rel.attrs) if (!c.columns.find((x) => x.attr === a)?.pk) out = dropColumn(out, a, rel.child);
  return out;
}

export function applyOps(sc: Scenario, base: Schema, ops: Op[]): Schema {
  let s = base;
  for (const op of ops) {
    if ('add' in op) {
      if (!s.tables.some((t) => t.id === op.add)) s = addTable(sc, s, op.add);
    } else if ('remove' in op) s = removeTable(s, op.remove);
    else if ('move' in op) s = moveColumn(s, op.move, op.from, op.to);
    else if ('copy' in op) s = addColumn(s, op.copy, op.to);
    else if ('drop' in op) s = dropColumn(s, op.drop, op.from);
    else if ('pk' in op) s = setPk(s, op.pk, op.on);
    else if ('index' in op) s = mapTable(s, op.on, (t) => ({ ...t, columns: t.columns.map((c) => (c.attr === op.index ? { ...c, indexed: true } : c)) }));
  }
  return s;
}

// ---------------------------------------------------------------- analysis

function analyseTable(m: Model, t: DTable, paradigm: Paradigm, issues: Issue[]): TableInfo {
  const sc = m.sc;
  const pk = pkOf(t);
  const attrs = t.columns.map((c) => c.attr);
  const content = attrs.filter((a) => !m.isTechnical(a) || sc.fds.some((f) => f.rhs.includes(a)));
  const rowBytes = ROW_OVERHEAD + attrs.reduce((s, a) => s + attrBytes(m.attr.get(a)), 0);
  const rows = m.rowsOfKey([...new Set([...pk, ...content])]);
  const byDesign = BY_DESIGN.includes(t.kind) || (paradigm !== 'oltp' && t.kind === 'flat');
  const factish = isFactish(t.kind);
  const info: TableInfo = { id: t.id, name: t.name, kind: t.kind, pk, attrs, rows, rowBytes, bytes: rows * rowBytes, nf: 4, violations: [], anomalies: [], byDesign, undetermined: [] };
  const push = (i: Omit<Issue, 'key' | 'table'>) => issues.push({ ...i, table: t.id, key: `${i.code}:${t.id}:${(i.attrs ?? []).join(',')}` });
  const sevNF: Severity = byDesign ? 'info' : t.kind === 'sat' || paradigm === 'vault' ? 'warn' : 'bad';

  if (!pk.length) {
    info.nf = 0;
    push({
      code: 'no-pk',
      severity: paradigm === 'oltp' || RELATIONAL.includes(t.kind) ? 'bad' : 'warn',
      title: `${t.name} has no primary key`,
      detail: 'Without a key, duplicates can creep in, nothing can reference a row, and updates cannot target exactly one row.',
      fix: 'Mark the column(s) that identify one row as the primary key (click the key icon).',
    });
  }

  const multi = attrs.filter((a) => m.attr.get(a)?.multi);
  if (multi.length && !['feed', 'obt', 'event'].includes(t.kind)) {
    info.nf = 0;
    push({
      code: 'repeating-group',
      severity: sevNF,
      attrs: multi,
      title: `Repeating group in ${t.name}: ${names(sc, multi)}`,
      detail: `A list packed into one column breaks 1NF. You cannot index, join or constrain individual items ("find orders containing P3" becomes a LIKE scan).`,
      fix: 'Move the list into its own table, one row per item, keyed by (parent key, item).',
    });
  }

  if (pk.length) {
    const cl = m.closure(pk);
    const und = content.filter((a) => !cl.has(a));
    info.undetermined = und;
    if (und.length) {
      info.nf = 0;
      const nm = und.filter((a) => m.isEntityKey(a));
      if (nm.length && !factish) {
        push({
          code: 'nm-in-fk',
          severity: sevNF === 'info' ? 'warn' : sevNF,
          attrs: nm,
          title: `Many-to-many squeezed into ${t.name}`,
          detail: `One ${names(sc, pk)} relates to many ${names(sc, nm)}, so a single FK column cannot hold them: you'd duplicate rows (breaking the key) or lose links.`,
          fix: `Create a bridge table keyed by (${names(sc, [...pk, ...nm])}) and remove ${names(sc, nm)} from ${t.name}.`,
        });
      } else {
        const grain = m.grainLabel([...pk, ...und]) ?? m.grainLabel(content);
        push({
          code: 'pk-not-unique',
          severity: factish ? 'bad' : sevNF === 'info' ? 'warn' : sevNF,
          attrs: und,
          title: `${t.name}: key (${names(sc, pk)}) doesn't identify a row`,
          detail: `${names(sc, und)} can take many values per ${names(sc, pk)}${grain ? `; the real grain is one row per ${grain.replace(/s$/, '')}` : ''}. The key will be duplicated or data will be lost.`,
          fix: `Extend the key (e.g. include ${names(sc, und.slice(0, 2))}) or move ${names(sc, und)} to the table they depend on.`,
        });
      }
    } else {
      // partial dependencies
      const nonPrime = content.filter((a) => !pk.includes(a));
      const covered = new Set<string>();
      for (const sub of properSubsets(pk)) {
        const dep = nonPrime.filter((a) => !covered.has(a) && m.closure(sub).has(a) && !sub.includes(a));
        if (dep.length) {
          dep.forEach((a) => covered.add(a));
          info.violations.push({ kind: 'partial', lhs: sub, rhs: dep });
        }
      }
      // transitive / BCNF
      const lhsSeen = new Set<string>();
      for (const fd of sc.fds) {
        if (!subset(fd.lhs, attrs) || lhsSeen.has(fd.lhs.join('|'))) continue;
        if (fd.lhs.every((a) => pk.includes(a)) && fd.lhs.length < pk.length) continue; // partial handled above
        if (m.determines(fd.lhs, content)) continue; // superkey
        lhsSeen.add(fd.lhs.join('|'));
        const cl2 = m.closure(fd.lhs);
        const deps = content.filter((a) => cl2.has(a) && !fd.lhs.includes(a));
        const np = deps.filter((a) => !pk.includes(a) && !covered.has(a));
        const pr = deps.filter((a) => pk.includes(a));
        if (np.length) {
          np.forEach((a) => covered.add(a));
          info.violations.push({ kind: 'transitive', lhs: fd.lhs, rhs: np });
        } else if (pr.length) info.violations.push({ kind: 'bcnf', lhs: fd.lhs, rhs: pr });
      }
      if (info.violations.some((v) => v.kind === 'partial')) info.nf = 1;
      else if (info.violations.some((v) => v.kind === 'transitive')) info.nf = 2;
      else if (info.violations.some((v) => v.kind === 'bcnf')) info.nf = 3;
      if (multi.length && !['feed', 'obt', 'event'].includes(t.kind)) info.nf = 0;
    }
  }

  // anomalies + issues per violation
  for (const v of info.violations) {
    const per = Math.max(1, Math.round(rows / m.rowsOfKey(v.lhs)));
    const lhsKeyed = v.lhs;
    const what = names(sc, v.rhs);
    const who = names(sc, lhsKeyed);
    info.anomalies.push({ kind: 'update', table: t.id, lhs: v.lhs, rhs: v.rhs, rows: per, text: `Changing ${what} for one ${who} rewrites ~${fmtNum(per)} rows of ${t.name}; miss one and the copies disagree.` });
    if (v.kind !== 'bcnf' && !factish) {
      info.anomalies.push({ kind: 'insert', table: t.id, lhs: v.lhs, rhs: v.rhs, text: `You can't record a ${who} (with its ${what}) until a ${t.name} row exists for it.` });
      info.anomalies.push({ kind: 'delete', table: t.id, lhs: v.lhs, rhs: v.rhs, text: `Deleting the last ${t.name} row for a ${who} also deletes its ${what}.` });
    }
    const measures = v.rhs.filter((a) => {
      const ms = m.attr.get(a)?.measure;
      return ms === 'additive' || ms === 'semi';
    });
    if (factish && measures.length) {
      push({
        code: 'coarse-measure',
        severity: 'bad',
        attrs: measures,
        title: `${names(sc, measures)} is at a coarser grain than ${t.name}`,
        detail: `${names(sc, measures)} belongs to one ${who}, but ${t.name} has ~${fmtNum(per)} rows per ${who}. SUM() counts it ~${fmtNum(per)}×.`,
        fix: `Allocate it down to the fact's grain, or keep it in a separate fact at the ${who} grain.`,
      });
    }
    const rest = v.rhs.filter((a) => !measures.includes(a));
    if (!rest.length) continue;
    if (factish) {
      push({
        code: 'dim-attr-in-fact',
        severity: 'warn',
        attrs: rest,
        title: `Descriptive ${names(sc, rest)} stored in ${t.name}`,
        detail: `${names(sc, rest)} describe the ${who}, not the event. Every fact row repeats them (~${fmtNum(per)} copies each), and corrections need a fact rewrite.`,
        fix: `Keep the ${who} key in the fact and move ${names(sc, rest)} to its dimension.`,
      });
    } else {
      const code: IssueCode = v.kind === 'partial' ? 'partial-dep' : v.kind === 'transitive' ? 'transitive-dep' : 'bcnf';
      const label = v.kind === 'partial' ? 'Partial dependency (2NF)' : v.kind === 'transitive' ? 'Transitive dependency (3NF)' : 'BCNF violation';
      push({
        code,
        severity: sevNF,
        attrs: v.rhs,
        title: `${label} in ${t.name}: ${who} → ${what}`,
        detail: byDesign
          ? `Denormalised by design: ${what} repeats ~${fmtNum(per)}× per ${who}. Fine for reads, but changes must be reprocessed (or tracked as history).`
          : v.kind === 'bcnf'
            ? `${who} determines part of the key but isn't a key itself. The same ${who} → ${what} fact is stored ~${fmtNum(per)} times and can contradict itself.`
            : `${what} depends on ${who}, ${v.kind === 'partial' ? 'only part of the key' : 'a non-key column'}. It's stored ~${fmtNum(per)}× and can drift.`,
        fix: byDesign ? undefined : `Move ${what} into a table keyed by ${who}, and keep ${who} here as a foreign key.`,
      });
    }
  }
  return info;
}

function deriveRels(tables: DTable[]): Rel[] {
  const rels: Rel[] = [];
  for (const p of tables) {
    const pk = pkOf(p);
    if (!pk.length) continue;
    for (const c of tables) {
      if (c.id === p.id) continue;
      const cAttrs = c.columns.map((x) => x.attr);
      if (!subset(pk, cAttrs)) continue;
      const cpk = pkOf(c);
      const oneToOne = sameSet(pk, cpk);
      if (oneToOne && rels.some((r) => r.parent === c.id && r.child === p.id)) continue;
      rels.push({ id: `${p.id}>${c.id}`, parent: p.id, child: c.id, attrs: pk, card: oneToOne ? '1:1' : '1:N', identifying: subset(pk, cpk) });
    }
  }
  return rels;
}

function connected(ids: string[], rels: Rel[]): boolean {
  if (ids.length <= 1) return true;
  const seen = new Set([ids[0]]);
  const stack = [ids[0]];
  while (stack.length) {
    const x = stack.pop()!;
    for (const r of rels) {
      const y = r.parent === x ? r.child : r.child === x ? r.parent : undefined;
      if (y && ids.includes(y) && !seen.has(y)) {
        seen.add(y);
        stack.push(y);
      }
    }
  }
  return seen.size === ids.length;
}

function seekable(t: DTable, by: string[]): boolean {
  const pk = pkOf(t);
  if (pk.length && by.includes(pk[0])) return true;
  return t.columns.some((c) => c.indexed && by.includes(c.attr));
}

function analyseRead(m: Model, p: ReadPattern, tables: DTable[], info: Record<string, TableInfo>, rels: Rel[], paradigm: Paradigm, issues: Issue[]): ReadResult {
  const sc = m.sc;
  const need = [...new Set([...p.attrs, ...(p.by ?? []), ...(p.sums ?? [])])];
  const res: ReadResult = { id: p.id, name: p.name, level: 'ok', tables: [], joins: 0, access: 'none', scans: [], rowsRead: 0, missing: [], perSec: p.perSec, maxJoins: p.maxJoins };
  const push = (i: Omit<Issue, 'key' | 'pattern'>) => issues.push({ ...i, pattern: p.id, key: `${i.code}:${p.id}:${i.table ?? ''}` });

  res.missing = need.filter((a) => !tables.some((t) => t.columns.some((c) => c.attr === a)));
  if (res.missing.length) {
    res.level = 'bad';
    push({ code: 'missing-attr', severity: 'bad', attrs: res.missing, title: `“${p.name}” can't be answered`, detail: `No table holds ${names(sc, res.missing)}.`, fix: `Add a table that stores ${names(sc, res.missing)} (drag it from the attribute pool).` });
    return res;
  }

  // smallest connected set of tables covering `need`; tie-break: fewest rows
  const cand = tables.filter((t) => t.columns.some((c) => need.includes(c.attr)) || tables.length <= 12);
  const ids = cand.map((t) => t.id).slice(0, 14);
  let best: string[] | undefined;
  let bestRows = Infinity;
  let anyCover: string[] | undefined;
  const n = ids.length;
  for (let size = 1; size <= n && !best; size++) {
    for (let mask = 1; mask < 1 << n; mask++) {
      if (popcount(mask) !== size) continue;
      const set = ids.filter((_, i) => mask & (1 << i));
      const covered = new Set(set.flatMap((id) => info[id].attrs));
      if (!need.every((a) => covered.has(a))) continue;
      anyCover ??= set;
      if (!connected(set, rels)) continue;
      const r = set.reduce((s, id) => s + info[id].rows, 0);
      if (r < bestRows) {
        best = set;
        bestRows = r;
      }
    }
  }
  if (!best) {
    res.level = 'bad';
    res.tables = anyCover ?? [];
    push({
      code: 'no-join-path',
      severity: 'bad',
      title: `“${p.name}”: no join path`,
      detail: `The data is spread over ${(anyCover ?? []).map((id) => info[id].name).join(', ')}, but nothing links them.`,
      fix: 'Add a foreign key: drag from the child table onto the parent (or put the parent key in the child).',
    });
    return res;
  }
  res.tables = best;
  res.joins = best.length - 1;

  // access path: start from the table filtered by `by` (or the biggest table), walk joins
  const by = p.by ?? [];
  const byT = best.map((id) => tables.find((t) => t.id === id)!);
  const driver = by.length ? (byT.find((t) => by.some((a) => t.columns.some((c) => c.attr === a))) ?? byT[0]) : byT.slice().sort((a, b) => info[b.id].rows - info[a.id].rows)[0];
  const seek = by.length > 0 && seekable(driver, by);
  res.access = seek ? 'seek' : 'scan';
  const perKey = by.length ? Math.max(1, Math.round(info[driver.id].rows / m.rowsOfKey(by.filter((a) => driver.columns.some((c) => c.attr === a))))) : info[driver.id].rows;
  res.rowsRead = seek ? perKey : info[driver.id].rows;
  // a filtered lookup that can't seek is a problem; an unfiltered report scans by nature
  if (!seek && by.length) res.scans.push(driver.id);
  // walk to other tables
  const visited = new Set([driver.id]);
  const queue = [driver.id];
  while (queue.length) {
    const x = queue.shift()!;
    for (const r of rels) {
      const y = r.parent === x ? r.child : r.child === x ? r.parent : undefined;
      if (!y || visited.has(y) || !best.includes(y)) continue;
      visited.add(y);
      queue.push(y);
      const yt = tables.find((t) => t.id === y)!;
      if (r.parent === y) continue; // lookup by the parent's PK: always a seek
      // parent → child: needs the FK to lead an index (or the child's PK)
      if (!seekable(yt, r.attrs)) {
        res.scans.push(y);
        res.rowsRead += info[y].rows;
      } else res.rowsRead += Math.max(1, Math.round(info[y].rows / m.rowsOfKey(r.attrs)));
    }
  }

  // correctness: aggregation
  for (const s of p.sums ?? []) {
    const a = m.attr.get(s);
    const src = byT.find((t) => t.columns.some((c) => c.attr === s));
    if (a?.measure === 'non') {
      res.level = 'bad';
      push({ code: 'non-additive-sum', severity: 'bad', attrs: [s], title: `“${p.name}” sums a non-additive measure`, detail: `${attrName(sc, s)} is a ratio/price; SUM() of it is meaningless.`, fix: `Store the additive parts (e.g. amount and quantity) and compute the ratio after summing.` });
    }
    if (a?.measure === 'semi' && p.overTime) {
      res.level = 'bad';
      push({ code: 'semi-additive-sum', severity: 'bad', attrs: [s], title: `“${p.name}” sums ${attrName(sc, s)} across time`, detail: `Balances/levels are semi-additive: sum across accounts, never across days (30 daily snapshots ≠ 30× the money).`, fix: 'Use the period-end value (or AVG over days) for the time dimension.' });
    }
    if (src) {
      const fan = rels.find((r) => r.parent === src.id && r.card === '1:N' && best!.includes(r.child) && info[r.child].rows > info[src.id].rows);
      if (fan) {
        res.level = 'bad';
        push({
          code: 'fan-trap',
          severity: 'bad',
          table: src.id,
          attrs: [s],
          title: `Fan trap in “${p.name}”`,
          detail: `${attrName(sc, s)} lives in ${info[src.id].name} (one row per ${info[src.id].name}) but the query also joins ${info[fan.child].name}, which has ~${fmtNum(info[fan.child].rows / info[src.id].rows)} rows per parent. SUM() over-counts.`,
          fix: `Aggregate each grain separately, or store the measure at the finer grain.`,
        });
      }
    }
  }
  for (const id of best) {
    const coarse = issues.find((i) => i.code === 'coarse-measure' && i.table === id && i.attrs?.some((a) => p.sums?.includes(a)));
    if (coarse) res.level = 'bad';
  }

  if (res.level === 'ok') {
    if (res.joins > p.maxJoins) {
      res.level = 'warn';
      push({
        code: 'too-many-joins',
        severity: 'warn',
        title: `“${p.name}” needs ${res.joins} joins (budget ${p.maxJoins})`,
        detail: `At ${fmtNum(p.perSec)}/s every extra join is extra latency and CPU on the hot path.`,
        fix: paradigm === 'olap' ? 'Flatten the snowflaked dimension into the star.' : 'Consider a denormalised read model or keep these attributes closer together.',
      });
    }
    if (paradigm === 'oltp' && res.scans.length) {
      res.level = 'warn';
      const st = res.scans.map((id) => info[id].name).join(', ');
      push({
        code: 'scan',
        severity: p.perSec >= 50 ? 'bad' : 'warn',
        title: `“${p.name}” scans ${st}`,
        detail: `No index leads with the filter/join column, so each call reads ~${fmtNum(res.rowsRead)} rows instead of a handful.`,
        fix: `Index ${res.scans.map((id) => info[id].name).join(', ')} on the column you filter or join by (click the index icon).`,
      });
      if (p.perSec >= 50) res.level = 'bad';
    }
  }
  return res;
}

function popcount(x: number) {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

function analyseWrite(m: Model, p: WritePattern, tables: DTable[], info: Record<string, TableInfo>, paradigm: Paradigm, issues: Issue[]): WriteResult {
  const sc = m.sc;
  const perTable: { table: string; rows: number }[] = [];
  for (const t of tables) {
    if (!t.columns.some((c) => p.changes.includes(c.attr))) continue;
    const ti = info[t.id];
    const rows = m.determines(p.by, ti.attrs.filter((a) => !m.isTechnical(a))) ? 1 : Math.max(1, Math.round(ti.rows / m.rowsOfKey(p.by)));
    perTable.push({ table: t.id, rows });
  }
  const rows = perTable.reduce((s, x) => s + x.rows, 0);
  const level: Level = rows <= Math.max(1, perTable.length) && perTable.length <= 1 ? 'ok' : rows <= 50 ? 'warn' : 'bad';
  if (level !== 'ok' && paradigm === 'oltp') {
    const worst = perTable.slice().sort((a, b) => b.rows - a.rows)[0];
    issues.push({
      key: `write-amplification:${p.id}`,
      code: 'write-amplification',
      severity: level === 'bad' && p.perSec >= 1 ? 'warn' : 'info',
      pattern: p.id,
      title: `“${p.name}” touches ${fmtNum(rows)} rows`,
      detail: `${names(sc, p.changes)} is stored in ${perTable.length} place${perTable.length > 1 ? 's' : ''}; the worst is ${info[worst.table].name} (~${fmtNum(worst.rows)} rows per change). More rows = longer locks, more WAL, more chances to miss one.`,
      fix: 'Store it once, keyed by what it describes, or accept it consciously for a read model (refresh asynchronously).',
    });
  }
  return { id: p.id, name: p.name, level, rows, perTable, perSec: p.perSec };
}

export function analyze(sc: Scenario, schema: Schema, model?: Model): Impact {
  const m = model ?? new Model(sc);
  const issues: Issue[] = [];
  const tables: Record<string, TableInfo> = {};
  for (const t of schema.tables) tables[t.id] = analyseTable(m, t, sc.paradigm, issues);
  const rels = deriveRels(schema.tables);

  // natural key in fact where the dim has a surrogate
  if (sc.paradigm === 'olap') {
    for (const f of schema.tables.filter((t) => isFactish(t.kind))) {
      for (const d of schema.tables.filter((t) => t.kind === 'dim')) {
        const dpk = pkOf(d);
        if (!dpk.length || !dpk.every((a) => m.isTechnical(a))) continue;
        const nat = d.columns.find((c) => !c.pk && m.isEntityKey(c.attr) && f.columns.some((x) => x.attr === c.attr && !x.pk));
        if (nat && !rels.some((r) => r.parent === d.id && r.child === f.id))
          issues.push({
            key: `natural-key-fact:${f.id}:${d.id}`,
            code: 'natural-key-fact',
            severity: 'warn',
            table: f.id,
            attrs: [nat.attr],
            title: `${f.name} joins ${d.name} on the natural key`,
            detail: `${d.name} has a surrogate key, but ${f.name} stores ${attrName(sc, nat.attr)}. With history (SCD2) a natural key matches several versions and the join fans out.`,
            fix: `Store ${names(sc, dpk)} in the fact (look it up at load time).`,
          });
      }
    }
  }

  // orphans
  if (schema.tables.length > 1)
    for (const t of schema.tables)
      if (!rels.some((r) => r.parent === t.id || r.child === t.id) && !['obt', 'aggregate', 'feed'].includes(t.kind))
        issues.push({ key: `orphan-table:${t.id}`, code: 'orphan-table', severity: 'info', table: t.id, title: `${t.name} is not connected`, detail: 'No foreign key links it to the rest of the model, so no query can join it.', fix: 'Drag from the child table onto the parent to add a foreign key.' });

  // duplication of non-key attributes across tables
  const keyAttrs = new Set(schema.tables.flatMap((t) => pkOf(t)));
  const where = new Map<string, string[]>();
  for (const t of schema.tables) for (const c of t.columns) if (!keyAttrs.has(c.attr) && !m.isTechnical(c.attr)) where.set(c.attr, [...(where.get(c.attr) ?? []), t.id]);
  const duplicated = [...where].filter(([, ts]) => ts.length > 1).map(([attr, ts]) => ({ attr, tables: ts }));
  let dupBytes = 0;
  for (const d of duplicated) {
    const sizes = d.tables.map((id) => tables[id].rows).sort((a, b) => a - b);
    dupBytes += sizes.slice(1).reduce((s, r) => s + r * attrBytes(m.attr.get(d.attr)), 0);
    const designed = d.tables.every((id) => tables[id].byDesign || isFactish(tables[id].kind)) || sc.paradigm !== 'oltp';
    if (!issues.some((i) => i.attrs?.includes(d.attr) && (i.code === 'transitive-dep' || i.code === 'partial-dep' || i.code === 'dim-attr-in-fact')))
      issues.push({
        key: `duplicated:${d.attr}`,
        code: 'duplicated',
        severity: designed || d.tables.some((id) => tables[id].byDesign) ? 'info' : 'warn',
        attrs: [d.attr],
        title: `${attrName(sc, d.attr)} is stored in ${d.tables.length} tables`,
        detail: `${d.tables.map((id) => tables[id].name).join(' and ')} both hold it. Two copies need a sync mechanism (trigger, CDC, job) or they drift.`,
        fix: 'Keep one source of truth; derive the copy asynchronously if reads need it.',
      });
  }

  const reads: Record<string, ReadResult> = {};
  const writes: Record<string, WriteResult> = {};
  for (const p of sc.patterns as AccessPattern[]) {
    if (p.kind === 'read') reads[p.id] = analyseRead(m, p, schema.tables, tables, rels, sc.paradigm, issues);
    else writes[p.id] = analyseWrite(m, p, schema.tables, tables, sc.paradigm, issues);
  }

  const placed = new Set(schema.tables.flatMap((t) => t.columns.map((c) => c.attr)));
  const unplaced = sc.attrs.filter((a) => !a.technical && !placed.has(a.id)).map((a) => a.id);
  const storage = Object.values(tables).reduce((s, t) => s + t.bytes, 0);
  const counts = {
    bad: issues.filter((i) => i.severity === 'bad').length,
    warn: issues.filter((i) => i.severity === 'warn').length,
    info: issues.filter((i) => i.severity === 'info').length,
    anomalies: Object.values(tables).reduce((s, t) => s + (t.byDesign ? 0 : t.anomalies.length), 0),
  };
  return { paradigm: sc.paradigm, tables, order: schema.tables.map((t) => t.id), rels, reads, writes, issues, storage, dupBytes, duplicated, unplaced, counts };
}

// ---------------------------------------------------------------- diff → "what changed"

export const NF_LABEL = ['0NF', '1NF', '2NF', '3NF', 'BCNF'];
export const nfLabel = (t: TableInfo) => (t.pk.length ? NF_LABEL[t.nf] : 'no key');

export type DiffTone = 'ok' | 'warn' | 'bad' | 'info';
export interface DiffLine {
  tone: DiffTone;
  text: string;
}

const RANK: Record<Level, number> = { ok: 0, warn: 1, bad: 2 };

/** Human-readable impact of going from `a` to `b`. Most important lines first. */
export function diffImpact(sc: Scenario, a: Impact, b: Impact): DiffLine[] {
  const out: (DiffLine & { w: number })[] = [];
  const add = (tone: DiffTone, text: string, w: number) => out.push({ tone, text, w });

  for (const id of b.order) {
    const tb = b.tables[id];
    const ta = a.tables[id];
    if (!ta) continue;
    if (ta.nf !== tb.nf && !tb.byDesign && !isFactish(tb.kind) && ta.pk.length && tb.pk.length) add(tb.nf > ta.nf ? 'ok' : 'bad', `${tb.name}: ${nfLabel(ta)} → ${nfLabel(tb)}`, 6);
    if (ta.rows !== tb.rows) add('info', `${tb.name} grain: ${fmtNum(ta.rows)} → ${fmtNum(tb.rows)} rows`, 3);
  }

  // issues resolved / introduced
  const ka = new Map(a.issues.map((i) => [i.key, i]));
  const kb = new Map(b.issues.map((i) => [i.key, i]));
  for (const [k, i] of kb) if (!ka.has(k) && i.severity !== 'info') add(i.severity === 'bad' ? 'bad' : 'warn', `New: ${i.title}`, i.severity === 'bad' ? 9 : 7);
  for (const [k, i] of ka) if (!kb.has(k) && i.severity !== 'info') add('ok', `Fixed: ${i.title}`, i.severity === 'bad' ? 8 : 6);

  // anomalies
  if (a.counts.anomalies !== b.counts.anomalies) add(b.counts.anomalies < a.counts.anomalies ? 'ok' : 'warn', `Write anomalies: ${a.counts.anomalies} → ${b.counts.anomalies}`, 5);

  // reads
  for (const p of sc.patterns) {
    if (p.kind !== 'read') continue;
    const ra = a.reads[p.id];
    const rb = b.reads[p.id];
    if (!ra || !rb) continue;
    if (ra.joins !== rb.joins && ra.missing.length === 0 && rb.missing.length === 0 && ra.tables.length && rb.tables.length) {
      const d = rb.joins - ra.joins;
      add(d > 0 ? (rb.joins > rb.maxJoins ? 'bad' : 'info') : 'ok', `“${p.name}”: ${ra.joins} → ${rb.joins} join${rb.joins === 1 ? '' : 's'} (${d > 0 ? '+' : ''}${d}${d > 0 && rb.joins <= rb.maxJoins ? `, within budget ${rb.maxJoins}` : ''})`, 5);
    }
    if (ra.access !== rb.access && ra.access !== 'none' && rb.access !== 'none') add(rb.access === 'seek' ? 'ok' : 'warn', `“${p.name}”: ${ra.access} → ${rb.access} (~${fmtNum(ra.rowsRead)} → ~${fmtNum(rb.rowsRead)} rows read)`, 5);
    else if (ra.rowsRead && rb.rowsRead && Math.abs(Math.log10(Math.max(1, rb.rowsRead)) - Math.log10(Math.max(1, ra.rowsRead))) >= 1) add(rb.rowsRead < ra.rowsRead ? 'ok' : 'warn', `“${p.name}”: ~${fmtNum(ra.rowsRead)} → ~${fmtNum(rb.rowsRead)} rows read per call`, 4);
    if (ra.level !== rb.level && !out.some((l) => l.text.includes(p.name))) add(RANK[rb.level] < RANK[ra.level] ? 'ok' : rb.level === 'bad' ? 'bad' : 'warn', `“${p.name}” is now ${rb.level === 'ok' ? 'served well' : rb.level === 'warn' ? 'slower than it should be' : 'broken'}`, 4);
  }
  // writes
  for (const p of sc.patterns) {
    if (p.kind !== 'write') continue;
    const wa = a.writes[p.id];
    const wb = b.writes[p.id];
    if (!wa || !wb || fmtNum(wa.rows) === fmtNum(wb.rows)) continue;
    add(wb.rows < wa.rows ? 'ok' : 'warn', `“${p.name}”: ${fmtNum(wa.rows)} → ${fmtNum(wb.rows)} rows touched per change`, 5);
  }
  if (a.storage && b.storage && Math.abs(b.storage - a.storage) / a.storage > 0.02) {
    const pct = Math.round(((b.storage - a.storage) / a.storage) * 100);
    add(pct < 0 ? 'ok' : 'info', `Storage ${fmtBytes(a.storage)} → ${fmtBytes(b.storage)} (${pct > 0 ? '+' : ''}${pct}%)`, 2);
  }
  if (a.unplaced.length !== b.unplaced.length && b.unplaced.length > a.unplaced.length) add('warn', `${b.unplaced.length - a.unplaced.length} attribute(s) no longer stored anywhere: data loss`, 8);

  return out.sort((x, y) => y.w - x.w).map(({ tone, text }) => ({ tone, text }));
}

export { sameSet, subset };
