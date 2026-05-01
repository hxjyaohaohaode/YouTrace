import { useState } from 'react';
import type { Habit } from '../types';
interface HabitFormProps {
    habit?: Habit;
    onSubmit: (data: { title: string; description?: string; frequency: string; targetDays: number; goalId?: string }) => void;
    onDelete?: () => void;
    onCancel: () => void;
}

const FREQUENCY_OPTIONS = [
    { value: 'DAILY', label: '每日' },
    { value: 'WEEKLY', label: '每周' },
    { value: 'WEEKDAYS', label: '工作日' },
    { value: 'CUSTOM', label: '自定义' },
];

function HabitForm({ habit, onSubmit, onDelete, onCancel }: HabitFormProps) {
    const [title, setTitle] = useState(habit?.title || '');
    const [description, setDescription] = useState(habit?.description || '');
    const [frequency, setFrequency] = useState(habit?.frequency || 'DAILY');
    const [targetDays, setTargetDays] = useState(habit?.targetDays || 30);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;
        onSubmit({
            title: title.trim(),
            description: description.trim() || undefined,
            frequency,
            targetDays,
        });
    };

    return (
        <form onSubmit={handleSubmit} className="card p-6">
            <h3 className="text-lg font-semibold text-surface-800 mb-5">
                {habit ? '编辑习惯' : '新建习惯'}
            </h3>

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-surface-600 mb-2">习惯名称</label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="例如：每天阅读30分钟"
                        className="input-field"
                        required
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-surface-600 mb-2">描述（可选）</label>
                    <input
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="习惯的具体描述"
                        className="input-field" />
                </div>

                <div>
                    <label className="block text-sm font-medium text-surface-600 mb-2">频率</label>
                    <div className="flex gap-2">
                        {FREQUENCY_OPTIONS.map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setFrequency(opt.value as Habit['frequency'])}
                                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${frequency === opt.value
                                    ? 'bg-brand-500 text-white shadow-sm'
                                    : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
                                    }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-surface-600 mb-2">目标天数</label>
                    <input
                        type="number"
                        value={targetDays}
                        onChange={(e) => setTargetDays(Number(e.target.value))}
                        min={1}
                        max={365}
                        className="input-field" />
                </div>
            </div>

            <div className="flex gap-3 mt-7">
                <button
                    type="button"
                    onClick={onCancel}
                    className="btn-secondary flex-1 py-2.5 text-sm"
                >
                    取消
                </button>
                {habit && onDelete && (
                    <button
                        type="button"
                        onClick={onDelete}
                        className="px-4 py-2.5 text-sm text-red-500 dark:text-red-400 font-medium rounded-xl hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                        删除
                    </button>
                )}
                <button
                    type="submit"
                    disabled={!title.trim()}
                    className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-50"
                >
                    {habit ? '更新' : '创建'}
                </button>
            </div>
        </form>
    );
}

export default HabitForm;
