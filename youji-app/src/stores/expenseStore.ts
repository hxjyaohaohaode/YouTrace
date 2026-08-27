import { create } from 'zustand';
import { db, generateLocalId } from '../db';
import { enqueueSync, flush } from '../services/syncEngine';
import { isLoggedIn } from '../services/apiClient';
import { getBusinessMonth, getNaturalWeekDates, getToday } from '../utils/date';
import { normalizeExpenseCategory } from '../utils/icons';

export interface ExpenseItem {
  id: string;
  name: string;
  amount: number;
  category: string;
  date: string;
  isIncome?: boolean;
  note?: string;
  source?: string;
}

interface ExpenseState {
  items: ExpenseItem[];
  monthBudget: number;
  loaded: boolean;

  loadFromDB: () => Promise<void>;
  setMonthBudget: (budget: number) => Promise<void>;
  addItem: (item: Omit<ExpenseItem, 'id'>) => Promise<ExpenseItem>;
  removeItem: (id: string) => Promise<void>;

  todayTotal: () => number;
  weekTotal: () => number;
  monthTotal: () => number;
  monthIncome: () => number;
}

const BUDGET_SETTING_KEY = 'monthBudget';

async function checkBudgetThreshold(): Promise<void> {
  try {
    const { useCoachStore } = await import('./coachStore');
    const coach = useCoachStore.getState();
    if (coach.pushes.some((p) => !p.read && p.type === 'anomaly' && p.title.includes('预算'))) {
      return;
    }

    const items = await db.expenses.toArray();
    const month = getBusinessMonth();
    const total = items
      .filter((i) => i.date.startsWith(month) && !i.isIncome)
      .reduce((sum, i) => sum + i.amount, 0);
    const budget = useExpenseStore.getState().monthBudget;
    if (budget <= 0) return;

    const pct = Math.floor((total / budget) * 100);
    let title: string;
    let body: string;

    if (pct >= 100) {
      title = '本月预算已超支';
      body = `已花¥${(total / 100).toFixed(0)}，超出预算¥${((total - budget) / 100).toFixed(0)}。别自责，看看钱主要花在哪了。`;
    } else if (pct >= 80) {
      title = '预算即将用完';
      body = `本月已使用${pct}%的预算（¥${(total / 100).toFixed(0)}/¥${(budget / 100).toFixed(0)}）。接下来两周注意控制节奏。`;
    } else {
      return;
    }

    await coach.addPush({
      insightId: undefined,
      type: 'anomaly',
      title,
      body,
      actions: [
        { label: '查看花销', type: 'chat' },
        { label: '知道了', type: 'confirm' },
      ],
      read: false,
      acted: false,
    });
  } catch {
    // threshold check is best-effort
  }
}

export const useExpenseStore = create<ExpenseState>((set, get) => ({
  items: [],
  monthBudget: 250000,
  loaded: false,

  loadFromDB: async () => {
    const [items, budget] = await Promise.all([
      db.expenses.toArray(),
      db.settings.get(BUDGET_SETTING_KEY),
    ]);
    set({
      items,
      monthBudget: typeof budget?.value === 'number' ? budget.value : 250000,
      loaded: true,
    });
  },

  setMonthBudget: async (budget) => {
    if (!Number.isFinite(budget) || budget < 0) return;
    set({ monthBudget: budget });
    await db.settings.put({ key: BUDGET_SETTING_KEY, value: Math.round(budget) });
  },

  addItem: async (item) => {
    const amount = Number(item.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000_00) {
      throw new Error('金额无效');
    }
    const newItem: ExpenseItem = {
      ...item,
      amount: Math.round(amount),
      category: normalizeExpenseCategory(item.category),
      id: generateLocalId(),
    };

    await db.expenses.put(newItem);
    set((state) => ({ items: [newItem, ...state.items] }));

    if (!newItem.isIncome) {
      void checkBudgetThreshold();
    }

    if (isLoggedIn()) {
      await enqueueSync('expenses', 'upsert', {
        id: newItem.id,
        amount: newItem.amount,
        category: newItem.category,
        name: newItem.name,
        date: newItem.date,
        source: newItem.source || 'manual',
        isIncome: newItem.isIncome ?? false,
        ...(newItem.note ? { note: newItem.note } : {}),
      });
      void flush();
    }

    return newItem;
  },

  removeItem: async (id) => {
    const existing = get().items.find((i) => i.id === id);
    await db.expenses.delete(id);
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }));

    if (isLoggedIn() && existing) {
      await enqueueSync('expenses', 'delete', id);
      void flush();
    }
  },

  todayTotal: () => {
    const today = getToday();
    return get().items
      .filter((i) => i.date === today && !i.isIncome)
      .reduce((sum, i) => sum + i.amount, 0);
  },

  weekTotal: () => {
    const weekDates = new Set(getNaturalWeekDates());
    return get().items
      .filter((i) => weekDates.has(i.date) && !i.isIncome)
      .reduce((sum, i) => sum + i.amount, 0);
  },

  monthTotal: () => {
    const month = getBusinessMonth();
    return get().items
      .filter((i) => i.date.startsWith(month) && !i.isIncome)
      .reduce((sum, i) => sum + i.amount, 0);
  },

  monthIncome: () => {
    const month = getBusinessMonth();
    return get().items
      .filter((i) => i.date.startsWith(month) && i.isIncome)
      .reduce((sum, i) => sum + i.amount, 0);
  },
}));
