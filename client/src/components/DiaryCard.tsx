import { useNavigate } from 'react-router-dom';
import type { Diary } from '../types';
import { formatRelative } from '../utils/date';
import { getScoreColor, getScoreLabel } from '../utils/emotionUtils';
import EmotionTag from './EmotionTag';

interface DiaryCardProps {
  diary: Diary & { attachments?: { id: string; fileType: string }[] };
  index?: number;
}

function DiaryCard({ diary }: DiaryCardProps) {
  const navigate = useNavigate();
  const attachmentCount = diary.attachments?.length || 0;
  const hasImage = diary.attachments?.some((a) => a.fileType === 'image');

  return (
    <div
      onClick={() => navigate(`/diary/${diary.id}`)}
      className="card p-5 cursor-pointer group"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-surface-400 font-medium">{formatRelative(diary.createdAt)}</span>
        <div className="flex items-center gap-2">
          {attachmentCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs text-surface-400">
              {hasImage ? '🖼️' : '📎'} {attachmentCount}
            </span>
          )}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${getScoreColor(diary.emotionScore)} ring-2 ring-offset-1 ring-offset-white dark:ring-offset-surface-900 ring-transparent group-hover:ring-brand-200 transition-all`} />
            <span className="text-xs text-surface-400">{getScoreLabel(diary.emotionScore)}</span>
          </div>
        </div>
      </div>

      <p className="text-sm text-surface-700 dark:text-surface-300 line-clamp-3 leading-relaxed">
        {diary.content}
      </p>

      <div className="flex items-center justify-between mt-3">
        {diary.emotionTags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {diary.emotionTags.slice(0, 3).map((tag) => (
              <EmotionTag key={tag} emotion={tag} size="sm" />
            ))}
          </div>
        ) : <div />}
        {attachmentCount > 0 && (
          <div className="flex items-center gap-1 text-surface-300">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

export default DiaryCard;
