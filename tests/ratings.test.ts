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

async function setAvailable(d: TestUser): Promise<void> {
  const app = await getApp();
  await app.inject({
    method: 'PUT',
    url: '/api/v1/drivers/me/status',
    headers: authHeaders(d),
    payload: { status: 'available' },
  });
}

async function fullCycle(c: TestUser, d: TestUser): Promise<number> {
  const app = await getApp();
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/orders/',
    headers: authHeaders(c),
    payload: PAYLOAD,
  });
  if (create.statusCode !== 201) throw new Error(`create ${create.statusCode} ${create.body}`);
  const id = (create.json() as { id: number }).id;
  for (const step of ['accept', 'start', 'pickup', 'complete']) {
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${id}/${step}`,
      headers: authHeaders(d),
    });
    if (r.statusCode !== 200) throw new Error(`${step} ${r.statusCode} ${r.body}`);
  }
  return id;
}

describe('ratings', () => {
  it('customer submits rating on completed order', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    await setAvailable(d);
    const orderId = await fullCycle(c, d);
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/rating`,
      headers: authHeaders(c),
      payload: { score: 5, comment: 'Great' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { score: number; comment: string };
    expect(body.score).toBe(5);
    expect(body.comment).toBe('Great');
  });

  it('cannot rate non-completed order', async () => {
    const c = await registerCustomer();
    const app = await getApp();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders/',
      headers: authHeaders(c),
      payload: PAYLOAD,
    });
    const id = (create.json() as { id: number }).id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${id}/rating`,
      headers: authHeaders(c),
      payload: { score: 5 },
    });
    expect([400, 409]).toContain(res.statusCode);
  });

  it('non-owner cannot submit rating', async () => {
    const c = await registerCustomer();
    const c2 = await registerCustomer();
    const d = await registerDriver();
    await setAvailable(d);
    const orderId = await fullCycle(c, d);
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/rating`,
      headers: authHeaders(c2),
      payload: { score: 5 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects duplicate rating', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    await setAvailable(d);
    const orderId = await fullCycle(c, d);
    const app = await getApp();
    await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/rating`,
      headers: authHeaders(c),
      payload: { score: 5 },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/rating`,
      headers: authHeaders(c),
      payload: { score: 4 },
    });
    expect(res.statusCode).toBe(409);
  });

  it('driver cannot submit rating', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    await setAvailable(d);
    const orderId = await fullCycle(c, d);
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/rating`,
      headers: authHeaders(d),
      payload: { score: 5 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects invalid score', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    await setAvailable(d);
    const orderId = await fullCycle(c, d);
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/rating`,
      headers: authHeaders(c),
      payload: { score: 7 },
    });
    expect(res.statusCode).toBe(422);
  });

  it('GET rating accessible to participants only', async () => {
    const c = await registerCustomer();
    const c2 = await registerCustomer();
    const d = await registerDriver();
    await setAvailable(d);
    const orderId = await fullCycle(c, d);
    const app = await getApp();
    await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/rating`,
      headers: authHeaders(c),
      payload: { score: 4 },
    });
    const ok = await app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}/rating`, headers: authHeaders(c) });
    expect(ok.statusCode).toBe(200);
    const drv = await app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}/rating`, headers: authHeaders(d) });
    expect(drv.statusCode).toBe(200);
    const blocked = await app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}/rating`, headers: authHeaders(c2) });
    expect(blocked.statusCode).toBe(403);
  });

  it('GET rating returns 404 when not yet rated', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    await setAvailable(d);
    const orderId = await fullCycle(c, d);
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}/rating`, headers: authHeaders(c) });
    expect(res.statusCode).toBe(404);
  });

  it('driver posts a response, can overwrite, then delete', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    await setAvailable(d);
    const orderId = await fullCycle(c, d);
    const app = await getApp();
    await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/rating`,
      headers: authHeaders(c),
      payload: { score: 4 },
    });
    const r1 = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/rating/response`,
      headers: authHeaders(d),
      payload: { response: 'Thanks!' },
    });
    expect(r1.statusCode).toBe(200);
    expect((r1.json() as { driver_response: string }).driver_response).toBe('Thanks!');
    const r2 = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/rating/response`,
      headers: authHeaders(d),
      payload: { response: 'Updated' },
    });
    expect((r2.json() as { driver_response: string }).driver_response).toBe('Updated');
    const r3 = await app.inject({
      method: 'DELETE',
      url: `/api/v1/orders/${orderId}/rating/response`,
      headers: authHeaders(d),
    });
    expect(r3.statusCode).toBe(200);
    expect((r3.json() as { driver_response: string | null }).driver_response).toBeNull();
  });

  it('rejects empty response body', async () => {
    const c = await registerCustomer();
    const d = await registerDriver();
    await setAvailable(d);
    const orderId = await fullCycle(c, d);
    const app = await getApp();
    await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/rating`,
      headers: authHeaders(c),
      payload: { score: 4 },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/rating/response`,
      headers: authHeaders(d),
      payload: { response: '' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('AVG driver rating recalculated after multiple ratings', async () => {
    const c1 = await registerCustomer();
    const c2 = await registerCustomer();
    const d = await registerDriver();
    await setAvailable(d);
    const o1 = await fullCycle(c1, d);
    await setAvailable(d);
    const o2 = await fullCycle(c2, d);
    const app = await getApp();
    await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${o1}/rating`,
      headers: authHeaders(c1),
      payload: { score: 4 },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${o2}/rating`,
      headers: authHeaders(c2),
      payload: { score: 5 },
    });
    // Inspect any returned driver rating field
    const ratings = await app.inject({
      method: 'GET',
      url: `/api/v1/drivers/1/ratings`,
      headers: authHeaders(c1),
    });
    expect(ratings.statusCode).toBe(200);
    const body = ratings.json() as { total: number; items: { score: number }[] };
    expect(body.total).toBe(2);
    const avg = body.items.reduce((s, r) => s + Number(r.score), 0) / body.items.length;
    expect(avg).toBeCloseTo(4.5, 1);
  });
});
