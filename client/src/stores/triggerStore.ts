import { create } from 'zustand';
import { triggerApi, type TriggerItem } from '../api/trigger';
import { extractErrorMessage } from '../utils/error';

interface TriggerState {
    triggers: TriggerItem[];
    isLoading: boolean;
    error: string | null;

    fetchTriggers: () => Promise<void>;
    updateTrigger: (id: string, data: { isActive?: boolean; config?: Record<string, unknown> }) => Promise<void>;
    clearError: () => void;
}

export const useTriggerStore = create<TriggerState>((set) => ({
    triggers: [],
    isLoading: false,
    error: null,

    fetchTriggers: async () => {
        set({ isLoading: true, error: null });
        try {
            const response = await triggerApi.getList();
            if (response.success && response.data) {
                set({ triggers: response.data, isLoading: false });
            }
        } catch (error: unknown) {
            set({ error: extractErrorMessage(error, '获取触发器失败'), isLoading: false });
        }
    },

    updateTrigger: async (id, data) => {
        try {
            const response = await triggerApi.update(id, data);
            if (response.success && response.data) {
                set((state) => ({
                    triggers: state.triggers.map((t) =>
                        t.id === id ? response.data! : t
                    ),
                }));
            }
        } catch (error: unknown) {
            set({ error: extractErrorMessage(error, '更新触发器失败') });
        }
    },

    clearError: () => set({ error: null }),
}));
