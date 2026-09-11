import crypto from 'crypto';
import { getPool, query } from '@/lib/db';
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  generateEmbedding,
  generateEmbeddingsBatch,
  vectorToString,
} from '@/lib/embeddings';
import type { ChunkingResult } from '@/lib/chunking-agent';
import type { SpacyTokenizationResult } from '@/lib/spacy-tokenizer';
import { ensureNoteSourcesSchema } from '@/lib/note-sources';

export type PersistProcessingInput = {
  runId?: string;
  userId: number;
  noteId?: number | null;
  noteSourceId?: number | null;
  sourceType: string;
  sourceName?: string | null;
  extractionText: string;
  processedText: string;
  wholeTranscription?: string | null;
  cleanedTranscription?: string | null;
  transcriptionSegments?: unknown[] | null;
  wholeExtractionText?: string | null;
  cleanedExtractionText?: string | null;
  extractionMetadata?: Record<string, unknown>;
  tokenization: SpacyTokenizationResult;
  chunking: ChunkingResult;
};

let schemaReady: Promise<void> | null = null;

export function ensureContentProcessingSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensureNoteSourcesSchema();
      await query('CREATE EXTENSION IF NOT EXISTS vector');
      await query(`
        CREATE TABLE IF NOT EXISTS content_processing_runs (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
          note_source_id INTEGER REFERENCES note_sources(id) ON DELETE CASCADE,
          source_type TEXT NOT NULL,
          source_name TEXT,
          extraction_text TEXT NOT NULL,
          processed_text TEXT NOT NULL,
          extraction_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          tokenization JSONB NOT NULL,
          chunking JSONB NOT NULL,
          content_hash TEXT NOT NULL,
          tokenizer_schema_version TEXT,
          chunker_schema_version TEXT,
          embedding_model TEXT NOT NULL,
          vectorization_status TEXT NOT NULL DEFAULT 'pending'
            CHECK (vectorization_status IN ('pending', 'processing', 'completed', 'partial', 'failed')),
          vectorization_error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await query('ALTER TABLE content_processing_runs ADD COLUMN IF NOT EXISTS vectorization_attempts INTEGER NOT NULL DEFAULT 0');
      await query('ALTER TABLE content_processing_runs ADD COLUMN IF NOT EXISTS vectorization_started_at TIMESTAMPTZ');
      await query('ALTER TABLE content_processing_runs ADD COLUMN IF NOT EXISTS vectorization_claim_id TEXT');
      await query('ALTER TABLE content_processing_runs ADD COLUMN IF NOT EXISTS vectorization_lease_expires_at TIMESTAMPTZ');
      await query('ALTER TABLE content_processing_runs ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT TRUE');
      await query('ALTER TABLE content_processing_runs ADD COLUMN IF NOT EXISTS whole_transcription TEXT');
      await query('ALTER TABLE content_processing_runs ADD COLUMN IF NOT EXISTS cleaned_transcription TEXT');
      await query('ALTER TABLE content_processing_runs ADD COLUMN IF NOT EXISTS transcription_segments JSONB');
      await query('ALTER TABLE content_processing_runs ADD COLUMN IF NOT EXISTS whole_extraction_text TEXT');
      await query('ALTER TABLE content_processing_runs ADD COLUMN IF NOT EXISTS cleaned_extraction_text TEXT');
      await query('ALTER TABLE content_processing_runs ADD COLUMN IF NOT EXISTS tokenized_text JSONB');
      await query('ALTER TABLE content_processing_runs ADD COLUMN IF NOT EXISTS chunks JSONB');
      await query(`
        UPDATE content_processing_runs
        SET tokenized_text = COALESCE(tokenized_text, tokenization),
            chunks = COALESCE(chunks, chunking)
        WHERE tokenized_text IS NULL OR chunks IS NULL
      `);
      await query(`
        UPDATE content_processing_runs
        SET cleaned_transcription = processed_text
        WHERE cleaned_transcription IS NULL
          AND source_type IN ('audio', 'video')
      `);
      await query(`
        UPDATE content_processing_runs
        SET cleaned_extraction_text = processed_text
        WHERE cleaned_extraction_text IS NULL
          AND source_type IN ('document', 'image')
      `);
      await query(`
        CREATE TABLE IF NOT EXISTS content_processing_chunks (
          id BIGSERIAL PRIMARY KEY,
          processing_run_id TEXT NOT NULL REFERENCES content_processing_runs(id) ON DELETE CASCADE,
          chunk_index INTEGER NOT NULL,
          block_type TEXT NOT NULL CHECK (block_type IN ('chunk', 'discarded')),
          sentence_start INTEGER NOT NULL,
          sentence_end INTEGER NOT NULL,
          context TEXT,
          discard_reason TEXT,
          unit_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          text TEXT NOT NULL,
          text_hash TEXT NOT NULL,
          embedding vector(${EMBEDDING_DIM}),
          embedding_model TEXT,
          embedding_status TEXT NOT NULL DEFAULT 'pending'
            CHECK (embedding_status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
          embedding_error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (processing_run_id, chunk_index)
        )
      `);
      await query('CREATE INDEX IF NOT EXISTS idx_content_processing_runs_note ON content_processing_runs(note_id)');
      await query('CREATE INDEX IF NOT EXISTS idx_content_processing_runs_source ON content_processing_runs(note_source_id)');
      await query('CREATE INDEX IF NOT EXISTS idx_content_processing_runs_user ON content_processing_runs(user_id)');
      await query('CREATE INDEX IF NOT EXISTS idx_content_processing_chunks_run ON content_processing_chunks(processing_run_id)');
      await query(`
        CREATE INDEX IF NOT EXISTS idx_content_processing_runs_vectorization
        ON content_processing_runs(vectorization_status, updated_at)
        WHERE vectorization_status IN ('pending', 'processing')
      `);
      await query(`
        WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY note_source_id ORDER BY created_at DESC, id DESC
          ) AS position
          FROM content_processing_runs
          WHERE note_source_id IS NOT NULL AND is_current = TRUE
        )
        UPDATE content_processing_runs r
        SET is_current = FALSE
        FROM ranked
        WHERE r.id = ranked.id AND ranked.position > 1
      `);
      await query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_content_processing_runs_current_source
        ON content_processing_runs(note_source_id)
        WHERE note_source_id IS NOT NULL AND is_current = TRUE
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS content_processing_chunks_embedding_hnsw_idx
        ON content_processing_chunks
        USING hnsw ((embedding::halfvec(${EMBEDDING_DIM})) halfvec_cosine_ops)
        WHERE embedding IS NOT NULL
      `);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : 'Falha ao gerar embedding.').slice(0, 600);
}

