import { useState, useEffect } from 'react';
import { useGoalStore } from '../stores/goalStore';
import { goalApi } from '../api/goal';
import type { Goal } from '../types';

type AnalysisStep = 'form' | 'questions' | 'generating' | 'plan' | 'confirming';

interface GoalFormProps {
    goalId: string | null;
    goals: Goal[];
    onSave: () => void;
    onDelete: (id: string) => void;
    onClose: () => void;
}

function GoalForm({ goalId, goals, onSave, onDelete, onClose }: GoalFormProps) {
    const { updateGoal } = useGoalStore();
    const editingGoal = goalId ? goals.find((g) => g.id === goalId) : null;

    const [title, setTitle] = useState(editingGoal?.title || '');
    const [description, setDescription] = useState(editingGoal?.description || '');
    const [deadline, setDeadline] = useState(editingGoal?.deadline ? new Date(editingGoal.deadline).toISOString().slice(0, 10) : '');
    const [status, setStatus] = useState(editingGoal?.status || 'ACTIVE');
    const [progress, setProgress] = useState(editingGoal?.progress || 0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const [analysisStep, setAnalysisStep] = useState<AnalysisStep>('form');
    const [createdGoalId, setCreatedGoalId] = useState<string | null>(null);
    const [questions, setQuestions] = useState<Array<{ question: string; context: string }>>([]);
    const [answers, setAnswers] = useState<Record<number, string>>({});
    const [plan, setPlan] = useState<{
        summary: string;
        milestones: Array<{ step: number; title: string; duration: string; startDate?: string; endDate?: string; tasks?: string[] }>;
        tips: string[];
    } | null>(null);
    const [isLoading, setIsLoading] = useState(false);

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
                onSave();
            } else {
                const result = await goalApi.create({
                    title: title.trim(),
                    description: description.trim() || undefined,
                    deadline: deadline || undefined,
                });
                if (result?.data?.id) {
                    setCreatedGoalId(result.data.id);
                    await startAnalysis(result.data.id);
                } else {
                    onSave();
                }
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const startAnalysis = async (gid: string) => {
        setIsLoading(true);
        setAnalysisStep('questions');
        try {
            const res = await goalApi.askQuestions(gid);
            if (res.success && res.data?.questions) {
                setQuestions(res.data.questions);
                const initialAnswers: Record<number, string> = {};
                res.data.questions.forEach((_, i) => { initialAnswers[i] = ''; });
                setAnswers(initialAnswers);
            }
        } catch {
            setAnalysisStep('form');
        } finally {
            setIsLoading(false);
        }
    };

    const handleStartAnalysisForExisting = async () => {
        if (!editingGoal) return;
        setCreatedGoalId(editingGoal.id);
        await startAnalysis(editingGoal.id);
    };

    const handleGeneratePlan = async () => {
        if (!createdGoalId) return;
        const unanswered = Object.values(answers).some(a => !a.trim());
        if (unanswered) return;

        setIsLoading(true);
        setAnalysisStep('generating');
        try {
            const answersArray = questions.map((q, i) => ({
                question: q.question,
                answer: answers[i] || '',
            }));
            const res = await goalApi.generatePlan(createdGoalId, answersArray);
            if (res.success && res.data?.plan) {
                setPlan(res.data.plan);
                setAnalysisStep('plan');
            } else {
                setAnalysisStep('questions');
            }
        } catch {
            setAnalysisStep('questions');
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirmPlan = async () => {
        if (!createdGoalId || !plan) return;
        setIsLoading(true);
        setAnalysisStep('confirming');
        try {
            await goalApi.confirmPlan(createdGoalId, plan);
            onSave();
        } catch {
            setAnalysisStep('plan');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSkipAnalysis = () => {
        onSave();
    };

    if (analysisStep === 'questions' && questions.length > 0) {
        return (
            <div className="overlay items-end sm:items-center" onClick={onClose}>
                <div className="overlay-content max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                    <div className="overlay-handle" />
                    <div className="p-4 sm:p-6">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="w-8 h-8 rounded-xl bg-brand-100 dark:bg-brand-950/40 flex items-center justify-center">
                                <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-semibold text-surface-800">AI 需要了解你</h3>
                        </div>
                        <p className="text-sm text-surface-500 mb-5">回答这些问题，帮助 AI 为你制定更精准的计划</p>

                        <div className="space-y-4">
                            {questions.map((q, i) => (
                                <div key={i} className="bg-surface-50 dark:bg-surface-800/50 rounded-xl p-4">
                                    <div className="flex items-start gap-2 mb-2">
                                        <span className="w-5 h-5 rounded-md gradient-bg text-white flex items-center justify-center text-2xs font-bold flex-shrink-0 mt-0.5">{i + 1}</span>
                                        <div>
                                            <p className="text-sm font-medium text-surface-700 dark:text-surface-300">{q.question}</p>
                                            {q.context && (
                                                <p className="text-2xs text-surface-400 mt-0.5">{q.context}</p>
                                            )}
                                        </div>
                                    </div>
                                    <textarea
                                        value={answers[i] || ''}
                                        onChange={(e) => setAnswers(prev => ({ ...prev, [i]: e.target.value }))}
                                        placeholder="请输入你的回答..."
                                        rows={2}
                                        className="input-field resize-y text-sm mt-2"
                                    />
                                </div>
                            ))}
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button
                                type="button"
                                onClick={handleSkipAnalysis}
                                className="btn-secondary flex-1 py-2.5 text-sm"
                            >
                                跳过
                            </button>
                            <button
                                type="button"
                                onClick={handleGeneratePlan}
                                disabled={isLoading || Object.values(answers).some(a => !a.trim())}
                                className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-50"
                            >
                                {isLoading ? '生成计划中...' : '生成计划'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (analysisStep === 'generating') {
        return (
            <div className="overlay items-end sm:items-center" onClick={onClose}>
                <div className="overlay-content" onClick={(e) => e.stopPropagation()}>
                    <div className="overlay-handle" />
                    <div className="p-4 sm:p-6 text-center">
                        <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-brand-100 flex items-center justify-center animate-pulse">
                            <svg className="w-6 h-6 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                        </div>
                        <h3 className="text-lg font-semibold text-surface-800 mb-2">AI 正在制定计划</h3>
                        <p className="text-sm text-surface-500">结合你的日程和回答，为你量身定制执行方案...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (analysisStep === 'plan' && plan) {
        return (
            <div className="overlay items-end sm:items-center" onClick={onClose}>
                <div className="overlay-content max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                    <div className="overlay-handle" />
                    <div className="p-4 sm:p-6">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="w-8 h-8 rounded-xl bg-brand-100 dark:bg-brand-950/40 flex items-center justify-center">
                                <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-semibold text-surface-800">AI 执行计划</h3>
                        </div>

                        {plan.summary && (
                            <p className="text-sm text-surface-600 dark:text-surface-400 mb-4 bg-brand-50 dark:bg-brand-950/20 rounded-xl p-3">{plan.summary}</p>
                        )}

                        <div className="space-y-3 mb-5">
                            {plan.milestones.map((m) => (
                                <div key={m.step} className="bg-surface-50 dark:bg-surface-800/50 rounded-xl p-4">
                                    <div className="flex items-start gap-2.5">
                                        <span className="w-6 h-6 rounded-lg gradient-bg text-white flex items-center justify-center text-xs font-bold flex-shrink-0">{m.step}</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                                <h4 className="text-sm font-semibold text-surface-700 dark:text-surface-300">{m.title}</h4>
                                            </div>
                                            <p className="text-2xs text-surface-400 mt-0.5">{m.duration}</p>
                                            {m.tasks && m.tasks.length > 0 && (
                                                <ul className="mt-2 space-y-1">
                                                    {m.tasks.map((task, ti) => (
                                                        <li key={ti} className="text-xs text-surface-500 dark:text-surface-400 flex items-start gap-1.5">
                                                            <span className="text-surface-300 mt-1">•</span>
                                                            {task}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {plan.tips && plan.tips.length > 0 && (
                            <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl p-3 mb-5">
                                <h5 className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2">💡 建议</h5>
                                <ul className="space-y-1">
                                    {plan.tips.map((tip, i) => (
                                        <li key={i} className="text-xs text-amber-600 dark:text-amber-300">{tip}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={handleSkipAnalysis}
                                className="btn-secondary flex-1 py-2.5 text-sm"
                            >
                                仅保存目标
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmPlan}
                                disabled={isLoading}
                                className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-50"
                            >
                                {isLoading ? '确认中...' : '确认并添加到日程'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="overlay items-end sm:items-center" onClick={onClose}>
            <div className="overlay-content" onClick={(e) => e.stopPropagation()}>
                <div className="overlay-handle" />
                <div className="p-4 sm:p-6">
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

                    {editingGoal && editingGoal.aiBreakdown?.milestones && editingGoal.aiBreakdown.milestones.length > 0 && (
                        <div className="mt-5 bg-brand-50 rounded-xl p-4">
                            <h4 className="text-sm font-semibold text-surface-700 mb-3 flex items-center gap-1.5">
                                <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                </svg>
                                AI执行计划
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
                                onClick={handleStartAnalysisForExisting}
                                className="px-5 bg-violet-100 text-violet-700 py-2.5 rounded-xl text-sm font-medium hover:bg-violet-200 transition-colors"
                            >
                                AI分析
                            </button>
                        )}

                        <button
                            onClick={handleSubmit}
                            disabled={isSubmitting || !title.trim()}
                            className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-50"
                        >
                            {isSubmitting ? '保存中...' : editingGoal ? '保存' : '创建并分析'}
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
