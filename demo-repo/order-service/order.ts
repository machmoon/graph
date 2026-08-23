import { query } from '../database/postgres';
import { findUserById } from '../user-service/user';
import { getProduct, decrementStock } from '../product-service/product';
import { processPayment } from '../payment-service/payment';
import { publishEvent } from '../event-bus/publisher';
import { uploadReceipt } from '../storage/s3';
import { logEvent } from '../logger/logger';

export async function createOrder(userId: string, items: OrderItem[]) {
  const user = await findUserById(userId);

  for (const item of items) {
    const product = await getProduct(item.productId);
    if (product.stock < item.quantity) {
      throw new OrderError(`Insufficient stock for ${product.name}`);
    }
  }

  const total = calculateTotal(items);
  const payment = await processPayment(user, total);

  const order = await query(
    'INSERT INTO orders (user_id, items, total, payment_id) VALUES ($1,$2,$3,$4) RETURNING *',
    [userId, items, total, payment.id]
  );

  for (const item of items) {
    await decrementStock(item.productId, item.quantity);
  }

  const receipt = generateReceipt(order, user, items);
  await uploadReceipt(`receipts/${order.id}.pdf`, receipt);

  await publishEvent('order.created', { orderId: order.id, userId });
  logEvent('order_created', { orderId: order.id, userId, total });

  return order;
}

export async function getOrder(id: string) {
  return query('SELECT * FROM orders WHERE id = $1', [id]);
}
