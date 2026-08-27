import { env } from '../utils/env.js'

export class OtpDeliveryUnavailableError extends Error {
  constructor() {
    super('OTP delivery is not configured')
    this.name = 'OtpDeliveryUnavailableError'
  }
}

export interface OtpDeliveryResult {
  exposeDevelopmentCode: boolean
}

interface OtpDeliveryConfig {
  isProduction: boolean
  devOtpExpose: boolean
  smsProviderUrl: string
}

export function resolveOtpDeliveryMode(config: OtpDeliveryConfig): OtpDeliveryResult {
  if (config.smsProviderUrl) {
    return { exposeDevelopmentCode: false }
  }

  if (!config.isProduction && config.devOtpExpose) {
    return { exposeDevelopmentCode: true }
  }

  throw new OtpDeliveryUnavailableError()
}

export async function deliverOtp(phone: string, code: string): Promise<OtpDeliveryResult> {
  const delivery = resolveOtpDeliveryMode(env)
  if (delivery.exposeDevelopmentCode) {
    return delivery
  }

  try {
    const response = await fetch(env.smsProviderUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.smsProviderToken}`,
      },
      body: JSON.stringify({ phone, code, purpose: 'login', expiresInSeconds: env.otpTtlSeconds }),
      signal: AbortSignal.timeout(env.smsTimeoutMs),
    })

    if (!response.ok) {
      throw new OtpDeliveryUnavailableError()
    }
  } catch (error) {
    if (error instanceof OtpDeliveryUnavailableError) {
      throw error
    }
    throw new OtpDeliveryUnavailableError()
  }

  return delivery
}
