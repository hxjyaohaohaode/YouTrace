import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { UserAIConnection } from '@prisma/client'
import { prisma } from '../utils/db.js'
import { readChatCompletionStream } from './openAiStream.js'

// Connection form templates, never installed connections or model defaults.
export const AI_PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com/chat/completions' },
  { id: 'glm', name: '智谱 GLM', endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions' },
  { id: 'qwen', name: '千问（北京）', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' },
  { id: 'mimo', name: '小米 MiMo', endpoint: 'https://api.xiaomimimo.com/v1/chat/completions' },
] as const
const providerIds = ['deepseek', 'glm', 'qwen', 'mimo'] as const
export const connectionSchema = z.object({
  connectionId: z.string().uuid().nullable(),
  version: z.number().int().min(0).max(2147483646),
  providerId: z.enum(providerIds),
  model: z.string().trim().min(1).max(150).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
  apiKey: z.string().max(1000).regex(/^[\x21-\x7e]*$/),
  chatConsent: z.boolean(),
}).strict()

export class AIError extends Error {
  constructor(public code: string, public status: 400 | 409 | 422 | 429 | 502 | 503 = 409) { super(code) }
}
export function encryptionReady(): boolean {
  try { encryptionKey(); return true } catch { return false }
}
function encryptionKey(): Buffer {
  const raw = process.env.AI_CREDENTIAL_ENCRYPTION_KEY?.trim() ?? ''
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw new AIError('AI_CREDENTIAL_STORAGE_UNAVAILABLE', 503)
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new AIError('AI_CREDENTIAL_STORAGE_UNAVAILABLE', 503)
  return key
}
function aad(userId: string, providerId: string): Buffer { return Buffer.from(`youtrace:user-ai:v1:${userId}:${providerId}`) }
export function encryptCredential(userId: string, providerId: string, key: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  cipher.setAAD(aad(userId, providerId))
  const body = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.')
}
function decryptCredential(row: UserAIConnection): string {
  const key = encryptionKey()
  try {
    const [version, iv, tag, body, extra] = row.cipher.split('.')
    if (version !== 'v1' || extra !== undefined) throw new Error('invalid envelope')
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
    decipher.setAAD(aad(row.userId, row.providerId))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8')
  } catch { throw new AIError('AI_CREDENTIALS_UNAVAILABLE', 503) }
}
export function publicConnection(row: UserAIConnection | null) {
  if (!row) return null
  const template = AI_PROVIDERS.find(provider => provider.id === row.providerId)
  if (!template) throw new AIError('AI_PROVIDER_UNSUPPORTED', 422)
  return { connectionId: row.id, providerId: row.providerId, providerName: template.name, endpoint: template.endpoint,
    model: row.model, version: row.version, chatConsent: row.chatConsent, configured: true,
    connectivity: 'not_tested' as const, updatedAt: row.updatedAt.toISOString() }
}
const active = new Map<string, Set<AbortController>>()
export function cancelAIRequests(userId: string): void {
  for (const controller of active.get(userId) ?? []) controller.abort()
}
export async function saveConnection(userId: string, input: z.infer<typeof connectionSchema>) {
  // Missing/invalid storage configuration must never produce plaintext persistence.
  encryptionKey()
  const old = await prisma.userAIConnection.findUnique({ where: { userId } })
  if (input.connectionId !== (old?.id ?? null) || input.version !== (old?.version ?? 0)) throw new AIError('AI_CONNECTION_CHANGED')
  if (!input.apiKey && (!old || old.providerId !== input.providerId)) throw new AIError('AI_NEW_CREDENTIAL_REQUIRED', 422)
  const cipher = input.apiKey ? encryptCredential(userId, input.providerId, input.apiKey) : old!.cipher
  const data = { providerId: input.providerId, model: input.model, cipher, chatConsent: input.chatConsent }
  try {
    const row = await prisma.$transaction(async tx => {
      if (!old) return tx.userAIConnection.create({ data: { ...data, userId, id: randomUUID(), version: 1 } })
      const changed = await tx.userAIConnection.updateMany({ where: { userId, id: input.connectionId!, version: input.version }, data: { ...data, version: { increment: 1 } } })
      if (changed.count !== 1) throw new AIError('AI_CONNECTION_CHANGED')
      return tx.userAIConnection.findUniqueOrThrow({ where: { userId } })
    })
    cancelAIRequests(userId)
    return publicConnection(row)
  } catch (error) {
    if (error instanceof AIError) throw error
    throw new AIError('AI_CONNECTION_SAVE_FAILED')
  }
}
export async function removeConnection(userId: string, connectionId: string, version: number) {
  const deleted = await prisma.userAIConnection.deleteMany({ where: { userId, id: connectionId, version } })
  if (deleted.count !== 1) throw new AIError('AI_CONNECTION_CHANGED')
  cancelAIRequests(userId)
}
export async function selectedConnection(userId: string, connectionId: string, version: number, requireConsent = true) {
  const row = await prisma.userAIConnection.findUnique({ where: { userId } })
  if (!row || row.id !== connectionId || row.version !== version) throw new AIError('AI_CONNECTION_CHANGED')
  if (requireConsent && !row.chatConsent) throw new AIError('AI_CHAT_CONSENT_REQUIRED', 422)
  publicConnection(row)
  return row
}
export type AIMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export function chatMessages(history: Array<{ role: string; content: string; source: string }>): AIMessage[] {
  // No app records, local-rule summaries, hidden tools, or other sessions are added.
  const chosen: AIMessage[] = []
  let remaining = 12000
  for (const message of history.filter(message => message.source === 'user_text' || message.source === 'user_ai').slice(-20).reverse()) {
    if (!['user', 'assistant'].includes(message.role) || message.content.length > remaining) break
    chosen.unshift({ role: message.role as 'user' | 'assistant', content: message.content })
    remaining -= message.content.length
  }
  return [{ role: 'system', content: '你是有迹的对话助手。你只能看到当前提供的对话内容，没有访问用户日记、账单、目标、日程或其他应用记录。不要声称读取了这些资料。仅提供文字建议，不能执行操作。' }, ...chosen]
}

export async function* completeUserAI(row: UserAIConnection, messages: AIMessage[], signal: AbortSignal, probe = false): AsyncGenerator<string> {
  const controllers = active.get(row.userId) ?? new Set<AbortController>()
  if (controllers.size >= 1) throw new AIError('AI_REQUEST_IN_PROGRESS', 429)
  const controller = new AbortController()
  controllers.add(controller); active.set(row.userId, controllers)
  const boundedSignal = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(probe ? 15000 : 30000)])
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const abortBody = () => { void reader?.cancel().catch(() => undefined) }
  boundedSignal.addEventListener('abort', abortBody, { once: true })
  try {
    await selectedConnection(row.userId, row.id, row.version, !probe)
    boundedSignal.throwIfAborted()
    const template = AI_PROVIDERS.find(provider => provider.id === row.providerId)
    if (!template) throw new AIError('AI_PROVIDER_UNSUPPORTED', 422)
    const key = decryptCredential(row)
    if (!key || !/^[\x21-\x7e]{1,1000}$/.test(key)) throw new AIError('AI_CREDENTIALS_UNAVAILABLE', 503)
    const payload = { model: row.model, messages, stream: true,
      ...(row.providerId === 'mimo' ? { max_completion_tokens: probe ? 32 : 1000, thinking: { type: 'disabled' } } : { max_tokens: probe ? 32 : 1000 }) }
    // Fixed HTTPS URLs, no client-controlled URL/headers, no redirects or retries.
    const response = await fetch(template.endpoint, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload), signal: boundedSignal })
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new AIError('AI_PROVIDER_UNAVAILABLE', 502) }
    if (response.redirected || (response.url && response.url !== template.endpoint)) { await response.body.cancel(); throw new AIError('AI_REDIRECT_REJECTED', 502) }
    reader = response.body.getReader()
    let bytes = 0
    const guarded = new ReadableStream<Uint8Array>({
      async pull(output) {
        try {
          boundedSignal.throwIfAborted()
          const value = await reader!.read()
          boundedSignal.throwIfAborted()
          if (value.done) { output.close(); return }
          bytes += value.value.byteLength
          if (bytes > 256000) throw new AIError('AI_RESPONSE_TOO_LARGE', 502)
          output.enqueue(value.value)
        } catch { output.error(new AIError('AI_PROVIDER_UNAVAILABLE', 502)); await reader?.cancel().catch(() => undefined) }
      },
      cancel() { return reader!.cancel() },
    })
    let chars = 0
    let pending = ''
    for await (const delta of readChatCompletionStream(guarded)) {
      chars += delta.length
      if (chars > 16000) throw new AIError('AI_RESPONSE_TOO_LARGE', 502)
      pending += delta
      if (pending.includes(key)) throw new AIError('AI_RESPONSE_REJECTED', 502)
      let held = Math.min(pending.length, key.length - 1)
      while (held > 0 && !pending.endsWith(key.slice(0, held))) held -= 1
      const safeLength = pending.length - held
      if (safeLength) { yield pending.slice(0, safeLength); pending = pending.slice(safeLength) }
    }
    if (chars === 0) throw new AIError('AI_PROVIDER_EMPTY', 502)
    if (pending) yield pending
  } catch (error) {
    if (signal.aborted || controller.signal.aborted) throw new AIError('AI_REQUEST_CANCELLED')
    if (error instanceof AIError) throw error
    throw new AIError('AI_PROVIDER_UNAVAILABLE', 502)
  } finally {
    boundedSignal.removeEventListener('abort', abortBody)
    await reader?.cancel().catch(() => undefined)
    reader?.releaseLock()
    controllers.delete(controller)
    if (controllers.size === 0) active.delete(row.userId)
  }
}
