/**
 * lib/s3.ts — Amazon S3 upload helpers for question images.
 *
 * Required environment variables:
 *   AWS_ACCESS_KEY_ID or IAM_AWS_S3_access_key      — IAM access key
 *   AWS_SECRET_ACCESS_KEY or IAM_AWS_S3_secret_key  — IAM secret key
 *   AWS_REGION             — e.g. "us-east-1"
 *   AWS_S3_BUCKET          — bucket name (must allow public GetObject via bucket policy)
 *
 * Graceful degradation: when S3 is not configured (missing env vars), images are
 * stored as-is (base64 strings remain in the DB). Set all four vars to enable S3.
 */

import {
  DeleteObjectCommand,
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import crypto from 'crypto';

// ── S3 client (lazy, singleton per process) ───────────────────────────────────

let _client: S3Client | null = null;

function getAccessKeyId(): string | undefined {
  return process.env.AWS_ACCESS_KEY_ID || process.env.IAM_AWS_S3_access_key;
}

function getSecretAccessKey(): string | undefined {
  return process.env.AWS_SECRET_ACCESS_KEY || process.env.IAM_AWS_S3_secret_key;
}

function getClient(): S3Client | null {
  const accessKeyId = getAccessKeyId();
  const secretAccessKey = getSecretAccessKey();
  if (!accessKeyId || !secretAccessKey) return null;
  if (!_client) {
    _client = new S3Client({
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }
  return _client;
}

function getConfiguredBucket(): string {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) throw new Error('AWS_S3_BUCKET não configurado');
  return bucket;
}

function requireClient(): S3Client {
  const client = getClient();
  if (!client) {
    throw new Error(
      'Credenciais AWS não configuradas (AWS_ACCESS_KEY_ID / IAM_AWS_S3_access_key e ' +
      'AWS_SECRET_ACCESS_KEY / IAM_AWS_S3_secret_key)',
    );
  }
  return client;
}

function extensionFromFileName(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]{1,12})$/);
  return match ? `.${match[1]}` : '';
}

// ── Public helpers ────────────────────────────────────────────────────────────

/** Returns true when all four required env vars are present. */
export function isS3Configured(): boolean {
  return !!(
    process.env.AWS_S3_BUCKET &&
    process.env.AWS_REGION &&
    getAccessKeyId() &&
    getSecretAccessKey()
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
  const bucket = getConfiguredBucket();
  const client = requireClient();

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
 * Create an object key for a private source file. The generated key never uses
 * the original name as a path, so names cannot escape their user's folder.
 */
export function createSourceObjectKey(
  ownerUserId: number,
  noteId: number,
  originalName: string,
): string {
  const extension = extensionFromFileName(originalName);
  return `sources/user-${ownerUserId}/note-${noteId}/${crypto.randomUUID()}${extension}`;
}

/** Object keys signed for upload are temporary and promoted after validation. */
export function createSourceStagingObjectKey(
  ownerUserId: number,
  noteId: number,
  originalName: string,
): string {
  const extension = extensionFromFileName(originalName);
  return `sources/staging/user-${ownerUserId}/note-${noteId}/${crypto.randomUUID()}${extension}`;
}

/**
 * Create a browser form POST that S3 itself constrains to the validated size,
 * content type and checksum. The staging key is never used for reads.
 */
export async function createSourceUploadPost(
  key: string,
  mimeType: string,
  sizeBytes: number,
  checksumSha256: string,
  expiresInSeconds = 15 * 60,
): Promise<{ url: string; fields: Record<string, string> }> {
  return createPresignedPost(requireClient(), {
    Bucket: getConfiguredBucket(),
    Key: key,
    Expires: expiresInSeconds,
    Fields: {
      'Content-Type': mimeType,
      'x-amz-checksum-sha256': checksumSha256,
    },
    Conditions: [
      // The POST body includes multipart field overhead. Completion still requires
      // the stored object's exact byte size, while this cap blocks large abuse.
      ['content-length-range', sizeBytes, sizeBytes + 64 * 1024],
      { 'Content-Type': mimeType },
      { 'x-amz-checksum-sha256': checksumSha256 },
    ],
  });
}

/** Create a short-lived URL for an authorized user to open a private source. */
export async function createSourceReadUrl(
  key: string,
  originalName: string,
  download = false,
  expiresInSeconds = 10 * 60,
): Promise<string> {
  const disposition = `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(originalName)}`;
  return getSignedUrl(
    requireClient(),
    new GetObjectCommand({
      Bucket: getConfiguredBucket(),
      Key: key,
      ResponseContentDisposition: disposition,
    }),
    { expiresIn: expiresInSeconds },
  );
}

/** Confirm the file uploaded to S3 before publishing its metadata in the app. */
export async function getSourceObjectInfo(
  key: string,
): Promise<{ size: number; checksumSha256?: string }> {
  const result = await requireClient().send(
    new HeadObjectCommand({
      Bucket: getConfiguredBucket(),
      Key: key,
      ChecksumMode: 'ENABLED',
    }),
  );
  return {
    size: Number(result.ContentLength ?? 0),
    checksumSha256: result.ChecksumSHA256,
  };
}

/** Read a private source server-side for the existing processing pipelines. */
export async function readSourceObject(key: string): Promise<Buffer> {
  const result = await requireClient().send(
    new GetObjectCommand({ Bucket: getConfiguredBucket(), Key: key }),
  );
  if (!result.Body) throw new Error('Arquivo não encontrado no armazenamento');

  if ('transformToByteArray' in result.Body) {
    return Buffer.from(await result.Body.transformToByteArray());
  }

  const chunks: Buffer[] = [];
  for await (const chunk of result.Body as AsyncIterable<Buffer | Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Permanently delete one private source object. */
export async function deleteSourceObject(key: string): Promise<void> {
  await requireClient().send(
    new DeleteObjectCommand({ Bucket: getConfiguredBucket(), Key: key }),
  );
}

/** Promote a validated staged object to its unique final key. */
export async function promoteSourceObject(stagingKey: string, finalKey: string): Promise<void> {
  const bucket = getConfiguredBucket();
  await requireClient().send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: finalKey,
      CopySource: `${bucket}/${encodeURIComponent(stagingKey).replace(/%2F/g, '/')}`,
      MetadataDirective: 'COPY',
    }),
  );
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
      '[s3] S3 não configurado (faltam AWS_S3_BUCKET / AWS_REGION / credenciais IAM). ' +
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
