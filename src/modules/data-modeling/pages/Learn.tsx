import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Brain, CheckCircle2, Footprints, X } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, StepControls, Tag, useStepper } from '@/shared/ui';
import { applyOps, diffImpact, startSchema, type Impact } from '../engine/analyze';
import { evaluate } from '../engine/evaluate';
import { topicPath, useDm } from '../store';
import type { CanvasTopic, Schema, StepTag } from '../types';
import { Brief, Recall } from '../ui/Brief';
import { Canvas } from '../ui/Canvas';
import { ChangeCard, type Change } from '../ui/ChangeCard';
import { ImpactPanel } from '../ui/ImpactPanel';
import { Inspector } from '../ui/Inspector';
import { MetricStrip } from '../ui/Metrics';
import { PredictCard } from '../ui/Predict';
import { Rich } from '../ui/Rich';

const TAG_TONE: Record<StepTag, 'bad' | 'accent' | 'warn' | 'info' | 'ok'> = {
  problem: 'bad',
  technique: 'accent',
  tradeoff: 'warn',
  failure: 'bad',
  case: 'info',
  recap: 'ok',
};

const NO_VERDICTS = {};

type LeftTab = 'walk' | 'brief' | 'quiz';

/** Schema after the ops of steps 0..k (k = -1 → the scenario's start). */
function frames(topic: CanvasTopic): Schema[] {
  const sc = topic.scenario;
  const out: Schema[] = [];
  let s = startSchema(sc);
  for (const st of topic.guided) {
    s = applyOps(sc, s, st.ops ?? []);
    out.push(s);
  }
  return out;
}

function changedCols(a: Schema, b: Schema): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of b.tables) {
    const o = a.tables.find((x) => x.id === t.id);
    if (!o) continue;
    const cs = t.columns.filter((c) => {
      const p = o.columns.find((x) => x.attr === c.attr);
      return !p || p.pk !== c.pk || p.indexed !== c.indexed;
    });
    if (cs.length) out[t.id] = cs.map((c) => c.attr);
  }
  return out;
}

