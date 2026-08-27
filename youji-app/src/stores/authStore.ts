import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useEffect } from 'react';
import { api, setSessionActive, clearSession, UNAUTHORIZED_EVENT } from '../services/apiClient';
import { pullServerChanges, flush, clearPendingSync, resetSyncCursor } from '../services/syncEngine';
import { useExpenseStore } from './expenseStore';
import { useTodoStore } from './todoStore';
import { useHabitStore } from './habitStore';
import { useQuickNoteStore } from './quickNoteStore';
import { useScheduleStore } from './scheduleStore';
import { useDiaryStore } from './diaryStore';
import { useCoachStore } from './coachStore';

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
  needRegister: boolean
  phone?: string
  registrationTicket?: string
}

interface AuthState {
  isAuthenticated: boolean
  authChecked: boolean
  user: AuthUser | null

  sendCode: (phone: string) => Promise<{ challengeId: string; devCode?: string }>
  verify: (phone: string, code: string, challengeId: string) => Promise<VerifyResult>
  register: (
    phone: string,
    nickname: string,
    registrationTicket: string,
    identity?: string,
    city?: string,
  ) => Promise<void>
  setUser: (user: AuthUser) => void
  logout: () => void
  loadUser: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      authChecked: false,

      sendCode: async (phone: string) => {
        return api.post<{ challengeId: string; devCode?: string }>('/auth/send-code', { phone })
      },

      verify: async (phone, code, challengeId) => {
        const data = await api.post<{
          user?: AuthUser
          needRegister?: boolean
          phone?: string
          registrationTicket?: string
        }>('/auth/verify', { phone, code, challengeId })

        if (data.user) {
          setSessionActive()
          set({
            user: data.user,
            isAuthenticated: true,
            authChecked: true,
          })
          await afterLoginSync()
          return { needRegister: false }
        }

        return {
          needRegister: true,
          phone: data.phone,
          registrationTicket: data.registrationTicket,
        }
      },

      register: async (phone, nickname, registrationTicket, identity = 'student', city = '') => {
        const data = await api.post<{ user: AuthUser }>('/auth/register', {
          phone,
          nickname,
          registrationTicket,
          identity,
          city,
        })

        setSessionActive()
        set({
          user: data.user,
          isAuthenticated: true,
          authChecked: true,
        })
        await afterLoginSync()
      },

      setUser: (user) => set({ user }),

      logout: () => {
        api.post('/auth/logout', undefined, 5000).catch(() => undefined)
        clearSession()
        void clearPendingSync().then(() => resetSyncCursor())
        set({ user: null, isAuthenticated: false, authChecked: true })
      },

      loadUser: async () => {
        try {
          const data = await api.get<{ user: AuthUser }>('/auth/me')
          setSessionActive()
          set({ user: data.user, isAuthenticated: true, authChecked: true })
        } catch (error) {
          if (error instanceof Error && error.constructor.name === 'AuthError') {
            clearSession()
            set({ user: null, isAuthenticated: false, authChecked: true })
            return
          }
          set({ authChecked: true })
        }
      },
    }),
    {
      name: 'youji-auth',
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)

export function useUnauthedRedirect() {
  const logout = useAuthStore((s) => s.logout)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    const handler = () => {
      if (useAuthStore.getState().isAuthenticated) {
        logout()
      }
    }
    window.addEventListener(UNAUTHORIZED_EVENT, handler)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler)
  }, [logout])

  return isAuthenticated
}

async function afterLoginSync(): Promise<void> {
  try {
    await resetSyncCursor();
    await pullServerChanges();
  } catch {
    // offline: local data stays, sync resumes on next bootstrap/flush
  }

  await Promise.all([
    useExpenseStore.getState().loadFromDB(),
    useTodoStore.getState().loadFromDB(),
    useHabitStore.getState().loadFromDB(),
    useQuickNoteStore.getState().loadFromDB(),
    useScheduleStore.getState().loadFromDB(),
    useDiaryStore.getState().loadFromDB(),
  ]).catch(() => undefined);
  void useCoachStore.getState().loadFromDB();

  void flush();
}
