/**
 * A small top-level SQL clause parser. It does not validate SQL (Postgres does that);
 * it only splits a single SELECT (optionally WITH …) into the clauses the logical
 * query-processing visualizer needs. Anything it doesn't understand returns `null`,
 * and the UI falls back to "result + plan" only.
 */

export type TokType = 'word' | 'num' | 'str' | 'op' | 'lp' | 'rp' | 'comma';
export interface Tok {
  t: TokType;
  v: string;
  /** upper-cased value for words */
  u: string;
  s: number;
  e: number;
  depth: number;
}

export function stripComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const q = c;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === q && sql[j + 1] === q) j += 2;
        else if (sql[j] === q) break;
        else j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += ' ';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function tokenize(sql: string): Tok[] {
  const toks: Tok[] = [];
  let depth = 0;
  let i = 0;
  const push = (t: TokType, s: number, e: number, d = depth) => {
    const v = sql.slice(s, e);
    toks.push({ t, v, u: t === 'word' ? v.toUpperCase() : v, s, e, depth: d });
  };
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "'" || (c === 'E' && sql[i + 1] === "'")) {
      const s = i;
      if (c === 'E') i++;
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i++;
      }
      i++;
      push('str', s, i);
    } else if (c === '$' && /\$(\w*)\$/.test(sql.slice(i, i + 20))) {
      const tag = sql.slice(i).match(/^\$(\w*)\$/)![0];
      const end = sql.indexOf(tag, i + tag.length);
      const s = i;
      i = end < 0 ? sql.length : end + tag.length;
      push('str', s, i);
    } else if (c === '(') {
      push('lp', i, i + 1);
      depth++;
      i++;
    } else if (c === ')') {
      depth = Math.max(0, depth - 1);
      push('rp', i, i + 1);
      i++;
    } else if (c === ',') {
      push('comma', i, i + 1);
      i++;
    } else if (/[A-Za-z_"]/.test(c)) {
      const s = i;
      // identifiers, keywords, qualified names (a.b, "x".y, t.*)
      for (;;) {
        if (sql[i] === '"') {
          i++;
          while (i < sql.length && sql[i] !== '"') i++;
          i++;
        } else {
          while (i < sql.length && /[\w$]/.test(sql[i])) i++;
        }
        if (sql[i] === '.' && /[A-Za-z_"*]/.test(sql[i + 1] ?? '')) {
          i++;
          if (sql[i] === '*') {
            i++;
            break;
          }
          continue;
        }
        break;
      }
      push('word', s, i);
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] ?? ''))) {
      const s = i;
      while (i < sql.length && /[0-9.eE]/.test(sql[i])) i++;
      push('num', s, i);
    } else {
      const s = i;
      i++;
      while (i < sql.length && /[<>=!~+\-*/%^|&#@:?]/.test(sql[i]) && /[<>=!~+\-*/%^|&#@:?]/.test(c)) i++;
      push('op', s, i);
    }
  }
  return toks;
}

/** Split `text` at depth-0 commas. */
export function splitCommas(text: string): string[] {
  const toks = tokenize(text);
  const parts: string[] = [];
  let start = 0;
  for (const t of toks) {
    if (t.t === 'comma' && t.depth === 0) {
      parts.push(text.slice(start, t.s).trim());
      start = t.e;
    }
  }
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return parts.filter(Boolean);
}

