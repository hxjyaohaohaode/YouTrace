import { useEffect, useState } from 'react';
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

const INIT_TIMEOUT_MS = 12_000;

export function loadAllStores(): Promise<void> {
  return Promise.all([
    useExpenseStore.getState().loadFromDB(),
    useTodoStore.getState().loadFromDB(),
    useHabitStore.getState().loadFromDB(),
    useQuickNoteStore.getState().loadFromDB(),
    useScheduleStore.getState().loadFromDB(),
    useDiaryStore.getState().loadFromDB(),
    useCoachStore.getState().loadFromDB(),
    useGoalStore.getState().loadFromDB(),
  ]).then(() => undefined);
}

export function useAppInit(enabled: boolean) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const refresh = () => { void loadAllStores().catch(() => undefined); };
    window.addEventListener('youtrace:data-updated', refresh);
    const timeout = setTimeout(() => {
      if (!cancelled) setFailed(true);
    }, INIT_TIMEOUT_MS);

    async function init() {
      await useSettingsStore.getState().loadSettings();
      const { offline } = await bootstrapSync();
      if (offline) {
        await loadAllStores();
        return;
      }

      await Promise.all([
        useExpenseStore.getState().loadFromDB(),
        useTodoStore.getState().loadFromDB(),
        useHabitStore.getState().loadFromDB(),
        useQuickNoteStore.getState().loadFromDB(),
        useScheduleStore.getState().loadFromDB(),
        useDiaryStore.getState().loadFromDB(),
        useGoalStore.getState().loadFromDB(),
      ]);
      void useCoachStore.getState().loadFromDB();
    }

    init()
      .then(() => {
        if (!cancelled) {
          clearTimeout(timeout);
          setReady(true);
        }
      })
      .catch((error) => {
        console.error('App init failed', error);
        if (!cancelled) {
          clearTimeout(timeout);
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
      window.removeEventListener('youtrace:data-updated', refresh);
      clearTimeout(timeout);
    };
  }, [enabled]);

  useEffect(() => {
    if (!failed) return;
    loadAllStores()
      .then(() => setReady(true))
      .catch(() => setReady(false));
  }, [failed]);

  return { ready, failed };
}
