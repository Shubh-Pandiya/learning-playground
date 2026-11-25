import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, CircleAlert, Flag, RotateCcw, Search, Trash2, XCircle, Zap } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, Tag } from '@/shared/ui';
import { COMPONENTS } from '../data/components';
import { simulate } from '../engine/simulate';
import { REVIEWS } from '../judgment/data/reviews';
import { FLAW_LABEL, type FlawKind, type ReviewCase } from '../judgment/types';
import { BackToPractice, drillGraph, PatternLinks } from '../judgment/ui';
import { useSd } from '../store';
import type { Graph, Verdict } from '../types';
import { Canvas } from '../ui/Canvas';
import { MetricStrip } from '../ui/Metrics';
import { Rich } from '../ui/Rich';
import { TrafficBar } from '../ui/TrafficBar';
import { fmtPct, fmtQps } from '../ui/format';

const KINDS = Object.keys(FLAW_LABEL) as FlawKind[];

interface Graded {
  score: number;
  found: Record<string, 'exact' | 'partial' | 'missed'>;
  falseFlags: string[];
}

function grade(c: ReviewCase, flags: Record<string, FlawKind>): Graded {
  const found: Graded['found'] = {};
  let credit = 0;
  for (const f of c.flaws) {
    const mine = flags[f.target];
    found[f.target] = !mine ? 'missed' : mine === f.kind ? 'exact' : 'partial';
    credit += !mine ? 0 : mine === f.kind ? 1 : 0.6;
  }
  const falseFlags = Object.keys(flags).filter((t) => !c.flaws.some((f) => f.target === t));
  const score = Math.max(0, Math.min(100, Math.round((credit / c.flaws.length) * 100 - falseFlags.length * 10)));
  return { score, found, falseFlags };
}

