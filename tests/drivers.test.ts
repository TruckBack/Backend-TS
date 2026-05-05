import { describe, expect, it } from 'vitest';
import { authHeaders, getApp, registerCustomer, registerDriver } from './helpers.js';

describe('drivers', () => {
  it('PUT /drivers/me/profile updates vehicle fields', async () => {
    const app = await getApp();
    const u = await registerDriver();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/drivers/me/profile',
      headers: authHeaders(u),
      payload: { vehicle_type: 'van', vehicle_plate: 'XYZ-9', vehicle_capacity_kg: 2000 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { vehicle_type: string; vehicle_capacity_kg: number };
    expect(body.vehicle_type).toBe('van');
    expect(Number(body.vehicle_capacity_kg)).toBe(2000);
  });

  it('PUT /drivers/me/status accepts offline and available transitions', async () => {
    const app = await getApp();
    const u = await registerDriver();
    const r1 = await app.inject({
      method: 'PUT',
      url: '/api/v1/drivers/me/status',
      headers: authHeaders(u),
      payload: { status: 'available' },
    });
    expect(r1.statusCode).toBe(200);
    expect((r1.json() as { status: string }).status).toBe('available');
    const r2 = await app.inject({
      method: 'PUT',
      url: '/api/v1/drivers/me/status',
      headers: authHeaders(u),
      payload: { status: 'offline' },
    });
    expect(r2.statusCode).toBe(200);
  });

  it('PUT /drivers/me/status rejects setting busy directly', async () => {
    const app = await getApp();
    const u = await registerDriver();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/drivers/me/status',
      headers: authHeaders(u),
      payload: { status: 'busy' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /drivers/me/location persists coordinates', async () => {
    const app = await getApp();
    const u = await registerDriver();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/drivers/me/location',
      headers: authHeaders(u),
      payload: { lat: 32.0853, lng: 34.7818 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { current_lat: string | number; current_lng: string | number };
    expect(Number(body.current_lat)).toBeCloseTo(32.0853, 2);
    expect(Number(body.current_lng)).toBeCloseTo(34.7818, 2);
  });

  it('POST /drivers/me/location rejects out-of-range values', async () => {
    const app = await getApp();
    const u = await registerDriver();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/drivers/me/location',
      headers: authHeaders(u),
      payload: { lat: 999, lng: 0 },
    });
    expect(res.statusCode).toBe(422);
  });

  it('PUT /drivers/me/profile rejected for customer', async () => {
    const app = await getApp();
    const u = await registerCustomer();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/drivers/me/profile',
      headers: authHeaders(u),
      payload: { vehicle_type: 'van' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /drivers/:id/ratings returns paginated empty list', async () => {
    const app = await getApp();
    const u = await registerCustomer();
    const drv = await registerDriver();
    // Lookup driver row id via /drivers/me — but customer-side we don't have it.
    // Use ratings endpoint with driver row id 1 (first driver in fresh db).
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/drivers/1/ratings`,
      headers: authHeaders(u),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; total: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.total).toBe(0);
    expect(drv.id).toBeGreaterThan(0);
  });
});
