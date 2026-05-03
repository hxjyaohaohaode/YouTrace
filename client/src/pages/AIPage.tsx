import { useEffect, useRef, useState, useCallback } from 'react';
import { useAIStore } from '../stores/aiStore';
import { uploadApi, getThumbnailUrl, getOriginalFileUrl, getAttachmentDownloadUrl, type AttachmentResult } from '../api/upload';
import { IconAI, IconCalendar, IconHeart, IconBolt, IconTarget, IconWeather, IconSend, IconCheck, IconSparkles, IconXMark, IconPlus, IconTrash } from '../components/Icons';
import { HighlightText } from '../components/HighlightText';
import type { Conversation, AgentTraceState } from '../types';

const MAX_ATTACHMENTS = 9;
const ACCEPTED_TYPES = 'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/aac,audio/mp4,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md';

const quickPrompts = [
  { text: '今天有什么日程？', Icon: IconCalendar },
  { text: '帮我分析最近心情', Icon: IconHeart },
  { text: '给我一些健康建议', Icon: IconBolt },
  { text: '如何提高效率？', Icon: IconTarget },
  { text: '今天天气怎么样？', Icon: IconWeather },
  { text: '帮我规划明天', Icon: IconCalendar },
];

const agentIcons: Record<string, typeof IconAI> = {
  default: IconAI,
  schedule: IconCalendar,
  emotion: IconHeart,
  health: IconBolt,
  productivity: IconTarget,
  weather: IconWeather,
};

const agentLabelColors: Record<string, string> = {
  schedule: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border-blue-200 dark:border-blue-800',
  emotion: 'bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-400 border-pink-200 dark:border-pink-800',
  health: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400 border-green-200 dark:border-green-800',
  productivity: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400 border-purple-200 dark:border-purple-800',
  weather: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400 border-sky-200 dark:border-sky-800',
  learning: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  default: 'bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400 border-brand-200 dark:border-brand-800',
};

const toolLabels: Record<string, { icon: string; label: string }> = {
  get_weather: { icon: '🌤️', label: '查天气' },
  get_location: { icon: '📍', label: '定位' },
  get_events: { icon: '📅', label: '查日程' },
  create_event: { icon: '➕', label: '创建日程' },
  update_event: { icon: '✏️', label: '更新日程' },
  delete_event: { icon: '🗑️', label: '删除日程' },
  get_diaries: { icon: '📔', label: '查日记' },
  create_diary: { icon: '✍️', label: '写日记' },
  analyze_emotion: { icon: '💭', label: '情绪分析' },
  get_goals: { icon: '🎯', label: '查目标' },
  get_habits: { icon: '🔄', label: '查习惯' },
  log_habit: { icon: '✅', label: '习惯打卡' },
  get_memories: { icon: '🧠', label: '查记忆' },
  search_web: { icon: '🔍', label: '搜索' },
};

