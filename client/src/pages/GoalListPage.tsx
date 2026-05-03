import { useEffect, useState, useMemo } from 'react';
import { useGoalStore } from '../stores/goalStore';
import GoalCard from '../components/GoalCard';
import GoalForm from '../components/GoalForm';

type GoalFilter = 'active' | 'completed' | 'archived' | 'overdue';

function GoalListPage() {
  const { goals, isLoading, error, fetchGoals, deleteGoal } = useGoalStore();
  const [showForm, setShowForm] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [filter, setFilter] = useState<GoalFilter>('active');

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  const handleGoalClick = (id: string) => {
    setEditingGoalId(id);
  };

  const categorizedGoals = useMemo(() => {
    const now = new Date();
    return {
      active: goals.filter((g) => g.status === 'ACTIVE' && (!g.deadline || new Date(g.deadline) >= now)),
      overdue: goals.filter((g) => g.status === 'ACTIVE' && g.deadline && new Date(g.deadline) < now),
      completed: goals.filter((g) => g.status === 'COMPLETED'),
      archived: goals.filter((g) => g.status === 'ARCHIVED'),
    };
  }, [goals]);

  const displayGoals = categorizedGoals[filter];

  if (showForm || editingGoalId) {
    return (
      <div className="page-container">
        <header className="page-header">
          <div className="md:max-w-3xl lg:max-w-4xl mx-auto px-4 sm:px-8 lg:px-12 py-3 sm:py-4">
            <h1 className="text-lg font-semibold text-surface-800 dark:text-surface-100">
              {editingGoalId ? '编辑目标' : '新建目标'}
            </h1>
          </div>
        </header>
        <main className="md:max-w-3xl lg:max-w-4xl mx-auto px-4 sm:px-8 lg:px-12 py-5 sm:py-6">
          <GoalForm
            goalId={editingGoalId}
            goals={goals}
            onSave={() => { setShowForm(false); setEditingGoalId(null); fetchGoals(); }}
            onDelete={(id) => { deleteGoal(id).finally(() => { setEditingGoalId(null); fetchGoals(); }); }}
            onClose={() => { setShowForm(false); setEditingGoalId(null); }}
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
            <h1 className="text-2xl font-bold text-surface-800 dark:text-surface-100">目标</h1>
            <p className="text-xs text-surface-400 mt-0.5">让AI帮你拆解目标</p>
          </div>
        </div>
      </header>

      <main className="md:max-w-3xl lg:max-w-4xl mx-auto px-4 sm:px-8 lg:px-12 py-3 sm:py-4">
        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200/50 dark:border-red-800/50 text-red-600 dark:text-red-400 rounded-xl p-4 mb-4 text-sm">
            {error}
          </div>
        )}

        {goals.length > 0 && (
          <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-hide">
            {([
              { key: 'active' as GoalFilter, label: '进行中', count: categorizedGoals.active.length },
              { key: 'overdue' as GoalFilter, label: '已过期', count: categorizedGoals.overdue.length },
              { key: 'completed' as GoalFilter, label: '已完成', count: categorizedGoals.completed.length },
              { key: 'archived' as GoalFilter, label: '已归档', count: categorizedGoals.archived.length },
            ]).map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`chip px-4 py-1.5 text-sm whitespace-nowrap ${filter === f.key ? 'chip-active' : 'chip-inactive'}`}
              >
                {f.label} {f.count}
              </button>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card card-responsive">
                <div className="flex justify-between mb-3">
                  <div className="skeleton h-4 w-32" />
                  <div className="skeleton h-6 w-16 rounded-full" />
                </div>
                <div className="skeleton h-3 w-48 mb-3" />
                <div className="skeleton h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
        ) : goals.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-brand-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>
            </div>
            <h3 className="text-lg font-semibold text-surface-600 mb-2">还没有目标</h3>
            <p className="text-surface-400 text-sm mb-6">设定一个目标，AI帮你拆解步骤</p>
            <button
              onClick={() => { setEditingGoalId(null); setShowForm(true); }}
              className="btn-primary text-sm"
            >
              创建第一个目标
            </button>
          </div>
        ) : displayGoals.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-surface-400 text-sm">暂无{filter === 'active' ? '进行中' : filter === 'overdue' ? '已过期' : filter === 'completed' ? '已完成' : '已归档'}的目标</p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayGoals.map((goal, i) => (
              <GoalCard key={goal.id} goal={goal} onClick={handleGoalClick} index={i} />
            ))}
          </div>
        )}
      </main>

      <button
        onClick={() => { setEditingGoalId(null); setShowForm(true); }}
        className="floating-action-btn"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
  );
}

export default GoalListPage;
