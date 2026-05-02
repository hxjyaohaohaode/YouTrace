import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useEventStore } from '../stores/eventStore';
import { useDiaryStore } from '../stores/diaryStore';
import { useGoalStore } from '../stores/goalStore';
import { useWeatherStore } from '../stores/weatherStore';
import { eventApi } from '../api/event';
import Calendar, { type CalendarView } from '../components/Calendar';
import EventForm from '../components/EventForm';
import type { EventItem, EventColor } from '../types';
import { EVENT_COLORS } from '../types';
import { dateOnlyLocal } from '../utils/date';
import { IconPlus, IconClock } from '../components/Icons';

function CalendarPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { events, fetchEvents, createEvent, updateEvent, deleteEvent } = useEventStore();
  const { diaries, fetchDiaries } = useDiaryStore();
  const { fetchGoals } = useGoalStore();
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);
  const [showConflict, setShowConflict] = useState<{ hasConflict: boolean; conflicts: { title: string }[] } | null>(null);
  const [view, setView] = useState<CalendarView>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [addingHolidays, setAddingHolidays] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showEventDetail, setShowEventDetail] = useState<EventItem | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<string>('');
  const [isLoadingSuggestion, setIsLoadingSuggestion] = useState(false);
  const { currentWeather } = useWeatherStore();

  useEffect(() => {
    const dateParam = searchParams.get('date');
    const eventIdParam = searchParams.get('eventId');
    if (dateParam) {
      const parts = dateParam.split('-');
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        setCurrentDate(d);
        setSelectedDate(d);
        setView('day');
      }
    }
    if (eventIdParam) {
      const ev = events.find((e) => e.id === eventIdParam);
      if (ev) {
        setShowEventDetail(ev);
      }
    }
  }, [searchParams, events]);

  useEffect(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59).toISOString();
    fetchEvents(start, end);
    fetchGoals();
    fetchDiaries(1, 100);
  }, [fetchEvents, fetchGoals, fetchDiaries]);

  const diariesByDate = useMemo(() => {
    const map: Record<string, { emotionTags: string[]; imageCount?: number; thumbnailPaths?: string[] }> = {};
    diaries.forEach((d) => {
      const dateStr = d.createdAt.slice(0, 10);
      if (!map[dateStr]) {
        const attachments = (d as { attachments?: { fileType: string; thumbnailPath: string | null }[] }).attachments || [];
        const imageAttachments = attachments.filter((a) => a.fileType === 'image');
        map[dateStr] = {
          emotionTags: d.emotionTags,
          imageCount: imageAttachments.length,
          thumbnailPaths: imageAttachments.map((a) => a.thumbnailPath).filter(Boolean) as string[],
        };
      }
    });
    return map;
  }, [diaries]);

  const todayEvents = useMemo(() => {
    const today = dateOnlyLocal(new Date());
    return events.filter((e) => {
      const start = e.startTime.slice(0, 10);
      const end = e.endTime.slice(0, 10);
      return today >= start && today <= end;
    });
  }, [events]);

  const tomorrowEvents = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = dateOnlyLocal(tomorrow);
    return events.filter((e) => {
      const start = e.startTime.slice(0, 10);
      const end = e.endTime.slice(0, 10);
      return tomorrowStr >= start && tomorrowStr <= end;
    });
  }, [events]);

  useEffect(() => {
    const generateSuggestion = () => {
      setIsLoadingSuggestion(true);
      try {
        const weather = currentWeather?.now;
        const suggestions: string[] = [];
        if (weather?.text?.includes('雨')) suggestions.push('今天有雨，记得带伞出门！');
        else if (weather && Number(weather.temp) > 35) suggestions.push('今天高温，注意防暑降温，多喝水！');
        else if (weather && Number(weather.temp) < 5) suggestions.push('今天寒冷，注意保暖！');
        if (todayEvents.length > 4) suggestions.push('今日日程较多，注意合理安排休息时间。');
        if (todayEvents.length > 0 && todayEvents.some((e) => !e.isAllDay)) {
          const earliest = todayEvents.filter((e) => !e.isAllDay).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];
          if (earliest) {
            const h = new Date(earliest.startTime).getHours();
            if (h < 8) suggestions.push(`今天最早日程在${h}点，记得早睡早起！`);
          }
        }
        if (suggestions.length === 0) {
          if (todayEvents.length === 0) suggestions.push('今天没有日程安排，可以规划一些有意义的事情！');
          else suggestions.push('保持好心情，合理安排时间！');
        }
        setAiSuggestion(suggestions.join(' '));
      } catch {
        setAiSuggestion('保持好心情，合理安排时间！');
      } finally {
        setIsLoadingSuggestion(false);
      }
    };
    generateSuggestion();
  }, [todayEvents, currentWeather]);

  const selectedDateEvents = useMemo(() => {
    if (!selectedDate) return [];
    const dateStr = dateOnlyLocal(selectedDate);
    return events.filter((e) => {
      const start = e.startTime.slice(0, 10);
      const end = e.endTime.slice(0, 10);
      return dateStr >= start && dateStr <= end;
    });
  }, [events, selectedDate]);

  const selectedDateDiaries = useMemo(() => {
    if (!selectedDate) return [];
    const dateStr = dateOnlyLocal(selectedDate);
    return diaries.filter((d) => d.createdAt.slice(0, 10) === dateStr);
  }, [diaries, selectedDate]);

  const handleDateClick = (date: Date) => {
    setSelectedDate(date);
    if (view === 'month') {
      setCurrentDate(date);
      setView('day');
    }
  };

  const handleEventClick = (eventId: string) => {
    const event = events.find((e) => e.id === eventId);
    if (event) {
      setShowEventDetail(event);
    }
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingEvent(null);
    setShowConflict(null);
  };

  const handleFormSubmit = async (data: {
    title: string; description?: string; startTime: string; endTime: string;
    isAllDay: boolean; color?: string; goalId?: string; reminderMinutes?: number;
    isCourse?: boolean; courseWeekStart?: number; courseWeekEnd?: number; courseDayOfWeek?: number;
    courseStartSec?: number; courseEndSec?: number; courseTeacher?: string; courseLocation?: string;
    courseAdjust?: string; courseWeekType?: string; courseSemesterStart?: string; courseTimeConfig?: string;
  }) => {
    if (editingEvent) {
      await updateEvent(editingEvent.id, data);
      handleFormClose();
    } else {
      const result = await createEvent(data);
      if (result?.hasConflict) {
        setShowConflict({ hasConflict: true, conflicts: result.conflicts.map((c) => ({ title: c.title })) });
      } else {
        handleFormClose();
      }
    }
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59).toISOString();
    fetchEvents(start, end);
  };

  const handleDeleteEvent = async (id: string) => {
    await deleteEvent(id);
    handleFormClose();
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59).toISOString();
    fetchEvents(start, end);
  };

  const handleAddHolidays = async () => {
    setAddingHolidays(true);
    try {
      const year = currentDate.getFullYear();
      const result = await eventApi.addHolidays(year);
      if (result.success) {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
        const end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59).toISOString();
        fetchEvents(start, end);
      }
    } finally {
      setAddingHolidays(false);
    }
  };

  const selectedDateLabel = selectedDate
    ? selectedDate.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
    : '';

  return (
    <div className="page-container">
      <header className="page-header safe-top">
        <div className="md:max-w-3xl lg:max-w-4xl mx-auto px-4 sm:px-8 lg:px-12 py-3 sm:py-4 sm:py-5 flex items-center justify-between">
          <div>
            <h1 className="text-lg sm:text-2xl font-bold text-surface-800 dark:text-surface-100">日程</h1>
            <p className="text-xs text-surface-400 mt-0.5">规划你的每一天</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleAddHolidays}
              disabled={addingHolidays}
              className="btn-secondary flex items-center gap-1.5 text-sm"
            >
              🎌 {addingHolidays ? '添加中...' : '节假日'}
            </button>
            <button
              onClick={() => { setEditingEvent(null); setShowForm(true); }}
              className="btn-primary flex items-center gap-1.5 text-sm"
            >
              <IconPlus size={16} />
              <span className="hidden sm:inline">新建日程</span>
              <span className="sm:hidden">新建</span>
            </button>
          </div>
        </div>
      </header>

      <main className="md:max-w-3xl lg:max-w-4xl mx-auto px-4 sm:px-8 lg:px-12 py-3 sm:py-4">
        <div className="card p-3 sm:p-5 fade-in">
          <Calendar
            events={events}
            view={view}
            currentDate={currentDate}
            onViewChange={setView}
            onDateChange={setCurrentDate}
            onDateClick={handleDateClick}
            onEventClick={handleEventClick}
            diariesByDate={diariesByDate} />
        </div>

        {view === 'month' && todayEvents.length > 0 && !selectedDate && (
          <div className="mt-4 sm:mt-6 fade-in-up">
            <h3 className="text-sm font-semibold text-surface-500 mb-3 flex items-center gap-2">
              <IconClock size={16} className="text-brand-400" />
              今日日程
            </h3>
            <div className="space-y-2">
              {todayEvents.map((event) => (
                <div
                  key={event.id}
                  onClick={() => handleEventClick(event.id)}
                  className="card-hover p-3 sm:p-4 cursor-pointer flex items-center justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      {event.color && (
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${(EVENT_COLORS[event.color as EventColor]?.bg || 'bg-surface-400')}`} />
                      )}
                      <p className="text-sm font-medium text-surface-800 truncate">{event.title}</p>
                    </div>
                    <p className="text-xs text-surface-400 mt-1 ml-5">
                      {event.isAllDay ? '全天' : `${new Date(event.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} - ${new Date(event.endTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                    {event.isAiCreated && (
                      <span className="badge bg-brand-50 dark:bg-brand-950/30 text-brand-600 dark:text-brand-400">AI</span>
                    )}
                    {event.isHoliday && (
                      <span className="badge bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400">
                        {event.holidayType === 'WORKDAY' ? '调休' : '假日'}
                      </span>
                    )}
                    {event.goal && (
                      <span className="badge bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400">{event.goal.title}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === 'month' && tomorrowEvents.length > 0 && !selectedDate && (
          <div className="mt-4 sm:mt-6 fade-in-up">
            <h3 className="text-sm font-semibold text-surface-500 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
              </svg>
              明日日程
            </h3>
            <div className="space-y-2">
              {tomorrowEvents.map((event) => (
                <div
                  key={event.id}
                  onClick={() => handleEventClick(event.id)}
                  className="card-hover p-3 sm:p-4 cursor-pointer flex items-center justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      {event.color && (
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${(EVENT_COLORS[event.color as EventColor]?.bg || 'bg-surface-400')}`} />
                      )}
                      <p className="text-sm font-medium text-surface-800 truncate">{event.title}</p>
                    </div>
                    <p className="text-xs text-surface-400 mt-1 ml-5">
                      {event.isAllDay ? '全天' : `${new Date(event.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} - ${new Date(event.endTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                    {event.isAiCreated && (
                      <span className="badge bg-brand-50 dark:bg-brand-950/30 text-brand-600 dark:text-brand-400">AI</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === 'month' && !selectedDate && (
          <div className="mt-4 p-3 bg-brand-50 dark:bg-brand-950/30 rounded-xl fade-in-up">
            <h4 className="text-sm font-medium text-brand-600 dark:text-brand-400 mb-1.5 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
              </svg>
              AI 建议
            </h4>
            {isLoadingSuggestion ? (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-brand-500">生成建议中...</span>
              </div>
            ) : (
              <p className="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">{aiSuggestion}</p>
            )}
          </div>
        )}

        {selectedDate && (selectedDateEvents.length > 0 || selectedDateDiaries.length > 0) && (
          <div className="mt-4 sm:mt-6 fade-in-up">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-surface-500 flex items-center gap-2">
                <IconClock size={16} className="text-brand-400" />
                {selectedDateLabel}
              </h3>
              <button
                onClick={() => setSelectedDate(null)}
                className="text-xs text-surface-400 hover:text-surface-600"
              >
                收起
              </button>
            </div>

            {selectedDateEvents.length > 0 && (
              <div className="space-y-2 mb-4">
                {selectedDateEvents.map((event) => (
                  <div
                    key={event.id}
                    onClick={() => handleEventClick(event.id)}
                    className="card-hover p-3 sm:p-4 cursor-pointer flex items-center justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        {event.color && (
                          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${(EVENT_COLORS[event.color as EventColor]?.bg || 'bg-surface-400')}`} />
                        )}
                        <p className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">{event.title}</p>
                      </div>
                      <p className="text-xs text-surface-400 mt-1 ml-5">
                        {event.isAllDay ? '全天' : `${new Date(event.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} - ${new Date(event.endTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`}
                      </p>
                      {event.description && (
                        <p className="text-xs text-surface-400 mt-0.5 ml-5 line-clamp-1">{event.description}</p>
                      )}
                      {event.isHoliday && event.holidayDescription && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 ml-5">{event.holidayDescription}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                      {event.isCourse && (
                        <span className="badge bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400">课程</span>
                      )}
                      {event.isHoliday && (
                        <span className="badge bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400">
                          {event.holidayType === 'WORKDAY' ? '⚡调休' : '🎉假日'}
                        </span>
                      )}
                      {event.isAiCreated && (
                        <span className="badge bg-brand-50 dark:bg-brand-950/30 text-brand-600 dark:text-brand-400">AI</span>
                      )}
                      {event.goal && (
                        <span className="badge bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400">{event.goal.title}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selectedDateDiaries.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-surface-400 mb-2 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                  </svg>
                  当天日记
                </h4>
                <div className="space-y-2">
                  {selectedDateDiaries.map((diary) => {
                    const attachments = (diary as { attachments?: { id: string; fileType: string; originalName: string; thumbnailPath: string | null }[] }).attachments || [];
                    const imageAttachments = attachments.filter(a => a.fileType === 'image');
                    return (
                      <div
                        key={diary.id}
                        onClick={() => navigate(`/diary/${diary.id}`)}
                        className="card-hover p-3 cursor-pointer"
                      >
                        <p className="text-sm text-surface-700 dark:text-surface-300 line-clamp-2">{diary.content}</p>
                        {imageAttachments.length > 0 && (
                          <div className="flex gap-1.5 mt-2 overflow-x-auto">
                            {imageAttachments.slice(0, 3).map((att) => (
                              <div key={att.id} className="w-12 h-12 rounded-lg overflow-hidden bg-surface-100 flex-shrink-0 border border-surface-200">
                                <img
                                  src={att.thumbnailPath ? `/api/files/thumbnails/${att.thumbnailPath}` : ''}
                                  alt={att.originalName}
                                  className="w-full h-full object-cover"
                                  onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                                />
                              </div>
                            ))}
                            {imageAttachments.length > 3 && (
                              <div className="w-12 h-12 rounded-lg bg-surface-100 flex items-center justify-center flex-shrink-0 text-xs text-surface-400">
                                +{imageAttachments.length - 3}
                              </div>
                            )}
                          </div>
                        )}
                        {attachments.filter(a => a.fileType !== 'image').length > 0 && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            {attachments.filter(a => a.fileType !== 'image').slice(0, 3).map((att) => (
                              <span key={att.id} className="text-2xs text-surface-400 bg-surface-100 dark:bg-surface-800 px-1.5 py-0.5 rounded">
                                {att.fileType === 'video' ? '🎬' : att.fileType === 'audio' ? '🎵' : '📄'} {att.originalName}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {view !== 'month' && events.length > 0 && !selectedDate && (
          <div className="mt-4 sm:mt-6 fade-in-up">
            <h3 className="text-sm font-semibold text-surface-500 mb-3">近期日程</h3>
            <div className="space-y-2">
              {events.filter((e) => new Date(e.startTime) >= new Date()).slice(0, 5).map((event) => (
                <div
                  key={event.id}
                  onClick={() => handleEventClick(event.id)}
                  className="card-hover p-3 sm:p-4 cursor-pointer flex items-center justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      {event.color && (
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${(EVENT_COLORS[event.color as EventColor]?.bg || 'bg-surface-400')}`} />
                      )}
                      <p className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">{event.title}</p>
                    </div>
                    <p className="text-xs text-surface-400 mt-1 ml-5">
                      {new Date(event.startTime).toLocaleDateString('zh-CN')} {event.isAllDay ? '全天' : `${new Date(event.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} - ${new Date(event.endTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                    {event.isAiCreated && (
                      <span className="badge bg-brand-50 dark:bg-brand-950/30 text-brand-600 dark:text-brand-400">AI</span>
                    )}
                    {event.goal && (
                      <span className="badge bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400">{event.goal.title}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {showForm && (
        <div className="overlay" onClick={handleFormClose}>
          <div className="overlay-content" onClick={(e) => e.stopPropagation()}>
            <div className="overlay-handle" />
            <EventForm
              event={editingEvent || undefined}
              onSubmit={handleFormSubmit}
              onDelete={editingEvent ? () => handleDeleteEvent(editingEvent.id) : undefined}
              onCancel={handleFormClose} />
          </div>
        </div>
      )}

      {showConflict && (
        <div className="overlay" onClick={() => setShowConflict(null)}>
          <div className="bg-white dark:bg-surface-900 rounded-2xl p-6 max-w-sm mx-4 scale-in" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-orange-600 dark:text-orange-400 mb-2 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
              时间冲突
            </h3>
            <p className="text-surface-500 dark:text-surface-400 text-sm mb-3">以下日程与新建日程时间冲突：</p>
            <ul className="space-y-1.5 mb-5">
              {showConflict.conflicts.map((c, i) => (
                <li key={i} className="text-sm text-surface-700 dark:text-surface-300 bg-orange-50 dark:bg-orange-950/30 rounded-lg px-3 py-2">• {c.title}</li>
              ))}
            </ul>
            <div className="flex gap-3">
              <button onClick={() => setShowConflict(null)} className="btn-secondary flex-1 py-2.5 text-sm">知道了</button>
              <button onClick={handleFormClose} className="btn-primary flex-1 py-2.5 text-sm">确认保存</button>
            </div>
          </div>
        </div>
      )}

      {showEventDetail && (
        <div className="overlay" onClick={() => setShowEventDetail(null)}>
          <div className="overlay-content" onClick={(e) => e.stopPropagation()}>
            <div className="overlay-handle" />
            <div className="p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  {showEventDetail.color && (
                    <div className={`w-3 h-3 rounded-full ${(EVENT_COLORS[showEventDetail.color as EventColor]?.bg || 'bg-surface-400')}`} />
                  )}
                  <h3 className="text-lg font-semibold text-surface-800 dark:text-surface-100">{showEventDetail.title}</h3>
                </div>
                <button onClick={() => setShowEventDetail(null)} className="text-surface-400 hover:text-surface-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="space-y-3 mb-5">
                <div className="flex items-center gap-2.5 text-sm text-surface-600 dark:text-surface-300">
                  <svg className="w-4 h-4 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {showEventDetail.isAllDay
                    ? `全天 · ${new Date(showEventDetail.startTime).toLocaleDateString('zh-CN')}`
                    : `${new Date(showEventDetail.startTime).toLocaleDateString('zh-CN')} ${new Date(showEventDetail.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} - ${new Date(showEventDetail.endTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
                  }
                </div>

                {showEventDetail.description && (
                  <p className="text-sm text-surface-500 leading-relaxed">{showEventDetail.description}</p>
                )}

                {showEventDetail.isCourse && (
                  <div className="space-y-1.5">
                    {showEventDetail.courseTeacher && (
                      <div className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-300">
                        <span className="text-surface-400">👨‍🏫</span>
                        教师：{showEventDetail.courseTeacher}
                      </div>
                    )}
                    {showEventDetail.courseLocation && (
                      <div className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-300">
                        <span className="text-surface-400">📍</span>
                        教室：{showEventDetail.courseLocation}
                      </div>
                    )}
                  </div>
                )}

                {showEventDetail.isHoliday && showEventDetail.holidayDescription && (
                  <p className="text-sm text-amber-600 dark:text-amber-400">{showEventDetail.holidayDescription}</p>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {showEventDetail.isCourse && (
                    <span className="badge bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400">课程</span>
                  )}
                  {showEventDetail.isHoliday && (
                    <span className="badge bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400">
                      {showEventDetail.holidayType === 'WORKDAY' ? '⚡调休' : '🎉假日'}
                    </span>
                  )}
                  {showEventDetail.isAiCreated && (
                    <span className="badge bg-brand-50 dark:bg-brand-950/30 text-brand-600 dark:text-brand-400">AI创建</span>
                  )}
                  {showEventDetail.goal && (
                    <span className="badge bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400">{showEventDetail.goal.title}</span>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setEditingEvent(showEventDetail);
                    setShowEventDetail(null);
                    setShowForm(true);
                  }}
                  className="btn-secondary flex-1 py-2.5 text-sm"
                >
                  编辑
                </button>
                <button
                  onClick={() => setShowEventDetail(null)}
                  className="btn-primary flex-1 py-2.5 text-sm"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CalendarPage;
