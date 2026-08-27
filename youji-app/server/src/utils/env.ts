const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5180',
  'http://localhost:4173',
]

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function parseAllowedOrigins(raw: string | undefined): string[] {
  const values = raw
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (values && values.length > 0) {
    return [...new Set(values)]
  }

  return DEFAULT_ALLOWED_ORIGINS
}

function parseBoolean(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === 'true'
}

function parseInteger(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = raw ? Number(raw) : fallback
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

export const env = {
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT) || 3000,
  jwtSecret: requireEnv('JWT_SECRET'),
  allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
  trustProxy: parseBoolean(process.env.TRUST_PROXY) || process.env.TRUST_PROXY === undefined,
  sessionCookieName: process.env.SESSION_COOKIE_NAME?.trim() || 'youji_session',
  llmApiKey: process.env.LLM_API_KEY?.trim() || '',
  llmBaseUrl: process.env.LLM_BASE_URL?.trim() || 'https://api.openai.com/v1',
  llmModel: process.env.LLM_MODEL?.trim() || 'gpt-4o-mini',
  llmTimeoutMs: parseInteger('LLM_TIMEOUT_MS', process.env.LLM_TIMEOUT_MS, 30000, 1000, 120000),
  smsProviderUrl: process.env.SMS_PROVIDER_URL?.trim() || '',
  smsProviderToken: process.env.SMS_PROVIDER_TOKEN?.trim() || '',
  smsTimeoutMs: parseInteger('SMS_TIMEOUT_MS', process.env.SMS_TIMEOUT_MS, 10000, 1000, 30000),
  devOtpExpose: parseBoolean(process.env.DEV_OTP_EXPOSE),
  otpTtlSeconds: parseInteger('OTP_TTL_SECONDS', process.env.OTP_TTL_SECONDS, 300, 60, 900),
  otpMaxAttempts: parseInteger('OTP_MAX_ATTEMPTS', process.env.OTP_MAX_ATTEMPTS, 5, 3, 10),
  registrationTicketTtlSeconds: parseInteger(
    'REGISTRATION_TICKET_TTL_SECONDS',
    process.env.REGISTRATION_TICKET_TTL_SECONDS,
    600,
    60,
    1800,
  ),
  requestBodyLimitBytes: parseInteger(
    'REQUEST_BODY_LIMIT_BYTES',
    process.env.REQUEST_BODY_LIMIT_BYTES,
    1024 * 1024,
    16 * 1024,
    5 * 1024 * 1024,
  ),
}

if (env.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long')
}

if (Boolean(env.smsProviderUrl) !== Boolean(env.smsProviderToken)) {
  throw new Error('SMS_PROVIDER_URL and SMS_PROVIDER_TOKEN must be configured together')
}

if (env.isProduction && env.devOtpExpose) {
  throw new Error('DEV_OTP_EXPOSE must never be enabled in production')
}

export function isOriginAllowed(origin?: string | null): boolean {
  if (!origin) {
    return true
  }

  return env.allowedOrigins.includes(origin)
}
