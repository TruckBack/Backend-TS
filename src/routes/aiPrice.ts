import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../core/auth.js';
import { estimatePrice } from '../services/aiPrice.js';

const bodySchema = z.object({ message: z.string().min(1) });

export const aiPriceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', { preHandler: requireAuth }, async (req) => {
    const data = bodySchema.parse(req.body);
    const result = await estimatePrice(data.message);
    return { result };
  });
};
