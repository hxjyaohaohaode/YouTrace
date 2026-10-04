import { Link, useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { destinations, directoryEntry } from '../../lib/navigation';
import { useAuthStore } from '../../stores/authStore';

// Complement the fixed navigation rather than repeat all its primary actions.
const shortcuts = ['/todo', '/habit', '/diary', '/goal'].map(path => destinations.find(item => item.path === path)!);
export function QuickActions() {
  const ownerId = useAuthStore(state => state.user?.id), location = useLocation();
  return <nav aria-label="安排与记录快捷入口" className="space-y-3">
    <div className="grid grid-cols-2 gap-3">{shortcuts.map(item => { const Icon = item.icon; return <Link key={item.path} to={item.path} aria-label={item.label} className="flex min-h-16 items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] motion-reduce:transition-none"><Icon size={20} className="shrink-0 text-[var(--text-2)]" aria-hidden /><span>{item.label}</span></Link>; })}</div>
    <Link to="/more" state={directoryEntry(location.pathname + location.search, ownerId)} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-semibold text-[var(--text-2)] underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]">查看全部功能<ArrowRight size={16} aria-hidden /></Link>
  </nav>;
}
