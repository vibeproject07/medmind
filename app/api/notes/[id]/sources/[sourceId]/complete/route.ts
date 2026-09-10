import { NextRequest, NextResponse } from 'next/server';
import {
  ensureNoteSourcesSchema,
  getAccessibleNote,
  getAccessibleSource,
  getRequestUser,
  sourceForClient,
} from '@/lib/note-sources';
import {
  createSourceObjectKey,
  deleteSourceObject,
  getSourceObjectInfo,
  isS3Configured,
  promoteSourceObject,
} from '@/lib/s3';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

function parsePositiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; sourceId: string } },
) {
  try {
    const noteId = parsePositiveInteger(params.id);
    const sourceId = parsePositiveInteger(params.sourceId);
    if (!noteId || !sourceId) {
      console.warn('[source-upload] Nota ou fonte inválida ao confirmar upload.', {
        rawNoteId: params.id,
        rawSourceId: params.sourceId,
      });
      return NextResponse.json({ error: 'Fonte ou nota inválida.' }, { status: 400 });
    }

    const user = getRequestUser(request);
    if (!user) {
      console.warn('[source-upload] Requisição não autorizada ao confirmar upload.', {
        noteId,
        sourceId,
      });
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }
    if (!isS3Configured()) {
      console.error('[source-upload] S3 não configurado ao confirmar upload.', {
        noteId,
        sourceId,
        userId: user.id,
      });
      return NextResponse.json({ error: 'O armazenamento S3 ainda não está configurado.' }, { status: 503 });
    }

    await ensureNoteSourcesSchema();
    const note = await getAccessibleNote(noteId, user);
    if (!note) {
      console.warn('[source-upload] Nota não encontrada ou sem acesso ao confirmar upload.', {
        noteId,
        sourceId,
        userId: user.id,
      });
      return NextResponse.json({ error: 'Nota não encontrada ou sem acesso.' }, { status: 404 });
    }
    const source = await getAccessibleSource(noteId, sourceId, user);
    if (!source) {
      console.warn('[source-upload] Fonte não encontrada ao confirmar upload.', {
        noteId,
        sourceId,
        userId: user.id,
      });
      return NextResponse.json({ error: 'Fonte não encontrada.' }, { status: 404 });
    }

    const uploaded = await getSourceObjectInfo(source.object_key);
    if (
      uploaded.size !== Number(source.size_bytes) ||
      !uploaded.checksumSha256 ||
      uploaded.checksumSha256 !== source.checksum_sha256
    ) {
      console.error('[source-upload] Integridade do arquivo enviado não confere.', {
        noteId,
        sourceId,
        expectedSize: Number(source.size_bytes),
        receivedSize: uploaded.size,
        hasExpectedChecksum: Boolean(source.checksum_sha256),
        hasReceivedChecksum: Boolean(uploaded.checksumSha256),
        checksumMatches: uploaded.checksumSha256 === source.checksum_sha256,
      });
      await deleteSourceObject(source.object_key).catch(() => undefined);
      await query('DELETE FROM note_sources WHERE id = $1', [sourceId]);
      return NextResponse.json(
        { error: 'O tamanho recebido não corresponde ao arquivo selecionado. Tente enviar novamente.' },
        { status: 422 },
      );
    }

    const finalObjectKey = createSourceObjectKey(note.user_id, noteId, source.original_name);
    await promoteSourceObject(source.object_key, finalObjectKey);
    const result = await query(
      `UPDATE note_sources
       SET object_key = $1, status = 'ready', updated_at = NOW()
       WHERE id = $2 AND note_id = $3
       RETURNING *`,
      [finalObjectKey, sourceId, noteId],
    );
    await deleteSourceObject(source.object_key).catch((error) => {
      console.warn('[source-upload] Não foi possível limpar objeto temporário após promoção.', {
        noteId,
        sourceId,
        error,
      });
    });
    return NextResponse.json({ source: sourceForClient(result.rows[0]) });
  } catch (error) {
    console.error('[source-upload] Erro inesperado ao confirmar upload.', {
      rawNoteId: params.id,
      rawSourceId: params.sourceId,
      error,
    });
    return NextResponse.json(
      { error: 'Não foi possível confirmar o arquivo no armazenamento.' },
      { status: 500 },
    );
  }
}