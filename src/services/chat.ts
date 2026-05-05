import { z } from 'zod';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  chatConversations,
  chatMessages,
  messageReadStatuses,
  orders,
  users,
  type ChatMessage,
  type User,
} from '../db/schema.js';
import { ForbiddenError, NotFoundError } from '../core/errors.js';
import { getDriverByUserId } from './order.js';
import { chatManager } from './wsManager.js';

export const sendMessageSchema = z.object({
  body: z.string().min(1).max(4000),
});

export type ChatMessageDto = {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender: { id: number; full_name: string };
  body: string;
  created_at: Date;
  is_read: boolean;
};

async function ensureParticipant(user: User, orderId: number): Promise<{ orderId: number }> {
  const db = getDb();
  const o = (await db.select().from(orders).where(eq(orders.id, orderId)).limit(1))[0];
  if (!o) throw new NotFoundError('Order not found');
  if (user.role === 'admin') return { orderId };
  if (user.role === 'customer') {
    if (o.customerId !== user.id) throw new ForbiddenError('Not your order');
    return { orderId };
  }
  if (user.role === 'driver') {
    const driver = await getDriverByUserId(user.id).catch(() => null);
    if (!driver || o.driverId !== driver.id) throw new ForbiddenError('Not your assigned order');
    return { orderId };
  }
  throw new ForbiddenError('Forbidden');
}

async function getOrCreateConversation(orderId: number) {
  const db = getDb();
  const existing = (
    await db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.orderId, orderId))
      .limit(1)
  )[0];
  if (existing) return existing;
  const created = (
    await db.insert(chatConversations).values({ orderId }).returning()
  )[0]!;
  return created;
}

function dtoFromMessage(
  msg: ChatMessage,
  sender: { id: number; fullName: string },
  isRead: boolean
): ChatMessageDto {
  return {
    id: msg.id,
    conversation_id: msg.conversationId,
    sender_id: msg.senderId,
    sender: { id: sender.id, full_name: sender.fullName },
    body: msg.body,
    created_at: msg.createdAt,
    is_read: isRead,
  };
}

export async function sendMessage(user: User, orderId: number, body: string): Promise<ChatMessageDto> {
  const db = getDb();
  await ensureParticipant(user, orderId);
  const conv = await getOrCreateConversation(orderId);
  const inserted = (
    await db.insert(chatMessages).values({ conversationId: conv.id, senderId: user.id, body }).returning()
  )[0]!;
  await db.update(chatConversations).set({ updatedAt: new Date() }).where(eq(chatConversations.id, conv.id));
  const dto = dtoFromMessage(inserted, { id: user.id, fullName: user.fullName }, true);
  await chatManager.publish(String(orderId), {
    event_type: 'new_message',
    payload: { message: dto },
  });
  return dto;
}

