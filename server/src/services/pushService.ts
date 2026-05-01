import webpush from 'web-push';
import prisma from '../utils/prisma.js';

let vapidConfigured = false;

function pemToBase64Url(pem: string): string | null {
  try {
    const cleaned = pem
      .replace(/-----BEGIN.*?KEY-----/g, '')
      .replace(/-----END.*?KEY-----/g, '')
      .replace(/\s/g, '');
    const raw = Buffer.from(cleaned, 'base64');

    if (raw.length === 65 && raw[0] === 0x04) {
      return raw.subarray(1).toString('base64url');
    }
    if (raw.length === 32) {
      return cleaned.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    return cleaned.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return null;
  }
}

function extractRawKey(envValue: string): string {
  if (envValue.includes('-----BEGIN')) {
    return pemToBase64Url(envValue) || envValue;
  }
  return envValue;
}

function initVapid() {
  const publicKeyRaw = process.env.VAPID_PUBLIC_KEY;
  const privateKeyRaw = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:youji@app.com';

  if (publicKeyRaw && privateKeyRaw) {
    try {
      const publicKey = extractRawKey(publicKeyRaw);
      const privateKey = extractRawKey(privateKeyRaw);
      webpush.setVapidDetails(subject, publicKey, privateKey);
      vapidConfigured = true;
      console.log('[Push] VAPID configured successfully');
    } catch (error) {
      console.error('[Push] VAPID configuration failed:', (error as Error).message);
      vapidConfigured = false;
    }
  } else {
    console.warn('[Push] VAPID keys not configured, push notifications disabled');
  }
}

initVapid();

export function getVapidPublicKey(): string {
  const raw = process.env.VAPID_PUBLIC_KEY || '';
  return extractRawKey(raw);
}

export async function saveSubscription(userId: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  const existing = await prisma.pushSubscription.findUnique({
    where: { endpoint: subscription.endpoint },
  });

  if (existing) {
    if (existing.userId === userId) return existing;
    await prisma.pushSubscription.delete({ where: { endpoint: subscription.endpoint } });
  }

  return prisma.pushSubscription.create({
    data: {
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
  });
}

export async function removeSubscription(userId: string, endpoint: string) {
  const sub = await prisma.pushSubscription.findUnique({ where: { endpoint } });
  if (!sub || sub.userId !== userId) return false;

  await prisma.pushSubscription.delete({ where: { endpoint } });
  return true;
}

export async function sendPushToUser(userId: string, payload: { title: string; body: string; url?: string }) {
  if (!vapidConfigured) return;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
  });

  if (subscriptions.length === 0) return;

  const pushPayload = JSON.stringify(payload);

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        pushPayload
      )
    )
  );

  const expiredEndpoints: string[] = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const error = result.reason as { statusCode?: number };
      if (error.statusCode === 410 || error.statusCode === 404) {
        expiredEndpoints.push(subscriptions[index].endpoint);
      }
    }
  });

  if (expiredEndpoints.length > 0) {
    await prisma.pushSubscription.deleteMany({
      where: { endpoint: { in: expiredEndpoints } },
    });
  }
}
