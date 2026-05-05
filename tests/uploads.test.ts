import { describe, expect, it } from 'vitest';
import { authHeaders, getApp, registerCustomer } from './helpers.js';
import type { TestUser } from './helpers.js';

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108020000009077533d000000017352474200aece1ce90000000d49444154789c63f8cf0000000005010102cdb45c00000000049454e44ae426082',
  'hex',
);

function buildMultipart(field: string, filename: string, mime: string, data: Buffer): { headers: Record<string, string>; payload: Buffer } {
  const boundary = '----TestBoundary' + Math.random().toString(36).slice(2, 10);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, data, tail]),
  };
}

async function createOrder(c: TestUser): Promise<number> {
  const app = await getApp();
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/orders/',
    headers: authHeaders(c),
    payload: {
      pickup_address: 'A',
      pickup_lat: 0,
      pickup_lng: 0,
      dropoff_address: 'B',
      dropoff_lat: 1,
      dropoff_lng: 1,
      price_cents: 1000,
      currency: 'USD',
    },
  });
  return (r.json() as { id: number }).id;
}

describe('uploads', () => {
  it('POST /uploads/image/profile saves an image', async () => {
    const u = await registerCustomer();
    const app = await getApp();
    const mp = buildMultipart('file', 'avatar.png', 'image/png', PNG_BYTES);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/image/profile',
      headers: { ...authHeaders(u), ...mp.headers },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { profile_image_url: string };
    expect(body.profile_image_url).toMatch(/^\/uploads\//);
  });

  it('POST /uploads/image/profile rejects unsupported mime', async () => {
    const u = await registerCustomer();
    const app = await getApp();
    const mp = buildMultipart('file', 'evil.exe', 'application/octet-stream', PNG_BYTES);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/image/profile',
      headers: { ...authHeaders(u), ...mp.headers },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /uploads/image/profile rejects empty body', async () => {
    const u = await registerCustomer();
    const app = await getApp();
    const mp = buildMultipart('file', 'tiny.png', 'image/png', Buffer.alloc(0));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/image/profile',
      headers: { ...authHeaders(u), ...mp.headers },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT /uploads/image/profile replaces existing', async () => {
    const u = await registerCustomer();
    const app = await getApp();
    const mp1 = buildMultipart('file', 'a.png', 'image/png', PNG_BYTES);
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/image/profile',
      headers: { ...authHeaders(u), ...mp1.headers },
      payload: mp1.payload,
    });
    expect(r1.statusCode).toBe(200);
    const mp2 = buildMultipart('file', 'b.png', 'image/png', PNG_BYTES);
    const r2 = await app.inject({
      method: 'PUT',
      url: '/api/v1/uploads/image/profile',
      headers: { ...authHeaders(u), ...mp2.headers },
      payload: mp2.payload,
    });
    expect(r2.statusCode).toBe(200);
    expect((r2.json() as { profile_image_url: string }).profile_image_url).toBeTruthy();
  });

  it('DELETE /uploads/image/profile clears url', async () => {
    const u = await registerCustomer();
    const app = await getApp();
    const mp = buildMultipart('file', 'a.png', 'image/png', PNG_BYTES);
    await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/image/profile',
      headers: { ...authHeaders(u), ...mp.headers },
      payload: mp.payload,
    });
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/uploads/image/profile', headers: authHeaders(u) });
    expect(res.statusCode).toBe(204);
  });

  it('POST without auth returns 401', async () => {
    const app = await getApp();
    const mp = buildMultipart('file', 'a.png', 'image/png', PNG_BYTES);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/image/profile',
      headers: mp.headers,
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /uploads/image/order/:id saves cargo image', async () => {
    const c = await registerCustomer();
    const orderId = await createOrder(c);
    const app = await getApp();
    const mp = buildMultipart('file', 'cargo.jpg', 'image/jpeg', PNG_BYTES);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/uploads/image/order/${orderId}`,
      headers: { ...authHeaders(c), ...mp.headers },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { cargo_image_url: string }).cargo_image_url).toMatch(/^\/uploads\//);
  });
});
