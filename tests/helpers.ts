import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

export interface TestUser {
  id: number;
  email: string;
  full_name: string;
  role: 'customer' | 'driver' | 'admin';
  access: string;
  refresh: string;
}

const AT = String.fromCharCode(64);

export function mkEmail(local: string, domain = 'test.com'): string {
  return `${local}${AT}${domain}`;
}

let _app: FastifyInstance | null = null;
let _seq = 0;

export async function getApp(): Promise<FastifyInstance> {
  if (_app) return _app;
  _app = await buildApp();
  await _app.ready();
  return _app;
}

export async function closeApp(): Promise<void> {
  if (_app) {
    await _app.close();
    _app = null;
  }
}

function uniq(): string {
  _seq += 1;
  return `${Date.now().toString(36)}${_seq}`;
}

export async function registerCustomer(
  overrides: Partial<{ email: string; password: string; full_name: string; phone: string }> = {},
): Promise<TestUser> {
  const app = await getApp();
  const email = overrides.email ?? mkEmail(`cust-${uniq()}`);
  const password = overrides.password ?? 'password123';
  const full_name = overrides.full_name ?? 'Cust Test';
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register/customer',
    payload: { email, password, full_name, phone: overrides.phone },
  });
  if (reg.statusCode !== 201) throw new Error(`register failed: ${reg.statusCode} ${reg.body}`);
  const user = reg.json() as { id: number };
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login/json',
    payload: { email, password, role: 'customer' },
  });
  const t = login.json() as { access_token: string; refresh_token: string };
  return { id: user.id, email, full_name, role: 'customer', access: t.access_token, refresh: t.refresh_token };
}

export async function registerDriver(
  overrides: Partial<{ email: string; password: string; license_number: string; full_name: string }> = {},
): Promise<TestUser> {
  const app = await getApp();
  const email = overrides.email ?? mkEmail(`drv-${uniq()}`);
  const password = overrides.password ?? 'password123';
  const full_name = overrides.full_name ?? 'Driver Test';
  const license = overrides.license_number ?? `LIC-${uniq().toUpperCase()}`;
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register/driver',
    payload: {
      email,
      password,
      full_name,
      license_number: license,
      vehicle_type: 'truck',
      vehicle_plate: 'ABC-123',
      vehicle_capacity_kg: 1000,
    },
  });
  if (reg.statusCode !== 201) throw new Error(`register driver failed: ${reg.statusCode} ${reg.body}`);
  const user = reg.json() as { id: number };
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login/json',
    payload: { email, password, role: 'driver' },
  });
  const t = login.json() as { access_token: string; refresh_token: string };
  return { id: user.id, email, full_name, role: 'driver', access: t.access_token, refresh: t.refresh_token };
}

export function authHeaders(u: TestUser): Record<string, string> {
  return { authorization: `Bearer ${u.access}` };
}

import { afterEach } from 'vitest';
afterEach(async () => {
  await closeApp();
});
