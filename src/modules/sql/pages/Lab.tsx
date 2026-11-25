import { useState } from 'react';
import { ChevronRight, Eye, Gauge, Play, RotateCcw, Table2 } from 'lucide-react';
import { Button, Callout, Tag } from '@/shared/ui';
import { cn } from '@/shared/cn';
import { SCHEMA } from '../data/dataset';
import { resetDb, runQuery, useDbStatus, type QueryResult } from '../engine/db';
import { describeChange, type ResultChange } from '../engine/compare';
import { diffPlans, type PlanChange, type PlanSummary } from '../engine/plan';
import { parseQuery } from '../engine/parse';
import { useSql } from '../store';
import { DbBadge, Md, PageHeader, SqlEditor, SqlErrorBox } from '../ui/common';
import { errHint, errMsg, explainSummary, useBootDb } from '../ui/hooks';
import { RunResult } from '../ui/Practice';
import { PlanTree } from '../ui/PlanTree';
import { PipelineViewer } from '../ui/PipelineViewer';

const SAMPLES: { label: string; sql: string }[] = [
  {
    label: 'Revenue per country (fan-out safe)',
    sql: `SELECT u.country, COUNT(DISTINCT o.id) AS orders, SUM(oi.qty * oi.unit_price) AS revenue
FROM users u
JOIN orders o ON o.user_id = u.id
JOIN order_items oi ON oi.order_id = o.id
WHERE o.status <> 'cancelled'
GROUP BY u.country
ORDER BY revenue DESC;`,
  },
  {
    label: 'Latest order per user (top-1 per group)',
    sql: `SELECT *
FROM (
  SELECT o.*, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY ordered_at DESC) AS rn
  FROM orders o
) t
WHERE rn = 1;`,
  },
  {
    label: 'Running total per user',
    sql: `SELECT user_id, ordered_at, amount,
       SUM(amount) OVER (PARTITION BY user_id ORDER BY ordered_at) AS running_total
FROM orders
ORDER BY user_id, ordered_at;`,
  },
  {
    label: 'Users who never ordered (anti join)',
    sql: `SELECT u.id, u.name
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);`,
  },
  {
    label: 'Index experiment (persist mode)',
    sql: `-- turn on "Keep changes" first, run once, then EXPLAIN the query below
CREATE INDEX IF NOT EXISTS big_orders_user_idx ON big_orders (user_id);
ANALYZE big_orders;`,
  },
  {
    label: 'Perf: point lookup on 200k rows',
    sql: `SELECT * FROM big_orders WHERE user_id = 4242;`,
  },
];

type Run = { status: 'ok'; result: QueryResult; change?: ResultChange; prev?: QueryResult } | { status: 'error'; error: string; hint?: string } | { status: 'loading' } | null;
type PlanState = { status: 'ok'; plan: PlanSummary; change?: PlanChange } | { status: 'error'; error: string; hint?: string } | { status: 'loading' } | null;

