import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { liveQuery } from 'dexie';
import { Wallet, CheckSquare, BookOpen, Calendar, Activity, NotebookPen, ChevronRight } from 'lucide-react';
import { isStaticPageEntry } from '../lib/navigation';
import { db } from '../db';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { getToday } from '../utils/date';
import { timelineRange, timelineRangeIncludes } from './timelineRange';
import { timelineEntries, timelineTimeLabel, type TimelineData, type TimelineEntry } from '../services/timelineEntries';
import { consumeTimelineReturnFocus, prepareTimelineReturnFocus, type TimelinePosition } from './timelineReturnFocus';
const types = { expense: { icon: Wallet, label: '收支' }, todo_done: { icon: CheckSquare, label: '完成待办' }, habit: { icon: Activity, label: '习惯' }, diary: { icon: BookOpen, label: '日记' }, schedule: { icon: Calendar, label: '日程' }, capture: { icon: NotebookPen, label: '原始速记' } };
const positions = new Map<string, TimelinePosition>();
function revealTimelineKeyboardFocus(target: HTMLButtonElement) {
  const document = target.ownerDocument, view = document.defaultView;
  if (!view || !target.isConnected || document.activeElement !== target || !target.matches(':focus-visible') || target.closest('[role="dialog"]')) return;
  const painted = (element: Element) => {
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return false;
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = view.getComputedStyle(current);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) <= 0) return false;
    }
    return true;
  };
  // A background row must never move the page while a modal owns interaction.
  if ([...document.querySelectorAll('[role="dialog"]')].some(painted)) return;
  const box = target.getBoundingClientRect(), style = view.getComputedStyle(target);
  if (!painted(target)) return;
  const outline = Math.max(0, parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset)) || 0;
  let bottom = view.innerHeight;
  for (const nav of document.querySelectorAll('nav[aria-label="主导航"]')) {
    const bounds = nav.getBoundingClientRect();
    if (!painted(nav) || view.getComputedStyle(nav).position !== 'fixed' || bounds.top <= view.innerHeight / 2 || bounds.bottom < view.innerHeight - 1) continue;
    // The primary Capture button protrudes above the flat bottom-navigation bar.
    for (const obstacle of [nav, ...nav.querySelectorAll('button, a')]) {
      const area = obstacle.getBoundingClientRect();
      if (painted(obstacle) && area.bottom > 0 && area.left < box.right + outline && area.right > box.left - outline) bottom = Math.min(bottom, area.top);
    }
  }
  if (box.top - outline < 0 || box.bottom + outline > bottom) {
    // Keep the browser's chosen focus and tab order. Scroll immediately only
    // when that keyboard-focused row is obscured; never schedule a later jump.
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  }
}

