import { Link, useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { destinations, directoryEntry, staticPageEntry } from '../../lib/navigation';
import { useAuthStore } from '../../stores/authStore';

// Complement the fixed navigation rather than repeat all its primary actions.
const shortcuts = ['/todo', '/habit', '/diary', '/goal'].map(path => destinations.find(item => item.path === path)!);
export function QuickActions() {
  const ownerId = useAuthStore(state => state.user?.id), location = useLocation();
  return <nav aria-label="安排与记录快捷入口" className="home-shortcuts">
    {shortcuts.map(item => { const Icon = item.icon; return <Link key={item.path} to={item.path} state={staticPageEntry(item.path, ownerId)}><Icon size={16} aria-hidden /><span>{item.label}</span></Link>; })}
    <Link to="/more" state={directoryEntry(location.pathname + location.search, ownerId)}>全部功能<ArrowRight size={16} aria-hidden /></Link>
  </nav>;
}
