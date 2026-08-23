import { getCache, setCache, deleteCache } from '../cache/redis';
import { logEvent } from '../logger/logger';

export async function createSession(token: string, userId: string) {
  const session = {
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
  await setCache(`session:${token}`, session, 86400);
  logEvent('session_created', { userId });
  return session;
}

export async function getSession(token: string) {
  return getCache(`session:${token}`);
}

export async function destroySession(token: string) {
  await deleteCache(`session:${token}`);
  logEvent('session_destroyed', { token: token.slice(0, 8) });
}
