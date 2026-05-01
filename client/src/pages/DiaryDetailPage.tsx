import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDiaryStore } from '../stores/diaryStore';
import { aiApi } from '../api/ai';
import { getThumbnailUrl, getOriginalFileUrl, getAttachmentDownloadUrl } from '../api/upload';
import EmotionTag from '../components/EmotionTag';
import { formatDateTime } from '../utils/date';
import { getScoreColor, getEmotionConfig } from '../utils/emotionUtils';

function DiaryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentDiary, fetchDiary, deleteDiary, isLoading, error } = useDiaryStore();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [deepAnalysis, setDeepAnalysis] = useState<string | null>(null);
  const [isDeepAnalyzing, setIsDeepAnalyzing] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [expandedAnnotation, setExpandedAnnotation] = useState<string | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (id) fetchDiary(id);
  }, [id, fetchDiary]);

  const handleDelete = async () => {
    if (!id) return;
    await deleteDiary(id);
    navigate('/');
  };

  const handleAnalyze = async () => {
    if (!id) return;
    setIsAnalyzing(true);
    await useDiaryStore.getState().analyzeDiary(id);
    setIsAnalyzing(false);
  };

  const handleDeepAnalyze = async () => {
    if (!id) return;
    setIsDeepAnalyzing(true);
    try {
      const response = await aiApi.deepAnalyze(id);
      if (response.success && response.data) {
        setDeepAnalysis(response.data.analysis);
      }
    } catch {
      // deep analysis failed, ignore
    } finally {
      setIsDeepAnalyzing(false);
    }
  };

  const handleLightboxKeydown = useCallback((e: KeyboardEvent) => {
    if (lightboxIndex === null) return;
    const imageAttachments = currentDiary?.attachments?.filter((a) => a.fileType === 'image') || [];
    if (e.key === 'Escape') setLightboxIndex(null);
    if (e.key === 'ArrowLeft' && imageAttachments.length > 1) {
      setLightboxIndex((prev) => prev !== null && prev > 0 ? prev - 1 : imageAttachments.length - 1);
    }
    if (e.key === 'ArrowRight' && imageAttachments.length > 1) {
      setLightboxIndex((prev) => prev !== null && prev < imageAttachments.length - 1 ? prev + 1 : 0);
    }
  }, [lightboxIndex, currentDiary]);

  useEffect(() => {
    if (lightboxIndex !== null) {
      document.addEventListener('keydown', handleLightboxKeydown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleLightboxKeydown);
      document.body.style.overflow = '';
    };
  }, [lightboxIndex, handleLightboxKeydown]);

  if (isLoading && !currentDiary) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <button onClick={() => navigate('/')} className="text-brand-500 hover:text-brand-600 text-sm font-medium">返回列表</button>
        </div>
      </div>
    );
  }

  if (!currentDiary) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="text-center">
          <p className="text-surface-400 mb-4">日记不存在</p>
          <button onClick={() => navigate('/')} className="text-brand-500 hover:text-brand-600 text-sm font-medium">返回列表</button>
        </div>
      </div>
    );
  }

  const primaryConfig = getEmotionConfig(currentDiary.emotionTags[0] || 'neutral');
  const imageAttachments = currentDiary.attachments?.filter((a) => a.fileType === 'image') || [];
  const audioAttachments = currentDiary.attachments?.filter((a) => a.fileType === 'audio') || [];
  const videoAttachments = currentDiary.attachments?.filter((a) => a.fileType === 'video') || [];
  const docAttachments = currentDiary.attachments?.filter((a) => a.fileType === 'document') || [];

  return (
    <div className="page-container">
      <header className="page-header">
        <div className="md:max-w-2xl lg:max-w-3xl mx-auto px-4 sm:px-8 lg:px-12 py-3 sm:py-3.5 flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1 text-surface-500 hover:text-surface-700 text-sm font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            返回
          </button>
          <h1 className="text-base font-semibold text-surface-800">日记详情</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/diary/${id}/edit`)}
              className="text-brand-500 hover:text-brand-600 text-sm font-medium"
            >
              编辑
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="text-red-500 hover:text-red-600 text-sm font-medium"
            >
              删除
            </button>
          </div>
        </div>
      </header>

      <main className="md:max-w-2xl lg:max-w-3xl mx-auto px-4 sm:px-8 lg:px-12 py-5 sm:py-8">
        <div className="card card-responsive-lg mb-4 sm:mb-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-surface-400 font-medium">{formatDateTime(currentDiary.createdAt)}</span>
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${getScoreColor(currentDiary.emotionScore)}`} />
              <span className="text-sm text-surface-500">({currentDiary.emotionScore}分)</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-5">
            {currentDiary.emotionTags.map((tag) => (
              <EmotionTag key={tag} emotion={tag} size="md" />
            ))}
          </div>

          <div className="prose prose-sm max-w-none">
            {currentDiary.content.split('\n').map((paragraph, i) => (
              <p key={i} className="text-surface-700 leading-relaxed mb-2">
                {paragraph}
              </p>
            ))}
          </div>

          {imageAttachments.length > 0 && (
            <div className="mt-5 pt-4 border-t border-surface-100">
              <h4 className="text-sm font-medium text-surface-600 mb-3 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                </svg>
                图片
                <span className="text-xs text-surface-400">({imageAttachments.length})</span>
              </h4>
              <div className={`grid gap-2 ${imageAttachments.length === 1 ? 'grid-cols-1' : imageAttachments.length === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
                {imageAttachments.map((att, idx) => {
                  const originalUrl = getOriginalFileUrl(att.filePath ?? null);
                  const thumbUrl = getThumbnailUrl(att.thumbnailPath);
                  return (
                    <div
                      key={att.id}
                      onClick={() => setLightboxIndex(idx)}
                      className={`relative group rounded-xl overflow-hidden bg-surface-100 border border-surface-200 cursor-pointer ${imageAttachments.length === 1 ? 'aspect-video' : 'aspect-square'
                        }`}
                    >
                      <img
                        src={originalUrl || thumbUrl || ''}
                        alt={att.originalName}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        loading="lazy"
                        onError={(e) => {
                          const img = e.currentTarget;
                          if (img.src !== thumbUrl && thumbUrl) {
                            img.src = thumbUrl;
                          } else {
                            img.style.display = 'none';
                            const placeholder = img.nextElementSibling as HTMLElement;
                            if (placeholder) placeholder.style.display = 'flex';
                          }
                        }}
                      />
                      <div className="w-full h-full flex-col items-center justify-center" style={{ display: 'none' }}>
                        <span className="text-3xl">🖼️</span>
                        <span className="text-xs text-surface-400 mt-1">{att.originalName}</span>
                      </div>
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {videoAttachments.length > 0 && (
            <div className="mt-5 pt-4 border-t border-surface-100">
              <h4 className="text-sm font-medium text-surface-600 mb-3 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                </svg>
                视频
                <span className="text-xs text-surface-400">({videoAttachments.length})</span>
              </h4>
              <div className="space-y-3">
                {videoAttachments.map((att) => (
                  <div key={att.id} className="p-3 bg-surface-50 rounded-xl border border-surface-200">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-lg">🎬</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-surface-700 truncate">{att.originalName}</p>
                        {att.aiAnnotation && (
                          <p className="text-xs text-surface-500 mt-0.5 line-clamp-2">{att.aiAnnotation}</p>
                        )}
                      </div>
                      <a
                        href={getAttachmentDownloadUrl(att.id)}
                        className="text-brand-500 hover:text-brand-600 flex-shrink-0"
                        title="下载"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </a>
                    </div>
                    <video
                      controls
                      className="w-full rounded-lg max-h-[300px] bg-black"
                      preload="metadata"
                      controlsList="nodownload"
                    >
                      <source src={getAttachmentDownloadUrl(att.id, true)} />
                      你的浏览器不支持视频播放
                    </video>
                  </div>
                ))}
              </div>
            </div>
          )}

          {audioAttachments.length > 0 && (
            <div className="mt-5 pt-4 border-t border-surface-100">
              <h4 className="text-sm font-medium text-surface-600 mb-3 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
                </svg>
                音频
                <span className="text-xs text-surface-400">({audioAttachments.length})</span>
              </h4>
              <div className="space-y-2">
                {audioAttachments.map((att) => (
                  <div key={att.id} className="p-3 bg-surface-50 rounded-xl border border-surface-200">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-lg">🎵</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-surface-700 truncate">{att.originalName}</p>
                        {att.aiAnnotation && (
                          <p className="text-xs text-surface-500 mt-0.5 line-clamp-2">{att.aiAnnotation}</p>
                        )}
                      </div>
                    </div>
                    <audio
                      controls
                      className="w-full h-8 mt-1"
                      preload="metadata"
                    >
                      <source src={getAttachmentDownloadUrl(att.id, true)} />
                      你的浏览器不支持音频播放
                    </audio>
                  </div>
                ))}
              </div>
            </div>
          )}

          {docAttachments.length > 0 && (
            <div className="mt-5 pt-4 border-t border-surface-100">
              <h4 className="text-sm font-medium text-surface-600 mb-3 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                文档
                <span className="text-xs text-surface-400">({docAttachments.length})</span>
              </h4>
              <div className="space-y-2">
                {docAttachments.map((att) => {
                  const isExpanded = expandedAnnotation === att.id;
                  const annotation = att.aiAnnotation || '';
                  return (
                    <div key={att.id} className="p-3 bg-surface-50 rounded-xl border border-surface-200">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-lg">📄</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-surface-700 truncate">{att.originalName}</p>
                          {annotation && (
                            <div className="mt-1">
                              <p className="text-xs text-surface-500">
                                {isExpanded ? annotation : annotation.slice(0, 100)}{!isExpanded && annotation.length > 100 ? '...' : ''}
                              </p>
                              {annotation.length > 100 && (
                                <button
                                  onClick={() => setExpandedAnnotation(isExpanded ? null : att.id)}
                                  className="text-brand-500 text-xs mt-0.5 hover:text-brand-600"
                                >
                                  {isExpanded ? '收起' : '展开全文'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        <a
                          href={getAttachmentDownloadUrl(att.id)}
                          className="text-brand-500 hover:text-brand-600 flex-shrink-0"
                          title="下载"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="card card-responsive-lg mb-4 sm:mb-5">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl gradient-bg flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" /></svg>
              </div>
              <h3 className="font-semibold text-surface-800">AI 洞察</h3>
            </div>
            {!currentDiary.aiInsight && (
              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                className="text-brand-500 hover:text-brand-600 text-sm font-medium disabled:opacity-50"
              >
                {isAnalyzing ? (
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    分析中...
                  </span>
                ) : '开始分析'}
              </button>
            )}
          </div>

          {currentDiary.aiInsight ? (
            <div className={`${primaryConfig.bgColor} rounded-xl p-4`}>
              <p className="text-surface-700 text-sm leading-relaxed">{currentDiary.aiInsight}</p>
            </div>
          ) : (
            <p className="text-surface-400 text-sm">点击"开始分析"，AI为你解读这篇日记的情感内涵</p>
          )}
        </div>

        <div className="card card-responsive-lg mb-4 sm:mb-5">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                <svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
              </div>
              <div>
                <h3 className="font-semibold text-surface-800">深度分析</h3>
                <p className="text-xs text-surface-400">综合分析</p>
              </div>
            </div>
            {!deepAnalysis && (
              <button
                onClick={handleDeepAnalyze}
                disabled={isDeepAnalyzing}
                className="text-violet-600 hover:text-violet-700 text-sm font-medium disabled:opacity-50"
              >
                {isDeepAnalyzing ? (
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    深度分析中...
                  </span>
                ) : '深度分析'}
              </button>
            )}
          </div>

          {deepAnalysis ? (
            <div className="bg-violet-50 rounded-xl p-4 space-y-3">
              {deepAnalysis.split('\n').filter((l) => l.trim()).map((line, i) => (
                <p key={i} className={`text-sm leading-relaxed ${line.startsWith('**') ? 'font-semibold text-violet-700' :
                  line.startsWith('-') || line.startsWith('?') ? 'text-surface-700 pl-2' :
                    line.match(/^\d+\./) ? 'text-surface-700 pl-2' :
                      'text-surface-700'
                  }`}>
                  {line.replace(/\*\*/g, '')}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-surface-400 text-sm">
              深度分析将结合你的日程安排、健康信息等进行综合分析，为你提供全面、更专业的建议
            </p>
          )}
        </div>
      </main>

      {lightboxIndex !== null && imageAttachments.length > 0 && (
        <div
          className="fixed inset-0 z-[55] bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxIndex(null)}
          onTouchStart={(e) => { touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
          onTouchEnd={(e) => {
            if (!touchStartRef.current) return;
            const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
            const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
            touchStartRef.current = null;
            if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
            if (imageAttachments.length <= 1) return;
            if (dx > 0) {
              setLightboxIndex(lightboxIndex! > 0 ? lightboxIndex! - 1 : imageAttachments.length - 1);
            } else {
              setLightboxIndex(lightboxIndex! < imageAttachments.length - 1 ? lightboxIndex! + 1 : 0);
            }
          }}
        >
          <button
            onClick={() => setLightboxIndex(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors z-10"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {imageAttachments.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex > 0 ? lightboxIndex - 1 : imageAttachments.length - 1); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors z-10"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex < imageAttachments.length - 1 ? lightboxIndex + 1 : 0); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors z-10"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}

          <div className="max-w-[90vw] max-h-[85vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <img
              src={getOriginalFileUrl(imageAttachments[lightboxIndex].filePath ?? null) || getAttachmentDownloadUrl(imageAttachments[lightboxIndex].id, true)}
              alt={imageAttachments[lightboxIndex].originalName}
              className="max-w-full max-h-[75vh] object-contain rounded-lg"
            />
            <div className="mt-3 text-center">
              <p className="text-white/80 text-sm">{imageAttachments[lightboxIndex].originalName}</p>
              {imageAttachments[lightboxIndex].aiAnnotation && (
                <p className="text-white/50 text-xs mt-1 max-w-lg">{imageAttachments[lightboxIndex].aiAnnotation}</p>
              )}
              {imageAttachments.length > 1 && (
                <p className="text-white/40 text-xs mt-2">{lightboxIndex + 1} / {imageAttachments.length} · 按 ← → 切换</p>
              )}
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div
          className="overlay"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="modal-content p-5 sm:p-7 max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-surface-800 mb-2">确认删除</h3>
            <p className="text-surface-400 text-sm mb-6">删除后无法恢复，确认要删除这篇日记吗？</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} className="btn-secondary flex-1 py-2.5 text-sm">取消</button>
              <button onClick={handleDelete} className="flex-1 bg-red-500 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-red-600 transition-colors">确认删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DiaryDetailPage;
