import { useNavigate } from 'react-router-dom';
import type { Diary } from '../types';
import { formatRelative } from '../utils/date';
import { getScoreColor, getScoreLabel } from '../utils/emotionUtils';
import { getOriginalFileUrl, getThumbnailUrl } from '../api/upload';
import EmotionTag from './EmotionTag';

interface DiaryCardProps {
  diary: Diary & { attachments?: { id: string; fileType: string; thumbnailPath: string | null; filePath?: string; originalName: string }[] };
  index?: number;
}

function DiaryCard({ diary }: DiaryCardProps) {
  const navigate = useNavigate();
  const attachmentCount = diary.attachments?.length || 0;
  const imageAttachments = diary.attachments?.filter((a) => a.fileType === 'image') || [];
  const hasMedia = attachmentCount > 0;

  return (
    <div
      onClick={() => navigate(`/diary/${diary.id}`)}
      className="card-hover p-5"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-surface-400 font-medium">{formatRelative(diary.createdAt)}</span>
        <div className="flex items-center gap-2">
          {hasMedia && (
            <span className="inline-flex items-center gap-0.5 text-xs text-surface-400">
              {imageAttachments.length > 0 ? '🖼️' : '📎'} {attachmentCount}
            </span>
          )}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${getScoreColor(diary.emotionScore)} ring-2 ring-offset-1 ring-offset-white dark:ring-offset-surface-900 ring-transparent group-hover:ring-brand-200 transition-all`} />
            <span className="text-xs text-surface-400">{getScoreLabel(diary.emotionScore)}</span>
          </div>
        </div>
      </div>

      {imageAttachments.length > 0 && (
        <div className={`grid gap-1.5 mb-3 ${imageAttachments.length === 1 ? 'grid-cols-1' : imageAttachments.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {imageAttachments.slice(0, 3).map((att) => {
            const originalUrl = getOriginalFileUrl(att.filePath || null);
            const thumbUrl = getThumbnailUrl(att.thumbnailPath);
            return (
              <div
                key={att.id}
                className={`relative rounded-xl overflow-hidden bg-surface-100 border border-surface-200 ${imageAttachments.length === 1 ? 'aspect-video' : 'aspect-square'}`}
              >
                <img
                  src={originalUrl || thumbUrl || ''}
                  alt={att.originalName}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (img.src !== thumbUrl && thumbUrl) {
                      img.src = thumbUrl;
                    } else {
                      img.style.display = 'none';
                    }
                  }}
                />
              </div>
            );
          })}
          {imageAttachments.length > 3 && (
            <div className="relative rounded-xl overflow-hidden bg-surface-100 border border-surface-200 aspect-square">
              <img
                src={getOriginalFileUrl(imageAttachments[3].filePath || null) || getThumbnailUrl(imageAttachments[3].thumbnailPath) || ''}
                alt=""
                className="w-full h-full object-cover filter blur-[2px]"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <span className="text-white text-sm font-medium">+{imageAttachments.length - 3}</span>
              </div>
            </div>
          )}
        </div>
      )}

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
        {hasMedia && imageAttachments.length === 0 && (
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
