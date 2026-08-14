import { NextRequest, NextResponse } from 'next/server';
import { findSimilarQuestions, getQuestionEmbedding } from '@/lib/embeddings';
import { isPineconeEnabled, queryPineconeSimilar } from '@/lib/pinecone';
import { query } from '@/lib/db';
import { findSimilarByTerms } from '@/lib/term-similarity';
import { verifyToken } from '@/lib/jwt';
import { filterActiveQuestionIds } from '@/lib/prova-soft-delete-schema';

export const runtime = 'nodejs';

// GET /api/questions/[id]/similar?limit=5
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
    if (token) token = token.trim().replace(/^["']|["']$/g, '');
    if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const user = verifyToken(token);
    if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    const isAdmin = user.role === 'admin' || user.role === 'manager';

    const { id } = await params;
    const questionId = parseInt(id);
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '5'), 20);

    // ── Try precomputed content_links first ────────────────────────────────
    // Non-admins: exclude similar questions that belong to soft-deleted provas
    const precomputed = await query(
      isAdmin
        ? `SELECT
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
           LIMIT $2`
        : `SELECT
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
           LEFT JOIN provas p ON p.id = q.prova_id
           WHERE cl.source_type = 'question'
             AND cl.source_id = $1
             AND cl.target_type = 'question'
             AND cl.similarity >= 0.70
             AND (q.prova_id IS NULL OR p.deleted_at IS NULL)
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

    // ── Term-based similarity fallback (primary/secondary DeCS roles) ──────
    const termHits = await findSimilarByTerms('question', questionId, 'question', limit);
    if (termHits.length > 0) {
      const rawIds = termHits.map((h) => h.target_id);
      const ids = isAdmin ? rawIds : await filterActiveQuestionIds(rawIds);
      const dbRes = await query(
        `SELECT id, statement, tags, areas_conhecimento, exam_year, exam_board, exam_institution
         FROM questions
         WHERE id = ANY($1)`,
        [ids]
      );
      const byId = new Map<number, Record<string, unknown>>(
        dbRes.rows.map((r) => [r.id as number, r as Record<string, unknown>])
      );
      const results = termHits
        .map((h) => {
          const row = byId.get(h.target_id);
          if (!row) return null;
          return {
            id: h.target_id,
            statement: row.statement as string,
            tags: row.tags ? JSON.parse(row.tags as string) : [],
            areas_conhecimento: row.areas_conhecimento ? JSON.parse(row.areas_conhecimento as string) : [],
            exam_year: row.exam_year as number | null,
            exam_board: row.exam_board as string | null,
            exam_institution: row.exam_institution as string | null,
            similarity: h.score / 100,
            score: h.score,
            primary_matches: h.primary_matches,
            secondary_matches: h.secondary_matches,
          };
        })
        .filter(Boolean);

      if (results.length > 0) {
        return NextResponse.json({ questions: results, backend: 'term_similarity' });
      }
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
        const rawIds = pineconeResults.map((r) => r.id);
        const activeIds = isAdmin ? rawIds : await filterActiveQuestionIds(rawIds);
        const dbRes = await query(
          `SELECT id, statement, tags, areas_conhecimento, exam_year, exam_board, exam_institution
           FROM questions WHERE id = ANY($1)`,
          [activeIds]
        );
        const byId = Object.fromEntries(dbRes.rows.map((r) => [r.id, r]));

        const enriched = pineconeResults
          .filter((r) => activeIds.includes(r.id))
          .map((r) => ({
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

    // Non-admins: exclude questions from soft-deleted provas
    const filteredSimilar = isAdmin
      ? similar
      : await (async () => {
          const activeIds = await filterActiveQuestionIds(similar.map((s) => s.id));
          const activeSet = new Set(activeIds);
          return similar.filter((s) => activeSet.has(s.id));
        })();

    return NextResponse.json({ questions: filteredSimilar, backend: 'pgvector' });
  } catch (err) {
    console.error('[similar GET]', err);
    return NextResponse.json({ error: 'Erro ao buscar questões similares' }, { status: 500 });
  }
}
