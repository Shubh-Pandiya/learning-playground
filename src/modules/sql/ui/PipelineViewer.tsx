import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Eye, EyeOff, HelpCircle, Layers, Loader2, Zap } from 'lucide-react';
import { Button, Callout, CodeBlock, StepControls, Tag, useStepper } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { Prediction, StageId } from '../types';
import { STAGE_LABEL, type Pipeline, type PipelineStage, type RowTag } from '../engine/pipeline';
import { GROUP_COLORS, Md, ResultTable, SqlErrorBox, Truth, type RowMark } from './common';
import { frameFor } from './frames';
import { usePipeline } from './hooks';

/* ------------------------------------------------------------------ helpers */

/** 1-based lines of `sql` that contain the clause text of a stage. */
function clauseLines(sql: string, clause: string): number[] {
  const lines = sql.split('\n');
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const out = new Set<number>();
  for (const piece of clause.split('\n').map(norm).filter((x) => x.length > 2)) {
    const probe = piece.slice(0, 40);
    lines.forEach((l, i) => {
      const nl = norm(l);
      if (nl.length > 2 && (nl.includes(probe) || (probe.includes(nl) && nl.length > 8))) out.add(i + 1);
    });
  }
  return [...out];
}

const TAG_LEGEND: { mark: RowTag; label: string; cls: string }[] = [
  { mark: 'dropped', label: 'filtered out', cls: 'bg-bad/15 line-through' },
  { mark: 'fanout', label: 'fan-out (duplicated by join)', cls: 'bg-warn/20' },
  { mark: 'nullext', label: 'NULL-extended (outer join)', cls: 'bg-info/20' },
  { mark: 'ghost', label: 'lost by the join', cls: 'bg-bad/15 line-through' },
  { mark: 'rightonly', label: 'right-only row', cls: 'bg-violet/20' },
];

const stageTone = (s: PipelineStage) => (s.error ? 'bad' : s.warn.length ? 'warn' : 'neutral');

/* ------------------------------------------------------------------ prediction */

