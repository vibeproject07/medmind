import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/api-auth';
import { findQuestionsBySharedHabilities } from '@/lib/taxonomy-agents';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const limit = Math.min(
      parseInt(req.nextUrl.searchParams.get('limit') ?? '10', 10) || 10,
      30,
    );
    const questions = await findQuestionsBySharedHabilities(
      parseInt(params.id, 10),
      limit,
    );
    return NextResponse.json({
      questions,
      backend: 'shared_habilities',
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Erro na busca por competências' }, { status: 500 });
  }
}
