import { useState, useEffect, useCallback } from 'react';
import type { EventItem, EventColor } from '../types';
import { EVENT_COLORS } from '../types';

const DEFAULT_SECTION_TIMES = [
    { start: '08:00', end: '08:45' },
    { start: '08:55', end: '09:40' },
    { start: '10:00', end: '10:45' },
    { start: '10:55', end: '11:40' },
    { start: '14:00', end: '14:45' },
    { start: '14:55', end: '15:40' },
    { start: '16:00', end: '16:45' },
    { start: '16:55', end: '17:40' },
    { start: '19:00', end: '19:45' },
    { start: '19:55', end: '20:40' },
    { start: '20:50', end: '21:35' },
    { start: '21:45', end: '22:30' },
];

interface SectionTimeConfig {
    start: string;
    end: string;
}

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
        courseWeekType?: string;
        courseSemesterStart?: string;
        courseTimeConfig?: string;
    }) => void;
    onDelete?: () => void;
    onCancel: () => void;
}

function parseTimeConfig(json: string): SectionTimeConfig[] {
    try {
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].start && parsed[0].end) {
            return parsed;
        }
    } catch { /* ignore */ }
    return DEFAULT_SECTION_TIMES;
}

function formatLocalDateTime(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
}

function EventForm({ event, onSubmit, onDelete, onCancel }: EventFormProps) {
    const [title, setTitle] = useState(event?.title || '');
    const [description, setDescription] = useState(event?.description || '');
    const [startTime, setStartTime] = useState(event?.startTime ? formatLocalDateTime(new Date(event.startTime)) : '');
    const [endTime, setEndTime] = useState(event?.endTime ? formatLocalDateTime(new Date(event.endTime)) : '');
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
    const [courseWeekType, setCourseWeekType] = useState<string>(event?.courseWeekType || 'ALL');
    const [courseSemesterStart, setCourseSemesterStart] = useState(event?.courseSemesterStart || '');
    const [sectionTimes, setSectionTimes] = useState<SectionTimeConfig[]>(
        parseTimeConfig(event?.courseTimeConfig || '{}')
    );
    const [sectionDuration, setSectionDuration] = useState(45);
    const [breakDuration, setBreakDuration] = useState(10);
    const [showTimeConfig, setShowTimeConfig] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const autoGenerateSectionTimes = (firstClassStart: string, duration: number, breakMin: number, bigBreakAfter: number[], bigBreakMin: number) => {
        const times: SectionTimeConfig[] = [];
        const [startH, startM] = firstClassStart.split(':').map(Number);
        let currentMinutes = startH * 60 + startM;

        for (let i = 0; i < 12; i++) {
            const startMin = currentMinutes;
            const endMin = currentMinutes + duration;
            times.push({
                start: `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`,
                end: `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`,
            });
            const isBigBreak = bigBreakAfter.includes(i + 1);
            currentMinutes = endMin + (isBigBreak ? bigBreakMin : breakMin);
        }
        setSectionTimes(times);
    };

    const computeCourseTime = useCallback(() => {
        if (!courseSemesterStart) return;
        const startIdx = Math.max(0, courseStartSec - 1);
        const endIdx = Math.max(0, courseEndSec - 1);
        if (startIdx >= sectionTimes.length || endIdx >= sectionTimes.length) return;

        const semesterStartDate = new Date(courseSemesterStart + 'T00:00:00');
        const startDay = semesterStartDate.getDay();
        const startDayMon = startDay === 0 ? 7 : startDay;
        const offsetToMonday = 1 - startDayMon;
        const mondayOfWeek1 = new Date(semesterStartDate.getTime() + offsetToMonday * 86400000);

        const computeDateForWeek = (week: number) => {
            const targetOffset = (week - 1) * 7 + (courseDayOfWeek - 1);
            return new Date(mondayOfWeek1.getTime() + targetOffset * 86400000);
        };

        const firstWeekDate = computeDateForWeek(courseWeekStart);
        const [sh, sm] = sectionTimes[startIdx].start.split(':').map(Number);
        const [eh, em] = sectionTimes[endIdx].end.split(':').map(Number);

        const computedStart = new Date(firstWeekDate.getFullYear(), firstWeekDate.getMonth(), firstWeekDate.getDate(), sh, sm);
        const computedEnd = new Date(firstWeekDate.getFullYear(), firstWeekDate.getMonth(), firstWeekDate.getDate(), eh, em);

        setStartTime(formatLocalDateTime(computedStart));
        setEndTime(formatLocalDateTime(computedEnd));
    }, [courseSemesterStart, courseStartSec, courseEndSec, courseDayOfWeek, courseWeekStart, sectionTimes]);

    useEffect(() => {
        if (isCourse && courseSemesterStart) {
            computeCourseTime();
        }
    }, [isCourse, courseSemesterStart, computeCourseTime]);

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
            courseWeekType: isCourse ? courseWeekType : undefined,
            courseSemesterStart: isCourse ? courseSemesterStart || undefined : undefined,
            courseTimeConfig: isCourse ? JSON.stringify(sectionTimes) : undefined,
        });
    };

    return (
        <form onSubmit={handleSubmit} className="p-4 sm:p-6">
            <h3 className="text-lg font-semibold text-surface-800 dark:text-surface-100 mb-5">
                {event ? '编辑日程' : '新建日程'}
            </h3>

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-surface-600 dark:text-surface-300 mb-1.5">标题</label>
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
                    <label className="block text-sm font-medium text-surface-600 dark:text-surface-300 mb-1.5">描述（可选）</label>
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
                    <label className="text-sm text-surface-600 dark:text-surface-300 font-medium">全天事件</label>
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
                    <label className="text-sm text-surface-600 dark:text-surface-300 font-medium">课程日程</label>
                </div>

                {isCourse && (
                    <div className="space-y-3 p-3 sm:p-4 bg-purple-50 dark:bg-purple-950/20 rounded-xl">
                        <div>
                            <label className="block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">学期开始日期</label>
                            <input
                                type="date"
                                value={courseSemesterStart}
                                onChange={(e) => setCourseSemesterStart(e.target.value)}
                                className="input-field text-sm"
                            />
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                            <div>
                                <label className="block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">起始周</label>
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
                                <label className="block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">结束周</label>
                                <input
                                    type="number"
                                    value={courseWeekEnd}
                                    onChange={(e) => setCourseWeekEnd(Number(e.target.value))}
                                    min={1}
                                    max={30}
                                    className="input-field text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">周次类型</label>
                                <select
                                    value={courseWeekType}
                                    onChange={(e) => setCourseWeekType(e.target.value)}
                                    className="input-field text-sm"
                                >
                                    <option value="ALL">每周</option>
                                    <option value="ODD">单周</option>
                                    <option value="EVEN">双周</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">星期</label>
                            <div className="grid grid-cols-7 gap-1">
                                {['一', '二', '三', '四', '五', '六', '日'].map((d, i) => (
                                    <button
                                        key={d}
                                        type="button"
                                        onClick={() => setCourseDayOfWeek(i + 1)}
                                        className={`py-1.5 rounded-lg text-xs font-medium transition-all ${courseDayOfWeek === i + 1
                                            ? 'bg-purple-500 text-white shadow-sm'
                                            : 'bg-white dark:bg-surface-800 text-surface-500 dark:text-surface-400 border border-surface-200 dark:border-surface-700'
                                            }`}
                                    >
                                        {d}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">开始节次</label>
                                <select
                                    value={courseStartSec}
                                    onChange={(e) => setCourseStartSec(Number(e.target.value))}
                                    className="input-field text-sm"
                                >
                                    {sectionTimes.map((sec, i) => (
                                        <option key={i} value={i + 1}>第{i + 1}节 ({sec.start})</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">结束节次</label>
                                <select
                                    value={courseEndSec}
                                    onChange={(e) => setCourseEndSec(Number(e.target.value))}
                                    className="input-field text-sm"
                                >
                                    {sectionTimes.map((sec, i) => (
                                        <option key={i} value={i + 1}>第{i + 1}节 ({sec.end})</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">教师</label>
                                <input
                                    type="text"
                                    value={courseTeacher}
                                    onChange={(e) => setCourseTeacher(e.target.value)}
                                    placeholder="教师姓名"
                                    className="input-field text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">教室</label>
                                <input
                                    type="text"
                                    value={courseLocation}
                                    onChange={(e) => setCourseLocation(e.target.value)}
                                    placeholder="上课地点"
                                    className="input-field text-sm"
                                />
                            </div>
                        </div>

                        <div className="border-t border-purple-200 dark:border-purple-800 pt-2">
                            <button
                                type="button"
                                onClick={() => setShowTimeConfig(!showTimeConfig)}
                                className="flex items-center gap-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700"
                            >
                                <svg className={`w-3.5 h-3.5 transition-transform ${showTimeConfig ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                                自定义上课时间配置
                            </button>
                        </div>

                        {showTimeConfig && (
                            <div className="space-y-3 p-3 bg-white dark:bg-surface-800 rounded-lg border border-purple-200 dark:border-purple-800">
                                <p className="text-2xs text-surface-400">配置每节课的时长和课间休息时间，系统会自动计算各节次的时间</p>

                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="block text-2xs font-medium text-surface-500 mb-1">第一节课开始时间</label>
                                        <input
                                            type="time"
                                            value={sectionTimes[0]?.start || '08:00'}
                                            onChange={(e) => {
                                                autoGenerateSectionTimes(e.target.value, sectionDuration, breakDuration, [4, 8], 20);
                                            }}
                                            className="input-field text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-2xs font-medium text-surface-500 mb-1">每节课时长(分钟)</label>
                                        <input
                                            type="number"
                                            value={sectionDuration}
                                            onChange={(e) => {
                                                const d = Number(e.target.value);
                                                setSectionDuration(d);
                                                autoGenerateSectionTimes(sectionTimes[0]?.start || '08:00', d, breakDuration, [4, 8], 20);
                                            }}
                                            min={20}
                                            max={120}
                                            className="input-field text-sm"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="block text-2xs font-medium text-surface-500 mb-1">课间休息(分钟)</label>
                                        <input
                                            type="number"
                                            value={breakDuration}
                                            onChange={(e) => {
                                                const b = Number(e.target.value);
                                                setBreakDuration(b);
                                                autoGenerateSectionTimes(sectionTimes[0]?.start || '08:00', sectionDuration, b, [4, 8], 20);
                                            }}
                                            min={0}
                                            max={30}
                                            className="input-field text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-2xs font-medium text-surface-500 mb-1">大课间休息(分钟)</label>
                                        <input
                                            type="number"
                                            value={20}
                                            min={10}
                                            max={60}
                                            className="input-field text-sm"
                                            disabled
                                        />
                                    </div>
                                </div>

                                <div className="mt-2 max-h-28 overflow-y-auto">
                                    <table className="w-full text-2xs">
                                        <thead>
                                            <tr className="text-surface-400">
                                                <th className="text-left py-0.5 font-medium">节次</th>
                                                <th className="text-left py-0.5 font-medium">上课</th>
                                                <th className="text-left py-0.5 font-medium">下课</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sectionTimes.map((sec, i) => (
                                                <tr key={i} className="border-t border-surface-100 dark:border-surface-700">
                                                    <td className="py-0.5 text-surface-600">第{i + 1}节</td>
                                                    <td className="py-0.5 text-surface-700 font-mono">{sec.start}</td>
                                                    <td className="py-0.5 text-surface-700 font-mono">{sec.end}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {startTime && endTime && (
                            <div className="p-2 bg-purple-100/50 dark:bg-purple-900/20 rounded-lg text-xs text-purple-700 dark:text-purple-300">
                                自动计算时间：{new Date(startTime).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                {' - '}
                                {new Date(endTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        )}
                    </div>
                )}

                {!isCourse && (
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-surface-600 dark:text-surface-300 mb-1.5">开始时间</label>
                            <input
                                type={isAllDay ? 'date' : 'datetime-local'}
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                                className="input-field"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-surface-600 dark:text-surface-300 mb-1.5">结束时间</label>
                            <input
                                type={isAllDay ? 'date' : 'datetime-local'}
                                value={endTime}
                                onChange={(e) => setEndTime(e.target.value)}
                                className="input-field"
                                required
                            />
                        </div>
                    </div>
                )}

                <div>
                    <label className="block text-sm font-medium text-surface-600 dark:text-surface-300 mb-1.5">分类颜色</label>
                    <div className="flex gap-1.5 flex-wrap">
                        <button
                            type="button"
                            onClick={() => setColor('')}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${color === '' ? 'bg-surface-600 text-white shadow-sm' : 'bg-surface-100 text-surface-500'
                                }`}
                        >
                            默认
                        </button>
                        {(Object.entries(EVENT_COLORS) as [EventColor, typeof EVENT_COLORS[EventColor]][]).map(([key, val]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setColor(key)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${val.bg} ${val.text} ${color === key ? 'ring-2 ring-offset-1 ring-brand-400' : ''
                                    }`}
                            >
                                {val.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-surface-600 dark:text-surface-300 mb-1.5">提前提醒</label>
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

            <div className="flex gap-3 mt-6">
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
                        onClick={() => setShowDeleteConfirm(true)}
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

            {showDeleteConfirm && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/25" onClick={() => setShowDeleteConfirm(false)}>
                    <div className="bg-white dark:bg-surface-900 rounded-2xl p-5 max-w-xs mx-4 scale-in" onClick={(e) => e.stopPropagation()}>
                        <h4 className="text-base font-semibold text-surface-800 dark:text-surface-100 mb-2">确认删除</h4>
                        <p className="text-sm text-surface-500 dark:text-surface-400 mb-4">删除后无法恢复，确定要删除这个日程吗？</p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowDeleteConfirm(false)} className="btn-secondary flex-1 py-2 text-sm">取消</button>
                            <button onClick={() => { onDelete?.(); setShowDeleteConfirm(false); }} className="flex-1 bg-red-500 text-white py-2 rounded-xl text-sm font-medium hover:bg-red-600">删除</button>
                        </div>
                    </div>
                </div>
            )}
        </form>
    );
}

export default EventForm;
