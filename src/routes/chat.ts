import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { requireAuth, authenticateWsToken } from '../core/auth.js';
import { ForbiddenError, UnauthorizedError } from '../core/errors.js';
import {
  ensureChatParticipantPublic,
  getConversationDetail,
  listConversations,
  markRead,
  sendMessage,
  sendMessageSchema,
} from '../services/chat.js';
import { chatManager } from '../services/wsManager.js';

const orderIdParam = z.object({ orderId: z.coerce.number().int().positive() });

export const chatRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/conversations', { preHandler: requireAuth }, async (req) => {
    return listConversations(req.user!);
  });

  fastify.get('/conversations/:orderId', { preHandler: requireAuth }, async (req) => {
    const { orderId } = orderIdParam.parse(req.params);
    return getConversationDetail(req.user!, orderId);
  });

  fastify.post('/conversations/:orderId/messages', { preHandler: requireAuth }, async (req, reply) => {
    const { orderId } = orderIdParam.parse(req.params);
    const data = sendMessageSchema.parse(req.body);
    const msg = await sendMessage(req.user!, orderId, data.body);
    reply.code(201);
    return msg;
  });

  fastify.post('/conversations/:orderId/read', { preHandler: requireAuth }, async (req) => {
    const { orderId } = orderIdParam.parse(req.params);
    return markRead(req.user!, orderId);
  });

  // Chat WebSocket
  fastify.get('/ws/:orderId', { websocket: true }, async (socket, req: FastifyRequest) => {
    try {
      const { orderId } = orderIdParam.parse(req.params);
      const token = (req.query as { token?: string }).token;
      const user = await authenticateWsToken(token);
      await ensureChatParticipantPublic(user, orderId);
      await chatManager.connect(String(orderId), socket as unknown as WebSocket);
      socket.on('message', (raw) => {
        try {
          const data = JSON.parse(String(raw)) as { type?: string };
          if (data.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
        } catch {
          /* ignore non-JSON */
        }
      });
      socket.on('close', () => {
        void chatManager.disconnect(String(orderId), socket as unknown as WebSocket);
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
