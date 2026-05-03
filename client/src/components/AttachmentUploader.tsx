import { useRef, useState, useCallback } from 'react';
import { uploadApi, getThumbnailUrl, type AttachmentResult } from '../api/upload';

interface AttachmentUploaderProps {
  attachments: AttachmentResult[];
  onAttachmentsChange: (attachments: AttachmentResult[]) => void;
  maxFiles?: number;
  maxSizeMB?: number;
  disabled?: boolean;
}

const ICON_MAP: Record<string, string> = {
  image: '🖼️',
  video: '🎬',
  audio: '🎵',
  document: '📄',
  pdf: '📕',
  word: '📝',
  excel: '📊',
  ppt: '📽️',
  code: '💻',
  archive: '📦',
};

function getFileCategory(file: File): string {
  const type = file.type;
  const name = file.name.toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf') return 'pdf';
  if (type.includes('word') || name.endsWith('.doc') || name.endsWith('.docx')) return 'word';
  if (type.includes('excel') || type.includes('spreadsheet') || name.endsWith('.xls') || name.endsWith('.xlsx') || name.endsWith('.csv')) return 'excel';
  if (type.includes('presentation') || name.endsWith('.ppt') || name.endsWith('.pptx')) return 'ppt';
  if (type.includes('text/') || name.match(/\.(js|ts|jsx|tsx|py|java|cpp|c|go|rs|rb|php|html|css|json|xml|yaml|yml|md|sql|sh|bat)$/)) return 'code';
  if (type.includes('zip') || type.includes('rar') || type.includes('7z') || type.includes('tar') || type.includes('gz')) return 'archive';
  return 'document';
}

function getFileIcon(attachment: AttachmentResult): string {
  const cat = getFileCategory({ type: attachment.mimeType, name: attachment.originalName } as File);
  if (attachment.fileType === 'image' && attachment.thumbnailPath) return '';
  return ICON_MAP[cat] || '📎';
}

export default function AttachmentUploader({
  attachments,
  onAttachmentsChange,
  maxFiles = 9,
  maxSizeMB = 50,
  disabled = false,
}: AttachmentUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    if (fileArr.length === 0) return;

    if (attachments.length + fileArr.length > maxFiles) {
      setError(`最多上传${maxFiles}个附件`);
      return;
    }

    const invalid = fileArr.find((f) => f.size > maxSizeMB * 1024 * 1024);
    if (invalid) {
      setError(`单个文件不能超过${maxSizeMB}MB`);
      return;
    }

    setError(null);
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const response = await uploadApi.uploadFiles(fileArr, (progress) => {
        setUploadProgress(progress);
      });

      if (response.success && response.data) {
        onAttachmentsChange([...attachments, ...response.data]);
      } else {
        setError(response.message || '上传失败');
      }
    } catch (err) {
      setError((err as Error).message || '上传失败');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [attachments, maxFiles, maxSizeMB, onAttachmentsChange]);

  const removeAttachment = useCallback((id: string) => {
    onAttachmentsChange(attachments.filter((a) => a.id !== id));
  }, [attachments, onAttachmentsChange]);

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.js,.ts,.jsx,.tsx,.py,.java,.cpp,.c,.go,.rs,.rb,.php,.html,.css,.json,.xml,.yaml,.yml,.sql,.sh,.bat,.zip,.rar,.7z,.tar,.gz"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {attachments.length > 0 && (
        <div className="flex flex-wrap items-end gap-0 px-1">
          {attachments.map((att, idx) => {
            const isImage = att.fileType === 'image' || att.mimeType.startsWith('image/');
            const icon = getFileIcon(att);
            const total = attachments.length;
            const layerIdx = idx;
            const rotDeg = (layerIdx - total / 2 + 0.5) * 3;
            const zIndex = total - layerIdx;

            return (
              <div
                key={att.id}
                className="relative group shrink-0"
                style={{
                  marginLeft: idx > 0 ? '-16px' : 0,
                  transform: `rotate(${rotDeg}deg)`,
                  zIndex,
                  transition: 'transform 0.2s ease, margin 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = `rotate(0deg) translateY(-4px) scale(1.05)`;
                  e.currentTarget.style.zIndex = '999';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = `rotate(${rotDeg}deg)`;
                  e.currentTarget.style.zIndex = String(zIndex);
                }}
              >
                {isImage ? (
                  <div className="w-16 h-16 rounded-xl overflow-hidden border-2 border-white shadow-lg bg-surface-100">
                    <img
                      src={getThumbnailUrl(att.thumbnailPath) || `/api/files/thumbnails/${att.id}`}
                      alt={att.originalName}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        (e.target as HTMLImageElement).parentElement!.innerHTML = `<span class="flex items-center justify-center w-full h-full text-2xl">🖼️</span>`;
                      }}
                    />
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-xl border-2 border-white shadow-lg bg-surface-50 flex flex-col items-center justify-center gap-0.5 overflow-hidden">
                    <span className="text-xl leading-none">{icon}</span>
                    <span className="text-[8px] text-surface-400 truncate w-12 text-center leading-tight">
                      {att.originalName.length > 8 ? att.originalName.slice(0, 6) + '..' : att.originalName}
                    </span>
                  </div>
                )}

                {!disabled && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeAttachment(att.id); }}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-50"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {attachments.length < maxFiles && !disabled && (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-surface-300 text-surface-500 hover:border-brand-400 hover:text-brand-500 transition-colors text-sm font-medium disabled:opacity-50"
        >
          {isUploading ? (
            <>
              <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              上传中 {Math.round(uploadProgress * 100)}%
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              添加附件
            </>
          )}
        </button>
      )}

      {error && (
        <p className="text-red-500 text-xs px-1">{error}</p>
      )}
    </div>
  );
}
