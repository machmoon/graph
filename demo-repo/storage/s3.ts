import { logEvent } from '../logger/logger';

const s3 = new S3Client({ region: process.env.AWS_REGION });

export async function uploadReceipt(key: string, data: Buffer) {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.RECEIPTS_BUCKET,
    Key: key,
    Body: data,
    ContentType: 'application/pdf',
  }));
  logEvent('receipt_uploaded', { key });
}

export async function getReceiptUrl(key: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({
    Bucket: process.env.RECEIPTS_BUCKET,
    Key: key,
  }), { expiresIn: 3600 });
}
