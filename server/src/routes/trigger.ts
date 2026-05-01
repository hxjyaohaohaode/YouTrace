import { FastifyPluginAsync } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { getTriggers, updateTrigger, ensureDefaultTriggers } from '../services/triggerService.js';

const triggerRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/triggers', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    await ensureDefaultTriggers(request.userId!);
    const triggers = await getTriggers(request.userId!);
    const result = triggers.map((t) => ({
      ...t,
      config: JSON.parse(t.config),
    }));
    return reply.send({ success: true, data: result });
  });

  fastify.put<{ Params: { id: string }; Body: { isActive?: boolean; config?: Record<string, unknown> } }>('/api/triggers/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const { isActive, config } = request.body;

    const trigger = await updateTrigger(request.userId!, id, { isActive, config });
    if (!trigger) {
      return reply.status(404).send({ success: false, message: '触发器不存在' });
    }

    return reply.send({
      success: true,
      data: { ...trigger, config: JSON.parse(trigger.config) },
      message: '触发器更新成功',
    });
  });
};

export default triggerRoutes;
