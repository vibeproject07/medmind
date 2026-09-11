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
import {
  createSourceStagingObjectKey,
  createSourceUploadPost,
  ensureSourceUploadCors,
  isS3Configured,
} from '@/lib/s3';
import { logSourceUploadFailure } from '@/lib/source-upload-diagnostics';
import { ensureContentProcessingSchema } from '@/lib/content-processing-storage';

export const runtime = 'nodejs';

function getNoteId(rawId: string): number | null {
  const noteId = Number(rawId);
  return Number.isInteger(noteId) && noteId > 0 ? noteId : null;
}

async function getAuthorizedNote(request: NextRequest, rawId: string) {
  const noteId = getNoteId(rawId);
  if (!noteId) {
    logSourceUploadFailure('Identificador de nota inválido ao preparar upload.', {
      rawNoteId: rawId,
    });
    return { error: NextResponse.json({ error: 'Nota inválida.' }, { status: 400 }) };
  }

  const user = getRequestUser(request);
  if (!user) {
    logSourceUploadFailure('Requisição não autorizada ao preparar upload.', {
      noteId,
    });
    return { error: NextResponse.json({ error: 'Não autorizado.' }, { status: 401 }) };
  }

  await ensureNoteSourcesSchema();
  await clearExpiredPendingSources();
  const note = await getAccessibleNote(noteId, user);
  if (!note) {
    logSourceUploadFailure('Nota não encontrada ou sem acesso ao preparar upload.', {
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

    await ensureContentProcessingSchema();
    const result = await query(
      `SELECT ns.id, ns.note_id, ns.user_id, ns.original_name, ns.mime_type, ns.size_bytes,
              ns.category, ns.status, ns.processing_status, ns.processing_original_text,
              ns.processing_result, ns.processing_error, ns.processing_attempts,
              ns.processing_started_at, ns.processing_completed_at, ns.created_at, ns.updated_at,
              r.cleaned_transcription, r.cleaned_extraction_text
       FROM note_sources ns
       LEFT JOIN content_processing_runs r ON r.id = ns.processing_run_id
       WHERE ns.note_id = $1
       ORDER BY ns.created_at ASC, ns.id ASC`,
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
      logSourceUploadFailure('S3 não configurado ao preparar upload.', {
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
      logSourceUploadFailure('Dados do arquivo rejeitados na preparação.', {
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
      const requestOrigin = request.headers.get('origin') ?? new URL(request.url).origin;
      await ensureSourceUploadCors(requestOrigin);
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
      logSourceUploadFailure('Erro ao configurar CORS ou assinar upload no S3.', {
        noteId: access.noteId,
        userId: access.user.id,
        sourceId: source.id,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      }, error);
      return NextResponse.json(
        { error: 'Não foi possível preparar o upload no armazenamento.' },
        { status: 503 },
      );
    }
  } catch (error) {
    logSourceUploadFailure('Erro inesperado ao preparar upload.', {
      rawNoteId: params.id,
    }, error);
    return NextResponse.json({ error: 'Não foi possível preparar o upload.' }, { status: 500 });
  }
}