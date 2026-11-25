import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, CheckCircle2, HelpCircle, Repeat, XCircle } from 'lucide-react';
import { Button, Callout, CodeBlock, StepControls, useStepper } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { CodeLine, Frame, Prediction, TraceResult } from '../engine/types';
import { VizView } from '../viz/VizView';
import { shuffle } from './common';

const isLoop = (l: CodeLine) => /^\s*(for|while)\b/.test(l.text);
const isBranch = (l: CodeLine) => /^\s*(?:}\s*)?(if|elif|else|while|for)\b/.test(l.text);

/** loop key → iteration count at step, resetting inner loops each time the enclosing loop advances. */
function loopCounts(frames: Frame[], step: number, lines: CodeLine[]) {
  const loopLines = lines.filter((l) => l.key && isLoop(l));
  const byKey = new Map(loopLines.map((l) => [l.key!, l]));
  // inner loops of each loop: following loop lines with deeper indent until the block ends
  const inner = new Map<string, string[]>();
  for (const l of loopLines) {
    const out: string[] = [];
    for (let k = l.index + 1; k < lines.length; k++) {
      const x = lines[k];
      if (x.text.trim() && x.indent <= l.indent) break;
      if (x.key && byKey.has(x.key)) out.push(x.key);
    }
    inner.set(l.key!, out);
  }
  const counts: Record<string, number> = {};
  for (let i = 0; i <= step && i < frames.length; i++) {
    const k = frames[i].line;
    if (!k || !byKey.has(k)) continue;
    counts[k] = (counts[k] ?? 0) + 1;
    for (const c of inner.get(k) ?? []) counts[c] = 0;
  }
  return { counts, byKey };
}

interface Q extends Prediction {
  auto?: boolean;
}

export interface VisualizerProps {
  lines: CodeLine[];
  trace: TraceResult;
  explain?: Record<string, string>;
  predictMode: boolean;
  lineQuiz: boolean;
  onPrediction?: (correct: boolean) => void;
  onFinish?: () => void;
  /** Extra content under the code column (e.g. input editor). */
  codeFooter?: React.ReactNode;
  /** Prism language of `lines` (default python). */
  language?: string;
  /** Extra controls in the code panel's title bar (e.g. language switch). */
  codeActions?: React.ReactNode;
}

