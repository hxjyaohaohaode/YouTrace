import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import diaryRoutes from './routes/diary.js';
import eventRoutes from './routes/event.js';
import goalRoutes from './routes/goal.js';
import habitRoutes from './routes/habit.js';
import notificationRoutes from './routes/notification.js';
import triggerRoutes from './routes/trigger.js';
import pushRoutes from './routes/push.js';
import aiRoutes from './routes/ai.js';
import locationRoutes from './routes/location.js';
import weatherRoutes from './routes/weather.js';
import uploadRoutes from './routes/upload.js';
import smsRoutes from './routes/sms.js';
import scheduleRoutes from './routes/schedule.js';
import searchRoutes from './routes/search.js';
import { startCronTriggers, stopCronTriggers } from './services/triggerService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  try {
    const str = body as string;
    if (!str || str.trim() === '') {
      done(null, {});
      return;
    }
    const json = JSON.parse(str);
    done(null, json);
  } catch (err) {
    done(err as Error, undefined);
  }
});

const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
const allowedOrigins = corsOrigin.split(',').map((o) => o.trim()).filter(Boolean);

await fastify.register(cors, {
  origin: allowedOrigins,
  credentials: true,
});

await fastify.register(healthRoutes, { prefix: '/api' });
await fastify.register(authRoutes);
await fastify.register(diaryRoutes);
await fastify.register(eventRoutes);
await fastify.register(goalRoutes);
await fastify.register(habitRoutes);
await fastify.register(notificationRoutes);
await fastify.register(triggerRoutes);
await fastify.register(pushRoutes);
await fastify.register(aiRoutes);
await fastify.register(locationRoutes);
await fastify.register(weatherRoutes);
await fastify.register(uploadRoutes);
await fastify.register(smsRoutes);
await fastify.register(scheduleRoutes);
await fastify.register(searchRoutes);

const publicDir = path.join(__dirname, '..', 'public');
if (process.env.NODE_ENV === 'production') {
  try {
    await fastify.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
      wildcard: false,
    });

    fastify.setNotFoundHandler((request, reply) => {
      if (!request.url.startsWith('/api')) {
        const indexPath = path.join(publicDir, 'index.html');
        try {
          const content = fs.readFileSync(indexPath, 'utf-8');
          return reply.type('text/html').send(content);
        } catch {
          return reply.status(404).send({ success: false, message: 'Not found' });
        }
      }
      return reply.status(404).send({ success: false, message: 'Not found' });
    });
  } catch {
    fastify.log.warn('No public directory found, skipping static file serving');
  }
}

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST || '0.0.0.0';
    await fastify.listen({ port, host });
    console.log(`Server listening on http://localhost:${port}`);

    startCronTriggers();
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

process.on('SIGINT', () => {
  stopCronTriggers();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopCronTriggers();
  process.exit(0);
});

start();
