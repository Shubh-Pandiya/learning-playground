import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, CheckCircle2, Circle, Clock, Cpu, Layers3, Lock, Play, RotateCcw, Shuffle, Undo2 } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, CodeBlock, StepControls, Tag, useStepper, type Tone } from '@/shared/ui';
import { useDm } from '../../store';
import type { LabTopic, StepTag } from '../../types';
import { ChangeCard, type Change, type ChangeLine } from '../../ui/ChangeCard';
import { PredictCard } from '../../ui/Predict';
import { Rich } from '../../ui/Rich';
import { STEPS, TIME_NOTES, UNDER_HOOD } from './data';
import {
  BUCKETS,
  CLUSTERS,
  EX,
  PARTITIONS,
  QUERIES,
  T,
  ddl,
  describeChange,
  diffLayouts,
  fmtCount,
  fmtPct,
  fmtSize,
  fmtTime,
  fmtUSD,
  getQuery,
  isBucketed,
  layoutFlags,
  layoutStats,
  runAll,
  runQuery,
  type Layout,
  type QueryId,
} from './engine';
import { FileGrid, GridLegend } from './FileGrid';
import { LateData } from './LateData';
import { Medallion } from './Medallion';

type TabId = 'walk' | 'time' | 'medallion';

const TAG_TONE: Record<StepTag, Tone> = { problem: 'bad', technique: 'accent', tradeoff: 'warn', failure: 'bad', case: 'info', recap: 'ok' };

const EXERCISE_CHECK: Record<string, ((l: Layout) => boolean) | undefined> = {
  'prune-dates': EX.pruneDates,
  'small-files': EX.smallFiles,
  'user-lookup': EX.userLookup,
};

const HINTS: Record<string, string> = {
  'prune-dates': 'The DAU query filters on event_date. What layout lets the planner prove most files are out of range?',
  'small-files': 'Partitioning by date × country gives ~25 MB files. Keep the partition coarse and organise rows inside it instead.',
  'user-lookup': 'Partitions are not the only metadata: per-file min/max of user_id only helps if each file holds a narrow user_id range.',
  medallion: 'Open the Medallion tab and classify all 8 steps, then press Check.',
};

const sameLayout = (a: Layout, b: Layout) => a.part === b.part && a.cluster === b.cluster && a.bucket === b.bucket;

function summaryLines(l: Layout, q: QueryId): ChangeLine[] {
  const r = runQuery(l, getQuery(q));
  const s = layoutStats(l);
  return [
    {
      tone: r.scanFrac < 0.05 ? 'ok' : r.scanFrac > 0.5 ? 'bad' : 'warn',
      text: `**${getQuery(q).name}** opens ${fmtCount(r.filesOpened)} of ${fmtCount(r.filesTotal)} files, scans ${fmtSize(r.scannedGB)} (${fmtPct(r.scanFrac)}) · ${fmtTime(r.totalS)} · ${fmtUSD(r.costUSD)}`,
    },
    {
      tone: s.avgFileMB < T.smallMB || s.partitions > T.maxPartitions ? 'bad' : 'info',
      text: `${fmtCount(s.partitions)} partitions · ${fmtCount(s.files)} files · avg file ${fmtSize(s.avgFileMB / 1024)}`,
    },
  ];
}

