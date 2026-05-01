import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useSyncStore } from './stores/syncStore';
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
import Layout from './components/Layout';

function App() {
  const { checkAuth, isAuthenticated } = useAuthStore();
  const [isInitializing, setIsInitializing] = useState(true);
  const initNetworkListener = useSyncStore((s) => s.initNetworkListener);

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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default App;
