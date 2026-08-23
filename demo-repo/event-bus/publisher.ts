import { logEvent } from '../logger/logger';

const sqs = new SQSClient({ region: process.env.AWS_REGION });

export async function publishEvent(eventType: string, payload: any) {
  await sqs.send(new SendMessageCommand({
    QueueUrl: process.env.EVENT_QUEUE_URL,
    MessageBody: JSON.stringify({ eventType, payload, timestamp: Date.now() }),
  }));
  logEvent('event_published', { eventType });
}
