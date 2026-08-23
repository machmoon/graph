import { query } from '../database/postgres';
import { getCache, setCache, invalidateCache } from '../cache/redis';
import { logEvent } from '../logger/logger';

export async function findUserById(id: string) {
  const cached = await getCache(`user:${id}`);
  if (cached) return cached;

  const user = await query('SELECT * FROM users WHERE id = $1', [id]);
  await setCache(`user:${id}`, user, 300);
  return user;
}

export async function findUserByEmail(email: string) {
  return query('SELECT * FROM users WHERE email = $1', [email]);
}

export async function updateUser(id: string, data: Partial<User>) {
  const user = await query('UPDATE users SET name=$2, email=$3 WHERE id=$1 RETURNING *', [id, data.name, data.email]);
  await invalidateCache(`user:${id}`);
  logEvent('user_updated', { userId: id });
  return user;
}

export async function getUser(id: string) {
  return findUserById(id);
}
