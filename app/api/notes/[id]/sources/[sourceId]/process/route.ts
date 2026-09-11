import { NextRequest, NextResponse } from 'next/server';
import {
  ensureNoteSourcesSchema,
  getAccessibleNote,
  getAccessibleSource,
  getRequestUser,
  sourceForClient,
} from '@/lib/note-sources';
import { query } from '@/lib/db';
import { ensureContentProcessingSchema } from '@/lib/content-processing-storage';

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
    if (source.processing_stage === 'vectorization_failed' && source.processing_run_id) {
      await ensureContentProcessingSchema();
      const retried = await query(
        `WITH reset_run AS (
           UPDATE content_processing_runs
           SET vectorization_status = 'pending', vectorization_error = NULL,
               vectorization_claim_id = NULL, vectorization_lease_expires_at = NULL, updated_at = NOW()
           WHERE id = $1
             AND vectorization_status IN ('failed', 'partial')
             AND vectorization_claim_id IS NULL
           RETURNING id
         ),
         reset_chunks AS (
           UPDATE content_processing_chunks
           SET embedding_status = 'pending', embedding_error = NULL, updated_at = NOW()
           WHERE processing_run_id IN (SELECT id FROM reset_run)
             AND block_type = 'chunk'
             AND embedding_status <> 'completed'
         )
         UPDATE note_sources
         SET processing_status = 'processing', processing_stage = 'awaiting_vectorization',
             processing_error = NULL, processing_completed_at = NULL, updated_at = NOW()
         WHERE id = $2 AND note_id = $3
           AND processing_run_id IN (SELECT id FROM reset_run)
         RETURNING *`,
        [source.processing_run_id, source.id, noteId],
      );
      if (!retried.rows[0]) {
        return NextResponse.json({ error: 'A vetorização já está sendo retomada por outro worker.' }, { status: 409 });
      }
      return NextResponse.json({ source: sourceForClient(retried.rows[0]) }, { status: 202 });
    }

    await ensureContentProcessingSchema();
    const queued = await query(
      `WITH superseded AS (
         UPDATE content_processing_runs
         SET is_current = FALSE, updated_at = NOW()
         WHERE id = $3 AND note_source_id = $1
           AND is_current = TRUE
           AND vectorization_claim_id IS NULL
         RETURNING id
       )
       UPDATE note_sources
       SET processing_status = 'queued',
           processing_stage = 'queued',
           processing_original_text = NULL,
           processing_result = NULL,
           processing_error = NULL,
           processing_completed_at = NULL,
           processing_claim_id = NULL,
           processing_lease_expires_at = NULL,
           processing_run_id = NULL,
           processing_last_heartbeat_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND note_id = $2
         AND processing_status IN ('completed', 'failed', 'idle')
         AND processing_run_id IS NOT DISTINCT FROM $3
         AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM superseded))
       RETURNING *`,
      [source.id, noteId, source.processing_run_id ?? null],
    );
    const queuedSource = queued.rows[0];
    if (!queuedSource) {
      return NextResponse.json({ error: 'O processamento atual ainda está sendo finalizado. Tente novamente.' }, { status: 409 });
    }
    return NextResponse.json({ source: sourceForClient(queuedSource) }, { status: 202 });
  } catch (error) {
    console.error('[note sources] Erro ao processar fonte no S3:', error);
    const message = error instanceof Error ? error.message : 'Não foi possível processar a fonte.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}