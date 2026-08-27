import { Outlet, useLocation } from 'react-router-dom';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { DesktopSidebar } from './DesktopSidebar';
import { TabletSidebar } from './TabletSidebar';
import { BottomNav } from './BottomNav';
import { AnimatePresence, motion } from 'framer-motion';

export function AppLayout() {
  const isDesktop = useMediaQuery('(min-width: 1025px)');
  const isTablet = useMediaQuery('(min-width: 769px) and (max-width: 1024px)');
  const isMobile = !isDesktop && !isTablet;
  const location = useLocation();

  return (
    <div className="flex min-h-screen w-full overflow-x-hidden bg-[var(--bg)]">
      {isDesktop && <DesktopSidebar />}
      {isTablet && <TabletSidebar />}

      <main
        className={`flex-1 min-w-0 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isDesktop ? 'ml-[260px]' : isTablet ? 'ml-[76px]' : ''
        } ${isMobile ? 'pb-24' : 'pb-8'}`}
      >
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-5 sm:py-8 lg:px-12">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {isMobile && <BottomNav />}
    </div>
  );
}
