import { parseBusinessDate } from '../../utils/date';

export const UNKNOWN_EXPENSE_MONTH = 'unknown';

interface ExpenseFilterRecord {
  date: string;
  category: string;
}

export interface ExpenseListFilters {
  month: string | null;
  category: string | null;
}

export function expenseListMonth(date: string): string {
  try {
    parseBusinessDate(date);
    return date.slice(0, 7);
  } catch {
    return UNKNOWN_EXPENSE_MONTH;
  }
}

/** Derive a view of loaded records, retaining raw rows and exact category keys. */
export function filterExpenseList<T extends ExpenseFilterRecord>(items: readonly T[], filters: ExpenseListFilters) {
  const months = new Set<string>();
  const categories = new Set<string>();
  const matching: T[] = [];
  for (const item of items) {
    const month = expenseListMonth(item.date);
    months.add(month);
    categories.add(item.category);
    if ((filters.month === null || month === filters.month)
      && (filters.category === null || item.category === filters.category)) {
      matching.push(item);
    }
  }

  // Keep a selected option even when saving removes its last matching record.
  // The resulting empty view must still describe the user's active selection.
  if (filters.month !== null) months.add(filters.month);
  if (filters.category !== null) categories.add(filters.category);
  return {
    items: matching,
    months: [...months].filter((month) => month !== UNKNOWN_EXPENSE_MONTH).sort().reverse()
      .concat(months.has(UNKNOWN_EXPENSE_MONTH) ? [UNKNOWN_EXPENSE_MONTH] : []),
    categories: [...categories].sort((left, right) => left.localeCompare(right)),
  };
}
