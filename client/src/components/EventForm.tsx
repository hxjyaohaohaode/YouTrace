import { useState } from 'react';
import type { EventItem, EventColor } from '../types';
import { EVENT_COLORS } from '../types';
interface EventFormProps {
    event?: EventItem;
    onSubmit: (data: {
        title: string;
        description?: string;
        startTime: string;
        endTime: string;
        isAllDay: boolean;
        color?: string;
        goalId?: string;
        reminderMinutes?: number;
        isCourse?: boolean;
        courseWeekStart?: number;
        courseWeekEnd?: number;
        courseDayOfWeek?: number;
        courseStartSec?: number;
        courseEndSec?: number;
        courseTeacher?: string;
        courseLocation?: string;
        courseAdjust?: string;
    }) => void;
    onDelete?: () => void;
    onCancel: () => void;
}

function EventForm({ event, onSubmit, onDelete, onCancel }: EventFormProps) {
    const [title, setTitle] = useState(event?.title || '');
    const [description, setDescription] = useState(event?.description || '');
    const [startTime, setStartTime] = useState(event?.startTime ? new Date(event.startTime).toISOString().slice(0, 16) : '');
    const [endTime, setEndTime] = useState(event?.endTime ? new Date(event.endTime).toISOString().slice(0, 16) : '');
    const [isAllDay, setIsAllDay] = useState(event?.isAllDay || false);
    const [color, setColor] = useState<EventColor | ''>(event?.color as EventColor || '');
    const [reminderMinutes, setReminderMinutes] = useState(event?.reminderMinutes || 0);
    const [isCourse, setIsCourse] = useState(event?.isCourse || false);
    const [courseWeekStart, setCourseWeekStart] = useState(event?.courseWeekStart || 1);
    const [courseWeekEnd, setCourseWeekEnd] = useState(event?.courseWeekEnd || 16);
    const [courseDayOfWeek, setCourseDayOfWeek] = useState(event?.courseDayOfWeek || 1);
    const [courseStartSec, setCourseStartSec] = useState(event?.courseStartSec || 1);
    const [courseEndSec, setCourseEndSec] = useState(event?.courseEndSec || 2);
    const [courseTeacher, setCourseTeacher] = useState(event?.courseTeacher || '');
    const [courseLocation, setCourseLocation] = useState(event?.courseLocation || '');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim() || !startTime || !endTime) return;
        onSubmit({
            title: title.trim(),
            description: description.trim() || undefined,
            startTime,
            endTime,
            isAllDay,
            color: color || undefined,
            reminderMinutes,
            isCourse: isCourse || undefined,
            courseWeekStart: isCourse ? courseWeekStart : undefined,
            courseWeekEnd: isCourse ? courseWeekEnd : undefined,
            courseDayOfWeek: isCourse ? courseDayOfWeek : undefined,
            courseStartSec: isCourse ? courseStartSec : undefined,
            courseEndSec: isCourse ? courseEndSec : undefined,
            courseTeacher: isCourse ? courseTeacher.trim() || undefined : undefined,
            courseLocation: isCourse ? courseLocation.trim() || undefined : undefined,
        });
    };

    return (
        <form onSubmit={handleSubmit} className="p-6">
            <h3 className="text-lg font-semibold text-surface-800 mb-5">
                {event ? '编辑日程' : '新建日程'}
            </h3>

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-surface-600 mb-2">标题</label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="日程标题"
                        className="input-field"
                        required
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-surface-600 mb-2">描述（可选）</label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="日程描述"
                        rows={2}
                        className="input-field resize-y" />
                </div>

                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => setIsAllDay(!isAllDay)}
                        className={`relative w-10 h-6 rounded-full transition-colors duration-200 ${isAllDay ? 'bg-brand-500' : 'bg-surface-200'}`}
                    >
                        <div
                            className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${isAllDay ? 'translate-x-4' : 'translate-x-1'}`} />
                    </button>
                    <label className="text-sm text-surface-600 font-medium">全天事件</label>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => setIsCourse(!isCourse)}
                        className={`relative w-10 h-6 rounded-full transition-colors duration-200 ${isCourse ? 'bg-purple-500' : 'bg-surface-200'}`}
                    >
                        <div
                            className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${isCourse ? 'translate-x-4' : 'translate-x-1'}`} />
                    </button>
                    <label className="text-sm text-surface-600 font-medium">课程日程</label>
                </div>

                {isCourse && (
                    <div className="space-y-3 p-4 bg-purple-50 dark:bg-purple-950/20 rounded-xl">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-surface-600 mb-1">起始周</label>
                                <input
                                    type="number"
                                    value={courseWeekStart}
                                    onChange={(e) => setCourseWeekStart(Number(e.target.value))}
                                    min={1}
                                    max={30}
                                    className="input-field text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-surface-600 mb-1">结束周</label>
                                <input
                                    type="number"
                                    value={courseWeekEnd}
                                    onChange={(e) => setCourseWeekEnd(Number(e.target.value))}
                                    min={1}
                                    max={30}
                                    className="input-field text-sm"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-surface-600 mb-1">星期</label>
                            <select
                                value={courseDayOfWeek}
                                onChange={(e) => setCourseDayOfWeek(Number(e.target.value))}
                                className="input-field text-sm"
                            >
                                <option value={1}>周一</option>
                                <option value={2}>周二</option>
                                <option value={3}>周三</option>
                                <option value={4}>周四</option>
                                <option value={5}>周五</option>
                                <option value={6}>周六</option>
                                <option value={7}>周日</option>
                            </select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-surface-600 mb-1">开始节次</label>
                                <select
                                    value={courseStartSec}
                                    onChange={(e) => setCourseStartSec(Number(e.target.value))}
                                    className="input-field text-sm"
                                >
                                    {Array.from({ length: 12 }, (_, i) => (
                                        <option key={i + 1} value={i + 1}>第{i + 1}节</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-surface-600 mb-1">结束节次</label>
                                <select
                                    value={courseEndSec}
                                    onChange={(e) => setCourseEndSec(Number(e.target.value))}
                                    className="input-field text-sm"
                                >
                                    {Array.from({ length: 12 }, (_, i) => (
                                        <option key={i + 1} value={i + 1}>第{i + 1}节</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-surface-600 mb-1">教师</label>
                            <input
                                type="text"
                                value={courseTeacher}
                                onChange={(e) => setCourseTeacher(e.target.value)}
                                placeholder="教师姓名"
                                className="input-field text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-surface-600 mb-1">教室</label>
                            <input
                                type="text"
                                value={courseLocation}
                                onChange={(e) => setCourseLocation(e.target.value)}
                                placeholder="上课地点"
                                className="input-field text-sm"
                            />
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-sm font-medium text-surface-600 mb-2">开始时间</label>
                        <input
                            type={isAllDay ? 'date' : 'datetime-local'}
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            className="input-field"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-surface-600 mb-2">结束时间</label>
                        <input
                            type={isAllDay ? 'date' : 'datetime-local'}
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                            className="input-field"
                            required
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-surface-600 mb-2">分类颜色</label>
                    <div className="flex gap-2 flex-wrap">
                        <button
                            type="button"
                            onClick={() => setColor('')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${color === '' ? 'bg-surface-600 text-white shadow-sm' : 'bg-surface-100 text-surface-500'
                                }`}
                        >
                            默认
                        </button>
                        {(Object.entries(EVENT_COLORS) as [EventColor, typeof EVENT_COLORS[EventColor]][]).map(([key, val]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setColor(key)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${val.bg} ${val.text} ${color === key ? 'ring-2 ring-offset-2 ring-brand-400' : ''
                                    }`}
                            >
                                {val.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-surface-600 mb-2">提前提醒</label>
                    <select
                        value={reminderMinutes}
                        onChange={(e) => setReminderMinutes(Number(e.target.value))}
                        className="input-field"
                    >
                        <option value={0}>不提醒</option>
                        <option value={5}>5分钟前</option>
                        <option value={15}>15分钟前</option>
                        <option value={30}>30分钟前</option>
                        <option value={60}>1小时前</option>
                        <option value={1440}>1天前</option>
                    </select>
                </div>
            </div>

            <div className="flex gap-3 mt-7">
                <button
                    type="button"
                    onClick={onCancel}
                    className="btn-secondary flex-1 py-2.5 text-sm"
                >
                    取消
                </button>
                {event && onDelete && (
                    <button
                        type="button"
                        onClick={onDelete}
                        className="px-4 py-2.5 text-sm text-red-500 dark:text-red-400 font-medium rounded-xl hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                        删除
                    </button>
                )}
                <button
                    type="submit"
                    disabled={!title.trim() || !startTime || !endTime}
                    className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-50"
                >
                    {event ? '更新' : '创建'}
                </button>
            </div>
        </form>
    );
}

export default EventForm;
