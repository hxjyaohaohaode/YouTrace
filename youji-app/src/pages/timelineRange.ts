import { addDays, parseBusinessDate } from '../utils/date';

export type TimelineRange = '7' | '30' | 'all';

function validDate(value: string | null): value is string {
  if (!value) return false;
  try { parseBusinessDate(value); return true; } catch { return false; }
}

/** A URL identifies a fixed inclusive interval, never a moving query at render time. */
export function timelineRange(search: string, today: string) {
  const params = new URLSearchParams(search);
  const requested = params.get('range');
  const range: TimelineRange = requested === '30' || requested === 'all' ? requested : '7';
  params.set('range', range);
  if (range === 'all') {
    params.delete('from'); params.delete('through');
    return { range, from: null, through: null, search: `?${params}` };
  }
  const days = range === '30' ? 29 : 6;
  const givenFrom = params.get('from'), givenThrough = params.get('through');
  const valid = validDate(givenFrom) && validDate(givenThrough) && addDays(givenThrough, -days) === givenFrom;
  const through = valid ? givenThrough : today;
  const from = valid ? givenFrom : addDays(today, -days);
  params.set('from', from); params.set('through', through);
  return { range, from, through, search: `?${params}` };
}

export function timelineRangeIncludes(date: string | null, scope: ReturnType<typeof timelineRange>) {
  return scope.range === 'all' || date === null || date >= scope.from! && date <= scope.through!;
}
