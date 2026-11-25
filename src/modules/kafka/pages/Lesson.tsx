import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, Cpu, Eye, Lightbulb, PartyPopper, RotateCcw, Target, XCircle } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout } from '@/shared/ui';
import { applyOps, describeOp, type Lesson, type Scenario } from '../data/lesson';
import { lessonById, LESSONS } from '../data/lessons';
import { diveById } from '../data/internals';
import { check } from '../engine/check';
import { emptyLesson, useKafka, type Mode } from '../store';
import { NO_CHAOS, type KGraph } from '../types';
import { PageBar } from '../ui/PageBar';
import { QuizCard } from '../ui/Quiz';
import { Reqs } from '../ui/Reqs';
import { Rich } from '../ui/Rich';
import { useLab } from '../ui/useLab';
import { Workbench } from '../ui/Workbench';

type View = Mode | 'recap';
const MODES: { id: View; label: string }[] = [
  { id: 'learn', label: 'Learn' },
  { id: 'build', label: 'Build' },
  { id: 'challenge', label: 'Challenge' },
  { id: 'recap', label: 'Recap & quiz' },
];

export function LessonPage() {
  const { id = '', mode = 'learn' } = useParams();
  const lesson = lessonById(id);
  const p = useKafka((s) => s.lessons[id]) ?? emptyLesson();
  const visit = useKafka((s) => s.visit);
  useEffect(() => {
    if (lesson) visit({ id, mode: mode === 'recap' ? 'learn' : (mode as Mode), path: `/kafka/l/${id}/${mode}`, label: `${lesson.n}. ${lesson.title} · ${mode}` });
  }, [id, mode, lesson, visit]);
  if (!lesson) return <Navigate to="/kafka" replace />;
  const done: Record<View, boolean> = { learn: p.learnDone, build: p.buildSolved, challenge: p.challengeSolved, recap: lesson.quiz.every((_, i) => !!useKafka.getState().cards[`q:${id}:${i}`]) };
  return (
    <div className="flex h-full flex-col">
      <PageBar eyebrow={`Lesson ${lesson.n} of ${LESSONS.length}`} title={lesson.title}>
        <div className="flex rounded-lg bg-sunken p-0.5">
          {MODES.map((m) => (
            <Link
              key={m.id}
              to={`/kafka/l/${id}/${m.id}`}
              className={cn('flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium', mode === m.id ? 'bg-surface text-ink shadow-paper' : 'text-muted hover:text-ink')}
            >
              {done[m.id] && <Check size={12} className="text-ok" />}
              {m.label}
            </Link>
          ))}
        </div>
      </PageBar>
      <div className="min-h-0 flex-1">
        {mode === 'learn' && <LearnView key={id} lesson={lesson} />}
        {(mode === 'build' || mode === 'challenge') && <ScenarioView key={`${id}:${mode}`} lesson={lesson} mode={mode} s={mode === 'build' ? lesson.build : lesson.challenge} />}
        {mode === 'recap' && <Recap key={id} lesson={lesson} />}
      </div>
    </div>
  );
}

/* ---------------- Learn: worked example with predict-before-reveal ---------------- */

const graphAt = (l: Lesson, i: number) => l.learn.slice(0, i).reduce((g, s) => applyOps(g, s.ops), l.stage);

