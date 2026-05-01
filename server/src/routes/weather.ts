import { FastifyPluginAsync } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import {
  getWeatherNow,
  getWeatherForecast,
  getAirQuality,
  getWeatherAlerts,
  getAmapWeather,
  getWeatherSummaryText,
  buildQWeatherLocation,
  type WeatherNowResponse,
  type ForecastResponse,
  type AirNowResponse,
  type AlertV1Response,
} from '../services/weatherService.js';
import { locateByIp, type LocationInfo } from '../services/locationService.js';

interface WeatherQuery {
  location?: string;
  days?: '3d' | '7d' | '10d' | '15d';
  lng?: string;
  lat?: string;
}

const weatherRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/weather/now', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const query = request.query as WeatherQuery;
      const location = await resolveLocation(request, query);

      const weather: WeatherNowResponse = await getWeatherNow(location);

      let air: AirNowResponse | null = null;
      try {
        air = await getAirQuality(location);
      } catch {
        air = null;
      }

      let alerts: AlertV1Response | null = null;
      try {
        const locInfo = await getLocationInfo(request, query);
        if (locInfo.longitude && locInfo.latitude) {
          alerts = await getWeatherAlerts(locInfo.latitude, locInfo.longitude);
        }
      } catch {
        alerts = null;
      }

      return reply.send({
        success: true,
        data: {
          now: weather.now,
          updateTime: weather.updateTime,
          air: air?.now || null,
          alerts: alerts?.alerts || [],
          location: await getLocationInfo(request, query),
        },
      });
    } catch (error) {
      const message = (error as Error).message || '获取天气数据失败';
      return reply.status(500).send({
        success: false,
        message,
      });
    }
  });

  fastify.get('/api/weather/forecast', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const query = request.query as WeatherQuery;
      const location = await resolveLocation(request, query);
      const days = query.days || '7d';

      const forecast: ForecastResponse = await getWeatherForecast(location, days);

      return reply.send({
        success: true,
        data: {
          daily: forecast.daily,
          updateTime: forecast.updateTime,
        },
      });
    } catch (error) {
      const message = (error as Error).message || '获取天气预报失败';
      return reply.status(500).send({
        success: false,
        message,
      });
    }
  });

  fastify.get('/api/weather/air', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const query = request.query as WeatherQuery;
      const location = await resolveLocation(request, query);

      let air: AirNowResponse | null = null;
      try {
        air = await getAirQuality(location);
      } catch {
        air = null;
      }

      if (!air) {
        return reply.send({
          success: true,
          data: {
            now: null,
            station: [],
            updateTime: '',
            message: '空气质量数据暂不可用，可能未订阅该服务',
          },
        });
      }

      return reply.send({
        success: true,
        data: {
          now: air.now,
          station: air.station || [],
          updateTime: air.updateTime,
        },
      });
    } catch (error) {
      const message = (error as Error).message || '获取空气质量失败';
      return reply.status(500).send({
        success: false,
        message,
      });
    }
  });

  fastify.get('/api/weather/alerts', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const query = request.query as WeatherQuery;
      const locInfo = await getLocationInfo(request, query);

      if (!locInfo.longitude || !locInfo.latitude) {
        return reply.send({
          success: true,
          data: { alerts: [] },
        });
      }

      const alerts: AlertV1Response = await getWeatherAlerts(locInfo.latitude, locInfo.longitude);

      return reply.send({
        success: true,
        data: {
          alerts: alerts.alerts || [],
          attributions: alerts.metadata?.attributions || [],
        },
      });
    } catch (error) {
      const message = (error as Error).message || '获取天气预警失败';
      return reply.status(500).send({
        success: false,
        message,
      });
    }
  });

  fastify.get('/api/weather/amap', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const query = request.query as { adcode?: string; extensions?: 'base' | 'all' };
      const locInfo = await getLocationInfo(request, {});
      const adcode = query.adcode || locInfo.adcode || '110000';
      const extensions = query.extensions || 'all';

      const data = await getAmapWeather(adcode, extensions);

      return reply.send({
        success: true,
        data,
        location: locInfo,
      });
    } catch (error) {
      const message = (error as Error).message || '获取高德天气数据失败';
      return reply.status(500).send({
        success: false,
        message,
      });
    }
  });

  fastify.get('/api/weather/summary', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const query = request.query as WeatherQuery;
      const location = await resolveLocation(request, query);

      const [weather, airResult, locInfo] = await Promise.all([
        getWeatherNow(location),
        getAirQuality(location).catch(() => null),
        getLocationInfo(request, query),
      ]);

      let alerts: AlertV1Response | null = null;
      try {
        if (locInfo.longitude && locInfo.latitude) {
          alerts = await getWeatherAlerts(locInfo.latitude, locInfo.longitude);
        }
      } catch {
        alerts = null;
      }

      const summary = getWeatherSummaryText(
        weather.now,
        airResult?.now || null,
        alerts?.alerts || [],
      );

      return reply.send({
        success: true,
        data: {
          summary,
          now: weather.now,
          air: airResult?.now || null,
          alerts: alerts?.alerts || [],
          location: locInfo,
        },
      });
    } catch (error) {
      const message = (error as Error).message || '获取天气摘要失败';
      return reply.status(500).send({
        success: false,
        message,
      });
    }
  });
};

async function resolveLocation(request: { ip?: string; headers: Record<string, unknown> }, query: WeatherQuery): Promise<string> {
  if (query.location) return query.location;

  if (query.lng && query.lat) {
    const lng = parseFloat(query.lng);
    const lat = parseFloat(query.lat);
    if (!isNaN(lng) && !isNaN(lat)) {
      return `${lng.toFixed(2)},${lat.toFixed(2)}`;
    }
  }

  const locInfo = await getLocationInfo(request, query);
  return buildQWeatherLocation(
    locInfo.longitude,
    locInfo.latitude,
    locInfo.city || locInfo.province,
  );
}

const locationInfoCache = new Map<string, { data: LocationInfo; timestamp: number }>();
const LOCATION_CACHE_TTL = 30 * 60 * 1000;
const MAX_LOCATION_CACHE_SIZE = 500;

function setLocationCache(key: string, data: LocationInfo) {
  if (locationInfoCache.size >= MAX_LOCATION_CACHE_SIZE) {
    const oldestKey = locationInfoCache.keys().next().value;
    if (oldestKey) locationInfoCache.delete(oldestKey);
  }
  locationInfoCache.set(key, { data, timestamp: Date.now() });
}

async function getLocationInfo(request: { ip?: string; headers: Record<string, unknown> }, query: WeatherQuery): Promise<LocationInfo> {
  if (query.lng && query.lat) {
    const lng = parseFloat(query.lng);
    const lat = parseFloat(query.lat);
    if (!isNaN(lng) && !isNaN(lat)) {
      const cacheKey = `regeo:${lng},${lat}`;
      const cached = locationInfoCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < LOCATION_CACHE_TTL) {
        return cached.data;
      }

      const { reverseGeocode } = await import('../services/locationService.js');
      const info = await reverseGeocode(lng, lat);
      setLocationCache(cacheKey, info);
      return info;
    }
  }

  const ip = request.ip || (request.headers['x-forwarded-for'] as string) || undefined;
  const cacheKey = `ip:${ip || 'auto'}`;
  const cached = locationInfoCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < LOCATION_CACHE_TTL) {
    return cached.data;
  }

  const info = await locateByIp(ip);
  setLocationCache(cacheKey, info);
  return info;
}

export default weatherRoutes;
