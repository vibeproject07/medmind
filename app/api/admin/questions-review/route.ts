import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

async function ensureMetaColumn() {
  await query(
    `ALTER TABLE questions ADD COLUMN IF NOT EXISTS decs_validation_meta JSONB`,
  );
}

/**
 * Lista questões que precisam de revisão manual por ausência de termos DeCS primários.
 */
export async function GET(req: NextRequest) {
  const auth = requireAdmin(req);
  if (auth.error) return auth.error;

  try {
    await ensureMetaColumn();
    const includeDismissed =
      req.nextUrl.searchParams.get('include_dismissed') === '1';

    const res = await query(
      `
      SELECT
        id,
        left(statement, 280) AS statement_preview,
        correct_answer,
        exam_year,
        exam_board,
        exam_institution,
        tags,
        areas_conhecimento,
        ai_decs_descriptors,
        decs_validation_meta,
        updated_at
      FROM questions
      WHERE decs_validation_meta IS NOT NULL
        AND (decs_validation_meta->>'missing_primary_terms') = 'true'
        ${
          includeDismissed
            ? ''
            : `AND (
                 decs_validation_meta->>'dismissed_at' IS NULL
                 OR btrim(decs_validation_meta->>'dismissed_at') = ''
               )`
        }
      ORDER BY
        COALESCE(
          (decs_validation_meta->>'validated_at')::timestamptz,
          updated_at
        ) DESC NULLS LAST
      LIMIT 500
      `,
    );

    const items = res.rows.map((row) => {
      let descriptors: unknown[] = [];
      try {
        descriptors = row.ai_decs_descriptors
          ? JSON.parse(row.ai_decs_descriptors as string)
          : [];
      } catch {
        descriptors = [];
      }
      const meta =
        typeof row.decs_validation_meta === 'string'
          ? JSON.parse(row.decs_validation_meta)
          : row.decs_validation_meta;

      return {
        id: row.id,
        statement_preview: row.statement_preview,
        correct_answer: row.correct_answer,
        exam_year: row.exam_year,
        exam_board: row.exam_board,
        exam_institution: row.exam_institution,
        tags: row.tags
          ? typeof row.tags === 'string'
            ? JSON.parse(row.tags)
            : row.tags
          : [],
        areas_conhecimento: row.areas_conhecimento
          ? typeof row.areas_conhecimento === 'string'
            ? JSON.parse(row.areas_conhecimento)
            : row.areas_conhecimento
          : [],
        descriptors_count: Array.isArray(descriptors) ? descriptors.length : 0,
        primary_count: Array.isArray(descriptors)
          ? descriptors.filter(
              (d: { role?: string }) =>
                String(d?.role ?? '').toLowerCase() === 'primary',
            ).length
          : 0,
        decs_validation_meta: meta,
        updated_at: row.updated_at,
      };
    });

    return NextResponse.json({
      items,
      total: items.length,
      reason: 'missing_primary_terms',
    });
  } catch (e) {
    console.error('[questions-review] GET error:', e);
    return NextResponse.json(
      { error: 'Erro ao listar questões para revisão' },
      { status: 500 },
    );
  }
}

/**
 * Marca uma questão como revisada (remove da fila ativa) ou reabre.
 * body: { id: number, action: 'dismiss' | 'reopen' }
 */
export async function POST(req: NextRequest) {
  const auth = requireAdmin(req);
  if (auth.error) return auth.error;

  try {
    await ensureMetaColumn();
    const body = await req.json();
    const id = Number(body?.id);
    const action = String(body?.action ?? 'dismiss');
    if (!id) {
      return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });
    }

    const qRes = await query(
      `SELECT decs_validation_meta FROM questions WHERE id = $1`,
      [id],
    );
    if (!qRes.rows[0]) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }

    let meta: Record<string, unknown> = {};
    try {
      const raw = qRes.rows[0].decs_validation_meta;
      meta =
        typeof raw === 'string'
          ? JSON.parse(raw)
          : raw && typeof raw === 'object'
            ? (raw as Record<string, unknown>)
            : {};
    } catch {
      meta = {};
    }

    if (action === 'reopen') {
      meta.dismissed_at = null;
      meta.missing_primary_terms = true;
      meta.needs_manual_review = true;
    } else {
      meta.dismissed_at = new Date().toISOString();
    }

    await query(
      `UPDATE questions
       SET decs_validation_meta = $1::jsonb, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(meta), id],
    );

    return NextResponse.json({ ok: true, id, action, decs_validation_meta: meta });
  } catch (e) {
    console.error('[questions-review] POST error:', e);
    return NextResponse.json({ error: 'Erro ao atualizar revisão' }, { status: 500 });
  }
}
