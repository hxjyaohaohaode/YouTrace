import { useNavigate } from 'react-router-dom';
import { Mic, Calendar, BookOpen, BarChart3, MessageCircle, Activity } from 'lucide-react';
import { motion } from 'framer-motion';

interface QuickAction {
  icon: typeof Mic;
  label: string;
  path: string;
  color: string;
  bg: string;
  gradient: string;
}

const actions: QuickAction[] = [
  { icon: Mic, label: '速记', path: '/quick-note', color: '#5B5FC7', bg: 'bg-[#5B5FC7]/8', gradient: 'from-[#5B5FC7] to-[#7C5CFC]' },
  { icon: Calendar, label: '日程', path: '/schedule', color: '#2EA06B', bg: 'bg-[#2EA06B]/8', gradient: 'from-[#2EA06B] to-[#3FBF7E]' },
  { icon: BarChart3, label: '花销', path: '/expense', color: '#D99A2B', bg: 'bg-[#D99A2B]/8', gradient: 'from-[#D99A2B] to-[#E8853D]' },
  { icon: BookOpen, label: '日记', path: '/diary', color: '#7C5CFC', bg: 'bg-[#7C5CFC]/8', gradient: 'from-[#7C5CFC] to-[#9B80FF]' },
  { icon: MessageCircle, label: '教练', path: '/coach', color: '#E8853D', bg: 'bg-[#E8853D]/8', gradient: 'from-[#E8853D] to-[#F0A05C]' },
  { icon: Activity, label: '时间线', path: '/timeline', color: '#2EA06B', bg: 'bg-[#2EA06B]/8', gradient: 'from-[#2EA06B] to-[#3FBF7E]' },
];

export function QuickActions() {
  const navigate = useNavigate();

  return (
    <>
      <div className="hidden sm:grid grid-cols-3 sm:grid-cols-6 gap-3">
        {actions.map((action, i) => {
          const Icon = action.icon;
          return (
            <motion.button
              key={action.label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ y: -4, scale: 1.04 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate(action.path)}
              className="group flex flex-col items-center gap-2.5 rounded-[var(--radius-lg)] bg-[var(--surface)] p-4 border border-[var(--border-light)] transition-all duration-200 hover:border-[var(--border)] hover:shadow-[var(--shadow-md)]"
              aria-label={action.label}
            >
              <div className={`h-12 w-12 rounded-2xl bg-gradient-to-br ${action.gradient} flex items-center justify-center shadow-sm transition-transform duration-200 group-hover:scale-105`}>
                <Icon size={22} className="text-white" />
              </div>
              <span className="text-[11px] font-semibold text-[var(--text-2)] group-hover:text-[var(--text-1)] transition-colors">{action.label}</span>
            </motion.button>
          );
        })}
      </div>

      <div className="flex sm:hidden overflow-x-auto gap-3 pb-2 scrollbar-hide snap-x">
        {actions.map((action, i) => {
          const Icon = action.icon;
          return (
            <motion.button
              key={action.label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate(action.path)}
              className="group flex flex-col items-center gap-2.5 rounded-[var(--radius-lg)] bg-[var(--surface)] p-4 border border-[var(--border-light)] min-w-[80px] snap-center shrink-0"
              aria-label={action.label}
            >
              <div className={`h-12 w-12 rounded-2xl bg-gradient-to-br ${action.gradient} flex items-center justify-center shadow-sm`}>
                <Icon size={22} className="text-white" />
              </div>
              <span className="text-[11px] font-semibold text-[var(--text-2)] whitespace-nowrap">{action.label}</span>
            </motion.button>
          );
        })}
      </div>
    </>
  );
}
