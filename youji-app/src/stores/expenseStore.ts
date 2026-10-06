import { assertExpenseContext, consumeExpenseDraft, type ExpenseContext } from '../components/expense/expenseDraft';
import { create } from 'zustand';
import { db, generateLocalId, LOCAL_DATA_EPOCH_KEY } from '../db';
import { commitLocalMutation } from '../services/localMutation';
import { deliverControlledPush } from '../services/pushControl';
import { getToday, parseBusinessDate } from '../utils/date';
import { getExpensePeriodTotals } from '../utils/expensePeriod';
import { normalizeExpenseCategory } from '../utils/icons';

export interface ExpenseItem {
  id: string;
  name: string;
  amount: number;
  category: string;
  date: string;
  isIncome?: boolean;
  note?: string | null;
  relatedMood?: string | null;
  source?: string;
}

interface ExpenseState {
  items: ExpenseItem[];
  monthBudget: number;
  budgetStatus: 'unset' | 'configured' | 'unknown';
  loaded: boolean;

  loadFromDB: () => Promise<void>;
  setMonthBudget: (budget: number, expected?: { monthBudget: number; budgetStatus: 'unset' | 'configured' | 'unknown' }) => Promise<void>;
  addItem: (item: Omit<ExpenseItem, 'id'>, id?: string, draft?: ExpenseContext) => Promise<ExpenseItem>;
  updateItem: (id: string, updates: Partial<Omit<ExpenseItem, 'id'>>, expected?: ExpenseItem, draft?: ExpenseContext) => Promise<ExpenseItem>;
  removeItem: (id: string, expected?: ExpenseItem, draft?: ExpenseContext) => Promise<void>;

  todayTotal: () => number;
  weekTotal: () => number;
  monthTotal: () => number;
  monthIncome: () => number;
}

const BUDGET_SETTING_KEY = 'monthBudget';
const BUDGET_CONFIGURED_KEY = 'monthBudgetConfigured';
const pending = new Set<string>();
export const sameExpenseSnapshot = (left: ExpenseItem | undefined, right: ExpenseItem) => Boolean(left) && [...new Set([...Object.keys(left!), ...Object.keys(right)])].every((key) => JSON.stringify(left![key as keyof ExpenseItem]) === JSON.stringify(right[key as keyof ExpenseItem]));

/** Parse visible CNY yuan exactly; never accept partial strings or silently round extra decimals. */
export function parseYuanToFen(value: string, allowZero = false): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [yuan, decimals = ''] = value.trim().split('.');
  const fen = Number(yuan) * 100 + Number(decimals.padEnd(2, '0'));
  return Number.isSafeInteger(fen) && fen >= (allowZero ? 0 : 1) && fen <= 100_000_000_00 ? fen : null;
}

function validateExpense(item: ExpenseItem): ExpenseItem {
  if (!Number.isSafeInteger(item.amount) || item.amount <= 0 || item.amount > 100_000_000_00) throw new Error('金额需大于 0，最多两位小数且不超过一亿元');
  if (!item.name.trim() || item.name.trim().length > 100) throw new Error('名称需为 1–100 个字符');
  try { parseBusinessDate(item.date); } catch { throw new Error('请选择有效的记账日期'); }
  return { ...item, name: item.name.trim(), category: normalizeExpenseCategory(item.category) };
}

async function writeExpense(existing: ExpenseItem, replacement: ExpenseItem | null, draft?: ExpenseContext) {
  if (pending.has(existing.id)) throw new Error('这笔记录正在保存，请稍后');
  pending.add(existing.id);
  const database = db;
  try {
    await commitLocalMutation('expenses', replacement ? 'upsert' : 'delete', replacement ?? existing.id, async () => {
      if (!sameExpenseSnapshot(await database.expenses.get(existing.id), existing)) throw new Error('记录刚刚更新，输入已保留。请核对最新记录后重试');
      if (draft) { if (replacement) await consumeExpenseDraft(draft); else await assertExpenseContext(draft); }
      return replacement ? database.expenses.put(replacement) : database.expenses.delete(existing.id);
    }, [database.expenses], existing);
  } finally { pending.delete(existing.id); }
}


