import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const NAV_ITEMS = [
  {
    path: '/',
    label: '日记',
    icon: (active: boolean) => (
      <svg className={`w-5 h-5 ${active ? 'text-brand-500' : 'text-surface-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.5 : 1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
  },
  {
    path: '/calendar',
    label: '日程',
    icon: (active: boolean) => (
      <svg className={`w-5 h-5 ${active ? 'text-brand-500' : 'text-surface-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.5 : 1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    path: '/ai',
    label: 'AI',
    icon: (active: boolean) => (
      <svg className={`w-5 h-5 ${active ? 'text-brand-500' : 'text-surface-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.5 : 1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    path: '/weather',
    label: '天气',
    icon: (active: boolean) => (
      <svg className={`w-5 h-5 ${active ? 'text-brand-500' : 'text-surface-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.5 : 1.5} d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
      </svg>
    ),
  },
  {
    path: '/profile',
    label: '我的',
    icon: (active: boolean) => (
      <svg className={`w-5 h-5 ${active ? 'text-brand-500' : 'text-surface-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.5 : 1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
];

const SIDEBAR_EXTRA_ITEMS = [
  {
    path: '/goals', label: '目标', icon: (a: boolean) => (
      <svg className={`w-5 h-5 ${a ? 'text-brand-500' : 'text-surface-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={a ? 2.5 : 1.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
      </svg>
    )
  },
  {
    path: '/habits', label: '习惯', icon: (a: boolean) => (
      <svg className={`w-5 h-5 ${a ? 'text-brand-500' : 'text-surface-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={a ? 2.5 : 1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    )
  },
  {
    path: '/stats', label: '统计', icon: (a: boolean) => (
      <svg className={`w-5 h-5 ${a ? 'text-brand-500' : 'text-surface-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={a ? 2.5 : 1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    )
  },
];

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('youji_sidebar_collapsed') === 'true';
  });

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('youji_sidebar_collapsed', String(next));
  };

  const sidebarWidth = collapsed ? 'w-16 lg:w-18' : 'w-56 lg:w-64';
  const contentPadding = collapsed ? 'md:pl-16 lg:pl-18' : 'md:pl-56 lg:pl-64';

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <main className={`transition-all duration-300 ${contentPadding}`}>
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-surface-900/95 border-t border-surface-100 dark:border-surface-800 safe-bottom md:hidden backdrop-blur-xl backdrop-saturate-150">
        <div className="flex items-center justify-around h-16 px-2">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-xl transition-all duration-200 min-w-0 ${active ? 'nav-item-active' : 'nav-item-inactive'
                  }`}
              >
                {item.icon(active)}
                <span className={`text-2xs font-medium ${active ? 'text-brand-500' : 'text-surface-400'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <nav className={`hidden md:flex fixed left-0 top-0 bottom-0 ${sidebarWidth} bg-white dark:bg-surface-900 border-r border-surface-100/80 dark:border-surface-800/80 z-40 flex-col transition-all duration-300`}>
        <div className={`p-5 mb-2 flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'}`}>
          <div className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-950/40 flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 1024 1024" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="sidebar-g" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#e8941e" />
                  <stop offset="100%" stopColor="#c9553e" />
                </linearGradient>
              </defs>
              <circle cx="512" cy="512" r="56" fill="url(#sidebar-g)" />
              <circle cx="512" cy="512" r="140" fill="none" stroke="url(#sidebar-g)" strokeWidth="14" opacity="0.55" />
              <circle cx="512" cy="512" r="236" fill="none" stroke="url(#sidebar-g)" strokeWidth="11" opacity="0.3" />
            </svg>
          </div>
          {!collapsed && <span className="text-lg font-bold gradient-text">有迹</span>}
        </div>

        <div className={`flex-1 ${collapsed ? 'px-2' : 'px-3'} space-y-0.5 overflow-y-auto overflow-x-hidden`}>
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                title={collapsed ? item.label : undefined}
                className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} ${collapsed ? 'px-0' : 'px-3'} py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${active ? 'bg-brand-50 dark:bg-brand-950/30 text-brand-600 dark:text-brand-400' : 'text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-700 dark:hover:text-surface-300'
                  }`}
              >
                {item.icon(active)}
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}

          <div className="pt-3 mt-3 border-t border-surface-100 dark:border-surface-800">
            {SIDEBAR_EXTRA_ITEMS.map((item) => {
              const active = isActive(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  title={collapsed ? item.label : undefined}
                  className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} ${collapsed ? 'px-0' : 'px-3'} py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${active ? 'bg-brand-50 dark:bg-brand-950/30 text-brand-600 dark:text-brand-400' : 'text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-700 dark:hover:text-surface-300'
                    }`}
                >
                  {item.icon(active)}
                  {!collapsed && <span>{item.label}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className={`${collapsed ? 'px-2' : 'px-3'} pb-4 pt-2 border-t border-surface-100 dark:border-surface-800`}>
          <button
            onClick={() => toggleCollapsed()}
            className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} ${collapsed ? 'px-0' : 'px-3'} py-2.5 rounded-xl text-sm font-medium text-surface-400 dark:text-surface-500 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-600 dark:hover:text-surface-400 transition-all duration-200`}
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            <svg className={`w-5 h-5 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            {!collapsed && <span>收起菜单</span>}
          </button>
        </div>
      </nav>
    </div>
  );
}

export default Layout;
