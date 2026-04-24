import { NextRequest, NextResponse } from 'next/server';
import { expandAndEmbedQuery, semanticSearchQuestions } from '@/lib/embeddings';
import { isPineconeEnabled, queryPineconeSimilar } from '@/lib/pinecone';
import { query } from '@/lib/db';
import { getAgentPrompt } from '@/lib/ai-agents';

export const runtime = 'nodejs';

// GET /api/questions/semantic-search?q=...&limit=20&offset=0
export async function GET(req: NextRequest) {
  try {
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
        const dbRes = await query(
          `SELECT id, statement, tags, areas_conhecimento, exam_year, exam_board, exam_institution
           FROM questions WHERE id = ANY($1)`,
          [ids]
        );
        const byId = Object.fromEntries(dbRes.rows.map((r) => [r.id, r]));
        enriched = pageResults.map((r) => ({
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
        total: pineconeResults.length,
        limit,
        offset,
        backend: 'pinecone',
        expanded: usedExpansion,
      });
    }

    // ── pgvector path ────────────────────────────────────────────────────────
    const results = await semanticSearchQuestions(queryEmbedding, limit, offset);
    const total = results[0]?.total_count ?? 0;

    return NextResponse.json({
      questions: results,
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
