/** EXPLAIN (FORMAT JSON) → a tree the UI can draw, plus summaries, diffs and node internals. */

export interface PlanNode {
  id: string;
  type: string;
  /** e.g. "on big_orders o using big_orders_user_id_idx" */
  detail: string;
  relation?: string;
  index?: string;
  /** Join / filter / sort keys etc. as label → text. */
  props: { k: string; v: string }[];
  startupCost: number;
  totalCost: number;
  planRows: number;
  actualRows?: number;
  loops?: number;
  actualMs?: number;
  /** total actual time including children */
  removedByFilter?: number;
  children: PlanNode[];
}

export interface PlanSummary {
  root: PlanNode;
  totalCost: number;
  executionMs?: number;
  planningMs?: number;
  nodeTypes: string[];
  /** Scans of each relation (type + relation). */
  scans: { type: string; relation: string; index?: string }[];
  joins: string[];
  /** Nodes where estimate and actual differ ≥10× (and > 10 rows). */
  misestimates: { node: PlanNode; factor: number }[];
}

type Raw = Record<string, unknown>;

const PROP_KEYS: [string, string][] = [
  ['Index Cond', 'Index Cond'],
  ['Recheck Cond', 'Recheck'],
  ['Filter', 'Filter'],
  ['Join Filter', 'Join Filter'],
  ['Hash Cond', 'Hash Cond'],
  ['Merge Cond', 'Merge Cond'],
  ['Sort Key', 'Sort Key'],
  ['Group Key', 'Group Key'],
  ['Presorted Key', 'Presorted'],
  ['Sort Method', 'Sort Method'],
  ['Strategy', 'Strategy'],
  ['Join Type', 'Join Type'],
  ['Heap Fetches', 'Heap Fetches'],
  ['Scan Direction', 'Direction'],
  ['CTE Name', 'CTE'],
  ['Subplan Name', 'Subplan'],
];

let counter = 0;
function toNode(p: Raw): PlanNode {
  const strategy = p['Strategy'];
  const nodeType = String(p['Node Type']);
  const type = nodeType === 'Aggregate' && strategy === 'Hashed' ? 'HashAggregate' : nodeType === 'Aggregate' && strategy === 'Sorted' ? 'GroupAggregate' : nodeType;
  const rel = p['Relation Name'] as string | undefined;
  const alias = p['Alias'] as string | undefined;
  const index = p['Index Name'] as string | undefined;
  const props: { k: string; v: string }[] = [];
  for (const [k, label] of PROP_KEYS) {
    const v = p[k];
    if (v === undefined || v === null || v === '') continue;
    props.push({ k: label, v: Array.isArray(v) ? v.join(', ') : String(v) });
  }
  const parent = p['Parent Relationship'] as string | undefined;
  if (parent && parent !== 'Outer' && parent !== 'Inner') props.push({ k: 'Role', v: parent });
  let detail = '';
  if (rel) detail = `on ${rel}${alias && alias !== rel ? ` ${alias}` : ''}`;
  if (index) detail += `${detail ? ' ' : ''}using ${index}`;
  if (!detail && p['CTE Name']) detail = `on ${p['CTE Name']}`;
  if (!detail && p['Function Name']) detail = `on ${p['Function Name']}()`;
  const joinType = p['Join Type'] as string | undefined;
  const fullType = joinType && joinType !== 'Inner' && /Join|Loop/.test(type) ? `${type} (${joinType})` : type;
  return {
    id: `n${counter++}`,
    type: fullType,
    detail,
    relation: rel,
    index,
    props,
    startupCost: Number(p['Startup Cost'] ?? 0),
    totalCost: Number(p['Total Cost'] ?? 0),
    planRows: Number(p['Plan Rows'] ?? 0),
    actualRows: p['Actual Rows'] !== undefined ? Number(p['Actual Rows']) : undefined,
    loops: p['Actual Loops'] !== undefined ? Number(p['Actual Loops']) : undefined,
    actualMs: p['Actual Total Time'] !== undefined ? Number(p['Actual Total Time']) : undefined,
    removedByFilter: p['Rows Removed by Filter'] !== undefined ? Number(p['Rows Removed by Filter']) : (p['Rows Removed by Index Recheck'] as number | undefined),
    children: ((p['Plans'] as Raw[] | undefined) ?? []).map(toNode),
  };
}

