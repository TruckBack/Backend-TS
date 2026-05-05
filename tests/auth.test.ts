import { describe, expect, it } from 'vitest';
import { getApp, mkEmail, registerCustomer, registerDriver } from './helpers.js';

describe('auth', () => {
  it('registers a customer', async () => {
    const app = await getApp();
    const email = mkEmail('alice');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/customer',
      payload: { email, password: 'password123', full_name: 'Alice' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: number; email: string; role: string };
    expect(body.email).toBe(email);
    expect(body.role).toBe('customer');
  });

  it('rejects duplicate email', async () => {
    const app = await getApp();
    const payload = { email: mkEmail('dup'), password: 'password123', full_name: 'Bob' };
    const r1 = await app.inject({ method: 'POST', url: '/api/v1/auth/register/customer', payload });
    expect(r1.statusCode).toBe(201);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register/customer', payload });
    if (res.statusCode !== 409) throw new Error(`status=${res.statusCode} body=${res.body}`);
    const body = res.json() as Record<string, unknown>;
    if (!body.error || typeof body.error === 'string') throw new Error(`body=${JSON.stringify(body)}`);
    expect((body as { error: { code: string } }).error.code).toBe('conflict');
  });

  it('registers a driver and exposes role via /me', async () => {
    const u = await registerDriver();
    const app = await getApp();
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${u.access}` },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { role: string }).role).toBe('driver');
  });

  it('rejects duplicate license number', async () => {
    const app = await getApp();
    const lic = 'SAME-LIC-123';
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/driver',
      payload: {
        email: mkEmail('drv1'),
        password: 'password123',
        full_name: 'D1',
        license_number: lic,
        vehicle_type: 'truck',
        vehicle_plate: 'P1',
      },
    });
    expect(r1.statusCode).toBe(201);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/driver',
      payload: {
        email: mkEmail('drv2'),
        password: 'password123',
        full_name: 'D2',
        license_number: lic,
        vehicle_type: 'truck',
        vehicle_plate: 'P2',
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it('login returns access and refresh tokens', async () => {
    const u = await registerCustomer();
    expect(u.access.length).toBeGreaterThan(20);
    expect(u.refresh.length).toBeGreaterThan(20);
    expect(u.access).not.toBe(u.refresh);
  });

  it('rejects login with wrong password', async () => {
    const app = await getApp();
    const email = mkEmail('wp');
    await registerCustomer({ email });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/json',
      payload: { email, password: 'WRONG', role: 'customer' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects login when role mismatches user role', async () => {
    const app = await getApp();
    const email = mkEmail('wr');
    await registerCustomer({ email });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/json',
      payload: { email, password: 'password123', role: 'driver' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refresh returns new tokens', async () => {
    const app = await getApp();
    const u = await registerCustomer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refresh_token: u.refresh },
    });
    expect(res.statusCode).toBe(200);
    const t = res.json() as { access_token: string; refresh_token: string };
    expect(t.access_token).toBeTruthy();
    expect(t.refresh_token).toBeTruthy();
  });

  it('rejects refresh when given an access token', async () => {
    const app = await getApp();
    const u = await registerCustomer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refresh_token: u.access },
    });
    expect(res.statusCode).toBe(401);
  });

  it('Google id_token login auto-creates customer', async () => {
    const app = await getApp();
    const id_token = `google:goog-1:${mkEmail('goog')}:Goog User`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { id_token, role: 'customer' },
    });
    expect(res.statusCode).toBe(200);
    const t = res.json() as { access_token: string };
    expect(t.access_token).toBeTruthy();
  });

  it('Google callback returns tokens', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/google/callback?code=abc&state=customer',
    });
    expect(res.statusCode).toBe(200);
    const t = res.json() as { access_token: string };
    expect(t.access_token).toBeTruthy();
  });
});
