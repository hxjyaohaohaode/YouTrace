import { create } from 'zustand';
import { aiApi, type ChatMessage } from '../api/ai';
import type { Profile, AgentInfo, MemoryItem, Conversation } from '../types';
import { useLocationStore } from './locationStore';
import { extractErrorMessage } from '../utils/error';

interface AIState {
  messages: ChatMessage[];
  profile: Profile | null;
  agents: AgentInfo[];
  selectedAgent: string;
  memoryItems: MemoryItem[];
  memoryGrouped: Record<string, MemoryItem[]>;
  conversations: Conversation[];
  currentConversationId: string | null;
  isLoading: boolean;
  isSending: boolean;
  error: string | null;

  fetchMessages: (conversationId?: string) => Promise<void>;
  sendMessage: (content: string, attachmentIds?: string[]) => Promise<void>;
  fetchProfile: () => Promise<void>;
  updateProfile: (data: Partial<Profile>) => Promise<void>;
  fetchAgents: () => Promise<void>;
  setSelectedAgent: (agentId: string) => void;
  fetchMemory: () => Promise<void>;
  addMemory: (data: { category: string; key: string; value: string }) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  fetchConversations: (search?: string) => Promise<void>;
  createConversation: (data?: { title?: string; agentType?: string }) => Promise<Conversation | null>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  startNewChat: () => void;
  clearError: () => void;
}

export const useAIStore = create<AIState>((set, get) => ({
  messages: [],
  profile: null,
  agents: [],
  selectedAgent: 'default',
  memoryItems: [],
  memoryGrouped: {},
  conversations: [],
  currentConversationId: null,
  isLoading: false,
  isSending: false,
  error: null,

  fetchMessages: async (conversationId) => {
    set({ isLoading: true, error: null });
    try {
      const response = await aiApi.getChatHistory(conversationId);
      if (response.success && response.data) {
        set({ messages: response.data, isLoading: false });
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '获取聊天记录失败'), isLoading: false });
    }
  },

  sendMessage: async (content, attachmentIds) => {
    const { selectedAgent, currentConversationId } = get();
    set({ isSending: true, error: null });

    const tempUserMsg: ChatMessage = {
      id: 'temp-user-' + Date.now(),
      userId: '',
      role: 'user',
      content,
      agentType: selectedAgent,
      metadata: {},
      attachmentIds,
      createdAt: new Date().toISOString(),
    };

    const tempAiMsg: ChatMessage = {
      id: 'temp-ai-' + Date.now(),
      userId: '',
      role: 'assistant',
      content: '',
      agentType: selectedAgent,
      metadata: {},
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      messages: [...state.messages, tempUserMsg, tempAiMsg],
      isSending: true,
    }));

    const locState = useLocationStore.getState();
    const coords = locState.coords;
    const locationInfo = locState.location;
    const location = (coords?.lng && coords?.lat)
      ? { longitude: coords.lng, latitude: coords.lat }
      : (locationInfo?.longitude != null && locationInfo?.latitude != null)
        ? { longitude: locationInfo.longitude, latitude: locationInfo.latitude }
        : undefined;

    let streamContent = '';

    const safetyTimer = setTimeout(() => {
      const state = get();
      if (state.isSending) {
        set({ isSending: false, error: 'AI回复超时，请重试' });
      }
    }, 120000);

    await aiApi.sendMessageStream(
      content,
      selectedAgent,
      location || undefined,
      currentConversationId || undefined,
      attachmentIds,
      (chunk) => {
        streamContent += chunk;
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === tempAiMsg.id ? { ...m, content: streamContent } : m
          ),
        }));
      },
      (data) => {
        clearTimeout(safetyTimer);
        set((state) => ({
          messages: state.messages.map((m) => {
            if (m.id === tempAiMsg.id && data.assistantMessage) {
              return data.assistantMessage;
            }
            return m;
          }),
          currentConversationId: data.conversationId,
          isSending: false,
        }));
        get().fetchConversations();
      },
      (error) => {
        clearTimeout(safetyTimer);
        set((state) => ({
          messages: state.messages.filter((m) => m.id !== tempUserMsg.id && m.id !== tempAiMsg.id),
          error,
          isSending: false,
        }));
      },
    );
  },

  fetchProfile: async () => {
    try {
      const response = await aiApi.getProfile();
      if (response.success && response.data) {
        set({ profile: response.data });
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '获取个人信息失败') });
    }
  },

  updateProfile: async (data) => {
    try {
      const response = await aiApi.updateProfile(data);
      if (response.success && response.data) {
        set({ profile: response.data });
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '更新个人信息失败') });
    }
  },

  fetchAgents: async () => {
    try {
      const response = await aiApi.getAgents();
      if (response.success && response.data) {
        set({ agents: response.data });
      }
    } catch {
      set({ agents: [{ id: 'default', name: '全能助手', description: '综合智能助手', icon: '🤖' }] });
    }
  },

  setSelectedAgent: (agentId) => {
    set({ selectedAgent: agentId });
  },

  fetchMemory: async () => {
    try {
      const response = await aiApi.getMemory();
      if (response.success && response.data) {
        set({
          memoryItems: response.data.items,
          memoryGrouped: response.data.grouped,
        });
      }
    } catch {
      // ignore
    }
  },

  addMemory: async (data) => {
    try {
      const response = await aiApi.addMemory(data);
      if (response.success) {
        await get().fetchMemory();
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '添加记忆失败') });
    }
  },

  deleteMemory: async (id) => {
    try {
      await aiApi.deleteMemory(id);
      set((state) => ({
        memoryItems: state.memoryItems.filter((m) => m.id !== id),
      }));
      await get().fetchMemory();
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '删除记忆失败') });
    }
  },

  fetchConversations: async (search) => {
    try {
      const response = await aiApi.getConversations({ search, limit: 30 });
      if (response.success && response.data) {
        set({
          conversations: response.data.items,
        });
      }
    } catch {
      // ignore
    }
  },

  createConversation: async (data) => {
    try {
      const response = await aiApi.createConversation(data);
      if (response.success && response.data) {
        set((state) => ({
          conversations: [response.data!, ...state.conversations],
          currentConversationId: response.data!.id,
          messages: [],
        }));
        return response.data;
      }
    } catch {
      // ignore
    }
    return null;
  },

  selectConversation: async (id) => {
    set({ currentConversationId: id, isLoading: true });
    try {
      const response = await aiApi.getConversation(id);
      if (response.success && response.data) {
        set({
          messages: response.data.messages,
          selectedAgent: response.data.agentType,
          isLoading: false,
        });
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '加载对话失败'), isLoading: false });
    }
  },

  deleteConversation: async (id) => {
    try {
      await aiApi.deleteConversation(id);
      set((state) => {
        const remaining = state.conversations.filter((c) => c.id !== id);
        const isCurrent = state.currentConversationId === id;
        return {
          conversations: remaining,
          currentConversationId: isCurrent ? null : state.currentConversationId,
          messages: isCurrent ? [] : state.messages,
        };
      });
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '删除对话失败') });
    }
  },

  startNewChat: () => {
    set({ currentConversationId: null, messages: [] });
  },

  clearError: () => set({ error: null }),
}));
