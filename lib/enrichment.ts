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

import { query } from '@/lib/db';
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

  // Check if local DeCS is available
  const decsCheck = await query(
    `SELECT COUNT(*) FROM decs_descriptors WHERE embedding IS NOT NULL`
  );
  const decsReady = parseInt(decsCheck.rows[0].count) > 0;

  if (decsReady) {
    const matches = await findTopDeCSLocal(embedding, 5);
    const relevant = matches.filter((m) => m.score >= 0.75);
    if (relevant.length > 0) {
      const terms = relevant.map((m) => m.name_pt);
      await query(
        `UPDATE questions SET decs_terms = $1 WHERE id = $2`,
        [JSON.stringify(terms), questionId]
      );
    }
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

  // Check if local DeCS is available
  const decsCheck = await query(
    `SELECT COUNT(*) FROM decs_descriptors WHERE embedding IS NOT NULL`
  );
  const decsReady = parseInt(decsCheck.rows[0].count) > 0;

  if (decsReady) {
    const matches = await findTopDeCSLocal(embedding, 5);
    const relevant = matches.filter((m) => m.score >= 0.75);
    if (relevant.length > 0) {
      const terms = relevant.map((m) => ({ ui: m.ui, name_pt: m.name_pt, score: m.score }));
      await query(
        `UPDATE notes SET decs_terms = $1 WHERE id = $2`,
        [JSON.stringify(terms), noteId]
      );
    }
  }

  console.log(`[enrichment] note ${noteId} enriched (embedding + DeCS)`);
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
