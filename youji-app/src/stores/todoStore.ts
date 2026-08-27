import { create } from 'zustand';
import { db, generateLocalId } from '../db';
import { enqueueSync, flush } from '../services/syncEngine';
import { isLoggedIn } from '../services/apiClient';
import { getToday } from '../utils/date';

export type Priority = 'high' | 'medium' | 'low';

export interface TodoItem {
  id: string;
  text: string;
  dueDate?: string;
  priority: Priority;
  done: boolean;
}

const MAX_UNDO = 20;

async function propagateTodoToGoal(todoText: string): Promise<void> {
  try {
    const { useGoalStore } = await import('./goalStore');
    const goals = useGoalStore.getState().items.filter((g) => g.progress < 100);
    for (const goal of goals) {
      const keywords = [goal.domain, goal.title];
      if (keywords.some((kw) => kw && todoText.includes(kw))) {
        const increment = goal.level === 'short' ? 3 : 1;
        const newProgress = Math.min(100, goal.progress + increment);
        if (newProgress !== goal.progress) {
          await useGoalStore.getState().updateProgress(goal.id, newProgress);
          if (newProgress >= 100) {
            const { toast } = await import('../services/toastBus');
            toast.success(`🎉 目标「${goal.title}」已完成！`);
          }
        }
        break;
      }
    }
  } catch {
    // best-effort
  }
}

interface TodoState {
  items: TodoItem[];
  undoStack: TodoItem[];
  loaded: boolean;

  loadFromDB: () => Promise<void>;
  addItem: (item: Omit<TodoItem, 'id' | 'done'>) => Promise<TodoItem>;
  toggleTodo: (id: string) => Promise<void>;
  undoLast: () => Promise<void>;
  removeItem: (id: string) => Promise<void>;
}

function isTodoRecord(value: Record<string, unknown>): boolean {
  return typeof value.id === 'string' && typeof value.text === 'string';
}

export const useTodoStore = create<TodoState>((set, get) => ({
  items: [],
  undoStack: [],
  loaded: false,

  loadFromDB: async () => {
    const rows = await db.todos.toArray();
    const items: TodoItem[] = rows
      .filter((row) => isTodoRecord(row as unknown as Record<string, unknown>))
      .map((row) => ({
        id: row.id,
        text: row.text,
        dueDate: (row as { dueDate?: string }).dueDate || undefined,
        priority: (row.priority as Priority) || 'medium',
        done: Boolean(row.done),
      }));
    set({ items, undoStack: [], loaded: true });
  },

  addItem: async (item) => {
    const newItem: TodoItem = {
      id: generateLocalId(),
      text: item.text,
      dueDate: item.dueDate || undefined,
      priority: item.priority || 'medium',
      done: false,
    };

    await db.todos.put(newItem);
    set((state) => ({ items: [newItem, ...state.items] }));

    if (isLoggedIn()) {
      await enqueueSync('todos', 'upsert', {
        id: newItem.id,
        text: newItem.text,
        priority: newItem.priority,
        done: false,
        ...(newItem.dueDate ? { dueDate: newItem.dueDate } : {}),
      });
      void flush();
    }

    return newItem;
  },

  toggleTodo: async (id) => {
    const item = get().items.find((i) => i.id === id);
    if (!item) return;

    const updated: TodoItem = { ...item, done: !item.done };

    set((state) => ({
      items: state.items.map((i) => (i.id === id ? updated : i)),
      undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), item],
    }));
    await db.todos.put(updated);

    if (updated.done && !item.done) {
      void propagateTodoToGoal(item.text);
    }

    if (isLoggedIn()) {
      await enqueueSync('todos', 'upsert', {
        id: updated.id,
        text: updated.text,
        priority: updated.priority,
        done: updated.done,
        ...(updated.dueDate ? { dueDate: updated.dueDate } : {}),
      });
      void flush();
    }
  },

  undoLast: async () => {
    const { undoStack, items } = get();
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    if (!items.some((i) => i.id === last.id)) {
      set({ undoStack: undoStack.slice(0, -1) });
      return;
    }

    set({
      items: items.map((i) => (i.id === last.id ? last : i)),
      undoStack: undoStack.slice(0, -1),
    });
    await db.todos.put(last);

    if (isLoggedIn()) {
      await enqueueSync('todos', 'upsert', {
        id: last.id,
        text: last.text,
        priority: last.priority,
        done: last.done,
        ...(last.dueDate ? { dueDate: last.dueDate } : {}),
      });
      void flush();
    }
  },

  removeItem: async (id) => {
    const existing = get().items.find((i) => i.id === id);
    await db.todos.delete(id);
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }));

    if (isLoggedIn() && existing) {
      await enqueueSync('todos', 'delete', id);
      void flush();
    }
  },
}));

export function isOverdue(todo: TodoItem): boolean {
  return !todo.done && Boolean(todo.dueDate) && todo.dueDate! < getToday();
}
