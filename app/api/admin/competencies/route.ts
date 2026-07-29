import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { query } from '@/lib/db';
import {
  ensureTaxonomyTables,
  normalizeTaxonomyLabel,
  type TaxonomyOrigin,
} from '@/lib/taxonomy-schema';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req);
  if (auth.error) return auth.error;

  try {
    await ensureTaxonomyTables();
    const origin = req.nextUrl.searchParams.get('origin');
    const params: string[] = [];
    let sql = `SELECT * FROM competencies_catalog`;
    if (origin === 'original' || origin === 'gerado') {
      sql += ` WHERE origin = $1`;
      params.push(origin);
    }
    sql += ` ORDER BY id ASC`;
    const res = await query(sql, params);
    return NextResponse.json({ items: res.rows });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Erro ao listar competências' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAdmin(req);
  if (auth.error) return auth.error;

  try {
    await ensureTaxonomyTables();
    const body = await req.json();

    // Bulk JSON import
    if (Array.isArray(body?.items) || Array.isArray(body?.competencias)) {
      const groups = Array.isArray(body.competencias)
        ? body.competencias
        : body.items;
      let inserted = 0;
      let skipped = 0;
      for (const g of groups) {
        const competencia = normalizeTaxonomyLabel(
          String(g?.competencia ?? g?.parent ?? ''),
        );
        const conteudosRaw = Array.isArray(g?.conteudos)
          ? g.conteudos
          : g?.conteudo
            ? [g.conteudo]
            : Array.isArray(g?.children)
              ? g.children
              : [];
        for (const c of conteudosRaw) {
          const conteudo = normalizeTaxonomyLabel(String(c ?? ''));
          if (!competencia || !conteudo) {
            skipped += 1;
            continue;
          }
          try {
            await query(
              `INSERT INTO competencies_catalog (competencia, conteudo, origin)
               VALUES ($1, $2, 'original')
               ON CONFLICT (competencia, conteudo) DO NOTHING`,
              [competencia, conteudo],
            );
            inserted += 1;
          } catch {
            skipped += 1;
          }
        }
      }
      return NextResponse.json({ ok: true, inserted, skipped });
    }

    const competencia = normalizeTaxonomyLabel(String(body?.competencia ?? ''));
    const conteudo = normalizeTaxonomyLabel(String(body?.conteudo ?? ''));
    const origin: TaxonomyOrigin =
      body?.origin === 'gerado' ? 'gerado' : 'original';
    if (!competencia || !conteudo) {
      return NextResponse.json(
        { error: 'competencia e conteudo são obrigatórios' },
        { status: 400 },
      );
    }

    const res = await query(
      `INSERT INTO competencies_catalog (competencia, conteudo, origin)
       VALUES ($1, $2, $3)
       ON CONFLICT (competencia, conteudo) DO UPDATE
         SET origin = EXCLUDED.origin, updated_at = NOW()
       RETURNING *`,
      [competencia, conteudo, origin],
    );
    return NextResponse.json({ item: res.rows[0] });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Erro ao salvar competência' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = requireAdmin(req);
  if (auth.error) return auth.error;

  try {
    await ensureTaxonomyTables();
    const body = await req.json();
    const id = Number(body?.id);
    const competencia = normalizeTaxonomyLabel(String(body?.competencia ?? ''));
    const conteudo = normalizeTaxonomyLabel(String(body?.conteudo ?? ''));
    const origin: TaxonomyOrigin =
      body?.origin === 'gerado' ? 'gerado' : 'original';
    if (!id || !competencia || !conteudo) {
      return NextResponse.json({ error: 'id, competencia e conteudo são obrigatórios' }, { status: 400 });
    }
    const res = await query(
      `UPDATE competencies_catalog
       SET competencia = $1, conteudo = $2, origin = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [competencia, conteudo, origin, id],
    );
    if (!res.rows[0]) {
      return NextResponse.json({ error: 'Registro não encontrado' }, { status: 404 });
    }
    return NextResponse.json({ item: res.rows[0] });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
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
    await query(`DELETE FROM competencies_catalog WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Erro ao excluir' }, { status: 500 });
  }
}
