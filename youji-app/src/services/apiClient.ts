import { consumeSseStream } from './sseParser'

const API_BASE = import.meta.env.VITE_API_BASE_URL?.trim() || '/api'
const SESSION_FLAG_KEY = 'youji_has_session'
const DEFAULT_TIMEOUT_MS = 15_000

export const UNAUTHORIZED_EVENT = 'youji:unauthorized'

interface ErrorResponse {
  error?: string
}

export function setSessionActive() {  localStorage.setItem(SESSION_FLAG_KEY, 'true')
}

export function clearSession() {
  localStorage.removeItem(SESSION_FLAG_KEY)
}

export function isLoggedIn(): boolean {
  return localStorage.getItem(SESSION_FLAG_KEY) === 'true'
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  }
  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
    signal: options.signal ?? AbortSignal.timeout(timeoutMs),
  })

  if (res.status === 401) {
    clearSession()
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    throw new AuthError('登录已过期')
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return {} as T
  }

  let data: ErrorResponse & Record<string, unknown>
  try {
    data = (await res.json()) as ErrorResponse & Record<string, unknown>
  } catch {
    throw new Error(`服务器响应异常 (${res.status})`)
  }

  if (!res.ok) {
    throw Object.assign(
      new Error((typeof data.error === 'string' && data.error) || `请求失败: ${res.status}`),
      { status: res.status },
    );
  }

  return data as T
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export const api = {
  get: <T>(path: string, timeoutMs?: number) => request<T>(path, {}, timeoutMs),

  post: <T>(path: string, body?: unknown, timeoutMs?: number) =>
    request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }, timeoutMs),

  put: <T>(path: string, body?: unknown, timeoutMs?: number) =>
    request<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    }, timeoutMs),

  patch: <T>(path: string, body?: unknown, timeoutMs?: number) =>
    request<T>(path, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    }, timeoutMs),

  delete: <T>(path: string, timeoutMs?: number) =>
    request<T>(path, { method: 'DELETE' }, timeoutMs),
}

export interface CoachActionPayload {
  type: 'navigate' | 'add_todo' | 'log_expense' | 'check_habit'
  label: string
  path?: string
  text?: string
  name?: string
  amountFen?: number
  category?: string
}

export async function streamChat(
  message: string,
  sessionId?: string,
  onChunk?: (text: string) => void,
  onActions?: (actions: CoachActionPayload[]) => void,
  signal?: AbortSignal,
): Promise<{ sessionId: string; content: string }> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, sessionId }),
    credentials: 'include',
    signal: signal ?? AbortSignal.timeout(60_000),
  })

  if (res.status === 401) {
    clearSession()
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    throw new AuthError('登录已过期')
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as ErrorResponse)
    throw new Error(data.error || '请求失败')
  }

  const newSessionId = res.headers.get('X-Session-Id') || sessionId || ''
  let fullContent = ''

  if (res.body) {
    let completed = false
    await consumeSseStream(res.body, (data) => {
      if (data === '[DONE]') {
        completed = true
        return
      }
      if (completed) return
      try {
        const parsed = JSON.parse(data) as { content?: unknown; actions?: unknown }
        if (Array.isArray(parsed.actions)) {
          onActions?.(parsed.actions as CoachActionPayload[])
          return
        }
        if (typeof parsed.content === 'string') {
          fullContent += parsed.content
          onChunk?.(parsed.content)
        }
      } catch {
        // Malformed upstream events are skipped without losing adjacent events.
      }
    })
  }

  return { sessionId: newSessionId, content: fullContent }
}
