import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { ensureProvaQuestionsRemovedTable } from '@/lib/prova-questions-removed';

export const runtime = 'nodejs';

/**
 * GET /api/admin/prova-questions-removed
 * Lista oculta de questões removidas de provas (admin).
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    if (token) token = token.trim().replace(/^["']|["']$/g, '');
    if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const user = verifyToken(token);
    if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
    }

    await ensureProvaQuestionsRemovedTable();

    const url = new URL(request.url);
    const provaId = url.searchParams.get('prova_id');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 500);

    const params: unknown[] = [];
    let where = '';
    if (provaId) {
      params.push(parseInt(provaId, 10));
      where = `WHERE r.prova_id = $1`;
    }
    params.push(limit);
    const limitParam = `$${params.length}`;

    const res = await query(
      `SELECT r.id, r.question_id, r.prova_id, r.prova_nome, r.banca, r.regiao, r.ano, r.tipo,
              r.numero_na_prova, r.removed_at, r.removed_by,
              q.statement
       FROM prova_questions_removed r
       LEFT JOIN questions q ON q.id = r.question_id
       ${where}
       ORDER BY r.removed_at DESC
       LIMIT ${limitParam}`,
      params,
    );

    return NextResponse.json({ items: res.rows });
  } catch (error) {
    console.error('Erro ao listar questões removidas de provas:', error);
    return NextResponse.json({ error: 'Erro ao listar questões removidas' }, { status: 500 });
  }
}
