import { useState, useEffect } from 'react';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { AppRoutes } from './routes';
import { useAppInit } from './hooks/useAppInit';
import { useAuthStore, useUnauthedRedirect } from './stores/authStore';
import SplashScreen from './components/ui/SplashScreen';
import { ToastHost } from './components/ui/Toast';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { DATABASE_UPGRADE_BLOCKED_EVENT, isDatabaseUpgradeBlocked } from './db';
import { RuntimeObserver } from './components/layout/RuntimeObserver';

function NavigateBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = (event: Event) => {
      const path = (event as CustomEvent<{ path?: string }>).detail?.path;
      if (path) navigate(path);
    };
    window.addEventListener('youji:navigate', handler);
    return () => window.removeEventListener('youji:navigate', handler);
  }, [navigate]);
  return null;
}

function ReadyRoutes({ ready, failed }: { ready: boolean; failed: boolean }) {
  const { pathname } = useLocation();
  const [databaseBlocked, setDatabaseBlocked] = useState(isDatabaseUpgradeBlocked);
  useEffect(() => { const update = () => setDatabaseBlocked(isDatabaseUpgradeBlocked()); window.addEventListener(DATABASE_UPGRADE_BLOCKED_EVENT, update); return () => window.removeEventListener(DATABASE_UPGRADE_BLOCKED_EVENT, update); }, []);
  const checked = useAuthStore((s) => s.authChecked);
  const unavailable = useAuthStore((s) => s.identityUnavailable);
  const isPublic = ['/login', '/onboarding', '/data-info'].includes(pathname);
  if (isPublic || (ready && checked)) return <AppRoutes />;
  return <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
    <div className="flex max-w-sm flex-col items-center gap-3 px-5 text-center">
      {failed || unavailable || databaseBlocked ? <>
        <p className="text-sm text-[var(--text-2)]">{databaseBlocked ? '请先关闭这台设备其他有迹标签页，再重试升级。记录仍原样保留' : unavailable ? '暂时无法确认登录身份，记录仍保存在本设备' : '加载遇到问题'}</p>
        <button type="button" onClick={() => window.location.reload()} className="rounded-full bg-[var(--primary)] px-6 py-2.5 text-sm font-semibold text-white">重试</button>
      </> : <>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" aria-hidden />
        <p className="text-sm text-[var(--text-3)]" role="status">加载中…</p>
      </>}
    </div>
  </div>;
}

export default function App() {
  const authChecked = useAuthStore((s) => s.authChecked);
  const loadUser = useAuthStore((s) => s.loadUser);
  const { ready, failed } = useAppInit(authChecked);
  const [splashComplete, setSplashComplete] = useState(false);
  useEffect(() => { void loadUser().catch(() => useAuthStore.setState({ identityUnavailable: true })); }, [loadUser]);
  useUnauthedRedirect();
  if (!splashComplete) return <SplashScreen onComplete={() => setSplashComplete(true)} />;
  return <ErrorBoundary>
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <NavigateBridge />
        <RuntimeObserver />
        <ReadyRoutes ready={ready} failed={failed} />
      </BrowserRouter>
      <ToastHost />
    </MotionConfig>
  </ErrorBoundary>;
}
