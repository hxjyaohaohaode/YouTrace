import axios, { AxiosError } from 'axios';
import { getSecureToken, setSecureToken, clearAuthData } from '../utils/secureStorage';
import { useAuthStore } from '../stores/authStore';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

function shouldRetry(error: AxiosError): boolean {
  if (!error.config) return false;
  const method = error.config.method?.toUpperCase();
  if (method !== 'GET') return false;
  const retryCount = (error.config as typeof error.config & { _retryCount?: number })._retryCount || 0;
  if (retryCount >= MAX_RETRIES) return false;
  if (error.response) {
    const status = error.response.status;
    return status >= 500 || status === 429 || status === 408;
  }
  return !error.response && (error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK');
}

let cachedToken: string | null = null;

export function setCachedToken(token: string | null) {
  cachedToken = token;
}

client.interceptors.request.use(async (config) => {
  if (!cachedToken) {
    cachedToken = await getSecureToken();
  }
  if (cachedToken) {
    config.headers.Authorization = `Bearer ${cachedToken}`;
  }
  return config;
});

let isRefreshing = false;
let failedQueue: { resolve: (token: string) => void; reject: (error: unknown) => void }[] = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  failedQueue = [];
}

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as typeof error.config & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return client(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const token = await getSecureToken();
        if (!token) throw new Error('No token');

        const baseURL = import.meta.env.VITE_API_BASE_URL || '';
        const refreshURL = baseURL ? `${baseURL}/api/auth/refresh` : '/api/auth/refresh';

        let response: Response | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            response = await fetch(refreshURL, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            });
            if (response.ok) break;
            if (attempt === 0 && !response.ok) {
              await new Promise((r) => setTimeout(r, 1000));
            }
          } catch {
            if (attempt === 0) {
              await new Promise((r) => setTimeout(r, 1000));
              continue;
            }
            throw new Error('Refresh network error');
          }
        }

        if (!response || !response.ok) throw new Error('Refresh failed');

        const data = await response.json();
        if (data.success && data.data?.token) {
          await setSecureToken(data.data.token);
          cachedToken = data.data.token;
          useAuthStore.setState({ token: data.data.token });
          processQueue(null, data.data.token);
          originalRequest.headers.Authorization = `Bearer ${data.data.token}`;
          return client(originalRequest);
        }

        throw new Error('Invalid refresh response');
      } catch {
        processQueue(error, null);
        cachedToken = null;
        clearAuthData();
        window.dispatchEvent(new CustomEvent('auth:logout', { detail: { reason: 'token_expired' } }));
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (shouldRetry(error)) {
      const config = error.config!;
      (config as typeof config & { _retryCount?: number })._retryCount = ((config as typeof config & { _retryCount?: number })._retryCount || 0) + 1;
      const delay = RETRY_DELAY_MS * Math.pow(2, ((config as typeof config & { _retryCount?: number })._retryCount || 1) - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return client(config);
    }
    return Promise.reject(error);
  }
);

export default client;
