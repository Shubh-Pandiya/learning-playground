/// <reference lib="webworker" />
/**
 * Dedicated worker that owns the in-browser Postgres. Keeping it off the main thread
 * means a runaway query (say, an accidental cross join on 200k rows) can be killed by
 * terminating the worker instead of freezing the tab.
 */
import { PGlite } from '@electric-sql/pglite';
import { PERF_SQL, SEED_SQL } from '../data/dataset';
import { errorInfo, explainSql, runSql, type RunOpts } from './core';

export type WorkerRequest =
  | { id: number; type: 'run'; sql: string; opts?: RunOpts }
  | { id: number; type: 'explain'; sql: string; analyze: boolean; setup?: string }
  | { id: number; type: 'perf' }
  | { id: number; type: 'ping' };

export type WorkerResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: ReturnType<typeof errorInfo> };

let pg: PGlite | null = null;
let perfLoaded = false;
let chain: Promise<unknown> = Promise.resolve();

async function db(): Promise<PGlite> {
  if (!pg) {
    const inst = new PGlite();
    await inst.waitReady;
    await inst.exec(SEED_SQL);
    pg = inst;
  }
  return pg;
}

async function handle(req: WorkerRequest): Promise<unknown> {
  const p = await db();
  switch (req.type) {
    case 'ping':
      return { perfLoaded };
    case 'run':
      return runSql(p, req.sql, req.opts);
    case 'explain':
      return explainSql(p, req.sql, req.analyze, req.setup);
    case 'perf':
      if (!perfLoaded) {
        await p.exec(PERF_SQL);
        perfLoaded = true;
      }
      return { perfLoaded };
  }
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  // serialise: BEGIN … ROLLBACK sequences must never interleave
  chain = chain
    .then(() => handle(req))
    .then(
      (value) => (self as unknown as Worker).postMessage({ id: req.id, ok: true, value } satisfies WorkerResponse),
      (e) => (self as unknown as Worker).postMessage({ id: req.id, ok: false, error: errorInfo(e) } satisfies WorkerResponse),
    );
};
