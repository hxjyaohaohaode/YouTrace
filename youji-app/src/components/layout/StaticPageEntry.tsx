import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { isStaticPageEntry } from '../../lib/navigation';

/** Only explicit static navigation starts at the page heading. Back/record focus stays local. */
export function StaticPageEntry({ path, children, className }: { path: string; children: ReactNode; className?: string }) {
  const location = useLocation(), navigationType = useNavigationType();
  const ownerId = useAuthStore(state => state.user?.id) ?? '';
  const surface = useRef<HTMLDivElement>(null);
  const eligible = isStaticPageEntry(location.state, ownerId, path, navigationType);
  useLayoutEffect(() => {
    const root = surface.current;
    if (!eligible || !root) return;
    let stopped = false, frame = 0;
    const started = performance.now(), routeKey = location.key;
    const stop = () => {
      stopped = true; cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', userIntent, true);
      document.removeEventListener('keydown', userIntent, true);
      document.removeEventListener('wheel', userIntent, true);
      document.removeEventListener('touchstart', userIntent, true);
    };
    const userIntent = (event: Event) => { if (event.isTrusted) stop(); };
    const place = () => {
      if (stopped || !root.isConnected || root.dataset.pageKey !== routeKey || window.location.pathname !== path || useAuthStore.getState().user?.id !== ownerId) { stop(); return; }
      const active = document.activeElement;
      if (active instanceof Element && active.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) { stop(); return; }
      const heading = root.querySelector<HTMLElement>('h1');
      let visible = Boolean(heading && heading.getBoundingClientRect().height > 0);
      for (let node: Element | null = heading; visible && node && root.contains(node); node = node.parentElement) {
        const style = getComputedStyle(node);
        visible = style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
      }
      if (heading && visible) {
        window.scrollTo({ top: 0, behavior: 'instant' });
        if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
        heading.focus({ preventScroll: true }); stop(); return;
      }
      // A late title must never take focus after the user has moved on.
      if (performance.now() - started >= 2000) { stop(); return; }
      frame = requestAnimationFrame(place);
    };
    document.addEventListener('pointerdown', userIntent, true);
    document.addEventListener('keydown', userIntent, true);
    document.addEventListener('wheel', userIntent, { capture: true, passive: true });
    document.addEventListener('touchstart', userIntent, { capture: true, passive: true });
    frame = requestAnimationFrame(place);
    return stop;
  }, [eligible, location.key, ownerId, path]);
  return <div ref={surface} className={className} data-page-route={path} data-page-key={location.key}>{children}</div>;
}
