import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { authenticateWsToken } from '../core/auth.js';
import { ForbiddenError, UnauthorizedError } from '../core/errors.js';
import { canViewOrder, getOrderById } from '../services/order.js';
import { orderTrackManager } from '../services/wsManager.js';
import { getDb } from '../db/index.js';
import { drivers } from '../db/schema.js';

const orderIdParam = z.object({ orderId: z.coerce.number().int().positive() });

const locationMsgSchema = z.object({
  type: z.literal('location'),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const wsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/orders/:orderId/track', { websocket: true }, async (socket, req: FastifyRequest) => {
    try {
      const { orderId } = orderIdParam.parse(req.params);
      const token = (req.query as { token?: string }).token;
      const user = await authenticateWsToken(token);
      const order = await getOrderById(orderId);
      if (!(await canViewOrder(user, order))) throw new ForbiddenError('Cannot view this order');
      await orderTrackManager.connect(String(orderId), socket as unknown as WebSocket);

      socket.on('message', async (raw) => {
        let data: unknown;
        try {
          data = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (typeof data === 'object' && data !== null && (data as { type?: string }).type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        const parsed = locationMsgSchema.safeParse(data);
        if (!parsed.success) return;
        if (user.role !== 'driver') return;
        // Persist driver location
        const db = getDb();
        const driver = (await db.select().from(drivers).where(eq(drivers.userId, user.id)).limit(1))[0];
        if (!driver) return;
        await db
          .update(drivers)
          .set({
            currentLat: parsed.data.lat,
            currentLng: parsed.data.lng,
            lastLocationAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(drivers.id, driver.id));
        await orderTrackManager.publish(String(orderId), {
          type: 'location',
          driver_id: driver.id,
          order_id: orderId,
          lat: parsed.data.lat,
          lng: parsed.data.lng,
          at: new Date().toISOString(),
        });
      });

      socket.on('close', () => {
        void orderTrackManager.disconnect(String(orderId), socket as unknown as WebSocket);
      });
    } catch (e) {
      if (e instanceof UnauthorizedError || e instanceof ForbiddenError) {
        socket.close(1008, e.message);
      } else {
        socket.close(1011, 'internal error');
      }
    }
  });
};
