import { useState, useEffect, useRef } from 'react';
import { useSyncStore } from '../stores/syncStore';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'youji_pwa_install_dismissed';
const DISMISS_DURATION = 7 * 24 * 60 * 60 * 1000;

function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandaloneMode(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
    document.referrer.includes('android-app://');
}

function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const isOnline = useSyncStore((s) => s.isOnline);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandaloneMode()) return;

    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    if (dismissedAt && Date.now() - parseInt(dismissedAt, 10) < DISMISS_DURATION) return;

    const handler = (e: Event) => {
      e.preventDefault();
      const prompt = e as BeforeInstallPromptEvent;
      setDeferredPrompt(prompt);
      deferredPromptRef.current = prompt;
      setTimeout(() => setShowPrompt(true), 3000);
    };

    window.addEventListener('beforeinstallprompt', handler);

    if (isIOS() && !deferredPromptRef.current) {
      const timer = setTimeout(() => setShowPrompt(true), 5000);
      return () => {
        window.removeEventListener('beforeinstallprompt', handler);
        clearTimeout(timer);
      };
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = async () => {
    if (isIOS() && !deferredPrompt) {
      setShowIOSGuide(true);
      return;
    }

    if (!deferredPrompt) return;

    setIsInstalling(true);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowPrompt(false);
      }
    } catch {
      // prompt may fail if called multiple times
    } finally {
      setDeferredPrompt(null);
      setIsInstalling(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    setShowIOSGuide(false);
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  };

  if (!showPrompt || !isOnline) return null;

  if (showIOSGuide) {
    return (
      <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" onClick={handleDismiss}>
        <div className="absolute inset-0 bg-black/30" />
        <div
          className="relative bg-white dark:bg-surface-900 rounded-t-2xl sm:rounded-2xl w-full max-w-sm mx-4 mb-0 sm:mb-0 overflow-hidden overlay-content"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="overlay-handle" />
          <div className="p-5">
            <h3 className="text-lg font-semibold text-surface-800 mb-4">添加到主屏幕</h3>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0 text-brand-500 font-bold text-sm">1</div>
                <div>
                  <p className="text-sm text-surface-700">点击底部分享按钮</p>
                  <div className="flex items-center gap-1 mt-1">
                    <svg className="w-5 h-5 text-brand-500" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z" />
                    </svg>
                    <span className="text-xs text-surface-400">Safari 底部中间的分享图标</span>
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0 text-brand-500 font-bold text-sm">2</div>
                <div>
                  <p className="text-sm text-surface-700">在弹出菜单中找到并点击</p>
                  <p className="text-sm font-medium text-brand-600 mt-1">"添加到主屏幕"</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0 text-brand-500 font-bold text-sm">3</div>
                <div>
                  <p className="text-sm text-surface-700">点击右上角"添加"完成安装</p>
                </div>
              </div>
            </div>
          </div>
          <div className="border-t border-surface-100 p-4">
            <button
              onClick={handleDismiss}
              className="w-full btn-primary py-2.5 text-sm"
            >
              我知道了
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isIOSDevice = isIOS() && !deferredPrompt;

  return (
    <div className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-[45] fade-in-up">
      <div className="bg-white dark:bg-surface-900 rounded-2xl shadow-lg border border-surface-100 dark:border-surface-800 overflow-hidden">
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-surface-800">添加到主屏幕</h3>
              <p className="text-xs text-surface-500 mt-0.5">
                {isIOSDevice ? '像原生应用一样使用有迹' : '像原生应用一样使用有迹，支持离线访问'}
              </p>
            </div>
            <button
              onClick={handleDismiss}
              className="text-surface-300 hover:text-surface-500 transition-colors flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex border-t border-surface-100">
          <button
            onClick={handleDismiss}
            className="flex-1 py-2.5 text-sm text-surface-500 hover:bg-surface-50 transition-colors"
          >
            暂不
          </button>
          <button
            onClick={handleInstall}
            disabled={isInstalling}
            className="flex-1 py-2.5 text-sm font-medium text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-50"
          >
            {isInstalling ? '安装中...' : isIOSDevice ? '查看指引' : '立即安装'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default InstallPrompt;
