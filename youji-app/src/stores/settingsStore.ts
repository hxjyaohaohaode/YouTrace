import { create } from 'zustand';
import { liveQuery } from 'dexie';
import { db, getSetting, generateLocalId, LOCAL_DATA_EPOCH_KEY } from '../db';
import { api, isLoggedIn } from '../services/apiClient';

export type CoachStyle = 'gentle' | 'strict' | 'data';
export type ThemeMode = 'light' | 'dark' | 'system';
export interface QuietHours { enabled: boolean; start: string; end: string }
export interface AppSettings { coachStyle: CoachStyle; coachPushEnabled: boolean; coachPushFrequency: number; quietHours: QuietHours; eveningReviewEnabled: boolean; eveningReviewTime: string; theme: ThemeMode }
type AccountSettings = Omit<AppSettings, 'theme'>;
type Changes = Partial<AccountSettings>;
const defaultAccount: AccountSettings = { coachStyle: 'gentle', coachPushEnabled: false, coachPushFrequency: 2, quietHours: { enabled: true, start: '23:00', end: '07:00' }, eveningReviewEnabled: false, eveningReviewTime: '21:00' };
const defaultSettings: AppSettings = { ...defaultAccount, theme: 'system' };
const ACCOUNT_KEYS = Object.keys(defaultAccount) as (keyof AccountSettings)[];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const PREFERENCE_STATE_KEY = 'accountPreferences:state:v1';
const PENDING_KEY = 'pendingSetting:accountPreferences';
interface Snapshot { protocol: 1; revision: string; settings: AccountSettings }
interface Queued { changes: Changes; baseRevision: string | null; base: AccountSettings; parentId?: string; needsReview?: boolean }
interface Mutation extends Queued { id: string; baseRevision: string; status: 'pending' | 'conflict' | 'blocked'; attempts: number; error?: string }
interface DurablePreferences {
  version: 1;
  epoch: string;
  localRevision: number;
  server: Snapshot | null;
  initial: AccountSettings;
  active: Mutation | null;
  queued: Queued | null;
  readError?: string;
  readFailures?: number;
}
export interface PreferenceSyncStatus {
  state: 'local' | 'loading' | 'synced' | 'pending' | 'conflict' | 'blocked';
  pending: number;
  error?: string;
  conflict?: { id: string; local: AccountSettings; remote: AccountSettings };
}
interface SettingsState extends AppSettings {
  loaded: boolean;
  preferenceSync: PreferenceSyncStatus;
  loadSettings: () => Promise<void>;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  resetSettings: () => Promise<void>;
  syncPreferences: () => Promise<void>;
  resolvePreferenceConflict: (choice: 'local' | 'server', conflictId: string) => Promise<void>;
}
let sending: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let observing = false;
let subscription: { unsubscribe(): void } | null = null;
let resumeListener: (() => void) | null = null;
let runtimeGeneration = 0;
let rerunRequested = false;
let lastPublished = -1;
let verifiedEpoch: string | null = null;
let publishedEpoch: string | null = null;
const retiredEpochs = new Set<string>();

