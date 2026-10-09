import '../components/schedule/planning.css';
import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Target, Plus, Trash2, Pencil, CloudUpload } from 'lucide-react';
import { generateLocalId, type GoalRecord } from '../db';
import { useAuthStore } from '../stores/authStore';
import { useGoalStore, startGoalObservation, cloneGoalSnapshot, goalLevelLabels, goalPriorityColors, type GoalLevel, type GoalPriority, type GoalView, type GoalWriteResult } from '../stores/goalStore';
import { PageHeader } from '../components/layout/PageHeader';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { LegacyGoalRecovery } from '../components/settings/LegacyGoalRecovery';
import { goalFailureMessage, goalLoadingMessage, goalSummaryLabel, goalNeedsRefresh } from '../components/goal/goalErrors';
import { GoalErrorAlert } from '../components/goal/GoalErrorAlert';
import { recordDiagnostic } from '../services/diagnostics';

const levelFilters: Array<{ key: GoalLevel | 'all'; label: string }> = [{ key: 'all', label: '全部' }, { key: 'short', label: '短期' }, { key: 'medium', label: '中期' }, { key: 'long', label: '长期' }];
const domains = ['健康', '财务', '学习', '职业', '生活', '社交'];
type GoalStatus = '仅本机' | '待同步' | '需要比较版本' | '需要检查' | '已同步' | '暂无法核对';

