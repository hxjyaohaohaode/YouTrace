import { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, TrendingUp, AlertTriangle, Link2, ThumbsUp, Lightbulb, Check, X, MessageCircle, ArrowUpRight, PenLine } from 'lucide-react';
import { useCoachStore, type InsightType, type CoachInsightRecord } from '../stores/coachStore';
import { useNavigate } from 'react-router-dom';
import { toast } from '../services/toastBus';
import { resolveActionPath, dataSourceLabels } from '../utils/actionPaths';
import { BUSINESS_TIME_ZONE, formatBusinessDate } from '../utils/date';

const typeConfig: Record<InsightType, { icon: typeof TrendingUp; label: string; color: string; bg: string }> = {
  pattern: { icon: TrendingUp, label: '模式发现', color: '#5B5FC7', bg: 'bg-[#5B5FC7]/8' },
  anomaly: { icon: AlertTriangle, label: '异常预警', color: '#D94052', bg: 'bg-[#D94052]/8' },
  correlation: { icon: Link2, label: '跨域关联', color: '#7C5CFC', bg: 'bg-[#7C5CFC]/8' },
  positive: { icon: ThumbsUp, label: '正向反馈', color: '#2EA06B', bg: 'bg-[#2EA06B]/8' },
  suggestion: { icon: Lightbulb, label: '行动建议', color: '#D99A2B', bg: 'bg-[#D99A2B]/8' },
};

const filterOptions: Array<{ key: InsightType | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pattern', label: '模式' },
  { key: 'anomaly', label: '异常' },
  { key: 'correlation', label: '关联' },
  { key: 'positive', label: '正向' },
  { key: 'suggestion', label: '建议' },
];

const MAX_RENDERED = 30;

