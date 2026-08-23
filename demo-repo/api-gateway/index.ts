import { validateToken } from '../auth-service/token';
import { rateLimit } from '../rate-limiter/limiter';
import { routeToService } from './router';
import { logRequest } from '../logger/logger';

export async function handleRequest(req: Request) {
  logRequest(req);
  await rateLimit(req.ip);
  const user = await validateToken(req.headers.authorization);
  return routeToService(req, user);
}
