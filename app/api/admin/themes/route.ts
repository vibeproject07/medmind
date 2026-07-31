import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { query } from '@/lib/db';
import {
  ensureTaxonomyTables,
  normalizeTaxonomyLabel,
  type TaxonomyOrigin,
} from '@/lib/taxonomy-schema';
import { purgeThemePair } from '@/lib/taxonomy-term-removal';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req);
  if (auth.error) return auth.error;

  try {
    await ensureTaxonomyTables();
    const origin = req.nextUrl.searchParams.get('origin');
    const params: string[] = [];
    let sql = `SELECT * FROM themes_catalog`;
    if (origin === 'original' || origin === 'gerado') {
      sql += ` WHERE origin = $1`;
      params.push(origin);
    }
    sql += ` ORDER BY id ASC`;
    const res = await query(sql, params);
    return NextResponse.json({ items: res.rows });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Erro ao listar temas' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAdmin(req);
  if (auth.error) return auth.error;

  try {
    await ensureTaxonomyTables();
    const body = await req.json();

    if (Array.isArray(body?.items) || Array.isArray(body?.temas)) {
      const groups = Array.isArray(body.temas) ? body.temas : body.items;
      let inserted = 0;
      let skipped = 0;
      for (const g of groups) {
        const tema = normalizeTaxonomyLabel(String(g?.tema ?? g?.parent ?? ''));
        const subtemasRaw = Array.isArray(g?.subtemas)
          ? g.subtemas
          : g?.subtema
            ? [g.subtema]
            : Array.isArray(g?.children)
              ? g.children
              : [];
        for (const s of subtemasRaw) {
          const subtema = normalizeTaxonomyLabel(String(s ?? ''));
          if (!tema || !subtema) {
            skipped += 1;
            continue;
          }
          try {
            await query(
              `INSERT INTO themes_catalog (tema, subtema, origin)
               VALUES ($1, $2, 'original')
               ON CONFLICT (tema, subtema) DO NOTHING`,
              [tema, subtema],
            );
            inserted += 1;
          } catch {
            skipped += 1;
          }
        }
      }
      return NextResponse.json({ ok: true, inserted, skipped });
    }

    const tema = normalizeTaxonomyLabel(String(body?.tema ?? ''));
    const subtema = normalizeTaxonomyLabel(String(body?.subtema ?? ''));
    const origin: TaxonomyOrigin =
      body?.origin === 'gerado' ? 'gerado' : 'original';
    if (!tema || !subtema) {
      return NextResponse.json(
        { error: 'tema e subtema são obrigatórios' },
        { status: 400 },
      );
    }

    const res = await query(
      `INSERT INTO themes_catalog (tema, subtema, origin)
       VALUES ($1, $2, $3)
       ON CONFLICT (tema, subtema) DO UPDATE
         SET origin = EXCLUDED.origin, updated_at = NOW()
       RETURNING *`,
      [tema, subtema, origin],
    );
    return NextResponse.json({ item: res.rows[0] });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Erro ao salvar tema' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = requireAdmin(req);
  if (auth.error) return auth.error;

  try {
    await ensureTaxonomyTables();
    const body = await req.json();
    const id = Number(body?.id);
    const tema = normalizeTaxonomyLabel(String(body?.tema ?? ''));
    const subtema = normalizeTaxonomyLabel(String(body?.subtema ?? ''));
    const origin: TaxonomyOrigin =
      body?.origin === 'gerado' ? 'gerado' : 'original';
    if (!id || !tema || !subtema) {
      return NextResponse.json(
        { error: 'id, tema e subtema são obrigatórios' },
        { status: 400 },
      );
    }
    const res = await query(
      `UPDATE themes_catalog
       SET tema = $1, subtema = $2, origin = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [tema, subtema, origin, id],
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
    const existing = await query(`SELECT * FROM themes_catalog WHERE id = $1`, [id]);
    const row = existing.rows[0] as { tema: string; subtema: string } | undefined;
    if (!row) {
      return NextResponse.json({ error: 'Registro não encontrado' }, { status: 404 });
    }
    const purge = await purgeThemePair(row.tema, row.subtema);
    await query(`DELETE FROM themes_catalog WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true, purge });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Erro ao excluir' }, { status: 500 });
  }
}
