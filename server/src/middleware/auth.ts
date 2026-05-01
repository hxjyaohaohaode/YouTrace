import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, verifyTokenAllowExpired } from '../utils/jwt.js';
import prisma from '../utils/prisma.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

export const authMiddleware = async (request: FastifyRequest, reply: FastifyReply) => {
  let token: string | undefined;

  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    const query = request.query as { token?: string };
    if (query.token) {
      token = query.token;
    }
  }

  if (!token) {
    return reply.status(401).send({
      success: false,
      message: '未提供认证令牌',
    });
  }

  try {
    const decoded = verifyToken(token);
    request.userId = decoded.userId;

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true },
    });

    if (!user) {
      return reply.status(401).send({
        success: false,
        message: '用户不存在或已被禁用',
      });
    }
  } catch (error) {
    const message = (error as Error).name === 'TokenExpiredError' ? '认证令牌已过期' : '认证令牌无效';
    return reply.status(401).send({
      success: false,
      message,
    });
  }
};

export const refreshAuthMiddleware = async (request: FastifyRequest, reply: FastifyReply) => {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({
      success: false,
      message: '未提供认证令牌',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyTokenAllowExpired(token);
    request.userId = decoded.userId;
  } catch {
    return reply.status(401).send({
      success: false,
      message: '认证令牌无效',
    });
  }
};

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function createRateLimiter(options: { maxRequests: number; windowMs: number }) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip || 'unknown';
    const now = Date.now();
    const entry = rateLimitMap.get(ip);

    if (!entry || now > entry.resetAt) {
      rateLimitMap.set(ip, { count: 1, resetAt: now + options.windowMs });
      return;
    }

    entry.count++;
    if (entry.count > options.maxRequests) {
      return reply.status(429).send({
        success: false,
        message: '请求过于频繁，请稍后再试',
      });
    }
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}, 60000);
