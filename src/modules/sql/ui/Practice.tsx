import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Eye, Lightbulb, Loader2, Play, RotateCcw, ShieldCheck, XCircle } from 'lucide-react';
import { Button, Callout, Tag } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { Concept, Exercise } from '../types';
import { runQuery, type QueryResult } from '../engine/db';
import { compareResults, describeChange, rowKey, type ResultChange, type Verdict } from '../engine/compare';
import { checkPlan, isOrdered, type PlanCheck } from '../engine/grade';
import type { PlanSummary } from '../engine/plan';
import { useSql } from '../store';
import { Md, ResultTable, SqlEditor, SqlErrorBox, type RowMark } from './common';
import { errHint, errMsg, explainSummary } from './hooks';
import { PlanCompare } from './PlanTree';

// Stable fallback: a fresh `{}` from a zustand selector would re-render forever.
const NO_MARKS: Record<string, never> = {};

const kindLabel: Record<Exercise['kind'], string> = { write: 'Write', 'fix-bug': 'Fix the bug', optimize: 'Make it fast' };
const diffTone = { Easy: 'ok', Medium: 'warn', Hard: 'bad' } as const;

/** Result of the last run + what changed vs the run before (the "every change → impact" loop). */
export function RunResult({ result, change, prevRows }: { result: QueryResult; change?: ResultChange; prevRows?: QueryResult }) {
  const marks = useMemo<RowMark[] | undefined>(() => {
    if (!change?.comparable || !prevRows) return undefined;
    const added = new Set(change.added.map(rowKey));
    return result.rows.map((r) => (added.has(rowKey(r)) ? 'added' : undefined));
  }, [change, prevRows, result]);
  return (
    <div className="space-y-2">
      {change && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="rounded-md border border-info/40 bg-info/[0.06] px-3 py-1.5 text-[12.5px] text-ink">
          <b>What changed vs your last run:</b> {change.summary}
          {change.comparable && change.removed.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[11.5px] text-muted">{change.removed.length} row(s) disappeared</summary>
              <ResultTable columns={result.columns} rows={change.removed.slice(0, 20)} marks={change.removed.slice(0, 20).map(() => 'removed')} dense maxHeight={160} />
            </details>
          )}
        </motion.div>
      )}
      <ResultTable
        columns={result.columns}
        rows={result.rows}
        marks={marks}
        dense
        maxHeight={300}
        caption={
          <span>
            {result.rowCount} row{result.rowCount === 1 ? '' : 's'}
            {result.truncated ? ` (showing ${result.rows.length})` : ''} · {result.ms.toFixed(1)} ms
            {result.affected !== undefined ? ` · ${result.affected} affected (rolled back)` : ''}
          </span>
        }
      />
    </div>
  );
}

type Check =
  | { status: 'checking' }
  | { status: 'done'; verdict: Verdict; plan?: PlanCheck; plans?: { mine: PlanSummary; starter: PlanSummary }; want: QueryResult }
  | { status: 'error'; error: string; hint?: string };

