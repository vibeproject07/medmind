/**
 * Embedding utilities for MedMind
 * Uses Google's gemini-embedding-001 model (3072 dimensions)
 * Backed by pgvector 0.8.0 for cosine similarity search
 */

import { query } from '@/lib/db';

export const EMBEDDING_DIM = 3072;
export const EMBEDDING_MODEL = 'gemini-embedding-001';

// ── DB migration helpers ──────────────────────────────────────────────────────

export async function ensureVectorExtension(): Promise<void> {
  await query(`CREATE EXTENSION IF NOT EXISTS vector`);
}

export async function ensureEmbeddingColumn(): Promise<void> {
  await ensureVectorExtension();
  await query(
    `ALTER TABLE questions ADD COLUMN IF NOT EXISTS embedding vector(${EMBEDDING_DIM})`
  );
}

export async function ensureEmbeddingIndex(): Promise<void> {
  // Use halfvec cast (required for pgvector HNSW on dims > 2000)
  // CONCURRENTLY avoids write-blocking on populated tables
  await query(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS questions_embedding_hnsw_idx
    ON questions USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
    WHERE embedding IS NOT NULL
  `);
}

// ── Text preparation ──────────────────────────────────────────────────────────

export function buildQuestionText(q: {
  statement: string;
  option_a?: string | null;
  option_b?: string | null;
  option_c?: string | null;
  option_d?: string | null;
  option_e?: string | null;
  tags?: string | string[] | null;
  areas_conhecimento?: string | string[] | null;
  assuntos?: string | string[] | null;
  decs_terms?: string | string[] | null;
}): string {
  const parseField = (f: string | string[] | null | undefined): string[] => {
    if (!f) return [];
    if (Array.isArray(f)) return f;
    try { return JSON.parse(f); } catch { return []; }
  };

  const parts = [
    q.statement,
    q.option_a ? `A) ${q.option_a}` : null,
    q.option_b ? `B) ${q.option_b}` : null,
    q.option_c ? `C) ${q.option_c}` : null,
    q.option_d ? `D) ${q.option_d}` : null,
    q.option_e ? `E) ${q.option_e}` : null,
  ].filter(Boolean).join('\n');

  const tags = parseField(q.tags);
  const areas = parseField(q.areas_conhecimento);
  const assuntos = parseField(q.assuntos);
  const decs = parseField(q.decs_terms);
  const meta = [...new Set([...tags, ...areas, ...assuntos, ...decs])].join(', ');

  return meta ? `${parts}\n\n[${meta}]` : parts;
}

// ── Embedding generation ──────────────────────────────────────────────────────

export async function generateEmbedding(text: string, apiKey?: string): Promise<number[]> {
  const key = (apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim();
  if (!key) throw new Error('GEMINI_API_KEY not configured');

  // Trim text to avoid token limits (≈8K chars max)
  const trimmed = text.slice(0, 8000);

  // Call the REST API directly for reliability across SDK versions
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${key}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: { parts: [{ text: trimmed }] } }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await res.json() as { embedding?: { values?: number[] } };
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Empty embedding response from Google API');
  }
  return values;
}

/**
 * Format a float array as a pgvector literal: '[0.1, 0.2, ...]'
 */
export function vectorToString(v: number[]): string {
  return `[${v.join(',')}]`;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

export async function saveQuestionEmbedding(questionId: number, embedding: number[]): Promise<void> {
  await query(
    `UPDATE questions SET embedding = $1::vector WHERE id = $2`,
    [vectorToString(embedding), questionId]
  );
}

export async function getQuestionEmbedding(questionId: number): Promise<number[] | null> {
  const res = await query(
    `SELECT embedding::text FROM questions WHERE id = $1`,
    [questionId]
  );
  if (res.rows.length === 0 || !res.rows[0].embedding) return null;
  const raw: string = res.rows[0].embedding;
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(Number);
}

// ── Similarity search ─────────────────────────────────────────────────────────

export interface SimilarQuestion {
  id: number;
  statement: string;
  tags: string[];
  areas_conhecimento: string[];
  exam_year: number | null;
  exam_board: string | null;
  exam_institution: string | null;
  similarity: number;
}

export async function findSimilarQuestions(
  questionId: number,
  limit = 5,
  excludeIds: number[] = []
): Promise<SimilarQuestion[]> {
  const excludeSet = new Set([questionId, ...excludeIds]);
  const excludeList = Array.from(excludeSet).join(',');

  const res = await query(
    `SELECT
       q.id,
       q.statement,
       q.tags,
       q.areas_conhecimento,
       q.exam_year,
       q.exam_board,
       q.exam_institution,
       1 - (q.embedding <=> ref.embedding) AS similarity
     FROM questions q,
          (SELECT embedding FROM questions WHERE id = $1 AND embedding IS NOT NULL) AS ref
     WHERE q.id NOT IN (${excludeList})
       AND q.embedding IS NOT NULL
     ORDER BY q.embedding <=> ref.embedding
     LIMIT $2`,
    [questionId, limit]
  );

  return res.rows.map((r) => ({
    id: r.id,
    statement: r.statement,
    tags: r.tags ? JSON.parse(r.tags) : [],
    areas_conhecimento: r.areas_conhecimento ? JSON.parse(r.areas_conhecimento) : [],
    exam_year: r.exam_year,
    exam_board: r.exam_board,
    exam_institution: r.exam_institution,
    similarity: parseFloat(r.similarity ?? 0),
  }));
}

// ── Note-specific helpers ─────────────────────────────────────────────────────

export async function saveNoteEmbedding(noteId: number, embedding: number[]): Promise<void> {
  await query(
    `UPDATE notes SET embedding = $1::vector WHERE id = $2`,
    [vectorToString(embedding), noteId]
  );
}

export async function getNoteEmbedding(noteId: number): Promise<number[] | null> {
  const res = await query(
    `SELECT embedding::text FROM notes WHERE id = $1`,
    [noteId]
  );
  if (res.rows.length === 0 || !res.rows[0].embedding) return null;
  const raw: string = res.rows[0].embedding;
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(Number);
}

export interface SimilarNote {
  id: number;
  title: string;
  description: string;
  tags: string[];
  areas_conhecimento: string[];
  similarity: number;
}

export async function findSimilarNotes(
  noteId: number,
  limit = 5,
  excludeIds: number[] = []
): Promise<SimilarNote[]> {
  const excludeSet = new Set([noteId, ...excludeIds]);
  const excludeList = Array.from(excludeSet).join(',');

  const res = await query(
    `SELECT
       n.id,
       n.title,
       n.description,
       n.tags,
       n.areas_conhecimento,
       1 - (n.embedding <=> ref.embedding) AS similarity
     FROM notes n,
          (SELECT embedding FROM notes WHERE id = $1 AND embedding IS NOT NULL) AS ref
     WHERE n.id NOT IN (${excludeList})
       AND n.embedding IS NOT NULL
     ORDER BY n.embedding <=> ref.embedding
     LIMIT $2`,
    [noteId, limit]
  );

  return res.rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    tags: r.tags ? JSON.parse(r.tags) : [],
    areas_conhecimento: r.areas_conhecimento ? JSON.parse(r.areas_conhecimento) : [],
    similarity: parseFloat(r.similarity ?? 0),
  }));
}

export async function semanticSearchQuestions(
  queryEmbedding: number[],
  limit = 20,
  offset = 0,
  minSimilarity = 0.35
): Promise<(SimilarQuestion & { total_count: number })[]> {
  const res = await query(
    `SELECT
       q.id,
       q.statement,
       q.tags,
       q.areas_conhecimento,
       q.exam_year,
       q.exam_board,
       q.exam_institution,
       1 - (q.embedding::halfvec(3072) <=> $1::halfvec(3072)) AS similarity,
       COUNT(*) OVER() AS total_count
     FROM questions q
     WHERE q.embedding IS NOT NULL
       AND (1 - (q.embedding::halfvec(3072) <=> $1::halfvec(3072))) > $4
     ORDER BY q.embedding::halfvec(3072) <=> $1::halfvec(3072)
     LIMIT $2 OFFSET $3`,
    [vectorToString(queryEmbedding), limit, offset, minSimilarity]
  );

  return res.rows.map((r) => ({
    id: r.id,
    statement: r.statement,
    tags: r.tags ? JSON.parse(r.tags) : [],
    areas_conhecimento: r.areas_conhecimento ? JSON.parse(r.areas_conhecimento) : [],
    exam_year: r.exam_year,
    exam_board: r.exam_board,
    exam_institution: r.exam_institution,
    similarity: parseFloat(r.similarity ?? 0),
    total_count: parseInt(r.total_count ?? 0),
  }));
}
