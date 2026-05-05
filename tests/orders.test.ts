import { describe, expect, it } from 'vitest';
import { authHeaders, getApp, registerCustomer, registerDriver } from './helpers.js';
import type { TestUser } from './helpers.js';

const ORDER_PAYLOAD = {
  pickup_address: '1 Pickup St',
  pickup_lat: 32.0,
  pickup_lng: 34.7,
  dropoff_address: '2 Drop St',
  dropoff_lat: 32.1,
  dropoff_lng: 34.8,
  cargo_description: 'boxes',
  cargo_weight_kg: 50,
  price_cents: 5000,
  currency: 'USD',
};

async function createOrder(customer: TestUser): Promise<number> {
  const app = await getApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orders/',
    headers: authHeaders(customer),
    payload: ORDER_PAYLOAD,
  });
  if (res.statusCode !== 201) throw new Error(`createOrder ${res.statusCode} ${res.body}`);
  return (res.json() as { id: number }).id;
}

async function setAvailable(driver: TestUser): Promise<void> {
  const app = await getApp();
  const r = await app.inject({
    method: 'PUT',
    url: '/api/v1/drivers/me/status',
    headers: authHeaders(driver),
    payload: { status: 'available' },
  });
  if (r.statusCode !== 200) throw new Error(`status ${r.statusCode} ${r.body}`);
}

describe('orders', () => {
  it('customer creates an order (status=pending)', async () => {
    const c = await registerCustomer();
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders/',
      headers: authHeaders(c),
      payload: ORDER_PAYLOAD,
    });
    expect(res.statusCode).toBe(201);
    const o = res.json() as { id: number; status: string; customer_id: number };
    expect(o.status).toBe('pending');
    expect(o.customer_id).toBe(c.id);
  });

  it('only customers may create orders', async () => {
    const d = await registerDriver();
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders/',
      headers: authHeaders(d),
      payload: ORDER_PAYLOAD,
    });
    expect(res.statusCode).toBe(403);
  });

  it('full lifecycle: accept → start → pickup → complete', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    await setAvailable(d);
    const orderId = await createOrder(c);
    const app = await getApp();

    const accept = await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/accept`, headers: authHeaders(d) });
    expect(accept.statusCode).toBe(200);
    expect((accept.json() as { status: string }).status).toBe('accepted');

    const start = await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/start`, headers: authHeaders(d) });
    expect(start.statusCode).toBe(200);
    expect((start.json() as { status: string }).status).toBe('in_progress');

    const pickup = await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/pickup`, headers: authHeaders(d) });
    expect(pickup.statusCode).toBe(200);
    expect((pickup.json() as { status: string }).status).toBe('picked_up');

    const complete = await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/complete`, headers: authHeaders(d) });
    expect(complete.statusCode).toBe(200);
    expect((complete.json() as { status: string }).status).toBe('completed');
  });

  it('only one of two drivers wins the race for accept', async () => {
    const c = await registerCustomer();
    const d1 = await registerDriver();
    const d2 = await registerDriver();
    await setAvailable(d1);
    await setAvailable(d2);
    const orderId = await createOrder(c);
    const app = await getApp();

    const [r1, r2] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/accept`, headers: authHeaders(d1) }),
      app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/accept`, headers: authHeaders(d2) }),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([200, 409]);
  });

  it('accept rejected when driver is not available', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    // driver still offline (default)
    const orderId = await createOrder(c);
    const app = await getApp();
    const res = await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/accept`, headers: authHeaders(d) });
    expect([400, 409]).toContain(res.statusCode);
  });

  it('customer can cancel own pending order', async () => {
    const c = await registerCustomer();
    const orderId = await createOrder(c);
    const app = await getApp();
    const res = await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/cancel`, headers: authHeaders(c) });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('cancelled');
  });

  it('PATCH /orders/:id only when pending', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    await setAvailable(d);
    const orderId = await createOrder(c);
    const app = await getApp();
    const ok = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${orderId}`,
      headers: authHeaders(c),
      payload: { notes: 'fragile' },
    });
    expect(ok.statusCode).toBe(200);

    await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/accept`, headers: authHeaders(d) });

    const blocked = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${orderId}`,
      headers: authHeaders(c),
      payload: { notes: 'too late' },
    });
    expect([400, 409]).toContain(blocked.statusCode);
  });

  it('DELETE /orders/:id only when pending', async () => {
    const c = await registerCustomer();
    const orderId = await createOrder(c);
    const app = await getApp();
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/orders/${orderId}`, headers: authHeaders(c) });
    expect(res.statusCode).toBe(204);
  });

  it('GET /orders/me/active returns active orders for customer', async () => {
    const c = await registerCustomer();
    await createOrder(c);
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/orders/me/active', headers: authHeaders(c) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as unknown[];
    expect(body.length).toBe(1);
  });

  it('GET /orders/history paginates', async () => {
    const c = await registerCustomer();
    for (let i = 0; i < 3; i += 1) await createOrder(c);
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/orders/history?limit=2&offset=0', headers: authHeaders(c) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; total: number; limit: number; offset: number };
    expect(body.total).toBe(3);
    expect(body.items.length).toBe(2);
  });

  it('GET /orders/:id 403 for non-participant customer', async () => {
    const c1 = await registerCustomer();
    const c2 = await registerCustomer();
    const orderId = await createOrder(c1);
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, headers: authHeaders(c2) });
    expect(res.statusCode).toBe(403);
  });

  it('GET /orders/available lists pending orders for drivers', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    await createOrder(c);
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/orders/available', headers: authHeaders(d) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[] };
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });
});
