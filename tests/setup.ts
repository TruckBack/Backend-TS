import { beforeEach, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Minimal env for config validation prior to importing app
process.env.SECRET_KEY = process.env.SECRET_KEY ?? 'test-secret-key-very-long-1234567890';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379/0';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? 'test-google-secret';
process.env.BCRYPT_SALT_ROUNDS = '4';

import { newDb, type IMemoryDb } from 'pg-mem';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import type pkg from 'pg';

import { setTestPool, resetDb } from '../src/db/index.js';
import { applySchema } from '../src/db/bootstrap.js';
import { setTestRedisFactory, resetRedis } from '../src/redis/index.js';
import { setGoogleVerifier, setGoogleCodeExchanger } from '../src/services/googleAuth.js';
import { setGeminiCaller } from '../src/services/aiPrice.js';
import { config } from '../src/config.js';

let pgMem: IMemoryDb;
let tmpUploadsDir: string;

export function getMemDb(): IMemoryDb {
  return pgMem;
}

function buildPgMem(): IMemoryDb {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  return db;
}

async function seedSchema(db: IMemoryDb): Promise<void> {
  // pg-mem's `query` runs full SQL synchronously per statement.
  await applySchema(async (sql) => {
    db.public.none(sql);
  });
}

interface PgQueryConfig {
  text: string;
  values?: unknown[];
  rowMode?: string;
  [k: string]: unknown;
}

interface QueryRunner {
  query: (...args: unknown[]) => Promise<unknown> | unknown;
}

/**
 * pg-mem does not support `rowMode: 'array'`. Drizzle uses it internally.
 * Wrap query() so that when rowMode === 'array' is requested, we run the
 * query without that flag and convert object rows back to arrays using
 * the result's `fields` metadata.
 */
function wrapQuery<T extends QueryRunner>(target: T): void {
  const orig = target.query.bind(target);
  target.query = ((...args: unknown[]) => {
    const first = args[0];
    if (first && typeof first === 'object' && (first as PgQueryConfig).rowMode === 'array') {
      const cfg = first as PgQueryConfig;
      const cleaned: PgQueryConfig = { ...cfg };
      delete cleaned.rowMode;
      const out = orig(cleaned, args[1] as unknown);
      const handle = (res: unknown): unknown => {
        const r = res as
          | { rows?: Record<string, unknown>[] | unknown[][]; fields?: { name: string }[] }
          | undefined;
        if (!r || !Array.isArray(r.rows)) return res;
        // Already arrays?
        if (r.rows.length > 0 && Array.isArray(r.rows[0])) return res;
        let fieldNames: string[] = [];
        if (Array.isArray(r.fields) && r.fields.length > 0) {
          fieldNames = r.fields.map((f) => f.name);
        } else if (r.rows.length > 0) {
          fieldNames = Object.keys(r.rows[0] as Record<string, unknown>);
        }
        (r as { rows: unknown[] }).rows = (r.rows as Record<string, unknown>[]).map((row) =>
          fieldNames.map((n) => row[n]),
        );
        return res;
      };
      return Promise.resolve(out).then(handle);
    }
    return orig(...args);
  }) as typeof target.query;
}

function wrapPool(pool: pkg.Pool): pkg.Pool {
  wrapQuery(pool as unknown as QueryRunner);
  const origConnect = pool.connect.bind(pool);
  (pool as unknown as { connect: (...a: unknown[]) => Promise<unknown> }).connect = (async (...args: unknown[]) => {
    const client = (await origConnect(...(args as [never]))) as QueryRunner & { release?: () => void };
    wrapQuery(client);
    return client;
  }) as never;
  return pool;
}

beforeAll(async () => {
  const AT = String.fromCharCode(64);
  // Stub Google OAuth verification (always returns a profile based on token text)
  setGoogleVerifier(async (idToken: string) => {
    // Token shape used by tests: "google:{sub}:{email}:{name}"
    const parts = idToken.split(':');
    if (parts[0] === 'google' && parts.length >= 4) {
      return {
        sub: parts[1]!,
        email: parts[2]!,
        name: parts[3]!,
        email_verified: true,
      };
    }
    return {
      sub: 'google-default-sub',
      email: `default${AT}example.com`,
      name: 'Google User',
      email_verified: true,
    };
  });
  setGoogleCodeExchanger(async (code: string) => {
    return {
      sub: `google-code-${code}`,
      email: `code-${code}${AT}example.com`,
      name: 'Code User',
      email_verified: true,
    };
  });

  setGeminiCaller(async (message: string) => {
    return `Price estimate: $30-$50 USD\nReason: stubbed response for "${message.slice(0, 20)}"`;
  });
});

beforeEach(async () => {
  // Fresh in-memory PG
  pgMem = buildPgMem();
  const adapter = pgMem.adapters.createPg();
  const PoolCtor = adapter.Pool;
  const pool = new PoolCtor() as unknown as pkg.Pool;
  wrapPool(pool);
  resetDb();
  setTestPool(pool);
  await seedSchema(pgMem);

  // Fresh Redis mock — share pub/sub by duplicating from a single root.
  resetRedis();
  const rootRedis = new RedisMock() as unknown as Redis;
  setTestRedisFactory(() => rootRedis.duplicate() as unknown as Redis);

  // Fresh uploads dir
  tmpUploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truckback-uploads-'));
  // Override config for uploads dir
  process.env.UPLOADS_DIR = tmpUploadsDir;
  // Force config reload
  const cfgModule = await import('../src/config.js');
  cfgModule.resetConfig();
  void config; // keep reference
});

afterEach(async () => {
  resetDb();
  resetRedis();
  if (tmpUploadsDir) {
    try {
      await fs.rm(tmpUploadsDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

afterAll(() => {
  setGoogleVerifier(null);
  setGoogleCodeExchanger(null);
  setGeminiCaller(null);
  vi.restoreAllMocks();
});
