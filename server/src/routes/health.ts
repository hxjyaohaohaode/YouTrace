import { FastifyPluginAsync } from 'fastify';

interface HealthResponse {
  status: string;
  timestamp: string;
}

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Reply: HealthResponse }>('/health', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });
};

export default healthRoutes;
