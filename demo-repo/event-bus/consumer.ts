import { sendOrderConfirmation } from '../notification-service/email';
import { logEvent } from '../logger/logger';

export async function processEvent(event: QueueEvent) {
  logEvent('event_received', { type: event.eventType });

  switch (event.eventType) {
    case 'order.created':
      await sendOrderConfirmation(event.payload.userId, event.payload.orderId);
      break;
    case 'payment.completed':
      logEvent('payment_event_processed', event.payload);
      break;
    default:
      logEvent('unknown_event', { type: event.eventType });
  }
}
