import IORedis, { type Redis } from 'ioredis';
import { config } from '../config.js';

let _client: Redis | null = null;
let _subscriber: Redis | null = null;

type RedisFactory = () => Redis;
let _factory: RedisFactory | null = null;

export function setTestRedisFactory(factory: RedisFactory | null): void {
  _factory = factory;
  _client = null;
  _subscriber = null;
}

function makeClient(): Redis {
  if (_factory) return _factory();
  return new IORedis(config.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1 });
}

export function getRedis(): Redis {
  if (!_client) _client = makeClient();
  return _client;
}

export function getRedisSubscriber(): Redis {
  if (!_subscriber) _subscriber = makeClient();
  return _subscriber;
}

export async function pingRedis(): Promise<boolean> {
  try {
    const r = getRedis();
    const res = await r.ping();
    return res === 'PONG';
  } catch {
    return false;
  }
}

export function resetRedis(): void {
  try {
    _client?.disconnect();
  } catch { /* ignore */ }
  try {
    _subscriber?.disconnect();
  } catch { /* ignore */ }
  _client = null;
  _subscriber = null;
}
