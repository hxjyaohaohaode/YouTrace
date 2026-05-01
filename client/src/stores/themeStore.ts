import { create } from 'zustand';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeState {
    mode: ThemeMode;
    isDark: boolean;
    setMode: (mode: ThemeMode) => void;
}

function getSystemDark(): boolean {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyDark(isDark: boolean): void {
    if (isDark) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}

function resolveIsDark(mode: ThemeMode): boolean {
    if (mode === 'system') return getSystemDark();
    return mode === 'dark';
}

const stored = (localStorage.getItem('youji_theme') as ThemeMode) || 'system';
const initialDark = resolveIsDark(stored);
applyDark(initialDark);

export const useThemeStore = create<ThemeState>((set) => ({
    mode: stored,
    isDark: initialDark,

    setMode: (mode) => {
        const isDark = resolveIsDark(mode);
        applyDark(isDark);
        localStorage.setItem('youji_theme', mode);
        set({ mode, isDark });
    },
}));

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const current = useThemeStore.getState();
    if (current.mode === 'system') {
        const isDark = getSystemDark();
        applyDark(isDark);
        useThemeStore.setState({ isDark });
    }
});
