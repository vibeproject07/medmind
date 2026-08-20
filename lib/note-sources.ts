import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

export const MAX_SOURCE_FILE_BYTES = 500 * 1024 * 1024;

export type SourceCategory = 'document' | 'text' | 'image' | 'audio' | 'video';
export type SourceProcessingStatus = 'idle' | 'queued' | 'processing' | 'completed' | 'failed';

export type NoteSource = {
  id: number;
  note_id: number;
  user_id: number;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  category: SourceCategory;
  status: 'uploading' | 'ready';
  processing_status: SourceProcessingStatus;
  processing_original_text?: string | null;
  processing_result?: string | null;
  processing_error?: string | null;
  processing_attempts: number;
  processing_started_at?: string | null;
  processing_completed_at?: string | null;
  created_at: string;
  updated_at: string;
};

type AuthUser = {
  id: number;
  role: string;
};

type DatabaseSource = NoteSource & {
  object_key: string;
  checksum_sha256: string;
  processing_claim_id?: string | null;
  processing_lease_expires_at?: string | null;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  webm: 'video/webm',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

const ALLOWED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));

export function getRequestUser(request: NextRequest): AuthUser | null {
  const authHeader = request.headers.get('authorization');
  let token = authHeader?.replace(/^Bearer\s+/i, '') || request.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  const user = token ? verifyToken(token) : null;
  if (!user || !Number.isFinite(Number(user.id))) return null;
  return { id: Number(user.id), role: String(user.role || '') };
}

export async function ensureNoteSourcesSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS note_sources (
      id SERIAL PRIMARY KEY,
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      object_key TEXT NOT NULL UNIQUE,
      checksum_sha256 TEXT,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
      category TEXT NOT NULL CHECK (category IN ('document', 'text', 'image', 'audio', 'video')),
      status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready')),
       processing_status TEXT NOT NULL DEFAULT 'idle' CHECK (processing_status IN ('idle', 'queued', 'processing', 'completed', 'failed')),
       processing_original_text TEXT,
       processing_result TEXT,
       processing_error TEXT,
       processing_attempts INTEGER NOT NULL DEFAULT 0,
       processing_started_at TIMESTAMPTZ,
       processing_completed_at TIMESTAMPTZ,
       processing_claim_id TEXT,
       processing_lease_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query('ALTER TABLE note_sources ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT');
  await query(`ALTER TABLE note_sources ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'idle'`);
  await query('ALTER TABLE note_sources ADD COLUMN IF NOT EXISTS processing_original_text TEXT');
  await query('ALTER TABLE note_sources ADD COLUMN IF NOT EXISTS processing_result TEXT');
  await query('ALTER TABLE note_sources ADD COLUMN IF NOT EXISTS processing_error TEXT');
  await query('ALTER TABLE note_sources ADD COLUMN IF NOT EXISTS processing_attempts INTEGER NOT NULL DEFAULT 0');
  await query('ALTER TABLE note_sources ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ');
  await query('ALTER TABLE note_sources ADD COLUMN IF NOT EXISTS processing_completed_at TIMESTAMPTZ');
  await query('ALTER TABLE note_sources ADD COLUMN IF NOT EXISTS processing_claim_id TEXT');
  await query('ALTER TABLE note_sources ADD COLUMN IF NOT EXISTS processing_lease_expires_at TIMESTAMPTZ');
  await query('CREATE INDEX IF NOT EXISTS idx_note_sources_note_id ON note_sources(note_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_note_sources_owner ON note_sources(user_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_note_sources_processing ON note_sources(processing_status) WHERE processing_status IN (\'queued\', \'processing\')');
}

export async function getAccessibleNote(
  noteId: number,
  user: AuthUser,
): Promise<{ id: number; user_id: number } | null> {
  const result = user.role === 'admin'
    ? await query('SELECT id, user_id FROM notes WHERE id = $1', [noteId])
    : await query('SELECT id, user_id FROM notes WHERE id = $1 AND user_id = $2', [noteId, user.id]);
  return (result.rows[0] as { id: number; user_id: number } | undefined) ?? null;
}

export async function getAccessibleSource(
  noteId: number,
  sourceId: number,
  user: AuthUser,
): Promise<DatabaseSource | null> {
  const result = user.role === 'admin'
    ? await query('SELECT * FROM note_sources WHERE id = $1 AND note_id = $2', [sourceId, noteId])
    : await query(
      `SELECT ns.* FROM note_sources ns
       JOIN notes n ON n.id = ns.note_id
       WHERE ns.id = $1 AND ns.note_id = $2 AND n.user_id = $3`,
      [sourceId, noteId, user.id],
    );
  return (result.rows[0] as DatabaseSource | undefined) ?? null;
}

export function sourceForClient(source: DatabaseSource | NoteSource): NoteSource {
  const {
    object_key: _objectKey,
    checksum_sha256: _checksumSha256,
    processing_claim_id: _processingClaimId,
    processing_lease_expires_at: _processingLeaseExpiresAt,
    ...safeSource
  } = source as DatabaseSource;
  return safeSource;
}

function extensionOf(name: string): string {
  const match = name.toLowerCase().match(/\.([a-z0-9]{1,12})$/);
  return match?.[1] ?? '';
}

export function normalizeSourceMimeType(name: string, providedMimeType: unknown): string | null {
  const fallback = MIME_BY_EXTENSION[extensionOf(name)];
  const mimeType = typeof providedMimeType === 'string' && providedMimeType.trim()
    ? providedMimeType.toLowerCase().trim()
    : fallback;
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) return null;

  // Do not accept a conflicting browser-provided type when the extension is known.
  if (fallback && mimeType !== fallback && !(extensionOf(name) === 'webm' && mimeType === 'audio/webm')) {
    return null;
  }
  return mimeType;
}

export function categoryForMimeType(mimeType: string): SourceCategory {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('text/')) return 'text';
  return 'document';
}

export function validateSourceUpload(input: {
  fileName?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  checksumSha256?: unknown;
}): {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  category: SourceCategory;
} | { error: string } {
  const fileName = typeof input.fileName === 'string' ? input.fileName.trim() : '';
  if (!fileName || fileName.length > 255 || /[\0/\\]/.test(fileName)) {
    return { error: 'Nome de arquivo inválido.' };
  }

  const sizeBytes = Number(input.sizeBytes);
  if (!Number.isInteger(sizeBytes) || sizeBytes < 1) return { error: 'Tamanho de arquivo inválido.' };
  if (sizeBytes > MAX_SOURCE_FILE_BYTES) {
    return { error: `O arquivo excede o limite de ${MAX_SOURCE_FILE_BYTES / 1024 / 1024} MB.` };
  }

  const mimeType = normalizeSourceMimeType(fileName, input.mimeType);
  if (!mimeType) {
    return { error: 'Formato não suportado. Envie texto, documento, imagem, áudio ou vídeo em um formato compatível.' };
  }

  const checksumSha256 = typeof input.checksumSha256 === 'string'
    ? input.checksumSha256.trim()
    : '';
  if (!/^[A-Za-z0-9+/]{43}=$/.test(checksumSha256)) {
    return { error: 'Não foi possível validar a integridade do arquivo. Selecione-o novamente.' };
  }

  return { fileName, mimeType, sizeBytes, checksumSha256, category: categoryForMimeType(mimeType) };
}

/** Prune stale pending metadata; S3 lifecycle expires matching staging objects. */
export async function clearExpiredPendingSources(): Promise<void> {
  await query(
    `DELETE FROM note_sources
     WHERE status = 'uploading' AND created_at < NOW() - INTERVAL '1 day'`,
  );
}