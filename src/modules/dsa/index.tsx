import { useEffect, useMemo } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { BookOpen, CalendarClock, Compass, GraduationCap, LayoutDashboard, ListChecks, Target } from 'lucide-react';
import { reportProgress } from '@/shared/progress';
import { cn } from '@/shared/cn';
import { patterns } from './data/patterns';
import { problemById, problems, TOTAL_PROBLEMS } from './problems';
import { isProblemDue, isSolved, mastery, useDsa } from './store';
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

function useSummary() {
  const prog = useDsa((s) => s.problems);
  const last = useDsa((s) => s.lastProblem);
  return useMemo(() => {
    const solved = problems.filter((p) => isSolved(prog[p.id])).length;
    const due = problems.filter((p) => isProblemDue(prog[p.id])).length;
    const started = patterns.filter((pt) => problems.some((p) => p.pattern === pt.id && mastery(prog[p.id]) > 0)).length;
    const lp = last ? problemById[last] : undefined;
    return { solved, due, started, lp };
  }, [prog, last]);
}

export default function DsaModule() {
  const { solved, due, started, lp } = useSummary();
  const location = useLocation();
  const resume = lp ? { label: lp.title, path: `/dsa/problem/${lp.id}` } : { label: 'Problem roadmap', path: '/dsa/problems' };
  useEffect(() => {
    try {
      reportProgress('dsa', {
        completed: solved,
        total: TOTAL_PROBLEMS,
        unit: 'problems',
        detail: `${started} / ${patterns.length} patterns started`,
        dueForReview: due,
        resume,
      });
    } catch {
      // a failing summary write must never take the module down
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solved, due, started, resume.path]);

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
