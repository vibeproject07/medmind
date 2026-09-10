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
  if (!noteId) {
    console.warn('[source-upload] Identificador de nota inválido ao preparar upload.', {
      rawNoteId: rawId,
    });
    return { error: NextResponse.json({ error: 'Nota inválida.' }, { status: 400 }) };
  }

  const user = getRequestUser(request);
  if (!user) {
    console.warn('[source-upload] Requisição não autorizada ao preparar upload.', {
      noteId,
    });
    return { error: NextResponse.json({ error: 'Não autorizado.' }, { status: 401 }) };
  }

  await ensureNoteSourcesSchema();
  await clearExpiredPendingSources();
  const note = await getAccessibleNote(noteId, user);
  if (!note) {
    console.warn('[source-upload] Nota não encontrada ou sem acesso ao preparar upload.', {
      noteId,
      userId: user.id,
    });
    return { error: NextResponse.json({ error: 'Nota não encontrada ou sem acesso.' }, { status: 404 }) };
  }
  return { noteId, user, note };
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const access = await getAuthorizedNote(request, params.id);
    if ('error' in access) return access.error;

    const result = await query(
      `SELECT id, note_id, user_id, original_name, mime_type, size_bytes, category, status,
              processing_status, processing_original_text, processing_result, processing_error,
              processing_attempts, processing_started_at, processing_completed_at, created_at, updated_at
       FROM note_sources
       WHERE note_id = $1
       ORDER BY created_at ASC, id ASC`,
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
      console.error('[source-upload] S3 não configurado ao preparar upload.', {
        noteId: access.noteId,
        userId: access.user.id,
      });
      return NextResponse.json(
        { error: 'O armazenamento S3 ainda não está configurado.' },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => null);
    const input = validateSourceUpload(body ?? {});
    if ('error' in input) {
      console.error('[source-upload] Dados do arquivo rejeitados na preparação.', {
        noteId: access.noteId,
        userId: access.user.id,
        validationError: input.error,
        mimeType: typeof body?.mimeType === 'string' ? body.mimeType : null,
        sizeBytes: typeof body?.sizeBytes === 'number' ? body.sizeBytes : null,
      });
      return NextResponse.json({ error: input.error }, { status: 400 });
    }

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
      console.error('[source-upload] Erro ao assinar upload no S3.', {
        noteId: access.noteId,
        userId: access.user.id,
        sourceId: source.id,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        error,
      });
      return NextResponse.json(
        { error: 'Não foi possível preparar o upload no armazenamento.' },
        { status: 503 },
      );
    }
  } catch (error) {
    console.error('[source-upload] Erro inesperado ao preparar upload.', {
      rawNoteId: params.id,
      error,
    });
    return NextResponse.json({ error: 'Não foi possível preparar o upload.' }, { status: 500 });
  }
}