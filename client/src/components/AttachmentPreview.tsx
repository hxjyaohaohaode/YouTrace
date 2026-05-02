import { useState, useEffect } from 'react';

interface AttachmentPreviewProps {
    attachments: Array<{
        id: string;
        originalName: string;
        mimeType: string;
        thumbnailPath: string | null;
        fileType: 'image' | 'video' | 'audio' | 'document';
    }>;
    currentIndex: number;
    visible: boolean;
    onClose: () => void;
    onPrev: () => void;
    onNext: () => void;
}

export default function AttachmentPreview({
    attachments,
    currentIndex,
    visible,
    onClose,
    onPrev,
    onNext,
}: AttachmentPreviewProps) {
    const [imgError, setImgError] = useState(false);
    const current = attachments[currentIndex];

    useEffect(() => {
        setImgError(false);
    }, [currentIndex]);

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (!visible) return;
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowLeft') onPrev();
            if (e.key === 'ArrowRight') onNext();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [visible, onClose, onPrev, onNext]);

    useEffect(() => {
        if (visible) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [visible]);

    if (!visible || !current) return null;

    const fileUrl = `/api/files/originals/${current.id}`;

    const isImage = current.mimeType.startsWith('image/');
    const isVideo = current.mimeType.startsWith('video/');
    const isAudio = current.mimeType.startsWith('audio/');
    const isPdf = current.mimeType === 'application/pdf';

    const renderContent = () => {
        if (isImage && !imgError) {
            return (
                <img
                    src={fileUrl}
                    alt={current.originalName}
                    className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg shadow-2xl"
                    onError={() => setImgError(true)}
                />
            );
        }

        if (isVideo) {
            return (
                <video
                    controls
                    autoPlay
                    className="max-w-[90vw] max-h-[80vh] rounded-lg shadow-2xl"
                >
                    <source src={fileUrl} type={current.mimeType} />
                    您的浏览器不支持视频播放
                </video>
            );
        }

        if (isAudio) {
            return (
                <div className="w-[420px] max-w-[90vw] bg-white rounded-2xl p-8 shadow-2xl text-center">
                    <div className="text-6xl mb-4">🎵</div>
                    <p className="font-semibold text-surface-800 mb-4">{current.originalName}</p>
                    <audio controls autoPlay className="w-full">
                        <source src={fileUrl} type={current.mimeType} />
                        您的浏览器不支持音频播放
                    </audio>
                </div>
            );
        }

        if (isPdf) {
            return (
                <iframe
                    src={`/api/attachments/${current.id}/download?inline=1`}
                    className="w-[90vw] h-[85vh] rounded-lg shadow-2xl bg-white"
                    title={current.originalName}
                />
            );
        }

        return (
            <div className="w-[420px] max-w-[90vw] bg-white rounded-2xl p-8 shadow-2xl text-center">
                <div className="text-6xl mb-4">{getFileIcon(current.mimeType, current.originalName)}</div>
                <p className="font-semibold text-surface-800 mb-2">{current.originalName}</p>
                <p className="text-sm text-surface-400 mb-4">{getFileTypeLabel(current.mimeType)}</p>
                <a
                    href={`/api/attachments/${current.id}/download`}
                    download={current.originalName}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-brand-500 text-white rounded-xl hover:bg-brand-600 transition-colors font-medium"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    下载文件
                </a>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm animate-fadeIn">
            <button
                onClick={onClose}
                className="absolute top-6 right-6 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors z-10"
                title="关闭 (Esc)"
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>

            <div className="absolute top-6 left-6 text-white/70 text-sm z-10">
                {currentIndex + 1} / {attachments.length}
            </div>

            {attachments.length > 1 && (
                <>
                    <button
                        onClick={onPrev}
                        className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors z-10"
                        title="上一张 (←)"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <button
                        onClick={onNext}
                        className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors z-10"
                        title="下一张 (→)"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </button>
                </>
            )}

            <div className="flex items-center justify-center max-w-full max-h-full p-8">
                {renderContent()}
            </div>
        </div>
    );
}

function getFileIcon(mimeType: string, fileName: string): string {
    const name = fileName.toLowerCase();
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('word') || name.endsWith('.doc') || name.endsWith('.docx')) return '📝';
    if (mimeType.includes('excel') || mimeType.includes('spreadsheet') || name.endsWith('.xls') || name.endsWith('.xlsx') || name.endsWith('.csv')) return '📊';
    if (mimeType.includes('presentation') || name.endsWith('.ppt') || name.endsWith('.pptx')) return '📽️';
    if (name.match(/\.(js|ts|jsx|tsx|py|java|cpp|c|go|rs|rb|php|html|css|json|xml|yaml|yml|md|sql|sh|bat)$/)) return '💻';
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z') || mimeType.includes('tar') || mimeType.includes('gz')) return '📦';
    return '📄';
}

function getFileTypeLabel(mimeType: string): string {
    if (mimeType.startsWith('video/')) return '视频文件';
    if (mimeType.startsWith('audio/')) return '音频文件';
    if (mimeType.includes('pdf')) return 'PDF文档';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'Word文档';
    if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'Excel表格';
    if (mimeType.includes('presentation')) return 'PPT演示文稿';
    if (mimeType.startsWith('text/')) return '文本文件';
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z')) return '压缩包';
    return '文件';
}
