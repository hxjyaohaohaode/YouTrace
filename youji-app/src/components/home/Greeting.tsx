import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';

interface GreetingProps { greeting: string; date: string; name?: string; unreadCount?: number }
export function Greeting({ greeting, date, name, unreadCount = 0 }: GreetingProps) {
  return <header className="home-greeting">
    <div><p className="editorial-eyebrow">{date} · 今天</p><h1>{greeting || '你好'}{name ? `，${name}` : ''}</h1></div>
    <Link to="/insights" className="home-inbox" aria-label={`教练洞察${unreadCount > 0 ? `，${unreadCount}条未读` : ''}`}><Bell size={19} aria-hidden /><span>记录观察</span>{unreadCount > 0 && <span className="home-unread">{unreadCount > 99 ? '99+' : unreadCount}</span>}</Link>
  </header>;
}
