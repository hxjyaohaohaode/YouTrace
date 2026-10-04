import { create } from 'zustand';
import { db, generateLocalId } from '../db';
import { commitLocalMutation } from '../services/localMutation';
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

    await commitLocalMutation('todos', 'upsert', newItem, () => db.todos.put(newItem));
    set((state) => ({ items: [newItem, ...state.items] }));


    return newItem;
  },

  toggleTodo: async (id) => {
    const item = get().items.find((i) => i.id === id);
    if (!item) return;

    const updated: TodoItem = { ...item, done: !item.done };

    await commitLocalMutation('todos', 'upsert', updated, () => db.todos.put(updated), undefined, item);
    set((state) => ({
      items: state.items.map((i) => (i.id === id ? updated : i)),
      undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), item],
    }));


  },

  undoLast: async () => {
    const { undoStack, items } = get();
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    if (!items.some((i) => i.id === last.id)) {
      set({ undoStack: undoStack.slice(0, -1) });
      return;
    }

    await commitLocalMutation('todos', 'upsert', last, () => db.todos.put(last), undefined, items.find((item) => item.id === last.id));
    set({
      items: items.map((i) => (i.id === last.id ? last : i)),
      undoStack: undoStack.slice(0, -1),
    });

  },

  removeItem: async (id) => {
    const existing = get().items.find((i) => i.id === id);
    if (!existing) return;
    await commitLocalMutation('todos', 'delete', id, () => db.todos.delete(id), undefined, existing);
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }));

  },
}));

export function isOverdue(todo: TodoItem): boolean {
  return !todo.done && Boolean(todo.dueDate) && todo.dueDate! < getToday();
}
