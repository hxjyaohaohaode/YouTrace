import '../styles/home-coach.css';
import { useState, useEffect, useRef } from 'react';
import { liveQuery } from 'dexie';
import { DiagnosticsPanel } from '../components/settings/DiagnosticsPanel';
import { TimeSettingInput } from '../components/settings/TimeSettingInput';
import { readPreferenceTime } from '../services/readPreferenceTime';
import { PreferenceSyncPanel } from '../components/settings/PreferenceSyncPanel';
import { SyncConflictPanel } from '../components/settings/SyncConflictPanel';
import { motion, useReducedMotion } from 'framer-motion';
import { Download, Trash2, Shield, Clock, Moon, Sun, Monitor, Sparkles, Bell, AlertTriangle, LogOut, Wallet, UserX, RefreshCw, Database } from 'lucide-react';
import { useSettingsStore, stopPreferenceSync, type CoachStyle, type ThemeMode, type AppSettings } from '../stores/settingsStore';
import { useExpenseStore } from '../stores/expenseStore';
import { useAuthStore, lockLocalSession } from '../stores/authStore';
import { exportAllData, clearAllData, exportLegacyData, hasLegacyDatabase, db, getAccountGenerationRecovery, exportAccountGenerationRecovery } from '../db';
import { api, isLoggedIn } from '../services/apiClient';

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
  const reduced = useReducedMotion();
  const toggleId = `toggle-${label}`;
  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={toggleId} className="min-w-0 cursor-pointer">
        <p className="text-base font-semibold text-[var(--text-1)]">{label}</p>
        <p className="mt-0.5 text-sm font-medium text-[var(--text-3)]">{sub}</p>
      </label>
      <button
        type="button"
        id={toggleId}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="relative h-11 w-[46px] shrink-0 rounded-lg"
      >
        <span aria-hidden className={`absolute inset-x-0 top-[9px] h-[26px] rounded-full border border-[var(--control-border)] transition-colors ${checked ? 'bg-[var(--primary)]' : 'bg-[var(--surface-2)]'}`} />
        <motion.div
          animate={{ x: checked ? 22 : 3 }}
          transition={{ duration: reduced ? 0 : 0.16, ease: 'easeOut' }}
          className="absolute top-[12px] h-[20px] w-[20px] rounded-full border border-[var(--control-border)] bg-white shadow-sm"
        />
      </button>
    </div>
  );
}

interface SyncStats {
  localBlock: boolean;
  pending: number;
  blocked: number;
  pendingPreferences: number;
  lastPush: string | null;
  localRecords: number;
}

