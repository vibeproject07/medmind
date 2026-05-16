/**
 * POST /api/admin/query
 *
 * Executa uma consulta parametrizada segura na tabela questions.
 * Aceita filtros no formato:
 *   { filters: [{ field, operator, value }], limit?: number }
 *
 * Todos os campos e operadores são validados contra uma whitelist.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';

const ALLOWED_FIELDS: Record<string, string> = {
  id: 'integer',
  statement: 'text',
  option_a: 'text',
  option_b: 'text',
  option_c: 'text',
  option_d: 'text',
  option_e: 'text',
  correct_answer: 'text',
  explanation: 'text',
  exam_year: 'integer',
  exam_board: 'text',
  exam_institution: 'text',
  exam_region: 'text',
  tags: 'text',
  areas_conhecimento: 'text',
  assuntos: 'text',
  anulada: 'boolean',
  ai_decs_descriptors: 'text',
};

const OPERATORS: Record<string, { sql: string; needsValue: boolean }> = {
  equals:      { sql: '= $',            needsValue: true  },
  not_equals:  { sql: '!= $',           needsValue: true  },
  contains:    { sql: 'ILIKE $',        needsValue: true  },
  starts_with: { sql: 'ILIKE $',        needsValue: true  },
  ends_with:   { sql: 'ILIKE $',        needsValue: true  },
  gt:          { sql: '> $',            needsValue: true  },
  gte:         { sql: '>= $',           needsValue: true  },
  lt:          { sql: '< $',            needsValue: true  },
  lte:         { sql: '<= $',           needsValue: true  },
  is_null:     { sql: 'IS NULL',        needsValue: false },
  is_not_null: { sql: 'IS NOT NULL',    needsValue: false },
};

function getToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  return token;
}

export async function POST(req: NextRequest) {
  const token = getToken(req);
  if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const user = verifyToken(token);
  if (!user || user.role !== 'admin')
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    filters?: { field: string; operator: string; value?: string }[];
    limit?: number;
  };

  const filters = Array.isArray(body.filters) ? body.filters : [];
  const limit = Math.min(Math.max(1, parseInt(String(body.limit ?? '50'))), 200);

  const conditions: string[] = [];
  const params: unknown[] = [];

  for (const f of filters) {
    if (!ALLOWED_FIELDS[f.field]) continue;
    const op = OPERATORS[f.operator];
    if (!op) continue;

    if (!op.needsValue) {
      conditions.push(`"${f.field}" ${op.sql}`);
      continue;
    }

    params.push(buildParamValue(f.field, f.operator, f.value ?? ''));
    const idx = params.length;
    conditions.push(`"${f.field}"::text ${op.sql}${idx}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT id, statement, option_a, option_b, option_c, option_d, option_e,
           correct_answer, exam_year, exam_board, exam_institution, exam_region,
           tags, areas_conhecimento, assuntos, anulada,
           ai_decs_descriptors
    FROM questions
    ${where}
    ORDER BY id DESC
    LIMIT ${limit}
  `;

  const { rows, rowCount } = await pool.query(sql, params);

  return NextResponse.json({ rows, total: rowCount, sql: sql.replace(/\s+/g, ' ').trim() });
}

function buildParamValue(field: string, operator: string, raw: string): unknown {
  const type = ALLOWED_FIELDS[field];
  if (operator === 'contains')    return `%${raw}%`;
  if (operator === 'starts_with') return `${raw}%`;
  if (operator === 'ends_with')   return `%${raw}`;
  if (type === 'integer') {
    const n = parseInt(raw);
    return isNaN(n) ? 0 : n;
  }
  if (type === 'boolean') return raw === 'true' || raw === '1';
  return raw;
}

export async function GET(req: NextRequest) {
  const token = getToken(req);
  if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const user = verifyToken(token);
  if (!user || user.role !== 'admin')
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id || isNaN(parseInt(id)))
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

  const { rows } = await pool.query(
    `SELECT id, statement, option_a, option_b, option_c, option_d, option_e,
            correct_answer, explanation, exam_year, exam_board, exam_institution,
            exam_region, tags, areas_conhecimento, assuntos, anulada, ai_decs_descriptors
     FROM questions WHERE id = $1`,
    [parseInt(id)]
  );

  if (!rows.length) return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
  return NextResponse.json({ question: rows[0] });
}
