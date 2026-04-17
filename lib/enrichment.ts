/**
 * Automatic enrichment pipeline for MedMind
 *
 * When a question or note is created/updated, this module fires background
 * tasks (fire-and-forget via setImmediate) to:
 *   1. Generate a gemini-embedding-001 embedding and save to pgvector
 *   2. Run DeCS classification and save matched descriptors
 *
 * All errors are caught and logged — never throw back to the caller.
 */

import { query, getPool } from '@/lib/db';
import {
  generateEmbedding,
  buildQuestionText,
  vectorToString,
  EMBEDDING_DIM,
} from '@/lib/embeddings';

// ── Text builders ─────────────────────────────────────────────────────────────

export function buildNoteText(n: {
  title: string;
  description: string;
  tags?: string | string[] | null;
  areas_conhecimento?: string | string[] | null;
  assuntos?: string | string[] | null;
  decs_terms?: unknown;
}): string {
  const parse = (f: string | string[] | null | undefined): string[] => {
    if (!f) return [];
    if (Array.isArray(f)) return f;
    try { return JSON.parse(f as string); } catch { return []; }
  };

  const body = [n.title, n.description].filter(Boolean).join('\n\n');
  const tags = parse(n.tags);
  const areas = parse(n.areas_conhecimento);
  const assuntos = parse(n.assuntos);
  const meta = [...new Set([...tags, ...areas, ...assuntos])].join(', ');
  return meta ? `${body}\n\n[${meta}]` : body;
}

// ── DeCS local search ─────────────────────────────────────────────────────────

interface DeCSMatch {
  ui: string;
  name_pt: string;
  name_en: string;
  score: number;
}

