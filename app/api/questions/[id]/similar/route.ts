import { NextRequest, NextResponse } from 'next/server';
import { findSimilarQuestions, getQuestionEmbedding } from '@/lib/embeddings';
import { isPineconeEnabled, queryPineconeSimilar } from '@/lib/pinecone';
import { query } from '@/lib/db';

// GET /api/questions/[id]/similar?limit=5
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const questionId = parseInt(id);
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '5'), 20);

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
