import { Bell } from 'lucide-react';
import { useScrambleText } from '../../hooks/useScrambleText';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

interface GreetingProps {
  greeting: string;
  date: string;
  name?: string;
  unreadCount?: number;
}

export function Greeting({ greeting, date, name = '你', unreadCount = 0 }: GreetingProps) {
  const navigate = useNavigate();
  const displayName = useScrambleText(name, true);
  const displayGreeting = useScrambleText(greeting, true, 600);

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-[var(--text-1)] sm:text-3xl">
          {displayGreeting}，{displayName}
        </h1>
        <p className="mt-1.5 text-sm font-medium text-[var(--text-3)]">{date}</p>
      </div>
      <motion.button
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        onClick={() => navigate('/insights')}
        className="relative flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--text-3)] backdrop-blur-sm transition-all hover:bg-[var(--primary-soft)] hover:text-[var(--primary)]"
        aria-label={`教练洞察${unreadCount > 0 ? `，${unreadCount}条未读` : ''}`}
      >
        <motion.div
          animate={unreadCount > 0 ? { scale: [1, 1.15, 1] } : { scale: 1 }}
          transition={unreadCount > 0 ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' } : {}}
        >
          <Bell size={18} aria-hidden />
        </motion.div>
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 min-w-[16px] rounded-full bg-[var(--danger)] px-1 text-center text-[10px] font-bold leading-4 text-white ring-2 ring-[var(--surface)]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </motion.button>
    </motion.div>
  );
}
