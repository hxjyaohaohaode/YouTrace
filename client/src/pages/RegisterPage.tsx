import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../api/auth';

function RegisterPage() {
    const navigate = useNavigate();
    const { register, isLoading, error } = useAuthStore();

    const [phone, setPhone] = useState('');
    const [smsCode, setSmsCode] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [countdown, setCountdown] = useState(0);
    const [isSendingCode, setIsSendingCode] = useState(false);
    const [sendCodeError, setSendCodeError] = useState('');
    const [localError, setLocalError] = useState('');

    useEffect(() => {
        if (countdown <= 0) return;
        const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
        return () => clearTimeout(timer);
    }, [countdown]);

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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError('');

        if (!phone) {
            setLocalError('请输入手机号');
            return;
        }

        const phoneRegex = /^1[3-9]\d{9}$/;
        if (!phoneRegex.test(phone)) {
            setLocalError('手机号格式不正确');
            return;
        }

        if (!smsCode || smsCode.length < 4) {
            setLocalError('请输入验证码');
            return;
        }

        if (password.length < 8) {
            setLocalError('密码长度至少要8个字符');
            return;
        }

        if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
            setLocalError('密码需包含字母和数字');
            return;
        }

        if (password !== confirmPassword) {
            setLocalError('两次输入的密码不一致');
            return;
        }

        try {
            await register(phone, password, '', smsCode);
            navigate('/');
        } catch {
            // error is handled in store
        }
    };

    const displayError = localError || error;

    return (
        <div className="min-h-screen bg-surface-50 flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-gradient-to-br from-brand-50/30 via-surface-50 to-orange-50/20" />

            <div className="w-full max-w-md relative z-10 fade-in-up">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center mx-auto mb-4 shadow-card">
                        <svg viewBox="0 0 1024 1024" className="w-10 h-10" xmlns="http://www.w3.org/2000/svg">
                            <defs>
                                <linearGradient id="reg-g" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stopColor="#e8941e" />
                                    <stop offset="100%" stopColor="#c9553e" />
                                </linearGradient>
                            </defs>
                            <circle cx="512" cy="512" r="56" fill="url(#reg-g)" />
                            <circle cx="512" cy="512" r="140" fill="none" stroke="url(#reg-g)" strokeWidth="14" opacity="0.55" />
                            <circle cx="512" cy="512" r="236" fill="none" stroke="url(#reg-g)" strokeWidth="11" opacity="0.3" />
                            <circle cx="512" cy="512" r="344" fill="none" stroke="url(#reg-g)" strokeWidth="8" opacity="0.14" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold gradient-text">注册</h1>
                    <p className="text-sm text-brand-500 font-medium mt-1">你来生活 我来记</p>
                </div>

                <div className="bg-white/90 dark:bg-surface-900/90 rounded-3xl p-8 shadow-card border border-surface-100/50 dark:border-surface-800/50">
                    {displayError && (
                        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200/50 dark:border-red-800/50 text-red-600 dark:text-red-400 rounded-xl p-3 mb-5 text-sm">
                            {displayError}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-surface-600 mb-2">手机号</label>
                            <input
                                type="tel"
                                value={phone}
                                onChange={(e) => { setPhone(e.target.value); setSendCodeError(''); setLocalError(''); }}
                                placeholder="请输入手机号"
                                maxLength={11}
                                className="input-field"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-surface-600 mb-2">验证码</label>
                            <div className="flex gap-3">
                                <input
                                    type="text"
                                    value={smsCode}
                                    onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="6位验证码"
                                    maxLength={6}
                                    className="input-field flex-1"
                                    required
                                />
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

                        <div>
                            <label className="block text-sm font-medium text-surface-600 mb-2">密码</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="至少8位，包含字母和数字"
                                className="input-field"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-surface-600 mb-2">确认密码</label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="再次输入密码"
                                className="input-field"
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="btn-primary w-full py-3 text-sm mt-2"
                        >
                            {isLoading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    注册中...
                                </span>
                            ) : '创建账号'}
                        </button>
                    </form>

                    <p className="text-center text-sm text-surface-400 mt-6">
                        已有账号？{' '}
                        <Link to="/login" className="text-brand-500 hover:text-brand-600 font-medium transition-colors">
                            登录
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}

export default RegisterPage;
