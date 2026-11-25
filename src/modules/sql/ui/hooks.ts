import { useEffect, useState } from 'react';
import { buildPipeline, type Pipeline, type Runner } from '../engine/pipeline';
import { bootDb, explainQuery, runQuery, SqlError, type QueryResult } from '../engine/db';
import { summarizePlan, type PlanSummary } from '../engine/plan';

export const browserRunner: Runner = (sql, o) => runQuery(sql, { maxRows: o?.maxRows });

export type Async<T> = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; value: T } | { status: 'error'; error: string; hint?: string };

export const errMsg = (e: unknown) => (e instanceof SqlError ? e.info.message : e instanceof Error ? e.message : String(e));
export const errHint = (e: unknown) => (e instanceof SqlError ? e.info.hint : undefined);

/** Stage a query through the logical pipeline (null result = shape the visualizer can't stage). */
export function usePipeline(sql: string | null, recursiveLevel?: string): Async<Pipeline | null> {
  const [state, setState] = useState<Async<Pipeline | null>>({ status: 'idle' });
  useEffect(() => {
    if (!sql) {
      setState({ status: 'idle' });
      return;
    }
    let alive = true;
    setState({ status: 'loading' });
    buildPipeline(sql, browserRunner, { recursiveLevel })
      .then((p) => alive && setState({ status: 'ok', value: p }))
      .catch((e) => alive && setState({ status: 'error', error: errMsg(e), hint: errHint(e) }));
    return () => {
      alive = false;
    };
  }, [sql, recursiveLevel]);
  return state;
}

export function useQuery(sql: string | null, setup?: string): Async<QueryResult> {
  const [state, setState] = useState<Async<QueryResult>>({ status: 'idle' });
  useEffect(() => {
    if (!sql) return;
    let alive = true;
    setState({ status: 'loading' });
    runQuery(sql, { setup })
      .then((r) => alive && setState({ status: 'ok', value: r }))
      .catch((e) => alive && setState({ status: 'error', error: errMsg(e), hint: errHint(e) }));
    return () => {
      alive = false;
    };
  }, [sql, setup]);
  return state;
}

export async function explainSummary(sql: string, analyze: boolean, setup?: string): Promise<PlanSummary> {
  return summarizePlan(await explainQuery(sql, analyze, setup, 60000));
}

/** Start booting Postgres as soon as a SQL view mounts. */
export function useBootDb() {
  useEffect(() => {
    bootDb().catch(() => undefined);
  }, []);
}
