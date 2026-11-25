import { useMemo } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { BookOpen, CalendarClock, GitBranch, GraduationCap, LayoutDashboard, Lock, Scale, Target, Terminal } from 'lucide-react';
import { useReportProgress, type PlanItem, type ProgressSummary } from '@/shared/progress';
import { cn } from '@/shared/cn';
import { CONCEPTS, conceptById } from './content';
import { trackName } from './content/tracks';
import { isConceptDue, mastery, useSql, type ConceptProgress } from './store';
import { ErrorBoundary } from './ui/common';
import Dashboard from './pages/Dashboard';
import Concepts from './pages/Concepts';
import ConceptPage from './pages/ConceptPage';
import Lab from './pages/Lab';
import Drill from './pages/Drill';
import Review from './pages/Review';
import JudgmentPage from './pages/JudgmentPage';
import Method from './pages/Method';
import { IndexesPage, IsolationPage } from './pages/Tools';

const NAV = [
  { to: '/sql', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/sql/concepts', label: 'Concepts', icon: BookOpen },
  { to: '/sql/lab', label: 'Query lab', icon: Terminal },
  { to: '/sql/indexes', label: 'Index lab', icon: GitBranch },
  { to: '/sql/isolation', label: 'Isolation lab', icon: Lock },
  { to: '/sql/drill', label: 'Drill', icon: Target },
  { to: '/sql/judgment', label: 'Judgment', icon: Scale },
  { to: '/sql/review', label: 'Review', icon: CalendarClock, badge: 'due' as const },
  { to: '/sql/method', label: 'How it teaches', icon: GraduationCap },
];

const DAY = 86_400_000;

function buildPlan(prog: Record<string, ConceptProgress>, last: string | null) {
  const now = Date.now();
  const reviews: PlanItem[] = CONCEPTS.filter((c) => isConceptDue(prog[c.id]))
    .sort((a, b) => (prog[a.id].card!.due < prog[b.id].card!.due ? -1 : 1))
    .slice(0, 5)
    .map((c) => {
      const days = Math.floor((now - new Date(prog[c.id].card!.due).getTime()) / DAY);
      return {
        label: `Review: ${c.title}`,
        path: '/sql/review',
        kind: 'review',
        minutes: 3,
        detail: days > 0 ? `recall from memory · ${days} day${days === 1 ? '' : 's'} overdue` : 'recall from memory · due today',
      };
    });

  const nextSteps: PlanItem[] = [];
  const inProgress = [last, ...CONCEPTS.map((c) => c.id)].map((id) => (id ? conceptById(id) : undefined)).find((c) => c && mastery(c, prog[c.id]) > 0 && mastery(c, prog[c.id]) < 3);
  if (inProgress) {
    const m = mastery(inProgress, prog[inProgress.id]);
    const tab = m < 2 && inProgress.build ? 'build' : 'practice';
    nextSteps.push({
      label: `${tab === 'build' ? 'Build' : 'Practise'}: ${inProgress.title}`,
      path: `/sql/c/${inProgress.id}?tab=${tab}`,
      kind: 'practice',
      minutes: 10,
      detail: `${trackName(inProgress.track)} · ${tab === 'build' ? 'rebuild the query from blocks' : 'solve the exercises on real data'}`,
    });
  }
  const fresh = CONCEPTS.find((c) => mastery(c, prog[c.id]) === 0);
  if (fresh)
    nextSteps.push({
      label: `Learn: ${fresh.title}`,
      path: `/sql/c/${fresh.id}`,
      kind: 'learn',
      minutes: fresh.minutes,
      detail: `${trackName(fresh.track)} · ${fresh.tagline}`,
    });
  const judgment = CONCEPTS.flatMap((c) => (c.judgment ?? []).map((j) => ({ c, j }))).find(({ c, j }) => mastery(c, prog[c.id]) > 0 && prog[c.id]?.judged?.[j.id] === undefined);
  if (judgment)
    nextSteps.push({
      label: `Review a query: ${judgment.j.title}`,
      path: '/sql/judgment',
      kind: 'challenge',
      minutes: 5,
      detail: 'find the bug, diagnose it, see the measured impact of the fix',
    });
  return { reviews, nextSteps: nextSteps.slice(0, 3) };
}

function useSummary(): ProgressSummary {
  const prog = useSql((s) => s.concepts);
  const last = useSql((s) => s.lastConcept);
  return useMemo(() => {
    const practised = CONCEPTS.filter((c) => mastery(c, prog[c.id]) >= 3).length;
    const explored = CONCEPTS.filter((c) => mastery(c, prog[c.id]) > 0).length;
    const due = CONCEPTS.filter((c) => isConceptDue(prog[c.id])).length;
    const lc = last ? conceptById(last) : undefined;
    return {
      completed: practised,
      total: CONCEPTS.length,
      unit: 'concepts',
      detail: `${explored} / ${CONCEPTS.length} explored`,
      dueForReview: due,
      resume: lc ? { label: lc.title, path: `/sql/c/${lc.id}` } : { label: 'SQL roadmap', path: '/sql/concepts' },
      ...buildPlan(prog, last),
    };
  }, [prog, last]);
}

export default function SqlModule() {
  const summary = useSummary();
  const due = summary.dueForReview ?? 0;
  const location = useLocation();
  useReportProgress('sql', summary);

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
                cn('flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] transition', isActive ? 'bg-ink text-paper' : 'text-muted hover:bg-sunken hover:text-ink')
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
            <Route path="concepts" element={<Concepts />} />
            <Route path="c/:id" element={<ConceptPage />} />
            <Route path="lab" element={<Lab />} />
            <Route path="indexes" element={<IndexesPage />} />
            <Route path="isolation" element={<IsolationPage />} />
            <Route path="drill" element={<Drill />} />
            <Route path="judgment" element={<JudgmentPage />} />
            <Route path="review" element={<Review />} />
            <Route path="method" element={<Method />} />
            <Route path="*" element={<Navigate to="/sql" replace />} />
          </Routes>
        </ErrorBoundary>
      </div>
    </div>
  );
}
