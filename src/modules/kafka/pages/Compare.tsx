import { useMemo, useState } from 'react';
import { Ban, RotateCcw } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { DIMENSIONS, PICKER, SYSTEMS, WHEN_NOT } from '../data/compare';
import { PageBar } from '../ui/PageBar';
import { Rich } from '../ui/Rich';

const DOTS = ['bg-ink/10', 'bg-bad/60', 'bg-warn/70', 'bg-ok'];

export function ComparePage() {
  const [sys, setSys] = useState(SYSTEMS[0].id);
  const [picks, setPicks] = useState<Record<number, number>>({});
  const scores = useMemo(() => {
    const t: Record<string, number> = Object.fromEntries(SYSTEMS.map((s) => [s.id, 0]));
    Object.entries(picks).forEach(([q, o]) => Object.entries(PICKER[+q].options[o].weights).forEach(([k, w]) => (t[k] += w ?? 0)));
    return SYSTEMS.map((s) => ({ s, v: t[s.id] })).sort((a, b) => b.v - a.v);
  }, [picks]);
  const answered = Object.keys(picks).length;
  const max = Math.max(1, ...scores.map((x) => x.v));
  const cur = SYSTEMS.find((s) => s.id === sys)!;
  return (
    <div className="flex h-full flex-col">
      <PageBar eyebrow="Engineering judgment" title="Kafka vs RabbitMQ, SQS, Kinesis, Pulsar" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-8 px-6 py-6">
          <section>
            <h2 className="font-mono text-[15px] font-semibold">Trade-off matrix</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">No system wins every row. Hover a row for the reasoning; click a column for how it works.</p>
            <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line">
                    <th className="px-3 py-2 text-left font-normal text-faint">dimension</th>
                    {SYSTEMS.map((s) => (
                      <th key={s.id} className="px-2 py-2">
                        <button onClick={() => setSys(s.id)} className={cn('rounded-md px-2 py-0.5 font-mono text-[12px] font-semibold', sys === s.id ? 'bg-accent text-white' : 'hover:bg-sunken')}>
                          {s.name.replace('Apache ', '').replace('Amazon ', '')}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DIMENSIONS.map((d) => (
                    <tr key={d.label} title={d.note} className="group border-b border-line/60 last:border-0 hover:bg-sunken">
                      <td className="px-3 py-2">
                        <div className="font-medium">{d.label}</div>
                        <div className="hidden text-[11.5px] text-muted group-hover:block">{d.note}</div>
                      </td>
                      {SYSTEMS.map((s) => (
                        <td key={s.id} className={cn('px-2 py-2', sys === s.id && 'bg-accent/5')}>
                          <div className="flex justify-center gap-0.5">
                            {[1, 2, 3].map((k) => (
                              <i key={k} className={cn('h-2.5 w-2.5 rounded-full', k <= d.scores[s.id] ? DOTS[d.scores[s.id]] : 'bg-ink/10')} />
                            ))}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 grid gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-2">
              <div>
                <div className="font-mono text-[14px] font-semibold">{cur.name}</div>
                <p className="mt-1 text-[12.5px] leading-relaxed">
                  <Rich text={cur.model} />
                </p>
                <p className="mt-2 text-[12px] text-muted">
                  <b className="text-violet">How it’s built: </b>
                  <Rich text={cur.internals} />
                </p>
              </div>
              <div className="space-y-2 text-[12.5px]">
                <p>
                  <b className="text-ok">Best for: </b>
                  <Rich text={cur.bestFor} />
                </p>
                <p>
                  <b className="text-bad">Avoid when: </b>
                  <Rich text={cur.avoidWhen} />
                </p>
              </div>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-mono text-[15px] font-semibold">Which one for my system?</h2>
                {answered > 0 && (
                  <Button size="xs" variant="ghost" icon={<RotateCcw size={11} />} onClick={() => setPicks({})}>
                    reset
                  </Button>
                )}
              </div>
              <p className="mt-0.5 text-[12.5px] text-muted">Answer the questions a senior engineer would ask before picking a broker.</p>
              <div className="mt-3 space-y-3">
                {PICKER.map((q, i) => (
                  <div key={i} className="rounded-xl border border-line bg-surface p-3">
                    <div className="text-[13px] font-medium">
                      <Rich text={q.q} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {q.options.map((o, k) => (
                        <button key={k} onClick={() => setPicks((p) => ({ ...p, [i]: k }))} className={cn('rounded-lg border px-2.5 py-1 text-[12px]', picks[i] === k ? 'border-accent bg-accent/10 font-medium' : 'border-line hover:border-accent')}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="lg:sticky lg:top-4 lg:self-start">
              <div className="rounded-xl border border-line bg-surface p-4">
                <div className="eyebrow">Fit · {answered}/{PICKER.length} answered</div>
                <div className="mt-2 space-y-2">
                  {scores.map(({ s, v }, i) => (
                    <div key={s.id}>
                      <div className="flex justify-between text-[12.5px]">
                        <span className={cn(i === 0 && answered > 0 && 'font-semibold')}>{s.name}</span>
                        <span className="font-mono text-faint">{v}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
                        <div className={cn('h-full transition-all', i === 0 && answered > 0 ? 'bg-accent' : 'bg-ink/30')} style={{ width: `${(v / max) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                {answered === PICKER.length && (
                  <p className="mt-3 text-[12px] leading-relaxed text-muted">
                    Leaning <b className="text-ink">{scores[0].s.name}</b>. {scores[0].s.bestFor}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section>
            <h2 className="flex items-center gap-2 font-mono text-[15px] font-semibold">
              <Ban size={15} className="text-bad" /> When NOT to use Kafka
            </h2>
            <p className="mt-0.5 text-[12.5px] text-muted">Saying no to the shiny tool is a senior skill. Interviewers listen for it.</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {WHEN_NOT.map((w, i) => (
                <div key={i} className="rounded-xl border border-line bg-surface p-3">
                  <div className="text-[13px] font-medium">
                    <Rich text={w.situation} />
                  </div>
                  <div className="mt-1 text-[12.5px]">
                    <span className="text-ok">→ </span>
                    <b>
                      <Rich text={w.instead} />
                    </b>
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    <Rich text={w.why} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
