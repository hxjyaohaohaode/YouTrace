import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { api, getSessionGeneration, getVerifiedSessionOwner } from '../../services/apiClient'
import { aiErrorMessage, readAIConfiguration, type AIConfiguration, type AIConnection } from '../../services/userAI'
import { Button } from '../ui/Button'

export function AIConnectionPanel() {
  const owner = useAuthStore(state => state.user?.id ?? '')
  return owner ? <OwnedAIConnectionPanel key={owner} owner={owner} /> : <section aria-label="我的 AI 连接"><h2 className="settings-section-title">我的 AI 连接</h2><p className="text-sm">登录后可添加自己的模型。应用没有预置模型或共享密钥。</p></section>
}
function OwnedAIConnectionPanel({ owner }: { owner: string }) {
  const [config, setConfig] = useState<AIConfiguration | null>(null)
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [chatConsent, setChatConsent] = useState(false)
  const [probeConsent, setProbeConsent] = useState(false)
  const [deleteConsent, setDeleteConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const mounted = useRef(true)
  const revision = useRef(0)
  const pending = useRef(false)
  const generation = useRef(getSessionGeneration())
  const current = (value: number) => mounted.current && revision.current === value && getVerifiedSessionOwner() === owner && getSessionGeneration() === generation.current
  function accept(data: AIConfiguration) {
    setConfig(data); setProviderId(data.connection?.providerId ?? ''); setModel(data.connection?.model ?? '')
    setChatConsent(data.connection?.chatConsent ?? false); setApiKey(''); setProbeConsent(false); setDeleteConsent(false)
  }
  useEffect(() => {
    mounted.current = true
    const value = ++revision.current
    readAIConfiguration().then(data => { if (mounted.current && value === revision.current && getVerifiedSessionOwner() === owner && getSessionGeneration() === generation.current) accept(data) })
      .catch(cause => { if (mounted.current && value === revision.current) setError(aiErrorMessage(cause)) })
    return () => { mounted.current = false; revision.current += 1 }
  }, [owner])
  async function run(action: () => Promise<void>) {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(''); setStatus('')
    try { await action() } catch (cause) { if (current(revision.current)) setError(aiErrorMessage(cause)) }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  const selected = config?.templates.find(template => template.id === providerId)
  const row = config?.connection
  const identity = row ? { connectionId: row.connectionId, version: row.version } : null
  const inputClass = 'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-sm'
  return <section className="space-y-3" aria-label="我的 AI 连接">
    <h2 className="settings-section-title">我的 AI 连接</h2>
    <p className="text-sm leading-6">每个账户可保存一条自己的模型连接。下面的服务商只是添加选项，尚未替你添加模型。未配置时使用明确标注的本地规则回复。</p>
    {config && !config.credentialStorageReady && <p role="status" className="text-sm text-[var(--warning)]">服务器尚未配置凭据加密，暂不能保存或测试模型。已保存配置和聊天历史保持不变。</p>}
    <form onSubmit={event => { event.preventDefault(); void run(async () => {
      if (!config) return
      const value = ++revision.current
      const result = await api.put<{ connection: AIConnection }>('/ai-connection', { connectionId: row?.connectionId ?? null, version: row?.version ?? 0, providerId, model, apiKey, chatConsent })
      if (current(value)) { accept({ ...config, connection: result.connection }); setStatus('连接已保存。尚未验证服务商连通性，不会自动试连或收费。') }
    }) }}>
      <fieldset disabled={busy || !config?.credentialStorageReady} className="space-y-3">
        <label className="block text-sm">服务商<select className={inputClass} value={providerId} required onChange={event => { setProviderId(event.target.value); setApiKey(''); setChatConsent(false); setProbeConsent(false) }}><option value="">请选择服务商</option>{config?.templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
        {selected && <p className="break-all text-xs">固定接收地址：{selected.endpoint}</p>}
        <label className="block text-sm">模型标识<input className={inputClass} value={model} onChange={event => setModel(event.target.value)} required maxLength={150} autoComplete="off" placeholder="填写你在服务商处可用的模型标识" /></label>
        <label className="block text-sm">{row ? '新 API 密钥（同一服务商留空可保留）' : 'API 密钥'}<input className={inputClass} type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} required={!row || row.providerId !== providerId} maxLength={1000} autoComplete="new-password" /></label>
        <p className="text-xs leading-5">密钥只通过当前服务器发往所选服务商，并在服务器加密保存。不会回显或进入普通账号导出。完整数据库备份含加密凭据，恢复需匹配的服务器加密密钥。不要把密钥粘贴到对话框。</p>
        <label className="flex items-start gap-2 text-sm leading-6"><input className="mt-1" type="checkbox" aria-label="允许对话外发" checked={chatConsent} onChange={event => setChatConsent(event.target.checked)} /><span>允许我在教练页面使用这条连接：把我发送的消息，以及当前会话最多 20 条、合计最多 12,000 字符的可发送对话交给 {selected?.name ?? '所选服务商'}，由我的 API 账户承担费用。会话中的本地规则回复和旧来源不明的历史不会外发；日记、账单、习惯、目标和日程不会自动附加。可随时取消勾选并保存。</span></label>
        <Button type="submit" disabled={busy || !providerId || !model.trim()}>{busy ? '处理中…' : row ? '保存修改' : '添加我的模型'}</Button>
      </fieldset>
    </form>
    {row && <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
      <p className="text-sm">已保存：{row.providerName} · {row.model}</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" aria-label="确认连接测试可能收费" checked={probeConsent} disabled={busy || !config?.credentialStorageReady} onChange={event => setProbeConsent(event.target.checked)} /><span>向这条已保存连接发送一次不含个人资料的测试消息。可能收费，失败或超时不会自动重试。</span></label>
      <Button variant="ghost" disabled={busy || !probeConsent || !config?.credentialStorageReady} onClick={() => void run(async () => {
        if (!identity) return
        const value = ++revision.current
        const response = await api.post<{ notice: string }>('/ai-connection/probe', { ...identity, confirmProviderCharge: true }, 20000)
        if (current(value)) { setStatus(response.notice); setProbeConsent(false) }
      })}>测试已保存连接</Button>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" aria-label="确认删除模型连接" checked={deleteConsent} disabled={busy} onChange={event => setDeleteConsent(event.target.checked)} /><span>删除这条连接及保存的密钥。聊天记录保留；已经发出的服务商请求无法撤回。</span></label>
      <Button variant="ghost" disabled={busy || !deleteConsent} onClick={() => void run(async () => {
        if (!identity || !config) return
        const value = ++revision.current
        await api.post('/ai-connection/remove', identity)
        if (current(value)) { accept({ ...config, connection: null }); setStatus('连接已删除，后续聊天不会使用旧密钥。') }
      })}>删除我的连接</Button>
    </div>}
    <Button variant="ghost" disabled={busy} onClick={() => void run(async () => { const value = ++revision.current; const data = await readAIConfiguration(); if (current(value)) { accept(data); setStatus('已读取服务器保存的配置。') } })}>刷新已保存配置</Button>
    {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
    {status && <p role="status" className="text-sm">{status}</p>}
  </section>
}
