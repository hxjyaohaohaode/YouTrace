import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAIStore } from '../stores/aiStore';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';
import type { MemoryItem, Profile } from '../types';
import { IconUser, IconBolt, IconHeart, IconTarget, IconPencil, IconPlus, IconXMark, IconTag, IconBrain } from '../components/Icons';

const profileSections = [
  {
    title: '基本信息',
    Icon: IconUser,
    fields: [
      { key: 'nickname', label: '昵称', placeholder: '你的名字' },
      { key: 'gender', label: '性别', placeholder: '男/女/其他' },
      { key: 'birthday', label: '生日', placeholder: '如: 1995-06-15' },
      { key: 'location', label: '所在地', placeholder: '如: 北京' },
      { key: 'education', label: '学历', placeholder: '如: 本科' },
      { key: 'relationship', label: '感情状况', placeholder: '如: 单身/恋爱/已婚' },
    ],
  },
  {
    title: '职业信息',
    Icon: IconTarget,
    fields: [
      { key: 'occupation', label: '职业', placeholder: '如: 软件工程师' },
      { key: 'workSchedule', label: '工作时间', placeholder: '如: 9:00-18:00' },
    ],
  },
  {
    title: '健康信息',
    Icon: IconHeart,
    fields: [
      { key: 'height', label: '身高', placeholder: '如: 175cm' },
      { key: 'weight', label: '体重', placeholder: '如: 70kg' },
      { key: 'healthCondition', label: '健康状况', placeholder: '如: 健康/过敏等' },
      { key: 'dietPreference', label: '饮食偏好', placeholder: '如: 清淡/素食等' },
      { key: 'sleepSchedule', label: '作息时间', placeholder: '如: 23:00-7:00' },
    ],
  },
  {
    title: '兴趣爱好',
    Icon: IconBolt,
    fields: [
      { key: 'hobbies', label: '爱好', placeholder: '如: 阅读、跑步、摄影' },
      { key: 'favoriteFoods', label: '喜欢的食物', placeholder: '如: 火锅、寿司' },
      { key: 'dislikedFoods', label: '不喜欢的食物', placeholder: '如: 香菜' },
      { key: 'favoriteMusic', label: '喜欢的音乐', placeholder: '如: 古典、流行' },
      { key: 'favoriteSports', label: '喜欢的运动', placeholder: '如: 篮球、游泳' },
    ],
  },
  {
    title: '性格与目标',
    Icon: IconTarget,
    fields: [
      { key: 'personality', label: '性格特点', placeholder: '如: 内向、细心' },
      { key: 'lifeGoals', label: '人生目标', placeholder: '如: 保持健康、学习新技能' },
      { key: 'bio', label: '自我介绍', placeholder: '简单介绍自己' },
    ],
  },
];

const categoryConfig: Record<string, { label: string; Icon: typeof IconUser }> = {
  basic: { label: '基本信息', Icon: IconUser },
  health: { label: '健康信息', Icon: IconHeart },
  lifestyle: { label: '生活方式', Icon: IconBolt },
  preference: { label: '偏好', Icon: IconTag },
  work: { label: '工作', Icon: IconTarget },
  social: { label: '社交', Icon: IconUser },
};

