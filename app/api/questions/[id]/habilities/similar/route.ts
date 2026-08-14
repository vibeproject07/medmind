import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/api-auth';
import { findQuestionsBySharedHabilities } from '@/lib/taxonomy-agents';
import { isQuestionInDeletedProva, filterActiveQuestionIds } from '@/lib/prova-soft-delete-schema';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const isAdmin = user.role === 'admin' || user.role === 'manager';
  const questionId = parseInt(params.id, 10);

  try {
    // Non-admins cannot access questions from soft-deleted provas
    if (!isAdmin) {
      const srcRow = (await query('SELECT prova_id FROM questions WHERE id = $1 LIMIT 1', [questionId])).rows[0];
      if (!srcRow) return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
      const inDeleted = await isQuestionInDeletedProva(questionId, srcRow.prova_id ?? null);
      if (inDeleted) return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }

    const limit = Math.min(
      parseInt(req.nextUrl.searchParams.get('limit') ?? '10', 10) || 10,
      30,
    );
    const questions = await findQuestionsBySharedHabilities(questionId, limit);

    // Filter out results from deleted provas for non-admins
    const filtered = isAdmin
      ? questions
      : await (async () => {
          const ids = (questions as { id: number }[]).map((q) => q.id);
          const activeIds = await filterActiveQuestionIds(ids);
          const activeSet = new Set(activeIds);
          return (questions as { id: number }[]).filter((q) => activeSet.has(q.id));
        })();

    return NextResponse.json({
      questions: filtered,
      backend: 'shared_habilities',
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Erro na busca por competências' }, { status: 500 });
  }
}
