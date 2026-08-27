import { Calendar } from 'lucide-react';
import { ScheduleContent } from '../components/schedule/ScheduleContent';
import { PageHeader } from '../components/layout/PageHeader';

export default function Schedule() {
  return (
    <div className="w-full">
      <PageHeader
        icon={Calendar}
        gradient="from-[#45B7D1] to-[#6C5CE7]"
        title="日程"
        subtitle="安排你的时间和计划"
      />
      <ScheduleContent />
    </div>
  );
}
