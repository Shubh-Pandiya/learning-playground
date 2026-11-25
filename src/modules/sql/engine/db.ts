/**
 * Main-thread client for the Postgres worker: one shared database per page load,
 * request timeouts that kill and rebuild the worker, and a small status store.
 */
import { create } from 'zustand';
import type { QueryResult, RunOpts, SqlErrorInfo } from './core';
import type { WorkerRequest, WorkerResponse } from './pg.worker';
import { needsPerf } from '../data/dataset';

export type { QueryResult, RunOpts, SqlErrorInfo, Cell } from './core';

export class SqlError extends Error {
  info: SqlErrorInfo;
  timeout?: boolean;
  constructor(info: SqlErrorInfo, timeout?: boolean) {
    super(info.message);
    this.info = info;
    this.timeout = timeout;
  }
}

export type DbPhase = 'idle' | 'booting' | 'ready' | 'loading-perf' | 'restarting' | 'error';

interface DbStatus {
  phase: DbPhase;
  perfLoaded: boolean;
  /** Statements the Lab ran without rollback since the last reset. */
  labChanges: number;
  bootMs?: number;
  error?: string;
}

export const useDbStatus = create<DbStatus>(() => ({ phase: 'idle', perfLoaded: false, labChanges: 0 }));

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> };
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();
let ready: Promise<void> | null = null;
let wantPerf = false;

function spawn(): Promise<void> {
  const w = new Worker(new URL('./pg.worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const r = ev.data;
    const p = pending.get(r.id);
    if (!p) return;
    pending.delete(r.id);
    clearTimeout(p.timer);
    if (r.ok) p.resolve(r.value);
    else p.reject(new SqlError(r.error));
  };
  w.onerror = (ev) => {
    useDbStatus.setState({ phase: 'error', error: ev.message || 'Database worker crashed' });
  };
  const t0 = performance.now();
  useDbStatus.setState((s) => ({ phase: s.phase === 'restarting' ? 'restarting' : 'booting', error: undefined }));
  return send({ type: 'ping' }, 60000).then(async () => {
    if (wantPerf) {
      useDbStatus.setState({ phase: 'loading-perf' });
      await send({ type: 'perf' }, 120000);
    }
    useDbStatus.setState({ phase: 'ready', bootMs: Math.round(performance.now() - t0), perfLoaded: wantPerf });
  });
}

function send<T = unknown>(msg: DistributiveOmit<WorkerRequest, 'id'>, timeoutMs: number): Promise<T> {
  const w = worker!;
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        new SqlError(
          { message: `Cancelled after ${Math.round(timeoutMs / 1000)}s. The database was restarted (Lab changes were reset).`, hint: 'Look for an unbounded join (missing ON condition) or a query that scans the big tables many times.' },
          true,
        ),
      );
      restart();
    }, timeoutMs);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    w.postMessage({ ...msg, id });
  });
}

function restart() {
  worker?.terminate();
  worker = null;
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new SqlError({ message: 'Database restarted.' }));
  }
  pending.clear();
  useDbStatus.setState({ phase: 'restarting', labChanges: 0 });
  ready = spawn().catch((e) => {
    useDbStatus.setState({ phase: 'error', error: String(e?.message ?? e) });
    throw e;
  });
}

/** Boot (once) and wait until the seeded database is ready. */
export function bootDb(): Promise<void> {
  if (!ready) {
    ready = spawn().catch((e) => {
      ready = null;
      useDbStatus.setState({ phase: 'error', error: String(e?.message ?? e) });
      throw e;
    });
  }
  return ready;
}

export async function ensurePerf(): Promise<void> {
  await bootDb();
  if (useDbStatus.getState().perfLoaded) return;
  wantPerf = true;
  useDbStatus.setState({ phase: 'loading-perf' });
  await send({ type: 'perf' }, 120000);
  useDbStatus.setState({ phase: 'ready', perfLoaded: true });
}

const DEFAULT_TIMEOUT = 12000;

/** Run SQL. Rolled back by default so lessons never leak state into each other. */
export async function runQuery(sql: string, opts: RunOpts = {}, timeoutMs = DEFAULT_TIMEOUT): Promise<QueryResult> {
  await bootDb();
  if (needsPerf(sql + (opts.setup ?? ''))) await ensurePerf();
  const r = await send<QueryResult>({ type: 'run', sql, opts }, timeoutMs);
  if (opts.rollback === false && /\b(create|drop|alter|insert|update|delete|truncate)\b/i.test(sql)) {
    useDbStatus.setState((s) => ({ labChanges: s.labChanges + 1 }));
  }
  return r;
}

export async function explainQuery(sql: string, analyze: boolean, setup?: string, timeoutMs = DEFAULT_TIMEOUT): Promise<unknown> {
  await bootDb();
  if (needsPerf(sql + (setup ?? ''))) await ensurePerf();
  return send({ type: 'explain', sql, analyze, setup }, timeoutMs);
}

/** Throw away every change (Lab indexes, inserted rows…) and re-seed. */
export async function resetDb(): Promise<void> {
  restart();
  await ready;
}
