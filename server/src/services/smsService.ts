import DypnsApiModule from '@alicloud/dypnsapi20170525';
import * as OpenApi from '@alicloud/openapi-client';
import * as TeaUtil from '@alicloud/tea-util';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DypnsApi = (DypnsApiModule as any).default || DypnsApiModule;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { SendSmsVerifyCodeRequest, CheckSmsVerifyCodeRequest } = DypnsApiModule as any;

const PHONE_REGEX = /^1[3-9]\d{9}$/;

let dypnsClient: any = null;

function getClient(): any {
    if (dypnsClient) return dypnsClient;

    const accessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID;
    const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET;

    if (!accessKeyId || !accessKeySecret) {
        return null;
    }

    const config = new OpenApi.Config({
        accessKeyId,
        accessKeySecret,
        endpoint: process.env.ALIYUN_SMS_ENDPOINT || 'dypnsapi.aliyuncs.com',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dypnsClient = new (DypnsApi as any)(config);
    return dypnsClient;
}

const signName = process.env.ALIYUN_SMS_SIGN_NAME || '';
const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE || '';

const smsSendLockMap = new Map<string, number>();
const SMS_LOCK_DURATION_MS = 60_000;

setInterval(() => {
    const now = Date.now();
    for (const [phone, lockedAt] of smsSendLockMap) {
        if (now - lockedAt > SMS_LOCK_DURATION_MS) {
            smsSendLockMap.delete(phone);
        }
    }
}, 60_000);

export function isSmsConfigured(): boolean {
    return !!(process.env.ALIYUN_SMS_ACCESS_KEY_ID && process.env.ALIYUN_SMS_ACCESS_KEY_SECRET);
}

export function validatePhone(phone: string): boolean {
    return PHONE_REGEX.test(phone);
}

export async function sendSmsVerifyCode(phone: string): Promise<{ success: boolean; message: string }> {
    if (!validatePhone(phone)) {
        return { success: false, message: '手机号格式不正确' };
    }

    const client = getClient();
    if (!client) {
        return { success: false, message: '短信服务未配置' };
    }

    const now = Date.now();
    const lockedAt = smsSendLockMap.get(phone);
    if (lockedAt && now - lockedAt < SMS_LOCK_DURATION_MS) {
        const remaining = Math.ceil((SMS_LOCK_DURATION_MS - (now - lockedAt)) / 1000);
        return { success: false, message: `请${remaining}秒后再试` };
    }

    try {
        const request = new SendSmsVerifyCodeRequest({
            phoneNumber: phone,
            signName,
            templateCode,
            templateParam: JSON.stringify({ code: '##code##', min: '5' }),
            codeType: 1,
            codeLength: 6,
            validTime: 300,
            interval: 60,
        });

        const runtime = new TeaUtil.RuntimeOptions({});

        const response = await client.sendSmsVerifyCodeWithOptions(request, runtime);

        if (response.body?.code === 'OK') {
            smsSendLockMap.set(phone, now);
            return { success: true, message: '验证码发送成功' };
        }

        const errMsg = response.body?.message || '发送失败';
        return { success: false, message: errMsg };
    } catch (error: unknown) {
        const err = error as Error & { code?: string; message?: string };
        console.error('[SMS] SendSmsVerifyCode error:', err.message || err);
        return { success: false, message: '验证码发送失败，请稍后重试' };
    }
}

export async function checkSmsVerifyCode(phone: string, code: string): Promise<{ success: boolean; message: string }> {
    if (!validatePhone(phone)) {
        return { success: false, message: '手机号格式不正确' };
    }

    if (!code || code.trim().length === 0) {
        return { success: false, message: '请输入验证码' };
    }

    const client = getClient();
    if (!client) {
        return { success: false, message: '短信服务未配置' };
    }

    try {
        const request = new CheckSmsVerifyCodeRequest({
            phoneNumber: phone,
            verifyCode: code.trim(),
        });

        const runtime = new TeaUtil.RuntimeOptions({});

        const response = await client.checkSmsVerifyCodeWithOptions(request, runtime);

        const verifyResult = response.body?.model?.verifyResult;

        if (verifyResult === 'PASS') {
            return { success: true, message: '验证码校验通过' };
        }

        return { success: false, message: '验证码错误或已过期' };
    } catch (error: unknown) {
        const err = error as Error & { code?: string; message?: string };
        console.error('[SMS] CheckSmsVerifyCode error:', err.message || err);
        return { success: false, message: '验证码校验失败，请稍后重试' };
    }
}
