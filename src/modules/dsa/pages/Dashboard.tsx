import { Link } from 'react-router-dom';
import { ArrowRight, Brain, CalendarClock, Compass, Flame, PlayCircle, Target } from 'lucide-react';
import { Button, ProgressBar } from '@/shared/ui';
import { categories } from '../data/categories';
import { patterns } from '../data/patterns';
import { problemById, problems, problemsByCategory, variants } from '../problems';
import { isProblemDue, isSolved, mastery, streak, useDsa } from '../store';
import { PageHeader, Stat } from '../components/common';

export default function Dashboard() {
  const s = useDsa();
  const prog = s.problems;
  const built = problems.filter((p) => isSolved(prog[p.id])).length;
  const explored = problems.filter((p) => mastery(prog[p.id]) > 0).length;
  const due = problems.filter((p) => isProblemDue(prog[p.id])).length;
  const drill = Object.values(s.patterns).reduce((a, p) => ({ r: a.r + (p?.drillRight ?? 0), t: a.t + (p?.drillTotal ?? 0) }), { r: 0, t: 0 });
  const last = s.lastProblem ? problemById[s.lastProblem] : undefined;
  const nextNew = problems.find((p) => mastery(prog[p.id]) === 0);
  const days = streak(s.activity);

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="DSA · NeetCode 150"
        title="Patterns playground"
        actions={
          last ? (
            <Link to={`/dsa/problem/${last.id}`}>
              <Button variant="primary" icon={<PlayCircle className="h-4 w-4" />}>
                Continue: {last.title}
              </Button>
            </Link>
          ) : nextNew ? (
            <Link to={`/dsa/problem/${nextNew.id}`}>
              <Button variant="primary" icon={<PlayCircle className="h-4 w-4" />}>
                Start with {nextNew.title}
              </Button>
            </Link>
          ) : null
        }
      >
        Watch every loop move, predict the next step, rebuild solutions from drag-and-drop blocks, and see where each pattern lives in real backend systems.
        Learn ~27 patterns well and the 150 problems — and new ones — become variations.
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="built" value={`${built}/${problems.length}`} hint={`${explored} explored`} tone="ok" />
        <Stat label="patterns started" value={`${patterns.filter((p) => problems.some((x) => x.pattern === p.id && mastery(prog[x.id]) > 0)).length}/${patterns.length}`} />
        <Stat label="due for review" value={due} hint="spaced repetition" tone={due ? 'warn' : undefined} />
        <Stat label="recognition" value={drill.t ? `${Math.round((drill.r / drill.t) * 100)}%` : '—'} hint={`${drill.t} decisions`} tone="info" />
        <Stat label="streak" value={`${days} day${days === 1 ? '' : 's'}`} hint={days ? 'keep it alive' : 'start today'} tone="accent" />
      </div>

      <section>
        <h2 className="mb-1 text-lg font-semibold text-ink">Today’s session (≈ 30 min)</h2>
        <p className="mb-3 text-sm text-muted">A short mixed session beats a long single-topic one. Do these in order.</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Step
            n={1}
            icon={<CalendarClock className="h-5 w-5 text-warn" />}
            title={due ? `Review ${due} due problem${due === 1 ? '' : 's'}` : 'No reviews due'}
            body="Recall from memory first, then compare. This is what moves knowledge into long-term memory."
            to="/dsa/review"
            cta="Open review"
            disabled={!due}
          />
          <Step
            n={2}
            icon={<Target className="h-5 w-5 text-violet" />}
            title="10-question recognition drill"
            body="Shuffled across all categories. Trains the hardest interview skill: picking the right pattern fast."
            to="/dsa/drill"
            cta="Start drill"
          />
          <Step
            n={3}
            icon={<Brain className="h-5 w-5 text-accent" />}
            title={nextNew ? `Learn: ${nextNew.title}` : 'All problems explored!'}
            body="Guess the pattern → watch it run with predictions → rebuild it from blocks → explain it."
            to={nextNew ? `/dsa/problem/${nextNew.id}` : '/dsa/problems'}
            cta="Open playground"
          />
          <Step
            n={4}
            icon={<Compass className="h-5 w-5 text-info" />}
            title="One unseen problem"
            body={`${variants.length} new variants that re-dress known patterns — practice for problems you have never seen.`}
            to="/dsa/transfer"
            cta="Try transfer"
          />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">Roadmap</h2>
            <p className="text-sm text-muted">The NeetCode order builds each topic on the previous one.</p>
          </div>
          <Link to="/dsa/problems" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            all problems <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {categories.map((c) => {
            const list = problemsByCategory(c.id);
            const done = list.filter((p) => isSolved(prog[p.id])).length;
            const exp = list.filter((p) => mastery(prog[p.id]) > 0).length;
            return (
              <Link
                key={c.id}
                to={`/dsa/problems#${c.id}`}
                className="group rounded-xl border border-line bg-surface p-3 shadow-paper transition hover:-translate-y-0.5 hover:shadow-lift"
              >
                <div className="font-mono text-[10px] text-faint">{String(c.order).padStart(2, '0')}</div>
                <div className="text-sm font-medium text-ink group-hover:text-accent">{c.name}</div>
                <ProgressBar value={done} max={Math.max(1, list.length)} size="xs" tone="ok" className="mt-2" />
                <div className="mt-1 font-mono text-[10px] text-muted">
                  {done}/{list.length} built · {exp} explored
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-sunken/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Flame className="h-6 w-6 text-accent" />
            <div>
              <div className="font-semibold text-ink">Why it is built this way</div>
              <div className="text-sm text-muted">Every screen applies a specific finding from learning science. See which, and how to use them.</div>
            </div>
          </div>
          <Link to="/dsa/method">
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
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink font-mono text-xs text-paper">{n}</span>
        {icon}
      </div>
      <div className="font-medium text-ink">{title}</div>
      <p className="mt-1 flex-1 text-sm text-muted">{body}</p>
      <Link to={to} className="mt-3" aria-disabled={disabled}>
        <Button size="sm" variant={disabled ? 'ghost' : 'secondary'} disabled={disabled}>
          {cta} →
        </Button>
      </Link>
    </div>
  );
}
