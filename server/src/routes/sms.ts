import { FastifyPluginAsync } from 'fastify';
import { sendSmsVerifyCode, checkSmsVerifyCode } from '../services/smsService.js';
import { createRateLimiter } from '../middleware/auth.js';

const smsSendLimiter = createRateLimiter({ maxRequests: 5, windowMs: 60000 });
const smsVerifyLimiter = createRateLimiter({ maxRequests: 10, windowMs: 60000 });

interface SendSmsBody {
    phone: string;
}

interface VerifySmsBody {
    phone: string;
    code: string;
}

const smsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.post<{ Body: SendSmsBody }>('/api/sms/send', {
        preHandler: smsSendLimiter,
    }, async (request, reply) => {
        const { phone } = request.body;

        if (!phone) {
            return reply.status(400).send({
                success: false,
                message: '请提供手机号',
            });
        }

        const result = await sendSmsVerifyCode(phone);

        if (!result.success) {
            return reply.status(400).send({
                success: false,
                message: result.message,
            });
        }

        return reply.send({
            success: true,
            message: result.message,
        });
    });

    fastify.post<{ Body: VerifySmsBody }>('/api/sms/verify', {
        preHandler: smsVerifyLimiter,
    }, async (request, reply) => {
        const { phone, code } = request.body;

        if (!phone || !code) {
            return reply.status(400).send({
                success: false,
                message: '请提供手机号和验证码',
            });
        }

        const result = await checkSmsVerifyCode(phone, code);

        if (!result.success) {
            return reply.status(400).send({
                success: false,
                message: result.message,
            });
        }

        return reply.send({
            success: true,
            message: result.message,
        });
    });
};

export default smsRoutes;
