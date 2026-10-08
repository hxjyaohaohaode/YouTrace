import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Plus, ChevronLeft, ChevronRight, Clock, MapPin } from 'lucide-react';
import { useScheduleStore, expandRecurringForRange, type ScheduleOccurrence } from '../../stores/scheduleStore';
import { Card } from '../ui/Card';
import type { ScheduleRecord } from '../../db';
import { ScheduleEditor } from './ScheduleEditor';
import { formatBusinessDate, getToday, parseBusinessDate } from '../../utils/date';

type ViewMode = 'day' | 'week' | 'month';
type ScheduleType = ScheduleRecord['type'];

const weekDayNames = ['一', '二', '三', '四', '五', '六', '日'];
const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

const scheduleTypeConfig: Record<ScheduleType, { label: string; color: string }> = {
  class: { label: '课程', color: '#C9553E' },
  study: { label: '自习', color: '#2EA06B' },
  work: { label: '工作', color: '#45B7D1' },
  social: { label: '社交', color: '#E8853D' },
  other: { label: '其他', color: '#8F8FA8' },
};


function formatDate(date: Date): string {
  return formatBusinessDate(date);
}

function getWeekDates(date: Date): Date[] {
  const d = new Date(date);
  const day = d.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const dayDate = new Date(monday);
    dayDate.setUTCDate(monday.getUTCDate() + i);
    return dayDate;
  });
}

function getMonthDates(date: Date): Date[][] {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1, 4));
  const lastDay = new Date(Date.UTC(year, month + 1, 0, 4));
  const startOffset = firstDay.getUTCDay() === 0 ? 6 : firstDay.getUTCDay() - 1;
  const cellCount = Math.ceil((startOffset + lastDay.getUTCDate()) / 7) * 7;
  const dates = Array.from({ length: cellCount }, (_, index) =>
    new Date(Date.UTC(year, month, index - startOffset + 1, 4))
  );
  return Array.from({ length: dates.length / 7 }, (_, index) =>
    dates.slice(index * 7, index * 7 + 7)
  );
}

function DayView({ date, onEdit }: { date: string; onEdit: (item: ScheduleOccurrence) => void }) {
  const items = useScheduleStore((s) => s.items);
  const agenda = useMemo(() => expandRecurringForRange(items, date, date).sort((a, b) => a.startTime.localeCompare(b.startTime)), [items, date]);
  return <section aria-label={`${date} 日程清单`} className="day-agenda">
    <div className="planning-section-heading"><h2>当天安排</h2><span>{agenda.length} 项 · {date}</span></div>
    {agenda.length ? <ol className="agenda-list">{agenda.map(item => {
      const config = scheduleTypeConfig[item.type] ?? scheduleTypeConfig.other;
      return <li key={item.virtualId}><button type="button" className="agenda-row" onClick={() => onEdit(item)} aria-label={`${item.startTime}-${item.endTime} ${item.title}`}>
        <span className="agenda-time"><strong>{item.startTime}</strong><span>{item.endTime}</span></span>
        <span className="agenda-marker" style={{ backgroundColor: config.color }} aria-hidden />
        <span className="agenda-detail"><strong>{item.title}</strong><span>{config.label}{item.location ? ` · ${item.location}` : ''}{item.repeat === 'weekly' ? ' · 每周重复' : ''}</span></span>
        <span className="agenda-edit">编辑</span>
      </button></li>;
    })}</ol> : <div className="planning-empty"><h3>这一天还没有安排</h3><p>添加一个确定的计划，其余时间留给自己。</p></div>}
    <p className="planning-footnote">按开始时间排列，包含凌晨与夜间安排。时间按中国标准时间（UTC+8）记录。</p>
  </section>;
}

