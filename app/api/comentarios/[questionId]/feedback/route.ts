import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';

const MOTIVOS_VALIDOS = ['incorreto', 'incompleto', 'desatualizado'] as const;
type Motivo = typeof MOTIVOS_VALIDOS[number];

export async function POST(
  request: NextRequest,
  { params }: { params: { questionId: string } }
) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    if (token) token = token.trim().replace(/^["']|["']$/g, '');
    if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const user = verifyToken(token);
    if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });

    const questaoId = parseInt(params.questionId, 10);
    if (isNaN(questaoId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

    // Verify comentario exists
    const comentarioCheck = await query(
      'SELECT questao_id FROM comentarios WHERE questao_id = $1',
      [questaoId]
    );
    if (comentarioCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Comentário não encontrado' }, { status: 404 });
    }

    const body = await request.json() as { tipo?: string; motivo?: string };
    const { tipo, motivo } = body;

    if (tipo === 'positivo') {
      const res = await query(
        `UPDATE comentarios SET feedback_positivo = feedback_positivo + 1
         WHERE questao_id = $1 RETURNING feedback_positivo`,
        [questaoId]
      );
      return NextResponse.json({ feedback_positivo: res.rows[0].feedback_positivo });
    }

    if (tipo === 'negativo') {
      if (!motivo || !MOTIVOS_VALIDOS.includes(motivo as Motivo)) {
        return NextResponse.json(
          { error: `Motivo inválido. Opções: ${MOTIVOS_VALIDOS.join(', ')}` },
          { status: 400 }
        );
      }
      await query(
        `INSERT INTO comentarios_feedback (questao_id, motivo) VALUES ($1, $2)`,
        [questaoId, motivo]
      );
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'tipo deve ser "positivo" ou "negativo"' }, { status: 400 });
  } catch (error) {
    console.error('Erro ao registrar feedback:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
