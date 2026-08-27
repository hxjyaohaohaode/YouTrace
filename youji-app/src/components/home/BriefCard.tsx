import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, BarChart3, TrendingUp, Target, Bell, X, ArrowRight, ArrowUpRight } from 'lucide-react';
import { useCoachStore, type CoachPushRecord, type DailyBrief } from '../../stores/coachStore';
import { useNavigate } from 'react-router-dom';
import { Card } from '../ui/Card';
import { resolveActionPath, resolvePushPath } from '../../utils/actionPaths';
import { toast } from '../../services/toastBus';

interface BriefCardProps {
  data: DailyBrief;
}

function describeSpentDiff(diff: string | null): string {
  if (!diff) return '';
  if (diff.startsWith('-')) return `较近几日日均低 ${diff.slice(1)}`;
  return `较近几日日均高 ${diff}`;
}

export function BriefCard({ data }: BriefCardProps) {
  const navigate = useNavigate();
  const diffText = describeSpentDiff(data.yesterdayReview.spentDiff);

  const insightActions = data.weeklyInsights
    .filter((i) => Boolean(i.actionSuggested))
    .slice(0, 3)
    .map((i) => ({ text: i.actionSuggested as string, path: resolveActionPath(i.dataSources ?? []) }));

  const actions: Array<{ text: string; path: string }> =
    insightActions.length > 0
      ? insightActions
      : data.todayActions.map((text) => ({
          text,
          path:
            data.weeklyInsights.find((i) => i.actionSuggested === text)?.dataSources
              ? resolveActionPath(data.weeklyInsights.find((i) => i.actionSuggested === text)!.dataSources ?? [])
              : '/coach',
        }));

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        className="relative overflow-hidden rounded-[var(--radius-xl)] bg-gradient-to-br from-[var(--primary)] via-[var(--primary-light)] to-[#B06AFF] p-5 text-white shadow-[var(--shadow-glow)] sm:p-8"
      >
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/8 blur-3xl" aria-hidden />
        <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-white/5 blur-3xl" aria-hidden />

        <div className="relative z-10">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-white/15 backdrop-blur-sm">
              <TrendingUp size={18} className="text-white" aria-hidden />
            </div>
            <span className="text-sm font-bold">今日教练简报</span>
          </div>

          <div className="mb-5 space-y-4">
            <div className="flex items-start gap-3 rounded-[var(--radius-md)] bg-white/12 p-4 backdrop-blur-sm">
              <BarChart3 size={18} className="mt-0.5 shrink-0 text-white/90" aria-hidden />
              <div>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-white/70">昨日复盘</p>
                <p className="text-sm leading-relaxed">
                  花了 ¥{data.yesterdayReview.spent}
                  {diffText && `（${diffText}）`}· 习惯完成 {data.yesterdayReview.habits.done}/{data.yesterdayReview.habits.total}
                  {data.yesterdayReview.moodScore !== null && ` · 心情 ${data.yesterdayReview.moodScore}/10`}
                </p>
              </div>
            </div>

            {data.weeklyInsights.length > 0 && (
              <div className="flex items-start gap-3">
                <Target size={18} className="mt-0.5 shrink-0 text-white/80" aria-hidden />
                <div>
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-white/70">本周发现</p>
                  <p className="text-sm font-semibold">{data.weeklyInsights[0].title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/70">{data.weeklyInsights[0].description.slice(0, 60)}...</p>
                </div>
              </div>
            )}

            {data.todayActions.length > 0 && (
              <div className="flex items-start gap-3">
                <TrendingUp size={18} className="mt-0.5 shrink-0 text-white/80" aria-hidden />
                <div>
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-white/70">今日行动</p>
                  <ul className="mt-2 space-y-2">
                    {actions.map((action, i) => (
                      <motion.li
                        key={`${i}-${action.text}`}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.3 + i * 0.1 }}
                      >
                        <button
                          type="button"
                          onClick={() => navigate(action.path)}
                          className="group flex w-full items-center gap-3 rounded-[var(--radius-sm)] text-left text-sm transition-colors hover:bg-white/10"
                          aria-label={`去处理：${action.text}`}
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-white/30 to-white/10 text-[10px] font-bold">
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1 break-words leading-relaxed">{action.text}</span>
                          <ArrowUpRight size={14} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-80" aria-hidden />
                        </button>
                      </motion.li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate('/coach')}
              className="flex items-center gap-2 rounded-full bg-white/20 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/30"
            >
              <MessageCircle size={16} aria-hidden />
              和教练聊聊
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate('/insights')}
              className="flex items-center gap-1 rounded-full bg-white/10 px-6 py-3 text-sm font-medium text-white/90 backdrop-blur-sm transition-all hover:bg-white/20"
            >
              查看完整分析
              <ArrowRight size={14} aria-hidden />
            </motion.button>
          </div>
        </div>
      </motion.div>

      <PushList />
    </div>
  );
}

function PushList() {
  const pushes = useCoachStore((s) => s.pushes);
  const markPushRead = useCoachStore((s) => s.markPushRead);
  const markPushActed = useCoachStore((s) => s.markPushActed);
  const dismissPush = useCoachStore((s) => s.dismissPush);
  const unreadPushes = pushes.filter((p) => !p.read && !p.acted);

  return (
    <AnimatePresence>
      {unreadPushes.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="space-y-3"
        >
          {unreadPushes.map((push) => (
            <PushCard key={push.id} push={push} onRead={markPushRead} onAct={markPushActed} onDismiss={dismissPush} />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const pushTypeConfig: Record<string, { border: string; iconBg: string; iconColor: string }> = {
  daily_brief: { border: 'border-l-[#5B5FC7]', iconBg: 'bg-[#5B5FC7]/10', iconColor: 'text-[#5B5FC7]' },
  anomaly: { border: 'border-l-[var(--danger)]', iconBg: 'bg-[var(--danger)]/10', iconColor: 'text-[var(--danger)]' },
  follow_up: { border: 'border-l-[var(--violet)]', iconBg: 'bg-[var(--violet)]/10', iconColor: 'text-[var(--violet)]' },
  positive: { border: 'border-l-[var(--success)]', iconBg: 'bg-[var(--success)]/10', iconColor: 'text-[var(--success)]' },
  evening_review: { border: 'border-l-[var(--warning)]', iconBg: 'bg-[var(--warning)]/10', iconColor: 'text-[var(--warning)]' },
};

function PushCard({ push, onRead, onAct, onDismiss }: { push: CoachPushRecord; onRead: (id: string) => void; onAct: (id: string) => void; onDismiss: (id: string) => void }) {
  const navigate = useNavigate();
  const config = pushTypeConfig[push.type] ?? pushTypeConfig.daily_brief;

  const handleOpen = () => {
    void onRead(push.id);
    navigate(resolvePushPath(push.type));
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={`relative overflow-hidden ${config.border}`}
    >
      <Card variant="glass" className={`p-5 ${config.border}`}>
        <div className="flex items-start gap-4">
          <button
            type="button"
            onClick={handleOpen}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-transform hover:scale-105 ${config.iconBg}`}
            aria-label={`查看推送详情：${push.title}`}
          >
            <Bell size={18} className={config.iconColor} aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <button type="button" onClick={handleOpen} className="block w-full text-left">
              <p className="truncate text-[13px] font-bold text-[var(--text-1)] group-hover:text-[var(--primary)]">{push.title}</p>
              <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[var(--text-2)]">{push.body}</p>
            </button>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {push.actions.map((action) => (
                <motion.button
                  key={`${action.type}-${action.label}`}
                  whileTap={{ scale: 0.95 }}
                  type="button"
                  onClick={() => {
                    if (action.type === 'chat') {
                      void onAct(push.id);
                      navigate(push.type === 'evening_review' ? '/quick-note' : '/coach');
                    } else if (action.type === 'confirm') {
                      void onAct(push.id);
                      toast.success('已完成');
                    } else if (action.type === 'dismiss') {
                      void onDismiss(push.id);
                    } else {
                      void onRead(push.id);
                    }
                  }}
                  className={`rounded-[var(--radius-sm)] px-3.5 py-2 text-xs font-semibold transition-all ${
                    action.type === 'chat'
                      ? 'bg-[var(--primary-soft)] text-[var(--primary)] hover:bg-[var(--primary)]/12'
                      : action.type === 'confirm'
                      ? 'bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--border)]'
                      : 'text-[var(--text-3)] hover:text-[var(--text-2)]'
                  }`}
                >
                  {action.label}
                </motion.button>
              ))}
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => onDismiss(push.id)}
            aria-label={`关闭推送：${push.title}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] transition-all hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)]"
          >
            <X size={14} aria-hidden />
          </motion.button>
        </div>
      </Card>
    </motion.div>
  );
}
