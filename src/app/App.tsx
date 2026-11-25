import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useApplyTheme } from '@/shared/theme/theme';
import { AppLayout } from './AppLayout';
import { allModules } from './modules';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';

const SettingsPage = lazy(() => import('./pages/SettingsPage'));

function RouteFallback() {
  return (
    <div className="flex h-64 items-center justify-center">
      <span className="eyebrow animate-pulse-soft">loading…</span>
    </div>
  );
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

export default function App() {
  useApplyTheme();
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        {allModules.map(({ id, path, Component }) => (
          <Route
            key={id}
            path={`${path.slice(1)}/*`}
            element={
              <Lazy>
                <Component />
              </Lazy>
            }
          />
        ))}
        <Route
          path="settings"
          element={
            <Lazy>
              <SettingsPage />
            </Lazy>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
