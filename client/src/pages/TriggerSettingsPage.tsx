import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTriggerStore } from '../stores/triggerStore';
import type { TriggerItem } from '../api/trigger';

const TRIGGER_META: Record<string, { label: string; icon: string; description: string; configLabels: Record<string, string> }> = {
    MORNING_BRIEF: {
        label: '晨间简报',
        icon: '☀️',
        description: '每天早上推送昨日回顾、今日日程和天气预报',
        configLabels: { hour: '推送时间（时）', minute: '推送时间（分）' },
    },
    EVENING_REVIEW: {
        label: '晚间复盘',
        icon: '🌙',
        description: '每天晚上提醒写日记和习惯打卡',
        configLabels: { hour: '推送时间（时）', minute: '推送时间（分）' },
    },
    EMOTION_ALERT: {
        label: '情绪关怀',
        icon: '💚',
        description: '连续多天情绪低落时发送关怀提醒',
        configLabels: { days: '连续天数', threshold: '情绪阈值', hour: '检查时间（时）', minute: '检查时间（分）' },
    },
    GOAL_REMINDER: {
        label: '目标提醒',
        icon: '🎯',
        description: '目标截止日期前提醒你加快进度',
        configLabels: { daysBefore: '提前天数', hour: '推送时间（时）', minute: '推送时间（分）' },
    },
    WEATHER_ALERT: {
        label: '天气预警',
        icon: '⚠️',
        description: '恶劣天气预警推送',
        configLabels: { hour: '检查时间（时）', minute: '检查时间（分）' },
    },
};

function TriggerCard({ trigger }: { trigger: TriggerItem }) {
    const { updateTrigger } = useTriggerStore();
    const meta = TRIGGER_META[trigger.type] || { label: trigger.type, icon: '🔔', description: '', configLabels: {} };
    const [editingConfig, setEditingConfig] = useState<Record<string, unknown>>({ ...trigger.config });
    const [showConfig, setShowConfig] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const handleToggle = useCallback(async () => {
        setIsSaving(true);
        await updateTrigger(trigger.id, { isActive: !trigger.isActive });
        setIsSaving(false);
    }, [trigger.id, trigger.isActive, updateTrigger]);

    const handleSaveConfig = useCallback(async () => {
        setIsSaving(true);
        await updateTrigger(trigger.id, { config: editingConfig });
        setIsSaving(false);
        setShowConfig(false);
    }, [trigger.id, editingConfig, updateTrigger]);

    return (
        <div className={`card p-4 transition-all ${!trigger.isActive ? 'opacity-60' : ''}`}>
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-surface-50 dark:bg-surface-800 flex items-center justify-center text-lg flex-shrink-0">
                    {meta.icon}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">{meta.label}</p>
                    <p className="text-xs text-surface-400 mt-0.5">{meta.description}</p>
                </div>
                <button
                    onClick={handleToggle}
                    disabled={isSaving}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${trigger.isActive ? 'bg-brand-500' : 'bg-surface-200 dark:bg-surface-700'}`}
                >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${trigger.isActive ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
            </div>

            <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-surface-400">
                    {trigger.config.hour != null && (
                        <span>每天 {String(trigger.config.hour).padStart(2, '0')}:{String(trigger.config.minute || 0).padStart(2, '0')}</span>
                    )}
                    {trigger.config.daysBefore != null && (
                        <span>提前 {String(trigger.config.daysBefore)} 天</span>
                    )}
                    {trigger.config.days != null && (
                        <span>连续 {String(trigger.config.days)} 天</span>
                    )}
                    {trigger.lastTriggeredAt && (
                        <span>· 上次触发 {new Date(trigger.lastTriggeredAt).toLocaleDateString('zh-CN')}</span>
                    )}
                </div>
                <button
                    onClick={() => setShowConfig(!showConfig)}
                    className="text-xs text-brand-500 hover:text-brand-600 font-medium"
                >
                    {showConfig ? '收起' : '设置'}
                </button>
            </div>

            {showConfig && (
                <div className="mt-3 pt-3 border-t border-surface-100 dark:border-surface-800 space-y-3">
                    {Object.entries(meta.configLabels).map(([key, label]) => (
                        <div key={key} className="flex items-center gap-3">
                            <label className="text-xs text-surface-500 w-28 flex-shrink-0">{label}</label>
                            <input
                                type="number"
                                value={editingConfig[key] as number ?? ''}
                                onChange={(e) => setEditingConfig((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                                className="input-field py-1.5 px-3 text-sm flex-1"
                                min={0}
                                max={key === 'hour' ? 23 : key === 'minute' ? 59 : key === 'daysBefore' ? 30 : key === 'days' ? 14 : key === 'threshold' ? 100 : undefined}
                            />
                        </div>
                    ))}
                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            onClick={() => { setEditingConfig({ ...trigger.config }); setShowConfig(false); }}
                            className="px-3 py-1.5 text-xs font-medium text-surface-500 hover:text-surface-700 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleSaveConfig}
                            disabled={isSaving}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-brand-500 hover:bg-brand-600 rounded-lg transition-colors disabled:opacity-50"
                        >
                            {isSaving ? '保存中...' : '保存'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function TriggerSettingsPage() {
    const navigate = useNavigate();
    const { triggers, isLoading, fetchTriggers } = useTriggerStore();

    useEffect(() => {
        fetchTriggers();
    }, [fetchTriggers]);

    return (
        <div className="page-container">
            <header className="page-header safe-top">
                <div className="md:max-w-3xl lg:max-w-4xl mx-auto px-4 sm:px-8 lg:px-12 py-3 sm:py-4 flex items-center gap-3">
                    <button onClick={() => navigate(-1)} className="p-1 -ml-1 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <h1 className="text-lg font-semibold text-surface-800 dark:text-surface-100">智能提醒设置</h1>
                </div>
            </header>

            <main className="md:max-w-3xl lg:max-w-4xl mx-auto px-4 sm:px-8 lg:px-12 py-3 sm:py-4">
                {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : (
                    <div className="space-y-3">
                        <p className="text-xs text-surface-400 mb-2">
                            管理你的智能提醒触发器，自定义推送时间和参数
                        </p>
                        {triggers.map((trigger) => (
                            <TriggerCard key={trigger.id} trigger={trigger} />
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}

export default TriggerSettingsPage;
