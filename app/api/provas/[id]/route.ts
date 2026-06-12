import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';

// GET /api/provas/[id] — returns one prova with all its questions
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    if (token) token = token.trim().replace(/^["']|["']$/g, '');
    if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const user = verifyToken(token);
    if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });

    const provaId = parseInt(params.id, 10);
    if (isNaN(provaId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

    const provaRes = await query(
      'SELECT id, nome, banca, regiao, ano, tipo, created_at FROM provas WHERE id = $1 LIMIT 1',
      [provaId]
    );
    if (provaRes.rows.length === 0) {
      return NextResponse.json({ error: 'Prova não encontrada' }, { status: 404 });
    }
    const prova = provaRes.rows[0];

    const questionsRes = await query(
      `SELECT id, statement, option_a, option_b, option_c, option_d, option_e,
              correct_answer, images, exam_board, exam_region, exam_year, exam_type,
              prova_id, numero_na_prova, anulada
       FROM questions
       WHERE prova_id = $1
       ORDER BY numero_na_prova`,
      [provaId]
    );

    return NextResponse.json({
      id:         prova.id,
      nome:       prova.nome,
      banca:      prova.banca,
      regiao:     prova.regiao,
      ano:        prova.ano,
      tipo:       prova.tipo,
      created_at: prova.created_at,
      questions:  questionsRes.rows.map((q: Record<string, unknown>) => ({
        id:              q.id,
        numero_na_prova: q.numero_na_prova,
        statement:       q.statement,
        option_a:        q.option_a,
        option_b:        q.option_b,
        option_c:        q.option_c,
        option_d:        q.option_d,
        option_e:        q.option_e,
        correct_answer:  q.correct_answer,
        images:          q.images ? (typeof q.images === 'string' ? JSON.parse(q.images) : q.images) : [],
        exam_board:      q.exam_board,
        exam_region:     q.exam_region,
        exam_year:       q.exam_year,
        exam_type:       q.exam_type,
        anulada:         q.anulada ?? false,
      })),
    });
  } catch (error) {
    console.error('Erro ao buscar prova:', error);
    return NextResponse.json({ error: 'Erro ao buscar prova' }, { status: 500 });
  }
}
