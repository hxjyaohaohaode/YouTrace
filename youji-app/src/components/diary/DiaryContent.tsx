import { useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DiaryEditor } from './DiaryEditor';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, BookOpen, Sparkles, ChevronDown, ChevronUp, Edit3, Trash2 } from 'lucide-react';
import { useDiaryStore } from '../../stores/diaryStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { toast } from '../../services/toastBus';
import type { DiaryRecord } from '../../db';
import { getToday, formatDateLabel } from '../../utils/date';
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
      className="diary-entry"
    >
      <div className="diary-entry-body">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="diary-entry-date">{item.date} <span>· {formatDateLabel(item.date)}</span></span>
            {moodInfo && (
              <span
                className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold"
                style={{
                  background: 'var(--surface-2)',
                  color: 'var(--text-2)',
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

        <p className={`diary-prose whitespace-pre-wrap break-words ${item.content.length > 400 && !expanded ? 'line-clamp-6' : ''}`}>
          {item.content}
        </p>

        {(item.content.length > 400 || item.aiInsight) && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            className="mt-1.5 flex items-center gap-0.5 text-xs font-semibold text-[var(--link)]"
          >
            {expanded ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
            {expanded ? '收起' : '展开'}
          </button>
        )}

        {item.aiInsight && expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-6 border-l-2 border-[var(--primary)] px-4 py-2"
          >
            <div className="mb-1 flex items-center gap-1.5">
              <Sparkles size={12} className="text-[var(--link)]" aria-hidden />
              <span className="text-xs font-semibold text-[var(--link)]">AI 洞察</span>
            </div>
            <p className="text-sm leading-7 text-[var(--text-2)]">{item.aiInsight}</p>
          </motion.div>
        )}

        {item.source !== 'manual' && (
          <div className="mt-4 flex items-center gap-1 text-xs text-[var(--text-3)]">
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
  // Loading establishes the initial snapshot, but a later read failure must not
  // unmount an already opened editor. Route changes and explicit close still win.
  const requestedItem = dismissed !== requestKey && routeSnapshot?.key === requestKey ? routeSnapshot.item : undefined;
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
    <div className="record-page diary-page">
      {returnPath && <Button variant="ghost" onClick={() => { if (window.history.state?.idx > 0) navigate(-1); else navigate(returnPath); }}>← {source?.label || '返回来源'}</Button>}
      {!loaded && <section role="status" className="space-y-2 rounded-xl border border-[var(--border)] p-4"><p>{loadError ? `日记暂未读出：${loadError}` : '正在查找日记；若等待较久，可重试读取'}</p><Button variant="soft" onClick={() => void useDiaryStore.getState().loadFromDB().catch(() => undefined)}>重试读取</Button></section>}
      {recordId && loaded && !target && <section role="status" className="space-y-2 rounded-xl border border-[var(--border)] p-4"><p>当前账号未找到这篇日记。它可能已删除，或尚未同步到本机。</p><Button variant="soft" onClick={() => { setRecoveryId(recordId); setDismissed(requestKey); }}>查看此记录的本机编辑稿</Button></section>}
      {target && dismissed === requestKey && <Button variant="soft" onClick={() => openEdit(target)}>重新打开 {target.date} 的日记</Button>}
      <header className="record-page-heading">
        <div><p className="record-eyebrow">记录与回看 / JOURNAL</p><h1>日记</h1><p className="record-deck">把经历写下来，也给自己留一点回看的空间。</p></div>
        <Button onClick={openCreate} aria-label="写日记"><Plus size={18} aria-hidden />写日记</Button>
      </header>
      <div className="diary-index-line"><span>{loaded ? `${items.length} 篇已记录` : '正在读取记录'}</span>{avgMoodScore > 0 && <span>已记录心情的平均分 {avgMoodScore}/10</span>}<span>按日记日期排列</span></div>

      {sortedItems.length === 0 && loaded ? (
        <section className="diary-empty" aria-label="开始写日记">
          <div className="diary-empty-date"><span>{getToday().slice(0, 7).replace('-', ' / ')}</span><strong>{getToday().slice(8)}</strong><span>{formatDateLabel(getToday())}</span></div>
          <div className="diary-empty-writing"><BookOpen size={24} aria-hidden className="text-[var(--link)]" /><h2>今天，有什么想留下？</h2><p>还没有日记。一个片段、一段心情，或一句想记住的话，都可以成为第一篇。</p><Button onClick={openCreate}><Plus size={16} aria-hidden />写第一篇日记</Button><button type="button" className="record-text-link" onClick={() => navigate('/quick-note')}>也可以从速记开始 →</button></div>
        </section>
      ) : (
        <div className="diary-entries">
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
