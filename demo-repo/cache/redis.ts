import { logEvent } from '../logger/logger';

const redis = new Redis(process.env.REDIS_URL);

export async function getCache(key: string) {
  const value = await redis.get(key);
  return value ? JSON.parse(value) : null;
}

export async function setCache(key: string, value: any, ttlSeconds: number) {
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

export async function invalidateCache(key: string) {
  await redis.del(key);
  logEvent('cache_invalidated', { key });
}

export async function deleteCache(key: string) {
  await redis.del(key);
}
