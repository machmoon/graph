import { getUser, updateUser } from '../user-service/user';
import { createOrder, getOrder } from '../order-service/order';
import { getProduct } from '../product-service/product';

export function routeToService(req: Request, user: AuthUser) {
  const routes = {
    '/users': () => getUser(user.id),
    '/users/update': () => updateUser(user.id, req.body),
    '/orders': () => createOrder(user.id, req.body),
    '/orders/:id': () => getOrder(req.params.id),
    '/products': () => getProduct(req.params.id),
  };
  return routes[req.path]?.() ?? { status: 404 };
}
