import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
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

let listenAddr: { port: number } | null = null;

async function startListening(): Promise<{ port: number }> {
  if (listenAddr) return listenAddr;
  const app = await getApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  listenAddr = { port: addr.port };
  return listenAddr;
}

afterEach(() => {
  listenAddr = null;
});

async function setupOrder(c: TestUser, d: TestUser): Promise<number> {
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
  await app.inject({ method: 'POST', url: `/api/v1/orders/${id}/accept`, headers: authHeaders(d) });
  return id;
}

function waitForMessage(ws: WebSocket, timeoutMs = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for ws message')), timeoutMs);
    ws.once('message', (raw: WebSocket.RawData) => {
      clearTimeout(t);
      try {
        resolve(JSON.parse(String(raw)));
      } catch (e) {
        reject(e);
      }
    });
    ws.once('error', (e: Error) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function waitForClose(ws: WebSocket, timeoutMs = 3000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for close')), timeoutMs);
    ws.once('close', (code: number, reason: Buffer) => {
      clearTimeout(t);
      resolve({ code, reason: reason.toString() });
    });
    ws.once('error', () => {
      /* close usually follows */
    });
  });
}

function waitForOpen(ws: WebSocket, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for open')), timeoutMs);
    ws.once('open', () => {
      clearTimeout(t);
      resolve();
    });
    ws.once('error', (e: Error) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

describe('websocket', () => {
  it('rejects connection with bad token (1008)', async () => {
    const { port } = await startListening();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/ws/orders/1/track?token=bogus`);
    const close = await waitForClose(ws);
    expect(close.code).toBe(1008);
  });

  it('order track: location broadcast reaches customer', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    const orderId = await setupOrder(c, d);
    const { port } = await startListening();

    const wsCustomer = new WebSocket(
      `ws://127.0.0.1:${port}/api/v1/ws/orders/${orderId}/track?token=${c.access}`,
    );
    await waitForOpen(wsCustomer);
    // Confirm server-side subscription via ping/pong
    {
      const pong = waitForMessage(wsCustomer, 3000);
      wsCustomer.send(JSON.stringify({ type: 'ping' }));
      await pong;
    }

    const got = waitForMessage(wsCustomer, 5000);
    const { orderTrackManager } = await import('../src/services/wsManager.js');
    await orderTrackManager.publish(String(orderId), {
      type: 'location',
      driver_id: 1,
      order_id: orderId,
      lat: 32.1,
      lng: 34.7,
      at: new Date().toISOString(),
    });
    const msg = (await got) as { type: string; lat: number; lng: number };
    expect(msg.type).toBe('location');
    expect(msg.lat).toBe(32.1);
    expect(msg.lng).toBe(34.7);

    wsCustomer.close();
  });

  it('chat ws: ping/pong', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    const orderId = await setupOrder(c, d);
    const { port } = await startListening();
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/v1/chat/ws/${orderId}?token=${c.access}`,
    );
    await waitForOpen(ws);
    const got = waitForMessage(ws, 3000);
    ws.send(JSON.stringify({ type: 'ping' }));
    const msg = (await got) as { type: string };
    expect(msg.type).toBe('pong');
    ws.close();
  });

  it('chat ws: rejects non-participant with 1008', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    const stranger = await registerCustomer();
    const orderId = await setupOrder(c, d);
    const { port } = await startListening();
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/v1/chat/ws/${orderId}?token=${stranger.access}`,
    );
    const close = await waitForClose(ws, 3000);
    expect(close.code).toBe(1008);
  });
});
