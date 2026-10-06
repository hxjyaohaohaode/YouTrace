import { getNaturalWeekDates } from './date';

interface ExpenseAmountRecord {
  date: string;
  amount: number;
  isIncome?: boolean;
}

/** Sum recorded integer cents in an inclusive date range, without changing records. */
export function sumExpensePeriod(items: readonly ExpenseAmountRecord[], start: string, end: string, isIncome = false): number {
  return items.reduce((sum, item) => (
    item.date >= start && item.date <= end && Boolean(item.isIncome) === isIncome
      ? sum + item.amount
      : sum
  ), 0);
}

/** Current periods end today; a future-dated record remains available in the list. */
export function getExpensePeriodTotals(items: readonly ExpenseAmountRecord[], today: string) {
  const weekStart = getNaturalWeekDates(today)[0];
  const monthStart = `${today.slice(0, 7)}-01`;
  return {
    today: sumExpensePeriod(items, today, today),
    week: sumExpensePeriod(items, weekStart, today),
    month: sumExpensePeriod(items, monthStart, today),
    monthIncome: sumExpensePeriod(items, monthStart, today, true),
  };
}
