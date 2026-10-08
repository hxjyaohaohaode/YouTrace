import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, BarChart3, TrendingUp, Target, Bell, X, ArrowRight, ArrowUpRight } from 'lucide-react';
import { useCoachStore, type CoachPushRecord, type DailyBrief } from '../../stores/coachStore';
import { useNavigate } from 'react-router-dom';
import { Card } from '../ui/Card';
import { resolveActionPath, resolvePushPath } from '../../utils/actionPaths';
import { toast } from '../../services/toastBus';
import { BUSINESS_TIME_ZONE, formatBusinessDate } from '../../utils/date';

interface BriefCardProps {
  data: DailyBrief;
}

function describeSpentDiff(diff: string | null): string {
  if (!diff) return '';
  if (diff.startsWith('-')) return `较近几日日均低 ${diff.slice(1)}`;
  return `较近几日日均高 ${diff}`;
}

function formatSnapshotTime(timestamp: number | undefined): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return '生成时间未知';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(timestamp);
}

export function BriefCard({ data }: BriefCardProps) {
  const navigate = useNavigate();
  const diffText = describeSpentDiff(data.yesterdayReview.spentDiff);
  const habitDone = data.yesterdayReview.habits?.done;
  const hasHabitCount = (data.source === 'server' || data.source === 'local')
    && Number.isSafeInteger(habitDone) && habitDone >= 0;
  const snapshot = data.weeklyInsights[0];
  const snapshotTitle = snapshot?.title === '今日教练简报'
    ? `记录简报${snapshot.createdAt && Number.isFinite(snapshot.createdAt) ? ` · ${formatBusinessDate(new Date(snapshot.createdAt))}` : ''}`
    : snapshot?.title;

  const insightActions = data.weeklyInsights
    .filter((i) => Boolean(i.actionSuggested))
    .slice(0, 3)
    .map((i) => ({ text: i.actionSuggested as string, path: resolveActionPath(i.dataSources ?? [], i.actionSuggested) }));

  const actions: Array<{ text: string; path: string }> =
    insightActions.length > 0
      ? insightActions
      : data.todayActions.map((text) => ({
          text,
          path:
            data.weeklyInsights.find((i) => i.actionSuggested === text)?.dataSources
              ? resolveActionPath(data.weeklyInsights.find((i) => i.actionSuggested === text)!.dataSources ?? [], text)
              : '/coach',
        }));

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-[var(--text-1)] sm:p-6"
      >

        <div className="relative z-10">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--primary-soft)]">
              <TrendingUp size={18} className="text-[var(--text-1)]" aria-hidden />
            </div>
            <span className="text-sm font-bold">记录简报</span>
          </div>
          <p className="mb-4 text-xs leading-relaxed text-[var(--text-2)]">
            {data.source ? `${data.source === 'server' ? '云端已同步记录' : '本机记录'} · 读取于 ${formatSnapshotTime(data.generatedAt)}（北京时间）` : '正在读取记录…'}
          </p>

          <div className="mb-5 space-y-4">
            <div className="flex items-start gap-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-4">
              <BarChart3 size={18} className="mt-0.5 shrink-0 text-[var(--text-2)]" aria-hidden />
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--text-2)]">{data.reviewDate ? `${data.reviewDate} 记录回顾` : '昨日复盘'}</p>
                <p className="text-sm leading-relaxed">
                  已记录支出 ¥{data.yesterdayReview.spent.toFixed(2)}
                  {data.yesterdayReview.expenseCount !== undefined && `，共${data.yesterdayReview.expenseCount}笔`}
                  {diffText && `（${diffText}）`}
                  {hasHabitCount ? ` · 该日记为已打卡的习惯 ${habitDone} 项` : ' · 该日习惯打卡记录待确认'}
                  {data.yesterdayReview.moodScore !== null && ` · 心情 ${data.yesterdayReview.moodScore}/10`}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--text-2)]">按读取时保留的习惯及该日打卡记录统计</p>
              </div>
            </div>

            {data.weeklyInsights.length > 0 && (
              <div className="flex items-start gap-3">
                <Target size={18} className="mt-0.5 shrink-0 text-[var(--text-2)]" aria-hidden />
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--text-2)]">洞察快照</p>
                  <p className="text-sm font-semibold">{snapshotTitle}</p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-2)]">{data.weeklyInsights[0].description}</p>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--text-2)]">生成于 {formatSnapshotTime(data.weeklyInsights[0].createdAt)}（北京时间）；后续记录变动可能尚未计入</p>
                </div>
              </div>
            )}

            {data.todayActions.length > 0 && (
              <div className="flex items-start gap-3">
                <TrendingUp size={18} className="mt-0.5 shrink-0 text-[var(--text-2)]" aria-hidden />
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--text-2)]">可选行动</p>
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
                          className="group flex w-full items-center gap-3 rounded-[var(--radius-sm)] text-left text-sm transition-colors hover:bg-[var(--surface-2)]"
                          aria-label={`去处理：${action.text}`}
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-xs font-bold">
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
              className="flex items-center gap-2 rounded-full bg-[var(--primary-soft)] px-6 py-3 text-sm font-semibold text-[var(--text-1)] transition-all hover:bg-[var(--surface-hover)]"
            >
              <MessageCircle size={16} aria-hidden />
              和教练聊聊
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate('/insights')}
              className="flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-6 py-3 text-sm font-medium text-[var(--text-2)] transition-all hover:bg-[var(--primary-soft)]"
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

