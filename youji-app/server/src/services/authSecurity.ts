import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

export function generateOtpCode(): string {
  return String(randomInt(100000, 1000000))
}

export function generateRegistrationToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashAuthSecret(serverSecret: string, context: string, value: string): string {
  return createHmac('sha256', serverSecret)
    .update(context)
    .update('\0')
    .update(value)
    .digest('hex')
}

export function verifyAuthSecret(
  serverSecret: string,
  context: string,
  value: string,
  expectedHash: string,
): boolean {
  const actual = Buffer.from(hashAuthSecret(serverSecret, context, value), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