export default function Timeline() {
  const location = useLocation(), navigate = useNavigate(), params = new URLSearchParams(location.search);
  const scope = useMemo(() => timelineRange(location.search, getToday()), [location.search]);
  const { range } = scope;
  const limit = Math.min(100000, Math.max(60, Number(params.get('limit')) || 60)), recordId = params.get('record');
  const [data, setData] = useState<TimelineData | null>(null), [error, setError] = useState(''), [attempt, retry] = useState(0);
  const navigationType = useNavigationType();
  const scrollKey = `${db.ownerId}:${location.pathname}${location.search}`;
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const restoration = useRef<{ saved?: TimelinePosition; pending?: ReturnType<typeof prepareTimelineReturnFocus>; handled: boolean } | null>(null);
  useLayoutEffect(() => {
    if (location.search === scope.search) return;
    const state = isStaticPageEntry(location.state, db.ownerId ?? '', '/timeline', navigationType)
      ? { ...location.state, timelineRangeNormalized: true } : location.state;
    navigate({ pathname: location.pathname, search: scope.search }, { replace: true, state });
  }, [location.pathname, location.search, location.state, navigate, navigationType, scope.search]);
  useLayoutEffect(() => {
    const saved = positions.get(scrollKey);
    // Only Back to the list entry that opened this record owns a focus return.
    if (recordId || isStaticPageEntry(location.state, db.ownerId ?? '', '/timeline', navigationType)) return;
    const pending = navigationType === 'POP' && saved?.entryId && saved.locationKey === location.key
      ? prepareTimelineReturnFocus(document, rowButtons.current, saved.entryId) : undefined;
    const current = { saved, pending, handled: false };
    restoration.current = current;
    return () => { pending?.cancel(); if (restoration.current === current) restoration.current = null; };
  }, [location.key, location.state, navigationType, recordId, scrollKey]);
  useEffect(() => {
    const target = db;
    const subscription = liveQuery(() => target.transaction('r', [target.expenses, target.todos, target.habits, target.habitCheckins, target.diary, target.schedules, target.quickNotes], async () => ({ expenses: await target.expenses.toArray(), todos: await target.todos.toArray(), habits: await target.habits.toArray(), checkins: await target.habitCheckins.toArray(), diaries: await target.diary.toArray(), schedules: await target.schedules.toArray(), notes: await target.quickNotes.toArray() })) ).subscribe({ next: value => { setData(value); setError(''); }, error: () => setError('时间线暂时读不到本机记录，请重试。已有记录不会因此删除。') });
    return () => subscription.unsubscribe();
  }, [attempt]);
  useEffect(() => {
    const current = restoration.current;
    if (!data || error || !current || current.handled || recordId) return;
    const { saved, pending } = current;
    const frame = requestAnimationFrame(() => {
      if (restoration.current !== current) return;
      current.handled = true;
      if (saved) window.scrollTo({ top: saved.top, behavior: 'instant' });
      pending?.restore();
      if (saved && pending) consumeTimelineReturnFocus(positions, scrollKey, saved);
    });
    return () => cancelAnimationFrame(frame);
  }, [data, error, location.key, location.state, navigationType, recordId, scrollKey]);
  const entries = useMemo(() => data ? timelineEntries(data) : [], [data]);
  const filtered = entries.filter(row => timelineRangeIncludes(row.date, scope));
  const visible = filtered.slice(0, limit), groups: Array<[string | null, TimelineEntry[]]> = [];
  for (const row of visible) { const last = groups.at(-1); if (last && last[0] === row.date) last[1].push(row); else groups.push([row.date, [row]]); }
  const selected = recordId ? data?.notes.find(row => row.id === recordId) : null;
  const returnTo = (location.state as { returnTo?: { path: string; label: string } } | null)?.returnTo;
  const chooseRange = (value: string) => { navigate(`/timeline${timelineRange(`?range=${value}`, getToday()).search}`); };
  const open = (entry: TimelineEntry) => { positions.set(scrollKey, { top: window.scrollY, entryId: entry.id, locationKey: location.key }); navigate(entry.route, { state: { returnTo: { path: location.pathname + location.search, label: '返回时间线' } } }); };
  const closeNote = () => { if (returnTo?.path.startsWith('/')) navigate(returnTo.path); else { const next = new URLSearchParams(location.search); next.delete('record'); navigate(`/timeline?${next}`, { replace: true }); } };
  return <div className="record-page timeline-page" data-component="timeline">
    <header className="record-page-heading"><div><p className="record-eyebrow">记录与回看 / TIMELINE</p><h1>时间线</h1><p className="record-deck">按日期展开生活，找回每一条记录。</p></div><Link to="/quick-note" className="record-text-link">写一条速记 →</Link></header>
    <div className="timeline-toolbar mb-5 flex flex-wrap items-center gap-2" role="group" aria-label="时间范围">{[['7', '近7天'], ['30', '近30天'], ['all', '全部记录']].map(([value, label]) => <Button key={value} variant={range === value ? 'primary' : 'ghost'} aria-pressed={range === value} onClick={() => chooseRange(value)}>{label}</Button>)}</div>
    {range !== 'all' && <div className="mb-4 flex flex-wrap items-center gap-2 text-sm"><p>固定期间：{scope.from} 至 {scope.through}（含首尾）。跨日与返回时保持此期间。</p><Button variant="ghost" onClick={() => chooseRange(range)}>更新到今天</Button></div>}
    <p className="mb-5 text-xs leading-6 text-[var(--text-3)]">按记录所属日期整理。日程是计划，截止日期不是完成时间；缺少发生时间的旧记录明确标为未知。当前显示 {visible.length}/{filtered.length} 条。</p>
    {error ? <div role="alert" className="space-y-3"><p>{error}</p><Button onClick={() => retry(value => value + 1)}>重试读取</Button></div> : !data ? <p role="status">正在读取时间线…</p> : !filtered.length ? <div className="space-y-4 rounded-2xl border border-[var(--border)] p-6"><p>这个时间范围还没有记录。</p><Link className="inline-block min-h-11 py-3 underline" to="/quick-note">写下第一条速记</Link>{range !== 'all' && <Button variant="ghost" onClick={() => chooseRange('all')}>查看更早记录</Button>}</div> : <div className="timeline-chronology">{groups.map(([date, rows]) => <section className="timeline-day" key={date ?? 'unknown'} aria-label={date ?? '时间未知'}><h2 className="timeline-date">{date ?? '时间未知的记录'}{date && date > getToday() ? ' · 未来日期' : ''}</h2><div className="timeline-day-records">{rows.map(row => { const Icon = types[row.type].icon; return <button key={row.id} ref={node => { if (node) rowButtons.current.set(row.id, node); else rowButtons.current.delete(row.id); }} type="button" onFocus={event => revealTimelineKeyboardFocus(event.currentTarget)} onClick={() => open(row)} aria-label={`${types[row.type].label}: ${row.title}`} className="timeline-row flex min-h-20 w-full items-start gap-4 max-[769px]:scroll-mb-[calc(6rem+env(safe-area-inset-bottom))] text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--primary)]"><Icon size={18} className="timeline-entry-icon shrink-0 text-[var(--link)]" aria-hidden /><div className="min-w-0 flex-1"><p className="break-words text-base font-medium">{row.title}</p><p className="mt-1 text-xs leading-5 text-[var(--text-3)]">{row.detail}</p><p className="text-xs text-[var(--text-3)]">{timelineTimeLabel(row)}</p></div><ChevronRight size={16} className="shrink-0" aria-hidden /></button>; })}</div></section>)}</div>}
    {visible.length < filtered.length && <Button className="my-6 w-full" variant="ghost" onClick={() => { const next = new URLSearchParams(location.search); next.set('limit', String(limit + 60)); navigate(`/timeline?${next}`, { replace: true }); }}>继续查看较早记录（还有 {filtered.length - visible.length} 条）</Button>}
    {data && recordId && <Modal open onClose={closeNote} title={selected ? '原始速记' : '未找到这条速记'} footer={<Button onClick={closeNote}>{returnTo?.label ?? '返回时间线'}</Button>}>
      {selected ? <div className="space-y-4"><p className="whitespace-pre-wrap break-words leading-7">{selected.rawInput}</p><p className="text-sm text-[var(--text-3)]">{selected.confirmed ? '这条原文已确认保存' : '旧记录的确认状态未知'}。此处保留原始记录；修改后续收支或待办不会重写这段原文。</p><Link to={`/quick-note/result?receipt=${encodeURIComponent(selected.id)}`} className="inline-block min-h-11 py-3 underline">查看本机保存结果与去向</Link></div> : <p>当前账号没有这条记录，或它已被删除。不会用同名记录代替。</p>}
    </Modal>}
  </div>;
}
