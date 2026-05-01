import { getEmotionConfig } from '../utils/emotionUtils';
import { EmotionIcon, type EmotionIconName } from '../utils/emotion';
interface EmotionTagProps {
  emotion: string;
  size?: 'sm' | 'md';
}

function EmotionTag({ emotion, size = 'sm' }: EmotionTagProps) {
  const config = getEmotionConfig(emotion);
  const sizeClasses = size === 'sm' ? 'text-xs px-2.5 py-0.5' : 'text-sm px-3 py-1';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full ${config.bgColor} ${config.color} ${sizeClasses} font-medium`}
    >
      <EmotionIcon emotion={config.iconName as EmotionIconName} className={iconSize} />
      <span>{config.label}</span>
    </span>
  );
}

export default EmotionTag;
