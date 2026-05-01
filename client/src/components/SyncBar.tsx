import { useSyncStore } from '../stores/syncStore';

function SyncBar() {
  const { syncStatus, syncProgress } = useSyncStore();

  if (syncStatus === 'idle') return null;

  if (syncStatus === 'error') {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-red-500 text-white text-center py-2 text-xs font-medium">
        <div className="flex items-center justify-center gap-2">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          同步失败，点击重试
        </div>
      </div>
    );
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 gradient-bg text-white text-center py-2 text-xs font-medium">
      <div className="flex items-center justify-center gap-2">
        <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        {syncProgress ? `同步中 ${syncProgress.synced}/${syncProgress.synced + syncProgress.pending + syncProgress.failed}` : '同步中...'}
      </div>
    </div>
  );
}

export default SyncBar;
