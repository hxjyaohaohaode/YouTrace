import { createHmac, randomBytes } from 'node:crypto'

// Endpoint allowlist, not a model catalog or a selected provider. Exact URLs only.
export const SERVER_AI_BASE_URLS = new Set([
  'https://api.deepseek.com',
  'https://api.deepseek.com/v1',
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'https://api.xiaomimimo.com/v1',
])
// Ephemeral consent identity, not a stored credential. Restart/rotation requires
// reloading and reselecting the source; raw credential fingerprints are not exposed.
const configurationSalt = randomBytes(32)

export interface ServerAIConfiguration {
  configurationId: string
  endpoint: string
  model: string
  apiKey: string
}

// Deployment-only opt-in. Incomplete/invalid configuration disables this optional
// capability; it must not prevent authentication, CRUD or account-owned AI.
export function serverAIConfiguration(source: Record<string, string | undefined> = process.env): ServerAIConfiguration | null {
  if (source.SERVER_AI_ENABLED?.trim().toLowerCase() !== 'true') return null
  const apiKey = source.SERVER_AI_API_KEY?.trim() ?? ''
  const model = source.SERVER_AI_MODEL?.trim() ?? ''
  const base = source.SERVER_AI_BASE_URL?.trim() ?? ''
  if (!/^[\x21-\x7e]{1,1000}$/.test(apiKey) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$/.test(model)) return null
  try {
    const url = new URL(base)
    const normalizedBase = base.replace(/\/+$/, '')
    if (!SERVER_AI_BASE_URLS.has(normalizedBase)) return null
    const family = url.hostname === 'api.deepseek.com' ? /^deepseek-/i
      : url.hostname === 'dashscope.aliyuncs.com' ? /^qwen[0-9.-]/i
      : /^mimo-/i
    if (!family.test(model)) return null
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`
    const endpoint = url.toString()
    const configurationId = createHmac('sha256', configurationSalt).update(JSON.stringify([endpoint, model, apiKey])).digest('hex')
    return { configurationId, endpoint, model, apiKey }
  } catch { return null }
}

export function publicServerAIConfiguration() {
  const config = serverAIConfiguration()
  if (!config) return null
  return { configurationId: config.configurationId, endpoint: config.endpoint, model: config.model }
}
