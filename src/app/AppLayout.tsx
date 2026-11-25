import { NavLink, Outlet, Link } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { cn } from '@/shared/cn';
import { ThemeToggle } from '@/shared/ui';
import { tracks } from './modules';

/**
 * Header is fixed at h-14 (3.5rem). Full-height module views can use
 * `h-[calc(100vh-var(--header-h))]`.
 */
export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col [--header-h:3.5rem]">
      <header className="sticky top-0 z-40 h-14 border-b border-line/70 bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-full max-w-[1600px] items-center gap-6 px-5">
          <Link to="/" className="shrink-0 font-mono text-sm font-semibold tracking-tight">
            learning<span className="text-accent">/</span>playground
          </Link>
          <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {tracks.map((t, ti) => (
              <div key={t.id} className="flex shrink-0 items-center gap-1">
                {ti > 0 && <span className="mx-1.5 h-4 w-px bg-line" aria-hidden />}
                <span className="eyebrow mr-0.5 hidden !text-[10px] !text-faint xl:inline">{t.title}</span>
                {t.modules.map((m) => (
                  <NavLink
                    key={m.id}
                    to={m.path}
                    className={({ isActive }) =>
                      cn(
                        'whitespace-nowrap rounded px-2.5 py-1 font-mono text-xs transition-colors',
                        isActive ? 'bg-ink text-paper' : 'text-muted hover:bg-ink/5 hover:text-ink',
                      )
                    }
                  >
                    {m.short}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <NavLink
              to="/settings"
              aria-label="Settings"
              title="Settings · export / import progress"
              className={({ isActive }) =>
                cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded transition-colors',
                  isActive ? 'bg-ink text-paper' : 'text-muted hover:bg-ink/5 hover:text-ink',
                )
              }
            >
              <Settings size={16} />
            </NavLink>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
