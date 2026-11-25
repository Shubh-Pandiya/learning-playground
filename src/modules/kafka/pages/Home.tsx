import { Link } from 'react-router-dom';
import { ArrowRight, Brain, CalendarClock, Cpu, FlaskConical, GraduationCap, Scale, Siren, Target } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, ProgressBar, Tag } from '@/shared/ui';
import { DIVES } from '../data/internals';
import { LESSONS } from '../data/lessons';
import { dueCards, isMastered, useKafka, type LessonProgress } from '../store';

function Pip({ on, label, title }: { on: boolean; label: string; title: string }) {
  return (
    <span title={title} className={cn('grid h-5 w-5 place-items-center rounded font-mono text-[10px] font-semibold', on ? 'bg-ok text-paper' : 'border border-line text-faint')}>
      {label}
    </span>
  );
}

function LessonCard({ l, p }: { l: (typeof LESSONS)[number]; p?: LessonProgress }) {
  const mode = !p?.learnDone ? 'learn' : !p.buildSolved ? 'build' : 'challenge';
  return (
    <Link
      to={`/kafka/l/${l.id}/${mode}`}
      className={cn('group flex flex-col rounded-xl border bg-surface p-3.5 transition hover:-translate-y-0.5 hover:shadow-lift', isMastered(p) ? 'border-ok/50' : 'border-line hover:border-accent/50')}
    >
      <div className="font-mono text-[10px] text-faint">
        #{String(l.n).padStart(2, '0')} · {l.minutes} min
      </div>
      <h3 className="mt-0.5 font-mono text-[14px] font-semibold leading-snug group-hover:text-accent">{l.title}</h3>
      <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted">{l.tagline}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {l.concepts.slice(0, 4).map((c) => (
          <span key={c} className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-muted">
            {c}
          </span>
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between pt-3">
        <div className="flex gap-1">
          <Pip on={!!p?.learnDone} label="L" title="Learn: guided, with predictions" />
          <Pip on={!!p?.buildSolved} label="B" title="Build: fix the scenario yourself" />
          <Pip on={!!p?.challengeSolved} label="C" title="Challenge: transfer to a new domain" />
        </div>
        {isMastered(p) ? (
          <Tag size="sm" tone="ok">
            mastered
          </Tag>
        ) : p && !p.buildSolved && p.buildBest > 0 ? (
          <span className="font-mono text-[10px] text-faint">best {p.buildBest}%</span>
        ) : null}
      </div>
    </Link>
  );
}

