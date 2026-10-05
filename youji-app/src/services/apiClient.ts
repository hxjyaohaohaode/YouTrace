import { recordDiagnostic, requestArea } from './diagnostics'
import { consumeSseStream } from './sseParser'

const API_BASE = import.meta.env?.VITE_API_BASE_URL?.trim() || '/api'
const SESSION_FLAG_KEY = 'youji_has_session'
const DEFAULT_TIMEOUT_MS = 15_000

export const UNAUTHORIZED_EVENT = 'youji:unauthorized'

interface ErrorResponse {
  error?: string
}

export const SESSION_REVISION_KEY = 'youtrace:session-revision'
export const SIGNED_OUT_KEY = 'youtrace:signed-out'
let activeOwner: string | null = null
let sessionGeneration = 0
export function getSessionGeneration(): number { return sessionGeneration }
let sessionController = new AbortController()

export function setSessionActive(ownerId: string) {
  if (!ownerId) throw new Error('账号尚未验证')
  sessionGeneration += 1
  activeOwner = ownerId
  localStorage.setItem(SESSION_FLAG_KEY, 'true')
  localStorage.removeItem(SIGNED_OUT_KEY)
}

export function clearSession() {
  sessionGeneration += 1
  activeOwner = null
  sessionController.abort()
  sessionController = new AbortController()
  localStorage.removeItem(SESSION_FLAG_KEY)
}

export function announceSessionChange() {
  localStorage.setItem(SESSION_REVISION_KEY, crypto.randomUUID())
}

/** Verified in-memory account, never inferred from persisted login flags. */
export function getVerifiedSessionOwner(): string | null { return activeOwner }

export function isLoggedIn(): boolean {
  return activeOwner !== null
}

function sessionSignal(timeoutMs: number, signal?: AbortSignal) {
  return AbortSignal.any([sessionController.signal, AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])])
}

function accountHeaders(): Record<string, string> {
  return activeOwner ? { 'X-YouTrace-Account': activeOwner } : {}
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  if (!path.startsWith('/auth/') && !activeOwner) throw new AuthError('请先确认登录身份')
  const headers: Record<string, string> = {
    ...(!path.startsWith('/auth/') ? accountHeaders() : {}),
    ...((options.headers as Record<string, string>) || {}),
  }
  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  const startedAt = performance.now()
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
    signal: sessionSignal(timeoutMs, options.signal ?? undefined),
  }).catch((error: unknown) => { recordDiagnostic('request-failed', requestArea(path), performance.now() - startedAt); throw error })
  recordDiagnostic(res.ok ? 'request-ok' : 'request-failed', requestArea(path), performance.now() - startedAt, res.status)

  if (res.status === 401 || (res.status === 409 && res.headers.get('X-YouTrace-Account-Mismatch') === 'true')) {
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
      { status: res.status, code: data.code, conflict: data.conflict },
    );
  }

  return data as T
}

export class AuthError extends Error {
  readonly status = 401
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export const api = {
  logout: (ownerId: string) => request('/auth/logout', { method: 'POST', headers: { 'X-YouTrace-Account': ownerId } }, 5000),
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
  if (!activeOwner) throw new AuthError('请先确认登录身份')
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...accountHeaders(),
    },
    body: JSON.stringify({ message, sessionId }),
    credentials: 'include',
    signal: sessionSignal(60_000, signal),
  })

  if (res.status === 401 || (res.status === 409 && res.headers.get('X-YouTrace-Account-Mismatch') === 'true')) {
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
