import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotificationStore } from '../stores/notificationStore';

function NotificationToast() {
  const navigate = useNavigate();
  const { latestNotification, setLatestNotification } = useNotificationStore();

  useEffect(() => {
    if (!latestNotification) return;
    const timer = setTimeout(() => setLatestNotification(null), 5000);
    return () => clearTimeout(timer);
  }, [latestNotification, setLatestNotification]);

  const handleClick = () => {
    if (!latestNotification) return;
    const notification = latestNotification;
    setLatestNotification(null);
    if (notification.actionUrl) {
      navigate(notification.actionUrl);
    } else {
      navigate('/notifications');
    }
  };

  return (
    <div className="fixed top-4 right-4 left-4 sm:left-auto sm:w-96 z-50 pointer-events-none">
      {latestNotification && (
        <div
          key={latestNotification.id}
          className="bg-white dark:bg-surface-800 border border-surface-100 dark:border-surface-700 shadow-card rounded-2xl p-4 mb-2 pointer-events-auto cursor-pointer transition-all hover:shadow-lg"
          onClick={handleClick}
        >
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl gradient-bg flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {latestNotification.type === 'HABIT_REMINDER' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                ) : latestNotification.type === 'GOAL_MILESTONE' || latestNotification.type === 'GOAL_REMINDER' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                ) : latestNotification.type === 'EVENT_REMINDER' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                ) : latestNotification.type === 'WEATHER_ALERT' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                )}
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">{latestNotification.title}</p>
              {latestNotification.content && (
                <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5 line-clamp-2">{latestNotification.content}</p>
              )}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setLatestNotification(null); }}
              className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationToast;