export function Learn({ topic }: { topic: CanvasTopic }) {
  const sc = topic.scenario;
  const stored = useDm((s) => s.topics[topic.id]);
  const setGuidedStep = useDm((s) => s.setGuidedStep);
  const completeGuided = useDm((s) => s.completeGuided);
  const recordPrediction = useDm((s) => s.recordPrediction);

  const n = topic.guided.length;
  const stepper = useStepper(n, { intervalMs: 9000, initialStep: Math.min(stored?.guidedStep ?? 0, n - 1) });
  const step = stepper.step;
  const st = topic.guided[step];

  const [tab, setTab] = useState<LeftTab>('walk');
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [focusOverride, setFocusOverride] = useState<string | null | undefined>(undefined);

  const answered = answers[step];
  const revealed = !st.predict || answered !== undefined;

  useEffect(() => {
    setGuidedStep(topic.id, step);
    if (step === n - 1) completeGuided(topic.id);
    setFocusOverride(undefined);
  }, [step, topic.id, n, setGuidedStep, completeGuided]);

  useEffect(() => {
    if (stepper.playing && !revealed) stepper.pause();
  }, [stepper, revealed]);

  const all = useMemo(() => frames(topic), [topic]);
  const start = useMemo(() => startSchema(sc), [sc]);
  const prev = step === 0 ? start : all[step - 1];
  const schema = revealed ? all[step] : prev;
  const ev = useMemo(() => evaluate(sc, schema), [sc, schema]);
  const prevImpact: Impact = useMemo(() => evaluate(sc, prev).impact, [sc, prev]);

  const stepChange: Change | null = useMemo(() => {
    if (!revealed || !st.ops?.length) return null;
    return { key: `step-${step}`, title: st.title, lines: diffImpact(sc, prevImpact, ev.impact) };
  }, [revealed, st, step, sc, prevImpact, ev.impact]);

  const fresh = useMemo(() => (revealed ? all[step].tables.filter((t) => !prev.tables.some((p) => p.id === t.id)).map((t) => t.id) : []), [revealed, all, step, prev]);
  const changed = useMemo(() => (revealed ? changedCols(prev, all[step]) : {}), [revealed, prev, all, step]);
  const focus = focusOverride === undefined ? (revealed ? (st.focus ?? null) : null) : focusOverride;

  const sel = selected ? schema.tables.find((t) => t.id === selected) : undefined;
  const isLast = step === n - 1;
  const predictions = stored?.predictions ?? {};
  const predRight = Object.values(predictions).filter(Boolean).length;
  const predTotal = Object.keys(predictions).length;

  return (
    <div className="flex h-full min-h-0">
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
                <Tag size="sm" tone={TAG_TONE[st.tag]}>
                  {st.tag}
                </Tag>
                <span className="font-mono text-[11px] text-faint">
                  step {step + 1} / {n}
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
                <PredictCard
                  key={step}
                  predict={st.predict}
                  answered={answered}
                  onAnswer={(i, right) => {
                    setAnswers((a) => ({ ...a, [step]: i }));
                    recordPrediction(topic.id, `g${step}`, right);
                  }}
                />
              )}
              {revealed && st.keyIdea && (
                <Callout tone="tip" title="Key idea">
                  <span className="text-[12.5px]">
                    <Rich text={st.keyIdea} />
                  </span>
                </Callout>
              )}
              {stepChange && (
                <div>
                  <div className="eyebrow mb-1">What this step changed → impact</div>
                  <ChangeCard change={stepChange} />
                </div>
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
                  <p className="mt-1 text-[12.5px] text-muted">Now model it yourself. The palette includes plausible traps, and the impact panel scores every move.</p>
                  <div className="mt-2 flex gap-2">
                    <Link to={topicPath(topic, 'build')}>
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
          <div className="flex-1 overflow-y-auto p-4">
            <Brief topic={topic} />
          </div>
        )}
        {tab === 'quiz' && (
          <div className="flex-1 overflow-y-auto p-4">
            <Recall topic={topic} />
          </div>
        )}
      </aside>

      <main className="relative min-w-0 flex-1">
        <Canvas
          sc={sc}
          schema={schema}
          impact={ev.impact}
          verdicts={NO_VERDICTS}
          fresh={fresh}
          changed={changed}
          focus={focus}
          editable={false}
          selectedId={selected}
          onSelect={setSelected}
          fitKey={`${topic.id}:${schema.tables.map((t) => t.id).join(',')}`}
        />
        <div className="pointer-events-none absolute left-3 right-3 top-3 flex justify-center">
          <MetricStrip impact={ev.impact} />
        </div>
        {!revealed && (
          <div className="pointer-events-none absolute right-3 top-20 rounded-lg border border-accent/50 bg-surface/95 px-3 py-2 font-mono text-[11px] text-accent shadow-paper">
            ← make a prediction to play this step
          </div>
        )}
        {focus && (
          <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-accent/40 bg-surface/95 px-2.5 py-1.5 text-[12px] shadow-paper">
            <span className="text-muted">Tracing</span>
            <span className="font-medium text-ink">{ev.impact.reads[focus]?.name}</span>
            <button onClick={() => setFocusOverride(null)} className="text-faint hover:text-ink" aria-label="Stop tracing">
              <X size={13} />
            </button>
          </div>
        )}
      </main>

      <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-paper">
        {sel ? (
          <Inspector key={sel.id} sc={sc} table={sel} impact={ev.impact} verdict={ev.verdicts[sel.id]} editable={false} onClose={() => setSelected(null)} onRemove={() => undefined} />
        ) : (
          <div className="flex-1 overflow-y-auto p-3.5">
            <div className="eyebrow mb-2">What this model costs right now</div>
            <ImpactPanel sc={sc} impact={ev.impact} focus={focus} onFocus={setFocusOverride} onSelectTable={setSelected} />
          </div>
        )}
      </aside>
    </div>
  );
}