export function PushList() {
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
  daily_brief: { border: 'border-l-[var(--link)]', iconBg: 'bg-[var(--link)]/10', iconColor: 'text-[var(--link)]' },
  anomaly: { border: 'border-l-[var(--danger)]', iconBg: 'bg-[var(--danger)]/10', iconColor: 'text-[var(--danger)]' },
  follow_up: { border: 'border-l-[var(--link)]', iconBg: 'bg-[var(--link)]/10', iconColor: 'text-[var(--link)]' },
  positive: { border: 'border-l-[var(--success)]', iconBg: 'bg-[var(--success)]/10', iconColor: 'text-[var(--success)]' },
  evening_review: { border: 'border-l-[var(--warning)]', iconBg: 'bg-[var(--warning)]/10', iconColor: 'text-[var(--warning)]' },
};

function PushCard({ push, onRead, onAct, onDismiss }: { push: CoachPushRecord; onRead: (id: string) => Promise<void>; onAct: (id: string) => Promise<void>; onDismiss: (id: string) => Promise<void> }) {
  const navigate = useNavigate();
  const config = pushTypeConfig[push.type] ?? pushTypeConfig.daily_brief;

  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const perform = async (operation: () => Promise<void>) => {
    if (pendingRef.current) return;
    pendingRef.current = true; setPending(true);
    try { await operation(); }
    catch { toast.error('反馈未保存，请稍后重试'); }
    finally { pendingRef.current = false; setPending(false); }
  };
  const handleOpen = () => {
    void perform(() => onRead(push.id));
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
            disabled={pending}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-transform hover:scale-105 ${config.iconBg}`}
            aria-label={`查看推送详情：${push.title}`}
          >
            <Bell size={18} className={config.iconColor} aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <button type="button" onClick={handleOpen}
            disabled={pending} className="block w-full text-left">
              <p className="break-words text-base font-bold text-[var(--text-1)] group-hover:text-[var(--link)]">{push.title}</p>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--text-2)]">{push.body}</p>
            </button>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {push.actions.map((action) => (
                <motion.button
                  key={`${action.type}-${action.label}`}
                  whileTap={{ scale: 0.95 }}
                  type="button"
                  disabled={pending}
                  aria-busy={pending}
                  onClick={() => void perform(async () => {
                    if (action.type === 'chat') {
                      navigate(push.type === 'evening_review' ? '/quick-note' : action.label === '查看花销' ? '/expense' : '/coach');
                      await onAct(push.id);
                    } else if (action.type === 'confirm') {
                      await onAct(push.id);
                      toast.success('已记录反馈');
                    } else if (action.type === 'dismiss') {
                      await onDismiss(push.id);
                    } else {
                      await onRead(push.id);
                      toast.info('已收起这条提醒');
                    }
                  })}
                  className={`rounded-[var(--radius-sm)] px-3.5 py-2 text-xs font-semibold transition-all ${
                    action.type === 'chat'
                      ? 'bg-[var(--primary-soft)] text-[var(--link)] hover:bg-[var(--primary)]/12'
                      : action.type === 'confirm'
                      ? 'bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--border)]'
                      : 'text-[var(--text-3)] hover:text-[var(--text-2)]'
                  }`}
                >
                  {action.type === 'snooze' ? '暂时收起' : action.label}
                </motion.button>
              ))}
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            disabled={pending}
            onClick={() => void perform(() => onDismiss(push.id))}
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
