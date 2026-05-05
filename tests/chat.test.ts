import { describe, expect, it } from 'vitest';
import { authHeaders, getApp, registerCustomer, registerDriver } from './helpers.js';
import type { TestUser } from './helpers.js';

const PAYLOAD = {
  pickup_address: 'A',
  pickup_lat: 0,
  pickup_lng: 0,
  dropoff_address: 'B',
  dropoff_lat: 1,
  dropoff_lng: 1,
  price_cents: 1000,
  currency: 'USD',
};

async function createAccepted(c: TestUser, d: TestUser): Promise<number> {
  const app = await getApp();
  await app.inject({
    method: 'PUT',
    url: '/api/v1/drivers/me/status',
    headers: authHeaders(d),
    payload: { status: 'available' },
  });
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/orders/',
    headers: authHeaders(c),
    payload: PAYLOAD,
  });
  const id = (create.json() as { id: number }).id;
  await app.inject({
    method: 'POST',
    url: `/api/v1/orders/${id}/accept`,
    headers: authHeaders(d),
  });
  return id;
}

describe('chat', () => {
  it('lazy creates conversation when sending first message', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    const orderId = await createAccepted(c, d);
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/chat/conversations/${orderId}/messages`,
      headers: authHeaders(c),
      payload: { body: 'Hello driver' },
    });
    expect(res.statusCode).toBe(201);
    const msg = res.json() as { body: string; sender_id: number; is_read: boolean };
    expect(msg.body).toBe('Hello driver');
    expect(msg.sender_id).toBe(c.id);
    expect(typeof msg.is_read).toBe('boolean');
  });

  it('lists conversations with last_message and unread_count', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    const orderId = await createAccepted(c, d);
    const app = await getApp();
    await app.inject({
      method: 'POST',
      url: `/api/v1/chat/conversations/${orderId}/messages`,
      headers: authHeaders(c),
      payload: { body: 'm1' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/chat/conversations/${orderId}/messages`,
      headers: authHeaders(c),
      payload: { body: 'm2' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/chat/conversations',
      headers: authHeaders(d),
    });
    expect(res.statusCode).toBe(200);
    const convos = res.json() as Array<{ unread_count: number; last_message: { body: string } | null }>;
    expect(convos.length).toBe(1);
    expect(convos[0]!.unread_count).toBe(2);
    expect(convos[0]!.last_message?.body).toBe('m2');
  });

  it('mark read clears unread count', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    const orderId = await createAccepted(c, d);
    const app = await getApp();
    await app.inject({
      method: 'POST',
      url: `/api/v1/chat/conversations/${orderId}/messages`,
      headers: authHeaders(c),
      payload: { body: 'hi' },
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/chat/conversations/${orderId}/read`,
      headers: authHeaders(d),
    });
    expect(r.statusCode).toBe(200);
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/chat/conversations',
      headers: authHeaders(d),
    });
    const convos = list.json() as Array<{ unread_count: number }>;
    expect(convos[0]!.unread_count).toBe(0);
  });

  it('detail endpoint returns messages with is_read flags', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    const orderId = await createAccepted(c, d);
    const app = await getApp();
    await app.inject({
      method: 'POST',
      url: `/api/v1/chat/conversations/${orderId}/messages`,
      headers: authHeaders(c),
      payload: { body: 'hi' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/chat/conversations/${orderId}/read`,
      headers: authHeaders(d),
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/chat/conversations/${orderId}`,
      headers: authHeaders(c),
    });
    expect(res.statusCode).toBe(200);
    const detail = res.json() as { messages: Array<{ body: string; is_read: boolean }> };
    expect(detail.messages.length).toBe(1);
    expect(detail.messages[0]!.is_read).toBe(true);
  });

  it('non-participant cannot send or read', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    const stranger = await registerCustomer();
    const orderId = await createAccepted(c, d);
    const app = await getApp();
    const send = await app.inject({
      method: 'POST',
      url: `/api/v1/chat/conversations/${orderId}/messages`,
      headers: authHeaders(stranger),
      payload: { body: 'hack' },
    });
    expect(send.statusCode).toBe(403);
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/chat/conversations/${orderId}`,
      headers: authHeaders(stranger),
    });
    expect(read.statusCode).toBe(403);
  });

  it('rejects empty or oversized message bodies', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    const orderId = await createAccepted(c, d);
    const app = await getApp();
    const empty = await app.inject({
      method: 'POST',
      url: `/api/v1/chat/conversations/${orderId}/messages`,
      headers: authHeaders(c),
      payload: { body: '' },
    });
    expect(empty.statusCode).toBe(422);
    const huge = await app.inject({
      method: 'POST',
      url: `/api/v1/chat/conversations/${orderId}/messages`,
      headers: authHeaders(c),
      payload: { body: 'x'.repeat(5000) },
    });
    expect(huge.statusCode).toBe(422);
  });
});
