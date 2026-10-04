import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { liveQuery } from 'dexie';
import { Link } from 'react-router-dom';
import { Target, Plus, Trash2, Pencil, CloudUpload } from 'lucide-react';
import { db, type GoalRecord } from '../db';
import { useAuthStore } from '../stores/authStore';
import { useGoalStore, goalLevelLabels, goalPriorityColors, type GoalLevel, type GoalPriority, type GoalView } from '../stores/goalStore';
import { PageHeader } from '../components/layout/PageHeader';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { LegacyGoalRecovery } from '../components/settings/LegacyGoalRecovery';
import { recordDiagnostic } from '../services/diagnostics';

const levelFilters: Array<{ key: GoalLevel | 'all'; label: string }> = [{ key: 'all', label: '全部' }, { key: 'short', label: '短期' }, { key: 'medium', label: '中期' }, { key: 'long', label: '长期' }];
const domains = ['健康', '财务', '学习', '职业', '生活', '社交'];
type GoalStatus = '仅本机' | '待同步' | '需要比较版本' | '需要检查' | '已同步';

function GoalCard({ goal, status, busy, onProgress, onDelete, onEdit }: {
  goal: GoalView; status: GoalStatus; busy: boolean;
  onProgress: (value: number) => void; onDelete: () => void; onEdit: () => void;
}) {
  const reduced = useReducedMotion();
  const validProgress = Number.isFinite(goal.progress) && goal.progress >= 0 && goal.progress <= 100;
  const isDone = validProgress && goal.progress >= 100;
  return <motion.article layout={!reduced} initial={{ opacity: 0, y: reduced ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.18 }} aria-label={`目标 ${goal.title}`} data-component="goal-card" className={`rounded-[var(--radius-lg)] border bg-[var(--surface)] p-4 ${isDone ? 'border-[var(--success)]/40' : 'border-[var(--border-light)]'}`}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${goalPriorityColors[goal.priority]}`}>{goal.priority === 'high' ? '高' : goal.priority === 'medium' ? '中' : '低'}</span><span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] text-[var(--text-2)]">{goal.domain}</span><span className="text-[10px] text-[var(--text-3)]">{status}</span></div>
        <h2 className="break-words text-[13px] font-bold text-[var(--text-1)]">{goal.title}</h2>
        {goal.description && <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-[var(--text-2)]">{goal.description}</p>}
        {goal.targetDate && <p className="mt-1 text-xs text-[var(--text-3)]">计划日期 {goal.targetDate}</p>}
      </div>
      <button type="button" disabled={busy} onClick={onEdit} aria-label={'编辑目标 ' + goal.title} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-2)] hover:bg-[var(--surface-2)]"><Pencil size={15} aria-hidden /></button>
      <button type="button" disabled={busy} onClick={onDelete} aria-label={'删除目标 ' + goal.title} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-3)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"><Trash2 size={15} aria-hidden /></button>
    </div>
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-xs"><span className="text-[var(--text-3)]">{goalLevelLabels[goal.level]}</span><span className="font-mono text-[var(--primary)]">{validProgress ? `${goal.progress}%` : '待校正'}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]" role="progressbar" aria-label={`${goal.title}手动进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={validProgress ? goal.progress : undefined}><motion.div initial={false} animate={{ width: (validProgress ? goal.progress : 0) + '%' }} transition={{ duration: reduced ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }} className={'h-full rounded-full ' + (isDone ? 'bg-[var(--success)]' : 'bg-[var(--primary)]')} /></div>
      <div className="mt-2 flex gap-1" role="group" aria-label="手动调整目标进度">{[0, 25, 50, 75, 100].map((value) => <button key={value} type="button" disabled={busy} onClick={() => onProgress(value)} aria-label={`将目标进度设为 ${value}%`} aria-pressed={goal.progress === value} className={`min-h-10 flex-1 rounded-full text-xs font-semibold transition-colors ${goal.progress === value ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'text-[var(--text-3)] hover:bg-[var(--surface-2)]'}`}>{value}%</button>)}</div>
      {(status === '需要比较版本' || status === '需要检查') && <Link to="/settings" className="mt-2 inline-block text-xs text-[var(--primary)] underline">{status === '需要比较版本' ? '比较本机与云端版本' : '检查同步状态与备份'}</Link>}
    </div>
  </motion.article>;
}