export function KafkaHome() {
  const s = useKafka();
  const due = dueCards(s).length;
  const mastered = LESSONS.filter((l) => isMastered(s.lessons[l.id])).length;
  const divesDone = DIVES.filter((d) => s.dives[d.id]?.done).length;
  const pct = (r: { right: number; total: number }) => (r.total ? Math.round((r.right / r.total) * 100) : null);
  const calib = [
    { label: 'Prediction accuracy', v: pct(s.predict), n: s.predict.total, hint: 'Learn steps + internals' },
    { label: 'Chaos calls', v: pct(s.chaos), n: s.chaos.total, hint: 'Predicting failure outcomes' },
  ];
  const tiles = [
    { to: '/kafka/lab', icon: FlaskConical, title: 'Lab', text: 'Free-build any pipeline. Every change narrated, every failure injectable.', tone: 'text-accent' },
    { to: '/kafka/internals', icon: Cpu, title: 'Internals', text: `${divesDone}/${DIVES.length} deep dives: log segments, replication, idempotence, EOS, rebalancing, KRaft.`, tone: 'text-violet' },
    { to: '/kafka/drills', icon: Siren, title: 'Judgment drills', text: 'Incidents on a live cluster, capacity math, config review, trade-off calls.', tone: 'text-bad' },
    { to: '/kafka/compare', icon: Scale, title: 'Kafka vs …', text: 'RabbitMQ, SQS, Kinesis, Pulsar, and when not to use Kafka at all.', tone: 'text-warn' },
    { to: '/kafka/review', icon: CalendarClock, title: `Review${due ? ` · ${due} due` : ''}`, text: 'Spaced, interleaved recall of everything you predicted or quizzed.', tone: 'text-ok' },
    { to: '/kafka/method', icon: Brain, title: 'How this teaches', text: 'The learning science behind each mechanic, and how to use it well.', tone: 'text-muted' },
  ];
  const next = LESSONS.find((l) => !isMastered(s.lessons[l.id]));
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div>
            <div className="eyebrow">Data engineering · streaming</div>
            <h1 className="mt-1 font-mono text-2xl font-semibold">Kafka, from producer to page cache</h1>
            <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-muted">
              A live, deterministic Kafka cluster you can drag together and break. Change a partition count, an <code>acks</code> setting or an assignor and see <b className="text-ink">what changed</b>, <b className="text-ink">what it did to the system</b> (throughput, latency, ordering, delivery guarantees, data-loss risk, lag) and <b className="text-ink">how the broker actually does it</b>.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {s.last ? (
                <Link to={s.last.path}>
                  <Button icon={<ArrowRight size={14} />}>Resume: {s.last.label}</Button>
                </Link>
              ) : (
                <Link to={`/kafka/l/${LESSONS[0].id}/learn`}>
                  <Button icon={<GraduationCap size={14} />}>Start lesson 1</Button>
                </Link>
              )}
              {next && s.last && (
                <Link to={`/kafka/l/${next.id}/${s.lessons[next.id]?.learnDone ? 'build' : 'learn'}`}>
                  <Button variant="secondary">Next: {next.title}</Button>
                </Link>
              )}
              <Link to="/kafka/lab">
                <Button variant="ghost" icon={<FlaskConical size={14} />}>
                  Open the lab
                </Button>
              </Link>
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-baseline justify-between">
              <span className="eyebrow">Mastery</span>
              <span className="font-mono text-[12px] text-muted">
                {mastered}/{LESSONS.length} lessons
              </span>
            </div>
            <ProgressBar value={mastered / LESSONS.length} className="mt-1.5" />
            <div className="mt-3 space-y-2">
              {calib.map((c) => (
                <div key={c.label} className="flex items-center gap-2 text-[12px]">
                  <Target size={12} className="text-faint" />
                  <span className="flex-1" title={c.hint}>
                    {c.label}
                  </span>
                  <span className={cn('font-mono', c.v === null ? 'text-faint' : c.v >= 70 ? 'text-ok' : c.v >= 45 ? 'text-warn' : 'text-bad')}>{c.v === null ? '-' : `${c.v}%`}</span>
                  <span className="font-mono text-[10.5px] text-faint">n={c.n}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-snug text-faint">Calibration: low accuracy is fine early. It shows where your mental model is still wrong.</p>
          </div>
        </div>

        <section className="mt-8">
          <div className="flex items-baseline justify-between">
            <h2 className="font-mono text-[15px] font-semibold">Lesson path</h2>
            <span className="text-[12px] text-faint">Learn (worked) → Build (faded) → Challenge (transfer)</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {LESSONS.map((l) => (
              <LessonCard key={l.id} l={l} p={s.lessons[l.id]} />
            ))}
          </div>
        </section>

        <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((t) => (
            <Link key={t.to} to={t.to} className="group rounded-xl border border-line bg-surface p-4 transition hover:-translate-y-0.5 hover:shadow-lift">
              <div className="flex items-center gap-2">
                <t.icon size={16} className={t.tone} />
                <span className="font-mono text-[14px] font-semibold group-hover:text-accent">{t.title}</span>
                <ArrowRight size={13} className="ml-auto text-faint opacity-0 transition group-hover:opacity-100" />
              </div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{t.text}</p>
            </Link>
          ))}
        </section>
      </div>
    </div>
  );
}
