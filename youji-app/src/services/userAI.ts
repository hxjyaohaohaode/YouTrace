import { api } from './apiClient'
export interface AIConnectionIdentity { connectionId: string; version: number }
export interface AIConnection extends AIConnectionIdentity {
  providerId: string; providerName: string; endpoint: string; model: string;
  chatConsent: boolean; configured: boolean; connectivity: 'not_tested'; updatedAt: string
}
export interface AIConfiguration {
  connection: AIConnection | null; credentialStorageReady: boolean;
  templates: Array<{ id: string; name: string; endpoint: string }>
}
export const readAIConfiguration = () => api.get<AIConfiguration>('/ai-connection')
export function aiErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : ''
  const messages: Record<string, string> = {
    AI_CREDENTIAL_STORAGE_UNAVAILABLE: '服务器尚未配置凭据加密，暂不能保存或使用模型。',
    AI_CREDENTIALS_UNAVAILABLE: '密钥暂时无法解密。请联系部署者恢复匹配的加密配置，或重新填写密钥。',
    AI_CONNECTION_CHANGED: '连接已在其他页面改变。请刷新核对后再操作。',
    AI_NEW_CREDENTIAL_REQUIRED: '新建连接或更换服务商时，请填写新的 API 密钥。',
    AI_CONNECTION_SAVE_FAILED: '保存未确认。请刷新核对已保存配置，不要直接重复提交。',
    AI_CONNECTION_INVALID: '请核对服务商、模型标识和密钥格式。',
    AI_PROVIDER_UNAVAILABLE: '模型服务未完成请求。请在服务商处核对密钥、模型权限和用量；不会自动重试。',
    AI_RESPONSE_REJECTED: '模型响应包含不应返回的内容，已停止显示。',
    AI_REQUEST_CANCELLED: '请求已停止。已经发出的请求可能仍计费，请在服务商处核对。',
    AI_CHAT_CONSENT_REQUIRED: '请先在设置中确认这条连接的对话外发范围。',
    AI_RATE_LIMITED: '操作过于频繁，请稍后再试。',
    AI_REQUEST_IN_PROGRESS: '这条连接已有请求进行中，请等待或停止当前对话。',
  }
  return messages[code] ?? '操作结果尚未确认，请刷新核对。连接测试可能已发出，请在服务商处检查用量。'
}
