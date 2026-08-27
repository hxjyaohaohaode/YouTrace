import { useState } from 'react';
import { motion } from 'framer-motion';
import { Download, Trash2, Shield, Clock, Moon, Sun, Monitor, Sparkles, Bell, AlertTriangle, LogOut, Wallet, UserX, RefreshCw, Database } from 'lucide-react';
import { useSettingsStore, type CoachStyle, type ThemeMode } from '../stores/settingsStore';
import { useExpenseStore } from '../stores/expenseStore';
import { useAuthStore } from '../stores/authStore';
import { exportAllData, clearAllData, db } from '../db';
import { api, isLoggedIn, clearSession } from '../services/apiClient';
import { resetSyncCursor } from '../services/syncEngine';
import { toast } from '../services/toastBus';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { getToday } from '../utils/date';

const coachStyleOptions: Array<{ key: CoachStyle; label: string; desc: string; emoji: string }> = [
  { key: 'gentle', label: '温柔型', desc: '温和提醒，不催不逼', emoji: '😊' },
  { key: 'strict', label: '严格型', desc: '直接了当，该说就说', emoji: '💪' },
  { key: 'data', label: '数据型', desc: '用数据说话，理性分析', emoji: '📊' },
];

const themeOptions: Array<{ key: ThemeMode; label: string; icon: typeof Sun }> = [
  { key: 'light', label: '浅色', icon: Sun },
  { key: 'dark', label: '深色', icon: Moon },
  { key: 'system', label: '跟随系统', icon: Monitor },
];