export default function CoachInsights() {
  const navigate = useNavigate();
  const insights = useCoachStore((s) => s.insights);
  const dismissInsight = useCoachStore((s) => s.dismissInsight);
  const actOnInsight = useCoachStore((s) => s.actOnInsight);
  const [filter, setFilter] = useState<InsightType | 'all'>('all');
  const [showDismissed, setShowDismissed] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const changeFeedback = async (id: string, change: () => Promise<void>) => {
    if (pendingRef.current.has(id)) return;
    pendingRef.current.add(id); setPending(new Set(pendingRef.current));
    try { await change(); }
    catch { toast.error('反馈未保存，请稍后重试'); }
    finally { pendingRef.current.delete(id); setPending(new Set(pendingRef.current)); }
  };

  const filteredInsights = useMemo(() => {
    return insights
      .filter((i) => filter === 'all' || i.type === filter)
      .filter((i) => showDismissed || !i.dismissed)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [insights, filter, showDismissed]);

  const activeCount = insights.filter((i) => !i.dismissed).length;
  const hiddenCount = Math.max(filteredInsights.length - MAX_RENDERED, 0);

  const handleAct = (insight: CoachInsightRecord) => changeFeedback(insight.id, async () => {
    await actOnInsight(insight.id);
    toast.success('已记录采纳意向；相关任务仍需单独完成');
  });
  const handleDismiss = (id: string) => changeFeedback(id, () => dismissInsight(id));

  return (
    <div className="w-full">
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="mb-6 flex items-center justify-between"
      >
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text-1)]">教练洞察</h1>
          <p className="mt-1 text-xs font-medium text-[var(--text-3)]">{activeCount} 条活跃洞察</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/coach')}
          className="flex items-center gap-1.5 rounded-full bg-[var(--primary-soft)] px-4 py-2.5 text-xs font-semibold text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/12"
        >
          <MessageCircle size={14} aria-hidden />
          和教练聊
        </button>
      </motion.div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-2 scrollbar-hide" role="tablist" aria-label="洞察类型筛选">
        {filterOptions.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setFilter(opt.key)}
            role="tab"
            aria-selected={filter === opt.key}
            className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition-all duration-200 ${
              filter === opt.key
                ? 'bg-[var(--primary-soft)] text-[var(--primary)] shadow-[var(--shadow-xs)]'
                : 'bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--border)]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-3)]">{filteredInsights.length} 条结果</span>
        <button
          type="button"
          onClick={() => setShowDismissed(!showDismissed)}
          aria-pressed={showDismissed}
          className="rounded-full px-2 py-1 text-xs font-semibold text-[var(--primary)] hover:bg-[var(--primary-soft)]"
        >
          {showDismissed ? '隐藏已忽略' : '显示已忽略'}
        </button>
      </div>

      {filteredInsights.length === 0 ? (
        <div className="py-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--surface-2)]">
            <Sparkles size={28} className="text-[var(--text-3)]" aria-hidden />
          </div>
          <p className="text-sm font-medium text-[var(--text-3)]">
            {insights.length === 0
              ? isLoggedInHint()
              : filter === 'all'
                ? '没有符合条件的洞察'
                : '该类型暂无洞察'}
          </p>
          {insights.length === 0 && (
            <div className="mt-5 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => navigate('/quick-note')}
                className="flex items-center gap-1.5 rounded-full bg-[var(--primary)] px-5 py-2.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                <PenLine size={14} aria-hidden />
                去速记一条
              </button>
              <button
                type="button"
                onClick={() => navigate('/coach')}
                className="flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-5 py-2.5 text-xs font-semibold text-[var(--text-2)] hover:bg-[var(--border)]"
              >
                <MessageCircle size={14} aria-hidden />
                问教练
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filteredInsights.slice(0, MAX_RENDERED).map((insight) => {
                const config = typeConfig[insight.type];
                const Icon = config.icon;
                const actionPath = insight.actionSuggested && !insight.actionTaken && !insight.dismissed
                  ? resolveActionPath(insight.dataSources)
                  : null;

                return (
                  <motion.article
                    key={insight.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className={`overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-light)] bg-[var(--surface)] ${
                      insight.dismissed ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="p-5">
                      <div className="flex items-start gap-3">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] ${config.bg}`}>
                          <Icon size={18} style={{ color: config.color }} aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1.5 flex flex-wrap items-center gap-2">
                            <span
                              className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                              style={{ backgroundColor: config.color }}
                            >
                              {config.label}
                            </span>
                          </div>
                          <h3 className="text-[13px] font-bold text-[var(--text-1)]">{insight.title === '今日教练简报' ? `记录简报 · ${formatBusinessDate(new Date(insight.createdAt))}` : insight.title}</h3>
                          <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-2)]">{insight.description}</p>
                          <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-3)]">快照生成于 {new Intl.DateTimeFormat('zh-CN', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(insight.createdAt)}（北京时间），后续记录可能未计入</p>

                          {insight.actionSuggested && !insight.dismissed && !insight.actionTaken && (
                            <button
                              type="button"
                              onClick={() => navigate(actionPath ?? '/coach')}
                              className="mt-3 flex w-full items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--primary-soft)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--primary)]/12"
                              aria-label={`去完成：${insight.actionSuggested}`}
                            >
                              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--primary)]">
                                建议行动：{insight.actionSuggested}
                              </span>
                              <ArrowUpRight size={14} className="shrink-0 text-[var(--primary)]" aria-hidden />
                            </button>
                          )}

                          {insight.dataSources.length > 0 && (
                            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                              {insight.dataSources.map((ds) => (
                                <span key={ds} className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-3)]">
                                  {dataSourceLabels[ds] ?? ds}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {!insight.dismissed && (
                      <div className="flex border-t border-[var(--border-light)]">
                        {insight.actionSuggested && !insight.actionTaken ? (
                          <button
                            type="button"
                            onClick={() => void handleAct(insight)}
                            disabled={pending.has(insight.id)}
                            aria-busy={pending.has(insight.id)}
                            className="flex flex-1 items-center justify-center gap-1 py-3 text-xs font-semibold text-[var(--success)] transition-colors hover:bg-[var(--success)]/5"
                          >
                            <Check size={14} aria-hidden />
                            采纳建议
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() =>
                            navigate('/coach', {
                              state: {
                                prefill: `关于「${insight.title}」：${insight.actionSuggested ?? ''}`,
                              },
                            })
                          }
                          className="flex flex-1 items-center justify-center gap-1 py-3 text-xs font-semibold text-[var(--primary)] transition-colors hover:bg-[var(--primary-soft)]"
                        >
                          <MessageCircle size={14} aria-hidden />
                          和教练聊
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDismiss(insight.id)}
                          disabled={pending.has(insight.id)}
                          aria-busy={pending.has(insight.id)}
                          className="flex flex-1 items-center justify-center gap-1 border-l border-[var(--border-light)] py-3 text-xs font-medium text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)]"
                        >
                          <X size={14} aria-hidden />
                          忽略
                        </button>
                      </div>
                    )}

                    {insight.actionTaken && (
                      <div className="flex items-center gap-2 border-t border-[var(--success)]/20 bg-[var(--success)]/5 px-5 py-2">
                        <Check size={14} className="text-[var(--success)]" aria-hidden />
                        <span className="text-xs font-semibold text-[var(--success)]">已记录采纳意向，未代替你完成任务</span>
                      </div>
                    )}
                  </motion.article>
                );
              })}
            </AnimatePresence>
          </div>
          {hiddenCount > 0 && (
            <p className="pt-3 text-center text-xs text-[var(--text-4)]">
              已显示最近 {MAX_RENDERED} 条，其余 {hiddenCount} 条较早的洞察已折叠
            </p>
          )}
        </>
      )}
    </div>
  );
}

function isLoggedInHint(): string {
  return '还没有洞察。记录几天花销、习惯或日记，教练就会开始发现规律';
}