async function findTopDeCSLocal(
  textEmbedding: number[],
  limit = 5
): Promise<DeCSMatch[]> {
  const res = await query(
    `SELECT ui, name_pt, name_en,
            1 - (embedding <=> $1::vector) AS score
     FROM decs_descriptors
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vectorToString(textEmbedding), limit]
  );
  return res.rows.map((r) => ({
    ui: r.ui,
    name_pt: r.name_pt,
    name_en: r.name_en,
    score: parseFloat(r.score ?? 0),
  }));
}

// ── Question enrichment ───────────────────────────────────────────────────────

async function enrichQuestion(questionId: number): Promise<void> {
  const res = await query(
    `SELECT id, statement, option_a, option_b, option_c, option_d, option_e,
            tags, areas_conhecimento, assuntos, decs_terms
     FROM questions WHERE id = $1`,
    [questionId]
  );
  if (res.rows.length === 0) return;
  const q = res.rows[0];

  const text = buildQuestionText(q);
  const embedding = await generateEmbedding(text);

  // Save embedding
  await query(
    `UPDATE questions SET embedding = $1::vector WHERE id = $2`,
    [vectorToString(embedding), questionId]
  );

  // Recompute content links
  await recomputeContentLinks('question', questionId, embedding).catch((e) =>
    console.error(`[enrichment] content_links failed for question ${questionId}:`, e)
  );

  // Check if local DeCS is available
  const decsCheck = await query(
    `SELECT COUNT(*) FROM decs_descriptors WHERE embedding IS NOT NULL`
  );
  const decsReady = parseInt(decsCheck.rows[0].count) > 0;

  if (decsReady) {
    const matches = await findTopDeCSLocal(embedding, 5);
    const relevant = matches.filter((m) => m.score >= 0.75);
    // Always write result (even []) to clear any stale prior terms
    const terms = relevant.map((m) => m.name_pt);
    await query(
      `UPDATE questions SET decs_terms = $1 WHERE id = $2`,
      [JSON.stringify(terms), questionId]
    );
  }

  console.log(`[enrichment] question ${questionId} enriched (embedding + DeCS)`);
}

// ── Note enrichment ───────────────────────────────────────────────────────────

async function enrichNote(noteId: number): Promise<void> {
  const res = await query(
    `SELECT id, title, description, tags, areas_conhecimento, assuntos
     FROM notes WHERE id = $1`,
    [noteId]
  );
  if (res.rows.length === 0) return;
  const n = res.rows[0];

  const text = buildNoteText(n);
  const embedding = await generateEmbedding(text);

  // Save embedding
  await query(
    `UPDATE notes SET embedding = $1::vector WHERE id = $2`,
    [vectorToString(embedding), noteId]
  );

  // Recompute content links
  await recomputeContentLinks('note', noteId, embedding).catch((e) =>
    console.error(`[enrichment] content_links failed for note ${noteId}:`, e)
  );

  // Check if local DeCS is available
  const decsCheck = await query(
    `SELECT COUNT(*) FROM decs_descriptors WHERE embedding IS NOT NULL`
  );
  const decsReady = parseInt(decsCheck.rows[0].count) > 0;

  if (decsReady) {
    const matches = await findTopDeCSLocal(embedding, 5);
    const relevant = matches.filter((m) => m.score >= 0.75);
    // Canonical shape: {ui, name_pt, name_en} — no score, matches batch script output
    // Always write (even []) to clear any stale prior terms
    const terms = relevant.map((m) => ({ ui: m.ui, name_pt: m.name_pt, name_en: m.name_en }));
    await query(
      `UPDATE notes SET decs_terms = $1 WHERE id = $2`,
      [JSON.stringify(terms), noteId]
    );
  }

  console.log(`[enrichment] note ${noteId} enriched (embedding + DeCS)`);
}

// ── Content links (precomputed similarity) ────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.70;
const SIMILARITY_TOP_K = 10;

async function recomputeContentLinks(
  type: 'question' | 'note',
  id: number,
  embedding: number[]
): Promise<void> {
  const vectorStr = vectorToString(embedding);
  const excludeQId = type === 'question' ? id : -1;
  const excludeNId = type === 'note' ? id : -1;

  const [simQs, simNs] = await Promise.all([
    query(
      `SELECT q.id, 1 - (q.embedding <=> $1::vector) AS similarity
       FROM questions q
       WHERE q.id != $2
         AND q.embedding IS NOT NULL
         AND (1 - (q.embedding <=> $1::vector)) >= $3
       ORDER BY q.embedding <=> $1::vector
       LIMIT $4`,
      [vectorStr, excludeQId, SIMILARITY_THRESHOLD, SIMILARITY_TOP_K]
    ),
    query(
      `SELECT n.id, 1 - (n.embedding <=> $1::vector) AS similarity
       FROM notes n
       WHERE n.id != $2
         AND n.embedding IS NOT NULL
         AND (1 - (n.embedding <=> $1::vector)) >= $3
       ORDER BY n.embedding <=> $1::vector
       LIMIT $4`,
      [vectorStr, excludeNId, SIMILARITY_THRESHOLD, SIMILARITY_TOP_K]
    ),
  ]);

  // Use a single pooled client so BEGIN/COMMIT are on the same connection
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM content_links WHERE source_type = $1 AND source_id = $2`,
      [type, id]
    );
    for (const row of simQs.rows) {
      await client.query(
        `INSERT INTO content_links (source_type, source_id, target_type, target_id, similarity, computed_at)
         VALUES ($1, $2, 'question', $3, $4, NOW())
         ON CONFLICT (source_type, source_id, target_type, target_id)
         DO UPDATE SET similarity = EXCLUDED.similarity, computed_at = NOW()`,
        [type, id, row.id, parseFloat(row.similarity)]
      );
    }
    for (const row of simNs.rows) {
      await client.query(
        `INSERT INTO content_links (source_type, source_id, target_type, target_id, similarity, computed_at)
         VALUES ($1, $2, 'note', $3, $4, NOW())
         ON CONFLICT (source_type, source_id, target_type, target_id)
         DO UPDATE SET similarity = EXCLUDED.similarity, computed_at = NOW()`,
        [type, id, row.id, parseFloat(row.similarity)]
      );
    }
    await client.query('COMMIT');
    console.log(
      `[enrichment] content_links for ${type} ${id}: ` +
      `${simQs.rows.length} q-links, ${simNs.rows.length} n-links`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget enrichment trigger.
 * Call after INSERT / UPDATE — never awaited, never throws.
 */
export function triggerEnrichment(
  type: 'question' | 'note',
  id: number
): void {
  const geminiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!geminiKey) return;

  setImmediate(async () => {
    try {
      if (type === 'question') {
        await enrichQuestion(id);
      } else {
        await enrichNote(id);
      }
    } catch (err) {
      console.error(`[enrichment] ${type} ${id} failed:`, err);
    }
  });
}
