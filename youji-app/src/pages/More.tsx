import { useLayoutEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { destinations, directoryOrigin, navigationGroups, parseDirectoryPosition, type DirectoryPosition } from '../lib/navigation';
import { useAuthStore } from '../stores/authStore';
import { Button } from '../components/ui/Button';

// Per-tab, per-account navigation only: fixed destinations and a scroll number.
// Session storage survives reload; unavailable storage falls back to this document.
const readingPositions = new Map<string, DirectoryPosition>();
function positionFor(owner: string) {
  if (!owner) return null;
  try { return parseDirectoryPosition(sessionStorage.getItem(`youtrace:nav-view:${owner}`)) ?? readingPositions.get(owner) ?? null; }
  catch { return readingPositions.get(owner) ?? null; }
}
function rememberPosition(owner: string, position: DirectoryPosition) {
  if (!owner) return;
  readingPositions.set(owner, position);
  try { sessionStorage.setItem(`youtrace:nav-view:${owner}`, JSON.stringify(position)); } catch { /* Navigation remains usable without optional scroll retention. */ }
}
export default function More() {
  const owner = useAuthStore(state => state.user?.id) ?? '';
  const location = useLocation(), navigate = useNavigate(), heading = useRef<HTMLHeadingElement>(null);
  const origin = directoryOrigin(location.state, owner);
  const previous = positionFor(owner);
  useLayoutEffect(() => {
    const saved = positionFor(owner);
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: saved?.top ?? 0, behavior: 'instant' });
      const target = saved ? document.querySelector<HTMLAnchorElement>(`[data-component="feature-directory"] a[href="${saved.path}"]`) : null;
      (target ?? heading.current)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [owner]);
  return <div className="space-y-6" data-component="feature-directory">
    <Button variant="ghost" onClick={() => { if (origin) navigate(-1); else navigate('/', { replace: true }); }}><ArrowLeft size={16} aria-hidden />返回{origin?.label ?? '首页'}</Button>
    <header className="space-y-2"><h1 ref={heading} tabIndex={-1} className="text-2xl font-bold outline-none">全部功能</h1><p className="text-sm leading-6 text-[var(--text-2)]">按你现在想做的事选择。记录、安排和回看都可以单独使用。</p></header>
    <nav aria-label="全部功能" className="space-y-6">{navigationGroups.map(group => <section key={group} aria-label={group} className="space-y-3"><h2 className="text-sm font-bold text-[var(--text-2)]">{group}</h2><div className="grid gap-3 sm:grid-cols-2">{destinations.filter(item => item.group === group).map(item => { const Icon = item.icon; return <Link key={item.path} to={item.path} onClick={() => rememberPosition(owner, { top: window.scrollY, path: item.path })} className="flex min-h-20 scroll-mt-20 scroll-mb-28 items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] motion-reduce:transition-none">
      <Icon size={22} className="shrink-0 text-[var(--text-2)]" aria-hidden /><div className="min-w-0 flex-1"><p className="font-semibold">{item.label}{previous?.path === item.path && <span className="ml-2 text-xs font-normal text-[var(--text-3)]">上次打开</span>}</p><p className="mt-1 text-xs leading-5 text-[var(--text-2)]">{item.description}</p></div><ChevronRight size={17} className="shrink-0 text-[var(--text-3)]" aria-hidden />
    </Link>; })}</div></section>)}</nav>
  </div>;
}
