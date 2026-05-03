import { useMemo, useRef, useEffect } from 'react';
import type { EventItem } from '../types';
import { EVENT_COLORS, type EventColor } from '../types';
import { getDaysInMonth, getFirstDayOfMonth, dateOnlyLocal } from '../utils/date';
import { EmotionIcon, type EmotionIconName } from '../utils/emotion';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAYS_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const HOUR_HEIGHT = 52;
const START_HOUR = 0;
const END_HOUR = 24;

export type CalendarView = 'month' | 'week' | 'day';

interface CalendarProps {
    events: EventItem[];
    view: CalendarView;
    currentDate: Date;
    onViewChange: (view: CalendarView) => void;
    onDateChange: (date: Date) => void;
    onDateClick: (date: Date) => void;
    onEventClick: (eventId: string) => void;
    diariesByDate: Record<string, { emotionTags: string[]; imageCount?: number; thumbnailPaths?: string[] }>;
}

function getWeekDates(date: Date): Date[] {
    const day = date.getDay();
    const start = new Date(date);
    start.setDate(date.getDate() - day);
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return d;
    });
}

function buildEventsByDateMap(events: EventItem[]): Map<string, EventItem[]> {
    const map = new Map<string, EventItem[]>();
    for (const e of events) {
        const start = e.startTime.slice(0, 10);
        const end = e.endTime.slice(0, 10);
        const startDate = new Date(start + 'T00:00:00');
        const endDate = new Date(end + 'T00:00:00');
        const d = new Date(startDate);
        while (d <= endDate) {
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const list = map.get(key) || [];
            list.push(e);
            map.set(key, list);
            d.setDate(d.getDate() + 1);
        }
    }
    return map;
}

function getEventPosition(startTime: string, endTime: string) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const endMinutes = end.getHours() * 60 + end.getMinutes();
    const clampedStart = Math.max(startMinutes, START_HOUR * 60);
    const clampedEnd = Math.min(endMinutes, END_HOUR * 60);
    const top = ((clampedStart - START_HOUR * 60) / 60) * HOUR_HEIGHT;
    const height = Math.max(((clampedEnd - clampedStart) / 60) * HOUR_HEIGHT, 22);
    return { top, height };
}

interface EventLayoutInfo {
    column: number;
    totalColumns: number;
}

