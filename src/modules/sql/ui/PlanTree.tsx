import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowDown, BookOpen, FlaskConical, Loader2, Play, TriangleAlert } from 'lucide-react';
import { Button, Callout, CodeBlock, SidePanel, Tag } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { PlanVariant } from '../types';
import { diffPlans, fmt, glossaryFor, type PlanNode, type PlanSummary } from '../engine/plan';
import { Md, SqlEditor, SqlErrorBox } from './common';
import { errMsg, explainSummary } from './hooks';

const nodeTone = (t: string) =>
  /Seq Scan/.test(t) ? 'border-warn/60' : /Index Only/.test(t) ? 'border-ok/70' : /Index|Bitmap/.test(t) ? 'border-ok/50' : /Join|Nested Loop/.test(t) ? 'border-info/60' : /Sort|Hash$|Aggregate|Materialize/.test(t) ? 'border-violet/50' : 'border-line';

function NodeCard({ n, total, onOpen, depth }: { n: PlanNode; total: number; onOpen: (n: PlanNode) => void; depth: number }) {
  const share = total > 0 ? n.totalCost / total : 0;
  const mis = n.actualRows !== undefined && n.planRows > 0 && Math.max(n.actualRows / Math.max(1, n.planRows), n.planRows / Math.max(1, n.actualRows)) >= 10 && Math.max(n.actualRows, n.planRows) > 10;
  return (
    <div className={cn(depth > 0 && 'ml-5 border-l border-line pl-3')}>
      <button onClick={() => onOpen(n)} className={cn('group mt-1.5 w-full rounded-md border-l-4 border bg-surface px-3 py-2 text-left shadow-sm transition hover:shadow-lift', nodeTone(n.type))}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <div className="font-mono text-[13px]">
            <span className="font-semibold text-ink">{n.type}</span> <span className="text-muted">{n.detail}</span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-muted">
            <span title="estimated rows">est {fmt(n.planRows)} rows</span>
            {n.actualRows !== undefined && (
              <span className={cn(mis ? 'font-semibold text-bad' : 'text-ink')} title="actual rows (per loop)">
                act {fmt(n.actualRows)}
                {n.loops && n.loops > 1 ? ` ×${n.loops} loops` : ''}
              </span>
            )}
            {n.actualMs !== undefined && <span title="actual time incl. children">{n.actualMs.toFixed(2)} ms</span>}
          </div>
        </div>
        {n.props.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {n.props.map((p, i) => (
              <div key={i} className="truncate font-mono text-[11px] text-faint">
                <span className="text-muted">{p.k}:</span> {p.v}
              </div>
            ))}
          </div>
        )}
        {n.removedByFilter ? <div className="mt-0.5 font-mono text-[11px] text-warn">Rows removed by filter: {fmt(n.removedByFilter)}</div> : null}
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-sunken">
            <motion.div className="h-full rounded-full bg-accent/70" initial={{ width: 0 }} animate={{ width: `${Math.max(1, share * 100)}%` }} />
          </div>
          <span className="w-24 text-right font-mono text-[10px] text-faint">cost {fmt(n.startupCost)}..{fmt(n.totalCost)}</span>
        </div>
        {mis && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-bad">
            <TriangleAlert className="h-3 w-3" /> estimate off by ≥10× — stale stats or correlated predicates; can pick the wrong join strategy
          </div>
        )}
      </button>
      {n.children.map((ch) => (
        <NodeCard key={ch.id} n={ch} total={total} onOpen={onOpen} depth={depth + 1} />
      ))}
    </div>
  );
}