function SyncPanel() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [error, setError] = useState('');
  useEffect(() => {
    const subscription = liveQuery(async () => {
      const [pendingRows, lastPushRecord, counts] = await Promise.all([
        db.outbox.toArray(), db.settings.get('lastPushAt'),
        Promise.all([db.expenses.count(), db.todos.count(), db.habits.count(), db.habitCheckins.count(), db.quickNotes.count(), db.diary.count(), db.schedules.count(), db.goalRecords.count()]),
      ]);
      return {
        localBlock: Boolean(await db.settings.get('syncV2LocalBlock')),
        pending: pendingRows.length,
        pendingPreferences: await db.settings.where('key').startsWith('pendingSetting:').count(),
        blocked: pendingRows.filter((row) => row.status === 'blocked').length,
        lastPush: typeof lastPushRecord?.value === 'string' ? lastPushRecord.value : null,
        localRecords: counts.reduce((sum, n) => sum + n, 0),
      };
    }).subscribe({ next: setStats, error: () => setError('暂时无法读取同步状态，请刷新重试') });
    return () => subscription.unsubscribe();
  }, []);

  const handleSyncNow = async () => {
    if (syncing || !isAuthenticated) return;
    setSyncing(true);
    setError('');
    try {
      const { retryBlockedSync, pullServerChanges } = await import('../services/syncEngine');
      await retryBlockedSync();
      await pullServerChanges();
      const { loadAllStores } = await import('../hooks/useAppInit');
      await loadAllStores();
      await useSettingsStore.getState().loadSettings();
      await useSettingsStore.getState().syncPreferences();
      const pending = await db.outbox.count();
      const pendingPreferences = await db.settings.where('key').startsWith('pendingSetting:').count();
      if (pending === 0 && pendingPreferences === 0) toast.success('支持同步的记录已核对');
      else if (pending === 0) toast.info(`记录已核对，${pendingPreferences} 项偏好正在等待确认`);
      else toast.warning(`还有 ${pending} 条修改待确认，原稿仍安全保存在本设备`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '同步暂未完成，修改已保留');
    } finally { setSyncing(false); }
  };

  if (!isAuthenticated) {
    return (
      <div className="rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-6">
        <p className="text-sm leading-relaxed text-[var(--text-3)]">
          未登录。数据仅保存在本设备；登录后自动开启多设备同步。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-6">
      {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
      {!stats && !error && <p role="status" className="text-sm text-[var(--text-3)]">正在读取本设备状态…</p>}
      {stats?.localBlock && <p role="alert" className="rounded-xl border border-[var(--warning)] p-3 text-sm leading-6">旧版未确认请求含有未核对字段，已在本机停止发送。原请求、编号与修改都保留；反复点击同步不会上传它们。请先导出完整备份，再核对兼容处理。不要清空资料或把此状态当成网络故障。</p>}
      {stats && (
        <>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <span className={`h-2 w-2 rounded-full ${stats.pending > 0 ? 'bg-[var(--warning)]' : 'bg-[var(--success)]'}`} aria-hidden />
              <div>
                <p className="text-base font-semibold text-[var(--text-1)]">
                  {stats.pending > 0 ? `${stats.pending} 条记录修改待确认${stats.blocked ? `，${stats.blocked} 条需要检查` : ''}` : '记录：暂无待确认修改'}
                </p>
                {stats.lastPush && (
                  <p className="mt-0.5 text-sm text-[var(--text-3)]">
                    上次记录推送 {new Date(stats.lastPush).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleSyncNow()}
              disabled={syncing}
              className="flex items-center gap-1.5 rounded-full bg-[var(--primary-soft)] px-4 py-2 text-sm font-semibold text-[var(--link)] transition-colors hover:bg-[var(--primary)]/12 disabled:opacity-50"
            >
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} aria-hidden />
              {syncing ? '同步中…' : '立即同步'}
            </button>
          </div>

          {stats.pendingPreferences > 0 && <p className="text-sm text-[var(--warning)]">{stats.pendingPreferences} 项偏好尚未获云端确认，本设备设置仍有效。立即同步可重试。</p>}
          <div className="flex items-center gap-2 border-t border-[var(--border-light)] pt-3">
            <Database size={13} className="shrink-0 text-[var(--text-4)]" aria-hidden />
            <p className="text-sm text-[var(--text-3)]">
              当前账号本设备共 {stats.localRecords} 条记录，包含打卡与目标。旧目标需要在目标页明确选择同步，请定期导出备份
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export default function Settings() {
  const settings = useSettingsStore();
  const budgetStatus = useExpenseStore((s) => s.budgetStatus);
  const monthBudgetFen = useExpenseStore((s) => s.monthBudget);
  const setMonthBudget = useExpenseStore((s) => s.setMonthBudget);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const logout = useAuthStore((s) => s.logout);

  const [hasLegacy, setHasLegacy] = useState(false);
  const [generationRecovery, setGenerationRecovery] = useState<Awaited<ReturnType<typeof getAccountGenerationRecovery>>>(null);
  const [generationError, setGenerationError] = useState(false);
  const refreshGenerationRecovery = () => {
    void getAccountGenerationRecovery().then((status) => { setGenerationRecovery(status); setGenerationError(false); }).catch(() => setGenerationError(true));
  };
  useEffect(() => {
    const refresh = () => { void getAccountGenerationRecovery().then((status) => { setGenerationRecovery(status); setGenerationError(false); }).catch(() => setGenerationError(true)); };
    refresh(); window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const [showLegacyConfirm, setShowLegacyConfirm] = useState(false);
  useEffect(() => { void hasLegacyDatabase().then(setHasLegacy); }, []);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [budgetDraft, setBudgetInput] = useState<string | null>(null);
  const budgetInput = budgetDraft ?? (budgetStatus === 'unset' ? '' : (monthBudgetFen / 100).toString());
  const [budgetSaving, setBudgetSaving] = useState(false);
  const budgetSaveGuard = useRef(false);
  const [budgetFeedback, setBudgetFeedback] = useState('');
  const [budgetError, setBudgetError] = useState(false);
  const [preferenceError, setPreferenceError] = useState('');
  const savePreference = <K extends keyof AppSettings,>(key: K, value: AppSettings[K]) => {
    setPreferenceError('');
    void settings.updateSetting(key, value).catch((cause: unknown) => setPreferenceError(cause instanceof Error ? cause.message : '偏好未保存，原设置保留，请重试'));
  };

  const handleExport = async (legacy: boolean | 'generation' = false) => {
    try {
      const data = legacy === 'generation' ? await exportAccountGenerationRecovery() : legacy ? await exportLegacyData() : await exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `youtrace-${legacy === 'generation' ? 'account-retained-source' : legacy ? 'legacy-unverified' : 'backup'}-${getToday()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setShowLegacyConfirm(false);
      toast.success('备份已生成，包含本地记录、草稿和未确认的修改；请妥善保存');
    } catch {
      toast.error('导出失败，请重试');
    }
  };

  const handleBudgetSave = async () => {
    if (budgetSaveGuard.current) return;
    const yuan = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(budgetInput) ? Number(budgetInput) : NaN;
    if (!Number.isFinite(yuan) || yuan < 0 || yuan > 10_000_000) {
      setBudgetError(true); setBudgetFeedback('请输入 0 到 10000000 之间的预算金额，最多两位小数');
      return;
    }
    budgetSaveGuard.current = true; setBudgetSaving(true);
    setBudgetError(false); setBudgetFeedback('正在保存预算…');
    try {
      const fen = Math.round(yuan * 100);
      await setMonthBudget(fen);
      setBudgetFeedback(`已保存 ¥${(fen / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 预算`);
    } catch {
      setBudgetError(true); setBudgetFeedback('预算未保存，输入已保留，请重试');
    } finally { budgetSaveGuard.current = false; setBudgetSaving(false); }
  };


  const handleClear = async () => {
    try {
      const { pauseSync } = await import('../services/syncEngine');
      pauseSync();
      stopPreferenceSync();
      await clearAllData();
      window.location.reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '清除失败，请重试');
      const { resumeSync } = await import('../services/syncEngine');
      resumeSync();
      await useSettingsStore.getState().loadSettings().catch(() => undefined);
      setShowClearConfirm(false);
    }
  };

  const handleLogout = () => { void logout(); };

  const handleDeleteAccount = async () => {
    if (deletingAccount) return;
    setDeletingAccount(true);
    let cloudDeleted = false;
    try {
      await api.delete('/user', 15_000);
      cloudDeleted = true;
      lockLocalSession();
      const { pauseSync } = await import('../services/syncEngine');
      pauseSync();
      await clearAllData({ allowPending: true });
      toast.success('账号与所有云端数据已删除');
      window.location.assign('/login');
    } catch {
      if (cloudDeleted) window.location.assign('/login?cleanup=needed');
      else toast.error('删除失败，请检查网络后重试');
    } finally {
      setDeletingAccount(false);
      setShowDeleteAccountConfirm(false);
    }
  };

  return (
    <div className="settings-page w-full">
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto max-w-2xl"
      >
        <h1 className="mb-2 text-[28px] font-semibold tracking-tight text-[var(--text-1)]">设置</h1><p className="mb-8 text-sm leading-6 text-[var(--text-2)]">调整记录的节奏，管理账号和数据。每一项都由你决定。</p>

        <div className="space-y-8">
          <PreferenceSyncPanel />
          {preferenceError && <p role="alert" className="text-sm text-[var(--danger)]">{preferenceError}</p>}
          <section className="space-y-3" aria-label="教练风格">
            <h2 className="flex items-center gap-2 settings-section-title">
              <Sparkles size={14} className="text-[var(--link)]" aria-hidden />
              教练风格
            </h2>
            <div className="space-y-2" role="radiogroup" aria-label="教练风格">
              {coachStyleOptions.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => savePreference('coachStyle', opt.key)}
                  aria-checked={settings.coachStyle === opt.key}
                  role="radio"
                  className={`flex w-full items-center gap-3.5 rounded-[var(--radius-lg)] border p-4 text-left transition-all duration-200 ${
                    settings.coachStyle === opt.key
                      ? 'border-[var(--primary)]/20 bg-[var(--primary-soft)] shadow-[var(--shadow-xs)]'
                      : 'border-[var(--border-light)] bg-[var(--surface)] hover:border-[var(--border)] hover:shadow-[var(--shadow-xs)]'
                  }`}
                >
                  <span className="text-2xl" aria-hidden>{opt.emoji}</span>
                  <div>
                    <p className={`text-base font-bold ${settings.coachStyle === opt.key ? 'text-[var(--link)]' : 'text-[var(--text-1)]'}`}>{opt.label}</p>
                    <p className="mt-0.5 text-sm font-medium text-[var(--text-3)]">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3" aria-label="预算">
            <h2 className="flex items-center gap-2 settings-section-title">
              <Wallet size={14} className="text-[var(--link)]" aria-hidden />
              月度预算
            </h2>
            <div className="rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-6">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <p className="mb-2 text-sm leading-6 text-[var(--text-2)]">{budgetStatus === 'unset' ? '还没有设置预算。留空不代表零预算，按需设置即可。' : budgetStatus === 'unknown' ? '这里保留了旧版本的预算值，无法判断是默认值还是你设置的。请核对后保存，不会自动清空。' : '已由你确认的每月预算'}</p>
                  <label htmlFor="budget-input" className="mb-1 block text-sm font-medium text-[var(--text-3)]">每月总预算（元）</label>
                  <input
                    id="budget-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={budgetInput}
                    onChange={(e) => { setBudgetInput(e.target.value); setBudgetFeedback(''); setBudgetError(false); }}
                    aria-describedby="budget-feedback"
                    aria-invalid={budgetError}
                    disabled={budgetSaving}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleBudgetSave(); }}
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-1)] outline-none focus:border-[var(--primary)]"
                  />
                </div>
                <Button size="sm" variant="ghost" disabled={budgetSaving} aria-busy={budgetSaving} onClick={() => void handleBudgetSave()}>{budgetSaving ? '保存中…' : '保存'}</Button>
              </div>
              <p className="mt-2 text-sm text-[var(--text-3)]">{budgetStatus === 'unset' ? '预算只保存在本设备，尚未设置' : `预算保存在本设备；当前 ¥${(monthBudgetFen / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false })}`}</p>
              <p id="budget-feedback" role={budgetError ? 'alert' : 'status'} aria-live={budgetError ? 'assertive' : 'polite'} className={`mt-1 min-h-5 text-sm ${budgetError ? 'text-[var(--danger)]' : 'text-[var(--text-2)]'}`}>{budgetFeedback}</p>
            </div>
          </section>

          <section className="space-y-3" aria-label="推送设置">
            <h2 className="flex items-center gap-2 settings-section-title">
              <Bell size={14} className="text-[var(--link)]" aria-hidden />
              推送设置
            </h2>
            <div className="space-y-4 rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-6">
              <ToggleRow
                label="教练推送"
                sub="打开应用时显示洞察与提醒，不是系统后台推送"
                checked={settings.coachPushEnabled}
                onChange={(next) => savePreference('coachPushEnabled', next)}
              />
              <ToggleRow
                label="晚间复盘"
                sub="打开应用时，在设定时段提示回顾"
                checked={settings.eveningReviewEnabled}
                onChange={(next) => savePreference('eveningReviewEnabled', next)}
              />

              <TimeSettingInput id="evening-review-time" label="晚间复盘时间" value={settings.eveningReviewTime} onSave={(value, expected) => settings.updateSetting('eveningReviewTime', value, expected)} onVerify={() => readPreferenceTime('eveningReviewTime')} />
              {!settings.eveningReviewEnabled && <p className="text-sm text-[var(--text-3)]">复盘已关闭，仍可调整保留的时间</p>}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-light)] pt-2">
                <div>
                  <p className="text-base font-semibold text-[var(--text-1)]">推送频率</p>
                  <p className="mt-0.5 text-sm font-medium text-[var(--text-3)]">每设备每天最多条数（0 为暂停）</p>
                </div>
                <div className="flex items-center gap-2" role="radiogroup" aria-label="每日推送上限">
                  {[0, 1, 2, 3].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => savePreference('coachPushFrequency', n)}
                      aria-checked={settings.coachPushFrequency === n}
                      role="radio"
                      aria-label={`每天最多${n}条`}
                      className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold transition-all duration-200 ${
                        settings.coachPushFrequency === n
                          ? 'bg-[var(--primary)] text-[var(--on-primary)]'
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
            <h2 className="flex items-center gap-2 settings-section-title">
              <Clock size={14} className="text-[var(--link)]" aria-hidden />
              免打扰
            </h2>
            <div className="space-y-4 rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-6">
              <ToggleRow
                label="免打扰时段"
                sub="此期间不推送教练消息"
                checked={settings.quietHours.enabled}
                onChange={(next) => { setPreferenceError(''); void settings.updateQuietHours({ enabled: next }).catch((cause: unknown) => setPreferenceError(cause instanceof Error ? cause.message : '设置未保存，请重试')); }}
              />
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="flex items-center gap-3">
                  <TimeSettingInput id="quiet-start" label="免打扰开始" value={settings.quietHours.start} onSave={(value, expected) => settings.updateQuietHours({ start: value }, { start: expected })} onVerify={() => readPreferenceTime('quietStart')} />
                  <TimeSettingInput id="quiet-end" label="免打扰结束" value={settings.quietHours.end} onSave={(value, expected) => settings.updateQuietHours({ end: value }, { end: expected })} onVerify={() => readPreferenceTime('quietEnd')} />
              </motion.div>
              {!settings.quietHours.enabled && <p className="text-sm text-[var(--text-3)]">免打扰已关闭，时段与未保存输入仍保留</p>}
            </div>
          </section>

          <section className="space-y-3" aria-label="外观">
            <h2 className="flex items-center gap-2 settings-section-title">
              <Moon size={14} className="text-[var(--link)]" aria-hidden />
              外观
            </h2>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="主题">
              {themeOptions.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => savePreference('theme', opt.key)}
                    role="radio"
                    aria-checked={settings.theme === opt.key}
                    className={`flex flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border py-4 text-base font-semibold transition-all duration-200 ${
                      settings.theme === opt.key
                        ? 'border-[var(--primary)]/20 bg-[var(--primary-soft)] text-[var(--link)] shadow-[var(--shadow-xs)]'
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
            <h2 className="flex items-center gap-2 settings-section-title">
              <RefreshCw size={14} className="text-[var(--link)]" aria-hidden />
              数据同步
            </h2>
            <SyncPanel />
            <SyncConflictPanel />
            <DiagnosticsPanel />
          </section>

          <section className="space-y-3" aria-label="账号">
            <h2 className="flex items-center gap-2 settings-section-title">
              <Shield size={14} className="text-[var(--link)]" aria-hidden />
              账号
            </h2>
            <div className="space-y-4 rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-6">
              {isAuthenticated ? (
                <>
                  <Button variant="ghost" size="sm" icon={LogOut} onClick={handleLogout}>退出登录</Button>
                  <div className="border-t border-[var(--border-light)] pt-4">
                    <Button variant="ghost" size="sm" icon={UserX} className="text-[var(--danger)]" onClick={() => setShowDeleteAccountConfirm(true)}>
                      注销账号（删除全部云端数据）
                    </Button>
                    <p className="mt-2 text-sm leading-relaxed text-[var(--text-3)]">
                      将永久删除服务器上该手机号的全部记录：花销、待办、习惯、速记、日记、日程、目标、账号偏好、教练对话与当前本地缓存。升级前隔离保留的原始资料不会在此删除；请先导出并关闭旧版窗口。
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-sm leading-relaxed text-[var(--text-3)]">当前未登录。登录后可跨设备同步数据并使用 AI 教练。</p>
              )}
            </div>
          </section>

          <section className="space-y-3" aria-label="数据透明">
            <h2 className="flex items-center gap-2 settings-section-title">
              <Shield size={14} className="text-[var(--link)]" aria-hidden />
              数据透明
            </h2>
            <div className="space-y-4 rounded-[var(--radius-xl)] border border-[var(--border-light)] bg-[var(--surface)] p-6">
              <div>
                <p className="text-base font-bold text-[var(--text-1)]">你的数据属于你</p>
                <p className="mt-1 text-sm leading-relaxed text-[var(--text-2)]">
                  当前账号的数据独立保存在本设备。支持同步的记录会上传至服务端；新目标和提醒偏好支持账号同步；旧目标需逐项确认上传，草稿、外观和预算仍留本机。备份包含未确认修改，文件可能含私人内容，请存放在你信任的位置。
                </p>
              </div>
              {generationError && <div role="alert" className="rounded-xl border border-[var(--warning)]/30 p-3"><p className="text-sm">升级前资料状态暂时无法读取，原始资料没有删除</p><Button variant="ghost" size="sm" onClick={refreshGenerationRecovery}>重新检查保留资料</Button></div>}
              {generationRecovery?.sourcePresent && <div className="rounded-xl border border-[var(--warning)]/30 p-3">
                <p className="text-sm font-semibold">升级前账号资料已隔离保留</p>
                <p className="mt-1 text-sm text-[var(--text-2)]">请关闭旧版窗口，避免继续在那里编辑。旧窗口后续修改不会自动导入本窗口；可单独导出升级时原始资料与旧窗口当前资料，核对后再恢复。此备份不会上传。</p>
                {generationRecovery.changedTables.length > 0 && <p role="status" className="mt-2 text-sm text-[var(--warning)]">发现 {generationRecovery.changedTables.length} 类旧版资料与升级时不同，可能包含尚未转入的修改</p>}
                {generationRecovery.cleared && <p className="mt-2 text-sm text-[var(--text-2)]">当前本地数据已清除，保留资料不会重新自动导入</p>}
                <div className="mt-2 flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={() => void handleExport('generation')}>导出升级前保留资料</Button><Button variant="ghost" size="sm" onClick={refreshGenerationRecovery}>检查旧窗口修改</Button></div>
              </div>}
              {hasLegacy && <div className="rounded-xl border border-[var(--warning)]/30 p-3"><p className="text-sm font-semibold">旧版资料已隔离保留</p><p className="mt-1 text-sm text-[var(--text-2)]">为避免串账号，没有自动导入。可先导出完整原始备份；不会触碰原数据库。</p><Button variant="ghost" size="sm" onClick={() => setShowLegacyConfirm(true)}>查看导出说明</Button></div>}
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

        <Modal open={showLegacyConfirm} onClose={() => setShowLegacyConfirm(false)} title="导出旧版本地资料" footer={<><Button variant="ghost" onClick={() => setShowLegacyConfirm(false)}>取消</Button><Button onClick={() => void handleExport(true)}>导出原始备份</Button></>}>
          <p className="text-sm text-[var(--text-2)]">旧版本使用共享数据库，资料可能来自多个账号，归属尚未确认。导出会保留原始字段与旧版草稿，不会删除原库，也不会上传或自动归入当前账号。请仅在你有权访问这台设备资料时继续，并妥善保管备份。</p>
        </Modal>
        <Modal open={showClearConfirm} onClose={() => setShowClearConfirm(false)} title="确认清除所有本地数据" footer={<><Button variant="ghost" size="sm" onClick={() => setShowClearConfirm(false)}>取消</Button><Button variant="danger" size="sm" onClick={() => void handleClear()}>确认清除</Button></>}>
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-[var(--danger)]" aria-hidden />
            <div>
              <p className="text-sm text-[var(--text-1)]">此操作只清除当前账号在本设备的记录、目标、草稿、打卡和设置，不影响其他账号和升级前隔离保留的原始资料；保留资料不会自动重新导入。未同步修改存在时将阻止清除，请先同步或导出。</p>
              {isLoggedIn() && (
                <p className="mt-2 text-sm text-[var(--text-2)]">注意：服务端已有同步数据不会删除，重新联网后会恢复到本设备。</p>
              )}
              <p className="mt-2 text-sm font-bold text-[var(--danger)]">此操作不可撤销！</p>
            </div>
          </div>
        </Modal>

        <Modal open={showDeleteAccountConfirm} onClose={() => setShowDeleteAccountConfirm(false)} title="确认注销账号" footer={<><Button variant="ghost" size="sm" onClick={() => setShowDeleteAccountConfirm(false)}>取消</Button><Button variant="danger" size="sm" onClick={() => void handleDeleteAccount()} disabled={deletingAccount}>{deletingAccount ? '删除中…' : '永久注销'}</Button></>}>
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-[var(--danger)]" aria-hidden />
            <div>
              <p className="text-sm text-[var(--text-1)]">此操作将永久删除你在服务端的全部数据与当前本地缓存，且无法恢复。升级前隔离保留的原始资料不会在此删除；请先导出备份，并关闭旧版窗口。</p>
              <p className="mt-2 text-sm font-bold text-[var(--danger)]">请谨慎操作！</p>
            </div>
          </div>
        </Modal>
      </motion.div>
    </div>
  );
}
