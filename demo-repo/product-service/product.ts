import { query } from '../database/postgres';
import { getCache, setCache, invalidateCache } from '../cache/redis';
import { logEvent } from '../logger/logger';

export async function getProduct(id: string) {
  const cached = await getCache(`product:${id}`);
  if (cached) return cached;

  const product = await query('SELECT * FROM products WHERE id = $1', [id]);
  await setCache(`product:${id}`, product, 600);
  return product;
}

export async function decrementStock(productId: string, quantity: number) {
  const result = await query(
    'UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2 RETURNING *',
    [productId, quantity]
  );
  if (!result) throw new StockError('Stock update failed');
  await invalidateCache(`product:${productId}`);
  logEvent('stock_decremented', { productId, quantity });
  return result;
}
