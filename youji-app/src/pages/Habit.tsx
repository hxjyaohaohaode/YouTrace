import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { HabitList } from '../components/habit/HabitList';
import { PageHeader } from '../components/layout/PageHeader';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { useHabitStore } from '../stores/habitStore';
import { getToday } from '../utils/date';
import { isCaptureDate } from '../services/parser';
import { habitErrorMessage } from '../components/habit/habitErrors';
export default function Habit() {
  const location = useLocation(), navigate = useNavigate(), params = new URLSearchParams(location.search);
  const id = params.get('record'), date = params.get('date');
  const rows = useHabitStore(state => state.items), loaded = useHabitStore(state => state.loaded), setHabitDone = useHabitStore(state => state.setHabitDone);
  const selected = rows.find(row => row.id === id);
  const done = selected ? selected.checkinSources.some(row => row.date === date && row.done) : null;
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const returnTo = (location.state as { returnTo?: { path: string; label: string } } | null)?.returnTo;
  const close = () => returnTo?.path.startsWith('/') ? navigate(returnTo.path) : navigate('/habit', { replace: true });
  const change = async () => { if (!selected || !date || saving) return; setSaving(true); setError(''); try { const result = await setHabitDone(selected, date, !done); if (!result.viewUpdated) setError('修改已保存在本机，页面暂未刷新，请返回后核对；无需重复提交'); } catch (cause) { setError(habitErrorMessage(cause)); } finally { setSaving(false); } };
  return <div className="w-full"><PageHeader icon={Sparkles} gradient="from-[var(--success)] to-[#3FBF7E]" title="习惯" subtitle="按自己的节奏，记录已经做到的事" /><HabitList />
    {id && <Modal open onClose={() => { if (!saving) close(); }} title={selected ? `${selected.name} · ${date ?? '日期未知'}` : '定位习惯'} footer={<Button variant="ghost" disabled={saving} onClick={close}>{returnTo?.label ?? '返回习惯'}</Button>}>
      {!loaded ? <p role="status">正在寻找这条习惯…</p> : !selected ? <p role="alert">当前账号没有这条习惯，或已删除。不会用同名记录代替。</p> : !isCaptureDate(date) ? <p role="alert">缺少有效日期，请回到来源记录核对。</p> : <div className="space-y-4"><p className="text-lg font-semibold">{selected.icon} {selected.name}</p><p>{date} · {done === null ? '正在读取…' : done ? '已完成' : '尚未打卡'}</p><p className="text-sm text-[var(--text-3)]">这是所选日期的记录，不会更改其他日期。记录不准确时可以撤销或补卡。</p>{error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}<Button disabled={saving || done === null || date > getToday()} onClick={() => void change()}>{saving ? '正在保存…' : done ? '撤销这天的打卡' : '补记这天已完成'}</Button></div>}
    </Modal>}
  </div>;
}