export default function Lab() {
  useBootDb();
  const sql = useSql((s) => s.labSql);
  const setSql = useSql((s) => s.setLabSql);
  const labChanges = useDbStatus((s) => s.labChanges);
  const [persist, setPersist] = useState(false);
  const [run, setRun] = useState<Run>(null);
  const [last, setLast] = useState<QueryResult | null>(null);
  const [plan, setPlan] = useState<PlanState>(null);
  const [lastPlan, setLastPlan] = useState<PlanSummary | null>(null);
  const [viz, setViz] = useState<string | null>(null);
  const [table, setTable] = useState<string | null>(null);

  const doRun = async () => {
    setRun({ status: 'loading' });
    setViz(null);
    try {
      const result = await runQuery(sql, { rollback: !persist, maxRows: 500 }, 60000);
      const comparable = last && result.columns.length > 0;
      setRun({ status: 'ok', result, change: comparable ? describeChange(last, result) : undefined, prev: comparable ? last : undefined });
      if (result.columns.length) setLast(result);
    } catch (e) {
      setRun({ status: 'error', error: errMsg(e), hint: errHint(e) });
    }
  };
  const doExplain = async () => {
    setPlan({ status: 'loading' });
    try {
      const p = await explainSummary(sql, true);
      setPlan({ status: 'ok', plan: p, change: lastPlan ? diffPlans(lastPlan, p) : undefined });
      setLastPlan(p);
    } catch (e) {
      setPlan({ status: 'error', error: errMsg(e), hint: errHint(e) });
    }
  };
  const canViz = !!parseQuery(sql);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Free practice" title="Query lab" actions={<DbBadge />}>
        Full Postgres 17 in your browser on the same seeded data as the lessons. Every run is compared with your previous run so you see exactly what your change did — rows gained or lost, cardinality, plan and timing.
      </PageHeader>
      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-4">
          <SqlEditor value={sql} onChange={setSql} onRun={doRun} minRows={9} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<Play className="h-4 w-4" />} onClick={doRun} disabled={run?.status === 'loading'}>
              Run <span className="ml-1 text-[10px] opacity-70">⌘↵</span>
            </Button>
            <Button variant="secondary" icon={<Gauge className="h-4 w-4" />} onClick={doExplain} disabled={plan?.status === 'loading'}>
              EXPLAIN ANALYZE
            </Button>
            <Button variant="secondary" icon={<Eye className="h-4 w-4" />} onClick={() => setViz(viz ? null : sql)} disabled={!canViz} title={canViz ? 'Watch each logical stage run' : 'Only single SELECT statements can be staged'}>
              {viz ? 'Hide stages' : 'Visualize stages'}
            </Button>
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12px] text-muted">
              <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} />
              Keep changes (DDL/DML persist)
            </label>
            {labChanges > 0 && (
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw className="h-3.5 w-3.5" />}
                onClick={async () => {
                  await resetDb();
                  setLast(null);
                  setLastPlan(null);
                  setRun(null);
                  setPlan(null);
                }}
              >
                Reset DB ({labChanges} change{labChanges === 1 ? '' : 's'})
              </Button>
            )}
          </div>
          {!persist && /\b(insert|update|delete|create|drop|alter)\b/i.test(sql) && (
            <Callout tone="info">Statements run inside BEGIN … ROLLBACK, so you see their effect but nothing persists. Tick “Keep changes” to make an index or row stick for later runs.</Callout>
          )}

          {viz && (
            <div className="rounded-xl border border-line bg-surface p-4 shadow-paper">
              <PipelineViewer sql={viz} />
            </div>
          )}

          {run?.status === 'loading' && <div className="text-sm text-muted">running…</div>}
          {run?.status === 'error' && <SqlErrorBox message={run.error} hint={run.hint} />}
          {run?.status === 'ok' &&
            (run.result.columns.length ? (
              <RunResult result={run.result} change={run.change} prevRows={run.prev} />
            ) : (
              <Callout tone="ok">
                Done{run.result.affected !== undefined ? ` · ${run.result.affected} row(s) affected` : ''} · {run.result.ms.toFixed(1)} ms{persist ? ' · persisted' : ' · rolled back'}
              </Callout>
            ))}

          {plan?.status === 'loading' && <div className="text-sm text-muted">explaining…</div>}
          {plan?.status === 'error' && <SqlErrorBox message={plan.error} hint={plan.hint} />}
          {plan?.status === 'ok' && (
            <div className="space-y-3 rounded-xl border border-line bg-surface p-4 shadow-paper">
              {plan.change && (
                <Callout tone="info" title="Plan: what changed vs your previous EXPLAIN">
                  <ul className="list-disc space-y-0.5 pl-4">
                    {plan.change.lines.map((l, i) => (
                      <li key={i}>
                        <Md text={l} />
                      </li>
                    ))}
                  </ul>
                </Callout>
              )}
              <PlanTree plan={plan.plan} />
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="eyebrow mb-2">Try</div>
            <ul className="space-y-1">
              {SAMPLES.map((s) => (
                <li key={s.label}>
                  <button onClick={() => setSql(s.sql)} className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[12.5px] text-ink hover:bg-sunken">
                    <ChevronRight className="h-3 w-3 text-faint" />
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="eyebrow mb-2">Schema</div>
            <ul className="space-y-0.5">
              {SCHEMA.map((t) => (
                <li key={t.name}>
                  <button onClick={() => setTable(table === t.name ? null : t.name)} className={cn('flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12.5px] hover:bg-sunken', table === t.name && 'bg-sunken')}>
                    <Table2 className="h-3.5 w-3.5 text-faint" />
                    <span className="font-mono text-ink">{t.name}</span>
                    {t.perf && <Tag tone="warn">perf</Tag>}
                    <span className="ml-auto font-mono text-[10px] text-faint">{t.rows}</span>
                  </button>
                  {table === t.name && (
                    <div className="mb-2 ml-5 mt-1 space-y-1 text-[11.5px]">
                      <div className="text-muted">{t.about}</div>
                      {t.columns.map((c) => (
                        <div key={c.name} className="flex gap-2">
                          <span className="font-mono text-ink">{c.name}</span>
                          <span className="font-mono text-faint">{c.type}</span>
                          {c.note && <span className="truncate text-muted">{c.note}</span>}
                        </div>
                      ))}
                      <button className="text-accent hover:underline" onClick={() => setSql(`SELECT * FROM ${t.name} LIMIT 50;`)}>
                        preview rows
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
