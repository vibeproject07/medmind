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
              correct_answer, explanation, images, exam_board, exam_region, exam_year, exam_type,
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
        explanation:     q.explanation,
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

function normalizeOptionalText(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

// PUT /api/provas/[id] — admin: atualiza metadados da prova
export async function PUT(
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

    const existingRes = await query(
      'SELECT id, nome FROM provas WHERE id = $1 LIMIT 1',
      [provaId],
    );
    if (existingRes.rows.length === 0) {
      return NextResponse.json({ error: 'Prova não encontrada' }, { status: 404 });
    }

    const body = await request.json() as Record<string, unknown>;
    const nome = body.nome != null ? String(body.nome).trim() : existingRes.rows[0].nome;
    if (!nome) {
      return NextResponse.json({ error: 'O nome da prova é obrigatório.' }, { status: 400 });
    }

    const banca = body.banca !== undefined ? normalizeOptionalText(body.banca) : undefined;
    const regiao = body.regiao !== undefined ? normalizeOptionalText(body.regiao) : undefined;
    const ano = body.ano !== undefined ? normalizeOptionalText(body.ano) : undefined;
    const tipo = body.tipo !== undefined ? normalizeOptionalText(body.tipo) : undefined;

    if (nome !== existingRes.rows[0].nome) {
      const dup = await query('SELECT id FROM provas WHERE nome = $1 AND id <> $2 LIMIT 1', [nome, provaId]);
      if (dup.rows.length > 0) {
        return NextResponse.json({ error: 'Já existe outra prova com este nome.' }, { status: 409 });
      }
    }

    const current = (await query(
      'SELECT nome, banca, regiao, ano, tipo FROM provas WHERE id = $1',
      [provaId],
    )).rows[0];

    const nextBanca = banca !== undefined ? banca : current.banca;
    const nextRegiao = regiao !== undefined ? regiao : current.regiao;
    const nextAno = ano !== undefined ? ano : current.ano;
    const nextTipo = tipo !== undefined ? tipo : current.tipo;

    const updatedRes = await query(
      `UPDATE provas
       SET nome = $1, banca = $2, regiao = $3, ano = $4, tipo = $5
       WHERE id = $6
       RETURNING id, nome, banca, regiao, ano, tipo, created_at`,
      [nome, nextBanca, nextRegiao, nextAno, nextTipo, provaId],
    );
    const updated = updatedRes.rows[0];

    let examYear: number | null = null;
    if (nextAno) {
      const parsed = parseInt(String(nextAno), 10);
      examYear = Number.isNaN(parsed) ? null : parsed;
    }

    await query(
      `UPDATE questions
       SET exam_board = $1, exam_region = $2, exam_year = $3, exam_type = $4, updated_at = NOW()
       WHERE prova_id = $5`,
      [nextBanca, nextRegiao, examYear, nextTipo, provaId],
    );

    const countRes = await query(
      'SELECT COUNT(*)::int AS question_count FROM questions WHERE prova_id = $1',
      [provaId],
    );

    return NextResponse.json({
      ...updated,
      question_count: countRes.rows[0]?.question_count ?? 0,
    });
  } catch (error) {
    console.error('Erro ao atualizar prova:', error);
    return NextResponse.json({ error: 'Erro ao atualizar prova' }, { status: 500 });
  }
}

/**
 * DELETE /api/provas/[id]?mode=delete_questions|unlink_questions
 * - delete_questions (padrão): apaga as questões da prova e a prova
 * - unlink_questions: desvincula questões (prova_id=null) e apaga só a prova
 *
 * Excluir uma duplicata NÃO conserta a outra se o problema for localStorage/quota —
 * a correção de acesso é carregar via API. Mas remove o card duplicado da lista.
 */
export async function DELETE(
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

    const mode = new URL(request.url).searchParams.get('mode') || 'delete_questions';

    const existing = await query('SELECT id, nome FROM provas WHERE id = $1', [provaId]);
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: 'Prova não encontrada' }, { status: 404 });
    }

    const countRes = await query(
      'SELECT COUNT(*)::int AS n FROM questions WHERE prova_id = $1',
      [provaId],
    );
    const questionCount = countRes.rows[0]?.n ?? 0;

    if (mode === 'unlink_questions') {
      await query(
        `UPDATE questions
         SET prova_id = NULL, numero_na_prova = NULL, updated_at = NOW()
         WHERE prova_id = $1`,
        [provaId],
      );
    } else {
      await query('DELETE FROM questions WHERE prova_id = $1', [provaId]);
    }

    await query('DELETE FROM provas WHERE id = $1', [provaId]);

    return NextResponse.json({
      ok: true,
      deleted_prova_id: provaId,
      nome: existing.rows[0].nome,
      mode,
      questions_affected: questionCount,
    });
  } catch (error) {
    console.error('Erro ao excluir prova:', error);
    return NextResponse.json({ error: 'Erro ao excluir prova' }, { status: 500 });
  }
}
