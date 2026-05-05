import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../core/auth.js';
import {
  acceptOrder,
  cancelOrder,
  canViewOrder,
  completeOrder,
  createOrder,
  deleteDriverResponse,
  deleteOrder,
  driverResponseSchema,
  getOrderById,
  getRating,
  listActive,
  listAvailable,
  listHistory,
  orderCreateSchema,
  orderRead,
  orderUpdateSchema,
  pickupOrder,
  ratingCreateSchema,
  ratingRead,
  setDriverResponse,
  startOrder,
  submitRating,
  updateOrder,
} from '../services/order.js';
import { ForbiddenError } from '../core/errors.js';
import { paginate, paginationQuerySchema } from '../utils/paginate.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const cancelBody = z.object({ reason: z.string().max(512).optional().nullable() }).optional();

export const orderRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', { preHandler: requireRole('customer') }, async (req, reply) => {
    const data = orderCreateSchema.parse(req.body);
    const o = await createOrder(req.user!, data);
    reply.code(201);
    return orderRead(o);
  });

  fastify.get('/available', { preHandler: requireAuth }, async (req) => {
    const q = paginationQuerySchema.parse(req.query);
    const { items, total } = await listAvailable(q.limit, q.offset);
    return paginate(items.map(orderRead), total, q.limit, q.offset);
  });

  fastify.get('/history', { preHandler: requireAuth }, async (req) => {
    const q = paginationQuerySchema.parse(req.query);
    const { items, total } = await listHistory(req.user!, q.limit, q.offset);
    return paginate(items.map(orderRead), total, q.limit, q.offset);
  });

  fastify.get('/me/active', { preHandler: requireAuth }, async (req) => {
    const items = await listActive(req.user!);
    return items.map(orderRead);
  });

  fastify.get('/:id', { preHandler: requireAuth }, async (req) => {
    const { id } = idParam.parse(req.params);
    const o = await getOrderById(id);
    if (!(await canViewOrder(req.user!, o))) throw new ForbiddenError('Cannot view this order');
    return orderRead(o);
  });

  fastify.patch('/:id', { preHandler: requireAuth }, async (req) => {
    const { id } = idParam.parse(req.params);
    const data = orderUpdateSchema.parse(req.body);
    const u = req.user!;
    if (u.role !== 'customer' && u.role !== 'admin') throw new ForbiddenError('Forbidden');
    const o = await updateOrder(u, id, data);
    return orderRead(o);
  });

  fastify.delete('/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const u = req.user!;
    if (u.role !== 'customer' && u.role !== 'admin') throw new ForbiddenError('Forbidden');
    await deleteOrder(u, id);
    reply.code(204);
    return null;
  });

  fastify.post('/:id/accept', { preHandler: requireRole('driver') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const o = await acceptOrder(req.user!, id);
    return orderRead(o);
  });

  fastify.post('/:id/start', { preHandler: requireRole('driver') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const o = await startOrder(req.user!, id);
    return orderRead(o);
  });

  fastify.post('/:id/pickup', { preHandler: requireRole('driver') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const o = await pickupOrder(req.user!, id);
    return orderRead(o);
  });

  fastify.post('/:id/complete', { preHandler: requireRole('driver') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const o = await completeOrder(req.user!, id);
    return orderRead(o);
  });

  fastify.post('/:id/cancel', { preHandler: requireAuth }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = cancelBody.parse(req.body ?? {});
    const o = await cancelOrder(req.user!, id, body?.reason ?? null);
    return orderRead(o);
  });

  // Ratings
  fastify.post('/:id/rating', { preHandler: requireRole('customer') }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const data = ratingCreateSchema.parse(req.body);
    const r = await submitRating(req.user!, id, data);
    reply.code(201);
    return ratingRead(r);
  });

  fastify.get('/:id/rating', { preHandler: requireAuth }, async (req) => {
    const { id } = idParam.parse(req.params);
    const r = await getRating(req.user!, id);
    return ratingRead(r);
  });

  fastify.post('/:id/rating/response', { preHandler: requireRole('driver') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const data = driverResponseSchema.parse(req.body);
    const r = await setDriverResponse(req.user!, id, data.response);
    return ratingRead(r);
  });

  fastify.delete('/:id/rating/response', { preHandler: requireRole('driver') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const r = await deleteDriverResponse(req.user!, id);
    return ratingRead(r);
  });
};