export async function checkBudgetThreshold(): Promise<void> {
  try {
    const { useCoachStore } = await import('./coachStore');
    const coach = useCoachStore.getState();
    if (coach.pushes.some((p) => !p.read && p.type === 'anomaly' && p.title.includes('预算'))) {
      return;
    }

    const items = await db.expenses.toArray();
    const total = getExpensePeriodTotals(items, getToday()).month;
    const { monthBudget: budget, budgetStatus } = useExpenseStore.getState();
    if (budgetStatus !== 'configured') return;
    if (budget <= 0) return;

    const pct = Math.floor((total / budget) * 100);
    let title: string;
    let body: string;

    if (total > budget) {
      title = '本月预算已超支';
      body = `已花¥${(total / 100).toFixed(2)}，超出预算¥${((total - budget) / 100).toFixed(2)}。别自责，看看钱主要花在哪了。`;
    } else if (total === budget) {
      title = '本月预算已用完';
      body = `已花¥${(total / 100).toFixed(2)}，正好用完本月预算。可以结合本月剩余安排，决定是否需要调整。`;
    } else if (pct >= 80) {
      title = '预算即将用完';
      body = `本月已使用${pct}%的预算（¥${(total / 100).toFixed(2)}/¥${(budget / 100).toFixed(2)}）。可以结合本月剩余安排，决定是否需要调整。`;
    } else {
      return;
    }

    await deliverControlledPush('anomaly', title, async () => {
      // Another local flow may have created the same alert while we read totals.
      if (useCoachStore.getState().pushes.some((p) => !p.read && p.type === 'anomaly' && p.title.includes('预算'))) return false;
      await useCoachStore.getState().addPush({
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
    });
  } catch {
    // threshold check is best-effort
  }
}

export const useExpenseStore = create<ExpenseState>((set, get) => ({
  items: [],
  monthBudget: 0,
  budgetStatus: 'unset',
  loaded: false,

  loadFromDB: async () => {
    const database = db;
    const { items, budget, configured, epoch } = await database.transaction('r', database.expenses, database.settings, async () => ({
      items: await database.expenses.toArray(), budget: await database.settings.get(BUDGET_SETTING_KEY), configured: await database.settings.get(BUDGET_CONFIGURED_KEY), epoch: (await database.settings.get(LOCAL_DATA_EPOCH_KEY))?.value,
    }));
    if (database !== db || (await database.settings.get(LOCAL_DATA_EPOCH_KEY))?.value !== epoch) return;
    set({
      items,
      monthBudget: typeof budget?.value === 'number' && Number.isFinite(budget.value) ? budget.value : 0,
      budgetStatus: !budget ? 'unset' : configured?.value === true && typeof budget.value === 'number' && Number.isSafeInteger(budget.value) && budget.value >= 0 ? 'configured' : 'unknown',
      loaded: true,
    });
  },

  setMonthBudget: async (budget, expected) => {
    if (!Number.isSafeInteger(budget) || budget < 0 || budget > 100_000_000_00) throw new Error('请输入有效预算，最多两位小数且不超过一亿元');
    const database = db;
    await database.transaction('rw', database.settings, async () => {
      const current = await database.settings.get(BUDGET_SETTING_KEY);
      const configured = await database.settings.get(BUDGET_CONFIGURED_KEY);
      const status = !current ? 'unset' : configured?.value === true && typeof current.value === 'number' && Number.isSafeInteger(current.value) && current.value >= 0 ? 'configured' : 'unknown';
      if (expected && (status !== expected.budgetStatus || (typeof current?.value === 'number' && current.value !== expected.monthBudget))) throw new Error('预算刚刚在其他位置修改，请核对最新预算后重试');
      await database.settings.put({ key: BUDGET_SETTING_KEY, value: budget });
      await database.settings.put({ key: BUDGET_CONFIGURED_KEY, value: true });
    });
    set({ monthBudget: budget, budgetStatus: 'configured' });
  },

  addItem: async (item, id = generateLocalId(), draft) => {
    const database = db;
    const newItem = validateExpense({ ...item, id });
    await commitLocalMutation('expenses', 'upsert', { ...newItem, source: newItem.source || 'manual' }, async () => { if (draft) await consumeExpenseDraft(draft); return database.expenses.add(newItem); }, [database.expenses], null);
    set((state) => ({ items: state.items.some((row) => row.id === id) ? state.items : [newItem, ...state.items] }));
    if (!newItem.isIncome) void checkBudgetThreshold();
    return newItem;
  },

  updateItem: async (id, updates, expected, draft) => {
    const existing = expected ?? get().items.find((item) => item.id === id);
    if (!existing || existing.id !== id) throw new Error('未找到这笔记录，请返回列表核对');
    const updated = validateExpense({ ...existing, ...updates, id });
    await writeExpense(existing, updated, draft);
    set((state) => ({ items: state.items.map((item) => item.id === id && sameExpenseSnapshot(item, existing) ? updated : item) }));
    return updated;
  },

  removeItem: async (id, expected, draft) => {
    const existing = expected ?? get().items.find((item) => item.id === id);
    if (!existing || existing.id !== id) throw new Error('未找到这笔记录，请返回列表核对');
    await writeExpense(existing, null, draft);
    set((state) => ({ items: state.items.filter((item) => item.id !== id || !sameExpenseSnapshot(item, existing)) }));
  },

  todayTotal: () => getExpensePeriodTotals(get().items, getToday()).today,
  weekTotal: () => getExpensePeriodTotals(get().items, getToday()).week,
  monthTotal: () => getExpensePeriodTotals(get().items, getToday()).month,
  monthIncome: () => getExpensePeriodTotals(get().items, getToday()).monthIncome,
}));
