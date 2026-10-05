import { useEffect, useState } from 'react';
import Dexie from 'dexie';
import { useSettingsStore } from '../stores/settingsStore';
import { useExpenseStore } from '../stores/expenseStore';
import { useTodoStore } from '../stores/todoStore';
import { useHabitStore } from '../stores/habitStore';
import { useQuickNoteStore } from '../stores/quickNoteStore';
import { useScheduleStore } from '../stores/scheduleStore';
import { useDiaryStore } from '../stores/diaryStore';
import { useCoachStore } from '../stores/coachStore';
import { bootstrapSync } from '../services/syncEngine';
import { useGoalStore } from '../stores/goalStore';
import { recordDiagnostic } from '../services/diagnostics';
import { beginInitializationTrace, type InitializationTrace } from '../services/initializationDiagnostics';
import { db, getDatabaseRecoveryError, isDatabaseUpgradeBlocked } from '../db';
import { getSessionGeneration, getVerifiedSessionOwner, SESSION_REVISION_KEY, SIGNED_OUT_KEY } from '../services/apiClient';
import { useAuthStore } from '../stores/authStore';

const INIT_TIMEOUT_MS = 12_000;

function traceAttempt(phase: Parameters<typeof beginInitializationTrace>[0]) {
  const generation = getSessionGeneration();
  let revision: string | null | undefined;
  try { revision = localStorage.getItem(SESSION_REVISION_KEY); } catch { /* Observation only. */ }
  return beginInitializationTrace(phase, () => {
    const auth = useAuthStore.getState(), owner = getVerifiedSessionOwner(), transaction = Dexie.currentTransaction;
    return {
      authChecked: auth.authChecked, isAuthenticated: auth.isAuthenticated, identityUnavailable: auth.identityUnavailable,
      signedOut: localStorage.getItem(SIGNED_OUT_KEY) === 'true', boundOwner: db.ownerId !== null,
      verifiedOwner: owner !== null, ownersMatch: db.ownerId === owner,
      generationChanged: generation !== getSessionGeneration(), revisionChanged: revision !== localStorage.getItem(SESSION_REVISION_KEY),
      dbOpen: db.isOpen(), dbBlocked: isDatabaseUpgradeBlocked(), recoveryErrorPresent: Boolean(getDatabaseRecoveryError()),
      ambientTransactionPresent: Boolean(transaction), ...(transaction ? { ambientTransactionActive: transaction.active, transactionMode: transaction.mode } : {}),
    };
  });
}

export function loadAllStores(trace?: InitializationTrace): Promise<void> {
  const run = trace?.run ?? ((_stage: string, operation: () => Promise<void>) => operation());
  return run('stores', () => Promise.all([
    run('expense', () => useExpenseStore.getState().loadFromDB()),
    run('todo', () => useTodoStore.getState().loadFromDB()),
    run('habit', () => useHabitStore.getState().loadFromDB()),
    run('quick-note', () => useQuickNoteStore.getState().loadFromDB()),
    run('schedule', () => useScheduleStore.getState().loadFromDB()),
    run('diary', () => useDiaryStore.getState().loadFromDB()),
    run('coach', () => useCoachStore.getState().loadFromDB()),
    run('goal', () => useGoalStore.getState().loadFromDB()),
  ]).then(() => undefined));
}

export function useAppInit(enabled: boolean) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const trace = traceAttempt('initial');
    const refresh = () => {
      const updateTrace = traceAttempt('data-updated');
      void loadAllStores(updateTrace).then(() => updateTrace.record('initialization', 'success'), error => updateTrace.record('initialization', 'error', error));
    };
    window.addEventListener('youtrace:data-updated', refresh);
    const timeout = setTimeout(() => {
      if (!cancelled) { trace.record('initialization', 'timeout'); setFailed(true); }
    }, INIT_TIMEOUT_MS);

    async function init() {
      await trace.run('settings', () => useSettingsStore.getState().loadSettings());
      const { offline } = await trace.run('sync', () => bootstrapSync());
      if (offline) {
        trace.record('sync-offline', 'success');
        await loadAllStores(trace);
        return;
      }

      await trace.run('stores', () => Promise.all([
        trace.run('expense', () => useExpenseStore.getState().loadFromDB()),
        trace.run('todo', () => useTodoStore.getState().loadFromDB()),
        trace.run('habit', () => useHabitStore.getState().loadFromDB()),
        trace.run('quick-note', () => useQuickNoteStore.getState().loadFromDB()),
        trace.run('schedule', () => useScheduleStore.getState().loadFromDB()),
        trace.run('diary', () => useDiaryStore.getState().loadFromDB()),
        trace.run('goal', () => useGoalStore.getState().loadFromDB()),
      ]));
      void trace.run('coach', () => useCoachStore.getState().loadFromDB(), true);
    }

    init()
      .then(() => {
        trace.record('initialization', 'success');
        if (!cancelled) {
          clearTimeout(timeout);
          setReady(true);
        }
      })
      .catch((error: unknown) => {
        trace.record('initialization', 'error', error);
        recordDiagnostic('runtime-error', 'unknown');
        if (!cancelled) {
          clearTimeout(timeout);
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
      trace.record('initialization', 'cancel');
      window.removeEventListener('youtrace:data-updated', refresh);
      clearTimeout(timeout);
    };
  }, [enabled]);

  useEffect(() => {
    if (!failed) return;
    const trace = traceAttempt('recovery');
    loadAllStores(trace)
      .then(() => { trace.record('initialization', 'success'); setReady(true); })
      .catch((error: unknown) => { trace.record('initialization', 'error', error); setReady(false); });
  }, [failed]);

  return { ready, failed };
}
