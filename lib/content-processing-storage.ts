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
  userId: number;
  noteId?: number | null;
  noteSourceId?: number | null;
  sourceType: string;
  sourceName?: string | null;
  extractionText: string;
  processedText: string;
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

export async function vectorizeProcessingRun(runId: string): Promise<void> {
  await ensureContentProcessingSchema();
  await query(
    `UPDATE content_processing_runs
     SET vectorization_status = 'processing', vectorization_error = NULL, updated_at = NOW()
     WHERE id = $1`,
    [runId],
  );
  const chunks = (
    await query(
      `SELECT id, text
       FROM content_processing_chunks
       WHERE processing_run_id = $1 AND block_type = 'chunk'
       ORDER BY chunk_index`,
      [runId],
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
         WHERE id = ANY($1::bigint[])`,
        [batch.map((chunk) => chunk.id)],
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
           WHERE id = $3`,
          [vectorToString(embeddings[index]), EMBEDDING_MODEL, batch[index].id],
        );
      }
    } catch (error) {
      failures += batch.length;
      await query(
        `UPDATE content_processing_chunks
         SET embedding_status = 'failed', embedding_error = $1, updated_at = NOW()
         WHERE id = ANY($2::bigint[])`,
        [safeError(error), batch.map((chunk) => chunk.id)],
      );
    }
  }

  const status = failures === 0 ? 'completed' : failures === chunks.length ? 'failed' : 'partial';
  await query(
    `UPDATE content_processing_runs
     SET vectorization_status = $1,
         vectorization_error = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [status, failures ? `${failures} de ${chunks.length} chunks falharam na vetorização.` : null, runId],
  );
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

export async function persistProcessingPipeline(input: PersistProcessingInput): Promise<string> {
  await ensureContentProcessingSchema();
  const runId = crypto.randomUUID();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO content_processing_runs (
         id, user_id, note_id, note_source_id, source_type, source_name,
         extraction_text, processed_text, extraction_metadata, tokenization, chunking,
         content_hash, tokenizer_schema_version, chunker_schema_version, embedding_model
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15)`,
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
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await vectorizeProcessingRun(runId);
  return runId;
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