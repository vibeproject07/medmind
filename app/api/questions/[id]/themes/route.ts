import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { classifyQuestionThemes } from '@/lib/taxonomy-agents';

export const runtime = 'nodejs';

/**
 * Legado: POST /themes.
 * Agora delega para o fluxo canônico (themes_catalog + ai_question_themes)
 * e ainda espelha um resumo flat em questions.temas para compatibilidade.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const authHeader = req.headers.get('authorization');
  let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const user = verifyToken(token);
  if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Apenas administradores podem executar este agente' },
      { status: 403 },
    );
  }

  try {
    await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS temas TEXT`);
    await query(
      `ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_question_themes TEXT`,
    );

    const qRes = await query('SELECT * FROM questions WHERE id = $1', [params.id]);
    if (qRes.rows.length === 0) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }

    const { result, pendingInserted } = await classifyQuestionThemes(qRes.rows[0]);

    const flat = {
      temas: result.temas.map((t) => t.tema),
      subtemas: result.temas.flatMap((t) => t.subtemas),
      tema_principal:
        result.tema_principal ||
        result.temas.find((t) => t.principal)?.tema ||
        result.temas[0]?.tema ||
        '',
    };

    await query(
      `UPDATE questions SET temas = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(flat), params.id],
    );

    return NextResponse.json({
      result: flat,
      ai_question_themes: result,
      pending_inserted: pendingInserted,
      deprecated: true,
      message:
        'Rota /themes é legado; use /themes-assign. Resultado canônico em ai_question_themes.',
    });
  } catch (err: unknown) {
    console.error('[themes legacy] error:', err);
    const message = err instanceof Error ? err.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const authHeader = req.headers.get('authorization');
  let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (!verifyToken(token)) {
    return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  }

  try {
    const res = await query(
      `SELECT temas, ai_question_themes FROM questions WHERE id = $1`,
      [params.id],
    );
    if (!res.rows[0]) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }
    let result = null;
    const rawAi = res.rows[0].ai_question_themes as string | null;
    const rawLegacy = res.rows[0].temas as string | null;
    try {
      if (rawAi) result = JSON.parse(rawAi);
      else if (rawLegacy) result = JSON.parse(rawLegacy);
    } catch {
      result = null;
    }
    return NextResponse.json({ result });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Erro ao buscar temas' }, { status: 500 });
  }
}
