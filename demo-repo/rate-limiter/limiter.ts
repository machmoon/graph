import { getCache, setCache } from '../cache/redis';
import { logEvent } from '../logger/logger';

export async function rateLimit(ip: string) {
  const key = `ratelimit:${ip}`;
  const current = await getCache(key);
  const count = (current?.count ?? 0) + 1;

  if (count > 100) {
    logEvent('rate_limited', { ip });
    throw new RateLimitError('Too many requests');
  }

  await setCache(key, { count }, 60);
}
