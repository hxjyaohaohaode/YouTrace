import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Home, Calendar, Mic, BarChart3, MessageCircle, BookOpen,
  CheckSquare, Target, Settings, Sparkles, Activity
} from 'lucide-react';

interface NavItem {
  icon: typeof Home;
  label: string;
  path: string;
}

const items: NavItem[] = [
  { icon: Home, label: '首页', path: '/' },
  { icon: Calendar, label: '日程', path: '/schedule' },
  { icon: Mic, label: '速记', path: '/quick-note' },
  { icon: BarChart3, label: '花销', path: '/expense' },
  { icon: CheckSquare, label: '待办', path: '/todo' },
  { icon: BookOpen, label: '日记', path: '/diary' },
  { icon: Activity, label: '时间线', path: '/timeline' },
  { icon: MessageCircle, label: '教练', path: '/coach' },
  { icon: Target, label: '洞察', path: '/insights' },
  { icon: Sparkles, label: '习惯', path: '/habit' },
  { icon: Target, label: '目标', path: '/goal' },
  { icon: Settings, label: '设置', path: '/settings' },
];

export function TabletSidebar() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <aside
      className="fixed left-0 top-0 flex h-full w-[76px] flex-col items-center border-r border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-2xl"
      style={{ zIndex: 'var(--z-nav)' }}
    >
      <div className="flex h-16 w-full items-center justify-center border-b border-[var(--glass-border)]">
        <motion.div
          whileHover={{ rotate: 15, scale: 1.1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-light)] shadow-[var(--shadow-glow)]"
        >
          <Sparkles size={18} className="text-white" />
        </motion.div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 scrollbar-hide" aria-label="主导航">
        {items.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          return (
            <motion.button
              key={item.path}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => navigate(item.path)}
              className={`relative mb-1 flex w-full flex-col items-center gap-1 py-2.5 transition-all duration-200 ${
                isActive
                  ? 'text-[var(--primary)]'
                  : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
              }`}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              title={item.label}
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all ${isActive ? 'bg-gradient-to-br from-[var(--primary-soft)] to-[var(--primary-muted)]' : ''}`}>
                <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
              </div>
              <span className="text-[9px] font-medium">{item.label}</span>
              {isActive && (
                <motion.div
                  layoutId="tabletSidebarIndicator"
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                  className="absolute right-1 top-1/2 h-4 w-1.5 -translate-y-1/2 rounded-full bg-gradient-to-b from-[var(--primary)] to-[var(--primary-light)]"
                />
              )}
            </motion.button>
          );
        })}
      </nav>
    </aside>
  );
}