export function Visualizer({ lines, trace, explain, predictMode, lineQuiz, onPrediction, onFinish, codeFooter, language, codeActions }: VisualizerProps) {
  const { frames } = trace;
  const s = useStepper(frames.length, { intervalMs: 1100 });
  const frame = frames[Math.min(s.step, frames.length - 1)];
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const lineIdx = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) if (l.key && !m.has(l.key)) m.set(l.key, l.index);
    return m;
  }, [lines]);

  // reset quiz state whenever a new trace is loaded
  useEffect(() => {
    setAnswers({});
    s.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace]);

  const questions = useMemo(() => {
    const qs: Record<number, Q> = {};
    if (!predictMode) return qs;
    frames.forEach((f, i) => {
      if (f.predict) qs[i] = f.predict;
      else if (lineQuiz && i < frames.length - 1 && f.line) {
        const cur = lines[lineIdx.get(f.line) ?? -1];
        const nxtKey = frames[i + 1].line;
        if (!cur || !isBranch(cur) || !nxtKey) return;
        const nxt = lines[lineIdx.get(nxtKey) ?? -1];
        if (!nxt) return;
        const others = shuffle(
          lines.filter((l) => l.key && l.key !== nxtKey && l.text.trim()),
          i * 7 + 3,
        ).slice(0, 2);
        const opts = shuffle([nxt, ...others], i * 13 + 1);
        qs[i] = {
          auto: true,
          question: `The condition on line ${cur.index + 1} was just evaluated. Which line runs next?`,
          options: opts.map((l) => `L${l.index + 1}: ${l.text.trim()}`),
          answer: opts.indexOf(nxt),
          why: frames[i + 1].note,
        };
      }
    });
    return qs;
  }, [frames, predictMode, lineQuiz, lines, lineIdx]);

  const gate = useMemo(() => {
    for (const k of Object.keys(questions).map(Number).sort((a, b) => a - b)) {
      if (k < s.step && answers[k] === undefined) return k;
    }
    return -1;
  }, [questions, answers, s.step]);

  // predict-before-reveal: you can't move past an unanswered question
  useEffect(() => {
    if (gate >= 0) {
      s.pause();
      s.goTo(gate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate]);

  const q = questions[s.step];
  const pendingQ = q && answers[s.step] === undefined;
  useEffect(() => {
    if (pendingQ && s.playing) s.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQ, s.playing]);

  const finished = useRef(false);
  useEffect(() => {
    finished.current = false;
  }, [trace]);
  useEffect(() => {
    if (frames.length && s.step === frames.length - 1 && !finished.current) {
      finished.current = true;
      onFinish?.();
    }
  }, [s.step, frames.length, onFinish]);

  const { counts, byKey } = useMemo(() => loopCounts(frames, s.step, lines), [frames, s.step, lines]);
  const prevVars = frames[s.step - 1]?.vars ?? {};

  if (!frames.length) {
    return (
      <Callout tone="bad" title="Nothing to show">
        {trace.error ?? 'This input produced no steps.'}
      </Callout>
    );
  }

  const curLine = frame.line ? lineIdx.get(frame.line) : undefined;
  const annotations: Record<number, string> = {};
  for (const [k, n] of Object.entries(counts)) {
    const l = byKey.get(k);
    if (l && n > 0) annotations[l.index + 1] = `↻ ${n}`;
  }
  const explanation = frame.line ? explain?.[frame.line] : undefined;
  const atEnd = s.step === frames.length - 1;
  const answered = q ? answers[s.step] : undefined;

  const answer = (i: number) => {
    if (!q) return;
    setAnswers((a) => ({ ...a, [s.step]: i }));
    if (i >= 0) onPrediction?.(i === q.answer);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="min-w-0 space-y-3">
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-paper">
          <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
            <span className="eyebrow">solution</span>
            <div className="flex items-center gap-2">
              {codeActions}
              <span className="font-mono text-[11px] text-faint">
                step {s.step + 1}/{frames.length}
              </span>
            </div>
          </div>
          <CodeBlock
            code={lines.map((l) => l.text).join('\n')}
            language={language}
            highlightLines={curLine !== undefined ? [curLine + 1] : []}
            annotations={annotations}
            className="max-h-[28rem] overflow-auto text-[12.5px]"
          />
        </div>
        {explanation && (
          <div className="rounded-lg border border-line bg-sunken/50 px-3 py-2 text-xs leading-relaxed text-muted">
            <span className="mr-1 font-semibold text-ink">Why this line:</span>
            {explanation}
          </div>
        )}
        <WatchPanel vars={frame.vars} prev={prevVars} counts={counts} />
        {codeFooter}
      </div>

      <div className="min-w-0 space-y-3">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={s.step}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm leading-relaxed text-ink"
          >
            {frame.note}
          </motion.div>
        </AnimatePresence>

        {q && (
          <PredictCard q={q} answered={answered} onAnswer={answer} onContinue={() => s.next()} last={atEnd} />
        )}

        <div className={cn('rounded-xl border border-line bg-paper p-3 transition', pendingQ && 'blur-[3px] saturate-50')}>
          <VizView viz={frame.viz} />
        </div>

        {atEnd && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ok/40 bg-ok/10 px-4 py-2 font-mono text-sm">
            <CheckCircle2 className="h-4 w-4 text-ok" />
            <span className="text-muted">returns</span>
            <span className="font-semibold text-ink">{trace.result ?? 'None'}</span>
          </div>
        )}
        {trace.truncated && (
          <Callout tone="warn" title="Trace cut short">
            This input produces more than 600 steps, so only the beginning is shown. Try a smaller input to see the whole run.
          </Callout>
        )}
        {trace.error && <Callout tone="bad" title="The run stopped with an error">{trace.error}</Callout>}

        <StepControls stepper={s} />
      </div>
    </div>
  );
}

