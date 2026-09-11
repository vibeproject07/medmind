import { getPool, query } from '@/lib/db';
import { downloadSourceObjectToTempFile } from '@/lib/s3';
import {
  MAX_SIZE_FOR_CHUNKED_TRANSCRIPTION,
  transcribeMediaPath,
} from '@/lib/groq-stt';
import { ensureNoteSourcesSchema } from '@/lib/note-sources';
import crypto from 'crypto';
import { processWithBroadFileExtraction } from '@/lib/broad-file-extraction';
import { chunkTokenizedText, type ChunkingResult } from '@/lib/chunking-agent';
import type { SpacyTokenizationResult } from '@/lib/spacy-tokenizer';
import {
  cleanExtractionAgentOutput,
  cleanTranscriptionAgentOutput,
} from '@/lib/immediate-agent-output-cleaners';
import {
  ensureContentProcessingSchema,
  persistProcessingPipeline,
  processNextQueuedVectorization,
} from '@/lib/content-processing-storage';

const MAX_DOCUMENT_PROCESS_BYTES = 30 * 1024 * 1024;
const MAX_TEXT_PROCESS_BYTES = 5 * 1024 * 1024;

type ProcessingSource = {
  id: number;
  object_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  category: 'document' | 'text' | 'image' | 'audio' | 'video';
  processing_claim_id: string;
  processing_run_id: string;
  note_id: number;
  user_id: number;
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

type ProcessedSourceOutput = {
  originalText?: string;
  result: string;
  pipelineText: string;
  wholeTranscription?: string;
  cleanedTranscription?: string;
  wholeExtractionText?: string;
  cleanedExtractionText?: string;
  tokenization: SpacyTokenizationResult;
  chunking: ChunkingResult;
  extractionMetadata?: Record<string, unknown>;
};

async function processSource(source: ProcessingSource): Promise<ProcessedSourceOutput> {
  const maximum = maxProcessBytes(source);
  if (Number(source.size_bytes) > maximum) {
    throw new Error(
      `Este arquivo pode ser armazenado, mas excede o limite de ${Math.round(maximum / 1024 / 1024)} MB para processamento por IA.`,
    );
  }

  const mimeType = source.mime_type.toLowerCase();
  const downloaded = await downloadSourceObjectToTempFile(source.object_key, {
    expectedSize: Number(source.size_bytes),
    maxSize: maximum,
    extension: source.original_name.match(/\.[a-z0-9]{1,10}$/i)?.[0],
  });

  try {
    if (source.category === 'audio' || source.category === 'video') {
      if (!process.env.GROQ_API_KEY) throw new Error('Serviço de transcrição não configurado.');
      const transcription = await transcribeMediaPath(downloaded.path, source.original_name, mimeType);
      const cleanedTranscription = cleanTranscriptionAgentOutput(transcription.text);
      const pipeline = await chunkTokenizedText({
        text: cleanedTranscription,
        sourceType: transcription.videoConvertedToAudio ? 'video' : 'audio',
        segments: transcription.segments,
        contentFormat: 'plain',
      });
      return {
        originalText: cleanedTranscription,
        result: '',
        pipelineText: cleanedTranscription,
        wholeTranscription: transcription.rawText,
        cleanedTranscription,
        ...pipeline,
        extractionMetadata: {
          originalSize: transcription.originalSize,
          extractedSize: transcription.extractedSize,
          duration: transcription.duration,
          partCount: transcription.partCount,
          videoConvertedToAudio: transcription.videoConvertedToAudio,
        },
      };
    }

    const buffer = await import('node:fs/promises').then((fs) => fs.readFile(downloaded.path));
    if (source.category === 'text') {
      const originalText = buffer.toString('utf8');
      const { cleanedText } = cleanExtractionAgentOutput(originalText);
      const pipeline = await chunkTokenizedText({
        text: cleanedText,
        sourceType: 'text',
        contentFormat: 'plain',
      });
      return {
        originalText,
        result: cleanedText,
        pipelineText: cleanedText,
        wholeExtractionText: originalText,
        cleanedExtractionText: cleanedText,
        ...pipeline,
      };
    }

    const broad = await processWithBroadFileExtraction(buffer, mimeType);
    return {
      originalText: broad.originalText,
      result: broad.text,
      pipelineText: broad.text,
      wholeExtractionText: broad.wholeExtractionText,
      cleanedExtractionText: broad.text,
      tokenization: broad.tokenizationData,
      chunking: broad.chunking,
      extractionMetadata: {
        mimeType,
        sizeBytes: buffer.length,
        jsonWithDiscardFalse: broad.jsonWithDiscardFalse,
      },
    };
  } finally {
    await downloaded.cleanup();
  }
}

async function claimNextSourceProcessing(): Promise<ProcessingSource | null> {
  const claimId = crypto.randomUUID();
  const runId = crypto.randomUUID();
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
         processing_stage = 'downloading',
         processing_error = NULL,
         processing_started_at = NOW(),
         processing_completed_at = NULL,
         processing_claim_id = $1,
         processing_run_id = COALESCE(processing_run_id, $2),
         processing_last_heartbeat_at = NOW(),
         processing_lease_expires_at = NOW() + INTERVAL '${PROCESSING_LEASE_HOURS} hours',
         processing_attempts = processing_attempts + 1,
         updated_at = NOW()
     WHERE id IN (SELECT id FROM candidate)
     RETURNING id, note_id, user_id, object_key, original_name, mime_type, size_bytes, category,
               processing_claim_id, processing_run_id`,
    [claimId, runId],
  );
  return (claimed.rows[0] as ProcessingSource | undefined) ?? null;
}

async function runClaimedSourceProcessing(source: ProcessingSource): Promise<void> {
  let heartbeatFailed = false;
  const heartbeat = setInterval(() => {
    void query(
      `UPDATE note_sources
       SET processing_lease_expires_at = NOW() + INTERVAL '${PROCESSING_LEASE_HOURS} hours',
           processing_last_heartbeat_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND processing_claim_id = $2 AND processing_status = 'processing'`,
      [source.id, source.processing_claim_id],
    ).then((result) => {
      if (result.rowCount === 0) heartbeatFailed = true;
    }).catch(() => {
      heartbeatFailed = true;
    });
  }, 60_000);
  heartbeat.unref();
  try {
    await ensureContentProcessingSchema();
    const existingRun = await query(
      `SELECT id, extraction_text, processed_text, extraction_metadata->>'displayResult' AS display_result
       FROM content_processing_runs
       WHERE id = $1 AND note_source_id = $2 AND is_current = TRUE`,
      [source.processing_run_id, source.id],
    );
    const checkpoint = existingRun.rows[0] as {
      extraction_text: string;
      processed_text: string;
      display_result: string | null;
    } | undefined;
    if (checkpoint) {
      await query(
        `UPDATE note_sources
         SET processing_stage = 'awaiting_vectorization',
             processing_original_text = $1,
             processing_result = $2,
             processing_claim_id = NULL,
             processing_lease_expires_at = NULL,
             processing_last_heartbeat_at = NOW(),
             updated_at = NOW()
         WHERE id = $3 AND processing_claim_id = $4`,
        [
          checkpoint.extraction_text,
          checkpoint.display_result ?? checkpoint.processed_text,
          source.id,
          source.processing_claim_id,
        ],
      );
      return;
    }
    await query(
      `UPDATE note_sources
       SET processing_stage = $1, processing_last_heartbeat_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND processing_claim_id = $3`,
      [
        source.category === 'audio' || source.category === 'video' ? 'transcribing' : 'extracting',
        source.id,
        source.processing_claim_id,
      ],
    );
    const output = await processSource(source);
    const stageUpdate = await query(
      `UPDATE note_sources
       SET processing_stage = 'persisting', processing_last_heartbeat_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND processing_claim_id = $2`,
      [source.id, source.processing_claim_id],
    );
    if (heartbeatFailed || stageUpdate.rowCount === 0) {
      throw new Error('O lease do processamento foi perdido; o job será retomado.');
    }
    await persistProcessingPipeline({
      runId: source.processing_run_id,
      userId: source.user_id,
      noteId: source.note_id,
      noteSourceId: source.id,
      sourceType: source.category,
      sourceName: source.original_name,
      extractionText: output.originalText ?? output.pipelineText,
      processedText: output.pipelineText,
      wholeTranscription: output.wholeTranscription ?? null,
      cleanedTranscription: output.cleanedTranscription ?? null,
      wholeExtractionText: output.wholeExtractionText ?? null,
      cleanedExtractionText: output.cleanedExtractionText ?? null,
      extractionMetadata: {
        ...output.extractionMetadata,
        displayResult: output.result,
      },
      tokenization: output.tokenization,
      chunking: output.chunking,
    }, {
      vectorize: false,
      sourceCheckpoint: {
        sourceId: source.id,
        claimId: source.processing_claim_id,
        originalText: output.originalText ?? null,
        result: output.result,
      },
    });
  } catch (error) {
    await query(
      `UPDATE note_sources
       SET processing_status = 'failed',
           processing_stage = 'extraction_failed',
           processing_error = $1,
           processing_completed_at = NOW(),
           processing_claim_id = NULL,
           processing_lease_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $2 AND processing_claim_id = $3`,
      [userSafeError(error), source.id, source.processing_claim_id],
    );
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Claims and processes at most one persisted job. The standalone worker calls
 * this route serially, which bounds memory and AI-provider concurrency.
 */
async function oldestQueuedJobKind(): Promise<'source' | 'vector' | null> {
  await ensureContentProcessingSchema();
  const result = await query(`
    SELECT kind
    FROM (
      (SELECT 'source'::text AS kind, updated_at
       FROM note_sources
       WHERE status = 'ready' AND processing_status = 'queued'
       ORDER BY updated_at ASC
       LIMIT 1)
      UNION ALL
      (SELECT 'vector'::text AS kind, updated_at
       FROM content_processing_runs
       WHERE vectorization_status = 'pending'
       ORDER BY updated_at ASC
       LIMIT 1)
    ) jobs
    ORDER BY updated_at ASC
    LIMIT 1
  `);
  return (result.rows[0]?.kind as 'source' | 'vector' | undefined) ?? null;
}

export async function processNextQueuedSource(): Promise<boolean> {
  const schedulerClient = await getPool().connect();
  try {
    const lock = await schedulerClient.query(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [2_024_091_701],
    );
    if (!lock.rows[0]?.acquired) return false;
    await ensureWorkerSchema();
    await recoverStalledSourceProcessing();
    const oldestKind = await oldestQueuedJobKind();
    if (oldestKind === 'vector') {
      if (await processNextQueuedVectorization()) return true;
    }
    const source = await claimNextSourceProcessing();
    if (!source) return processNextQueuedVectorization();
    await runClaimedSourceProcessing(source);
    return true;
  } catch (error) {
    console.error('[note source worker] Falha ao executar a fila de fontes:', error);
    return false;
  } finally {
    await schedulerClient.query('SELECT pg_advisory_unlock($1)', [2_024_091_701]).catch(() => undefined);
    schedulerClient.release();
  }
}

/** Requeue work whose worker lease expired after a restart or process failure. */
export async function recoverStalledSourceProcessing(): Promise<void> {
  await query(
    `UPDATE note_sources
     SET processing_status = 'queued',
          processing_stage = 'queued',
         processing_error = 'O processamento anterior foi interrompido e será retomado.',
         processing_claim_id = NULL,
         processing_lease_expires_at = NULL,
         updated_at = NOW()
     WHERE status = 'ready'
       AND processing_status = 'processing'
        AND processing_stage <> 'awaiting_vectorization'
       AND COALESCE(processing_lease_expires_at, processing_started_at + INTERVAL '${PROCESSING_LEASE_HOURS} hours') < NOW()`,
  );
}