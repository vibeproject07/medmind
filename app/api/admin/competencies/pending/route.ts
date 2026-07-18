import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { query } from '@/lib/db';
import { ensureTaxonomyTables, normalizeTaxonomyLabel } from '@/lib/taxonomy-schema';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req);
  if (auth.error) return auth.error;

  try {
    await ensureTaxonomyTables();
    const status = req.nextUrl.searchParams.get('status') || 'pending';
    const res = await query(
      `SELECT * FROM competencies_pending
       WHERE status = $1
       ORDER BY created_at DESC`,
      [status],
    );
    return NextResponse.json({ items: res.rows });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Erro ao listar pendentes' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAdmin(req);
  if (auth.error) return auth.error;

  try {
    await ensureTaxonomyTables();
    const body = await req.json();
    const id = Number(body?.id);
    const action = String(body?.action ?? 'approve');

    if (!id) {
      return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });
    }

    const pendingRes = await query(
      `SELECT * FROM competencies_pending WHERE id = $1`,
      [id],
    );
    const pending = pendingRes.rows[0];
    if (!pending) {
      return NextResponse.json({ error: 'Pendente não encontrado' }, { status: 404 });
    }

    if (action === 'reject') {
      await query(
        `UPDATE competencies_pending
         SET status = 'rejected', updated_at = NOW()
         WHERE id = $1`,
        [id],
      );
      return NextResponse.json({ ok: true, status: 'rejected' });
    }

    const competencia = normalizeTaxonomyLabel(String(pending.competencia));
    const conteudo = normalizeTaxonomyLabel(String(pending.conteudo));

    const catalog = await query(
      `INSERT INTO competencies_catalog (competencia, conteudo, origin)
       VALUES ($1, $2, 'gerado')
       ON CONFLICT (competencia, conteudo) DO UPDATE
         SET origin = 'gerado', updated_at = NOW()
       RETURNING *`,
      [competencia, conteudo],
    );

    await query(
      `UPDATE competencies_pending
       SET status = 'approved', updated_at = NOW()
       WHERE id = $1`,
      [id],
    );

    return NextResponse.json({
      ok: true,
      status: 'approved',
      item: catalog.rows[0],
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Erro ao processar pendente' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = requireAdmin(req);
  if (auth.error) return auth.error;

  try {
    await ensureTaxonomyTables();
    const id = Number(req.nextUrl.searchParams.get('id'));
    if (!id) {
      return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });
    }
    await query(`DELETE FROM competencies_pending WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Erro ao excluir pendente' }, { status: 500 });
  }
}
