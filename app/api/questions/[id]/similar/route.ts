import { NextRequest, NextResponse } from 'next/server';
import { findSimilarQuestions } from '@/lib/embeddings';

// GET /api/questions/[id]/similar?limit=5
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const questionId = parseInt(id);
    const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '5');

    const similar = await findSimilarQuestions(questionId, Math.min(limit, 20));

    if (similar.length === 0) {
      return NextResponse.json({
        questions: [],
        message: 'Embedding não gerado para esta questão. Gere o embedding primeiro.',
      });
    }

    return NextResponse.json({ questions: similar });
  } catch (err) {
    console.error('[similar GET]', err);
    return NextResponse.json({ error: 'Erro ao buscar questões similares' }, { status: 500 });
  }
}
