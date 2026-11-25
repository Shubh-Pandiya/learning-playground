import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useApplyTheme } from '@/shared/theme/theme';
import { AppLayout } from './AppLayout';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';

const DsaModule = lazy(() => import('@/modules/dsa'));
const SystemDesignModule = lazy(() => import('@/modules/system-design'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

function RouteFallback() {
  return (
    <div className="flex h-64 items-center justify-center">
      <span className="eyebrow animate-pulse-soft">loading…</span>
    </div>
  );
}

export default function App() {
  useApplyTheme();
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route
          path="dsa/*"
          element={
            <Suspense fallback={<RouteFallback />}>
              <DsaModule />
            </Suspense>
          }
        />
        <Route
          path="system-design/*"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SystemDesignModule />
            </Suspense>
          }
        />
        <Route
          path="settings"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SettingsPage />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
