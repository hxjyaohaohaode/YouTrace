import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Wallet, CheckCircle, BookOpen, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useExpenseStore } from '../../stores/expenseStore';
import { useHabitStore } from '../../stores/habitStore';
import { useDiaryStore } from '../../stores/diaryStore';
import { useScheduleStore } from '../../stores/scheduleStore';
import { getBusinessMonth, getNaturalWeekDates, getToday } from '../../utils/date';

interface OverviewItem {
  icon: typeof Wallet;
  label: string;
  value: string;
  sub: string;
  color: string;
  gradient: string;
  path: string;
  cardBg: string;
}

export function OverviewCard() {
  const navigate = useNavigate();
  const expenses = useExpenseStore((s) => s.items);
  const monthBudget = useExpenseStore((s) => s.monthBudget);
  const habits = useHabitStore((s) => s.items);
  const diaries = useDiaryStore((s) => s.items);
  const schedules = useScheduleStore((s) => s.items);

  const overview = useMemo(() => {
    const month = getBusinessMonth();
    const monthTotalFen = expenses
      .filter((e) => e.date.startsWith(month) && !e.isIncome)
      .reduce((sum, e) => sum + e.amount, 0);
    const monthIncomeFen = expenses
      .filter((e) => e.date.startsWith(month) && e.isIncome)
      .reduce((sum, e) => sum + e.amount, 0);

    const habitsDone = habits.filter((h) => h.done);
    const pendingHabitNames = habits.filter((h) => !h.done).slice(0, 2).map((h) => h.name).join(' · ');

    const weekDates = new Set(getNaturalWeekDates());
    const weekDiaryCount = diaries.filter((d) => weekDates.has(d.date)).length;

    const today = getToday();
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    const todaySchedules = schedules
      .filter((s) => s.date === today || (s.repeat === 'weekly' && s.date <= today))
      .filter((s) => s.date === today || new Date(`${today}T12:00:00Z`).getUTCDay() === new Date(`${s.date}T12:00:00Z`).getUTCDay())
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    const nextSchedule = todaySchedules[0];
    let scheduleSub = '今天没有日程';
    if (nextSchedule) {
      const [h, m] = nextSchedule.startTime.split(':').map(Number);
      const startMinutes = h * 60 + m;
      const until = startMinutes - nowMinutes;
      if (until > 30) {
        scheduleSub = `下个: ${nextSchedule.startTime} ${nextSchedule.title} · ${Math.floor(until / 60) > 0 ? `${Math.floor(until / 60)}小时` : `${until % 60}分钟`}后`;
      } else if (until >= 0) {
        scheduleSub = `即将开始: ${nextSchedule.title}`;
      } else {
        scheduleSub = `进行中: ${nextSchedule.title}`;
      }
    }

    return {
      expense: {
        value: `¥${(monthTotalFen / 100).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`,
        sub: monthBudget > 0 ? `预算 ¥${(monthBudget / 100).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}` : (monthIncomeFen > 0 ? `本月收入 ¥${(monthIncomeFen / 100).toFixed(0)}` : '本月暂无记录'),
      },
      habit: {
        value: `${habitsDone.length}/${habits.length}`,
        sub: pendingHabitNames || '全部完成',
      },
      diary: {
        value: `${weekDiaryCount} 篇`,
        sub: '本周已写',
      },
      schedule: {
        value: `${todaySchedules.length} 项`,
        sub: scheduleSub,
      },
    };
  }, [expenses, monthBudget, habits, diaries, schedules]);

  const items: OverviewItem[] = [
    {
      icon: Wallet,
      label: '本月花销',
      ...overview.expense,
      color: '#E8853D',
      gradient: 'from-[#FF9A56] to-[#FF6B8A]',
      path: '/expense',
      cardBg: 'bg-gradient-to-br from-[#FF9A56]/10 to-[#FF6B8A]/10 border-[#FF9A56]/20',
    },
    {
      icon: CheckCircle,
      label: '今日习惯',
      ...overview.habit,
      color: '#2EA06B',
      gradient: 'from-[#2EA06B] to-[#3FBF7E]',
      path: '/habit',
      cardBg: 'bg-gradient-to-br from-[#2EA06B]/10 to-[#3FBF7E]/10 border-[#2EA06B]/20',
    },
    {
      icon: BookOpen,
      label: '日记',
      ...overview.diary,
      color: '#7C6FFF',
      gradient: 'from-[#7C6FFF] to-[#B06AFF]',
      path: '/diary',
      cardBg: 'bg-gradient-to-br from-[#7C6FFF]/10 to-[#B06AFF]/10 border-[#7C6FFF]/20',
    },
    {
      icon: Clock,
      label: '今日日程',
      ...overview.schedule,
      color: '#45B7D1',
      gradient: 'from-[#45B7D1] to-[#6C5CE7]',
      path: '/schedule',
      cardBg: 'bg-gradient-to-br from-[#45B7D1]/10 to-[#6C5CE7]/10 border-[#45B7D1]/20',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {items.map((ov, i) => {
        const Icon = ov.icon;
        return (
          <motion.button
            key={ov.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.04, ease: [0.16, 1, 0.3, 1] }}
            whileHover={{ y: -4, scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate(ov.path)}
            className={`group flex flex-col items-start gap-3 rounded-[var(--radius-lg)] ${ov.cardBg} border p-4 text-left transition-all duration-200 hover:shadow-[var(--shadow-md)] sm:p-5`}
          >
            <div className="flex w-full items-center justify-between">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${ov.gradient} transition-all duration-200 group-hover:scale-105 group-hover:shadow-[var(--shadow-sm)]`}
              >
                <Icon size={18} className="text-white" aria-hidden />
              </div>
            </div>
            <div className="w-full min-w-0">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-3)]">{ov.label}</p>
              <p className="truncate font-mono text-xl font-extrabold tabular-nums tracking-tight text-[var(--text-1)] sm:text-2xl">{ov.value}</p>
              <p className="mt-1 truncate text-[11px] font-medium text-[var(--text-4)]">{ov.sub}</p>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
