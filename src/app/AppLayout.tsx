import { NavLink, Outlet, Link } from 'react-router-dom';
import { Moon, Settings, Sun } from 'lucide-react';
import { cn } from '@/shared/cn';
import { useTheme } from '@/shared/theme/theme';

const navItems = [
  { to: '/dsa', label: 'DSA Patterns' },
  { to: '/system-design', label: 'System Design' },
];

export function ThemeToggle() {
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
      className="inline-flex h-8 w-8 items-center justify-center rounded text-muted transition-colors hover:bg-ink/5 hover:text-ink"
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

/**
 * Header is fixed at h-14 (3.5rem). Full-height module views can use
 * `h-[calc(100vh-var(--header-h))]`.
 */
export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col [--header-h:3.5rem]">
      <header className="sticky top-0 z-40 h-14 border-b border-line/70 bg-paper/85 backdrop-blur">
        <div className="mx-auto flex h-full max-w-[1600px] items-center gap-6 px-5">
          <Link to="/" className="font-mono text-sm font-semibold tracking-tight">
            learning<span className="text-accent">/</span>playground
          </Link>
          <nav className="flex items-center gap-1">
            {navItems.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn(
                    'rounded px-2.5 py-1 font-mono text-xs transition-colors',
                    isActive ? 'bg-ink text-paper' : 'text-muted hover:bg-ink/5 hover:text-ink',
                  )
                }
              >
                {n.label}
              </NavLink>
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
