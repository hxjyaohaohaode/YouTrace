import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../../db';
import { acceptRemoteConflict, readConflictSnapshot, type ConflictSnapshot, type SyncConflict } from '../../services/syncEngine';
import { loadAllStores } from '../../hooks/useAppInit';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { toast } from '../../services/toastBus';

const labels: Record<string, string> = { goals: '目标', todos: '待办', expenses: '花销', schedules: '日程', habits: '习惯', habitCheckins: '打卡', diaries: '日记', quickNotes: '速记' };
function preview(value: unknown): string {
  if (!value || typeof value !== 'object') return '记录已删除';
  const row = value as Record<string, unknown>;
  if (typeof row.progress === 'number' && typeof row.title === 'string') return `${row.title}\n进度 ${row.progress}%${row.targetDate ? ` · 计划日期 ${String(row.targetDate)}` : ''}\n${String(row.description ?? '')}\n类型 ${String(row.level ?? '')} · 领域 ${String(row.domain ?? '')} · 优先级 ${String(row.priority ?? '')}`.slice(0, 3000);
  return String(row.text ?? row.title ?? row.name ?? row.content ?? row.rawInput ?? (row.done ? '已完成' : '未完成')).slice(0, 3000);
}
export function SyncConflictPanel() {
  const [rows, setRows] = useState<Array<{ key: string; conflict: SyncConflict; local: unknown }>>([]);
  const [selected, setSelected] = useState<{ key: string; snapshot: ConflictSnapshot } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const subscription = liveQuery(async () => {
      const settings = await db.settings.toArray();
      return Promise.all(settings.filter((row) => row.key.startsWith('sync-conflict:')).map(async (row) => {
        const conflict = row.value as SyncConflict;
        return { key: row.key, conflict, local: await db.table(conflict.event.entity === 'diaries' ? 'diary' : conflict.event.entity === 'goals' ? 'goalRecords' : conflict.event.entity).get(conflict.event.entityId) };
      }));
    }).subscribe({ next: setRows, error: () => toast.warning('暂时无法读取冲突记录，可先导出备份') });
    return () => subscription.unsubscribe();
  }, []);
  const current = selected ? { key: selected.key, local: selected.snapshot.local, conflict: { event: selected.snapshot.event } } : null;
  const compare = async (key: string) => {
    try { const snapshot = await readConflictSnapshot(key); if (snapshot) setSelected({ key, snapshot }); else toast.info('冲突已处理，请核对当前记录'); }
    catch { toast.error('暂时无法读取比较内容，请稍后重试'); }
  };
  const accept = async () => {
    if (!current || !selected || busy) return;
    setBusy(true);
    try { await acceptRemoteConflict(current.key, selected.snapshot); await loadAllStores(); setSelected(null); toast.success('已采用云端版本，本地原稿副本保留在导出备份中'); }
    catch (error) { toast.error(error instanceof Error ? error.message : '处理失败，两个版本仍保留'); }
    finally { setBusy(false); }
  };
  if (!rows.length) return null;
  return <div className="space-y-3 rounded-2xl border border-[var(--warning)]/30 p-4">
    <p className="text-sm font-semibold">{rows.length} 条记录存在不同版本</p>
    <p className="text-xs text-[var(--text-2)]">本地修改与云端版本均已保留。可以先导出备份，再逐条决定；不会静默覆盖。</p>
    {rows.map((row) => <Button key={row.key} size="sm" variant="ghost" onClick={() => void compare(row.key)}>比较{labels[row.conflict.event.entity]}版本</Button>)}
    <Modal open={Boolean(current)} onClose={() => { if (!busy) setSelected(null); }} title="比较记录版本" footer={<><Button variant="ghost" disabled={busy} onClick={() => setSelected(null)}>暂不处理</Button><Button disabled={busy} onClick={() => void accept()}>{busy ? '处理中…' : '采用云端版本'}</Button></>}>
      <div className="space-y-4 text-sm"><section><h4 className="font-semibold">本设备原稿</h4><p className="mt-1 whitespace-pre-wrap break-words">{preview(current?.local)}</p></section><section><h4 className="font-semibold">云端版本</h4><p className="mt-1 whitespace-pre-wrap break-words">{preview(current?.conflict.event.data)}</p></section><p className="text-xs text-[var(--text-3)]">采用云端后，本地原稿和对应未同步修改会移入恢复副本，可随导出备份取出。选择云端删除也会从当前列表移除记录。</p></div>
    </Modal>
  </div>;
}