function AgentTracePanel({ trace }: { trace: AgentTraceState }) {
  const agentEntries = Array.from(trace.agents.entries());
  const runningToolCalls = trace.toolCalls.filter((tc) => tc.status === 'running');
  const activeCount = agentEntries.filter(([, a]) => a.status === 'running').length;
  const doneCount = agentEntries.filter(([, a]) => a.status === 'done').length;
  const errorCount = agentEntries.filter(([, a]) => a.status === 'error').length;

  if (agentEntries.length === 0 && !trace.isSynthesizing) return null;

  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[85%] sm:max-w-[75%] lg:max-w-[70%]">
        <div className="bg-white/60 dark:bg-surface-800/60 backdrop-blur-sm border border-surface-200/60 dark:border-surface-700/60 rounded-2xl px-3.5 py-3 shadow-sm">
          {agentEntries.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              <span className="text-[10px] font-medium text-surface-400 dark:text-surface-500 mr-0.5">
                {activeCount > 0 ? '思考中' : doneCount > 0 ? '已完成' : ''}
              </span>
              {agentEntries.map(([id, agent]) => (
                <span
                  key={id}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all duration-300 ${agentLabelColors[id] || agentLabelColors.default
                    } ${agent.status === 'running' ? 'ring-1 ring-current/20' : ''}`}
                >
                  <span className="text-xs">{agent.icon}</span>
                  <span>{agent.name}</span>
                  {agent.status === 'running' ? (
                    <svg className="w-2.5 h-2.5 animate-spin ml-0.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : agent.status === 'done' ? (
                    <svg className="w-2.5 h-2.5 text-green-500 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-2.5 h-2.5 text-red-500 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </span>
              ))}
            </div>
          )}

          {runningToolCalls.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {runningToolCalls.map((tc, idx) => {
                const toolInfo = toolLabels[tc.toolName] || { icon: '🔧', label: tc.toolName };
                return (
                  <span
                    key={`${tc.agentId}-${tc.toolName}-${idx}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                  >
                    <span>{toolInfo.icon}</span>
                    <span>{toolInfo.label}</span>
                    <svg className="w-2.5 h-2.5 animate-spin ml-0.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </span>
                );
              })}
            </div>
          )}

          {trace.isSynthesizing && (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-brand-50 dark:bg-brand-950/30 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-800">
                <span>✨</span>
                <span>AI核心融合中</span>
                <svg className="w-2.5 h-2.5 animate-spin ml-0.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </span>
            </div>
          )}

          {trace.totalAgents > 1 && errorCount > 0 && (
            <p className="text-[10px] text-surface-400 mt-1.5">
              {doneCount}/{trace.totalAgents} 个专家完成分析
              {errorCount > 0 && ` (${errorCount} 个出错)`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ConversationItem({ conversation, isActive, onSelect, onDelete, searchQuery }: {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  searchQuery?: string;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 ${isActive ? 'bg-brand-50 dark:bg-brand-950/30' : 'hover:bg-surface-50 dark:hover:bg-surface-800'
        }`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-brand-500 text-white' : 'bg-surface-100 dark:bg-surface-800 text-surface-400'
        }`}>
        <IconAI size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${isActive ? 'text-brand-700 dark:text-brand-400 font-medium' : 'text-surface-700 dark:text-surface-300'}`}>
          {searchQuery ? <HighlightText text={conversation.title} keyword={searchQuery} /> : conversation.title}
        </p>
        <p className="text-2xs text-surface-400 truncate">
          {conversation.messageCount} 条消息 · {new Date(conversation.updatedAt).toLocaleDateString('zh-CN')}
        </p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (confirmDelete) {
            onDelete();
            setConfirmDelete(false);
          } else {
            setConfirmDelete(true);
            setTimeout(() => setConfirmDelete(false), 3000);
          }
        }}
        className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${confirmDelete
          ? 'bg-red-100 dark:bg-red-900/30 text-red-500'
          : 'opacity-0 group-hover:opacity-100 text-surface-300 dark:text-surface-600 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30'
          }`}
        title={confirmDelete ? '确认删除' : '删除对话'}
      >
        <IconTrash size={14} />
      </button>
    </div>
  );
}

export default function AIPage() {
  const {
    messages, agents, selectedAgent, isSending, error, agentTrace,
    conversations, currentConversationId,
    sendMessage, fetchAgents, setSelectedAgent, clearError,
    fetchConversations, selectConversation, deleteConversation, startNewChat,
  } = useAIStore();

  const [input, setInput] = useState('');
  const [showAgents, setShowAgents] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentResult[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isWaitingAnnotation, setIsWaitingAnnotation] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const agentBtnRef = useRef<HTMLButtonElement>(null);
  const [agentDropdownPos, setAgentDropdownPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchAgents();
    fetchConversations();
  }, [fetchAgents, fetchConversations]);

  useEffect(() => {
    if (!showAgents) return;
    const handleClickOutside = () => setShowAgents(false);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showAgents]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const hasProcessing = pendingAttachments.some((a) => a.annotationStatus === 'processing' || a.annotationStatus === 'pending');
    if (hasProcessing && !pollingRef.current) {
      pollingRef.current = setInterval(async () => {
        const processingIds = pendingAttachments
          .filter((a) => a.annotationStatus === 'processing' || a.annotationStatus === 'pending')
          .map((a) => a.id);
        if (processingIds.length === 0) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          return;
        }
        try {
          const response = await uploadApi.batchStatus(processingIds);
          if (response.success && response.data) {
            setPendingAttachments((prev) =>
              prev.map((att) => {
                const updated = response.data!.find((r) => r.id === att.id);
                if (updated) {
                  return {
                    ...att,
                    annotationStatus: updated.annotationStatus as AttachmentResult['annotationStatus'],
                    aiAnnotation: updated.aiAnnotation || att.aiAnnotation,
                    thumbnailPath: updated.thumbnailPath ?? att.thumbnailPath,
                    filePath: updated.filePath ?? att.filePath,
                    fileType: (updated.fileType as AttachmentResult['fileType']) ?? att.fileType,
                  };
                }
                return att;
              })
            );
          }
        } catch {
          // polling failed, ignore
        }
      }, 2000);
    }
    if (!hasProcessing && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [pendingAttachments]);

  const processFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const remaining = MAX_ATTACHMENTS - pendingAttachments.length;
    if (remaining <= 0) return;
    const toUpload = files.slice(0, remaining);
    setIsUploading(true);
    setUploadError('');
    try {
      const response = await uploadApi.uploadFiles(toUpload);
      if (response.success && response.data) {
        const successful = response.data.filter((r) => r.id) as AttachmentResult[];
        if (successful.length > 0) {
          setPendingAttachments((prev) => [...prev, ...successful]);
        }
        if (successful.length < toUpload.length) {
          setUploadError(`${toUpload.length - successful.length} 个文件上传失败，可能是文件类型不支持或文件损坏`);
        }
      } else {
        setUploadError(response.message || '上传失败，请重试');
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : '上传请求失败';
      setUploadError(errMsg || '上传失败，请检查网络连接');
    }
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [pendingAttachments.length]);

  const waitForAnnotations = async (attachmentIds: string[]): Promise<void> => {
    const maxWait = 30000;
    const interval = 1500;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      try {
        const response = await uploadApi.batchStatus(attachmentIds);
        if (response.success && response.data) {
          const allDone = response.data.every(
            (r) => r.annotationStatus === 'completed' || r.annotationStatus === 'failed'
          );
          setPendingAttachments((prev) =>
            prev.map((att) => {
              const updated = response.data!.find((r) => r.id === att.id);
              if (updated) {
                return {
                  ...att,
                  annotationStatus: updated.annotationStatus as AttachmentResult['annotationStatus'],
                  aiAnnotation: updated.aiAnnotation || att.aiAnnotation,
                  thumbnailPath: updated.thumbnailPath ?? att.thumbnailPath,
                  filePath: updated.filePath ?? att.filePath,
                  fileType: (updated.fileType as AttachmentResult['fileType']) ?? att.fileType,
                };
              }
              return att;
            })
          );
          if (allDone) return;
        }
      } catch {
        // ignore polling errors
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && pendingAttachments.length === 0) || isSending) return;
    setInput('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    const attachmentIds = pendingAttachments.map((a) => a.id);
    const hasProcessing = pendingAttachments.some(
      (a) => a.annotationStatus === 'processing' || a.annotationStatus === 'pending'
    );

    if (hasProcessing && attachmentIds.length > 0) {
      setIsWaitingAnnotation(true);
      await waitForAnnotations(attachmentIds);
      setIsWaitingAnnotation(false);
    }

    setPendingAttachments([]);
    await sendMessage(text || '请查看我上传的附件', attachmentIds.length > 0 ? attachmentIds : undefined);
  };

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
      await processFiles(imageFiles);
    }
  }, [processFiles]);

  const removeAttachment = (id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      if (!isMobile) {
        e.preventDefault();
        handleSend();
      }
    }
  };

  const handleQuickPrompt = (text: string) => {
    setInput(text);
    sendMessage(text);
  };

  const handleNewChat = () => {
    startNewChat();
    setShowHistory(false);
  };

  const handleSelectConversation = async (id: string) => {
    await selectConversation(id);
    setShowHistory(false);
  };

  const handleDeleteConversation = async (id: string) => {
    await deleteConversation(id);
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    fetchConversations(query || undefined);
  };

  const currentAgent = agents.find((a) => a.id === selectedAgent) || agents[0];
  const CurrentAgentIcon = agentIcons[selectedAgent] || IconAI;

  return (
    <div className="flex flex-col h-dvh md:h-screen overflow-hidden ai-chat-container">
      <header className="flex-shrink-0 border-b border-surface-100/60 dark:border-surface-800/60 bg-white/92 dark:bg-surface-900/92 backdrop-blur-xl z-10 relative">
        <div className="px-3 sm:px-8 lg:px-12 pt-3 pb-2.5 sm:pt-4 sm:pb-3 flex items-center justify-between safe-top">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 bg-gradient-to-br from-brand-500 to-brand-600 rounded-xl flex items-center justify-center text-white shadow-sm flex-shrink-0">
              <CurrentAgentIcon size={16} className="text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">
                {currentAgent?.name || 'AI 助手'}
              </h1>
              <p className="text-2xs text-surface-400 truncate hidden sm:block">{currentAgent?.description || '随时为你服务'}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-1 flex-shrink-0 ml-2">
            <button
              onClick={() => {
                if (messages.length === 0) return;
                const md = messages.map((m) => `**${m.role === 'user' ? '我' : 'AI'}**\n\n${m.content}`).join('\n\n---\n\n');
                const blob = new Blob([md], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `对话_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.md`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-surface-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-colors active:bg-surface-100 dark:active:bg-surface-800"
              title="导出对话"
            >
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            </button>
            <button
              onClick={handleNewChat}
              className="w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-surface-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-colors active:bg-surface-100 dark:active:bg-surface-800"
              title="新建对话"
            >
              <IconPlus size={18} />
            </button>
            <button
              onClick={() => { setShowHistory(!showHistory); fetchConversations(); }}
              className={`w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-colors active:bg-surface-100 dark:active:bg-surface-800 ${showHistory ? 'text-brand-500 bg-brand-50 dark:bg-brand-950/30' : 'text-surface-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-950/30'
                }`}
              title="历史对话"
            >
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            <div>
              <button
                ref={agentBtnRef}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!showAgents && agentBtnRef.current) {
                    const rect = agentBtnRef.current.getBoundingClientRect();
                    setAgentDropdownPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
                  }
                  setShowAgents(!showAgents);
                }}
                className="w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-surface-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-colors active:bg-surface-100 dark:active:bg-surface-800"
                title="切换专家"
              >
                <IconSparkles size={18} className="text-brand-400" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0 relative">
        {showHistory && (
          <div className="absolute inset-0 z-20 flex">
            <div className="w-full sm:w-80 bg-white dark:bg-surface-900 border-r border-surface-100 dark:border-surface-800 flex flex-col shadow-lg sm:shadow-none">
              <div className="p-3 border-b border-surface-100 dark:border-surface-800 flex items-center gap-2">
                <button
                  onClick={() => setShowHistory(false)}
                  className="sm:hidden w-8 h-8 rounded-lg flex items-center justify-center text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors flex-shrink-0"
                  title="返回"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                </button>
                <button
                  onClick={() => setShowHistory(false)}
                  className="hidden sm:flex w-8 h-8 rounded-lg items-center justify-center text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors flex-shrink-0"
                  title="关闭"
                >
                  <IconXMark size={16} />
                </button>
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder="搜索对话..."
                    className="input-field pl-8 py-2 text-sm"
                  />
                  <svg className="w-3.5 h-3.5 text-surface-400 absolute left-2.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {conversations.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-surface-400">
                      {searchQuery ? '没有找到匹配的对话' : '还没有对话记录'}
                    </p>
                  </div>
                ) : (
                  conversations.map((conv) => (
                    <ConversationItem
                      key={conv.id}
                      conversation={conv}
                      isActive={currentConversationId === conv.id}
                      onSelect={() => handleSelectConversation(conv.id)}
                      onDelete={() => handleDeleteConversation(conv.id)}
                      searchQuery={searchQuery}
                    />
                  ))
                )}
              </div>
              <div className="p-2 border-t border-surface-100 dark:border-surface-800">
                <button
                  onClick={handleNewChat}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/30 hover:bg-brand-100 dark:hover:bg-brand-950/50 transition-colors"
                >
                  <IconPlus size={16} />
                  新建对话
                </button>
              </div>
            </div>
            <div
              className="flex-1 bg-black/10 hidden sm:block"
              onClick={() => setShowHistory(false)}
            />
          </div>
        )}

        <div className="flex-1 flex flex-col min-h-0" ref={dropZoneRef} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
          <div className="flex-1 overflow-y-auto px-4 sm:px-8 lg:px-12 py-4 sm:py-5">
            <div className="md:max-w-3xl mx-auto w-full space-y-5">
              {messages.length === 0 && (
                <div className="empty-state py-12">
                  <div className="w-16 h-16 bg-gradient-to-br from-brand-500 to-brand-600 rounded-2xl flex items-center justify-center text-white shadow-card mb-3">
                    <CurrentAgentIcon size={28} className="text-white" />
                  </div>
                  <h2 className="text-base font-semibold text-surface-700 dark:text-surface-200 mb-1">你好，我是{currentAgent?.name || 'AI 助手'}</h2>
                  <p className="text-sm text-surface-400 mb-5 max-w-xs">{currentAgent?.description || '我可以帮你管理日程、分析情绪、提供建议'}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 w-full max-w-md">
                    {quickPrompts.map((prompt) => (
                      <button
                        key={prompt.text}
                        onClick={() => handleQuickPrompt(prompt.text)}
                        className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-surface-800 border border-surface-100 dark:border-surface-700 rounded-xl text-sm text-surface-600 dark:text-surface-300 hover:bg-brand-50 dark:hover:bg-brand-950/30 hover:border-brand-100 dark:hover:border-brand-900 hover:text-brand-600 dark:hover:text-brand-400 transition-all duration-200 shadow-card"
                      >
                        <prompt.Icon size={14} className="text-brand-400 flex-shrink-0" />
                        <span className="truncate text-xs">{prompt.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg) => {
                const MsgIcon = agentIcons[msg.agentType] || IconAI;
                return (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} mb-3`}
                  >
                    <div className={`max-w-[85%] sm:max-w-[75%] lg:max-w-[70%] ${msg.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'}`}>
                      {msg.role === 'assistant' && (
                        <div className="flex items-center gap-1.5 mb-1 px-4 pt-2.5">
                          <MsgIcon size={11} className="text-brand-400" />
                          <span className="text-2xs font-medium text-surface-400">{agents.find((a) => a.id === msg.agentType)?.name || 'AI 助手'}</span>
                        </div>
                      )}
                      <div className="px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>
                      {msg.role === 'user' && msg.attachmentIds && msg.attachmentIds.length > 0 && (
                        <div className="px-4 pb-1">
                          {msg.attachmentMeta && msg.attachmentMeta.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {msg.attachmentMeta.map((att) => {
                                const thumbUrl = getThumbnailUrl(att.thumbnailPath);
                                const downloadUrl = att.fileType === 'image' ? getOriginalFileUrl(att.filePath) : getAttachmentDownloadUrl(att.id, true);
                                if (att.fileType === 'image') {
                                  return (
                                    <a
                                      key={att.id}
                                      href={downloadUrl || '#'}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="block w-16 h-16 rounded-lg overflow-hidden border border-white/20 hover:border-white/40 transition-colors"
                                    >
                                      {thumbUrl ? (
                                        <img src={thumbUrl} alt={att.originalName} className="w-full h-full object-cover" />
                                      ) : (
                                        <div className="w-full h-full bg-white/10 flex items-center justify-center text-white/60">
                                          <span className="text-lg">🖼️</span>
                                        </div>
                                      )}
                                    </a>
                                  );
                                }
                                if (att.fileType === 'video') {
                                  return (
                                    <a
                                      key={att.id}
                                      href={downloadUrl || '#'}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1.5 px-2 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-[10px] text-white/80 transition-colors group"
                                    >
                                      <span className="text-lg">🎬</span>
                                      <div className="min-w-0">
                                        <span className="truncate block max-w-[100px]">{att.originalName}</span>
                                        <span className="text-white/40 text-[9px]">点击下载观看</span>
                                      </div>
                                    </a>
                                  );
                                }
                                if (att.fileType === 'audio') {
                                  return (
                                    <a
                                      key={att.id}
                                      href={downloadUrl || '#'}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1.5 px-2 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-[10px] text-white/80 transition-colors group"
                                    >
                                      <span className="text-lg">🎵</span>
                                      <div className="min-w-0">
                                        <span className="truncate block max-w-[100px]">{att.originalName}</span>
                                        <span className="text-white/40 text-[9px]">点击下载收听</span>
                                      </div>
                                    </a>
                                  );
                                }
                                return (
                                  <a
                                    key={att.id}
                                    href={downloadUrl || '#'}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 px-2 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-[10px] text-white/80 transition-colors group"
                                  >
                                    <span className="text-lg">{getFileTypeIcon(att.fileType)}</span>
                                    <div className="min-w-0">
                                      <span className="truncate block max-w-[100px]">{att.originalName}</span>
                                      <span className="text-white/40 text-[9px]">点击下载查看</span>
                                    </div>
                                  </a>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {msg.attachmentIds.map((attId, i) => {
                                const attName = msg.attachmentNames?.[i] || `附件${i + 1}`;
                                const downloadUrl = getAttachmentDownloadUrl(attId, true);
                                return (
                                  <a
                                    key={attId}
                                    href={downloadUrl || '#'}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 px-2 py-1 bg-white/15 hover:bg-white/25 rounded-lg text-[10px] text-white/80 transition-colors"
                                  >
                                    <span>📎</span>
                                    <span className="truncate max-w-[100px]">{attName}</span>
                                    <svg className="w-3 h-3 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                  </a>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                      <div className={`px-4 pb-2 text-[10px] ${msg.role === 'user' ? 'text-white/50' : 'text-surface-300'}`}>
                        {new Date(msg.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                );
              })}

              {isSending && !agentTrace && (
                <div className="flex justify-start mb-3">
                  <div className="chat-bubble-ai px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <CurrentAgentIcon size={11} className="text-brand-400" />
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-brand-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-brand-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-brand-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {isSending && agentTrace && (
                <AgentTracePanel trace={agentTrace} />
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {error && (
            <div className="px-5 sm:px-8 lg:px-12 pb-2 flex-shrink-0">
              <div className="md:max-w-3xl mx-auto">
                <div className="px-3 py-2 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 rounded-xl text-sm text-red-600 dark:text-red-400 flex items-center justify-between">
                  <span>{error}</span>
                  <button onClick={clearError} className="text-red-400 hover:text-red-600">
                    <IconXMark size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className={`border-t border-surface-100/60 dark:border-surface-800/60 bg-white dark:bg-surface-900 px-5 sm:px-8 lg:px-12 py-3 flex-shrink-0 transition-colors md:safe-bottom ${isDragOver ? 'bg-brand-50/50 border-brand-200' : ''
            }`}>
            <div className="md:max-w-3xl mx-auto">
              {uploadError && (
                <div className="mb-2 px-3 py-2 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 rounded-lg text-xs text-red-600 dark:text-red-400 flex items-center justify-between">
                  <span>{uploadError}</span>
                  <button onClick={() => setUploadError('')} className="text-red-400 hover:text-red-600 ml-2">
                    <IconXMark size={12} />
                  </button>
                </div>
              )}
              {pendingAttachments.length > 0 && (
                <div className="mb-2 p-2.5 bg-surface-50 dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-surface-400 font-medium">待发送附件 ({pendingAttachments.length}/{MAX_ATTACHMENTS})</span>
                    {pendingAttachments.some((a) => a.annotationStatus === 'processing' || a.annotationStatus === 'pending') && (
                      <span className="text-[10px] text-brand-500 font-medium flex items-center gap-1">
                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        AI 分析中...
                      </span>
                    )}
                    {!pendingAttachments.some((a) => a.annotationStatus === 'processing' || a.annotationStatus === 'pending') && (
                      <span className="text-[10px] text-green-500 font-medium flex items-center gap-0.5">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                        分析完成
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {pendingAttachments.map((att) => {
                      const thumbUrl = getThumbnailUrl(att.thumbnailPath);
                      const isProcessing = att.annotationStatus === 'processing' || att.annotationStatus === 'pending';
                      return (
                        <div
                          key={att.id}
                          className="relative group"
                        >
                          {att.fileType === 'image' && thumbUrl ? (
                            <div className={`w-12 h-12 rounded-lg overflow-hidden border ${isProcessing ? 'border-brand-200 dark:border-brand-800 ring-1 ring-brand-100' : 'border-surface-200 dark:border-surface-700'}`}>
                              <img src={thumbUrl} alt={att.originalName} className={`w-full h-full object-cover ${isProcessing ? 'opacity-60' : ''}`} />
                              {isProcessing && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <svg className="w-4 h-4 text-brand-500 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className={`flex items-center gap-1 px-2 py-1 bg-white dark:bg-surface-700 border border-surface-200 dark:border-surface-600 rounded-lg text-xs max-w-[160px] ${isProcessing ? 'border-brand-200 dark:border-brand-800' : ''}`}>
                              <span>{getFileTypeIcon(att.fileType)}</span>
                              <span className="truncate text-surface-700 dark:text-surface-300">{att.originalName}</span>
                              {isProcessing && (
                                <svg className="w-3 h-3 text-brand-500 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                              )}
                            </div>
                          )}
                          {att.annotationStatus !== 'processing' && att.annotationStatus !== 'pending' && (
                            <button
                              onClick={() => removeAttachment(att.id)}
                              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                          {att.annotationStatus === 'completed' && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-green-500 flex items-center justify-center">
                              <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {pendingAttachments.some((a) => a.annotationStatus === 'processing' || a.annotationStatus === 'pending') && (
                    <div className="mt-2 p-2 bg-brand-50 dark:bg-brand-950/30 rounded-lg border border-brand-100 dark:border-brand-900/50">
                      <p className="text-[10px] text-brand-600 dark:text-brand-400 leading-relaxed">
                        <span className="font-medium">⏳ 正在分析附件内容...</span>
                        <br />分析完成后即可发送消息，AI 将更好地理解你的附件内容。请稍候。
                      </p>
                    </div>
                  )}
                  {!pendingAttachments.some((a) => a.annotationStatus === 'processing' || a.annotationStatus === 'pending')
                    && pendingAttachments.some((a) => a.aiAnnotation)
                    && (
                      <div className="mt-1.5 p-2 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
                        {pendingAttachments.filter((a) => a.aiAnnotation).map((att) => (
                          <p key={att.id} className="text-[10px] text-blue-600 dark:text-blue-400">
                            <span className="font-medium">{att.originalName}:</span> {att.aiAnnotation.slice(0, 60)}{att.aiAnnotation.length > 60 ? '...' : ''}
                          </p>
                        ))}
                      </div>
                    )}
                </div>
              )}
              {isDragOver && (
                <div className="mb-2 p-3 border-2 border-dashed border-brand-400 dark:border-brand-500 rounded-xl bg-brand-50 dark:bg-brand-950/20 text-center">
                  <p className="text-sm text-brand-600 dark:text-brand-400 font-medium">松开即可添加附件</p>
                </div>
              )}
              <div className="flex items-end gap-2" onPaste={handlePaste}>
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
                  className="w-[38px] h-[38px] rounded-xl flex items-center justify-center text-surface-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-950/30 border border-surface-200 dark:border-surface-700 transition-colors flex-shrink-0 disabled:opacity-50"
                  title={`添加附件 (${pendingAttachments.length}/${MAX_ATTACHMENTS})`}
                >
                  {isUploading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                    </svg>
                  )}
                </button>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`和${currentAgent?.name || 'AI 助手'}聊聊...`}
                  rows={1}
                  className="input-field resize-none min-h-[38px] max-h-[120px] flex-1 text-sm"
                  style={{ height: 'auto' }}
                  onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    target.style.height = 'auto';
                    target.style.height = Math.min(target.scrollHeight, 120) + 'px';
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={(!input.trim() && pendingAttachments.length === 0) || isSending || isWaitingAnnotation}
                  className="btn-primary px-3 py-2 h-[38px] flex-shrink-0"
                >
                  {isWaitingAnnotation ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <IconSend size={16} />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAgents && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setShowAgents(false)} />
          <div
            className="fixed z-[70] w-56 sm:w-60 bg-white dark:bg-surface-800 rounded-xl shadow-card-hover border border-surface-100 dark:border-surface-700 overflow-hidden max-h-[60vh] overflow-y-auto"
            style={{ top: agentDropdownPos.top, right: Math.max(agentDropdownPos.right, 8) }}
          >
            {agents.map((agent) => {
              const AgentIcon = agentIcons[agent.id] || IconAI;
              return (
                <button
                  key={agent.id}
                  onClick={() => { setSelectedAgent(agent.id); setShowAgents(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors ${selectedAgent === agent.id ? 'bg-brand-50 dark:bg-brand-950/30' : ''}`}
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${selectedAgent === agent.id
                    ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white'
                    : 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400'
                    }`}>
                    <AgentIcon size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{agent.name}</p>
                    <p className="text-2xs text-surface-400 truncate">{agent.description}</p>
                  </div>
                  {selectedAgent === agent.id && (
                    <IconCheck size={16} className="text-brand-500 ml-auto flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