function cloneAccount(value: AccountSettings): AccountSettings { return { ...value, quietHours: { ...value.quietHours } }; }
function desired(state: DurablePreferences): AccountSettings { return { ...state.initial, ...state.server?.settings, ...state.active?.changes, ...state.queued?.changes }; }
function validAccount(value: unknown): value is AccountSettings {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const quiet = row.quietHours as Partial<QuietHours> | undefined;
  return ['gentle', 'strict', 'data'].includes(String(row.coachStyle)) && typeof row.coachPushEnabled === 'boolean'
    && Number.isInteger(row.coachPushFrequency) && Number(row.coachPushFrequency) >= 0 && Number(row.coachPushFrequency) <= 10
    && typeof quiet?.enabled === 'boolean' && typeof quiet.start === 'string' && TIME_PATTERN.test(quiet.start) && typeof quiet.end === 'string' && TIME_PATTERN.test(quiet.end)
    && typeof row.eveningReviewEnabled === 'boolean' && typeof row.eveningReviewTime === 'string' && TIME_PATTERN.test(row.eveningReviewTime);
}
function wireChanges(changes: Changes): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (changes.coachStyle !== undefined) result.coachStyle = changes.coachStyle;
  if (changes.coachPushEnabled !== undefined) result.coachPushEnabled = changes.coachPushEnabled;
  if (changes.coachPushFrequency !== undefined) result.pushLimit = changes.coachPushFrequency;
  if (changes.quietHours) { result.quietEnabled = changes.quietHours.enabled; result.quietStart = changes.quietHours.start; result.quietEnd = changes.quietHours.end; }
  if (changes.eveningReviewEnabled !== undefined) result.eveningReviewEnabled = changes.eveningReviewEnabled;
  if (changes.eveningReviewTime !== undefined) result.eveningReviewTime = changes.eveningReviewTime;
  return result;
}
function parseSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== 'object') throw new Error('偏好响应不完整，修改已保留');
  const data = value as { protocol?: unknown; revision?: unknown; settings?: Record<string, unknown> };
  const row = data.settings;
  if (data.protocol !== 1 || typeof data.revision !== 'string' || !/^(0|[1-9]\d{0,9})$/.test(data.revision) || BigInt(data.revision) > 2147483647n || !row) throw new Error('偏好协议不兼容，修改已保留');
  const settings = { coachStyle: row.coachStyle, coachPushEnabled: row.coachPushEnabled, coachPushFrequency: row.pushLimit, quietHours: { enabled: row.quietEnabled, start: row.quietStart, end: row.quietEnd }, eveningReviewEnabled: row.eveningReviewEnabled, eveningReviewTime: row.eveningReviewTime };
  if (!validAccount(settings)) throw new Error('偏好响应不完整，修改已保留');
  return { protocol: 1, revision: data.revision, settings };
}
function statusOf(state: DurablePreferences): PreferenceSyncStatus {
  if (!db.ownerId) return { state: 'local', pending: 0 };
  const pending = Number(Boolean(state.active)) + Number(Boolean(state.queued));
  if (state.active?.status === 'conflict' || state.queued?.needsReview) {
    return { state: 'conflict', pending, error: state.active?.error ?? '旧版本设备偏好已保留，请与账号偏好核对后选择', ...(state.server ? { conflict: { id: `${state.active?.id ?? 'migration'}:${state.localRevision}`, local: desired(state), remote: state.server.settings } } : {}) };
  }
  if (state.active?.status === 'blocked') return { state: 'blocked', pending, error: state.active.error };
  if (state.readError) return { state: 'blocked', pending, error: state.readError };
  return { state: pending ? 'pending' : state.server ? 'synced' : 'loading', pending };
}
function effective(state: DurablePreferences): AccountSettings {
  const result = desired(state);
  // Unreviewed legacy policy and conflicting reminder settings must never enable reminders.
  if ((db.ownerId && verifiedEpoch !== state.epoch) || state.queued?.needsReview || state.active?.status === 'conflict') return { ...result, coachPushEnabled: false };
  return result;
}
function applyTheme(theme: ThemeMode) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : theme);
}
async function readState(): Promise<DurablePreferences> {
  const found = (await db.settings.get(PREFERENCE_STATE_KEY))?.value as DurablePreferences | undefined;
  if (found) return { ...found, epoch: found.epoch ?? await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial') };
  const initial = cloneAccount(defaultAccount);
  const legacy: Changes = {};
  for (const key of ACCOUNT_KEYS) {
    const row = await db.settings.get(key);
    if (row && validAccount({ ...initial, [key]: row.value })) {
      Object.assign(initial, { [key]: row.value });
      Object.assign(legacy, { [key]: row.value });
    }
  }
  // Existing local-only switches cannot be attributed to a cloud revision. Preserve
  // them as an explicit proposal; never silently enable or discard them on upgrade.
  return { version: 1, epoch: await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial'), localRevision: 0, server: null, initial, active: null, queued: db.ownerId && Object.keys(legacy).length ? { changes: legacy, baseRevision: null, base: cloneAccount(initial), needsReview: true } : null };
}
async function saveState(state: DurablePreferences) {
  state.localRevision += 1;
  await db.settings.put({ key: PREFERENCE_STATE_KEY, value: state });
  const values = desired(state);
  for (const key of ACCOUNT_KEYS) await db.settings.put({ key, value: values[key] });
  if (state.active || state.queued) await db.settings.put({ key: PENDING_KEY, value: { count: statusOf(state).pending } });
  else await db.settings.delete(PENDING_KEY);
}
async function transaction(change: (state: DurablePreferences) => Promise<void> | void, epoch?: string, generation?: number) {
  return db.transaction('rw', db.settings, async () => {
    if (generation !== undefined && generation !== runtimeGeneration) return;
    if (epoch !== undefined && await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial') !== epoch) return;
    const state = await readState();
    const existed = await db.settings.get(PREFERENCE_STATE_KEY);
    const before = JSON.stringify(state);
    await change(state);
    if (generation !== undefined && generation !== runtimeGeneration) return;
    if (!existed || before !== JSON.stringify(state)) await saveState(state);
    if (generation !== undefined && generation !== runtimeGeneration) throw new Error('偏好同步已暂停，未确认原稿已保留');
  });
}
function publish(state: DurablePreferences, theme: ThemeMode) {
  if (retiredEpochs.has(state.epoch)) return;
  if (state.epoch !== publishedEpoch) {
    if (publishedEpoch !== null) retiredEpochs.add(publishedEpoch);
    publishedEpoch = state.epoch; lastPublished = -1;
  }
  if (state.localRevision < lastPublished) return;
  lastPublished = state.localRevision;
  useSettingsStore.setState({ ...effective(state), theme, loaded: true, preferenceSync: statusOf(state) });
  applyTheme(theme);
}
async function refreshView() {
  const state = await readState();
  const theme = await getSetting<ThemeMode>('theme', 'system');
  publish(state, ['light', 'dark', 'system'].includes(theme) ? theme : 'system');
}
function observe() {
  if (observing) return;
  observing = true;
  subscription = liveQuery(async () => ({ state: await readState(), theme: await getSetting<ThemeMode>('theme', 'system') })).subscribe({
    next: ({ state, theme }) => publish(state, ['light', 'dark', 'system'].includes(theme) ? theme : 'system'),
    error: () => useSettingsStore.setState({ preferenceSync: { state: 'blocked', pending: 0, error: '无法读取本机偏好，请刷新；原有数据未删除' } }),
  });
  if (typeof window !== 'undefined') {
    resumeListener = () => { if (isLoggedIn()) schedule(0); };
    window.addEventListener('online', resumeListener);
    window.addEventListener('focus', resumeListener);
  }
}
function schedule(delay: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void synchronize(); }, delay);
}
function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function canRebase(base: AccountSettings, remote: AccountSettings, changes: Changes) {
  return (Object.keys(changes) as (keyof AccountSettings)[]).every((key) => same(base[key], remote[key]) || same(changes[key], remote[key]));
}
function acceptSnapshot(state: DurablePreferences, snapshot: Snapshot) {
  if (!state.server || BigInt(snapshot.revision) > BigInt(state.server.revision)) state.server = snapshot;
  else if (snapshot.revision === state.server.revision && !same(snapshot.settings, state.server.settings)) throw new Error('同版本偏好内容不一致，已暂停覆盖');
}
function makeActive(queued: Queued, revision: string): Mutation { return { ...queued, id: generateLocalId(), baseRevision: revision, status: 'pending', attempts: 0 }; }
function reportSyncFailure(error: unknown) {
  const current = useSettingsStore.getState().preferenceSync;
  useSettingsStore.setState({ preferenceSync: { ...current, state: current.state === 'conflict' ? 'conflict' : 'blocked', error: error instanceof Error ? error.message : '偏好同步尚未完成，原稿已保留' } });
}
async function stillCurrent(epoch: string, generation: number) {
  if (generation !== runtimeGeneration || !isLoggedIn()) return false;
  try { return await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial') === epoch; }
  catch (error) {
    if (generation === runtimeGeneration && isLoggedIn()) reportSyncFailure(error);
    return false;
  }
}
async function performSync(generation: number) {
  if (!db.ownerId || !isLoggedIn() || generation !== runtimeGeneration) return;
  const epoch = await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial');
  let remoteError: unknown;
  const observedReadRevision = (await readState()).server?.revision ?? null;
  try {
    const snapshot = parseSnapshot(await api.get('/user/settings'));
    if (!await stillCurrent(epoch, generation)) return;
    await transaction((state) => { acceptSnapshot(state, snapshot); delete state.readError; state.readFailures = 0; }, epoch, generation);
    if (await stillCurrent(epoch, generation)) verifiedEpoch = epoch;
  } catch (error) {
    if (!await stillCurrent(epoch, generation)) return;
    remoteError = error;
    let failures = 1;
    let staleFailure = false;
    await transaction((state) => {
      if (state.server && (observedReadRevision === null || BigInt(state.server.revision) > BigInt(observedReadRevision))) { staleFailure = true; return; }
      state.readError = error instanceof Error ? error.message : '云端偏好暂不可用'; state.readFailures = (state.readFailures ?? 0) + 1; failures = state.readFailures;
    }, epoch, generation);
    if (staleFailure) { remoteError = undefined; verifiedEpoch = epoch; }
    const failure = error as { status?: number; code?: string };
    if (generation === runtimeGeneration && !staleFailure && isLoggedIn() && ![400, 403, 409, 426].includes(failure.status ?? 0) && failure.code !== 'SETTINGS_SCHEMA_UNAVAILABLE') schedule(Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
  }
  for (let round = 0; round < 20 && isLoggedIn(); round += 1) {
    if (!await stillCurrent(epoch, generation)) return;
    let active: Mutation | null = null;
    await transaction((state) => {
      if (!state.active && state.queued && state.server) {
        const queued = state.queued;
        state.active = makeActive(queued, queued.baseRevision ?? state.server.revision);
        state.queued = null;
        if (queued.needsReview || !canRebase(queued.base, state.server.settings, queued.changes)) {
          state.active.status = 'conflict'; state.active.error = queued.needsReview ? '旧版本设备偏好已保留，请核对后选择' : '其他设备修改了相同偏好，请核对后选择';
        } else {
          state.active.baseRevision = state.server.revision;
          state.active.base = cloneAccount(state.server.settings);
        }
      }
      if (state.active?.status === 'pending') active = structuredClone(state.active);
    }, epoch, generation);
    await refreshView();
    const mutation = active as Mutation | null;
    if (!mutation) {
      if (remoteError) throw remoteError;
      return;
    }
    // Verify again after asynchronous hydration: another tab may have cleared
    // or resolved this draft since it was extracted. The network request cannot
    // be atomic with a local clear; already-sent requests may still commit.
    const current = await db.transaction('r', db.settings, async () => {
      if (!await stillCurrent(epoch, generation)) return false;
      const state = await readState();
      return state.active?.id === mutation.id && state.active.status === 'pending';
    });
    if (!current || !isLoggedIn()) return;
    // Once frozen, retries always carry exactly this ID, revision and body.
    try {
      const response = await api.patch<unknown>('/user/settings', { protocol: 1, mutationId: mutation.id, baseRevision: mutation.baseRevision, changes: wireChanges(mutation.changes) });
      const snapshot = parseSnapshot(response);
      const ack = response as { mutationId?: unknown; acknowledged?: unknown };
      if (ack.mutationId !== mutation.id || ack.acknowledged !== true) throw new Error('偏好保存未获明确确认，原稿已保留');
      remoteError = undefined;
      if (!await stillCurrent(epoch, generation)) return;
      verifiedEpoch = epoch;
      await transaction((state) => {
        acceptSnapshot(state, snapshot);
        delete state.readError; state.readFailures = 0;
        if (state.active?.id !== mutation.id) return;
        state.active = null;
        if (state.queued?.parentId === mutation.id) {
          // Advance the parent's fields from its exact receipt. A queued-only
          // field may already have been observed at a newer remote revision.
          const newerObservation = state.queued.baseRevision !== null && BigInt(state.queued.baseRevision) > BigInt(snapshot.revision);
          for (const key of Object.keys(state.queued.changes) as (keyof AccountSettings)[]) {
            if (key in mutation.changes || !newerObservation) Object.assign(state.queued.base, { [key]: snapshot.settings[key] });
          }
          if (!newerObservation) state.queued.baseRevision = snapshot.revision;
          delete state.queued.parentId;
        }
      }, epoch, generation);
    } catch (error) {
      if (!await stillCurrent(epoch, generation)) return;
      const failure = error as { code?: string; status?: number; conflict?: unknown; message?: string };
      let conflict: Snapshot | null = null;
      if (failure.code === 'SETTINGS_VERSION_CONFLICT') conflict = parseSnapshot(failure.conflict);
      let retryDelay: number | null = null;
      await transaction((state) => {
        if (state.active?.id !== mutation.id) return;
        if (conflict) {
          acceptSnapshot(state, conflict);
          const changes = { ...mutation.changes, ...state.queued?.changes };
          const base = cloneAccount(mutation.base);
          for (const key of Object.keys(state.queued?.changes ?? {}) as (keyof AccountSettings)[]) if (!(key in mutation.changes) && state.queued) Object.assign(base, { [key]: state.queued.base[key] });
          if (canRebase(base, conflict.settings, changes)) {
            // A rejected request made no write. Rebase only untouched fields and
            // assign a new ID; the old frozen request is never changed in place.
            state.queued = { changes, baseRevision: conflict.revision, base: cloneAccount(conflict.settings) };
            state.active = null;
          } else { state.active.status = 'conflict'; state.active.error = failure.message; }
        } else {
          state.active.attempts += 1;
          state.active.error = failure.message ?? '云端暂未确认，本设备修改已保留';
          const permanent = failure.status === 400 || failure.status === 403 || failure.status === 409 || failure.status === 426 || failure.code === 'SETTINGS_SCHEMA_UNAVAILABLE';
          if (permanent) state.active.status = 'blocked';
          else if (isLoggedIn()) retryDelay = Math.min(30_000, 1000 * 2 ** Math.min(state.active.attempts, 5));
        }
      }, epoch, generation);
      await refreshView();
      if (retryDelay !== null && generation === runtimeGeneration) schedule(retryDelay);
      if (!conflict) return;
      remoteError = undefined;
      if ((await readState()).active?.status === 'conflict') return;
    }
  }
  if (await stillCurrent(epoch, generation)) schedule(300);
}
export async function readPersistedReminderSettings(): Promise<AccountSettings> {
  const row = await db.settings.get(PREFERENCE_STATE_KEY);
  return row ? effective(row.value as DurablePreferences) : db.ownerId ? cloneAccount(defaultAccount) : useSettingsStore.getState();
}

/** Stop before session teardown or closing the account DB. Frozen drafts survive. */
export function stopPreferenceSync(): void {
  runtimeGeneration += 1;
  if (timer) clearTimeout(timer);
  timer = null; rerunRequested = false; sending = null;
  subscription?.unsubscribe(); subscription = null; observing = false;
  if (typeof window !== 'undefined' && resumeListener) {
    window.removeEventListener('online', resumeListener);
    window.removeEventListener('focus', resumeListener);
  }
  resumeListener = null; verifiedEpoch = null;
}
function synchronize(): Promise<void> {
  if (!db.ownerId || !isLoggedIn()) return Promise.resolve();
  if (sending) { rerunRequested = true; return sending; }
  const generation = runtimeGeneration;
  const work = (async () => {
    let epoch: string;
    try { epoch = await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial'); }
    catch (error) { if (generation === runtimeGeneration && isLoggedIn()) reportSyncFailure(error); return; }
    do {
      rerunRequested = false;
      try { await performSync(generation); }
      catch (error) {
        if (!await stillCurrent(epoch, generation)) return;
        reportSyncFailure(error);
      }
      // A save/online callback arriving in the terminal empty pass still gets
      // its own turn. Blocked/conflicting work never requests its own rerun.
    } while (rerunRequested && await stillCurrent(epoch, generation));
  })().finally(() => { if (sending === work) sending = null; });
  sending = work;
  return work;
}

export const useSettingsStore = create<SettingsState>(() => ({
  ...defaultSettings, loaded: false, preferenceSync: { state: 'loading', pending: 0 },
  loadSettings: async () => {
    await transaction(async (state) => {
      // Legacy pending records are preserved in the review proposal/recovery data.
      for (const key of ACCOUNT_KEYS) {
        const legacyKey = `pendingSetting:${key}`;
        const pending = await db.settings.get(legacyKey);
        if (pending) { await db.settings.put({ key: `preferenceRecovery:legacy:${key}`, value: pending.value }); await db.settings.delete(legacyKey); }
      }
      if (!db.ownerId) state.queued = null;
    });
    observe();
    await refreshView();
    void synchronize();
  },
  updateSetting: async (key, value) => {
    if (key === 'theme') {
      if (!['light', 'dark', 'system'].includes(String(value))) throw new Error('外观设置无效');
      await db.settings.put({ key, value });
    } else {
      await transaction((state) => {
        const before = desired(state);
        if (!validAccount({ ...before, [key]: value })) throw new Error('偏好格式不正确，原设置未改变');
        if (!db.ownerId) { Object.assign(state.initial, { [key]: value }); return; }
        if (!state.queued) state.queued = { changes: {}, baseRevision: state.server?.revision ?? null, base: cloneAccount(before), ...(state.active ? { parentId: state.active.id } : {}) };
        Object.assign(state.queued.changes, { [key]: value });
      });
    }
    await refreshView();
    if (key !== 'theme' && db.ownerId) schedule(key === 'coachStyle' ? 0 : 300);
  },
  resetSettings: async () => {
    for (const key of Object.keys(defaultSettings) as (keyof AppSettings)[]) await useSettingsStore.getState().updateSetting(key, defaultSettings[key]);
  },
  syncPreferences: async () => {
    if (timer) clearTimeout(timer);
    timer = null;
    await transaction((state) => { if (state.active?.status === 'blocked') state.active.status = 'pending'; });
    await synchronize();
  },
  resolvePreferenceConflict: async (choice, conflictId) => {
    await transaction(async (state) => {
      const conflict = statusOf(state).conflict;
      if (!conflict || conflict.id !== conflictId || !state.server) throw new Error('偏好已变化，请重新核对后选择');
      await db.settings.put({ key: `preferenceRecovery:${generateLocalId()}`, value: { savedAt: Date.now(), state: structuredClone(state), choice } });
      const changes = { ...state.active?.changes, ...state.queued?.changes };
      state.active = null;
      state.queued = choice === 'local' ? { changes, baseRevision: state.server.revision, base: cloneAccount(state.server.settings) } : null;
    });
    await refreshView();
    if (choice === 'local') await synchronize();
  },
}));
if (typeof window !== 'undefined') window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
  if (useSettingsStore.getState().theme === 'system') document.documentElement.setAttribute('data-theme', event.matches ? 'dark' : 'light');
});
