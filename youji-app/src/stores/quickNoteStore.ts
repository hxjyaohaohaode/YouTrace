import { create } from 'zustand';
import { db, generateLocalId } from '../db';
import { commitLocalMutation } from '../services/localMutation';
import { parseQuickNote, type CaptureContext, type ParsedExpense, type ParsedHabit, type ParsedTodo, type MoodLevel } from '../services/parser';

export interface QuickNoteRecord {
  id: string;
  rawInput: string;
  createdAt: number;
  expenses: ParsedExpense[];
  diary: string | null;
  mood: MoodLevel | null;
  moodScore: number | null;
  habits: ParsedHabit[];
  todos: ParsedTodo[];
  confirmed?: boolean;
  captureContext?: CaptureContext;
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
    confirmed: record.confirmed === true,
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
      confirmed: false,
    };

    await commitLocalMutation('quickNotes', 'upsert', toServerShape(record), () => db.quickNotes.put(record));
    set((state) => ({ records: [record, ...state.records] }));


    return record;
  },

  removeRecord: async (id) => {
    const existing = get().records.find((r) => r.id === id);
    if (!existing) return;
    await commitLocalMutation('quickNotes', 'delete', id, () => db.quickNotes.delete(id), undefined, existing);
    set((state) => ({ records: state.records.filter((r) => r.id !== id) }));

  },
}));
