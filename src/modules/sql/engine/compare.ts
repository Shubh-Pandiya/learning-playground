/** Result-set equality (for grading) and diffs (for "what changed" after every edit). */
import type { Cell, QueryResult } from './core';

const norm = (c: Cell): string => {
  if (c === null) return '∅';
  if (typeof c === 'number') return Number.isInteger(c) ? String(c) : String(Math.round(c * 1e6) / 1e6);
  if (typeof c === 'boolean') return c ? 't' : 'f';
  const n = Number(c);
  if (c.trim() !== '' && Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(c.trim())) return String(Math.round(n * 1e6) / 1e6);
  return c;
};
export const rowKey = (r: Cell[]) => r.map(norm).join('\u241f');

export interface Verdict {
  ok: boolean;
  /** Human-readable reason when not ok. */
  reason?: string;
  missing: number;
  extra: number;
}

/**
 * Compare learner vs reference by value (column names ignored, column order respected).
 * Order is compared only when `ordered`.
 */
export function compareResults(got: QueryResult, want: QueryResult, ordered: boolean): Verdict {
  if (got.columns.length !== want.columns.length) {
    return {
      ok: false,
      missing: 0,
      extra: 0,
      reason: `Expected ${want.columns.length} column${want.columns.length === 1 ? '' : 's'} (${want.columns.join(', ')}), got ${got.columns.length} (${got.columns.join(', ')}).`,
    };
  }
  const d = diffRows(want.rows, got.rows);
  if (d.added.length || d.removed.length) {
    const parts = [];
    if (got.rowCount !== want.rowCount) parts.push(`Expected ${want.rowCount} rows, got ${got.rowCount}.`);
    if (d.removed.length) parts.push(`${d.removed.length} expected row${d.removed.length === 1 ? ' is' : 's are'} missing.`);
    if (d.added.length) parts.push(`${d.added.length} row${d.added.length === 1 ? '' : 's'} shouldn’t be there.`);
    return { ok: false, missing: d.removed.length, extra: d.added.length, reason: parts.join(' ') };
  }
  if (ordered) {
    const bad = want.rows.findIndex((r, i) => rowKey(r) !== rowKey(got.rows[i] ?? []));
    if (bad >= 0) return { ok: false, missing: 0, extra: 0, reason: `Right rows, wrong order (first difference at row ${bad + 1}). Check ORDER BY direction, tie-breakers and NULLS FIRST/LAST.` };
  }
  return { ok: true, missing: 0, extra: 0 };
}

export interface RowDiff {
  /** rows in `next` not in `prev` (multiset) */
  added: Cell[][];
  /** rows in `prev` not in `next` */
  removed: Cell[][];
  same: number;
}

export function diffRows(prev: Cell[][], next: Cell[][]): RowDiff {
  const bag = new Map<string, number>();
  prev.forEach((r) => bag.set(rowKey(r), (bag.get(rowKey(r)) ?? 0) + 1));
  const added: Cell[][] = [];
  let same = 0;
  for (const r of next) {
    const k = rowKey(r);
    const c = bag.get(k) ?? 0;
    if (c > 0) {
      bag.set(k, c - 1);
      same++;
    } else added.push(r);
  }
  const left = new Map(bag);
  const removed = prev.filter((r) => {
    const k = rowKey(r);
    const c = left.get(k) ?? 0;
    if (c > 0) {
      left.set(k, c - 1);
      return true;
    }
    return false;
  });
  return { added, removed, same };
}

export interface ResultChange {
  rowsBefore: number;
  rowsAfter: number;
  colsAdded: string[];
  colsRemoved: string[];
  added: Cell[][];
  removed: Cell[][];
  /** Comparable only when the column lists are equal. */
  comparable: boolean;
  /** One-line summary, e.g. "+3 rows (12 → 15), 2 rows changed". */
  summary: string;
}

export function describeChange(prev: QueryResult, next: QueryResult): ResultChange {
  const colsAdded = next.columns.filter((c) => !prev.columns.includes(c));
  const colsRemoved = prev.columns.filter((c) => !next.columns.includes(c));
  const comparable = prev.columns.length === next.columns.length && prev.columns.every((c, i) => c === next.columns[i]);
  const d = comparable ? diffRows(prev.rows, next.rows) : { added: [], removed: [], same: 0 };
  const parts: string[] = [];
  const dr = next.rowCount - prev.rowCount;
  parts.push(dr === 0 ? `${next.rowCount} rows (same count)` : `${dr > 0 ? '+' : '−'}${Math.abs(dr)} rows (${prev.rowCount} → ${next.rowCount})`);
  if (colsAdded.length) parts.push(`+col ${colsAdded.join(', ')}`);
  if (colsRemoved.length) parts.push(`−col ${colsRemoved.join(', ')}`);
  if (comparable && (d.added.length || d.removed.length)) {
    if (dr === 0) parts.push(`${d.added.length} row${d.added.length === 1 ? '' : 's'} changed value`);
    else parts.push(`${d.added.length} new, ${d.removed.length} gone`);
  } else if (comparable && dr === 0) parts.push('identical result');
  return { rowsBefore: prev.rowCount, rowsAfter: next.rowCount, colsAdded, colsRemoved, added: d.added, removed: d.removed, comparable, summary: parts.join(' · ') };
}