/** Split a boolean condition into top-level AND conjuncts (only when there is no top-level OR). */
export function splitAnd(text: string): string[] {
  const toks = tokenize(text);
  const top = toks.filter((t) => t.depth === 0);
  if (top.some((t) => t.t === 'word' && t.u === 'OR')) return [text.trim()];
  const parts: string[] = [];
  let start = 0;
  let between = false;
  for (const t of top) {
    if (t.t !== 'word') continue;
    if (t.u === 'BETWEEN') between = true;
    else if (t.u === 'AND') {
      if (between) {
        between = false;
        continue;
      }
      parts.push(text.slice(start, t.s).trim());
      start = t.e;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

const KEYWORDS = new Set(
  'SELECT FROM WHERE GROUP BY HAVING ORDER LIMIT OFFSET AND OR NOT NULL TRUE FALSE END ASC DESC NULLS FIRST LAST ON USING JOIN LEFT RIGHT FULL INNER OUTER CROSS AS CASE WHEN THEN ELSE IS IN EXISTS BETWEEN LIKE ILIKE DISTINCT OVER PARTITION ROWS RANGE GROUPS UNBOUNDED PRECEDING FOLLOWING CURRENT ROW INTERVAL LATERAL WITH RECURSIVE UNION ALL'.split(
    ' ',
  ),
);

/** `expr AS alias` → { expr, alias }. Also understands implicit aliases (`count(*) n`). */
export function splitAlias(item: string): { expr: string; alias?: string } {
  const text = item.trim();
  const toks = tokenize(text).filter((t) => t.depth === 0);
  const n = toks.length;
  if (n >= 3 && toks[n - 2].t === 'word' && toks[n - 2].u === 'AS' && toks[n - 1].t === 'word') {
    return { expr: text.slice(0, toks[n - 2].s).trim(), alias: unquote(toks[n - 1].v) };
  }
  if (n >= 2) {
    const last = toks[n - 1];
    const prev = toks[n - 2];
    if (
      last.t === 'word' &&
      !KEYWORDS.has(last.u) &&
      !last.v.includes('.') &&
      (prev.t === 'rp' || (prev.t === 'word' && !KEYWORDS.has(prev.u)) || prev.t === 'num' || (prev.t === 'word' && prev.u === 'END'))
    ) {
      return { expr: text.slice(0, last.s).trim(), alias: unquote(last.v) };
    }
  }
  return { expr: text };
}

const unquote = (s: string) => (s.startsWith('"') ? s.slice(1, -1) : s.toLowerCase() === s ? s : s.toLowerCase());

/** Output column name Postgres would give a select item (best effort). */
export function outputName(item: string): string {
  const { expr, alias } = splitAlias(item);
  if (alias) return alias;
  const m = expr.match(/^(?:\w+\.)?("?[\w]+"?)$/);
  if (m) return unquote(m[1]);
  const f = expr.match(/^(\w+)\s*\(/);
  if (f) return f[1].toLowerCase();
  return '?column?';
}

/** Alias a FROM item / joined relation is referenced by. */
export function relationAlias(item: string): string | undefined {
  let text = item.trim().replace(/^LATERAL\s+/i, '').replace(/^ONLY\s+/i, '');
  // drop a trailing column-alias list: `AS d(day)` / `t(a, b)`
  const toks = tokenize(text);
  const top = toks.filter((t) => t.depth === 0);
  if (top.length >= 2 && top[top.length - 1].t === 'rp') {
    // find the matching lp
    const lastRp = top[top.length - 1];
    const lp = [...toks].reverse().find((t) => t.t === 'lp' && t.depth === 0 && t.s < lastRp.s);
    const before = lp ? top.filter((t) => t.e <= lp.s) : [];
    const prev = before[before.length - 1];
    // `alias(cols)` where alias is preceded by something (AS, ')' or a function name)
    if (lp && prev && prev.t === 'word' && before.length >= 2) {
      text = text.slice(0, lp.s).trim();
    }
  }
  const t2 = tokenize(text).filter((t) => t.depth === 0);
  const last = t2[t2.length - 1];
  if (!last) return undefined;
  if (last.t === 'word') {
    const name = last.v.includes('.') ? last.v.split('.').pop()! : last.v;
    return unquote(name);
  }
  if (last.t === 'rp') {
    // bare function call: generate_series(1,3)
    const first = t2[0];
    if (first?.t === 'word') return unquote(first.v.split('.').pop()!);
  }
  return undefined;
}

export interface CteSpec {
  name: string;
  /** body without the surrounding parentheses */
  body: string;
  /** `name AS (body)` as written */
  text: string;
}

export interface JoinSpec {
  /** e.g. `LEFT JOIN`, `JOIN`, `CROSS JOIN LATERAL` */
  kind: string;
  /** full clause text, e.g. `LEFT JOIN payments p ON p.order_id = o.id` */
  text: string;
  alias?: string;
  /** relation part, e.g. `payments p` */
  relation: string;
  /** ON condition or USING (...) text */
  condition?: string;
  outer: 'left' | 'right' | 'full' | null;
}

export interface ParsedQuery {
  recursive: boolean;
  ctes: CteSpec[];
  distinct: boolean;
  /** contents of DISTINCT ON ( … ) */
  distinctOn?: string;
  select: string[];
  /** FROM items before the first JOIN (comma separated) */
  from: string[];
  joins: JoinSpec[];
  where: string[];
  groupBy: string[];
  having: string[];
  orderBy: string[];
  limit?: string;
  offset?: string;
}

export function normalizeSql(sql: string): string {
  return stripComments(sql).trim().replace(/;\s*$/, '').trim();
}

/** Parse a single SELECT statement. Returns null for shapes the visualizer can't stage. */
export function parseQuery(input: string): ParsedQuery | null {
  const sql = normalizeSql(input);
  if (!sql || sql.includes(';')) return null;
  const toks = tokenize(sql);
  let i = 0;
  const ctes: CteSpec[] = [];
  let recursive = false;
  if (toks[0]?.u === 'WITH') {
    i = 1;
    if (toks[i]?.u === 'RECURSIVE') {
      recursive = true;
      i++;
    }
    for (;;) {
      const nameTok = toks[i];
      if (!nameTok || nameTok.t !== 'word') return null;
      i++;
      if (toks[i]?.t === 'lp') {
        // column list
        const d = toks[i].depth;
        i++;
        while (toks[i] && !(toks[i].t === 'rp' && toks[i].depth === d)) i++;
        i++;
      }
      if (toks[i]?.u !== 'AS') return null;
      i++;
      if (toks[i]?.u === 'NOT') i++;
      if (toks[i]?.u === 'MATERIALIZED') i++;
      if (toks[i]?.t !== 'lp') return null;
      const open = toks[i];
      let j = i + 1;
      while (toks[j] && !(toks[j].t === 'rp' && toks[j].depth === open.depth)) j++;
      if (!toks[j]) return null;
      ctes.push({ name: unquote(nameTok.v), body: sql.slice(open.e, toks[j].s).trim(), text: sql.slice(nameTok.s, toks[j].e) });
      i = j + 1;
      if (toks[i]?.t === 'comma') {
        i++;
        continue;
      }
      break;
    }
  }
  if (toks[i]?.u !== 'SELECT') return null;
  const main = toks.slice(i).filter((t) => t.depth === 0);
  if (main.some((t) => t.t === 'word' && ['UNION', 'INTERSECT', 'EXCEPT', 'WINDOW', 'FETCH', 'FOR', 'INTO'].includes(t.u))) return null;

  // find clause keyword positions (in order)
  type K = 'SELECT' | 'FROM' | 'WHERE' | 'GROUP' | 'HAVING' | 'ORDER' | 'LIMIT' | 'OFFSET';
  const order: K[] = ['SELECT', 'FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET'];
  const pos: Partial<Record<K, { s: number; e: number }>> = {};
  let stage = 0;
  for (let k = 0; k < main.length; k++) {
    const t = main[k];
    if (t.t !== 'word') continue;
    const idx = order.indexOf(t.u as K);
    if (idx < 0) continue;
    if (t.u === 'FROM') {
      // `IS [NOT] DISTINCT FROM` is an operator, not the FROM clause
      if (main[k - 1]?.u === 'DISTINCT' && ['IS', 'NOT'].includes(main[k - 2]?.u ?? '')) continue;
    }
    if (idx < stage || pos[t.u as K]) {
      if (t.u === 'SELECT' && k === 0) continue;
      return null;
    }
    let e = t.e;
    if (t.u === 'GROUP' || t.u === 'ORDER') {
      if (main[k + 1]?.u !== 'BY') return null;
      e = main[k + 1].e;
    }
    pos[t.u as K] = { s: t.s, e };
    stage = idx;
  }
  if (!pos.SELECT || !pos.FROM) return null;
  const present = order.filter((k) => pos[k]);
  const seg = (k: K) => {
    const p = pos[k];
    if (!p) return undefined;
    const next = present[present.indexOf(k) + 1];
    return sql.slice(p.e, next ? pos[next]!.s : sql.length).trim();
  };

  // SELECT [DISTINCT [ON (…)]]
  let selText = seg('SELECT')!;
  let distinct = false;
  let distinctOn: string | undefined;
  const sTok = tokenize(selText);
  if (sTok[0]?.u === 'DISTINCT') {
    distinct = true;
    if (sTok[1]?.u === 'ON' && sTok[2]?.t === 'lp') {
      const close = sTok.find((t, k) => k > 2 && t.t === 'rp' && t.depth === 0);
      if (!close) return null;
      distinctOn = selText.slice(sTok[2].e, close.s).trim();
      selText = selText.slice(close.e).trim();
    } else {
      selText = selText.slice(sTok[0].e).trim();
    }
  } else if (sTok[0]?.u === 'ALL') {
    selText = selText.slice(sTok[0].e).trim();
  }

  // FROM … JOIN …
  const fromText = seg('FROM')!;
  const fTok = tokenize(fromText).filter((t) => t.depth === 0);
  const joinStarts: number[] = [];
  for (let k = 0; k < fTok.length; k++) {
    if (fTok[k].u !== 'JOIN') continue;
    let s = k;
    while (s > 0 && ['NATURAL', 'LEFT', 'RIGHT', 'FULL', 'INNER', 'CROSS', 'OUTER'].includes(fTok[s - 1].u)) s--;
    joinStarts.push(fTok[s].s);
  }
  const fromPart = fromText.slice(0, joinStarts[0] ?? fromText.length).trim();
  const joins: JoinSpec[] = [];
  for (let k = 0; k < joinStarts.length; k++) {
    const text = fromText.slice(joinStarts[k], joinStarts[k + 1] ?? fromText.length).trim();
    const jt = tokenize(text).filter((t) => t.depth === 0);
    const jIdx = jt.findIndex((t) => t.u === 'JOIN');
    let relStart = jt[jIdx].e;
    let kind = text.slice(0, jt[jIdx].e).replace(/\s+/g, ' ').toUpperCase();
    if (jt[jIdx + 1]?.u === 'LATERAL') {
      kind += ' LATERAL';
      relStart = jt[jIdx + 1].e;
    }
    const condTok = jt.find((t, n) => n > jIdx && (t.u === 'ON' || t.u === 'USING'));
    const relation = text.slice(relStart, condTok ? condTok.s : text.length).trim();
    const condition = condTok ? (condTok.u === 'USING' ? text.slice(condTok.s) : text.slice(condTok.e)).trim() : undefined;
    const outer = /\bLEFT\b/.test(kind) ? 'left' : /\bRIGHT\b/.test(kind) ? 'right' : /\bFULL\b/.test(kind) ? 'full' : null;
    joins.push({ kind, text, relation, condition, alias: relationAlias(relation), outer });
  }

  const conj = (t?: string) => (t ? splitAnd(t) : []);
  let limit = seg('LIMIT');
  if (limit && /^ALL$/i.test(limit)) limit = undefined;
  return {
    recursive,
    ctes,
    distinct,
    distinctOn,
    select: splitCommas(selText),
    from: splitCommas(fromPart),
    joins,
    where: conj(seg('WHERE')),
    groupBy: seg('GROUP') ? splitCommas(seg('GROUP')!) : [],
    having: conj(seg('HAVING')),
    orderBy: seg('ORDER') ? splitCommas(seg('ORDER')!) : [],
    limit,
    offset: seg('OFFSET'),
  };
}

// ---------------------------------------------------------------------------
// Expression classification
// ---------------------------------------------------------------------------

const AGG_RE =
  /\b(count|sum|avg|min|max|array_agg|string_agg|json_agg|jsonb_agg|json_object_agg|jsonb_object_agg|bool_and|bool_or|every|percentile_cont|percentile_disc|mode|stddev|stddev_pop|stddev_samp|variance|var_pop|var_samp|corr|bit_and|bit_or)\s*\(/i;

/** Blank out parenthesised sub-SELECTs so aggregates inside scalar subqueries don't count. */
function withoutSubqueries(expr: string): string {
  const toks = tokenize(expr);
  let out = expr;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'lp' && toks[k + 1]?.u === 'SELECT') {
      const close = toks.find((x, n) => n > k && x.t === 'rp' && x.depth === t.depth);
      if (close) out = out.slice(0, t.s) + ' '.repeat(close.e - t.s) + out.slice(close.e);
    }
  }
  return out;
}

/** Remove `OVER ( … )` windows so `SUM(x) OVER (…)` doesn't count as a plain aggregate. */
function withoutWindows(expr: string): string {
  const toks = tokenize(expr);
  let out = expr;
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].u !== 'OVER' || toks[k + 1]?.t !== 'lp') continue;
    // blank the function call immediately before OVER and the window spec
    const lp = toks[k + 1];
    const close = toks.find((x, n) => n > k + 1 && x.t === 'rp' && x.depth === lp.depth);
    let fnStart = toks[k].s;
    const prev = toks[k - 1];
    if (prev?.t === 'rp') {
      const open = [...toks.slice(0, k - 1)].reverse().find((x) => x.t === 'lp' && x.depth === prev.depth);
      const name = open ? toks[toks.indexOf(open) - 1] : undefined;
      fnStart = name?.t === 'word' ? name.s : (open?.s ?? fnStart);
      // FILTER (WHERE …) between call and OVER
      if (name?.u === 'FILTER') {
        const callClose = toks[toks.indexOf(name) - 1];
        const callOpen = callClose ? [...toks.slice(0, toks.indexOf(callClose))].reverse().find((x) => x.t === 'lp' && x.depth === callClose.depth) : undefined;
        const fn = callOpen ? toks[toks.indexOf(callOpen) - 1] : undefined;
        if (fn?.t === 'word') fnStart = fn.s;
      }
    }
    const end = close ? close.e : toks[k].e;
    out = out.slice(0, fnStart) + ' '.repeat(end - fnStart) + out.slice(end);
  }
  return out;
}

