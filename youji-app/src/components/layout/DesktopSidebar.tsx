import { useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Home, Calendar, Mic, BarChart3, MessageCircle, BookOpen,
  CheckSquare, Target, Settings, Sparkles, Activity
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';

interface SidebarItem {
  icon: typeof Home;
  label: string;
  path: string;
  section?: string;
}

const mainItems: SidebarItem[] = [
  { icon: Home, label: '首页', path: '/' },
  { icon: Mic, label: '速记', path: '/quick-note', section: '记录与回看' },
  { icon: BarChart3, label: '花销', path: '/expense' },
  { icon: BookOpen, label: '日记', path: '/diary' },
  { icon: Activity, label: '时间线', path: '/timeline' },
  { icon: Calendar, label: '日程', path: '/schedule', section: '安排与坚持' },
  { icon: CheckSquare, label: '待办', path: '/todo' },
  { icon: Sparkles, label: '习惯', path: '/habit' },
  { icon: Target, label: '目标', path: '/goal' },
  { icon: MessageCircle, label: 'AI 教练', path: '/coach', section: '观察与行动' },
  { icon: Target, label: '教练洞察', path: '/insights' },
  { icon: Settings, label: '设置', path: '/settings', section: '账号与偏好' },
];

export function DesktopSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);

  const renderedItems = useMemo(() => {
    const sectionsSeen = new Set<string>();
    return mainItems.map((item) => {
      const showSection = item.section ? !sectionsSeen.has(item.section) : false;
      if (item.section) sectionsSeen.add(item.section);
      return { ...item, showSection };
    });
  }, []);

  return (
    <aside
      className="fixed left-0 top-0 hidden h-full w-[260px] flex-col border-r border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-2xl lg:flex"
      style={{ zIndex: 'var(--z-nav)' }}
    >
      <div className="flex items-center gap-3.5 px-6 py-7">
        <motion.div
          whileHover={{ rotate: 15, scale: 1.1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-light)] shadow-[var(--shadow-glow)]"
        >
          <Sparkles size={20} className="text-white" />
        </motion.div>
        <div>
          <span className="text-lg font-bold text-[var(--text-1)] tracking-tight">有迹</span>
          <p className="text-[10px] font-medium text-[var(--text-4)] tracking-widest uppercase">YouTrace</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="主导航">
        {renderedItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          return (
            <div key={item.path}>
              {item.showSection && (
                <p className="mb-2 mt-6 px-4 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-4)]">
                  {item.section}
                </p>
              )}
              <motion.button
                type="button"
                onClick={() => navigate(item.path)}
                aria-current={isActive ? 'page' : undefined}
                whileTap={{ scale: 0.97 }}
                className={`group relative mb-0.5 flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-[13px] font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] text-white font-semibold shadow-[var(--shadow-glow)]'
                    : 'text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)]'
                }`}
              >
                <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
                <span>{item.label}</span>
              </motion.button>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-[var(--glass-border)] px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--primary-light)]">
              <span className="text-xs font-bold text-white">{(user?.nickname || '你').slice(0, 1)}</span>
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--glass-bg)] ${user ? 'bg-emerald-400' : 'bg-[var(--text-4)]'}`} aria-hidden />
          </div>
          <div>
            <p className="text-[13px] font-medium text-[var(--text-1)]">{user?.nickname || '未登录'}</p>
            <p className="text-[11px] text-[var(--text-4)]">构建 {__BUILD_REVISION__}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
