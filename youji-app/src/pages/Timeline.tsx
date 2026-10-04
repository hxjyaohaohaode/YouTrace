import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { liveQuery } from 'dexie';
import { Wallet, CheckSquare, BookOpen, Calendar, Activity, NotebookPen, ChevronRight } from 'lucide-react';
import { isStaticPageEntry } from '../lib/navigation';
import { db } from '../db';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { getDateDaysAgo, getToday } from '../utils/date';
import { timelineEntries, timelineTimeLabel, type TimelineData, type TimelineEntry } from '../services/timelineEntries';
const types = { expense: { icon: Wallet, label: '收支' }, todo_done: { icon: CheckSquare, label: '完成待办' }, habit: { icon: Activity, label: '习惯' }, diary: { icon: BookOpen, label: '日记' }, schedule: { icon: Calendar, label: '日程' }, capture: { icon: NotebookPen, label: '原始速记' } };
const positions = new Map<string, number>();
export default function Timeline() {
  const location = useLocation(), navigate = useNavigate(), params = new URLSearchParams(location.search);
  const range = ['7', '30', 'all'].includes(params.get('range') ?? '') ? params.get('range')! : '7';
  const limit = Math.min(100000, Math.max(60, Number(params.get('limit')) || 60)), recordId = params.get('record');
  const [data, setData] = useState<TimelineData | null>(null), [error, setError] = useState(''), [attempt, retry] = useState(0);
  const navigationType = useNavigationType();
  const restore = useRef(!isStaticPageEntry(location.state, db.ownerId ?? '', '/timeline', navigationType)), scrollKey = `${db.ownerId}:${location.pathname}${location.search}`;
  useEffect(() => {
    const target = db;
    const subscription = liveQuery(() => target.transaction('r', [target.expenses, target.todos, target.habits, target.habitCheckins, target.diary, target.schedules, target.quickNotes], async () => ({ expenses: await target.expenses.toArray(), todos: await target.todos.toArray(), habits: await target.habits.toArray(), checkins: await target.habitCheckins.toArray(), diaries: await target.diary.toArray(), schedules: await target.schedules.toArray(), notes: await target.quickNotes.toArray() })) ).subscribe({ next: value => { setData(value); setError(''); }, error: () => setError('时间线暂时读不到本机记录，请重试。已有记录不会因此删除。') });
    return () => subscription.unsubscribe();
  }, [attempt]);
  useEffect(() => { if (!data || !restore.current || recordId) return; restore.current = false; const saved = positions.get(scrollKey); if (saved !== undefined) { const frame = requestAnimationFrame(() => window.scrollTo({ top: saved, behavior: 'instant' })); return () => cancelAnimationFrame(frame); } }, [data, recordId, scrollKey]);
  const entries = useMemo(() => data ? timelineEntries(data) : [], [data]);
  const filtered = entries.filter(row => range === 'all' || row.date === null || row.date >= getDateDaysAgo(range === '30' ? 29 : 6) && row.date <= getToday());
  const visible = filtered.slice(0, limit), groups: Array<[string | null, TimelineEntry[]]> = [];
  for (const row of visible) { const last = groups.at(-1); if (last && last[0] === row.date) last[1].push(row); else groups.push([row.date, [row]]); }
  const selected = recordId ? data?.notes.find(row => row.id === recordId) : null;
  const returnTo = (location.state as { returnTo?: { path: string; label: string } } | null)?.returnTo;
  const chooseRange = (value: string) => { const next = new URLSearchParams({ range: value }); navigate(`/timeline?${next}`); };
  const open = (entry: TimelineEntry) => { positions.set(scrollKey, window.scrollY); navigate(entry.route, { state: { returnTo: { path: location.pathname + location.search, label: '返回时间线' } } }); };
  const closeNote = () => { if (returnTo?.path.startsWith('/')) navigate(returnTo.path); else { const next = new URLSearchParams(location.search); next.delete('record'); navigate(`/timeline?${next}`, { replace: true }); } };
  return <div className="w-full" data-component="timeline">
    <PageHeader icon={Activity} gradient="from-[#45B7D1] to-[#6C5CE7]" title="时间线" subtitle="找回具体记录，再继续核对与修改" />
    <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label="时间范围">{[['7', '近7天'], ['30', '近30天'], ['all', '全部记录']].map(([value, label]) => <Button key={value} variant={range === value ? 'primary' : 'ghost'} aria-pressed={range === value} onClick={() => chooseRange(value)}>{label}</Button>)}</div>
    <p className="mb-5 text-xs leading-6 text-[var(--text-3)]">按记录所属日期整理。日程是计划，截止日期不是完成时间；缺少发生时间的旧记录明确标为未知。当前显示 {visible.length}/{filtered.length} 条。</p>
    {error ? <div role="alert" className="space-y-3"><p>{error}</p><Button onClick={() => retry(value => value + 1)}>重试读取</Button></div> : !data ? <p role="status">正在读取时间线…</p> : !filtered.length ? <div className="space-y-4 rounded-2xl border border-[var(--border)] p-6"><p>这个时间范围还没有记录。</p><Link className="inline-block min-h-11 py-3 underline" to="/quick-note">写下第一条速记</Link>{range !== 'all' && <Button variant="ghost" onClick={() => chooseRange('all')}>查看更早记录</Button>}</div> : <div className="space-y-6">{groups.map(([date, rows]) => <section key={date ?? 'unknown'} aria-label={date ?? '时间未知'}><h2 className="mb-3 text-sm font-bold">{date ?? '时间未知的记录'}{date && date > getToday() ? ' · 未来日期' : ''}</h2><div className="space-y-2">{rows.map(row => { const Icon = types[row.type].icon; return <button key={row.id} type="button" onClick={() => open(row)} aria-label={`${types[row.type].label}: ${row.title}`} className="flex min-h-20 w-full items-center gap-3 rounded-xl border border-[var(--border-light)] bg-[var(--surface)] px-3 py-3 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--primary)]"><Icon size={18} className="shrink-0 text-[var(--primary)]" aria-hidden /><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{row.title}</p><p className="mt-1 text-xs leading-5 text-[var(--text-3)]">{row.detail}</p><p className="text-xs text-[var(--text-3)]">{timelineTimeLabel(row)}</p></div><ChevronRight size={16} className="shrink-0" aria-hidden /></button>; })}</div></section>)}</div>}
    {visible.length < filtered.length && <Button className="my-6 w-full" variant="ghost" onClick={() => { const next = new URLSearchParams(location.search); next.set('limit', String(limit + 60)); navigate(`/timeline?${next}`, { replace: true }); }}>继续查看较早记录（还有 {filtered.length - visible.length} 条）</Button>}
    {data && recordId && <Modal open onClose={closeNote} title={selected ? '原始速记' : '未找到这条速记'} footer={<Button onClick={closeNote}>{returnTo?.label ?? '返回时间线'}</Button>}>
      {selected ? <div className="space-y-4"><p className="whitespace-pre-wrap break-words leading-7">{selected.rawInput}</p><p className="text-sm text-[var(--text-3)]">{selected.confirmed ? '这条原文已确认保存' : '旧记录的确认状态未知'}。此处保留原始记录；修改后续收支或待办不会重写这段原文。</p><Link to={`/quick-note/result?receipt=${encodeURIComponent(selected.id)}`} className="inline-block min-h-11 py-3 underline">查看本机保存结果与去向</Link></div> : <p>当前账号没有这条记录，或它已被删除。不会用同名记录代替。</p>}
    </Modal>}
  </div>;
}
