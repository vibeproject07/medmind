import { NextRequest, NextResponse } from 'next/server';
import { getPool, query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';

function authAdmin(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  if (!token) return { error: NextResponse.json({ error: 'Não autorizado' }, { status: 401 }) };
  const user = verifyToken(token);
  if (!user) return { error: NextResponse.json({ error: 'Token inválido' }, { status: 401 }) };
  if (user.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Acesso negado. Apenas administradores.' }, { status: 403 }) };
  }
  return { user };
}

/**
 * POST /api/provas/[id]/questions
 * Insere uma questão na prova na posição `numero_na_prova` e renumera as posteriores (+1).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = authAdmin(request);
    if (auth.error) return auth.error;

    const provaId = parseInt(params.id, 10);
    if (isNaN(provaId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

    const provaRes = await query(
      'SELECT id, nome, banca, regiao, ano, tipo FROM provas WHERE id = $1 LIMIT 1',
      [provaId],
    );
    if (provaRes.rows.length === 0) {
      return NextResponse.json({ error: 'Prova não encontrada' }, { status: 404 });
    }
    const prova = provaRes.rows[0];

    const body = (await request.json()) as Record<string, unknown>;
    const statement = String(body.statement ?? '').trim();
    const option_a = String(body.option_a ?? '').trim();
    const option_b = String(body.option_b ?? '').trim();
    const option_c = body.option_c != null && String(body.option_c).trim() ? String(body.option_c).trim() : null;
    const option_d = body.option_d != null && String(body.option_d).trim() ? String(body.option_d).trim() : null;
    const option_e = body.option_e != null && String(body.option_e).trim() ? String(body.option_e).trim() : null;
    const correct_answer = String(body.correct_answer ?? 'A').toUpperCase().trim()[0] || 'A';
    const images = Array.isArray(body.images) ? (body.images as unknown[]).filter((i) => typeof i === 'string') as string[] : [];

    if (!statement || !option_a || !option_b) {
      return NextResponse.json(
        { error: 'Enunciado e alternativas A e B são obrigatórios.' },
        { status: 400 },
      );
    }

    const available = ['A', 'B'];
    if (option_c) available.push('C');
    if (option_d) available.push('D');
    if (option_e) available.push('E');
    if (!available.includes(correct_answer)) {
      return NextResponse.json(
        { error: `Resposta correta deve ser uma das alternativas preenchidas: ${available.join(', ')}` },
        { status: 400 },
      );
    }

    const countRes = await query(
      'SELECT COUNT(*)::int AS n FROM questions WHERE prova_id = $1',
      [provaId],
    );
    const currentCount = countRes.rows[0]?.n ?? 0;

    let numero = typeof body.numero_na_prova === 'number'
      ? body.numero_na_prova
      : parseInt(String(body.numero_na_prova ?? currentCount + 1), 10);
    if (isNaN(numero) || numero < 1) numero = currentCount + 1;
    if (numero > currentCount + 1) numero = currentCount + 1;

    let examYear: number | null = null;
    if (prova.ano) {
      const parsed = parseInt(String(prova.ano), 10);
      examYear = Number.isNaN(parsed) ? null : parsed;
    }

    const imagesJson = JSON.stringify(images);
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Empurra posteriores (+1). Ordem DESC evita colisão se houver unique no futuro.
      await client.query(
        `UPDATE questions
         SET numero_na_prova = numero_na_prova + 1, updated_at = NOW()
         WHERE prova_id = $1 AND numero_na_prova >= $2`,
        [provaId, numero],
      );

      const insertRes = await client.query(
        `INSERT INTO questions (
           statement, option_a, option_b, option_c, option_d, option_e,
           correct_answer, images, exam_board, exam_region, exam_year, exam_type,
           prova_id, numero_na_prova
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id, statement, option_a, option_b, option_c, option_d, option_e,
                   correct_answer, images, prova_id, numero_na_prova, anulada`,
        [
          statement,
          option_a,
          option_b,
          option_c,
          option_d,
          option_e,
          correct_answer,
          imagesJson,
          prova.banca ?? null,
          prova.regiao ?? null,
          examYear,
          prova.tipo ?? null,
          provaId,
          numero,
        ],
      );

      await client.query('COMMIT');

      const q = insertRes.rows[0];
      return NextResponse.json(
        {
          question: {
            ...q,
            images: q.images ? (typeof q.images === 'string' ? JSON.parse(q.images) : q.images) : [],
          },
          numero_na_prova: numero,
        },
        { status: 201 },
      );
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Erro ao adicionar questão à prova:', error);
    return NextResponse.json({ error: 'Erro ao adicionar questão à prova' }, { status: 500 });
  }
}
