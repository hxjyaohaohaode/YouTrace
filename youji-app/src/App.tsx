import { useState, useEffect } from 'react';
import { BrowserRouter, useNavigate } from 'react-router-dom';
import { useEffect as useReactEffect } from 'react';
const APP_NAVIGATE_EVENT = 'youji:navigate';
function NavigateBridge() {
  const nav = useNavigate();
  useReactEffect(() => {
    const h = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (path) nav(path);
    };
    window.addEventListener(APP_NAVIGATE_EVENT, h);
    return () => window.removeEventListener(APP_NAVIGATE_EVENT, h);
  }, [nav]);
  return null;
}
import { AppRoutes } from './routes';
import { useAppInit } from './hooks/useAppInit';
import { useAuthStore, useUnauthedRedirect } from './stores/authStore';
import SplashScreen from './components/ui/SplashScreen';
import { ToastHost } from './components/ui/Toast';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

function App() {
  const { ready, failed } = useAppInit();
  const [splashComplete, setSplashComplete] = useState(false);
  const loadUser = useAuthStore((s) => s.loadUser);
  const authChecked = useAuthStore((s) => s.authChecked);

  useEffect(() => {
    loadUser().catch(() => undefined);
  }, [loadUser]);

  useUnauthedRedirect();

  if (!splashComplete) {
    return <SplashScreen onComplete={() => setSplashComplete(true)} />;
  }

  return (
    <ErrorBoundary>
      {!ready || !authChecked ? (
        <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
          <div className="flex flex-col items-center gap-3">
            {failed ? (
              <>
                <p className="text-sm text-[var(--text-2)]">加载遇到问题</p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="rounded-full bg-[var(--primary)] px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                >
                  重试
                </button>
              </>
            ) : (
              <>
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" aria-hidden />
                <p className="text-sm text-[var(--text-3)]">加载中...</p>
              </>
            )}
          </div>
        </div>
      ) : (
        <BrowserRouter>
          <NavigateBridge />
          <AppRoutes />
        </BrowserRouter>
      )}
      <ToastHost />
    </ErrorBoundary>
  );
}

export default App;
