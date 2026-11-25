/**
 * Engine core shared by the browser worker and the Node validator: runs SQL on a PGlite
 * instance and normalises results to plain, structured-clone-safe values.
 */
import type { PGlite } from '@electric-sql/pglite';

export type Cell = string | number | boolean | null;

export interface QueryResult {
  columns: string[];
  /** Postgres type OIDs, parallel to `columns`. */
  types: number[];
  rows: Cell[][];
  /** Total rows returned (rows may be truncated to `maxRows`). */
  rowCount: number;
  /** Rows changed by INSERT/UPDATE/DELETE when there is no RETURNING. */
  affected?: number;
  truncated?: boolean;
  ms: number;
}

export interface RunOpts {
  /** Wrap in BEGIN … ROLLBACK so nothing persists (default true outside the Lab). */
  rollback?: boolean;
  /** Statements run first inside the same transaction (e.g. CREATE INDEX). */
  setup?: string;
  maxRows?: number;
}

export interface SqlErrorInfo {
  message: string;
  position?: number;
  hint?: string;
  detail?: string;
  code?: string;
}

const asText = (x: string) => x;
// Keep dates/timestamps/intervals as Postgres' own text; make numerics real numbers.
const PARSERS: Record<number, (x: string) => unknown> = {
  1082: asText, // date
  1083: asText, // time
  1114: asText, // timestamp
  1184: asText, // timestamptz
  1186: asText, // interval
  1700: (x) => {
    const n = Number(x);
    return Number.isFinite(n) && Math.abs(n) < 2 ** 53 ? n : x;
  },
  20: (x) => {
    const n = Number(x);
    return Number.isSafeInteger(n) ? n : x;
  },
};

export function toCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/(:00)?\.000Z$/, '');
  if (Array.isArray(v)) return `{${v.map((x) => (x === null ? 'NULL' : String(toCell(x)))).join(',')}}`;
  if (v instanceof Uint8Array) return `\\x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  return JSON.stringify(v);
}

export function errorInfo(e: unknown): SqlErrorInfo {
  const err = e as { message?: string; position?: string | number; hint?: string; detail?: string; code?: string };
  return {
    message: err?.message ?? String(e),
    position: err?.position !== undefined && err.position !== '' ? Number(err.position) : undefined,
    hint: err?.hint || undefined,
    detail: err?.detail || undefined,
    code: err?.code || undefined,
  };
}

export async function runSql(pg: PGlite, sql: string, opts: RunOpts = {}): Promise<QueryResult> {
  const { rollback = true, setup, maxRows = 2000 } = opts;
  const t0 = performance.now();
  let results: Awaited<ReturnType<PGlite['exec']>>;
  if (rollback) {
    await pg.exec('BEGIN');
    try {
      if (setup) await pg.exec(setup);
      results = await pg.exec(sql, { rowMode: 'array', parsers: PARSERS });
    } finally {
      await pg.exec('ROLLBACK');
    }
  } else {
    if (setup) await pg.exec(setup);
    results = await pg.exec(sql, { rowMode: 'array', parsers: PARSERS });
  }
  const ms = performance.now() - t0;
  // the last statement that returned columns wins; otherwise the last statement
  const withCols = [...results].reverse().find((r) => r.fields.length > 0);
  const last = withCols ?? results[results.length - 1];
  if (!last) return { columns: [], types: [], rows: [], rowCount: 0, ms };
  const raw = (last.rows as unknown[][]) ?? [];
  const rows = raw.slice(0, maxRows).map((r) => r.map(toCell));
  return {
    columns: last.fields.map((f) => f.name),
    types: last.fields.map((f) => f.dataTypeID),
    rows,
    rowCount: raw.length,
    affected: withCols ? undefined : last.affectedRows,
    truncated: raw.length > maxRows,
    ms,
  };
}

/** EXPLAIN (FORMAT JSON) → the plan object. `analyze` actually executes (inside a rolled-back transaction). */
export async function explainSql(pg: PGlite, sql: string, analyze: boolean, setup?: string): Promise<unknown> {
  const stmt = `EXPLAIN (FORMAT JSON, COSTS true${analyze ? ', ANALYZE true, BUFFERS false, TIMING true' : ''}) ${sql.trim().replace(/;\s*$/, '')}`;
  await pg.exec('BEGIN');
  try {
    if (setup) await pg.exec(setup);
    const r = await pg.query<Record<string, unknown>>(stmt);
    const v = r.rows[0]?.['QUERY PLAN'];
    const plan = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(plan) ? plan[0] : plan;
  } finally {
    await pg.exec('ROLLBACK');
  }
}
