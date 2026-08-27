import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, Calendar, Mic, BarChart3, MessageCircle } from 'lucide-react';

interface NavItem {
  icon: typeof Home;
  label: string;
  path: string;
  isCenter?: boolean;
}

const navItems: NavItem[] = [
  { icon: Home, label: '首页', path: '/' },
  { icon: Calendar, label: '日程', path: '/schedule' },
  { icon: Mic, label: '速记', path: '/quick-note', isCenter: true },
  { icon: BarChart3, label: '花销', path: '/expense' },
  { icon: MessageCircle, label: '教练', path: '/coach' },
];

export function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 border-t border-[var(--glass-border)] bg-[var(--glass-bg)]/80 backdrop-blur-2xl pb-[env(safe-area-inset-bottom)]"
      style={{ zIndex: 'var(--z-nav)' }}
      role="navigation"
      aria-label="主导航"
    >
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-2">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          if (item.isCenter) {
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => navigate(item.path)}
                aria-current={isActive ? 'page' : undefined}
                className="relative -mt-7 flex flex-col items-center"
                aria-label={item.label}
              >
                <motion.div
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                  className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-light)] text-white shadow-[var(--shadow-glow)]"
                >
                  <Icon size={24} />
                </motion.div>
                <span className="mt-1 text-[10px] font-bold text-[var(--primary)]">{item.label}</span>
              </button>
            );
          }

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="relative flex flex-col items-center gap-1 px-4 py-2"
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <div className={`rounded-full p-1.5 transition-all duration-200 ${isActive ? 'bg-gradient-to-r from-[var(--primary-soft)] to-[var(--primary-muted)]' : ''}`}>
                <Icon
                  size={20}
                  strokeWidth={isActive ? 2.2 : 1.8}
                  className={`transition-colors duration-200 ${isActive ? 'text-[var(--primary)]' : 'text-[var(--text-3)]'}`}
                />
              </div>
              <span className={`text-[10px] transition-colors duration-200 ${isActive ? 'text-[var(--primary)] font-bold' : 'text-[var(--text-3)] font-medium'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
