import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireAuth, requireRole } from '../core/auth.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../core/errors.js';
import {
  deleteFileForUrl,
  saveOrderImage,
  saveProfileImage,
} from '../services/upload.js';
import { getDb } from '../db/index.js';
import { orders, users } from '../db/schema.js';
import { canViewOrder, getOrderById } from '../services/order.js';

interface UploadedPart {
  filename: string;
  mime: string;
  data: Buffer;
}

async function readFirstFile(req: FastifyRequest): Promise<UploadedPart> {
  // @fastify/multipart augments FastifyRequest with .file() at runtime; access via cast.
  const fileFn = (req as unknown as { file: () => Promise<unknown> }).file;
  const file = (await fileFn.call(req)) as
    | { filename?: string; mimetype?: string; toBuffer(): Promise<Buffer> }
    | undefined;
  if (!file) throw new BadRequestError('No file uploaded');
  const buf: Buffer = await file.toBuffer();
  return {
    filename: typeof file.filename === 'string' && file.filename ? file.filename : 'upload',
    mime: file.mimetype || 'application/octet-stream',
    data: buf,
  };
}

const orderIdParam = z.object({ orderId: z.coerce.number().int().positive() });

export const uploadRoutes: FastifyPluginAsync = async (fastify) => {
  // Profile image
  const handleProfileUpload = async (req: FastifyRequest) => {
    const file = await readFirstFile(req);
    const db = getDb();
    const user = req.user!;
    if (user.profileImageUrl) {
      await deleteFileForUrl(user.profileImageUrl);
    }
    const url = await saveProfileImage(user.id, file.filename, file.mime, file.data);
    await db.update(users).set({ profileImageUrl: url, updatedAt: new Date() }).where(eq(users.id, user.id));
    return { profile_image_url: url };
  };

  fastify.post('/image/profile', { preHandler: requireAuth }, handleProfileUpload);
  fastify.put('/image/profile', { preHandler: requireAuth }, handleProfileUpload);

  fastify.delete('/image/profile', { preHandler: requireAuth }, async (req, reply) => {
    const db = getDb();
    const user = req.user!;
    if (user.profileImageUrl) await deleteFileForUrl(user.profileImageUrl);
    await db.update(users).set({ profileImageUrl: null, updatedAt: new Date() }).where(eq(users.id, user.id));
    reply.code(204);
    return null;
  });

  fastify.get('/image/profile', { preHandler: requireAuth }, async (req) => {
    return { profile_image_url: req.user!.profileImageUrl };
  });

  fastify.get('/image/profile/:userId', { preHandler: requireAuth }, async (req) => {
    const { userId } = z.object({ userId: z.coerce.number().int().positive() }).parse(req.params);
    const db = getDb();
    const u = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    if (!u) throw new NotFoundError('User not found');
    return { profile_image_url: u.profileImageUrl };
  });

  // Order cargo image
  const handleOrderUpload = async (req: FastifyRequest) => {
    const { orderId } = orderIdParam.parse(req.params);
    const o = await getOrderById(orderId);
    const u = req.user!;
    if (u.role !== 'admin' && o.customerId !== u.id) throw new ForbiddenError('Not your order');
    const file = await readFirstFile(req);
    if (o.cargoImageUrl) await deleteFileForUrl(o.cargoImageUrl);
    const url = await saveOrderImage(orderId, file.filename, file.mime, file.data);
    const db = getDb();
    await db.update(orders).set({ cargoImageUrl: url, updatedAt: new Date() }).where(eq(orders.id, orderId));
    return { cargo_image_url: url };
  };

  fastify.post('/image/order/:orderId', { preHandler: requireRole('customer', 'admin') }, handleOrderUpload);
  fastify.put('/image/order/:orderId', { preHandler: requireRole('customer', 'admin') }, handleOrderUpload);

  fastify.delete(
    '/image/order/:orderId',
    { preHandler: requireRole('customer', 'admin') },
    async (req, reply) => {
      const { orderId } = orderIdParam.parse(req.params);
      const o = await getOrderById(orderId);
      const u = req.user!;
      if (u.role !== 'admin' && o.customerId !== u.id) throw new ForbiddenError('Not your order');
      if (o.cargoImageUrl) await deleteFileForUrl(o.cargoImageUrl);
      const db = getDb();
      await db.update(orders).set({ cargoImageUrl: null, updatedAt: new Date() }).where(eq(orders.id, orderId));
      reply.code(204);
      return null;
    }
  );

  fastify.get('/image/order/:orderId', { preHandler: requireAuth }, async (req) => {
    const { orderId } = orderIdParam.parse(req.params);
    const o = await getOrderById(orderId);
    if (!(await canViewOrder(req.user!, o))) throw new ForbiddenError('Cannot view this order');
    return { cargo_image_url: o.cargoImageUrl };
  });
};
