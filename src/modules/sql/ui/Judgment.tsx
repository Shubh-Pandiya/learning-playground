import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Bug, CheckCircle2, Gauge, Loader2, MessagesSquare, XCircle } from 'lucide-react';
import { Button, Callout, Tag } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { Concept, JudgmentItem } from '../types';
import { runQuery, type QueryResult } from '../engine/db';
import { describeChange, rowKey, type ResultChange } from '../engine/compare';
import type { PlanSummary } from '../engine/plan';
import { useSql } from '../store';
import { Md, ResultTable, SqlErrorBox } from './common';
import { errMsg, explainSummary } from './hooks';
import { PlanCompare } from './PlanTree';

// Stable fallback: a fresh `{}` from a zustand selector would re-render forever.
const NO_MARKS: Record<string, never> = {};

export const judgmentKindMeta = {
  'spot-bug': { label: 'Spot the bug', icon: Bug, tone: 'bad' as const },
  'slow-query': { label: 'Fix the slow query', icon: Gauge, tone: 'warn' as const },
  'peer-review': { label: 'Review a peer’s query', icon: MessagesSquare, tone: 'info' as const },
};

type Impact =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ok'; before: QueryResult; after: QueryResult; change: ResultChange; plans?: { before: PlanSummary; after: PlanSummary } };

