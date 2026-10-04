import { Link, useLocation } from 'react-router-dom';
import { useScheduleStore } from '../stores/scheduleStore';
import { Calendar } from 'lucide-react';
import { ScheduleContent } from '../components/schedule/ScheduleContent';
import { PageHeader } from '../components/layout/PageHeader';

export default function Schedule() {
  const location = useLocation(), id = new URLSearchParams(location.search).get('record');
  const rows = useScheduleStore(state => state.items), loaded = useScheduleStore(state => state.loaded);
  const selected = rows.find(row => row.id === id);
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
      {id && !loaded ? <p role="status">正在寻找这条日程…</p> : id && !selected ? <p role="alert">当前账号没有这条日程，或已删除。不会打开同名的其他记录。</p> : <ScheduleContent key={id ?? 'list'} initialRecord={selected} />}
    </div>
  );
}