export async function listConversations(user: User) {
  const db = getDb();
  // Pull conversations where user has access
  let convs;
  if (user.role === 'admin') {
    convs = await db
      .select({
        id: chatConversations.id,
        orderId: chatConversations.orderId,
        createdAt: chatConversations.createdAt,
        updatedAt: chatConversations.updatedAt,
      })
      .from(chatConversations);
  } else if (user.role === 'customer') {
    convs = await db
      .select({
        id: chatConversations.id,
        orderId: chatConversations.orderId,
        createdAt: chatConversations.createdAt,
        updatedAt: chatConversations.updatedAt,
      })
      .from(chatConversations)
      .innerJoin(orders, eq(orders.id, chatConversations.orderId))
      .where(eq(orders.customerId, user.id));
  } else {
    const driver = await getDriverByUserId(user.id).catch(() => null);
    if (!driver) return [];
    convs = await db
      .select({
        id: chatConversations.id,
        orderId: chatConversations.orderId,
        createdAt: chatConversations.createdAt,
        updatedAt: chatConversations.updatedAt,
      })
      .from(chatConversations)
      .innerJoin(orders, eq(orders.id, chatConversations.orderId))
      .where(eq(orders.driverId, driver.id));
  }
  const result = [];
  for (const c of convs) {
    const last = (
      await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, c.id))
        .orderBy(desc(chatMessages.createdAt))
        .limit(1)
    )[0];
    let lastDto: ChatMessageDto | null = null;
    if (last) {
      const sender = (await db.select().from(users).where(eq(users.id, last.senderId)).limit(1))[0]!;
      const isRead =
        last.senderId === user.id ||
        (
          await db
            .select()
            .from(messageReadStatuses)
            .where(
              and(eq(messageReadStatuses.messageId, last.id), eq(messageReadStatuses.userId, user.id))
            )
            .limit(1)
        ).length > 0;
      lastDto = dtoFromMessage(last, sender, isRead);
    }
    // unread = messages in conversation not sent by user and not in messageReadStatuses for user
    const unreadRows = await db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .leftJoin(
        messageReadStatuses,
        and(
          eq(messageReadStatuses.messageId, chatMessages.id),
          eq(messageReadStatuses.userId, user.id)
        )
      )
      .where(
        and(eq(chatMessages.conversationId, c.id), sql`${chatMessages.senderId} <> ${user.id}`, isNull(messageReadStatuses.id))
      );
    result.push({
      id: c.id,
      order_id: c.orderId,
      last_message: lastDto,
      unread_count: unreadRows.length,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    });
  }
  return result;
}

export async function getConversationDetail(user: User, orderId: number) {
  const db = getDb();
  await ensureParticipant(user, orderId);
  const conv = await getOrCreateConversation(orderId);
  const msgs = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conv.id))
    .orderBy(asc(chatMessages.createdAt));

  const senderIds = Array.from(new Set(msgs.map((m) => m.senderId)));
  const senderRows = senderIds.length
    ? await db.select().from(users).where(inArray(users.id, senderIds))
    : [];
  const senderMap = new Map<number, { id: number; fullName: string }>();
  for (const s of senderRows) senderMap.set(s.id, { id: s.id, fullName: s.fullName });

  const readsForUser = msgs.length
    ? await db
        .select({ messageId: messageReadStatuses.messageId })
        .from(messageReadStatuses)
        .where(
          and(
            eq(messageReadStatuses.userId, user.id),
            inArray(
              messageReadStatuses.messageId,
              msgs.map((m) => m.id)
            )
          )
        )
    : [];
  const readSet = new Set(readsForUser.map((r) => r.messageId));

  const messages = msgs.map((m) =>
    dtoFromMessage(m, senderMap.get(m.senderId)!, m.senderId === user.id || readSet.has(m.id))
  );
  return {
    id: conv.id,
    order_id: conv.orderId,
    messages,
    created_at: conv.createdAt,
    updated_at: conv.updatedAt,
  };
}

export async function markRead(user: User, orderId: number) {
  const db = getDb();
  await ensureParticipant(user, orderId);
  const conv = await getOrCreateConversation(orderId);
  // Find unread (not own, not yet recorded)
  const unread = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .leftJoin(
      messageReadStatuses,
      and(
        eq(messageReadStatuses.messageId, chatMessages.id),
        eq(messageReadStatuses.userId, user.id)
      )
    )
    .where(
      and(
        eq(chatMessages.conversationId, conv.id),
        sql`${chatMessages.senderId} <> ${user.id}`,
        isNull(messageReadStatuses.id)
      )
    );
  const ids = unread.map((u) => u.id);
  if (ids.length > 0) {
    await db
      .insert(messageReadStatuses)
      .values(ids.map((mid) => ({ messageId: mid, userId: user.id })));
  }
  await chatManager.publish(String(orderId), {
    event_type: 'messages_read',
    payload: { conversation_id: conv.id, read_by_user_id: user.id, message_ids: ids },
  });
  return { marked_count: ids.length, message_ids: ids };
}

export async function ensureChatParticipantPublic(user: User, orderId: number): Promise<void> {
  await ensureParticipant(user, orderId);
}