export async function vectorizeProcessingRun(
  runId: string,
  claimId?: string,
): Promise<{ status: string; error: string | null; noteSourceId: number | null }> {
  await ensureContentProcessingSchema();
  await query(
    `UPDATE content_processing_runs
     SET vectorization_status = 'processing', vectorization_error = NULL, updated_at = NOW()
     WHERE id = $1
       AND ($2::text IS NULL OR vectorization_claim_id = $2)`,
    [runId, claimId ?? null],
  );
  const chunks = (
    await query(
      `SELECT id, text
       FROM content_processing_chunks
       WHERE processing_run_id = $1
         AND block_type = 'chunk'
         AND embedding_status <> 'completed'
         AND ($2::text IS NULL OR EXISTS (
           SELECT 1 FROM content_processing_runs r
           WHERE r.id = processing_run_id AND r.vectorization_claim_id = $2
         ))
       ORDER BY chunk_index`,
      [runId, claimId ?? null],
    )
  ).rows as Array<{ id: number; text: string }>;

  let failures = 0;
  const batchSize = 20;
  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const batch = chunks.slice(offset, offset + batchSize);
    try {
      await query(
        `UPDATE content_processing_chunks
         SET embedding_status = 'processing', embedding_error = NULL, updated_at = NOW()
         WHERE id = ANY($1::bigint[])
           AND embedding_status <> 'completed'
           AND ($2::text IS NULL OR EXISTS (
             SELECT 1 FROM content_processing_runs r
             WHERE r.id = processing_run_id AND r.vectorization_claim_id = $2
           ))`,
        [batch.map((chunk) => chunk.id), claimId ?? null],
      );
      let embeddings: number[][];
      try {
        embeddings = await generateEmbeddingsBatch(
          batch.map((chunk) => chunk.text),
          undefined,
          'RETRIEVAL_DOCUMENT',
        );
      } catch (batchError) {
        // A chamada individual mantém compatibilidade caso a API batch esteja
        // temporariamente indisponível ou ainda não habilitada no projeto.
        embeddings = [];
        for (const chunk of batch) {
          embeddings.push(await generateEmbedding(chunk.text, undefined, 'RETRIEVAL_DOCUMENT'));
        }
      }
      for (let index = 0; index < batch.length; index += 1) {
        await query(
          `UPDATE content_processing_chunks
           SET embedding = $1::vector, embedding_model = $2,
               embedding_status = 'completed', embedding_error = NULL, updated_at = NOW()
            WHERE id = $3
              AND ($4::text IS NULL OR EXISTS (
                SELECT 1 FROM content_processing_runs r
                WHERE r.id = processing_run_id AND r.vectorization_claim_id = $4
              ))`,
          [vectorToString(embeddings[index]), EMBEDDING_MODEL, batch[index].id, claimId ?? null],
        );
      }
    } catch (error) {
      failures += batch.length;
      await query(
        `UPDATE content_processing_chunks
         SET embedding_status = 'failed', embedding_error = $1, updated_at = NOW()
         WHERE id = ANY($2::bigint[])
           AND ($3::text IS NULL OR EXISTS (
             SELECT 1 FROM content_processing_runs r
             WHERE r.id = processing_run_id AND r.vectorization_claim_id = $3
           ))`,
        [safeError(error), batch.map((chunk) => chunk.id), claimId ?? null],
      );
    }
  }

  const counts = (
    await query(
      `SELECT
         COUNT(*) FILTER (WHERE block_type = 'chunk')::integer AS total,
         COUNT(*) FILTER (WHERE block_type = 'chunk' AND embedding_status = 'completed')::integer AS completed,
         COUNT(*) FILTER (WHERE block_type = 'chunk' AND embedding_status = 'failed')::integer AS failed
       FROM content_processing_chunks
       WHERE processing_run_id = $1`,
      [runId],
    )
  ).rows[0] as { total: number; completed: number; failed: number };
  const total = Number(counts.total);
  const completed = Number(counts.completed);
  const failed = Number(counts.failed);
  const status = completed === total ? 'completed' : completed > 0 ? 'partial' : 'failed';
  const finalized = await query(
    `UPDATE content_processing_runs
     SET vectorization_status = $1,
         vectorization_error = $2,
          vectorization_claim_id = NULL,
          vectorization_lease_expires_at = NULL,
         updated_at = NOW()
     WHERE id = $3
       AND ($4::text IS NULL OR vectorization_claim_id = $4)
     RETURNING vectorization_status, vectorization_error, note_source_id`,
    [status, failed ? `${failed} de ${total} chunks falharam na vetorização.` : null, runId, claimId ?? null],
  );
  const terminal = finalized.rows[0] as {
    vectorization_status: string;
    vectorization_error: string | null;
    note_source_id: number | null;
  } | undefined;
  if (!terminal) throw new Error('O lease da vetorização foi perdido; o job será retomado.');
  return {
    status: terminal.vectorization_status,
    error: terminal.vectorization_error,
    noteSourceId: terminal.note_source_id,
  };
}

