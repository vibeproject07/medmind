import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import jwt from 'jsonwebtoken';

function getTokenPayload(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'secret') as { role?: string };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const payload = getTokenPayload(req);
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 });
  }

  let body: { questoes?: { questao_id: number | string; comentario: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const questoes = body?.questoes;
  if (!Array.isArray(questoes) || questoes.length === 0) {
    return NextResponse.json({ error: 'Campo "questoes" ausente ou vazio' }, { status: 400 });
  }

  let inseridos = 0;
  let atualizados = 0;
  const erros: string[] = [];

  for (const q of questoes) {
    const qid = Number(q.questao_id);
    if (Number.isNaN(qid) || !q.comentario) {
      erros.push(`questao_id=${q.questao_id}: dados inválidos`);
      continue;
    }
    try {
      const existing = await query('SELECT id FROM comentarios WHERE questao_id = $1', [qid]);
      if (existing.rows.length > 0) {
        await query('UPDATE comentarios SET comentario = $1 WHERE questao_id = $2', [q.comentario, qid]);
        atualizados++;
      } else {
        await query('INSERT INTO comentarios (questao_id, comentario) VALUES ($1, $2)', [qid, q.comentario]);
        inseridos++;
      }
    } catch (e: any) {
      erros.push(`questao_id=${qid}: ${e.message}`);
    }
  }

  return NextResponse.json({ inseridos, atualizados, erros });
}
