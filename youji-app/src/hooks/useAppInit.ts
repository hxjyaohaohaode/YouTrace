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
import { captureLocalActor, type LocalActor } from '../services/localActor';

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

type InitializationActor = Omit<LocalActor, 'epoch'>;
interface InitializationAttempt {
  enabled: boolean; actor: InitializationActor | null;
  database: typeof db; owner: string | null; generation: number;
}
interface InitializationResult { attempt: InitializationAttempt; ready: boolean; failed: boolean }

function observeActor(): InitializationActor | null {
  try { return captureLocalActor(); } catch { return null; }
}

function sameActor(left: InitializationActor | null, right: InitializationActor | null): boolean {
  return left === right || Boolean(left && right && left.database === right.database && left.owner === right.owner
    && left.session === right.session && left.sessionGeneration === right.sessionGeneration);
}

function observeAttempt(enabled: boolean): InitializationAttempt {
  return { enabled, database: db, owner: getVerifiedSessionOwner(), generation: getSessionGeneration(), actor: observeActor() };
}

function sameSession(left: InitializationAttempt, right: InitializationAttempt): boolean {
  return left.enabled === right.enabled && left.database === right.database && left.owner === right.owner && left.generation === right.generation;
}

function mayReportFailure(attempt: InitializationAttempt): boolean {
  const observed = observeAttempt(attempt.enabled);
  if (!sameSession(attempt, observed)) return false;
  if (sameActor(attempt.actor, observed.actor)) return true;
  // A failed capture may become readable before its rejection handler runs.
  // Notify React to start that newly valid attempt instead of losing its retry.
  if (!attempt.actor && observed.actor) return true;
  // An unreadable revision is not proof of a new session. Wake React so the
  // unavailable authority can render an error, while success stays locked.
  // Known owner/DB/generation changes and readable revocations stay obsolete.
  try {
    localStorage.getItem(SESSION_REVISION_KEY);
    localStorage.getItem(SIGNED_OUT_KEY);
    return false;
  } catch { return true; }
}

export function useAppInit(enabled: boolean) {
  const observed = observeAttempt(enabled);
  const [attempt, setAttempt] = useState<InitializationAttempt>(() => observed);
  const [result, setResult] = useState<InitializationResult | null>(null);
  // Reset the lifecycle before rendering children, including re-enabling the
  // same session. An old ready result cannot unlock this new attempt.
  if (!sameSession(attempt, observed) || !sameActor(attempt.actor, observed.actor)) setAttempt(observed);
  const currentResult = enabled && sameSession(attempt, observed) && sameActor(attempt.actor, observed.actor) && result?.attempt === attempt ? result : null;
  const ready = currentResult?.ready ?? false;
  const failed = currentResult?.failed ?? false;

  useEffect(() => {
    if (!attempt.enabled) return;
    let cancelled = false;
    const isCurrent = () => { const observed = observeAttempt(attempt.enabled); return !cancelled && sameSession(attempt, observed) && sameActor(attempt.actor, observed.actor); };
    const trace = traceAttempt('initial');
    const refresh = () => {
      if (!isCurrent()) return;
      const updateTrace = traceAttempt('data-updated');
      void loadAllStores(updateTrace).then(() => updateTrace.record('initialization', 'success'), error => updateTrace.record('initialization', 'error', error));
    };
    window.addEventListener('youtrace:data-updated', refresh);
    const timeout = setTimeout(() => {
      if (cancelled || !mayReportFailure(attempt)) return;
      trace.record('initialization', 'timeout');
      setResult(previous => ({ attempt, ready: previous?.attempt === attempt && previous.ready, failed: true }));
    }, INIT_TIMEOUT_MS);

    async function init() {
      // Observation above may fail closed, but the real error still reaches the
      // normal diagnostic and recovery path here.
      const initialActor = captureLocalActor();
      if (!initialActor.owner) throw new Error('账号尚未验证');
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
        if (isCurrent() && attempt.actor?.owner) {
          clearTimeout(timeout);
          setResult(previous => ({ attempt, ready: true, failed: previous?.attempt === attempt && previous.failed }));
        }
      })
      .catch((error: unknown) => {
        trace.record('initialization', 'error', error);
        recordDiagnostic('runtime-error', 'unknown');
        if (!cancelled && mayReportFailure(attempt)) {
          clearTimeout(timeout);
          setResult(previous => ({ attempt, ready: previous?.attempt === attempt && previous.ready, failed: true }));
        }
      });

    return () => {
      cancelled = true;
      trace.record('initialization', 'cancel');
      window.removeEventListener('youtrace:data-updated', refresh);
      clearTimeout(timeout);
    };
  }, [attempt]);

  useEffect(() => {
    if (!attempt.enabled || !failed) return;
    let cancelled = false;
    const isCurrent = () => { const observed = observeAttempt(attempt.enabled); return !cancelled && sameSession(attempt, observed) && sameActor(attempt.actor, observed.actor); };
    const trace = traceAttempt('recovery');
    async function recover() {
      const recoveryActor = captureLocalActor();
      if (!recoveryActor.owner) throw new Error('账号尚未验证');
      await loadAllStores(trace);
    }
    void recover()
      .then(() => {
        trace.record('initialization', 'success');
        if (isCurrent() && attempt.actor?.owner) setResult({ attempt, ready: true, failed: true });
      })
      .catch((error: unknown) => {
        trace.record('initialization', 'error', error);
        // A failed read never invalidates another complete load in this
        // lifecycle. The error remains visible when neither attempt succeeds.
        if (!cancelled && mayReportFailure(attempt)) {
          setResult(previous => ({ attempt, ready: previous?.attempt === attempt && previous.ready, failed: true }));
        }
      });
    return () => { cancelled = true; trace.record('initialization', 'cancel'); };
  }, [attempt, failed]);

  return { ready, failed };
}
