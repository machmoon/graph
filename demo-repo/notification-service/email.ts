import { findUserById } from '../user-service/user';
import { logEvent } from '../logger/logger';

export async function sendLoginNotification(email: string, ip: string) {
  await sendEmail({
    to: email,
    subject: 'New login detected',
    body: `A new login to your account was detected from IP: ${ip}`,
  });
  logEvent('login_notification_sent', { email });
}

export async function sendOrderConfirmation(userId: string, orderId: string) {
  const user = await findUserById(userId);
  await sendEmail({
    to: user.email,
    subject: `Order ${orderId} confirmed`,
    body: `Your order has been placed successfully.`,
  });
  logEvent('order_confirmation_sent', { userId, orderId });
}
