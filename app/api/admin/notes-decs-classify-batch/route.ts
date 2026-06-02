/**
 * GET  /api/admin/notes-decs-classify-batch
 * POST /api/admin/notes-decs-classify-batch
 *
 * Classificação DeCS em lote de notas desativada temporariamente.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';

function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  if (!token) return null;
  return verifyToken(token);
}

export async function GET(req: NextRequest) {
  const user = getUser(req);
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  return NextResponse.json({
    disabled: true,
    message: 'Classificação DeCS em lote de notas está desativada temporariamente.',
  }, { status: 410 });
}

export async function POST(req: NextRequest) {
  const user = getUser(req);
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  return NextResponse.json({
    started: false,
    disabled: true,
    message: 'Classificação DeCS em lote de notas está desativada temporariamente.',
  }, { status: 410 });
}
