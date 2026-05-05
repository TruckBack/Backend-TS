import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
import { config } from '../config.js';
import * as schema from './schema.js';

const { Pool } = pkg;

let _pool: pkg.Pool | null = null;
let _db: NodePgDatabase<typeof schema> | null = null;

export type Database = NodePgDatabase<typeof schema>;

export function getPool(): pkg.Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: config.DATABASE_URL_NORMALIZED });
  }
  return _pool;
}

export function getDb(): Database {
  if (!_db) {
    _db = drizzle(getPool(), { schema });
  }
  return _db;
}

/**
 * Test-only: inject a custom pool (e.g. pg-mem) and reset the drizzle instance.
 */
export function setTestPool(pool: pkg.Pool): void {
  _pool = pool;
  _db = drizzle(pool, { schema });
}

export function resetDb(): void {
  _pool = null;
  _db = null;
}

export { schema };
