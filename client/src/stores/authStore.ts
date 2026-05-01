import { create } from 'zustand';
import { authApi } from '../api/auth';
import { setSecureToken, getSecureToken, setUserData, getUserData, clearAuthData } from '../utils/secureStorage';
import { setCachedToken } from '../api/client';
import type { User } from '../types';
import { extractErrorMessage } from '../utils/error';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (phone: string, password: string) => Promise<void>;
  register: (phone: string, password: string, name: string, code: string) => Promise<void>;
  smsLogin: (phone: string, code: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  login: async (phone, password) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authApi.login(phone, password);
      if (response.success && response.data) {
        const { user, token } = response.data;
        await setSecureToken(token);
        await setUserData(user);
        setCachedToken(token);
        set({ user, token, isAuthenticated: true, isLoading: false });
      } else {
        const msg = response.message || '登录失败';
        set({ error: msg, isLoading: false });
        throw new Error(msg);
      }
    } catch (error: unknown) {
      const message = extractErrorMessage(error, '登录失败');
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  register: async (phone, password, name, code) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authApi.register({ phone, password, name, code });
      if (response.success && response.data) {
        const { user, token } = response.data;
        await setSecureToken(token);
        await setUserData(user);
        setCachedToken(token);
        set({ user, token, isAuthenticated: true, isLoading: false });
      } else {
        const msg = response.message || '注册失败';
        set({ error: msg, isLoading: false });
        throw new Error(msg);
      }
    } catch (error: unknown) {
      const message = extractErrorMessage(error, '注册失败');
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  smsLogin: async (phone, code) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authApi.smsLogin(phone, code);
      if (response.success && response.data) {
        const { user, token } = response.data;
        await setSecureToken(token);
        await setUserData(user);
        setCachedToken(token);
        set({ user, token, isAuthenticated: true, isLoading: false });
      } else {
        const msg = response.message || '登录失败';
        set({ error: msg, isLoading: false });
        throw new Error(msg);
      }
    } catch (error: unknown) {
      const message = extractErrorMessage(error, '登录失败');
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  logout: () => {
    clearAuthData();
    setCachedToken(null);
    set({ user: null, token: null, isAuthenticated: false });
  },

  checkAuth: async () => {
    const token = await getSecureToken();
    if (!token) {
      set({ isAuthenticated: false, user: null, token: null });
      return;
    }
    setCachedToken(token);
    const cachedUser = await getUserData();
    set({ token, isAuthenticated: true, user: (cachedUser as User) || null });
    try {
      const response = await authApi.me();
      if (response.success && response.data) {
        await setUserData(response.data);
        set({ user: response.data, token, isAuthenticated: true });
      }
    } catch (error: unknown) {
      const axiosErr = error as { response?: { status?: number } };
      const status = axiosErr?.response?.status;
      if (status === 401) {
        try {
          const baseURL = import.meta.env.VITE_API_BASE_URL || '';
          const refreshURL = baseURL ? `${baseURL}/api/auth/refresh` : '/api/auth/refresh';
          const refreshResponse = await fetch(refreshURL, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });
          if (refreshResponse.ok) {
            const data = await refreshResponse.json();
            if (data.success && data.data?.token) {
              await setSecureToken(data.data.token);
              setCachedToken(data.data.token);
              if (data.data.user) await setUserData(data.data.user);
              set({ token: data.data.token, user: data.data.user || (cachedUser as User), isAuthenticated: true });
              return;
            }
          }
        } catch {
          // refresh also failed
        }
        clearAuthData();
        setCachedToken(null);
        set({ isAuthenticated: false, user: null, token: null });
      }
    }
  },
}));

window.addEventListener('auth:logout', () => {
  useAuthStore.getState().logout();
});
