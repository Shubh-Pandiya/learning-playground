import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Circle, Cpu, Flag, Lock } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Callout, StepControls, Tag, useStepper, type Stepper } from '@/shared/ui';
import { useDm } from '../../store';
import type { LabTopic } from '../../types';
import { ChangeCard, type Change, type ChangeLine } from '../../ui/ChangeCard';
import { PredictCard } from '../../ui/Predict';
import { Rich } from '../../ui/Rich';
import type { LabStep, StepTag } from './data';

const TAG_TONE: Record<StepTag, 'bad' | 'accent' | 'warn' | 'ok'> = { problem: 'bad', technique: 'accent', tradeoff: 'warn', failure: 'bad', recap: 'ok' };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Walkthrough + design state for one lesson tab.
 * Entering a step applies its preset, unless the step has an unanswered prediction: then the
 * visual stays frozen on the current design until the user commits to a guess.
 */
export function useLab<S, E>(opts: {
  topic: LabTopic;
  tab: string;
  steps: LabStep<S>[];
  evaluate: (s: S) => E;
  diff: (a: E, b: E) => ChangeLine[];
}) {
  const { topic, tab, steps, evaluate, diff } = opts;
  const recordPrediction = useDm((s) => s.recordPrediction);
  const stepper = useStepper(steps.length, { intervalMs: 12000 });
  const step = stepper.step;
  const st = steps[step];
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [state, setState] = useState<S>(() => steps[0].preset as S);
  const [source, setSource] = useState<'step' | 'user'>('step');
  const [changes, setChanges] = useState<Change[]>([]);
  const [stepChanges, setStepChanges] = useState<Record<number, Change>>({});
  const ref = useRef(state);
  ref.current = state;
  const revealed = !st.predict || answers[step] !== undefined;

  // consecutive drags of the same slider collapse into one change card (diffed from where the drag started)
  const burst = useRef<{ title: string; at: number; base: S; key: string } | null>(null);
  const commit = useCallback(
    (next: S, title: string, src: 'step' | 'user', merge = false) => {
      const now = Date.now();
      const b = burst.current;
      const cont = merge && b !== null && b.title === title && now - b.at < 1500;
      const base = cont ? b.base : ref.current;
      const key = cont ? b.key : `${now}-${Math.random().toString(36).slice(2, 7)}`;
      burst.current = merge ? { title, at: now, base, key } : null;
      const ch: Change = { key, title, lines: diff(evaluate(base), evaluate(next)) };
      ref.current = next;
      setState(next);
      setSource(src);
      setChanges((c) => (cont && c[0]?.key === key ? [ch, ...c.slice(1)] : [ch, ...c].slice(0, 14)));
      return ch;
    },
    [diff, evaluate],
  );

  useEffect(() => {
    if (!revealed) {
      // frozen on the design the prediction is about: the previous step's result
      const prev = steps.slice(0, step).reverse().find((x) => x.preset)?.preset;
      if (prev && !same(prev, ref.current)) commit(prev, `Set-up for step ${step + 1}`, 'step');
      return;
    }
    if (!st.preset || same(st.preset, ref.current)) return;
    const ch = commit(st.preset, `Step ${step + 1} · ${st.title}`, 'step');
    setStepChanges((m) => ({ ...m, [step]: ch }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, revealed]);

  useEffect(() => {
    if (stepper.playing && !revealed) stepper.pause();
  }, [stepper, revealed]);

  const answer = (i: number, right: boolean) => {
    setAnswers((a) => ({ ...a, [step]: i }));
    recordPrediction(topic.id, `${tab}-${st.id}`, right);
  };

  /** `merge`: slider drags; repeated calls with the same title within 1.5 s update one change card. */
  const change = (next: S, title: string, merge = false) => {
    if (same(next, ref.current)) return;
    commit(next, title, 'user', merge);
  };

  const ev = useMemo(() => evaluate(state), [evaluate, state]);
  return { stepper, step, st, state, ev, source, revealed, answers, answer, change, changes, stepChange: stepChanges[step] };
}

/** Marks an exercise the moment the user's own design satisfies it. */
export function useExercise(topic: LabTopic, id: string, solved: boolean, byUser: boolean) {
  const done = useDm((s) => !!s.topics[topic.id]?.exercises?.[id]);
  const mark = useDm((s) => s.markExercise);
  useEffect(() => {
    if (solved && byUser && !done) mark(topic.id, id);
  }, [solved, byUser, done, mark, topic.id, id]);
  return done;
}

export function Walkthrough<S>({
  steps,
  stepper,
  answers,
  onAnswer,
  stepChange,
  active,
  notes,
  extra,
}: {
  steps: LabStep<S>[];
  stepper: Stepper;
  answers: Record<number, number>;
  onAnswer: (i: number, right: boolean) => void;
  stepChange?: Change;
  active: boolean;
  notes: { title: string; body: string }[];
  extra?: ReactNode;
}) {
  const step = stepper.step;
  const st = steps[step];
  const answered = answers[step];
  const revealed = !st.predict || answered !== undefined;
  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-r border-line bg-paper">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <div className="flex flex-wrap gap-1">
          {steps.map((s, i) => (
            <button
              key={s.id}
              onClick={() => {
                stepper.pause();
                stepper.goTo(i);
              }}
              title={s.title}
              className={cn(
                'h-6 min-w-6 rounded border px-1.5 font-mono text-[10.5px] tabular-nums transition-colors',
                i === step ? 'border-ink bg-ink text-paper' : answers[i] !== undefined || i < step ? 'border-line bg-surface text-muted' : 'border-line text-faint hover:text-ink',
              )}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Tag size="sm" tone={TAG_TONE[st.tag]}>
            {st.tag}
          </Tag>
          <span className="font-mono text-[11px] text-faint">
            step {step + 1} / {steps.length}
          </span>
        </div>
        <h2 className="font-mono text-[17px] font-semibold leading-snug text-ink">{st.title}</h2>
        <div className="space-y-2.5 text-[13.5px] leading-relaxed text-muted">
          {st.body.map((b, i) => (
            <p key={i}>
              <Rich text={b} />
            </p>
          ))}
        </div>
        {st.predict && <PredictCard key={`${st.id}`} predict={st.predict} answered={answered} onAnswer={onAnswer} />}
        {revealed && st.keyIdea && (
          <Callout tone="tip" title="Key idea">
            <span className="text-[12.5px]">
              <Rich text={st.keyIdea} />
            </span>
          </Callout>
        )}
        {revealed && stepChange && (
          <div>
            <div className="eyebrow mb-1">What this step changed</div>
            <ChangeCard change={stepChange} />
          </div>
        )}
        {extra}
        <details className="group rounded-xl border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-muted hover:text-ink">
            <Cpu size={13} className="text-violet" /> Under the hood
            <span className="ml-auto text-faint group-open:hidden">show</span>
          </summary>
          <div className="space-y-2.5 border-t border-line px-3 py-2.5">
            {notes.map((n) => (
              <div key={n.title}>
                <div className="font-mono text-[11.5px] font-semibold text-ink">{n.title}</div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
                  <Rich text={n.body} />
                </p>
              </div>
            ))}
          </div>
        </details>
      </div>
      <div className="border-t border-line p-3">
        <StepControls stepper={stepper} speeds={[0.5, 1, 2]} keyboard={active} caption={!revealed ? <span className="text-accent">Answer the prediction to apply this step.</span> : undefined} />
      </div>
    </aside>
  );
}

export function LatestChange({ changes }: { changes: Change[] }) {
  const latest = changes[0];
  return (
    <div className="border-b border-line p-3">
      <div className="eyebrow mb-1.5">What changed · impact</div>
      <AnimatePresence mode="wait" initial={false}>
        {latest ? (
          <motion.div key={latest.key} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.2 }} className="max-h-[260px] overflow-y-auto">
            <ChangeCard change={latest} className="border-accent/40" />
          </motion.div>
        ) : (
          <p className="text-[12px] text-faint">Change a key or slider: the impact on every access pattern shows up here.</p>
        )}
      </AnimatePresence>
    </div>
  );
}

export function History({ changes }: { changes: Change[] }) {
  if (changes.length < 2) return null;
  return (
    <section>
      <div className="eyebrow mb-1.5">Earlier changes</div>
      <div className="space-y-1.5">
        {changes.slice(1, 7).map((c) => (
          <ChangeCard key={c.key} change={c} compact className="opacity-80" />
        ))}
      </div>
    </section>
  );
}

export interface Opt {
  id: string;
  label: string;
  sub?: string;
}

export function OptionGroup({ title, value, options, onPick, locked }: { title: string; value: string; options: Opt[]; onPick: (id: string) => void; locked?: boolean }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 font-mono text-[11px] font-semibold text-ink">
        {title}
        {locked && <Lock size={11} className="text-faint" />}
      </div>
      <div className="grid gap-1">
        {options.map((o) => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              disabled={locked}
              onClick={() => onPick(o.id)}
              className={cn(
                'flex items-start gap-1.5 rounded-lg border px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed',
                on ? 'border-accent/60 bg-accent/[0.08]' : 'border-line bg-surface hover:border-ink/30',
                locked && !on && 'opacity-50',
              )}
            >
              <span className={cn('mt-[3px] h-2.5 w-2.5 shrink-0 rounded-full border', on ? 'border-accent bg-accent' : 'border-line')} />
              <span className="min-w-0">
                <span className="block break-all font-mono text-[11px] leading-snug text-ink">{o.label}</span>
                {o.sub && <span className="block text-[10.5px] text-faint">{o.sub}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RedFlags({ flags }: { flags: { title: string; why: string; fix?: string }[] }) {
  if (!flags.length) return null;
  return (
    <section className="space-y-2">
      <div className="eyebrow">Red flags</div>
      {flags.map((f) => (
        <Callout key={f.title} tone="bad" title={<Rich text={f.title} />}>
          <span className="text-[12px]">
            <Rich text={f.why} />
          </span>
          {f.fix && (
            <span className="mt-1 block text-[12px] text-ink">
              <span className="font-semibold text-ok">Instead: </span>
              <Rich text={f.fix} />
            </span>
          )}
        </Callout>
      ))}
    </section>
  );
}

export function Exercises({ topic, items }: { topic: LabTopic; items: { id: string; hint: string; status?: string }[] }) {
  const done = useDm((s) => s.topics[topic.id]?.exercises) ?? {};
  return (
    <section>
      <div className="eyebrow mb-1.5 flex items-center gap-1.5">
        <Flag size={11} /> Exercises
      </div>
      <div className="space-y-1.5">
        {items.map((it) => {
          const ex = topic.exercises.find((e) => e.id === it.id);
          const ok = !!done[it.id];
          return (
            <div key={it.id} className={cn('rounded-xl border p-2.5', ok ? 'border-ok/40 bg-ok/[0.06]' : 'border-line bg-surface')}>
              <div className="flex items-start gap-1.5">
                <motion.span key={String(ok)} initial={ok ? { scale: 0.4 } : false} animate={{ scale: 1 }} className="mt-px shrink-0">
                  {ok ? <CheckCircle2 size={14} className="text-ok" /> : <Circle size={14} className="text-faint" />}
                </motion.span>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium leading-snug text-ink">{ex?.title ?? it.id}</div>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
                    <Rich text={ok ? 'Solved.' : it.hint} />
                  </p>
                  {!ok && it.status && <p className="mt-0.5 font-mono text-[10.5px] text-faint">{it.status}</p>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type T = 'ok' | 'warn' | 'bad' | 'neutral' | 'info';
const TONE: Record<T, string> = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', neutral: 'text-ink', info: 'text-info' };

export function Metric({ label, value, sub, tone = 'neutral', className }: { label: string; value: ReactNode; sub?: ReactNode; tone?: T; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-line bg-surface px-2.5 py-2', className)}>
      <div className="eyebrow !text-[9.5px]">{label}</div>
      <div className={cn('mt-0.5 font-mono text-[15px] font-semibold leading-tight transition-colors', TONE[tone])}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-muted">{sub}</div>}
    </div>
  );
}

export function FrozenBadge({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none sticky top-2 z-20 mx-auto w-fit rounded-lg border border-accent/50 bg-surface/95 px-3 py-1.5 font-mono text-[11px] text-accent shadow-paper"
        >
          ← make a prediction to play this step (visual frozen)
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Log-scale slider: value in [min, max], position in [0, 1000]. */
export function LogSlider({ label, value, min, max, onChange, format, disabled }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; format: (v: number) => string; disabled?: boolean }) {
  const lmin = Math.log10(min);
  const lmax = Math.log10(max);
  const pos = ((Math.log10(Math.max(min, value)) - lmin) / (lmax - lmin)) * 1000;
  return (
    <label className="block min-w-0 flex-1">
      <div className="mb-1 flex items-baseline justify-between font-mono text-[11px] text-muted">
        <span>{label}</span>
        <span className="tabular-nums text-ink">{format(value)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1000}
        disabled={disabled}
        value={pos}
        onChange={(e) => {
          const v = Math.pow(10, lmin + (Number(e.target.value) / 1000) * (lmax - lmin));
          const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1));
          onChange(Math.max(min, Math.min(max, Math.round(v / mag) * mag)));
        }}
        className="h-1 w-full cursor-pointer accent-[rgb(var(--c-accent))] disabled:cursor-not-allowed"
      />
    </label>
  );
}