function LearnView({ lesson }: { lesson: Lesson }) {
  const nav = useNavigate();
  const st = useKafka();
  const start = Math.min(st.lessons[lesson.id]?.learnStep ?? 0, lesson.learn.length - 1);
  const [i, setI] = useState(start);
  const [answer, setAnswer] = useState<number | null>(null);
  const lab = useLab(graphAt(lesson, start));
  const first = useRef(true);
  const step = lesson.learn[i];
  const names = (x: string) => lab.names[x] ?? x;

  const reveal = (g: KGraph) => {
    if (step.ops?.length) lab.commit(applyOps(g, step.ops), step.ops.map((o) => describeOp(g, o, names)).join(' · '), step.internals, 'lesson');
    const want = { ...NO_CHAOS, ...(step.chaos ?? {}) };
    if (JSON.stringify(want) !== JSON.stringify(lab.chaos)) lab.setChaos(want, step.chaos ? `Failure injected: ${step.title}` : 'Failures cleared', undefined);
  };

  // Arriving on a step: apply its change right away unless it asks for a prediction first.
  useEffect(() => {
    setAnswer(null);
    st.setLearnStep(lesson.id, i);
    if (first.current) {
      first.current = false;
      lab.reset(graphAt(lesson, i));
    }
    if (!step.predict) reveal(lab.g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  const jump = (to: number) => {
    lab.reset(graphAt(lesson, to));
    setI(to);
  };
  const pick = (k: number) => {
    if (answer !== null || !step.predict) return;
    setAnswer(k);
    const right = k === step.predict.answer;
    st.recordPrediction(lesson.id, i, right);
    st.grade(`p:${lesson.id}:${i}`, right ? 2 : 0);
    reveal(lab.g);
  };
  const waiting = !!step.predict && answer === null;
  const last = i === lesson.learn.length - 1;

  const left = (
    <div className="space-y-3">
      <div>
        <div className="eyebrow">Why this matters</div>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          <Rich text={lesson.problem} />
        </p>
      </div>
      <div className="flex gap-1">
        {lesson.learn.map((s, k) => (
          <button key={k} onClick={() => jump(k)} title={s.title} className={cn('h-1.5 flex-1 rounded-full', k < i ? 'bg-accent' : k === i ? 'bg-accent/60' : 'bg-ink/10')} />
        ))}
      </div>
      <div>
        <div className="eyebrow">
          Step {i + 1} / {lesson.learn.length}
        </div>
        <h3 className="mt-0.5 font-mono text-[14px] font-semibold leading-snug">{step.title}</h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink/90">
          <Rich text={step.body} />
        </p>
      </div>
      {step.predict && (
        <div className={cn('rounded-xl border p-2.5', waiting ? 'border-accent bg-accent/5' : 'border-line bg-surface')}>
          <div className="eyebrow flex items-center gap-1 text-accent-ink">
            <Target size={11} /> Predict before you see it
          </div>
          <p className="mt-1 text-[12.5px] font-medium leading-snug">
            <Rich text={step.predict.q} />
          </p>
          <div className="mt-2 grid gap-1">
            {step.predict.options.map((o, k) => {
              const isAns = k === step.predict!.answer;
              return (
                <button
                  key={k}
                  disabled={answer !== null}
                  onClick={() => pick(k)}
                  className={cn(
                    'flex items-start gap-1.5 rounded-lg border px-2 py-1 text-left text-[12px] leading-snug',
                    answer === null && 'border-line bg-surface hover:border-accent',
                    answer !== null && isAns && 'border-ok/50 bg-ok/10',
                    answer === k && !isAns && 'border-bad/50 bg-bad/10',
                    answer !== null && !isAns && answer !== k && 'border-line opacity-50',
                  )}
                >
                  <span className="font-mono text-[10.5px] text-faint">{String.fromCharCode(65 + k)}</span>
                  <span className="flex-1">
                    <Rich text={o} />
                  </span>
                  {answer !== null && isAns && <CheckCircle2 size={13} className="shrink-0 text-ok" />}
                  {answer === k && !isAns && <XCircle size={13} className="shrink-0 text-bad" />}
                </button>
              );
            })}
          </div>
          {answer !== null && (
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              <b className={answer === step.predict.answer ? 'text-ok' : 'text-bad'}>{answer === step.predict.answer ? 'Right. ' : 'Watch the canvas. '}</b>
              <Rich text={step.predict.explain} />
            </p>
          )}
        </div>
      )}
      {step.internals && !waiting && (
        <div className="rounded-xl border border-violet/30 bg-violet/5 p-2.5 text-[12px] leading-relaxed">
          <div className="eyebrow mb-0.5 flex items-center gap-1 text-violet">
            <Cpu size={11} /> How it’s built
          </div>
          <Rich text={step.internals} />
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" disabled={i === 0} icon={<ArrowLeft size={13} />} onClick={() => jump(i - 1)}>
          Back
        </Button>
        {!last ? (
          <Button size="sm" disabled={waiting} onClick={() => setI(i + 1)} className="ml-auto">
            {waiting ? 'Predict first' : 'Next'} <ArrowRight size={13} className="ml-1" />
          </Button>
        ) : (
          <Button
            size="sm"
            variant="success"
            disabled={waiting}
            className="ml-auto"
            onClick={() => {
              st.completeLearn(lesson.id);
              nav(`/kafka/l/${lesson.id}/build`);
            }}
          >
            Done · try the Build <ArrowRight size={13} className="ml-1" />
          </Button>
        )}
      </div>
      <p className="text-[11px] leading-snug text-faint">Tinker freely: click any node to change its config and watch the Impact tab. Use chaos to break it.</p>
    </div>
  );

  return <Workbench lab={lab} left={left} focus={waiting ? undefined : step.focus} fitKey={`${lesson.id}:${i}`} onPredict={st.recordChaos} defaultTab="impact" />;
}

/* ---------------- Build / Challenge: faded → from scratch ---------------- */

function ScenarioView({ lesson, mode, s }: { lesson: Lesson; mode: 'build' | 'challenge'; s: Scenario }) {
  const key = `${lesson.id}:${mode}`;
  const st = useKafka();
  const saved = st.canvases[key];
  const lab = useLab(saved ?? s.start, { onChange: (g) => st.saveCanvas(key, g) });
  const res = useMemo(() => check(s.reqs, lab.g), [s.reqs, lab.g]);
  const [hints, setHints] = useState(0);
  const [celebrate, setCelebrate] = useState(false);
  const prog = st.lessons[lesson.id] ?? emptyLesson();
  const solved = mode === 'build' ? prog.buildSolved : prog.challengeSolved;
  const prevDone = useRef(res.done);

  useEffect(() => {
    if (!lab.log.length) return;
    st.recordResult(lesson.id, mode, Math.round(res.closeness * 100), res.done);
    if (res.done && !prevDone.current) setCelebrate(true);
    prevDone.current = res.done;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res.done, res.closeness]);

  const left = (
    <div className="space-y-3">
      <div>
        <div className="eyebrow">{mode === 'build' ? 'Scenario · fix it' : 'Transfer challenge · new domain'}</div>
        <h2 className="mt-1 font-mono text-[14.5px] font-semibold leading-snug">{s.title}</h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          <Rich text={s.story} />
        </p>
      </div>
      {mode === 'challenge' && !prog.buildSolved && (
        <Callout tone="tip">
          <span className="text-[12px]">Tip: solve the Build first. Same concept, different problem; transferring it is the point.</span>
        </Callout>
      )}
      <Reqs reqs={s.reqs} res={res} showWhy={hints > 0} />
      <div className="rounded-lg border border-line bg-surface p-2.5">
        <div className="flex items-center justify-between">
          <span className="eyebrow flex items-center gap-1">
            <Lightbulb size={11} /> Stuck?
          </span>
          <div className="flex gap-1">
            <Button
              size="xs"
              variant="secondary"
              disabled={hints >= 3}
              onClick={() => {
                setHints((h) => h + 1);
                st.addHint(lesson.id);
              }}
            >
              {hints === 0 ? 'Hint' : hints < 3 ? 'Stronger hint' : 'No more hints'}
            </Button>
          </div>
        </div>
        {s.hints.slice(0, hints).map((h, k) => (
          <p key={k} className="mt-1.5 text-[12px] leading-relaxed text-muted">
            <span className="font-mono text-[10.5px] text-faint">{k + 1}.</span> <Rich text={h} />
          </p>
        ))}
        {hints >= 3 && (
          <Button size="xs" variant="ghost" className="mt-1.5" icon={<Eye size={12} />} onClick={() => lab.commit(s.reference, 'Loaded the reference design', 'Compare it with what you had. The impact rows show exactly what the reference changes.', 'lesson')}>
            Show reference design
          </Button>
        )}
      </div>
      <Button size="xs" variant="ghost" icon={<RotateCcw size={12} />} onClick={() => (lab.reset(s.start), st.clearCanvas(key))}>
        Start over
      </Button>
    </div>
  );

  const overlay =
    celebrate || (solved && res.done) ? (
      <div className="absolute inset-x-0 bottom-20 z-10 flex justify-center px-4">
        <div className="max-w-[640px] rounded-xl border border-ok/40 bg-surface px-4 py-3 shadow-lift">
          <div className="flex items-start gap-3">
            <PartyPopper className="mt-0.5 shrink-0 text-ok" size={22} />
            <div className="min-w-0">
              <p className="font-mono text-sm font-semibold text-ok">All requirements met</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                <Rich text={s.debrief} />
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link to={`/kafka/l/${lesson.id}/${mode === 'build' ? 'challenge' : 'recap'}`}>
                  <Button size="xs">{mode === 'build' ? 'Transfer it: Challenge →' : 'Recap & quiz →'}</Button>
                </Link>
                <Button size="xs" variant="ghost" onClick={() => setCelebrate(false)}>
                  Now break it with chaos
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    ) : null;

  return <Workbench lab={lab} left={left} palette={s.palette} overlay={celebrate ? overlay : null} onPredict={st.recordChaos} fitKey={key} />;
}

/* ---------------- Recap: retrieval + interview ---------------- */

function Recap({ lesson }: { lesson: Lesson }) {
  const grade = useKafka((s) => s.grade);
  const [shown, setShown] = useState<Record<number, boolean>>({});
  const next = LESSONS.find((l) => l.n === lesson.n + 1);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-5xl gap-6 px-6 py-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <div>
            <div className="eyebrow">Retrieval practice</div>
            <h2 className="mt-1 font-mono text-lg font-semibold">Answer from memory, then rate your confidence</h2>
            <p className="mt-1 text-[12.5px] text-muted">Each answer schedules a spaced-review card. Grading “Guessed” brings it back sooner.</p>
          </div>
          {lesson.quiz.map((q, k) => (
            <QuizCard key={k} item={{ id: `q:${lesson.id}:${k}`, q: q.q, options: q.options, answer: q.answer, why: q.explain }} onGraded={(g) => grade(`q:${lesson.id}:${k}`, g)} />
          ))}
          <div>
            <div className="eyebrow mb-2">Interview questions · say your answer out loud first</div>
            <div className="space-y-2">
              {lesson.interview.map((q, k) => (
                <div key={k} className="rounded-xl border border-line bg-surface p-3">
                  <p className="text-[13px] font-medium">
                    <Rich text={q.q} />
                  </p>
                  {shown[k] ? (
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                      <Rich text={q.a} />
                    </p>
                  ) : (
                    <Button size="xs" variant="secondary" className="mt-2" onClick={() => setShown((s) => ({ ...s, [k]: true }))}>
                      Reveal a strong answer
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        <aside className="space-y-4">
          <div className="rounded-xl border border-line bg-surface p-3.5">
            <div className="eyebrow mb-1.5">Takeaways</div>
            <ul className="space-y-1.5 text-[12.5px] leading-snug">
              {lesson.takeaways.map((t, k) => (
                <li key={k} className="flex gap-1.5">
                  <Check size={13} className="mt-0.5 shrink-0 text-ok" />
                  <span>
                    <Rich text={t} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {lesson.deepDives.length > 0 && (
            <div className="rounded-xl border border-line bg-surface p-3.5">
              <div className="eyebrow mb-1.5">Go deeper: how it’s built</div>
              {lesson.deepDives.map((d) => {
                const dv = diveById(d);
                return dv ? (
                  <Link key={d} to={`/kafka/internals/${d}`} className="block rounded-lg px-2 py-1.5 hover:bg-sunken">
                    <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
                      <BookOpen size={12} className="text-violet" /> {dv.title}
                    </div>
                    <div className="text-[11.5px] text-muted">{dv.tagline}</div>
                  </Link>
                ) : null;
              })}
            </div>
          )}
          {next && (
            <Link to={`/kafka/l/${next.id}/learn`} className="block rounded-xl border border-accent/40 bg-accent/5 p-3.5 hover:shadow-paper">
              <div className="eyebrow">Next lesson</div>
              <div className="font-mono text-[13.5px] font-semibold">
                {next.n}. {next.title}
              </div>
              <div className="text-[12px] text-muted">{next.tagline}</div>
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}
