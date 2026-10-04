import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, AlertCircle, Calendar, Clock } from 'lucide-react';
import { useTodoStore, isOverdue, type TodoItem, type Priority } from '../../stores/todoStore';
import { toast } from '../../services/toastBus';
import { Checkbox } from '../ui/Checkbox';
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

interface TodoRowProps {
  item: TodoItem;
  onToggle: () => void;
  onUndo: () => void;
}

function TodoRow({ item, onToggle, onUndo }: TodoRowProps) {
  const [showUndo, setShowUndo] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const priority = priorityConfig[item.priority];

  const handleToggle = () => {
    onToggle();
    if (!item.done) {
      setShowUndo(true);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setShowUndo(false), 5000);
    }
  };

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, []);

  return (
    <motion.div
      layout
      initial={{ opacity: 1, y: 0 }}
      animate={{
        opacity: item.done ? 0.6 : 1,
        y: item.done ? 4 : 0,
      }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="relative"
    >
      <div className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border-light)] bg-[var(--surface)] px-4 py-3.5 shadow-[var(--shadow-sm)] transition-all duration-200 hover:shadow-[var(--shadow-md)]">
        <Checkbox checked={item.done} onChange={handleToggle} ariaLabel={`完成 ${item.text}`} />

        <div className="min-w-0 flex-1">
          <motion.p
            animate={{ textDecoration: item.done ? 'line-through' : 'none' }}
            transition={{ duration: 0.2 }}
            className={`truncate text-[13px] font-medium transition-colors duration-200 ${item.done ? 'text-[var(--text-3)]' : 'text-[var(--text-1)]'}`}
          >
            {item.text}
          </motion.p>
          <p className="mt-0.5 text-[11px] font-medium text-[var(--text-3)]">{dueLabel(item)}</p>
        </div>

        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white ${priority.gradient}`}>
          {priority.label}
        </span>
      </div>

      <AnimatePresence>
        {showUndo && item.done && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="absolute -top-8 right-0 flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--text-1)] px-3 py-1.5 text-xs text-white shadow-[var(--shadow-lg)]"
          >
            <span className="font-medium">已完成</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUndo();
                setShowUndo(false);
              }}
              className="font-bold text-[var(--primary-light)] hover:underline"
            >
              撤销
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function TodoList() {
  const items = useTodoStore((s) => s.items);
  const loaded = useTodoStore((s) => s.loaded);
  const toggleTodo = useTodoStore((s) => s.toggleTodo);

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
                    onToggle={() => void toggleTodo(item.id).catch((error: unknown) => toast.error(error instanceof Error ? error.message : '未保存，请重试'))}
                    onUndo={() => void toggleTodo(item.id).catch((error: unknown) => toast.error(error instanceof Error ? error.message : '未保存，请重试'))}
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