function GoalCard({ goal, status, busy, onProgress, onDelete, onEdit }: {
  goal: GoalView; status: GoalStatus; busy: boolean;
  onProgress: (value: number) => void; onDelete: () => void; onEdit: () => void;
}) {
  const reduced = useReducedMotion();
  const validProgress = Number.isFinite(goal.progress) && goal.progress >= 0 && goal.progress <= 100;
  const isDone = validProgress && goal.progress >= 100;
  return <motion.article layout={!reduced} initial={{ opacity: 0, y: reduced ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.18 }} aria-label={`目标 ${goal.title}`} data-component="goal-card" className={`goal-record border bg-[var(--surface)] p-5 ${isDone ? 'border-[var(--success)]/40' : 'border-[var(--border-light)]'}`}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1.5"><span className={`rounded-full px-2 py-0.5 text-sm font-bold ${goalPriorityColors[goal.priority]}`}>{goal.priority === 'high' ? '高' : goal.priority === 'medium' ? '中' : '低'}</span><span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-sm text-[var(--text-2)]">{goal.domain}</span><span className="text-sm text-[var(--text-3)]">{status}</span></div>
        <h2 className="break-words text-lg font-bold text-[var(--text-1)]">{goal.title}</h2>
        {goal.description && <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-[var(--text-2)]">{goal.description}</p>}
        {goal.targetDate && <p className="mt-1 text-sm text-[var(--text-3)]">计划日期 {goal.targetDate}</p>}
      </div>
      <button type="button" disabled={busy} onClick={onEdit} aria-label={'编辑目标 ' + goal.title} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-2)] hover:bg-[var(--surface-2)]"><Pencil size={15} aria-hidden /></button>
      <button type="button" disabled={busy} onClick={onDelete} aria-label={'删除目标 ' + goal.title} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-3)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"><Trash2 size={15} aria-hidden /></button>
    </div>
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-sm"><span className="text-[var(--text-3)]">手动确认的进度 · {goalLevelLabels[goal.level]}</span><span className="font-mono text-[var(--link)]">{validProgress ? `${goal.progress}%` : '待校正'}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]" role="progressbar" aria-label={`${goal.title}手动进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={validProgress ? goal.progress : undefined}><motion.div initial={false} animate={{ width: (validProgress ? goal.progress : 0) + '%' }} transition={{ duration: reduced ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }} className={'h-full rounded-full ' + (isDone ? 'bg-[var(--success)]' : 'bg-[var(--primary)]')} /></div>
      <div className="goal-progress-options mt-3 flex gap-1" role="group" aria-label="手动调整目标进度">{[0, 25, 50, 75, 100].map((value) => <button key={value} type="button" disabled={busy} onClick={() => onProgress(value)} aria-label={`将目标进度设为 ${value}%`} aria-pressed={goal.progress === value} className={`min-h-10 flex-1 rounded-full text-sm font-semibold transition-colors ${goal.progress === value ? 'bg-[var(--primary-soft)] text-[var(--link)]' : 'text-[var(--text-3)] hover:bg-[var(--surface-2)]'}`}>{value}%</button>)}</div>
      {(status === '需要比较版本' || status === '需要检查') && <Link to="/settings" className="mt-2 inline-block text-sm text-[var(--link)] underline">{status === '需要比较版本' ? '比较本机与云端版本' : '检查同步状态与备份'}</Link>}
    </div>
  </motion.article>;
}

export default function Goal() {
  const items = useGoalStore((state) => state.items);
  const loaded = useGoalStore((state) => state.loaded);
  const user = useAuthStore((state) => state.user);
  const statuses = useGoalStore(state => state.statuses), readError = useGoalStore(state => state.readError), loading = useGoalStore(state => state.loading);
  const [creationId, setCreationId] = useState(generateLocalId);
  const mounted = useRef(true), operation = useRef(0);
  const [filter, setFilter] = useState<GoalLevel | 'all'>('all');
  const [deleteGoal, setDeleteGoal] = useState<GoalRecord | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<GoalRecord | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [level, setLevel] = useState<GoalLevel>('short');
  const [domain, setDomain] = useState(domains[0]);
  const [priority, setPriority] = useState<GoalPriority>('medium');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string; refreshRevision?: number; readFailed?: boolean }>({ error: false, text: '' });
  const publishedRevision = useGoalStore(state => state.publishedRevision);
  const needsRefresh = goalNeedsRefresh(feedback.refreshRevision, publishedRevision, feedback.readFailed === true, readError);
  const [enrollment, setEnrollment] = useState<GoalRecord[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    mounted.current = true;
    const stop = startGoalObservation();
    return () => { mounted.current = false; operation.current += 1; stop(); };
  }, []);

  const filtered = useMemo(() => items.filter((goal) => filter === 'all' || goal.level === filter), [items, filter]);
  const localGoals = items.filter((goal) => goal.syncScope !== 'account');
  const validGoals = items.filter((goal) => Number.isFinite(goal.progress) && goal.progress >= 0 && goal.progress <= 100);
  const invalidProgressCount = items.length - validGoals.length;
  const doneCount = validGoals.filter((goal) => goal.progress >= 100).length;
  const avgProgress = validGoals.length ? Math.round(validGoals.reduce((sum, goal) => sum + goal.progress, 0) / validGoals.length) : 0;
  const run = async (action: () => Promise<GoalWriteResult>, success: string, onCommitted?: () => void) => {
    if (busyRef.current) return;
    const current = ++operation.current;
    busyRef.current = true; setBusy(true); setFeedback({ error: false, text: '' });
    try {
      const result = await action();
      if (!mounted.current || current !== operation.current || result.view === 'context-changed') return;
      onCommitted?.();
      setFeedback({ error: false, text: success, ...(['refresh-needed', 'refreshing'].includes(result.view) ? { refreshRevision: result.refreshRevision, readFailed: result.view === 'refresh-needed' } : {}) });
    } catch (cause) {
      if (!mounted.current || current !== operation.current) return;
      setFeedback({ error: true, text: goalFailureMessage(cause) }); recordDiagnostic('runtime-error', 'goals');
    } finally { if (mounted.current && current === operation.current) { busyRef.current = false; setBusy(false); } }
  };
  const refresh = async () => { try { await useGoalStore.getState().loadFromDB(); } catch { /* guarded store keeps a visible read error, not a false write failure */ } };
  const openEditor = (goal?: GoalRecord) => {
    if (busyRef.current) return;
    setFeedback({ error: false, text: '' });
    if (goal) { setEditing(cloneGoalSnapshot(goal)); setTitle(goal.title); setDescription(goal.description); setTargetDate(goal.targetDate ?? ''); setLevel(goal.level); setDomain(goal.domain); setPriority(goal.priority); }
    else if (editing) { setEditing(null); setTitle(''); setDescription(''); setTargetDate(''); setCreationId(generateLocalId()); }
    setShowModal(true);
  };
  const save = () => run(() => {
    const values = { title, description, level, domain, priority, targetDate: targetDate || null };
    return editing ? useGoalStore.getState().updateGoal(editing.id, values, editing) : useGoalStore.getState().addGoal(values, creationId);
  }, editing ? '目标已保存在本机，账号目标会继续同步' : '目标已保存在本机，可在卡片查看同步状态', () => {
    setTitle(''); setDescription(''); setTargetDate(''); setEditing(null); setShowModal(false); setCreationId(generateLocalId());
  });

  return <div className="planning-page w-full" data-component="goal-workspace">
    <PageHeader icon={Target} gradient="from-[var(--primary)] to-[var(--primary-light)]" title="目标" subtitle={goalSummaryLabel(loaded, loading, readError, doneCount, items.length, avgProgress)} wrapSubtitle actions={<Button onClick={() => openEditor()} disabled={busy} aria-label="新建目标"><Plus size={18} aria-hidden />新建目标</Button>} />
    <div className="goal-introduction" data-component="goal-progress-explanation"><h2>把方向写清楚，再走下一步</h2><p>进度由你手动确认，可随时调回。描述里可以写下下一步行动；修改先保存在本机，仍需等待云端确认，实际同步状态见每个目标。</p></div>
    <p className="mb-4 text-sm leading-6 text-[var(--text-3)]">{loaded ? <>上方完成数与平均进度统计{readError ? '上次读取的' : ''}全部目标（共 {items.length} 个），筛选只改变下方列表{filter !== 'all' ? `；当前显示${goalLevelLabels[filter]} ${filtered.length} 个目标` : ''}。</> : '读取成功后显示全部目标的统计，暂不把未读到的资料算作空列表。'}</p>
    {invalidProgressCount > 0 && <p role="status" className="mb-4 text-sm text-[var(--warning)]">{invalidProgressCount} 份旧目标的进度需要校正，原值已保留且未计入平均进度。请手动选择实际进度后再同步。</p>}
    <LegacyGoalRecovery />
    {localGoals.length > 0 && <aside className="mb-4 rounded-xl border border-[var(--warning)]/30 p-3 text-sm leading-6" data-component="goal-enrollment"><p>{localGoals.length} 个旧目标仍仅保存在本机。由你选择是否上传，未选择的不会自动同步。</p><Button variant="ghost" size="sm" disabled={busy || !user} onClick={() => { setFeedback({ error: false, text: '' }); setEnrollment(localGoals.map(cloneGoalSnapshot)); setSelected([]); }}><CloudUpload size={14} aria-hidden />选择同步旧目标</Button></aside>}
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="目标类型筛选">{levelFilters.map((option) => <button key={option.key} type="button" onClick={() => setFilter(option.key)} aria-pressed={filter === option.key} className={`min-h-10 shrink-0 rounded-full px-3.5 text-sm font-semibold ${filter === option.key ? 'bg-[var(--primary-soft)] text-[var(--link)]' : 'bg-[var(--surface-2)] text-[var(--text-2)]'}`}>{option.label}</button>)}</div>
    {readError && !showModal && !deleteGoal && !enrollment && <div className="mb-3 space-y-2">{feedback.text && !feedback.error && <p role="status" className="text-sm">{feedback.text}</p>}<GoalErrorAlert text={readError} /><Button variant="ghost" size="sm" disabled={busy || loading} onClick={() => void refresh()}>刷新核对</Button></div>}
    {feedback.text && !readError && !showModal && !deleteGoal && !enrollment && (feedback.error ? <GoalErrorAlert text={feedback.text} /> : <div className="mb-3 space-y-2"><p className="text-sm text-[var(--text-2)]" role="status">{needsRefresh ? '本机写入已完成，但列表暂未刷新。请刷新核对，无需重复提交' : feedback.text}</p>{needsRefresh && <Button variant="ghost" size="sm" disabled={busy || loading} onClick={() => void refresh()}>刷新核对</Button>}</div>)}
    {!loaded ? <p role="status" className="py-8 text-center text-sm">{goalLoadingMessage(loading, readError)}</p> : filtered.length === 0 ? <div className="py-12 text-center"><Target size={32} className="mx-auto mb-4 text-[var(--text-3)]" aria-hidden /><p className="text-sm">{items.length ? '这个分类还没有目标' : '还没有目标'}</p><p className="mt-2 text-sm text-[var(--text-3)]">从一个可完成的小目标开始，进度按你的实际情况调整</p><Button className="mt-5" onClick={() => openEditor()}>{items.length ? '新建目标' : '创建第一个目标'}</Button></div> : <div className="goal-horizons">{levelFilters.filter(option => option.key !== 'all' && filtered.some(goal => goal.level === option.key)).map(option => <section key={option.key} className="goal-horizon"><div className="planning-section-heading"><h2>{option.label}目标</h2><span>{filtered.filter(goal => goal.level === option.key).length} 个</span></div><div className="goal-records"><AnimatePresence mode="popLayout">{filtered.filter(goal => goal.level === option.key).map((goal) => <GoalCard key={goal.id} goal={goal} status={readError ? '暂无法核对' : statuses[goal.id] ?? (goal.syncScope === 'account' ? '待同步' : '仅本机')} busy={busy} onProgress={(value) => void run(() => useGoalStore.getState().updateProgress(goal.id, value), '进度已保存，可随时调整')} onDelete={() => { setFeedback({ error: false, text: '' }); setDeleteGoal(cloneGoalSnapshot(goal)); }} onEdit={() => openEditor(goal)} />)}</AnimatePresence></div></section>)}</div>}
    <Modal className="max-h-[85vh] overflow-y-auto" open={deleteGoal !== null} onClose={() => { if (!busy) setDeleteGoal(null); }} title="删除这个目标？" footer={<><Button variant="ghost" disabled={busy} onClick={() => setDeleteGoal(null)}>保留目标</Button><Button variant="danger" disabled={busy} onClick={() => { if (deleteGoal) void run(() => useGoalStore.getState().removeGoal(deleteGoal.id, deleteGoal), '目标已移除，账号目标的删除会继续同步', () => setDeleteGoal(null)); }}>{busy ? '删除中…' : '确认删除'}</Button></>}><div className="space-y-4"><p className="whitespace-pre-wrap break-words text-sm leading-6"><strong>{deleteGoal?.title}</strong><br />{deleteGoal?.description || '无描述'}<br />{deleteGoal && goalLevelLabels[deleteGoal.level]} · {deleteGoal?.domain} · {deleteGoal?.priority === 'high' ? '高优先级' : deleteGoal?.priority === 'medium' ? '中优先级' : '低优先级'} · 手动进度 {deleteGoal?.progress}%<br />计划日期 {deleteGoal?.targetDate || '未设置'}<br />这个目标及其手动进度会移除。已同步目标也会从当前账号的其他设备移除；其他记录不会受影响，可先在设置导出备份。</p>{feedback.error && <GoalErrorAlert text={feedback.text} />}</div></Modal>
    <Modal className="max-h-[85vh] overflow-y-auto" open={showModal} onClose={() => { if (!busy) setShowModal(false); }} title={editing ? '编辑目标' : '新建目标'} footer={<><Button variant="ghost" size="sm" disabled={busy} onClick={() => setShowModal(false)}>取消</Button><Button size="sm" onClick={() => void save()} disabled={!title.trim() || busy}>{busy ? '保存中…' : editing ? '保存修改' : '创建'}</Button></>}>
      <div className="space-y-4" data-component="goal-editor">
        <Input label="标题 *" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="想完成什么？" maxLength={100} autoFocus disabled={busy} />
        <Input label="描述（可选）" value={description} onChange={(event) => setDescription(event.target.value)} id="goal-description" aria-label="目标说明" placeholder="这个目标为什么重要？下一步准备做什么？" maxLength={2000} disabled={busy} />
        <Input label="计划日期（可选）" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} disabled={busy} />
        <label className="block text-sm">类型<select className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2" value={level} onChange={(event) => setLevel(event.target.value as GoalLevel)} disabled={busy}>{levelFilters.filter((option) => option.key !== 'all').map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        <label className="block text-sm">领域<select className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2" aria-label="领域" value={domain} onChange={(event) => setDomain(event.target.value)} disabled={busy}>{[...new Set([...domains, domain])].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="block text-sm">优先级<select className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2" value={priority} onChange={(event) => setPriority(event.target.value as GoalPriority)} disabled={busy}>{(['low', 'medium', 'high'] as const).map((value) => <option key={value} value={value}>{value === 'high' ? '高' : value === 'medium' ? '中' : '低'}</option>)}</select></label>
        <p className="text-sm leading-5 text-[var(--text-3)]">{editing?.syncScope !== 'account' && editing ? '这个旧目标仍仅保存在本机，编辑不会自动上传' : '标题、描述、进度和计划日期会同步到你当前的有迹账号'}</p>
        {feedback.error && <GoalErrorAlert text={feedback.text} />}
      </div>
    </Modal>
    <Modal className="max-h-[85vh] overflow-y-auto" open={enrollment !== null} onClose={() => { if (!busy) setEnrollment(null); }} title="选择旧目标同步到账号" footer={<><Button variant="ghost" disabled={busy} onClick={() => setEnrollment(null)}>暂不上传</Button><Button disabled={busy || selected.length === 0 || !user} onClick={() => { if (user && enrollment) void run(() => useGoalStore.getState().enableSync(enrollment.filter((goal) => selected.includes(goal.id)), user.id), '所选目标已加入同步队列，原本机副本保留在导出备份中', () => setEnrollment(null)); }}>{busy ? '保存中…' : `确认上传 ${selected.length} 个目标`}</Button></>}>
      <div className="space-y-3 text-sm"><p>目的账号：{user?.nickname}（{user?.phone ? user.phone.slice(0, 3) + '****' + user.phone.slice(-4) : '当前已验证账号'}）</p><p className="text-sm leading-6 text-[var(--text-2)]">仅同步勾选目标的标题、描述、类型、领域、优先级、进度和计划日期，以及目标编号、创建时间。其他旧字段不上传，完整原稿留在本机备份中。未勾选的目标仍仅在本机；此处不会认领旧共享资料。</p>{enrollment?.map((goal) => <label key={goal.id} className="flex items-start gap-3 rounded-lg border border-[var(--border-light)] p-3"><input className="mt-1 h-5 w-5" type="checkbox" checked={selected.includes(goal.id)} disabled={busy} onChange={(event) => setSelected((value) => event.target.checked ? [...value, goal.id] : value.filter((id) => id !== goal.id))} /><span className="min-w-0 break-words"><strong>{goal.title}</strong><span className="mt-1 block whitespace-pre-wrap text-sm">{goal.description || '无描述'} · {goalLevelLabels[goal.level]} · {goal.domain} · {goal.priority === 'high' ? '高优先级' : goal.priority === 'medium' ? '中优先级' : '低优先级'} · {goal.progress}% · 计划日期 {goal.targetDate || '未设置'}</span>{(goal.targetDate === '' || goal.targetDate === undefined) && <span className="mt-1 block text-sm leading-5 text-[var(--text-2)]">这份旧稿的空日期将按“未设置”保存；原始空值仍留在本机备份中。</span>}</span></label>)}{feedback.error && <GoalErrorAlert text={feedback.text} />}</div>
    </Modal>
  </div>;
}
