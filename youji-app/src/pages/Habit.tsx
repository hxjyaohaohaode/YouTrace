import { Sparkles } from 'lucide-react';
import { HabitList } from '../components/habit/HabitList';
import { PageHeader } from '../components/layout/PageHeader';

export default function Habit() {
  return (
    <div className="w-full">
      <PageHeader
        icon={Sparkles}
        gradient="from-[var(--success)] to-[#3FBF7E]"
        title="习惯"
        subtitle="培养好习惯，坚持每一天"
      />
      <HabitList />
    </div>
  );
}