export function walk(n: PlanNode, f: (n: PlanNode, depth: number) => void, depth = 0) {
  f(n, depth);
  n.children.forEach((c) => walk(c, f, depth + 1));
}

export function summarizePlan(raw: unknown): PlanSummary {
  const r = raw as Raw;
  const root = toNode((r['Plan'] ?? r) as Raw);
  const nodeTypes: string[] = [];
  const scans: PlanSummary['scans'] = [];
  const joins: string[] = [];
  const misestimates: PlanSummary['misestimates'] = [];
  walk(root, (n) => {
    nodeTypes.push(n.type);
    if (/Scan/.test(n.type) && n.relation) scans.push({ type: n.type, relation: n.relation, index: n.index });
    if (/Join|Nested Loop/.test(n.type)) joins.push(n.type);
    if (n.actualRows !== undefined) {
      const actual = n.actualRows * (n.loops ?? 1);
      const est = n.planRows * (n.loops ?? 1);
      const hi = Math.max(actual, est);
      const lo = Math.max(1, Math.min(actual, est));
      if (hi > 10 && hi / lo >= 10) misestimates.push({ node: n, factor: Math.round(hi / lo) });
    }
  });
  return {
    root,
    totalCost: root.totalCost,
    executionMs: r['Execution Time'] as number | undefined,
    planningMs: r['Planning Time'] as number | undefined,
    nodeTypes,
    scans,
    joins,
    misestimates,
  };
}

/** Flat text (for `mustContain` checks and diffs). */
export function planText(s: PlanSummary): string {
  const lines: string[] = [];
  walk(s.root, (n, d) => lines.push(`${'  '.repeat(d)}${n.type} ${n.detail} ${n.props.map((p) => `${p.k}: ${p.v}`).join(' ')}`));
  return lines.join('\n');
}

export interface PlanChange {
  costBefore: number;
  costAfter: number;
  msBefore?: number;
  msAfter?: number;
  lines: string[];
}

/** Explain what changed between two plans in words. */
export function diffPlans(a: PlanSummary, b: PlanSummary): PlanChange {
  const lines: string[] = [];
  const scanKey = (x: PlanSummary['scans'][number]) => `${x.relation}`;
  const before = new Map(a.scans.map((x) => [scanKey(x), x]));
  for (const s of b.scans) {
    const old = before.get(scanKey(s));
    if (old && (old.type !== s.type || old.index !== s.index)) lines.push(`${s.relation}: ${old.type}${old.index ? ` (${old.index})` : ''} → **${s.type}**${s.index ? ` (${s.index})` : ''}`);
  }
  const ja = a.joins.join(', ');
  const jb = b.joins.join(', ');
  if (ja !== jb) lines.push(`Join strategy: ${ja || 'none'} → **${jb || 'none'}**`);
  const sa = a.nodeTypes.filter((t) => /Sort|Aggregate|Hash$|Materialize|Unique|Limit/.test(t)).join(', ');
  const sb = b.nodeTypes.filter((t) => /Sort|Aggregate|Hash$|Materialize|Unique|Limit/.test(t)).join(', ');
  if (sa !== sb) lines.push(`Other steps: ${sa || 'none'} → ${sb || 'none'}`);
  const ratio = a.totalCost > 0 ? b.totalCost / a.totalCost : 1;
  lines.push(
    `Estimated cost ${fmt(a.totalCost)} → ${fmt(b.totalCost)} (${ratio < 1 ? `${Math.round((1 - ratio) * 100)}% cheaper` : ratio > 1 ? `${Math.round((ratio - 1) * 100)}% more expensive` : 'unchanged'})`,
  );
  if (a.executionMs !== undefined && b.executionMs !== undefined) lines.push(`Measured ${a.executionMs.toFixed(1)} ms → ${b.executionMs.toFixed(1)} ms`);
  return { costBefore: a.totalCost, costAfter: b.totalCost, msBefore: a.executionMs, msAfter: b.executionMs, lines };
}

export const fmt = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 100 ? String(Math.round(n)) : String(Math.round(n * 100) / 100));

