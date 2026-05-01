import { useEffect } from 'react';
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
  const { token, checkAuth } = useAuthStore();
  const initNetworkListener = useSyncStore((s) => s.initNetworkListener);

  useEffect(() => {
    initPerformanceMonitoring();
    initErrorMonitoring();
  }, []);

  useEffect(() => {
    if (token) {
      checkAuth();
    }
  }, [token, checkAuth]);

  useEffect(() => {
    const cleanup = initNetworkListener();
    return cleanup;
  }, [initNetworkListener]);

  return (
    <>
      <UpdatePrompt />
      <SyncBar />
      <OfflineNotice />
      <InstallPrompt />
      <NotificationToast />
      <Routes>
        <Route path="/login" element={token ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/register" element={token ? <Navigate to="/" replace /> : <RegisterPage />} />
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
