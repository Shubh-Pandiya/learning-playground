import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, CheckCircle2, Circle, Cpu, Database, FlaskConical, Lock, RotateCcw, Target, Undo2, Zap } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, CodeBlock, StepControls, Tag, useStepper, type Tone } from '@/shared/ui';
import { useDm } from '../../store';
import type { LabTopic, StepTag } from '../../types';
import { ChangeCard, type Change, type ChangeLine } from '../../ui/ChangeCard';
import { PredictCard } from '../../ui/Predict';
import { Rich } from '../../ui/Rich';
import { MODEL_NOTES, NOISY_PREDICT, STEPS, UNDER_HOOD } from './data';
import {
  NOISY_INPUTS,
  SCENARIOS,
  STRATEGIES,
  TENANT_STEPS,
  clampInputs,
  describeInputs,
  diff,
  flags as getFlags,
  fmtH,
  fmtMs,
  fmtN,
  fmtUSD,
  maxShare,
  metrics,
  placement,
  sameInputs,
  shareLabel,
  stratName,
  whyPick,
  type Compliance,
  type Custom,
  type Inputs,
  type ScenarioId,
  type Strategy,
} from './engine';
import { Compare, Packing } from './Packing';
import { RlsDemo, ScopedKeys } from './Modelling';

type TabId = 'walk' | 'scenarios' | 'model';

const TAG_TONE: Record<StepTag, Tone> = { problem: 'bad', technique: 'accent', tradeoff: 'warn', failure: 'bad', case: 'info', recap: 'ok' };
const SHARES = [0.005, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4];

const HINTS: Record<string, string> = {
  'pick-startup': 'Scenarios tab: load “Seed-stage B2B SaaS” and pick a strategy.',
  'pick-bank': 'Scenarios tab: the contract mentions dedicated databases.',
  'pick-hybrid': 'Scenarios tab: 3 tenants are each ~15% of all traffic.',
  'noisy-neighbour': 'Scenarios tab: predict the spike, then fix it without a database for every tenant.',
  'scoped-keys': 'Modelling tab: every key and index should start with tenant_id.',
};

function summary(s: Strategy, i: Inputs, spike: boolean): ChangeLine[] {
  const m = metrics(s, i);
  const lines: ChangeLine[] = [
    { tone: 'info', text: `**${stratName(s)}**: ${fmtN(i.tenants)} tenants on ${fmtN(m.servers)} database server${m.servers > 1 ? 's' : ''} · ${fmtUSD(m.costPerTenant)} per tenant per month` },
    { tone: m.isolation.level === 3 ? 'ok' : 'warn', text: `Isolation: ${m.isolation.text}.` },
  ];
  if (spike) lines.push({ tone: m.noisy.tone === 'bad' ? 'bad' : m.noisy.tone === 'warn' ? 'warn' : 'ok', text: `Whale 1 at 5×: ${m.noisy.text}.` });
  if (m.compliance.tone === 'bad') lines.push({ tone: 'bad', text: `Compliance: ${m.compliance.text}.` });
  return lines;
}

function spikeLines(s: Strategy, i: Inputs, on: boolean): ChangeLine[] {
  const host = placement(s, i).find((b) => b.whales.includes(0))!;
  const m = metrics(s, i);
  if (!on) return [{ tone: 'ok', text: `Whale 1 back to normal: ${host.label} at ${Math.round(host.u * 100)}%, p99 ${fmtMs(host.p99)}.` }];
  return [
    { tone: host.uSpike >= 0.95 ? 'bad' : 'warn', text: `\`${host.label}\` utilisation ${Math.round(host.u * 100)}% → **${Math.round(host.uSpike * 100)}%** · p99 ${fmtMs(host.p99)} → **${fmtMs(host.p99Spike)}**` },
    m.noisy.affected
      ? { tone: 'bad', text: `**${fmtN(m.noisy.affected)} co-located tenants** pay for a spike they didn’t cause.` }
      : host.kind === 'silo'
        ? { tone: 'ok', text: 'No co-located tenants: the blast radius is the whale itself. Size its database for its peak or rate-limit it.' }
        : { tone: 'ok', text: 'The whale is too small to saturate its shard: neighbours barely notice.' },
  ];
}

