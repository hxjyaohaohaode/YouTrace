import { assertTodoContext, consumeTodoDraft, type TodoContext } from '../components/todo/todoDraft';
import { create } from 'zustand';
import { db, generateLocalId, LOCAL_DATA_EPOCH_KEY } from '../db';
import { commitLocalMutation } from '../services/localMutation';
import { getToday, parseBusinessDate } from '../utils/date';

export type Priority = 'high' | 'medium' | 'low';

export interface TodoItem {
  id: string;
  text: string;
  dueDate?: string;
  priority: Priority;
  done: boolean;
  /** Absent on legacy records; never inferred from a deadline. */
  completedAt?: number | null;
}

interface TodoUndo { before: TodoItem; after: TodoItem }
const MAX_UNDO = 20;
const pending = new Set<string>();
export const sameTodoSnapshot = (left: TodoItem | undefined, right: TodoItem) => Boolean(left) && [...new Set([...Object.keys(left!), ...Object.keys(right)])].every((key) => JSON.stringify(left![key as keyof TodoItem]) === JSON.stringify(right[key as keyof TodoItem]));

function validateTodo(item: TodoItem): TodoItem {
  const text = item.text.trim();
  if (!text || text.length > 200) throw new Error('待办内容需为 1–200 个字符');
  if (!['high', 'medium', 'low'].includes(item.priority) || typeof item.done !== 'boolean') throw new Error('请选择有效的优先级和完成状态');
  if (item.dueDate) {
    try { parseBusinessDate(item.dueDate); } catch { throw new Error('请选择有效的截止日期'); }
  }
  return { ...item, text, dueDate: item.dueDate || undefined };
}

async function writeTodo(existing: TodoItem, replacement: TodoItem | null, draft?: TodoContext) {
  if (pending.has(existing.id)) throw new Error('这条待办正在保存，请稍后');
  pending.add(existing.id);
  const database = db;
  try {
    await commitLocalMutation('todos', replacement ? 'upsert' : 'delete', replacement ? { ...replacement, dueDate: replacement.dueDate ?? null, completedAt: replacement.completedAt ?? null } : existing.id, async () => {
      if (!sameTodoSnapshot(await database.todos.get(existing.id), existing)) throw new Error('待办刚刚更新，输入已保留。请核对最新记录后重试');
      if (draft) { if (replacement) await consumeTodoDraft(draft); else await assertTodoContext(draft); }
      return replacement ? database.todos.put(replacement) : database.todos.delete(existing.id);
    }, [database.todos], existing);
  } finally { pending.delete(existing.id); }
}

interface TodoState {
  items: TodoItem[];
  undoStack: TodoUndo[];
  loaded: boolean;
  loadFromDB: () => Promise<void>;
  addItem: (item: Omit<TodoItem, 'id' | 'done'>, id?: string, draft?: TodoContext) => Promise<TodoItem>;
  updateItem: (id: string, updates: Partial<Omit<TodoItem, 'id'>>, expected?: TodoItem, draft?: TodoContext) => Promise<TodoItem>;
  toggleTodo: (id: string) => Promise<void>;
  undoLast: () => Promise<void>;
  removeItem: (id: string, expected?: TodoItem, draft?: TodoContext) => Promise<void>;
}

export const useTodoStore = create<TodoState>((set, get) => ({
  items: [],
  undoStack: [],
  loaded: false,

  loadFromDB: async () => {
    const database = db;
    const { rows, epoch } = await database.transaction('r', database.todos, database.settings, async () => ({ rows: await database.todos.toArray(), epoch: (await database.settings.get(LOCAL_DATA_EPOCH_KEY))?.value }));
    if (database !== db || (await database.settings.get(LOCAL_DATA_EPOCH_KEY))?.value !== epoch) return;
    // Keep the complete record snapshot: stripping metadata weakens CAS and can erase source evidence.
    const items = rows.filter((row) => typeof row.id === 'string' && typeof row.text === 'string');
    set({ items, loaded: true });
  },

  addItem: async (item, id = generateLocalId(), draft) => {
    const database = db;
    const newItem = validateTodo({ ...item, id, done: false, completedAt: null });
    await commitLocalMutation('todos', 'upsert', { ...newItem, dueDate: newItem.dueDate ?? null }, async () => { if (draft) await consumeTodoDraft(draft); return database.todos.add(newItem); }, [database.todos], null);
    set((state) => ({ items: state.items.some((row) => row.id === id) ? state.items : [newItem, ...state.items] }));
    return newItem;
  },

  updateItem: async (id, updates, expected, draft) => {
    const existing = expected ?? get().items.find((item) => item.id === id);
    if (!existing || existing.id !== id) throw new Error('未找到这条待办，请返回列表核对');
    const updated = validateTodo({ ...existing, ...updates, id, completedAt: updates.done === false ? null : updates.done === true && !existing.done ? Date.now() : existing.completedAt ?? null });
    await writeTodo(existing, updated, draft);
    set((state) => ({ items: state.items.map((item) => item.id === id && sameTodoSnapshot(item, existing) ? updated : item) }));
    return updated;
  },

  toggleTodo: async (id) => {
    const existing = get().items.find((item) => item.id === id);
    if (!existing) throw new Error('未找到这条待办');
    const updated = await get().updateItem(id, { done: !existing.done }, existing);
    set((state) => ({ undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), { before: existing, after: updated }] }));
  },

  undoLast: async () => {
    const entry = get().undoStack.at(-1);
    if (!entry) return;
    // Undo is bound to the precise result, not whichever newer version is currently visible.
    await writeTodo(entry.after, entry.before);
    set((state) => ({
      items: state.items.map((item) => item.id === entry.before.id && sameTodoSnapshot(item, entry.after) ? entry.before : item),
      undoStack: state.undoStack.filter((item) => item !== entry),
    }));
  },

  removeItem: async (id, expected, draft) => {
    const existing = expected ?? get().items.find((item) => item.id === id);
    if (!existing || existing.id !== id) throw new Error('未找到这条待办，请返回列表核对');
    await writeTodo(existing, null, draft);
    set((state) => ({ items: state.items.filter((item) => item.id !== id || !sameTodoSnapshot(item, existing)), undoStack: state.undoStack.filter((entry) => entry.before.id !== id) }));
  },
}));

export function isOverdue(todo: TodoItem): boolean {
  return !todo.done && Boolean(todo.dueDate) && todo.dueDate! < getToday();
}
