import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  class: { label: '课程', color: '#7C6FFF' },
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

const DAY_START_HOUR = 0;
const DAY_END_HOUR = 24;
const HOUR_HEIGHT = 56;
const GRID_HEIGHT = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT;

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

interface PositionedItem {
  item: ScheduleOccurrence;
  virtualId: string;
  top: number;
  height: number;
  column: number;
  columns: number;
}

function layoutDayItems(
  items: ScheduleOccurrence[],
): PositionedItem[] {
  const bounded = items
    .map((item) => {
      const startTotal = toMinutes(item.startTime);
      const endTotal = toMinutes(item.endTime);
      const top = ((startTotal - DAY_START_HOUR * 60) / 60) * HOUR_HEIGHT;
      const height = Math.max(44, ((endTotal - startTotal) / 60) * HOUR_HEIGHT);
      return { item, virtualId: item.virtualId, rawTop: top, height };
    })
    .filter(({ rawTop, height }) => rawTop < GRID_HEIGHT && rawTop + height > 0)
    .sort((a, b) => a.rawTop - b.rawTop || b.height - a.height);

  const positioned: PositionedItem[] = [];
  let cluster: typeof bounded = [];
  let clusterEnd = -1;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const columns: number[] = [];
    const assigned: Array<{ entry: (typeof bounded)[number]; column: number }> = [];
    for (const entry of cluster) {
      let column = columns.findIndex((end) => end <= entry.rawTop);
      if (column === -1) {
        column = columns.length;
      }
      columns[column] = entry.rawTop + entry.height;
      assigned.push({ entry, column });
    }
    for (const { entry, column } of assigned) {
      positioned.push({
        item: entry.item,
        virtualId: entry.virtualId,
        top: Math.max(0, entry.rawTop),
        height: Math.min(entry.height, GRID_HEIGHT - Math.max(0, entry.rawTop)),
        column,
        columns: columns.length,
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const entry of bounded) {
    if (cluster.length > 0 && entry.rawTop >= clusterEnd) {
      flushCluster();
    }
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, entry.rawTop + entry.height);
  }
  flushCluster();

  return positioned;
}

function DayView({ date, onEdit }: { date: string; onEdit: (item: ScheduleOccurrence) => void }) {
  const items = useScheduleStore((s) => s.items);
  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => i + DAY_START_HOUR);

  const positioned = useMemo(() => {
    const expanded = expandRecurringForRange(items, date, date);
    return layoutDayItems(expanded);
  }, [items, date]);

  return (
    <div className="relative overflow-x-auto">
      <div className="flex min-w-[320px]">
        <div className="w-14 shrink-0">
          {hours.map((h) => (
            <div key={h} className="h-14 border-b border-[var(--border)]/30 pr-2 text-right text-xs text-[var(--text-3)]">
              {`${h}:00`}
            </div>
          ))}
        </div>
        <div className="relative flex-1" style={{ height: GRID_HEIGHT }}>
          {hours.map((h) => (
            <div key={h} className="h-14 border-b border-[var(--border)]/30" />
          ))}
          <AnimatePresence>
            {positioned.map(({ item, virtualId, top, height, column, columns }) => {
              const config = scheduleTypeConfig[item.type] ?? scheduleTypeConfig.other;
              const widthPercent = 100 / columns;
              return (
                <motion.div
                  key={virtualId}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  onClick={() => onEdit(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onEdit(item);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${item.startTime}-${item.endTime} ${item.title}`}
                  className="absolute cursor-pointer rounded-[var(--radius-md)] px-2.5 py-1.5 transition-shadow hover:shadow-md"
                  style={{
                    top: `${top}px`,
                    height: `${height}px`,
                    left: `calc(${column * widthPercent}% + 4px)`,
                    width: `calc(${widthPercent}% - 8px)`,
                    borderLeft: '3px solid transparent',
                    borderImage: `linear-gradient(to bottom, ${config.color}, ${config.color}88) 1`,
                    backgroundColor: `${config.color}12`,
                  }}
                >
                  <p className="truncate text-xs font-semibold" style={{ color: config.color }}>
                    {item.title}
                  </p>
                  {height > 40 && (
                    <div className="mt-0.5 flex items-center gap-1">
                      <Clock size={10} className="text-[var(--text-3)]" aria-hidden />
                      <span className="text-[10px] text-[var(--text-3)]">
                        {item.startTime}-{item.endTime}
                      </span>
                    </div>
                  )}
                  {height > 56 && item.location && (
                    <div className="mt-0.5 flex items-center gap-1">
                      <MapPin size={10} className="text-[var(--text-3)]" aria-hidden />
                      <span className="truncate text-[10px] text-[var(--text-3)]">{item.location}</span>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
      {positioned.length === 0 && (
        <div className="py-10 text-center">
          <p className="text-sm text-[var(--text-3)]">这天没有日程</p>
        </div>
      )}
    </div>
  );
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
      <div className="grid grid-cols-7 gap-1">
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
                  ? 'bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] text-white shadow-[var(--shadow-xs)]'
                  : isSelected
                  ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
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

      <div className="mt-4 space-y-2">
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
              className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border-light)] bg-[var(--surface)] px-4 py-3 text-left shadow-[var(--shadow-sm)]"
            >
              <div
                className="h-10 w-1.5 shrink-0 rounded-full"
                style={{ background: `linear-gradient(to bottom, ${config.color}, ${config.color}66)` }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--text-1)]">{item.title}</p>
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
                className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white"
                style={{ background: `linear-gradient(135deg, ${config.color}, ${config.color}cc)` }}
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
        <div key={wi} className="grid grid-cols-7 gap-0.5">
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
                    ? 'bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] font-bold text-white shadow-[var(--shadow-xs)]'
                    : isSelected
                    ? 'bg-[var(--primary-soft)] font-semibold text-[var(--primary)]'
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
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={openCreate}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] text-white shadow-[var(--shadow-glow)]"
          aria-label="新建日程"
        >
          <Plus size={20} aria-hidden />
        </motion.button>
      </div>

      <Card variant="glass" className="!rounded-[var(--radius-xl)]">
        <div className="flex items-center justify-between px-3 py-2.5">
          <button type="button" onClick={() => navigateDate(-1)} className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-2)]" aria-label="上一页">
            <ChevronLeft size={18} className="text-[var(--text-2)]" aria-hidden />
          </button>
          <span className="text-sm font-bold text-[var(--text-1)]">{headerDate}</span>
          <button type="button" onClick={() => navigateDate(1)} className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-2)]" aria-label="下一页">
            <ChevronRight size={18} className="text-[var(--text-2)]" aria-hidden />
          </button>
        </div>
      </Card>

      <div className="flex rounded-full bg-[var(--surface-2)] p-1" role="tablist" aria-label="视图切换">
        {(['day', 'week', 'month'] as ViewMode[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            role="tab"
            aria-selected={view === v}
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

      <Card variant="default" className="!rounded-[var(--radius-xl)] !p-4">
        {view === 'day' && <DayView date={selectedDate} onEdit={handleEdit} />}
        {view === 'week' && <WeekView date={selectedDate} onSelectDate={setSelectedDate} onEdit={handleEdit} />}
        {view === 'month' && <MonthView date={selectedDate} onSelectDate={(d) => { setSelectedDate(d); setView('day'); }} />}
      </Card>

      {showModal && <ScheduleEditor key={formKey} selectedDate={selectedDate} item={editItem} onClose={() => { setShowModal(false); setEditItem(undefined); }} />}

    </div>
  );
}
