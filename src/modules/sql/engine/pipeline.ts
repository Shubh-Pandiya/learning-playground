/**
 * Logical query processing, made visible. Takes one SELECT, derives a real query for every
 * stage (FROM → JOIN → WHERE → GROUP BY → HAVING → window → SELECT → DISTINCT → ORDER BY → LIMIT),
 * runs each against Postgres and annotates what changed and why it matters.
 *
 * Runs anywhere a `Runner` exists (browser worker client, or PGlite directly in Node).
 */
import type { StageId } from '../types';
import type { Cell, QueryResult } from './core';
import {
  hasAggregate,
  isDesc,
  isWindowExpr,
  outputName,
  parseQuery,
  parseWindow,
  relationAlias,
  sortExpr,
  splitAlias,
  type ParsedQuery,
  type WindowSpec,
} from './parse';

export type Runner = (sql: string, opts?: { maxRows?: number }) => Promise<QueryResult>;

export type RowTag = 'kept' | 'dropped' | 'nullext' | 'fanout' | 'rightonly' | 'ghost';

export interface PipelineStage {
  key: string;
  id: StageId;
  title: string;
  /** The clause text this stage evaluates, as written. */
  clause: string;
  sql: string;
  columns: string[];
  rows: Cell[][];
  truncated: boolean;
  inCount: number;
  outCount: number;
  /** Columns introduced by this stage (highlighted). */
  newCols?: number[];
  rowTags?: RowTag[];
  /** WHERE / HAVING: per-row truth value of each conjunct. */
  checks?: { preds: string[]; values: (boolean | null)[][] };
  /** GROUP BY / window: group or partition index per row (for colouring). */
  groupIds?: number[];
  /** GROUP BY: the collapsed groups (keys + aggregates + row count). */
  groups?: { columns: string[]; rows: Cell[][] };
  window?: { spec: WindowSpec; alias: string; valueCol: number; orderVals: Cell[][]; desc: boolean[]; others: string[] };
  /** Recursive CTE: iteration number per row (when a level column is known). */
  iterations?: number[];
  narration: string[];
  impact: string[];
  warn: string[];
  error?: string;
}

export interface Pipeline {
  parsed: ParsedQuery;
  stages: PipelineStage[];
  final: QueryResult;
}

export const STAGE_ORDER: StageId[] = ['cte', 'from', 'join', 'where', 'group', 'having', 'window', 'select', 'distinct', 'order', 'limit'];

export const STAGE_LABEL: Record<StageId, string> = {
  cte: 'WITH',
  from: 'FROM',
  join: 'JOIN',
  where: 'WHERE',
  group: 'GROUP BY',
  having: 'HAVING',
  window: 'WINDOW',
  select: 'SELECT',
  distinct: 'DISTINCT',
  order: 'ORDER BY',
  limit: 'LIMIT',
};

const MAX = 400;

const ISO_TS = /^(\d{4}-\d\d-\d\d)T(\d\d:\d\d(?::\d\d(?:\.\d+)?)?)$/;
function jsonCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const m = v.match(ISO_TS);
    return m ? `${m[1]} ${m[2]}` : v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return JSON.stringify(v);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const truth = (c: Cell): boolean | null => (c === null ? null : c === true || c === 't' || c === 'true');
const keyOf = (cells: Cell[]) => JSON.stringify(cells);

interface Rel {
  alias: string;
  columns: string[];
}

