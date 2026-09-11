import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getRuntimeAgent } from '@/lib/ai-agent-runtime';
import {
  getAccessibleNote,
  getAccessibleSource,
  getRequestUser,
} from '@/lib/note-sources';
import {
  validateChunkingPrerequisites,
  validateTokenizerPrerequisites,
  type ProcessingValidationKind,
  type TokenizerServiceStatus,
} from '@/lib/source-processing-validation';

export const runtime = 'nodejs';

function positiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function getSpaCyStatus(): Promise<TokenizerServiceStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const baseUrl = (process.env.SPACY_TOKENIZER_URL || 'http://127.0.0.1:5002').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return { available: false };
    const health = await response.json().catch(() => ({}));
    return {
      available: true,
      maxTextCharacters: Number.isFinite(Number(health.max_text_chars))
        ? Number(health.max_text_chars)
        : undefined,
      maxTokens: Number.isFinite(Number(health.max_tokens))
        ? Number(health.max_tokens)
        : undefined,
      maxSentences: Number.isFinite(Number(health.max_sentences))
        ? Number(health.max_sentences)
        : undefined,
    };
  } catch {
    return { available: false };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; sourceId: string } },
) {
  try {
    const noteId = positiveInteger(params.id);
    const sourceId = positiveInteger(params.sourceId);
    if (!noteId || !sourceId) {
      return NextResponse.json({ error: 'Fonte ou nota inválida.' }, { status: 400 });
    }
    const user = getRequestUser(request);
    if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    const note = await getAccessibleNote(noteId, user);
    const source = await getAccessibleSource(noteId, sourceId, user);
    if (!note || !source) {
      return NextResponse.json({ error: 'Fonte não encontrada.' }, { status: 404 });
    }
    const body = await request.json().catch(() => null);
    const kind = body?.kind as ProcessingValidationKind | undefined;
    if (kind !== 'tokenizer' && kind !== 'chunking') {
      return NextResponse.json({ error: 'Validação inválida.' }, { status: 400 });
    }

    const run = (
      await query(
        `SELECT source_type, processed_text, cleaned_transcription, cleaned_extraction_text,
                transcription_segments, tokenized_text
         FROM content_processing_runs
         WHERE id = $1 AND note_source_id = $2 AND is_current = TRUE`,
        [source.processing_run_id ?? null, sourceId],
      )
    ).rows[0] ?? null;

    if (kind === 'tokenizer') {
      return NextResponse.json({
        report: validateTokenizerPrerequisites(run, await getSpaCyStatus()),
      });
    }

    let agentAvailable = false;
    try {
      await getRuntimeAgent('chunking_agent');
      agentAvailable = true;
    } catch {
      agentAvailable = false;
    }
    return NextResponse.json({
      report: validateChunkingPrerequisites(
        run,
        agentAvailable,
        Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      ),
    });
  } catch (error) {
    console.error('[source validation] Não foi possível validar a fonte:', error);
    return NextResponse.json({ error: 'Não foi possível validar os pré-requisitos.' }, { status: 500 });
  }
}