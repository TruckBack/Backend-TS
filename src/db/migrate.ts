import { getPool } from './index.js';
import { applySchema } from './bootstrap.js';

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  await applySchema(async (sql) => {
    await pool.query(sql);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log('Migrations applied');
      process.exit(0);
    })
    .catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error(e);
      process.exit(1);
    });
}
