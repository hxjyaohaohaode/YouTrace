import { useEffect, useState, useMemo } from 'react';
import { useHabitStore } from '../stores/habitStore';
import { useGoalStore } from '../stores/goalStore';
import HabitCard from '../components/HabitCard';
import HabitForm from '../components/HabitForm';
import type { Habit } from '../types';

function HabitListPage() {
  const { habits, isLoading, error, fetchHabits, createHabit, updateHabit, deleteHabit, toggleHabit } = useHabitStore();
  const { fetchGoals } = useGoalStore();
  const [showForm, setShowForm] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);

  useEffect(() => {
    fetchHabits();
    fetchGoals();
  }, [fetchHabits, fetchGoals]);

  const handleToggle = async (id: string, date?: string) => {
    await toggleHabit(id, date);
  };

  const handleCreate = async (data: { title: string; description?: string; frequency?: string; targetDays?: number; goalId?: string }) => {
    await createHabit(data);
    setShowForm(false);
  };

  const handleUpdate = async (data: { title: string; description?: string; frequency?: string; targetDays?: number; goalId?: string }) => {
    if (editingHabit) {
      await updateHabit(editingHabit.id, data);
      setEditingHabit(null);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteHabit(id);
    setEditingHabit(null);
  };

  const handleEdit = (habit: Habit) => {
    setEditingHabit(habit);
  };

  const stats = useMemo(() => {
    const total = habits.length;
    const completedToday = habits.filter(h => h.todayCompleted).length;
    const activeStreaks = habits.filter(h => h.streakCurrent > 0).length;
    const linkedToGoals = habits.filter(h => h.goalId).length;
    const avgStreak = total > 0 ? Math.round(habits.reduce((sum, h) => sum + h.streakCurrent, 0) / total) : 0;
    const bestStreak = total > 0 ? Math.max(...habits.map(h => h.streakLongest)) : 0;
    const todayRate = total > 0 ? Math.round((completedToday / total) * 100) : 0;

    return { total, completedToday, activeStreaks, linkedToGoals, avgStreak, bestStreak, todayRate };
  }, [habits]);

  const habitInsight = useMemo(() => {
    if (habits.length === 0) return '';
    const parts: string[] = [];
    if (stats.todayRate === 100) parts.push('🎉 今日习惯全部完成！');
    else if (stats.todayRate >= 50) parts.push(`今日已完成${stats.todayRate}%，继续加油`);
    else if (stats.todayRate > 0) parts.push(`今日仅完成${stats.todayRate}%，别放弃`);
    else parts.push('今日还未开始打卡');

    if (stats.avgStreak >= 7) parts.push(`平均连续${stats.avgStreak}天，非常棒`);
    else if (stats.avgStreak >= 3) parts.push(`平均连续${stats.avgStreak}天，保持节奏`);

    const uncompleted = habits.filter(h => !h.todayCompleted);
    if (uncompleted.length > 0 && uncompleted.length <= 3) {
      parts.push(`待完成: ${uncompleted.map(h => h.title).join('、')}`);
    }

    return parts.join('。');
  }, [habits, stats]);

  if (showForm || editingHabit) {
    return (
      <div className="page-container">
        <header className="page-header">
          <div className="md:max-w-3xl lg:max-w-4xl mx-auto px-4 sm:px-8 lg:px-12 py-3 sm:py-4">
            <h1 className="text-lg font-semibold text-surface-800 dark:text-surface-100">{editingHabit ? '编辑习惯' : '新建习惯'}</h1>
          </div>
        </header>
        <main className="md:max-w-3xl lg:max-w-4xl mx-auto px-4 sm:px-8 lg:px-12 py-5 sm:py-6">
          <HabitForm
            habit={editingHabit || undefined}
            onSubmit={editingHabit ? handleUpdate : handleCreate}
            onDelete={editingHabit ? () => handleDelete(editingHabit.id) : undefined}
            onCancel={() => { setShowForm(false); setEditingHabit(null); }}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="page-container">
      <header className="page-header">
        <div className="md:max-w-3xl lg:max-w-4xl mx-auto px-4 sm:px-8 lg:px-12 py-3 sm:py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-surface-800 dark:text-surface-100">习惯</h1>
            <p className="text-xs text-surface-400 mt-0.5">{habits.length} 个习惯</p>
          </div>
        </div>
      </header>

      <main className="md:max-w-3xl lg:max-w-4xl mx-auto px-4 sm:px-8 lg:px-12 py-3 sm:py-4">
        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200/50 dark:border-red-800/50 text-red-600 dark:text-red-400 rounded-xl p-4 mb-4 text-sm">
            {error}
          </div>
        )}

        {habits.length > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <div className="card p-3.5 text-center">
                <p className="text-2xl font-bold text-brand-500">{stats.todayRate}%</p>
                <p className="text-2xs text-surface-400 mt-0.5">今日完成率</p>
              </div>
              <div className="card p-3.5 text-center">
                <p className="text-2xl font-bold text-orange-500">{stats.avgStreak}</p>
                <p className="text-2xs text-surface-400 mt-0.5">平均连续天数</p>
              </div>
              <div className="card p-3.5 text-center">
                <p className="text-2xl font-bold text-amber-500">{stats.bestStreak}</p>
                <p className="text-2xs text-surface-400 mt-0.5">最长连续天数</p>
              </div>
              <div className="card p-3.5 text-center">
                <p className="text-2xl font-bold text-blue-500">{stats.linkedToGoals}</p>
                <p className="text-2xs text-surface-400 mt-0.5">关联目标数</p>
              </div>
            </div>

            {habitInsight && (
              <div className="bg-gradient-to-r from-brand-50 to-blue-50 dark:from-brand-950/20 dark:to-blue-950/20 rounded-xl p-3.5 mb-5 border border-brand-100 dark:border-brand-900/30">
                <div className="flex items-start gap-2">
                  <span className="text-sm flex-shrink-0">💡</span>
                  <p className="text-xs text-surface-600 dark:text-surface-400 leading-relaxed">{habitInsight}</p>
                </div>
              </div>
            )}
          </>
        )}

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card card-responsive">
                <div className="flex justify-between mb-3">
                  <div className="skeleton h-4 w-32" />
                  <div className="skeleton h-10 w-10 rounded-full" />
                </div>
                <div className="skeleton h-3 w-48 mb-2" />
                <div className="flex gap-1 mt-3">
                  {[1, 2, 3, 4, 5, 6, 7].map(j => <div key={j} className="skeleton w-6 h-6 rounded" />)}
                </div>
              </div>
            ))}
          </div>
        ) : habits.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-orange-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" /></svg>
            </div>
            <h3 className="text-lg font-semibold text-surface-600 mb-2">还没有习惯</h3>
            <p className="text-surface-400 text-sm mb-6">开始培养一个好习惯吧</p>
            <button
              onClick={() => setShowForm(true)}
              className="btn-primary text-sm"
            >
              创建第一个习惯
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {habits.map((habit, i) => (
              <HabitCard key={habit.id} habit={habit} onToggle={handleToggle} onEdit={handleEdit} index={i} />
            ))}
          </div>
        )}
      </main>

      <button
        onClick={() => setShowForm(true)}
        className="floating-action-btn"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
  );
}

export default HabitListPage;
