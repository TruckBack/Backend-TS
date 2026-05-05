import { buildApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { pingRedis } from './redis/index.js';

async function main(): Promise<void> {
  try {
    await runMigrations();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Migrations failed:', e);
    process.exit(1);
  }
  const ok = await pingRedis();
  if (!ok) {
    // eslint-disable-next-line no-console
    console.warn('Redis ping failed — continuing without Redis connectivity');
  }
  const app = await buildApp();
  await app.listen({ host: config.HOST, port: config.PORT });
  // eslint-disable-next-line no-console
  console.log(`${config.APP_NAME} listening on ${config.HOST}:${config.PORT}`);
}

main().catch((e: unknown) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
