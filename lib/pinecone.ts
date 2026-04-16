/**
 * Pinecone vector database integration for MedMind
 * Manages the `medmind-questions` index (or PINECONE_INDEX_NAME)
 *
 * Architecture:
 *  - When PINECONE_API_KEY is set  → Pinecone is the primary vector store
 *  - When not set                  → pgvector fallback (lib/embeddings.ts)
 *
 * Index spec:
 *  - Dimensions : 3072 (gemini-embedding-001)
 *  - Metric     : cosine
 *  - Serverless : AWS us-east-1
 */

import { Pinecone, type Index } from '@pinecone-database/pinecone';

export const PINECONE_DIM = 3072;

// ── Metadata stored alongside each vector ─────────────────────────────────────

export interface QuestionMetadata {
  question_id: number;
  statement_preview: string; // first 300 chars
  exam_year: number | null;
  exam_board: string | null;
  exam_institution: string | null;
  tags: string;             // JSON string (Pinecone metadata must be primitives/arrays)
  areas_conhecimento: string; // JSON string
}

// ── Singleton client ──────────────────────────────────────────────────────────

let _client: Pinecone | null = null;

export function isPineconeEnabled(): boolean {
  return !!process.env.PINECONE_API_KEY?.trim();
}

export function getPineconeClient(): Pinecone {
  if (!isPineconeEnabled()) {
    throw new Error('PINECONE_API_KEY is not configured');
  }
  if (!_client) {
    _client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY!.trim() });
  }
  return _client;
}

export function getIndexName(): string {
  return (process.env.PINECONE_INDEX_NAME ?? 'medmind-questions').trim();
}

// ── Index management ──────────────────────────────────────────────────────────

let _index: Index<QuestionMetadata> | null = null;

/**
 * Returns a ready-to-use Pinecone Index handle.
 * Creates the serverless index automatically if it doesn't exist yet.
 */
export async function getPineconeIndex(): Promise<Index<QuestionMetadata>> {
  if (_index) return _index;

  const pc = getPineconeClient();
  const name = getIndexName();

  // Check if index already exists
  const { indexes } = await pc.listIndexes();
  const exists = (indexes ?? []).some((idx) => idx.name === name);

  if (!exists) {
    console.log(`[pinecone] Creating serverless index "${name}" (dim=${PINECONE_DIM}, metric=cosine)…`);
    await pc.createIndex({
      name,
      dimension: PINECONE_DIM,
      metric: 'cosine',
      spec: {
        serverless: {
          cloud: 'aws',
          region: 'us-east-1',
        },
      },
      waitUntilReady: true,
    });
    console.log(`[pinecone] Index "${name}" ready.`);
  }

  _index = pc.index<QuestionMetadata>(name);
  return _index;
}

// ── Vector ID convention ──────────────────────────────────────────────────────

export const toVectorId = (questionId: number): string => `q-${questionId}`;
export const fromVectorId = (vectorId: string): number => parseInt(vectorId.replace(/^q-/, ''));

// ── Upsert ────────────────────────────────────────────────────────────────────

export async function upsertQuestionEmbedding(
  questionId: number,
  embedding: number[],
  meta: {
    statement: string;
    exam_year?: number | null;
    exam_board?: string | null;
    exam_institution?: string | null;
    tags?: string[] | string | null;
    areas_conhecimento?: string[] | string | null;
  }
): Promise<void> {
  const index = await getPineconeIndex();

  const parseTags = (v: string[] | string | null | undefined): string[] => {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    try { return JSON.parse(v); } catch { return []; }
  };

  const metadata: QuestionMetadata = {
    question_id: questionId,
    statement_preview: meta.statement.slice(0, 300),
    exam_year: meta.exam_year ?? null,
    exam_board: meta.exam_board ?? null,
    exam_institution: meta.exam_institution ?? null,
    tags: JSON.stringify(parseTags(meta.tags)),
    areas_conhecimento: JSON.stringify(parseTags(meta.areas_conhecimento)),
  };

  await index.upsert([
    {
      id: toVectorId(questionId),
      values: embedding,
      metadata,
    },
  ]);
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteQuestionEmbedding(questionId: number): Promise<void> {
  const index = await getPineconeIndex();
  await index.deleteOne(toVectorId(questionId));
}

// ── Similarity search ─────────────────────────────────────────────────────────

export interface PineconeSimilarResult {
  id: number;
  statement_preview: string;
  exam_year: number | null;
  exam_board: string | null;
  exam_institution: string | null;
  tags: string[];
  areas_conhecimento: string[];
  similarity: number;
}

/**
 * Query Pinecone for the top-K most similar questions.
 * Returns full statement from PostgreSQL (metadata only has the preview).
 */
export async function queryPineconeSimilar(
  embedding: number[],
  topK: number,
  excludeIds: number[] = []
): Promise<PineconeSimilarResult[]> {
  const index = await getPineconeIndex();

  const res = await index.query({
    vector: embedding,
    topK: topK + excludeIds.length + 5, // over-fetch so we can exclude
    includeMetadata: true,
  });

  const excludeSet = new Set(excludeIds.map(toVectorId));

  return (res.matches ?? [])
    .filter((m) => !excludeSet.has(m.id))
    .slice(0, topK)
    .map((m) => {
      const meta = m.metadata as QuestionMetadata;
      return {
        id: fromVectorId(m.id),
        statement_preview: meta?.statement_preview ?? '',
        exam_year: meta?.exam_year ?? null,
        exam_board: meta?.exam_board ?? null,
        exam_institution: meta?.exam_institution ?? null,
        tags: (() => { try { return JSON.parse(meta?.tags ?? '[]'); } catch { return []; } })(),
        areas_conhecimento: (() => { try { return JSON.parse(meta?.areas_conhecimento ?? '[]'); } catch { return []; } })(),
        similarity: m.score ?? 0,
      };
    });
}

// ── Stats ────────────────────────────────────────────────────────────────────

export async function getPineconeIndexStats(): Promise<{
  totalVectorCount: number;
  dimension: number;
  indexFullness: number;
}> {
  const index = await getPineconeIndex();
  const stats = await index.describeIndexStats();
  return {
    totalVectorCount: stats.totalRecordCount ?? 0,
    dimension: stats.dimension ?? PINECONE_DIM,
    indexFullness: stats.indexFullness ?? 0,
  };
}
