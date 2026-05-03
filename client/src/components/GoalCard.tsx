import type { Goal } from '../types';
import { useGoalStore } from '../stores/goalStore';

interface GoalCardProps {
  goal: Goal;
  onClick: (id: string) => void;
  index?: number;
}

function GoalCard({ goal, onClick }: GoalCardProps) {
  const { updateGoal } = useGoalStore();
  const isOverdue = goal.status === 'ACTIVE' && goal.deadline && new Date(goal.deadline) < new Date();

  const statusLabels: Record<string, { label: string; color: string; dot: string }> = {
    ACTIVE: isOverdue
      ? { label: '已过期', color: 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400', dot: 'bg-red-500' }
      : { label: '进行中', color: 'bg-brand-100 dark:bg-brand-950/40 text-brand-700 dark:text-brand-400', dot: 'bg-brand-500' },
    COMPLETED: { label: '已完成', color: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500' },
    ARCHIVED: { label: '已归档', color: 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400', dot: 'bg-surface-400' },
  };

  const statusInfo = statusLabels[goal.status] || statusLabels.ACTIVE;

  const handleArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await updateGoal(goal.id, { status: 'ARCHIVED' });
  };

  const handleComplete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await updateGoal(goal.id, { status: 'COMPLETED', progress: 100 });
  };

  return (
    <div
      onClick={() => onClick(goal.id)}
      className={`card card-responsive cursor-pointer group ${isOverdue ? 'border-l-4 border-l-red-400' : ''}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={`w-2 h-2 rounded-full ${statusInfo.dot}`} />
          <h3 className="font-semibold text-surface-800 dark:text-surface-200">{goal.title}</h3>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusInfo.color}`}>
          {statusInfo.label}
        </span>
      </div>

      {goal.description && (
        <p className="text-sm text-surface-500 dark:text-surface-400 mb-4 line-clamp-2">{goal.description}</p>
      )}

      <div className="mb-4">
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-surface-400 font-medium">进度</span>
          <span className="text-surface-600 dark:text-surface-400 font-semibold">{goal.progress}%</span>
        </div>
        <div className="progress-bar h-2">
          <div
            className="h-full rounded-full gradient-bg transition-all duration-300"
            style={{ width: `${goal.progress}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {goal.deadline && (
            <div className={`text-xs flex items-center gap-1.5 ${isOverdue ? 'text-red-500' : 'text-surface-400'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {new Date(goal.deadline).toLocaleDateString('zh-CN')}
              {isOverdue && <span className="font-medium">已过期</span>}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {goal.status === 'ACTIVE' && (
            <button
              onClick={handleComplete}
              className="px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded-lg transition-colors"
              title="标记完成"
            >
              完成
            </button>
          )}
          {(goal.status === 'COMPLETED' || goal.status === 'ACTIVE') && (
            <button
              onClick={handleArchive}
              className="px-2 py-1 text-xs font-medium text-surface-500 hover:bg-surface-50 dark:hover:bg-surface-800 rounded-lg transition-colors"
              title="归档"
            >
              归档
            </button>
          )}
        </div>
      </div>

      {goal.aiBreakdown?.milestones && goal.aiBreakdown.milestones.length > 0 && (
        <div className="mt-3 pt-3 border-t border-surface-100 dark:border-surface-800">
          <div className="text-xs text-surface-400 font-medium flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            AI建议 ({goal.aiBreakdown.milestones.length}项)
          </div>
          <div className="mt-2 space-y-1.5">
            {goal.aiBreakdown.milestones.map((ms, idx) => {
              const msCompleted = goal.progress >= ((idx + 1) / goal.aiBreakdown!.milestones.length) * 100;
              return (
                <div key={idx} className="flex items-center gap-2 text-xs">
                  <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${msCompleted ? 'bg-emerald-100 dark:bg-emerald-950/30' : 'bg-surface-100 dark:bg-surface-800'}`}>
                    {msCompleted ? (
                      <svg className="w-2.5 h-2.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <span className="text-surface-400 text-[8px]">{idx + 1}</span>
                    )}
                  </div>
                  <span className={msCompleted ? 'text-surface-400 line-through' : 'text-surface-600 dark:text-surface-400'}>{ms.title}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default GoalCard;