function WeekView({ date, onSelectDate, onEdit }: { date: string; onSelectDate: (d: string) => void; onEdit: (item: ScheduleOccurrence) => void }) {
  const items = useScheduleStore((s) => s.items);
  const today = getToday();

  const weekDates = useMemo(() => getWeekDates(parseBusinessDate(date)), [date]);
  const expandedByDate = useMemo(() => {
    const start = formatDate(weekDates[0]);
    const end = formatDate(weekDates[6]);
    const expanded = expandRecurringForRange(items, start, end);
    const map = new Map<string, typeof expanded>();
    for (const item of expanded) {
      const list = map.get(item.date) ?? [];
      list.push(item);
      map.set(item.date, list);
    }
    return map;
  }, [items, weekDates]);

  const selectedDayItems = useMemo(
    () => (expandedByDate.get(date) ?? []).sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [expandedByDate, date]
  );

  return (
    <div>
      <div className="calendar-week grid grid-cols-7 gap-1">
        {weekDates.map((d, i) => {
          const dateStr = formatDate(d);
          const isToday = dateStr === today;
          const isSelected = dateStr === date;
          const dayItems = expandedByDate.get(dateStr) ?? [];

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => onSelectDate(dateStr)}
              aria-pressed={isSelected}
              aria-label={`${d.getUTCMonth() + 1}月${d.getUTCDate()}日，${dayItems.length}个日程`}
              className={`flex flex-col items-center rounded-[var(--radius-md)] py-2 transition-all duration-200 sm:py-2.5 ${
                isSelected
                  ? 'bg-gradient-to-r from-[var(--primary)]/10 to-[var(--primary-light)]/10 shadow-sm'
                  : 'hover:bg-[var(--surface-2)]'
              }`}
            >
              <span className="text-xs font-medium text-[var(--text-3)]">{weekDayNames[i]}</span>
              <span className={`mt-1 flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-all duration-200 sm:h-8 sm:w-8 ${
                isToday
                  ? 'bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] text-[var(--on-primary)] shadow-[var(--shadow-xs)]'
                  : isSelected
                  ? 'bg-[var(--primary-soft)] text-[var(--link)]'
                  : 'text-[var(--text-1)]'
              }`}>
                {d.getUTCDate()}
              </span>
              {dayItems.length > 0 && (
                <div className="mt-1.5 flex gap-0.5">
                  {dayItems.slice(0, 3).map((item) => (
                    <div
                      key={item.virtualId}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: `linear-gradient(135deg, ${scheduleTypeConfig[item.type]?.color ?? scheduleTypeConfig.other.color}, ${scheduleTypeConfig[item.type]?.color ?? scheduleTypeConfig.other.color}88)` }}
                    />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="schedule-week-agenda mt-4 space-y-2">
        {selectedDayItems.map((item) => {
          const config = scheduleTypeConfig[item.type] ?? scheduleTypeConfig.other;
          return (
            <motion.button
              key={item.virtualId}
              type="button"
              onClick={() => onEdit(item)}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="week-agenda-row flex w-full items-center gap-3 px-4 py-4 text-left"
            >
              <div
                className="h-10 w-1.5 shrink-0 rounded-full"
                style={{ background: `linear-gradient(to bottom, ${config.color}, ${config.color}66)` }}
              />
              <div className="min-w-0 flex-1">
                <p className="break-words text-base font-semibold text-[var(--text-1)]">{item.title}</p>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--text-3)]">
                  <Clock size={12} aria-hidden />
                  <span>{item.startTime}-{item.endTime}</span>
                  {item.location && (
                    <>
                      <MapPin size={12} aria-hidden />
                      <span className="truncate">{item.location}</span>
                    </>
                  )}
                </div>
              </div>
              <span
                className="shrink-0 rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-xs font-semibold text-[var(--text-1)]"
                style={{ borderLeft: `3px solid ${config.color}` }}
              >
                {config.label}
              </span>
            </motion.button>
          );
        })}
        {selectedDayItems.length === 0 && (
          <p className="py-8 text-center text-sm text-[var(--text-3)]">这天没有日程</p>
        )}
      </div>
    </div>
  );
}

function MonthView({ date, onSelectDate }: { date: string; onSelectDate: (d: string) => void }) {
  const items = useScheduleStore((s) => s.items);
  const today = getToday();

  const weeks = useMemo(() => getMonthDates(parseBusinessDate(date)), [date]);
  const countsByDate = useMemo(() => {
    const allDates = weeks.flat();
    if (allDates.length === 0) return new Map<string, ScheduleRecord[]>();
    const expanded = expandRecurringForRange(items, formatDate(allDates[0]), formatDate(allDates[allDates.length - 1]));
    const map = new Map<string, ScheduleRecord[]>();
    for (const item of expanded) {
      const list = map.get(item.date) ?? [];
      list.push(item);
      map.set(item.date, list);
    }
    return map;
  }, [items, weeks]);

  const currentMonth = parseBusinessDate(date).getUTCMonth();

  return (
    <div>
      <div className="mb-1 grid grid-cols-7">
        {weekDayNames.map((d) => (
          <div key={d} className="py-2 text-center text-xs font-medium text-[var(--text-3)]">{d}</div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="calendar-month-week grid grid-cols-7 gap-0.5">
          {week.map((d) => {
            const dateStr = formatDate(d);
            const isCurrentMonth = d.getUTCMonth() === currentMonth;
            const isToday = dateStr === today;
            const isSelected = dateStr === date;
            const dayItems = countsByDate.get(dateStr) ?? [];

            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => onSelectDate(dateStr)}
                aria-pressed={isSelected}
                aria-label={`${d.getUTCMonth() + 1}月${d.getUTCDate()}日，${dayItems.length}个日程`}
                className={`flex flex-col items-center rounded-[var(--radius-md)] py-1.5 transition-all duration-200 sm:py-2 ${
                  isSelected
                    ? 'bg-gradient-to-r from-[var(--primary)]/10 to-[var(--primary-light)]/10'
                    : 'hover:bg-[var(--surface-2)]'
                } ${!isCurrentMonth ? 'opacity-30' : ''}`}
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm transition-all duration-200 sm:h-8 sm:w-8 ${
                  isToday
                    ? 'bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] font-bold text-[var(--on-primary)] shadow-[var(--shadow-xs)]'
                    : isSelected
                    ? 'bg-[var(--primary-soft)] font-semibold text-[var(--link)]'
                    : 'text-[var(--text-1)]'
                }`}>
                  {d.getUTCDate()}
                </span>
                {dayItems.length > 0 && (
                  <div className="mt-0.5 flex gap-0.5">
                    {dayItems.slice(0, 3).map((item) => (
                      <div
                        key={item.id}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: scheduleTypeConfig[item.type]?.color ?? scheduleTypeConfig.other.color }}
                      />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function ScheduleContent({ initialRecord, initialOccurrence }: { initialRecord?: ScheduleRecord; initialOccurrence?: ScheduleOccurrence } = {}) {
  const [view, setView] = useState<ViewMode>('day');
  const [showModal, setShowModal] = useState(Boolean(initialRecord));
  const [editItem, setEditItem] = useState<ScheduleOccurrence | undefined>(() => initialOccurrence ? structuredClone(initialOccurrence) : initialRecord ? { ...structuredClone(initialRecord), virtualId: initialRecord.id, occurrenceDate: initialRecord.date, source: structuredClone(initialRecord) } : undefined);
  const [formKey, setFormKey] = useState(0);

  const loaded = useScheduleStore((s) => s.loaded);
  const selectedDate = useScheduleStore((s) => s.selectedDate);
  const setSelectedDate = useScheduleStore((s) => s.setSelectedDate);

  const navigateDate = useCallback((delta: number) => {
    const d = parseBusinessDate(selectedDate);
    if (view === 'day') d.setUTCDate(d.getUTCDate() + delta);
    else if (view === 'week') d.setUTCDate(d.getUTCDate() + delta * 7);
    else {
      const targetMonth = d.getUTCMonth() + delta;
      d.setUTCMonth(targetMonth, 1);
    }
    setSelectedDate(formatDate(d));
  }, [selectedDate, view, setSelectedDate]);

  const openCreate = useCallback(() => {
    setEditItem(undefined);
    setFormKey((k) => k + 1);
    setShowModal(true);
  }, []);

  const handleEdit = useCallback((item: ScheduleOccurrence) => {
    setEditItem(structuredClone(item));
    setFormKey((k) => k + 1);
    setShowModal(true);
  }, []);

  const dateObj = parseBusinessDate(selectedDate);
  const headerDate = view === 'day'
    ? `${dateObj.getUTCMonth() + 1}月${dateObj.getUTCDate()}日`
    : view === 'week'
    ? (() => {
        const dates = getWeekDates(dateObj);
        return `${dates[0].getUTCMonth() + 1}/${dates[0].getUTCDate()} - ${dates[6].getUTCMonth() + 1}/${dates[6].getUTCDate()}`;
      })()
    : `${dateObj.getUTCFullYear()}年${monthNames[dateObj.getUTCMonth()]}`;

  const viewLabels: Record<ViewMode, string> = { day: '日', week: '周', month: '月' };

  return (
    <div className="schedule-workspace space-y-4">
      <div className="schedule-actions"><p>日程安排 <span>中国标准时间 · UTC+8</span></p>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={openCreate}
          className="planning-create"
          aria-label="新建日程"
        >
          <Plus size={18} aria-hidden /><span>新建日程</span>
        </motion.button>
      </div>

      <Card variant="default" className="schedule-datebar">
        <div className="flex items-center justify-between px-3 py-2.5">
          <button type="button" onClick={() => navigateDate(-1)} className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-2)]" aria-label="上一页">
            <ChevronLeft size={18} className="text-[var(--text-2)]" aria-hidden />
          </button>
          <div className="schedule-date-title"><strong>{headerDate}</strong><button type="button" onClick={() => setSelectedDate(getToday())}>回到今天</button></div>
          <button type="button" onClick={() => navigateDate(1)} className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-2)]" aria-label="下一页">
            <ChevronRight size={18} className="text-[var(--text-2)]" aria-hidden />
          </button>
        </div>
      </Card>

      <div className="schedule-view-switch flex bg-[var(--surface-2)] p-1" role="group" aria-label="视图切换">
        {(['day', 'week', 'month'] as ViewMode[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={`flex-1 rounded-full py-2 text-sm font-medium transition-all duration-200 sm:py-2.5 ${
              view === v
                ? 'bg-[var(--surface)] text-[var(--text-1)] shadow-sm'
                : 'text-[var(--text-3)]'
            }`}
          >
            {viewLabels[v]}
          </button>
        ))}
      </div>

      <Card variant="default" className="schedule-content-panel !p-4">
        {!loaded && <p role="status" className="planning-empty">正在读取日程安排…</p>}
        {loaded && view === 'day' && <DayView date={selectedDate} onEdit={handleEdit} />}
        {loaded && view === 'week' && <WeekView date={selectedDate} onSelectDate={setSelectedDate} onEdit={handleEdit} />}
        {loaded && view === 'month' && <MonthView date={selectedDate} onSelectDate={(d) => { setSelectedDate(d); setView('day'); }} />}
      </Card>

      {showModal && <ScheduleEditor key={formKey} selectedDate={selectedDate} item={editItem} onClose={() => { setShowModal(false); setEditItem(undefined); }} />}

    </div>
  );
}