export const isWindowExpr = (expr: string) => /\bOVER\s*\(/i.test(withoutSubqueries(expr));
export const hasAggregate = (expr: string) => AGG_RE.test(withoutWindows(withoutSubqueries(expr)));

export interface WindowSpec {
  /** function call before OVER, e.g. `ROW_NUMBER()` / `SUM(amount)` / `LAG(amount, 1)` */
  call: string;
  fn: string;
  args: string[];
  partitionBy: string[];
  orderBy: string[];
  frame?: string;
}

/** Parse the first `fn(...) OVER (PARTITION BY … ORDER BY … frame)` in an expression. */
export function parseWindow(expr: string): WindowSpec | null {
  const toks = tokenize(expr);
  const k = toks.findIndex((t, n) => t.u === 'OVER' && toks[n + 1]?.t === 'lp');
  if (k < 0) return null;
  const lp = toks[k + 1];
  const close = toks.find((x, n) => n > k + 1 && x.t === 'rp' && x.depth === lp.depth);
  if (!close) return null;
  const inner = expr.slice(lp.e, close.s).trim();
  // call: walk back from OVER over `fn(args)` [FILTER (WHERE …)]
  let callEnd = toks[k].s;
  let prev = toks[k - 1];
  let callStart = callEnd;
  let fn = '';
  let args: string[] = [];
  if (prev?.t === 'rp') {
    let open = [...toks.slice(0, k - 1)].reverse().find((x) => x.t === 'lp' && x.depth === prev!.depth);
    let name = open ? toks[toks.indexOf(open) - 1] : undefined;
    if (name?.u === 'FILTER') {
      prev = toks[toks.indexOf(name) - 1];
      open = [...toks.slice(0, toks.indexOf(prev))].reverse().find((x) => x.t === 'lp' && x.depth === prev!.depth);
      name = open ? toks[toks.indexOf(open) - 1] : undefined;
    }
    if (open && name?.t === 'word') {
      callStart = name.s;
      fn = name.u;
      const closeOfCall = toks.find((x, n) => n > toks.indexOf(open!) && x.t === 'rp' && x.depth === open!.depth)!;
      args = splitCommas(expr.slice(open.e, closeOfCall.s));
    }
  }
  callEnd = toks[k].s;
  const it = tokenize(inner).filter((t) => t.depth === 0);
  const pIdx = it.findIndex((t, n) => t.u === 'PARTITION' && it[n + 1]?.u === 'BY');
  const oIdx = it.findIndex((t, n) => t.u === 'ORDER' && it[n + 1]?.u === 'BY');
  const fIdx = it.findIndex((t) => ['ROWS', 'RANGE', 'GROUPS'].includes(t.u));
  const cut = (startIdx: number, skip: number) => {
    if (startIdx < 0) return '';
    const s = it[startIdx + skip - 1].e;
    const ends = [pIdx, oIdx, fIdx].filter((x) => x > startIdx).map((x) => it[x].s);
    const e = ends.length ? Math.min(...ends) : inner.length;
    return inner.slice(s, e).trim();
  };
  const part = cut(pIdx, 2);
  const ord = cut(oIdx, 2);
  const frame = fIdx >= 0 ? inner.slice(it[fIdx].s).trim() : undefined;
  return {
    call: expr.slice(callStart, callEnd).trim(),
    fn,
    args,
    partitionBy: part ? splitCommas(part) : [],
    orderBy: ord ? splitCommas(ord) : [],
    frame,
  };
}

/** `amount DESC NULLS LAST` → `amount` */
export function sortExpr(item: string): string {
  return item.replace(/\s+NULLS\s+(FIRST|LAST)\s*$/i, '').replace(/\s+(ASC|DESC)\s*$/i, '').trim();
}
export const isDesc = (item: string) => /\bDESC\b(\s+NULLS\s+(FIRST|LAST))?\s*$/i.test(item.trim());

// ---------------------------------------------------------------------------
// Re-assembly
// ---------------------------------------------------------------------------

export interface Assembled {
  sql: string;
  /** 1-based line numbers per stage for highlighting */
  lines: Partial<Record<string, number[]>>;
}

/** Pretty-print a parsed query back to SQL with stage → line mapping. */
export function assemble(q: ParsedQuery): Assembled {
  const out: string[] = [];
  const lines: Record<string, number[]> = {};
  const add = (stage: string, text: string) => {
    for (const l of text.split('\n')) {
      out.push(l);
      (lines[stage] ??= []).push(out.length);
    }
  };
  if (q.ctes.length) {
    q.ctes.forEach((c, k) => {
      const head = k === 0 ? `WITH ${q.recursive ? 'RECURSIVE ' : ''}` : '';
      const body = c.body
        .split('\n')
        .map((l) => '  ' + l.trim())
        .join('\n');
      add(`cte:${c.name}`, `${head}${c.name} AS (\n${body}\n)${k < q.ctes.length - 1 ? ',' : ''}`);
    });
  }
  const sel = q.select.map((s, k) => (k === 0 ? s : `       ${s}`)).join(',\n');
  const dist = q.distinct ? (q.distinctOn ? `DISTINCT ON (${q.distinctOn}) ` : 'DISTINCT ') : '';
  add('select', `SELECT ${dist}${sel}`);
  add('from', `FROM ${q.from.join(', ')}`);
  q.joins.forEach((j, k) => add(`join:${k}`, j.text));
  if (q.where.length) add('where', `WHERE ${q.where.join('\n  AND ')}`);
  if (q.groupBy.length) add('group', `GROUP BY ${q.groupBy.join(', ')}`);
  if (q.having.length) add('having', `HAVING ${q.having.join('\n   AND ')}`);
  if (q.orderBy.length) add('order', `ORDER BY ${q.orderBy.join(', ')}`);
  if (q.limit) add('limit', `LIMIT ${q.limit}`);
  if (q.offset) add('limit', `OFFSET ${q.offset}`);
  return { sql: out.join('\n'), lines };
}
