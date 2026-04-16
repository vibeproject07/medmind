import { NextRequest, NextResponse } from 'next/server';
import { generateEmbedding, semanticSearchQuestions } from '@/lib/embeddings';

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

    const queryEmbedding = await generateEmbedding(q);
    const results = await semanticSearchQuestions(queryEmbedding, limit, offset);

    const total = results[0]?.total_count ?? 0;

    return NextResponse.json({
      questions: results,
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[semantic-search GET]', err);
    return NextResponse.json({ error: 'Erro na busca semântica' }, { status: 500 });
  }
}
