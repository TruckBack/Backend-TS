import { describe, expect, it } from 'vitest';
import { authHeaders, getApp, registerCustomer } from './helpers.js';

describe('users', () => {
  it('GET /users/me returns the authenticated user', async () => {
    const app = await getApp();
    const u = await registerCustomer();
    const res = await app.inject({ method: 'GET', url: '/api/v1/users/me', headers: authHeaders(u) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: number; email: string; role: string };
    expect(body.id).toBe(u.id);
    expect(body.email).toBe(u.email);
    expect(body.role).toBe('customer');
  });

  it('GET /users/me without token returns 401', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/users/me' });
    expect(res.statusCode).toBe(401);
  });

  it('PATCH /users/me updates profile fields', async () => {
    const app = await getApp();
    const u = await registerCustomer();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: authHeaders(u),
      payload: { full_name: 'Updated Name', phone: '555-0001' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { full_name: string; phone: string };
    expect(body.full_name).toBe('Updated Name');
    expect(body.phone).toBe('555-0001');
  });

  it('GET /users/:userId returns a public profile', async () => {
    const app = await getApp();
    const u = await registerCustomer();
    const other = await registerCustomer();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${other.id}`,
      headers: authHeaders(u),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: number; full_name: string };
    expect(body.id).toBe(other.id);
    expect(body.full_name).toBeTruthy();
  });

  it('GET /users/:userId 404 for missing user', async () => {
    const app = await getApp();
    const u = await registerCustomer();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/999999',
      headers: authHeaders(u),
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /users/me without auth returns 401', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      payload: { full_name: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });
});
