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
      return NextResponse.json({ error: 'Fonte ou nota inválida.' }, { status: 400 });
    }

    const user = getRequestUser(request);
    if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    if (!isS3Configured()) {
      return NextResponse.json({ error: 'O armazenamento S3 ainda não está configurado.' }, { status: 503 });
    }

    await ensureNoteSourcesSchema();
    const note = await getAccessibleNote(noteId, user);
    if (!note) return NextResponse.json({ error: 'Nota não encontrada ou sem acesso.' }, { status: 404 });
    const source = await getAccessibleSource(noteId, sourceId, user);
    if (!source) return NextResponse.json({ error: 'Fonte não encontrada.' }, { status: 404 });

    const uploaded = await getSourceObjectInfo(source.object_key);
    if (
      uploaded.size !== Number(source.size_bytes) ||
      !uploaded.checksumSha256 ||
      uploaded.checksumSha256 !== source.checksum_sha256
    ) {
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
      console.warn('[note sources] Não foi possível limpar objeto temporário:', error);
    });
    return NextResponse.json({ source: sourceForClient(result.rows[0]) });
  } catch (error) {
    console.error('[note sources] Erro ao confirmar upload:', error);
    return NextResponse.json(
      { error: 'Não foi possível confirmar o arquivo no armazenamento.' },
      { status: 500 },
    );
  }
}