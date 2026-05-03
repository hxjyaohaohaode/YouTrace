import { useEffect, useState, useRef } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useSyncStore } from './stores/syncStore';
import { useWeatherStore } from './stores/weatherStore';
import { useLocationStore } from './stores/locationStore';
import { useNotificationStore } from './stores/notificationStore';
import { registerPushSubscription } from './api/push';
import ProtectedRoute from './components/ProtectedRoute';
import NotificationToast from './components/NotificationToast';
import OfflineNotice from './components/OfflineNotice';
import SyncBar from './components/SyncBar';
import InstallPrompt from './components/InstallPrompt';
import UpdatePrompt from './components/UpdatePrompt';
import { initPerformanceMonitoring, initErrorMonitoring } from './services/monitoring';

import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DiaryListPage from './pages/DiaryListPage';
import DiaryDetailPage from './pages/DiaryDetailPage';
import DiaryEditorPage from './pages/DiaryEditorPage';
import CalendarPage from './pages/CalendarPage';
import AIPage from './pages/AIPage';
import StatsPage from './pages/StatsPage';
import ProfilePage from './pages/ProfilePage';
import GoalListPage from './pages/GoalListPage';
import HabitListPage from './pages/HabitListPage';
import WeatherPage from './pages/WeatherPage';
import NotificationPage from './pages/NotificationPage';
import TriggerSettingsPage from './pages/TriggerSettingsPage';
import Layout from './components/Layout';

const TOKEN_REFRESH_INTERVAL = 30 * 60 * 1000;

function App() {
  const { checkAuth, isAuthenticated, refreshToken } = useAuthStore();
  const [isInitializing, setIsInitializing] = useState(true);
  const initNetworkListener = useSyncStore((s) => s.initNetworkListener);
  const { refreshAll } = useWeatherStore();
  const { coords, requestBrowserLocation } = useLocationStore();
  const { fetchNotifications } = useNotificationStore();

  useEffect(() => {
    initPerformanceMonitoring();
    initErrorMonitoring();
  }, []);

  useEffect(() => {
    checkAuth().finally(() => setIsInitializing(false));
  }, [checkAuth]);

  useEffect(() => {
    const cleanup = initNetworkListener();
    return cleanup;
  }, [initNetworkListener]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const lastRefreshRef = { current: 0 };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastRefreshRef.current > 5 * 60 * 1000) {
          lastRefreshRef.current = now;
          refreshToken();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const intervalId = setInterval(() => {
      lastRefreshRef.current = Date.now();
      refreshToken();
    }, TOKEN_REFRESH_INTERVAL);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(intervalId);
    };
  }, [isAuthenticated, refreshToken]);

  useEffect(() => {
    if (!isAuthenticated) return;

    registerPushSubscription().catch(() => { });

    fetchNotifications(1);
  }, [isAuthenticated, fetchNotifications]);

  const weatherInitRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || weatherInitRef.current) return;
    weatherInitRef.current = true;
    const initWeather = async () => {
      try {
        let lngLat = coords;
        if (!lngLat) {
          const result = await requestBrowserLocation();
          if (result) lngLat = result;
        }
        if (lngLat) {
          await refreshAll({ lng: lngLat.lng, lat: lngLat.lat });
        } else {
          await refreshAll();
        }
      } catch {
        try {
          await refreshAll();
        } catch {
          // weather unavailable is OK
        }
      }
    };
    initWeather();
  }, [isAuthenticated, coords, refreshAll, requestBrowserLocation]);

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-surface-400">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <UpdatePrompt />
      <SyncBar />
      <OfflineNotice />
      <InstallPrompt />
      <NotificationToast />
      <Routes>
        <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/register" element={isAuthenticated ? <Navigate to="/" replace /> : <RegisterPage />} />
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/" element={<DiaryListPage />} />
          <Route path="/diary/new" element={<DiaryEditorPage />} />
          <Route path="/diary/:id" element={<DiaryDetailPage />} />
          <Route path="/diary/:id/edit" element={<DiaryEditorPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/ai" element={<AIPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/goals" element={<GoalListPage />} />
          <Route path="/habits" element={<HabitListPage />} />
          <Route path="/weather" element={<WeatherPage />} />
          <Route path="/notifications" element={<NotificationPage />} />
          <Route path="/triggers" element={<TriggerSettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default App;
