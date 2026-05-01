import client from './client';
import { getSecureToken } from '../utils/secureStorage';
import type { ApiResponse, Profile, MemoryItem, AgentInfo, Conversation } from '../types';

export interface AttachmentMeta {
  id: string;
  originalName: string;
  fileType: string;
  thumbnailPath: string | null;
}

export interface ChatMessage {
  id: string;
  userId: string;
  conversationId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentType: string;
  metadata: Record<string, unknown>;
  attachmentIds?: string[];
  attachmentNames?: string[];
  attachmentMeta?: AttachmentMeta[];
  createdAt: string;
}

export const aiApi = {
  getChatHistory: async (conversationId?: string): Promise<ApiResponse<ChatMessage[]>> => {
    const params = conversationId ? `?conversationId=${conversationId}` : '';
    const response = await client.get(`/api/ai/chat/history${params}`);
    return response.data;
  },

  getConversations: async (params?: { search?: string; page?: number; limit?: number }): Promise<ApiResponse<{ items: Conversation[]; total: number; page: number; totalPages: number }>> => {
    const query: Record<string, string> = {};
    if (params?.search) query.search = params.search;
    if (params?.page) query.page = String(params.page);
    if (params?.limit) query.limit = String(params.limit);
    const searchParams = new URLSearchParams(query).toString();
    const url = searchParams ? `/api/ai/conversations?${searchParams}` : '/api/ai/conversations';
    const response = await client.get(url);
    return response.data;
  },

  createConversation: async (data?: { title?: string; agentType?: string }): Promise<ApiResponse<Conversation>> => {
    const response = await client.post('/api/ai/conversations', data || {});
    return response.data;
  },

  getConversation: async (id: string): Promise<ApiResponse<Conversation & { messages: ChatMessage[] }>> => {
    const response = await client.get(`/api/ai/conversations/${id}`);
    return response.data;
  },

  deleteConversation: async (id: string): Promise<ApiResponse<null>> => {
    const response = await client.delete(`/api/ai/conversations/${id}`);
    return response.data;
  },

  getProfile: async (): Promise<ApiResponse<Profile>> => {
    const response = await client.get('/api/ai/profile');
    return response.data;
  },

  updateProfile: async (data: Partial<Omit<Profile, 'id' | 'userId' | 'preferences' | 'aiPersona' | 'createdAt' | 'updatedAt'>>): Promise<ApiResponse<Profile>> => {
    const response = await client.put('/api/ai/profile', data);
    return response.data;
  },

  deepAnalyze: async (diaryId: string): Promise<ApiResponse<{ analysis: string }>> => {
    const response = await client.post('/api/ai/deep-analyze', { diaryId });
    return response.data;
  },

  comprehensiveAnalysis: async (): Promise<ApiResponse<{ analysis: string; summary: Record<string, unknown> }>> => {
    const response = await client.get('/api/ai/comprehensive-analysis');
    return response.data;
  },

  getAgents: async (): Promise<ApiResponse<AgentInfo[]>> => {
    const response = await client.get('/api/ai/agents');
    return response.data;
  },

  getMemory: async (): Promise<ApiResponse<{ items: MemoryItem[]; grouped: Record<string, MemoryItem[]> }>> => {
    const response = await client.get('/api/ai/memory');
    return response.data;
  },

  addMemory: async (data: { category: string; key: string; value: string }): Promise<ApiResponse<MemoryItem>> => {
    const response = await client.post('/api/ai/memory', data);
    return response.data;
  },

  deleteMemory: async (id: string): Promise<ApiResponse<null>> => {
    const response = await client.delete(`/api/ai/memory/${id}`);
    return response.data;
  },

  sendMessageStream: async (
    content: string,
    agentType?: string,
    location?: { longitude: number; latitude: number },
    conversationId?: string,
    attachmentIds?: string[],
    onChunk?: (chunk: string) => void,
    onDone?: (data: { conversationId: string; assistantMessage: ChatMessage }) => void,
    onError?: (error: string) => void,
  ): Promise<void> => {
    const token = await getSecureToken();
    const url = '/api/ai/chat/stream';

    const body: Record<string, unknown> = { content, agentType };
    if (conversationId) body.conversationId = conversationId;
    if (location) { body.longitude = location.longitude; body.latitude = location.latitude; }
    if (attachmentIds && attachmentIds.length > 0) body.attachmentIds = attachmentIds;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        onError?.(`请求失败: ${response.status}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError?.('无法读取响应流');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let reading = true;

      while (reading) {
        const { done, value } = await reader.read();
        if (done) {
          reading = false;
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (currentEvent === 'chunk' && parsed.content) {
                onChunk?.(parsed.content);
              } else if (currentEvent === 'done') {
                onDone?.(parsed);
              } else if (currentEvent === 'error') {
                onError?.(parsed.message || 'AI回复失败');
              }
            } catch {
              // skip
            }
          }
        }
      }
    } catch (error) {
      onError?.((error as Error).message || '网络错误');
    }
  },
};
