import { create } from 'zustand';
import { db, generateLocalId, type ScheduleRecord } from '../db';
import { commitLocalMutation } from '../services/localMutation';
import { getToday } from '../utils/date';

type ScheduleType = ScheduleRecord['type'];
type ScheduleRepeat = ScheduleRecord['repeat'];

interface ScheduleState {
  items: ScheduleRecord[];
  loaded: boolean;
  selectedDate: string;

  loadFromDB: () => Promise<void>;
  setSelectedDate: (date: string) => void;
  addItem: (item: Omit<ScheduleRecord, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ScheduleRecord>;
  updateItem: (id: string, updates: Partial<Omit<ScheduleRecord, 'id'>>) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  getItemsByDate: (date: string) => ScheduleRecord[];
  getItemsByDateRange: (startDate: string, endDate: string) => ScheduleRecord[];
}

export function expandRecurringForRange(
  items: ScheduleRecord[],
  startDate: string,
  endDate: string,
): Array<ScheduleRecord & { virtualId: string; originDate: string }> {
  const expanded: Array<ScheduleRecord & { virtualId: string; originDate: string }> = [];
  for (const item of items) {
    if (item.repeat !== 'weekly') {
      if (item.date >= startDate && item.date <= endDate) {
        expanded.push({ ...item, virtualId: item.id, originDate: item.date });
      }
      continue;
    }

    for (let offset = 0; offset < 400; offset += 1) {
      const cursor = addDaysLocal(startDate, offset);
      if (cursor > endDate) break;
      const weekdayOfCursor = parseUtcDay(cursor);
      const weekdayOfOrigin = parseUtcDay(item.date);
      if (weekdayOfCursor === weekdayOfOrigin && cursor >= item.date) {
        expanded.push({
          ...item,
          date: cursor,
          virtualId: `${item.id}@${cursor}`,
          originDate: item.date,
        });
      }
    }
  }
  return expanded.sort(
    (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime),
  );
}

function addDaysLocal(date: string, days: number): string {
  const base = new Date(`${date}T12:00:00Z`);
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function parseUtcDay(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  items: [],
  loaded: false,
  selectedDate: getToday(),

  loadFromDB: async () => {
    const items = await db.schedules.toArray();
    set({ items, loaded: true });
  },

  setSelectedDate: (date) => set({ selectedDate: date }),

  addItem: async (item) => {
    const now = Date.now();
    const record: ScheduleRecord = {
      ...item,
      id: generateLocalId(),
      createdAt: now,
      updatedAt: now,
    };

    await commitLocalMutation('schedules', 'upsert', toServerShape(record), () => db.schedules.put(record));
    set((state) => ({ items: [...state.items, record] }));


    return record;
  },

  updateItem: async (id, updates) => {
    const existing = get().items.find((i) => i.id === id);
    if (!existing) return;

    const updated: ScheduleRecord = { ...existing, ...updates, updatedAt: Date.now() };
    await commitLocalMutation('schedules', 'upsert', toServerShape(updated), () => db.schedules.put(updated), undefined, existing);
    set((state) => ({ items: state.items.map((i) => (i.id === id ? updated : i)) }));

  },

  removeItem: async (id) => {
    const existing = get().items.find((i) => i.id === id);
    if (!existing) return;
    await commitLocalMutation('schedules', 'delete', id, () => db.schedules.delete(id), undefined, existing);
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }));

  },

  getItemsByDate: (date) => {
    return get()
      .items.filter((i) => i.date === date || i.repeat === 'weekly')
      .filter((i) => i.repeat !== 'weekly' || parseUtcDay(i.date) === parseUtcDay(date))
      .filter((i) => i.repeat !== 'weekly' || i.date <= date)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  },

  getItemsByDateRange: (startDate, endDate) => {
    return expandRecurringForRange(get().items, startDate, endDate);
  },
}));

function toServerShape(record: ScheduleRecord): Record<string, unknown> {
  return {
    id: record.id,
    title: record.title,
    date: record.date,
    startTime: record.startTime,
    endTime: record.endTime,
    type: record.type as ScheduleType,
    location: record.location,
    repeat: record.repeat as ScheduleRepeat,
    remind: record.remind,
  };
}