/** Build all stages. Returns null if the query can't be staged (UNION, DML, …). */
export async function buildPipeline(sqlText: string, run: Runner, opts: { recursiveLevel?: string } = {}): Promise<Pipeline | null> {
  const q = parseQuery(sqlText);
  if (!q) return null;
  const final = await run(sqlText, { maxRows: MAX });

  const W = q.ctes.length ? `WITH ${q.recursive ? 'RECURSIVE ' : ''}${q.ctes.map((c) => c.text).join(',\n')}\n` : '';
  const stages: PipelineStage[] = [];
  const blank = (id: StageId, key: string, title: string, clause: string): PipelineStage => ({
    key,
    id,
    title,
    clause,
    sql: '',
    columns: [],
    rows: [],
    truncated: false,
    inCount: 0,
    outCount: 0,
    narration: [],
    impact: [],
    warn: [],
  });
  const safe = async (s: PipelineStage, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      s.error = (e as Error)?.message ?? String(e);
    }
    stages.push(s);
  };

  // ---- CTEs --------------------------------------------------------------
  for (const c of q.ctes) {
    const s = blank('cte', `cte:${c.name}`, `CTE ${c.name}`, c.text);
    await safe(s, async () => {
      s.sql = `${W}SELECT * FROM ${c.name}`;
      const r = await run(s.sql, { maxRows: MAX });
      Object.assign(s, { columns: r.columns, rows: r.rows, truncated: !!r.truncated, inCount: 0, outCount: r.rowCount });
      const recursive = q.recursive && new RegExp(`\\b${c.name}\\b`, 'i').test(c.body.replace(/^[\s\S]*?\bUNION\b/i, ''));
      s.narration.push(`\`${c.name}\` is computed into a ${plural(r.rowCount, 'row')} × ${plural(r.columns.length, 'column')} relation. Later stages read it exactly like a table.`);
      if (recursive) {
        const lvl = opts.recursiveLevel ? r.columns.indexOf(opts.recursiveLevel) : -1;
        if (lvl >= 0) {
          s.iterations = r.rows.map((row) => Number(row[lvl]));
          const counts = new Map<number, number>();
          s.iterations.forEach((it) => counts.set(it, (counts.get(it) ?? 0) + 1));
          const parts = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `level ${k}: ${v}`);
          s.narration.push(`Recursive: the anchor member ran once, then the recursive member re-ran on **only the previous iteration's new rows** until it produced none (${parts.join(', ')}).`);
        } else {
          s.narration.push('Recursive: anchor runs once; the recursive member keeps joining the previous iteration’s rows until an iteration adds nothing.');
        }
        s.impact.push('A recursive CTE without a terminating condition (depth limit, or UNION instead of UNION ALL on cyclic data) never stops — always bound it.');
      } else {
        s.impact.push('Postgres 12+ inlines a non-recursive CTE referenced once (like a subquery); add MATERIALIZED to force it to be computed once and reused.');
      }
    });
  }

  // ---- relations ---------------------------------------------------------
  const fromItems = q.from;
  const rels: Rel[] = [];
  const aliasesOk = fromItems.every((f) => relationAlias(f)) && q.joins.every((j) => j.alias);
  const allFrom = (k: number) => [fromItems.join(', '), ...q.joins.slice(0, k).map((j) => j.text)].join('\n');
  if (aliasesOk) {
    try {
      const all = [...fromItems.map((f) => relationAlias(f)!), ...q.joins.map((j) => j.alias!)];
      for (const a of all) {
        const r = await run(`${W}SELECT ${a}.* FROM ${allFrom(q.joins.length)} LIMIT 0`);
        rels.push({ alias: a, columns: r.columns });
      }
    } catch {
      rels.length = 0;
    }
  }
  const structured = rels.length === fromItems.length + q.joins.length;
  const relCols = (n: number) => rels.slice(0, n).flatMap((r) => r.columns.map((c) => `${r.alias}.${c}`));
  const relSelect = (n: number) => rels.slice(0, n).map((r) => `to_json(${r.alias})::text`);
  const flatten = (row: Cell[], n: number): { cells: Cell[]; nulls: boolean[] } => {
    const cells: Cell[] = [];
    const nulls: boolean[] = [];
    rels.slice(0, n).forEach((r, k) => {
      const raw = row[k];
      nulls.push(raw === null);
      if (raw === null) {
        r.columns.forEach(() => cells.push(null));
        return;
      }
      const v = JSON.parse(String(raw));
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) r.columns.forEach((c) => cells.push(jsonCell((v as Record<string, unknown>)[c])));
      else cells.push(jsonCell(v), ...r.columns.slice(1).map(() => null));
    });
    return { cells, nulls };
  };

  const whereSql = q.where.length ? `\nWHERE ${q.where.map((p) => `(${p})`).join(' AND ')}` : '';
  const selectExprs = q.select.map((it) => splitAlias(it));
  const grouped = q.groupBy.length > 0 || q.select.some((it) => !isWindowExpr(it) && hasAggregate(it)) || q.having.length > 0;
  const groupExprs = q.groupBy.map((g) => resolveRef(g, q));
  const groupSql = q.groupBy.length ? `\nGROUP BY ${groupExprs.join(', ')}` : '';
  const havingSql = q.having.length ? `\nHAVING ${q.having.map((p) => `(${p})`).join(' AND ')}` : '';

  // ---- FROM --------------------------------------------------------------
  const nFrom = fromItems.length;
  let prevRows: Cell[][] = [];
  let prevCount = 0;
  {
    const s = blank('from', 'from', 'FROM', `FROM ${fromItems.join(', ')}`);
    await safe(s, async () => {
      if (structured) {
        s.sql = `${W}SELECT ${relSelect(nFrom).join(', ')}\nFROM ${fromItems.join(', ')}`;
        const r = await run(s.sql, { maxRows: MAX });
        s.columns = relCols(nFrom);
        s.rows = r.rows.map((row) => flatten(row, nFrom).cells);
        s.truncated = !!r.truncated;
        s.outCount = r.rowCount;
      } else {
        s.sql = `${W}SELECT * FROM ${fromItems.join(', ')}`;
        const r = await run(s.sql, { maxRows: MAX });
        Object.assign(s, { columns: r.columns, rows: r.rows, truncated: !!r.truncated, outCount: r.rowCount });
      }
      prevRows = s.rows;
      prevCount = s.outCount;
      if (nFrom > 1) {
        s.narration.push(`A comma between FROM items is a **CROSS JOIN**: every row of one is paired with every row of the other → ${plural(s.outCount, 'row')}.`);
        s.impact.push('Without a join condition in WHERE this is a Cartesian product; on real tables it explodes (10k × 10k = 100M rows).');
      } else {
        s.narration.push(`Execution starts from the data, not from SELECT: \`${fromItems[0]}\` supplies ${plural(s.outCount, 'row')} × ${plural(s.columns.length, 'column')}.`);
      }
      s.impact.push('Every later clause only ever sees this working set; nothing in SELECT has been computed yet, so its aliases don’t exist here.');
    });
  }

  // ---- JOINs -------------------------------------------------------------
  for (let k = 0; k < q.joins.length; k++) {
    const j = q.joins[k];
    const s = blank('join', `join:${k}`, j.kind, j.text);
    s.inCount = prevCount;
    await safe(s, async () => {
      const n = nFrom + k + 1;
      if (!structured) {
        s.sql = `${W}SELECT * FROM ${allFrom(k + 1)}`;
        const r = await run(s.sql, { maxRows: MAX });
        Object.assign(s, { columns: r.columns, rows: r.rows, truncated: !!r.truncated, outCount: r.rowCount });
        prevCount = s.outCount;
        prevRows = s.rows;
        return;
      }
      s.sql = `${W}SELECT ${relSelect(n).join(', ')}\nFROM ${allFrom(k + 1)}`;
      const r = await run(s.sql, { maxRows: MAX });
      const flat = r.rows.map((row) => flatten(row, n));
      s.columns = relCols(n);
      const leftWidth = relCols(n - 1).length;
      s.newCols = s.columns.map((_, i) => i).filter((i) => i >= leftWidth);
      s.rows = flat.map((f) => f.cells);
      s.truncated = !!r.truncated;
      s.outCount = r.rowCount;

      // per left-row identity: how many output rows did each input row become?
      const leftKey = (cells: Cell[]) => keyOf(cells.slice(0, leftWidth));
      const prevCounts = new Map<string, number>();
      prevRows.forEach((row) => prevCounts.set(keyOf(row), (prevCounts.get(keyOf(row)) ?? 0) + 1));
      const nowCounts = new Map<string, number>();
      const rightOnly = flat.filter((f) => f.nulls.slice(0, n - 1).every(Boolean)).length;
      flat.forEach((f) => {
        if (f.nulls.slice(0, n - 1).every(Boolean)) return;
        const key = leftKey(f.cells);
        nowCounts.set(key, (nowCounts.get(key) ?? 0) + 1);
      });
      s.rowTags = flat.map((f) => {
        if (f.nulls.slice(0, n - 1).every(Boolean)) return 'rightonly';
        if (f.nulls[n - 1]) return 'nullext';
        const key = leftKey(f.cells);
        return (nowCounts.get(key) ?? 0) > (prevCounts.get(key) ?? 1) ? 'fanout' : 'kept';
      });
      let dropped = 0;
      const ghostRows: Cell[][] = [];
      const seen = new Map<string, number>();
      for (const row of prevRows) {
        const key = keyOf(row);
        const used = seen.get(key) ?? 0;
        seen.set(key, used + 1);
        if (!nowCounts.has(key) && used === 0) {
          dropped += prevCounts.get(key) ?? 1;
          ghostRows.push([...row, ...s.newCols.map(() => null)]);
        }
      }
      if (!s.truncated && ghostRows.length) {
        s.rows = [...s.rows, ...ghostRows];
        s.rowTags = [...s.rowTags, ...ghostRows.map(() => 'ghost' as const)];
      }
      const nullExt = s.rowTags.filter((t) => t === 'nullext').length;
      const multiplied = [...nowCounts.entries()].filter(([key, c]) => c > (prevCounts.get(key) ?? 1));
      const maxFan = multiplied.reduce((m, [key, c]) => Math.max(m, c / (prevCounts.get(key) ?? 1)), 1);

      const cond = j.condition ? ` ${j.condition.startsWith('USING') ? j.condition : `ON ${j.condition}`}` : '';
      s.narration.push(
        `${j.kind} pairs each of the ${plural(prevCount, 'row')} so far with matching \`${j.relation}\` rows${cond ? ` (${cond.trim()})` : ''} → **${plural(s.outCount, 'row')}** (${delta(prevCount, s.outCount)}).`,
      );
      if (multiplied.length) {
        s.narration.push(`Fan-out: ${plural(multiplied.length, 'input row')} matched more than one \`${j.alias}\` row (up to ×${Math.round(maxFan * 10) / 10}), so they now appear multiple times.`);
        s.impact.push(
          grouped
            ? 'You aggregate later: any SUM/COUNT/AVG of columns from the earlier tables is now inflated by this duplication. Pre-aggregate the many side in a subquery/CTE, or count DISTINCT keys.'
            : 'Each left row is repeated once per match. Fine for detail rows; wrong if you expected one row per left entity.',
        );
      }
      if (dropped && !j.outer) {
        s.narration.push(`${plural(dropped, 'row')} had no match and **disappeared** (struck through) — an inner join keeps only matches.`);
        s.impact.push('If those entities must still be reported (e.g. users with zero orders), use LEFT JOIN and COALESCE the counts.');
      }
      if (nullExt) {
        s.narration.push(`${plural(nullExt, 'row')} had no match but were kept, **NULL-extended**: every \`${j.alias}.*\` column is NULL.`);
        s.impact.push(`A later WHERE on a \`${j.alias}\` column (e.g. \`${j.alias}.x = …\`) evaluates to NULL for these rows and silently turns this into an inner join. Put such filters in the ON clause.`);
      }
      if (rightOnly) s.narration.push(`${plural(rightOnly, 'row')} from \`${j.alias}\` had no left partner and were kept with NULLs on the left side.`);
      if (!multiplied.length && !dropped && !nullExt && !rightOnly && s.outCount === prevCount)
        s.narration.push('Every row matched exactly once: the join added columns without changing the row count (a many-to-one lookup).');
      if (/CROSS/.test(j.kind) && !/LATERAL/.test(j.kind)) s.impact.push('CROSS JOIN multiplies cardinalities — keep one side tiny (a calendar, a parameter row).');
      if (/LATERAL/.test(j.kind)) s.narration.push('LATERAL lets the right side reference columns of each left row: it is re-evaluated per left row (a correlated subquery that can return many rows).');
      prevRows = s.rows.filter((_, i) => s.rowTags![i] !== 'ghost');
      prevCount = s.outCount;
    });
  }

  const relN = nFrom + q.joins.length;
  const inputSelect = structured ? relSelect(relN).join(', ') : '*';
  const mapInput = (row: Cell[]) => (structured ? flatten(row, relN).cells : row);
  const inputCols = structured ? relCols(relN) : stages[stages.length - 1]?.columns ?? [];
  const fromAll = allFrom(q.joins.length);

  // ---- WHERE -------------------------------------------------------------
  let afterWhere = prevCount;
  let rowsAfterWhere = prevRows;
  if (q.where.length) {
    const s = blank('where', 'where', 'WHERE', `WHERE ${q.where.join(' AND ')}`);
    s.inCount = prevCount;
    await safe(s, async () => {
      const width = structured ? relN : inputCols.length;
      s.sql = `${W}SELECT ${inputSelect}, ${q.where.map((p, i) => `(${p}) AS __w${i}`).join(', ')}\nFROM ${fromAll}`;
      let r: QueryResult;
      try {
        r = await run(s.sql, { maxRows: MAX });
      } catch {
        // a predicate may only be safe after an earlier one filtered (e.g. a cast) → show kept rows only
        s.sql = `${W}SELECT ${inputSelect}\nFROM ${fromAll}${whereSql}`;
        const rr = await run(s.sql, { maxRows: MAX });
        Object.assign(s, { columns: inputCols, rows: rr.rows.map(mapInput), outCount: rr.rowCount, truncated: !!rr.truncated });
        afterWhere = s.outCount;
        rowsAfterWhere = s.rows;
        s.narration.push(`WHERE kept ${plural(s.outCount, 'row')} of ${prevCount}.`);
        return;
      }
      const values = r.rows.map((row) => row.slice(width).map(truth));
      s.columns = inputCols;
      s.rows = r.rows.map((row) => mapInput(row.slice(0, width)));
      s.checks = { preds: q.where, values };
      s.rowTags = values.map((v) => (v.every((x) => x === true) ? 'kept' : 'dropped'));
      s.truncated = !!r.truncated;
      s.outCount = s.truncated ? (await run(`${W}SELECT count(*) FROM ${fromAll}${whereSql}`)).rows[0][0] as number : s.rowTags.filter((t) => t === 'kept').length;
      afterWhere = s.outCount;
      rowsAfterWhere = s.rows.filter((_, i) => s.rowTags![i] === 'kept');
      s.narration.push(`WHERE tests every row and keeps only those where the whole condition is **TRUE** → ${plural(s.outCount, 'row')} (${delta(prevCount, s.outCount)}).`);
      q.where.forEach((p, i) => {
        const col = values.map((v) => v[i]);
        const t = col.filter((x) => x === true).length;
        const f = col.filter((x) => x === false).length;
        const nn = col.filter((x) => x === null).length;
        s.narration.push(`\`${p}\`: ${t} TRUE · ${f} FALSE${nn ? ` · **${nn} NULL**` : ''}`);
        if (nn) s.impact.push(`${plural(nn, 'row')} made \`${p}\` evaluate to NULL (unknown), and WHERE drops NULL exactly like FALSE. If those rows should count, handle NULL explicitly (IS NULL / COALESCE / IS DISTINCT FROM).`);
        if (/\bNOT\s+IN\s*\(\s*SELECT/i.test(p) && nn) s.warn.push('NOT IN over a subquery that returns a NULL is never TRUE — use NOT EXISTS.');
      });
      // outer-join-then-filter trap
      q.joins.forEach((j, k) => {
        if (!j.outer || !j.alias) return;
        const offender = q.where.findIndex((p) => new RegExp(`\\b${j.alias}\\.\\w+`).test(p) && !/\bIS\s+(NOT\s+)?NULL\b/i.test(p));
        if (offender < 0) return;
        const joinStage = stages.find((x) => x.key === `join:${k}`);
        const nullExtRows = joinStage?.rowTags?.filter((t) => t === 'nullext').length ?? 0;
        if (nullExtRows) s.warn.push(`\`${q.where[offender]}\` filters on the outer-joined \`${j.alias}\`: the ${plural(nullExtRows, 'NULL-extended row')} from the ${j.kind} fail it, so the outer join now behaves like an INNER JOIN. Move the condition into ON if you meant to keep them.`);
      });
      s.impact.push('WHERE runs before GROUP BY and SELECT: it filters rows (cheap, can use indexes) but cannot see aggregates or SELECT aliases.');
    });
  }

  // ---- GROUP BY / HAVING -------------------------------------------------
  let groupsOut = 0;
  if (grouped) {
    const s = blank('group', 'group', 'GROUP BY', q.groupBy.length ? `GROUP BY ${q.groupBy.join(', ')}` : '(aggregate without GROUP BY → one group)');
    s.inCount = afterWhere;
    await safe(s, async () => {
      const aggItems = q.select.filter((it) => !isWindowExpr(it) && hasAggregate(it));
      if (groupExprs.length) {
        const width = structured ? relN : inputCols.length;
        s.sql = `${W}SELECT ${inputSelect}, ${groupExprs.map((g, i) => `(${g}) AS __g${i}`).join(', ')}\nFROM ${fromAll}${whereSql}\nORDER BY ${groupExprs.map((_, i) => `__g${i}`).join(', ')}`;
        const r = await run(s.sql, { maxRows: MAX });
        s.columns = inputCols;
        s.rows = r.rows.map((row) => mapInput(row.slice(0, width)));
        let gid = -1;
        let last = '';
        s.groupIds = r.rows.map((row) => {
          const key = keyOf(row.slice(width));
          if (key !== last) {
            gid++;
            last = key;
          }
          return gid;
        });
        s.truncated = !!r.truncated;
      } else {
        s.columns = inputCols;
        s.rows = rowsAfterWhere;
        s.groupIds = s.rows.map(() => 0);
      }
      const gq = `${W}SELECT ${[...groupExprs.map((g, i) => `${g} AS ${JSON.stringify(groupKeyName(q.groupBy[i], g))}`), ...aggItems, 'count(*) AS "rows in group"'].join(', ')}\nFROM ${fromAll}${whereSql}${groupSql}${groupExprs.length ? `\nORDER BY ${groupExprs.map((_, i) => i + 1).join(', ')}` : ''}`;
      const g = await run(gq, { maxRows: MAX });
      s.groups = { columns: g.columns, rows: g.rows };
      s.outCount = g.rowCount;
      groupsOut = g.rowCount;
      const sizes = g.rows.map((row) => Number(row[row.length - 1]));
      if (groupExprs.length) {
        s.narration.push(`${plural(afterWhere, 'row')} are bucketed by \`${q.groupBy.join(', ')}\` and **collapse into ${plural(g.rowCount, 'group')}** — one output row per distinct key.`);
        if (sizes.length) s.narration.push(`Group sizes range from ${Math.min(...sizes)} to ${Math.max(...sizes)} rows; aggregates (${aggItems.map((a) => `\`${splitAlias(a).expr}\``).join(', ') || 'none'}) are computed once per group.`);
        if (g.rows.some((row) => groupExprs.some((_, i) => row[i] === null)))
          s.narration.push('NULL keys form **one** group of their own (GROUP BY treats NULLs as equal, unlike `=`).');
      } else {
        s.narration.push(`An aggregate with no GROUP BY treats all ${plural(afterWhere, 'row')} as a single group → exactly one output row (even when the input is empty).`);
      }
      s.impact.push('From here on, every SELECT / HAVING / ORDER BY expression must be a group key or wrapped in an aggregate — the individual rows are gone.');
    });

    if (q.having.length) {
      const h = blank('having', 'having', 'HAVING', `HAVING ${q.having.join(' AND ')}`);
      h.inCount = groupsOut;
      await safe(h, async () => {
        const keys = groupExprs.map((g, i) => `${g} AS ${JSON.stringify(groupKeyName(q.groupBy[i], g))}`);
        const aggItems = q.select.filter((it) => !isWindowExpr(it) && hasAggregate(it));
        const cols = [...keys, ...aggItems, 'count(*) AS "rows in group"'];
        h.sql = `${W}SELECT ${cols.join(', ')}, ${q.having.map((p, i) => `(${p}) AS __h${i}`).join(', ')}\nFROM ${fromAll}${whereSql}${groupSql}${groupExprs.length ? `\nORDER BY ${groupExprs.map((_, i) => i + 1).join(', ')}` : ''}`;
        const r = await run(h.sql, { maxRows: MAX });
        const width = r.columns.length - q.having.length;
        h.columns = r.columns.slice(0, width);
        h.rows = r.rows.map((row) => row.slice(0, width));
        const values = r.rows.map((row) => row.slice(width).map(truth));
        h.checks = { preds: q.having, values };
        h.rowTags = values.map((v) => (v.every((x) => x === true) ? 'kept' : 'dropped'));
        h.outCount = h.rowTags.filter((t) => t === 'kept').length;
        groupsOut = h.outCount;
        h.narration.push(`HAVING filters **groups**, after aggregation: ${plural(h.inCount, 'group')} → ${plural(h.outCount, 'group')}.`);
        h.impact.push('Conditions on plain columns belong in WHERE (filter rows before grouping — less work, index-friendly). Only aggregate conditions need HAVING.');
        const plain = q.having.filter((p) => !hasAggregate(p));
        if (plain.length) h.warn.push(`\`${plain[0]}\` has no aggregate — it could be a WHERE condition and filter rows before the (expensive) grouping.`);
      });
    }
  }
  const rowsBeforeWindow = grouped ? groupsOut : afterWhere;

  // ---- window ------------------------------------------------------------
  const winItems = q.select.filter((it) => isWindowExpr(it));
  if (winItems.length) {
    const first = parseWindow(splitAlias(winItems[0]).expr);
    const s = blank('window', 'window', 'Window functions', winItems.map((w) => splitAlias(w).expr).join('\n'));
    s.inCount = rowsBeforeWindow;
    await safe(s, async () => {
      const spec = first!;
      const pCols = spec.partitionBy.map((p, i) => `(${p}) AS __p${i}`);
      const oCols = spec.orderBy.map((o, i) => `(${sortExpr(o)}) AS __o${i}`);
      const winSel = winItems.map((w) => `${splitAlias(w).expr} AS ${JSON.stringify(outputName(w))}`);
      let base: string[];
      let width: number;
      let baseCols: string[];
      if (grouped) {
        const aggItems = q.select.filter((it) => !isWindowExpr(it) && hasAggregate(it));
        base = [...groupExprs.map((g, i) => `${g} AS ${JSON.stringify(groupKeyName(q.groupBy[i], g))}`), ...aggItems];
        width = base.length;
        baseCols = [];
      } else {
        base = [inputSelect];
        width = structured ? relN : inputCols.length;
        baseCols = inputCols;
      }
      const orderSql = [...spec.partitionBy.map((_, i) => `__p${i}`), ...spec.orderBy.map((o, i) => `__o${i}${isDesc(o) ? ' DESC' : ''}${/NULLS\s+(FIRST|LAST)/i.exec(o)?.[0] ? ' ' + /NULLS\s+(FIRST|LAST)/i.exec(o)![0] : ''}`)];
      s.sql = `${W}SELECT ${[...base, ...winSel, ...pCols, ...oCols].join(', ')}\nFROM ${fromAll}${whereSql}${groupSql}${havingSql}${orderSql.length ? `\nORDER BY ${orderSql.join(', ')}` : ''}`;
      const r = await run(s.sql, { maxRows: MAX });
      const dataCols = grouped ? r.columns.slice(0, width) : baseCols;
      const nWin = winSel.length;
      s.columns = [...dataCols, ...r.columns.slice(width, width + nWin)];
      s.newCols = r.columns.slice(width, width + nWin).map((_, i) => dataCols.length + i);
      s.rows = r.rows.map((row) => [...(grouped ? row.slice(0, width) : mapInput(row.slice(0, width))), ...row.slice(width, width + nWin)]);
      const pStart = width + nWin;
      const oStart = pStart + spec.partitionBy.length;
      let pid = -1;
      let last = '\u0000';
      s.groupIds = r.rows.map((row) => {
        const key = keyOf(row.slice(pStart, oStart));
        if (key !== last) {
          pid++;
          last = key;
        }
        return pid;
      });
      s.window = {
        spec,
        alias: outputName(winItems[0]),
        valueCol: dataCols.length,
        orderVals: r.rows.map((row) => row.slice(oStart, oStart + spec.orderBy.length)),
        desc: spec.orderBy.map(isDesc),
        others: winItems.slice(1).map((w) => outputName(w)),
      };
      s.truncated = !!r.truncated;
      s.outCount = r.rowCount;
      const parts = pid + 1;
      s.narration.push(
        `Window functions run after WHERE/GROUP BY/HAVING and **do not collapse rows**: ${plural(rowsBeforeWindow, 'row')} in, ${plural(s.outCount, 'row')} out, each gaining ${nWin === 1 ? 'a new column' : `${nWin} new columns`}.`,
      );
      s.narration.push(
        spec.partitionBy.length
          ? `\`PARTITION BY ${spec.partitionBy.join(', ')}\` splits the rows into ${plural(parts, 'partition')} (coloured); the function restarts in each.`
          : 'No PARTITION BY: the whole result is one window partition.',
      );
      if (spec.orderBy.length) s.narration.push(`\`ORDER BY ${spec.orderBy.join(', ')}\` orders rows inside each partition — this ordering is only for the function, not for the output.`);
      const specs = winItems.map((w) => parseWindow(splitAlias(w).expr)).filter((x): x is WindowSpec => !!x);
      if (specs.some((x) => x.orderBy.length && !x.frame && /^(SUM|AVG|COUNT|MIN|MAX)$/.test(x.fn)))
        s.impact.push('Default frame with ORDER BY is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` — it includes **peers** (rows with an equal sort key), so tied rows share one running total. Say `ROWS BETWEEN …` for a strict row-by-row total.');
      if (spec.frame) s.narration.push(`Frame \`${spec.frame}\` decides which rows of the partition feed each row’s value — hover a row to see its frame.`);
      if (specs.some((x) => /^(ROW_NUMBER|RANK|DENSE_RANK)$/.test(x.fn))) s.impact.push('ROW_NUMBER breaks ties arbitrarily, RANK leaves gaps after ties, DENSE_RANK doesn’t. Add a unique tie-breaker to ORDER BY for deterministic results.');
      const lagLead = specs.find((x) => /^(LAG|LEAD)$/.test(x.fn))?.fn;
      if (lagLead) s.impact.push(`${lagLead} looks ${lagLead === 'LAG' ? 'back' : 'ahead'} by position within the partition — the first/last row has no neighbour and gets NULL (or the default argument).`);
      s.impact.push('You cannot filter on a window result in WHERE (it doesn’t exist yet) — wrap the query in a CTE/subquery and filter outside.');
    });
  }

  // ---- SELECT ------------------------------------------------------------
  const tail = `\nFROM ${fromAll}${whereSql}${groupSql}${havingSql}`;
  let selCount = rowsBeforeWindow;
  let selRows: Cell[][] = [];
  {
    const s = blank('select', 'select', 'SELECT', `SELECT ${q.select.join(', ')}`);
    s.inCount = rowsBeforeWindow;
    await safe(s, async () => {
      s.sql = `${W}SELECT ${q.select.join(', ')}${tail}`;
      const r = await run(s.sql, { maxRows: MAX });
      Object.assign(s, { columns: r.columns, rows: r.rows, truncated: !!r.truncated, outCount: r.rowCount });
      selCount = r.rowCount;
      selRows = r.rows;
      const computed = selectExprs.filter((e) => !/^[\w."]+$/.test(e.expr) || e.alias).length;
      s.newCols = r.columns.map((_, i) => i);
      s.narration.push(
        `SELECT is evaluated **late**: it only shapes each row → ${plural(r.columns.length, 'column')} (${computed} computed / renamed). The row count stays ${s.outCount}.`,
      );
      if (selectExprs.some((e) => e.alias)) s.impact.push('Aliases are born here, so WHERE / GROUP BY / HAVING (earlier stages) can’t reference them — only ORDER BY (later) can.');
      if (q.select.some((x) => /^\*$|\.\*$/.test(x.trim()))) s.warn.push('`SELECT *` couples the query to the table layout and defeats index-only scans. List the columns you need.');
      if (q.select.some((x) => /\(\s*SELECT\b/i.test(x))) s.impact.push('A correlated scalar subquery in SELECT runs once per output row (often fine, but a JOIN + GROUP BY lets the planner pick a hash join).');
    });
  }

  // ---- DISTINCT ----------------------------------------------------------
  let afterDistinct = selCount;
  if (q.distinct) {
    const s = blank('distinct', 'distinct', q.distinctOn ? `DISTINCT ON (${q.distinctOn})` : 'DISTINCT', q.distinctOn ? `DISTINCT ON (${q.distinctOn})` : 'DISTINCT');
    s.inCount = selCount;
    await safe(s, async () => {
      if (q.distinctOn) {
        const on = q.distinctOn.split(',').length;
        const ords = q.orderBy.length ? `\nORDER BY ${q.orderBy.join(', ')}` : '';
        s.sql = `${W}SELECT ${q.select.join(', ')}, ${q.distinctOn
          .split(',')
          .map((d, i) => `(${resolveRef(d.trim(), q)}) AS __d${i}`)
          .join(', ')}${tail}${ords}`;
        const r = await run(s.sql, { maxRows: MAX });
        const width = r.columns.length - on;
        s.columns = r.columns.slice(0, width);
        s.rows = r.rows.map((row) => row.slice(0, width));
        const seen = new Set<string>();
        let gid = -1;
        let last = '';
        s.groupIds = [];
        s.rowTags = r.rows.map((row) => {
          const key = keyOf(row.slice(width));
          if (key !== last) {
            gid++;
            last = key;
          }
          s.groupIds!.push(gid);
          if (seen.has(key)) return 'dropped';
          seen.add(key);
          return 'kept';
        });
        s.outCount = seen.size;
        s.narration.push(`DISTINCT ON keeps the **first row of each \`(${q.distinctOn})\` group in ORDER BY order** → ${plural(s.outCount, 'row')} (${delta(selCount, s.outCount)}).`);
        s.impact.push(q.orderBy.length ? 'Which row survives is decided entirely by ORDER BY: its leading columns must match the DISTINCT ON keys, then the tie-breaker picks the winner (latest, cheapest…).' : 'Without ORDER BY the surviving row per key is arbitrary.');
      } else {
        s.sql = `${W}SELECT DISTINCT ${q.select.join(', ')}${tail}`;
        const seen = new Set<string>();
        s.columns = stages.find((x) => x.id === 'select')?.columns ?? [];
        s.rows = selRows;
        s.rowTags = selRows.map((row) => {
          const key = keyOf(row);
          if (seen.has(key)) return 'dropped';
          seen.add(key);
          return 'kept';
        });
        const r = await run(`SELECT count(*) FROM (${s.sql}) d`);
        s.outCount = Number(r.rows[0][0]);
        s.narration.push(`DISTINCT compares whole output rows and removes exact duplicates → ${plural(s.outCount, 'row')} (${delta(selCount, s.outCount)}).`);
        if (selCount !== s.outCount && q.joins.length)
          s.impact.push('If DISTINCT is “fixing” duplicates a JOIN created, the join is fanning out — fix the join (EXISTS / pre-aggregate) instead of paying for a sort/hash to hide it.');
        s.impact.push('DISTINCT costs a sort or hash over the whole result; NULLs count as equal here.');
      }
      afterDistinct = s.outCount;
    });
  }

  // ---- ORDER BY ----------------------------------------------------------
  let orderedRows: Cell[][] = [];
  if (q.orderBy.length) {
    const s = blank('order', 'order', 'ORDER BY', `ORDER BY ${q.orderBy.join(', ')}`);
    s.inCount = afterDistinct;
    await safe(s, async () => {
      const dist = q.distinct ? (q.distinctOn ? `DISTINCT ON (${q.distinctOn}) ` : 'DISTINCT ') : '';
      s.sql = `${W}SELECT ${dist}${q.select.join(', ')}${tail}\nORDER BY ${q.orderBy.join(', ')}`;
      const r = await run(s.sql, { maxRows: MAX });
      Object.assign(s, { columns: r.columns, rows: r.rows, truncated: !!r.truncated, outCount: r.rowCount });
      orderedRows = r.rows;
      s.narration.push(`Rows are sorted by \`${q.orderBy.join(', ')}\`. Same ${plural(s.outCount, 'row')}, now in a guaranteed order.`);
      s.impact.push('ORDER BY is the only thing that guarantees order — without it, results come in whatever order the plan produced (it changes when plans change).');
      if (q.orderBy.some((o) => isDesc(o) && !/NULLS/i.test(o))) s.impact.push('In Postgres NULLs sort as larger than any value, so `DESC` puts NULLs **first** — add `NULLS LAST` when ranking.');
      if (q.limit) s.impact.push('With LIMIT, an index on the ORDER BY columns lets Postgres stop after N rows instead of sorting everything (top-N).');
    });
  }

  // ---- LIMIT -------------------------------------------------------------
  if (q.limit || q.offset) {
    const s = blank('limit', 'limit', 'LIMIT', `${q.limit ? `LIMIT ${q.limit}` : ''}${q.offset ? ` OFFSET ${q.offset}` : ''}`.trim());
    s.inCount = afterDistinct;
    await safe(s, async () => {
      s.sql = sqlText;
      const off = Number(q.offset ?? 0) || 0;
      const base = q.orderBy.length ? orderedRows : stages.find((x) => x.id === 'distinct')?.rows.filter((_, i) => stages.find((x) => x.id === 'distinct')!.rowTags![i] === 'kept') ?? selRows;
      s.columns = final.columns;
      s.rows = base;
      s.rowTags = base.map((_, i) => (i >= off && i < off + final.rowCount ? 'kept' : 'dropped'));
      s.outCount = final.rowCount;
      s.narration.push(`LIMIT keeps ${plural(final.rowCount, 'row')}${off ? ` after skipping ${off}` : ''} of ${afterDistinct}.`);
      if (!q.orderBy.length) s.warn.push('LIMIT without ORDER BY returns an arbitrary subset — not “the first” anything.');
      if (off > 0) s.impact.push('OFFSET still reads and throws away the skipped rows: page 1000 costs 1000 pages of work. Keyset pagination (`WHERE (k) > (last_k)`) stays constant.');
      else s.impact.push('Ties at the cut-off are broken arbitrarily — add a unique tie-breaker, or use RANK()/FETCH … WITH TIES to keep them.');
    });
  }

  // final stage always mirrors the actual query result
  const lastStage = stages[stages.length - 1];
  if (lastStage && !lastStage.error && lastStage.outCount !== final.rowCount && lastStage.id !== 'limit') {
    lastStage.warn.push(`(Visualizer approximation: the real query returns ${final.rowCount} rows.)`);
  }
  return { parsed: q, stages, final };
}

function delta(a: number, b: number): string {
  if (a === b) return 'no change';
  if (b > a) return a === 0 ? `+${b}` : `+${b - a}, ×${Math.round((b / a) * 100) / 100}`;
  return `−${a - b}`;
}

/** GROUP BY 1 / GROUP BY output_alias → the underlying expression. */
function resolveRef(ref: string, q: ParsedQuery): string {
  const r = ref.trim();
  if (/^\d+$/.test(r)) {
    const item = q.select[Number(r) - 1];
    return item ? splitAlias(item).expr : r;
  }
  if (/^\w+$/.test(r)) {
    const hit = q.select.find((it) => {
      const sa = splitAlias(it);
      return sa.alias?.toLowerCase() === r.toLowerCase() && !new RegExp(`(^|\\.)${r}$`, 'i').test(sa.expr);
    });
    if (hit) return splitAlias(hit).expr;
  }
  return r;
}

function groupKeyName(original: string, expr: string): string {
  const o = original.trim();
  if (/^\w+$/.test(o)) return o;
  if (/^\w+\.\w+$/.test(expr.trim())) return expr.trim();
  return o.length > 30 ? o.slice(0, 28) + '…' : o;
}
