import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotificationStore } from '../stores/notificationStore';
import type { NotificationItem } from '../types';

const TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
    MORNING_BRIEF: { icon: '☀️', color: 'bg-amber-50 dark:bg-amber-950/30' },
    EVENING_REVIEW: { icon: '🌙', color: 'bg-indigo-50 dark:bg-indigo-950/30' },
    EMOTION_ALERT: { icon: '💚', color: 'bg-emerald-50 dark:bg-emerald-950/30' },
    GOAL_REMINDER: { icon: '🎯', color: 'bg-orange-50 dark:bg-orange-950/30' },
    GOAL_MILESTONE: { icon: '🏆', color: 'bg-yellow-50 dark:bg-yellow-950/30' },
    HABIT_REMINDER: { icon: '🔥', color: 'bg-red-50 dark:bg-red-950/30' },
    EVENT_REMINDER: { icon: '📅', color: 'bg-blue-50 dark:bg-blue-950/30' },
    WEATHER_ALERT: { icon: '⚠️', color: 'bg-rose-50 dark:bg-rose-950/30' },
};

function formatTime(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}小时前`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}天前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function NotificationPage() {
    const navigate = useNavigate();
    const {
        notifications,
        unreadCount,
        total,
        page,
        totalPages,
        isLoading,
        fetchNotifications,
        markAsRead,
        markAllAsRead,
        deleteNotification,
    } = useNotificationStore();

    const [filter, setFilter] = useState<'all' | 'unread'>('all');

    useEffect(() => {
        fetchNotifications(1);
    }, [fetchNotifications]);

    const handleItemClick = useCallback(async (item: NotificationItem) => {
        if (!item.isRead) {
            await markAsRead(item.id);
        }
        if (item.actionUrl) {
            navigate(item.actionUrl);
        }
    }, [markAsRead, navigate]);

    const handleLoadMore = useCallback(() => {
        if (page < totalPages) {
            fetchNotifications(page + 1);
        }
    }, [page, totalPages, fetchNotifications]);

    const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        await deleteNotification(id);
    }, [deleteNotification]);

    const filteredNotifications = filter === 'unread'
        ? notifications.filter((n) => !n.isRead)
        : notifications;

    return (
        <div className="page-container">
            <header className="page-header safe-top">
                <div className="md:max-w-3xl lg:max-w-4xl mx-auto px-4 sm:px-8 lg:px-12 py-3 sm:py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button onClick={() => navigate(-1)} className="p-1 -ml-1 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <h1 className="text-lg font-semibold text-surface-800 dark:text-surface-100">通知中心</h1>
                        {unreadCount > 0 && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-brand-500 text-white rounded-full">
                                {unreadCount}
                            </span>
                        )}
                    </div>
                    {unreadCount > 0 && (
                        <button
                            onClick={() => markAllAsRead()}
                            className="text-xs text-brand-500 hover:text-brand-600 font-medium px-2.5 py-1 rounded-lg hover:bg-brand-50 transition-colors"
                        >
                            全部已读
                        </button>
                    )}
                </div>
            </header>

            <main className="md:max-w-3xl lg:max-w-4xl mx-auto px-4 sm:px-8 lg:px-12 py-3 sm:py-4">
                <div className="flex gap-2 mb-4">
                    <button
                        onClick={() => setFilter('all')}
                        className={`chip px-4 py-1.5 text-sm ${filter === 'all' ? 'chip-active' : 'chip-inactive'}`}
                    >
                        全部 {total}
                    </button>
                    <button
                        onClick={() => setFilter('unread')}
                        className={`chip px-4 py-1.5 text-sm ${filter === 'unread' ? 'chip-active' : 'chip-inactive'}`}
                    >
                        未读 {unreadCount}
                    </button>
                </div>

                {isLoading && notifications.length === 0 ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : filteredNotifications.length === 0 ? (
                    <div className="text-center py-20">
                        <svg className="w-16 h-16 mx-auto mb-4 text-surface-200 dark:text-surface-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                        </svg>
                        <p className="text-surface-400 text-sm">
                            {filter === 'unread' ? '没有未读通知' : '暂无通知'}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {filteredNotifications.map((item) => {
                            const config = TYPE_CONFIG[item.type] || { icon: '🔔', color: 'bg-surface-50 dark:bg-surface-800' };
                            return (
                                <div
                                    key={item.id}
                                    onClick={() => handleItemClick(item)}
                                    className={`card p-4 cursor-pointer transition-all hover:shadow-md group ${!item.isRead ? 'border-l-4 border-l-brand-500' : 'opacity-70'}`}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className={`w-10 h-10 rounded-xl ${config.color} flex items-center justify-center flex-shrink-0 text-lg`}>
                                            {config.icon}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className={`text-sm font-semibold text-surface-800 dark:text-surface-100 truncate ${!item.isRead ? '' : 'font-normal'}`}>
                                                    {item.title}
                                                </p>
                                                {!item.isRead && (
                                                    <span className="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0" />
                                                )}
                                            </div>
                                            {item.content && (
                                                <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 line-clamp-3 whitespace-pre-line">
                                                    {item.content}
                                                </p>
                                            )}
                                            <p className="text-2xs text-surface-300 dark:text-surface-600 mt-1.5">
                                                {formatTime(item.createdAt)}
                                            </p>
                                        </div>
                                        <button
                                            onClick={(e) => handleDelete(e, item.id)}
                                            className="opacity-0 group-hover:opacity-100 p-1 text-surface-300 hover:text-red-500 transition-all flex-shrink-0"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            );
                        })}

                        {page < totalPages && (
                            <button
                                onClick={handleLoadMore}
                                disabled={isLoading}
                                className="w-full py-3 text-sm text-brand-500 hover:text-brand-600 font-medium transition-colors"
                            >
                                {isLoading ? '加载中...' : '加载更多'}
                            </button>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

export default NotificationPage;
