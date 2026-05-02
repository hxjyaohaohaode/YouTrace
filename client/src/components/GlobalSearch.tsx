import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchApi, type SearchCategoryResult, type SearchResultItem } from '../api/search';
import { HighlightText } from './HighlightText';

const CATEGORY_CONFIG: Record<string, { label: string; color: string; bgColor: string; path: string }> = {
  diary: { label: '日记', color: 'text-brand-600 dark:text-brand-400', bgColor: 'bg-brand-50 dark:bg-brand-950/30', path: '/diary' },
  attachment: { label: '附件', color: 'text-purple-600 dark:text-purple-400', bgColor: 'bg-purple-50 dark:bg-purple-950/30', path: '/diary' },
  event: { label: '日程', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-950/30', path: '/calendar' },
  chat: { label: 'AI对话', color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-50 dark:bg-emerald-950/30', path: '/ai' },
  goal: { label: '目标', color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-50 dark:bg-orange-950/30', path: '/goals' },
  habit: { label: '习惯', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-950/30', path: '/habits' },
  day: { label: '这一天', color: 'text-rose-600 dark:text-rose-400', bgColor: 'bg-rose-50 dark:bg-rose-950/30', path: '/' },
};

const CATEGORY_ICONS: Record<string, ReactNode> = {
  diary: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
  attachment: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
    </svg>
  ),
  event: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  chat: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  goal: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
    </svg>
  ),
  habit: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  day: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  ),
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays}天前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

interface GlobalSearchProps {
  onDiarySearch?: (keyword: string) => void;
}

function GlobalSearch({ onDiarySearch }: GlobalSearchProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<SearchCategoryResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }
    setIsSearching(true);
    searchApi.globalSearch({ q: debouncedQuery, limit: 10 }).then((res) => {
      if (res.success && res.data) {
        setResults(res.data.results);
        setShowResults(true);
      }
    }).catch(() => {
      setResults([]);
    }).finally(() => {
      setIsSearching(false);
    });
  }, [debouncedQuery]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleItemClick = useCallback((item: SearchResultItem) => {
    setShowResults(false);
    const searchKeyword = debouncedQuery.trim();
    switch (item.type) {
      case 'diary':
        navigate(`/diary/${item.id}`, { state: { highlight: searchKeyword } });
        break;
      case 'attachment':
        if (item.extra?.diaryId) {
          navigate(`/diary/${item.extra.diaryId}`, { state: { highlight: searchKeyword } });
        } else if (item.extra?.chatMessageId) {
          navigate('/ai', { state: { conversationId: item.extra.conversationId, highlight: searchKeyword } });
        }
        break;
      case 'event': {
        const eventDate = item.date ? new Date(item.date) : new Date();
        const dateStr = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`;
        navigate(`/calendar?date=${dateStr}&eventId=${item.id}`, { state: { highlight: searchKeyword } });
        break;
      }
      case 'chat':
        if (item.extra?.conversationId) {
          navigate('/ai', { state: { conversationId: item.extra.conversationId as string, highlight: searchKeyword } });
        }
        break;
      case 'goal':
        navigate('/goals', { state: { highlight: searchKeyword } });
        break;
      case 'habit':
        navigate('/habits', { state: { highlight: searchKeyword } });
        break;
      case 'day': {
        const dayDate = item.date ? new Date(item.date) : new Date();
        const dayStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
        navigate(`/?date=${dayStr}`, { state: { highlight: searchKeyword } });
        break;
      }
      default:
        break;
    }
  }, [navigate, debouncedQuery]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowResults(false);
      inputRef.current?.blur();
    }
    if (e.key === 'Enter' && !debouncedQuery.trim()) {
      onDiarySearch?.('');
    }
  }, [debouncedQuery, onDiarySearch]);

  const filteredResults = activeCategory === 'all'
    ? results
    : results.filter(r => r.category === activeCategory);

  const totalResults = results.reduce((sum, r) => sum + r.total, 0);

  const categoryFilters = [
    { key: 'all', label: '全部', count: totalResults },
    ...results.map(r => ({
      key: r.category,
      label: CATEGORY_CONFIG[r.category]?.label || r.label,
      count: r.total,
    })),
  ];

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (debouncedQuery.trim()) setShowResults(true); }}
          onKeyDown={handleKeyDown}
          placeholder="全局搜索日记、日程、对话、目标..."
          className="input-field pl-10 pr-10"
        />
        <svg className="w-4 h-4 text-surface-400 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        {isSearching && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!isSearching && query && (
          <button
            onClick={() => { setQuery(''); setResults([]); setShowResults(false); onDiarySearch?.(''); }}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-surface-200 dark:bg-surface-700 flex items-center justify-center text-surface-500 hover:bg-surface-300 dark:hover:bg-surface-600 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {showResults && debouncedQuery.trim() && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-surface-900 rounded-xl shadow-xl border border-surface-200/60 dark:border-surface-700/60 z-50 max-h-[70vh] overflow-hidden flex flex-col">
          {results.length === 0 && !isSearching ? (
            <div className="p-8 text-center">
              <svg className="w-10 h-10 mx-auto mb-3 text-surface-300 dark:text-surface-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <p className="text-sm text-surface-400">未找到「{debouncedQuery}」相关内容</p>
              <p className="text-xs text-surface-300 dark:text-surface-600 mt-1">试试其他关键词</p>
            </div>
          ) : (
            <>
              <div className="px-3 pt-3 pb-2 border-b border-surface-100 dark:border-surface-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-surface-400">
                    找到 <span className="font-medium text-surface-600 dark:text-surface-300">{totalResults}</span> 条结果
                  </span>
                  <button
                    onClick={() => setShowResults(false)}
                    className="text-xs text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
                  >
                    关闭
                  </button>
                </div>
                <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
                  {categoryFilters.map(f => (
                    <button
                      key={f.key}
                      onClick={() => setActiveCategory(f.key)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${activeCategory === f.key
                        ? 'bg-brand-500 text-white'
                        : 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                        }`}
                    >
                      {f.label} {f.count}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-y-auto flex-1 p-2">
                {filteredResults.map((category) => (
                  <div key={category.category} className="mb-3 last:mb-0">
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <span className={`${CATEGORY_CONFIG[category.category]?.color || 'text-surface-500'}`}>
                        {CATEGORY_ICONS[category.category]}
                      </span>
                      <span className="text-xs font-medium text-surface-500 dark:text-surface-400">
                        {CATEGORY_CONFIG[category.category]?.label || category.label}
                      </span>
                      <span className="text-xs text-surface-300 dark:text-surface-600">
                        {category.total}条
                      </span>
                    </div>

                    <div className="space-y-0.5">
                      {category.items.map((item) => (
                        <button
                          key={`${item.type}-${item.id}`}
                          onClick={() => handleItemClick(item)}
                          className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800/60 transition-colors group"
                        >
                          <div className="flex items-start gap-2.5">
                            <span className={`mt-0.5 flex-shrink-0 ${CATEGORY_CONFIG[category.category]?.color || 'text-surface-500'}`}>
                              {CATEGORY_ICONS[category.category]}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-surface-700 dark:text-surface-200 truncate group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                                  <HighlightText text={item.title} keyword={debouncedQuery} />
                                </span>
                                {item.type === 'diary' && item.extra?.emotionScore !== undefined && (
                                  <span className={`text-xs px-1.5 py-0.5 rounded-md ${(item.extra.emotionScore as number) >= 60
                                    ? 'bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400'
                                    : (item.extra.emotionScore as number) >= 40
                                      ? 'bg-yellow-50 text-yellow-600 dark:bg-yellow-950/30 dark:text-yellow-400'
                                      : 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
                                    }`}>
                                    {item.extra.emotionScore as number}分
                                  </span>
                                )}
                                {item.type === 'goal' && item.extra?.status != null && (
                                  <span className={`text-xs px-1.5 py-0.5 rounded-md ${item.extra.status === 'ACTIVE'
                                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400'
                                    : item.extra.status === 'COMPLETED'
                                      ? 'bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400'
                                      : 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400'
                                    }`}>
                                    {item.extra.status === 'ACTIVE' ? '进行中' : item.extra.status === 'COMPLETED' ? '已完成' : '已归档'}
                                  </span>
                                )}
                                {item.type === 'habit' && item.extra?.streakCurrent !== undefined && (item.extra.streakCurrent as number) > 0 && (
                                  <span className="text-xs text-orange-500">🔥{(item.extra.streakCurrent as number)}天</span>
                                )}
                              </div>
                              <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5 line-clamp-2 leading-relaxed">
                                <HighlightText text={item.highlight} keyword={debouncedQuery} />
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-2xs text-surface-300 dark:text-surface-600">
                                  {formatDate(item.date)}
                                </span>
                                {item.type === 'event' && item.extra?.time != null && (
                                  <span className="text-2xs text-blue-400 dark:text-blue-500">
                                    {item.extra.time as string}
                                  </span>
                                )}
                                {item.type === 'event' && item.extra?.courseLocation != null && (
                                  <span className="text-2xs text-surface-300 dark:text-surface-600">
                                    📍{item.extra.courseLocation as string}
                                  </span>
                                )}
                                {item.type === 'attachment' && item.extra?.fileType != null && (
                                  <span className="text-2xs text-purple-400 dark:text-purple-500">
                                    {item.extra.fileType === 'image' ? '图片' : item.extra.fileType === 'video' ? '视频' : item.extra.fileType === 'audio' ? '音频' : '文档'}
                                  </span>
                                )}
                                {item.type === 'chat' && item.extra?.role != null && (
                                  <span className={`text-2xs ${(item.extra.role as string) === 'user' ? 'text-blue-400' : 'text-emerald-400'}`}>
                                    {(item.extra.role as string) === 'user' ? '我' : 'AI'}
                                  </span>
                                )}
                              </div>
                            </div>
                            <svg className="w-4 h-4 text-surface-300 dark:text-surface-600 flex-shrink-0 mt-1 group-hover:text-brand-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default GlobalSearch;
