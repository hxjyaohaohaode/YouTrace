import { useState, useRef } from 'react';
import type { Habit } from '../types';
import { dateOnlyLocal } from '../utils/date';

interface HabitCardProps {
  habit: Habit;
  onToggle: (id: string, date?: string) => void;
  onEdit?: (habit: Habit) => void;
  index?: number;
}

function HabitCard({ habit, onToggle, onEdit }: HabitCardProps) {
  const [showBackdate, setShowBackdate] = useState(false);
  const [backdate, setBackdate] = useState('');
  const [animating, setAnimating] = useState(false);
  const animRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleToggle = () => {
    if (navigator.vibrate) navigator.vibrate(50);
    if (!habit.todayCompleted) {
      setAnimating(true);
      if (animRef.current) clearTimeout(animRef.current);
      animRef.current = setTimeout(() => setAnimating(false), 600);
    }
    onToggle(habit.id);
  };

  const handleBackdateToggle = () => {
    if (backdate) {
      onToggle(habit.id, backdate);
      setShowBackdate(false);
      setBackdate('');
    }
  };

  const yesterday = dateOnlyLocal(new Date(Date.now() - 86400000));
  const dayBefore = dateOnlyLocal(new Date(Date.now() - 2 * 86400000));
  const threeDaysAgo = dateOnlyLocal(new Date(Date.now() - 3 * 86400000));
  const fourDaysAgo = dateOnlyLocal(new Date(Date.now() - 4 * 86400000));
  const fiveDaysAgo = dateOnlyLocal(new Date(Date.now() - 5 * 86400000));
  const sixDaysAgo = dateOnlyLocal(new Date(Date.now() - 6 * 86400000));
  const sevenDaysAgo = dateOnlyLocal(new Date(Date.now() - 7 * 86400000));

  const completionRate = habit.targetDays > 0
    ? Math.min(100, Math.round((habit.streakCurrent / habit.targetDays) * 100))
    : 0;

  const recentCompleted = habit.recentLogs
    ? habit.recentLogs.filter(l => l.isCompleted).length
    : 0;
  const recentTotal = habit.recentLogs ? habit.recentLogs.length : 0;
  const recentRate = recentTotal > 0 ? Math.round((recentCompleted / recentTotal) * 100) : 0;

  return (
    <div className="card card-responsive">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-surface-800 dark:text-surface-200">{habit.title}</h3>
            {onEdit && (
              <button
                onClick={() => onEdit(habit)}
                className="text-surface-300 hover:text-brand-500 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            )}
          </div>
          {habit.description && (
            <p className="text-xs text-surface-400 mt-1">{habit.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2.5">
            <span className="text-xs text-surface-400 flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" /></svg> <span className="font-semibold text-orange-500">{habit.streakCurrent}</span>天连续
            </span>
            <span className="text-xs text-surface-400 flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg> 最长<span className="font-semibold text-amber-500">{habit.streakLongest}</span>天
            </span>
            <span className="text-xs px-2 py-0.5 rounded-md bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 font-medium">
              {habit.frequency === 'DAILY' ? '每天' : habit.frequency === 'WEEKLY' ? '每周' : habit.frequency === 'WEEKDAYS' ? '工作日' : '自定义'}
            </span>
          </div>

          {habit.goalId && (habit as { goal?: { id: string; title: string } }).goal && (
            <div className="mt-2 flex items-center gap-1.5">
              <span className="text-2xs text-blue-500 bg-blue-50 dark:bg-blue-950/30 px-1.5 py-0.5 rounded-md font-medium">
                🎯 {(habit as { goal?: { id: string; title: string } }).goal!.title}
              </span>
            </div>
          )}
        </div>

        <button
          onClick={handleToggle}
          className={`relative w-11 h-11 rounded-xl flex items-center justify-center text-lg transition-all ${habit.todayCompleted
            ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
            : 'bg-surface-100 dark:bg-surface-800 text-surface-400 hover:bg-brand-50 dark:hover:bg-brand-950/30 hover:text-brand-500'
            } ${animating ? 'scale-125' : 'scale-100'}`}
          style={{ transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), background-color 0.3s, box-shadow 0.3s' }}
        >
          {habit.todayCompleted ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          ) : null}
          {animating && (
            <span className="absolute inset-0 rounded-xl bg-emerald-400 animate-ping opacity-30" />
          )}
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-2xs text-surface-400">目标进度</span>
            <span className="text-2xs text-surface-500 font-medium">{completionRate}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-surface-100 dark:bg-surface-800">
            <div
              className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-brand-400 to-brand-500"
              style={{ width: `${completionRate}%` }}
            />
          </div>
        </div>
        <span className="text-2xs text-surface-400 flex-shrink-0">近7天 {recentRate}%</span>
      </div>

      {habit.recentLogs && habit.recentLogs.length > 0 && (
        <div className="flex gap-1.5 mt-3">
          {habit.recentLogs.slice(0, 7).map((log) => (
            <div
              key={log.date}
              className={`w-7 h-7 rounded-lg text-[10px] flex items-center justify-center font-medium transition-all ${log.isCompleted
                ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                : 'bg-surface-50 dark:bg-surface-800 text-surface-300 dark:text-surface-600'
                }`}
              title={log.date}
            >
              {log.isCompleted ? '✓' : '✗'}
            </div>
          ))}
        </div>
      )}

      {!habit.todayCompleted && (
        <div className="mt-3">
          {!showBackdate ? (
            <button
              onClick={() => setShowBackdate(true)}
              className="text-xs text-surface-400 hover:text-brand-500 font-medium"
            >
              补打卡
            </button>
          ) : (
            <div className="flex items-center gap-2 mt-1">
              <select
                value={backdate}
                onChange={(e) => setBackdate(e.target.value)}
                className="text-xs bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg px-2 py-1.5 text-surface-600 dark:text-surface-300"
              >
                <option value="">选择日期</option>
                <option value={yesterday}>昨天</option>
                <option value={dayBefore}>前天</option>
                <option value={threeDaysAgo}>3天前</option>
                <option value={fourDaysAgo}>4天前</option>
                <option value={fiveDaysAgo}>5天前</option>
                <option value={sixDaysAgo}>6天前</option>
                <option value={sevenDaysAgo}>7天前</option>
              </select>
              <button
                onClick={handleBackdateToggle}
                disabled={!backdate}
                className="text-xs text-brand-500 hover:text-brand-600 disabled:text-surface-300 font-medium"
              >
                确认
              </button>
              <button
                onClick={() => { setShowBackdate(false); setBackdate(''); }}
                className="text-xs text-surface-400"
              >
                取消
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default HabitCard;