export function JudgmentCard({ concept, item, onDone }: { concept: Concept; item: JudgmentItem; onDone?: (correct: boolean) => void }) {
  const record = useSql((s) => s.recordJudgment);
  const [lines, setLines] = useState<number[]>([]);
  const [linesChecked, setLinesChecked] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [firstTry, setFirstTry] = useState<boolean | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const meta = judgmentKindMeta[item.kind];
  const sqlLines = item.sql.replace(/^\n+|\s+$/g, '').split('\n');

  useEffect(() => {
    setLines([]);
    setLinesChecked(false);
    setPicked(null);
    setFirstTry(null);
    setImpact(null);
  }, [item]);

  const lineHit = linesChecked && lines.some((l) => item.bugLines.includes(l));
  const correct = picked !== null && !!item.options[picked].correct;

  const choose = (i: number) => {
    setPicked(i);
    const ok = !!item.options[i].correct;
    if (firstTry === null) {
      setFirstTry(ok);
      record(concept.id, item.id, ok);
    }
    if (ok) {
      onDone?.(firstTry ?? ok);
      void showImpact();
    }
  };

  const showImpact = async () => {
    setImpact({ status: 'loading' });
    try {
      const [before, after] = await Promise.all([runQuery(item.sql, { setup: item.setup, maxRows: 200 }), runQuery(item.fixedSql, { setup: item.setup, maxRows: 200 })]);
      let plans: { before: PlanSummary; after: PlanSummary } | undefined;
      if (item.comparePlans) {
        const [b, a] = await Promise.all([explainSummary(item.sql, true, item.setup), explainSummary(item.fixedSql, true, item.setup)]);
        plans = { before: b, after: a };
      }
      setImpact({ status: 'ok', before, after, change: describeChange(before, after), plans });
    } catch (e) {
      setImpact({ status: 'error', error: errMsg(e) });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={meta.tone} icon={<meta.icon className="h-3 w-3" />}>
          {meta.label}
        </Tag>
        <h3 className="text-[15px] font-semibold text-ink">{item.title}</h3>
      </div>
      <div className="rounded-md border border-line bg-sunken/50 px-3 py-2 text-[13px] italic leading-relaxed text-muted">
        <Md text={item.context} />
      </div>

      <div>
        <div className="mb-1 text-[12px] text-muted">
          <b className="text-ink">Step 1.</b> Click the line(s) where the problem is.
        </div>
        <div className="overflow-hidden rounded-md border border-line bg-surface font-mono text-[12.5px]">
          {sqlLines.map((l, i) => {
            const n = i + 1;
            const sel = lines.includes(n);
            const isBug = item.bugLines.includes(n);
            return (
              <button
                key={i}
                disabled={linesChecked}
                onClick={() => setLines((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]))}
                className={cn(
                  'flex w-full text-left transition',
                  !linesChecked && 'hover:bg-accent/[0.06]',
                  sel && !linesChecked && 'bg-accent/15',
                  linesChecked && isBug && 'bg-bad/15',
                  linesChecked && sel && !isBug && 'bg-sunken line-through decoration-faint',
                )}
              >
                <span className="w-9 shrink-0 select-none border-r border-line/60 pr-2 text-right text-faint">{n}</span>
                <span className="whitespace-pre px-3 py-[1px] text-ink">{l || ' '}</span>
              </button>
            );
          })}
        </div>
        {!linesChecked ? (
          <Button size="sm" className="mt-2" disabled={!lines.length} onClick={() => setLinesChecked(true)}>
            Lock in {lines.length ? `line${lines.length > 1 ? 's' : ''} ${lines.join(', ')}` : 'lines'}
          </Button>
        ) : (
          <div className={cn('mt-2 text-[12.5px]', lineHit ? 'text-ok' : 'text-bad')}>
            {lineHit ? '✓ You found it.' : '✗ Not quite.'} The problem is on line{item.bugLines.length > 1 ? 's' : ''} {item.bugLines.join(', ')} (highlighted).
          </div>
        )}
      </div>

      {linesChecked && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-1.5">
          <div className="text-[12px] text-muted">
            <b className="text-ink">Step 2.</b> What’s the diagnosis?
          </div>
          {item.options.map((o, i) => {
            const show = picked !== null && (i === picked || (correct && o.correct));
            return (
              <div key={i}>
                <button
                  onClick={() => !correct && choose(i)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-[13px] transition',
                    show && o.correct ? 'border-ok bg-ok/[0.07]' : show ? 'border-bad bg-bad/[0.06]' : 'border-line hover:bg-surface',
                  )}
                >
                  {show ? o.correct ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" /> : <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-line" />}
                  <span className="text-ink">
                    <Md text={o.text} />
                  </span>
                </button>
                {show && (
                  <div className={cn('ml-6 mt-1 text-[12.5px]', o.correct ? 'text-ok' : 'text-bad')}>
                    <Md text={o.why} />
                  </div>
                )}
              </div>
            );
          })}
        </motion.div>
      )}

      {correct && (
        <div className="space-y-3">
          <div className="text-[12px] text-muted">
            <b className="text-ink">Step 3.</b> The fix, and its measured impact on real data:
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <div className="eyebrow mb-1 text-bad">before</div>
              <pre className="whitespace-pre-wrap rounded-md border border-bad/30 bg-bad/[0.04] p-2 font-mono text-[11.5px] text-ink">{item.sql.trim()}</pre>
            </div>
            <div>
              <div className="eyebrow mb-1 text-ok">after</div>
              <pre className="whitespace-pre-wrap rounded-md border border-ok/30 bg-ok/[0.04] p-2 font-mono text-[11.5px] text-ink">{item.fixedSql.trim()}</pre>
            </div>
          </div>
          {impact?.status === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> running both queries…
            </div>
          )}
          {impact?.status === 'error' && <SqlErrorBox message={impact.error} />}
          {impact?.status === 'ok' && (
            <div className="space-y-3">
              <div className="rounded-md border border-info/40 bg-info/[0.06] px-3 py-1.5 text-[12.5px] text-ink">
                <b>Result impact:</b> {impact.change.summary}
                {impact.plans && (
                  <>
                    {' '}
                    · <b>time</b> {impact.plans.before.executionMs?.toFixed(1)} ms → {impact.plans.after.executionMs?.toFixed(1)} ms
                  </>
                )}
              </div>
              {impact.plans ? (
                <PlanCompare a={impact.plans.before} b={impact.plans.after} labelA="before" labelB="after" />
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  <ResultTable
                    columns={impact.before.columns}
                    rows={impact.before.rows}
                    dense
                    maxHeight={240}
                    marks={impact.change.comparable ? (() => { const gone = new Set(impact.change.removed.map(rowKey)); return impact.before.rows.map((r) => (gone.has(rowKey(r)) ? 'removed' : undefined)); })() : undefined}
                    caption={`before · ${impact.before.rowCount} rows`}
                  />
                  <ResultTable
                    columns={impact.after.columns}
                    rows={impact.after.rows}
                    dense
                    maxHeight={240}
                    marks={impact.change.comparable ? (() => { const add = new Set(impact.change.added.map(rowKey)); return impact.after.rows.map((r) => (add.has(rowKey(r)) ? 'added' : undefined)); })() : undefined}
                    caption={`after · ${impact.after.rowCount} rows`}
                  />
                </div>
              )}
            </div>
          )}
          <Callout tone="tip" title="Lesson">
            <Md text={item.lesson} />
          </Callout>
        </div>
      )}
    </div>
  );
}

export function JudgmentList({ concept }: { concept: Concept }) {
  const judged = useSql((s) => s.concepts[concept.id]?.judged ?? NO_MARKS);
  const items = concept.judgment ?? [];
  const [i, setI] = useState(0);
  if (!items.length) return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {items.map((it, j) => (
          <button key={it.id} onClick={() => setI(j)} className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px]', j === i ? 'border-ink bg-ink text-paper' : 'border-line text-muted hover:bg-surface')}>
            {judged[it.id] !== undefined && (judged[it.id] ? <CheckCircle2 className="h-3 w-3 text-ok" /> : <XCircle className="h-3 w-3 text-bad" />)}
            {judgmentKindMeta[it.kind].label}: {it.title}
          </button>
        ))}
      </div>
      <JudgmentCard concept={concept} item={items[Math.min(i, items.length - 1)]} />
    </div>
  );
}
