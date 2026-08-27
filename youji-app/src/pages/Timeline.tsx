import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Wallet, CheckSquare, BookOpen, Calendar, Tag, Activity,
} from 'lucide-react';
import { useExpenseStore } from '../stores/expenseStore';
import { useTodoStore } from '../stores/todoStore';
import { useHabitStore } from '../stores/habitStore';
import { useDiaryStore } from '../stores/diaryStore';
import { useScheduleStore } from '../stores/scheduleStore';
import { PageHeader } from '../components/layout/PageHeader';
import { formatDateLabel, getDateDaysAgo, getToday } from '../utils/date';

interface TimelineEntry {
  id: string;
  type: 'expense' | 'todo_done' | 'habit' | 'diary' | 'schedule' | 'goal_progress';
  title: string;
  detail: string;
  timestamp: number;
  date: string;
}

const typeConfig = {
  expense: { icon: Wallet, color: '#E8853D', label: '花销' },
  todo_done: { icon: CheckSquare, color: '#7C6FFF', label: '完成待办' },
  habit: { icon: Activity, color: '#2EA06B', label: '习惯' },
  diary: { icon: BookOpen, color: '#B06AFF', label: '日记' },
  schedule: { icon: Calendar, color: '#45B7D1', label: '日程' },
  goal_progress: { icon: Tag, color: '#D99A2B', label: '目标' },
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return mins + '分钟前';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + '小时前';
  return '';
}

const typeRoute: Record<TimelineEntry['type'], string> = {
  expense: '/expense',
  todo_done: '/todo',
  habit: '/habit',
  diary: '/diary',
  schedule: '/schedule',
  goal_progress: '/goal',
};

export default function Timeline() {
  const navigate = useNavigate();
  const expenses = useExpenseStore((s) => s.items);
  const todos = useTodoStore((s) => s.items);
  const habits = useHabitStore((s) => s.items);
  const diaries = useDiaryStore((s) => s.items);
  const schedules = useScheduleStore((s) => s.items);

  const entries = useMemo(() => {
    const cutoff = getDateDaysAgo(6);
    const result: TimelineEntry[] = [];

    for (const e of expenses) {
      if (e.date >= cutoff && e.date <= getToday()) {
        result.push({
          id: e.id, type: 'expense',
          title: (e.isIncome ? '+' : '-') + '¥' + (e.amount / 100).toFixed(e.amount % 100 === 0 ? 0 : 2) + ' ' + e.name,
          detail: '', timestamp: new Date(e.date + 'T12:00:00+08:00').getTime(), date: e.date,
        });
      }
    }

    for (const t of todos) {
      if (!t.done || !t.dueDate || t.dueDate < cutoff) continue;
      result.push({
        id: t.id, type: 'todo_done', title: t.text, detail: '',
        timestamp: new Date(t.dueDate + 'T12:00:00+08:00').getTime(), date: t.dueDate,
      });
    }

    for (const h of habits) {
      for (const c of h.recentCheckins) {
        if (c.done && c.date >= cutoff) {
          result.push({
            id: h.id + '|' + c.date, type: 'habit',
            title: h.icon + ' ' + h.name,
            detail: h.streak > 1 ? '连续' + h.streak + '天' : '',
            timestamp: new Date(c.date + 'T12:00:00+08:00').getTime(), date: c.date,
          });
        }
      }
    }

    for (const d of diaries) {
      if (d.date >= cutoff) {
        result.push({
          id: d.id, type: 'diary',
          title: d.mood ? d.content.slice(0, 40) : d.content.slice(0, 40),
          detail: '',
          timestamp: new Date(d.date + 'T12:00:00+08:00').getTime(), date: d.date,
        });
      }
    }

    for (const s of schedules) {
      if (s.date >= cutoff && s.date <= getToday()) {
        result.push({
          id: s.id, type: 'schedule',
          title: s.title, detail: s.startTime + '-' + s.endTime,
          timestamp: new Date(s.date + 'T12:00:00+08:00').getTime(), date: s.date,
        });
      }
    }

    return result.sort((a, b) => b.timestamp - a.timestamp).slice(0, 60);
  }, [expenses, todos, habits, diaries, schedules]);

  const groupedByDate = useMemo(() => {
    const groups: Array<[string, TimelineEntry[]]> = [];
    let currentDate = '';
    for (const entry of entries) {
      if (entry.date !== currentDate) {
        currentDate = entry.date;
        groups.push([entry.date, []]);
      }
      groups[groups.length - 1][1].push(entry);
    }
    return groups;
  }, [entries]);

  return (
    <div className="w-full">
      <PageHeader
        icon={Activity}
        gradient="from-[#45B7D1] to-[#6C5CE7]"
        title="时间线"
        subtitle={'近 7 天 · ' + entries.length + ' 条记录'}
      />

      {groupedByDate.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm font-medium text-[var(--text-3)]">最近没有活动记录</p>
          <p className="mt-1 text-xs text-[var(--text-3)]">开始记录，你的生活轨迹会在这里展现</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedByDate.map(([date, items]) => (
            <div key={date}>
              <div className="mb-3 flex items-center gap-3">
                <span className="rounded-full bg-[var(--primary-soft)] px-3 py-1 text-xs font-bold text-[var(--primary)]">
                  {formatDateLabel(date)}
                </span>
                <span className="text-[11px] text-[var(--text-4)]">{items.length} 条</span>
                <div className="h-px flex-1 bg-[var(--border-light)]" />
              </div>
              <div className="space-y-1.5 pl-1">
                {items.map((entry, i) => {
                  const cfg = typeConfig[entry.type];
                  const Icon = cfg.icon;
                  const relative = timeAgo(entry.timestamp);
                  return (
                    <motion.button
                      key={entry.id}
                      type="button"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(i * 0.03, 0.3), ease: [0.16, 1, 0.3, 1] }}
                      onClick={() => navigate(typeRoute[entry.type])}
                      className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors hover:bg-[var(--surface-hover)]"
                      aria-label={`${cfg.label}: ${entry.title}`}
                    >
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                        style={{ backgroundColor: cfg.color + '15' }}
                      >
                        <Icon size={14} style={{ color: cfg.color }} aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-[var(--text-1)]">{entry.title}</p>
                        {entry.detail && (
                          <p className="text-[11px] text-[var(--text-4)]">{entry.detail}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-[10px] font-medium text-[var(--text-4)]">
                        {relative || cfg.label}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
