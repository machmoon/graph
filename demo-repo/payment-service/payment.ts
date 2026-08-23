import { validateToken } from '../auth-service/token';
import { logEvent } from '../logger/logger';
import { publishEvent } from '../event-bus/publisher';

export async function processPayment(user: AuthUser, amount: number) {
  const paymentIntent = await stripeClient.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: 'usd',
    customer: user.stripeCustomerId,
  });

  logEvent('payment_processed', { userId: user.id, amount });
  await publishEvent('payment.completed', { userId: user.id, amount, paymentId: paymentIntent.id });

  return { id: paymentIntent.id, status: paymentIntent.status };
}
