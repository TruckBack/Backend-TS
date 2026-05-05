import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../core/auth.js';
import {
  driverProfileUpdateSchema,
  driverStatusUpdateSchema,
  driverLocationSchema,
  driverProfile,
  updateProfile,
  updateStatus,
  updateLocation,
} from '../services/driver.js';
import { listDriverRatings, ratingRead } from '../services/order.js';
import { paginationQuerySchema, paginate } from '../utils/paginate.js';

export const driverRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.put('/me/profile', { preHandler: requireRole('driver') }, async (req) => {
    const data = driverProfileUpdateSchema.parse(req.body);
    const d = await updateProfile(req.user!, data);
    return driverProfile(d);
  });

  fastify.put('/me/status', { preHandler: requireRole('driver') }, async (req) => {
    const data = driverStatusUpdateSchema.parse(req.body);
    const d = await updateStatus(req.user!, data.status);
    return driverProfile(d);
  });

  fastify.post('/me/location', { preHandler: requireRole('driver') }, async (req) => {
    const data = driverLocationSchema.parse(req.body);
    const d = await updateLocation(req.user!, data.lat, data.lng);
    return driverProfile(d);
  });

  fastify.get('/:driverId/ratings', { preHandler: requireAuth }, async (req) => {
    const params = z.object({ driverId: z.coerce.number().int().positive() }).parse(req.params);
    const q = paginationQuerySchema.parse(req.query);
    const { items, total } = await listDriverRatings(params.driverId, q.limit, q.offset);
    return paginate(items.map(ratingRead), total, q.limit, q.offset);
  });
};
