/**
 * Content validator: every SQL string in the content runs for real against the seeded PGlite.
 *
 *   export PATH=/opt/homebrew/bin:$PATH
 *   npx rolldown src/modules/sql/scripts/validate.ts --file node_modules/.cache/sql-validate.mjs \
 *     --platform node --format esm --external @electric-sql/pglite && node node_modules/.cache/sql-validate.mjs [trackOrConceptId]
 *
 * Debug a single query's pipeline:
 *   npx rolldown src/modules/sql/scripts/pipe.ts --file node_modules/.cache/sql-pipe.mjs --platform node --format esm \
 *     --external @electric-sql/pglite && node node_modules/.cache/sql-pipe.mjs "<sql>" [recursiveLevelColumn]
 */
import { makeDb } from './nodeDb';
import { CONCEPTS } from '../content';
import { buildPipeline } from '../engine/pipeline';
import { assembleSql, correctPlacement, placementWithTrap } from '../engine/builder';
import { compareResults } from '../engine/compare';
import { summarizePlan, type PlanSummary } from '../engine/plan';
import { checkPlan, isOrdered } from '../engine/grade';
import type { Concept } from '../types';
import { PLANNED } from '../content/tracks';
import { planText } from '../engine/plan';
import type { QueryResult } from '../engine/core';

const filter = process.argv[2];
const db = await makeDb();
let errors = 0;
let warnings = 0;
const err = (c: Concept, m: string) => {
  errors++;
  console.log(`  ✗ [${c.id}] ${m}`);
};
const warn = (c: Concept, m: string) => {
  warnings++;
  console.log(`  ! [${c.id}] ${m}`);
};
const tryRun = async (sql: string, setup?: string): Promise<QueryResult | Error> => {
  try {
    return await db.run(sql, { setup, maxRows: 5000 });
  } catch (e) {
    return e as Error;
  }
};
const tryPlan = async (sql: string, setup?: string): Promise<PlanSummary | Error> => {
  try {
    return summarizePlan(await db.explain(sql, false, setup));
  } catch (e) {
    return e as Error;
  }
};

const ids = new Set<string>();
const exIds = new Set<string>();
const all = [...CONCEPTS.map((c) => c.id), ...Object.values(PLANNED).flat()];
for (const c of CONCEPTS) {
  if (ids.has(c.id)) err(c, 'duplicate concept id');
  ids.add(c.id);
}
const list = CONCEPTS.filter((c) => !filter || c.id === filter || c.track === filter);
console.log(`Validating ${list.length} concept(s)…`);

