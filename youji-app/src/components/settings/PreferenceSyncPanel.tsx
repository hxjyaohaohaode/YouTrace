import { useRef, useState } from 'react';
import { useSettingsStore, type PreferenceSyncStatus } from '../../stores/settingsStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

type Conflict = NonNullable<PreferenceSyncStatus['conflict']>;
const stateLabels = { local: '偏好仅保存在本机', loading: '正在核对账号偏好', synced: '账号偏好已同步', pending: '本机修改已保存，等待云端确认', conflict: '偏好有不同版本，请核对后选择', blocked: '偏好尚未同步，原稿已保留' };
function PreferenceValues({ values }: { values: Conflict['local'] }) {
  return <dl className="space-y-1 text-xs leading-6">
    <div><dt className="inline">教练风格：</dt><dd className="inline">{values.coachStyle === 'gentle' ? '温柔型' : values.coachStyle === 'strict' ? '严格型' : '数据型'}</dd></div>
    <div><dt className="inline">教练提醒：</dt><dd className="inline">{values.coachPushEnabled ? '开启' : '关闭'} · 每设备每日最多 {values.coachPushFrequency} 条</dd></div>
    <div><dt className="inline">免打扰：</dt><dd className="inline">{values.quietHours.enabled ? '开启' : '关闭'} · {values.quietHours.start} 至 {values.quietHours.end}</dd></div>
    <div><dt className="inline">晚间复盘：</dt><dd className="inline">{values.eveningReviewEnabled ? '开启' : '关闭'} · {values.eveningReviewTime}</dd></div>
  </dl>;
}
export function PreferenceSyncPanel() {
  const status = useSettingsStore((state) => state.preferenceSync);
  const [selected, setSelected] = useState<Conflict | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const guard = useRef(false);
  const perform = async (choice?: 'local' | 'server') => {
    if (guard.current) return;
    guard.current = true; setBusy(true); setError('');
    try {
      if (choice && selected) { await useSettingsStore.getState().resolvePreferenceConflict(choice, selected.id); setSelected(null); }
      else await useSettingsStore.getState().syncPreferences();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '尚未处理，请稍后重试'); }
    finally { guard.current = false; setBusy(false); }
  };
  return <section className="space-y-2 rounded-xl border border-[var(--border-light)] bg-[var(--surface)] p-4" aria-label="账号偏好同步" data-component="preference-sync">
    <p className="text-sm font-semibold" role="status">{stateLabels[status.state]}</p>
    <p className="text-xs leading-6 text-[var(--text-2)]">教练风格、提醒开关、免打扰及晚间复盘随账号同步。各设备在启动、回到应用或手动同步时核对；外观与预算仍按设备保留。每日条数是每设备上限。</p>
    {status.state === 'conflict' && <p className="text-xs leading-6 text-[var(--warning)]">比较期间暂不生成新教练提醒，已有消息保留。</p>}
    {(status.error || error) && <p role="alert" className="text-xs text-[var(--danger)]">{error || status.error}</p>}
    <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" disabled={busy} onClick={() => void perform()}>{busy ? '核对中…' : '重新核对账号偏好'}</Button>{status.conflict && <Button size="sm" disabled={busy} onClick={() => { setSelected(structuredClone(status.conflict!)); setError(''); }}>比较偏好版本</Button>}</div>
    <Modal open={Boolean(selected)} onClose={() => { if (!busy) setSelected(null); }} title="比较账号偏好" footer={<><Button variant="ghost" disabled={busy} onClick={() => void perform('server')}>使用云端偏好</Button><Button disabled={busy} onClick={() => void perform('local')}>保留本机选择并同步</Button></>}>
      <div className="space-y-4"><section><h4 className="mb-2 text-sm font-semibold">本机保留的选择</h4>{selected && <PreferenceValues values={selected.local} />}</section><section><h4 className="mb-2 text-sm font-semibold">当前云端版本</h4>{selected && <PreferenceValues values={selected.remote} />}</section><p className="text-xs leading-6 text-[var(--text-2)]">两个版本与此次选择都会留在本机恢复记录中，可随数据备份导出。选择本机版本仍需云端确认；未确认前不会显示已同步。</p>{error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}</div>
    </Modal>
  </section>;
}
