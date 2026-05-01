import { FastifyPluginAsync } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { getLocation, searchCity, type LocationInfo } from '../services/locationService.js';

const locationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/location', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const ip = request.ip || request.headers['x-forwarded-for'] as string || undefined;
      const lng = (request.query as { lng?: string }).lng;
      const lat = (request.query as { lat?: string }).lat;

      const longitude = lng ? parseFloat(lng) : undefined;
      const latitude = lat ? parseFloat(lat) : undefined;

      if ((lng && isNaN(longitude!)) || (lat && isNaN(latitude!))) {
        return reply.status(400).send({
          success: false,
          message: '无效的经纬度参数',
        });
      }

      const location: LocationInfo = await getLocation(ip, longitude, latitude);

      return reply.send({
        success: true,
        data: location,
      });
    } catch (error) {
      const message = (error as Error).message || '定位失败';
      return reply.status(500).send({
        success: false,
        message,
      });
    }
  });

  fastify.get('/api/location/search', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const keyword = (request.query as { keyword?: string }).keyword;

      if (!keyword || keyword.trim().length === 0) {
        return reply.status(400).send({
          success: false,
          message: '搜索关键词不能为空',
        });
      }

      const results = await searchCity(keyword.trim());

      return reply.send({
        success: true,
        data: results,
      });
    } catch (error) {
      const message = (error as Error).message || '搜索城市失败';
      return reply.status(500).send({
        success: false,
        message,
      });
    }
  });
};

export default locationRoutes;