function ReviewDrill({ c }: { c: ReviewCase }) {
  const record = useSd((s) => s.recordDrill);
  const best = useSd((s) => s.drills[`review:${c.id}`]?.best);
  const [graph, setGraph] = useState<Graph>(() => drillGraph(c.graph));
  const [traffic, setTraffic] = useState(1);
  const [animate, setAnimate] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [flags, setFlags] = useState<Record<string, FlawKind>>({});
  const [result, setResult] = useState<Graded | null>(null);

  const sim = useMemo(() => simulate(graph, c.workload, { traffic }), [graph, c.workload, traffic]);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nameOf = (t: string): string => {
    if (t.includes('->')) {
      const [a, b] = t.split('->');
      return `${nameOf(a)} → ${nameOf(b)}`;
    }
    const n = byId.get(t);
    return n ? (n.label ?? COMPONENTS[n.kind].name) : t;
  };

  const { nodeVerdicts, edgeVerdicts, badges } = useMemo(() => {
    const nv: Record<string, Verdict> = {};
    const ev: Record<string, Verdict> = {};
    const b: Record<string, string> = {};
    const set = (t: string, v: Verdict, label: string) => {
      if (t.includes('->')) ev[t] = v;
      else {
        nv[t] = v;
        b[t] = label;
      }
    };
    if (!result) for (const [t, k] of Object.entries(flags)) set(t, 'extra', `⚑ ${k}`);
    else {
      for (const f of c.flaws) {
        const st = result.found[f.target];
        set(f.target, st === 'missed' ? 'wrong' : 'good', st === 'missed' ? `missed: ${f.kind}` : `✓ ${f.kind}`);
      }
      for (const t of result.falseFlags) set(t, 'extra', 'not a flaw');
    }
    return { nodeVerdicts: nv, edgeVerdicts: ev, badges: b };
  }, [flags, result, c.flaws]);

  const sel = selected;
  const selNode = sel && !sel.includes('->') ? byId.get(sel) : undefined;
  const selSim = selNode ? sim.nodes[selNode.id] : undefined;
  const wl = c.workload;

  const submit = () => {
    const g = grade(c, flags);
    setResult(g);
    record('review', c.id, g.score);
    setSelected(null);
  };
  const retry = () => {
    setResult(null);
    setFlags({});
    setGraph(drillGraph(c.graph));
    setTraffic(1);
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[330px] shrink-0 flex-col overflow-y-auto border-r border-line bg-paper p-3.5">
        <BackToPractice />
        <div className="eyebrow mt-3">Design review · {c.level}</div>
        <h2 className="mt-0.5 font-mono text-[15px] font-semibold leading-snug">{c.title}</h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          <Rich text={c.context} />
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Tag size="sm" tone="accent">
            peak {fmtQps(wl.qps)}
          </Tag>
          <Tag size="sm">{fmtPct(wl.readRatio)} reads</Tag>
        </div>
        <Callout tone="tip" className="mt-3" title="Your job">
          <span className="text-[12px]">
            A teammate proposes this design. Find what a senior reviewer would block it for. Click a component or connection, classify the problem, then submit. Use traffic and “kill one” to
            test your suspicion first — false alarms cost points.
          </span>
        </Callout>
        <div className="mt-3">
          <div className="eyebrow mb-1">Your findings ({Object.keys(flags).length})</div>
          {Object.keys(flags).length === 0 && <p className="text-[12px] text-faint">Nothing flagged yet.</p>}
          <ul className="space-y-1">
            {Object.entries(flags).map(([t, k]) => (
              <li key={t} className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[12px]">
                <Flag size={12} className="shrink-0 text-warn" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono font-semibold">{nameOf(t)}</span>
                  <span className="text-[11px] text-muted">{FLAW_LABEL[k]}</span>
                </span>
                {!result && (
                  <button
                    aria-label="Remove finding"
                    className="text-faint hover:text-bad"
                    onClick={() =>
                      setFlags((f) => {
                        const n = { ...f };
                        delete n[t];
                        return n;
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-3 flex gap-2">
          {!result ? (
            <Button size="sm" variant="primary" icon={<Search size={14} />} onClick={submit} disabled={!Object.keys(flags).length}>
              Submit review
            </Button>
          ) : (
            <Button size="sm" variant="secondary" icon={<RotateCcw size={14} />} onClick={retry}>
              Try again
            </Button>
          )}
          {best !== undefined && <span className="self-center font-mono text-[11px] text-faint">best {best}%</span>}
        </div>
        <div className="mt-4">
          <PatternLinks ids={c.patterns} />
        </div>
      </aside>

      <main className="relative min-w-0 flex-1">
        <Canvas
          graph={graph}
          sim={sim}
          nodeVerdicts={nodeVerdicts}
          edgeVerdicts={edgeVerdicts}
          nodeBadges={badges}
          editable={false}
          animate={animate}
          showRates
          selectedId={selNode?.id ?? null}
          onSelect={setSelected}
          onEdgeClick={(id) => setSelected(id)}
          onMove={(id, x, y) => setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }))}
          fitKey={c.id}
        />
        <div className="pointer-events-none absolute left-3 right-3 top-3 flex justify-center">
          <MetricStrip m={sim.metrics} wl={wl} traffic={traffic} />
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 flex">
          <TrafficBar
            traffic={traffic}
            setTraffic={setTraffic}
            animate={animate}
            setAnimate={setAnimate}
            anyDown={graph.nodes.some((n) => n.down)}
            onRestoreAll={() => setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => ({ ...n, down: 0 })) }))}
          />
        </div>
      </main>

      <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l border-line bg-paper p-3.5">
        {result ? (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="eyebrow">Expert critique</span>
              <span className={cn('font-mono text-xl font-semibold', result.score >= 80 ? 'text-ok' : result.score >= 50 ? 'text-warn' : 'text-bad')}>{result.score}%</span>
            </div>
            {c.flaws.map((f) => {
              const st = result.found[f.target];
              return (
                <div key={f.target} className={cn('rounded-lg border p-2.5', st === 'missed' ? 'border-bad/40 bg-bad/[0.04]' : 'border-ok/40 bg-ok/[0.04]')}>
                  <div className="flex items-start gap-1.5">
                    {st === 'missed' ? <XCircle size={14} className="mt-0.5 shrink-0 text-bad" /> : <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />}
                    <div className="min-w-0">
                      <div className="font-mono text-[12.5px] font-semibold">{f.title}</div>
                      <div className="font-mono text-[10.5px] text-faint">
                        {nameOf(f.target)} · {FLAW_LABEL[f.kind]}
                        {st === 'partial' && <span className="text-warn"> (you flagged it as {FLAW_LABEL[flags[f.target]].toLowerCase()})</span>}
                      </div>
                    </div>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                    <Rich text={f.why} />
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed">
                    <span className="font-semibold text-ok">Fix: </span>
                    <Rich text={f.fix} />
                  </p>
                </div>
              );
            })}
            {result.falseFlags.map((t) => (
              <div key={t} className="rounded-lg border border-warn/40 bg-warn/[0.05] p-2.5">
                <div className="flex items-center gap-1.5 font-mono text-[12px] font-semibold text-warn">
                  <CircleAlert size={13} /> Not a flaw: {nameOf(t)}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  <Rich text={c.fine?.[t] ?? 'This part is acceptable for this workload. Before flagging, test it: kill it or spike traffic and see whether anything actually breaks.'} />
                </p>
              </div>
            ))}
            <Callout tone="tip" title="Takeaway">
              <span className="text-[12.5px]">
                <Rich text={c.takeaway} />
              </span>
            </Callout>
          </div>
        ) : sel ? (
          <div className="space-y-3">
            <div>
              <div className="eyebrow">{selNode ? 'Component' : 'Connection'}</div>
              <div className="font-mono text-[14px] font-semibold">{nameOf(sel)}</div>
              {selNode && <div className="font-mono text-[11px] text-faint">{COMPONENTS[selNode.kind].tech}</div>}
            </div>
            {selNode && selSim && (
              <div className="flex flex-wrap gap-1">
                <Tag size="sm" tone={selSim.status === 'overloaded' ? 'bad' : selSim.status === 'ok' ? 'ok' : 'warn'} dot>
                  {selSim.status}
                </Tag>
                <Tag size="sm">{fmtPct(Math.min(selSim.util, 9.99))} load</Tag>
                <Tag size="sm">×{selNode.count}</Tag>
              </div>
            )}
            {selSim?.note && <p className="rounded-md bg-warn/10 px-2 py-1.5 text-[12px] text-warn">{selSim.note}</p>}
            {selNode && selNode.kind !== 'client' && (
              <Button
                size="xs"
                variant="danger"
                icon={<Zap size={13} />}
                disabled={(selNode.down ?? 0) >= selNode.count}
                onClick={() => setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === selNode.id ? { ...n, down: Math.min(n.count, (n.down ?? 0) + 1) } : n)) }))}
              >
                Kill one instance (test it)
              </Button>
            )}
            <div>
              <div className="eyebrow mb-1">Flag as…</div>
              <div className="grid gap-1">
                {KINDS.map((k) => (
                  <button
                    key={k}
                    onClick={() => setFlags((f) => ({ ...f, [sel]: k }))}
                    className={cn(
                      'rounded-md border px-2 py-1 text-left text-[12px] transition',
                      flags[sel] === k ? 'border-warn bg-warn/10 text-ink' : 'border-line bg-surface text-muted hover:border-warn/60 hover:text-ink',
                    )}
                  >
                    {FLAW_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-[12.5px] text-muted">
            <div className="eyebrow">How a senior reviews a design</div>
            <ol className="list-decimal space-y-1 pl-4">
              <li>Follow one read and one write end-to-end. Where does each byte live?</li>
              <li>For every box: what happens when it dies? (kill it)</li>
              <li>At 2–4× traffic, which box turns red first?</li>
              <li>Is every component pulling its weight for <i>this</i> workload — or is it the wrong tool?</li>
              <li>Retries, duplicates, ordering: can the same thing happen twice?</li>
            </ol>
            <p className="text-faint">Select a component or a connection on the canvas to inspect and flag it.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

export function DesignReview() {
  const { id } = useParams();
  const c = REVIEWS.find((x) => x.id === id);
  if (!c)
    return (
      <div className="p-10 text-center">
        <p className="font-mono">Unknown review.</p>
        <Link to="/system-design/practice" className="text-accent underline">
          Back to drills
        </Link>
      </div>
    );
  return <ReviewDrill key={c.id} c={c} />;
}
