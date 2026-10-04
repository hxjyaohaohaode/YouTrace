import { useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, AlertCircle, Calendar, Clock } from 'lucide-react';
import { useTodoStore, isOverdue, type TodoItem, type Priority } from '../../stores/todoStore';
import { toast } from '../../services/toastBus';
import { Button } from '../ui/Button';
import { formatDateLabel, getNaturalWeekDates, getToday } from '../../utils/date';

const priorityConfig: Record<Priority, { gradient: string; label: string }> = {
  high: { gradient: 'bg-gradient-to-r from-[var(--danger)] to-[#FF6B8A]', label: '高' },
  medium: { gradient: 'bg-gradient-to-r from-[var(--warning)] to-[#F0C040]', label: '中' },
  low: { gradient: 'bg-gradient-to-r from-[var(--success)] to-[#3FBF7E]', label: '低' },
};

type GroupKey = 'overdue' | 'today' | 'week' | 'later' | 'done';

const groupConfig: Record<GroupKey, { label: string; icon: typeof AlertCircle; color: string }> = {
  overdue: { label: '逾期', icon: AlertCircle, color: 'text-[var(--danger)]' },
  today: { label: '今天', icon: Clock, color: 'text-[var(--primary)]' },
  week: { label: '本周', icon: Calendar, color: 'text-[var(--warning)]' },
  later: { label: '更晚', icon: Calendar, color: 'text-[var(--text-3)]' },
  done: { label: '已完成', icon: Check, color: 'text-[var(--success)]' },
};

function groupTodos(items: TodoItem[]): Record<GroupKey, TodoItem[]> {
  const today = getToday();
  const naturalWeek = new Set(getNaturalWeekDates(today));

  const groups: Record<GroupKey, TodoItem[]> = { overdue: [], today: [], week: [], later: [], done: [] };
  for (const item of items) {
    if (item.done) {
      groups.done.push(item);
    } else if (isOverdue(item)) {
      groups.overdue.push(item);
    } else if (!item.dueDate || item.dueDate < today) {
      groups.later.push(item);
    } else if (item.dueDate === today) {
      groups.today.push(item);
    } else if (naturalWeek.has(item.dueDate)) {
      groups.week.push(item);
    } else {
      groups.later.push(item);
    }
  }
  return groups;
}

function dueLabel(item: TodoItem): string {
  return item.dueDate ? formatDateLabel(item.dueDate) : '无截止日期';
}

interface TodoRowProps { item: TodoItem; onEdit: () => void }

function TodoRow({ item, onEdit }: TodoRowProps) {
  const [pending, setPending] = useState(false);
  const guard = useRef(false);
  const priority = priorityConfig[item.priority] ?? priorityConfig.medium;
  const toggle = async () => {
    if (guard.current) return;
    guard.current = true; setPending(true);
    try { await useTodoStore.getState().toggleTodo(item.id); }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : '未保存，请重试'); }
    finally { guard.current = false; setPending(false); }
  };
  return <motion.div layout className="relative" id={`todo-record-${item.id}`} tabIndex={-1}>
    <div className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border-light)] bg-[var(--surface)] px-4 py-3.5 shadow-[var(--shadow-sm)]">
      <input type="checkbox" checked={item.done} onChange={() => void toggle()} disabled={pending} aria-label={`${item.done ? '取消完成' : '完成'} ${item.text}`} className="h-5 w-5 shrink-0 accent-[var(--primary)]" />
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-[var(--primary)]" aria-label={`编辑待办 ${item.text} ${item.dueDate || '无日期'}`}>
        <p className={`break-words text-[13px] font-medium ${item.done ? 'text-[var(--text-3)] line-through' : 'text-[var(--text-1)]'}`}>{item.text}</p>
        <p className="mt-0.5 text-[11px] text-[var(--text-3)]">{dueLabel(item)}{item.dueDate ? ` · ${item.dueDate}` : ''} · 编辑</p>
      </button>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white ${priority.gradient}`}>{priority.label}</span>
    </div>
  </motion.div>;
}

export function TodoList({ onEdit }: { onEdit: (item: TodoItem) => void }) {
  const items = useTodoStore((s) => s.items);
  const loaded = useTodoStore((s) => s.loaded);
  const undoStack = useTodoStore((s) => s.undoStack);
  const [undoPending, setUndoPending] = useState(false);
  const undoGuard = useRef(false);
  const undo = async () => {
    if (undoGuard.current) return;
    undoGuard.current = true; setUndoPending(true);
    try { await useTodoStore.getState().undoLast(); }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : '撤销未完成，请重试'); }
    finally { undoGuard.current = false; setUndoPending(false); }
  };

  const groups = useMemo(() => groupTodos(items), [items]);
  const activeCount = items.filter((i) => !i.done).length;

  if (!loaded) {
    return null;
  }

  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--surface-2)]">
          <Check size={28} className="text-[var(--text-3)]" aria-hidden />
        </div>
        <p className="text-sm font-medium text-[var(--text-3)]">还没有待办</p>
        <p className="mt-1 text-xs text-[var(--text-3)]">点右上角 + 添加第一件事</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {undoStack.length > 0 && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--primary-soft)] p-3 text-sm"><span>已修改「{undoStack.at(-1)?.before.text}」的完成状态</span><Button variant="soft" onClick={() => void undo()} disabled={undoPending}>{undoPending ? '撤销中…' : '撤销上次完成状态'}</Button></div>}
      {activeCount === 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="py-12 text-center"
        >
          <p className="mb-2 text-2xl" aria-hidden>🎉</p>
          <p className="text-sm font-medium text-[var(--text-3)]">清单里的待办都已完成</p>
        </motion.div>
      )}

      {(Object.entries(groupConfig) as Array<[GroupKey, typeof groupConfig[GroupKey]]>).map(([key, config]) => {
        const groupItems = groups[key];
        if (groupItems.length === 0) return null;
        const Icon = config.icon;

        return (
          <div key={key}>
            <div className="mb-2.5 flex items-center gap-1.5 px-1">
              <Icon size={14} className={config.color} aria-hidden />
              <span className={`text-xs font-bold ${config.color}`}>{config.label}</span>
              <span className="text-xs font-medium text-[var(--text-3)]">({groupItems.length})</span>
            </div>
            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {groupItems.map((item) => (
                  <TodoRow
                    key={item.id}
                    item={item}
                    onEdit={() => onEdit(item)}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>
        );
      })}
    </div>
  );
}
