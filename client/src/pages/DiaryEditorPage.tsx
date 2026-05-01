import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDiaryStore } from '../stores/diaryStore';
import { uploadApi, getThumbnailUrl, type AttachmentResult } from '../api/upload';

const MAX_ATTACHMENTS = 9;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ACCEPTED_TYPES = 'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/aac,audio/mp4,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.md';

function DiaryEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditing = !!id;
  const { currentDiary, fetchDiary, createDiary, updateDiary, error } = useDiaryStore();
  const [content, setContent] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentResult[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [expandedAnnotation, setExpandedAnnotation] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const hasUnsavedChanges = content.trim().length > 0 || pendingAttachments.length > 0;

  useEffect(() => {
    if (id) fetchDiary(id);
  }, [id, fetchDiary]);

  useEffect(() => {
    if (isEditing && currentDiary) {
      setContent(currentDiary.content);
      if (currentDiary.attachments) {
        setPendingAttachments(currentDiary.attachments.map((a) => ({
          id: a.id,
          fileName: '',
          originalName: a.originalName,
          mimeType: a.mimeType,
          fileSize: 0,
          fileType: a.fileType as 'image' | 'video' | 'audio' | 'document',
          thumbnailPath: a.thumbnailPath,
          aiAnnotation: a.aiAnnotation,
          annotationStatus: 'completed' as const,
        })));
      }
    }
  }, [isEditing, currentDiary]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges && !isSaving) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges, isSaving]);

  useEffect(() => {
    const processingIds = pendingAttachments
      .filter((a) => a.annotationStatus === 'processing')
      .map((a) => a.id);
    if (processingIds.length === 0) return;

    const interval = setInterval(async () => {
      try {
        const response = await uploadApi.batchStatus(processingIds);
        if (response.success && response.data) {
          setPendingAttachments((prev) =>
            prev.map((att) => {
              const status = response.data!.find((s) => s.id === att.id);
              if (status && status.annotationStatus !== 'processing') {
                return {
                  ...att,
                  annotationStatus: status.annotationStatus as 'completed' | 'failed',
                  aiAnnotation: status.aiAnnotation || att.aiAnnotation,
                };
              }
              return att;
            })
          );
        }
      } catch {
        // polling failed, will retry
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [pendingAttachments]);

  const processFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const remaining = MAX_ATTACHMENTS - pendingAttachments.length;
    if (remaining <= 0) {
      setUploadErrors((prev) => [...prev, `最多上传${MAX_ATTACHMENTS}个附件`]);
      return;
    }

    const toUpload = files.slice(0, remaining);
    const oversized = toUpload.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      setUploadErrors((prev) => [...prev, `${oversized.map((f) => f.name).join('、')} 超过50MB限制`]);
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadErrors([]);
    try {
      const response = await uploadApi.uploadFiles(toUpload, (progress) => {
        setUploadProgress(Math.round(progress * 100));
      });
      if (response.success && response.data) {
        const successful = response.data.filter((r) => r.id);
        const failed = response.data.filter((r) => !r.id);
        setPendingAttachments((prev) => [...prev, ...successful]);
        if (failed.length > 0) {
          setUploadErrors(failed.map((f) => `${f.originalName}: ${f.error || '上传失败'}`));
        }
      }
    } catch {
      setUploadErrors(['网络错误，上传失败，请重试']);
    }
    setIsUploading(false);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [pendingAttachments.length]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    await processFiles(files);
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    await processFiles(files);
  }, [processFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      await processFiles(imageFiles);
    }
  }, [processFiles]);

  const removeAttachment = (attId: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== attId));
  };

  const getFileTypeIcon = (fileType: string) => {
    switch (fileType) {
      case 'image': return '🖼️';
      case 'video': return '🎬';
      case 'audio': return '🎵';
      case 'document': return '📄';
      default: return '📎';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  };

  const handleSave = async () => {
    if (!content.trim() || isSaving) return;
    setIsSaving(true);
    const attachmentIds = pendingAttachments.map((a) => a.id);
    try {
      if (isEditing && id) {
        await updateDiary(id, content, attachmentIds.length > 0 ? attachmentIds : undefined);
      } else {
        await createDiary(content, attachmentIds.length > 0 ? attachmentIds : undefined);
      }
      if (!useDiaryStore.getState().error) {
        navigate('/');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (hasUnsavedChanges) {
      setShowCancelConfirm(true);
    } else {
      navigate('/');
    }
  };

  const imageAttachments = pendingAttachments.filter((a) => a.fileType === 'image');
  const otherAttachments = pendingAttachments.filter((a) => a.fileType !== 'image');

  return (
    <div className="page-container">
      <header className="page-header">
        <div className="max-w-2xl lg:max-w-3xl mx-auto px-5 sm:px-8 lg:px-12 py-3.5 flex items-center justify-between">
          <button
            onClick={handleCancel}
            className="flex items-center gap-1 text-surface-500 hover:text-surface-700 text-sm font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            取消
          </button>
          <h1 className="text-base font-semibold text-surface-800">{isEditing ? '编辑日记' : '写日记'}</h1>
          <button
            onClick={handleSave}
            disabled={!content.trim() || isSaving}
            className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50"
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </header>

      <main className="max-w-2xl lg:max-w-3xl mx-auto px-5 sm:px-8 lg:px-12 py-6">
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm">{error}</div>
        )}

        {uploadErrors.length > 0 && (
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl space-y-1">
            {uploadErrors.map((err, i) => (
              <p key={i} className="text-amber-700 dark:text-amber-400 text-sm">{err}</p>
            ))}
            <button
              onClick={() => setUploadErrors([])}
              className="text-amber-600 text-xs underline mt-1"
            >
              关闭
            </button>
          </div>
        )}

        <div className="card p-5" onPaste={handlePaste}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="今天过得怎么样？记录你的心情和故事...&#10;&#10;💡 提示：可以直接粘贴图片，或拖拽文件到下方区域"
            className="w-full min-h-[300px] resize-none border-0 focus:ring-0 p-0 text-surface-700 leading-relaxed placeholder:text-surface-300"
            autoFocus
          />
        </div>

        <div
          ref={dropZoneRef}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`card p-4 mt-3 transition-all duration-200 ${isDragOver ? 'border-brand-400 bg-brand-50/50 ring-2 ring-brand-200' : ''
            }`}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-surface-600">附件</h3>
            <span className="text-xs text-surface-400">{pendingAttachments.length}/{MAX_ATTACHMENTS}</span>
          </div>

          {imageAttachments.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-surface-400 mb-2">图片</p>
              <div className="grid grid-cols-3 gap-2">
                {imageAttachments.map((att) => {
                  const originalUrl = att.fileName ? `/api/files/originals/${att.fileName}` : null;
                  const thumbUrl = getThumbnailUrl(att.thumbnailPath);
                  return (
                    <div
                      key={att.id}
                      className="relative group aspect-square rounded-xl overflow-hidden bg-surface-100 border border-surface-200"
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
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                        <button
                          onClick={() => removeAttachment(att.id)}
                          className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-full bg-white/90 dark:bg-surface-700/90 flex items-center justify-center text-red-500 hover:bg-white dark:hover:bg-surface-600 transition-all shadow-sm"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      {att.annotationStatus === 'completed' && (
                        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                      {att.annotationStatus === 'processing' && (
                        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center">
                          <svg className="w-3 h-3 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
                        <p className="text-[10px] text-white truncate">{att.originalName}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {otherAttachments.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-surface-400 mb-2">文件</p>
              <div className="space-y-1.5">
                {otherAttachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center gap-2 px-3 py-2 bg-surface-50 border border-surface-200 rounded-xl text-xs hover:bg-surface-100 transition-colors"
                  >
                    <span className="text-base flex-shrink-0">{getFileTypeIcon(att.fileType)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-surface-700 font-medium truncate">{att.originalName}</p>
                      {att.fileSize > 0 && (
                        <p className="text-surface-400 text-[10px]">{formatFileSize(att.fileSize)}</p>
                      )}
                    </div>
                    {att.annotationStatus === 'completed' && (
                      <span className="text-green-500 flex-shrink-0" title="AI已标注">✓</span>
                    )}
                    {att.annotationStatus === 'processing' && (
                      <svg className="w-3.5 h-3.5 text-amber-400 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    <button
                      onClick={() => removeAttachment(att.id)}
                      className="text-surface-400 hover:text-red-500 flex-shrink-0 ml-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingAttachments.some((a) => a.aiAnnotation) && (
            <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-100 dark:border-blue-900/50">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-blue-700 dark:text-blue-400 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  AI 标注
                </p>
              </div>
              <div className="space-y-1.5">
                {pendingAttachments.filter((a) => a.aiAnnotation).map((att) => {
                  const isExpanded = expandedAnnotation === att.id;
                  const annotation = att.aiAnnotation || '';
                  return (
                    <div key={att.id} className="text-xs">
                      <span className="font-medium text-blue-700">{att.originalName}:</span>
                      <span className="text-blue-600"> {isExpanded ? annotation : annotation.slice(0, 80)}{!isExpanded && annotation.length > 80 ? '...' : ''}</span>
                      {annotation.length > 80 && (
                        <button
                          onClick={() => setExpandedAnnotation(isExpanded ? null : att.id)}
                          className="text-blue-500 underline ml-1 hover:text-blue-700"
                        >
                          {isExpanded ? '收起' : '展开'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_TYPES}
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || pendingAttachments.length >= MAX_ATTACHMENTS}
            className={`flex items-center gap-2 px-3 py-2.5 border border-dashed rounded-xl text-sm transition-all w-full justify-center disabled:opacity-50 ${isDragOver
              ? 'border-brand-400 text-brand-600 bg-brand-50'
              : 'border-surface-300 text-surface-500 hover:text-brand-500 hover:border-brand-300 hover:bg-brand-50/30'
              }`}
          >
            {isUploading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                上传中 {uploadProgress}%
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                {isDragOver ? '松开即可添加' : '添加图片/视频/音频/文件'}
              </>
            )}
          </button>
          <p className="text-[10px] text-surface-300 text-center mt-1.5">
            支持拖拽上传、粘贴图片 · 单文件最大50MB · 最多{MAX_ATTACHMENTS}个附件
          </p>
        </div>
      </main>

      {showCancelConfirm && (
        <div className="overlay" onClick={() => setShowCancelConfirm(false)}>
          <div className="modal-content p-7 max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-surface-800 mb-2">放弃编辑？</h3>
            <p className="text-surface-400 text-sm mb-6">当前内容尚未保存，确认放弃吗？</p>
            <div className="flex gap-3">
              <button onClick={() => setShowCancelConfirm(false)} className="btn-secondary flex-1 py-2.5 text-sm">继续编辑</button>
              <button onClick={() => navigate('/')} className="flex-1 bg-red-500 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-red-600 transition-colors">放弃</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DiaryEditorPage;
