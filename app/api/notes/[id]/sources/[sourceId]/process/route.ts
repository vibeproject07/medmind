import { NextRequest, NextResponse } from 'next/server';
import {
  ensureNoteSourcesSchema,
  getAccessibleNote,
  getAccessibleSource,
  getRequestUser,
  sourceForClient,
} from '@/lib/note-sources';
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
    if (!noteId || !sourceId) return NextResponse.json({ error: 'Fonte ou nota inválida.' }, { status: 400 });

    const user = getRequestUser(request);
    if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });

    await ensureNoteSourcesSchema();
    const note = await getAccessibleNote(noteId, user);
    if (!note) return NextResponse.json({ error: 'Nota não encontrada ou sem acesso.' }, { status: 404 });
    const source = await getAccessibleSource(noteId, sourceId, user);
    if (!source) return NextResponse.json({ error: 'Fonte não encontrada.' }, { status: 404 });
    if (source.status !== 'ready') {
      return NextResponse.json({ error: 'Aguarde a conclusão do upload antes de processar.' }, { status: 409 });
    }
    if (source.processing_status === 'queued' || source.processing_status === 'processing') {
      return NextResponse.json({ source: sourceForClient(source) }, { status: 202 });
    }

    const queued = await query(
      `UPDATE note_sources
       SET processing_status = 'queued',
           processing_original_text = NULL,
           processing_result = NULL,
           processing_error = NULL,
           processing_completed_at = NULL,
           processing_claim_id = NULL,
           processing_lease_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $1 AND note_id = $2
       RETURNING *`,
      [source.id, noteId],
    );
    const queuedSource = queued.rows[0];
    return NextResponse.json({ source: sourceForClient(queuedSource) }, { status: 202 });
  } catch (error) {
    console.error('[note sources] Erro ao processar fonte no S3:', error);
    const message = error instanceof Error ? error.message : 'Não foi possível processar a fonte.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}