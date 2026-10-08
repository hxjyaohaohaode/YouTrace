import { Brand } from '../ui/Brand';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Home, Calendar, Mic, BarChart3, MessageCircle, BookOpen,
  CheckSquare, Target, Settings, Sparkles, Activity
} from 'lucide-react';
import { staticPageEntry } from '../../lib/navigation';
import { useAuthStore } from '../../stores/authStore';

interface SidebarItem {
  icon: typeof Home;
  label: string;
  path: string;
}

const mainItems: SidebarItem[] = [
  { icon: Home, label: '首页', path: '/' },
  { icon: BarChart3, label: '花销', path: '/expense' },
  { icon: BookOpen, label: '日记', path: '/diary' },
  { icon: Activity, label: '时间线', path: '/timeline' },
  { icon: Calendar, label: '日程', path: '/schedule' },
  { icon: CheckSquare, label: '待办', path: '/todo' },
  { icon: Sparkles, label: '习惯', path: '/habit' },
  { icon: Target, label: '目标', path: '/goal' },
  { icon: MessageCircle, label: 'AI 教练', path: '/coach' },
  { icon: Target, label: '教练洞察', path: '/insights' },
  { icon: Settings, label: '设置', path: '/settings' },
];

export function DesktopSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);


  return (
    <aside
      className="fixed left-0 top-0 hidden h-full w-[232px] flex-col border-r border-[var(--border)] bg-[var(--sidebar)] min-[1025px]:flex"
      style={{ zIndex: 'var(--z-nav)' }}
    >
      <div className="sidebar-brand"><Brand /><p>记录 · 安排 · 回看</p></div>
      <button className="sidebar-capture" onClick={() => navigate('/quick-note', { state: staticPageEntry('/quick-note', user?.id) })}><Mic size={19} />记下一刻<span>＋</span></button>

      <nav className="sidebar-navigation flex-1 overflow-y-auto px-3 py-1" aria-label="主导航">
        {mainItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          return (
            <div key={item.path}>
              <motion.button
                type="button"
                onClick={() => navigate(item.path, { state: staticPageEntry(item.path, user?.id) })}
                aria-current={isActive ? 'page' : undefined}
                whileTap={{ scale: 0.97 }}
                className={`group relative mb-0.5 flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-[var(--primary-soft)] text-[var(--text-1)] font-semibold'
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

      <div className="border-t border-[var(--border)] px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--primary-soft)]">
              <span className="text-sm font-bold text-[var(--link)]">{(user?.nickname || '你').slice(0, 1)}</span>
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--glass-bg)] ${user ? 'bg-emerald-400' : 'bg-[var(--text-4)]'}`} aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--text-1)]">{user?.nickname || '未登录'}</p>
            <p className="truncate text-xs text-[var(--text-3)]" title={`构建 ${__BUILD_REVISION__}`}>我的生活工作台</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
