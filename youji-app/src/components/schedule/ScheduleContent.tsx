import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, ChevronLeft, ChevronRight, Clock, MapPin, Trash2 } from 'lucide-react';
import { useScheduleStore, expandRecurringForRange } from '../../stores/scheduleStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { toast } from '../../services/toastBus';
import type { ScheduleRecord } from '../../db';
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

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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

interface ScheduleFormModalProps {
  open: boolean;
  onClose: () => void;
  selectedDate: string;
  editItem?: ScheduleRecord;
  onRequestDelete?: (item: ScheduleRecord) => void;
}

function ScheduleFormModal({ open, onClose, selectedDate, editItem, onRequestDelete }: ScheduleFormModalProps) {
  const addItem = useScheduleStore((s) => s.addItem);
  const updateItem = useScheduleStore((s) => s.updateItem);
  const [title, setTitle] = useState(editItem?.title ?? '');
  const [date, setDate] = useState(editItem?.date ?? selectedDate);
  const [startTime, setStartTime] = useState(editItem?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(editItem?.endTime ?? '10:30');
  const [location, setLocation] = useState(editItem?.location ?? '');
  const [type, setType] = useState<ScheduleType>(editItem?.type ?? 'other');
  const [repeat, setRepeat] = useState<ScheduleRecord['repeat']>(editItem?.repeat ?? 'none');
  const [saving, setSaving] = useState(false);

  const timeValid = TIME_PATTERN.test(startTime) && TIME_PATTERN.test(endTime) && startTime < endTime;

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed || !timeValid || saving) return;
    setSaving(true);
    try {
      if (editItem) {
        await updateItem(editItem.id, {
          title: trimmed,
          date,
          startTime,
          endTime,
          location,
          type,
          repeat,
        });
      } else {
        await addItem({ title: trimmed, date, startTime, endTime, location, type, repeat, remind: 15 });
      }
      onClose();
    } catch {
      toast.error('日程保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editItem ? '编辑日程' : '新建日程'}
      footer={
        <>
          {editItem && onRequestDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRequestDelete(editItem)}
              className="!text-[var(--danger)] mr-auto"
            >
              <Trash2 size={14} className="mr-1 inline" aria-hidden />
              删除
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={handleSave} disabled={!title.trim() || !timeValid || saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="schedule-title" className="mb-1 block text-xs font-medium text-[var(--text-3)]">标题 *</label>
          <input
            id="schedule-title"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 100))}
            placeholder="日程标题"
            maxLength={100}
            className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text-1)] outline-none transition-all focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--primary)]/8"
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="schedule-date" className="mb-1 block text-xs font-medium text-[var(--text-3)]">日期</label>
          <input
            id="schedule-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text-1)] outline-none transition-all focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--primary)]/8"
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="schedule-start" className="mb-1 block text-xs font-medium text-[var(--text-3)]">开始</label>
            <input
              id="schedule-start"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text-1)] outline-none transition-all focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--primary)]/8"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="schedule-end" className="mb-1 block text-xs font-medium text-[var(--text-3)]">结束</label>
            <input
              id="schedule-end"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text-1)] outline-none transition-all focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--primary)]/8"
            />
          </div>
        </div>
        {!timeValid && (
          <p className="text-xs text-[var(--danger)]" role="alert">结束时间必须晚于开始时间</p>
        )}

        <div>
          <label htmlFor="schedule-location" className="mb-1 block text-xs font-medium text-[var(--text-3)]">地点</label>
          <input
            id="schedule-location"
            value={location}
            onChange={(e) => setLocation(e.target.value.slice(0, 100))}
            placeholder="教学楼301（可选）"
            maxLength={100}
            className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text-1)] outline-none transition-all focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--primary)]/8"
          />
        </div>

        <div>
          <p className="mb-1 block text-xs font-medium text-[var(--text-3)]">类型</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="日程类型">
            {(Object.entries(scheduleTypeConfig) as [ScheduleType, typeof scheduleTypeConfig['class']][]).map(([key, config]) => (
              <button
                key={key}
                type="button"
                onClick={() => setType(key)}
                aria-pressed={type === key}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                  type === key
                    ? 'text-white shadow-sm'
                    : 'bg-[var(--surface-2)] text-[var(--text-2)]'
                }`}
                style={type === key ? { background: `linear-gradient(135deg, ${config.color}, ${config.color}cc)` } : undefined}
              >
                {config.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 block text-xs font-medium text-[var(--text-3)]">重复</p>
          <div className="flex gap-2" role="group" aria-label="重复规则">
            {(['none', 'weekly'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRepeat(r)}
                aria-pressed={repeat === r}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                  repeat === r
                    ? 'bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] text-white shadow-sm'
                    : 'bg-[var(--surface-2)] text-[var(--text-2)]'
                }`}
              >
                {r === 'none' ? '不重复' : '每周重复'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

const DAY_START_HOUR = 7;
const DAY_END_HOUR = 23;
const HOUR_HEIGHT = 56;
const GRID_HEIGHT = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT;

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

interface PositionedItem {
  item: ScheduleRecord;
  virtualId: string;
  top: number;
  height: number;
  column: number;
  columns: number;
}

function layoutDayItems(
  items: Array<ScheduleRecord & { virtualId: string }>,
): PositionedItem[] {
  const bounded = items
    .map((item) => {
      const startTotal = toMinutes(item.startTime);
      const endTotal = toMinutes(item.endTime);
      const top = ((startTotal - DAY_START_HOUR * 60) / 60) * HOUR_HEIGHT;
      const height = Math.max(28, ((endTotal - startTotal) / 60) * HOUR_HEIGHT);
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

function DayView({ date, onEdit }: { date: string; onEdit: (item: ScheduleRecord) => void }) {
  const items = useScheduleStore((s) => s.items);
  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => i + DAY_START_HOUR);

  const positioned = useMemo(() => {
    const expanded = expandRecurringForRange(items, date, date);
    return layoutDayItems(expanded);
  }, [items, date]);

  const onEditToOrigin = useCallback(
    (item: ScheduleRecord & { originDate?: string }) => {
      if (item.originDate && item.originDate !== item.date) {
        onEdit({ ...item, date: item.originDate });
      } else {
        onEdit(item);
      }
    },
    [onEdit]
  );

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
                  onClick={() => onEditToOrigin(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onEditToOrigin(item);
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

function WeekView({ date, onSelectDate, onEdit }: { date: string; onSelectDate: (d: string) => void; onEdit: (item: ScheduleRecord) => void }) {
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
              onClick={() => onEdit(item.date !== item.originDate && item.originDate ? { ...item, date: item.originDate } : item)}
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

export function ScheduleContent({ initialRecord }: { initialRecord?: ScheduleRecord } = {}) {
  const [view, setView] = useState<ViewMode>('day');
  const [showModal, setShowModal] = useState(Boolean(initialRecord));
  const [editItem, setEditItem] = useState<ScheduleRecord | undefined>(() => initialRecord ? structuredClone(initialRecord) : undefined);
  const [formKey, setFormKey] = useState(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  const selectedDate = useScheduleStore((s) => s.selectedDate);
  const setSelectedDate = useScheduleStore((s) => s.setSelectedDate);
  const removeItem = useScheduleStore((s) => s.removeItem);

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

  const handleEdit = useCallback((item: ScheduleRecord) => {
    setEditItem(item);
    setFormKey((k) => k + 1);
    setShowModal(true);
  }, []);

  const handleDelete = useCallback(async () => {
    if (showDeleteConfirm === null) return;
    try {
      await removeItem(showDeleteConfirm);
    } catch {
      toast.error('删除失败，请重试');
    } finally {
      setShowDeleteConfirm(null);
      setShowModal(false);
      setEditItem(undefined);
    }
  }, [showDeleteConfirm, removeItem]);

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

      <ScheduleFormModal
        key={formKey}
        open={showModal}
        onClose={() => { setShowModal(false); setEditItem(undefined); }}
        selectedDate={selectedDate}
        editItem={editItem}
        onRequestDelete={(item) => setShowDeleteConfirm(item.id)}
      />

      <Modal
        open={showDeleteConfirm !== null}
        onClose={() => setShowDeleteConfirm(null)}
        title="确认删除"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(null)}>取消</Button>
            <Button variant="danger" size="sm" onClick={handleDelete}>删除</Button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-1)]">确定要删除这个日程吗？此操作不可撤销。</p>
      </Modal>
    </div>
  );
}
