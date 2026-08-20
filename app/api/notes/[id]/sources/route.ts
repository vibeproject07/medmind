import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  ensureNoteSourcesSchema,
  clearExpiredPendingSources,
  getAccessibleNote,
  getRequestUser,
  sourceForClient,
  validateSourceUpload,
} from '@/lib/note-sources';
import { createSourceStagingObjectKey, createSourceUploadPost, isS3Configured } from '@/lib/s3';

export const runtime = 'nodejs';

function getNoteId(rawId: string): number | null {
  const noteId = Number(rawId);
  return Number.isInteger(noteId) && noteId > 0 ? noteId : null;
}

async function getAuthorizedNote(request: NextRequest, rawId: string) {
  const noteId = getNoteId(rawId);
  if (!noteId) return { error: NextResponse.json({ error: 'Nota inválida.' }, { status: 400 }) };

  const user = getRequestUser(request);
  if (!user) return { error: NextResponse.json({ error: 'Não autorizado.' }, { status: 401 }) };

  await ensureNoteSourcesSchema();
  await clearExpiredPendingSources();
  const note = await getAccessibleNote(noteId, user);
  if (!note) return { error: NextResponse.json({ error: 'Nota não encontrada ou sem acesso.' }, { status: 404 }) };
  return { noteId, user, note };
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const access = await getAuthorizedNote(request, params.id);
    if ('error' in access) return access.error;

    const result = await query(
      `SELECT id, note_id, user_id, original_name, mime_type, size_bytes, category, status, created_at, updated_at
       FROM note_sources
       WHERE note_id = $1
       ORDER BY created_at DESC`,
      [access.noteId],
    );
    return NextResponse.json({ sources: result.rows.map(sourceForClient) });
  } catch (error) {
    console.error('[note sources] Erro ao listar fontes:', error);
    return NextResponse.json({ error: 'Não foi possível carregar as fontes.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const access = await getAuthorizedNote(request, params.id);
    if ('error' in access) return access.error;

    if (!isS3Configured()) {
      return NextResponse.json(
        { error: 'O armazenamento S3 ainda não está configurado.' },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => null);
    const input = validateSourceUpload(body ?? {});
    if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });

    const objectKey = createSourceStagingObjectKey(access.note.user_id, access.noteId, input.fileName);
    const inserted = await query(
      `INSERT INTO note_sources (
         note_id, user_id, object_key, checksum_sha256, original_name, mime_type, size_bytes, category, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'uploading') RETURNING *`,
      [
        access.noteId,
        access.note.user_id,
        objectKey,
        input.checksumSha256,
        input.fileName,
        input.mimeType,
        input.sizeBytes,
        input.category,
      ],
    );
    const source = inserted.rows[0];

    try {
      const upload = await createSourceUploadPost(
        objectKey,
        input.mimeType,
        input.sizeBytes,
        input.checksumSha256,
      );
      return NextResponse.json(
        {
          source: sourceForClient(source),
          uploadUrl: upload.url,
          uploadFields: upload.fields,
        },
        { status: 201 },
      );
    } catch (error) {
      await query('DELETE FROM note_sources WHERE id = $1', [source.id]);
      console.error('[note sources] Erro ao assinar upload:', error);
      return NextResponse.json(
        { error: 'Não foi possível preparar o upload no armazenamento.' },
        { status: 503 },
      );
    }
  } catch (error) {
    console.error('[note sources] Erro ao criar upload:', error);
    return NextResponse.json({ error: 'Não foi possível preparar o upload.' }, { status: 500 });
  }
}