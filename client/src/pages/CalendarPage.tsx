import { useEffect, useState, useMemo } from 'react';
import { useEventStore } from '../stores/eventStore';
import { useDiaryStore } from '../stores/diaryStore';
import { useGoalStore } from '../stores/goalStore';
import { eventApi } from '../api/event';
import Calendar, { type CalendarView } from '../components/Calendar';
import EventForm from '../components/EventForm';
import type { EventItem, EventColor } from '../types';
import { EVENT_COLORS } from '../types';
import { dateOnlyLocal } from '../utils/date';
import { IconPlus, IconClock } from '../components/Icons';

function CalendarPage() {
  const { events, fetchEvents, createEvent, updateEvent, deleteEvent } = useEventStore();
  const { diaries, fetchDiaries } = useDiaryStore();
  const { fetchGoals } = useGoalStore();
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);
  const [showConflict, setShowConflict] = useState<{ hasConflict: boolean; conflicts: { title: string }[] } | null>(null);
  const [view, setView] = useState<CalendarView>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [addingHolidays, setAddingHolidays] = useState(false);

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

  const handleDateClick = (date: Date) => {
    if (view === 'month') {
      setCurrentDate(date);
      setView('day');
    } else {
      setEditingEvent(null);
      setShowForm(true);
    }
  };

  const handleEventClick = (eventId: string) => {
    const event = events.find((e) => e.id === eventId);
    if (event) {
      setEditingEvent(event);
      setShowForm(true);
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
    courseAdjust?: string;
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

  return (
    <div className="page-container">
      <header className="page-header safe-top">
        <div className="max-w-3xl lg:max-w-4xl mx-auto px-5 sm:px-8 lg:px-12 py-4 sm:py-5 flex items-center justify-between">
          <div>
            <h1 className="text-lg sm:text-2xl font-bold text-surface-800 dark:text-surface-100">日程</h1>
            <p className="text-xs text-surface-400 mt-0.5">规划你的每一天</p>
          </div>
          <button
            onClick={() => { setEditingEvent(null); setShowForm(true); }}
            className="btn-primary flex items-center gap-1.5 text-sm"
          >
            <IconPlus size={16} />
            <span className="hidden sm:inline">新建日程</span>
            <span className="sm:hidden">新建</span>
          </button>
          <button
            onClick={handleAddHolidays}
            disabled={addingHolidays}
            className="btn-secondary flex items-center gap-1.5 text-sm ml-2"
          >
            🎌 {addingHolidays ? '添加中...' : '节假日'}
          </button>
        </div>
      </header>

      <main className="max-w-3xl lg:max-w-4xl mx-auto px-5 sm:px-8 lg:px-12 py-4">
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

        {view === 'month' && todayEvents.length > 0 && (
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
                    {event.goal && (
                      <span className="badge bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400">{event.goal.title}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view !== 'month' && events.length > 0 && (
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
    </div>
  );
}

export default CalendarPage;
