import { NextRequest, NextResponse } from 'next/server';
import { getPool, query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { ensureProvaQuestionsRemovedTable } from '@/lib/prova-questions-removed';

export const runtime = 'nodejs';

/**
 * POST /api/provas/[id]/questions/remove
 * Remove a questão da prova (não apaga do banco): grava em lista oculta e renumera (-1).
 * Body: { question_id: number }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    if (token) token = token.trim().replace(/^["']|["']$/g, '');
    if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const user = verifyToken(token);
    if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Acesso negado. Apenas administradores.' }, { status: 403 });
    }

    const provaId = parseInt(params.id, 10);
    if (isNaN(provaId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

    const body = (await request.json()) as Record<string, unknown>;
    const questionId = typeof body.question_id === 'number'
      ? body.question_id
      : parseInt(String(body.question_id ?? ''), 10);
    if (isNaN(questionId)) {
      return NextResponse.json({ error: 'question_id é obrigatório.' }, { status: 400 });
    }

    await ensureProvaQuestionsRemovedTable();

    const provaRes = await query(
      'SELECT id, nome, banca, regiao, ano, tipo FROM provas WHERE id = $1 LIMIT 1',
      [provaId],
    );
    if (provaRes.rows.length === 0) {
      return NextResponse.json({ error: 'Prova não encontrada' }, { status: 404 });
    }
    const prova = provaRes.rows[0];

    const qRes = await query(
      `SELECT id, prova_id, numero_na_prova
       FROM questions WHERE id = $1 LIMIT 1`,
      [questionId],
    );
    if (qRes.rows.length === 0) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }
    const q = qRes.rows[0];
    if (Number(q.prova_id) !== provaId) {
      return NextResponse.json({ error: 'Questão não pertence a esta prova.' }, { status: 400 });
    }

    const numero = Number(q.numero_na_prova);
    if (isNaN(numero)) {
      return NextResponse.json({ error: 'Questão sem número na prova.' }, { status: 400 });
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO prova_questions_removed (
           question_id, prova_id, prova_nome, banca, regiao, ano, tipo,
           numero_na_prova, removed_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          questionId,
          provaId,
          prova.nome,
          prova.banca,
          prova.regiao,
          prova.ano,
          prova.tipo,
          numero,
          user.id ?? null,
        ],
      );

      await client.query(
        `UPDATE questions
         SET prova_id = NULL, numero_na_prova = NULL, updated_at = NOW()
         WHERE id = $1`,
        [questionId],
      );

      await client.query(
        `UPDATE questions
         SET numero_na_prova = numero_na_prova - 1, updated_at = NOW()
         WHERE prova_id = $1 AND numero_na_prova > $2`,
        [provaId, numero],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const remaining = await query(
      `SELECT id, numero_na_prova, statement
       FROM questions WHERE prova_id = $1 ORDER BY numero_na_prova`,
      [provaId],
    );

    return NextResponse.json({
      ok: true,
      removed_question_id: questionId,
      remaining_count: remaining.rows.length,
      questions: remaining.rows,
    });
  } catch (error) {
    console.error('Erro ao remover questão da prova:', error);
    return NextResponse.json({ error: 'Erro ao remover questão da prova' }, { status: 500 });
  }
}
