import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { recordDiagnostic } from '../../services/diagnostics';
import { liveQuery } from 'dexie';
import { db } from '../../db';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../ui/Button';
import { BUSINESS_TIME_ZONE, getToday } from '../../utils/date';
import { observationActorCurrent, readRecordObservations, setObservationHidden, type RecordObservations, type ObservationExpense, type ObservationRule } from '../../services/recordObservations';

const readingPositions = new Map<string, { top: number; expanded: boolean; recordId?: string }>();
const yuan = (value: number) => (value / 100).toFixed(2);
export function CurrentRecordObservations() {
  const owner = useAuthStore(state => state.user?.id), location = useLocation(), navigationType = useNavigationType(), navigate = useNavigate();
  const [returnNotice, setReturnNotice] = useState(''), [choiceError, setChoiceError] = useState('');
  const [snapshot, setSnapshot] = useState<RecordObservations | null>(null), [error, setError] = useState(''), [attempt, retry] = useState(0), [today, setToday] = useState(getToday);
  const key = `${owner}:${today}`, saved = readingPositions.get(key), [expanded, setExpanded] = useState(navigationType === 'POP' && Boolean(saved?.expanded));
  const intentRevision = useRef(0), choiceFocus = useRef<{ rule: ObservationRule; hidden: boolean; intent: number } | null>(null);
  const [pending, setPending] = useState<ObservationRule | null>(null), busy = useRef(false), restored = useRef(false), restoreCancelled = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { const timer = window.setInterval(() => setToday(getToday()), 30000); const checkDate = () => setToday(getToday()); window.addEventListener('focus', checkDate); return () => { window.clearInterval(timer); window.removeEventListener('focus', checkDate); }; }, []);
  useEffect(() => {
    const target = db;
    const subscription = liveQuery(() => readRecordObservations(target, today)).subscribe({
      next: value => { if (observationActorCurrent(target, value) && value.ownerId === owner) { setSnapshot(value); setError(''); } else { setSnapshot(null); setError('账号状态已变化，请重新核对登录。'); } },
      error: (reason: unknown) => { recordDiagnostic('runtime-error', 'insights'); setSnapshot(null); const message = reason instanceof Error ? reason.message : ''; setError(/^(有收支记录|这两个期间有收支记录|本机观察显示偏好|记录金额合计)/.test(message) ? message : '暂时无法核对本机记录，当前金额和同步确认已撤下。旧快照仍可查看，请重试读取。'); },
    });
    return () => subscription.unsubscribe();
  }, [owner, today, attempt]);
  useEffect(() => { const cancel = (event: Event) => { if (event.isTrusted) { restoreCancelled.current = true; intentRevision.current += 1; } }; window.addEventListener('pointerdown', cancel, true); window.addEventListener('keydown', cancel, true); window.addEventListener('wheel', cancel, { capture: true, passive: true }); return () => { window.removeEventListener('pointerdown', cancel, true); window.removeEventListener('keydown', cancel, true); window.removeEventListener('wheel', cancel, true); }; }, []);
  useEffect(() => {
    if (!snapshot || restoreCancelled.current || restored.current || navigationType !== 'POP') return;
    const position = readingPositions.get(key);
    if (position) { const currentHeading = heading.current, routeKey = location.key, path = location.pathname + location.search, target = db; const frame = requestAnimationFrame(() => { if (restoreCancelled.current || !currentHeading?.isConnected || currentHeading.closest('[data-page-key]')?.getAttribute('data-page-key') !== routeKey || window.location.pathname + window.location.search !== path || useAuthStore.getState().user?.id !== owner || !observationActorCurrent(target, snapshot)) return; restored.current = true; const sourceButton = [...document.querySelectorAll<HTMLButtonElement>('[data-observation-record]')].find(button => button.dataset.observationRecord === position.recordId); window.scrollTo({ top: position.top, behavior: 'instant' }); if (sourceButton?.isConnected) { sourceButton.focus({ preventScroll: true }); const rect = sourceButton.getBoundingClientRect(); if (rect.top < 70 || rect.bottom > window.innerHeight - 100) sourceButton.scrollIntoView({ block: 'center', behavior: 'instant' }); } else { currentHeading.focus({ preventScroll: true }); if (position.recordId) setReturnNotice('这条记录当前不在两个期间的依据中，已回到观察标题；可到花销页继续核对。'); } }); return () => cancelAnimationFrame(frame); }
  }, [snapshot, key, navigationType, location.key, location.pathname, location.search, owner]);
  useEffect(() => {
    const request = choiceFocus.current;
    if (!snapshot || pending || !request || snapshot.choices[request.rule].hidden !== request.hidden) return;
    const target = document.querySelector<HTMLButtonElement>(`[data-observation-choice="${request.rule}:${!request.hidden}"]`);
    const frame = requestAnimationFrame(() => { if (!target?.isConnected || intentRevision.current !== request.intent || useAuthStore.getState().user?.id !== owner || !observationActorCurrent(db, snapshot)) return; choiceFocus.current = null; target.focus({ preventScroll: true }); const rect = target.getBoundingClientRect(); if (rect.top < 70 || rect.bottom > window.innerHeight - 100) target.scrollIntoView({ block: 'center', behavior: 'instant' }); });
    return () => cancelAnimationFrame(frame);
  }, [snapshot, pending, owner]);
  const change = async (rule: ObservationRule, hidden: boolean) => {
    if (!snapshot || busy.current) return;
    busy.current = true; setChoiceError(''); setPending(rule); choiceFocus.current = { rule, hidden, intent: intentRevision.current };
    try { await setObservationHidden(snapshot, rule, hidden); }
    catch (reason) { choiceFocus.current = null; recordDiagnostic('runtime-error', 'insights'); const message = reason instanceof Error ? reason.message : ''; setChoiceError(reason instanceof Error && reason.name === 'QuotaExceededError' ? '此设备的存储空间不足，显示选择未保存。已有记录未改动；可先到设置导出资料，再重试。' : /^(账号|这条显示偏好|观察|显示偏好)/.test(message) ? message : '这次本机显示选择未保存，请重新读取后再试。'); setSnapshot(null); }
    finally { busy.current = false; setPending(null); }
  };
  const reread = () => { setChoiceError(''); retry(value => value + 1); };
  const visibleError = error || choiceError;
  const open = (row: ObservationExpense) => {
    readingPositions.set(key, { top: window.scrollY, expanded, recordId: row.id });
    navigate(`/expense?record=${encodeURIComponent(row.id)}`, { state: { returnTo: { path: location.pathname + location.search, label: '返回这份观察' } } });
  };
  const rows = (values: ObservationExpense[], label: string) => <section className="space-y-3" aria-label={label}><h3 className="font-semibold">{label} · {values.length}笔</h3>{values.length ? <ul className="space-y-2">{values.map(row => <li key={row.id}><button type="button" data-observation-record={row.id} onClick={() => open(row)} aria-label={`核对来源 ${row.name} ${row.date} ${row.income ? '收入' : '支出'} ${yuan(row.amount)}元`} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left focus-visible:outline-2 focus-visible:outline-[var(--primary)]"><span className="block break-words text-sm font-semibold">{row.name}</span><span className="mt-1 block text-sm">{row.date} · {row.income ? '收入' : '支出'} CNY ¥{yuan(row.amount)}</span><span className="mt-1 block text-xs leading-5 text-[var(--text-2)]">{row.syncStatus} · 打开原记录核对</span></button></li>)}</ul> : <p className="text-sm text-[var(--text-2)]">这个期间没有已记录支出，不代表实际没有消费。</p>}</section>;
  if (snapshot && (snapshot.ownerId !== owner || !observationActorCurrent(db, snapshot))) return <p role="alert">账号状态已变化，请重新核对登录。</p>;
  return <section className="mb-8 space-y-4" data-component="current-record-observations" aria-label="当前记录观察">
    <header><h2 ref={heading} tabIndex={-1} className="text-lg font-bold outline-none">当前记录观察</h2><p className="mt-2 text-sm leading-6 text-[var(--text-2)]">先看依据，再决定是否需要行动。这里只核对本机已加载的记录，包含尚未同步的修改；不据此判断你的全部生活。</p></header>
    {returnNotice && <p role="status" className="text-sm leading-6">{returnNotice}</p>}
    {visibleError ? <div role="alert" className="space-y-3 rounded-xl border border-[var(--border)] p-4"><p>{visibleError}</p><Button onClick={reread}>重新读取当前观察</Button><Button variant="ghost" onClick={() => navigate('/expense')}>去花销页核对</Button></div> : !snapshot ? <p role="status">正在核对本机记录…</p> : <>
      <p className="text-xs leading-5 text-[var(--text-2)]">核对于 {new Intl.DateTimeFormat('zh-CN', { timeZone: BUSINESS_TIME_ZONE, dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' }).format(snapshot.checkedAt)}（北京时间）。条目自己的云端确认状态列在依据中。</p><Button variant="ghost" onClick={reread}>重新核对本机记录</Button>
      {snapshot.choices['spending-comparison'].hidden ? <div className="rounded-xl border border-[var(--border)] p-4"><p className="text-sm">此设备已隐藏 {snapshot.period.start} 至 {snapshot.period.end} 的支出观察，其他设备不受影响。</p><Button variant="ghost" disabled={pending !== null} data-observation-choice="spending-comparison:false" onClick={() => void change('spending-comparison', false)}>在此设备恢复本期间支出观察</Button></div> : snapshot.rows.length > 0 ? <article className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5" aria-label="已记录支出变化">
        <h3 className="font-bold">已记录支出变化</h3>
        <div className="grid gap-4 sm:grid-cols-2">{[[snapshot.period.start, snapshot.period.end, snapshot.currentFen, snapshot.current.length], [snapshot.period.previousStart, snapshot.period.previousEnd, snapshot.previousFen, snapshot.previous.length]].map(([start, end, amount, count]) => <div key={String(start)} className="space-y-1"><p className="text-sm">{start} 至 {end}</p><p className="break-all font-mono text-xl font-bold">CNY ¥{yuan(Number(amount))}</p><p className="text-sm text-[var(--text-2)]">{count}笔支出</p></div>)}</div>
        <p className="text-sm leading-6">{snapshot.percent === null ? '前段没有已记录支出，不计算涨跌百分比。' : snapshot.percent === 0 ? '这两段已记录支出合计相同。' : `相对前段${snapshot.percent > 0 ? '增加' : '减少'}约${Math.round(Math.abs(snapshot.percent))}%（百分比取整）。`}{` 已排除两个期间的${snapshot.income.length}笔收入。`}</p>
        <p className="text-sm leading-6 text-[var(--text-2)]">这只反映以上记录；记录较少时，单笔金额就可能明显改变比例，不代表消费异常或已经找到原因。</p>
        <Button aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起本次依据' : '查看依据并核对原记录'}</Button>
        {expanded && <div className="space-y-6 border-t border-[var(--border)] pt-4" data-observation-evidence>{rows(snapshot.current, `${snapshot.period.start} 至 ${snapshot.period.end}`)}{rows(snapshot.previous, `${snapshot.period.previousStart} 至 ${snapshot.period.previousEnd}`)}{snapshot.income.length > 0 && <details><summary className="cursor-pointer py-3 text-sm underline">查看已排除的收入（{snapshot.income.length}笔）</summary>{rows(snapshot.income, '已排除的收入')}</details>}<p className="text-sm leading-6 text-[var(--text-2)]">点击条目可修改原记录；返回后重新核对当前内容，不改写以前保存的历史快照。存在冲突时可到设置比较版本。</p><Button variant="ghost" onClick={() => navigate('/settings')}>查看同步与冲突处理</Button></div>}
        <div><Button variant="ghost" disabled={pending !== null} data-observation-choice="spending-comparison:true" onClick={() => void change('spending-comparison', true)}>在此设备隐藏本期间支出观察</Button></div>
      </article> : null}
      {snapshot.choices['record-rhythm'].hidden ? <div className="rounded-xl border border-[var(--border)] p-4"><p className="text-sm">此设备已隐藏本期间的可选速记提示，其他设备不受影响。</p><Button variant="ghost" disabled={pending !== null} data-observation-choice="record-rhythm:false" onClick={() => void change('record-rhythm', false)}>在此设备恢复本期间速记提示</Button></div> : snapshot.activeDates.length <= 2 && snapshot.activeDates.length > 0 ? <article className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"><h3 className="font-bold">想留下什么时，再记一句</h3><p className="text-sm leading-6 text-[var(--text-2)]">{snapshot.period.start} 至 {snapshot.period.end} 有{snapshot.activeDates.length}天留下记录。没有连续记录的要求，也不需要采纳一条建议才能开始。</p><Button onClick={() => navigate('/quick-note')}>写一句速记</Button><Button variant="ghost" disabled={pending !== null} data-observation-choice="record-rhythm:true" onClick={() => void change('record-rhythm', true)}>在此设备隐藏本期间速记提示</Button></article> : snapshot.rows.length === 0 && snapshot.activeDates.length === 0 ? <div className="space-y-3 rounded-xl border border-[var(--border)] p-4"><p>这两个期间还没有可核对的记录。可以先记一件事，不生成缺少依据的行动建议。</p><Button onClick={() => navigate('/quick-note')}>写下第一条速记</Button></div> : null}
    </>}
  </section>;
}