export default function Goal() {
  const items = useGoalStore((state) => state.items);
  const loaded = useGoalStore((state) => state.loaded);
  const user = useAuthStore((state) => state.user);
  const [statuses, setStatuses] = useState<Record<string, GoalStatus>>({});
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
  const [feedback, setFeedback] = useState({ error: false, text: '' });
  const [enrollment, setEnrollment] = useState<GoalRecord[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    const sub = liveQuery(async () => {
      const [goals, outbox, settings] = await Promise.all([db.goalRecords.toArray(), db.outbox.toArray(), db.settings.toArray()]);
      const pendingGoals = new Set<string>(), blockedGoals = new Set<string>();
      for (const row of outbox) if (row.entity === 'goals') { const id = row.op === 'delete' ? String(row.payload) : (row.payload as { id: string }).id; pendingGoals.add(id); if (row.status === 'blocked') blockedGoals.add(id); }
      const metadata = new Map(settings.map((row) => [row.key, row.value]));
      return { goals, statuses: Object.fromEntries(goals.map((goal) => {
        const pending = pendingGoals.has(goal.id);
        const conflict = metadata.has(`sync-conflict:goals:${goal.id}`);
        const blocked = blockedGoals.has(goal.id);
        const confirmed = metadata.has(`sync-version:goals:${goal.id}`) && metadata.get(`sync-version:goals:${goal.id}`) !== '0';
        return [goal.id, conflict ? '需要比较版本' : blocked ? '需要检查' : goal.syncScope !== 'account' ? '仅本机' : pending || !confirmed ? '待同步' : '已同步'];
      })) as Record<string, GoalStatus> };
    }).subscribe({ next: ({ goals, statuses: next }) => { setStatuses(next); const order = { short: 0, medium: 1, long: 2 }; goals.sort((a, b) => order[a.level] - order[b.level] || b.createdAt - a.createdAt); useGoalStore.setState({ items: goals, loaded: true }); }, error: () => setFeedback({ error: true, text: '暂时无法读取目标同步状态，原稿仍保留，请稍后刷新' }) });
    return () => sub.unsubscribe();
  }, []);

  const filtered = useMemo(() => items.filter((goal) => filter === 'all' || goal.level === filter), [items, filter]);
  const localGoals = items.filter((goal) => goal.syncScope !== 'account');
  const validGoals = items.filter((goal) => Number.isFinite(goal.progress) && goal.progress >= 0 && goal.progress <= 100);
  const invalidProgressCount = items.length - validGoals.length;
  const doneCount = validGoals.filter((goal) => goal.progress >= 100).length;
  const avgProgress = validGoals.length ? Math.round(validGoals.reduce((sum, goal) => sum + goal.progress, 0) / validGoals.length) : 0;
  const run = async (action: () => Promise<void>, success: string) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setFeedback({ error: false, text: '' });
    try { await action(); setFeedback({ error: false, text: success }); }
    catch (error) { setFeedback({ error: true, text: error instanceof Error ? error.message : '保存失败，输入仍保留，请重试' }); recordDiagnostic('runtime-error', 'goals'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const openEditor = (goal?: GoalRecord) => {
    if (busyRef.current) return;
    if (goal) { setEditing({ ...goal }); setTitle(goal.title); setDescription(goal.description); setTargetDate(goal.targetDate ?? ''); setLevel(goal.level); setDomain(goal.domain); setPriority(goal.priority); }
    else if (editing) { setEditing(null); setTitle(''); setDescription(''); setTargetDate(''); }
    setShowModal(true);
  };
  const save = () => run(async () => {
    const values = { title, description, level, domain, priority, targetDate: targetDate || null };
    if (editing) await useGoalStore.getState().updateGoal(editing.id, values, editing);
    else await useGoalStore.getState().addGoal(values);
    setTitle(''); setDescription(''); setTargetDate(''); setEditing(null); setShowModal(false);
  }, editing ? '目标已保存在本机，账号目标会继续同步' : '目标已保存在本机，等待账号同步确认');

  return <div className="w-full" data-component="goal-workspace">
    <PageHeader icon={Target} gradient="from-[#7C6FFF] to-[#B06AFF]" title="目标" subtitle={`${doneCount}/${items.length} 完成 · 平均进度 ${avgProgress}%`} actions={<Button onClick={() => openEditor()} disabled={busy} aria-label="新建目标"><Plus size={18} aria-hidden /></Button>} />
    <p className="mb-4 text-xs leading-6 text-[var(--text-3)]">进度由你手动确认，可随时调回。新目标同步到当前账号；断网时先保留本机修改，收到云端确认后显示“已同步”。</p>
    {invalidProgressCount > 0 && <p role="status" className="mb-4 text-xs text-[var(--warning)]">{invalidProgressCount} 份旧目标的进度需要校正，原值已保留且未计入平均进度。请手动选择实际进度后再同步。</p>}
    <LegacyGoalRecovery />
    {localGoals.length > 0 && <aside className="mb-4 rounded-xl border border-[var(--warning)]/30 p-3 text-xs leading-6" data-component="goal-enrollment"><p>{localGoals.length} 个旧目标仍仅保存在本机。由你选择是否上传，未选择的不会自动同步。</p><Button variant="ghost" size="sm" disabled={busy || !user} onClick={() => { setEnrollment(localGoals.map((goal) => ({ ...goal }))); setSelected([]); }}><CloudUpload size={14} aria-hidden />选择同步旧目标</Button></aside>}
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="目标类型筛选">{levelFilters.map((option) => <button key={option.key} type="button" onClick={() => setFilter(option.key)} aria-pressed={filter === option.key} className={`min-h-10 shrink-0 rounded-full px-3.5 text-xs font-semibold ${filter === option.key ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'bg-[var(--surface-2)] text-[var(--text-2)]'}`}>{option.label}</button>)}</div>
    {feedback.text && <p className={`mb-3 text-sm ${feedback.error ? 'text-[var(--danger)]' : 'text-[var(--text-2)]'}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
    {!loaded ? <p role="status" className="py-8 text-center text-sm">正在读取目标…</p> : filtered.length === 0 ? <div className="py-12 text-center"><Target size={32} className="mx-auto mb-4 text-[var(--text-3)]" aria-hidden /><p className="text-sm">{items.length ? '这个分类还没有目标' : '还没有目标'}</p><p className="mt-2 text-xs text-[var(--text-3)]">从一个可完成的小目标开始，进度按你的实际情况调整</p><Button className="mt-5" onClick={() => openEditor()}>{items.length ? '新建目标' : '创建第一个目标'}</Button></div> : <div className="space-y-3"><AnimatePresence mode="popLayout">{filtered.map((goal) => <GoalCard key={goal.id} goal={goal} status={statuses[goal.id] ?? (goal.syncScope === 'account' ? '待同步' : '仅本机')} busy={busy} onProgress={(value) => void run(() => useGoalStore.getState().updateProgress(goal.id, value), '进度已保存，可随时调整')} onDelete={() => setDeleteGoal({ ...goal })} onEdit={() => openEditor(goal)} />)}</AnimatePresence></div>}
    <Modal open={deleteGoal !== null} onClose={() => { if (!busy) setDeleteGoal(null); }} title="删除这个目标？" footer={<><Button variant="ghost" disabled={busy} onClick={() => setDeleteGoal(null)}>保留目标</Button><Button variant="danger" disabled={busy} onClick={() => void run(async () => { if (deleteGoal) await useGoalStore.getState().removeGoal(deleteGoal.id, deleteGoal); setDeleteGoal(null); }, '目标已移除，账号目标的删除会继续同步')}>{busy ? '删除中…' : '确认删除'}</Button></>}><p className="break-words text-sm">“{deleteGoal?.title}”及其手动进度会移除。已同步目标也会从当前账号的其他设备移除；其他记录不会受影响，可先在设置导出备份。</p></Modal>
    <Modal open={showModal} onClose={() => { if (!busy) setShowModal(false); }} title={editing ? '编辑目标' : '新建目标'} footer={<><Button variant="ghost" size="sm" disabled={busy} onClick={() => setShowModal(false)}>取消</Button><Button size="sm" onClick={() => void save()} disabled={!title.trim() || busy}>{busy ? '保存中…' : editing ? '保存修改' : '创建'}</Button></>}>
      <div className="space-y-4" data-component="goal-editor">
        <Input label="标题 *" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="想完成什么？" maxLength={100} autoFocus disabled={busy} />
        <Input label="描述（可选）" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="补充说明..." maxLength={2000} disabled={busy} />
        <Input label="计划日期（可选）" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} disabled={busy} />
        <label className="block text-sm">类型<select className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2" value={level} onChange={(event) => setLevel(event.target.value as GoalLevel)} disabled={busy}>{levelFilters.filter((option) => option.key !== 'all').map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        <label className="block text-sm">领域<select className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2" aria-label="领域" value={domain} onChange={(event) => setDomain(event.target.value)} disabled={busy}>{[...new Set([...domains, domain])].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="block text-sm">优先级<select className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2" value={priority} onChange={(event) => setPriority(event.target.value as GoalPriority)} disabled={busy}>{(['low', 'medium', 'high'] as const).map((value) => <option key={value} value={value}>{value === 'high' ? '高' : value === 'medium' ? '中' : '低'}</option>)}</select></label>
        <p className="text-xs leading-5 text-[var(--text-3)]">{editing?.syncScope !== 'account' && editing ? '这个旧目标仍仅保存在本机，编辑不会自动上传' : '标题、描述、进度和计划日期会同步到你当前的有迹账号'}</p>
        {feedback.error && <p role="alert" className="text-sm text-[var(--danger)]">{feedback.text}</p>}
      </div>
    </Modal>
    <Modal open={enrollment !== null} onClose={() => { if (!busy) setEnrollment(null); }} title="选择旧目标同步到账号" footer={<><Button variant="ghost" disabled={busy} onClick={() => setEnrollment(null)}>暂不上传</Button><Button disabled={busy || selected.length === 0 || !user} onClick={() => void run(async () => { if (!user || !enrollment) return; await useGoalStore.getState().enableSync(enrollment.filter((goal) => selected.includes(goal.id)), user.id); setEnrollment(null); }, '所选目标已加入同步队列，原本机副本保留在导出备份中')}>{busy ? '保存中…' : `确认上传 ${selected.length} 个目标`}</Button></>}>
      <div className="space-y-3 text-sm"><p>目的账号：{user?.nickname}（{user?.phone ? user.phone.slice(0, 3) + '****' + user.phone.slice(-4) : '当前已验证账号'}）</p><p className="text-xs leading-6 text-[var(--text-2)]">仅上传你勾选的目标及标题、描述、进度、计划日期。原本机副本会保留在导出备份中。未选择的仍仅在本机；旧共享资料不会在这里自动认领。</p>{enrollment?.map((goal) => <label key={goal.id} className="flex items-start gap-3 rounded-lg border border-[var(--border-light)] p-3"><input className="mt-1 h-5 w-5" type="checkbox" checked={selected.includes(goal.id)} disabled={busy} onChange={(event) => setSelected((value) => event.target.checked ? [...value, goal.id] : value.filter((id) => id !== goal.id))} /><span className="min-w-0 break-words"><strong>{goal.title}</strong><span className="mt-1 block whitespace-pre-wrap text-xs">{goal.description || '无描述'} · {goalLevelLabels[goal.level]} · {goal.domain} · {goal.priority === 'high' ? '高优先级' : goal.priority === 'medium' ? '中优先级' : '低优先级'} · {goal.progress}%{goal.targetDate ? ' · ' + goal.targetDate : ''}</span></span></label>)}{feedback.error && <p role="alert" className="text-[var(--danger)]">{feedback.text}</p>}</div>
    </Modal>
  </div>;
}
