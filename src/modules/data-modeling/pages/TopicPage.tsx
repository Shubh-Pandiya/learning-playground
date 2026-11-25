import { lazy, Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent } from 'react';
import { Link, Navigate, NavLink, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, CheckCircle2, ChevronLeft, ChevronRight, FlaskConical, Footprints, Hammer, Trophy } from 'lucide-react';
import { cn } from '@/shared/cn';
import { getTopic, TOPICS } from '../data/topics';
import { exercisesDone, topicPath, useDm, type Mode } from '../store';
import type { LabId, LabTopic, Topic } from '../types';
import { Brief, Recall } from '../ui/Brief';
import { Learn } from './Learn';
import { Workbench } from './Workbench';

type LabComp = LazyExoticComponent<ComponentType<{ topic: LabTopic }>>;
const LAB_FILES = import.meta.glob<{ default: ComponentType<{ topic: LabTopic }> }>('../labs/*/Lab.tsx');
const LABS: Partial<Record<LabId, LabComp>> = {};
for (const [path, load] of Object.entries(LAB_FILES)) {
  const id = path.split('/').at(-2) as LabId;
  LABS[id] = lazy(load);
}

const MODES: { m: Mode; label: string; icon: typeof Hammer; hint: string }[] = [
  { m: 'learn', label: 'Learn', icon: Footprints, hint: 'Guided walkthrough with predictions' },
  { m: 'build', label: 'Build', icon: Hammer, hint: 'Model it yourself' },
  { m: 'challenge', label: 'Challenge', icon: Trophy, hint: 'Same technique, new domain' },
];

function Loading() {
  return <div className="flex h-full items-center justify-center font-mono text-[12px] text-faint">loading lab…</div>;
}

function Header({ t, mode, children }: { t: Topic; mode: Mode; children: React.ReactNode }) {
  const idx = TOPICS.indexOf(t);
  const prev = TOPICS[idx - 1];
  const next = TOPICS[idx + 1];
  const go = (x: Topic) => topicPath(x, x.kind === 'lab' ? 'lab' : mode === 'lab' ? 'learn' : mode);
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-paper px-3">
      <Link to="/data-modeling" className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-faint hover:text-ink">
        <ArrowLeft size={13} /> Topics
      </Link>
      <span className="h-5 w-px bg-line" />
      <div className="flex min-w-0 items-center gap-1">
        {prev && (
          <Link to={go(prev)} title={prev.title} className="rounded p-0.5 text-faint hover:bg-ink/5 hover:text-ink">
            <ChevronLeft size={15} />
          </Link>
        )}
        <span className="truncate font-mono text-[14px] font-semibold">
          <span className="text-faint">#{String(t.num).padStart(2, '0')}</span> {t.title}
        </span>
        {next && (
          <Link to={go(next)} title={next.title} className="rounded p-0.5 text-faint hover:bg-ink/5 hover:text-ink">
            <ChevronRight size={15} />
          </Link>
        )}
      </div>
      <nav className="ml-auto flex rounded-lg border border-line bg-surface p-0.5">{children}</nav>
    </div>
  );
}

const tabCls = (on: boolean) => cn('flex items-center gap-1.5 rounded-md px-3 py-1 font-mono text-[12px] transition', on ? 'bg-ink text-paper' : 'text-muted hover:text-ink');

function LabPage({ t }: { t: LabTopic }) {
  const [view, setView] = useState<'lab' | 'brief'>('lab');
  const prog = useDm((s) => s.topics[t.id]);
  const Lab = LABS[t.lab];
  const done = exercisesDone(t, prog);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header t={t} mode="lab">
        <button className={tabCls(view === 'lab')} onClick={() => setView('lab')}>
          <FlaskConical size={13} /> Lab
          <span className={cn('rounded px-1 text-[10px]', view === 'lab' ? 'bg-paper/20' : 'bg-sunken')}>
            {done}/{t.exercises.length}
          </span>
        </button>
        <button className={tabCls(view === 'brief')} onClick={() => setView('brief')}>
          <BookOpen size={13} /> Brief & recall
        </button>
      </Header>
      <div className="min-h-0 flex-1">
        {view === 'lab' ? (
          Lab ? (
            <Suspense fallback={<Loading />}>
              <Lab key={t.id} topic={t} />
            </Suspense>
          ) : (
            <div className="flex h-full items-center justify-center font-mono text-[12px] text-faint">This lab isn't available yet.</div>
          )
        ) : (
          <div className="h-full overflow-y-auto">
            <div className="mx-auto grid max-w-5xl gap-8 px-6 py-6 lg:grid-cols-2">
              <Brief topic={t} />
              <div>
                <div className="eyebrow mb-2">Recall</div>
                <Recall topic={t} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function TopicPage() {
  const { id, mode: rawMode } = useParams();
  const t = getTopic(id);
  const visit = useDm((s) => s.visit);
  const prog = useDm((s) => (id ? s.topics[id] : undefined));
  const mode: Mode = t?.kind === 'lab' ? 'lab' : rawMode === 'build' || rawMode === 'challenge' ? rawMode : 'learn';

  useEffect(() => {
    if (t) visit(t.id, mode);
  }, [t, mode, visit]);

  if (!t) return <Navigate to="/data-modeling" replace />;
  if (t.kind === 'lab') {
    if (rawMode) return <Navigate to={topicPath(t, 'lab')} replace />;
    return <LabPage t={t} />;
  }
  if (rawMode !== mode) return <Navigate to={topicPath(t, 'learn')} replace />;

  const done: Record<string, boolean> = { learn: !!prog?.guidedDone, build: !!prog?.buildSolved, challenge: !!prog?.challengeSolved };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header t={t} mode={mode}>
        {MODES.map(({ m, label, icon: Icon, hint }) => (
          <NavLink key={m} to={topicPath(t, m)} title={hint} className={tabCls(mode === m)}>
            <Icon size={13} /> {label}
            {done[m] && <CheckCircle2 size={12} className={mode === m ? 'text-paper' : 'text-ok'} />}
          </NavLink>
        ))}
      </Header>
      <div className="min-h-0 flex-1">{mode === 'learn' ? <Learn key={t.id} topic={t} /> : <Workbench key={`${t.id}:${mode}`} topic={t} mode={mode as 'build' | 'challenge'} />}</div>
    </div>
  );
}
