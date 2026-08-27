import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'

type Step = 'phone' | 'code' | 'register'

const RESEND_SECONDS = 60

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const sendCode = useAuthStore((s) => s.sendCode)
  const verify = useAuthStore((s) => s.verify)
  const register = useAuthStore((s) => s.register)

  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [registrationTicket, setRegistrationTicket] = useState('')
  const [devCode, setDevCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendCountdown, setResendCountdown] = useState(0)

  useEffect(() => {
    if (resendCountdown <= 0) return
    const timer = setTimeout(() => setResendCountdown((n) => n - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendCountdown])

  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  if (isAuthenticated) {
    return <Navigate to={from} replace />
  }

  const handleSendCode = async () => {
    if (loading || resendCountdown > 0) return
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError('请输入正确的手机号')
      return
    }
    setError('')
    setLoading(true)
    try {
      const result = await sendCode(phone)
      setChallengeId(result.challengeId)
      setDevCode(result.devCode ?? '')
      setStep('code')
      setResendCountdown(RESEND_SECONDS)
    } catch (err: unknown) {
      setError(getErrorMessage(err, '发送失败'))
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    if (loading) return
    if (code.length !== 6) {
      setError('请输入6位验证码')
      return
    }
    setError('')
    setLoading(true)
    try {
      if (!challengeId) throw new Error('验证码请求已失效，请重新获取')
      const result = await verify(phone, code, challengeId)
      if (result.needRegister) {
        if (!result.registrationTicket) throw new Error('注册凭证缺失，请重新验证')
        setRegistrationTicket(result.registrationTicket)
        setStep('register')
      } else {
        navigate(from, { replace: true })
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, '验证失败'))
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async () => {
    if (loading) return
    if (!nickname.trim()) {
      setError('请输入昵称')
      return
    }
    setError('')
    setLoading(true)
    try {
      if (!registrationTicket) throw new Error('注册凭证已失效，请重新验证')
      await register(phone, nickname.trim(), registrationTicket)
      navigate(from, { replace: true })
    } catch (err: unknown) {
      setError(getErrorMessage(err, '注册失败'))
    } finally {
      setLoading(false)
    }
  }

  const handleBackToPhone = () => {
    setStep('phone')
    setCode('')
    setChallengeId('')
    setDevCode('')
    setError('')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[var(--bg)] to-[var(--primary-muted)] p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-light)] shadow-[var(--shadow-glow)]">
            <Sparkles size={28} className="text-white" aria-hidden />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-[var(--text-1)]">有迹</h1>
          <p className="mt-1 text-sm text-[var(--text-2)]">你的 AI 生活教练</p>
        </div>

        <div className="rounded-[var(--radius-xl)] border border-[var(--glass-border)] bg-[var(--glass-bg)] p-6 shadow-[var(--glass-shadow)] backdrop-blur-xl">
          <AnimatePresence mode="wait">
            {step === 'phone' && (
              <motion.div
                key="phone"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <h2 className="mb-4 text-lg font-semibold text-[var(--text-1)]">登录 / 注册</h2>
                <label htmlFor="login-phone" className="sr-only">手机号</label>
                <input
                  id="login-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  placeholder="输入手机号"
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={11}
                  aria-invalid={Boolean(error) || undefined}
                  className="h-12 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-4 text-base text-[var(--text-1)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]"
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleSendCode() }}
                />
                {error && <p className="mt-2 text-sm text-[var(--danger)]" role="alert">{error}</p>}
                <button
                  type="button"
                  onClick={() => void handleSendCode()}
                  disabled={loading || resendCountdown > 0 || phone.length !== 11}
                  className="mt-4 h-12 w-full rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] font-semibold text-white shadow-[var(--shadow-glow)] transition-transform active:scale-[0.98] disabled:opacity-50"
                >
                  {loading ? '发送中...' : resendCountdown > 0 ? `${resendCountdown}s 后重发` : '获取验证码'}
                </button>
              </motion.div>
            )}

            {step === 'code' && (
              <motion.div
                key="code"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <h2 className="mb-1 text-lg font-semibold text-[var(--text-1)]">输入验证码</h2>
                <p className="mb-4 text-sm text-[var(--text-2)]">已发送到 {phone}</p>
                {import.meta.env.DEV && devCode && (
                  <p className="mb-3 rounded-lg bg-[var(--warning)]/10 px-3 py-2 text-xs text-[var(--warning)]">
                    开发验证码：{devCode}
                  </p>
                )}
                <label htmlFor="login-code" className="sr-only">6位验证码</label>
                <input
                  id="login-code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6位验证码"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  aria-invalid={Boolean(error) || undefined}
                  className="h-12 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-4 text-center font-mono text-xl tracking-[0.5em] text-[var(--text-1)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]"
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleVerify() }}
                  autoFocus
                />
                {error && <p className="mt-2 text-sm text-[var(--danger)]" role="alert">{error}</p>}
                <button
                  type="button"
                  onClick={() => void handleVerify()}
                  disabled={loading || code.length !== 6}
                  className="mt-4 h-12 w-full rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] font-semibold text-white shadow-[var(--shadow-glow)] transition-transform active:scale-[0.98] disabled:opacity-50"
                >
                  {loading ? '验证中...' : '验证'}
                </button>
                <button
                  type="button"
                  onClick={handleBackToPhone}
                  className="mt-2 w-full py-2 text-sm text-[var(--text-2)]"
                >
                  返回修改手机号
                </button>
              </motion.div>
            )}

            {step === 'register' && (
              <motion.div
                key="register"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <h2 className="mb-1 text-lg font-semibold text-[var(--text-1)]">设置个人信息</h2>
                <p className="mb-4 text-sm text-[var(--text-2)]">首次使用，给自己取个名字吧</p>
                <label htmlFor="login-nickname" className="sr-only">昵称</label>
                <input
                  id="login-nickname"
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="你的昵称"
                  maxLength={20}
                  autoComplete="nickname"
                  aria-invalid={Boolean(error) || undefined}
                  className="h-12 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-4 text-base text-[var(--text-1)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]"
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleRegister() }}
                  autoFocus
                />
                {error && <p className="mt-2 text-sm text-[var(--danger)]" role="alert">{error}</p>}
                <button
                  type="button"
                  onClick={() => void handleRegister()}
                  disabled={loading || !nickname.trim()}
                  className="mt-4 h-12 w-full rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] font-semibold text-white shadow-[var(--shadow-glow)] transition-transform active:scale-[0.98] disabled:opacity-50"
                >
                  {loading ? '注册中...' : '开始使用'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="mt-4 text-center text-xs text-[var(--text-3)]">
          登录即代表同意用户协议和隐私政策
        </p>
      </motion.div>
    </div>
  )
}