function PredictBox({ p, stage, onAnswer }: { p: Prediction; stage: PipelineStage; onAnswer: (correct: boolean, given: string) => void }) {
  const [val, setVal] = useState('');
  return (
    <div className="rounded-lg border-2 border-dashed border-accent/50 bg-accent/[0.05] p-4">
      <div className="flex items-center gap-2 font-mono text-[13px] font-semibold text-accent">
        <HelpCircle className="h-4 w-4" /> Predict before you look
      </div>
      <p className="mt-1.5 text-sm text-ink">
        <Md text={p.question} />
      </p>
      {p.kind === 'rowcount' ? (
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (val.trim() === '') return;
            onAnswer(Number(val) === stage.outCount, val);
          }}
        >
          <input
            autoFocus
            type="number"
            min={0}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            className="w-28 rounded-md border border-line bg-surface px-2 py-1 font-mono text-sm outline-none focus:border-accent"
            placeholder="rows?"
            aria-label="Predicted row count"
          />
          <Button size="sm" type="submit" disabled={val.trim() === ''}>
            Commit
          </Button>
        </form>
      ) : (
        <div className="mt-3 grid gap-1.5">
          {p.options?.map((o, i) => (
            <button key={i} onClick={() => onAnswer(i === p.answer, o)} className="rounded-md border border-line bg-surface px-3 py-1.5 text-left text-sm hover:border-accent/60 hover:bg-accent/5">
              <Md text={o} />
            </button>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-faint">Committing to a guess first makes the real answer stick (the generation effect). Wrong guesses help most.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ stage view */

function StageTable({ stage }: { stage: PipelineStage }) {
  const [hover, setHover] = useState<number | null>(null);
  const [iterMax, setIterMax] = useState<number | null>(null);
  const frame = hover !== null && stage.window ? frameFor(stage, hover) : null;
  const iters = stage.iterations;
  const maxIter = iters?.length ? Math.max(...iters) : 0;
  const minIter = iters?.length ? Math.min(...iters) : 0;
  const visible = useMemo(() => {
    const idx = stage.rows.map((_, i) => i);
    if (!iters || iterMax === null) return idx;
    return idx.filter((i) => iters[i] <= iterMax);
  }, [stage.rows, iters, iterMax]);

  const marks: RowMark[] | undefined = stage.rowTags?.map((t) => (t === 'kept' ? undefined : t));
  const extra = [
    ...(stage.checks?.preds.map((p, k) => ({ title: p.length > 28 ? p.slice(0, 27) + '…' : p, render: (i: number) => <Truth v={stage.checks!.values[visible[i]]?.[k] ?? null} /> })) ?? []),
    ...(iters ? [{ title: 'iteration', render: (i: number) => <span className={cn('rounded px-1.5 text-paper', GROUP_COLORS[(iters[visible[i]] - minIter) % GROUP_COLORS.length])}>{iters[visible[i]]}</span> }] : []),
  ];

  return (
    <div className="space-y-3">
      {iters && (
        <div className="rounded-md border border-line bg-sunken/60 p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-mono font-semibold text-ink">Recursion, one iteration at a time</span>
            <span className="text-muted">anchor = iteration {minIter}; each pass joins only the rows produced by the previous pass (the “work table”)</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {Array.from({ length: maxIter - minIter + 1 }, (_, k) => k + minIter).map((it) => {
              const n = iters.filter((x) => x === it).length;
              const on = iterMax === null || it <= iterMax;
              return (
                <button key={it} onClick={() => setIterMax(iterMax === it ? null : it)} className={cn('rounded-md border px-2 py-1 font-mono text-[11px] transition', on ? 'border-transparent text-paper' : 'border-line text-faint', on && GROUP_COLORS[(it - minIter) % GROUP_COLORS.length])}>
                  iter {it}: +{n}
                </button>
              );
            })}
            <span className="ml-1 text-[11px] text-faint">→ iteration {maxIter + 1} produces 0 rows, so recursion stops</span>
          </div>
        </div>
      )}
      {stage.window && (
        <div className="min-h-[34px] rounded-md bg-info/[0.07] px-3 py-1.5 text-xs text-info">
          {frame ? (
            <>
              <Layers className="mr-1 inline h-3.5 w-3.5" />
              Row {hover! + 1}: {frame.label}
            </>
          ) : (
            <span className="text-muted">
              Hover a row to see which rows feed its <code className="font-mono">{stage.window.alias}</code> value (its window frame). Colours = partitions.
            </span>
          )}
        </div>
      )}
      <ResultTable
        columns={stage.columns}
        rows={visible.map((i) => stage.rows[i])}
        marks={marks && visible.map((i) => marks[i])}
        groupIds={stage.groupIds && visible.map((i) => stage.groupIds![i])}
        newCols={stage.newCols}
        extraCols={extra.length ? extra : undefined}
        onRowHover={stage.window ? (i) => setHover(i === null ? null : visible[i]) : undefined}
        rowClass={(i) => {
          if (!frame) return undefined;
          const r = visible[i];
          if (r === hover) return 'outline outline-2 -outline-offset-2 outline-accent bg-accent/10';
          if (frame.rows.has(r)) return 'bg-info/15';
          return 'opacity-50';
        }}
        maxHeight={420}
        dense={stage.rows.length > 14}
      />
      {stage.truncated && <p className="text-[11px] text-faint">Showing the first {stage.rows.length} rows.</p>}
      {stage.groups && (
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-xs text-muted">
            <ArrowRight className="h-3.5 w-3.5" /> collapses to <b className="text-ink">{stage.groups.rows.length}</b> group row{stage.groups.rows.length === 1 ? '' : 's'} (one per colour):
          </div>
          <ResultTable columns={stage.groups.columns} rows={stage.groups.rows} groupIds={stage.groups.rows.map((_, i) => i)} maxHeight={260} dense />
        </div>
      )}
    </div>
  );
}

function CountBar({ stage, max }: { stage: PipelineStage; max: number }) {
  const delta = stage.outCount - stage.inCount;
  const w = (n: number) => `${Math.max(2, (n / Math.max(1, max)) * 100)}%`;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 font-mono text-xs">
        <span className="w-10 text-right text-faint">in</span>
        <div className="h-2.5 flex-1 rounded-full bg-sunken">
          <motion.div className="h-full rounded-full bg-muted/50" initial={false} animate={{ width: w(stage.inCount) }} />
        </div>
        <span className="w-12 tabular-nums text-muted">{stage.inCount}</span>
      </div>
      <div className="flex items-center gap-2 font-mono text-xs">
        <span className="w-10 text-right text-faint">out</span>
        <div className="h-2.5 flex-1 rounded-full bg-sunken">
          <motion.div className={cn('h-full rounded-full', delta > 0 ? 'bg-warn' : delta < 0 ? 'bg-accent' : 'bg-ok')} initial={false} animate={{ width: w(stage.outCount) }} />
        </div>
        <span className="w-12 tabular-nums font-semibold text-ink">{stage.outCount}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ viewer */

export interface PipelineViewerProps {
  sql: string;
  notes?: Partial<Record<StageId, string>>;
  predictions?: Prediction[];
  predictMode?: boolean;
  recursiveLevel?: string;
  onPredict?: (correct: boolean) => void;
  onFinished?: () => void;
  /** Rendered when the query is a shape the visualizer can't stage. */
  fallback?: React.ReactNode;
  keyboard?: boolean;
}

export function PipelineViewer(props: PipelineViewerProps) {
  const state = usePipeline(props.sql, props.recursiveLevel);
  if (state.status === 'loading' || state.status === 'idle')
    return (
      <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Running each logical stage as a real query…
      </div>
    );
  if (state.status === 'error') return <SqlErrorBox message={state.error} hint={state.hint} />;
  if (!state.value)
    return (
      <>
        {props.fallback ?? (
          <Callout tone="info" title="This query shape can't be staged">
            The step-through supports one SELECT (optionally with CTEs). UNION / INTERSECT / EXCEPT, WINDOW clauses and DML at the top level run fine but aren't broken into stages.
          </Callout>
        )}
      </>
    );
  return <PipelineSteps pipe={state.value} {...props} />;
}

function PipelineSteps({ pipe, sql, notes, predictions, predictMode = true, onPredict, onFinished, keyboard = true }: PipelineViewerProps & { pipe: Pipeline }) {
  const stages = pipe.stages;
  const s = useStepper(stages.length, { intervalMs: 2600 });
  const stage = stages[s.step];
  const maxRows = Math.max(1, ...stages.map((x) => Math.max(x.inCount, x.outCount)));
  const [answers, setAnswers] = useState<Record<number, { correct: boolean; given: string }>>({});
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const finished = useRef(false);

  // prediction attaches to the first stage of its type
  const predAt = useMemo(() => {
    const m: Record<number, Prediction> = {};
    for (const p of predictions ?? []) {
      const i = stages.findIndex((st) => st.id === p.stage);
      if (i >= 0 && !m[i]) m[i] = p;
    }
    return m;
  }, [predictions, stages]);

  useEffect(() => {
    if (s.atEnd && !finished.current && stages.length > 1) {
      finished.current = true;
      onFinished?.();
    }
  }, [s.atEnd, stages.length, onFinished]);

  const pred = predAt[s.step];
  const gated = !!pred && predictMode && !answers[s.step] && !revealed[s.step];
  useEffect(() => {
    if (gated && s.playing) s.pause();
  }, [gated, s]);

  const lines = useMemo(() => clauseLines(sql, stage.clause), [sql, stage.clause]);
  const note = notes?.[stage.id] && stages.findIndex((x) => x.id === stage.id) === s.step ? notes[stage.id] : undefined;
  const legend = TAG_LEGEND.filter((t) => stage.rowTags?.includes(t.mark));

  return (
    <div className="space-y-4">
      {/* stage strip: the logical order of evaluation */}
      <div className="flex flex-wrap items-center gap-1">
        {stages.map((st, i) => (
          <button
            key={st.key}
            onClick={() => {
              s.pause();
              s.goTo(i);
            }}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] transition',
              i === s.step ? 'border-ink bg-ink text-paper' : i < s.step ? 'border-line bg-surface text-ink' : 'border-dashed border-line text-faint hover:text-ink',
              stageTone(st) === 'warn' && i !== s.step && 'border-warn/60',
              stageTone(st) === 'bad' && 'border-bad',
            )}
            title={st.title}
          >
            {predAt[i] && predictMode && !answers[i] && <HelpCircle className="h-3 w-3 text-accent" />}
            {st.id === 'cte' ? st.title.replace(/^CTE /, 'WITH ') : STAGE_LABEL[st.id]}
            <span className={cn('rounded px-1 tabular-nums', i === s.step ? 'bg-paper/20' : 'bg-sunken')}>{st.outCount}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div>
            <div className="eyebrow mb-1">Written order — highlighted: what runs now</div>
            <CodeBlock code={sql} language="sql" highlightLines={lines} className="max-h-[340px] text-[12px]" />
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={stage.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-3">
              <CountBar stage={stage} max={maxRows} />
              {!gated && (
                <>
                  <div>
                    <div className="eyebrow mb-1 flex items-center gap-1">
                      <ArrowRight className="h-3 w-3" /> What changed
                    </div>
                    <ul className="space-y-1.5 text-[13px] leading-relaxed text-muted">
                      {stage.narration.map((n, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                          <Md text={n} />
                        </li>
                      ))}
                    </ul>
                  </div>
                  {stage.impact.length > 0 && (
                    <div>
                      <div className="eyebrow mb-1 flex items-center gap-1">
                        <Zap className="h-3 w-3" /> Impact on the system
                      </div>
                      <ul className="space-y-1.5 text-[13px] leading-relaxed text-muted">
                        {stage.impact.map((n, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-info" />
                            <Md text={n} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {note && (
                    <Callout tone="tip" title="Why it matters here">
                      <Md text={note} />
                    </Callout>
                  )}
                  {stage.warn.map((w, i) => (
                    <Callout key={i} tone="warn">
                      <Md text={w} />
                    </Callout>
                  ))}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="eyebrow">
                Step {s.step + 1} of {stages.length} · {stage.id === 'cte' ? 'WITH' : STAGE_LABEL[stage.id]}
              </div>
              <h3 className="font-mono text-base font-semibold text-ink">{stage.title}</h3>
            </div>
            <div className="flex items-center gap-1.5">
              {answers[s.step] && <Tag tone={answers[s.step].correct ? 'ok' : 'bad'}>{answers[s.step].correct ? 'predicted ✓' : `you said ${answers[s.step].given}`}</Tag>}
              <Tag tone="neutral">
                {stage.inCount} → {stage.outCount} rows
              </Tag>
            </div>
          </div>

          {stage.error ? (
            <SqlErrorBox message={stage.error} />
          ) : gated ? (
            <div className="space-y-3">
              <PredictBox
                p={pred}
                stage={stage}
                onAnswer={(correct, given) => {
                  setAnswers((a) => ({ ...a, [s.step]: { correct, given } }));
                  onPredict?.(correct);
                }}
              />
              <div className="pointer-events-none select-none blur-[5px]" aria-hidden>
                <ResultTable columns={stage.columns} rows={stage.rows.slice(0, 8)} maxHeight={220} dense />
              </div>
              <button className="flex items-center gap-1 text-xs text-faint hover:text-ink" onClick={() => setRevealed((r) => ({ ...r, [s.step]: true }))}>
                <EyeOff className="h-3.5 w-3.5" /> skip prediction
              </button>
            </div>
          ) : (
            <motion.div key={stage.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="space-y-3">
              {pred && answers[s.step] && (
                <Callout tone={answers[s.step].correct ? 'ok' : 'bad'} title={answers[s.step].correct ? 'Your prediction was right' : pred.kind === 'rowcount' ? `Actual: ${stage.outCount} rows` : `Answer: ${pred.options?.[pred.answer ?? 0]}`}>
                  <Md text={pred.explain} />
                </Callout>
              )}
              {legend.length > 0 && (
                <div className="flex flex-wrap gap-3 text-[11px] text-muted">
                  {legend.map((l) => (
                    <span key={l.mark} className="flex items-center gap-1">
                      <span className={cn('inline-block h-2.5 w-4 rounded-sm', l.cls)} /> {l.label}
                    </span>
                  ))}
                </div>
              )}
              <StageTable stage={stage} />
              <details className="text-xs text-faint">
                <summary className="cursor-pointer hover:text-ink">
                  <Eye className="mr-1 inline h-3 w-3" />
                  the real query run for this stage
                </summary>
                <CodeBlock code={stage.sql} language="sql" showLineNumbers={false} className="mt-1 text-[11px]" />
              </details>
            </motion.div>
          )}
        </div>
      </div>

      <StepControls stepper={s} keyboard={keyboard} caption={<span className="font-mono text-xs">{stage.title}</span>} />
    </div>
  );
}
