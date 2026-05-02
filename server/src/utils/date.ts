export function prismaDateToLocal(prismaDate: Date): Date {
  const offsetMs = prismaDate.getTimezoneOffset() * 60000;
  return new Date(prismaDate.getTime() + offsetMs);
}

export function dateToLocalISOString(prismaDate: Date): string {
  const adjusted = prismaDateToLocal(prismaDate);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${adjusted.getFullYear()}-${pad(adjusted.getMonth() + 1)}-${pad(adjusted.getDate())}T${pad(adjusted.getHours())}:${pad(adjusted.getMinutes())}:${pad(adjusted.getSeconds())}`;
}

export function formatLocalTime(prismaDate: Date): string {
  const adjusted = prismaDateToLocal(prismaDate);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(adjusted.getHours())}:${pad(adjusted.getMinutes())}`;
}

export function formatLocalDate(prismaDate: Date): string {
  const adjusted = prismaDateToLocal(prismaDate);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${adjusted.getFullYear()}-${pad(adjusted.getMonth() + 1)}-${pad(adjusted.getDate())}`;
}

export function formatLocalMonthDay(prismaDate: Date): string {
  const adjusted = prismaDateToLocal(prismaDate);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(adjusted.getMonth() + 1)}月${pad(adjusted.getDate())}日`;
}

export function eventToLocalISO(event: Record<string, unknown>): Record<string, unknown> {
  const result = { ...event };
  if (result.startTime instanceof Date) {
    result.startTime = dateToLocalISOString(result.startTime as Date);
  }
  if (result.endTime instanceof Date) {
    result.endTime = dateToLocalISOString(result.endTime as Date);
  }
  if (result.createdAt instanceof Date) {
    result.createdAt = dateToLocalISOString(result.createdAt as Date);
  }
  if (result.updatedAt instanceof Date) {
    result.updatedAt = dateToLocalISOString(result.updatedAt as Date);
  }
  return result;
}
