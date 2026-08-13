import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { computeProvaContentFingerprint } from '@/lib/prova-fingerprint';
import { ensureProvaFingerprintColumn } from '@/lib/prova-fingerprint-schema';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * GET /api/admin/provas-duplicadas
 * Lista grupos de provas com a mesma sequência de questões (fingerprint).
 * Query: ?backfill=1 para recalcular fingerprints ausentes.
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

    await ensureProvaFingerprintColumn();

    const backfill = new URL(request.url).searchParams.get('backfill') === '1';

    if (backfill) {
      const provas = await query(`SELECT id FROM provas ORDER BY id`);
      let updated = 0;
      for (const row of provas.rows as Array<{ id: number }>) {
        const qs = await query(
          `SELECT numero_na_prova AS numero, statement, option_a, option_b, correct_answer
           FROM questions
           WHERE prova_id = $1 AND numero_na_prova IS NOT NULL
           ORDER BY numero_na_prova`,
          [row.id],
        );
        if (qs.rows.length === 0) continue;
        const fp = computeProvaContentFingerprint(
          (qs.rows as Array<{
            numero: number;
            statement: string;
            option_a: string;
            option_b: string;
            correct_answer: string;
          }>).map((q) => ({
            numero: Number(q.numero),
            statement: String(q.statement ?? ''),
            option_a: String(q.option_a ?? ''),
            option_b: String(q.option_b ?? ''),
            correct_answer: String(q.correct_answer ?? 'A'),
          })),
        );
        await query(`UPDATE provas SET content_fingerprint = $1 WHERE id = $2`, [
          fp,
          row.id,
        ]);
        updated += 1;
      }
      return NextResponse.json({ backfilled: updated });
    }

    const groupsRes = await query(`
      SELECT content_fingerprint,
             COUNT(*)::int AS n,
             array_agg(id ORDER BY id) AS ids,
             array_agg(nome ORDER BY id) AS nomes,
             array_agg(
               (SELECT COUNT(*)::int FROM questions q WHERE q.prova_id = p.id)
               ORDER BY id
             ) AS question_counts
      FROM provas p
      WHERE content_fingerprint IS NOT NULL
      GROUP BY content_fingerprint
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC, MIN(id)
    `);

    return NextResponse.json({
      duplicate_groups: groupsRes.rows.map((r: Record<string, unknown>) => ({
        fingerprint: r.content_fingerprint,
        count: r.n,
        ids: r.ids,
        nomes: r.nomes,
        question_counts: r.question_counts,
        keep_id: Array.isArray(r.ids) ? (r.ids as number[])[0] : null,
        remove_ids: Array.isArray(r.ids) ? (r.ids as number[]).slice(1) : [],
      })),
      hint:
        'Mantenha keep_id e exclua remove_ids com DELETE /api/provas/{id}?mode=delete_questions. ' +
        'Abrir prova agora usa a API (não depende do localStorage).',
    });
  } catch (error) {
    console.error('Erro ao listar provas duplicadas:', error);
    return NextResponse.json({ error: 'Erro ao listar duplicadas' }, { status: 500 });
  }
}
