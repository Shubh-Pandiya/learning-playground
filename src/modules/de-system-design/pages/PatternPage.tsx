import { useEffect } from 'react';
import { Link, Navigate, NavLink, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Footprints, Hammer, Trophy } from 'lucide-react';
import { cn } from '@/shared/cn';
import { PATTERNS, getPattern } from '../data/patterns';
import { useDesd, type Mode } from '../store';
import { Learn } from './Learn';
import { Workbench } from './Workbench';

const MODES: { m: Mode; label: string; icon: typeof Hammer; hint: string }[] = [
  { m: 'learn', label: 'Learn', icon: Footprints, hint: 'Guided, narrated walkthrough' },
  { m: 'build', label: 'Build', icon: Hammer, hint: 'Design it yourself' },
  { m: 'challenge', label: 'Challenge', icon: Trophy, hint: 'Same pattern, new problem' },
];

export function PatternPage() {
  const { id, mode: rawMode } = useParams();
  const p = getPattern(id);
  const mode: Mode = rawMode === 'build' || rawMode === 'challenge' ? rawMode : 'learn';
  const visit = useDesd((s) => s.visit);
  const prog = useDesd((s) => (id ? s.patterns[id] : undefined));

  useEffect(() => {
    if (p) visit(p.id, mode);
  }, [p, mode, visit]);

  if (!p) return <Navigate to="/de-system-design" replace />;
  if (rawMode && rawMode !== mode) return <Navigate to={`/de-system-design/p/${p.id}/learn`} replace />;

  const idx = PATTERNS.indexOf(p);
  const prev = PATTERNS[idx - 1];
  const next = PATTERNS[idx + 1];
  const done: Record<Mode, boolean> = { learn: !!prog?.guidedDone, build: !!prog?.buildSolved, challenge: !!prog?.challengeSolved };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-paper px-3">
        <Link to="/de-system-design" className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-faint hover:text-ink">
          <ArrowLeft size={13} /> Patterns
        </Link>
        <span className="h-5 w-px bg-line" />
        <div className="flex min-w-0 items-center gap-1">
          {prev && (
            <Link to={`/de-system-design/p/${prev.id}/${mode}`} title={prev.title} className="rounded p-0.5 text-faint hover:bg-ink/5 hover:text-ink">
              <ChevronLeft size={15} />
            </Link>
          )}
          <span className="truncate font-mono text-[14px] font-semibold">
            <span className="text-faint">#{String(p.num).padStart(2, '0')}</span> {p.title}
          </span>
          {next && (
            <Link to={`/de-system-design/p/${next.id}/${mode}`} title={next.title} className="rounded p-0.5 text-faint hover:bg-ink/5 hover:text-ink">
              <ChevronRight size={15} />
            </Link>
          )}
        </div>
        <nav className="ml-auto flex rounded-lg border border-line bg-surface p-0.5">
          {MODES.map(({ m, label, icon: Icon, hint }) => (
            <NavLink
              key={m}
              to={`/de-system-design/p/${p.id}/${m}`}
              title={hint}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1 font-mono text-[12px] transition',
                mode === m ? 'bg-ink text-paper' : 'text-muted hover:text-ink',
              )}
            >
              <Icon size={13} /> {label}
              {done[m] && <CheckCircle2 size={12} className={mode === m ? 'text-paper' : 'text-ok'} />}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'learn' ? <Learn key={p.id} pattern={p} /> : <Workbench key={`${p.id}:${mode}`} pattern={p} mode={mode} />}
      </div>
    </div>
  );
}
