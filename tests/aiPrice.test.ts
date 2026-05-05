import { describe, expect, it } from 'vitest';
import { authHeaders, getApp, registerCustomer } from './helpers.js';
import { setGeminiCaller } from '../src/services/aiPrice.js';

describe('aiPrice', () => {
  it('returns stubbed estimate for authenticated user', async () => {
    const c = await registerCustomer();
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai-price/',
      headers: authHeaders(c),
      payload: { message: 'Move a sofa across town' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { result: string };
    expect(body.result).toMatch(/Price estimate/);
    expect(body.result).toContain('sofa');
  });

  it('rejects unauthenticated calls', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai-price/',
      payload: { message: 'hello' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects empty message body (422)', async () => {
    const c = await registerCustomer();
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai-price/',
      headers: authHeaders(c),
      payload: { message: '' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects whitespace-only message (400)', async () => {
    const c = await registerCustomer();
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai-price/',
      headers: authHeaders(c),
      payload: { message: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when API not configured', async () => {
    const c = await registerCustomer();
    const app = await getApp();
    setGeminiCaller(null);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ai-price/',
        headers: authHeaders(c),
        payload: { message: 'estimate this' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      // Restore stub for subsequent tests
      setGeminiCaller(async (msg: string) =>
        `Price estimate: $30-$50 USD\nReason: stubbed response for "${msg}"`,
      );
    }
  });

  it('surfaces Gemini errors as 500', async () => {
    const c = await registerCustomer();
    const app = await getApp();
    setGeminiCaller(async () => {
      throw new Error('upstream failed');
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ai-price/',
        headers: authHeaders(c),
        payload: { message: 'estimate this' },
      });
      expect(res.statusCode).toBe(500);
    } finally {
      setGeminiCaller(async (msg: string) =>
        `Price estimate: $30-$50 USD\nReason: stubbed response for "${msg}"`,
      );
    }
  });
});