export default function TenancyLab({ topic }: { topic: LabTopic }) {
  const exercises = useDm((s) => s.topics[topic.id]?.exercises);
  const recordPrediction = useDm((s) => s.recordPrediction);
  const markExercise = useDm((s) => s.markExercise);

  const [tab, setTab] = useState<TabId>('walk');
  const stepper = useStepper(STEPS.length, { intervalMs: 9000 });
  const step = stepper.step;
  const st = STEPS[step];

  const [strategy, setStrategy] = useState<Strategy>(STEPS[0].strategy);
  const [inputs, setInputs] = useState<Inputs>(STEPS[0].inputs);
  const [spike, setSpike] = useState(false);
  const [free, setFree] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [change, setChange] = useState<Change>({ key: 'init', title: `Step 1 · ${STEPS[0].title}`, lines: summary(STEPS[0].strategy, STEPS[0].inputs, false) });
  const [scenario, setScenario] = useState<ScenarioId | 'noisy' | null>(null);
  const [noisyAns, setNoisyAns] = useState<number | undefined>();
  const [lastPick, setLastPick] = useState<{ id: ScenarioId; s: Strategy } | null>(null);

  const cur = useRef({ strategy, inputs });
  cur.current = { strategy, inputs };

  const walkGated = tab === 'walk' && !free && !!st.predict && answers[step] === undefined;
  const noisyGated = tab === 'scenarios' && scenario === 'noisy' && noisyAns === undefined;
  const gated = walkGated || noisyGated;

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const s = STEPS[step];
    const p = cur.current;
    const changed = p.strategy !== s.strategy || !sameInputs(p.inputs, s.inputs);
    setFree(false);
    setStrategy(s.strategy);
    setInputs(s.inputs);
    setSpike(!!s.spike);
    setChange({
      key: `step-${step}-${Date.now()}`,
      title: `Step ${step + 1} · ${s.title}`,
      lines: changed ? [...(sameInputs(p.inputs, s.inputs) ? [] : [{ tone: 'info' as const, text: describeInputs(p.inputs, s.inputs).join(' · ') }]), ...diff(p.strategy, p.inputs, s.strategy, s.inputs).slice(0, 4), ...(s.spike ? spikeLines(s.strategy, s.inputs, true).slice(0, 2) : [])] : summary(s.strategy, s.inputs, !!s.spike),
    });
    if (s.predict && answers[step] === undefined) stepper.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const m = useMemo(() => metrics(strategy, inputs), [strategy, inputs]);
  const flagList = useMemo(() => getFlags(strategy, inputs, m), [strategy, inputs, m]);

  const tryNoisyFix = (s: Strategy, i: Inputs, sp: boolean, lines: ChangeLine[]) => {
    if (scenario !== 'noisy' || noisyAns === undefined || !sp || !sameInputs(i, NOISY_INPUTS)) return;
    const mm = metrics(s, i);
    if (mm.noisy.affected === 0 && s === 'silo') lines.unshift({ tone: 'warn', text: `Contained, but at ${fmtUSD(mm.costPerTenant)}/tenant and ${fmtN(mm.migrations)} migrations per release. Find a fix that keeps the tail pooled.` });
    else if (mm.noisy.affected === 0 && !exercises?.['noisy-neighbour']) {
      markExercise(topic.id, 'noisy-neighbour');
      lines.unshift({ tone: 'ok', text: `**Exercise solved:** the spike is contained to the whale at ${fmtUSD(mm.costPerTenant)}/tenant.` });
    }
  };

  const chooseStrategy = (s: Strategy, from?: ScenarioId) => {
    if (gated) return;
    const prev = strategy;
    const lines = s === prev ? summary(s, inputs, spike) : diff(prev, inputs, s, inputs);
    if (spike && s !== prev) lines.push(...spikeLines(s, inputs, true).slice(0, 2));
    const sc = SCENARIOS.find((x) => x.id === (from ?? scenario));
    if (sc && sameInputs(inputs, sc.inputs)) {
      setLastPick({ id: sc.id, s });
      if (s === sc.answer) {
        if (!exercises?.[sc.id]) {
          markExercise(topic.id, sc.id);
          lines.unshift({ tone: 'ok', text: `**Exercise solved:** ${sc.title} → ${stratName(s)}.` });
        }
      } else lines.unshift({ tone: 'bad', text: `Not the best fit for “${sc.title}”: ${whyPick(s, inputs)}` });
    }
    tryNoisyFix(s, inputs, spike, lines);
    setStrategy(s);
    if (tab === 'walk') setFree(true);
    setChange({ key: `s-${Date.now()}`, title: s === prev ? `Kept **${stratName(s)}**` : `Strategy ${stratName(prev)} → **${stratName(s)}**`, lines });
  };

  const changeInputs = (patch: Partial<Inputs>) => {
    if (gated) return;
    const next = clampInputs({ ...inputs, ...patch });
    if (sameInputs(next, inputs)) return;
    const lines = diff(strategy, inputs, strategy, next);
    if (spike) lines.push(...spikeLines(strategy, next, true).slice(0, 1));
    setInputs(next);
    if (tab === 'walk') setFree(true);
    setLastPick(null);
    setChange({ key: `i-${Date.now()}`, title: describeInputs(inputs, next).join(' · '), lines });
  };

  const toggleSpike = () => {
    if (gated) return;
    const on = !spike;
    setSpike(on);
    const lines = spikeLines(strategy, inputs, on);
    if (on) tryNoisyFix(strategy, inputs, on, lines);
    setChange({ key: `sp-${Date.now()}`, title: on ? 'Whale 1 spikes to **5×** its normal load' : 'Spike over', lines });
  };

  const loadScenario = (id: ScenarioId | 'noisy') => {
    const sc = SCENARIOS.find((x) => x.id === id);
    const nextInputs = sc ? sc.inputs : NOISY_INPUTS;
    const nextStrategy: Strategy = sc ? strategy : 'pool';
    setScenario(id);
    setLastPick(null);
    setInputs(nextInputs);
    setStrategy(nextStrategy);
    setSpike(false);
    if (id === 'noisy') setNoisyAns(undefined);
    setChange({
      key: `sc-${id}-${Date.now()}`,
      title: `Loaded scenario: **${sc ? sc.title : 'Noisy neighbour'}**`,
      lines: [{ tone: 'info', text: describeInputs(inputs, nextInputs).join(' · ') || 'Same inputs as before.' }, ...(sc ? [{ tone: 'info' as const, text: 'Pick the strategy that fits. The table below compares all four.' }] : [{ tone: 'info' as const, text: 'Pool, 3 whales on 3 shards. Predict the spike first.' }])],
    });
  };

  const answerNoisy = (i: number, right: boolean) => {
    setNoisyAns(i);
    recordPrediction(topic.id, 'noisy-spike', right);
    setSpike(true);
    setChange({ key: `nn-${Date.now()}`, title: 'Whale 1 spikes to **5×** under pool', lines: [...spikeLines('pool', NOISY_INPUTS, true), { tone: 'info', text: 'Now fix it: change the strategy so no small tenant is hit, without siloing everyone.' }] });
  };

  const answerStep = (i: number, right: boolean) => {
    setAnswers((a) => ({ ...a, [step]: i }));
    recordPrediction(topic.id, `step-${step}`, right);
  };

  const done = topic.exercises.filter((e) => exercises?.[e.id]).length;
  const tIdx = Math.max(0, TENANT_STEPS.indexOf(inputs.tenants));
  const shareOpts = SHARES.filter((x) => x <= maxShare(inputs.whales));
  const sIdx = Math.max(0, shareOpts.findIndex((x) => x >= inputs.share - 1e-9));

  return (
    <div className="flex h-full min-h-0">
      {/* ───────── left ───────── */}
      <aside className="flex w-[400px] shrink-0 flex-col border-r border-line bg-paper">
        <div className="flex border-b border-line">
          {(
            [
              ['walk', 'Walkthrough', BookOpen],
              ['scenarios', 'Scenarios', Target],
              ['model', 'Modelling', Database],
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
              {st.predict && <PredictCard key={step} predict={st.predict} answered={answers[step]} onAnswer={answerStep} />}
              {!walkGated && st.keyIdea && (
                <Callout tone="tip" title="Key idea">
                  <span className="text-[12.5px]">
                    <Rich text={st.keyIdea} />
                  </span>
                </Callout>
              )}
              {!walkGated && st.underHood && (
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
                  <span>Exploring freely: the picture shows your settings, not the step’s.</span>
                  <Button
                    size="xs"
                    variant="ghost"
                    icon={<Undo2 size={12} />}
                    onClick={() => {
                      setFree(false);
                      setStrategy(st.strategy);
                      setInputs(st.inputs);
                      setSpike(!!st.spike);
                      setChange({ key: `back-${Date.now()}`, title: `Back to step ${step + 1}`, lines: diff(strategy, inputs, st.strategy, st.inputs) });
                    }}
                  >
                    step setup
                  </Button>
                </div>
              )}
            </div>
            <div className="border-t border-line p-3">
              <StepControls stepper={stepper} speeds={[0.5, 1, 2]} caption={walkGated ? 'answer the prediction to reveal' : `${stratName(strategy)} · ${fmtUSD(m.costPerTenant)}/tenant`} />
            </div>
          </>
        )}

        {tab === 'scenarios' && (
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            <p className="text-[13px] leading-relaxed text-muted">Load a scenario, read the brief, then pick a strategy. The visual and comparison table update as you choose.</p>
            {SCENARIOS.map((sc) => {
              const active = scenario === sc.id;
              const ok = !!exercises?.[sc.id];
              const stale = active && !sameInputs(inputs, sc.inputs);
              return (
                <div key={sc.id} className={cn('rounded-xl border p-3', active ? 'border-accent/60 bg-accent/[0.04]' : 'border-line bg-surface')}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-mono text-[12.5px] font-semibold text-ink">
                      {ok ? <CheckCircle2 size={14} className="text-ok" /> : <Circle size={14} className="text-faint" />}
                      {sc.title}
                    </div>
                    <Button size="xs" variant={active ? 'ghost' : 'secondary'} icon={<RotateCcw size={11} />} onClick={() => loadScenario(sc.id)}>
                      {active ? 'reload' : 'load'}
                    </Button>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{sc.brief}</p>
                  {active && (
                    <div className="mt-2">
                      <div className="eyebrow mb-1">your pick</div>
                      <div className="grid grid-cols-4 gap-1">
                        {STRATEGIES.map((s) => (
                          <button
                            key={s.id}
                            disabled={stale}
                            onClick={() => chooseStrategy(s.id, sc.id)}
                            className={cn(
                              'rounded-md border px-1.5 py-1 font-mono text-[11px] transition-colors disabled:opacity-40',
                              lastPick?.id === sc.id && lastPick.s === s.id ? (s.id === sc.answer ? 'border-ok bg-ok/10 text-ok' : 'border-bad bg-bad/10 text-bad') : 'border-line bg-surface text-muted hover:border-accent/50',
                            )}
                          >
                            {s.name}
                          </button>
                        ))}
                      </div>
                      {stale && <p className="mt-1 text-[11px] text-warn">Inputs changed since loading: reload to answer.</p>}
                      {lastPick?.id === sc.id && (
                        <p className={cn('mt-1.5 text-[12px] leading-relaxed', lastPick.s === sc.answer ? 'text-muted' : 'text-bad')}>
                          <Rich text={whyPick(lastPick.s, sc.inputs)} />
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div className={cn('rounded-xl border p-3', scenario === 'noisy' ? 'border-accent/60 bg-accent/[0.04]' : 'border-line bg-surface')}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-mono text-[12.5px] font-semibold text-ink">
                  {exercises?.['noisy-neighbour'] ? <CheckCircle2 size={14} className="text-ok" /> : <Circle size={14} className="text-faint" />}
                  Noisy neighbour
                </div>
                <Button size="xs" variant={scenario === 'noisy' ? 'ghost' : 'secondary'} icon={<RotateCcw size={11} />} onClick={() => loadScenario('noisy')}>
                  {scenario === 'noisy' ? 'reload' : 'load'}
                </Button>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">10,000 tenants pooled on 3 shards; 3 whales at 15% each. Month-end: whale 1 runs at 5×.</p>
              {scenario === 'noisy' && (
                <div className="mt-2 space-y-2">
                  <PredictCard predict={NOISY_PREDICT} answered={noisyAns} onAnswer={answerNoisy} />
                  {noisyAns !== undefined && (
                    <p className="text-[12px] text-ink">
                      <Rich text={exercises?.['noisy-neighbour'] ? '**Fixed.** The tail is pooled and only the whale feels its own spike.' : '**Your move:** change the strategy (keep the spike on) so that no small tenant is hit, without giving all 10,000 tenants a database.'} />
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'model' && (
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            <p className="text-[13px] leading-relaxed text-muted">The strategy is the deployment; the schema is what makes tenant isolation provable. In a pool, every rule below is load-bearing.</p>
            {MODEL_NOTES.map((n) => (
              <div key={n.title} className="rounded-xl border border-line bg-surface p-3">
                <div className="font-mono text-[12.5px] font-semibold text-ink">{n.title}</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                  <Rich text={n.body} />
                </p>
                {n.code && <CodeBlock className="mt-2" language="sql" code={n.code} />}
              </div>
            ))}
            <Callout tone="bad" title="Red flag: EAV for every custom field">
              <span className="text-[12.5px]">Each read pivots N rows per entity, values lose types and constraints. Fix: a typed JSONB column with a field-definition table; promote hot fields to real columns.</span>
            </Callout>
          </div>
        )}
      </aside>

      {/* ───────── centre ───────── */}
      <main className="min-w-0 flex-1 overflow-y-auto bg-sunken/60 p-4">
        {tab !== 'model' ? (
          <div className="space-y-3">
            <div className="grid gap-2.5 rounded-xl border border-line bg-paper p-3">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <div className="eyebrow mb-1">Strategy</div>
                  <div className="flex gap-1">
                    {STRATEGIES.map((s) => (
                      <button
                        key={s.id}
                        disabled={gated}
                        onClick={() => s.id !== strategy && chooseStrategy(s.id)}
                        className={cn(
                          'rounded-md border px-2 py-1 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                          strategy === s.id ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:border-accent/50',
                        )}
                      >
                        <div className="font-mono text-[11.5px] font-semibold text-ink">{s.name}</div>
                        <div className="text-[10px] text-faint">{s.short}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <Button size="sm" variant={spike ? 'danger' : 'secondary'} icon={<Zap size={13} />} disabled={gated} onClick={toggleSpike}>
                  {spike ? 'Whale 1 at 5×' : 'Spike whale 1 (5×)'}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-x-5 gap-y-2">
                <Slider label="Tenants" value={fmtN(inputs.tenants)} min={0} max={TENANT_STEPS.length - 1} idx={tIdx} disabled={gated} onChange={(v) => changeInputs({ tenants: TENANT_STEPS[v] })} />
                <Slider label="Each whale’s share of load" value={`${inputs.whales} × ${shareLabel(inputs.share)}`} min={0} max={shareOpts.length - 1} idx={sIdx} disabled={gated} onChange={(v) => changeInputs({ share: shareOpts[v] })} />
                <Seg label="Whales" value={inputs.whales} opts={[1, 2, 3]} disabled={gated} onPick={(w) => changeInputs({ whales: w })} />
                <div className="flex gap-4">
                  <Seg<Compliance> label="Compliance" value={inputs.compliance} opts={['none', 'residency', 'isolation']} disabled={gated} onPick={(c) => changeInputs({ compliance: c })} />
                  <Seg<Custom> label="Per-tenant schema" value={inputs.custom} opts={['none', 'some', 'heavy']} disabled={gated} onPick={(c) => changeInputs({ custom: c })} />
                </div>
              </div>
            </div>

            <div className="relative rounded-xl border border-line bg-paper p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="eyebrow">
                  {stratName(strategy)} · {fmtN(inputs.tenants)} tenants · {fmtN(m.servers)} database server{m.servers > 1 ? 's' : ''}
                  {inputs.compliance !== 'none' && strategy !== 'silo' ? ' · 3 regional cells' : ''}
                </div>
                <span className="font-mono text-[11px] text-muted">{gated ? '?' : `${fmtUSD(m.costMonth)}/mo`}</span>
              </div>
              <div className={cn('transition', gated && 'pointer-events-none blur-[1.5px]')}>
                <Packing strategy={strategy} inputs={inputs} spike={spike && !gated} gated={gated} />
              </div>
              {gated && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex items-center gap-1.5 rounded-lg border border-accent/50 bg-paper px-3 py-2 font-mono text-[12px] text-accent shadow-paper">
                    <Lock size={13} /> Predict first (left panel)
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="eyebrow mb-1">All four strategies at these inputs (click a row to switch)</div>
              <Compare current={strategy} inputs={inputs} spike={spike} gated={gated} onPick={(s) => s !== strategy && chooseStrategy(s)} />
            </div>

            <details className="rounded-xl border border-line bg-surface p-3">
              <summary className="cursor-pointer font-mono text-[12px] font-semibold text-ink">Under the hood · how the engines behave & model assumptions</summary>
              <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-muted">
                {UNDER_HOOD.map((u) => (
                  <li key={u} className="flex gap-1.5">
                    <span className="text-faint">·</span>
                    <span>
                      <Rich text={u} />
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ) : (
          <div className="space-y-3">
            <RlsDemo onChange={setChange} />
            <ScopedKeys onChange={setChange} solved={!!exercises?.['scoped-keys']} onSolved={() => markExercise(topic.id, 'scoped-keys')} />
          </div>
        )}
      </main>

      {/* ───────── right ───────── */}
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

        {tab !== 'model' && (
          <>
            <div>
              <div className="eyebrow mb-1">{stratName(strategy)} at these inputs</div>
              <div className="grid grid-cols-3 gap-1.5">
                <Metric k="$/tenant·mo" v={gated ? '?' : fmtUSD(m.costPerTenant)} tone={m.costPerTenant > 50 ? 'bad' : m.costPerTenant > 5 ? 'warn' : 'ok'} />
                <Metric k="db servers" v={fmtN(m.servers)} />
                <Metric k="migrations" v={`${fmtN(m.migrations)}×`} tone={m.migrations > 1000 ? 'bad' : m.migrations > 100 ? 'warn' : undefined} />
                <Metric k="conn. pools" v={fmtN(m.pools)} tone={m.pools > 2000 ? 'bad' : undefined} />
                <Metric k="pg_class/srv" v={fmtN(m.catalogRels)} tone={m.catalogRels > 100_000 ? 'bad' : m.catalogRels > 10_000 ? 'warn' : undefined} />
                <Metric k="migrate time" v={fmtH(m.migrationHours)} />
              </div>
            </div>
            <ul className="space-y-1 rounded-xl border border-line bg-surface p-2.5 text-[12px]">
              {(
                [
                  ['isolation', m.isolation],
                  ['noisy neighbour', gated ? { tone: 'warn', text: '?' } : m.noisy],
                  ['restore one tenant', m.backup],
                  ['cross-tenant analytics', m.analytics],
                  ['compliance', m.compliance],
                  ['customization', m.custom],
                ] as const
              ).map(([k, v]) => (
                <li key={k} className="flex gap-1.5">
                  <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', v.tone === 'ok' ? 'bg-ok' : v.tone === 'warn' ? 'bg-warn' : 'bg-bad')} />
                  <span>
                    <span className="font-mono text-[11px] text-faint">{k}: </span>
                    <span className="text-muted">
                      <Rich text={v.text} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {!gated &&
              flagList.map((f) => (
                <Callout key={f.title} tone="bad" title={f.title}>
                  <span className="text-[12px]">
                    <Rich text={f.body} /> <strong className="text-ink">Fix:</strong> <Rich text={f.fix} />
                  </span>
                </Callout>
              ))}
          </>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <div className="eyebrow flex items-center gap-1">
              <FlaskConical size={11} /> Exercises
            </div>
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
        </div>
      </aside>
    </div>
  );
}

function Metric({ k, v, tone }: { k: string; v: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-2.5 py-2">
      <div className="eyebrow !text-[9.5px]">{k}</div>
      <div className={cn('font-mono text-[15px] font-semibold', tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-ink')}>{v}</div>
    </div>
  );
}

function Slider({ label, value, min, max, idx, disabled, onChange }: { label: string; value: string; min: number; max: number; idx: number; disabled: boolean; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">{label}</span>
        <span className="font-mono text-[12px] font-semibold text-ink">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={1} value={idx} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-[rgb(var(--c-accent))] disabled:opacity-50" />
    </label>
  );
}

function Seg<T extends string | number>({ label, value, opts, disabled, onPick }: { label: string; value: T; opts: T[]; disabled: boolean; onPick: (v: T) => void }) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div className="flex gap-1">
        {opts.map((o) => (
          <button
            key={String(o)}
            disabled={disabled}
            onClick={() => o !== value && onPick(o)}
            className={cn('rounded-md border px-2 py-0.5 font-mono text-[11px] disabled:opacity-50', value === o ? 'border-accent bg-accent/10 text-ink' : 'border-line bg-surface text-muted hover:border-accent/50')}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
