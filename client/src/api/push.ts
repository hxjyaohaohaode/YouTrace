import client from './client';
import type { ApiResponse } from '../types';

interface VapidKeyResponse {
    publicKey: string;
}

export const pushApi = {
    getVapidKey: async (): Promise<ApiResponse<VapidKeyResponse>> => {
        const response = await client.get('/api/push/vapid-key');
        return response.data;
    },

    subscribe: async (subscription: PushSubscriptionJSON): Promise<ApiResponse> => {
        const response = await client.post('/api/push/subscribe', { subscription });
        return response.data;
    },

    unsubscribe: async (endpoint: string): Promise<ApiResponse> => {
        const response = await client.post('/api/push/unsubscribe', { endpoint });
        return response.data;
    },
};

export async function registerPushSubscription(): Promise<boolean> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('[Push] Push not supported');
        return false;
    }

    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.warn('[Push] Notification permission denied');
            return false;
        }

        const vapidRes = await pushApi.getVapidKey();
        if (!vapidRes.success || !vapidRes.data?.publicKey) {
            console.warn('[Push] Failed to get VAPID key');
            return false;
        }

        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: vapidRes.data.publicKey,
            });
        }

        const subJson = subscription.toJSON();
        if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
            console.warn('[Push] Invalid subscription');
            return false;
        }

        await pushApi.subscribe(subJson as PushSubscriptionJSON);
        console.log('[Push] Subscription registered');
        return true;
    } catch (error) {
        console.error('[Push] Registration failed:', error);
        return false;
    }
}

export async function unregisterPushSubscription(): Promise<boolean> {
    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
            const endpoint = subscription.endpoint;
            await subscription.unsubscribe();
            await pushApi.unsubscribe(endpoint);
        }
        return true;
    } catch (error) {
        console.error('[Push] Unregister failed:', error);
        return false;
    }
}
