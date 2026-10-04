import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { recordDiagnostic, ROUTE_IDS } from '../../services/diagnostics';

export function RuntimeObserver() {
  const { pathname } = useLocation();
  useEffect(() => {
    const area = ROUTE_IDS[pathname] ?? 'unknown';
    const start = performance.now();
    const frame = requestAnimationFrame(() => recordDiagnostic('page-ready', area, performance.now() - start));
    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input[type=checkbox]')) recordDiagnostic('checkbox', area);
      else if (target?.closest('button, a')) recordDiagnostic('button', area);
    };
    const focus = (event: FocusEvent) => { if (event.target instanceof Element && event.target.matches('input, textarea, select')) recordDiagnostic('input-focus', area); };
    const error = () => recordDiagnostic('runtime-error', area);
    document.addEventListener('click', click);
    document.addEventListener('focusin', focus);
    window.addEventListener('error', error);
    window.addEventListener('unhandledrejection', error);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('click', click); document.removeEventListener('focusin', focus); window.removeEventListener('error', error); window.removeEventListener('unhandledrejection', error); };
  }, [pathname]);
  return null;
}
