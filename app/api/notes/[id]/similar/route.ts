import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { findSimilarNotes } from '@/lib/embeddings';

export const runtime = 'nodejs';

// GET /api/notes/[id]/similar?limit=5
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const noteId = parseInt(id);
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '5'), 20);

    // ── Precomputed similar notes ──────────────────────────────────────────
    const similarNotes = await query(
      `SELECT
         cl.target_id AS id,
         cl.similarity,
         n.title,
         n.description,
         n.tags,
         n.areas_conhecimento
       FROM content_links cl
       JOIN notes n ON n.id = cl.target_id
       WHERE cl.source_type = 'note'
         AND cl.source_id = $1
         AND cl.target_type = 'note'
         AND cl.similarity >= 0.70
       ORDER BY cl.similarity DESC
       LIMIT $2`,
      [noteId, limit]
    );

    // ── Precomputed similar questions ──────────────────────────────────────
    const similarQuestions = await query(
      `SELECT
         cl.target_id AS id,
         cl.similarity,
         q.statement,
         q.tags,
         q.areas_conhecimento,
         q.exam_year,
         q.exam_board,
         q.exam_institution
       FROM content_links cl
       JOIN questions q ON q.id = cl.target_id
       WHERE cl.source_type = 'note'
         AND cl.source_id = $1
         AND cl.target_type = 'question'
         AND cl.similarity >= 0.70
       ORDER BY cl.similarity DESC
       LIMIT $2`,
      [noteId, limit]
    );

    // ── Fallback: live pgvector if no precomputed links ────────────────────
    let notesResult = similarNotes.rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      tags: r.tags ? JSON.parse(r.tags) : [],
      areas_conhecimento: r.areas_conhecimento ? JSON.parse(r.areas_conhecimento) : [],
      similarity: parseFloat(r.similarity),
    }));

    if (notesResult.length === 0) {
      const live = await findSimilarNotes(noteId, limit);
      notesResult = live;
    }

    const questionsResult = similarQuestions.rows.map((r) => ({
      id: r.id,
      statement: r.statement,
      tags: r.tags ? JSON.parse(r.tags) : [],
      areas_conhecimento: r.areas_conhecimento ? JSON.parse(r.areas_conhecimento) : [],
      exam_year: r.exam_year,
      exam_board: r.exam_board,
      exam_institution: r.exam_institution,
      similarity: parseFloat(r.similarity),
    }));

    return NextResponse.json({
      notes: notesResult,
      questions: questionsResult,
      backend: similarNotes.rows.length > 0 ? 'content_links' : 'pgvector',
    });
  } catch (err) {
    console.error('[notes/similar GET]', err);
    return NextResponse.json({ error: 'Erro ao buscar conteúdo similar' }, { status: 500 });
  }
}