export async function findSimilarProcessingChunks(
  queryText: string,
  options: { userId: number; noteId?: number; limit?: number },
): Promise<Array<{
  id: number;
  processing_run_id: string;
  note_id: number | null;
  text: string;
  context: string | null;
  similarity: number;
}>> {
  await ensureContentProcessingSchema();
  const embedding = await generateEmbedding(queryText, undefined, 'RETRIEVAL_QUERY');
  const limit = Math.min(50, Math.max(1, options.limit ?? 10));
  const result = await query(
    `SELECT c.id, c.processing_run_id, r.note_id, c.text, c.context,
            1 - (c.embedding <=> $1::vector) AS similarity
     FROM content_processing_chunks c
     JOIN content_processing_runs r ON r.id = c.processing_run_id
     WHERE r.user_id = $2
        AND r.is_current = TRUE
       AND ($3::integer IS NULL OR r.note_id = $3)
       AND c.block_type = 'chunk'
       AND c.embedding_status = 'completed'
       AND c.embedding IS NOT NULL
     ORDER BY c.embedding <=> $1::vector
     LIMIT $4`,
    [vectorToString(embedding), options.userId, options.noteId ?? null, limit],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    processing_run_id: String(row.processing_run_id),
    note_id: row.note_id === null ? null : Number(row.note_id),
    text: String(row.text),
    context: row.context === null ? null : String(row.context),
    similarity: Number(row.similarity),
  }));
}

