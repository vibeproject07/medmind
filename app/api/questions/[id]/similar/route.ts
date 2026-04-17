import { NextRequest, NextResponse } from 'next/server';
import { findSimilarQuestions, getQuestionEmbedding } from '@/lib/embeddings';
import { isPineconeEnabled, queryPineconeSimilar } from '@/lib/pinecone';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

// GET /api/questions/[id]/similar?limit=5
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const questionId = parseInt(id);
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '5'), 20);

    // ── Try precomputed content_links first ────────────────────────────────
    const precomputed = await query(
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
       WHERE cl.source_type = 'question'
         AND cl.source_id = $1
         AND cl.target_type = 'question'
         AND cl.similarity >= 0.70
       ORDER BY cl.similarity DESC
       LIMIT $2`,
      [questionId, limit]
    );

    if (precomputed.rows.length > 0) {
      const results = precomputed.rows.map((r) => ({
        id: r.id,
        statement: r.statement,
        tags: r.tags ? JSON.parse(r.tags) : [],
        areas_conhecimento: r.areas_conhecimento ? JSON.parse(r.areas_conhecimento) : [],
        exam_year: r.exam_year,
        exam_board: r.exam_board,
        exam_institution: r.exam_institution,
        similarity: parseFloat(r.similarity),
      }));
      return NextResponse.json({ questions: results, backend: 'content_links' });
    }

    // ── Pinecone path ──────────────────────────────────────────────────────
    if (isPineconeEnabled()) {
      // Retrieve the stored embedding for this question from pgvector cache
      const embedding = await getQuestionEmbedding(questionId);
      if (!embedding) {
        return NextResponse.json({
          questions: [],
          message: 'Embedding não gerado para esta questão. Gere o embedding primeiro.',
          backend: 'pinecone',
        });
      }

      const pineconeResults = await queryPineconeSimilar(embedding, limit, [questionId]);

      // Enrich with full statement from Postgres
      if (pineconeResults.length > 0) {
        const ids = pineconeResults.map((r) => r.id);
        const dbRes = await query(
          `SELECT id, statement, tags, areas_conhecimento, exam_year, exam_board, exam_institution
           FROM questions WHERE id = ANY($1)`,
          [ids]
        );
        const byId = Object.fromEntries(dbRes.rows.map((r) => [r.id, r]));

        const enriched = pineconeResults.map((r) => ({
          ...r,
          statement: byId[r.id]?.statement ?? r.statement_preview,
        }));

        return NextResponse.json({ questions: enriched, backend: 'pinecone' });
      }

      return NextResponse.json({ questions: [], backend: 'pinecone' });
    }

    // ── pgvector fallback ──────────────────────────────────────────────────
    const similar = await findSimilarQuestions(questionId, limit);
    if (similar.length === 0) {
      return NextResponse.json({
        questions: [],
        message: 'Embedding não gerado para esta questão. Gere o embedding primeiro.',
        backend: 'pgvector',
      });
    }

    return NextResponse.json({ questions: similar, backend: 'pgvector' });
  } catch (err) {
    console.error('[similar GET]', err);
    return NextResponse.json({ error: 'Erro ao buscar questões similares' }, { status: 500 });
  }
}
