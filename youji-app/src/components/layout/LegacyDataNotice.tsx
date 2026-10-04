import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { hasLegacyDatabase } from '../../db';

export function LegacyDataNotice() {
  const [available, setAvailable] = useState(false);
  useEffect(() => { let active = true; void hasLegacyDatabase().then((exists) => { if (active) setAvailable(exists); }); return () => { active = false; }; }, []);
  if (!available) return null;
  return <aside className="mb-5 rounded-xl border border-[var(--warning)]/30 bg-[var(--surface)] p-3 text-sm" aria-label="旧版资料保全">
    这台设备有旧版资料，已原样隔离保留，尚未归入任何账号。<Link className="ml-2 font-semibold text-[var(--primary)] underline" to="/settings">查看与导出</Link>
  </aside>;
}