function PredictCard({
  q,
  answered,
  onAnswer,
  onContinue,
  last,
}: {
  q: Q;
  answered: number | undefined;
  onAnswer: (i: number) => void;
  onContinue: () => void;
  last: boolean;
}) {
  const done = answered !== undefined;
  const right = answered === q.answer;
  return (
    <motion.div
      initial={{ scale: 0.98, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={cn(
        'rounded-xl border-2 p-4 shadow-lift',
        !done ? 'border-violet/50 bg-violet/5' : right ? 'border-ok/50 bg-ok/5' : 'border-bad/40 bg-bad/5',
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
        {q.auto ? <HelpCircle className="h-4 w-4 text-violet" /> : <Brain className="h-4 w-4 text-violet" />}
        {done ? (right ? 'Nice — you predicted it.' : 'Not quite — compare with what actually happens:') : 'Predict before you look'}
      </div>
      <p className="mb-3 text-sm text-ink">{q.question}</p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {q.options.map((o, i) => {
          const isAns = i === q.answer;
          const picked = answered === i;
          return (
            <button
              key={i}
              disabled={done}
              onClick={() => onAnswer(i)}
              className={cn(
                'flex items-start gap-2 rounded-lg border px-3 py-2 text-left font-mono text-xs transition',
                !done && 'border-line bg-surface hover:border-violet hover:bg-violet/5',
                done && isAns && 'border-ok bg-ok/10 text-ink',
                done && picked && !isAns && 'border-bad bg-bad/10 text-ink',
                done && !isAns && !picked && 'border-line/60 text-faint',
              )}
            >
              {done && isAns && <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-ok" />}
              {done && picked && !isAns && <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-bad" />}
              <span>{o}</span>
            </button>
          );
        })}
      </div>
      {done && <p className="mt-3 text-sm leading-relaxed text-muted">{q.why}</p>}
      <div className="mt-3 flex justify-end gap-2">
        {!done && (
          <Button size="xs" variant="ghost" onClick={() => onAnswer(-1)}>
            skip
          </Button>
        )}
        {done && !last && (
          <Button size="sm" variant="primary" onClick={onContinue}>
            See what happens →
          </Button>
        )}
      </div>
    </motion.div>
  );
}

function WatchPanel({ vars, prev, counts }: { vars: Record<string, string>; prev: Record<string, string>; counts: Record<string, number> }) {
  const entries = Object.entries(vars);
  const loops = Object.entries(counts).filter(([, n]) => n > 0);
  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-paper">
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow">watch</span>
        {loops.length > 0 && (
          <span className="flex items-center gap-2 font-mono text-[11px] text-muted">
            <Repeat className="h-3 w-3" />
            {loops.map(([k, n]) => (
              <span key={k}>
                {k}:<b className="text-accent">{n}</b>
              </span>
            ))}
          </span>
        )}
      </div>
      {!entries.length ? (
        <div className="text-xs text-faint">no variables yet</div>
      ) : (
        <table className="w-full font-mono text-xs">
          <tbody>
            {entries.map(([k, v]) => {
              const changed = prev[k] !== undefined && prev[k] !== v;
              const fresh = prev[k] === undefined;
              return (
                <tr key={k} className="border-t border-line/50 first:border-t-0">
                  <td className="w-1/3 py-1 pr-2 align-top text-muted">{k}</td>
                  <td className="py-1">
                    <motion.span
                      key={v}
                      initial={changed || fresh ? { backgroundColor: 'rgb(var(--c-accent) / 0.25)' } : false}
                      animate={{ backgroundColor: 'rgb(var(--c-accent) / 0)' }}
                      transition={{ duration: 1.2 }}
                      className={cn('break-all rounded px-1', changed ? 'text-accent' : 'text-ink')}
                    >
                      {v}
                    </motion.span>
                    {changed && <span className="ml-2 text-[10px] text-faint line-through">{prev[k]}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
