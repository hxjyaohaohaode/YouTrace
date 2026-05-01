export type EmotionIconName = 'happy' | 'sad' | 'angry' | 'anxious' | 'calm' | 'grateful' | 'neutral';

interface EmotionConfig {
    label: string;
    color: string;
    bgColor: string;
    iconName: EmotionIconName;
}

const emotionConfig: Record<string, EmotionConfig> = {
    happy: { label: '开心', color: 'text-yellow-700', bgColor: 'bg-yellow-100', iconName: 'happy' },
    sad: { label: '难过', color: 'text-blue-700', bgColor: 'bg-blue-100', iconName: 'sad' },
    angry: { label: '生气', color: 'text-red-700', bgColor: 'bg-red-100', iconName: 'angry' },
    anxious: { label: '焦虑', color: 'text-purple-700', bgColor: 'bg-purple-100', iconName: 'anxious' },
    calm: { label: '平静', color: 'text-green-700', bgColor: 'bg-green-100', iconName: 'calm' },
    grateful: { label: '感恩', color: 'text-pink-700', bgColor: 'bg-pink-100', iconName: 'grateful' },
    neutral: { label: '平静', color: 'text-surface-700', bgColor: 'bg-surface-100', iconName: 'neutral' },
};

export const getEmotionConfig = (emotion: string): EmotionConfig => {
    return emotionConfig[emotion] || emotionConfig.neutral;
};

export const getScoreLabel = (score: number): string => {
    if (score >= 80) return '非常积极';
    if (score >= 60) return '比较积极';
    if (score >= 40) return '中性';
    if (score >= 20) return '比较消极';
    return '非常消极';
};

export const getScoreColor = (score: number): string => {
    if (score >= 70) return 'bg-green-500';
    if (score >= 50) return 'bg-yellow-500';
    if (score >= 30) return 'bg-orange-500';
    return 'bg-red-500';
};

export const EMOTION_ICON_PATHS: Record<EmotionIconName, string> = {
    happy: 'M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    sad: 'M9 10h.01M15 10h.01M9.75 17a3.75 3.75 0 005.5 0M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    angry: 'M18.364 5.636l-2.829 2.828M8.464 15.536l-2.828 2.828M5.636 5.636l2.828 2.828M15.536 15.536l2.828 2.828M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    anxious: 'M12 9v2m0 4h.01M12 3a9 9 0 110 18 9 9 0 010-18z',
    calm: 'M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    grateful: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
    neutral: 'M8 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};
