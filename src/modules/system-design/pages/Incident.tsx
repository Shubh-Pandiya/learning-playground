import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, BellRing, CheckCircle2, HeartPulse, RotateCcw, XCircle } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, Tag } from '@/shared/ui';
import { simulate } from '../engine/simulate';
import { INCIDENTS } from '../judgment/data/incidents';
import type { IncidentCase } from '../judgment/types';
import { BackToPractice, drillGraph, PatternLinks } from '../judgment/ui';
import { useSd } from '../store';
import type { Graph } from '../types';
import { Canvas } from '../ui/Canvas';
import { MetricStrip } from '../ui/Metrics';
import { Rich } from '../ui/Rich';

const SEV_TONE = { SEV1: 'bad', SEV2: 'warn', SEV3: 'info' } as const;
const SIG_TONE: Record<string, string> = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', neutral: 'text-ink' };

function injected(c: IncidentCase): Graph {
  const g = drillGraph(c.graph);
  for (const d of c.inject.down ?? []) {
    const n = g.nodes.find((x) => x.id === d.node);
    if (n) n.down = Math.min(n.count, d.count);
  }
  return g;
}

function IncidentDrill({ c }: { c: IncidentCase }) {
  const record = useSd((s) => s.recordDrill);
  const best = useSd((s) => s.drills[`incident:${c.id}`]?.best);
  const [graph, setGraph] = useState<Graph>(() => injected(c));
  const [traffic, setTraffic] = useState(c.inject.traffic ?? 1);
  const [stage, setStage] = useState(0);
  const [picks, setPicks] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false);
  const sim = useMemo(() => simulate(graph, c.workload, { traffic }), [graph, c.workload, traffic]);

  const st = c.stages[stage];
  const picked = picks[stage];
  const done = stage === c.stages.length - 1 && picked !== undefined;
  const right = c.stages.filter((s, i) => picks[i] === s.answer).length;

  const pick = (i: number) => {
    if (picked !== undefined) return;
    const next = { ...picks, [stage]: i };
    setPicks(next);
    if (stage === c.stages.length - 1) record('incident', c.id, Math.round((c.stages.filter((s, k) => next[k] === s.answer).length / c.stages.length) * 100));
  };
  const recover = () => {
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => ({ ...n, down: 0 })) }));
    setTraffic(1);
    setRecovered(true);
  };
  const retry = () => {
    setGraph(injected(c));
    setTraffic(c.inject.traffic ?? 1);
    setStage(0);
    setPicks({});
    setRecovered(false);
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[330px] shrink-0 flex-col overflow-y-auto border-r border-line bg-paper p-3.5">
        <BackToPractice />
        <div className={cn('mt-3 rounded-xl border p-3', c.severity === 'SEV1' ? 'border-bad/50 bg-bad/[0.07]' : 'border-warn/50 bg-warn/[0.07]')}>
          <div className="flex items-center gap-1.5">
            <BellRing size={14} className={c.severity === 'SEV1' ? 'text-bad' : 'text-warn'} />
            <Tag size="sm" tone={SEV_TONE[c.severity]} variant="solid">
              {c.severity}
            </Tag>
            <span className="font-mono text-[10.5px] text-faint">PagerDuty · now</span>
          </div>
          <p className="mt-1.5 font-mono text-[12.5px] font-semibold leading-snug">{c.alert}</p>
        </div>
        <h2 className="mt-3 font-mono text-[15px] font-semibold leading-snug">{c.title}</h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          <Rich text={c.context} />
        </p>
        <div className="mt-3">
          <div className="eyebrow mb-1">Dashboard</div>
          <div className="grid grid-cols-2 gap-1.5">
            {c.signals.map((s) => (
              <div key={s.label} className="rounded-md border border-line bg-surface px-2 py-1">
                <div className="font-mono text-[9.5px] uppercase tracking-wider text-faint">{s.label}</div>
                <div className={cn('font-mono text-[12.5px] font-semibold', SIG_TONE[s.tone])}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <div className="eyebrow mb-1">Timeline</div>
          <ol className="space-y-1 border-l border-line pl-3">
            {c.timeline.map((t, i) => (
              <li key={i} className="relative text-[12px] leading-snug text-muted">
                <span className="absolute -left-[16.5px] top-1 h-2 w-2 rounded-full bg-faint" />
                <span className="font-mono text-[10.5px] text-faint">{t.t}</span> <Rich text={t.event} />
              </li>
            ))}
          </ol>
        </div>
        <div className="mt-4">
          <PatternLinks ids={c.patterns} />
        </div>
      </aside>

      <main className="relative min-w-0 flex-1">
        <Canvas
          graph={graph}
          sim={sim}
          editable={false}
          animate
          showRates
          selectedId={selected}
          onSelect={setSelected}
          onMove={(id, x, y) => setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }))}
          fitKey={c.id}
        />
        <div className="pointer-events-none absolute left-3 right-3 top-3 flex justify-center">
          <MetricStrip m={sim.metrics} wl={c.workload} traffic={traffic} />
        </div>
        {recovered && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg border border-ok/40 bg-surface px-3 py-2 font-mono text-[12px] text-ok shadow-lift">
            <HeartPulse size={14} className="mr-1 inline" /> Recovered: failed instances restored, traffic back to normal.
          </div>
        )}
      </main>

      <aside className="flex w-[370px] shrink-0 flex-col overflow-y-auto border-l border-line bg-paper p-3.5">
        <div className="flex items-center gap-1">
          {c.stages.map((s, i) => (
            <button
              key={i}
              disabled={i > stage}
              onClick={() => setStage(i)}
              className={cn(
                'flex-1 rounded-md border px-1 py-1 font-mono text-[10px] uppercase tracking-wider',
                i === stage ? 'border-accent bg-accent/10 text-ink' : picks[i] !== undefined ? (picks[i] === s.answer ? 'border-ok/40 text-ok' : 'border-bad/40 text-bad') : 'border-line text-faint',
              )}
            >
              {s.title}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <div className="eyebrow">
            Stage {stage + 1}/{c.stages.length} · {st.title}
          </div>
          <p className="mt-1 text-[13.5px] font-medium leading-snug">
            <Rich text={st.question} />
          </p>
          <div className="mt-2 grid gap-1.5">
            {st.options.map((o, i) => {
              const isAns = i === st.answer;
              return (
                <button
                  key={i}
                  disabled={picked !== undefined}
                  onClick={() => pick(i)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] transition',
                    picked === undefined && 'border-line bg-surface hover:border-accent hover:bg-accent/5',
                    picked !== undefined && isAns && 'border-ok/60 bg-ok/10',
                    picked !== undefined && picked === i && !isAns && 'border-bad/60 bg-bad/10',
                    picked !== undefined && picked !== i && !isAns && 'border-line opacity-60',
                  )}
                >
                  <Rich text={o} />
                </button>
              );
            })}
          </div>
          {picked !== undefined && (
            <div className="mt-2 space-y-2">
              <p className="text-[12.5px] leading-relaxed text-muted">
                <span className={cn('inline-flex items-center gap-1 font-semibold', picked === st.answer ? 'text-ok' : 'text-bad')}>
                  {picked === st.answer ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                  {picked === st.answer ? 'Right.' : 'Not quite.'}
                </span>{' '}
                <Rich text={st.explain} />
              </p>
              {stage < c.stages.length - 1 && (
                <Button size="sm" variant="primary" icon={<ArrowRight size={14} />} onClick={() => setStage((s) => s + 1)}>
                  Next: {c.stages[stage + 1].title}
                </Button>
              )}
            </div>
          )}
        </div>
        {done && (
          <div className="mt-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="eyebrow">Postmortem</span>
              <span className={cn('font-mono text-lg font-semibold', right === c.stages.length ? 'text-ok' : right >= c.stages.length / 2 ? 'text-warn' : 'text-bad')}>
                {right}/{c.stages.length} right
              </span>
            </div>
            <Callout tone="tip" title="Blameless lesson">
              <span className="text-[12.5px]">
                <Rich text={c.lesson} />
              </span>
            </Callout>
            {c.realWorld && (
              <Callout tone="info" title="It happened for real">
                <span className="text-[12.5px]">
                  <Rich text={c.realWorld} />
                </span>
              </Callout>
            )}
            <div className="flex flex-wrap gap-2">
              {!recovered && (
                <Button size="sm" variant="success" icon={<HeartPulse size={14} />} onClick={recover}>
                  Recover the system
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={retry}>
                Replay incident
              </Button>
              {best !== undefined && <span className="self-center font-mono text-[11px] text-faint">best {best}%</span>}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

export function Incident() {
  const { id } = useParams();
  const c = INCIDENTS.find((x) => x.id === id);
  if (!c)
    return (
      <div className="p-10 text-center">
        <p className="font-mono">Unknown incident.</p>
        <Link to="/system-design/practice" className="text-accent underline">
          Back to drills
        </Link>
      </div>
    );
  return <IncidentDrill key={c.id} c={c} />;
}
