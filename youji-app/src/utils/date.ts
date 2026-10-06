export const BUSINESS_TIME_ZONE = 'Asia/Shanghai';

const businessDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const businessClockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const weekdayNumbers: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function formatBusinessDate(date: Date = new Date()): string {
  const parts = Object.fromEntries(
    businessDateFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
}

export function parseBusinessDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('Invalid business date');
  const parsed = new Date(`${date}T12:00:00+08:00`);
  if (Number.isNaN(parsed.getTime()) || formatBusinessDate(parsed) !== date) {
    throw new RangeError('Invalid business date');
  }
  return parsed;
}

export function addDays(date: string, days: number): string {
  return formatBusinessDate(new Date(parseBusinessDate(date).getTime() + days * 86_400_000));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseBusinessDate(to).getTime() - parseBusinessDate(from).getTime()) / 86_400_000);
}

export function getBusinessClock(date: Date = new Date()) {
  const parts = Object.fromEntries(
    businessClockFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdayNumbers[parts.weekday] ?? 0,
  };
}

export function getBusinessDayStartTimestamp(date: string = getToday()): number {
  parseBusinessDate(date);
  return new Date(`${date}T00:00:00+08:00`).getTime();
}

export function getToday(): string {
  return formatBusinessDate();
}

export function getYesterday(): string {
  return addDays(getToday(), -1);
}

export function getDateDaysAgo(days: number): string {
  return addDays(getToday(), -days);
}

export function getBusinessMonth(date: Date = new Date()): string {
  return formatBusinessDate(date).slice(0, 7);
}

export function getNaturalWeekDates(reference: string = getToday()): string[] {
  const parsed = parseBusinessDate(reference);
  const weekday = parsed.getUTCDay() || 7;
  const monday = addDays(reference, -(weekday - 1));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function formatDateLabel(dateStr: string): string {
  try {
    const today = getToday();
    if (dateStr === today) return '今天';
    if (dateStr === getYesterday()) return '昨天';
    const d = parseBusinessDate(dateStr);
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  } catch {
    return dateStr;
  }
}
