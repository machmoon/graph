import { getSession } from '../session-store/session';
import { findUserById } from '../user-service/user';
import { logAuth } from '../logger/logger';

export async function validateToken(authHeader: string): Promise<AuthUser> {
  const token = authHeader?.replace('Bearer ', '');
  if (!token) throw new UnauthorizedError('Missing token');

  const session = await getSession(token);
  if (!session || session.expiresAt < Date.now()) {
    throw new UnauthorizedError('Invalid or expired token');
  }

  logAuth(session.userId, 'token_validated');
  return findUserById(session.userId);
}

export async function issueToken(userId: string): Promise<string> {
  const token = crypto.randomUUID();
  await createSession(token, userId);
  logAuth(userId, 'token_issued');
  return token;
}