for (const c of list) {
  console.log(`• ${c.track}/${c.id}`);
  // ---- shape
  for (const k of ['intuition', 'internals', 'signals', 'realWorld', 'mistakes', 'recall', 'transfer'] as const)
    if (!Array.isArray(c[k]) || !c[k].length) err(c, `${k} must be a non-empty array`);
  if (c.exercises.length < 2) warn(c, 'fewer than 2 exercises');
  if (c.transfer.length < 2) warn(c, 'fewer than 2 transfer scenarios');
  for (const x of c.confusable) if (!all.includes(x)) warn(c, `confusable id "${x}" does not exist (yet)`);
  for (const t of c.transfer) {
    if (exIds.has(t.id)) err(c, `duplicate id ${t.id}`);
    exIds.add(t.id);
  }

  // ---- worked example
  const w = await tryRun(c.worked.sql);
  if (w instanceof Error) err(c, `worked.sql fails: ${w.message}`);
  else if (w.rowCount === 0) warn(c, 'worked.sql returns 0 rows');
  if (c.viz === 'pipeline' || c.viz === 'recursive') {
    try {
      const p = await buildPipeline(c.worked.sql, db.runner, { recursiveLevel: c.worked.recursiveLevel });
      if (!p) err(c, 'worked.sql cannot be staged by the pipeline parser (no UNION/WINDOW clause/multiple statements at top level)');
      else {
        for (const s of p.stages) if (s.error) err(c, `pipeline stage ${s.key} failed: ${s.error}`);
        for (const pr of c.worked.predictions ?? []) {
          const st = p.stages.find((s) => s.id === pr.stage);
          if (!st) err(c, `prediction stage "${pr.stage}" not in pipeline (${p.stages.map((s) => s.id).join(',')})`);
          if (pr.kind === 'choice' && (!pr.options || pr.answer === undefined || pr.answer < 0 || pr.answer >= pr.options.length)) err(c, 'choice prediction needs options + valid answer');
        }
        if (c.viz === 'recursive') {
          const cte = p.stages.find((s) => s.id === 'cte' && s.iterations);
          if (!cte) err(c, `viz 'recursive' needs worked.recursiveLevel naming the depth column of the recursive CTE`);
        }
      }
    } catch (e) {
      err(c, `pipeline threw: ${(e as Error).message}`);
    }
  }

  // ---- plan / index variants
  if ((c.viz === 'plan' || c.viz === 'index') && (c.variants?.length ?? 0) < 2) err(c, `viz '${c.viz}' needs at least 2 variants`);
  if (c.viz === 'isolation' && !c.scenarios?.length) err(c, "viz 'isolation' needs scenarios");
  let prevPlan = '';
  for (const v of c.variants ?? []) {
    const r = await tryRun(v.sql, v.setup);
    if (r instanceof Error) err(c, `variant "${v.label}" fails: ${r.message}`);
    const pl = await tryPlan(v.sql, v.setup);
    if (pl instanceof Error) {
      err(c, `variant "${v.label}" EXPLAIN fails: ${pl.message}`);
      continue;
    }
    const txt = planText(pl).replace(/\d+(\.\d+)?/g, '#');
    if (txt === prevPlan) warn(c, `variant "${v.label}" has the same plan shape as the previous variant`);
    prevPlan = txt;
    if (process.env.SHOW_PLANS) console.log(`    [${v.label}] cost ${Math.round(pl.totalCost)}\n${planText(pl).replace(/^/gm, '      ')}`);
  }

  // ---- builder
  if (c.build) {
    const b = c.build;
    const sql = assembleSql(b, correctPlacement(b));
    if (!sql) err(c, 'build: correct blocks do not fill SELECT and FROM of every scope');
    else {
      const ref = await tryRun(sql);
      if (ref instanceof Error) err(c, `build: assembled correct SQL fails: ${ref.message}\n${sql}`);
      else {
        if (ref.rowCount === 0) warn(c, 'build: correct result has 0 rows');
        for (const t of b.traps) {
          if (b.blocks.some((x) => x.sql.trim() === t.sql.trim() && (x.scope ?? '') === (t.scope ?? '') && x.slot === t.slot))
            err(c, `build trap "${t.sql}" is identical to a correct block in the same slot — not a trap`);
          if (t.replaces && !b.blocks.some((x) => x.sql === t.replaces && (x.scope ?? '') === (t.scope ?? '') && x.slot === t.slot))
            err(c, `build trap "${t.sql}" replaces "${t.replaces}" which is not a block in the same scope/slot`);
          const ts = assembleSql(b, placementWithTrap(b, t));
          if (!ts) continue;
          const tr = await tryRun(ts);
          if (tr instanceof Error) continue;
          const v = compareResults(tr, ref, isOrdered({ solution: sql }));
          if (v.ok) err(c, `build trap "${t.sql}" gives the SAME result as the correct query — not a trap on this data`);
        }
      }
    }
  }

  // ---- exercises
  for (const ex of c.exercises) {
    if (exIds.has(ex.id)) err(c, `duplicate exercise id ${ex.id}`);
    exIds.add(ex.id);
    const sol = await tryRun(ex.solution, ex.setup);
    if (sol instanceof Error) {
      err(c, `exercise ${ex.id} solution fails: ${sol.message}`);
      continue;
    }
    if (sol.rowCount === 0) warn(c, `exercise ${ex.id} solution returns 0 rows`);
    if (!ex.hints.length) warn(c, `exercise ${ex.id} has no hints`);
    if (ex.kind === 'fix-bug') {
      if (!ex.starter) err(c, `fix-bug ${ex.id} needs starter`);
      else {
        const st = await tryRun(ex.starter, ex.setup);
        if (!(st instanceof Error) && compareResults(st, sol, isOrdered(ex)).ok) err(c, `fix-bug ${ex.id}: starter already returns the correct result`);
      }
    }
    if (ex.kind === 'optimize') {
      if (!ex.starter || !ex.plan) err(c, `optimize ${ex.id} needs starter and plan requirements`);
      else {
        const st = await tryRun(ex.starter, ex.setup);
        if (st instanceof Error) err(c, `optimize ${ex.id} starter fails: ${st.message}`);
        else if (!compareResults(st, sol, isOrdered(ex)).ok) err(c, `optimize ${ex.id}: starter and solution must return the same result`);
        const ps = await tryPlan(ex.starter, ex.setup);
        const pl = await tryPlan(ex.solution, ex.setup);
        if (ps instanceof Error || pl instanceof Error) err(c, `optimize ${ex.id}: EXPLAIN failed`);
        else {
          if (!checkPlan(ex, pl, ps).ok) err(c, `optimize ${ex.id}: solution plan fails requirements: ${checkPlan(ex, pl, ps).problems.join(' ')}`);
          if (checkPlan(ex, ps, ps).ok && !ex.plan.maxCostRatio) err(c, `optimize ${ex.id}: starter already satisfies the plan requirements`);
        }
      }
    }
  }

  // ---- judgment
  for (const j of c.judgment ?? []) {
    if (exIds.has(j.id)) err(c, `duplicate judgment id ${j.id}`);
    exIds.add(j.id);
    if (j.options.filter((o) => o.correct).length !== 1) err(c, `judgment ${j.id} needs exactly one correct option`);
    const n = j.sql.split('\n').length;
    if (!j.bugLines.length || j.bugLines.some((l) => l < 1 || l > n)) err(c, `judgment ${j.id} bugLines out of range (1..${n})`);
    const a = await tryRun(j.sql, j.setup);
    const b = await tryRun(j.fixedSql, j.setup);
    if (b instanceof Error) err(c, `judgment ${j.id} fixedSql fails: ${b.message}`);
    if (a instanceof Error && j.kind !== 'spot-bug') err(c, `judgment ${j.id} sql fails: ${a.message}`);
    if (j.comparePlans) {
      const pa = await tryPlan(j.sql, j.setup);
      const pb = await tryPlan(j.fixedSql, j.setup);
      if (pa instanceof Error || pb instanceof Error) err(c, `judgment ${j.id}: EXPLAIN failed`);
    } else if (!(a instanceof Error) && !(b instanceof Error) && compareResults(a, b, false).ok) {
      warn(c, `judgment ${j.id}: buggy and fixed SQL return the same rows on this data (fine only if the bug is about perf/robustness)`);
    }
  }
}

console.log(`\n${errors} error(s), ${warnings} warning(s).`);
process.exit(errors ? 1 : 0);
