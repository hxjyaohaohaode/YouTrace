import { useExpenseStore } from '../stores/expenseStore';
import { useHabitStore } from '../stores/habitStore';
import { useDiaryStore } from '../stores/diaryStore';
import { useTodoStore } from '../stores/todoStore';
import type { ParsedExpense, ParsedHabit, ParsedTodo, MoodLevel } from './parser';
import { addDays, getToday } from '../utils/date';
import { normalizeExpenseCategory } from '../utils/icons';

export interface ApplyResult {
  expenseCount: number;
  habitCount: number;
  diaryCreated: boolean;
  diaryUpdated: boolean;
  todoCount: number;
  failures: string[];
}

function resolveDueDate(text: string): { text: string; dueDate: string } {
  if (text.startsWith('明天')) {
    return { text: text.slice(2).trim() || text, dueDate: addDays(getToday(), 1) };
  }
  if (text.startsWith('后天')) {
    return { text: text.slice(2).trim() || text, dueDate: addDays(getToday(), 2) };
  }
  return { text, dueDate: getToday() };
}

export async function applyParsedResult(
  expenses: ParsedExpense[],
  habits: ParsedHabit[],
  todos: ParsedTodo[],
  diary: string | null,
  mood: MoodLevel | null,
  moodScore: number,
): Promise<ApplyResult> {
  const result: ApplyResult = {
    expenseCount: 0,
    habitCount: 0,
    diaryCreated: false,
    diaryUpdated: false,
    todoCount: 0,
    failures: [],
  };

  const today = getToday();

  for (const exp of expenses) {
    const name = exp.name.trim();
    if (!exp.confirmed || !name || !Number.isFinite(exp.amount) || exp.amount <= 0) continue;
    if (name.length > 100 || exp.amount > 100_000_000_00) {
      result.failures.push(`「${name.slice(0, 10)}」金额或名称超出限制`);
      continue;
    }

    try {
      await useExpenseStore.getState().addItem({
        name,
        amount: exp.amount,
        category: normalizeExpenseCategory(exp.category),
        date: today,
        isIncome: false,
        source: 'quicknote',
      });
      result.expenseCount += 1;
    } catch {
      result.failures.push(`记账「${name.slice(0, 10)}」失败`);
    }
  }

  for (const habit of habits) {
    if (!habit.confirmed) continue;
    const habitStore = useHabitStore.getState();
    const existingHabit = habitStore.items.find((h) => h.name === habit.name || h.name.includes(habit.name));
    if (!existingHabit) continue;
    try {
      const current = await import('../db').then(({ db }) =>
        db.habitCheckins.get(`${existingHabit.id}|${today}`),
      );
      const currentlyDone = current?.done ?? existingHabit.done;
      if (habit.done && !currentlyDone) {
        await habitStore.toggleHabit(existingHabit.id);
        result.habitCount += 1;
      }
    } catch {
      result.failures.push(`打卡「${existingHabit.name}」失败`);
    }
  }

  const trimmedDiary = diary?.trim() ?? '';
  if (trimmedDiary) {
    try {
      const diaryStore = useDiaryStore.getState();
      const existingForToday = diaryStore.getItemsByDate(today);
      if (existingForToday.length > 0) {
        await diaryStore.updateItem(existingForToday[0].id, {
          content: trimmedDiary,
          mood,
          moodScore,
        });
        result.diaryUpdated = true;
      } else {
        await diaryStore.addItem({
          date: today,
          content: trimmedDiary,
          mood,
          moodScore,
          source: 'quicknote_aggregated',
          quickNoteIds: [],
        });
        result.diaryCreated = true;
      }
    } catch {
      result.failures.push('日记保存失败');
    }
  }

  const seenTodos = new Set<string>();
  for (const todo of todos) {
    const rawTitle = todo.text.trim().slice(0, 200);
    if (!todo.confirmed || rawTitle.length < 2 || seenTodos.has(rawTitle)) continue;

    const { text, dueDate } = resolveDueDate(rawTitle);
    seenTodos.add(rawTitle);

    try {
      await useTodoStore.getState().addItem({ text, priority: 'medium', dueDate });
      result.todoCount += 1;
    } catch {
      result.failures.push(`待办「${text.slice(0, 10)}」创建失败`);
    }
  }

  return result;
}
