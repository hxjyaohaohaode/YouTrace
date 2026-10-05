import { create } from 'zustand';
import { useEffect } from 'react';
import {
  api, setSessionActive, clearSession, UNAUTHORIZED_EVENT, AuthError,
  announceSessionChange, SESSION_REVISION_KEY, SIGNED_OUT_KEY, getSessionGeneration,
} from '../services/apiClient';
import { bindAccountDatabase } from '../db';
import { pauseSync } from '../services/syncEngine';
import { stopPreferenceSync } from './settingsStore';

export interface AuthUser {
  id: string
  phone: string
  nickname: string
  avatar: string
  identity: string
  city: string
  coachStyle: string
  quietStart: string
  quietEnd: string
  pushLimit: number
}

interface VerifyResult {
  needRegister: boolean;
  phone?: string;
  registrationTicket?: string;
}

interface AuthState {
  isAuthenticated: boolean;
  authChecked: boolean;
  identityUnavailable: boolean;
  user: AuthUser | null;
  sendCode: (phone: string) => Promise<{ challengeId: string; devCode?: string }>;
  verify: (phone: string, code: string, challengeId: string) => Promise<VerifyResult>;
  register: (phone: string, nickname: string, registrationTicket: string, identity?: string, city?: string) => Promise<void>;
  setUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}

let loadingIdentity: Promise<void> | null = null;

function loginConfirmed() {
  localStorage.removeItem(SIGNED_OUT_KEY);
  announceSessionChange();
  // Login.tsx preserves the requested destination and reloads the document.
  // Never hydrate a second owner's data into an already-running store graph.
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  authChecked: false,
  identityUnavailable: false,

  sendCode: (phone) => api.post('/auth/send-code', { phone }),
  verify: async (phone, code, challengeId) => {
    const data = await api.post<VerifyResult & { user?: AuthUser }>('/auth/verify', { phone, code, challengeId });
    if (data.user) {
      loginConfirmed();
      return { needRegister: false };
    }
    return { needRegister: true, phone: data.phone, registrationTicket: data.registrationTicket };
  },
  register: async (phone, nickname, registrationTicket, identity = 'other', city = '') => {
    await api.post('/auth/register', { phone, nickname, registrationTicket, identity, city });
    loginConfirmed();
  },
  setUser: (user) => set({ user }),
  logout: async () => {
    const ownerId = useAuthStore.getState().user?.id;
    lockLocalSession();
    try { if (ownerId) await api.logout(ownerId); } catch { /* local sign-out remains effective */ }
    window.location.replace('/login');
  },
  loadUser: () => {
    if (loadingIdentity) return loadingIdentity;
    const generation = getSessionGeneration(), revision = localStorage.getItem(SESSION_REVISION_KEY);
    const current = () => generation === getSessionGeneration() && revision === localStorage.getItem(SESSION_REVISION_KEY);
    const assertCurrent = () => { if (!current()) throw new Error('登录状态已变化，旧页面不会重新打开账号资料'); };
    loadingIdentity = (async () => {
      set({ identityUnavailable: false });
      try {
        if (localStorage.getItem(SIGNED_OUT_KEY) === 'true') {
          await bindAccountDatabase(null, assertCurrent);
          set({ user: null, isAuthenticated: false, authChecked: true });
          return;
        }
        const { user } = await api.get<{ user: AuthUser }>('/auth/me');
        assertCurrent();
        await bindAccountDatabase(user.id, assertCurrent);
        assertCurrent();
        setSessionActive(user.id);
        set({ user, isAuthenticated: true, authChecked: true });
      } catch (error) {
        if (!current()) return;
        if (error instanceof AuthError) {
          clearSession();
          await bindAccountDatabase(null);
          set({ user: null, isAuthenticated: false, authChecked: true });
        } else {
          // A cached boolean is not proof of identity. Keep private data locked
          // until the session can be verified; all existing databases survive.
          set({ authChecked: false, identityUnavailable: true });
        }
      }
    })().finally(() => { loadingIdentity = null; });
    return loadingIdentity;
  },
}));

export function lockLocalSession(): void {
  stopPreferenceSync();
  useAuthStore.setState({ user: null, isAuthenticated: false, authChecked: false });
  pauseSync();
  clearSession();
  localStorage.setItem(SIGNED_OUT_KEY, 'true');
  announceSessionChange();
}

export function useUnauthedRedirect() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  useEffect(() => {
    const lock = () => {
      stopPreferenceSync();
      pauseSync();
      clearSession();
      useAuthStore.setState({ user: null, isAuthenticated: false, authChecked: false });
      window.location.replace('/login');
    };
    const changed = (event: StorageEvent) => {
      if (event.key === SESSION_REVISION_KEY) lock();
    };
    const unauthorized = () => {
      if (useAuthStore.getState().isAuthenticated) lock();
    };
    window.addEventListener(UNAUTHORIZED_EVENT, unauthorized);
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, unauthorized);
      window.removeEventListener('storage', changed);
    };
  }, []);
  return isAuthenticated;
}
