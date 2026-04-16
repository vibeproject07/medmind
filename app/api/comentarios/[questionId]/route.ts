import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: { questionId: string } }
) {
  const id = Number(params.questionId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
  }

  const result = await query(
    'SELECT comentario, feedback_positivo FROM comentarios WHERE questao_id = $1',
    [id]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ comentario: null, feedback_positivo: 0 }, { status: 200 });
  }

  return NextResponse.json({
    comentario:        result.rows[0].comentario,
    feedback_positivo: result.rows[0].feedback_positivo ?? 0,
  });
}
