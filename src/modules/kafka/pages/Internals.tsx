import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock, Cpu, Lock, Target, XCircle } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { DIVES, diveById } from '../data/internals';
import { LESSONS } from '../data/lessons';
import { useKafka } from '../store';
import { DiveViz } from '../ui/DiveViz';
import { PageBar } from '../ui/PageBar';
import { Rich } from '../ui/Rich';

export function InternalsHome() {
  const dives = useKafka((s) => s.dives);
  return (
    <div className="flex h-full flex-col">
      <PageBar eyebrow="How it’s actually built" title="Kafka internals" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <p className="max-w-3xl text-[13px] leading-relaxed text-muted">
            Using Kafka well needs a mental model of its machinery. Each deep dive steps through one mechanism frame by frame with a small animation. You predict what happens before you see it. Then come the design decisions behind it and the interview answer.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DIVES.map((d, i) => {
              const st = dives[d.id];
              const usedIn = LESSONS.filter((l) => l.deepDives.includes(d.id));
              return (
                <Link key={d.id} to={`/kafka/internals/${d.id}`} className="group flex flex-col rounded-xl border border-line bg-surface p-4 shadow-paper transition hover:-translate-y-0.5 hover:shadow-lift">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet/10 font-mono text-[12px] text-violet">{i + 1}</span>
                    <span className="ml-auto flex items-center gap-1 font-mono text-[11px] text-faint">
                      <Clock size={11} /> {d.minutes} min
                    </span>
                    {st?.done && <CheckCircle2 size={15} className="text-ok" />}
                  </div>
                  <h3 className="mt-2 font-mono text-[14px] font-semibold">{d.title}</h3>
                  <p className="mt-1 flex-1 text-[12.5px] text-muted">{d.tagline}</p>
                  <div className="mt-3 flex items-center justify-between text-[11px] text-faint">
                    <span>{d.frames.length} frames · {d.frames.filter((f) => f.predict).length} predictions</span>
                    {usedIn.length > 0 && <span>Lesson {usedIn.map((l) => l.n).join(', ')}</span>}
                  </div>
                  {st && !st.done && st.frame > 0 && (
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink/10">
                      <div className="h-full bg-violet" style={{ width: `${((st.frame + 1) / d.frames.length) * 100}%` }} />
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DivePage() {
  const { id } = useParams();
  const dive = diveById(id);
  const st = useKafka();
  const saved = id ? st.dives[id] : undefined;
  const [i, setI] = useState(saved && !saved.done ? Math.min(saved.frame, (dive?.frames.length ?? 1) - 1) : 0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [end, setEnd] = useState(false);
  const [shown, setShown] = useState<Record<number, boolean>>({});
  useEffect(() => {
    if (dive) st.visit({ id: dive.id, mode: 'dive', path: `/kafka/internals/${dive.id}`, label: `Internals · ${dive.title}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dive?.id]);
  useEffect(() => {
    if (dive) st.setDive(dive.id, i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);
  if (!dive) return <Navigate to="/kafka/internals" replace />;
  const f = dive.frames[i];
  const ans = answers[i];
  const waiting = !!f.predict && ans === undefined;
  const pick = (k: number) => {
    if (!f.predict || ans !== undefined) return;
    setAnswers((a) => ({ ...a, [i]: k }));
    const right = k === f.predict.answer;
    st.recordPredict(right);
    st.grade(`d:${dive.id}:${i}`, right ? 2 : 0);
  };
  const idx = DIVES.findIndex((d) => d.id === dive.id);
  const next = DIVES[idx + 1];

  return (
    <div className="flex h-full flex-col">
      <PageBar back="/kafka/internals" backLabel="Internals" eyebrow={`Deep dive · ${dive.minutes} min`} title={dive.title} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <div className="rounded-xl border border-violet/30 bg-violet/5 px-4 py-2.5 text-[12.5px] leading-relaxed">
            <span className="eyebrow mr-2 text-violet">The one-liner</span>
            <Rich text={dive.oneLiner} />
          </div>

          {!end ? (
            <>
              <div className="mt-5 flex gap-1">
                {dive.frames.map((fr, k) => (
                  <button key={k} title={fr.title} onClick={() => setI(k)} className={cn('h-1.5 flex-1 rounded-full', k < i ? 'bg-violet' : k === i ? 'bg-violet/60' : 'bg-ink/10')} />
                ))}
              </div>
              <div className="mt-4">
                <div className="eyebrow">
                  Frame {i + 1} / {dive.frames.length}
                </div>
                <h2 className="mt-0.5 font-mono text-lg font-semibold">{f.title}</h2>
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink/90">
                  <Rich text={f.body} />
                </p>
              </div>

              {f.predict && (
                <div className={cn('mt-4 rounded-xl border p-3.5', waiting ? 'border-accent bg-accent/5' : 'border-line bg-surface')}>
                  <div className="eyebrow flex items-center gap-1 text-accent-ink">
                    <Target size={11} /> Predict first
                  </div>
                  <p className="mt-1 text-[13px] font-medium">
                    <Rich text={f.predict.q} />
                  </p>
                  <div className="mt-2 grid gap-1.5">
                    {f.predict.options.map((o, k) => {
                      const isAns = k === f.predict!.answer;
                      return (
                        <button
                          key={k}
                          disabled={ans !== undefined}
                          onClick={() => pick(k)}
                          className={cn(
                            'flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12.5px]',
                            ans === undefined && 'border-line bg-surface hover:border-accent',
                            ans !== undefined && isAns && 'border-ok/50 bg-ok/10',
                            ans === k && !isAns && 'border-bad/50 bg-bad/10',
                            ans !== undefined && !isAns && ans !== k && 'border-line opacity-50',
                          )}
                        >
                          <span className="font-mono text-[11px] text-faint">{String.fromCharCode(65 + k)}</span>
                          <span className="flex-1">
                            <Rich text={o} />
                          </span>
                          {ans !== undefined && isAns && <CheckCircle2 size={14} className="text-ok" />}
                          {ans === k && !isAns && <XCircle size={14} className="text-bad" />}
                        </button>
                      );
                    })}
                  </div>
                  {ans !== undefined && (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                      <Rich text={f.predict.explain} />
                    </p>
                  )}
                </div>
              )}

              <div className="relative mt-4 rounded-xl border border-line bg-surface p-4 shadow-paper">
                <div className={cn('transition', waiting && 'pointer-events-none select-none blur-sm')}>
                  <DiveViz key={`${dive.id}:${i}`} viz={f.viz} />
                </div>
                {waiting && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[12px] text-muted shadow-paper">
                      <Lock size={12} /> Commit to a prediction to reveal
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2">
                <Button size="sm" variant="ghost" disabled={i === 0} icon={<ArrowLeft size={13} />} onClick={() => setI(i - 1)}>
                  Back
                </Button>
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={waiting}
                  onClick={() => {
                    if (i < dive.frames.length - 1) setI(i + 1);
                    else {
                      st.setDive(dive.id, i, true);
                      setEnd(true);
                    }
                  }}
                >
                  {waiting ? 'Predict first' : i < dive.frames.length - 1 ? 'Next frame' : 'Design decisions & interview'} <ArrowRight size={13} className="ml-1" />
                </Button>
              </div>
            </>
          ) : (
            <div className="mt-5 space-y-5">
              <div>
                <div className="eyebrow mb-2 flex items-center gap-1">
                  <Cpu size={11} /> Why it’s designed this way
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {dive.design.map((d, k) => (
                    <div key={k} className="rounded-xl border border-line bg-surface p-3">
                      <div className="text-[13px] font-semibold">
                        <Rich text={d.decision} />
                      </div>
                      <div className="mt-1 text-[12.5px] text-muted">
                        <Rich text={d.because} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="eyebrow mb-2">Interview · answer out loud, then compare</div>
                <div className="space-y-2">
                  {dive.interview.map((q, k) => (
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
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" icon={<ArrowLeft size={13} />} onClick={() => (setEnd(false), setI(0))}>
                  Replay frames
                </Button>
                <span className="flex items-center gap-1 text-[12px] text-ok">
                  <Check size={13} /> Predictions added to your review deck
                </span>
                {next && (
                  <Link to={`/kafka/internals/${next.id}`} className="ml-auto">
                    <Button size="sm">
                      Next: {next.title} <ArrowRight size={13} className="ml-1" />
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
