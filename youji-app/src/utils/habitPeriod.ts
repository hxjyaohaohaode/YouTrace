import { getNaturalWeekDates } from './date';

export interface DatedHabitFact { date: string; done: boolean }
export interface PeriodHabit {
  frequency: string;
  createdAt: number;
  recentCheckins: readonly DatedHabitFact[];
  checkinSources?: readonly DatedHabitFact[];
}

/** Current plan attainment and the fact of doing it today are different questions. */
export function getHabitPeriod(habit: PeriodHabit, today: string) {
  const week = getNaturalWeekDates(today);
  const weekly = habit.frequency === 'weekly';
  const start = weekly ? week[0] : today, end = weekly ? week[6] : today;
  const facts = habit.checkinSources ?? habit.recentCheckins;
  const completedDates = [...new Set(facts.filter(row => row.done && row.date >= start && row.date <= today).map(row => row.date))].sort();
  // There is no activity-start field. Even a clock-skewed audit timestamp must
  // not hide an existing habit on Home while other pages still display it.
  const applicable = true;
  return { weekly, start, end, completedDates, applicable, attained: completedDates.length > 0, doneToday: completedDates.includes(today) };
}
