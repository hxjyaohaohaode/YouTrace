import { useEffect, useRef, useState } from 'react';
import { useGoalStore, startGoalObservation, cloneLegacyGoalChange, resolveLegacyGoalChange, goalLevelLabels, type LegacyGoalChange } from '../../stores/goalStore';
import { useAuthStore } from '../../stores/authStore';
import { type GoalRecord } from '../../db';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { GoalErrorAlert } from '../goal/GoalErrorAlert';
import { goalFailureMessage } from '../goal/goalErrors';

function GoalPreview({ goal, empty }: { goal: GoalRecord | null; empty: string }) {
  if (!goal) return <p>{empty}</p>;
  return <div className="space-y-1 whitespace-pre-wrap break-words"><p className="font-semibold">{goal.title}</p><p>{goal.description || '无描述'}</p><p>{goal.progress}% · {goalLevelLabels[goal.level] ?? goal.level} · {goal.domain} · {{ high: '高优先级', medium: '中优先级', low: '低优先级' }[goal.priority] ?? goal.priority}</p><p>计划日期 {goal.targetDate || '未设置'}</p></div>;
}

/** Only the verified account's pre-upgrade goal table, never the shared database. */
export function LegacyGoalRecovery() {
  const user = useAuthStore((state) => state.user);
  const changes = useGoalStore((state) => state.legacyChanges);
  const [selected, setSelected] = useState<LegacyGoalChange | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const guard = useRef(false), mounted = useRef(true), operation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const stop = startGoalObservation();
    return () => { mounted.current = false; operation.current += 1; stop(); };
  }, []);
  const resolve = async (choice: 'copy' | 'keep') => {
    if (!selected || !user || guard.current) return;
    const current = ++operation.current;
    guard.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await resolveLegacyGoalChange(selected, choice, user.id);
      if (!mounted.current || current !== operation.current || result.view === 'context-changed') return;
      setSelected(null);
      setNotice(result.view === 'refresh-needed' ? '处理已保存在本机，列表暂未刷新。请刷新核对，无需重复处理' : result.copyId ? '本机副本已生成，尚未上传；原稿和处理记录仍保留' : '已保留当前目标，原稿和处理记录仍保留');
    } catch (cause) {
      if (mounted.current && current === operation.current) setError(goalFailureMessage(cause));
    } finally { if (mounted.current && current === operation.current) { guard.current = false; setBusy(false); } }
  };
  if (!changes.length && !selected && !error && !notice) return null;
  return <aside className="mb-4 space-y-3 rounded-xl border border-[var(--warning)]/30 p-4" data-component="goal-source-recovery">
    <p className="text-sm font-semibold">发现 {changes.length} 份旧窗口目标变动</p>
    <p className="text-xs leading-6 text-[var(--text-2)]">旧窗口的修改、新增或删除没有自动覆盖当前目标，也没有自动上传。请关闭旧版有迹标签页，再逐项比较；原稿始终保留在本机备份中。</p>
    {changes.map((change) => <Button key={change.id} variant="ghost" size="sm" disabled={busy} onClick={() => { setSelected(cloneLegacyGoalChange(change)); setError(''); setNotice(''); }}>比较旧窗口目标：{change.source?.title ?? change.previousSource?.title ?? '未命名'}</Button>)}
    {error && !selected && <GoalErrorAlert text={error} />}
    {notice && !selected && <p className="text-sm leading-6" role="status">{notice}</p>}
    <Modal className="max-h-[85vh] overflow-y-auto" open={Boolean(selected)} onClose={() => { if (!busy) setSelected(null); }} title="比较旧窗口目标变动" footer={<><Button variant="ghost" disabled={busy} onClick={() => void resolve('keep')}>保留当前目标</Button>{selected?.source && <Button disabled={busy} onClick={() => void resolve('copy')}>生成本机副本</Button>}</>}>
      <div className="space-y-4 text-sm"><p>当前账号：{user?.nickname}</p><section><h4 className="mb-2 font-semibold">旧窗口原稿</h4><GoalPreview goal={selected?.source ?? null} empty="旧窗口已删除目标；当前记录不会跟随删除" /></section><section><h4 className="mb-2 font-semibold">当前目标</h4><GoalPreview goal={selected?.current ?? null} empty="当前列表没有这个目标" /></section><p className="text-xs leading-6 text-[var(--text-2)]">生成副本会创建新的本机目标，不上传、不改云端。保留当前目标会归档这次旧窗口变动；两个选项都保留原稿和处理记录，可随备份导出。</p>{error && <GoalErrorAlert text={error} />}</div>
    </Modal>
  </aside>;
}
