/** Node-side database for scripts (validator, pipeline CLI). Not imported by the app. */
import { PGlite } from '@electric-sql/pglite';
import { PERF_SQL, SEED_SQL, needsPerf } from '../data/dataset';
import { explainSql, runSql, type RunOpts } from '../engine/core';
import type { Runner } from '../engine/pipeline';

export async function makeDb() {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(SEED_SQL);
  let perf = false;
  const ensure = async (sql: string) => {
    if (!perf && needsPerf(sql)) {
      await pg.exec(PERF_SQL);
      perf = true;
    }
  };
  const run = async (sql: string, opts: RunOpts = {}) => {
    await ensure(sql + (opts.setup ?? ''));
    return runSql(pg, sql, opts);
  };
  const explain = async (sql: string, analyze: boolean, setup?: string) => {
    await ensure(sql + (setup ?? ''));
    return explainSql(pg, sql, analyze, setup);
  };
  const runner: Runner = (sql, o) => run(sql, { maxRows: o?.maxRows });
  return { pg, run, explain, runner };
}
