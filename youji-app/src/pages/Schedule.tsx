import { parseBusinessDate } from '../utils/date';
import { Link, useLocation } from 'react-router-dom';
import { useScheduleStore, expandRecurringForRange } from '../stores/scheduleStore';
import { Calendar } from 'lucide-react';
import { ScheduleContent } from '../components/schedule/ScheduleContent';
import { PageHeader } from '../components/layout/PageHeader';

export default function Schedule() {
  const location = useLocation(), id = new URLSearchParams(location.search).get('record');
  const rows = useScheduleStore(state => state.items), loaded = useScheduleStore(state => state.loaded);
  const selected = rows.find(row => row.id === id);
  const requestedOccurrence = new URLSearchParams(location.search).get('occurrence');
  let occurrenceDate: string | null = null;
  try { if (requestedOccurrence) { parseBusinessDate(requestedOccurrence); occurrenceDate = requestedOccurrence; } } catch { /* malformed destination remains at the canonical record */ }
  const exception = selected?.exceptions?.find(row => row.occurrenceDate === occurrenceDate);
  const occurrence = selected && occurrenceDate ? expandRecurringForRange([selected], exception?.date ?? occurrenceDate, exception?.date ?? occurrenceDate).find(row => row.occurrenceDate === occurrenceDate) : undefined;
  const returnTo = (location.state as { returnTo?: { path: string; label: string } } | null)?.returnTo;
  return (
    <div className="w-full">
      <PageHeader
        icon={Calendar}
        gradient="from-[#45B7D1] to-[#6C5CE7]"
        title="日程"
        subtitle="安排你的时间和计划"
      />
      {returnTo?.path.startsWith('/') && <Link className="mb-3 inline-block min-h-11 py-3 text-sm underline" to={returnTo.path}>{returnTo.label}</Link>}
      {id && !loaded ? <p role="status">正在寻找这条日程…</p> : id && !selected ? <p role="alert">当前账号没有这条日程，或已删除。不会打开同名的其他记录。</p> : occurrenceDate && !occurrence ? <p role="status">这次日程已取消或不在该系列中。<Link className="underline" to={`/schedule?record=${encodeURIComponent(id ?? '')}`}>查看原系列</Link></p> : <ScheduleContent key={`${id ?? 'list'}:${occurrenceDate ?? ''}`} initialRecord={selected} initialOccurrence={occurrence} />}
    </div>
  );
}