export async function persistProcessingPipeline(
  input: PersistProcessingInput,
  options: {
    vectorize?: boolean;
    sourceCheckpoint?: {
      sourceId: number;
      claimId: string;
      originalText: string | null;
      result: string;
    };
  } = {},
): Promise<string> {
  await ensureContentProcessingSchema();
  const runId = input.runId ?? crypto.randomUUID();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO content_processing_runs (
         id, user_id, note_id, note_source_id, source_type, source_name,
         extraction_text, processed_text, extraction_metadata, tokenization, chunking,
           whole_transcription, cleaned_transcription, transcription_segments,
           whole_extraction_text, cleaned_extraction_text,
          tokenized_text, chunks, content_hash, tokenizer_schema_version, chunker_schema_version,
          embedding_model
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,
           $12,$13,$14::jsonb,$15,$16,$17::jsonb,$18::jsonb,$19,$20,$21,$22
        )`,
      [
        runId,
        input.userId,
        input.noteId ?? null,
        input.noteSourceId ?? null,
        input.sourceType,
        input.sourceName ?? null,
        input.extractionText,
        input.processedText,
        JSON.stringify(input.extractionMetadata ?? {}),
        JSON.stringify(input.tokenization),
        JSON.stringify(input.chunking),
         input.wholeTranscription ?? null,
         input.cleanedTranscription ?? null,
         input.transcriptionSegments ? JSON.stringify(input.transcriptionSegments) : null,
         input.wholeExtractionText ?? null,
         input.cleanedExtractionText ?? null,
         JSON.stringify(input.tokenization),
         JSON.stringify(input.chunking),
        hashText(input.processedText),
        input.tokenization.schema_version,
        input.chunking.schema_version,
        EMBEDDING_MODEL,
      ],
    );
    for (let index = 0; index < input.chunking.blocks.length; index += 1) {
      const block = input.chunking.blocks[index];
      await client.query(
        `INSERT INTO content_processing_chunks (
           processing_run_id, chunk_index, block_type, sentence_start, sentence_end,
           context, discard_reason, unit_ids, text, text_hash, embedding_status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
        [
          runId,
          index,
          block.type,
          block.sentence_start,
          block.sentence_end,
          block.context ?? null,
          block.reason ?? null,
          JSON.stringify(block.unit_ids),
          block.text,
          hashText(block.text),
          block.type === 'chunk' ? 'pending' : 'skipped',
        ],
      );
    }
    if (options.sourceCheckpoint) {
      const checkpoint = options.sourceCheckpoint;
      const updated = await client.query(
        `UPDATE note_sources
         SET processing_status = 'processing',
             processing_stage = 'awaiting_vectorization',
             processing_original_text = $1,
             processing_result = $2,
             processing_error = NULL,
             processing_completed_at = NULL,
             processing_claim_id = NULL,
             processing_lease_expires_at = NULL,
             processing_last_heartbeat_at = NOW(),
             updated_at = NOW()
         WHERE id = $3 AND processing_claim_id = $4 AND processing_run_id = $5`,
        [checkpoint.originalText, checkpoint.result, checkpoint.sourceId, checkpoint.claimId, runId],
      );
      if (updated.rowCount !== 1) {
        throw new Error('O lease do processamento foi perdido antes do checkpoint; a transação foi cancelada.');
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (options.vectorize !== false) await vectorizeProcessingRun(runId);
  return runId;
}

const VECTORIZATION_LEASE_MINUTES = 30;

export async function recoverStalledVectorization(): Promise<void> {
  await ensureContentProcessingSchema();
  await query(`
    UPDATE content_processing_runs
    SET vectorization_status = 'pending',
        vectorization_error = 'A vetorização anterior foi interrompida e será retomada.',
        vectorization_claim_id = NULL,
        vectorization_lease_expires_at = NULL,
        updated_at = NOW()
    WHERE vectorization_status = 'processing'
      AND vectorization_lease_expires_at < NOW()
  `);
  await query(`
    UPDATE content_processing_chunks c
    SET embedding_status = 'pending', embedding_error = NULL, updated_at = NOW()
    FROM content_processing_runs r
    WHERE c.processing_run_id = r.id
      AND r.vectorization_status = 'pending'
      AND c.block_type = 'chunk'
      AND c.embedding_status = 'processing'
  `);
}

async function claimNextVectorizationRun(): Promise<{ runId: string; claimId: string; noteSourceId: number | null } | null> {
  const claimId = crypto.randomUUID();
  const claimed = await query(
    `WITH candidate AS (
       SELECT id
       FROM content_processing_runs
       WHERE vectorization_status = 'pending'
       ORDER BY updated_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE content_processing_runs
     SET vectorization_status = 'processing',
         vectorization_error = NULL,
         vectorization_started_at = NOW(),
         vectorization_attempts = vectorization_attempts + 1,
         vectorization_claim_id = $1,
         vectorization_lease_expires_at = NOW() + INTERVAL '${VECTORIZATION_LEASE_MINUTES} minutes',
         updated_at = NOW()
     WHERE id IN (SELECT id FROM candidate)
     RETURNING id, note_source_id`,
    [claimId],
  );
  const row = claimed.rows[0] as { id: string; note_source_id: number | null } | undefined;
  return row ? { runId: row.id, claimId, noteSourceId: row.note_source_id } : null;
}

export async function processNextQueuedVectorization(): Promise<boolean> {
  await recoverStalledVectorization();
  const job = await claimNextVectorizationRun();
  if (!job) return false;
  if (job.noteSourceId) {
    await query(
      `UPDATE note_sources
       SET processing_stage = 'vectorizing', processing_last_heartbeat_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND processing_run_id = $2`,
      [job.noteSourceId, job.runId],
    );
  }
  let heartbeatFailed = false;
  const heartbeat = setInterval(() => {
    void query(
      `UPDATE content_processing_runs
       SET vectorization_lease_expires_at = NOW() + INTERVAL '${VECTORIZATION_LEASE_MINUTES} minutes',
           updated_at = NOW()
       WHERE id = $1 AND vectorization_claim_id = $2 AND vectorization_status = 'processing'`,
      [job.runId, job.claimId],
    ).then((result) => {
      if (result.rowCount === 0) heartbeatFailed = true;
    }).catch(() => {
      heartbeatFailed = true;
    });
  }, 60_000);
  heartbeat.unref();
  try {
    const terminal = await vectorizeProcessingRun(job.runId, job.claimId);
    if (heartbeatFailed) throw new Error('O lease da vetorização foi perdido; o job será retomado.');
    if (job.noteSourceId) {
      const completed = terminal.status === 'completed';
      await query(
        `UPDATE note_sources
         SET processing_status = $1,
             processing_stage = $2,
             processing_error = $3,
             processing_completed_at = NOW(),
             processing_last_heartbeat_at = NOW(),
             updated_at = NOW()
         WHERE id = $4 AND processing_run_id = $5`,
        [
          completed ? 'completed' : 'failed',
          completed ? 'completed' : 'vectorization_failed',
          completed ? null : terminal.error,
          job.noteSourceId,
          job.runId,
        ],
      );
    }
  } catch (error) {
    const message = safeError(error);
    const failedRun = await query(
      `UPDATE content_processing_runs
       SET vectorization_status = 'failed', vectorization_error = $1,
           vectorization_claim_id = NULL, vectorization_lease_expires_at = NULL, updated_at = NOW()
       WHERE id = $2 AND vectorization_claim_id = $3`,
      [message, job.runId, job.claimId],
    );
    if (job.noteSourceId && failedRun.rowCount === 1) {
      await query(
        `UPDATE note_sources
         SET processing_status = 'failed', processing_stage = 'vectorization_failed',
             processing_error = $1, processing_completed_at = NOW(), updated_at = NOW()
         WHERE id = $2 AND processing_run_id = $3`,
        [message, job.noteSourceId, job.runId],
      );
    }
  }
  finally {
    clearInterval(heartbeat);
  }
  return true;
}

export async function linkProcessingRunsToNote(
  runIds: string[],
  noteId: number,
  userId: number,
): Promise<void> {
  if (runIds.length === 0) return;
  await ensureContentProcessingSchema();
  await query(
    `UPDATE content_processing_runs
     SET note_id = $1, updated_at = NOW()
     WHERE id = ANY($2::text[]) AND user_id = $3 AND note_id IS NULL`,
    [noteId, runIds, userId],
  );
}