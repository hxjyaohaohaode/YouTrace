import { useMemo } from 'react';
import type { EventItem } from '../types';
import { getDaysInMonth, getFirstDayOfMonth, dateOnlyLocal } from '../utils/date';
import { EmotionIcon, type EmotionIconName } from '../utils/emotion';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAYS_FULL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

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
        const startDate = new Date(start);
        const endDate = new Date(end);
        const d = new Date(startDate);
        while (d <= endDate) {
            const key = d.toISOString().slice(0, 10);
            const list = map.get(key) || [];
            list.push(e);
            map.set(key, list);
            d.setDate(d.getDate() + 1);
        }
    }
    return map;
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
        <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((day) => (
                <div key={day} className="py-2 text-center text-xs font-semibold text-surface-400">
                    {day}
                </div>
            ))}

            {days.map((day, i) => {
                if (day === null) {
                    return <div key={`empty-${i}`} className="min-h-[72px]" />;
                }

                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isToday = dateStr === today;
                const dayEvents = eventsByDate.get(dateStr) || [];
                const diaryInfo = diariesByDate[dateStr];

                return (
                    <div
                        key={day}
                        onClick={() => onDateClick(new Date(year, month, day))}
                        className={`min-h-[72px] p-1.5 rounded-xl cursor-pointer transition-colors ${isToday
                            ? 'bg-brand-50 ring-1 ring-inset ring-brand-200'
                            : 'hover:bg-surface-50'
                            }`}
                    >
                        <div className="flex items-center justify-between">
                            <span className={`text-xs font-semibold inline-flex items-center justify-center ${isToday
                                ? 'w-6 h-6 rounded-full gradient-bg text-white'
                                : 'text-surface-600'
                                }`}>
                                {day}
                            </span>
                            {diaryInfo && diaryInfo.emotionTags.length > 0 && (
                                <EmotionIcon emotion={diaryInfo.emotionTags[0] as EmotionIconName} className="w-3 h-3 opacity-60" />
                            )}
                        </div>
                        <div className="mt-0.5 space-y-0.5">
                            {diaryInfo && diaryInfo.imageCount && diaryInfo.imageCount > 0 && diaryInfo.thumbnailPaths && diaryInfo.thumbnailPaths.length > 0 && (
                                <div className="flex gap-0.5 mt-0.5">
                                    {diaryInfo.thumbnailPaths.slice(0, 2).map((thumb, ti) => (
                                        <img
                                            key={ti}
                                            src={`/api/files/${thumb}`}
                                            alt=""
                                            className="w-6 h-6 rounded object-cover border border-surface-200"
                                            loading="lazy"
                                        />
                                    ))}
                                    {diaryInfo.imageCount > 2 && (
                                        <span className="text-[8px] text-surface-400 flex items-center">+{diaryInfo.imageCount - 2}</span>
                                    )}
                                </div>
                            )}
                            {dayEvents.filter(e => e.isHoliday).map((event) => (
                                <div
                                    key={event.id}
                                    onClick={(e) => { e.stopPropagation(); onEventClick(event.id); }}
                                    className="text-[10px] truncate rounded-md px-1.5 py-0.5 bg-red-100/80 text-red-600 cursor-pointer transition-colors font-medium"
                                >
                                    🎌 {event.title}
                                </div>
                            ))}
                            {dayEvents.filter(e => e.isCourse).slice(0, 2).map((event) => (
                                <div
                                    key={event.id}
                                    onClick={(e) => { e.stopPropagation(); onEventClick(event.id); }}
                                    className="text-[10px] truncate rounded-md px-1.5 py-0.5 bg-purple-100/80 text-purple-700 cursor-pointer transition-colors font-medium"
                                >
                                    📚 {event.title}
                                </div>
                            ))}
                            {dayEvents.filter(e => !e.isHoliday && !e.isCourse).slice(0, 2).map((event) => (
                                <div
                                    key={event.id}
                                    onClick={(e) => { e.stopPropagation(); onEventClick(event.id); }}
                                    className="text-[10px] truncate rounded-md px-1.5 py-0.5 bg-brand-100/80 text-brand-700 hover:bg-brand-200 cursor-pointer transition-colors font-medium"
                                >
                                    {event.title}
                                </div>
                            ))}
                            {dayEvents.length > 2 + dayEvents.filter(e => e.isHoliday).length && (
                                <span className="text-[10px] text-surface-400 font-medium">+{dayEvents.length - 2}更多</span>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function WeekView({ events, currentDate, onDateClick, onEventClick }: Omit<CalendarProps, 'view' | 'onViewChange' | 'onDateChange' | 'diariesByDate'>) {
    const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate]);
    const today = dateOnlyLocal(new Date());
    const eventsByDate = useMemo(() => buildEventsByDateMap(events), [events]);

    return (
        <div className="overflow-x-auto">
            <div className="min-w-[640px]">
                <div className="grid grid-cols-8 border-b border-surface-100 pb-2 mb-1">
                    <div className="text-xs text-surface-400 font-medium text-center py-1 w-12" />
                    {weekDates.map((date, i) => {
                        const dateStr = dateOnlyLocal(date);
                        const isToday = dateStr === today;
                        return (
                            <div key={i} className="text-center py-1">
                                <div className={`text-xs font-medium ${isToday ? 'text-brand-500' : 'text-surface-400'}`}>
                                    {WEEKDAYS_FULL[date.getDay()]}
                                </div>
                                <div className={`text-sm font-semibold mt-0.5 inline-flex items-center justify-center ${isToday ? 'w-7 h-7 rounded-full gradient-bg text-white' : 'text-surface-700'
                                    }`}>
                                    {date.getDate()}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="max-h-[400px] overflow-y-auto">
                    {HOURS.filter((h) => h >= 6 && h <= 23).map((hour) => (
                        <div key={hour} className="grid grid-cols-8 border-b border-surface-50 min-h-[40px]">
                            <div className="text-2xs text-surface-400 text-right pr-2 pt-1 w-12">
                                {String(hour).padStart(2, '0')}:00
                            </div>
                            {weekDates.map((date, i) => {
                                const dateStr = dateOnlyLocal(date);
                                const dayEvents = eventsByDate.get(dateStr) || [];
                                const hourEvents = dayEvents.filter((e) => {
                                    const startHour = new Date(e.startTime).getHours();
                                    return startHour === hour;
                                });

                                return (
                                    <div
                                        key={i}
                                        className="border-l border-surface-50 px-0.5 py-0.5 cursor-pointer hover:bg-surface-50 transition-colors"
                                        onClick={() => onDateClick(new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour))}
                                    >
                                        {hourEvents.map((event) => (
                                            <div
                                                key={event.id}
                                                onClick={(e) => { e.stopPropagation(); onEventClick(event.id); }}
                                                className="text-[10px] truncate rounded px-1 py-0.5 bg-brand-100/80 text-brand-700 cursor-pointer hover:bg-brand-200 transition-colors font-medium"
                                            >
                                                {event.title}
                                            </div>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
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

    return (
        <div>
            {allDayEvents.length > 0 && (
                <div className="mb-3 space-y-1">
                    <div className="text-xs text-surface-400 font-medium mb-1.5">全天</div>
                    {allDayEvents.map((event) => (
                        <div
                            key={event.id}
                            onClick={() => onEventClick(event.id)}
                            className="text-sm rounded-lg px-3 py-2 bg-brand-100/80 text-brand-700 cursor-pointer hover:bg-brand-200 transition-colors font-medium"
                        >
                            {event.title}
                        </div>
                    ))}
                </div>
            )}

            <div className="max-h-[400px] overflow-y-auto">
                {HOURS.filter((h) => h >= 6 && h <= 23).map((hour) => {
                    const hourEvents = timedEvents.filter((e) => new Date(e.startTime).getHours() === hour);

                    return (
                        <div key={hour} className="flex border-b border-surface-50 min-h-[48px]">
                            <div className="text-2xs text-surface-400 text-right pr-3 pt-1.5 w-14 flex-shrink-0">
                                {String(hour).padStart(2, '0')}:00
                            </div>
                            <div
                                className="flex-1 py-1 px-1 cursor-pointer hover:bg-surface-50 transition-colors rounded"
                                onClick={() => onDateClick(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), hour))}
                            >
                                {hourEvents.map((event) => (
                                    <div
                                        key={event.id}
                                        onClick={(e) => { e.stopPropagation(); onEventClick(event.id); }}
                                        className="text-xs rounded-lg px-3 py-2 mb-1 bg-brand-100/80 text-brand-700 cursor-pointer hover:bg-brand-200 transition-colors font-medium"
                                    >
                                        <div className="font-semibold">{event.title}</div>
                                        <div className="text-brand-500 mt-0.5">
                                            {new Date(event.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                            {' - '}
                                            {new Date(event.endTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
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