export default function LayoutLab({ topic }: { topic: LabTopic }) {
  const exercises = useDm((s) => s.topics[topic.id]?.exercises);
  const recordPrediction = useDm((s) => s.recordPrediction);
  const markExercise = useDm((s) => s.markExercise);

  const [tab, setTab] = useState<TabId>('walk');
  const stepper = useStepper(STEPS.length, { intervalMs: 9000 });
  const step = stepper.step;
  const st = STEPS[step];

  const [layout, setLayout] = useState<Layout>(STEPS[0].layout);
  const [query, setQuery] = useState<QueryId>(STEPS[0].query);
  const [free, setFree] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [change, setChange] = useState<Change>({ key: 'init', title: `Step 1 · ${STEPS[0].title}`, lines: summaryLines(STEPS[0].layout, STEPS[0].query) });
  const [stage, setStage] = useState(0);
  const [runId, setRunId] = useState(0);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const gated = tab === 'walk' && !free && !!st.predict && answers[step] === undefined;

  // Apply the step's layout + query whenever the step changes.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const s = STEPS[step];
    const prev = layoutRef.current;
    setFree(false);
    setLayout(s.layout);
    setQuery(s.query);
    setChange({
      key: `step-${step}-${Date.now()}`,
      title: `Step ${step + 1} · ${s.title}${sameLayout(prev, s.layout) ? '' : `: ${describeChange(prev, s.layout)}`}`,
      lines: sameLayout(prev, s.layout) ? summaryLines(s.layout, s.query) : [...diffLayouts(prev, s.layout).slice(0, 4), summaryLines(s.layout, s.query)[0]],
    });
    if (s.predict && answers[step] === undefined) stepper.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Scan animation: prune partitions → skip files → read.
  useEffect(() => {
    setStage(0);
    if (gated) return;
    const ts = [setTimeout(() => setStage(1), 350), setTimeout(() => setStage(2), 1200), setTimeout(() => setStage(3), 2000)];
    return () => ts.forEach(clearTimeout);
  }, [layout.part, layout.cluster, layout.bucket, query, gated, runId]);

  const results = useMemo(() => runAll(layout), [layout]);
  const stats = useMemo(() => layoutStats(layout), [layout]);
  const flags = useMemo(() => layoutFlags(layout, stats), [layout, stats]);
  const r = results[query];
  const q = getQuery(query);

  const applyLayout = (next: Layout) => {
    if (sameLayout(next, layout)) return;
    const prev = layout;
    setLayout(next);
    setFree(true);
    const lines = diffLayouts(prev, next);
    for (const ex of topic.exercises) {
      const check = EXERCISE_CHECK[ex.id];
      if (check && check(next) && !exercises?.[ex.id]) {
        markExercise(topic.id, ex.id);
        lines.unshift({ tone: 'ok', text: `**Exercise solved:** ${ex.title}` });
      }
    }
    setChange({ key: `ch-${Date.now()}`, title: describeChange(prev, next), lines });
  };

  const pickQuery = (id: QueryId) => {
    if (id === query) return;
    setQuery(id);
    const nq = getQuery(id);
    const nr = results[id];
    const lines: ChangeLine[] = [{ tone: 'info', text: `${nq.who}.` }, ...summaryLines(layout, id).slice(0, 1)];
    if (nq.join) lines.push(nr.shuffleGB > 0 ? { tone: 'warn', text: `Both sides are shuffled by user_id: ${fmtSize(nr.shuffleGB)} over the network (${fmtTime(nr.shuffleS)}).` } : { tone: 'ok', text: 'Both tables are bucketed by user_id into 16: bucket i joins bucket i, no shuffle.' });
    setChange({ key: `q-${Date.now()}`, title: `Query → **${nq.name}**`, lines });
  };

  const answer = (i: number, right: boolean) => {
    setAnswers((a) => ({ ...a, [step]: i }));
    recordPrediction(topic.id, `step-${step}`, right);
  };

  const done = topic.exercises.filter((e) => exercises?.[e.id]).length;

  return (
    <div className="flex h-full min-h-0">
      {/* ───────── left: walkthrough / notes ───────── */}
      <aside className="flex w-[400px] shrink-0 flex-col border-r border-line bg-paper">
        <div className="flex border-b border-line">
          {(
            [
              ['walk', 'Walkthrough', BookOpen],
              ['time', 'Time-series', Clock],
              ['medallion', 'Medallion', Layers3],
            ] as const
          ).map(([id, label, I]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn('flex flex-1 items-center justify-center gap-1.5 py-2 font-mono text-[11px] uppercase tracking-wider', tab === id ? 'border-b-2 border-accent text-ink' : 'text-faint hover:text-muted')}
            >
              <I size={13} /> {label}
            </button>
          ))}
        </div>

        {tab === 'walk' && (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <div className="flex items-center gap-2">
                <Tag tone={TAG_TONE[st.tag]}>{st.tag}</Tag>
                <span className="font-mono text-[11px] text-faint">
                  step {step + 1} / {STEPS.length}
                </span>
              </div>
              <h2 className="font-mono text-lg font-semibold leading-snug">{st.title}</h2>
              <div className="space-y-2.5 text-[13.5px] leading-relaxed text-muted">
                {st.body.map((b, i) => (
                  <p key={i}>
                    <Rich text={b} />
                  </p>
                ))}
              </div>
              {st.predict && (
                <PredictCard key={step} predict={st.predict} answered={answers[step]} onAnswer={answer} />
              )}
              {!gated && st.keyIdea && (
                <Callout tone="tip" title="Key idea">
                  <span className="text-[12.5px]">
                    <Rich text={st.keyIdea} />
                  </span>
                </Callout>
              )}
              {!gated && st.underHood && (
                <div className="rounded-xl border border-line bg-surface p-3">
                  <div className="eyebrow mb-1 flex items-center gap-1">
                    <Cpu size={11} /> Under the hood
                  </div>
                  <p className="text-[12.5px] leading-relaxed text-muted">
                    <Rich text={st.underHood} />
                  </p>
                </div>
              )}
              {free && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-info/40 bg-info/[0.06] px-2.5 py-2 text-[12px] text-muted">
                  <span>Exploring freely: the grid shows your layout, not the step’s.</span>
                  <Button
                    size="xs"
                    variant="ghost"
                    icon={<Undo2 size={12} />}
                    onClick={() => {
                      const prev = layout;
                      setFree(false);
                      setLayout(st.layout);
                      setQuery(st.query);
                      setChange({ key: `back-${Date.now()}`, title: `Back to step ${step + 1}: ${describeChange(prev, st.layout)}`, lines: sameLayout(prev, st.layout) ? summaryLines(st.layout, st.query) : diffLayouts(prev, st.layout) });
                    }}
                  >
                    step layout
                  </Button>
                </div>
              )}
            </div>
            <div className="border-t border-line p-3">
              <StepControls stepper={stepper} speeds={[0.5, 1, 2]} caption={gated ? 'answer the prediction to run the scan' : `${q.name}: ${fmtSize(r.scannedGB)} scanned`} />
            </div>
          </>
        )}

        {tab === 'time' && (
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            <p className="text-[13.5px] leading-relaxed text-muted">
              Clickstream is a time series. The partition key is a promise about <em>when</em> data is complete, so modelling time correctly matters as much as the folder layout.
            </p>
            {TIME_NOTES.map((n) => (
              <div key={n.title} className="rounded-xl border border-line bg-surface p-3">
                <div className="font-mono text-[12.5px] font-semibold text-ink">{n.title}</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                  <Rich text={n.body} />
                </p>
                {n.code && <CodeBlock className="mt-2" language="sql" code={n.code} />}
              </div>
            ))}
            <Callout tone="bad" title="Red flag: partitioning by ingest time only">
              <span className="text-[12.5px]">
                Every event-time query must scan extra days and late events are counted on the wrong day. Fix: partition by <code>days(event_ts)</code>, keep <code>ingest_ts</code> as a column to drive incremental jobs.
              </span>
            </Callout>
          </div>
        )}

        {tab === 'medallion' && (
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            <h2 className="font-mono text-lg font-semibold leading-snug">Medallion: bronze → silver → gold</h2>
            <div className="space-y-2.5 text-[13.5px] leading-relaxed text-muted">
              <p>
                <Rich text="Layers are **contracts**, not folders. Each layer promises something to the next, and that promise decides what you can rebuild after a bug." />
              </p>
              <p>
                <Rich text="**Bronze** keeps the source exactly as received, append-only, so any later layer can be replayed. **Silver** is typed, deduplicated and conformed: the single cleaned truth per entity, often with SCD history. **Gold** is shaped for a consumer: aggregates, star schemas, ML features." />
              </p>
              <p>Run the two incidents in the centre, predict first, then classify the transformations to finish the exercise.</p>
            </div>
            <Callout tone="bad" title="Red flag: dashboards reading bronze">
              <span className="text-[12.5px]">Untyped, duplicated rows leak into metrics and every team re-implements cleaning. Fix: consumers read gold (or silver for exploration), never bronze.</span>
            </Callout>
            <Callout tone="bad" title="Red flag: bronze with retention of 7 days">
              <span className="text-[12.5px]">You can no longer replay silver after a bug older than a week. Fix: keep bronze long (cheap object storage, compressed) or make sources replayable.</span>
            </Callout>
          </div>
        )}
      </aside>

      {/* ───────── centre ───────── */}
      <main className="min-w-0 flex-1 overflow-y-auto bg-sunken/60 p-4">
        {tab === 'walk' && (
          <div className="space-y-3">
            <Controls layout={layout} disabled={gated} onChange={applyLayout} />
            <div className="flex flex-wrap gap-1.5">
              {QUERIES.map((qq) => (
                <button
                  key={qq.id}
                  disabled={gated}
                  onClick={() => pickQuery(qq.id)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    query === qq.id ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:border-accent/50',
                  )}
                >
                  <div className="font-mono text-[11.5px] font-semibold text-ink">{qq.name}</div>
                  <div className="text-[10.5px] text-faint">{qq.who}</div>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-3">
              <CodeBlock language="sql" code={q.sql} />
              <Planner gated={gated} stage={stage} r={r} onReplay={() => setRunId((x) => x + 1)} />
            </div>
            {q.join && !gated && <JoinViz bucketed={isBucketed(layout)} shuffleGB={r.shuffleGB} />}
            <div className="relative rounded-xl border border-line bg-paper p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="eyebrow">
                  lake.events · {fmtCount(stats.partitions)} partition{stats.partitions > 1 ? 's' : ''} · {fmtCount(stats.files)} files · {fmtSize(stats.files * stats.avgFileMB / 1024)}
                </div>
                <GridLegend />
              </div>
              <div className={cn('transition', gated && 'pointer-events-none blur-[1.5px]')}>
                <FileGrid layout={layout} query={query} stage={gated ? 0 : stage} />
              </div>
              {gated && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex items-center gap-1.5 rounded-lg border border-accent/50 bg-paper px-3 py-2 font-mono text-[12px] text-accent shadow-paper">
                    <Lock size={13} /> Predict first (left panel), then the scan runs
                  </div>
                </div>
              )}
            </div>
            <details className="rounded-xl border border-line bg-surface p-3">
              <summary className="cursor-pointer font-mono text-[12px] font-semibold text-ink">Under the hood · table DDL & how planning works</summary>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <CodeBlock language="sql" code={ddl(layout)} />
                <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-muted">
                  {UNDER_HOOD.map((u) => (
                    <li key={u} className="flex gap-1.5">
                      <span className="text-faint">·</span>
                      <span>
                        <Rich text={u} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          </div>
        )}
        {tab === 'time' && (
          <div className="space-y-3">
            <div>
              <div className="eyebrow">Late data · one week of events, today is the rightmost column</div>
              <p className="text-[12.5px] text-muted">Each dot is an event. Switch the partition key and the watermark to see where stragglers land and what that costs.</p>
            </div>
            <LateData onChange={setChange} />
          </div>
        )}
        {tab === 'medallion' && (
          <Medallion
            onChange={setChange}
            onPredict={(k, right) => recordPrediction(topic.id, k, right)}
            solved={!!exercises?.medallion}
            onSolved={() => markExercise(topic.id, 'medallion')}
          />
        )}
      </main>

      {/* ───────── right: impact ───────── */}
      <aside className="w-[330px] shrink-0 space-y-3 overflow-y-auto border-l border-line bg-paper p-3.5">
        <div>
          <div className="eyebrow mb-1">What changed</div>
          {gated ? (
            <div className="rounded-xl border border-dashed border-line p-2.5 text-[12px] text-faint">Answer the prediction to see the impact.</div>
          ) : (
            <motion.div key={change.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <ChangeCard change={change} />
            </motion.div>
          )}
        </div>

        {tab === 'walk' && (
          <>
            <div>
              <div className="eyebrow mb-1">Table health</div>
              <div className="grid grid-cols-3 gap-1.5">
                <Metric k="partitions" v={gated ? '?' : fmtCount(stats.partitions)} tone={stats.partitions > T.maxPartitions ? 'bad' : undefined} />
                <Metric k="files" v={gated ? '?' : fmtCount(stats.files)} tone={stats.files > 200_000 ? 'warn' : undefined} />
                <Metric k="avg file" v={gated ? '?' : fmtSize(stats.avgFileMB / 1024)} tone={stats.avgFileMB < 8 ? 'bad' : stats.avgFileMB < T.smallMB ? 'warn' : 'ok'} />
                <Metric k="small files" v={gated ? '?' : fmtPct(stats.smallFilePct)} tone={stats.smallFilePct > 0.5 ? 'bad' : stats.smallFilePct > 0.1 ? 'warn' : undefined} />
                <Metric k="largest part." v={gated ? '?' : fmtSize(stats.largestGB)} />
                <Metric k="skew" v={gated ? '?' : `${stats.skew < 10 ? stats.skew.toFixed(1) : Math.round(stats.skew)}×`} tone={stats.skew > 50 ? 'warn' : undefined} />
              </div>
            </div>
            <div>
              <div className="eyebrow mb-1">All four queries on this layout</div>
              <div className="overflow-hidden rounded-xl border border-line">
                <table className="w-full font-mono text-[11px]">
                  <thead className="bg-surface text-faint">
                    <tr>
                      <th className="px-2 py-1 text-left font-normal">query</th>
                      <th className="px-1 py-1 text-right font-normal">scan</th>
                      <th className="px-1 py-1 text-right font-normal">time</th>
                      <th className="px-2 py-1 text-right font-normal">cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {QUERIES.map((qq) => {
                      const x = results[qq.id];
                      return (
                        <tr
                          key={qq.id}
                          onClick={() => !gated && pickQuery(qq.id)}
                          className={cn('cursor-pointer border-t border-line', query === qq.id ? 'bg-accent/[0.08]' : 'hover:bg-surface')}
                        >
                          <td className="px-2 py-1 text-ink">{qq.name}</td>
                          <td className={cn('px-1 py-1 text-right', x.scanFrac < 0.05 ? 'text-ok' : x.scanFrac > 0.5 ? 'text-bad' : 'text-ink')}>{gated ? '?' : fmtSize(x.scannedGB)}</td>
                          <td className={cn('px-1 py-1 text-right', x.totalS < 10 ? 'text-ok' : x.totalS > 60 ? 'text-bad' : 'text-ink')}>{gated ? '?' : fmtTime(x.totalS)}</td>
                          <td className="px-2 py-1 text-right text-muted">{gated ? '?' : fmtUSD(x.costUSD)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[10.5px] text-faint">Cost at $5 / TB scanned. Time includes planning (file opens) and shuffle.</p>
            </div>
            {!gated &&
              flags.map((f) => (
                <Callout key={f.title} tone={f.tone} title={f.title}>
                  <span className="text-[12px]">
                    <Rich text={f.body} /> <strong className="text-ink">Fix:</strong> <Rich text={f.fix} />
                  </span>
                </Callout>
              ))}
          </>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <div className="eyebrow">Exercises</div>
            <span className="font-mono text-[11px] text-faint">
              {done}/{topic.exercises.length}
            </span>
          </div>
          <ul className="space-y-1.5">
            {topic.exercises.map((e) => {
              const ok = !!exercises?.[e.id];
              return (
                <li key={e.id} className={cn('rounded-lg border p-2', ok ? 'border-ok/40 bg-ok/[0.06]' : 'border-line bg-surface')}>
                  <div className="flex items-start gap-1.5 text-[12.5px] text-ink">
                    {ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" /> : <Circle size={14} className="mt-0.5 shrink-0 text-faint" />}
                    <span>{e.title}</span>
                  </div>
                  {!ok && <p className="mt-0.5 pl-5 text-[11px] text-faint">{HINTS[e.id]}</p>}
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 text-[10.5px] text-faint">Layout exercises are checked whenever you change a control yourself.</p>
        </div>
      </aside>
    </div>
  );
}

/* ───────────────────────── pieces ───────────────────────── */

function Metric({ k, v, tone }: { k: string; v: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-2.5 py-2">
      <div className="eyebrow !text-[9.5px]">{k}</div>
      <div className={cn('font-mono text-[15px] font-semibold', tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-ink')}>{v}</div>
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onPick, disabled }: { label: string; value: T; options: { id: T; label: string }[]; onPick: (v: T) => void; disabled?: boolean }) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.id}
            disabled={disabled}
            onClick={() => onPick(o.id)}
            className={cn(
              'rounded-md border px-2 py-1 font-mono text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              value === o.id ? 'border-accent bg-accent/10 text-ink' : 'border-line bg-surface text-muted hover:border-accent/50',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Controls({ layout, disabled, onChange }: { layout: Layout; disabled: boolean; onChange: (l: Layout) => void }) {
  return (
    <div className="grid gap-2.5 rounded-xl border border-line bg-paper p-3">
      <Segmented label="Partition by" value={layout.part} options={PARTITIONS} disabled={disabled} onPick={(part) => onChange({ ...layout, part })} />
      <div className="flex flex-wrap gap-6">
        <Segmented label="Cluster / sort / Z-order inside partitions" value={layout.cluster} options={CLUSTERS} disabled={disabled} onPick={(cluster) => onChange({ ...layout, cluster })} />
        <Segmented label="Bucketing" value={layout.bucket} options={BUCKETS} disabled={disabled} onPick={(bucket) => onChange({ ...layout, bucket })} />
      </div>
    </div>
  );
}

const STAGES = ['partition pruning', 'file skipping (min/max · buckets)', 'read'];

function Planner({ gated, stage, r, onReplay }: { gated: boolean; stage: number; r: ReturnType<typeof runQuery>; onReplay: () => void }) {
  const rows: [string, string, number][] = [
    ['partitions kept', `${fmtCount(r.partitionsMatched)} / ${fmtCount(r.partitions)}`, 1],
    ['files opened', `${fmtCount(r.filesOpened)} / ${fmtCount(r.filesTotal)}`, 2],
    ['data scanned', `${fmtSize(r.scannedGB)} (${fmtPct(r.scanFrac)})`, 3],
    ['time', `${fmtTime(r.totalS)} = plan ${fmtTime(r.planS)} + scan ${fmtTime(r.scanS)}${r.shuffleS ? ` + shuffle ${fmtTime(r.shuffleS)}` : ''}`, 3],
    ['cost', fmtUSD(r.costUSD), 3],
  ];
  return (
    <div className="rounded-xl border border-line bg-surface p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="eyebrow">Planner</div>
        <Button size="xs" variant="ghost" icon={<RotateCcw size={12} />} disabled={gated} onClick={onReplay}>
          replay
        </Button>
      </div>
      <div className="mb-2 flex gap-1">
        {STAGES.map((s, i) => (
          <span
            key={s}
            className={cn(
              'flex-1 rounded px-1 py-0.5 text-center font-mono text-[9px] leading-tight transition-colors',
              !gated && stage > i ? 'bg-accent/15 text-accent' : 'bg-ink/[0.05] text-faint',
            )}
          >
            {i + 1}. {s}
          </span>
        ))}
      </div>
      <dl className="space-y-0.5 font-mono text-[11px]">
        {rows.map(([k, v, at]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="shrink-0 text-faint">{k}</dt>
            <dd className={cn('text-right', !gated && stage >= at ? 'text-ink' : 'text-faint')}>{gated || stage < at ? '…' : v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function JoinViz({ bucketed, shuffleGB }: { bucketed: boolean; shuffleGB: number }) {
  const n = 8;
  const W = 520;
  const H = 120;
  const x0 = 70;
  const x1 = W - 70;
  const y = (i: number) => 12 + i * ((H - 24) / (n - 1));
  const lines: [number, number][] = bucketed ? Array.from({ length: n }, (_, i) => [i, i]) : Array.from({ length: n * n }, (_, k) => [Math.floor(k / n), k % n]);
  return (
    <div className="rounded-xl border border-line bg-paper p-3">
      <div className="mb-1 flex items-center gap-1.5">
        <Shuffle size={13} className={bucketed ? 'text-ok' : 'text-warn'} />
        <span className="font-mono text-[12px] font-semibold text-ink">{bucketed ? 'Bucket join: bucket i ⋈ bucket i, no exchange' : `Shuffle join: ${fmtSize(shuffleGB)} re-partitioned by user_id over the network`}</span>
      </div>
      <div className="flex items-center gap-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[120px] w-[520px] shrink-0">
          {lines.map(([a, b], k) => (
            <motion.line
              key={`${bucketed}-${k}`}
              x1={x0}
              y1={y(a)}
              x2={x1}
              y2={y(b)}
              className={bucketed ? 'stroke-ok' : 'stroke-warn'}
              strokeOpacity={bucketed ? 0.8 : 0.35}
              strokeWidth={bucketed ? 2 : 1}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.6, delay: (k % n) * 0.04 }}
            />
          ))}
          {Array.from({ length: n }, (_, i) => (
            <g key={i}>
              <rect x={x0 - 52} y={y(i) - 5} width={52} height={10} rx={2} className="fill-accent/20 stroke-accent/60" />
              <text x={x0 - 26} y={y(i) + 3} textAnchor="middle" className="fill-ink font-mono text-[7px]">
                events b{i}
              </text>
              <rect x={x1} y={y(i) - 5} width={52} height={10} rx={2} className="fill-violet/20 stroke-violet/60" />
              <text x={x1 + 26} y={y(i) + 3} textAnchor="middle" className="fill-ink font-mono text-[7px]">
                users b{i}
              </text>
            </g>
          ))}
        </svg>
        <p className="text-[12px] leading-relaxed text-muted">
          {bucketed ? (
            <Rich text="Both tables are written with `bucket(16, user_id)`, so every user_id lives in the same bucket number on both sides. The engine pairs bucket files directly (Spark storage-partitioned join, Hive bucket map join): no exchange, no spill." />
          ) : (
            <Rich text="Without matching buckets, every executor must send each row to the executor that owns `hash(user_id)`: an all-to-all exchange of both sides, then a sort-merge join. Fix: bucket both tables by user_id with the same bucket count." />
          )}
        </p>
      </div>
      <p className="mt-1 flex items-center gap-1 text-[10.5px] text-faint">
        <Play size={10} /> 8 of 16 buckets drawn. Bucketing only helps when both sides use the same column and count, and it caps write parallelism per partition at the bucket count.
      </p>
    </div>
  );
}
