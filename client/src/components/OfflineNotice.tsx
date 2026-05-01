import { useSyncStore } from '../stores/syncStore';

function OfflineNotice() {
  const { isOnline } = useSyncStore();

  return (
    <>
      {!isOnline && (
        <div className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-4 sm:w-72 z-30">
          <div className="bg-amber-500 text-white rounded-2xl px-4 py-3 shadow-lg flex items-center gap-2.5">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829" />
            </svg>
            <div>
              <p className="text-sm font-semibold">离线模式</p>
              <p className="text-xs opacity-80">数据将在恢复网络后同步</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default OfflineNotice;
