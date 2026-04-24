/**
 * Embedding utilities for MedMind
 * Uses Google's gemini-embedding-001 model (3072 dimensions)
 * Backed by pgvector 0.8.0 for cosine similarity search
 *
 * taskType guidance (gemini-embedding-001):
 *   - Indexing questions in DB  → "RETRIEVAL_DOCUMENT"  (batch-embed-questions.mjs)
 *   - Search query from user    → "RETRIEVAL_QUERY"     (semantic-search route)
 *   - Symmetric similarity      → omit (defaults to SEMANTIC_SIMILARITY)
 *
 * IMPORTANT: stored question embeddings must be re-generated with RETRIEVAL_DOCUMENT
 * before switching the search route to RETRIEVAL_QUERY.  Until re-embedding is done,
 * the search route uses query expansion (busca_vetorial agent) to improve relevance
 * while keeping both sides in the same embedding space.
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

export type EmbeddingTaskType =
  | 'RETRIEVAL_DOCUMENT'
  | 'RETRIEVAL_QUERY'
  | 'SEMANTIC_SIMILARITY'
  | 'CLASSIFICATION'
  | 'CLUSTERING';

export async function generateEmbedding(
  text: string,
  apiKey?: string,
  taskType?: EmbeddingTaskType,
): Promise<number[]> {
  const key = (apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim();
  if (!key) throw new Error('GEMINI_API_KEY not configured');

  // Trim text to avoid token limits (≈8K chars max)
  const trimmed = text.slice(0, 8000);

  // Call the REST API directly for reliability across SDK versions
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${key}`;

  const body: Record<string, unknown> = { content: { parts: [{ text: trimmed }] } };
  if (taskType) body.taskType = taskType;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
 * Expands a short user query into rich medical text using the busca_vetorial agent
 * prompt, then generates a SEMANTIC_SIMILARITY embedding compatible with the stored
 * question embeddings.  Falls back to embedding the raw query if the LLM call fails.
 *
 * When questions are re-embedded with RETRIEVAL_DOCUMENT, switch to:
 *   generateEmbedding(expandedText, undefined, 'RETRIEVAL_QUERY')
 */
export async function expandAndEmbedQuery(
  rawQuery: string,
  systemPrompt: string,
  apiKey?: string,
): Promise<{ embedding: number[]; expandedQuery: string }> {
  const key = (apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim();
  if (!key) throw new Error('GEMINI_API_KEY not configured');

  let expandedQuery = rawQuery;

  try {
    // Call gemini-2.5-flash to expand the query (max 10 s timeout via AbortController)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);

    const llmRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: rawQuery }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
        }),
      },
    );

    clearTimeout(timer);

    if (llmRes.ok) {
      const llmData = await llmRes.json() as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = llmData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text && text.length > 20) expandedQuery = text;
    }
  } catch {
    // timeout or network error — fall back to raw query silently
  }

  // Use RETRIEVAL_QUERY once questions have been re-embedded with RETRIEVAL_DOCUMENT.
  // Set env var EMBEDDING_TASK_TYPE=retrieval after running the batch re-embedding script.
  const useRetrieval = process.env.EMBEDDING_TASK_TYPE === 'retrieval';
  const embedding = await generateEmbedding(
    expandedQuery,
    key,
    useRetrieval ? 'RETRIEVAL_QUERY' : undefined,
  );
  return { embedding, expandedQuery };
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
