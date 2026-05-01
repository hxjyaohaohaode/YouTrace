import client from './client';
import type { User, ApiResponse } from '../types';

interface AuthResponse {
  user: User;
  token: string;
}

export const authApi = {
  login: async (phone: string, password: string): Promise<ApiResponse<AuthResponse>> => {
    const response = await client.post('/api/auth/login', { phone, password });
    return response.data;
  },

  register: async (data: { phone: string; password: string; name?: string; code: string }): Promise<ApiResponse<AuthResponse>> => {
    const response = await client.post('/api/auth/register', data);
    return response.data;
  },

  smsLogin: async (phone: string, code: string): Promise<ApiResponse<AuthResponse>> => {
    const response = await client.post('/api/auth/sms-login', { phone, code });
    return response.data;
  },

  me: async (): Promise<ApiResponse<User>> => {
    const response = await client.get('/api/auth/me');
    return response.data;
  },

  updateProfile: async (data: { name?: string; avatar?: string; preferences?: Record<string, unknown>; aiPersona?: string }): Promise<ApiResponse<User>> => {
    const response = await client.put('/api/auth/profile', data);
    return response.data;
  },

  sendSmsCode: async (phone: string): Promise<ApiResponse<null>> => {
    const response = await client.post('/api/sms/send', { phone });
    return response.data;
  },

  verifySmsCode: async (phone: string, code: string): Promise<ApiResponse<null>> => {
    const response = await client.post('/api/sms/verify', { phone, code });
    return response.data;
  },
};
