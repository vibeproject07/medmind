import { NextRequest, NextResponse } from 'next/server';
import { expandAndEmbedQuery, semanticSearchQuestions } from '@/lib/embeddings';
import { isPineconeEnabled, queryPineconeSimilar } from '@/lib/pinecone';
import { query } from '@/lib/db';
import { getAgentPrompt } from '@/lib/ai-agents';
import { verifyToken } from '@/lib/jwt';
import { filterActiveQuestionIds } from '@/lib/prova-soft-delete-schema';

export const runtime = 'nodejs';

// GET /api/questions/semantic-search?q=...&limit=20&offset=0
export async function GET(req: NextRequest) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
    if (token) token = token.trim().replace(/^["']|["']$/g, '');
    if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const user = verifyToken(token);
    if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    const isAdmin = user.role === 'admin' || user.role === 'manager';

    const q = req.nextUrl.searchParams.get('q')?.trim();
    if (!q || q.length < 3) {
      return NextResponse.json(
        { error: 'Consulta muito curta (mínimo 3 caracteres)' },
        { status: 400 }
      );
    }

    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '20'), 50);
    const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0');

    // Load the busca_vetorial agent system prompt (falls back to default if not customized)
    const systemPrompt = await getAgentPrompt('busca_vetorial');

    // Expand query with AI and embed — falls back to raw query if AI times out or fails
    const { embedding: queryEmbedding, expandedQuery } = await expandAndEmbedQuery(q, systemPrompt);

    const usedExpansion = expandedQuery !== q;

    // ── Pinecone path ────────────────────────────────────────────────────────
    if (isPineconeEnabled()) {
      const topK = Math.min(limit + offset, 50);
      const pineconeResults = await queryPineconeSimilar(queryEmbedding, topK);
      const pageResults = pineconeResults.slice(offset, offset + limit);

      let enriched = pageResults;
      if (pageResults.length > 0) {
        const ids = pageResults.map((r) => r.id);

        // Non-admins: filter out questions from deleted provas before enriching
        const activeIds = isAdmin ? ids : await filterActiveQuestionIds(ids);

        const dbRes = await query(
          `SELECT id, statement, tags, areas_conhecimento, exam_year, exam_board, exam_institution
           FROM questions WHERE id = ANY($1)`,
          [activeIds]
        );
        const byId = Object.fromEntries(dbRes.rows.map((r) => [r.id, r]));
        enriched = pageResults
          .filter((r) => activeIds.includes(r.id))
          .map((r) => ({
            ...r,
            statement: byId[r.id]?.statement ?? r.statement_preview,
            tags: byId[r.id]?.tags
              ? (() => { try { return JSON.parse(byId[r.id].tags); } catch { return r.tags; } })()
              : r.tags,
            areas_conhecimento: byId[r.id]?.areas_conhecimento
              ? (() => { try { return JSON.parse(byId[r.id].areas_conhecimento); } catch { return r.areas_conhecimento; } })()
              : r.areas_conhecimento,
          }));
      }

      return NextResponse.json({
        questions: enriched,
        total: enriched.length,
        limit,
        offset,
        backend: 'pinecone',
        expanded: usedExpansion,
      });
    }

    // ── pgvector path ────────────────────────────────────────────────────────
    const results = await semanticSearchQuestions(queryEmbedding, limit, offset);
    const total = results[0]?.total_count ?? 0;

    // Non-admins: filter out questions from deleted provas
    const filteredResults = isAdmin
      ? results
      : await (async () => {
          const activeIds = await filterActiveQuestionIds(results.map((r) => r.id));
          const activeSet = new Set(activeIds);
          return results.filter((r) => activeSet.has(r.id));
        })();

    return NextResponse.json({
      questions: filteredResults,
      total,
      limit,
      offset,
      backend: 'pgvector',
      expanded: usedExpansion,
    });
  } catch (err) {
    console.error('[semantic-search GET]', err);
    return NextResponse.json({ error: 'Erro na busca semântica' }, { status: 500 });
  }
}
