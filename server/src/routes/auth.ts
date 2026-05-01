import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma.js';
import { generateToken } from '../utils/jwt.js';
import { authMiddleware, createRateLimiter, refreshAuthMiddleware } from '../middleware/auth.js';
import { checkSmsVerifyCode, validatePhone } from '../services/smsService.js';

const SALT_ROUNDS = 12;
const PASSWORD_MIN_LENGTH = 8;

const authLimiter = createRateLimiter({ maxRequests: 10, windowMs: 60000 });
const registerLimiter = createRateLimiter({ maxRequests: 5, windowMs: 3600000 });
const smsLoginLimiter = createRateLimiter({ maxRequests: 10, windowMs: 60000 });

interface RegisterBody {
  phone: string;
  password: string;
  name?: string;
  code: string;
}

interface PhoneLoginBody {
  phone: string;
  password: string;
}

interface SmsLoginBody {
  phone: string;
  code: string;
}

interface UpdateProfileBody {
  name?: string;
  avatar?: string;
  preferences?: Record<string, unknown>;
  aiPersona?: string;
}

const userSelectFields = {
  id: true,
  phone: true,
  name: true,
  avatar: true,
  createdAt: true,
  updatedAt: true,
};

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: RegisterBody }>('/api/auth/register', {
    preHandler: registerLimiter,
  }, async (request, reply) => {
    const { phone, password, name, code } = request.body;

    if (!phone || !password || !code) {
      return reply.status(400).send({
        success: false,
        message: '请提供手机号、验证码和密码',
      });
    }

    if (!validatePhone(phone)) {
      return reply.status(400).send({
        success: false,
        message: '手机号格式不正确',
      });
    }

    const verifyResult = await checkSmsVerifyCode(phone, code);
    if (!verifyResult.success) {
      return reply.status(401).send({
        success: false,
        message: verifyResult.message,
      });
    }

    if (password.length < PASSWORD_MIN_LENGTH) {
      return reply.status(400).send({
        success: false,
        message: `密码至少需要${PASSWORD_MIN_LENGTH}个字符`,
      });
    }

    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return reply.status(400).send({
        success: false,
        message: '密码必须包含字母和数字',
      });
    }

    const displayName = (name && name.trim().length >= 2) ? name.trim() : `用户${phone.slice(-4)}`;

    const existingUser = await prisma.user.findUnique({ where: { phone } });
    if (existingUser) {
      return reply.status(409).send({
        success: false,
        message: '该手机号已被注册',
      });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        phone,
        password: hashedPassword,
        name: displayName,
        profile: {
          create: {
            preferences: '{}',
            aiPersona: 'default',
          },
        },
      },
      select: userSelectFields,
    });

    const token = generateToken({ userId: user.id, phone: user.phone });

    return reply.status(201).send({
      success: true,
      data: {
        user,
        token,
      },
      message: '注册成功',
    });
  });

  fastify.post<{ Body: PhoneLoginBody }>('/api/auth/login', {
    preHandler: authLimiter,
  }, async (request, reply) => {
    const { phone, password } = request.body;

    if (!phone || !password) {
      return reply.status(400).send({
        success: false,
        message: '请提供手机号和密码',
      });
    }

    if (!validatePhone(phone)) {
      return reply.status(400).send({
        success: false,
        message: '手机号格式不正确',
      });
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      return reply.status(401).send({
        success: false,
        message: '手机号或密码错误',
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return reply.status(401).send({
        success: false,
        message: '手机号或密码错误',
      });
    }

    const token = generateToken({ userId: user.id, phone: user.phone });

    const { password: _password, ...userWithoutPassword } = user;

    return reply.send({
      success: true,
      data: {
        user: userWithoutPassword,
        token,
      },
      message: '登录成功',
    });
  });

  fastify.post<{ Body: SmsLoginBody }>('/api/auth/sms-login', {
    preHandler: smsLoginLimiter,
  }, async (request, reply) => {
    const { phone, code } = request.body;

    if (!phone || !code) {
      return reply.status(400).send({
        success: false,
        message: '请提供手机号和验证码',
      });
    }

    if (!validatePhone(phone)) {
      return reply.status(400).send({
        success: false,
        message: '手机号格式不正确',
      });
    }

    const verifyResult = await checkSmsVerifyCode(phone, code);
    if (!verifyResult.success) {
      return reply.status(401).send({
        success: false,
        message: verifyResult.message,
      });
    }

    const user = await prisma.user.findUnique({
      where: { phone },
      select: userSelectFields,
    });

    if (!user) {
      return reply.status(404).send({
        success: false,
        message: '该手机号未注册，请先注册',
      });
    }

    const token = generateToken({ userId: user.id, phone: user.phone });

    return reply.send({
      success: true,
      data: {
        user,
        token,
      },
      message: '登录成功',
    });
  });

  fastify.post('/api/auth/refresh', {
    preHandler: refreshAuthMiddleware,
  }, async (request, reply) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: request.userId! },
        select: userSelectFields,
      });

      if (!user) {
        return reply.status(404).send({
          success: false,
          message: '用户不存在',
        });
      }

      const newToken = generateToken({ userId: user.id, phone: user.phone });

      return reply.send({
        success: true,
        data: {
          user,
          token: newToken,
        },
        message: '令牌刷新成功',
      });
    } catch {
      return reply.status(401).send({
        success: false,
        message: '认证令牌无效',
      });
    }
  });

  fastify.get('/api/auth/me', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.userId },
      select: {
        ...userSelectFields,
        profile: true,
      },
    });

    if (!user) {
      return reply.status(404).send({
        success: false,
        message: '用户不存在',
      });
    }

    return reply.send({
      success: true,
      data: user,
    });
  });

  fastify.put<{ Body: UpdateProfileBody }>('/api/auth/profile', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { name, avatar, preferences, aiPersona } = request.body;

    if (name !== undefined || avatar !== undefined) {
      await prisma.user.update({
        where: { id: request.userId },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(avatar !== undefined && { avatar }),
        },
      });
    }

    if (preferences !== undefined || aiPersona !== undefined) {
      await prisma.profile.upsert({
        where: { userId: request.userId! },
        update: {
          ...(preferences !== undefined && { preferences: JSON.stringify(preferences) }),
          ...(aiPersona !== undefined && { aiPersona }),
        },
        create: {
          userId: request.userId!,
          preferences: preferences ? JSON.stringify(preferences) : '{}',
          aiPersona: aiPersona || 'default',
        },
      });
    }

    const updatedUser = await prisma.user.findUnique({
      where: { id: request.userId },
      select: {
        ...userSelectFields,
        profile: true,
      },
    });

    return reply.send({
      success: true,
      data: updatedUser,
      message: '资料更新成功',
    });
  });
};

export default authRoutes;
