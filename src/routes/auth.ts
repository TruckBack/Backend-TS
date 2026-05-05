import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  customerRegisterSchema,
  driverRegisterSchema,
  loginJsonSchema,
  refreshTokenSchema,
  registerCustomer,
  registerDriver,
  loginByEmail,
  refresh,
  userMe,
} from '../services/auth.js';
import { BadRequestError } from '../core/errors.js';
import {
  buildAuthUrl,
  exchangeCodeForProfile,
  loginOrRegisterFromProfile,
  verifyIdToken,
} from '../services/googleAuth.js';

const googleTokenSchema = z.object({
  id_token: z.string().min(1),
  role: z.enum(['customer', 'driver', 'admin']).optional(),
});

const googleTokenWithRoleSchema = z.object({
  id_token: z.string().min(1),
  role: z.enum(['customer', 'driver', 'admin']),
});

export const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.post('/register/customer', async (req, reply) => {
    const data = customerRegisterSchema.parse(req.body);
    const u = await registerCustomer(data);
    reply.code(201);
    return userMe(u);
  });

  fastify.post('/register/driver', async (req, reply) => {
    const data = driverRegisterSchema.parse(req.body);
    const u = await registerDriver(data);
    reply.code(201);
    return userMe(u);
  });

  fastify.post('/login/json', async (req) => {
    const data = loginJsonSchema.parse(req.body);
    return loginByEmail(data.email, data.password, data.role);
  });

  fastify.post('/login', async (req) => {
    // form-encoded username + password
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) throw new BadRequestError('username and password required');
    return loginByEmail(username, password);
  });

  fastify.post('/refresh', async (req) => {
    const data = refreshTokenSchema.parse(req.body);
    return refresh(data.refresh_token);
  });

  fastify.get('/google', async (req) => {
    const q = (req.query ?? {}) as { role?: string };
    return { url: buildAuthUrl(q.role) };
  });

  fastify.post('/google', async (req) => {
    const data = googleTokenSchema.parse(req.body);
    const profile = await verifyIdToken(data.id_token);
    return loginOrRegisterFromProfile(profile, data.role);
  });

  fastify.get('/google/callback', async (req) => {
    const q = (req.query ?? {}) as { code?: string; state?: string };
    if (!q.code) throw new BadRequestError('Missing code');
    const profile = await exchangeCodeForProfile(q.code);
    const role = q.state === 'driver' || q.state === 'admin' || q.state === 'customer' ? q.state : undefined;
    return loginOrRegisterFromProfile(profile, role);
  });

  fastify.post('/google/token', async (req) => {
    const data = googleTokenWithRoleSchema.parse(req.body);
    const profile = await verifyIdToken(data.id_token);
    return loginOrRegisterFromProfile(profile, data.role);
  });
};