export default function ProfilePage() {
  const navigate = useNavigate();
  const { logout } = useAuthStore();
  const { mode: themeMode, setMode: setThemeMode } = useThemeStore();
  const { profile, memoryItems, memoryGrouped, fetchProfile, updateProfile, fetchMemory, addMemory, deleteMemory } = useAIStore();
  const [editData, setEditData] = useState<Record<string, string>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'memory'>('profile');
  const [showAddMemory, setShowAddMemory] = useState(false);
  const [newMemory, setNewMemory] = useState({ category: 'basic', key: '', value: '' });

  useEffect(() => {
    fetchProfile();
    fetchMemory();
  }, [fetchProfile, fetchMemory]);

  useEffect(() => {
    if (profile) {
      const data: Record<string, string> = {};
      profileSections.forEach((section) => {
        section.fields.forEach((field) => {
          data[field.key] = profile[field.key as keyof Profile] || '';
        });
      });
      setEditData(data);
    }
  }, [profile]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const changedData: Record<string, string> = {};
      for (const [key, value] of Object.entries(editData)) {
        const originalValue = profile?.[key as keyof Profile] || '';
        if (value !== originalValue) {
          changedData[key] = value;
        }
      }
      if (Object.keys(changedData).length > 0) {
        await updateProfile(changedData);
      }
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddMemory = async () => {
    if (!newMemory.key || !newMemory.value) return;
    await addMemory(newMemory);
    setNewMemory({ category: 'basic', key: '', value: '' });
    setShowAddMemory(false);
  };

  const filledCount = profileSections.reduce((count, section) => {
    return count + section.fields.filter((f) => editData[f.key]?.trim()).length;
  }, 0);

  const totalFields = profileSections.reduce((count, section) => count + section.fields.length, 0);
  const completionPercent = Math.round((filledCount / totalFields) * 100);

  return (
    <div className="page-container">
      <header className="page-header safe-top">
        <div className="max-w-3xl lg:max-w-4xl mx-auto px-5 sm:px-8 lg:px-12 py-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-surface-800 dark:text-surface-100">用户画像</h1>
          {activeTab === 'profile' && (
            <button
              onClick={() => setIsEditing(!isEditing)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isEditing ? 'bg-brand-50 dark:bg-brand-950/30 text-brand-600 dark:text-brand-400' : 'bg-surface-50 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700'
                }`}
            >
              <IconPencil size={14} />
              {isEditing ? '取消' : '编辑'}
            </button>
          )}
        </div>
      </header>

      <div className="max-w-3xl lg:max-w-4xl mx-auto px-5 sm:px-8 lg:px-12 py-4">
        <div className="grid grid-cols-5 gap-2 mb-4 md:hidden">
          <button onClick={() => navigate('/goals')} className="card p-3 flex flex-col items-center gap-1.5">
            <div className="w-9 h-9 rounded-xl bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center">
              <IconTarget size={18} className="text-orange-500" />
            </div>
            <span className="text-xs text-surface-600">目标</span>
          </button>
          <button onClick={() => navigate('/habits')} className="card p-3 flex flex-col items-center gap-1.5">
            <div className="w-9 h-9 rounded-xl bg-green-50 dark:bg-green-950/30 flex items-center justify-center">
              <IconBolt size={18} className="text-green-500" />
            </div>
            <span className="text-xs text-surface-600">习惯</span>
          </button>
          <button onClick={() => navigate('/stats')} className="card p-3 flex flex-col items-center gap-1.5">
            <div className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-950/30 flex items-center justify-center">
              <IconHeart size={18} className="text-purple-500" />
            </div>
            <span className="text-xs text-surface-600">统计</span>
          </button>
          <button onClick={() => { const modes = ['light', 'dark', 'system'] as const; const idx = modes.indexOf(themeMode); setThemeMode(modes[(idx + 1) % modes.length]); }} className="card p-3 flex flex-col items-center gap-1.5">
            <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center">
              {themeMode === 'dark' ? <span className="text-lg">🌙</span> : themeMode === 'light' ? <span className="text-lg">☀️</span> : <span className="text-lg">💻</span>}
            </div>
            <span className="text-xs text-surface-600">{themeMode === 'dark' ? '深色' : themeMode === 'light' ? '浅色' : '跟随'}</span>
          </button>
          <button onClick={() => { logout(); navigate('/login'); }} className="card p-3 flex flex-col items-center gap-1.5">
            <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
              <IconXMark size={18} className="text-red-400" />
            </div>
            <span className="text-xs text-surface-600">退出</span>
          </button>
        </div>

        <div className="flex gap-1 p-1 bg-surface-100 dark:bg-surface-800 rounded-xl mb-4">
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'profile' ? 'bg-white dark:bg-surface-700 text-surface-800 dark:text-surface-100 shadow-sm' : 'text-surface-500 dark:text-surface-400'
              }`}
          >
            个人信息
          </button>
          <button
            onClick={() => setActiveTab('memory')}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'memory' ? 'bg-white dark:bg-surface-700 text-surface-800 dark:text-surface-100 shadow-sm' : 'text-surface-500 dark:text-surface-400'
              }`}
          >
            AI 记忆库
          </button>
        </div>

        {activeTab === 'profile' && (
          <>
            <div className="card p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-medium text-surface-700 dark:text-surface-300">画像完整度</h3>
                  <p className="text-xs text-surface-400 mt-0.5">完善信息让 AI 更懂你</p>
                </div>
                <div className="text-2xl font-bold gradient-text">{completionPercent}%</div>
              </div>
              <div className="w-full h-2 bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-brand-500 to-brand-600 rounded-full transition-all duration-500"
                  style={{ width: `${completionPercent}%` }} />
              </div>
              <p className="text-xs text-surface-400 mt-2">已填写 {filledCount}/{totalFields} 项</p>
            </div>

            {isEditing && (
              <div className="flex gap-2 mb-4">
                <button onClick={handleSave} disabled={isSaving} className="btn-primary flex-1">
                  {isSaving ? '保存中...' : '保存修改'}
                </button>
                <button onClick={() => setIsEditing(false)} className="btn-secondary flex-1">
                  取消
                </button>
              </div>
            )}

            <div className="space-y-4">
              {profileSections.map((section) => (
                <div key={section.title} className="card p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 bg-brand-50 dark:bg-brand-950/30 rounded-lg flex items-center justify-center">
                      <section.Icon size={14} className="text-brand-500" />
                    </div>
                    <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">{section.title}</h3>
                  </div>
                  <div className="space-y-3">
                    {section.fields.map((field) => (
                      <div key={field.key}>
                        <label className="text-xs text-surface-500 dark:text-surface-400 mb-1 block">{field.label}</label>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editData[field.key] || ''}
                            onChange={(e) => setEditData({ ...editData, [field.key]: e.target.value })}
                            placeholder={field.placeholder}
                            className="input-field" />
                        ) : (
                          <p className={`text-sm ${editData[field.key] ? 'text-surface-800 dark:text-surface-200' : 'text-surface-300 dark:text-surface-600'}`}>
                            {editData[field.key] || field.placeholder}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {activeTab === 'memory' && (
          <>
            <div className="card p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-sm font-medium text-surface-700 dark:text-surface-300">AI 记忆库</h3>
                  <p className="text-xs text-surface-400 mt-0.5">AI 在与你对话中自动识别并记忆的信息</p>
                </div>
                <button
                  onClick={() => setShowAddMemory(!showAddMemory)}
                  className="btn-primary text-xs px-3 py-1.5"
                >
                  <IconPlus size={12} className="mr-1" />
                  手动添加
                </button>
              </div>
              <p className="text-xs text-surface-400">共 {memoryItems.length} 条记忆</p>
            </div>

            {showAddMemory && (
              <div className="card p-4 mb-4 border-brand-200 dark:border-brand-800 bg-brand-50/30 dark:bg-brand-950/20">
                <h4 className="text-sm font-medium text-surface-700 dark:text-surface-300 mb-3">添加新记忆</h4>
                <div className="space-y-2">
                  <select
                    value={newMemory.category}
                    onChange={(e) => setNewMemory({ ...newMemory, category: e.target.value })}
                    className="input-field"
                  >
                    {Object.entries(categoryConfig).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={newMemory.key}
                    onChange={(e) => setNewMemory({ ...newMemory, key: e.target.value })}
                    placeholder="信息键名（如：喜欢的颜色）"
                    className="input-field" />
                  <input
                    type="text"
                    value={newMemory.value}
                    onChange={(e) => setNewMemory({ ...newMemory, value: e.target.value })}
                    placeholder="信息值（如：蓝色）"
                    className="input-field" />
                  <div className="flex gap-2">
                    <button onClick={handleAddMemory} className="btn-primary text-xs flex-1">保存</button>
                    <button onClick={() => setShowAddMemory(false)} className="btn-secondary text-xs flex-1">取消</button>
                  </div>
                </div>
              </div>
            )}

            {Object.keys(memoryGrouped).length === 0 ? (
              <div className="empty-state py-12">
                <div className="w-16 h-16 bg-brand-50 dark:bg-brand-950/30 rounded-2xl flex items-center justify-center mb-3">
                  <IconBrain size={28} className="text-brand-400" />
                </div>
                <h3 className="empty-state-title">AI 记忆库为空</h3>
                <p className="empty-state-desc">与 AI 聊天时，AI 会自动识别并记忆你的信息</p>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(memoryGrouped).map(([category, items]) => {
                  const config = categoryConfig[category] || { label: category, Icon: IconTag };
                  return (
                    <div key={category} className="card p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-7 h-7 bg-brand-50 dark:bg-brand-950/30 rounded-lg flex items-center justify-center">
                          <config.Icon size={14} className="text-brand-500" />
                        </div>
                        <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">{config.label}</h3>
                        <span className="badge bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400">{(items as MemoryItem[]).length}</span>
                      </div>
                      <div className="space-y-2">
                        {(items as MemoryItem[]).map((item) => (
                          <div key={item.id} className="flex items-center justify-between py-2 px-3 bg-surface-50 dark:bg-surface-800 rounded-xl">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-surface-400">{item.key}</p>
                              <p className="text-sm text-surface-800 dark:text-surface-200 truncate">{item.value}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${item.source === 'ai_extracted' ? 'bg-brand-50 dark:bg-brand-950/30 text-brand-500' : 'bg-green-50 dark:bg-green-950/30 text-green-500'
                                  }`}>
                                  {item.source === 'ai_extracted' ? 'AI 识别' : '手动添加'}
                                </span>
                                {item.confidence < 100 && (
                                  <span className="text-[10px] text-surface-400">置信度 {item.confidence}%</span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => deleteMemory(item.id)}
                              className="text-surface-300 hover:text-red-500 transition-colors ml-2 flex-shrink-0"
                            >
                              <IconXMark size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
