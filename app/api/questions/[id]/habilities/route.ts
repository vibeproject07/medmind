import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getAuthUser } from '@/lib/api-auth';
import { query } from '@/lib/db';
import { ensureTaxonomyTables } from '@/lib/taxonomy-schema';
import { classifyQuestionHabilities } from '@/lib/taxonomy-agents';

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
    await ensureTaxonomyTables();
    const res = await query(`SELECT ai_habilities FROM questions WHERE id = $1`, [
      params.id,
    ]);
    if (!res.rows[0]) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }
    const raw = res.rows[0].ai_habilities as string | null;
    let result = null;
    if (raw) {
      try {
        result = JSON.parse(raw);
      } catch {
        result = null;
      }
    }
    return NextResponse.json({ result });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Erro ao buscar classificação' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = requireAdmin(req);
  if (auth.error) return auth.error;

  try {
    await ensureTaxonomyTables();
    const qRes = await query(`SELECT * FROM questions WHERE id = $1`, [params.id]);
    if (!qRes.rows[0]) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }

    const { result, pendingInserted } = await classifyQuestionHabilities(
      qRes.rows[0] as Record<string, unknown>,
    );

    return NextResponse.json({
      result,
      pending_inserted: pendingInserted,
      agent: 'habilities_agent',
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro na classificação';
    console.error(e);
    const status = message.includes('não encontrado') ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
