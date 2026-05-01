import { EMOTION_ICON_PATHS, type EmotionIconName } from './emotionUtils';

export type { EmotionIconName } from './emotionUtils';

export function EmotionIcon({ emotion, className = 'w-3.5 h-3.5' }: { emotion: EmotionIconName; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={EMOTION_ICON_PATHS[emotion] || EMOTION_ICON_PATHS.neutral} />
    </svg>
  );
}
