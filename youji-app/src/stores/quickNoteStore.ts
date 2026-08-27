import { create } from 'zustand';
import { db, generateLocalId } from '../db';
import { enqueueSync, flush } from '../services/syncEngine';
import { isLoggedIn } from '../services/apiClient';
import { parseQuickNote, type ParsedExpense, type ParsedHabit, type ParsedTodo, type MoodLevel } from '../services/parser';

export interface QuickNoteRecord {
  id: string;
  rawInput: string;
  createdAt: number;
  expenses: ParsedExpense[];
  diary: string | null;
  mood: MoodLevel | null;
  moodScore: number;
  habits: ParsedHabit[];
  todos: ParsedTodo[];
}

interface QuickNoteState {
  records: QuickNoteRecord[];
  loaded: boolean;

  loadFromDB: () => Promise<void>;
  addRecord: (rawInput: string) => Promise<QuickNoteRecord>;
  removeRecord: (id: string) => Promise<void>;
}

function toServerShape(record: QuickNoteRecord): Record<string, unknown> {
  return {
    id: record.id,
    content: record.rawInput,
    timestamp: record.createdAt,
    parsed: {
      expenses: record.expenses,
      diary: record.diary,
      mood: record.mood,
      moodScore: record.moodScore,
      habits: record.habits,
      todos: record.todos.map((todo) => todo.text),
    },
    confirmed: true,
  };
}

export const useQuickNoteStore = create<QuickNoteState>((set, get) => ({
  records: [],
  loaded: false,

  loadFromDB: async () => {
    const records = await db.quickNotes.toArray();
    records.sort((a, b) => b.createdAt - a.createdAt);
    set({ records, loaded: true });
  },

  addRecord: async (rawInput) => {
    const parsed = parseQuickNote(rawInput);
    const record: QuickNoteRecord = {
      id: generateLocalId(),
      rawInput,
      createdAt: Date.now(),
      expenses: parsed.expenses,
      diary: parsed.diary,
      mood: parsed.mood,
      moodScore: parsed.moodScore,
      habits: parsed.habits,
      todos: parsed.todos,
    };

    await db.quickNotes.put(record);
    set((state) => ({ records: [record, ...state.records] }));

    if (isLoggedIn()) {
      await enqueueSync('quickNotes', 'upsert', toServerShape(record));
      void flush();
    }

    return record;
  },

  removeRecord: async (id) => {
    const existing = get().records.find((r) => r.id === id);
    await db.quickNotes.delete(id);
    set((state) => ({ records: state.records.filter((r) => r.id !== id) }));

    if (isLoggedIn() && existing) {
      await enqueueSync('quickNotes', 'delete', id);
      void flush();
    }
  },
}));
