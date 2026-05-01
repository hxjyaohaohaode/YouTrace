import { create } from 'zustand';
import { processSyncQueue, pullRemoteData } from '../services/syncQueue';
import { getSyncQueueCount } from '../services/indexedDB';

type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline';

interface SyncState {
  isOnline: boolean;
  syncStatus: SyncStatus;
  pendingCount: number;
  lastSyncAt: string | null;
  syncProgress: { synced: number; failed: number; pending: number } | null;

  initNetworkListener: () => () => void;
  syncNow: (userId?: string) => Promise<void>;
  refreshPendingCount: () => Promise<void>;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  syncStatus: 'idle',
  pendingCount: 0,
  lastSyncAt: null,
  syncProgress: null,

  initNetworkListener: () => {
    const handleOnline = () => {
      set({ isOnline: true, syncStatus: 'idle' });
      get().syncNow();
    };

    const handleOffline = () => {
      set({ isOnline: false, syncStatus: 'offline' });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    get().refreshPendingCount();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  },

  syncNow: async (userId?: string) => {
    const { isOnline, syncStatus } = get();
    if (!isOnline || syncStatus === 'syncing') return;

    set({ syncStatus: 'syncing' });

    try {
      if (userId) {
        await pullRemoteData(userId);
      }

      const result = await processSyncQueue();
      const pendingCount = await getSyncQueueCount();

      set({
        syncStatus: pendingCount === 0 ? 'synced' : 'idle',
        lastSyncAt: new Date().toISOString(),
        syncProgress: result,
        pendingCount,
      });
    } catch (error) {
      console.error('Sync failed:', error);
      set({ syncStatus: 'error' });
    }
  },

  refreshPendingCount: async () => {
    try {
      const pendingCount = await getSyncQueueCount();
      set({ pendingCount });
    } catch {
      // IndexedDB may not be available
    }
  },
}));