interface ToggleRowProps {
  label: string;
  sub: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

function ToggleRow({ label, sub, checked, onChange }: ToggleRowProps) {
  const toggleId = `toggle-${label}`;
  return (
    <div className="flex items-center justify-between">
      <label htmlFor={toggleId} className="cursor-pointer">
        <p className="text-[13px] font-semibold text-[var(--text-1)]">{label}</p>
        <p className="mt-0.5 text-xs font-medium text-[var(--text-3)]">{sub}</p>
      </label>
      <button
        type="button"
        id={toggleId}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)]' : 'bg-[var(--surface-2)]'}`}
      >
        <motion.div
          animate={{ x: checked ? 22 : 3 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="absolute top-[3px] h-[20px] w-[20px] rounded-full bg-white shadow-sm"
        />
      </button>
    </div>
  );
}

interface SyncStats {
  pending: number;
  lastPush: string | null;
  localRecords: number;
}

function SyncPanel() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    try {
      const [pending, lastPushRecord, counts] = await Promise.all([
        db.outbox.count(),
        db.settings.get('lastPushAt'),
        Promise.all([
          db.expenses.count(),
          db.todos.count(),
          db.habits.count(),
          db.quickNotes.count(),
          db.diary.count(),
          db.schedules.count(),
        ]),
      ]);
      setStats({
        pending,
        lastPush:
          typeof lastPushRecord?.value === 'string' ? (lastPushRecord.value as string) : null,
        localRecords: counts.reduce((sum, n) => sum + n, 0),
      });
    } catch {
      // ignore
    }
  };

  void load();

  const handleSyncNow = async () => {
    if (syncing || !isAuthenticated) return;
    setSyncing(true);
    const { flush, pullServerChanges } = await import('../services/syncEngine');
    await pullServerChanges().catch(() => undefined);
    const ok = await flush();
    await load();
    setSyncing(false);
    if (ok) toast.success('同步完成');
    else toast.warning('当前离线，稍后自动重试');
  };

  if (!isAuthenticated) {
    return (
      <div className="rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
        <p className="text-xs leading-relaxed text-[var(--text-3)]">
          未登录。数据仅保存在本设备；登录后自动开启多设备同步。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
      {stats && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className={`h-2 w-2 rounded-full ${stats.pending > 0 ? 'bg-[var(--warning)]' : 'bg-[var(--success)]'}`} aria-hidden />
              <div>
                <p className="text-[13px] font-semibold text-[var(--text-1)]">
                  {stats.pending > 0 ? `${stats.pending} 条待同步` : '全部已同步'}
                </p>
                {stats.lastPush && (
                  <p className="mt-0.5 text-xs text-[var(--text-3)]">
                    上次推送 {new Date(stats.lastPush).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleSyncNow()}
              disabled={syncing}
              className="flex items-center gap-1.5 rounded-full bg-[var(--primary-soft)] px-4 py-2 text-xs font-semibold text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/12 disabled:opacity-50"
            >
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} aria-hidden />
              {syncing ? '同步中…' : '立即同步'}
            </button>
          </div>

          <div className="flex items-center gap-2 border-t border-[var(--border-light)] pt-3">
            <Database size={13} className="shrink-0 text-[var(--text-4)]" aria-hidden />
            <p className="text-xs text-[var(--text-3)]">
              本设备共 {stats.localRecords} 条记录（花销/待办/习惯/速记/日记/日程）
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export default function Settings() {
  const settings = useSettingsStore();
  const monthBudgetFen = useExpenseStore((s) => s.monthBudget);
  const setMonthBudget = useExpenseStore((s) => s.setMonthBudget);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const logout = useAuthStore((s) => s.logout);

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [budgetInput, setBudgetInput] = useState<string>((monthBudgetFen / 100).toString());

  const handleExport = async () => {
    try {
      const data = await exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `youji-backup-${getToday()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success('数据已导出');
    } catch {
      toast.error('导出失败，请重试');
    }
  };

  const handleBudgetSave = async () => {
    const yuan = parseFloat(budgetInput);
    if (!Number.isFinite(yuan) || yuan < 0 || yuan > 10_000_000) {
      toast.error('预算格式不正确');
      return;
    }
    await setMonthBudget(Math.round(yuan * 100));
    toast.success('预算已更新');
  };

  const handleQuietTimeChange = (part: 'start' | 'end', value: string) => {
    void settings.updateSetting('quietHours', { ...settings.quietHours, [part]: value });
  };

  const handleClear = async () => {
    try {
      await clearAllData();
      window.location.reload();
    } catch {
      toast.error('清除失败，请重试');
      setShowClearConfirm(false);
    }
  };

  const handleLogout = () => {
    logout();
    void resetSyncCursor().then(() => window.location.assign('/'));
  };

  const handleDeleteAccount = async () => {
    if (deletingAccount) return;
    setDeletingAccount(true);
    try {
      await api.delete('/user', 15_000);
      await clearAllData();
      clearSession();
      toast.success('账号与所有云端数据已删除');
      window.location.assign('/login');
    } catch {
      toast.error('删除失败，请检查网络后重试');
    } finally {
      setDeletingAccount(false);
      setShowDeleteAccountConfirm(false);
    }
  };

  return (
    <div className="w-full">
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto max-w-2xl"
      >
        <h1 className="mb-6 text-xl font-bold tracking-tight text-[var(--text-1)]">设置</h1>

        <div className="space-y-8">
          <section className="space-y-3" aria-label="教练风格">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--text-3)]">
              <Sparkles size={14} className="text-[var(--primary)]" aria-hidden />
              教练风格
            </h2>
            <div className="space-y-2" role="radiogroup" aria-label="教练风格">
              {coachStyleOptions.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => void settings.updateSetting('coachStyle', opt.key)}
                  aria-checked={settings.coachStyle === opt.key}
                  role="radio"
                  className={`flex w-full items-center gap-3.5 rounded-[var(--radius-lg)] border p-4 text-left transition-all duration-200 ${
                    settings.coachStyle === opt.key
                      ? 'border-[var(--primary)]/20 bg-gradient-to-r from-[var(--primary-soft)] to-[var(--primary-muted)] shadow-[var(--shadow-xs)]'
                      : 'border-[var(--border-light)] bg-[var(--surface)] hover:border-[var(--border)] hover:shadow-[var(--shadow-xs)]'
                  }`}
                >
                  <span className="text-2xl" aria-hidden>{opt.emoji}</span>
                  <div>
                    <p className={`text-[13px] font-bold ${settings.coachStyle === opt.key ? 'text-[var(--primary)]' : 'text-[var(--text-1)]'}`}>{opt.label}</p>
                    <p className="mt-0.5 text-xs font-medium text-[var(--text-3)]">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3" aria-label="预算">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--text-3)]">
              <Wallet size={14} className="text-[var(--primary)]" aria-hidden />
              月度预算
            </h2>
            <div className="rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label htmlFor="budget-input" className="mb-1 block text-xs font-medium text-[var(--text-3)]">每月总预算（元）</label>
                  <input
                    id="budget-input"
                    type="number"
                    min="0"
                    step="1"
                    value={budgetInput}
                    onChange={(e) => setBudgetInput(e.target.value)}
                    onBlur={() => void handleBudgetSave()}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleBudgetSave(); }}
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-1)] outline-none focus:border-[var(--primary)]"
                  />
                </div>
                <Button size="sm" variant="ghost" onClick={() => void handleBudgetSave()}>保存</Button>
              </div>
              <p className="mt-2 text-xs text-[var(--text-3)]">预算保存在本设备；当前 ¥{(monthBudgetFen / 100).toFixed(0)}</p>
            </div>
          </section>

          <section className="space-y-3" aria-label="推送设置">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--text-3)]">
              <Bell size={14} className="text-[var(--primary)]" aria-hidden />
              推送设置
            </h2>
            <div className="space-y-4 rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
              <ToggleRow
                label="教练推送"
                sub="洞察提醒、正向鼓励等"
                checked={settings.coachPushEnabled}
                onChange={(next) => void settings.updateSetting('coachPushEnabled', next)}
              />
              <ToggleRow
                label="晚间复盘"
                sub="每晚回顾一天"
                checked={settings.eveningReviewEnabled}
                onChange={(next) => void settings.updateSetting('eveningReviewEnabled', next)}
              />

              <div className="flex items-center justify-between border-t border-[var(--border-light)] pt-2">
                <div>
                  <p className="text-[13px] font-semibold text-[var(--text-1)]">推送频率</p>
                  <p className="mt-0.5 text-xs font-medium text-[var(--text-3)]">每天最多推送次数</p>
                </div>
                <div className="flex items-center gap-2" role="radiogroup" aria-label="每日推送上限">
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => void settings.updateSetting('coachPushFrequency', n)}
                      aria-checked={settings.coachPushFrequency === n}
                      role="radio"
                      aria-label={`每天最多${n}条`}
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition-all duration-200 ${
                        settings.coachPushFrequency === n
                          ? 'bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] text-white shadow-[var(--shadow-glow)]'
                          : 'bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--border)]'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3" aria-label="免打扰">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--text-3)]">
              <Clock size={14} className="text-[var(--primary)]" aria-hidden />
              免打扰
            </h2>
            <div className="space-y-4 rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
              <ToggleRow
                label="免打扰时段"
                sub="此期间不推送教练消息"
                checked={settings.quietHours.enabled}
                onChange={(next) => void settings.updateSetting('quietHours', { ...settings.quietHours, enabled: next })}
              />
              {settings.quietHours.enabled && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="flex items-center gap-3">
                  <div className="flex-1">
                    <label htmlFor="quiet-start" className="mb-1 block text-xs font-medium text-[var(--text-3)]">开始</label>
                    <input id="quiet-start" type="time" value={settings.quietHours.start} onChange={(e) => handleQuietTimeChange('start', e.target.value)} className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-1)]" />
                  </div>
                  <span className="mt-5 text-[var(--text-3)]" aria-hidden>—</span>
                  <div className="flex-1">
                    <label htmlFor="quiet-end" className="mb-1 block text-xs font-medium text-[var(--text-3)]">结束</label>
                    <input id="quiet-end" type="time" value={settings.quietHours.end} onChange={(e) => handleQuietTimeChange('end', e.target.value)} className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-1)]" />
                  </div>
                </motion.div>
              )}
            </div>
          </section>

          <section className="space-y-3" aria-label="外观">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--text-3)]">
              <Moon size={14} className="text-[var(--primary)]" aria-hidden />
              外观
            </h2>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="主题">
              {themeOptions.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => void settings.updateSetting('theme', opt.key)}
                    role="radio"
                    aria-checked={settings.theme === opt.key}
                    className={`flex flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border py-4 text-[13px] font-semibold transition-all duration-200 ${
                      settings.theme === opt.key
                        ? 'border-[var(--primary)]/20 bg-gradient-to-r from-[var(--primary-soft)] to-[var(--primary-muted)] text-[var(--primary)] shadow-[var(--shadow-xs)]'
                        : 'border-[var(--border-light)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--border)]'
                    }`}
                  >
                    <Icon size={20} aria-hidden />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-3" aria-label="同步状态">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--text-3)]">
              <RefreshCw size={14} className="text-[var(--primary)]" aria-hidden />
              数据同步
            </h2>
            <SyncPanel />
          </section>

          <section className="space-y-3" aria-label="账号">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--text-3)]">
              <Shield size={14} className="text-[var(--primary)]" aria-hidden />
              账号
            </h2>
            <div className="space-y-4 rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
              {isAuthenticated ? (
                <>
                  <Button variant="ghost" size="sm" icon={LogOut} onClick={handleLogout}>退出登录</Button>
                  <div className="border-t border-[var(--border-light)] pt-4">
                    <Button variant="ghost" size="sm" icon={UserX} className="text-[var(--danger)]" onClick={() => setShowDeleteAccountConfirm(true)}>
                      注销账号（删除全部云端数据）
                    </Button>
                    <p className="mt-2 text-xs leading-relaxed text-[var(--text-3)]">
                      将永久删除服务器上该手机号的全部记录：花销、待办、习惯、速记、日记、日程、教练对话与本设备本地缓存。
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-xs leading-relaxed text-[var(--text-3)]">当前未登录。登录后可跨设备同步数据并使用 AI 教练。</p>
              )}
            </div>
          </section>

          <section className="space-y-3" aria-label="数据透明">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--text-3)]">
              <Shield size={14} className="text-[var(--primary)]" aria-hidden />
              数据透明
            </h2>
            <div className="space-y-4 rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
              <div>
                <p className="text-[13px] font-bold text-[var(--text-1)]">你的数据属于你</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--text-2)]">
                  数据默认存储在本设备。登录后，你的记录会同步到服务端以支持多设备使用和 AI 教练分析。你随时可以导出或清除本地数据。
                </p>
              </div>
              <div className="flex gap-2 border-t border-[var(--border-light)] pt-4">
                <Button variant="ghost" size="sm" icon={Download} onClick={() => void handleExport()} className="flex-1">
                  导出数据
                </Button>
                <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setShowClearConfirm(true)} className="flex-1 text-[var(--danger)]">
                  清除本地数据
                </Button>
              </div>
            </div>
          </section>
        </div>

        <Modal open={showClearConfirm} onClose={() => setShowClearConfirm(false)} title="确认清除所有本地数据" footer={<><Button variant="ghost" size="sm" onClick={() => setShowClearConfirm(false)}>取消</Button><Button variant="danger" size="sm" onClick={() => void handleClear()}>确认清除</Button></>}>
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-[var(--danger)]" aria-hidden />
            <div>
              <p className="text-sm text-[var(--text-1)]">此操作将删除本设备的全部数据：花销、习惯、速记、日记、日程和设置。</p>
              {isLoggedIn() && (
                <p className="mt-2 text-xs text-[var(--text-2)]">注意：服务端已有同步数据不会删除，重新联网后会恢复到本设备。</p>
              )}
              <p className="mt-2 text-xs font-bold text-[var(--danger)]">此操作不可撤销！</p>
            </div>
          </div>
        </Modal>

        <Modal open={showDeleteAccountConfirm} onClose={() => setShowDeleteAccountConfirm(false)} title="确认注销账号" footer={<><Button variant="ghost" size="sm" onClick={() => setShowDeleteAccountConfirm(false)}>取消</Button><Button variant="danger" size="sm" onClick={() => void handleDeleteAccount()} disabled={deletingAccount}>{deletingAccount ? '删除中…' : '永久注销'}</Button></>}>
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-[var(--danger)]" aria-hidden />
            <div>
              <p className="text-sm text-[var(--text-1)]">此操作将永久删除你在服务端的全部数据，且无法恢复。</p>
              <p className="mt-2 text-xs font-bold text-[var(--danger)]">请谨慎操作！</p>
            </div>
          </div>
        </Modal>
      </motion.div>
    </div>
  );
}
