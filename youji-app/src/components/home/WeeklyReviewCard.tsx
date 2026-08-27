import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, ChevronRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { generateWeeklyReview, computeWeeklyStats } from '../../services/lifeIntelligence';

export function WeeklyReviewCard() {
  const navigate = useNavigate();
  const [review, setReview] = useState<string | null>(null);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof computeWeeklyStats>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [r, s] = await Promise.all([generateWeeklyReview(), computeWeeklyStats()]);
        if (!cancelled) {
          setReview(r);
          setStats(s);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!stats || stats.daysActive === 0) return null;

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => navigate('/timeline')}
      className="group w-full rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-5 text-left shadow-[var(--shadow-sm)] transition-all hover:border-[var(--primary)]/20 hover:shadow-[var(--shadow-md)]"
      aria-label="查看本周回顾和时间线"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--primary-muted)]">
            <BarChart3 size={16} className="text-[var(--primary)]" aria-hidden />
          </div>
          <h3 className="text-[13px] font-bold text-[var(--text-1)]">本周回顾</h3>
        </div>
        <ChevronRight size={16} className="text-[var(--text-4)] transition-transform group-hover:translate-x-0.5" aria-hidden />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-4)]">消费</p>
          <p className="font-mono text-base font-bold tabular-nums text-[var(--text-1)]">
            ¥{((stats?.expenseTotalFen ?? 0) / 100).toFixed(0)}
          </p>
          {stats?.weekOverWeekPct !== null && stats?.weekOverWeekPct !== undefined && (
            <span className={`mt-0.5 flex items-center gap-0.5 text-[10px] font-semibold ${stats.weekOverWeekPct > 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]'}`}>
              {stats.weekOverWeekPct > 0 ? <TrendingUp size={10} aria-hidden /> : stats.weekOverWeekPct < 0 ? <TrendingDown size={10} aria-hidden /> : <Minus size={10} aria-hidden />}
              {Math.abs(stats.weekOverWeekPct)}%
            </span>
          )}
        </div>

        <div>
          <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-4)]">习惯</p>
          <p className="font-mono text-base font-bold tabular-nums text-[var(--text-1)]">{stats?.habitCompletionRate ?? 0}%</p>
        </div>

        <div>
          <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-4)]">日记</p>
          <p className="font-mono text-base font-bold tabular-nums text-[var(--text-1)]">{stats?.diaryEntryCount ?? 0} 篇</p>
        </div>

        <div>
          <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-4)]">活跃</p>
          <p className="font-mono text-base font-bold tabular-nums text-[var(--text-1)]">{stats?.daysActive ?? 0}/7 天</p>
        </div>
      </div>

      {review && (
        <details className="mt-3 border-t border-[var(--border-light)] pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--primary)]">展开完整回顾</summary>
          <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--text-2)]">{review}</pre>
        </details>
      )}
    </motion.button>
  );
}
