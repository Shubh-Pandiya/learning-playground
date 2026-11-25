import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Brain, Building2, CheckCircle2, Eye, Footprints, HelpCircle, X } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, StepControls, Tag, useStepper } from '@/shared/ui';
import { COMPONENTS } from '../data/components';
import { nodeFeedback } from '../engine/evaluate';
import { guidedFrame } from '../engine/graph';
import { simulate } from '../engine/simulate';
import { useSd } from '../store';
import type { Graph, Pattern, StepTag, Verdict } from '../types';
import { Canvas } from '../ui/Canvas';
import { Inspector } from '../ui/Inspector';
import { Capabilities, MetricStrip } from '../ui/Metrics';
import { QuizCard } from '../ui/Quiz';
import { Rich } from '../ui/Rich';
import { TrafficBar } from '../ui/TrafficBar';

const TAG_TONE: Record<StepTag, 'bad' | 'accent' | 'warn' | 'info' | 'ok' | 'violet'> = {
  problem: 'bad',
  technique: 'accent',
  tradeoff: 'warn',
  failure: 'bad',
  case: 'info',
  recap: 'ok',
};

type LeftTab = 'walk' | 'brief' | 'quiz';

export function Learn({ pattern: p }: { pattern: Pattern }) {
  const stored = useSd((s) => s.patterns[p.id]);
  const setGuidedStep = useSd((s) => s.setGuidedStep);
  const completeGuided = useSd((s) => s.completeGuided);
  const recordPrediction = useSd((s) => s.recordPrediction);
  const recordChaos = useSd((s) => s.recordChaos);
  const grade = useSd((s) => s.grade);

  const stepper = useStepper(p.guided.length, { intervalMs: 7000, initialStep: Math.min(stored?.guidedStep ?? 0, p.guided.length - 1) });
  const step = stepper.step;
  const st = p.guided[step];

  const [tab, setTab] = useState<LeftTab>('walk');
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [chaos, setChaos] = useState<Record<string, number>>({});
  const [trafficOverride, setTrafficOverride] = useState<number | null>(null);
  const [animate, setAnimate] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const answered = answers[step];
  const revealed = !st.predict || answered !== undefined;

  useEffect(() => {
    setGuidedStep(p.id, step);
    if (step === p.guided.length - 1) completeGuided(p.id);
    setChaos({});
    setTrafficOverride(null);
  }, [step, p.id, p.guided.length, setGuidedStep, completeGuided]);

  // Don't auto-advance past an unanswered prediction.
  useEffect(() => {
    if (stepper.playing && !revealed) stepper.pause();
  }, [stepper, revealed]);

  const frame = useMemo(() => guidedFrame(p, step, revealed), [p, step, revealed]);
  const graph: Graph = useMemo(
    () => ({ ...frame.graph, nodes: frame.graph.nodes.map((n) => (chaos[n.id] ? { ...n, down: Math.min(n.count, (n.down ?? 0) + chaos[n.id]) } : n)) }),
    [frame.graph, chaos],
  );
  const traffic = trafficOverride ?? frame.traffic;
  const wl = p.scenario.workload;
  const sim = useMemo(() => simulate(graph, wl, { traffic }), [graph, wl, traffic]);

  const nodeVerdicts = useMemo(() => {
    const v: Record<string, Verdict> = {};
    for (const n of graph.nodes) if (n.kind !== 'client' && nodeFeedback(p.scenario, n.kind).verdict === 'wrong') v[n.id] = 'wrong';
    return v;
  }, [graph.nodes, p.scenario]);

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nameOf = (id: string) => byId.get(id)?.label ?? COMPONENTS[byId.get(id)?.kind ?? 'app'].name;
  const sel = selected ? byId.get(selected) : undefined;
  const isLast = step === p.guided.length - 1;
  const predictions = stored?.predictions ?? {};
  const predRight = Object.values(predictions).filter(Boolean).length;
  const predTotal = Object.keys(predictions).length;

  const answer = (i: number) => {
    if (answered !== undefined || !st.predict) return;
    setAnswers((a) => ({ ...a, [step]: i }));
    recordPrediction(p.id, step, i === st.predict.answer);
  };

  return (
    <div className="flex h-full min-h-0">
      {/* left: narration */}
      <aside className="flex w-[400px] shrink-0 flex-col border-r border-line bg-paper">
        <div className="flex border-b border-line">
          {(
            [
              ['walk', 'Walkthrough', Footprints],
              ['brief', 'Brief', BookOpen],
              ['quiz', 'Recall', Brain],
            ] as const
          ).map(([t, label, Icon]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn('flex flex-1 items-center justify-center gap-1.5 py-2 font-mono text-[11px] uppercase tracking-wider', tab === t ? 'border-b-2 border-accent text-ink' : 'text-faint hover:text-muted')}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>

        {tab === 'walk' && (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <div className="flex items-center gap-2">
                <Tag size="sm" tone={TAG_TONE[st.tag]} variant="soft">
                  {st.tag}
                </Tag>
                <span className="font-mono text-[11px] text-faint">
                  step {step + 1} / {p.guided.length}
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
                <div className={cn('rounded-xl border p-3', answered === undefined ? 'border-accent/50 bg-accent/[0.06]' : 'border-line bg-surface')}>
                  <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-accent">
                    <HelpCircle size={13} /> Predict before you see it
                  </div>
                  <p className="mt-1 text-[13.5px] font-medium text-ink">
                    <Rich text={st.predict.question} />
                  </p>
                  <div className="mt-2 grid gap-1.5">
                    {st.predict.options.map((o, i) => {
                      const isAns = i === st.predict!.answer;
                      const picked = answered === i;
                      return (
                        <button
                          key={i}
                          disabled={answered !== undefined}
                          onClick={() => answer(i)}
                          className={cn(
                            'rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] transition',
                            answered === undefined && 'border-line bg-surface hover:border-accent hover:bg-accent/5',
                            answered !== undefined && isAns && 'border-ok/60 bg-ok/10 text-ink',
                            answered !== undefined && picked && !isAns && 'border-bad/60 bg-bad/10 text-ink',
                            answered !== undefined && !picked && !isAns && 'border-line opacity-60',
                          )}
                        >
                          <Rich text={o} />
                        </button>
                      );
                    })}
                  </div>
                  {answered !== undefined ? (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                      <span className={cn('font-semibold', answered === st.predict.answer ? 'text-ok' : 'text-bad')}>{answered === st.predict.answer ? 'Right. ' : 'Not quite. '}</span>
                      <Rich text={st.predict.explain} />
                    </p>
                  ) : (
                    <p className="mt-2 flex items-center gap-1 text-[11px] text-faint">
                      <Eye size={11} /> The canvas will show the answer once you commit to a guess.
                    </p>
                  )}
                </div>
              )}

              {revealed && st.keyIdea && (
                <Callout tone="tip" title="Key idea">
                  <span className="text-[12.5px]">
                    <Rich text={st.keyIdea} />
                  </span>
                </Callout>
              )}
              {revealed && st.goodToKnow && (
                <Callout tone="info" title="Good to know">
                  <span className="text-[12.5px]">
                    <Rich text={st.goodToKnow} />
                  </span>
                </Callout>
              )}
              {isLast && (
                <div className="rounded-xl border border-ok/40 bg-ok/[0.07] p-3">
                  <div className="flex items-center gap-1.5 font-mono text-[12px] font-semibold text-ok">
                    <CheckCircle2 size={14} /> Walkthrough complete
                  </div>
                  <p className="mt-1 text-[12.5px] text-muted">Now rebuild it yourself from a blank canvas. The palette includes plausible traps.</p>
                  <div className="mt-2 flex gap-2">
                    <Link to={`/system-design/p/${p.id}/build`}>
                      <Button size="sm" variant="primary" icon={<ArrowRight size={14} />}>
                        Build it yourself
                      </Button>
                    </Link>
                    <Button size="sm" variant="ghost" onClick={() => setTab('quiz')}>
                      Recall quiz
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <div className="border-t border-line p-3">
              <StepControls stepper={stepper} speeds={[0.5, 1, 2]} caption={predTotal ? `predictions ${predRight}/${predTotal} right` : undefined} />
            </div>
          </>
        )}

        {tab === 'brief' && (
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <p className="text-[14px] leading-relaxed text-ink">{p.tagline}</p>
            <section>
              <div className="eyebrow mb-1.5">Interview signals → reach for this</div>
              <div className="flex flex-wrap gap-1.5">
                {p.signals.map((s) => (
                  <Tag key={s} size="sm" tone="accent">
                    {s}
                  </Tag>
                ))}
              </div>
            </section>
            <section>
              <div className="eyebrow mb-1.5">You'll be able to</div>
              <ul className="space-y-1 text-[13px] text-muted">
                {p.learn.map((l) => (
                  <li key={l} className="flex gap-2">
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />
                    <Rich text={l} />
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <div className="eyebrow mb-1.5">In production</div>
              <div className="space-y-2">
                {p.realWorld.map((r) => (
                  <div key={r.who} className="rounded-lg border border-line bg-surface p-2.5">
                    <div className="flex items-center gap-1.5 font-mono text-[12px] font-semibold">
                      <Building2 size={13} className="text-accent" /> {r.who}
                    </div>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{r.how}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === 'quiz' && (
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            <p className="text-[12px] text-faint">Answer from memory, then rate how sure you were. Questions come back in the Review deck on a spaced schedule.</p>
            {p.quiz.map((q) => (
              <QuizCard key={q.id} item={q} onGraded={(g) => grade(q.id, g)} />
            ))}
          </div>
        )}
      </aside>

      {/* center: animated canvas */}
      <main className="relative min-w-0 flex-1">
        <Canvas
          graph={graph}
          sim={sim}
          nodeVerdicts={nodeVerdicts}
          fresh={frame.added}
          editable={false}
          animate={animate}
          showRates
          selectedId={selected}
          onSelect={setSelected}
          fitKey={`${p.id}:${[...frame.visible].sort().join(',')}`}
        />
        <div className="pointer-events-none absolute left-3 right-3 top-3 flex justify-center">
          <MetricStrip m={sim.metrics} wl={wl} traffic={traffic} />
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 flex">
          <TrafficBar
            traffic={traffic}
            setTraffic={setTrafficOverride}
            animate={animate}
            setAnimate={setAnimate}
            anyDown={Object.keys(chaos).length > 0}
            onRestoreAll={() => setChaos({})}
          />
        </div>
        {!revealed && (
          <div className="pointer-events-none absolute right-3 top-20 rounded-lg border border-accent/50 bg-surface/95 px-3 py-2 font-mono text-[11px] text-accent shadow-paper">
            ← make a prediction to play this step
          </div>
        )}
        {!sel && revealed && (
          <div className="pointer-events-none absolute right-3 top-[76px] font-mono text-[10.5px] text-faint">click a component to inspect or kill it</div>
        )}
      </main>

      {/* right: inspector / capabilities */}
      <aside className="flex w-[330px] shrink-0 flex-col overflow-y-auto border-l border-line bg-paper p-3.5">
        {sel ? (
          <>
            <div className="mb-2 flex items-center justify-between">
              <span className="eyebrow">Component</span>
              <Button size="xs" variant="ghost" iconOnly aria-label="Close" icon={<X size={14} />} onClick={() => setSelected(null)} />
            </div>
            <Inspector
              key={sel.id}
              node={sel}
              sim={sim.nodes[sel.id]}
              graph={graph}
              wl={wl}
              feedback={sel.kind === 'client' ? undefined : nodeFeedback(p.scenario, sel.kind)}
              editable={false}
              onKill={() => setChaos((c) => ({ ...c, [sel.id]: (c[sel.id] ?? 0) + 1 }))}
              onRestore={() =>
                setChaos((c) => {
                  const { [sel.id]: _, ...rest } = c;
                  return rest;
                })
              }
              onPredicted={recordChaos}
            />
          </>
        ) : (
          <>
            <div className="eyebrow mb-2">What this system can do right now</div>
            <Capabilities m={sim.metrics} wl={wl} traffic={traffic} nameOf={nameOf} />
          </>
        )}
      </aside>
    </div>
  );
}