/** How each executor node actually works (the "how is it implemented" layer). */
export const NODE_GLOSSARY: Record<string, { what: string; how: string; cost: string; when: string }> = {
  'Seq Scan': {
    what: 'Reads every page of the table in physical order and tests each row.',
    how: 'Walks the heap file 8 KB page by page (sequential I/O, read-ahead friendly), checks tuple visibility (MVCC) and applies the Filter to each row.',
    cost: 'O(pages + rows). Cheap per row; expensive when you need few rows from a big table.',
    when: 'Chosen when a large fraction of rows match (≳5–10%), the table is small, or no index fits the predicate.',
  },
  'Index Scan': {
    what: 'Descends a B-tree to the first matching key, then follows each index entry to the heap row.',
    how: 'Root → internal pages → leaf (≈3–4 page reads), then walks the leaf chain; for each TID it fetches the heap page (random I/O) and checks visibility.',
    cost: 'O(log n + matches × random heap fetch). Great for few rows; random I/O makes it worse than a seq scan for many rows.',
    when: 'Selective predicates, ORDER BY … LIMIT that matches the index order, and inner side of nested loops.',
  },
  'Index Only Scan': {
    what: 'Answers the query from the index alone — no heap visit for pages marked all-visible.',
    how: 'Like an index scan, but every needed column is in the index (key or INCLUDE); consults the visibility map and only touches the heap for recently changed pages (Heap Fetches).',
    cost: 'O(log n + matches) with sequential-ish leaf reads. The cheapest way to read a slice.',
    when: 'Covering index (all selected/filtered columns in it) on a well-vacuumed table.',
  },
  'Bitmap Heap Scan': {
    what: 'Fetches heap pages flagged by a bitmap, in physical order.',
    how: 'A Bitmap Index Scan first collects matching TIDs into an in-memory bitmap (per page, lossy if work_mem is small); the heap is then read page-order, rechecking conditions.',
    cost: 'Between index scan and seq scan: avoids repeated random reads of the same page.',
    when: 'Medium selectivity, or combining several indexes with BitmapAnd / BitmapOr.',
  },
  'Bitmap Index Scan': {
    what: 'Scans an index and produces a bitmap of matching row locations (no heap access yet).',
    how: 'Walks the B-tree range and sets one bit per TID (or per page when lossy).',
    cost: 'Index pages only.',
    when: 'Always under a Bitmap Heap Scan (or BitmapAnd/Or).',
  },
  'Nested Loop': {
    what: 'For each outer row, scan the inner side for matches.',
    how: 'Two nested for-loops. Fast only if the inner side is an index lookup (or tiny/materialised).',
    cost: 'O(outer × cost(inner lookup)). Excellent for small outer sets with an indexed inner; disastrous for big × big without an index.',
    when: 'Small outer input, inner indexed on the join key, LATERAL / correlated access, non-equality joins.',
  },
  'Hash Join': {
    what: 'Builds a hash table on the smaller input, then probes it with each row of the larger.',
    how: 'Build phase hashes the inner relation by join key into work_mem buckets (spilling to batches on disk if too big); probe phase streams the outer side and looks up each key.',
    cost: 'O(n + m) time, O(smaller side) memory. Needs an equality condition.',
    when: 'Large unsorted inputs joined on equality — the default workhorse of analytics joins.',
  },
  Hash: {
    what: 'The build side of a Hash Join: an in-memory hash table.',
    how: 'Reads all rows of its child into buckets keyed by the join key. Buckets/Batches > 1 means it spilled to disk.',
    cost: 'Memory proportional to the input (work_mem).',
    when: 'Always under a Hash Join.',
  },
  'Merge Join': {
    what: 'Walks two inputs sorted on the join key in lock-step.',
    how: 'Like the merge step of merge sort: advance whichever side has the smaller key; emit pairs on equality (re-scanning duplicates on the inner side).',
    cost: 'O(n + m) once sorted; sorts (or ordered index scans) may be needed first.',
    when: 'Both inputs are already ordered (indexes) or must be sorted anyway; very large joins.',
  },
  Sort: {
    what: 'Orders its input.',
    how: 'Quicksort in memory when it fits in work_mem; external merge sort on disk otherwise ("Sort Method: external merge"). "top-N heapsort" when followed by a small LIMIT.',
    cost: 'O(n log n); disk spills are 10–100× slower.',
    when: 'ORDER BY, DISTINCT, GROUP BY / merge joins / window functions without a suitable index.',
  },
  'Incremental Sort': {
    what: 'Sorts by extra keys within groups already sorted by a prefix.',
    how: 'Input arrives sorted on the first key(s) (e.g. from an index); only each small run is sorted on the remaining keys.',
    cost: 'Much less memory than a full sort; can stream with LIMIT.',
    when: 'An index provides a prefix of the requested ORDER BY.',
  },
  Aggregate: {
    what: 'Computes aggregates (plain, sorted-group or hashed).',
    how: 'Plain: one pass, one output row. Sorted (GroupAggregate): input sorted by group key, emits when the key changes. Hashed (HashAggregate): hash table keyed by group, one entry per group in memory.',
    cost: 'O(n). HashAggregate memory grows with the number of groups.',
    when: 'GROUP BY, DISTINCT, aggregates.',
  },
  HashAggregate: {
    what: 'Groups rows with a hash table keyed by the GROUP BY columns.',
    how: 'One pass; each row updates its group’s running aggregate state. Spills to disk if the groups exceed work_mem.',
    cost: 'O(n) time, O(groups) memory; output is unordered.',
    when: 'Unsorted input, moderate number of groups.',
  },
  GroupAggregate: {
    what: 'Groups rows that arrive already sorted by the group key.',
    how: 'Keeps one running state; emits a row each time the key changes. Streams and needs almost no memory.',
    cost: 'O(n) plus any sort below it.',
    when: 'Input sorted (index or explicit Sort), or very many groups.',
  },
  WindowAgg: {
    what: 'Evaluates window functions over partitions of sorted input.',
    how: 'Input sorted by PARTITION BY + ORDER BY; keeps a frame buffer (tuplestore) per partition and computes each row’s value from its frame, incrementally where possible.',
    cost: 'Sort cost + O(n) (or O(n × frame) for non-incremental frames).',
    when: 'Any OVER (…) clause.',
  },
  Limit: {
    what: 'Stops pulling rows after N.',
    how: 'The executor is demand-driven (Volcano model): Limit simply stops asking its child for rows, so a streaming plan below it does only N rows of work.',
    cost: 'O(offset + limit) rows from the child — if the child streams. A Sort below still reads everything.',
    when: 'LIMIT / OFFSET / FETCH.',
  },
  Materialize: {
    what: 'Caches its child’s output so it can be re-read cheaply.',
    how: 'Stores rows in a tuplestore (memory, spilling to disk) the first time; rescans read the store.',
    cost: 'One pass + memory.',
    when: 'Inner side of a nested loop that would otherwise be recomputed.',
  },
  Memoize: {
    what: 'Caches inner-side results of a nested loop per parameter value.',
    how: 'LRU hash table keyed by the outer join key; repeated keys skip the inner lookup.',
    cost: 'Saves repeated lookups when outer keys repeat.',
    when: 'Nested loop with many duplicate outer keys (PG14+).',
  },
  'CTE Scan': {
    what: 'Reads a materialised CTE.',
    how: 'The CTE ran once into a tuplestore; each reference scans it. Predicates are NOT pushed into it.',
    cost: 'Materialisation + scan.',
    when: 'Recursive CTEs, CTEs referenced more than once, or WITH … AS MATERIALIZED.',
  },
  'Subquery Scan': {
    what: 'Wraps a subquery in FROM that couldn’t be flattened.',
    how: 'Pulls rows from the subquery’s plan and applies outer filters.',
    cost: 'That of the subquery.',
    when: 'Subqueries with LIMIT, window functions, DISTINCT, etc.',
  },
  Unique: {
    what: 'Removes adjacent duplicates from sorted input.',
    how: 'Compares each row with the previous one.',
    cost: 'O(n) after the sort.',
    when: 'DISTINCT / UNION on sorted input.',
  },
  'Function Scan': {
    what: 'Reads rows produced by a set-returning function (generate_series, unnest…).',
    how: 'Calls the function and buffers its output.',
    cost: 'Depends on the function.',
    when: 'Functions in FROM.',
  },
  Result: {
    what: 'Computes expressions without a table, or applies a one-time filter.',
    how: 'Evaluates the target list once (or per input row for projections).',
    cost: 'Trivial.',
    when: 'SELECT without FROM, constant-false WHERE, projections.',
  },
};

export function glossaryFor(type: string) {
  const base = type.replace(/\s*\(.*\)$/, '');
  return NODE_GLOSSARY[base] ?? (base.includes('Aggregate') ? NODE_GLOSSARY.Aggregate : base.includes('Join') ? NODE_GLOSSARY['Hash Join'] : undefined);
}
