import { useEffect, useState, useCallback, useRef } from 'react';
import { useDiaryStore } from '../stores/diaryStore';
import { useGoalStore } from '../stores/goalStore';
import { useHabitStore } from '../stores/habitStore';
import { diaryApi, type DiaryStats } from '../api/diary';
import { aiApi } from '../api/ai';

function EmotionLineChart({ data }: { data: { date: string; score: number }[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (data.length === 0) return null;

  const width = 600;
  const height = 240;
  const padding = { top: 20, right: 20, bottom: 35, left: 40 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const minScore = 0;
  const maxScore = 100;
  const range = maxScore - minScore || 1;

  const points = data.map((d, i) => ({
    x: padding.left + (data.length > 1 ? (i / (data.length - 1)) * chartW : chartW / 2),
    y: padding.top + chartH - ((d.score - minScore) / range) * chartH,
    score: d.score,
    date: d.date,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x},${padding.top + chartH} L${points[0].x},${padding.top + chartH} Z`;

  const labelInterval = Math.max(1, Math.floor(data.length / 8));

  const getScoreColor = (score: number) => {
    if (score >= 70) return '#22c55e';
    if (score >= 50) return '#e8941e';
    if (score >= 30) return '#f97316';
    return '#ef4444';
  };

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet"
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <defs>
          <linearGradient id="emotionAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e8941e" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#e8941e" stopOpacity="0.02" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {[0, 25, 50, 75, 100].map((val) => {
          const y = padding.top + chartH - ((val - minScore) / range) * chartH;
          return (
            <g key={val}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.08"
                strokeWidth="1"
              />
              <text
                x={padding.left - 8}
                y={y + 3}
                textAnchor="end"
                className="fill-surface-400"
                fontSize="10"
                fontFamily="system-ui"
              >
                {val}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill="url(#emotionAreaGrad)" />
        <path d={linePath} fill="none" stroke="#e8941e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" filter="url(#glow)" />

        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={hoveredIndex === i ? 5 : 3}
            fill={getScoreColor(p.score)}
            stroke="white"
            strokeWidth={hoveredIndex === i ? 2 : 1.5}
            className="cursor-pointer transition-all"
            onMouseEnter={() => setHoveredIndex(i)}
          />
        ))}

        {data.map((d, i) => {
          if (i % labelInterval !== 0 && i !== data.length - 1) return null;
          const x = points[i].x;
          return (
            <text
              key={`label-${i}`}
              x={x}
              y={height - 8}
              textAnchor="middle"
              className="fill-surface-400"
              fontSize="10"
              fontFamily="system-ui"
            >
              {d.date.slice(5)}
            </text>
          );
        })}
      </svg>

      {hoveredIndex !== null && points[hoveredIndex] && (
        <div
          className="absolute pointer-events-none bg-white dark:bg-surface-800 rounded-lg shadow-lg border border-surface-200 dark:border-surface-700 px-3 py-2 text-xs z-10"
          style={{
            left: `${(points[hoveredIndex].x / width) * 100}%`,
            top: `${(points[hoveredIndex].y / height) * 100 - 10}%`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <p className="font-medium text-surface-700 dark:text-surface-200">{points[hoveredIndex].date}</p>
          <p className="text-brand-600 dark:text-brand-400">情绪指数: {points[hoveredIndex].score}</p>
        </div>
      )}
    </div>
  );
}

function WordCloud({ words }: { words: { word: string; count: number }[] }) {
  if (words.length === 0) return null;

  const maxCount = words[0]?.count || 1;
  const colors = [
    'text-brand-600 dark:text-brand-400',
    'text-emerald-600 dark:text-emerald-400',
    'text-purple-600 dark:text-purple-400',
    'text-orange-600 dark:text-orange-400',
    'text-blue-600 dark:text-blue-400',
    'text-rose-600 dark:text-rose-400',
    'text-teal-600 dark:text-teal-400',
    'text-amber-600 dark:text-amber-400',
  ];

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 py-4">
      {words.map((w, i) => {
        const size = 0.75 + (w.count / maxCount) * 1.0;
        const rotation = (i % 3 === 0) ? -3 : (i % 3 === 1) ? 0 : 3;
        return (
          <span
            key={i}
            className={`font-bold ${colors[i % colors.length]} transition-transform hover:scale-110 cursor-default`}
            style={{
              fontSize: `${size}rem`,
              transform: `rotate(${rotation}deg)`,
              opacity: 0.7 + (w.count / maxCount) * 0.3,
            }}
            title={`${w.word}: ${w.count}次`}
          >
            {w.word}
          </span>
        );
      })}
    </div>
  );
}

function StatsPage() {
  interface AnalysisRecord {
    id: string;
    analysis: string;
    createdAt: string;
  }

  const diariesRef = useRef(useDiaryStore.getState().diaries);
  useEffect(() => { diariesRef.current = useDiaryStore.getState().diaries; });
  const { goals } = useGoalStore();
  const { habits } = useHabitStore();
  const [period, setPeriod] = useState<'7' | '30' | '90'>('30');
  const [stats, setStats] = useState<DiaryStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisHistory, setAnalysisHistory] = useState<AnalysisRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const loadStats = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await diaryApi.stats(period);
      if (response.success && response.data) {
        setStats(response.data as DiaryStats);
      }
    } catch {
      const now = new Date();
      const periodDays = parseInt(period);
      const cutoff = new Date(now.getTime() - periodDays * 86400000);
      const filtered = diariesRef.current.filter((d) => new Date(d.createdAt) >= cutoff);
      const avgScore = filtered.length > 0 ? Math.round(filtered.reduce((s, d) => s + d.emotionScore, 0) / filtered.length) : 0;

      const trendMap = new Map<string, { total: number; count: number }>();
      for (const d of filtered) {
        const dateKey = new Date(d.createdAt).toISOString().slice(0, 10);
        const entry = trendMap.get(dateKey) || { total: 0, count: 0 };
        entry.total += d.emotionScore;
        entry.count += 1;
        trendMap.set(dateKey, entry);
      }
      const emotionTrend = Array.from(trendMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, { total, count }]) => ({ date, score: Math.round(total / count) }));

      const tagCounts: Record<string, number> = {};
      for (const d of filtered) {
        for (const t of d.emotionTags) {
          tagCounts[t] = (tagCounts[t] || 0) + 1;
        }
      }
      const topEmotions = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([tag, count]) => ({ tag, count }));

      setStats({
        totalDiaries: filtered.length,
        averageScore: avgScore,
        streak: 0,
        thisMonthCount: filtered.filter((d) => new Date(d.createdAt).getMonth() === now.getMonth()).length,
        emotionTrend,
        topEmotions,
        wordCloud: [],
      });
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    const saved = localStorage.getItem('ai_analysis_history');
    if (saved) {
      try {
        setAnalysisHistory(JSON.parse(saved));
      } catch {
        // ignore
      }
    }
  }, []);

  const handleAIAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const response = await aiApi.comprehensiveAnalysis();
      if (response.success && response.data) {
        const analysisText = response.data.analysis;
        setAiAnalysis(analysisText);
        const newRecord: AnalysisRecord = {
          id: Date.now().toString(),
          analysis: analysisText,
          createdAt: new Date().toISOString(),
        };
        const updatedHistory = [newRecord, ...analysisHistory].slice(0, 20);
        setAnalysisHistory(updatedHistory);
        localStorage.setItem('ai_analysis_history', JSON.stringify(updatedHistory));
      } else {
        setAnalysisError(response.message || '分析失败');
      }
    } catch {
      setAnalysisError('AI分析请求失败，请稍后再试');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const activeGoals = goals.filter((g) => g.status === 'ACTIVE');
  const habitCompletionRate = habits.length > 0
    ? Math.round((habits.filter((h) => h.todayCompleted).length / habits.length) * 100)
    : 0;

  if (isLoading && !stats) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="page-container">
      <header className="page-header">
        <div className="md:max-w-3xl lg:max-w-4xl mx-auto px-4 sm:px-8 lg:px-12 py-3 sm:py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-surface-800 dark:text-surface-100">数据分析</h1>
            <p className="text-xs text-surface-400 mt-0.5">全面了解你的生活状态</p>
          </div>
          <button onClick={() => loadStats()} className="text-xs text-brand-500 hover:text-brand-600 font-medium px-2.5 py-1 rounded-lg hover:bg-brand-50 transition-colors">
            刷新
          </button>
        </div>
      </header>

      <main className="md:max-w-3xl lg:max-w-4xl mx-auto px-4 sm:px-8 lg:px-12 py-3 sm:py-4">
        <div className="flex gap-2 mb-6">
          {(['7', '30', '90'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`chip px-4 py-1.5 text-sm ${period === p ? 'chip-active' : 'chip-inactive'}`}
            >
              {p === '7' ? '近7天' : p === '30' ? '近30天' : '近90天'}
            </button>
          ))}
        </div>

        {stats && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="card card-responsive">
                <div className="w-9 h-9 rounded-xl gradient-bg flex items-center justify-center mb-3">
                  <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </div>
                <p className="text-2xl font-bold text-surface-800">{stats.totalDiaries}</p>
                <p className="text-xs text-surface-400 mt-0.5">日记数量</p>
              </div>

              <div className="card card-responsive">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center mb-3">
                  <svg className="w-4.5 h-4.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <p className="text-2xl font-bold text-surface-800">{stats.averageScore}</p>
                <p className="text-xs text-surface-400 mt-0.5">平均情绪指数</p>
              </div>

              <div className="card card-responsive">
                <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center mb-3">
                  <svg className="w-4.5 h-4.5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" /></svg>
                </div>
                <p className="text-2xl font-bold text-surface-800">{stats.streak}</p>
                <p className="text-xs text-surface-400 mt-0.5">连续记录天数</p>
              </div>

              <div className="card card-responsive">
                <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center mb-3">
                  <svg className="w-4.5 h-4.5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                </div>
                <p className="text-2xl font-bold text-surface-800">{stats.thisMonthCount}</p>
                <p className="text-xs text-surface-400 mt-0.5">本月日记数量</p>
              </div>
            </div>

            {(activeGoals.length > 0 || habits.length > 0) && (
              <div className="grid grid-cols-2 gap-3 mb-6">
                {activeGoals.length > 0 && (
                  <div className="card card-responsive">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 rounded-lg bg-brand-100 flex items-center justify-center">
                        <svg className="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-surface-800">{activeGoals.length}</p>
                        <p className="text-2xs text-surface-400">活跃目标</p>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {activeGoals.slice(0, 3).map((g) => (
                        <div key={g.id} className="flex items-center gap-2">
                          <span className="text-xs text-surface-600 truncate flex-1">{g.title}</span>
                          <div className="w-12 h-1.5 bg-surface-100 rounded-full overflow-hidden">
                            <div className="h-full bg-brand-500 rounded-full" style={{ width: `${Math.min(g.progress, 100)}%` }} />
                          </div>
                          <span className="text-2xs text-surface-400 w-7 text-right">{g.progress}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {habits.length > 0 && (
                  <div className="card card-responsive">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-surface-800">{habitCompletionRate}%</p>
                        <p className="text-2xs text-surface-400">习惯完成率</p>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {habits.slice(0, 3).map((h) => (
                        <div key={h.id} className="flex items-center gap-2">
                          <span className="text-xs text-surface-600 truncate flex-1">{h.title}</span>
                          {h.streakCurrent > 0 ? (
                            <span className="text-2xs text-orange-500">🔥{h.streakCurrent}天</span>
                          ) : (
                            <span className="text-2xs text-surface-300">未开始</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {stats.emotionTrend.length > 0 && (
              <div className="card card-responsive mb-4 sm:mb-6">
                <h3 className="text-sm font-semibold text-surface-700 mb-3 sm:mb-4">情绪走势</h3>
                <EmotionLineChart data={stats.emotionTrend} />
                <div className="flex items-center justify-between mt-2 text-2xs text-surface-400 px-2">
                  <span>😔 低落</span>
                  <span>😐 平静</span>
                  <span>😊 愉悦</span>
                </div>
              </div>
            )}

            {stats.topEmotions.length > 0 && (
              <div className="card card-responsive mb-4 sm:mb-6">
                <h3 className="text-sm font-semibold text-surface-700 mb-4">情绪分布</h3>
                <WordCloud words={stats.topEmotions.map((e) => ({ word: e.tag, count: e.count }))} />
              </div>
            )}

            {stats.wordCloud.length > 0 && (
              <div className="card card-responsive mb-4 sm:mb-6">
                <h3 className="text-sm font-semibold text-surface-700 mb-4">高频词汇</h3>
                <WordCloud words={stats.wordCloud} />
              </div>
            )}

            <div className="card card-responsive mb-4 sm:mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-surface-700 flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  AI 深度分析
                </h3>
                <div className="flex items-center gap-2">
                  {analysisHistory.length > 0 && (
                    <button
                      onClick={() => setShowHistory(!showHistory)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${showHistory ? 'bg-brand-50 text-brand-600 dark:bg-brand-950/30 dark:text-brand-400' : 'text-surface-400 hover:text-surface-600 hover:bg-surface-50'}`}
                    >
                      历史记录 ({analysisHistory.length})
                    </button>
                  )}
                  {!aiAnalysis && !isAnalyzing && (
                    <button
                      onClick={handleAIAnalysis}
                      className="btn-primary px-4 py-1.5 text-xs"
                    >
                      开始分析
                    </button>
                  )}
                </div>
              </div>

              {showHistory && analysisHistory.length > 0 && (
                <div className="mb-4 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden">
                  <div className="bg-surface-50 dark:bg-surface-800 px-3 py-2 border-b border-surface-200 dark:border-surface-700">
                    <span className="text-xs font-medium text-surface-500">历史分析记录</span>
                  </div>
                  <div className="max-h-60 overflow-y-auto divide-y divide-surface-100 dark:divide-surface-800">
                    {analysisHistory.map((record) => (
                      <div
                        key={record.id}
                        onClick={() => {
                          setAiAnalysis(record.analysis);
                          setShowHistory(false);
                        }}
                        className="px-3 py-2.5 cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800/60 transition-colors"
                      >
                        <p className="text-xs text-surface-400 mb-1">
                          {new Date(record.createdAt).toLocaleString('zh-CN')}
                        </p>
                        <p className="text-xs text-surface-600 dark:text-surface-300 line-clamp-2">
                          {record.analysis.replace(/\*\*/g, '').slice(0, 100)}...
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isAnalyzing && (
                <div className="flex items-center gap-3 py-6 justify-center">
                  <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-surface-500">AI 正在分析你的数据...</span>
                </div>
              )}

              {analysisError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 rounded-xl text-sm text-red-600 dark:text-red-400 mb-3">
                  {analysisError}
                  <button onClick={handleAIAnalysis} className="ml-2 underline">重试</button>
                </div>
              )}

              {aiAnalysis && !isAnalyzing && (
                <div>
                  <div className="prose prose-sm max-w-none text-surface-700">
                    {aiAnalysis.split('\n').map((line, i) => {
                      const trimmed = line.trim();
                      if (!trimmed) return <div key={i} className="h-2" />;
                      if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
                        return <h4 key={i} className="text-sm font-semibold text-surface-800 mt-3 mb-1">{trimmed.replace(/\*\*/g, '')}</h4>;
                      }
                      if (trimmed.startsWith('**')) {
                        const parts = trimmed.split('**');
                        return (
                          <p key={i} className="text-sm leading-relaxed mb-1">
                            {parts.map((part, j) => j % 2 === 1 ? <strong key={j} className="text-surface-800">{part}</strong> : part)}
                          </p>
                        );
                      }
                      if (/^\d+\./.test(trimmed)) {
                        return <p key={i} className="text-sm leading-relaxed ml-3 mb-0.5">{trimmed}</p>;
                      }
                      return <p key={i} className="text-sm leading-relaxed mb-1">{trimmed}</p>;
                    })}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={handleAIAnalysis}
                      className="text-xs text-brand-500 hover:text-brand-600 font-medium px-3 py-1.5 rounded-lg hover:bg-brand-50 transition-colors"
                    >
                      重新分析
                    </button>
                  </div>
                </div>
              )}

              {!aiAnalysis && !isAnalyzing && !analysisError && (
                <div className="text-center py-6">
                  <p className="text-sm text-surface-400">点击"开始分析"，AI 将基于你的日记、目标、习惯等数据</p>
                  <p className="text-sm text-surface-400">从情绪健康、生活节奏、目标进展等6个维度进行深度分析</p>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default StatsPage;
