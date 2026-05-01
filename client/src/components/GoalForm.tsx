import { useState, useEffect } from 'react';
import { useGoalStore } from '../stores/goalStore';
import type { Goal } from '../types';

interface GoalFormProps {
    goalId: string | null;
    goals: Goal[];
    onSave: () => void;
    onDelete: (id: string) => void;
    onClose: () => void;
}

function GoalForm({ goalId, goals, onSave, onDelete, onClose }: GoalFormProps) {
    const { createGoal, updateGoal, breakdownGoal } = useGoalStore();
    const editingGoal = goalId ? goals.find((g) => g.id === goalId) : null;

    const [title, setTitle] = useState(editingGoal?.title || '');
    const [description, setDescription] = useState(editingGoal?.description || '');
    const [deadline, setDeadline] = useState(editingGoal?.deadline ? new Date(editingGoal.deadline).toISOString().slice(0, 10) : '');
    const [status, setStatus] = useState(editingGoal?.status || 'ACTIVE');
    const [progress, setProgress] = useState(editingGoal?.progress || 0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isBreakingDown, setIsBreakingDown] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    useEffect(() => {
        if (editingGoal) {
            setTitle(editingGoal.title);
            setDescription(editingGoal.description || '');
            setDeadline(editingGoal.deadline ? new Date(editingGoal.deadline).toISOString().slice(0, 10) : '');
            setStatus(editingGoal.status);
            setProgress(editingGoal.progress);
        }
    }, [editingGoal]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;
        setIsSubmitting(true);

        try {
            if (editingGoal) {
                await updateGoal(editingGoal.id, {
                    title: title.trim(),
                    description: description.trim() || undefined,
                    deadline: deadline || undefined,
                    progress,
                    status,
                });
            } else {
                await createGoal({
                    title: title.trim(),
                    description: description.trim() || undefined,
                    deadline: deadline || undefined,
                });
            }
            onSave();
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBreakdown = async () => {
        if (!editingGoal) return;
        setIsBreakingDown(true);
        try {
            await breakdownGoal(editingGoal.id);
        } finally {
            setIsBreakingDown(false);
        }
    };

    return (
        <div className="overlay items-end sm:items-center" onClick={onClose}>
            <div className="overlay-content" onClick={(e) => e.stopPropagation()}>
                <div className="overlay-handle" />
                <div className="p-6">
                    <h3 className="text-lg font-semibold text-surface-800 mb-5">
                        {editingGoal ? '编辑目标' : '新建目标'}
                    </h3>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-surface-600 mb-2">目标名称</label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="例如：学习一门新语言"
                                className="input-field"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-surface-600 mb-2">目标描述（可选）</label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="详细描述你的目标"
                                rows={2}
                                className="input-field resize-y" />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-surface-600 mb-2">截止日期（可选）</label>
                            <input
                                type="date"
                                value={deadline}
                                onChange={(e) => setDeadline(e.target.value)}
                                className="input-field" />
                        </div>

                        {editingGoal && (
                            <>
                                <div>
                                    <label className="block text-sm font-medium text-surface-600 mb-2">进度: {progress}%</label>
                                    <input
                                        type="range"
                                        min={0}
                                        max={100}
                                        value={progress}
                                        onChange={(e) => setProgress(Number(e.target.value))}
                                        className="w-full accent-brand-500" />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-surface-600 mb-2">状态</label>
                                    <select
                                        value={status}
                                        onChange={(e) => setStatus(e.target.value as Goal['status'])}
                                        className="input-field"
                                    >
                                        <option value="ACTIVE">进行中</option>
                                        <option value="COMPLETED">已完成</option>
                                        <option value="ARCHIVED">已归档</option>
                                    </select>
                                </div>
                            </>
                        )}
                    </form>

                    {editingGoal && editingGoal.aiBreakdown?.milestones && (
                        <div className="mt-5 bg-brand-50 rounded-xl p-4">
                            <h4 className="text-sm font-semibold text-surface-700 mb-3 flex items-center gap-1.5">
                                <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                </svg>
                                AI分步骤
                            </h4>
                            <div className="space-y-2">
                                {editingGoal.aiBreakdown.milestones.map((m) => (
                                    <div key={m.step} className="text-xs text-surface-600 flex items-start gap-2">
                                        <span className="w-5 h-5 rounded-md gradient-bg text-white flex items-center justify-center text-2xs font-bold flex-shrink-0 mt-0.5">{m.step}</span>
                                        <div>
                                            <span className="font-medium">{m.title}</span>
                                            <span className="text-surface-400 ml-1.5">({m.duration})</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex gap-3 mt-7">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn-secondary flex-1 py-2.5 text-sm"
                        >
                            取消
                        </button>

                        {editingGoal && (
                            <button
                                type="button"
                                onClick={handleBreakdown}
                                disabled={isBreakingDown}
                                className="px-5 bg-violet-100 text-violet-700 py-2.5 rounded-xl text-sm font-medium hover:bg-violet-200 transition-colors disabled:opacity-50"
                            >
                                {isBreakingDown ? '分析中...' : 'AI分析'}
                            </button>
                        )}

                        <button
                            onClick={handleSubmit}
                            disabled={isSubmitting || !title.trim()}
                            className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-50"
                        >
                            {isSubmitting ? '保存中...' : editingGoal ? '保存' : '创建'}
                        </button>
                    </div>

                    {editingGoal && !showDeleteConfirm && (
                        <button
                            onClick={() => setShowDeleteConfirm(true)}
                            className="w-full mt-4 text-red-500 hover:text-red-600 text-sm py-2 font-medium"
                        >
                            删除目标
                        </button>
                    )}

                    {editingGoal && showDeleteConfirm && (
                        <div className="w-full mt-4 p-3 bg-red-50 dark:bg-red-950/30 rounded-xl border border-red-100 dark:border-red-900/50">
                            <p className="text-sm text-red-700 dark:text-red-400 font-medium mb-2">确定要删除此目标吗？此操作不可撤销。</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setShowDeleteConfirm(false)}
                                    className="flex-1 py-1.5 text-sm text-surface-600 dark:text-surface-300 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-700"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={() => onDelete(editingGoal.id)}
                                    className="flex-1 py-1.5 text-sm text-white bg-red-500 rounded-lg hover:bg-red-600"
                                >
                                    确认删除
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default GoalForm;
