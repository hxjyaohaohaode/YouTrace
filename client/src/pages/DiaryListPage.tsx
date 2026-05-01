import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDiaryStore } from '../stores/diaryStore';
import { useAuthStore } from '../stores/authStore';
import { useGoalStore } from '../stores/goalStore';
import { useHabitStore } from '../stores/habitStore';
import DiaryCard from '../components/DiaryCard';
import { diaryApi } from '../api/diary';
import { EmotionIcon, type EmotionIconName } from '../utils/emotion';

const EMOTION_FILTERS: { value: string; label: string; icon: EmotionIconName }[] = [
    { value: '', label: '全部', icon: 'neutral' },
    { value: 'happy', label: '开心', icon: 'happy' },
    { value: 'sad', label: '难过', icon: 'sad' },
    { value: 'anxious', label: '焦虑', icon: 'anxious' },
    { value: 'calm', label: '平静', icon: 'calm' },
    { value: 'grateful', label: '感恩', icon: 'grateful' },
    { value: 'angry', label: '愤怒', icon: 'angry' },
];

function DiaryListPage() {
    const navigate = useNavigate();
    const { diaries, isLoading, error, totalPages, fetchDiaries } = useDiaryStore();
    const { goals, fetchGoals } = useGoalStore();
    const { habits, fetchHabits, toggleHabit } = useHabitStore();
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [emotionFilter, setEmotionFilter] = useState('');
    const [page, setPage] = useState(1);
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        fetchDiaries(page, 10, debouncedSearch || undefined, emotionFilter || undefined);
    }, [page, emotionFilter, debouncedSearch, fetchDiaries]);

    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, emotionFilter]);

    useEffect(() => {
        fetchGoals();
        fetchHabits();
    }, [fetchGoals, fetchHabits]);

    const handleExport = useCallback(async () => {
        setIsExporting(true);
        try {
            const response = await diaryApi.exportDiaries();
            if (response.success && response.data) {
                const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `youji-diaries-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
            }
        } catch {
            // export failed, ignore
        } finally {
            setIsExporting(false);
        }
    }, []);

    const handleLogout = useCallback(() => {
        useAuthStore.getState().logout();
        navigate('/login');
    }, [navigate]);

    return (
        <div className="min-h-screen bg-surface-50 dark:bg-surface-950 pb-20 md:pb-6">
            <header className="page-header">
                <div className="max-w-4xl lg:max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-surface-800 dark:text-surface-100">有记</h1>
                        <p className="text-xs text-surface-400 mt-0.5">记录每一天的心情变化</p>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={handleExport}
                            disabled={isExporting}
                            className="text-surface-400 hover:text-surface-600 text-xs px-3 py-1.5 rounded-lg hover:bg-surface-100 transition-colors"
                        >
                            {isExporting ? '导出中...' : '导出'}
                        </button>
                        <button
                            onClick={() => navigate('/stats')}
                            className="text-surface-400 hover:text-surface-600 text-xs px-3 py-1.5 rounded-lg hover:bg-surface-100 transition-colors"
                        >
                            统计
                        </button>
                        <button
                            onClick={() => setShowLogoutConfirm(true)}
                            className="text-surface-400 hover:text-red-500 dark:hover:text-red-400 text-xs px-3 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                        >
                            退出
                        </button>
                    </div>
                </div>

                <div className="max-w-4xl lg:max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-4">
                    <div className="relative">
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="搜索日记内容..."
                            className="input-field pl-10" />
                        <svg className="w-4 h-4 text-surface-400 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        {search && (
                            <button
                                onClick={() => setSearch('')}
                                className="absolute right-3.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-surface-200 flex items-center justify-center text-surface-500 hover:bg-surface-300 transition-colors"
                            >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        )}
                    </div>

                    <div className="flex gap-2 mt-3 overflow-x-auto scrollbar-hide pb-1">
                        {EMOTION_FILTERS.map((filter) => (
                            <button
                                key={filter.value}
                                onClick={() => { setEmotionFilter(filter.value); setPage(1); }}
                                className={`chip px-3 py-1.5 text-xs whitespace-nowrap ${emotionFilter === filter.value ? 'chip-active' : 'chip-inactive'
                                    }`}
                            >
                                <span className="inline-flex items-center gap-1">
                                    <EmotionIcon emotion={filter.icon} className="w-3 h-3" />
                                    {filter.label}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            {(goals.filter(g => g.status === 'ACTIVE').length > 0 || habits.length > 0) && (
                <section className="max-w-4xl lg:max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {goals.filter(g => g.status === 'ACTIVE').length > 0 && (
                            <div className="card p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-sm font-medium text-surface-600 flex items-center gap-1.5">
                                        <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                                        </svg>
                                        进行中的目标
                                    </h3>
                                    <button onClick={() => navigate('/goals')} className="text-xs text-brand-500 hover:text-brand-600">查看全部</button>
                                </div>
                                <div className="space-y-2">
                                    {goals.filter(g => g.status === 'ACTIVE').slice(0, 3).map(goal => (
                                        <div key={goal.id} className="flex items-center gap-2.5">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-surface-700 truncate">{goal.title}</p>
                                                {goal.deadline && (
                                                    <p className="text-2xs text-surface-400">
                                                        截止 {new Date(goal.deadline).toLocaleDateString('zh-CN')}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                                <div className="w-16 h-1.5 bg-surface-100 rounded-full overflow-hidden">
                                                    <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${Math.min(goal.progress, 100)}%` }} />
                                                </div>
                                                <span className="text-2xs text-surface-400 w-8 text-right">{goal.progress}%</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {habits.length > 0 && (
                            <div className="card p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-sm font-medium text-surface-600 flex items-center gap-1.5">
                                        <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                        今日习惯
                                    </h3>
                                    <button onClick={() => navigate('/habits')} className="text-xs text-brand-500 hover:text-brand-600">查看全部</button>
                                </div>
                                <div className="space-y-2">
                                    {habits.slice(0, 4).map(habit => (
                                        <div key={habit.id} className="flex items-center gap-2.5">
                                            <button
                                                onClick={() => toggleHabit(habit.id)}
                                                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${habit.todayCompleted
                                                    ? 'bg-green-500 border-green-500 text-white'
                                                    : 'border-surface-300 hover:border-green-400'
                                                    }`}
                                            >
                                                {habit.todayCompleted && (
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                    </svg>
                                                )}
                                            </button>
                                            <span className={`text-sm flex-1 truncate ${habit.todayCompleted ? 'text-surface-400 line-through' : 'text-surface-700'}`}>
                                                {habit.title}
                                            </span>
                                            {habit.streakCurrent > 0 && (
                                                <span className="text-2xs text-orange-500 flex-shrink-0">🔥{habit.streakCurrent}天</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </section>
            )}

            <main className="max-w-4xl lg:max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                {error && (
                    <div className="bg-red-50 dark:bg-red-950/30 border border-red-200/50 dark:border-red-800/50 text-red-600 dark:text-red-400 rounded-xl p-4 mb-4 text-sm">
                        {error}
                    </div>
                )}

                {isLoading ? (
                    <div className="space-y-4">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="card p-5">
                                <div className="flex justify-between mb-3">
                                    <div className="skeleton h-3 w-20" />
                                    <div className="skeleton h-3 w-16" />
                                </div>
                                <div className="skeleton h-3 w-full mb-2" />
                                <div className="skeleton h-3 w-4/5 mb-2" />
                                <div className="skeleton h-3 w-3/5" />
                            </div>
                        ))}
                    </div>
                ) : diaries.length === 0 ? (
                    <div className="text-center py-20">
                        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl gradient-bg-soft flex items-center justify-center">
                            <svg className="w-8 h-8 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                        </div>
                        <h3 className="text-lg font-semibold text-surface-600 mb-2">
                            {search || emotionFilter ? '没有找到匹配的日记' : '还没有日记'}
                        </h3>
                        <p className="text-surface-400 text-sm mb-6">
                            {search || emotionFilter ? '试试其他关键词或筛选条件' : '写下你的第一篇日记吧'}
                        </p>
                        {!search && !emotionFilter && (
                            <button
                                onClick={() => navigate('/diary/new')}
                                className="btn-primary text-sm"
                            >
                                写第一篇日记
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="space-y-3">
                            {diaries.map((diary, i) => (
                                <DiaryCard key={diary.id} diary={diary} index={i} />
                            ))}
                        </div>

                        {totalPages > 1 && (
                            <div className="flex justify-center items-center gap-3 mt-8">
                                <button
                                    onClick={() => setPage(Math.max(1, page - 1))}
                                    disabled={page === 1}
                                    className="btn-secondary px-4 py-2 text-sm disabled:opacity-40"
                                >
                                    上一页
                                </button>
                                <span className="text-sm text-surface-400 font-medium">
                                    {page} / {totalPages}
                                </span>
                                <button
                                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                                    disabled={page === totalPages}
                                    className="btn-secondary px-4 py-2 text-sm disabled:opacity-40"
                                >
                                    下一页
                                </button>
                            </div>
                        )}
                    </>
                )}
            </main>

            <button
                onClick={() => navigate('/diary/new')}
                className="floating-action-btn"
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
            </button>

            {showLogoutConfirm && (
                <div
                    className="overlay"
                    onClick={() => setShowLogoutConfirm(false)}
                >
                    <div
                        className="modal-content p-7 max-w-sm mx-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-lg font-semibold text-surface-800 mb-2">确认退出</h3>
                        <p className="text-surface-400 text-sm mb-6">退出后需要重新登录，确认要退出吗？</p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowLogoutConfirm(false)}
                                className="btn-secondary flex-1 py-2.5 text-sm"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleLogout}
                                className="flex-1 bg-red-500 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-red-600 transition-colors"
                            >
                                确认退出
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default DiaryListPage;
