import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../api/auth';

type LoginMode = 'password' | 'sms';

function LoginPage() {
  const [mode, setMode] = useState<LoginMode>('password');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [sendCodeError, setSendCodeError] = useState('');
  const { login, smsLogin, isLoading, error } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(phone, password);
      navigate('/');
    } catch {
      // error is handled in store
    }
  };

  const handleSmsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;
    try {
      await smsLogin(phone, smsCode);
      navigate('/');
    } catch {
      // error is handled in store
    }
  };

  const handleSendCode = useCallback(async () => {
    if (!phone || countdown > 0) return;
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      setSendCodeError('请输入正确的手机号');
      return;
    }
    setIsSendingCode(true);
    setSendCodeError('');
    try {
      const res = await authApi.sendSmsCode(phone);
      if (res.success) {
        setCountdown(60);
      } else {
        setSendCodeError(res.message || '发送失败');
      }
    } catch {
      setSendCodeError('发送失败，请稍后重试');
    } finally {
      setIsSendingCode(false);
    }
  }, [phone, countdown]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-50 px-4">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-50/30 via-surface-50 to-orange-50/20" />

      <div className="w-full max-w-md relative z-10 fade-in-up">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4" style={{ animation: 'float 3s ease-in-out infinite' }}>
            <div className="w-20 h-20 rounded-2xl bg-brand-50 flex items-center justify-center shadow-card">
              <svg viewBox="0 0 1024 1024" className="w-14 h-14" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="login-g" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#e8941e" />
                    <stop offset="100%" stopColor="#c9553e" />
                  </linearGradient>
                </defs>
                <circle cx="512" cy="512" r="56" fill="url(#login-g)" />
                <circle cx="512" cy="512" r="140" fill="none" stroke="url(#login-g)" strokeWidth="14" opacity="0.55" />
                <circle cx="512" cy="512" r="236" fill="none" stroke="url(#login-g)" strokeWidth="11" opacity="0.3" />
                <circle cx="512" cy="512" r="344" fill="none" stroke="url(#login-g)" strokeWidth="8" opacity="0.14" />
              </svg>
            </div>
          </div>
          <h1 className="text-2xl font-bold gradient-text">有迹</h1>
          <p className="text-brand-500 text-sm font-medium">你来生活 我来记</p>
        </div>

        <div className="bg-white/90 dark:bg-surface-900/90 rounded-3xl p-6 sm:p-8 shadow-card border border-surface-100/50 dark:border-surface-800/50">
          <h2 className="text-lg sm:text-xl font-semibold text-surface-800 dark:text-surface-100 mb-5 sm:mb-6">欢迎回来</h2>

          <div className="flex mb-5 bg-surface-100 dark:bg-surface-800 rounded-xl p-1">
            <button
              type="button"
              onClick={() => setMode('password')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${mode === 'password'
                ? 'bg-white dark:bg-surface-700 text-brand-600 dark:text-brand-400 shadow-sm'
                : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
                }`}
            >
              密码登录
            </button>
            <button
              type="button"
              onClick={() => setMode('sms')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${mode === 'sms'
                ? 'bg-white dark:bg-surface-700 text-brand-600 dark:text-brand-400 shadow-sm'
                : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
                }`}
            >
              验证码登录
            </button>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl mb-4 text-sm fade-in">
              {error}
            </div>
          )}

          {mode === 'password' ? (
            <form onSubmit={handlePasswordSubmit} className="space-y-4 sm:space-y-5">
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-surface-600 mb-1.5">
                  手机号
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  maxLength={11}
                  className="input-field"
                  placeholder="请输入手机号" />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-surface-600 mb-1.5">
                  密码
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="input-field"
                  placeholder="请输入密码" />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="btn-primary w-full py-3 text-sm"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    登录中...
                  </span>
                ) : '登录'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSmsSubmit} className="space-y-4 sm:space-y-5">
              <div>
                <label htmlFor="sms-phone" className="block text-sm font-medium text-surface-600 mb-1.5">
                  手机号
                </label>
                <input
                  id="sms-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); setSendCodeError(''); }}
                  required
                  maxLength={11}
                  className="input-field"
                  placeholder="请输入手机号" />
              </div>

              <div>
                <label htmlFor="smsCode" className="block text-sm font-medium text-surface-600 mb-1.5">
                  验证码
                </label>
                <div className="flex gap-3">
                  <input
                    id="smsCode"
                    type="text"
                    value={smsCode}
                    onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    maxLength={6}
                    className="input-field flex-1"
                    placeholder="6位验证码" />
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={isSendingCode || countdown > 0 || !phone}
                    className="btn-secondary px-4 py-2.5 text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSendingCode ? '发送中...' : countdown > 0 ? `${countdown}s` : '获取验证码'}
                  </button>
                </div>
                {sendCodeError && (
                  <p className="text-xs text-red-500 mt-1.5">{sendCodeError}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isLoading || !phone || smsCode.length < 4}
                className="btn-primary w-full py-3 text-sm disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    登录中...
                  </span>
                ) : '登录'}
              </button>
            </form>
          )}

          <p className="mt-5 text-center text-sm text-surface-400">
            还没有账号？
            <Link to="/register" className="text-brand-500 hover:text-brand-600 font-medium ml-1 transition-colors">
              立即注册
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
