import { Link } from 'react-router-dom';
import { ArrowRight, Brain, CalendarClock, Database, Flame, GitBranch, Lock, PlayCircle, Scale, Target, Terminal } from 'lucide-react';
import { Button, ProgressBar } from '@/shared/ui';
import { CONCEPTS, conceptById, conceptsInTrack, TRACKS } from '../content';
import { isConceptDue, mastery, useSql } from '../store';
import { DbBadge, InterviewHeat, MasteryDots, PageHeader, Stat, StatusIcon } from '../ui/common';

export const streak = (activity: string[]) => {
  const set = new Set(activity);
  let n = 0;
  const d = new Date();
  if (!set.has(d.toLocaleDateString('en-CA'))) d.setDate(d.getDate() - 1);
  while (set.has(d.toLocaleDateString('en-CA'))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
};

export default function Dashboard() {
  const s = useSql();
  const prog = s.concepts;
  const mastered = CONCEPTS.filter((c) => mastery(c, prog[c.id]) >= 3).length;
  const explored = CONCEPTS.filter((c) => mastery(c, prog[c.id]) > 0).length;
  const due = CONCEPTS.filter((c) => isConceptDue(prog[c.id])).length;
  const pred = Object.values(prog).reduce((a, p) => ({ r: a.r + (p.predictRight ?? 0), t: a.t + (p.predictTotal ?? 0) }), { r: 0, t: 0 });
  const judged = Object.values(prog).flatMap((p) => Object.values(p.judged ?? {}));
  const last = s.lastConcept ? conceptById(s.lastConcept) : undefined;
  const nextNew = CONCEPTS.find((c) => mastery(c, prog[c.id]) === 0);
  const days = streak(s.activity);
  const judgmentTotal = CONCEPTS.reduce((a, c) => a + (c.judgment?.length ?? 0), 0);

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Data engineering · Advanced SQL"
        title="SQL playground"
        actions={
          <div className="flex items-center gap-2">
            <DbBadge />
            {last ? (
              <Link to={`/sql/c/${last.id}`}>
                <Button variant="primary" icon={<PlayCircle className="h-4 w-4" />}>
                  Continue: {last.title}
                </Button>
              </Link>
            ) : nextNew ? (
              <Link to={`/sql/c/${nextNew.id}`}>
                <Button variant="primary" icon={<PlayCircle className="h-4 w-4" />}>
                  Start with {nextNew.title}
                </Button>
              </Link>
            ) : null}
          </div>
        }
      >
        Real Postgres runs in your browser. Watch every query move through FROM → WHERE → GROUP BY → window → SELECT with real rows, predict before each reveal, rebuild queries from blocks with
        a live result and plan diff, and train the judgment interviews and code reviews test: spot the bug, fix the slow query, pick the isolation level.
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="practised" value={`${mastered}/${CONCEPTS.length}`} hint={`${explored} explored`} tone="ok" />
        <Stat label="due for review" value={due} hint="spaced repetition" tone={due ? 'warn' : undefined} />
        <Stat label="prediction accuracy" value={pred.t ? `${Math.round((pred.r / pred.t) * 100)}%` : '—'} hint={`${pred.t} predictions`} tone="info" />
        <Stat label="judgment" value={judged.length ? `${judged.filter(Boolean).length}/${judged.length}` : '—'} hint={`first-try diagnoses · ${judgmentTotal} drills`} />
        <Stat label="streak" value={`${days} day${days === 1 ? '' : 's'}`} hint={days ? 'keep it alive' : 'start today'} tone="accent" />
      </div>

      <section>
        <h2 className="mb-1 text-lg font-semibold text-ink">Today’s session (≈ 30 min)</h2>
        <p className="mb-3 text-sm text-muted">Mixed practice beats a long single-topic session. Do these in order.</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Step n={1} icon={<CalendarClock className="h-5 w-5 text-warn" />} title={due ? `Review ${due} due concept${due === 1 ? '' : 's'}` : 'No reviews due'} body="Recall from memory, then check. Spacing moves it into long-term memory." to="/sql/review" cta="Open review" disabled={!due} />
          <Step n={2} icon={<Target className="h-5 w-5 text-violet" />} title="“Which technique?” drill" body="Unseen business questions, shuffled across tracks. Trains picking the right tool fast." to="/sql/drill" cta="Start drill" />
          <Step
            n={3}
            icon={<Brain className="h-5 w-5 text-accent" />}
            title={nextNew ? `Learn: ${nextNew.title}` : 'All concepts explored!'}
            body="Understand → watch it run with predictions → rebuild it → practise → judge."
            to={nextNew ? `/sql/c/${nextNew.id}` : '/sql/concepts'}
            cta="Open concept"
          />
          <Step n={4} icon={<Scale className="h-5 w-5 text-info" />} title="One judgment drill" body="A realistic PR or slow dashboard query: find the line, diagnose, see the measured impact of the fix." to="/sql/judgment" cta="Review a query" />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">Roadmap</h2>
            <p className="text-sm text-muted">Each track builds on the previous one. 🔥 = how often it comes up in DE / backend interviews.</p>
          </div>
          <Link to="/sql/concepts" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            all concepts <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {TRACKS.map((t) => {
            const list = conceptsInTrack(t.id);
            const done = list.filter((c) => mastery(c, prog[c.id]) >= 3).length;
            return (
              <div key={t.id} className="rounded-xl border border-line bg-surface p-4 shadow-paper">
                <div className="font-mono text-[10px] text-faint">{String(t.order).padStart(2, '0')}</div>
                <div className="font-medium text-ink">{t.name}</div>
                <div className="mt-0.5 text-[12px] text-muted">{t.blurb}</div>
                <ProgressBar value={done} max={Math.max(1, list.length)} size="xs" tone="ok" className="mt-3" />
                <ul className="mt-2 space-y-0.5">
                  {list.map((c) => (
                    <li key={c.id}>
                      <Link to={`/sql/c/${c.id}`} className="group flex items-center gap-2 rounded px-1 py-0.5 text-[13px] hover:bg-sunken">
                        <StatusIcon c={c} p={prog[c.id]} />
                        <span className="min-w-0 flex-1 truncate text-ink group-hover:text-accent">{c.title}</span>
                        <InterviewHeat n={c.interview} />
                        <MasteryDots c={c} p={prog[c.id]} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Labs</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Tool to="/sql/lab" icon={<Terminal className="h-5 w-5 text-accent" />} title="Query lab" body="Free Postgres with seeded orders / events / employees data. Every run shows what changed vs the previous run, the stage-by-stage view and the plan." />
          <Tool to="/sql/indexes" icon={<GitBranch className="h-5 w-5 text-ok" />} title="B+tree index lab" body="Watch a seek descend pages, a range scan walk the leaf chain, inserts split pages, and why composite column order decides everything." />
          <Tool to="/sql/isolation" icon={<Lock className="h-5 w-5 text-warn" />} title="Isolation & MVCC lab" body="Two transactions, one timeline. Switch isolation level and see which step diverges: dirty reads, lost updates, write skew, deadlocks." />
        </div>
      </section>

      <section className="rounded-xl border border-line bg-sunken/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Flame className="h-6 w-6 text-accent" />
            <div>
              <div className="font-semibold text-ink">Why it is built this way</div>
              <div className="text-sm text-muted">Every screen applies a specific finding from learning science.</div>
            </div>
          </div>
          <Link to="/sql/method">
            <Button variant="secondary">How this playground teaches</Button>
          </Link>
        </div>
      </section>
    </div>
  );
}

function Step({ n, icon, title, body, to, cta, disabled }: { n: number; icon: React.ReactNode; title: string; body: string; to: string; cta: string; disabled?: boolean }) {
  return (
    <div className="flex flex-col rounded-xl border border-line bg-surface p-4 shadow-paper">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-faint">{n}</span>
        {icon}
      </div>
      <div className="mt-2 font-medium text-ink">{title}</div>
      <p className="mt-1 flex-1 text-[13px] text-muted">{body}</p>
      <Link to={to} className={disabled ? 'pointer-events-none opacity-50' : ''}>
        <Button size="sm" variant="secondary" className="mt-3">
          {cta}
        </Button>
      </Link>
    </div>
  );
}

function Tool({ to, icon, title, body }: { to: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <Link to={to} className="group rounded-xl border border-line bg-surface p-4 shadow-paper transition hover:-translate-y-0.5 hover:shadow-lift">
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-medium text-ink group-hover:text-accent">{title}</span>
        <Database className="ml-auto h-3.5 w-3.5 text-faint" />
      </div>
      <p className="mt-1.5 text-[13px] text-muted">{body}</p>
    </Link>
  );
}
