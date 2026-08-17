/**
 * lib/s3.ts — Amazon S3 upload helpers for question images.
 *
 * Required environment variables:
 *   AWS_ACCESS_KEY_ID      — IAM access key
 *   AWS_SECRET_ACCESS_KEY  — IAM secret key
 *   AWS_REGION             — e.g. "us-east-1"
 *   AWS_S3_BUCKET          — bucket name (must allow public GetObject via bucket policy)
 *
 * Graceful degradation: when S3 is not configured (missing env vars), images are
 * stored as-is (base64 strings remain in the DB). Set all four vars to enable S3.
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';

// ── S3 client (lazy, singleton per process) ───────────────────────────────────

let _client: S3Client | null = null;

function getClient(): S3Client | null {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) return null;
  if (!_client) {
    _client = new S3Client({
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

// ── Public helpers ────────────────────────────────────────────────────────────

/** Returns true when all four required env vars are present. */
export function isS3Configured(): boolean {
  return !!(
    process.env.AWS_S3_BUCKET &&
    process.env.AWS_REGION &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
  );
}

/** Returns true when the string is a base64 data URL (data:image/...). */
export function isBase64Image(value: string): boolean {
  return typeof value === 'string' && value.startsWith('data:image/');
}

/**
 * Upload a raw buffer to S3 and return the public URL.
 * Throws if S3 is not configured or the upload fails.
 */
export async function uploadBufferToS3(
  buffer: Buffer,
  mimeType: string,
  prefix = 'questions',
): Promise<string> {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) throw new Error('AWS_S3_BUCKET não configurado');

  const client = getClient();
  if (!client) throw new Error('Credenciais AWS não configuradas (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)');

  const ext = mimeType
    .split('/')[1]
    ?.replace('jpeg', 'jpg')
    .replace('svg+xml', 'svg')
    .replace(/\+.*$/, '') ?? 'png';
  const key = `${prefix}/${crypto.randomUUID()}.${ext}`;

  await client.send(
    new PutObjectCommand({
      Bucket:      bucket,
      Key:         key,
      Body:        buffer,
      ContentType: mimeType,
    }),
  );

  const region = process.env.AWS_REGION ?? 'us-east-1';
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

/**
 * Parse a base64 data URL and upload it to S3. Returns the S3 URL.
 * Throws if the string is not a valid data URL or if the upload fails.
 */
export async function uploadBase64ToS3(
  dataUrl: string,
  prefix = 'questions',
): Promise<string> {
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) throw new Error('Formato de data URL inválido');
  const [, mimeType, b64] = match;
  const buffer = Buffer.from(b64, 'base64');
  return uploadBufferToS3(buffer, mimeType, prefix);
}

/**
 * Process an array of image strings for storage:
 * - Base64 data URLs → uploaded to S3, replaced by the returned URL.
 * - Existing URLs (https://...) → passed through unchanged.
 *
 * When S3 is not configured, base64 strings are kept as-is (graceful degradation,
 * with a console warning).
 */
export async function processImagesForStorage(images: string[]): Promise<string[]> {
  if (images.length === 0) return images;

  const hasBase64 = images.some(isBase64Image);
  if (!hasBase64) return images; // nothing to do

  if (!isS3Configured()) {
    console.warn(
      '[s3] S3 não configurado (faltam AWS_S3_BUCKET / AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY). ' +
      'Imagens base64 serão mantidas como estão no banco.',
    );
    return images;
  }

  return Promise.all(
    images.map(async (img) => {
      if (!isBase64Image(img)) return img;
      try {
        return await uploadBase64ToS3(img);
      } catch (err) {
        console.error('[s3] Falha no upload da imagem, mantendo base64:', err);
        return img; // fallback: keep base64
      }
    }),
  );
}
