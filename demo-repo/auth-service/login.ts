import { findUserByEmail } from '../user-service/user';
import { issueToken } from './token';
import { comparePassword } from './password';
import { sendLoginNotification } from '../notification-service/email';
import { logAuth } from '../logger/logger';

export async function login(email: string, password: string) {
  const user = await findUserByEmail(email);
  if (!user) throw new AuthError('User not found');

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) throw new AuthError('Invalid password');

  const token = await issueToken(user.id);
  await sendLoginNotification(user.email, req.ip);
  logAuth(user.id, 'login_success');

  return { token, user: { id: user.id, email: user.email } };
}
