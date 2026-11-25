import { useMemo } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { BookOpen, CalendarClock, Compass, GraduationCap, LayoutDashboard, ListChecks, Target } from 'lucide-react';
import { useReportProgress, type PlanItem, type ProgressSummary } from '@/shared/progress';
import { cn } from '@/shared/cn';
import { patternById, patterns } from './data/patterns';
import { problemById, problems, TOTAL_PROBLEMS, variants } from './problems';
import { isProblemDue, isSolved, mastery, useDsa, type ProblemProgress } from './store';
import Dashboard from './pages/Dashboard';
import ProblemList from './pages/ProblemList';
import Playground from './pages/Playground';
import { PatternDetail, PatternList } from './pages/Patterns';
import Drill from './pages/Drill';
import Review from './pages/Review';
import Transfer from './pages/Transfer';
import Method from './pages/Method';
import { ErrorBoundary } from './components/common';

const NAV = [
  { to: '/dsa', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/dsa/patterns', label: 'Patterns', icon: BookOpen },
  { to: '/dsa/problems', label: 'Problems', icon: ListChecks },
  { to: '/dsa/drill', label: 'Drill', icon: Target },
  { to: '/dsa/review', label: 'Review', icon: CalendarClock, badge: 'due' as const },
  { to: '/dsa/transfer', label: 'New problems', icon: Compass },
  { to: '/dsa/method', label: 'How it teaches', icon: GraduationCap },
];

const DAY = 86_400_000;

function buildPlan(prog: Record<string, ProblemProgress>, transfer: Record<string, unknown>, last?: string) {
  const now = Date.now();
  const reviews: PlanItem[] = problems
    .filter((p) => isProblemDue(prog[p.id]))
    .sort((a, b) => (prog[a.id].card!.due < prog[b.id].card!.due ? -1 : 1))
    .slice(0, 5)
    .map((p) => {
      const days = Math.floor((now - new Date(prog[p.id].card!.due).getTime()) / DAY);
      return {
        label: `Review: ${patternById[p.pattern].name} · ${p.title}`,
        path: '/dsa/review',
        kind: 'review',
        minutes: 3,
        detail: days > 0 ? `recall from memory · ${days} day${days === 1 ? '' : 's'} overdue` : 'recall from memory · due today',
      };
    });

  const nextSteps: PlanItem[] = [];
  const inProgress = [last, ...problems.map((p) => p.id)].find((id) => id && problemById[id] && mastery(prog[id]) > 0 && !isSolved(prog[id]));
  if (inProgress) {
    const p = problemById[inProgress];
    nextSteps.push({
      label: `Build: ${p.title}`,
      path: `/dsa/problem/${p.id}?tab=build`,
      kind: 'practice',
      minutes: 10,
      detail: `${patternById[p.pattern].name} · finish it with the faded blocks`,
    });
  }
  const fresh = problems.find((p) => mastery(prog[p.id]) === 0);
  if (fresh) {
    const pt = patternById[fresh.pattern];
    const patternNew = !problems.some((p) => p.pattern === fresh.pattern && mastery(prog[p.id]) > 0);
    nextSteps.push({
      label: `Learn: ${fresh.title}`,
      path: patternNew ? `/dsa/patterns/${pt.id}` : `/dsa/problem/${fresh.id}`,
      kind: 'learn',
      minutes: patternNew ? 15 : 12,
      detail: patternNew ? `new pattern: ${pt.name} — read it, then try ${fresh.title}` : `next in the roadmap · ${pt.name}`,
    });
  }
  const startedPatterns = new Set(problems.filter((p) => isSolved(prog[p.id])).map((p) => p.pattern));
  const challenge = variants.find((v) => startedPatterns.has(v.pattern) && !transfer[v.id]);
  if (challenge) {
    nextSteps.push({
      label: `Unseen problem: ${challenge.title}`,
      path: `/dsa/transfer?variant=${challenge.id}`,
      kind: 'challenge',
      minutes: 5,
      detail: 'spot the pattern in a problem you have not seen',
    });
  }
  return { reviews, nextSteps: nextSteps.slice(0, 3) };
}

function useSummary(): ProgressSummary {
  const prog = useDsa((s) => s.problems);
  const transfer = useDsa((s) => s.transfer);
  const last = useDsa((s) => s.lastProblem);
  return useMemo(() => {
    const solved = problems.filter((p) => isSolved(prog[p.id])).length;
    const due = problems.filter((p) => isProblemDue(prog[p.id])).length;
    const started = patterns.filter((pt) => problems.some((p) => p.pattern === pt.id && mastery(prog[p.id]) > 0)).length;
    const lp = last ? problemById[last] : undefined;
    return {
      completed: solved,
      total: TOTAL_PROBLEMS,
      unit: 'problems',
      detail: `${started} / ${patterns.length} patterns started`,
      dueForReview: due,
      resume: lp ? { label: lp.title, path: `/dsa/problem/${lp.id}` } : { label: 'Problem roadmap', path: '/dsa/problems' },
      ...buildPlan(prog, transfer, last ?? undefined),
    };
  }, [prog, transfer, last]);
}

export default function DsaModule() {
  const summary = useSummary();
  const due = summary.dueForReview ?? 0;
  const location = useLocation();
  useReportProgress('dsa', summary);

  return (
    <div>
      <nav className="sticky top-[var(--header-h)] z-20 border-b border-line bg-paper">
        <div className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-5 py-1.5">
          {NAV.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] transition',
                  isActive ? 'bg-ink text-paper' : 'text-muted hover:bg-sunken hover:text-ink',
                )
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {badge && due > 0 && <span className="rounded-full bg-warn px-1.5 font-mono text-[10px] leading-4 text-paper">{due}</span>}
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="mx-auto max-w-[1600px] px-5 py-6">
        <ErrorBoundary resetKey={location.pathname}>
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="patterns" element={<PatternList />} />
          <Route path="patterns/:id" element={<PatternDetail />} />
          <Route path="problems" element={<ProblemList />} />
          <Route path="problem/:id" element={<Playground />} />
          <Route path="drill" element={<Drill />} />
          <Route path="review" element={<Review />} />
          <Route path="transfer" element={<Transfer />} />
          <Route path="method" element={<Method />} />
          <Route path="*" element={<Navigate to="/dsa" replace />} />
        </Routes>
        </ErrorBoundary>
      </div>
    </div>
  );
}
