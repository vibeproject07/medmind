import { query } from '@/lib/db';
import { readSourceObject } from '@/lib/s3';
import { geminiProcessDocument, geminiTransformTranscription } from '@/lib/gemini';
import { extractTextFromDocx, extractTextFromPptx } from '@/lib/document-extract';
import {
  extractAudioFromVideo,
  groqTranscribeFile,
  groqTranscribeLargeFile,
  isVideoFile,
  MAX_SIZE_FOR_CHUNKED_TRANSCRIPTION,
} from '@/lib/groq-stt';
import { ensureNoteSourcesSchema } from '@/lib/note-sources';
import crypto from 'crypto';

const MAX_SINGLE_FILE_SIZE = 25 * 1024 * 1024;
const MAX_DOCUMENT_PROCESS_BYTES = 30 * 1024 * 1024;
const MAX_TEXT_PROCESS_BYTES = 5 * 1024 * 1024;

const DOCX_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

const PPTX_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
]);

type ProcessingSource = {
  id: number;
  object_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  category: 'document' | 'text' | 'image' | 'audio' | 'video';
  processing_claim_id: string;
};

const PROCESSING_LEASE_HOURS = 2;
let schemaReady: Promise<void> | null = null;

function ensureWorkerSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensureNoteSourcesSchema().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function maxProcessBytes(source: ProcessingSource): number {
  if (source.category === 'audio' || source.category === 'video') return MAX_SIZE_FOR_CHUNKED_TRANSCRIPTION;
  if (source.category === 'text') return MAX_TEXT_PROCESS_BYTES;
  return MAX_DOCUMENT_PROCESS_BYTES;
}

function userSafeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Não foi possível processar a fonte.';
  return message.slice(0, 600);
}

async function processSource(source: ProcessingSource): Promise<{ originalText?: string; result: string }> {
  const maximum = maxProcessBytes(source);
  if (Number(source.size_bytes) > maximum) {
    throw new Error(
      `Este arquivo pode ser armazenado, mas excede o limite de ${Math.round(maximum / 1024 / 1024)} MB para processamento por IA.`,
    );
  }

  const mimeType = source.mime_type.toLowerCase();
  const buffer = await readSourceObject(source.object_key);

  if (source.category === 'audio' || source.category === 'video') {
    if (!process.env.GROQ_API_KEY) throw new Error('Serviço de transcrição não configurado.');

    let audio = buffer;
    let filename = source.original_name;
    if (isVideoFile(filename, mimeType)) {
      const extracted = await extractAudioFromVideo(buffer, filename);
      audio = Buffer.from(extracted.audioBuffer);
      filename = extracted.audioFilename;
    }

    const transcription = audio.length > MAX_SINGLE_FILE_SIZE
      ? await groqTranscribeLargeFile(audio, filename)
      : await groqTranscribeFile(audio, filename);
    const result = await geminiTransformTranscription({
      transcription: transcription.text,
      instruction: 'Resuma a transcrição em material de estudo claro, organizado e em português do Brasil.',
      agentKey: 'ajuste_transcricao',
    });
    return { originalText: transcription.text, result };
  }

  if (source.category === 'text') {
    const originalText = buffer.toString('utf8');
    const result = await geminiTransformTranscription({
      transcription: originalText,
      instruction: 'Organize o conteúdo em material de estudo claro, estruturado e em português do Brasil.',
      agentKey: 'ajuste_transcricao',
    });
    return { originalText, result };
  }

  let originalText: string | undefined;
  if (DOCX_TYPES.has(mimeType)) {
    originalText = await extractTextFromDocx(buffer);
  } else if (PPTX_TYPES.has(mimeType)) {
    originalText = await extractTextFromPptx(buffer);
  }

  if (originalText !== undefined) {
    const result = await geminiTransformTranscription({
      transcription: originalText,
      instruction: 'Produza o material de estudo conforme as instruções do sistema.',
      agentKey: PPTX_TYPES.has(mimeType) ? 'resumo_pptx' : 'resumo_docx',
    });
    return { originalText, result };
  }

  const agentKey = source.category === 'image' ? 'resumo_imagem' : 'resumo_documento';
  const result = await geminiProcessDocument({ file: buffer, mimeType, agentKey });
  if (mimeType === 'application/pdf') {
    try {
      originalText = await geminiProcessDocument({ file: buffer, mimeType, agentKey: 'extrair_texto' });
    } catch {
      originalText = undefined;
    }
  }
  return { originalText, result };
}

async function claimNextSourceProcessing(): Promise<ProcessingSource | null> {
  const claimId = crypto.randomUUID();
  const claimed = await query(
    `WITH candidate AS (
       SELECT id
       FROM note_sources
       WHERE status = 'ready' AND processing_status = 'queued'
       ORDER BY updated_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE note_sources
     SET processing_status = 'processing',
         processing_error = NULL,
         processing_started_at = NOW(),
         processing_completed_at = NULL,
         processing_claim_id = $1,
         processing_lease_expires_at = NOW() + INTERVAL '${PROCESSING_LEASE_HOURS} hours',
         processing_attempts = processing_attempts + 1,
         updated_at = NOW()
     WHERE id IN (SELECT id FROM candidate)
     RETURNING id, object_key, original_name, mime_type, size_bytes, category, processing_claim_id`,
    [claimId],
  );
  return (claimed.rows[0] as ProcessingSource | undefined) ?? null;
}

async function runClaimedSourceProcessing(source: ProcessingSource): Promise<void> {
  try {
    const output = await processSource(source);
    await query(
      `UPDATE note_sources
       SET processing_status = 'completed',
           processing_original_text = $1,
           processing_result = $2,
           processing_error = NULL,
           processing_completed_at = NOW(),
           processing_claim_id = NULL,
           processing_lease_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $3 AND processing_claim_id = $4`,
      [output.originalText ?? null, output.result, source.id, source.processing_claim_id],
    );
  } catch (error) {
    await query(
      `UPDATE note_sources
       SET processing_status = 'failed',
           processing_error = $1,
           processing_completed_at = NOW(),
           processing_claim_id = NULL,
           processing_lease_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $2 AND processing_claim_id = $3`,
      [userSafeError(error), source.id, source.processing_claim_id],
    );
  }
}

/**
 * Claims and processes at most one persisted job. The standalone worker calls
 * this route serially, which bounds memory and AI-provider concurrency.
 */
export async function processNextQueuedSource(): Promise<boolean> {
  try {
    await ensureWorkerSchema();
    await recoverStalledSourceProcessing();
    const source = await claimNextSourceProcessing();
    if (!source) return false;
    await runClaimedSourceProcessing(source);
    return true;
  } catch (error) {
    console.error('[note source worker] Falha ao executar a fila de fontes:', error);
    return false;
  }
}

/** Requeue work whose worker lease expired after a restart or process failure. */
export async function recoverStalledSourceProcessing(): Promise<void> {
  await query(
    `UPDATE note_sources
     SET processing_status = 'queued',
         processing_error = 'O processamento anterior foi interrompido e será retomado.',
         processing_claim_id = NULL,
         processing_lease_expires_at = NULL,
         updated_at = NOW()
     WHERE status = 'ready'
       AND processing_status = 'processing'
       AND COALESCE(processing_lease_expires_at, processing_started_at + INTERVAL '${PROCESSING_LEASE_HOURS} hours') < NOW()`,
  );
}