import { LegacyDataNotice } from './LegacyDataNotice';
import { useOutlet, useLocation } from 'react-router-dom';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { DesktopSidebar } from './DesktopSidebar';
import { TabletSidebar } from './TabletSidebar';
import { BottomNav } from './BottomNav';

export function AppLayout() {
  const isDesktop = useMediaQuery('(min-width: 1025px)');
  const isTablet = useMediaQuery('(min-width: 769px) and (max-width: 1024px)');
  const isMobile = !isDesktop && !isTablet;
  const location = useLocation();
  const outlet = useOutlet();
  const immersive = ['/quick-note', '/quick-note/result'].includes(location.pathname);

  return (
    <div className="flex min-h-screen w-full overflow-x-hidden bg-[var(--bg)]">
      {isDesktop && !immersive && <DesktopSidebar />}
      {isTablet && !immersive && <TabletSidebar />}

      <main
        className={`flex-1 min-w-0 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          !immersive && isDesktop ? 'ml-[260px]' : !immersive && isTablet ? 'ml-[76px]' : ''
        } ${isMobile && !immersive ? 'pb-24' : 'pb-8'}`}
      >
        {/* A live Outlet in an exiting transformed parent can mount the new
            fixed capture page inside a zero-height, transparent old route.
            Keep the route surface stable; each feature owns its transitions. */}
        {immersive ? (
          <div data-route-surface="capture">{outlet}</div>
        ) : (
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-5 sm:py-8 lg:px-12" data-route-surface="workspace">
            <LegacyDataNotice />
            {outlet}
          </div>
        )}
      </main>

      {isMobile && !immersive && <BottomNav />}
    </div>
  );
}
