import { FastifyPluginAsync } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { getVapidPublicKey, saveSubscription, removeSubscription } from '../services/pushService.js';

interface SubscribeBody {
  subscription: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  };
}

interface UnsubscribeBody {
  endpoint: string;
}

const pushRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/push/vapid-key', async (_request, reply) => {
    const publicKey = getVapidPublicKey();
    return reply.send({ success: true, data: { publicKey } });
  });

  fastify.post<{ Body: SubscribeBody }>('/api/push/subscribe', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { subscription } = request.body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return reply.status(400).send({ success: false, message: '无效的订阅信息' });
    }

    const result = await saveSubscription(request.userId!, subscription);
    return reply.send({ success: true, data: result, message: '推送订阅成功' });
  });

  fastify.post<{ Body: UnsubscribeBody }>('/api/push/unsubscribe', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { endpoint } = request.body;
    if (!endpoint) {
      return reply.status(400).send({ success: false, message: '缺少endpoint' });
    }

    await removeSubscription(request.userId!, endpoint);
    return reply.send({ success: true, message: '取消订阅成功' });
  });
};

export default pushRoutes;
