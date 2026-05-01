import { useEffect, useState } from 'react';
import { useHabitStore } from '../stores/habitStore';
import HabitCard from '../components/HabitCard';
import HabitForm from '../components/HabitForm';
import type { Habit } from '../types';

function HabitListPage() {
  const { habits, isLoading, error, fetchHabits, createHabit, updateHabit, deleteHabit, toggleHabit } = useHabitStore();
  const [showForm, setShowForm] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);

  useEffect(() => {
    fetchHabits();
  }, [fetchHabits]);

  const handleToggle = async (id: string, date?: string) => {
    await toggleHabit(id, date);
  };

  const handleCreate = async (data: { title: string; description?: string; frequency?: string; targetDays?: number }) => {
    await createHabit(data);
    setShowForm(false);
  };

  const handleUpdate = async (data: { title: string; description?: string; frequency?: string; targetDays?: number }) => {
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

  if (showForm || editingHabit) {
    return (
      <div className="page-container">
        <header className="page-header">
          <div className="max-w-3xl lg:max-w-4xl mx-auto px-5 sm:px-8 lg:px-12 py-4">
            <h1 className="text-lg font-semibold text-surface-800 dark:text-surface-100">{editingHabit ? '编辑习惯' : '新建习惯'}</h1>
          </div>
        </header>
        <main className="max-w-3xl lg:max-w-4xl mx-auto px-5 sm:px-8 lg:px-12 py-6">
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
        <div className="max-w-3xl lg:max-w-4xl mx-auto px-5 sm:px-8 lg:px-12 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-surface-800 dark:text-surface-100">习惯</h1>
            <p className="text-xs text-surface-400 mt-0.5">{habits.length} 个习惯</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl lg:max-w-4xl mx-auto px-5 sm:px-8 lg:px-12 py-4">
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
