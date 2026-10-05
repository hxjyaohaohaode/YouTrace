import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { StaticPageEntry } from '../components/layout/StaticPageEntry';
import { AppLayout } from '../components/layout/AppLayout';
import { useAuthStore } from '../stores/authStore';

const DataInfo = lazy(() => import('../pages/DataInfo'));
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
const More = lazy(() => import('../pages/More'));
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
    sessionStorage.setItem('youtrace:return-to', location.pathname + location.search);
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
        <Route path="/data-info" element={<DataInfo />} />
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route path="/" element={<StaticPageEntry path="/"><FirstVisitGate><Home /></FirstVisitGate></StaticPageEntry>} />
          <Route path="/schedule" element={<StaticPageEntry path="/schedule"><Schedule /></StaticPageEntry>} />
          <Route path="/quick-note" element={<QuickNote />} />
          <Route path="/quick-note/result" element={<QuickNoteResult />} />
          <Route path="/expense" element={<StaticPageEntry path="/expense"><Expense /></StaticPageEntry>} />
          <Route path="/habit" element={<StaticPageEntry path="/habit"><Habit /></StaticPageEntry>} />
          <Route path="/todo" element={<StaticPageEntry path="/todo"><Todo /></StaticPageEntry>} />
          <Route path="/diary" element={<StaticPageEntry path="/diary"><Diary /></StaticPageEntry>} />
          <Route path="/coach" element={<StaticPageEntry path="/coach" className="min-h-0 flex-1"><Coach /></StaticPageEntry>} />
          <Route path="/insights" element={<StaticPageEntry path="/insights"><CoachInsights /></StaticPageEntry>} />
          <Route path="/settings" element={<StaticPageEntry path="/settings"><Settings /></StaticPageEntry>} />
          <Route path="/goal" element={<StaticPageEntry path="/goal"><Goal /></StaticPageEntry>} />
          <Route path="/timeline" element={<StaticPageEntry path="/timeline"><Timeline /></StaticPageEntry>} />
          <Route path="/more" element={<More />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
