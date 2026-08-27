import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, BookOpen, Sparkles, ChevronDown, ChevronUp, Edit3, Trash2 } from 'lucide-react';
import { useDiaryStore } from '../../stores/diaryStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { RingProgress } from '../ui/ProgressBar';
import { toast } from '../../services/toastBus';
import type { DiaryRecord } from '../../db';
import { formatDateLabel, getToday } from '../../utils/date';
import { MOOD_LEVELS, getMoodMeta } from '../../utils/icons';
import type { MoodLevel } from '../../services/parser';

function DiaryEntryCard({ item, onEdit, onDelete }: { item: DiaryRecord; onEdit: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const moodInfo = getMoodMeta(item.mood);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-light)] bg-[var(--surface)]"
    >
      <div className="px-5 py-4">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-[var(--text-1)]">{formatDateLabel(item.date)}</span>
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
                <span className="opacity-60">{item.moodScore}/10</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onEdit} className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]" aria-label={`编辑${formatDateLabel(item.date)}的日记`}>
              <Edit3 size={15} aria-hidden />
            </button>
            <button type="button" onClick={onDelete} className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--danger)]" aria-label={`删除${formatDateLabel(item.date)}的日记`}>
              <Trash2 size={15} aria-hidden />
            </button>
          </div>
        </div>

        <p className={`text-[13px] leading-relaxed text-[var(--text-1)] ${!expanded ? 'line-clamp-3' : ''}`}>
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
            {item.source === 'quicknote_aggregated' && '📝 由速记自动生成'}
            {item.source === 'ai_generated' && '🤖 AI 生成'}
          </div>
        )}
      </div>
    </motion.div>
  );
}

interface DiaryFormModalProps {
  open: boolean;
  onClose: () => void;
  editItem?: DiaryRecord;
}

function DiaryFormModal({ open, onClose, editItem }: DiaryFormModalProps) {
  const addItem = useDiaryStore((s) => s.addItem);
  const updateItem = useDiaryStore((s) => s.updateItem);
  const [content, setContent] = useState(editItem?.content ?? '');
  const [mood, setMood] = useState<MoodLevel | null>((editItem?.mood as MoodLevel) ?? null);
  const [moodScore, setMoodScore] = useState(editItem?.moodScore ?? 5);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = content.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      if (editItem) {
        await updateItem(editItem.id, { content: trimmed, mood, moodScore });
      } else {
        await addItem({
          date: getToday(),
          content: trimmed,
          mood,
          moodScore,
          source: 'manual',
          quickNoteIds: [],
        });
      }
      onClose();
    } catch {
      toast.error('日记保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editItem ? '编辑日记' : '写日记'}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={handleSave} disabled={!content.trim() || saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-3)]">今天的心情</label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="选择心情">
            {MOOD_LEVELS.map((level) => {
              const meta = getMoodMeta(level)!;
              const active = mood === level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => { setMood(level); setMoodScore(meta.score); }}
                  aria-pressed={active}
                  className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                    active
                      ? 'border border-[var(--primary)]/15 bg-gradient-to-r from-[var(--primary-soft)] to-[var(--primary-muted)] text-[var(--primary)] shadow-[var(--shadow-xs)]'
                      : 'bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--border)]'
                  }`}
                >
                  <span aria-hidden>{meta.emoji}</span>
                  <span>{meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor="diary-content" className="mb-2 block text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-3)]">内容</label>
          <textarea
            id="diary-content"
            value={content}
            onChange={(e) => setContent(e.target.value.slice(0, 10000))}
            placeholder="今天发生了什么？有什么想说的..."
            maxLength={10000}
            className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-1)] outline-none transition-all focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--primary)]/8"
            rows={6}
            autoFocus
          />
          <p className="mt-1 text-right text-[10px] text-[var(--text-4)]">{content.length}/10000</p>
        </div>
      </div>
    </Modal>
  );
}

export function DiaryContent() {
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<DiaryRecord | undefined>(undefined);
  const [formKey, setFormKey] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const items = useDiaryStore((s) => s.items);
  const removeItem = useDiaryStore((s) => s.removeItem);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
    [items]
  );

  const avgMoodScore = useMemo(() => {
    const scored = items.filter((i) => i.moodScore > 0);
    if (scored.length === 0) return 0;
    return Math.round((scored.reduce((sum, i) => sum + i.moodScore, 0) / scored.length) * 10) / 10;
  }, [items]);

  const openCreate = () => {
    setEditItem(undefined);
    setFormKey((k) => k + 1);
    setShowModal(true);
  };

  const openEdit = (item: DiaryRecord) => {
    setEditItem(item);
    setFormKey((k) => k + 1);
    setShowModal(true);
  };

  const handleDelete = async () => {
    if (deleteConfirm === null) return;
    try {
      await removeItem(deleteConfirm);
    } catch {
      toast.error('删除失败，请重试');
    } finally {
      setDeleteConfirm(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-[var(--text-1)]">日记</h1>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={openCreate}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] shadow-[var(--shadow-glow)] text-white transition-colors"
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

      {sortedItems.length === 0 ? (
        <div className="py-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--surface-2)]">
            <BookOpen size={28} className="text-[var(--text-3)]" aria-hidden />
          </div>
          <p className="text-sm font-medium text-[var(--text-3)]">还没有日记</p>
          <p className="mt-1 text-xs text-[var(--text-3)]">写下第一篇，或用速记说一句话自动生成</p>
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
                onDelete={() => setDeleteConfirm(item.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      <DiaryFormModal
        key={formKey}
        open={showModal}
        onClose={() => { setShowModal(false); setEditItem(undefined); }}
        editItem={editItem}
      />

      <Modal
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        title="确认删除"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(null)}>取消</Button>
            <Button variant="danger" size="sm" onClick={handleDelete}>删除</Button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-1)]">确定要删除这篇日记吗？此操作不可撤销。</p>
      </Modal>
    </div>
  );
}
