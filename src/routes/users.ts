import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../core/auth.js';
import { userMe, userPublic } from '../services/auth.js';
import { getUserById, updateMe, userUpdateSchema } from '../services/user.js';

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/me', { preHandler: requireAuth }, async (req) => userMe(req.user!));

  fastify.patch('/me', { preHandler: requireAuth }, async (req) => {
    const data = userUpdateSchema.parse(req.body);
    const u = await updateMe(req.user!, data);
    return userMe(u);
  });

  fastify.get('/:userId', { preHandler: requireAuth }, async (req) => {
    const params = z.object({ userId: z.coerce.number().int().positive() }).parse(req.params);
    const u = await getUserById(params.userId);
    return userPublic(u);
  });
};