export function ExercisePanel({ concept, ex }: { concept: Concept; ex: Exercise }) {
  const solved = useSql((s) => !!s.concepts[concept.id]?.solved?.[ex.id]);
  const recordSolve = useSql((s) => s.recordSolve);
  const recordHint = useSql((s) => s.recordHint);
  const initial = ex.starter?.trim() ?? `-- ${ex.title}\n`;
  const [sql, setSql] = useState(initial);
  const [run, setRun] = useState<{ status: 'idle' } | { status: 'loading' } | { status: 'ok'; result: QueryResult; change?: ResultChange; prev?: QueryResult } | { status: 'error'; error: string; hint?: string }>({ status: 'idle' });
  const [check, setCheck] = useState<Check | null>(null);
  const [hints, setHints] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [showSol, setShowSol] = useState(false);
  const last = useRef<QueryResult | null>(null);

  useEffect(() => {
    setSql(ex.starter?.trim() ?? `-- ${ex.title}\n`);
    setRun({ status: 'idle' });
    setCheck(null);
    setHints(0);
    setAttempts(0);
    setShowSol(false);
    last.current = null;
  }, [ex]);

  const doRun = async () => {
    setRun({ status: 'loading' });
    try {
      const result = await runQuery(sql, { setup: ex.setup, maxRows: 300 });
      const prev = last.current ?? undefined;
      setRun({ status: 'ok', result, prev, change: prev ? describeChange(prev, result) : undefined });
      last.current = result;
    } catch (e) {
      setRun({ status: 'error', error: errMsg(e), hint: errHint(e) });
    }
  };

  const doCheck = async () => {
    setCheck({ status: 'checking' });
    setAttempts((a) => a + 1);
    try {
      const [got, want] = await Promise.all([runQuery(sql, { setup: ex.setup, maxRows: 100000 }), runQuery(ex.solution, { setup: ex.setup, maxRows: 100000 })]);
      const verdict = compareResults(got, want, isOrdered(ex));
      let plan: PlanCheck | undefined;
      let plans: { mine: PlanSummary; starter: PlanSummary } | undefined;
      if (ex.kind === 'optimize' && ex.starter) {
        const [mine, starter] = await Promise.all([explainSummary(sql, false, ex.setup), explainSummary(ex.starter, false, ex.setup)]);
        plan = checkPlan(ex, mine, starter);
        plans = { mine, starter };
      }
      setCheck({ status: 'done', verdict, plan, plans, want });
      if (verdict.ok && (plan?.ok ?? true)) recordSolve(concept.id, ex.id);
      const prev = last.current ?? undefined;
      setRun({ status: 'ok', result: got, prev, change: prev ? describeChange(prev, got) : undefined });
      last.current = got;
    } catch (e) {
      setCheck({ status: 'error', error: errMsg(e), hint: errHint(e) });
    }
  };

  const pass = check?.status === 'done' && check.verdict.ok && (check.plan?.ok ?? true);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={ex.kind === 'write' ? 'info' : ex.kind === 'fix-bug' ? 'bad' : 'warn'}>{kindLabel[ex.kind]}</Tag>
        <Tag tone={diffTone[ex.difficulty]} variant="outline">
          {ex.difficulty}
        </Tag>
        <h3 className="text-[15px] font-semibold text-ink">{ex.title}</h3>
        {solved && (
          <Tag tone="ok" icon={<CheckCircle2 className="h-3 w-3" />}>
            solved
          </Tag>
        )}
      </div>
      <div className="text-sm leading-relaxed text-muted">
        <Md text={ex.prompt} />
      </div>
      {ex.setup && (
        <div className="rounded-md bg-sunken px-3 py-1.5 font-mono text-[11px] text-muted">
          setup (rolled back after every run): {ex.setup.trim()}
        </div>
      )}
      <SqlEditor value={sql} onChange={setSql} onRun={doRun} minRows={8} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" icon={run.status === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} onClick={doRun}>
          Run <span className="ml-1 text-[10px] opacity-60">⌘↵</span>
        </Button>
        <Button size="sm" icon={check?.status === 'checking' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} onClick={doCheck}>
          Check
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Lightbulb className="h-3.5 w-3.5" />}
          disabled={hints >= ex.hints.length}
          onClick={() => {
            setHints((h) => h + 1);
            recordHint(concept.id);
          }}
        >
          Hint {hints}/{ex.hints.length}
        </Button>
        {(attempts >= 2 || hints >= ex.hints.length || pass) && (
          <Button size="sm" variant="ghost" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => setShowSol((s) => !s)}>
            {showSol ? 'Hide' : 'Show'} reference
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setSql(initial)}>
          Reset
        </Button>
      </div>

      <AnimatePresence>
        {ex.hints.slice(0, hints).map((h, i) => (
          <motion.div key={i} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="flex gap-2 rounded-md border border-warn/40 bg-warn/[0.06] px-3 py-1.5 text-[13px] text-ink">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
            <Md text={h} />
          </motion.div>
        ))}
      </AnimatePresence>

      {check?.status === 'error' && <SqlErrorBox message={check.error} hint={check.hint} />}
      {check?.status === 'done' && (
        <Callout tone={pass ? 'ok' : 'bad'} title={pass ? 'Correct — matches the reference result' + (check.plan ? ' and the plan requirements' : '') : 'Not yet'}>
          {!check.verdict.ok && (
            <div className="flex items-start gap-1.5">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {check.verdict.reason}
                {check.verdict.missing || check.verdict.extra ? ` (${check.verdict.missing} expected row(s) missing, ${check.verdict.extra} unexpected row(s))` : ''}
              </span>
            </div>
          )}
          {check.plan && !check.plan.ok && (
            <ul className="mt-1 list-disc pl-5">
              {check.plan.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
          {pass && (
            <div className="mt-1 text-[13px]">
              <Md text={ex.explanation} />
            </div>
          )}
        </Callout>
      )}
      {check?.status === 'done' && check.plans && <PlanCompare a={check.plans.starter} b={check.plans.mine} labelA="original query" labelB="your query" />}
      {check?.status === 'done' && !check.verdict.ok && (
        <details className="text-[12px] text-muted">
          <summary className="cursor-pointer">Expected result ({check.want.rowCount} rows)</summary>
          <ResultTable columns={check.want.columns} rows={check.want.rows.slice(0, 50)} dense maxHeight={220} />
        </details>
      )}
      {showSol && (
        <div className={cn('rounded-md border border-line bg-surface p-3')}>
          <div className="eyebrow mb-1">Reference solution</div>
          <pre className="whitespace-pre-wrap font-mono text-[12px] text-ink">{ex.solution.trim()}</pre>
          {!pass && (
            <div className="mt-2 text-[13px] text-muted">
              <Md text={ex.explanation} />
            </div>
          )}
        </div>
      )}

      {run.status === 'error' && <SqlErrorBox message={run.error} hint={run.hint} />}
      {run.status === 'ok' && <RunResult result={run.result} change={run.change} prevRows={run.prev} />}
    </div>
  );
}

export function PracticeTab({ concept }: { concept: Concept }) {
  const solved = useSql((s) => s.concepts[concept.id]?.solved ?? NO_MARKS);
  const [i, setI] = useState(() => Math.max(0, concept.exercises.findIndex((e) => !solved[e.id])));
  const ex = concept.exercises[i];
  if (!ex) return <p className="text-sm text-muted">No exercises yet.</p>;
  return (
    <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="space-y-1">
        {concept.exercises.map((e, j) => (
          <button key={e.id} onClick={() => setI(j)} className={cn('flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[13px] transition', j === i ? 'border-ink bg-surface' : 'border-transparent hover:bg-surface')}>
            {solved[e.id] ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" /> : <span className="h-4 w-4 shrink-0 rounded-full border border-line" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ink">{e.title}</span>
              <span className="text-[11px] text-faint">
                {kindLabel[e.kind]} · {e.difficulty}
              </span>
            </span>
          </button>
        ))}
      </div>
      <ExercisePanel concept={concept} ex={ex} />
    </div>
  );
}