function layoutDayEvents(events: EventItem[]): Map<string, EventLayoutInfo> {
    const result = new Map<string, EventLayoutInfo>();
    if (events.length === 0) return result;

    const sorted = [...events].sort((a, b) => {
        const startDiff = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
        if (startDiff !== 0) return startDiff;
        const durationA = new Date(a.endTime).getTime() - new Date(a.startTime).getTime();
        const durationB = new Date(b.endTime).getTime() - new Date(b.startTime).getTime();
        return durationB - durationA;
    });

    const groups: EventItem[][] = [];
    let currentGroup: EventItem[] = [];
    let groupEndTime = -Infinity;

    for (const event of sorted) {
        const eventStart = new Date(event.startTime).getTime();
        if (currentGroup.length > 0 && eventStart < groupEndTime) {
            currentGroup.push(event);
            groupEndTime = Math.max(groupEndTime, new Date(event.endTime).getTime());
        } else {
            if (currentGroup.length > 0) groups.push(currentGroup);
            currentGroup = [event];
            groupEndTime = new Date(event.endTime).getTime();
        }
    }
    if (currentGroup.length > 0) groups.push(currentGroup);

    for (const group of groups) {
        const columns: EventItem[][] = [];
        for (const event of group) {
            const eventStart = new Date(event.startTime).getTime();
            let placed = false;
            for (let i = 0; i < columns.length; i++) {
                const lastInColumn = columns[i][columns[i].length - 1];
                if (eventStart >= new Date(lastInColumn.endTime).getTime()) {
                    columns[i].push(event);
                    result.set(event.id, { column: i, totalColumns: 0 });
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                columns.push([event]);
                result.set(event.id, { column: columns.length - 1, totalColumns: 0 });
            }
        }
        const totalColumns = columns.length;
        for (const event of group) {
            const layout = result.get(event.id);
            if (layout) layout.totalColumns = totalColumns;
        }
    }

    return result;
}

const EVENT_STYLE_MAP: Record<string, { bg: string; text: string; border: string; dot: string; gradient: string }> = {
    blue: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-l-blue-400', dot: 'bg-blue-400', gradient: 'from-blue-400 to-blue-500' },
    green: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-l-emerald-400', dot: 'bg-emerald-400', gradient: 'from-emerald-400 to-emerald-500' },
    purple: { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-l-violet-400', dot: 'bg-violet-400', gradient: 'from-violet-400 to-violet-500' },
    orange: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-l-amber-400', dot: 'bg-amber-400', gradient: 'from-amber-400 to-amber-500' },
    red: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-l-rose-400', dot: 'bg-rose-400', gradient: 'from-rose-400 to-rose-500' },
    teal: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-l-teal-400', dot: 'bg-teal-400', gradient: 'from-teal-400 to-teal-500' },
    pink: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-l-pink-400', dot: 'bg-pink-400', gradient: 'from-pink-400 to-pink-500' },
    yellow: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-l-yellow-400', dot: 'bg-yellow-400', gradient: 'from-yellow-400 to-yellow-500' },
    holiday: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-l-rose-400', dot: 'bg-rose-400', gradient: 'from-rose-400 to-rose-500' },
    course: { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-l-violet-400', dot: 'bg-violet-400', gradient: 'from-violet-400 to-violet-500' },
    default: { bg: 'bg-brand-50', text: 'text-brand-700', border: 'border-l-brand-400', dot: 'bg-brand-400', gradient: 'from-brand-400 to-brand-500' },
};

function getEventStyle(event: EventItem) {
    if (event.isHoliday) return EVENT_STYLE_MAP.holiday;
    if (event.isCourse) return EVENT_STYLE_MAP.course;
    if (event.color && EVENT_COLORS[event.color as EventColor]) {
        return EVENT_STYLE_MAP[event.color] || EVENT_STYLE_MAP.default;
    }
    return EVENT_STYLE_MAP.default;
}

function CurrentTimeLine({ offsetLeft = 0 }: { offsetLeft?: number }) {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    if (currentMinutes < START_HOUR * 60 || currentMinutes >= END_HOUR * 60) return null;
    const top = ((currentMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
    return (
        <div
            className="absolute left-0 right-0 z-10 pointer-events-none"
            style={{ top, marginLeft: offsetLeft }}
        >
            <div className="flex items-center">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1 flex-shrink-0 shadow-sm shadow-red-200" />
                <div className="flex-1 h-[2px] bg-gradient-to-r from-red-500 to-red-300" />
            </div>
        </div>
    );
}

function MonthView({ events, currentDate, onDateClick, onEventClick, diariesByDate }: Omit<CalendarProps, 'view' | 'onViewChange' | 'onDateChange'>) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const today = dateOnlyLocal(new Date());

    const eventsByDate = useMemo(() => buildEventsByDateMap(events), [events]);

    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);

    return (
        <div>
            <div className="grid grid-cols-7 gap-0 mb-1.5">
                {WEEKDAYS.map((d, i) => (
                    <div key={d} className="text-center py-1.5">
                        <span className={`text-[10px] sm:text-xs font-semibold tracking-wide ${(i === 0 || i === 6) ? 'text-rose-400' : 'text-surface-400'}`}>
                            {d}
                        </span>
                    </div>
                ))}
            </div>
            <div className="grid grid-cols-7 gap-[2px] sm:gap-1">
                {days.map((day, i) => {
                    if (day === null) {
                        return <div key={`empty-${i}`} className="min-h-[64px] sm:min-h-[80px]" />;
                    }

                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const isToday = dateStr === today;
                    const dayOfWeek = new Date(year, month, day).getDay();
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                    const dayEvents = eventsByDate.get(dateStr) || [];
                    const diaryInfo = diariesByDate[dateStr];
                    const maxVisible = 3;
                    const visibleEvents = dayEvents.slice(0, maxVisible);
                    const hiddenCount = dayEvents.length - maxVisible;

                    return (
                        <div
                            key={day}
                            onClick={() => onDateClick(new Date(year, month, day))}
                            className={`min-h-[64px] sm:min-h-[80px] p-1 sm:p-1.5 rounded-xl cursor-pointer transition-all duration-200 ${isToday
                                ? 'bg-brand-50/80 ring-2 ring-inset ring-brand-300 shadow-sm shadow-brand-100'
                                : isWeekend
                                    ? 'bg-surface-50/40 hover:bg-surface-50/80'
                                    : 'hover:bg-surface-50/60'
                                }`}
                        >
                            <div className="flex items-center justify-between mb-0.5">
                                <span className={`text-[11px] sm:text-xs font-bold inline-flex items-center justify-center ${isToday
                                    ? 'w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-sm shadow-brand-200'
                                    : isWeekend
                                        ? 'text-rose-500'
                                        : 'text-surface-700'
                                    }`}>
                                    {day}
                                </span>
                                <div className="flex items-center gap-0.5">
                                    {diaryInfo && diaryInfo.emotionTags.length > 0 && (
                                        <EmotionIcon emotion={diaryInfo.emotionTags[0] as EmotionIconName} className="w-3 h-3 sm:w-3.5 sm:h-3.5 opacity-70" />
                                    )}
                                </div>
                            </div>
                            <div className="mt-0.5 space-y-[2px] overflow-hidden">
                                {visibleEvents.map((event) => {
                                    const style = getEventStyle(event);
                                    return (
                                        <div
                                            key={event.id}
                                            onClick={(e) => { e.stopPropagation(); onEventClick(event.id); }}
                                            title={event.title}
                                            className={`hidden sm:flex items-center gap-1 text-[10px] sm:text-[11px] truncate rounded-md px-1.5 py-[2px] sm:py-[3px] cursor-pointer transition-all duration-150 font-medium shadow-sm ${style.bg} ${style.text} hover:shadow-md`}
                                        >
                                            <div className={`w-1 h-1 rounded-full flex-shrink-0 ${style.dot}`} />
                                            <span className="truncate">{event.title}</span>
                                        </div>
                                    );
                                })}
                                {visibleEvents.map((event) => {
                                    const style = getEventStyle(event);
                                    return (
                                        <div
                                            key={event.id}
                                            onClick={(e) => { e.stopPropagation(); onEventClick(event.id); }}
                                            className={`sm:hidden flex items-center gap-0.5 cursor-pointer`}
                                        >
                                            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${style.dot}`} />
                                        </div>
                                    );
                                })}
                                {hiddenCount > 0 && (
                                    <span className="text-[9px] sm:text-[10px] text-surface-400 font-semibold pl-1">
                                        +{hiddenCount}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function WeekView({ events, currentDate, onDateClick, onEventClick }: Omit<CalendarProps, 'view' | 'onViewChange' | 'onDateChange' | 'diariesByDate'>) {
    const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate]);
    const today = dateOnlyLocal(new Date());
    const scrollRef = useRef<HTMLDivElement>(null);

    const timedEventsByDate = useMemo(() => {
        const map = new Map<string, EventItem[]>();
        for (const e of events) {
            if (e.isAllDay) continue;
            const dateStr = e.startTime.slice(0, 10);
            const list = map.get(dateStr) || [];
            list.push(e);
            map.set(dateStr, list);
        }
        return map;
    }, [events]);

    useEffect(() => {
        const now = new Date();
        const currentHour = now.getHours();
        if (scrollRef.current && currentHour >= START_HOUR && currentHour < END_HOUR) {
            const scrollPosition = (currentHour - START_HOUR) * HOUR_HEIGHT - 100;
            scrollRef.current.scrollTo({ top: Math.max(0, scrollPosition) });
        }
    }, []);

    const gridHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;

    return (
        <div>
            <div className="flex border-b border-surface-200/60 pb-2.5 mb-1">
                <div className="w-12 flex-shrink-0" />
                {weekDates.map((date, i) => {
                    const dateStr = dateOnlyLocal(date);
                    const isToday = dateStr === today;
                    const isWeekend = i === 0 || i === 6;
                    return (
                        <div key={i} className="flex-1 text-center py-1 min-w-0">
                            <div className={`text-[10px] font-semibold tracking-wide ${isToday ? 'text-brand-500' : isWeekend ? 'text-rose-400' : 'text-surface-400'}`}>
                                {WEEKDAYS_SHORT[i]}
                            </div>
                            <div className={`text-sm font-bold mt-1 inline-flex items-center justify-center ${isToday
                                ? 'w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-sm shadow-brand-200'
                                : 'text-surface-700'
                                }`}>
                                {date.getDate()}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div ref={scrollRef} className="overflow-y-auto overflow-x-hidden" style={{ maxHeight: '70vh' }}>
                <div className="flex relative" style={{ height: gridHeight }}>
                    <div className="w-12 flex-shrink-0 relative">
                        {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => i + START_HOUR).map((hour) => (
                            <div
                                key={hour}
                                className="absolute right-2 text-[10px] text-surface-400 leading-none font-medium"
                                style={{ top: (hour - START_HOUR) * HOUR_HEIGHT + 2 }}
                            >
                                {String(hour).padStart(2, '0')}:00
                            </div>
                        ))}
                    </div>

                    <div className="flex-1 flex relative">
                        {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => i + START_HOUR).map((hour) => (
                            <div
                                key={hour}
                                className="absolute left-0 right-0 border-b border-surface-100/60"
                                style={{ top: (hour - START_HOUR) * HOUR_HEIGHT }}
                            />
                        ))}

                        <CurrentTimeLine offsetLeft={0} />

                        {weekDates.map((date, i) => {
                            const dateStr = dateOnlyLocal(date);
                            const dayEvents = timedEventsByDate.get(dateStr) || [];
                            const eventLayouts = layoutDayEvents(dayEvents);

                            return (
                                <div
                                    key={i}
                                    className="flex-1 relative border-l border-surface-100/60 min-w-0 overflow-hidden"
                                    onClick={(e) => {
                                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                        const y = e.clientY - rect.top;
                                        const hour = Math.min(END_HOUR - 1, Math.max(START_HOUR, Math.floor(y / HOUR_HEIGHT) + START_HOUR));
                                        onDateClick(new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour));
                                    }}
                                >
                                    {dayEvents.map((event) => {
                                        const layout = eventLayouts.get(event.id);
                                        const pos = getEventPosition(event.startTime, event.endTime);
                                        const column = layout?.column || 0;
                                        const totalColumns = layout?.totalColumns || 1;
                                        const colWidth = 100 / totalColumns;
                                        const style = getEventStyle(event);

                                        return (
                                            <div
                                                key={event.id}
                                                onClick={(e) => { e.stopPropagation(); onEventClick(event.id); }}
                                                className={`absolute rounded-lg px-1.5 py-1 cursor-pointer hover:shadow-md transition-all duration-150 font-medium text-[10px] overflow-hidden border-l-[3px] shadow-sm ${style.bg} ${style.text} ${style.border}`}
                                                style={{
                                                    top: pos.top,
                                                    height: pos.height,
                                                    left: `${column * colWidth + 4}%`,
                                                    width: `${colWidth - 6}%`,
                                                }}
                                            >
                                                <div className="truncate font-bold">{event.title}</div>
                                                {pos.height > 32 && (
                                                    <div className="text-[8px] opacity-60 truncate mt-0.5">
                                                        {new Date(event.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                                        -{new Date(event.endTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}

function DayView({ events, currentDate, onDateClick, onEventClick }: Omit<CalendarProps, 'view' | 'onViewChange' | 'onDateChange' | 'diariesByDate'>) {
    const dateStr = dateOnlyLocal(currentDate);
    const eventsByDate = useMemo(() => buildEventsByDateMap(events), [events]);
    const dayEvents = eventsByDate.get(dateStr) || [];
    const allDayEvents = dayEvents.filter((e) => e.isAllDay);
    const timedEvents = dayEvents.filter((e) => !e.isAllDay);
    const scrollRef = useRef<HTMLDivElement>(null);

    const eventLayouts = useMemo(() => layoutDayEvents(timedEvents), [timedEvents]);

    useEffect(() => {
        const now = new Date();
        const currentHour = now.getHours();
        if (scrollRef.current && currentHour >= START_HOUR && currentHour < END_HOUR) {
            const scrollPosition = (currentHour - START_HOUR) * HOUR_HEIGHT - 100;
            scrollRef.current.scrollTo({ top: Math.max(0, scrollPosition) });
        }
    }, []);

    const gridHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;

    return (
        <div>
            {allDayEvents.length > 0 && (
                <div className="mb-4 space-y-1.5">
                    <div className="text-xs text-surface-400 font-semibold mb-2 tracking-wide">全天事件</div>
                    {allDayEvents.map((event) => {
                        const style = getEventStyle(event);
                        return (
                            <div
                                key={event.id}
                                onClick={() => onEventClick(event.id)}
                                className={`text-sm rounded-xl px-3.5 py-2.5 cursor-pointer hover:shadow-md transition-all duration-150 font-medium border-l-[3px] shadow-sm ${style.bg} ${style.text} ${style.border}`}
                            >
                                {event.title}
                            </div>
                        );
                    })}
                </div>
            )}

            <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: '70vh' }}>
                <div className="relative" style={{ height: gridHeight }}>
                    {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => i + START_HOUR).map((hour) => (
                        <div
                            key={hour}
                            className="absolute left-0 right-0 border-b border-surface-100/60"
                            style={{ top: (hour - START_HOUR) * HOUR_HEIGHT }}
                        >
                            <span className="absolute -top-2.5 right-full mr-3 text-[10px] text-surface-400 leading-none font-medium">
                                {String(hour).padStart(2, '0')}:00
                            </span>
                        </div>
                    ))}

                    <CurrentTimeLine offsetLeft={48} />

                    <div
                        className="absolute left-14 right-0 top-0 bottom-0"
                        onClick={(e) => {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const y = e.clientY - rect.top;
                            const hour = Math.min(END_HOUR - 1, Math.max(START_HOUR, Math.floor(y / HOUR_HEIGHT) + START_HOUR));
                            onDateClick(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), hour));
                        }}
                    >
                        {timedEvents.map((event) => {
                            const layout = eventLayouts.get(event.id);
                            const pos = getEventPosition(event.startTime, event.endTime);
                            const column = layout?.column || 0;
                            const totalColumns = layout?.totalColumns || 1;
                            const colWidth = 100 / totalColumns;
                            const style = getEventStyle(event);

                            return (
                                <div
                                    key={event.id}
                                    onClick={(e) => { e.stopPropagation(); onEventClick(event.id); }}
                                    className={`absolute rounded-xl px-3 py-2 cursor-pointer hover:shadow-lg transition-all duration-150 font-medium text-xs overflow-hidden border-l-[3px] shadow-sm ${style.bg} ${style.text} ${style.border}`}
                                    style={{
                                        top: pos.top,
                                        height: pos.height,
                                        left: `${column * colWidth + 1}%`,
                                        width: `${colWidth - 2}%`,
                                    }}
                                >
                                    <div className="font-bold truncate">{event.title}</div>
                                    {pos.height > 36 && (
                                        <div className="text-[10px] opacity-60 mt-0.5">
                                            {new Date(event.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                            {' - '}
                                            {new Date(event.endTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    )}
                                    {pos.height > 60 && event.description && (
                                        <div className="text-[10px] opacity-45 mt-1 line-clamp-2">{event.description}</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}

function Calendar({ events, view, currentDate, onViewChange, onDateChange, onDateClick, onEventClick, diariesByDate }: CalendarProps) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const prevPeriod = () => {
        if (view === 'month') {
            onDateChange(new Date(year, month - 1, 1));
        } else if (view === 'week') {
            const d = new Date(currentDate);
            d.setDate(d.getDate() - 7);
            onDateChange(d);
        } else {
            const d = new Date(currentDate);
            d.setDate(d.getDate() - 1);
            onDateChange(d);
        }
    };

    const nextPeriod = () => {
        if (view === 'month') {
            onDateChange(new Date(year, month + 1, 1));
        } else if (view === 'week') {
            const d = new Date(currentDate);
            d.setDate(d.getDate() + 7);
            onDateChange(d);
        } else {
            const d = new Date(currentDate);
            d.setDate(d.getDate() + 1);
            onDateChange(d);
        }
    };

    const goToday = () => {
        onDateChange(new Date());
    };

    const getTitle = () => {
        if (view === 'month') {
            return `${year}年${month + 1}月`;
        }
        if (view === 'week') {
            const weekDates = getWeekDates(currentDate);
            const start = weekDates[0];
            const end = weekDates[6];
            return `${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`;
        }
        return `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月${currentDate.getDate()}日`;
    };

    const viewOptions: { key: CalendarView; label: string }[] = [
        { key: 'month', label: '月' },
        { key: 'week', label: '周' },
        { key: 'day', label: '日' },
    ];

    return (
        <div>
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-1.5">
                    <button
                        onClick={prevPeriod}
                        className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-surface-100 text-surface-500 transition-all duration-150 active:scale-95"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <button
                        onClick={nextPeriod}
                        className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-surface-100 text-surface-500 transition-all duration-150 active:scale-95"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
                    </button>
                    <h3 className="text-base font-bold text-surface-800 ml-2 tracking-tight">
                        {getTitle()}
                    </h3>
                </div>

                <div className="flex items-center gap-2.5">
                    <button
                        onClick={goToday}
                        className="text-xs text-brand-600 hover:text-brand-700 font-semibold px-3 py-1.5 rounded-lg hover:bg-brand-50 transition-all duration-150 active:scale-95"
                    >
                        今天
                    </button>
                    <div className="flex bg-surface-100 dark:bg-surface-800 rounded-xl p-[3px]">
                        {viewOptions.map((opt) => (
                            <button
                                key={opt.key}
                                onClick={() => onViewChange(opt.key)}
                                className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all duration-200 ${view === opt.key
                                    ? 'bg-white dark:bg-surface-700 text-surface-800 dark:text-surface-100 shadow-sm'
                                    : 'text-surface-400 hover:text-surface-600 dark:hover:text-surface-300'
                                    }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {view === 'month' && (
                <MonthView events={events} currentDate={currentDate} onDateClick={onDateClick} onEventClick={onEventClick} diariesByDate={diariesByDate} />
            )}
            {view === 'week' && (
                <WeekView events={events} currentDate={currentDate} onDateClick={onDateClick} onEventClick={onEventClick} />
            )}
            {view === 'day' && (
                <DayView events={events} currentDate={currentDate} onDateClick={onDateClick} onEventClick={onEventClick} />
            )}
        </div>
    );
}

export default Calendar;
