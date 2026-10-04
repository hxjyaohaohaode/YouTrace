import { useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DiaryEditor } from './DiaryEditor';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, BookOpen, Sparkles, ChevronDown, ChevronUp, Edit3, Trash2 } from 'lucide-react';
import { useDiaryStore } from '../../stores/diaryStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { RingProgress } from '../ui/ProgressBar';
import { toast } from '../../services/toastBus';
import type { DiaryRecord } from '../../db';
import { formatDateLabel } from '../../utils/date';
import { getMoodMeta } from '../../utils/icons';

function DiaryEntryCard({ item, onEdit, onDelete }: { item: DiaryRecord; onEdit: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const moodInfo = getMoodMeta(item.mood);

  return (
    <motion.div
      layout
      id={`diary-record-${item.id}`}
      tabIndex={-1}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-light)] bg-[var(--surface)]"
    >
      <div className="px-5 py-4">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-bold text-[var(--text-1)]">{item.date} · {formatDateLabel(item.date)}</span>
            {moodInfo && (
              <span
                className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold"
                style={{
                  background: `linear-gradient(135deg, ${moodInfo.color}18, ${moodInfo.color}08)`,
                  color: moodInfo.color,
                  border: `1px solid ${moodInfo.color}20`,
                }}
              >
                <span aria-hidden>{moodInfo.emoji}</span>
                <span>{moodInfo.label}</span>
                {item.moodScore !== null && <span className="opacity-60">{item.moodScore}/10</span>}
              </span>
            )}
            {!moodInfo && <span className="text-xs text-[var(--text-3)]">{item.mood || '未记录心情'}</span>}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onEdit} className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]" aria-label={`编辑${formatDateLabel(item.date)}的日记`}>
              <Edit3 size={15} aria-hidden />
            </button>
            <button type="button" onClick={onDelete} className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--danger)]" aria-label={`删除${formatDateLabel(item.date)}的日记`}>
              <Trash2 size={15} aria-hidden />
            </button>
          </div>
        </div>

        <p className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--text-1)] ${!expanded ? 'line-clamp-3' : ''}`}>
          {item.content}
        </p>

        {item.content.length > 100 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            className="mt-1.5 flex items-center gap-0.5 text-xs font-semibold text-[var(--primary)]"
          >
            {expanded ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
            {expanded ? '收起' : '展开'}
          </button>
        )}

        {item.aiInsight && expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-3 rounded-[var(--radius-md)] bg-gradient-to-r from-[var(--primary-soft)] to-[var(--primary-muted)] border border-[var(--primary)]/10 px-3 py-2.5"
          >
            <div className="mb-1 flex items-center gap-1.5">
              <Sparkles size={12} className="text-[var(--primary)]" aria-hidden />
              <span className="text-[11px] font-bold text-[var(--primary)]">AI 洞察</span>
            </div>
            <p className="text-xs leading-relaxed text-[var(--primary)]/80">{item.aiInsight}</p>
          </motion.div>
        )}

        {item.source !== 'manual' && (
          <div className="mt-2 flex items-center gap-1 text-[10px] font-medium text-[var(--text-3)]">
            {item.source === 'quicknote_aggregated' && '📝 来自已确认速记'}
            {item.source === 'ai_generated' && '🤖 AI 生成'}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function DiaryContent() {
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<DiaryRecord | undefined>(undefined);
  const [formKey, setFormKey] = useState(0);
  const [recoveryId, setRecoveryId] = useState<string | undefined>();
  const [dismissed, setDismissed] = useState('');
  const [routeSnapshot, setRouteSnapshot] = useState<{ key: string; item: DiaryRecord } | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [deleteConfirm, setDeleteConfirm] = useState<DiaryRecord | null>(null);
  const items = useDiaryStore((s) => s.items);
  const removeItem = useDiaryStore((s) => s.removeItem);
  const loaded = useDiaryStore((s) => s.loaded);
  const loadError = useDiaryStore((s) => s.loadError);
  const recordId = new URLSearchParams(location.search).get('record');
  const target = recordId ? items.find((item) => item.id === recordId) : undefined;
  const requestKey = `${location.key}:${recordId ?? ''}`;
  if (loaded && target && routeSnapshot?.key !== requestKey) setRouteSnapshot({ key: requestKey, item: target });
  const requestedItem = loaded && dismissed !== requestKey && routeSnapshot?.key === requestKey ? routeSnapshot.item : undefined;
  const source = (location.state as { returnTo?: { path?: string; label?: string } } | null)?.returnTo;
  const returnPath = source?.path?.startsWith('/') && !source.path.startsWith('//') ? source.path : null;

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
    [items]
  );

  const avgMoodScore = useMemo(() => {
    const scored = items.filter((i) => i.mood && typeof i.moodScore === 'number' && i.moodScore > 0);
    if (scored.length === 0) return 0;
    return Math.round((scored.reduce((sum, i) => sum + (i.moodScore ?? 0), 0) / scored.length) * 10) / 10;
  }, [items]);

  const openCreate = () => {
    setDismissed(requestKey); setRecoveryId(undefined);
    setEditItem(undefined);
    setFormKey((k) => k + 1);
    setShowModal(true);
  };

  const openEdit = (item: DiaryRecord) => {
    setDismissed(requestKey); setRecoveryId(undefined);
    setEditItem(item);
    setFormKey((k) => k + 1);
    setShowModal(true);
  };

  const handleDelete = async () => {
    if (deleteConfirm === null || deleting) return;
    setDeleting(true); setDeleteError('');
    try {
      await removeItem(deleteConfirm.id, deleteConfirm);
      toast.success('日记已从本机删除'); setDeleteConfirm(null);
    } catch (reason) { setDeleteError(reason instanceof Error ? reason.message : '删除失败，请重试'); }
    finally { setDeleting(false); }
  };

  const closeEditor = (saved?: DiaryRecord) => {
    const focusId = saved?.id ?? editItem?.id ?? target?.id;
    setShowModal(false); setEditItem(undefined); setRecoveryId(undefined); setDismissed(requestKey);
    if (focusId) window.setTimeout(() => { const row = document.getElementById(`diary-record-${focusId}`); row?.scrollIntoView({ block: 'center' }); row?.focus(); }, 250);
  };
  const openLinkedRecord = (id: string) => {
    setShowModal(false); setEditItem(undefined); setRecoveryId(undefined); setDismissed('');
    navigate(`/diary?record=${encodeURIComponent(id)}`, { replace: true, state: location.state });
  };

  return (
    <div className="space-y-4">
      {returnPath && <Button variant="ghost" onClick={() => { if (window.history.state?.idx > 0) navigate(-1); else navigate(returnPath); }}>← {source?.label || '返回来源'}</Button>}
      {!loaded && <section role="status" className="space-y-2 rounded-xl border border-[var(--border)] p-4"><p>{loadError ? `日记暂未读出：${loadError}` : '正在查找日记；若等待较久，可重试读取'}</p><Button variant="soft" onClick={() => void useDiaryStore.getState().loadFromDB().catch(() => undefined)}>重试读取</Button></section>}
      {recordId && loaded && !target && <section role="status" className="space-y-2 rounded-xl border border-[var(--border)] p-4"><p>当前账号未找到这篇日记。它可能已删除，或尚未同步到本机。</p><Button variant="soft" onClick={() => { setRecoveryId(recordId); setDismissed(requestKey); }}>查看此记录的本机编辑稿</Button></section>}
      {target && dismissed === requestKey && <Button variant="soft" onClick={() => openEdit(target)}>重新打开 {target.date} 的日记</Button>}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-[var(--text-1)]">日记</h1>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={openCreate}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] shadow-[var(--shadow-glow)] text-white transition-colors"
          aria-label="写日记"
        >
          <Plus size={18} aria-hidden />
        </motion.button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[var(--radius-lg)] bg-gradient-to-br from-[var(--primary-soft)] to-[var(--primary-muted)] border border-[var(--primary)]/15 p-4">
          <div className="mb-1.5 flex items-center gap-2">
            <BookOpen size={16} className="text-[var(--primary)]" aria-hidden />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)]">日记总数</span>
          </div>
          <p className="text-2xl font-bold tracking-tight text-[var(--text-1)]">{items.length}</p>
        </div>
        <div className="rounded-[var(--radius-lg)] bg-gradient-to-br from-[var(--accent-soft)] to-[var(--primary-muted)] border border-[var(--accent)]/15 p-4">
          <div className="mb-1.5 flex items-center gap-2">
            <RingProgress value={avgMoodScore} max={10} size={28} strokeWidth={4} />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)]">平均心情</span>
          </div>
          <p className="text-2xl font-bold tracking-tight text-[var(--text-1)]">{avgMoodScore || '-'}</p>
        </div>
      </div>

      {sortedItems.length === 0 && loaded ? (
        <div className="py-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--surface-2)]">
            <BookOpen size={28} className="text-[var(--text-3)]" aria-hidden />
          </div>
          <p className="text-sm font-medium text-[var(--text-3)]">还没有日记</p>
          <p className="mt-1 text-xs text-[var(--text-3)]">写下第一篇，或用速记整理后确认保存</p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)] px-5 py-2.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Plus size={14} aria-hidden />
            写第一篇日记
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {sortedItems.map((item) => (
              <DiaryEntryCard
                key={item.id}
                item={item}
                onEdit={() => openEdit(item)}
                onDelete={() => { setDeleteError(''); setDeleteConfirm(item); }}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {(showModal || editItem || requestedItem || recoveryId) && <DiaryEditor key={`${editItem?.id ?? requestedItem?.id ?? recoveryId ?? 'new'}:${formKey}`} item={editItem ?? requestedItem} recoveryId={recoveryId} onClose={closeEditor} onOpenRecord={openLinkedRecord} />}

      <Modal
        open={deleteConfirm !== null}
        onClose={() => { if (!deleting) setDeleteConfirm(null); }}
        title="确认删除"
        footer={
          <>
            <Button variant="ghost" size="sm" disabled={deleting} onClick={() => setDeleteConfirm(null)}>取消</Button>
            <Button variant="danger" size="sm" disabled={deleting} onClick={handleDelete}>{deleting ? '删除中…' : '删除'}</Button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-1)]">确定要删除 {deleteConfirm?.date} 的这篇日记吗？删除会同步，此操作不可撤销。</p>{deleteError && <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{deleteError}</p>}
      </Modal>
    </div>
  );
}
