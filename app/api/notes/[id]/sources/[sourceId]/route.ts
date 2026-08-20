import { NextRequest, NextResponse } from 'next/server';
import {
  ensureNoteSourcesSchema,
  getAccessibleNote,
  getAccessibleSource,
  getRequestUser,
  sourceForClient,
} from '@/lib/note-sources';
import { createSourceReadUrl, deleteSourceObject, isS3Configured } from '@/lib/s3';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

function parsePositiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function getAuthorizedSource(
  request: NextRequest,
  rawNoteId: string,
  rawSourceId: string,
) {
  const noteId = parsePositiveInteger(rawNoteId);
  const sourceId = parsePositiveInteger(rawSourceId);
  if (!noteId || !sourceId) {
    return { error: NextResponse.json({ error: 'Fonte ou nota inválida.' }, { status: 400 }) };
  }

  const user = getRequestUser(request);
  if (!user) return { error: NextResponse.json({ error: 'Não autorizado.' }, { status: 401 }) };

  await ensureNoteSourcesSchema();
  const note = await getAccessibleNote(noteId, user);
  if (!note) return { error: NextResponse.json({ error: 'Nota não encontrada ou sem acesso.' }, { status: 404 }) };

  const source = await getAccessibleSource(noteId, sourceId, user);
  if (!source) return { error: NextResponse.json({ error: 'Fonte não encontrada.' }, { status: 404 }) };
  return { noteId, sourceId, user, source };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; sourceId: string } },
) {
  try {
    const access = await getAuthorizedSource(request, params.id, params.sourceId);
    if ('error' in access) return access.error;
    if (access.source.status !== 'ready') {
      return NextResponse.json({ error: 'O upload desta fonte ainda não foi concluído.' }, { status: 409 });
    }
    if (!isS3Configured()) {
      return NextResponse.json({ error: 'O armazenamento S3 ainda não está configurado.' }, { status: 503 });
    }

    const download = new URL(request.url).searchParams.get('download') === '1';
    const url = await createSourceReadUrl(
      access.source.object_key,
      access.source.original_name,
      download,
    );
    return NextResponse.json({
      source: sourceForClient(access.source),
      url,
      expiresInSeconds: 600,
    });
  } catch (error) {
    console.error('[note sources] Erro ao criar leitura temporária:', error);
    return NextResponse.json({ error: 'Não foi possível abrir o arquivo.' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; sourceId: string } },
) {
  try {
    const access = await getAuthorizedSource(request, params.id, params.sourceId);
    if ('error' in access) return access.error;

    if (isS3Configured()) {
      await deleteSourceObject(access.source.object_key);
    }
    await query('DELETE FROM note_sources WHERE id = $1 AND note_id = $2', [
      access.sourceId,
      access.noteId,
    ]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[note sources] Erro ao remover fonte:', error);
    return NextResponse.json({ error: 'Não foi possível remover o arquivo.' }, { status: 500 });
  }
}