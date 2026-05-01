import { FastifyPluginAsync } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { getNotifications, markAsRead, markAllAsRead, deleteNotification } from '../services/notificationService.js';

interface PaginationQuery {
  page?: string;
  pageSize?: string;
}

const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: PaginationQuery }>('/api/notifications', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const page = Number(request.query.page) || 1;
    const pageSize = Number(request.query.pageSize) || 20;
    const result = await getNotifications(request.userId!, page, pageSize);
    return reply.send({ success: true, data: result });
  });

  fastify.put<{ Params: { id: string } }>('/api/notifications/:id/read', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const notification = await markAsRead(request.userId!, id);
    if (!notification) {
      return reply.status(404).send({ success: false, message: '通知不存在' });
    }
    return reply.send({ success: true, data: notification });
  });

  fastify.put('/api/notifications/read-all', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    await markAllAsRead(request.userId!);
    return reply.send({ success: true, message: '全部标记已读' });
  });

  fastify.delete<{ Params: { id: string } }>('/api/notifications/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const deleted = await deleteNotification(request.userId!, id);
    if (!deleted) {
      return reply.status(404).send({ success: false, message: '通知不存在' });
    }
    return reply.send({ success: true, message: '通知已删除' });
  });
};

export default notificationRoutes;
