import { describe, expect, it } from 'vitest';
import { getApp } from './helpers.js';

describe('health', () => {
  it('GET /health returns ok', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /openapi.json is available', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { openapi: string };
    expect(body.openapi).toBeDefined();
  });
});