export function PlanTree({ plan }: { plan: PlanSummary }) {
  const [open, setOpen] = useState<PlanNode | null>(null);
  const g = open ? glossaryFor(open.type) : undefined;
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-faint">
        <span>Rows flow upward: leaves (scans) run first, the top node returns the result. Click a node to see how it’s implemented.</span>
        <span className="ml-auto flex items-center gap-2">
          <Tag tone="neutral">total cost {fmt(plan.totalCost)}</Tag>
          {plan.executionMs !== undefined && <Tag tone="info">{plan.executionMs.toFixed(1)} ms</Tag>}
        </span>
      </div>
      <NodeCard n={plan.root} total={plan.totalCost} onOpen={setOpen} depth={0} />
      <SidePanel open={!!open} onClose={() => setOpen(null)} eyebrow="Executor node" title={open?.type ?? ''} widthClassName="w-[440px]">
        {open && (
          <div className="space-y-4 text-sm">
            <div className="font-mono text-xs text-muted">{open.detail}</div>
            {g ? (
              <>
                <section>
                  <div className="eyebrow mb-1">What it does</div>
                  <p className="leading-relaxed text-muted">
                    <Md text={g.what} />
                  </p>
                </section>
                <section>
                  <div className="eyebrow mb-1">How it’s implemented</div>
                  <p className="leading-relaxed text-muted">
                    <Md text={g.how} />
                  </p>
                </section>
                <section>
                  <div className="eyebrow mb-1">Cost model</div>
                  <p className="leading-relaxed text-muted">
                    <Md text={g.cost} />
                  </p>
                </section>
                <section>
                  <div className="eyebrow mb-1">When the planner picks it</div>
                  <p className="leading-relaxed text-muted">
                    <Md text={g.when} />
                  </p>
                </section>
              </>
            ) : (
              <p className="text-muted">No notes for this node type yet.</p>
            )}
            <section>
              <div className="eyebrow mb-1">This node</div>
              <ul className="space-y-0.5 font-mono text-xs text-muted">
                <li>startup cost {fmt(open.startupCost)} · total {fmt(open.totalCost)}</li>
                <li>estimated rows {fmt(open.planRows)}</li>
                {open.actualRows !== undefined && <li>actual rows {fmt(open.actualRows)} × {open.loops ?? 1} loop(s)</li>}
                {open.props.map((p, i) => (
                  <li key={i}>
                    {p.k}: {p.v}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </SidePanel>
    </div>
  );
}

/* ------------------------------------------------------------------ variants */

type VarState = { status: 'loading' } | { status: 'ok'; plan: PlanSummary } | { status: 'error'; error: string };

export function PlanLab({ variants, intro }: { variants: PlanVariant[]; intro?: string }) {
  const [sel, setSel] = useState(0);
  const [states, setStates] = useState<Record<number, VarState>>({});
  const [mine, setMine] = useState<{ sql: string; setup: string } | null>(null);
  const [mineState, setMineState] = useState<VarState | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      for (let i = 0; i < variants.length; i++) {
        setStates((s) => ({ ...s, [i]: { status: 'loading' } }));
        try {
          const plan = await explainSummary(variants[i].sql, true, variants[i].setup);
          if (alive) setStates((s) => ({ ...s, [i]: { status: 'ok', plan } }));
        } catch (e) {
          if (alive) setStates((s) => ({ ...s, [i]: { status: 'error', error: errMsg(e) } }));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [variants]);

  const v = variants[sel];
  const st = states[sel];
  const prevSt = sel > 0 ? states[sel - 1] : undefined;
  const change = st?.status === 'ok' && prevSt?.status === 'ok' ? diffPlans(prevSt.plan, st.plan) : null;
  const maxCost = Math.max(1, ...Object.values(states).map((x) => (x.status === 'ok' ? x.plan.totalCost : 0)));
  const maxMs = Math.max(0.01, ...Object.values(states).map((x) => (x.status === 'ok' ? x.plan.executionMs ?? 0 : 0)));

  const runMine = async () => {
    if (!mine) return;
    setMineState({ status: 'loading' });
    try {
      setMineState({ status: 'ok', plan: await explainSummary(mine.sql, true, mine.setup || undefined) });
    } catch (e) {
      setMineState({ status: 'error', error: errMsg(e) });
    }
  };
  const mineChange = mineState?.status === 'ok' && st?.status === 'ok' ? diffPlans(st.plan, mineState.plan) : null;

  return (
    <div className="space-y-4">
      {intro && <p className="text-sm text-muted">{intro}</p>}
      {/* comparison strip */}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${variants.length}, minmax(0, 1fr))` }}>
        {variants.map((x, i) => {
          const s = states[i];
          return (
            <button
              key={i}
              onClick={() => {
                setSel(i);
                setMine(null);
                setMineState(null);
              }}
              className={cn('rounded-lg border p-2.5 text-left transition', i === sel ? 'border-ink bg-surface shadow-paper' : 'border-line bg-sunken/50 hover:bg-surface')}
            >
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-faint">
                v{i + 1}
                {s?.status === 'loading' && <Loader2 className="h-3 w-3 animate-spin" />}
              </div>
              <div className="mt-0.5 text-[13px] font-medium leading-snug text-ink">{x.label}</div>
              {s?.status === 'ok' && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 flex-1 rounded-full bg-line/60">
                      <motion.div className="h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${Math.max(2, (s.plan.totalCost / maxCost) * 100)}%` }} />
                    </div>
                    <span className="w-12 text-right font-mono text-[10px] text-muted">{fmt(s.plan.totalCost)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 flex-1 rounded-full bg-line/60">
                      <motion.div className="h-full rounded-full bg-info" initial={{ width: 0 }} animate={{ width: `${Math.max(2, ((s.plan.executionMs ?? 0) / maxMs) * 100)}%` }} />
                    </div>
                    <span className="w-12 text-right font-mono text-[10px] text-muted">{s.plan.executionMs?.toFixed(1)}ms</span>
                  </div>
                  <div className="truncate font-mono text-[10px] text-faint">{s.plan.scans.map((x) => x.type).join(' + ')}</div>
                </div>
              )}
              {s?.status === 'error' && <div className="mt-1 text-[11px] text-bad">error</div>}
            </button>
          );
        })}
      </div>
      <div className="flex gap-3 text-[10px] text-faint">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-3 rounded-full bg-accent" /> planner’s estimated cost (arbitrary units: page reads + CPU)
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-3 rounded-full bg-info" /> measured time in this browser (EXPLAIN ANALYZE)
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="space-y-3">
          <Callout tone="tip" title={`v${sel + 1} · ${v.label}`}>
            <Md text={v.note} />
          </Callout>
          {change && (
            <div className="rounded-md border border-line bg-surface p-3">
              <div className="eyebrow mb-1.5">What changed vs v{sel}</div>
              <ul className="space-y-1 text-[13px] text-muted">
                {change.lines.map((l, i) => (
                  <li key={i} className="flex gap-2">
                    <ArrowDown className="mt-0.5 h-3.5 w-3.5 shrink-0 rotate-[-90deg] text-accent" />
                    <Md text={l} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {v.setup && (
            <div>
              <div className="eyebrow mb-1">Setup (runs in a rolled-back transaction)</div>
              <CodeBlock code={v.setup.trim()} language="sql" showLineNumbers={false} className="text-[11.5px]" />
            </div>
          )}
          <div>
            <div className="eyebrow mb-1">Query</div>
            <CodeBlock code={v.sql.trim()} language="sql" showLineNumbers={false} className="text-[11.5px]" />
          </div>
          {!mine ? (
            <Button size="sm" variant="secondary" icon={<FlaskConical className="h-3.5 w-3.5" />} onClick={() => setMine({ sql: v.sql.trim(), setup: v.setup?.trim() ?? '' })}>
              Try your own change
            </Button>
          ) : (
            <div className="space-y-2 rounded-md border border-accent/40 bg-accent/[0.04] p-3">
              <div className="eyebrow">Your variant — compared against v{sel + 1}</div>
              <div className="text-[11px] text-muted">setup (e.g. CREATE INDEX … ; ANALYZE big_orders;)</div>
              <SqlEditor value={mine.setup} onChange={(x) => setMine({ ...mine, setup: x })} minRows={2} onRun={runMine} />
              <div className="text-[11px] text-muted">query</div>
              <SqlEditor value={mine.sql} onChange={(x) => setMine({ ...mine, sql: x })} minRows={4} onRun={runMine} />
              <Button size="sm" icon={<Play className="h-3.5 w-3.5" />} onClick={runMine}>
                EXPLAIN ANALYZE
              </Button>
            </div>
          )}
        </div>
        <div className="min-w-0">
          {mineState ? (
            mineState.status === 'loading' ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted" />
            ) : mineState.status === 'error' ? (
              <SqlErrorBox message={mineState.error} />
            ) : (
              <div className="space-y-3">
                {mineChange && (
                  <Callout tone="info" title={`Your change vs v${sel + 1}`}>
                    <ul className="space-y-0.5">
                      {mineChange.lines.map((l, i) => (
                        <li key={i}>
                          <Md text={l} />
                        </li>
                      ))}
                    </ul>
                  </Callout>
                )}
                <PlanTree plan={mineState.plan} />
              </div>
            )
          ) : !st || st.status === 'loading' ? (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> EXPLAIN ANALYZE on real data…
            </div>
          ) : st.status === 'error' ? (
            <SqlErrorBox message={st.error} />
          ) : (
            <PlanTree plan={st.plan} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Two plans side by side with a diff (judgment drills, optimize exercises). */
export function PlanCompare({ a, b, labelA, labelB }: { a: PlanSummary; b: PlanSummary; labelA: string; labelB: string }) {
  const change = useMemo(() => diffPlans(a, b), [a, b]);
  return (
    <div className="space-y-3">
      <Callout tone="info" title={`${labelA} → ${labelB}`}>
        <ul className="space-y-0.5">
          {change.lines.map((l, i) => (
            <li key={i}>
              <Md text={l} />
            </li>
          ))}
        </ul>
      </Callout>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="min-w-0">
          <div className="eyebrow mb-1">{labelA}</div>
          <PlanTree plan={a} />
        </div>
        <div className="min-w-0">
          <div className="eyebrow mb-1">{labelB}</div>
          <PlanTree plan={b} />
        </div>
      </div>
    </div>
  );
}

export function GlossaryButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="xs" variant="ghost" icon={<BookOpen className="h-3 w-3" />} onClick={onClick}>
      node glossary
    </Button>
  );
}
