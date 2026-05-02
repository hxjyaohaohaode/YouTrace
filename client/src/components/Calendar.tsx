import { useMemo, useRef, useEffect } from 'react';
import type { EventItem } from '../types';
import { EVENT_COLORS, type EventColor } from '../types';
import { getDaysInMonth, getFirstDayOfMonth, dateOnlyLocal } from '../utils/date';
import { EmotionIcon, type EmotionIconName } from '../utils/emotion';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const HOUR_HEIGHT = 48;
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
    const height = Math.max(((clampedEnd - clampedStart) / 60) * HOUR_HEIGHT, 20);
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

function getEventStyle(event: EventItem): { bg: string; text: string; border: string } {
    if (event.isHoliday) return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-l-red-400' };
    if (event.isCourse) return { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-l-purple-400' };
    if (event.color && EVENT_COLORS[event.color as EventColor]) {
        const c = EVENT_COLORS[event.color as EventColor];
        const borderMap: Record<string, string> = {
            blue: 'border-l-blue-400', green: 'border-l-green-400', purple: 'border-l-purple-400',
            orange: 'border-l-orange-400', red: 'border-l-red-400', teal: 'border-l-teal-400',
            pink: 'border-l-pink-400', yellow: 'border-l-yellow-400',
        };
        return { bg: c.bg, text: c.text, border: borderMap[event.color] || 'border-l-brand-400' };
    }
    return { bg: 'bg-brand-50', text: 'text-brand-700', border: 'border-l-brand-400' };
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
                <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 flex-shrink-0" />
                <div className="flex-1 h-[2px] bg-red-500" />
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
            <div className="grid grid-cols-7 gap-0 sm:gap-1 mb-1">
                {WEEKDAYS.map((d) => (
                    <div key={d} className="text-center py-1">
                        <span className="text-[10px] sm:text-xs font-medium text-surface-400">{d}</span>
                    </div>
                ))}
            </div>
            <div className="grid grid-cols-7 gap-0 sm:gap-1">
                {days.map((day, i) => {
                    if (day === null) {
                        return <div key={`empty-${i}`} className="min-h-[56px] sm:min-h-[72px]" />;
                    }

                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const isToday = dateStr === today;
                    const dayEvents = eventsByDate.get(dateStr) || [];
                    const diaryInfo = diariesByDate[dateStr];
                    const maxVisible = 3;
                    const visibleEvents = dayEvents.slice(0, maxVisible);
                    const hiddenCount = dayEvents.length - maxVisible;

                    return (
                        <div
                            key={day}
                            onClick={() => onDateClick(new Date(year, month, day))}
                            className={`min-h-[56px] sm:min-h-[72px] p-1 sm:p-1.5 rounded-lg sm:rounded-xl cursor-pointer transition-colors ${isToday
                                ? 'bg-brand-50 ring-1 ring-inset ring-brand-200'
                                : 'hover:bg-surface-50'
                                }`}
                        >
                            <div className="flex items-center justify-between">
                                <span className={`text-[11px] sm:text-xs font-semibold inline-flex items-center justify-center ${isToday
                                    ? 'w-5 h-5 sm:w-6 sm:h-6 rounded-full gradient-bg text-white'
                                    : 'text-surface-600'
                                    }`}>
                                    {day}
                                </span>
                                <div className="flex items-center gap-0.5">
                                    {diaryInfo && diaryInfo.emotionTags.length > 0 && (
                                        <EmotionIcon emotion={diaryInfo.emotionTags[0] as EmotionIconName} className="w-2.5 h-2.5 sm:w-3 sm:h-3 opacity-60" />
                                    )}
                                </div>
                            </div>
                            <div className="mt-0.5 space-y-[1px] overflow-hidden">
                                {visibleEvents.map((event) => {
                                    const style = getEventStyle(event);
                                    return (
                                        <div
                                            key={event.id}
                                            onClick={(e) => { e.stopPropagation(); onEventClick(event.id); }}
                                            title={event.title}
                                            className={`hidden sm:block text-[9px] sm:text-[10px] truncate rounded px-1 py-[1px] sm:py-0.5 cursor-pointer transition-colors font-medium ${style.bg} ${style.text}`}
                                        >
                                            {event.title}
                                        </div>
                                    );
                                })}
                                {visibleEvents.map((event) => {
                                    const dotColor = event.isHoliday
                                        ? 'bg-red-400'
                                        : event.isCourse
                                            ? 'bg-purple-400'
                                            : event.color && EVENT_COLORS[event.color as EventColor]
                                                ? 'bg-brand-400'
                                                : 'bg-brand-400';
                                    return (
                                        <div
                                            key={event.id}
                                            onClick={(e) => { e.stopPropagation(); onEventClick(event.id); }}
                                            className={`sm:hidden flex items-center gap-0.5 cursor-pointer`}
                                        >
                                            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
                                        </div>
                                    );
                                })}
                                {hiddenCount > 0 && (
                                    <span className="text-[9px] sm:text-[10px] text-surface-400 font-medium">
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
            <div className="flex border-b border-surface-100 pb-2 mb-1">
                <div className="w-12 flex-shrink-0" />
                {weekDates.map((date, i) => {
                    const dateStr = dateOnlyLocal(date);
                    const isToday = dateStr === today;
                    return (
                        <div key={i} className="flex-1 text-center py-1 min-w-0">
                            <div className={`text-[10px] font-medium ${isToday ? 'text-brand-500' : 'text-surface-400'}`}>
                                {WEEKDAYS[date.getDay()]}
                            </div>
                            <div className={`text-sm font-semibold mt-0.5 inline-flex items-center justify-center ${isToday ? 'w-7 h-7 rounded-full gradient-bg text-white' : 'text-surface-700'
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
                                className="absolute right-2 text-[10px] text-surface-400 leading-none"
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
                                className="absolute left-0 right-0 border-b border-surface-100"
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
                                    className="flex-1 relative border-l border-surface-100 min-w-0 overflow-hidden"
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
                                                className={`absolute rounded-md px-1 py-0.5 cursor-pointer hover:opacity-80 transition-opacity font-medium text-[10px] overflow-hidden border-l-2 ${style.bg} ${style.text} ${style.border}`}
                                                style={{
                                                    top: pos.top,
                                                    height: pos.height,
                                                    left: `${column * colWidth + 4}%`,
                                                    width: `${colWidth - 6}%`,
                                                }}
                                            >
                                                <div className="truncate font-semibold">{event.title}</div>
                                                {pos.height > 32 && (
                                                    <div className="text-[8px] opacity-70 truncate">
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
                <div className="mb-3 space-y-1">
                    <div className="text-xs text-surface-400 font-medium mb-1.5">全天</div>
                    {allDayEvents.map((event) => {
                        const style = getEventStyle(event);
                        return (
                            <div
                                key={event.id}
                                onClick={() => onEventClick(event.id)}
                                className={`text-sm rounded-lg px-3 py-2 cursor-pointer hover:opacity-80 transition-opacity font-medium border-l-3 ${style.bg} ${style.text} ${style.border}`}
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
                            className="absolute left-0 right-0 border-b border-surface-100"
                            style={{ top: (hour - START_HOUR) * HOUR_HEIGHT }}
                        >
                            <span className="absolute -top-2.5 right-full mr-3 text-[10px] text-surface-400 leading-none">
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
                                    className={`absolute rounded-lg px-2.5 py-1.5 cursor-pointer hover:opacity-80 transition-opacity font-medium text-xs overflow-hidden border-l-3 ${style.bg} ${style.text} ${style.border}`}
                                    style={{
                                        top: pos.top,
                                        height: pos.height,
                                        left: `${column * colWidth + 1}%`,
                                        width: `${colWidth - 2}%`,
                                    }}
                                >
                                    <div className="font-semibold truncate">{event.title}</div>
                                    {pos.height > 36 && (
                                        <div className="text-[10px] opacity-70 mt-0.5">
                                            {new Date(event.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                            {' - '}
                                            {new Date(event.endTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    )}
                                    {pos.height > 60 && event.description && (
                                        <div className="text-[10px] opacity-50 mt-0.5 line-clamp-2">{event.description}</div>
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
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <button
                        onClick={prevPeriod}
                        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-100 text-surface-500 transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <button
                        onClick={nextPeriod}
                        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-100 text-surface-500 transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </button>
                    <h3 className="text-sm font-semibold text-surface-800 ml-1">
                        {getTitle()}
                    </h3>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={goToday}
                        className="text-xs text-brand-500 hover:text-brand-600 font-medium px-2.5 py-1 rounded-lg hover:bg-brand-50 transition-colors"
                    >
                        今天
                    </button>
                    <div className="flex bg-surface-100 dark:bg-surface-800 rounded-lg p-0.5">
                        {viewOptions.map((opt) => (
                            <button
                                key={opt.key}
                                onClick={() => onViewChange(opt.key)}
                                className={`text-xs px-2.5 py-1 rounded-md font-medium transition-all ${view === opt.key
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
