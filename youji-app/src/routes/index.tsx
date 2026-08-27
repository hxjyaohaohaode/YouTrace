import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { useAuthStore } from '../stores/authStore';

const Login = lazy(() => import('../pages/Login'));
const Onboarding = lazy(() => import('../pages/Onboarding'));
const Home = lazy(() => import('../pages/Home'));
const Schedule = lazy(() => import('../pages/Schedule'));
const QuickNote = lazy(() => import('../pages/QuickNote'));
const QuickNoteResult = lazy(() => import('../pages/QuickNoteResult'));
const Expense = lazy(() => import('../pages/Expense'));
const Habit = lazy(() => import('../pages/Habit'));
const Todo = lazy(() => import('../pages/Todo'));
const Diary = lazy(() => import('../pages/Diary'));
const Coach = lazy(() => import('../pages/Coach'));
const CoachInsights = lazy(() => import('../pages/CoachInsights'));
const Settings = lazy(() => import('../pages/Settings'));
const Goal = lazy(() => import('../pages/Goal'));
const Timeline = lazy(() => import('../pages/Timeline'));

export const ONBOARDED_KEY = 'youji_onboarded';

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" aria-label="页面加载中" role="status" />
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

function FirstVisitGate({ children }: { children: React.ReactNode }) {
  const onboarded = localStorage.getItem(ONBOARDED_KEY) === 'true';
  if (!onboarded) {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route path="/" element={<FirstVisitGate><Home /></FirstVisitGate>} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/quick-note" element={<QuickNote />} />
          <Route path="/quick-note/result" element={<QuickNoteResult />} />
          <Route path="/expense" element={<Expense />} />
          <Route path="/habit" element={<Habit />} />
          <Route path="/todo" element={<Todo />} />
          <Route path="/diary" element={<Diary />} />
          <Route path="/coach" element={<Coach />} />
          <Route path="/insights" element={<CoachInsights />} />
          <Route path="/settings" element={<Settings />} />`n          <Route path="/goal" element={<Goal />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
