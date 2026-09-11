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
  type CORSRule,
  DeleteObjectCommand,
  CopyObjectCommand,
  GetBucketCorsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  PutBucketCorsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import crypto from 'crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// ── S3 client (lazy, singleton per process) ───────────────────────────────────

let _client: S3Client | null = null;
const configuredSourceUploadOrigins = new Set<string>();
const SOURCE_UPLOAD_CORS_RULE_ID = 'MedMindSourceUploads';

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

export function normalizeSourceUploadOrigin(origin: string): string {
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Origem inválida para configuração CORS do upload.');
  }
  return parsed.origin;
}

export function mergeSourceUploadCorsRules(
  existingRules: CORSRule[],
  origin: string,
): CORSRule[] {
  const normalizedOrigin = normalizeSourceUploadOrigin(origin);
  const currentRule = existingRules.find((rule) => rule.ID === SOURCE_UPLOAD_CORS_RULE_ID);
  const otherRules = existingRules.filter((rule) => rule.ID !== SOURCE_UPLOAD_CORS_RULE_ID);
  const allowedOrigins = Array.from(
    new Set([...(currentRule?.AllowedOrigins ?? []), normalizedOrigin]),
  );

  return [
    ...otherRules,
    {
      ID: SOURCE_UPLOAD_CORS_RULE_ID,
      AllowedOrigins: allowedOrigins,
      AllowedMethods: ['POST'],
      AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag', 'x-amz-checksum-sha256'],
      MaxAgeSeconds: 3600,
    },
  ];
}

/**
 * Garante que o bucket aceite o POST assinado vindo da origem atual. Regras de
 * outros consumidores são preservadas; somente a regra MedMindSourceUploads é
 * atualizada.
 */
export async function ensureSourceUploadCors(origin: string): Promise<void> {
  const normalizedOrigin = normalizeSourceUploadOrigin(origin);
  if (configuredSourceUploadOrigins.has(normalizedOrigin)) return;

  const client = requireClient();
  const bucket = getConfiguredBucket();
  let existingRules: CORSRule[] = [];
  try {
    const current = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    existingRules = current.CORSRules ?? [];
  } catch (error) {
    const code =
      error && typeof error === 'object'
        ? String(
            (error as { name?: unknown; Code?: unknown }).name ??
            (error as { Code?: unknown }).Code ??
            '',
          )
        : '';
    if (code !== 'NoSuchCORSConfiguration' && code !== 'NoSuchCORSConfigurationException') {
      throw error;
    }
  }

  const corsRules = mergeSourceUploadCorsRules(existingRules, normalizedOrigin);
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: corsRules },
    }),
  );
  configuredSourceUploadOrigins.add(normalizedOrigin);
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

export interface SourceObjectTempFile {
  path: string;
  size: number;
  cleanup: () => Promise<void>;
}

/**
 * Stream a private source object to a unique temporary file.
 *
 * The byte limits are enforced while the response is being consumed (rather
 * than after buffering), and the partially written file is removed on error.
 */
export async function downloadSourceObjectToTempFile(
  key: string,
  options: { expectedSize?: number; maxSize?: number; extension?: string } = {},
): Promise<SourceObjectTempFile> {
  const { expectedSize, maxSize = Number.POSITIVE_INFINITY } = options;
  if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) {
    throw new Error('expectedSize deve ser um número inteiro não negativo.');
  }
  if (!Number.isFinite(maxSize) && maxSize !== Number.POSITIVE_INFINITY) {
    throw new Error('maxSize inválido.');
  }
  if (maxSize < 0 || (expectedSize !== undefined && expectedSize > maxSize)) {
    throw new Error('O tamanho esperado excede o limite permitido.');
  }

  const result = await requireClient().send(
    new GetObjectCommand({ Bucket: getConfiguredBucket(), Key: key }),
  );
  if (!result.Body) throw new Error('Arquivo não encontrado no armazenamento');

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'medmind-s3-'));
  const extension = options.extension?.replace(/[^a-zA-Z0-9.]/g, '') ?? '';
  const tempPath = path.join(tempDir, `source${extension.startsWith('.') ? extension : ''}`);
  let size = 0;
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  };
  const limiter = new Transform({
    transform(chunk: Buffer | Uint8Array | string, _encoding, callback) {
      const bytes = Buffer.byteLength(chunk);
      size += bytes;
      if (size > maxSize) {
        callback(new Error(`Arquivo excede o limite de ${maxSize} bytes.`));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(result.Body as NodeJS.ReadableStream, limiter, fs.createWriteStream(tempPath));
    if (expectedSize !== undefined && size !== expectedSize) {
      throw new Error(`Tamanho do arquivo divergente: esperado ${expectedSize}, recebido ${size}.`);
    }
    return { path: tempPath, size, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
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
