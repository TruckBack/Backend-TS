import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import websocket from '@fastify/websocket';
import path from 'node:path';
import { ZodError } from 'zod';
import { config, loadConfig } from './config.js';
import { AppError, ValidationError } from './core/errors.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { driverRoutes } from './routes/drivers.js';
import { orderRoutes } from './routes/orders.js';
import { uploadRoutes } from './routes/uploads.js';
import { chatRoutes } from './routes/chat.js';
import { wsRoutes } from './routes/ws.js';
import { aiPriceRoutes } from './routes/aiPrice.js';
import { ensureUploadsDir } from './services/upload.js';

export async function buildApp(): Promise<FastifyInstance> {
  loadConfig();
  await ensureUploadsDir();

  const fastify = Fastify({
    logger: false,
    bodyLimit: 12 * 1024 * 1024,
  });

  // CORS
  const origins = config.CORS_ORIGINS_LIST;
  await fastify.register(cors, {
    origin: origins.length > 0 ? origins : false,
    credentials: true,
  });

  await fastify.register(multipart, {
    limits: { fileSize: 11 * 1024 * 1024, files: 1 },
  });

  await fastify.register(websocket);

  // Static uploads
  await fastify.register(staticPlugin, {
    root: path.resolve(config.UPLOADS_DIR),
    prefix: '/uploads/',
    decorateReply: false,
  });

  // Health
  fastify.get('/health', async () => ({ status: 'ok' }));
  fastify.get('/openapi.json', async () => ({
    openapi: '3.0.0',
    info: { title: config.APP_NAME, version: '1.0.0' },
    paths: {},
  }));

  // Error handler — must be registered BEFORE routes so they inherit it
  fastify.setErrorHandler((error, _req, reply) => {
    const isZod =
      error instanceof ZodError ||
      (error as { name?: string }).name === 'ZodError' ||
      Array.isArray((error as { issues?: unknown }).issues);
    if (isZod) {
      const issues = (error as ZodError).issues ?? (error as { errors?: unknown }).errors;
      const ve = new ValidationError(issues);
      reply.code(ve.statusCode).send(ve.toEnvelope());
      return;
    }
    const isAppError =
      error instanceof AppError ||
      (typeof (error as { toEnvelope?: unknown }).toEnvelope === 'function' &&
        typeof (error as { statusCode?: number }).statusCode === 'number');
    if (isAppError) {
      const ae = error as AppError;
      reply.code(ae.statusCode).send(ae.toEnvelope());
      return;
    }
    if ((error as { validation?: unknown }).validation) {
      const ve = new ValidationError((error as { validation: unknown }).validation);
      reply.code(ve.statusCode).send(ve.toEnvelope());
      return;
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      reply.code(status).send({ error: { code: 'bad_request', message: error.message } });
      return;
    }
    reply.code(500).send({
      error: { code: 'internal_server_error', message: 'Internal server error' },
    });
  });

  fastify.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } });
  });

  // Routes
  const prefix = config.API_V1_PREFIX;
  await fastify.register(authRoutes, { prefix: `${prefix}/auth` });
  await fastify.register(userRoutes, { prefix: `${prefix}/users` });
  await fastify.register(driverRoutes, { prefix: `${prefix}/drivers` });
  await fastify.register(orderRoutes, { prefix: `${prefix}/orders` });
  await fastify.register(uploadRoutes, { prefix: `${prefix}/uploads` });
  await fastify.register(chatRoutes, { prefix: `${prefix}/chat` });
  await fastify.register(wsRoutes, { prefix: `${prefix}/ws` });
  await fastify.register(aiPriceRoutes, { prefix: `${prefix}/ai-price` });

  return fastify;
}
